// Day budget (owner only, on the Live board when one day is picked): income − staff costs, run by run.
//   Income – each run's base (a day, week or month figure, shared between the runs in its group whichever of them are on)
//            For the runs with a total (PCB+RSB, TUA+Flyer, Lawrence, TGE, food bag) the base is half the total and the other half is
//            parcels × a rate worked out from the 8-week average parcels (see groupRate). Parcels come from the EOD, the average until it's in.
//            Plus Rural / Lawrence / Owaka / Balclutha pick-ups (NZ Couriers + Post Haste) and the TGE South total typed in. GST 15% on top.
//   Staff  – each driver's cost for the day (the same hours × rate as Labour), split across their runs by rostered minutes.
//            Jeremy's hours are unpaid, so his runs show $0 staff cost.
//   Costs  – business running costs (fuel, RUC, insurance, ACC, loan, software…) as a monthly figure each, defaulted to the Xero Aug–Oct 2026
//            average (excl GST), spread over the 6 working days a week and charged on any day a run is rostered. Always an estimate (grey).
//   Anything not in yet is estimated from the past 8 weeks (same weekday where there's enough) and shown grey; real figures show green.
//   Tap a run (or a total) for the full detail. The "month at this pace" tile adds up the whole week and scales it to a month.
import { sb, q, esc, $, $$, toast, fmtT, today, addDays, dow, monOf, label } from "/shared/core.js";
import { evidenceFor, evidence } from "/shared/score.js";
import { S, nm, render, sheet } from "/admin/admin.js";
import { driverDay } from "/admin/live.js";

const GST = 0.15;
const WK_PER_MONTH = 52 / 12;
// D>B is paid $6 a parcel on every parcel it carries, TGE ones included, so the TGE South total never lands on DB (it would count them twice)
const AREA_RUNS = { Rural: ["TUA"], South: ["TUA"], Lawrence: ["LAW"], Owaka: ["DB", "FLY"], Balclutha: ["DB"] };   // which run a pick-up area's income lands on
const money = n => (n < 0 ? "−$" : "$") + Math.abs(n).toFixed(2);
const money0 = n => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString();
// shared bases: per = "day" | "week" | "month"; days = working days a week it's spread over
const GROUPS = {
  "PCB + RSB": { runs: ["PCB", "RSB", "WH"], per: "month", amt: 17000, days: 6 },
  "TUA + Flyer": { runs: ["TUA", "FLY"], per: "month", amt: 17000, days: 5 },   // about $17,000 a month between them, split roughly evenly → ~$785/day combined
  "Lawrence": { runs: ["LAW"], per: "month", amt: 4500, days: 5 },
  "TGE": { runs: ["S", "T"], per: "week", amt: 4500, days: 5, split: { T: 55, S: 45 } },   // about $4,500 a week all in, a bit more of it on T
  "Food bag": { runs: ["FB", "FBP", "FB2", "FB2P", "MFB1", "MFB2"], per: "month", amt: 2000, days: 1, alt: true },   // alt: only one of these goes out on a food bag day
};
// Each total above is split: basePct % is a fixed base, the rest is paid by the parcel. The per-parcel rate is that parcel share of the total
// divided by the parcels the group's runs normally carry in the same period (8-week EOD average per run-day × days a week), so an average
// period comes back to the total; days with more or fewer parcels than average earn more or less.
const BASE_PCT = 50;
const RUN_DAYS = { FLY: 4 };   // days a week a run goes out, where it's fewer than its group's (Flyer: Mon, Tue, Wed, Fri)
// business costs, $ a month excl GST — Xero Aug–Oct 2026 average (the Biz CashFlow sheet assumes less: fuel $1,739, RUC $479, insurance $617)
const COSTS = [["fuel", "Fuel", 4251.46], ["ruc", "Road user charges", 590.78], ["veh", "Vehicle costs & repairs", 336.22], ["sub", "Subcontractors", 573.91], ["ins", "Insurance", 1569.09], ["acc", "ACC levy", 714.93],
  ["loan", "Loan fees & interest", 1078.66], ["soft", "Software", 897.35], ["staffx", "Staff training, uniforms, meetings", 1660.74], ["acct", "Accountancy", 496.57], ["office", "Office, phone, rent, marketing, bank", 597.8]];
