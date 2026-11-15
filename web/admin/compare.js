// Shared filter for Scorecard › Efficiency and › Sorting: pick a date range and one or more drivers to drill down and compare.
// Default = the week on the week bar and everyone. Picking a range further back than the portal has loaded reloads with that range.
import { today, addDays, monOf, label, esc, $, $$ } from "/shared/core.js";
import { fortnight } from "/shared/score.js";
import { S, loadAll, render } from "/admin/admin.js";

export function cmp() { const c = S.cmp ||= { custom: false, from: null, to: null, drv: [] };
  return { from: c.custom ? c.from : S.week, to: c.custom ? c.to : addDays(S.week, 6), drv: c.drv, custom: c.custom }; }
export function cmpDays() { const { from, to } = cmp(); const out = []; for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d); return out; }
export const cmpHas = id => { const d = cmp().drv; return !d.length || d.includes(id); };
const QUICK = [["wk", "Week on bar"], ["lw", "Last week"], ["fn", "Pay fortnight"], ["4w", "Last 4 weeks"], ["8w", "Last 8 weeks"], ["12w", "Last 12 weeks"]];

/** filter card; `pool` = driver ids that have something to show (others are still listed, greyed) */
export function cmpBar(pool) {
  const c = cmp(); const ids = S.drivers.filter(d => d.role !== "owner" || pool.includes(d.id)).map(d => d.id);
  return `<div class="card" id="cmpbar"><h2>Drill down &amp; compare<span>${label(c.from)} – ${label(c.to)} · ${c.drv.length ? `${c.drv.length} driver${c.drv.length > 1 ? "s" : ""} picked` : "everyone"}</span></h2>
    <div class="row" style="gap:6px;flex-wrap:wrap">${QUICK.map(([k, l]) => `<button class="btn ghost sm" data-cq="${k}" style="flex:0 0 auto">${l}</button>`).join("")}</div>
    <div class="row" style="gap:8px;align-items:flex-end"><label class="f" style="flex:0 1 170px">From<input class="in" type="date" id="cmp-from" value="${c.from}"></label><label class="f" style="flex:0 1 170px">To<input class="in" type="date" id="cmp-to" value="${c.to}"></label><button class="btn sm" id="cmp-go" style="flex:0 0 auto">Show</button></div>
    <div class="row" style="gap:4px;flex-wrap:wrap"><button class="chip ${c.drv.length ? "" : "ok"}" data-cd="">Everyone</button>${ids.map(id => `<button class="chip ${c.drv.includes(id) ? "ok" : ""}" data-cd="${esc(id)}" style="${pool.includes(id) ? "" : "opacity:.5"}">${esc(S.peopleBy[id]?.name || id)}</button>`).join("")}</div>
    <p class="hint" style="margin:0">Tap names to pick one or more drivers to compare; tap again to drop them.</p></div>`;
}
async function setRange(from, to) {
  if (!from || !to || from > to) return; const c = S.cmp ||= { drv: [] }; c.custom = true; c.from = from; c.to = to;
  if (!S.cmpFrom || from < S.cmpFrom) { S.cmpFrom = from; await loadAll(); }
  render();
}
export function wireCmp() {
  if (!$("#cmpbar")) return;
  $$("[data-cq]").forEach(b => b.onclick = () => { const t = today(), mon = monOf(t); const k = b.dataset.cq;
    if (k === "wk") { S.cmp.custom = false; render(); return; }
    const F = fortnight(S.week); const r = { lw: [addDays(mon, -7), addDays(mon, -1)], fn: [F.from, F.to], "4w": [addDays(mon, -28), addDays(mon, -1)], "8w": [addDays(mon, -56), addDays(mon, -1)], "12w": [addDays(mon, -84), addDays(mon, -1)] }[k];
    setRange(r[0], r[1]); });
  $("#cmp-go").onclick = () => setRange($("#cmp-from").value, $("#cmp-to").value);
  $$("[data-cd]").forEach(b => b.onclick = () => { const c = S.cmp; const id = b.dataset.cd; c.drv = !id ? [] : c.drv.includes(id) ? c.drv.filter(x => x !== id) : [...c.drv, id]; render(); });
}
/** Monday-starting weeks inside the range */
export function cmpWeeks() { const { from, to } = cmp(); const out = []; for (let w = monOf(from); w <= to; w = addDays(w, 7)) out.push(w); return out; }
