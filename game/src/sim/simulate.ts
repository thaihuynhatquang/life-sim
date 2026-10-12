// The yearly loop: play out the plan drawn at birth, age the family, and decide who dies.

import type { World } from '../model/world.ts';
import type { Rng } from '../model/rng.ts';
import type { Sex } from '../model/types.ts';
import { beBorn } from '../model/life.ts';
import { deathProb } from '../model/mortality.ts';
import { createPerson, mortalityZ, moveTransient, schoolYearsDone, raisedIn, replanChild, RAISED_ABROAD_BEFORE, type Kin, type LogKind, type Person } from './person.ts';
import { ageGroup, causeOfDeath, causeShare, isAlcohol, isDiabetes, isHiv, isHypertension, isMaternal } from './causes.ts';
import { healthRisk, healthSpend, schoolFit } from './calibrate.ts';
import { netWorth, usdPerPpp, formatMoney, monthlyEarnings, netPay, perMonth, personalFactor, REPLACEMENT, SOCIAL_PENSION } from './money.ts';
import { incomeAt } from '../model/income.ts';
import { billionaireShare, wealthAt, wealthRank } from '../model/wealth.ts';
import { invNorm, normCdf } from '../model/stats.ts';
import { ladderWithReasons } from './satisfaction.ts';
import { childMilestones, quietYear } from './everyday.ts';
import { pickName, pickProvince } from './names.ts';
import { EDU_COST, healthChoiceK, INS_COVER, INS_LOAD, QUIT_TAU, TEAM_WIN } from './decisions.ts';
import { businessYear, SALE_SHARE } from './business.ts';
import { assetReturn, drawYear, HOUSE_IDIO_SD, lotteryYear, TICKET_SHARE } from './finance.ts';
import { gauss } from '../model/latent.ts';
import { OWNER } from './work.ts';
import { bandOf, chooseOccupation, drawOcc, eduLevel, FIELDS, makeJob, OCC_NAMES, redrawTastes, STATUS_TEXT } from './work.ts';
import { livingRule, pensionChances, chronicFrom, spellYears, asfrAt, CHRONIC_FROM, chronicModel, type Chronic, HIV_FROM, hivModel, hivSplit, maritalRates, marriage, marriedBirthRate, smokingK } from './calibrate.ts';
import { num, oneIn, t, type T } from './i18n.ts';


const log = (p: Person, kind: LogKind, text: T, source?: T) => p.log.push({ age: p.age, kind, text, source });

const QUINTILE: T[] = [
  t('thuộc nhóm 20% nghèo nhất', 'among the poorest 20%'),
  t('khá nghèo', 'that is fairly poor'),
  t('có mức sống trung bình', 'of average means'),
  t('khá giả', 'that is fairly well-off'),
  t('thuộc nhóm 20% giàu nhất', 'among the richest 20%'),
];

const sibWord = (s: Kin): T => s.bornAt === undefined // younger siblings are born during the person's life
  ? (s.sex === 'M' ? t('anh trai', 'older brother') : t('chị gái', 'older sister'))
  : (s.sex === 'M' ? t('em trai', 'younger brother') : t('em gái', 'younger sister'));
const childWord = (s: Sex): T => s === 'M' ? t('con trai', 'son') : t('con gái', 'daughter');
const spouseWord = (s: Sex): T => s === 'M' ? t('chồng', 'husband') : t('vợ', 'wife');

export function simulateLife(world: World, rng: Rng, mode: 'births' | 'population' = 'births'): Person {
  const p = createPerson(beBorn(world, rng, mode), rng, world.causes);
  while (p.alive) step(world, p, rng);
  return p;
}

