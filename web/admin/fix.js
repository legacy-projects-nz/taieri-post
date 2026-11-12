// Fix posts tab: every missed / late / incomplete SOD and EOD in one list, each with a one-tap fix.
import { sb, q, nzNow, today, addDays, dayName, dow, label, fmtT, fmt24, nzToIso, esc, $, $$, toast, first } from "/shared/core.js";
import { scoreFor, itemNote, STATE_LABEL, needsFix, addName } from "/shared/score.js";
import { S, sheet, nm, weekBar, wireWeek, loadAll, render, scoreData, alertsTab, wireAlerts } from "/admin/admin.js";
import { chip, eodEdit } from "/admin/scorecard.js";

let both = true; // show last week as well as the week on screen

function todo() {
  const from = both ? addDays(S.week, -7) : S.week, to = addDays(S.week, 6); const D = scoreData(); const out = [];
  for (const d of S.drivers) {
    const s = scoreFor(d.id, from, to, D, S.C);
    for (const it of s.items) {
      if (it.pre || it.mark?.status === "exc") continue;
      const bad = it.st === "miss" || it.st === "part" || it.st === "over" || (it.st === "late" && !it.mark?.reviewed);
      if (bad && needsFix(it, S.C)) out.push(it);
    }
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || nm(a.driver).localeCompare(nm(b.driver)));
}

/** Add-ons not ticked done on a finished shift (day gone, or EOD in): each can be marked done or excused */
const addKey = (sid, a) => `add|${sid}|${a}`;
const keyName = k => S.rules.find(r => r.done_key === k)?.name || addName(k);
function addTodo() {
  const from = both ? addDays(S.week, -7) : S.week, to = addDays(S.week, 6), t = today(); const out = [];
  const exc = new Set((S.marks || []).filter(m => m.key?.startsWith("add|") && m.status === "exc").map(m => m.key));
  for (const s of S.shifts) {
    if (!s.driver || s.run === "BU" || s.day < from || s.day > to || s.day > t) continue;
    if (s.day === t && !S.eodBy?.[s.id]) continue;   // still running today
    const sat = dayName(s.day) === "Sat";
    const keys = new Set([...(s.addons || []), ...S.addons.filter(a => a.always && a.runs.includes(s.run) && !(sat && a.no_saturday)).map(a => a.id)]);
    for (const r of S.rules) if (r.active && r.done_key && keys.has(r.addon) && r.runs.includes(s.run) && r.days.includes(dow(s.day) + 1)) keys.add(r.done_key);   // e.g. Owaka Medical drop-off
    for (const k of keys) if (!s.done?.[k] && !exc.has(addKey(s.id, k))) out.push({ s, k });
  }
  return out.sort((a, b) => b.s.day.localeCompare(a.s.day) || nm(a.s.driver).localeCompare(nm(b.s.driver)));
}
function addSection() {
  const L = addTodo(); if (!L.length) return "";
  const by = {}; for (const i of L) (by[i.s.day] ??= []).push(i);
  return `<div class="card"><h2>Add-ons not done<span>${L.length}</span></h2><p class="hint"><b>Done</b> ticks it off as done. <b>Excuse</b> takes it off the list as excused.</p><button class="btn ghost sm" data-fxall="add">Excuse all ${L.length}</button>
    ${Object.entries(by).map(([day, items]) => `<h4 style="margin:12px 0 4px">${label(day, true)}</h4><div class="list">${items.map(({ s, k }) => `<div class="item warn"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><span><b>${esc(nm(s.driver))}</b> · ${esc(s.run)}<span class="meta"> ${esc(keyName(k))}</span></span><span class="row" style="flex:0;gap:4px"><button class="btn sm" data-fxadd="done" data-sid="${s.id}" data-k="${esc(k)}">Done</button><button class="btn sm ghost" data-fxadd="exc" data-sid="${s.id}" data-k="${esc(k)}" data-drv="${esc(s.driver)}">Excuse</button></span></div></div>`).join("")}</div>`).join("")}</div>`;
}

export function fixCount() { try { return todo().filter(i => i.st === "miss" || i.st === "part").length + addTodo().length; } catch { return 0; } }

