// Income tab (owner only): this month's income run by run, from the same model as the Live board's Day budget (money.js).
//   Done so far   – days up to today: real figures where the EOD / pick-ups are in, the model's estimate where not.
//   Still to come – rostered days ahead use the roster (parcels/pick-ups estimated); days not rostered yet take each run's
//                   average for that weekday from the last 4 rostered weeks. Public holidays earn nothing.
// All figures excl GST, NZD.
import { esc, $, $$, today, addDays, dow, label } from "/shared/core.js";
import { S, render, sheet, loadAll } from "/admin/admin.js";
import { breakdown, isHoliday, model, GST, pickupsReady, loadPickupRange } from "/admin/money.js";

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const m0 = n => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString();
const ym = d => d.slice(0, 7);
const monthDays = m => { const out = []; for (let d = m + "-01"; ym(d) === m; d = addDays(d, 1)) out.push(d); return out; };
const shiftMonth = (m, n) => { let [y, mo] = m.split("-").map(Number); mo += n; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return `${y}-${String(mo).padStart(2, "0")}`; };
const runName = k => { const r = S.runsBy[k]; return r ? (r.label && r.label !== k ? `${k} · ${r.label}` : r.name && r.name !== k ? `${k} · ${r.name}` : k) : k; };
const hasRoster = d => S.shifts.some(s => s.day === d);

// income per run for one day: { run: { fees, est } } (sort rows and pay-only rows left out)
function dayIncome(d) {
  const out = {}; for (const r of breakdown(d)) { if (r.sort || !r.fees) continue; const o = (out[r.run] ??= { fees: 0, est: false }); o.fees += r.fees; o.est ||= !!r.feeEst; }
  return out;
}
// a weekday's usual income per run: average of the last 4 past rostered days on that weekday (not public holidays)
const tplCache = {};
function weekdayTemplate(w) {
  if (tplCache[w]) return tplCache[w]; const t = today(); const days = [];
  for (let d = addDays(t, -1); days.length < 4 && d >= addDays(t, -63); d = addDays(d, -1)) if (dow(d) === w && !isHoliday(d) && hasRoster(d)) days.push(d);
  const sum = {}; for (const d of days) for (const [k, v] of Object.entries(dayIncome(d))) sum[k] = (sum[k] || 0) + v.fees;
  return (tplCache[w] = { days, per: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / (days.length || 1)])) });
}

function monthModel(m) {
  const t = today(); const days = monthDays(m); for (const k in tplCache) delete tplCache[k];
  const runs = {}; const R = k => (runs[k] ??= { done: 0, doneEst: false, ahead: 0, lines: [] });
  let hol = 0, tplDays = 0;
  for (const d of days) {
    if (isHoliday(d)) { hol++; continue; }
    if (hasRoster(d)) { for (const [k, v] of Object.entries(dayIncome(d))) { const r = R(k); if (d <= t) { r.done += v.fees; r.doneEst ||= v.est; } else r.ahead += v.fees; r.lines.push({ d, fees: v.fees, est: v.est || d > t, how: d > t ? "rostered" : v.est ? "estimate" : "final" }); } }
    else if (d > t) { const T = weekdayTemplate(dow(d)); if (!T.days.length) continue; tplDays++; for (const [k, v] of Object.entries(T.per)) { const r = R(k); r.ahead += v; r.lines.push({ d, fees: v, est: true, how: `not rostered yet · average of ${T.days.length} past ${label(d).slice(0, 3)}s` }); } }
  }
  const list = Object.entries(runs).map(([k, r]) => ({ k, ...r, total: r.done + r.ahead })).sort((a, b) => b.total - a.total);
  const tot = list.reduce((a, r) => ({ done: a.done + r.done, ahead: a.ahead + r.ahead, est: a.est || r.doneEst }), { done: 0, ahead: 0, est: false });
  return { m, days, list, tot, hol, tplDays };
}

