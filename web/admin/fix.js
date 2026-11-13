// Fix posts tab: everything that was missed, late or left undone, in one place. Every item gets the same four outcomes
// (Done / Late / Not done / Excuse), one at a time or for a whole box. The buttons and what they do live in settle.js.
import { needsConfirm, sb, q, nzNow, today, addDays, dayName, dow, monOf, label, toMin, fmtT, fmt24, nzToIso, esc, $, $$, toast, first, ago } from "/shared/core.js";
import { scoreFor, itemNote, STATE_LABEL, needsFix } from "/shared/score.js";
import { S, sheet, nm, weekBar, wireWeek, loadAll, render, scoreData, alertsTab, wireAlerts } from "/admin/admin.js";
import { chip, eodEdit } from "/admin/scorecard.js";
import { actBtns, allBar, keyName, addKey } from "/admin/settle.js";

let both = true; // show last week as well as the week on screen
const range = () => ({ from: both ? addDays(S.week, -7) : S.week, to: addDays(S.week, 6) });
const decided = p => new Set((S.marks || []).filter(m => m.key?.startsWith(p) && m.status).map(m => m.key));
const HINT = `<b>Done</b> clears it. <b>Late</b> clears it, records the late penalty and sends the driver a polite email. <b>Not done</b> records it as missed. <b>Excuse</b> clears it with nothing against the driver.`;
const btnRow = html => `<span class="row" style="flex:0;gap:4px;flex-wrap:wrap;justify-content:flex-end">${html}</span>`;
const byDay = (L, dayOf) => { const by = {}; for (const i of L) (by[dayOf(i)] ??= []).push(i); return Object.entries(by); };

/* ---------- 1. SOD / EOD ---------- */
function todo() {
  const { from, to } = range(); const D = scoreData(); const out = [];
  for (const d of S.drivers) {
    const s = scoreFor(d.id, from, to, D, S.C);
    for (const it of s.items) {
      if (it.pre || (it.mark?.reviewed && it.mark?.status)) continue;   // already decided
      const bad = it.st === "miss" || it.st === "part" || it.st === "over" || (it.st === "late" && !it.mark?.reviewed);
      if (bad && needsFix(it, S.C)) out.push(it);
    }
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || nm(a.driver).localeCompare(nm(b.driver)));
}
function postSection() {
  const L = todo(); const miss = L.filter(i => i.st === "miss").length, part = L.filter(i => i.st === "part").length, late = L.filter(i => i.st === "late").length;
  return `<div class="card"><h2>SOD / EOD<span>${L.length ? `${miss} missing · ${part} incomplete · ${late} late` : "all clear"}</span></h2>
    <p class="hint">Every SOD or EOD that is missing, incomplete or late (an EOD up to ${Math.round((S.C.rules.eodFixGrace ?? 90) / 6) / 10} h late is left off). <b>Fix</b> opens an editor to add or correct the post. ${HINT}</p>${allBar(L.length)}
    ${byDay(L, i => i.day).map(([day, items]) => `<h4 style="margin:12px 0 4px">${label(day, true)}</h4><div class="list">${items.map(it => `<div class="item ${it.st === "miss" || it.st === "over" ? "crit" : "warn"}"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><span><b>${esc(nm(it.driver))}</b> · ${chip(it)}<span class="meta"> ${esc(STATE_LABEL[it.st])}</span></span>${btnRow(`<button class="btn sm" data-fx="fix" data-key="${esc(it.key)}">Fix</button><button class="btn sm ghost" data-fxshift="${it.driver}|${it.day}" title="Edit or delete this driver's shifts that day">Shifts</button>${actBtns("post", `data-key="${esc(it.key)}" data-drv="${esc(it.driver)}"`)}`)}</div></div>`).join("")}</div>`).join("") || `<p class="empty">✓ Nothing to fix.</p>`}</div>`;
}

