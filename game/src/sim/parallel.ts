// "A thousand parallel lives": after a life ends, live the same start many more times to see how much of
// the outcome was luck, how much the player's choices, and how much where and to whom they were born.
//
//   same start, usual choices  -> spread = luck; the player's percentile in it
//   same start, your choices   -> mean difference from the line above = effect of your choices
//   anyone, anywhere (births)  -> mean difference from the first line = effect of the start in life
//
// A life is reproducible from its random stream, so these runs need nothing but the model.

import type { World } from '../model/world.ts';
import { makeRng, type Rng } from '../model/rng.ts';
import { beBorn } from '../model/life.ts';
import { createPerson, schoolYearsDone, type Person } from './person.ts';
import { step } from './simulate.ts';
import { decide, decisionAt, type Decision } from './decisions.ts';

export interface Outcome { life: number; school: number; income40?: number; ladder?: number; kids: number }
export const METRICS = ['life', 'school', 'income40', 'ladder', 'kids'] as const;
export type Metric = typeof METRICS[number];

export function outcome(p: Person): Outcome {
  return {
    life: Math.floor(p.ageAtDeath ?? p.age),
    school: schoolYearsDone(p),
    income40: p.money.byAge[40]?.perCapita, // household income per person at 40, 2021 PPP $/month
    ladder: p.ladder.n ? p.ladder.sum / p.ladder.n : undefined,
    kids: p.children.length,
  };
}

type Policy = (p: Person, d: Decision) => string;
export const usual: Policy = (_p, d) => d.dflt;
/** The player's choices: the same option for the same decision; for repeated kinds (school-6, quit-40,
 *  marry-27) the last option they chose for that kind. */
export function yours(played: Person): Policy {
  const byKind: Record<string, string> = {};
  for (const [id, key] of Object.entries(played.decided)) byKind[id.replace(/-\d+$/, '')] = key;
  return (_p, d) => played.decided[d.id] ?? byKind[d.id.replace(/-\d+$/, '')] ?? d.dflt;
}

function live(world: World, p: Person, rng: Rng, policy: Policy): Person {
  while (p.alive) {
    const d = decisionAt(world, p);
    if (d) { const key = policy(p, d); decide(p, d, d.options.some(o => o.key === key) ? key : d.dflt, rng); continue; }
    step(world, p, rng);
  }
  return p;
}

export interface Parallel { same: Outcome[]; sameYours: Outcome[]; world: Outcome[] }

/** Runs n lives with the same start (and, if the player ever chose differently from most people, the
 *  same n lives again with their choices) plus nWorld babies born anywhere; yields to the page every few
 *  lives (onProgress gets 0..1). */
export async function parallelLives(world: World, played: Person, start: (r: Rng) => Person, n: number, nWorld: number,
  onProgress?: (f: number) => void): Promise<Parallel> {
  const out: Parallel = { same: [], sameYours: [], world: [] };
  const mine = yours(played);
  // Only usual choices: the "your choices" lives would be the very same lives, so they are not rerun.
  const unusual = !!played.choseUnusual;
  const total = n * (unusual ? 2 : 1) + nWorld;
  let done = 0;
  const tick = async () => { if (++done % 25 === 0) { onProgress?.(done / total); await new Promise(res => setTimeout(res, 0)); } };
  for (let i = 0; i < n; i++) {
    const a = makeRng(1000 + i);
    const o = outcome(live(world, start(a), a, usual));
    out.same.push(o);
    await tick();
    if (unusual) {
      // Same random stream as above: the difference is only the choices (paired comparison).
      const b = makeRng(1000 + i);
      out.sameYours.push(outcome(live(world, start(b), b, mine)));
      await tick();
    } else out.sameYours.push(o);
  }
  for (let i = 0; i < nWorld; i++) {
    const r = makeRng(9000 + i);
    out.world.push(outcome(live(world, createPerson(beBorn(world, r), r, world.causes), r, usual)));
    await tick();
  }
  return out;
}

/** Share of values strictly below x, plus half the ties (0..1). */
export function percentile(values: number[], x: number): number {
  let below = 0, equal = 0;
  for (const v of values) { if (v < x) below++; else if (v === x) equal++; }
  return values.length ? (below + equal / 2) / values.length : 0.5;
}

/** Typical value of a group: the mean, except for income where a few very rich lives would pull the
 *  mean far above what most people have (the median is used). */
export const meanOf = (xs: Outcome[], m: Metric): number | undefined => {
  const v = xs.map(o => o[m]).filter((x): x is number => x !== undefined);
  if (!v.length) return undefined;
  if (m === 'income40') { v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; }
  return v.reduce((s, x) => s + x, 0) / v.length;
};
export const valuesOf = (xs: Outcome[], m: Metric) => xs.map(o => o[m]).filter((x): x is number => x !== undefined);
