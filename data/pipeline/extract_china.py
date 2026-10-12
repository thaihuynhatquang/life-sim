"""China: occupations by age, sex and education from the 2020 Population Census, mapped to ISCO-08.

ILOSTAT has no Chinese labour survey after 2000, and the ILO modelled occupation shares for China still
reflect the 2000 structure (agriculture + elementary ~51% vs 20.5% agriculture in the 2020 census). So for
China, occupation data come from the census long form (10% sample):
  Table 4-7  employed population by age, sex and occupation (middle groups of GB/T 6565-2015)
  Table 4-2  employed population by sex and education
Chinese occupation middle groups are mapped to ISCO-08 major groups with CROSSWALK below. Groups that
mix ISCO groups are split by shares based on the ISCO-08 definitions (ASSUMPTION, noted per line).
Occupation x education for 2020 is not published: the 2000 census pattern (ILOSTAT) is raked (IPF) to
the 2020 occupation and education totals.

Source: NBS, China Population Census Yearbook 2020, https://www.stats.gov.cn/sj/pcsj/rkpc/7rp/indexch.htm
Usage: .venv/Scripts/python extract_china.py   (needs xlrd; run after fetch_ilo_work.py)
"""

import json
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
OUT = ROOT / "out"
OCC = [str(i) for i in range(10)]

