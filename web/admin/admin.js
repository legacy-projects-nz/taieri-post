// Taieri Ops · owner / staff portal
import { sb, q, me, nzNow, today, addDays, dow, dayName, monOf, label, toMin, fmtT, fmt24, fmtTs, fmtTime, ago, esc, $, $$, h, toast, pill, first, col, pct, live, debounce, isSort, settings as loadSettings, signOut, hours, nzToIso } from "/shared/core.js";
import { requireUser } from "/shared/auth.js";
import { AREAS, AREA_LABEL } from "/shared/config.js";
import { cfg, dayShifts, itemsFor, scoreFor, fortnight, itemNote, STATE_LABEL, addName, segTimes } from "/shared/score.js";
import { runBoardTab, wireRunBoard } from "/admin/runboard.js";
import { scorecardTab, wireScorecard } from "/admin/scorecard.js";

export const S = { me: null, tab: location.hash.slice(1) || "live", week: monOf(today()), set: {}, C: null, runs: [], runsBy: {}, vans: [], vansBy: {}, addons: [], rules: [], people: [], peopleBy: {}, shifts: [], sods: [], eods: [], marks: [], entries: [], feed: [], ovs: [], changes: [], items: [], acks: [], sent: [], msgs: [], recips: [], leave: [], alerts: [], locs: [], skills: [], notes: [], vchk: [], log: [] };
const app = $("#app");
export const fn = async (name, body) => { const { data, error } = await sb.functions.invoke(name, { body }); if (error) throw error; return data; };

(async () => {
  try { S.me = await requireUser(app, { staff: true }); } catch { return; }
  if (!S.me.isStaff) { app.innerHTML = `<div class="wrap"><div class="card"><h2>Drivers' page is at the main link</h2><p><a href="/">Open the driver portal</a></p></div></div>`; return; }
  await loadAll(); render();
  live(["shifts", "sod", "eod", "alerts", "roster_changes", "roster_change_items", "change_acks", "messages", "message_recipients", "leave_requests", "entries", "marks", "vans", "people", "settings", "timing_rules", "addons", "locations", "vehicle_checks", "eff_overrides", "run_skills", "week_notes", "roster_sent"], debounce(async (t) => { await loadAll(); render(true); }, 500), "ops");
  setInterval(() => render(true), 60000);
  window.addEventListener("hashchange", () => { S.tab = location.hash.slice(1) || "live"; render(); });
})();

export async function loadAll() {
  const t = today(); const wk = S.week; const from = addDays(Math.min(wk, monOf(t)) === wk ? wk : monOf(t), -63), to = addDays(Math.max(wk, monOf(t)) === wk ? wk : monOf(t), 20);
  const [set, runs, vans, addons, rules, people, shifts, items, acks, sent, msgs, recips, leave, alerts, entries, marks, feed, ovs, locs, skills, notes, vchk] = await Promise.all([
    loadSettings(), q(sb.from("runs").select("*").order("sort")), q(sb.from("vans").select("*").order("plate")), q(sb.from("addons").select("*")), q(sb.from("timing_rules").select("*")),
    q(sb.from("people").select("*").order("name")),
    q(sb.from("shifts").select("*").gte("day", from).lte("day", to)),
    q(sb.from("roster_change_items").select("*, roster_changes!inner(*)").order("day").limit(600)),
    q(sb.from("change_acks").select("*")),
    q(sb.from("roster_sent").select("*")),
    q(sb.from("messages").select("*").order("created_at", { ascending: false }).limit(60)),
    q(sb.from("message_recipients").select("*")),
    q(sb.from("leave_requests").select("*").order("created_at", { ascending: false }).limit(100)),
    q(sb.from("alerts").select("*").order("created_at", { ascending: false }).limit(200)),
    q(sb.from("entries").select("*").gte("day", from)),
    q(sb.from("marks").select("*")),
    q(sb.from("nzpost_feed").select("*").gte("day", from)),
    q(sb.from("eff_overrides").select("*")),
    q(sb.from("locations").select("*").gte("at", new Date(Date.now() - 12 * 3600e3).toISOString()).order("at", { ascending: false }).limit(2000)),
    q(sb.from("run_skills").select("*")), q(sb.from("week_notes").select("*")), q(sb.from("vehicle_checks").select("*").gte("week_start", addDays(monOf(t), -42))),
  ]);
  Object.assign(S, { set, runs, vans, addons, rules, people, shifts, items, acks, sent, msgs, recips, leave, alerts, entries, marks, feed, ovs, locs, skills, notes, vchk });
  S.C = cfg(set); S.runsBy = Object.fromEntries(runs.map(r => [r.code, r])); S.vansBy = Object.fromEntries(vans.map(v => [v.plate, v])); S.peopleBy = Object.fromEntries(people.map(p => [p.id, p]));
  S.drivers = people.filter(p => p.role === "driver" && p.active && !p.cleared);
  const ids = shifts.map(s => s.id);
  if (ids.length) { const [sods, eods] = await Promise.all([q(sb.from("sod").select("*").in("shift_id", ids)), q(sb.from("eod").select("*").in("shift_id", ids))]); S.sods = sods; S.eods = eods; } else { S.sods = []; S.eods = []; }
  S.sodBy = Object.fromEntries(S.sods.map(s => [s.shift_id, s])); S.eodBy = Object.fromEntries(S.eods.map(e => [e.shift_id, e]));
}

