// Do full simulated lives (with events) reproduce each country's statistics?
// Usage: node scripts/validate-life.ts [lives=100000] [seed=1]

import { loadWorld } from './data.ts';
import { makeRng } from '../src/model/rng.ts';
import { simulateLife } from '../src/sim/simulate.ts';
import type { Country } from '../src/model/types.ts';
import type { Person } from '../src/sim/person.ts';
import { asfrAt, chronicModel, hivModel, marriage, schoolFit, uniTarget } from '../src/sim/calibrate.ts';
import { ageGroup } from '../src/sim/causes.ts';
import { POVERTY_LINE } from '../src/model/income.ts';
import { bandOf, eduLevel, vocationalShare } from '../src/sim/work.ts';

const N = Number(process.argv[2] ?? 100_000);
const rng = makeRng(Number(process.argv[3] ?? 1));
const world = loadWorld();

/** A metric: who counts (denominator), the simulated value per person, and the real target. */
interface Metric {
  key: string;
  label: string;
  who: (p: Person) => boolean;
  value: (p: Person) => number;
  target: (c: Country) => number;
  scale: number; // display multiplier (100 for shares)
}
const lived = (p: Person, a: number) => (p.ageAtDeath ?? 0) >= a;
const F = (p: Person) => p.b.sex === 'F';
import { wealthRank } from '../src/model/wealth.ts';
const wealthRankZero = (c: Country) => wealthRank(c, 0);
const chronAt = (c: Country, kind: 'dm' | 'ht' | 'aud' | 'obese', age: number) => {
  const m = chronicModel(world.byId[c.id], world.causes, kind);
  return (m.F.alive[age] + m.M.alive[age]) / 2;
};
const METRICS: Metric[] = [
  { key: 'e0', label: 'life expectancy', who: () => true, value: p => p.ageAtDeath!, target: c => c.le, scale: 1 },
  { key: 'u5', label: 'die before 5 (per 1000)', who: () => true, value: p => +(p.ageAtDeath! < 5), target: c => c.u5mr / 1000, scale: 1000 },
  { key: 'elec', label: 'born with electricity %', who: () => true, value: p => +p.electricity, target: c => c.electricity / 100, scale: 100 },
  { key: 'water', label: 'born with basic water %', who: () => true, value: p => +p.water, target: c => c.water / 100, scale: 100 },
  { key: 'san', label: 'born with basic sanitation %', who: () => true, value: p => +p.sanitation, target: c => c.sanitation / 100, scale: 100 },
  { key: 'fuel', label: 'born with clean cooking %', who: () => true, value: p => +p.cleanFuel, target: c => c.clean_fuel / 100, scale: 100 },
  { key: 'slum', label: 'urban-born in slums %', who: p => p.urban, value: p => +p.slum, target: c => c.slum / 100, scale: 100 },
  { key: 'reg', label: 'birth registered %', who: () => true, value: p => +p.registered, target: c => c.birth_reg / 100, scale: 100 },
  { key: 'stunt', label: 'stunted %', who: p => lived(p, 2), value: p => +p.stunted, target: c => c.stunting / 100, scale: 100 },
  { key: 'prim', label: 'finished primary %', who: p => lived(p, 18), value: p => +(p.plan.schoolYears >= 6), target: c => schoolFit(c).pAtLeast[6], scale: 100 },
  { key: 'lsec', label: 'finished lower secondary %', who: p => lived(p, 18), value: p => +(p.plan.schoolYears >= 9), target: c => schoolFit(c).pAtLeast[9], scale: 100 },
  { key: 'usec', label: 'finished upper secondary %', who: p => lived(p, 18), value: p => +(p.plan.schoolYears >= 12), target: c => schoolFit(c).pAtLeast[12], scale: 100 },
  { key: 'uni', label: 'university % (cap: upper-sec finishers)', who: p => lived(p, 22), value: p => +p.plan.university, target: c => Math.min(uniTarget(c), schoolFit(c).pAtLeast[12]), scale: 100 },
  { key: 'cm', label: 'women married <18 %', who: p => F(p) && lived(p, 20), value: p => +(p.plan.childMarriageAge !== undefined), target: c => c.child_marriage / 100, scale: 100 },
  { key: 'mF25', label: 'women married before 25 %', who: p => F(p) && lived(p, 25), value: p => +((p.plan.marriageAge ?? 99) < 25), target: c => marriage(c).F.shareBy(25), scale: 100 },
  { key: 'evF', label: 'women ever married by 48 %', who: p => F(p) && lived(p, 48), value: p => +(p.plan.marriageAge !== undefined), target: c => marriage(c).F.ever, scale: 100 },
  { key: 'evM', label: 'men ever married by 48 %', who: p => !F(p) && lived(p, 48), value: p => +(p.plan.marriageAge !== undefined), target: c => marriage(c).M.ever, scale: 100 },
  { key: 'divF', label: 'women 42: divorced/separated % of ever-married', who: p => F(p) && lived(p, 43) && p.marriages > 0, value: p => +(p.statusAt[42] === 'divorced'), target: c => c.marr_status.F.div[4], scale: 100 },
  { key: 'divM', label: 'men 42: divorced/separated % of ever-married', who: p => !F(p) && lived(p, 43) && p.marriages > 0, value: p => +(p.statusAt[42] === 'divorced'), target: c => c.marr_status.M.div[4], scale: 100 },
  { key: 'widF', label: 'women 62: widowed % of ever-married', who: p => F(p) && lived(p, 63) && p.marriages > 0, value: p => +(p.statusAt[62] === 'widowed'), target: c => c.marr_status.F.wid[8], scale: 100 },
  { key: 'widM', label: 'men 62: widowed % of ever-married', who: p => !F(p) && lived(p, 63) && p.marriages > 0, value: p => +(p.statusAt[62] === 'widowed'), target: c => c.marr_status.M.wid[8], scale: 100 },
  { key: 'hivF', label: 'women 35 living with HIV %', who: p => F(p) && lived(p, 36), value: p => +((p.plan.hivAge ?? 99) <= 35), target: c => hivModel(world.byId[c.id], world.causes).F.alive[35], scale: 100 },
  { key: 'hivM', label: 'men 35 living with HIV %', who: p => !F(p) && lived(p, 36), value: p => +((p.plan.hivAge ?? 99) <= 35), target: c => hivModel(world.byId[c.id], world.causes).M.alive[35], scale: 100 },
  { key: 'abroad', label: 'living abroad at 45 % (born here)', who: p => lived(p, 46) && !!p.c.mig, value: p => +((p.plan.emigrateAge ?? 99) <= 45), target: c => c.mig ? (c.mig.abroad.M + c.mig.abroad.F) / 2 : 0, scale: 100 },
  { key: 'refug', label: 'refugees % of emigrants', who: p => p.plan.emigrateAge !== undefined, value: p => +!!p.plan.refugee, target: c => c.mig?.refugee_share ?? 0, scale: 100 },
  { key: 'uY', label: 'unemployed % of time, workers 15-24', who: p => p.workYears.young > 0, value: p => p.workYears.youngOut / p.workYears.young, target: c => (c.unemp_age.F.u15 + c.unemp_age.M.u15) / 2, scale: 100 },
  { key: 'uA', label: 'unemployed % of time, workers 25+', who: p => p.workYears.adult > 0, value: p => p.workYears.adultOut / p.workYears.adult, target: c => (c.unemp_age.F.u25 + c.unemp_age.M.u25) / 2, scale: 100 },
  // Targets: the cohort model's prevalence at that age, fitted to WHO prevalence among adults.
  { key: 'dm', label: 'living with diabetes at 55 %', who: p => lived(p, 56), value: p => +((p.plan.diabetesAge ?? 999) <= 55), target: c => chronAt(c, 'dm', 55), scale: 100 },
  { key: 'ht', label: 'living with hypertension at 52 %', who: p => lived(p, 53), value: p => +((p.plan.hypertensionAge ?? 999) <= 52), target: c => chronAt(c, 'ht', 52), scale: 100 },
  { key: 'accF', label: 'women with account at 35 %', who: p => F(p) && lived(p, 36), value: p => +((p.plan.accountAge ?? 99) <= 35), target: c => c.account_f / 100, scale: 100 },
  { key: 'accP', label: 'account at 35 %, poorest 40%', who: p => lived(p, 36) && p.adultZ < -0.2533, value: p => +((p.plan.accountAge ?? 99) <= 35), target: c => c.account_p40 / 100, scale: 100 },
  { key: 'accR', label: 'account at 35 %, richest 60%', who: p => lived(p, 36) && p.adultZ >= -0.2533, value: p => +((p.plan.accountAge ?? 99) <= 35), target: c => c.account_r60 / 100, scale: 100 },
  { key: 'obese', label: 'obese at 50 % (model at that age)', who: p => lived(p, 51), value: p => +((p.plan.obeseAge ?? 999) <= 50), target: c => chronAt(c, 'obese', 50), scale: 100 },
  { key: 'aud', label: 'alcohol use disorder at 40 %', who: p => lived(p, 41), value: p => +((p.plan.alcoholAge ?? 999) <= 40), target: c => chronAt(c, 'aud', 40), scale: 100 },
  { key: 'hgt', label: 'adult height, cm', who: p => lived(p, 18), value: p => p.plan.heightCm, target: c => NaN, scale: 1 },
  { key: 'pens', label: 'pension at 70 %', who: p => lived(p, 71) && p.pension !== undefined, value: p => +!!p.pension, target: () => NaN, scale: 100 },
  { key: 'alone80', label: 'living alone at 82 %', who: p => p.livingAt[82] !== undefined, value: p => +(p.livingAt[82] === 'alone'), target: () => NaN, scale: 100 },
  { key: 'kids70', label: 'living with children at 70 %', who: p => p.livingAt[70] !== undefined, value: p => +(p.livingAt[70] === 'children'), target: () => NaN, scale: 100 },
  { key: 'earnM', label: 'men employees 40: monthly earnings vs ILO (ratio x100)', who: p => !F(p) && p.jobAt40?.status === 'emp' && !!p.money.byAge[40], value: p => p.money.byAge[40].own / (p.residence?.c ?? p.c).earn.M.total / ((p.residence?.c ?? p.c).earn.M.age['25'] ?? 1), target: () => 1, scale: 100 },
  { key: 'earnF', label: 'women employees 40: monthly earnings vs ILO (x100)', who: p => F(p) && p.jobAt40?.status === 'emp' && !!p.money.byAge[40], value: p => p.money.byAge[40].own / (p.residence?.c ?? p.c).earn.F.total / ((p.residence?.c ?? p.c).earn.F.age['25'] ?? 1), target: () => 1, scale: 100 },
  { key: 'pov40', label: 'below $3/day at 40 (household per person) %', who: p => !!p.money.byAge[40] && !p.residence && !p.c.est.includes('pov_ext'), value: p => +(p.money.byAge[40].perCapita < POVERTY_LINE / 12), target: c => c.pov_ext / 100, scale: 100 },
  { key: 'nw50', label: 'positive net worth at 50 %', who: p => lived(p, 51) && p.money.wealth[50] !== undefined, value: p => +(p.money.wealth[50] > 0), target: c => 1 - wealthRankZero(c), scale: 100 },
  { key: 'oopImp', label: 'years with impoverishing health bill %', who: p => !p.residence && p.money.bills.years > 0, value: p => p.money.bills.impov / p.money.bills.years, target: c => c.oop_imp / 100, scale: 100 },
  { key: 'oopLrg', label: 'years with large health bill %', who: p => !p.residence && p.money.bills.years > 0, value: p => p.money.bills.large / p.money.bills.years, target: c => c.oop_large / 100, scale: 100 },
  { key: 'lad20', label: 'life satisfaction at 20 (0-10)', who: p => !p.residence && p.ladder.at[20] !== undefined, value: p => p.ladder.at[20], target: c => c.ladder, scale: 1 },
  { key: 'lad40', label: 'life satisfaction at 40 (0-10)', who: p => !p.residence && p.ladder.at[40] !== undefined, value: p => p.ladder.at[40], target: c => c.ladder, scale: 1 },
  { key: 'lad60', label: 'life satisfaction at 60 (0-10)', who: p => !p.residence && p.ladder.at[60] !== undefined, value: p => p.ladder.at[60], target: c => c.ladder, scale: 1 },
  { key: 'teen', label: 'births at 15-19 per woman (alive at 20)', who: p => F(p) && lived(p, 20), value: p => p.children.filter(k => k.bornAt! < 20).length, target: c => [15, 16, 17, 18, 19].reduce((s, a) => s + asfrAt(c, a), 0), scale: 1 },
  { key: 'tfr', label: 'children per woman (alive at 50)', who: p => F(p) && lived(p, 50), value: p => p.children.length, target: c => c.tfr, scale: 1 },
  { key: 'lfpF', label: 'women working at 25-54 %', who: p => F(p) && lived(p, 40), value: p => +p.plan.worksOutside, target: c => c.lfp_age.F.p25, scale: 100 },
  { key: 'lfpM', label: 'men working at 25-54 %', who: p => !F(p) && lived(p, 40), value: p => +p.plan.worksOutside, target: c => c.lfp_age.M.p25, scale: 100 },
  { key: 'w60', label: 'working at 59 (55-64 mid) % both sexes', who: p => lived(p, 60), value: p => +(p.plan.worksOutside && p.plan.exitAge > 59), target: c => (c.lfp_age.F.p55 + c.lfp_age.M.p55) / 2, scale: 100 },
  { key: 'w72', label: 'working at 71 (65+ mean) % both sexes', who: p => lived(p, 72), value: p => +(p.plan.worksOutside && p.plan.exitAge > 71), target: c => (c.lfp_age.F.p65 + c.lfp_age.M.p65) / 2, scale: 100 },
  { key: 'agr', label: 'workers at 40 in agriculture %', who: p => !!p.jobAt40, value: p => +(p.jobAt40!.sector === 'agr'), target: c => (c.work.F.sector.agr + c.work.M.sector.agr) / 2, scale: 100 },
  { key: 'inf', label: 'workers at 40 informal %', who: p => !!p.jobAt40, value: p => +p.jobAt40!.informal, target: c => ((c.work.F.informal ?? 0) + (c.work.M.informal ?? 0)) / 2, scale: 100 },
  { key: 'empl', label: 'workers at 40 employees %', who: p => !!p.jobAt40, value: p => +(p.jobAt40!.status === 'emp'), target: c => (c.work.F.status.emp + c.work.M.status.emp) / 2, scale: 100 },
  { key: 'voc', label: 'vocational % of upper-sec non-graduates', who: p => p.plan.schoolYears >= 10 && !p.plan.university && lived(p, 18), value: p => +!!p.plan.vocational, target: c => vocationalShare(c), scale: 100 },
  { key: 'smoke', label: 'smokers at 30 %', who: p => lived(p, 30), value: p => +p.smoker, target: () => NaN, scale: 100 },
];

