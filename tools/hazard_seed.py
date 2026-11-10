"""Builds supabase/migrations/052_hazards_seed.sql from the paper hazard registers:
 - West Harbour - Risk Register.xlsx (RSB / PCB, Greg handover 25 Sep 2026) -> tools/hazard_seed_wh.tsv
 - Risk Register - [Taieri Post] Final - Updated - August 2025.docx, site-specific data (Outram + rural NZ Post runs)
Re-runnable: rows upsert on ref."""
import pathlib

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "supabase/migrations/052_hazards_seed.sql"

KIND = {"DOG": ["dog"], "CUSTOMER": ["person"], "ACCESS": ["access"], "DRIVEWAY": ["driveway"], "MANOEUVRE": ["driveway"],
        "ICE": ["ice"], "RAIL": ["rail"], "VEHICLE": ["road"], "MANUAL": ["lifting"], "TIMING": ["info"], "INFO": ["info"], "GATE": ["access"]}
RUNS = {"RSB": ["RSB", "WH"], "PCB": ["PCB", "WH"], "Both": ["RSB", "PCB", "WH"]}
WH_SRC = "West Harbour risk register (Greg handover, 25 Sep 2026)"
TP_SRC = "Taieri Post risk register – site-specific data (Aug 2025)"
RURAL = ["FLY", "TUA"]; OUTRAM = ["RAM"]; ALLNZP = ["FLY", "TUA", "RAM"]

def address(street, num):
    n = num.strip()
    if not n or street in ("Winter", "Footwear / surfaces", "Parking on slopes", "Rear-wheel-drive vans"): return f"{street} – {n}" if n else street
    if n[0].isdigit() and len(n) <= 6 and " " not in n: return f"{n} {street}"
    return f"{street} – {n}"

rows = []
for line in (HERE / "hazard_seed_wh.tsv").read_text().splitlines():
    if not line.strip(): continue
    p = line.split("\t") + [""] * 10
    ref, run, area, street, num, cat, hazard, level, rule, control = [x.strip() for x in p[:10]]
    rows.append(dict(ref=ref, runs=RUNS[run], area=None if area == "All" else area, address=address(street, num), kinds=KIND[cat],
                     severity=level.lower(), rule=rule, note=hazard, control=control or None, source=WH_SRC))

def tp(ref, runs, area, addr, kinds, sev, rule, note, control):
    rows.append(dict(ref=ref, runs=runs, area=area, address=addr, kinds=kinds, severity=sev, rule=rule, note=note, control=control, source=TP_SRC))

DOG_CTL = "Do not deliver if worried about personal safety. Card to depot. Attempt delivery to the mailbox if able."
for i, a in enumerate(["44 Beaumaris Street", "9 Holyhead Street", "8 Three Kings", "1 Bell Street"], 1):
    tp(f"TP-D{i:02}", OUTRAM, "Outram", a, ["dog"], "high", "NO-GO", "Aggressive dog", DOG_CTL)
ICE_CTL = "Black ice: change down a gear, don't use the foot brake. If a road is too dangerous, don't deliver – tell the owner and SDM. Walking pace on foot in poor conditions."
for i, (a, area, runs) in enumerate([("Huntly Road", "Rural", RURAL), ("16 Three Kings Deck", "Outram", OUTRAM), ("Outram Bridge and surrounds", "Outram", ALLNZP),
                                     ("Rodeo Place", "Mosgiel", ALLNZP)], 1):
    tp(f"TP-I{i:02}", runs, area, a, ["ice"], "medium", "WET/ICE-NO", "Ice / black ice in winter", ICE_CTL)
tp("TP-R01", RURAL, "Rural", "Huntly Road – 90° bend", ["road"], "medium", "CAUTION", "Narrow road, 90-degree bend", "Take the corner very slowly, as far left as possible.")
tp("TP-R02", ALLNZP, "Outram", "Outram–Mosgiel Highway", ["road"], "high", "CAUTION", "High-speed traffic at roadside mailboxes",
   "Never back directly onto the road; stay on the verge and only move when clear. If crossing right to a mailbox is a close call, wait left if safe – otherwise don't deliver.")
