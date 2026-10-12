// Working life: education track, occupation over the career, sector, status in employment, informality.
//
// Occupation (ISCO-08 major groups 0..9) is a multinomial-logit choice:
//   P(k | education E, age band b) ∝ P_ILO(k | E) * exp(alpha[b][k])
// P_ILO(k | E) is the country's occupation mix by education level (labour force survey). alpha is
// calibrated per country, sex and age band so that, given the education mix of workers, the simulated
// occupation mix in each band equals the survey's occupation-by-age shares. Each person carries their own
// Gumbel noise per occupation (who they are); at each new age band part of it is redrawn
// (ASSUMPTION: CHANGE_SHARE), so some people change occupation and the age pattern of the data emerges.

import type { Country, Sex } from '../model/types.ts';
import type { CountryModel } from '../model/world.ts';
import { makeRng, type Rng } from '../model/rng.ts';
import { gauss, inTop, latent } from '../model/latent.ts';
import { drawSchool, drawWorks, schoolFit } from './calibrate.ts';
import { t, type T } from './i18n.ts';

export const BANDS = ['15', '25', '55', '65'] as const;
export type Band = typeof BANDS[number];
export const bandOf = (age: number): Band => (age < 25 ? '15' : age < 55 ? '25' : age < 65 ? '55' : '65');
export type Edu = 'LTB' | 'BAS' | 'INT' | 'ADV';
export const EDUS: Edu[] = ['LTB', 'BAS', 'INT', 'ADV'];
export type Status = 'emp' | 'employer' | 'own' | 'family';
export const STATUSES: Status[] = ['emp', 'employer', 'own', 'family'];
export type Sector = 'agr' | 'ind' | 'ser';

/** ASSUMPTION: share of a person's occupation preferences redrawn at each new age band (no data on
 *  individual occupation mobility by country). Age-band occupation shares are matched regardless. */
export const CHANGE_SHARE = 0.3;

/** ILO education levels: less than basic (no completed primary), basic (primary/lower secondary),
 *  intermediate (upper secondary), advanced (tertiary). */
export function eduLevel(schoolYears: number, university: boolean): Edu {
  if (university) return 'ADV';
  if (schoolYears >= 12) return 'INT';
  if (schoolYears >= 6) return 'BAS';
  return 'LTB';
}

// ---------------------------------------------------------------- calibration

interface WorkModel {
  alpha: Record<Sex, Record<Band, number[]>>;
  logP: Record<Sex, Record<Edu, number[]>>;
  indK: Record<Sex, number>; // odds multiplier so industry/services split matches ILO
  agr9: Record<Sex, number>; // share of elementary workers who work in agriculture
  statusK: Record<Sex, number[]>; // multipliers so status shares match ILO national totals
  informalK: Record<Sex, number>; // odds multiplier so the informality rate matches ILO
}

const WORK_CACHE = new WeakMap<CountryModel, WorkModel>();
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

/** Prior chance an occupation's job is in industry rather than services (outside agriculture).
 *  ASSUMPTION from ISCO definitions; scaled per country so the national split matches ILO. */
const IND_PRIOR = [0, 0.25, 0.15, 0.3, 0.15, 0.05, 0, 0.75, 0.75, 0.4];

function probs(logP: number[], alpha: number[]): number[] {
  const w = logP.map((l, k) => Math.exp(l + alpha[k]));
  const s = sum(w);
  return w.map(x => x / s);
}

