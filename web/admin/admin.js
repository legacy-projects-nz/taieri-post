// Taieri Ops · owner / staff portal
import { sb, q, me, nzNow, today, addDays, dow, dayName, monOf, label, toMin, fmtT, fmt24, fmtTs, fmtTime, ago, esc, $, $$, h, toast, pill, first, col, pct, live, debounce, isSort, settings as loadSettings, signOut, hours, nzToIso, avg, errCtx, reportError } from "/shared/core.js";
import { requireUser } from "/shared/auth.js";
import { AREAS, AREA_LABEL } from "/shared/config.js";
import { cfg, dayShifts, itemsFor, scoreFor, payBand, money, fortnight, itemNote, STATE_LABEL, addName, segTimes, setEvidence, setAddonNames, meetRule, meetOn, eodState } from "/shared/score.js";
import { runBoardTab, wireRunBoard } from "/admin/runboard.js";
import { scorecardTab, wireScorecard } from "/admin/scorecard.js";
import { fixTab, wireFix, fixCount } from "/admin/fix.js";
import { actBtns, allBar, addMark } from "/admin/settle.js";
import { routesTab, wireRoutes } from "/admin/routes.js";
import { allowancesTab, wireAllowances } from "/admin/allowances.js";
import { pickupsTab, wirePickups } from "/admin/pickups.js";
import { sickDefault, paidPill, SIX_MONTHS_NOTE } from "/admin/sick.js";
import { liveTab as liveTab2, wireLive as wireLive2 } from "/admin/live.js";
import { bind } from "/admin/detail.js";
import { errorCard } from "/admin/errorcard.js";
import { hazardsTab, wireHazards, hazardBadge } from "/admin/hazards.js";

export const S = { me: null, tab: (h => h === "alerts" ? "fix" : h)(location.hash.slice(1)) || "live", week: monOf(today()), set: {}, C: null, runs: [], runsBy: {}, vans: [], vansBy: {}, addons: [], rules: [], people: [], peopleBy: {}, shifts: [], sods: [], eods: [], marks: [], entries: [], feed: [], ovs: [], changes: [], items: [], acks: [], sent: [], msgs: [], recips: [], leave: [], alerts: [], locs: [], skills: [], notes: [], vchk: [], log: [] };
const app = $("#app");
export const fn = async (name, body) => { const { data, error } = await sb.functions.invoke(name, { body }); if (error) throw error; return data; };

(async () => {
  try { S.me = await requireUser(app, { staff: true }); } catch { return; }
  if (!S.me.isStaff) { S.ro = true; S.tab = "runboard"; }   // drivers: the Run Board only, view only (the database blocks any change)
  errCtx({ app: "owner", person: S.me.id });
  // first load: if the connection drops, say so and keep trying instead of sitting on "Loading…"
  for (let i = 0; ; i++) {
    try { await loadAll(); break; }
    catch (e) { reportError("boot", e);
      app.innerHTML = `<div class="wrap"><div class="top"><div><div class="brand">Taieri Ops</div><h1>Can't connect</h1></div></div><div class="card"><p>The portal can't reach Taieri Post right now. Check your connection. It will keep trying on its own.</p><button class="btn" id="boot-retry">Try again now</button></div></div>`;
      await new Promise(r => { const t = setTimeout(r, Math.min(30000, 4000 * (i + 1))); const bt = $("#boot-retry"); if (bt) bt.onclick = () => { clearTimeout(t); bt.disabled = true; bt.textContent = "Trying…"; r(); }; }); }
  }
  render();
  live(["extra_time", "shifts", "sod", "eod", "alerts", "roster_changes", "roster_change_items", "change_acks", "messages", "message_recipients", "leave_requests", "entries", "marks", "vans", "people", "settings", "timing_rules", "addons", "vehicle_checks", "eff_overrides", "run_skills", "week_notes", "roster_sent", "breaks", "van_washes", "sod_requests", "hazards", "hazard_acks"], debounce(async (t) => { await loadAll(); render(true); }, 500), "ops");
  // safety net if a live update is missed (or skipped while a sheet was open): reload every 30 s and whenever the window comes back into focus
  const refresh = async () => { if (document.visibilityState === "hidden") return; const at = S._loadedAt; try { await loadAll({ ifStale: true }); if (S._loadedAt !== at) render(true); } catch (e) { console.warn(e); } };
  setInterval(refresh, 60000); window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); S.tab = (h === "alerts" ? "fix" : h) || "live"; render(); });
})();

// One load at a time: the 60 s timer, window focus, tab coming back and realtime updates often fire together — share the one in flight,
// and skip a timer/focus refresh if the data is under 10 s old.
let _inflight = null; S._loadedAt = 0;
export function loadAll(opts = {}) {
  if (_inflight) return _inflight;
  if (opts.ifStale && Date.now() - S._loadedAt < 10000) return Promise.resolve();
  _inflight = loadAllNow().then(() => { S._loadedAt = Date.now(); S._sd = null; }).finally(() => { _inflight = null; });
  return _inflight;
}
async function loadAllNow() {
  if (S.ro) return loadReadOnly();
  const t = today(); const wk = S.week; const mt = monOf(t); // ISO dates compare as strings (Math.min/max gave NaN, so weeks more than ~2 weeks out never loaded)
  let from = addDays(wk < mt ? wk : mt, -63); const to = addDays(wk > mt ? wk : mt, 20);
  if (S.tsRange === "custom" && S.tsFrom && S.tsFrom < from) from = S.tsFrom;   // dashboard dates further back than usual
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
    q(sb.from("entries").select("*").order("day", { ascending: false }).limit(3000)),
    q(sb.from("marks").select("*")),
    q(sb.from("nzpost_feed").select("*").gte("day", from)),
    q(sb.from("eff_overrides").select("*")),
    q(sb.from("locations").select("*").gte("at", new Date(Date.now() - 12 * 3600e3).toISOString()).order("at", { ascending: false }).limit(2000)),
    q(sb.from("run_skills").select("*")), q(sb.from("week_notes").select("*")), q(sb.from("vehicle_checks").select("*").gte("week_start", addDays(monOf(t), -42))),
  ]);
  Object.assign(S, { set, runs, vans, addons, rules, people, shifts, items, acks, sent, msgs, recips, leave, alerts, entries, marks, feed, ovs, locs, skills, notes, vchk }); setAddonNames(addons);
  S.C = cfg(set); S.runsBy = Object.fromEntries(runs.map(r => [r.code, r])); S.vansBy = Object.fromEntries(vans.map(v => [v.plate, v])); S.peopleBy = Object.fromEntries(people.map(p => [p.id, p]));
  const onRoster = new Set(shifts.map(s => s.driver)); // anyone who drives: drivers, Jeremy (owner, tracked separately), or whoever is on the roster
  S.drivers = people.filter(p => p.active && !p.cleared && (p.role === "driver" || p.role === "owner" || onRoster.has(p.id)));
  // second round, all at once (was one after another): SOD/EOD for the loaded shifts (by date range, not a 500-id list in the URL), washes, breaks, sign-in status
  const soft = (p, d) => p.then(r => r.error ? d : (r.data ?? d), () => d);
  const strip = rows => rows.map(({ shifts: _s, ...r }) => r);
  const [sods, eods, washes, breaks, ls, sodReqs, hazards, hzAcks, extra] = await Promise.all([
    q(sb.from("sod").select("*, shifts!inner(day)").gte("shifts.day", from).lte("shifts.day", to)).then(strip),
    q(sb.from("eod").select("*, shifts!inner(day)").gte("shifts.day", from).lte("shifts.day", to)).then(strip),
    soft(sb.from("van_washes").select("*").gte("at", new Date(Date.now() - 120 * 86400e3).toISOString()).order("at", { ascending: false }).limit(1000), []),
    soft(sb.from("breaks").select("*").gte("started_at", new Date(from + "T00:00:00+13:00").toISOString()).order("started_at", { ascending: false }).limit(3000), []),
    soft(sb.rpc("login_status"), []),
    soft(sb.from("sod_requests").select("*").gte("day", from).order("created_at", { ascending: false }), []),
    soft(sb.from("hazards").select("*").order("created_at", { ascending: false }).limit(3000), []),
    soft(sb.from("hazard_acks").select("*").limit(20000), []),
    soft(sb.from("extra_time").select("*").gte("day", from).order("created_at", { ascending: false }), []),
  ]);
  S.extra = extra || [];
  S.sods = sods; S.eods = eods; S.washes = washes; S.breaks = breaks; S.sodReqs = sodReqs || []; S.hazards = hazards || []; S.hzAcks = hzAcks || [];
  S.login = {}; for (const l of ls || []) S.login[l.person_id] = l;   // who is signed in to the app
  S.sodBy = Object.fromEntries(S.sods.map(s => [s.shift_id, s])); S.eodBy = Object.fromEntries(S.eods.map(e => [e.shift_id, e]));
  setEvidence(S.shifts, S.eods);   // average figures per run & weekday → the estimate used until each EOD is in
}

