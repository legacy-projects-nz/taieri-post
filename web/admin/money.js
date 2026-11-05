// Day money (owner only, on the Live board when one day is picked): fees in − staff costs, run by run.
//   Fees  – run income: one daily base for PCB + RSB and one for TUA + Flyer (split if both run), Outram at so much a parcel, TGE runs a weekly base (shared over the
//           TGE runs on each working day) plus so much a parcel; parcel counts come from the EOD (or a fixed figure on the EOD).
//           Plus Rural / Lawrence / Owaka pick-ups (NZ Couriers + Post Haste) at the day rates ($5 small, $8 large by default),
//           plus the TGE total for South that the owner types in (goes on the Rural run). GST 15% on top.
//   Staff – each driver's cost for the day (the same hours × rate as Labour), split across their runs by rostered minutes.
//           Jeremy's hours are unpaid, so his runs show $0 staff cost.
//   It's a budget for the day: anything not in yet is estimated from the past 8 weeks (same weekday where there's enough data)
//   and shown grey; once the real figure is in it shows green.
import { sb, q, esc, $, toast, fmtT, today, addDays, dow } from "/shared/core.js";
import { evidenceFor } from "/shared/score.js";
import { S, nm, render } from "/admin/admin.js";
import { driverDay } from "/admin/live.js";

