// Player choices. A decision comes up where the model's plan for the person is about to act (leave
// school, go to university or not, marry, start smoking, emigrate...). The default option is what the
// plan already says, so lives that nobody plays (validation) are unchanged. Other options succeed with
// the chances real people in the same country have; their consequences run through the same model as
// everything else (education -> adult standing -> work, income, wealth, health).
//
// ASSUMPTION: the association between education and adult standing in the model is treated as causal
// when a player changes their schooling (IV studies of returns to schooling find effects close to the
// simple association, Card 1999).

import type { Rng } from '../model/rng.ts';
import type { World } from '../model/world.ts';
import { invNorm } from '../model/stats.ts';
import { raisedIn, restand, type Person } from './person.ts';
import { schoolFit, uniTarget, marriage } from './calibrate.ts';
import { FIELDS } from './work.ts';
import { num, t, type T } from './i18n.ts';
import { LOTTERY_PAYOUT, returnStats, type Portfolio } from './finance.ts';
import { openBusiness, SALE_SHARE, survivalTo, PAY_MEDIAN } from './business.ts';
import { monthlyEarnings, formatMoney } from './money.ts';
import { OWNER } from './work.ts';
import { endBusiness } from './simulate.ts';
import { causeShare } from './causes.ts';
import type { CountryModel } from '../model/world.ts';

export interface Option { key: string; text: T }
export interface Decision { id: string; title: T; context: T; options: Option[]; dflt: string }

/** ASSUMPTION: chance that one serious attempt to quit smoking lasts (12-month abstinence is about
 *  15-30% with support, West et al. 2015). */
export const QUIT_SUCCESS = 0.25;
/** ASSUMPTION: after quitting, a smoker's excess risk of dying falls with this time constant (years):
 *  quitting at 35-44 avoids about 90% of the excess, at 45-54 about two thirds (Jha et al. 2013). */
export const QUIT_TAU = 10;
const QUIT_AGES = [25, 30, 35, 40, 45, 50, 55, 60];
/** ASSUMPTIONS for spending on the children's schooling: each year a child aged 6-17 costs 15% of one
 *  person's yearly income in the household; twelve such years raise the child's education score by
 *  0.25 standard deviations (meta-analyses of tutoring and school quality find learning gains of
 *  0.2-0.4 SD, e.g. Nickow, Oreopoulos & Quan 2020; attainment gains are taken to be smaller). */
export const EDU_COST = 0.15;

// Health choices. ASSUMPTIONS:
/** All-cause mortality of adults who meet activity guidelines relative to inactive ones (meta-analyses
 *  find 20-30% lower, e.g. Ekelund et al. 2019, BMJ). Relative to the country's average adult, using the
 *  WHO share of adults who are insufficiently active. */
export const ACTIVE_RR = 0.75;
/** Screening from 50: colorectal cancer deaths about 25% lower (screening trials), breast cancer
 *  deaths about 20% lower with mammography (UK Independent Panel 2012). */
export const SCREEN_RR = { colon: 0.75, breast: 0.8 };
/** Private health insurance: pays 70% of each bill; the premium is the expected covered cost plus 20%. */
export const INS_COVER = 0.7, INS_LOAD = 1.2;
/** Chance per school year that a school team wins its championship (for the story only). */
export const TEAM_WIN = 0.08;

const isColon = (c: { key: string }) => c.key === 'c_colon';
const isBreast = (c: { key: string }) => c.key === 'c_breast';

/** Mortality multiplier from the player's health choices (1 for anyone who chose as most people do). */
export function healthChoiceK(world: World, p: Person, home: CountryModel, a: number): number {
  let k = 1;
  if (p.plan.active && a >= 18) {
    const inactive = home.c.ncd.inactive[p.b.sex] ?? home.c.ncd.inactive.T;
    k *= ACTIVE_RR / ((1 - inactive) * ACTIVE_RR + inactive);
  }
  if (p.plan.screened && a >= 50) {
    k *= 1 - causeShare(world.causes, home, p.b.sex, a, isColon) * (1 - SCREEN_RR.colon)
      - (p.b.sex === 'F' ? causeShare(world.causes, home, p.b.sex, a, isBreast) * (1 - SCREEN_RR.breast) : 0);
  }
  return k;
}
export const EDU_BOOST = 0.25;

const pct = (x: number, lang: 'vi' | 'en') => num(100 * x, lang);
const LEVEL: Record<number, T> = { 1: t('đi học', 'go to school'), 6: t('hết tiểu học', 'primary school'), 9: t('hết THCS', 'lower secondary school'), 12: t('hết THPT', 'upper secondary school') };
const nextLevel = (k: number) => (k < 1 ? 1 : k < 6 ? 6 : k < 9 ? 9 : 12);

