// The four outcomes (Done / Late / Not done / Excuse) used everywhere in the owner portal: one set of buttons, one handler.
// A button carries data-st (the outcome) and data-kind (what it settles) plus that kind's ids:
//   post  → data-key, data-drv            a SOD or EOD
//   add   → data-sid, data-k              an add-on / timed task on a shift
//   alert → data-id                       an open alert
//   chg   → data-items (csv), data-drv    roster changes a driver hasn't confirmed
//   vchk  → data-van, data-wk, data-drv   a weekly vehicle check
//   hz    → data-drv                      a driver's hazard confirmations
// An "All" bar (data-stall) applies one outcome to every item in the same box.
import { sb, q, today, label, esc, first, toast, $$ } from "/shared/core.js";
import { scoreFor, addName } from "/shared/score.js";
import { S, loadAll, render, scoreData, fn } from "/admin/admin.js";

export const ACTS = [["done", "Done", ""], ["late", "Late", "ghost"], ["miss", "Not done", "ghost"], ["exc", "Excuse", "ghost"]];
const ACT_T = Object.fromEntries(ACTS.map(a => [a[0], a[1]]));
const MARK = { done: "ok", late: "late", miss: "miss", exc: "exc" };
export const actBtns = (kind, data) => ACTS.map(([a, t, c]) => `<button type="button" class="btn sm ${c}" data-st="${a}" data-kind="${kind}" ${data}>${t}</button>`).join("");
export const allBar = n => n ? `<div class="row" style="gap:4px;flex-wrap:wrap;align-items:center;margin:6px 0"><span class="meta">All ${n}:</span>${ACTS.map(([a, t]) => `<button type="button" class="btn ghost sm" data-stall="${a}">${t}</button>`).join("")}</div>` : "";
export const keyName = k => S.rules.find(r => r.done_key === k)?.name || addName(k);
export const addKey = (sid, k) => `add|${sid}|${k}`;
/** an add-on that was settled as Not done or Excused: [chip class, text], else null */
export const addMark = (sid, k) => { const m = (S.marks || []).find(m => m.key === addKey(sid, k)); return m?.status === "exc" ? ["exc", "excused"] : m?.status === "miss" ? ["miss", "not done"] : null; };

const now = () => new Date().toISOString();
const base = () => ({ reviewed: true, by_person: S.me.id, at: now() });
const findPost = key => { const [day, drv] = key.split("|"); try { return scoreFor(drv, day, day, scoreData(), S.C).items.find(i => i.key === key); } catch { return null; } };
const postWhat = it => `${it.kind}${it.shift?.run ? ` · ${it.shift.run}` : ""} · ${label(it.day)}`;
const perEvent = () => +(S.C?.rules?.perEvent ?? 5);

/** Settle a list of items with one outcome. Returns how many were settled. */
export async function settle(list, act, note) {
  const ctx = { late: [], pen: [], resolve: new Set(), errs: [] };
  const of = k => list.filter(i => i.kind === k);
  if (of("post").length) await posts(of("post"), act, ctx, note);
  if (of("add").length) await adds(of("add"), act, ctx);
  for (const i of of("alert")) await settleAlert(i, act, ctx, note);
  if (of("chg").length) await changes(of("chg"), act, ctx);
  if (of("vchk").length) await simple(of("vchk"), act, ctx, i => `vchk|${i.wk}|${i.van}`, i => `Weekly vehicle check · ${i.van} · week of ${label(i.wk)}`);
  if (of("hz").length) await simple(of("hz"), act, ctx, i => `hz|${i.drv}|${today().slice(0, 7)}`, () => "Hazard confirmations in the app");
  if (ctx.pen.length) { const { error } = await sb.from("entries").insert(ctx.pen.map(p => ({ driver: p.driver, day: p.day || today(), run: p.run || null, kind: "adjust", title: p.title, note: p.note || null, admin_pts: -perEvent(), show_driver: true, created_by: S.me.id }))); if (error) ctx.errs.push(error.message); }
  if (ctx.resolve.size) { const { error } = await sb.from("alerts").update({ resolved_at: now(), resolved_by: S.me.id }).in("id", [...ctx.resolve]); if (error) ctx.errs.push(error.message); }
  if (ctx.late.length) emailLate(ctx.late);
  if (ctx.errs.length) toast(ctx.errs[0], "err");
  return list.length;
}
const mark = async (rows, ctx) => { if (!rows.length) return; const { error } = await sb.from("marks").upsert(rows); if (error) ctx.errs.push(error.message); };
const openAlerts = f => S.alerts.filter(a => !a.resolved_at && f(a));

