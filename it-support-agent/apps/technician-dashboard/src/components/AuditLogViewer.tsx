import { useEffect, useState } from "react";
import { getAuditTrail, type AuditEntry } from "../lib/api";

interface Props {
  sessionId: string;
}

/**
 * Affiche la chaîne d'audit hash-chaînée pour la session (brief section 5 :
 * logs horodatés et non modifiables). `chain_valid` permet au technicien de
 * détecter immédiatement une éventuelle altération.
 */
export function AuditLogViewer({ sessionId }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [chainValid, setChainValid] = useState(true);

  useEffect(() => {
    const refresh = async () => {
      try {
        const trail = await getAuditTrail(sessionId);
        setEntries(trail.entries);
        setChainValid(trail.chain_valid);
      } catch {
        // ignore, on retente au prochain tick
      }
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [sessionId]);

  return (
    <div className="audit-log-viewer">
      <h3>
        Journal d'audit{" "}
        <span className={chainValid ? "audit-log-viewer__valid" : "audit-log-viewer__invalid"}>
          {chainValid ? "intègre" : "ALTÉRATION DÉTECTÉE"}
        </span>
      </h3>
      <ul>
        {entries
          .slice()
          .reverse()
          .map((entry, i) => (
            <li key={i}>
              <span className="audit-log-viewer__ts">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              <span className="audit-log-viewer__actor">{entry.actor}</span>
              <span className="audit-log-viewer__action">{entry.action}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
