"""Occupations, sectors, status in employment and informality from ILOSTAT -> data/out/work.json.

National totals by sex come from the ILO modelled estimates (all countries, 2024):
  occupation (ISCO-08 major groups; the model merges 6 skilled agriculture with 9 elementary, split here
  with the latest survey's 6:9 ratio), sector (agriculture / industry / services), status in employment.
Structure within countries comes from the latest labour force survey or census (2010+):
  occupation by age band (15-24, 25-54, 55-64, 65+), occupation by education level, status by occupation,
  informality by status, national informality rate.

All shares are by sex. Usage: python fetch_ilo_work.py
"""

import gzip
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "ilo"
OUT = ROOT / "out"
API = "https://rplumber.ilo.org/data/indicator/?format=.json"
SEXES = {"SEX_M": "M", "SEX_F": "F"}
OCC = [str(i) for i in range(10)]  # ISCO major groups 0 (armed forces) .. 9 (elementary)
# By sex, surveys are published reliably only in these broad bands (10-year bands exist for both sexes only).
AGE = {"AGE_AGGREGATE_Y15-24": "15", "AGE_AGGREGATE_Y25-54": "25", "AGE_AGGREGATE_Y55-64": "55", "AGE_AGGREGATE_YGE65": "65"}
EDU = {"EDU_AGGREGATE_LTB": "LTB", "EDU_AGGREGATE_BAS": "BAS", "EDU_AGGREGATE_INT": "INT", "EDU_AGGREGATE_ADV": "ADV"}
# ICSE-93: employees, employers, own-account (+ producer cooperatives), contributing family workers.
STE = {"STE_ICSE93_1": "emp", "STE_ICSE93_2": "employer", "STE_ICSE93_3": "own", "STE_ICSE93_4": "own", "STE_ICSE93_5": "family"}
MIN_YEAR = 2010


