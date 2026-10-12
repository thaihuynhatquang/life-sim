// The game screens: be born, live year by year, then carry on the family line through a child.

import type { Country, LifeTables } from '../model/types.ts';
import { buildWorld, type World } from '../model/world.ts';
import { makeRng, type Rng } from '../model/rng.ts';
import { beBorn } from '../model/life.ts';
import { incomeAt } from '../model/income.ts';
import { normCdf } from '../model/stats.ts';
import type { CauseData } from '../sim/causes.ts';
import { createPerson, mortalityZ, schoolYearsDone, type Kin, type LogEntry, type Person } from '../sim/person.ts';
import { childLife, heirsOf } from '../sim/dynasty.ts';
import { step } from '../sim/simulate.ts';
import { formatMoney, setDisplayCountry } from '../sim/money.ts';
import { decideAndLog, decisionAt, type Decision } from '../sim/decisions.ts';
import { num, type Lang, type T } from '../sim/i18n.ts';
import { parallelLives, type Parallel } from '../sim/parallel.ts';
import { parallelHtml } from './parallel-view.ts';
import { aboutHtml } from './about.ts';
import { avatar, flag, GAME_TITLE, ico, KIND_ICON, REPO_URL } from './look.ts';
import { setReturnsModel, type ReturnsModel } from '../sim/finance.ts';
import { decodeSave, encodeSave, firstLife, MODEL_VERSION, rebuild, type Factory, type Save, type SavedLife } from '../sim/save.ts';

const $ = (id: string) => document.getElementById(id)!;
let lang: Lang = 'vi';
let world: World;
let p: Person | undefined, rng: Rng, seed = 0, shown = 0;
let pending: Decision | undefined;
/** How the current life was created from a random stream (to replay it). */
let makeLife: (r: Rng) => Person;
/** Lives already played in this family line. */
interface Gen { p: Person; country: Country }
let lineage: Gen[] = [];
/** The same start in life with a fresh random stream (for the parallel lives), and their result. */
let sameStart: (r: Rng) => Person;
let par: { life: Person; result?: Parallel; progress: number } | undefined;
const PARALLEL_N = 1000; // lives with the same start
const PARALLEL_WORLD = 500; // babies born anywhere, for the comparison with the world
/** What is saved: every life of the line so far, the current one last. */
let saved: SavedLife[] = [];
const STORE = 'one-life.save';
/** Log entries already drawn once (they are not animated again, e.g. after a language switch). */
let seen = new WeakSet<LogEntry>();
/** Last entry drawn: if the log changed before it (an entry inserted into the past), redraw everything. */
let lastDrawn: LogEntry | undefined;
/** Redraw without animation or scrolling (language or currency switch). */
let quiet = false;
/** How money is shown: in the currency of the country lived in, or converted to VND / USD. */
type MoneyView = 'local' | 'VND' | 'USD';
let moneyView: MoneyView = 'local';
const MONEY_STORE = 'one-life.money';

const tr = (vi: string, en: string) => (lang === 'vi' ? vi : en);
const L = (t: T) => t[lang];
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

async function load(): Promise<void> {
  const get = async <X>(f: string): Promise<X> => (await fetch(`/${f}`)).json();
  const [countries, lt, causes, returns] = await Promise.all([
    get<Record<string, Country>>('countries.json'), get<LifeTables>('lifetables.json'), get<CauseData>('causes.json'), get<ReturnsModel>('returns_model.json')]);
  setReturnsModel(returns);
  world = buildWorld(countries, lt, causes);
}

// ---------------------------------------------------------------- screens

function intro(): void {
  p = undefined;
  $('game').hidden = true;
  const el = $('intro');
  el.hidden = false;
  el.innerHTML = `<div class="hero card">
      <div class="hero-art" aria-hidden="true"><span class="globe">🌏</span><span class="baby">👶</span><span class="spark s1">✨</span><span class="spark s2">⭐</span></div>
      <h2 class="hero-title">${esc(GAME_TITLE[lang])}</h2>
      <p class="slogan">Simulate the life you could have had</p>
      <p class="hero-tag">${tr('Chào đời ở một nơi bất kỳ trên Trái Đất, rồi sống trọn một kiếp người.', 'Be born anywhere on Earth, then live a whole life.')}</p>
      <div class="hero-btns"><button class="primary big" id="born">${ico('👶')}${tr('Chào đời', 'Be born')}</button>
      ${stored() ? `<button class="soft big" id="resume">${ico('▶️')}${esc(resumeLabel(stored()!))}</button>` : ''}</div>
      <p id="note" class="note" role="status"></p>
      <ul class="hero-facts">
        <li>${ico('🎲')}${tr('Ngẫu nhiên nơi sinh, giới tính, gia cảnh', 'Random birthplace, sex and family')}</li>
        <li>${ico('📊')}${tr('Dựa trên số liệu thật của từng nước', 'Based on real data for each country')}</li>
        <li>${ico('🌳')}${tr('Cha truyền con nối qua nhiều thế hệ', 'Handed down from parent to child, generation after generation')}</li>
      </ul>
      <p class="hero-text">${tr(
    'Mỗi năm có khoảng 130 triệu trẻ em chào đời, và bạn sẽ là một trong số đó. Bạn sinh ra ở nước nào, là trai hay gái, nhà giàu hay nghèo đều ngẫu nhiên, đúng theo tỷ lệ ngoài đời thật. Những gì xảy ra sau đó cũng theo xác suất lấy từ số liệu thật của nước bạn (Liên Hợp Quốc, World Bank, WHO, ILO…); nguồn ghi ngay dưới mỗi sự kiện.',
    'About 130 million children are born every year. You will be one of them: country, sex and family are drawn at random in the proportions of the real world. Everything that follows happens with probabilities taken from real data for your country (UN, World Bank, WHO, ILO…); the source is shown under each event.')}</p>
    </div>`;
  $('born').onclick = newLine;
  if (stored()) $('resume').onclick = () => resume(stored()!);
}