const COST_DAYS = 6;   // working days a week the monthly costs are spread over
const PARCEL_RUNS = ["TUA", "FLY", "DB", "RAM", "PCB", "RSB", "LAW", "S", "T"];
const DEF = { small: 5, large: 8, target: 70000, oncost: 11, parcel: { TUA: 0, FLY: 0, DB: 6, RAM: 1.8, PCB: 0, RSB: 0, LAW: 0, S: 0, T: 0 }, groups: Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, { per: g.per, amt: g.amt, days: g.days, basePct: BASE_PCT }])), costs: Object.fromEntries(COSTS.map(([k, , a]) => [k, a])) };
const model = () => { const v = S.set?.money_model || {}; return { ...DEF, ...v, parcel: { ...DEF.parcel, ...(v.parcel || {}) }, groups: Object.fromEntries(Object.keys(GROUPS).map(k => [k, { ...DEF.groups[k], ...(v.groups?.[k] || {}) }])), costs: { ...DEF.costs, ...(v.costs || {}) } }; };
const onc = () => 1 + (+model().oncost || 0) / 100;   // holiday pay 8% + KiwiSaver 3% on top of gross wages
const costMonth = () => Object.values(model().costs).reduce((a, b) => a + (+b || 0), 0);
const costDay = rows => rows.some(r => !r.noRun) ? costMonth() / WK_PER_MONTH / COST_DAYS : 0;   // charged on any day a run is rostered
const perDay = g => !g.amt ? 0 : g.per === "month" ? g.amt / WK_PER_MONTH / (g.days || 5) : g.per === "week" ? g.amt / (g.days || 5) : g.amt;
const perTxt = g => g.per === "month" ? `$${(+g.amt).toLocaleString()}/month ÷ ${(+(WK_PER_MONTH)).toFixed(2)} wk ÷ ${g.days} days` : g.per === "week" ? `$${(+g.amt).toLocaleString()}/week ÷ ${g.days} days` : `$${(+g.amt).toLocaleString()}/day`;
// a group's per-parcel rate from its total: (total × parcel share) ÷ average parcels in the same period
const periodWeeks = m => m.per === "month" ? WK_PER_MONTH : m.per === "week" ? 1 : 1 / (m.days || 5);
function groupRate(g, m) {
  const G = GROUPS[g]; const pct = Math.min(100, Math.max(0, m.basePct ?? BASE_PCT)); if (!m.amt || pct >= 100) return null;
  const E = evidence() || {}; const per = G.runs.map(c => ({ c, a: E[c]?.all?.parcels, n: E[c]?.all?.n || 0 })).filter(x => x.a != null);
  if (!per.length) return { rate: 0, none: true };
  let wk, how;
  if (G.alt) { const n = per.reduce((a, x) => a + x.n, 0); const avg = per.reduce((a, x) => a + x.a * x.n, 0) / n; wk = avg * (m.days || 1); how = `${avg.toFixed(1)} parcels a day × ${m.days} day${m.days > 1 ? "s" : ""}`; }
  else { wk = per.reduce((a, x) => a + x.a * Math.min(RUN_DAYS[x.c] ?? m.days ?? 5, m.days ?? 5), 0); how = per.map(x => `${x.c} ${x.a.toFixed(1)} × ${Math.min(RUN_DAYS[x.c] ?? m.days ?? 5, m.days ?? 5)}d`).join(" + ") + " a week"; }
  const parcels = wk * periodWeeks(m); const share = m.amt * (100 - pct) / 100; if (!parcels) return { rate: 0, none: true };
  return { rate: share / parcels, parcels, share, how: `$${Math.round(share).toLocaleString()} (${100 - pct}% of $${(+m.amt).toLocaleString()}/${m.per}) ÷ ${Math.round(parcels).toLocaleString()} parcels a ${m.per} (${how}, 8-week average)` };
}
const groupOf = code => Object.keys(GROUPS).find(g => GROUPS[g].runs.includes(code));
// the per-parcel rate for a run: a figure typed in the editor wins, otherwise the one worked out from its group's total
function rateFor(code, M) { const typed = +(M.parcel[code] || 0); if (typed) return { rate: typed, how: "typed in" };
  const g = groupOf(code); if (!g) return { rate: 0 }; const R = groupRate(g, M.groups[g]); return R && R.rate ? { rate: R.rate, how: R.how } : { rate: 0 }; }
// parcels delivered on a run: the fixed figure if one was set on the EOD, otherwise what the driver posted; null = EOD not in yet
const parcelsOf = shift => { if (!shift) return null; const ov = S.ovs.find(o => o.shift_id === shift.id); if (ov?.parcels != null) return +ov.parcels; const e = S.eodBy?.[shift.id]; return e?.parcels != null ? +e.parcels : null; };
const tgeSouth = d => +(S.set?.tge_south?.[d] || 0);