const TABS = [["live", "Live", "alerts"], ["runboard", "Run Board", "roster"], ["scorecard", "Scorecard", "scorecard"], ["alerts", "Alerts", "alerts"], ["messages", "Messages", "messages"], ["leave", "Leave", "leave"], ["fleet", "Fleet", "fleet"], ["timing", "Timing rules", "timing"], ["people", "People", "people"]];
export function render(soft = false) {
  if (soft && (document.activeElement?.matches("input,textarea,select") || $(".sheet-bg"))) return;
  const n = nzNow(); const tabs = TABS.filter(([, , a]) => S.me.can(a));
  if (!tabs.some(([k]) => k === S.tab)) S.tab = tabs[0][0];
  const badge = { live: S.alerts.filter(a => !a.resolved_at).length, leave: S.leave.filter(l => l.status === "pending").length, runboard: S.items.filter(i => i.roster_changes.status === "awaiting_approval").length, alerts: S.alerts.filter(a => !a.resolved_at).length };
  app.innerHTML = `<div class="wrap">
    <div class="top"><div><div class="brand">Taieri Ops</div><h1>${({ live: "Live board", runboard: "Run Board", scorecard: "Driver Scorecard", alerts: "Alerts", messages: "Messages", leave: "Leave", fleet: "Fleet", timing: "Timing rules", people: "People & settings" })[S.tab]}</h1></div>
      <div class="upd"><span class="dot live"></span>live · ${fmtT(n.min)}<br>${esc(first(S.me.name))} · <button class="linkbtn" id="signout">sign out</button></div></div>
    <nav class="nav">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? "on" : ""}">${l}${badge[k] ? `<span class="b ${k === "runboard" ? "warn" : ""}">${badge[k]}</span>` : ""}</button>`).join("")}</nav>
    <div id="view">${({ live: liveTab, runboard: runBoardTab, scorecard: scorecardTab, alerts: alertsTab, messages: messagesTab, leave: leaveTab, fleet: fleetTab, timing: timingTab, people: peopleTab })[S.tab]()}</div>
    <p class="foot">Safe. Sharp. Swift. · <a href="/">driver portal</a></p></div>`;
  $("#signout").onclick = signOut;
  $$("[data-tab]").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; location.hash = S.tab; render(); });
  ({ live: wireLive, runboard: wireRunBoard, scorecard: wireScorecard, alerts: wireAlerts, messages: wireMessages, leave: wireLeave, fleet: wireFleet, timing: wireTiming, people: wirePeople })[S.tab]?.();
}

/* ================= shared helpers ================= */
export function sheet(html, onOpen) {
  const bg = h(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" style="position:relative;max-width:640px"><button class="x" aria-label="Close">×</button>${html}</div></div>`);
  const close = () => bg.remove(); bg.querySelector(".x").onclick = close; bg.addEventListener("click", e => { if (e.target === bg) close(); });
  document.body.appendChild(bg); onOpen?.(bg, close); return { bg, close };
}
export const opt = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${esc(l)}</option>`).join("");
export const nm = id => S.peopleBy[id]?.name || id || "—";
export const fnm = id => first(nm(id));
export function weekBar(extra = "") { return `<div class="wkbar"><button class="ar" data-wk="-1">‹</button><b>${label(S.week)} – ${label(addDays(S.week, 6))}</b><button class="ar" data-wk="1">›</button><button class="btn ghost sm" data-wk="0">This week</button>${extra}</div>`; }
export function wireWeek() { $$("[data-wk]").forEach(b => b.onclick = async () => { const d = +b.dataset.wk; S.week = d === 0 ? monOf(today()) : addDays(S.week, d * 7); await loadAll(); render(); }); }
export const scoreData = () => ({ shifts: S.shifts, sods: S.sods, eods: S.eods, marks: S.marks, entries: S.entries, feed: S.feed, ovs: S.ovs, runsBy: S.runsBy });

/* ================= LIVE ================= */
function liveTab() {
  const n = nzNow(); const t = n.date; const R = S.C.rules;
  const todays = S.shifts.filter(s => s.day === t && s.driver && s.run !== "BU");
  const byDrv = dayShifts(todays, S.runsBy);
  const cards = S.drivers.filter(d => byDrv[t] || true).map(d => {
    const D = dayShifts(todays.filter(s => s.driver === d.id), S.runsBy, d.id)[t]; if (!D) return "";
    const sod = D.segs.map(x => S.sodBy[x.shift.id]).find(Boolean);
    const runs = D.segs.filter(x => !x.sort);
    const sodDue = D.start + R.sodGrace; const sodMin = sod ? nzNow(new Date(sod.sent_at)).min : null;
    const sodSt = sod ? (sodMin > sodDue ? "late" : "ok") : n.min > sodDue ? "miss" : "due";
    const eods = runs.map(x => ({ x, e: S.eodBy[x.shift.id], due: (x.en ?? x.st) + R.eodHours * 60 }));
    const allDone = runs.length ? eods.every(r => r.e) : D.segs.some(x => S.eodBy[x.shift.id]);
    const cls = allDone ? "done ok" : sodSt === "miss" ? "miss" : sodSt === "late" ? "late" : sod ? "ok" : "";
    const loc = S.locs.find(l => l.driver === d.id);
    return `<div class="bcard ${cls}"><div class="row" style="justify-content:space-between"><span class="nm">${esc(d.name)}</span><span class="meta mono">${fmtT(D.start)}–${fmtT(D.end)}</span></div>
      <div>${D.segs.map(x => `<span class="tag ${x.sort ? "" : "van"}">${esc(x.sort ? S.runsBy[x.shift.run]?.label || "Sort" : x.shift.run)}${x.shift.van && !x.sort ? ` · ${esc(x.shift.van)}` : ""}</span>`).join(" ")}</div>
      <div>SOD ${sod ? `<span class="chip ${sodSt}">${fmtTime(sod.sent_at)}${sodSt === "late" ? ` +${sodMin - sodDue}m` : ""}</span>` : `<span class="chip ${sodSt}">${sodSt === "miss" ? `missing · due ${fmtT(sodDue)}` : `by ${fmtT(sodDue)}`}</span>`}</div>
      ${eods.map(r => `<div>EOD ${esc(r.x.shift.run)} ${r.e ? `<span class="chip ${nzNow(new Date(r.e.sent_at)).min > r.due ? "late" : "ok"}">${fmtTime(r.e.sent_at)}</span>` : `<span class="chip ${n.min > r.due ? "miss" : "due"}">${n.min > r.due ? "overdue" : `due ${fmtT(r.due)}`}</span>`}</div>`).join("")}
      ${taskLine(D, t, n)}
      ${loc ? `<div class="meta">📍 ${ago(loc.at)}</div>` : sod && !allDone ? `<div class="meta">📍 no location yet (app closed?)</div>` : ""}</div>`;
  }).join("");
  const open = S.alerts.filter(a => !a.resolved_at);
  return `${weekless()}
    <div class="card"><h2>Today · ${label(t)}<span>${todays.filter(s => s.driver).length ? `${Object.keys(dayShifts(todays, S.runsBy)).length ? new Set(todays.map(s => s.driver)).size : 0} drivers rostered` : "nobody rostered"}</span></h2>${cards ? `<div class="board">${cards}</div>` : `<p class="empty">No shifts today.</p>`}</div>
    <div class="grid2"><div class="card"><h2>Open alerts<span>${open.length}</span></h2>${open.length ? `<div class="list">${open.slice(0, 12).map(alertRow).join("")}</div>${open.length > 12 ? `<p class="meta">+${open.length - 12} more on the Alerts tab</p>` : ""}` : `<p class="empty">✓ Nothing open</p>`}</div>
    <div class="card"><h2>Where everyone is<span>between SOD and EOD · app open</span></h2><div class="map" id="map"></div><p class="hint">Dots update every couple of minutes while a driver's app is on screen. Grey = older than 10 minutes.</p></div></div>`;
}
function weekless() { return ""; }
function taskLine(D, t, n) {
  const out = [];
  for (const x of D.segs) if (!x.sort) for (const a of (x.shift.addons || [])) { const ad = S.addons.find(z => z.id === a); if (!ad?.task) continue; const done = x.shift.done?.[a]; const plan = x.shift.plan?.[a]; out.push(`<span class="chip ${done ? "ok" : plan ? "due" : "over"}">${esc(ad.short || ad.name)}${done ? ` ✓ ${fmtTime(done)}` : plan ? ` ~${fmtT(toMin(plan))}` : " no plan"}</span>`); }
  return out.length ? `<div class="row" style="gap:3px">${out.join("")}</div>` : "";
}
export function alertRow(a) { return `<div class="item ${a.kind.includes("miss") ? "crit" : "warn"}"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b>${esc(a.title)}</b>${a.body ? `<div class="meta">${esc(a.body)}</div>` : ""}<div class="m">${a.driver ? esc(nm(a.driver)) + " · " : ""}${ago(a.created_at)}</div></div>${a.resolved_at ? pill("resolved", "grey") : S.me.can("alerts") ? `<button class="btn ghost sm" data-resolve="${a.id}">Resolve</button>` : ""}</div></div>`; }
function wireLive() {
  $$("[data-resolve]").forEach(b => b.onclick = async () => { await q(sb.from("alerts").update({ resolved_at: new Date().toISOString(), resolved_by: S.me.id }).eq("id", b.dataset.resolve)); });
  const el = $("#map"); if (!el || !window.L) return;
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([-45.88, 170.4], 10);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap © CARTO", maxZoom: 19 }).addTo(map);
  const latest = {}; for (const l of S.locs) if (!latest[l.driver]) latest[l.driver] = l;
  const pts = Object.values(latest).filter(l => { const D = S.shifts.find(s => s.id === l.shift_id); return D ? !S.eodBy[D.id] : true; });
  for (const l of pts) { const stale = Date.now() - new Date(l.at) > 600e3; L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "", html: `<div class="mk ${stale ? "stale" : ""}">${esc(fnm(l.driver))}</div>`, iconAnchor: [20, 12] }) }).addTo(map).bindPopup(`<b>${esc(nm(l.driver))}</b><br>${esc(fmtTs(l.at))}${l.speed ? `<br>${Math.round(l.speed * 3.6)} km/h` : ""}`); }
  if (pts.length) map.fitBounds(L.latLngBounds(pts.map(l => [l.lat, l.lng])).pad(0.3), { maxZoom: 13 });
}

