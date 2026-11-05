// Day money (owner only, on the Live board when one day is picked): fees in − staff costs, run by run.
//   Fees  – run income: one daily base for PCB + RSB and one for TUA + Flyer (split if both run), Outram at so much a parcel, TGE runs a weekly base (shared over the
//           TGE runs on each working day) plus so much a parcel; parcel counts come from the EOD (or a fixed figure on the EOD).
//           Plus Rural / Lawrence / Owaka pick-ups (NZ Couriers + Post Haste) at the day rates ($5 small, $8 large by default),
//           plus the TGE total for South that the owner types in (goes on the Rural run). GST 15% on top.
//   Staff – each driver's cost for the day (the same hours × rate as Labour), split across their runs by rostered minutes.
//           Jeremy's hours are unpaid, so his runs show $0 staff cost.
import { sb, q, esc, $, toast, fmtT } from "/shared/core.js";
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

const cache = {};   // day → pick-up rows
async function loadDay(d) {
  if (cache[d]) return; cache[d] = { loading: true, rows: [] };
  try { cache[d] = { rows: await q(sb.from("pickups").select("*").eq("day", d)) }; } catch (e) { cache[d] = { rows: [], err: e.message }; }
  render(true);
}

function breakdown(d) {
  const R = dayRates(); const rows = []; const byRun = {};
  for (const drv of S.drivers) {
    const r = driverDay(drv, d); if (!r || r.holiday || !r.D) continue;
    const segs = r.D.segs; const mins = segs.map(x => Math.max(0, (x.en ?? x.st) - x.st)); const tot = mins.reduce((a, b) => a + b, 0) || segs.length;
    const cost = drv.pay_exclude ? 0 : r.spend;
    segs.forEach((x, i) => { const row = { run: x.shift.run, sort: !!x.sort, driver: drv.id, st: x.st, en: x.en, staff: cost * ((tot === segs.length ? 1 : mins[i]) / tot), unpaid: !!drv.pay_exclude, est: r.actIsEst, fees: 0, feeLines: [] };
      rows.push(row); if (!x.sort) (byRun[row.run] ??= row); });
  }
  // run income
  const tgeToday = rows.filter(r => !r.sort && TGE_RUNS.includes(r.run));
  for (const r of rows) { if (r.sort) continue; const sh = S.shifts.find(x => x.day === d && x.driver === r.driver && x.run === r.run);
    for (const [g, runs] of Object.entries(GROUP_RUNS)) { if (!runs.includes(r.run)) continue; const amt = +(R.groups[g] || 0); if (!amt) continue;
      const on = rows.filter(y => !y.sort && runs.includes(y.run)).length; r.fees += amt / on; r.feeLines.push(`${g} $${amt.toFixed(2)}/day${on > 1 ? ` ÷ ${on} runs` : ""}`); }
    if (r.run === "RAM") { const n = sh ? parcelsOf(sh) : null; if (n == null) r.feeLines.push(`parcels × $${R.ramParcel} · EOD not in`); else { r.fees += n * R.ramParcel; r.feeLines.push(`${n} parcels × $${R.ramParcel}`); } }
    if (r.run === "DB") { const n = sh ? parcelsOf(sh) : null; if (n == null) r.feeLines.push(`parcels × $${R.dbParcel} · EOD not in`); else { r.fees += n * R.dbParcel; r.feeLines.push(`${n} parcels × $${R.dbParcel}`); } }
    if (TGE_RUNS.includes(r.run)) { const share = R.tgeDays ? R.tgeWeek / R.tgeDays / tgeToday.length : 0; if (share) { r.fees += share; r.feeLines.push(`TGE $${R.tgeWeek}/wk ÷ ${R.tgeDays} days${tgeToday.length > 1 ? ` ÷ ${tgeToday.length} runs` : ""}`); }
      const n = sh ? parcelsOf(sh) : null; if (n == null) r.feeLines.push(`parcels × $${R.tgeParcel} · EOD not in`); else { r.fees += n * R.tgeParcel; r.feeLines.push(`${n} parcels × $${R.tgeParcel}`); } } }
  const feeRow = (area) => { for (const code of AREA_RUNS[area] || []) if (byRun[code]) return byRun[code];
    const k = "__" + area; if (!byRun[k]) { byRun[k] = { run: `${area} pick-ups`, driver: null, staff: 0, fees: 0, feeLines: [], noRun: true }; rows.push(byRun[k]); } return byRun[k]; };
  // pick-ups: NZC + Post Haste at the day rates; TGE is handled by the South total below
  const pu = {}; for (const p of cache[d]?.rows || []) { if (p.customer === "TGE") continue; const a = (pu[p.area] ??= { small: 0, large: 0 }); a.small += p.small || 0; a.large += p.large || 0; }
  for (const [area, a] of Object.entries(pu)) { const fee = a.small * R.small + a.large * R.large; if (!fee) continue; const row = feeRow(area); row.fees += fee;
    row.feeLines.push(`${area}: ${a.small} small × $${R.small}${a.large ? ` + ${a.large} large × $${R.large}` : ""}`); }
  const tge = tgeSouth(d); if (tge) { const row = feeRow("South"); row.fees += tge; row.feeLines.push(`TGE South total $${tge.toFixed(2)}`); }
  rows.sort((a, b) => (a.noRun ? 1 : 0) - (b.noRun ? 1 : 0) || (a.sort ? 1 : 0) - (b.sort ? 1 : 0) || (a.st ?? 0) - (b.st ?? 0));
  return rows;
}

