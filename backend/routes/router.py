import json
import secrets
from functools import wraps
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request, session
from groq import APIConnectionError, APITimeoutError, RateLimitError
from sqlalchemy import or_
from werkzeug.security import check_password_hash, generate_password_hash

from backend.ai.ai import ask
from backend import db
from backend.models.models import (
    Atividade,
    EntregaAtividade,
    Jogo,
    ParticipanteJogo,
    Professor,
    QuestaoJogo,
    RespostaJogo,
    Turma,
    User,
)

bp = Blueprint("main", __name__)


def require_admin(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        admin_api_key = current_app.config.get("ADMIN_API_KEY")
        provided_key = request.headers.get("X-Admin-Key", "")
        if not admin_api_key:
            return jsonify({"error": "Admin access is not configured"}), 503
        if not secrets.compare_digest(provided_key, admin_api_key):
            return jsonify({"error": "Admin access required"}), 401
        return view(*args, **kwargs)

    return wrapped


def get_json_object():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def serialize_atividade(atividade, entrega=None):
    prazo = atividade.prazo.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "id": atividade.id,
        "titulo": atividade.titulo,
        "descricao": atividade.descricao,
        "prazo": prazo,
        "turma_id": atividade.turma_id,
        "professor_id": atividade.professor_id,
        "status": entrega.status if entrega else None,
    }


def serialize_professor(professor):
    return {"id": professor.id, "nome": professor.nome, "email": professor.email, "materia": professor.materia}


def serialize_jogo(jogo, participante=None):
    question_payload = None
    own_answer = None
    if 0 <= jogo.questao_atual < len(jogo.questoes):
        question = jogo.questoes[jogo.questao_atual]
        question_payload = {
            "posicao": question.posicao,
            "total": len(jogo.questoes),
            "enunciado": question.enunciado,
            "opcoes": json.loads(question.opcoes_json),
            "duracao_segundos": question.duracao_segundos,
            "iniciou_em": jogo.iniciou_questao_em.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if jogo.iniciou_questao_em else None,
        }
        if jogo.status == "finished":
            question_payload["indice_correto"] = question.indice_correto
        if participante is not None:
            answer = RespostaJogo.query.filter_by(
                participante_id=participante.id,
                questao_id=question.id,
            ).first()
            if answer is not None:
                own_answer = {
                    "indice_escolhido": answer.indice_escolhido,
                    "correta": answer.correta,
                    "pontos": answer.pontos,
                    "indice_correto": question.indice_correto,
                }

    ranking = sorted(jogo.participantes, key=lambda item: (-item.pontos, item.entrada_em))
    return {
        "pin": jogo.pin,
        "titulo": jogo.titulo,
        "status": jogo.status,
        "questao_atual": question_payload,
        "participantes": len(jogo.participantes),
        "placar": [{"nome": item.nome, "pontos": item.pontos} for item in ranking],
        "minha_resposta": own_answer,
    }

@bp.route("/ask", methods=["POST"])
def askAi():
    data = get_json_object()
    if not data or not data.get("cmd") or not data.get("ido"):
        return jsonify({"error": "Invalid request"}), 400
    ido = data["ido"]
    cmd = data["cmd"]
    try:
        resp = ask(cmd, ido)
    except RateLimitError:
        return jsonify({"error": "A IA está temporariamente sobrecarregada. Tente novamente em alguns segundos."}), 429
    except (APITimeoutError, APIConnectionError):
        return jsonify({"error": "Não foi possível conectar à IA agora. Tente novamente."}), 503
    return jsonify({
        "resp": resp,
        "cmd": cmd,
        "ido": ido
    })


