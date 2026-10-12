"""Fetch WHO Global Health Estimates (deaths by cause, age, sex) for every country in countries.json.

Level-3 causes (136 of them, which together add up to all deaths), year GHE_YEAR, cached per country in
data/raw/ghe/. Source: WHO GHE via the public xmart API (DEX_CMS/GHE_FULL).

Usage: python fetch_ghe.py
"""

import json
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "ghe"
API = "https://xmart-api-public.who.int/DEX_CMS/GHE_FULL"
GHE_YEAR = 2023


def fetch(iso3: str) -> list:
    q = urllib.parse.urlencode({
        "$filter": f"DIM_COUNTRY_CODE eq '{iso3}' and DIM_YEAR_CODE eq {GHE_YEAR} and FLAG_LEVEL le 3",
        "$select": "DIM_SEX_CODE,DIM_AGEGROUP_CODE,DIM_GHECAUSE_CODE,DIM_GHECAUSE_TITLE,FLAG_LEVEL,VAL_DTHS_COUNT_NUMERIC",
    })
    rows, url = [], f"{API}?{q}"
    while url:
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=300) as r:
                    d = json.load(r)
                break
            except Exception as e:
                if attempt == 4:
                    raise
                print(f"  {iso3} retry {attempt + 1}: {e}")
                time.sleep(5 * (attempt + 1))
        rows += d["value"]
        url = d.get("@odata.nextLink")
    return rows


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    countries = json.loads((ROOT / "out" / "countries.json").read_text(encoding="utf-8"))
    todo = [k for k in sorted(countries) if not (RAW / f"{k}.json").exists()]

    def one(iso3):
        rows = fetch(iso3)
        tmp = RAW / f"{iso3}.json.part"  # write then rename, so an interrupted run never leaves a half file
        tmp.write_text(json.dumps(rows), encoding="utf-8")
        tmp.replace(RAW / f"{iso3}.json")
        return iso3, len(rows)

    # The API takes ~10 s per country; a few requests in parallel cut the wait several-fold.
    with ThreadPoolExecutor(max_workers=6) as pool:
        for n, (iso3, count) in enumerate(pool.map(one, todo), 1):
            print(f"[{n}/{len(todo)}] {iso3}: {count} rows", flush=True)
    missing = [k for k in countries if not (RAW / f"{k}.json").exists() or len(json.loads((RAW / f'{k}.json').read_text())) == 0]
    print("done; empty/missing:", missing)


if __name__ == "__main__":
    main()