export function workModel(m: CountryModel): WorkModel {
  let v = WORK_CACHE.get(m);
  if (v) return v;
  const c = m.c, rng = makeRng(0x30b ^ c.births);
  const alpha = {} as WorkModel['alpha'], logP = {} as WorkModel['logP'];
  const indK = {} as WorkModel['indK'], agr9 = {} as WorkModel['agr9'];
  const statusK = {} as WorkModel['statusK'], informalK = {} as WorkModel['informalK'];
  for (const sex of ['M', 'F'] as const) {
    const w = c.work[sex];
    // log P(k | E); tiny floor so every occupation stays reachable.
    logP[sex] = {} as Record<Edu, number[]>;
    for (const e of EDUS) {
      const p = w.ocu_edu[e] ?? w.ocu;
      logP[sex][e] = p.map(x => Math.log(Math.max(x, 1e-4)));
    }
    // Education mix of workers of this sex (synthetic sample with the same draws as createPerson).
    const mix: Record<Edu, number> = { LTB: 0, BAS: 0, INT: 0, ADV: 0 };
    let n = 0;
    for (let i = 0; i < 20000; i++) {
      const z = gauss(rng), eduZ = latent(rng, z, c.edu_cor);
      if (!drawWorks(c, sex === 'F', eduZ, rng)) continue;
      const s = drawSchool(c, eduZ, rng);
      mix[eduLevel(s.years, s.uni)]++; n++;
    }
    for (const e of EDUS) mix[e] /= Math.max(1, n);
    // alpha per band: iterative scaling until the mixture matches the band's occupation shares.
    alpha[sex] = {} as Record<Band, number[]>;
    for (const b of BANDS) {
      const target = w.ocu_age[b] ?? w.ocu;
      const a = new Array(10).fill(0);
      for (let it = 0; it < 200; it++) {
        const model = new Array(10).fill(0);
        for (const e of EDUS) probs(logP[sex][e], a).forEach((p, k) => (model[k] += mix[e] * p));
        for (let k = 0; k < 10; k++) a[k] += target[k] > 0 && model[k] > 0 ? Math.log(target[k] / model[k]) : target[k] > 0 ? 5 : -20;
      }
      alpha[sex][b] = a;
    }
    // National totals below are matched on the prime-age (25-54) occupation mix, which is what most
    // simulated working years look like. Survey structure (often older) is raked to ILO 2024 totals.
    const occ = w.ocu_age['25'] ?? w.ocu;
    // Status: P(status | occupation) from the survey, times per-status multipliers fitted to ILO totals.
    const statusOf = (k: number) => w.status_ocu[String(k)] ?? STATUSES.map(s => w.status[s]);
    const sk = [1, 1, 1, 1];
    for (let it = 0; it < 100; it++) {
      const model = [0, 0, 0, 0];
      occ.forEach((x, k) => { const sp = statusOf(k).map((p, i) => p * sk[i]); const t = sum(sp); sp.forEach((p, i) => (model[i] += x * p / t)); });
      STATUSES.forEach((s, i) => { if (model[i] > 0 && w.status[s] > 0) sk[i] *= w.status[s] / model[i]; });
    }
    statusK[sex] = sk;
    // Informality: P(informal | status) from the survey, one odds multiplier fitted to the national rate.
    const inf0 = (s: Status) => w.informal_status?.[s] ?? w.informal ?? 0.5;
    const target = w.informal ?? STATUSES.reduce((a, s) => a + w.status[s] * inf0(s), 0);
    let ilo = 0.01, ihi = 100;
    for (let it = 0; it < 60; it++) {
      const k = Math.sqrt(ilo * ihi);
      const r = STATUSES.reduce((a, s) => a + w.status[s] * odds(inf0(s), k), 0);
      if (r < target) ilo = k; else ihi = k;
    }
    informalK[sex] = Math.sqrt(ilo * ihi);
    // Sector: skilled agriculture (6) is agriculture; enough elementary workers (9) are farm labourers to
    // reach ILO's agriculture share; the rest split industry/services by IND_PRIOR scaled to match ILO.
    const sec = w.sector;
    agr9[sex] = clamp((sec.agr - occ[6]) / Math.max(1e-6, occ[9]), 0, 1);
    const nonAgr = occ.map((x, k) => (k === 6 ? 0 : k === 9 ? x * (1 - agr9[sex]) : x));
    const indTarget = sec.ind / Math.max(1e-6, sec.ind + sec.ser);
    let lo = 0.01, hi = 100;
    for (let it = 0; it < 60; it++) {
      const k = Math.sqrt(lo * hi);
      const ind = sum(nonAgr.map((x, j) => x * odds(IND_PRIOR[j], k))) / Math.max(1e-9, sum(nonAgr));
      if (ind < indTarget) lo = k; else hi = k;
    }
    indK[sex] = Math.sqrt(lo * hi);
  }
  v = { alpha, logP, indK, agr9, statusK, informalK };
  WORK_CACHE.set(m, v);
  return v;
}

const odds = (p: number, k: number) => (p <= 0 ? 0 : p >= 1 ? 1 : (p * k) / (p * k + 1 - p));

// ---------------------------------------------------------------- per person

export interface Job {
  occ: number; // ISCO major group
  sector: Sector;
  status: Status;
  informal: boolean;
  title: T;
}

export interface Career {
  gumbel: number[]; // the person's own taste/fit for each occupation group
  job?: Job;
  history: { age: number; job: Job }[];
}

const gumbelDraw = (rng: Rng) => -Math.log(-Math.log(Math.min(1 - 1e-12, Math.max(1e-12, rng()))));

export function newCareer(rng: Rng): Career {
  return { gumbel: Array.from({ length: 10 }, () => gumbelDraw(rng)), history: [] };
}