@bp.route("/games", methods=["POST"])
@require_admin
def create_game():
    data = get_json_object()
    title = data.get("titulo") if data else None
    questions = data.get("questoes") if data else None
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 120:
        return jsonify({"error": "titulo é obrigatório e deve ter até 120 caracteres"}), 400
    if not isinstance(questions, list) or not 1 <= len(questions) <= 50:
        return jsonify({"error": "Adicione entre 1 e 50 perguntas"}), 400

    turma_id = data.get("turma_id")
    professor_id = data.get("professor_id")
    if turma_id is not None and (type(turma_id) is not int or db.session.get(Turma, turma_id) is None):
        return jsonify({"error": "turma_id inválido"}), 400
    if professor_id is not None and (type(professor_id) is not int or db.session.get(Professor, professor_id) is None):
        return jsonify({"error": "professor_id inválido"}), 400

    validated_questions = []
    for position, question in enumerate(questions):
        if not isinstance(question, dict):
            return jsonify({"error": f"Pergunta {position + 1} inválida"}), 400
        prompt = question.get("enunciado")
        options = question.get("opcoes")
        correct_index = question.get("indice_correto")
        duration = question.get("duracao_segundos", 20)
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt.strip()) > 500:
            return jsonify({"error": f"Enunciado inválido na pergunta {position + 1}"}), 400
        if not isinstance(options, list) or not 2 <= len(options) <= 6 or any(
            not isinstance(option, str) or not option.strip() or len(option.strip()) > 160
            for option in options
        ):
            return jsonify({"error": f"Use de 2 a 6 opções válidas na pergunta {position + 1}"}), 400
        if type(correct_index) is not int or not 0 <= correct_index < len(options):
            return jsonify({"error": f"Marque a resposta correta na pergunta {position + 1}"}), 400
        if type(duration) is not int or not 5 <= duration <= 120:
            return jsonify({"error": "A duração deve estar entre 5 e 120 segundos"}), 400
        validated_questions.append(
            (prompt.strip(), [option.strip() for option in options], correct_index, duration)
        )

    pin = None
    for _ in range(20):
        candidate = f"{secrets.randbelow(1_000_000):06d}"
        if Jogo.query.filter_by(pin=candidate).first() is None:
            pin = candidate
            break
    if pin is None:
        return jsonify({"error": "Não foi possível gerar um código de sala. Tente novamente."}), 503

    game = Jogo(
        pin=pin,
        titulo=title.strip(),
        turma_id=turma_id,
        professor_id=professor_id,
    )
    game.questoes = [
        QuestaoJogo(
            posicao=position,
            enunciado=prompt,
            opcoes_json=json.dumps(options, ensure_ascii=False),
            indice_correto=correct_index,
            duracao_segundos=duration,
        )
        for position, (prompt, options, correct_index, duration) in enumerate(validated_questions)
    ]
    db.session.add(game)
    db.session.commit()
    return jsonify(serialize_jogo(game)), 201


@bp.route("/games/<string:pin>/join", methods=["POST"])
def join_game(pin):
    game = Jogo.query.filter_by(pin=pin).first()
    if game is None:
        return jsonify({"error": "Código de jogo não encontrado"}), 404
    if game.status != "lobby":
        return jsonify({"error": "Este jogo já começou"}), 409

    data = get_json_object()
    name = data.get("nome") if data else None
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 40:
        return jsonify({"error": "Digite um nome de até 40 caracteres"}), 400

    participant = ParticipanteJogo(
        jogo_id=game.id,
        nome=name.strip(),
        token=secrets.token_urlsafe(32),
    )
    db.session.add(participant)
    db.session.commit()
    return jsonify({
        "token": participant.token,
        "nome": participant.nome,
        "jogo": serialize_jogo(game, participant),
    }), 201


@bp.route("/games/<string:pin>", methods=["GET"])
def get_game(pin):
    game = Jogo.query.filter_by(pin=pin).first()
    if game is None:
        return jsonify({"error": "Código de jogo não encontrado"}), 404
    token = request.args.get("token", "")
    participant = (
        ParticipanteJogo.query.filter_by(jogo_id=game.id, token=token).first()
        if token
        else None
    )
    return jsonify(serialize_jogo(game, participant)), 200


@bp.route("/games/<string:pin>/advance", methods=["POST"])
@require_admin
def advance_game(pin):
    game = Jogo.query.filter_by(pin=pin).first()
    if game is None:
        return jsonify({"error": "Código de jogo não encontrado"}), 404
    if game.status == "finished":
        return jsonify({"error": "Este jogo já terminou"}), 409

    if game.status == "lobby":
        game.status = "playing"
        game.questao_atual = 0
    elif game.questao_atual + 1 < len(game.questoes):
        game.questao_atual += 1
    else:
        game.status = "finished"
        game.iniciou_questao_em = None

    if game.status == "playing":
        game.iniciou_questao_em = datetime.utcnow()
    db.session.commit()
    return jsonify(serialize_jogo(game)), 200