# Chinese middle group -> {ISCO-08 major group: share}. Single-group mappings follow the ISCO definitions;
# splits are assumptions explained inline.
CROSSWALK = {
    # 1 Heads of party/state organs, organisations, enterprises -> managers
    "中国共产党机关负责人": {"1": 1}, "国家机关负责人": {"1": 1}, "民主党派和工商联负责人": {"1": 1},
    "人民团体和群众团体、社会组织及其他成员组织负责人": {"1": 1}, "基层群众自治组织负责人": {"1": 1}, "企事业单位负责人": {"1": 1},
    # 2 Professional and technical personnel: CN merges ISCO 2 (professionals) and 3 (associate professionals)
    "科学研究人员": {"2": 1},
    "工程技术人员": {"2": 0.6, "3": 0.4},              # engineers vs engineering technicians
    "农业技术人员": {"2": 0.4, "3": 0.6},              # agronomists vs agricultural technicians
    "飞机和船舶技术人员": {"3": 1},                    # pilots, ship officers (ISCO 315)
    "卫生专业技术人员": {"2": 0.38, "3": 0.62},        # doctors ~38% of health technical staff; nurses, pharmacists, technicians (NHC 2020)
    "经济和金融专业人员": {"2": 0.5, "3": 0.5},        # accountants/economists vs finance associate professionals
    "法律、社会和宗教专业人员": {"2": 1},
    "教学人员": {"2": 1},                              # teachers are ISCO 23
    "文学艺术、体育专业人员": {"2": 0.5, "3": 0.5},    # artists (265) vs athletes, coaches (342)
    "新闻出版、文化专业人员": {"2": 1},
    "其他专业技术人员": {"3": 1},
    # 3 Clerks and related
    "办事人员": {"4": 1}, "安全和消防人员": {"5": 1},   # protective services are ISCO 54
    "其他办事人员和有关人员": {"4": 1},
    # 4 Social production and life service personnel
    "批发与零售服务人员": {"5": 0.9, "9": 0.1},        # shop sales vs street vendors (ISCO 95)
    "交通运输、仓储和邮政业服务人员": {"8": 0.6, "4": 0.15, "9": 0.25},  # drivers (83), postal/transport clerks, loaders (93)
    "住宿和餐饮服务人员": {"5": 0.8, "9": 0.2},        # cooks, waiters vs kitchen helpers (94)
    "信息传输、软件和信息技术服务人员": {"3": 0.7, "2": 0.3},  # ICT technicians (35) vs developers (25)
    "金融服务人员": {"4": 0.7, "3": 0.3},              # tellers (42) vs finance associate professionals
    "房地产服务人员": {"3": 0.5, "5": 0.2, "9": 0.3},  # agents, building caretakers, cleaners
    "租赁和商务服务人员": {"3": 0.4, "4": 0.4, "5": 0.2},
    "技术辅助服务人员": {"3": 1},
    "水利、环境和公共设施管理服务人员": {"9": 1},      # cleaners, refuse workers (91, 96)
    "居民服务人员": {"5": 0.6, "9": 0.4},              # hairdressers, child care vs domestic helpers (91)
    "电力、燃气及水供应服务人员": {"7": 1},
    "修理及制作服务人员": {"7": 1},
    "文化、体育和娱乐服务人员": {"5": 0.5, "3": 0.5},
    "健康服务人员": {"5": 1},                          # personal care workers (53)
    "其他社会生产和生活服务人员": {"5": 1},
    # 5 Agriculture, forestry, animal husbandry, fishery
    "农业生产人员": {"6": 1}, "林业生产人员": {"6": 1}, "畜牧业生产人员": {"6": 1}, "渔业生产人员": {"6": 1},
    "农林牧渔生产辅助人员": {"9": 1},                  # agricultural labourers (92)
    "其他农、林、牧、渔业生产加工人员": {"6": 1},
    # 6 Production, manufacturing and related
    "农副产品加工人员": {"7": 0.4, "8": 0.6}, "食品、饮料生产加工人员": {"7": 0.4, "8": 0.6},
    "烟草及其制品加工人员": {"8": 1}, "纺织、针织、印染人员": {"8": 1},
    "纺织品、服装和皮革、毛皮制品加工制作人员": {"7": 0.5, "8": 0.5},  # garment trades (753) vs sewing machinists (815)
    "木材加工、家具与木制品制作人员": {"7": 1}, "纸及纸制品生产加工人员": {"8": 0.7, "7": 0.3},
    "印刷和记录媒介复制人员": {"7": 0.3, "8": 0.7}, "文教、工美、体育和娱乐用品制造人员": {"7": 1},
    "石油加工和炼焦、煤化工生产人员": {"8": 1}, "化学原料和化学制品制造人员": {"8": 1}, "医药制造人员": {"8": 1},
    "化学纤维制造人员": {"8": 1}, "橡胶和塑料制品制造人员": {"8": 1}, "非金属矿物制品制造人员": {"8": 1},
    "采矿人员": {"8": 0.6, "9": 0.4},                  # mining plant operators (811) vs mining labourers (931)
    "金属冶炼和压延加工人员": {"8": 1}, "机械制造基础加工人员": {"7": 0.6, "8": 0.4},
    "金属制品制造人员": {"7": 1}, "通用设备制造人员": {"7": 0.4, "8": 0.6}, "专用设备制造人员": {"7": 0.4, "8": 0.6},
    "汽车制造人员": {"7": 0.4, "8": 0.6}, "铁路、船舶、航空设备制造人员": {"7": 0.4, "8": 0.6},
    "电气机械和器材制造人员": {"7": 0.4, "8": 0.6}, "计算机、通信和其他电子设备制造人员": {"8": 1},  # assemblers (82)
    "仪器仪表制造人员": {"7": 1}, "废弃资源综合利用人员": {"9": 1},
    "电力、热力、气体、水生产和输配人员": {"7": 0.5, "8": 0.5},
    "建筑施工人员": {"7": 0.7, "9": 0.3},              # building trades vs construction labourers (931)
    "运输设备和通用工程机械操作人员及有关人员": {"8": 1},
    "生产辅助人员": {"9": 1},                          # manufacturing labourers (932)
    "其他生产制造及有关人员": {"8": 1},
}
BAND = lambda a: "15" if a < 25 else "25" if a < 55 else "55" if a < 65 else "65"


def clean(x) -> str:
    return str(x).replace("\n", "").replace(" ", "").replace("　", "").strip()


def occupation_by_age():
    """{sex: {band: [counts by ISCO 0..9]}} from table 4-7."""
    s = xlrd.open_workbook(RAW / "china" / "B0407.xls").sheet_by_index(0)
    cols = {}
    for c in range(1, s.ncols):
        name = clean(s.cell_value(4, c))
        if name in CROSSWALK:
            cols[c] = CROSSWALK[name]
    missing = [clean(s.cell_value(4, c)) for c in range(1, s.ncols) if clean(s.cell_value(4, c)) not in CROSSWALK
               and clean(s.cell_value(4, c)) not in ("", "小计")]
    if missing:
        raise SystemExit(f"unmapped occupation groups: {missing}")
    out, sex = {"T": {}, "M": {}, "F": {}}, "T"
    for r in range(8, s.nrows):
        label = clean(s.cell_value(r, 0))
        if label in ("男", "女"):
            sex = {"男": "M", "女": "F"}[label]
            continue
        if not label.endswith("岁") and "岁及以上" not in label:
            continue
        age = int(label.split("-")[0].replace("岁及以上", "").replace("岁", ""))
        row = out[sex].setdefault(BAND(age), [0.0] * 10)
        for c, split in cols.items():
            v = s.cell_value(r, c)
            if v != "":
                for isco, w in split.items():
                    row[int(isco)] += float(v) * w
    return out


