// Run Board tab: the week grid IS the roster. Changes save live; "Send changes" notifies drivers and tracks confirmations.
import { sb, q, nzNow, today, addDays, dow, dayName, monOf, label, toMin, fmtT, fmt24, fmtTs, fmtTime, ago, esc, $, $$, toast, pill, first, isSort, hours } from "/shared/core.js";
import { addName, segTimes } from "/shared/score.js";
import { S, sheet, opt, nm, fnm, weekBar, wireWeek, loadAll, render, fn } from "/admin/admin.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const key = s => `${s.day}|${s.run}|${s.slot}`;
const snap = s => s ? { driver: s.driver || null, van: s.van || null, start_at: s.start_at ? s.start_at.slice(0, 5) : null, end_at: s.end_at ? s.end_at.slice(0, 5) : null, addons: [...(s.addons || [])].sort(), trainee: s.trainee || null } : null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function weekShifts() { const end = addDays(S.week, 6); return S.shifts.filter(s => s.day >= S.week && s.day <= end); }
function sentBy() { return Object.fromEntries(S.sent.map(x => [x.shift_key, x])); }
export function pendingChanges() { // diffs vs last sent, today onwards
  const t = today(); const sb_ = sentBy(); const out = []; const seen = new Set();
  for (const s of S.shifts) { if (s.day < t || s.run === "BU") continue; const k = key(s); seen.add(k); const prev = sb_[k]?.snapshot || null; const cur = snap(s); if (!same(prev, cur) && (cur.driver || prev?.driver)) out.push({ k, shift: s, before: prev, after: cur }); }
  for (const x of S.sent) { if (seen.has(x.shift_key)) continue; const [day, run, slot] = x.shift_key.split("|"); if (day < t || !x.snapshot?.driver) continue; out.push({ k: x.shift_key, shift: { day, run, slot: +slot }, before: x.snapshot, after: null }); }
  return out;
}
function winTxt(a) { const st = toMin(a?.start_at), en = toMin(a?.end_at); return st != null && en != null ? `${fmtT(st)}–${fmtT(en)}` : ""; }
export function summarize(ch) {
  const d = label(ch.shift.day); const run = S.runsBy[ch.shift.run]?.label || ch.shift.run; const a = ch.after, b = ch.before;
  const addTxt = x => (x?.addons || []).length ? ` · add-ons: ${x.addons.map(addName).join(", ")}` : "";
  if (!a?.driver && b?.driver) return { text: `${d}: no longer on ${run}${b.start_at ? ` ${winTxt(b)}` : ""}`, affects: [b.driver] };
  if (a?.driver && !b?.driver) return { text: `${d}: ${run} ${winTxt(a)}${a.van ? ` (${a.van})` : ""}${addTxt(a)}${a.trainee ? ` — training with ${fnm(a.trainee)}` : ""}`, affects: [a.driver, ...(a.trainee ? [a.trainee] : [])] };
  if (a.driver !== b.driver) return { text: `${d}: ${run} ${winTxt(a)}${a.van ? ` (${a.van})` : ""}${addTxt(a)} (was ${fnm(b.driver)})`, affects: [a.driver, b.driver, ...(a.trainee ? [a.trainee] : [])] };
  const bits = []; if (a.start_at !== b.start_at || a.end_at !== b.end_at) bits.push(`now ${winTxt(a)} (was ${winTxt(b)})`); if (a.van !== b.van) bits.push(`van ${a.van || "none"} (was ${b.van || "none"})`);
  const added = a.addons.filter(x => !b.addons.includes(x)), removed = b.addons.filter(x => !a.addons.includes(x));
  if (added.length) bits.push(`add-on${added.length > 1 ? "s" : ""} added: ${added.map(addName).join(", ")}`); if (removed.length) bits.push(`add-on${removed.length > 1 ? "s" : ""} removed: ${removed.map(addName).join(", ")}`);
  if (a.trainee !== b.trainee) bits.push(a.trainee ? `training with ${fnm(a.trainee)}` : `no longer training ${fnm(b.trainee)}`);
  return { text: `${d}: ${run} — ${bits.join(" · ")}`, affects: [a.driver, ...(a.trainee && a.trainee !== b.trainee ? [a.trainee] : []), ...(b.trainee && a.trainee !== b.trainee ? [b.trainee] : [])] };
}