const GST = 0.15;
const AREA_RUNS = { Rural: ["TUA"], South: ["TUA", "DB"], Lawrence: ["LAW"], Owaka: ["DB", "FLY"] };   // which run a pick-up area's fees land on
const money = n => (n < 0 ? "−$" : "$") + Math.abs(n).toFixed(2);
const DEF = { small: 5, large: 8, groups: { "PCB + RSB": 400, "TUA + Flyer": 400 }, ramParcel: 1.8, dbParcel: 6, tgeWeek: 2000, tgeDays: 5, tgeParcel: 1.25 };
const dayRates = () => { const v = S.set?.money_rates || {}; return { ...DEF, ...v, groups: { ...DEF.groups, ...(v.groups || {}) } }; };
// a day base shared by a pair of runs: always the one amount for the day, split between whichever of them are on (one run on = it gets the lot)
const GROUP_RUNS = { "PCB + RSB": ["PCB", "RSB", "WH"], "TUA + Flyer": ["TUA", "FLY"] };
const TGE_RUNS = ["S", "T"];
// parcels delivered on a run: the fixed figure if one was set on the EOD, otherwise what the driver posted; null = EOD not in yet
const parcelsOf = shift => { const ov = S.ovs.find(o => o.shift_id === shift.id); if (ov?.parcels != null) return +ov.parcels; const e = S.eodBy?.[shift.id]; return e?.parcels != null ? +e.parcels : null; };
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
  const R = dayRates(); const rows = []; const byRun = {};
  for (const drv of S.drivers) {
    const r = driverDay(drv, d); if (!r || r.holiday || !r.D) continue;
    const segs = r.D.segs; const mins = segs.map(x => Math.max(0, (x.en ?? x.st) - x.st)); const tot = mins.reduce((a, b) => a + b, 0) || segs.length;
    const cost = drv.pay_exclude ? 0 : r.spend;
    segs.forEach((x, i) => { const row = { run: x.shift.run, shift: x.shift, sort: !!x.sort, driver: drv.id, st: x.st, en: x.en, staff: cost * ((tot === segs.length ? 1 : mins[i]) / tot), unpaid: !!drv.pay_exclude, est: !drv.pay_exclude && r.actIsEst, fees: 0, feeEst: false, feeLines: [] };
      rows.push(row); if (!x.sort) (byRun[row.run] ??= row); });
  }
  // run income — a run's figures are final once its EOD is in (or the day has gone), otherwise estimated
  const past = d < today();
  const done = r => past || !!S.eodBy?.[r.shift?.id];
  const add = (r, amt, line, est) => { r.fees += amt; if (est) r.feeEst = true; r.feeLines.push((est ? "≈ " : "") + line); };
  const perParcel = (r, rate, label) => { const n = parcelsOf(r.shift);
    if (n != null) return add(r, n * rate, `${n} parcels × $${rate}`, false);
    const ev = evidenceFor(r.run, d); if (ev?.parcels != null) return add(r, Math.round(ev.parcels) * rate, `${Math.round(ev.parcels)} parcels × $${rate} (avg ${ev.scope === "weekday" ? "this weekday" : "recent days"})`, true);
    r.feeEst = true; r.feeLines.push(`${label} parcels × $${rate} · no history yet`); };
  const tgeToday = rows.filter(r => !r.sort && TGE_RUNS.includes(r.run));
  for (const r of rows) { if (r.sort) continue;
    for (const [g, runs] of Object.entries(GROUP_RUNS)) { if (!runs.includes(r.run)) continue; const amt = +(R.groups[g] || 0); if (!amt) continue;
      const on = rows.filter(y => !y.sort && runs.includes(y.run)).length; add(r, amt / on, `${g} $${amt.toFixed(2)}/day${on > 1 ? ` ÷ ${on} runs` : ""}`, !done(r)); }
    if (r.run === "RAM") perParcel(r, R.ramParcel, "Outram");
    if (r.run === "DB") perParcel(r, R.dbParcel, "D>B");
    if (TGE_RUNS.includes(r.run)) { const share = R.tgeDays ? R.tgeWeek / R.tgeDays / tgeToday.length : 0; if (share) add(r, share, `TGE $${R.tgeWeek}/wk ÷ ${R.tgeDays} days${tgeToday.length > 1 ? ` ÷ ${tgeToday.length} runs` : ""}`, !done(r));
      perParcel(r, R.tgeParcel, "TGE"); } }
  const feeRow = (area) => { for (const code of AREA_RUNS[area] || []) if (byRun[code]) return byRun[code];
    const k = "__" + area; if (!byRun[k]) { byRun[k] = { run: `${area} pick-ups`, driver: null, staff: 0, fees: 0, feeEst: false, feeLines: [], noRun: true }; rows.push(byRun[k]); } return byRun[k]; };
  const runOn = area => (AREA_RUNS[area] || []).map(c => byRun[c]).find(Boolean);
  // pick-ups: NZC + Post Haste at the day rates (TGE is the South total below). Logged → final; none logged yet on a run that's on → estimate.
  const fee = a => a.small * R.small + a.large * R.large;
  const pu = {}; for (const p of cache[d]?.rows || []) { if (p.customer === "TGE") continue; const a = (pu[p.area] ??= { small: 0, large: 0 }); a.small += p.small || 0; a.large += p.large || 0; }
  for (const [area, a] of Object.entries(pu)) { if (!fee(a)) continue; add(feeRow(area), fee(a), `${area}: ${a.small} small × $${R.small}${a.large ? ` + ${a.large} large × $${R.large}` : ""}`, false); }
  if (!cache[d]?.loading) for (const area of ["Rural", "Lawrence", "Owaka"]) { if (pu[area]) continue; const r = runOn(area); if (!r || done(r)) continue;
    const by = {}; for (const p of cache[d]?.hist || []) { if (p.customer === "TGE" || p.area !== area) continue; by[p.day] = (by[p.day] || 0) + p.small * R.small + p.large * R.large; }
    const e = avgDays(by, d); if (e) add(r, e, `${area} pick-ups (avg recent days)`, true); }
  // TGE South: typed-in total → final; otherwise the average of past totals while the South run is on
  const tge = tgeSouth(d); if (tge) add(feeRow("South"), tge, `TGE South total $${tge.toFixed(2)}`, false);
  else { const r = runOn("South"); const hist = Object.fromEntries(Object.entries(S.set?.tge_south || {}).filter(([k, v]) => k < d && k >= addDays(d, -56) && +v));
    const e = r ? avgDays(Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, +v])), d) : null; if (e) add(r, e, "TGE South (avg of past totals)", true); }
  rows.sort((a, b) => (a.noRun ? 1 : 0) - (b.noRun ? 1 : 0) || (a.sort ? 1 : 0) - (b.sort ? 1 : 0) || (a.st ?? 0) - (b.st ?? 0));
  return rows;
}

