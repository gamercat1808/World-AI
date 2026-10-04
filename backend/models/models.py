from datetime import datetime

from backend import db

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    turma = db.Column(db.Integer, nullable=True)
    idioma = db.Column(db.String(20), nullable=True)

    def __repr__(self):
        return f'<User {self.username}>'

class Turma(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    alunos = db.Column(db.String(500), nullable=True)
    idioma = db.Column(db.String(20), nullable=True)
    horario = db.Column(db.String(20), nullable=True)
    dia = db.Column(db.String(20), nullable=True)

    def __repr__(self):
        return f'<Turma {self.id}>'


class Professor(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    materia = db.Column(db.String(80), nullable=True)

    def __repr__(self):
        return f'<Professor {self.nome}>'


class Atividade(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    turma_id = db.Column(db.Integer, db.ForeignKey("turma.id"), nullable=False, index=True)
    professor_id = db.Column(db.Integer, db.ForeignKey("professor.id"), nullable=True)
    titulo = db.Column(db.String(160), nullable=False)
    descricao = db.Column(db.Text, nullable=False)
    prazo = db.Column(db.DateTime, nullable=False)
    criada_em = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    turma = db.relationship("Turma", backref=db.backref("atividades", cascade="all, delete-orphan"))
    professor = db.relationship("Professor", backref="atividades")

    def __repr__(self):
        return f'<Atividade {self.titulo}>'


class EntregaAtividade(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    atividade_id = db.Column(db.Integer, db.ForeignKey("atividade.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default="pendente")
    enviada_em = db.Column(db.DateTime, nullable=True)

    __table_args__ = (db.UniqueConstraint("atividade_id", "user_id", name="uq_atividade_aluno"),)
    atividade = db.relationship("Atividade", backref=db.backref("entregas", cascade="all, delete-orphan"))
    aluno = db.relationship("User", backref="entregas_atividade")


class Jogo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    pin = db.Column(db.String(6), unique=True, nullable=False, index=True)
    titulo = db.Column(db.String(120), nullable=False)
    turma_id = db.Column(db.Integer, db.ForeignKey("turma.id"), nullable=True)
    professor_id = db.Column(db.Integer, db.ForeignKey("professor.id"), nullable=True)
    status = db.Column(db.String(20), nullable=False, default="lobby")
    questao_atual = db.Column(db.Integer, nullable=False, default=-1)
    iniciou_questao_em = db.Column(db.DateTime, nullable=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    turma = db.relationship("Turma", backref="jogos")
    professor = db.relationship("Professor", backref="jogos")
    questoes = db.relationship(
        "QuestaoJogo",
        backref="jogo",
        cascade="all, delete-orphan",
        order_by="QuestaoJogo.posicao",
    )
    participantes = db.relationship(
        "ParticipanteJogo",
        backref="jogo",
        cascade="all, delete-orphan",
        order_by="ParticipanteJogo.entrada_em",
    )


class QuestaoJogo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    jogo_id = db.Column(db.Integer, db.ForeignKey("jogo.id"), nullable=False, index=True)
    posicao = db.Column(db.Integer, nullable=False)
    enunciado = db.Column(db.String(500), nullable=False)
    opcoes_json = db.Column(db.Text, nullable=False)
    indice_correto = db.Column(db.Integer, nullable=False)
    duracao_segundos = db.Column(db.Integer, nullable=False, default=20)


class ParticipanteJogo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    jogo_id = db.Column(db.Integer, db.ForeignKey("jogo.id"), nullable=False, index=True)
    nome = db.Column(db.String(40), nullable=False)
    token = db.Column(db.String(64), unique=True, nullable=False, index=True)
    pontos = db.Column(db.Integer, nullable=False, default=0)
    entrada_em = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    respostas = db.relationship(
        "RespostaJogo",
        backref="participante",
        cascade="all, delete-orphan",
    )


class RespostaJogo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    participante_id = db.Column(
        db.Integer,
        db.ForeignKey("participante_jogo.id"),
        nullable=False,
        index=True,
    )
    questao_id = db.Column(db.Integer, db.ForeignKey("questao_jogo.id"), nullable=False)
    indice_escolhido = db.Column(db.Integer, nullable=False)
    correta = db.Column(db.Boolean, nullable=False)
    pontos = db.Column(db.Integer, nullable=False, default=0)
    respondida_em = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    questao = db.relationship("QuestaoJogo")
    __table_args__ = (
        db.UniqueConstraint("participante_id", "questao_id", name="uq_jogo_resposta_participante"),
    )