/** One year of life at p.age; increments age if the person survives. */
export function step(world: World, p: Person, rng: Rng): void {
  const { c, plan } = p;
  // Social patterns of the country the person grew up in; labour market, pensions and old-age living of
  // the country they live in (see raisedIn in person.ts).
  const rm = raisedIn(p), rc = rm.c, wm = p.residence ?? p.b.country, wc = wm.c;
  const a = p.age, female = p.b.sex === 'F';
  let gaveBirth = false;

  // ------------------------------------------------ childhood
  if (a === 0) logBirth(p, world.totalBirths);
  if (a === 1 && !p.vaccinated) log(p, 'health',
    t('Bạn không được tiêm vắc xin sởi.', 'You never got the measles vaccine.'),
    t(`Ở ${c.name.vi}, ${num(100 - c.measles, 'vi')}% trẻ không được tiêm mũi sởi (WHO/UNICEF).`,
      `In ${c.name.en}, ${num(100 - c.measles, 'en')}% of children miss the measles shot (WHO/UNICEF).`));
  if (a === 2 && p.stunted) log(p, 'health',
    t('Thiếu ăn kéo dài khiến bạn thấp còi so với tuổi.', 'Years of not eating enough leave you stunted for your age.'),
    t(`${num(c.stunting, 'vi', 1)}% trẻ dưới 5 tuổi ở ${c.name.vi} bị thấp còi (UNICEF/WHO).`,
      `${num(c.stunting, 'en', 1)}% of children under 5 in ${c.name.en} are stunted (UNICEF/WHO).`));

  // ------------------------------------------------ school
  if (a === 6) {
    if (plan.schoolYears === 0) log(p, 'school', t('Bạn không được đi học.', 'You never go to school.'),
      t(`${num(100 - rc.compl1, 'vi')}% trẻ em ở ${rc.name.vi} không học hết tiểu học (UNESCO).`,
        `${num(100 - rc.compl1, 'en')}% of children in ${rc.name.en} don't finish primary school (UNESCO).`));
    else log(p, 'school', t('Bạn bắt đầu đi học.', 'You start school.'));
  }
  if (plan.schoolYears > 0 && plan.schoolYears < 12 && a === 6 + plan.schoolYears) {
    const reason = plan.childMarriageAge !== undefined && plan.childMarriageAge <= a + 1
      ? t(' để lấy chồng', ' to get married')
      : p.b.wealthPct < 0.4 ? t(' để phụ giúp gia đình', ' to help support your family') : t('', '');
    log(p, 'school', t(`Bạn nghỉ học sau ${plan.schoolYears} năm${reason.vi}.`, `You leave school after ${plan.schoolYears} years${reason.en}.`));
  }
  if (plan.schoolYears === 12 && a === 18) {
    if (plan.university) log(p, 'school', t(`Bạn tốt nghiệp phổ thông và vào đại học, học ngành ${FIELDS[plan.field ?? 0].vi}.`,
      `You finish secondary school and start university, studying ${FIELDS[plan.field ?? 0].en}.`),
      t(`Ở ${rc.name.vi}, tỷ lệ nhập học đại học là ${num(rc.tertiary, 'vi')}% (UNESCO).`,
        `University enrollment in ${rc.name.en} is ${num(rc.tertiary, 'en')}% (UNESCO).`));
    else log(p, 'school', t('Bạn tốt nghiệp phổ thông.', 'You finish secondary school.'));
  }
  if (plan.vocational && a === 15) log(p, 'school', t('Bạn vào học trường nghề.', 'You go to a vocational school.'),
    t(`${num(rc.voc_upper, 'vi')}% học sinh THPT ở ${rc.name.vi} học theo chương trình dạy nghề (UNESCO).`,
      `${num(rc.voc_upper, 'en')}% of upper secondary students in ${rc.name.en} are in vocational programmes (UNESCO).`));
  if (plan.university && a === 22) log(p, 'school', t('Bạn tốt nghiệp đại học.', 'You graduate from university.'));
  if (a === plan.internetAge) log(p, 'family', t('Lần đầu tiên bạn lên mạng.', 'You go online for the first time.'));

  // ------------------------------------------------ work
  const workStart = Math.max(15, plan.university ? 22 : 6 + plan.schoolYears);
  const working = plan.worksOutside && a >= workStart && a < plan.exitAge;
  // Occupation: chosen on entering work and re-examined at each new age band (see work.ts). Emigrants
  // work in their new country's labour market.
  if (working && !p.money.biz && (a === workStart || bandOf(a) !== bandOf(a - 1))) {
    const labour = p.residence ?? p.b.country;
    if (a !== workStart) redrawTastes(p.career, rng);
    const occ = chooseOccupation(labour, p.b.sex, eduLevel(plan.schoolYears, plan.university), bandOf(a), p.career);
    const prev = p.career.job;
    if (!prev || prev.occ !== occ) {
      // Going back to an occupation group held before means going back to that same job.
      const before = p.career.history.findLast(h => h.job.occ === occ)?.job;
      const job = before ? { ...before } : makeJob(labour, p.b.sex, occ, plan.field, rng, a);
      // Top-0.1% wealth is mostly an owned business (see money.ts): those people run one.
      if (p.money.owner && job.status !== 'employer' && a >= 25) {
        job.status = 'employer'; job.informal = false;
        if (occ >= 4) job.title = OWNER[occ] ?? OWNER[5];
      }
      p.career.job = job;
      p.career.history.push({ age: a, job });
      const owner = job.status === 'employer' && job.occ >= 4; // title already says they run the business
      const how = [owner ? '' : STATUS_TEXT[job.status].vi, job.informal && job.status !== 'family' ? 'không hợp đồng, không bảo hiểm' : ''].filter(Boolean).join(', ') || 'có đăng ký kinh doanh';
      const howEn = [owner ? '' : STATUS_TEXT[job.status].en, job.informal && job.status !== 'family' ? 'with no contract or social insurance' : ''].filter(Boolean).join(', ') || 'a registered business';
      const share = labour.c.work[p.b.sex].ocu[occ];
      const lc = labour.c;
      const pay = monthlyEarnings(labour, p.b.sex, job, a, p.money.personal);
      // Pay before tax; for jobs that pay tax, also what is left after income tax and contributions.
      const net = netPay(labour.c, job, pay), taxed = net < pay - 1e-9;
      const payVi = job.status === 'family' ? '' : `, thu nhập khoảng ${formatMoney(labour.c, pay, 'vi')}${perMonth('vi')}`
        + (taxed ? ` (thực nhận ${formatMoney(labour.c, net, 'vi')} sau thuế và bảo hiểm)` : '');
      const payEn = job.status === 'family' ? '' : `, earning about ${formatMoney(labour.c, pay, 'en')}${perMonth('en')}`
        + (taxed ? ` (${formatMoney(labour.c, net, 'en')} after tax and contributions)` : '');
      log(p, 'work', !prev
        ? t(`Bạn bắt đầu đi làm: ${job.title.vi} (${how})${payVi}.`, `You start work as ${an(job.title.en)} (${howEn})${payEn}.`)
        : occ === 1 ? t(`Bạn được đề bạt làm ${job.title.vi}${payVi}.`, `You are promoted to ${job.title.en}${payEn}.`)
          : t(`Bạn chuyển sang làm ${job.title.vi} (${how})${payVi}.`, `You change jobs and become ${an(job.title.en)} (${howEn})${payEn}.`),
        !prev ? t(`${num(100 * share, 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} đi làm ở ${lc.name.vi} thuộc nhóm nghề "${OCC_NAMES[occ].vi}" (ILO).`,
          `${num(100 * share, 'en')}% of working ${female ? 'women' : 'men'} in ${lc.name.en} are ${OCC_NAMES[occ].en} (ILO).`) : undefined);
    }
  }
  if (a === 40 && working && p.career.job) {
    const j = p.career.job;
    p.jobAt40 = { occ: j.occ, sector: j.sector, status: j.status, informal: j.informal };
  }
  const farming = p.career.job?.sector === 'agr';
  // Unemployment (wage and salary workers; farmers don't lose a job in the same way). Rates by age and
  // spell lengths from ILO (see calibrate.ts); simulated in continuous time within the year so spells
  // can follow each other, and new entrants may first have to search for a job.
  if (working && !farming && a >= workStart && !p.money.biz) {
    const young = a < 25;
    const u = young ? wc.unemp_age[p.b.sex].u15 : wc.unemp_age[p.b.sex].u25;
    const hazard = u / ((1 - u) * spellYears(wc)); // job losses per year of employment
    const end = a + 1;
    let now = a, out = 0;
    const spell = (start: number, entry: boolean) => {
      const months = Math.max(1, Math.round(-12 * spellYears(wc) * Math.log(1 - rng())));
      p.unemployedUntil = start + months / 12;
      p.unemployedYears++;
      const span = months < 12 ? t(`${months} tháng`, `${months} month${months > 1 ? 's' : ''}`)
        : t(`${num(months / 12, 'vi', months % 12 ? 1 : 0)} năm`, `${num(months / 12, 'en', months % 12 ? 1 : 0)} years`);
      log(p, 'work', entry
        ? t(`Bạn mất ${span.vi} mới tìm được việc làm đầu tiên.`, `It takes you ${span.en} to find your first job.`)
        : p.career.job?.status === 'family'
          ? t(`Việc làm ăn của gia đình đình trệ, bạn không có việc suốt ${span.vi}.`, `Your family's business stalls and you have no work for ${span.en}.`)
        : p.career.job && p.career.job.status !== 'emp'
          ? t(`Bạn làm ăn thất bại, không có đồng thu nhập nào suốt ${span.vi}.`, `Your business fails and you have no work for ${span.en}.`)
          : t(`Bạn mất việc và thất nghiệp ${span.vi}.`, `You lose your job and are out of work for ${span.en}.`),
        p.unemployedYears === 1 ? t(`Tỷ lệ thất nghiệp của ${female ? 'phụ nữ' : 'đàn ông'} ${young ? '15–24' : 'từ 25'} tuổi ở ${wc.name.vi}: ${num(100 * u, 'vi', 1)}%; ${num(100 * wc.ltu, 'vi')}% người thất nghiệp đã không có việc hơn một năm (ILO).`,
          `Unemployment for ${female ? 'women' : 'men'} ${young ? 'aged 15–24' : '25 and over'} in ${wc.name.en}: ${num(100 * u, 'en', 1)}%; ${num(100 * wc.ltu, 'en')}% of the unemployed have been out of work over a year (ILO).`) : undefined);
    };
    if (a === workStart && rng() < u) spell(a, true);
    for (let guard = 0; now < end && guard < 20; guard++) {
      if (p.unemployedUntil > now) { const e = Math.min(end, p.unemployedUntil); out += e - now; now = e; continue; }
      now += -Math.log(1 - rng()) / hazard;
      if (now < end) spell(now, false);
    }
    if (young) { p.workYears.young++; p.workYears.youngOut += out; } else { p.workYears.adult++; p.workYears.adultOut += out; }
    p.year.out = out; p.year.uExp = u;
  }
  if (plan.worksOutside && a === plan.exitAge && a > workStart) log(p, 'work', farming
    ? t('Bạn không còn đủ sức làm đồng nữa nên nghỉ làm.', 'You no longer have the strength to work the land, and stop working.')
    : p.career.job && a - workStart > 5
      ? t(`Bạn nghỉ hưu sau ${a - workStart} năm đi làm; công việc cuối cùng là ${p.career.job.title.vi}.`, `You retire after ${a - workStart} years of work; your last job was ${p.career.job.title.en}.`)
      : t('Bạn nghỉ hưu.', 'You retire.'),
    t(`Ở ${wc.name.vi}, ${num(100 * wc.lfp_age[p.b.sex].p65, 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} trên 65 tuổi vẫn đi làm (ILO).`,
      `In ${wc.name.en}, ${num(100 * wc.lfp_age[p.b.sex].p65, 'en')}% of ${female ? 'women' : 'men'} over 65 are still working (ILO).`));

  // ------------------------------------------------ marriage, divorce, remarriage, children
  const mr = maritalRates(rm)[p.b.sex];
  const gap = marriage(rc).gap; // husbands are older by the gap in median marriage age (UN WMD)
  const wed = (kind: 'first' | 'again') => {
    const spouseSex: Sex = female ? 'M' : 'F';
    const spouseAge = Math.max(15, Math.round(a + (female ? gap : -gap) + (rng() - 0.5) * (kind === 'first' ? 6 : 10)));
    const home = p.residence ?? p.b.country;
    p.spouse = { sex: spouseSex, age: spouseAge, alive: true, name: pickName(home.c, spouseSex, p.nameKey + 'spouse' + p.marriages, [p.name, p.mother.name, p.father.name, ...p.pastSpouses]) };
    p.marital = 'married';
    p.marriages++;
    // The spouse works at their sex's prime-age participation rate (ILO); their earnings follow the
    // national occupation mix for their sex and a personal factor linked to the person's own standing
    // (ASSUMPTION: assortative mating, correlation 0.4).
    const sp = (p.residence ?? p.b.country);
    p.money.spouseWorks = rng() < sp.c.lfp_age[spouseSex].p25;
    if (p.money.spouseWorks) {
      const occ = drawOcc(sp.c.work[spouseSex].ocu, rng);
      const job = makeJob(sp, spouseSex, occ, undefined, rng);
      p.money.spouseMonthly = monthlyEarnings(sp, spouseSex, { ...job, occ }, 40, personalFactor(0.4 * p.adultZ / 0.6, rng));
    } else p.money.spouseMonthly = 0;
    return { spouseSex, spouseAge, spouseName: p.spouse.name ?? '' };
  };
  if (a === plan.marriageAge) {
    const { spouseSex, spouseAge, spouseName } = wed('first');
    if (plan.childMarriageAge !== undefined) log(p, 'love',
      t(`Năm ${a} tuổi, bạn bị gả cho ${spouseName}, một người đàn ông ${spouseAge} tuổi.`, `At ${a}, you are married off to ${spouseName}, a ${spouseAge}-year-old man.`),
      t(`Ở ${rc.name.vi}, ${num(rc.child_marriage, 'vi')}% phụ nữ lấy chồng trước 18 tuổi (UNICEF).`,
        `In ${rc.name.en}, ${num(rc.child_marriage, 'en')}% of women were married before 18 (UNICEF).`));
    else log(p, 'love', t(`Bạn kết hôn với ${spouseName}, ${spouseAge} tuổi.`, `You marry ${spouseName}, ${spouseAge}.`));
    void spouseSex;
    if (!plan.worksOutside && female) log(p, 'work', t('Bạn ở nhà lo việc nhà và chăm sóc gia đình.', 'You stay home to run the household.'));
  } else if (p.marital === 'married' && p.spouse?.alive && rng() < mr.h * alcoholDivorceK(p, rc)) {
    p.marital = 'divorced';
    if (p.spouse?.name) p.pastSpouses.push(p.spouse.name);
    p.spouse = undefined;
    log(p, 'love', p.alcohol
      ? (p.marriages > 1 ? t('Rượu lại làm đổ vỡ thêm một cuộc hôn nhân. Hai người ly hôn.', 'Drink breaks up another marriage. You divorce.')
        : t('Chứng nghiện rượu của bạn khiến gia đình căng thẳng nhiều năm. Cuối cùng hai người ly hôn.', 'Years of strain over your drinking end the marriage. You divorce.'))
      : t('Hôn nhân của bạn tan vỡ. Hai người ly hôn.', 'Your marriage breaks down. You divorce.'),
      p.alcohol ? t('Nghiện rượu làm nguy cơ ly hôn tăng khoảng gấp đôi (giả định, theo các nghiên cứu theo dõi vợ chồng như Torvik và cộng sự 2013).', 'Alcohol use disorder roughly doubles the risk of divorce (assumption, after couple studies such as Torvik et al. 2013).') : undefined);
  } else if ((p.marital === 'divorced' || p.marital === 'widowed') && a <= 64 && rng() < (p.marital === 'divorced' ? mr.rd : mr.rw)) {
    const before = p.pastSpouses[p.pastSpouses.length - 1];
    const { spouseAge, spouseName } = wed('again');
    log(p, 'love', before
      ? t(`Sau những năm tháng với ${before}, bạn tái hôn với ${spouseName}, ${spouseAge} tuổi.`, `After your years with ${before}, you remarry, to ${spouseName}, ${spouseAge}.`)
      : t(`Bạn tái hôn với ${spouseName}, ${spouseAge} tuổi.`, `You remarry, to ${spouseName}, ${spouseAge}.`));
  }
  // Births: only while married with a living spouse; the rate depends on the wife's age.
  const wifeAge = female ? a : Math.round(a - gap);
  // A couple who has all the children they want avoids more when they have modern contraception (UN SDG 3.7.1).
  const avoid = () => plan.maxKids !== undefined && p.children.length >= plan.maxKids && rng() < rc.fp_satisfied / 100;
  if (p.marital === 'married' && p.spouse?.alive && rng() < marriedBirthRate(rm, wifeAge) * plan.fertK && !avoid()) {
    const s: Sex = rng() < rm.pMale ? 'M' : 'F';
    const kidName = pickName((p.residence ?? p.b.country).c, s, p.nameKey + 'child' + p.children.length, [p.name, p.spouse?.name, p.mother.name, p.father.name, ...p.children.map(k => k.name)]);
    p.children.push({ sex: s, age: 0, alive: true, bornAt: a, bornProvince: p.homeProvince, familyZ: mortalityZ(p), bornIn: (p.residence ?? p.b.country).c.id, other: p.spouse, otherAgeAtBirth: p.spouse?.age, name: kidName });
    gaveBirth = female;
    const nth = p.children.length;
    log(p, 'family', t(`${nth === 1 ? 'Con đầu lòng' : `Đứa con thứ ${nth}`} của bạn chào đời, là một bé ${s === 'M' ? 'trai' : 'gái'} tên ${kidName}.`,
      `Your ${nth === 1 ? 'first' : ordinal(nth)} child is born, a ${s === 'M' ? 'boy' : 'girl'} named ${kidName}.`));
  }
  if (a === 42 || a === 62) p.statusAt[a] = p.marital;
  if (a === plan.displacedAge && !p.residence) log(p, 'loss',
    t('Xung đột nổ ra. Gia đình bạn phải bỏ nhà, chạy đến nơi khác trong nước.', 'Conflict comes. Your family has to abandon your home and flee elsewhere in the country.'),
    t(`${num(100 * c.mig!.idp, 'vi', 1)}% dân số ${c.name.vi} đang phải rời nhà, sống ở nơi khác trong nước vì xung đột hoặc thiên tai (UNHCR 2024).`,
      `${num(100 * c.mig!.idp, 'en', 1)}% of people in ${c.name.en} are displaced inside the country by conflict or disaster (UNHCR 2024).`));
  if (a === plan.emigrateAge && plan.destination && world.byId[plan.destination]) {
    const dest = world.byId[plan.destination].c;
    p.residence = world.byId[plan.destination];
    // Immigrants mostly settle in cities: a province weighted by its urban population.
    p.homeProvince = pickProvince(dest, true, p.nameKey + 'abroad');
    const where = p.homeProvince ? `${p.homeProvince}, ` : '';
    if (a < RAISED_ABROAD_BEFORE) replanChild(p, p.residence, rng);
    const who = a < 16 ? t('Gia đình bạn', 'Your family') : t('Bạn', 'You');
    log(p, 'family', plan.refugee
      ? t(`${who.vi} phải chạy khỏi ${c.name.vi}, sang ${dest.name.vi} tị nạn.`,
        `${who.en} ${a < 16 ? 'has' : 'have'} to flee ${c.name.en} for ${dest.name.en} as refugees.`)
      : t(`${who.vi} rời ${c.name.vi} sang ${where}${dest.name.vi} sinh sống.`, `${who.en} ${a < 16 ? 'moves' : 'move'} from ${c.name.en} to ${where}${dest.name.en}.`),
      plan.refugee
        ? t(`${num(100 * c.mig!.refugee_share, 'vi')}% người ${c.name.vi} ở nước ngoài là người tị nạn hoặc xin tị nạn (UNHCR 2024).`,
          `${num(100 * c.mig!.refugee_share, 'en')}% of people from ${c.name.en} living abroad are refugees or asylum seekers (UNHCR 2024).`)
        : t(`${num(100 * c.mig!.abroad[p.b.sex], 'vi', 1)}% ${female ? 'phụ nữ' : 'đàn ông'} sinh ra ở ${c.name.vi} đang sống ở nước ngoài (UN DESA 2024).`,
          `${num(100 * c.mig!.abroad[p.b.sex], 'en', 1)}% of ${female ? 'women' : 'men'} born in ${c.name.en} live abroad (UN DESA 2024).`));
  }
  // ------------------------------------------------ old age
  if (a === 65) {
    const pc = pensionChances(wc, p.b.sex);
    // Same definition as the calibration: a formal job at 40 (prime working age).
    const formal = !!p.jobAt40 && !p.jobAt40.informal && p.jobAt40.status !== 'family';
    p.pension = rng() < (formal ? pc.formal : pc.other);
    p.money.pensionMonthly = !p.pension ? 0 : formal && p.money.lastMonthly > 0
      ? REPLACEMENT * p.money.lastMonthly : SOCIAL_PENSION * incomeAt(wm.income, 0.5) / 12;
    log(p, 'work', p.pension
      ? (plan.worksOutside && a < plan.exitAge
        ? t(`Bạn đến tuổi nhận lương hưu, khoảng ${formatMoney(wc, p.money.pensionMonthly, 'vi')}${perMonth('vi')}, nhưng vẫn tiếp tục đi làm.`,
          `You reach pension age, about ${formatMoney(wc, p.money.pensionMonthly, 'en')}${perMonth('en')}, but keep working.`)
        : t(`Bạn bắt đầu nhận lương hưu, khoảng ${formatMoney(wc, p.money.pensionMonthly, 'vi')}${perMonth('vi')}.`,
          `You start receiving a pension of about ${formatMoney(wc, p.money.pensionMonthly, 'en')}${perMonth('en')}.`))
      : t('Bạn không có lương hưu.', 'You have no pension.'),
      t(`${num(100 * wc.pension[p.b.sex], 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} quá tuổi hưu ở ${wc.name.vi} nhận lương hưu (ILO/UN SDG 1.3.1).`,
        `${num(100 * wc.pension[p.b.sex], 'en')}% of ${female ? 'women' : 'men'} above pension age in ${wc.name.en} receive a pension (ILO/UN SDG 1.3.1).`));
  }
  if (a === 70 || a === 82) {
    // Living arrangement drawn from the country's shares (65+ at 70, 80+ at 82) among the options that
    // are possible for this person.
    const lv = wc.living[p.b.sex][a === 70 ? '65' : '80'];
    const rule = livingRule(wm, p.b.sex, a);
    const hasKid = p.children.some(k => k.alive && k.age >= 20);
    const pick = hasKid && rng() < rule.children ? 'children'
      : p.spouse?.alive && rng() < rule.couple ? 'couple'
        : hasKid && p.grandchildren.some(k => k.alive && k.age < 20) && rng() < rule.skip ? 'skip'
          : p.spouse?.alive ? 'couple' : rng() < rule.alone ? 'alone' : 'other';
    p.livingAt[a] = pick;
    const text: Record<string, T> = {
      alone: t('Bạn sống một mình.', 'You live alone.'),
      couple: t('Hai vợ chồng bạn sống riêng.', 'You live with your spouse, just the two of you.'),
      children: t('Bạn sống cùng con cái.', 'You live with one of your children.'),
      skip: t('Bạn sống với các cháu vì bố mẹ chúng đi làm ăn xa.', 'You live with your grandchildren while their parents work far away.'),
      other: t('Bạn sống cùng họ hàng.', 'You live with other relatives.'),
    };
    log(p, 'family', text[pick], a === 82
      ? t(`Ở ${c.name.vi}, ${num(100 * lv.alone, 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} trên 80 tuổi sống một mình, ${num(100 * lv.children, 'vi')}% sống với con (UN).`,
        `In ${c.name.en}, ${num(100 * lv.alone, 'en')}% of ${female ? 'women' : 'men'} over 80 live alone and ${num(100 * lv.children, 'en')}% with their children (UN).`)
      : undefined);
  }
  if (a === 20) {
    const odds = billionaireShare(c);
    log(p, 'work', t(`Khả năng bạn thành tỷ phú: ${odds > 0 ? '1 trên ' + num(1 / odds, 'vi') : 'gần như bằng không'}.`,
      `Your chance of becoming a billionaire: ${odds > 0 ? '1 in ' + num(1 / odds, 'en') : 'close to zero'}.`),
      t(`Ở ${c.name.vi} có ${num(c.wealth.billionaires, 'vi')} tỷ phú trên ${num(c.wealth.adults / 1e6, 'vi', 1)} triệu người trưởng thành (Forbes 2026, WID).`,
        `${c.name.en} has ${num(c.wealth.billionaires, 'en')} billionaires among ${num(c.wealth.adults / 1e6, 'en', 1)} million adults (Forbes 2026, WID).`));
  }
  if (a === 18) log(p, 'health', t(`Bạn cao ${(plan.heightCm / 100).toFixed(2).replace('.', 'm')}.`, `You grow to ${plan.heightCm} cm.`),
    t(`Chiều cao trung bình của ${female ? 'phụ nữ' : 'đàn ông'} ${c.name.vi}: ${num(c.height[p.b.sex], 'vi')} cm (NCD-RisC).`,
      `Average height of ${female ? 'women' : 'men'} in ${c.name.en}: ${num(c.height[p.b.sex], 'en')} cm (NCD-RisC).`));
  if (a === plan.accountAge) log(p, 'work', t('Bạn mở tài khoản ngân hàng (hoặc ví điện tử) đầu tiên.', 'You open your first bank or mobile-money account.'),
    t(`${num(female ? rc.account_f : rc.account_m, 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} ở ${rc.name.vi} có tài khoản; ở nhóm 40% nghèo nhất là ${num(rc.account_p40, 'vi')}% (World Bank Findex).`,
      `${num(female ? rc.account_f : rc.account_m, 'en')}% of ${female ? 'women' : 'men'} in ${rc.name.en} have an account; ${num(rc.account_p40, 'en')}% among the poorest 40% (World Bank Findex).`));
  if (a === plan.obeseAge) log(p, 'health', t('Bạn bị béo phì.', 'You become obese.'),
    t(`${num(100 * c.ncd.obese[p.b.sex], 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} trưởng thành ở ${c.name.vi} bị béo phì (WHO).`,
      `${num(100 * c.ncd.obese[p.b.sex], 'en')}% of adult ${female ? 'women' : 'men'} in ${c.name.en} are obese (WHO).`));
  if (a === plan.alcoholAge) {
    p.alcohol = true;
    log(p, 'health', t('Bạn bắt đầu nghiện rượu.', 'You develop a drinking problem.'),
      t(`${num(100 * c.ncd.aud[p.b.sex], 'vi', 1)}% ${female ? 'phụ nữ' : 'đàn ông'} ở ${c.name.vi} có rối loạn do sử dụng rượu (WHO).`,
        `${num(100 * c.ncd.aud[p.b.sex], 'en', 1)}% of ${female ? 'women' : 'men'} in ${c.name.en} have an alcohol use disorder (WHO).`));
  }
  if (a === plan.diabetesAge) {
    p.diabetes = true;
    const treated = rng() < (c.ncd.dm_treat[p.b.sex] ?? c.ncd.dm_treat.T ?? 0);
    p.treated.dm = treated;
    log(p, 'health', treated
      ? t('Bạn được chẩn đoán tiểu đường và bắt đầu điều trị.', 'You are diagnosed with diabetes and start treatment.')
      : t('Bạn mắc tiểu đường nhưng không được điều trị.', 'You develop diabetes but do not get treatment for it.'),
      t(`${num(100 * c.ncd.dm_prev[p.b.sex], 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} từ 30 tuổi ở ${c.name.vi} bị tiểu đường; ${num(100 * (c.ncd.dm_treat[p.b.sex] ?? c.ncd.dm_treat.T ?? 0), 'vi')}% được điều trị (WHO).`,
        `${num(100 * c.ncd.dm_prev[p.b.sex], 'en')}% of ${female ? 'women' : 'men'} 30+ in ${c.name.en} have diabetes; ${num(100 * (c.ncd.dm_treat[p.b.sex] ?? c.ncd.dm_treat.T ?? 0), 'en')}% are treated (WHO).`));
  }
  if (a === plan.hypertensionAge) {
    p.hypertension = true;
    const diag = c.ncd.ht_diag[p.b.sex] ?? c.ncd.ht_diag.T ?? 0, treat = c.ncd.ht_treat[p.b.sex] ?? c.ncd.ht_treat.T ?? 0;
    const r = rng();
    p.treated.ht = r < treat;
    log(p, 'health', r < treat
      ? t('Bạn phát hiện mình bị tăng huyết áp và bắt đầu uống thuốc.', 'You are found to have high blood pressure and start medication.')
      : r < diag ? t('Bạn biết mình bị tăng huyết áp nhưng không điều trị.', 'You learn you have high blood pressure but are not treated.')
        : t('Huyết áp của bạn tăng cao, nhưng chưa ai đo cho bạn nên bạn không hề biết.', 'Your blood pressure becomes high, but no one measures it and you never know.'),
      t(`${num(100 * c.ncd.ht_prev[p.b.sex], 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} 30–79 tuổi ở ${c.name.vi} bị tăng huyết áp, nhưng chỉ ${num(100 * diag, 'vi')}% trong số đó biết mình bị bệnh (WHO).`,
        `${num(100 * c.ncd.ht_prev[p.b.sex], 'en')}% of ${female ? 'women' : 'men'} aged 30–79 in ${c.name.en} have high blood pressure; only ${num(100 * diag, 'en')}% of them know it (WHO).`));
  }
  if (a === plan.hivAge) {
    p.hiv = true;
    const treated = rng() < c.art / 100;
    p.treated.hiv = treated;
    log(p, 'health', treated
      ? t('Bạn phát hiện mình nhiễm HIV và được điều trị bằng thuốc kháng virus (ARV).', 'You find out you have HIV and start antiretroviral treatment.')
      : t('Bạn nhiễm HIV nhưng không được điều trị.', 'You have HIV but do not get treatment.'),
      t(`${num(c.hiv, 'vi', 1)}% người 15–49 tuổi ở ${c.name.vi} sống chung với HIV; ${num(c.art, 'vi')}% được điều trị (UNAIDS).`,
        `${num(c.hiv, 'en', 1)}% of people aged 15–49 in ${c.name.en} live with HIV; ${num(c.art, 'en')}% are on treatment (UNAIDS).`));
  }
  if (a === plan.smokeStartAge) {
    p.smoker = true;
    log(p, 'health', t('Bạn bắt đầu hút thuốc.', 'You start smoking.'),
      t(`${num(female ? rc.smoke_f : rc.smoke_m, 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} ở ${rc.name.vi} hút thuốc (WHO).`,
        `${num(female ? rc.smoke_f : rc.smoke_m, 'en')}% of ${female ? 'women' : 'men'} in ${rc.name.en} use tobacco (WHO).`));
  }

  // ------------------------------------------------ income this year
  {
    const labour = p.residence ?? p.b.country;
    const job = p.career.job;
    let own = 0;
    if (working && job) {
      // A business owner takes out what an employee in the same occupation earns, times their factor x.
      const full = p.money.biz ? monthlyEarnings(labour, p.b.sex, { ...job, status: 'emp' }, a, p.money.personal) * p.money.biz.x
        : monthlyEarnings(labour, p.b.sex, job, a, p.money.personal);
      const outShare = Math.max(0, Math.min(1, p.unemployedUntil - a));
      own = full * (1 - outShare);
      if (full > 0 && job.status !== 'family') p.money.lastMonthly = full;
    }
    // Household income per person: the national distribution at the person's position (family's
    // position before adulthood, own adult standing after 25, moved by this year's ups and downs).
    const pos = normCdf(mortalityZ(p));
    const perCapita = incomeAt(labour.income, pos) / 12;
    if (a >= 18 && (a % 5 === 0 || a === 18)) p.money.byAge[a] = { own, perCapita };
  }

  // ------------------------------------------------ the player's business
  if (p.money.biz) {
    const biz = p.money.biz, years = a - biz.start;
    if (!working) {
      p.money.bizLedger -= SALE_SHARE * biz.value;
      log(p, 'work', t(`Bạn bán lại doanh nghiệp khi thôi làm việc, được khoảng ${formatMoney(wc, SALE_SHARE * biz.value, 'vi')}.`,
        `You sell your business when you stop working, for about ${formatMoney(wc, SALE_SHARE * biz.value, 'en')}.`));
      endBusiness(p);
    } else if (businessYear(biz, a, rng)) {
      log(p, 'work', t(`Doanh nghiệp của bạn đóng cửa sau ${years + 1} năm; số vốn bỏ vào mất trắng.`, `Your business closes after ${years + 1} years; the money you put in is gone.`),
        t(`Ở Mỹ, khoảng một nửa doanh nghiệp mới đóng cửa trong 5 năm đầu và 2/3 trong 10 năm (BLS).`, `In the US about half of new businesses close within 5 years and two thirds within 10 (BLS).`));
      p.money.bizHistory.push({ start: biz.start, end: a + 1, failed: true });
      endBusiness(p);
      p.unemployedUntil = a + 1 + 0.5; // ASSUMPTION: about six months to find work again
    }
  }

  // ------------------------------------------------ school sports team (player's choice; for the story)
  if (p.plan.team && a >= 12 && a <= 17 && !p.log.some(e => e.kind === 'school' && e.text.en.startsWith('Your team')) && rng() < TEAM_WIN) {
    log(p, 'school', t('Đội thể thao của bạn vô địch giải đấu giữa các trường. Cả đội được tuyên dương trước toàn trường.', 'Your team wins the inter-school championship and is honoured in front of the whole school.'));
  }

  // ------------------------------------------------ paying for the children's schooling (player's choice)
  if (p.money.eduInvest) {
    const home = p.residence ?? p.b.country;
    const perPerson = incomeAt(home.income, normCdf(mortalityZ(p)));
    for (const k of p.children) {
      if (k.alive && k.age >= 6 && k.age <= 17) { p.money.familySpent += EDU_COST * perPerson; k.eduYears = (k.eduYears ?? 0) + 1; }
    }
  }
  if (p.money.giftIn && a === p.money.giftIn.age) {
    p.money.giftReceived += p.money.giftIn.amount;
    const who = p.mother.played ? t('Mẹ', 'Your mother') : t('Bố', 'Your father');
    log(p, 'family', t(`${who.vi} cho bạn khoảng ${formatMoney(p.b.country.c, p.money.giftIn.amount, 'vi')} để lập nghiệp.`, `${who.en} gives you about ${formatMoney(p.b.country.c, p.money.giftIn.amount, 'en')} to make your way.`));
  }

  // ------------------------------------------------ health bills
  {
    const hm = p.residence ?? p.b.country, hs = healthSpend(hm);
    const chronic = p.diabetes || p.hypertension || p.hiv;
    p.money.bills.years++;
    const yearly = incomeAt(hm.income, normCdf(mortalityZ(p)));
    // WID wealth already reflects an average lifetime of health bills, so net worth moves by the
    // difference between what this person paid and what an average person of the same age and income
    // would have paid (unlucky people end up poorer, lucky ones richer; the country average is kept).
    p.money.expectedShocks += hs.h0 * hs.avgRisk[Math.min(100, a)] * hs.kappa * yearly;
    const pBill = Math.min(0.95, hs.h0 * healthRisk(a, chronic));
    p.year.pImpov = pBill * hs.pImpov;
    // Insurance (player's choice): a premium every year; bills shrink to the uncovered share.
    const insured = !!p.plan.insured && a >= 18;
    if (insured) p.money.shocks += INS_LOAD * INS_COVER * hs.h0 * healthRisk(a, chronic) * hs.kappa * yearly;
    if (rng() < pBill) {
      const impov = rng() < hs.pImpov && (!insured || rng() < 1 - INS_COVER);
      p.year.impov = impov;
      const cost = hs.kappa * yearly * (insured ? 1 - INS_COVER : 1);
      p.money.shocks += cost;
      if (impov) p.money.bills.impov++; else p.money.bills.large++;
      if (a - p.money.bills.lastLog >= 8) {
        p.money.bills.lastLog = a;
        // Name the drugs only for a condition being treated; untreated illness shows up as a crisis.
        const what = p.hiv && p.treated.hiv ? t('thuốc điều trị HIV', 'HIV treatment') : p.diabetes && p.treated.dm ? t('thuốc và khám tiểu đường', 'diabetes drugs and check-ups')
          : p.hypertension && p.treated.ht ? t('thuốc huyết áp', 'blood pressure medication')
            : (p.diabetes || p.hypertension || p.hiv) && a >= 18 ? t('một đợt biến chứng do bệnh không được chữa', 'a crisis from an illness left untreated') : a < 5 ? t('thuốc men và viện phí khi bạn ốm', 'treating a sick child')
            : a >= 65 ? t('khám chữa bệnh tuổi già', 'health care in old age') : t('một đợt bệnh nặng', 'a serious illness');
        log(p, 'health', impov
          ? t(`Chi phí ${what.vi} khoảng ${formatMoney(hm.c, cost, 'vi')} khiến gia đình bạn rơi vào cảnh túng thiếu.`, `The cost of ${what.en}, about ${formatMoney(hm.c, cost, 'en')}, pushes your family into hardship.`)
          : a < 18 ? t(`Gia đình bạn phải chi một khoản lớn cho ${what.vi}: khoảng ${formatMoney(hm.c, cost, 'vi')}.`, `Your family pays a large bill for ${what.en}, about ${formatMoney(hm.c, cost, 'en')}.`)
          : t(`Bạn phải chi một khoản lớn cho ${what.vi}: khoảng ${formatMoney(hm.c, cost, 'vi')}.`, `You pay a large bill for ${what.en}, about ${formatMoney(hm.c, cost, 'en')}.`),
          t(`Mỗi năm, ${num(hm.c.oop_imp, 'vi')}% dân số ${hm.c.name.vi} tốn tiền chữa bệnh đến mức rơi vào nghèo, thêm ${num(hm.c.oop_large, 'vi')}% phải dành một phần lớn chi tiêu cho y tế (WHO/World Bank).`,
            `Each year ${num(hm.c.oop_imp, 'en')}% of people in ${hm.c.name.en} spend so much on health they are pushed into poverty, and another ${num(hm.c.oop_large, 'en')}% spend a large share of their budget (WHO/World Bank).`));
      }
    }
  }

  // ------------------------------------------------ life satisfaction (before this year's shocks are cleared)
  if (a >= 15) {
    const { value: v, reasons } = ladderWithReasons(p, rng);
    p.ladder.sum += v; p.ladder.n++;
    if (a === 20 || a === 40 || a === 60 || a === 80) {
      p.ladder.at[a] = v;
      const home = (p.residence ?? p.b.country).c;
      const why = reasons.length ? t(` Điều ảnh hưởng nhiều nhất: ${reasons.map(r => r.vi).join(' và ')}.`, ` What weighs most: ${reasons.map(r => r.en).join(' and ')}.`) : t('', '');
      log(p, 'health', t(`Nếu chấm cuộc sống của mình từ 0 (tệ nhất) đến 10 (tốt nhất), bạn cho ${v} điểm.${why.vi}`,
        `Asked to rate your life from 0 (the worst possible) to 10 (the best possible), you say ${v}.${why.en}`),
        t(`Điểm trung bình ở ${home.name.vi}: ${num(home.ladder, 'vi', 1)} (World Happiness Report, Gallup).`,
          `Average in ${home.name.en}: ${num(home.ladder, 'en', 1)} (World Happiness Report, Gallup).`));
    }
  }

  // Living standard moves on with this year's shocks (used below for mortality and from next year for income).
  moveTransient(p, rng);

  // ------------------------------------------------ savings and the lottery (player's choices)
  if (p.money.lottery.plays && a >= 18) {
    const home = (p.residence ?? p.b.country), price = TICKET_SHARE * incomeAt(home.income, 0.5) / 12;
    const { won, best } = lotteryYear(rng);
    p.money.lottery.spent += 52 * price; p.money.lottery.won += won * price;
    if (best >= 1_000_000) p.money.windfall += best * price;
    if (best >= 1000) log(p, 'work', best >= 1_000_000
      ? t(`Bạn trúng giải độc đắc xổ số: khoảng ${formatMoney(home.c, best * price, 'vi')}!`, `You hit the lottery jackpot: about ${formatMoney(home.c, best * price, 'en')}!`)
      : t(`Bạn trúng giải nhất xổ số: khoảng ${formatMoney(home.c, best * price, 'vi')}.`, `You win a first prize in the lottery: about ${formatMoney(home.c, best * price, 'en')}.`),
      t('Tỷ lệ trúng theo cơ cấu giải Vietlott Mega 6/45: độc đắc 1/8.145.060, giải nhất 1/34.808 mỗi vé.', 'Odds from the Vietlott Mega 6/45 prize table: jackpot 1 in 8,145,060, first prize 1 in 34,808 per ticket.'));
  }
  let yr: { r: number; u: number } | undefined;
  if ((p.money.portfolio !== 'usual' || p.money.invW !== undefined) && a >= 20) {
    const y = drawYear(rng);
    // A single property is far riskier than a national house-price index.
    const r = assetReturn(y, p.money.portfolio) + (p.money.portfolio === 'housing' ? HOUSE_IDIO_SD * gauss(rng) : 0);
    yr = { r, u: y.usual };
    if ((p.money.portfolio === 'stocks' && Math.abs(r) >= 0.3) || (p.money.portfolio === 'housing' && Math.abs(r) >= 0.2)) {
      const what = p.money.portfolio === 'stocks' ? t('cổ phiếu', 'shares') : t('nhà đất', 'property');
      log(p, 'work', r < 0
        ? t(`Thị trường sập: ${what.vi} của bạn mất ${num(-100 * r, 'vi')}% giá trị trong năm.`, `The market crashes: your ${what.en} lose ${num(-100 * r, 'en')}% in a year.`)
        : t(`Năm bùng nổ: ${what.vi} của bạn tăng ${num(100 * r, 'vi')}% giá trị.`, `A boom year: your ${what.en} gain ${num(100 * r, 'en')}%.`),
        t('Lãi thực sinh từ mô hình thống kê dựa trên lịch sử 16 nước giàu từ 1950 (Jordà-Schularick-Taylor).', 'Real return from a statistical model of 16 rich countries since 1950 (Jordà-Schularick-Taylor).'));
    }
  }

  // ------------------------------------------------ net worth
  if (a >= 20) {
    const labour = p.b.country; // wealth distribution of the country of birth (see money.ts)
    // Health bills and inheritance move net worth only by their difference from what an average person
    // in the same position would have had: WID wealth already contains both on average.
    // Inheritance scales wealth (base + received) / (base + expected), so it never turns savings into
    // debt for someone whose parents are still alive; for people in debt only an above-expected
    // inheritance counts.
    const base = netWorth(labour, p.money.wealthU, a), inh = p.money.inherited, exp = p.money.expectedInherit;
    const raw = (base > 0 ? base * (base + inh) / (base + exp) : base + Math.max(0, inh - exp))
      - (p.money.shocks - p.money.expectedShocks);
    // Investing differently from most people scales what you own; lottery tickets and prizes add up.
    // Holding savings differently from most people (finance.ts). The usual path `raw` is what most people
    // with this standing have: its change from last year is their return on the usual mix plus saving
    // (or spending down). Own wealth W earns the chosen return; saving adds the same amount, spending
    // down takes the same share.
    const m = p.money, prev = m.lastRaw;
    if (yr && prev !== undefined) {
      const w0 = m.invW ?? prev;
      const s = raw - prev * (1 + yr.u); // saving (+) or spending down (-) on the usual path
      m.invW = prev > 0 && s < 0 ? Math.max(0, w0 * (1 + yr.r)) * (1 + s / (prev * (1 + yr.u))) : w0 * (1 + yr.r) + s;
    }
    m.lastRaw = raw;
    const nw = (m.invW ?? raw) + m.lottery.won - m.lottery.spent + (m.biz?.value ?? 0) - m.bizLedger - m.familySpent + m.giftReceived;
    p.money.lastNW = nw;
    if (a === 30 || a === 50 || a === 70) {
      p.money.wealth[a] = nw;
      // Compared with all adults in the country (the WID distribution is a cross-section of adults).
      const top = 100 * (1 - wealthRank(labour.c, nw));
      log(p, 'work', t(`Tài sản ròng của bạn khoảng ${formatMoney(c, nw, 'vi')}${nw > 0 ? (top <= 50 ? `, nằm trong nhóm ${top < 1 ? top.toFixed(2) : Math.round(top)}% giàu nhất ở ${c.name.vi}` : `, nhiều hơn ${Math.round(100 - top)}% người trưởng thành ở ${c.name.vi}`) : ' (số nợ của bạn lớn hơn số tài sản đang có)'}.`,
        `Your net worth is about ${formatMoney(c, nw, 'en')}${nw > 0 ? (top <= 50 ? `, in the richest ${top < 1 ? top.toFixed(2) : Math.round(top)}% in ${c.name.en}` : `, more than ${Math.round(100 - top)}% of adults in ${c.name.en}`) : ' (you owe more than you own)'}.`),
        a === 30 ? t(`Tài sản ròng trung vị của người trưởng thành ở ${c.name.vi}: ${formatMoney(c, wealthAt(c, 0.5), 'vi')} (World Inequality Database).`,
          `Median net worth of adults in ${c.name.en}: ${formatMoney(c, wealthAt(c, 0.5), 'en')} (World Inequality Database).`) : undefined);
    }
    const usd = nw * usdPerPpp(c);
    if (!p.money.millionaire && usd >= 1e6) {
      p.money.millionaire = a;
      log(p, 'work', t(`Bạn thành triệu phú (tính bằng đô la Mỹ)${p.money.owner ? '; phần lớn tài sản nằm ở doanh nghiệp bạn làm chủ' : ''}.`, `You become a millionaire (in US dollars)${p.money.owner ? '; most of your wealth is in the business you own' : ''}.`),
        t(`Chỉ ${num(100 * (1 - wealthRank(c, 1e6 / usdPerPpp(c))), 'vi', 1)}% người trưởng thành ở ${c.name.vi} có tài sản trên 1 triệu USD (WID).`,
          `Only ${num(100 * (1 - wealthRank(c, 1e6 / usdPerPpp(c))), 'en', 1)}% of adults in ${c.name.en} are worth over $1 million (WID).`));
    }
    if (!p.money.billionaire && usd >= 1e9) {
      p.money.billionaire = a;
      log(p, 'work', t('Bạn có tên trong danh sách tỷ phú thế giới.', 'You are on the world billionaires list.'),
        t(`Chỉ khoảng 1 trên ${num(1 / Math.max(1e-12, billionaireShare(c)), 'vi')} người trưởng thành ở ${c.name.vi} là tỷ phú (Forbes 2026).`,
          `Only about 1 in ${num(1 / Math.max(1e-12, billionaireShare(c)), 'en')} adults in ${c.name.en} is a billionaire (Forbes 2026).`));
    }
  }

  // ------------------------------------------------ family members age and may die
  ageKin(world, p, rng);

  // ------------------------------------------------ own survival
  const home = p.residence ?? p.b.country;
  const sk = smokingK(p.b.country)[p.b.sex];
  const si = Math.min(a, sk.non.length - 1);
  // Former smokers: the extra risk fades after quitting (see decisions.ts).
  const smokeK = p.plan.quitAge !== undefined ? sk.non[si] + (sk.smoker[si] - sk.non[si]) * Math.exp(-(a - p.plan.quitAge) / QUIT_TAU)
    : (p.plan.smokeStartAge !== undefined ? sk.smoker : sk.non)[si];
  // The life table's last age always ends life, whatever the multipliers.
  const q0 = deathProb(home.mort[p.b.sex], a, mortalityZ(p));
  const q = q0 >= 1 ? 1 : Math.min(1, q0 * smokeK * healthChoiceK(world, p, home, a));
  // Causes only some people can die of (see causes.ts): childbirth this year, and HIV from age 20
  // (HIV deaths before 20 are mostly from infection at birth and stay in the general mix).
  const cm = home, sx = p.b.sex;
  const ms = sx === 'F' ? causeShare(world.causes, cm, sx, a, isMaternal) : 0;
  const birthRate = asfrAt(home.c, a);
  const qMat = gaveBirth && birthRate > 0 ? q * ms / birthRate : 0;
  const hs = a >= HIV_FROM ? causeShare(world.causes, p.b.country, sx, a, isHiv) : 0;
  const prev = a >= HIV_FROM ? hivModel(p.b.country, world.causes)[sx].alive[a] : 0;
  // Diabetes and hypertensive heart disease: carried by people with the condition (same split as HIV).
  // From the age a condition applies, its cause can only be given to people who have it; if the data
  // leave (almost) nobody with it alive, those deaths go to other causes (total mortality unchanged).
  const chronic = (kind: Chronic, test: typeof isDiabetes, has: boolean) => {
    if (a < chronicFrom(kind)) return { test, extra: 0, hsEff: 0, active: false };
    const sp = hivSplit(q, causeShare(world.causes, cm, sx, a, test), chronicModel(cm, world.causes, kind)[sx].alive[a]);
    return { test, extra: has ? sp.qInf - sp.qUn : 0, hsEff: sp.hsEff, active: true };
  };
  const conds = [
    (() => { const sp = hivSplit(q, hs, prev); return { test: isHiv, extra: p.hiv ? sp.qInf - sp.qUn : 0, hsEff: sp.hsEff, active: a >= HIV_FROM }; })(),
    chronic('dm', isDiabetes, p.diabetes),
    chronic('ht', isHypertension, p.hypertension),
    chronic('aud', isAlcohol, p.alcohol),
  ];
  const qAll = Math.min(1, q * (1 - ms - conds.reduce((s, x) => s + x.hsEff, 0)) + qMat + conds.reduce((s, x) => s + x.extra, 0));
  // In a dynasty the child was alive when the played parent died (that life said so): keep it consistent.
  if (rng() < qAll && !(p.takeover !== undefined && a <= p.takeover)) {
    p.alive = false;
    p.ageAtDeath = a >= 100 ? 102.5 : a + (a === 0 ? 0.15 : 0.5);
    const special = [{ test: isMaternal, p: qMat / qAll }, ...conds.filter(x => x.active).map(x => ({ test: x.test, p: x.extra / qAll }))];
    const cause = causeOfDeath(world.causes, home, p.b.sex, a, special, rng);
    p.cause = cause.text;
    p.causeKind = cause.kind;
    p.causeKey = cause.key;
    if (cause.key === 'dementia' && a >= 60) {
      // ASSUMPTION: 3-7 years from first symptoms to death (median survival after diagnosis ~4-5 years,
      // Brodaty et al. 2012). Inserted into the life story at that earlier age.
      const onset = Math.max(60, a - (3 + Math.floor(rng() * 5)));
      const i = p.log.findIndex(e => e.age > onset);
      p.log.splice(i < 0 ? p.log.length : i, 0, { age: onset, kind: 'health',
        text: t('Bạn bắt đầu hay quên; dần dần bạn không còn nhận ra người thân.', 'You start forgetting things; slowly you stop recognising the people you love.') });
    }
    const hc = home.c, e0 = female ? hc.le_f : hc.le_m;
    const g = world.causes.ages[ageGroup(world.causes, a)], g1 = world.causes.ages[ageGroup(world.causes, a) + 1];
    const band = g1 === undefined ? t(`từ ${g} tuổi trở lên`, `aged ${g}+`) : g === 0 ? t('dưới 1 tuổi', 'under 1') : t(`${g}–${g1 - 1} tuổi`, `aged ${g}–${g1 - 1}`);
    const who = female ? t('phụ nữ', 'women') : t('đàn ông', 'men');
    const share = Math.max(1, Math.round(100 * cause.share));
    log(p, 'death', a === 0
      ? t(`Bạn mất khi chưa tròn một tuổi, vì ${cause.text.vi}.`, `You die before your first birthday, of ${cause.text.en}.`)
      : t(`Bạn qua đời năm ${a} tuổi, vì ${cause.text.vi}.`, `You die at ${a}, of ${cause.text.en}.`),
      a < 5
        ? t(`Ở ${hc.name.vi}, ${oneIn(hc.u5mr / 1000, 'vi')} trẻ em không sống qua 5 tuổi (UN WPP 2024); ${share}% ca tử vong ${band.vi} là do ${cause.text.vi} (WHO).`,
          `In ${hc.name.en}, ${oneIn(hc.u5mr / 1000, 'en')} children die before age 5 (UN WPP 2024); ${share}% of deaths ${band.en} are from ${cause.text.en} (WHO).`)
        : t(`Tuổi thọ trung bình của ${who.vi} ở ${hc.name.vi} là ${num(e0, 'vi', 1)} (UN WPP 2024); ${share}% ca tử vong ở ${who.vi} ${band.vi} là do ${cause.text.vi} (WHO).`,
          `Life expectancy for ${who.en} in ${hc.name.en} is ${num(e0, 'en', 1)} (UN WPP 2024); ${share}% of deaths among ${who.en} ${band.en} are from ${cause.text.en} (WHO).`));
    if (a >= 18) log(p, 'death', recap(p));
    return;
  }
  // Children's milestones, and a line for years in which nothing else happened (story only: no random draws).
  for (const m of childMilestones(p)) p.log.push({ age: a, ...m });
  if (!p.log.some(e => e.age === a)) { const q = quietYear(p); if (q) p.log.push({ age: a, ...q }); }
  p.age++;
}

