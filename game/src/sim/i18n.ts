// Every piece of player-facing text exists in Vietnamese and English.

export type Lang = 'vi' | 'en';
export interface T { vi: string; en: string }

export const t = (vi: string, en: string): T => ({ vi, en });

// Building a number formatter is slow (toLocaleString makes a new one on every call): keep them.
const FORMATS = new Map<string, Intl.NumberFormat>();
export function fmt(lang: Lang, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = lang + JSON.stringify(opts);
  let f = FORMATS.get(key);
  if (!f) FORMATS.set(key, f = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', opts));
  return f;
}

export function num(x: number, lang: Lang, digits = 0): string {
  return fmt(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(x);
}

/** "1 in 7" style odds, easier to feel than percentages. */
export function oneIn(p: number, lang: Lang): string {
  const n = Math.max(1, Math.round(1 / Math.max(p, 1e-9)));
  return lang === 'vi' ? `1 trên ${num(n, lang)}` : `1 in ${num(n, lang)}`;
}