const TABS = [["live", "Live", "scorecard"], ["runboard", "Run Board", "roster"], ["classic", "Run Board (classic)", "roster"], ["scorecard", "Scorecard", "scorecard"], ["fix", "Fix posts", "scorecard"], ["routes", "Routes", "alerts"], ["allowances", "Allowances", "roster"], ["pickups", "Pick-ups", "roster"], ["hazards", "Hazards", "roster"], ["messages", "Messages", "messages"], ["leave", "Leave", "leave"], ["fleet", "Fleet", "fleet"], ["timing", "Timing rules", "timing"], ["people", "People", "people"], ["pay", "Penalties & pay", "people"]];
/* tabs that live behind the ☰ button at the end of the tab bar */
/* drivers' view-only Run Board: just what the board needs, from tables drivers may read (published weeks only) */
async function loadReadOnly() {
  const t = today(); const wk = S.week; const mt = monOf(t); const from = addDays(wk < mt ? wk : mt, -7), to = addDays(wk > mt ? wk : mt, 13);
  const soft = (p, d) => Promise.resolve(p).then(r => r?.error ? d : (r?.data ?? d), () => d);
  const [set, runs, vans, addons, rules, people, shifts, skills, leave, sods] = await Promise.all([
    loadSettings(), q(sb.from("runs").select("*").order("sort")), q(sb.from("vans").select("*").order("plate")), q(sb.from("addons").select("*")), soft(sb.from("timing_rules").select("*"), []),
    q(sb.from("people_public").select("id,name,role,active").order("name")), q(sb.from("shifts").select("*").gte("day", from).lte("day", to)),
    soft(sb.from("run_skills").select("*"), []), soft(sb.from("leave_requests").select("*"), []), soft(sb.from("sod").select("*"), []),
  ]);
  Object.assign(S, { set, runs, vans, addons, rules, people, shifts, skills, leave, sods, eods: [], items: [], acks: [], sent: [], notes: [], msgs: [], recips: [], alerts: [], entries: [], marks: [], feed: [], ovs: [], locs: [], vchk: [], washes: [], breaks: [], sodReqs: [], hazards: [], hzAcks: [], extra: [], login: {} });
  setAddonNames(addons); S.C = cfg(set); S.runsBy = Object.fromEntries(runs.map(r => [r.code, r])); S.vansBy = Object.fromEntries(vans.map(v => [v.plate, v])); S.peopleBy = Object.fromEntries(people.map(p => [p.id, p]));
  S.drivers = people.filter(p => p.active); S.sodBy = Object.fromEntries(S.sods.map(x => [x.shift_id, x])); S.eodBy = {};
}
const MENU_TABS = ["classic", "allowances", "fleet", "timing", "pay"];
/* collapsible boxes: on every tab, every box after the first starts collapsed; tap its heading to open. Open/closed is kept while the page is open.
   "Shift right now" and "Add-ons right now" (ids rightnow*) can be collapsed too, wherever they sit, but start open. */
