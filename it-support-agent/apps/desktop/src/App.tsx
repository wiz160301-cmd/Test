import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SessionBanner } from "./components/SessionBanner";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { SystemInfoPanel } from "./components/SystemInfoPanel";
import { Chat } from "./components/Chat";
import { collectSystemInfo, appendAuditEntry } from "./lib/tauri";
import type { SystemInfo } from "./lib/api";

function createSessionId(): string {
  return crypto.randomUUID();
}

export default function App() {
  const { t } = useTranslation();
  const [sessionId] = useState(createSessionId);
  const [sessionActive, setSessionActive] = useState(true);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    collectSystemInfo().then(setSystemInfo).catch(console.error);
    appendAuditEntry(sessionId, "user", "session_started", {}).catch(console.error);
  }, [sessionId]);

  function stopSession() {
    setSessionActive(false);
    appendAuditEntry(sessionId, "user", "session_stopped", {}).catch(console.error);
  }

  return (
    <div className="app">
      <SessionBanner active={sessionActive} onStop={stopSession} />

      <header className="app__header">
        <h1>{t("app.title")}</h1>
        <LanguageSwitcher />
      </header>

      <main className="app__body">
        <Chat sessionId={sessionId} systemInfo={systemInfo} sessionActive={sessionActive} />
        <SystemInfoPanel systemInfo={systemInfo} />
      </main>
    </div>
  );
}
