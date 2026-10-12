// Per-country calibration, computed once and cached.
//
// Several traits are decided from latent scores that are correlated with each other (wealth, schooling,
// where you grew up). Simple thresholds would then miss the national targets as soon as one trait is
// conditional on another (e.g. "share of WORKERS who farm"). Here each target is hit exactly, either
// analytically or by finding the threshold on a large synthetic sample of the same draws.

import type { Country, Sex } from '../model/types.ts';
import type { CountryModel } from '../model/world.ts';
import { makeRng, type Rng } from '../model/rng.ts';
import { gauss, inTop, latent } from '../model/latent.ts';
import { invNorm, normCdf } from '../model/stats.ts';
import { causeShare, isAlcohol, isDiabetes, isHiv, isHypertension, type CauseData } from './causes.ts';

const cache = <K extends object, V>(f: (k: K) => V) => {
  const m = new WeakMap<K, V>();
  return (k: K): V => { let v = m.get(k); if (v === undefined) m.set(k, v = f(k)); return v; };
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- schooling
//
// Years of school from age 6 (0..12) come straight from survey completion rates (UNESCO UIS):
//   P(>=1) = 1 - out-of-school rate, P(>=6) = primary, P(>=9) = lower secondary, P(>=12) = upper secondary.
// Dropouts between those points are spread evenly over the years. A person's years are set by where
// their education score eduZ falls, so the national shares are exact.

export interface SchoolFit { pAtLeast: number[]; cut: number[]; uniGivenFinish: number }

export const schoolFit = cache((c: Country): SchoolFit => {
  const p = (x: number) => clamp(x / 100, 0.001, 0.999);
  const p12 = p(c.compl3);
  const p9 = Math.max(p12, p(c.compl2));
  const p6 = Math.max(p9, p(c.compl1));
  const p1 = Math.max(p6, p(100 - c.oos_primary));
  const anchors: [number, number][] = [[0, 1], [1, p1], [6, p6], [9, p9], [12, p12]];
  const pAtLeast: number[] = [];
  for (let k = 0; k <= 12; k++) {
    const i = anchors.findIndex(([ak]) => ak >= k);
    const [k1, v1] = anchors[i], [k0, v0] = anchors[Math.max(0, i - 1)];
    pAtLeast.push(k1 === k0 ? v1 : v0 + (v1 - v0) * (k - k0) / (k1 - k0));
  }
  return {
    pAtLeast,
    cut: pAtLeast.map(v => invNorm(1 - v)), // eduZ above cut[k] => at least k years
    uniGivenFinish: Math.min(1, uniTarget(c) / p12),
  };
});

/** Education across generations. The household's standing z correlates r with the parents' education
 *  score in this model (z is the parents' living standard: 70% lasting standing, which mixes family,
 *  education and luck). A child's score e = a * parentEdu + b * z + c * noise keeps corr(e, z) = rhoEdu,
 *  as layer 1 always had, and sets corr(e, parentEdu) = rhoL, found by bisection so that YEARS of
 *  schooling (whole years, capped at 12 + university) correlate as GDIM reports: the cap and the steps
 *  make the correlation of years weaker than that of the scores behind them. */
export interface EduFit { r: number; a: number; b: number; c: number; rhoL: number }
export const eduFit = cache((c: Country): EduFit => {
  const rho = c.edu_cor;
  const r = Math.sqrt(1 - 0.3) * (0.5 * rho + 0.5) / Math.sqrt(0.75 + 0.5 * rho);
  const coef = (rhoL: number) => {
    const a = (rhoL - r * rho) / (1 - r * r), b = (rho - r * rhoL) / (1 - r * r);
    return { a, b, c2: 1 - (a * a + b * b + 2 * a * b * r) };
  };
  const f = schoolFit(c), p12 = f.pAtLeast[12], uniCut = invNorm(1 - p12 * f.uniGivenFinish);
  const years = (x: number) => { let y = 0; while (y < 12 && x > f.cut[y + 1]) y++; return y + (y === 12 && x > uniCut ? 4 : 0); };
  // Fixed normal draws (deterministic): correlation of years for a given rhoL.
  const N = 4000, g1: number[] = [], g2: number[] = [];
  let s = 12345;
  const u = () => { s = (s * 1103515245 + 12345) % 2147483648; return (s + 0.5) / 2147483648; };
  for (let i = 0; i < N; i++) { const r1 = Math.sqrt(-2 * Math.log(u())), t1 = 2 * Math.PI * u(); g1.push(r1 * Math.cos(t1)); g2.push(r1 * Math.sin(t1)); }
  const yearsCorr = (rhoL: number) => {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < N; i++) { xs.push(years(g1[i])); ys.push(years(rhoL * g1[i] + Math.sqrt(1 - rhoL * rhoL) * g2[i])); }
    const mx = xs.reduce((p, q) => p + q, 0) / N, my = ys.reduce((p, q) => p + q, 0) / N;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < N; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  };
  // Largest rhoL that keeps the noise variance non-negative.
  let hiMax = 0.99;
  while (hiMax > rho && coef(hiMax).c2 < 0) hiMax -= 0.01;
  let lo = 0, hi = hiMax;
  if (yearsCorr(hi) < rho) lo = hi;
  else for (let i = 0; i < 25; i++) { const mid = (lo + hi) / 2; if (yearsCorr(mid) < rho) lo = mid; else hi = mid; }
  const rhoL = (lo + hi) / 2, k = coef(rhoL);
  return { r, a: k.a, b: k.b, c: Math.sqrt(Math.max(0, k.c2)), rhoL };
});

