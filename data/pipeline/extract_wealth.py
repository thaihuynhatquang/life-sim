"""Wealth and top incomes (World Inequality Database) and billionaires (Forbes) -> data/out/wealth.json.

WID (wid_all_data.zip, bulk download): for each country, the latest year's thresholds of net personal
wealth per adult (thwealj992) and pre-tax national income per adult (tptincj992) at every percentile,
down to the top 0.001%. WID amounts are in local currency at the reference year's prices; converted
with WID's own market exchange rate (xlcusxi999) and PPP factor (xlcuspi999) for that year, and to 2021
PPP dollars with US CPI.

Forbes (March 2026, via the Wikipedia list "List of countries by number of billionaires"): billionaires
by country of citizenship.

Usage: python extract_wealth.py   (needs data/raw/wid/wid_all_data.zip)
"""

import csv
import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
OUT = ROOT / "out"
WIKI = "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_countries_by_number_of_billionaires&prop=wikitext&format=json"
PCT = re.compile(r"^p([\d.]+)p([\d.]+)$")


def wid_country(z: zipfile.ZipFile, iso2: str):
    name = f"WID_data_{iso2}.csv"
    if name not in z.namelist():
        return None
    series: dict = {}
    with z.open(name) as f:
        r = csv.reader(io.TextIOWrapper(f, encoding="utf-8"), delimiter=";")
        next(r)
        for row in r:
            var, pct, year, value = row[1], row[2], int(row[3]), row[4]
            if var in ("thwealj992", "tptincj992", "xlcusxi999", "xlcuspi999", "ahwealj992", "npopuli992") and value:
                series.setdefault(var, {}).setdefault(year, {})[pct] = float(value)
    if "thwealj992" not in series or "xlcusxi999" not in series:
        return None

    def latest(var):
        years = [y for y, d in series.get(var, {}).items() if y <= 2024 and len(d) >= 50]
        return max(years) if years else None

    out = {}
    fx = series["xlcusxi999"]
    ppp = series.get("xlcuspi999", {})
    ref = max(y for y in fx if y <= 2024)  # WID amounts are at this year's local prices
    for var, key in (("thwealj992", "wealth"), ("tptincj992", "income")):
        y = latest(var)
        if y is None:
            continue
        pts = []
        for pct, v in series[var][y].items():
            m = PCT.match(pct)
            if m:
                pts.append((float(m.group(1)) / 100, v))
        pts.sort()
        out[key] = {"year": y, "q": [round(p, 6) for p, _ in pts], "lcu": [v for _, v in pts]}
    pop = series.get("npopuli992", {})
    if pop:
        py = max(y for y in pop if y <= 2024)
        out["adults"] = pop[py].get("p0p100")  # people aged 20+
    out["fx_usd"] = fx[ref]["p0p100"]
    out["ppp"] = ppp.get(ref, {}).get("p0p100")
    out["ref_year"] = ref
    return out


def forbes() -> dict:
    path = RAW / "wid" / "_billionaires_wiki.json"
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(WIKI, headers={"User-Agent": "life-sim research"}), timeout=120) as r:
            path.write_bytes(r.read())
    text = json.loads(path.read_text(encoding="utf-8"))["parse"]["wikitext"]["*"]
    # The page has two tables: Forbes first, then Hurun. Read only the Forbes one.
    text = text[:text.index("{|", text.index("{|") + 2)]
    out = {}
    for m in re.finditer(r"\{\{flag\|([^}|]+)[^}]*\}\}\s*\n?\|\|?\s*align=\"center\"\s*\|([\d,]+)", text):
        out[m.group(1).strip()] = int(m.group(2).replace(",", ""))
    return out


ALIASES = {"United States": "USA", "China": "CHN", "Russia": "RUS", "South Korea": "KOR", "Hong Kong": "HKG",
           "Taiwan": "TWN", "Czech Republic": "CZE", "Vietnam": "VNM", "Turkey": "TUR", "Iran": "IRN",
           "Democratic Republic of the Congo": "COD", "Ivory Coast": "CIV", "Tanzania": "TZA", "Venezuela": "VEN"}


def main():
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    us = json.loads((RAW / "wb" / "_series_FP.CPI.TOTL.json").read_text(encoding="utf-8"))[1]
    us_cpi = {int(r["date"]): r["value"] for r in us if r["countryiso3code"] == "USA" and r["value"]}
    z = zipfile.ZipFile(RAW / "wid" / "wid_all_data.zip")
    out = {}
    for iso3, c in countries.items():
        w = wid_country(z, c["iso2"])
        if not w or not w.get("ppp"):
            continue
        to2021 = us_cpi[2021] / us_cpi[w["ref_year"]]
        rec = {"ref_year": w["ref_year"], "adults": w.get("adults")}
        for key in ("wealth", "income"):
            if key in w:
                rec[key] = {"year": w[key]["year"], "q": w[key]["q"],
                            "ppp": [round(v / w["ppp"] * to2021, 1) for v in w[key]["lcu"]],
                            "usd": [round(v / w["fx_usd"], 1) for v in w[key]["lcu"]]}
        out[iso3] = rec

    names = {c["name"]["en"]: k for k, c in countries.items()}
    bill = forbes()
    counts = {}
    for name, n in bill.items():
        iso3 = ALIASES.get(name) or names.get(name)
        if iso3:
            counts[iso3] = n
    for iso3 in countries:
        out.setdefault(iso3, {})["billionaires"] = counts.get(iso3, 0)
    (OUT / "wealth.json").write_text(json.dumps(out), encoding="utf-8")

    tot = sum(c["births"] for c in countries.values())
    have = [k for k in countries if "wealth" in out.get(k, {})]
    print(f"WID wealth thresholds: {len(have)}/158 ({sum(countries[k]['births'] for k in have) / tot:.0%} of births)")
    print(f"Forbes billionaires matched: {sum(counts.values())} in {len(counts)} countries (Forbes world total 3,428)")
    unmatched = [k for k in bill if k not in ALIASES and k not in names and k != "World"]
    print("unmatched Forbes names:", unmatched)
    for k in ("VNM", "USA", "NGA", "IND", "CHN"):
        w = out[k].get("wealth")
        if w:
            q = dict(zip(w["q"], w["usd"]))
            print(f"  {k} {w['year']}: median wealth ${q.get(0.5, 0):,.0f} | top 1% ${q.get(0.99, 0):,.0f} | top 0.01% ${q.get(0.9999, 0):,.0f} (USD) | billionaires {out[k]['billionaires']}")


if __name__ == "__main__":
    main()