tp("TP-R03", ALLNZP, "Outram", "Outram–Mosgiel Highway – fog", ["road"], "medium", "CAUTION", "Fog-prone stretch", "Don't crawl along on the right side of the road. Amber beacon, hazard lights and headlights on.")
tp("TP-F01", ALLNZP, "Mosgiel", "Lower Bidston", ["road"], "medium", "WET/ICE-NO", "Floods in heavy rain", "Don't drive through floodwater – you can't see the road or debris, and it cuts braking.")
tp("TP-F02", OUTRAM, "Outram", "Bell Street – flooding", ["road"], "medium", "WET/ICE-NO", "Floods in heavy rain", "Don't drive through floodwater – you can't see the road or debris, and it cuts braking.")
tp("TP-RL1", ALLNZP, "Mosgiel", "Factory Road / Gladstone Road North – rail crossing", ["rail"], "high", "CAUTION", "Railway crossing (lights)", "Controlled by lights. STOP if flashing.")
tp("TP-RL2", ALLNZP, "Mosgiel", "Riccarton Road – rail crossing", ["rail"], "high", "CAUTION", "Railway crossing (lights)", "Controlled by lights. STOP if flashing.")
tp("TP-S01", OUTRAM, "Outram", "Outram School", ["road"], "medium", "CAUTION", "School – children on site", "Careful driving onto school property; watch for children.")
tp("TP-S02", OUTRAM, "Outram", "Bell Street / Mountfort Street – school buses", ["road"], "medium", "CAUTION", "School buses stopping", "Slow to 20 km/h passing stopped school buses or children.")
tp("TP-S03", ALLNZP, "Outram", "Outram Bridge – cyclists", ["road"], "low", "CAUTION", "Cyclists, incl. school children in Outram township", "Sit behind until safe to pass; give plenty of space.")
tp("TP-M01", OUTRAM, "Outram", "48 Bell Street", ["road"], "low", "CAUTION", "No turning bay when the gate is closed", "Turn tight to the hedge – you can stay out of traffic on the road.")

# mailboxes where the van can't get fully off the road (crossing the centre line to reach the box)
MB = """Gordon Rd|229,261,257,157,133,808,806,799,410,410a,412,433,452,513,559,609,616
Huntly Rd|39,47,53,102,106,200,118,144,287,303,245,241,427,342
Church Rd|6
Woodside Rd|16,42,74,114,124,126,146,205 (all Woodside mailboxes)
Berwick Rd|8,12,14,19,29,52,207,663,665,693,995,1039,1230,1453
McDonald Rd|187,167,56
Mann Rd|2,160,94,90,70,45,46,31,1
Maungatua Rd|103,339,387,465,606,772,792,795
Currie Rd|51,57,95,125
Waipori Falls Rd|115,122,322
Riverside Rd|605
Shaws Rd|29,90,97
McPherson Rd|53,56
Cullen Rd|10,162,321,137,95
Phosphate Rd|30, 49 (with 82 Berridale Rd)
Titri Rd|8,10,17,22,27,32,41,44,46,49,50,54,55,56,57,78,80,82,280
Taieri Ferry Rd|42,138,170,190,224,428,529
Henley Berwick Rd|10,20,109,138,159,174,206,258
Henley Rd|411,433,439,469,471
Centre Rd|185,230,305,321,383,395,429,651,744,816,825,843,935,938,1215,1218,1236
Marshall Rd|5,43,60,69,104,111,193,285,285a,288,330,350,467,489
Wilson Rd|47,80
Kirksdrain Rd|420,257,242,179,146,137,122,94
Miller Rd|76,83,140,142,181,257,306
Lee Canal Rd|63,89,171
Otikia Rd|117,122,197,227,232,242,276
Lee Creek Rd|132,74
Granton Rd|457,290,207,159,139
McLeod Rd|127
Beehive Rd|130,127,124
Nichols Rd|2,3,6,53,55,69,186,187,235,295,299
Bremner Rd|26,196
Bruce Rd|22,52,90,110
Allanton Rd|61,71,100,214,277
Waihola Hill Rd|66,154,162
Waihola Hwy|756,758,841,852,990,992,1060
Surrey Heights|2,32,64,65,67
Popham Rd|9,18"""
MB_CTL = "Wait left if there's space and slowing is safe at speed. Consider following traffic, light, road and weather. Don't deliver if it's unsafe."
for i, line in enumerate(MB.splitlines(), 1):
    road, nums = line.split("|")
    tp(f"TP-MB{i:02}", RURAL, "Rural", f"{road} – mailboxes {nums}", ["road"], "low", "CAUTION", "Crossing the centre line to reach the mailbox – van not fully off the road", MB_CTL)