export function moneyCard(d) {
  if (!S.me?.isOwner) return "";
  if (!cache[d]) { loadDay(d); }
  const R = dayRates(); const rows = breakdown(d);
  const T = rows.reduce((a, r) => ({ fees: a.fees + r.fees, staff: a.staff + r.staff }), { fees: 0, staff: 0 });
  const est = rows.some(r => r.est && r.staff);
  const tr = r => { const net = r.fees - r.staff;
    return `<tr><td><b>${esc(r.run)}</b>${r.st != null ? `<div class="meta">${fmtT(r.st)}–${fmtT(r.en)}</div>` : ""}</td><td>${r.driver ? esc(nm(r.driver)) : `<span class="meta">not rostered</span>`}</td>
      <td align="right">${r.fees ? money(r.fees) : `<span class="meta">—</span>`}${r.feeLines.length ? `<div class="meta">${r.feeLines.map(esc).join("<br>")}</div>` : ""}</td>
      <td align="right">${r.fees ? money(r.fees * GST) : ""}</td><td align="right">${r.fees ? money(r.fees * (1 + GST)) : ""}</td>
      <td align="right">${r.unpaid ? `<span class="meta">unpaid</span>` : `${r.est && r.staff ? `<span class="c-warn">≈</span>` : ""}${money(r.staff)}`}</td>
      <td align="right" class="${net < 0 ? "c-crit" : net > 0 ? "c-ok" : ""}"><b>${money(net)}</b></td></tr>`; };
  return `<div class="card"><h2>Day money<span>fees − staff costs by run · ${cache[d]?.loading ? "loading pick-ups…" : "NZD"}</span></h2>
    <div class="tiles"><div class="tile"><div class="l">Fees</div><div class="v">${money(T.fees)}</div><div class="s">+ GST ${money(T.fees * GST)} = ${money(T.fees * (1 + GST))}</div></div>
      <div class="tile"><div class="l">Staff costs</div><div class="v ${est ? "c-warn" : ""}">${est ? "≈" : ""}${money(T.staff)}</div><div class="s">hours × each driver's rate${est ? " · ≈ part estimated (SOD/EOD not in)" : ""}</div></div>
      <div class="tile"><div class="l">Fees − staff</div><div class="v ${T.fees - T.staff < 0 ? "c-crit" : "c-ok"}">${money(T.fees - T.staff)}</div><div class="s">fees before GST</div></div></div>
    ${rows.length ? `<div class="scroll"><table class="dt"><tr><th>Run</th><th>Driver</th><th align="right">Fees</th><th align="right">GST</th><th align="right">Incl GST</th><th align="right">Staff</th><th align="right">Fees − staff</th></tr>${rows.map(tr).join("")}
      <tr><td colspan="2"><b>Total</b></td><td align="right"><b>${money(T.fees)}</b></td><td align="right"><b>${money(T.fees * GST)}</b></td><td align="right"><b>${money(T.fees * (1 + GST))}</b></td><td align="right"><b>${money(T.staff)}</b></td><td align="right"><b>${money(T.fees - T.staff)}</b></td></tr></table></div>` : `<p class="meta">Nobody rostered and no pick-ups on this day.</p>`}
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
    <p class="hint">Run income: $400 a day for PCB + RSB together and $400 a day for TUA + Flyer together, whether one or both run (split between them when both are on); Outram and D>B per parcel; TGE runs the weekly base shared over the TGE runs each day, plus per parcel. Parcels come from the EOD, so those lines fill in once it's posted. Pick-up fees cover NZ Couriers and Post Haste on Rural, South, Lawrence and Owaka. TGE goes in as one total for South, on the same line as the South pick-ups. Staff cost is each driver's day split across their runs by rostered time.</p></div>`;
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
