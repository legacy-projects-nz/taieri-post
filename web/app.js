// Taieri Post · driver app
import { sb, q, me, nzNow, today, addDays, dow, dayName, monOf, label, longLabel, toMin, fmtT, fmtTs, fmtTime, ago, esc, $, $$, h, toast, pill, first, col, pct, live, debounce, isSort, enablePush, pushState, nzToIso, settings as loadSettings, signOut } from "/shared/core.js";
import { requireUser } from "/shared/auth.js";
import { VAPID_PUBLIC } from "/shared/config.js";
import { cfg, dayShifts, itemsFor, scoreFor, fortnight, itemNote, STATE_LABEL, addName, NET, PICKUP_RUNS, LEG_RUNS, effCalc, setEvidence } from "/shared/score.js";

const app = $("#app");
const S = { me: null, set: {}, C: null, runs: [], runsBy: {}, vans: {}, addons: [], rules: [], people: {}, shifts: [], sods: [], eods: [], marks: [], entries: [], feed: [], changes: [], acks: [], msgs: [], leave: [], alerts: [], loc: null, gotit: {}, login: {} };
try { S.gotit = JSON.parse(localStorage.getItem("tp-gotit") || "{}"); } catch { }
S.open = {};   // which folded boxes are open this visit (not saved: everything below Next shift starts collapsed when the app opens)

/* ================= boot ================= */
(async () => {
  try { S.me = await requireUser(app); } catch { return; }
  // office staff who don't drive (e.g. fleet) have no driver portal: send them to the owner portal
  if (S.me.role !== "driver" && S.me.role !== "owner" && !S.me.can("scorecard")) { location.replace("/admin/"); return; }
  await viewAs();
  await loadAll();
  render();
  window.addEventListener("hashchange", async () => { await viewAs(); await loadAll(); render(); });
  live(["shifts", "sod", "eod", "alerts", "roster_changes", "roster_change_items", "change_acks", "messages", "message_recipients", "leave_requests", "entries", "marks", "vans", "settings", "timing_rules", "addons", "breaks"], debounce(async () => { await loadAll(); render(); }, 400), "drv");
  setInterval(render, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadAll().then(render); } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { });
  // pick up new versions without a manual refresh: compare app.js's ETag now and whenever the app comes back to the front
  let tag = null; const ver = async () => { try { const r = await fetch("/app.js", { method: "HEAD", cache: "no-store" }); const t = r.headers.get("etag") || r.headers.get("last-modified"); if (!t) return; if (tag && t !== tag && !document.querySelector(".sheet-bg")) location.reload(); tag = tag || t; } catch { } };
  // overdue alert: beep (and buzz) every 5 minutes while the app is open and something is still overdue
  let actx = null, lastBeep = 0; const unlock = () => { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch { } };
  ["click", "touchstart", "keydown"].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));
  const beep = () => { try { if (!actx || actx.state !== "running") return false; for (let i = 0; i < 3; i++) { const o = actx.createOscillator(), g = actx.createGain(); o.type = "square"; o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(actx.destination); const t0 = actx.currentTime + i * 0.35; o.start(t0); o.stop(t0 + 0.2); } navigator.vibrate?.([400, 150, 400, 150, 400]); return true; } catch { return false; } };
  setInterval(() => { if (S.viewAs || S.me?.role === "owner" || document.hidden) return; if (!(S.alerts || []).some(a => !a.resolved_at && ["sod_late", "sod_missing", "eod_late", "timing_missed"].includes(a.kind))) { lastBeep = 0; return; } if (Date.now() - lastBeep < 295000) return; if (beep()) lastBeep = Date.now(); }, 5000);
  ver(); setInterval(ver, 300000); document.addEventListener("visibilitychange", () => { if (!document.hidden) ver(); });
})();

async function loadAll() {
  const m = S.me.id; const t = today(); const from = addDays(monOf(t), -56), to = addDays(monOf(t), 13);
  const [set, runs, vans, addons, rules, people, shifts, changes, acks, msgs, leave, alerts, entries, marks, feed, vchk] = await Promise.all([
    loadSettings(), q(sb.from("runs").select("*")), q(sb.from("vans").select("*")), q(sb.from("addons").select("*")), q(sb.from("timing_rules").select("*").eq("active", true)),
    q(sb.from("people_public").select("id,name,role")),
    q(sb.from("shifts").select("*").gte("day", from).lte("day", to).or(`driver.eq.${m},trainee.eq.${m}`)),
    q(sb.from("roster_change_items").select("*, roster_changes!inner(status, sent_at, created_by)").contains("affects", [m]).eq("roster_changes.status", "sent").gte("day", addDays(t, -7))),
    q(sb.from("change_acks").select("*").eq("driver", m)),
    q(sb.from("message_recipients").select("*, messages!inner(*)").eq("person", m).order("created_at", { referencedTable: "messages", ascending: false }).limit(30)),
    q(sb.from("leave_requests").select("*").eq("driver", m).order("created_at", { ascending: false }).limit(20)),
    q(sb.from("alerts").select("*").eq("driver", m).is("resolved_at", null).order("created_at", { ascending: false })),
    q(sb.from("entries").select("*").eq("driver", m).gte("day", from)),
    q(sb.from("marks").select("*").eq("driver", m)),
    q(sb.from("nzpost_feed").select("*").gte("day", from)),
    q((S.viewer?.isStaff ? sb.from("vehicle_checks").select("*").eq("driver", m) : sb.from("vehicle_checks").select("*")).order("at", { ascending: false }).limit(12)),
  ]);
  S.set = set; S.C = cfg(set); S.runs = runs; S.runsBy = Object.fromEntries(runs.map(r => [r.code, r])); S.vans = Object.fromEntries(vans.map(v => [v.plate, v])); S.addons = addons; S.rules = rules;
  try { const { data: pk } = await sb.from("pickups").select("*").eq("driver", m).gte("day", t.slice(0, 7) + "-01").order("day", { ascending: false }).limit(40); S.pickups = pk || []; } catch { S.pickups = []; }
  try { const { data: ai } = await sb.from("access_info").select("body,updated_at").eq("id", 1).maybeSingle(); S.access = ai || { body: "" }; } catch { S.access = { body: "" }; }
  S.people = Object.fromEntries(people.map(p => [p.id, p])); S.shifts = shifts.filter(s => s.driver === m); S.trainee = shifts.filter(s => s.trainee === m && s.driver !== m);
  S.changes = changes; S.acks = acks; S.msgs = msgs; S.leave = leave; S.alerts = alerts; S.entries = entries; S.marks = marks; S.feed = feed; S.vchk = vchk || [];
  const ids = S.shifts.map(s => s.id);
  if (ids.length) { const [sods, eods, ovs] = await Promise.all([q(sb.from("sod").select("*").in("shift_id", ids)), q(sb.from("eod").select("*").in("shift_id", ids)), S.viewer?.isStaff ? q(sb.from("eff_overrides").select("*").in("shift_id", ids)) : sb.rpc("my_eff_overrides").then(r => r.data || [])]); S.sods = sods; S.eods = eods; S.ovs = ovs; } else { S.sods = []; S.eods = []; S.ovs = []; }
  try { const { data: br } = await sb.from("breaks").select("*").eq("driver", m).gte("started_at", new Date(Date.now() - 2 * 86400e3).toISOString()).order("started_at"); S.breaks = br || []; } catch { S.breaks = []; }
  setEvidence(S.shifts, S.eods);
  S.days = dayShifts(S.shifts, S.runsBy, m);
  for (const d of Object.values(S.days)) for (const x of d.segs) { x.sod = S.sods.find(s => s.shift_id === x.shift.id); x.eod = S.eods.find(e => e.shift_id === x.shift.id); x.ov = S.ovs.find(o => o.shift_id === x.shift.id); }
  locationTick();
}

/* ================= staff "view as" ================= */
async function viewAs() {
  const id = (location.hash.match(/as=([A-Za-z0-9_-]+)/) || [])[1];
  if (!S.viewer) S.viewer = S.me; else S.me = S.viewer;
  S.viewAs = null;
  if (id && S.viewer.isStaff && id !== S.viewer.id) {
    const p = await q(sb.from("people").select("*").eq("id", id).maybeSingle());
    if (p) { S.viewAs = p; S.me = { ...p, isOwner: false, isStaff: false, can: () => false }; }
  }
  S.drivers = S.viewer.isStaff ? await q(sb.from("people").select("id,name,role").eq("active", true).eq("cleared", false).in("role", ["driver", "owner"]).order("name")) : [];
  S.login = {}; if (S.viewer.isStaff) { const { data: ls } = await sb.rpc("login_status"); for (const l of ls || []) S.login[l.person_id] = l; }
  await loadGps();
}
/** latest GPS point per person in the last 20 min (staff only) */
async function loadGps() { S.gps = {}; if (!S.viewer?.isStaff) return; try { const { data } = await sb.from("locations").select("driver,at").gte("at", new Date(Date.now() - 20 * 60e3).toISOString()).order("at", { ascending: false }).limit(500); for (const l of data || []) S.gps[l.driver] ??= l.at; } catch { } }
/** gps = GPS in the last 20 min · on = signed in to the app · "" = neither */
function appState(id) { const g = S.gps?.[id]; if (g && Date.now() - new Date(g) <= 20 * 60e3) return "gps"; return S.login?.[id]?.sessions > 0 ? "on" : ""; }
function loginState(id) {   // is this person signed in to the app?
  const L = S.login?.[id]; if (!L || !L.has_account) return { cls: "miss", tag: "not signed up", txt: "Has never signed in to the app" };
  if (L.sessions > 0) return { cls: "ok", tag: "signed in", txt: `Signed in${L.last_active ? ` · last active ${ago(L.last_active)}` : ""}${L.push ? " · notifications on" : " · notifications off"}` };
  return { cls: "late", tag: "signed out", txt: `Signed out${L.last_sign_in ? ` · last signed in ${ago(L.last_sign_in)}` : ""}` };
}
function viewBar() {
  if (!S.viewer?.isStaff) return "";
  const list = S.drivers.filter(d => d.id !== S.viewer.id);
  const i = S.viewAs ? list.findIndex(d => d.id === S.viewAs.id) : -1;
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  return `<div class="card" style="position:sticky;top:6px;z-index:5;border:2px solid var(--accent);background:var(--accent-fill);padding:8px 12px;gap:6px">
    <div class="row" style="align-items:center"><span class="mono" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);flex:0">${S.viewAs ? "Viewing as" : "View as"}</span>
      <button class="in vasel ${S.viewAs ? appState(S.viewAs.id) : ""}" id="view-as" type="button" style="min-height:38px;font-size:14px;flex:1 1 140px;text-align:left">${S.viewAs ? esc(S.viewAs.name) : `— me (${esc(first(S.viewer.name))}) —`} <span style="float:right">▾</span></button>
      <button class="btn ghost sm" id="va-prev" ${prev ? `data-id="${prev.id}"` : "disabled"} style="flex:0">‹</button><button class="btn ghost sm" id="va-next" ${next ? `data-id="${next.id}"` : "disabled"} style="flex:0">›</button>
      <a class="btn ghost sm" href="/admin/" style="flex:0;text-decoration:none">Owner portal</a></div>
    ${S.viewAs ? `<div class="row" style="align-items:center;gap:6px"><span class="chip ${loginState(S.viewAs.id).cls}">${loginState(S.viewAs.id).tag}</span><span class="meta">${esc(loginState(S.viewAs.id).txt)}</span></div>` : ""}</div>`;
}

/* ================= render ================= */
const pair = (a, b) => a && b ? `<div class="pair">${a}${b}</div>` : (a || b || "");   // two boxes across wherever both exist, on phones too
function render() {
  const n = nzNow(); const t = n.date; const name = first(S.me.name);
  const greet = n.min < 720 ? "Morning" : n.min < 1020 ? "Hi" : "Evening";
  const T = S.days[t];
  const nextDay = Object.values(S.days).filter(d => d.day > t).sort((a, b) => a.day < b.day ? -1 : 1)[0];
  app.innerHTML = `<div class="wrap">
    ${viewBar()}
    <div class="top"><div><div class="brand">Taieri Post · driver portal${S.viewAs ? " · viewing as " + esc(first(S.viewAs.name)) : ""}</div><h1>${greet} ${esc(name)} 👋</h1></div><div class="upd"><span class="dot live"></span>live<br>${fmtT(n.min)}</div></div>
    ${quickBar(T, n)}
    ${todayCard(T, nextDay, n)}
    ${puToday(T) ? pickupsCard(T) : ""}
    ${addonsCard(T, nextDay, n)}
    ${rosterChanges(n)}
    ${alertsCard()}
    ${messagesCard()}
    ${scoresCard()}
    <div class="folds">
    ${nextShiftCard(nextDay, n)}
    ${pair(vanCard(T, null), shiftsCard(t))}
    ${pair(toFixCard(n), fromJeremy())}
    ${pair(leaveCard(), detailsCard())}
    ${calendarCard(t)}
    ${moreCard()}
    ${puToday(T) ? "" : pickupsCard(T)}
    ${accessCard()}
    </div>
    <p class="foot">Shift or score looks wrong? Message Jeremy.<br>Signed in as ${esc((S.viewer || S.me).email || "")}</p>
  </div>`;
  folds();
  wire();
}

