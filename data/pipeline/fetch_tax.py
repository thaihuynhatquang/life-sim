"""Taxes on earnings -> data/out/tax.json.

- OECD Taxing Wages (DF_TW_COMP): average rate of personal income tax + employee social security
  contributions, % of gross wage, for a single person without children earning 67%, 100% and 167% of the
  average wage (38 OECD countries, latest year).
- OECD Global Revenue Statistics (DF_RSGLOBAL, 144 countries): personal income tax (1100) and social
  security contributions (2000; paid by employees 2100), % of GDP, general government, latest year.
- ILO modelled estimates: labour income share of GDP (LAP_2GDP_NOC_RT, includes the self-employed).

For countries without Taxing Wages the average rate on formal earnings is (income tax + employee
contributions) / (labour income x formal share of labour income); see build_countries.py.

Usage: python fetch_tax.py
"""

import csv
import json
import statistics
from pathlib import Path

from fetch_earnings import get

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
OUT = ROOT / "out"
SDMX = "https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,{}/all?startPeriod={}&dimensionAtObservation=AllDimensions"
CSV = {"Accept": "application/vnd.sdmx.data+csv; charset=utf-8"}
ILO = "https://rplumber.ilo.org/data/indicator/?format=.json&latestyear=true&id=LAP_2GDP_NOC_RT_A"


def oecd_csv(name: str, flow: str, start: int) -> list:
    path = RAW / "oecd" / name
    if not path.exists():
        import urllib.request
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(SDMX.format(flow, start), headers={"User-Agent": "Mozilla/5.0", **CSV})
        with urllib.request.urlopen(req, timeout=900) as r:
            path.write_bytes(r.read())
    return list(csv.DictReader(path.open(encoding="utf-8")))


def latest(d: dict):
    return d[max(d)] if d else None


def main():
    out: dict = {}

    # Taxing Wages: single, no children, at 67/100/167% of the average wage.
    tw: dict = {}
    for r in oecd_csv("tw_comp.csv", "DSD_TAX_WAGES_COMP@DF_TW_COMP", 2023):
        if r["MEASURE"] == "AV_RITEESSC" and r["HOUSEHOLD_TYPE"] == "S_C0" and r["OBS_VALUE"]:
            tw.setdefault(r["REF_AREA"], {}).setdefault(r["INCOME_PRINCIPAL"], {})[int(r["TIME_PERIOD"])] = float(r["OBS_VALUE"])
    for iso3, d in tw.items():
        if all(k in d for k in ("AW67", "AW100", "AW167")):
            y = max(d["AW100"])
            out.setdefault(iso3, {})["tw"] = {"r67": d["AW67"].get(y), "r100": d["AW100"][y], "r167": d["AW167"].get(y), "year": y}

    # Revenue statistics: % of GDP, general government, all revenue of that type.
    rev: dict = {}
    for r in oecd_csv("rsglobal.csv", "DSD_REV_COMP_GLOBAL@DF_RSGLOBAL", 2019):
        if (r["UNIT_MEASURE"] == "PT_B1GQ" and r["CTRY_SPECIFIC_REVENUE"] == "_T" and r["SECTOR"] == "S13"
                and r["STANDARD_REVENUE"] in ("T_1100", "T_2000", "T_2100") and r["OBS_VALUE"]):
            rev.setdefault(r["REF_AREA"], {}).setdefault(r["STANDARD_REVENUE"], {})[int(r["TIME_PERIOD"])] = float(r["OBS_VALUE"])
    # Where employee contributions are not reported separately, take the median employee share of all
    # social contributions in countries that report both.
    shares = [latest(v["T_2100"]) / latest(v["T_2000"]) for v in rev.values()
              if latest(v.get("T_2100", {})) and latest(v.get("T_2000", {}))]
    ee_share = statistics.median(shares)
    for iso3, v in rev.items():
        pit, ssc, ee = latest(v.get("T_1100", {})), latest(v.get("T_2000", {})), latest(v.get("T_2100", {}))
        if pit is None:
            continue
        node = {"pit": round(pit, 3), "year": max(v["T_1100"])}
        if ee:
            node["ssc_ee"] = round(ee, 3)
        elif ssc:
            node["ssc_ee"] = round(ssc * ee_share, 3)
            node["ssc_ee_est"] = True
        else:
            node["ssc_ee"] = 0.0
        out.setdefault(iso3, {})["rev"] = node

    for r in get(RAW / "ilo" / "LAP_2GDP_NOC_RT_A.json", ILO):
        if r.get("obs_value"):
            out.setdefault(r["ref_area"], {})["labour_share"] = round(r["obs_value"] / 100, 4)

    (OUT / "tax.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    tot = sum(c["births"] for c in countries.values())
    for name, key in (("Taxing Wages", "tw"), ("revenue statistics", "rev"), ("labour share", "labour_share")):
        have = [k for k in countries if key in out.get(k, {})]
        print(f"{name:20s} {len(have):3d}/158 {sum(countries[k]['births'] for k in have) / tot:4.0%} of births")
    print(f"employee share of social contributions (median, used where not split): {ee_share:.2f}")
    for k in ("VNM", "USA", "FRA", "NGA", "CHN", "BRA"):
        print(" ", k, out.get(k))


if __name__ == "__main__":
    main()
