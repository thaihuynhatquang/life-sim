"""World Bank WDI indicators used by the simulation.

key -> (WDI code, description). Keys are the short field names used in countries.json.
"""

WB_INDICATORS = {
    # Dân số & sinh
    "pop": ("SP.POP.TOTL", "Population, total"),
    "cbr": ("SP.DYN.CBRT.IN", "Birth rate, crude (per 1,000 people)"),
    "tfr": ("SP.DYN.TFRT.IN", "Fertility rate, total (births per woman)"),
    "urban": ("SP.URB.TOTL.IN.ZS", "Urban population (% of total)"),
    # Tử vong
    "le": ("SP.DYN.LE00.IN", "Life expectancy at birth, total (years)"),
    "le_m": ("SP.DYN.LE00.MA.IN", "Life expectancy at birth, male (years)"),
    "le_f": ("SP.DYN.LE00.FE.IN", "Life expectancy at birth, female (years)"),
    "imr": ("SP.DYN.IMRT.IN", "Infant mortality rate (per 1,000 live births)"),
    "u5mr": ("SH.DYN.MORT", "Under-5 mortality rate (per 1,000 live births)"),
    "mmr": ("SH.STA.MMRT", "Maternal mortality ratio (per 100,000 live births)"),
    "hiv": ("SH.DYN.AIDS.ZS", "Prevalence of HIV, total (% of ages 15-49)"),
    "hiv_fshare": ("SH.DYN.AIDS.FE.ZS", "Women's share of population ages 15+ living with HIV (%)"),
    "art": ("SH.HIV.ARTC.ZS", "Antiretroviral therapy coverage (% of people living with HIV)"),
    "homicide": ("VC.IHR.PSRC.P5", "Intentional homicides (per 100,000 people)"),
    "road": ("SH.STA.TRAF.P5", "Road traffic deaths (per 100,000 people)"),
    "suicide": ("SH.STA.SUIC.P5", "Suicide mortality rate (per 100,000 population)"),
    # Kinh tế
    "gdp_ppp": ("NY.GDP.PCAP.PP.KD", "GDP per capita, PPP (constant 2021 international $)"),
    "gini": ("SI.POV.GINI", "Gini index"),
    "pov_ext": ("SI.POV.DDAY", "Poverty headcount ratio at $3.00 a day (2021 PPP) (% of population)"),
    "agr_emp": ("SL.AGR.EMPL.ZS", "Employment in agriculture (% of total employment)"),
    "unemp": ("SL.UEM.TOTL.ZS", "Unemployment, total (% of total labor force)"),
    "flfp": ("SL.TLF.CACT.FE.ZS", "Labor force participation rate, female (% of female population ages 15+)"),
    "mlfp": ("SL.TLF.CACT.MA.ZS", "Labor force participation rate, male (% of male population ages 15+)"),
    # Y tế & lối sống
    "smoke_m": ("SH.PRV.SMOK.MA", "Prevalence of current tobacco use, males (% of male adults)"),
    "smoke_f": ("SH.PRV.SMOK.FE", "Prevalence of current tobacco use, females (% of female adults)"),
    "oop": ("SH.XPD.OOPC.CH.ZS", "Out-of-pocket expenditure (% of current health expenditure)"),
    "measles": ("SH.IMM.MEAS", "Immunization, measles (% of children ages 12-23 months)"),
    "stunting": ("SH.STA.STNT.ZS", "Prevalence of stunting, height for age (% of children under 5)"),
    # Giáo dục
    "school_exp": ("HD.HCI.EYRS", "Expected years of school"),
    "tertiary": ("SE.TER.ENRR", "School enrollment, tertiary (% gross)"),
    # Completion rates from household surveys (UNESCO UIS): share of people 3-5 years above the
    # graduation age who completed the level. Cohort-based, so they map directly onto individual lives.
    "compl1": ("UIS.CR.1", "Completion rate, primary education, both sexes (%)"),
    "compl2": ("UIS.CR.2", "Completion rate, lower secondary education, both sexes (%)"),
    "compl3": ("UIS.CR.3", "Completion rate, upper secondary education, both sexes (%)"),
    "oos_primary": ("SE.PRM.UNER.ZS", "Children out of school (% of primary school age)"),
    "literacy": ("SE.ADT.LITR.ZS", "Literacy rate, adult total (% of people ages 15 and above)"),
    # Hạ tầng
    "electricity": ("EG.ELC.ACCS.ZS", "Access to electricity (% of population)"),
    "water": ("SH.H2O.BASW.ZS", "People using at least basic drinking water services (% of population)"),
    "internet": ("IT.NET.USER.ZS", "Individuals using the Internet (% of population)"),
    # Đời sống: tuổi thơ, nhà ở
    "birth_reg": ("SP.REG.BRTH.ZS", "Completeness of birth registration (%)"),
    "sanitation": ("SH.STA.BASS.ZS", "People using at least basic sanitation services (% of population)"),
    "clean_fuel": ("EG.CFT.ACCS.ZS", "Access to clean fuels and technologies for cooking (% of population)"),
    "slum": ("EN.POP.SLUM.UR.ZS", "Population living in slums (% of urban population)"),
    # Đời sống: tài chính cá nhân (Global Findex)
    "account": ("FX.OWN.TOTL.ZS", "Account ownership at a financial institution or with a mobile-money-service provider (% of population ages 15+)"),
    "account_f": ("FX.OWN.TOTL.FE.ZS", "Account ownership, female (% of population ages 15+)"),
    "account_m": ("FX.OWN.TOTL.MA.ZS", "Account ownership, male (% of population ages 15+)"),
    "account_p40": ("FX.OWN.TOTL.40.ZS", "Account ownership, income, poorest 40% (% ages 15+)"),
    "account_r60": ("FX.OWN.TOTL.60.ZS", "Account ownership, income, richest 60% (% ages 15+)"),
    # Tài chính y tế (WHO/World Bank UHC monitoring, SDG 3.8.2 family)
    "oop_imp": ("SH_UHC_FH40_IMPOV", "Proportion of population facing impoverishing out-of-pocket health expenditure, societal poverty line (%)"),
    "oop_large": ("SH_UHC_FH40_LARGE", "Proportion of population facing large (but non-impoverishing) out-of-pocket health expenditure (%)"),
    "oop_pc": ("SH.XPD.OOPC.PP.CD", "Out-of-pocket expenditure per capita, PPP (current international $)"),
    "biz_density": ("IC.BUS.NDNS.ZS", "New business density (new registrations per 1,000 people ages 15-64)"),
    "fp_satisfied": ("SH.FPL.SATM.ZS", "Demand for family planning satisfied by modern methods (% of married women with demand for family planning)"),
    # Xã hội
    "child_marriage": ("SP.M18.2024.FE.ZS", "Women first married by age 18 (% of women ages 20-24)"),
}

