// Money: earnings, household income, and showing amounts in local currency at today's prices.
//
// All amounts are kept in 2021 PPP dollars (as the income model and the poverty line are). For display
// they are converted to the country's currency: PPP conversion factor for private consumption (2021,
// World Bank) x consumer price change since 2021.
//
// Household living standard (income per person) is NOT added up from these earnings: household income
// also includes own production, transfers and other members, which earnings data miss. It comes from the
// national income distribution (calibrated to poverty and Gini) at the person's position in it.
//
// Earnings of employees: ILO average monthly earnings by sex and occupation x age-band ratio (ILO), times
// a personal factor (who you are within the occupation). Self-employed people have no ILO earnings data;
// their income is scaled from employees in the same occupation (ASSUMPTION, see STATUS_K).

import type { Country, Sex } from '../model/types.ts';
import type { Rng } from '../model/rng.ts';
import { gauss } from '../model/latent.ts';
import { fmt, type Lang, type T } from './i18n.ts';
import { ageNorm, ageProfile, wealthAt, wealthModel, wealthRank } from '../model/wealth.ts';
import type { Job } from './work.ts';
import { bandOf, employeeMean } from './work.ts';
import type { CountryModel } from '../model/world.ts';

/** ASSUMPTION: spread of log earnings among people in the same occupation, sex and age band. */
export const PERSONAL_SD = 0.4;
/** ASSUMPTION: income relative to employees in the same occupation. Employers earn more, own-account
 *  workers less (ILO notes most own-account work in developing countries is low-paid); contributing
 *  family workers are unpaid. */
export const STATUS_K: Record<Job['status'], number> = { emp: 1, employer: 2, own: 0.6, family: 0 };
/** ASSUMPTION: pension as a share of last earnings (OECD average gross replacement rate ~50%), and a
 *  basic social pension for others as a share of the national median per-person income. */
export const REPLACEMENT = 0.5;
export const SOCIAL_PENSION = 0.3;

/** Persistent personal earnings factor (log-normal, mean 1): differences between people in the same
 *  occupation, sex and age. Independent of background, which already acts through education and
 *  occupation (linking it too would count the same advantage twice). */
export function personalFactor(_adultZ: number, rng: Rng): number {
  return Math.exp(PERSONAL_SD * gauss(rng) - PERSONAL_SD ** 2 / 2);
}

/** Monthly income (2021 PPP $) from a job at this age. */
export function monthlyEarnings(m: CountryModel, sex: Sex, job: Job, age: number, personal: number): number {
  const e = m.c.earn[sex];
  const ageK = e.age[bandOf(age)] ?? 1;
  return e.total * (e.rel[job.occ] ?? 1) / relNorm(m, sex) * ageK * STATUS_K[job.status] * personal;
}

/** Occupation ratios are relative to ILO's employee average; rescale so the simulated employees'
 *  average occupation ratio is exactly 1 (their occupation mix can differ from the survey's). */
const REL_NORM = new WeakMap<CountryModel, Record<Sex, number>>();
function relNorm(m: CountryModel, sex: Sex): number {
  let v = REL_NORM.get(m);
  if (!v) REL_NORM.set(m, v = { M: employeeMean(m, 'M', m.c.earn.M.rel), F: employeeMean(m, 'F', m.c.earn.F.rel) });
  return v[sex];
}

// ---------------------------------------------------------------- taxes

/** Income tax + employee social contributions as a share of gross pay (0..1). OECD Taxing Wages gives the
 *  average rate at 67%, 100% and 167% of the average wage (single, no children); elsewhere the rate at the
 *  average wage is estimated from revenue (see build_countries.py) with OECD-median progressivity.
 *  Between those points the rate is linear in log pay; beyond them it continues with the nearest slope
 *  (ASSUMPTION), floored at 0 and capped at 55%. Informal and unpaid family work pays none. */
export function taxRate(c: Country, job: Job, monthly: number): number {
  if (job.informal || job.status === 'family' || monthly <= 0) return 0;
  const aw = (c.earn.M.total + c.earn.F.total) / 2; // ILO average monthly earnings of employees
  const x = Math.log(monthly / aw), x67 = Math.log(0.67), x167 = Math.log(1.67);
  const { r67, r100, r167 } = c.tax;
  const r = x < 0 ? r100 + (r100 - r67) / -x67 * x : r100 + (r167 - r100) / x167 * x;
  return Math.min(55, Math.max(0, r)) / 100;
}

export const netPay = (c: Country, job: Job, monthly: number) => monthly * (1 - taxRate(c, job, monthly));

// ---------------------------------------------------------------- display

/** Optional fixed display currency: every amount is shown as what it would buy in this country
 *  (purchasing power), instead of in the money of the country the amount belongs to. */