/* ---------- 2. Add-ons and tasks not ticked on a finished shift ---------- */
function addTodo() {
  const { from, to } = range(); const t = today(); const out = []; const dec = decided("add|");
  for (const s of S.shifts) {
    if (!s.driver || s.run === "BU" || s.day < from || s.day > to || s.day > t) continue;
    if (s.day === t && !S.eodBy?.[s.id]) continue;   // still running today
    const sat = dayName(s.day) === "Sat";
    const keys = new Set([...(s.addons || []), ...S.addons.filter(a => a.always && a.runs.includes(s.run) && !(sat && a.no_saturday)).map(a => a.id)]);
    for (const r of S.rules) if (r.active && r.done_key && keys.has(r.addon) && r.runs.includes(s.run) && r.days.includes(dow(s.day) + 1)) keys.add(r.done_key);   // e.g. Owaka Medical drop-off
    for (const k of keys) if (!s.done?.[k] && !dec.has(addKey(s.id, k))) out.push({ s, k });
  }
  return out.sort((a, b) => b.s.day.localeCompare(a.s.day) || nm(a.s.driver).localeCompare(nm(b.s.driver)));
}
function addSection() {
  const L = addTodo();
  return `<div class="card"><h2>Add-ons not done<span>${L.length || "all clear"}</span></h2><p class="hint">${HINT} A <b>Not done</b> task goes to the top of the driver's app in red the next day, to do before their SOD.</p>${allBar(L.length)}
    ${byDay(L, i => i.s.day).map(([day, items]) => `<h4 style="margin:12px 0 4px">${label(day, true)}</h4><div class="list">${items.map(({ s, k }) => `<div class="item warn"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><span><b>${esc(nm(s.driver))}</b> · ${esc(s.run)}<span class="meta"> ${esc(keyName(k))}</span></span>${btnRow(actBtns("add", `data-sid="${s.id}" data-k="${esc(k)}"`))}</div></div>`).join("")}</div>`).join("") || `<p class="empty">✓ Nothing to fix.</p>`}</div>`;
}

/* ---------- 3. Roster changes a driver hasn't confirmed ---------- */
function chgTodo() {
  const dec = decided("chg|"); const ack = {}; for (const a of S.acks || []) (ack[a.item_id] ??= {})[a.driver] = a; const by = {};
  for (const i of S.items || []) { if (i.roster_changes?.status !== "sent" || !needsConfirm(i)) continue;
    for (const d of i.affects || []) { const a = ack[i.id]?.[d]; if (a?.confirmed_at || a?.dismissed_at || dec.has(`chg|${i.id}|${d}`)) continue; (by[d] ??= []).push(i); } }
  return Object.entries(by).map(([d, L]) => ({ d, L })).sort((a, b) => nm(a.d).localeCompare(nm(b.d)));
}
function chgSection() {
  const L = chgTodo();
  return `<div class="card"><h2>Shift &amp; van changes not confirmed<span>${L.length || "all clear"}</span></h2><p class="hint">${HINT} <b>Done</b> and <b>Late</b> confirm the changes for the driver; <b>Not done</b> leaves them for the driver to confirm.</p>${allBar(L.length)}
    ${L.length ? `<div class="list">${L.map(({ d, L }) => `<div class="item warn"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><span><b>${esc(nm(d))}</b><span class="meta"> ${L.length} change${L.length > 1 ? "s" : ""} · sent ${ago(L[0].roster_changes.sent_at)}</span></span>${btnRow(actBtns("chg", `data-drv="${esc(d)}" data-items="${L.map(i => i.id).join(",")}"`))}</div><ul style="margin:4px 0;padding-left:18px" class="meta">${L.slice(0, 6).map(i => `<li>${label(i.day)} · ${esc(i.summary || "")}</li>`).join("")}${L.length > 6 ? `<li>+${L.length - 6} more</li>` : ""}</ul></div>`).join("")}</div>` : `<p class="empty">✓ Nothing to fix.</p>`}</div>`;
}

/* ---------- 4. Weekly vehicle checks not done ---------- */
function vchkTodo() {
  const { from, to } = range(); const n = nzNow(); const t = n.date; const R = S.C.rules; const dec = decided("vchk|"); const out = [];
  for (let wk = monOf(from); wk <= to && wk <= t; wk = addDays(wk, 7)) {
    const cur = wk === monOf(t); const due = !cur || dow(t) + 1 > R.vchkDay || (dow(t) + 1 === R.vchkDay && n.min >= (toMin(R.vchkTime) ?? 1020)); if (!due) continue;
    for (const v of (S.vans || []).filter(v => v.active && v.plate !== "OTHER")) {
      if ((S.vchk || []).some(c => c.van === v.plate && c.week_start === wk) || dec.has(`vchk|${wk}|${v.plate}`)) continue;
      const sh = S.shifts.filter(s => s.van === v.plate && s.driver && s.day >= wk && s.day <= addDays(wk, 6) && s.day <= t); if (!sh.length) continue;
      const cnt = {}; for (const s of sh) cnt[s.driver] = (cnt[s.driver] || 0) + 1; const drv = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
      out.push({ wk, van: v.plate, drv });
    }
  }
  return out.sort((a, b) => b.wk.localeCompare(a.wk) || a.van.localeCompare(b.van));
}
function vchkSection() {
  const L = vchkTodo();
  return `<div class="card"><h2>Vehicle checks not done<span>${L.length || "all clear"}</span></h2><p class="hint">Weekly check due Thursday ${esc(S.C.rules.vchkTime || "17:00")}. It goes against the driver who had the van most that week. ${HINT}</p>${allBar(L.length)}
    ${L.length ? `<div class="list">${L.map(i => `<div class="item warn"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><span><b>${esc(i.van)}</b> · ${esc(nm(i.drv))}<span class="meta"> week of ${label(i.wk)}</span></span>${btnRow(actBtns("vchk", `data-van="${esc(i.van)}" data-wk="${i.wk}" data-drv="${esc(i.drv)}"`))}</div></div>`).join("")}</div>` : `<p class="empty">✓ Nothing to fix.</p>`}</div>`;
}