/** ASSUMPTION: an alcohol use disorder doubles the yearly risk of divorce, relative to the average married
 *  person (prevalence from WHO), so national divorce rates stay as calibrated. */
const ALCOHOL_DIVORCE_RR = 2;
function alcoholDivorceK(p: Person, c: Country): number {
  const prev = c.ncd.aud[p.b.sex] ?? c.ncd.aud.T ?? 0;
  return (p.alcohol ? ALCOHOL_DIVORCE_RR : 1) / (1 + (ALCOHOL_DIVORCE_RR - 1) * prev);
}

const listVi = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} và ${xs[xs.length - 1]}`;
const listEn = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** A look back over the life: the people and the big turns (for the end of the story). */
function recap(p: Person): T {
  const vi: string[] = [], en: string[] = [];
  const years = schoolYearsDone(p);
  if (p.plan.university) { vi.push(`học đại học ngành ${FIELDS[p.plan.field ?? 0].vi}`); en.push(`studied ${FIELDS[p.plan.field ?? 0].en} at university`); }
  else if (years > 0) { vi.push(`đi học ${years} năm`); en.push(`had ${years} years of school`); }
  else { vi.push('chưa từng được đến trường'); en.push('never went to school'); }
  if (p.residence) { vi.push(`rời quê sang ${p.residence.c.name.vi} sinh sống`); en.push(`left home for ${p.residence.c.name.en}`); }
  for (const b of p.money.bizHistory) { vi.push(`mở một doanh nghiệp năm ${b.start} tuổi${b.failed ? `, đóng cửa sau ${b.end - b.start} năm` : ''}`); en.push(`started a business at ${b.start}${b.failed ? `, which closed after ${b.end - b.start} years` : ''}`); }
  if (p.money.biz) { vi.push(`vẫn làm chủ doanh nghiệp mở năm ${p.money.biz.start} tuổi`); en.push(`still ran the business you started at ${p.money.biz.start}`); }
  if (p.plan.quitAge !== undefined) { vi.push(`bỏ được thuốc lá năm ${p.plan.quitAge} tuổi`); en.push(`quit smoking at ${p.plan.quitAge}`); }
  const loves = [...p.pastSpouses, ...(p.spouse?.alive && p.spouse.name ? [p.spouse.name] : [])];
  if (loves.length) {
    vi.push(p.spouse?.alive && loves.length === 1 ? `cùng ${p.spouse.name} đi đến cuối đời` : `từng gắn bó với ${listVi(loves)}`);
    en.push(p.spouse?.alive && loves.length === 1 ? `stayed with ${p.spouse.name} to the end` : `shared your life with ${listEn(loves)}`);
  }
  const kids = p.children.map(k => k.name ?? '').filter(Boolean);
  if (kids.length) { vi.push(`nuôi ${kids.length} người con: ${listVi(kids)}`); en.push(`raised ${kids.length === 1 ? 'one child' : `${kids.length} children`}: ${listEn(kids)}`); }
  // One short sentence per point reads better than one long list.
  return t(`Nhìn lại cuộc đời ${p.name}. ${vi.map(x => `Bạn ${x}.`).join(' ')}`, `Looking back on ${p.name}'s life. ${en.map(x => `You ${x}.`).join(' ')}`);
}

