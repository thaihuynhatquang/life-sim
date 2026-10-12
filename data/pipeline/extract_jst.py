"""Rates of return on assets -> data/out/returns_model.json (summary statistics; yearly rows stay in data/raw).

Jordà-Schularick-Taylor Macrohistory Database (release 6, macrohistory.net; "The Rate of Return on
Everything, 1870-2015", QJE 2019): yearly total returns on equities (eq_tr), housing (housing_tr,
including rent), government bonds (bond_tr) and bills (bill_rate) for 18 advanced economies, with the
consumer price index (cpi). Kept: 1950 onwards, years where all four returns and inflation exist,
converted to real returns.

The file downloaded from macrohistory.net is a Stata .dta (format 118) despite its .xlsx name; it is
read here with the standard library.

Usage: python extract_jst.py   (needs data/raw/jst/JSTdatasetR6.xlsx)
"""

import json
import math
import statistics
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "jst" / "JSTdatasetR6.xlsx"
OUT = ROOT / "out"
FROM = 1950


def read_dta(path: Path) -> list[dict]:
    """Minimal reader for Stata format 117/118 (numeric and fixed-width string columns)."""
    b = path.read_bytes()

    def between(tag: str, start: int = 0) -> tuple[int, int]:
        i = b.index(f"<{tag}>".encode(), start) + len(tag) + 2
        return i, b.index(f"</{tag}>".encode(), i)

    rel = int(b[between("release")[0]:between("release")[1]])
    order = b[between("byteorder")[0]:between("byteorder")[1]].decode()
    e = "<" if order == "LSF" else ">"
    i, _ = between("K"); k = struct.unpack(e + "H", b[i:i + 2])[0]
    i, _ = between("N"); n = struct.unpack(e + ("Q" if rel >= 118 else "I"), b[i:i + (8 if rel >= 118 else 4)])[0]
    i, _ = between("variable_types")
    types = struct.unpack(e + "H" * k, b[i:i + 2 * k])
    i, _ = between("varnames")
    w = 129 if rel >= 118 else 33
    names = [b[i + j * w:i + (j + 1) * w].split(b"\0")[0].decode() for j in range(k)]
    i, _ = between("data")
    fmt = {65526: ("d", 8), 65527: ("f", 4), 65528: ("i", 4), 65529: ("h", 2), 65530: ("b", 1)}
    missing = {65526: 8.988465674311579e307, 65527: 1.7014118346046923e38, 65528: 2147483620, 65529: 32740, 65530: 100}
    rows = []
    for _ in range(n):
        row = {}
        for name, t in zip(names, types):
            if t in fmt:
                c, size = fmt[t]
                v = struct.unpack(e + c, b[i:i + size])[0]
                row[name] = None if v >= missing[t] else v
                i += size
            elif t <= 2045:
                row[name] = b[i:i + t].split(b"\0")[0].decode("utf-8", "replace")
                i += t
            else:  # strL reference: not needed here
                i += 8
        rows.append(row)
    return rows


def main():
    rows = read_dta(RAW)
    by = {}
    for r in rows:
        by.setdefault(r["iso"], {})[int(r["year"])] = r
    out = []
    for iso, years in by.items():
        for y, r in sorted(years.items()):
            prev = years.get(y - 1)
            if y < FROM or not prev or not r.get("cpi") or not prev.get("cpi"):
                continue
            vals = [r.get(x) for x in ("eq_tr", "housing_tr", "bond_tr", "bill_rate")]
            if any(v is None for v in vals):
                continue
            infl = r["cpi"] / prev["cpi"] - 1
            real = [round((1 + v) / (1 + infl) - 1, 4) for v in vals]
            out.append([y, iso] + real)
    # The yearly rows stay local (data/raw, not published: the database is CC BY-NC-SA 4.0). The game uses
    # only a statistical model fitted to them: means and covariances of log real returns of shares,
    # housing and bills, and one degrees-of-freedom value for a multivariate Student t, whose fat tails
    # keep crash and boom years about as frequent as in history.
    RAW.parent.joinpath("returns_rows.json").write_text(json.dumps({
        "columns": ["year", "iso", "equity", "housing", "bonds", "bills"], "rows": out}), encoding="utf-8")
    cols = {"equity": 2, "housing": 3, "bills": 5}
    logs = {k: [math.log(1 + r[j]) for r in out] for k, j in cols.items()}
    keys = list(cols)
    mean = [statistics.mean(logs[k]) for k in keys]
    n = len(out)
    cov = [[sum((logs[a][i] - mean[x]) * (logs[b][i] - mean[y]) for i in range(n)) / (n - 1)
            for y, b in enumerate(keys)] for x, a in enumerate(keys)]
    e = logs["equity"]
    m2 = sum((v - mean[0]) ** 2 for v in e) / n
    excess = sum((v - mean[0]) ** 4 for v in e) / n / m2 ** 2 - 3
    df = max(5, min(30, round(4 + 6 / excess))) if excess > 0 else 30
    stats = {k: {"mean": round(statistics.mean(r[j] for r in out), 4), "worst": round(min(r[j] for r in out), 4),
                 "best": round(max(r[j] for r in out), 4)} for k, j in cols.items()}
    OUT.joinpath("returns_model.json").write_text(json.dumps({
        "source": "Statistical model fitted to real total returns in the Jordà-Schularick-Taylor Macrohistory Database R6 "
                  "(macrohistory.net; Jordà et al. 2019, The Rate of Return on Everything, QJE), 16 countries, 1950-2020",
        "assets": keys, "mean_log": [round(x, 6) for x in mean], "cov_log": [[round(x, 7) for x in row] for row in cov],
        "df": df, "stats": stats}, indent=1), encoding="utf-8")
    print(f"model: df {df} (equity excess kurtosis {excess:.2f}); mean log {[round(x, 4) for x in mean]}")
    print(f"{len(out)} country-years from {FROM}, {len({r[1] for r in out})} countries")
    for j, name in enumerate(["equity", "housing", "bonds", "bills"]):
        v = [r[2 + j] for r in out]
        print(f"  {name:8s} mean {statistics.mean(v):6.1%}  sd {statistics.pstdev(v):5.1%}  worst {min(v):6.1%}  best {max(v):6.1%}")


if __name__ == "__main__":
    main()
