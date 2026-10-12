"""Common given names by country and sex -> data/out/names.json.

Source: Wikipedia, "List of most popular given names" (tables of the 10 most common names by country,
compiled from national statistics offices and registries; some rows are names of babies born in a
recent year, some of the whole population). All rows for a country are pooled. Names are kept in their
Latin-script form (native script dropped).

Countries without a row borrow the names of a country with a close language and naming culture (DONOR,
chosen by hand), else the nearest country by GDP per capita in the same region; marked as borrowed.

Usage: python extract_names.py
"""

import json
import math
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "names"
OUT = ROOT / "out"
URL = "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_most_popular_given_names&prop=wikitext&format=json"
ALIASES = {"United States": "USA", "China": "CHN", "Russia": "RUS", "South Korea": "KOR", "Vietnam": "VNM",
           "Turkey": "TUR", "Iran": "IRN", "Czech Republic": "CZE", "Ivory Coast": "CIV", "Hong Kong": "HKG",
           "Democratic Republic of the Congo": "COD", "Republic of the Congo": "COG", "Tanzania": "TZA",
           "Syria": "SYR", "Laos": "LAO", "Moldova": "MDA", "Bolivia": "BOL", "Venezuela": "VEN", "Palestine": "PSE",
           "State of Palestine": "PSE", "North Macedonia": "MKD", "Kyrgyzstan": "KGZ", "Myanmar": "MMR", "Burma": "MMR",
           "The Gambia": "GMB", "Gambia": "GMB", "Kosovo": "XKX", "Puerto Rico": "PRI", "Eswatini": "SWZ", "Cape Verde": "CPV",
           "England and Wales": "GBR", "England": "GBR", "Scotland": "GBR", "United Kingdom": "GBR",
           "Bosnia and Herzegovina": "BIH", "Slovakia": "SVK", "Korea": "KOR", "Brunei": "BRN", "Timor-Leste": "TLS", "East Timor": "TLS"}
# Countries without a row borrow from a country with a close language and naming culture (ASSUMPTION,
# chosen by hand): Lusophone -> Portugal, Muslim West Africa -> Mali/Senegal, English-speaking Christian
# East and Southern Africa -> Liberia, Southern African Bantu -> South Africa, Gulf and Levant -> Saudi
# Arabia/Jordan, French-speaking Central Africa and Madagascar -> France (closest available).
DONOR = {"AGO": "PRT", "MOZ": "PRT", "GNB": "PRT", "BFA": "MLI", "NER": "MLI", "GIN": "MLI", "CIV": "MLI", "TCD": "SDN",
         "GMB": "SEN", "MRT": "MAR", "BEN": "FRA", "TGO": "FRA", "CMR": "FRA", "GAB": "FRA", "COG": "FRA", "COD": "FRA",
         "CAF": "FRA", "BDI": "FRA", "RWA": "FRA", "MDG": "FRA", "KEN": "LBR", "UGA": "LBR", "TZA": "LBR", "ZMB": "LBR",
         "MWI": "LBR", "ZWE": "LBR", "SSD": "LBR", "GHA": "LBR", "BWA": "ZAF", "NAM": "ZAF", "LSO": "ZAF", "SWZ": "ZAF",
         "ERI": "ETH", "DJI": "SOM", "AFG": "PAK", "IRQ": "SAU", "YEM": "SAU", "OMN": "SAU", "QAT": "SAU", "SYR": "JOR",
         "PSE": "JOR", "MUS": "IND", "GEO": "ARM", "MDA": "ROU", "TKM": "UZB", "XKX": "ALB", "HKG": "CHN", "SGP": "CHN",
         "LAO": "THA", "PNG": "AUS", "TTO": "JAM"}
LINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")


def strip_refs(text: str) -> str:
    text = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"\{\{ill\|([^|}]+)[^}]*\}\}", r"\1", text)  # {{ill|Name|lang|...}} -> Name
    return re.sub(r"\{\{[^}]*\}\}", "", text)


