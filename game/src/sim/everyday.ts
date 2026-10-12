// Everyday life: what fills the years in which nothing big happens, and the milestones of the children.
//
// None of this changes how a life unfolds: choices of lines use a fixed hash of the person, not the
// shared random stream (validation and saved lives are unaffected).
// - Children's milestones: first day of school (with the country's chance of going to school, UNESCO),
//   18th birthday, wedding (age from the country's marriage curve for their sex, UN World Marriage Data).
// - Quiet years: either a comparison with people of the same age (survival from the UN life table,
//   schooling from UNESCO, marriage from UN WMD, work from ILO) or a small everyday scene that fits the
//   person's age and circumstances (these scenes are story, not data).

import type { LogEntry, Person } from './person.ts';
import { raisedIn } from './person.ts';
import { schoolFit, marriage } from './calibrate.ts';
import { hash } from './names.ts';
import { num, t, type T } from './i18n.ts';

type Line = Omit<LogEntry, 'age'>;
const u01 = (key: string) => hash(key) / 4294967296;

/** Milestones of the person's children this year. */
export function childMilestones(p: Person): Line[] {
  const out: Line[] = [];
  const home = (p.residence ?? p.b.country).c;
  for (const k of p.children) {
    if (!k.alive || !k.name) continue;
    const son = k.sex === 'M';
    const key = `${p.nameKey}|kid|${k.name}|${k.bornAt}`;
    if (k.age === 6) {
      const goes = u01(key + 'school') < schoolFit(home).pAtLeast[1];
      out.push({ kind: 'family', text: goes
        ? t(`${son ? 'Con trai' : 'Con gái'} ${k.name} bước vào lớp 1.`, `Your ${son ? 'son' : 'daughter'} ${k.name} starts school.`)
        : t(`${k.name} đến tuổi đi học nhưng không được đến trường.`, `${k.name} is old enough for school but does not go.`) });
    }
    if (k.age === 18) out.push({ kind: 'family', text: t(`${k.name} tròn 18 tuổi.`, `${k.name} turns 18.`) });
    const mc = marriage(home)[k.sex];
    const u = u01(key + 'marry');
    if (u < mc.ever && k.age === Math.max(16, Math.floor(mc.ageAt(u)))) {
      out.push({ kind: 'love', text: son ? t(`Con trai ${k.name} lấy vợ.`, `Your son ${k.name} gets married.`) : t(`Con gái ${k.name} lấy chồng.`, `Your daughter ${k.name} gets married.`) });
    }
  }
  return out;
}

/** Share of a birth cohort still alive at this age (UN life table of the country of birth). */
function survivors(p: Person, age: number): number {
  const qx = p.b.country.mort[p.b.sex].qx;
  let l = 1;
  for (let a = 0; a < Math.min(age, qx.length); a++) l *= 1 - qx[a];
  return l;
}

/** One line for a year in which nothing else happened. */
export function quietYear(p: Person): Line | undefined {
  const a = p.age, key = `${p.nameKey}|quiet|${a}`, c = raisedIn(p).c, home = (p.residence ?? p.b.country).c;
  const female = p.b.sex === 'F';
  // About one quiet year in three gets a comparison with people of the same age, if one fits; the same
  // kind of comparison at most once every five years.
  const used = p.storyUsed;
  if (u01(key + 'fact') < 0.35) {
    const fact = peerFact(p, a, c, home, female);
    if (fact && a - (used.facts[fact.kind] ?? -99) >= 5) { used.facts[fact.kind] = a; return fact; }
  }
  // Every everyday scene is told at most once in a life.
  const scenes = SCENES.map((s, i) => ({ s, i })).filter(({ s, i }) => !used.scenes.includes(i) && s.when(p, a));
  if (!scenes.length) return undefined;
  const { s, i } = scenes[Math.floor(u01(key) * scenes.length)];
  used.scenes.push(i);
  return { kind: s.kind, text: s.text(p) };
}