/* ---------- 5. Hazards a driver hasn't confirmed in the app (last 30 days) ---------- */
function hzTodo() {
  const iso = d => d.toISOString().slice(0, 10); const t = new Date(); const from = iso(new Date(t - 30 * 86400e3)), to = iso(new Date(+t + 14 * 86400e3)); const dec = decided("hz|"); const ym = today().slice(0, 7);
  const ack = {}; for (const a of S.hzAcks || []) ack[a.hazard_id + "|" + a.driver] = a.acked_at;
  const open = (S.hazards || []).filter(h => !h.resolved_at && h.severity !== "low");
  return (S.drivers || []).filter(d => d.role !== "owner" && !dec.has(`hz|${d.id}|${ym}`)).map(d => {
    const runs = new Set(S.shifts.filter(s => s.driver === d.id && s.day >= from && s.day <= to).map(s => s.run));
    const mine = open.filter(h => (h.runs || []).some(r => runs.has(r)));
    const ok = mine.filter(h => { const a = ack[h.id + "|" + d.id]; return a && a >= (h.updated_at || h.created_at) && Date.now() - new Date(a) < 30 * 86400e3; });
    return { d, n: mine.length, left: mine.length - ok.length };
  }).filter(r => r.left > 0).sort((a, b) => b.left - a.left);
}
function hzSection() {
  const L = hzTodo();
  return `<div class="card"><h2>Hazards not confirmed<span>${L.length || "all clear"}</span></h2><p class="hint">Drivers confirm the hazards on their runs in the app each month. ${HINT}</p>${allBar(L.length)}
    ${L.length ? `<div class="list">${L.map(r => `<div class="item warn"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><span><b>${esc(r.d.name)}</b><span class="meta"> ${r.left} of ${r.n} not confirmed</span></span>${btnRow(actBtns("hz", `data-drv="${esc(r.d.id)}"`))}</div></div>`).join("")}</div>` : `<p class="empty">✓ Nothing to fix.</p>`}</div>`;
}

const SECTIONS = [["SOD / EOD", postSection], ["Add-ons", addSection], ["Roster changes", chgSection], ["Vehicle checks", vchkSection], ["Hazards", hzSection], ["Alerts", alertsTab]];
export function fixCount() { try { return todo().filter(i => i.st === "miss" || i.st === "part").length + addTodo().length + chgTodo().length + vchkTodo().length; } catch { return 0; } }

export function fixTab() {
  return `${weekBar(`<label class="chk ${both ? "on" : ""}"><input type="checkbox" id="fx-both" ${both ? "checked" : ""}>include last week</label>`)}
    ${SECTIONS.map(([name, f]) => { try { return f(); } catch (e) { console.error(name, e); return `<div class="card"><h2>${name}</h2><p class="hint">This box couldn't be shown: ${esc(e?.message || e)}</p></div>`; } }).join("")}`;
}

function findItem(key) {
  const [day, drv] = key.split("|"); const s = scoreFor(drv, day, day, scoreData(), S.C); return s.items.find(i => i.key === key);
}

export function wireFix() {
  wireWeek(); wireAlerts();
  $("#fx-both")?.addEventListener("change", e => { both = e.target.checked; render(); });
  $$("[data-fxshift]").forEach(b => b.onclick = () => { const [drv, day] = b.dataset.fxshift.split("|"); shiftSheet(drv, day); });
  $$('[data-fx="fix"]').forEach(b => b.onclick = () => { const it = findItem(b.dataset.key); if (it) it.kind === "SOD" ? sodSheet(it) : eodFix(it); });
}