// Smoking target depends on sex; compare per-person expected share instead.
const smokeTarget = (p: Person) => (F(p) ? p.c.smoke_f : p.c.smoke_m) / 100;

type Sum = { n: number; s: number; t: number };
const per = new Map<string, Map<string, Sum>>(); // country -> metric -> sums
const add = (iso: string, key: string, v: number, tg: number) => {
  let m = per.get(iso); if (!m) per.set(iso, m = new Map());
  let x = m.get(key); if (!x) m.set(key, x = { n: 0, s: 0, t: 0 });
  x.n++; x.s += v; x.t += tg;
};

const t0 = performance.now();
const extra = { orphan18: 0, alive18: 0, lostChild: 0, parents: 0 };
// Causes of death: simulated count per cause kind vs the WHO expectation for each death's cell.
const cd = world.causes;
const kindSim = new Map<string, number>(), kindExp = new Map<string, number>();
const keySim = new Map<string, number>(), keyExp = new Map<string, number>();
let deaths = 0;
// Under-5 deaths by wealth fifth, per country (to compare the poorest/richest ratio with DHS).
const u5q = new Map<string, { n: number[]; d: number[] }>();
// Compact per-person records for the work checks (full lives are too big to keep).
type Lite = Pick<Person, 'plan' | 'b' | 'c' | 'residence' | 'jobAt40'> & { career: { history: Person['career']['history'] } };
const lives: Lite[] = [];
for (let i = 0; i < N; i++) {
  const p = simulateLife(world, rng);
  lives.push({ plan: p.plan, b: p.b, c: p.c, residence: p.residence, jobAt40: p.jobAt40, career: { history: p.career.history } });
  for (const m of METRICS) if (m.who(p)) add(p.c.id, m.key, m.value(p), m.key === 'smoke' ? smokeTarget(p) : m.key === 'hgt' ? p.c.height[p.b.sex]
    : m.key === 'pens' ? p.c.pension[p.b.sex] : m.key === 'alone80' ? p.c.living[p.b.sex]['80'].alone
    : m.key === 'kids70' ? p.c.living[p.b.sex]['65'].children : m.target(p.c));
  {
    deaths++;
    const age = Math.floor(p.ageAtDeath!);
    const cell = cd.data[(p.residence?.c ?? p.c).id]?.[p.b.sex]?.[ageGroup(cd, age)] ?? {};
    for (const [i, sh] of Object.entries(cell)) {
      const c = cd.causes[Number(i)];
      kindExp.set(c.kind, (kindExp.get(c.kind) ?? 0) + sh);
      keyExp.set(c.key, (keyExp.get(c.key) ?? 0) + sh);
    }
    const k = cd.causes.find(c => c.key === p.causeKey) ?? { kind: 'ncd', key: 'unknown' };
    kindSim.set(k.kind, (kindSim.get(k.kind) ?? 0) + 1);
    keySim.set(k.key, (keySim.get(k.key) ?? 0) + 1);
  }
  {
    const q = Math.min(4, Math.floor(p.b.wealthPct * 5));
    let x = u5q.get(p.c.id); if (!x) u5q.set(p.c.id, x = { n: [0, 0, 0, 0, 0], d: [0, 0, 0, 0, 0] });
    x.n[q]++; if (p.ageAtDeath! < 5) x.d[q]++;
  }
  if (lived(p, 18)) {
    extra.alive18++;
    if (p.log.some(e => e.age < 18 && e.source?.en.startsWith('You have lost both'))) extra.orphan18++;
  }
  if (p.children.length) { extra.parents++; if (p.children.some(k => !k.alive)) extra.lostChild++; }
}
console.log(`simulated ${N.toLocaleString()} full lives in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);

// World (births-weighted, i.e. pooled over all simulated people) and per-country error.
console.log(`${'metric'.padEnd(34)} ${'sim'.padStart(7)} ${'real'.padStart(7)}   mean |err| over countries (n>=300)`);
for (const m of METRICS) {
  let n = 0, s = 0, tg = 0, errSum = 0, errW = 0;
  const worst: [number, string, number, number][] = [];
  for (const [iso, mm] of per) {
    const x = mm.get(m.key); if (!x) continue;
    n += x.n; s += x.s; tg += x.t;
    if (x.n >= 300) {
      const err = Math.abs(x.s / x.n - x.t / x.n) * m.scale;
      errSum += err * x.n; errW += x.n;
      worst.push([err, iso, x.s / x.n * m.scale, x.t / x.n * m.scale]);
    }
  }
  worst.sort((a, b) => b[0] - a[0]);
  const f = (v: number) => v.toFixed(m.key === 'tfr' || m.key === 'teen' ? 2 : 1);
  console.log(`${m.label.padEnd(34)} ${f(s / n * m.scale).padStart(7)} ${f(tg / n * m.scale).padStart(7)}   ${f(errSum / errW).padStart(5)}  worst: ${worst.slice(0, 3).map(w => `${w[1]} ${f(w[2])}/${f(w[3])}`).join(', ')}`);
}
console.log(`\nlost both parents before 18: ${(100 * extra.orphan18 / extra.alive18).toFixed(1)}% of those reaching 18`);
console.log(`parents who outlived at least one child: ${(100 * extra.lostChild / extra.parents).toFixed(1)}%`);
console.log('\nnote: university target = min(gross tertiary enrollment capped at 90%, upper-secondary completion);');
console.log('gross enrollment counts older students too, so it can exceed the share of a cohort that can enter.');
console.log('widowhood: survey data (median 2012) reflect husbands who died under past, higher mortality; the');
console.log("simulation uses today's life tables, so it should come out somewhat lower, mostly for women.");

console.log("\ncauses of death (share of all simulated deaths; WHO = expected from each death's country/sex/age mix):");
const fmt = (m: Map<string, number>, k: string) => (100 * (m.get(k) ?? 0) / deaths).toFixed(1).padStart(5);
console.log('  by kind:  ' + [...kindExp.keys()].sort((a, b) => kindExp.get(b)! - kindExp.get(a)!)
  .map(k => `${k} ${fmt(kindSim, k)}/${fmt(kindExp, k).trim()}%`).join(' | '));
console.log(`  alcohol ${fmt(keySim, 'alcohol').trim()}/${fmt(keyExp, 'alcohol').trim()}% | HIV ${fmt(keySim, 'hiv').trim()}/${fmt(keyExp, 'hiv').trim()}% | maternal ${fmt(keySim, 'maternal').trim()}/${fmt(keyExp, 'maternal').trim()}% | diabetes ${fmt(keySim, 'diabetes').trim()}/${fmt(keyExp, 'diabetes').trim()}% | hypertensive heart ${fmt(keySim, 'hypertension').trim()}/${fmt(keyExp, 'hypertension').trim()}%`);
console.log('  top causes: ' + [...keyExp.keys()].sort((a, b) => keyExp.get(b)! - keyExp.get(a)!).slice(0, 10)
  .map(k => `${k} ${fmt(keySim, k).trim()}/${fmt(keyExp, k).trim()}%`).join(' | '));

// Poorest/richest fifth under-5 mortality ratio: simulated vs DHS, over countries with DHS data.
{
  const dhsRatio = (c: Country) => c.u5_ratio as number; // raw survey ratio
  let simLog = 0, dataLog = 0, w = 0;
  for (const m of world.countries) {
    const x = u5q.get(m.c.id);
    if (!x || m.c.src.u5_beta !== 'DHS' || x.d[0] < 40 || x.d[4] < 25) continue;
    simLog += x.n[0] * Math.log((x.d[0] / x.n[0]) / (x.d[4] / x.n[4]));
    dataLog += x.n[0] * Math.log(dhsRatio(m.c));
    w += x.n[0];
  }
  console.log(`
under-5 mortality, poorest vs richest fifth (DHS countries, births-weighted geometric mean): sim ${Math.exp(simLog / w).toFixed(2)}x, DHS surveys ${Math.exp(dataLog / w).toFixed(2)}x`);
}

// ---------------------------------------------------------------- work: distributions vs ILO / UNESCO
// Occupation shares (ISCO major groups) pooled over all simulated people, compared with the same
// people's country/sex/age-band (or education) shares in the data. TVD = total variation distance.
{
  const occSim = new Array(10).fill(0), occAge = new Array(10).fill(0), occEdu = new Array(10).fill(0);
  const fieldSim = new Array(10).fill(0), fieldExp = new Array(10).fill(0);
  let nJob = 0, nUni = 0;
  for (const p of lives) {
    if (p.plan.university && p.plan.field !== undefined) { fieldSim[p.plan.field]++; p.c.fields.forEach((x, i) => (fieldExp[i] += x)); nUni++; }
    for (const h of [p.career.history.filter(h => h.age <= 40).at(-1)]) {
      if (!h || !p.jobAt40) continue;
      const w = (p.residence?.c ?? p.c).work[p.b.sex];
      occSim[h.job.occ]++; nJob++;
      (w.ocu_age[bandOf(40)] ?? w.ocu).forEach((x, i) => (occAge[i] += x));
      (w.ocu_edu[eduLevel(p.plan.schoolYears, p.plan.university)] ?? w.ocu).forEach((x, i) => (occEdu[i] += x));
    }
  }
  const pc = (v: number[], n: number) => v.map(x => (100 * x / n).toFixed(1).padStart(5)).join('');
  const tvd = (a: number[], b: number[], n: number) => (50 * a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / n).toFixed(1);
  console.log('\noccupations of workers at 40 (ISCO 0..9, % of workers):');
  console.log('  sim                 ' + pc(occSim, nJob));
  console.log('  ILO by age band     ' + pc(occAge, nJob) + `   TVD ${tvd(occSim, occAge, nJob)} pts`);
  console.log('  ILO by education    ' + pc(occEdu, nJob) + `   TVD ${tvd(occSim, occEdu, nJob)} pts`);
  console.log('tertiary field of study (% of graduates, 10 fields):');
  console.log('  sim                 ' + pc(fieldSim, nUni));
  console.log('  UNESCO              ' + pc(fieldExp, nUni) + `   TVD ${tvd(fieldSim, fieldExp, nUni)} pts`);
  const changed = lives.filter(p => p.career.history.length > 1).length / Math.max(1, lives.filter(p => p.career.history.length > 0).length);
  console.log(`workers who changed occupation group at least once: ${(100 * changed).toFixed(0)}%`);
}