function newLine(): void {
  lineage = []; saved = [];
  start(newSeed(), firstLife(world));
}

// ---------------------------------------------------------------- saving

function resumeLabel(s: Save): string {
  const w = s.who;
  if (!w?.name) return tr('Tiếp tục', 'Continue');
  return tr(`Tiếp tục với ${w.name}`, `Continue as ${w.name}`);
}

function stored(): Save | undefined {
  try { const s = localStorage.getItem(STORE); return s ? JSON.parse(s) as Save : undefined; } catch { return undefined; }
}

function persist(): void {
  if (!p) return;
  saved[saved.length - 1].age = p.age;
  saved[saved.length - 1].done = !p.alive;
  try { localStorage.setItem(STORE, JSON.stringify({ v: MODEL_VERSION, lives: saved, who: { name: p.name, age: p.age, alive: p.alive } } satisfies Save)); } catch { /* storage full or blocked: play on */ }
}

/** Load a saved or shared family line by replaying it. */
function resume(save: Save, carry?: typeof par): void {
  const r = rebuild(world, save);
  if ('error' in r) {
    intro();
    $('note').textContent = save.v !== MODEL_VERSION
      ? tr('Bản lưu này làm từ phiên bản game cũ, giờ chạy lại không còn ra đúng cuộc đời đó nữa.', 'This save comes from an older version of the game and no longer replays the same lives.')
      : tr('Không mở được bản lưu này.', 'This save could not be opened.');
    return;
  }
  saved = save.lives.map(l => ({ ...l, choices: [...l.choices] }));
  lineage = r.done.map(q => ({ p: q, country: q.c }));
  seed = saved[saved.length - 1].seed; rng = r.rng; makeLife = r.factory; shown = 0; pending = r.pending;
  p = r.current;
  const b = p.b;
  sameStart = lineage.length ? r.factory : rr => createPerson(b, rr, world.causes);
  // The comparison does not depend on how money is shown: keep it when only the display was rebuilt.
  par = carry?.result && !p.alive ? { life: p, result: carry.result, progress: 1 } : undefined;
  $('intro').hidden = true;
  $('game').hidden = false;
  $('timeline').innerHTML = '';
  render();
  persist();
}

function shareLink(): string {
  return `${location.origin}${location.pathname}#d=${encodeSave({ v: MODEL_VERSION, lives: saved })}`;
}

const newSeed = () => Math.floor(Math.random() * 1e9);

/** Start a life. `heir` is the child's index for a dynasty; `replay` restarts the current life. */
function start(s: number, factory: Factory, heir?: number, replay = false): void {
  const entry: SavedLife = { seed: s, heir, choices: [], age: 0 };
  if (replay) saved[saved.length - 1] = { ...entry, heir: saved[saved.length - 1]?.heir };
  else saved.push(entry);
  seed = s; rng = makeRng(seed); shown = 0; pending = undefined; makeLife = factory;
  p = factory(rng);
  const b = p.b;
  // A first life's start is drawn at random by the factory: keep it fixed for the parallel lives.
  sameStart = lineage.length ? factory : r => createPerson(b, r, world.causes);
  par = undefined;
  $('intro').hidden = true;
  $('game').hidden = false;
  $('timeline').innerHTML = '';
  advance(1);
}

/** Live up to `years` more years, stopping at the next decision (or taking the usual choice if `auto`). */
function advance(years: number, auto = false): void {
  if (!p) return;
  for (let i = 0; i < years && p.alive;) {
    const d = decisionAt(world, p);
    if (d && !auto) { pending = d; break; }
    if (d) { choose(d, d.dflt, false); continue; }
    step(world, p, rng); i++;
  }
  render();
  persist();
}

function choose(d: Decision, key: string, show = true): void {
  if (!p) return;
  decideAndLog(p, d, key, rng);
  saved[saved.length - 1].choices.push([d.id, key]);
  pending = undefined;
  // Another decision may be due the same year (university, then the field of study).
  if (show) { pending = decisionAt(world, p); render(); persist(); }
}

