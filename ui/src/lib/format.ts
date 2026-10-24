import { language, t } from "./i18n";

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A number in the UI language's digits and separators. */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  const key = `${language()} ${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(language(), options);
    numberFormats.set(key, format);
  }
  return format.format(value);
}

const TWO_DIGITS: Intl.NumberFormatOptions = { minimumIntegerDigits: 2 };

/** Game clock text in whole seconds: `42`, then `3:07` after a minute. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return formatNumber(totalSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${formatNumber(minutes)}:${formatNumber(totalSeconds % 60, TWO_DIGITS)}`;
}

/** Duration for tables and results: `12.34 s` or `3 m 07 s`. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) {
    const n = formatNumber(ms / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return t("format.seconds", { n });
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return t("format.minutesSeconds", {
    m: formatNumber(minutes),
    s: formatNumber(seconds, TWO_DIGITS),
  });
}

/** A percentage given from 0 to 100, rounded to a whole number. */
export function formatPercent(value: number): string {
  // Round first: 42.5 / 100 lands just under 0.425 as a double and would round down.
  return formatNumber(Math.round(value) / 100, { style: "percent", maximumFractionDigits: 0 });
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

export function formatDate(unixMs: number): string {
  let format = dateFormats.get(language());
  if (!format) {
    format = new Intl.DateTimeFormat(language(), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    dateFormats.set(language(), format);
  }
  return format.format(unixMs);
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/** A date with the time of day, such as `Nov 4, 2026, 3:07 PM`. */
export function formatDateTime(unixMs: number): string {
  let format = dateTimeFormats.get(language());
  if (!format) {
    format = new Intl.DateTimeFormat(language(), { dateStyle: "medium", timeStyle: "short" });
    dateTimeFormats.set(language(), format);
  }
  return format.format(unixMs);
}