/** Share of a cohort that goes to university. Gross tertiary enrollment counts students of all ages
 *  against one 5-year age group, so it overstates cohort entry; capped at 90%. */
export const uniTarget = (c: Country) => Math.min(0.9, c.tertiary / 100);

export function drawSchool(c: Country, eduZ: number, rng: Rng): { years: number; uni: boolean } {
  const f = schoolFit(c);
  let years = 0;
  while (years < 12 && eduZ > f.cut[years + 1]) years++;
  if (years < 12) return { years, uni: false };
  // Rank among upper-secondary finishers (standard normal within that group), so the share going on
  // to university is exact rather than inflated by finishers' above-average eduZ.
  const p12 = f.pAtLeast[12];
  const posZ = invNorm(clamp((normCdf(eduZ) - (1 - p12)) / p12, 1e-9, 1 - 1e-9));
  return { years, uni: inTop(latent(rng, posZ, 0.6), f.uniGivenFinish) };
}

// ---------------------------------------------------------------- work

/** In the labour force during prime working age (ILO participation at 25-54). */
export function drawWorks(c: Country, female: boolean, eduZ: number, rng: Rng): boolean {
  return inTop(latent(rng, eduZ, female ? 0.2 : 0), c.lfp_age[female ? 'F' : 'M'].p25);
}

/** Age at which a worker stops working, from how participation falls between 25-54, 55-64 and 65+:
 *  the share still working is 1 at 54, p55/p25 at 59.5 (mid of 55-64), p65/p25 at 72 (about the mean
 *  age of people 65+) and 0 at 90; linear in between. u in (0,1): lower = keeps working longer. */
export function exitAge(c: Country, sex: Sex, u: number): number {
  const l = c.lfp_age[sex];
  const r55 = Math.min(1, l.p55 / l.p25), r65 = Math.min(r55, l.p65 / l.p25);
  const pts: [number, number][] = [[54, 1], [59.5, r55], [72, r65], [90, 0]];
  for (let i = 1; i < pts.length; i++) {
    const [a0, s0] = pts[i - 1], [a1, s1] = pts[i];
    if (u >= s1) return s0 === s1 ? a0 : a0 + (a1 - a0) * (s0 - u) / (s0 - s1);
  }
  return 90;
}

// ---------------------------------------------------------------- smoking