// ---------------------------------------------------------------- rendering

function render(): void {
  if (!p) return;
  renderTimeline(p);
  renderStatus(p);
  renderControls(p);
  if (quiet) return;
  // Bring the newest event, or the question waiting for an answer, into view.
  const target = document.querySelector('#controls .decision') ?? $('timeline').lastElementChild;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  target?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
}

/** Chapters of a life, shown as signposts along the timeline. */
const CHAPTERS: [number, string, string, string][] = [
  [0, '🍼', 'Những năm đầu đời', 'The first years'],
  [3, '🪁', 'Tuổi thơ', 'Childhood'],
  [13, '🎒', 'Tuổi mới lớn', 'Growing up'],
  [20, '🌿', 'Tuổi trẻ', 'Young adult'],
  [40, '🌳', 'Tuổi trung niên', 'Middle age'],
  [60, '🍂', 'Tuổi già', 'Later years'],
];

function renderTimeline(p: Person): void {
  const ol = $('timeline');
  // An entry can be inserted into the past (e.g. the first signs of an illness): then redraw the whole story.
  if (shown > 0 && p.log[shown - 1] !== lastDrawn) { shown = 0; ol.innerHTML = ''; }
  let lastAge = shown > 0 ? p.log[shown - 1].age : -1;
  let html = '', fresh = 0;
  // A life taken over in a dynasty starts on screen like a new birth: a summary card, then the years
  // after the takeover (the years before it were lived with the usual choices and are not shown).
  if (p.takeoverSummary && !ol.querySelector('.takeover-card')) {
    html += `<li class="takeover-card${!quiet ? ' new' : ''}"><p class="tk-title">${ico('🌱')}${tr(`Đời thứ ${p.generation}`, `Generation ${p.generation}`)}</p><p>${esc(L(p.takeoverSummary))}</p></li>`;
  }
  for (; shown < p.log.length; shown++) {
    const e = p.log[shown];
    if (p.takeover !== undefined && e.age <= p.takeover) continue;
    const anim = !quiet && !seen.has(e);
    const cls = anim ? ' new' : '';
    const style = () => (anim ? ` style="--i:${Math.min(fresh++, 8)}"` : '');
    if (e.age !== lastAge) {
      // The latest chapter started since the last age shown (at most one signpost per jump).
      const ch = [...CHAPTERS].reverse().find(([from]) => from <= e.age && from > lastAge);
      if (ch && e.age >= lastAge) {
        html += `<li class="chapter${cls}"${style()}>${ico(ch[1], 'ch-ico')}<span>${tr(ch[2], ch[3])}</span></li>`;
      }
      html += `<li class="age-mark${cls}"${style()}><span class="age">${tr(`${e.age} tuổi`, `age ${e.age}`)}</span></li>`;
    }
    lastAge = e.age;
    seen.add(e);
    html += `<li class="ev k-${e.kind}${cls}"${style()}>${ico(KIND_ICON[e.kind] ?? '•', 'ev-ico')}`
      + `<div class="bubble"><p class="ev-text">${esc(L(e.text))}</p>`
      + (e.source ? `<p class="src">${ico('ⓘ', 'src-i')}${esc(L(e.source))}</p>` : '') + `</div></li>`;
  }
  lastDrawn = p.log[p.log.length - 1];
  ol.insertAdjacentHTML('beforeend', html);
}

let statusLife: Person | undefined;

interface Chip { icon: string; label: string; value: string; extra?: string; wide?: boolean }

