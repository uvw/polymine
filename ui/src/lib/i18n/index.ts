import en from "./en.json";

/** Every UI string has a key in `en.json`, the baseline locale. */
export type MessageKey = keyof typeof en;
export type MessageParams = Record<string, string | number>;

/** Every `<code>.json` beside this file is a locale. */
const LOCALES = import.meta.glob<Record<string, string>>("./*.json", {
  eager: true,
  import: "default",
});

/** Locale codes that have a message file, such as `en` or `pt-BR`. */
export const LANGUAGES: readonly string[] = Object.keys(LOCALES)
  .map((path) => path.slice(2, -".json".length))
  .sort();

let current = "en";
let messages: Record<string, string> = en;

/**
 * The locale for a `language` setting: the code itself, or for `system` the
 * first of the browser's preferences with a message file, by full tag and then
 * by base language. English when nothing matches.
 */
export function resolveLanguage(
  setting: string,
  preferred: readonly string[] = navigator.languages,
): string {
  const wanted = setting === "system" ? preferred : [setting];
  const find = (code: string) => LANGUAGES.find((l) => l.toLowerCase() === code.toLowerCase());
  for (const tag of wanted) {
    const match = find(tag) ?? find(tag.split("-")[0] ?? "");
    if (match) return match;
  }
  return "en";
}

/**
 * Switches the UI strings to `code`. Keys a locale lacks fall back to
 * English. Strings already on screen keep their language, so this runs
 * before the app mounts, and a change reloads the window.
 */
export function setLanguage(code: string): void {
  current = LANGUAGES.includes(code) ? code : "en";
  messages = { ...en, ...LOCALES[`./${current}.json`] };
  document.documentElement.lang = current;
  document.documentElement.dir = direction(current);
}

/** Scripts written right to left, as `Intl.Locale` names them. */
const RTL_SCRIPTS = new Set(["Adlm", "Arab", "Hebr", "Nkoo", "Rohg", "Syrc", "Thaa"]);

/** Text direction for a locale code, from its likely script. */
export function direction(code: string): "ltr" | "rtl" {
  const script = new Intl.Locale(code).maximize().script;
  return script && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
}

export function language(): string {
  return current;
}

/** A locale's name for itself, from its own file. */
export function languageName(code: string): string {
  return LOCALES[`./${code}.json`]?.["language.name"] ?? code;
}

/** Looks up a UI string and fills `{name}` placeholders from `params`. */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = messages[key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
