"""Chronic disease prevalence and care from WHO GHO (NCD-RisC estimates) -> data/out/ncd.json.

- Diabetes: prevalence among adults 30+ by sex (crude, 2022) and treatment coverage.
- Hypertension: prevalence among adults 30-79 by sex (crude, 2019), diagnosis and treatment coverage.
- Obesity (BMI >= 30) among adults 18+ by sex (crude, 2024).
- Alcohol use disorders, 12-month prevalence among people 15+ by sex (2016).

Usage: python fetch_who_ncd.py
"""

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "who"
OUT = ROOT / "out"
API = "https://ghoapi.azureedge.net/api/"
SEX = {"SEX_MLE": "M", "SEX_FMLE": "F", "SEX_BTSX": "T"}


def get(ind: str) -> list:
    path = RAW / f"{ind}.json"
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(API + ind, timeout=600) as r:
            path.write_bytes(r.read())
    return json.loads(path.read_text(encoding="utf-8"))["value"]


def latest(ind: str, age: str | None = None) -> dict:
    """{iso3: {sex: value}} for the latest year per country."""
    out, year = {}, {}
    for r in get(ind):
        if r.get("SpatialDimType") != "COUNTRY" or r.get("NumericValue") is None:
            continue
        if age and r.get("Dim2") != age:
            continue
        iso3, y, sex = r["SpatialDim"], r["TimeDim"], SEX.get(r["Dim1"])
        if sex is None or y < year.get(iso3, 0):
            continue
        if y > year.get(iso3, 0):
            out[iso3], year[iso3] = {}, y
        out[iso3][sex] = round(r["NumericValue"] / 100, 4)
    return out


def latest_text(ind: str) -> dict:
    """Same as latest() for indicators whose numbers are only in the text 'Value' field."""
    out, year = {}, {}
    for r in get(ind):
        if r.get("SpatialDimType") != "COUNTRY" or not r.get("Value"):
            continue
        try:
            v = float(str(r["Value"]).split(" ")[0])
        except ValueError:
            continue
        iso3, y, sex = r["SpatialDim"], r["TimeDim"], SEX.get(r["Dim1"])
        if sex is None or y < year.get(iso3, 0):
            continue
        if y > year.get(iso3, 0):
            out[iso3], year[iso3] = {}, y
        out[iso3][sex] = round(v / 100, 4)
    return out


def main():
    d = {
        "dm_prev": latest("NCD_DIABETES_PREVALENCE_CRUDE", "AGEGROUP_YEARS30-PLUS"),
        "dm_treat": latest("NCD_DIABETES_TREATMENT_CRUDE", "AGEGROUP_YEARS30-PLUS"),
        "ht_prev": latest("NCD_HYP_PREVALENCE_C"),
        "ht_diag": latest("NCD_HYP_DIAGNOSIS_C"),
        "ht_treat": latest("NCD_HYP_TREATMENT_C"),
        "obese": latest("NCD_BMI_30C", "AGEGROUP_YEARS18-PLUS"),     # BMI >= 30, adults 18+, crude
        "aud": latest_text("SA_0000001462"),                          # alcohol use disorders, 15+, 12-month
        "inactive": latest("NCD_PAC"),                                # insufficient physical activity, adults 18+, crude
    }
    out = {}
    for key, by in d.items():
        for iso3, v in by.items():
            out.setdefault(iso3, {})[key] = v
    (OUT / "ncd.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    have = [k for k in countries if all(k in d[x] for x in d)]
    print(f"{len(have)}/{len(countries)} countries with all indicators; missing: {[k for k in countries if k not in have]}")
    for k in ("VNM", "IND", "USA", "NGA", "MEX"):
        print(" ", k, out.get(k))


if __name__ == "__main__":
    main()