function renderStatus(p: Person): void {
  const home = p.residence ?? p.b.country, c = home.c, born = p.b.country.c;
  const female = p.b.sex === 'F';
  const age = p.alive ? p.age : Math.floor(p.ageAtDeath ?? p.age);
  const sexLabel = female ? tr('Nữ', 'Female') : tr('Nam', 'Male');
  const place = p.homeProvince ? `${p.homeProvince}, ${c.name[lang]}` : c.name[lang];
  const where = `${place}${p.residence ? '' : p.urban ? tr(' · thành thị', ' · urban') : tr(' · nông thôn', ' · rural')}`;
  const le = female ? born.le_f : born.le_m;
  // The bar spans a little beyond life expectancy, so a long life still has room to run.
  const span = Math.max(le * 1.25, age + 1);
  const at = (x: number) => Math.min(100, (100 * x) / span);

  const chips: Chip[] = [];
  const pct = Math.round(100 * p.b.wealthPct);
  chips.push({ icon: '🏡', label: tr('Gia cảnh lúc sinh', 'Family at birth'), value: tr(`giàu hơn ${pct}% gia đình trong nước`, `richer than ${pct}% of families`), wide: true });
  const perPerson = incomeAt(home.income, normCdf(mortalityZ(p))) / 12;
  chips.push({ icon: '💰', label: tr('Thu nhập mỗi người trong nhà', 'Household income per person'), value: `${formatMoney(c, perPerson, lang)}${tr('/tháng', ' a month')}`, wide: true });
  // Own pay while working, and net worth (computed every year from 20: savings, inheritance, investments,
  // business, lottery, gifts, health bills).
  const working = p.alive && !!p.career.job && p.career.job.status !== 'family' && p.money.lastMonthly > 0
    && p.age < p.plan.exitAge && p.unemployedUntil <= p.age;
  if (working) chips.push({ icon: '💵', label: tr('Thu nhập của bạn', 'Your pay'), value: `${formatMoney(c, p.money.lastMonthly, lang)}${tr('/tháng', ' a month')}`, wide: true });
  if (p.money.lastNW !== undefined) chips.push({ icon: '🐷', label: tr('Tài sản ròng', 'Net worth'), value: formatMoney(c, p.money.lastNW, lang), wide: true });
  const school = Math.min(p.plan.schoolYears, Math.max(0, p.age - 6)) + (p.plan.university && p.age >= 22 ? 4 : 0);
  if (p.age >= 6) chips.push({ icon: '📚', label: tr('Số năm đi học', 'Years of school'), value: `${school}${p.plan.university && p.age >= 22 ? tr(' (đại học)', ' (university)') : ''}` });
  if (p.career.job && p.age >= 15) chips.push({ icon: '💼', label: tr('Công việc', 'Work'), value: L(p.career.job.title) });
  if (p.age >= 15) chips.push({ icon: '💍', label: tr('Hôn nhân', 'Marital status'), value: {
    single: tr('độc thân', 'single'), married: tr('có gia đình', 'married'), divorced: tr('ly hôn', 'divorced'), widowed: tr('góa', 'widowed'),
  }[p.marital] });
  // Family: spouse, parents still alive and every child, each with a name and an age.
  const fam: string[] = [];
  const row = (rel: string, k: { name?: string; age: number; alive: boolean; deathAge?: number }) => k.alive
    ? `<li><span>${esc(k.name ?? '')}</span><span class="rel">${esc(rel)}, ${tr(`${k.age} tuổi`, `${k.age}`)}</span></li>`
    : `<li><span class="gone">${esc(k.name ?? '')}</span><span class="rel">${esc(rel)}, ${tr(`mất năm ${k.deathAge ?? k.age} tuổi`, `died at ${k.deathAge ?? k.age}`)}</span></li>`;
  if (p.spouse?.alive) fam.push(row(p.spouse.sex === 'M' ? tr('chồng', 'husband') : tr('vợ', 'wife'), p.spouse));
  if (p.mother.alive && p.mother.age >= 0) fam.push(row(tr('mẹ', 'mother'), p.mother));
  if (p.father.alive && p.father.age >= 0) fam.push(row(tr('bố', 'father'), p.father));
  for (const k of p.children) fam.push(row(k.sex === 'M' ? tr('con trai', 'son') : tr('con gái', 'daughter'), k));
  const grand = p.grandchildren.filter(k => k.alive).length;
  if (fam.length) chips.push({ icon: '👪', label: tr('Gia đình', 'Family'), wide: true,
    value: grand ? tr(`${grand} cháu`, `${grand} grandchildren`) : '',
    extra: `<ul class="fam">${fam.join('')}</ul>` });
  const health = [p.smoker && tr('hút thuốc', 'smokes'), p.diabetes && tr('tiểu đường', 'diabetes'), p.hypertension && tr('tăng huyết áp', 'high blood pressure'),
    p.hiv && 'HIV', p.alcohol && tr('nghiện rượu', 'alcohol use disorder')].filter(Boolean);
  chips.push({ icon: '🩺', label: tr('Sức khỏe', 'Health'), value: health.length ? health.join(', ') : tr('không có bệnh mạn tính', 'no chronic illness'), wide: true });
  const ladAges = Object.keys(p.ladder.at).map(Number);
  if (ladAges.length) {
    const v = p.ladder.at[Math.max(...ladAges)];
    chips.push({ icon: v >= 7 ? '😊' : v >= 4 ? '🙂' : '😔', label: tr('Tự chấm cuộc sống', 'Rates own life'), value: `${v}/10`, wide: true,
      extra: `<span class="meter" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</span>` });
  }

  const leText = female
    ? tr(`Phụ nữ ở ${born.name.vi} sống trung bình ${Math.round(le)} năm`, `Women in ${born.name.en} live ${Math.round(le)} years on average`)
    : tr(`Đàn ông ở ${born.name.vi} sống trung bình ${Math.round(le)} năm`, `Men in ${born.name.en} live ${Math.round(le)} years on average`);
  const stops = CHAPTERS.slice(1).map(([from, icon]) => `<i class="stop${age >= from ? ' past' : ''}" style="left:${at(from)}%">${icon}</i>`).join('');
  // The card's entrance animations (photo developing, stamp) play once per life, not every year.
  $('status').classList.toggle('settled', statusLife === p);
  statusLife = p;
  $('status').innerHTML = `<div class="card who-card${p.alive ? '' : ' gone'}">
      <div class="who">
        <div class="avatar" aria-hidden="true"><span class="face">${avatar(p.b.sex, age)}</span>${p.alive ? '' : '<span class="halo">🕊️</span>'}</div>
        <span class="stamp" aria-hidden="true"><span class="flag">${flag(c.iso2)}</span><span class="stamp-name">${esc(c.name[lang])}</span></span>
        <div class="who-txt">
          ${p.generation > 1 ? `<span class="gen">${ico('🌳')}${tr(`Đời thứ ${p.generation}`, `Generation ${p.generation}`)}</span>` : ''}
          ${p.name ? `<p class="who-name">${esc(p.name)}</p>` : ''}
          <p class="who-age">${tr(`${age} tuổi`, `Age ${age}`)}${p.alive ? '' : tr(' (đã mất)', ' (died)')}</p>
          <p class="who-sub">${esc(sexLabel)} · ${esc(where)}</p>
          ${p.residence ? `<p class="who-sub">${tr('Sinh ở', 'Born in')} <span class="flag sm" aria-hidden="true">${flag(born.iso2)}</span> ${esc(p.province ? `${p.province}, ${born.name[lang]}` : born.name[lang])}</p>` : ''}
        </div>
      </div>
      <div class="journey">
        <div class="road" role="progressbar" aria-valuemin="0" aria-valuemax="${Math.round(le)}" aria-valuenow="${Math.min(age, Math.round(le))}" aria-label="${esc(leText)}">
          <span class="walked" style="width:${at(age)}%"></span>
          <span class="le-flag" style="left:${at(le)}%" aria-hidden="true"></span>
          <span class="stops" aria-hidden="true">${stops}</span>
          <span class="walker" style="left:${at(age)}%" aria-hidden="true">${p.alive ? '👣' : '🌸'}</span>
        </div>
        <p class="lb-label">${ico('🏁')}${esc(leText)}</p>
      </div>
    </div>
    <ul class="chips">${chips.map(ch => `<li class="chip${ch.wide ? ' wide' : ''}">${ico(ch.icon, 'chip-ico')}<span class="chip-body"><span class="chip-k">${esc(ch.label)}<span class="sr">: </span></span><span class="chip-v">${esc(ch.value)}</span>${ch.extra ?? ''}</span></li>`).join('')}</ul>
    ${moneyView !== 'local' ? `<p class="money-note">${ico('💱')}${tr(`Tiền quy ra ${moneyView} theo sức mua`, `Money in ${moneyView}, converted at purchasing power`)}</p>` : ''}`;
}