/** ASSUMPTION: current smokers' all-cause mortality ~2x non-smokers from age 30 (Jha et al. 2013). */
export const SMOKING_RR = 2;

/** Hazard multipliers by age for smokers and non-smokers. Smokers die faster, so their share among
 *  survivors falls with age; the multipliers follow that share so the population average hazard stays
 *  exactly the UN life table's. */
export const smokingK = cache((m: CountryModel) => {
  const out = {} as Record<Sex, { smoker: Float64Array; non: Float64Array }>;
  for (const sex of ['M', 'F'] as const) {
    const qx = m.mort[sex].qx;
    const smoker = new Float64Array(qx.length).fill(1), non = new Float64Array(qx.length).fill(1);
    let s = (sex === 'F' ? m.c.smoke_f : m.c.smoke_m) / 100;
    for (let a = 30; a < qx.length - 1; a++) {
      const kn = 1 / (1 + (SMOKING_RR - 1) * s);
      non[a] = kn; smoker[a] = SMOKING_RR * kn;
      const q = qx[a];
      s = s * (1 - Math.min(1, q * smoker[a])) / Math.max(1e-9, 1 - q);
    }
    out[sex] = { smoker, non };
  }
  return out;
});

// ---------------------------------------------------------------- marriage
//
// Share ever married by age, from UN World Marriage Data (5-year groups, read at their midpoints).
// For women the point at 18 is UNICEF's child-marriage rate (women 20-24 married before 18), a more
// direct measure than the 15-19 group. A person's marriage age is read off this curve at their rank,
// so the national curve is reproduced exactly.

export interface MarriageCurve { ages: number[]; share: number[]; ever: number; median: number; ageAt: (u: number) => number; shareBy: (age: number) => number }

function curve(ages: number[], share: number[]): MarriageCurve {
  for (let i = 1; i < share.length; i++) share[i] = Math.max(share[i], share[i - 1]);
  const ever = share[share.length - 1];
  const ageAt = (u: number) => {
    for (let i = 1; i < ages.length; i++) {
      if (u <= share[i]) {
        const span = share[i] - share[i - 1];
        return span <= 0 ? ages[i] : ages[i - 1] + (ages[i] - ages[i - 1]) * (u - share[i - 1]) / span;
      }
    }
    return ages[ages.length - 1];
  };
  /** Share married before exact age x (marriage ages are whole years, floor of the continuous age). */
  const shareBy = (x: number) => {
    if (x <= ages[0]) return 0;
    for (let i = 1; i < ages.length; i++) {
      if (x <= ages[i]) return share[i - 1] + (share[i] - share[i - 1]) * (x - ages[i - 1]) / (ages[i] - ages[i - 1]);
    }
    return ever;
  };
  return { ages, share, ever, median: ageAt(ever / 2), ageAt, shareBy };
}

export const marriage = cache((c: Country) => {
  const mid = [17.5, 22.5, 27.5, 32.5, 37.5, 42.5, 47.5];
  const F = curve([12, 18, ...mid.slice(1)], [0, c.child_marriage / 100, ...c.marr.F.slice(1)]);
  const M = curve([15, ...mid], [0, ...c.marr.M]);
  return { F, M, gap: clamp(M.median - F.median, 0, 12) };
});

// ---------------------------------------------------------------- fertility

/** Births per woman per year at this age (UN WPP single-age ASFR). Falls back to a bell curve around
 *  the mean age at childbearing if the ASFR file wasn't available when the data was built. */
export function asfrAt(c: Country, age: number): number {
  if (age < 15 || age > 49) return 0;
  if (c.asfr) return c.asfr[age - 15];
  let s = 0;
  for (let a = 15; a <= 49; a++) s += Math.exp(-0.5 * ((a - c.mac) / 6) ** 2);
  return c.tfr * Math.exp(-0.5 * ((age - c.mac) / 6) ** 2) / s;
}

