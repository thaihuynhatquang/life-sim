// Given names for the people in a life, from the country's most common names (data/pipeline/extract_names.py).
//
// Names are picked with a hash of the person's own fixed random values, not with the shared random
// stream, so naming never changes how a life unfolds (validation and saved lives stay the same).

import type { Country, Sex } from '../model/types.ts';

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A province (state, region) weighted by the population of its towns and cities (urban) or of its
 *  smaller places (rural). Chosen by hash like names, so it never changes how a life unfolds. */
export function pickProvince(c: Country, urban: boolean, key: string): string {
  const list = (urban ? c.provinces?.urban : c.provinces?.rural) ?? c.provinces?.urban ?? [];
  if (!list.length) return '';
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = (hash(key) / 4294967296) * total;
  for (const [name, w] of list) { x -= w; if (x <= 0) return name; }
  return list[list.length - 1][0];
}

/** A common name for this sex in this country, avoiding names already taken in the family. */
export function pickName(c: Country, sex: Sex, key: string, taken: Iterable<string | undefined> = []): string {
  const list = c.names?.[sex] ?? [];
  if (!list.length) return '';
  const used = new Set(taken);
  // Earlier names in the lists are more common: favour them (weight 1/(rank+3)).
  const weights = list.map((_, i) => 1 / (i + 3));
  const total = weights.reduce((a, b) => a + b, 0);
  for (let attempt = 0; attempt < 8; attempt++) {
    let x = (hash(`${key}#${attempt}`) / 4294967296) * total;
    for (let i = 0; i < list.length; i++) {
      x -= weights[i];
      if (x <= 0) { if (!used.has(list[i])) return list[i]; break; }
    }
  }
  return list.find(n => !used.has(n)) ?? list[hash(key) % list.length];
}
