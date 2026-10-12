"""Cause-of-death mix by country, sex and age group from WHO Global Health Estimates -> data/out/causes.json.

Each GHE leaf cause (level 3, or level 2 with no children) is mapped to a display cause with a
Vietnamese and English name; rare causes fold into their parent group. For every country/sex/age group
we store the share of deaths from each display cause (sparse, shares >= 0.0005).

Usage: python build_causes.py   (after fetch_ghe.py)
"""

import json
from collections import defaultdict
from pathlib import Path

from fetch_ghe import fetch as fetch_one

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "ghe"
OUT = ROOT / "out"

AGE_GROUPS = ["Y0T1", "Y1T4", "Y5T9", "Y10T14", "Y15T19", "Y20T24", "Y25T29", "Y30T34", "Y35T39", "Y40T44",
              "Y45T49", "Y50T54", "Y55T59", "Y60T64", "Y65T69", "Y70T74", "Y75T79", "Y80T84", "Y_GE85"]
AGE_START = [0, 1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85]

# Display causes: key -> (vi, en, kind). "kind" lets the game treat some causes specially.
D = {
    "tb": ("lao", "tuberculosis", "infection"),
    "hiv": ("HIV/AIDS", "HIV/AIDS", "infection"),
    "diarrhoea": ("tiêu chảy", "diarrhoea", "infection"),
    "childhood": ("sởi, ho gà hoặc một bệnh truyền nhiễm trẻ em khác", "measles, whooping cough or another childhood infection", "infection"),
    "meningitis": ("viêm màng não", "meningitis", "infection"),
    "hepatitis": ("viêm gan", "hepatitis", "infection"),
    "parasitic": ("sốt rét hoặc một bệnh do ký sinh trùng", "malaria or another parasitic disease", "infection"),
    "infection": ("một bệnh nhiễm trùng", "an infection", "infection"),
    "pneumonia": ("viêm phổi", "pneumonia", "infection"),
    "covid": ("COVID-19", "COVID-19", "infection"),
    "maternal": ("biến chứng thai sản", "complications of pregnancy or childbirth", "maternal"),
    "preterm": ("biến chứng do sinh non", "complications of being born too early", "neonatal"),
    "asphyxia": ("ngạt khi sinh", "lack of oxygen during birth", "neonatal"),
    "neo_sepsis": ("nhiễm trùng sơ sinh", "a newborn infection", "neonatal"),
    "neonatal": ("biến chứng sơ sinh", "complications after birth", "neonatal"),
    "malnutrition": ("suy dinh dưỡng", "malnutrition", "nutrition"),
    "nutrition": ("thiếu vi chất dinh dưỡng", "a nutritional deficiency", "nutrition"),
    "c_mouth": ("ung thư miệng họng", "mouth cancer", "cancer"),
    "c_oesophagus": ("ung thư thực quản", "oesophageal cancer", "cancer"),
    "c_stomach": ("ung thư dạ dày", "stomach cancer", "cancer"),
    "c_colon": ("ung thư đại trực tràng", "bowel cancer", "cancer"),
    "c_liver": ("ung thư gan", "liver cancer", "cancer"),
    "c_pancreas": ("ung thư tụy", "pancreatic cancer", "cancer"),
    "c_lung": ("ung thư phổi", "lung cancer", "cancer"),
    "c_breast": ("ung thư vú", "breast cancer", "cancer"),
    "c_cervix": ("ung thư cổ tử cung", "cervical cancer", "cancer"),
    "c_ovary": ("ung thư buồng trứng", "ovarian cancer", "cancer"),
    "c_prostate": ("ung thư tuyến tiền liệt", "prostate cancer", "cancer"),
    "c_brain": ("u não", "brain cancer", "cancer"),
    "c_blood": ("ung thư máu", "leukaemia or lymphoma", "cancer"),
    "cancer": ("ung thư", "cancer", "cancer"),
    "diabetes": ("tiểu đường", "diabetes", "ncd"),
    "blood": ("một bệnh về máu hoặc nội tiết", "a blood or hormone disorder", "ncd"),
    "alcohol": ("nghiện rượu", "alcohol use", "ncd"),
    "drugs": ("sử dụng ma túy", "drug use", "ncd"),
    "mental": ("một rối loạn tâm thần", "a mental disorder", "ncd"),
    "dementia": ("sa sút trí tuệ", "dementia", "ncd"),
    "parkinson": ("bệnh Parkinson", "Parkinson's disease", "ncd"),
    "epilepsy": ("động kinh", "epilepsy", "ncd"),
    "neuro": ("một bệnh thần kinh", "a neurological disease", "ncd"),
    "heart_rheum": ("bệnh tim do thấp khớp", "rheumatic heart disease", "ncd"),
    "hypertension": ("bệnh tim do huyết áp cao", "heart disease from high blood pressure", "ncd"),
    "heart": ("bệnh tim mạch vành", "a heart attack", "ncd"),
    "stroke": ("đột quỵ", "a stroke", "ncd"),
    "circulatory": ("một bệnh tim mạch", "a heart or circulation disease", "ncd"),
    "copd": ("bệnh phổi tắc nghẽn mạn tính", "chronic lung disease", "ncd"),
    "asthma": ("hen suyễn", "asthma", "ncd"),
    "respiratory": ("một bệnh hô hấp", "a respiratory disease", "ncd"),
    "cirrhosis": ("xơ gan", "cirrhosis of the liver", "ncd"),
    "digestive": ("một bệnh tiêu hóa", "a digestive disease", "ncd"),
    "kidney": ("suy thận", "kidney failure", "ncd"),
    "genitourinary": ("một bệnh tiết niệu", "a urinary disease", "ncd"),
    "congenital_heart": ("dị tật tim bẩm sinh", "a heart defect present from birth", "congenital"),
    "congenital": ("dị tật bẩm sinh", "a birth defect", "congenital"),
    "sids": ("đột tử ở trẻ sơ sinh", "sudden infant death", "neonatal"),
    "other_ncd": ("một bệnh mạn tính", "a chronic illness", "ncd"),
    "road": ("tai nạn giao thông", "a road accident", "injury"),
    "poisoning": ("ngộ độc", "poisoning", "injury"),
    "fall": ("ngã", "a fall", "injury"),
    "fire": ("bỏng hoặc hỏa hoạn", "burns or a fire", "injury"),
    "drowning": ("đuối nước", "drowning", "injury"),
    "disaster": ("thiên tai", "a natural disaster", "injury"),
    "accident": ("một tai nạn", "an accident", "injury"),
    "suicide": ("tự tử", "suicide", "selfharm"),
    "violence": ("bị sát hại", "being killed by another person", "violence"),
    "war": ("chiến tranh hoặc xung đột vũ trang", "war or armed conflict", "violence"),
}

