// Load the data files for Node scripts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Country, LifeTables } from '../src/model/types.ts';
import { buildWorld, type World } from '../src/model/world.ts';
import type { CauseData } from '../src/sim/causes.ts';
import { setReturnsModel, type ReturnsModel } from '../src/sim/finance.ts';

const OUT = fileURLToPath(new URL('../../data/out/', import.meta.url));
const load = <T>(f: string): T => JSON.parse(readFileSync(OUT + f, 'utf8'));

export function loadWorld(): World {
  setReturnsModel(load<ReturnsModel>('returns_model.json'));
  return buildWorld(load<Record<string, Country>>('countries.json'), load<LifeTables>('lifetables.json'), load<CauseData>('causes.json'));
}
