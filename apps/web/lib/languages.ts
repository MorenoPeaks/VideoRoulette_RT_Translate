/**
 * Languages the user can choose to HEAR.
 *
 * `adaptive: true` marks the 13 output languages supported by the adaptive
 * engine (gpt-realtime-translate). The fixed-voice engine (gpt-realtime-2
 * as interpreter) speaks all of them, so languages with `adaptive: false`
 * force the fixed-voice engine. Input language is always auto-detected.
 */
export const OUTPUT_LANGUAGES: {
  code: string;
  label: string;
  flag: string;
  adaptive: boolean;
}[] = [
  { code: "en", label: "English", flag: "🇬🇧", adaptive: true },
  { code: "es", label: "Español", flag: "🇪🇸", adaptive: true },
  { code: "fr", label: "Français", flag: "🇫🇷", adaptive: true },
  { code: "de", label: "Deutsch", flag: "🇩🇪", adaptive: true },
  { code: "it", label: "Italiano", flag: "🇮🇹", adaptive: true },
  { code: "pt", label: "Português", flag: "🇵🇹", adaptive: true },
  { code: "ru", label: "Русский", flag: "🇷🇺", adaptive: true },
  { code: "uk", label: "Українська", flag: "🇺🇦", adaptive: false },
  { code: "pl", label: "Polski", flag: "🇵🇱", adaptive: false },
  { code: "cs", label: "Čeština", flag: "🇨🇿", adaptive: false },
  { code: "sk", label: "Slovenčina", flag: "🇸🇰", adaptive: false },
  { code: "ro", label: "Română", flag: "🇷🇴", adaptive: false },
  { code: "hu", label: "Magyar", flag: "🇭🇺", adaptive: false },
  { code: "bg", label: "Български", flag: "🇧🇬", adaptive: false },
  { code: "hr", label: "Hrvatski", flag: "🇭🇷", adaptive: false },
  { code: "sr", label: "Srpski", flag: "🇷🇸", adaptive: false },
  { code: "el", label: "Ελληνικά", flag: "🇬🇷", adaptive: false },
  { code: "tr", label: "Türkçe", flag: "🇹🇷", adaptive: false },
  { code: "nl", label: "Nederlands", flag: "🇳🇱", adaptive: false },
  { code: "ar", label: "العربية", flag: "🇸🇦", adaptive: false },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳", adaptive: true },
  { code: "id", label: "Bahasa Indonesia", flag: "🇮🇩", adaptive: true },
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳", adaptive: true },
  { code: "zh", label: "中文", flag: "🇨🇳", adaptive: true },
  { code: "ja", label: "日本語", flag: "🇯🇵", adaptive: true },
  { code: "ko", label: "한국어", flag: "🇰🇷", adaptive: true },
];

export function languageLabel(code: string): string {
  const lang = OUTPUT_LANGUAGES.find((l) => l.code === code);
  return lang ? `${lang.flag} ${lang.label}` : code;
}

/** Whether the adaptive engine can output this language. */
export function supportsAdaptive(code: string): boolean {
  return OUTPUT_LANGUAGES.find((l) => l.code === code)?.adaptive ?? false;
}
