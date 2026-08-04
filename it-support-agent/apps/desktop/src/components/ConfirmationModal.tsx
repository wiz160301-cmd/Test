import { useTranslation } from "react-i18next";
import type { Decision } from "../lib/tauri";

interface Props {
  scriptId: string;
  decision: Decision;
  onConfirm: () => void;
  onDecline: () => void;
}

/**
 * Modale de confirmation obligatoire (brief section 5) pour toute action qui
 * n'est pas auto-approuvée. Affiche explicitement le niveau de risque et la
 * réversibilité pour que l'utilisateur prenne une décision informée — jamais
 * de case "ne plus demander" pour les actions à risque.
 */
export function ConfirmationModal({ scriptId, decision, onConfirm, onDecline }: Props) {
  const { t } = useTranslation();

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{t("confirm.title")}</h2>
        <p className="modal__script-id">{scriptId}</p>
        <p className="modal__reason">{decision.reason}</p>

        <dl>
          <dt>{t("confirm.riskLevel")}</dt>
          <dd className={`risk risk--${(decision.risk_level ?? "destructive").toLowerCase()}`}>
            {decision.risk_level ?? "Destructive"}
          </dd>

          <dt>{t("confirm.reversible")}</dt>
          <dd>
            {decision.reversible ? t("confirm.reversible.yes") : t("confirm.reversible.no")}
          </dd>
        </dl>

        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={onDecline}>
            {t("confirm.decline")}
          </button>
          <button type="button" className="btn btn--primary" onClick={onConfirm}>
            {t("confirm.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
