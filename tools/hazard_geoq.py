"""Works out a geocoding query (geo_q) for each seeded hazard from its address + area. Rows that are a whole road or
not a place at all (winter, footwear, long rural roads, mailbox lists) get no query and stay without GPS."""
import re, sys, json
sys.path.insert(0, "tools")
import importlib.util
spec = importlib.util.spec_from_file_location("seed", "tools/hazard_seed.py"); seed = importlib.util.module_from_spec(spec)
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()): spec.loader.exec_module(seed)
SKIP = {"WH-118", "WH-119", "WH-120", "WH-121", "TP-R02", "TP-R03", "TP-S03", "TP-I01", "TP-R01", "TP-I03", "WH-071", "WH-072", "WH-073"}
CITY = {"Roseneath": "Roseneath, Dunedin", "Sawyers Bay": "Sawyers Bay, Dunedin", "Port Chalmers": "Port Chalmers, Dunedin", "Careys Bay": "Careys Bay, Dunedin", "Outram": "Outram", "Mosgiel": "Mosgiel"}
FIX = {"WH-027": "29 Hall Road", "WH-042": "Hugh Street", "WH-100": "44 Bellevue Place", "WH-097": "65 Wickliffe Terrace", "WH-111": "Wickliffe Terrace", "WH-076": "Henry Street", "WH-083": "Coombe Hay Terrace",
       "WH-012": "Kilgour Street", "WH-093": "Currie Court", "WH-066": "George Street", "WH-067": "George Street", "WH-068": "George Street", "WH-069": "George Street", "WH-070": "George Street",
       "WH-080": "Macandrew Road", "WH-081": "Macandrew Road", "WH-021": "Stevenson Avenue", "WH-017": "Freyberg Avenue", "WH-060": "Borlases Road",
       "TP-RL1": "Gladstone Road North", "TP-RL2": "Riccarton Road", "TP-S01": "Outram School", "TP-S02": "Mountfort Street", "TP-F02": "Bell Street", "TP-I02": "16 Three Kings Deck", "TP-D03": "8 Three Kings Deck",
       "TP-F01": "Lower Bidston Road", "TP-I04": "Rodeo Place"}
out = {}
for r in seed.rows:
    ref = r["ref"]
    if ref in SKIP or ref.startswith("TP-MB") or not r["area"] or r["area"] == "Rural": continue
    a = FIX.get(ref)
    if not a:
        a = r["address"]
        if " – " in a:   # "Clyde Street – 4 & 6A" -> "4 Clyde Street"; "Kilgour Street – all" -> "Kilgour Street"
            street, det = a.split(" – ", 1); street = street.split(" / ")[0]
            m = re.match(r"^(\d+[A-Za-z]?)\b", det); a = f"{m.group(1)} {street}" if m else street
        a = re.sub(r"^(\d+[A-Za-z]?)[–-]\d+[A-Za-z]? ", r"\1 ", a)   # "2–16 Henry Street" -> "2 Henry Street"
    out[ref] = f"{a}, {CITY[r['area']]}, New Zealand"
json.dump(out, open(sys.argv[1], "w"), indent=0, ensure_ascii=False)
print(len(out), "queries")
for k in list(out)[:8] + ["TP-D03", "WH-075", "WH-007"]: print(k, out[k])
