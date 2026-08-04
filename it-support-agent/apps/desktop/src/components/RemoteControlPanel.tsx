import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-shell";
import {
  createCheckoutSession,
  getSession,
  giveRemoteControlConsent,
  type RemoteSession,
} from "../lib/api";
import { RemoteControlClient } from "../lib/webrtc";

interface Props {
  sessionId: string;
}

type Phase = "idle" | "technician_available" | "awaiting_payment" | "awaiting_consent" | "streaming" | "ended";

/**
 * Flux complet du remote control réel côté client (brief section 5) :
 * 1. Un technicien "claim" la session côté dashboard -> on détecte
 *    `technician_user_id` renseigné pendant que la session est encore
 *    "pending" et on propose l'intervention payante.
 * 2. Paiement Stripe (ouvert dans le navigateur système, pas dans la
 *    webview — on ne veut jamais saisir une carte bancaire dans l'app).
 * 3. Consentement explicite affiché à l'écran, jamais automatique même
 *    après paiement.
 * 4. Une fois consenti, la session passe ACTIVE côté backend, ce qui
 *    autorise le WebSocket de signaling et démarre le partage d'écran.
 */
export function RemoteControlPanel({ sessionId }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<RemoteControlClient | null>(null);

  useEffect(() => {
    if (phase !== "idle") return;

    const interval = setInterval(async () => {
      try {
        const s = await getSession(sessionId);
        setSession(s);
        if (s.status === "pending" && s.technician_user_id && !s.paid) {
          setPhase("technician_available");
        } else if (s.status === "pending" && s.technician_user_id && s.paid) {
          setPhase("awaiting_consent");
        }
      } catch {
        // Le backend n'est peut-être pas joignable — on retentera au prochain tick.
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [phase, sessionId]);

  async function payForIntervention() {
    try {
      const checkout = await createCheckoutSession(sessionId);
      await open(checkout.checkout_url);
      setPhase("awaiting_payment");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function refreshPaymentStatus() {
    const s = await getSession(sessionId);
    setSession(s);
    if (s.paid) {
      setPhase("awaiting_consent");
    }
  }

  async function authorizeRemoteControl() {
    try {
      await giveRemoteControlConsent(sessionId);
      const client = new RemoteControlClient(sessionId);
      client.onStateChange = (state) => {
        if (state === "streaming") setPhase("streaming");
        if (state === "ended") setPhase("ended");
      };
      clientRef.current = client;
      await client.start();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function stopRemoteControl() {
    await clientRef.current?.stop();
    setPhase("ended");
  }

  if (phase === "idle") return null;

  return (
    <div className="remote-control-panel">
      <h3>{t("remoteControl.title")}</h3>
      {error && <p className="remote-control-panel__error">{error}</p>}

      {phase === "technician_available" && (
        <>
          <p>{t("remoteControl.technicianAvailable")}</p>
          <button type="button" className="btn btn--primary" onClick={payForIntervention}>
            {t("remoteControl.payAndAuthorize")}
          </button>
        </>
      )}

      {phase === "awaiting_payment" && (
        <>
          <p>{t("remoteControl.waitingForPayment")}</p>
          <button type="button" className="btn btn--secondary" onClick={refreshPaymentStatus}>
            {t("remoteControl.checkPaymentStatus")}
          </button>
        </>
      )}

      {phase === "awaiting_consent" && (
        <>
          <h4>{t("remoteControl.consentTitle")}</h4>
          <p>{t("remoteControl.consentText")}</p>
          <div className="modal__actions">
            <button type="button" className="btn btn--secondary" onClick={() => setPhase("idle")}>
              {t("remoteControl.decline")}
            </button>
            <button type="button" className="btn btn--primary" onClick={authorizeRemoteControl}>
              {t("remoteControl.authorize")}
            </button>
          </div>
        </>
      )}

      {phase === "streaming" && (
        <>
          <p className="remote-control-panel__streaming">{t("remoteControl.streaming")}</p>
          <button type="button" className="btn btn--secondary" onClick={stopRemoteControl}>
            {t("remoteControl.stop")}
          </button>
        </>
      )}

      {phase === "ended" && <p>{t("remoteControl.ended")}</p>}

      {session && <p className="remote-control-panel__debug">session: {session.status}</p>}
    </div>
  );
}
