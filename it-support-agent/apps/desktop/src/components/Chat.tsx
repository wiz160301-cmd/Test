import { useState } from "react";
import { useTranslation } from "react-i18next";
import { sendChatMessage, type ChatMessage, type SystemInfo } from "../lib/api";
import { evaluateScriptLocal, executeScript, type Decision } from "../lib/tauri";
import { ConfirmationModal } from "./ConfirmationModal";

interface Props {
  sessionId: string;
  systemInfo: SystemInfo | null;
  sessionActive: boolean;
}

interface PendingConfirmation {
  scriptId: string;
  decision: Decision;
}

export function Chat({ sessionId, systemInfo, sessionActive }: Props) {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestedScripts, setSuggestedScripts] = useState<string[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [lastOutput, setLastOutput] = useState<string | null>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !sessionActive) return;

    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    setSuggestedScripts([]);

    try {
      const res = await sendChatMessage(sessionId, i18n.resolvedLanguage ?? "en", next, systemInfo);
      setMessages([...next, { role: "assistant", content: res.reply }]);
      setSuggestedScripts(res.suggested_script_ids);
    } catch (err) {
      setMessages([
        ...next,
        { role: "assistant", content: `⚠️ ${(err as Error).message}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function requestExecution(scriptId: string) {
    const decision = await evaluateScriptLocal(scriptId, false);

    if (decision.allowed && !decision.requires_confirmation) {
      // Auto-approuvé : exécute directement, mais reste journalisé et visible.
      const result = await executeScript(sessionId, "ai", scriptId, false);
      setLastOutput(result.output);
      return;
    }

    setPendingConfirmation({ scriptId, decision });
  }

  async function confirmExecution() {
    if (!pendingConfirmation) return;
    const { scriptId } = pendingConfirmation;
    setPendingConfirmation(null);
    const result = await executeScript(sessionId, "user", scriptId, true);
    setLastOutput(result.output);
  }

  return (
    <section className="chat">
      <div className="chat__messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat__bubble chat__bubble--${m.role}`}>
            {m.content}
          </div>
        ))}
        {sending && <div className="chat__bubble chat__bubble--assistant">{t("chat.thinking")}</div>}
      </div>

      {suggestedScripts.length > 0 && (
        <div className="chat__suggestions">
          {suggestedScripts.map((scriptId) => (
            <button key={scriptId} type="button" onClick={() => requestExecution(scriptId)}>
              {scriptId}
            </button>
          ))}
        </div>
      )}

      {lastOutput && <p className="chat__output">{lastOutput}</p>}

      <form
        className="chat__input-row"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("chat.placeholder")}
          disabled={!sessionActive}
        />
        <button type="submit" disabled={!sessionActive || sending}>
          {t("chat.send")}
        </button>
      </form>

      {pendingConfirmation && (
        <ConfirmationModal
          scriptId={pendingConfirmation.scriptId}
          decision={pendingConfirmation.decision}
          onConfirm={confirmExecution}
          onDecline={() => setPendingConfirmation(null)}
        />
      )}
    </section>
  );
}
