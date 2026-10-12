// Saving and sharing a family line. A life is fully determined by its random seed, the child chosen
// from the previous life and the options picked at each decision, so that is all a save holds (a few
// hundred bytes per life). Loading replays the lives with the model.
//
// A model change can make an old save replay differently. MODEL_VERSION is stored with each save; when
// a replayed decision does not match the saved one, loading stops and says so instead of showing a
// different life.

import type { World } from '../model/world.ts';
import { makeRng, type Rng } from '../model/rng.ts';
import { beBorn } from '../model/life.ts';
import { createPerson, type Person } from './person.ts';
import { step } from './simulate.ts';
import { decideAndLog, decisionAt, type Decision } from './decisions.ts';
import { childLife, heirsOf } from './dynasty.ts';

/** Change whenever the model changes how lives unfold. */
export const MODEL_VERSION = '2026-10-13i';

export interface SavedLife {
  seed: number;
  heir?: number; // index in heirsOf(previous life); absent for the first life
  choices: [string, string][]; // [decision id, option] in the order they were made
  age: number; // age reached (the current life)
  done?: boolean; // the life has ended (replay through the year of death)
}
export interface Save { v: string; lives: SavedLife[]; who?: { name: string; age: number; alive: boolean } } // who: for the resume button only

export type Factory = (r: Rng) => Person;

export function firstLife(world: World): Factory {
  return r => createPerson(beBorn(world, r), r, world.causes);
}

export interface Rebuilt { done: Person[]; current: Person; rng: Rng; factory: Factory; pending?: Decision }

/** Replay a save. Returns an error message instead if the model no longer gives the same lives. */
export function rebuild(world: World, save: Save): Rebuilt | { error: string } {
  if (!save.lives.length) return { error: 'empty' };
  const done: Person[] = [];
  let parent: Person | undefined;
  for (let i = 0; i < save.lives.length; i++) {
    const life = save.lives[i], last = i === save.lives.length - 1;
    let factory: Factory;
    if (i === 0) factory = firstLife(world);
    else {
      const heir = heirsOf(parent!)[life.heir ?? -1];
      if (!heir) return { error: 'heir' };
      const dead = parent!;
      factory = r => childLife(world, dead, heir, r);
    }
    const rng = makeRng(life.seed);
    const p = factory(rng);
    let ci = 0, pending: Decision | undefined;
    while (p.alive) {
      const d = decisionAt(world, p);
      if (d) {
        if (ci < life.choices.length) {
          const [id, key] = life.choices[ci++];
          if (id !== d.id || !d.options.some(o => o.key === key)) return { error: 'mismatch' };
          decideAndLog(p, d, key, rng);
          continue;
        }
        if (last) { pending = d; break; }
        return { error: 'mismatch' };
      }
      if (last && !life.done && p.age >= life.age) break;
      step(world, p, rng);
    }
    if (!last) {
      if (p.alive) return { error: 'mismatch' };
      done.push(p);
      parent = p;
    } else return { done, current: p, rng, factory, pending };
  }
  return { error: 'empty' };
}

// ---------------------------------------------------------------- encoding for links and storage

export function encodeSave(save: Save): string {
  const bytes = new TextEncoder().encode(JSON.stringify(save));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSave(s: string): Save | undefined {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const json = new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
    const v = JSON.parse(json) as Save;
    return Array.isArray(v?.lives) ? v : undefined;
  } catch { return undefined; }
}