S.open ??= {};
function folds() {
  const cards = $$("#view .card").filter(c => !c.parentElement.closest(".card"));
  cards.forEach((c, i) => {
    if (i === 0 && !c.id.startsWith("rightnow")) return; const h = c.querySelector(":scope > h2"); if (!h) return;
    const key = S.tab + "|" + (c.id || [...h.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join("").trim() || i);
    if (!(key in S.open)) S.open[key] = c.id.startsWith("rightnow");
    c.classList.add("fold"); c.classList.toggle("shut", !S.open[key]);
    h.setAttribute("role", "button"); h.tabIndex = 0; h.setAttribute("aria-expanded", String(!!S.open[key]));
    const ch = document.createElement("i"); ch.className = "fchev" + (h.querySelector(":scope > span") ? "" : " solo"); ch.setAttribute("aria-hidden", "true"); h.appendChild(ch);
    const flip = e => { if (e.target.closest("button, a, input, select")) return; if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return; e.preventDefault();
      S.open[key] = !S.open[key]; c.classList.toggle("shut", !S.open[key]); h.setAttribute("aria-expanded", String(S.open[key]));
      if (S.open[key]) window.dispatchEvent(new Event("resize")); };   // lets the map redraw once its box opens
    h.addEventListener("click", flip); h.addEventListener("keydown", flip);
  });
}
export function render(soft = false) {
  if (soft && (document.activeElement?.matches("input,textarea,select") || $(".sheet-bg"))) return;
  const n = nzNow(); const tabs = S.ro ? [["runboard", "Run Board"]] : TABS.filter(([, , a]) => S.me.can(a));
  if (!tabs.some(([k]) => k === S.tab)) S.tab = tabs[0][0];
  const badge = { hazards: hazardBadge(), live: S.alerts.filter(a => !a.resolved_at).length + (S.me.isOwner ? (S.sodReqs || []).filter(r => r.status === "pending").length + (S.extra || []).filter(r => r.status === "pending").length : 0), leave: S.leave.filter(l => l.status === "pending").length, runboard: S.items.filter(i => i.roster_changes.status === "awaiting_approval").length, fix: S.me.can("scorecard") ? fixCount() : 0, alerts: S.alerts.filter(a => !a.resolved_at).length };
  app.innerHTML = `<div class="wrap">
    <div class="top"><div><div class="brand">${S.ro ? `Taieri Post · view only · <a href="/" style="color:inherit">back to my app</a>` : "Taieri Ops"}</div><h1>${({ live: "Live board", runboard: "Run Board", classic: "Run Board (classic)", scorecard: "Driver Scorecard", fix: "Fix posts", routes: "Routes", allowances: "Back-up & on-call allowances", pickups: "Pick-ups to invoice", hazards: "Hazard register", alerts: "Alerts & timings", messages: "Messages", leave: "Leave", fleet: "Fleet", timing: "Timing rules", people: "People & settings", pay: "Penalties & pay" })[S.tab]}</h1></div>
      <div class="upd">${S.me.can("scorecard") ? `<span class="row" style="gap:6px;justify-content:flex-end;margin-bottom:6px"><a class="btn ghost sm" href="/" style="flex:0 0 auto;text-decoration:none">Driver portals</a><button class="btn ghost sm" id="quick-err" style="flex:0 0 auto">+ Record</button></span>` : ""}<span class="dot live"></span>live · ${fmtT(n.min)}<br>${esc(first(S.me.name))} · <button class="linkbtn" id="signout">sign out</button></div></div>
    <nav class="nav">${tabs.filter(([k]) => !MENU_TABS.includes(k)).map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? "on" : ""}">${l}${badge[k] ? `<span class="b ${k === "runboard" ? "warn" : ""}">${badge[k]}</span>` : ""}</button>`).join("")}${tabs.some(([k]) => MENU_TABS.includes(k)) ? `<button id="nav-menu" class="${MENU_TABS.includes(S.tab) ? "on" : ""}" aria-label="More pages" title="More">☰${MENU_TABS.includes(S.tab) ? ` ${tabs.find(([k]) => k === S.tab)?.[1] || ""}` : ""}</button>` : ""}</nav>
    <div id="view">${(() => { try { return ({ live: liveTab2, runboard: runBoardTab, classic: classicTab, scorecard: scorecardTab, fix: fixTab, routes: routesTab, allowances: allowancesTab, pickups: pickupsTab, hazards: hazardsTab, alerts: alertsTab, messages: messagesTab, leave: leaveTab, fleet: fleetTab, timing: timingTab, people: peopleTab, pay: payTab })[S.tab](); } catch (e) { reportError("view:" + S.tab, e); return `<div class="card"><h2>This page hit a problem</h2><p class="hint">It couldn't be shown just now and the error has been logged. The other tabs still work.</p><button class="btn ghost sm" onclick="location.reload()">Reload</button></div>`; } })()}</div>
    <p class="foot">Safe. Sharp. Swift. · <a href="/">driver portal</a></p></div>`;
  $("#signout").onclick = signOut;
  $("#quick-err")?.addEventListener("click", () => errorCard());
  $$("[data-tab]").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; location.hash = S.tab; render(); });
  $("#nav-menu")?.addEventListener("click", () => { const list = tabs.filter(([k]) => MENU_TABS.includes(k));
    sheet(`<h3>More</h3><div class="list">${list.map(([k, l]) => `<button class="btn ${S.tab === k ? "" : "ghost"} full" data-menutab="${k}" style="justify-content:flex-start">${l}</button>`).join("")}</div>`, bg => {
      bg.querySelectorAll("[data-menutab]").forEach(b => b.onclick = () => { closeSheets(); S.tab = b.dataset.menutab; location.hash = S.tab; render(); }); }); });
  // classic Run Board in its own full-size browser window (falls back to a new tab if pop-ups are blocked)
  $$("[data-popout]").forEach(a => a.onclick = e => { e.preventDefault(); const w = window.open(a.dataset.popout, "tp_classic", `popup=yes,width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`); if (w) { try { w.moveTo(0, 0); w.resizeTo(screen.availWidth, screen.availHeight); } catch (_) { } w.focus(); } else window.open(a.dataset.popout, "_blank", "noopener"); });
  if (S.tab !== "live") { /* the live board draws its own map */ }
  try { ({ live: wireLive2, runboard: wireRunBoard, classic: () => { }, scorecard: wireScorecard, fix: wireFix, routes: wireRoutes, allowances: wireAllowances, pickups: wirePickups, hazards: wireHazards, alerts: wireAlerts, messages: wireMessages, leave: wireLeave, fleet: wireFleet, timing: wireTiming, people: wirePeople, pay: wirePay })[S.tab]?.(); } catch (e) { reportError("wire:" + S.tab, e); }
  try { wireRange(); folds(); bind($("#view")); } catch (e) { reportError("wire2:" + S.tab, e); }   // every tile, row and chip with a data-… attribute opens its detail sheet
}

/* ================= shared helpers ================= */
export function sheet(html, onOpen, opts = {}) {
  const bg = h(`<div class="sheet-bg"><div class="sheet ${opts.wide ? "wide" : ""}" role="dialog" aria-modal="true" style="position:relative;max-width:${opts.wide ? 900 : 640}px"><button class="x" aria-label="Close">×</button>${html}</div></div>`);
  const close = () => { bg.remove(); if (!$(".sheet-bg")) render(true); }; bg.querySelector(".x").onclick = close; bg.addEventListener("click", e => { if (e.target === bg) close(); });
  bg._close = close; document.body.appendChild(bg); onOpen?.(bg, close); bind(bg); return { bg, close };
}
export function closeSheets() { $$(".sheet-bg").forEach(b => b.remove()); }
document.addEventListener("keydown", e => { if (e.key === "Escape") { const all = $$(".sheet-bg"); const top = all[all.length - 1]; if (top) (top._close || (() => top.remove()))(); } });
export const opt = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${esc(l)}</option>`).join("");
export const nm = id => S.peopleBy[id]?.name || id || "—";
// First name, but the full name when two people share a first name (James M / James S)
export const fnm = id => { const n = nm(id), f = first(n); return Object.values(S.peopleBy || {}).filter(x => first(x.name) === f).length > 1 ? n : f; };
export function weekBar(extra = "") { return `<div class="wkbar"><button class="ar" data-wk="-1">‹</button><b>${label(S.week)} – ${label(addDays(S.week, 6))}</b><button class="ar" data-wk="1">›</button><button class="btn ghost sm" data-wk="0">This week</button>${extra}</div>`; }
export function wireWeek() { $$("[data-wk]").forEach(b => b.onclick = async () => { const d = +b.dataset.wk; S.week = d === 0 ? monOf(today()) : addDays(S.week, d * 7); await loadAll(); render(); }); }
/** Team scores range: this week / last week / last month, relative to the week on screen (base = that week's Monday). */
const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export function teamRange(base) {
  const r = S.tsRange || "week";
  if (r === "last") return { r, from: addDays(base, -7), to: addDays(base, -1), txt: `last week · ${label(addDays(base, -7))} – ${label(addDays(base, -1))}`, lbl: "Last week" };
  if (r === "month") { const e = addDays(base, 6); const y = +e.slice(0, 4), m = +e.slice(5, 7); const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    return { r, from: `${py}-${String(pm).padStart(2, "0")}-01`, to: addDays(`${y}-${String(m).padStart(2, "0")}-01`, -1), txt: `${MON[pm - 1]} ${py}`, lbl: "Last month" }; }
  if (r === "custom" && S.tsFrom && S.tsTo) return { r, from: S.tsFrom, to: S.tsTo, txt: `${label(S.tsFrom)} – ${label(S.tsTo)}`, lbl: "Dates" };
  return { r: "week", from: base, to: addDays(base, 6), txt: `week of ${label(base)}`, lbl: "This week" };
}
export const rangeBar = () => `<div class="seg-btns" style="margin:2px 0 8px">${[["week", "This week"], ["last", "Last week"], ["month", "Last month"], ["custom", "Dates"]].map(([k, l]) => `<button data-tsr="${k}" class="${(S.tsRange || "week") === k ? "on" : ""}">${l}</button>`).join("")}</div>${S.tsRange === "custom" ? `<div class="row" style="align-items:flex-end;margin:0 0 8px"><label class="f" style="flex:1 1 130px">From<input class="in" type="date" id="tsr-from" value="${S.tsFrom || ""}"></label><label class="f" style="flex:1 1 130px">To<input class="in" type="date" id="tsr-to" value="${S.tsTo || ""}"></label><button class="btn sm" id="tsr-go" style="flex:0 0 auto">Show</button></div>` : ""}`;
export function teamStats(rg) {
  const ss = S.drivers.map(d => scoreFor(d.id, rg.from, rg.to, scoreData(), S.C)).filter(s => s.closed || s.effDays.length || s.nMist || s.accDays.length);
  const real = ss.filter(s => !S.peopleBy[s.driver]?.pay_exclude);
  return { n: ss.length, team: k => avg(real.map(s => s[k])) };
}
export function wireRange() { $$("[data-tsr]").forEach(b => b.onclick = () => { S.tsRange = b.dataset.tsr; if (S.tsRange === "custom" && !S.tsFrom) { S.tsFrom = S.week; S.tsTo = addDays(S.week, 6); } render(); });
  $("#tsr-go")?.addEventListener("click", async () => { const f = $("#tsr-from").value, t = $("#tsr-to").value; if (!f || !t || t < f) return toast("Pick a From and To date", "err"); S.tsFrom = f; S.tsTo = t; S._sd = null; await loadAll(); render(); }); }