/* ---------- collapsible boxes: Next shift and everything below it (plus Parcel pick-ups) are one row until tapped ---------- */
function folds() {
  app.querySelectorAll(".folds .card, #pickups").forEach(c => {
    const h = c.querySelector(":scope > h2"); if (!h) return;
    const key = c.id || [...h.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join("").trim();
    if (!(key in S.open)) S.open[key] = c.dataset.foldOpen === "1";
    c.classList.add("fold"); c.classList.toggle("shut", !S.open[key]);
    h.setAttribute("role", "button"); h.tabIndex = 0; h.setAttribute("aria-expanded", String(!!S.open[key]));
    const ch = document.createElement("i"); ch.className = "fchev" + (h.querySelector(":scope > span") ? "" : " solo"); ch.setAttribute("aria-hidden", "true"); h.appendChild(ch);
    const flip = e => { if (e.target.closest("button, a, input, select")) return; if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return; e.preventDefault();
      S.open[key] = !S.open[key]; c.classList.toggle("shut", !S.open[key]); h.setAttribute("aria-expanded", String(S.open[key])); };
    h.addEventListener("click", flip); h.addEventListener("keydown", flip);
  });
}

/* ---------- SOD / EOD quick bar: always under the greeting on a work day ---------- */
function quickBar(T, n) {
  if (!T) return `<div class="qbar"><div class="qb off"><b>▶ SOD</b><small>no shift today</small></div><div class="qb off"><b>■ EOD</b><small>no shift today</small></div></div>`;
  const va = !!S.viewAs; const offB = (lab, txt) => `<div class="qb off"><b>${lab}</b><small>${txt}</small></div>`;
  const runs = T.segs.filter(x => !x.sort); const sodSeg = T.segs.find(x => x.sod); const sod = sodSeg?.sod;
  const sortOnly = !runs.length; const eodOf = x => x.eod;
  const sodBtn = sod ? `<div class="qb done"><b>✓ SOD</b><small>${fmtTime(sod.sent_at)}${sod.van ? ` · ${esc(sod.van)}` : ""}</small></div>` : (va ? offB("▶ SOD", "not posted yet") : `<button class="btn qb" id="sod" data-shift="${T.segs[0].shift.id}"><b>▶ SOD</b><small>start of day</small></button>`);
  const eodBtns = sortOnly
    ? (T.segs.some(eodOf) ? `<div class="qb done"><b>✓ EOD</b><small>sorting finished ${fmtTime(T.segs.find(eodOf).eod.sent_at)}</small></div>` : (va ? offB("■ EOD", "not posted yet") : `<button class="btn qb accent" data-eod="${T.segs[T.segs.length - 1].shift.id}" data-sort="1" ${sod ? "" : "disabled"}><b>■ EOD</b><small>${sod ? "finished sorting" : "after your SOD"}</small></button>`))
    : runs.map(x => { const due = (x.en ?? x.st) + S.C.rules.eodHours * 60; const late = sod && !x.eod && n.min > due;
        return x.eod ? `<div class="qb done"><b>✓ EOD${runs.length > 1 ? ` ${esc(x.shift.run)}` : ""}</b><small>${fmtTime(x.eod.sent_at)}${x.eod.finish_time ? ` · finished ${fmtT(toMin(x.eod.finish_time))}` : ""}</small></div>`
          : va ? offB(`■ EOD${runs.length > 1 ? ` ${esc(x.shift.run)}` : ""}`, late ? "overdue" : "not posted yet") : `<button class="btn qb ${late ? "warn" : "accent"}" data-eod="${x.shift.id}" ${sod ? "" : "disabled"}><b>■ EOD${runs.length > 1 ? ` ${esc(x.shift.run)}` : ""}</b><small>${!sod ? "after your SOD" : late ? "overdue" : "end of run"}</small></button>`; }).join("");
  return `<div class="qbar">${sodBtn}${eodBtns}${breakBtn(T, sod)}</div>`;
}
/* Break: one button between SOD and the last EOD. Tap to start, tap again to end. */
function breakBtn(T, sod) {
  const runs = T.segs.filter(x => !x.sort); const allEod = runs.length ? runs.every(x => x.eod) : T.segs.some(x => x.eod);
  const open = (S.breaks || []).find(b => !b.ended_at);
  const ids = new Set(T.segs.map(x => x.shift.id)); const todays = (S.breaks || []).filter(b => ids.has(b.shift_id) && b.ended_at);
  const mins = todays.reduce((a, b) => a + Math.round((new Date(b.ended_at) - new Date(b.started_at)) / 60000), 0);
  const taken = todays.length ? `${todays.length} break${todays.length > 1 ? "s" : ""} today · ${mins} min` : "";
  if (open) { const m = Math.max(0, Math.round((Date.now() - new Date(open.started_at)) / 60000));
    return S.viewAs ? `<div class="qb brk on"><b>☕ On break</b><small>since ${fmtTime(open.started_at)} · ${m} min</small></div>`
      : `<button class="btn qb brk on" id="brk-end"><b>■ End break</b><small>on break since ${fmtTime(open.started_at)} · ${m} min</small></button>`; }
  if (!sod || allEod) return taken ? `<div class="qb brk off"><b>☕ Break</b><small>${taken}</small></div>` : "";
  if (S.viewAs) return `<div class="qb brk off"><b>☕ Break</b><small>${taken || "none taken yet"}</small></div>`;
  return `<button class="btn ghost qb brk" id="brk-start" data-shift="${(runs.find(x => !x.eod) || T.segs[T.segs.length - 1]).shift.id}"><b>☕ Start break</b><small>${taken || "tap when you stop for a break"}</small></button>`;
}
async function startBreak(shiftId) { const { error } = await sb.rpc("break_start", { p_shift: shiftId }); if (error) return toast(error.message, "err"); toast("Break started ☕", "ok"); await loadAll(); render(); }
async function endBreak() { const { error } = await sb.rpc("break_end"); if (error) return toast(error.message, "err"); toast("Break ended ✓", "ok"); await loadAll(); render(); }

/* ---------- Roster changes ---------- */
function linePast(item, n) {
  if (item.day < n.date) return true; if (item.day > n.date) return false;
  const st = toMin(item.after?.start_at) ?? toMin(item.before?.start_at) ?? (() => { const w = S.runsBy[item.run]?.windows?.[dayName(item.day)]; return w ? toMin(w[0][0]) : null; })();
  return st != null ? n.min >= st : false;
}
function rosterChanges(n) {
  const ackBy = Object.fromEntries(S.acks.map(a => [a.item_id, a]));
  const live_ = S.changes.filter(i => !linePast(i, n)).sort((a, b) => (b.roster_changes.sent_at || "").localeCompare(a.roster_changes.sent_at || ""));
  const settled = i => ackBy[i.id]?.confirmed_at || ackBy[i.id]?.dismissed_at;   // confirmed by the driver or by Jeremy, or dismissed: no button
  const fresh = live_.filter(i => !settled(i) && !S.gotit[i.id]);
  const tapped = live_.filter(i => !settled(i) && S.gotit[i.id]);
  if (!fresh.length && !tapped.length) return "";   // all confirmed or cleared: the box goes away
  const grp = list => { const by = {}; for (const i of list) (by[i.change_id] ??= { at: i.roster_changes.sent_at, items: [] }).items.push(i); return Object.values(by); };
  return `<div class="card ${fresh.length ? "hot" : ""}" id="rc"><h2>Roster changes<span>${fresh.length ? `${fresh.length} to confirm` : "Got it sent"}</span></h2>
    ${grp(fresh).map(g => `<div><div class="meta mono">Sent ${fmtTs(g.at)}</div><ul style="margin:4px 0 0 18px;padding:0;color:var(--crit);font-weight:700">${g.items.map(i => `<li>${esc(i.summary)}</li>`).join("")}</ul></div>`).join("")}
    ${fresh.length ? `<button class="btn crit" id="gotit" data-ids="${fresh.map(i => i.id).join(",")}">Got it, I've read ${fresh.length === 1 ? "this change" : "these changes"}</button><p class="hint">One tap. Jeremy sees your ✓ straight away.</p>` : ""}
    ${tapped.length ? `<p class="hint c-ok">✓ Got it sent for ${tapped.length} change${tapped.length === 1 ? "" : "s"} · <button class="linkbtn" id="gotit-again">Didn't go through? Show again</button></p>` : ""}
  </div>`;
}

/* ---------- From Jeremy / alerts / messages ---------- */
const ENTRY_K = { praise: ["ok", "Nice work 👏"], issue: ["warn", "Heads up"], note: ["accent", "Note"], mistake: ["crit", "Mistake recorded"], adjust: ["accent", "Admin points"], safety: ["warn", "Safety"], eff: ["accent", "Efficiency set"] };
function fromJeremy() {
  const all = S.entries.filter(e => e.show_driver && e.day >= addDays(today(), -56)).sort((a, b) => (b.created_at || b.day).localeCompare(a.created_at || a.day)); if (!all.length) return "";
  const effect = e => [e.kind === "mistake" && !e.excused ? `−${e.pct_off ?? S.C.rules.mistakePct}% Accuracy` : "", e.admin_pts ? `Admin ${e.admin_pts > 0 ? "+" : ""}${e.admin_pts}` : "", e.safety_pct != null ? `Safety ${e.safety_pct}%` : "", e.eff_pct != null ? `Efficiency ${e.eff_pct}%` : ""].filter(Boolean).join(" · ");
  const status = e => e.excused ? pill("removed — doesn't count", "grey") : e.review_requested_at && !e.review_resolved_at ? pill("review requested", "warn") : e.review_resolved_at ? pill("reviewed · stands", "grey") : "";
  const row = e => { const k = ENTRY_K[e.kind] || ENTRY_K.note; return `<div class="item clk ${e.excused ? "done" : k[0]}" data-entryv="${e.id}"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="m">${k[1]} · ${label(e.day)}${e.run ? ` · ${esc(e.run)}` : ""}${effect(e) ? ` · ${esc(effect(e))}` : ""}</div><div>${esc(e.title)}${e.note ? `<div class="meta">${esc(e.note)}</div>` : ""}</div></div>${status(e) || (!S.viewAs ? `<button class="btn ghost sm" data-review="${e.id}" style="flex:0">Request a review</button>` : "")}</div></div>`; };
  const live_ = all.filter(e => !e.excused); const recent = live_.slice(0, 8), older = [...live_.slice(8), ...all.filter(e => e.excused)];
  if (!recent.length && !older.length) return "";
  return `<div class="card"><h2>Notes from Jeremy<span>mistakes, praise and adjustments · nothing to tick — ask for a review if something's not right</span></h2>${recent.length ? `<div class="list">${recent.map(row).join("")}</div>` : `<p class="meta">Nothing current.</p>`}
    ${older.length ? `<details><summary>Older and removed<span class="meta">${older.length}</span></summary><div class="list" style="margin-top:8px">${older.map(row).join("")}</div></details>` : ""}</div>`;
}
function reviewSheet(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  sheet(`<h3>Ask Jeremy to review this</h3><p><b>${esc(e.title)}</b> · ${label(e.day)}</p><form class="frm" id="rv"><label class="f full">What should he look at? (optional)<textarea class="in" id="rv-note" rows="3" placeholder="e.g. That parcel was signed for by the neighbour — photo on my scanner"></textarea></label><button class="btn" type="submit">Send review request</button></form><p class="hint">Jeremy gets this as an alert and will either keep the note or remove it. You'll see the result here.</p>`, (bg, close) => {
    bg.querySelector("#rv").onsubmit = async ev => { ev.preventDefault(); const { error } = await sb.rpc("entry_review", { p_id: id, p_note: bg.querySelector("#rv-note").value }); if (error) return toast(error.message, "err"); close(); toast("Review request sent", "ok"); await loadAll(); render(); };
  });
}
const ALERT_WHAT = { sod_late: "Your start of day wasn't posted on time. Post it now. Late is better than missing.", sod_missing: "No start of day was posted for this shift. Post it now so the day can be scored.", eod_late: "Your end of day wasn't posted on time. Post it now with your run figures.", timing_missed: "A timed task ran past its window. If you did it, tap Done on it under Today's tasks. If not, let Jeremy know.", timing_due: "A timed task on your run is due soon.", vchk_due: "Your weekly vehicle check is due.", change_unconfirmed: "A roster change is waiting for you." };
const myAlerts = () => S.alerts.filter(a => !String(a.dedupe_key || "").startsWith("review|"));
function alertsCard() {
  return ""; // admin-task box removed for drivers: reminders come as the phone alert + beep; Today's tasks shows what is open
  const list = myAlerts(); if (!list.length) return "";
  return `<div class="card hot"><h2>Admin tasks<span>${list.length}</span></h2><div class="list">${list.map(a => `<div class="item ${a.kind.includes("missed") || a.kind === "sod_missing" ? "crit" : "warn"}"><b>${esc(a.title)}</b>${a.body ? `<div class="meta">${esc(a.body)}</div>` : ""}<div class="m">${ago(a.created_at)}</div><div class="row" style="margin-top:6px"><button class="btn sm" data-alertv="${a.id}">What to do</button>${S.viewAs && !S.viewer?.isStaff ? "" : `<button class="btn ghost sm" data-gotit-alert="${a.id}">Got it${S.viewAs ? " (for " + esc(first(S.viewAs.name)) + ")" : ""}</button>`}</div></div>`).join("")}</div></div>`;
}
function messagesCard() {
  const unread = S.msgs.filter(m => !m.read_at); const toConfirm = S.msgs.filter(m => m.messages.needs_confirm && !m.confirmed_at);
  const show = S.msgs.slice(0, 5); if (!show.length) return "";
  return `<div class="card ${toConfirm.length ? "warnc" : ""}" id="msgs"><h2>Messages<span>${toConfirm.length ? `${toConfirm.length} to confirm` : unread.length ? `${unread.length} new` : ""}</span></h2>
    <div class="list">${show.map(m => `<div class="item clk ${m.messages.needs_confirm && !m.confirmed_at ? "warn" : m.confirmed_at || (m.read_at && !m.messages.needs_confirm) ? "done" : m.read_at ? "" : "accent"}" data-msgv="${m.message_id}"><div class="m">${esc(first(S.people[m.messages.sender]?.name || "Jeremy"))} · ${fmtTs(m.messages.created_at)}${m.confirmed_at ? ` · <span class="c-ok">✓ confirmed</span>` : ""}</div><div style="white-space:pre-wrap">${esc(m.messages.body)}</div>${m.messages.needs_confirm && !m.confirmed_at ? `<button class="btn sm" data-confirm="${m.message_id}">Got it</button>` : ""}</div>`).join("")}</div>
    ${S.msgs.length > 5 ? `<details><summary>Older messages</summary><div class="list" style="margin-top:8px">${S.msgs.slice(5).map(m => `<div class="item clk" data-msgv="${m.message_id}"><div class="m">${fmtTs(m.messages.created_at)}</div><div style="white-space:pre-wrap">${esc(m.messages.body)}</div></div>`).join("")}</div></details>` : ""}</div>`;
}

