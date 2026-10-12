// A person and the circumstances drawn at birth.
//
// Most of a life's structure is decided up front from national statistics ("the plan"): how many years
// of school, whether and when to marry, how many children. The yearly loop then plays the plan out,
// and mortality (own and family's) decides how much of it actually happens.

import type { Country, Sex } from '../model/types.ts';
import type { Birth } from '../model/life.ts';
import type { Rng } from '../model/rng.ts';
import { gauss, inTop, latent } from '../model/latent.ts';
import { eduFit, accountRho, chronicFrom, slumCutoff, asfrAt, drawSchool, drawWorks, exitAge, hivAgeWeight, hivModel, marriage, chronicModel, CHRONIC_FROM } from './calibrate.ts';
import { invNorm, normCdf } from '../model/stats.ts';
import { deathProb } from '../model/mortality.ts';
import type { T } from './i18n.ts';
import type { CauseData } from './causes.ts';
import type { Portfolio } from './finance.ts';
import type { Business } from './business.ts';
import type { Job } from './work.ts';
import type { CountryModel } from '../model/world.ts';
import { drawField, newCareer, vocationalDraw, type Career } from './work.ts';
import { personalLevel } from './satisfaction.ts';
import { pickName, pickProvince } from './names.ts';
import { personalFactor, TOP_OWNER_CUT, TOP_OWNER_SHARE, WEALTH_RHO } from './money.ts';

export interface Kin {
  sex: Sex;
  age: number;
  alive: boolean;
  bornAt?: number; // person's age when this relative was born (children, younger siblings)
  name?: string;
  bornProvince?: string; // province of birth (children)
  deathAge?: number; // their age when they died
  diesAt?: number; // the person's age at which they die (known from an earlier generation's life)
  played?: boolean; // this relative is the player's previous life
  // For children: what is needed to play their life next (dynasty).
  familyZ?: number; // the household's living-standard score when they were born
  bornIn?: string; // ISO3 of the country they were born in
  other?: Kin; otherAgeAtBirth?: number; // the other parent
  eduYears?: number; // school years in which the parent paid for extra schooling
  gift?: number; giftAge?: number; // money given by the parent, and the child's age then (2021 PPP $)
}

/** A family known in advance (a child of a life already played). */
export interface Family {
  motherAge: number; fatherAge: number;
  motherDiesAt?: number; fatherDiesAt?: number; // the person's age when that parent dies
  motherPlayed?: boolean; fatherPlayed?: boolean;
  siblings: Kin[];
  selfName?: string; motherName?: string; fatherName?: string; province?: string;
  takeover?: number; // the child's age when the played parent dies: play starts after that year
  parentU?: number; // parents' wealth rank, from the previous life's net worth
  parentEduZ?: number; // the played parent's education score
  parentNW?: number; // the played parent's net worth when they died (2021 PPP $)
  parentSchool?: { years: number; uni: boolean }; // the played parent's schooling
  eduBoost?: number; // raise in the education score from the parent's spending on schooling
  estateShare?: number; // this child's share of the played parent's estate (a will can change it)
  gift?: number; giftAge?: number; // money from the played parent and the age it comes
  generation: number;
}

export type LogKind = 'choice' | 'birth' | 'family' | 'school' | 'love' | 'work' | 'health' | 'loss' | 'death';
export interface LogEntry { age: number; kind: LogKind; text: T; source?: T }

