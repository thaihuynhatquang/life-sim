"""Merge UN WPP + World Bank (+ IMF for GDP gaps) into data/out/countries.json, the file the game loads.

Rules:
- Universe: WPP countries with population >= MIN_POPULATION.
- Demography (births, life expectancy, child mortality, fertility) comes from WPP; everything else from WB.
- GDP per capita PPP missing in WB -> IMF WEO PPPPC rescaled to WB's constant-2021 dollars.
- Any other missing indicator -> median of countries in the same region and income group (then region,
  then world). Imputed keys are listed in `est` so the game and the docs can say "estimated".

Usage: python build_countries.py   (after fetch_worldbank.py and extract_wpp.py)
"""

import json
import math
import statistics
import subprocess
import urllib.request
from pathlib import Path

from indicators import MIN_POPULATION, WB_INDICATORS

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
OUT = ROOT / "out"

WPP_KEYS = ["pop", "births", "srb", "le", "le_m", "le_f", "imr", "u5mr", "tfr", "mac", "asfr"]
WB_KEYS = [k for k in WB_INDICATORS if k not in WPP_KEYS and k != "cbr"]

# Left out until we have decent data for them (together < 0.5% of world births).
EXCLUDE = {
    "TWN": "not in World Bank; most social indicators would be peer medians",
    "PRK": "no GDP, poverty, inequality or internet data",
    "CUB": "no PPP GDP or inequality data",
}

META_OVERRIDES: dict = {}

# CLDR names that read oddly in a game. Everything else comes from Intl.DisplayNames (Unicode CLDR).
NAME_OVERRIDES = {
    "COD": {"vi": "CHDC Congo", "en": "DR Congo"},
    "COG": {"vi": "Cộng hòa Congo", "en": "Republic of the Congo"},
    "CIV": {"vi": "Bờ Biển Ngà", "en": "Côte d'Ivoire"},
    "PSE": {"vi": "Palestine", "en": "Palestine"},
    "MMR": {"vi": "Myanmar", "en": "Myanmar"},
    "HKG": {"vi": "Hồng Kông", "en": "Hong Kong"},
    "MAC": {"vi": "Ma Cao", "en": "Macao"},
    "ARE": {"vi": "UAE", "en": "United Arab Emirates"},
    "CZE": {"vi": "Cộng hòa Séc", "en": "Czechia"},
    "BIH": {"vi": "Bosnia và Herzegovina", "en": "Bosnia and Herzegovina"},
    "TTO": {"vi": "Trinidad và Tobago", "en": "Trinidad and Tobago"},
}