// ---------------------------------------------------------------- divorce, widowhood, remarriage
//
// A cohort flow model per country and sex: people enter marriage along the ever-married curve; each
// year the married divorce at rate h or are widowed (spouse's life table); the divorced remarry at rate
// rd and the widowed at rate rw. (h, rd, rw) are fitted so the model's shares currently divorced/
// separated and currently widowed among the ever-married, at ages 20-24 ... 60-64, match UN World
// Marriage Data. The same model gives the share of women CURRENTLY married at each age, which turns
// age-specific fertility into a birth rate for married women.

export interface MaritalRates { h: number; rd: number; rw: number; married: Float64Array; fitErr: number }

const H_GRID = [0, 0.001, 0.002, 0.003, 0.004, 0.006, 0.008, 0.01, 0.0125, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.065];
const R_GRID = [0, 0.01, 0.02, 0.03, 0.045, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.4];
const STATUS_MID = [22, 27, 32, 37, 42, 47, 52, 57, 62]; // midpoints of 20-24 ... 60-64
const LAST_REMARRY_AGE = 64;

function runFlow(ever: (a: number) => number, qSpouse: (a: number) => number, h: number, rd: number, rw: number) {
  let M = 0, D = 0, W = 0, prevE = 0;
  const married = new Float64Array(101), div = new Float64Array(101), wid = new Float64Array(101);
  for (let a = 12; a <= 100; a++) {
    const E = ever(a);
    M += Math.max(0, E - prevE);
    prevE = E;
    const r = a <= LAST_REMARRY_AGE ? 1 : 0;
    const dv = h * M, wd = qSpouse(a) * M, md = rd * r * D, mw = rw * r * W;
    M += md + mw - dv - wd; D += dv - md; W += wd - mw;
    married[a] = M; div[a] = E > 0 ? D / E : 0; wid[a] = E > 0 ? W / E : 0;
  }
  return { married, div, wid };
}

export const maritalRates = cache((m: CountryModel): Record<Sex, MaritalRates> => {
  const c = m.c, mc = marriage(c), gap = Math.round(mc.gap);
  const out = {} as Record<Sex, MaritalRates>;
  for (const sex of ['F', 'M'] as const) {
    const ever = (a: number) => mc[sex].shareBy(a + 1);
    const spouseQ = m.mort[sex === 'F' ? 'M' : 'F'].qx;
    const qSpouse = (a: number) => spouseQ[clamp(a + (sex === 'F' ? gap : -gap), 0, 100)];
    const target = c.marr_status[sex];
    const err = (h: number, rd: number, rw: number, which: 'div' | 'wid' | 'both') => {
      const f = runFlow(ever, qSpouse, h, rd, rw);
      let e = 0;
      STATUS_MID.forEach((a, i) => {
        if (which !== 'wid') e += (f.div[a] - target.div[i]) ** 2;
        if (which !== 'div') e += (f.wid[a] - target.wid[i]) ** 2;
      });
      return e;
    };
    // Divorce and remarriage-after-divorce barely depend on widowhood: fit them first, then rw.
    let best = { h: 0, rd: 0, rw: 0.05, e: Infinity };
    for (const h of H_GRID) for (const rd of R_GRID) {
      const e = err(h, rd, best.rw, 'div');
      if (e < best.e) best = { ...best, h, rd, e };
    }
    best.e = Infinity;
    for (const rw of R_GRID) {
      const e = err(best.h, best.rd, rw, 'wid');
      if (e < best.e) best = { ...best, rw, e };
    }
    const f = runFlow(ever, qSpouse, best.h, best.rd, best.rw);
    out[sex] = { h: best.h, rd: best.rd, rw: best.rw, married: f.married, fitErr: Math.sqrt(err(best.h, best.rd, best.rw, 'both') / 18) };
  }
  return out;
});

/** Annual chance a currently married woman of this age gives birth: ASFR divided by the share of women
 *  currently married at that age, so births across all women match the UN's age pattern and TFR. */