export interface Plan {
  schoolYears: number; // 0..12, from age 6
  university: boolean;
  childMarriageAge?: number; // girls only
  marriageAge?: number;
  maxKids?: number; // children wanted (player's choice); further births avoided when contraception works
  quitAge?: number; // stopped smoking at this age
  team?: boolean; // plays on a school sports team (player's choice)
  active?: boolean; // exercises regularly as an adult (player's choice)
  insured?: boolean; // has private health insurance (player's choice)
  screened?: boolean; // goes for cancer screening from 50 (player's choice)
  willTo?: number; // index in children: the will leaves everything to this child (player's choice)
  fertK: number; // fertility multiplier (wealth/education gradient, mean 1)
  smokeStartAge?: number;
  internetAge?: number;
  hivAge?: number;
  diabetesAge?: number;
  hypertensionAge?: number;
  alcoholAge?: number; // alcohol use disorder onset
  obeseAge?: number;
  accountAge?: number;
  heightCm: number;
  emigrateAge?: number;
  destination?: string; // ISO3
  refugee?: boolean;
  displacedAge?: number; // forced to flee home within the country
  worksOutside: boolean; // in the labour force at prime working age (25-54)
  exitAge: number; // stops working at this age (ILO participation by age)
  field?: number; // tertiary field of study (index into work.ts FIELDS)
  vocational?: boolean; // vocational upper secondary track
}

export interface Person {
  b: Birth;
  c: Country;
  age: number;
  alive: boolean;
  ageAtDeath?: number;
  cause?: T;
  causeKind?: string;
  causeKey?: string;
  urban: boolean;
  electricity: boolean;
  water: boolean;
  vaccinated: boolean;
  sanitation: boolean;
  cleanFuel: boolean;
  slum: boolean;
  registered: boolean;
  stunted: boolean;
  mother: Kin;
  father: Kin;
  siblings: Kin[];
  spouse?: Kin;
  children: Kin[];
  grandchildren: Kin[];
  greatGrandchildren: Kin[];
  pension?: boolean;
  livingAt: Record<number, string>; // living arrangement at 70 and 82
  plan: Plan;
  eduZ: number; // latent educational advantage
  adultZ: number; // standing as an adult, from family wealth + education
  generation: number; // 1 for a new dynasty, then 2, 3... for each child played
  name: string;
  nameKey: string; // fixed key for naming relatives (names.ts)
  pastSpouses: string[]; // names of earlier husbands or wives (divorced or died)
  storyUsed: { scenes: number[]; facts: Record<string, number> }; // everyday lines already told (everyday.ts)
  province: string; // province (state, region) of birth
  homeProvince: string; // where the person lives now (changes on emigration)
  playedParentSchool?: { years: number; uni: boolean };
  takeover?: number; // dynasty: the age at which the player takes over this life (they are alive then, as in the parent's life)
  takeoverSummary?: T; // dynasty: who died and who you are now, shown at the top of the new life (not an event)
  lat: { eduZ: number; parentEduZ: number; marryU: number; smokeL: number; exitU: number; adultNoise: number; wealthNoise: number };
  decided: Record<string, string>; // choices made by the player (decision id -> option)
  choseUnusual?: boolean; // at least one choice differed from what most people would do // ranks behind the plan (kept when a child emigrant is re-planned)
  personalLadder: number; // lasting personal level of life satisfaction (see satisfaction.ts)
  ladder: { sum: number; n: number; at: Record<number, number> }; // yearly answers from 15: total, count, at some ages
  transient: number; // this year's ups and downs in living standard (standard normal, AR(1)); see mortalityZ
  year: { out: number; uExp: number; impov: boolean; pImpov: number; loss: number; pLoss: number }; // this year's shocks and their expected values
  smoker: boolean;
  hiv: boolean;
  diabetes: boolean;
  hypertension: boolean;
  treated: { dm?: boolean; ht?: boolean; hiv?: boolean }; // on treatment for these conditions
  alcohol: boolean;
  residence?: CountryModel;
  career: Career;
  money: {
    personal: number; // persistent earnings factor
    spouseWorks: boolean;
    spouseMonthly: number; // spouse's monthly income, 2021 PPP $
    lastMonthly: number; // own last monthly earnings (for the pension)
    pensionMonthly: number;
    byAge: Record<number, { own: number; perCapita: number }>; // for validation and the story
    wealthU: number; // adult wealth rank (0..1) among the country's adults
    wealth: Record<number, number>; // net worth (2021 PPP $) at 30, 50, 70 and the maximum
    millionaire?: number; billionaire?: number; // age first reached $1m / $1bn (market USD)
    owner: boolean; // top-0.1% wealth built mainly in an owned business
    shocks: number; // cumulative health bills paid from wealth (2021 PPP $)
    expectedShocks: number; // what an average person of the same age and income would have paid
    lastNW?: number; // net worth this year (2021 PPP $), from 20
    portfolio: Portfolio; // where savings go (player's choice)
    biz?: Business; // a business the player runs (business.ts)
    bizJob?: Job; // the job held before starting it
    bizLedger: number; // capital put in minus sale proceeds, 2021 PPP $
    eduInvest: boolean; // pays for extra schooling for the children (player's choice)
    familySpent: number; // spent on the children's schooling and given to them, 2021 PPP $
    giftIn?: { amount: number; age: number }; // a gift from the played parent
    giftReceived: number;
    bizHistory: { start: number; end: number; failed: boolean }[]; // businesses run (for the story)
    windfall: number; // a lottery jackpot waiting for a decision on what to do with it
    invW?: number; // own net worth when savings are held differently from most people, 2021 PPP $ (finance.ts)
    lastU?: number; // last year's return on the usual mix
    lastRaw?: number; // last year's net worth before investment gains and the lottery
    lottery: { plays: boolean; spent: number; won: number }; // weekly tickets (2021 PPP $)
    knownEstate?: number; // the played parent's net worth at death (dynasty)
    estateShare?: number; // this person's share of it
    estateFromPlayed?: boolean; // the estate came from the played parent (they died last)
    parentU: number; // parents' wealth rank in the country of birth
    heirs: number; // children of the parents (the person and every sibling): the estate is split between them
    inherited: number; // received when the second parent died (2021 PPP $)
    expectedInherit: number; // expected by this age, given the parents' ages and wealth (what WID wealth already includes)
    parentsAlive: [number, number]; // chance mother / father is still alive (for expectedInherit)
    bills: { impov: number; large: number; years: number; lastLog: number };
  };
  jobAt40?: { occ: number; sector: string; status: string; informal: boolean }; // set after emigrating; mortality then follows the new country
  marital: 'single' | 'married' | 'divorced' | 'widowed';
  marriages: number;
  statusAt: Record<number, string>; // marital status at selected ages (for validation)
  unemployedYears: number;
  unemployedUntil: number; // age (fractional) when the current spell ends
  workYears: { young: number; adult: number; youngOut: number; adultOut: number }; // for validation
  log: LogEntry[];
}