/* ---------- render ---------- */
export function runBoardTab() {
  const t = today(); const n = nzNow(); const ws = weekShifts(); const sb_ = sentBy(); const pend = pendingChanges(); const pendKeys = new Set(pend.map(p => p.k));
  const awaiting = S.items.filter(i => i.roster_changes.status === "awaiting_approval"); const awKeys = new Set(awaiting.map(i => `${i.day}|${i.run}|${i.after?.slot || 1}`));
  const leaveOn = (drv, day) => S.leave.find(l => l.driver === drv && l.status === "approved" && day >= l.date_from && day <= l.date_to);
  const ackOf = {}; for (const a of S.acks) (ackOf[a.item_id] ??= {})[a.driver] = a;
  const sentItems = S.items.filter(i => i.roster_changes.status === "sent" && i.day >= S.week && i.day <= addDays(S.week, 6));
  const unconf = {}; for (const i of sentItems) for (const d of i.affects) { const a = ackOf[i.id]?.[d]; if (!a?.confirmed_at && !a?.dismissed_at) { const st = toMin(i.after?.start_at); const past = i.day < t || (i.day === t && st != null && n.min >= st); if (!past) (unconf[`${i.day}|${i.run}`] ??= []).push(d); } }
  const runs = S.runs.filter(r => r.active && r.code !== "BU").concat(S.runs.filter(r => r.code === "BU"));
  const rows = runs.map(r => `<tr><td class="run"><span class="code">${esc(r.label || r.code)}</span><span class="nm">${esc(r.name)}</span></td>${DAYS.map((D, di) => { const day = addDays(S.week, di); const w = r.windows?.[D]; const cell = ws.filter(s => s.run === r.code && s.day === day); const slots = Math.max(r.slots || 1, ...cell.map(s => s.slot));
    const off = !w && !cell.length; const chg = cell.some(s => pendKeys.has(key(s))) || [...pendKeys].some(k => k.startsWith(`${day}|${r.code}|`)); const aw = [...awKeys].some(k => k.startsWith(`${day}|${r.code}|`));
    return `<td class="${off ? "off" : ""} ${chg ? "changed" : ""} ${aw ? "pending" : ""}">${Array.from({ length: slots }, (_, i) => { const slot = i + 1; const s = cell.find(x => x.slot === slot); const { st, en } = s ? segTimes(s, S.runsBy) : { st: w ? toMin(w[0][0]) : null, en: w ? toMin(w[0][1]) : null }; const u = unconf[`${day}|${r.code}`];
      if (!s || !s.driver) return `<div class="slot" data-day="${day}" data-run="${r.code}" data-slot="${slot}">${off && !s ? `<span class="w">—</span>` : `<span class="w">${st != null ? `${fmtT(st)}–${fmtT(en)}` : ""}</span><span class="meta">+ add</span>`}</div>`;
      const sod = S.sodBy[s.id]; const lv = leaveOn(s.driver, day);
      return `<div class="slot filled" data-day="${day}" data-run="${r.code}" data-slot="${slot}"><span class="d">${esc(nm(s.driver))}${lv ? ` <span class="ack">on leave!</span>` : ""}</span>${s.van && !isSort(r.code) ? `<span class="v">${esc(s.van)}</span>` : ""}<span class="w">${fmtT(st)}–${fmtT(en)}</span>${s.addons?.length ? `<span class="a">${s.addons.map(a => `<span>${esc(S.addons.find(x => x.id === a)?.short || addName(a))}</span>`).join("")}</span>` : ""}${s.trainee ? `<span class="tr">training ${esc(fnm(s.trainee))}</span>` : ""}${u?.includes(s.driver) ? `<span class="ack">? not confirmed</span>` : ""}${day === t && sod ? `<span class="sod">SOD ${fmtTime(sod.sent_at)}</span>` : ""}</div>`; }).join("")}</td>`; }).join("")}</tr>`).join("");
  const note = S.notes.find(x => x.week_start === S.week)?.notes || "";
  const canSend = S.me.can("roster"); const canApprove = S.me.isOwner || S.me.can("roster_approve");
  return `${weekBar(`${pend.length && canSend ? `<button class="btn crit sm" id="send-changes">Send ${pend.length} change${pend.length === 1 ? "" : "s"} to drivers</button>` : pend.length ? `<span class="meta">${pend.length} unsent change${pend.length === 1 ? "" : "s"}</span>` : `<span class="meta c-ok">✓ roster matches what drivers have</span>`}<button class="btn ghost sm" id="copy-prev">Copy last week</button><button class="btn ghost sm" id="run-times">Run times</button>`)}
    ${awaiting.length ? approvalCard(awaiting, canApprove) : ""}
    <div class="rb"><table><thead><tr><th class="run">Run</th>${DAYS.map((D, i) => { const day = addDays(S.week, i); const hol = S.C.holidays[day]; return `<th class="${day === t ? "c-accent" : ""}">${D} <span class="meta">${label(day).slice(4)}</span>${hol ? `<div class="meta c-warn">${esc(hol.name)}</div>` : ""}</th>`; }).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">Tap a slot to set the driver, van, times, add-ons or a trainee. Red outline = changed since drivers were last told. Amber = waiting for Jeremy's OK. "? not confirmed" = the driver hasn't tapped Got it yet.</p>
    ${confirmCard(sentItems, ackOf, n)}
    ${ruleCheck(ws, leaveOn)}
    <div class="card"><h2>Roster notes<span>week of ${label(S.week)}</span></h2><textarea class="in" id="wk-notes" rows="5" placeholder="Notes for this week's roster (road closures, training, reminders)…" ${canSend ? "" : "disabled"}>${esc(note)}</textarea><p class="hint">Saves when you click away.</p></div>
    <details class="card"><summary>History of roster changes</summary>${historyList()}</details>`;
}
function approvalCard(items, canApprove) {
  const by = {}; for (const i of items) (by[i.change_id] ??= { c: i.roster_changes, items: [] }).items.push(i);
  return `<div class="card warnc"><h2>Waiting for Jeremy's OK<span>${items.length} change${items.length === 1 ? "" : "s"}</span></h2>${Object.values(by).map(g => `<div class="item warn"><div class="m">Made by ${esc(nm(g.c.created_by))} · ${fmtTs(g.c.created_at)}</div><ul style="margin:4px 0;padding-left:18px">${g.items.map(i => `<li>${esc(i.summary)}</li>`).join("")}</ul>${canApprove ? `<div class="row"><button class="btn sm" data-approve="${g.c.id}">Approve &amp; send to drivers</button><button class="btn sm ghost" data-reject="${g.c.id}">Reject (keep roster as is)</button></div>` : `<div class="meta">Jeremy will approve or reject this.</div>`}</div>`).join("")}</div>`;
}
function confirmCard(sentItems, ackOf, n) {
  const t = n.date; if (!sentItems.length) return "";
  const by = {}; for (const i of sentItems) for (const d of i.affects) { const a = ackOf[i.id]?.[d]; const st = toMin(i.after?.start_at); const past = i.day < t || (i.day === t && st != null && n.min >= st); (by[d] ??= []).push({ i, a, past }); }
  const waiting = Object.entries(by).map(([d, L]) => ({ d, L: L.filter(x => !x.a?.confirmed_at && !x.a?.dismissed_at && !x.past) })).filter(x => x.L.length);
  const hist = sentItems.length;
  return `<div class="card ${waiting.length ? "hot" : ""}"><h2>Roster changes — confirmations<span>${waiting.length ? `${waiting.length} driver${waiting.length === 1 ? "" : "s"} waiting` : "all confirmed"}</span></h2>
    ${waiting.length ? waiting.map(({ d, L }) => `<div class="item crit clk" data-changes="${d}" title="Tap for every change sent to ${esc(fnm(d))}"><div class="row" style="justify-content:space-between"><b>${esc(nm(d))}</b><span class="row" style="flex:0"><button class="btn sm ghost" data-ack="ok" data-drv="${d}" data-items="${L.map(x => x.i.id).join(",")}">✓ Confirm</button><button class="btn sm ghost" data-ack="dis" data-drv="${d}" data-items="${L.map(x => x.i.id).join(",")}">Dismiss</button></span></div><ul style="margin:4px 0;padding-left:18px;color:var(--crit)">${L.map(x => `<li>${esc(x.i.summary)} <span class="meta">sent ${ago(x.i.roster_changes.sent_at)}${x.a?.seen_at ? " · seen" : ""}</span></li>`).join("")}</ul></div>`).join("") : `<p class="meta c-ok">✓ Nothing waiting to be confirmed</p>`}
    <details><summary>All ${hist} change lines this week</summary><div class="list" style="margin-top:8px">${sentItems.map(i => `<div class="item"><div>${esc(i.summary)}</div><div class="row" style="gap:3px">${i.affects.map(d => { const a = ackOf[i.id]?.[d]; const st = toMin(i.after?.start_at); const past = i.day < t || (i.day === t && st != null && n.min >= st); return `<span class="chip ${a?.confirmed_at ? "ok" : a?.dismissed_at ? "exc" : past ? "due" : "over"}">${esc(fnm(d))} ${a?.confirmed_at ? `✓ ${a.confirmed_by ? "by " + fnm(a.confirmed_by) : fmtTs(a.confirmed_at)}` : a?.dismissed_at ? "dismissed" : past ? "run started · not confirmed" : "waiting"}</span>`; }).join("")}</div></div>`).join("")}</div></details></div>`;
}
function historyList() {
  const by = {}; for (const i of S.items) (by[i.change_id] ??= { c: i.roster_changes, items: [] }).items.push(i);
  const list = Object.values(by).sort((a, b) => (b.c.sent_at || b.c.created_at).localeCompare(a.c.sent_at || a.c.created_at)).slice(0, 40);
  return `<div class="list" style="margin-top:8px">${list.map(g => `<div class="item"><div class="m">${fmtTs(g.c.sent_at || g.c.created_at)} · ${esc(fnm(g.c.created_by))}${g.c.approved_by && g.c.approved_by !== g.c.created_by ? ` · approved by ${esc(fnm(g.c.approved_by))}` : ""} · ${pill(g.c.status, g.c.status === "sent" ? "ok" : g.c.status === "rejected" ? "crit" : "warn")}</div><ul style="margin:2px 0;padding-left:18px">${g.items.map(i => `<li>${esc(i.summary)}</li>`).join("")}</ul></div>`).join("") || `<p class="empty">No changes sent yet.</p>`}</div>`;
}
function ruleCheck(ws, leaveOn) {
  const iss = []; const byDay = {}; for (const s of ws) if (s.driver) (byDay[s.day] ??= []).push(s);
  for (const [day, L] of Object.entries(byDay)) {
    const byDrv = {}; for (const s of L) (byDrv[s.driver] ??= []).push(s);
    for (const [d, ss] of Object.entries(byDrv)) { const segs = ss.map(s => ({ s, ...segTimes(s, S.runsBy) })).filter(x => x.st != null && x.en != null).sort((a, b) => a.st - b.st); for (let i = 1; i < segs.length; i++) if (segs[i].st < segs[i - 1].en && !isSort(segs[i].s.run) && !isSort(segs[i - 1].s.run)) iss.push(["crit", `${label(day)}: ${nm(d)} is on ${segs[i - 1].s.run} until ${fmtT(segs[i - 1].en)} but ${segs[i].s.run} starts ${fmtT(segs[i].st)}`]);
      if (leaveOn(d, day)) iss.push(["crit", `${label(day)}: ${nm(d)} is rostered but has approved leave`]); }
    for (const s of L) { if (isSort(s.run) || s.run === "BU") continue; const sk = S.skills.find(k => k.driver === s.driver && k.run === s.run); if (!sk) iss.push(["warn", `${label(day)}: ${nm(s.driver)} isn't signed off on ${s.run}`]); else if (sk.level === "tr" && !s.trainee && !L.some(o => o.id !== s.id && o.trainee === s.driver)) iss.push(["warn", `${label(day)}: ${nm(s.driver)} is still training on ${s.run}`]);
      if (dayName(day) === "Sat") for (const a of s.addons || []) if (S.addons.find(x => x.id === a)?.no_saturday) iss.push(["crit", `${label(day)}: ${addName(a)} never goes out on a Saturday (${s.run})`]); }
    const vans = {}; for (const s of L) if (s.van && !isSort(s.run)) { const { st, en } = segTimes(s, S.runsBy); for (const o of vans[s.van] || []) if (st < o.en && o.st < en) iss.push(["warn", `${label(day)}: ${s.van} is on ${o.run} and ${s.run} at the same time`]); (vans[s.van] ??= []).push({ st, en, run: s.run }); }
    for (const r of S.rules) { if (!r.active || r.runs.includes("ALL") || r.runs.length < 2 || !r.addon) continue; if (!r.days.includes(dow(day) + 1)) continue; const on = L.filter(s => r.runs.includes(s.run) && (s.addons || []).includes(r.addon)); if (on.length > 1) iss.push(["warn", `${label(day)}: ${r.name} is ticked on ${on.map(s => s.run).join(" and ")} — pick one`]); if (!on.length && S.addons.find(a => a.id === r.addon)?.id.startsWith("tw_")) iss.push(["warn", `${label(day)}: ${r.name} isn't ticked on any run`]); }
  }
  return `<details class="card" ${iss.length ? "open" : ""}><summary>Rule check<span class="meta">${iss.length ? `${iss.length} to look at` : "✓ all good"}</span></summary><div class="list" style="margin-top:8px">${iss.map(([c, t]) => `<div class="item ${c}">${esc(t)}</div>`).join("") || `<p class="meta">Nothing to fix.</p>`}</div></details>`;
}

