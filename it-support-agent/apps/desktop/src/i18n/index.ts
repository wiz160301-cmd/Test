import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";

export const SUPPORTED_LANGUAGES = ["en", "fr", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      es: { translation: es },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false },
    detection: {
      // navigator.language reflects the OS locale in a Tauri webview since
      // there is no browser override; this is the auto-detection path from
      // the brief ("langue OS ou choix utilisateur"). The user's explicit
      // pick is persisted and takes priority on next launch.
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "it-support-agent-lang",
    },
  });

export default i18n;