/* ================= ALERTS ================= */
function alertsTab() {
  const open = S.alerts.filter(a => !a.resolved_at), done = S.alerts.filter(a => a.resolved_at);
  const rem = S.set.reminders || {};
  return `<div class="card"><h2>Open<span>${open.length}</span></h2>${open.length ? `<div class="list">${open.map(alertRow).join("")}</div><button class="btn ghost sm" id="resolve-all">Resolve all</button>` : `<p class="empty">✓ Nothing open</p>`}</div>
    <div class="card"><h2>How alerts work</h2><p class="hint">Every minute the system checks: SOD not in by rostered start + ${S.C.rules.sodGrace} min · EOD not in ${S.C.rules.eodHours} h after a run finishes · timing windows due soon or missed · roster changes not confirmed before the run starts · vehicle checks due Thursday 5pm. Each alert appears here, pings the driver's phone, and (when email chasing is on) emails the driver once.</p>
      <label class="chk ${rem.enabled ? "on" : ""}"><input type="checkbox" id="rem-on" ${rem.enabled ? "checked" : ""} ${S.me.can("people") ? "" : "disabled"}>Email drivers automatically when a post is late (between ${esc(rem.from || "07:00")} and ${esc(rem.to || "20:00")})</label></div>
    <div class="card"><h2>Resolved recently<span>${done.length}</span></h2>${done.length ? `<div class="list">${done.slice(0, 30).map(alertRow).join("")}</div>` : `<p class="empty">Nothing yet</p>`}</div>`;
}
function wireAlerts() {
  $$("[data-resolve]").forEach(b => b.onclick = async () => { await q(sb.from("alerts").update({ resolved_at: new Date().toISOString(), resolved_by: S.me.id }).eq("id", b.dataset.resolve)); });
  $("#resolve-all")?.addEventListener("click", async () => { await q(sb.from("alerts").update({ resolved_at: new Date().toISOString(), resolved_by: S.me.id }).is("resolved_at", null)); toast("Resolved", "ok"); });
  $("#rem-on")?.addEventListener("change", async e => { await q(sb.from("settings").upsert({ key: "reminders", value: { ...(S.set.reminders || {}), enabled: e.target.checked } })); toast("Saved", "ok"); });
}

