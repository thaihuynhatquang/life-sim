// "About the data": where the numbers come from, and the licences (see ATTRIBUTION.md for the full list).

import type { Lang } from '../sim/i18n.ts';
import { REPO_URL } from './look.ts';

interface Src { vi: string; en: string; who: string; url: string }
const SOURCES: Src[] = [
  { vi: 'Dân số, sinh, tuổi thọ, bảng sống', en: 'Population, births, life expectancy, life tables', who: 'UN World Population Prospects 2024', url: 'https://population.un.org/wpp/' },
  { vi: 'Nguyên nhân tử vong', en: 'Causes of death', who: 'WHO Global Health Estimates', url: 'https://www.who.int/data/global-health-estimates' },
  { vi: 'Bệnh mạn tính, vận động, rượu', en: 'Chronic disease, exercise, alcohol', who: 'WHO Global Health Observatory, NCD-RisC', url: 'https://www.who.int/data/gho' },
  { vi: 'Thu nhập, nghèo, điện nước, tài khoản ngân hàng', en: 'Income, poverty, utilities, bank accounts', who: 'World Bank (WDI, Findex, GDIM)', url: 'https://data.worldbank.org/' },
  { vi: 'Đi học, ngành học', en: 'Schooling and fields of study', who: 'UNESCO Institute for Statistics', url: 'https://databrowser.uis.unesco.org/' },
  { vi: 'Việc làm, lương, thất nghiệp', en: 'Jobs, earnings, unemployment', who: 'ILOSTAT', url: 'https://ilostat.ilo.org/' },
  { vi: 'Kết hôn, sống cùng ai khi về già', en: 'Marriage, living arrangements in old age', who: 'UN DESA Population Division', url: 'https://www.un.org/development/desa/pd/' },
  { vi: 'Di cư, tị nạn', en: 'Migration and refugees', who: 'UN DESA International Migrant Stock, UNHCR', url: 'https://www.unhcr.org/refugee-statistics/' },
  { vi: 'Tài sản, tỷ phú', en: 'Wealth and billionaires', who: 'World Inequality Database; Forbes via Wikipedia', url: 'https://wid.world/' },
  { vi: 'Thuế trên tiền lương', en: 'Taxes on earnings', who: 'OECD Taxing Wages, Global Revenue Statistics', url: 'https://data-explorer.oecd.org/' },
  { vi: 'Mức độ hài lòng với cuộc sống', en: 'Life satisfaction', who: 'World Happiness Report (Gallup), Our World in Data', url: 'https://worldhappiness.report/' },
  { vi: 'Lãi đầu tư (mô hình thống kê của game)', en: 'Investment returns (the game\'s statistical model)', who: 'Jordà–Schularick–Taylor Macrohistory Database', url: 'https://www.macrohistory.net/database/' },
  { vi: 'Tuổi thọ doanh nghiệp', en: 'Business survival', who: 'US Bureau of Labor Statistics', url: 'https://www.bls.gov/bdm/' },
  { vi: 'Tên người, tỉnh/bang', en: 'Given names, provinces', who: 'Wikipedia; GeoNames', url: 'https://www.geonames.org/' },
];

export function aboutHtml(lang: Lang): string {
  const tr = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const rows = SOURCES.map(s => `<li><span class="ab-what">${tr(s.vi, s.en)}</span><a href="${s.url}" target="_blank" rel="noopener">${s.who}</a></li>`).join('');
  return `<div class="about-box" role="dialog" aria-modal="true" aria-labelledby="about-title">
    <button type="button" class="about-close" id="about-close" aria-label="${tr('Đóng', 'Close')}">✕</button>
    <h2 id="about-title">${tr('Về dữ liệu', 'About the data')}</h2>
    <p>${tr('Mọi xác suất trong trò chơi lấy từ số liệu thật của từng nước. Nguồn ghi ngay dưới mỗi sự kiện. Chỗ nào chưa có số liệu, trò chơi dùng giả định từ các nghiên cứu, ghi rõ trong tài liệu dự án.',
      'Every probability in the game comes from real data for each country, and the source is shown under each event. Where no data exists, the game uses assumptions from published research, listed in the project documentation.')}</p>
    <ul class="ab-list">${rows}</ul>
    <p class="ab-note"><a href="${REPO_URL}" target="_blank" rel="noopener">${tr('Mã nguồn trên GitHub', 'Source code on GitHub')}</a> · ${tr('Mã nguồn: giấy phép MIT. Dữ liệu đã xử lý: CC BY-SA 4.0. Mỗi nguồn giữ điều khoản riêng; xem ATTRIBUTION.md trong mã nguồn. Không tổ chức nào kể trên bảo trợ hay xác nhận trò chơi này.',
      'Code: MIT licence. Derived data: CC BY-SA 4.0. Each source keeps its own terms; see ATTRIBUTION.md in the repository. None of these organisations sponsors or endorses this game.')}</p>
  </div>`;
}
