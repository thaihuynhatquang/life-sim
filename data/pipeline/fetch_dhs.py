"""Under-5 mortality by household wealth quintile from DHS surveys -> data/out/dhs.json.

For each country, the most recent DHS survey (since 2005) with all five quintiles. The wealth gradient
beta is fitted as log(U5MR_q) = a - beta * zbar_q, where zbar_q is the mean of a standard normal wealth
score within quintile q (-1.40, -0.53, 0, 0.53, 1.40) - the same scale the simulation uses.

Source: DHS Program STATcompiler API (api.dhsprogram.com), indicator CM_ECMR_C_U5M.
Usage: python fetch_dhs.py
"""

import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "dhs"
OUT = ROOT / "out"
API = "https://api.dhsprogram.com/rest/dhs"
INDICATOR = "CM_ECMR_C_U5M"
MIN_YEAR = 2005
QUINTILES = ["Lowest", "Second", "Middle", "Fourth", "Highest"]


def phi(x):
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def inv_norm(p):
    lo, hi = -10.0, 10.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if 0.5 * (1 + math.erf(mid / math.sqrt(2))) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# Mean of a standard normal within each fifth: (phi(a) - phi(b)) / 0.2.
CUTS = [-math.inf] + [inv_norm(k / 5) for k in range(1, 5)] + [math.inf]
ZBAR = [((phi(CUTS[i]) if CUTS[i] != -math.inf else 0) - (phi(CUTS[i + 1]) if CUTS[i + 1] != math.inf else 0)) / 0.2 for i in range(5)]


def quintile_means(beta, n=2000):
    """E[exp(-beta Z) | Z in fifth k] for a standard normal Z (midpoint rule on equal-probability bins)."""
    m = [0.0] * 5
    for i in range(n):
        z = inv_norm((i + 0.5) / n)
        m[i * 5 // n] += math.exp(-beta * z) / (n / 5)
    return m


_QM = {b: [math.log(x) for x in quintile_means(b / 1000)] for b in range(-200, 1001, 5)}


def fit_beta(u5):
    """beta whose model quintile rates best match the survey's (least squares on logs, free level)."""
    y = [math.log(x) for x in u5]
    best = None
    for b, lm in _QM.items():
        shift = sum(yi - li for yi, li in zip(y, lm)) / 5
        err = sum((yi - li - shift) ** 2 for yi, li in zip(y, lm))
        if best is None or err < best[0]:
            best = (err, b / 1000)
    return best[1]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    cache = RAW / f"{INDICATOR}.json"
    if not cache.exists():
        iso = {c["DHS_CountryCode"]: c["ISO3_CountryCode"] for c in get(f"{API}/countries?f=json&returnFields=DHS_CountryCode,ISO3_CountryCode")["Data"]}
        rows, page = [], 1
        while True:
            d = get(f"{API}/data?indicatorIds={INDICATOR}&breakdown=all&f=json&perpage=5000&page={page}")
            rows += [dict(r, ISO3=iso.get(r["DHS_CountryCode"])) for r in d["Data"] if r["CharacteristicCategory"] == "Wealth quintile"]
            if page >= d["TotalPages"]:
                break
            page += 1
        cache.write_text(json.dumps(rows), encoding="utf-8")
    rows = json.loads(cache.read_text(encoding="utf-8"))

    surveys = {}
    for r in rows:
        if r["IsPreferred"] != 1 or r["SurveyYear"] < MIN_YEAR or not r["ISO3"] or r["Value"] in (None, ""):
            continue
        surveys.setdefault((r["ISO3"], r["SurveyYear"], r["SurveyId"]), {})[r["CharacteristicLabel"]] = float(r["Value"])
    latest = {}
    for (iso3, year, sid), q in surveys.items():
        if all(k in q and q[k] > 0 for k in QUINTILES) and (iso3 not in latest or year > latest[iso3]["year"]):
            latest[iso3] = {"year": year, "survey": sid, "u5": [q[k] for k in QUINTILES]}

    for v in latest.values():
        v["beta"] = fit_beta(v["u5"])
        v["ratio"] = round(v["u5"][0] / v["u5"][4], 2)

    (OUT / "dhs.json").write_text(json.dumps(latest, indent=1), encoding="utf-8")
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    have = [k for k in countries if k in latest]
    betas = sorted(latest[k]["beta"] for k in have)
    print(f"{len(have)}/{len(countries)} countries ({sum(countries[k]['births'] for k in have) / sum(c['births'] for c in countries.values()):.0%} of births); "
          f"beta median {betas[len(betas) // 2]}, range {betas[0]}..{betas[-1]}")
    for k in ("NGA", "IND", "PAK", "ETH", "BGD", "VNM", "PHL"):
        if k in latest:
            v = latest[k]
            print(f"  {k} {v['year']}: U5MR by quintile {v['u5']} (poorest/richest {v['ratio']}x), beta {v['beta']}")


if __name__ == "__main__":
    main()