# GHE cause code -> display key. Codes not listed fall back to their parent (level 2) mapping.
CODE = {
    30: "tb", 100: "hiv", 110: "diarrhoea", 120: "childhood", 170: "meningitis", 185: "hepatitis",
    210: "parasitic", 330: "parasitic", 390: "pneumonia", 395: "covid", 400: "pneumonia", 410: "pneumonia",
    420: "maternal", 500: "preterm", 510: "asphyxia", 520: "neo_sepsis", 530: "neonatal", 550: "malnutrition",
    620: "c_mouth", 630: "c_oesophagus", 640: "c_stomach", 650: "c_colon", 660: "c_liver", 670: "c_pancreas",
    680: "c_lung", 700: "c_breast", 710: "c_cervix", 730: "c_ovary", 740: "c_prostate", 751: "c_brain",
    760: "c_blood", 770: "c_blood", 800: "diabetes", 860: "alcohol", 870: "drugs", 950: "dementia",
    960: "parkinson", 970: "epilepsy", 1110: "heart_rheum", 1120: "hypertension", 1130: "heart", 1140: "stroke",
    1180: "copd", 1190: "asthma", 1230: "cirrhosis", 1270: "kidney", 1440: "congenital_heart", 1505: "sids",
    1530: "road", 1540: "poisoning", 1550: "fall", 1560: "fire", 1570: "drowning", 1580: "disaster",
    1610: "suicide", 1620: "violence", 1630: "war",
}
PARENT = {
    20: "infection", 380: "pneumonia", 420: "maternal", 490: "neonatal", 540: "nutrition", 610: "cancer",
    790: "cancer", 800: "diabetes", 810: "blood", 820: "mental", 940: "neuro", 1020: "other_ncd",
    1100: "circulatory", 1170: "respiratory", 1210: "digestive", 1260: "genitourinary", 1330: "other_ncd",
    1340: "other_ncd", 1400: "congenital", 1470: "other_ncd", 1505: "sids", 1520: "accident", 1600: "violence",
}