let DISPLAY: Country | undefined;
export function setDisplayCountry(c: Country | undefined): void { DISPLAY = c; }

/** 2021 PPP dollars -> local currency today (or PPP dollars if the country has no PPP factor). */
export function toLocal(c: Country, ppp: number): { amount: number; currency: string } {
  c = DISPLAY ?? c;
  if (!c.ppp2021) return { amount: ppp, currency: 'USD' };
  return { amount: ppp * c.ppp2021 * (c.cpi_ratio ?? 1), currency: c.currency };
}

const SYMBOL: Record<string, string> = { VND: '₫', USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹', NGN: '₦', KRW: '₩', PHP: '₱', THB: '฿' };

/** Human-friendly amount: "9,3 triệu ₫" / "₫9.3M", "180.000 ₦" / "₦180K". */
export function formatMoney(c: Country, ppp: number, lang: Lang): string {
  c = DISPLAY ?? c;
  const { amount, currency } = toLocal(c, ppp);
  const sym = SYMBOL[currency] ?? currency;
  const ppPrefix = !c.ppp2021 ? (lang === 'vi' ? ' (USD theo sức mua)' : ' (PPP dollars)') : '';
  if (lang === 'vi') {
    const units: [number, string][] = [[1e12, 'nghìn tỷ'], [1e9, 'tỷ'], [1e6, 'triệu'], [1e3, 'nghìn']];
    for (const [u, name] of units) {
      if (amount >= u) return `${fmt('vi', { maximumSignificantDigits: amount / u >= 100 ? 3 : 2 }).format(amount / u)} ${name} ${sym}${ppPrefix}`;
    }
    return `${fmt('vi', {}).format(Math.round(amount))} ${sym}${ppPrefix}`;
  }
  const s = fmt('en', { notation: 'compact', maximumSignificantDigits: 2 }).format(amount);
  return `${sym.length === 1 ? sym + s : s + ' ' + sym}${ppPrefix}`;
}

/** Same amount for comparison in another country's money, by purchasing power ("≈ 2,9 triệu ₫"). */
export function formatIn(other: Country, ppp: number, lang: Lang): string {
  return formatMoney(other, ppp, lang);
}

export const perMonth = (lang: Lang) => (lang === 'vi' ? '/tháng' : ' a month');
export type { T };

// ---------------------------------------------------------------- wealth (net worth)

/** ASSUMPTION: rank correlation between a person's adult standing (education, family, income) and
 *  their wealth rank (household surveys: SCF, HFCS, LWS report income-wealth rank correlations of
 *  about 0.6-0.7). */
export const WEALTH_RHO = 0.7;

/** Net worth (2021 PPP $) at this age for the person with adult wealth rank u in the country. */
export function netWorth(m: CountryModel, u: number, age: number): number {
  const base = wealthAt(m.c, u);
  const surv = (a: number) => Math.max(1e-6, Math.sqrt(Math.max(1e-9, survivalTo(m, 'M', a) * survivalTo(m, 'F', a))));
  const k = ageProfile(age) / ageNorm(m, surv);
  return base >= 0 ? base * k : base / Math.max(0.3, k); // debts do not shrink with age as assets grow
}

/** Inverse of netWorth: the wealth rank in the country that gives this net worth at this age. */
export function wealthRankAt(m: CountryModel, nw: number, age: number): number {
  const surv = (a: number) => Math.max(1e-6, Math.sqrt(Math.max(1e-9, survivalTo(m, 'M', a) * survivalTo(m, 'F', a))));
  const k = ageProfile(age) / ageNorm(m, surv);
  return wealthRank(m.c, nw >= 0 ? nw / k : nw * Math.max(0.3, k));
}

function survivalTo(m: CountryModel, sex: Sex, age: number): number {
  const qx = m.mort[sex].qx;
  let l = 1;
  for (let a = 0; a < Math.min(age, qx.length); a++) l *= 1 - qx[a];
  return l;
}

/** Market US dollars per 2021 PPP dollar for this country at the top of the distribution (the same
 *  conversion used to place the $1bn billionaire line). */
export function usdPerPpp(c: Country): number {
  const w = c.wealth, i = w.grid.indexOf(0.9999);
  return w.usd[i] / w.ppp[i];
}

export function isBillionaire(c: Country, ppp: number): boolean {
  return ppp * usdPerPpp(c) >= 1e9;
}
export { wealthModel };

/** ASSUMPTION: share of the top 0.1% of adults by wealth whose wealth is mainly a business they own or
 *  founded. Studies of top wealth (e.g. Smith, Zidar & Zwick 2023 for the US) find that owner-managed
 *  business makes up a very large part of top wealth; 70% is used everywhere. */
export const TOP_OWNER_SHARE = 0.7;
export const TOP_OWNER_CUT = 0.999;
