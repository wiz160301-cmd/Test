import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SessionBanner } from "./components/SessionBanner";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { SystemInfoPanel } from "./components/SystemInfoPanel";
import { Chat } from "./components/Chat";
import { RemoteControlPanel } from "./components/RemoteControlPanel";
import { collectSystemInfo, appendAuditEntry } from "./lib/tauri";
import { createSession, endSessionOnBackend, type SystemInfo } from "./lib/api";

export default function App() {
  const { t } = useTranslation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(true);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    collectSystemInfo().then(setSystemInfo).catch(console.error);

    createSession()
      .then((session) => {
        setSessionId(session.id);
        appendAuditEntry(session.id, "user", "session_started", {}).catch(console.error);
      })
      .catch(console.error);
  }, []);

  function stopSession() {
    setSessionActive(false);
    if (!sessionId) return;
    appendAuditEntry(sessionId, "user", "session_stopped", {}).catch(console.error);
    endSessionOnBackend(sessionId).catch(console.error);
  }

  return (
    <div className="app">
      <SessionBanner active={sessionActive} onStop={stopSession} />

      <header className="app__header">
        <h1>{t("app.title")}</h1>
        <LanguageSwitcher />
      </header>

      {sessionId && (
        <main className="app__body">
          <div className="app__main-column">
            <Chat sessionId={sessionId} systemInfo={systemInfo} sessionActive={sessionActive} />
            {sessionActive && <RemoteControlPanel sessionId={sessionId} />}
          </div>
          <SystemInfoPanel systemInfo={systemInfo} />
        </main>
      )}
    </div>
  );
}