// ---------------------------------------------------------------- assumptions (no per-country data yet)

// ---------------------------------------------------------------- helpers

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- create

export function createPerson(b: Birth, rng: Rng, causes: CauseData, family?: Family): Person {
  const c = b.country.c, z = b.wealthZ, female = b.sex === 'F';

  // Household: urban, electricity, water — national shares, richer households more likely.
  // Chained latent scores (each standard normal) keep every national share exact.
  const urbanZ = latent(rng, z, 0.5);
  const urban = inTop(urbanZ, c.urban / 100);
  const electricity = inTop(latent(rng, urbanZ, 0.7), c.electricity / 100);
  const water = inTop(latent(rng, urbanZ, 0.6), c.water / 100);
  const sanitation = inTop(latent(rng, urbanZ, 0.6), c.sanitation / 100);
  const cleanFuel = inTop(latent(rng, urbanZ, 0.7), c.clean_fuel / 100);
  // Slums: share of the urban population (UN-Habitat via World Bank), poorer urban families more likely.
  const slum = urban && latent(rng, -z, 0.5) > slumCutoff(c);
  const registered = inTop(latent(rng, z, 0.4), c.birth_reg / 100);
  const vaccinated = inTop(latent(rng, z, 0.4), c.measles / 100);
  const stunted = !inTop(latent(rng, z, 0.5), 1 - c.stunting / 100);

  // Family. Mother's age at this birth follows the country's births by mother's age (UN ASFR); father is
  // older by the gap in median marriage ages (UN WMD). Siblings: a mother of age A has had on average
  // sum(ASFR, 15..A-1) children before and will have sum(ASFR, A+1..49) after; family wealth shifts this
  // (poorer families larger, multiplier mean 1). Older siblings must have survived to this birth.
  const asfr = (a: number) => asfrAt(c, a);
  let x = rng() * c.tfr, motherAge = 15;
  for (let a = 15; a <= 49; a++) { x -= asfr(a); if (x <= 0) { motherAge = a; break; } motherAge = a; }
  let fatherAge = Math.round(clamp(motherAge + marriage(c).gap + 3 * gauss(rng), 17, 75));
  const famK = Math.exp(-0.15 * z) / Math.exp(0.15 ** 2 / 2);
  let siblings: Kin[] = [];
  for (let a = 15; a < motherAge; a++) {
    if (rng() < Math.min(0.9, asfr(a) * famK)) {
      const sib: Kin = { sex: rng() < b.country.pMale ? 'M' : 'F', age: motherAge - a, alive: true };
      // Survived from birth to now? (UN life table, family wealth.)
      let alive = true;
      for (let t = 0; t < sib.age && alive; t++) alive = rng() >= deathProb(b.country.mort[sib.sex], t, z);
      if (alive) siblings.push(sib);
    }
  }
  for (let a = motherAge + 1; a <= 49; a++) {
    if (rng() < Math.min(0.9, asfr(a) * famK)) {
      siblings.push({ sex: rng() < b.country.pMale ? 'M' : 'F', age: motherAge - a, alive: true, bornAt: a - motherAge });
    }
  }

  // A known family (dynasty) replaces the drawn one; the draws above still run so random streams stay aligned.
  if (family) { motherAge = family.motherAge; fatherAge = family.fatherAge; siblings = family.siblings; }

  // Names: the person, then brothers and sisters (no two alike); kept as they were for a known family.
  const nameKey = `${b.country.c.id}|${b.wealthPct.toFixed(9)}|${motherAge}|${fatherAge}|${siblings.length}`;
  const selfName = family?.selfName ?? pickName(c, b.sex, nameKey + 'self');
  const birthProvince = family?.province ?? pickProvince(c, urban, nameKey + 'province');
  const taken = [selfName];
  siblings.forEach((s, i) => { s.name ??= pickName(c, s.sex, nameKey + 'sib' + i, taken); taken.push(s.name); });

  // Education, then adult standing from family wealth + education (intergenerational persistence).
  // Education depends on family background as strongly as schooling passes from parents to children in
  // this country (World Bank GDIM: 0.19 in Denmark to ~0.6 in South Asia).
  const rhoEdu = c.edu_cor;
  // Parents' education: the played parent's in a dynasty, otherwise drawn (correlated r with the
  // household's standing, as in this model). The child's score correlates with the parents' score so that
  // years of schooling correlate as in GDIM, and rhoEdu with the household's standing (as before).
  const ef = eduFit(c);
  const parentEduZ = family?.parentEduZ ?? ef.r * z + Math.sqrt(1 - ef.r * ef.r) * gauss(rng);
  const eduZ = ef.a * parentEduZ + ef.b * z + ef.c * gauss(rng) + (family?.eduBoost ?? 0);
  const school = drawSchool(c, eduZ, rng);
  const adultNoise = gauss(rng);
  const adultZ = adultStanding(z, eduZ, adultNoise, rhoEdu);

  // Marriage.
  const plan: Plan = { schoolYears: school.years, university: school.uni, fertK: 1, worksOutside: false, exitAge: 99, heightCm: 0 };
  // Marriage: read off the country's ever-married-by-age curve at this person's rank. Poorer people
  // rank earlier (rho 0.4), so child marriage concentrates among the poor as in DHS data.
  const mc = marriage(c);
  const u = normCdf(latent(rng, z, 0.4));
  const lat = { eduZ, parentEduZ, marryU: u, smokeL: 0, exitU: 0, adultNoise, wealthNoise: 0 };
  if (u < mc[b.sex].ever) {
    plan.marriageAge = Math.floor(mc[b.sex].ageAt(u));
    if (female && plan.marriageAge < 18) plan.childMarriageAge = plan.marriageAge;
  }

  // Fertility: richer/more educated couples have somewhat fewer children (multiplier averages 1).
  plan.fertK = Math.exp(-0.2 * latent(rng, adultZ, 0.5)) / Math.exp(0.02);

  // Smoking: national adult prevalence by sex. In poorer countries smoking is spread evenly; in rich
  // countries it concentrates among the less educated (ASSUMPTION: rho -0.3).
  const smokeShare = (female ? c.smoke_f : c.smoke_m) / 100;
  lat.smokeL = latent(rng, -eduZ, c.income === 'High income' ? 0.3 : 0);
  if (inTop(lat.smokeL, smokeShare)) plan.smokeStartAge = 15 + Math.floor(rng() * 8);

  // HIV: infected with probability pmax, at an age drawn from the 15-49 profile (see calibrate.ts).
  const pmax = hivModel(b.country, causes)[b.sex].pmax;
  let uh = rng();
  if (uh < pmax) {
    for (let a = 15; a <= 49; a++) { uh -= hivAgeWeight(a) * pmax; if (uh < 0) { plan.hivAge = a; break; } }
  }

  // Emigration (UN DESA migrant stock by country of birth, by sex). Refugees (UNHCR share of emigrants)
  // leave regardless of background; other emigrants are drawn more from the better educated
  // (ASSUMPTION: rho 0.3, emigrants are on average more educated than those who stay - OECD DIOC).
  if (c.mig) {
    const share = c.mig.abroad[b.sex], r = c.mig.refugee_share;
    const econ = inTop(latent(rng, eduZ, 0.3), share * (1 - r));
    const refugee = !econ && rng() < share * r / Math.max(1e-9, 1 - share * (1 - r));
    if (econ || refugee) {
      plan.refugee = refugee;
      plan.emigrateAge = drawFromCum(c.mig.age_cum, rng);
      const total = c.mig.dest.reduce((s, [, w]) => s + w, 0);
      let x = rng() * total;
      for (const [iso3, w] of c.mig.dest) { x -= w; if (x <= 0) { plan.destination = iso3; break; } }
      plan.destination ??= c.mig.dest[0]?.[0];
      if (!plan.destination) plan.emigrateAge = undefined;
    }
    // Internal displacement: today's share displaced, at any age up to 60 (ASSUMPTION: uniform age).
    if (rng() < c.mig.idp) plan.displacedAge = Math.floor(rng() * 60);
  }

  // Diabetes and hypertension: onset from 30 at the country's fitted yearly rate (see calibrate.ts).
  const onset = (h: number) => { const a = CHRONIC_FROM + Math.floor(-Math.log(1 - rng()) / h); return a <= 100 ? a : undefined; };
  plan.diabetesAge = onset(chronicModel(b.country, causes, 'dm')[b.sex].h);
  plan.hypertensionAge = onset(chronicModel(b.country, causes, 'ht')[b.sex].h);
  const onsetFrom = (h: number, from: number) => { const a = from + Math.floor(-Math.log(1 - rng()) / h); return a <= 100 ? a : undefined; };
  plan.alcoholAge = onsetFrom(chronicModel(b.country, causes, 'aud')[b.sex].h, chronicFrom('aud'));
  plan.obeseAge = onsetFrom(chronicModel(b.country, causes, 'obese')[b.sex].h, chronicFrom('obese'));
  // Bank or mobile-money account (Findex): by sex, wealth gradient calibrated to poorest 40% vs richest 60%.
  // ASSUMPTION: opened at a random age 15-30 (Findex counts adults 15+).
  if (inTop(latent(rng, adultZ, accountRho(c)), (female ? c.account_f : c.account_m) / 100)) plan.accountAge = 15 + Math.floor(rng() * 16);
  // Adult height: country/sex mean (NCD-RisC). ASSUMPTION: within-country SD 7 cm (men) / 6.5 cm (women).
  // Children stunted at 2 fall in the shortest part of the distribution (rank kept, mean unchanged).
  {
    const s = Math.max(1e-3, Math.min(0.999, c.stunting / 100)), u = rng();
    const q = stunted ? u * s : s + u * (1 - s);
    plan.heightCm = Math.round(c.height[b.sex] + (female ? 6.5 : 7) * invNorm(Math.min(0.999, Math.max(0.001, q))));
  }

  // Internet: today's share of users; first use between 8 and 16.
  if (inTop(latent(rng, adultZ, 0.6), c.internet / 100)) plan.internetAge = 8 + Math.floor(rng() * 9);

  plan.worksOutside = drawWorks(c, female, eduZ, rng);
  // Better-off workers stop earlier (pensions, savings); poorer ones keep working (rho 0.3).
  lat.exitU = normCdf(latent(rng, adultZ, 0.3));
  plan.exitAge = Math.round(exitAge(c, b.sex, lat.exitU));
  // Education tracks: field of study for graduates (UNESCO), vocational upper secondary for others.
  if (plan.university) plan.field = drawField(c, rng);
  else if (plan.schoolYears >= 10) plan.vocational = vocationalDraw(c, eduZ, rng);

  lat.wealthNoise = gauss(rng);
  const wealthU = wealthRankOf(adultZ, lat.wealthNoise);
  // Parents' wealth rank: tied to the family's income rank as an adult's wealth is to their standing.
  let parentU = normCdf(WEALTH_RHO * z + Math.sqrt(1 - WEALTH_RHO ** 2) * gauss(rng));
  if (family?.parentU !== undefined) parentU = family.parentU;
  return {
    personalLadder: personalLevel(rng), ladder: { sum: 0, n: 0, at: {} },
    transient: gauss(rng), year: { out: 0, uExp: 0, impov: false, pImpov: 0, loss: 0, pLoss: 0 },
    lat, decided: {}, b, c, age: 0, alive: true, urban, electricity, water, vaccinated, stunted, sanitation, cleanFuel, slum, registered,
    mother: { sex: 'F', age: motherAge, alive: true, diesAt: family?.motherDiesAt, played: family?.motherPlayed, name: family?.motherName ?? pickName(c, 'F', nameKey + 'mother') },
    father: { sex: 'M', age: fatherAge, alive: true, diesAt: family?.fatherDiesAt, played: family?.fatherPlayed, name: family?.fatherName ?? pickName(c, 'M', nameKey + 'father') },
    name: selfName, nameKey, pastSpouses: [], storyUsed: { scenes: [], facts: {} }, province: birthProvince, homeProvince: birthProvince,
    generation: family?.generation ?? 1, playedParentSchool: family?.parentSchool, takeover: family?.takeover,
    siblings, children: [], grandchildren: [], greatGrandchildren: [], livingAt: {}, plan, eduZ, adultZ,
    career: newCareer(rng), money: { knownEstate: family?.parentNW, estateShare: family?.estateShare, personal: personalFactor(adultZ, rng), wealthU, wealth: {}, owner: wealthU > TOP_OWNER_CUT && rng() < TOP_OWNER_SHARE, shocks: 0, expectedShocks: 0, portfolio: 'usual', bizLedger: 0, eduInvest: false, familySpent: 0, giftReceived: 0, bizHistory: [], windfall: 0, giftIn: family?.gift ? { amount: family.gift, age: family.giftAge ?? 25 } : undefined, lottery: { plays: false, spent: 0, won: 0 }, parentU, heirs: 1 + siblings.length, inherited: 0, expectedInherit: 0, parentsAlive: [1, 1], bills: { impov: 0, large: 0, years: 0, lastLog: -99 }, spouseWorks: false, spouseMonthly: 0, lastMonthly: 0, pensionMonthly: 0, byAge: {} }, smoker: false, treated: {}, hiv: false, diabetes: false, hypertension: false, alcohol: false, marital: 'single', marriages: 0, statusAt: {}, unemployedYears: 0, unemployedUntil: 0, workYears: { young: 0, adult: 0, youngOut: 0, adultOut: 0 }, log: [],
  };
}

