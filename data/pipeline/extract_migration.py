"""Emigration, destinations, refugees and internal displacement by country of birth -> data/out/migration.json.

- UN DESA International Migrant Stock 2024 (destination x origin, by sex): share of people born in each
  country who live abroad, and where they live.
- UN DESA International Migrant Stock 2020 by age: migrants as % of population by age (world), used as
  the age profile of emigration.
- UNHCR Refugee Data Finder API (2024): refugees + asylum seekers, and internally displaced people, by
  country of origin.

Usage: python extract_migration.py   (needs the two UN DESA xlsx files in data/raw/un/; fetches UNHCR)
"""

import json
import urllib.request
from collections import defaultdict
from pathlib import Path

from xlsx import Workbook

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
OUT = ROOT / "out"
OD = RAW / "un" / "undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx"
AGE = RAW / "un" / "undesa_pd_2020_ims_stock_by_age_sex_and_destination.xlsx"
UNHCR = "https://api.unhcr.org/population/v1/population/?limit=1000&yearFrom=2024&yearTo=2024&coo_all=true&page={}"
TOP_DEST = 12


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def unhcr() -> dict:
    path = RAW / "unhcr" / "population_by_origin_2024.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        items, page = [], 1
        while True:
            req = urllib.request.Request(UNHCR.format(page), headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=300) as r:
                d = json.load(r)
            items += d["items"]
            if page >= d["maxPages"]:
                break
            page += 1
        path.write_text(json.dumps(items), encoding="utf-8")
    out = {}
    for r in json.loads(path.read_text(encoding="utf-8")):
        out[r["coo_iso"]] = {"refugees": num(r["refugees"]) + num(r["asylum_seekers"]), "idps": num(r["idps"])}
    return out


def main():
    wpp = json.loads((OUT / "wpp_demo.json").read_text(encoding="utf-8"))
    iso3_of = {v["loc_id"]: k for k, v in wpp.items()}  # countries only (aggregates have other codes)
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))

    # Origin-destination stock, 2024: columns 7..14 both sexes 1990..2024, 15..22 male, 23..30 female.
    stock = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0]))  # origin -> dest -> [total, M, F]
    for r in Workbook(OD).rows("Table 1"):
        if len(r) < 31 or not isinstance(r[4], float) or not isinstance(r[6], float):
            continue
        dest, orig = iso3_of.get(int(r[4])), iso3_of.get(int(r[6]))
        if dest and orig and dest != orig:
            stock[orig][dest] = [num(r[14]), num(r[22]), num(r[30])]

    # Age profile: migrants as % of population by age, world, 2020 (Table 3, both sexes).
    age_groups = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75]
    profile = None
    for r in Workbook(AGE).rows("Table 3"):
        if len(r) > 22 and r[2] == "WORLD" and r[1] == 2020.0:
            profile = [round(num(x), 3) for x in r[6:22]]
    refugees = unhcr()

    out = {}
    for iso3, c in countries.items():
        dests = stock.get(iso3, {})
        tot = [sum(v[i] for v in dests.values()) for i in range(3)]
        pop = wpp.get(iso3, {}).get("pop", c["pop"])
        ranked = sorted(dests.items(), key=lambda kv: -kv[1][0])
        top = [[d, round(v[0] / tot[0], 4)] for d, v in ranked[:TOP_DEST] if tot[0] > 0 and d in countries]
        u = refugees.get(iso3, {"refugees": 0, "idps": 0})
        out[iso3] = {
            # Share of people born here who live abroad: emigrants / (emigrants + residents), by sex.
            "abroad": {"M": round(tot[1] / (tot[1] + pop / 2), 5) if tot[1] else 0.0,
                       "F": round(tot[2] / (tot[2] + pop / 2), 5) if tot[2] else 0.0},
            "dest": top,
            "refugee_share": round(min(1.0, u["refugees"] / tot[0]), 4) if tot[0] else 0.0,
            "idp": round(u["idps"] / pop, 5),
        }
    (OUT / "migration.json").write_text(json.dumps({"age_groups": age_groups, "age_profile": profile, "countries": out},
                                                   ensure_ascii=False, indent=1), encoding="utf-8")
    print("age profile (migrants % of population, world 2020):", profile)
    for k in ("MEX", "IND", "PHL", "VNM", "SYR", "AFG", "UKR", "NGA", "USA", "CHN"):
        v = out[k]
        print(f"  {k}: abroad M {100 * v['abroad']['M']:.1f}% F {100 * v['abroad']['F']:.1f}% | refugees {100 * v['refugee_share']:.0f}% of emigrants"
              f" | IDP {100 * v['idp']:.1f}% | to {', '.join(f'{d} {100 * s:.0f}%' for d, s in v['dest'][:4])}")


if __name__ == "__main__":
    main()
