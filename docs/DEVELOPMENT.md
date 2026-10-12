# Development notes

These are the project's original developer notes, moved here from `README.md` and translated when the project was opened. The source of every indicator and every assumption: [DATA_SOURCES.md](DATA_SOURCES.md).

> A life simulation: where you are born on Earth is "drawn" in the real proportions of births, then you live that whole life by the real statistics of that country.

## Structure

```
data/
  pipeline/   Python: download data, clean it, export JSON, check the model
  raw/        Raw downloads (not committed)
  out/        Processed data; the game reads from here
game/         TypeScript + Vite, runs entirely in the browser
```

## Requirements

- **Node.js 22.18 or newer** (developed on Node 24). The scripts in `game/scripts/` run `.ts` files directly with `node`, with no build step.
- **Python 3** for the pipeline. Almost everything uses the standard library; only `extract_china.py` needs `xlrd` (see `data/pipeline/requirements.txt`).

## Roadmap

1. [x] **Data**: World Bank WDI + UN WPP 2024, 158 countries, exported to `data/out/countries.json`
2. [x] **Core model**: life tables by age/sex (WPP), log-normal income from the Gini
3. [x] **Convergence checks**: run 10,000+ lives, compare with real data
4. [x] **Events**: bilingual (vi/en) event system, each event with conditions, probability, source
5. [x] **Interface**: birth certificate, yearly loop, decisions, end of life (text-only version)
6. [ ] **Community**: share a life you lived (share links exist), memorials

## Running the data pipeline

`data/out/` already contains the built data, so the pipeline only needs to be re-run to update the numbers. Some steps need files downloaded by hand into `data/raw/` (not committed); the required files are noted in the comments below and in each script's docstring.

```bash
cd data/pipeline
bash download_wpp.sh          # ~415 MB from UN, resumable
python fetch_worldbank.py
python extract_wpp.py          # needs the 4 WPP files in data/raw/wpp (see docs/DATA_SOURCES.md)
python extract_marriage.py     # needs data/raw/un/undesa_pd_2019_wmd_marital_status.xlsx
python fetch_ghe.py            # WHO causes of death via API (~3 min)
python fetch_ilo.py            # ILO labour participation by age
python fetch_dhs.py            # DHS child mortality by wealth quintile
python extract_migration.py    # UN DESA migrant stock (2 xlsx in data/raw/un) + UNHCR API
python extract_gdim.py         # World Bank intergenerational mobility (CSV in data/raw/gdim)
python fetch_who_ncd.py        # WHO diabetes, hypertension, obesity, alcohol use disorders
python extract_oldage.py       # UN SDG pensions + UN living arrangements of older persons
python fetch_earnings.py       # ILO earnings by occupation/age, World Bank PPP + CPI, CLDR currencies
python extract_wealth.py       # WID wealth (needs wid_all_data.zip in data/raw/wid) + Forbes billionaires
python fetch_tax.py            # OECD Taxing Wages + Global Revenue Statistics, ILO labour share
python extract_jst.py          # real yearly returns on shares, housing, bonds, deposits (Jordà-Schularick-Taylor; needs data/raw/jst/JSTdatasetR6.xlsx)
python fetch_ilo_work.py       # ILO occupations, sectors, status, informality
.venv/Scripts/python extract_china.py   # China 2020 census occupations -> ISCO (needs xlrd)
python build_countries.py     # -> data/out/countries.json
python build_causes.py        # -> data/out/causes.json
```

Not in the list above: `python extract_names.py` (common given names by country, from Wikipedia -> `data/out/names.json`).

Files to download by hand into `data/raw/`, collected from the scripts' docstrings:

| File | Needed by |
|---|---|
| `wpp/WPP2024_*.csv.gz` (4 files; `download_wpp.sh` fetches 3, `WPP2024_Fertility_by_Age1.csv.gz` comes from the same WPP download page) | `extract_wpp.py` |
| `un/undesa_pd_2019_wmd_marital_status.xlsx` | `extract_marriage.py` |
| `un/undesa_pd_2020_ims_stock_by_age_sex_and_destination.xlsx`, `un/undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx` | `extract_migration.py` |
| `un/undesa_pd_2026_living-arrangements-older-persons.xlsx` | `extract_oldage.py` |
| `gdim/GDIM_2023_03.csv` | `extract_gdim.py` |
| `wid/wid_all_data.zip` | `extract_wealth.py` |
| `jst/JSTdatasetR6.xlsx` (actually a Stata `.dta` file) | `extract_jst.py` |
| `china/B04*.xls` (China Population Census Yearbook 2020) | `extract_china.py` |

## Checking the model

```bash
cd game
node scripts/validate.ts          # core model, 200,000 lives -> game/reports/validation.txt
node scripts/validate-wealth.ts   # wealth distribution and billionaires (WID, Forbes)
node scripts/validate-life.ts     # full lives with events, 100,000 lives -> game/reports/validation-life.txt
node scripts/live.ts vi           # live one life in the terminal (vi|en) [seed] [ISO3]
node scripts/validate-dynasty.ts  # dynasty: parent-child schooling vs GDIM, exact inheritance
node scripts/validate-save.ts     # saves and share links replay exactly the same
```

The latest reports are in `game/reports/`.

## Playing

Text-only version, in the browser:

```
cd game
npm install
npm run dev      # opens http://localhost:5173
```

Vite serves `data/out/` directly as its static folder (`publicDir` in `game/vite.config.ts`). `npm run build` writes a static build to `game/dist/`.

## Conventions

- Every assumption without direct data has an `ASSUMPTION` note in the code (find them with `grep -rn ASSUMPTION game/src data/pipeline`) and is listed in `docs/DATA_SOURCES.md`.
- A player's default option must match the model's plan, so lives nobody plays come out exactly as before (validation reports unchanged).
- When a change alters how the model unfolds a life, bump `MODEL_VERSION` in `game/src/sim/save.ts`; an old save that replays differently then reports an error instead of showing a different life.
- In-game Vietnamese text follows the `.claude/skills/vietnamese-humanizer` skill.
