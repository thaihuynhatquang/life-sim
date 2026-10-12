// A single life: the birth lottery, then year-by-year survival.

import type { Sex } from './types.ts';
import type { CountryModel, World } from './world.ts';
import { incomeAt } from './income.ts';
import { deathProb } from './mortality.ts';
import { invNorm } from './stats.ts';
import type { Rng } from './rng.ts';

export interface Birth {
  country: CountryModel;
  sex: Sex;
  wealthPct: number; // family's position in the country's income distribution, 0..1
  wealthZ: number;
  familyIncome: number; // PPP $/person/year
}

export function beBorn(world: World, rng: Rng, mode: 'births' | 'population' = 'births'): Birth {
  const country = mode === 'births' ? world.pickByBirths(rng) : world.pickByPopulation(rng);
  const sex: Sex = rng() < country.pMale ? 'M' : 'F';
  const wealthPct = rng();
  return { country, sex, wealthPct, wealthZ: invNorm(wealthPct), familyIncome: incomeAt(country.income, wealthPct) };
}

/** Survive one year at `age`? Returns true if the person dies during this year. */
export function diesThisYear(b: Birth, age: number, rng: Rng): boolean {
  return rng() < deathProb(b.country.mort[b.sex], age, b.wealthZ);
}

/** Age at death (fractional years), ignoring everything but the life table and wealth. */
export function ageAtDeath(b: Birth, rng: Rng): number {
  for (let age = 0; ; age++) {
    if (diesThisYear(b, age, rng)) {
      if (age >= 100) return 100 + 2.5; // open interval: mean remaining years used by the life table
      return age + (age === 0 ? 0.15 : 0.5);
    }
  }
}
