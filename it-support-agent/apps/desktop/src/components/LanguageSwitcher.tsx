import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n";

const LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <label className="language-switcher">
      {t("language.label")}
      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {LABELS[lang]}
          </option>
        ))}
      </select>
    </label>
  );
}
