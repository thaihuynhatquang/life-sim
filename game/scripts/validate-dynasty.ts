// Dynasties: does schooling pass from parents to children as strongly as in the World Bank's Global
// Database on Intergenerational Mobility (GDIM: correlation of years of schooling, parent-child)?
// Usage: node scripts/validate-dynasty.ts [pairs=30000]
import { loadWorld } from './data.ts';
import { makeRng } from '../src/model/rng.ts';
import { simulateLife, step } from '../src/sim/simulate.ts';
import { childLife, heirsOf } from '../src/sim/dynasty.ts';

const N = Number(process.argv[2] ?? 30000);
const world = loadWorld(), rng = makeRng(11);
const yrs = (p: { plan: { schoolYears: number; university: boolean } }) => p.plan.schoolYears + (p.plan.university ? 4 : 0);
const pairs: Record<string, [number, number][]> = {};
let played = 0, consistent = 0, checked = 0, estates = 0, estateOk = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const parent = simulateLife(world, rng);
  const kids = heirsOf(parent).filter(k => (k.bornAt ?? 0) > 0);
  if (!kids.length || parent.age < 25) continue;
  const child = childLife(world, parent, kids[Math.floor(rng() * kids.length)], rng);
  while (child.alive) step(world, child, rng);
  played++;
  if (child.age >= 25) (pairs[parent.b.country.c.id] ??= []).push([yrs(parent), yrs(child)]);
  // The played parent must die in the child's life at the age they died in their own life.
  const k = parent.b.sex === 'F' ? child.mother : child.father;
  if (k.deathAge !== undefined) { checked++; if (k.deathAge === parent.age) consistent++; }
  // When the played parent dies last, the child's inheritance is exactly their net worth / children.
  if (child.money.estateFromPlayed && parent.money.lastNW !== undefined) {
    estates++;
    if (Math.abs(child.money.inherited - Math.max(0, parent.money.lastNW) / child.money.heirs) < 1) estateOk++;
  }
}
const corr = (xs: [number, number][]) => {
  const n = xs.length, mx = xs.reduce((s, x) => s + x[0], 0) / n, my = xs.reduce((s, x) => s + x[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of xs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy || 1);
};
console.log(`estate = played parent's net worth at death / number of children: ${estateOk}/${estates}`);
console.log(`${played} parent-child lives in ${((Date.now() - t0) / 1000).toFixed(0)}s; played parent dies at the same age in the child's life: ${consistent}/${checked}`);
console.log('schooling correlation parent-child: simulated vs GDIM (countries with 300+ pairs)');
let err = 0, n = 0;
for (const [id, xs] of Object.entries(pairs).sort((a, b) => b[1].length - a[1].length)) {
  if (xs.length < 300) continue;
  const c = world.byId[id].c, s = corr(xs);
  err += Math.abs(s - c.edu_cor); n++;
  console.log(`  ${id} ${xs.length.toString().padStart(5)} pairs  sim ${s.toFixed(2)}  GDIM ${c.edu_cor.toFixed(2)}`);
}
console.log(`mean |error| ${(err / n).toFixed(2)} over ${n} countries`);
