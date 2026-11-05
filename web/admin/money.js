// Day budget (owner only, on the Live board when one day is picked): income − staff costs, run by run.
//   Income – each run's base (a day, week or month figure, shared between the runs in its group whichever of them are on)
//            plus so much a parcel on top where the run is paid by the parcel (parcels from the EOD). TGE also has a weekly base.
//            Plus Rural / Lawrence / Owaka pick-ups (NZ Couriers + Post Haste) and the TGE South total typed in. GST 15% on top.
//   Staff  – each driver's cost for the day (the same hours × rate as Labour), split across their runs by rostered minutes.
//            Jeremy's hours are unpaid, so his runs show $0 staff cost.
//   Costs  – business running costs (fuel, RUC, insurance, ACC, loan, software…) as a monthly figure each, defaulted to the Xero Aug–Oct 2026
//            average (excl GST), spread over the 6 working days a week and charged on any day a run is rostered. Always an estimate (grey).
//   Anything not in yet is estimated from the past 8 weeks (same weekday where there's enough) and shown grey; real figures show green.
//   Tap a run (or a total) for the full detail. The "month at this pace" tile adds up the whole week and scales it to a month.
import { sb, q, esc, $, $$, toast, fmtT, today, addDays, dow, monOf, label } from "/shared/core.js";
import { evidenceFor } from "/shared/score.js";
import { S, nm, render, sheet } from "/admin/admin.js";
import { driverDay } from "/admin/live.js";

const GST = 0.15;
const WK_PER_MONTH = 52 / 12;
const AREA_RUNS = { Rural: ["TUA"], South: ["TUA", "DB"], Lawrence: ["LAW"], Owaka: ["DB", "FLY"] };   // which run a pick-up area's income lands on
const money = n => (n < 0 ? "−$" : "$") + Math.abs(n).toFixed(2);
const money0 = n => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString();
// shared bases: per = "day" | "week" | "month"; days = working days a week it's spread over
const GROUPS = {
  "PCB + RSB": { runs: ["PCB", "RSB", "WH"], per: "month", amt: 17000, days: 6 },
  "TUA + Flyer": { runs: ["TUA", "FLY"], per: "day", amt: 400, days: 5 },
  "Lawrence": { runs: ["LAW"], per: "month", amt: 4500, days: 5 },
  "TGE": { runs: ["S", "T"], per: "week", amt: 2000, days: 5 },
  "Food bag": { runs: ["FB", "FBP", "FB2", "FB2P", "MFB1", "MFB2"], per: "month", amt: 2000, days: 1 },
};
// business costs, $ a month excl GST — Xero Aug–Oct 2026 average (the Biz CashFlow sheet assumes less: fuel $1,739, RUC $479, insurance $617)
const COSTS = [["fuel", "Fuel", 4251.46], ["ruc", "Road user charges", 590.78], ["veh", "Vehicle costs & repairs", 336.22], ["sub", "Subcontractors", 573.91], ["ins", "Insurance", 1569.09], ["acc", "ACC levy", 714.93],
  ["loan", "Loan fees & interest", 1078.66], ["soft", "Software", 897.35], ["staffx", "Staff training, uniforms, meetings", 1660.74], ["acct", "Accountancy", 496.57], ["office", "Office, phone, rent, marketing, bank", 597.8]];
