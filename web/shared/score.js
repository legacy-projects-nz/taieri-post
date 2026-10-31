// Scoring engine — the Driver Scorecard rules on the new structured data (sod/eod rows instead of WhatsApp posts)
import { toMin, fmtT, dow, addDays, label, today, nzNow, isSort } from "./core.js";

const DEF = {
  rules: { sodGrace: 15, eodHours: 2, perEvent: 2, mistakePct: 10, adminFloor: 80, stopRatio: 0.8, hourRate: 28, startDate: "2026-10-26", adminStart: "2026-10-28", effStart: "2026-10-28", effMethod: "sheet", tgeSort: 75, vchkDay: 4, vchkTime: "17:00" },
  weights: { admin: 25, eff: 30, acc: 25, safe: 20 },
  sortF: { pBase: 45, pIncl: 80, pRate: 0.35, mailTray: 20, nzcph: 30 },
  addMin: { outram: 10, pgg: 10, airport: 30, milton: 90, balclutha: 90, owaka: 90 },
  news: { runs: ["FLY", "TUA"], min: 45 },
  typical: { TUA: 40, FLY: 55, RAM: 85, LAW: 95, DB: 40, PCB: 55, RSB: 50, WH: 105, S: 110, T: 110 },
  effSimple: {},
  estFig: {},
};
export const NET = c => /^(S|T)$/.test(c) ? "tge" : /^(FB|MFB)/.test(c) ? "fb" : "nzp";
export const PICKUP_RUNS = ["TUA", "FLY", "DB"];
export const LEGS = ["airport", "milton", "balclutha", "owaka"];
export const LEG_RUNS = { TUA: ["outram", "pgg", "airport"], FLY: ["airport", "milton", "balclutha", "owaka"], DB: ["milton", "balclutha", "owaka"], RAM: ["airport"] };