@bp.route("/games/<string:pin>/answer", methods=["POST"])
def answer_game_question(pin):
    game = Jogo.query.filter_by(pin=pin).first()
    if game is None:
        return jsonify({"error": "Código de jogo não encontrado"}), 404
    data = get_json_object()
    token = data.get("token") if data else None
    choice_index = data.get("indice_escolhido") if data else None
    participant = (
        ParticipanteJogo.query.filter_by(jogo_id=game.id, token=token).first()
        if isinstance(token, str)
        else None
    )
    if participant is None:
        return jsonify({"error": "Participante inválido"}), 401
    if game.status != "playing" or not 0 <= game.questao_atual < len(game.questoes):
        return jsonify({"error": "Não há pergunta ativa"}), 409

    question = game.questoes[game.questao_atual]
    options = json.loads(question.opcoes_json)
    if type(choice_index) is not int or not 0 <= choice_index < len(options):
        return jsonify({"error": "Opção de resposta inválida"}), 400
    if game.iniciou_questao_em is None:
        return jsonify({"error": "A pergunta ainda não foi iniciada"}), 409

    elapsed = (datetime.utcnow() - game.iniciou_questao_em).total_seconds()
    if elapsed > question.duracao_segundos:
        return jsonify({"error": "O tempo desta pergunta acabou"}), 409
    if RespostaJogo.query.filter_by(
        participante_id=participant.id,
        questao_id=question.id,
    ).first():
        return jsonify({"error": "Você já respondeu esta pergunta"}), 409

    correct = choice_index == question.indice_correto
    remaining_ratio = max(0, 1 - elapsed / question.duracao_segundos)
    points = 1000 + round(500 * remaining_ratio) if correct else 0
    answer = RespostaJogo(
        participante_id=participant.id,
        questao_id=question.id,
        indice_escolhido=choice_index,
        correta=correct,
        pontos=points,
    )
    participant.pontos += points
    db.session.add(answer)
    db.session.commit()
    return jsonify({
        "correta": correct,
        "indice_correto": question.indice_correto,
        "pontos_ganhos": points,
        "pontos_total": participant.pontos,
    }), 200


@bp.route("/admin/turmas", methods=["POST"])
@require_admin
def create_turma():
    data = get_json_object()
    fields = ("idioma", "horario", "dia")
    if not data or any(not isinstance(data.get(field), str) or not data[field].strip() for field in fields):
        return jsonify({"error": "idioma, horario e dia são obrigatórios"}), 400
    if any(len(data[field].strip()) > 20 for field in fields):
        return jsonify({"error": "idioma, horario e dia devem ter no máximo 20 caracteres"}), 400

    turma = Turma(
        idioma=data["idioma"].strip(),
        horario=data["horario"].strip(),
        dia=data["dia"].strip(),
    )
    db.session.add(turma)
    db.session.commit()
    return jsonify({"id": turma.id, "idioma": turma.idioma, "horario": turma.horario, "dia": turma.dia}), 201


@bp.route("/admin/turmas/<int:turma_id>", methods=["DELETE"])
@require_admin
def delete_turma(turma_id):
    turma = db.session.get(Turma, turma_id)
    if turma is None:
        return jsonify({"error": "Turma não encontrada"}), 404

    User.query.filter_by(turma=turma.id).update({User.turma: None})
    db.session.delete(turma)
    db.session.commit()
    return jsonify({"message": "Turma excluída"}), 200


@bp.route("/admin/turmas/<int:turma_id>/alunos", methods=["POST", "DELETE"])
@require_admin
def manage_turma_aluno(turma_id):
    turma = db.session.get(Turma, turma_id)
    if turma is None:
        return jsonify({"error": "Turma não encontrada"}), 404

    data = get_json_object()
    if not data or type(data.get("user_id")) is not int:
        return jsonify({"error": "user_id inteiro é obrigatório"}), 400

    user = db.session.get(User, data["user_id"])
    if user is None:
        return jsonify({"error": "Usuário não encontrado"}), 404

    if request.method == "POST":
        user.turma = turma.id
        message = "Aluno adicionado à turma"
    else:
        if user.turma != turma.id:
            return jsonify({"error": "Aluno não pertence a esta turma"}), 409
        user.turma = None
        message = "Aluno removido da turma"

    db.session.commit()
    return jsonify({"message": message, "user_id": user.id, "turma_id": user.turma}), 200


