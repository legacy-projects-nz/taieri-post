// Day money (owner only, on the Live board when one day is picked): fees in − staff costs, run by run.
//   Fees  – Rural / Lawrence / Owaka pick-ups (NZ Couriers + Post Haste) at the day rates ($5 small, $8 large by default),
//           plus the TGE total for South that the owner types in (goes on the Rural run). GST 15% on top.
//   Staff – each driver's cost for the day (the same hours × rate as Labour), split across their runs by rostered minutes.
//           Jeremy's hours are unpaid, so his runs show $0 staff cost.
import { sb, q, esc, $, toast, fmtT } from "/shared/core.js";
import { S, nm, render } from "/admin/admin.js";
import { driverDay } from "/admin/live.js";

const GST = 0.15;
const AREA_RUNS = { Rural: ["TUA"], Lawrence: ["LAW"], Owaka: ["DB", "FLY"] };   // which run a pick-up area's fees land on
const money = n => (n < 0 ? "−$" : "$") + Math.abs(n).toFixed(2);
const dayRates = () => ({ small: 5, large: 8, ...(S.set?.money_rates || {}) });
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
  const feeRow = (area) => { for (const code of AREA_RUNS[area] || []) if (byRun[code]) return byRun[code];
    const k = "__" + area; if (!byRun[k]) { byRun[k] = { run: `${area} pick-ups`, driver: null, staff: 0, fees: 0, feeLines: [], noRun: true }; rows.push(byRun[k]); } return byRun[k]; };
  // pick-ups: NZC + Post Haste at the day rates; TGE is handled by the South total below
  const pu = {}; for (const p of cache[d]?.rows || []) { if (p.customer === "TGE") continue; const a = (pu[p.area] ??= { small: 0, large: 0 }); a.small += p.small || 0; a.large += p.large || 0; }
  for (const [area, a] of Object.entries(pu)) { const fee = a.small * R.small + a.large * R.large; if (!fee) continue; const row = feeRow(area); row.fees += fee;
    row.feeLines.push(`${area}: ${a.small} small × $${R.small}${a.large ? ` + ${a.large} large × $${R.large}` : ""}`); }
  const tge = tgeSouth(d); if (tge) { const row = feeRow("Rural"); row.fees += tge; row.feeLines.push(`TGE South total $${tge.toFixed(2)}`); }
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
      <label class="f" style="flex:1 1 110px">Pick-up small $<input class="in" id="mn-s" inputmode="decimal" value="${R.small}"></label><label class="f" style="flex:1 1 110px">Pick-up large $<input class="in" id="mn-l" inputmode="decimal" value="${R.large}"></label>
      <button class="btn sm" type="submit" style="flex:0 0 auto">Save</button></form>
    <p class="hint">Pick-up fees cover NZ Couriers and Post Haste on Rural, Lawrence and Owaka. TGE goes in as one total for South and sits on the Rural run. Staff cost is each driver's day split across their runs by rostered time.</p></div>`;
}

export function wireMoney(d) {
  $("#mn-f")?.addEventListener("submit", async ev => { ev.preventDefault();
    const tge = { ...(S.set?.tge_south || {}) }; const v = +$("#mn-tge").value || 0; if (v) tge[d] = v; else delete tge[d];
    const rates = { small: +$("#mn-s").value || 0, large: +$("#mn-l").value || 0 };
    const [a, b] = await Promise.all([sb.from("settings").upsert({ key: "tge_south", value: tge }), sb.from("settings").upsert({ key: "money_rates", value: rates })]);
    const err = a.error || b.error; if (err) return toast(err.message, "err");
    S.set.tge_south = tge; S.set.money_rates = rates; toast("Saved", "ok"); render(true); });
}
