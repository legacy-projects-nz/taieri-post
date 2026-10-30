#!/usr/bin/env python3
"""Build SQL to load the Run Board export (rb-export/) into the taieri-post Supabase database.
Usage: python3 -I tools/import_runboard.py <export_dir> <out.sql>
"""
import json, sys, os, datetime as dt

EXP, OUT = sys.argv[1], sys.argv[2]
def load(p):
    d = json.load(open(os.path.join(EXP, p)))
    return d.get("data", d)

cfg = load("settings/roster.json")
timing = load("settings/timing.json")
emails = load("leaveadmin/emails.json")["map"]

def q(s):
    if s is None: return "null"
    return "'" + str(s).replace("'", "''") + "'"
def arr(xs): return "array[" + ",".join(q(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"
def iarr(xs): return "array[" + ",".join(str(x) for x in xs) + "]::int[]"
def hm(mins): return "%02d:%02d" % (mins // 60, mins % 60)

DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
def m(h, i=0): return h*60+i

# Run definitions copied from the Run Board (W table), 30 Oct 2026
W = {
 "FLY":{"name":"Flyer","net":"nzp","d":{"Mon":[[m(5),m(10,30)]],"Wed":[[m(5),m(9,30)]],"Fri":[[m(5),m(9,30)]]}},
 "WH":{"name":"Saturday combined run","label":"PCB+RSB","net":"nzp","d":{"Sat":[[m(8),m(13)]]}},
 "RSB":{"name":"Roseneath / Sawyers Bay","net":"nzp","d":{"Mon":[[m(12,30),m(15)]],"Tue":[[m(12,30),m(17)]],"Wed":[[m(12,30),m(15)]],"Thu":[[m(12,30),m(17)]],"Fri":[[m(12,30),m(15)]],"Sat":[[m(8),m(13)]]}},
 "PCB":{"name":"Port Chalmers / Careys Bay","net":"nzp","d":{"Mon":[[m(8),m(11)]],"Tue":[[m(7,30),m(12)]],"Wed":[[m(8),m(11)]],"Thu":[[m(7,30),m(12)]],"Fri":[[m(8),m(11)]],"Sat":[[m(8),m(13)]]}},
 "TUA":{"name":"2nd Rural","net":"nzp","d":{"Mon":[[m(5),m(10,45)]],"Tue":[[m(5),m(9,45)]],"Wed":[[m(5),m(9,45)]],"Thu":[[m(5),m(9,45)]],"Fri":[[m(5),m(9,45)]]}},
 "RAM":{"name":"Outram T-RAM","net":"nzp","d":{"Mon":[[m(13),m(16)]],"Tue":[[m(13),m(16)]],"Wed":[[m(13),m(16)]],"Thu":[[m(13),m(16)]],"Fri":[[m(13),m(16)]]}},
 "LAW":{"name":"Lawrence","net":"nzp","d":{"Mon":[[m(9),m(13)]],"Tue":[[m(9),m(13)]],"Wed":[[m(9),m(13)]],"Thu":[[m(9),m(13)]],"Fri":[[m(9),m(13)]]}},
 "S":{"name":"Suburbs","label":"TGE (S)","net":"tge","d":{d:[[m(8),m(15,30)]] for d in DAYS[:5]}},
 "T":{"name":"Town","label":"TGE (T)","net":"tge","d":{d:[[m(8),m(15,30)]] for d in DAYS[:5]}},
 "DB":{"name":"Dunedin › Balclutha","label":"D>B","net":"nzp","d":{"Mon":[[m(5),m(10,30)]],"Tue":[[m(6,30),m(11,30)]],"Wed":[[m(5),m(9,30)]],"Thu":[[m(6,30),m(11,30)]],"Fri":[[m(5),m(9,30)]]}},
 "SUP":{"name":"NZP depot · Rural","label":"Sort – Rural","net":"nzp","novan":1,"slots":4,"d":{d:[[m(5),m(18)]] for d in DAYS[:6]}},
 "BU":{"name":"Back up","label":"Back up","net":"nzp","novan":1,"slots":2,"d":{d:[[m(5),m(18)]] for d in DAYS}},
 "SUP2":{"name":"TGE depot","label":"Sort – TGE","net":"tge","novan":1,"slots":2,"d":{d:[[m(6,30),m(8)]] for d in DAYS[:5]}},
 "SUP3":{"name":"NZP depot · West Harbour","label":"Sort – West Harbour","net":"nzp","novan":1,"slots":2,"d":{d:[[m(5),m(8)]] for d in DAYS[:6]}},
 "FB":{"name":"Food bag · am shift","label":"Food bag 1 AM","net":"sun","d":{"Sun":[[m(11),m(14)]]}},
 "FBP":{"name":"Food bag · pm shift","label":"Food bag 1 PM","net":"sun","d":{"Sun":[[m(14),m(17)]]}},
 "FB2":{"name":"Food bag · am shift","label":"Food bag 2 AM","net":"sun","d":{"Sun":[[m(11),m(14)]]}},
 "FB2P":{"name":"Food bag · pm shift","label":"Food bag 2 PM","net":"sun","d":{"Sun":[[m(14),m(17)]]}},
 "MFB1":{"name":"MFB 1","net":"sun","d":{"Sun":[[m(10),m(16)]]}},
 "MFB2":{"name":"MFB 2","net":"sun","d":{"Sun":[[m(10),m(16)]]}},
}
ORDER = ["TUA","DB","FLY","LAW","RAM","PCB","RSB","WH","S","T","FB","FBP","FB2","FB2P","MFB1","MFB2","SUP","SUP3","SUP2","BU"]

# current windows (settings.win overrides the defaults)
win = cfg.get("win", {})
def windows_for(code):
    out = {}
    for d in DAYS:
        k = d + "|" + code
        v = win.get(k) if k in win else W[code]["d"].get(d)
        if v: out[d] = [[hm(a), hm(b)] for a, b in v]
    return out

ADDONS = [
 ("outram","Outram Depot","Outram",10,False,["TUA"],False),
 ("pgg","PGG","PGG",10,False,["TUA"],False),
 ("airport","Airport","Airport",30,False,["TUA","FLY","RAM"],False),
 ("milton","Milton","Milton",90,False,["DB"],False),
 ("balclutha","Balclutha","Balclutha",90,False,["DB"],False),
 ("owaka","Owaka","Owaka",90,False,["DB"],False),
 ("rose","Roseneath receiver","Rose",0,True,["RSB","PCB","WH"],True),
 ("sb","Sawyers Bay receiver","SB",0,True,["RSB","PCB","WH"],True),
 ("fish","Harbour Fish pick-up","Fish",0,True,["RSB","PCB","WH"],True),
 ("pc","Port Chalmers receiver","PC rcv",0,True,["RSB","PCB","WH"],True),
 ("digi","Digi Art pick-up","Digi",0,True,["RSB","PCB","WH"],True),
 ("fonterra","Fonterra pick-up","Fonterra",0,True,["RSB","PCB","WH"],True),
 ("waihola","Waihola Store","Waihola",0,True,["FLY","TUA","DB"],False),
]

sql = []
sql.append("begin;")

# People ---------------------------------------------------------------
STAFF = [
 ("J","Jeremy","jeremy@lpnz.co.nz","owner",[]),
 ("AL","Alejandro","alejandromartinezdj@outlook.com","admin",["roster","scorecard","alerts","messages","leave","timing"]),
 ("ST","Stu","lynette.stu@gmail.com","fleet",["fleet"]),
]
seen = set()
for pid, name, email, role, perms in STAFF:
    seen.add(pid)
    sql.append(f"insert into people(id,name,email,role,perms) values ({q(pid)},{q(name)},{q(email)},{q(role)},{arr(perms)});")
for d in cfg["drivers"]:
    if d["id"] in seen: continue
    seen.add(d["id"])
    em = emails.get(d["id"])
    active = "false" if d["name"] == "Other" else "true"
    sql.append(f"insert into people(id,name,email,role,cleared,active) values ({q(d['id'])},{q(d['name'])},{q(em)},'driver',{'true' if d.get('cleared') else 'false'},{active});")

# Runs -----------------------------------------------------------------
for i, code in enumerate(ORDER):
    w = W[code]
    sql.append("insert into runs(code,name,label,network,slots,needs_van,sort,windows) values (%s,%s,%s,%s,%d,%s,%d,%s::jsonb);" % (
        q(code), q(w["name"]), q(w.get("label")), q(w["net"]), w.get("slots",1), "false" if w.get("novan") else "true", (i+1)*10, q(json.dumps(windows_for(code)))))

# Vans -----------------------------------------------------------------
van_plate = {}
for v in cfg["vans"]:
    van_plate[v["id"]] = v["plate"]
    sql.append(f"insert into vans(plate,name,make,colour,active) values ({q(v['plate'])},{q(v['plate'])},{q(v.get('make') or None)},{q(v.get('col'))},{'false' if v['plate']=='OTHER' else 'true'});")

# Add-ons --------------------------------------------------------------
for aid, name, short, mins, task, runs, nosat in ADDONS:
    sql.append(f"insert into addons(id,name,short,minutes,task,runs,no_saturday) values ({q(aid)},{q(name)},{q(short)},{mins},{'true' if task else 'false'},{arr(runs)},{'true' if nosat else 'false'});")
# timing rules without an existing add-on get their own tw_<id> add-on
for r in timing["rules"]:
    if not r.get("add"):
        runs = r.get("runs") or [r.get("run")]
        sql.append(f"insert into addons(id,name,short,minutes,task,runs,no_saturday) values ({q('tw_'+r['id'])},{q(r['name'])},{q(r['name'][:12])},0,true,{arr(runs)},false);")

# Timing rules ---------------------------------------------------------
for r in timing["rules"]:
    runs = r.get("runs") or [r.get("run")]
    addon = r.get("add") or ("tw_" + r["id"])
    days = [d+1 for d in r.get("days", [0,1,2,3,4])]   # Run Board 0=Mon → ISO 1=Mon
    sql.append("insert into timing_rules(id,name,opens,closes,runs,addon,days,note) values (%s,%s,%s,%s,%s,%s,%s,%s);" % (
        q(r["id"]), q(r["name"]), q(r.get("from") or None), q(r.get("to") or None), arr(runs), q(addon), iarr(days), q(r.get("note") or None)))

# Run experience -------------------------------------------------------
for k, lvl in cfg.get("skills", {}).items():
    drv, run = k.split("|")
    if run not in W or drv not in seen: continue
    sql.append(f"insert into run_skills(driver,run,level) values ({q(drv)},{q(run)},{q(lvl)});")

# Roster weeks ---------------------------------------------------------
rdir = os.path.join(EXP, "roster")
for fn in sorted(os.listdir(rdir)):
    week = fn[:-5]
    mon = dt.date.fromisoformat(week)
    data = load("roster/" + fn)
    assign = data.get("assign", {})
    notes = data.get("notes", "")
    if notes:
        sql.append(f"insert into week_notes(week_start,notes) values ({q(week)},{q(notes)});")
    for key, a in assign.items():
        day, run = key.split("|")
        if run not in W or day not in DAYS: continue
        date = mon + dt.timedelta(days=DAYS.index(day))
        wins = windows_for(run).get(day) or [[None, None]]
        start, end = wins[0]
        van = van_plate.get(a.get("van")) if a.get("van") else None
        slots = [("drv", "st", 1), ("drv2", "st2", 2), ("drv3", "st3", 3), ("drv4", "st4", 4)]
        for dk, sk, slot in slots:
            drv = a.get(dk)
            if not drv and slot > 1: continue
            if drv and drv not in seen: drv = None
            st = a.get(sk)
            s = hm(int(round(float(st)*60))) if st is not None else start
            tr = a.get("tr") if slot == 1 else None
            if tr and tr not in seen: tr = None
            adds = a.get("add", []) if slot == 1 else []
            sql.append("insert into shifts(day,run,slot,driver,van,start_at,end_at,addons,trainee) values (%s,%s,%d,%s,%s,%s,%s,%s,%s);" % (
                q(date.isoformat()), q(run), slot, q(drv), q(van if slot == 1 else None), q(s), q(end), arr(adds), q(tr)))

# Leave (from the Run Board leave collection, copied by hand 30 Oct 2026)
sql.append("insert into leave_requests(driver,type,date_from,date_to,part,notes,status,decided_by,decided_at,acked_email_at,created_at) values ('G','annual','2026-12-28','2027-01-15','full','Entered by Jeremy','approved','J','2026-10-25T02:50:00Z','2026-10-25T02:51:00Z','2026-10-25T02:50:00Z');")
sql.append("insert into leave_requests(driver,type,date_from,date_to,part,notes,status,decided_by,decided_at,created_at) values ('J','annual','2026-10-28','2026-10-31','full','','declined','J','2026-10-25T22:37:25Z','2026-10-25T21:54:10Z');")

sql.append("commit;")
open(OUT, "w").write("\n".join(sql) + "\n")
print(len(sql), "statements →", OUT)