// NZ public holidays (observed dates) for a year, with Otago Anniversary for Dunedin. Matariki is set by law year by year.
const MATARIKI = { 2025: "06-20", 2026: "07-10", 2027: "06-25", 2028: "07-14", 2029: "07-06", 2030: "06-21", 2031: "07-11", 2032: "07-02", 2033: "06-24", 2034: "07-07", 2035: "06-29" };
const holCache = {};
function nzHolidays(y) {
  if (holCache[y]) return holCache[y];
  const iso = (m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; const wd = (m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 6 Sat
  const H = new Set(); const pair = (m, d) => { const w = wd(m, d); const x = w === 5 ? [d, d + 3] : w === 6 ? [d + 2, d + 3] : w === 0 ? [d + 1, d + 2] : [d, d + 1]; x.forEach(v => H.add(iso(m, v))); };   // two-day pairs: Christmas/Boxing, 1–2 January
  const mon = (m, d) => { const w = wd(m, d); H.add(iso(m, w === 6 ? d + 2 : w === 0 ? d + 1 : d)); };   // Mondayised: Waitangi, ANZAC
  const nthMon = (m, n) => { let d = 1; while (wd(m, d) !== 1) d++; return d + 7 * (n - 1); };
  pair(1, 1); pair(12, 25); mon(2, 6); mon(4, 25); H.add(iso(6, nthMon(6, 1))); H.add(iso(10, nthMon(10, 4)));
  // Easter (anonymous Gregorian algorithm) → Good Friday, Easter Monday
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), em = Math.floor((h + l - 7 * m + 114) / 31), ed = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(y, em - 1, ed)); const off = n => new Date(easter.getTime() + n * 86400000).toISOString().slice(0, 10); H.add(off(-2)); const eMon = off(1); H.add(eMon);
  // Otago Anniversary: the Monday nearest 23 March (Tuesday after if that's Easter Monday)
  { const w = wd(3, 23); let d = 23 + (w === 1 ? 0 : w <= 4 ? 1 - w : 8 - w); let o = iso(3, d); if (o === eMon) o = off(2); H.add(o); }
  if (MATARIKI[y]) H.add(`${y}-${MATARIKI[y]}`);
  return (holCache[y] = H);
}
const isHoliday = d => nzHolidays(+d.slice(0, 4)).has(d);
// the next 12 months from the week shown, day by day: each day takes that weekday's figures from the week on screen
// (so weekdays, Saturdays and Sunday food bag each count the right number of times). Public holidays: no income, staff still paid.
function yearAhead(wk, week) {
  let fees = 0, staff = 0, est = false; const n = { wd: 0, sat: 0, sun: 0, hol: 0 };
  for (let i = 0; i < 365; i++) { const d = addDays(wk, i); const w = dow(d); const t = week[w]; const hol = isHoliday(d);
    if (hol) n.hol++; else if (w < 5) n.wd++; else if (w === 5) n.sat++; else n.sun++;
    if (!hol) fees += t.fees; staff += t.staff; est = est || t.fe || t.se; }
  const costs = costMonth() * 12;
  return { fees, staff, costs, left: fees - staff - costs, est, n };
}
const yearLine = (v, how) => `<div class="s mn-est" style="font-size:11px;margin-top:2px" title="${esc(how)}">≈${money0(v)} a year</div>`;

const cache = {};   // day → pick-up rows for that day + the 8 weeks before it (for estimates)
async function loadDay(d) {
  if (cache[d]) return; cache[d] = { loading: true, rows: [], hist: [] };
  try { const all = await q(sb.from("pickups").select("*").gte("day", addDays(d, -56)).lte("day", d)); cache[d] = { rows: all.filter(r => r.day === d), hist: all.filter(r => r.day < d) }; } catch (e) { cache[d] = { rows: [], hist: [], err: e.message }; }
  render(true);
}
// average of per-day values, same weekday first (needs 2+ days), otherwise every day
function avgDays(byDay, d) { const all = Object.entries(byDay); const wd = all.filter(([k]) => dow(k) === dow(d)); const use = wd.length >= 2 ? wd : all; return use.length ? use.reduce((a, [, v]) => a + v, 0) / use.length : null; }