/* SOD / EOD: Done = on time, Late and Not done keep the deduction, Excuse removes it */
async function posts(list, act, ctx, note) {
  const NOTE = { done: "Marked done", late: "Marked late", miss: "Marked not done", exc: "Excused" };
  await mark(list.map(i => ({ key: i.key, driver: i.drv || null, status: MARK[act], note: note || NOTE[act], ...base() })), ctx);
  for (const i of list) { const it = findPost(i.key); if (!it) continue;
    if (act === "late") ctx.late.push({ driver: it.driver, what: postWhat(it) });
    const sid = it.shift?.id; const kind = it.kind.toLowerCase(); if (sid) for (const a of openAlerts(a => a.shift_id === sid && a.kind.startsWith(kind))) ctx.resolve.add(a.id); }
}
/* Add-ons and timed tasks: Done ticks it, Late ticks it with the late penalty, Not done carries it to the driver's next day, Excuse clears it */
async function adds(list, act, ctx) {
  const L = list.map(i => ({ s: S.shifts.find(x => x.id === i.sid), k: i.k })).filter(i => i.s && i.k);
  for (const { s } of L) for (const a of openAlerts(a => a.shift_id === s.id && a.kind.startsWith("timing"))) ctx.resolve.add(a.id);
  if (act === "late") { for (const { s, k } of L) { const { error } = await sb.rpc("task_done_late", { p_shift: s.id, p_addon: k, p_name: keyName(k) }); if (error) ctx.errs.push(error.message); else ctx.late.push({ driver: s.driver, what: `${keyName(k)} · ${s.run} · ${label(s.day)}` }); } return; }
  if (act === "done") { const by = {}; for (const { s, k } of L) (by[s.id] ??= { s, ks: [] }).ks.push(k);
    for (const { s, ks } of Object.values(by)) { const done = { ...(s.done || {}) }; for (const k of ks) done[k] = now(); const { error } = await sb.from("shifts").update({ done }).eq("id", s.id); if (error) ctx.errs.push(error.message); else s.done = done; }
    return; }
  await mark(L.map(({ s, k }) => ({ key: addKey(s.id, k), driver: s.driver, status: MARK[act], note: `${act === "miss" ? "Not done" : "Excused"} · ${keyName(k)}`, ...base() })), ctx);
}
/* An alert: a task alert settles the task, an SOD/EOD alert settles the post, a roster-change alert settles the changes; then it's resolved */
async function settleAlert(i, act, ctx, note) {
  const a = S.alerts.find(x => x.id === i.id); if (!a) return; ctx.resolve.add(a.id);
  const sh = a.shift_id ? S.shifts.find(x => x.id === a.shift_id) : null; const r = a.rule_id ? S.rules.find(x => x.id === a.rule_id) : null; const k = r ? (r.done_key || r.addon) : null;
  if (sh && k) { if (!sh.done?.[k]) await adds([{ sid: sh.id, k }], act, ctx); return; }
  if (sh && /^(sod|eod)/.test(a.kind)) { const kind = a.kind.startsWith("sod") ? "SOD" : "EOD"; let its = []; try { its = scoreFor(sh.driver, sh.day, sh.day, scoreData(), S.C).items.filter(x => x.kind === kind && (kind === "SOD" || !x.code || x.code === sh.run)); } catch { }
    if (its.length) await posts(its.map(x => ({ key: x.key, drv: x.driver })), act, ctx, note); return; }
  if (a.kind === "change_unconfirmed" && a.driver) { const ids = unconfirmed(a.driver).map(x => x.id); if (ids.length) { await changes([{ items: ids.join(","), drv: a.driver }], act, ctx); return; } }
  if (a.driver && (act === "late" || act === "miss")) { ctx.pen.push({ driver: a.driver, day: sh?.day, run: sh?.run, title: `${act === "late" ? "Late" : "Not done"} · ${a.title.replace(/^[^:]+: /, "")}` }); if (act === "late") ctx.late.push({ driver: a.driver, what: a.title.replace(/^[^:]+: /, "") }); }
}
/** roster changes sent to a driver that they haven't confirmed (and nobody has dismissed) */
export function unconfirmed(drv) {
  const ack = {}; for (const a of S.acks) if (a.driver === drv) ack[a.item_id] = a;
  return S.items.filter(i => i.roster_changes?.status === "sent" && (i.affects || []).includes(drv) && !ack[i.id]?.confirmed_at && !ack[i.id]?.dismissed_at);
}
/* Roster changes: Done / Late confirm them for the driver, Excuse dismisses them, Not done leaves them for the driver to confirm */
async function changes(list, act, ctx) {
  for (const i of list) { const ids = String(i.items || "").split(",").filter(Boolean); if (!ids.length || !i.drv) continue;
    const patch = act === "done" || act === "late" ? { confirmed_at: now(), confirmed_by: S.me.id } : act === "exc" ? { dismissed_at: now(), confirmed_by: S.me.id } : null;
    if (patch) { const { error } = await sb.from("change_acks").update(patch).in("item_id", ids).eq("driver", i.drv); if (error) ctx.errs.push(error.message); }
    await mark(ids.map(id => ({ key: `chg|${id}|${i.drv}`, driver: i.drv, status: MARK[act], note: `Roster change · ${ACT_T[act]}`, ...base() })), ctx);
    const what = `Confirming ${ids.length === 1 ? "a roster change" : `${ids.length} roster changes`} in the app`;
    if (act === "late" || act === "miss") ctx.pen.push({ driver: i.drv, title: `${act === "late" ? "Late" : "Not done"} · ${what}` });
    if (act === "late") ctx.late.push({ driver: i.drv, what });
    for (const a of openAlerts(a => a.kind === "change_unconfirmed" && a.driver === i.drv)) ctx.resolve.add(a.id); }
}
/* Things with no record of their own to change (vehicle check, hazard confirmations): the outcome is kept as a mark */
async function simple(list, act, ctx, keyOf, whatOf) {
  await mark(list.map(i => ({ key: keyOf(i), driver: i.drv || null, status: MARK[act], note: `${whatOf(i)} · ${ACT_T[act]}`, ...base() })), ctx);
  for (const i of list) if (i.drv) { if (act === "late" || act === "miss") ctx.pen.push({ driver: i.drv, day: i.wk, title: `${act === "late" ? "Late" : "Not done"} · ${whatOf(i)}` }); if (act === "late") ctx.late.push({ driver: i.drv, what: whatOf(i) }); }
}
/** Marked late: one polite email per driver asking for it to be done on time tomorrow */
async function emailLate(list) {
  const by = {}; for (const i of list) if (i.what && i.driver) (by[i.driver] ??= []).push(i.what);
  for (const [drv, items] of Object.entries(by)) {
    const p = S.peopleBy?.[drv] || S.people.find(x => x.id === drv); if (!p?.email) continue; const one = items.length === 1;
    const html = `<p>Hi ${esc(first(p.name))},</p><p>Just a quick note: ${one ? "this was" : "these were"} late:</p><ul>${items.map(w => `<li>${esc(w)}</li>`).join("")}</ul><p>No drama, but could you please make sure ${one ? "it's" : "they're"} completed on time tomorrow? If something got in the way, just let me know.</p><p>Thanks,<br>${esc(first(S.me.name))}<br>Taieri Post Limited</p>`;
    try { await fn("notify", { type: "email", to: p.email, subject: `Taieri Post: ${one ? "one thing" : `${items.length} things`} done late`, html }); } catch { toast(`Email to ${first(p.name)} failed`, "err"); }
  }
}