export function cfg(settings) { const o = {}; for (const k of Object.keys(DEF)) o[k] = { ...DEF[k], ...(settings[k] || {}) }; o.runCodes = settings.runCodes || {}; o.holidays = settings.holidays || {}; o.bands = settings.bands || {}; return o; }

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
  for (const [day, list] of Object.entries(by)) {
    const segs = list.map(s => { const { st, en } = segTimes(s, runsBy); return { shift: s, st, en, sort: isSort(s.run) }; }).filter(x => x.st != null).sort((a, b) => a.st - b.st);
    // sort shifts without an end run until the next run starts (max 3 h)
    segs.forEach((x, i) => { if (x.sort && (x.en == null || x.en <= x.st)) { const nx = segs.slice(i + 1).find(y => !y.sort); x.en = nx ? Math.min(nx.st, x.st + 180) : x.st + 90; } });
    const start = Math.min(...segs.map(x => x.st)), end = Math.max(...segs.map(x => x.en ?? x.st));
    out[day] = { day, segs, start, end, hours: Math.round(segs.reduce((a, x) => a + ((x.en ?? x.st) - x.st), 0) / 6) / 10 };
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
    if (it.at != null) { it.late = Math.max(0, it.at - it.due); it.st = it.late > 0 ? "late" : "ok"; }
    else it.st = nowMin > it.closeAt ? "miss" : nowMin > it.due ? "over" : "due";
    it.auto = it.st; const m = mk[it.key]; if (m?.status) { it.st = m.status; it.mark = m; } else if (m) it.mark = m;
    if (it.day < R.adminStart) { it.st = "exc"; it.pre = true; }
    return it;
  };
  for (const d of Object.values(days)) {
    if (d.day < R.startDate) continue;
    const firstSeg = d.segs[0];
    const sod = d.segs.map(x => sodBy[x.shift.id]).find(Boolean);
    items.push(status({ key: `${d.day}|${driver}|day|SOD`, day: d.day, driver, kind: "SOD", shift: firstSeg.shift, code: null, due: d.start + R.sodGrace, closeAt: d.end + R.eodHours * 60, at: sod ? minsAt(sod.sent_at, d.day) : null, row: sod, label: "SOD" }));
    const runs = d.segs.filter(x => !x.sort);
    if (runs.length) for (const x of runs) {
      const e = eodBy[x.shift.id]; const due = (x.en ?? x.st) + R.eodHours * 60;
      items.push(status({ key: `${d.day}|${driver}|${x.shift.run}|EOD`, day: d.day, driver, kind: "EOD", shift: x.shift, code: x.shift.run, due, closeAt: due + 1, at: e ? minsAt(e.sent_at, d.day) : null, row: e, label: `EOD · ${x.shift.run}` }));
    } else {
      const x = d.segs[d.segs.length - 1]; const e = d.segs.map(y => eodBy[y.shift.id]).find(Boolean); const due = d.end + R.eodHours * 60;
      items.push(status({ key: `${d.day}|${driver}|day|EOD`, day: d.day, driver, kind: "EOD", shift: x.shift, code: null, due, closeAt: due + 1, at: e ? minsAt(e.sent_at, d.day) : null, row: e, label: "EOD" }));
    }
  }
  return items;
}
export const STATE_LABEL = { ok: "On time", late: "Late", part: "Incomplete", over: "Overdue", miss: "Missing", exc: "Excused", due: "Due" };
export function itemNote(it) {
  if (it.st === "ok") return `posted ${fmtT(it.at % 1440)}`;
  if (it.st === "late") return `posted ${fmtT(it.at % 1440)}, late by ${late(it.late)}`;
  if (it.st === "miss") return "not posted";
  if (it.st === "over") return `not posted yet · due ${fmtT(it.due % 1440)}`;
  if (it.st === "due") return `by ${fmtT(it.due % 1440)}`;
  if (it.st === "exc") return "excused";
  return "";
}
export const late = m => m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}m`;

/* ---- Evidence: average EOD figures per run and weekday from recent EODs — the estimate used until a run's EOD is in ---- */
let EVID = null; const EV_KEYS = ["parcels", "stops", "trays", "sort_min", "pickups", "pickup_parcels"];
export function setEvidence(shifts, eods, weeks = 8) {
  const byShift = Object.fromEntries(shifts.map(s => [s.id, s])); const since = addDays(today(), -7 * weeks); const acc = {};
  for (const e of eods) { const s = byShift[e.shift_id]; if (!s || s.day < since || isSort(s.run) || !e.finish_time && e.parcels == null) continue; for (const scope of [dow(s.day), "all"]) { const o = (acc[s.run] ??= {})[scope] ??= { n: 0 }; o.n++; for (const k of EV_KEYS) if (e[k] != null) (o[k] ??= []).push(+e[k]); } }
  EVID = {}; for (const [code, scopes] of Object.entries(acc)) { EVID[code] = {}; for (const [scope, o] of Object.entries(scopes)) { const out = { n: o.n }; for (const k of EV_KEYS) if (o[k]?.length) out[k] = Math.round(o[k].reduce((a, b) => a + b, 0) / o[k].length * 10) / 10; EVID[code][scope] = out; } }
  return EVID;
}
export function evidenceFor(code, day) { if (!EVID?.[code]) return null; const d = EVID[code][dow(day)], a = EVID[code].all; return d && d.n >= 2 ? { ...d, scope: "weekday" } : a ? { ...a, scope: "all" } : null; }
export const evidence = () => EVID;

/* ---- Efficiency ---- */
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
  const sortMin = ov?.sort_min ?? eod?.sort_min;
  if (net === "tge") { const sm = sortMin ?? (g.push("sort_min"), ev?.sort_min ?? (C.rules.tgeSort || 75)); add("Sorting", `${sm} min`, sm); }
  else {
    const sp = ov?.sorted_parcels ?? eod?.sorted_parcels, smail = ov?.sorted_mail ?? eod?.sorted_mail;
    if (sp == null && smail == null && ctx.sortRost) add("Sorting (rostered)", `${ctx.sortRost} min`, ctx.sortRost);
    else {
      if (sp) add("Sorting parcels", `${C.sortF.pBase} + (${parcels.v} − ${C.sortF.pIncl}) × ${C.sortF.pRate}`, C.sortF.pBase + Math.max(0, parcels.v - C.sortF.pIncl) * C.sortF.pRate);
      if (smail) add("Sorting mail", `${trays.v} × ${C.sortF.mailTray}`, trays.v * C.sortF.mailTray);
    }
    const np = ov?.nzc_ph ?? eod?.nzc_ph; if (np && PICKUP_RUNS.includes(code)) add("NZC/PH pick-up", `${C.sortF.nzcph} min`, C.sortF.nzcph);
  }
  // add-ons / legs
  if (model.addon != null && !(ov?.legs)) add("Add-ons (estimate)", `${model.addon} min`, model.addon);
  else { const legs = ov?.legs || [...new Set([...(seg.shift.addons || []), ...((eod?.legs) || [])])]; for (const l of legs) if (C.addMin[l]) add(addName(l), `${C.addMin[l]} min`, C.addMin[l]); }
  if (model.news && (ov?.news_min || eod?.newspapers)) add("Newspapers", `${C.news.min} min`, ov?.news_min || C.news.min);
  const allowed = min;
  // taken
  const start = ov?.start_at ? toMin(ov.start_at) : ctx.sodMin ?? seg.st; const endT = ov?.end_at ? toMin(ov.end_at) : (eod?.finish_time ? toMin(eod.finish_time) : (eod ? nzNow(new Date(eod.sent_at)).min : null));
  const taken = (start != null && endT != null && endT > start) ? (endT - start) / 60 : null;
  let takenTrk = taken; if (ov?.train_day) takenTrk = 0; else if (ov?.train_min && taken) takenTrk = Math.max(0.01, taken - ov.train_min / 60);
  const need = []; if (!eod) need.push("EOD"); else { for (const k of ["parcels", "stops"]) if ((model[k === "parcels" ? "parcel" : "stop"] || 0) > 0 && eod[k] == null && ov?.[k] == null) need.push(k === "parcels" ? (net === "tge" ? "Delivery total" : "Total parcels") : (net === "tge" ? "Jobs" : "Stops")); if (net === "tge" && sortMin == null) need.push("Sorting time"); if (!eod.finish_time) need.push("Finish time"); }
  let perf = null; if (taken && takenTrk !== 0) perf = C.rules.effMethod === "tdt" ? (2 - takenTrk / (allowed / 60)) * 100 : (allowed / 60) / takenTrk * 100; if (perf != null) perf = Math.max(0, Math.min(150, perf));
  return { code, net, allowed, parts, taken, takenTrk, perf, need, est: g.length > 0, guess: g, trainDay: !!ov?.train_day, start, end: endT, model, evid: ev ? ev.scope : null, evN: ev?.n || 0, noEod: !eod, figs: { parcels, stops, trays, pickups, pup } };
}
export function addName(k) { return ({ outram: "Outram Depot", pgg: "PGG", airport: "Airport", milton: "Milton", balclutha: "Balclutha", owaka: "Owaka", rose: "Roseneath receiver", sb: "Sawyers Bay receiver", fish: "Harbour Fish pick-up", pc: "Port Chalmers receiver", digi: "Digi Art pick-up", fonterra: "Fonterra pick-up", waihola: "Waihola Store" })[k] || k; }

/* ---- Scores for one driver over a date range ---- */
export function scoreFor(driver, from, to, D, C) {
  // D: {shifts, sods, eods, marks, entries, feed, runsBy, nowRef}
  const days = dayShifts(D.shifts.filter(s => s.day >= from && s.day <= to), D.runsBy, driver);
  const items = itemsFor(driver, days, D.sods, D.eods, D.marks, C, D.nowRef);
  const closed = items.filter(i => !["due", "over", "exc"].includes(i.st));
  const onTime = closed.filter(i => i.st === "ok" || i.st === "part").length;
  const events = closed.filter(i => i.st === "late" || i.st === "miss").length;
  const ents = D.entries.filter(e => e.driver === driver && e.day >= from && e.day <= to);
  const adj = ents.filter(e => e.admin_pts).reduce((a, e) => a + (+e.admin_pts), 0);
  const admin = closed.length || adj ? Math.max(C.rules.adminFloor, Math.min(100, 100 - events * C.rules.perEvent + adj)) : null;
  // accuracy
  const mist = ents.filter(e => e.kind === "mistake" && !e.excused);
  let items_ = 0, comp = 0; const accDays = [];
  for (const d of Object.values(days)) for (const x of d.segs) if (!x.sort) { const fc = C.runCodes[x.shift.run]; const row = fc && D.feed.find(f => f.day === d.day && f.feed_code === fc); if (row) { items_ += row.items; comp += row.compliant; accDays.push({ day: d.day, code: x.shift.run, ...row, v: row.items ? row.compliant / row.items * 100 : null }); } }
  const feedPct = items_ ? comp / items_ * 100 : null;
  const acc = feedPct == null && !mist.length ? null : Math.max(0, Math.min(100, (feedPct ?? 100) - mist.length * C.rules.mistakePct));
  // safety
  const safeE = ents.filter(e => e.safety_pct != null); const safe = safeE.length ? safeE.reduce((a, e) => a + (+e.safety_pct), 0) / safeE.length : 100;
  // efficiency
  const effDays = [];
  for (const d of Object.values(days)) {
    if (d.day < C.rules.effStart) continue;
    const manual = ents.find(e => e.kind === "eff" && e.day === d.day && e.eff_pct != null);
    if (manual) { effDays.push({ day: d.day, v: +manual.eff_pct, manual: true }); continue; }
    const runs = d.segs.filter(x => !x.sort); if (!runs.length) continue;
    const sortRost = d.segs.filter(x => x.sort).reduce((a, x) => a + ((x.en ?? x.st) - x.st), 0);
    const sod = d.segs.map(x => D.sods.find(s => s.shift_id === x.shift.id)).find(Boolean);
    const rows = runs.map((x, i) => { const eod = D.eods.find(e => e.shift_id === x.shift.id), ov = D.ovs?.find(o => o.shift_id === x.shift.id); const c = effCalc(x, eod, ov, C, D.runsBy, { sortRost: i === 0 ? sortRost : 0, sodMin: i === 0 && sod ? nzNow(new Date(sod.sent_at)).min : null }); if (c) { c.shift = x.shift; c.eod = eod; c.ov = ov; } return c; }).filter(Boolean);
    const live = rows.filter(r => !r.trainDay);
    if (live.length && live.every(r => r.perf != null && !r.need.length)) { const A = live.reduce((a, r) => a + r.allowed, 0) / 60, T = live.reduce((a, r) => a + r.takenTrk, 0); const v = Math.max(0, Math.min(150, C.rules.effMethod === "tdt" ? (2 - T / A) * 100 : A / T * 100)); effDays.push({ day: d.day, v, est: live.some(r => r.est), rows, allowed: A, taken: T }); }
    else if (d.day <= today()) effDays.push({ day: d.day, pending: true, need: rows.filter(r => r.need.length).map(r => `${r.code}: ${r.need.join(", ")}`).join("; "), rows });
  }
  const scored = effDays.filter(e => !e.pending); const eff = scored.length ? scored.reduce((a, e) => a + e.v, 0) / scored.length : null;
  const W = C.weights; let ws = 0, wv = 0; const parts = { admin, eff: eff == null ? null : Math.min(100, eff), acc, safe };
  for (const k of Object.keys(W)) if (parts[k] != null) { ws += W[k]; wv += parts[k] * W[k]; }
  const overall = ws ? wv / ws : null;
  return { driver, from, to, items, closed: closed.length, onTime, events, late: closed.filter(i => i.st === "late").length, missing: closed.filter(i => i.st === "miss").length, admin, adj, acc, feedPct, accItems: items_, accComp: comp, accDays, mistakes: mist, nMist: mist.length, safe, safeSet: safeE.length > 0, eff, effDays, overall, entries: ents, days };
}
export function band(eff) { if (eff == null) return null; return eff >= 100 ? 6 : eff >= 90 ? 5 : eff >= 80 ? 4 : eff >= 70 ? 3 : eff >= 60 ? 2 : eff >= 50 ? 1 : 0; }
export function fortnight(iso) { const d = dow(iso); const mon = addDays(iso, -d); return { from: addDays(mon, -7), to: addDays(mon, 6), thisMon: mon }; }