export function marriedBirthRate(m: CountryModel, wifeAge: number): number {
  if (wifeAge < 15 || wifeAge > 49) return 0;
  const married = maritalRates(m).F.married[wifeAge];
  return Math.min(0.9, asfrAt(m.c, wifeAge) / Math.max(0.03, married));
}

// ---------------------------------------------------------------- HIV
//
// Each person draws an infection age with probability pmax; infections are spread over ages 15-49 with
// weight falling linearly with age (most new infections are among young adults). No wealth correlation:
// in high-prevalence countries HIV is not concentrated among the poor.
// People living with HIV carry the HIV share of their age's death rate (WHO), divided by the share of
// living people who have HIV at that age, so they die faster than others (hivSplit). A cohort
// calculation tracks that living share; pmax is tuned so the living share averaged over ages 15-49
// equals UNAIDS prevalence for each sex (15-49 prevalence x women's share of adults with HIV).

export interface HivModel { pmax: number; alive: Float64Array }

/** HIV deaths are tied to infections in the simulation from this age; younger ones are mostly from
 *  infection at birth and are left in the general cause mix. */
export const HIV_FROM = 20;

const HIV_AGES: number[] = [];
for (let a = 15; a <= 49; a++) HIV_AGES.push(50 - a);
const HIV_W = HIV_AGES.reduce((x, y) => x + y, 0);
/** Share of eventual infections that happen at exactly this age. */
export const hivAgeWeight = (age: number) => (age >= 15 && age <= 49 ? (50 - age) / HIV_W : 0);

/** Death probabilities for people with and without HIV at one age. If the HIV share is too large to
 *  put on so few people (it would need a probability above 1), the excess stays with everyone, so the
 *  average death rate is always the life table's. */
export function hivSplit(q: number, hs: number, prev: number): { qInf: number; qUn: number; hsEff: number } {
  if (prev <= 0 || hs <= 0) return { qInf: q, qUn: q, hsEff: 0 };
  const maxHs = q >= 1 ? 0 : prev * (1 - q) / (q * (1 - prev)); // keeps qInf <= 1
  const hsEff = Math.min(hs, Math.max(0, maxHs));
  return { qInf: Math.min(1, q * (1 - hsEff) + q * hsEff / prev), qUn: q * (1 - hsEff), hsEff };
}

function hivCohort(m: CountryModel, cd: CauseData, sex: Sex, pmax: number): Float64Array {
  const qx = m.mort[sex].qx, scale = m.mort[sex].scale;
  const alive = new Float64Array(101);
  let inf = 0, un = 1, cum = 0;
  for (let a = 0; a <= 100; a++) {
    const w = hivAgeWeight(a) * pmax;
    if (w > 0) {
      const f = 1 - cum > 0 ? w / (1 - cum) : 0; // of those not yet (or never to be) infected
      inf += un * f; un -= un * f; cum += w;
    }
    const prev = inf + un > 0 ? inf / (inf + un) : 0;
    alive[a] = prev;
    const q = Math.min(1, qx[a] * (a < 5 ? 1 : scale));
    const s = hivSplit(q, a >= HIV_FROM ? causeShare(cd, m, sex, a, isHiv) : 0, prev);
    inf *= 1 - s.qInf; un *= 1 - s.qUn;
  }
  return alive;
}

const HIV_CACHE = new WeakMap<CountryModel, Record<Sex, HivModel>>();

export function hivModel(m: CountryModel, cd: CauseData): Record<Sex, HivModel> {
  let v = HIV_CACHE.get(m);
  if (v) return v;
  const c = m.c, p = c.hiv / 100, fs = (c.hiv_fshare ?? 50) / 100;
  v = {} as Record<Sex, HivModel>;
  for (const sex of ['F', 'M'] as const) {
    const target = Math.min(0.9, 2 * (sex === 'F' ? fs : 1 - fs) * p);
    let pmax = target, alive = hivCohort(m, cd, sex, pmax);
    for (let it = 0; it < 6 && target > 0; it++) {
      let avg = 0;
      for (let a = 15; a <= 49; a++) avg += alive[a] / 35;
      pmax = Math.min(0.95, pmax * target / Math.max(1e-9, avg));
      alive = hivCohort(m, cd, sex, pmax);
    }
    v[sex] = { pmax, alive };
  }
  HIV_CACHE.set(m, v);
  return v;
}

