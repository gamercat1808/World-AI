import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import GameHub from "./GameHub";

const LANGUAGES = [
  { label: "English", flag: "🇬🇧" },
  { label: "Español", flag: "🇪🇸" },
  { label: "Français", flag: "🇫🇷" },
  { label: "Deutsch", flag: "🇩🇪" },
  { label: "Italiano", flag: "🇮🇹" },
  { label: "Português", flag: "🇧🇷" },
  { label: "日本語", flag: "🇯🇵" },
];

const LEVELS = [
  { code: "A1", label: "Iniciante", description: "Estou começando" },
  { code: "A2", label: "Básico", description: "Consigo me virar" },
  {
    code: "B1",
    label: "Intermediário",
    description: "Converso sobre vários temas",
  },
  {
    code: "B2",
    label: "Intermediário avançado",
    description: "Me comunico com confiança",
  },
  { code: "C1", label: "Avançado", description: "Uso o idioma com fluidez" },
  { code: "C2", label: "Proficiente", description: "Domínio quase nativo" },
];

const LEVEL_GUIDANCE = {
  A1: "Use palavras muito frequentes e frases curtíssimas, uma ideia por frase. Prefira presente e estruturas básicas; evite expressões idiomáticas e explique palavras novas em português.",
  A2: "Use vocabulário cotidiano e frases curtas. Use estruturas simples para falar de rotina, passado e planos; explique expressões menos comuns de forma breve em português.",
  B1: "Use vocabulário comum variado e frases de extensão moderada, incluindo conectores simples. Introduza expressões naturais e explique termos menos familiares sem simplificar demais.",
  B2: "Use vocabulário variado e natural, combinações comuns de palavras e estruturas mais complexas quando úteis. Inclua expressões idiomáticas frequentes com contexto breve.",
  C1: "Use vocabulário preciso, nuances, colocações naturais e estruturas complexas. Explique somente nuances ou expressões raras que sejam relevantes.",
  C2: "Converse com fluência natural, vocabulário rico e nuances idiomáticas e culturais, como em uma conversa entre falantes proficientes; evite simplificações artificiais.",
};

const SUGGESTIONS = [
  {
    icon: "✦",
    label: "Vamos nos apresentar",
    prompt: "Vamos nos apresentar. Faça perguntas para me conhecer.",
  },
  {
    icon: "☕",
    label: "Pedir em um café",
    prompt: "Vamos praticar como pedir comida e bebida em um café.",
  },
  {
    icon: "⌁",
    label: "Falar sobre viagens",
    prompt: "Quero conversar sobre viagens e conhecer lugares novos.",
  },
];

const makeWelcome = (language) => ({
  id: "welcome",
  role: "assistant",
  content: `Olá! Eu sou seu parceiro de conversação. Vamos praticar ${language} juntos?\n\nConverse comigo naturalmente — vou ajudar com correções gentis e dicas úteis ao longo do caminho.`,
});

function readSavedConversation() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("lingua-conversation") || "[]",
    );
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function getSpeechLanguageCode(language) {
  const map = {
    English: "en-US",
    Español: "es-ES",
    Français: "fr-FR",
    Deutsch: "de-DE",
    Italiano: "it-IT",
    Português: "pt-BR",
    日本語: "ja-JP",
  };
  return map[language] || "en-US";
}

function isSecureOrigin() {
  if (typeof window === "undefined") {
    return true;
  }

  const hostname = window.location.hostname;
  return (
    window.isSecureContext ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  );
}