/** Years of school actually attended by now (the plan can reach beyond a life cut short). */
export function schoolYearsDone(p: Person): number {
  const school = Math.min(p.plan.schoolYears, Math.max(0, p.age - 6));
  const uni = p.plan.university && p.plan.schoolYears === 12 ? Math.min(4, Math.max(0, p.age - 18)) : 0;
  return school + uni;
}

/** Standing as an adult: family background, education and luck, standard normal across the country. */
export function adultStanding(z: number, eduZ: number, noise: number, rhoEdu: number): number {
  return (0.5 * z + 0.5 * eduZ + 0.5 * noise) / Math.sqrt(0.25 + 0.25 + 2 * 0.25 * rhoEdu + 0.25);
}
export const wealthRankOf = (adultZ: number, noise: number) => normCdf(WEALTH_RHO * adultZ + Math.sqrt(1 - WEALTH_RHO ** 2) * noise);

/** After a change in education: move adult standing and wealth rank with it (same luck as before). */
export function restand(p: Person, eduZ: number): void {
  p.lat.eduZ = eduZ;
  p.adultZ = adultStanding(p.b.wealthZ, eduZ, p.lat.adultNoise, p.c.edu_cor);
  p.money.wealthU = wealthRankOf(p.adultZ, p.lat.wealthNoise);
}