// ---------------------------------------------------------------- unemployment
//
// Unemployment rate u by sex and age (15-24, 25+; ILO). Spell lengths are exponential with mean D, taken
// from the share of the unemployed who have been out of work 12+ months: P(>12 months) = exp(-12/Dm).
// Job losses happen at rate u / ((1 - u) * D) per year employed, so that in a steady state the share
// of time spent unemployed equals u (simulate.ts runs this in continuous time within each year).

/** Mean unemployment spell in years. */
export const spellYears = (c: Country) => clamp(-1 / Math.log(clamp(c.ltu, 0.02, 0.9)), 0.15, 5);

// ---------------------------------------------------------------- diabetes and hypertension
//
// Onset from age 30 at a constant yearly rate h. Deaths from diabetes, and from heart disease caused by
// high blood pressure (WHO cause mix), are carried by people with the condition (hivSplit, as for HIV).
// h is set so that prevalence among living adults (30+ for diabetes, 30-79 for hypertension, weighted
// by how many people are alive at each age) matches WHO/NCD-RisC for each sex.

export type Chronic = 'dm' | 'ht' | 'aud' | 'obese';
export interface ChronicModel { h: number; alive: Float64Array }
export const CHRONIC_FROM = 30;

/** Per condition: onset age, prevalence target (and the age range it refers to), and the cause of death
 *  carried by people with it (none for obesity: WHO does not attribute deaths to it directly). */
const CHRONIC: Record<Chronic, { from: number; upTo: number; target: (c: Country) => Record<Sex, number>; test: (c: CauseData['causes'][number]) => boolean }> = {
  dm: { from: 30, upTo: 100, target: c => c.ncd.dm_prev, test: isDiabetes },
  ht: { from: 30, upTo: 79, target: c => c.ncd.ht_prev, test: isHypertension },
  aud: { from: 15, upTo: 100, target: c => c.ncd.aud, test: isAlcohol },
  obese: { from: 18, upTo: 100, target: c => c.ncd.obese, test: () => false },
};
export const chronicFrom = (kind: Chronic) => CHRONIC[kind].from;

function chronicCohort(m: CountryModel, cd: CauseData, sex: Sex, kind: Chronic, h: number) {
  const qx = m.mort[sex].qx, scale = m.mort[sex].scale, { from, test } = CHRONIC[kind];
  const alive = new Float64Array(101), people = new Float64Array(101);
  let ill = 0, well = 1;
  for (let a = 0; a <= 100; a++) {
    if (a >= from) { const f = 1 - Math.exp(-h); ill += well * f; well -= well * f; }
    const prev = ill + well > 0 ? ill / (ill + well) : 0;
    alive[a] = prev; people[a] = ill + well;
    const q = Math.min(1, qx[a] * (a < 5 ? 1 : scale));
    const s = hivSplit(q, a >= from ? causeShare(cd, m, sex, a, test) : 0, prev);
    ill *= 1 - s.qInf; well *= 1 - s.qUn;
  }
  return { alive, people };
}

const CHRONIC_CACHE = new WeakMap<CountryModel, Record<Chronic, Record<Sex, ChronicModel>>>();

