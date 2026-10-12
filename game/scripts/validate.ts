// Does the model reproduce the real statistics it was built from?
// Usage: node scripts/validate.ts [lives=200000] [seed=1]

import type { CountryModel } from '../src/model/world.ts';
import { ageAtDeath, beBorn } from '../src/model/life.ts';
import { mixtureE0 } from '../src/model/mortality.ts';
import { POVERTY_LINE, percentileOf } from '../src/model/income.ts';
import { makeRng } from '../src/model/rng.ts';
import { loadWorld } from './data.ts';

const N = Number(process.argv[2] ?? 200_000);
const rng = makeRng(Number(process.argv[3] ?? 1));
const world = loadWorld();
const pct = (x: number, d = 1) => (100 * x).toFixed(d) + '%';
const pad = (s: string | number, n: number) => String(s).padStart(n);
const head = (s: string) => console.log(`\n=== ${s} ===`);

// ---------------------------------------------------------------- 1. exact checks (no sampling)
head('1. Life expectancy, exact: wealth-mixed model vs UN (all countries, both sexes)');
{
  const diffs: [number, string][] = [];
  const scales: number[] = [];
  for (const m of world.countries) for (const sex of ['M', 'F'] as const) {
    const mm = m.mort[sex];
    scales.push(mm.scale);
    const ours = mixtureE0(mm.qx, mm.scale, mm.childBeta), un = sex === 'M' ? m.c.le_m : m.c.le_f;
    diffs.push([ours - un, `${m.c.id} ${sex}`]);
  }
  diffs.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
  console.log(`max |diff| ${diffs[0][0].toFixed(3)} y (${diffs[0][1]}), scale range ${Math.min(...scales).toFixed(3)}..${Math.max(...scales).toFixed(3)}`);
}