def lit(v):
    if v is None: return "null"
    if isinstance(v, list): return "array[" + ",".join(lit(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"

cols = ["ref", "runs", "area", "address", "kinds", "severity", "rule", "note", "control", "source"]
vals = ",\n".join("(" + ", ".join(lit(r[c]) for c in cols) + ")" for r in rows)
sql = f"""-- Seed the hazard register from the paper registers ({len(rows)} rows). Generated by tools/hazard_seed.py – re-runnable (upserts on ref).
insert into public.hazards ({", ".join(cols)}) values
{vals}
on conflict (ref) do update set runs = excluded.runs, area = excluded.area, address = excluded.address, kinds = excluded.kinds, severity = excluded.severity,
  rule = excluded.rule, note = excluded.note, control = excluded.control, source = excluded.source;
"""
OUT.write_text(sql)
print(len(rows), "rows ->", OUT)

# compact form for pasting through the SQL tool: runs/source/long repeated controls rebuilt in SQL
RK = {("RSB","WH"): "r", ("PCB","WH"): "p", ("RSB","PCB","WH"): "b", ("RAM",): "o", ("FLY","TUA"): "u", ("FLY","TUA","RAM"): "a"}
CTL = {DOG_CTL: "#D", ICE_CTL: "#I", MB_CTL: "#M"}
def c(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"
vals = ",\n".join("(" + ",".join([c(r["ref"]), c(RK[tuple(r["runs"])]), c(r["area"]), c(r["address"]), c(r["kinds"][0]), c(r["severity"][0]), c(r["rule"]), c(r["note"]), c(CTL.get(r["control"], r["control"]))]) + ")" for r in rows)
compact = f"""insert into public.hazards (ref, runs, area, address, kinds, severity, rule, note, control, source)
select ref, case rk when 'r' then array['RSB','WH'] when 'p' then array['PCB','WH'] when 'b' then array['RSB','PCB','WH'] when 'o' then array['RAM'] when 'u' then array['FLY','TUA'] else array['FLY','TUA','RAM'] end,
  area, address, array[k], case s when 'h' then 'high' when 'm' then 'medium' else 'low' end, rule, note,
  case ctl when '#D' then {c(DOG_CTL)} when '#I' then {c(ICE_CTL)} when '#M' then {c(MB_CTL)} else ctl end,
  case when ref like 'WH-%' then {c(WH_SRC)} else {c(TP_SRC)} end
from (values
{vals}
) v(ref, rk, area, address, k, s, rule, note, ctl)
on conflict (ref) do update set runs = excluded.runs, area = excluded.area, address = excluded.address, kinds = excluded.kinds, severity = excluded.severity,
  rule = excluded.rule, note = excluded.note, control = excluded.control, source = excluded.source;
"""
OUT.write_text(f"-- Seed the hazard register from the paper registers ({len(rows)} rows). Generated by tools/hazard_seed.py – re-runnable (upserts on ref).\n" + compact)
print("compact seed", len(compact), "->", OUT)