/* ---------- Today / next shift ---------- */
function runName(code) { const r = S.runsBy[code]; const fc = S.C.runCodes[code]; return r ? `${r.name}${fc ? ` (${fc})` : ""}` : code; }
const VAN_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 6.5A1.5 1.5 0 0 1 4.5 5H14l4.2 4.2H20a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1h-1.3a2.5 2.5 0 0 1-4.9 0H9.7a2.5 2.5 0 0 1-4.9 0H4a1 1 0 0 1-1-1V6.5Zm10.6.5H5v4h12.2L13.6 7ZM7.25 18a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm9.5 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/></svg>`;
const vanChips = D => [...new Set(D.segs.map(x => x.shift.van).filter(Boolean))].map(p => `<span class="tag van">${VAN_SVG}${esc(p)}</span>`).join("");
function segRow(x, day, n, isToday, tasks = true) {
  const code = x.shift.run; const r = S.runsBy[code];
  if (!tasks) { const act = isToday ? segActions(x, day, n) : ""; return `<div class="seg clk" data-dayv="${day}" title="Tap for the full day"><div class="rn">${x.sort ? `Sort: ${esc(r?.name || r?.label || "Sort")}` : `${esc(code)}: ${esc(runName(code))}`}${x.shift.trainee ? ` <span class="tag tr">training ${esc(first(S.people[x.shift.trainee]?.name || ""))}</span>` : ""}${act}</div></div>`; }
  const tags = [x.shift.van ? `<span class="tag van"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 6.5A1.5 1.5 0 0 1 4.5 5H14l4.2 4.2H20a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1h-1.3a2.5 2.5 0 0 1-4.9 0H9.7a2.5 2.5 0 0 1-4.9 0H4a1 1 0 0 1-1-1V6.5Zm10.6.5H5v4h12.2L13.6 7ZM7.25 18a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm9.5 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/></svg>${esc(x.shift.van)}</span>` : "", x.shift.trainee ? `<span class="tag tr">training ${esc(first(S.people[x.shift.trainee]?.name || ""))}</span>` : "", ...(tasks ? (x.shift.addons || []).map(a => `<span class="tag">+ ${esc(addName(a))}</span>`) : [])].join("");
  const tw = x.sort || !tasks ? "" : timingRows(x, day, isToday ? n.min : null);
  const act = isToday ? segActions(x, day, n) : "";
  return `<div class="seg clk" data-dayv="${day}" title="Tap for the full day"><div class="tm">${fmtT(x.st)} – ${fmtT(x.en)}</div><div class="rn">${x.sort ? esc(r?.label || "Sort") : `${esc(code)}<span class="sub">${esc(runName(code))}</span>`}<div class="tags">${tags}</div>${tw}${act}</div></div>`;
}
function rulesFor(x, day) {
  const code = x.shift.run; const d = dow(day) + 1; const out = [];
  for (const r of S.rules) {
    if (!r.days.includes(d)) continue;
    const all = r.runs.includes("ALL"); if (!all && !r.runs.includes(code)) continue;
    const ad = r.addon ? S.addons.find(a => a.id === r.addon) : null;
    if (ad && ad.runs.includes(code)) { if (!(x.shift.addons || []).includes(r.addon)) continue; }
    else if (!all && r.runs.length > 1) continue;
    out.push(r);
  }
  return out.sort((a, b) => (toMin(a.closes) ?? toMin(a.opens) ?? 0) - (toMin(b.closes) ?? toMin(b.opens) ?? 0));
}
function winTxt(r) { const f = toMin(r.opens), t = toMin(r.closes); return f != null && t != null ? `${fmtT(f)} – ${fmtT(t)}` : t != null ? `by ${fmtT(t)}` : f != null ? `from ${fmtT(f)}` : "any time"; }
/** Every timed task on a run, each with its own Done button on the day (what Jeremy's Alerts and "Timings today" read). */
function timingRows(x, day, nowMin) {
  const isT = nowMin != null; const rules = rulesFor(x, day); if (!rules.length) return "";
  const rows = rules.map(r => { const f = toMin(r.opens), t = toMin(r.closes); const key = r.addon; const done = key ? x.shift.done?.[key] : null; const gp = !!key?.startsWith("tw_") && /game plan/i.test(r.name); const planned = gp && Object.keys(x.shift.plan || {}).length > 0; let st = "", cls = "", tag = "";
    if (done) { st = `✓ done ${fmtTime(done)}`; cls = "done"; }
    else if (gp && planned) { st = "✓ game plan in"; cls = "done"; }
    else if (isT) { if (t != null && nowMin > t) { st = `✗ not done by ${fmtT(t)}`; cls = "miss"; } else if (f != null && nowMin >= f) { tag = "now"; cls = "now"; } else if (t != null && t - nowMin <= 60) { tag = "due soon"; cls = "now"; } }
    else if (day < today() && key) { st = `✗ not marked done`; cls = "miss"; }
    const btn = !(isT && key && !S.viewAs) ? "" : done ? `<button class="btn sm" data-done="${esc(key)}" data-undo="1" data-shift="${x.shift.id}" title="Tap again to undo" style="flex:0 0 auto;min-height:34px">✓ Done</button>` : !(gp && planned) ? `<button class="btn sm ${cls === "miss" ? "warn" : "ghost"}" data-done="${esc(key)}" data-shift="${x.shift.id}" style="flex:0 0 auto;min-height:34px">Done</button>` : "";
    return `<div class="tw-r ${cls}"><div class="w">${winTxt(r)}${tag ? `<span class="tw-tag">${tag}</span>` : ""}</div><div class="row" style="justify-content:space-between;align-items:center;gap:6px;flex-wrap:nowrap"><div style="flex:1 1 auto"><span class="n">${esc(r.name)}</span>${r.note ? `<span class="x">${esc(r.note)}</span>` : ""}${st ? `<span class="x ${cls === "miss" ? "c-crit" : "c-ok"}" style="font-weight:600">${st}</span>` : ""}${gp && !planned && !done && isT ? `<span class="x">Set your planned times under Change what&#39;s on this run (that counts as the game plan), or tap Done.</span>` : ""}</div>${btn}</div></div>`; });
  return `<div class="tw"><h4>${isT ? "Timed tasks today · tap Done as you finish each one" : "Timed tasks"}</h4>${rows.join("")}${isT ? `<p class="hint" style="margin:4px 0 0">Jeremy sees each Done straight away; a window that passes without Done raises an alert for you both.</p>` : ""}</div>`;
}
const canEditEod = day => !S.viewAs && day >= addDays(today(), -1) && day <= today();
function segActions(x, day, n) {
  if (x.sort) return x.eod ? `<div class="meta c-ok">✓ Sort finished ${fmtTime(x.eod.sent_at)}</div>` : "";
  const T = S.days[day]; const sodDone = T.segs.some(s => s.sod);
  if (x.eod) return `<div class="row" style="margin-top:6px;align-items:center"><div class="meta c-ok">✓ EOD sent ${fmtTime(x.eod.sent_at)}${x.eod.finish_time ? ` · finished ${fmtT(toMin(x.eod.finish_time))}` : ""}${x.eod.edited_at ? " · edited" : ""}</div>${canEditEod(day) ? `<button class="btn ghost sm" data-eodedit="${x.shift.id}">Edit EOD</button>` : ""}</div>`;
  return "";                                                          // the EOD button is in the bar at the top
}
function todayCard(T, N, n) {
  const hol = S.C.holidays[n.date];
  if (T) {
    const left = T.segs.filter(x => n.min < (x.en ?? x.st));
    const sodSeg = T.segs.find(x => x.sod); const allEod = T.segs.filter(x => !x.sort).length ? T.segs.filter(x => !x.sort).every(x => x.eod) : T.segs.some(x => x.eod);
    if (left.length || (!allEod && sodSeg)) {
      const sodBtn = !sodSeg ? `<p class="hint">No SOD yet — tap <b>SOD</b> at the top when you start.</p>`
        : `<div class="row"><div class="meta c-ok">✓ SOD ${fmtTime(sodSeg.sod.sent_at)}${sodSeg.sod.van ? ` · ${esc(sodSeg.sod.van)}` : ""}${sodSeg.sod.edited_at ? " (edited)" : ""}</div>${allEod ? "" : `<button class="btn ghost sm" id="sod-edit" data-shift="${sodSeg.shift.id}">Edit SOD</button>`}</div>`;
      const sortOnly = !T.segs.some(x => !x.sort) && sodSeg && !allEod;
      return `<div class="card today"><h2>Today<span>${label(T.day)}</span></h2><div class="big bigrow"><span>${fmtT((left[0] || T.segs[0]).st)}–${fmtT(T.end)}</span>${vanChips(T)}</div>${left.length === T.segs.length ? `<div class="meta" style="margin-top:-4px">${T.hours} h rostered</div>` : ""}
        ${sodBtn}${(left.length ? left : T.segs).map(x => segRow(x, T.day, n, true, false)).join("")}
        ${S.locOn ? `<p class="hint">📍 Sharing your location with the depot until your EOD.</p>` : ""}</div>`;
    }
  }
  const why = hol ? esc(hol.name) : !T ? "Day off today" : "Today's shift is done ✓";
  return `<div class="card"><h2>Today<span>${label(n.date)}</span></h2><p class="hint" style="font-size:15px">${why}</p></div>`;
}
const dayTag = d => `${d === addDays(today(), 1) ? "Tomorrow · " : ""}${label(d)}`;
/* Back-up (also working that day: add-on hours before/after the shift) and on-call (listed, not rostered): next 7 days */
function buSection(n) {
  const t = n.date || today(), end = addDays(t, 7);
  const list = S.shifts.filter(x => x.run === "BU" && x.day > t && x.day <= end).sort((a, b) => a.day < b.day ? -1 : 1);
  if (!list.length) return "";
  const rows = list.map(x => {
    const works = !!S.days[x.day];
    const kind = works ? "Back-up" : "On-call";
    const what = works
      ? (x.bu_kind === "committed"
        ? `Committed. Be ready for add-on hours before or after your shift${x.bu_block ? `, up to ${x.bu_block} hours` : ""}. Allowance if you're not needed; paid for hours worked if you are.`
        : `Non-compulsory. You may be offered extra hours before or after your shift. Yes or no is your call; paid for hours worked.`) + (works && (S.days[x.day].start >= 720) ? " Your shift starts after midday, so check your phone 6:30 to 7:30am in case you're needed in the morning." : "")
      : `Check your phone between 6:30 and 7:30am and confirm you're available. Any call-in comes between 6:30 and 8am; after that you're free. Allowance if you're not needed; if called in, paid for the time worked (2 hour minimum).`;
    return `<div class="bu"><div class="meta"><b>${kind}</b> · ${dayTag(x.day)}</div><div class="hint" style="margin:2px 0 10px">${what}</div></div>`;
  }).join("");
  return `<section class="ns"><h3 class="sub">Back-up and on-call</h3>${rows}</section>`;
}
function nextShiftCard(N, n) {   // one box: shift, tasks, vehicle, split by grey lines
  if (!N) return `<div class="card nextc"><h2>Next shift<span>not on the roster yet</span></h2><div class="big">Not on the roster yet</div><p class="hint">Your next shift, tasks and van show here once the roster is out.</p>${buSection(n)}</div>`;
  return `<div class="card nextc"><h2>Next shift<span>${N.day === addDays(today(), 1) ? "Tomorrow" : label(N.day)} · ${fmtT(N.start)}–${fmtT(N.end)}</span></h2>
    <section class="ns"><h3 class="sub">Shift</h3><div class="big bigrow"><span>${fmtT(N.start)}–${fmtT(N.end)}</span>${vanChips(N)}</div><div class="meta" style="margin-top:-4px">${N.hours} h rostered</div>${N.segs.map(x => segRow(x, N.day, n, false, false)).join("")}</section>
    <section class="ns shade">${tasksCard(N, n, true, true)}</section>
    <section class="ns"><h3 class="sub">Vehicle</h3>${vanInner(N)}</section>${buSection(n)}</div>`;
}
function vanCard(T, N) {
  const src = T && T.segs.some(x => x.shift.van) ? T : N && N.segs.some(x => x.shift.van) ? N : null; if (!src) return "";
  return `<div class="card"><h2>My van<span>${src === T ? "Today" : `Next shift · ${label(src.day)}`}</span></h2>${vanInner(src)}</div>`;
}
function vanInner(src) {
  if (!src || !src.segs.some(x => x.shift.van)) return `<p class="hint">No van rostered yet.</p>`;
  const plates = [...new Set(src.segs.map(x => x.shift.van).filter(Boolean))];
  const st = (d, soonDays = 14) => { if (!d) return ["unknown", "not on file"]; const n = Math.round((new Date(d) - new Date(today())) / 86400000); return n < 0 ? ["crit", "overdue"] : n <= soonDays ? ["warn", `due in ${n}d`] : ["ok", "✓"]; };
  return `${plates.map(p => { const v = S.vans[p] || {}; const w = st(v.wof_due), r = st(v.rego_due); let ruc = ["unknown", "not on file"], rtxt = "";
    if (v.no_ruc) { ruc = ["ok", "✓"]; rtxt = "not needed (petrol)"; } else if (v.ruc_paid_to) { const left = v.odometer ? v.ruc_paid_to - v.odometer : null; rtxt = `paid to ${v.ruc_paid_to.toLocaleString()} km${left != null ? ` · ${left.toLocaleString()} km left` : ""}`; ruc = left == null ? ["ok", "✓"] : left <= 0 ? ["crit", "overdue"] : left <= (S.C.rules.rucSoonKm || 1000) ? ["warn", "low"] : ["ok", "✓"]; }
    return `<div><button class="plate clk" data-vanv="${esc(p)}" style="background:none;cursor:pointer" title="Tap for this van's history">${esc(p)}</button>${v.model ? ` <span class="meta">${esc(v.model)}</span>` : ""}<dl class="kv" style="margin-top:8px;grid-template-columns:56px 1fr"><dt>WOF</dt><dd>${v.wof_due ? label(v.wof_due, true) + " " : ""}${pill(w[1], w[0] === "unknown" ? "grey" : w[0])}</dd><dt>Rego</dt><dd>${v.rego_due ? label(v.rego_due, true) + " " : ""}${pill(r[1], r[0] === "unknown" ? "grey" : r[0])}</dd><dt>RUCs</dt><dd>${esc(rtxt)} ${pill(ruc[1], ruc[0] === "unknown" ? "grey" : ruc[0])}</dd></dl></div>`; }).join("")}
    <p class="hint">Low or overdue? Tell Stu. Tap the plate for your checks and history with this van.</p>`;
}
function shiftsCard(t) {
  const mon = monOf(t); const nextMon = addDays(mon, 7);
  const row = d => { const D = S.days[d]; const hol = S.C.holidays[d]; const isT = d === t;
    const txt = hol ? esc(hol.name) : D ? D.segs.map(x => x.sort ? esc(S.runsBy[x.shift.run]?.label || "Sort") : `${esc(x.shift.run)}${x.shift.van ? ` · ${esc(x.shift.van)}` : ""}`).join(" → ") : "Off";
    return `<div class="day ${D ? "clk" : "off"} ${isT ? "todayrow" : ""}" ${D ? `data-dayv="${d}" title="Tap for the detail"` : ""}><div class="dl">${label(d).slice(0, 6)}</div><div>${txt}</div><div class="dh">${D ? `${fmtT(D.start)}–${fmtT(D.end)}` : ""}</div></div>`; };
  const thisW = []; for (let d = addDays(t, 1); d < nextMon; d = addDays(d, 1)) thisW.push(d);
  const nextW = []; for (let d = nextMon; d < addDays(nextMon, 7); d = addDays(d, 1)) nextW.push(d);
  const nShifts = nextW.filter(d => S.days[d]).length; const rosterOut = S.shifts.some(s => s.day >= nextMon) || nShifts > 0;
  const lastW = []; for (let d = addDays(mon, -7); d < mon; d = addDays(d, 1)) lastW.push(d); const earlier = []; for (let d = mon; d <= t; d = addDays(d, 1)) earlier.push(d);
  return `<div class="card"><h2>My shifts<span>tap a day for posts, figures and your score that day</span></h2>${earlier.length ? `<details><summary>Earlier this week<span class="meta">${earlier.filter(d => S.days[d]).length} shift${earlier.filter(d => S.days[d]).length === 1 ? "" : "s"}</span></summary>${earlier.map(row).join("")}</details>` : ""}<div class="meta mono">This week</div>${thisW.length ? thisW.map(row).join("") : `<div class="day off"><div class="dl"></div><div>Nothing left this week</div><div></div></div>`}
    <details><summary>Next week<span class="meta">${rosterOut ? `${nShifts} shift${nShifts === 1 ? "" : "s"}` : "roster not out yet"}</span></summary>${nextW.map(row).join("")}</details>
    <details><summary>Last week<span class="meta">${lastW.filter(d => S.days[d]).length} shift${lastW.filter(d => S.days[d]).length === 1 ? "" : "s"}</span></summary>${lastW.map(row).join("")}</details></div>`;
}

/* ---------- Add-ons (beside the shift: one button per add-on, tap = done) ---------- */
function runSegOf(D) { return D && D.segs.filter(x => (!x.sort || x.shift.addons?.length) && (S.addons.some(a => a.runs.includes(x.shift.run)) || x.shift.addons?.length || rulesFor(x, D.day).length)); }
function addonsCard(T, N, n) {   // today's tasks, only while today's run is still going
  const rs = runSegOf(T); const openTask = !!T && !!rs?.some(x => rulesFor(x, T.day).some(r => r.addon && !(x.shift.done || {})[r.addon])); const done = !T || !rs?.length || (n.min >= Math.max(...rs.map(x => x.en ?? x.st)) && !openTask);
  return done ? "" : tasksCard(T, n, false);
}
function nextTasksCard(N, n) {   // tasks for the next shift (tomorrow when rostered), grey side bar
  if (!N) return `<div class="card nextc"><h2>Next tasks</h2><p class="hint">Your tasks show here once your next shift is on the roster.</p></div>`;
  return tasksCard(N, n, true);
}
function tasksCard(D, n, next, bare = false) {
  const isT = !next && D.day === n.date;
  const sat = dayName(D.day) === "Sat";
  const blocks = (runSegOf(D) || []).map(x => {
    const code = x.shift.run; const opts = S.addons.filter(a => a.runs.includes(code) && !(sat && a.no_saturday) && !a.id.startsWith("tw_"));
    const on = new Set(x.shift.addons || []); const plan = x.shift.plan || {}; const done = x.shift.done || {};
    // one list: every timed task on the run, then any add-on that has no timed task of its own
    const items = []; const covered = new Set();
    for (const r of rulesFor(x, D.day)) { const key = r.addon || null; if (key) covered.add(key); const gp = !!key?.startsWith("tw_") && /game plan/i.test(r.name); const planned = gp && Object.keys(plan).length > 0;
      items.push({ key, title: r.name, desc: r.note || (key && !key.startsWith("tw_") ? (S.addons.find(a => a.id === key)?.name || "") : ""), time: winTxt(r), opens: toMin(r.opens), closes: toMin(r.closes), doneAt: key ? done[key] : null, planned }); }
    for (const id of x.shift.addons || []) { if (covered.has(id) || id.startsWith("tw_")) continue; const o = S.addons.find(a => a.id === id); if (!o) continue;
      items.push({ key: id, title: o.name, desc: plan[id] ? `planned ${fmtT(toMin(plan[id]))}` : o.minutes ? `${o.minutes} min allowed on the run` : "add-on on this run", time: "any time", opens: null, closes: null, doneAt: done[id], planned: false }); }
    const nDone = items.filter(t => t.doneAt || t.planned).length;
    const row = t => { const isDone = !!(t.doneAt || t.planned); let cls = "", st = "";
      if (isDone) { cls = "ok"; st = t.doneAt ? `✓ done ${fmtTime(t.doneAt)}` : "✓ game plan in"; }
      else if (isT) { if (t.closes != null && n.min > t.closes) { cls = "over"; st = `overdue · was due ${fmtT(t.closes)}`; } else if (t.closes != null && t.closes - n.min <= 60) { cls = "soon"; st = `due in ${t.closes - n.min} min`; } else { cls = "pend"; st = "not done yet"; } }
      const btn = isT && !isDone && t.key && (!S.viewAs || S.viewer?.isStaff) ? `<button class="btn sm accent" data-done="${esc(t.key)}" data-shift="${x.shift.id}">Done</button>` : "";
      return `<div class="tk ${cls}"><div class="tkt"><div class="t">${esc(t.title)}</div><div class="d">${esc(t.desc || "")}</div><div class="w">${esc(t.time)}${st ? ` · ${st}` : ""}</div></div>${btn}</div>`; };
    return `<div class="ablk"><div class="row" style="justify-content:space-between"><b style="font-size:16px">${esc(code)}</b><span class="meta">${fmtT(x.st)} – ${fmtT(x.en)}${items.length && isT ? ` · ${nDone}/${items.length} done` : ""}</span></div>
      ${items.length ? `<div class="tks">${items.map(row).join("")}</div>` : `<p class="meta" style="margin:4px 0 0">Nothing extra on this run.</p>`}
      <details class="abmore"><summary>Change what's on this run${opts.some(o => o.task && on.has(o.id)) ? " · planned times" : ""}</summary><div class="list" style="margin-top:6px">${opts.map(o => { const isOn = on.has(o.id); const rule = S.rules.find(r => r.addon === o.id);
        return `<div class="row" style="align-items:center"><label class="chk ${isOn ? "on" : ""}" style="flex:1 1 60%"><input type="checkbox" data-addon="${o.id}" data-shift="${x.shift.id}" ${isOn ? "checked" : ""}>${esc(o.name)}${rule ? `<span class="meta" style="margin-left:auto">${winTxt(rule)}</span>` : ""}</label>
          ${o.task && isOn ? `<input class="in" type="time" step="900" style="flex:0 0 120px;min-height:40px" value="${esc(plan[o.id] || "")}" data-plan="${o.id}" data-shift="${x.shift.id}" aria-label="Planned time for ${esc(o.name)}">` : ""}</div>`; }).join("")}</div>
        <p class="hint" style="margin:6px 0 0">Ticks and times save straight away and show on the Run Board${opts.some(o => o.task && on.has(o.id)) ? " (your planned times are your game plan)" : ""}.</p></details></div>`;
  }).join("");
  if (bare) return `<h3 class="sub">Tasks</h3>${blocks || `<p class="hint">Nothing extra on this shift.</p>`}`;
  return `<div class="card${next ? " nextc" : ""}"><h2>${isT ? "Today's tasks" : "Next tasks"}<span>${isT ? "add-ons + timed tasks" : dayTag(D.day)}</span></h2>
    ${blocks || `<p class="hint">Nothing extra on this shift.</p>`}</div>`;
}