/* ================= MESSAGES ================= */
function messagesTab() {
  const rec = Object.groupBy ? Object.groupBy(S.recips, r => r.message_id) : S.recips.reduce((o, r) => ((o[r.message_id] ??= []).push(r), o), {});
  return `<div class="card"><h2>New message</h2><form id="mf" class="frm"><div class="full row">${S.drivers.map(d => `<label class="chk"><input type="checkbox" name="to" value="${d.id}">${esc(first(d.name))}</label>`).join("")}<button type="button" class="btn ghost sm" id="all-on">Everyone</button><button type="button" class="btn ghost sm" id="all-off">None</button></div>
    <label class="f full">Message<textarea class="in" id="body" rows="3" required placeholder="e.g. Depot reminder: no parking past the bike shed."></textarea></label>
    <label class="chk full"><input type="checkbox" id="confirm">Ask each driver to tap "Got it"</label><label class="chk full"><input type="checkbox" id="push" checked>Also send a phone notification</label><button class="btn full" type="submit">Send</button></form></div>
    <div class="card"><h2>Sent<span>${S.msgs.length}</span></h2><div class="list">${S.msgs.map(m => { const rs = rec[m.id] || []; const read = rs.filter(r => r.read_at).length, conf = rs.filter(r => r.confirmed_at).length;
      return `<div class="item"><div class="m">${fmtTs(m.created_at)} · ${esc(fnm(m.sender))} → ${rs.length === S.drivers.length ? "everyone" : rs.map(r => fnm(r.person)).join(", ")}</div><div style="white-space:pre-wrap">${esc(m.body)}</div>
        <div class="row" style="gap:3px">${rs.map(r => `<span class="chip ${r.confirmed_at ? "ok" : r.read_at ? "due" : "over"}" title="${r.read_at ? "read " + fmtTs(r.read_at) : "not read yet"}">${esc(fnm(r.person))} ${r.confirmed_at ? "✓✓" : r.read_at ? "✓" : "·"}</span>`).join("")}</div>
        <div class="meta">${read} of ${rs.length} read${m.needs_confirm ? ` · ${conf} confirmed` : ""} · ✓ read · ✓✓ confirmed</div></div>`; }).join("") || `<p class="empty">Nothing sent yet</p>`}</div></div>`;
}
function wireMessages() {
  const f = $("#mf"); $("#all-on").onclick = () => $$("input[name=to]", f).forEach(c => c.checked = true); $("#all-off").onclick = () => $$("input[name=to]", f).forEach(c => c.checked = false);
  $$(".chk input", f).forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
  f.onsubmit = async e => { e.preventDefault(); const to = $$("input[name=to]:checked", f).map(c => c.value); if (!to.length) return toast("Pick who it goes to", "err");
    const body = $("#body").value.trim(); const msg = await q(sb.from("messages").insert({ sender: S.me.id, body, needs_confirm: $("#confirm").checked }).select().single());
    await q(sb.from("message_recipients").insert(to.map(p => ({ message_id: msg.id, person: p }))));
    if ($("#push").checked) fn("notify", { type: "message", message_id: msg.id }).catch(() => { }); toast("Sent", "ok"); };
}

