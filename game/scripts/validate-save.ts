// Saves replay to exactly the same lives: random playthroughs (random choices, 1-3 generations, stopped
// at a random age), saved, encoded as a share link, decoded and replayed; the event logs must match.
// Usage: node scripts/validate-save.ts
import { loadWorld } from './data.ts';
import { makeRng } from '../src/model/rng.ts';
import { step } from '../src/sim/simulate.ts';
import { decideAndLog, decisionAt } from '../src/sim/decisions.ts';
import { childLife, heirsOf } from '../src/sim/dynasty.ts';
import { firstLife, rebuild, encodeSave, decodeSave, MODEL_VERSION, type SavedLife } from '../src/sim/save.ts';
const world = loadWorld(), pick = makeRng(77);
let ok = 0, bad = 0, bytes = 0;
for (let t = 0; t < 200; t++) {
  const lives: SavedLife[] = [];
  let factory = firstLife(world), parent: any, final: any;
  const gens = 1 + Math.floor(pick() * 3);
  for (let g = 0; g < gens; g++) {
    const seed = Math.floor(pick() * 1e9), rng = makeRng(seed);
    const p = factory(rng);
    const entry: SavedLife = { seed, heir: g ? (lives as any).heirIdx : undefined, choices: [], age: 0 };
    lives.push(entry);
    const last = g === gens - 1, stopAt = last ? Math.floor(pick() * 90) : 999;
    while (p.alive && p.age < stopAt) {
      const d = decisionAt(world, p);
      if (d) { const o = d.options[Math.floor(pick() * d.options.length)].key; entry.choices.push([d.id, o]); decideAndLog(p, d, o, rng); continue; }
      step(world, p, rng);
    }
    entry.age = p.age; entry.done = !p.alive; final = p;
    if (!last) {
      const heirs = heirsOf(p);
      if (!heirs.length) { break; }
      const hi = Math.floor(pick() * heirs.length), child = heirs[hi], dead = p;
      (lives as any).heirIdx = hi;
      factory = r => childLife(world, dead, child, r);
    }
  }
  for (const l of lives) if (l.heir === undefined && lives.indexOf(l) > 0) l.heir = 0;
  const code = encodeSave({ v: MODEL_VERSION, lives });
  bytes += code.length;
  const r = rebuild(world, decodeSave(code)!);
  if ('error' in r) { bad++; console.log('error', r.error); continue; }
  const same = JSON.stringify(r.current.log) === JSON.stringify(final.log);
  same ? ok++ : bad++;
  if (!same && bad <= 3) {
    const a = r.current.log, b = final.log;
    let i = 0; while (i < Math.min(a.length, b.length) && JSON.stringify(a[i]) === JSON.stringify(b[i])) i++;
    console.log('gens', lives.length, 'diff at', i, '| replay:', a[i]?.age, a[i]?.text.en, '| play:', b[i]?.age, b[i]?.text.en, '| lens', a.length, b.length);
  }
}
console.log(`replayed identically: ${ok}/${ok + bad}; average share code ${Math.round(bytes / 200)} characters`);
