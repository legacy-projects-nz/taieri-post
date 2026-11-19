// Income tab (owner only): this month's income by income stream — NZ Post (runs, Lawrence & food bag), TGE, TGE South pick-ups,
// Rural and Owaka PH & NZC pick-ups, D>B other — from the same model as the Live board's Day budget (money.js).
// NZ Post parcels come from the nightly NZ Post email; pick-ups from the Pick-ups log.
//   Done so far   – days up to today: real figures where the EOD / pick-ups are in, the model's estimate where not.
//   Still to come – rostered days ahead use the roster (parcels/pick-ups estimated); days not rostered yet take each run's
//                   average for that weekday from the last 4 rostered weeks. Public holidays earn nothing.
// All figures incl GST (15%), NZD; the excl GST total is shown under them.
import { esc, $, $$, today, addDays, dow, label } from "/shared/core.js";
import { S, render, sheet, loadAll } from "/admin/admin.js";
import { breakdown, isHoliday, model, GST, pickupsReady, loadPickupRange, STREAMS } from "/admin/money.js";

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const m0 = n => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString();
const ym = d => d.slice(0, 7);
const monthDays = m => { const out = []; for (let d = m + "-01"; ym(d) === m; d = addDays(d, 1)) out.push(d); return out; };
const shiftMonth = (m, n) => { let [y, mo] = m.split("-").map(Number); mo += n; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return `${y}-${String(mo).padStart(2, "0")}`; };
const runName = k => { const r = S.runsBy[k]; return r ? (r.label && r.label !== k ? `${k} · ${r.label}` : r.name && r.name !== k ? `${k} · ${r.name}` : k) : k; };
const hasRoster = d => S.shifts.some(s => s.day === d);

const SNAME = Object.fromEntries(STREAMS);
// income per stream for one day: { stream: { fees, est, by: { run or source: $ } } }
function dayIncome(d) {
  const out = {}; for (const r of breakdown(d)) { if (r.sort) continue; for (const l of r.feeLines) { if (!l.amt) continue; const k = l.src || "nzp"; const o = (out[k] ??= { fees: 0, est: false, by: {} });
    const v = l.amt * (1 + GST); o.fees += v; o.est ||= !!l.est; const who = r.noRun ? r.run : runName(r.run); o.by[who] = (o.by[who] || 0) + v; } }
  return out;
}
// a weekday's usual income per run: average of the last 4 past rostered days on that weekday (not public holidays)
const tplCache = {};
function weekdayTemplate(w) {
  if (tplCache[w]) return tplCache[w]; const t = today(); const days = [];
  for (let d = addDays(t, -1); days.length < 4 && d >= addDays(t, -63); d = addDays(d, -1)) if (dow(d) === w && !isHoliday(d) && hasRoster(d)) days.push(d);
  const sum = {}, by = {}; for (const d of days) for (const [k, v] of Object.entries(dayIncome(d))) { sum[k] = (sum[k] || 0) + v.fees; for (const [b, x] of Object.entries(v.by)) { (by[k] ??= {})[b] = (by[k][b] || 0) + x; } }
  const n = days.length || 1; return (tplCache[w] = { days, per: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, { fees: v / n, by: Object.fromEntries(Object.entries(by[k] || {}).map(([b, x]) => [b, x / n])) }])) });
}

