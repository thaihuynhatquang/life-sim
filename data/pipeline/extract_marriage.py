"""Extract ever-married shares by age and sex from UN World Marriage Data 2019 -> data/out/marriage.json.

For each country and sex, takes the most recent data source that covers all of ages 15-19 ... 45-49 and
returns the share ever married in each 5-year group (a synthetic-cohort curve of first marriage).

Usage: python extract_marriage.py   (needs data/raw/un/undesa_pd_2019_wmd_marital_status.xlsx)
"""

import json
from collections import defaultdict
from pathlib import Path

from xlsx import Workbook

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "raw" / "un" / "undesa_pd_2019_wmd_marital_status.xlsx"
OUT = ROOT / "out"
GROUPS = [15, 20, 25, 30, 35, 40, 45]
MIN_YEAR = 1995


STATUS_AGES = [20, 25, 30, 35, 40, 45, 50, 55, 60]
DIVORCED = {"Divorced", "Separated", "Divorced or Separated", "Separated from marriage"}
SINGLE = {"Single", "Never married"}
MARRIED = {"Married", "Consensual union", "Living together", "Married or Living together", "Married or in consensual union",
           "Registred partnership", "Married monogamous", "Married polygamous", "Married or married but separated",
           "Married spouse absent", "Married spouse present", "Marriage contract", "Visiting partner"}


def marital_status(wb, iso3_of) -> dict:
    rows = wb.rows("MARITAL_STATUS_BY_AGE")
    for r in rows:
        if r and r[0] == "Country or area":
            header = r
            break
    col = {name: i for i, name in enumerate(header)}
    # (iso3, sex, year, catalog) -> {ageStart: {"D": %, "W": %, "S": %}}
    series = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    for r in rows:
        if not r or r[0] is None:
            continue
        get = lambda k: r[col[k]] if col[k] < len(r) else None
        iso3 = iso3_of.get(int(get("ISO code") or -1))
        a0, a1, v, st = get("AgeStart"), get("AgeEnd"), get("DataValue"), get("MaritalStatus")
        if iso3 is None or v is None or a0 not in STATUS_AGES or a1 != a0 + 4 or int(get("YearEnd")) < MIN_YEAR:
            continue
        kind = "D" if st in DIVORCED else "W" if st == "Widowed" else "S" if st in SINGLE else "M" if st in MARRIED else None
        if kind:
            key = (iso3, "M" if get("Sex") == "Men" else "F", int(get("YearEnd")), get("DataCatalog ID"))
            series[key][int(a0)][kind] += float(v)
    best = {}
    for key, by_age in series.items():
        if not all(all(k in by_age[a] for k in "DWSM") for a in STATUS_AGES):
            continue
        # Percent-of-age-group data should add up to ~100; anything else is a different tabulation.
        if not all(90 <= sum(by_age[a][k] for k in "DWSM") <= 110 for a in STATUS_AGES):
            continue
        iso3, sex, y, _ = key
        if (iso3, sex) not in best or y > best[(iso3, sex)][0]:
            ever = {a: max(1.0, by_age[a]["D"] + by_age[a]["W"] + by_age[a]["M"]) for a in STATUS_AGES}
            best[(iso3, sex)] = (y, {
                "year": y,
                "div": [round(by_age[a]["D"] / ever[a], 4) for a in STATUS_AGES],
                "wid": [round(by_age[a]["W"] / ever[a], 4) for a in STATUS_AGES],
            })
    return {k: v for k, (_, v) in best.items()}


def main():
    # WPP LocID is the ISO 3166 numeric code used by World Marriage Data.
    wpp = json.loads((OUT / "wpp_demo.json").read_text(encoding="utf-8"))
    iso3_of = {v["loc_id"]: k for k, v in wpp.items()}

    wb = Workbook(SRC)
    rows = wb.rows("EVER_MARRIED")
    header = None
    for r in rows:
        if r and r[0] == "Country or area":
            header = r
            break
    col = {name: i for i, name in enumerate(header)}

    # (iso3, sex, yearEnd, catalogId) -> {ageStart: value}
    series = defaultdict(dict)
    meta = {}
    for r in rows:
        if not r or r[0] is None:
            continue
        get = lambda k: r[col[k]] if col[k] < len(r) else None
        iso3 = iso3_of.get(int(get("ISO code") or -1))
        a0, a1, v = get("AgeStart"), get("AgeEnd"), get("DataValue")
        if iso3 is None or v is None or a0 not in GROUPS or a1 != a0 + 4:
            continue
        y = int(get("YearEnd"))
        if y < MIN_YEAR:
            continue
        sex = "M" if get("Sex") == "Men" else "F"
        key = (iso3, sex, y, get("DataCatalog ID"))
        series[key][int(a0)] = float(v)
        meta[key] = {"year": y, "source": get("DataCatalog LongName"), "unions": get("Including_consensual_unions")}

    best = {}
    for key, vals in series.items():
        if len(vals) < len(GROUPS):
            continue
        iso3, sex, y, _ = key
        if (iso3, sex) not in best or y > best[(iso3, sex)][0][2]:
            best[(iso3, sex)] = (key, vals)

    out = {}
    for (iso3, sex), (key, vals) in best.items():
        curve = [round(vals[a] / 100, 4) for a in GROUPS]
        for i in range(1, len(curve)):  # cross-sectional data can dip; first marriage can't un-happen
            curve[i] = max(curve[i], curve[i - 1])
        out.setdefault(iso3, {})[sex] = {"ever": curve, **meta[key]}

    # Current marital status by age (ages 20-24 ... 60-64): divorced/separated and widowed as shares of
    # the ever-married. Used to fit divorce and remarriage rates.
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    status = marital_status(wb, iso3_of)
    for (iso3, sex), v in status.items():
        out.setdefault(iso3, {}).setdefault(sex, {})["status"] = v

    (OUT / "marriage.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    have_s = [k for k in countries if all("status" in out.get(k, {}).get(s, {}) for s in ("F", "M"))]
    print(f"marital status: {len(have_s)} countries "
          f"({sum(countries[k]['births'] for k in have_s) / sum(c['births'] for c in countries.values()):.0%} of births)")
    for k in ("VNM", "USA", "RUS", "NGA"):
        if k in have_s:
            st = out[k]["F"]["status"]
            print(f"  {k} {st['year']} F divorced {st['div']}  widowed {st['wid']}")
    have = [k for k in countries if all("ever" in out.get(k, {}).get(s, {}) for s in ("F", "M"))]
    births = sum(countries[k]["births"] for k in have) / sum(c["births"] for c in countries.values())
    years = sorted(out[k]["F"]["year"] for k in have)
    print(f"{len(have)}/{len(countries)} countries with both sexes ({births:.0%} of births); "
          f"median year {years[len(years) // 2]}, oldest {years[0]}")
    print("missing (by births):", [k for k in sorted(countries, key=lambda k: -countries[k]["births"]) if k not in have][:20])
    for k in ("VNM", "IND", "NGA", "USA", "CHN", "JPN"):
        if k in out:
            print(f"  {k} {out[k]['F']['year']}: F {out[k]['F']['ever']}  M {out[k].get('M', {}).get('ever')}")


if __name__ == "__main__":
    main()