/** The first line of a life taken over in a dynasty: who died, and who you are now. */
function takeoverLine(p: Person, parent: Kin, word: T): T {
  const vi: string[] = [], en: string[] = [];
  const school = schoolYearsDone(p);
  if (p.career.job && p.age >= 15) { vi.push(`đang làm ${p.career.job.title.vi}`); en.push(`working as ${p.career.job.title.en}`); }
  else if (p.age >= 6 && p.age - 6 < p.plan.schoolYears) { vi.push(`đang đi học năm thứ ${school}`); en.push(`in your ${school}th year of school`); }
  else if (p.age >= 6) { vi.push(school ? `đã học ${school} năm` : 'chưa từng đi học'); en.push(school ? `with ${school} years of school` : 'who never went to school'); }
  if (p.spouse?.alive && p.spouse.name) { vi.push(`có ${p.spouse.sex === 'M' ? 'chồng' : 'vợ'} là ${p.spouse.name}`); en.push(`married to ${p.spouse.name}`); }
  const kids = p.children.filter(c => c.alive).length;
  if (kids) { vi.push(`${kids} con`); en.push(`${kids} ${kids === 1 ? 'child' : 'children'}`); }
  const where = p.homeProvince ? `${p.homeProvince}, ${(p.residence ?? p.b.country).c.name.vi}` : (p.residence ?? p.b.country).c.name.vi;
  const whereEn = p.homeProvince ? `${p.homeProvince}, ${(p.residence ?? p.b.country).c.name.en}` : (p.residence ?? p.b.country).c.name.en;
  const inh = p.money.estateFromPlayed && p.money.inherited > 0
    ? t(` Bạn được thừa kế khoảng ${formatMoney(p.b.country.c, p.money.inherited, 'vi')}.`, ` You inherit about ${formatMoney(p.b.country.c, p.money.inherited, 'en')}.`) : t('', '');
  return t(`${word.vi} ${parent.name}, cuộc đời bạn vừa sống, qua đời ở tuổi ${parent.age}. Giờ bạn là ${p.name}, ${p.age} tuổi, sống ở ${where}${vi.length ? ', ' + vi.join(', ') : ''}.${inh.vi}`,
    `${word.en} ${parent.name}, the life you just played, dies at ${parent.age}. You are now ${p.name}, ${p.age}, living in ${whereEn}${en.length ? ', ' + en.join(', ') : ''}.${inh.en}`);
}