def clean_name(cell: str) -> str | None:
    cell = strip_refs(cell)
    m = LINK.search(cell)
    text = (m.group(2) or m.group(1)) if m else cell
    text = re.sub(r"\(.*?\)", "", text)
    # Keep Latin letters (with diacritics), spaces, hyphens and apostrophes; stop at the first other script.
    keep = re.match(r"[\sA-Za-zÀ-ɏḀ-ỿ'’\-]+", text.strip())
    name = keep.group(0).strip(" -'’") if keep else ""
    # Table placeholders such as 'NA' or 'N/A' are not names.
    if name.isupper() or name.lower() in ('na', 'none', 'unknown'):
        return None
    return name if 1 < len(name) < 25 else None


def place_iso3(cell: str, names_of: dict) -> str | None:
    """The country of a row's first cell: a link or plain text, maybe 'City, Country' or 'England, United Kingdom'."""
    cell = strip_refs(cell)
    parts = [m.group(1) for m in LINK.finditer(cell)] or [re.sub(r"\(.*", "", cell)]
    for part in parts:
        for piece in [part] + [x for x in re.split(r",\s*", part)][::-1]:
            piece = piece.strip()
            iso3 = ALIASES.get(piece) or names_of.get(piece)
            if iso3:
                return iso3
    return None


def parse(text: str, countries: dict) -> dict:
    names_of = {c["name"]["en"]: k for k, c in countries.items()}
    out: dict = {}
    for region in re.split(r"\n=== ", text)[1:]:
        for sex_block in re.split(r"\n==== ", region)[1:]:
            sex = "M" if sex_block.startswith("Male") else "F" if sex_block.startswith("Female") else None
            if not sex:
                continue
            for row in sex_block.split("\n|-")[1:]:
                row = row.strip()
                if not row.startswith("|") or row.startswith("|}"):
                    continue
                cells = re.split(r"\|\||\n\|", strip_refs(row.lstrip("|")))
                iso3 = place_iso3(cells[0], names_of)
                if not iso3:
                    continue
                lst = out.setdefault(iso3, {}).setdefault(sex, [])
                for n in (clean_name(c) for c in cells[1:]):
                    if n and n not in lst:
                        lst.append(n)
    return out


def main():
    path = RAW / "popular.json"
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "life-sim research"}), timeout=120) as r:
            path.write_bytes(r.read())
    text = json.loads(path.read_text(encoding="utf-8"))["parse"]["wikitext"]["*"]
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    found = {k: v for k, v in parse(text, countries).items() if k in countries and len(v.get("M", [])) >= 3 and len(v.get("F", [])) >= 3}
    out = {k: {"M": v["M"][:30], "F": v["F"][:30], "src": "Wikipedia"} for k, v in found.items()}
    for k, c in countries.items():
        if k in out:
            continue
        ref = DONOR.get(k) if DONOR.get(k) in found else None
        if ref is None:
            same = [o for o in found if countries[o]["region"] == c["region"]] or list(found)
            ref = min(same, key=lambda o: abs(math.log(countries[o]["gdp_ppp"] / c["gdp_ppp"])))
        out[k] = {"M": out[ref]["M"], "F": out[ref]["F"], "src": f"borrowed from {ref}"}
    (OUT / "names.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    tot = sum(c["births"] for c in countries.values())
    print(f"names from Wikipedia: {len(found)}/158 countries, {sum(countries[k]['births'] for k in found) / tot:.0%} of births")
    print("borrowed:", sorted(k for k, v in out.items() if v["src"] != "Wikipedia"))
    for k in ("VNM", "IND", "CHN", "NGA", "USA", "BRA", "ETH"):
        print(f"  {k} {out[k]['src']}: M {out[k]['M'][:6]} | F {out[k]['F'][:6]}")


if __name__ == "__main__":
    main()
