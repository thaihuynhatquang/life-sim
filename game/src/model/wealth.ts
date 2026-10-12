// Net personal wealth per adult: quantile function from the World Inequality Database thresholds, with a
// Pareto tail anchored on the number of billionaires (Forbes).
//
// WID gives the wealth threshold at 22 percentiles from the bottom to the top 0.001% (2021 PPP $ and
// market USD). Only the knots up to the top 0.01% are used: beyond that WID's equal-split of couples'
// wealth makes its thresholds incompatible with Forbes' list of individuals (the US top 0.001% alone,
// 2,600 adults, is above $1.3bn, against 989 US billionaires). Between points the log of wealth is interpolated linearly in the quantile (linear in
// value where wealth is zero or negative, i.e. debt). Beyond the top 0.001%, wealth follows a Pareto law:
// log wealth is linear in log(1 - q). The tail is anchored on the number of billionaires: Forbes counts
// N people with at least $1bn among A adults, so the threshold for $1bn sits at 1 - q = N / A.
// If the country has no billionaires the tail continues with the slope of its top 0.01%-0.001%.

import type { Country } from './types.ts';

const BILLION = 1e9;
const TAIL_START = 0.9999; // the Pareto tail starts at the top 0.01%

export interface WealthModel {
  q: number[]; // quantiles of the knots, ascending (the first knots may be debt)
  v: number[]; // 2021 PPP $ at each knot
  tailSlope: number; // d ln(wealth) / d ln(1/(1-q)) beyond the last knot
  maxQ: number; // the richest adult: 1 - 1/adults
  billionPpp?: number; // 2021 PPP $ equivalent of $1bn (market USD), if there are billionaires
}

const cache = new WeakMap<Country, WealthModel>();

export function wealthModel(c: Country): WealthModel {
  let m = cache.get(c);
  if (m) return m;
  const w = c.wealth, keep = w.grid.filter(g => g <= TAIL_START + 1e-9).length;
  const q = w.grid.slice(0, keep), v = w.ppp.slice(0, keep);
  // Make thresholds non-decreasing (rounding in the source can repeat values).
  for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1]) v[i] = v[i - 1];
  const n = q.length, qLast = q[n - 1], vLast = v[n - 1];
  const x = (qq: number) => Math.log(1 / (1 - qq));
  // Slope from the top of the grid (top 0.01% -> top 0.001%).
  const slopeGrid = Math.log(v[n - 1] / Math.max(1, v[n - 3])) / Math.max(1e-9, x(q[n - 1]) - x(q[n - 3]));
  let tailSlope = Math.min(2.5, Math.max(0.4, slopeGrid));
  let billionPpp: number | undefined;
  if (w.billionaires > 0) {
    // $1bn in 2021 PPP dollars, using the same market-to-PPP ratio as the top of the distribution.
    billionPpp = BILLION * (w.ppp[keep - 1] / w.usd[keep - 1]);
    const qb = 1 - w.billionaires / w.adults;
    if (qb > qLast && billionPpp > vLast) tailSlope = Math.log(billionPpp / vLast) / (x(qb) - x(qLast));
  }
  m = { q, v, tailSlope, maxQ: 1 - 1 / w.adults, billionPpp };
  cache.set(c, m);
  return m;
}

/** Wealth (2021 PPP $) of the adult at quantile u of the country's distribution (0 < u < 1). */
export function wealthAt(c: Country, u: number): number {
  const m = wealthModel(c), { q, v } = m, n = q.length;
  const uu = Math.min(u, m.maxQ);
  if (uu >= q[n - 1]) return v[n - 1] * Math.exp(m.tailSlope * (Math.log(1 / (1 - uu)) - Math.log(1 / (1 - q[n - 1]))));
  let i = 1;
  while (i < n - 1 && q[i] < uu) i++;
  const f = (uu - q[i - 1]) / Math.max(1e-12, q[i] - q[i - 1]);
  const a = v[i - 1], b = v[i];
  if (a > 0 && b > 0) return Math.exp(Math.log(a) + f * (Math.log(b) - Math.log(a)));
  return a + f * (b - a);
}

/** Quantile of a wealth level (inverse of wealthAt), by bisection. */
export function wealthRank(c: Country, ppp: number): number {
  let lo = 0, hi = wealthModel(c).maxQ;
  if (ppp <= wealthAt(c, lo)) return 0;
  if (ppp >= wealthAt(c, hi)) return hi;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (wealthAt(c, mid) < ppp) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Chance that an adult is a billionaire (Forbes): from the anchored tail. */
export function billionaireShare(c: Country): number {
  const m = wealthModel(c);
  return m.billionPpp ? 1 - wealthRank(c, m.billionPpp) : 0;
}

/** Share of adult life that wealth is held over, by age: relative mean net worth by age. ASSUMPTION
 *  (life-cycle shape from household surveys such as the US Survey of Consumer Finances and the ECB
 *  Household Finance and Consumption Survey): people accumulate until retirement and draw down a little
 *  after. Normalised so the average over a country's adults (weighted by survival) is 1. */
const AGE_PROFILE: [number, number][] = [[20, 0.15], [30, 0.45], [40, 0.9], [50, 1.4], [60, 1.7], [70, 1.7], [80, 1.4], [100, 1.1]];

export function ageProfile(age: number): number {
  for (let i = 1; i < AGE_PROFILE.length; i++) {
    const [a0, k0] = AGE_PROFILE[i - 1], [a1, k1] = AGE_PROFILE[i];
    if (age <= a1) return k0 + (k1 - k0) * (Math.max(age, a0) - a0) / (a1 - a0);
  }
  return AGE_PROFILE[AGE_PROFILE.length - 1][1];
}

/** Normalisation constant for a country: mean of ageProfile over the adult age distribution, estimated
 *  with the stationary population implied by its life table (both sexes). */
const NORM = new WeakMap<object, number>();
export function ageNorm(key: object, survival: (age: number) => number): number {
  let n = NORM.get(key);
  if (n === undefined) {
    let num = 0, den = 0;
    for (let a = 20; a <= 100; a++) { const l = survival(a); num += l * ageProfile(a); den += l; }
    n = num / den;
    NORM.set(key, n);
  }
  return n;
}