export function fixTab() {
  const L = todo(); const by = {}; for (const i of L) (by[i.day] ??= []).push(i);
  const miss = L.filter(i => i.st === "miss").length, part = L.filter(i => i.st === "part").length, late = L.filter(i => i.st === "late").length;
  return `${weekBar(`<label class="chk ${both ? "on" : ""}"><input type="checkbox" id="fx-both" ${both ? "checked" : ""}>include last week</label>`)}
    <div class="card"><h2>Fix posts<span>${L.length ? `${miss} missing · ${part} incomplete · ${late} late` : "all clear"}</span></h2>
    <p class="hint">Every SOD or EOD that is missing, incomplete or late (an EOD up to ${Math.round((S.C.rules.eodFixGrace ?? 90) / 6) / 10} h late is left off: it still counts as late, but needs no fix). <b>Fix</b> opens an editor: add a missing SOD or EOD for the driver, correct the start or finish time, or fill in missing figures. Once you save a fix, choose whether it is excused (no deduction) or recorded as an admin error, and it drops off the list. <b>Excuse</b> removes the deduction, <b>OK</b> accepts a late post as it is.</p>${L.length ? `<button class="btn ghost sm" data-fxall="post">Excuse all ${L.length}</button>` : ""}
    ${Object.entries(by).map(([day, items]) => `<h4 style="margin:12px 0 4px">${label(day, true)}</h4><div class="list">${items.map(it => `<div class="item ${it.st === "miss" || it.st === "over" ? "crit" : "warn"}"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><span><b>${esc(nm(it.driver))}</b> · ${chip(it)}<span class="meta"> ${esc(STATE_LABEL[it.st])}${it.st === "part" || it.st === "miss" ? "" : ""}</span></span><span class="row" style="flex:0;gap:4px"><button class="btn sm" data-fx="fix" data-key="${esc(it.key)}">Fix</button><button class="btn sm ghost" data-fxshift="${it.driver}|${it.day}" title="Edit or delete this driver's shifts that day">Shifts</button><button class="btn sm ghost" data-fx="exc" data-key="${esc(it.key)}" data-drv="${it.driver}">Excuse</button>${it.st === "late" || it.st === "part" ? `<button class="btn sm ghost" data-fx="ok" data-key="${esc(it.key)}" data-drv="${it.driver}">OK</button>` : ""}</span></div></div>`).join("")}</div>`).join("") || `<p class="empty">✓ Nothing to fix.</p>`}</div>${addSection()}${alertsTab()}`;
}

function findItem(key) {
  const [day, drv] = key.split("|"); const s = scoreFor(drv, day, day, scoreData(), S.C); return s.items.find(i => i.key === key);
}

export function wireFix() {
  wireWeek(); wireAlerts();
  $("#fx-both")?.addEventListener("change", e => { both = e.target.checked; render(); });
  $$("[data-fxshift]").forEach(b => b.onclick = () => { const [drv, day] = b.dataset.fxshift.split("|"); shiftSheet(drv, day); });
  $$("[data-fxall]").forEach(b => b.onclick = async () => {
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; const t = b.textContent; b.textContent = "Tap again to excuse all"; b.classList.add("warn"); setTimeout(() => { if (b.isConnected) { b.dataset.sure = ""; b.textContent = t; b.classList.remove("warn"); } }, 4000); return; }
    b.disabled = true; const at = new Date().toISOString();
    const rows = b.dataset.fxall === "add"
      ? addTodo().map(({ s, k }) => ({ key: addKey(s.id, k), driver: s.driver, reviewed: true, by_person: S.me.id, at, status: "exc", note: `Add-on excused in Fix posts (${keyName(k)}) · excuse all` }))
      : todo().map(it => ({ key: it.key, driver: it.driver, reviewed: true, by_person: S.me.id, at, status: "exc", note: "Excused in Fix posts · excuse all" }));
    if (rows.length) await q(sb.from("marks").upsert(rows)); toast(`Excused ${rows.length}`, "ok"); await loadAll(); render();
  });
  $$("[data-fxadd]").forEach(b => b.onclick = async () => {
    const sid = b.dataset.sid, k = b.dataset.k; b.disabled = true;
    if (b.dataset.fxadd === "done") {
      const sh = S.shifts.find(x => x.id === sid); const done = { ...(sh?.done || {}), [k]: new Date().toISOString() };
      const { error } = await sb.from("shifts").update({ done }).eq("id", sid); if (error) { b.disabled = false; return toast(error.message, "err"); } toast("Marked done", "ok");
    } else { await q(sb.from("marks").upsert({ key: addKey(sid, k), driver: b.dataset.drv, reviewed: true, by_person: S.me.id, at: new Date().toISOString(), status: "exc", note: `Add-on excused in Fix posts (${keyName(k)})` })); toast("Excused", "ok"); }
    await loadAll(); render();
  });
  $$("[data-fx]").forEach(b => b.onclick = async () => {
    const key = b.dataset.key; const act = b.dataset.fx;
    if (act === "fix") { const it = findItem(key); if (it) it.kind === "SOD" ? sodSheet(it) : eodFix(it); return; }
    const row = { key, driver: b.dataset.drv, reviewed: true, by_person: S.me.id, at: new Date().toISOString(), status: act === "exc" ? "exc" : "ok", note: act === "exc" ? "Excused in Fix posts" : "Accepted in Fix posts" };
    await q(sb.from("marks").upsert(row)); toast(act === "exc" ? "Excused" : "Marked OK", "ok"); await loadAll(); render();
  });
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