export function chronicModel(m: CountryModel, cd: CauseData, kind: Chronic): Record<Sex, ChronicModel> {
  let byKind = CHRONIC_CACHE.get(m);
  if (!byKind) CHRONIC_CACHE.set(m, byKind = {} as Record<Chronic, Record<Sex, ChronicModel>>);
  if (byKind[kind]) return byKind[kind];
  const out = {} as Record<Sex, ChronicModel>;
  for (const sex of ['F', 'M'] as const) {
    const target = CHRONIC[kind].target(m.c)[sex];
    const { from, upTo } = CHRONIC[kind];
    const prevalence = (h: number) => {
      const { alive, people } = chronicCohort(m, cd, sex, kind, h);
      let num = 0, den = 0;
      for (let a = from; a <= upTo; a++) { num += alive[a] * people[a]; den += people[a]; }
      return num / den;
    };
    let lo = 0, hi = 0.3;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (prevalence(mid) < target) lo = mid; else hi = mid; }
    const h = (lo + hi) / 2;
    out[sex] = { h, alive: chronicCohort(m, cd, sex, kind, h).alive };
  }
  return byKind[kind] = out;
}

// ---------------------------------------------------------------- slums

/** Cutoff on a poverty score so exactly `slum`% of URBAN people live in slums (urban people are richer
 *  than average, so a population-wide threshold would undercount). */
export const slumCutoff = cache((c: Country): number => {
  const rng = makeRng(0x51 ^ Math.round(c.pop));
  const scores: number[] = [];
  for (let i = 0; i < 20000; i++) {
    const z = gauss(rng), urbanZ = latent(rng, z, 0.5);
    if (inTop(urbanZ, c.urban / 100)) scores.push(latent(rng, -z, 0.5));
  }
  scores.sort((a, b) => b - a);
  const k = Math.round(c.slum / 100 * scores.length);
  return k <= 0 ? Infinity : k >= scores.length ? -Infinity : (scores[k - 1] + scores[k]) / 2;
});

// ---------------------------------------------------------------- bank accounts (Global Findex)
//
// Account ownership by sex, with a wealth gradient: the correlation with adult standing is chosen so
// that the share among the poorest 40% and the richest 60% (by income) matches Findex for the country.

export const accountRho = cache((c: Country): number => {
  const target = c.account_r60 > 0 && c.account_p40 > 0 ? c.account_r60 / c.account_p40 : 1;
  const share = c.account / 100, cut = invNorm(0.4), thr = invNorm(1 - share);
  const QN = 400;
  let best = { err: Infinity, rho: 0 };
  for (let rho = 0; rho <= 0.95; rho += 0.025) {
    let low = 0, high = 0;
    for (let i = 0; i < QN; i++) {
      const z = invNorm((i + 0.5) / QN);
      const p = 1 - normCdf((thr - rho * z) / Math.sqrt(1 - rho * rho)); // P(latent > thr | z)
      if (z < cut) low += p; else high += p;
    }
    const ratio = (high / (QN * 0.6)) / Math.max(1e-9, low / (QN * 0.4));
    const err = Math.abs(ratio - target);
    if (err < best.err) best = { err, rho };
  }
  return best.rho;
});

// ---------------------------------------------------------------- pensions

/** Chance of a pension at 65 for people who held a formal job (a) and for everyone else (b, e.g. social
 *  or survivor pensions). Formal workers are covered first; a and b are set so the share receiving a
 *  pension matches UN SDG 1.3.1. Share with a formal career ~ prime-age participation x formality. */
export function pensionChances(c: Country, sex: Sex): { formal: number; other: number } {
  const target = c.pension[sex];
  const formalShare = c.lfp_age[sex].p25 * (1 - (c.work[sex].informal ?? 0.5));
  const a = Math.min(1, target / Math.max(1e-6, formalShare));
  const b = Math.max(0, (target - a * formalShare) / Math.max(1e-6, 1 - formalShare));
  return { formal: a, other: b };
}

// ---------------------------------------------------------------- living arrangements in old age
//
// UN shares (living with adult children, as a couple only, skip-generation, alone) are for everyone of
// that age. A person can only live with children they have, or as a couple if their spouse is alive, so
// the shares are turned into conditional chances, applied in order:
//   with children  | has a living adult child      = C / H
//   couple only    | spouse alive, not with kids   = K / (S (1 - C))
//   skip-generation| has a child, neither of above = G / (H (1 - C/H) (1 - S))
//   alone          | none of the above             = A / remaining
// H = share with a living adult child ~ (1 - childless) x 0.95 (ASSUMPTION: child survival to adulthood);
// childless = never married + married with no births (Poisson with mean TFR / ever-married).
// S = share currently married at that age, from the marital flow model.

