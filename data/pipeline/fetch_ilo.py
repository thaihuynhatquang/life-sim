"""ILO modelled estimates of labour force participation by sex and age (25-54, 55-64, 65+) -> data/out/ilo.json.

Used to model when people stop working. Source: ILOSTAT API, indicator EAP_2WAP_SEX_AGE_RT_A
(ILO modelled estimates). The API needs browser-like headers to return data.

Usage: python fetch_ilo.py
"""

import gzip
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "ilo"
OUT = ROOT / "out"
YEAR = 2024
URL = f"https://rplumber.ilo.org/data/indicator/?id=EAP_2WAP_SEX_AGE_RT_A&time={YEAR}&format=.json"
BANDS = {"AGE_AGGREGATE_Y25-54": "p25", "AGE_AGGREGATE_Y55-64": "p55", "AGE_AGGREGATE_YGE65": "p65"}


def fetch(name: str, url: str) -> list:
    path = RAW / name
    if not path.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"})
        with urllib.request.urlopen(req, timeout=900) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
        path.write_bytes(body)
    return json.loads(path.read_text(encoding="utf-8"))


def unemployment(out: dict):
    """Unemployment rate by sex for ages 15-24 and 25+ (ILO modelled), and the share of the unemployed
    out of work 12+ months (latest labour force survey), from which the mean spell length follows."""
    base = "https://rplumber.ilo.org/data/indicator/?format=.json"
    for r in fetch(f"UNE_2EAP_SEX_AGE_RT_A_{YEAR}.json", f"{base}&id=UNE_2EAP_SEX_AGE_RT_A&time={YEAR}"):
        band = {"AGE_YTHADULT_Y15-24": "u15", "AGE_YTHADULT_YGE25": "u25"}.get(r["classif1"])
        sex = {"SEX_M": "M", "SEX_F": "F"}.get(r["sex"])
        if band and sex and r.get("obs_value") is not None:
            out.setdefault(r["ref_area"], {}).setdefault(sex, {})[band] = round(r["obs_value"] / 100, 4)
    dur = {}
    rows = fetch("UNE_TUNE_SEX_AGE_DUR_NB_A_latest.json",
                 f"{base}&id=UNE_TUNE_SEX_AGE_DUR_NB_A&sex=SEX_T&classif1=AGE_YTHADULT_YGE15&latestyear=true")
    for r in rows:
        if r.get("obs_value") is not None and int(r["time"]) >= 2010:
            dur.setdefault((r["ref_area"], r["time"]), {})[r["classif2"]] = r["obs_value"]
    for (iso3, year), d in dur.items():
        known = d.get("DUR_AGGREGATE_TOTAL", 0) - d.get("DUR_AGGREGATE_X", 0)
        if known > 0 and "DUR_AGGREGATE_MGE12" in d and 0 < d["DUR_AGGREGATE_MGE12"] < known:
            if iso3 not in out or out[iso3].get("ltu_year", 0) < int(year):
                out.setdefault(iso3, {})["ltu"] = round(d["DUR_AGGREGATE_MGE12"] / known, 4)
                out[iso3]["ltu_year"] = int(year)


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    rows = fetch(f"EAP_2WAP_SEX_AGE_RT_A_{YEAR}.json", URL)
    out = {}
    for r in rows:
        band = BANDS.get(r["classif1"])
        sex = {"SEX_M": "M", "SEX_F": "F"}.get(r["sex"])
        if band and sex and r.get("obs_value") is not None:
            out.setdefault(r["ref_area"], {}).setdefault(sex, {})[band] = round(r["obs_value"] / 100, 4)
    unemployment(out)
    (OUT / "ilo.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    have = [k for k in countries if all(all(b in out.get(k, {}).get(s, {}) for b in ("p25", "p55", "p65")) for s in "MF")]
    ltu = [k for k in countries if "ltu" in out.get(k, {})]
    print(f"long-term unemployment share: {len(ltu)} countries "
          f"({sum(countries[k]['births'] for k in ltu) / sum(c['births'] for c in countries.values()):.0%} of births)")
    print(f"{len(have)}/{len(countries)} countries; missing: {[k for k in countries if k not in have]}")
    for k in ("VNM", "NGA", "USA", "JPN", "IND"):
        print(" ", k, out.get(k))


if __name__ == "__main__":
    main()