def fetch(ind: str, extra: str) -> list:
    path = RAW / f"{ind}.json"
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(f"{API}&id={ind}{extra}", headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"})
        with urllib.request.urlopen(req, timeout=900) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
        path.write_bytes(body)
    return [r for r in json.loads(path.read_text(encoding="utf-8")) if r.get("obs_value") is not None]


def occ_code(c: str):
    """'OCU_ISCO08_7' -> '7' (ISCO-88 accepted when a country has no ISCO-08 data; major groups align)."""
    for p in ("OCU_ISCO08_", "OCU_ISCO88_"):
        if c.startswith(p) and c[len(p):] in OCC:
            return c[len(p):], p
    return None, None


def latest(rows):
    """Keep rows from each country's latest year (>= MIN_YEAR)."""
    yr = {}
    for r in rows:
        yr[r["ref_area"]] = max(yr.get(r["ref_area"], 0), int(r["time"]))
    return [r for r in rows if int(r["time"]) == yr[r["ref_area"]] and yr[r["ref_area"]] >= MIN_YEAR], yr


def shares(d: dict, keys) -> list:
    tot = sum(d.get(k, 0) for k in keys)
    return [round(d.get(k, 0) / tot, 5) for k in keys] if tot > 0 else None


def main():
    out: dict = {}
    year: dict = {}

    def put(iso3, path, value):
        node = out.setdefault(iso3, {})
        for p in path[:-1]:
            node = node.setdefault(p, {})
        node[path[-1]] = value

    # --- survey: occupation by age band (also gives the 6:9 split and armed forces share)
    rows, yr = latest(fetch("EMP_TEMP_SEX_AGE_OCU_NB_A", "&latestyear=true"))
    cells: dict = {}
    for r in rows:
        sex, band = SEXES.get(r["sex"]), AGE.get(r["classif1"])
        occ, scheme = occ_code(r.get("classif2", ""))
        if sex and occ:
            cells.setdefault((r["ref_area"], sex, scheme), {}).setdefault(band or r["classif1"], {})[occ] = r["obs_value"]
    for (iso3, sex, scheme), by in sorted(cells.items(), key=lambda kv: kv[0][2] != "OCU_ISCO08_"):
        if "ocu_age" in out.get(iso3, {}).get(sex, {}) :
            continue  # ISCO-08 preferred (sorted first)
        bands = {b: shares(v, OCC) for b, v in by.items() if b in AGE.values()}
        # Sanity: a real occupation mix has most groups present (drops partial tabulations, e.g. army only).
        # The prime-age band must have most groups; thinner bands (teens, 65+) just need a few.
        bands = {b: v for b, v in bands.items() if v and sum(1 for x in v[1:] if x > 0) >= (6 if b == "25" else 3)}
        if "25" not in bands:
            continue
        total = by.get("AGE_AGGREGATE_YGE15") or by.get("AGE_YTHADULT_YGE15")
        if len(bands) >= 3 and total:
            put(iso3, (sex, "ocu_age"), bands)
            put(iso3, (sex, "survey_ocu"), shares(total, OCC))
            year.setdefault(iso3, {})["ocu_age"] = yr[iso3]

    # --- survey: occupation by education
    rows, yr = latest(fetch("EMP_TEMP_SEX_OCU_EDU_NB_A", "&latestyear=true"))
    cells = {}
    for r in rows:
        sex, edu = SEXES.get(r["sex"]), EDU.get(r.get("classif2", ""))
        occ, scheme = occ_code(r["classif1"])
        if sex and edu and occ:
            cells.setdefault((r["ref_area"], sex), {}).setdefault(edu, {})[occ] = r["obs_value"]
    for (iso3, sex), by in cells.items():
        put(iso3, (sex, "ocu_edu"), {e: shares(v, OCC) for e, v in by.items() if shares(v, OCC) and sum(1 for x in v.values() if x > 0) >= 4})
        year.setdefault(iso3, {})["ocu_edu"] = yr[iso3]

    # --- survey: status in employment by occupation
    rows, yr = latest(fetch("EMP_TEMP_SEX_STE_OCU_NB_A", "&latestyear=true"))
    cells = {}
    for r in rows:
        sex, ste = SEXES.get(r["sex"]), STE.get(r["classif1"])
        occ, _ = occ_code(r.get("classif2", ""))
        if sex and ste and occ:
            d = cells.setdefault((r["ref_area"], sex), {}).setdefault(occ, {})
            d[ste] = d.get(ste, 0) + r["obs_value"]
    for (iso3, sex), by in cells.items():
        put(iso3, (sex, "status_ocu"), {o: shares(v, ["emp", "employer", "own", "family"]) for o, v in by.items()
                                       if shares(v, ["emp", "employer", "own", "family"])})
        year.setdefault(iso3, {})["status_ocu"] = yr[iso3]

    # --- survey: informality rate, total and by status
    rows, yr = latest(fetch("EMP_NIFL_SEX_STE_RT_A", "&latestyear=true"))
    for r in rows:
        sex = SEXES.get(r["sex"])
        if not sex:
            continue
        if r["classif1"] == "STE_AGGREGATE_TOTAL":
            put(r["ref_area"], (sex, "informal"), round(r["obs_value"] / 100, 4))
        elif r["classif1"] in STE and r["classif1"] != "STE_ICSE93_4":
            put(r["ref_area"], (sex, "informal_status", STE[r["classif1"]]), round(r["obs_value"] / 100, 4))
        year.setdefault(r["ref_area"], {})["informal"] = yr[r["ref_area"]]

    # --- modelled national totals, 2024: occupation, sector, status
    for r in fetch("EMP_2EMP_SEX_OCU_NB_A", "&time=2024"):
        sex = SEXES.get(r["sex"])
        code = r["classif1"].replace("OCU_ISCO08_", "")
        if sex and code != "TOTAL":
            out.setdefault(r["ref_area"], {}).setdefault(sex, {}).setdefault("_ocu_model", {})[code] = r["obs_value"]
    sector_map = {"ECO_AGGREGATE_AGR": "agr", "ECO_AGGREGATE_MAN": "ind", "ECO_AGGREGATE_CON": "ind",
                  "ECO_AGGREGATE_MEL": "ind", "ECO_AGGREGATE_MKT": "ser", "ECO_AGGREGATE_PUB": "ser"}
    for r in fetch("EMP_2EMP_SEX_ECO_NB_A", "&time=2024"):
        sex, s = SEXES.get(r["sex"]), sector_map.get(r["classif1"])
        if sex and s:
            d = out.setdefault(r["ref_area"], {}).setdefault(sex, {}).setdefault("_sector", {})
            d[s] = d.get(s, 0) + r["obs_value"]
    for r in fetch("EMP_2EMP_SEX_STE_NB_A", "&time=2024"):
        sex, s = SEXES.get(r["sex"]), STE.get(r["classif1"])
        if sex and s:
            d = out.setdefault(r["ref_area"], {}).setdefault(sex, {}).setdefault("_status", {})
            d[s] = d.get(s, 0) + r["obs_value"]

    # Finalise national shares; split the model's merged "96" with the survey's 6:9 ratio.
    for iso3, by_sex in out.items():
        for sex, v in by_sex.items():
            m = v.pop("_ocu_model", None)
            if m and "96" in m:
                sv = v.get("survey_ocu")
                r6 = sv[6] / (sv[6] + sv[9]) if sv and sv[6] + sv[9] > 0 else None
                armed = sv[0] if sv else 0.0
                if r6 is not None:
                    raw = {**{k: m.get(k, 0) for k in "1234578"}, "6": m["96"] * r6, "9": m["96"] * (1 - r6)}
                    tot = sum(raw.values())
                    v["ocu"] = [round(armed, 5)] + [round((1 - armed) * raw[k] / tot, 5) for k in "123456789"]
                v["_ocu96"] = {k: m.get(k, 0) for k in ("1", "2", "3", "4", "5", "7", "8", "96")}
            # Rake the survey's age and education patterns to the national 2024 mix: each occupation is
            # scaled by (2024 share / survey share), keeping differences between ages and education levels.
            sv = v.get("survey_ocu")
            if v.get("ocu") and sv:
                ratio = [(v["ocu"][k] / sv[k]) if sv[k] > 0 else 1.0 for k in range(10)]
                for key in ("ocu_age", "ocu_edu"):
                    for g, row in v.get(key, {}).items():
                        r = [x * ratio[k] for k, x in enumerate(row)]
                        t = sum(r)
                        v[key][g] = [round(x / t, 5) for x in r] if t > 0 else row
            if "_sector" in v:
                v["sector"] = dict(zip(["agr", "ind", "ser"], shares(v.pop("_sector"), ["agr", "ind", "ser"])))
            if "_status" in v:
                v["status"] = dict(zip(["emp", "employer", "own", "family"], shares(v.pop("_status"), ["emp", "employer", "own", "family"])))
        by_sex["year"] = year.get(iso3, {})

    (OUT / "work.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    tot = sum(c["births"] for c in countries.values())
    for key in ("ocu", "sector", "status", "ocu_age", "ocu_edu", "status_ocu", "informal", "informal_status"):
        have = [k for k in countries if all(key in out.get(k, {}).get(s, {}) for s in "MF")]
        print(f"{key:16s} {len(have):3d}/158 {sum(countries[k]['births'] for k in have) / tot:4.0%} of births")
    v = out["VNM"]["F"]
    print("VNM women: ocu", v.get("ocu"), "| sector", v.get("sector"), "| status", v.get("status"), "| informal", v.get("informal"))


if __name__ == "__main__":
    main()