/* ---------- one click handler for every four-option button in the portal ---------- */
const itemOf = b => ({ kind: b.dataset.kind, key: b.dataset.key, drv: b.dataset.drv, sid: b.dataset.sid, k: b.dataset.k, id: b.dataset.id, items: b.dataset.items, van: b.dataset.van, wk: b.dataset.wk });
const sigOf = i => [i.kind, i.key, i.sid, i.k, i.id, i.items, i.van, i.wk, i.kind === "post" ? "" : i.drv].join("~");
async function after(b) {
  const sheetBg = b.closest(".sheet-bg");
  await loadAll(); render();
  if (sheetBg?.isConnected) { if (sheetBg._reopen) { sheetBg.remove(); sheetBg._reopen(); } else sheetBg._close ? sheetBg._close() : sheetBg.remove(); }
}
document.addEventListener("click", async e => {
  const b = e.target.closest?.("[data-st],[data-stall]"); if (!b || b.disabled) return;
  e.preventDefault(); e.stopPropagation();
  try {
    if (b.dataset.stall) {
      const act = b.dataset.stall; const t0 = b.dataset.t0 || (b.dataset.t0 = b.textContent);
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = `Tap again: all ${t0}`; b.classList.add("warn"); setTimeout(() => { if (b.isConnected) { b.dataset.sure = ""; b.textContent = t0; b.classList.remove("warn"); } }, 4000); return; }
      const box = b.closest(".card,.sheet") || document; const seen = new Set(); const list = [];
      box.querySelectorAll(`[data-st="${act}"]`).forEach(x => { const i = itemOf(x); const s = sigOf(i); if (!seen.has(s)) { seen.add(s); list.push(i); } });
      b.disabled = true; const n = await settle(list, act); toast(`${n} · ${ACT_T[act]}`, "ok"); await after(b); return;
    }
    const act = b.dataset.st; const note = b.closest(".sheet")?.querySelector("#mnote")?.value || undefined;
    b.closest(".row")?.querySelectorAll("[data-st]").forEach(x => x.disabled = true);
    await settle([itemOf(b)], act, note); toast(ACT_T[act], "ok"); await after(b);
  } catch (err) { console.error(err); toast(err?.message || "That didn't save", "err"); b.disabled = false; }
}, true);