function peerFact(p: Person, a: number, c: Person['c'], home: Person['c'], female: boolean): Line | undefined {
  const who = female ? t('phụ nữ', 'women') : t('đàn ông', 'men');
  if ((a >= 1 && a <= 5) || a >= 50) {
    const n = Math.round(100 * survivors(p, a + 1));
    return { kind: 'family', text: t(`Trong 100 ${a < 18 ? 'em bé' : 'người'} sinh cùng năm với bạn ở ${p.b.country.c.name.vi}, còn khoảng ${n} người.`,
      `Of 100 ${a < 18 ? 'babies' : 'people'} born the same year as you in ${p.b.country.c.name.en}, about ${n} are still alive.`),
      source: t('Bảng sống UN WPP 2024.', 'UN WPP 2024 life table.') };
  }
  if (a >= 7 && a <= 17) {
    const share = schoolFit(c).pAtLeast[Math.min(12, a - 6)];
    return { kind: 'school', text: t(`${num(100 * share, 'vi')}% trẻ ${a} tuổi ở ${c.name.vi} vẫn còn đi học.`, `${num(100 * share, 'en')}% of ${a}-year-olds in ${c.name.en} are still in school.`),
      source: t('UNESCO (tỷ lệ hoàn thành các cấp học).', 'UNESCO (completion rates).') };
  }
  if (a >= 18 && a <= 40) {
    const share = marriage(c)[p.b.sex].shareBy(a + 1);
    return { kind: 'love', text: t(`${num(100 * share, 'vi')}% ${who.vi} ${a} tuổi ở ${c.name.vi} đã từng kết hôn.`, `${num(100 * share, 'en')}% of ${who.en} aged ${a} in ${c.name.en} have married.`),
      source: t('UN World Marriage Data.', 'UN World Marriage Data.') };
  }
  if (a >= 41 && a <= 49) {
    const share = home.lfp_age[p.b.sex].p25;
    return { kind: 'work', text: t(`${num(100 * share, 'vi')}% ${who.vi} tuổi trung niên ở ${home.name.vi} đang đi làm.`, `${num(100 * share, 'en')}% of middle-aged ${who.en} in ${home.name.en} are in work.`),
      source: t('ILO, ước tính tham gia lao động.', 'ILO modelled labour force estimates.') };
  }
  return undefined;
}

interface Scene { kind: LogEntry['kind']; when: (p: Person, a: number) => boolean; text: (p: Person) => T }
const kid = (p: Person, min: number, max: number) => p.children.find(k => k.alive && k.age >= min && k.age <= max);
const grandkids = (p: Person) => p.grandchildren.some(k => k.alive);
const rich = (p: Person) => p.b.wealthPct > 0.6, poor = (p: Person) => p.b.wealthPct < 0.4;

