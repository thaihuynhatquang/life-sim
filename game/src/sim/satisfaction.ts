// Life satisfaction: the Cantril ladder ("imagine a ladder from 0, the worst possible life, to 10, the
// best possible life for you; where do you stand now?"), the question behind the World Happiness Report.
//
// Country mean: Gallup World Poll as published by the World Happiness Report (country of residence:
// immigrants' life satisfaction moves close to that of their new country, WHR 2018 chapter 2).
// Differences between people in the same country use effect sizes from the literature (ASSUMPTIONS,
// below), each centred so that the country mean stays at the Gallup figure.

import type { Person } from './person.ts';
import type { Rng } from '../model/rng.ts';
import { gauss } from '../model/latent.ts';
import { mortalityZ } from './person.ts';
import { t, type T } from './i18n.ts';

/** ASSUMPTION: ladder points per unit of log household income within a country (Gallup World Poll;
 *  Deaton 2008, Stevenson & Wolfers 2013 find 0.3-0.5). */
export const B_INCOME = 0.4;
/** ASSUMPTION: a full year out of work, on top of the income loss (WHR 2017 chapter 6: the unemployed
 *  rate their lives about 0.5-0.7 points lower around the world). */
export const B_UNEMPLOYED = -0.5;
/** ASSUMPTION: compared with being married (WHR 2017-2019 and Gallup studies of marital status). */
export const B_MARITAL = { married: 0, single: -0.2, divorced: -0.4, widowed: -0.4 } as const;
/** ASSUMPTION: living with a chronic illness (diabetes, hypertension, HIV): WHR finds health problems
 *  among the largest individual factors; a moderate value is used because these conditions are often
 *  managed. */
export const B_CHRONIC = -0.3;
/** Average of the effects above over the simulated adults (from scripts/validate-life.ts): subtracted so
 *  that country means stay at the Gallup figure. */
export const MEAN_SHIFT = -0.2;
/** ASSUMPTION: spread between people in the same country. Gallup's within-country standard deviation of
 *  the ladder is typically about 2; it splits into a lasting personal level (temperament, things not
 *  modelled) and year-to-year ups and downs (one-year stability of life satisfaction around 0.6, Lucas &
 *  Donnellan 2007). */
export const SD_PERSONAL = 1.5;
export const SD_YEAR = 1.2;

export const personalLevel = (rng: Rng) => SD_PERSONAL * gauss(rng);

/** This year's answer on the ladder (0..10, whole steps as in the survey). */
export function ladderNow(p: Person, rng: Rng): number {
  return ladderWithReasons(p, rng).value;
}

/** The answer and the one or two things that weigh on it most (for the story). */
export function ladderWithReasons(p: Person, rng: Rng): { value: number; reasons: T[] } {
  const home = p.residence ?? p.b.country;
  const sigma = home.income.sigma;
  const terms: [number, T][] = [];
  const inc = B_INCOME * sigma * mortalityZ(p);
  terms.push([inc, inc > 0 ? t('cuộc sống khá giả', 'being comfortably off') : t('thu nhập eo hẹp', 'money being tight')]);
  const un = B_UNEMPLOYED * (p.year.out - p.year.uExp);
  terms.push([un, t('chuyện mất việc năm nay', 'losing work this year')]);
  const mar = B_MARITAL[p.marital];
  if (p.marital !== 'single' || p.age >= 30) terms.push([p.marital === 'married' ? 0.15 : mar, {
    married: t('có gia đình bên cạnh', 'having a family around you'), single: t('vẫn sống một mình', 'still living alone'),
    divorced: t('cuộc hôn nhân đã đổ vỡ', 'a marriage that broke down'), widowed: t('nỗi đau mất người bạn đời', 'the loss of your spouse'),
  }[p.marital]]);
  const chronic = p.diabetes || p.hypertension || p.hiv;
  if (chronic) terms.push([B_CHRONIC, t('bệnh tật kéo dài', 'a long-term illness')]);
  let x = home.c.ladder + p.personalLadder + SD_YEAR * gauss(rng) + inc + un + mar + (chronic ? B_CHRONIC : 0) - MEAN_SHIFT;
  const value = Math.max(0, Math.min(10, Math.round(x)));
  const reasons = terms.filter(([v]) => Math.abs(v) >= 0.15).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 2).map(([, r]) => r);
  return { value, reasons };
}