export const scoreData = () => S._sd ||= ({ extra: S.extra || [], shifts: S.shifts, sods: S.sods, eods: S.eods, marks: S.marks, entries: S.entries, feed: S.feed, ovs: S.ovs, runsBy: S.runsBy, breaks: S.breaks || [], effBreakFor: (S.people || []).filter(p => p.pay_exclude).map(p => p.id) });   // unpaid breaks come off efficiency time for everyone; the owner (Jeremy) also before 9 Nov

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
    return `<div class="bcard ${cls}"><div class="row" style="justify-content:space-between"><a class="nm" href="/#as=${esc(d.id)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" title="Open ${esc(first(d.name))}'s app as they see it">${esc(d.name)} <span class="meta">↗</span></a><span class="meta mono">${fmtT(D.start)}–${fmtT(D.end)}</span></div>
      <div>${D.segs.map(x => `<span class="tag ${x.sort ? "" : "van"}">${esc(x.sort ? S.runsBy[x.shift.run]?.label || "Sort" : x.shift.run)}${x.shift.van && !x.sort ? ` · ${esc(x.shift.van)}` : ""}</span>`).join(" ")}</div>
      <div>SOD ${sod ? `<span class="chip ${sodSt}">${fmtTime(sod.sent_at)}${sodSt === "late" ? ` +${sodMin - sodDue}m` : ""}</span>` : `<span class="chip ${sodSt}">${sodSt === "miss" ? `missing · due ${fmtT(sodDue)}` : `by ${fmtT(sodDue)}`}</span>`}</div>
      ${eods.map(r => `<div>EOD ${esc(r.x.shift.run)} ${r.e ? (q => `<span class="chip ${q.st}" title="${q.st === "slow" ? `finished ${q.overFin} min after expected` : q.st === "lsub" ? `posted ${q.posted} min after expected · not counted late` : "on time"}">${fmtTime(r.e.sent_at)}</span>`)(eodState(r.x.en ?? r.x.st, nzNow(new Date(r.e.sent_at)).min, r.e.finish_time)) : `<span class="chip ${n.min > r.due ? "miss" : "due"}">${n.min > r.due ? "overdue" : `due ${fmtT(r.due)}`}</span>`}</div>`).join("")}
      ${taskLine(D, t, n)}
      ${loc ? `<div class="meta">📍 ${ago(loc.at)}</div>` : sod && !allDone ? `<div class="meta">📍 no location yet (app closed?)</div>` : ""}</div>`;
  }).join("");
  const open = S.alerts.filter(a => !a.resolved_at);
  return `${weekless()}
    <div class="card"><h2>Today · ${label(t)}<span>${todays.filter(s => s.driver).length ? `${Object.keys(dayShifts(todays, S.runsBy)).length ? new Set(todays.map(s => s.driver)).size : 0} drivers rostered` : "nobody rostered"}</span></h2>${cards ? `<div class="board">${cards}</div>` : `<p class="empty">No shifts today.</p>`}</div>
    <div class="grid2"><div class="card"><h2>Open alerts<span>${open.length}</span></h2>${open.length ? `<div class="list">${open.slice(0, 12).map(alertRow).join("")}</div>${open.length > 12 ? `<p class="meta">+${open.length - 12} more on the Fix posts tab</p>` : ""}` : `<p class="empty">✓ Nothing open</p>`}</div>
    <div class="card"><h2>Where everyone is<span>between SOD and EOD · app open</span></h2><div class="map" id="map"></div><p class="hint">Dots update every couple of minutes while a driver's app is on screen. Grey = older than 10 minutes.</p></div></div>`;
}
function weekless() { return ""; }
function taskLine(D, t, n) {
  const out = [];
  for (const x of D.segs) if (!x.sort) for (const a of (x.shift.addons || [])) { const ad = S.addons.find(z => z.id === a); if (!ad?.task) continue; const done = x.shift.done?.[a]; const plan = x.shift.plan?.[a]; out.push(`<span class="chip ${done ? "ok" : plan ? "due" : "over"}">${esc(ad.short || ad.name)}${done ? ` ✓ ${fmtTime(done)}` : plan ? ` ~${fmtT(toMin(plan))}` : " no plan"}</span>`); }
  return out.length ? `<div class="row" style="gap:3px">${out.join("")}</div>` : "";
}
export function alertRow(a) { return `<div class="item clk ${a.resolved_at ? "done" : a.kind.includes("miss") ? "crit" : "warn"}" data-alert="${a.id}" title="Tap for the detail"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b>${esc(a.title)}</b>${a.body ? `<div class="meta">${esc(a.body)}</div>` : ""}<div class="m">${a.driver ? esc(nm(a.driver)) + " · " : ""}${ago(a.created_at)}</div></div>${a.resolved_at ? pill("resolved", "grey") : S.me.can("alerts") ? `<span class="row" style="flex:0;gap:4px;flex-wrap:wrap;justify-content:flex-end">${actBtns("alert", `data-id="${a.id}"`)}</span>` : ""}</div></div>`; }
function wireLive() {
  $$("[data-resolve]").forEach(b => b.onclick = async () => { await q(sb.from("alerts").update({ resolved_at: new Date().toISOString(), resolved_by: S.me.id }).eq("id", b.dataset.resolve)); });
  const el = $("#map"); if (!el || !window.L) return;
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([-45.88, 170.4], 10);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19, className: "osm-dark" }).addTo(map);
  const latest = {}; for (const l of S.locs) if (!latest[l.driver]) latest[l.driver] = l;
  const pts = Object.values(latest).filter(l => { const D = S.shifts.find(s => s.id === l.shift_id); return D ? !S.eodBy[D.id] : true; });
  for (const l of pts) { const stale = Date.now() - new Date(l.at) > 600e3; L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "", html: `<div class="mk ${stale ? "stale" : ""}">${esc(fnm(l.driver))}</div>`, iconAnchor: [20, 12] }) }).addTo(map).bindPopup(`<b>${esc(nm(l.driver))}</b><br>${esc(fmtTs(l.at))}${l.speed ? `<br>${Math.round(l.speed * 3.6)} km/h` : ""}`); }
  if (pts.length) map.fitBounds(L.latLngBounds(pts.map(l => [l.lat, l.lng])).pad(0.3), { maxZoom: 13 });
}

/* ================= CLASSIC RUN BOARD ================= */
function classicTab() {
  return `<div class="card" style="padding:8px"><p class="hint" style="margin:0 0 6px">The old drag-and-drop Run Board, running on the new database. Every change lands on the live roster straight away; when you're done, open the <button class="linkbtn" data-tab="runboard">Run Board (new)</button> tab and press <b>Approve roster</b> (new week) or <b>Push changes</b> (edits) so drivers get it.</p><p style="margin:0 0 8px"><a class="btn accent sm" href="/admin/classic/" target="_blank" rel="noopener" data-popout="/admin/classic/" style="text-decoration:none;display:inline-flex">Open in a new full browser window ↗</a></p>
    <iframe src="/admin/classic/" title="Run Board (classic)" style="width:100%;height:calc(100vh - 220px);min-height:700px;border:0;border-radius:10px;background:#eaedf1"></iframe></div>`;
}

