import fr from "./locales/fr.json";

type LocaleDict = Record<string, string>;
const dicts: Record<string, LocaleDict> = { fr };

const LANG_KEY = "pi-studio.lang";

export function getLang(): string {
  return localStorage.getItem(LANG_KEY) ?? "fr";
}

export function setLang(lang: string): void {
  localStorage.setItem(LANG_KEY, lang);
}

export function t(key: string): string {
  const dict = dicts[getLang()] ?? dicts.fr;
  return dict[key] ?? dicts.fr[key] ?? key;
}