/** Outcome picker shown on each fix form: once filled in, the item leaves the list either excused or logged as an admin error */
const OUTCOME = `<label class="f full">Once saved<select class="in" id="oc"><option value="exc">Excuse it: no deduction</option><option value="err">Record as admin error: deduction stays, logged on the driver's record</option></select></label>`;
async function settle(it, oc, what) {
  if (!oc) return; await loadAll(); const cur = findItem(it.key);
  if (!cur || cur.st === "ok" || cur.st === "exc" || cur.st === "part" || cur.st === "due" || cur.st === "wait") return;   // fixed properly (nothing to excuse) or still incomplete (stays on the list)
  const at = new Date().toISOString();
  await q(sb.from("marks").upsert({ key: it.key, driver: it.driver, reviewed: true, by_person: S.me.id, at, ...(oc === "exc" ? { status: "exc", note: `Excused after fix (${what})` } : { note: `Admin error recorded (${what})` }) }));
  if (oc === "err") await sb.from("entries").insert({ driver: it.driver, day: it.day, run: it.shift?.run || null, kind: "adjust", title: `Admin error · ${what}`, note: `${what} filled in by ${first(S.me.name)} in Fix posts`, admin_pts: 0, show_driver: false, created_by: S.me.id });
}

/** SOD: add one, or change the time they started, van, km and note */
function sodSheet(it) {
  const row = it.row; const sh = it.shift; const sm = row ? nzNow(new Date(row.sent_at)).min : null;
  const vans = S.vans.filter(v => v.active);
  sheet(`<h3>${row ? "Fix" : "Add"} SOD · ${esc(nm(it.driver))}</h3><p class="hint">${label(it.day, true)}${sh ? ` · ${esc(S.runsBy[sh.run]?.label || sh.run)}` : ""} · use the time they actually started. ${row ? `It was sent at ${fmtT(sm)}.` : "It will still count as late if it is after the due time."}</p>
    <form class="frm" id="sf"><label class="f">Start time<input class="in" type="time" id="tm" value="${sm != null ? fmt24(sm) : (it.due - S.C.rules.sodGrace) > 0 ? fmt24(it.due - S.C.rules.sodGrace) : ""}" required></label>
    <label class="f">Van<select class="in" id="van"><option value="">—</option>${vans.map(v => `<option value="${esc(v.plate)}" ${row?.van === v.plate || (!row && sh?.van === v.plate) ? "selected" : ""}>${esc(v.plate)}</option>`).join("")}</select></label>
    <label class="f">Start km<input class="in" id="km" type="number" inputmode="numeric" value="${row?.start_km ?? ""}"></label>
    <label class="f">Run ID<input class="in" id="rid" value="${esc(row?.run_id || "")}"></label>
    <label class="f full">Note<input class="in" id="nt" value="${esc(row?.note || "")}" placeholder="e.g. told me by text"></label>
    ${OUTCOME}<button class="btn full" type="submit">Save</button></form>`, (bg, close) => {
    bg.querySelector("#sf").onsubmit = async e => { e.preventDefault(); const g = x => bg.querySelector("#" + x).value; const at = nzToIso(it.day, g("tm"));
      const vals = { van: g("van") || null, start_km: g("km") ? +g("km") : null, run_id: g("rid") || null, note: g("nt") || (row ? row.note : `Entered by ${first(S.me.name)}`) };
      const { error } = row ? await sb.from("sod").update({ sent_at: at, edited_at: new Date().toISOString(), ...vals }).eq("shift_id", row.shift_id) : await sb.from("sod").insert({ shift_id: sh.id, driver: it.driver, sent_at: at, ...vals });
      if (error) return toast(error.message, "err"); const oc = g("oc"); close(); toast("SOD saved", "ok"); await loadAll(); await settle(it, oc, "SOD"); await loadAll(); render(); };
  });
}

/** EOD: add one for the driver, or edit the figures on theirs */
function eodFix(it) {
  if (it.row) { eodEdit(it.row, { extra: OUTCOME, after: oc => settle(it, oc, "EOD") }); return; }
  const sh = it.shift; const code = sh?.run || ""; const tge = /^(S|T)$/.test(code);
  sheet(`<h3>Add EOD · ${esc(code)} · ${esc(nm(it.driver))}</h3><p class="hint">${label(it.day, true)} · use the time they actually finished. You can fill in the rest afterwards with Fix.</p>
    <form class="frm" id="ef2"><label class="f">Finish time<input class="in" type="time" id="tm" required></label>
    <label class="f">${tge ? "Delivery total" : "Total parcels"}<input class="in" id="p" type="number" inputmode="numeric"></label>
    <label class="f">${tge ? "Jobs" : "Stops"}<input class="in" id="s" type="number" inputmode="numeric"></label>
    <label class="f full">Note<input class="in" id="nt" placeholder="e.g. told me by text"></label>${OUTCOME}<button class="btn full" type="submit">Save</button></form>`, (bg, close) => {
    bg.querySelector("#ef2").onsubmit = async e => { e.preventDefault(); const g = x => bg.querySelector("#" + x).value; const t = g("tm");
      const { error } = await sb.from("eod").insert({ shift_id: sh.id, driver: it.driver, sent_at: nzToIso(it.day, t), finish_time: t, parcels: g("p") ? +g("p") : null, stops: g("s") ? +g("s") : null, note: g("nt") || `Entered by ${first(S.me.name)}` });
      if (error) return toast(error.message, "err"); const oc = g("oc"); close(); toast("EOD saved", "ok"); await loadAll(); await settle(it, oc, "EOD"); await loadAll(); render(); };
  });
}