function monthModel(m) {
  const t = today(); const days = monthDays(m); for (const k in tplCache) delete tplCache[k];
  const runs = {}; const R = k => (runs[k] ??= { done: 0, doneEst: false, ahead: 0, lines: [], by: {} }); const addBy = (r, by) => { for (const [b, x] of Object.entries(by)) r.by[b] = (r.by[b] || 0) + x; };
  let hol = 0, tplDays = 0;
  for (const d of days) {
    if (isHoliday(d)) { hol++; continue; }
    if (hasRoster(d)) { for (const [k, v] of Object.entries(dayIncome(d))) { const r = R(k); if (d <= t) { r.done += v.fees; r.doneEst ||= v.est; } else r.ahead += v.fees; addBy(r, v.by); r.lines.push({ d, fees: v.fees, est: v.est || d > t, how: d > t ? "rostered" : v.est ? "estimate" : "final" }); } }
    else if (d > t) { const T = weekdayTemplate(dow(d)); if (!T.days.length) continue; tplDays++; for (const [k, v] of Object.entries(T.per)) { const r = R(k); r.ahead += v.fees; addBy(r, v.by); r.lines.push({ d, fees: v.fees, est: true, how: `not rostered yet · average of ${T.days.length} past ${label(d).slice(0, 3)}s` }); } }
  }
  const order = STREAMS.map(([k]) => k); const list = Object.entries(runs).map(([k, r]) => ({ k, ...r, total: r.done + r.ahead })).sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k));
  const tot = list.reduce((a, r) => ({ done: a.done + r.done, ahead: a.ahead + r.ahead, est: a.est || r.doneEst }), { done: 0, ahead: 0, est: false });
  return { m, days, list, tot, hol, tplDays };
}

let cur = null;
export function incomeTab() {
  if (!S.me?.isOwner) return `<div class="card"><p class="meta">Income is for the owner only.</p></div>`;
  const m = S.incMonth || ym(today()); const days = monthDays(m);
  const from = addDays(days[0], -63) < addDays(today(), -63) ? addDays(days[0], -63) : addDays(today(), -63), to = days[days.length - 1];
  if (!pickupsReady(from, to)) { loadPickupRange(from, to); return `<div class="card"><p class="meta">Loading ${MON[+m.slice(5) - 1]}'s income…</p></div>`; }
  const X = cur = monthModel(m); const month = X.tot.done + X.tot.ahead; const t = today();
  const past = m < ym(t), future = m > ym(t);
  const g = (v, est) => `<span class="${est ? "mn-est" : "mn-fin"}">${est ? "≈" : ""}${m0(v)}</span>`;
  return `<style>.mn-est{color:var(--ink3)}.mn-fin{color:var(--ok)}tr.mn-row{cursor:pointer}tr.mn-row:hover td{background:var(--soft)}</style>
  <div class="card"><div class="wkbar"><button class="ar" id="inc-prev" aria-label="Previous month">‹</button><b>${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}</b><button class="ar" id="inc-next" aria-label="Next month">›</button>${m !== ym(t) ? `<button class="btn ghost sm" id="inc-now" style="flex:0 0 auto">This month</button>` : ""}</div>
    <div class="tiles" style="margin-top:10px"><div class="tile"><div class="l">${past ? "Month" : "Month estimate"}</div><div class="v ${past && !X.tot.est ? "mn-fin" : "mn-est"}">${past && !X.tot.est ? "" : "≈"}${m0(month)}</div><div class="s">incl GST · excl GST ${m0(month / (1 + GST))}</div></div>
      ${future ? "" : `<div class="tile"><div class="l">Done so far</div><div class="v">${g(X.tot.done, X.tot.est)}</div><div class="s">${past ? "whole month" : `1–${+t.slice(8)} ${MON[+m.slice(5) - 1].slice(0, 3)}`}</div></div>`}
      ${past ? "" : `<div class="tile"><div class="l">Still to come</div><div class="v mn-est">≈${m0(X.tot.ahead)}</div><div class="s">${X.tplDays ? `${X.tplDays} day${X.tplDays === 1 ? "" : "s"} not rostered yet, from recent weeks` : "from the roster"}</div></div>`}
</div>
    ${X.list.length ? `<div class="scroll" style="margin-top:10px"><table class="dt"><tr><th>Income</th>${future ? "" : `<th align="right">So far</th>`}${past ? "" : `<th align="right">To come</th>`}<th align="right">Month</th><th align="right">Share</th></tr>
      ${X.list.map((r, i) => `<tr class="mn-row" data-incrow="${i}"><td><b>${esc(SNAME[r.k] || r.k)}</b></td>${future ? "" : `<td align="right">${g(r.done, r.doneEst)}</td>`}${past ? "" : `<td align="right">${r.ahead ? g(r.ahead, true) : `<span class="meta">—</span>`}</td>`}<td align="right"><b>${g(r.total, r.doneEst || r.ahead > 0)}</b></td><td align="right" class="meta">${month ? Math.round(r.total / month * 100) : 0}%</td></tr>`).join("")}
      <tr><td><b>Total (incl GST)</b></td>${future ? "" : `<td align="right"><b>${g(X.tot.done, X.tot.est)}</b></td>`}${past ? "" : `<td align="right"><b>${g(X.tot.ahead, true)}</b></td>`}<td align="right"><b>${g(month, X.tot.est || X.tot.ahead > 0)}</b></td><td></td></tr>
      <tr><td class="meta">Excl GST</td>${future ? "" : `<td align="right" class="meta">${m0(X.tot.done / (1 + GST))}</td>`}${past ? "" : `<td align="right" class="meta">${m0(X.tot.ahead / (1 + GST))}</td>`}<td align="right" class="meta">${m0(month / (1 + GST))}</td><td></td></tr></table></div>`
      : `<p class="empty">No income for this month yet.</p>`}
    <p class="hint">Incl GST (15%). Same rates as the Live board's Day budget (Income rates there). <span class="mn-fin">Green</span> = final (EOD and pick-ups in), <span class="mn-est">≈ grey</span> = estimate. Days not rostered yet use each run's average for that weekday from the last 4 weeks${X.hol ? ` · ${X.hol} public holiday${X.hol === 1 ? "" : "s"} this month earn nothing` : ""}. NZ Post parcels come from the nightly NZ Post email (the driver's EOD count until it lands). Tap a line for its runs and days.</p></div>`;
}