/* ================= ALERTS ================= */
function timingsToday() {
  const n = nzNow(); const t = n.date; const rows = [];
  for (const s of S.shifts.filter(x => x.day === t && x.driver && x.run !== "BU" && (!isSort(x.run) || (x.addons || []).length))) for (const r0 of S.rules) { if (!r0.active || !r0.days.includes(dow(t) + 1)) continue; const all = r0.runs.includes("ALL"); if (!all && !r0.runs.includes(s.run)) continue;
    const ad = r0.addon ? S.addons.find(a => a.id === r0.addon) : null; if (ad?.always && ad.runs.includes(s.run)) { /* standing task */ } else if (ad && ad.runs.includes(s.run)) { if (!(s.addons || []).includes(r0.addon) && !meetOn(r0, s)) continue; } else if (!all && r0.runs.length > 1) continue;
    const r = meetRule(r0, s);   // Milton meet: the D>B driver's chosen time replaces the rule time
    const done = s.done?.[r.done_key || r.addon] || (r.addon?.startsWith("tw_") && /game plan/i.test(r.name) && Object.keys(s.plan || {}).length ? (s.plan && Object.values(s.plan)[0] ? "plan" : null) : null);
    const f = toMin(r.opens), c = toMin(r.closes); const win = f != null && c != null ? `${fmtT(f)}–${fmtT(c)}` : c != null ? `by ${fmtT(c)}` : f != null ? `from ${fmtT(f)}` : "any time";
    const mk = done ? null : addMark(s.id, r.done_key || r.addon);
    let st, cls; if (mk) { [cls, st] = mk; } else if (done) { st = done === "plan" ? "game plan in" : `done ${fmtTime(done)}`; cls = "ok"; } else if (c != null && n.min > c) { st = `PASSED · due ${fmtT(c)}`; cls = "miss"; } else if (c != null && c - n.min <= 60) { st = `due soon · ${fmtT(c)}`; cls = "late"; } else if (f != null && n.min >= f) { st = "window open"; cls = "due"; } else { st = "later"; cls = "due"; }
    rows.push({ sort: c ?? f ?? 0, html: `<tr class="clk" data-task="${s.id}" data-rule="${r.id}"><td class="mono">${win}</td><td><b>${esc(r.name)}</b><div class="meta">${esc(r.note || `${win === "any time" ? "" : win + ": "}do this, then tap Done.`)}</div></td><td>${esc(s.run)} · ${esc(fnm(s.driver))}</td><td><span class="chip ${cls}">${st}</span>${!done && !mk && r.addon && S.me.can("roster") ? ` <span class="row" style="gap:4px;flex-wrap:wrap;margin-top:4px">${actBtns("add", `data-sid="${s.id}" data-k="${esc(r.done_key || r.addon)}"`)}<button class="btn ghost sm" data-transfer="${s.id}|${esc(r.addon)}" title="Give this task to another driver">Transfer</button></span>` : ""}</td></tr>` }); }
  rows.sort((a, b) => a.sort - b.sort); const nOpen = rows.filter(r => r.html.includes('data-kind="add"')).length;
  return `<div class="card"><h2>Timings today<span>${label(t)} · red = passed without being done</span></h2>${S.me.can("roster") ? allBar(nOpen) : ""}${rows.length ? `<div class="scroll"><table class="dt"><tr><th>Window</th><th>What to do</th><th>Who</th><th>Status</th></tr>${rows.map(r => r.html).join("")}</table></div>` : `<p class="empty">No timed tasks on today's runs.</p>`}<p class="hint">Drivers tap Done in their app as each one is finished (every timed task on their run shows there with its own Done button). A passed window raises an alert here and pings you and the driver; Done clears it. Tap a row for the plan, the history and the driver's day.</p></div>`;
}
export function alertsTab() {
  const open = S.alerts.filter(a => !a.resolved_at), done = S.alerts.filter(a => a.resolved_at);
  const rem = S.set.reminders || {};
  return `${timingsToday()}<div class="card"><h2>Open alerts<span>${open.length}</span></h2>${open.length ? `${S.me.can("alerts") ? allBar(open.length) : ""}<div class="list">${open.map(alertRow).join("")}</div>` : `<p class="empty">✓ Nothing open</p>`}</div>
    <div class="card"><h2>How alerts work</h2><p class="hint">Every minute the system checks: SOD not in by rostered start + ${S.C.rules.sodGrace} min · EOD not in ${S.C.rules.eodHours} h after a run finishes · timing windows due soon or missed · roster changes not confirmed before the run starts · vehicle checks due Thursday 5pm. Each alert appears here, pings the driver's phone, and (when email chasing is on) emails the driver once.</p>
      <label class="chk ${rem.enabled ? "on" : ""}"><input type="checkbox" id="rem-on" ${rem.enabled ? "checked" : ""} ${S.me.can("people") ? "" : "disabled"}>Email drivers automatically when a post is late (between ${esc(rem.from || "07:00")} and ${esc(rem.to || "20:00")})</label></div>
    <div class="card"><h2>Resolved recently<span>${done.length}</span></h2>${done.length ? `<div class="list">${done.slice(0, 30).map(alertRow).join("")}</div>` : `<p class="empty">Nothing yet</p>`}</div>`;
}
export function wireAlerts() {
  $("#resolve-all")?.addEventListener("click", async () => { await q(sb.from("alerts").update({ resolved_at: new Date().toISOString(), resolved_by: S.me.id }).is("resolved_at", null)); toast("Resolved", "ok"); });
  $("#rem-on")?.addEventListener("change", async e => { await q(sb.from("settings").upsert({ key: "reminders", value: { ...(S.set.reminders || {}), enabled: e.target.checked } })); toast("Saved", "ok"); });
}

/* ================= MESSAGES ================= */
function messagesTab() {
  const rec = Object.groupBy ? Object.groupBy(S.recips, r => r.message_id) : S.recips.reduce((o, r) => ((o[r.message_id] ??= []).push(r), o), {});
  return `<div class="card"><h2>New message</h2><form id="mf" class="frm"><div class="full row">${S.drivers.map(d => `<label class="chk"><input type="checkbox" name="to" value="${d.id}">${esc(fnm(d.id))}</label>`).join("")}<button type="button" class="btn ghost sm" id="all-on">Everyone</button><button type="button" class="btn ghost sm" id="all-off">None</button></div>
    <label class="f full">Message<textarea class="in" id="body" rows="3" required placeholder="e.g. Depot reminder: no parking past the bike shed."></textarea></label>
    <label class="chk full"><input type="checkbox" id="confirm">Ask each driver to tap "Got it"</label><label class="chk full"><input type="checkbox" id="push" checked>Also send a phone notification</label><button class="btn full" type="submit">Send</button></form></div>
    <div class="card"><h2>Sent<span>${S.msgs.length}</span></h2><div class="list">${S.msgs.map(m => { const rs = rec[m.id] || []; const read = rs.filter(r => r.read_at).length, conf = rs.filter(r => r.confirmed_at).length;
      return `<div class="item clk ${rs.length && rs.every(r => m.needs_confirm ? r.confirmed_at : r.read_at) ? "done" : ""}" data-msgof="${m.id}" title="Tap for who has read it"><div class="m">${fmtTs(m.created_at)} · ${esc(fnm(m.sender))} → ${rs.length === S.drivers.length ? "everyone" : rs.map(r => fnm(r.person)).join(", ")}</div><div style="white-space:pre-wrap">${esc(m.body)}</div>
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
  const row = l => `<div class="item clk ${l.status === "pending" ? "warn" : l.status === "approved" ? "ok done" : l.status === "declined" ? "crit done" : "done"}" data-leaveof="${l.id}"><div class="row" style="justify-content:space-between"><b>${esc(nm(l.driver))} · ${esc(LEAVE_T[l.type] || l.type)}</b><span class="row" style="gap:4px">${paidPill(l)}${S.me.isOwner && l.status === "approved" && (l.type === "sick" || l.paid != null) ? `<button class="btn ghost sm" data-paidflip="${l.id}" title="Switch paid / unpaid">${l.paid ? "Make unpaid" : "Make paid"}</button>` : ""}${pill(l.status, l.status === "approved" ? "ok" : l.status === "declined" ? "crit" : l.status === "pending" ? "warn" : "grey")}</span></div>
    <div class="meta mono">${label(l.date_from, true)}${l.date_to !== l.date_from ? ` – ${label(l.date_to, true)}` : ""}${l.part !== "full" ? ` · ${l.part === "AM" ? "morning off" : "afternoon off"}` : ""} · asked ${fmtTs(l.created_at)}${l.acked_email_at ? " · received email sent" : ""}</div>${l.notes ? `<div>${esc(l.notes)}</div>` : ""}
    ${l.status === "pending" ? `<div class="row"><input class="in" placeholder="Reply to the driver (optional)" data-reply="${l.id}" style="flex:1 1 200px"><button class="btn sm" data-decide="approved" data-id="${l.id}">Approve</button><button class="btn sm crit" data-decide="declined" data-id="${l.id}">Decline</button></div>` : l.reply ? `<div class="meta">Reply: ${esc(l.reply)}${l.decided_by ? ` · by ${esc(fnm(l.decided_by))}` : ""}</div>` : ""}</div>`;
  return `<div class="card"><h2>Waiting<span>${pend.length}</span></h2>${pend.length ? `<div class="list">${pend.map(row).join("")}</div>` : `<p class="empty">✓ Nothing waiting</p>`}<p class="hint">Approving sends the driver an email and a notification, and blocks them on the Run Board for those days.</p></div>
    <div class="card"><h2>Add leave by hand</h2><form id="lf" class="frm"><label class="f">Driver<select class="in" id="l-drv">${opt(S.drivers.map(d => [d.id, d.name]))}</select></label><label class="f">Type<select class="in" id="l-type">${opt(Object.entries(LEAVE_T))}</select></label><label class="f">From<input class="in" type="date" id="l-from" required></label><label class="f">To<input class="in" type="date" id="l-to" required></label><label class="f">Paid?<select class="in" id="l-paid"><option value="auto">Auto (6-month rule for sick)</option><option value="true">Paid</option><option value="false">Unpaid</option></select></label><p class="hint full" id="l-why" style="margin:0">${SIX_MONTHS_NOTE} Tip: on the Run Board, press and hold a shift to mark someone sick.</p><label class="f full">Note<input class="in" id="l-note" placeholder="e.g. told me by text"></label><button class="btn full" type="submit">Add as approved</button></form></div>
    <div class="card"><h2>History<span>${rest.length}</span></h2><div class="list">${rest.slice(0, 40).map(row).join("") || `<p class="empty">Nothing yet</p>`}</div></div>`;
}
function wireLeave() {
  $$("[data-decide]").forEach(b => b.onclick = async () => { const id = b.dataset.id; const reply = $(`[data-reply="${id}"]`)?.value || null; await q(sb.from("leave_requests").update({ status: b.dataset.decide, decided_by: S.me.id, decided_at: new Date().toISOString(), reply }).eq("id", id)); fn("notify", { type: "leave_decided", leave_id: id }).catch(() => { }); toast(b.dataset.decide === "approved" ? "Approved" : "Declined", "ok"); });
  $("#lf").onsubmit = async e => { e.preventDefault(); const pv = $("#l-paid").value; const paid = pv === "auto" ? ($("#l-type").value === "sick" ? sickDefault($("#l-drv").value, $("#l-from").value).paid : null) : pv === "true"; await q(sb.from("leave_requests").insert({ paid, driver: $("#l-drv").value, type: $("#l-type").value, date_from: $("#l-from").value, date_to: $("#l-to").value, notes: $("#l-note").value || `Entered by ${first(S.me.name)}`, status: "approved", decided_by: S.me.id, decided_at: new Date().toISOString(), acked_email_at: new Date().toISOString() })); toast("Added", "ok"); };
  $$("[data-paidflip]").forEach(b => b.onclick = async e => { e.stopPropagation(); const l = S.leave.find(x => x.id === b.dataset.paidflip); await q(sb.from("leave_requests").update({ paid: !l.paid }).eq("id", l.id)); toast(l.paid ? "Now unpaid" : "Now paid", "ok"); });
  const why = () => { const d = $("#l-drv").value, f = $("#l-from").value; if ($("#l-type").value !== "sick" || !d || !f) { $("#l-why").textContent = SIX_MONTHS_NOTE; return; } $("#l-why").textContent = sickDefault(d, f).why; };
  ["#l-drv", "#l-type", "#l-from"].forEach(x => $(x)?.addEventListener("change", why));
  // RLS: drivers insert their own leave; staff with the leave permission insert via the leave_upd policy? No: inserting for others needs leave perm — handled by leave_ins_staff policy
}

/* ================= FLEET ================= */
function fleetTab() {
  const wk = monOf(today()); const R = S.C.rules;
  const st = d => { if (!d) return pill("not set", "grey"); const n = Math.round((new Date(d) - new Date(today())) / 86400000); return n < 0 ? pill("overdue", "crit") : n <= R.dueSoonDays ? pill(`due in ${n}d`, "warn") : pill("✓", "ok"); };
  return `<div class="card"><h2>WOF, rego and RUCs<span>due soon = within ${R.dueSoonDays} days or under ${R.rucSoonKm} km</span></h2><div class="scroll"><table class="dt"><tr><th>Van</th><th>Model</th><th>WOF</th><th>Rego</th><th>RUCs</th><th>Odometer</th><th>Last washed</th><th>Responsible</th><th></th></tr>
    ${S.vans.filter(v => v.plate !== "OTHER").map(v => { const chk = S.vchk.filter(c => c.van === v.plate).sort((a, b) => b.at.localeCompare(a.at))[0]; const odo = chk?.odometer && (!v.odometer_at || chk.at.slice(0, 10) >= v.odometer_at) ? chk.odometer : v.odometer; const left = v.ruc_paid_to && odo ? v.ruc_paid_to - odo : null;
      return `<tr class="clk" data-vanof="${esc(v.plate)}"><td><b class="mono">${esc(v.plate)}</b>${v.active ? "" : pill("inactive", "grey")}</td><td>${esc(v.model || "")}</td><td>${v.wof_due ? label(v.wof_due, true) : ""} ${v.wof_failed ? pill("failed", "crit") : st(v.wof_due)}</td><td>${v.rego_due ? label(v.rego_due, true) : ""} ${st(v.rego_due)}</td>
        <td>${v.no_ruc ? "petrol, no RUCs" : v.ruc_paid_to ? `paid to ${v.ruc_paid_to.toLocaleString()} km${left != null ? `<br>${left.toLocaleString()} km left ${left <= 0 ? pill("overdue", "crit") : left <= R.rucSoonKm ? pill("low", "warn") : pill("✓", "ok")}` : ""}` : pill("not set", "grey")}</td>
        <td>${odo ? `${odo.toLocaleString()} km` : "—"}${chk?.odometer ? `<div class="meta">check ${label(chk.at.slice(0, 10))}</div>` : ""}</td><td>${(w => w ? `${label(nzNow(new Date(w.at)).date)} ${(d => d > 21 ? pill(d + "d ago", "crit") : d > 14 ? pill(d + "d ago", "warn") : "")(Math.round((Date.now() - Date.parse(w.at)) / 86400e3))}<div class="meta">${esc(fnm(w.driver))}</div>` : pill("none recorded", "grey"))((S.washes || []).find(x => x.van === v.plate))}</td><td>${v.responsible ? esc(nm(v.responsible)) : "<span class='meta'>main driver</span>"}</td><td><button class="btn ghost sm" data-van-edit="${v.plate}">Edit</button></td></tr>`; }).join("")}</table></div>
    <p class="hint">Tap a van for its history: checks, odometer, who's had it and what's due.</p><button class="btn ghost sm" id="van-add">+ Add a van</button></div>
    <div class="card"><h2>Weekly vehicle checks<span>due Thu ${esc(R.vchkTime)} · week of ${label(wk)}</span></h2><div class="scroll"><table class="dt"><tr><th>Van</th>${[0, 1, 2, 3, 4, 5].map(i => `<th>${label(addDays(wk, -7 * i)).slice(4)}</th>`).join("")}</tr>
      ${S.vans.filter(v => v.active && v.plate !== "OTHER").map(v => `<tr><td class="mono"><b>${esc(v.plate)}</b></td>${[0, 1, 2, 3, 4, 5].map(i => { const w = addDays(wk, -7 * i); const c = S.vchk.find(x => x.van === v.plate && x.week_start === w); return `<td>${c ? `<button class="chip ok" data-vchk="${c.id}">${esc(fnm(c.driver))} ✓</button>` : `<span class="chip ${i === 0 && dow(today()) < 3 ? "due" : "miss"}">${i === 0 && dow(today()) < 3 ? "due" : "—"}</span>`}</td>`; }).join("")}</tr>`).join("")}</table></div></div>`;
}
export function editVan(plate) { const v = S.vansBy[plate] || { plate: "", active: true };
    sheet(`<h3>${plate ? esc(plate) : "New van"}</h3><form class="frm" id="vf">${plate ? "" : `<label class="f">Plate<input class="in" id="plate" required style="text-transform:uppercase"></label>`}<label class="f">Model<input class="in" id="model" value="${esc(v.model || "")}"></label><label class="f">Colour<input class="in" id="colour" value="${esc(v.colour || "")}"></label>
      <label class="f">WOF expires<input class="in" type="date" id="wof" value="${v.wof_due || ""}"></label><label class="f">Rego expires<input class="in" type="date" id="rego" value="${v.rego_due || ""}"></label>
      <label class="f">RUCs paid to (km)<input class="in" id="ruc" inputmode="numeric" value="${v.ruc_paid_to ?? ""}"></label><label class="f">Odometer (km)<input class="in" id="odo" inputmode="numeric" value="${v.odometer ?? ""}"></label>
      <label class="f full">Responsible for the weekly check<select class="in" id="resp">${opt([["", "Main driver from the roster"], ...S.drivers.map(d => [d.id, d.name])], v.responsible || "")}</select></label>
      <label class="chk"><input type="checkbox" id="noruc" ${v.no_ruc ? "checked" : ""}>Petrol (no RUCs)</label><label class="chk"><input type="checkbox" id="woff" ${v.wof_failed ? "checked" : ""}>WOF failed</label><label class="chk"><input type="checkbox" id="active" ${v.active ? "checked" : ""}>Active</label>
      <button class="btn full" type="submit">Save</button></form>`, (bg, close) => { bg.querySelector("#vf").onsubmit = async e => { e.preventDefault(); const g = id => bg.querySelector("#" + id); const row = { plate: plate || g("plate").value.trim().toUpperCase(), name: plate || g("plate").value.trim().toUpperCase(), model: g("model").value || null, colour: g("colour").value || null, wof_due: g("wof").value || null, rego_due: g("rego").value || null, ruc_paid_to: g("ruc").value ? +g("ruc").value : null, odometer: g("odo").value ? +g("odo").value : null, odometer_at: g("odo").value && +g("odo").value !== v.odometer ? today() : v.odometer_at || null, responsible: g("resp").value || null, no_ruc: g("noruc").checked, wof_failed: g("woff").checked, active: g("active").checked };
        const { error } = await sb.from("vans").upsert(row); if (error) return toast(error.message, "err"); close(); toast("Saved", "ok"); }; }); }
function wireFleet() {
  $("#van-add")?.addEventListener("click", () => editVan(""));
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


/* ================= PENALTIES & PAY ================= */
function payTab() {
  const R = S.C.rules, W = S.C.weights; const num = (id, v, step = "any") => `<input class="in" id="${id}" type="number" step="${step}" value="${v ?? ""}">`;
  const line = (lbl, inp, how) => `<label class="f full" style="display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:4px 12px;align-items:center"><span><b>${lbl}</b><div class="meta">${how}</div></span>${inp}</label>`;
  const ex = (() => { const ev = R.perEvent, pt = R.partEvent ?? 0; return `Example: 2 late posts and 1 incomplete one in a fortnight → 100 − ${ev} − ${ev} − ${pt} = <b>${Math.max(R.adminFloor, 100 - 2 * ev - pt)}%</b> Admin.`; })();
  const pay = S.people.filter(p => p.active && !p.cleared && (p.role === "driver" || p.role === "owner")).sort((a, b) => (a.role === "owner" ? 1 : 0) - (b.role === "owner" ? 1 : 0) || a.name.localeCompare(b.name));
  return `<div class="card"><h2>Penalties<span>how late and missing posts, mistakes and safety notes take points off · changes recalculate every score straight away</span></h2>
    <form class="frm" id="penf">
      <div class="full meta mono" style="margin-top:4px">ADMIN · POSTS</div>
      ${line("SOD grace (minutes)", num("sodGrace", R.sodGrace, 1), "A SOD posted within this many minutes of the rostered start is on time.")}
      ${line("EOD due (hours after the run's end)", num("eodHours", R.eodHours, 0.25), "An EOD posted later than this is late; after that window closes it counts as missing.")}
      ${line("EOD late · no fix needed (minutes)", num("eodFixGrace", R.eodFixGrace ?? 90, 5), "An EOD late by up to this many minutes still counts as late, but stays off Fix posts and the driver's To fix list.")}
      ${line("Late or missing post · % off", num("perEvent", R.perEvent, 0.5), "Taken off the Admin score for every late or missing SOD / EOD in the range.")}
      ${line("Incomplete post · % off", num("partEvent", R.partEvent ?? 1, 0.5), "For a post you've marked incomplete (figures missing). 0 = no penalty.")}
      ${line("Admin floor %", num("adminFloor", R.adminFloor, 1), "Admin never drops below this.")}
      <div class="full meta mono" style="margin-top:10px">ACCURACY &amp; SAFETY</div>
      ${line("Mistake · % off Accuracy", num("mistakePct", R.mistakePct, 1), "Each entry in the Driver Mistakes Record (not excused) takes this off the fortnight's Accuracy.")}
      ${line("Safety default", `<span class="meta" style="text-align:right">100%</span>`, "Safety stays at 100 unless you record a safety note with a % on it; the notes are averaged.")}
      <div class="full meta mono" style="margin-top:10px">OVERALL SCORE WEIGHTS</div>
      <div class="full" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px"><label class="f">Admin ${num("w_admin", W.admin, 1)}</label><label class="f">Efficiency ${num("w_eff", W.eff, 1)}</label><label class="f">Accuracy ${num("w_acc", W.acc, 1)}</label><label class="f">Safety ${num("w_safe", W.safe, 1)}</label></div>
      <p class="hint full" id="w-sum"></p>
      <div class="full meta mono" style="margin-top:10px">WHEN SCORING STARTED</div>
      ${line("Posts count from", `<input class="in" id="adminStart" type="date" value="${R.adminStart}">`, "Earlier posts show as excused.")}
      ${line("Efficiency counts from", `<input class="in" id="effStart" type="date" value="${R.effStart}">`, "Earlier runs are kept for the averages but not scored.")}
      <p class="hint full">${ex}</p>
      <button class="btn full" type="submit">Save penalties</button></form></div>
    <div class="card"><h2>Pay rates<span>used for every $ figure in Labour · blank = the default rate</span></h2>
      <form class="frm" id="payf"><label class="f">Default wage $/h${num("hourRate", R.hourRate, 0.5)}</label><label class="f">Public holiday · paid hours cap${num("holidayCap", R.holidayCap ?? 8, 0.5)}</label>
      <div class="full scroll"><table class="dt payt"><tr><th>Driver</th><th>$/h</th><th>Fortnight band → rate</th><th>In labour figures</th></tr>${pay.map(p => `<tr class="clk" data-personof="${p.id}"><td><b>${esc(p.name)}</b>${p.role === "owner" ? ` <span class="meta">(owner)</span>` : ""}</td><td><input class="in" data-rate="${p.id}" type="number" step="0.5" inputmode="decimal" value="${p.rate ?? ""}" placeholder="${R.hourRate}"></td><td>${(pb => pb.b == null ? `<span class="meta">no scored days yet</span>` : `Band ${pb.b || "<1"} · ${Math.round(pb.eff)}%${pb.rate != null ? ` → <b>${money(pb.rate)}/h</b>${pb.note ? ` + ${esc(pb.note)}` : ""}` : ""}` + (pb.diff == null ? "" : pb.diff > 0 ? ` <span class="c-ok">↑ from ${money(pb.now)}/h now</span>` : pb.diff < 0 ? ` <span class="c-crit">↓ from ${money(pb.now)}/h now</span>` : ` <span class="meta">same as now</span>`))(payBand(p, today(), scoreData(), S.C))}</td><td><label class="chk ${p.pay_exclude ? "" : "on"}"><input type="checkbox" data-payin="${p.id}" ${p.pay_exclude ? "" : "checked"}>counted</label></td></tr>`).join("")}</table></div>
      <button class="btn full" type="submit">Save pay rates</button></form><p class="hint">Rates are also on each person's sheet (People → Edit). Labour spend = actual hours (≈ estimated where the SOD/EOD isn't in) × that driver's rate. The band column is this pay fortnight's average efficiency and the rate that band pays${Object.keys(S.C.bands || {}).length ? ` (${Object.entries(S.C.bands).map(([k, v]) => `${k}: ${esc(v)}`).join(" · ")})` : ""}; it doesn't change the $/h above.</p></div>`;
}
function wirePay() {
  const sum = () => { const t = ["w_admin", "w_eff", "w_acc", "w_safe"].reduce((a, k) => a + (+$("#" + k).value || 0), 0); $("#w-sum").innerHTML = t === 100 ? "Weights add up to 100 ✓" : `<span class="c-warn">Weights add up to ${t} — they're used as proportions, so that still works, but 100 is easiest to read.</span>`; };
  ["w_admin", "w_eff", "w_acc", "w_safe"].forEach(k => $("#" + k).addEventListener("input", sum)); sum();
  $("#penf").onsubmit = async e => { e.preventDefault(); const g = x => $("#" + x).value;
    const rules = { ...(S.set.rules || {}), sodGrace: +g("sodGrace"), eodHours: +g("eodHours"), eodFixGrace: +g("eodFixGrace"), perEvent: +g("perEvent"), partEvent: +g("partEvent"), adminFloor: +g("adminFloor"), mistakePct: +g("mistakePct"), adminStart: g("adminStart") || S.C.rules.adminStart, effStart: g("effStart") || S.C.rules.effStart };
    const { error } = await sb.from("settings").upsert([{ key: "rules", value: rules }, { key: "weights", value: { admin: +g("w_admin"), eff: +g("w_eff"), acc: +g("w_acc"), safe: +g("w_safe") } }]); if (error) return toast(error.message, "err"); toast("Penalties saved · scores recalculate straight away", "ok"); };
  $("#payf").onsubmit = async e => { e.preventDefault(); const g = x => $("#" + x).value;
    const { error } = await sb.from("settings").upsert({ key: "rules", value: { ...(S.set.rules || {}), hourRate: +g("hourRate"), holidayCap: +g("holidayCap") } }); if (error) return toast(error.message, "err");
    const ups = []; $$("[data-rate]").forEach(i => { const p = S.peopleBy[i.dataset.rate]; const v = i.value === "" ? null : +i.value; const inc = $(`[data-payin="${p.id}"]`).checked; if ((p.rate ?? null) !== v || !!p.pay_exclude === inc) ups.push(sb.from("people").update({ rate: v, pay_exclude: !inc }).eq("id", p.id)); });
    for (const u of ups) { const { error } = await u; if (error) return toast(error.message, "err"); }
    toast(`Pay rates saved${ups.length ? ` · ${ups.length} driver${ups.length === 1 ? "" : "s"} changed` : ""}`, "ok"); };
  $$("[data-payin]").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
}

/* ================= PEOPLE & SETTINGS ================= */
function peopleTab() {
  const staff = S.people.filter(p => p.role !== "driver" || (p.perms || []).length), drivers = S.people.filter(p => p.role === "driver" && !(p.perms || []).length);
  const row = p => `<tr class="clk" data-personof="${p.id}"><td><b>${esc(p.name)}</b><div class="meta">${esc(p.email || "no email")}${p.phone ? " · " + esc(p.phone) : ""}</div></td><td>${pill(p.role, p.role === "owner" ? "accent" : "")} ${p.active ? "" : pill("paused", "crit")}${p.cleared ? pill("not rostered", "grey") : ""}${p.user_id ? pill("signed in", "ok") : pill("never signed in", "grey")}</td><td class="meta">${(p.perms || []).map(a => AREA_LABEL[a]?.split(",")[0].split(" (")[0] || a).join(", ")}</td><td class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn ghost sm" data-person-edit="${p.id}">Edit</button>${p.role === "driver" || (p.perms || []).length === 0 ? `<a class="btn ghost sm" style="text-decoration:none" href="/#as=${esc(p.id)}" target="_blank" rel="noopener" title="See exactly what ${esc(first(p.name))} sees">View app</a>` : ""}</td></tr>`;
  const L = S.set.links || {};
  return `<div class="card"><h2>Staff<span>${staff.length}</span></h2><div class="scroll"><table class="dt"><tr><th>Name</th><th>Role</th><th>Areas</th><th></th></tr>${staff.map(row).join("")}</table></div></div>
    <div class="card"><h2>Drivers<span>${drivers.length}</span></h2><div class="scroll"><table class="dt"><tr><th>Name</th><th>Status</th><th></th><th></th></tr>${drivers.map(row).join("")}</table></div><button class="btn ghost sm" id="person-add">+ Add a person</button><p class="hint">A new person signs in with the email you enter here. Tick areas to make someone staff (they'll be asked to set up two-factor on first sign-in). Tap a name for their sheet and history.</p></div>
    <div class="card"><h2>Settings</h2><form class="frm" id="sf"><label class="f full">Vault (Damstra) link shown to drivers<input class="in" id="vault" value="${esc(L.vault || "")}"></label><button class="btn full" type="submit">Save</button></form><p class="hint">Penalties, score weights and wage rates live under <button class="linkbtn" data-gotab="pay">Penalties &amp; pay</button>.</p></div>
    <div class="card"><h2>Activity log</h2><button class="btn ghost sm" id="log-load">Show the last 100 changes</button><div id="log"></div></div>`;
}
export function editPerson(id) { const p = S.peopleBy[id] || { id: "", name: "", email: "", role: "driver", perms: [], active: true, cleared: false };
    sheet(`<h3>${id ? esc(p.name) : "Add a person"}</h3><form class="frm" id="pf">${id ? "" : `<label class="f">Short id<input class="in" id="pid" required placeholder="e.g. TM" pattern="[A-Za-z0-9_-]+"></label>`}<label class="f ${id ? "full" : ""}">Name<input class="in" id="name" value="${esc(p.name)}" required></label><label class="f full">Email (they sign in with this)<input class="in" type="email" id="email" value="${esc(p.email || "")}"></label><label class="f">Phone<input class="in" id="phone" value="${esc(p.phone || "")}"></label><label class="f">Role<select class="in" id="role" ${p.role === "owner" ? "disabled" : ""}>${opt([["driver", "Driver"], ["admin", "Admin"], ["fleet", "Fleet"], ["owner", "Owner"]], p.role)}</select></label>
      <label class="f">Wage $/h<input class="in" id="rate" inputmode="decimal" value="${p.rate ?? ""}" placeholder="default ${S.C.rules.hourRate}"></label><label class="f">Started<input class="in" type="date" id="started" value="${p.started || ""}"></label><label class="f">Licence class<input class="in" id="lc" value="${esc(p.licence_class || "")}"></label><label class="f">Licence expires<input class="in" type="date" id="le" value="${p.licence_expiry || ""}"></label><label class="f">DG expires<input class="in" type="date" id="dg" value="${p.dg_expiry || ""}"></label><label class="f">Notes<input class="in" id="notes" value="${esc(p.notes || "")}"></label>
      <div class="full"><div class="meta mono" style="margin-bottom:6px">STAFF AREAS</div><div class="list">${AREAS.map(a => `<label class="chk ${(p.perms || []).includes(a) ? "on" : ""}" style="border-radius:10px"><input type="checkbox" name="perm" value="${a}" ${(p.perms || []).includes(a) ? "checked" : ""} ${p.role === "owner" ? "disabled" : ""}>${esc(AREA_LABEL[a])}</label>`).join("")}</div></div>
      <label class="chk ${(S.set.van_use?.people || []).includes(p.id) ? "on" : ""}"><input type="checkbox" id="vanuse" ${(S.set.van_use?.people || []).includes(p.id) ? "checked" : ""}>Van use section in their app (who's on which van for RAM, TUA, Flyer)</label><label class="chk"><input type="checkbox" id="active" ${p.active ? "checked" : ""}>Active (can sign in)</label><label class="chk"><input type="checkbox" id="cleared" ${p.cleared ? "checked" : ""}>Not rostered any more</label><label class="chk"><input type="checkbox" id="payx" ${p.pay_exclude ? "checked" : ""}>Leave out of labour figures</label><button class="btn full" type="submit">Save</button></form>`, (bg, close) => {
      bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
      bg.querySelector("#pf").onsubmit = async e => { e.preventDefault(); const g = x => bg.querySelector("#" + x); const row = { id: id || g("pid").value.trim(), name: g("name").value.trim(), email: g("email").value.trim().toLowerCase() || null, phone: g("phone").value || null, role: g("role").value, perms: [...bg.querySelectorAll("input[name=perm]:checked")].map(i => i.value), rate: g("rate").value ? +g("rate").value : null, started: g("started").value || null, licence_class: g("lc").value || null, licence_expiry: g("le").value || null, dg_expiry: g("dg").value || null, notes: g("notes").value || null, active: g("active").checked, cleared: g("cleared").checked, pay_exclude: g("payx").checked };
        if (p.role === "owner") { row.role = "owner"; row.perms = p.perms || []; }
        const { error } = await sb.from("people").upsert(row); if (error) return toast(error.message, "err");
        const vu = new Set(S.set.van_use?.people || []), had = vu.has(row.id); g("vanuse").checked ? vu.add(row.id) : vu.delete(row.id);
        if (had !== vu.has(row.id)) { const { error: e2 } = await sb.from("settings").upsert({ key: "van_use", value: { runs: ["RAM", "TUA", "FLY"], ...(S.set.van_use || {}), people: [...vu] } }); if (e2) return toast(e2.message, "err"); }
        close(); toast("Saved", "ok"); }; }); }
function wirePeople() {
  $("#person-add")?.addEventListener("click", () => editPerson(""));
  $("#sf").onsubmit = async e => { e.preventDefault(); await q(sb.from("settings").upsert({ key: "links", value: { ...(S.set.links || {}), vault: $("#vault").value } })); toast("Saved", "ok"); };
  $("[data-gotab]")?.addEventListener("click", e => { S.tab = e.target.dataset.gotab; location.hash = S.tab; render(); });
  $("#log-load")?.addEventListener("click", async () => { const rows = await q(sb.from("activity_log").select("*").order("created_at", { ascending: false }).limit(100)); $("#log").innerHTML = `<div class="scroll"><table class="dt"><tr><th>When</th><th>Who</th><th>What</th></tr>${rows.map(r => `<tr><td class="mono">${fmtTs(r.created_at)}</td><td>${esc(r.actor ? nm(r.actor) : r.actor_email || "system")}</td><td><b>${esc(r.action)}</b> <span class="meta">${esc(r.detail || "")}</span></td></tr>`).join("")}</table></div>`; });
}
