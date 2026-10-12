# Lifesim

*Simulate the life you could have had*

**Lifesim is a free, open-source life simulator that runs in your browser.** You are born as a random baby somewhere on Earth, with the real odds of every country, and live that life year by year. Every probability comes from real statistics (UN, World Bank, WHO, ILO, UNESCO and more), and the source is shown under each event. Play it in English or Vietnamese.

**Play:** link coming soon (Netlify). · **Data:** [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)

You are born somewhere in the world with real-world odds (country, sex, family circumstances), then live that life one year at a time: school, work, marriage, children, migration, illness, money, old age, death. When the life ends, you can carry on as one of your children. The game runs in the browser, in Vietnamese and English.

It belongs to the long-standing genre of text life simulators (BitLife and its many predecessors), and to the "birth lottery" thought experiment: *what would your life look like if you were born as a random baby today?* What it adds is the data: 158 countries, calibrated and checked against the statistics they come from.

> **Screenshot:** coming soon. The game has a scrapbook-style interface with light and dark themes and works on phones.

## How it works

**Birth lottery.** About 131 million children are born each year in the 158 countries covered (about 99.4% of the world's births). You are one of them, drawn in proportion to real births: India 17.8% of simulated births (UN: 17.7%), China 6.7% (6.8%), Nigeria 5.7% (5.7%). Your sex, your parents' ages, siblings and your family's living standard are drawn the same way.

**A year at a time.** Each year the model draws what happens from that country's numbers: survival from UN life tables, schooling from UNESCO completion rates, marriage and divorce from UN marriage data, work and earnings from ILO, chronic disease from WHO, wealth from the World Inequality Database. Family background shapes education, education shapes adult standing, standing shapes income, wealth and health. Each event shows the source it came from.

**Choices.** At the points where real lives branch you decide: stay in school, try for university and pick a field, smoke or quit, marry now or later, how many children, emigrate, how to hold savings (bank, shares, property, with real historical returns), play the lottery, start a business, exercise, buy health insurance, get screened, write a will, when to retire. The default option is what the model would have done anyway. Other options succeed with the odds real people in the same country have, and their consequences run through the same model.

**Dynasty.** When a life ends you can continue as one of your children, from the year the parent you played dies: the child has grown up in that household (with the usual choices), and inherits exactly the estate the parent left. The new life opens with a short summary, then you play on. Education passes between generations about as strongly as it does in that country (World Bank GDIM).

**Parallel lives.** The end screen replays your start 1,000 times to separate three things: **luck** (same start, usual choices: where your outcome falls in that spread), **your choices** (the same lives with your choices) and **your start in life** (500 babies born anywhere). It runs in a background thread, so the page stays smooth.

**Saves and share links.** A life is fully determined by its random seed and the options picked, so a save is a few hundred bytes and a share link replays the same lives exactly.

## Data

Main sources below. The full reference, with every indicator, how it is used and every assumption, is [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

| Source | Used for |
|---|---|
| UN World Population Prospects 2024 | Births by country, sex ratio, single-age life tables, age-specific fertility |
| World Bank WDI (incl. UNESCO UIS, WHO/UNICEF JMP, Global Findex) | GDP, Gini, poverty, school completion, utilities, bank accounts, health spending |
| World Bank GDIM 2023 | Parent–child correlation in schooling |
| WHO Global Health Estimates, WHO GHO / NCD-RisC | Causes of death; diabetes, hypertension, obesity, alcohol use, height, physical activity |
| DHS Program | Child mortality by household wealth |
| ILO / ILOSTAT | Labour participation, unemployment, occupations, informality, earnings |
| UN World Marriage Data 2019 | Age at marriage, divorce, widowhood |
| UN DESA Migrant Stock, UNHCR | Emigration, destinations, refugees, internal displacement |
| UN SDG database, UN DESA Living Arrangements 2026 | Pensions, contraception, living arrangements in old age |
| World Inequality Database + Forbes (via Wikipedia) | Wealth distribution and billionaires |
| OECD Taxing Wages, Global Revenue Statistics | Taxes on earnings |
| World Happiness Report (Gallup, via Our World in Data) | Life satisfaction (Cantril ladder) |
| Jordà–Schularick–Taylor Macrohistory Database | Real yearly returns on shares, housing, bonds, deposits |
| Literature estimates (cited in DATA_SOURCES.md) | Effects without per-country data: smoking risk, exercise, business survival, income dynamics |

Built data lives in `data/out/` (JSON, about 15 MB) and is committed, so the game runs without downloading anything.

## Validation

The model is checked by simulating large numbers of lives and comparing them with the source statistics. Numbers below are copied from `game/reports/` (100,000 full lives unless noted; "real" is the source value, births-weighted):

| Metric | Simulated | Real |
|---|---|---|
| Life expectancy | 70.4 | 70.2 (mean error per country 0.4 years) |
| Deaths before age 5, per 1,000 | 37.0 | 36.9 |
| Finished upper secondary, % | 44.0 | 43.6 |
| Children per woman (alive at 50) | 2.78 | 2.77 |
| Smokers at 30, % | 17.9 | 18.1 |
| Unemployed % of time, workers 25+ | 4.1 | 4.2 |
| Positive net worth at 50, % | 90.8 | 91.1 |
| Life satisfaction at 40 (0–10) | 5.1 | 5.1 |
| Heart disease, % of deaths | 16.0 | 16.0 (WHO) |
| Under-5 mortality, poorest vs richest fifth | 2.41× | 2.47× (DHS) |
| Occupation mix at 40 | | 0.2 points total variation distance from ILO |
| Parent–child schooling correlation (dynasty) | | mean error 0.05 over 13 countries vs GDIM |

The reports also list where the model is off and why. For example, widowed women at 62 come out at 24.2% vs 30.6% in surveys, because surveys reflect husbands who died under past, higher mortality while the simulation uses today's life tables. In the dynasty check, the US schooling correlation is 0.17 vs 0.42 in GDIM.

## Getting started

Requirements: Node.js 22.18 or newer.

```bash
cd game
npm install
npm run dev      # http://localhost:5173
```

To live one life in the terminal: `node scripts/live.ts en` (from `game/`).

Rebuilding the data needs Python 3 and several manual downloads into `data/raw/` (not committed). Pipeline order, required files and validation commands are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Project structure

```
data/
  pipeline/   Python (stdlib) scripts: download, clean, export JSON
  raw/        raw downloads (not committed)
  out/        built data the game loads
game/
  src/model/  core model: birth, life tables, income, wealth
  src/sim/    yearly simulation, choices, dynasty, parallel lives, saves
  src/ui/     text-based browser UI
  scripts/    validation and a terminal player
  reports/    validation reports
docs/         developer notes, data sources (English), licensing notes
```

## Limitations

- **The world is held at today's statistics.** A baby born now lives under current life tables, wages and divorce rates; later generations in a dynasty are not projected into the future.
- **Some countries are imputed.** Missing indicators take the median of similar countries (same region and income group); each imputed value is listed under `est` in `countries.json`. Taiwan, North Korea and Cuba are left out for lack of data.
- **Some effects are assumptions from the literature**, not per-country data: the mortality risk of smoking, the benefit of exercise, business survival curves (US data used everywhere), how much income moves from year to year, investment returns (16 advanced economies applied to all). Each one is marked `ASSUMPTION` in the code and listed in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
- **Correlations decide who, not how many.** National rates are matched; assumed correlations only affect which people end up with a given trait.
- The game is a model, not a forecast or advice. It shows how outcomes are distributed, not what will happen to a particular person.

## Contributing

Issues and pull requests are welcome, especially:

- better or newer data sources for a country or indicator;
- places where the simulation disagrees with a statistic you know;
- translations and wording.

A change to the model should keep the validation reports in line (run the scripts in `game/scripts/` and include the before/after numbers). New assumptions need a source or a clear `ASSUMPTION` note, and an entry in docs/DATA_SOURCES.md.

## License

- **Code and documentation:** [MIT](LICENSE).
- **Derived data in `data/out/`:** [CC BY-SA 4.0](data/out/LICENSE). The figures come from the third-party sources listed in [ATTRIBUTION.md](ATTRIBUTION.md), whose own terms still apply to the underlying data. Investment returns use only summary statistics computed from the Jordà-Schularick-Taylor Macrohistory Database (its data is CC BY-NC-SA 4.0 and is not redistributed).
- Details for every source, and what to check before any commercial use: [docs/LICENSING-NOTES.md](docs/LICENSING-NOTES.md).
