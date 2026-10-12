"""Minimal .xlsx reader (stdlib only): sheet names and rows as lists of cell values."""

import re
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


class Workbook:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.strings = []
        if "xl/sharedStrings.xml" in self.z.namelist():
            for si in ET.parse(self.z.open("xl/sharedStrings.xml")).getroot().findall("m:si", NS):
                self.strings.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
        wb = ET.parse(self.z.open("xl/workbook.xml")).getroot()
        rels = ET.parse(self.z.open("xl/_rels/workbook.xml.rels")).getroot()
        target = {r.get("Id"): r.get("Target") for r in rels}
        self.sheets = {}
        for s in wb.find("m:sheets", NS):
            t = target[s.get(f"{{{NS['r']}}}id")].lstrip("/")
            self.sheets[s.get("name")] = t if t.startswith("xl/") else "xl/" + t

    def rows(self, sheet: str):
        """Yield each row as a list (missing cells are None). Numbers come back as float."""
        for _, el in ET.iterparse(self.z.open(self.sheets[sheet])):
            if el.tag != f"{{{NS['m']}}}row":
                continue
            row = []
            for c in el.findall("m:c", NS):
                i = _col(c.get("r"))
                while len(row) < i:
                    row.append(None)
                v, t = c.find("m:v", NS), c.get("t")
                if t == "s" and v is not None:
                    val = self.strings[int(v.text)]
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
                elif v is not None:
                    try:
                        val = float(v.text)
                    except ValueError:
                        val = v.text
                else:
                    val = None
                row.append(val)
            el.clear()
            yield row
