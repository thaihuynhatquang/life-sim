// Household income per person (PPP $/year, constant 2021 international $), log-normal within each country.
//
// Two numbers pin a log-normal down:
//   - spread sigma, from the Gini index: for a log-normal, Gini = 2*Phi(sigma/sqrt2) - 1.
//   - location mu, from the share of people below the $3.00/day poverty line (survey-based, like Gini),
//     so the bottom of the distribution matches what household surveys actually see.
// When the poverty share is too small (or too large) to pin mu reliably, the mean is taken as a fixed
// fraction of GDP per capita instead; that fraction is the median survey-mean/GDP ratio across countries
// where both are known (household surveys capture much less than national accounts).

import type { Country } from './types.ts';
import { invNorm, normCdf } from './stats.ts';

export const POVERTY_LINE = 3.0 * 365; // $3.00/day, 2021 PPP
const POV_MIN = 1, POV_MAX = 95; // % range where the poverty share gives a stable mu

export interface IncomeModel {
  sigma: number;
  mu: number;
  mean: number;
  basis: 'poverty' | 'gdp';
}

export function sigmaFromGini(gini: number): number {
  const g = Math.min(0.75, Math.max(0.2, gini / 100));
  return Math.SQRT2 * invNorm((g + 1) / 2);
}

function muFromPoverty(c: Country, sigma: number): number | null {
  // In high-income countries the few people under $3/day reflect measurement quirks, not the shape of the distribution.
  if (c.income === 'High income' || !(c.pov_ext >= POV_MIN && c.pov_ext <= POV_MAX)) return null;
  return Math.log(POVERTY_LINE) - sigma * invNorm(c.pov_ext / 100);
}

/** Median of (survey mean income / GDP per capita) over countries where the poverty share pins mu. */
export function surveyToGdpRatio(countries: Country[]): number {
  const r: number[] = [];
  for (const c of countries) {
    const s = sigmaFromGini(c.gini), mu = muFromPoverty(c, s);
    if (mu !== null && !c.est.includes('pov_ext') && !c.est.includes('gini')) r.push(Math.exp(mu + s * s / 2) / c.gdp_ppp);
  }
  r.sort((a, b) => a - b);
  return r[r.length >> 1];
}

export function buildIncomeModel(c: Country, gdpRatio: number): IncomeModel {
  const sigma = sigmaFromGini(c.gini);
  const muPov = c.est.includes('pov_ext') ? null : muFromPoverty(c, sigma);
  const mu = muPov ?? Math.log(c.gdp_ppp * gdpRatio) - sigma * sigma / 2;
  return { sigma, mu, mean: Math.exp(mu + sigma * sigma / 2), basis: muPov === null ? 'gdp' : 'poverty' };
}

/** Income at percentile p (0..1) of the country's distribution. */
export function incomeAt(m: IncomeModel, p: number): number {
  return Math.exp(m.mu + m.sigma * invNorm(Math.min(0.999, Math.max(0.001, p))));
}

export function percentileOf(m: IncomeModel, income: number): number {
  return normCdf((Math.log(Math.max(1, income)) - m.mu) / m.sigma);
}