function breakdown(d) {
  const M = model(); const rows = []; const byRun = {};
  for (const drv of S.drivers) {
    const r = driverDay(drv, d);
    if (r?.sick && !r.D) { if (r.spend && !drv.pay_exclude) rows.push({ run: `Sick pay · ${nm(drv.id)}`, driver: drv.id, staff: r.spend * onc(), staffHow: `${r.exp.toFixed(2)} h × $${(+r.rate).toFixed(2)}/h = ${money(r.spend)} + ${model().oncost}% holiday pay & KiwiSaver = ${money(r.spend * onc())} · ${r.actHow}`, unpaid: false, est: false, fees: 0, feeEst: false, feeLines: [], noRun: true }); continue; }   // off sick and no longer on the roster: the sick pay still counts
    if (!r || r.holiday || !r.D) continue;
    const segs = r.D.segs; const mins = segs.map(x => Math.max(0, (x.en ?? x.st) - x.st)); const tot = mins.reduce((a, b) => a + b, 0);
    const cost = drv.pay_exclude ? 0 : r.spend;
    segs.forEach((x, i) => { const share = tot ? mins[i] / tot : 1 / segs.length;
      const row = { run: x.shift.run, shift: x.shift, sort: !!x.sort, driver: drv.id, st: x.st, en: x.en, staff: cost * onc() * share, staffHow: drv.pay_exclude ? "unpaid (owner)" : `${(r.actEst ?? r.exp).toFixed(2)} h × $${(+r.rate).toFixed(2)}/h = ${money(r.spend)} + ${model().oncost}% holiday pay & KiwiSaver = ${money(r.spend * onc())}${segs.length > 1 ? ` · ${Math.round(share * 100)}% of the day (rostered time)` : ""} · ${r.actHow}`, unpaid: !!drv.pay_exclude, est: !drv.pay_exclude && r.actIsEst, fees: 0, feeEst: false, feeLines: [] };
      rows.push(row); if (!x.sort) (byRun[row.run] ??= row); });
  }
  // a run's figures are final once its EOD is in (or the day has gone), otherwise estimated
  const past = d < today(); const done = r => past || !!S.eodBy?.[r.shift?.id];
  const add = (r, amt, line, est) => { r.fees += amt; if (est) r.feeEst = true; r.feeLines.push({ amt, line, est }); };
  for (const r of rows) { if (r.sort) continue;
    for (const [g, G] of Object.entries(GROUPS)) { if (!G.runs.includes(r.run)) continue; const m = M.groups[g]; const pct = groupRate(g, m)?.none ? 100 : Math.min(100, Math.max(0, m.basePct ?? BASE_PCT)); const day = perDay(m) * pct / 100; if (!day) continue;
      const onRows = rows.filter(y => !y.sort && G.runs.includes(y.run)); const on = onRows.length; const sp = G.split; const wsum = sp ? onRows.reduce((a, y) => a + (sp[y.run] ?? 0), 0) : 0; const share = sp && wsum ? (sp[r.run] ?? 0) / wsum : 1 / on;
      add(r, day * share, `${g} base · ${pct}% of ${perTxt(m)}${on > 1 ? (sp && wsum ? ` · ${Math.round(share * 100)}% to ${r.run}` : ` ÷ ${on} runs on`) : ""}`, !done(r)); }
    const RT = rateFor(r.run, M); const rate = RT.rate; if (rate) { const n = parcelsOf(r.shift); const rt = `$${rate.toFixed(2)}`; const why = RT.how && RT.how !== "typed in" ? ` · rate = ${RT.how}` : "";
      const incl = r.run === "DB" ? " (NZ Post + TGE)" : ""; if (n != null) add(r, n * rate, `${n} parcels${incl} × ${rt}${why}`, false);
      else { const ev = evidenceFor(r.run, d); if (ev?.parcels != null) add(r, Math.round(ev.parcels) * rate, `${Math.round(ev.parcels)} parcels${incl} × ${rt} (average ${ev.scope === "weekday" ? "for this weekday" : "of recent days"} until the EOD is in)${why}`, true); else { r.feeEst = true; r.feeLines.push({ amt: 0, line: `parcels × ${rt} · no history yet`, est: true }); } } } }
  const feeRow = (area) => { for (const code of AREA_RUNS[area] || []) if (byRun[code]) return byRun[code];
    const k = "__" + area; if (!byRun[k]) { byRun[k] = { run: `${area} pick-ups`, driver: null, staff: 0, fees: 0, feeEst: false, feeLines: [], noRun: true }; rows.push(byRun[k]); } return byRun[k]; };
  const runOn = area => (AREA_RUNS[area] || []).map(c => byRun[c]).find(Boolean);
  // pick-ups: NZC + Post Haste. Logged → final; none logged yet on a run that's on → estimate.
  const pu = {}; for (const p of cache[d]?.rows || []) { if (p.customer === "TGE") continue; const a = (pu[p.area] ??= { small: 0, large: 0, min: 0 }); a.small += p.small || 0; a.large += p.large || 0; a.min += +p.min_fee || 0; }
  for (const [area, a] of Object.entries(pu)) { const fee = a.small * M.small + a.large * M.large + a.min; if (fee) add(feeRow(area), fee, `${area} pick-ups: ${a.small} small × $${M.small}${a.large ? ` + ${a.large} large × $${M.large}` : ""}${a.min ? ` + split fee $${a.min.toFixed(2)}` : ""}`, false); }
  if (cache[d] && !cache[d].loading) for (const area of ["Rural", "Lawrence", "Owaka"]) { if (pu[area]) continue; const r = runOn(area); if (!r || done(r)) continue;
    const by = {}; for (const p of cache[d].hist) { if (p.customer === "TGE" || p.area !== area) continue; by[p.day] = (by[p.day] || 0) + p.small * M.small + p.large * M.large + (+p.min_fee || 0); }
    const e = avgDays(by, d); if (e) add(r, e, `${area} pick-ups (average of recent days)`, true); }
  // TGE South: typed-in total → final; otherwise the average of past totals while the South run is on
  const tge = tgeSouth(d); if (tge) add(feeRow("South"), tge, `TGE South total (typed in)`, false);
  else { const r = runOn("South"); const hist = Object.fromEntries(Object.entries(S.set?.tge_south || {}).filter(([k, v]) => k < d && k >= addDays(d, -56) && +v).map(([k, v]) => [k, +v]));
    const e = r ? avgDays(hist, d) : null; if (e) add(r, e, "TGE South (average of past totals)", true); }
  rows.sort((a, b) => (a.noRun ? 1 : 0) - (b.noRun ? 1 : 0) || (a.sort ? 1 : 0) - (b.sort ? 1 : 0) || (a.st ?? 0) - (b.st ?? 0));
  return rows;
}
const totals = rows => rows.reduce((a, r) => ({ fees: a.fees + r.fees, staff: a.staff + r.staff, fe: a.fe || (r.feeEst && r.fees > 0), se: a.se || (r.est && r.staff > 0) }), { fees: 0, staff: 0, fe: false, se: false });