/** ASSUMPTION: children who emigrate before this age grow up in the new country: their schooling,
 *  marriage, fertility, smoking and work follow its patterns (same personal ranks). Older emigrants keep
 *  those of the country they grew up in; everyone's labour market, pensions and old-age living
 *  arrangements follow the country they live in. */
export const RAISED_ABROAD_BEFORE = 15;

/** Country whose social patterns the person grew up with. */
export function raisedIn(p: Person): CountryModel {
  return p.residence && (p.plan.emigrateAge ?? 99) < RAISED_ABROAD_BEFORE ? p.residence : p.b.country;
}

/** Re-plan what has not happened yet for a child who has just moved to `dest`. */
export function replanChild(p: Person, dest: CountryModel, rng: Rng): void {
  const c = dest.c, plan = p.plan, a = p.age, female = p.b.sex === 'F', { lat } = p;
  const done = Math.max(0, a - 6);
  if (plan.schoolYears >= done) { // still in school or not started
    const s = drawSchool(c, lat.eduZ, rng);
    plan.schoolYears = Math.max(done, s.years);
    plan.university = s.uni && plan.schoolYears >= 12;
    plan.field = plan.university ? drawField(c, rng) : undefined;
    plan.vocational = !plan.university && plan.schoolYears >= 10 ? vocationalDraw(c, lat.eduZ, rng) : undefined;
  }
  if (plan.marriageAge === undefined || plan.marriageAge > a) {
    const mc = marriage(c)[p.b.sex];
    plan.marriageAge = lat.marryU < mc.ever ? Math.max(a + 1, Math.floor(mc.ageAt(lat.marryU))) : undefined;
    plan.childMarriageAge = female && plan.marriageAge !== undefined && plan.marriageAge < 18 ? plan.marriageAge : undefined;
  }
  if (plan.smokeStartAge === undefined || plan.smokeStartAge > a) {
    plan.smokeStartAge = inTop(lat.smokeL, (female ? c.smoke_f : c.smoke_m) / 100) ? Math.max(a + 1, 15 + Math.floor(rng() * 8)) : undefined;
  }
  plan.worksOutside = drawWorks(c, female, lat.eduZ, rng);
  plan.exitAge = Math.round(exitAge(c, p.b.sex, lat.exitU));
  if (plan.accountAge === undefined || plan.accountAge > a) {
    plan.accountAge = inTop(latent(rng, p.adultZ, accountRho(c)), (female ? c.account_f : c.account_m) / 100) ? Math.max(a + 1, 15 + Math.floor(rng() * 16)) : undefined;
  }
}