/* ---------- wiring ---------- */
export function wireRunBoard() {
  wireWeek();
  $$(".slot").forEach(el => el.onclick = () => slotSheet(el.dataset.day, el.dataset.run, +el.dataset.slot));
  $("#send-changes")?.addEventListener("click", sendSheet);
  $("#copy-prev")?.addEventListener("click", copyPrev);
  $("#run-times")?.addEventListener("click", runTimes);
  $("#wk-notes")?.addEventListener("blur", async e => { await q(sb.from("week_notes").upsert({ week_start: S.week, notes: e.target.value, updated_at: new Date().toISOString() })); toast("Notes saved", "ok"); });
  // [data-ack] confirm/dismiss buttons are handled by detail.js bind()
  $$("[data-approve]").forEach(b => b.onclick = () => finalizeSend(b.dataset.approve));
  $$("[data-reject]").forEach(b => b.onclick = async () => { const id = b.dataset.reject; const items = S.items.filter(i => i.change_id === id); // put the roster back to what drivers have
    for (const i of items) { const k = `${i.day}|${i.run}|${i.after?.slot || i.before?.slot || 1}`; const prev = S.sent.find(x => x.shift_key === k)?.snapshot; const slot = +(k.split("|")[2]); if (prev?.driver) await q(sb.from("shifts").upsert({ day: i.day, run: i.run, slot, ...prev }, { onConflict: "day,run,slot" })); else await q(sb.from("shifts").delete().match({ day: i.day, run: i.run, slot })); }
    await q(sb.from("roster_changes").update({ status: "rejected", approved_by: S.me.id }).eq("id", id)); toast("Rejected and roster restored", "ok"); });
}

