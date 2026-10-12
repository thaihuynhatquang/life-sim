// Shapes of data/out/countries.json and data/out/lifetables.json.

export type Sex = 'M' | 'F';

export interface Country {
  id: string;
  iso2: string;
  name: { vi: string; en: string };
  region: string;
  income: string;
  lat: number | null;
  lon: number | null;
  pop: number;
  births: number;
  srb: number; // boys per 100 girls at birth
  le: number;
  le_m: number;
  le_f: number;
  imr: number; // per 1,000 live births
  u5mr: number; // per 1,000 live births
  tfr: number;
  mac: number; // mean age of mothers at childbirth
  ncd: {
    dm_prev: Record<Sex | 'T', number>; // diabetes, adults 30+ (WHO/NCD-RisC)
    dm_treat: Partial<Record<Sex | 'T', number>>; // share of people with diabetes on treatment
    ht_prev: Record<Sex | 'T', number>; // hypertension, adults 30-79
    ht_diag: Partial<Record<Sex | 'T', number>>; // share of people with hypertension who know it
    ht_treat: Partial<Record<Sex | 'T', number>>; // share on treatment
    inactive: Record<'M' | 'F' | 'T', number>; // share of adults with insufficient physical activity (WHO)
    obese: Record<Sex | 'T', number>; // BMI >= 30, adults 18+ (WHO/NCD-RisC 2024)
    aud: Record<Sex | 'T', number>; // alcohol use disorders, 12-month prevalence 15+ (WHO 2016)
  };
  edu_cor: number;
  height: Record<Sex, number>; // mean adult height, cm (NCD-RisC, born 1996)
  account: number; account_f: number; account_m: number; account_p40: number; account_r60: number; // Findex, %
  pension: Record<Sex, number>; // share above pensionable age receiving a pension (UN SDG 1.3.1)
  living: Record<Sex, Record<'65' | '80', { alone: number; couple: number; children: number; skip: number }>>; // UN DESA
  biz_density: number; // new business registrations per 1,000 people aged 15-64 (World Bank)
  fp_satisfied: number; // % of women wanting to avoid pregnancy who use modern methods (UN SDG 3.7.1)
  provinces?: { urban: [string, number][]; rural: [string, number][] }; // first-level divisions, population weights (GeoNames)
  names?: Record<Sex, string[]>; // common given names (Wikipedia list of most popular given names)
  ladder: number; // life satisfaction, Cantril ladder 0-10 (Gallup World Poll / World Happiness Report)
  tax: { r67: number; r100: number; r167: number }; // income tax + employee contributions, % of gross pay at 67/100/167% of the average wage
  earn: Record<Sex, { total: number; rel: number[]; age: Partial<Record<'15' | '25' | '55' | '65', number>> }>; // ILO, 2021 PPP $/month
  currency: string; // ISO 4217
  ppp2021?: number; // local currency per 2021 PPP $ (private consumption)
  cpi_ratio: number; // consumer prices now / 2021
  wealth: { grid: number[]; ppp: number[]; usd: number[]; adults: number; billionaires: number }; // WID net wealth thresholds + Forbes
  oop_imp: number; // % of people facing impoverishing out-of-pocket health spending each year (WHO/World Bank)
  oop_large: number; // % facing large but non-impoverishing spending
  oop_pc: number; // out-of-pocket health spending per person, PPP $ a year
  birth_reg: number; // % of births registered
  sanitation: number; // % with at least basic sanitation
  clean_fuel: number; // % cooking with clean fuels
  slum: number; // % of urban population in slums
  work: Record<Sex, {
    ocu: number[]; // ISCO-08 major groups 0..9, shares of employment (ILO modelled 2024; China: 2020 census)
    ocu_age: Record<'15' | '25' | '55' | '65', number[]>; // by age band (labour force survey)
    ocu_edu: Partial<Record<'LTB' | 'BAS' | 'INT' | 'ADV', number[]>>; // by education level (survey)
    status_ocu: Record<string, number[]>; // occupation -> [employee, employer, own-account, family worker]
    status: Record<'emp' | 'employer' | 'own' | 'family', number>;
    sector: Record<'agr' | 'ind' | 'ser', number>;
    informal?: number;
    informal_status?: Partial<Record<'emp' | 'employer' | 'own' | 'family', number>>;
  }>;
  fields: number[]; // tertiary graduates by field (10 ISCED-F broad fields, UNESCO)
  voc_upper: number; // % of upper secondary students in vocational programmes (UNESCO) // parent-child correlation in years of schooling (World Bank GDIM)
  u5_beta?: number; // wealth gradient of under-5 mortality (DHS), see mortality.ts
  asfr?: number[]; // births per woman per year, ages 15..49 (UN WPP)
  gdp_ppp: number; // constant 2021 international $
  gini: number; // 0..100
  pov_ext: number; // % below $3.00/day (2021 PPP)
  // All % unless noted; see data/pipeline/indicators.py for definitions.
  urban: number;
  electricity: number;
  water: number;
  internet: number;
  measles: number;
  stunting: number;
  school_exp: number; // expected years of school by age 18 (from age 4)
  tertiary: number; // gross enrollment, can exceed 100
  compl1: number; // % completing primary (UIS, survey-based)
  compl2: number; // % completing lower secondary
  compl3: number; // % completing upper secondary
  oos_primary: number; // % of primary-age children out of school
  child_marriage: number; // women 20-24 first married before 18
  marr: Record<Sex, number[]>; // share ever married at ages 15-19 ... 45-49 (UN World Marriage Data)
  marr_status: Record<Sex, { div: number[]; wid: number[] }>; // shares of the ever-married divorced/separated and widowed, ages 20-24 ... 60-64
  agr_emp: number;
  unemp: number;
  flfp: number;
  mlfp: number;
  lfp_age: Record<Sex, { p25: number; p55: number; p65: number }>; // labour force participation by age (ILO modelled)
  unemp_age: Record<Sex, { u15: number; u25: number }>; // unemployment rate, ages 15-24 and 25+ (ILO modelled)
  ltu: number; // share of the unemployed out of work 12+ months (ILO labour force surveys)
  smoke_m: number;
  smoke_f: number;
  mmr: number; // per 100,000 live births
  road: number; // per 100,000 people
  homicide: number;
  suicide: number;
  hiv: number; // % of ages 15-49 living with HIV
  hiv_fshare?: number; // women's % of adults living with HIV
  art: number; // % of people with HIV on treatment
  mig?: {
    abroad: Record<Sex, number>; // share of people born here living abroad (UN DESA 2024)
    dest: [string, number][]; // main destinations and their shares of emigrants
    refugee_share: number; // refugees + asylum seekers as a share of emigrants (UNHCR)
    idp: number; // internally displaced people as a share of the population (UNHCR)
    age_cum: [number, number][]; // share of eventual emigrants who have left by each age
  };
  [indicator: string]: unknown;
  yr: Record<string, number>;
  src: Record<string, string>;
  est: string[];
}

/** iso3 -> sex -> year -> qx for ages 0..100 (qx[100] = 1). */
export type LifeTables = Record<string, Record<Sex, Record<string, number[]>>>;