/** ASSUMPTIONS for living standards that move from year to year. Panel studies of household income
 *  (Gottschalk & Moffitt 1994 and later work on PSID, BHPS, SOEP) find that about a third of the
 *  spread of income across people is transitory; year-to-year rank correlations of income are around
 *  0.85-0.9 and ten-year ones around 0.6-0.7. Here: transitory share 0.3, its yearly persistence 0.6
 *  (rank correlation 0.88 after one year, 0.70 after ten). */
export const TRANSIENT_SHARE = 0.3;
export const TRANSIENT_RHO = 0.6;
/** ASSUMPTION: how far a bad year pushes a household down, in standard deviations of the living-standard
 *  score: a full year out of work (job loss cuts household income by roughly a third to a half, e.g.
 *  Davis & von Wachter 2011) and a health bill that pushes the household below the poverty line. */
export const SHOCK_UNEMPLOYED = 0.5;
export const SHOCK_HEALTH = 0.5;
/** ASSUMPTION: losing a parent as a child (under 18) pushes the household down as much as a year out of
 *  work: a parent's death cuts household income (e.g. Case & Ardington 2006 on orphans in South Africa). */
export const SHOCK_LOSS = 0.5;

/** Living-standard score (standard normal across the country): the lasting part (family background as
 *  a child, own standing as an adult) plus this year's ups and downs. It sets household income, health
 *  bill size and the chance of dying. */
