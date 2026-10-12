// Live one life in the terminal.
// Usage: node scripts/live.ts [vi|en] [seed] [ISO3 to force a country]

import { loadWorld } from './data.ts';
import { makeRng } from '../src/model/rng.ts';
import { simulateLife } from '../src/sim/simulate.ts';
import type { Lang } from '../src/sim/i18n.ts';

const lang = (process.argv[2] ?? 'vi') as Lang;
const seed = Number(process.argv[3] ?? Date.now() % 1e9);
const force = process.argv[4];

const world = loadWorld();
let rng = makeRng(seed);
let p = simulateLife(world, rng);
// Forcing a country: keep drawing lives until one is born there (keeps the birth logic untouched).
for (let s = seed + 1; force && p.c.id !== force; s++) p = simulateLife(world, rng = makeRng(s));

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const ICON: Record<string, string> = { birth: '👶', family: '🏠', school: '📚', love: '💍', work: '🔨', health: '🩺', loss: '🕯️', death: '⚰️' };

console.log(dim(`seed ${seed}`) + '\n');
let lastAge = -1;
for (const e of p.log) {
  const ageCol = e.age === lastAge ? '      ' : (lang === 'vi' ? `${e.age} tuổi` : `age ${e.age}`).padEnd(6);
  lastAge = e.age;
  console.log(`${ageCol} ${ICON[e.kind] ?? ' '} ${e.text[lang]}`);
  if (e.source) console.log(`${' '.repeat(9)}${dim(e.source[lang])}`);
}
const kids = p.children.length, kidsAlive = p.children.filter(k => k.alive).length;
const grand = p.grandchildren.filter(k => k.alive).length, great = p.greatGrandchildren.filter(k => k.alive).length;
console.log('\n' + dim(lang === 'vi'
  ? `Sống ${Math.floor(p.ageAtDeath!)} năm · ${kids} con (${kidsAlive} còn sống) · ${grand} cháu, ${great} chắt · ${p.plan.schoolYears + (p.plan.university ? 4 : 0)} năm đi học`
  : `Lived ${Math.floor(p.ageAtDeath!)} years · ${kids} children (${kidsAlive} alive) · ${grand} grandchildren, ${great} great-grandchildren · ${p.plan.schoolYears + (p.plan.university ? 4 : 0)} years of school`));
