"""Old age: pension coverage (UN SDG 1.3.1) and living arrangements of older persons (UN DESA 2026)
-> data/out/oldage.json.

- SI_COV_PENSN: proportion of the population above statutory pensionable age receiving a pension, by sex
  where available (UN SDG Global Database API).
- Living arrangements of older persons (65+ and 80+, by sex), latest survey/census: living alone, as a
  couple only, with children aged 20+, in skip-generation households (grandparents with grandchildren).

Usage: python extract_oldage.py   (needs data/raw/un/undesa_pd_2026_living-arrangements-older-persons.xlsx)
"""

import json
import math
import urllib.request
from pathlib import Path

from xlsx import Workbook

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
OUT = ROOT / "out"
SDG = "https://unstats.un.org/sdgapi/v1/sdg/Series/Data?seriesCode=SI_COV_PENSN&pageSize=20000"


def pensions(iso3_of) -> dict:
    path = RAW / "sdg" / "SI_COV_PENSN.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(SDG, headers={"User-Agent": "Mozilla/5.0"}), timeout=600) as r:
            path.write_bytes(r.read())
    out, year = {}, {}
    for r in json.loads(path.read_text(encoding="utf-8"))["data"]:
        iso3 = iso3_of.get(int(r["geoAreaCode"]))
        sex = {"BOTHSEX": "T", "MALE": "M", "FEMALE": "F"}.get(r["dimensions"].get("Sex"))
        y = int(r["timePeriodStart"])
        if not iso3 or not sex or r["value"] in (None, "", "NaN") or y < 2010:
            continue
        if y > year.get((iso3, sex), 0):
            year[(iso3, sex)] = y
            out.setdefault(iso3, {})[sex] = round(min(100.0, float(r["value"])) / 100, 4)
            out[iso3]["year"] = max(out[iso3].get("year", 0), y)
    return out


def living(iso3_of) -> dict:
    wb = Workbook(RAW / "un" / "undesa_pd_2026_living-arrangements-older-persons.xlsx")
    rows = list(wb.rows("HHLA of Older Persons 2026"))
    head = rows[4]
    col = {name: i for i, name in enumerate(head)}
    want = {"alone": "One person", "couple": "Couple only", "children": "With children aged 20 years or over", "skip": "Skip generation"}
    out = {}
    for r in rows[5:]:
        if len(r) <= col["Skip generation"] or r[col["ISO3 Code"]] is None:
            continue
        iso3, age, sex, y = r[col["ISO3 Code"]], r[col["Age range"]], r[col["Sex"]], int(float(r[col["Reference year"]] or 0))
        band = {"65 or over": "65", "80 or over": "80"}.get(age)
        s = {"Males": "M", "Females": "F"}.get(sex)
        if not band or not s or y < 2000:
            continue
        try:
            vals = {k: float(r[col[v]]) / 100 for k, v in want.items()}
        except (TypeError, ValueError):
            continue
        if any(math.isnan(v) for v in vals.values()):
            continue
        cur = out.setdefault(iso3, {}).setdefault(s, {}).get(band)
        if cur is None or y > cur["year"]:
            out[iso3][s][band] = {**{k: round(v, 4) for k, v in vals.items()}, "year": y}
    return out


def main():
    wpp = json.loads((OUT / "wpp_demo.json").read_text(encoding="utf-8"))
    iso3_of = {v["loc_id"]: k for k, v in wpp.items()}
    pen, liv = pensions(iso3_of), living(iso3_of)
    (OUT / "oldage.json").write_text(json.dumps({"pension": pen, "living": liv}, indent=1), encoding="utf-8")
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    tot = sum(c["births"] for c in countries.values())
    for name, d, ok in (("pension", pen, lambda v: "T" in v or "M" in v),
                        ("living arrangements", liv, lambda v: all(b in v.get(s, {}) for s in "MF" for b in ("65", "80")))):
        have = [k for k in countries if k in d and ok(d[k])]
        print(f"{name:20s} {len(have):3d}/158 {sum(countries[k]['births'] for k in have) / tot:4.0%} of births")
    for k in ("VNM", "IND", "USA", "NGA", "JPN"):
        print(" ", k, "pension", pen.get(k), "| women 80+", liv.get(k, {}).get("F", {}).get("80"))


if __name__ == "__main__":
    main()