/** Shifts: edit the run, driver and times of a driver's shifts on a day, or delete one (its SOD, EOD and breaks go with it) */
const hm = t => t ? String(t).slice(0, 5) : "";
function shiftSheet(drv, day) {
  const list = S.shifts.filter(x => x.day === day && x.driver === drv && x.run !== "BU").sort((a, b) => hm(a.start_at).localeCompare(hm(b.start_at)));
  const runs = S.runs.filter(r => r.code !== "BU" && r.active !== false); const ppl = S.drivers;
  const posts = x => [S.sodBy?.[x.id] || S.sods?.find(o => o.shift_id === x.id) ? "SOD" : "", S.eodBy?.[x.id] ? "EOD" : ""].filter(Boolean).join(" + ");
  const row = x => `<div class="item" data-sh="${x.id}"><div class="row" style="gap:6px;align-items:flex-end;flex-wrap:wrap">
    <label class="f" style="flex:1 1 110px">Run<select class="in" data-k="run">${runs.map(r => `<option value="${esc(r.code)}" ${r.code === x.run ? "selected" : ""}>${esc(r.code)}${r.label ? " · " + esc(r.label) : ""}</option>`).join("")}</select></label>
    <label class="f" style="flex:1 1 120px">Driver<select class="in" data-k="driver">${ppl.map(p => `<option value="${esc(p.id)}" ${p.id === x.driver ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <label class="f" style="flex:1 1 90px">Start<input class="in" type="time" data-k="start_at" value="${hm(x.start_at)}"></label>
    <label class="f" style="flex:1 1 90px">Finish<input class="in" type="time" data-k="end_at" value="${hm(x.end_at)}"></label></div>
    <div class="row" style="justify-content:space-between;align-items:center;margin-top:6px"><span class="meta">${posts(x) ? `has ${posts(x)}` : "no posts"}</span>
    <span class="row" style="flex:0;gap:4px"><button class="btn sm" type="button" data-shsave="${x.id}">Save</button><button class="btn sm ghost" type="button" data-shdel="${x.id}">Delete</button></span></div></div>`;
  sheet(`<h3>Shifts · ${esc(nm(drv))}</h3><p class="hint">${label(day, true)} · change the run, driver or times, or delete a shift. Deleting a shift also deletes its SOD, EOD and breaks.</p>
    <div class="list">${list.length ? list.map(row).join("") : `<p class="empty">No shifts that day.</p>`}</div>`, (bg, close) => {
    bg.querySelectorAll("[data-shsave]").forEach(b => b.onclick = async () => { const box = b.closest("[data-sh]"); const v = k => box.querySelector(`[data-k="${k}"]`).value;
      const upd = { run: v("run"), driver: v("driver"), start_at: v("start_at") || null, end_at: v("end_at") || null };
      if (upd.start_at && upd.end_at && upd.end_at <= upd.start_at) return toast("Finish has to be after the start", "err");
      b.disabled = true; const { error } = await sb.from("shifts").update(upd).eq("id", b.dataset.shsave); b.disabled = false;
      if (error) return toast(error.message, "err"); toast("Shift saved", "ok"); close(); await loadAll(); render(); });
    bg.querySelectorAll("[data-shdel]").forEach(b => b.onclick = async () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to delete"; b.classList.add("warn"); setTimeout(() => { if (b.isConnected) { b.dataset.sure = ""; b.textContent = "Delete"; b.classList.remove("warn"); } }, 4000); return; }
      b.disabled = true; const { error } = await sb.rpc("shift_delete", { p_id: b.dataset.shdel });
      if (error) { b.disabled = false; return toast(error.message, "err"); } toast("Shift deleted", "ok"); close(); await loadAll(); render(); });
  });
}