def education_totals():
    """{sex: {LTB, BAS, INT, ADV}} employed population by education, table 4-2 (national rows)."""
    s = xlrd.open_workbook(RAW / "china" / "B0402.xls").sheet_by_index(0)
    groups = {"LTB": [2, 3], "BAS": [4, 5], "INT": [6], "ADV": [7, 8, 9, 10]}
    out = {}
    for r in range(s.nrows):
        label = clean(s.cell_value(r, 0))
        sex = {"全国": "T", "男": "M", "女": "F"}.get(label)
        if sex and s.cell_value(r, 1) != "":
            out[sex] = {g: sum(float(s.cell_value(r, c) or 0) for c in cs) for g, cs in groups.items()}
    return out


def seed_2000():
    """China 2000 census occupation x education (ILOSTAT, ISCO-88), by sex, as {sex: {edu: [10]}}."""
    rows = json.loads((RAW / "ilo" / "EMP_TEMP_SEX_OCU_EDU_NB_A.json").read_text(encoding="utf-8"))
    edu = {"EDU_AGGREGATE_LTB": "LTB", "EDU_AGGREGATE_BAS": "BAS", "EDU_AGGREGATE_INT": "INT", "EDU_AGGREGATE_ADV": "ADV"}
    out = {}
    for r in rows:
        if r["ref_area"] != "CHN" or r.get("obs_value") is None:
            continue
        sex, e = {"SEX_M": "M", "SEX_F": "F"}.get(r["sex"]), edu.get(r.get("classif2", ""))
        code = r["classif1"].replace("OCU_ISCO88_", "").replace("OCU_ISCO08_", "")
        if sex and e and code in OCC:
            out.setdefault(sex, {}).setdefault(e, [0.0] * 10)[int(code)] += r["obs_value"]
    return out


def ipf(seed, row_tot, col_tot, iters=200):
    """Rake matrix seed[e][o] to row totals (education) and column totals (occupation)."""
    m = {e: [max(x, 1e-9) for x in v] for e, v in seed.items()}
    for _ in range(iters):
        for e in m:
            s = sum(m[e])
            m[e] = [x * row_tot[e] / s for x in m[e]] if s > 0 else m[e]
        for o in range(10):
            s = sum(m[e][o] for e in m)
            if s > 0:
                for e in m:
                    m[e][o] *= col_tot[o] / s
    return m


def main():
    by_age = occupation_by_age()
    edu = education_totals()
    seed = seed_2000()
    work = json.loads((OUT / "work.json").read_text(encoding="utf-8"))
    chn = work.setdefault("CHN", {})
    for sex in ("M", "F"):
        total = [sum(b[i] for b in by_age[sex].values()) for i in range(10)]
        n = sum(total)
        v = chn.setdefault(sex, {})
        v["ocu"] = [round(x / n, 5) for x in total]
        v["ocu_age"] = {b: [round(x / sum(row), 5) for x in row] for b, row in by_age[sex].items()}
        # Occupation x education: 2000 pattern raked to 2020 totals (occupation total scaled to education total).
        etot = edu[sex]
        scale = sum(etot.values()) / n
        joint = ipf(seed[sex], etot, [x * scale for x in total])
        v["ocu_edu"] = {e: [round(x / sum(row), 5) for x in row] for e, row in joint.items()}
    chn.setdefault("year", {}).update({"ocu_age": 2020, "ocu_edu": 2020, "source": "NBS census 2020 (crosswalk to ISCO-08)"})
    (OUT / "work.json").write_text(json.dumps(work, indent=1), encoding="utf-8")
    names = ["0 army", "1 managers", "2 professionals", "3 technicians", "4 clerks", "5 services/sales",
             "6 farmers", "7 crafts", "8 operators", "9 elementary"]
    for sex in ("M", "F"):
        print(sex, " | ".join(f"{names[i]} {100 * x:.1f}%" for i, x in enumerate(chn[sex]["ocu"]) if i))
    print("women by education -> professionals share:", {e: f"{100 * r[2]:.0f}%" for e, r in chn["F"]["ocu_edu"].items()})


if __name__ == "__main__":
    main()