/* ---------- Scores ---------- */
function scoreRanges() { // this week (Mon–Sun) and this month, side by side
  const t = today(); const mon = monOf(t);
  const first = t.slice(0, 8) + "01"; const d = new Date(first + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return { week: { from: mon, to: addDays(mon, 6), l: "This week" }, month: { from: first, to: d.toISOString().slice(0, 10), l: "This month" } };
}
function scoresCard() {
  const RG = scoreRanges(); const D = { shifts: S.shifts, sods: S.sods, eods: S.eods, marks: S.marks, entries: S.entries, feed: S.feed, runsBy: S.runsBy, ovs: S.ovs };
  const SC = { week: scoreFor(S.me.id, RG.week.from, RG.week.to, D, S.C), month: scoreFor(S.me.id, RG.month.from, RG.month.to, D, S.C) };
  S.sc = SC.month; S.F = RG.month; S.SC = SC; S.RG = RG;                       // To fix and the day sheets read the month (it covers the week)
  const [selK, selR] = (S.scSel || "").split("|");
  const half = (k, r) => { const v = SC[r][k]; return `<button class="half ${selK === k && selR === r ? "sel" : ""}" data-sc="${k}|${r}"><div class="l">${RG[r].l}</div><div class="v c-${col(v)}">${pct(v)}</div><div class="bar"><i class="bg-${col(v)}" style="width:${Math.min(100, v || 0)}%"></i></div></button>`; };
  const sub = k => `<button class="half sub ${selK === k && selR === "month" ? "sel" : ""}" data-sc="${k}|month"><span class="l">${RG.month.l}</span><span class="v">${pct(SC.month[k])}</span></button>`; // month sits under the week, in grey
  const tile = (k, l) => `<div class="tile dual"><div class="l">${l} ▾</div><div class="halves">${half(k, "week")}${sub(k)}</div></div>`;
  const sc = SC.week; const line = [`${sc.onTime} of ${sc.closed} posts on time this week`, sc.late ? `${sc.late} late` : "", sc.missing ? `${sc.missing} missing` : "", sc.nMist ? `${sc.nMist} mistake${sc.nMist === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  const fresh = !SC.month.closed && !SC.month.effDays.length && !SC.month.accDays.length && RG.week.from < S.C.rules.startDate;
  return `<div class="card" id="scores"><h2>My scores<span>week of ${label(RG.week.from)} · ${new Date(RG.month.from + "T12:00:00Z").toLocaleString("en-NZ", { month: "long", timeZone: "UTC" })}</span></h2>
    ${fresh ? `<p class="hint">Scores count from ${label(S.C.rules.startDate)}. Your first scored shifts will show here.</p>` : ""}
    <div class="tiles" style="grid-template-columns:1fr 1fr">${tile("admin", "Admin")}${tile("eff", "Efficiency")}${tile("acc", "Accuracy")}${tile("safe", "Safety")}</div>
    <div class="meta">Overall <b class="c-${col(SC.week.overall)}">${pct(SC.week.overall)}</b> this week · <b class="c-${col(SC.month.overall)}">${pct(SC.month.overall)}</b> this month · ${line} · tap a score to see the figures</div>
    ${selK && SC[selR] ? `<div class="meta mono" style="text-transform:uppercase">${RG[selR].l} · ${label(RG[selR].from)} – ${label(RG[selR].to)}</div>${scoreDetail(SC[selR], selK)}` : ""}
    ${historyBlock()}</div>`;
}
function dataFor() { return { shifts: S.shifts, sods: S.sods, eods: S.eods, marks: S.marks, entries: S.entries, feed: S.feed, runsBy: S.runsBy, ovs: S.ovs }; }
function scoreAt(from, to) { return scoreFor(S.me.id, from, to, dataFor(), S.C); }
function historyBlock() {
  const t = today(); const weeks = Array.from({ length: 6 }, (_, i) => addDays(monOf(t), -7 * i)).map(w => ({ w, s: scoreAt(w, addDays(w, 6)) })).filter(x => x.s.closed || x.s.effDays.length || x.s.accDays.length);
  if (!weeks.length) return "";
  return `<details style="border-top:1px solid var(--line);padding-top:8px"><summary>History by week<span class="meta">tap a week</span></summary><div class="scroll"><table class="dt"><tr><th>Week of</th><th>On time</th><th>Admin</th><th>Eff</th><th>Acc</th><th>Overall</th></tr>${weeks.map(({ w, s }) => `<tr class="clk" data-weekv="${w}"><td>${label(w)}</td><td class="num">${s.closed ? `${s.onTime}/${s.closed}` : "—"}</td><td class="c-${col(s.admin)}">${pct(s.admin)}</td><td class="c-${col(s.eff)}">${pct(s.eff)}</td><td class="c-${col(s.acc)}">${pct(s.acc)}</td><td class="c-${col(s.overall)}"><b>${pct(s.overall)}</b></td></tr>`).join("")}</table></div></details>`;
}
function scoreDetail(sc, k) {
  const R = S.C.rules; const tbl = (head, rows) => rows.length ? `<div class="scroll"><table class="dt"><tr>${head.map(x => `<th>${x}</th>`).join("")}</tr>${rows.join("")}</table></div>` : "";
  let body = "";
  if (k === "admin") { const rows = sc.items.filter(i => !["due", "over"].includes(i.st) || i.st === "over").sort((a, b) => a.day.localeCompare(b.day)).map(i => `<tr class="clk ${i.st === "exc" ? "done" : ""}" data-postv="${esc(i.key)}"><td>${label(i.day)}</td><td>${esc(i.label)}<div class="meta">${itemNote(i)}</div></td><td>${pill(STATE_LABEL[i.st], i.st === "ok" ? "ok" : i.st === "miss" ? "crit" : ["due", "over", "exc"].includes(i.st) ? "grey" : "warn")}</td></tr>`);
    body = `<p class="hint">Starts at 100%. Each late or missing post takes off ${R.perEvent}%. It never drops below ${R.adminFloor}%. Tap a post to see what was sent and when it was due.</p>${tbl(["Day", "Post", "Result"], rows) || `<p class="empty">No posts counted for these days. Posts count from ${label(R.adminStart)}.</p>`}${sc.adj ? `<p class="meta">Adjustments from Jeremy: ${sc.entries.filter(e => e.admin_pts).map(e => `${label(e.day)} ${e.admin_pts > 0 ? "+" : ""}${e.admin_pts} (${esc(e.title)})`).join(", ")}</p>` : ""}`; }
  if (k === "eff") { const rows = sc.effDays.filter(e => !e.pending).map(e => `<tr class="clk" data-effv="${e.day}"><td>${label(e.day)}</td><td>${e.manual ? "set by Jeremy" : e.rows.map(r => r.code).join(" + ")}</td><td class="num">${e.allowed ? (e.est ? "≈" : "") + e.allowed.toFixed(1) + " h" : ""}</td><td class="num">${e.taken ? e.taken.toFixed(1) + " h" : ""}</td><td class="c-${col(Math.min(100, e.v))}">${Math.round(e.v)}%${e.est ? " est" : ""}</td></tr>`);
    const pend = sc.effDays.filter(e => e.pending);
    body = `<p class="hint">Expected hours (sorting plus the run, worked out from your EOD figures) divided by the hours you actually took. 100% means right on the expected time. Tap a day to see the working.</p>${tbl(["Day", "Run", "Expected", "Actual", "Score"], rows) || `<p class="empty">No finished runs with full figures on these days.</p>`}${pend.length ? `<p class="meta">Waiting on figures: ${pend.map(e => `<button class="linkbtn" data-effv="${e.day}">${label(e.day)} ${esc(e.need || "EOD")}</button>`).join(" · ")}</p>` : ""}${sc.effDays.some(e => e.est) ? `<p class="meta">≈ means a best guess was used for a missing EOD figure.</p>` : ""}`; }
  if (k === "acc") { const rows = sc.accDays.map(a => `<tr class="clk" data-accv="${a.day}|${esc(a.code)}"><td>${label(a.day)}</td><td>${esc(a.code)}</td><td class="num">${a.items}</td><td class="num">${a.compliant}</td><td class="c-${col(a.v)}">${a.v == null ? "—" : a.v.toFixed(1) + "%"}</td></tr>`);
    body = `<p class="hint">From NZ Post's daily report: items scanned correctly ÷ items for delivery. Each mistake in the Driver Mistakes Record takes off ${R.mistakePct}%.</p>${tbl(["Day", "Run", "Items", "Correct", "%"], rows) || `<p class="empty">No NZ Post report figures for your runs on these days.</p>`}${sc.nMist ? `<p class="meta">Mistakes: ${sc.mistakes.map(m => `<button class="linkbtn" data-entryv="${m.id}">${label(m.day)} ${esc(m.title)}</button>`).join(" · ")}</p>` : `<p class="meta">No mistakes logged. 👍</p>`}`; }
  if (k === "safe") { const rows = sc.entries.filter(e => e.safety_pct != null).map(e => `<tr class="clk" data-entryv="${e.id}"><td>${label(e.day)}</td><td class="num">${e.safety_pct}%</td><td>${esc(e.title)}</td></tr>`); body = `<p class="hint">Stays at 100% unless Jeremy records a safety issue.</p>${tbl(["Day", "Score", "Note"], rows) || `<p class="meta">Nothing recorded. 👍</p>`}`; }
  return `<div style="border-top:1px solid var(--line);padding-top:8px">${body}</div>`;
}

/* ---------- To fix ---------- */
function toFixCard(n) {
  const its = (S.sc?.items || []).filter(i => ["late", "miss", "over"].includes(i.st) && !i.pre);
  const pend = (S.sc?.effDays || []).filter(e => e.pending && e.need && !e.need.includes("EOD"));
  if (!its.length && !pend.length) return "";
  return `<div class="card warnc"><h2>To fix<span>${its.length + pend.length} to check</span></h2><div class="list">
    ${its.sort((a, b) => b.day.localeCompare(a.day)).map(i => `<div class="item warn clk" data-postv="${esc(i.key)}"><div class="m c-warn">${label(i.day)}</div><div>${esc(i.label)}: ${itemNote(i)}</div>${!i.row ? `<button class="btn sm ${i.kind === "SOD" ? "" : "accent"}" data-${i.kind === "SOD" ? "sod-late" : "eod"}="${i.shift.id}" data-day="${i.day}">Post it now</button>` : ""}</div>`).join("")}
    ${pend.map(e => `<div class="item warn clk" data-effv="${e.day}"><div class="m c-warn">${label(e.day)}</div><div>EOD figures missing: ${esc(e.need)}</div><div class="meta">Ask Jeremy to add them, or include them next time. Tap to see the working.</div></div>`).join("")}</div></div>`;
}

/* ---------- Leave ---------- */
const LEAVE_T = { annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave", bereave: "Bereavement leave", dayoff: "Day off request", other: "Other" };
function leaveCard() {
  const mine = S.leave; const st = s => pill(s, s === "approved" ? "ok" : s === "declined" ? "crit" : s === "pending" ? "warn" : "grey");
  return `<div class="card" id="leave"><h2>Leave<span>${mine.filter(l => l.status === "pending").length ? `${mine.filter(l => l.status === "pending").length} waiting` : ""}</span></h2>
    ${mine.length ? `<div class="list">${mine.slice(0, 6).map(l => `<div class="item clk ${l.status === "pending" ? "" : "done"}" data-leavev="${l.id}"><div class="row" style="justify-content:space-between"><b>${esc(LEAVE_T[l.type] || l.type)}</b>${st(l.status)}</div><div class="meta mono">${label(l.date_from)}${l.date_to !== l.date_from ? ` – ${label(l.date_to)}` : ""}${l.part !== "full" ? ` · ${l.part === "AM" ? "morning off" : "afternoon off"}` : ""}</div>${l.notes ? `<div class="meta">${esc(l.notes)}</div>` : ""}${l.reply ? `<div style="background:var(--card);border-radius:6px;padding:6px 8px;font-size:13px">${esc(l.reply)}</div>` : ""}</div>`).join("")}</div>` : ""}
    <button class="btn ghost" id="leave-new">Request leave</button></div>`;
}

/* ---------- Details / more ---------- */
function detailsCard() {
  const p = S.me; const d = (v, soon = 30) => { if (!v) return pill("not on file", "grey"); const n = Math.round((new Date(v) - new Date(today())) / 86400000); return `${label(v, true)} ${n < 0 ? pill("expired", "crit") : n <= soon ? pill(`due in ${n}d`, "warn") : pill("✓", "ok")}`; };
  return `<div class="card"><h2>My details</h2><dl class="kv"><dt>Phone</dt><dd>${p.phone ? esc(p.phone) : pill("not on file", "grey")}</dd><dt>Email</dt><dd>${esc(p.email || "")}</dd><dt>Licence</dt><dd>${p.licence_class ? esc(p.licence_class) + " · " : ""}${d(p.licence_expiry)}</dd><dt>DG</dt><dd>${d(p.dg_expiry)}</dd></dl>
    <button class="btn ghost sm" id="prof-edit">Update my details</button></div>`;
}
const PU_CUST = { NZC: "NZ Couriers", PH: "Post Haste", TGE: "TGE (NZ National Network)" };
// Runs that do invoiced pick-ups, and the area they're usually in
const PU_AREA = { TUA: "Rural", FLY: "Owaka", DB: "Owaka", LAW: "Lawrence" };
const PU_AREAS = ["Rural", "Owaka", "Lawrence"];
const PU_SRC = ["depot", "customer"]; const PU_SRC_L = { depot: "depot", customer: "customer" };
const puToday = T => (T?.segs || []).map(x => x.shift.run).find(r => PU_AREA[r]);
function pickupsCard(T) {
  if (S.viewAs) return "";
  const list = S.pickups || []; const run = puToday(T); const todays = list.filter(r => r.day === today());
  return `<div class="card" id="pickups"${run ? ` data-fold-open="1"` : ""}><h2>Parcel pick-ups<span>${todays.length ? `✓ ${todays.length} logged today` : run ? "pick-up run today" : "Rural · Owaka · Lawrence"}</span></h2>
    <p class="meta" style="margin:0 0 8px">${run ? "You're on a pick-up run today. " : ""}Enter how many parcels you picked up for each customer so they can be invoiced.</p>
    ${todays.length ? `<p class="meta c-ok" style="margin:0 0 8px">✓ Today: ${todays.map(r => `${esc(r.area)} ${esc(PU_CUST[r.customer] || r.customer)} (${PU_SRC_L[r.source] || "depot"}) ${r.small} small${r.large ? ` + ${r.large} large` : ""}`).join(" · ")}</p>` : ""}
    <div class="row"><button class="btn sm" id="pu-log" style="flex:0 0 auto">+ Enter pick-ups</button></div>
    ${list.length ? `<details style="margin-top:8px"><summary>This month · ${list.length} logged</summary><div class="list" style="margin-top:6px">${list.map(r => `<div class="item"><div>${label(r.day)} · ${esc(r.area)} · ${esc(PU_CUST[r.customer] || r.customer)} · ${PU_SRC_L[r.source] || "depot"}</div><div class="meta">${r.small} small${r.large ? ` · ${r.large} large` : ""}${r.note ? ` · ${esc(r.note)}` : ""}</div></div>`).join("")}</div><p class="hint">Made a mistake? Message Jeremy or Alejandro and they'll fix it.</p></details>` : ""}</div>`;
}
function logPickup() {
  const area = PU_AREA[puToday(S.days[today()])] || "Lawrence";
  sheet(`<h3>Enter pick-ups</h3><form class="frm" id="pf"><label class="f">Date<input class="in" type="date" id="pu-day" value="${today()}" required></label>
    <label class="f">Area<select class="in" id="pu-area">${PU_AREAS.map(a => `<option ${a === area ? "selected" : ""}>${a}</option>`).join("")}</select></label>
    <div class="full"><table class="dt" style="width:100%"><tr><th rowspan="2">Customer</th><th colspan="2">Depot</th><th colspan="2">Customer</th></tr><tr><th>Small</th><th>Large</th><th>Small</th><th>Large</th></tr>${Object.entries(PU_CUST).map(([k, v]) => `<tr><td>${esc(v)}</td>${PU_SRC.map(src => `<td><input class="in" data-pu="${k}.${src}.small" inputmode="numeric" placeholder="0" style="width:54px"></td><td><input class="in" data-pu="${k}.${src}.large" inputmode="numeric" placeholder="0" style="width:54px"></td>`).join("")}</tr>`).join("")}</table></div>
    <label class="f full">Note (optional)<input class="in" id="pu-n"></label><button class="btn full" type="submit">Save pick-ups</button></form>`, (bg, close) => {
    bg.querySelector("#pf").addEventListener("submit", async e => { e.preventDefault(); const g = x => bg.querySelector("#" + x).value; const v = k => Math.max(0, parseInt(bg.querySelector(`[data-pu="${k}"]`).value) || 0);
      const rows = Object.keys(PU_CUST).flatMap(c => PU_SRC.map(src => ({ day: g("pu-day"), area: g("pu-area"), customer: c, source: src, small: v(`${c}.${src}.small`), large: v(`${c}.${src}.large`), note: g("pu-n") || null, driver: S.me.id, created_by: S.me.id }))).filter(r => r.small || r.large);
      if (!rows.length) return toast("Enter at least one parcel", "err");
      const { error } = await sb.from("pickups").insert(rows);
      if (error) return toast(error.message, "err"); close(); toast("Pick-ups saved ✓", "ok"); await loadAll(); render(); }); });
}
function accessCard() {
  const body = (S.access?.body || "").trim(); const canEdit = !!S.viewer?.can?.("people");
  if (!body && !canEdit) return "";
  return `<div class="card" id="access"><h2>Passwords &amp; logins<span>shared work logins only</span></h2>
    ${body ? `<details><summary>Show</summary><pre class="msg" style="white-space:pre-wrap;user-select:all;margin:8px 0 0">${esc(body)}</pre></details>` : `<p class="meta">Nothing added yet.</p>`}
    ${canEdit ? `<div class="row" style="margin-top:8px"><button class="btn ghost sm" id="access-edit" style="flex:0 0 auto">Update</button></div>` : ""}
    <p class="hint" style="margin:6px 0 0">Keep these for work only. Don't share them outside the team.</p></div>`;
}
function editAccess() {
  sheet(`<h3>Passwords &amp; logins</h3><form class="frm" id="acf"><label class="f full">What drivers see<textarea class="in" id="ac-body" rows="10" placeholder="e.g. Scanner PIN, shared logins, key-box codes">${esc(S.access?.body || "")}</textarea></label><button class="btn full" type="submit">Save</button></form><p class="hint">Every driver and staff member can see this box once signed in. Only add shared work logins, never your own personal passwords.</p>`, (bg, close) => {
    bg.querySelector("#acf").addEventListener("submit", async e => { e.preventDefault(); const body = bg.querySelector("#ac-body").value; const { error } = await sb.from("access_info").upsert({ id: 1, body, updated_at: new Date().toISOString(), updated_by: S.viewer.id }); if (error) return toast(error.message, "err"); S.access = { body }; close(); toast("Saved", "ok"); render(); });
  });
}
function moreCard() {
  const vault = S.set.links?.vault;
  return `<div class="card"><h2>More</h2><div class="row">
    ${vault ? `<a class="btn ghost" href="${esc(vault)}" target="_blank" rel="noopener">🔐 Vault (Damstra)</a>` : ""}
    <button class="btn ghost" id="push-btn">🔔 Notifications: <span id="push-state">…</span></button>
    <button class="btn ghost" id="vchk-btn">🚐 Weekly vehicle check</button>
    <button class="btn ghost" id="signout">Sign out</button></div>
    <p class="hint">Add this page to your Home Screen for one-tap access and notifications (iPhone: Share → Add to Home Screen).</p></div>`;
}

/* ================= wiring ================= */
function wire() {
  $("#signout")?.addEventListener("click", signOut);
  $("#view-as")?.addEventListener("click", async () => { await loadGps(); const list = S.drivers.filter(d => d.id !== S.viewer.id);
    sheet(`<h3>View as</h3><p class="meta">White = not signed in · <span class="c-ok">light green</span> = signed in to the app · <b class="c-ok">dark green</b> = GPS in the last 20 min</p><div class="vagrid"><button class="vapick" data-va="">— me (${esc(first(S.viewer.name))}) —</button>${list.map(d => { const st = appState(d.id); return `<button class="vapick ${st} ${S.viewAs?.id === d.id ? "cur" : ""}" data-va="${d.id}"><b>${esc(d.name)}</b>${d.role !== "driver" ? ` <span class="meta">(${esc(d.role)})</span>` : ""}<span class="meta">${st === "gps" ? `GPS ${ago(S.gps[d.id])}` : esc(loginState(d.id).tag)}</span></button>`; }).join("")}</div>`,
      (bg, close) => bg.querySelectorAll("[data-va]").forEach(b => b.onclick = () => { close(); location.hash = b.dataset.va ? "as=" + b.dataset.va : ""; })); });
  $$("#va-prev,#va-next").forEach(b => b.onclick = () => { if (b.dataset.id) location.hash = "as=" + b.dataset.id; });
  if (S.viewAs) { $$("#gotit,#gotit-again,[data-confirm],[data-addon],[data-plan],#leave-new,#push-btn,#vchk-btn").forEach(el => { el.disabled = true; el.title = "Only " + first(S.viewAs.name) + " can do this"; el.style.opacity = ".5"; }); }
  pushState().then(s => { const el = $("#push-state"); if (el) el.textContent = s === "on" ? "on" : s === "denied" ? "blocked in phone settings" : s === "unsupported" ? "add to Home Screen first" : "off, tap to turn on"; });
  $("#push-btn")?.addEventListener("click", async () => { const r = await enablePush(S.me.id, VAPID_PUBLIC); toast(r.ok ? "Notifications are on" : r.why, r.ok ? "ok" : "err"); render(); });
  $("#gotit")?.addEventListener("click", async e => { const ids = e.currentTarget.dataset.ids.split(","); for (const id of ids) S.gotit[id] = new Date().toISOString(); localStorage.setItem("tp-gotit", JSON.stringify(S.gotit)); render();
    const { error } = await sb.from("change_acks").update({ confirmed_at: new Date().toISOString(), seen_at: new Date().toISOString() }).in("item_id", ids).eq("driver", S.me.id); if (error) toast("Couldn't send. Try again.", "err"); else toast("Confirmed ✓", "ok"); });
  $("#gotit-again")?.addEventListener("click", () => { S.gotit = {}; localStorage.removeItem("tp-gotit"); render(); });
  $$("[data-review]").forEach(b => b.onclick = e => { e.stopPropagation(); reviewSheet(b.dataset.review); });
  $$("[data-seen]").forEach(b => b.onclick = async e => { e.stopPropagation(); b.disabled = true; const { error } = await sb.rpc("entry_seen", { p_id: b.dataset.seen }); if (error) { toast(error.message, "err"); b.disabled = false; return; } const en = S.entries.find(x => x.id === b.dataset.seen); if (en) en.seen_at = new Date().toISOString(); toast("Marked as viewed", "ok"); render(); });
  $$("[data-confirm]").forEach(b => b.onclick = async () => { await q(sb.from("message_recipients").update({ confirmed_at: new Date().toISOString(), read_at: new Date().toISOString() }).eq("message_id", b.dataset.confirm).eq("person", S.me.id)); toast("Confirmed ✓", "ok"); });
  const unread = S.msgs.filter(m => !m.read_at).map(m => m.message_id); if (unread.length) sb.from("message_recipients").update({ read_at: new Date().toISOString() }).in("message_id", unread).eq("person", S.me.id).then(() => { });
  $("#sod")?.addEventListener("click", e => sendSod(e.currentTarget.dataset.shift));
  $("#brk-start")?.addEventListener("click", e => { e.currentTarget.disabled = true; startBreak(e.currentTarget.dataset.shift); });
  $("#brk-end")?.addEventListener("click", e => { e.currentTarget.disabled = true; endBreak(); });
  $("#sod-edit")?.addEventListener("click", e => editSod(e.currentTarget.dataset.shift));
  $$("[data-sod-late]").forEach(b => b.onclick = () => sendSod(b.dataset.sodLate, true));
  $$("[data-eod]").forEach(b => b.onclick = () => eodForm(b.dataset.eod, !!b.dataset.sort));
  $$("[data-eodedit]").forEach(b => b.onclick = () => eodForm(b.dataset.eodedit, !!b.dataset.sort, true));
  $$("[data-addon]").forEach(c => c.onchange = async () => { const shift = S.shifts.find(s => s.id === c.dataset.shift); const set = new Set(shift.addons || []); c.checked ? set.add(c.dataset.addon) : set.delete(c.dataset.addon); const { error } = await sb.rpc("set_my_addons", { p_shift: shift.id, p_addons: [...set] }); if (error) { toast(error.message, "err"); c.checked = !c.checked; } else { shift.addons = [...set]; render(); } });
  $$("[data-plan]").forEach(i => i.onchange = async () => { const shift = S.shifts.find(s => s.id === i.dataset.shift); const plan = { ...(shift.plan || {}), [i.dataset.plan]: i.value }; const { error } = await sb.rpc("set_my_plan", { p_shift: shift.id, p_plan: plan }); if (error) toast(error.message, "err"); else { shift.plan = plan; toast("Saved", "ok"); } });
  $("#access-edit")?.addEventListener("click", editAccess);
  $("#pu-log")?.addEventListener("click", logPickup);
  $$("[data-done]").forEach(b => b.onclick = async () => { const undo = !!b.dataset.undo; b.disabled = true; const { error } = await sb.rpc(undo ? "task_undo" : "task_done", { p_shift: b.dataset.shift, p_addon: b.dataset.done }); if (error) { b.disabled = false; toast(error.message, "err"); } else { toast(undo ? "Done undone" : "Marked done ✓ · tap again to undo", "ok"); await loadAll(); render(); } });
  $$("[data-sc]").forEach(b => b.onclick = () => { S.scSel = S.scSel === b.dataset.sc ? null : b.dataset.sc; render(); setTimeout(() => $("#scores")?.scrollIntoView({ block: "nearest" }), 0); });
  $("#leave-new")?.addEventListener("click", leaveForm);
  $$("[data-cal]").forEach(b => b.onclick = () => { const [y, m] = (S.calMonth || today().slice(0, 7)).split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + +b.dataset.cal, 1)); S.calMonth = d.toISOString().slice(0, 7); render(); setTimeout(() => $("#cal")?.scrollIntoView({ block: "nearest" }), 0); });
  $$("[data-statv]").forEach(c => c.onclick = () => toast(c.dataset.statv, "ok"));
  $("#prof-edit")?.addEventListener("click", profileForm);
  $("#vchk-btn")?.addEventListener("click", vehicleCheckForm);
  bindDetail(app);
}
/* every tile, row and chip with a data-…v attribute opens the detail behind it */
function bindDetail(root) {
  const on = (sel, f) => root.querySelectorAll(sel).forEach(el => { if (el._bound) return; el._bound = true; el.addEventListener("click", e => { const inner = e.target.closest("button,input,select,textarea,a,summary,label"); if (inner && inner !== el && el.contains(inner)) return; e.stopPropagation(); f(el); }); });
  on("[data-postv]", el => postSheet(el.dataset.postv));
  on("[data-effv]", el => effDaySheet(el.dataset.effv));
  on("[data-accv]", el => { const [day, code] = el.dataset.accv.split("|"); accSheet(day, code); });
  on("[data-entryv]", el => { const e = S.entries.find(x => x.id === el.dataset.entryv); if (e) entrySheet(e); });
  on("[data-weekv]", el => weekSheet(el.dataset.weekv));
  on("[data-dayv]", el => daySheet(el.dataset.dayv));
  on("[data-vanv]", el => vanSheet(el.dataset.vanv));
  $$("[data-gotit-alert]").forEach(b => b.onclick = e => { e.stopPropagation(); b.disabled = true; gotItAlert(b.dataset.gotitAlert); });
  on("[data-alertv]", el => { const a = S.alerts.find(x => x.id === el.dataset.alertv); if (a) alertSheet(a); });
  on("[data-leavev]", el => { const l = S.leave.find(x => x.id === el.dataset.leavev); if (l) leaveSheet(l); });
  on("[data-msgv]", el => { const m = S.msgs.find(x => x.message_id === el.dataset.msgv); if (m) msgSheet(m); });
  on("[data-eodv]", el => eodForm(el.dataset.eodv, !!el.dataset.sort));
  on("[data-eodedit]", el => eodForm(el.dataset.eodedit, !!el.dataset.sort, true));
  on("[data-sodv]", el => sendSod(el.dataset.sodv, true));
}

/* ================= sheets ================= */
function sheet(html, onOpen, opts = {}) {
  const bg = h(`<div class="sheet-bg"><div class="sheet ${opts.wide ? "wide" : ""}" role="dialog" aria-modal="true" style="position:relative"><button class="x" aria-label="Close">×</button>${html}</div></div>`);
  const close = () => bg.remove(); bg.querySelector(".x").onclick = close; bg.addEventListener("click", e => { if (e.target === bg) close(); }); bg._close = close;
  document.body.appendChild(bg); onOpen?.(bg, close); bindDetail(bg); return { bg, close };
}
document.addEventListener("keydown", e => { if (e.key === "Escape") { const all = $$(".sheet-bg"); const top = all[all.length - 1]; if (top) (top._close || (() => top.remove()))(); } });
const opt = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("");

async function sendSod(shiftId, lateMode = false) {
  const shift = S.shifts.find(s => s.id === shiftId); const D = S.days[shift.day];
  const runs = D.segs.filter(x => !x.sort).map(x => x.shift.run); const van = D.segs.map(x => x.shift.van).find(Boolean) || null;
  const runId = runs.map(r => S.C.runCodes[r] || r).join(" + ");
  if (lateMode) { // late: ask for the actual start time
    sheet(`<h3>Post your SOD for ${label(shift.day)}</h3><p class="hint">This one is late, so it counts as late on your Admin score, but a late post is better than a missing one.</p>
      <label class="f">When did you start?<input class="in" type="time" id="st" value="${fmt24s(D.start)}"></label><label class="f">Van<select class="in" id="van">${opt([["", "—"], ...Object.keys(S.vans).map(p => [p, p])], van)}</select></label><label class="f">Note (optional)<input class="in" id="note" placeholder="e.g. forgot to post"></label><button class="btn" id="go">Send SOD</button>`, (bg, close) => {
      bg.querySelector("#go").onclick = async () => { const t = bg.querySelector("#st").value; const { error } = await sb.from("sod").insert({ shift_id: shiftId, driver: S.me.id, van: bg.querySelector("#van").value || null, run_id: runId, note: bg.querySelector("#note").value || null, sent_at: nzToIso(shift.day, t) }); if (error) return toast(error.message, "err"); close(); toast("SOD sent", "ok"); await loadAll(); render(); };
    }); return;
  }
  const { error } = await sb.from("sod").insert({ shift_id: shiftId, driver: S.me.id, van, run_id: runId }); if (error) return toast(error.message, "err");
  toast(`SOD sent ${fmtT(nzNow().min)} ✓`, "ok"); await loadAll(); render();
}
function fmt24s(min) { return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`; }
function editSod(shiftId) {
  const sod = S.sods.find(s => s.shift_id === shiftId);
  sheet(`<h3>Edit your SOD</h3><p class="hint">Sent ${fmtTs(sod.sent_at)}. You can change the van, start km and note until your EOD goes in. The time it was sent stays.</p>
    <label class="f">Van<select class="in" id="van">${opt([["", "—"], ...Object.keys(S.vans).map(p => [p, p])], sod.van || "")}</select></label><label class="f">Start km (optional)<input class="in" id="km" inputmode="numeric" value="${sod.start_km ?? ""}"></label><label class="f">Note<input class="in" id="note" value="${esc(sod.note || "")}"></label><button class="btn" id="go">Save</button>`, (bg, close) => {
    bg.querySelector("#go").onclick = async () => { const { error } = await sb.from("sod").update({ van: bg.querySelector("#van").value || null, start_km: +bg.querySelector("#km").value || null, note: bg.querySelector("#note").value || null, edited_at: new Date().toISOString() }).eq("shift_id", shiftId); if (error) return toast(error.message, "err"); close(); toast("SOD updated", "ok"); await loadAll(); render(); };
  });
}
function eodForm(shiftId, sortOnly, edit = false) {
  const shift = S.shifts.find(s => s.id === shiftId); const code = shift.run; const net = NET(code); const n = nzNow();
  const ex = edit ? S.eods.find(e => e.shift_id === shiftId) : null;   // editing the EOD already sent (same day or the day after)
  const v = k => ex && ex[k] != null ? String(ex[k]) : "";
  const yn = id => `<select class="in" id="${id}"><option value="">Pick…</option><option value="true" ${v(id) === "true" ? "selected" : ""}>Yes</option><option value="false" ${v(id) === "false" ? "selected" : ""}>No</option></select>`;
  const legs = LEG_RUNS[code] || []; const newsRun = (S.C.news.runs || []).includes(code); const legOn = l => ex ? (ex.legs || []).includes(l) : (shift.addons || []).includes(l);
  let fields = `<label class="f full">Finish time<input class="in" type="time" id="finish" value="${ex?.finish_time ? ex.finish_time.slice(0, 5) : fmt24s(n.min)}" required></label>`;
  if (!sortOnly && !isSort(code)) {
    if (net === "tge") fields += `<label class="f">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 90" value="${v("sort_min")}"></label><label class="f">Delivery total<input class="in" id="parcels" inputmode="numeric" required value="${v("parcels")}"></label><label class="f">Jobs (stops)<input class="in" id="stops" inputmode="numeric" required value="${v("stops")}"></label><label class="f">Pick-up stops<input class="in" id="pickups" inputmode="numeric" value="${v("pickups")}"></label><label class="f">Pick-up parcels<input class="in" id="pickup_parcels" inputmode="numeric" value="${v("pickup_parcels")}"></label><label class="f">Next cycled<input class="in" id="cycled" inputmode="numeric" value="${v("cycled")}"></label>`;
    else if (net === "fb") fields += `<label class="f">Total parcels<input class="in" id="parcels" inputmode="numeric" required value="${v("parcels")}"></label><label class="f">Stops<input class="in" id="stops" inputmode="numeric" required value="${v("stops")}"></label>`;
    else fields += `<label class="f">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 90" value="${v("sort_min")}"></label><label class="f">Total parcels<input class="in" id="parcels" inputmode="numeric" required value="${v("parcels")}"></label><label class="f">Stops<input class="in" id="stops" inputmode="numeric" required value="${v("stops")}"></label><label class="f">Mail trays<input class="in" id="trays" inputmode="decimal" placeholder="e.g. 1 or 0.5" value="${v("trays")}"></label><label class="f">Sorted parcels?${yn("sorted_parcels")}</label><label class="f">Sorted mail?${yn("sorted_mail")}</label>${PICKUP_RUNS.includes(code) ? `<label class="f">NZC / PH pick-up?${yn("nzc_ph")}</label>` : ""}<label class="f">Next cycled<input class="in" id="cycled" inputmode="numeric" value="${v("cycled")}"></label>`;
    if (legs.length) fields += `<div class="full"><div class="meta mono" style="margin-bottom:6px">ADD-ON LEGS YOU DID</div><div class="row">${legs.map(l => `<label class="chk ${legOn(l) ? "on" : ""}"><input type="checkbox" name="leg" value="${l}" ${legOn(l) ? "checked" : ""}>${esc(addName(l))}</label>`).join("")}</div></div>`;
    if (newsRun) fields += `<label class="chk full ${ex?.newspapers ? "on" : ""}"><input type="checkbox" id="news" ${ex?.newspapers ? "checked" : ""}>Newspapers done today (once a week, ${S.C.news.min} min allowed)</label>`;
  } else fields += `<label class="f full">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 100" value="${v("sort_min")}"></label>`;
  fields += `<label class="f full">Note (optional)<input class="in" id="note" placeholder="anything Jeremy should know" value="${esc(ex?.note || "")}"></label>`;
  sheet(`<h3>${ex ? "Edit EOD" : "EOD"} · ${esc(sortOnly || isSort(code) ? (S.runsBy[code]?.label || "Sort") : code)}</h3><p class="hint">${label(shift.day)}${shift.van ? ` · ${esc(shift.van)}` : ""}. ${ex ? `Sent ${fmtTime(ex.sent_at)}${ex.edited_at ? `, last edited ${fmtTime(ex.edited_at)}` : ""}. Change what's wrong and save — Jeremy sees it was edited.` : "Fill in every box that applies."}</p><form class="frm" id="ef">${fields}<button class="btn full" type="submit">${ex ? "Save changes" : "Send EOD"}</button></form>`, (bg, close) => {
    bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
    bg.querySelector("#ef").onsubmit = async e => { e.preventDefault(); const g = id => bg.querySelector("#" + id); const num = id => g(id) && g(id).value !== "" ? +g(id).value : null; const bool = id => g(id) && g(id).value !== "" ? g(id).value === "true" : null;
      const row = { finish_time: g("finish").value, sort_min: num("sort_min"), parcels: num("parcels"), stops: num("stops"), trays: num("trays"), pickups: num("pickups"), pickup_parcels: num("pickup_parcels"), cycled: num("cycled"), sorted_parcels: bool("sorted_parcels"), sorted_mail: bool("sorted_mail"), nzc_ph: bool("nzc_ph"), legs: [...bg.querySelectorAll("input[name=leg]:checked")].map(i => i.value), newspapers: !!g("news")?.checked, note: g("note").value || null, run_id: S.C.runCodes[code] || null };
      if (ex) { const { error } = await sb.from("eod").update(row).eq("shift_id", shiftId); if (error) return toast(error.message.includes("row-level") ? "Too late to edit this one — ask Jeremy" : error.message, "err"); close(); toast("EOD updated ✓", "ok"); await loadAll(); render(); return; }
      Object.assign(row, { shift_id: shiftId, driver: S.me.id }); if (shift.day !== n.date) row.sent_at = nzToIso(shift.day, g("finish").value);
      const { error } = await sb.from("eod").insert(row); if (error) return toast(error.message, "err"); close(); toast("EOD sent ✓ Thanks!", "ok"); await loadAll(); render(); };
  });
}
function leaveForm() {
  const t = today();
  sheet(`<h3>Leave request</h3><p class="hint">Within a minute you'll get an email confirming it's been received. Nothing is approved until Jeremy reviews it; you'll get a second email saying yes or no.</p>
    <form class="frm" id="lf"><label class="f full">Type of leave<select class="in" id="type">${opt(Object.entries(LEAVE_T), "annual")}</select></label><label class="f">First day off<input class="in" type="date" id="from" min="${t}" required></label><label class="f">Last day off<input class="in" type="date" id="to" min="${t}" required></label>
    <div class="full"><div class="meta mono" style="margin-bottom:6px">HOW MUCH OF THE DAY</div><div class="seg-btns" id="part"><button type="button" data-p="full" class="on">Full day</button><button type="button" data-p="AM">Morning off</button><button type="button" data-p="PM">Afternoon off</button></div></div>
    <label class="f full">Note for Jeremy (optional)<textarea class="in" id="notes" rows="3" placeholder="e.g. Family wedding in Christchurch. Happy to swap Saturday."></textarea></label><button class="btn full" type="submit">Send request</button></form>`, (bg, close) => {
    let part = "full"; bg.querySelectorAll("#part button").forEach(b => b.onclick = () => { part = b.dataset.p; bg.querySelectorAll("#part button").forEach(x => x.classList.toggle("on", x === b)); if (part !== "full") bg.querySelector("#to").value = bg.querySelector("#from").value; });
    bg.querySelector("#from").onchange = e => { if (!bg.querySelector("#to").value || bg.querySelector("#to").value < e.target.value) bg.querySelector("#to").value = e.target.value; };
    bg.querySelector("#lf").onsubmit = async e => { e.preventDefault(); const f = bg.querySelector("#from").value, to = bg.querySelector("#to").value; if (to < f) return toast("Last day can't be before the first", "err");
      const { error } = await sb.from("leave_requests").insert({ driver: S.me.id, type: bg.querySelector("#type").value, date_from: f, date_to: part === "full" ? to : f, part, notes: bg.querySelector("#notes").value || null }); if (error) return toast(error.message, "err"); close(); toast("Request sent. Check your email.", "ok"); await loadAll(); render(); };
  });
}
function profileForm() {
  const p = S.me; const forOther = S.viewAs && S.viewer?.can?.("people");
  if (S.viewAs && !forOther) return toast(`Only ${first(S.viewAs.name)} (or Jeremy) can change these`, "err");
  sheet(`<h3>${forOther ? `Update ${esc(first(p.name))}'s details` : "Update my details"}</h3><form class="frm" id="pf"><label class="f full">Phone<input class="in" id="phone" type="tel" value="${esc(p.phone || "")}"></label><label class="f">Licence class<input class="in" id="lc" value="${esc(p.licence_class || "")}" placeholder="e.g. Class 1 full"></label><label class="f">Licence expires<input class="in" type="date" id="le" value="${p.licence_expiry || ""}"></label><label class="f full">DG endorsement expires<input class="in" type="date" id="dg" value="${p.dg_expiry || ""}"></label><button class="btn full" type="submit">Save</button></form><p class="hint">Email changes go through Jeremy, because it's how you sign in.</p>`, (bg, close) => {
    bg.querySelector("#pf").onsubmit = async e => { e.preventDefault(); const v = { phone: bg.querySelector("#phone").value || null, licence_class: bg.querySelector("#lc").value || null, licence_expiry: bg.querySelector("#le").value || null, dg_expiry: bg.querySelector("#dg").value || null };
      const { error } = forOther ? await sb.from("people").update(v).eq("id", p.id) : await sb.rpc("update_my_profile", { p_phone: v.phone, p_lic_class: v.licence_class, p_lic_exp: v.licence_expiry, p_dg_exp: v.dg_expiry });
      if (error) return toast(error.message, "err"); close(); toast("Saved", "ok"); if (forOther) Object.assign(S.me, v); else S.me = await me(); render(); };
  });
}
function vehicleCheckForm() {
  const n = nzNow(); const T = S.days[n.date]; const plates = [...new Set([...(T ? T.segs.map(x => x.shift.van) : []), ...S.shifts.filter(s => s.day <= n.date).sort((a, b) => b.day.localeCompare(a.day)).map(s => s.van)].filter(Boolean))];
  sheet(`<h3>Weekly vehicle check</h3><p class="hint">Due Thursday by 5pm. Four photos: exterior, cab, oil dipstick, coolant level.</p>
    <form class="frm" id="vf"><label class="f full">Van<select class="in" id="van">${opt([...plates, ...Object.keys(S.vans).filter(p => !plates.includes(p) && p !== "OTHER")].map(p => [p, p]), plates[0])}</select></label>
    <label class="f">Odometer (km)<input class="in" id="odo" inputmode="numeric" required></label><label class="f">RUCs left (km)<input class="in" id="ruc" inputmode="numeric" placeholder="blank if petrol"></label>
    <label class="chk"><input type="checkbox" id="washed">Van washed</label><label class="chk"><input type="checkbox" id="tyres">Tyres checked &amp; OK</label><label class="chk"><input type="checkbox" id="vault">Vault OK</label>
    <label class="f">Bodywork<input class="in" id="body" placeholder="OK / describe damage"></label><label class="f full">Service due<input class="in" id="service" placeholder="e.g. 230,000 km or 15 Nov"></label>
    <label class="f full">Photos (4)<input class="in" type="file" id="photos" accept="image/*" multiple capture="environment"></label><label class="f full">Notes<textarea class="in" id="notes" rows="2"></textarea></label><button class="btn full" type="submit">Send check</button></form>`, (bg, close) => {
    bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
    bg.querySelector("#vf").onsubmit = async e => { e.preventDefault(); const b = bg.querySelector("button[type=submit]"); b.disabled = true; b.textContent = "Uploading…";
      try { const g = id => bg.querySelector("#" + id); const files = [...g("photos").files]; const van = g("van").value; const wk = monOf(n.date); const paths = [];
        for (const [i, f] of files.entries()) { const path = `${van}/${wk}/${S.me.id}-${i + 1}-${Date.now()}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`; const { error } = await sb.storage.from("vchk").upload(path, f, { upsert: true }); if (error) throw error; paths.push(path); }
        const { error } = await sb.from("vehicle_checks").upsert({ van, driver: S.me.id, week_start: wk, odometer: +g("odo").value || null, rucs_left: g("ruc").value ? +g("ruc").value : null, washed: g("washed").checked, tyres_ok: g("tyres").checked, vault_ok: g("vault").checked, bodywork: g("body").value || null, service_due: g("service").value || null, notes: g("notes").value || null, photos: paths, at: new Date().toISOString() }, { onConflict: "van,week_start" }); if (error) throw error;
        close(); toast("Vehicle check sent ✓", "ok"); } catch (err) { toast(err.message, "err"); b.disabled = false; b.textContent = "Send check"; } };
  });
}

/* ================= detail sheets: what's behind each row and score ================= */
const rawRow = row => row ? `<pre class="msg">${esc(Object.entries(row).filter(([k, v]) => v != null && v !== "" && !["shift_id", "driver", "id", "extra"].includes(k) && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${({ sent_at: "sent", finish_time: "finish time", sort_min: "sorting (min)", parcels: "parcels / delivery total", stops: "stops / jobs", trays: "mail trays", pickups: "pick-up stops", pickup_parcels: "pick-up parcels", cycled: "next cycled", sorted_parcels: "sorted parcels", sorted_mail: "sorted mail", nzc_ph: "NZC/PH pick-up", legs: "legs done", newspapers: "newspapers done", run_id: "run ID", start_km: "start km", edited_at: "edited", van: "van", note: "note" })[k] || k}: ${Array.isArray(v) ? v.map(addName).join(", ") : /_at$/.test(k) ? fmtTs(v) : typeof v === "boolean" ? (v ? "Yes" : "No") : v}`).join("\n"))}</pre>` : "";
function itemByKey(key) { const [day] = key.split("|"); return (S.sc?.items || []).find(i => i.key === key) || scoreAt(day, day).items.find(i => i.key === key); }
function postSheet(key) {
  const it = itemByKey(key); if (!it) return toast("That post isn't in your range any more", "err"); const R = S.C.rules; const t = today();
  const due = fmtT(it.due % 1440); const canPost = !it.row && it.day <= t && !S.viewAs;
  sheet(`<h3>${esc(it.label)} · ${label(it.day, true)}</h3><p class="meta">Due by ${due}${it.kind === "SOD" ? ` (rostered start + ${R.sodGrace} min)` : ` (${R.eodHours} h after the run finishes)`}</p>
    <div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile"><div class="l">Result</div><div class="v" style="font-size:18px">${pill(STATE_LABEL[it.st], it.st === "ok" ? "ok" : it.st === "miss" ? "crit" : ["due", "over", "exc"].includes(it.st) ? "grey" : "warn")}</div><div class="s">${it.st === "ok" ? "no points off" : it.st === "late" || it.st === "miss" ? `−${R.perEvent}% Admin` : it.st === "exc" ? "excused — doesn't count" : "not closed yet"}</div></div><div class="tile"><div class="l">Posted</div><div class="v" style="font-size:18px">${it.at != null ? fmtT(it.at % 1440) : "—"}</div><div class="s">${it.late > 0 ? `late by ${Math.floor(it.late / 60) ? Math.floor(it.late / 60) + " h " : ""}${it.late % 60} min` : it.at != null ? "on time" : it.st === "due" ? "not due yet" : "not posted"}</div></div></div>
    ${it.mark?.status ? `<p class="meta">Set by Jeremy: <b>${esc(STATE_LABEL[it.mark.status])}</b>${it.mark.note ? ` — ${esc(it.mark.note)}` : ""}</p>` : it.mark?.note ? `<p class="meta">Note from Jeremy: ${esc(it.mark.note)}</p>` : ""}
    ${it.row ? `<h4>What you sent</h4>${rawRow(it.row)}` : `<p class="meta">Nothing was posted for this.</p>`}
    ${canPost ? `<button class="btn ${it.kind === "SOD" ? "" : "accent"}" ${it.kind === "SOD" ? `data-sodv="${it.shift.id}"` : `data-eodv="${it.shift.id}" ${it.code ? "" : 'data-sort="1"'}`}>Post it now</button><p class="hint">It'll count as late, but late beats missing.</p>` : ""}
    <div class="row"><button class="btn ghost sm" data-dayv="${it.day}">The whole day</button></div>`);
}
function effDaySheet(day) {
  const s = (S.sc && day >= S.F.from && day <= S.F.to) ? S.sc : scoreAt(day, day); const e = s.effDays.find(x => x.day === day); const R = S.C.rules;
  if (!e) return sheet(`<h3>Efficiency · ${label(day, true)}</h3><p class="meta">No run scored on this day${day < R.effStart ? ` (efficiency counts from ${label(R.effStart)})` : ""}.</p><div class="row"><button class="btn ghost sm" data-dayv="${day}">The whole day</button></div>`);
  const src = (r, k) => r.ov?.[k] != null ? `<span class="c-accent">corrected by Jeremy</span>` : r.eod?.[k] != null ? "you posted" : r.guess.includes(k) ? `<span class="c-warn">${r.evid ? "average of past EODs" : "best guess"}</span>` : "";
  const runs = (e.rows || []).map(r => `<div class="item"><div class="row" style="justify-content:space-between"><b>${esc(r.code)} <span class="meta">${esc(runName(r.code))}</span></b><span style="flex:0;white-space:nowrap">${r.trainDay ? pill("training day", "warn") : r.need.length ? pill("needs " + r.need.join(", "), "warn") : r.perf == null ? pill("—", "warn") : `<b class="c-${col(Math.min(100, r.perf))}">${Math.round(r.perf)}%</b>`}</span></div>
      <div class="meta">Expected ${(r.allowed / 60).toFixed(1)} h · actual ${r.taken ? r.taken.toFixed(1) + " h" : "—"} (${r.start != null ? fmtT(r.start) : "?"} → ${r.end != null ? fmtT(r.end) : "?"})${r.ov?.train_min ? ` · ${r.ov.train_min} min training left out` : ""}</div>
      <div class="scroll"><table class="dt"><tr><th>Part</th><th>Calculation</th><th>Min</th></tr>${r.parts.map(p => `<tr><td>${esc(p[0])}</td><td class="meta">${esc(p[1])}</td><td class="num">${p[2]}</td></tr>`).join("")}<tr><td><b>Expected</b></td><td></td><td class="num"><b>${Math.round(r.allowed)}</b></td></tr></table></div>
      <div class="meta">Figures: ${["parcels", "stops", "trays", "sort_min", "pickups", "pickup_parcels"].filter(k => (r.ov?.[k] ?? r.eod?.[k]) != null || r.guess.includes(k)).map(k => `${({ parcels: r.net === "tge" ? "delivery total" : "parcels", stops: r.net === "tge" ? "jobs" : "stops", trays: "trays", sort_min: "sorting min", pickups: "pick-up stops", pickup_parcels: "pick-up parcels" })[k]} ${r.ov?.[k] ?? r.eod?.[k] ?? (r.figs?.[k === "pickup_parcels" ? "pup" : k]?.v ?? "?")} (${src(r, k)})`).join(" · ") || "none yet"}</div>
      ${!r.eod && day <= today() && !S.viewAs ? `<button class="btn accent sm" data-eodv="${r.shift.id}">Post the EOD for ${esc(r.code)}</button>` : ""}</div>`).join("");
  sheet(`<h3>Efficiency · ${label(day, true)}</h3><p class="meta">${e.pending ? `<span class="c-warn">Waiting on: ${esc(e.need || "EOD")}</span>` : e.manual ? `Set by Jeremy at ${Math.round(e.v)}% for the day` : `${e.taken.toFixed(1)} h actual vs ${e.est ? "≈" : ""}${e.allowed.toFixed(1)} h expected → <b class="c-${col(Math.min(100, e.v))}">${Math.round(e.v)}%</b>${e.est ? " (a best guess filled a missing figure)" : ""}`}</p>
    <p class="hint">${R.effMethod === "tdt" ? "Score = (2 − actual ÷ expected) × 100." : "Score = expected ÷ actual."} Expected = base time + per parcel + per stop + sorting + pick-ups + legs, from the run formula.</p>${runs}
    <div class="row"><button class="btn ghost sm" data-dayv="${day}">The whole day</button></div>`, null, { wide: true });
}
function accSheet(day, code) {
  const s = scoreAt(day, day); const a = s.accDays.find(x => x.day === day && x.code === code); const fc = S.C.runCodes[code]; const mist = S.entries.filter(e => e.kind === "mistake" && e.day === day && e.show_driver);
  sheet(`<h3>Accuracy · ${esc(code)} · ${label(day, true)}</h3><p class="meta">${esc(runName(code))}${fc ? ` · NZ Post run ${esc(fc)}` : ""}</p>
    ${a ? `<div class="tiles" style="grid-template-columns:1fr 1fr 1fr"><div class="tile"><div class="l">Items</div><div class="v">${a.items}</div></div><div class="tile"><div class="l">Scanned right</div><div class="v">${a.compliant}</div></div><div class="tile"><div class="l">Compliance</div><div class="v c-${col(a.v)}">${a.v == null ? "—" : a.v.toFixed(1) + "%"}</div></div></div><p class="hint">From NZ Post's daily contract-owner report for this run: items scanned correctly ÷ items for delivery. ${a.read_at ? `Report read ${fmtTs(a.read_at)}.` : ""}</p>` : `<p class="meta">No NZ Post report figures for this run on this day.</p>`}
    ${mist.length ? `<h4>Mistakes recorded this day</h4><div class="list">${mist.map(m => `<div class="item crit clk" data-entryv="${m.id}">${esc(m.title)}</div>`).join("")}</div>` : ""}
    <div class="row"><button class="btn ghost sm" data-dayv="${day}">The whole day</button></div>`);
}
function entrySheet(e) {
  const K = { praise: "Nice work 👏", issue: "Heads up", note: "Note from Jeremy", mistake: "Mistake recorded", adjust: "Admin points", safety: "Safety", eff: "Efficiency set" };
  sheet(`<h3>${K[e.kind] || e.kind}</h3><p class="meta">${label(e.day, true)}${e.run ? ` · ${esc(e.run)}` : ""} · ${fmtTs(e.created_at)}</p><p><b>${esc(e.title)}</b></p>${e.note ? `<p>${esc(e.note)}</p>` : ""}
    <dl class="kv">${e.kind === "mistake" && !e.excused ? `<dt>Effect</dt><dd>−${e.pct_off ?? S.C.rules.mistakePct}% Accuracy for the week and month it falls in</dd>` : ""}${e.excused ? `<dt>Status</dt><dd>${pill("removed — doesn't count", "grey")}</dd>` : ""}${e.admin_pts ? `<dt>Admin</dt><dd>${e.admin_pts > 0 ? "+" : ""}${e.admin_pts} points</dd>` : ""}${e.safety_pct != null ? `<dt>Safety</dt><dd>${e.safety_pct}%</dd>` : ""}${e.eff_pct != null ? `<dt>Efficiency</dt><dd>${e.eff_pct}% for that day</dd>` : ""}</dl>
    ${e.review_requested_at ? `<p class="meta">Review requested ${fmtTs(e.review_requested_at)}${e.review_note ? ` — "${esc(e.review_note)}"` : ""}${e.excused ? " · removed after review" : e.review_resolved_at ? ` · reviewed ${fmtTs(e.review_resolved_at)}, the note stands` : " · waiting for Jeremy"}</p>` : ""}
    <div class="row">${e.show_driver && !e.excused && !(e.review_requested_at && !e.review_resolved_at) && !S.viewAs ? `<button class="btn" data-review="${e.id}">Request a review</button>` : e.review_requested_at && !e.review_resolved_at ? `<span class="pill warn">review requested · waiting for Jeremy</span>` : ""}</div><p class="hint">Think it's wrong? Request a review and Jeremy will look at it.</p>`, (bg, close) => { bg.querySelector("[data-review]")?.addEventListener("click", () => { close(); reviewSheet(e.id); }); });
}
function weekSheet(w) {
  const s = scoreAt(w, addDays(w, 6)); const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
  const tile = (l, v, sub = "") => `<div class="tile"><div class="l">${l}</div><div class="v c-${col(v)}">${pct(v)}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
  sheet(`<h3>Week of ${label(w, true)}</h3><p class="meta">${s.onTime}/${s.closed} posts on time · ${Object.values(s.days).reduce((a, x) => a + x.hours, 0).toFixed(1)} h rostered</p>
    <div class="tiles" style="grid-template-columns:1fr 1fr"><button class="tile" data-weekv="${addDays(w, -7)}" style="cursor:pointer"><div class="l">‹ week before</div><div class="s">${label(addDays(w, -7))}</div></button><button class="tile" data-weekv="${addDays(w, 7)}" style="cursor:pointer"><div class="l">week after ›</div><div class="s">${label(addDays(w, 7))}</div></button></div>
    <div class="tiles" style="grid-template-columns:1fr 1fr">${tile("Admin", s.admin, `${s.late} late · ${s.missing} missing`)}${tile("Efficiency", s.eff, `${s.effDays.filter(e => !e.pending).length} days scored`)}${tile("Accuracy", s.acc, s.feedPct != null ? `${s.accComp}/${s.accItems} compliant` : "no feed figures")}${tile("Overall", s.overall)}</div>
    <div class="scroll"><table class="dt"><tr><th>Day</th><th>Runs</th><th>Posts</th><th>Eff</th></tr>${days.map(d => { const D = s.days[d]; const e = s.effDays.find(x => x.day === d); return `<tr class="${D ? "clk" : ""}" ${D ? `data-dayv="${d}"` : ""}><td>${label(d).slice(0, 6)}</td><td class="meta">${D ? D.segs.map(x => x.sort ? (S.runsBy[x.shift.run]?.label || "Sort") : x.shift.run).join(" · ") : "off"}</td><td><span class="row" style="gap:3px">${s.items.filter(i => i.day === d).map(i => `<button class="chip ${i.st}" data-postv="${esc(i.key)}">${esc(i.label)}</button>`).join("")}</span></td><td>${e ? (e.pending ? `<span class="c-warn">waiting</span>` : `<b class="c-${col(Math.min(100, e.v))}">${Math.round(e.v)}%</b>`) : ""}</td></tr>`; }).join("")}</table></div>
    ${s.entries.filter(e => e.show_driver).length ? `<h4>From Jeremy that week</h4><div class="list">${s.entries.filter(e => e.show_driver).map(e => `<div class="item clk ${e.excused ? "done" : e.kind === "mistake" ? "crit" : e.kind === "praise" ? "ok" : ""}" data-entryv="${e.id}">${label(e.day)} · ${esc(e.title)}</div>`).join("")}</div>` : ""}<p class="hint">Tap a day or a post for the detail.</p>`, null, { wide: true });
}
function daySheet(day) {
  const n = nzNow(); const D = S.days[day]; const hol = S.C.holidays[day]; const isT = day === n.date; const past = day <= n.date;
  const s = past && D ? scoreAt(day, day) : null; const e = s?.effDays.find(x => x.day === day);
  const ackBy = Object.fromEntries(S.acks.map(a => [a.item_id, a])); const ch = S.changes.filter(i => i.day === day); const ents = S.entries.filter(x => x.day === day && x.show_driver); const lv = S.leave.filter(l => l.status === "approved" && day >= l.date_from && day <= l.date_to);
  const segs = D ? D.segs.map(x => { const code = x.shift.run; const r = S.runsBy[code]; const win = x.sort ? "" : timingRows(x, day, isT ? n.min : null);
    return `<div class="seg"><div class="tm">${fmtT(x.st)} – ${fmtT(x.en)}</div><div class="rn">${x.sort ? esc(r?.label || "Sort") : `${esc(code)}<span class="sub">${esc(runName(code))}</span>`}<div class="tags">${x.shift.van ? `<button class="tag van" data-vanv="${esc(x.shift.van)}" style="border:0;cursor:pointer">${esc(x.shift.van)}</button>` : ""}${x.shift.trainee ? `<span class="tag tr">training ${esc(first(S.people[x.shift.trainee]?.name || ""))}</span>` : ""}${(x.shift.addons || []).map(a => `<span class="tag">+ ${esc(S.addons.find(z => z.id === a)?.name || addName(a))}${x.shift.done?.[a] ? ` ✓ ${fmtTime(x.shift.done[a])}` : x.shift.plan?.[a] ? ` ~${fmtT(toMin(x.shift.plan[a]))}` : ""}</span>`).join("")}</div>${x.shift.note ? `<div class="meta">${esc(x.shift.note)}</div>` : ""}${win}
      ${past ? (x.sort ? (x.eod ? `<div class="meta c-ok">✓ sort finished ${fmtTime(x.eod.sent_at)}</div>` : "") : x.eod ? `<div class="meta c-ok">✓ EOD ${fmtTime(x.eod.sent_at)}${x.eod.finish_time ? ` · finished ${fmtT(toMin(x.eod.finish_time))}` : ""}${x.eod.parcels != null ? ` · ${x.eod.parcels} ${NET(code) === "tge" ? "deliveries" : "parcels"}` : ""}${x.eod.stops != null ? ` · ${x.eod.stops} ${NET(code) === "tge" ? "jobs" : "stops"}` : ""}${x.eod.edited_at ? " · edited" : ""}</div>${rawRow(x.eod)}${canEditEod(day) ? `<button class="btn ghost sm" data-eodedit="${x.shift.id}" data-sort="${x.sort ? 1 : ""}">Edit EOD</button>` : ""}` : `<div class="meta c-crit">No EOD for this run</div>${!S.viewAs ? `<button class="btn accent sm" data-eodv="${x.shift.id}">Post it now</button>` : ""}`) : ""}</div></div>`; }).join("") : "";
  const sodSeg = D?.segs.find(x => x.sod);
  sheet(`<h3>${label(day, true)}${isT ? " · today" : ""}</h3><p class="meta">${hol ? `${esc(hol.name)} · ` : ""}${D ? `${fmtT(D.start)} – ${fmtT(D.end)} · ${D.hours} h rostered` : lv.length ? "On leave" : "Day off"}${e && !e.pending ? ` · efficiency <b class="c-${col(Math.min(100, e.v))}">${Math.round(e.v)}%</b>` : ""}</p>
    ${D ? `<div class="row"><button class="btn ghost sm" data-dayv="${addDays(day, -1)}">‹ ${label(addDays(day, -1)).slice(0, 6)}</button>${past ? `<button class="btn ghost sm" data-effv="${day}">Efficiency working</button>` : ""}<button class="btn ghost sm" data-weekv="${monOf(day)}">Whole week</button><button class="btn ghost sm" data-dayv="${addDays(day, 1)}">${label(addDays(day, 1)).slice(0, 6)} ›</button></div>` : `<div class="row"><button class="btn ghost sm" data-dayv="${addDays(day, -1)}">‹ ${label(addDays(day, -1)).slice(0, 6)}</button><button class="btn ghost sm" data-dayv="${addDays(day, 1)}">${label(addDays(day, 1)).slice(0, 6)} ›</button></div>`}
    ${past && D ? `<h4>Start of day</h4>${sodSeg ? `<div class="meta c-ok">✓ SOD ${fmtTime(sodSeg.sod.sent_at)}${sodSeg.sod.van ? ` · ${esc(sodSeg.sod.van)}` : ""}${sodSeg.sod.edited_at ? " · edited" : ""}</div>${sodSeg.sod.note ? `<div class="meta">${esc(sodSeg.sod.note)}</div>` : ""}` : `<div class="meta c-crit">No SOD posted</div>${!S.viewAs ? `<button class="btn sm" data-sodv="${D.segs[0].shift.id}">Post it now</button>` : ""}`}` : ""}
    ${D ? `<h4>Shifts</h4>${segs}` : ""}
    ${s && s.items.length ? `<h4>How the posts scored</h4><div class="row" style="gap:3px">${s.items.map(i => `<button class="chip ${i.st}" data-postv="${esc(i.key)}">${esc(i.label)} ${esc(itemNote(i).replace(/^posted /, ""))}</button>`).join("")}</div>` : ""}
    ${s && s.accDays.length ? `<h4>Accuracy</h4><div class="row" style="gap:3px">${s.accDays.map(a => `<button class="chip ${col(a.v) === "ok" ? "ok" : col(a.v) === "grey" ? "due" : "late"}" data-accv="${a.day}|${esc(a.code)}">${esc(a.code)} ${a.v == null ? "—" : a.v.toFixed(0) + "%"}</button>`).join("")}</div>` : ""}
    ${ch.length ? `<h4>Roster changes for this day</h4><div class="list">${ch.map(i => `<div class="item"><div>${esc(i.summary)}</div><div class="meta">sent ${fmtTs(i.roster_changes.sent_at)} · ${ackBy[i.id]?.confirmed_at ? `✓ confirmed ${fmtTs(ackBy[i.id].confirmed_at)}` : ackBy[i.id]?.dismissed_at ? "✓ cleared" : "not confirmed yet"}</div></div>`).join("")}</div>` : ""}
    ${ents.length ? `<h4>From Jeremy</h4><div class="list">${ents.map(x => `<div class="item clk ${x.excused ? "done" : x.kind === "mistake" ? "crit" : x.kind === "praise" ? "ok" : ""}" data-entryv="${x.id}">${esc(x.title)}</div>`).join("")}</div>` : ""}
    ${lv.length ? `<h4>Leave</h4><div class="list">${lv.map(l => `<div class="item ok clk" data-leavev="${l.id}">${esc(LEAVE_T[l.type] || l.type)} · approved</div>`).join("")}</div>` : ""}`, null, { wide: true });
}
function vanSheet(plate) {
  const v = S.vans[plate] || {}; const t = today(); const mine = S.vchk.filter(c => c.van === plate); const use = S.shifts.filter(s => s.van === plate).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14);
  const dd = d => d ? Math.round((new Date(d) - new Date(t)) / 86400000) : null; const st = d => { const n = dd(d); return n == null ? pill("not on file", "grey") : n < 0 ? pill("overdue", "crit") : n <= 14 ? pill(`due in ${n}d`, "warn") : pill("✓", "ok"); };
  const left = !v.no_ruc && v.ruc_paid_to && v.odometer ? v.ruc_paid_to - v.odometer : null;
  sheet(`<h3><span class="plate">${esc(plate)}</span> ${esc(v.model || "")}</h3><p class="meta">${esc([v.make, v.colour].filter(Boolean).join(" · "))}</p>
    <dl class="kv"><dt>WOF</dt><dd>${v.wof_due ? label(v.wof_due, true) + " " : ""}${v.wof_failed ? pill("failed", "crit") : st(v.wof_due)}</dd><dt>Rego</dt><dd>${v.rego_due ? label(v.rego_due, true) + " " : ""}${st(v.rego_due)}</dd><dt>RUCs</dt><dd>${v.no_ruc ? "not needed (petrol)" : v.ruc_paid_to ? `paid to ${v.ruc_paid_to.toLocaleString()} km${left != null ? ` · ${left.toLocaleString()} km left ${left <= 0 ? pill("overdue", "crit") : left <= (S.C.rules.rucSoonKm || 1000) ? pill("low", "warn") : pill("✓", "ok")}` : ""}` : pill("not on file", "grey")}</dd><dt>Odometer</dt><dd>${v.odometer ? `${v.odometer.toLocaleString()} km` : "—"}${v.odometer_at ? ` <span class="meta">(${label(v.odometer_at)})</span>` : ""}</dd></dl>
    ${!S.viewAs ? `<button class="btn ghost" id="vchk-go">🚐 Do the weekly vehicle check</button>` : ""}
    <h4>Your checks on this van</h4>${mine.length ? `<div class="scroll"><table class="dt"><tr><th>Week of</th><th>Sent</th><th>Odometer</th><th>RUCs left</th><th>Notes</th></tr>${mine.map(c => `<tr><td>${label(c.week_start)}</td><td class="mono">${fmtTs(c.at)}</td><td class="num">${c.odometer?.toLocaleString() || "—"}</td><td class="num">${c.rucs_left?.toLocaleString() || "—"}</td><td class="meta">${esc([c.washed ? "washed" : "not washed", c.tyres_ok ? "" : "tyres", c.vault_ok ? "" : "vault", c.bodywork, c.notes].filter(Boolean).join(" · "))}</td></tr>`).join("")}</table></div>` : `<p class="meta">None yet.</p>`}
    <h4>Your shifts with it</h4><div class="scroll"><table class="dt"><tr><th>Day</th><th>Run</th><th>Times</th></tr>${use.map(s => { const D = S.days[s.day]; const x = D?.segs.find(y => y.shift.id === s.id); return `<tr class="clk" data-dayv="${s.day}"><td>${label(s.day)}</td><td>${esc(s.run)}</td><td class="mono">${x ? `${fmtT(x.st)}–${fmtT(x.en)}` : ""}</td></tr>`; }).join("") || `<tr><td colspan="3" class="meta">—</td></tr>`}</table></div><p class="hint">Low or overdue? Tell Stu.</p>`,
    (bg, close) => { bg.querySelector("#vchk-go")?.addEventListener("click", () => { close(); vehicleCheckForm(); }); }, { wide: true });
}
function alertSheet(a) {
  const sh = a.shift_id ? S.shifts.find(x => x.id === a.shift_id) : null; const rule = a.rule_id ? S.rules.find(r => r.id === a.rule_id) : null; const what = ALERT_WHAT[a.kind] || "";
  const act = !S.viewAs && sh && ((a.kind === "sod_late" || a.kind === "sod_missing") && !S.sods.some(x => x.shift_id === sh.id) ? `<button class="btn" data-sodv="${sh.id}">Post start of day now</button>` : a.kind === "eod_late" && !S.eods.some(x => x.shift_id === sh.id) ? `<button class="btn accent" data-eodv="${sh.id}">Post end of day now</button>` : "") || (a.kind === "vchk_due" && !S.viewAs ? `<button class="btn accent" id="al-vchk">Do the vehicle check</button>` : "");
  sheet(`<h3>${esc(a.title)}</h3>${a.body ? `<p>${esc(a.body)}</p>` : ""}${what ? `<p class="hint">${what}</p>` : ""}${sh ? `<p class="meta">${esc(sh.run)} · ${label(sh.day)}${rule ? ` · ${esc(rule.name)} ${winTxt(rule)}` : ""}</p>` : ""}
    ${act}${S.viewAs && !S.viewer?.isStaff ? "" : `<button class="btn ghost" id="al-got">Got it</button>`}`,
    (bg, close) => { bg.querySelector("#al-vchk")?.addEventListener("click", () => { close(); vehicleCheckForm(); }); bg.querySelector("#al-got")?.addEventListener("click", () => { close(); gotItAlert(a.id); }); });
}
async function gotItAlert(id) { const { error } = await sb.rpc("alert_ack", { p_id: id }); if (error) return toast(error.message, "err"); S.alerts = S.alerts.filter(x => x.id !== id); toast("Got it ✓", "ok"); render(); }
/* ---------- Calendar: stat days (NZ + Otago Anniversary) and my leave, approved and waiting ---------- */
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`; }
function nthMon(y, mo, n) { const first = `${y}-${String(mo).padStart(2, "0")}-01`; return addDays(first, (7 - dow(first)) % 7 + 7 * (n - 1)); }
const MATARIKI = { 2025: "2025-06-20", 2026: "2026-07-10", 2027: "2027-06-25", 2028: "2028-07-14", 2029: "2029-07-06", 2030: "2030-06-21" };
function statDays(y) {
  const o = {}; const put = (d, n) => { o[d] = n; };
  const wkMon = d => dow(d) === 5 ? addDays(d, 2) : dow(d) === 6 ? addDays(d, 1) : d;           // Sat/Sun → Monday
  const pair = (a, b, na, nb) => { let x = a, z = b; if (dow(a) === 5) { x = addDays(a, 2); z = addDays(a, 3); } else if (dow(a) === 6) { x = addDays(a, 2); z = addDays(a, 1); } else if (dow(b) === 5) z = addDays(b, 2); put(x, na); put(z, nb); };
  pair(`${y}-01-01`, `${y}-01-02`, "New Year's Day", "Day after New Year's");
  put(wkMon(`${y}-02-06`), "Waitangi Day");
  const e = easter(y); put(addDays(e, -2), "Good Friday"); put(addDays(e, 1), "Easter Monday");
  const oa = (() => { const t = `${y}-03-23`, back = dow(t), m = back <= 3 ? addDays(t, -back) : addDays(t, 7 - back); return m === addDays(e, 1) ? addDays(m, 1) : m; })(); put(oa, "Otago Anniversary");
  put(wkMon(`${y}-04-25`), "ANZAC Day");
  put(nthMon(y, 6, 1), "King's Birthday");
  if (MATARIKI[y]) put(MATARIKI[y], "Matariki");
  put(nthMon(y, 10, 4), "Labour Day");
  pair(`${y}-12-25`, `${y}-12-26`, "Christmas Day", "Boxing Day");
  return o;
}
function calendarCard(t) {
  const mon = S.calMonth || t.slice(0, 7); const [y, m] = mon.split("-").map(Number);
  const stats = { ...statDays(y), ...Object.fromEntries(Object.entries(S.C.holidays || {}).map(([d, h]) => [d, h.name])) };
  const leave = S.leave.filter(l => l.status === "approved" || l.status === "pending");
  const first = `${mon}-01`; const start = monOf(first); const last = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  const cells = []; for (let d = start; d <= last || dow(d) !== 0; d = addDays(d, 1)) cells.push(d);
  const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const cell = d => { const out = d.slice(0, 7) !== mon; const st = stats[d]; const lv = leave.find(l => d >= l.date_from && d <= l.date_to); const cls = [out ? "out" : "", d === t ? "now" : "", st ? "stat" : "", lv ? (lv.status === "approved" ? "lv-ok" : "lv-wait") : ""].join(" ");
    const tip = [st, lv ? `${LEAVE_T[lv.type] || lv.type} (${lv.status === "approved" ? "approved" : "waiting for approval"})` : ""].filter(Boolean).join(" · ");
    return `<div class="cd ${cls}" ${lv ? `data-leavev="${lv.id}"` : st ? `data-statv="${esc(st)}"` : ""} title="${esc(tip)}"><span>${+d.slice(8)}</span>${st ? `<i>stat</i>` : lv ? `<i>${lv.status === "approved" ? "leave" : "asked"}</i>` : ""}</div>`; };
  const inMonth = d => d.slice(0, 7) === mon;
  const statList = Object.entries(stats).filter(([d]) => inMonth(d)).sort();
  const lvList = leave.filter(l => l.date_to >= first && l.date_from <= last);
  return `<div class="card" id="cal"><h2>Calendar<span><button class="ar" data-cal="-1">‹</button> ${MON[m - 1]} ${y} <button class="ar" data-cal="1">›</button></span></h2>
    <div class="calg">${["M","T","W","T","F","S","S"].map(x => `<div class="ch">${x}</div>`).join("")}${cells.map(cell).join("")}</div>
    <div class="calk"><span><b class="k stat"></b>Stat day</span><span><b class="k lv-ok"></b>Leave approved</span><span><b class="k lv-wait"></b>Leave waiting</span></div>
    ${statList.length || lvList.length ? `<div class="list" style="margin-top:6px">${statList.map(([d, n]) => `<div class="item accent" style="padding:6px 10px"><b>${label(d)}</b> · ${esc(n)}</div>`).join("")}${lvList.map(l => `<div class="item clk ${l.status === "approved" ? "ok" : "warn"}" style="padding:6px 10px" data-leavev="${l.id}"><b>${label(l.date_from)}${l.date_to !== l.date_from ? ` – ${label(l.date_to)}` : ""}</b> · ${esc(LEAVE_T[l.type] || l.type)} · ${l.status === "approved" ? "approved" : "waiting for approval"}</div>`).join("")}</div>` : `<p class="hint">No stat days or leave this month.</p>`}</div>`;
}
function leaveSheet(l) {
  const days = []; for (let d = l.date_from; d <= l.date_to && days.length < 31; d = addDays(d, 1)) days.push(d); const clash = days.filter(d => S.days[d]);
  sheet(`<h3>${esc(LEAVE_T[l.type] || l.type)}</h3><p class="meta">${label(l.date_from, true)}${l.date_to !== l.date_from ? ` – ${label(l.date_to, true)}` : ""}${l.part !== "full" ? ` · ${l.part === "AM" ? "morning off" : "afternoon off"}` : ""} · asked ${fmtTs(l.created_at)}</p>
    <dl class="kv"><dt>Status</dt><dd>${pill(l.status, l.status === "approved" ? "ok" : l.status === "declined" ? "crit" : l.status === "pending" ? "warn" : "grey")}${l.decided_at ? ` <span class="meta">${fmtTs(l.decided_at)}</span>` : ""}</dd>${l.notes ? `<dt>Your note</dt><dd>${esc(l.notes)}</dd>` : ""}${l.reply ? `<dt>Reply</dt><dd>${esc(l.reply)}</dd>` : ""}<dt>Received email</dt><dd>${l.acked_email_at ? "sent " + fmtTs(l.acked_email_at) : "on its way"}</dd></dl>
    ${clash.length ? `<p class="meta">${l.status === "approved" ? "You're still showing on the roster for" : "You're currently rostered on"} ${clash.map(d => `<button class="linkbtn" data-dayv="${d}">${label(d)}</button>`).join(", ")}${l.status === "approved" ? " — check with Jeremy." : "."}</p>` : ""}
    <p class="hint">${l.status === "pending" ? "Jeremy will say yes or no by email. Nothing is approved until then." : l.status === "approved" ? "It's on the roster as leave. Enjoy the time off." : l.status === "declined" ? "If you'd like to talk about it, give Jeremy a call." : ""}</p>`);
}
function msgSheet(m) {
  sheet(`<h3>Message from ${esc(first(S.people[m.messages.sender]?.name || "Jeremy"))}</h3><p class="meta">${fmtTs(m.messages.created_at)}${m.read_at ? ` · read ${fmtTs(m.read_at)}` : ""}${m.confirmed_at ? ` · <span class="c-ok">✓ confirmed ${fmtTs(m.confirmed_at)}</span>` : ""}</p><pre class="msg" style="font-family:var(--fd);font-size:15px">${esc(m.messages.body)}</pre>
    ${m.messages.needs_confirm && !m.confirmed_at && !S.viewAs ? `<button class="btn" id="m-ok">Got it</button>` : ""}`, (bg, close) => { bg.querySelector("#m-ok")?.addEventListener("click", async () => { await q(sb.from("message_recipients").update({ confirmed_at: new Date().toISOString(), read_at: new Date().toISOString() }).eq("message_id", m.message_id).eq("person", S.me.id)); close(); toast("Confirmed ✓", "ok"); }); });
}

/* ================= location (between SOD and EOD, while the app is open) ================= */
let locWatch = null, lastSent = 0, lastPos = null;
function locationTick() {
  if (S.viewAs) return;
  const n = nzNow(); const T = S.days[n.date];
  const sodSeg = T && T.segs.find(x => x.sod); const runs = T ? T.segs.filter(x => !x.sort) : [];
  const finished = T && (runs.length ? runs.every(x => x.eod) : T.segs.some(x => x.eod));
  const should = !!(sodSeg && !finished && "geolocation" in navigator);
  if (should && !locWatch) {
    S.locOn = true; S.locShift = (runs.find(x => !x.eod) || T.segs[0]).shift.id;
    locWatch = navigator.geolocation.watchPosition(p => { lastPos = p; const now = Date.now(); if (now - lastSent > 120000) send(p); }, () => { }, { enableHighAccuracy: true, maximumAge: 60000 });
    S.locTimer = setInterval(() => { if (lastPos && Date.now() - lastSent > 120000) send(lastPos); }, 60000);
  } else if (!should && locWatch) { navigator.geolocation.clearWatch(locWatch); locWatch = null; clearInterval(S.locTimer); S.locOn = false; }
  function send(p) { lastSent = Date.now(); sb.from("locations").insert({ driver: S.me.id, shift_id: S.locShift, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading }).then(() => { }); }
}