const cls = est => est ? "mn-est" : "mn-fin";                         // grey = estimate, green = final
const amt = (v, est) => `<span class="${cls(est)}">${est ? "≈" : ""}${money(v)}</span>`;
const STYLE = `<style>.mn-est{color:var(--ink3)}.mn-fin{color:var(--ok)}tr.mn-row{cursor:pointer}tr.mn-row:hover td{background:var(--soft)}button.tile.mn-t{cursor:pointer;text-align:left;border:0;color:inherit}</style>`;

let cur = { d: null, rows: [] };
export function moneyCard(d) {
  if (!S.me?.isOwner) return "";
  const wk = monOf(d); for (let i = 0; i < 7; i++) if (!cache[addDays(wk, i)]) loadDay(addDays(wk, i));
  const M = model(); const rows = breakdown(d); const T = totals(rows); cur = { d, rows };
  const C = costDay(rows); const wkRows = Array.from({ length: 7 }, (_, i) => breakdown(addDays(wk, i))); const week = wkRows.map(totals); const wkFees = week.reduce((a, t) => a + t.fees, 0), wkStaff = week.reduce((a, t) => a + t.staff, 0), wkCost = wkRows.reduce((a, r) => a + costDay(r), 0); const wkEst = week.some(t => t.fe || t.se);
  const Y = yearAhead(wk, week); const month = Y.fees / 12; const monthProfit = Y.left / 12;
  const yHow = `Next 12 months from ${label(wk)}: ${Y.n.wd} weekdays, ${Y.n.sat} Saturdays, ${Y.n.sun} Sundays (food bag), ${Y.n.hol} public holidays (no income, staff still paid). Staff include the ${M.oncost}% holiday pay & KiwiSaver. Each day uses that weekday's figures from the week of ${label(wk)}.`;
  const tr = (r, i) => { const net = r.fees - r.staff; const fe = r.feeEst && r.fees > 0, se = r.est && r.staff > 0;
    return `<tr class="mn-row" data-mnrow="${i}" title="Tap for the detail"><td><b>${esc(r.run)}</b>${r.st != null ? `<div class="meta">${fmtT(r.st)}–${fmtT(r.en)}</div>` : ""}</td><td>${r.driver ? esc(nm(r.driver)) : `<span class="meta">not rostered</span>`}</td>
      <td align="right">${r.fees ? amt(r.fees, fe) : `<span class="meta">—</span>`}</td><td align="right">${r.fees ? amt(r.fees * (1 + GST), fe) : ""}</td>
      <td align="right">${r.unpaid ? `<span class="meta">unpaid</span>` : amt(r.staff, se)}</td><td align="right"><b>${amt(net, fe || se)}</b></td></tr>`; };
  return `${STYLE}<div class="card"><h2>Day budget<span>${label(d)} · income − staff − costs · <span class="mn-est">≈ grey = estimate</span> · <span class="mn-fin">green = final</span> · tap for detail</span></h2>
    <div class="tiles"><button class="tile mn-t" data-mnall="1"><div class="l">Income</div><div class="v ${cls(T.fe)}">${T.fe ? "≈" : ""}${money(T.fees)}</div><div class="s">+ GST ${money(T.fees * GST)} = ${money(T.fees * (1 + GST))}</div>${yearLine(Y.fees, yHow)}</button>
      <button class="tile mn-t" data-mnall="1"><div class="l">Staff costs</div><div class="v ${cls(T.se)}">${T.se ? "≈" : ""}${money(T.staff)}</div><div class="s">hours × each driver's rate + ${M.oncost}% holiday pay & KiwiSaver</div>${yearLine(Y.staff, yHow)}</button>
      <button class="tile mn-t" data-mnall="1"><div class="l">Business costs</div><div class="v mn-est">≈${money(C)}</div><div class="s">${money0(costMonth())}/month ÷ ${COST_DAYS} days · Xero + cashflow</div>${yearLine(Y.costs, `${money0(costMonth())}/month × 12`)}</button>
      <button class="tile mn-t" data-mnall="1"><div class="l">Left after costs</div><div class="v ${cls(T.fe || T.se || C > 0)}">${T.fe || T.se || C > 0 ? "≈" : ""}${money(T.fees - T.staff - C)}</div><div class="s">income − staff − costs, before GST</div>${yearLine(Y.left, yHow)}</button>
      <button class="tile mn-t" data-mnweek="${wk}"><div class="l">Month at this pace</div><div class="v ${cls(wkEst)}">${wkEst ? "≈" : ""}${money0(month)}</div><div class="s">week of ${label(wk)}: ${money0(wkFees)} in · ${money0(wkStaff)} staff · ${money0(wkCost)} costs · ≈${money0(monthProfit)}/month left · target ${money0(M.target)}/month (${month >= M.target ? "+" : "−"}${money0(Math.abs(month - M.target))}) · month = year ÷ 12</div>${yearLine(Y.fees, yHow)}</button></div>
    ${rows.length ? `<div class="scroll"><table class="dt"><tr><th>Run</th><th>Driver</th><th align="right">Income</th><th align="right">Incl GST</th><th align="right">Staff</th><th align="right">Income − staff</th></tr>${rows.map(tr).join("")}
      <tr class="mn-row" data-mnall="1"><td colspan="2"><b>Total</b></td><td align="right"><b>${amt(T.fees, T.fe)}</b></td><td align="right"><b>${amt(T.fees * (1 + GST), T.fe)}</b></td><td align="right"><b>${amt(T.staff, T.se)}</b></td><td align="right"><b>${amt(T.fees - T.staff, T.fe || T.se)}</b></td></tr>
      <tr class="mn-row" data-mnall="1"><td colspan="5">Business costs <span class="meta">(estimate)</span></td><td align="right">${amt(-C, true)}</td></tr>
      <tr class="mn-row" data-mnall="1"><td colspan="5"><b>Left after costs</b></td><td align="right"><b>${amt(T.fees - T.staff - C, T.fe || T.se || C > 0)}</b></td></tr></table></div>` : `<p class="meta">Nobody rostered and no pick-ups on this day.</p>`}
    <form class="row" id="mn-f" style="margin-top:8px;align-items:flex-end"><label class="f" style="flex:1 1 160px">TGE total · South (excl GST)<input class="in" id="mn-tge" inputmode="decimal" value="${tgeSouth(d) || ""}" placeholder="0.00"></label>
      <button class="btn sm" type="submit" style="flex:0 0 auto">Save</button>
      <details class="full" style="flex:1 1 100%"><summary>Income rates (excl GST)</summary>
        <h4 style="margin:8px 0 4px">Run bases</h4><div class="scroll"><table class="dt"><tr><th>Base</th><th>Runs</th><th>Amount $</th><th>Per</th><th>Days a week</th><th>Base %</th><th align="right">Base a day</th><th align="right">Per parcel</th></tr>${Object.entries(GROUPS).map(([k, G]) => { const m = M.groups[k]; return `<tr><td><b>${esc(k)}</b></td><td class="meta">${G.runs.join(", ")}</td><td><input class="in" data-mg="${esc(k)}" data-mk="amt" inputmode="decimal" value="${m.amt}" style="width:96px"></td><td><select class="in" data-mg="${esc(k)}" data-mk="per">${["day", "week", "month"].map(p => `<option ${p === m.per ? "selected" : ""}>${p}</option>`).join("")}</select></td><td><input class="in" data-mg="${esc(k)}" data-mk="days" inputmode="numeric" value="${m.days}" style="width:56px"></td><td><input class="in" data-mg="${esc(k)}" data-mk="basePct" inputmode="numeric" value="${m.basePct ?? BASE_PCT}" style="width:56px"></td>${(() => { const R = groupRate(k, m); const pct = R?.none ? 100 : (m.basePct ?? BASE_PCT); return `<td align="right">${money(perDay(m) * pct / 100)}</td><td align="right" title="${esc(R?.how || "")}">${R?.rate ? "$" + R.rate.toFixed(2) : R?.none ? `<span class="meta">no parcel history · all base</span>` : "—"}</td>`; })()}</tr>`; }).join("")}</table></div>
        <h4 style="margin:8px 0 4px">Per parcel, on top of the base (parcels from the EOD) <span class="meta">· leave blank to use the rate worked out from the total</span></h4><div class="row" style="align-items:flex-end">${PARCEL_RUNS.map(k => { const g = groupOf(k); const R = g ? groupRate(g, M.groups[g]) : null; return `<label class="f" style="flex:1 1 90px">${k} $<input class="in" data-mp="${k}" inputmode="decimal" value="${+M.parcel[k] ? M.parcel[k] : ""}" placeholder="${R?.rate ? "auto " + R.rate.toFixed(2) : "0"}"></label>`; }).join("")}</div>
        <h4 style="margin:8px 0 4px">Business costs, $ a month excl GST <span class="meta">(Xero Aug–Oct average · ${money0(costMonth())} a month)</span></h4><div class="row" style="align-items:flex-end">${COSTS.map(([k, l]) => `<label class="f" style="flex:1 1 150px">${esc(l)}<input class="in" data-mc="${k}" inputmode="decimal" value="${M.costs[k] ?? 0}"></label>`).join("")}</div>
        <h4 style="margin:8px 0 4px">Pick-ups and target</h4><div class="row" style="align-items:flex-end"><label class="f" style="flex:1 1 110px">Pick-up small $<input class="in" id="mn-s" inputmode="decimal" value="${M.small}"></label><label class="f" style="flex:1 1 110px">Pick-up large $<input class="in" id="mn-l" inputmode="decimal" value="${M.large}"></label><label class="f" style="flex:1 1 140px">Monthly income target $<input class="in" id="mn-tg" inputmode="decimal" value="${M.target}"></label>
        <button class="btn sm" type="submit" style="flex:0 0 auto">Save rates</button></div></details></form>
    <p class="hint">Each total is split: the base % is paid as a fixed base (shared when both runs in a pair are on), the rest by the parcel at a rate worked out from the 8-week average parcels, so an average month comes back to the total. Until the EOD is in, parcels are the 8-week average for that run, and pick-ups, the TGE South total and staff hours are estimates too; business costs are always an estimate — grey until the real figures land, then green.</p></div>`;
}

