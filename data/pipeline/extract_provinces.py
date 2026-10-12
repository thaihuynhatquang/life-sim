"""First-level administrative divisions (provinces, states, regions) with population weights ->
data/out/provinces.json.

Source: GeoNames (CC BY 4.0): admin1CodesASCII.txt for the names of first-level divisions, and
cities500.zip (every populated place of 500 people or more, with its population and admin1 code).
A division's weight is the population of its places: for urban births, places of 50,000 or more; for
rural births, smaller places. Used only to name where someone is born or lives; living conditions still
follow the national data.

Usage: python extract_provinces.py   (downloads into data/raw/geonames/ if missing)
"""

import csv
import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "geonames"
OUT = ROOT / "out"
BASE = "https://download.geonames.org/export/dump/"
URBAN_MIN = 50_000
SUFFIX = re.compile(r"\s+(Autonomous Region|Autonomous District|Special Region|Capital Region|Capital District|Federal District|"
                    r"Province|Region|State|Governorate|Prefecture|District|County|Oblast|Municipality|Department|Division|"
                    r"Territory|Voivodeship)$")


# Vietnamese names with diacritics for Viet Nam's 34 provinces (GeoNames has many in plain ASCII).
NAME_FIX = {"VN": {"An Giang": "An Giang", "Bac Ninh": "Bắc Ninh", "Ca Mau": "Cà Mau", "Can Tho": "Cần Thơ", "Da Nang": "Đà Nẵng",
                   "Dak Lak": "Đắk Lắk", "Dong Nai": "Đồng Nai", "Dong Thap": "Đồng Tháp", "Hai Phong": "Hải Phòng", "Hanoi": "Hà Nội",
                   "Ho Chi Minh": "TP. Hồ Chí Minh", "Khanh Hoa": "Khánh Hòa", "Lam Dong": "Lâm Đồng", "Lao Cai": "Lào Cai",
                   "Ninh Binh": "Ninh Bình", "Phu Tho": "Phú Thọ", "Quang Ngai": "Quảng Ngãi", "Quang Tri": "Quảng Trị",
                   "Tay Ninh": "Tây Ninh", "Thai Nguyen": "Thái Nguyên", "Thừa Thiên Huế": "Huế", "Tuyen Quang": "Tuyên Quang",
                   "Vinh Long": "Vĩnh Long"}}


def clean(cc: str, name: str) -> str:
    name = re.sub(r"\s*\(.*?\)", "", name).strip()
    name = SUFFIX.sub("", name).strip()
    name = re.sub(r"\s+City$", "", name).strip()
    return NAME_FIX.get(cc, {}).get(name, name)


def fetch(name: str) -> Path:
    path = RAW / name
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(BASE + name, timeout=900) as r:
            path.write_bytes(r.read())
    return path


def main():
    names = {}
    for line in fetch("admin1CodesASCII.txt").read_text(encoding="utf-8").splitlines():
        code, name, *_ = line.split("\t")
        names[code] = clean(code.split(".")[0], name)
    weights: dict = {}
    with zipfile.ZipFile(fetch("cities500.zip")) as z:
        with z.open("cities500.txt") as f:
            for row in csv.reader(io.TextIOWrapper(f, encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE):
                cc, a1, pop = row[8], row[10], int(row[14] or 0)
                key = f"{cc}.{a1}"
                if key not in names or pop <= 0:
                    continue
                w = weights.setdefault(cc, {}).setdefault(key, [0, 0])
                w[0 if pop >= URBAN_MIN else 1] += pop
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    out = {}
    for iso3, c in countries.items():
        w = weights.get(c["iso2"], {})
        urban = sorted(([names[k], v[0]] for k, v in w.items() if v[0] > 0), key=lambda x: -x[1])
        rural = sorted(([names[k], v[1]] for k, v in w.items() if v[1] > 0), key=lambda x: -x[1])
        if not urban:
            urban = rural
        if urban and rural:
            out[iso3] = {"urban": urban, "rural": rural}
    (OUT / "provinces.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    tot = sum(c["births"] for c in countries.values())
    print(f"provinces for {len(out)}/158 countries, {sum(countries[k]['births'] for k in out) / tot:.0%} of births")
    print("missing:", sorted(k for k in countries if k not in out))
    for k in ("VNM", "USA", "NGA", "IND", "CHN"):
        if k in out:
            print(f"  {k}: {len(out[k]['urban'])} divisions; urban top {[n for n, _ in out[k]['urban'][:4]]}; rural top {[n for n, _ in out[k]['rural'][:4]]}")


if __name__ == "__main__":
    main()