export interface LivingRule { children: number; couple: number; skip: number; alone: number }

export function livingRule(m: CountryModel, sex: Sex, age: number): LivingRule {
  const c = m.c, lv = c.living[sex][age >= 80 ? '80' : '65'];
  const ever = marriage(c)[sex].ever;
  const childless = (1 - ever) + ever * Math.exp(-c.tfr / Math.max(0.05, ever));
  const H = Math.max(0.05, (1 - childless) * 0.95);
  const S = clamp(maritalRates(m)[sex].married[Math.min(100, age)], 0.01, 0.99);
  const pc = Math.min(1, lv.children / H);
  const withKids = pc * H;
  const pk = Math.min(1, lv.couple / Math.max(1e-6, S * (1 - withKids)));
  const ps = Math.min(1, lv.skip / Math.max(1e-6, H * (1 - pc) * (1 - S * pk)));
  const remaining = Math.max(1e-6, 1 - withKids - Math.min(lv.couple, S) - lv.skip);
  return { children: pc, couple: pk, skip: ps, alone: Math.min(1, lv.alone / remaining) };
}

// ---------------------------------------------------------------- health spending shocks
//
// Each year a person faces a large out-of-pocket health bill with a hazard that depends on age and on
// having a chronic condition; the multipliers are ASSUMPTIONS (literature: households with chronic disease
// and older members have 2-3x the risk of catastrophic spending), but the average over a country's people
// is exactly the WHO/World Bank share facing impoverishing or large spending (SDG 3.8.2 family).
// The size of a bill, as a multiple of the person's annual income, is set so that the average yearly
// spending equals the country's out-of-pocket spending per person (World Bank, PPP $).

export const RR_CHRONIC = 2.5; // ASSUMPTION
export const rrAge = (a: number) => (a < 5 ? 1.5 : a < 18 ? 0.7 : a < 65 ? 1 : 2); // ASSUMPTION
export const healthRisk = (a: number, chronic: boolean) => rrAge(a) * (chronic ? RR_CHRONIC : 1);

export interface HealthSpend { h0: number; kappa: number; pImpov: number; avgRisk: Float64Array }

export const healthSpend = cache((m: CountryModel): HealthSpend => {
  const c = m.c, total = (c.oop_imp + c.oop_large) / 100;
  // Stationary population: survival-weighted ages, prevalence of any chronic condition by age.
  const dm = chronicModel(m, causesRef(), 'dm'), ht = chronicModel(m, causesRef(), 'ht');
  const hiv = hivModel(m, causesRef());
  let num = 0, den = 0, l = 1;
  const qm = m.mort.M.qx, qf = m.mort.F.qx;
  const avgRisk = new Float64Array(101);
  for (let a = 0; a <= 100; a++) {
    const d = (dm.M.alive[a] + dm.F.alive[a]) / 2, h = (ht.M.alive[a] + ht.F.alive[a]) / 2, v = a >= 15 ? (hiv.M.alive[a] + hiv.F.alive[a]) / 2 : 0;
    const chronic = 1 - (1 - d) * (1 - h) * (1 - v);
    avgRisk[a] = rrAge(a) * (1 + (RR_CHRONIC - 1) * chronic);
    num += l * avgRisk[a]; den += l;
    l *= 1 - (qm[a] + qf[a]) / 2;
  }
  const h0 = total / (num / den);
  const kappa = clamp(c.oop_pc / Math.max(1e-6, total * m.income.mean), 0.08, 1.5);
  return { h0, kappa, pImpov: c.oop_imp / Math.max(1e-9, c.oop_imp + c.oop_large), avgRisk };
});

let CAUSES: CauseData | undefined;
export const setCauses = (cd: CauseData) => { CAUSES = cd; };
const causesRef = () => CAUSES as CauseData;
