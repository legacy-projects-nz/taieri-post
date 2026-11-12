// Scoring engine — the Driver Scorecard rules on the new structured data (sod/eod rows instead of WhatsApp posts)
import { toMin, fmtT, dow, addDays, label, today, nzNow, isSort } from "./core.js";

const DEF = {
  rules: { sodGrace: 15, eodHours: 2, perEvent: 2, partEvent: 1, mistakePct: 10, adminFloor: 80, holidayCap: 8, stopRatio: 0.8, hourRate: 28, startDate: "2026-10-26", adminStart: "2026-10-28", effStart: "2026-10-28", effMethod: "sheet", tgeSort: 90, vchkDay: 4, vchkTime: "17:00" },
  weights: { admin: 25, eff: 30, acc: 25, safe: 20 },
  sortF: { pBase: 45, pIncl: 80, pRate: 0.35, mailTray: 20, nzcph: 30 },
  addMin: { outram: 10, pgg: 10, airport: 30, milton: 90, balclutha: 90, owaka: 90 },
  news: { runs: ["FLY", "TUA"], min: 45 },
  typical: { TUA: 40, FLY: 55, RAM: 85, LAW: 95, DB: 40, PCB: 55, RSB: 50, WH: 105, S: 110, T: 110 },
  effSimple: {},
  estFig: {},
  // expected sorting minutes on the run itself (no sort shift before it). 0 = a "go" run: it starts with the SOD / Sort done tap.
  // A number, or { d: default, Mon…Sat: that day } for runs that vary by day.
  sortMin: { S: 90, T: 90, DB: 60, RSB: { d: 45, Tue: 75, Thu: 75, Sat: 60 }, PCB: { d: 90, Tue: 120, Thu: 120 }, RAM: 0, TUA: 0, FLY: 0 },
};
// expected sort minutes for a run on a day (null = no norm set)
export function sortExp(C, code, day) { const v = C?.sortMin?.[code]; if (v == null) return null; if (typeof v === "number") return v;
  const k = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow(day)]; return v[k] ?? v.d ?? null; }
export const NET = c => /^(S|T)$/.test(c) ? "tge" : /^(FB|MFB)/.test(c) ? "fb" : "nzp";
export const PICKUP_RUNS = ["TUA", "FLY", "DB"];
export const LEGS = ["airport", "milton", "balclutha", "owaka"];
export const LEG_RUNS = { TUA: ["outram", "pgg", "airport"], FLY: ["airport", "milton", "balclutha", "owaka"], DB: ["milton", "balclutha", "owaka"], RAM: ["airport"] };

export function cfg(settings) { const o = {}; for (const k of Object.keys(DEF)) o[k] = { ...DEF[k], ...(settings[k] || {}) }; o.runCodes = settings.runCodes || {}; o.holidays = settings.holidays || {}; o.bands = settings.bands || {}; return o; }

/* ---- Start-time sign-off: a SOD more than rules.sodReqMins (20) before the rostered start counts from the rostered start
   until Jeremy/admin approves the early start (approving moves the roster, so the SOD is no longer early). From rules.sodReqStart on.
   A start time edited at sign-off (sod.start_at) is used as-is. ---- */
