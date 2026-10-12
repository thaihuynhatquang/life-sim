// Starting a business (player's choice).
//
// - Survival: share of new businesses still open after 1, 2, ... years, from the US Bureau of Labor
//   Statistics Business Employment Dynamics (about 80% survive the first year, half reach 5 years,
//   about a third reach 10). ASSUMPTION: the same curve everywhere (no comparable series for most
//   countries); after 10 years 5% close each year.
// - Pay: owners take out what an employee in the same occupation earns times a personal factor X,
//   log-normal with median 0.75 (ASSUMPTION, after Hamilton 2000, "Does entrepreneurship pay?": the
//   median entrepreneur earns less than in a job, a few earn far more).
// - Capital: one year of the owner's pay is put in at the start (ASSUMPTION, order of magnitude of the
//   Kauffman Firm Survey's median start-up capital). The business's value then moves each year by a
//   log-normal shock with no average gain (ASSUMPTION, spread 0.5: young firms' growth is very
//   dispersed, Haltiwanger et al.; owners do not earn more on average than on shares, Moskowitz &
//   Vissing-Jorgensen 2002). A closed business is worth nothing; selling one fetches 90% of its value.

import type { Rng } from '../model/rng.ts';
import { gauss } from '../model/latent.ts';

const SURVIVAL = [1, 0.8, 0.7, 0.62, 0.56, 0.5, 0.47, 0.44, 0.41, 0.38, 0.35];
/** Chance a business that has been open k years closes in the coming year. */
export function closeHazard(k: number): number {
  if (k + 1 < SURVIVAL.length) return 1 - SURVIVAL[k + 1] / SURVIVAL[k];
  return 0.05;
}
export const survivalTo = (k: number) => SURVIVAL[Math.min(k, SURVIVAL.length - 1)];

export const PAY_MEDIAN = 0.75, PAY_SD = 0.8, VALUE_SD = 0.5, SALE_SHARE = 0.9;

export interface Business { start: number; capital: number; value: number; x: number; expanded: number }

export function openBusiness(age: number, yearlyPay: number, rng: Rng): Business {
  return { start: age, capital: yearlyPay, value: yearlyPay, x: PAY_MEDIAN * Math.exp(PAY_SD * gauss(rng)), expanded: 0 };
}

/** One year: the business either closes or its value moves. Returns true if it closed. */
export function businessYear(b: Business, age: number, rng: Rng): boolean {
  if (rng() < closeHazard(age - b.start)) { b.value = 0; return true; }
  b.value *= Math.exp(VALUE_SD * gauss(rng) - VALUE_SD ** 2 / 2);
  return false;
}