const COST_DAYS = 6;   // working days a week the monthly costs are spread over
const PARCEL_RUNS = ["TUA", "FLY", "DB", "RAM", "PCB", "RSB", "LAW", "S", "T"];
const DEF = { small: 5, large: 8, target: 70000, parcel: { TUA: 0, FLY: 0, DB: 6, RAM: 1.8, PCB: 0, RSB: 0, LAW: 0, S: 1.25, T: 1.25 }, groups: Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, { per: g.per, amt: g.amt, days: g.days }])), costs: Object.fromEntries(COSTS.map(([k, , a]) => [k, a])) };
const model = () => { const v = S.set?.money_model || {}; return { ...DEF, ...v, parcel: { ...DEF.parcel, ...(v.parcel || {}) }, groups: Object.fromEntries(Object.keys(GROUPS).map(k => [k, { ...DEF.groups[k], ...(v.groups?.[k] || {}) }])), costs: { ...DEF.costs, ...(v.costs || {}) } }; };
const costMonth = () => Object.values(model().costs).reduce((a, b) => a + (+b || 0), 0);
const costDay = rows => rows.some(r => !r.noRun) ? costMonth() / WK_PER_MONTH / COST_DAYS : 0;   // charged on any day a run is rostered
const perDay = g => !g.amt ? 0 : g.per === "month" ? g.amt / WK_PER_MONTH / (g.days || 5) : g.per === "week" ? g.amt / (g.days || 5) : g.amt;
const perTxt = g => g.per === "month" ? `$${(+g.amt).toLocaleString()}/month ÷ ${(+(WK_PER_MONTH)).toFixed(2)} wk ÷ ${g.days} days` : g.per === "week" ? `$${(+g.amt).toLocaleString()}/week ÷ ${g.days} days` : `$${(+g.amt).toLocaleString()}/day`;
// parcels delivered on a run: the fixed figure if one was set on the EOD, otherwise what the driver posted; null = EOD not in yet
const parcelsOf = shift => { if (!shift) return null; const ov = S.ovs.find(o => o.shift_id === shift.id); if (ov?.parcels != null) return +ov.parcels; const e = S.eodBy?.[shift.id]; return e?.parcels != null ? +e.parcels : null; };
const tgeSouth = d => +(S.set?.tge_south?.[d] || 0);

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
    const r = driverDay(drv, d); if (!r || r.holiday || !r.D) continue;
    const segs = r.D.segs; const mins = segs.map(x => Math.max(0, (x.en ?? x.st) - x.st)); const tot = mins.reduce((a, b) => a + b, 0);
    const cost = drv.pay_exclude ? 0 : r.spend;
    segs.forEach((x, i) => { const share = tot ? mins[i] / tot : 1 / segs.length;
      const row = { run: x.shift.run, shift: x.shift, sort: !!x.sort, driver: drv.id, st: x.st, en: x.en, staff: cost * share, staffHow: drv.pay_exclude ? "unpaid (owner)" : `${(r.actEst ?? r.exp).toFixed(2)} h × $${(+r.rate).toFixed(2)}/h = ${money(r.spend)}${segs.length > 1 ? ` · ${Math.round(share * 100)}% of the day (rostered time)` : ""} · ${r.actHow}`, unpaid: !!drv.pay_exclude, est: !drv.pay_exclude && r.actIsEst, fees: 0, feeEst: false, feeLines: [] };
      rows.push(row); if (!x.sort) (byRun[row.run] ??= row); });
  }
  // a run's figures are final once its EOD is in (or the day has gone), otherwise estimated
  const past = d < today(); const done = r => past || !!S.eodBy?.[r.shift?.id];
  const add = (r, amt, line, est) => { r.fees += amt; if (est) r.feeEst = true; r.feeLines.push({ amt, line, est }); };
  for (const r of rows) { if (r.sort) continue;
    for (const [g, G] of Object.entries(GROUPS)) { if (!G.runs.includes(r.run)) continue; const m = M.groups[g]; const day = perDay(m); if (!day) continue;
      const on = rows.filter(y => !y.sort && G.runs.includes(y.run)).length; add(r, day / on, `${g} base · ${perTxt(m)}${on > 1 ? ` ÷ ${on} runs on` : ""}`, !done(r)); }
    const rate = +(M.parcel[r.run] || 0); if (rate) { const n = parcelsOf(r.shift);
      if (n != null) add(r, n * rate, `${n} parcels × $${rate}`, false);
      else { const ev = evidenceFor(r.run, d); if (ev?.parcels != null) add(r, Math.round(ev.parcels) * rate, `${Math.round(ev.parcels)} parcels × $${rate} (average ${ev.scope === "weekday" ? "for this weekday" : "of recent days"})`, true); else { r.feeEst = true; r.feeLines.push({ amt: 0, line: `parcels × $${rate} · no history yet`, est: true }); } } } }
  const feeRow = (area) => { for (const code of AREA_RUNS[area] || []) if (byRun[code]) return byRun[code];
    const k = "__" + area; if (!byRun[k]) { byRun[k] = { run: `${area} pick-ups`, driver: null, staff: 0, fees: 0, feeEst: false, feeLines: [], noRun: true }; rows.push(byRun[k]); } return byRun[k]; };
  const runOn = area => (AREA_RUNS[area] || []).map(c => byRun[c]).find(Boolean);
  // pick-ups: NZC + Post Haste. Logged → final; none logged yet on a run that's on → estimate.
  const pu = {}; for (const p of cache[d]?.rows || []) { if (p.customer === "TGE") continue; const a = (pu[p.area] ??= { small: 0, large: 0 }); a.small += p.small || 0; a.large += p.large || 0; }
  for (const [area, a] of Object.entries(pu)) { const fee = a.small * M.small + a.large * M.large; if (fee) add(feeRow(area), fee, `${area} pick-ups: ${a.small} small × $${M.small}${a.large ? ` + ${a.large} large × $${M.large}` : ""}`, false); }
  if (cache[d] && !cache[d].loading) for (const area of ["Rural", "Lawrence", "Owaka"]) { if (pu[area]) continue; const r = runOn(area); if (!r || done(r)) continue;
    const by = {}; for (const p of cache[d].hist) { if (p.customer === "TGE" || p.area !== area) continue; by[p.day] = (by[p.day] || 0) + p.small * M.small + p.large * M.large; }
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
  const month = wkFees * WK_PER_MONTH; const monthProfit = (wkFees - wkStaff - wkCost) * WK_PER_MONTH;
  const tr = (r, i) => { const net = r.fees - r.staff; const fe = r.feeEst && r.fees > 0, se = r.est && r.staff > 0;
    return `<tr class="mn-row" data-mnrow="${i}" title="Tap for the detail"><td><b>${esc(r.run)}</b>${r.st != null ? `<div class="meta">${fmtT(r.st)}–${fmtT(r.en)}</div>` : ""}</td><td>${r.driver ? esc(nm(r.driver)) : `<span class="meta">not rostered</span>`}</td>
      <td align="right">${r.fees ? amt(r.fees, fe) : `<span class="meta">—</span>`}</td><td align="right">${r.fees ? amt(r.fees * (1 + GST), fe) : ""}</td>
      <td align="right">${r.unpaid ? `<span class="meta">unpaid</span>` : amt(r.staff, se)}</td><td align="right"><b>${amt(net, fe || se)}</b></td></tr>`; };
  return `${STYLE}<div class="card"><h2>Day budget<span>${label(d)} · income − staff − costs · <span class="mn-est">≈ grey = estimate</span> · <span class="mn-fin">green = final</span> · tap for detail</span></h2>
    <div class="tiles"><button class="tile mn-t" data-mnall="1"><div class="l">Income</div><div class="v ${cls(T.fe)}">${T.fe ? "≈" : ""}${money(T.fees)}</div><div class="s">+ GST ${money(T.fees * GST)} = ${money(T.fees * (1 + GST))}</div></button>
      <button class="tile mn-t" data-mnall="1"><div class="l">Staff costs</div><div class="v ${cls(T.se)}">${T.se ? "≈" : ""}${money(T.staff)}</div><div class="s">hours × each driver's rate</div></button>
      <button class="tile mn-t" data-mnall="1"><div class="l">Business costs</div><div class="v mn-est">≈${money(C)}</div><div class="s">${money0(costMonth())}/month ÷ ${COST_DAYS} days · Xero + cashflow</div></button>
      <button class="tile mn-t" data-mnall="1"><div class="l">Left after costs</div><div class="v ${cls(T.fe || T.se || C > 0)}">${T.fe || T.se || C > 0 ? "≈" : ""}${money(T.fees - T.staff - C)}</div><div class="s">income − staff − costs, before GST</div></button>
      <button class="tile mn-t" data-mnweek="${wk}"><div class="l">Month at this pace</div><div class="v ${cls(wkEst)}">${wkEst ? "≈" : ""}${money0(month)}</div><div class="s">week of ${label(wk)}: ${money0(wkFees)} in · ${money0(wkStaff)} staff · ${money0(wkCost)} costs · ≈${money0(monthProfit)}/month left · target ${money0(M.target)}/month (${month >= M.target ? "+" : "−"}${money0(Math.abs(month - M.target))})</div></button></div>
    ${rows.length ? `<div class="scroll"><table class="dt"><tr><th>Run</th><th>Driver</th><th align="right">Income</th><th align="right">Incl GST</th><th align="right">Staff</th><th align="right">Income − staff</th></tr>${rows.map(tr).join("")}
      <tr class="mn-row" data-mnall="1"><td colspan="2"><b>Total</b></td><td align="right"><b>${amt(T.fees, T.fe)}</b></td><td align="right"><b>${amt(T.fees * (1 + GST), T.fe)}</b></td><td align="right"><b>${amt(T.staff, T.se)}</b></td><td align="right"><b>${amt(T.fees - T.staff, T.fe || T.se)}</b></td></tr>
      <tr class="mn-row" data-mnall="1"><td colspan="5">Business costs <span class="meta">(estimate)</span></td><td align="right">${amt(-C, true)}</td></tr>
      <tr class="mn-row" data-mnall="1"><td colspan="5"><b>Left after costs</b></td><td align="right"><b>${amt(T.fees - T.staff - C, T.fe || T.se || C > 0)}</b></td></tr></table></div>` : `<p class="meta">Nobody rostered and no pick-ups on this day.</p>`}
    <form class="row" id="mn-f" style="margin-top:8px;align-items:flex-end"><label class="f" style="flex:1 1 160px">TGE total · South (excl GST)<input class="in" id="mn-tge" inputmode="decimal" value="${tgeSouth(d) || ""}" placeholder="0.00"></label>
      <button class="btn sm" type="submit" style="flex:0 0 auto">Save</button>
      <details class="full" style="flex:1 1 100%"><summary>Income rates (excl GST)</summary>
        <h4 style="margin:8px 0 4px">Run bases</h4><div class="scroll"><table class="dt"><tr><th>Base</th><th>Runs</th><th>Amount $</th><th>Per</th><th>Days a week</th><th align="right">= a day</th></tr>${Object.entries(GROUPS).map(([k, G]) => { const m = M.groups[k]; return `<tr><td><b>${esc(k)}</b></td><td class="meta">${G.runs.join(", ")}</td><td><input class="in" data-mg="${esc(k)}" data-mk="amt" inputmode="decimal" value="${m.amt}" style="width:96px"></td><td><select class="in" data-mg="${esc(k)}" data-mk="per">${["day", "week", "month"].map(p => `<option ${p === m.per ? "selected" : ""}>${p}</option>`).join("")}</select></td><td><input class="in" data-mg="${esc(k)}" data-mk="days" inputmode="numeric" value="${m.days}" style="width:56px"></td><td align="right">${money(perDay(m))}</td></tr>`; }).join("")}</table></div>
        <h4 style="margin:8px 0 4px">Per parcel, on top of the base (parcels from the EOD)</h4><div class="row" style="align-items:flex-end">${PARCEL_RUNS.map(k => `<label class="f" style="flex:1 1 90px">${k} $<input class="in" data-mp="${k}" inputmode="decimal" value="${M.parcel[k] ?? 0}"></label>`).join("")}</div>
        <h4 style="margin:8px 0 4px">Business costs, $ a month excl GST <span class="meta">(Xero Aug–Oct average · ${money0(costMonth())} a month)</span></h4><div class="row" style="align-items:flex-end">${COSTS.map(([k, l]) => `<label class="f" style="flex:1 1 150px">${esc(l)}<input class="in" data-mc="${k}" inputmode="decimal" value="${M.costs[k] ?? 0}"></label>`).join("")}</div>
        <h4 style="margin:8px 0 4px">Pick-ups and target</h4><div class="row" style="align-items:flex-end"><label class="f" style="flex:1 1 110px">Pick-up small $<input class="in" id="mn-s" inputmode="decimal" value="${M.small}"></label><label class="f" style="flex:1 1 110px">Pick-up large $<input class="in" id="mn-l" inputmode="decimal" value="${M.large}"></label><label class="f" style="flex:1 1 140px">Monthly income target $<input class="in" id="mn-tg" inputmode="decimal" value="${M.target}"></label>
        <button class="btn sm" type="submit" style="flex:0 0 auto">Save rates</button></div></details></form>
    <p class="hint">Each run gets its base (shared when both runs in a pair are on) plus its per-parcel rate. Until the EOD is in, parcels are the 8-week average for that run, and pick-ups, the TGE South total and staff hours are estimates too; business costs are always an estimate — grey until the real figures land, then green.</p></div>`;
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
    const groups = {}; $$("[data-mg]").forEach(i => { const g = (groups[i.dataset.mg] ??= {}); g[i.dataset.mk] = i.dataset.mk === "per" ? i.value : (+i.value || 0); });
    const parcel = {}; $$("[data-mp]").forEach(i => parcel[i.dataset.mp] = +i.value || 0);
    const costs = {}; $$("[data-mc]").forEach(i => costs[i.dataset.mc] = +i.value || 0);
    const mdl = { costs, small: +$("#mn-s").value || 0, large: +$("#mn-l").value || 0, target: +$("#mn-tg").value || 0, groups, parcel };
    const [a, b] = await Promise.all([sb.from("settings").upsert({ key: "tge_south", value: tge }), sb.from("settings").upsert({ key: "money_model", value: mdl })]);
    const err = a.error || b.error; if (err) return toast(err.message, "err");
    S.set.tge_south = tge; S.set.money_model = mdl; toast("Saved", "ok"); render(true); });
}