@bp.route("/admin/usuarios", methods=["POST"])
@require_admin
def create_user():
    data = get_json_object()
    required = ("username", "email", "password")
    if not data or any(not isinstance(data.get(field), str) or not data[field].strip() for field in required):
        return jsonify({"error": "username, email e password são obrigatórios"}), 400

    username = data["username"].strip()
    email = data["email"].strip().lower()
    password = data["password"]
    if len(username) > 80 or len(email) > 120:
        return jsonify({"error": "username deve ter até 80 e email até 120 caracteres"}), 400
    if len(password) < 8:
        return jsonify({"error": "A senha deve ter pelo menos 8 caracteres"}), 400
    idioma = data.get("idioma")
    if idioma is not None and (not isinstance(idioma, str) or len(idioma) > 20):
        return jsonify({"error": "idioma deve ser texto com até 20 caracteres"}), 400
    if User.query.filter(or_(User.username == username, User.email == email)).first():
        return jsonify({"error": "username ou email já cadastrado"}), 409

    turma_id = data.get("turma_id")
    if turma_id is not None:
        if type(turma_id) is not int:
            return jsonify({"error": "turma_id deve ser inteiro"}), 400
        if db.session.get(Turma, turma_id) is None:
            return jsonify({"error": "Turma não encontrada"}), 404

    user = User(
        username=username,
        email=email,
        password=generate_password_hash(password, method="pbkdf2:sha256"),
        turma=turma_id,
        idioma=idioma,
    )
    db.session.add(user)
    db.session.commit()
    return jsonify({"id": user.id, "username": user.username, "email": user.email}), 201


@bp.route("/login", methods=["POST"])
def login():
    data = get_json_object()
    password = data.get("password") if data else None
    identifier = (data.get("email") or data.get("username")) if data else None
    if not isinstance(identifier, str) or not identifier.strip() or not isinstance(password, str):
        return jsonify({"error": "email ou username e password são obrigatórios"}), 400

    identifier = identifier.strip()
    user = User.query.filter(or_(User.email == identifier.lower(), User.username == identifier)).first()
    if user is None:
        return jsonify({"error": "Credenciais inválidas"}), 401
    try:
        password_matches = check_password_hash(user.password, password)
    except (ValueError, TypeError):
        password_matches = False
    if not password_matches:
        return jsonify({"error": "Credenciais inválidas"}), 401

    session.clear()
    session["user_id"] = user.id
    return jsonify({"message": "Login realizado", "user": {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "idioma": user.idioma,
        "turma_id": user.turma,
    }}), 200


@bp.route("/admin/professores", methods=["GET", "POST"])
@require_admin
def manage_professores():
    if request.method == "GET":
        return jsonify([serialize_professor(professor) for professor in Professor.query.order_by(Professor.id).all()]), 200

    data = get_json_object()
    if not data or any(not isinstance(data.get(field), str) or not data[field].strip() for field in ("nome", "email")):
        return jsonify({"error": "nome e email são obrigatórios"}), 400
    nome = data["nome"].strip()
    email = data["email"].strip().lower()
    materia = data.get("materia")
    if len(nome) > 120 or len(email) > 120:
        return jsonify({"error": "nome e email devem ter até 120 caracteres"}), 400
    if materia is not None and (not isinstance(materia, str) or len(materia.strip()) > 80):
        return jsonify({"error": "materia deve ter até 80 caracteres"}), 400
    if Professor.query.filter_by(email=email).first():
        return jsonify({"error": "email já cadastrado para outro professor"}), 409

    professor = Professor(nome=nome, email=email, materia=materia.strip() if materia else None)
    db.session.add(professor)
    db.session.commit()
    return jsonify(serialize_professor(professor)), 201