function rowDetail(r, d) {
  const net = r.fees - r.staff; const fe = r.feeEst && r.fees > 0, se = r.est && r.staff > 0;
  sheet(`${STYLE}<h3>${esc(r.run)}${r.driver ? ` · ${esc(nm(r.driver))}` : ""}</h3><p class="meta">${label(d, true)}${r.st != null ? ` · ${fmtT(r.st)}–${fmtT(r.en)}` : ""}</p>
    <h4 style="margin:8px 0 4px">Income</h4>${r.feeLines.length ? `<table class="dt" style="width:100%">${r.feeLines.map(l => `<tr><td>${esc(l.line)}</td><td align="right">${amt(l.amt, l.est)}</td></tr>`).join("")}
      <tr><td><b>Income (excl GST)</b></td><td align="right"><b>${amt(r.fees, fe)}</b></td></tr><tr><td class="meta">GST 15%</td><td align="right">${amt(r.fees * GST, fe)}</td></tr><tr><td class="meta">Incl GST</td><td align="right">${amt(r.fees * (1 + GST), fe)}</td></tr></table>` : `<p class="meta">No income set for this run. Add a base or a per-parcel rate under Income rates.</p>`}
    <h4 style="margin:12px 0 4px">Staff</h4><table class="dt" style="width:100%"><tr><td>${esc(r.staffHow || "—")}</td><td align="right">${r.unpaid ? `<span class="meta">unpaid</span>` : amt(r.staff, se)}</td></tr></table>
    <h4 style="margin:12px 0 4px">Result</h4><table class="dt" style="width:100%"><tr><td><b>Income − staff</b></td><td align="right"><b>${amt(net, fe || se)}</b></td></tr></table>
    <p class="hint">≈ grey = estimate until the EOD (or SOD/EOD for staff) is in · green = final.</p>`);
}
function allDetail(d, rows) {
  const T = totals(rows); const M = model(); const C = costDay(rows); const by = {}; for (const r of rows) { const k = r.run; const o = (by[k] ??= { fees: 0, staff: 0, fe: false, se: false, n: 0 }); o.fees += r.fees; o.staff += r.staff; o.fe ||= r.feeEst && r.fees > 0; o.se ||= r.est && r.staff > 0; o.n++; }
  sheet(`${STYLE}<h3>Every run · ${label(d, true)}</h3><table class="dt" style="width:100%"><tr><th>Run</th><th align="right">Income</th><th align="right">Staff</th><th align="right">Income − staff</th></tr>
    ${Object.entries(by).map(([k, o]) => `<tr class="mn-row" data-mnrun="${esc(k)}"><td><b>${esc(k)}</b>${o.n > 1 ? ` <span class="meta">× ${o.n}</span>` : ""}</td><td align="right">${amt(o.fees, o.fe)}</td><td align="right">${amt(o.staff, o.se)}</td><td align="right">${amt(o.fees - o.staff, o.fe || o.se)}</td></tr>`).join("")}
    <tr><td><b>Total</b></td><td align="right"><b>${amt(T.fees, T.fe)}</b></td><td align="right"><b>${amt(T.staff, T.se)}</b></td><td align="right"><b>${amt(T.fees - T.staff, T.fe || T.se)}</b></td></tr></table>
    <h4 style="margin:12px 0 4px">Business costs (estimate)</h4><table class="dt" style="width:100%">${COSTS.map(([k, l]) => { const v = (+M.costs[k] || 0) / WK_PER_MONTH / COST_DAYS; return v ? `<tr><td>${esc(l)}</td><td align="right">${amt(v * (C ? 1 : 0), true)}</td></tr>` : ""; }).join("")}
      <tr><td><b>Costs</b></td><td align="right"><b>${amt(C, true)}</b></td></tr><tr><td><b>Left after costs</b></td><td align="right"><b>${amt(T.fees - T.staff - C, T.fe || T.se || C > 0)}</b></td></tr></table>
    <p class="hint">Tap a run for its detail. Income excludes GST (GST on the day: ${money(T.fees * GST)}).</p>`, (bg, close) => {
    bg.querySelectorAll("[data-mnrun]").forEach(t => t.onclick = () => { const r = rows.find(x => x.run === t.dataset.mnrun); if (r) { close(); rowDetail(r, d); } }); });
}
function weekDetail(wk) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i)).map(d => ({ d, rows: breakdown(d) })).map(x => ({ ...x, T: totals(x.rows), C: costDay(x.rows) }));
  const W = days.reduce((a, x) => ({ fees: a.fees + x.T.fees, staff: a.staff + x.T.staff, cost: a.cost + x.C, est: a.est || x.T.fe || x.T.se }), { fees: 0, staff: 0, cost: 0, est: false }); const M = model();
  const byRun = {}; for (const x of days) for (const r of x.rows) { const o = (byRun[r.run] ??= { fees: 0, staff: 0, est: false }); o.fees += r.fees; o.staff += r.staff; o.est ||= (r.feeEst && r.fees > 0) || (r.est && r.staff > 0); }
  sheet(`${STYLE}<h3>Week of ${label(wk, true)}</h3>
    <table class="dt" style="width:100%"><tr><th>Day</th><th align="right">Income</th><th align="right">Staff</th><th align="right">Costs</th><th align="right">Left</th></tr>${days.map(x => `<tr class="mn-row" data-mnday="${x.d}"><td>${label(x.d)}</td><td align="right">${amt(x.T.fees, x.T.fe)}</td><td align="right">${amt(x.T.staff, x.T.se)}</td><td align="right">${amt(x.C, true)}</td><td align="right">${amt(x.T.fees - x.T.staff - x.C, x.T.fe || x.T.se || x.C > 0)}</td></tr>`).join("")}
      <tr><td><b>Week</b></td><td align="right"><b>${amt(W.fees, W.est)}</b></td><td align="right"><b>${amt(W.staff, W.est)}</b></td><td align="right"><b>${amt(W.cost, true)}</b></td><td align="right"><b>${amt(W.fees - W.staff - W.cost, true)}</b></td></tr>
      <tr><td><b>Month at this pace</b> <span class="meta">× ${WK_PER_MONTH.toFixed(2)}</span></td><td align="right"><b>${amt(W.fees * WK_PER_MONTH, W.est)}</b></td><td align="right">${amt(W.staff * WK_PER_MONTH, W.est)}</td><td align="right">${amt(W.cost * WK_PER_MONTH, true)}</td><td align="right">${amt((W.fees - W.staff - W.cost) * WK_PER_MONTH, true)}</td></tr>
      <tr><td class="meta">Target</td><td align="right" class="meta">${money0(M.target)}</td><td></td><td></td><td align="right" class="meta">${W.fees * WK_PER_MONTH >= M.target ? "on target" : `${money0(M.target - W.fees * WK_PER_MONTH)} short`}</td></tr></table>
    <h4 style="margin:12px 0 4px">By run, this week</h4><table class="dt" style="width:100%"><tr><th>Run</th><th align="right">Income</th><th align="right">≈ a month</th><th align="right">Staff</th></tr>${Object.entries(byRun).filter(([, o]) => o.fees || o.staff).sort((a, b) => b[1].fees - a[1].fees).map(([k, o]) => `<tr><td><b>${esc(k)}</b></td><td align="right">${amt(o.fees, o.est)}</td><td align="right">${amt(o.fees * WK_PER_MONTH, o.est)}</td><td align="right">${amt(o.staff, o.est)}</td></tr>`).join("")}</table>
    <p class="hint">Tap a day to open it on the board. Days still to come are budget figures (grey).</p>`, (bg, close) => {
    bg.querySelectorAll("[data-mnday]").forEach(t => t.onclick = () => { S.daySel = [t.dataset.mnday]; close(); render(); }); }, { wide: true });
}