function slotSheet(day, run, slot) {
  const r = S.runsBy[run]; const s = S.shifts.find(x => x.day === day && x.run === run && x.slot === slot); const w = r.windows?.[dayName(day)]; const sat = dayName(day) === "Sat";
  const { st, en } = s ? segTimes(s, S.runsBy) : { st: w ? toMin(w[0][0]) : null, en: w ? toMin(w[0][1]) : null };
  const skilled = d => S.skills.find(k => k.driver === d.id && k.run === run)?.level; const busy = d => S.shifts.filter(x => x.day === day && x.driver === d.id && x.run !== run).map(x => x.run);
  const lv = d => S.leave.find(l => l.driver === d.id && l.status === "approved" && day >= l.date_from && day <= l.date_to);
  const drvOpts = [["", "— nobody —"], ...S.drivers.map(d => [d.id, `${d.name}${skilled(d) === "yes" ? " ✓" : skilled(d) === "tr" ? " (training)" : isSort(run) || run === "BU" ? "" : " ·"}${lv(d) ? " · ON LEAVE" : ""}${busy(d).length ? ` · also ${busy(d).join(", ")}` : ""}`])];
  const opts = S.addons.filter(a => a.runs.includes(run) && !(sat && a.no_saturday));
  if (!S.me.can("roster")) { toast("You can view the roster but not change it", "err"); return; }
  sheet(`<h3>${esc(r.label || run)} · ${label(day)}${(r.slots || 1) > 1 ? ` · slot ${slot}` : ""}</h3><p class="meta">${esc(r.name)}${w ? ` · usual ${fmtT(toMin(w[0][0]))}–${fmtT(toMin(w[0][1]))}` : " · doesn't usually run this day"}</p>
    <form class="frm" id="sf"><label class="f full">Driver<select class="in" id="drv">${opt(drvOpts, s?.driver || "")}</select></label>
    ${isSort(run) || r.needs_van === false ? "" : `<label class="f full">Van<select class="in" id="van">${opt([["", "—"], ...S.vans.filter(v => v.active).map(v => [v.plate, `${v.plate}${v.model ? " · " + v.model : ""}`])], s?.van || "")}</select></label>`}
    <label class="f">Start<input class="in" type="time" id="st" value="${st != null ? fmt24(st) : ""}"></label><label class="f">Finish<input class="in" type="time" id="en" value="${en != null ? fmt24(en) : ""}"></label>
    ${opts.length ? `<div class="full"><div class="meta mono" style="margin-bottom:6px">ADD-ONS</div><div class="row">${opts.map(a => `<label class="chk ${(s?.addons || []).includes(a.id) ? "on" : ""}"><input type="checkbox" name="add" value="${a.id}" ${(s?.addons || []).includes(a.id) ? "checked" : ""}>${esc(a.name)}${a.minutes ? ` <span class="meta">+${a.minutes}m</span>` : ""}</label>`).join("")}</div></div>` : ""}
    ${isSort(run) ? "" : `<label class="f full">Trainee riding along<select class="in" id="tr">${opt([["", "—"], ...S.drivers.map(d => [d.id, d.name])], s?.trainee || "")}</select></label>`}
    <label class="f full">Note<input class="in" id="note" value="${esc(s?.note || "")}"></label>
    <div class="row full"><button class="btn" type="submit">Save</button>${s ? `<button class="btn ghost" type="button" id="rm">Clear slot</button>` : ""}</div></form><p class="hint">Saves to the roster straight away. Drivers are told when you press "Send changes".</p>`, (bg, close) => {
    bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
    bg.querySelector("#sf").onsubmit = async e => { e.preventDefault(); const g = x => bg.querySelector("#" + x); const drv = g("drv").value || null;
      if (!drv && !s) { close(); return; }
      const row = { day, run, slot, driver: drv, van: g("van")?.value || null, start_at: g("st").value || null, end_at: g("en").value || null, addons: [...bg.querySelectorAll("input[name=add]:checked")].map(i => i.value), trainee: g("tr")?.value || null, note: g("note").value || null };
      if (row.trainee && row.trainee === drv) row.trainee = null;
      const { error } = await sb.from("shifts").upsert(row, { onConflict: "day,run,slot" }); if (error) return toast(error.message, "err"); close(); };
    bg.querySelector("#rm")?.addEventListener("click", async () => { const { error } = await sb.from("shifts").delete().eq("id", s.id); if (error) return toast(error.message, "err"); close(); });
  });
}

