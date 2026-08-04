import { useState } from "react";
import { LoginForm } from "./components/LoginForm";
import { SessionList } from "./components/SessionList";
import { SessionView } from "./components/SessionView";

export default function App() {
  const [technicianUserId, setTechnicianUserId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  if (!technicianUserId) {
    return <LoginForm onLoggedIn={setTechnicianUserId} />;
  }

  if (selectedSessionId) {
    return <SessionView sessionId={selectedSessionId} onClose={() => setSelectedSessionId(null)} />;
  }

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <h1>Dashboard technicien</h1>
      </header>
      <SessionList technicianUserId={technicianUserId} onSelect={setSelectedSessionId} />
    </div>
  );
}
