// Cause of death, given that a person dies at this age: drawn from the WHO Global Health Estimates mix
// of causes for their country, sex and 5-year age group.
//
// Some causes can only kill people in a particular situation: maternal deaths only women who gave birth
// that year, HIV deaths only people living with HIV. For those, the cause's part of the age's death
// rate (q * share) is moved onto the people in that situation (divided by how common it is at that
// age), and the rest of the death rate applies to everyone. Averaged over everyone this is exactly the
// UN death rate, and deaths from these causes match WHO's shares.

import type { Sex } from '../model/types.ts';
import type { CountryModel } from '../model/world.ts';
import type { Rng } from '../model/rng.ts';
import type { T } from './i18n.ts';

export interface CauseData {
  source: string;
  ages: number[]; // start of each age group
  causes: { key: string; vi: string; en: string; kind: string }[];
  data: Record<string, Record<Sex, Record<string, number>[]>>;
}

export interface Cause { key: string; kind: string; text: T; share: number }

export function ageGroup(cd: CauseData, age: number): number {
  let g = 0;
  while (g + 1 < cd.ages.length && age >= cd.ages[g + 1]) g++;
  return g;
}

/** Share of deaths in this country/sex/age cell from causes matching `which`. */
export function causeShare(cd: CauseData, m: CountryModel, sex: Sex, age: number, which: (c: CauseData['causes'][number]) => boolean): number {
  const g = ageGroup(cd, age);
  let memo = SHARE_MEMO.get(m);
  if (!memo) SHARE_MEMO.set(m, memo = new Map());
  const key = `${sex}${g}${which.name}`;
  let v = memo.get(key);
  if (v === undefined) {
    const shares = cd.data[m.c.id]?.[sex]?.[g] ?? {};
    v = Object.entries(shares).reduce((a, [i, s]) => a + (which(cd.causes[Number(i)]) ? s : 0), 0);
    memo.set(key, v);
  }
  return v;
}
const SHARE_MEMO = new WeakMap<CountryModel, Map<string, number>>();
export const isMaternal = (c: CauseData['causes'][number]) => c.kind === 'maternal';
export const isHiv = (c: CauseData['causes'][number]) => c.key === 'hiv';
export const isDiabetes = (c: CauseData['causes'][number]) => c.key === 'diabetes';
export const isHypertension = (c: CauseData['causes'][number]) => c.key === 'hypertension';
export const isAlcohol = (c: CauseData['causes'][number]) => c.key === 'alcohol';

/** Pick the cause of a death. `special` lists causes only some people can die of (maternal: gave
 *  birth this year; HIV: infected), each with the chance this death is from it; those causes are
 *  otherwise excluded and the rest are drawn in WHO's proportions. */
export function causeOfDeath(cd: CauseData, m: CountryModel, sex: Sex, age: number,
  special: { test: (c: CauseData['causes'][number]) => boolean; p: number }[], rng: Rng): Cause {
  const shares = cd.data[m.c.id]?.[sex]?.[ageGroup(cd, age)] ?? {};
  const entries = Object.entries(shares).map(([i, s]) => [Number(i), s] as [number, number]);
  let x = rng();
  for (const sp of special) {
    const own = entries.filter(([i]) => sp.test(cd.causes[i]));
    if (x < sp.p && own.length) return pick(cd, own, rng);
    x -= sp.p;
  }
  return pick(cd, entries.filter(([i]) => !special.some(sp => sp.test(cd.causes[i]))), rng);
}

function pick(cd: CauseData, entries: [number, number][], rng: Rng): Cause {
  const total = entries.reduce((a, [, s]) => a + s, 0);
  let x = rng() * total;
  let chosen = entries[entries.length - 1];
  for (const e of entries) { x -= e[1]; if (x <= 0) { chosen = e; break; } }
  if (!chosen) return { key: 'unknown', kind: 'ncd', text: { vi: 'bệnh', en: 'illness' }, share: 0 };
  const c = cd.causes[chosen[0]];
  return { key: c.key, kind: c.kind, text: { vi: c.vi, en: c.en }, share: chosen[1] };
}