const shareBtn = () => `<button id="share" class="ghost">${ico('🔗')}<span>${tr('Chép link chia sẻ', 'Copy share link')}</span></button>`;

function renderControls(p: Person): void {
  const el = $('controls');
  if (p.alive && pending) {
    const d = pending;
    el.innerHTML = `<div class="decision card" role="group" aria-labelledby="dq">
        <div class="d-head">${ico('✨', 'd-ico')}<p class="q" id="dq">${esc(L(d.title))}</p></div>
        <p class="ctx">${esc(L(d.context))}</p>
        <div class="d-opts">${d.options.map((o, i) => `<button class="opt" data-k="${esc(o.key)}"><span class="opt-key" aria-hidden="true">${'ABCDEFGH'[i] ?? '•'}</span><span>${esc(L(o.text))}</span></button>`).join('')}</div>
      </div>
      <div class="actions minor">${shareBtn()}</div>`;
    el.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach(b => { b.onclick = () => choose(d, b.dataset.k!); });
    $('share').onclick = () => copyLink();
    return;
  }
  if (p.alive) {
    el.innerHTML = `<div class="actions">
        <button class="primary big" id="y1">${ico('🎂')}${tr('Tiếp 1 năm', 'Next year')}</button>
        <button class="soft" id="next">${ico('✨')}${tr('Đến lựa chọn tiếp theo', 'To the next choice')}</button>
        <button class="soft" id="end">${ico('⏩')}${tr('Sống đến cuối đời (theo lựa chọn mặc định)', 'Live to the end (usual choices)')}</button>
      </div>
      <div class="actions minor">${shareBtn()}</div>`;
    $('y1').onclick = () => advance(1);
    $('next').onclick = () => advance(200);
    $('end').onclick = () => advance(200, true);
    $('share').onclick = () => copyLink();
    return;
  }
  const kids = p.children.length, alive = p.children.filter(k => k.alive).length;
  const grand = p.grandchildren.filter(k => k.alive).length;
  const years = schoolYearsDone(p);
  const avg = p.ladder.n ? num(p.ladder.sum / p.ladder.n, lang, 1) : '–';
  const lived = Math.floor(p.ageAtDeath ?? p.age);
  const heirs = heirsOf(p);
  const dead = p;
  const tile = (icon: string, value: string, label: string) =>
    `<li class="tile">${ico(icon, 'tile-ico')}<span class="tile-v">${esc(value)}</span><span class="tile-k">${esc(label)}</span></li>`;
  el.innerHTML = `<div class="recap card">
      <div class="recap-head">${ico('🌸', 'recap-ico')}<div><h2>${tr('Một đời đã khép lại', 'A life, lived')}</h2>
        <p class="muted">${esc(tr(`${p.b.sex === 'F' ? 'Nữ' : 'Nam'}, sinh ở ${p.c.name.vi}`, `${p.b.sex === 'F' ? 'A woman' : 'A man'} born in ${p.c.name.en}`))}</p></div></div>
      <ul class="tiles">
        ${tile('🎂', tr(`${lived} năm`, `${lived} years`), tr('Thọ', 'Lived'))}
        ${tile('📚', tr(`${years} năm`, `${years} years`), tr('Đi học', 'At school'))}
        ${tile('🧸', String(kids), kids ? tr(`con (${alive} còn sống), ${grand} cháu`, `${kids === 1 ? 'child' : 'children'} (${alive} alive), ${grand} grandchildren`) : tr('không có con', 'no children'))}
        ${tile('😊', `${avg}/10`, tr('Điểm hài lòng trung bình cả đời', 'Average life satisfaction'))}
      </ul>
      ${lineageStrip([...lineage, { p, country: p.c }])}
      <p class="seed">${tr('Mã đời này', 'Life code')}: ${seed}</p>
    </div>
    <div id="par">${parallelPanel(p)}</div>
    <div class="card heirs-card">
    ${heirs.length ? `<h3>${ico('🌱')}${tr('Nối dõi dòng họ', 'Carry on the family line')}</h3>
      <p class="muted">${esc(tr('Sống tiếp cuộc đời của một người con, từ hôm nay.', 'Carry on as one of your children, from today.'))}</p>
      <div class="heirs">${heirs.map((k, i) => `<button class="heir" data-h="${i}">${ico(k.sex === 'F' ? '👧' : '👦', 'heir-ico')}<span>${esc(heirLabel(k))}</span>${ico('→', 'heir-go')}</button>`).join('')}</div>`
    : `<p>${ico('🍂')}${esc(tr(lineage.length ? `Dòng họ của bạn dừng lại sau ${lineage.length + 1} đời.` : 'Bạn không có người con nào còn sống để nối dõi.',
        lineage.length ? `Your family line ends after ${lineage.length + 1} generations.` : 'You have no living child to carry on the line.'))}</p>`}
    </div>
    <div class="actions">
      <button class="soft" id="again">${ico('🌍')}${tr('Bắt đầu dòng họ mới', 'Start a new family line')}</button>
      <button class="soft" id="replay">${ico('🔁')}${tr('Sống lại đời này', 'Replay this life')}</button>
      ${shareBtn()}
    </div>`;
  el.querySelectorAll<HTMLButtonElement>('button[data-h]').forEach(b => {
    b.onclick = () => {
      const child: Kin = heirs[Number(b.dataset.h)];
      lineage.push({ p: dead, country: dead.c });
      start(newSeed(), r => childLife(world, dead, child, r), Number(b.dataset.h));
      takeOver();
    };
  });
  $('again').onclick = () => { newLine(); scrollTo({ top: 0 }); };
  $('replay').onclick = () => { start(seed, makeLife, undefined, true); scrollTo({ top: 0 }); };
  $('share').onclick = () => copyLink();
  runParallel(p);
}