const SCENES: Scene[] = [
  // Childhood
  { kind: 'family', when: (p, a) => a >= 3 && a <= 6, text: () => t('Bạn mê nghe kể chuyện trước khi ngủ.', 'You love bedtime stories.') },
  { kind: 'family', when: (p, a) => a >= 5 && a <= 9 && !p.urban, text: () => t('Bạn tập bơi ở con sông gần nhà cùng lũ trẻ trong xóm.', 'You learn to swim in the river near home with the other children.') },
  { kind: 'family', when: (p, a) => a >= 5 && a <= 9 && p.urban, text: () => t('Bạn học đi xe đạp trong con hẻm trước nhà.', 'You learn to ride a bicycle in the lane outside your home.') },
  { kind: 'family', when: (p, a) => a >= 4 && a <= 12 && poor(p), text: () => t('Bạn phụ bố mẹ việc nhà và trông các em.', 'You help with the housework and look after the little ones.') },
  { kind: 'family', when: (p, a) => a >= 6 && a <= 12 && rich(p), text: () => t('Sinh nhật năm nay bạn được tặng món đồ chơi mơ ước.', 'For your birthday you get the toy you dreamed of.') },
  { kind: 'school', when: (p, a) => a >= 7 && a <= 14 && a - 6 <= p.plan.schoolYears, text: (p) => t(`Bạn chơi thân với ${friend(p)}, bạn cùng lớp.`, `You become best friends with ${friend(p)}, a classmate.`) },
  { kind: 'school', when: (p, a) => a >= 8 && a <= 15 && a - 6 <= p.plan.schoolYears, text: () => t('Bạn được cô giáo khen trước lớp.', 'Your teacher praises you in front of the class.') },
  // Teens
  { kind: 'family', when: (p, a) => a >= 13 && a <= 17, text: () => t('Bạn cãi nhau với bố mẹ vì những chuyện vặt; rồi lại làm lành.', 'You argue with your parents over small things, then make up.') },
  { kind: 'love', when: (p, a) => a >= 14 && a <= 19, text: () => t('Bạn thầm thích một người, nhưng không dám nói.', 'You have a crush on someone but never say so.') },
  { kind: 'family', when: (p, a) => a >= 13 && a <= 19, text: () => t('Bạn mê một bài hát, nghe đi nghe lại cả năm.', 'You play one song over and over all year.') },
  // Adults
  { kind: 'work', when: (p, a) => a >= 20 && a <= 60 && !!p.career.job && p.career.job.status !== 'family', text: (p) => t(`Một năm làm ${p.career.job!.title.vi} lặng lẽ trôi qua.`, `Another quiet year as ${p.career.job!.title.en}.`) },
  { kind: 'family', when: (p, a) => a >= 20 && a <= 35 && p.marital === 'single', text: () => t('Bạn bè xung quanh lần lượt lập gia đình.', 'One by one your friends settle down.') },
  { kind: 'family', when: (p, a) => a >= 22 && p.urban, text: () => t('Cuối tuần bạn hay ngồi quán cà phê quen với vài người bạn cũ.', 'At weekends you meet old friends at your usual café.') },
  { kind: 'family', when: (p, a) => a >= 22 && !p.urban, text: () => t('Mùa màng năm nay bình thường; cả xóm vẫn qua lại giúp nhau.', 'An ordinary harvest year; the neighbours help each other as always.') },
  { kind: 'family', when: (p) => !!kid(p, 4, 8), text: (p) => t(`Bạn dạy ${kid(p, 4, 8)!.name} đi xe đạp.`, `You teach ${kid(p, 4, 8)!.name} to ride a bicycle.`) },
  { kind: 'family', when: (p) => !!kid(p, 6, 11), text: (p) => t(`Sáng nào bạn cũng đưa ${kid(p, 6, 11)!.name} đi học.`, `Every morning you take ${kid(p, 6, 11)!.name} to school.`) },
  { kind: 'family', when: (p) => !!kid(p, 13, 17), text: (p) => t(`${kid(p, 13, 17)!.name} bắt đầu tuổi nổi loạn; nhà cửa ồn ào hơn.`, `${kid(p, 13, 17)!.name} hits the teenage years; the house gets louder.`) },
  { kind: 'family', when: (p, a) => a >= 30 && p.marital === 'married' && !!p.spouse?.name, text: (p) => t(`Bạn và ${p.spouse!.name} kỷ niệm ngày cưới bằng một bữa cơm nhỏ.`, `You and ${p.spouse!.name} mark your anniversary with a quiet dinner.`) },
  { kind: 'family', when: (p, a) => a >= 25 && a <= 60 && rich(p), text: () => t('Cả nhà đi du lịch một chuyến xa.', 'The family takes a trip far from home.') },
  { kind: 'family', when: (p, a) => a >= 25 && (p.mother.alive || p.father.alive), text: (p) => t(`Bạn về thăm ${p.mother.alive ? 'mẹ' : 'bố'} dịp Tết.`, `You visit your ${p.mother.alive ? 'mother' : 'father'} for the holidays.`) },
  // Older age
  { kind: 'family', when: (p, a) => a >= 60, text: () => t('Bạn trồng thêm mấy chậu cây trước nhà.', 'You plant a few more pots in front of the house.') },
  { kind: 'family', when: (p, a) => a >= 60 && grandkids(p), text: () => t('Các cháu về chơi, nhà cửa rộn ràng cả tuần.', 'The grandchildren come to stay; the house is lively for a week.') },
  { kind: 'family', when: (p, a) => a >= 65, text: () => t('Bạn hay ngồi kể chuyện ngày xưa cho người trẻ nghe.', 'You often tell younger people stories of the old days.') },
  { kind: 'health', when: (p, a) => a >= 65, text: () => t('Sáng nào bạn cũng đi bộ một vòng quanh xóm.', 'Every morning you take a walk around the neighbourhood.') },
];

function friend(p: Person): string {
  const names = p.c.names?.[p.b.sex] ?? [];
  return names.length ? names[hash(p.nameKey + 'friend') % names.length] : t('một bạn', 'a friend').vi;
}
