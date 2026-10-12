// Our returns model (data/out/returns_model.json) against the real historical years it was fitted to
// (data/raw/jst/returns_rows.json, local only: the database is CC BY-NC-SA and not shipped).
// 1. Yearly returns: means, spreads, and how often crash or boom years come.
// 2. What the player's savings choices lead to: wealth at 70 relative to the usual mix, same lives.
// Usage: node scripts/validate-returns.ts [lives=3000]
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadWorld } from './data.ts';
import { makeRng } from '../src/model/rng.ts';
import { beBorn } from '../src/model/life.ts';
import { createPerson } from '../src/sim/person.ts';
import { step } from '../src/sim/simulate.ts';
import { decide, decisionAt } from '../src/sim/decisions.ts';
import { drawYear, setReturns, type Returns } from '../src/sim/finance.ts';

const ROWS = fileURLToPath(new URL('../../data/raw/jst/returns_rows.json', import.meta.url));
if (!existsSync(ROWS)) { console.log('No local historical rows (run data/pipeline/extract_jst.py first).'); process.exit(0); }
const rows = JSON.parse(readFileSync(ROWS, 'utf8')) as Returns;
const N = Number(process.argv[2] ?? 3000);
const world = loadWorld();
const pct = (x: number) => (100 * x).toFixed(1).padStart(6) + '%';

console.log('1. Yearly real returns: model (200,000 draws) vs history (1,101 country-years)');
const hist = rows.rows.map(r => ({ equity: r[2], housing: r[3], bills: r[5] }));
const rng0 = makeRng(1), model = Array.from({ length: 200000 }, () => drawYear(rng0));
for (const k of ['equity', 'housing', 'bills'] as const) {
  const st = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length), lo: v.filter(x => x < (k === 'bills' ? -0.05 : -0.2)).length / v.length, hi: v.filter(x => x > (k === 'bills' ? 0.05 : 0.3)).length / v.length }; };
  const a = st(model.map(y => y[k])), b = st(hist.map(y => y[k]));
  console.log(`  ${k.padEnd(8)} mean ${pct(a.m)} vs ${pct(b.m)} | sd ${pct(a.sd)} vs ${pct(b.sd)} | bad years ${pct(a.lo)} vs ${pct(b.lo)} | great years ${pct(a.hi)} vs ${pct(b.hi)}`);
}

console.log(`\n2. Wealth at 70 relative to the usual mix (${N} lives per strategy, same lives): model vs history`);
for (const pol of ['bank', 'stocks', 'housing']) {
  const res: Record<string, number[]> = {};
  for (const src of ['model', 'history']) {
    setReturns(src === 'history' ? rows : undefined);
    const v: number[] = [];
    for (let i = 0; i < N; i++) {
      const rng = makeRng(500 + i), p = createPerson(beBorn(world, rng), rng, world.causes);
      while (p.alive) { const d = decisionAt(world, p); if (d) { decide(p, d, d.id.startsWith('invest') ? pol : d.dflt, rng); continue; } step(world, p, rng); }
      if (p.money.wealth[70] !== undefined && (p.money.lastRaw ?? 0) > 0) v.push((p.money.invW ?? p.money.lastRaw!) / p.money.lastRaw!);
    }
    res[src] = v.sort((a, b) => a - b);
  }
  setReturns(undefined);
  const q = (v: number[], x: number) => v[Math.floor(x * (v.length - 1))].toFixed(2);
  console.log(`  ${pol.padEnd(8)} p10 ${q(res.model, 0.1)} vs ${q(res.history, 0.1)} | median ${q(res.model, 0.5)} vs ${q(res.history, 0.5)} | p90 ${q(res.model, 0.9)} vs ${q(res.history, 0.9)}`);
}