export function wireMoney(d) {
  $$("[data-mnrow]").forEach(t => t.onclick = () => { const r = cur.rows[+t.dataset.mnrow]; if (r) rowDetail(r, cur.d); });
  $$("[data-mnall]").forEach(t => t.onclick = () => allDetail(cur.d, cur.rows));
  $$("[data-mnweek]").forEach(t => t.onclick = () => weekDetail(t.dataset.mnweek));
  $("#mn-f")?.addEventListener("submit", async ev => { ev.preventDefault();
    const tge = { ...(S.set?.tge_south || {}) }; const v = +$("#mn-tge").value || 0; if (v) tge[d] = v; else delete tge[d];
    const groups = {}; $$("[data-mg]").forEach(i => { const g = (groups[i.dataset.mg] ??= {}); g[i.dataset.mk] = i.dataset.mk === "per" ? i.value : i.dataset.mk === "basePct" ? (i.value === "" ? BASE_PCT : Math.min(100, Math.max(0, +i.value || 0))) : (+i.value || 0); });
    const parcel = {}; $$("[data-mp]").forEach(i => parcel[i.dataset.mp] = +i.value || 0);
    const costs = {}; $$("[data-mc]").forEach(i => costs[i.dataset.mc] = +i.value || 0);
    const mdl = { costs, small: +$("#mn-s").value || 0, large: +$("#mn-l").value || 0, target: +$("#mn-tg").value || 0, groups, parcel };
    const [a, b] = await Promise.all([sb.from("settings").upsert({ key: "tge_south", value: tge }), sb.from("settings").upsert({ key: "money_model", value: mdl })]);
    const err = a.error || b.error; if (err) return toast(err.message, "err");
    S.set.tge_south = tge; S.set.money_model = mdl; toast("Saved", "ok"); render(true); });
}
