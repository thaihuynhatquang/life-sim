// Annual probability of dying, from the UN WPP single-age life table plus a wealth gradient.
//
// qx_person(age) = min(1, scale * qx_UN(age) * exp(-beta(age) * z))
//   z     = wealth score at birth, invNorm(percentile): -1.4 ~ poorest fifth, +1.4 ~ richest fifth.
//   beta  = how strongly wealth changes the risk of dying at that age: under 5 from each country's DHS
//           under-5 mortality by wealth quintile; older ages from the literature (see beta()).
//   scale = per country/sex constant, solved so the average over all wealth levels reproduces the UN
//           life expectancy exactly. Without it, survivors skew rich and e0 drifts upward.

import type { LifeTables, Sex } from './types.ts';
import { normalQuadrature } from './stats.ts';

/** Wealth gradient by age. childBeta is the country's DHS under-5 gradient (median 0.25: poorest fifth
 *  ~2x the richest). ASSUMPTION for older ages: 5-14 at 80% of the child gradient; working ages 0.25
 *  and 65+ 0.15, which give richest-vs-poorest-fifth life expectancy gaps of ~6-8 years in rich
 *  countries, the range found by Chetty et al. (2016) for the US and OECD (2017) by education. */
export function beta(age: number, childBeta: number): number {
  if (age < 5) return childBeta;
  if (age < 15) return 0.8 * childBeta;
  if (age < 65) return 0.25;
  return 0.15;
}

/** Wealth multiplier on the risk of dying, averaging exactly 1 over a birth cohort's wealth
 *  distribution (E[exp(-bZ)] = exp(b^2/2)). This keeps child mortality on the UN figure; `scale` then
 *  only corrects the small drift at older ages from survivors skewing richer. */
export function wealthK(age: number, z: number, childBeta: number): number {
  const b = beta(age, childBeta);
  return Math.exp(-b * z - b * b / 2);
}

/** The e0 correction only applies from age 5: child mortality is already exact (wealthK averages 1 at
 *  birth), and the drift it corrects comes from survivors skewing richer at older ages. */
const scaleAt = (scale: number, age: number) => (age < 5 ? 1 : scale);

export interface MortalityModel {
  qx: number[]; // UN qx, ages 0..100
  scale: number;
  e0Target: number;
  childBeta: number;
}

const QUAD = normalQuadrature(40);

function e0For(qx: number[], scale: number, z: number | null, childBeta = 0.25): number {
  let l = 1, e = 0;
  for (let a = 0; a < qx.length; a++) {
    const q = a === qx.length - 1 ? 1 : Math.min(1, scaleAt(scale, a) * qx[a] * (z === null ? 1 : wealthK(a, z, childBeta)));
    const d = l * q;
    e += a === qx.length - 1 ? l * 2.5 : l - (a === 0 ? 0.85 : 0.5) * d;
    l -= d;
  }
  return e;
}

/** Life expectancy averaged over the wealth distribution at birth. */
export function mixtureE0(qx: number[], scale: number, childBeta: number): number {
  let e = 0;
  for (let i = 0; i < QUAD.z.length; i++) e += QUAD.w[i] * e0For(qx, scale, QUAD.z[i], childBeta);
  return e;
}

export function buildMortalityModel(lt: LifeTables, iso3: string, sex: Sex, childBeta: number, year = '2023'): MortalityModel {
  const qx = lt[iso3][sex][year];
  const e0Target = e0For(qx, 1, null); // the UN table's own e0 (no wealth gradient)
  let lo = 0.3, hi = 3; // e0 decreases as scale grows
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (mixtureE0(qx, mid, childBeta) > e0Target) lo = mid; else hi = mid;
  }
  return { qx, scale: (lo + hi) / 2, e0Target, childBeta };
}

export function deathProb(m: MortalityModel, age: number, z: number): number {
  if (age >= m.qx.length - 1) return 1;
  return Math.min(1, scaleAt(m.scale, age) * m.qx[age] * wealthK(age, z, m.childBeta));
}