let cur = null;
export function incomeTab() {
  if (!S.me?.isOwner) return `<div class="card"><p class="meta">Income is for the owner only.</p></div>`;
  const m = S.incMonth || ym(today()); const days = monthDays(m);
  const from = addDays(days[0], -63) < addDays(today(), -63) ? addDays(days[0], -63) : addDays(today(), -63), to = days[days.length - 1];
  if (!pickupsReady(from, to)) { loadPickupRange(from, to); return `<div class="card"><p class="meta">Loading ${MON[+m.slice(5) - 1]}'s income…</p></div>`; }
  const X = cur = monthModel(m); const M = model(); const month = X.tot.done + X.tot.ahead; const t = today();
  const past = m < ym(t), future = m > ym(t);
  const g = (v, est) => `<span class="${est ? "mn-est" : "mn-fin"}">${est ? "≈" : ""}${m0(v)}</span>`;
  return `<style>.mn-est{color:var(--ink3)}.mn-fin{color:var(--ok)}tr.mn-row{cursor:pointer}tr.mn-row:hover td{background:var(--soft)}</style>
  <div class="card"><div class="wkbar"><button class="ar" id="inc-prev" aria-label="Previous month">‹</button><b>${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}</b><button class="ar" id="inc-next" aria-label="Next month">›</button>${m !== ym(t) ? `<button class="btn ghost sm" id="inc-now" style="flex:0 0 auto">This month</button>` : ""}</div>
    <div class="tiles" style="margin-top:10px"><div class="tile"><div class="l">${past ? "Month" : "Month estimate"}</div><div class="v ${past && !X.tot.est ? "mn-fin" : "mn-est"}">${past && !X.tot.est ? "" : "≈"}${m0(month)}</div><div class="s">+ GST ${m0(month * GST)} = ${m0(month * (1 + GST))}</div></div>
      ${future ? "" : `<div class="tile"><div class="l">Done so far</div><div class="v">${g(X.tot.done, X.tot.est)}</div><div class="s">${past ? "whole month" : `1–${+t.slice(8)} ${MON[+m.slice(5) - 1].slice(0, 3)}`}</div></div>`}
      ${past ? "" : `<div class="tile"><div class="l">Still to come</div><div class="v mn-est">≈${m0(X.tot.ahead)}</div><div class="s">${X.tplDays ? `${X.tplDays} day${X.tplDays === 1 ? "" : "s"} not rostered yet, from recent weeks` : "from the roster"}</div></div>`}
      <div class="tile"><div class="l">Target</div><div class="v">${m0(M.target)}</div><div class="s ${month >= M.target ? "c-ok" : "c-crit"}">${month >= M.target ? "+" : "−"}${m0(Math.abs(month - M.target))}</div></div></div>
    ${X.list.length ? `<div class="scroll" style="margin-top:10px"><table class="dt"><tr><th>Run</th>${future ? "" : `<th align="right">So far</th>`}${past ? "" : `<th align="right">To come</th>`}<th align="right">Month</th><th align="right">Share</th></tr>
      ${X.list.map((r, i) => `<tr class="mn-row" data-incrow="${i}"><td><b>${esc(runName(r.k))}</b></td>${future ? "" : `<td align="right">${g(r.done, r.doneEst)}</td>`}${past ? "" : `<td align="right">${r.ahead ? g(r.ahead, true) : `<span class="meta">—</span>`}</td>`}<td align="right"><b>${g(r.total, r.doneEst || r.ahead > 0)}</b></td><td align="right" class="meta">${month ? Math.round(r.total / month * 100) : 0}%</td></tr>`).join("")}
      <tr><td><b>Total (excl GST)</b></td>${future ? "" : `<td align="right"><b>${g(X.tot.done, X.tot.est)}</b></td>`}${past ? "" : `<td align="right"><b>${g(X.tot.ahead, true)}</b></td>`}<td align="right"><b>${g(month, X.tot.est || X.tot.ahead > 0)}</b></td><td></td></tr>
      <tr><td class="meta">Incl GST</td>${future ? "" : `<td align="right" class="meta">${m0(X.tot.done * (1 + GST))}</td>`}${past ? "" : `<td align="right" class="meta">${m0(X.tot.ahead * (1 + GST))}</td>`}<td align="right" class="meta">${m0(month * (1 + GST))}</td><td></td></tr></table></div>`
      : `<p class="empty">No income for this month yet.</p>`}
    <p class="hint">Excl GST. Same rates as the Live board's Day budget (Income rates there). <span class="mn-fin">Green</span> = final (EOD and pick-ups in), <span class="mn-est">≈ grey</span> = estimate. Days not rostered yet use each run's average for that weekday from the last 4 weeks${X.hol ? ` · ${X.hol} public holiday${X.hol === 1 ? "" : "s"} this month earn nothing` : ""}. Tap a run for its days.</p></div>`;
}

export function wireIncome() {
  const go = n => { S.incMonth = n; loadAll().then(() => render()); render(); };
  const m = S.incMonth || ym(today());
  $("#inc-prev")?.addEventListener("click", () => go(shiftMonth(m, -1)));
  $("#inc-next")?.addEventListener("click", () => go(shiftMonth(m, 1)));
  $("#inc-now")?.addEventListener("click", () => go(null));
  $$("[data-incrow]").forEach(tr => tr.onclick = () => { const r = cur?.list[+tr.dataset.incrow]; if (!r) return;
    sheet(`<style>.mn-est{color:var(--ink3)}.mn-fin{color:var(--ok)}</style><h3>${esc(runName(r.k))}</h3><p class="meta">${MON[+cur.m.slice(5) - 1]} ${cur.m.slice(0, 4)} · excl GST</p>
      <table class="dt" style="width:100%"><tr><th>Day</th><th>Basis</th><th align="right">Income</th></tr>${r.lines.map(l => `<tr><td>${label(l.d)}</td><td class="meta">${esc(l.how)}</td><td align="right"><span class="${l.est ? "mn-est" : "mn-fin"}">${l.est ? "≈" : ""}$${l.fees.toFixed(2)}</span></td></tr>`).join("")}
      <tr><td colspan="2"><b>Month</b></td><td align="right"><b>${m0(r.total)}</b></td></tr></table>
      <p class="hint">Per-day detail (parcels, rates, pick-ups) is on the Live board: pick the day and tap the run in Day budget.</p>`); });
}
