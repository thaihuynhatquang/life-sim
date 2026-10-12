// Does the wealth model reproduce WID thresholds and Forbes billionaire counts?
// Usage: node scripts/validate-wealth.ts [draws=2000000]

import { loadWorld } from './data.ts';
import { makeRng } from '../src/model/rng.ts';
import { invNorm } from '../src/model/stats.ts';
import { billionaireShare, wealthAt, wealthModel, wealthRank } from '../src/model/wealth.ts';

const N = Number(process.argv[2] ?? 2_000_000);
const world = loadWorld(), rng = makeRng(7);
const pct = (x: number) => (100 * x).toFixed(1) + '%';

// 1. Quantile function vs WID thresholds at the knots: exact by construction; check the interpolation
//    between knots against a held-out point (the 85th percentile is not a knot).
console.log('=== 1. Interpolation: wealth at p85 vs average of the p80 and p90 thresholds (log scale), 10 big countries');
for (const id of ['IND', 'CHN', 'USA', 'IDN', 'PAK', 'NGA', 'BRA', 'BGD', 'RUS', 'MEX']) {
  const c = world.byId[id].c, g = c.wealth;
  const i80 = g.grid.indexOf(0.8), i90 = g.grid.indexOf(0.9);
  const mid = Math.sqrt(g.ppp[i80] * g.ppp[i90]);
  console.log(`  ${id} p85 model $${Math.round(wealthAt(c, 0.85)).toLocaleString()} | geometric mean of p80,p90 $${Math.round(mid).toLocaleString()}`);
}

// 2. Sampling: draw uniform ranks, check the share of adults above WID thresholds and billionaires.
console.log(`\n=== 2. Billionaires: modelled share of adults vs Forbes count / WID adults (${N.toLocaleString()} draws per country not needed: analytic)`);
let totalModel = 0, totalForbes = 0;
const rows: [string, number, number, number][] = [];
for (const m of world.countries) {
  const c = m.c, b = c.wealth.billionaires;
  const model = billionaireShare(c) * c.wealth.adults;
  totalModel += model; totalForbes += b;
  rows.push([c.id, model, b, c.wealth.adults]);
}
console.log(`  billionaires: model ${Math.round(totalModel)} vs Forbes ${totalForbes} (matched countries)`);
const worst = rows.filter(r => r[2] > 0).map(r => [r[0], r[1], r[2]] as const).sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2])).slice(0, 5);
console.log('  largest gaps: ' + worst.map(w => `${w[0]} ${w[1].toFixed(0)}/${w[2]}`).join(', '));
const skipped = rows.filter(r => r[2] > 0 && Math.abs(r[1] - r[2]) > 0.2 * r[2]).map(r => `${r[0]} ${r[1].toFixed(0)}/${r[2]}`);
console.log(`  countries off by >20%: ${skipped.length ? skipped.join(', ') : 'none'}`);

// 3. Odds a newborn ends up a billionaire, births-weighted, and for some countries.
const share = (id: string) => billionaireShare(world.byId[id].c);
const worldShare = world.countries.reduce((s, m) => s + billionaireShare(m.c) * m.c.births, 0) / world.totalBirths;
console.log(`\n=== 3. Chance of being a billionaire as an adult (born where births happen): 1 in ${Math.round(1 / worldShare).toLocaleString()}`);
for (const id of ['USA', 'CHN', 'IND', 'DEU', 'VNM', 'NGA', 'BRA', 'ETH', 'CHE', 'SGP']) {
  const s = world.byId[id] ? share(id) : 0;
  console.log(`  ${id}: ${s > 0 ? '1 in ' + Math.round(1 / s).toLocaleString() : 'none listed'}`);
}

// 4. Wealth ranks: simulated shares above thresholds for the world (births-weighted draws).
console.log('\n=== 4. Wealth of a random adult (world, births-weighted draws, 2021 PPP $)');
const draws: number[] = [];
for (let i = 0; i < N; i++) { const m = world.pickByBirths(rng); draws.push(wealthAt(m.c, rng())); }
draws.sort((a, b) => a - b);
for (const q of [0.1, 0.5, 0.9, 0.99, 0.999, 0.9999]) console.log(`  p${q * 100}: $${Math.round(draws[Math.floor(q * (N - 1))]).toLocaleString()}`);
const bill = world.countries.reduce((s, m) => s + m.c.births, 0);
console.log(`  share of draws above $1m PPP: ${pct(draws.filter(x => x >= 1e6).length / N)} ; above $10m: ${pct(draws.filter(x => x >= 1e7).length / N)}`);
void wealthModel; void wealthRank; void invNorm; void bill;