export function moneyCard(d) {
  if (!S.me?.isOwner) return "";
  if (!cache[d]) { loadDay(d); }
  const R = dayRates(); const rows = breakdown(d);
  const T = rows.reduce((a, r) => ({ fees: a.fees + r.fees, staff: a.staff + r.staff, fe: a.fe || (r.feeEst && r.fees > 0), se: a.se || (r.est && r.staff > 0) }), { fees: 0, staff: 0, fe: false, se: false });
  const c = est => est ? "mn-est" : "mn-fin";                         // grey = estimate, green = final
  const amt = (v, est) => `<span class="${c(est)}">${est ? "≈" : ""}${money(v)}</span>`;
  const tr = r => { const net = r.fees - r.staff; const fe = r.feeEst && r.fees > 0, se = r.est && r.staff > 0;
    return `<tr><td><b>${esc(r.run)}</b>${r.st != null ? `<div class="meta">${fmtT(r.st)}–${fmtT(r.en)}</div>` : ""}</td><td>${r.driver ? esc(nm(r.driver)) : `<span class="meta">not rostered</span>`}</td>
      <td align="right">${r.fees ? amt(r.fees, fe) : `<span class="meta">—</span>`}${r.feeLines.length ? `<div class="meta">${r.feeLines.map(esc).join("<br>")}</div>` : ""}</td>
      <td align="right">${r.fees ? amt(r.fees * GST, fe) : ""}</td><td align="right">${r.fees ? amt(r.fees * (1 + GST), fe) : ""}</td>
      <td align="right">${r.unpaid ? `<span class="meta">unpaid</span>` : amt(r.staff, se)}</td>
      <td align="right"><b>${amt(net, fe || se)}</b></td></tr>`; };
  return `<style>.mn-est{color:var(--ink3)}.mn-fin{color:var(--ok)}.tile .v.mn-est,.tile .v.mn-fin{font-variant-numeric:tabular-nums}</style>
    <div class="card"><h2>Day budget<span>fees − staff by run · <span class="mn-est">≈ grey = estimate</span> · <span class="mn-fin">green = final</span>${cache[d]?.loading ? " · loading pick-ups…" : ""}</span></h2>
    <div class="tiles"><div class="tile"><div class="l">Fees</div><div class="v ${c(T.fe)}">${T.fe ? "≈" : ""}${money(T.fees)}</div><div class="s">+ GST ${money(T.fees * GST)} = ${money(T.fees * (1 + GST))}</div></div>
      <div class="tile"><div class="l">Staff costs</div><div class="v ${c(T.se)}">${T.se ? "≈" : ""}${money(T.staff)}</div><div class="s">hours × each driver's rate${T.se ? " · estimated until SOD and EOD are in" : ""}</div></div>
      <div class="tile"><div class="l">Fees − staff</div><div class="v ${c(T.fe || T.se)}">${T.fe || T.se ? "≈" : ""}${money(T.fees - T.staff)}</div><div class="s">fees before GST</div></div></div>
    ${rows.length ? `<div class="scroll"><table class="dt"><tr><th>Run</th><th>Driver</th><th align="right">Fees</th><th align="right">GST</th><th align="right">Incl GST</th><th align="right">Staff</th><th align="right">Fees − staff</th></tr>${rows.map(tr).join("")}
      <tr><td colspan="2"><b>Total</b></td><td align="right"><b>${amt(T.fees, T.fe)}</b></td><td align="right"><b>${amt(T.fees * GST, T.fe)}</b></td><td align="right"><b>${amt(T.fees * (1 + GST), T.fe)}</b></td><td align="right"><b>${amt(T.staff, T.se)}</b></td><td align="right"><b>${amt(T.fees - T.staff, T.fe || T.se)}</b></td></tr></table></div>` : `<p class="meta">Nobody rostered and no pick-ups on this day.</p>`}
    <form class="row" id="mn-f" style="margin-top:8px;align-items:flex-end"><label class="f" style="flex:1 1 160px">TGE total · South (excl GST)<input class="in" id="mn-tge" inputmode="decimal" value="${tgeSouth(d) || ""}" placeholder="0.00"></label>
      <button class="btn sm" type="submit" style="flex:0 0 auto">Save</button>
      <details class="full" style="flex:1 1 100%"><summary>Income rates (excl GST)</summary><div class="row" style="margin-top:6px;align-items:flex-end">
        ${Object.keys(DEF.groups).map(k => `<label class="f" style="flex:1 1 130px">${k} $/day<input class="in" data-mg="${k}" inputmode="decimal" value="${R.groups[k] ?? ""}"></label>`).join("")}
        <label class="f" style="flex:1 1 110px">Outram $/parcel<input class="in" id="mn-ram" inputmode="decimal" value="${R.ramParcel}"></label>
        <label class="f" style="flex:1 1 110px">D>B $/parcel<input class="in" id="mn-db" inputmode="decimal" value="${R.dbParcel}"></label>
        <label class="f" style="flex:1 1 110px">TGE $/week<input class="in" id="mn-tw" inputmode="decimal" value="${R.tgeWeek}"></label><label class="f" style="flex:1 1 110px">TGE days/week<input class="in" id="mn-td" inputmode="decimal" value="${R.tgeDays}"></label>
        <label class="f" style="flex:1 1 110px">TGE $/parcel<input class="in" id="mn-tp" inputmode="decimal" value="${R.tgeParcel}"></label>
        <label class="f" style="flex:1 1 110px">Pick-up small $<input class="in" id="mn-s" inputmode="decimal" value="${R.small}"></label><label class="f" style="flex:1 1 110px">Pick-up large $<input class="in" id="mn-l" inputmode="decimal" value="${R.large}"></label>
        <button class="btn sm" type="submit" style="flex:0 0 auto">Save rates</button></div></details></form>
    <p class="hint">Run income: $400 a day for PCB + RSB together and $400 a day for TUA + Flyer together, whether one or both run (split between them when both are on); Outram and D>B per parcel; TGE runs the weekly base shared over the TGE runs each day, plus per parcel. Until a run's EOD is in, its parcels are the average for that run over the last 8 weeks (same weekday where there's enough), pick-ups and the TGE South total are averages too, and staff cost uses the expected hours — all grey. They turn green as the real figures come in. Pick-up fees cover NZ Couriers and Post Haste on Rural, Lawrence and Owaka. TGE goes in as one total for South (TUA, or D>B if TUA is off). Staff cost is each driver's day split across their runs by rostered time.</p></div>`;
}

export function wireMoney(d) {
  $("#mn-f")?.addEventListener("submit", async ev => { ev.preventDefault();
    const tge = { ...(S.set?.tge_south || {}) }; const v = +$("#mn-tge").value || 0; if (v) tge[d] = v; else delete tge[d];
    const groups = {}; document.querySelectorAll("[data-mg]").forEach(i => groups[i.dataset.mg] = +i.value || 0);
    const rates = { small: +$("#mn-s").value || 0, large: +$("#mn-l").value || 0, groups, ramParcel: +$("#mn-ram").value || 0, dbParcel: +$("#mn-db").value || 0, tgeWeek: +$("#mn-tw").value || 0, tgeDays: +$("#mn-td").value || 0, tgeParcel: +$("#mn-tp").value || 0 };
    const [a, b] = await Promise.all([sb.from("settings").upsert({ key: "tge_south", value: tge }), sb.from("settings").upsert({ key: "money_rates", value: rates })]);
    const err = a.error || b.error; if (err) return toast(err.message, "err");
    S.set.tge_south = tge; S.set.money_rates = rates; toast("Saved", "ok"); render(true); });
}