/** The comparison with a thousand other lives: computed once per life, in the background. */
function parallelPanel(p: Person): string {
  if (par?.life === p && par.result) return parallelHtml(p, par.result, lang);
  const pctDone = par?.life === p ? Math.round(100 * par.progress) : 0;
  return `<div class="card par-wait" role="status"><p>${ico('🔮', 'wobble')} ${tr(`Đang so đời bạn với 1.000 cuộc đời khác… ${pctDone}%`, `Comparing your life with 1,000 others… ${pctDone}%`)}</p>
    <div class="lb-track"><span style="width:${Math.max(2, pctDone)}%"></span></div></div>`;
}

// The comparison runs in a background thread (parallel-worker.ts) so the page stays smooth; if workers
// are unavailable it runs here, in small steps.
let worker: Worker | undefined, jobId = 0;
function runParallel(life: Person): void {
  if (par?.life === life) return;
  const job = par = { life, progress: 0 } as NonNullable<typeof par>;
  const show = () => { if (par === job && document.getElementById('par')) $('par').innerHTML = parallelPanel(life); };
  const id = ++jobId;
  // The save as it stands now (the life has just ended): what the worker replays.
  const lives = saved.map((l, i) => i === saved.length - 1 ? { ...l, age: life.age, done: !life.alive } : l);
  try {
    worker ??= new Worker(new URL('./parallel-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; progress?: number; result?: Parallel; error?: string }>) => {
      if (e.data.id !== id) return;
      if (e.data.result) { job.result = e.data.result; show(); }
      else if (e.data.progress !== undefined) { job.progress = e.data.progress; show(); }
      else if (e.data.error) fallback();
    };
    worker.postMessage({ id, save: { v: MODEL_VERSION, lives }, n: PARALLEL_N, nWorld: PARALLEL_WORLD });
  } catch { fallback(); }
  function fallback(): void {
    parallelLives(world, life, sameStart, PARALLEL_N, PARALLEL_WORLD, f => { job.progress = f; show(); })
      .then(result => { job.result = result; show(); });
  }
}

function copyLink(): void {
  const link = shareLink();
  const done = () => { const b = document.getElementById('share'); if (b) b.innerHTML = `${ico('✅')}<span>${tr('Đã chép link', 'Link copied')}</span>`; };
  navigator.clipboard?.writeText(link).then(done, () => prompt(tr('Chép link này:', 'Copy this link:'), link));
}

/** A child's years before the played parent's death go by with the usual choices; play starts after. */
function takeOver(): void {
  if (!p || p.takeover === undefined) { scrollTo({ top: 0 }); return; }
  advance(p.takeover + 1 - p.age, true);
  scrollTo({ top: 0 });
}

function heirLabel(k: Kin): string {
  const sex = (k.sex === 'M' ? tr('Con trai', 'Son') : tr('Con gái', 'Daughter')) + (k.name ? ` ${k.name}` : '');
  return tr(`${sex}, ${k.age} tuổi`, `${sex}, ${k.age}`);
}

/** The family line as a little tree trunk: one card per generation (where, how long, schooling, children, net worth at the end). */
function lineageStrip(gens: Gen[]): string {
  if (gens.length < 2) return '';
  const cards = gens.map((g, i) => {
    const q = g.p, nw = q.money.lastNW, last = i === gens.length - 1;
    const school = schoolYearsDone(q);
    const lived = Math.floor(q.ageAtDeath ?? q.age);
    return `<li class="gen-card${last ? ' me' : ''}">
        <div class="gen-top"><span class="gen-face" aria-hidden="true">${avatar(q.b.sex, lived)}</span>
          <div><span class="gen-n">${tr(`Đời ${i + 1}`, `Gen ${i + 1}`)}</span>
          <p class="gen-who">${q.name ? `<b>${esc(q.name)}</b> · ` : ''}${esc(q.b.sex === 'F' ? tr('nữ', 'woman') : tr('nam', 'man'))}, <span class="flag sm" aria-hidden="true">${flag(q.c.iso2)}</span> ${esc(q.c.name[lang])}${q.residence ? ` → <span class="flag sm" aria-hidden="true">${flag(q.residence.c.iso2)}</span> ${esc(q.residence.c.name[lang])}` : ''}</p></div></div>
        <dl class="gen-stats">
          <div><dt>${tr('Thọ', 'Lived')}</dt><dd>${lived}</dd></div>
          <div><dt>${tr('Số năm học', 'School')}</dt><dd>${school}</dd></div>
          <div><dt>${tr('Con', 'Kids')}</dt><dd>${q.children.length}</dd></div>
          <div class="nw"><dt>${tr('Tài sản cuối đời', 'Net worth at death')}</dt><dd>${nw !== undefined ? esc(formatMoney(q.c, nw, lang)) : '–'}</dd></div>
        </dl>
      </li>`;
  }).join('');
  return `<h3 class="line-title">${ico('🌳')}${tr('Cây dòng họ', 'Your family tree')}</h3><ol class="family-line">${cards}</ol>`;
}

// ---------------------------------------------------------------- language and money display

function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l;
  $('title').textContent = GAME_TITLE[lang];
  document.title = GAME_TITLE[lang];
  renderSettings();
  if (p) { quiet = true; shown = 0; $('timeline').innerHTML = ''; render(); quiet = false; } else if (world) intro();
}