/** Back to the job held before the business. */
export function endBusiness(p: Person): void {
  if (p.money.bizJob) { p.career.job = p.money.bizJob; p.career.history.push({ age: p.age, job: p.money.bizJob }); }
  p.money.biz = undefined; p.money.bizJob = undefined;
}

function ageKin(world: World, p: Person, rng: Rng): void {
  // Parents and siblings stay in the country of birth; a spouse and children live where the person lives.
  const z = mortalityZ(p);
  // Relatives whose death is already known (a parent from an earlier generation's life) die exactly then.
  const dies = (k: Kin, abroad = false) => {
    if (!k.alive || k.age < 0) return false;
    const d = k.diesAt !== undefined ? p.age >= k.diesAt
      : rng() < deathProb((abroad && p.residence ? p.residence : p.b.country).mort[k.sex], Math.min(100, k.age), z);
    if (d) k.deathAge = k.age;
    return d;
  };

  // Inheritance: when the second parent dies, their net worth (WID, at the parents' wealth rank and the
  // survivor's age; debts are not inherited) is split equally between all their children. The expected
  // amount by this age (same parents' ages and wealth, deaths from the same life tables) grows alongside.
  const m = p.money, bc = p.b.country;
  let qmNow = 0, qfNow = 0;
  const estate = (age: number) => Math.max(0, netWorth(bc, m.parentU, Math.min(100, age))) / m.heirs;
  {
    const [pm, pf] = m.parentsAlive, noneBefore = (1 - pm) * (1 - pf);
    const qm = p.mother.age >= 0 ? deathProb(bc.mort.F, Math.min(100, p.mother.age), z) : 0;
    const qf = p.father.age >= 0 ? deathProb(bc.mort.M, Math.min(100, p.father.age), z) : 0;
    qmNow = qm; qfNow = qf;
    m.parentsAlive = [pm * (1 - qm), pf * (1 - qf)];
    const noneAfter = (1 - m.parentsAlive[0]) * (1 - m.parentsAlive[1]);
    m.expectedInherit += (noneAfter - noneBefore) * estate((p.mother.age + p.father.age) / 2);
  }
  const bothBefore = p.mother.alive || p.father.alive;
  const wasAlive = [p.mother.alive, p.father.alive];
  // Losing a parent as a child: the household is hit (see SHOCK_LOSS), centred on the chance of it.
  if (p.age < 18) p.year.pLoss = (p.mother.alive ? qmNow : 0) + (p.father.alive ? qfNow : 0);
  for (const [k, word] of [[p.mother, t('Mẹ', 'Your mother')], [p.father, t('Bố', 'Your father')]] as const) {
    if (dies(k)) {
      k.alive = false;
      log(p, 'loss', k.played
        ? t(`${word.vi} ${k.name} của bạn (người có cuộc đời bạn đã sống trước đó) qua đời ở tuổi ${k.age}.`, `${word.en} ${k.name} (the life you played before) dies at ${k.age}.`)
        : t(`${word.vi} ${k.name} của bạn qua đời ở tuổi ${k.age}.`, `${word.en} ${k.name} dies at ${k.age}.`),
        p.age < 18 && !(p.mother.alive || p.father.alive)
          ? t('Bạn mồ côi cả cha lẫn mẹ.', 'You have lost both parents.') : undefined);
      if (p.age < 18) {
        p.year.loss++;
        const other = k === p.mother ? p.father : p.mother;
        if (other.alive) log(p, 'family', other === p.mother
          ? t('Từ đó mẹ một mình gánh vác cả nhà; cuộc sống chật vật hơn trước.', 'From then on your mother carries the household alone; life gets harder.')
          : t('Từ đó bố một mình gánh vác cả nhà; cuộc sống chật vật hơn trước.', 'From then on your father carries the household alone; life gets harder.'));
      }
    }
  }
  if (bothBefore && !p.mother.alive && !p.father.alive) {
    // The parent who died last leaves the estate. If that is the life played before (dynasty), the
    // children share exactly what that life ended with; otherwise the survivor's wealth at their age.
    const lastM = wasAlive[0], lastF = wasAlive[1];
    const playedLast = (lastM && p.mother.played) || (lastF && p.father.played);
    const lastAge = lastM && lastF ? (p.mother.age + p.father.age) / 2 : lastM ? p.mother.age : p.father.age;
    const share = playedLast && m.knownEstate !== undefined ? Math.max(0, m.knownEstate) * (m.estateShare ?? 1 / m.heirs) : estate(lastAge);
    m.inherited += share;
    if (playedLast) m.estateFromPlayed = true;
    const n = m.heirs - 1;
    if (share > 0) log(p, 'work', n > 0
      ? t(`Tài sản bố mẹ để lại được chia cho bạn và ${n} anh chị em; phần của bạn khoảng ${formatMoney(bc.c, share, 'vi')}.`,
        `Your parents' estate is split between you and ${n} ${n === 1 ? 'sibling' : 'siblings'}; your share is about ${formatMoney(bc.c, share, 'en')}.`)
      : t(`Bạn là con một nên thừa kế toàn bộ tài sản của bố mẹ: khoảng ${formatMoney(bc.c, share, 'vi')}.`,
        `As an only child you inherit everything your parents had: about ${formatMoney(bc.c, share, 'en')}.`),
      t(`Tài sản bố mẹ tính theo vị trí giàu nghèo của gia đình bạn trong phân phối tài sản ở ${bc.c.name.vi} (World Inequality Database).`,
        `Your parents' wealth follows your family's place in the wealth distribution of ${bc.c.name.en} (World Inequality Database).`));
    else log(p, 'work', t('Bố mẹ không để lại tài sản gì đáng kể.', 'Your parents leave nothing of value.'));
  }
  // Dynasty: the year the played parent dies is where play takes over; sum up the life so far.
  if (p.takeover !== undefined && p.age === p.takeover && !p.takeoverSummary) {
    const k = p.mother.played ? p.mother : p.father;
    if (!k.alive) p.takeoverSummary = takeoverLine(p, k, p.mother.played ? t('Mẹ', 'Your mother') : t('Bố', 'Your father'));
  }
  for (const s of p.siblings) {
    if (s.age === 0 && s.bornAt === p.age) {
      if (!p.mother.alive) { s.alive = false; continue; }
      log(p, 'family', t(`${cap(sibWord(s).vi)} ${s.name} của bạn ra đời.`, `Your ${sibWord(s).en} ${s.name} is born.`));
    }
    if (dies(s)) {
      s.alive = false;
      log(p, 'loss', t(`${cap(sibWord(s).vi)} ${s.name} của bạn ${s.age < 40 ? 'mất khi mới' : 'qua đời ở tuổi'} ${s.age}${s.age < 40 ? ' tuổi' : ''}.`,
        `Your ${sibWord(s).en} ${s.name} dies at ${s.age}.`));
      const left = p.siblings.filter(x => x.alive && x.age >= 0);
      if (p.age >= 40 && p.siblings.filter(x => x.age >= 0).length >= 2) log(p, 'loss', left.length === 0
        ? t('Giờ bạn là người cuối cùng còn lại trong số anh chị em.', 'You are now the last one left of your brothers and sisters.')
        : left.length === 1 ? t(`Giờ trong số anh chị em chỉ còn bạn và ${left[0].name}.`, `Of all your brothers and sisters, only you and ${left[0].name} are left.`) : t('', ''));
    }
  }
  if (p.spouse && dies(p.spouse, true)) {
    p.spouse.alive = false;
    p.marital = 'widowed';
    if (p.spouse.name) p.pastSpouses.push(p.spouse.name);
    log(p, 'loss', t(`${p.spouse.name}, ${spouseWord(p.spouse.sex).vi} bạn, qua đời ở tuổi ${p.spouse.age}.`,
      `Your ${spouseWord(p.spouse.sex).en} ${p.spouse.name} dies at ${p.spouse.age}.`));
  }
  for (const ch of p.children) {
    if (dies(ch, true)) {
      ch.alive = false;
      log(p, 'loss', ch.age === 0
        ? t(`Bé ${ch.name}, ${childWord(ch.sex).vi} bạn, mất khi chưa đầy một tuổi.`, `Your ${childWord(ch.sex).en} ${ch.name} dies as a baby.`)
        : t(`${cap(childWord(ch.sex).vi)} ${ch.name} của bạn mất năm ${ch.age} tuổi.`, `Your ${childWord(ch.sex).en} ${ch.name} dies at ${ch.age}.`));
    }
  }
  // Grandchildren and great-grandchildren: each living child (grandchild) has births at the country's
  // age-specific fertility rate (UN ASFR) for the mother's age; for a son, his wife is younger by the
  // marriage age gap. On average this gives each child the country's TFR. They live where the person lives.
  const home = p.residence ?? p.b.country, hc = home.c, gap = Math.round(marriage(hc).gap);
  const births = (parents: Kin[], into: Kin[]) => {
    for (const k of parents) {
      if (!k.alive) continue;
      const motherAge = k.sex === 'F' ? k.age : k.age - gap;
      if (rng() < asfrAt(hc, motherAge)) into.push({ sex: rng() < home.pMale ? 'M' : 'F', age: 0, alive: true });
    }
  };
  const hadGrand = p.grandchildren.length > 0, hadGreat = p.greatGrandchildren.length > 0;
  births(p.children, p.grandchildren);
  births(p.grandchildren, p.greatGrandchildren);
  if (!hadGrand && p.grandchildren.length) log(p, 'family', t('Đứa cháu đầu tiên của bạn ra đời.', 'Your first grandchild is born.'));
  if (!hadGreat && p.greatGrandchildren.length) log(p, 'family', t('Bạn có chắt đầu tiên.', 'Your first great-grandchild is born.'));
  for (const k of [...p.grandchildren, ...p.greatGrandchildren]) {
    if (k.alive && rng() < deathProb(home.mort[k.sex], Math.min(100, k.age), z)) k.alive = false;
  }
  for (const k of [p.mother, p.father, ...p.siblings, ...p.children, ...p.grandchildren, ...p.greatGrandchildren, ...(p.spouse ? [p.spouse] : [])]) if (k.alive) k.age++;
}