# Lấy giá trị gần nhất trong khoảng năm này. Một số chỉ số (Gini, tảo hôn) được khảo sát thưa,
# nên cho phép lùi xa hơn.
YEAR_FROM = 2005
YEAR_TO = 2025

# Chỉ giữ nước có dân số từ ngưỡng này trở lên (đủ để chiếm gần như toàn bộ số ca sinh thế giới).
MIN_POPULATION = 1_000_000

# Thiếu một trong các chỉ số này thì loại nước đó khỏi bản đầu tiên.
CORE_KEYS = ["pop", "cbr", "le_m", "le_f", "imr", "u5mr", "gdp_ppp"]

# From the World Bank EdStats source (UNESCO UIS data), fetched with source=12.
EDSTATS_INDICATORS = {
    # Tertiary graduates by broad field (ISCED-F 2013), % of all graduates.
    "fld_edu": ("SE.TER.GRAD.ED.ZS", "Graduates from Education programmes (%)"),
    "fld_arts": ("SE.TER.GRAD.HU.ZS", "Graduates from Arts and Humanities programmes (%)"),
    "fld_soc": ("SE.TER.GRAD.SS.ZS", "Graduates from Social Sciences, Journalism and Information programmes (%)"),
    "fld_bus": ("UIS.FOSGP.5T8.F400", "Graduates from Business, Administration and Law programmes (%)"),
    "fld_sci": ("SE.TER.GRAD.SC.ZS", "Graduates from Natural Sciences, Mathematics and Statistics programmes (%)"),
    "fld_ict": ("UIS.FOSGP.5T8.F600", "Graduates from Information and Communication Technologies programmes (%)"),
    "fld_eng": ("SE.TER.GRAD.EN.ZS", "Graduates from Engineering, Manufacturing and Construction programmes (%)"),
    "fld_agr": ("SE.TER.GRAD.AG.ZS", "Graduates from Agriculture, Forestry, Fisheries and Veterinary programmes (%)"),
    "fld_hlth": ("SE.TER.GRAD.HL.ZS", "Graduates from Health and Welfare programmes (%)"),
    "fld_serv": ("SE.TER.GRAD.SV.ZS", "Graduates from Services programmes (%)"),
    # Upper secondary students in vocational programmes, %.
    "voc_upper": ("UIS.GTVP.3.V", "Share of upper secondary students enrolled in vocational programmes (%)"),
}