function applyMoney(v: MoneyView): void {
  moneyView = v;
  const id = v === 'VND' ? 'VNM' : v === 'USD' ? 'USA' : undefined;
  setDisplayCountry(id && world?.byId[id] ? world.byId[id].c : undefined);
}

function setMoney(v: MoneyView): void {
  applyMoney(v);
  renderSettings();
  try { localStorage.setItem(MONEY_STORE, v); } catch { /* blocked storage: the choice lasts this visit */ }
  if (!p) return;
  // Event texts were written with money already formatted: replay the line from the save to rewrite them.
  const y = scrollY;
  quiet = true;
  try { resume({ v: MODEL_VERSION, lives: saved }, par); } finally { quiet = false; }
  scrollTo({ top: y });
}

// Light / dark: follow the system, or force one (remembered in this browser).
type Theme = 'auto' | 'light' | 'dark';
let theme: Theme = (() => { try { const t = localStorage.getItem('one-life.theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; } })();
function applyTheme(): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
}
function setTheme(t: Theme): void {
  theme = t;
  try { localStorage.setItem('one-life.theme', theme); } catch { /* blocked storage: keep for this visit */ }
  applyTheme();
($('repo') as HTMLAnchorElement).href = REPO_URL;
  renderSettings();
}
applyTheme();

// ---------------------------------------------------------------- settings: language, money, theme
function renderSettings(): void {
  const group = <K extends string>(title: string, current: K, opts: [K, string][], kind: string) =>
    `<fieldset class="set-group"><legend>${esc(title)}</legend><div class="seg">${opts.map(([k, label]) =>
      `<button type="button" data-set="${kind}" data-v="${k}" aria-pressed="${k === current}">${esc(label)}</button>`).join('')}</div></fieldset>`;
  const panel = $('settings');
  panel.setAttribute('aria-label', tr('Cài đặt', 'Settings'));
  panel.innerHTML = `<p class="set-title">${tr('Cài đặt', 'Settings')}</p>`
    + group(tr('Ngôn ngữ', 'Language'), lang, [['vi', 'Tiếng Việt'], ['en', 'English']], 'lang')
    + group(tr('Tiền tệ', 'Money'), moneyView, [['local', tr('Theo nước đang sống', 'Local currency')], ['VND', 'VND'], ['USD', 'USD']], 'money')
    + (moneyView !== 'local' ? `<p class="set-note">${tr('Quy đổi theo sức mua', 'Converted at purchasing power')}</p>` : '')
    + group(tr('Giao diện', 'Theme'), theme, [['auto', tr('🖥️ Theo máy', '🖥️ System')], ['light', tr('☀️ Sáng', '☀️ Light')], ['dark', tr('🌙 Tối', '🌙 Dark')]], 'theme')
    + `<button type="button" class="about-btn" id="about-btn">📚 ${tr('Về dữ liệu', 'About the data')}</button>`;
  panel.querySelectorAll<HTMLButtonElement>('button[data-set]').forEach(b => {
    b.onclick = () => {
      const v = b.dataset.v!;
      if (b.dataset.set === 'lang' && v !== lang) setLang(v as Lang);
      else if (b.dataset.set === 'money' && v !== moneyView) setMoney(v as MoneyView);
      else if (b.dataset.set === 'theme' && v !== theme) setTheme(v as Theme);
    };
  });
  $('about-btn').onclick = () => { toggleSettings(false); openAbout(); };
  $('settings-btn').setAttribute('aria-label', tr('Cài đặt', 'Settings'));
  $('settings-btn').title = tr('Cài đặt', 'Settings');
  $('home').title = tr('Trang chính', 'Home');
}
/** "About the data": an overlay with the main sources and licences. */
function openAbout(): void {
  let ov = document.getElementById('about');
  if (!ov) { ov = document.createElement('div'); ov.id = 'about'; ov.className = 'about'; document.body.appendChild(ov); }
  ov.innerHTML = aboutHtml(lang);
  ov.hidden = false;
  const close = () => { ov!.hidden = true; $('settings-btn').focus(); };
  ov.onclick = e => { if (e.target === ov) close(); };
  $('about-close').onclick = close;
  ov.onkeydown = e => { if (e.key === 'Escape') close(); };
  $('about-close').focus();
}

function toggleSettings(open = $('settings').hidden): void {
  $('settings').hidden = !open;
  $('settings-btn').setAttribute('aria-expanded', String(open));
}
$('settings-btn').onclick = e => { e.stopPropagation(); toggleSettings(); };
// The title in the top-left corner goes back to the start screen (be born, or continue the saved line).
$('home').onclick = e => { e.preventDefault(); if (world) { pending = undefined; intro(); scrollTo({ top: 0 }); } };
// Clicks inside the panel keep it open (its buttons are redrawn on every change).
$('settings').onclick = e => e.stopPropagation();
document.addEventListener('click', e => {
  if (!$('settings').hidden && !$('settings').contains(e.target as Node)) toggleSettings(false);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('settings').hidden) { toggleSettings(false); $('settings-btn').focus(); } });
$('title').textContent = document.title = GAME_TITLE[lang];
renderSettings();
load().then(() => {
  $('loading').hidden = true;
  let m: string | null = null;
  try { m = localStorage.getItem(MONEY_STORE); } catch { /* storage blocked */ }
  if (m === 'VND' || m === 'USD') { applyMoney(m); renderSettings(); }
  // A shared link opens that family line; otherwise the start screen (which offers to continue).
  const shared = location.hash.startsWith('#d=') ? decodeSave(location.hash.slice(3)) : undefined;
  if (shared) history.replaceState(null, '', location.pathname);
  const mine = stored();
  // Opening someone else's family line replaces your saved one: ask first.
  if (shared && (!mine || JSON.stringify(mine.lives) === JSON.stringify(shared.lives)
    || confirm(tr('Mở dòng họ được chia sẻ sẽ thay cho dòng họ bạn đang chơi dở. Vẫn mở?', 'Opening this shared family line replaces the one you are playing. Open it anyway?')))) resume(shared);
  else intro();
})
  .catch(err => { $('loading').textContent = String(err); });