@bp.route("/admin/professores/<int:professor_id>", methods=["GET", "PUT", "PATCH", "DELETE"])
@require_admin
def manage_professor(professor_id):
    professor = db.session.get(Professor, professor_id)
    if professor is None:
        return jsonify({"error": "Professor não encontrado"}), 404

    if request.method == "GET":
        return jsonify(serialize_professor(professor)), 200
    if request.method == "DELETE":
        Atividade.query.filter_by(professor_id=professor.id).update({Atividade.professor_id: None})
        db.session.delete(professor)
        db.session.commit()
        return jsonify({"message": "Professor excluído"}), 200

    data = get_json_object()
    if not data:
        return jsonify({"error": "Envie ao menos um campo para atualizar"}), 400
    if "nome" in data:
        if not isinstance(data["nome"], str) or not data["nome"].strip() or len(data["nome"].strip()) > 120:
            return jsonify({"error": "nome deve ser texto não vazio com até 120 caracteres"}), 400
        professor.nome = data["nome"].strip()
    if "email" in data:
        if not isinstance(data["email"], str) or not data["email"].strip() or len(data["email"].strip()) > 120:
            return jsonify({"error": "email deve ser texto não vazio com até 120 caracteres"}), 400
        email = data["email"].strip().lower()
        duplicate = Professor.query.filter(Professor.email == email, Professor.id != professor.id).first()
        if duplicate:
            return jsonify({"error": "email já cadastrado para outro professor"}), 409
        professor.email = email
    if "materia" in data:
        materia = data["materia"]
        if materia is not None and (not isinstance(materia, str) or len(materia.strip()) > 80):
            return jsonify({"error": "materia deve ter até 80 caracteres"}), 400
        professor.materia = materia.strip() if materia else None

    db.session.commit()
    return jsonify(serialize_professor(professor)), 200


@bp.route("/admin/turmas/<int:turma_id>/atividades", methods=["POST"])
@require_admin
def create_atividade(turma_id):
    turma = db.session.get(Turma, turma_id)
    if turma is None:
        return jsonify({"error": "Turma não encontrada"}), 404

    data = get_json_object()
    if not data:
        return jsonify({"error": "Envie um corpo JSON válido"}), 400
    titulo = data.get("titulo")
    descricao = data.get("descricao")
    prazo_text = data.get("prazo")
    professor_id = data.get("professor_id")
    if not isinstance(titulo, str) or not titulo.strip() or len(titulo.strip()) > 160:
        return jsonify({"error": "titulo é obrigatório e deve ter até 160 caracteres"}), 400
    if not isinstance(descricao, str) or not descricao.strip():
        return jsonify({"error": "descricao é obrigatória"}), 400
    if not isinstance(prazo_text, str):
        return jsonify({"error": "prazo deve ser uma data ISO 8601 com fuso horário"}), 400
    try:
        prazo = datetime.fromisoformat(prazo_text.replace("Z", "+00:00"))
    except ValueError:
        return jsonify({"error": "prazo inválido; use ISO 8601, por exemplo 2026-10-01T23:59:00-03:00"}), 400
    if prazo.tzinfo is None or prazo.utcoffset() is None:
        return jsonify({"error": "prazo deve incluir fuso horário, por exemplo -03:00 ou Z"}), 400
    prazo_utc = prazo.astimezone(timezone.utc)
    if prazo_utc <= datetime.now(timezone.utc):
        return jsonify({"error": "prazo deve ser uma data futura"}), 400
    if type(professor_id) is not int:
        return jsonify({"error": "professor_id inteiro é obrigatório"}), 400
    professor = db.session.get(Professor, professor_id)
    if professor is None:
        return jsonify({"error": "Professor não encontrado"}), 404

    alunos = User.query.filter_by(turma=turma.id).all()
    if not alunos:
        return jsonify({"error": "A turma não possui alunos cadastrados"}), 409

    atividade = Atividade(
        turma_id=turma.id,
        professor_id=professor.id,
        titulo=titulo.strip(),
        descricao=descricao.strip(),
        prazo=prazo_utc.replace(tzinfo=None),
    )
    atividade.entregas = [EntregaAtividade(aluno=aluno) for aluno in alunos]
    db.session.add(atividade)
    db.session.commit()
    response = serialize_atividade(atividade)
    response["alunos_destinatarios"] = len(alunos)
    return jsonify(response), 201


@bp.route("/minhas-atividades", methods=["GET"])
def minhas_atividades():
    user_id = session.get("user_id")
    if user_id is None:
        return jsonify({"error": "Faça login para consultar suas atividades"}), 401

    entregas = (EntregaAtividade.query
                .filter_by(user_id=user_id)
                .join(Atividade)
                .order_by(Atividade.prazo.asc())
                .all())
    return jsonify([serialize_atividade(entrega.atividade, entrega) for entrega in entregas]), 200