// ---------------------------------------------------------------- 2. simulate
const t0 = performance.now();
type Acc = { n: number; m: number; ageSum: [number, number]; nSex: [number, number]; u5: number; poor: number; q1: [number, number]; q5: [number, number] };
const acc = new Map<CountryModel, Acc>();
let males = 0, worldPoor = 0;
const incomes: number[] = [];
const q1All = [0, 0], q5All = [0, 0];
for (let i = 0; i < N; i++) {
  const b = beBorn(world, rng);
  const d = ageAtDeath(b, rng);
  let a = acc.get(b.country);
  if (!a) acc.set(b.country, a = { n: 0, m: 0, ageSum: [0, 0], nSex: [0, 0], u5: 0, poor: 0, q1: [0, 0], q5: [0, 0] });
  const s = b.sex === 'M' ? 0 : 1;
  a.n++; a.ageSum[s] += d; a.nSex[s]++;
  if (b.sex === 'M') males++;
  if (d < 5) a.u5++;
  if (b.familyIncome < POVERTY_LINE) { a.poor++; worldPoor++; }
  if (b.wealthPct < 0.2) { a.q1[0] += d; a.q1[1]++; q1All[0] += d; q1All[1]++; }
  if (b.wealthPct >= 0.8) { a.q5[0] += d; a.q5[1]++; q5All[0] += d; q5All[1]++; }
  incomes.push(b.familyIncome);
}
console.log(`\nsimulated ${N.toLocaleString()} lives in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------- 3. birth lottery
head('2. Birth lottery: where babies are born');
{
  const totalBirths = world.countries.reduce((s, m) => s + m.c.births, 0);
  let tvd = 0;
  for (const m of world.countries) tvd += Math.abs((acc.get(m)?.n ?? 0) / N - m.c.births / totalBirths) / 2;
  const top = [...world.countries].sort((a, b) => b.c.births - a.c.births).slice(0, 8);
  console.log(top.map(m => `${m.c.id} ${pct((acc.get(m)?.n ?? 0) / N)} (real ${pct(m.c.births / totalBirths)})`).join(' | '));
  const srb = world.countries.reduce((s, m) => s + m.c.births * m.pMale, 0) / totalBirths;
  console.log(`boys ${pct(males / N, 2)} (real ${pct(srb, 2)}), total variation distance ${pct(tvd, 2)}`);
}

// ---------------------------------------------------------------- 4. per-country outcomes
head('3. Top 15 countries by births: simulated vs real');
console.log(`${pad('', 4)}${pad('n', 7)} | ${pad('e0 M', 11)} ${pad('UN', 5)} | ${pad('e0 F', 11)} ${pad('UN', 5)} | ${pad('U5MR', 5)} ${pad('UN', 5)} | ${pad('<$3/d', 6)} ${pad('WB', 5)} basis | Q1-Q5 e0 gap`);
const flags: string[] = [];
for (const m of [...world.countries].sort((a, b) => b.c.births - a.c.births).slice(0, 15)) {
  const a = acc.get(m)!;
  const e = (s: 0 | 1) => a.ageSum[s] / a.nSex[s];
  const u5 = 1000 * a.u5 / a.n;
  const se = 25 / Math.sqrt(a.nSex[0]); // sd of age at death ~25y
  for (const [s, un] of [[0, m.c.le_m], [1, m.c.le_f]] as const) if (Math.abs(e(s) - un) > 3 * se) flags.push(`${m.c.id} e0 ${s ? 'F' : 'M'} off by ${(e(s) - un).toFixed(2)}y (>3 SE)`);
  console.log(`${m.c.id} ${pad(a.n, 7)} | ${pad(e(0).toFixed(1) + '±' + (2 * se).toFixed(1), 11)} ${pad(m.c.le_m.toFixed(1), 5)} | ${pad(e(1).toFixed(1) + '±' + (2 * se).toFixed(1), 11)} ${pad(m.c.le_f.toFixed(1), 5)} | ${pad(u5.toFixed(1), 5)} ${pad(m.c.u5mr.toFixed(1), 5)} | ${pad(pct(a.poor / a.n), 6)} ${pad(m.c.pov_ext.toFixed(1) + '%', 5)} ${m.income.basis.padEnd(7)} | ${(a.q5[0] / a.q5[1] - a.q1[0] / a.q1[1]).toFixed(1)}y`);
}
console.log(flags.length ? 'FLAGS:\n  ' + flags.join('\n  ') : 'no e0 outside 3 standard errors');

// ---------------------------------------------------------------- 5. income model
head('4. Income model');
{
  const basis = world.countries.filter(m => m.income.basis === 'poverty').length;
  console.log(`survey-mean / GDP ratio ${world.gdpRatio.toFixed(3)}; mu from poverty share in ${basis}/${world.countries.length} countries, from GDP in the rest`);
  // For GDP-basis countries the poverty share is a genuine out-of-sample test.
  const test = world.countries.filter(m => m.income.basis === 'gdp' && !m.c.est.includes('pov_ext'));
  const rows = test.map(m => [m.c.id, 100 * percentileOf(m.income, POVERTY_LINE), m.c.pov_ext] as const);
  const mae = rows.reduce((s, r) => s + Math.abs(r[1] - r[2]), 0) / rows.length;
  console.log(`out-of-sample (GDP-basis, real poverty known, n=${rows.length}): mean |model - real| poverty share ${mae.toFixed(2)} pts`);
  console.log('  worst: ' + [...rows].sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2])).slice(0, 5)
    .map(r => `${r[0]} ${r[1].toFixed(1)}% vs ${r[2].toFixed(1)}%`).join(', '));
  incomes.sort((a, b) => a - b);
  console.log(`newborns: ${pct(worldPoor / N)} born below $3/day; median family income $${Math.round(incomes[N >> 1]).toLocaleString()}/person/yr PPP`);
}

// ---------------------------------------------------------------- 6. wealth gradient
head('5. Wealth gradient (world, births-weighted)');
console.log(`e0 poorest fifth ${(q1All[0] / q1All[1]).toFixed(1)}y, richest fifth ${(q5All[0] / q5All[1]).toFixed(1)}y, gap ${(q5All[0] / q5All[1] - q1All[0] / q1All[1]).toFixed(1)}y`);