/** The decision due before this year's events, if any. Does not draw random numbers. */
export function decisionAt(world: World, p: Person): Decision | undefined {
  if (!p.alive) return undefined;
  const a = p.age, plan = p.plan, rc = raisedIn(p).c;
  const open = (id: string) => !(id in p.decided);

  // Leaving school early (forced child marriages are not a choice).
  if (plan.schoolYears < 12 && a === 6 + plan.schoolYears && !(plan.childMarriageAge !== undefined && plan.childMarriageAge <= a + 1)) {
    const id = `school-${plan.schoolYears}`;
    if (open(id)) {
      const f = schoolFit(rc), k = plan.schoolYears, nx = nextLevel(k);
      const go = f.pAtLeast[nx] / f.pAtLeast[k];
      return {
        id, dflt: 'leave',
        title: k === 0 ? t('Đi học hay ở nhà?', 'School or not?') : t(`Bạn đã học ${k} năm. Nghỉ học hay cố học tiếp?`, `You have had ${k} years of school. Leave or keep going?`),
        context: t(`Ở ${rc.name.vi}, ${pct(f.pAtLeast[nx], 'vi')}% trẻ em học ${LEVEL[nx].vi}. Trong số những em đã học được ${k} năm như bạn, ${pct(go, 'vi')}% học tiếp được (UNESCO).${p.b.wealthPct < 0.4 ? ' Nhà nghèo thì càng khó học tiếp.' : ''}`,
          `In ${rc.name.en}, ${pct(f.pAtLeast[nx], 'en')}% of children ${nx === 1 ? 'go to school' : `finish ${LEVEL[nx].en}`}. Of those who got as far as you (${k} years), ${pct(go, 'en')}% carry on (UNESCO).${p.b.wealthPct < 0.4 ? ' Being poor makes it harder.' : ''}`),
        options: [{ key: 'leave', text: k === 0 ? t('Ở nhà', 'Stay home') : t('Nghỉ học', 'Leave school') },
          { key: 'stay', text: k === 0 ? t('Xin cho đi học', 'Ask to go to school') : t('Cố học tiếp', 'Try to keep studying') }],
      };
    }
  }

  // University (after finishing upper secondary).
  if (plan.schoolYears === 12 && a === 18 && open('uni')) {
    const f = schoolFit(rc);
    return {
      id: 'uni', dflt: plan.university ? 'uni' : 'work',
      title: t('Học đại học hay đi làm?', 'University or work?'),
      context: f.uniGivenFinish >= 0.95
        ? t(`Ở ${rc.name.vi}, khoảng ${pct(uniTarget(rc), 'vi')}% người trẻ vào đại học; gần như ai học hết THPT cũng có chỗ học (UNESCO).`,
          `In ${rc.name.en}, about ${pct(uniTarget(rc), 'en')}% of young people go to university; nearly everyone who finishes secondary school can get a place (UNESCO).`)
        : t(`Ở ${rc.name.vi}, khoảng ${pct(uniTarget(rc), 'vi')}% người trẻ vào đại học; tính riêng những người học hết THPT thì tỷ lệ này là ${pct(f.uniGivenFinish, 'vi')}% (UNESCO).${plan.university ? ' Bạn đã đỗ.' : ' Bạn chưa chắc đỗ.'}`,
          `In ${rc.name.en}, about ${pct(uniTarget(rc), 'en')}% of young people go to university, ${pct(f.uniGivenFinish, 'en')}% of those who finish secondary school (UNESCO).${plan.university ? ' You have a place.' : ' A place is not guaranteed.'}`),
      options: [{ key: 'uni', text: plan.university ? t('Vào đại học', 'Go to university') : t('Thi vào đại học', 'Apply to university') }, { key: 'work', text: t('Đi làm luôn', 'Start working') }],
    };
  }
  if (plan.university && a === 18 && !open('uni') && open('field')) {
    const shares = rc.fields, total = shares.reduce((s, x) => s + x, 0) || 1;
    return {
      id: 'field', dflt: String(plan.field ?? 0),
      title: t('Bạn học ngành gì?', 'What do you study?'),
      context: t(`Số trong ngoặc là tỷ lệ sinh viên tốt nghiệp từng ngành ở ${rc.name.vi} (UNESCO). Ngành bạn học ảnh hưởng đến những nghề bạn có thể làm.`,
        `Share of graduates by field in ${rc.name.en} (UNESCO) in brackets. Your field shapes the jobs open to you.`),
      options: FIELDS.map((f, i) => ({ key: String(i), text: t(`${f.vi} (${pct(shares[i] / total, 'vi')}%)`, `${f.en} (${pct(shares[i] / total, 'en')}%)`) })),
    };
  }

  // Smoking: starting, and later attempts to quit.
  if (a === plan.smokeStartAge && open('smoke')) {
    const female = p.b.sex === 'F', share = (female ? rc.smoke_f : rc.smoke_m) / 100;
    return {
      id: 'smoke', dflt: 'start',
      title: t('Bạn bè rủ bạn hút thuốc.', 'Your friends offer you a cigarette.'),
      context: t(`${pct(share, 'vi')}% ${female ? 'phụ nữ' : 'đàn ông'} ở ${rc.name.vi} hút thuốc (WHO). Người hút thuốc lâu năm có nguy cơ tử vong ở tuổi trung niên cao gấp khoảng 2 lần.`,
        `${pct(share, 'en')}% of ${female ? 'women' : 'men'} in ${rc.name.en} use tobacco (WHO). Long-term smokers are about twice as likely to die in middle age.`),
      options: [{ key: 'start', text: t('Hút thử', 'Take it') }, { key: 'refuse', text: t('Từ chối', 'Say no') }],
    };
  }
  if (p.smoker && plan.quitAge === undefined && QUIT_AGES.includes(a) && open(`quit-${a}`)) {
    return {
      id: `quit-${a}`, dflt: 'keep',
      title: t('Bỏ thuốc lá?', 'Quit smoking?'),
      context: t(`Mỗi lần quyết tâm bỏ, khoảng ${pct(QUIT_SUCCESS, 'vi')}% người bỏ được hẳn. Bỏ trước 40 tuổi tránh được gần hết nguy cơ tử vong do thuốc lá (Jha và cộng sự 2013).`,
        `About ${pct(QUIT_SUCCESS, 'en')}% of serious attempts to quit last. Quitting before 40 avoids nearly all of the extra risk of dying (Jha et al. 2013).`),
      options: [{ key: 'keep', text: t('Vẫn hút', 'Keep smoking') }, { key: 'quit', text: t('Cố bỏ thuốc', 'Try to quit') }],
    };
  }

  // Emigration (refugees and children have no choice).
  if (a === plan.emigrateAge && a >= 18 && !plan.refugee && plan.destination && world.byId[plan.destination] && open('emigrate')) {
    const dest = world.byId[plan.destination].c, home = p.b.country.c;
    return {
      id: 'emigrate', dflt: 'go',
      title: t(`Bạn có cơ hội sang ${dest.name.vi} sống và làm việc.`, `You have a chance to move to ${dest.name.en}.`),
      context: t(`${num(100 * home.mig!.abroad[p.b.sex], 'vi', 1)}% người sinh ra ở ${home.name.vi} đang sống ở nước ngoài (UN DESA). Thu nhập trung bình mỗi người ở ${dest.name.vi} gấp khoảng ${num(dest.gdp_ppp / home.gdp_ppp, 'vi', 1)} lần ở ${home.name.vi} (World Bank).`,
        `${num(100 * home.mig!.abroad[p.b.sex], 'en', 1)}% of people born in ${home.name.en} live abroad (UN DESA). Average income per person in ${dest.name.en} is about ${num(dest.gdp_ppp / home.gdp_ppp, 'en', 1)} times that of ${home.name.en} (World Bank).`),
      options: [{ key: 'go', text: t('Ra đi', 'Go') }, { key: 'stay', text: t('Ở lại', 'Stay') }],
    };
  }

  // Savings: where to put them, at 25 and every ten years (the default keeps the current choice).
  if ([25, 35, 45, 55, 65].includes(a) && open(`invest-${a}`)) {
    const st = returnStats(), pc = (x: number, l: 'vi' | 'en') => num(100 * x, l, 1);
    return {
      id: `invest-${a}`, dflt: p.money.portfolio,
      title: t('Bạn để tiền tiết kiệm ở đâu?', 'Where do you keep your savings?'),
      context: t(`Lãi thực trung bình mỗi năm từ 1950 ở 16 nước giàu (Jordà-Schularick-Taylor): cổ phiếu ${pc(st.equity.mean, 'vi')}% nhưng có năm mất ${pc(-st.equity.worst, 'vi')}%; nhà đất ${pc(st.housing.mean, 'vi')}%, năm tệ nhất mất ${pc(-st.housing.worst, 'vi')}%; gửi ngân hàng ${pc(st.bills.mean, 'vi')}%. Phần lớn gia đình để tiền chủ yếu vào nhà, một phần gửi ngân hàng, ít cổ phiếu.`,
        `Average real return a year since 1950 in 16 rich countries (Jordà-Schularick-Taylor): shares ${pc(st.equity.mean, 'en')}% but losing up to ${pc(-st.equity.worst, 'en')}% in a year; property ${pc(st.housing.mean, 'en')}%, losing up to ${pc(-st.housing.worst, 'en')}% in its worst year; bank deposits ${pc(st.bills.mean, 'en')}%. Most families hold mainly their home, some deposits and few shares.`),
      options: [{ key: 'usual', text: t('Như phần lớn mọi người', 'Like most people') }, { key: 'bank', text: t('Gửi ngân hàng', 'Bank deposits') },
        { key: 'stocks', text: t('Mua cổ phiếu', 'Shares') }, { key: 'housing', text: t('Mua nhà đất', 'Property') }],
    };
  }
  // Business: a chance to start one at 28, 38 and 48 while working; a review every five years.
  const workStart = Math.max(15, plan.university ? 22 : 6 + plan.schoolYears);
  const working = plan.worksOutside && a >= workStart && a < plan.exitAge;
  const job = p.career.job;
  if ([28, 38, 48].includes(a) && working && job && (job.status === 'emp' || job.status === 'own') && !p.money.biz && open(`biz-${a}`)) {
    const home = (p.residence ?? p.b.country).c, wb = (home as { src?: Record<string, string> }).src?.biz_density === 'WB';
    const failedBefore = p.money.bizHistory.findLast(b => b.failed);
    return {
      id: `biz-${a}`, dflt: 'no',
      title: t('Mở doanh nghiệp riêng?', 'Start your own business?'),
      context: t(`${failedBefore ? `Lần trước, doanh nghiệp của bạn đóng cửa sau ${failedBefore.end - failedBefore.start} năm. ` : ''}${wb ? `Mỗi năm ở ${home.name.vi} có khoảng ${num(home.biz_density, 'vi', 1)} doanh nghiệp mới đăng ký trên 1.000 người tuổi lao động (World Bank). ` : ''}Ở Mỹ, ${pct(survivalTo(5), 'vi')}% doanh nghiệp mới còn hoạt động sau 5 năm, ${pct(survivalTo(10), 'vi')}% sau 10 năm (BLS). Phần lớn chủ doanh nghiệp nhỏ kiếm ít hơn đi làm thuê, một số ít kiếm nhiều hơn hẳn (Hamilton 2000). Bạn phải bỏ vào khoảng một năm lương.`,
        `${failedBefore ? `Last time, your business closed after ${failedBefore.end - failedBefore.start} years. ` : ''}${wb ? `${home.name.en} registers about ${num(home.biz_density, 'en', 1)} new businesses a year per 1,000 people of working age (World Bank). ` : ''}In the US ${pct(survivalTo(5), 'en')}% of new businesses are still open after 5 years and ${pct(survivalTo(10), 'en')}% after 10 (BLS). Most small-business owners earn less than in a job; a few earn far more (Hamilton 2000). You put in about a year's pay.`),
      options: [{ key: 'no', text: t('Tiếp tục đi làm', 'Keep your job') }, { key: 'yes', text: t('Mở doanh nghiệp', 'Start a business') }],
    };
  }
  if (p.money.biz && working && a > p.money.biz.start && (a - p.money.biz.start) % 5 === 0 && open(`bizrev-${a}`)) {
    const biz = p.money.biz, c = (p.residence ?? p.b.country).c;
    return {
      id: `bizrev-${a}`, dflt: 'keep',
      title: t(`Doanh nghiệp của bạn đã ${a - biz.start} năm tuổi. Tính sao đây?`, `Your business is ${a - biz.start} years old. What next?`),
      context: t(`Ước tính doanh nghiệp đáng giá khoảng ${formatMoney(c, biz.value, 'vi')}; bạn đã bỏ vào ${formatMoney(c, biz.capital * (1 + biz.expanded), 'vi')}. Mở rộng là bỏ thêm khoảng một năm lương.`,
        `The business is worth about ${formatMoney(c, biz.value, 'en')}; you have put in ${formatMoney(c, biz.capital * (1 + biz.expanded), 'en')}. Expanding means putting in about another year's pay.`),
      options: [{ key: 'keep', text: t('Giữ nguyên', 'Keep it as it is') }, { key: 'expand', text: t('Mở rộng', 'Expand') }, { key: 'sell', text: t('Bán đi, quay lại đi làm thuê', 'Sell it and go back to a job') }],
    };
  }

  // The children's schooling (when the first child turns 6) and a gift to the children at 60.
  const firstKid = p.children.find(k => k.alive);
  if (firstKid && firstKid.age === 6 && open('kidsedu')) {
    return {
      id: 'kidsedu', dflt: 'usual',
      title: t('Đầu tư cho con đi học thế nào?', 'How much do you put into your children’s schooling?'),
      context: t(`Cho con học thêm hoặc vào trường tốt hơn tốn khoảng ${pct(EDU_COST, 'vi')}% thu nhập một người trong nhà mỗi năm cho mỗi con đang đi học. Các nghiên cứu về học kèm cho thấy kết quả học tập tăng rõ (Nickow và cộng sự 2020). Nếu sau này bạn sống tiếp đời của con, con sẽ học tốt hơn.`,
        `Extra tutoring or a better school costs about ${pct(EDU_COST, 'en')}% of one person's income a year for each child in school. Studies of tutoring find clear learning gains (Nickow et al. 2020). If you later live a child's life, that child will do better at school.`),
      options: [{ key: 'usual', text: t('Như các nhà khác', 'Like other families') }, { key: 'invest', text: t('Đầu tư thêm cho con học', 'Pay for extra schooling') }],
    };
  }
  if (a === 60 && p.children.some(k => k.alive && k.age >= 18) && (p.money.lastNW ?? 0) > 0 && open('gift')) {
    const c = (p.residence ?? p.b.country).c, nw = p.money.lastNW ?? 0;
    return {
      id: 'gift', dflt: '0',
      title: t('Cho các con một phần tài sản ngay bây giờ?', 'Give your children part of your wealth now?'),
      context: t(`Tài sản ròng của bạn khoảng ${formatMoney(c, nw, 'vi')}. Phần cho đi chia đều cho các con còn sống; phần còn lại các con thừa kế khi bạn mất.`,
        `Your net worth is about ${formatMoney(c, nw, 'en')}. A gift is shared equally between your living children; they inherit the rest when you die.`),
      options: [{ key: '0', text: t('Giữ lại', 'Keep it') }, { key: '0.1', text: t('Cho 10%', 'Give 10%') }, { key: '0.3', text: t('Cho 30%', 'Give 30%') }],
    };
  }

  // Health: a school team at 12, exercise at 25 and 45, insurance at 25, cancer screening at 50.
  if (a === 12 && plan.schoolYears > 6 && open('team')) {
    return {
      id: 'team', dflt: 'no',
      title: t('Trường bạn tuyển người vào đội thể thao.', 'Your school is picking players for its sports team.'),
      context: t('Tập luyện chiếm nhiều giờ sau giờ học, nhưng vui và có bạn bè.', 'Training takes many hours after school, but it is fun and you make friends.'),
      options: [{ key: 'no', text: t('Không tham gia', 'Stay out') }, { key: 'yes', text: t('Xin vào đội', 'Try out for the team') }],
    };
  }
  if ((a === 25 || a === 45) && open(`exercise-${a}`)) {
    const c = rc, inactive = c.ncd.inactive[p.b.sex] ?? c.ncd.inactive.T;
    return {
      id: `exercise-${a}`, dflt: plan.active ? 'active' : 'usual',
      title: t('Bạn có tập thể dục đều đặn không?', 'Do you exercise regularly?'),
      context: t(`Ở ${c.name.vi}, ${pct(inactive, 'vi')}% ${p.b.sex === 'F' ? 'phụ nữ' : 'đàn ông'} trưởng thành vận động không đủ mức WHO khuyến nghị. Người vận động đủ có nguy cơ tử vong thấp hơn khoảng 25% so với người ít vận động (Ekelund và cộng sự 2019).`,
        `In ${c.name.en}, ${pct(inactive, 'en')}% of adult ${p.b.sex === 'F' ? 'women' : 'men'} get less exercise than WHO recommends. People who get enough have about a 25% lower risk of dying than inactive people (Ekelund et al. 2019).`),
      options: [{ key: 'usual', text: t('Như phần lớn mọi người', 'Like most people') }, { key: 'active', text: t('Tập đều đặn', 'Exercise regularly') }],
    };
  }
  if (a === 25 && open('insure')) {
    const c = (p.residence ?? p.b.country).c;
    return {
      id: 'insure', dflt: 'no',
      title: t('Mua bảo hiểm y tế tư nhân?', 'Buy private health insurance?'),
      context: t(`Mỗi năm ${num(c.oop_imp, 'vi')}% dân số ${c.name.vi} tốn tiền chữa bệnh đến mức rơi vào nghèo (WHO/World Bank). Bảo hiểm trả 70% mỗi hóa đơn; bạn đóng phí đều đặn kể cả năm không ốm, tổng phí cao hơn khoản được trả trung bình khoảng 20%.`,
        `Each year ${num(c.oop_imp, 'en')}% of people in ${c.name.en} are pushed into poverty by health costs (WHO/World Bank). Insurance pays 70% of each bill; you pay a premium every year, even when healthy, about 20% more than it pays out on average.`),
      options: [{ key: 'no', text: t('Không mua', 'No') }, { key: 'yes', text: t('Mua bảo hiểm', 'Buy insurance') }],
    };
  }
  if (a === 50 && open('screen')) {
    return {
      id: 'screen', dflt: 'no',
      title: t('Đi tầm soát ung thư định kỳ?', 'Go for regular cancer screening?'),
      context: t(`Tầm soát ung thư đại trực tràng giảm khoảng 25% số ca tử vong do bệnh này${p.b.sex === 'F' ? '; chụp nhũ ảnh giảm khoảng 20% số ca tử vong do ung thư vú (UK Independent Panel 2012)' : ''}.`,
        `Colorectal screening cuts deaths from that cancer by about 25%${p.b.sex === 'F' ? '; mammography cuts breast cancer deaths by about 20% (UK Independent Panel 2012)' : ''}.`),
      options: [{ key: 'no', text: t('Không đi', 'No') }, { key: 'yes', text: t('Đi tầm soát', 'Get screened') }],
    };
  }

  // A will (at 65, with two or more grown children) and when to stop working (at 55).
  const grown = p.children.map((k, i) => ({ k, i })).filter(({ k }) => k.alive && k.age >= 18);
  if (a === 65 && grown.length >= 2 && open('will')) {
    return {
      id: 'will', dflt: 'equal',
      title: t('Bạn viết di chúc thế nào?', 'How do you write your will?'),
      context: t('Mặc định tài sản chia đều cho các con. Bạn có thể để lại tất cả cho một người con; nếu sau này bạn sống tiếp đời người con đó, họ sẽ nhận toàn bộ. Nhiều nước giới hạn quyền này bằng luật thừa kế bắt buộc; game chưa tính đến.',
        'By default your wealth is shared equally between your children. You can leave everything to one child; if you later live that child’s life, they inherit it all. Many countries limit this through forced-heirship rules; the game does not model them.'),
      options: [{ key: 'equal', text: t('Chia đều', 'Share equally') },
        ...grown.map(({ k, i }) => ({ key: String(i), text: t(`Để hết cho ${k.sex === 'M' ? 'con trai' : 'con gái'} ${k.name ?? ''} (${k.age} tuổi)`, `Leave it all to your ${k.sex === 'M' ? 'son' : 'daughter'} ${k.name ?? ''} (${k.age})`) }))],
    };
  }
  if (a === 55 && working && plan.exitAge > 56 && open('retire')) {
    return {
      id: 'retire', dflt: 'usual',
      title: t('Bạn định làm việc đến bao giờ?', 'How long do you plan to keep working?'),
      context: t(`Theo số liệu ILO của nước bạn, người như bạn thường thôi làm việc lúc khoảng ${plan.exitAge} tuổi. Nghỉ sớm thì có thêm thời gian, nhưng mất thu nhập và lương hưu thấp hơn; làm lâu hơn thì ngược lại.`,
        `From ILO data for your country, someone like you usually stops working at about ${plan.exitAge}. Stopping early gives you time but costs income and a smaller pension; working longer does the opposite.`),
      options: [{ key: 'usual', text: t(`Như thường lệ (khoảng ${plan.exitAge} tuổi)`, `As usual (about ${plan.exitAge})`) }, { key: '58', text: t('Nghỉ sớm, lúc 58 tuổi', 'Retire early, at 58') }, { key: '70', text: t('Làm đến 70 tuổi', 'Work until 70') }],
    };
  }

  // A lottery jackpot: what to do with it.
  if (p.money.windfall > 0 && open(`windfall-${a}`)) {
    const c = (p.residence ?? p.b.country).c, grownKids = p.children.filter(k => k.alive && k.age >= 18).length;
    return {
      id: `windfall-${a}`, dflt: 'save',
      title: t(`Bạn vừa trúng ${formatMoney(c, p.money.windfall, 'vi')}. Làm gì với số tiền này?`, `You just won ${formatMoney(c, p.money.windfall, 'en')}. What do you do with it?`),
      context: t('Các nghiên cứu về người trúng số ở Thụy Điển thấy họ hài lòng với cuộc sống hơn trong nhiều năm sau, nhưng sức khỏe hầu như không đổi (Lindqvist, Östling & Cesarini 2020).',
        'Studies of Swedish lottery winners find they are more satisfied with life for years afterwards, while their health barely changes (Lindqvist, Östling & Cesarini 2020).'),
      options: [{ key: 'save', text: t('Để dành', 'Save it') }, { key: 'spend', text: t('Tiêu cho thỏa thích', 'Enjoy spending it') },
        ...(grownKids ? [{ key: 'kids', text: t('Chia cho các con', 'Share it with your children') }] : [])],
    };
  }

  // Lottery: start at 20, chances to stop at 40 and 60.
  if (a === 20 && open('lottery')) {
    return {
      id: 'lottery', dflt: 'no',
      title: t('Mua vé số mỗi tuần?', 'Buy a lottery ticket every week?'),
      context: t(`Trung bình mỗi vé chỉ trả lại khoảng ${pct(LOTTERY_PAYOUT, 'vi')}% tiền mua (cơ cấu giải Vietlott Mega 6/45, chưa tính giải độc đắc dồn). Cơ hội trúng độc đắc là 1 trên 8.145.060 mỗi vé.`,
        `On average a ticket pays back about ${pct(LOTTERY_PAYOUT, 'en')}% of its price (Vietlott Mega 6/45 prize table, before jackpot rollovers). The jackpot odds are 1 in 8,145,060 per ticket.`),
      options: [{ key: 'no', text: t('Không mua', 'No') }, { key: 'yes', text: t('Mua đều đặn', 'Yes, every week') }],
    };
  }
  if ((a === 40 || a === 60) && p.money.lottery.plays && open(`lottery-${a}`)) {
    const net = p.money.lottery.won - p.money.lottery.spent;
    const share = num(Math.abs(net) / Math.max(1e-9, p.money.lottery.spent) * 100, 'vi'), shareEn = num(Math.abs(net) / Math.max(1e-9, p.money.lottery.spent) * 100, 'en');
    return {
      id: `lottery-${a}`, dflt: 'keep',
      title: t('Vẫn mua vé số tiếp chứ?', 'Keep buying lottery tickets?'),
      context: t(`Đến giờ bạn đã ${net < 0 ? 'lỗ' : 'lãi'} khoảng ${share}% số tiền bỏ ra mua vé.`,
        `So far you are ${net < 0 ? 'down' : 'up'} about ${shareEn}% of what you spent on tickets.`),
      options: [{ key: 'keep', text: t('Vẫn mua', 'Keep buying') }, { key: 'quit', text: t('Thôi không mua', 'Stop') }],
    };
  }

  // Marriage (forced child marriages are not a choice), then how many children.
  if (a === plan.marriageAge && plan.childMarriageAge === undefined && p.marital === 'single' && open(`marry-${a}`)) {
    const mc = marriage(rc)[p.b.sex];
    return {
      id: `marry-${a}`, dflt: 'marry',
      title: t('Có người muốn cưới bạn.', 'Someone wants to marry you.'),
      context: t(`Ở ${rc.name.vi}, ${pct(mc.shareBy(a + 1), 'vi')}% ${p.b.sex === 'F' ? 'phụ nữ' : 'đàn ông'} đã kết hôn khi đến ${a} tuổi, ${pct(mc.ever, 'vi')}% kết hôn trước 50 tuổi (UN World Marriage Data).`,
        `In ${rc.name.en}, ${pct(mc.shareBy(a + 1), 'en')}% of ${p.b.sex === 'F' ? 'women' : 'men'} are married by ${a} and ${pct(mc.ever, 'en')}% marry before 50 (UN World Marriage Data).`),
      options: [{ key: 'marry', text: t('Kết hôn', 'Marry') }, { key: 'wait', text: t('Chờ vài năm nữa', 'Wait a few years') }, { key: 'never', text: t('Không kết hôn', 'Stay single') }],
    };
  }
  if (p.marital === 'married' && plan.maxKids === undefined && open('kids')) {
    return {
      id: 'kids', dflt: 'nature',
      title: t('Bạn muốn có mấy con?', 'How many children do you want?'),
      context: t(`Phụ nữ ở ${rc.name.vi} có trung bình ${num(rc.tfr, 'vi', 1)} con (UN WPP). ${pct(rc.fp_satisfied / 100, 'vi')}% phụ nữ muốn tránh thai được dùng biện pháp tránh thai hiện đại (UN SDG 3.7.1); những người khác vẫn có thể mang thai ngoài ý muốn.`,
        `Women in ${rc.name.en} have ${num(rc.tfr, 'en', 1)} children on average (UN WPP). ${pct(rc.fp_satisfied / 100, 'en')}% of women who want to avoid pregnancy have modern contraception (UN SDG 3.7.1); others may still get pregnant.`),
      options: [{ key: 'nature', text: t('Thuận theo tự nhiên', 'Let it happen') }, { key: '0', text: t('Không muốn có con', 'None') },
        { key: '1', text: t('Một con', 'One') }, { key: '2', text: t('Hai con', 'Two') }, { key: '3', text: t('Ba con', 'Three') }],
    };
  }
  return undefined;
}