export function wireIncome() {
  const go = n => { S.incMonth = n; loadAll().then(() => render()); render(); };
  const m = S.incMonth || ym(today());
  $("#inc-prev")?.addEventListener("click", () => go(shiftMonth(m, -1)));
  $("#inc-next")?.addEventListener("click", () => go(shiftMonth(m, 1)));
  $("#inc-now")?.addEventListener("click", () => go(null));
  $$("[data-incrow]").forEach(tr => tr.onclick = () => { const r = cur?.list[+tr.dataset.incrow]; if (!r) return;
    sheet(`<style>.mn-est{color:var(--ink3)}.mn-fin{color:var(--ok)}</style><h3>${esc(SNAME[r.k] || r.k)}</h3><p class="meta">${MON[+cur.m.slice(5) - 1]} ${cur.m.slice(0, 4)} · incl GST</p>
      <table class="dt" style="width:100%;margin-bottom:10px"><tr><th>Run / source</th><th align="right">Month</th></tr>${Object.entries(r.by).sort((a, b) => b[1] - a[1]).map(([b, x]) => `<tr><td>${esc(b)}</td><td align="right">≈$${Math.round(x).toLocaleString()}</td></tr>`).join("")}</table>
      <table class="dt" style="width:100%"><tr><th>Day</th><th>Basis</th><th align="right">Income</th></tr>${r.lines.map(l => `<tr><td>${label(l.d)}</td><td class="meta">${esc(l.how)}</td><td align="right"><span class="${l.est ? "mn-est" : "mn-fin"}">${l.est ? "≈" : ""}$${l.fees.toFixed(2)}</span></td></tr>`).join("")}
      <tr><td colspan="2"><b>Month (incl GST)</b></td><td align="right"><b>${m0(r.total)}</b></td></tr><tr><td colspan="2" class="meta">Excl GST</td><td align="right" class="meta">${m0(r.total / (1 + GST))}</td></tr></table>
      <p class="hint">Per-day detail (parcels, rates, pick-ups) is on the Live board: pick the day and tap the run in Day budget.</p>`); });
}
