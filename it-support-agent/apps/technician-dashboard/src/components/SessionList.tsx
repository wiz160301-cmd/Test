import { useEffect, useState } from "react";
import { claimSession, listActiveSessions, listPendingSessions, type RemoteSession } from "../lib/api";

interface Props {
  technicianUserId: string;
  onSelect: (sessionId: string) => void;
}

/**
 * Supervision multi-session (brief MVP #6) : le technicien voit à la fois
 * les demandes en attente (à prendre en charge) et ses sessions déjà
 * actives, rafraîchies périodiquement.
 */
export function SessionList({ technicianUserId, onSelect }: Props) {
  const [pending, setPending] = useState<RemoteSession[]>([]);
  const [active, setActive] = useState<RemoteSession[]>([]);

  useEffect(() => {
    const refresh = async () => {
      try {
        const [p, a] = await Promise.all([
          listPendingSessions(),
          listActiveSessions(technicianUserId),
        ]);
        setPending(p.filter((s) => !s.technician_user_id));
        setActive(a);
      } catch {
        // Backend momentanément injoignable — nouvelle tentative au prochain tick.
      }
    };
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [technicianUserId]);

  async function handleClaim(sessionId: string) {
    await claimSession(sessionId, technicianUserId);
    onSelect(sessionId);
  }

  return (
    <div className="session-list">
      <section>
        <h2>Sessions en attente ({pending.length})</h2>
        <ul>
          {pending.map((s) => (
            <li key={s.id}>
              <span className="session-list__id">{s.id.slice(0, 8)}</span>
              <button type="button" onClick={() => handleClaim(s.id)}>
                Prendre en charge
              </button>
            </li>
          ))}
          {pending.length === 0 && <li className="session-list__empty">Aucune session en attente.</li>}
        </ul>
      </section>

      <section>
        <h2>Mes sessions actives ({active.length})</h2>
        <ul>
          {active.map((s) => (
            <li key={s.id}>
              <span className="session-list__id">{s.id.slice(0, 8)}</span>
              <button type="button" onClick={() => onSelect(s.id)}>
                Ouvrir
              </button>
            </li>
          ))}
          {active.length === 0 && <li className="session-list__empty">Aucune session active.</li>}
        </ul>
      </section>
    </div>
  );
}