function logBirth(p: Person, worldBirths: number): void {
  const { c, b } = p;
  const q = Math.min(4, Math.floor(b.wealthPct * 5));
  const place = p.urban ? t('thành thị', 'a city or town') : t('nông thôn', 'the countryside');
  const older = p.siblings.filter(s => s.age > 0).length;
  const perDay = b.familyIncome / 365;
  const lacks: T[] = [];
  if (!p.electricity) lacks.push(t('điện', 'electricity'));
  if (!p.water) lacks.push(t('nước sạch', 'clean water'));
  if (!p.sanitation) lacks.push(t('nhà vệ sinh', 'a toilet'));
  // Parents' schooling, read off the country's schooling levels at the parents' education score.
  const f = schoolFit(c);
  let py = 0;
  while (py < 12 && p.lat.parentEduZ > f.cut[py + 1]) py++;
  const pUni = py === 12 && p.lat.parentEduZ > invNorm(1 - f.pAtLeast[12] * f.uniGivenFinish);
  const known = p.playedParentSchool, who = p.mother.played ? t('Mẹ', 'Your mother') : t('Bố', 'Your father');
  const parentsVi = known ? (known.years === 0 ? ` ${who.vi} bạn chưa từng đi học.` : known.uni ? ` ${who.vi} bạn có bằng đại học.` : ` ${who.vi} bạn học hết lớp ${known.years}.`)
    : py === 0 ? ' Bố mẹ bạn chưa từng đi học.' : pUni ? ' Bố mẹ bạn có bằng đại học.' : ` Bố mẹ bạn học hết lớp ${py}.`;
  const parentsEn = known ? (known.years === 0 ? ` ${who.en} never went to school.` : known.uni ? ` ${who.en} has a university degree.` : ` ${who.en} had ${known.years} years of school.`)
    : py === 0 ? ' Your parents never went to school.' : pUni ? ' Your parents have university degrees.' : ` Your parents had ${py} years of school.`;
  const played = p.mother.played ? t('Mẹ bạn chính là người có cuộc đời bạn vừa sống. ', 'Your mother is the life you just played. ')
    : p.father.played ? t('Bố bạn chính là người có cuộc đời bạn vừa sống. ', 'Your father is the life you just played. ') : t('', '');
  log(p, 'birth', t(played.vi +
    `Bạn sinh ra là một bé ${b.sex === 'M' ? 'trai' : 'gái'} tên ${p.name} ở ${place.vi} ${p.province ? `${p.province}, ` : ''}${c.name.vi}, trong một gia đình ${QUINTILE[q].vi}. ` +
    `Mẹ bạn là ${p.mother.name}, ${p.mother.age} tuổi; bố là ${p.father.name}, ${p.father.age} tuổi.` + parentsVi +
    (older ? ` Bạn có ${older} anh chị.` : ' Bạn là con đầu lòng.') +
    ` Mỗi người trong nhà sống bằng khoảng ${num(perDay, 'vi', perDay < 10 ? 1 : 0)} USD/ngày (tính theo sức mua tương đương).` +
    (p.slum ? ' Gia đình bạn sống trong một khu ổ chuột.' : '') +
    (lacks.length ? ` Nhà không có ${lacks.map(x => x.vi).join(', ')}.` : '') +
    (!p.cleanFuel ? ' Cả nhà nấu ăn bằng củi, than hoặc rơm.' : '') +
    (!p.registered ? ' Bạn không được làm giấy khai sinh.' : ''),
    played.en + `You are born a ${b.sex === 'M' ? 'boy' : 'girl'} named ${p.name} in ${place.en} in ${p.province ? `${p.province}, ` : ''}${c.name.en}, into a family ${QUINTILE[q].en}. ` +
    `Your mother ${p.mother.name} is ${p.mother.age}, your father ${p.father.name} ${p.father.age}.` + parentsEn +
    (older ? ` You have ${older} older sibling${older > 1 ? 's' : ''}.` : ' You are the firstborn.') +
    ` Each person in the household lives on about $${num(perDay, 'en', perDay < 10 ? 1 : 0)} a day (purchasing power).` +
    (p.slum ? ' Your family lives in a slum.' : '') +
    (lacks.length ? ` Your home has no ${lacks.map(x => x.en).join(', ')}.` : '') +
    (!p.cleanFuel ? ' The family cooks over wood, charcoal or straw.' : '') +
    (!p.registered ? ' Your birth is never registered.' : '')),
    t(`${num(100 * c.births / worldBirths, 'vi', 1)}% trẻ sơ sinh trên thế giới chào đời ở ${c.name.vi} (UN WPP 2024).`,
      `${num(100 * c.births / worldBirths, 'en', 1)}% of the world's babies are born in ${c.name.en} (UN WPP 2024).`));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ordinal = (n: number) => n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`;
const an = (w: string) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