export function mortalityZ(p: Person): number {
  const lasting = p.age < 25 ? p.b.wealthZ : p.adultZ;
  return Math.sqrt(1 - TRANSIENT_SHARE) * lasting + Math.sqrt(TRANSIENT_SHARE) * p.transient;
}

/** Move the transitory part one year on. Shocks enter as deviations from what was expected for this
 *  person (so the score keeps mean 0 and variance 1 across the country and mortality stays calibrated
 *  to the UN life tables). */
export function moveTransient(p: Person, rng: Rng): void {
  const y = p.year;
  const dU = y.out - y.uExp, dH = (y.impov ? 1 : 0) - y.pImpov, dL = y.loss - y.pLoss;
  const varShock = SHOCK_UNEMPLOYED ** 2 * y.uExp * (1 - y.uExp) + SHOCK_HEALTH ** 2 * y.pImpov * (1 - y.pImpov) + SHOCK_LOSS ** 2 * y.pLoss * (1 - y.pLoss);
  const eps = (gauss(rng) - SHOCK_UNEMPLOYED * dU - SHOCK_HEALTH * dH - SHOCK_LOSS * dL) / Math.sqrt(1 + varShock);
  p.transient = TRANSIENT_RHO * p.transient + Math.sqrt(1 - TRANSIENT_RHO ** 2) * eps;
  p.year = { out: 0, uExp: 0, impov: false, pImpov: 0, loss: 0, pLoss: 0 };
}

export const percentile = (z: number) => normCdf(z);

/** Draw an age from a cumulative curve [[age, share by that age], ...]. */
function drawFromCum(cum: [number, number][], rng: Rng): number {
  const u = rng();
  for (let i = 1; i < cum.length; i++) {
    const [a0, s0] = cum[i - 1], [a1, s1] = cum[i];
    if (u <= s1) return Math.floor(s1 === s0 ? a1 : a0 + (a1 - a0) * (u - s0) / (s1 - s0));
  }
  return Math.floor(cum[cum.length - 1][0]);
}
