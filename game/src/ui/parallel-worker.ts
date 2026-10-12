// Background thread for the "parallel lives" comparison, so the page stays responsive while ~1,500 lives
// are simulated. It loads the same data, replays the finished life from its save (seeds + choices), then
// runs the comparison and posts progress and the result back.

import type { Country, LifeTables } from '../model/types.ts';
import { buildWorld, type World } from '../model/world.ts';
import type { Rng } from '../model/rng.ts';
import type { CauseData } from '../sim/causes.ts';
import { createPerson, type Person } from '../sim/person.ts';
import { setReturnsModel, type ReturnsModel } from '../sim/finance.ts';
import { rebuild, type Save } from '../sim/save.ts';
import { parallelLives } from '../sim/parallel.ts';

export interface ParallelRequest { id: number; save: Save; n: number; nWorld: number }

let world: World | undefined;
const ready = (async () => {
  const get = async <X>(f: string): Promise<X> => (await fetch(`/${f}`)).json();
  const [countries, lt, causes, returns] = await Promise.all([
    get<Record<string, Country>>('countries.json'), get<LifeTables>('lifetables.json'), get<CauseData>('causes.json'), get<ReturnsModel>('returns_model.json')]);
  setReturnsModel(returns);
  world = buildWorld(countries, lt, causes);
})();

self.onmessage = async (e: MessageEvent<ParallelRequest>) => {
  const { id, save, n, nWorld } = e.data;
  await ready;
  const w = world!;
  const r = rebuild(w, save);
  if ('error' in r) { postMessage({ id, error: r.error }); return; }
  const life: Person = r.current, b = life.b;
  // A first life's start is drawn at random by its factory: keep it fixed. Later lives start from a known family.
  const start = save.lives.length > 1 ? r.factory : (rr: Rng) => createPerson(b, rr, w.causes);
  const result = await parallelLives(w, life, start, n, nWorld, f => postMessage({ id, progress: f }));
  postMessage({ id, result });
};
