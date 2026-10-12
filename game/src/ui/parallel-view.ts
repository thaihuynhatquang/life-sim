// End-of-life panel: the life just played against a thousand others (see sim/parallel.ts).

import type { Person } from '../sim/person.ts';
import { formatMoney } from '../sim/money.ts';
import { num, type Lang } from '../sim/i18n.ts';
import { meanOf, outcome, percentile, valuesOf, type Metric, type Parallel } from '../sim/parallel.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export function parallelHtml(p: Person, r: Parallel, lang: Lang): string {
  const tr = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const c = p.c, me = outcome(p);
  const fmt: Record<Metric, (x: number) => string> = {
    life: x => tr(`${num(x, 'vi', 1)} năm`, `${num(x, 'en', 1)} years`),
    school: x => tr(`${num(x, 'vi', 1)} năm`, `${num(x, 'en', 1)} years`),
    income40: x => formatMoney(c, x, lang) + tr('/tháng', '/month'),
    ladder: x => `${num(x, lang, 1)}/10`,
    kids: x => num(x, lang, 1),
  };
  const diff: Record<Metric, (x: number) => string> = {
    ...fmt,
    income40: x => `${x >= 0 ? '+' : ''}${num(100 * x, lang)}%`,
  };
  const label: Record<Metric, string> = {
    life: tr('Tuổi thọ', 'Lifespan'), school: tr('Số năm đi học', 'Years of school'),
    income40: tr('Thu nhập mỗi người trong nhà, tuổi 40', 'Household income per person at 40'),
    ladder: tr('Điểm hài lòng trung bình', 'Average life satisfaction'), kids: tr('Số con', 'Children'),
  };
  const icon: Record<Metric, string> = { life: '🎂', school: '📚', income40: '💰', ladder: '😊', kids: '🧸' };
  const rows = (['life', 'school', 'income40', 'ladder', 'kids'] as Metric[]).map(m => {
    const mine = me[m], same = meanOf(r.same, m), yours = meanOf(r.sameYours, m), world = meanOf(r.world, m);
    if (same === undefined || yours === undefined || world === undefined) return '';
    const share = mine === undefined ? undefined : 100 * percentile(valuesOf(r.same, m), mine);
    const pct = share === undefined ? '–' : tr(`hơn ${num(share, 'vi')}%`, `above ${num(share, 'en')}%`);
    // Income: relative differences (a shift of 50 PPP $ means little in Norway and a lot in Niger).
    const choice = m === 'income40' ? (yours - same) / same : yours - same;
    const start = m === 'income40' ? (same - world) / world : same - world;
    const sign = (x: number, s: string) => (x > 0 && !s.startsWith('+') ? '+' + s : s);
    const dir = (x: number) => (Math.abs(x) < 1e-9 ? 'zero' : x > 0 ? 'up' : 'down');
    return `<li class="pm">
      <div class="pm-head"><span class="pm-label"><span aria-hidden="true">${icon[m]}</span> ${esc(label[m])}</span>
        <span class="pm-you"><span class="sr">${esc(tr('Bạn', 'You'))}: </span>${mine === undefined ? '–' : esc(fmt[m](mine))}</span></div>
      ${share === undefined ? '' : `<div class="pm-bar" aria-hidden="true"><span class="pm-fill" style="width:${share.toFixed(1)}%"></span><span class="pm-dot" style="left:${share.toFixed(1)}%"></span></div>`}
      <div class="pm-sub">
        <span class="pm-pct">${esc(tr('So với cùng hoàn cảnh', 'Among the same start'))}: <b>${esc(pct)}</b></span>
        <span class="delta ${dir(choice)}">${esc(tr('Do lựa chọn', 'From your choices'))}: <b>${esc(sign(choice, diff[m](choice)))}</b></span>
        <span class="delta ${dir(start)}">${esc(tr('Do hoàn cảnh sinh', 'From your start'))}: <b>${esc(sign(start, diff[m](start)))}</b></span>
      </div></li>`;
  }).join('');

  const lifePct = percentile(valuesOf(r.same, 'life'), me.life);
  const choiceYears = (meanOf(r.sameYours, 'life') ?? 0) - (meanOf(r.same, 'life') ?? 0);
  const startYears = (meanOf(r.same, 'life') ?? 0) - (meanOf(r.world, 'life') ?? 0);
  const n = r.same.length;
  const lines = [
    tr(`So với những người có cùng hoàn cảnh lúc sinh, bạn sống lâu hơn ${num(100 * lifePct, 'vi')}% số người. ${lifePct < 0.35 ? 'Bạn kém may.' : lifePct > 0.65 ? 'Bạn may mắn.' : 'Vận may của bạn ở mức thường.'}`,
      `Among people with the same start in life, you outlived ${num(100 * lifePct, 'en')}% of them. ${lifePct < 0.35 ? 'You were unlucky.' : lifePct > 0.65 ? 'You were lucky.' : 'Your luck was about average.'}`),
    Math.abs(choiceYears) < 0.05
      ? tr('Bạn chọn như phần lớn người cùng hoàn cảnh, nên lựa chọn của bạn không làm tuổi thọ khác đi.', 'You chose as most people in your place do, so your choices did not change how long you lived.')
      : tr(`Lựa chọn của bạn ${choiceYears > 0 ? 'thêm' : 'bớt'} trung bình ${num(Math.abs(choiceYears), 'vi', 1)} năm tuổi thọ so với cách chọn thông thường.`,
        `Your choices ${choiceYears > 0 ? 'added' : 'took away'} ${num(Math.abs(choiceYears), 'en', 1)} years of life on average, compared with the usual choices.`),
    tr(`Hoàn cảnh lúc sinh ${startYears >= 0 ? 'cho bạn thêm' : 'lấy đi của bạn'} khoảng ${num(Math.abs(startYears), 'vi', 1)} năm so với một em bé bất kỳ trên thế giới.`,
      `Your start in life ${startYears >= 0 ? 'gave you' : 'cost you'} about ${num(Math.abs(startYears), 'en', 1)} years compared with any baby in the world.`),
  ];
  const luck = lifePct < 0.35 ? '🌧️' : lifePct > 0.65 ? '🍀' : '⛅';
  return `<div class="parallel card">
    <h3 class="q"><span aria-hidden="true">🔮</span> ${esc(tr('Đời bạn so với các cuộc đời khác có cùng hoàn cảnh lúc sinh', 'Your life against other lives with the same start'))}</h3>
    <div class="par-lines"><p><span class="luck" aria-hidden="true">${luck}</span>${lines.map(l => esc(l)).join(' ')}</p></div>
    <ul class="pms">${rows}</ul>
    <p class="seed">${esc(tr(
      `Cách tính: ${num(r.same.length, 'vi')} đời có cùng hoàn cảnh lúc sinh với bạn, chọn như phần lớn mọi người; cũng chừng ấy đời đó nếu chọn như bạn; và ${num(r.world.length, 'vi')} em bé sinh ngẫu nhiên trên thế giới. Thu nhập so theo trung vị, tính bằng phần trăm.`,
      `How: ${num(r.same.length, 'en')} lives with your start and the usual choices; the same lives with your choices; and ${num(r.world.length, 'en')} babies born anywhere in the world. Income compares medians, in percent.`))}</p>
  </div>`;
}