/* ================= LEAVE ================= */
const LEAVE_T = { annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave", bereave: "Bereavement leave", dayoff: "Day off request", other: "Other" };
function leaveTab() {
  const pend = S.leave.filter(l => l.status === "pending"), rest = S.leave.filter(l => l.status !== "pending");
  const row = l => `<div class="item ${l.status === "pending" ? "warn" : l.status === "approved" ? "ok" : l.status === "declined" ? "crit" : ""}"><div class="row" style="justify-content:space-between"><b>${esc(nm(l.driver))} · ${esc(LEAVE_T[l.type] || l.type)}</b>${pill(l.status, l.status === "approved" ? "ok" : l.status === "declined" ? "crit" : l.status === "pending" ? "warn" : "grey")}</div>
    <div class="meta mono">${label(l.date_from, true)}${l.date_to !== l.date_from ? ` – ${label(l.date_to, true)}` : ""}${l.part !== "full" ? ` · ${l.part === "AM" ? "morning off" : "afternoon off"}` : ""} · asked ${fmtTs(l.created_at)}${l.acked_email_at ? " · received email sent" : ""}</div>${l.notes ? `<div>${esc(l.notes)}</div>` : ""}
    ${l.status === "pending" ? `<div class="row"><input class="in" placeholder="Reply to the driver (optional)" data-reply="${l.id}" style="flex:1 1 200px"><button class="btn sm" data-decide="approved" data-id="${l.id}">Approve</button><button class="btn sm crit" data-decide="declined" data-id="${l.id}">Decline</button></div>` : l.reply ? `<div class="meta">Reply: ${esc(l.reply)}${l.decided_by ? ` · by ${esc(fnm(l.decided_by))}` : ""}</div>` : ""}</div>`;
  return `<div class="card"><h2>Waiting<span>${pend.length}</span></h2>${pend.length ? `<div class="list">${pend.map(row).join("")}</div>` : `<p class="empty">✓ Nothing waiting</p>`}<p class="hint">Approving sends the driver an email and a notification, and blocks them on the Run Board for those days.</p></div>
    <div class="card"><h2>Add leave by hand</h2><form id="lf" class="frm"><label class="f">Driver<select class="in" id="l-drv">${opt(S.drivers.map(d => [d.id, d.name]))}</select></label><label class="f">Type<select class="in" id="l-type">${opt(Object.entries(LEAVE_T))}</select></label><label class="f">From<input class="in" type="date" id="l-from" required></label><label class="f">To<input class="in" type="date" id="l-to" required></label><label class="f full">Note<input class="in" id="l-note" placeholder="e.g. told me by text"></label><button class="btn full" type="submit">Add as approved</button></form></div>
    <div class="card"><h2>History<span>${rest.length}</span></h2><div class="list">${rest.slice(0, 40).map(row).join("") || `<p class="empty">Nothing yet</p>`}</div></div>`;
}
function wireLeave() {
  $$("[data-decide]").forEach(b => b.onclick = async () => { const id = b.dataset.id; const reply = $(`[data-reply="${id}"]`)?.value || null; await q(sb.from("leave_requests").update({ status: b.dataset.decide, decided_by: S.me.id, decided_at: new Date().toISOString(), reply }).eq("id", id)); fn("notify", { type: "leave_decided", leave_id: id }).catch(() => { }); toast(b.dataset.decide === "approved" ? "Approved" : "Declined", "ok"); });
  $("#lf").onsubmit = async e => { e.preventDefault(); await q(sb.from("leave_requests").insert({ driver: $("#l-drv").value, type: $("#l-type").value, date_from: $("#l-from").value, date_to: $("#l-to").value, notes: $("#l-note").value || `Entered by ${first(S.me.name)}`, status: "approved", decided_by: S.me.id, decided_at: new Date().toISOString(), acked_email_at: new Date().toISOString() })); toast("Added", "ok"); };
  // RLS: drivers insert their own leave; staff with the leave permission insert via the leave_upd policy? No: inserting for others needs leave perm — handled by leave_ins_staff policy
}

/* ================= FLEET ================= */
function fleetTab() {
  const wk = monOf(today()); const R = S.C.rules;
  const st = d => { if (!d) return pill("not set", "grey"); const n = Math.round((new Date(d) - new Date(today())) / 86400000); return n < 0 ? pill("overdue", "crit") : n <= R.dueSoonDays ? pill(`due in ${n}d`, "warn") : pill("✓", "ok"); };
  return `<div class="card"><h2>WOF, rego and RUCs<span>due soon = within ${R.dueSoonDays} days or under ${R.rucSoonKm} km</span></h2><div class="scroll"><table class="dt"><tr><th>Van</th><th>Model</th><th>WOF</th><th>Rego</th><th>RUCs</th><th>Odometer</th><th>Responsible</th><th></th></tr>
    ${S.vans.filter(v => v.plate !== "OTHER").map(v => { const chk = S.vchk.filter(c => c.van === v.plate).sort((a, b) => b.at.localeCompare(a.at))[0]; const odo = chk?.odometer && (!v.odometer_at || chk.at.slice(0, 10) >= v.odometer_at) ? chk.odometer : v.odometer; const left = v.ruc_paid_to && odo ? v.ruc_paid_to - odo : null;
      return `<tr><td><b class="mono">${esc(v.plate)}</b>${v.active ? "" : pill("inactive", "grey")}</td><td>${esc(v.model || "")}</td><td>${v.wof_due ? label(v.wof_due, true) : ""} ${v.wof_failed ? pill("failed", "crit") : st(v.wof_due)}</td><td>${v.rego_due ? label(v.rego_due, true) : ""} ${st(v.rego_due)}</td>
        <td>${v.no_ruc ? "petrol, no RUCs" : v.ruc_paid_to ? `paid to ${v.ruc_paid_to.toLocaleString()} km${left != null ? `<br>${left.toLocaleString()} km left ${left <= 0 ? pill("overdue", "crit") : left <= R.rucSoonKm ? pill("low", "warn") : pill("✓", "ok")}` : ""}` : pill("not set", "grey")}</td>
        <td>${odo ? `${odo.toLocaleString()} km` : "—"}${chk?.odometer ? `<div class="meta">check ${label(chk.at.slice(0, 10))}</div>` : ""}</td><td>${v.responsible ? esc(nm(v.responsible)) : "<span class='meta'>main driver</span>"}</td><td><button class="btn ghost sm" data-van="${v.plate}">Edit</button></td></tr>`; }).join("")}</table></div>
    <button class="btn ghost sm" id="van-add">+ Add a van</button></div>
    <div class="card"><h2>Weekly vehicle checks<span>due Thu ${esc(R.vchkTime)} · week of ${label(wk)}</span></h2><div class="scroll"><table class="dt"><tr><th>Van</th>${[0, 1, 2, 3, 4, 5].map(i => `<th>${label(addDays(wk, -7 * i)).slice(4)}</th>`).join("")}</tr>
      ${S.vans.filter(v => v.active && v.plate !== "OTHER").map(v => `<tr><td class="mono"><b>${esc(v.plate)}</b></td>${[0, 1, 2, 3, 4, 5].map(i => { const w = addDays(wk, -7 * i); const c = S.vchk.find(x => x.van === v.plate && x.week_start === w); return `<td>${c ? `<button class="chip ok" data-vchk="${c.id}">${esc(fnm(c.driver))} ✓</button>` : `<span class="chip ${i === 0 && dow(today()) < 3 ? "due" : "miss"}">${i === 0 && dow(today()) < 3 ? "due" : "—"}</span>`}</td>`; }).join("")}</tr>`).join("")}</table></div></div>`;
}
function wireFleet() {
  const edit = plate => { const v = S.vansBy[plate] || { plate: "", active: true };
    sheet(`<h3>${plate ? esc(plate) : "New van"}</h3><form class="frm" id="vf">${plate ? "" : `<label class="f">Plate<input class="in" id="plate" required style="text-transform:uppercase"></label>`}<label class="f">Model<input class="in" id="model" value="${esc(v.model || "")}"></label><label class="f">Colour<input class="in" id="colour" value="${esc(v.colour || "")}"></label>
      <label class="f">WOF expires<input class="in" type="date" id="wof" value="${v.wof_due || ""}"></label><label class="f">Rego expires<input class="in" type="date" id="rego" value="${v.rego_due || ""}"></label>
      <label class="f">RUCs paid to (km)<input class="in" id="ruc" inputmode="numeric" value="${v.ruc_paid_to ?? ""}"></label><label class="f">Odometer (km)<input class="in" id="odo" inputmode="numeric" value="${v.odometer ?? ""}"></label>
      <label class="f full">Responsible for the weekly check<select class="in" id="resp">${opt([["", "Main driver from the roster"], ...S.drivers.map(d => [d.id, d.name])], v.responsible || "")}</select></label>
      <label class="chk"><input type="checkbox" id="noruc" ${v.no_ruc ? "checked" : ""}>Petrol (no RUCs)</label><label class="chk"><input type="checkbox" id="woff" ${v.wof_failed ? "checked" : ""}>WOF failed</label><label class="chk"><input type="checkbox" id="active" ${v.active ? "checked" : ""}>Active</label>
      <button class="btn full" type="submit">Save</button></form>`, (bg, close) => { bg.querySelector("#vf").onsubmit = async e => { e.preventDefault(); const g = id => bg.querySelector("#" + id); const row = { plate: plate || g("plate").value.trim().toUpperCase(), name: plate || g("plate").value.trim().toUpperCase(), model: g("model").value || null, colour: g("colour").value || null, wof_due: g("wof").value || null, rego_due: g("rego").value || null, ruc_paid_to: g("ruc").value ? +g("ruc").value : null, odometer: g("odo").value ? +g("odo").value : null, odometer_at: g("odo").value && +g("odo").value !== v.odometer ? today() : v.odometer_at || null, responsible: g("resp").value || null, no_ruc: g("noruc").checked, wof_failed: g("woff").checked, active: g("active").checked };
        const { error } = await sb.from("vans").upsert(row); if (error) return toast(error.message, "err"); close(); toast("Saved", "ok"); }; }); };
  $$("[data-van]").forEach(b => b.onclick = () => edit(b.dataset.van)); $("#van-add")?.addEventListener("click", () => edit(""));
  $$("[data-vchk]").forEach(b => b.onclick = async () => { const c = S.vchk.find(x => x.id === b.dataset.vchk); const urls = []; for (const p of c.photos || []) { const { data } = await sb.storage.from("vchk").createSignedUrl(p, 3600); if (data) urls.push(data.signedUrl); }
    sheet(`<h3>${esc(c.van)} · ${esc(nm(c.driver))}</h3><p class="meta">${fmtTs(c.at)}</p><dl class="kv"><dt>Odometer</dt><dd>${c.odometer?.toLocaleString() || "—"} km</dd><dt>RUCs left</dt><dd>${c.rucs_left?.toLocaleString() || "—"}</dd><dt>Washed</dt><dd>${c.washed ? "Yes" : "No"}</dd><dt>Tyres</dt><dd>${c.tyres_ok ? "OK" : "Check"}</dd><dt>Vault</dt><dd>${c.vault_ok ? "OK" : "Check"}</dd><dt>Bodywork</dt><dd>${esc(c.bodywork || "—")}</dd><dt>Service</dt><dd>${esc(c.service_due || "—")}</dd><dt>Notes</dt><dd>${esc(c.notes || "—")}</dd></dl><div class="row">${urls.map(u => `<a href="${u}" target="_blank"><img src="${u}" style="width:140px;height:140px;object-fit:cover;border-radius:8px"></a>`).join("") || "<span class='meta'>No photos</span>"}</div>`); });
}

/* ================= TIMING RULES ================= */
function timingTab() {
  const win = r => { const f = toMin(r.opens), t = toMin(r.closes); return f != null && t != null ? `${fmtT(f)} – ${fmtT(t)}` : t != null ? `by ${fmtT(t)}` : f != null ? `from ${fmtT(f)}` : "any time"; };
  const days = r => r.days.length === 7 ? "Every day" : JSON.stringify(r.days) === "[1,2,3,4,5]" ? "Mon–Fri" : JSON.stringify(r.days) === "[1,2,3,4,5,6]" ? "Mon–Sat" : r.days.map(d => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(", ");
  return `<div class="card"><h2>Timing rules<span>${S.rules.length}</span></h2><p class="hint">A window for something to be done on a run. Each rule is an add-on on the Run Board, so you pick which run does it each day. Only the driver on the run it is ticked on sees the window (a rule for one run goes to that run automatically). Alerts fire when a window is about to close or was missed.</p>
    <div class="scroll"><table class="dt"><tr><th>Name</th><th>Window</th><th>Runs</th><th>Add-on</th><th>Days</th><th></th></tr>${S.rules.map(r => `<tr><td><b>${esc(r.name)}</b>${r.note ? `<div class="meta">${esc(r.note)}</div>` : ""}${r.active ? "" : pill("off", "grey")}</td><td class="mono">${win(r)}</td><td>${r.runs.includes("ALL") ? "Any run" : r.runs.map(c => S.runsBy[c]?.label || c).join(" / ")}</td><td class="meta">${r.addon?.startsWith("tw_") ? "own add-on" : "rides on " + esc(addName(r.addon))}</td><td>${days(r)}</td><td><button class="btn ghost sm" data-rule="${r.id}">Edit</button></td></tr>`).join("")}</table></div>
    <button class="btn ghost sm" id="rule-add">+ New rule</button></div>`;
}
function wireTiming() {
  const edit = id => { const r = S.rules.find(x => x.id === id) || { id: "", name: "", opens: "", closes: "", runs: [], addon: "", days: [1, 2, 3, 4, 5], note: "", active: true };
    const codes = S.runs.filter(x => x.code !== "BU").map(x => x.code);
    sheet(`<h3>${id ? "Edit rule" : "New rule"}</h3><form class="frm" id="rf"><label class="f full">Name<input class="in" id="name" value="${esc(r.name)}" required placeholder="e.g. Game plan posted"></label><label class="f">Window opens<input class="in" type="time" id="opens" value="${r.opens ? r.opens.slice(0, 5) : ""}"></label><label class="f">Window closes<input class="in" type="time" id="closes" value="${r.closes ? r.closes.slice(0, 5) : ""}"></label>
      <div class="full"><div class="meta mono" style="margin-bottom:6px">RUNS THAT CAN DO IT</div><div class="row">${["ALL", ...codes].map(c => `<label class="chk ${r.runs.includes(c) ? "on" : ""}"><input type="checkbox" name="run" value="${c}" ${r.runs.includes(c) ? "checked" : ""}>${c === "ALL" ? "Any run" : esc(c)}</label>`).join("")}</div></div>
      <label class="f full">Run Board add-on<select class="in" id="addon">${opt([["", "Its own add-on (this rule's name)"], ...S.addons.filter(a => !a.id.startsWith("tw_")).map(a => [a.id, "Rides on: " + a.name])], r.addon?.startsWith("tw_") ? "" : r.addon || "")}</select></label>
      <div class="full"><div class="meta mono" style="margin-bottom:6px">DAYS</div><div class="row">${[1, 2, 3, 4, 5, 6, 7].map(d => `<label class="chk ${r.days.includes(d) ? "on" : ""}"><input type="checkbox" name="day" value="${d}" ${r.days.includes(d) ? "checked" : ""}>${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]}</label>`).join("")}</div></div>
      <label class="f full">Note for drivers<input class="in" id="note" value="${esc(r.note || "")}"></label><label class="chk full"><input type="checkbox" id="active" ${r.active ? "checked" : ""}>Active</label><button class="btn full" type="submit">Save</button></form>`, (bg, close) => {
      bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
      bg.querySelector("#rf").onsubmit = async e => { e.preventDefault(); const g = x => bg.querySelector("#" + x); const runs = [...bg.querySelectorAll("input[name=run]:checked")].map(i => i.value); const days = [...bg.querySelectorAll("input[name=day]:checked")].map(i => +i.value);
        if (!runs.length) return toast("Tick at least one run", "err"); if (!days.length) return toast("Tick at least one day", "err"); if (!g("opens").value && !g("closes").value) return toast("Set when the window opens or closes", "err");
        const rid = id || "tw" + Date.now().toString(36); let addon = g("addon").value;
        if (!addon) { addon = "tw_" + rid; await q(sb.from("addons").upsert({ id: addon, name: g("name").value, short: g("name").value.slice(0, 12), task: true, runs: runs.includes("ALL") ? codes : runs })); }
        const { error } = await sb.from("timing_rules").upsert({ id: rid, name: g("name").value, opens: g("opens").value || null, closes: g("closes").value || null, runs, addon, days, note: g("note").value || null, active: g("active").checked }); if (error) return toast(error.message, "err"); close(); toast("Saved · drivers see it straight away", "ok"); }; }); };
  $$("[data-rule]").forEach(b => b.onclick = () => edit(b.dataset.rule)); $("#rule-add")?.addEventListener("click", () => edit(""));
}

/* ================= PEOPLE & SETTINGS ================= */
function peopleTab() {
  const staff = S.people.filter(p => p.role !== "driver" || (p.perms || []).length), drivers = S.people.filter(p => p.role === "driver" && !(p.perms || []).length);
  const row = p => `<tr><td><b>${esc(p.name)}</b><div class="meta">${esc(p.email || "no email")}${p.phone ? " · " + esc(p.phone) : ""}</div></td><td>${pill(p.role, p.role === "owner" ? "accent" : "")} ${p.active ? "" : pill("paused", "crit")}${p.cleared ? pill("not rostered", "grey") : ""}${p.user_id ? pill("signed in", "ok") : pill("never signed in", "grey")}</td><td class="meta">${(p.perms || []).map(a => AREA_LABEL[a]?.split(",")[0].split(" (")[0] || a).join(", ")}</td><td><button class="btn ghost sm" data-person="${p.id}">Edit</button></td></tr>`;
  const L = S.set.links || {};
  return `<div class="card"><h2>Staff<span>${staff.length}</span></h2><div class="scroll"><table class="dt"><tr><th>Name</th><th>Role</th><th>Areas</th><th></th></tr>${staff.map(row).join("")}</table></div></div>
    <div class="card"><h2>Drivers<span>${drivers.length}</span></h2><div class="scroll"><table class="dt"><tr><th>Name</th><th>Status</th><th></th><th></th></tr>${drivers.map(row).join("")}</table></div><button class="btn ghost sm" id="person-add">+ Add a person</button><p class="hint">A new person signs in with the email you enter here. Tick areas to make someone staff (they'll be asked to set up two-factor on first sign-in).</p></div>
    <div class="card"><h2>Settings</h2><form class="frm" id="sf"><label class="f full">Vault (Damstra) link shown to drivers<input class="in" id="vault" value="${esc(L.vault || "")}"></label><label class="f">SOD grace (min)<input class="in" id="sodGrace" inputmode="numeric" value="${S.C.rules.sodGrace}"></label><label class="f">EOD due (hours after finish)<input class="in" id="eodHours" inputmode="decimal" value="${S.C.rules.eodHours}"></label><label class="f">Admin: % off per late/missing post<input class="in" id="perEvent" inputmode="decimal" value="${S.C.rules.perEvent}"></label><label class="f">Admin floor %<input class="in" id="adminFloor" inputmode="numeric" value="${S.C.rules.adminFloor}"></label><label class="f">Mistake: % off Accuracy<input class="in" id="mistakePct" inputmode="numeric" value="${S.C.rules.mistakePct}"></label><label class="f">Default wage $/h<input class="in" id="hourRate" inputmode="decimal" value="${S.C.rules.hourRate}"></label>
      <label class="f">Weights: Admin<input class="in" id="w_admin" value="${S.C.weights.admin}"></label><label class="f">Efficiency<input class="in" id="w_eff" value="${S.C.weights.eff}"></label><label class="f">Accuracy<input class="in" id="w_acc" value="${S.C.weights.acc}"></label><label class="f">Safety<input class="in" id="w_safe" value="${S.C.weights.safe}"></label><button class="btn full" type="submit">Save settings</button></form></div>
    <div class="card"><h2>Activity log</h2><button class="btn ghost sm" id="log-load">Show the last 100 changes</button><div id="log"></div></div>`;
}
function wirePeople() {
  const edit = id => { const p = S.peopleBy[id] || { id: "", name: "", email: "", role: "driver", perms: [], active: true, cleared: false };
    sheet(`<h3>${id ? esc(p.name) : "Add a person"}</h3><form class="frm" id="pf">${id ? "" : `<label class="f">Short id<input class="in" id="pid" required placeholder="e.g. TM" pattern="[A-Za-z0-9_-]+"></label>`}<label class="f ${id ? "full" : ""}">Name<input class="in" id="name" value="${esc(p.name)}" required></label><label class="f full">Email (they sign in with this)<input class="in" type="email" id="email" value="${esc(p.email || "")}"></label><label class="f">Phone<input class="in" id="phone" value="${esc(p.phone || "")}"></label><label class="f">Role<select class="in" id="role" ${p.role === "owner" ? "disabled" : ""}>${opt([["driver", "Driver"], ["admin", "Admin"], ["fleet", "Fleet"], ["owner", "Owner"]], p.role)}</select></label>
      <label class="f">Wage $/h<input class="in" id="rate" inputmode="decimal" value="${p.rate ?? ""}" placeholder="default ${S.C.rules.hourRate}"></label><label class="f">Started<input class="in" type="date" id="started" value="${p.started || ""}"></label><label class="f">Licence class<input class="in" id="lc" value="${esc(p.licence_class || "")}"></label><label class="f">Licence expires<input class="in" type="date" id="le" value="${p.licence_expiry || ""}"></label><label class="f">DG expires<input class="in" type="date" id="dg" value="${p.dg_expiry || ""}"></label><label class="f">Notes<input class="in" id="notes" value="${esc(p.notes || "")}"></label>
      <div class="full"><div class="meta mono" style="margin-bottom:6px">STAFF AREAS</div><div class="list">${AREAS.map(a => `<label class="chk ${(p.perms || []).includes(a) ? "on" : ""}" style="border-radius:10px"><input type="checkbox" name="perm" value="${a}" ${(p.perms || []).includes(a) ? "checked" : ""} ${p.role === "owner" ? "disabled" : ""}>${esc(AREA_LABEL[a])}</label>`).join("")}</div></div>
      <label class="chk"><input type="checkbox" id="active" ${p.active ? "checked" : ""}>Active (can sign in)</label><label class="chk"><input type="checkbox" id="cleared" ${p.cleared ? "checked" : ""}>Not rostered any more</label><label class="chk"><input type="checkbox" id="payx" ${p.pay_exclude ? "checked" : ""}>Leave out of labour figures</label><button class="btn full" type="submit">Save</button></form>`, (bg, close) => {
      bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
      bg.querySelector("#pf").onsubmit = async e => { e.preventDefault(); const g = x => bg.querySelector("#" + x); const row = { id: id || g("pid").value.trim(), name: g("name").value.trim(), email: g("email").value.trim().toLowerCase() || null, phone: g("phone").value || null, role: g("role").value, perms: [...bg.querySelectorAll("input[name=perm]:checked")].map(i => i.value), rate: g("rate").value ? +g("rate").value : null, started: g("started").value || null, licence_class: g("lc").value || null, licence_expiry: g("le").value || null, dg_expiry: g("dg").value || null, notes: g("notes").value || null, active: g("active").checked, cleared: g("cleared").checked, pay_exclude: g("payx").checked };
        if (p.role === "owner") { row.role = "owner"; row.perms = p.perms || []; }
        const { error } = await sb.from("people").upsert(row); if (error) return toast(error.message, "err"); close(); toast("Saved", "ok"); }; }); };
  $$("[data-person]").forEach(b => b.onclick = () => edit(b.dataset.person)); $("#person-add")?.addEventListener("click", () => edit(""));
  $("#sf").onsubmit = async e => { e.preventDefault(); const g = x => $("#" + x).value; await q(sb.from("settings").upsert([{ key: "links", value: { ...(S.set.links || {}), vault: g("vault") } }, { key: "rules", value: { ...(S.set.rules || {}), sodGrace: +g("sodGrace"), eodHours: +g("eodHours"), perEvent: +g("perEvent"), adminFloor: +g("adminFloor"), mistakePct: +g("mistakePct"), hourRate: +g("hourRate") } }, { key: "weights", value: { admin: +g("w_admin"), eff: +g("w_eff"), acc: +g("w_acc"), safe: +g("w_safe") } }])); toast("Saved", "ok"); };
  $("#log-load")?.addEventListener("click", async () => { const rows = await q(sb.from("activity_log").select("*").order("created_at", { ascending: false }).limit(100)); $("#log").innerHTML = `<div class="scroll"><table class="dt"><tr><th>When</th><th>Who</th><th>What</th></tr>${rows.map(r => `<tr><td class="mono">${fmtTs(r.created_at)}</td><td>${esc(r.actor ? nm(r.actor) : r.actor_email || "system")}</td><td><b>${esc(r.action)}</b> <span class="meta">${esc(r.detail || "")}</span></td></tr>`).join("")}</table></div>`; });
}