function sendSheet() {
  const pend = pendingChanges().map(ch => ({ ...ch, ...summarize(ch) })); const byDrv = {}; for (const p of pend) for (const d of p.affects) (byDrv[d] ??= []).push(p.text);
  const direct = S.me.isOwner || S.me.can("roster_approve");
  sheet(`<h3>Send ${pend.length} change${pend.length === 1 ? "" : "s"}</h3><p class="hint">${direct ? "Each driver gets a notification and an email with their lines, and a Got it button on their page. You'll see their ✓ live." : "These go to Jeremy for approval first. Once he approves, the drivers are told."}</p>
    <div class="list">${Object.entries(byDrv).map(([d, L]) => `<div class="item"><b>${esc(nm(d))}</b><ul style="margin:2px 0;padding-left:18px">${L.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`).join("")}</div>
    <label class="f">Reason / note to drivers (optional)<input class="in" id="reason" placeholder="e.g. Pat is away this week"></label>
    <button class="btn ${direct ? "crit" : "warn"}" id="go">${direct ? "Send to drivers now" : "Send to Jeremy for approval"}</button>`, async (bg, close) => {
    bg.querySelector("#go").onclick = async () => { const b = bg.querySelector("#go"); b.disabled = true;
      try { const c = await q(sb.from("roster_changes").insert({ created_by: S.me.id, status: direct ? "sent" : "awaiting_approval", reason: bg.querySelector("#reason").value || null, ...(direct ? { approved_by: S.me.id, sent_at: new Date().toISOString() } : {}) }).select().single());
        const items = await q(sb.from("roster_change_items").insert(pend.map(p => ({ change_id: c.id, shift_id: p.shift.id || null, day: p.shift.day, run: p.shift.run, before: p.before, after: p.after ? { ...p.after, slot: p.shift.slot } : null, affects: [...new Set(p.affects)].filter(Boolean), summary: p.text }))).select());
        if (direct) await afterSend(c.id, items, pend); else toast("Sent to Jeremy for approval", "ok");
        close(); } catch (err) { toast(err.message, "err"); b.disabled = false; } };
  });
}
async function afterSend(changeId, items, pend) {
  const acks = []; for (const i of items) for (const d of i.affects) acks.push({ item_id: i.id, driver: d });
  if (acks.length) await q(sb.from("change_acks").upsert(acks, { onConflict: "item_id,driver" }));
  await q(sb.from("roster_sent").upsert(pend.map(p => ({ shift_key: p.k, snapshot: p.after || { driver: null }, sent_at: new Date().toISOString() })), { onConflict: "shift_key" }));
  fn("notify", { type: "roster_change", change_id: changeId }).catch(e => console.warn(e));
  toast("Sent to drivers ✓", "ok");
}
async function finalizeSend(changeId) {
  const items = S.items.filter(i => i.change_id === changeId);
  await q(sb.from("roster_changes").update({ status: "sent", approved_by: S.me.id, sent_at: new Date().toISOString() }).eq("id", changeId));
  const pend = items.map(i => ({ k: `${i.day}|${i.run}|${i.after?.slot || i.before?.slot || 1}`, after: i.after ? (({ slot, ...rest }) => rest)(i.after) : null }));
  await afterSend(changeId, items, pend);
}
async function copyPrev() {
  const prev = addDays(S.week, -7); const src = S.shifts.filter(s => s.day >= prev && s.day < S.week); if (!src.length) return toast("Last week is empty", "err");
  const cur = weekShifts(); if (cur.length && !confirm(`This week already has ${cur.length} shifts. Fill only the empty slots from last week?`)) return;
  const rows = src.filter(s => !cur.some(c => c.day === addDays(s.day, 7) && c.run === s.run && c.slot === s.slot)).map(s => ({ day: addDays(s.day, 7), run: s.run, slot: s.slot, driver: s.driver, van: s.van, start_at: s.start_at, end_at: s.end_at, addons: s.addons, trainee: s.trainee }));
  if (!rows.length) return toast("Nothing to copy", "err"); const { error } = await sb.from("shifts").upsert(rows, { onConflict: "day,run,slot" }); if (error) return toast(error.message, "err"); toast(`Copied ${rows.length} shifts`, "ok");
}
function runTimes() {
  sheet(`<h3>Run times</h3><p class="hint">Usual start and finish for each run, each day. Blank = doesn't run. Format 05:00-10:30. These are the defaults a new shift gets.</p><div class="scroll"><table class="dt" id="rt"><tr><th>Run</th>${DAYS.map(d => `<th>${d}</th>`).join("")}<th>Slots</th></tr>${S.runs.map(r => `<tr><td><b>${esc(r.label || r.code)}</b></td>${DAYS.map(d => { const w = r.windows?.[d]; return `<td><input class="in" style="min-height:34px;min-width:110px;font-size:13px;padding:4px 6px" data-run="${r.code}" data-day="${d}" value="${w ? `${w[0][0]}-${w[0][1]}` : ""}"></td>`; }).join("")}<td><input class="in" style="min-height:34px;width:60px;font-size:13px;padding:4px 6px" data-slots="${r.code}" value="${r.slots || 1}"></td></tr>`).join("")}</table></div><button class="btn" id="save-rt">Save run times</button>`, (bg, close) => {
    bg.querySelector("#save-rt").onclick = async () => { const ups = []; for (const r of S.runs) { const windows = {}; for (const d of DAYS) { const v = bg.querySelector(`[data-run="${r.code}"][data-day="${d}"]`).value.trim(); const m = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(v); if (m) windows[d] = [[m[1].padStart(5, "0"), m[2].padStart(5, "0")]]; else if (v) return toast(`Check ${r.code} ${d}: use 05:00-10:30`, "err"); } ups.push({ code: r.code, name: r.name, windows, slots: +bg.querySelector(`[data-slots="${r.code}"]`).value || 1 }); }
      const { error } = await sb.from("runs").upsert(ups); if (error) return toast(error.message, "err"); close(); toast("Saved", "ok"); };
  });
}