/** Occupation for this band: argmax of log P(k|E) + alpha[b][k] + own noise (= logit choice). */
export function chooseOccupation(m: CountryModel, sex: Sex, edu: Edu, band: Band, career: Career): number {
  const wm = workModel(m);
  let best = 0, bestU = -Infinity;
  for (let k = 0; k < 10; k++) {
    const u = wm.logP[sex][edu][k] + wm.alpha[sex][band][k] + career.gumbel[k];
    if (u > bestU) { bestU = u; best = k; }
  }
  return best;
}

export function redrawTastes(career: Career, rng: Rng) {
  for (let k = 0; k < 10; k++) if (rng() < CHANGE_SHARE) career.gumbel[k] = gumbelDraw(rng);
}

export function makeJob(m: CountryModel, sex: Sex, occ: number, field: number | undefined, rng: Rng, age = 40): Job {
  const c = m.c, w = c.work[sex], wm = workModel(m);
  const sector: Sector = occ === 6 || (occ === 9 && rng() < wm.agr9[sex]) ? 'agr'
    : rng() < odds(IND_PRIOR[occ], wm.indK[sex]) ? 'ind' : 'ser';
  const sp = (w.status_ocu[String(occ)] ?? STATUSES.map(s => w.status[s])).map((p, i) => p * wm.statusK[sex][i]);
  let x = rng() * sum(sp), status: Status = 'emp';
  for (let i = 0; i < 4; i++) { x -= sp[i]; if (x <= 0) { status = STATUSES[i]; break; } }
  // ASSUMPTION: nobody under 25 employs others (ILO status tables by age not used yet); they work for themselves.
  if (status === 'employer' && age < 25) status = 'own';
  const informal = rng() < odds(w.informal_status?.[status] ?? w.informal ?? 0.5, wm.informalK[sex]);
  const title = status === 'employer' && occ >= 4 ? OWNER[occ] ?? OWNER[5] : jobTitle(occ, sector, field, rng);
  return { occ, sector, status, informal, title };
}

// ---------------------------------------------------------------- titles (narrative only)

export const FIELDS: T[] = [
  t('sư phạm', 'education'), t('nghệ thuật và nhân văn', 'arts and humanities'), t('khoa học xã hội', 'social sciences'),
  t('kinh doanh và luật', 'business and law'), t('khoa học tự nhiên', 'natural sciences'), t('công nghệ thông tin', 'information technology'),
  t('kỹ thuật', 'engineering'), t('nông nghiệp', 'agriculture'), t('y tế', 'health'), t('dịch vụ', 'services'),
];

const pick = <X>(xs: X[], rng: Rng) => xs[Math.floor(rng() * xs.length)];

// Professionals and technicians by field of study; other groups by sector.
const PROF_BY_FIELD: T[][] = [
  [t('giáo viên', 'teacher')], [t('nhà báo', 'journalist'), t('biên dịch viên', 'translator')],
  [t('chuyên viên nghiên cứu xã hội', 'social researcher'), t('nhà tâm lý học', 'psychologist')],
  [t('luật sư', 'lawyer'), t('kế toán', 'accountant'), t('chuyên viên tài chính', 'financial analyst')],
  [t('nhà khoa học', 'scientist'), t('nhà thống kê', 'statistician')],
  [t('lập trình viên', 'software developer')], [t('kỹ sư', 'engineer'), t('kiến trúc sư', 'architect')],
  [t('kỹ sư nông nghiệp', 'agronomist'), t('bác sĩ thú y', 'veterinarian')],
  [t('bác sĩ', 'doctor'), t('dược sĩ', 'pharmacist')], [t('quản lý khách sạn', 'hotel manager')],
];
const TECH_BY_FIELD: T[][] = [
  [t('giáo viên mầm non', 'preschool teacher')], [t('thiết kế đồ họa', 'graphic designer')],
  [t('nhân viên công tác xã hội', 'social worker')], [t('nhân viên kinh doanh', 'sales representative'), t('nhân viên kế toán', 'bookkeeper')],
  [t('kỹ thuật viên phòng thí nghiệm', 'laboratory technician')], [t('kỹ thuật viên IT', 'IT technician')],
  [t('kỹ thuật viên', 'engineering technician')], [t('kỹ thuật viên nông nghiệp', 'agricultural technician')],
  [t('y tá', 'nurse'), t('kỹ thuật viên y tế', 'medical technician')], [t('đầu bếp trưởng', 'head chef')],
];
const BY_GROUP: Record<number, T[]> = {
  0: [t('quân nhân', 'soldier')],
  1: [t('quản lý', 'manager'), t('chủ doanh nghiệp', 'business owner')],
  4: [t('nhân viên văn phòng', 'office clerk'), t('giao dịch viên', 'bank teller'), t('thư ký', 'secretary')],
  5: [t('người bán hàng', 'shop worker'), t('đầu bếp', 'cook'), t('bảo vệ', 'security guard'), t('thợ cắt tóc', 'hairdresser'), t('người chăm sóc', 'care worker')],
  6: [t('nông dân', 'farmer'), t('người chăn nuôi', 'livestock farmer'), t('ngư dân', 'fisher')],
  7: [t('thợ xây', 'builder'), t('thợ may', 'tailor'), t('thợ điện', 'electrician'), t('thợ cơ khí', 'mechanic')],
  8: [t('công nhân nhà máy', 'factory worker'), t('tài xế', 'driver'), t('thợ vận hành máy', 'machine operator')],
  9: [t('phụ hồ', 'construction labourer'), t('người giúp việc', 'domestic helper'), t('người bán hàng rong', 'street vendor'), t('công nhân vệ sinh', 'cleaner')],
};

