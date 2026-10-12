"""Educational mobility by country from the World Bank Global Database on Intergenerational Mobility (GDIM 2023)
-> data/out/gdim.json.

COR = correlation between parents' (average of both) and children's years of schooling, for the most
recent cohort (born in the 1980s), all children. Used as the link between family background and
education in the simulation.

Usage: python extract_gdim.py   (needs data/raw/gdim/GDIM_2023_03.csv from the World Bank data catalog)
"""

import csv
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "raw" / "gdim" / "GDIM_2023_03.csv"
OUT = ROOT / "out"


def main():
    best = {}
    with open(SRC, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r["parent"] != "avg" or r["child"] != "all" or not r["COR"]:
                continue
            key, cohort = r["code"], int(r["cohort"])
            if key not in best or cohort > best[key]["cohort"]:
                best[key] = {"cor": round(float(r["COR"]), 3), "cohort": cohort, "survey": f'{r["survey"]} {r["year"]}'}
    (OUT / "gdim.json").write_text(json.dumps(best, indent=1), encoding="utf-8")
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    have = [k for k in countries if k in best]
    cors = [best[k]["cor"] for k in have]
    print(f"{len(have)}/{len(countries)} countries ({sum(countries[k]['births'] for k in have) / sum(c['births'] for c in countries.values()):.0%} of births); "
          f"COR median {statistics.median(cors):.2f}, range {min(cors):.2f}..{max(cors):.2f}")
    for k in ("VNM", "IND", "NGA", "USA", "CHN", "BRA", "DNK", "PAK"):
        print(" ", k, best.get(k))


if __name__ == "__main__":
    main()