# Territories WHO doesn't estimate separately borrow the cause mix of a similar country.
SUBSTITUTE = {"HKG": "SGP", "PRI": "USA", "PSE": "JOR", "XKX": "SRB"}


def display_key(code: int) -> str:
    if code in CODE:
        return CODE[code]
    parent = max(p for p in PARENT if p <= code)
    return PARENT[parent]


def main():
    countries = json.loads((OUT / "countries.json").read_text(encoding="utf-8"))
    keys = list(D)
    idx = {k: i for i, k in enumerate(keys)}
    data, missing = {}, []
    for iso3 in sorted(countries):
        path = RAW / f"{SUBSTITUTE.get(iso3, iso3)}.json"
        if iso3 in SUBSTITUTE and not path.exists():
            (RAW / f"{SUBSTITUTE[iso3]}.json").write_text(json.dumps(fetch_one(SUBSTITUTE[iso3])), encoding="utf-8")
        rows = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        if not rows:
            missing.append(iso3)
            continue
        levels = {r["DIM_GHECAUSE_CODE"]: r["FLAG_LEVEL"] for r in rows}
        codes = sorted(levels)
        # Leaves: level 3, or level 2 with no level-3 code before the next level-2 code.
        leaves = set()
        for i, c in enumerate(codes):
            if levels[c] == 3:
                leaves.add(c)
            elif levels[c] == 2:
                nxt = next((d for d in codes[i + 1:] if levels[d] <= 2), 10**9)
                if not any(levels[d] == 3 for d in codes if c < d < nxt):
                    leaves.add(c)
        deaths = defaultdict(lambda: [0.0] * len(keys))
        for r in rows:
            if r["DIM_GHECAUSE_CODE"] in leaves and r["DIM_AGEGROUP_CODE"] in AGE_GROUPS and r["DIM_SEX_CODE"] in ("MALE", "FEMALE"):
                v = r["VAL_DTHS_COUNT_NUMERIC"] or 0.0
                deaths[(r["DIM_SEX_CODE"][0], r["DIM_AGEGROUP_CODE"])][idx[display_key(r["DIM_GHECAUSE_CODE"])]] += v
        out = {}
        for sex in ("M", "F"):
            groups = []
            for ag in AGE_GROUPS:
                d = deaths[(sex, ag)]
                tot = sum(d)
                groups.append({str(i): round(x / tot, 4) for i, x in enumerate(d) if tot > 0 and x / tot >= 0.0005})
            out[sex] = groups
        data[iso3] = out

    result = {
        "substitutes": {k: v for k, v in SUBSTITUTE.items() if k in countries},
        "source": "WHO Global Health Estimates 2021 (GHE_FULL), year 2023",
        "ages": AGE_START,
        "causes": [{"key": k, "vi": D[k][0], "en": D[k][1], "kind": D[k][2]} for k in keys],
        "data": data,
    }
    (OUT / "causes.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size = (OUT / "causes.json").stat().st_size / 1e6
    print(f"{len(data)} countries, {len(keys)} display causes, {size:.1f} MB; missing: {missing}")

    def top(iso3, sex, age):
        g = data[iso3][sex][AGE_START.index(age)]
        return ", ".join(f"{D[keys[int(i)]][1]} {v:.0%}" for i, v in sorted(g.items(), key=lambda x: -x[1])[:4])
    for iso3, sex, age in [("NGA", "M", 1), ("VNM", "M", 70), ("USA", "M", 20), ("IND", "F", 25)]:
        if iso3 in data:
            print(f"  {iso3} {sex} {age}+: {top(iso3, sex, age)}")


if __name__ == "__main__":
    main()