export function sodStart(sod, dayStart, C) {
  if (!sod) return null; const R = C?.rules || {};
  if (sod.start_at) return toMin(sod.start_at);   // start time set by Jeremy/admin at sign-off
  const m = nzNow(new Date(sod.sent_at)).min;
  if (dayStart == null || nzNow(new Date(sod.sent_at)).date < (R.sodReqStart ?? "2026-11-11")) return m;
  return m < dayStart - (R.sodReqMins ?? 20) ? dayStart : m;
}
/* ---- Shift windows (minutes) ---- */
export function segTimes(s, runsBy) {
  let st = toMin(s.start_at), en = toMin(s.end_at);
  const r = runsBy[s.run]; const w = r?.windows?.[["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][dow(s.day)]];
  if (st == null && w) st = toMin(w[0][0]); if (en == null && w) en = toMin(w[0][1]);
  return { st, en };
}
/** Group a driver's shifts into days: {day, segs:[{shift, st, en, sort}], start, end, hours} */
export function dayShifts(shifts, runsBy, driver) {
  const by = {};
  for (const s of shifts) { if (driver && s.driver !== driver) continue; if (s.run === "BU") continue; (by[s.day] ??= []).push(s); }
  const out = {};
  for (const [day, list] of Object.entries(by).sort((a, b) => a[0].localeCompare(b[0]))) {   // days in date order (Mon → Sun)
    const segs = list.map(s => { const { st, en } = segTimes(s, runsBy); return { shift: s, st, en, sort: isSort(s.run) }; }).filter(x => x.st != null).sort((a, b) => a.st - b.st);
    // sort shifts without an end run until the next run starts (max 3 h)
    segs.forEach((x, i) => { if (x.sort && (x.en == null || x.en <= x.st)) { const nx = segs.slice(i + 1).find(y => !y.sort); x.en = nx ? Math.min(nx.st, x.st + 180) : x.st + 90; } });
    // a sort ends when the driver's run starts: if a run begins part-way through the rostered sort, the sort is shown and counted up to that start (rostEn keeps the rostered end)
    segs.forEach(x => { if (!x.sort) return; const nx = segs.find(y => !y.sort && y.st > x.st && y.st < x.en); if (nx) { x.rostEn = x.en; x.en = nx.st; } });
    const start = Math.min(...segs.map(x => x.st)), end = Math.max(...segs.map(x => x.en ?? x.st));
    // No time is counted twice: where shifts overlap (e.g. a sort rostered to 12:30 with a run starting at 8:30) the overlap counts once.
    // Runs keep their full time; a sort only counts the minutes no run covers; a later run only counts what an earlier run doesn't cover.
    // x.min = the minutes that count for this shift, x.over = minutes dropped as overlap. The rostered times themselves (st / en) are left as they are.
    const cov = []; for (const x of [...segs.filter(y => !y.sort), ...segs.filter(y => y.sort)]) { const a0 = x.st, b0 = x.en ?? x.st; const len = Math.max(0, b0 - a0);
      const cut = cov.map(([c, d]) => [Math.max(a0, c), Math.min(b0, d)]).filter(([c, d]) => d > c).sort((p, q) => p[0] - q[0]); let ov = 0, at = a0; for (const [c, d] of cut) { if (d > at) { ov += d - Math.max(c, at); at = d; } }
      x.min = len - ov; x.over = ov; if (len) cov.push([a0, b0]); }
    segs.forEach((x, i) => { if (!x.sort && segs[i - 1]?.sort) x.preSort = segs[i - 1]; });   // team sort just before this run: paid, not scored
    out[day] = { day, segs, start, end, over: segs.reduce((a, x) => a + x.over, 0), hours: Math.round(segs.reduce((a, x) => a + x.min, 0) / 6) / 10 };
  }
  return out;
}

/* ---- Items: what each driver must post, and whether they did ---- */
// returns [{key, day, driver, kind:'SOD'|'EOD', shift, code, due, closeAt, at, st, late, auto}]
export function itemsFor(driver, days, sods, eods, marks, C, nowRef) {
  const now = nowRef || nzNow(); const R = C.rules; const items = [];
  const sodBy = {}; for (const s of sods) sodBy[s.shift_id] = s;
  const eodBy = {}; for (const e of eods) eodBy[e.shift_id] = e;
  const mk = {}; for (const m of marks) mk[m.key] = m;
  const minsAt = (iso, day) => { const n = nzNow(new Date(iso)); const d = (new Date(n.date) - new Date(day)) / 86400000; return n.min + d * 1440; };
  const status = (it) => {
    const nowMin = now.date === it.day ? now.min : (now.date > it.day ? 1e9 : -1e9);
    if (it.at != null && it.kind === "EOD") { const e = eodState(it.sched, it.at, it.row?.finish_time); it.st = e.st; it.late = 0; it.posted = e.posted; it.overFin = e.overFin; }
    else if (it.at != null) { it.late = Math.max(0, it.at - it.due); it.st = it.late > 0 ? "late" : "ok"; }
    else it.st = nowMin > it.closeAt ? "miss" : nowMin > it.due ? "over" : it.sched != null && nowMin > it.sched ? "wait" : "due";   // wait = past the rostered time but still inside the allowance
    it.auto = it.st; const m = mk[it.key]; if (m?.status) { it.st = m.status; it.mark = m; } else if (m) it.mark = m;
    if (it.day < R.adminStart) { it.st = "exc"; it.pre = true; }
    return it;
  };
  for (const d of Object.values(days)) {
    if (d.day < R.startDate) continue;
    const firstSeg = d.segs[0];
    const sod = d.segs.map(x => sodBy[x.shift.id]).find(Boolean);
    items.push(status({ key: `${d.day}|${driver}|day|SOD`, day: d.day, driver, kind: "SOD", shift: firstSeg.shift, code: null, sched: d.start, due: d.start + R.sodGrace, closeAt: d.end + R.eodHours * 60, at: sod ? minsAt(sod.sent_at, d.day) : null, row: sod, label: "SOD" }));
    const runs = d.segs.filter(x => !x.sort);
    if (runs.length) for (const x of runs) {
      const e = eodBy[x.shift.id]; const due = (x.en ?? x.st) + R.eodHours * 60;
      items.push(status({ key: `${d.day}|${driver}|${x.shift.run}|EOD`, day: d.day, driver, kind: "EOD", shift: x.shift, code: x.shift.run, sched: x.en ?? x.st, due, closeAt: due + 1, at: e ? minsAt(e.sent_at, d.day) : null, row: e, label: `EOD · ${x.shift.run}` }));
    } else {
      const x = d.segs[d.segs.length - 1]; const e = d.segs.map(y => eodBy[y.shift.id]).find(Boolean); const due = d.end + R.eodHours * 60;
      items.push(status({ key: `${d.day}|${driver}|day|EOD`, day: d.day, driver, kind: "EOD", shift: x.shift, code: null, sched: d.end, due, closeAt: due + 1, at: e ? minsAt(e.sent_at, d.day) : null, row: e, label: "EOD" }));
    }
  }
  return items;
}
/** EOD colours (from 11 Nov 2026, applied to all EODs): an EOD is never recorded late.
 *  green "ok"   – finish time within 1 h of the expected (rostered) finish and posted within 1 h of it
 *  orange "slow" – finish time more than 1 h after expected: an efficiency/speed flag, not an Admin late
 *  grey "lsub"  – finish time fine but the EOD was posted more than 1 h after expected (drivers can set their time later) */
export const EOD_FLAG_MIN = 60;
export function eodState(sched, at, finishTime) {
  const fin = toMin(finishTime); const exp = sched ?? null;
  const posted = exp == null ? 0 : Math.max(0, at - exp);
  let overFin = 0; if (exp != null && fin != null) { let f = fin; while (f < exp - 720) f += 1440; overFin = Math.max(0, f - exp); }
  const st = overFin > EOD_FLAG_MIN ? "slow" : posted > EOD_FLAG_MIN ? "lsub" : "ok";
  return { st, posted, overFin };
}
/** Fix posts: an EOD that is only a little late (up to rules.eodFixGrace minutes, default 90) still counts as late but needs no fix entry */
export const needsFix = (it, C) => !(it.kind === "EOD" && it.st === "late" && (it.late ?? 0) <= (C?.rules?.eodFixGrace ?? 90));
export const STATE_LABEL = { slow: "Finished 1h+ over", lsub: "Posted 1h+ after", ok: "On time", late: "Late", part: "Incomplete", over: "Overdue", miss: "Missing", exc: "Excused", due: "Due", wait: "Waiting" };
export function itemNote(it) {
  if (it.st === "ok") return `posted ${fmtT(it.at % 1440)}`;
  if (it.st === "slow") return `finished ${late(it.overFin)} after expected · posted ${fmtT(it.at % 1440)}`;
  if (it.st === "lsub") return `posted ${fmtT(it.at % 1440)}, ${late(it.posted)} after expected · not counted late`;
  if (it.st === "late") return `posted ${fmtT(it.at % 1440)}, late by ${late(it.late)}`;
  if (it.st === "miss") return "not posted";
  if (it.st === "over") return `not posted yet · due ${fmtT(it.due % 1440)}`;
  if (it.st === "due") return `by ${fmtT(it.due % 1440)}`;
  if (it.st === "wait") return `waiting · allowed until ${fmtT(it.due % 1440)}`;
  if (it.st === "exc") return "excused";
  return "";
}
export const late = m => m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}m`;

/* ---- Evidence: average EOD figures per run and weekday from recent EODs — the estimate used until a run's EOD is in ---- */
let EVID = null; const EV_KEYS = ["parcels", "stops", "trays", "sort_min", "pickups", "pickup_parcels"];
// a figure that's plainly a slip isn't used in the averages: 0 parcels or 0 stops, or stops under a fifth of the parcels on a 20+ parcel day
const evOk = (e, k) => { const v = e[k]; if (v == null || v === "" || isNaN(+v)) return false; if ((k === "parcels" || k === "stops") && +v <= 0) return false;
  if (k === "stops" && +e.parcels >= 20 && +v < +e.parcels / 5) return false; return true; };
export function setEvidence(shifts, eods, weeks = 8) {
  const byShift = Object.fromEntries(shifts.map(s => [s.id, s])); const since = addDays(today(), -7 * weeks); const acc = {};
  for (const e of eods) { const s = byShift[e.shift_id]; if (!s || s.day < since || isSort(s.run) || !e.finish_time && e.parcels == null) continue; for (const scope of [dow(s.day), "all"]) { const o = (acc[s.run] ??= {})[scope] ??= { n: 0 }; o.n++; for (const k of EV_KEYS) if (evOk(e, k)) (o[k] ??= []).push(+e[k]); } }
  EVID = {}; for (const [code, scopes] of Object.entries(acc)) { EVID[code] = {}; for (const [scope, o] of Object.entries(scopes)) { const out = { n: o.n }; for (const k of EV_KEYS) if (o[k]?.length) { out[k] = Math.round(o[k].reduce((a, b) => a + b, 0) / o[k].length * 10) / 10; out[k + "_n"] = o[k].length; } EVID[code][scope] = out; } }
  return EVID;
}
// each figure: that weekday's average when it has 2+ good values, otherwise the average over all days
export function evidenceFor(code, day) { if (!EVID?.[code]) return null; const d = EVID[code][dow(day)], a = EVID[code].all; if (!d && !a) return null;
  const out = { n: (d?.n >= 2 ? d.n : a?.n) || 0, scope: d?.n >= 2 ? "weekday" : "all" };
  for (const k of EV_KEYS) { const w = d && d[k + "_n"] >= 2 ? d[k] : null; const v = w ?? a?.[k]; if (v != null) out[k] = v; }
  return out; }
export const evidence = () => EVID;

/* ---- Efficiency ---- */
/** Breaks are unpaid from this moment (9 Nov 2026) — they come off paid hours and efficiency time from then on. */
export const UNPAID_BREAKS_FROM = Date.parse("2026-11-09T01:48:00Z");
/** A driver's finished unpaid breaks on a shift's day, as NZ-minute windows [from, to]. effCalc takes off only the part of each break
 *  that falls inside the run (from run start to finish) and the part inside the sort before it (off the sort time).
 *  all = also count breaks before 9 Nov (the owner, Jeremy, always had his taken off). */
export function ownerBreakHrs(breaks, shift, all = false) {
  return (breaks || []).filter(b => b.driver === shift.driver && b.ended_at && (all || Date.parse(b.started_at) >= UNPAID_BREAKS_FROM) && nzNow(new Date(b.started_at)).date === shift.day)
    .map(b => { const s = nzNow(new Date(b.started_at)), e = nzNow(new Date(b.ended_at)); return [s.min + (Date.parse(b.started_at) % 60000) / 60000, e.date === s.date ? e.min + (Date.parse(b.ended_at) % 60000) / 60000 : 1440]; });
}
const overlap = (wins, f, t) => f == null || t == null || t <= f ? 0 : (wins || []).reduce((a, [s, e]) => a + Math.max(0, Math.min(e, t) - Math.max(s, f)), 0);
export function effCalc(seg, eod, ov, C, runsBy, ctx = {}) {
  const code = seg.shift.run, model = C.effSimple[code]; if (!model) return null;
  const net = model.net || NET(code); const g = []; const parts = []; const ev = evidenceFor(code, seg.shift.day);
  const v = (k, fallback) => { if (ov && ov[k] != null) return { v: ov[k], src: "set by hand" }; if (eod && eod[k] != null) return { v: eod[k], src: "driver posted" }; if (ev && ev[k] != null) { g.push(k); return { v: ev[k], src: "average of past EODs" }; } if (fallback != null) { g.push(k); return { v: fallback, src: "best guess" }; } return { v: null, src: "missing" }; };
  const typ = C.typical[code] || 50; const est = C.estFig[code] || {};
  const parcels = v("parcels", est.parcels ?? typ), stops = v("stops", est.stops ?? Math.round((est.parcels ?? typ) * (net === "tge" ? 0.65 : 0.8)));
  const trays = v("trays", 1), pickups = v("pickups", 0), pup = v("pickup_parcels", 0);
  let min = model.base; parts.push(["Base", `${model.base} min`, model.base]);
  const add = (lbl, calc, m) => { if (m) { parts.push([lbl, calc, Math.round(m)]); min += m; } };
  add("Parcels", `${parcels.v} × ${model.parcel}`, parcels.v * (model.parcel || 0));
  add("Stops", `${stops.v} × ${model.stop}`, stops.v * (model.stop || 0));
  if (model.tray) add("Trays", `${trays.v} × ${model.tray}`, trays.v * model.tray);
  if (model.pickup) add("Pick-up stops", `${pickups.v} × ${model.pickup}`, pickups.v * model.pickup);
  if (model.puparcel) add("Pick-up parcels", `${pup.v} × ${model.puparcel}`, pup.v * model.puparcel);
  // sorting
  const sortMin = ov?.sort_min ?? eod?.sort_min; const pre = seg.preSort;
  // SOR / EOR taps (drivers on more than one run that day) give each run its own real start and finish
  const sorM = seg.shift.sor_at ? nzNow(new Date(seg.shift.sor_at)).min : null, eorM = seg.shift.eor_at ? nzNow(new Date(seg.shift.eor_at)).min : null;
  // after a team sort shift the run starts when the sort ends: the ▶ Start tap, else the sort's end tap, else its start (SOD / tap / roster) + its rostered length
  const preSt = pre ? (ctx.sodMin ?? (pre.shift.sor_at ? nzNow(new Date(pre.shift.sor_at)).min : pre.st)) : null;
  const start = ov?.start_at ? toMin(ov.start_at) : pre ? (sorM ?? (pre.shift.eor_at ? nzNow(new Date(pre.shift.eor_at)).min : preSt + (pre.min ?? Math.max(0, (pre.en ?? pre.st) - pre.st)))) : ctx.sodMin ?? sorM ?? seg.st;
  const sortTaken = pre && start != null && preSt != null ? Math.max(0, start - preSt - overlap(ctx.brk, preSt, start)) : 0;   // minutes on the team sort (paid, not scored), less any unpaid break inside it
  // Load and go: after a team sort (or on a run that comes pre-loaded, like RAM) the run gets a set time to load the van and go.
  // TUA is already loaded (0), Flyer / RAM / NZ Post runs 15 min, TGE 30 min. Change in settings → rules.loadGo { CODE: min, default: min }.
  // PCB is loaded inside the West Harbour sort; RSB has its own sort-and-load time below
  const LG = { TUA: 0, PCB: 0, RSB: 0, FLY: 30, S: 30, T: 30, default: 15, ...(C.rules.loadGo || {}) }; const preLoaded = (C.rules.noSortRuns || ["RAM"]).includes(code);
  const lgMin = LG[code] ?? (net === "tge" ? 30 : LG.default);
  if (pre || preLoaded) { if (lgMin) add("Load and go", `${lgMin} min${pre ? ` (sorting done on ${pre.shift.run})` : " (comes written up and scanned)"}`, lgMin); }
  // RSB: its own sort and load, by day (45 min Mon/Wed/Fri, 60 Sat, 75 Tue/Thu). On the driver's sort shift when there is one (team time);
  // otherwise (RSB straight after another run) it is allowed on the run in place of the sorting formula. Change in settings → rules.rsbSort.
  const fixedSort = code === "RSB" ? ({ Mon: 45, Tue: 75, Wed: 45, Thu: 75, Fri: 45, Sat: 60, ...(C.rules.rsbSort || {}) })[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(seg.shift.day + "T00:00:00Z").getUTCDay()]] : null;
  if (fixedSort && !pre) add("Sort and load", `${fixedSort} min (RSB, set by day)`, fixedSort);
  if (net === "tge") { if (!pre) { const sm = sortMin ?? (g.push("sort_min"), ev?.sort_min ?? (C.rules.tgeSort || 75)); add("Sorting", `${sm} min`, sm); } }
  else {
    // Sorting done on a sort shift (SUP…) is team work: paid, but out of efficiency both ways — the run is timed from when the sort ends
    // and gets no sorting allowance. Without a sort shift before it, sorting the driver says they did on the run is allowed by the formula.
    const sp = ov?.sorted_parcels ?? eod?.sorted_parcels, smail = ov?.sorted_mail ?? eod?.sorted_mail;
    if (!pre && !preLoaded && !fixedSort) {
      if (sp) add("Sorting parcels", `${C.sortF.pBase} + (${parcels.v} − ${C.sortF.pIncl}) × ${C.sortF.pRate}`, C.sortF.pBase + Math.max(0, parcels.v - C.sortF.pIncl) * C.sortF.pRate);
      if (smail) add("Sorting mail", `${trays.v} × ${C.sortF.mailTray}`, trays.v * C.sortF.mailTray);
    }
    const np = ov?.nzc_ph ?? eod?.nzc_ph; if (np && PICKUP_RUNS.includes(code)) add("NZC/PH pick-up", `${C.sortF.nzcph} min`, C.sortF.nzcph);
  }
  // add-ons / legs
  if (model.addon != null && !(ov?.legs)) add("Add-ons (estimate)", `${model.addon} min`, model.addon);
  else { const legs = ov?.legs || [...new Set([...(seg.shift.addons || []), ...((eod?.legs) || [])])]; for (const l of legs) if (C.addMin[l]) add(addName(l), `${C.addMin[l]} min`, C.addMin[l]); }
  const newsMin = C.news.byRun?.[code] ?? C.news.min; if (model.news && (ov?.news_min || eod?.newspapers)) add("Newspapers", `${newsMin} min`, ov?.news_min || newsMin);
  // the run minimum includes sorting; only a run whose van is already loaded (TUA) has the team sort taken off it
  const cutFloor = pre && (C.rules.floorCutRuns || ["TUA"]).includes(code);
  const floor = model.floor ? Math.max(0, model.floor - (cutFloor ? sortTaken : 0)) : 0;
  if (floor && min < floor) add("Minimum top-up", `run minimum ${model.floor} min (sorting + delivery)${cutFloor ? ` − ${Math.round(sortTaken)} min team sort` : ""}`, floor - min);
  // team sort counted into this driver's efficiency (settings → rules.sortInEff { driverId: min }): the sort gets a set allowance
  // and the time taken runs from the start of the sort instead of from when it ends
  const sortIn = pre ? (C.rules.sortInEff || {})[seg.shift.driver] ?? null : null;
  if (sortIn != null) add("Team sort", `${sortIn} min allowed (sorting on ${pre.shift.run} counted in)`, sortIn);
  const allowed = min;
  // taken
  const endT = ov?.end_at ? toMin(ov.end_at) : eorM ?? (eod?.finish_time ? toMin(eod.finish_time) : (eod ? nzNow(new Date(eod.sent_at)).min : null));
  const tSt = sortIn != null && preSt != null ? preSt : start;
  const taken = (tSt != null && endT != null && endT > tSt) ? (endT - tSt) / 60 : null;
  let takenTrk = taken; if (ov?.train_day) takenTrk = 0; else if (ov?.train_min && taken) takenTrk = Math.max(0.01, taken - ov.train_min / 60);
  const brkH = Array.isArray(ctx.brk) ? overlap(ctx.brk, tSt, endT) / 60 : (ctx.brk || 0); if (brkH && takenTrk) takenTrk = Math.max(0.01, takenTrk - brkH);   // owner's unpaid breaks
  const need = []; if (!eod) need.push("EOD"); else { if (start != null && endT != null && endT <= start) need.push("Times (SOD is after the EOD finish)"); for (const k of ["parcels", "stops"]) if ((model[k === "parcels" ? "parcel" : "stop"] || 0) > 0 && eod[k] == null && ov?.[k] == null) need.push(k === "parcels" ? (net === "tge" ? "Delivery total" : "Total parcels") : (net === "tge" ? "Jobs" : "Stops")); if (net === "tge" && !pre && sortMin == null) need.push("Sorting time"); if (!eod.finish_time) need.push("Finish time"); }
  let perf = null; if (taken && takenTrk !== 0) perf = C.rules.effMethod === "tdt" ? (2 - takenTrk / (allowed / 60)) * 100 : (allowed / 60) / takenTrk * 100; if (perf != null) perf = Math.max(0, Math.min(150, perf));
  return { code, net, allowed, parts, sortTaken, sortIn, sortFrom: pre ? preSt : null, sortRun: pre?.shift.run || null, taken, takenTrk, brk: brkH, perf, need, est: g.length > 0, guess: g, trainDay: !!ov?.train_day, start, end: endT, model, evid: ev ? ev.scope : null, evN: ev?.n || 0, noEod: !eod, figs: { parcels, stops, trays, pickups, pup } };
}
/* Milton meet: the D>B driver sets the drop-off time each day (shifts.milton_at, copied onto that day's LAW shift).
   It replaces the timing rule's usual 10:30 for both runs, and puts the meet on the LAW driver's list even if not ticked. */
export const MEET_ADDONS = ["milton", "tw_t10"];
export const meetOn = (r, s) => r?.addon === "tw_t10" && !!s?.milton_at;
export function meetRule(r, s) {
  if (!r || !MEET_ADDONS.includes(r.addon) || !s?.milton_at) return r;
  const hm = String(s.milton_at).slice(0, 5); const t = fmtT(toMin(hm));
  return { ...r, closes: hm, meet: hm, note: (r.note || "").replace(/\b\d{1,2}:\d{2}(\s*[ap]m)?\b/gi, t) || `Meet at Milton at ${t}` };
}
/* add-on names: the add-ons table (loaded by each app via setAddonNames) wins; the fixed list below is only the fallback */
let ADDON_NAMES = {};
export function setAddonNames(list) { ADDON_NAMES = Object.fromEntries((list || []).filter(a => a?.id && a.name).map(a => [a.id, a.name])); }
export function addName(k) { return ADDON_NAMES[k] || ({ outram: "Outram Depot", pgg: "PGG", airport: "Airport", milton: "Milton", balclutha: "Balclutha", owaka: "Owaka", rose: "Roseneath receiver", sb: "Sawyers Bay receiver", fish: "Harbour Fish pick-up", pc: "Port Chalmers receiver", digi: "Digi Art pick-up", fonterra: "Fonterra pick-up", waihola: "Waihola Store" })[k] || k; }

/* "+ Hours": approved extra minutes a driver logged for a day (vehicle clean, check, maintenance, admin, Jeremy's requests) */
export const XT_KINDS = { van_clean: { name: "Vehicle clean", min: 20 }, vehicle_check: { name: "Vehicle check", min: 10 }, vehicle_maint: { name: "Vehicle maintenance" }, admin: { name: "Admin" }, owner_request: { name: "Jeremy's request", approve: true } };
export function extraMins(list, driver, day) { return (list || []).filter(e => e.driver === driver && e.day === day && e.status === "approved").reduce((a, e) => a + (e.minutes || 0), 0); }

/* ---- Scores for one driver over a date range ---- */
// Same driver + dates + data snapshot → same answer, so keep it: a render asks for the same scores many times over (team averages,
// 8-week trends, pay bands). The cache lives on the data object, so it's dropped as soon as fresh data is loaded.
const MEMO = new WeakMap();
export function scoreFor(driver, from, to, D, C) {
  let m = MEMO.get(D); if (!m || m.C !== C) MEMO.set(D, m = { C, map: new Map() });
  const k = driver + "|" + from + "|" + to; if (m.map.has(k)) return m.map.get(k);
  const r = scoreForRaw(driver, from, to, D, C); m.map.set(k, r); return r;
}
function scoreForRaw(driver, from, to, D, C) {
  // D: {shifts, sods, eods, marks, entries, feed, runsBy, nowRef}
  const days = dayShifts(D.shifts.filter(s => s.day >= from && s.day <= to), D.runsBy, driver);
  const items = itemsFor(driver, days, D.sods, D.eods, D.marks, C, D.nowRef);
  const closed = items.filter(i => !["due", "wait", "over", "exc"].includes(i.st));
  const onTime = closed.filter(i => i.st === "ok" || i.st === "part" || i.st === "slow" || i.st === "lsub").length;
  const events = closed.filter(i => i.st === "late" || i.st === "miss").length;
  const nPart = closed.filter(i => i.st === "part").length;
  const ents = D.entries.filter(e => e.driver === driver && e.day >= from && e.day <= to);
  const adj = ents.filter(e => e.admin_pts).reduce((a, e) => a + (+e.admin_pts), 0);
  const admin = closed.length || adj ? Math.max(C.rules.adminFloor, Math.min(100, 100 - events * C.rules.perEvent - nPart * (C.rules.partEvent ?? 0) + adj)) : null;
  // accuracy
  const mist = ents.filter(e => e.kind === "mistake" && !e.excused);
  let items_ = 0, comp = 0; const accDays = [];
  for (const d of Object.values(days)) for (const x of d.segs) if (!x.sort && d.day >= (C.rules.accStart || C.rules.startDate)) { const fc = C.runCodes[x.shift.run]; const row = fc && D.feed.find(f => f.day === d.day && f.feed_code === fc); if (row) { items_ += row.items; comp += row.compliant; accDays.push({ day: d.day, code: x.shift.run, ...row, v: row.items ? row.compliant / row.items * 100 : null }); } }
  const feedPct = items_ ? comp / items_ * 100 : null;
  const acc = feedPct == null && !mist.length ? null : Math.max(0, Math.min(100, (feedPct ?? 100) - mist.reduce((t, e) => t + (e.pct_off != null ? +e.pct_off : C.rules.mistakePct), 0)));
  // safety
  const safeE = ents.filter(e => e.safety_pct != null); const safe = safeE.length ? safeE.reduce((a, e) => a + (+e.safety_pct), 0) / safeE.length : 100;
  // efficiency
  const effDays = [];
  const own = (D.effBreakFor || []).includes(driver);   // unpaid breaks come off the time taken for everyone; the owner also from before 9 Nov
  for (const d of Object.values(days)) {
    if (d.day < C.rules.effStart) continue;
    const manual = ents.find(e => e.kind === "eff" && e.day === d.day && e.eff_pct != null);
    if (manual) { effDays.push({ day: d.day, v: +manual.eff_pct, manual: true }); continue; }
    const runs = d.segs.filter(x => !x.sort); if (!runs.length) continue;
    const sortRost = d.segs.filter(x => x.sort).reduce((a, x) => a + x.min, 0);   // sort minutes not already covered by a run
    const sod = d.segs.map(x => D.sods.find(s => s.shift_id === x.shift.id)).find(Boolean);
    const rows = runs.map((x, i) => { const eod = D.eods.find(e => e.shift_id === x.shift.id), ov = D.ovs?.find(o => o.shift_id === x.shift.id); const c = effCalc(x, eod, ov, C, D.runsBy, { sortRost: i === 0 ? sortRost : 0, sodMin: i === 0 && sod ? sodStart(sod, d.start, C) : null, brk: ownerBreakHrs(D.breaks, x.shift, own) }); if (c) { c.shift = x.shift; c.eod = eod; c.ov = ov; } return c; }).filter(Boolean);
    const live = rows.filter(r => !r.trainDay);
    const xm = extraMins(D.extra, driver, d.day);   // "+ Hours" the driver logged (approved): added to the expected time
    if (live.length && live.every(r => r.perf != null && !r.need.length)) { const A = (live.reduce((a, r) => a + r.allowed, 0) + xm) / 60, T = live.reduce((a, r) => a + r.takenTrk, 0); const v = Math.max(0, Math.min(150, C.rules.effMethod === "tdt" ? (2 - T / A) * 100 : A / T * 100)); effDays.push({ day: d.day, v, est: live.some(r => r.est), rows, allowed: A, taken: T, extra: xm }); }
    else if (d.day <= today()) effDays.push({ day: d.day, pending: true, need: rows.filter(r => r.need.length).map(r => `${r.code}: ${r.need.join(", ")}`).join("; "), rows });
  }
  const scored = effDays.filter(e => !e.pending); const eff = scored.length ? scored.reduce((a, e) => a + e.v, 0) / scored.length : null;
  const W = C.weights; let ws = 0, wv = 0; const parts = { admin, eff: eff == null ? null : Math.min(100, eff), acc, safe };
  for (const k of Object.keys(W)) if (parts[k] != null) { ws += W[k]; wv += parts[k] * W[k]; }
  const overall = ws ? wv / ws : null;
  return { driver, from, to, items, closed: closed.length, onTime, events, late: closed.filter(i => i.st === "late").length, missing: closed.filter(i => i.st === "miss").length, admin, adj, acc, feedPct, accItems: items_, accComp: comp, accDays, mistakes: mist, nMist: mist.length, safe, safeSet: safeE.length > 0, eff, effDays, overall, entries: ents, days };
}
export function band(eff) { if (eff == null) return null; return eff >= 100 ? 6 : eff >= 90 ? 5 : eff >= 80 ? 4 : eff >= 70 ? 3 : eff >= 60 ? 2 : eff >= 50 ? 1 : 0; }
// Pay fortnights: first one Mon 2 Nov – Sun 15 Nov 2026, then every 14 days.
export const PAY_START = "2026-11-02";
export function fortnight(iso) { const mon = addDays(iso, -dow(iso)); const n = Math.floor(Math.round((new Date(mon) - new Date(PAY_START)) / 86400000) / 14); const from = addDays(PAY_START, n * 14); return { from, to: addDays(from, 13), thisMon: mon }; }
/** A driver's pay band from their average efficiency over the pay fortnight containing `iso`. */
export function fortnightBand(driver, iso, D, C) { const F = fortnight(iso); const s = scoreFor(driver, F.from, F.to, D, C); return { b: band(s.eff), eff: s.eff, ...F }; }
/** The $/h a band pays, read from the band settings text (e.g. "$26" or "$24 + coaching"); null if not set. */
export function bandRate(b, C) { if (b == null) return null; const m = /\$\s*(\d+(?:\.\d+)?)/.exec(String(C.bands?.[b] ?? "")); return m ? +m[1] : null; }
/** Owner-portal pay line: fortnight band, the rate that band pays, and the driver's current rate. */
export function payBand(drv, iso, D, C) { const fb = fortnightBand(drv.id, iso, D, C); const now = +(drv.rate || C.rules.hourRate); const r = bandRate(fb.b, C); return { ...fb, rate: r, now, diff: r != null ? r - now : null, note: fb.b != null ? String(C.bands?.[fb.b] ?? "").replace(/^\s*\$\s*\d+(?:\.\d+)?\s*/, "").replace(/^\+\s*/, "") : "" }; }
export const money = v => "$" + (Number.isInteger(v) ? v : v.toFixed(2));
