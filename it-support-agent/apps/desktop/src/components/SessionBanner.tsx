import { useTranslation } from "react-i18next";

interface Props {
  active: boolean;
  onStop: () => void;
}

/**
 * Bandeau non négociable (brief section 5) : toujours visible tant qu'une
 * session est active, avec un bouton d'arrêt toujours accessible.
 */
export function SessionBanner({ active, onStop }: Props) {
  const { t } = useTranslation();

  if (!active) {
    return null;
  }

  return (
    <div className="session-banner" role="status">
      <span className="session-banner__dot" aria-hidden="true" />
      <span>{t("session.banner")}</span>
      <button type="button" className="session-banner__stop" onClick={onStop}>
        {t("session.stop")}
      </button>
    </div>
  );
}
