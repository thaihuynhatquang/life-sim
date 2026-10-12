"""Fetch World Bank WDI indicators for all countries and build data/out/wb_latest.json.

For each indicator, keeps the most recent non-null value in [YEAR_FROM, YEAR_TO] and records
its year, so we always know how stale a number is.

Usage: python fetch_worldbank.py [--refresh]
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

from indicators import CORE_KEYS, EDSTATS_INDICATORS, MIN_POPULATION, WB_INDICATORS, YEAR_FROM, YEAR_TO

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "wb"
OUT = ROOT / "out"
API = "https://api.worldbank.org/v2"


def get_json(url: str, retries: int = 3):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # network hiccups are common on this API
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1}: {e}")
            time.sleep(2 * (attempt + 1))


def cached(name: str, url: str, refresh: bool):
    path = RAW / f"{name}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    data = get_json(url)
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


def fetch_countries(refresh: bool) -> dict:
    """Real countries only (the API mixes in aggregates like 'World', 'Low income')."""
    data = cached("_countries", f"{API}/country?format=json&per_page=400", refresh)
    out = {}
    for c in data[1]:
        if c["region"]["id"] == "NA":  # aggregates have no region
            continue
        out[c["id"]] = {
            "iso3": c["id"],
            "iso2": c["iso2Code"],
            "name_en": c["name"],
            "wb_region": c["region"]["value"].strip(),
            "wb_income": c["incomeLevel"]["value"].strip(),
            "capital": c["capitalCity"],
            "lat": float(c["latitude"]) if c["latitude"] else None,
            "lon": float(c["longitude"]) if c["longitude"] else None,
        }
    return out


def fetch_indicator(key: str, code: str, refresh: bool, source: int | None = None) -> dict:
    url = f"{API}/country/all/indicator/{code}?format=json&date={YEAR_FROM}:{YEAR_TO}&per_page=20000"
    if source:
        url += f"&source={source}"
    data = cached(key, url, refresh)
    if len(data) < 2 or data[1] is None:
        print(f"  !! {key} ({code}) returned no data: {data[0]}")
        return {}
    latest = {}
    for row in data[1]:
        iso3, val, yr = row["countryiso3code"], row["value"], int(row["date"])
        if not iso3 or val is None:
            continue
        if iso3 not in latest or yr > latest[iso3][1]:
            latest[iso3] = (val, yr)
    return latest


def main():
    refresh = "--refresh" in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    countries = fetch_countries(refresh)
    print(f"{len(countries)} countries/territories")

    for key, (code, _desc), source in [(k, v, None) for k, v in WB_INDICATORS.items()] + [(k, v, 12) for k, v in EDSTATS_INDICATORS.items()]:
        print(f"- {key:15s} {code}")
        latest = fetch_indicator(key, code, refresh, source)
        for iso3, c in countries.items():
            if iso3 in latest:
                c[key], c[f"{key}_yr"] = latest[iso3]

    # Unfiltered: build_countries.py merges this with UN WPP and decides which countries to keep.
    (OUT / "wb_all.json").write_text(json.dumps(countries, ensure_ascii=False, indent=1), encoding="utf-8")

    kept, dropped = {}, []
    for iso3, c in countries.items():
        if c.get("pop", 0) < MIN_POPULATION:
            continue
        missing = [k for k in CORE_KEYS if k not in c]
        if missing:
            dropped.append((iso3, c["name_en"], missing))
            continue
        c["births"] = round(c["cbr"] / 1000 * c["pop"])
        kept[iso3] = c

    (OUT / "wb_latest.json").write_text(json.dumps(kept, ensure_ascii=False, indent=1), encoding="utf-8")

    # Coverage report: how many kept countries have each indicator, and how old the data is.
    print(f"\nKept {len(kept)} countries (pop >= {MIN_POPULATION:,}).")
    if dropped:
        print("Dropped for missing core data:")
        for iso3, name, missing in dropped:
            print(f"  {iso3} {name}: {', '.join(missing)}")
    total_births = sum(c["births"] for c in kept.values())
    print(f"Births covered: {total_births / 1e6:.1f}M/year\n")
    print(f"{'key':15s} {'have':>5s} {'median yr':>9s} {'oldest':>6s}")
    for key in list(WB_INDICATORS) + list(EDSTATS_INDICATORS):
        yrs = sorted(c[f"{key}_yr"] for c in kept.values() if f"{key}_yr" in c)
        if yrs:
            print(f"{key:15s} {len(yrs):5d} {yrs[len(yrs) // 2]:9d} {yrs[0]:6d}")
        else:
            print(f"{key:15s} {0:5d}")


if __name__ == "__main__":
    main()