def load(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


# Missing in high-income countries usually means "too rare to survey", not "like the regional median".
HIGH_INCOME_DEFAULTS = {
    "child_marriage": (1.0, "rare in high-income countries (UNICEF)"),
    "literacy": (99.0, "near-universal in high-income countries"),
    "hiv": (0.1, "low-prevalence high-income country (UNAIDS)"),
    "pov_ext": (0.5, "high-income country"),
    "stunting": (2.0, "rare in high-income countries (UNICEF/WHO JME)"),
    "oos_primary": (1.0, "near-universal primary enrollment in high-income countries"),
    "birth_reg": (100.0, "universal civil registration in high-income countries"),
    "sanitation": (99.0, "near-universal sanitation in high-income countries"),
    "clean_fuel": (100.0, "near-universal clean cooking in high-income countries"),
    "slum": (0.0, "high-income country"),
    "oop_imp": (0.3, "high-income countries with universal coverage: ~0.3% (WHO/World Bank UHC report)"),
    "oop_large": (3.0, "high-income countries: a few percent face large out-of-pocket spending"),
}


def imf_pppc() -> dict:
    """IMF WEO GDP per capita, PPP (current international $): {iso3: {year: value}} for years <= 2025 (2025 = IMF estimate)."""
    path = RAW / "imf_pppc.json"
    if not path.exists():
        with urllib.request.urlopen("https://www.imf.org/external/datamapper/api/v1/PPPPC", timeout=120) as r:
            path.write_bytes(r.read())
    data = json.loads(path.read_text(encoding="utf-8"))["values"]["PPPPC"]
    return {iso3: {int(y): v for y, v in s.items() if v is not None and int(y) <= 2025} for iso3, s in data.items()}


def names(iso2s: list) -> dict:
    js = (
        "const v=new Intl.DisplayNames(['vi'],{type:'region'}),e=new Intl.DisplayNames(['en'],{type:'region'});"
        "const ids=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        "console.log(JSON.stringify(Object.fromEntries(ids.map(c=>[c,{vi:v.of(c),en:e.of(c)}]))))"
    )
    r = subprocess.run(["node", "-e", js], input=json.dumps(iso2s), capture_output=True, text=True,
                       encoding="utf-8", check=True)
    return json.loads(r.stdout)


def main():
    wpp = load("wpp_demo.json")
    wb = load("wb_all.json")
    imf = imf_pppc()

    universe = sorted(k for k, v in wpp.items() if v["pop"] >= MIN_POPULATION and k not in EXCLUDE)
    nm = names([wpp[k]["iso2"] for k in universe])

    # IMF PPPPC is in current dollars; WB gdp_ppp in constant 2021 dollars. Rescale by the median ratio
    # over countries that have both for the same year.
    ratios = [wb[k]["gdp_ppp"] / imf[k][wb[k]["gdp_ppp_yr"]] for k in universe
              if k in wb and "gdp_ppp" in wb[k] and wb[k]["gdp_ppp_yr"] in imf.get(k, {})]
    imf_k = statistics.median(ratios)
    overrides = {k: v for k, v in json.loads((Path(__file__).parent / "overrides.json").read_text(encoding="utf-8")).items()
                 if not k.startswith("_")}

    countries = {}
    for iso3 in universe:
        w, b = wpp[iso3], {**wb.get(iso3, {}), **META_OVERRIDES.get(iso3, {})}
        c = {
            "id": iso3,
            "iso2": w["iso2"],
            "name": NAME_OVERRIDES.get(iso3, nm[w["iso2"]]),
            "region": b.get("wb_region"),
            "income": b.get("wb_income"),
            "lat": b.get("lat"),
            "lon": b.get("lon"),
            "yr": {},
            "src": {},
            "est": [],
        }
        for k in WPP_KEYS:
            if k not in w:
                continue
            c[k] = w[k]
            c["src"][k] = "WPP2024"
            c["yr"][k] = 2023
        for k in WB_KEYS:
            if k in b:
                c[k] = b[k]
                c["src"][k] = "WB"
                c["yr"][k] = b[f"{k}_yr"]
        if "gdp_ppp" not in c and imf.get(iso3):
            yr = max(imf[iso3])
            c["gdp_ppp"] = round(imf[iso3][yr] * imf_k, 1)
            c["src"]["gdp_ppp"] = "IMF-WEO"
            c["yr"]["gdp_ppp"] = yr
        for k, o in overrides.get(iso3, {}).items():
            if k not in c or c["src"].get(k) == "IMF-WEO":
                c[k] = o["value"]
                c["src"][k] = "manual"
                if o["confidence"] == "low":
                    c["est"].append(k)
        if c["income"] == "High income":
            for k, (v, _why) in HIGH_INCOME_DEFAULTS.items():
                if k not in c:
                    c[k] = v
                    c["src"][k] = "default-high-income"
                    c["est"].append(k)
        countries[iso3] = c

    # Impute remaining gaps from peers.
    def peers(c, same_income: bool):
        return [o for o in countries.values() if o is not c and o["region"] == c["region"]
                and (not same_income or o["income"] == c["income"])]

    for k in WB_KEYS:
        for c in countries.values():
            if k in c:
                continue
            for group in (peers(c, True), peers(c, False), list(countries.values())):
                vals = [o[k] for o in group if k in o and k not in o["est"]]
                if len(vals) >= 3:
                    c[k] = round(statistics.median(vals), 3)
                    c["est"].append(k)
                    c["src"][k] = "imputed"
                    break

    # Ever-married curves by age group (UN World Marriage Data 2019); peers' median curve if missing.
    marriage_path = OUT / "marriage.json"
    if marriage_path.exists():
        marriage = json.loads(marriage_path.read_text(encoding="utf-8"))
        for c in countries.values():
            m = marriage.get(c["id"], {})
            if all("ever" in m.get(s, {}) for s in ("F", "M")):
                c["marr"] = {"F": m["F"]["ever"], "M": m["M"]["ever"]}
                c["src"]["marr"] = "UN-WMD2019"
                c["yr"]["marr"] = m["F"]["year"]
            if all("status" in m.get(s, {}) for s in ("F", "M")):
                c["marr_status"] = {s: {"div": m[s]["status"]["div"], "wid": m[s]["status"]["wid"]} for s in ("F", "M")}
                c["src"]["marr_status"] = "UN-WMD2019"
                c["yr"]["marr_status"] = m["F"]["status"]["year"]
        for c in countries.values():
            if "marr" in c:
                continue
            for group in (peers(c, True), peers(c, False)):
                curves = [o["marr"] for o in group if "marr" in o and "marr" not in o["est"]]
                if len(curves) >= 3:
                    c["marr"] = {s: [round(statistics.median(x[s][i] for x in curves), 4) for i in range(7)] for s in ("F", "M")}
                    c["src"]["marr"] = "imputed"
                    c["est"].append("marr")
                    break
        for c in countries.values():
            if "marr_status" in c:
                continue
            for group in (peers(c, True), peers(c, False)):
                st = [o["marr_status"] for o in group if "marr_status" in o and "marr_status" not in o["est"]]
                if len(st) >= 3:
                    c["marr_status"] = {s: {k: [round(statistics.median(x[s][k][i] for x in st), 4) for i in range(9)]
                                            for k in ("div", "wid")} for s in ("F", "M")}
                    c["src"]["marr_status"] = "imputed"
                    c["est"].append("marr_status")
                    break
    # Child mortality wealth gradient from DHS (beta per country; noisy small surveys clamped).
    dhs_path = OUT / "dhs.json"
    if dhs_path.exists():
        dhs = json.loads(dhs_path.read_text(encoding="utf-8"))
        for c in countries.values():
            if c["id"] in dhs:
                c["u5_beta"] = min(0.6, max(0.05, dhs[c["id"]]["beta"]))
                c["u5_ratio"] = dhs[c["id"]]["ratio"]  # poorest / richest fifth, raw survey
                c["src"]["u5_beta"] = "DHS"
                c["yr"]["u5_beta"] = dhs[c["id"]]["year"]
        measured = [c for c in countries.values() if c["src"].get("u5_beta") == "DHS"]
        for c in countries.values():
            if "u5_beta" in c:
                continue
            for group in ([o for o in measured if o["region"] == c["region"] and o["income"] == c["income"]],
                          [o for o in measured if o["region"] == c["region"]],
                          [o for o in measured if o["income"] == c["income"]],
                          [o for o in measured if o["income"] == "Upper middle income"]):
                if len(group) >= 3:
                    c["u5_beta"] = round(statistics.median(o["u5_beta"] for o in group), 3)
                    c["src"]["u5_beta"] = "imputed"
                    c["est"].append("u5_beta")
                    break
        print(f"u5_beta: {len(measured)} from DHS, {sum(1 for c in countries.values() if c['src'].get('u5_beta') == 'imputed')} imputed")

    # Emigration, destinations, refugees, internal displacement (UN DESA migrant stock 2024, UNHCR 2024).
    mig_path = OUT / "migration.json"
    if mig_path.exists():
        mig = json.loads(mig_path.read_text(encoding="utf-8"))
        # Age profile -> cumulative share of eventual emigrants who have left by each age (world, 2020):
        # migrants as % of population by age, relative to its plateau at ages 35-44.
        prof, ages = mig["age_profile"], mig["age_groups"]
        plateau = max(prof[:10])
        age_cum = [[0, 0.0]] + [[a + 2.5, round(min(1.0, v / plateau), 3)] for a, v in zip(ages[:10], prof[:10])]
        for i in range(1, len(age_cum)):
            age_cum[i][1] = max(age_cum[i][1], age_cum[i - 1][1])
        age_cum[-1][1] = 1.0
        for c in countries.values():
            m = mig["countries"].get(c["id"])
            if m:
                c["mig"] = {**m, "age_cum": age_cum}
                c["src"]["mig"] = "UN-DESA-IMS2024+UNHCR"
                c["yr"]["mig"] = 2024

    # Educational mobility: parent-child correlation in years of schooling (World Bank GDIM 2023).
    gdim_path = OUT / "gdim.json"
    if gdim_path.exists():
        gdim = json.loads(gdim_path.read_text(encoding="utf-8"))
        for c in countries.values():
            if c["id"] in gdim:
                c["edu_cor"] = gdim[c["id"]]["cor"]
                c["src"]["edu_cor"] = "WB-GDIM"
                c["yr"]["edu_cor"] = gdim[c["id"]]["cohort"]
        for c in countries.values():
            if "edu_cor" in c:
                continue
            for group in (peers(c, True), peers(c, False), list(countries.values())):
                vals = [o["edu_cor"] for o in group if "edu_cor" in o and "edu_cor" not in o["est"]]
                if len(vals) >= 3:
                    c["edu_cor"] = round(statistics.median(vals), 3)
                    c["src"]["edu_cor"] = "imputed"
                    c["est"].append("edu_cor")
                    break

    # Diabetes and hypertension: prevalence and care by sex (WHO GHO / NCD-RisC).
    ncd_path = OUT / "ncd.json"
    if ncd_path.exists():
        ncd = json.loads(ncd_path.read_text(encoding="utf-8"))
        keys = ("dm_prev", "dm_treat", "ht_prev", "ht_diag", "ht_treat", "obese", "aud", "inactive")
        for c in countries.values():
            v = ncd.get(c["id"], {})
            if all(k in v for k in keys):
                c["ncd"] = {k: v[k] for k in keys}
                c["src"]["ncd"] = "WHO-GHO"
        for c in countries.values():
            if "ncd" in c:
                continue
            for group in (peers(c, True), peers(c, False)):
                vals = [o["ncd"] for o in group if "ncd" in o and "ncd" not in o["est"]]
                if len(vals) >= 3:
                    c["ncd"] = {k: {s: round(statistics.median(x[k][s] for x in vals if s in x[k]), 4) for s in ("M", "F", "T")} for k in keys}
                    c["src"]["ncd"] = "imputed"
                    c["est"].append("ncd")
                    break

    # Work: occupations, sectors, status, informality (ILOSTAT; China from its 2020 census), and
    # education tracks (UNESCO: tertiary graduates by field, vocational upper secondary).
    work_path = OUT / "work.json"
    if work_path.exists():
        work = json.loads(work_path.read_text(encoding="utf-8"))
        STRUCT = ("ocu", "ocu_age", "ocu_edu", "status_ocu", "status", "sector", "informal", "informal_status")
        for c in countries.values():
            w = work.get(c["id"], {})
            c["work"] = {s: {k: w[s][k] for k in STRUCT if k in w.get(s, {})} for s in "MF"}
            c["src"]["work"] = "ILOSTAT" if c["id"] != "CHN" else "NBS-census-2020+ILOSTAT"
            c["yr"]["work"] = w.get("year", {})
            # The model's merged 6+9 group, kept to split with a peer 6:9 ratio if the survey is missing.
            c["_ocu96"] = {s: w.get(s, {}).get("_ocu96") for s in "MF"}

        def median_struct(vals):
            """Element-wise median of nested lists/dicts of numbers; lists renormalised to sum 1."""
            first = vals[0]
            if isinstance(first, dict):
                keys = set.intersection(*(set(v) for v in vals))
                return {k: median_struct([v[k] for v in vals]) for k in keys}
            if isinstance(first, list):
                m = [statistics.median(v[i] for v in vals) for i in range(len(first))]
                t = sum(m)
                return [round(x / t, 5) for x in m] if t > 0 else m
            return round(statistics.median(vals), 4)

        imputed = {}
        for key in STRUCT:
            for c in countries.values():
                for sex in "MF":
                    if key in c["work"][sex]:
                        continue
                    if key == "ocu" and c["_ocu96"][sex]:
                        # Split the model's 6+9 with the peers' survey ratio.
                        m96 = c["_ocu96"][sex]
                        for group in (peers(c, True), peers(c, False), list(countries.values())):
                            r = [o["work"][sex]["ocu"][6] / (o["work"][sex]["ocu"][6] + o["work"][sex]["ocu"][9])
                                 for o in group if "ocu" in o["work"][sex] and "work.ocu" not in o["est"]]
                            if len(r) >= 3:
                                r6 = statistics.median(r)
                                raw = {**{k: m96.get(k, 0) for k in "1234578"}, "6": m96["96"] * r6, "9": m96["96"] * (1 - r6)}
                                t = sum(raw.values())
                                c["work"][sex]["ocu"] = [0.0] + [round(raw[k] / t, 5) for k in "123456789"]
                                break
                    else:
                        # Labour market structure follows income level more than geography.
                        same_income = [o for o in countries.values() if o is not c and o["income"] == c["income"]]
                        for group in (peers(c, True), same_income, peers(c, False), list(countries.values())):
                            vals = [o["work"][sex][key] for o in group if key in o["work"][sex] and f"work.{key}" not in o["est"]]
                            if len(vals) >= 3:
                                c["work"][sex][key] = median_struct(vals)
                                break
                    if f"work.{key}" not in c["est"]:
                        c["est"].append(f"work.{key}")
                    imputed.setdefault(key, set()).add(c["id"])
        for c in countries.values():
            c.pop("_ocu96", None)
        births = sum(c["births"] for c in countries.values())
        for key, ids in imputed.items():
            print(f"work.{key:16s} imputed for {len(ids):3d} countries ({sum(countries[i]['births'] for i in ids) / births:.0%} of births)")

    # Tertiary field of study shares (renormalised over the 10 named fields) and vocational track.
    FIELDS = ["fld_edu", "fld_arts", "fld_soc", "fld_bus", "fld_sci", "fld_ict", "fld_eng", "fld_agr", "fld_hlth", "fld_serv"]
    for c in countries.values():
        b = wb.get(c["id"], {})
        if all(f in b for f in FIELDS) and sum(b[f] for f in FIELDS) > 0:
            t = sum(b[f] for f in FIELDS)
            c["fields"] = [round(b[f] / t, 4) for f in FIELDS]
            c["src"]["fields"] = "UNESCO-UIS"
            c["yr"]["fields"] = max(b[f"{f}_yr"] for f in FIELDS)
        if "voc_upper" in b:
            c["voc_upper"] = b["voc_upper"]
            c["src"]["voc_upper"] = "UNESCO-UIS"
    for key in ("fields", "voc_upper"):
        for c in countries.values():
            if key in c:
                continue
            for group in (peers(c, True), peers(c, False), list(countries.values())):
                vals = [o[key] for o in group if key in o and key not in o["est"]]
                if len(vals) >= 3:
                    if key == "fields":
                        m = [statistics.median(v[i] for v in vals) for i in range(10)]
                        c[key] = [round(x / sum(m), 4) for x in m]
                    else:
                        c[key] = round(statistics.median(vals), 2)
                    c["src"][key] = "imputed"
                    c["est"].append(key)
                    break
    print("fields imputed:", sum(1 for c in countries.values() if c["src"].get("fields") == "imputed"),
          "| voc_upper imputed:", sum(1 for c in countries.values() if c["src"].get("voc_upper") == "imputed"))

    # Adult height by sex, most recent birth cohort (NCD-RisC 2016, born 1996).
    height_path = RAW / "ncdrisc" / "height.csv"
    if height_path.exists():
        import csv
        h = {}
        with open(height_path, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                if r["Year of birth"] == "1996":
                    h.setdefault(r["ISO"], {})["M" if r["Sex"] == "Men" else "F"] = round(float(r["Mean height (cm)"]), 1)
        for c in countries.values():
            if c["id"] in h and len(h[c["id"]]) == 2:
                c["height"] = h[c["id"]]
                c["src"]["height"] = "NCD-RisC"
        for c in countries.values():
            if "height" not in c:
                for group in (peers(c, True), peers(c, False)):
                    vals = [o["height"] for o in group if "height" in o and "height" not in o["est"]]
                    if len(vals) >= 3:
                        c["height"] = {s: round(statistics.median(v[s] for v in vals), 1) for s in "MF"}
                        c["src"]["height"] = "imputed"
                        c["est"].append("height")
                        break

    # Old age: pension coverage (UN SDG 1.3.1) and living arrangements of older persons (UN DESA 2026).
    old_path = OUT / "oldage.json"
    if old_path.exists():
        old = json.loads(old_path.read_text(encoding="utf-8"))
        for c in countries.values():
            pv = old["pension"].get(c["id"])
            if pv and ("T" in pv or ("M" in pv and "F" in pv)):
                c["pension"] = {s: pv.get(s, pv.get("T")) for s in "MF"}
                c["src"]["pension"] = "UN-SDG-1.3.1"
                c["yr"]["pension"] = pv["year"]
            lv = old["living"].get(c["id"], {})
            if all(b in lv.get(s, {}) for s in "MF" for b in ("65", "80")):
                c["living"] = {s: {b: {k: v for k, v in lv[s][b].items() if k != "year"} for b in ("65", "80")} for s in "MF"}
                c["src"]["living"] = "UN-DESA-2026"
        for key in ("pension", "living"):
            for c in countries.values():
                if key in c:
                    continue
                same_income = [o for o in countries.values() if o is not c and o["income"] == c["income"]]
                for group in (peers(c, True), same_income, peers(c, False)):
                    vals = [o[key] for o in group if key in o and key not in o["est"]]
                    if len(vals) >= 3:
                        if key == "pension":
                            c[key] = {s: round(statistics.median(v[s] for v in vals), 4) for s in "MF"}
                        else:
                            c[key] = {s: {b: {k: round(statistics.median(v[s][b][k] for v in vals), 4) for k in vals[0][s][b]}
                                          for b in ("65", "80")} for s in "MF"}
                        c["src"][key] = "imputed"
                        c["est"].append(key)
                        break
        print("pension imputed:", [c["id"] for c in countries.values() if c["src"].get("pension") == "imputed"],
              "| living imputed:", sum(1 for c in countries.values() if c["src"].get("living") == "imputed"))

    # Earnings (ILO, employees, 2021 PPP $/month) by sex x occupation and age ratios; prices and currency.
    earn_path = OUT / "earnings.json"
    if earn_path.exists():
        earn = json.loads(earn_path.read_text(encoding="utf-8"))
        OCC = [str(i) for i in range(10)]
        for c in countries.values():
            e = earn.get(c["id"], {})
            c["currency"] = e.get("currency", "USD")
            if "ppp2021" in e:
                c["ppp2021"] = round(e["ppp2021"], 4)
            if "cpi_ratio" in e:
                c["cpi_ratio"] = e["cpi_ratio"]
            if all("TOTAL" in e.get(s, {}).get("ocu", {}) for s in "MF"):
                c["earn"] = {s: {"total": e[s]["ocu"]["TOTAL"],
                                 "rel": {o: round(e[s]["ocu"][o] / e[s]["ocu"]["TOTAL"], 3) for o in OCC if o in e[s]["ocu"]},
                                 "age": e[s].get("age", {})} for s in "MF"}
                c["src"]["earn"] = "ILO"
                c["yr"]["earn"] = e["M"].get("year")
        measured = [c for c in countries.values() if "earn" in c]
        for c in countries.values():
            same_income = [o for o in measured if o is not c and o["income"] == c["income"]]
            groups = ([o for o in same_income if o["region"] == c["region"]], same_income, measured)
            if "earn" not in c:
                for g in groups:
                    if len(g) >= 3:
                        ratio = {s: statistics.median(o["earn"][s]["total"] / o["gdp_ppp"] for o in g) for s in "MF"}
                        c["earn"] = {s: {"total": round(ratio[s] * c["gdp_ppp"], 1),
                                         "rel": {}, "age": {}} for s in "MF"}
                        c["src"]["earn"] = "imputed"
                        c["est"].append("earn")
                        break
            # Fill missing occupation ratios and age ratios from peers.
            for s in "MF":
                for o in OCC:
                    if o not in c["earn"][s]["rel"]:
                        for g in groups:
                            vals = [p["earn"][s]["rel"][o] for p in g if o in p["earn"][s]["rel"] and p["src"]["earn"] == "ILO"]
                            if len(vals) >= 3:
                                c["earn"][s]["rel"][o] = round(statistics.median(vals), 3)
                                break
                for b in ("15", "25", "55", "65"):
                    if b not in c["earn"][s]["age"]:
                        for g in groups:
                            vals = [p["earn"][s]["age"][b] for p in g if b in p["earn"][s]["age"] and p["src"]["earn"] == "ILO"]
                            if len(vals) >= 3:
                                c["earn"][s]["age"][b] = round(statistics.median(vals), 3)
                                break
            c["earn"] = {s: {"total": c["earn"][s]["total"], "rel": [c["earn"][s]["rel"].get(o, 1.0) for o in OCC],
                             "age": c["earn"][s]["age"]} for s in "MF"}
            c.setdefault("cpi_ratio", 1.0)
        print("earnings imputed:", sum(1 for c in countries.values() if c["src"].get("earn") == "imputed"),
              "| no PPP factor:", [c["id"] for c in countries.values() if "ppp2021" not in c])

    # Wealth: net personal wealth per adult, thresholds by percentile (WID), compressed to a grid; adults
    # (20+) and Forbes billionaires for the extreme tail.
    wealth_path = OUT / "wealth.json"
    if wealth_path.exists():
        wl = json.loads(wealth_path.read_text(encoding="utf-8"))
        GRID = [0.0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 0.995, 0.999,
                0.9995, 0.9999, 0.99995, 0.99999]
        def at(q, v, g):
            """Threshold at quantile g: nearest available point not above g (WID points are dense in the tail)."""
            best = 0
            for i, x in enumerate(q):
                if x <= g + 1e-9:
                    best = i
            return v[best]
        for c in countries.values():
            w = wl.get(c["id"], {})
            if "wealth" in w and w.get("adults"):
                q, ppp, usd = w["wealth"]["q"], w["wealth"]["ppp"], w["wealth"]["usd"]
                c["wealth"] = {"grid": GRID, "ppp": [at(q, ppp, g) for g in GRID], "usd": [at(q, usd, g) for g in GRID],
                               "adults": w["adults"], "billionaires": w.get("billionaires", 0)}
                c["src"]["wealth"] = "WID+Forbes"
                c["yr"]["wealth"] = w["wealth"]["year"]
        have = [c for c in countries.values() if "wealth" in c]
        for c in countries.values():
            if "wealth" in c:
                continue
            same = [o for o in have if o["income"] == c["income"]]
            if len(same) >= 3:
                # Scale a typical same-income country's distribution by the ratio of GDP per capita.
                ref = sorted(same, key=lambda o: abs(math.log(o["gdp_ppp"] / c["gdp_ppp"])))[0]
                k = c["gdp_ppp"] / ref["gdp_ppp"]
                c["wealth"] = {"grid": GRID, "ppp": [round(x * k, 1) for x in ref["wealth"]["ppp"]],
                               "usd": [round(x * k, 1) for x in ref["wealth"]["usd"]], "adults": round(c["pop"] * 0.7),
                               "billionaires": 0}
                c["src"]["wealth"] = "imputed"
                c["est"].append("wealth")
        print("wealth imputed:", [c["id"] for c in countries.values() if c["src"].get("wealth") == "imputed"])

    # Taxes on earnings: average rate of income tax + employee social contributions, % of gross pay, at
    # 67%, 100% and 167% of the average wage. OECD Taxing Wages where available. Otherwise from revenue:
    # (income tax + employee contributions, % of GDP) / (labour income share of GDP x share of labour
    # income earned in formal jobs), taken as the rate at the average formal wage, with the OECD median
    # ratios for 67% and 167%. ASSUMPTIONS: all personal income tax falls on labour income; informal
    # workers pay none and earn half as much as formal ones (INFORMAL_EARN). Where the formal sector is
    # small this estimate can break down (50%+ for Uganda or Mali): results above 35% (about the highest
    # OECD rate at the average wage outside Belgium, Germany and Denmark) are treated as unreliable.
    # Unreliable or missing: median of the reliable rates in the same income group.
    tax_path = OUT / "tax.json"
    if tax_path.exists():
        INFORMAL_EARN = 0.5
        tx = json.loads(tax_path.read_text(encoding="utf-8"))
        tws = [v["tw"] for v in tx.values() if "tw" in v and v["tw"]["r100"] > 0]
        k67 = statistics.median(t["r67"] / t["r100"] for t in tws)
        k167 = statistics.median(t["r167"] / t["r100"] for t in tws)
        check = []
        for c in countries.values():
            v = tx.get(c["id"], {})
            rev_rate = None
            inf = 0.6 * c["work"]["M"].get("informal", 0) + 0.4 * c["work"]["F"].get("informal", 0)
            if "rev" in v and v.get("labour_share"):
                inf = 0.6 * c["work"]["M"].get("informal", 0) + 0.4 * c["work"]["F"].get("informal", 0)
                formal = (1 - inf) / ((1 - inf) + inf * INFORMAL_EARN)
                rev_rate = 100 * (v["rev"]["pit"] + v["rev"]["ssc_ee"]) / (100 * v["labour_share"] * formal)
            if "tw" in v:
                t = v["tw"]
                c["tax"] = {"r67": round(t["r67"], 2), "r100": round(t["r100"], 2), "r167": round(t["r167"], 2)}
                c["src"]["tax"] = "OECD Taxing Wages"
                if rev_rate is not None:
                    check.append((c["id"], rev_rate, t["r100"]))
            elif rev_rate is not None and rev_rate <= 35:
                r = rev_rate
                c["tax"] = {"r67": round(r * k67, 2), "r100": round(r, 2), "r167": round(min(60.0, r * k167), 2)}
                c["src"]["tax"] = "OECD Revenue Statistics"
        # Statutory rates where the imputation would be clearly wrong (PwC Worldwide Tax Summaries, 2025):
        # Gulf states have no personal income tax, only social contributions for citizens (employee share);
        # Russia taxes the average wage at a flat 13% with no employee contributions.
        STATUTORY = {"ARE": 11.0, "KWT": 10.5, "SAU": 9.75, "BHR": 7.0, "OMN": 7.0, "QAT": 7.0, "RUS": 13.0}
        for iso3, r in STATUTORY.items():
            if iso3 in countries and countries[iso3]["src"].get("tax") is None:
                countries[iso3]["tax"] = {"r67": r, "r100": r, "r167": r}
                countries[iso3]["src"]["tax"] = "statutory (PwC)"
        have = [c for c in countries.values() if "tax" in c and c["src"]["tax"] != "statutory (PwC)"]
        for c in countries.values():
            if "tax" not in c:
                order = ["Low income", "Lower middle income", "Upper middle income", "High income"]
                i = order.index(c["income"])
                for g in (order[i:] if i < 2 else [c["income"]]) + order:
                    same = [o["tax"]["r100"] for o in have if o["income"] == g]
                    if len(same) >= 3:
                        break
                r = statistics.median(same)
                c["tax"] = {"r67": round(r * k67, 2), "r100": round(r, 2), "r167": round(r * k167, 2)}
                c["src"]["tax"] = "imputed"
                c["est"].append("tax")
        err = statistics.mean(abs(a - b) for _, a, b in check)
        print(f"tax: OECD ratios r67/r100 {k67:.2f}, r167/r100 {k167:.2f}; revenue-based vs Taxing Wages at the average wage,"
              f" {len(check)} countries: mean |diff| {err:.1f} points; e.g. " +
              ", ".join(f"{i} {a:.0f}/{b:.0f}" for i, a, b in check[:8]))
        print("tax imputed:", sum(1 for c in countries.values() if c["src"]["tax"] == "imputed"))

    # Life satisfaction: Cantril ladder (0-10), Gallup World Poll as published by the World Happiness
    # Report (via Our World in Data, happiness-cantril-ladder), latest year since 2020. Missing: median
    # of the same income group and region, else the same income group.
    whr_path = RAW / "whr" / "owid_cantril.csv"
    if whr_path.exists():
        import csv
        ladder = {}
        for r in csv.DictReader(whr_path.open(encoding="utf-8")):
            code = "XKX" if r["code"] == "OWID_KOS" else r["code"]
            if r["cantril_ladder_score"] and int(r["year"]) >= 2020 and int(r["year"]) >= ladder.get(code, (0, 0))[0]:
                ladder[code] = (int(r["year"]), float(r["cantril_ladder_score"]))
        for c in countries.values():
            if c["id"] in ladder:
                c["yr"]["ladder"], c["ladder"] = ladder[c["id"]]
                c["src"]["ladder"] = "WHR/Gallup"
        have = [c for c in countries.values() if "ladder" in c]
        for c in countries.values():
            if "ladder" not in c:
                for g in ([o for o in have if o["income"] == c["income"] and o["region"] == c["region"]],
                          [o for o in have if o["income"] == c["income"]]):
                    if len(g) >= 3:
                        c["ladder"] = round(statistics.median(o["ladder"] for o in g), 3)
                        c["src"]["ladder"] = "imputed"
                        c["est"].append("ladder")
                        break
        print("life satisfaction imputed:", [c["id"] for c in countries.values() if c["src"]["ladder"] == "imputed"])

    # Family planning: demand satisfied by modern methods (SDG 3.7.1, women 15-49), from the UN SDG
    # Global Database (survey-based, more countries than the World Bank copy); latest since 2000.
    # Countries without a survey keep the World Bank value or its same-income imputation.
    fp_path = RAW / "sdg" / "SH_FPL_MTMM.json"
    if fp_path.exists():
        wpp = json.loads((OUT / "wpp_demo.json").read_text(encoding="utf-8"))
        iso3_of = {v["loc_id"]: k for k, v in wpp.items()}
        best = {}
        for r in json.loads(fp_path.read_text(encoding="utf-8"))["data"]:
            iso3, y = iso3_of.get(int(r["geoAreaCode"])), int(r["timePeriodStart"])
            if iso3 and r["value"] not in (None, "", "NaN") and y >= 2000 and y >= best.get(iso3, (0, 0))[0]:
                best[iso3] = (y, float(r["value"]))
        for iso3, (y, v) in best.items():
            if iso3 in countries:
                c = countries[iso3]
                c["fp_satisfied"], c["yr"]["fp_satisfied"], c["src"]["fp_satisfied"] = v, y, "UN SDG 3.7.1"
                if "fp_satisfied" in c["est"]:
                    c["est"].remove("fp_satisfied")
        have = [c for c in countries.values() if c["src"].get("fp_satisfied") in ("UN SDG 3.7.1", "WB")]
        for c in countries.values():
            if c["src"].get("fp_satisfied") not in ("UN SDG 3.7.1", "WB"):
                same = [o["fp_satisfied"] for o in have if o["income"] == c["income"]]
                c["fp_satisfied"] = round(statistics.median(same), 1)
                c["src"]["fp_satisfied"] = "imputed"
        print("family planning from UN SDG database:", sum(1 for c in countries.values() if c["src"].get("fp_satisfied") == "UN SDG 3.7.1"))

    # First-level divisions with population weights for urban and rural births (GeoNames; see extract_provinces.py).
    prov_path = OUT / "provinces.json"
    if prov_path.exists():
        pv = json.loads(prov_path.read_text(encoding="utf-8"))
        for c in countries.values():
            if c["id"] in pv:
                c["provinces"] = pv[c["id"]]

    # Common given names by sex (Wikipedia list of most popular given names; see extract_names.py).
    names_path = OUT / "names.json"
    if names_path.exists():
        nm = json.loads(names_path.read_text(encoding="utf-8"))
        for c in countries.values():
            if c["id"] in nm:
                c["names"] = {"M": nm[c["id"]]["M"], "F": nm[c["id"]]["F"]}
                c["src"]["names"] = nm[c["id"]]["src"]

    # Labour force participation by age band (ILO modelled estimates).
    ilo_path = OUT / "ilo.json"
    if ilo_path.exists():
        ilo = json.loads(ilo_path.read_text(encoding="utf-8"))
        for c in countries.values():
            v = ilo.get(c["id"], {})
            if all(all(b in v.get(s, {}) for b in ("p25", "p55", "p65")) for s in "MF"):
                c["lfp_age"] = {s: {b: v[s][b] for b in ("p25", "p55", "p65")} for s in "MF"}
                c["src"]["lfp_age"] = "ILO-modelled"
                c["yr"]["lfp_age"] = 2024
            if all(all(b in v.get(s, {}) for b in ("u15", "u25")) for s in "MF"):
                c["unemp_age"] = {s: {b: v[s][b] for b in ("u15", "u25")} for s in "MF"}
                c["src"]["unemp_age"] = "ILO-modelled"
            if "ltu" in v:
                c["ltu"] = v["ltu"]
                c["src"]["ltu"] = "ILO-LFS"
                c["yr"]["ltu"] = v["ltu_year"]
        for c in countries.values():
            if "lfp_age" in c:
                continue
            for group in (peers(c, True), peers(c, False)):
                vals = [o["lfp_age"] for o in group if "lfp_age" in o and "lfp_age" not in o["est"]]
                if len(vals) >= 3:
                    c["lfp_age"] = {s: {b: round(statistics.median(x[s][b] for x in vals), 4) for b in ("p25", "p55", "p65")} for s in "MF"}
                    c["src"]["lfp_age"] = "imputed"
                    c["est"].append("lfp_age")
                    break
        for c in countries.values():
            for key in ("unemp_age", "ltu"):
                if key in c:
                    continue
                for group in (peers(c, True), peers(c, False), list(countries.values())):
                    vals = [o[key] for o in group if key in o and key not in o["est"]]
                    if len(vals) >= 3:
                        c[key] = ({s: {b: round(statistics.median(x[s][b] for x in vals), 4) for b in ("u15", "u25")} for s in "MF"}
                                  if key == "unemp_age" else round(statistics.median(vals), 4))
                        c["src"][key] = "imputed"
                        c["est"].append(key)
                        break
        print("unemployment imputed:", [c["id"] for c in countries.values() if c["src"].get("unemp_age") == "imputed"],
              "| long-term share imputed:", sum(1 for c in countries.values() if c["src"].get("ltu") == "imputed"))
        print("lfp_age imputed:", [c["id"] for c in countries.values() if c["src"].get("lfp_age") == "imputed"])

        print("marriage curves imputed:", [c["id"] for c in countries.values() if c["src"].get("marr") == "imputed"])

    OUT.joinpath("countries.json").write_text(json.dumps(countries, ensure_ascii=False, indent=1), encoding="utf-8")

    # Report
    births = sum(c["births"] for c in countries.values())
    print(f"{len(countries)} countries, {births / 1e6:.1f}M births/year, IMF->WB GDP scale {imf_k:.3f} (n={len(ratios)})")
    print("\nGDP from IMF:", ", ".join(f"{k} {c['gdp_ppp']:.0f}" for k, c in countries.items() if c["src"].get("gdp_ppp") == "IMF-WEO"))
    print("Manual:", ", ".join(f"{c['id']}.{k}" for c in countries.values() for k, s in c["src"].items() if s == "manual"))
    print("\nEstimated values (imputed / default / low-confidence manual), births-weighted share of world:")
    for k in WB_KEYS:
        est = [c for c in countries.values() if k in c["est"]]
        if est:
            share = sum(c["births"] for c in est) / births
            imp = [c["id"] for c in est if c["src"][k] == "imputed"]
            print(f"  {k:15s} {len(est):3d} countries, {share:5.1%} of births  imputed: {', '.join(imp[:8])}{' ...' if len(imp) > 8 else ''}")
    missing = [(c["id"], k) for c in countries.values() for k in WB_KEYS if k not in c]
    if missing:
        print("\nStill missing:", missing)


if __name__ == "__main__":
    main()
