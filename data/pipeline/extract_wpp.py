"""Extract what the simulation needs from the UN WPP 2024 CSVs (streamed; the files are ~2 GB unzipped).

Outputs:
  data/out/wpp_demo.json       per country, BASE_YEAR: births, sex ratio at birth, life expectancy, IMR, U5MR
  data/out/lifetables.json     per country/sex/year: qx for single ages 0..100 (100 = open interval, qx = 1)

Usage: python extract_wpp.py
"""

import csv
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "wpp"
OUT = ROOT / "out"

# "Today" in the simulation. 2023 is the last year of WPP 2024 estimates (later years are projections).
BASE_YEAR = 2023
# Years kept for the "past world" mode. Every year would be ~15 MB in the browser, so keep a sample.
LT_YEARS = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, BASE_YEAR]

DEMO = RAW / "WPP2024_Demographic_Indicators_Medium.csv.gz"
ASFR = RAW / "WPP2024_Fertility_by_Age1.csv.gz"
LT = {
    "F": RAW / "WPP2024_Life_Table_Complete_Medium_Female_1950-2023.csv.gz",
    "M": RAW / "WPP2024_Life_Table_Complete_Medium_Male_1950-2023.csv.gz",
}


def rows(path: Path):
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def is_country(r: dict) -> bool:
    # LocTypeName is "Country/Area" for real places; regions and income groups have other types.
    return r["LocTypeName"] == "Country/Area" and r["ISO3_code"] != ""


def num(s: str):
    return float(s) if s not in ("", None) else None


def extract_demo() -> dict:
    out = {}
    for r in rows(DEMO):
        if not is_country(r) or int(r["Time"]) != BASE_YEAR:
            continue
        out[r["ISO3_code"]] = {
            "name_wpp": r["Location"],
            "iso2": r["ISO2_code"],
            "loc_id": int(r["LocID"]),
            "pop": num(r["TPopulation1July"]) * 1000,
            "births": num(r["Births"]) * 1000,
            "srb": num(r["SRB"]),  # boys per 100 girls
            "le": num(r["LEx"]),
            "le_m": num(r["LExMale"]),
            "le_f": num(r["LExFemale"]),
            "imr": num(r["IMR"]),
            "u5mr": num(r["Q5"]),
            "tfr": num(r["TFR"]),
            "mac": num(r["MAC"]),  # mean age of mothers at childbirth
            "cdr": num(r["CDR"]),
            "median_age": num(r["MedianAgePop"]),
        }
    return out


def extract_asfr() -> dict:
    """Age-specific fertility, births per woman per year at single ages 15..49, BASE_YEAR."""
    out: dict = {}
    for r in rows(ASFR):
        if not is_country(r) or int(r["Time"]) != BASE_YEAR or r["Variant"] != "Medium":
            continue
        age = int(r["AgeGrpStart"])
        if 15 <= age <= 49:
            out.setdefault(r["ISO3_code"], [0.0] * 35)[age - 15] = round(num(r["ASFR"]) / 1000, 5)
    return out


def extract_lifetables() -> dict:
    years = set(LT_YEARS)
    out: dict = {}
    for sex, path in LT.items():
        for r in rows(path):
            if not is_country(r):
                continue
            yr = int(r["Time"])
            if yr not in years:
                continue
            age = int(r["AgeGrpStart"])
            q = 1.0 if age >= 100 else num(r["qx"])
            arr = out.setdefault(r["ISO3_code"], {}).setdefault(sex, {}).setdefault(str(yr), [None] * 101)
            if age <= 100:
                arr[age] = round(q, 7)
    # Sanity: every table must be complete.
    for iso3, by_sex in out.items():
        for sex, by_year in by_sex.items():
            for yr, arr in by_year.items():
                if any(v is None for v in arr):
                    raise ValueError(f"incomplete life table {iso3} {sex} {yr}")
    return out


def life_expectancy(qx: list) -> float:
    """e0 from single-age qx, deaths at mid-year except age 0 (a0 ~ 0.15) and the open interval."""
    l, e = 1.0, 0.0
    for age, q in enumerate(qx):
        d = l * q
        if age == len(qx) - 1:
            e += l * 2.5  # rough remaining years past 100
        else:
            e += l - (0.85 if age == 0 else 0.5) * d
        l -= d
    return e


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    print("demographic indicators...")
    demo = extract_demo()
    (OUT / "wpp_demo.json").write_text(json.dumps(demo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  {len(demo)} countries, {sum(c['births'] for c in demo.values()) / 1e6:.1f}M births in {BASE_YEAR}")

    if ASFR.exists():
        print("age-specific fertility...")
        asfr = extract_asfr()
        for iso3, a in asfr.items():
            if iso3 in demo:
                demo[iso3]["asfr"] = a
        (OUT / "wpp_demo.json").write_text(json.dumps(demo, ensure_ascii=False, indent=1), encoding="utf-8")
        worst = max(abs(sum(a) - demo[k]["tfr"]) for k, a in asfr.items() if k in demo)
        print(f"  {len(asfr)} countries; max |sum(ASFR) - TFR| = {worst:.3f}")

    print("life tables...")
    lt = extract_lifetables()
    (OUT / "lifetables.json").write_text(json.dumps(lt, separators=(",", ":")), encoding="utf-8")
    size = (OUT / "lifetables.json").stat().st_size / 1e6
    print(f"  {len(lt)} countries x 2 sexes x {len(LT_YEARS)} years, {size:.1f} MB")

    # Cross-check: e0 recomputed from our qx should match WPP's published life expectancy.
    print("\ncheck e0 from qx vs WPP published (BASE_YEAR):")
    worst = []
    for iso3, d in demo.items():
        if iso3 not in lt:
            continue
        for sex, key in (("M", "le_m"), ("F", "le_f")):
            ours = life_expectancy(lt[iso3][sex][str(BASE_YEAR)])
            worst.append((abs(ours - d[key]), iso3, sex, ours, d[key]))
    worst.sort(reverse=True)
    for diff, iso3, sex, ours, theirs in worst[:5]:
        print(f"  {iso3} {sex}: ours {ours:.2f} vs WPP {theirs:.2f} (diff {diff:.2f})")
    for iso3 in ("VNM", "IND", "NGA", "JPN"):
        if iso3 in demo:
            print(f"  {iso3}: M {life_expectancy(lt[iso3]['M'][str(BASE_YEAR)]):.1f}/{demo[iso3]['le_m']:.1f}"
                  f"  F {life_expectancy(lt[iso3]['F'][str(BASE_YEAR)]):.1f}/{demo[iso3]['le_f']:.1f}")


if __name__ == "__main__":
    main()