/** Apply a choice and add it to the story. The usual option is not written down: what it leads to is
 *  already told by the events themselves (a wedding, starting to smoke...), and a list of "you did as
 *  usual" lines only clutters the story. */
export function decideAndLog(p: Person, d: Decision, key: string, rng: Rng): void {
  const outcome = decide(p, d, key, rng);
  if (key !== d.dflt) p.log.push({ age: p.age, kind: 'choice', text: outcome });
}

/** Apply the chosen option; returns what happened (for the story). */
export function decide(p: Person, d: Decision, key: string, rng: Rng): T {
  p.decided[d.id] = key;
  if (key !== d.dflt) p.choseUnusual = true;
  const plan = p.plan, a = p.age, rc = raisedIn(p).c;
  if (d.id.startsWith('school-')) {
    if (key === 'leave') return t('Bạn nghỉ học.', 'You leave school.');
    const f = schoolFit(rc), k = plan.schoolYears, nx = nextLevel(k);
    if (rng() < f.pAtLeast[nx] / f.pAtLeast[k]) {
      plan.schoolYears = nx;
      if (p.lat.eduZ <= f.cut[nx]) restand(p, f.cut[nx] + 0.01);
      return k === 0 ? t('Gia đình đồng ý cho bạn đi học.', 'Your family agrees to send you to school.')
        : t(`Gia đình cố gắng cho bạn học tiếp đến ${LEVEL[nx].vi}.`, `Your family manages to keep you in school through ${LEVEL[nx].en}.`);
    }
    return k === 0 ? t('Gia đình không thể cho bạn đi học.', 'Your family cannot send you to school.')
      : t('Gia đình không lo nổi cho bạn đi học tiếp.', 'Your family cannot afford to keep you in school.');
  }
  if (d.id === 'uni') {
    const f = schoolFit(rc), thr = invNorm(1 - f.pAtLeast[12] * f.uniGivenFinish);
    if (key === 'work') {
      if (plan.university) { plan.university = false; plan.field = undefined; if (p.lat.eduZ > thr) restand(p, thr - 0.01); }
      return t('Bạn quyết định đi làm luôn.', 'You decide to start working.');
    }
    if (plan.university) return t('Bạn nhập học đại học.', 'You enrol at university.');
    if (rng() < f.uniGivenFinish) {
      plan.university = true; plan.vocational = false; plan.field = 0;
      if (p.lat.eduZ < thr) restand(p, thr + 0.01);
      return t('Bạn thi đỗ đại học.', 'You get a university place.');
    }
    return t('Bạn thi trượt đại học.', 'You do not get a university place.');
  }
  if (d.id === 'field') { plan.field = Number(key); return t(`Bạn chọn học ${FIELDS[Number(key)].vi}.`, `You choose ${FIELDS[Number(key)].en}.`); }
  if (d.id === 'smoke') {
    if (key === 'refuse') { plan.smokeStartAge = undefined; return t('Bạn từ chối khi bạn bè mời hút thuốc.', 'You turn down the cigarette your friends offer.'); }
    return t('Bạn hút thử điếu thuốc bạn bè mời.', 'You try the cigarette your friends offer.');
  }
  if (d.id.startsWith('quit-')) {
    if (key === 'keep') return t('Bạn vẫn hút thuốc.', 'You keep smoking.');
    if (rng() < QUIT_SUCCESS) { plan.quitAge = a; p.smoker = false; return t('Bạn bỏ được thuốc lá.', 'You manage to quit.'); }
    return t('Bạn cố bỏ thuốc nhưng rồi lại hút.', 'You try to quit but start again.');
  }
  if (d.id === 'emigrate') {
    if (key === 'stay') { plan.emigrateAge = undefined; plan.destination = undefined; return t('Bạn quyết định ở lại quê hương.', 'You decide to stay.'); }
    return t('Bạn quyết định ra đi.', 'You decide to go.');
  }
  if (d.id.startsWith('marry-')) {
    if (key === 'wait') { plan.marriageAge = a + 3; return t('Bạn từ chối, muốn chờ thêm vài năm.', 'You say not yet; you want to wait a few years.'); }
    if (key === 'never') { plan.marriageAge = undefined; return t('Bạn quyết định không kết hôn.', 'You decide not to marry.'); }
    return t('Bạn nhận lời cầu hôn.', 'You accept the proposal.');
  }
  if (d.id.startsWith('invest-')) {
    p.money.portfolio = key as Portfolio;
    const name: Record<string, T> = { usual: t('để tiền như phần lớn mọi người', 'keep your savings like most people'), bank: t('gửi tiền ngân hàng', 'keep your savings in the bank'),
      stocks: t('dồn tiền vào cổ phiếu', 'put your savings into shares'), housing: t('dồn tiền vào nhà đất', 'put your savings into property') };
    return t(`Bạn ${name[key].vi}.`, `You ${name[key].en}.`);
  }
  if (d.id.startsWith('biz-')) {
    if (key === 'no') return t('Bạn chưa mở doanh nghiệp, vẫn tiếp tục đi làm.', 'You decide against starting a business and keep your job.');
    const labour = p.residence ?? p.b.country, job = p.career.job!;
    const yearly = 12 * monthlyEarnings(labour, p.b.sex, { ...job, status: 'emp' }, a, p.money.personal);
    p.money.biz = openBusiness(a, yearly, rng);
    p.money.bizLedger += yearly;
    p.money.bizJob = job;
    const owned = { ...job, status: 'employer' as const, informal: false, title: OWNER[job.occ] ?? t('chủ một doanh nghiệp nhỏ', 'owner of a small business') };
    p.career.job = owned; p.career.history.push({ age: a, job: owned });
    return t(`Bạn bỏ khoảng ${formatMoney(labour.c, yearly, 'vi')} ra mở doanh nghiệp và trở thành ${owned.title.vi}.`,
      `You put about ${formatMoney(labour.c, yearly, 'en')} into a business of your own and become ${owned.title.en}.`);
  }
  if (d.id.startsWith('bizrev-')) {
    const biz = p.money.biz!, c = (p.residence ?? p.b.country).c;
    if (key === 'expand') {
      biz.value += biz.capital; p.money.bizLedger += biz.capital; biz.expanded++;
      return t(`Bạn bỏ thêm khoảng ${formatMoney(c, biz.capital, 'vi')} để mở rộng.`, `You put in about ${formatMoney(c, biz.capital, 'en')} more to expand.`);
    }
    if (key === 'sell') {
      const got = SALE_SHARE * biz.value;
      p.money.bizLedger -= got; endBusiness(p);
      return t(`Bạn bán doanh nghiệp được khoảng ${formatMoney(c, got, 'vi')} và quay lại đi làm thuê.`, `You sell the business for about ${formatMoney(c, got, 'en')} and go back to a job.`);
    }
    return t('Bạn giữ doanh nghiệp như cũ.', 'You carry on as before.');
  }
  if (d.id === 'kidsedu') {
    p.money.eduInvest = key === 'invest';
    return key === 'invest' ? t('Bạn bỏ thêm tiền cho các con học thêm và vào trường tốt hơn.', 'You pay for extra tutoring and better schools for your children.')
      : t('Bạn cho con đi học như các nhà khác.', 'Your children go to school like everyone else’s.');
  }
  if (d.id === 'gift') {
    const share = Number(key), kids = p.children.filter(k => k.alive && k.age >= 18);
    if (!share || !kids.length) return t('Bạn giữ lại tài sản.', 'You keep your wealth.');
    const total = share * (p.money.lastNW ?? 0), each = total / kids.length, c = (p.residence ?? p.b.country).c;
    for (const k of kids) { k.gift = each; k.giftAge = k.age; }
    p.money.familySpent += total;
    return t(`Bạn cho mỗi người con khoảng ${formatMoney(c, each, 'vi')}.`, `You give each child about ${formatMoney(c, each, 'en')}.`);
  }
  if (d.id === 'will') {
    if (key === 'equal') return t('Di chúc của bạn chia đều tài sản cho các con.', 'Your will shares everything equally between your children.');
    const k = p.children[Number(key)];
    plan.willTo = Number(key);
    return t(`Di chúc để lại toàn bộ tài sản cho ${k.sex === 'M' ? 'con trai' : 'con gái'} ${k.name ?? ''}.`, `Your will leaves everything to your ${k.sex === 'M' ? 'son' : 'daughter'} ${k.name ?? ''}.`);
  }
  if (d.id === 'retire') {
    if (key !== 'usual') plan.exitAge = Number(key);
    return key === 'usual' ? t('Bạn làm việc như thường lệ.', 'You work as long as usual.') : t(`Bạn dự định thôi làm việc lúc ${key} tuổi.`, `You plan to stop working at ${key}.`);
  }
  if (d.id.startsWith('windfall-')) {
    const amount = p.money.windfall, c = (p.residence ?? p.b.country).c;
    p.money.windfall = 0;
    if (key === 'spend') { p.money.familySpent += amount; return t('Bạn mua nhà mới, đi du lịch, sắm sửa; tiền đi nhanh hơn bạn tưởng.', 'A new home, travel, shopping: the money goes faster than you thought.'); }
    if (key === 'kids') {
      const kids = p.children.filter(k => k.alive && k.age >= 18), each = amount / kids.length;
      for (const k of kids) { k.gift = (k.gift ?? 0) + each; k.giftAge = k.age; }
      p.money.familySpent += amount;
      return t(`Bạn chia cho mỗi người con khoảng ${formatMoney(c, each, 'vi')}.`, `You give each child about ${formatMoney(c, each, 'en')}.`);
    }
    return t('Bạn để dành phần lớn số tiền.', 'You save most of it.');
  }
  if (d.id === 'team') { plan.team = key === 'yes'; return key === 'yes' ? t('Bạn vào đội thể thao của trường.', 'You make the school team.') : t('Bạn không vào đội.', 'You stay out of the team.'); }
  if (d.id.startsWith('exercise-')) { plan.active = key === 'active'; return key === 'active' ? t('Bạn tập thể dục đều đặn.', 'You exercise regularly.') : t('Bạn vận động như phần lớn mọi người.', 'You exercise as much as most people do.'); }
  if (d.id === 'insure') { plan.insured = key === 'yes'; return key === 'yes' ? t('Bạn mua bảo hiểm y tế.', 'You buy health insurance.') : t('Bạn không mua bảo hiểm y tế.', 'You go without health insurance.'); }
  if (d.id === 'screen') { plan.screened = key === 'yes'; return key === 'yes' ? t('Bạn đi tầm soát ung thư định kỳ.', 'You go for regular cancer screening.') : t('Bạn không đi tầm soát.', 'You skip screening.'); }
  if (d.id === 'lottery') {
    p.money.lottery.plays = key === 'yes';
    return key === 'yes' ? t('Tuần nào bạn cũng mua một tờ vé số.', 'You buy a ticket every week.') : t('Bạn không mua vé số.', 'You do not play the lottery.');
  }
  if (d.id.startsWith('lottery-')) {
    if (key === 'quit') p.money.lottery.plays = false;
    return key === 'quit' ? t('Bạn thôi mua vé số.', 'You stop buying tickets.') : t('Bạn vẫn mua vé số đều đặn.', 'You keep buying tickets.');
  }
  if (d.id === 'kids') {
    if (key !== 'nature') plan.maxKids = Number(key);
    return key === 'nature' ? t('Hai vợ chồng để chuyện con cái thuận theo tự nhiên.', 'You let children come as they will.')
      : t(key === '0' ? 'Hai vợ chồng không muốn có con.' : `Hai vợ chồng muốn có ${key} con.`, `You want ${key === '0' ? 'no' : key} ${key === '1' ? 'child' : 'children'}.`);
  }
  return t('', '');
}
