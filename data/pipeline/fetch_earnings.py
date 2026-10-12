"""Earnings, prices and currencies -> data/out/earnings.json.

- ILO: average monthly earnings of employees by sex and occupation (ISCO-08 major groups), in PPP dollars
  of the survey year (EAR_EMTA_SEX_OCU_CUR_NB_A), and by sex and age band in local currency
  (EAR_EMTA_SEX_AGE_NB_A, used only as ratios to the overall mean).
- World Bank: private consumption PPP conversion factor (LCU per international $, 2021) and the
  consumer price index (2021 and latest year), to show money in local currency at today's prices.
  US CPI converts each survey year's PPP dollars to 2021 PPP dollars.
- Unicode CLDR: each territory's current currency (ISO 4217 code).

Usage: python fetch_earnings.py
"""

import gzip
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
OUT = ROOT / "out"
ILO = "https://rplumber.ilo.org/data/indicator/?format=.json&latestyear=true&id="
WB = "https://api.worldbank.org/v2/country/all/indicator/{}?format=json&date=2010:2025&per_page=20000"
CLDR = "https://cdn.jsdelivr.net/npm/cldr-core@45.0.0/supplemental/currencyData.json"
SEXES = {"SEX_M": "M", "SEX_F": "F"}
AGE = {"AGE_AGGREGATE_Y15-24": "15", "AGE_AGGREGATE_Y25-54": "25", "AGE_AGGREGATE_Y55-64": "55", "AGE_AGGREGATE_YGE65": "65"}


def get(path: Path, url: str, headers=None):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip", **(headers or {})})
        with urllib.request.urlopen(req, timeout=900) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
        path.write_bytes(body)
    return json.loads(path.read_text(encoding="utf-8"))


def wb_series(code: str) -> dict:
    """{iso3: {year: value}}"""
    d = get(RAW / "wb" / f"_series_{code}.json", WB.format(code))
    out = {}
    for r in d[1] or []:
        if r["value"] is not None and r["countryiso3code"]:
            out.setdefault(r["countryiso3code"], {})[int(r["date"])] = r["value"]
    return out


def main():
    out: dict = {}
    us_cpi = wb_series("FP.CPI.TOTL")["USA"]

    # Earnings by sex and occupation, PPP dollars of the survey year -> 2021 PPP dollars.
    rows = [r for r in get(RAW / "ilo" / "EAR_EMTA_SEX_OCU_CUR_NB_A.json", ILO + "EAR_EMTA_SEX_OCU_CUR_NB_A")
            if r.get("obs_value") is not None and r.get("classif2") == "CUR_TYPE_PPP" and int(r["time"]) >= 2010]
    for r in rows:
        sex, code = SEXES.get(r["sex"]), r["classif1"].replace("OCU_ISCO08_", "")
        if sex and (code.isdigit() or code == "TOTAL"):
            y = int(r["time"])
            to2021 = us_cpi[2021] / us_cpi.get(y, us_cpi[max(k for k in us_cpi if k <= y)])
            v = out.setdefault(r["ref_area"], {}).setdefault(sex, {})
            v.setdefault("ocu", {})[code] = round(r["obs_value"] * to2021, 1)
            v["year"] = y

    # Earnings by sex and age band, as ratios to all ages (local currency, so only ratios are used).
    rows = [r for r in get(RAW / "ilo" / "EAR_EMTA_SEX_AGE_NB_A.json", ILO + "EAR_EMTA_SEX_AGE_NB_A")
            if r.get("obs_value") is not None and int(r["time"]) >= 2010]
    tmp: dict = {}
    for r in rows:
        sex = SEXES.get(r["sex"])
        if sex and (r["classif1"] in AGE or r["classif1"] == "AGE_AGGREGATE_YGE15"):
            tmp.setdefault((r["ref_area"], sex), {})[r["classif1"]] = r["obs_value"]
    for (iso3, sex), d in tmp.items():
        total = d.get("AGE_AGGREGATE_YGE15")
        if total:
            out.setdefault(iso3, {}).setdefault(sex, {})["age"] = {AGE[k]: round(v / total, 3) for k, v in d.items() if k in AGE}

    # Prices: PPP conversion factor (2021) and CPI ratio latest/2021.
    ppp = wb_series("PA.NUS.PRVT.PP")
    cpi = wb_series("FP.CPI.TOTL")
    for iso3 in set(ppp) | set(cpi):
        node = out.setdefault(iso3, {})
        if 2021 in ppp.get(iso3, {}):
            node["ppp2021"] = ppp[iso3][2021]
        c = cpi.get(iso3, {})
        if 2021 in c and max(c) > 2021:
            node["cpi_ratio"] = round(c[max(c)] / c[2021], 4)
            node["cpi_year"] = max(c)

    # Currencies (CLDR): the territory's tender currency without an end date.
    cur = get(RAW / "cldr" / "currencyData.json", CLDR)["supplemental"]["currencyData"]["region"]
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    for iso3, c in countries.items():
        for entry in cur.get(c["iso2"], []):
            code, info = next(iter(entry.items()))
            if "_to" not in info and info.get("_tender") != "false":
                out.setdefault(iso3, {})["currency"] = code
                break

    (OUT / "earnings.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    tot = sum(c["births"] for c in countries.values())
    for name, ok in (("earnings by occupation", lambda v: all("ocu" in v.get(s, {}) for s in "MF")),
                     ("earnings by age", lambda v: all("age" in v.get(s, {}) for s in "MF")),
                     ("PPP 2021", lambda v: "ppp2021" in v), ("CPI", lambda v: "cpi_ratio" in v), ("currency", lambda v: "currency" in v)):
        have = [k for k in countries if ok(out.get(k, {}))]
        print(f"{name:24s} {len(have):3d}/158 {sum(countries[k]['births'] for k in have) / tot:4.0%} of births")
    v = out["VNM"]
    print("VNM:", {s: v[s].get("ocu", {}).get("TOTAL") for s in "MF"}, "PPP$/month 2021 |", v.get("ppp2021"), "VND per $ |",
          v.get("cpi_ratio"), "CPI ratio |", v.get("currency"))


if __name__ == "__main__":
    main()
