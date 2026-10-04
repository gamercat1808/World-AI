import { useEffect, useMemo, useState } from "react";
import "./GameHub.css";

const API_BASE = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const newQuestion = () => ({
  enunciado: "",
  opcoes: ["", "", "", ""],
  indice_correto: 0,
  duracao_segundos: 20,
});

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Erro do servidor (${response.status})`);
  }
  return payload;
}

function GameHub({ onClose, language, level }) {
  const [view, setView] = useState("home");
  const [mode, setMode] = useState("player");
  const [adminKey, setAdminKey] = useState("");
  const [title, setTitle] = useState("");
  const [classId, setClassId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [questions, setQuestions] = useState([newQuestion()]);
  const [quizTopic, setQuizTopic] = useState("");
  const [questionCount, setQuestionCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerToken, setPlayerToken] = useState("");
  const [game, setGame] = useState(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(mode === "host" && adminKey ? { "X-Admin-Key": adminKey } : {}),
    }),
    [adminKey, mode],
  );

  useEffect(() => {
    if (!game?.pin || view !== "room") return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const query = playerToken
          ? `?token=${encodeURIComponent(playerToken)}`
          : "";
        const updated = await request(`/games/${game.pin}${query}`);
        if (active) setGame(updated);
      } catch (refreshError) {
        if (active) setError(refreshError.message);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [game?.pin, playerToken, view]);

  useEffect(() => {
    if (!game?.questao_atual?.iniciou_em) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [game?.questao_atual?.iniciou_em]);

  async function generateQuizQuestions() {
    const topic = quizTopic.trim();
    if (!topic || isGenerating) return;
    setIsGenerating(true);
    setError("");
    try {
      const prompt = [
        `Crie exatamente ${questionCount} perguntas de múltipla escolha para um jogo de vocabulário em ${language}.`,
        `Nível do estudante: ${level}. Tema: ${topic}.`,
        "As perguntas e opções devem estar em português, testando o uso e o significado de palavras/expressões do idioma-alvo.",
        'Responda somente com JSON válido, sem markdown, no formato: {"questoes":[{"enunciado":"...","opcoes":["...","...","...","..."],"indice_correto":0}]}. O índice correto começa em zero. Crie distratores plausíveis, mas somente uma opção correta.',
      ].join("\n\n");
      const generated = await request("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: prompt, ido: "Português brasileiro" }),
      });
      const jsonText = generated.resp
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonText);
      if (
        !Array.isArray(parsed.questoes) ||
        parsed.questoes.length !== questionCount ||
        parsed.questoes.some(
          (item) =>
            !item ||
            typeof item.enunciado !== "string" ||
            !Array.isArray(item.opcoes) ||
            item.opcoes.length < 2 ||
            item.opcoes.length > 6 ||
            !Number.isInteger(item.indice_correto) ||
            item.indice_correto < 0 ||
            item.indice_correto >= item.opcoes.length,
        )
      ) {
        throw new Error(
          "A IA retornou perguntas fora do formato esperado. Tente novamente.",
        );
      }
      setQuestions(
        parsed.questoes.map((item) => ({
          ...item,
          duracao_segundos: 20,
        })),
      );
    } catch (generationError) {
      setError(
        generationError instanceof SyntaxError
          ? "Não consegui interpretar as perguntas geradas. Tente novamente."
          : generationError.message,
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function createGame(event) {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const payload = {
        titulo: title,
        questoes: questions.map((question) => ({
          ...question,
          duracao_segundos: Number(question.duracao_segundos),
        })),
      };
      if (classId.trim()) payload.turma_id = Number(classId);
      if (teacherId.trim()) payload.professor_id = Number(teacherId);
      const created = await request("/games", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      setMode("host");
      setGame(created);
      setView("room");
    } catch (createError) {
      setError(createError.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function joinGame(event) {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const joined = await request(`/games/${pinInput.trim()}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: playerName }),
      });
      setMode("player");
      setPlayerToken(joined.token);
      setGame(joined.jogo);
      setView("room");
    } catch (joinError) {
      setError(joinError.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function advanceGame() {
    setError("");
    setIsLoading(true);
    try {
      const updated = await request(`/games/${game.pin}/advance`, {
        method: "POST",
        headers,
      });
      setGame(updated);
    } catch (advanceError) {
      setError(advanceError.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function submitAnswer(index) {
    if (game.minha_resposta || secondsLeft === 0) return;
    setIsLoading(true);
    setError("");
    try {
      const result = await request(`/games/${game.pin}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: playerToken, indice_escolhido: index }),
      });
      setGame((previous) => ({
        ...previous,
        minha_resposta: {
          indice_escolhido: index,
          correta: result.correta,
          pontos: result.pontos_ganhos,
          indice_correto: result.indice_correto,
        },
      }));
    } catch (answerError) {
      setError(answerError.message);
    } finally {
      setIsLoading(false);
    }
  }

  function updateQuestion(questionIndex, patch) {
    setQuestions((previous) =>
      previous.map((question, index) =>
        index === questionIndex ? { ...question, ...patch } : question,
      ),
    );
  }

  function updateOption(questionIndex, optionIndex, value) {
    setQuestions((previous) =>
      previous.map((question, index) => {
        if (index !== questionIndex) return question;
        return {
          ...question,
          opcoes: question.opcoes.map((option, choice) =>
            choice === optionIndex ? value : option,
          ),
        };
      }),
    );
  }

  const question = game?.questao_atual;
  const currentAnswer = game?.minha_resposta;
  const secondsLeft = question?.iniciou_em
    ? Math.max(
        0,
        Math.ceil(
          question.duracao_segundos -
            (clockNow - new Date(question.iniciou_em).getTime()) / 1000,
        ),
      )
    : null;

  return (
    <div
      className="game-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="game-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-dialog-title"
      >
        <header className="game-dialog-header">
          <div className="game-brand-icon">✦</div>
          <div className="game-heading">
            <span>WORLD · JOGO AO VIVO</span>
            <h2 id="game-dialog-title">
              {view === "room" ? game?.titulo : "Quiz da turma"}
            </h2>
          </div>
          <button
            className="game-close"
            type="button"
            onClick={onClose}
            aria-label="Fechar jogo"
          >
            ×
          </button>
        </header>

        {view === "home" && (
          <div className="game-home">
            <p>
              Crie um desafio de perguntas para a turma ou entre em uma partida
              com PIN.
            </p>
            <div className="game-mode-grid">
              <button
                type="button"
                onClick={() => {
                  setMode("host");
                  setView("host");
                }}
              >
                <span>＋</span>
                <strong>Criar um jogo</strong>
                <small>Professor ou administrador</small>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("player");
                  setView("join");
                }}
              >
                <span>↗</span>
                <strong>Entrar em um jogo</strong>
                <small>Tenho um código PIN</small>
              </button>
            </div>
          </div>
        )}

        {view === "host" && (
          <form className="game-form" onSubmit={createGame}>
            <label>
              Chave de administrador
              <input
                type="password"
                value={adminKey}
                onChange={(event) => setAdminKey(event.target.value)}
                required
                autoComplete="current-password"
                placeholder="Chave configurada no backend"
              />
            </label>
            <label>
              Nome do jogo
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                required
                placeholder="Ex.: Vocabulário de viagem"
              />
            </label>
            <div className="game-link-fields">
              <label>
                ID da turma (opcional)
                <input
                  type="number"
                  min="1"
                  value={classId}
                  onChange={(event) => setClassId(event.target.value)}
                  placeholder="Ex.: 2"
                />
              </label>
              <label>
                ID do professor (opcional)
                <input
                  type="number"
                  min="1"
                  value={teacherId}
                  onChange={(event) => setTeacherId(event.target.value)}
                  placeholder="Ex.: 1"
                />
              </label>
            </div>
            <div className="game-questions-heading">
              <h3>Perguntas</h3>
              <span>{questions.length}/50</span>
            </div>
            <div className="game-ai-generator">
              <label>
                Tema para a IA
                <input
                  value={quizTopic}
                  onChange={(event) => setQuizTopic(event.target.value)}
                  maxLength={100}
                  placeholder={`Ex.: viagem, comida, verbos no ${language}`}
                />
              </label>
              <div className="game-ai-generator-controls">
                <label>
                  Quantidade
                  <select
                    value={questionCount}
                    onChange={(event) =>
                      setQuestionCount(Number(event.target.value))
                    }
                  >
                    {[3, 5, 8, 10].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="game-secondary-button"
                  type="button"
                  onClick={generateQuizQuestions}
                  disabled={!quizTopic.trim() || isGenerating}
                >
                  {isGenerating
                    ? "IA criando perguntas…"
                    : `✦ Gerar com IA · ${language} ${level}`}
                </button>
              </div>
              <small>
                A IA cria perguntas de vocabulário no nível de proficiência
                selecionado.
              </small>
            </div>
            {questions.map((item, questionIndex) => (
              <fieldset className="game-question-editor" key={questionIndex}>
                <legend>Pergunta {questionIndex + 1}</legend>
                <input
                  aria-label={`Enunciado da pergunta ${questionIndex + 1}`}
                  value={item.enunciado}
                  onChange={(event) =>
                    updateQuestion(questionIndex, {
                      enunciado: event.target.value,
                    })
                  }
                  maxLength={500}
                  required
                  placeholder="Escreva uma pergunta"
                />
                <div className="game-choice-editor">
                  {item.opcoes.map((option, optionIndex) => (
                    <label className="game-choice-input" key={optionIndex}>
                      <input
                        type="radio"
                        name={`correct-${questionIndex}`}
                        checked={item.indice_correto === optionIndex}
                        onChange={() =>
                          updateQuestion(questionIndex, {
                            indice_correto: optionIndex,
                          })
                        }
                        aria-label={`Marcar opção ${optionIndex + 1} como correta`}
                      />
                      <input
                        value={option}
                        onChange={(event) =>
                          updateOption(
                            questionIndex,
                            optionIndex,
                            event.target.value,
                          )
                        }
                        maxLength={160}
                        required
                        placeholder={`Opção ${optionIndex + 1}`}
                        aria-label={`Opção ${optionIndex + 1}`}
                      />
                    </label>
                  ))}
                </div>
                <label className="game-duration">
                  Tempo para responder
                  <select
                    value={item.duracao_segundos}
                    onChange={(event) =>
                      updateQuestion(questionIndex, {
                        duracao_segundos: Number(event.target.value),
                      })
                    }
                  >
                    {[10, 15, 20, 30, 45, 60, 90, 120].map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds} segundos
                      </option>
                    ))}
                  </select>
                </label>
                {questions.length > 1 && (
                  <button
                    className="game-remove-question"
                    type="button"
                    onClick={() =>
                      setQuestions((previous) =>
                        previous.filter((_, index) => index !== questionIndex),
                      )
                    }
                  >
                    Remover pergunta
                  </button>
                )}
              </fieldset>
            ))}
            <button
              className="game-secondary-button"
              type="button"
              disabled={questions.length >= 50}
              onClick={() =>
                setQuestions((previous) => [...previous, newQuestion()])
              }
            >
              ＋ Adicionar pergunta
            </button>
            <button
              className="game-primary-button"
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? "Criando…" : "Criar sala"}
            </button>
          </form>
        )}

        {view === "join" && (
          <form className="game-form game-join-form" onSubmit={joinGame}>
            <p>Peça ao professor o PIN exibido na tela da sala.</p>
            <label>
              Código PIN
              <input
                className="game-pin-input"
                inputMode="numeric"
                pattern="[0-9]{6}"
                value={pinInput}
                onChange={(event) =>
                  setPinInput(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
                placeholder="000000"
              />
            </label>
            <label>
              Seu nome
              <input
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                maxLength={40}
                required
                placeholder="Como você quer aparecer?"
              />
            </label>
            <button
              className="game-primary-button"
              type="submit"
              disabled={isLoading || pinInput.length !== 6}
            >
              {isLoading ? "Entrando…" : "Entrar na sala"}
            </button>
          </form>
        )}

        {view === "room" && game && (
          <div className="game-room">
            {mode === "host" && (
              <div className="game-pin-card">
                <span>PIN DA SALA</span>
                <strong>{game.pin}</strong>
                <small>Compartilhe este código com a turma</small>
              </div>
            )}
            {game.status === "lobby" && (
              <div className="game-lobby">
                <div className="game-live-count">
                  <strong>{game.participantes}</strong>
                  <span>
                    {game.participantes === 1
                      ? "jogador conectado"
                      : "jogadores conectados"}
                  </span>
                </div>
                {mode === "host" ? (
                  <>
                    <p>
                      Os participantes entram em <strong>{game.pin}</strong>.
                      Inicie quando a turma estiver pronta.
                    </p>
                    <button
                      className="game-primary-button"
                      type="button"
                      onClick={advanceGame}
                      disabled={isLoading}
                    >
                      {isLoading ? "Iniciando…" : "Iniciar jogo"}
                    </button>
                  </>
                ) : (
                  <p>
                    Você entrou como <strong>{playerName}</strong>. Aguarde o
                    professor iniciar!
                  </p>
                )}
                {game.placar.length > 0 && <Ranking rows={game.placar} />}
              </div>
            )}
            {game.status === "playing" && question && (
              <div className="game-question-live">
                <div className="game-question-meta">
                  <span>
                    Pergunta {question.posicao + 1} de {question.total}
                  </span>
                  <strong className={secondsLeft <= 5 ? "urgent" : ""}>
                    {secondsLeft ?? question.duracao_segundos}s
                  </strong>
                </div>
                <h3>{question.enunciado}</h3>
                {mode === "host" ? (
                  <>
                    <p>
                      As respostas da turma aparecem no placar quando avançar.
                    </p>
                    <button
                      className="game-primary-button"
                      type="button"
                      onClick={advanceGame}
                      disabled={isLoading}
                    >
                      {isLoading
                        ? "Avançando…"
                        : question.posicao + 1 < question.total
                          ? "Próxima pergunta"
                          : "Finalizar e ver resultado"}
                    </button>
                  </>
                ) : currentAnswer ? (
                  <div
                    className={`game-answer-feedback ${currentAnswer.correta ? "correct" : "incorrect"}`}
                  >
                    <strong>
                      {currentAnswer.correta ? "Resposta correta!" : "Quase!"}
                    </strong>
                    <span>
                      {currentAnswer.pontos ?? currentAnswer.pontos_ganhos}{" "}
                      pontos
                    </span>
                    <small>Aguarde a próxima pergunta…</small>
                  </div>
                ) : (
                  <div className="game-answer-grid">
                    {question.opcoes.map((option, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => submitAnswer(index)}
                        disabled={isLoading || secondsLeft === 0}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
                {mode === "host" && <Ranking rows={game.placar} compact />}
              </div>
            )}
            {game.status === "finished" && (
              <div className="game-finished">
                <span>🏆</span>
                <h3>Jogo finalizado!</h3>
                <p>Placar da turma</p>
                <Ranking rows={game.placar} />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="game-error" role="alert">
            {error}
          </div>
        )}
        {view !== "home" && view !== "room" && (
          <button
            className="game-back-button"
            type="button"
            onClick={() => {
              setView("home");
              setError("");
            }}
          >
            ← Voltar
          </button>
        )}
      </section>
    </div>
  );
}

function Ranking({ rows, compact = false }) {
  return (
    <div className={`game-ranking ${compact ? "compact" : ""}`}>
      <h3>
        Placar <span>{rows.length}</span>
      </h3>
      {rows.length ? (
        rows.slice(0, compact ? 5 : 10).map((row, index) => (
          <div className="game-ranking-row" key={`${row.nome}-${index}`}>
            <span className="game-rank-number">{index + 1}</span>
            <strong>{row.nome}</strong>
            <b>{row.pontos.toLocaleString("pt-BR")}</b>
          </div>
        ))
      ) : (
        <p>Ainda sem jogadores.</p>
      )}
    </div>
  );
}

export default GameHub;
