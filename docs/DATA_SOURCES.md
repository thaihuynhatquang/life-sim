# Data sources

Each country in `data/out/countries.json` has these fields:
- `src`: the source of each indicator
- `yr`: the year of the figure
- `est`: the list of indicators that are estimates (imputed, defaults, or entered by hand with low confidence)

## Coverage

158 countries and territories with a population of 1 million or more (UN WPP 2024, year 2023), accounting for **131.3 million births a year**, about 99.4% of births worldwide.

**Left out for now** because data are too sparse: Taiwan (not in the World Bank data), North Korea and Cuba (no GDP PPP and no Gini). Together these three account for less than 0.5% of births. See `EXCLUDE` in `build_countries.py`.

## Main sources

| Source | Used for | Notes |
|---|---|---|
| **UN World Population Prospects 2024** (`WPP2024`) | Population, births, sex ratio at birth, life expectancy by sex, infant and under-5 mortality, TFR, **age-specific fertility rates for each age 15–49 (ASFR)**, **life tables for each age 0–100** | Base year 2023 is the last estimated year; later years are projections. Life tables also keep the 1950–2020 benchmarks for a "past" mode. |
| **World Bank WDI** (`WB`) | GDP PPP (constant 2021 international USD), Gini, extreme poverty, agricultural employment, unemployment, maternal mortality, HIV, homicide, road traffic deaths, suicide, smoking, out-of-pocket health spending, years of schooling, tertiary education, literacy, electricity, clean water, internet, child marriage, urbanisation | Each indicator takes the latest value in 2005–2025. |
| **IMF World Economic Outlook** (`IMF-WEO`) | GDP PPP for countries the World Bank lacks: Eritrea, South Sudan, Venezuela, Yemen | Converted to constant 2021 USD with the median WB/IMF ratio over 150 countries (about 0.85). |
| **ILO** | Labour force participation by sex and age band 25–54, 55–64, 65+ (ILO modelled estimates 2024, via the ILOSTAT API): who works and the age people stop working; unemployment by sex and age 15–24, 25+ (ILO estimates) and the share of unemployed for more than 12 months (labour force surveys, 133 countries) → length of each unemployment spell; agricultural employment (via the World Bank) | `fetch_ilo.py`; the API needs browser-like headers. |
| **UNESCO UIS** (via the World Bank, `UIS.CR.1-3`) | Completion rates for primary, lower secondary, upper secondary, measured by household surveys by cohort | Median year 2014. Replaces "expected years of schooling" (HCI), which includes pre-primary. |
| **UN World Marriage Data 2019** (`UN-WMD2019`) | Share ever married by 5-year age group and sex (age at marriage, spousal age gap); share currently divorced/separated and widowed by age, from which yearly divorce and remarriage rates are fitted with a cohort flow model (141 countries with clean data) | 153/158 countries, median year 2015. Download `undesa_pd_2019_wmd_marital_status.xlsx` by hand into `data/raw/un/`. |
| **WHO Global Health Estimates** (`GHE_FULL`, year 2023) | Cause-of-death mix by country × sex × 5-year age group, 136 causes grouped into 66 display groups | Fetched via the public API `xmart-api-public.who.int`. |
| **DHS Program** (STATcompiler API, `CM_ECMR_C_U5M`) | Under-5 mortality by wealth quintile → the rich–poor gradient of child mortality for each country (β, median 0.25) | 64 countries (69% of births), latest survey since 2005. Countries without DHS use the median of DHS countries in the same region/income group. |
| **UN DESA International Migrant Stock** 2024 (by destination × origin, sex) and 2020 (by age) | Share of people born in each country who live abroad, main destinations, age at leaving | Downloadable with curl using browser headers. |
| **UNHCR Refugee Data Finder** (API, 2024) | Refugees and asylum seekers by country of origin (as a share of migrants); internally displaced people (IDP) | |
| **World Bank GDIM 2023** (Global Database on Intergenerational Mobility) | Parent–child correlation in education (cohort born in the 1980s): how much schooling depends on family background in each country | 128 countries (92% of births); CSV downloaded from the data catalog into `data/raw/gdim/`. |
| **WHO GHO / NCD-RisC** | Prevalence of diabetes (people aged 30+) and hypertension (30–79) by sex; share diagnosed and treated | `fetch_who_ncd.py`, 156 countries. Age at onset: constant incidence from age 30, fitted to match prevalence. |
| **Unicode CLDR** (via Node's `Intl.DisplayNames`) | Country names in Vietnamese and English | Some names fixed by hand in `NAME_OVERRIDES`. |

## Handling missing data (in order)

1. **Entered by hand** ([data/pipeline/overrides.json](../data/pipeline/overrides.json)): each figure has a source and a confidence level. Currently HIV prevalence for China, Russia, the US (not in the World Bank series).
2. **Defaults for high-income countries**: missing data there usually means the thing is too rare to be surveyed. Child marriage 1%, literacy 99%, HIV 0.1%, extreme poverty 0.5%.
3. **Median of the peer group**: same region and income group; if not enough, same region; if still not enough, the whole world.

## Known weaknesses

- **Homicide rate** is imputed for about 17 African countries (8% of births), including DR Congo.
- **HIV** is imputed for about 29 countries, mostly low-prevalence ones.
- **Gini** for some countries comes from old surveys, back to 2005.
- **HIV:** prevalence (UNAIDS) and HIV deaths among older people (WHO) are not fully consistent in a few countries such as Nigeria and Tanzania; the simulation matches prevalence and keeps total mortality right, so HIV deaths are slightly below WHO (1.1% vs 1.2% of deaths). Mortality risk does not yet distinguish people on ART from those untreated; age at infection is assumed to decline with age from 15 to 49.

## Work

- **National totals, by sex (ILO modelled estimates 2024):** mix of the 9 ISCO-08 major occupation groups (the ILO merges farmers with elementary occupations; the model splits them by the ratio in that country's survey), sector (agriculture / industry / services), status in employment.
- **Internal structure (ILO, latest labour force survey since 2010):** occupation × age band (15–24, 25–54, 55–64, 65+), occupation × education level, status × occupation, informality × status. All raked to match the 2024 totals.
- **China:** ILOSTAT has no survey after 2000, and the ILO estimates still carry the 2000 structure. Uses the **2020 Population Census** (table 4-7: 80 middle occupation groups × age × sex; table 4-2: education), mapped to ISCO-08 with the crosswalk in `extract_china.py` (about 25 groups have to be split by shares based on the occupation definitions; each row is annotated). Occupation × education in 2020 = the 2000 structure adjusted by IPF to the 2020 totals. Status and informality are borrowed from upper-middle-income countries.
- **Education (UNESCO):** share of tertiary graduates in 10 fields of study; share of upper-secondary students in vocational programmes.
- **Model:** occupation is a logit choice by education level, calibrated by age band to match the occupation × age mix exactly; each person has their own "propensity". Assumption: at each new age band, 30% of the propensity is redrawn (so some people change occupation; about 60% of workers change occupation group at least once). The industry/services split by occupation is an initial table of shares, calibrated to the ILO totals. Specific job titles are only for the story.

## Childhood, adulthood, old age

| Item | Source | How it is used |
|---|---|---|
| Sanitation, clean cooking, slums, birth registration | World Bank (WHO/UNICEF JMP, UN-Habitat, UNICEF) | By household at birth, linked to urban/rural and wealth; slums calibrated within the urban group |
| Bank account / mobile money | World Bank Global Findex | By sex; wealth gradient calibrated on the poorest 40% and richest 60%. Assumption: the account is opened between ages 15 and 30 |
| Obesity (BMI ≥ 30) | WHO GHO / NCD-RisC 2024 | Onset from age 18, matching the adult rate by sex |
| Alcohol use disorders | WHO GHO 2016 | Onset from age 15; deaths from alcohol use (WHO GHE) fall only on people with the disorder |
| Adult height | NCD-RisC (cohort born 1996) | Assumed within-country standard deviation 7 cm (men) / 6.5 cm (women); people stunted as children are in the lowest group |
| Pensions | UN SDG 1.3.1 (ILO) | People in formal work at age 40 come first; rates calibrated by country and sex |
| Who you live with in old age | UN DESA Living Arrangements of Older Persons 2026 | Shares for 65+ and 80+ by sex, turned into conditional probabilities (having a living adult child, a living spouse); assumes 95% of people with children have at least one child alive in old age |
| Grandchildren, great-grandchildren | UN ASFR | Children and grandchildren have children at the age-specific fertility rates of the country they live in |
| Dementia | WHO GHE (deaths from dementia) | Assumes 3–7 years living with the disease before death (Brodaty 2012) |

Not yet included: depression (WHO has no country figures through an open API). Left out by decision: domestic violence, female genital mutilation, child labour, imprisonment.

## Income and currency (layer 2, step 1)

- **Employee earnings:** ILO, average monthly earnings by sex × occupation (survey-year PPP USD converted to 2021 PPP with US CPI) and factors by age band; normalised so that average employee earnings in the simulation equal the ILO figure. 40 countries lack data: earnings = GDP per capita × the median earnings/GDP ratio of peer countries.
- **Assumptions:** individual pay differences within the same occupation (log standard deviation 0.4, independent of family background since background already acts through education and occupation); employers earn ×2, own-account workers ×0.6, contributing family workers unpaid (the ILO has no figures for non-employees); pension 50% of last earnings (average OECD replacement rate), social pension 30% of median income; spouses work at their sex's participation rate, with earnings from the national occupation mix.
- **Household living standard** (income per person) is not summed from wages, since household income also includes own production, remittances and transfers. It comes from the national income distribution (already matched to the poverty rate and Gini) at the person's rich–poor position.
- **Display:** local currency at current prices = 2021 PPP USD × the 2021 private consumption PPP factor (World Bank) × CPI growth since 2021; currency codes from Unicode CLDR. Venezuela and Yemen have no PPP factor, so they are shown in purchasing-power USD.

## Taxes on earnings

- **Source:** OECD Taxing Wages 2025 (36 countries): average rate of personal income tax plus employee social security contributions, on gross earnings, at 67%, 100%, 167% of the average wage (single person, no children).
- **Other countries:** OECD Global Revenue Statistics (personal income tax and employee social security contributions, as % of GDP), divided by the formal sector's share of labour income. Labour income is taken as its share of GDP (ILO modelled estimates). This figure is treated as the rate at the average wage; the 67% and 167% rates follow the OECD median ratios (0.83 and 1.21). Checked on the 36 countries with both sources: mean difference 5.4 percentage points.
- **Assumptions:** all personal income tax falls on wages; informal workers pay no tax and earn half as much as formal workers. Estimates above 35% are treated as unreliable (formal sector too small, e.g. Uganda and Mali come out above 50%). In that case, and for countries without data, the median of the same income group is used: low income 10%, lower-middle 15% (including India, Pakistan, Kenya), upper-middle 11%, high 24%. The Gulf states (no income tax, only social insurance for citizens) and Russia (13%) follow tax law (PwC Worldwide Tax Summaries).
- **Use:** only to show take-home pay; the household living standard is already after tax (World Bank). The tax rate is linear in log earnings between the benchmarks, extended beyond them with the nearest slope, never below 0 and never above 55%. Informal work and contributing family work: zero tax.

## Wealth and billionaires (layer 2, step 2a)

- **Distribution of adults' net wealth:** World Inequality Database (WID), wealth thresholds at 22 percentiles from the bottom to the top 0.01%, year 2024, 157 countries (converted to 2021 PPP USD with WID's PPP factor and US CPI). Missing country (Kosovo): the country in the same income group with the closest GDP, scaled by the GDP ratio.
- **Tail and billionaires:** Forbes list of March 2026 (3,428 billionaires, 66 matched countries). Above the top 0.01%, a Pareto law anchored at "1 billion USD corresponds to N/A people", where N is the Forbes billionaire count and A the number of people aged 20+ (WID). The model reproduces the billionaire count of all 66 countries exactly. WID points above the top 0.01% are not used, since WID splits couples' wealth equally and so cannot be compared with Forbes's list of individuals (the US top 0.001% is already above 1.3 billion USD for 2,600 people, while the US has only 989 billionaires).
- **Chance of becoming a billionaire as an adult** (people born in the real world): about 1 in 3 million; US 1 in 266,000, China 1 in 2 million, Vietnam 1 in 14 million.
- **Assumptions:** a person's wealth rank correlates 0.7 with adult standing (SCF, HFCS, LWS report 0.6–0.7); wealth changes with age following the life-cycle shape from household surveys (0.15 at age 20, peak 1.7 at 60–70, slight decline after), normalised so the population mean is 1. Health costs and inheritance: see step 3; divorce does not yet affect wealth.
- **Migrants' wealth** still follows the distribution of the country of birth.
- **Which country migrants follow (assumption):** all migrants find work, are unemployed, receive pensions and live their old age by the data of the country they live in (occupation, income, mortality, health costs, life satisfaction too). Children who leave before age 15 grow up by the norms of the new country: remaining schooling, age at marriage, divorce, fertility, smoking, whether they work, bank account, keeping the person's position in the distribution. Migrants who leave after 15 keep those norms from their country of birth. Chronic diseases (diabetes, hypertension, obesity, alcohol, HIV) still follow the country of birth because they are calibrated to that country's causes of death.

## Health costs (layer 2, step 3a)

- **Frequency:** World Bank/WHO (SDG 3.8.2): share of the population each year whose out-of-pocket health spending pushes them into poverty (`SH.UHC.FH40.IMPOV`) and share spending over 40% of their budget beyond essential needs (`SH.UHC.FH40.LARGE`). High-income countries without data: 0.3% and 3%.
- **Amount:** out-of-pocket spending per person in PPP (`SH.XPD.OOPC.PP.CD`). A large bill = κ × the person's yearly income, with κ chosen so that the simulation's total spending equals the country's out-of-pocket spending (bounded at 0.08–1.5 times yearly income).
- **Assumptions:** people with chronic diseases (diabetes, hypertension, HIV) get large bills 2.5 times as often; by age: under 5 ×1.5, 5–17 ×0.7, 18–64 ×1, 65+ ×2. The base frequency is normalised so the average (given the age structure and disease rates) equals the World Bank figure. Simulation: 22.6% of person-years with impoverishing costs (real 24.2%), 5.0% with large spending (5.3%).
- **Effect on wealth:** WID wealth already reflects average health spending, so only the difference between what the person paid and what someone of the same age and income pays on average is added to or subtracted from net wealth (the unlucky get poorer, the lucky richer, the national average is unchanged). Share with positive wealth at age 50: 90.4% (WID 91.1%).

## Inheritance (layer 2, step 3b)

- **Parents' wealth:** the parents' wealth rank correlates 0.7 with the family's income rank at your birth (same assumption as for adults); the value comes from the WID wealth distribution of the country of birth, at the parents' age (life-cycle shape). Debts are not inherited.
- **Division:** when the second parent dies, the wealth is split equally among all children (you and every sibling born). When one dies first, the other keeps everything (assumption, simplifying each country's inheritance law).
- **No double counting:** a person's WID wealth already includes the average inheritance. The expected amount at each age is computed from the life table (the same parental death probabilities as in the simulation); net wealth = WID wealth × (wealth + amount received) / (wealth + expected amount), so people whose parents are still alive are not pushed into debt. Mean wealth at age 50, simulation / WID: 1.03 (US 1.01, China 1.04, India 1.04). Share with positive wealth at age 50: 91.0% (WID 91.1%).
- **Saving** has no separate model: net wealth by age (life cycle) is already the result of saving.

## Living standard changing year to year → mortality (layer 2, step 4)

- **Living-standard score** (used for household income, the size of health bills and the probability of death) = a persistent part (family background in childhood, adult standing after 25) + a part that fluctuates each year. Assumption from panel studies of household income (Gottschalk & Moffitt 1994; PSID, BHPS, SOEP): 30% of differences are transitory, the transitory part has persistence 0.6/year, so the living-standard rank correlates 0.88 after 1 year and 0.70 after 10 years (in reality about 0.85–0.9 and 0.6–0.7).
- **Shocks:** a full year of unemployment pulls the score down by 0.5 standard deviations (job loss cuts household income by about 1/3–1/2, Davis & von Wachter 2011); an impoverishing health bill pulls it down by 0.5 (assumption). Shocks are measured against the person's own expectation, so the score keeps mean 0, variance 1, and mortality still matches the UN life tables without recalibration. All layer-1 indicators stay the same (life expectancy 70.2/70.2).
- **Result:** at ages 41–69, the death rate in the year after a shock (unemployment or an impoverishing health bill) is 14.9‰ vs 9.7‰ without a shock (~1.5 times, including the effect of chronic diseases). Research on job loss: mortality rises 50–100% in the following years (Sullivan & von Wachter 2009).
- **Not yet:** inheritance, divorce, widowhood do not yet affect the living-standard score.

## Life satisfaction (layer 2, step 5)

- **Question:** the Cantril ladder from the Gallup World Poll ("0 is the worst possible life, 10 the best possible, where are you?"), the question used in the World Happiness Report. Each country's mean comes from the WHR via Our World in Data, latest year since 2020, 145 countries. 13 missing countries take the median of the same income group and region. Migrants follow the level of the country they live in (WHR 2018: immigrants' satisfaction gradually approaches that of the new country).
- **Assumptions (coefficients from the literature):** +0.4 points per unit of log household income within a country (Deaton 2008, Stevenson & Wolfers 2013: 0.3–0.5); a full year of unemployment −0.5 beyond the income loss (WHR 2017); compared with married people: single −0.2, divorced −0.4, widowed −0.4; chronic disease −0.3. A calibration constant (−0.2, equal to the average of the effects above) keeps the national mean at the Gallup figure. Individual differences: a persistent part (standard deviation 1.5) and a yearly fluctuation (1.2).
- **Result:** the mean at ages 20, 40, 60 matches the WHR (5.1 vs 5.0–5.1; mean difference 0.1 points per country); within-country standard deviation 1.9 (Gallup is usually about 2); difference between the top and bottom 20% by standing 0.6 points. In very low countries (Afghanistan 1.4) the simulation is slightly higher because the score cannot go below 0.
- **Not yet:** the U-shaped curve by age, the effect of children, losing loved ones.

## Family at birth

Mother's age at birth follows the ASFR distribution (UN); father's age = mother's age + the median age gap at marriage (UN WMD); number of older/younger siblings from the ASFR totals before/after the mother's age, poorer families slightly larger (mean factor 1); older siblings must survive until you are born (life table).

## Other assumptions in the model

Assumptions are marked `ASSUMPTION` in the code (mostly under `game/src/sim/`):

- **Rich–poor mortality gap among adults** (`beta` in `mortality.ts`): children under 5 already follow each country's DHS; ages 5–14 take 80% of that; ages 15–64 0.25 and 65+ 0.15, giving a life-expectancy gap of 6–8 years between the richest and poorest groups in rich countries (close to what Chetty 2016 and OECD 2017 found).
- **Smoking doubles the risk of death** from age 30 (Jha et al., 2013), the same for all countries. Quitting is the player's choice (see the choices section). No open per-country source yet for relative risk or smoking rates by age.
- **Migration:** people who move for work are more educated than average (correlation 0.3, in the direction of OECD DIOC); after moving, mortality risk follows the country of residence, while fertility and marriage still follow the country of origin; no return migration yet. Forced displacement within the country: current rate, random age up to 60.
- **Divorce rate constant over the duration of marriage** (in reality higher in the first years); remarriage stops after age 64.
- **Age of starting to smoke** (15–22) and **first time online** (8–16, by today's internet use rate): no data by age yet.
- **Correlation levels** between wealth, urban residence, marriage… (the `rho` coefficients; family background → education already follows each country's GDIM). Each country's rates always match exactly; the assumptions only affect *who* has the trait.

## Player choices (layer 3, first set)

- **Principle:** a choice appears exactly when the model's plan is about to happen (leaving school, going to university, marrying, starting to smoke, emigrating). The default option is what the model already planned, so when nobody plays, results are identical to before (checked: validation reports unchanged). Other options succeed with the probability real people in the same country have; consequences run through the same model.
- **Staying in school:** chance of success = the share of people who reached that level who go on to the next milestone (primary, lower secondary, upper secondary; UNESCO). University entrance: share entering university among those who finish upper secondary. Field of study: the player chooses, shown with graduation shares by field (UNESCO). Assumption: the link between education and adult standing in the model is treated as causal when the player changes their schooling (Card 1999: causal estimates of returns to schooling are close to the ordinary correlation).
- **Smoking:** refusing always works. Quitting: each serious attempt has a 25% chance of success (assumption; West et al. 2015: 15–30% quit for 12 months with support); the extra mortality risk fades with a time constant of 10 years (Jha et al. 2013: quitting at 35–44 avoids ~90% of the extra risk).
- **Marriage:** accept, wait 3 years, or don't marry (forced child marriage offers no choice). **Wanted number of children:** once there are enough children, each possible pregnancy is avoided with probability = demand for family planning satisfied with modern methods (UN SDG 3.7.1; 120 countries with surveys, 38 countries take the median of the same income group).
- **Migration:** adults who get the chance (per the migration data) can stay; refugees and children have no choice.
- **Test of 20,000 lives always choosing "try harder"** (stay in school, sit the university exam, don't smoke, quit smoking) vs the default choices: 1.5 more years of schooling, university share 33% → 55%, wealth rank 0.50 → 0.54, life expectancy 70.3 → 71.7.

## Savings, investing and the lottery (layer 3, choices during life)

- **Real yearly returns:** Jordà–Schularick–Taylor Macrohistory Database R6 ("The Rate of Return on Everything", QJE 2019), 16 rich countries, 1950–2020, 1,101 country-years: shares average 8.2%/year (worst year −58%), housing 7.3% (including rent, worst −25%), bonds 2.8%, short-term deposits 0.7%. The downloaded file is in Stata format, read by `extract_jst.py`.
- **How it is computed:** WID wealth already reflects the returns most families get. A player who holds money differently draws one real historical year at random each year; their wealth earns the return of the chosen asset, while their extra yearly saving is the same as people of the same standing; when they spend down in old age, they spend at a rate on their own wealth.
- **Assumptions:** the usual portfolio is 60% housing, 25% deposits, 15% shares (close to the household asset mix in the ECB HFCS and Fed SCF surveys); every country uses the shared history of the 16 rich countries; a single house varies an extra 10%/year around the general index (Giacoletti 2021).
- **Result, wealth at 70 relative to someone holding money like everyone else** (about 1,750 lives per option): bank deposits median 0.21; shares median 1.14 but the worst 10% only 0.35 and the best 10% 5.1; housing median 1.37 (worst 10% 0.66).
- **Lottery:** prize structure and odds of Vietlott Mega 6/45 (jackpot 1/8,145,060, first prize 1/34,808, second prize 1/733, third prize 1/45), one ticket a week; rolling jackpots are not counted, so each ticket returns about 28% of its price. Assumption: a ticket costs 0.5% of the country's median monthly income per person.

- **Returns model (replaces the yearly rows):** the game does not ship the database's yearly rows. `extract_jst.py` fits a multivariate Student t to the log real returns of shares, housing and bills (means, covariances, 8 degrees of freedom for fat tails) and the game draws synthetic years from it. Check against the real rows (`game/scripts/validate-returns.ts`): yearly means match (shares 8.3% vs 8.2%, housing 7.3% vs 7.3%, deposits 0.7% vs 0.7%); bad years for shares (below -20%) 9.6% vs 10.7%; wealth at 70 relative to the usual mix, median: bank 0.20 vs 0.21, shares 1.18 vs 1.15, property 1.45 vs 1.37.
## Starting a business (choice during life)

- **When:** at ages 28, 38, 48 if working; reviewed every 5 years (keep, expand, sell).
- **Survival:** US BLS Business Employment Dynamics (about 80% after 1 year, 50% after 5 years, 35% after 10 years); after 10 years, 5% close each year. Assumption: used for all countries since other countries have no comparable series. New business density (World Bank, 143 countries) is only used as context.
- **Assumptions:** the owner draws the pay of an employee in the same occupation times a personal factor (median 0.75, Hamilton 2000); capital put in equals one year's pay; the firm's value varies each year (log standard deviation 0.5) and earns no more than average (Moskowitz & Vissing-Jørgensen 2002); closing loses the capital and about 6 months looking for work; a sale fetches 90% of value; stopping work means selling.
- **Result (3,000 lives, starting at 28):** 48% still operating after 5 years, 33% after 10 years. Wealth at 50 compared with being an employee: lower median, worst 10% negative (capital debt), richest 1% higher.

## Investing in children and giving them wealth (choices during life)

- **Paying for extra schooling** (asked when the first child is 6): each year, each child aged 6–17 costs 15% of one household member's income; 12 such years raise the child's education score by 0.25 standard deviations, scaled by the years actually invested. Assumption: meta-analyses of tutoring and school quality find learning gains of 0.2–0.4 standard deviations (Nickow, Oreopoulos & Quan 2020); the effect on years of schooling is taken smaller. Only has an effect when the player goes on to live that child's life.
- **Result (about 2,100 children per group):** years of schooling 9.7 → 10.7; university share 29% → 35%.
- **Giving children wealth at 60:** 10% or 30% of net wealth, split equally among living adult children; the child receives exactly that amount at the matching age in their own life, and the estate left when the parent dies is reduced accordingly.

## Health, will, retirement (choices during life)

- **School sports team (age 12):** only for the story; each school year has an 8% chance that the team wins the inter-school tournament (assumption, no data).
- **Regular exercise (ages 25 and 45):** share of adults insufficiently active per WHO (NCD_PAC, 158 countries; Vietnam 30%, India 49%, US 36%). Assumption: sufficiently active people have 0.75 times the mortality risk of inactive people (Ekelund et al. 2019, BMJ); the factor applied to the player is relative to the average person in that country, so someone choosing like everyone else is unaffected. Result: about 0.9 more years of life (4,000 lives).
- **Private health insurance (age 25):** assumes insurance pays 70% of each bill, premium equal to the average payout plus 20%. Result: years pushed into poverty by health bills 22.5% → 9.9%; wealth slightly lower because of premiums.
- **Cancer screening (age 50):** colorectal cancer deaths down 25% (screening trials), breast cancer down 20% with mammography (UK Independent Panel 2012). The effect on life expectancy is small (about 0.04 years) because these two cancers are a small share of deaths.
- **Will (age 65, with two or more adult children):** split equally or leave everything to one child; if that child dies first, split equally. Check: the named heir received the full estate in 905/905 cases. Forced heirship laws of individual countries are not yet modelled.
- **Retirement age (age 55):** as usual (per ILO), retire at 58, or work until 70.

## A more connected story

- **Losing a parent before 18** makes things harder for the family: the living standard drops as with a year of unemployment (assumption; a parent's death lowers household income, e.g. Case & Ardington 2006 on orphans in South Africa), measured against the chance of losing a parent that year, so national mortality and poverty still match.
- **Alcohol use disorder doubles the risk of divorce** (assumption, from couple follow-up studies such as Torvik et al. 2013), measured against the average married person (WHO alcohol use disorder rate), so national divorce rates still match the UN.
- **Health bills** name a drug only when the person is being treated; untreated disease becomes "a bout of complications".
- **Self-rated life score** comes with one or two of the biggest influences (income, job loss, marriage, illness), taken from the model's own coefficients.
- **Wealth rank** is computed from actual net wealth (including inheritance, investing, business), compared with all adults in the country.
- Re-checked after these changes: life expectancy 70.4 (UN 70.2), divorced at age 42 5.3% women / 3.2% men (UN 5.6% / 3.2%), other indicators unchanged.

## Names of people

- **Source:** Wikipedia, "List of most popular given names" (the 10 most common names by sex, compiled from national statistics offices and civil registries; some rows are names of babies born in a recent year, some of the whole population). All rows for a country are pooled and only the Latin-script form is kept. 107/158 countries, 77% of births. Table placeholders such as "NA" are dropped.
- **Countries without a list** borrow the names of a country with a close language and naming culture (chosen by hand, an assumption): Portuguese-speaking → Portugal; Muslim West Africa → Mali/Senegal; English-speaking Christian East and Southern Africa → Liberia; Lesotho, Eswatini, Botswana, Namibia → South Africa; the Gulf, Iraq, Yemen → Saudi Arabia; Syria, Palestine → Jordan; French-speaking Central Africa and Madagascar → France (the closest available, and the weakest match); Moldova → Romania; Laos → Thailand; Hong Kong, Singapore → China.
- **How names are chosen:** the person, parents and siblings from the country of birth; spouses and children from the country of residence; no two alike in a family; more common names come up more often. Names are picked with a fixed hash, not the shared random stream, so naming never changes how a life unfolds. In the next generation, the names of the parents, siblings and the person stay as they were.
- **Weaknesses:** most lists are names of recent babies, so grandparents and parents also carry "new" names; Central African countries borrow modern French names.

## Province or state of birth

- **Source:** GeoNames (CC BY 4.0): names of first-level administrative divisions (`admin1CodesASCII.txt`) and every populated place of 500 people or more (`cities500.zip`). 157/158 countries (Singapore has no provinces).
- **How it is drawn:** urban births pick a province weighted by the population of its places of 50,000 or more, rural births by the population of its smaller places. Emigrants get a province of the destination weighted by its urban population. Chosen by a fixed hash, so lives do not change; the next generation is born in the province the parent lives in.
- **Name only:** living conditions still follow the national data; there are no differences between provinces yet.
- **Weaknesses:** GeoNames misses many small villages in some countries (India, for example), so rural births can lean towards provinces with more recorded towns; most province names are GeoNames' English forms, except Viet Nam, which has a table of Vietnamese names (34 provinces and cities after the 2025 merger).