function App() {
  const [language, setLanguage] = useState(
    () => localStorage.getItem("lingua-language") || "English",
  );
  const [level, setLevel] = useState(
    () => localStorage.getItem("lingua-level") || "A2",
  );
  const [messages, setMessages] = useState(readSavedConversation);
  const [translations, setTranslations] = useState({});
  const [translationLoadingId, setTranslationLoadingId] = useState(null);
  const [messageFeedback, setMessageFeedback] = useState({});
  const [feedbackLoadingId, setFeedbackLoadingId] = useState(null);
  const [isTranslatorOpen, setIsTranslatorOpen] = useState(false);
  const [isGameOpen, setIsGameOpen] = useState(false);
  const [translatorDirection, setTranslatorDirection] =
    useState("pt-to-language");
  const [translatorText, setTranslatorText] = useState("");
  const [translatorResult, setTranslatorResult] = useState("");
  const [translatorTarget, setTranslatorTarget] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatorError, setTranslatorError] = useState("");
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceSessionActive, setVoiceSessionActive] = useState(false);
  const [voiceMode, setVoiceMode] = useState(true);
  const [voiceSpeed, setVoiceSpeed] = useState(() => {
    const savedSpeed = Number(localStorage.getItem("world-voice-speed"));
    return Number.isFinite(savedSpeed) && savedSpeed >= 0.5 && savedSpeed <= 1.5
      ? savedSpeed
      : 1;
  });
  const [error, setError] = useState("");
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const voiceSessionActiveRef = useRef(false);
  const voiceAwaitingResponseRef = useRef(false);
  const voiceTurnTranscriptRef = useRef("");
  const recognitionSegmentRef = useRef("");
  const voiceSilenceTimerRef = useRef(null);
  const startRecognitionRef = useRef(null);
  const finishVoiceTurnRef = useRef(null);
  const sendMessageRef = useRef(null);

  const currentLanguage =
    LANGUAGES.find((item) => item.label === language) || LANGUAGES[0];
  const currentLevel = LEVELS.find((item) => item.code === level) || LEVELS[1];
  const visibleMessages = messages.length ? messages : [makeWelcome(language)];
  const translationSource =
    translatorDirection === "pt-to-language"
      ? "português brasileiro"
      : language;
  const translationDestination =
    translatorDirection === "pt-to-language"
      ? language
      : "português brasileiro";
  const translationDirectionLabel =
    translatorDirection === "pt-to-language"
      ? `Português → ${language}`
      : `${language} → Português`;

  useEffect(() => {
    localStorage.setItem("lingua-language", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("lingua-level", level);
  }, [level]);

  useEffect(() => {
    localStorage.setItem("world-voice-speed", String(voiceSpeed));
  }, [voiceSpeed]);

  useEffect(() => {
    localStorage.setItem("lingua-conversation", JSON.stringify(messages));
    if (listRef.current)
      listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, isSending]);

  const voiceSupported =
    isSecureOrigin() &&
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const speakAssistantText = useCallback(
    (text, onDone = () => {}) => {
      if (
        !voiceMode ||
        typeof window === "undefined" ||
        !("speechSynthesis" in window)
      ) {
        onDone();
        return;
      }

      const cleanText = String(text)
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/(?<!\*)\*(?!\s)(.*?)(?<!\s)\*(?!\*)/g, "$1")
        .replace(/[_`~]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!cleanText) {
        onDone();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = getSpeechLanguageCode(language);
      utterance.rate = voiceSpeed;
      utterance.pitch = 1.1;
      utterance.volume = 1;
      utterance.onend = onDone;
      utterance.onerror = onDone;
      window.speechSynthesis.speak(utterance);
    },
    [language, voiceMode, voiceSpeed],
  );

  const sendMessage = useCallback(
    async (text = draft) => {
      const content = text.trim();
      if (!content || isSending) return;

      const userMessage = { id: crypto.randomUUID(), role: "user", content };
      const history = [...messages, userMessage]
        .filter((item) => item.id !== "welcome")
        .slice(-14);
      setMessages((previous) => [...previous, userMessage]);
      setDraft("");
      setError("");
      setIsSending(true);

      const conversation = history
        .map(
          (message) =>
            `${message.role === "user" ? "Aluno" : "Tutor"}: ${message.content}`,
        )
        .join("\n");
      const cmd = [
        `Você é um tutor amigável de conversação em ${language}. O aluno está no nível ${level} (${currentLevel.label}).`,
        `Converse principalmente em ${language}. Ajuste rigorosamente o vocabulário, a gramática e o tamanho das frases ao nível ${level}: ${LEVEL_GUIDANCE[level]}`,
        "Responda primeiro ao significado e à intenção da última mensagem, como em uma conversa normal entre pessoas. Seja natural, amigável e direto, desenvolva o assunto e faça uma pergunta relacionada quando isso ajudar a conversa a continuar. Não interrompa a conversa com análise gramatical, correções ou aula espontânea; o aluno pode pedir feedback separado sobre a frase.",
        "Histórico recente da conversa:",
        conversation,
        "Responda à última mensagem do aluno.",
      ].join("\n\n");

      try {
        const apiBase = import.meta.env.VITE_API_URL || "/api";
        const response = await fetch(`${apiBase.replace(/\/$/, "")}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd, ido: language }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 429 || response.status === 503) {
            throw new Error(
              "A IA está temporariamente sobrecarregada. Aguarde alguns segundos e tente novamente.",
            );
          }
          throw new Error(
            payload.error ||
              `O servidor respondeu com erro (${response.status}).`,
          );
        }
        if (typeof payload.resp !== "string" || !payload.resp.trim()) {
          throw new Error("A IA retornou uma resposta vazia. Tente novamente.");
        }
        const assistantReply = payload.resp.trim();
        setMessages((previous) => [
          ...previous,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantReply,
          },
        ]);
        speakAssistantText(assistantReply, () => {
          if (voiceSessionActiveRef.current) {
            voiceAwaitingResponseRef.current = false;
            startRecognitionRef.current?.();
          }
        });
      } catch (requestError) {
        const isConnectionError =
          requestError instanceof TypeError ||
          /failed to fetch|networkerror|fetch/i.test(requestError.message);
        setError(
          isConnectionError
            ? "Não foi possível conectar ao servidor. Verifique se o backend está rodando na porta 3000 e se este dispositivo está na mesma rede."
            : requestError.message,
        );
        if (voiceSessionActiveRef.current) {
          voiceAwaitingResponseRef.current = false;
          startRecognitionRef.current?.();
        }
      } finally {
        setIsSending(false);
        inputRef.current?.focus();
      }
    },
    [
      currentLevel.label,
      draft,
      isSending,
      language,
      level,
      messages,
      speakAssistantText,
    ],
  );

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  async function translatePortugueseText(event) {
    event.preventDefault();
    const text = translatorText.trim();
    if (!text || isTranslating) return;

    setIsTranslating(true);
    setTranslatorError("");
    setTranslatorResult("");

    try {
      const apiBase = import.meta.env.VITE_API_URL || "/api";
      const response = await fetch(`${apiBase.replace(/\/$/, "")}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: `Traduza do ${translationSource} para ${translationDestination} o texto abaixo. Retorne somente a tradução, sem introdução, explicações ou aspas. Preserve o sentido, o tom e a formatação.\n\n${text}`,
          ido: translationDestination,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error || `Falha ao traduzir (${response.status}).`,
        );
      }
      if (typeof payload.resp !== "string" || !payload.resp.trim()) {
        throw new Error("A tradução retornou vazia. Tente novamente.");
      }
      setTranslatorResult(payload.resp.trim());
      setTranslatorTarget(translationDirectionLabel);
    } catch (requestError) {
      setTranslatorError(requestError.message);
    } finally {
      setIsTranslating(false);
    }
  }

  async function toggleTranslation(message) {
    const existing = translations[message.id];
    if (existing) {
      setTranslations((previous) => ({
        ...previous,
        [message.id]: { ...previous[message.id], visible: !existing.visible },
      }));
      return;
    }

    const targetLanguage =
      message.role === "assistant" ? "Português brasileiro" : language;
    setTranslationLoadingId(message.id);
    setError("");

    try {
      const apiBase = import.meta.env.VITE_API_URL || "/api";
      const response = await fetch(`${apiBase.replace(/\/$/, "")}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: `Traduza o texto a seguir para ${targetLanguage}. Detecte o idioma de origem automaticamente. Retorne somente a tradução, sem explicações, comentários ou aspas. Preserve o sentido e a formatação.\n\n${message.content}`,
          ido: targetLanguage,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error || `Falha ao traduzir (${response.status}).`,
        );
      }
      if (typeof payload.resp !== "string" || !payload.resp.trim()) {
        throw new Error("A tradução retornou vazia. Tente novamente.");
      }
      setTranslations((previous) => ({
        ...previous,
        [message.id]: {
          text: payload.resp.trim(),
          targetLanguage,
          visible: true,
        },
      }));
    } catch (translationError) {
      setError(translationError.message);
    } finally {
      setTranslationLoadingId(null);
    }
  }

  async function toggleMessageFeedback(message) {
    const existing = messageFeedback[message.id];
    if (existing) {
      setMessageFeedback((previous) => ({
        ...previous,
        [message.id]: { ...previous[message.id], visible: !existing.visible },
      }));
      return;
    }

    setFeedbackLoadingId(message.id);
    setError("");

    try {
      const apiBase = import.meta.env.VITE_API_URL || "/api";
      const response = await fetch(`${apiBase.replace(/\/$/, "")}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: [
            `Analise a frase do aluno no contexto de prática de ${language}, nível ${level} (${currentLevel.label}).`,
            `Frase do aluno: "${message.content}"`,
            "Dê feedback linguístico em português brasileiro, com no máximo 3 itens curtos: (1) se houver erro relevante, mostre uma versão corrigida e natural; (2) explique brevemente o principal erro e como evitá-lo; (3) se a frase estiver correta, diga isso e ofereça uma alternativa natural opcional. Não invente erros nem reescreva o sentido da frase.",
          ].join("\n\n"),
          ido: "Português brasileiro",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error || `Falha ao gerar feedback (${response.status}).`,
        );
      }
      if (typeof payload.resp !== "string" || !payload.resp.trim()) {
        throw new Error("O feedback retornou vazio. Tente novamente.");
      }
      setMessageFeedback((previous) => ({
        ...previous,
        [message.id]: { text: payload.resp.trim(), visible: true },
      }));
    } catch (feedbackError) {
      setError(feedbackError.message);
    } finally {
      setFeedbackLoadingId(null);
    }
  }

  const finishVoiceTurn = useCallback(() => {
    if (voiceSilenceTimerRef.current) {
      clearTimeout(voiceSilenceTimerRef.current);
      voiceSilenceTimerRef.current = null;
    }

    const content = [
      voiceTurnTranscriptRef.current,
      recognitionSegmentRef.current,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (!content || voiceAwaitingResponseRef.current) return;

    voiceTurnTranscriptRef.current = "";
    recognitionSegmentRef.current = "";
    setDraft("");
    voiceAwaitingResponseRef.current = true;
    isListeningRef.current = false;
    setIsListening(false);

    try {
      recognitionRef.current?.stop();
    } catch {
      // The recognition session may already have stopped naturally.
    }

    sendMessageRef.current?.(content);
  }, []);

  useEffect(() => {
    finishVoiceTurnRef.current = finishVoiceTurn;
  }, [finishVoiceTurn]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = getSpeechLanguageCode(language);

    const startRecognition = () => {
      if (
        !voiceSessionActiveRef.current ||
        voiceAwaitingResponseRef.current ||
        isListeningRef.current
      ) {
        return;
      }

      try {
        recognition.start();
        isListeningRef.current = true;
        setIsListening(true);
      } catch {
        // Some browsers throw while restarting; onend will try again.
      }
    };
    startRecognitionRef.current = startRecognition;

    recognition.onresult = (event) => {
      recognitionSegmentRef.current = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();

      const completeDraft = [
        voiceTurnTranscriptRef.current,
        recognitionSegmentRef.current,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (completeDraft) setDraft(completeDraft);

      if (voiceSilenceTimerRef.current) {
        clearTimeout(voiceSilenceTimerRef.current);
      }
      voiceSilenceTimerRef.current = setTimeout(() => {
        finishVoiceTurnRef.current?.();
      }, 2200);
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);

      if (recognitionSegmentRef.current) {
        voiceTurnTranscriptRef.current = [
          voiceTurnTranscriptRef.current,
          recognitionSegmentRef.current,
        ]
          .filter(Boolean)
          .join(" ")
          .trim();
        recognitionSegmentRef.current = "";
        setDraft(voiceTurnTranscriptRef.current);
      }

      if (voiceSessionActiveRef.current && !voiceAwaitingResponseRef.current) {
        window.setTimeout(() => startRecognition(), 250);
        return;
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }

      voiceSessionActiveRef.current = false;
      setVoiceSessionActive(false);
      isListeningRef.current = false;
      setIsListening(false);
      setError("Não foi possível capturar a sua voz agora. Tente novamente.");
    };

    recognitionRef.current = recognition;

    return () => {
      if (voiceSilenceTimerRef.current) {
        clearTimeout(voiceSilenceTimerRef.current);
      }
      voiceSessionActiveRef.current = false;
      isListeningRef.current = false;
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      startRecognitionRef.current = null;
      recognition.stop();
    };
  }, [language]);

  function startNewChat() {
    setMessages([]);
    setError("");
    setDraft("");
    inputRef.current?.focus();
  }

  async function toggleVoiceMode() {
    if (!voiceSupported || !recognitionRef.current) {
      setError(
        "Reconhecimento de voz bloqueado em origem insegura. Use http://localhost ou HTTPS.",
      );
      return;
    }

    if (voiceSessionActiveRef.current) {
      voiceSessionActiveRef.current = false;
      voiceAwaitingResponseRef.current = false;
      setVoiceSessionActive(false);
      isListeningRef.current = false;
      setIsListening(false);
      finishVoiceTurnRef.current?.();
      recognitionRef.current.stop();
      return;
    }

    try {
      voiceTurnTranscriptRef.current = "";
      recognitionSegmentRef.current = "";
      voiceAwaitingResponseRef.current = false;
      setDraft("");
      recognitionRef.current.lang = getSpeechLanguageCode(language);
      voiceSessionActiveRef.current = true;
      setVoiceSessionActive(true);
      startRecognitionRef.current?.();
      isListeningRef.current = true;
      setIsListening(true);
      setError("");
    } catch {
      voiceSessionActiveRef.current = false;
      setVoiceSessionActive(false);
      isListeningRef.current = false;
      setIsListening(false);
      setError("Seu microfone já está em uso ou não foi permitido.");
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    sendMessage();
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="World, início">
          <span className="brand-mark">
            W<span>·</span>
          </span>
          <span>
            World<span className="brand-period">.</span>
          </span>
        </a>

        <button
          className="new-chat-button"
          onClick={startNewChat}
          type="button"
        >
          <span className="plus-icon">＋</span> Nova conversa
          <span className="shortcut">⌘ K</span>
        </button>

        <div className="sidebar-section-label">SUA PRÁTICA</div>
        <div className="session-card">
          <span className="session-icon">◉</span>
          <span>
            <strong>Conversa livre</strong>
            <small>Pratique no seu ritmo</small>
          </span>
          <span className="active-dot" />
        </div>

        <div className="sidebar-spacer" />
        <div className="sidebar-tip">
          <span className="tip-sparkle">✦</span>
          <p>
            <strong>Pequenos passos, grandes conversas.</strong>
            <br />
            Praticar um pouco todo dia faz diferença.
          </p>
        </div>
        <div className="profile-card">
          <div className="profile-avatar">A</div>
          <div className="profile-copy">
            <strong>Meu espaço</strong>
            <span>Aprendiz de idiomas</span>
          </div>
          <span className="profile-menu">···</span>
        </div>
      </aside>

      <section className="workspace" id="top">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">
              W<span>·</span>
            </span>{" "}
            World<span className="brand-period">.</span>
          </div>
          <div className="session-title">
            <span className="live-indicator" /> Prática de conversação
          </div>
          <div className="topbar-right">
            <span className="streak-icon">✧</span>
            <span>Seu espaço de prática</span>
          </div>
          <button
            className="game-open-button"
            type="button"
            onClick={() => setIsGameOpen(true)}
          >
            <span aria-hidden="true">✦</span> Jogo ao vivo
          </button>
          <button
            className="translator-open-button"
            type="button"
            onClick={() => setIsTranslatorOpen(true)}
            aria-label={`Traduzir do português para ${language}`}
            title={`Traduzir do português para ${language}`}
          >
            <span aria-hidden="true">文</span> Português → {language}
          </button>
        </header>

        {isGameOpen && (
          <GameHub
            onClose={() => setIsGameOpen(false)}
            language={language}
            level={level}
          />
        )}

        {isTranslatorOpen && (
          <div
            className="translator-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsTranslatorOpen(false);
              }
            }}
          >
            <section
              className="translator-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="translator-title"
            >
              <div className="translator-dialog-header">
                <div>
                  <span className="eyebrow">TRADUÇÃO RÁPIDA</span>
                  <h2 id="translator-title">{translationDirectionLabel}</h2>
                </div>
                <button
                  className="translator-close-button"
                  type="button"
                  onClick={() => setIsTranslatorOpen(false)}
                  aria-label="Fechar tradutor"
                >
                  ×
                </button>
              </div>
              <form onSubmit={translatePortugueseText}>
                <label htmlFor="translator-direction">
                  Direção da tradução
                </label>
                <select
                  className="translator-direction-select"
                  id="translator-direction"
                  value={translatorDirection}
                  onChange={(event) => {
                    setTranslatorDirection(event.target.value);
                    setTranslatorResult("");
                    setTranslatorError("");
                  }}
                >
                  <option value="pt-to-language">Português → {language}</option>
                  <option value="language-to-pt">{language} → Português</option>
                </select>
                <label htmlFor="translator-input">
                  {translatorDirection === "pt-to-language"
                    ? "Escreva o texto em português"
                    : `Escreva o texto em ${language}`}
                </label>
                <textarea
                  id="translator-input"
                  value={translatorText}
                  onChange={(event) => {
                    setTranslatorText(event.target.value);
                    setTranslatorResult("");
                    setTranslatorError("");
                  }}
                  placeholder={
                    translatorDirection === "pt-to-language"
                      ? "Digite uma palavra, frase ou texto em português..."
                      : `Digite uma palavra, frase ou texto em ${language}...`
                  }
                  rows={5}
                  maxLength={3000}
                  autoFocus
                />
                {translatorError && (
                  <p className="translator-error" role="alert">
                    {translatorError}
                  </p>
                )}
                <button
                  className="translator-submit-button"
                  type="submit"
                  disabled={!translatorText.trim() || isTranslating}
                >
                  {isTranslating
                    ? "Traduzindo…"
                    : `Traduzir · ${translationDirectionLabel}`}
                </button>
              </form>
              {translatorResult && (
                <div className="translator-result" aria-live="polite">
                  <span>TRADUÇÃO · {translatorTarget}</span>
                  <p>{translatorResult}</p>
                </div>
              )}
            </section>
          </div>
        )}

        <div className="chat-layout">
          <section
            className="conversation-panel"
            aria-label="Conversa com o tutor"
          >
            <div className="conversation-heading">
              <div>
                <div className="eyebrow">SEU TUTOR DE IDIOMAS</div>
                <h1>
                  Vamos conversar<span className="heading-dot">.</span>
                </h1>
                <p>Um espaço leve para praticar, errar e evoluir.</p>
              </div>
              <div className="conversation-status">
                <span className="status-dot" /> Tutor disponível
              </div>
            </div>

            <div
              className="messages"
              ref={listRef}
              aria-live="polite"
              aria-label="Mensagens"
            >
              {visibleMessages.map((message, index) => (
                <article
                  className={`message-row ${message.role}`}
                  key={message.id}
                >
                  {message.role === "assistant" && (
                    <div className="assistant-avatar" aria-hidden="true">
                      l<span>·</span>
                    </div>
                  )}
                  <div className="message-content-wrap">
                    {message.role === "assistant" && (
                      <div className="message-author">
                        Lia <span>· tutora</span>
                      </div>
                    )}
                    <div className="message-bubble">
                      {message.content
                        .split("\n")
                        .map((paragraph, paragraphIndex) =>
                          paragraph ? (
                            <p key={`${message.id}-${paragraphIndex}`}>
                              {paragraph}
                            </p>
                          ) : (
                            <div
                              className="paragraph-space"
                              key={`${message.id}-${paragraphIndex}`}
                            />
                          ),
                        )}
                    </div>
                    {translations[message.id]?.visible && (
                      <div className="translation-box">
                        <span>
                          Tradução · {translations[message.id].targetLanguage}
                        </span>
                        <p>{translations[message.id].text}</p>
                      </div>
                    )}
                    {messageFeedback[message.id]?.visible && (
                      <div className="message-feedback-box">
                        <span>Feedback da frase</span>
                        <p>{messageFeedback[message.id].text}</p>
                      </div>
                    )}
                    {message.role === "user" && (
                      <div className="message-tools user-message-tools">
                        <span>Você · agora</span>
                        <button
                          type="button"
                          onClick={() => toggleMessageFeedback(message)}
                          disabled={feedbackLoadingId === message.id}
                        >
                          {feedbackLoadingId === message.id
                            ? "Analisando..."
                            : messageFeedback[message.id]?.visible
                              ? "Ocultar feedback"
                              : "Feedback da frase"}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleTranslation(message)}
                          disabled={translationLoadingId === message.id}
                        >
                          {translationLoadingId === message.id
                            ? "Traduzindo..."
                            : translations[message.id]?.visible
                              ? "Ocultar tradução"
                              : "Traduzir para " + language}
                        </button>
                      </div>
                    )}
                    {message.role === "assistant" && index > 0 && (
                      <div className="message-tools">
                        <span>✦ Resposta do tutor</span>
                        <button
                          type="button"
                          onClick={() => toggleTranslation(message)}
                          disabled={translationLoadingId === message.id}
                        >
                          {translationLoadingId === message.id
                            ? "Traduzindo..."
                            : translations[message.id]?.visible
                              ? "Ocultar tradução"
                              : "Traduzir para português"}
                        </button>
                      </div>
                    )}
                  </div>
                  {message.role === "user" && (
                    <div className="user-avatar" aria-hidden="true">
                      A
                    </div>
                  )}
                </article>
              ))}
              {isSending && (
                <div
                  className="message-row assistant"
                  role="status"
                  aria-label="Lia está pensando"
                >
                  <div className="assistant-avatar">
                    l<span>·</span>
                  </div>
                  <div className="message-content-wrap">
                    <div className="message-author">
                      Lia <span>· tutora</span>
                    </div>
                    <div className="typing-bubble">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="error-banner" role="alert">
                <span>!</span>
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => setError("")}
                  aria-label="Fechar erro"
                >
                  ×
                </button>
              </div>
            )}

            {!messages.length && (
              <div className="suggestions" aria-label="Sugestões para começar">
                <span className="suggestions-label">POR ONDE COMEÇAR?</span>
                <div className="suggestion-list">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      className="suggestion-chip"
                      key={suggestion.label}
                      type="button"
                      onClick={() => sendMessage(suggestion.prompt)}
                      disabled={isSending}
                    >
                      <span>{suggestion.icon}</span>
                      {suggestion.label}
                      <b>↗</b>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form className="composer" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="message-input">
                Escreva sua mensagem
              </label>
              <textarea
                id="message-input"
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Escreva em ${language}...`}
                rows="1"
                maxLength="2000"
                disabled={isSending}
              />
              <div className="composer-footer">
                <span className="composer-hint">
                  <span>↵</span> enviar <span className="hint-divider">·</span>{" "}
                  shift + ↵ para nova linha
                </span>
                <div className="composer-actions">
                  <span className="character-count">{draft.length}/2000</span>
                  <div className="voice-toolbar">
                    <button
                      className={`voice-button ${isListening ? "active" : ""}`}
                      type="button"
                      onClick={toggleVoiceMode}
                      disabled={!voiceSupported || isSending}
                      aria-label={
                        voiceSessionActive
                          ? "Encerrar conversa por voz"
                          : "Iniciar conversa por voz"
                      }
                    >
                      {voiceSessionActive
                        ? isListening
                          ? "● Ouvindo · encerrar"
                          : isSending
                            ? "Lia respondendo"
                            : "Conversa por voz ativa"
                        : "🎙 Conversar por voz"}
                    </button>
                    <button
                      className={`voice-toggle ${voiceMode ? "on" : ""}`}
                      type="button"
                      onClick={() => setVoiceMode((current) => !current)}
                      aria-label={
                        voiceMode
                          ? "Desativar resposta em voz"
                          : "Ativar resposta em voz"
                      }
                    >
                      {voiceMode ? "Voz ativa" : "Voz pausada"}
                    </button>
                    <label className="voice-speed" htmlFor="voice-speed">
                      <span>Velocidade</span>
                      <input
                        id="voice-speed"
                        type="range"
                        min="0.5"
                        max="1.5"
                        step="0.1"
                        value={voiceSpeed}
                        onChange={(event) =>
                          setVoiceSpeed(Number(event.target.value))
                        }
                        aria-label="Velocidade da voz da IA"
                      />
                      <output>{voiceSpeed.toFixed(1)}x</output>
                    </label>
                  </div>
                  <button
                    className="send-button"
                    type="submit"
                    disabled={!draft.trim() || isSending}
                    aria-label="Enviar mensagem"
                  >
                    <span>Enviar</span>
                    <span className="send-arrow">↗</span>
                  </button>
                </div>
              </div>
            </form>
            <p className="privacy-note">
              <span>✦</span> Sua conversa fica salva neste dispositivo.
            </p>
          </section>

          <aside
            className="learning-panel"
            aria-label="Configurações da prática"
          >
            <div className="panel-header">
              <div>
                <span className="eyebrow">PERSONALIZE</span>
                <h2>Sua prática</h2>
              </div>
              <span className="panel-sparkle">✳</span>
            </div>

            <div className="setting-block">
              <label className="setting-label" htmlFor="language-select">
                <span className="setting-icon language-icon">文</span>Idioma
                para praticar
              </label>
              <div className="select-wrap">
                <span className="select-flag">{currentLanguage.flag}</span>
                <select
                  id="language-select"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                >
                  {LANGUAGES.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <span className="select-chevron">⌄</span>
              </div>
            </div>

            <div className="setting-block level-setting">
              <div className="setting-label">
                <span className="setting-icon level-icon">↗</span>
                <span>Nível de proficiência</span>
                <span
                  className="info-dot"
                  title="Escolha o nível que melhor descreve sua prática atual"
                >
                  i
                </span>
              </div>
              <div
                className="level-list"
                role="radiogroup"
                aria-label="Nível de proficiência"
              >
                {LEVELS.map((item) => (
                  <button
                    className={`level-option ${level === item.code ? "selected" : ""}`}
                    key={item.code}
                    type="button"
                    role="radio"
                    aria-checked={level === item.code}
                    onClick={() => setLevel(item.code)}
                  >
                    <span className="level-code">{item.code}</span>
                    <span className="level-text">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <span className="radio-mark" />
                  </button>
                ))}
              </div>
            </div>

            <div className="coach-card">
              <div className="coach-card-icon">✧</div>
              <div>
                <strong>Aprenda enquanto conversa</strong>
                <p>
                  Receba correções gentis e dicas práticas no fluxo do papo.
                </p>
              </div>
            </div>

            <div className="panel-footer">
              <span>FEITO PARA APRENDER</span>
              <span>
                com curiosidade <b>✳</b>
              </span>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

export default App;
