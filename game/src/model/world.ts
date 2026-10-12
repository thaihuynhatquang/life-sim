// Everything precomputed once from the data files: per-country income and mortality models,
// and the birth lottery.

import type { Country, LifeTables, Sex } from './types.ts';
import { buildIncomeModel, surveyToGdpRatio, type IncomeModel } from './income.ts';
import { buildMortalityModel, type MortalityModel } from './mortality.ts';
import { makeWeightedPicker, type Rng } from './rng.ts';
import type { CauseData } from '../sim/causes.ts';
import { setCauses } from '../sim/calibrate.ts';

export interface CountryModel {
  c: Country;
  income: IncomeModel;
  mort: Record<Sex, MortalityModel>;
  pMale: number;
}

export interface World {
  countries: CountryModel[];
  byId: Record<string, CountryModel>;
  gdpRatio: number;
  totalBirths: number;
  causes: CauseData;
  pickByBirths: (rng: Rng) => CountryModel;
  pickByPopulation: (rng: Rng) => CountryModel;
}

export function buildWorld(data: Record<string, Country>, lt: LifeTables, causes: CauseData): World {
  const list = Object.values(data);
  const gdpRatio = surveyToGdpRatio(list);
  const countries = list.map(c => ({
    c,
    income: buildIncomeModel(c, gdpRatio),
    mort: { M: buildMortalityModel(lt, c.id, 'M', c.u5_beta ?? 0.25), F: buildMortalityModel(lt, c.id, 'F', c.u5_beta ?? 0.25) },
    pMale: c.srb / (100 + c.srb),
  }));
  const byBirths = makeWeightedPicker(countries.map(m => m.c.births));
  const byPop = makeWeightedPicker(countries.map(m => m.c.pop));
  setCauses(causes);
  return {
    countries,
    byId: Object.fromEntries(countries.map(m => [m.c.id, m])),
    gdpRatio,
    totalBirths: countries.reduce((s, m) => s + m.c.births, 0),
    causes,
    pickByBirths: rng => countries[byBirths(rng)],
    pickByPopulation: rng => countries[byPop(rng)],
  };
}