// People who employ others in manual and service occupations run the business rather than do the job.
export const OWNER: Record<number, T> = {
  4: t('chủ văn phòng dịch vụ', 'owner of a small office business'), 5: t('chủ cửa hàng', 'shop owner'),
  6: t('chủ trang trại', 'farm owner'), 7: t('chủ xưởng', 'workshop owner'), 8: t('chủ xưởng', 'workshop owner'),
  9: t('chủ một cơ sở nhỏ', 'owner of a small business'),
};

function jobTitle(occ: number, sector: Sector, field: number | undefined, rng: Rng): T {
  if (occ === 9 && sector === 'agr') return t('người làm thuê nông nghiệp', 'farm labourer');
  if (occ === 2) return pick(PROF_BY_FIELD[field ?? 2], rng);
  if (occ === 3) return pick(TECH_BY_FIELD[field ?? 3], rng);
  return pick(BY_GROUP[occ], rng);
}

export const STATUS_TEXT: Record<Status, T> = {
  emp: t('làm công ăn lương', 'as an employee'),
  employer: t('làm chủ, có thuê người', 'running your own business with staff'),
  own: t('tự làm', 'working for yourself'),
  family: t('phụ giúp gia đình, không lương', 'helping in the family business, unpaid'),
};

// ---------------------------------------------------------------- education tracks

/** Field of tertiary study, drawn from the country's graduates by field (UNESCO). */
export function drawField(c: Country, rng: Rng): number {
  let x = rng() * sum(c.fields);
  for (let i = 0; i < c.fields.length; i++) { x -= c.fields[i]; if (x <= 0) return i; }
  return c.fields.length - 1;
}

/** Vocational upper secondary: UNESCO share of upper secondary students, given to those who enter
 *  upper secondary (10+ years) but don't go to university, scaled so the overall share matches. */
export function vocationalShare(c: Country): number {
  const f = schoolFit(c), entrants = f.pAtLeast[10];
  const uni = Math.min(entrants, f.pAtLeast[12] * f.uniGivenFinish);
  return clamp((c.voc_upper / 100) * entrants / Math.max(1e-6, entrants - uni), 0, 1);
}

export const vocationalDraw = (c: Country, eduZ: number, rng: Rng) => inTop(latent(rng, -eduZ, 0.3), vocationalShare(c));

export const OCC_NAMES: T[] = [
  t('quân đội', 'in the armed forces'), t('quản lý', 'managers'), t('chuyên gia', 'professionals'),
  t('kỹ thuật viên', 'technicians and associate professionals'), t('nhân viên văn phòng', 'clerical workers'),
  t('dịch vụ và bán hàng', 'service and sales workers'), t('nông dân', 'farmers, foresters and fishers'),
  t('thợ thủ công', 'craft and trades workers'), t('thợ vận hành máy', 'machine operators and drivers'),
  t('lao động giản đơn', 'in elementary occupations'),
];

/** Draw an occupation from a share vector (used for spouses, who are not simulated in full). */
export function drawOcc(shares: number[], rng: Rng): number {
  let x = rng() * sum(shares);
  for (let k = 0; k < shares.length; k++) { x -= shares[k]; if (x <= 0) return k; }
  return 9;
}

/** Average of an occupation-level number over the country's prime-age employees (occupation mix x chance
 *  of being an employee in that occupation, as simulated). Used to normalise ILO earnings ratios. */
export function employeeMean(m: CountryModel, sex: Sex, values: number[]): number {
  const w = m.c.work[sex], wm = workModel(m), occ = w.ocu_age['25'] ?? w.ocu;
  let num = 0, den = 0;
  occ.forEach((x, k) => {
    const sp = (w.status_ocu[String(k)] ?? STATUSES.map(s => w.status[s])).map((p, i) => p * wm.statusK[sex][i]);
    const pe = sp[0] / Math.max(1e-9, sum(sp));
    num += x * pe * (values[k] ?? 1); den += x * pe;
  });
  return den > 0 ? num / den : 1;
}
