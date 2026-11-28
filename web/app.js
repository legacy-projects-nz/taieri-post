// Taieri Post · driver app
import { briefHtml, needsConfirm, shrinkPhoto, DEMO, sb, q, me, nzNow, today, addDays, dow, dayName, monOf, label, longLabel, toMin, fmtT, fmtTs, fmtTime, ago, esc, $, $$, h, toast, pill, first, col, pct, live, debounce, isSort, enablePush, pushState, nzToIso, settings as loadSettings, signOut, errCtx, reportError } from "/shared/core.js";
import { requireUser } from "/shared/auth.js";
import { VAPID_PUBLIC } from "/shared/config.js";
import { resetDemo, newRuns } from "/shared/demo.js";
import { onLeave, vchkWho, cfg, dayShifts, itemsFor, scoreFor, fortnight, itemNote, STATE_LABEL, addName, NET, PICKUP_RUNS, LEG_RUNS, effCalc, setEvidence, setAddonNames, meetRule, meetOn, needsFix, sortExp, XT_KINDS, extraMins, mailRun, autoStops, runStopRatio, tdtEstimate, sodStart, ownerBreakHrs, standingOn } from "/shared/score.js";

const app = $("#app");
const S = { me: null, set: {}, C: null, runs: [], runsBy: {}, vans: {}, addons: [], rules: [], people: {}, shifts: [], sods: [], eods: [], marks: [], entries: [], feed: [], changes: [], acks: [], msgs: [], leave: [], alerts: [], loc: null, gotit: {}, login: {} };
try { S.gotit = JSON.parse(localStorage.getItem("tp-gotit") || "{}"); } catch { }
S.open = {};   // which folded boxes are open this visit (not saved: everything below Next shift starts collapsed when the app opens)

/* ================= boot ================= */
(async () => {
  try { S.me = await requireUser(app); } catch { return; }
  // office staff who don't drive (e.g. fleet) have no driver portal: send them to the owner portal
  // admins (e.g. Alejandro) land on the staff portal too; they reach View as from its "Driver portals" button (/#portals) (25 Nov 2026)
  if (S.me.role !== "driver" && S.me.role !== "owner" && (!S.me.can("scorecard") || (S.me.role === "admin" && !/as=|portals/.test(location.hash)))) { location.replace("/admin/"); return; }
  errCtx({ app: "driver", person: S.me.id });
  // first load: if the connection drops, say so and keep trying instead of sitting on "Loading…"
  for (let i = 0; ; i++) {
    try { await viewAs(); await loadAll(); break; }
    catch (e) { reportError("boot", e);
      app.innerHTML = `<div class="wrap"><div class="top"><div><div class="brand">Taieri Post · driver portal</div><h1>Can't connect</h1></div></div><div class="card"><p>The app can't reach Taieri Post right now. Check your signal. It will keep trying on its own.</p><button class="btn" id="boot-retry">Try again now</button></div></div>`;
      await new Promise(r => { const t = setTimeout(r, Math.min(30000, 4000 * (i + 1))); const bt = $("#boot-retry"); if (bt) bt.onclick = () => { clearTimeout(t); bt.disabled = true; bt.textContent = "Trying…"; r(); }; }); }
  }
  render();
  ensurePush().catch(e => reportError("push", e));
  window.addEventListener("hashchange", async () => { try { await viewAs(); await loadAll(); render(); } catch (e) { reportError("viewas", e); toast("Couldn't load that just now. Try again.", "err"); } });
  live(["extra_time", "shifts", "sod", "eod", "alerts", "roster_changes", "roster_change_items", "change_acks", "messages", "message_recipients", "leave_requests", "entries", "marks", "vans", "settings", "timing_rules", "addons", "breaks", "van_washes", "sod_requests", "hazards", "hazard_acks"], debounce(async () => { await loadAll(); render(true); }, 400), "drv");
  setInterval(() => render(true), 60000);
  setInterval(async () => { if (document.hidden || !S.shifts?.some(z => z.day === today() && z.run === "LAW")) return; const r = await sb.rpc("law_pickups", { p_day: today() }); if (!r.error) { S.lawPu = r.data || []; render(true); } }, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadAll().then(() => render(true)); } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { });
  // pick up new versions without a manual refresh: compare app.js's ETag now and whenever the app comes back to the front
  let tag = null; const ver = async () => { try { const ts = await Promise.all(["/app.js", "/shared/core.js", "/shared/score.js"].map(async u => { const r = await fetch(u, { method: "HEAD", cache: "no-store" }); return r.ok ? (r.headers.get("etag") || r.headers.get("last-modified") || "") : null; })); if (ts.some(x => !x)) return; const t = ts.join("|"); const typing = document.activeElement?.matches?.("input:not([type=checkbox]):not([type=radio]),textarea,select"); if (tag && t !== tag && !document.querySelector(".sheet-bg") && !typing) location.reload(); tag = tag || t; } catch { } };
  // overdue alert: beep (and buzz) every 5 minutes while the app is open and something is still overdue
  let actx = null, lastBeep = 0; const unlock = () => { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch { } };
  ["click", "touchstart", "keydown"].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));
  const beep = () => { try { if (!actx || actx.state !== "running") return false; for (let i = 0; i < 3; i++) { const o = actx.createOscillator(), g = actx.createGain(); o.type = "square"; o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(actx.destination); const t0 = actx.currentTime + i * 0.35; o.start(t0); o.stop(t0 + 0.2); } navigator.vibrate?.([400, 150, 400, 150, 400]); return true; } catch { return false; } };
  setInterval(() => { if (S.viewAs || S.me?.role === "owner" || document.hidden) return; if (!(S.alerts || []).some(a => !a.resolved_at && ["sod_late", "sod_missing", "eod_late", "timing_missed"].includes(a.kind))) { lastBeep = 0; return; } if (Date.now() - lastBeep < 295000) return; if (beep()) lastBeep = Date.now(); }, 5000);
  ver(); setInterval(ver, 300000); document.addEventListener("visibilitychange", () => { if (!document.hidden) ver(); });
})();

// One load at a time: a request that arrives while one is running makes it run once more, so nobody ends up with older data on top of newer.
// If a load fails after the app is up, what's on screen stays, a "no connection" line shows, and it retries on its own (5 s, 10 s, 20 s … up to a minute).
let _load = null, _again = false, _retryN = 0, _retryT = null;
function loadAll() {
  if (_load) { _again = true; return _load; }
  _load = (async () => {
    try { do { _again = false; await loadAllNow(); } while (_again); S.loadErr = null; S.loadedAt = Date.now(); _retryN = 0; clearTimeout(_retryT); }
    catch (e) { S.loadErr = e; reportError("load", e); if (!S.loadedAt) throw e; clearTimeout(_retryT); _retryT = setTimeout(() => loadAll().then(() => render(true)), Math.min(60000, 5000 * 2 ** _retryN++)); }
  })().finally(() => { _load = null; });
  return _load;
}
async function loadAllNow() {
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
  try { const { data } = await sb.from("calendar_events").select("*").gte("day", addDays(t, -400)).order("day"); S.events = data || []; } catch { S.events = []; }
  S.set = set; S.C = cfg(set); S.runs = runs; S.runsBy = Object.fromEntries(runs.map(r => [r.code, r])); S.vans = Object.fromEntries(vans.map(v => [v.plate, v])); S.addons = addons; setAddonNames(addons); S.rules = rules;
  S.people = Object.fromEntries(people.map(p => [p.id, p])); S.shifts = shifts.filter(s => s.driver === m); S.trainee = shifts.filter(s => s.trainee === m && s.driver !== m);
  S.changes = changes; S.acks = acks; S.briefs = (msgs || []).filter(m => m.messages.kind === "brief"); S.msgs = (msgs || []).filter(m => m.messages.kind !== "brief"); S.leave = leave; S.alerts = alerts; S.entries = entries; S.marks = marks; S.feed = feed; S.vchk = vchk || [];
  const ids = S.shifts.map(s => s.id);
  // second round, all at once (was one after another): SOD/EOD/overrides, pick-ups, access info, van washes, breaks
  const soft = (p, d) => Promise.resolve(p).then(r => r?.error ? d : (r?.data ?? d), () => d);
  const [sods, eods, ovs, pk, ai, vw, br, sr, hz, ha, xt] = await Promise.all([
    ids.length ? q(sb.from("sod").select("*").in("shift_id", ids)) : [], ids.length ? q(sb.from("eod").select("*").in("shift_id", ids)) : [],
    !ids.length ? [] : S.viewer?.isStaff ? q(sb.from("eff_overrides").select("*").in("shift_id", ids)) : sb.rpc("my_eff_overrides").then(r => r.data || []),
    soft(sb.from("pickups").select("*").eq("driver", m).gte("day", t.slice(0, 7) + "-01").order("day", { ascending: false }).limit(40), []),
    soft(sb.from("access_info").select("body,updated_at").eq("id", 1).maybeSingle(), null),
    soft(sb.from("van_washes").select("*").gte("at", new Date(Date.now() - 60 * 86400e3).toISOString()).order("at", { ascending: false }).limit(300), []),
    soft(sb.from("breaks").select("*").eq("driver", m).gte("started_at", new Date(from + "T00:00:00+13:00").toISOString()).order("started_at"), []),   // whole score window: unpaid breaks come off efficiency time
    soft(sb.from("sod_requests").select("*").eq("driver", m).gte("day", from), []),
    soft(sb.from("hazards").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(2000), []),
    soft(sb.from("hazard_acks").select("*").eq("driver", m), null),
    soft(sb.from("extra_time").select("*").eq("driver", m).gte("day", from).order("created_at"), []),
  ]);
  // Van use: people Jeremy picks (settings.van_use) see who's on which van for RAM, TUA and Flyer, today and the next few days
  const vu = vanUse(set);
  S.vanUse = vu ? await soft(sb.from("shifts").select("id,day,run,driver,trainee,van,start_at").in("run", vu.runs).gte("day", t).lte("day", addDays(t, 6)).order("day"), []) : null;
  // Mail tray helpers (settings rules.mailHelpers, e.g. Liam: TUA, Flyer, RAM): today's shifts on those runs, to take their mail tray photos
  const mh = S.C.rules.mailHelpers?.[m];
  S.caroseDays = new Set((await soft(sb.from("shifts").select("day").eq("run", "CAROSE").not("driver", "is", null).gte("day", addDays(t, -56)).lte("day", addDays(t, 13)), [])).map(z => z.day));
  S.helpShifts = mh?.length ? (await soft(sb.from("shifts").select("*").in("run", mh).eq("day", t).neq("driver", m), [])).filter(s => s.driver) : [];
  S.extra = xt || [];
  S.lawPu = S.shifts.some(z => z.day === t && z.run === "LAW") ? await soft(sb.rpc("law_pickups", { p_day: t }), null) : null;   // D>B driver's Lawrence pick-ups (PH + NZC) for the Lawrence driver
  S.sods = sods; S.eods = eods; S.ovs = ovs; S.pickups = pk || []; S.access = ai || { body: "" }; S.washes = vw || []; S.breaks = br || []; S.sodReqs = sr || []; S.hazards = hz || []; S.hzAckOn = Array.isArray(ha); S.hzAcks = Object.fromEntries((ha || []).map(a => [a.hazard_id, a.acked_at]));   // confirmations only once the table exists
  setEvidence(S.shifts, S.eods);
  S.days = dayShifts(S.shifts.filter(s => !onLeave(S.leave, s.driver, s.day)), S.runsBy, m);   // a full day of approved leave (e.g. sick) is a day off: no SOD / EOD asked for
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
  S.drivers = S.viewer.isStaff ? await q(sb.from("people").select("id,name,role").eq("active", true).eq("cleared", false).in("role", ["driver", "owner"]).order("name")) : [];   // drivers only: office staff (Stu, Alejandro) have no driver portal
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

/* ================= demo profile bar ================= */
function demoBar() {
  if (!DEMO) return "";
  return `<div class="card" style="position:sticky;top:6px;z-index:5;border:2px solid var(--warn);padding:8px 12px;gap:6px">
    <div class="row" style="align-items:center;gap:8px"><span class="mono" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--warn);flex:1 1 auto">Demo · play with it, nothing is saved to Taieri Post</span>
      <button class="btn ghost sm" id="demo-reset" style="flex:0 0 auto" title="Put today's data back how it started">↺ Reset</button>
      <button class="btn ghost sm" id="demo-new" style="flex:0 0 auto" title="A different roster, van and history">🎲 New runs</button></div></div>`;
}

/* ================= render ================= */
/* ⓘ info buttons: tap for the full description in a pop-up, instead of explanation text on the page */
const INFO = {
  ask: ["Did you do these?", "<p>These tasks weren't ticked off on the day. Jeremy has asked whether you did them.</p><p><b>Yes, done</b> ticks it off but it counts as late. <b>No</b> records it as not done. Both carry the usual penalty, so tick tasks off on the day.</p><p>Answer these before you post your SOD.</p>"],
  carry: ["Do these first", "<p>These tasks weren't done on the day they were due.</p><p>Do each one and tap <b>Done</b> before you post your SOD. Your SOD won't be accepted until they're cleared.</p><p>Each one is recorded as done late, and the late entry is logged against that day.</p>"],
  backup: ["Back-up and on-call", "<p><b>On-call</b> (a day you're not rostered): check your phone 6:30–7:30am and confirm. Call-ins are made by 8am. If you're not needed you get the on-call allowance. If you're called in you're paid for the hours you work, with a 2-hour minimum.</p><p><b>Committed back-up</b> (a day you're working): you're committed to extra hours before or after your shift, up to the block shown. If you're not needed you get the back-up allowance. If you're called in you're paid for the hours worked instead.</p><p><b>Optional back-up</b>: extra hours before or after your shift if you want them. It's your call, and you're paid for hours worked only.</p><p>If your shift starts in the afternoon, check your phone 6:30–7:30am in case you're needed in the morning.</p><p>Allowances are worked out automatically and paid with your fortnightly pay.</p>"],
  scores: ["My scores", "<p>Your scores count from the scoring start date. Each tile shows this week, with the month underneath in grey. Tap a tile to see the working.</p><p><b>Admin</b>: SODs, EODs and tasks posted on time. <b>Efficiency</b>: your actual time against the expected time for your runs. <b>Accuracy</b>: mistakes recorded against you. <b>Safety</b>: driving and safety records.</p><p>Your pay band is set from your average efficiency over the pay fortnight.</p>"],
  tofix: ["To fix", "<p>Posts that were late, missing or incomplete, and EODs missing figures.</p><p>Tap an item to see the working. Post anything still missing with its button. For missing EOD figures, ask Jeremy to add them or include them next time.</p>"],
  pickups: ["Parcel pick-ups", "<p>Your pick-up tasks have their own <b>Enter pick-ups</b> button in Today's tasks. Use that on the day.</p><p>Use this box for any pick-ups you missed, or for another day. Enter small and large parcels for each area and customer, and say whether they came from the depot or the customer.</p>"],
  hazards: ["Hazards", "<p>The hazard register lists known hazards at addresses on the runs: dogs, aggressive people, access problems and so on.</p><p>Read the high and medium hazards for today's runs and tap <b>✓ Read</b>. They come back each month, whenever one changes, and when you're new to a run.</p><p>Use <b>Report a hazard</b> to add a new one, and <b>Search all</b> to look up any address.</p><p><b>If it doesn't feel right, don't do it.</b> Card it and report it.</p>"],
  vcheck: ["Monthly vehicle check", "<p>Once a month: week 3 of the month, due Thursday by 5pm.</p><p>Take four photos: the exterior, the cab, the oil dipstick and the coolant level. Report anything wrong in the notes.</p>"],
};
const ib = k => `<button type="button" class="ib" data-info="${k}" aria-label="More about ${esc(INFO[k][0])}">i</button>`;
document.addEventListener("click", e => { const b = e.target.closest?.("[data-info]"); if (!b) return; e.preventDefault(); e.stopPropagation(); const [t, body] = INFO[b.dataset.info] || []; if (t) sheet(`<h3>${esc(t)}</h3><div class="infobody">${body}</div>`); }, true);
const pair = (a, b) => a && b ? `<div class="pair">${a}${b}</div>` : (a || b || "");   // two boxes across wherever both exist, on phones too
// A part of the page that fails to draw shows a short note instead of taking the whole page down (and the error is logged).
const part = (name, fn) => { try { return fn() ?? ""; } catch (e) { reportError("render:" + name, e); return `<div class="card"><h2>${name}</h2><p class="hint">This part couldn't be shown just now. The rest of the app still works, and Jeremy has been told.</p></div>`; } };
// bg = a background refresh (the minute timer, a live update, the app coming back to the front): it waits while someone is typing on the page so nothing typed is lost
function render(bg) {
  if (bg === true) { const a = document.activeElement; if (a && app.contains(a) && a.matches("input:not([type=checkbox]):not([type=radio]),textarea,select")) { clearTimeout(render._t); render._t = setTimeout(() => render(true), 4000); return; } }
  try { renderNow(); }
  catch (e) { reportError("render", e); if (!app.querySelector(".card")) app.innerHTML = `<div class="wrap"><div class="top"><div><div class="brand">Taieri Post · driver portal</div><h1>Something went wrong</h1></div></div><div class="card"><p>The app hit a problem showing this page. Jeremy has been told.</p><button class="btn" onclick="location.reload()">Reload</button></div></div>`; }
}
/* ---------- Carried over: tasks left undone on an earlier day (last 7 days) come back in red and must be done before SOD ---------- */
function carryOver() {
  const t = today(), from = addDays(t, -7); const out = []; const mk = {}; for (const m of S.marks || []) mk[m.key] = m;
  for (const s of S.shifts) {
    if (s.driver !== S.me.id || s.run === "BU" || s.day < from || s.day >= t) continue;
    const sat = dayName(s.day) === "Sat";
    const keys = new Set([...(s.addons || []), ...S.addons.filter(a => standingOn(a, s.run, s.day, S.rules)).map(a => a.id)]);
    for (const r of S.rules) if (r.active && r.done_key && keys.has(r.addon) && r.runs.includes(s.run) && r.days.includes(dow(s.day) + 1)) keys.add(r.done_key);
    for (const k of keys) { const m = mk[`add|${s.id}|${k}`]; if (s.done?.[k] || (m && (m.status !== "miss" || m.by_person === s.driver))) continue; out.push({ s, k, name: S.rules.find(r => r.done_key === k)?.name || addName(k) }); }
  }
  return out.sort((a, b) => a.s.day.localeCompare(b.s.day));
}
// add-ons Jeremy has asked about (marks status 'ask'): the driver says if each was done
function askList() { return (S.marks || []).filter(m => m.status === "ask" && m.driver === S.me.id && m.key?.startsWith("add|")).map(m => { const [, sid, ...kk] = m.key.split("|"); const k = kk.join("|"); const s = S.shifts.find(x => x.id === sid); return s && !s.done?.[k] ? { s, k, name: S.rules.find(r => r.done_key === k)?.name || addName(k) } : null; }).filter(Boolean).sort((a, b) => a.s.day.localeCompare(b.s.day)); }
function askCard() {
  const L = askList(); if (!L.length) return "";
  return `<div class="card hot"><h2 class="c-crit">Did you do these? ${ib("ask")}<span>${L.length} asked</span></h2><div class="list">${L.map(({ s, k, name }) => `<div class="item crit"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><span><b>${esc(name)}</b><span class="meta"> · ${esc(s.run)} · ${label(s.day)}</span></span><span class="row" style="flex:0;gap:4px"><button class="btn sm" data-ans="${s.id}|${esc(k)}" data-yes="1" data-name="${esc(name)}">Yes, done</button><button class="btn sm ghost" data-ans="${s.id}|${esc(k)}" data-yes="0" data-name="${esc(name)}">No</button></span></div></div>`).join("")}</div></div>`;
}
/* ---------- Before your SOD: everything outstanding from an earlier day has to be sorted first ----------
   tasks (carried over, or Jeremy asked): Upload · Done · Late · Not done  ·  missing SOD / EOD, or EOD figures missing: Edit */
function gateItems() {
  const t = today(); const out = []; const seen = new Set();
  for (const x of [...askList(), ...carryOver()]) { const id = x.s.id + "|" + x.k; if (seen.has(id)) continue; seen.add(id); out.push({ type: "task", ...x }); }
  const lim = addDays(t, -45);
  for (const i of (S.sc?.items || [])) if (i.day < t && i.day >= lim && !i.row && !i.pre && i.shift && ["late", "miss", "over"].includes(i.st)) out.push({ type: "post", kind: i.kind, s: i.shift, day: i.day, name: `${i.kind} not sent` });
  for (const e of (S.sc?.effDays || [])) if (e.day < t && e.day >= lim && e.pending && e.need && !String(e.need).includes("EOD")) { const r = (e.rows || []).find(r => r.eod && r.shift); if (r) out.push({ type: "figs", s: r.shift, day: e.day, name: `EOD figures missing: ${e.need}` }); }
  return out.sort((a, b) => (a.s.day || a.day).localeCompare(b.s.day || b.day));
}
function gateCard() {
  const L = gateItems(); if (!L.length) return "";
  return `<div class="card hot" id="gate"><h2 class="c-crit">Before your SOD<span>${L.length} to sort out</span></h2><p class="meta">From an earlier day. Pick what happened for each one, then you can start your day.</p><button class="btn crit full" id="gate-open">Sort them out</button></div>`;
}
function gateSheet(sodShift) {
  const L = gateItems();
  const row = (x, i) => { const where = `<span class="meta"> · ${esc(x.s.run || "")} · ${label(x.s.day || x.day)}</span>`;
    const btns = x.type === "task" ? `<label class="btn sm accent" style="cursor:pointer">📷 Upload<input type="file" accept="image/*" capture="environment" data-gup="${i}" hidden></label><button class="btn sm" data-gst="${i}|done">Done</button><button class="btn sm warn" data-gst="${i}|late">Late</button><button class="btn sm ghost" data-gst="${i}|miss">Not done</button>`
      : `<button class="btn sm accent" data-gedit="${i}">Edit</button>`;
    return `<div class="item crit"><div><b>${esc(x.name)}</b>${where}</div><div class="row" style="gap:4px;margin-top:6px;flex-wrap:wrap">${btns}</div></div>`; };
  sheet(L.length ? `<h3>Sort these out first</h3><p class="hint"><b>Done</b> = done on the day, just not ticked · <b>Late</b> = done after the day · <b>Not done</b> = it didn't happen · <b>Upload</b> = add a photo of it. <b>Edit</b> opens the post to fill in.</p><div class="list">${L.map(row).join("")}</div>${sodShift ? `<button class="btn ghost full" id="g-skip" style="margin-top:10px">Can't fix these · start my day</button><p class="meta">They stay in To fix and Jeremy is told.</p>` : ""}`
    : `<h3>All sorted ✓</h3><p class="meta">Nothing left from earlier days.</p>${sodShift ? `<button class="btn full" id="g-sod">Post my SOD</button>` : ""}`, (bg, close) => {
    const again = async msg => { toast(msg, "ok"); await loadAll(); render(); close(); gateSheet(sodShift); };
    bg.querySelector("#g-sod")?.addEventListener("click", () => { close(); sendSod(sodShift); });
    bg.querySelector("#g-skip")?.addEventListener("click", async e => { e.currentTarget.disabled = true;
      const { error } = await sb.rpc("gate_skip", { p_items: L.map(x => `${x.s.run || ""} ${x.s.day || x.day}: ${x.name}`).join("\n") }); if (error) reportError("gate_skip", error);
      S.gateSkip = today(); close(); sendSod(sodShift); });
    bg.querySelectorAll("[data-gst]").forEach(b => b.onclick = async () => { const [i, st] = b.dataset.gst.split("|"); const x = L[+i]; b.parentElement.querySelectorAll("button").forEach(z => z.disabled = true);
      const { error } = await sb.rpc("task_resolve", { p_shift: x.s.id, p_addon: x.k, p_status: st, p_name: x.name }); if (error) { b.parentElement.querySelectorAll("button").forEach(z => z.disabled = false); return toast(error.message, "err"); }
      again(st === "done" ? "Ticked ✓" : st === "late" ? "Recorded as done late" : "Recorded as not done"); });
    bg.querySelectorAll("[data-gup]").forEach(inp => inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const x = L[+inp.dataset.gup]; toast("Uploading photo…");
      const f1 = await shrinkPhoto(f); const path = `${x.s.driver || S.me.id}/${x.s.day}/${x.s.id}-${x.k}-${Date.now()}.jpg`;
      const { error } = await sb.storage.from("runsheets").upload(path, f1, { upsert: true, contentType: f1.type || "image/jpeg" }); if (error) return toast(`Photo didn't upload: ${error.message}`, "err");
      const { error: e2 } = await sb.rpc("task_photo_done", { p_shift: x.s.id, p_addon: x.k, p_path: path, p_note: null }); if (e2) return toast(e2.message, "err");
      await sb.rpc("task_resolve", { p_shift: x.s.id, p_addon: x.k, p_status: "done", p_name: x.name }); again("Photo saved ✓"); });
    bg.querySelectorAll("[data-gedit]").forEach(b => b.onclick = () => { const x = L[+b.dataset.gedit]; close();
      if (x.type === "post" && x.kind === "SOD") sendSod(x.s.id, true); else eodForm(x.s.id, false, x.type === "figs"); });
  }, { wide: true });
}
function carryCard() {
  const L = carryOver(); if (!L.length) return "";
  return `<div class="card hot"><h2 class="c-crit">Do these first ${ib("carry")}<span>${L.length} from an earlier day</span></h2><div class="list">${L.map(({ s, k, name }) => `<div class="item crit"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><span><b>${esc(name)}</b><span class="meta"> · ${esc(s.run)} · ${label(s.day)}</span></span><button class="btn sm" data-carry="${s.id}|${esc(k)}" data-name="${esc(name)}">Done</button></div></div>`).join("")}</div></div>`;
}
function renderNow() {
  const n = nzNow(); const t = n.date; const name = first(S.me.name);
  const greet = n.min < 720 ? "Morning" : n.min < 1020 ? "Hi" : "Evening";
  const T = S.days[t];
  const nextDay = Object.values(S.days).filter(d => d.day > t).sort((a, b) => a.day < b.day ? -1 : 1)[0];
  // no shift today: My scores comes first; the SOD / EOD bar and Today drop away (Next shift stays in the folded boxes)
  // day done = every EOD for today is in: Today drops away and Next shift moves up under the SOD / EOD buttons, open
  const tRuns = T ? T.segs.filter(x => !x.sort) : []; const dayDone = !!T && (tRuns.length ? tRuns.every(x => x.eod) : T.segs.some(x => x.eod)); S.dayDone = dayDone;
  app.innerHTML = `<div class="wrap">
    ${demoBar()}${viewBar()}
    <div class="top"><div><div class="brand">Taieri Post · driver portal${S.viewAs ? " · viewing as " + esc(first(S.viewAs.name)) : ""}</div><h1>${greet} ${esc(name)} 👋</h1></div><div class="upd"><span class="dot live"></span>live<br>${fmtT(n.min)}</div></div>
    ${S.loadErr ? `<p class="hint" style="margin:0 0 8px;color:var(--crit)">No connection. Showing what loaded at ${fmtT(nzNow(new Date(S.loadedAt)).min)}. Trying again on its own.</p>` : ""}
    ${part("Roster brief", () => briefCard())}
    ${part("Before your SOD", () => gateCard())}
    ${T ? part("SOD / EOD", () => quickBar(T, n)) : ""}
    ${part("Lawrence", () => lawBar(T))}
    ${!T ? "" : dayDone ? part("Next shift", () => nextShiftCard(nextDay, n)) : part("Today", () => todayCard(T, nextDay, n))}
    ${layout(T, t, n, nextDay, dayDone)}
    <p class="foot">Signed in as ${esc((S.viewer || S.me).email || "")} · <button type="button" class="linkbtn" id="signout">Sign out</button></p>
  </div>`;
  try { folds(); } catch (e) { reportError("folds", e); }
  try { lawPuPop(); } catch (e) { reportError("lawPuPop", e); }
  try { profilePop(); } catch (e) { reportError("profilePop", e); }
  try { briefPop(); } catch (e) { reportError("briefPop", e); }
  try { wire(); } catch (e) { reportError("wire", e); }
  try { fitQb(); document.fonts?.ready.then(() => fitQb()); } catch (e) { reportError("fitQb", e); }
}
/* Button titles never get cut off: if a line doesn't fit, swap in its short form (data-s), then shrink the text a little */
function fitQb(root = app) {
  root.querySelectorAll(".qb > b, .qb > small").forEach(el => {
    // scrollWidth can't be trusted with an ellipsis, so measure the text itself
    const over = () => { const room = el.getBoundingClientRect().width; const st = el.style; const was = [st.maxWidth, st.width, st.position];
      st.maxWidth = "none"; st.width = "max-content"; st.position = "absolute"; const need = el.getBoundingClientRect().width;
      [st.maxWidth, st.width, st.position] = was; return need > room + 0.01; };
    const lead = el.dataset.with ? el.parentElement.querySelector(":scope > " + el.dataset.with) : null;
    if (!over() && !(lead && lead.dataset.s && lead.textContent === lead.dataset.s)) return;
    if (el.dataset.s) el.textContent = el.dataset.s;
    let f = parseFloat(getComputedStyle(el).fontSize); const min = f * 0.75;
    while (over() && f > min) { f -= 0.5; el.style.fontSize = f + "px"; }
  });
}
addEventListener("resize", () => { try { fitQb(); } catch { } });

/* ---------- collapsible boxes: Next shift and everything below it (plus Parcel pick-ups) are one row until tapped ---------- */
function folds() {
  app.querySelectorAll(".folds .card:not(.rbrow), #pickups, #hazards, #tasks, #nextshift, #vanuse, #msgs").forEach(c => {
    const h = c.querySelector(":scope > h2"); if (!h) return;
    const key = c.dataset.foldKey || c.id || [...h.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join("").trim();
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
  const sodBtn = sod ? `<div class="qb done"><b>✓ SOD</b><small>${fmtTime(sod.sent_at)}${sod.van ? ` · ${esc(sod.van)}` : ""}</small></div>` : (va ? offB("▶ SOD", "not posted yet") : `<button class="btn qb" id="sod" data-shift="${T.segs[0].shift.id}"><b>▶ SOD</b><small></small></button>`);
  const eodBtns = sortOnly
    ? (T.segs.some(eodOf) ? `<div class="qb done"><b>✓ EOD</b><small>sorting finished ${fmtTime(T.segs.find(eodOf).eod.sent_at)}</small></div>` : (va ? offB("■ EOD", "not posted yet") : `<button class="btn qb accent" data-eod="${T.segs[T.segs.length - 1].shift.id}" data-sort="1" ${sod ? "" : "disabled"}><b>■ EOD</b><small>${sod ? "" : "after your SOD"}</small></button>`))
    : runs.map(x => { const due = (x.en ?? x.st) + S.C.rules.eodHours * 60; const late = sod && !x.eod && n.min > due;
        return x.eod ? `<div class="qb done"><b>✓ EOD${runs.length > 1 ? ` ${esc(x.shift.run)}` : ""}</b><small>${fmtTime(x.eod.sent_at)}${x.eod.finish_time ? ` · finished ${fmtT(toMin(x.eod.finish_time))}` : ""}</small></div>`
          : va ? offB(`■ EOD${runs.length > 1 ? ` ${esc(x.shift.run)}` : ""}`, late ? "overdue" : "not posted yet") : `<button class="btn qb ${late ? "warn" : "accent"}" data-eod="${x.shift.id}" ${sod ? "" : "disabled"}><b>■ EOD${runs.length > 1 ? ` ${esc(x.shift.run)}` : ""}</b><small>${!sod ? "after your SOD" : late ? "overdue" : ""}</small></button>`; }).join("");
  // one button for the whole day: ▶ SOD turns into whatever comes next (■ End sort → ■ End run → ▶ Start sort → … → ■ EOD)
  if (sortOnly) return `<div class="qbar">${sodBtn}${eodBtns}${brkRow(breakBtn(T, sod), hoursBtn(T, sod))}</div>`;
  const main = sod ? dayStep(T, sod, runs, va, offB, n) : sodBtn.replace('class="btn qb"', 'class="btn qb main"').replace('class="qb off"', 'class="qb off main"');
  return `<div class="qbar">${main}${brkRow(breakBtn(T, sod), hoursBtn(T, sod))}</div>`;
}
/* The day's next step, as one button. Each step ends the one before it:
   sorting → ■ End sort [code]; on a run → ■ End [code] (its EOD) or ■ EOD [code] on the last one; between runs → ▶ Start [sort] [code]. */
function dayStep(T, sod, runs, va, offB, n) {
  const segs = T.segs; const all = segs.map((x, i) => ({ x, i }));
  const started = i => stMs(T, i) != null; const ended = (x, i) => !!x.shift.eor_at || !!x.eod || segs.some((y, j) => j > i && started(j));
  const cur = all.filter(({ x, i }) => started(i) && !ended(x, i)).pop();
  const nxt = all.find(({ i }) => !started(i));
  const lab = x => esc(sortCode(x.shift.run));
  const btn = (cls, attrs, title, sub) => `<button class="btn qb main ${cls}" ${attrs}><b>${title}</b><small>${sub}</small></button>`;
  const eodB = (x, title, sub) => { const due = (x.en ?? x.st) + S.C.rules.eodHours * 60; const late = n.min > due;
    return va ? offB(title, late ? "overdue" : "not posted yet").replace('class="qb off"', 'class="qb off main"') : btn(late ? "warn" : "accent", `data-eod="${x.shift.id}"`, title, late ? "overdue" : sub); };
  // EODs still owed on runs that were ended some other way (older taps): small buttons beside the main one
  const owed = runs.filter(x => { const i = segs.indexOf(x); return !x.eod && x !== cur?.x && started(i) && ended(x, i); });
  const owedB = owed.map(x => va ? offB(`■ EOD ${lab(x)}`, "not sent") : `<button class="btn qb warn" data-eod="${x.shift.id}"><b>■ EOD ${lab(x)}</b><small>not sent yet</small></button>`).join("");
  let main = "";
  const so = sortNow(T, cur);
  if (so) { const out = {}; runBar(T, sod, runs, va, offB, out); main = (out.sort || "").replace('class="btn qb', 'class="btn qb main').replace('class="qb off"', 'class="qb off main"'); }
  if (!main && cur && !cur.x.sort) { const x = cur.x; const after = segs.slice(cur.i + 1).length > 0; const going = x.shift.deliver_at ? `going since ${fmtTime(x.shift.deliver_at)}` : "going";
    main = after ? eodB(x, `■ End ${lab(x)}`, `send its EOD · then ▶ ${lab(segs[cur.i + 1])}`) : eodB(x, `■ EOD ${lab(x)}`, `${lab(x)} ${going}`); }
  if (!main && nxt) { const x = nxt.x; const sorting = x.sort || (ownSort(segs, nxt.i) && !isGo(x.shift.run));
    const title = `▶ Start ${sorting ? "sort " : ""}${lab(x)}`;
    main = va ? offB(title, "not started").replace('class="qb off"', 'class="qb off main"') : btn("", `data-runmark="sor" data-shift="${x.shift.id}"`, title, x.st != null ? `rostered ${fmtT(x.st)}` : ""); }
  if (!main && owed.length) return owedB.replace('class="btn qb warn"', 'class="btn qb main warn"');
  if (!main) main = `<div class="qb done main"><b>✓ Day done</b><small>all EODs sent${runs.length ? ` · last ${fmtTime(runs[runs.length - 1].eod?.sent_at || new Date().toISOString())}` : ""}</small></div>`;
  return main + owedB;
}
// Runboard (view only for drivers): a full-width button near the end of the page, styled like the break / hours row
const rbBtn = () => `<a class="card rbrow" href="/admin/#runboard"><h2>Runboard<span>this week's roster, view only</span><i class="fchev" aria-hidden="true"></i></h2></a>`;   // looks like the folded rows, opens the Run Board
/* Stages: a driver's day is its shifts in order, sorts included. The first starts with the SOD; ▶ Start [run] starts the next one
   and ends the one before (so a sort before a run is timed by the tap); ■ EOR ends the run you're on (e.g. a gap before the next one);
   ▶ Delivering marks the end of a sort done inside the run (no sort shift before it). */
const stMs = (T, i) => { const x = T.segs[i]; if (i === 0) { const sod = T.segs.find(y => y.sod)?.sod; return sod ? Date.parse(sod.sent_at) : null; } return x.shift.sor_at ? Date.parse(x.shift.sor_at) : null; };
// sort minutes for a run from the taps: the sort shift just before it (its start → this run's start) + any sort inside the run (start → ▶ Delivering)
// "go" runs (RAM, TUA, Flyer): already sorted / loaded for the driver, so the run starts with the SOD or the Sort done tap
const isGo = code => S.C?.sortMin?.[code] === 0;
const NO_SORT = { includes: isGo };
// runs with their own sort even straight after a sort shift (D>B: the mail sort comes after the SUP support sort)
const OWN_SORT = ["DB"];
// a run's own sort shift on the Run Board (Sort – D>B = SUP4): when it comes straight before the run, the run has no sort of its own
const SORT_FOR = { SUP4: "DB" };
const ownSort = (segs, i) => !!segs[i] && OWN_SORT.includes(segs[i].shift.run) && SORT_FOR[segs[i - 1]?.shift.run] !== segs[i].shift.run;
const sortCode = c => c === "DB" || c === "SUP4" ? "D>B" : c;
// for showing a day: a run with its own sort (D>B) shows as two rows, "Sort – D>B" then the run, split at its expected sort time
function showSegs(D) {
  if (!D) return [];
  return D.segs.flatMap((x, i) => {
    const m = !x.sort && ownSort(D.segs, i) && x.st != null ? sortExp(S.C, x.shift.run, D.day) : null;
    if (!m || (x.en != null && x.st + m >= x.en)) return [x];
    return [{ ...x, shift: { ...x.shift, van: null, addons: [], note: null }, sort: true, inner: true, lab: `Sort – ${sortCode(x.shift.run)}`, en: x.st + m, eod: null, sod: null }, { ...x, st: x.st + m }];
  });
}
// the sort the driver is on now, if any: a sort shift, or the sorting part of a run that has its own sort time
function sortNow(T, cur) {
  if (!cur) return null; const { x, i } = cur; const st = stMs(T, i); if (st == null) return null;
  if (x.sort) { const en = x.rostEn ?? x.en; const exp = en != null && x.st != null && en > x.st ? en - x.st : null; return { st, exp }; }
  if (isGo(x.shift.run) || x.shift.deliver_at || x.eod || (T.segs[i - 1]?.sort && !ownSort(T.segs, i))) return null;
  return { st, exp: sortExp(S.C, x.shift.run, T.day || today()) };
}
function sortTap(T, x, runStartMs) {
  if (isGo(x.shift.run)) return null;
  const i = T.segs.indexOf(x); if (i < 0) return null; const st = runStartMs ?? stMs(T, i); let m = null;
  const pre = T.segs[i - 1]; if (pre?.sort) { const ps = stMs(T, i - 1); if (ps != null && st != null && st > ps) m = (m || 0) + (st - ps) / 60000; }
  if (x.shift.deliver_at && st != null) { const d = Date.parse(x.shift.deliver_at); if (d > st) m = (m || 0) + (d - st) / 60000; }
  return m == null ? null : Math.round(m);
}
function runBar(T, sod, runs, va, offB, out = {}) {
  if (!runs.length || !sod) return "";
  const segs = T.segs; const all = segs.map((x, i) => ({ x, i }));
  const started = i => stMs(T, i) != null; const ended = (x, i) => !!x.shift.eor_at || !!x.eod || segs.some((y, j) => j > i && started(j));
  const cur = all.filter(({ x, i }) => started(i) && !ended(x, i)).pop();
  const nxt = all.find(({ i }) => !started(i));
  const lab = x => x.sort ? "sort" : esc(sortCode(x.shift.run));
  const eorB = !cur || cur.x.sort || runs.length < 2 ? ""   // one run in the day: the EOD ends it, no EOR
  : va ? offB(`■ EOR ${lab(cur.x)}`, "run going") : `<button class="btn qb ghost" data-runmark="eor" data-shift="${cur.x.shift.id}"><b>■ EOR ${lab(cur.x)}</b><small></small></button>`;
  // sorting: one "Sort done" button with a timer; it turns amber once the sort is past its expected time.
  // On a sort shift it ends the sort and starts the next run; on a run with its own sort it starts delivering.
  const so = sortNow(T, cur); const el = so ? Math.max(0, Math.round((Date.now() - so.st) / 60000)) : 0; const over = !!so && so.exp != null && el > so.exp;
  const tmr = so ? `sorting ${el}${so.exp != null ? ` of ${so.exp}` : ""} min${over ? " · over" : ""}` : "";
  // labelled with the sort being ended, e.g. ■ End sort SUP, then ■ End sort D>B
  const endLab = `■ End sort ${so ? esc(sortCode(cur.x.shift.run)) : ""}`; const endS = "■ End sort";   // short form: the sort's code moves down to the timer line
  const tmrS = so ? `${esc(sortCode(cur.x.shift.run))} · ${el}${so.exp != null ? `/${so.exp}` : ""} min${over ? " · over" : ""}` : "";
  const sortB = (kind, id, then) => va ? offB(endLab, tmr) : `<button class="btn qb ${over ? "warn" : ""}" data-runmark="${kind}" data-shift="${id}"><b data-s="${endS}">${endLab}</b><small data-s="${tmrS}" data-with="b">${tmr} · ${then}</small></button>`;
  const sorB = !nxt ? "" : cur?.x.sort ? sortB("sor", nxt.x.shift.id, `starts ${lab(nxt.x)}`)
    : va ? offB(`▶ Start ${lab(nxt.x)}`, "not started") : `<button class="btn qb" data-runmark="sor" data-shift="${nxt.x.shift.id}"><b>▶ Start ${lab(nxt.x)}</b><small>${cur ? `ends ${lab(cur.x)}` : ""}</small></button>`;
  const dlvB = !so || cur.x.sort ? "" : sortB("dlv", cur.x.shift.id, `starts ${lab(cur.x)}`);
  if (so) { out.sort = cur.x.sort ? sorB : dlvB; return ""; }
  const btns = [eorB, sorB].filter(Boolean).join("");
  return btns ? `<div class="qbar">${btns}</div>` : "";
}
/* the day's stages so far, e.g. "Sort 5:55am–10:04am · DB 10:04am – now" (shown in Today) */
function stageLine(T) {
  const segs = T.segs; const all = segs.map((x, i) => ({ x, i }));
  const tm = ms => fmtTime(new Date(ms).toISOString());
  const line = segs.length < 2 && !segs[0].shift.deliver_at ? "" : all.map(({ x, i }) => { const s0 = stMs(T, i); if (s0 == null) return ""; const e = x.shift.eor_at ? Date.parse(x.shift.eor_at) : (segs.slice(i + 1).map((_, k) => stMs(T, i + 1 + k)).find(v => v != null) ?? null);
    const end = e ? `–${tm(e)}` : x.eod ? " ✓" : " – now"; const code = esc(sortCode(x.shift.run));
    if (x.sort) return `<b>Sort ${code}</b> ${tm(s0)}${end}`;
    // a run with its own sort (D>B): "Sort D>B 7:00–8:05 · D>B 8:05 – now"
    if (x.shift.deliver_at && ownSort(segs, i)) { const d = Date.parse(x.shift.deliver_at); return `<b>Sort ${code}</b> ${tm(s0)}–${tm(d)} · <b>${code}</b> ${tm(d)}${end}`; }
    if (ownSort(segs, i) && !e && !x.eod) return `<b>Sort ${code}</b> ${tm(s0)} – now`;
    return `<b>${code}</b> ${tm(s0)}${x.shift.deliver_at ? ` (${NO_SORT.includes(x.shift.run) ? "on the road" : "delivering"} ${tm(Date.parse(x.shift.deliver_at))})` : ""}${end}`; }).filter(Boolean).join(" · ");
  return line;
}
/* Unpaid break and + Hours sit side by side on one full-width row (either alone takes the whole row) */
const brkRow = (...xs) => xs.some(Boolean) ? `<div class="brkrow">${xs.join("")}</div>` : "";
/* Break: one button between SOD and the last EOD. Tap to start, tap again to end. */
function breakBtn(T, sod) {
  const runs = T.segs.filter(x => !x.sort); const allEod = runs.length ? runs.every(x => x.eod) : T.segs.some(x => x.eod);
  const open = (S.breaks || []).find(b => !b.ended_at);
  const ids = new Set(T.segs.map(x => x.shift.id)); const todays = (S.breaks || []).filter(b => ids.has(b.shift_id) && b.ended_at);
  const mins = todays.reduce((a, b) => a + Math.round((new Date(b.ended_at) - new Date(b.started_at)) / 60000), 0);
  const taken = todays.length ? `${todays.length} unpaid break${todays.length > 1 ? "s" : ""} today · ${mins} min` : "";
  if (open) { const m = Math.max(0, Math.round((Date.now() - new Date(open.started_at)) / 60000));
    return S.viewAs ? `<div class="qb brk on"><b>☕ On unpaid break</b><small>since ${fmtTime(open.started_at)} · ${m} min</small></div>`
      : `<button class="btn qb brk on" id="brk-end"><b data-s="■ End break">■ End unpaid break</b><small data-s="${m} min">on unpaid break since ${fmtTime(open.started_at)} · ${m} min</small></button>`; }
  if (!sod || allEod) return taken ? `<div class="qb brk off"><b>☕ Unpaid break</b><small>${taken}</small></div>` : "";
  if (S.viewAs) return `<div class="qb brk off"><b>☕ Unpaid break</b><small>${taken || "none taken yet"}</small></div>`;
  return `<button class="btn ghost qb brk" id="brk-start" data-shift="${(runs.find(x => !x.eod) || T.segs[T.segs.length - 1]).shift.id}"><b data-s="☕ Break">☕ Start unpaid break</b><small data-s="${mins ? `${mins} min taken` : ""}">${taken || ""}</small></button>`;
}
/* + Hours: extra work logged for the day (vehicle clean 20 min, vehicle check 10, refuel 5, maintenance / admin with a note, or something Jeremy asked for, which he approves) */
function hoursBtn(T, sod) {
  const mine = (S.extra || []).filter(e => e.day === T.day); const ok = mine.filter(e => e.status === "approved").reduce((a, e) => a + e.minutes, 0); const pend = mine.filter(e => e.status === "pending").length;
  const sub = mine.length ? `${ok} min added today${pend ? ` · ${pend} waiting for Jeremy` : ""}` : "";
  if (S.viewAs) return mine.length ? `<div class="qb brk off"><b>＋ Hours</b><small>${sub}</small></div>` : "";
  if (!sod) return "";
  return `<button class="btn ghost qb brk" id="xt-add" data-day="${T.day}" data-shift="${(T.segs.filter(x => !x.sort).find(x => !x.eod) || T.segs[T.segs.length - 1]).shift.id}"><b>＋ Hours</b><small>${sub}</small></button>`;
}
function hoursSheet(day, shiftId) {
  const mine = (S.extra || []).filter(e => e.day === day);
  const st = e => e.status === "pending" ? pill("waiting for Jeremy", "warn") : e.status === "declined" ? pill("declined", "crit") : pill("added", "ok");
  const list = mine.length ? `<div class="list" style="margin-bottom:10px">${mine.map(e => `<div class="item"><div class="row" style="justify-content:space-between;align-items:center"><span><b>${esc(XT_KINDS[e.kind]?.name || e.kind)}</b> · ${e.minutes} min ${st(e)}</span>${!e.decided_by ? `<button class="btn ghost sm" data-xtdel="${e.id}">Remove</button>` : ""}</div>${e.note ? `<div class="meta">${esc(e.note)}</div>` : ""}${e.reply ? `<div class="meta">Jeremy: ${esc(e.reply)}</div>` : ""}</div>`).join("")}</div>` : "";
  const opts = Object.entries(XT_KINDS).map(([k, o], i) => `<label class="chk ${i === 0 ? "on" : ""}" style="border-radius:12px;min-height:58px;line-height:1.2"><input type="radio" name="xk" value="${k}" ${i === 0 ? "checked" : ""}><span>${esc(o.name)}<br><small class="meta">${o.min ? `${o.min} min` : o.approve ? "Jeremy approves" : "minutes + note"}</small></span></label>`).join("");
  sheet(`<h3>＋ Hours · ${label(day)}</h3>${list}
    <form class="frm" id="xf"><div class="full" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${opts}</div>
    <label class="f" id="xmin-w" hidden>Minutes<input class="in" id="xmin" inputmode="numeric" placeholder="e.g. 30"></label>
    <label class="f full" id="xnote-w" hidden><span id="xnote-l">What did you do?</span><input class="in" id="xnote" placeholder=""></label>
    <button class="btn full" type="submit">Add</button></form>`, (bg, close) => {
    const sync = () => { const k = bg.querySelector("input[name=xk]:checked").value; const o = XT_KINDS[k]; bg.querySelectorAll("input[name=xk]").forEach(i => i.parentElement.classList.toggle("on", i.checked));
      bg.querySelector("#xmin-w").hidden = !!o.min; bg.querySelector("#xnote-w").hidden = !!o.min;
      bg.querySelector("#xnote-l").textContent = k === "owner_request" ? "What did Jeremy ask you to do?" : "What did you do?"; };
    bg.querySelectorAll("input[name=xk]").forEach(i => i.onchange = sync); sync();
    bg.querySelectorAll("[data-xtdel]").forEach(b => b.onclick = async () => { const { error } = await sb.from("extra_time").delete().eq("id", b.dataset.xtdel); if (error) return toast(error.message, "err"); toast("Removed", "ok"); close(); await loadAll(); render(); });
    bg.querySelector("#xf").onsubmit = async e => { e.preventDefault(); const k = bg.querySelector("input[name=xk]:checked").value; const o = XT_KINDS[k];
      const minutes = o.min || Math.round(+bg.querySelector("#xmin").value || 0); const note = o.min ? null : bg.querySelector("#xnote").value.trim();
      if (!minutes || minutes < 1 || minutes > 600) return toast("Put in the minutes (1 to 600)", "err"); if (!o.min && !note) return toast("Add a note about what you did", "err");
      const { error } = await sb.from("extra_time").insert({ driver: S.me.id, shift_id: shiftId || null, day, kind: k, minutes, note, status: o.approve ? "pending" : "approved" }); if (error) return toast(error.message, "err");
      toast(o.approve ? `${minutes} min sent to Jeremy to approve` : `${minutes} min added ✓`, "ok"); close(); await loadAll(); render(); };
  });
}
async function startBreak(shiftId) { const { error } = await sb.rpc("break_start", { p_shift: shiftId }); if (error) return toast(error.message, "err"); toast("Unpaid break started ☕", "ok"); await loadAll(); render(); }
async function endBreak() { const { error } = await sb.rpc("break_end"); if (error) return toast(error.message, "err"); toast("Unpaid break ended ✓", "ok"); await loadAll(); render(); }

/* ---------- Roster changes ---------- */
function linePast(item, n) {
  // today's changes stay up all day until confirmed, even when the shift is already over (a change sent after the shift ended could never be confirmed before)
  return item.day < n.date;
}
// a shift or van change for this driver's day that went out after their rostered start: the SOD is due from when it was sent, not from the old start
function chgStart(D) {
  let m = null;
  for (const i of S.changes || []) { if (i.day !== D.day || !needsConfirm(i) || !i.roster_changes?.sent_at) continue;
    const n = nzNow(new Date(i.roster_changes.sent_at)); if (n.date === D.day && n.min > D.start - 30 && (m == null || n.min > m)) m = n.min; }
  return m == null ? null : Math.max(m, D.start);
}
function rosterChanges(n) {
  const ackBy = Object.fromEntries(S.acks.map(a => [a.item_id, a]));
  const live_ = S.changes.filter(i => !linePast(i, n)).sort((a, b) => (b.roster_changes.sent_at || "").localeCompare(a.roster_changes.sent_at || ""));
  const settled = i => ackBy[i.id]?.confirmed_at || ackBy[i.id]?.dismissed_at;   // confirmed by the driver or by Jeremy, or dismissed: no button
  const fresh = live_.filter(i => needsConfirm(i) && !settled(i) && !S.gotit[i.id]);
  const tapped = live_.filter(i => needsConfirm(i) && !settled(i) && S.gotit[i.id]);
  if (!fresh.length && !tapped.length) return "";   // all confirmed or cleared: the box goes away
  const grp = list => { const by = {}; for (const i of list) (by[i.change_id] ??= { at: i.roster_changes.sent_at, items: [] }).items.push(i); return Object.values(by); };
  return `<div class="card ${fresh.length ? "hot" : ""}" id="rc"><h2>Roster changes<span>${fresh.length ? `${fresh.length} to confirm` : "Got it sent"}</span></h2>
    ${grp(fresh).map(g => `<div><div class="meta mono">Sent ${fmtTs(g.at)}</div><ul style="margin:4px 0 0 18px;padding:0;color:var(--crit);font-weight:700">${g.items.map(i => `<li>${esc(i.summary)}</li>`).join("")}</ul></div>`).join("")}
    ${fresh.length ? `<button class="btn crit" id="gotit" data-ids="${fresh.map(i => i.id).join(",")}">Got it, I've read ${fresh.length === 1 ? "this change" : "these changes"}</button>` : ""}
    ${tapped.length ? `<p class="hint c-ok">✓ Got it sent for ${tapped.length} change${tapped.length === 1 ? "" : "s"} · <button class="linkbtn" id="gotit-again">Didn't go through? Show again</button></p>` : ""}
  </div>`;
}

/* ---------- From Jeremy / alerts / messages ---------- */
const ENTRY_K = { praise: ["ok", "Nice work 👏"], issue: ["warn", "Heads up"], note: ["accent", "Note"], mistake: ["crit", "Mistake recorded"], adjust: ["accent", "Admin points"], safety: ["warn", "Safety"], eff: ["accent", "Efficiency set"] };
function fromJeremy() {
  const all = S.entries.filter(e => e.show_driver && e.day >= addDays(today(), -56)).sort((a, b) => (b.created_at || b.day).localeCompare(a.created_at || a.day)); if (!all.length) return "";
  const effect = e => [e.kind === "mistake" && !e.excused ? `−${e.pct_off ?? S.C.rules.mistakePct}% Accuracy` : "", e.admin_pts ? `Admin ${e.admin_pts > 0 ? "+" : ""}${e.admin_pts}` : "", e.safety_pct != null ? `Safety ${e.safety_pct}%` : "", e.eff_pct != null ? `Efficiency ${e.eff_pct}%` : ""].filter(Boolean).join(" · ");
  const status = e => e.excused ? pill("removed — doesn't count", "accent") : e.review_requested_at && !e.review_resolved_at ? pill("review requested", "warn") : e.review_resolved_at ? pill("reviewed · stands", "grey") : "";
  const row = e => { const k = ENTRY_K[e.kind] || ENTRY_K.note; return `<div class="item clk ${e.excused ? "accent" : k[0]}" data-entryv="${e.id}"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="m">${k[1]} · ${label(e.day)}${e.run ? ` · ${esc(e.run)}` : ""}${effect(e) ? ` · ${esc(effect(e))}` : ""}</div><div>${esc(e.title)}${e.note ? `<div class="meta">${esc(e.note)}</div>` : ""}</div></div>${status(e) || (!S.viewAs ? `<button class="btn ghost sm" data-review="${e.id}" style="flex:0">Request a review</button>` : "")}</div></div>`; };
  const live_ = all.filter(e => !e.excused); const recent = live_.slice(0, 8), older = [...live_.slice(8), ...all.filter(e => e.excused)];
  if (!recent.length && !older.length) return "";
  return `<div class="card"><h2>Notes from Jeremy<span>mistakes, praise and adjustments · nothing to tick — ask for a review if something's not right</span></h2>${recent.length ? `<div class="list">${recent.map(row).join("")}</div>` : `<p class="meta">Nothing current.</p>`}
    ${older.length ? `<details><summary>Older and removed<span class="meta">${older.length}</span></summary><div class="list" style="margin-top:8px">${older.map(row).join("")}</div></details>` : ""}</div>`;
}
function reviewSheet(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  sheet(`<h3>Ask Jeremy to review this</h3><p><b>${esc(e.title)}</b> · ${label(e.day)}</p><form class="frm" id="rv"><label class="f full">What should he look at? (optional)<textarea class="in" id="rv-note" rows="3" placeholder="e.g. That parcel was signed for by the neighbour — photo on my scanner"></textarea></label><button class="btn" type="submit">Send review request</button></form>`, (bg, close) => {
    bg.querySelector("#rv").onsubmit = async ev => { ev.preventDefault(); const { error } = await sb.rpc("entry_review", { p_id: id, p_note: bg.querySelector("#rv-note").value }); if (error) return toast(error.message, "err"); close(); toast("Review request sent", "ok"); await loadAll(); render(); };
  });
}
const ALERT_WHAT = { pickup_missing: "Your pick-up totals for this run aren't in yet. Tap Pick-ups and enter the counts, or None if there weren't any.", sod_late: "Your start of day wasn't posted on time. Post it now. Late is better than missing.", sod_missing: "No start of day was posted for this shift. Post it now so the day can be scored.", eod_late: "Your end of day wasn't posted on time. Post it now with your run figures.", timing_missed: "A timed task ran past its window. If you did it, tap Done on it under Today's tasks. If not, let Jeremy know.", timing_due: "A timed task on your run is due soon.", vchk_due: "Your weekly vehicle check is due.", change_unconfirmed: "A roster change is waiting for you." };
const myAlerts = () => S.alerts.filter(a => !String(a.dedupe_key || "").startsWith("review|"));
function alertsCard() {
  return ""; // admin-task box removed for drivers: reminders come as the phone alert + beep; Today's tasks shows what is open
  const list = myAlerts(); if (!list.length) return "";
  return `<div class="card hot"><h2>Admin tasks<span>${list.length}</span></h2><div class="list">${list.map(a => `<div class="item ${a.kind.includes("missed") || a.kind === "sod_missing" ? "crit" : "warn"}"><b>${esc(a.title)}</b>${a.body ? `<div class="meta">${esc(a.body)}</div>` : ""}<div class="m">${ago(a.created_at)}</div><div class="row" style="margin-top:6px"><button class="btn sm" data-alertv="${a.id}">What to do</button>${S.viewAs && !S.viewer?.isStaff ? "" : `<button class="btn ghost sm" data-gotit-alert="${a.id}">Got it${S.viewAs ? " (for " + esc(first(S.viewAs.name)) + ")" : ""}</button>`}</div></div>`).join("")}</div></div>`;
}
function messagesCard() {
  const unread = S.msgs.filter(m => !m.read_at); const toConfirm = S.msgs.filter(m => m.messages.needs_confirm && !m.confirmed_at);
  const show = S.msgs.slice(0, 5); if (!show.length) return "";
  const pending = unread.length + toConfirm.length; // open while something needs reading or confirming, collapsed once all are responded to
  return `<div class="card ${toConfirm.length ? "warnc" : ""}" id="msgs" data-fold-open="${pending ? 1 : 0}" data-fold-key="msgs${pending ? 1 : 0}"><h2>Messages<span>${toConfirm.length ? `${toConfirm.length} to confirm` : unread.length ? `${unread.length} new` : ""}</span></h2>
    <div class="list">${show.map(m => `<div class="item clk ${m.messages.needs_confirm && !m.confirmed_at ? "warn" : m.confirmed_at || (m.read_at && !m.messages.needs_confirm) ? "done" : m.read_at ? "" : "accent"}" data-msgv="${m.message_id}"><div class="m">${esc(first(S.people[m.messages.sender]?.name || "Jeremy"))} · ${fmtTs(m.messages.created_at)}${m.confirmed_at ? ` · <span class="c-ok">✓ confirmed</span>` : ""}</div><div style="white-space:pre-wrap">${esc(m.messages.body)}</div>${m.messages.needs_confirm && !m.confirmed_at ? `<button class="btn sm" data-confirm="${m.message_id}">Got it</button>` : ""}</div>`).join("")}</div>
    ${S.msgs.length > 5 ? `<details><summary>Older messages</summary><div class="list" style="margin-top:8px">${S.msgs.slice(5).map(m => `<div class="item clk" data-msgv="${m.message_id}"><div class="m">${fmtTs(m.messages.created_at)}</div><div style="white-space:pre-wrap">${esc(m.messages.body)}</div></div>`).join("")}</div></details>` : ""}</div>`;
}

/* ---------- Today / next shift ---------- */
// CAROSE (Carey's Bay / Roseneath) on a day splits West Harbour: PCB becomes Port only, RSB becomes SB only
const scopeOf = (code, day) => S.caroseDays?.has(day) ? ({ PCB: "Port only", RSB: "SB only" })[code] || "" : "";
const runNameDay = (code, day) => { const sc = scopeOf(code, day); return runName(code) + (sc ? ` · ${sc}` : ""); };
function runName(code) { const r = S.runsBy[code]; const fc = S.C.runCodes[code]; return r ? `${r.name}${fc ? ` (${fc})` : ""}` : code; }
const VAN_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 6.5A1.5 1.5 0 0 1 4.5 5H14l4.2 4.2H20a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1h-1.3a2.5 2.5 0 0 1-4.9 0H9.7a2.5 2.5 0 0 1-4.9 0H4a1 1 0 0 1-1-1V6.5Zm10.6.5H5v4h12.2L13.6 7ZM7.25 18a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm9.5 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/></svg>`;
const vanChips = D => [...new Set(D.segs.map(x => x.shift.van).filter(Boolean))].map(p => `<span class="tag van">${VAN_SVG}${esc(p)}</span>`).join("");
function segRow(x, day, n, isToday, tasks = true) {
  const code = x.shift.run; const r = S.runsBy[code];
  if (!tasks) { const act = isToday ? segActions(x, day, n) : ""; const one = (S.days[day]?.segs.length || 0) < 2; return `<div class="seg clk" data-dayv="${day}" title="Tap for the full day">${one ? "" : `<div class="tm">${fmtT(x.st)}–${fmtT(x.en)}</div>`}<div class="rn">${x.sort ? (x.lab ? esc(x.lab) : `Sort: ${esc(r?.name || r?.label || "Sort")}`) : `${esc(code)}: ${esc(runNameDay(code, day))}`}${x.shift.trainee ? ` <span class="tag tr">training ${esc(first(S.people[x.shift.trainee]?.name || ""))}</span>` : ""}${act}</div></div>`; }
  const tags = [x.shift.van ? `<span class="tag van"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 6.5A1.5 1.5 0 0 1 4.5 5H14l4.2 4.2H20a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1h-1.3a2.5 2.5 0 0 1-4.9 0H9.7a2.5 2.5 0 0 1-4.9 0H4a1 1 0 0 1-1-1V6.5Zm10.6.5H5v4h12.2L13.6 7ZM7.25 18a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm9.5 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/></svg>${esc(x.shift.van)}</span>` : "", x.shift.trainee ? `<span class="tag tr">training ${esc(first(S.people[x.shift.trainee]?.name || ""))}</span>` : "", ...(tasks ? (x.shift.addons || []).map(a => `<span class="tag">+ ${esc(addName(a))}</span>`) : [])].join("");
  const tw = x.sort || !tasks ? "" : timingRows(x, day, isToday ? n.min : null);
  const act = isToday ? segActions(x, day, n) : "";
  return `<div class="seg clk" data-dayv="${day}" title="Tap for the full day"><div class="tm">${fmtT(x.st)} – ${fmtT(x.en)}</div><div class="rn">${x.sort ? esc(x.lab || r?.label || "Sort") : `${esc(code)}<span class="sub">${esc(runNameDay(code, day))}</span>`}<div class="tags">${tags}</div>${tw}${act}</div></div>`;
}
function rulesFor(x, day) {
  const code = x.shift.run; const d = dow(day) + 1; const out = [];
  for (const r of S.rules) {
    if (!r.days.includes(d)) continue;
    const all = r.runs.includes("ALL"); if (!all && !r.runs.includes(code)) continue;
    const ad = r.addon ? S.addons.find(a => a.id === r.addon) : null;
    if (ad?.always && ad.since && day < ad.since) continue;   // standing task that starts later (addons.since)
    if (ad?.always && ad.runs.includes(code)) { out.push(r); continue; }   // standing task: on every one of its runs, no ticking needed
    if (ad && ad.runs.includes(code)) { if (!(x.shift.addons || []).includes(r.addon) && !meetOn(r, x.shift)) continue; }
    else if (!all && r.runs.length > 1) continue;
    out.push(meetRule(r, x.shift));
  }
  const LAST = ["tw_baynext"];   // Bay/NC photo always sits at the end of the list
  // a run's task order set by Jeremy (settings.taskSeq[run] = rule ids or add-on ids, in order); anything not listed goes after, by time
  const seq = S.set?.taskSeq?.[code] || []; const pos = r => { const i = seq.findIndex(k => k === r.id || k === r.addon); return i < 0 ? 1e6 : i; };
  return out.sort((a, b) => LAST.includes(a.addon) - LAST.includes(b.addon) || pos(a) - pos(b) || (toMin(a.closes) ?? toMin(a.opens) ?? 0) - (toMin(b.closes) ?? toMin(b.opens) ?? 0));
}
/* ⓘ on every add-on / task: what it is, when, the code, time allowed and how to tick it off */
function taskInfo(key, title, desc, time, code) {
  const ad = key ? S.addons.find(a => a.id === key) : null; const r = key ? S.rules.find(z => (z.done_key || z.addon) === key) : null;
  const note = desc || r?.note || ""; const when = time || (r ? winTxt(r) : "");
  const how = key === BAYVAN ? "Tap 📷 Photos and take two photos (your bay and your van), then add your notes. That ticks it off."
    : key === MAIL_KEY ? "Tap 📷 Photos to photograph the mail trays, or Nil if there's no mail." : puAreaOf(key) ? "Tap Enter to put in the pick-ups, or None if there weren't any."
    : ad?.photo ? "Tap 📷 Photo and take the photo. That ticks it off." : "Tap Done when it's done. Tap it again to undo.";
  const k = "t_" + String(key || title).replace(/[^\w]/g, "_");
  INFO[k] = [title || ad?.name || key, `${note ? `<p>${esc(note)}</p>` : ""}${when && when !== "any time" ? `<p><b>When:</b> ${esc(when)}</p>` : ""}${code || r?.code ? `<p><b>Code:</b> ${esc(code || r.code)}</p>` : ""}${ad?.minutes ? `<p><b>Time allowed:</b> ${ad.minutes} min on the run</p>` : ""}<p>${how}</p><p class="meta">Every task has to be ticked off, or marked Not done, before you can send the run's EOD.</p>`];
  return ib(k);
}
function winTxt(r) { const f = toMin(r.opens), t = toMin(r.closes); return f != null && t != null ? `${fmtT(f)} – ${fmtT(t)}` : t != null ? `by ${fmtT(t)}` : f != null ? `from ${fmtT(f)}` : "any time"; }
/** Every timed task on a run, each with its own Done button on the day (what Jeremy's Alerts and "Timings today" read). */
function timingRows(x, day, nowMin) {
  const isT = nowMin != null; const rules = rulesFor(x, day); if (!rules.length) return "";
  const rows = rules.map(r => { const f = toMin(r.opens), t = toMin(r.closes); const key = r.done_key || r.addon; const done = key ? x.shift.done?.[key] : null; const gp = !!key?.startsWith("tw_") && /game plan/i.test(r.name); const planned = gp && Object.keys(x.shift.plan || {}).length > 0; let st = "", cls = "", tag = "";
    if (done) { st = `✓ done ${fmtTime(done)}`; cls = "done"; }
    else if (gp && planned) { st = "✓ game plan in"; cls = "done"; }
    else if (isT) { if (t != null && nowMin > t) { st = `✗ not done by ${fmtT(t)}`; cls = "miss"; } else if (f != null && nowMin >= f) { tag = "now"; cls = "now"; } else if (t != null && t - nowMin <= 60) { tag = "due soon"; cls = "now"; } }
    else if (day < today() && key) { st = `✗ not marked done`; cls = "miss"; }
    const btn = !(isT && key && !S.viewAs) ? "" : done ? `<div class="row" style="flex:0 0 auto;gap:6px">${puEditBtn(key, x.shift.day)}<button class="btn sm" data-done="${esc(key)}" data-undo="1" data-shift="${x.shift.id}" title="Tap again to undo" style="flex:0 0 auto;min-height:34px">✓ Done</button></div>` : isPhotoTask(key) ? rsBtn(x.shift.id, key) : puAreaOf(key) ? `<div class="row" style="flex:0 0 auto;gap:6px">${puBtn(key, x.shift.id)}${noneBtn(key, x.shift.id)}</div>` : !(gp && planned) ? `<button class="btn sm ${cls === "miss" ? "warn" : "ghost"}" data-done="${esc(key)}" data-shift="${x.shift.id}" style="flex:0 0 auto;min-height:34px">Done</button>` : "";
    const when = done ? `✓ ${fmtTime(done)}` : gp && planned ? "✓ plan" : cls === "miss" ? `✗ ${t != null ? fmtT(t) : "not done"}` : winTxt(r) === "any time" ? "" : winTxt(r);
    return `<div class="tw-r ${cls}"><div class="w">${when}${tag ? `<span class="tw-tag">${tag}</span>` : ""}</div><div class="tw-l"><span class="n">${esc(r.short || r.name)}${taskInfo(key, r.name, r.note, winTxt(r), r.code)}</span>${r.code ? `<span class="tw-code">🔑 ${esc(r.code)}</span>` : ""}</div>${btn}</div>`; });
  return `<div class="tw"><h4>${isT ? "Tasks today" : "Tasks"}</h4>${rows.join("")}</div>`;
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
    const DS = showSegs(T); const left = DS.filter(x => n.min < (x.en ?? x.st));
    const sodSeg = T.segs.find(x => x.sod); const allEod = T.segs.filter(x => !x.sort).length ? T.segs.filter(x => !x.sort).every(x => x.eod) : T.segs.some(x => x.eod);
    if (left.length || (!allEod && sodSeg)) {
      const sodBtn = !sodSeg ? ""
        : `${allEod ? "" : `<div class="row"><button class="btn ghost sm" id="sod-edit" data-shift="${sodSeg.shift.id}" style="flex:0 0 auto">Edit SOD</button></div>`}${sodReqLine(T)}`;
      const sortOnly = !T.segs.some(x => !x.sort) && sodSeg && !allEod;
      // once the day has started (SOD in), Today shrinks to two rows; tap to see the full day again
      if (sodSeg && !S.todayFull) { const cur = left[0] || DS[DS.length - 1]; const nxt = left[1];
        const nm = x => x.sort ? (x.lab || S.runsBy[x.shift.run]?.label || "Sort") : sortCode(x.shift.run);
        return `<div class="card today tdmini" id="today-mini" role="button" tabindex="0" aria-expanded="false" title="Tap for the full day">
          <div class="tdr1"><b>Today</b><span class="big">${fmtT((left[0] || T.segs[0]).st)}–${fmtT(T.end)}</span>${vanChips(T)}<i class="fchev" aria-hidden="true"></i></div>
          <div class="tdr2 meta">${stageLine(T) || `Now <b>${esc(nm(cur))}</b> till ${fmtT(cur.en)}${nxt ? ` · next <b>${esc(nm(nxt))}</b> ${fmtT(nxt.st)}` : ""}`}${S.locOn ? " · 📍" : ""}</div></div>`; }
      return `<div class="card today${sodSeg ? " " : ""}" ${sodSeg ? `id="today-full"` : ""}><h2>Today<span>${label(T.day)}${sodSeg ? ` <button class="btn ghost sm" id="today-less" type="button" style="min-height:28px;padding:2px 10px">Less ▴</button>` : ""}</span></h2><div class="big bigrow"><span>${fmtT((left[0] || T.segs[0]).st)}–${fmtT(T.end)}</span>${vanChips(T)}</div>${stageLine(T) ? `<p class="meta" style="margin:0">${stageLine(T)}</p>` : ""}
        ${sodBtn}${(left.length ? left : DS).map(x => segRow(x, T.day, n, true, false)).join("")}
</div>`;
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
    const what = works ? (x.bu_kind === "committed" ? `committed${x.bu_block ? `, up to ${x.bu_block}h` : ""}` : "optional") + (S.days[x.day].start >= 720 ? " · phone 6:30–7:30am" : "") : "phone 6:30–7:30am";
    return `<div class="bu"><div class="meta"><b>${kind}</b> · ${dayTag(x.day)} · ${what}</div></div>`;
  }).join("");
  return `<section class="ns"><h3 class="sub lbl">Back-up and on-call ${ib("backup")}</h3>${rows}</section>`;
}
function nextShiftCard(N, n) {   // one box: shift, tasks, vehicle, split by grey lines
  if (!N) return `<div class="card nextc" id="nextshift"><h2>Next shift<span>not on the roster yet</span></h2>${buSection(n)}</div>`;
  return `<div class="card nextc" id="nextshift" data-fold-open="${S.dayDone ? 1 : 0}"><h2>Next shift<span>${N.day === addDays(today(), 1) ? "Tomorrow" : label(N.day)} · ${fmtT(N.start)}–${fmtT(N.end)}</span></h2>
    <section class="ns"><div class="bigrow">${vanChips(N)}</div>${showSegs(N).map(x => segRow(x, N.day, n, false, false)).join("")}</section>
    <section class="ns"><h3 class="sub">Vehicle</h3>${vanInner(N)}</section>${buSection(n)}</div>`;
}
/* ---------- Van use: who is on which van for RAM, TUA and Flyer (shown only to people ticked in the owner portal) ---------- */
const VAN_USE_RUNS = ["RAM", "TUA", "FLY"];
function vanUse(set) { const v = set?.van_use; const id = S.me?.id; return v && (v.people || []).includes(id) ? { runs: v.runs?.length ? v.runs : VAN_USE_RUNS } : null; }
function vanUseCard() {
  if (!S.vanUse) return "";
  const runs = vanUse(S.set)?.runs || VAN_USE_RUNS; const t = today();
  const days = [...new Set(S.vanUse.map(s => s.day))].sort().slice(0, 3); if (!days.includes(t)) days.unshift(t); const shown = days.slice(0, 3);
  const nm = id => id ? esc(first(S.people[id]?.name || id)) : `<span class="c-crit">unassigned</span>`;
  const rl = c => esc(S.runsBy[c]?.label || S.runsBy[c]?.name || c);
  const block = d => { const rows = runs.map(r => { const ss = S.vanUse.filter(s => s.day === d && s.run === r); if (!ss.length) return ""; return ss.map(s => {
      return `<tr><td><b>${rl(r)}</b>${s.start_at ? `<div class="meta">${fmtT(toMin(s.start_at))}</div>` : ""}</td><td>${nm(s.driver)}${s.trainee ? `<div class="meta">+ ${nm(s.trainee)}</div>` : ""}</td><td>${s.van ? `<button class="plate clk" data-vanv="${esc(s.van)}" style="background:none;cursor:pointer">${esc(s.van)}</button>` : `<span class="c-crit">no van</span>`}</td></tr>`; }).join(""); }).join("");
    return `<div class="meta mono" style="margin:8px 0 4px">${d === t ? "TODAY" : esc(label(d)).toUpperCase()}</div>${rows ? `<table class="dt"><tr><th>Run</th><th>Driver</th><th>Van</th></tr>${rows}</table>` : `<p class="hint" style="margin:0">Nothing rostered.</p>`}`; };
  return `<div class="card" id="vanuse"><h2>Van use<span>${runs.map(rl).join(" · ")}</span></h2>${shown.map(block).join("")}</div>`;
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
`;
}
function shiftsCard(t) {
  const mon = monOf(t); const nextMon = addDays(mon, 7);
  const trOf = d => (S.trainee || []).filter(s => s.day === d);
  const trTxt = s => { const w = first(S.people[s.driver]?.name || ""); const m = (s.note || "").match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i); return { t: `Training · ${esc(s.run)}${w ? ` with ${esc(w)}` : ""}${s.van ? ` · ${esc(s.van)}` : ""}`, h: m ? `${m[1]}–${m[2]}` : `${fmtT(toMin(s.start_at))}–${fmtT(toMin(s.end_at))}` }; };
  const has = d => !!S.days[d] || trOf(d).length > 0;
  const row = d => { const D = S.days[d]; const hol = S.C.holidays[d]; const isT = d === t; const tr = trOf(d).map(trTxt);
    const own = D ? D.segs.map(x => x.sort ? esc(S.runsBy[x.shift.run]?.label || "Sort") : `${esc(x.shift.run)}${x.shift.van ? ` · ${esc(x.shift.van)}` : ""}`).join(" → ") : "";
    const txt = hol ? esc(hol.name) : [own, ...tr.map(z => z.t)].filter(Boolean).join(" → ") || "Off";
    const hrs = D ? `${fmtT(D.start)}–${fmtT(D.end)}` : tr.map(z => z.h).join(", ");
    return `<div class="day ${D ? "clk" : tr.length ? "" : "off"} ${isT ? "todayrow" : ""}" ${D ? `data-dayv="${d}" title="Tap for the detail"` : ""}><div class="dl">${label(d).slice(0, 6)}</div><div>${txt}</div><div class="dh">${hrs}</div></div>`; };
  const thisW = []; for (let d = addDays(t, 1); d < nextMon; d = addDays(d, 1)) thisW.push(d);
  const nextW = []; for (let d = nextMon; d < addDays(nextMon, 7); d = addDays(d, 1)) nextW.push(d);
  const nShifts = nextW.filter(has).length; const rosterOut = S.shifts.some(s => s.day >= nextMon) || nShifts > 0;
  const lastW = []; for (let d = addDays(mon, -7); d < mon; d = addDays(d, 1)) lastW.push(d); const earlier = []; for (let d = mon; d <= t; d = addDays(d, 1)) earlier.push(d);
  return `<div class="card"><h2>My shifts</h2>${earlier.length ? `<details><summary>Earlier this week<span class="meta">${earlier.filter(has).length} shift${earlier.filter(has).length === 1 ? "" : "s"}</span></summary>${earlier.map(row).join("")}</details>` : ""}<div class="meta mono">This week</div>${thisW.length ? thisW.map(row).join("") : `<div class="day off"><div class="dl"></div><div>Nothing left this week</div><div></div></div>`}
    <details><summary>Next week<span class="meta">${rosterOut ? `${nShifts} shift${nShifts === 1 ? "" : "s"}` : "roster not out yet"}</span></summary>${nextW.map(row).join("")}</details>
    <details><summary>Last week<span class="meta">${lastW.filter(has).length} shift${lastW.filter(has).length === 1 ? "" : "s"}</span></summary>${lastW.map(row).join("")}</details></div>`;
}

/* ---------- Add-ons (beside the shift: one button per add-on, tap = done) ---------- */
function runSegOf(D) { return D && D.segs.filter(x => (!x.sort || x.shift.addons?.length) && (S.addons.some(a => a.runs.includes(x.shift.run)) || x.shift.addons?.length || rulesFor(x, D.day).length)); }
function addonsCard(T, N, n) {   // today's tasks, only while today's run is still going
  const rs = runSegOf(T); const openTask = !!T && !!rs?.some(x => rulesFor(x, T.day).some(r => r.addon && !(x.shift.done || {})[r.done_key || r.addon])); const runs = T ? T.segs.filter(x => !x.sort) : []; const eodIn = !!T && (runs.length ? runs.every(x => x.eod) : T.segs.some(x => x.eod));
  const done = !T || !rs?.length;   // always there on a day with tasks (done ones green); folds up
  return done ? "" : tasksCard(T, n, false);
}
function nextTasksCard(N, n) {   // tasks for the next shift (tomorrow when rostered), grey side bar
  if (!N) return `<div class="card nextc"><h2>Next tasks</h2><p class="hint">Your tasks show here once your next shift is on the roster.</p></div>`;
  return tasksCard(N, n, true);
}
/** short label for a done tile: the add-on's own short name, else the title cut down to a couple of words */
function tkShort(key, title) {
  const a = key && S.addons.find(o => o.id === key); const sh = a?.short || ""; const whole = sh && sh.length <= 12 && (title || "").startsWith(sh) && [undefined, " "].includes((title || "")[sh.length]);   // ignore short names cut off mid-word
  let t = (whole ? sh : title || "").replace(/^D>B\s*-\s*/i, "").replace(/\bphoto\b/i, "📷").trim();
  if (t.length > 12) { const w = t.split(/\s+/); t = w.length > 1 ? (w[0].length <= 9 ? w[0] + " " + w.slice(1).map(x => x[0].toUpperCase()).join("") : w.map(x => x[0].toUpperCase()).join("")) : t.slice(0, 11) + "."; }
  return t;
}
function tasksCard(D, n, next, bare = false) {
  const isT = !next && D.day === n.date;
  const sat = dayName(D.day) === "Sat";
  const blocks = (runSegOf(D) || []).map(x => {
    const code = x.shift.run; const opts = S.addons.filter(a => a.runs.includes(code) && !(sat && a.no_saturday) && !a.id.startsWith("tw_"));
    const on = new Set(x.shift.addons || []); const plan = x.shift.plan || {}; const done = x.shift.done || {};
    // one list: every timed task on the run, then any add-on that has no timed task of its own
    const items = []; const covered = new Set();
    for (const r of rulesFor(x, D.day)) { const key = r.done_key || r.addon || null; if (r.addon) covered.add(r.addon); const gp = !!key?.startsWith("tw_") && /game plan/i.test(r.name); const planned = gp && Object.keys(plan).length > 0;
      const meetEdit = code === "DB" && key === "milton";   // D>B driver sets the day's Milton drop-off time; it goes to the Lawrence driver
      items.push({ key, title: r.name, short: r.short, code: r.code, desc: meetEdit ? `${r.note || ""} Tap 📍 to pick Milton or Balclutha and the time; the Lawrence driver gets it straight away.`.trim() : r.note || (key && !key.startsWith("tw_") ? (S.addons.find(a => a.id === key)?.name || "") : ""), time: winTxt(r), opens: toMin(r.opens), closes: toMin(r.closes), doneAt: key ? done[key] : null, planned, meetEdit, meetVal: String(x.shift.milton_at || r.closes || "").slice(0, 5) }); }
    for (const id of x.shift.addons || []) { if (covered.has(id)) continue; const o = S.addons.find(a => a.id === id); if (!o) continue;   // tw_ tasks without a timed rule (e.g. NZQA pick up) show here too
      items.push({ key: id, title: o.name, desc: plan[id] ? `planned ${fmtT(toMin(plan[id]))}` : o.minutes ? `${o.minutes} min allowed on the run` : "add-on on this run", time: "any time", opens: null, closes: null, doneAt: done[id], planned: false }); }
    { const seq = S.set?.taskSeq?.[code] || []; if (seq.length) { const pos = t => { const i = seq.indexOf(t.key); return t.key === "tw_baynext" ? 2e6 : t.key === "tw_scanreport" ? 1.5e6 : i < 0 ? 1e6 : i; }; items.sort((a, b) => pos(a) - pos(b)); } }   // set order, extra add-ons (Waihola, NZQA) slotted in too
    const nDone = items.filter(t => t.doneAt || t.planned).length;
    const row = t => { const isDone = !!(t.doneAt || t.planned); let cls = "", st = "";
      if (isDone) { cls = "ok"; st = t.doneAt ? `✓ done ${fmtTime(t.doneAt)}` : "✓ game plan in"; }
      else if (isT && t.key === "tw_twrunsheet" && x.st != null) { const el = n.min - x.st;   // runsheet photo: orange once the run starts, red 45 min in
        if (el >= 45) { cls = "over"; st = "overdue · 45 min into the run"; } else if (el >= 0) { cls = "late"; st = `run started · ${45 - el} min left`; } else { cls = "pend"; st = "not done yet"; } }
      else if (isT) { if (t.closes != null && n.min > t.closes) { cls = "over"; st = `overdue · was due ${fmtT(t.closes)}`; } else if (t.closes != null && t.closes - n.min <= 15) { cls = "soon"; st = `due in ${t.closes - n.min} min`; } else { cls = "pend"; st = "not done yet"; } }
      const pu = puAreaOf(t.key); const btn = isT && !isDone && t.key && (!S.viewAs || S.viewer?.isStaff) ? (isPhotoTask(t.key) ? rsBtn(x.shift.id, t.key) : pu ? `<div class="row" style="flex:0 0 auto;gap:6px">${puBtn(t.key, x.shift.id)}${noneBtn(t.key, x.shift.id)}</div>` : `<button class="btn sm accent" data-done="${esc(t.key)}" data-shift="${x.shift.id}">Done</button>`) : isT && isDone && pu && !S.viewAs ? puEditBtn(t.key, x.shift.day) : "";
      const meet = t.meetEdit && !isDone && D.day >= n.date && (!S.viewAs || S.viewer?.isStaff) ? `<button type="button" class="btn sm ghost" style="flex:0 0 auto;min-height:34px" data-meetset="${x.shift.id}" title="Set where and when to meet the Lawrence driver">📍 ${x.shift.milton_at ? `${esc(x.shift.meet_place === "Balclutha" ? "Bal" : "Mil")} ${fmtT(toMin(t.meetVal))}` : "Set"}</button>` : "";
      const when = t.key === "tw_twrunsheet" && (cls === "over" || cls === "late") ? (cls === "over" ? "✗ 45 min" : `${45 - (n.min - x.st)} min`) : cls === "over" ? `✗ ${fmtT(t.closes)}` : cls === "soon" ? `${t.closes - n.min} min` : t.time === "any time" ? "" : t.time;
      return `<div class="tk tk1 ${cls}"><div class="tkt"><span class="t">${esc(t.short || tkShort(t.key, t.title))}${taskInfo(t.key, t.title, t.desc, t.time, t.code)}</span>${when ? `<span class="tkw">${esc(when)}</span>` : ""}${t.code ? `<span class="tkc">🔑 ${esc(t.code)}</span>` : ""}</div>${meet}${btn}</div>`; };
    return `<div class="ablk"><div class="row" style="justify-content:space-between"><b style="font-size:16px">${esc(code)}</b><span class="meta">${items.length && isT ? `${nDone}/${items.length} done` : ""}</span></div>${isT ? estLine(x, D) : ""}
      ${items.length ? (() => { const isDone = t => !!(t.doneAt || t.planned); const todo = items.filter(t => !isDone(t)), fin = items.filter(isDone);
        // pick-ups not done yet sit together at the top of the list (Owaka Rural, Owaka Town, …)
        const isPu = t => !!puAreaOf(t.key); if (!(S.set?.taskSeq?.[code] || []).length) todo.sort((a, b) => isPu(b) - isPu(a));   // a run with a set order keeps it
        // done ones shrink into half-height tiles with a short name; tap a tile to undo (pick-up tiles open the pick-up editor instead)
        const tile = t => { const pu = puAreaOf(t.key); const can = isT && t.key && !t.planned && (!S.viewAs || S.viewer?.isStaff);
          const puOk = pu && puAreaLines(pu, x.shift.day).length; const attrs = !can ? "" : pu ? (puOk ? `data-puarea="${esc(pu)}" data-puday="${x.shift.day}"` : "") : `data-done="${esc(t.key)}" data-undo="1" data-shift="${x.shift.id}"`;
          return `<button type="button" class="tkd" ${attrs} ${attrs ? `title="${esc(t.title)} · tap to ${pu ? "edit" : "undo"}"` : `title="${esc(t.title)}" disabled`}><b>${esc(tkShort(t.key, t.title))}</b><small>✓ ${t.doneAt ? fmtTime(t.doneAt) : "plan in"}</small></button>`; };
        return `${todo.length ? `<div class="tks">${todo.map(row).join("")}</div>` : ""}${fin.length ? `<div class="tkds">${fin.map(tile).join("")}</div>` : ""}`; })() : `""`}
      <details class="abmore"><summary>Change run add-ons</summary><div class="list" style="margin-top:6px">${opts.map(o => { const isOn = on.has(o.id); const rule = S.rules.find(r => r.addon === o.id);
        return `<div class="row" style="align-items:center"><label class="chk ${isOn ? "on" : ""}" style="flex:1 1 60%"><input type="checkbox" data-addon="${o.id}" data-shift="${x.shift.id}" ${isOn ? "checked" : ""}>${esc(o.name)}${rule ? `<span class="meta" style="margin-left:auto">${winTxt(rule)}</span>` : ""}</label>${taskInfo(o.id, o.name, rule?.note, rule ? winTxt(rule) : "", rule?.code)}
          ${o.task && isOn ? `<input class="in" type="time" step="900" style="flex:0 0 120px;min-height:40px" value="${esc(plan[o.id] || "")}" data-plan="${o.id}" data-shift="${x.shift.id}" aria-label="Planned time for ${esc(o.name)}">` : ""}</div>`; }).join("")}</div>
</details></div>`;
  }).join("");
  if (bare) return `<h3 class="sub">Tasks</h3>${blocks || `<p class="hint">Nothing extra on this shift.</p>`}`;
  // Tasks opens while something is still to do, and closes on its own once everything is done (or there's nothing on)
  const left = isT ? (runSegOf(D) || []).reduce((a, x) => a + rulesFor(x, D.day).filter(r => { const k = r.done_key || r.addon; const planned = !!k?.startsWith("tw_") && /game plan/i.test(r.name) && Object.keys(x.shift.plan || {}).length > 0; return k && !planned && !(x.shift.done || {})[k]; }).length + (x.shift.addons || []).filter(id => !rulesFor(x, D.day).some(r => r.addon === id) && !(x.shift.done || {})[id]).length, 0) : 0;
  return `<div class="card${next ? " nextc" : ""}" ${isT ? `id="tasks" data-fold-open="${left ? 1 : 0}" data-fold-key="tasks${left ? 1 : 0}"` : ""}><h2>${isT ? "Tasks" : "Next tasks"}${isT ? "" : `<span>${dayTag(D.day)}</span>`}</h2>
    ${blocks || `<p class="hint">Nothing extra on this shift.</p>`}</div>`;
}

/* ---------- Scores ---------- */
function scoreRanges() { // this week (Mon–Sun) and this month, side by side
  const t = today(); const mon = monOf(t);
  const first = t.slice(0, 8) + "01"; const d = new Date(first + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return { week: { from: mon, to: addDays(mon, 6), l: "This week" }, month: { from: first, to: d.toISOString().slice(0, 10), l: "This month" } };
}
function scoresCard() {
  const RG = scoreRanges(); const D = dataFor();
  const SC = { week: scoreFor(S.me.id, RG.week.from, RG.week.to, D, S.C), month: scoreFor(S.me.id, RG.month.from, RG.month.to, D, S.C) };
  S.sc = SC.month; S.F = RG.month; S.SC = SC; S.RG = RG;                       // To fix and the day sheets read the month (it covers the week)
  const [selK, selR] = (S.scSel || "").split("|");
  const half = (k, r) => { const v = SC[r][k]; return `<button class="half ${selK === k && selR === r ? "sel" : ""}" data-sc="${k}|${r}"><div class="l">${RG[r].l}</div><div class="v c-${col(v)}">${pct(v)}</div><div class="bar"><i class="bg-${col(v)}" style="width:${Math.min(100, v || 0)}%"></i></div></button>`; };
  const sub = k => `<button class="half sub ${selK === k && selR === "month" ? "sel" : ""}" data-sc="${k}|month"><span class="l">${RG.month.l}</span><span class="v">${pct(SC.month[k])}</span></button>`; // month sits under the week, in grey
  const tile = (k, l) => `<div class="tile dual"><div class="l">${l} ▾</div><div class="halves">${half(k, "week")}${sub(k)}</div></div>`;
  const sc = SC.week; const line = [`${sc.onTime} of ${sc.closed} posts on time this week`, sc.late ? `${sc.late} late` : "", sc.missing ? `${sc.missing} missing` : "", sc.nMist ? `${sc.nMist} mistake${sc.nMist === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  const fresh = !SC.month.closed && !SC.month.effDays.length && !SC.month.accDays.length && RG.week.from < S.C.rules.startDate;
  return `<div class="card" id="scores"><h2>My scores ${ib("scores")}<span>week of ${label(RG.week.from)} · ${new Date(RG.month.from + "T12:00:00Z").toLocaleString("en-NZ", { month: "long", timeZone: "UTC" })}</span></h2>
    ${fresh ? `<p class="meta">Scores start ${label(S.C.rules.startDate)}.</p>` : ""}
    <div class="tiles" style="grid-template-columns:1fr 1fr">${tile("admin", "Admin")}${tile("eff", "Efficiency")}${tile("acc", "Accuracy")}${tile("safe", "Safety")}</div>
    <div class="meta">Overall <b class="c-${col(SC.week.overall)}">${pct(SC.week.overall)}</b> this week · <b class="c-${col(SC.month.overall)}">${pct(SC.month.overall)}</b> this month · ${line} · tap a score to see the figures</div>
    ${selK && SC[selR] ? `<div class="meta mono" style="text-transform:uppercase">${RG[selR].l} · ${label(RG[selR].from)} – ${label(RG[selR].to)}</div>${scoreDetail(SC[selR], selK)}` : ""}
    ${historyBlock()}</div>`;
}
function dataFor() { return { leave: S.leave || [], extra: S.extra || [], shifts: S.shifts, sods: S.sods, eods: S.eods, marks: S.marks, entries: S.entries, feed: S.feed, runsBy: S.runsBy, ovs: S.ovs, breaks: S.breaks || [], effBreakFor: S.me.pay_exclude ? [S.me.id] : [] }; }
function scoreAt(from, to) { return scoreFor(S.me.id, from, to, dataFor(), S.C); }
function historyBlock() {
  const t = today(); const weeks = Array.from({ length: 6 }, (_, i) => addDays(monOf(t), -7 * i)).map(w => ({ w, s: scoreAt(w, addDays(w, 6)) })).filter(x => x.s.closed || x.s.effDays.length || x.s.accDays.length);
  if (!weeks.length) return "";
  return `<details style="border-top:1px solid var(--line);padding-top:8px"><summary>History by week<span class="meta">tap a week</span></summary><div class="scroll"><table class="dt"><tr><th>Week of</th><th>On time</th><th>Admin</th><th>Eff</th><th>Acc</th><th>Overall</th></tr>${weeks.map(({ w, s }) => `<tr class="clk" data-weekv="${w}"><td>${label(w)}</td><td class="num">${s.closed ? `${s.onTime}/${s.closed}` : "—"}</td><td class="c-${col(s.admin)}">${pct(s.admin)}</td><td class="c-${col(s.eff)}">${pct(s.eff)}</td><td class="c-${col(s.acc)}">${pct(s.acc)}</td><td class="c-${col(s.overall)}"><b>${pct(s.overall)}</b></td></tr>`).join("")}</table></div></details>`;
}
function scoreDetail(sc, k) {
  const R = S.C.rules; const tbl = (head, rows) => rows.length ? `<div class="scroll"><table class="dt"><tr>${head.map(x => `<th>${x}</th>`).join("")}</tr>${rows.join("")}</table></div>` : "";
  let body = "";
  if (k === "admin") { const rows = sc.items.filter(i => !["due", "wait"].includes(i.st)).sort((a, b) => a.day.localeCompare(b.day)).map(i => `<tr class="clk" data-postv="${esc(i.key)}"><td>${label(i.day)}</td><td>${esc(i.label)}<div class="meta">${itemNote(i)}</div></td><td>${pill(STATE_LABEL[i.st], i.st === "ok" || i.st === "wait" ? "ok" : i.st === "miss" || i.st === "late" ? "crit" : i.st === "exc" ? "accent" : ["due", "over", "lsub"].includes(i.st) ? "grey" : "warn")}</td></tr>`);
    body = `${tbl(["Day", "Post", "Result"], rows) || `<p class="empty">No posts counted for these days. Posts count from ${label(R.adminStart)}.</p>`}${sc.adj ? `<p class="meta">Adjustments from Jeremy: ${sc.entries.filter(e => e.admin_pts).map(e => `${label(e.day)} ${e.admin_pts > 0 ? "+" : ""}${e.admin_pts} (${esc(e.title)})`).join(", ")}</p>` : ""}`; }
  if (k === "eff") { const rows = sc.effDays.filter(e => !e.pending).map(e => `<tr class="clk" data-effv="${e.day}"><td>${label(e.day)}</td><td>${e.manual ? "set by Jeremy" : e.rows.map(r => r.code).join(" + ")}</td><td class="num">${e.allowed ? (e.est ? "≈" : "") + e.allowed.toFixed(1) + " h" : ""}</td><td class="num">${e.taken ? e.taken.toFixed(1) + " h" : ""}</td><td class="c-${col(Math.min(100, e.v))}">${Math.round(e.v)}%${e.est ? " est" : ""}</td></tr>`);
    const pend = sc.effDays.filter(e => e.pending);
    body = `${tbl(["Day", "Run", "Expected", "Actual", "Score"], rows) || `<p class="empty">No finished runs with full figures on these days.</p>`}${pend.length ? `<p class="meta">Waiting on figures: ${pend.map(e => `<button class="linkbtn" data-effv="${e.day}">${label(e.day)} ${esc(e.need || "EOD")}</button>`).join(" · ")}</p>` : ""}${sc.effDays.some(e => e.est) ? `<p class="meta">≈ means a best guess was used for a missing EOD figure.</p>` : ""}`; }
  if (k === "acc") { const rows = sc.accDays.map(a => `<tr class="clk" data-accv="${a.day}|${esc(a.code)}"><td>${label(a.day)}</td><td>${esc(a.code)}</td><td class="num">${a.items}</td><td class="num">${a.compliant}</td><td class="c-${col(a.v)}">${a.v == null ? "—" : a.v.toFixed(1) + "%"}</td></tr>`);
    body = `${tbl(["Day", "Run", "Items", "Correct", "%"], rows) || `<p class="empty">No NZ Post report figures for your runs on these days.</p>`}${sc.nMist ? `<p class="meta">Mistakes: ${sc.mistakes.map(m => `<button class="linkbtn" data-entryv="${m.id}">${label(m.day)} ${esc(m.title)}</button>`).join(" · ")}</p>` : `<p class="meta">No mistakes logged. 👍</p>`}`; }
  if (k === "safe") { const rows = sc.entries.filter(e => e.safety_pct != null).map(e => `<tr class="clk" data-entryv="${e.id}"><td>${label(e.day)}</td><td class="num">${e.safety_pct}%</td><td>${esc(e.title)}</td></tr>`); body = `${tbl(["Day", "Score", "Note"], rows) || `<p class="meta">Nothing recorded. 👍</p>`}`; }
  return `<div style="border-top:1px solid var(--line);padding-top:8px">${body}</div>`;
}

/* ---------- To fix ---------- */
function toFixCard(n) {
  const its = (S.sc?.items || []).filter(i => ["late", "miss", "over"].includes(i.st) && !i.pre && needsFix(i, S.C));
  const pend = (S.sc?.effDays || []).filter(e => e.pending && e.need && !e.need.includes("EOD"));
  if (!its.length && !pend.length) return "";
  return `<div class="card warnc"><h2>To fix ${ib("tofix")}<span>${its.length + pend.length} to check</span></h2><div class="list">
    ${its.sort((a, b) => b.day.localeCompare(a.day)).map(i => `<div class="item warn clk" data-postv="${esc(i.key)}"><div class="m c-warn">${label(i.day)}</div><div>${esc(i.label)}: ${itemNote(i)}</div>${!i.row ? `<button class="btn sm ${i.kind === "SOD" ? "" : "accent"}" data-${i.kind === "SOD" ? "sod-late" : "eod"}="${i.shift.id}" data-day="${i.day}">Post it now</button>` : ""}</div>`).join("")}
    ${pend.map(e => `<div class="item warn clk" data-effv="${e.day}"><div class="m c-warn">${label(e.day)}</div><div>EOD figures missing: ${esc(e.need)}</div></div>`).join("")}</div></div>`;
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
  return `<div class="card"><h2>My details</h2><dl class="kv"><dt>Phone</dt><dd>${p.phone ? esc(p.phone) : pill("not on file", "grey")}</dd><dt>Email</dt><dd>${esc(p.email || "")}</dd><dt>Licence</dt><dd>${p.licence_class ? esc(p.licence_class) + " · " : ""}${d(p.licence_expiry)}</dd><dt>DG</dt><dd>${d(p.dg_expiry)}</dd><dt>Licence photos</dt><dd>${p.licence_front && p.licence_back ? pill("✓ front & back", "ok") : pill(p.licence_front || p.licence_back ? "one side missing" : "not on file", "warn")}</dd></dl>
    <button class="btn ghost sm" id="prof-edit">Update my details</button></div>`;
}
const PU_CUST = { NZC: "NZ Couriers", PH: "Post Haste", TGE: "TGE (NZ National Network)" };
// Runs that do invoiced pick-ups, and the area they're usually in
const PU_AREA = { TUA: "Rural", FLY: "Owaka Rural", DB: "Owaka Rural", LAW: "Lawrence Local" };   // Lawrence run = local Lawrence pick-ups; D>B's "Lawrence" = Dunedin depot (25 Nov 2026)
const PU_AREAS = ["Rural", "South", "Owaka Rural", "Owaka Town", "Lawrence", "Lawrence Local", "Balclutha"]; const PU_AREA_NAME = { Lawrence: "Lawrence · Dunedin depot (D>B)", "Lawrence Local": "Lawrence · local" }; const puAreaName = a => PU_AREA_NAME[a] || a; const puCust = a => a === "South" ? ["TGE"] : a === "Rural" ? ["NZC", "PH", "TGE"] : ["NZC", "PH"];   // South = TGE only; TGE also on Rural; never on Owaka / Lawrence / Balclutha
const PU_MIN = 2.5; const PU_MIN_AREA = "Balclutha";   // Balclutha depot, no parcels
const puLine = r => r.min_fee != null ? `none` : `${r.small} small${r.large ? ` + ${r.large} large` : ""}`;
async function puMinFee(day, shift, key) {
  const rows = ["NZC", "PH"].map(c => ({ day, area: PU_MIN_AREA, customer: c, source: "depot", small: 0, large: 0, min_fee: PU_MIN, note: "No parcels", driver: S.me.id, created_by: S.me.id }));
  const { error } = await sb.from("pickups").insert(rows); if (error) { toast(error.message, "err"); return false; }
  if (key && shift) { const { error: e2 } = await sb.rpc("task_done", { p_shift: shift, p_addon: key }); if (e2) toast(`Split fee saved, but the task couldn't be ticked: ${e2.message}`, "err"); }
  toast("No parcels saved ✓", "ok"); await loadAll(); render(); return true;
}
const PU_SRC = ["depot", "customer"]; const PU_SRC_L = { depot: "depot", customer: "customer" };
const puToday = T => (T?.segs || []).map(x => x.shift.run).find(r => PU_AREA[r]);
function pickupsCard(T) {
  if (S.viewAs) return "";
  const list = S.pickups || []; const run = puToday(T); const todays = list.filter(r => r.day === today());
  return `<div class="card" id="pickups"><h2>Parcel pick-ups ${ib("pickups")}<span>${todays.length ? `✓ ${todays.length} logged today` : run ? "pick-up run today" : "Rural · South · Owaka Rural · Owaka Town · Lawrence · Balclutha"}</span></h2>
    
    ${todays.length ? `<p class="meta c-ok" style="margin:0 0 8px">✓ Today: ${todays.map(r => `${esc(puAreaName(r.area))} ${esc(PU_CUST[r.customer] || r.customer)} (${PU_SRC_L[r.source] || "depot"}) ${puLine(r)}`).join(" · ")}</p>` : ""}
    <div class="row"><button class="btn sm" id="pu-log" style="flex:0 0 auto">+ Enter pick-ups</button></div>
    ${list.length ? `<details style="margin-top:8px"><summary>This month · ${list.length} logged</summary><div class="list" style="margin-top:6px">${list.map(r => `<div class="item"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><div>${label(r.day)} · ${esc(puAreaName(r.area))} · ${esc(PU_CUST[r.customer] || r.customer)} · ${PU_SRC_L[r.source] || "depot"}</div><div class="meta">${puLine(r)}${r.note ? ` · ${esc(r.note)}` : ""}</div></div>${puEditable(r) ? `<button class="btn ghost sm" data-puedit="${r.id}" style="flex:0 0 auto">Edit</button>` : ""}</div></div>`).join("")}</div></details>` : ""}</div>`;
}
/** Drivers can fix their own pick-up lines on the day only (matches the database rule) */
const puEditable = r => r.driver === S.me.id && r.day === today();
function editPickup(id) {
  const r = (S.pickups || []).find(x => x.id === id); if (!r) return;
  const isMin = r.min_fee != null;
  sheet(`<h3>Edit pick-ups</h3><p class="hint">${label(r.day)} · ${esc(puAreaName(r.area))} · ${esc(PU_CUST[r.customer] || r.customer)} · ${PU_SRC_L[r.source] || "depot"}</p><form class="frm" id="pe">
    ${isMin ? `<p class="meta full">No parcels logged. Got parcels after all? Delete this and enter the pick-ups again.</p>` : `<label class="f">Small<input class="in" id="pe-s" inputmode="numeric" value="${r.small}"></label><label class="f">Large<input class="in" id="pe-l" inputmode="numeric" value="${r.large}"></label>
    <label class="f full">Note (optional)<input class="in" id="pe-n" value="${esc(r.note || "")}"></label><button class="btn full" type="submit">Save changes</button>`}
    <button class="btn ghost full" type="button" id="pe-del">Delete this line</button></form>`, (bg, close) => {
    const done = async (error, msg) => { if (error) return toast(error.message, "err"); close(); toast(msg, "ok"); await loadAll(); render(); };
    bg.querySelector("#pe").addEventListener("submit", async e => { e.preventDefault(); if (isMin) return;
      const n = x => Math.max(0, parseInt(bg.querySelector("#" + x).value) || 0); const small = n("pe-s"), large = n("pe-l");
      if (!small && !large) return toast("Both are 0. Use Delete this line instead.", "err");
      const { error } = await sb.from("pickups").update({ small, large, note: bg.querySelector("#pe-n").value.trim() || null }).eq("id", r.id); done(error, "Pick-ups updated ✓"); });
    const del = bg.querySelector("#pe-del");
    del.addEventListener("click", async () => { if (!del.dataset.sure) { del.dataset.sure = "1"; del.textContent = "Tap again to delete"; return; }
      const { error } = await sb.from("pickups").delete().eq("id", r.id); done(error, "Pick-up line deleted"); });
  });
}
/** Done pick-up task: Edit button for today's lines in that area */
const puAreaLines = (area, day) => (S.pickups || []).filter(r => r.area === area && r.day === day && puEditable(r));
const puEditBtn = (key, day) => { const a = puAreaOf(key); return a && puAreaLines(a, day).length ? `<button class="btn ghost sm" data-puarea="${esc(a)}" data-puday="${day}" style="flex:0 0 auto;min-height:34px">Edit</button>` : ""; };
function editPickupArea(area, day) {
  const rs = puAreaLines(area, day); if (!rs.length) return;
  const mins = rs.filter(r => r.min_fee != null); const lines = rs.filter(r => r.min_fee == null);
  const grp = (c, src) => lines.filter(r => r.customer === c && (r.source || "depot") === src);
  const val = (c, src, k) => grp(c, src).reduce((a, r) => a + (r[k] || 0), 0);
  const note = lines.find(r => r.note)?.note || "";
  sheet(`<h3>Edit pick-ups · ${esc(puAreaName(area))}</h3><form class="frm" id="pa">
    <div class="full"><table class="dt" style="width:100%"><tr><th rowspan="2">Customer</th><th colspan="2">Depot</th><th colspan="2">Customer</th></tr><tr><th>Small</th><th>Large</th><th>Small</th><th>Large</th></tr>${Object.entries(PU_CUST).filter(([k]) => puCust(area).includes(k)).map(([k, v]) => `<tr><td>${esc(v)}</td>${PU_SRC.map(src => `<td><input class="in" data-pa="${k}.${src}.small" inputmode="numeric" placeholder="0" value="${val(k, src, "small") || ""}" style="width:54px"></td><td><input class="in" data-pa="${k}.${src}.large" inputmode="numeric" placeholder="0" value="${val(k, src, "large") || ""}" style="width:54px"></td>`).join("")}</tr>`).join("")}</table></div>
    <label class="f full">Note (optional)<input class="in" id="pa-n" value="${esc(note)}"></label>
    ${mins.length ? `<p class="meta full">Also logged: none. It's removed if you enter parcels.</p>` : ""}
    <button class="btn full" type="submit">Save changes</button></form>`, (bg, close) => {
    let confirmClear = false;
    bg.querySelector("#pa").addEventListener("submit", async e => { e.preventDefault();
      const g = k => Math.max(0, parseInt(bg.querySelector(`[data-pa="${k}"]`).value) || 0); const nt = bg.querySelector("#pa-n").value.trim() || null;
      let any = false; const ops = [];
      for (const c of Object.keys(PU_CUST).filter(k => puCust(area).includes(k))) for (const src of PU_SRC) {
        const small = g(`${c}.${src}.small`), large = g(`${c}.${src}.large`); const ex = grp(c, src); if (small || large) any = true;
        if (!ex.length) { if (small || large) ops.push(sb.from("pickups").insert({ day, area, customer: c, source: src, small, large, note: nt, driver: S.me.id, created_by: S.me.id })); continue; }
        if (!small && !large) { for (const r of ex) ops.push(sb.from("pickups").delete().eq("id", r.id)); continue; }
        const [first, ...rest] = ex;
        if (rest.length || first.small !== small || first.large !== large || (first.note || null) !== nt) ops.push(sb.from("pickups").update({ small, large, note: nt }).eq("id", first.id));
        for (const r of rest) ops.push(sb.from("pickups").delete().eq("id", r.id));
      }
      if (any) for (const r of mins) ops.push(sb.from("pickups").delete().eq("id", r.id));
      if (!ops.length) { close(); return toast("No changes", "ok"); }
      if (!any && lines.length && !confirmClear) { confirmClear = true; return toast("Everything's 0, so this deletes all of them. Tap Save again to confirm.", "err"); }
      const res = await Promise.all(ops); const err = res.find(r => r.error)?.error; if (err) return toast(err.message, "err");
      if (area === "Lawrence") lawPuPing(day);
      close(); toast("Pick-ups updated ✓", "ok"); await loadAll(); render(); });
  });
}
/** Pick-up entry task: the add-on's pick-up area, if it has one */
const puAreaOf = key => key ? S.addons.find(a => a.id === key)?.pu_area || null : null;
const noneBtn = (key, shiftId) => puAreaOf(key) === PU_MIN_AREA ? `<button class="btn sm ghost" data-pumin="${esc(key)}" data-shift="${shiftId}" style="flex:0 0 auto;min-height:34px">None ½</button>` : `<button class="btn sm ghost" data-done="${esc(key)}" data-shift="${shiftId}" style="flex:0 0 auto;min-height:34px">None</button>`;
const puBtn = (key, shiftId) => puAreaOf(key) ? `<button class="btn sm accent" data-puopen="${esc(key)}" data-shift="${shiftId}" style="flex:0 0 auto;min-height:34px">Enter</button>` : "";
/** Runsheet photo task: the Done button opens the camera; the photo is uploaded and the task ticked */
const isPhotoTask = key => !!key && !!S.addons.find(a => a.id === key)?.photo;
const rsBtn = (shiftId, key = "tw_twrunsheet") => key === BAYVAN ? `<button type="button" class="btn sm accent" style="flex:0 0 auto;min-height:34px" data-bayvan="${shiftId}">📷 Photos</button>` : key === MAIL_KEY ? `<div class="row" style="flex:0 0 auto;gap:6px"><button type="button" class="btn sm accent" style="flex:0 0 auto;min-height:34px" data-mailtrays="${shiftId}">📷 Photos</button><button type="button" class="btn sm ghost" style="flex:0 0 auto;min-height:34px" data-mailnil="${shiftId}">Nil</button></div>` : `<label class="btn sm accent" style="flex:0 0 auto;min-height:34px;cursor:pointer">📷 Photo<input type="file" accept="image/*" capture="environment" data-rsphoto="${shiftId}" data-rskey="${esc(key)}" hidden></label>`;
function logPickup(opt = {}) {
  const area = opt.area || PU_AREA[puToday(S.days[today()])] || "Lawrence";
  sheet(`<h3>Enter pick-ups${opt.area ? ` · ${esc(puAreaName(opt.area))}` : ""}</h3><form class="frm" id="pf"><label class="f">Date<input class="in" type="date" id="pu-day" value="${today()}" required></label>
    <label class="f">Area<select class="in" id="pu-area">${PU_AREAS.map(a => `<option value="${a}" ${a === area ? "selected" : ""}>${puAreaName(a)}</option>`).join("")}</select></label>
    <div class="full"><table class="dt" style="width:100%"><tr><th rowspan="2">Customer</th><th colspan="2">Depot</th><th colspan="2">Customer</th></tr><tr><th>Small</th><th>Large</th><th>Small</th><th>Large</th></tr>${Object.entries(PU_CUST).map(([k, v]) => `<tr data-cust="${k}"${puCust(area).includes(k) ? "" : " hidden"}><td>${esc(v)}</td>${PU_SRC.map(src => `<td><input class="in" data-pu="${k}.${src}.small" inputmode="numeric" placeholder="0" style="width:54px"></td><td><input class="in" data-pu="${k}.${src}.large" inputmode="numeric" placeholder="0" style="width:54px"></td>`).join("")}</tr>`).join("")}</table></div>
    <label class="f full">Note (optional)<input class="in" id="pu-n"></label><button class="btn full" type="submit">Save pick-ups</button>
    <button class="btn ghost full" type="button" id="pu-none"${area === PU_MIN_AREA ? "" : " hidden"}>None – no parcels here today</button></form>`, (bg, close) => {
    const tgeRow = () => { const a = bg.querySelector("#pu-area").value; const ok = puCust(a); bg.querySelectorAll("[data-cust]").forEach(r => r.hidden = !ok.includes(r.dataset.cust)); bg.querySelector("#pu-none").hidden = a !== PU_MIN_AREA; };
    bg.querySelector("#pu-none").addEventListener("click", async () => { if (await puMinFee(bg.querySelector("#pu-day").value, opt.shift, opt.area === PU_MIN_AREA ? opt.key : null)) close(); });
    bg.querySelector("#pu-area").addEventListener("change", tgeRow);
    bg.querySelector("#pf").addEventListener("submit", async e => { e.preventDefault(); const g = x => bg.querySelector("#" + x).value; const v = k => Math.max(0, parseInt(bg.querySelector(`[data-pu="${k}"]`).value) || 0);
      const rows = Object.keys(PU_CUST).filter(c => puCust(g("pu-area")).includes(c)).flatMap(c => PU_SRC.map(src => ({ day: g("pu-day"), area: g("pu-area"), customer: c, source: src, small: v(`${c}.${src}.small`), large: v(`${c}.${src}.large`), note: g("pu-n") || null, driver: S.me.id, created_by: S.me.id }))).filter(r => r.small || r.large);
      if (!rows.length) return toast("Enter at least one parcel", "err");
      const { error } = await sb.from("pickups").insert(rows);
      if (error) return toast(error.message, "err");
      if (opt.key && opt.shift && rows.some(r => r.area === opt.area)) { const { error: e2 } = await sb.rpc("task_done", { p_shift: opt.shift, p_addon: opt.key }); if (e2) toast(`Pick-ups saved, but the task couldn't be ticked: ${e2.message}`, "err"); }
      if (rows.some(r => r.area === "Lawrence")) lawPuPing(g("pu-day"));
      close(); toast("Pick-ups saved ✓", "ok"); await loadAll(); render(); }); });
}
/* ---------- Lawrence: meet-up place/time (D>B sets it) and the morning's Lawrence pick-ups (D>B enters them) ---------- */
const lawShift = T => (T?.segs || []).find(x => x.shift.run === "LAW")?.shift || null;
const lawTot = () => { const L = S.lawPu || []; return { small: L.reduce((a, r) => a + (r.small || 0), 0), large: L.reduce((a, r) => a + (r.large || 0), 0), n: L.length }; };
function lawBar(T) {
  const sh = lawShift(T); if (!sh) return "";
  const t = lawTot(); const pl = sh.meet_place || "Balclutha";
  const pu = t.n ? `<button class="btn qb done" id="law-pu"><b data-s="${t.small} S · ${t.large} B">📦 ${t.small} small · ${t.large} big</b><small>Lawrence pick-ups</small></button>` : `<button class="btn qb off" id="law-pu"><b data-s="📦 LAW PUs">📦 LAW pick-ups</b><small>not in yet</small></button>`;
  const mt = sh.milton_at ? `<button class="btn qb accent" id="law-meet"><b data-s="${esc(pl === "Balclutha" ? "Bal" : "Mil")} ${fmtT(toMin(sh.milton_at))}">📍 ${esc(pl)} ${fmtT(toMin(sh.milton_at))}</b><small>meet-up</small></button>` : `<button class="btn qb off" id="law-meet"><b data-s="📍 Meet-up">📍 Meet-up</b><small>not set yet</small></button>`;
  return `<div class="qbar">${pu}${mt}</div>`;
}
function lawPuSheet(auto = false) {
  const t = lawTot(); const by = c => (S.lawPu || []).find(r => r.customer === c) || { small: 0, large: 0 }; const at = (S.lawPu || []).map(r => r.logged_at).sort().pop();
  sheet(`<h3>📦 Lawrence pick-ups${auto ? " · new" : ""}</h3>${t.n ? `<p style="font:800 26px var(--fd);margin:4px 0">${t.small} small · ${t.large} big</p><p class="meta">Post Haste ${by("PH").small} small · ${by("PH").large} big<br>NZ Couriers ${by("NZC").small} small · ${by("NZC").large} big${at ? `<br>Entered ${fmtTime(at)}` : ""}</p>` : `<p class="hint">The D>B driver hasn't entered today's Lawrence pick-ups yet. You'll get a notification when they do.</p>`}<button class="btn full" id="lp-ok">Got it</button>`, (bg, close) => { bg.querySelector("#lp-ok").onclick = () => { lawPuSeen(); close(); }; });
}
const lawPuSig = () => { const t = lawTot(); return t.n ? `${t.small}|${t.large}` : ""; };
function lawPuSeen() { try { localStorage.setItem("tp-lawpu", JSON.stringify({ [today()]: lawPuSig() })); } catch { } }
/** pop the Lawrence pick-ups up once whenever new totals come in */
function lawPuPop() {
  if (S.viewAs || !S.lawPu?.length || document.querySelector(".sheet-bg")) return; const sig = lawPuSig();
  let seen = ""; try { seen = JSON.parse(localStorage.getItem("tp-lawpu") || "{}")[today()] || ""; } catch { }
  if (sig && sig !== seen) { lawPuSeen(); lawPuSheet(true); }
}
function lawMeetSheet() {
  const sh = lawShift(S.days[today()]); if (!sh) return;
  sheet(`<h3>📍 Meet-up</h3>${sh.milton_at ? `<p style="font:800 26px var(--fd);margin:4px 0">${esc(sh.meet_place || "Balclutha")} · ${fmtT(toMin(sh.milton_at))}</p><p class="meta">Meet the D>B driver there with your Lawrence load.</p>` : `<p class="hint">The D>B driver hasn't set today's meet-up yet. It's usually Milton at 10:30 until they do. You'll get a notification.</p>`}<button class="btn full" id="lm-ok">OK</button>`, (bg, close) => { bg.querySelector("#lm-ok").onclick = close; });
}
/** D>B driver: pick Milton or Balclutha and the time, then save; the Lawrence driver gets it */
function meetSheet(shiftId) {
  const sh = S.shifts.find(z => z.id === shiftId); if (!sh) return;
  let pl = sh.meet_place || "Balclutha"; const tm = String(sh.milton_at || "09:30").slice(0, 5);
  sheet(`<h3>📍 Meet-up with Lawrence</h3><p class="hint">${label(sh.day)} · pick where and when, then Save. The Lawrence driver gets it straight away.</p><form class="frm" id="mt">
    <div class="full row" style="gap:8px">${["Milton", "Balclutha"].map(p => `<button type="button" class="btn ${p === pl ? "accent" : "ghost"}" data-mtp="${p}" style="flex:1 1 0">${p}</button>`).join("")}</div>
    <label class="f full">Time<input class="in" type="time" step="300" id="mt-t" value="${esc(tm)}" required></label>
    <button class="btn full" type="submit">Save &amp; send to Lawrence</button></form>`, (bg, close) => {
    bg.querySelectorAll("[data-mtp]").forEach(b => b.onclick = () => { pl = b.dataset.mtp; bg.querySelectorAll("[data-mtp]").forEach(x => { x.classList.toggle("accent", x.dataset.mtp === pl); x.classList.toggle("ghost", x.dataset.mtp !== pl); }); });
    bg.querySelector("#mt").addEventListener("submit", async e => { e.preventDefault(); const v = bg.querySelector("#mt-t").value; if (!v) return toast("Pick a time", "err");
      const btn = bg.querySelector("[type=submit]"); btn.disabled = true;
      const { data, error } = await sb.rpc("set_meet", { p_shift: sh.id, p_time: v, p_place: pl }); btn.disabled = false;
      if (error) return toast(error.message, "err");
      sh.milton_at = v; sh.meet_place = pl; let sent = false;
      if (data?.message_id) { try { const r = await sb.functions.invoke("notify", { body: { type: "milton_time", message_id: data.message_id } }); sent = !r.error; } catch { } }
      close(); toast(data?.law?.length ? `${pl} ${fmtT(toMin(v))} saved${sent ? " · Lawrence driver notified" : " · in the Lawrence driver's app"}` : `${pl} ${fmtT(toMin(v))} saved (nobody on Lawrence that day yet)`, "ok"); render(); });
  });
}
/** after the D>B driver saves Lawrence pick-ups, push the totals to the Lawrence driver */
function lawPuPing(day) { if (!S.shifts.some(z => z.day === day && z.run === "DB" && z.driver === S.me.id)) return; sb.functions.invoke("notify", { body: { type: "law_pickups", day } }).catch(() => { }); }
function accessCard() {   // "## Heading" starts a section; "Label: value" lines become rows, tap a value to copy it
  const body = (S.access?.body || "").trim(); const canEdit = !!S.viewer?.can?.("people");
  if (!body && !canEdit) return "";
  return `<div class="card" id="access"><h2>Passwords &amp; logins<span>tap a code to copy</span></h2>
    ${body ? accessHtml(body) : `<p class="meta">Nothing added yet.</p>`}
    ${canEdit ? `<div class="row" style="margin-top:8px"><button class="btn ghost sm" id="access-edit" style="flex:0 0 auto">Update</button></div>` : ""}
    </div>`;
}
function accessHtml(body) {
  let out = "", open = false; const end = () => { if (open) { out += "</table>"; open = false; } };
  for (const raw of body.split(/\r?\n/)) { const l = raw.trim(); if (!l) continue;
    const hd = /^#{1,3}\s+(.*)$/.exec(l); if (hd) { end(); out += `<h4 style="margin:12px 0 4px">${esc(hd[1])}</h4>`; continue; }
    if (!open) { out += `<table class="dt" style="width:100%">`; open = true; }
    const i = l.indexOf(": "); const k = i > 0 ? l.slice(0, i) : "", v = i > 0 ? l.slice(i + 2) : l;
    out += `<tr><td class="meta" style="width:45%">${esc(k)}</td><td class="mono" style="cursor:pointer;word-break:break-all" data-copy="${esc(v)}">${esc(v)}</td></tr>`; }
  end(); return out;
}
function editAccess() {
  sheet(`<h3>Passwords &amp; logins</h3><form class="frm" id="acf"><label class="f full">What drivers see<textarea class="in" id="ac-body" rows="16" placeholder="## Section heading&#10;Label: value">${esc(S.access?.body || "")}</textarea></label><button class="btn full" type="submit">Save</button></form>`, (bg, close) => {
    bg.querySelector("#acf").addEventListener("submit", async e => { e.preventDefault(); const body = bg.querySelector("#ac-body").value; const { error } = await sb.from("access_info").upsert({ id: 1, body, updated_at: new Date().toISOString(), updated_by: S.viewer.id }); if (error) return toast(error.message, "err"); S.access = { body }; close(); toast("Saved", "ok"); render(); });
  });
}
/* ---------- Page layout: live / due things up top, then My scores, then two folded groups (Shift, Checks).
   Anything in a group that becomes due (or has something to confirm) moves up into the main area. ---------- */
function vchkDue() {   // monthly: week 3 of the month only. Vans I've driven this week (or look after) with no check yet; shows from Thursday (due 5pm)
  const t = today(); const wk = monOf(t); const day = S.C?.rules?.vchkDay || 4; if (vchkWho(wk) !== "drivers" || dow(t) + 1 < day) return null;
  const vans = new Set(S.shifts.filter(s => s.driver === S.me.id && s.day >= wk && s.day <= t && s.van).map(s => s.van));
  for (const [p, v] of Object.entries(S.vans || {})) if (v?.responsible === S.me.id) vans.add(p);
  vans.delete("OTHER"); const left = [...vans].filter(p => !(S.vchk || []).some(c => c.van === p && c.week_start === wk)); if (!left.length) return null;
  const late = dow(t) + 1 > day || nzNow().min >= (toMin(S.C?.rules?.vchkTime || "17:00") ?? 1020);
  return { left, late };
}
const rowBtn = (id, label, sub = "", cls = "") => `<button type="button" class="card rbrow ${cls}" id="${id}"><h2>${label}<span>${sub}</span><i class="fchev" aria-hidden="true"></i></h2></button>`;
function grp(key, title, body, sum = []) {
  if (!body.trim()) return "";
  const rows = sum.filter(Boolean); if (rows.length) body = `<div class="card grps"><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>` + body;
  return `<div class="grp ${S.open["grp-" + key] ? "" : "shut"}" data-grp="${key}"><button type="button" class="card grph" aria-expanded="${!!S.open["grp-" + key]}"><h2>${title}<i class="fchev" aria-hidden="true"></i></h2></button><div class="grpb folds">${body}</div></div>`;
}
function layout(T, t, n, nextDay, dayDone) {
  const top = [], shift = [], checks = [];
  const put = (html, due, list) => { if (html) (due ? top : list).push(html); };
  // main area: live today / needs doing
  top.push(part("Van use", () => vanUseCard()), part("Mail trays · other runs", () => mailHelpCard()), part("Today's tasks", () => addonsCard(T, nextDay, n)), part("Roster changes", () => rosterChanges(n)), part("Alerts", () => alertsCard()), part("To fix", () => toFixCard(n)));
  const msgs = part("Messages", () => messagesCard()); put(msgs, /data-fold-open="1"/.test(msgs), shift);
  const hz = part("Hazards", () => hazardsCard(T)); put(hz, /to confirm/.test(hz), checks);
  const pu = part("Parcel pick-ups", () => pickupsCard(T)); put(pu, /pick-up run today/.test(pu), shift);
  const vd = vchkDue(); const vchk = rowBtn("vchk-btn", "🚐 Monthly vehicle check", vd ? (vd.late ? "overdue" : "due 5pm") : "", vd ? (vd.late ? "due crit" : "due") : "");
  put(vchk, !!vd, checks);
  const van = part("My van", () => vanCard(T, null)); put(van, /overdue/.test(van), shift);
  const det = part("My details", () => detailsCard()); put(det, /expired|due in/.test(det), checks);
  // Shift group
  if (!dayDone) shift.unshift(part("Next shift", () => nextShiftCard(nextDay, n)));
  shift.push(part("My shifts", () => shiftsCard(t)), part("Notes from Jeremy", () => fromJeremy()), rbBtn(), part("This week's notes", () => notesBtn()), part("Calendar", () => calendarCard(t)), part("Leave", () => leaveCard()));
  // Checks group
  const vault = S.set.links?.vault;
  checks.push(rowBtn("wash-btn", "🧽 Van washed"));
  if (vault) checks.push(`<a class="card rbrow" href="${esc(vault)}" target="_blank" rel="noopener"><h2>🔐 Vault (Damstra)<span></span><i class="fchev" aria-hidden="true"></i></h2></a>`);
  checks.push(part("Passwords & logins", () => accessCard()), rowBtn("push-btn", "🔔 Notifications", `<span id="push-state">…</span>`));
  const j = a => a.filter(Boolean).join("\n");
  let ss = [], cs = [];
  try { ss = shiftSum(t, nextDay); } catch (e) { reportError("shiftSum", e); }
  try { cs = checkSum(t, vd); } catch (e) { reportError("checkSum", e); }
  return `${j(top)}${part("My scores", () => scoresCard())}${grp("shift", "Shift", j(shift), ss)}${grp("checks", "Checks", j(checks), cs)}`;
}
// one-glance summary at the top of each group when it's opened
function shiftSum(t, N) {
  const wk = monOf(t), end = addDays(wk, 6); const mine = S.shifts.filter(s => s.driver === S.me.id && s.day >= wk && s.day <= end && s.run !== "BU");
  const days = new Set(mine.map(s => s.day)); const left = new Set(mine.filter(s => s.day > t).map(s => s.day));
  const runs = N ? [...new Set(N.segs.map(x => x.shift.run))].join(" · ") : ""; const vans = N ? [...new Set(N.segs.map(x => x.shift.van).filter(Boolean))].join(", ") : "";
  const lv = (S.leave || []).filter(l => l.driver === S.me.id && l.status === "pending").length;
  const unread = (S.msgs || []).filter(m => !m.read_at).length;
  return [
    ["Next shift", N ? `${N.day === addDays(t, 1) ? "Tomorrow" : esc(label(N.day))} · ${fmtT(N.start)}–${fmtT(N.end)}${runs ? ` · ${esc(runs)}` : ""}` : "not rostered yet"],
    vans && ["Van", esc(vans)],
    ["This week", `${days.size} day${days.size === 1 ? "" : "s"}${left.size ? ` · ${left.size} to go` : ""}`],
    lv && ["Leave", `${lv} waiting`],
    unread && ["Messages", `${unread} unread`],
  ];
}
// Thursday of the next drivers' check week (week 3 of this month, or next month's once this one has passed)
function nextVchk(t) { let wk = monOf(t); for (let i = 0; i < 9; i++, wk = addDays(wk, 7)) if (vchkWho(wk) === "drivers" && addDays(wk, 3) >= t) return addDays(wk, 3); return addDays(monOf(t), 3); }
function checkSum(t, vd) {
  const wk = monOf(t); const mineChk = (S.vchk || []).filter(c => c.driver === S.me.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const thisWk = mineChk.find(c => String(c.week_start).slice(0, 7) === t.slice(0, 7));   // done this month
  const vc = vd ? `<b class="c-${vd.late ? "crit" : "warn"}">${vd.late ? "overdue" : "due 5pm"}</b> · ${esc(vd.left.join(", "))}` : thisWk ? `<span class="c-ok">✓ done this month</span> · ${esc(thisWk.van)}` : `next due Thu ${esc(label(nextVchk(t)))}${mineChk[0] ? ` · last ${esc(label(mineChk[0].week_start))}` : ""}`;
  const plates = [...new Set(S.shifts.filter(s => s.driver === S.me.id && s.day <= t && s.van).sort((a, b) => b.day.localeCompare(a.day)).map(s => s.van))].filter(p => p !== "OTHER").slice(0, 2);
  const wash = plates.map(p => { const w = lastWash(p); return `${esc(p)} ${w ? esc(label(nzNow(new Date(w.at)).date)) : "none recent"}`; }).join(" · ");
  const le = S.me.licence_expiry; const ld = le ? Math.round((new Date(le) - new Date(t)) / 86400000) : null;
  return [["Vehicle check", vc], wash && ["Last wash", wash], ["Licence", le ? `${esc(label(le, true))}${ld < 0 ? ` <b class="c-crit">expired</b>` : ld <= 30 ? ` <b class="c-warn">due in ${ld}d</b>` : ""}` : "not on file"]];
}

/* ================= wiring ================= */
function wire() {
  $$("[data-grp]").forEach(g => { const b = g.querySelector(".grph"); b.onclick = () => { const k = "grp-" + g.dataset.grp; S.open[k] = !S.open[k]; g.classList.toggle("shut", !S.open[k]); b.setAttribute("aria-expanded", String(S.open[k])); }; });
  $("#signout")?.addEventListener("click", signOut);
  $("#demo-reset")?.addEventListener("click", async () => { resetDemo(); S.open = {}; S.scSel = null; await loadAll(); render(); toast("Demo reset ↺", "ok"); });
  $("#demo-new")?.addEventListener("click", async () => { newRuns(); S.open = {}; S.scSel = null; await loadAll(); render(); toast("New runs 🎲", "ok"); });
  $("#view-as")?.addEventListener("click", async () => { await loadGps(); const list = S.drivers.filter(d => d.id !== S.viewer.id);
    sheet(`<h3>View as</h3><p class="meta">White = not signed in · <span class="c-ok">light green</span> = signed in to the app · <b class="c-ok">dark green</b> = GPS in the last 20 min</p><div class="vagrid"><button class="vapick" data-va="">— me (${esc(first(S.viewer.name))}) —</button>${list.map(d => { const st = appState(d.id); return `<button class="vapick ${st} ${S.viewAs?.id === d.id ? "cur" : ""}" data-va="${d.id}"><b>${esc(d.name)}</b>${d.role !== "driver" ? ` <span class="meta">(${esc(d.role)})</span>` : ""}<span class="meta">${st === "gps" ? `GPS ${ago(S.gps[d.id])}` : esc(loginState(d.id).tag)}</span></button>`; }).join("")}</div>`,
      (bg, close) => bg.querySelectorAll("[data-va]").forEach(b => b.onclick = () => { close(); location.hash = b.dataset.va ? "as=" + b.dataset.va : ""; })); });
  $$("#va-prev,#va-next").forEach(b => b.onclick = () => { if (b.dataset.id) location.hash = "as=" + b.dataset.id; });
  if (S.viewAs) { $$("#gotit,#gotit-again,[data-confirm],[data-addon],[data-plan],[data-meet],#leave-new,#push-btn,#vchk-btn,#wash-btn,#hz-new,[data-hzack],#hz-ackall").forEach(el => { el.disabled = true; el.title = "Only " + first(S.viewAs.name) + " can do this"; el.style.opacity = ".5"; }); }
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
  $("#xt-add")?.addEventListener("click", e => hoursSheet(e.currentTarget.dataset.day, e.currentTarget.dataset.shift));
  $("#brk-start")?.addEventListener("click", e => { e.currentTarget.disabled = true; startBreak(e.currentTarget.dataset.shift); });
  $("#brk-end")?.addEventListener("click", e => { e.currentTarget.disabled = true; endBreak(); });
  $("#sod-edit")?.addEventListener("click", e => editSod(e.currentTarget.dataset.shift));
  $$("[data-sod-late]").forEach(b => b.onclick = () => sendSod(b.dataset.sodLate, true));
  $$("[data-ans]").forEach(b => b.onclick = async () => { const [sid, ...kk] = b.dataset.ans.split("|"); const yes = b.dataset.yes === "1"; b.parentElement.querySelectorAll("button").forEach(x => x.disabled = true);
    const { error } = await sb.rpc("task_answer", { p_shift: sid, p_addon: kk.join("|"), p_done: yes, p_name: b.dataset.name || null }); if (error) { b.parentElement.querySelectorAll("button").forEach(x => x.disabled = false); return toast(error.message, "err"); }
    toast(yes ? "Thanks · ticked off, recorded as late" : "Thanks · recorded as not done", "ok"); await loadAll(); render(); });
  $("#gate-open")?.addEventListener("click", () => gateSheet(Object.values(S.days[today()]?.segs || []).map(x => x.shift?.id).find(Boolean) || null));
  $$("[data-carry]").forEach(b => b.onclick = async () => { const [sid, k] = b.dataset.carry.split("|"); b.disabled = true; const { error } = await sb.rpc("task_done_late", { p_shift: sid, p_addon: k, p_name: b.dataset.name || null }); if (error) { b.disabled = false; return toast(error.message, "err"); } toast("Done · recorded as late", "ok"); await loadAll(); render(); });
  $$("[data-eod]").forEach(b => b.onclick = () => eodGate(b.dataset.eod, !!b.dataset.sort));
  $$("[data-eodedit]").forEach(b => b.onclick = () => eodForm(b.dataset.eodedit, !!b.dataset.sort, true));
  $$("[data-addon]").forEach(c => c.onchange = async () => { const shift = S.shifts.find(s => s.id === c.dataset.shift); const set = new Set(shift.addons || []); c.checked ? set.add(c.dataset.addon) : set.delete(c.dataset.addon); const { error } = await sb.rpc("set_my_addons", { p_shift: shift.id, p_addons: [...set] }); if (error) { toast(error.message, "err"); c.checked = !c.checked; } else { shift.addons = [...set]; render(); } });
  $$("[data-plan]").forEach(i => i.onchange = async () => { const shift = S.shifts.find(s => s.id === i.dataset.shift); const plan = { ...(shift.plan || {}), [i.dataset.plan]: i.value }; const { error } = await sb.rpc("set_my_plan", { p_shift: shift.id, p_plan: plan }); if (error) toast(error.message, "err"); else { shift.plan = plan; toast("Saved", "ok"); } });
  $$("[data-meetset]").forEach(b => b.onclick = e => { e.stopPropagation(); meetSheet(b.dataset.meetset); });
  $("#law-pu")?.addEventListener("click", () => lawPuSheet());
  $("#law-meet")?.addEventListener("click", () => lawMeetSheet());
  $("#access-edit")?.addEventListener("click", editAccess);
  $("#pu-log")?.addEventListener("click", () => logPickup());
  $$("[data-puarea]").forEach(b => b.onclick = e => { e.stopPropagation(); editPickupArea(b.dataset.puarea, b.dataset.puday); });
  $$("[data-puedit]").forEach(b => b.onclick = e => { e.stopPropagation(); const r = (S.pickups || []).find(x => x.id === b.dataset.puedit); if (!r) return; r.min_fee != null && !puAreaLines(r.area, r.day).some(x => x.min_fee == null) ? editPickup(r.id) : editPickupArea(r.area, r.day); });
  $$("[data-rsphoto]").forEach(inp => inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const sh = S.shifts.find(z => z.id === inp.dataset.rsphoto); const lab = inp.closest("label");
    const rk = inp.dataset.rskey || "tw_twrunsheet"; const ad = S.addons.find(a => a.id === rk);
    let note = null; if (ad?.photo_note) { note = await photoNote(ad); if (note === undefined) { inp.value = ""; return; } }
    let scan = null; if (rk === "tw_twrunsheet" && sh && mailRun(S.C, sh.run)) { scan = await scanTotal(sh); if (scan === undefined) { inp.value = ""; return; } }
    if (lab) lab.style.opacity = ".5"; toast("Uploading photo…");
    const f1 = await shrinkPhoto(f); const path = `${sh?.driver || S.me.id}/${sh?.day || today()}/${inp.dataset.rsphoto}-${rk}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from("runsheets").upload(path, f1, { upsert: true, contentType: f1.type || "image/jpeg" });
    if (error) { if (lab) lab.style.opacity = ""; return toast(`Photo didn't upload: ${error.message}`, "err"); }
    const { error: e2 } = await sb.rpc("task_photo_done", { p_shift: inp.dataset.rsphoto, p_addon: rk, p_path: path, p_note: note });
    if (e2) { if (lab) lab.style.opacity = ""; return toast(e2.message, "err"); }
    if (scan != null) { const { error: e3 } = await sb.rpc("set_run_figs", { p_shift: inp.dataset.rsphoto, p_scan: scan }); if (e3) toast(`Photo saved, but the scanner total didn't: ${e3.message}`, "err"); }
    toast(scan != null ? `Photo + scanner total (${scan}) saved ✓` : "Photo saved ✓", "ok"); await loadAll(); render(); });
  $$("[data-mailtrays]").forEach(b => b.onclick = e => { e.stopPropagation(); mailTraySheet(b.dataset.mailtrays); });
  $$("[data-mailnil]").forEach(b => b.onclick = async e => { e.stopPropagation(); b.disabled = true; const { error } = await sb.rpc("mail_none", { p_shift: b.dataset.mailnil }); if (error) { b.disabled = false; return toast(error.message, "err"); } toast("Nil mail today ✓", "ok"); await loadAll(); render(); });
  $$("[data-pumin]").forEach(b => b.onclick = async e => { e.stopPropagation(); b.disabled = true; if (!(await puMinFee(today(), b.dataset.shift, b.dataset.pumin))) b.disabled = false; });
  $$("[data-puopen]").forEach(b => b.onclick = e => { e.stopPropagation(); logPickup({ area: puAreaOf(b.dataset.puopen), key: b.dataset.puopen, shift: b.dataset.shift }); });
  $$("[data-runmark]").forEach(b => b.onclick = async () => { b.disabled = true; const k = b.dataset.runmark;
    const { error } = await sb.rpc("run_mark", { p_shift: b.dataset.shift, p_kind: k });
    if (error) { b.disabled = false; return toast(error.message, "err"); }
    toast(k === "sor" ? (b.textContent.includes("End sort") ? "Sort ended ✓ · next started ▶" : "Started ▶ (the one before is ended)") : k === "dlv" ? "Sort ended ✓ · delivering ▶" : "Run ended ■ · send its EOD when you can", "ok"); await loadAll(); render(); });
  $$("[data-done]").forEach(b => b.onclick = async () => { const undo = !!b.dataset.undo; b.disabled = true; const { error } = await sb.rpc(undo ? "task_undo" : "task_done", { p_shift: b.dataset.shift, p_addon: b.dataset.done }); if (error) { b.disabled = false; toast(error.message, "err"); } else { toast(undo ? "Done undone" : "Marked done ✓ · tap again to undo", "ok"); await loadAll(); render(); } });
  $$("[data-sc]").forEach(b => b.onclick = () => { S.scSel = S.scSel === b.dataset.sc ? null : b.dataset.sc; render(); setTimeout(() => $("#scores")?.scrollIntoView({ block: "nearest" }), 0); });
  $("#leave-new")?.addEventListener("click", leaveForm);
  $$("[data-cal]").forEach(b => b.onclick = () => { const [y, m] = (S.calMonth || today().slice(0, 7)).split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + +b.dataset.cal, 1)); S.calMonth = d.toISOString().slice(0, 7); render(); setTimeout(() => $("#cal")?.scrollIntoView({ block: "nearest" }), 0); });
  $$("[data-statv]").forEach(c => c.onclick = () => toast(c.dataset.statv, "ok"));
  $("#prof-edit")?.addEventListener("click", profileForm);
  $("#vchk-btn")?.addEventListener("click", vehicleCheckForm);
  $("#wash-btn")?.addEventListener("click", () => vanWashForm());
  $("#hz-new")?.addEventListener("click", () => hazardForm());
  const tdOpen = e => { if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return; if (e.target.closest("a, input, select") || (e.target.closest("button") && e.target.closest("button").id !== "today-mini")) return; e.preventDefault(); S.todayFull = true; render(); };
  $("#today-mini")?.addEventListener("click", tdOpen); $("#today-mini")?.addEventListener("keydown", tdOpen);
  $("#today-less")?.addEventListener("click", () => { S.todayFull = false; render(); });
  $("#hz-all")?.addEventListener("click", () => hazardList());
  $$("[data-hzack]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); hazardAck([b.dataset.hzack]); }));
  $("#hz-ackall")?.addEventListener("click", e => hazardAck(e.currentTarget.dataset.ids.split(",")));
  $$("[data-hz]").forEach(b => b.addEventListener("click", () => hazardDetail(b.dataset.hz)));
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
  on("[data-evnew]", el => eventForm(null, el.dataset.evnew));
  on("[data-evedit]", el => { const e = (S.events || []).find(x => x.id === el.dataset.evedit); if (e) eventForm(e); });
  on("[data-vanv]", el => vanSheet(el.dataset.vanv));
  $$("[data-gotit-alert]").forEach(b => b.onclick = e => { e.stopPropagation(); b.disabled = true; gotItAlert(b.dataset.gotitAlert); });
  on("[data-alertv]", el => { const a = S.alerts.find(x => x.id === el.dataset.alertv); if (a) alertSheet(a); });
  on("[data-leavev]", el => { const l = S.leave.find(x => x.id === el.dataset.leavev); if (l) leaveSheet(l); });
  on("[data-notes]", () => notesSheet());
  on("[data-copy]", el => { const v = el.dataset.copy.split(" · ")[0].replace(/ or .*$/, ""); navigator.clipboard?.writeText(v).then(() => toast(`Copied ${v}`, "ok"), () => { }); });
  on("[data-brief]", el => { const m = (S.briefs || []).find(x => x.message_id === el.dataset.brief); if (m) briefSheet(m); });
  on("[data-msgv]", el => { const m = S.msgs.find(x => x.message_id === el.dataset.msgv); if (m) msgSheet(m); });
  on("[data-eodv]", el => eodGate(el.dataset.eodv, !!el.dataset.sort));
  on("[data-eodedit]", el => eodForm(el.dataset.eodedit, !!el.dataset.sort, true));
  on("[data-sodv]", el => sendSod(el.dataset.sodv, true));
}

/* ================= sheets ================= */
/** Photo task with notes: ask for the note before uploading. Resolves to the text, or undefined if cancelled. */
/* ---------- Bay / Van photo: two photos (the bay + next run's items, and the van), plus notes ---------- */
const BAYVAN = "tw_baynext";
document.addEventListener("click", e => { const b = e.target.closest?.("[data-bayvan]"); if (!b || b.disabled) return; e.preventDefault(); e.stopPropagation(); bayVanSheet(b.dataset.bayvan); }, true);
function bayVanSheet(shiftId, after) {
  const ad = S.addons.find(a => a.id === BAYVAN); const sh = S.shifts.find(s => s.id === shiftId); if (!sh) return;
  const files = { bay: null, van: null }; const LAB = { bay: "Bay photo", van: "Van photo" };
  sheet(`<h3>${esc(ad?.name || "Bay / Van photo")}</h3><p class="hint">Take both: your bay (with the next run's items) and your van.</p>
    <form class="frm" id="bv">${Object.keys(LAB).map(k => `<label class="btn ghost full" style="cursor:pointer" id="bvl-${k}">📷 ${LAB[k]}<input type="file" accept="image/*" capture="environment" data-bv="${k}" hidden></label><div class="meta full" id="bvs-${k}" style="margin-top:-4px">not taken yet</div>`).join("")}
    ${ad?.photo_note ? `<label class="f full">Notes<textarea class="in" id="bv-note" rows="3" placeholder="What's in the bay / for next, anything left behind, anything wrong with the van"></textarea></label>` : ""}
    <button class="btn full" type="submit" id="bv-go">Save photos</button></form>`, (bg, close) => {
    bg.querySelectorAll("[data-bv]").forEach(inp => inp.onchange = () => { const f = inp.files?.[0]; if (!f) return; const k = inp.dataset.bv; files[k] = f;
      bg.querySelector("#bvs-" + k).innerHTML = `<span class="c-ok">✓ ${LAB[k]} taken</span> · tap again to retake`; bg.querySelector("#bvl-" + k).classList.replace("ghost", "accent"); });
    bg.querySelector("#bv").onsubmit = async e => { e.preventDefault();
      const miss = Object.keys(LAB).filter(k => !files[k]); if (miss.length) return toast(`Take the ${miss.map(k => LAB[k].toLowerCase()).join(" and the ")} first`, "err");
      const note = bg.querySelector("#bv-note")?.value.trim() || null; if (ad?.photo_note && !note) return toast("Add a note first", "err");
      const go = bg.querySelector("#bv-go"); go.disabled = true; go.textContent = "Uploading…";
      let first = true;
      for (const k of Object.keys(LAB)) { const f1 = await shrinkPhoto(files[k]); const path = `${sh.driver || S.me.id}/${sh.day}/${shiftId}-${BAYVAN}-${k}-${Date.now()}.jpg`;
        const { error } = await sb.storage.from("runsheets").upload(path, f1, { upsert: true, contentType: f1.type || "image/jpeg" });
        if (error) { go.disabled = false; go.textContent = "Save photos"; return toast(`${LAB[k]} didn't upload: ${error.message}`, "err"); }
        const { error: e2 } = await sb.rpc("task_photo_done", { p_shift: shiftId, p_addon: BAYVAN, p_path: path, p_note: first ? note : null }); first = false;
        if (e2) { go.disabled = false; go.textContent = "Save photos"; return toast(e2.message, "err"); } }
      close(); toast("Bay + van photos saved ✓", "ok"); await loadAll(); render(); after?.(); };
  });
}
/* ---------- EOD lock: every add-on / task on the run is ticked off, or marked Not done, before its EOD ---------- */
function openTasks(x, day) {
  const mk = {}; for (const m of S.marks || []) mk[m.key] = m;
  const settled = k => !!(x.shift.done || {})[k] || ["ok", "late", "miss", "exc"].includes(mk[`add|${x.shift.id}|${k}`]?.status);
  const out = []; const seen = new Set();
  for (const r of rulesFor(x, day)) { const k = r.done_key || r.addon; if (r.addon) seen.add(r.addon); if (!k || seen.has("k:" + k)) continue; seen.add("k:" + k);
    const planned = k.startsWith("tw_") && /game plan/i.test(r.name) && Object.keys(x.shift.plan || {}).length > 0;
    if (!planned && !settled(k)) out.push({ key: k, name: r.name }); }
  for (const id of x.shift.addons || []) { if (seen.has(id) || seen.has("k:" + id) || settled(id) || !S.addons.some(a => a.id === id)) continue; out.push({ key: id, name: addName(id) }); }
  const seq = S.set?.taskSeq?.[x.shift.run] || []; const pos = t => t.key === BAYVAN ? 2e6 : t.key === "tw_scanreport" ? 1.5e6 : (seq.indexOf(t.key) + 1 || 1e6);
  return out.sort((a, b) => pos(a) - pos(b));
}
function eodGate(shiftId, sortOnly) {
  const sh = S.shifts.find(s => s.id === shiftId); const T = sh ? S.days[sh.day] : null; const x = T?.segs.find(y => y.shift.id === shiftId);
  const L = x && !sortOnly && !x.sort && sh.day === today() && !S.viewAs ? openTasks(x, sh.day) : [];
  if (!L.length) return eodForm(shiftId, sortOnly);
  const pts = S.C.rules.perEvent;
  const again = msg => { if (msg) toast(msg, "ok"); };
  const row = (t, i) => { const pu = puAreaOf(t.key); const special = t.key === MAIL_KEY || !!pu || t.key === "milton";
    const doB = t.key === BAYVAN ? `<button class="btn sm accent" data-gbv="${i}">📷 Photos</button>`
      : isPhotoTask(t.key) && !special ? `<label class="btn sm accent" style="cursor:pointer">📷 Photo<input type="file" accept="image/*" capture="environment" data-gph="${i}" hidden></label>`
      : special ? `<button class="btn sm accent" data-gopen="${i}">Open</button>` : `<button class="btn sm accent" data-gdone="${i}">Done</button>`;
    return `<div class="item" data-grow="${i}"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><b>${esc(t.name)}</b><span class="row gacts" style="flex:0 0 auto;gap:4px">${doB}<button class="btn sm ghost" data-gnot="${i}">Not done</button></span></div>
      <div class="row gsure" style="display:none;margin-top:6px;gap:6px;align-items:center"><span class="meta c-crit" style="flex:1 1 auto">This comes off your Admin score (−${pts}%). Sure it wasn't done?</span><button class="btn sm crit" data-gyes="${i}">Not done</button><button class="btn sm ghost" data-gback="${i}">Back</button></div></div>`; };
  sheet(`<h3>Before your EOD · ${esc(sortCode(sh.run))}</h3><p class="hint">Tick off every task on this run first. If one didn't happen, tap <b>Not done</b>. Each Not done comes off your Admin score.</p><div class="list">${L.map(row).join("")}</div>`, (bg, close) => {
    const next = async msg => { again(msg); await loadAll(); render(); close(); eodGate(shiftId, sortOnly); };
    const lock = el => el.closest("[data-grow]").querySelectorAll("button").forEach(z => z.disabled = true);
    bg.querySelectorAll("[data-gdone]").forEach(b => b.onclick = async () => { const t = L[+b.dataset.gdone]; lock(b); const { error } = await sb.rpc("task_done", { p_shift: shiftId, p_addon: t.key }); if (error) { b.closest("[data-grow]").querySelectorAll("button").forEach(z => z.disabled = false); return toast(error.message, "err"); } next("Ticked ✓"); });
    bg.querySelectorAll("[data-gbv]").forEach(b => b.onclick = () => { close(); bayVanSheet(shiftId, () => eodGate(shiftId, sortOnly)); });
    bg.querySelectorAll("[data-gopen]").forEach(b => b.onclick = () => { close(); S.open.tasks1 = true; S.open.tasks0 = true; render(); setTimeout(() => $("#tasks")?.scrollIntoView({ block: "start", behavior: "smooth" }), 0); toast("Do it here, then tap EOD again"); });
    bg.querySelectorAll("[data-gph]").forEach(inp => inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const t = L[+inp.dataset.gph]; const ad = S.addons.find(a => a.id === t.key);
      let note = null; if (ad?.photo_note) { note = await photoNote(ad); if (note === undefined) { inp.value = ""; return; } }
      toast("Uploading photo…"); const f1 = await shrinkPhoto(f); const path = `${sh.driver || S.me.id}/${sh.day}/${shiftId}-${t.key}-${Date.now()}.jpg`;
      const { error } = await sb.storage.from("runsheets").upload(path, f1, { upsert: true, contentType: f1.type || "image/jpeg" }); if (error) return toast(`Photo didn't upload: ${error.message}`, "err");
      const { error: e2 } = await sb.rpc("task_photo_done", { p_shift: shiftId, p_addon: t.key, p_path: path, p_note: note }); if (e2) return toast(e2.message, "err"); next("Photo saved ✓"); });
    bg.querySelectorAll("[data-gnot]").forEach(b => b.onclick = () => { const r = b.closest("[data-grow]"); r.querySelector(".gsure").style.display = "flex"; r.querySelector(".gacts").style.display = "none"; });
    bg.querySelectorAll("[data-gback]").forEach(b => b.onclick = () => { const r = b.closest("[data-grow]"); r.querySelector(".gsure").style.display = "none"; r.querySelector(".gacts").style.display = "flex"; });
    bg.querySelectorAll("[data-gyes]").forEach(b => b.onclick = async () => { const t = L[+b.dataset.gyes]; lock(b);
      const { error } = await sb.rpc("task_resolve", { p_shift: shiftId, p_addon: t.key, p_status: "miss", p_name: t.name }); if (error) { b.closest("[data-grow]").querySelectorAll("button").forEach(z => z.disabled = false); return toast(error.message, "err"); }
      next(`Recorded as not done · −${pts}% Admin`); });
  }, { wide: true });
}
function photoNote(ad) {
  return new Promise(res => { let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    const { bg } = sheet(`<h3>${esc(ad.name)} · notes</h3><form class="frm" id="pn"><label class="f full">Notes<textarea class="in" id="pn-note" rows="4" required placeholder="What's in the bay / for next, anything left behind or out of place"></textarea></label><button class="btn full" type="submit">Save photo + notes</button></form>`, (bg2, close) => {
      bg2.querySelector("#pn-note").focus();
      bg2.querySelector("#pn").onsubmit = e => { e.preventDefault(); const v = bg2.querySelector("#pn-note").value.trim(); if (!v) return toast("Add a note first", "err"); fin(v); close(); };
    });
    new MutationObserver((_, o) => { if (!bg.isConnected) { o.disconnect(); fin(undefined); } }).observe(document.body, { childList: true });
  });
}
/* ---------- Scanner total (asked with the runsheet photo on NZ Post runs) ---------- */
function scanTotal(sh) {
  return new Promise(res => { let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    const { bg } = sheet(`<h3>Runsheet · ${esc(sh.run)}</h3><form class="frm" id="st"><label class="f full">Total parcels on the scanner<input class="in" id="st-n" inputmode="numeric" pattern="[0-9]*" required placeholder="e.g. 72" value="${sh.scan_parcels ?? ""}"></label><p class="hint full" style="margin:0">From the scanner's total for today's run. Your stops and today's time estimate are worked out from it.</p><button class="btn full" type="submit">Save + take photo</button></form>`, (bg2, close) => {
      bg2.querySelector("#st-n").focus();
      bg2.querySelector("#st").onsubmit = e => { e.preventDefault(); const v = bg2.querySelector("#st-n").value.trim(); if (!/^\d+$/.test(v) || +v > 2000) return toast("Type the scanner total (a number)", "err"); fin(+v); close(); };
    });
    new MutationObserver((_, o) => { if (!bg.isConnected) { o.disconnect(); fin(undefined); } }).observe(document.body, { childList: true });
  });
}
/* ---------- Mail tray photo: up to 6 photos → slots with mail counted (mail stops) → driver checks the number → saved ---------- */
const MAIL_KEY = "tw_mailtrays";
function mailTraySheet(shiftId) {
  const sh = S.shifts.find(z => z.id === shiftId) || (S.helpShifts || []).find(z => z.id === shiftId); if (!sh) return; const files = [];
  const slot = i => files[i] ? `<div style="position:relative"><img src="${files[i].url}" alt="tray photo ${i + 1}" style="width:96px;height:96px;object-fit:cover;border-radius:8px"><button type="button" class="btn ghost sm" data-mtdel="${i}" style="position:absolute;top:2px;right:2px;min-height:24px;padding:0 6px">×</button></div>`
    : i === files.length ? `<label class="btn ghost" style="width:96px;height:96px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-direction:column;font-size:13px">📷<span>Photo ${i + 1}</span><input type="file" accept="image/*" capture="environment" data-mtadd hidden></label>` : "";
  sheet(`<h3>Mail trays · ${esc(sh.run)}</h3><p class="hint">Take up to 6 photos so each slot shows. The slots with mail are counted across all your photos for your mail stops (overlapping photos are allowed for). Nil mail day? Close this and tap Nil.</p>
    <div class="row" id="mt-ph" style="gap:8px;flex-wrap:wrap"></div>
    <form class="frm" id="mt"><button class="btn full ghost" type="button" id="mt-count" disabled>Count mail slots</button>
    <div class="f full"><span class="lbl">Mail stops (slots with mail)</span><div class="big" id="mt-n" style="font-size:28px">${sh.mail_stops ?? "—"}</div></div>
    <p class="meta full" id="mt-ai" style="margin:0">Counted from your photos. If the count looks wrong, add a clearer photo and count again.</p><button class="btn full" type="submit" id="mt-save" disabled>Save photos</button>
    <button class="btn full ghost" type="button" id="mt-none">No mail trays today</button></form>`, (bg, close) => {
    const paths = []; let counted = false;
    const draw = () => { bg.querySelector("#mt-ph").innerHTML = [0, 1, 2, 3, 4, 5].map(slot).join(""); bg.querySelector("#mt-count").disabled = !files.length; bg.querySelector("#mt-save").disabled = !files.length;
      bg.querySelectorAll("[data-mtadd]").forEach(inp => inp.onchange = () => { const f = inp.files?.[0]; if (f && files.length < 6) { files.push({ f, url: URL.createObjectURL(f) }); paths.length = 0; counted = false; } draw(); });
      bg.querySelectorAll("[data-mtdel]").forEach(b => b.onclick = () => { files.splice(+b.dataset.mtdel, 1); paths.length = 0; counted = false; draw(); }); };
    draw();
    const upload = async () => { if (paths.length === files.length) return true; paths.length = 0;
      for (const [i, x] of files.entries()) { const f = await shrinkPhoto(x.f, 1600, 0.85); const path = `${S.me.id}/${sh.day}/${sh.id}-${MAIL_KEY}-${Date.now()}-${i + 1}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
        const { error } = await sb.storage.from("runsheets").upload(path, f, { upsert: true, contentType: f.type || "image/jpeg" }); if (error) { toast(`Photo didn't upload: ${error.message}`, "err"); paths.length = 0; return false; } paths.push(path); }
      return true; };
    const ai = bg.querySelector("#mt-ai"), nOut = bg.querySelector("#mt-n");
    bg.querySelector("#mt-count").onclick = async e => { const b = e.currentTarget; b.disabled = true; b.textContent = "Uploading…"; if (!(await upload())) { b.disabled = false; b.textContent = "Count mail slots"; return; }
      b.textContent = "Counting…"; let r = null; try { const x = await sb.functions.invoke("mailcount", { body: { shift: sh.id, paths } }); r = x.data || null; if (x.error) r = { error: x.error.message }; } catch (err) { r = { error: String(err?.message || err) }; }
      b.disabled = false; b.textContent = "Count again";
      if (r?.ok) { counted = true; nOut.textContent = r.count; ai.innerHTML = `Counted <b>${r.count}</b> slots with mail${r.total ? ` of ${r.total}` : ""}${r.scaled ? ` (photos overlapped: ${r.raw_mail} of ${r.photos_total} slots seen, scaled to the run's ${r.run_slots})` : ""}${r.notes ? ` · ${esc(r.notes)}` : ""}. Not right? Add a clearer photo and count again.`; }
      else { counted = false; ai.textContent = r?.error === "no_key" ? "Auto count isn't switched on yet — save your photos and Jeremy will set the mail stops." : `Couldn't count from the photos (${r?.error || "no answer"}). Try a clearer photo, or save and Jeremy will set the mail stops.`; } };
    bg.querySelector("#mt").onsubmit = async e => { e.preventDefault(); if (!counted && !bg.querySelector("#mt-ai").textContent.includes("Jeremy")) return toast("Tap Count mail slots first", "err");
      const b = bg.querySelector("#mt-save"); b.disabled = true; if (!(await upload())) { b.disabled = false; return; }
      for (const p of paths) { const { error } = await sb.rpc("task_photo_done", { p_shift: sh.id, p_addon: MAIL_KEY, p_path: p, p_note: null }); if (error) { b.disabled = false; return toast(error.message, "err"); } }
      close(); toast(counted ? `Mail trays saved · ${nOut.textContent} mail stops ✓` : "Mail tray photos saved ✓", "ok"); await loadAll(); render(); };
    bg.querySelector("#mt-none").onclick = async e => { e.currentTarget.disabled = true; const { error } = await sb.rpc("mail_none", { p_shift: sh.id }); if (error) { e.currentTarget.disabled = false; return toast(error.message, "err"); }
      close(); toast("No mail today ✓", "ok"); await loadAll(); render(); };
  });
}
/* ---------- Mail trays for other runs (helpers like Liam, who sorts TUA, Flyer and RAM): Photos / Nil for each run today ---------- */
function mailHelpCard() {
  const L = (S.helpShifts || []).filter(s => S.rules.some(r => r.addon === MAIL_KEY && r.runs.includes(s.run) && r.days.includes(dow(s.day) + 1)));
  if (!L.length || S.viewAs && !S.viewer?.isStaff) return "";
  const row = s => { const done = s.done?.[MAIL_KEY]; return `<div class="tk tk1 ${done ? "ok" : "pend"}"><div class="tkt"><span class="t">${esc(s.run)} · ${esc(first(S.people[s.driver]?.name || ""))}</span>${done ? `<span class="tkw">✓ ${s.mail_stops ?? "?"} mail stops</span>` : ""}</div>${done ? "" : rsBtn(s.id, MAIL_KEY)}</div>`; };
  return `<div class="card"><h2>Mail trays · other runs<span>${L.filter(s => s.done?.[MAIL_KEY]).length}/${L.length} done</span></h2><div class="tks">${L.map(row).join("")}</div></div>`;
}
/* ---------- Today's estimate on a mail run: TDT from the scanner total + mail stops, worked at 90% → time and likely finish ---------- */
function runEstimate(x, D) {
  const code = x.shift.run; if (x.sort || !mailRun(S.C, code)) return null; const segI = D.segs.indexOf(x); const runs = D.segs.filter(y => !y.sort);
  const sod = D.segs.map(y => y.sod).find(Boolean); const first = runs[0] === x;
  // the driver's sort answers / trays from their last EOD on this run stand in until today's EOD
  const prev = S.eods.filter(e => { const z = S.shifts.find(y => y.id === e.shift_id); return z && z.run === code && z.day < D.day; }).sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
  const usual = prev ? { sorted_parcels: prev.sorted_parcels, sorted_mail: prev.sorted_mail, nzc_ph: prev.nzc_ph, trays: prev.trays } : null;
  let c = null; try { c = effCalc(x, null, S.ovs?.find(o => o.shift_id === x.shift.id), S.C, S.runsBy, { usual, sodMin: first && sod ? sodStart(sod, D.start, S.C) : null, brk: ownerBreakHrs(S.breaks, x.shift, !!S.me.pay_exclude) }); } catch { return null; }
  if (!c) return null; const brk = Math.round((c.brk || 0) * 60); const e = tdtEstimate({ ...c, start: c.start ?? x.st }, S.C, brk);
  return { ...e, scan: x.shift.scan_parcels, mail: x.shift.mail_stops, mailDue: rulesFor(x, D.day).some(r => r.addon === MAIL_KEY), started: c.start != null && segI >= 0 };
}
const hm = m => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;
function estLine(x, D) {
  const e = runEstimate(x, D); if (!e) return "";
  if (e.scan == null) return `<div class="meta" style="margin:2px 0 6px">⏱ Time estimated for your run shows once the runsheet photo + scanner total are in.</div>`;
  const mailTxt = e.mail != null ? `${e.mail} mail stops` : e.mailDue ? "mail stops to come (tray photo)" : "no mail today";
  return `<div class="meta" style="margin:2px 0 6px">⏱ Time estimated for your run: <b>${hm(e.dur)}</b>${e.end != null ? ` · finish ≈ <b>${fmtT(e.end % 1440)}</b>` : ""}<br>${e.scan} parcels · ${autoStops(S.C, e.scan)} stops · ${mailTxt}</div>`;
}
/* Notifications on by default: keep this phone's subscription saved, subscribe quietly when already allowed,
   otherwise ask each time the app opens (the phone only lets a site ask after a tap, so it's a one-tap sheet). */
async function ensurePush() {
  if (S.viewAs || DEMO) return;
  const st = await pushState();
  if (st === "on") { const reg = await navigator.serviceWorker.getRegistration(); const j = (await reg.pushManager.getSubscription()).toJSON();
    await sb.from("push_subs").upsert({ person: S.me.id, endpoint: j.endpoint, keys: j.keys }, { onConflict: "endpoint" }); return; }
  if (st === "off" && Notification.permission === "granted") { const r = await enablePush(S.me.id, VAPID_PUBLIC); if (r.ok) return; }
  const day = today(); const k = "tp-push-ask"; if (st !== "off" && localStorage.getItem(k) === day) return; localStorage.setItem(k, day);   // blocked / unsupported: remind once a day
  sheet(st === "off" ? `<h3>🔔 Turn on notifications</h3><p>Roster changes, cover requests and reminders come through as notifications. Tap below and choose <b>Allow</b>.</p><button class="btn" id="np-go" style="width:100%">Turn on notifications</button>`
    : st === "denied" ? `<h3>🔔 Notifications are blocked</h3><p>Roster changes and cover requests can't reach you. Turn them on in your phone: <b>Settings → Apps → Chrome (or the Taieri Post app) → Notifications → Allow</b>, then open the app again.</p>`
    : `<h3>🔔 Notifications need the Home Screen app</h3><p>On iPhone, open this site in Safari, tap <b>Share → Add to Home Screen</b>, then open Taieri Post from your Home Screen. You'll be asked to allow notifications.</p>`, (bg, close) => {
    bg.querySelector("#np-go")?.addEventListener("click", async () => { const r = await enablePush(S.me.id, VAPID_PUBLIC); toast(r.ok ? "Notifications are on ✓" : r.why, r.ok ? "ok" : "err"); close(); render(); }); });
}
function sheet(html, onOpen, opts = {}) {
  const bg = h(`<div class="sheet-bg"><div class="sheet ${opts.wide ? "wide" : ""}" role="dialog" aria-modal="true" style="position:relative"><button class="x" aria-label="Close">×</button>${html}</div></div>`);
  const close = () => bg.remove(); bg.querySelector(".x").onclick = close; bg.addEventListener("click", e => { if (e.target === bg) close(); }); bg._close = close;
  document.body.appendChild(bg); onOpen?.(bg, close); bindDetail(bg); return { bg, close };
}
document.addEventListener("keydown", e => { if (e.key === "Escape") { const all = $$(".sheet-bg"); const top = all[all.length - 1]; if (top) (top._close || (() => top.remove()))(); } });
const opt = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("");

async function sendSod(shiftId, lateMode = false) {
  const shift = S.shifts.find(s => s.id === shiftId); const D = S.days[shift.day];
  if (!lateMode && !S.viewAs && S.gateSkip !== today() && gateItems().length) return gateSheet(shiftId);   // outstanding items from earlier days come first
  const runs = D.segs.filter(x => !x.sort).map(x => x.shift.run); const van = D.segs.map(x => x.shift.van).find(Boolean) || null;
  const runId = runs.map(r => S.C.runCodes[r] || r).join(" + ");
  if (lateMode) { // late: ask for the actual start time
    sheet(`<h3>Post your SOD for ${label(shift.day)}</h3>
      <label class="f">When did you start?<input class="in" type="time" id="st" value="${fmt24s(D.start)}"></label><label class="f">Van<select class="in" id="van">${opt([["", "—"], ...Object.keys(S.vans).map(p => [p, p])], van)}</select></label><label class="f">Note (optional)<input class="in" id="note" placeholder="e.g. forgot to post"></label><button class="btn" id="go">Send SOD</button>`, (bg, close) => {
      bg.querySelector("#go").onclick = async () => { const t = bg.querySelector("#st").value; const note = bg.querySelector("#note").value || null; const { error } = await sb.from("sod").insert({ shift_id: shiftId, driver: S.me.id, van: bg.querySelector("#van").value || null, run_id: runId, note, sent_at: nzToIso(shift.day, t) }); if (error) return toast(error.message, "err");
        const cs = chgStart(D); const off0 = toMin(t) - D.start; const off = cs != null && off0 > 0 ? toMin(t) - cs : off0;   // roster changed after the start: judged from when the change went out
        if (Math.abs(off) > reqMins()) await sendSodReq(shiftId, D, toMin(t), note);
        close(); toast(Math.abs(off) > reqMins() ? "SOD sent · start time sent to Jeremy to sign off" : "SOD sent", "ok"); await loadAll(); render(); };
    }); return;
  }
  const now = nzNow().min; const off = shift.day === nzNow().date ? now - D.start : 0;
  // roster changed after the start: late against the old time isn't the driver's fault, so judge it from when the change was sent
  const cs = shift.day === nzNow().date ? chgStart(D) : null; const offC = cs != null && off > 0 ? now - cs : off;
  if (cs != null && off > 0 && offC <= reqMins()) {
    const { error } = await sb.from("sod").insert({ shift_id: shiftId, driver: S.me.id, van, run_id: runId, note: `Roster changed ${fmtT(cs)}` }); if (error) return toast(error.message, "err");
    toast(`SOD sent ${fmtT(now)} ✓`, "ok"); await loadAll(); render(); return;
  }
  if (Math.abs(off) > reqMins()) {   // more than 20 min early or late: the SOD still goes in, plus a sign-off request to Jeremy
    const early = off < 0; const mins = Math.abs(off);
    sheet(`<h3>${early ? "Starting early" : "Starting late"}</h3><p class="hint"><b>${minsTxt(mins)} ${early ? "early" : "late"}</b> (rostered ${fmtT(D.start)}). Jeremy signs it off.</p>
      <label class="f">Note for Jeremy (optional)<textarea class="in" id="note" rows="3" placeholder="${early ? "e.g. parcels in early, getting a head start" : "e.g. van wouldn't start"}"></textarea></label><button class="btn" id="go">Send SOD + request</button>`, (bg, close) => {
      bg.querySelector("#go").onclick = async e => { e.currentTarget.disabled = true; const note = bg.querySelector("#note").value.trim() || null;
        const { error } = await sb.from("sod").insert({ shift_id: shiftId, driver: S.me.id, van, run_id: runId, note }); if (error) { e.currentTarget.disabled = false; return toast(error.message, "err"); }
        await sendSodReq(shiftId, D, now, note); close(); toast(`SOD sent ${fmtT(now)} ✓ · Jeremy will sign off the start`, "ok"); await loadAll(); render(); };
    }); return;
  }
  const { error } = await sb.from("sod").insert({ shift_id: shiftId, driver: S.me.id, van, run_id: runId }); if (error) return toast(error.message, "err");
  toast(`SOD sent ${fmtT(nzNow().min)} ✓`, "ok"); await loadAll(); render();
}
/* ---- start-time sign-off (SOD more than 20 min off the rostered start) ---- */
const reqMins = () => S.C.rules.sodReqMins ?? 20;
const minsTxt = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
const clampT = m => Math.max(0, Math.min(1439, m));
async function sendSodReq(shiftId, D, startMin, note) {
  const off = startMin - D.start;
  const moves = D.segs.map(x => ({ shift_id: x.shift.id, start_at: fmt24s(clampT(x.st + off)), end_at: x.sort && !x.shift.end_at ? null : fmt24s(clampT((x.en ?? x.st) + off)) }));
  const { data, error } = await sb.from("sod_requests").insert({ shift_id: shiftId, driver: S.me.id, day: D.day, kind: off < 0 ? "early" : "late", rostered: fmt24s(D.start), started: fmt24s(clampT(startMin)), delta_min: off, moves, note }).select("id").single();
  if (error) return toast("SOD is in, but the sign-off request didn't send: " + error.message, "err");
  const rid = (Array.isArray(data) ? data[0] : data)?.id; if (rid && !DEMO) sb.functions.invoke("notify", { body: { type: "sod_request", id: rid } }).catch(() => { });
}
function sodReqLine(T) {
  const r = (S.sodReqs || []).find(x => x.day === T.day); if (!r) return "";
  const what = `${r.kind === "early" ? "Early" : "Late"} start ${fmtT(toMin(r.started))}${r.sod_at ? ` (SOD ${fmtT(toMin(r.sod_at))}, start edited)` : ""} (rostered ${fmtT(toMin(r.rostered))})`;
  return r.status === "pending" ? `<div class="meta c-warn">⏳ ${what} · waiting for sign-off${r.kind === "early" ? ` · hours count from ${fmtT(toMin(r.rostered))} until then` : ""}</div>`
    : r.status === "approved" ? `<div class="meta c-ok">✓ ${what} · signed off, run times updated${r.reply ? ` · ${esc(r.reply)}` : ""}</div>`
    : `<div class="meta c-crit">✗ ${what} · not signed off${r.kind === "early" ? `, hours count from ${fmtT(toMin(r.rostered))}` : ""}${r.reply ? ` · ${esc(r.reply)}` : ""}</div>`;
}
function fmt24s(min) { return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`; }
function editSod(shiftId) {
  const sod = S.sods.find(s => s.shift_id === shiftId);
  sheet(`<h3>Edit your SOD</h3>
    <label class="f">Van<select class="in" id="van">${opt([["", "—"], ...Object.keys(S.vans).map(p => [p, p])], sod.van || "")}</select></label><label class="f">Start km (optional)<input class="in" id="km" inputmode="numeric" value="${sod.start_km ?? ""}"></label><label class="f">Note<input class="in" id="note" value="${esc(sod.note || "")}"></label><button class="btn" id="go">Save</button>`, (bg, close) => {
    bg.querySelector("#go").onclick = async () => { const { error } = await sb.from("sod").update({ van: bg.querySelector("#van").value || null, start_km: +bg.querySelector("#km").value || null, note: bg.querySelector("#note").value || null, edited_at: new Date().toISOString() }).eq("shift_id", shiftId); if (error) return toast(error.message, "err"); close(); toast("SOD updated", "ok"); await loadAll(); render(); };
  });
}
// Runs whose EOD asks for the rural TGE parcels delivered 
const TGE_RURAL_RUNS = ["RAM", "TUA", "FLY"];
const EOD_INFO = {
  tgeRural: "How many TGE parcels you delivered on this run today. Put 0 if there were none.",
  stops: "How many addresses you delivered to. Three parcels to one house is 1 stop. If you delivered parcels it can't be 0, and it's usually a bit less than your parcel total.",
  parcels: "Every parcel you delivered on this run. Parcels you collected for NZ Couriers, Post Haste or TGE are pick-ups, so they go under Enter pick-ups, not here.",
  tgeParcels: "Every parcel you delivered on this run. Parcels you collected go in the pick-up boxes below, not here.",
  nzpTotal: "NZ Post parcels you delivered on this run. It's checked against NZ Post's data at 8pm and corrected to match if it's out.",
  thirdTotal: "Every other parcel you delivered on this run that isn't NZ Post's (TGE and other carriers). Put 0 if there were none.",
};
Object.assign(INFO, { eod_tgeRural: ["Rural TGE parcels", `<p>${EOD_INFO.tgeRural}</p><p>Count them carefully.</p>`],
  eod_stops: ["Stops", `<p>${EOD_INFO.stops}</p>`], eod_parcels: ["Total parcels", `<p>${EOD_INFO.parcels}</p>`], eod_tgeParcels: ["Delivery total", `<p>${EOD_INFO.tgeParcels}</p>`],
  eod_nzpTotal: ["NZ Post total", `<p>${EOD_INFO.nzpTotal}</p><p>The app adds the NZ Post and 3rd Party totals together for your parcel total.</p>`], eod_thirdTotal: ["3rd Party total", `<p>${EOD_INFO.thirdTotal}</p><p>This figure is never changed by the 8pm check.</p>`] });
// RAM, TUA and Flyer: the EOD splits parcels into an NZ Post total and a 3rd Party total (the app adds them up).
// At 8pm the NZ Post total is checked against NZ Post's emailed data and corrected; the 3rd Party total is never changed.
const SPLIT_RUNS = ["RAM", "TUA", "FLY"];
const KEY_LOCS = ["Taken home", "Top drawer", "NZ Post top drawer", "In the vehicle", "Vehicle TGE", "Other"];
function eodForm(shiftId, sortOnly, edit = false) {
  const shift = S.shifts.find(s => s.id === shiftId); const code = shift.run; const net = NET(code); const n = nzNow();
  const ex = edit ? S.eods.find(e => e.shift_id === shiftId) : null;   // editing the EOD already sent (same day or the day after)
  // Pick-up runs (e.g. D>B): pre-fill the parcel figure from the pick-up totals logged that day for this run's pick-up areas
  // D>B has its own EOD: Owaka parcels + TGE (South) parcels (each pre-filled from that day's pick-ups, depot + customer) and stops
  const isDB = code === "DB";
  const puSum = (areas, src) => (S.pickups || []).filter(r => r.day === shift.day && r.driver === shift.driver && r.min_fee == null && areas.includes(r.area) && (!src || (r.source || "depot") === src)).reduce((a, r) => a + (r.small || 0) + (r.large || 0), 0);
  const puAreas = isDB ? [] : (shift.addons || []).map(puAreaOf).filter(Boolean);
  const puTot = puSum(puAreas);
  const tgeV = ex?.extra?.tge_total != null ? String(ex.extra.tge_total) : ex ? "" : String(puSum(["South"]) || "");
  const othV = ex?.extra?.other_total != null ? String(ex.extra.other_total) : "";
  const puKey = net === "tge" ? "pickup_parcels" : "parcels";
  const v = k => ex && ex[k] != null ? String(ex[k]) : (k === puKey && puTot ? String(puTot) : "");
  const yn = id => `<select class="in" id="${id}"><option value="">Pick…</option><option value="true" ${v(id) === "true" ? "selected" : ""}>Yes</option><option value="false" ${v(id) === "false" ? "selected" : ""}>No</option></select>`;
  const legs = LEG_RUNS[code] || []; const newsRun = (S.C.news.runs || []).includes(code); const legOn = l => ex ? (ex.legs || []).includes(l) : (shift.addons || []).includes(l);
  // ⓘ beside the boxes drivers most often get wrong: tap it to show what goes in the box
  const lb = (text, k) => `<span class="lbl">${text}<button type="button" class="ib" data-info="eod_${k}" aria-label="What goes in ${text}?">i</button></span>`;
  const ih = () => "";
  // stages: a run that isn't the first shift of the day needs its start (▶ Start tap); if it wasn't tapped, ask for it here.
  const TD = S.days[shift.day]; const seg = TD?.segs.find(x => x.shift.id === shiftId); const segI = seg ? TD.segs.indexOf(seg) : -1;
  const isRun = !sortOnly && !isSort(code); const askStart = isRun && !ex && segI > 0 && !shift.sor_at;
  const prevEnd = segI > 0 && TD.segs[segI - 1].shift.eor_at ? fmt24s(nzNow(new Date(TD.segs[segI - 1].shift.eor_at)).min) : "";
  const tap0 = isRun && seg ? sortTap(TD, seg) : null;
  // no Sort done tap: the run's expected sort time goes in (the rest of the time is the run)
  const exp0 = tap0 == null && !ex && isRun && seg && !isGo(code) && !TD.segs[segI - 1]?.sort ? (sortExp(S.C, code, shift.day) || null) : null;
  let fields = askStart ? `<label class="f full">When did you start ${esc(code)}?${TD.segs[segI - 1].sort ? " (when sorting finished)" : ""}<input class="in" type="time" id="run_st" value="${prevEnd}" required></label>` : "";
  fields += `<label class="f full">Finish time<input class="in" type="time" id="finish" value="${ex?.finish_time ? ex.finish_time.slice(0, 5) : shift.eor_at ? fmt24s(nzNow(new Date(shift.eor_at)).min) : fmt24s(n.min)}" required></label>`;   // EOR tap time, if they tapped it
  if (!sortOnly && !isSort(code)) {
    if (isDB) fields += `<label class="f">TGE total<input class="in" id="db_tge" inputmode="numeric" required placeholder="0" value="${tgeV}"></label><label class="f">Everything else total<input class="in" id="db_other" inputmode="numeric" required placeholder="0" value="${othV}"></label><label class="f full">${lb("Stops total", "stops")}<input class="in" id="stops" inputmode="numeric" required value="${v("stops")}">${ih("stops")}</label>${ex ? "" : ``}`;
    else if (runStopRatio(S.C, code) != null && net === "tge") fields += `<label class="f">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 30" value="${v("sort_min")}"></label><label class="f">${lb("Total parcels", "tgeParcels")}<input class="in" id="parcels" inputmode="numeric" required value="${v("parcels")}"></label><label class="f">Total pick-ups (stops)<input class="in" id="pickups" inputmode="numeric" required placeholder="0" value="${v("pickups")}"></label><label class="f">Pick-up parcels<input class="in" id="pickup_parcels" inputmode="numeric" required placeholder="0" value="${v("pickup_parcels")}"></label><label class="f">Next cycled<input class="in" id="cycled" inputmode="numeric" value="${v("cycled")}"></label><p class="f full meta">Stops aren't needed: they're worked out as ${Math.round(runStopRatio(S.C, code) * 100)}% of your parcels.</p>`;   // TGE Surge: stops = 90% of parcels
    else if (net === "tge") fields += `<label class="f">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 90" value="${v("sort_min")}"></label><label class="f">${lb("Delivery total", "tgeParcels")}<input class="in" id="parcels" inputmode="numeric" required value="${v("parcels")}">${ih("tgeParcels")}</label><label class="f">${lb("Jobs (stops)", "stops")}<input class="in" id="stops" inputmode="numeric" required value="${v("stops")}">${ih("stops")}</label><label class="f">Pick-up stops<input class="in" id="pickups" inputmode="numeric" value="${v("pickups")}"></label><label class="f">Pick-up parcels<input class="in" id="pickup_parcels" inputmode="numeric" value="${v("pickup_parcels")}"></label><label class="f">Next cycled<input class="in" id="cycled" inputmode="numeric" value="${v("cycled")}"></label>`;
    else if (net === "fb") fields += `<label class="f">Boxes delivered<input class="in" id="parcels" inputmode="numeric" required placeholder="e.g. 80" value="${v("parcels")}"></label><label class="f">${lb("Stops", "stops")}<input class="in" id="stops" inputmode="numeric" required value="${v("stops")}">${ih("stops")}</label>`;
    else fields += `${NO_SORT.includes(code) ? "" : `<label class="f">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 90" value="${v("sort_min")}"></label>`}${SPLIT_RUNS.includes(code) ? `<label class="f">${lb("NZ Post total", "nzpTotal")}<input class="in" id="nzp_total" inputmode="numeric" required placeholder="0" value="${ex?.extra?.nzp_driver ?? ex?.extra?.nzp_total ?? ""}">${ih("nzpTotal")}</label><label class="f">${lb("3rd Party total", "thirdTotal")}<input class="in" id="third_total" inputmode="numeric" required placeholder="0" value="${ex?.extra?.third_total ?? ""}">${ih("thirdTotal")}</label><div class="f full meta" id="split_sum">Total parcels: <b>${ex?.parcels ?? 0}</b></div>` : `<label class="f">${lb("Total parcels", "parcels")}<input class="in" id="parcels" inputmode="numeric" required value="${v("parcels")}">${ih("parcels")}</label>`}${mailRun(S.C, code) ? "" : `<label class="f">${lb("Stops", "stops")}<input class="in" id="stops" inputmode="numeric" required value="${v("stops")}">${ih("stops")}</label>`}${TGE_RURAL_RUNS.includes(code) ? `<label class="f">${lb("Rural TGE parcels", "tgeRural")}<input class="in" id="tge_rural" inputmode="numeric" required placeholder="0" value="${ex?.extra?.tge_rural != null ? String(ex.extra.tge_rural) : ""}">${ih("tgeRural")}</label>` : ""}<label class="f">Mail trays<input class="in" id="trays" inputmode="decimal" placeholder="e.g. 1 or 0.5" value="${v("trays")}"></label>${NO_SORT.includes(code) ? "" : `<label class="f">Sorted parcels?${yn("sorted_parcels")}</label><label class="f">Sorted mail?${yn("sorted_mail")}</label>`}${PICKUP_RUNS.includes(code) ? `<label class="f">NZC / PH pick-up?${yn("nzc_ph")}</label>` : ""}<label class="f">Next cycled<input class="in" id="cycled" inputmode="numeric" value="${v("cycled")}"></label>`;
    if (legs.length) fields += `<div class="full"><div class="meta mono" style="margin-bottom:6px">ADD-ON LEGS YOU DID</div><div class="row">${legs.map(l => `<label class="chk ${legOn(l) ? "on" : ""}"><input type="checkbox" name="leg" value="${l}" ${legOn(l) ? "checked" : ""}>${esc(addName(l))}</label>`).join("")}</div></div>`;
    if (newsRun) fields += `<label class="chk full ${ex?.newspapers ? "on" : ""}"><input type="checkbox" id="news" ${ex?.newspapers ? "checked" : ""}>Newspapers done today (once a week, ${S.C.news.byRun?.[code] ?? S.C.news.min} min allowed)</label>`;
    if (puTot && !(ex && ex[puKey] != null)) fields += ``;
  } else fields += `<label class="f full">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 100" value="${v("sort_min")}"></label>`;
  if (tap0 != null && !ex) fields += ``;
  else if (exp0 != null) fields += ``;
  // NZ Post runs: the runsheet photo is a standing task that has to be done before the EOD, so the form won't send until it's ticked (and ticking it marks the task done)
  // mail runs with mail today: a photo of any mail left (or All delivered) is needed before the EOD; the stops left come off the TDT
  const needMl = !ex && !sortOnly && !isSort(code) && mailRun(S.C, code) && (shift.mail_stops || 0) > 0 && shift.mail_left == null;
  if (needMl) fields += `<div class="full" id="ml-box"><span class="lbl">Mail left over</span><div class="row" style="gap:6px;margin-top:4px"><label class="btn sm accent" style="flex:1 1 0;min-height:34px;cursor:pointer">📷 Mail left<input type="file" accept="image/*" capture="environment" id="ml-photo" hidden></label><button type="button" class="btn sm ghost" style="flex:1 1 0;min-height:34px" id="ml-none">All delivered</button></div><p class="meta" id="ml-st" style="margin:4px 0 0">Photo of any mail you couldn't deliver (box or tray), or tap All delivered.</p></div>`;
  // end of the day (last run of the day): where the van key was left — pick the place, then a photo of the key there
  const needKey = !ex && !sortOnly && !isSort(code) && (segI < 0 || segI === TD.segs.length - 1) && !shift.done?.key_photo;
  if (needKey) fields += `<div class="full" id="key-box"><span class="lbl">Key left</span><select class="in" id="key_loc" style="margin-top:4px"><option value="">Where did you leave the key?</option>${KEY_LOCS.map(k => `<option>${k}</option>`).join("")}</select><input class="in" id="key_other" placeholder="Where is the key?" style="margin-top:6px;display:none"><label class="btn sm accent" style="display:flex;min-height:34px;cursor:pointer;margin-top:6px">📷 Key photo<input type="file" accept="image/*" capture="environment" id="key-photo" hidden></label><p class="meta" id="key-st" style="margin:4px 0 0">Pick where the key is, then take a photo of it there.</p></div>`;
  const needRs = !ex && !sortOnly && !isSort(code) && !shift.done?.tw_twrunsheet && !(S.marks || []).some(m => m.key === `add|${shiftId}|tw_twrunsheet` && m.status !== "ask") && rulesFor({ shift }, shift.day).some(r => r.addon === "tw_twrunsheet");
  if (needRs) fields += `<label class="chk full"><input type="checkbox" id="runsheet" required>Runsheet photo taken (NZ Post needs it before every EOD)</label>`;
  fields += `<label class="f full">Note (optional)<input class="in" id="note" placeholder="anything Jeremy should know" value="${esc(ex?.note || "")}"></label>`;
  sheet(`<h3>${ex ? "Edit EOD" : "EOD"} · ${esc(sortOnly || isSort(code) ? (S.runsBy[code]?.label || "Sort") : code)}</h3><p class="hint">${label(shift.day)}${shift.van ? ` · ${esc(shift.van)}` : ""}. ${ex ? `Sent ${fmtTime(ex.sent_at)}${ex.edited_at ? `, last edited ${fmtTime(ex.edited_at)}` : ""}. Change what's wrong and save — Jeremy approves the change.` : "Fill in every box that applies."}</p><form class="frm" id="ef">${fields}<button class="btn full" type="submit">${ex ? "Save changes" : "Send EOD"}</button></form>`, (bg, close) => {
    bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
    // sorting minutes from the taps: prefilled, and kept in step with a typed start time until the driver changes the box themselves
    const smIn = bg.querySelector("#sort_min"); let smTouched = false; const tapNow = () => { const r = bg.querySelector("#run_st"); return seg ? sortTap(TD, seg, r?.value ? Date.parse(nzToIso(shift.day, r.value)) : undefined) : null; };
    if (smIn && !ex) { if ((tap0 ?? exp0) != null && smIn.value === "") smIn.value = tap0 ?? exp0; smIn.oninput = () => { smTouched = true; }; }
    bg.querySelector("#run_st")?.addEventListener("change", () => { const t = tapNow(); if (smIn && !smTouched && t != null) smIn.value = t; const h = bg.querySelector("#sorthint"); if (h && t != null) h.textContent = `Sorting time filled in from your times (${t} min). Change it if that's not right.`; });
    { const a = bg.querySelector("#nzp_total"), b3 = bg.querySelector("#third_total"), out = bg.querySelector("#split_sum b");
      if (a && b3 && out) { const sum = () => { out.textContent = String((+a.value || 0) + (+b3.value || 0)); }; a.oninput = sum; b3.oninput = sum; sum(); } }

    let keyDone = !needKey; const keySt = bg.querySelector("#key-st");
    const keyLoc = () => { const v = bg.querySelector("#key_loc")?.value || ""; return v === "Other" ? (bg.querySelector("#key_other").value.trim() ? `Other: ${bg.querySelector("#key_other").value.trim()}` : "") : v; };
    bg.querySelector("#key_loc")?.addEventListener("change", e => { const o = bg.querySelector("#key_other"); o.style.display = e.target.value === "Other" ? "" : "none"; if (e.target.value === "Other") o.focus(); });
    bg.querySelector("#key-photo")?.addEventListener("change", async e => { const f0 = e.target.files?.[0]; if (!f0) return; const loc = keyLoc(); if (!loc) { e.target.value = ""; return toast(bg.querySelector("#key_loc").value === "Other" ? "Type where you left the key first" : "Pick where you left the key first", "err"); }
      keySt.textContent = "Uploading…"; const f = await shrinkPhoto(f0); const path = `${shift.driver || S.me.id}/${shift.day}/${shiftId}-key_photo-${Date.now()}.jpg`;
      const { error } = await sb.storage.from("runsheets").upload(path, f, { upsert: true, contentType: f.type || "image/jpeg" });
      if (error) { keyDone = true; keySt.textContent = `Photo didn't upload (${error.message}) — key place saved with your EOD.`; return; }   // never block the EOD on a bad signal
      const r = await sb.rpc("task_photo_done", { p_shift: shiftId, p_addon: "key_photo", p_path: path, p_note: loc }); keyDone = true; keySt.textContent = r.error ? "✓ Photo saved" : `✓ Key photo saved · ${loc}`; });
    let mlDone = !needMl; const mlSt = bg.querySelector("#ml-st");
    bg.querySelector("#ml-none")?.addEventListener("click", async e => { e.currentTarget.disabled = true; const { error } = await sb.rpc("mail_left_none", { p_shift: shiftId }); if (error) { e.currentTarget.disabled = false; return toast(error.message, "err"); } mlDone = true; mlSt.innerHTML = "✓ All mail delivered"; });
    bg.querySelector("#ml-photo")?.addEventListener("change", async e => { const f0 = e.target.files?.[0]; if (!f0) return; mlSt.textContent = "Uploading…"; const f = await shrinkPhoto(f0);
      const path = `${shift.driver || S.me.id}/${shift.day}/${shiftId}-mail_left-${Date.now()}.jpg`; const { error } = await sb.storage.from("runsheets").upload(path, f, { upsert: true, contentType: f.type || "image/jpeg" }); if (error) { mlSt.textContent = `Photo didn't upload: ${error.message}`; return; }
      await sb.rpc("task_photo_done", { p_shift: shiftId, p_addon: "mail_left", p_path: path, p_note: null });
      mlSt.textContent = "Counting…"; let r = null; try { const x = await sb.functions.invoke("mailcount", { body: { shift: shiftId, paths: [path], mode: "left" } }); r = x.data || { error: x.error?.message }; } catch (err) { r = { error: String(err?.message || err) }; }
      mlDone = true; mlSt.innerHTML = r?.ok ? `✓ About <b>${r.count}</b> stops of mail left — they come off today's mail stops.` : "✓ Photo saved — Jeremy will check the mail left."; });
    bg.querySelector("#ef").onsubmit = async e => { e.preventDefault(); const sb0 = bg.querySelector("#ef button[type=submit]"); if (sb0?.disabled) return; if (sb0) { sb0.disabled = true; setTimeout(() => { sb0.disabled = false; }, 4000); } if (!mlDone) return toast("Take a photo of the mail left, or tap All delivered", "err"); if (needKey && !keyLoc()) return toast("Pick or type where you left the key", "err"); if (!keyDone) return toast("Take a photo of where you left the key", "err"); const g = id => bg.querySelector("#" + id); const num = id => g(id) && g(id).value !== "" ? +g(id).value : null; const bool = id => g(id) && g(id).value !== "" ? g(id).value === "true" : null;
      const row = { finish_time: g("finish").value, sort_min: num("sort_min"), parcels: num("parcels"), stops: num("stops"), trays: num("trays"), pickups: num("pickups"), pickup_parcels: num("pickup_parcels"), cycled: num("cycled"), sorted_parcels: bool("sorted_parcels"), sorted_mail: bool("sorted_mail"), nzc_ph: bool("nzc_ph"), legs: [...bg.querySelectorAll("input[name=leg]:checked")].map(i => i.value), newspapers: !!g("news")?.checked, note: g("note").value || null, run_id: S.C.runCodes[code] || null };
      if (g("tge_rural")) row.extra = { ...(ex?.extra || {}), tge_rural: num("tge_rural") ?? 0 };
      const tapM = !ex ? tapNow() : null; if (tapM != null) row.extra = { ...(row.extra || ex?.extra || {}), sort_tap: tapM };
      if (g("run_st")?.value) { const at = nzToIso(shift.day, g("run_st").value); if (toMin(g("run_st").value) >= toMin(g("finish").value)) return toast("The start has to be before the finish time", "err");
        const { error: eS } = await sb.rpc("run_mark", { p_shift: shiftId, p_kind: "sor", p_at: at }); if (eS) return toast(eS.message, "err"); }
      if (g("nzp_total")) { const a = num("nzp_total") ?? 0, b = num("third_total") ?? 0; row.parcels = a + b;   // the 8pm check may correct nzp_total; the driver's own figure is kept as nzp_driver
        const keep = { ...(row.extra || ex?.extra || {}) }; delete keep.nzp_driver; delete keep.nzp_feed; delete keep.nzp_checked_at; row.extra = { ...keep, nzp_total: a, third_total: b }; }
      if (isDB) { const t = num("db_tge") ?? 0, o = num("db_other") ?? 0; row.parcels = t + o; row.extra = { ...(row.extra || ex?.extra || {}), tge_total: t, other_total: o }; }
      if (runStopRatio(S.C, code) != null && !mailRun(S.C, code) && !sortOnly && !isSort(code)) row.stops = row.parcels == null ? null : Math.round(row.parcels * runStopRatio(S.C, code));   // TGE Surge: stops = 90% of parcels
      if (mailRun(S.C, code) && !sortOnly && !isSort(code)) { row.stops = autoStops(S.C, row.parcels); row.mail_stops = shift.mail_stops ?? ex?.mail_stops ?? null; }   // mail left is kept on the shift (photo count)   // stops aren't asked for: 80% of the parcels
      if (needKey) row.extra = { ...(row.extra || {}), key_loc: keyLoc() };
      const upd = async () => { const { data, error } = await sb.from("eod").update(row).eq("shift_id", shiftId).select("shift_id"); if (error) return error.message.includes("row-level") ? "Too late to edit this one — ask Jeremy" : error.message; return data && data.length ? null : "Too late to edit this one — ask Jeremy"; };
      if (ex) { const m = await upd(); if (m) return toast(m, "err"); close(); toast("EOD updated ✓ · sent to Jeremy to approve", "ok"); await loadAll(); render(); return; }
      Object.assign(row, { shift_id: shiftId, driver: S.me.id }); if (shift.day !== n.date) row.sent_at = nzToIso(shift.day, g("finish").value);
      const { error } = await sb.from("eod").insert(row);
      if (error && (error.code === "23505" || /duplicate key/.test(error.message))) {   // already sent (double tap / slow signal): save these figures over it instead
        const r2 = { ...row }; delete r2.shift_id; delete r2.driver; delete r2.sent_at; Object.assign(row, r2); const m = await upd();
        close(); toast(m ? "EOD was already sent ✓" : "EOD already sent · changes sent to Jeremy to approve", "ok"); await loadAll(); render(); return; }
      if (error) return toast(error.message, "err");
      if (g("runsheet")?.checked) { const { error: e2 } = await sb.rpc("task_done", { p_shift: shiftId, p_addon: "tw_twrunsheet" }); if (e2) toast(`EOD sent, but the runsheet task couldn't be ticked: ${e2.message}`, "err"); }
      close(); toast("EOD sent ✓ Thanks!", "ok"); await loadAll(); render(); };
  });
}
function leaveForm() {
  const t = today();
  sheet(`<h3>Leave request</h3>
    <form class="frm" id="lf"><label class="f full">Type of leave<select class="in" id="type">${opt(Object.entries(LEAVE_T), "annual")}</select></label><label class="f">First day off<input class="in" type="date" id="from" min="${t}" required></label><label class="f">Last day off<input class="in" type="date" id="to" min="${t}" required></label>
    <div class="full"><div class="meta mono" style="margin-bottom:6px">HOW MUCH OF THE DAY</div><div class="seg-btns" id="part"><button type="button" data-p="full" class="on">Full day</button><button type="button" data-p="AM">Morning off</button><button type="button" data-p="PM">Afternoon off</button></div></div>
    <label class="f full">Note for Jeremy (optional)<textarea class="in" id="notes" rows="3" placeholder="e.g. Family wedding in Christchurch. Happy to swap Saturday."></textarea></label><button class="btn full" type="submit">Send request</button></form>`, (bg, close) => {
    let part = "full"; bg.querySelectorAll("#part button").forEach(b => b.onclick = () => { part = b.dataset.p; bg.querySelectorAll("#part button").forEach(x => x.classList.toggle("on", x === b)); if (part !== "full") bg.querySelector("#to").value = bg.querySelector("#from").value; });
    bg.querySelector("#from").onchange = e => { if (!bg.querySelector("#to").value || bg.querySelector("#to").value < e.target.value) bg.querySelector("#to").value = e.target.value; };
    bg.querySelector("#lf").onsubmit = async e => { e.preventDefault(); const f = bg.querySelector("#from").value, to = bg.querySelector("#to").value; if (to < f) return toast("Last day can't be before the first", "err");
      const { error } = await sb.from("leave_requests").insert({ driver: S.me.id, type: bg.querySelector("#type").value, date_from: f, date_to: part === "full" ? to : f, part, notes: bg.querySelector("#notes").value || null }); if (error) return toast(error.message, "err"); close(); toast("Request sent. Check your email.", "ok"); await loadAll(); render(); };
  });
}
/* Profile: everyone (owner included) fills in / confirms their details the next time they open the app (can't be closed until saved) */
function profilePop() {
  if (S.viewAs || S.me.role === "admin" || (S.me.profile_confirmed_at && S.me.licence_front && S.me.licence_back) || document.querySelector(".sheet-bg")) return; profileForm(true);
}
function profileForm(must = false) {
  const p = S.me; const forOther = S.viewAs && S.viewer?.can?.("people");
  if (S.viewAs && !forOther) return toast(`Only ${first(S.viewAs.name)} (or Jeremy) can change these`, "err");
  const { bg: sbg } = sheet(`<h3>${forOther ? `Update ${esc(first(p.name))}'s details` : must ? "Your details" : "Update my details"}</h3>${must ? `<p class="meta">Please fill in your details before you carry on. Licence class and expiry are needed so Jeremy knows you're legal to drive.</p>` : ""}<form class="frm" id="pf"><label class="f full">Phone<input class="in" id="phone" type="tel" ${must ? "required" : ""} value="${esc(p.phone || "")}"></label><label class="f">Licence class<input class="in" id="lc" ${must ? "required" : ""} value="${esc(p.licence_class || "")}" placeholder="e.g. Class 1 full"></label><label class="f">Licence expires<input class="in" type="date" id="le" ${must ? "required" : ""} value="${p.licence_expiry || ""}"></label><label class="f full">DG endorsement expires<input class="in" type="date" id="dg" value="${p.dg_expiry || ""}"></label>${forOther ? "" : ["front", "back"].map(sd => `<label class="f full">Licence photo · ${sd}${p["licence_" + sd] ? ` <span class="c-ok">✓ on file</span>` : ""}<input class="in" type="file" accept="image/*" capture="environment" id="lp-${sd}" ${must && !p["licence_" + sd] ? "required" : ""}></label>`).join("")}<button class="btn full" type="submit">Save</button></form>`, (bg, close) => {
    bg.querySelector("#pf").onsubmit = async e => { e.preventDefault(); const v = { phone: bg.querySelector("#phone").value || null, licence_class: bg.querySelector("#lc").value || null, licence_expiry: bg.querySelector("#le").value || null, dg_expiry: bg.querySelector("#dg").value || null };
      if (!forOther) { const btn = bg.querySelector("#pf button[type=submit]"); if (btn) btn.disabled = true;
        for (const sd of ["front", "back"]) { const f0 = bg.querySelector("#lp-" + sd)?.files?.[0]; if (!f0) continue; const f = await shrinkPhoto(f0); const path = `${p.id}/${sd}-${Date.now()}.jpg`;
          const up = await sb.storage.from("licences").upload(path, f, { contentType: f.type || "image/jpeg" }); if (up.error) { if (btn) btn.disabled = false; return toast(`Licence photo didn't upload: ${up.error.message}`, "err"); }
          const r = await sb.rpc("set_my_licence_photo", { p_side: sd, p_path: path }); if (r.error) { if (btn) btn.disabled = false; return toast(r.error.message, "err"); } } }
      const { error } = forOther ? await sb.from("people").update(v).eq("id", p.id) : await sb.rpc("update_my_profile", { p_phone: v.phone, p_lic_class: v.licence_class, p_lic_exp: v.licence_expiry, p_dg_exp: v.dg_expiry });
      if (error) return toast(error.message, "err"); close(); toast("Saved", "ok"); if (forOther) Object.assign(S.me, v); else S.me = await me(); render(); };
  });
  if (must && sbg) { sbg.querySelector(".x")?.remove(); sbg._close = () => { }; sbg.addEventListener("click", e => { if (e.target === sbg) e.stopImmediatePropagation(); }, true); }
}
/* Van wash: one quick tap to record that a van was washed (separate from the monthly check) */
const dayAt = d => d && d < today() ? new Date(d + "T12:00:00+13:00").toISOString() : new Date().toISOString();   // picked date → time to store (now if today)
const dayPick = id => `<label class="f full">Date<input class="in" type="date" id="${id}" value="${today()}" max="${today()}" min="${addDays(today(), -30)}" required></label>`;
const lastWash = plate => (S.washes || []).filter(w => w.van === plate).sort((a, b) => b.at.localeCompare(a.at))[0];
function vanWashForm(plate) {
  const n = nzNow(); const T = S.days[n.date]; const plates = [...new Set([...(T ? T.segs.map(x => x.shift.van) : []), ...S.shifts.filter(s => s.day <= n.date).sort((a, b) => b.day.localeCompare(a.day)).map(s => s.van)].filter(Boolean))];
  const pick = plate || plates[0]; const all = [...plates, ...Object.keys(S.vans).filter(p => !plates.includes(p) && p !== "OTHER")];
  const lw = p => { const w = lastWash(p); return w ? `Last washed ${label(nzNow(new Date(w.at)).date)}` : "No wash recorded yet"; };
  sheet(`<h3>🧽 Van washed</h3><form class="frm" id="wf"><label class="f full">Van<select class="in" id="wvan">${opt(all.map(p => [p, p]), pick)}</select></label><p class="meta full" id="wlast">${esc(lw(pick))}</p>${dayPick("wday")}<label class="f full">Note (optional)<input class="in" id="wnote" placeholder="e.g. inside and out"></label><button class="btn full" type="submit">Record wash</button></form>`, (bg, close) => {
    bg.querySelector("#wvan").onchange = e => { bg.querySelector("#wlast").textContent = lw(e.target.value); };
    bg.querySelector("#wf").onsubmit = async e => { e.preventDefault(); const b = bg.querySelector("button[type=submit]"); b.disabled = true;
      const { error } = await sb.from("van_washes").insert({ van: bg.querySelector("#wvan").value, driver: S.me.id, at: dayAt(bg.querySelector("#wday").value), note: bg.querySelector("#wnote").value || null });
      if (error) { b.disabled = false; return toast(error.message, "err"); } close(); toast("Van wash recorded 🧽", "ok"); await loadAll(); render(); };
  });
}
function vehicleCheckForm() {
  const n = nzNow(); const T = S.days[n.date]; const plates = [...new Set([...(T ? T.segs.map(x => x.shift.van) : []), ...S.shifts.filter(s => s.day <= n.date).sort((a, b) => b.day.localeCompare(a.day)).map(s => s.van)].filter(Boolean))];
  sheet(`<h3 class="lbl">Monthly vehicle check ${ib("vcheck")}</h3><p class="meta">Week 3 of the month · due Thursday 5pm · 4 photos</p>
    <form class="frm" id="vf"><label class="f full">Van<select class="in" id="van">${opt([...plates, ...Object.keys(S.vans).filter(p => !plates.includes(p) && p !== "OTHER")].map(p => [p, p]), plates[0])}</select></label>${dayPick("vday")}
    <label class="f">Odometer (km)<input class="in" id="odo" inputmode="numeric" required></label><label class="f">RUCs left (km)<input class="in" id="ruc" inputmode="numeric" placeholder="blank if petrol"></label>
    <label class="chk"><input type="checkbox" id="washed">Van washed</label><label class="chk"><input type="checkbox" id="tyres">Tyres checked &amp; OK</label><label class="chk"><input type="checkbox" id="vault">Vault OK</label>
    <label class="f">Bodywork<input class="in" id="body" placeholder="OK / describe damage"></label><label class="f full">Service due<input class="in" id="service" placeholder="e.g. 230,000 km or 15 Nov"></label>
    <label class="f full">Photos (4)<input class="in" type="file" id="photos" accept="image/*" multiple capture="environment"></label><label class="f full">Notes<textarea class="in" id="notes" rows="2"></textarea></label><button class="btn full" type="submit">Send check</button></form>`, (bg, close) => {
    bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
    bg.querySelector("#vf").onsubmit = async e => { e.preventDefault(); const b = bg.querySelector("button[type=submit]"); b.disabled = true; b.textContent = "Uploading…";
      try { const g = id => bg.querySelector("#" + id); const files = [...g("photos").files]; const van = g("van").value; const vd = g("vday").value || n.date; const wk = monOf(vd); const paths = [];
        for (const [i, f0] of files.entries()) { const f = await shrinkPhoto(f0); const path = `${van}/${wk}/${S.me.id}-${i + 1}-${Date.now()}.jpg`; const { error } = await sb.storage.from("vchk").upload(path, f, { upsert: true }); if (error) throw error; paths.push(path); }
        const { error } = await sb.from("vehicle_checks").upsert({ van, driver: S.me.id, week_start: wk, odometer: +g("odo").value || null, rucs_left: g("ruc").value ? +g("ruc").value : null, washed: g("washed").checked, tyres_ok: g("tyres").checked, vault_ok: g("vault").checked, bodywork: g("body").value || null, service_due: g("service").value || null, notes: g("notes").value || null, photos: paths, at: dayAt(vd) }, { onConflict: "van,week_start" }); if (error) throw error;
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
    <div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile"><div class="l">Result</div><div class="v" style="font-size:18px">${pill(STATE_LABEL[it.st], it.st === "ok" || it.st === "wait" ? "ok" : it.st === "miss" || it.st === "late" ? "crit" : it.st === "exc" ? "accent" : ["due", "over", "lsub"].includes(it.st) ? "grey" : "warn")}</div><div class="s">${it.st === "ok" ? "no points off" : it.st === "slow" ? "no Admin points off · shows in Efficiency" : it.st === "lsub" ? "not counted late · no points off" : it.st === "late" || it.st === "miss" ? `−${R.perEvent}% Admin` : it.st === "exc" ? "excused — doesn't count" : "not closed yet"}</div></div><div class="tile"><div class="l">Posted</div><div class="v" style="font-size:18px">${it.at != null ? fmtT(it.at % 1440) : "—"}</div><div class="s">${it.st === "slow" || it.st === "lsub" ? itemNote(it) : it.late > 0 ? `late by ${Math.floor(it.late / 60) ? Math.floor(it.late / 60) + " h " : ""}${it.late % 60} min` : it.at != null ? "on time" : it.st === "due" ? "not due yet" : "not posted"}</div></div></div>
    ${it.mark?.status ? `<p class="meta">Set by Jeremy: <b>${esc(STATE_LABEL[it.mark.status])}</b>${it.mark.note ? ` — ${esc(it.mark.note)}` : ""}</p>` : it.mark?.note ? `<p class="meta">Note from Jeremy: ${esc(it.mark.note)}</p>` : ""}
    ${it.row ? `<h4>What you sent</h4>${rawRow(it.row)}` : `<p class="meta">Nothing was posted for this.</p>`}
    ${canPost ? `<button class="btn ${it.kind === "SOD" ? "" : "accent"}" ${it.kind === "SOD" ? `data-sodv="${it.shift.id}"` : `data-eodv="${it.shift.id}" ${it.code ? "" : 'data-sort="1"'}`}>Post it now</button>` : ""}
    <div class="row"><button class="btn ghost sm" data-dayv="${it.day}">The whole day</button></div>`);
}
function effDaySheet(day) {
  const s = (S.sc && day >= S.F.from && day <= S.F.to) ? S.sc : scoreAt(day, day); const e = s.effDays.find(x => x.day === day); const R = S.C.rules;
  if (!e) return sheet(`<h3>Efficiency · ${label(day, true)}</h3><p class="meta">No run scored on this day${day < R.effStart ? ` (efficiency counts from ${label(R.effStart)})` : ""}.</p><div class="row"><button class="btn ghost sm" data-dayv="${day}">The whole day</button></div>`);
  const src = (r, k) => r.ov?.[k] != null ? `<span class="c-accent">corrected by Jeremy</span>` : r.eod?.[k] != null ? "you posted" : r.guess.includes(k) ? `<span class="c-warn">${r.evid ? "average of past EODs" : "best guess"}</span>` : "";
  const runs = (e.rows || []).map(r => `<div class="item"><div class="row" style="justify-content:space-between"><b>${esc(r.code)} <span class="meta">${esc(runName(r.code))}</span></b><span style="flex:0;white-space:nowrap">${r.trainDay ? pill("training day", "warn") : r.need.length ? pill("needs " + r.need.join(", "), "warn") : r.perf == null ? pill("—", "warn") : `<b class="c-${col(Math.min(100, r.perf))}">${Math.round(r.perf)}%</b>`}</span></div>
      <div class="meta">Expected ${(r.allowed / 60).toFixed(1)} h · actual ${r.taken ? r.taken.toFixed(1) + " h" : "—"} (${r.start != null ? fmtT(r.start) : "?"} → ${r.end != null ? fmtT(r.end) : "?"})${r.ov?.train_min ? ` · ${r.ov.train_min} min training left out` : ""}</div>
      <div class="scroll"><table class="dt"><tr><th>Part</th><th>Calculation</th><th>Min</th></tr>${r.parts.map(p => `<tr><td>${esc(p[0])}</td><td class="meta">${esc(p[1])}</td><td class="num">${p[2]}</td></tr>`).join("")}<tr><td><b>Expected</b></td><td></td><td class="num"><b>${Math.round(r.allowed)}</b></td></tr>${r.sortTaken ? `<tr><td class="meta">Team sort (${esc(r.sortRun || "SUP")})</td><td class="meta">${fmtT(r.sortFrom)}–${fmtT(r.start)} · paid, not scored · the run is timed from ${fmtT(r.start)}</td><td class="num meta">${Math.round(r.sortTaken)}</td></tr>` : ""}</table></div>
      <div class="meta">Figures: ${["parcels", "stops", "trays", "sort_min", "pickups", "pickup_parcels"].filter(k => (r.ov?.[k] ?? r.eod?.[k]) != null || r.guess.includes(k)).map(k => `${({ parcels: r.net === "tge" ? "delivery total" : "parcels", stops: r.net === "tge" ? "jobs" : "stops", trays: "trays", sort_min: "sorting min", pickups: "pick-up stops", pickup_parcels: "pick-up parcels" })[k]} ${r.ov?.[k] ?? r.eod?.[k] ?? (r.figs?.[k === "pickup_parcels" ? "pup" : k]?.v ?? "?")} (${src(r, k)})`).join(" · ") || "none yet"}</div>
      ${!r.eod && day <= today() && !S.viewAs ? `<button class="btn accent sm" data-eodv="${r.shift.id}">Post the EOD for ${esc(r.code)}</button>` : ""}</div>`).join("");
  sheet(`<h3>Efficiency · ${label(day, true)}</h3><p class="meta">${e.pending ? `<span class="c-warn">Waiting on: ${esc(e.need || "EOD")}</span>` : e.manual ? `Set by Jeremy at ${Math.round(e.v)}% for the day` : `${e.taken.toFixed(1)} h actual vs ${e.est ? "≈" : ""}${e.allowed.toFixed(1)} h expected → <b class="c-${col(Math.min(100, e.v))}">${Math.round(e.v)}%</b>${e.est ? " (a best guess filled a missing figure)" : ""}${e.extra ? ` · includes ${e.extra} min added hours` : ""}`}</p>
    ${runs}
    <div class="row"><button class="btn ghost sm" data-dayv="${day}">The whole day</button></div>`, null, { wide: true });
}
function accSheet(day, code) {
  const s = scoreAt(day, day); const a = s.accDays.find(x => x.day === day && x.code === code); const fc = a?.feed_code || S.C.runCodes[code]; const mist = S.entries.filter(e => e.kind === "mistake" && e.day === day && e.show_driver);
  sheet(`<h3>Accuracy · ${esc(code)} · ${label(day, true)}</h3><p class="meta">${esc(runName(code))}${fc ? ` · NZ Post run ${esc(fc)}` : ""}</p>
    ${a ? `<div class="tiles" style="grid-template-columns:1fr 1fr 1fr"><div class="tile"><div class="l">Items</div><div class="v">${a.items}</div></div><div class="tile"><div class="l">Scanned right</div><div class="v">${a.compliant}</div></div><div class="tile"><div class="l">Compliance</div><div class="v c-${col(a.v)}">${a.v == null ? "—" : a.v.toFixed(1) + "%"}</div></div></div>` : `<p class="meta">No NZ Post report figures for this run on this day.</p>`}
    ${mist.length ? `<h4>Mistakes recorded this day</h4><div class="list">${mist.map(m => `<div class="item crit clk" data-entryv="${m.id}">${esc(m.title)}</div>`).join("")}</div>` : ""}
    <div class="row"><button class="btn ghost sm" data-dayv="${day}">The whole day</button></div>`);
}
function entrySheet(e) {
  const K = { praise: "Nice work 👏", issue: "Heads up", note: "Note from Jeremy", mistake: "Mistake recorded", adjust: "Admin points", safety: "Safety", eff: "Efficiency set" };
  sheet(`<h3>${K[e.kind] || e.kind}</h3><p class="meta">${label(e.day, true)}${e.run ? ` · ${esc(e.run)}` : ""} · ${fmtTs(e.created_at)}</p><p><b>${esc(e.title)}</b></p>${e.note ? `<p>${esc(e.note)}</p>` : ""}${(e.photos || []).length ? `<div id="ephotos" class="row" style="flex-wrap:wrap;gap:6px"></div>` : ""}
    <dl class="kv">${e.kind === "mistake" && !e.excused ? `<dt>Effect</dt><dd>−${e.pct_off ?? S.C.rules.mistakePct}% Accuracy for the week and month it falls in</dd>` : ""}${e.excused ? `<dt>Status</dt><dd>${pill("removed — doesn't count", "accent")}</dd>` : ""}${e.admin_pts ? `<dt>Admin</dt><dd>${e.admin_pts > 0 ? "+" : ""}${e.admin_pts} points</dd>` : ""}${e.safety_pct != null ? `<dt>Safety</dt><dd>${e.safety_pct}%</dd>` : ""}${e.eff_pct != null ? `<dt>Efficiency</dt><dd>${e.eff_pct}% for that day</dd>` : ""}</dl>
    ${e.review_requested_at ? `<p class="meta">Review requested ${fmtTs(e.review_requested_at)}${e.review_note ? ` — "${esc(e.review_note)}"` : ""}${e.excused ? " · removed after review" : e.review_resolved_at ? ` · reviewed ${fmtTs(e.review_resolved_at)}, the note stands` : " · waiting for Jeremy"}</p>` : ""}
    <div class="row">${e.show_driver && !e.excused && !(e.review_requested_at && !e.review_resolved_at) && !S.viewAs ? `<button class="btn" data-review="${e.id}">Request a review</button>` : e.review_requested_at && !e.review_resolved_at ? `<span class="pill warn">review requested · waiting for Jeremy</span>` : ""}</div>`, (bg, close) => { bg.querySelector("[data-review]")?.addEventListener("click", () => { close(); reviewSheet(e.id); }); (async () => { const urls = []; for (const p of e.photos || []) { const { data } = await sb.storage.from("errs").createSignedUrl(p, 3600); if (data) urls.push(data.signedUrl); } const el = bg.querySelector("#ephotos"); if (el && urls.length) el.innerHTML = urls.map(u => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="error photo" style="width:140px;height:140px;object-fit:cover;border-radius:8px"></a>`).join(""); })(); });
}
function weekSheet(w) {
  const s = scoreAt(w, addDays(w, 6)); const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
  const tile = (l, v, sub = "") => `<div class="tile"><div class="l">${l}</div><div class="v c-${col(v)}">${pct(v)}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
  sheet(`<h3>Week of ${label(w, true)}</h3><p class="meta">${s.onTime}/${s.closed} posts on time · ${Object.values(s.days).reduce((a, x) => a + x.hours, 0).toFixed(1)} h rostered</p>
    <div class="tiles" style="grid-template-columns:1fr 1fr"><button class="tile" data-weekv="${addDays(w, -7)}" style="cursor:pointer"><div class="l">‹ week before</div><div class="s">${label(addDays(w, -7))}</div></button><button class="tile" data-weekv="${addDays(w, 7)}" style="cursor:pointer"><div class="l">week after ›</div><div class="s">${label(addDays(w, 7))}</div></button></div>
    <div class="tiles" style="grid-template-columns:1fr 1fr">${tile("Admin", s.admin, `${s.late} late · ${s.missing} missing`)}${tile("Efficiency", s.eff, `${s.effDays.filter(e => !e.pending).length} days scored`)}${tile("Accuracy", s.acc, s.feedPct != null ? `${s.accComp}/${s.accItems} compliant` : "no feed figures")}${tile("Overall", s.overall)}</div>
    <div class="scroll"><table class="dt"><tr><th>Day</th><th>Runs</th><th>Posts</th><th>Eff</th></tr>${days.map(d => { const D = s.days[d]; const e = s.effDays.find(x => x.day === d); return `<tr class="${D ? "clk" : ""}" ${D ? `data-dayv="${d}"` : ""}><td>${label(d).slice(0, 6)}</td><td class="meta">${D ? D.segs.map(x => x.sort ? (S.runsBy[x.shift.run]?.label || "Sort") : x.shift.run).join(" · ") : "off"}</td><td><span class="row" style="gap:3px">${s.items.filter(i => i.day === d).map(i => `<button class="chip ${i.st}" data-postv="${esc(i.key)}">${esc(i.label)}</button>`).join("")}</span></td><td>${e ? (e.pending ? `<span class="c-warn">waiting</span>` : `<b class="c-${col(Math.min(100, e.v))}">${Math.round(e.v)}%</b>`) : ""}</td></tr>`; }).join("")}</table></div>
    ${s.entries.filter(e => e.show_driver).length ? `<h4>From Jeremy that week</h4><div class="list">${s.entries.filter(e => e.show_driver).map(e => `<div class="item clk ${e.excused ? "accent" : e.kind === "mistake" ? "crit" : e.kind === "praise" ? "ok" : ""}" data-entryv="${e.id}">${label(e.day)} · ${esc(e.title)}</div>`).join("")}</div>` : ""}`, null, { wide: true });
}
function daySheet(day) {
  const n = nzNow(); const D = S.days[day]; const hol = S.C.holidays[day]; const isT = day === n.date; const past = day <= n.date;
  const s = past && D ? scoreAt(day, day) : null; const e = s?.effDays.find(x => x.day === day);
  const ackBy = Object.fromEntries(S.acks.map(a => [a.item_id, a])); const ch = S.changes.filter(i => i.day === day); const ents = S.entries.filter(x => x.day === day && x.show_driver); const lv = S.leave.filter(l => (l.status === "approved" || l.status === "pending") && day >= l.date_from && day <= l.date_to);
  const stat = hol?.name || statDays(+day.slice(0, 4))[day];
  const segs = D ? showSegs(D).map(x => { const code = x.shift.run; const r = S.runsBy[code]; const win = x.sort ? "" : timingRows(x, day, isT ? n.min : null);
    return `<div class="seg"><div class="tm">${fmtT(x.st)} – ${fmtT(x.en)}</div><div class="rn">${x.sort ? esc(x.lab || r?.label || "Sort") : `${esc(code)}<span class="sub">${esc(runNameDay(code, day))}</span>`}<div class="tags">${x.shift.van ? `<button class="tag van" data-vanv="${esc(x.shift.van)}" style="border:0;cursor:pointer">${esc(x.shift.van)}</button>` : ""}${x.shift.trainee ? `<span class="tag tr">training ${esc(first(S.people[x.shift.trainee]?.name || ""))}</span>` : ""}${(x.shift.addons || []).map(a => `<span class="tag">+ ${esc(S.addons.find(z => z.id === a)?.name || addName(a))}${x.shift.done?.[a] ? ` ✓ ${fmtTime(x.shift.done[a])}` : x.shift.plan?.[a] ? ` ~${fmtT(toMin(x.shift.plan[a]))}` : ""}</span>`).join("")}</div>${x.shift.note ? `<div class="meta">${esc(x.shift.note)}</div>` : ""}${win}
      ${past ? (x.sort ? (x.eod ? `<div class="meta c-ok">✓ sort finished ${fmtTime(x.eod.sent_at)}</div>` : "") : x.eod ? `<div class="meta c-ok">✓ EOD ${fmtTime(x.eod.sent_at)}${x.eod.finish_time ? ` · finished ${fmtT(toMin(x.eod.finish_time))}` : ""}${x.eod.parcels != null ? ` · ${x.eod.parcels} ${NET(code) === "tge" ? "deliveries" : "parcels"}` : ""}${x.eod.stops != null ? ` · ${x.eod.stops} ${NET(code) === "tge" ? "jobs" : "stops"}` : ""}${x.eod.edited_at ? " · edited" : ""}</div>${rawRow(x.eod)}${canEditEod(day) ? `<button class="btn ghost sm" data-eodedit="${x.shift.id}" data-sort="${x.sort ? 1 : ""}">Edit EOD</button>` : ""}` : `<div class="meta c-crit">No EOD for this run</div>${!S.viewAs ? `<button class="btn accent sm" data-eodv="${x.shift.id}">Post it now</button>` : ""}`) : ""}</div></div>`; }).join("") : "";
  const sodSeg = D?.segs.find(x => x.sod);
  sheet(`<h3>${label(day, true)}${isT ? " · today" : ""}</h3><p class="meta">${stat ? `${esc(stat)} (stat day) · ` : ""}${D ? `${fmtT(D.start)} – ${fmtT(D.end)} · ${D.hours} h rostered` : lv.some(l => l.status === "approved") ? (lv.some(l => l.type === "sick") ? "Off sick" : "On leave") : "Day off"}${e && !e.pending ? ` · efficiency <b class="c-${col(Math.min(100, e.v))}">${Math.round(e.v)}%</b>` : ""}</p>
    ${D ? `<div class="row"><button class="btn ghost sm" data-dayv="${addDays(day, -1)}">‹ ${label(addDays(day, -1)).slice(0, 6)}</button>${past ? `<button class="btn ghost sm" data-effv="${day}">Efficiency working</button>` : ""}<button class="btn ghost sm" data-weekv="${monOf(day)}">Whole week</button><button class="btn ghost sm" data-dayv="${addDays(day, 1)}">${label(addDays(day, 1)).slice(0, 6)} ›</button></div>` : `<div class="row"><button class="btn ghost sm" data-dayv="${addDays(day, -1)}">‹ ${label(addDays(day, -1)).slice(0, 6)}</button><button class="btn ghost sm" data-dayv="${addDays(day, 1)}">${label(addDays(day, 1)).slice(0, 6)} ›</button></div>`}
    ${past && D ? `<h4>Start of day</h4>${sodSeg ? `<div class="meta c-ok">✓ SOD ${fmtTime(sodSeg.sod.sent_at)}${sodSeg.sod.van ? ` · ${esc(sodSeg.sod.van)}` : ""}${sodSeg.sod.edited_at ? " · edited" : ""}</div>${sodSeg.sod.note ? `<div class="meta">${esc(sodSeg.sod.note)}</div>` : ""}` : `<div class="meta c-crit">No SOD posted</div>${!S.viewAs ? `<button class="btn sm" data-sodv="${D.segs[0].shift.id}">Post it now</button>` : ""}`}` : ""}
    ${D ? `<h4>Shifts</h4>${segs}` : ""}
    ${s && s.items.length ? `<h4>How the posts scored</h4><div class="row" style="gap:3px">${s.items.map(i => `<button class="chip ${i.st}" data-postv="${esc(i.key)}">${esc(i.label)} ${esc(itemNote(i).replace(/^posted /, ""))}</button>`).join("")}</div>` : ""}
    ${s && s.accDays.length ? `<h4>Accuracy</h4><div class="row" style="gap:3px">${s.accDays.map(a => `<button class="chip ${col(a.v) === "ok" ? "ok" : col(a.v) === "grey" ? "due" : "late"}" data-accv="${a.day}|${esc(a.code)}">${esc(a.code)} ${a.v == null ? "—" : a.v.toFixed(0) + "%"}</button>`).join("")}</div>` : ""}
    ${ch.length ? `<h4>Roster changes for this day</h4><div class="list">${ch.map(i => `<div class="item"><div>${esc(i.summary)}</div><div class="meta">sent ${fmtTs(i.roster_changes.sent_at)} · ${ackBy[i.id]?.confirmed_at ? `✓ confirmed ${fmtTs(ackBy[i.id].confirmed_at)}` : ackBy[i.id]?.dismissed_at ? "✓ cleared" : "not confirmed yet"}</div></div>`).join("")}</div>` : ""}
    ${ents.length ? `<h4>From Jeremy</h4><div class="list">${ents.map(x => `<div class="item clk ${x.excused ? "accent" : x.kind === "mistake" ? "crit" : x.kind === "praise" ? "ok" : ""}" data-entryv="${x.id}">${esc(x.title)}</div>`).join("")}</div>` : ""}
    ${eventsOn(day).length || canEvents() ? `<h4>Events</h4>${eventsOn(day).map(e => `<div class="item" style="border-left:4px solid #8b5cf6"><div class="row" style="justify-content:space-between"><b>${esc(e.title)}</b>${canEvents() ? `<button class="btn ghost sm" data-evedit="${e.id}">Edit</button>` : ""}</div><div class="meta">${e.day_to && e.day_to !== e.day ? `${label(e.day)} – ${label(e.day_to)} · ` : ""}${e.time_txt ? `${esc(e.time_txt)} · ` : ""}${EV_WHO[e.who] || "Everyone"}</div>${e.note ? `<div>${esc(e.note)}</div>` : ""}</div>`).join("")}${canEvents() ? `<button class="btn ghost sm" data-evnew="${day}">+ Add an event on this day</button>` : ""}` : ""}
    ${lv.length ? `<h4>Leave</h4><div class="list">${lv.map(l => `<div class="item ${l.status === "approved" ? "ok" : "warn"} clk" data-leavev="${l.id}">${esc(LEAVE_T[l.type] || l.type)}${l.part && l.part !== "full" ? ` · ${l.part === "AM" ? "morning" : "afternoon"}` : ""} · ${l.status === "approved" ? "approved" : "waiting for approval"}</div>`).join("")}</div>` : ""}`, null, { wide: true });
}
function vanSheet(plate) {
  const v = S.vans[plate] || {}; const t = today(); const mine = S.vchk.filter(c => c.van === plate); const use = S.shifts.filter(s => s.van === plate).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14);
  const dd = d => d ? Math.round((new Date(d) - new Date(t)) / 86400000) : null; const st = d => { const n = dd(d); return n == null ? pill("not on file", "grey") : n < 0 ? pill("overdue", "crit") : n <= 14 ? pill(`due in ${n}d`, "warn") : pill("✓", "ok"); };
  const left = !v.no_ruc && v.ruc_paid_to && v.odometer ? v.ruc_paid_to - v.odometer : null;
  sheet(`<h3><span class="plate">${esc(plate)}</span> ${esc(v.model || "")}</h3><p class="meta">${esc([v.make, v.colour].filter(Boolean).join(" · "))}</p>
    <dl class="kv"><dt>WOF</dt><dd>${v.wof_due ? label(v.wof_due, true) + " " : ""}${v.wof_failed ? pill("failed", "crit") : st(v.wof_due)}</dd><dt>Rego</dt><dd>${v.rego_due ? label(v.rego_due, true) + " " : ""}${st(v.rego_due)}</dd><dt>RUCs</dt><dd>${v.no_ruc ? "not needed (petrol)" : v.ruc_paid_to ? `paid to ${v.ruc_paid_to.toLocaleString()} km${left != null ? ` · ${left.toLocaleString()} km left ${left <= 0 ? pill("overdue", "crit") : left <= (S.C.rules.rucSoonKm || 1000) ? pill("low", "warn") : pill("✓", "ok")}` : ""}` : pill("not on file", "grey")}</dd><dt>Odometer</dt><dd>${v.odometer ? `${v.odometer.toLocaleString()} km` : "—"}${v.odometer_at ? ` <span class="meta">(${label(v.odometer_at)})</span>` : ""}</dd></dl>
    <p class="meta">🧽 ${lastWash(plate) ? `Last washed ${label(nzNow(new Date(lastWash(plate).at)).date)}` : "No wash recorded in the last 60 days"}</p>
    ${!S.viewAs ? `<div class="row"><button class="btn ghost" id="vchk-go">🚐 Do the monthly vehicle check</button><button class="btn ghost" id="wash-go">🧽 Van washed</button></div>` : ""}
    <h4>Your checks on this van</h4>${mine.length ? `<div class="scroll"><table class="dt"><tr><th>Week of</th><th>Sent</th><th>Odometer</th><th>RUCs left</th><th>Notes</th></tr>${mine.map(c => `<tr><td>${label(c.week_start)}</td><td class="mono">${fmtTs(c.at)}</td><td class="num">${c.odometer?.toLocaleString() || "—"}</td><td class="num">${c.rucs_left?.toLocaleString() || "—"}</td><td class="meta">${esc([c.washed ? "washed" : "not washed", c.tyres_ok ? "" : "tyres", c.vault_ok ? "" : "vault", c.bodywork, c.notes].filter(Boolean).join(" · "))}</td></tr>`).join("")}</table></div>` : `<p class="meta">None yet.</p>`}
    <h4>Your shifts with it</h4><div class="scroll"><table class="dt"><tr><th>Day</th><th>Run</th><th>Times</th></tr>${use.map(s => { const D = S.days[s.day]; const x = D?.segs.find(y => y.shift.id === s.id); return `<tr class="clk" data-dayv="${s.day}"><td>${label(s.day)}</td><td>${esc(s.run)}</td><td class="mono">${x ? `${fmtT(x.st)}–${fmtT(x.en)}` : ""}</td></tr>`; }).join("") || `<tr><td colspan="3" class="meta">—</td></tr>`}</table></div>`,
    (bg, close) => { bg.querySelector("#vchk-go")?.addEventListener("click", () => { close(); vehicleCheckForm(); }); bg.querySelector("#wash-go")?.addEventListener("click", () => { close(); vanWashForm(plate); }); }, { wide: true });
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
const eventsOn = d => (S.events || []).filter(e => d >= e.day && d <= (e.day_to || e.day));
const canEvents = () => !S.viewAs && !!(S.viewer || S.me)?.isStaff;   // owner and admin staff post events (database: is_boss)
const EV_WHO = { all: "Everyone", nzp: "NZ Post staff", tge: "TGE staff" };
function eventForm(ev, day) {
  const e = ev || { day, who: "all" };
  sheet(`<h3>${ev ? "Edit event" : "Add an event"}</h3><form class="frm" id="evf"><label class="f">What<input class="in" id="ev-title" required maxlength="80" value="${esc(e.title || "")}" placeholder="e.g. NZ Post staff do"></label>
    <div class="row"><label class="f" style="flex:1">Date<input class="in" type="date" id="ev-day" required value="${e.day || ""}"></label><label class="f" style="flex:1">To (optional)<input class="in" type="date" id="ev-to" value="${e.day_to || ""}"></label></div>
    <label class="f">Time / place (optional)<input class="in" id="ev-time" maxlength="80" value="${esc(e.time_txt || "")}" placeholder="e.g. 6pm at the depot"></label>
    <label class="f">For<select class="in" id="ev-who">${Object.entries(EV_WHO).map(([k, v]) => `<option value="${k}" ${e.who === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="f">Details (optional)<textarea class="in" id="ev-note" rows="3">${esc(e.note || "")}</textarea></label>
    <div class="row"><button class="btn" type="submit">${ev ? "Save" : "Add to calendar"}</button>${ev ? `<button class="btn ghost" type="button" id="ev-del">Delete</button>` : ""}</div></form>`, (bg, close) => {
    bg.querySelector("#evf").onsubmit = async x => { x.preventDefault(); const g = id => bg.querySelector(id).value.trim();
      const row = { title: g("#ev-title"), day: g("#ev-day"), day_to: g("#ev-to") && g("#ev-to") > g("#ev-day") ? g("#ev-to") : null, time_txt: g("#ev-time") || null, who: g("#ev-who"), note: g("#ev-note") || null };
      const { error } = ev ? await sb.from("calendar_events").update(row).eq("id", ev.id) : await sb.from("calendar_events").insert({ ...row, created_by: (S.viewer || S.me).id });
      if (error) return toast(error.message, "err"); toast(ev ? "Saved" : "Added to the calendar", "ok"); close(); $$(".sheet-bg").forEach(b => b.remove()); await loadAll(); render(); };
    bg.querySelector("#ev-del")?.addEventListener("click", async () => { if (!confirm("Delete this event?")) return; const { error } = await sb.from("calendar_events").delete().eq("id", ev.id); if (error) return toast(error.message, "err"); toast("Deleted", "ok"); close(); $$(".sheet-bg").forEach(b => b.remove()); await loadAll(); render(); });
  });
}
function calendarCard(t) {
  const mon = S.calMonth || t.slice(0, 7); const [y, m] = mon.split("-").map(Number);
  const stats = { ...statDays(y), ...Object.fromEntries(Object.entries(S.C.holidays || {}).map(([d, h]) => [d, h.name])) };
  const leave = S.leave.filter(l => l.status === "approved" || l.status === "pending");
  const first = `${mon}-01`; const start = monOf(first); const last = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  const cells = []; for (let d = start; d <= last || dow(d) !== 0; d = addDays(d, 1)) cells.push(d);
  const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const cell = d => { const out = d.slice(0, 7) !== mon; const st = stats[d]; const lv = leave.find(l => d >= l.date_from && d <= l.date_to); const ev = eventsOn(d); const D = S.days[d];
    const sick = lv?.type === "sick"; const cls = [out ? "out" : "", d === t ? "now" : "", st ? "stat" : "", lv ? (sick ? "lv-sick" : lv.status === "approved" ? "lv-ok" : "lv-wait") : "", ev.length ? "ev" : "", D ? "rost" : ""].join(" ");
    const tip = [st, ...ev.map(e => e.title), lv ? `${LEAVE_T[lv.type] || lv.type} (${lv.status === "approved" ? "approved" : "waiting for approval"})` : "", D ? showSegs(D).filter(x => !x.sort).map(x => x.shift.run).join(", ") : ""].filter(Boolean).join(" · ");
    const tag = st ? "stat" : ev.length ? ev[0].title : lv ? (sick ? "sick" : lv.status === "approved" ? "leave" : "asked") : D ? showSegs(D).filter(x => !x.sort).map(x => x.shift.run).join(" ") || "sort" : "";
    return `<div class="cd ${cls}" data-dayv="${d}" title="${esc(tip || "Tap for this day")}"><span>${+d.slice(8)}</span>${tag ? `<i>${esc(tag)}</i>` : ""}</div>`; };
  const inMonth = d => d.slice(0, 7) === mon;
  const statList = Object.entries(stats).filter(([d]) => inMonth(d)).sort();
  const lvList = leave.filter(l => l.date_to >= first && l.date_from <= last);
  const evList = (S.events || []).filter(e => (e.day_to || e.day) >= first && e.day <= last);
  return `<div class="card" id="cal"><h2>Calendar<span><button class="ar" data-cal="-1">‹</button> ${MON[m - 1]} ${y} <button class="ar" data-cal="1">›</button></span></h2>
    <div class="calg">${["M","T","W","T","F","S","S"].map(x => `<div class="ch">${x}</div>`).join("")}${cells.map(cell).join("")}</div>
    <div class="calk"><span><b class="k stat"></b>Stat day</span><span><b class="k ev"></b>Event</span><span><b class="k lv-sick"></b>Sick</span><span><b class="k lv-ok"></b>Leave approved</span><span><b class="k lv-wait"></b>Leave waiting</span></div>
    ${canEvents() ? `<button class="btn ghost sm" data-evnew="${mon === t.slice(0, 7) ? t : first}" style="margin-top:6px">+ Add an event</button>` : ""}
    ${statList.length || lvList.length || evList.length ? `<div class="list" style="margin-top:6px">${evList.map(e => `<div class="item clk" style="padding:6px 10px;border-left:4px solid #8b5cf6" data-dayv="${e.day}"><b>${label(e.day)}${e.day_to && e.day_to !== e.day ? ` – ${label(e.day_to)}` : ""}</b>${e.time_txt ? ` · ${esc(e.time_txt)}` : ""} · ${esc(e.title)}${e.who !== "all" ? ` <span class="meta">(${e.who === "nzp" ? "NZ Post staff" : "TGE staff"})</span>` : ""}</div>`).join("")}${statList.map(([d, n]) => `<div class="item accent" style="padding:6px 10px"><b>${label(d)}</b> · ${esc(n)}</div>`).join("")}${lvList.map(l => `<div class="item clk ${l.status === "approved" ? "ok" : "warn"}" style="padding:6px 10px" data-leavev="${l.id}"><b>${label(l.date_from)}${l.date_to !== l.date_from ? ` – ${label(l.date_to)}` : ""}</b> · ${esc(LEAVE_T[l.type] || l.type)} · ${l.status === "approved" ? "approved" : "waiting for approval"}</div>`).join("")}</div>` : `<p class="hint">No events, stat days or leave this month.</p>`}</div>`;
}
function leaveSheet(l) {
  const days = []; for (let d = l.date_from; d <= l.date_to && days.length < 31; d = addDays(d, 1)) days.push(d); const clash = days.filter(d => S.days[d]);
  sheet(`<h3>${esc(LEAVE_T[l.type] || l.type)}</h3><p class="meta">${label(l.date_from, true)}${l.date_to !== l.date_from ? ` – ${label(l.date_to, true)}` : ""}${l.part !== "full" ? ` · ${l.part === "AM" ? "morning off" : "afternoon off"}` : ""} · asked ${fmtTs(l.created_at)}</p>
    <dl class="kv"><dt>Status</dt><dd>${pill(l.status, l.status === "approved" ? "ok" : l.status === "declined" ? "crit" : l.status === "pending" ? "warn" : "grey")}${l.decided_at ? ` <span class="meta">${fmtTs(l.decided_at)}</span>` : ""}</dd>${l.notes ? `<dt>Your note</dt><dd>${esc(l.notes)}</dd>` : ""}${l.reply ? `<dt>Reply</dt><dd>${esc(l.reply)}</dd>` : ""}<dt>Received email</dt><dd>${l.acked_email_at ? "sent " + fmtTs(l.acked_email_at) : "on its way"}</dd></dl>
    ${clash.length ? `<p class="meta">${l.status === "approved" ? "You're still showing on the roster for" : "You're currently rostered on"} ${clash.map(d => `<button class="linkbtn" data-dayv="${d}">${label(d)}</button>`).join(", ")}${l.status === "approved" ? " — check with Jeremy." : "."}</p>` : ""}
    <p class="hint">${l.status === "pending" ? "Waiting for Jeremy." : l.status === "approved" ? "On the roster." : l.status === "declined" ? "Call Jeremy to talk about it." : ""}</p>`);
}
/* ---------- Weekly roster brief: pops up until every section is ticked Read and Submit is tapped ---------- */
function myBrief() {   // newest brief per week; the one to show is the newest not yet submitted, else the newest for this week or later
  const by = {}; for (const m of (S.briefs || [])) { const w = m.messages.week_start; if (!by[w] || m.messages.created_at > by[w].messages.created_at) by[w] = m; }
  const L = Object.values(by).filter(m => m.messages.week_start >= addDays(monOf(today()), -7)).sort((a, b) => b.messages.week_start.localeCompare(a.messages.week_start));
  return L.find(m => !m.confirmed_at) || L.find(m => m.messages.week_start >= monOf(today())) || null;
}
function briefParts(body) {   // intro (before the first ## heading) + one section per heading
  const secs = []; let intro = []; let cur = null;
  for (const l of String(body || "").split(/\r?\n/)) { const h = /^#{1,3}\s+(.*)$/.exec(l.trim()); if (h) { cur = { title: h[1].replace(/\*\*/g, ""), lines: [] }; secs.push(cur); } else (cur ? cur.lines : intro).push(l); }
  return { intro: intro.join("\n").trim(), secs: secs.map(x => ({ title: x.title, text: x.lines.join("\n").trim() })) };
}
function briefCard() {   // only while a brief still needs reading; once submitted it drops down to the "This week's notes" row
  const m = myBrief(); if (!m || m.confirmed_at) return ""; const n = briefParts(m.messages.body).secs.length;
  return `<div class="card hot" id="brief"><h2 class="c-crit">${esc(m.messages.title || "Roster brief")}<span>${n} section${n === 1 ? "" : "s"} to read</span></h2>
    <p class="meta">Read each section, tick Read, then Submit. Jeremy can see who has read it.</p><button class="btn full crit" data-brief="${m.message_id}">Read my roster brief</button></div>`;
}
/* "This week's notes": a folded-style row near the end of the page; opens the brief for last / this / next week */
const NOTE_WEEKS = () => { const w = monOf(today()); return [["last", "Last week", addDays(w, -7)], ["this", "This week", w], ["next", "Next week", addDays(w, 7)]]; };
function briefFor(w) { let b = null; for (const m of (S.briefs || [])) if (m.messages.week_start === w && (!b || m.messages.created_at > b.messages.created_at)) b = m; return b; }
const notesBtn = () => `<a class="card rbrow" role="button" tabindex="0" style="cursor:pointer" data-notes="1"><h2>This week's notes<span>last · this · next week</span><i class="fchev" aria-hidden="true"></i></h2></a>`;
function notesTabs(w) {
  return `<div class="seg-btns" style="margin:0 0 12px">${NOTE_WEEKS().map(([, l, d]) => `<button class="${d === w ? "on" : ""}" data-nwk="${d}">${l}</button>`).join("")}</div>`;
}
function notesSheet(w) {
  const W = NOTE_WEEKS(); if (!w) w = (W.find(([k, , d]) => k === "this" && briefFor(d)) || W.find(([k, , d]) => k === "next" && briefFor(d)) || W.find(([, , d]) => briefFor(d)) || W[1])[2];
  const m = briefFor(w); if (m) return briefSheet(m, w);
  sheet(`<h3>Week of ${label(w, true)}</h3>${notesTabs(w)}<p class="hint">No notes for this week${w > monOf(today()) ? " yet" : ""}.</p>`, bg => notesWire(bg), { wide: true });
}
function notesWire(bg) { bg.querySelectorAll("[data-nwk]").forEach(b => b.onclick = () => { if (b.classList.contains("on")) return; bg._close(); notesSheet(b.dataset.nwk); }); }
function briefPop() {
  const m = myBrief(); if (S.viewAs || !m || m.confirmed_at || document.querySelector(".sheet-bg")) return;
  S.briefShown ||= {}; if (S.briefShown[m.message_id]) return; S.briefShown[m.message_id] = 1; briefSheet(m);
}
function briefSheet(m, wk) {   // wk: opened from "This week's notes" (adds the week tabs)
  const { intro, secs } = briefParts(m.messages.body); const done = !!m.confirmed_at; const K = "tp-brief-" + m.message_id;
  let ticks = {}; try { ticks = JSON.parse(localStorage.getItem(K) || "{}"); } catch { }
  if (!m.read_at && !S.viewAs) sb.from("message_recipients").update({ read_at: new Date().toISOString() }).eq("message_id", m.message_id).eq("person", S.me.id).then(() => { });
  const all = () => secs.every((_, i) => done || ticks[i]);
  sheet(`<h3>${esc(m.messages.title || "Roster brief")}</h3>${wk ? notesTabs(wk) : ""}${intro ? briefHtml(intro) : ""}
    ${secs.map((x, i) => `<div class="item ${done || ticks[i] ? "ok" : "warn"}" data-bsec="${i}" style="margin-bottom:8px"><b>${esc(x.title)}</b>${briefHtml(x.text)}
      ${done ? `<p class="meta c-ok">✓ Read</p>` : `<button class="btn sm ${ticks[i] ? "ghost" : ""}" data-bread="${i}">${ticks[i] ? "✓ Read" : "Read"}</button>`}</div>`).join("")}
    ${done ? `<p class="meta c-ok">✓ Submitted ${fmtTs(m.confirmed_at)}</p>` : S.viewAs ? "" : `<button class="btn full" id="b-submit" ${all() ? "" : "disabled"}>Submit · I've read and understood my roster</button><p class="hint" id="b-left">${all() ? "" : "Tick Read on every section to submit."}</p>`}`,
  (bg, close) => {
    if (wk) notesWire(bg);
    bg.querySelectorAll("[data-bread]").forEach(b => b.onclick = () => { const i = +b.dataset.bread; ticks[i] = !ticks[i]; localStorage.setItem(K, JSON.stringify(ticks));
      b.textContent = ticks[i] ? "✓ Read" : "Read"; b.classList.toggle("ghost", !!ticks[i]); const it = b.closest("[data-bsec]"); it.classList.toggle("ok", !!ticks[i]); it.classList.toggle("warn", !ticks[i]);
      const go = bg.querySelector("#b-submit"); if (go) go.disabled = !all(); const lf = bg.querySelector("#b-left"); if (lf) lf.textContent = all() ? "" : "Tick Read on every section to submit.";
      if (ticks[i]) { const nx = bg.querySelector(`[data-bsec="${i + 1}"]`); nx?.scrollIntoView({ behavior: "smooth", block: "nearest" }); } });
    bg.querySelector("#b-submit")?.addEventListener("click", async e => { e.target.disabled = true; const now = new Date().toISOString();
      const { error } = await sb.from("message_recipients").update({ confirmed_at: now, read_at: m.read_at || now }).eq("message_id", m.message_id).eq("person", S.me.id);
      if (error) { e.target.disabled = false; return toast("Couldn't send. Try again.", "err"); } m.confirmed_at = now; close(); toast("Thanks, submitted ✓", "ok"); render(); });
  }, { wide: true });
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
    locWatch = navigator.geolocation.watchPosition(p => { lastPos = p; hazardNear(p); const now = Date.now(); if (now - lastSent > 120000) send(p); }, () => { }, { enableHighAccuracy: true, maximumAge: 60000 });
    S.locTimer = setInterval(() => { if (lastPos && Date.now() - lastSent > 120000) send(lastPos); }, 60000);
  } else if (!should && locWatch) { navigator.geolocation.clearWatch(locWatch); locWatch = null; clearInterval(S.locTimer); S.locOn = false; }
  function send(p) { lastSent = Date.now(); sb.from("locations").insert({ driver: S.me.id, shift_id: S.locShift, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading }).then(() => { }); }
}

/* ================= hazard register: drivers report dogs, aggressive people, bad driveways, ice… and see what's on today's runs ================= */
const HZ_KINDS = [["dog", "🐕 Dog"], ["person", "😠 Aggressive person"], ["driveway", "⛰️ Steep / tight driveway"], ["access", "🚧 Access / no-go"], ["ice", "🧊 Ice / slippery"], ["road", "🚗 Road / traffic"], ["rail", "🚆 Rail crossing"], ["lifting", "📦 Lifting / slips"], ["info", "ℹ️ Info"], ["other", "❓ Other"]];
const HZ_PICK = ["dog", "person", "driveway", "access", "ice", "road", "other"];
const hzLabel = k => (HZ_KINDS.find(x => x[0] === k) || [k, k])[1];
const HZ_SEV = { high: ["High", "crit"], medium: ["Medium", "warn"], low: ["Low", "grey"] };
const hzSev = s => pill(HZ_SEV[s]?.[0] || s, HZ_SEV[s]?.[1] || "");
const hzDist = (h, p) => { if (h.lat == null || !p) return Infinity; const R = 6371e3, r = x => x * Math.PI / 180, a = p.coords.latitude, b = p.coords.longitude;
  const d = Math.sin(r(h.lat - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(h.lat)) * Math.sin(r(h.lng - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(d)); };
const hzRow = h => `<button class="hzrow" data-hz="${h.id}" type="button"><span class="hzsev ${h.severity}"></span><span class="hzbody"><b>${esc(h.address)}</b>${h.area ? ` <span class="meta">${esc(h.area)}</span>` : ""}<br><span class="meta">${(h.kinds || []).map(hzLabel).join(" · ")}${h.rule && h.rule !== "INFO" ? ` · <b>${esc(h.rule)}</b>` : ""} · ${esc(h.note || "")}</span></span></button>`;
const hzToday = T => { const codes = new Set(T ? T.segs.map(x => x.shift.run) : []); return (S.hazards || []).filter(h => (h.runs || []).some(c => codes.has(c))); };
/** a confirmation counts for 30 days, and only if the hazard hasn't changed since */
const HZ_ACK_DAYS = 30;
const hzOk = h => { if (!S.hzAckOn) return true; const a = S.hzAcks?.[h.id]; return !!a && a >= (h.updated_at || h.created_at) && Date.now() - new Date(a) < HZ_ACK_DAYS * 86400e3; };
async function hazardAck(ids) {
  const now = new Date().toISOString(); for (const id of ids) (S.hzAcks ||= {})[id] = now; render();
  const { error } = await sb.from("hazard_acks").upsert(ids.map(id => ({ hazard_id: id, driver: S.me.id, acked_at: now })), { onConflict: "hazard_id,driver" });
  if (error) { toast("Couldn't save. Try again.", "err"); await loadAll(); render(); } else toast(ids.length > 1 ? `${ids.length} hazards confirmed ✓` : "Confirmed ✓", "ok");
}
function hazardsCard(T) {
  const all = S.hazards || []; const today = hzToday(T).filter(h => h.severity !== "low");
  const near = lastPos ? all.filter(h => h.severity !== "low" && hzDist(h, lastPos) < 250).sort((a, b) => hzDist(a, lastPos) - hzDist(b, lastPos)) : [];
  const ord = { high: 0, medium: 1, low: 2 }; today.sort((a, b) => ord[a.severity] - ord[b.severity] || a.address.localeCompare(b.address));
  const todo = today.filter(h => !hzOk(h)), done = S.hzAckOn ? today.filter(hzOk) : [];
  const line = (h, ack) => `<div class="hzline">${hzRow(h)}${ack ? `<button class="btn sm hzack" data-hzack="${h.id}" type="button">✓ Read</button>` : `<span class="hzok" title="Confirmed">✓</span>`}</div>`;
  const runs = T ? T.segs.length > 1 ? "today's runs" : "today's run" : "";
  return `<div class="card" id="hazards"><h2>⚠️ Hazards ${ib("hazards")}<span>${todo.length ? `<b class="c-crit">${todo.length} to confirm</b>` : `${all.length} on the register`}</span></h2>
    ${near.length ? `<div class="hznear"><b>Near you now</b>${near.slice(0, 3).map(hzRow).join("")}</div>` : ""}
    ${T ? (todo.length ? `<div class="hzlist">${todo.slice(0, S.hzMore ? 999 : 8).map(h => line(h, true)).join("")}</div>
        ${todo.length > 8 && !S.hzMore ? `<button class="btn ghost sm" id="hz-more" type="button">Show all ${todo.length}</button>` : ""}
        ${todo.length > 1 ? `<button class="btn full" id="hz-ackall" data-ids="${todo.map(h => h.id).join(",")}" type="button" style="margin-top:6px">✓ I've read all ${todo.length}</button>` : ""}`
      : today.length && !S.hzAckOn ? `<div class="hzlist">${today.slice(0, 8).map(hzRow).join("")}</div>` : today.length ? `<p class="meta">All ${today.length} high and medium hazards on ${runs} confirmed ✓</p>` : `<p class="meta">Nothing high or medium on ${runs}.</p>`) : ""}
    ${done.length ? `<details style="margin-top:6px"><summary class="meta">Confirmed (${done.length})</summary><div class="hzlist" style="margin-top:6px">${done.map(h => line(h, false)).join("")}</div></details>` : ""}
    <div class="row" style="margin-top:8px"><button class="btn warn" id="hz-new" type="button">⚠️ Report a hazard</button><button class="btn ghost" id="hz-all" type="button">🔎 Search all</button></div></div>`;
}
document.addEventListener("click", e => { if (e.target.id === "hz-more") { S.hzMore = true; render(); } });
function hazardDetail(id) {
  const h = (S.hazards || []).find(x => x.id === id); if (!h) return;
  const who = h.reported_by ? S.people[h.reported_by]?.name || h.reported_by : null;
  sheet(`<h3>${esc(h.address)}</h3><p>${hzSev(h.severity)} ${(h.kinds || []).map(k => pill(hzLabel(k))).join(" ")}${h.rule ? " " + pill(h.rule, h.rule === "NO-GO" ? "crit" : "") : ""}</p>
    ${h.area ? `<p class="meta">${esc(h.area)}${(h.runs || []).length ? ` · runs: ${esc(h.runs.join(", "))}` : ""}</p>` : ""}
    ${h.note ? `<p><b>Hazard:</b> ${esc(h.note)}</p>` : ""}${h.control ? `<p><b>What to do:</b> ${esc(h.control)}</p>` : ""}
    <p class="meta">${who ? `Reported by ${esc(first(who))} · ` : ""}${h.ref ? esc(h.ref) + " · " : ""}${esc(h.source || "")}${h.created_at ? ` · ${label(nzNow(new Date(h.created_at)).date)}` : ""}</p>
    ${h.lat != null ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://maps.google.com/?q=${h.lat},${h.lng}">📍 Open in Maps</a>` : ""}`);
}
function hazardList() {
  const all = S.hazards || [];
  sheet(`<h3>🔎 Hazard register</h3><input class="in" id="hzq" placeholder="Street, suburb, dog, ice…" autocomplete="off"><label class="chk" style="margin:8px 0"><input type="checkbox" id="hzlow">Include low / info</label><div id="hzres" class="hzlist"></div>`, (bg, close) => {
    const q = bg.querySelector("#hzq"), lo = bg.querySelector("#hzlow"), out = bg.querySelector("#hzres");
    const draw = () => { const t = q.value.trim().toLowerCase(); const ord = { high: 0, medium: 1, low: 2 };
      const res = all.filter(h => (lo.checked || h.severity !== "low") && (!t || [h.address, h.area, h.note, h.control, h.rule, ...(h.kinds || []).map(hzLabel), ...(h.runs || [])].join(" ").toLowerCase().includes(t)))
        .sort((a, b) => ord[a.severity] - ord[b.severity] || a.address.localeCompare(b.address));
      out.innerHTML = res.length ? res.slice(0, 150).map(hzRow).join("") + (res.length > 150 ? `<p class="meta">…and ${res.length - 150} more. Type to narrow it down.</p>` : "") : `<p class="meta">Nothing matches.</p>`;
      out.querySelectorAll("[data-hz]").forEach(b => b.onclick = () => { close(); hazardDetail(b.dataset.hz); }); };
    q.oninput = draw; lo.onchange = () => { lo.parentElement.classList.toggle("on", lo.checked); draw(); }; draw(); setTimeout(() => q.focus(), 50);
  }, { wide: true });
}
function hazardForm() {
  const n = nzNow(); const T = S.days[n.date]; const runs = T ? [...new Set(T.segs.filter(x => !x.sort).map(x => x.shift.run))] : [];
  const known = [...new Set((S.hazards || []).map(h => h.address).filter(a => /^\d/.test(a)))].sort();
  let pos = null;
  sheet(`<h3>⚠️ Report a hazard</h3><form class="frm" id="hzf">
    <div class="f full">What is it?<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">${HZ_PICK.map(k => `<label class="chk"><input type="checkbox" name="kind" value="${k}">${hzLabel(k)}</label>`).join("")}</div></div>
    <label class="f full">Address<input class="in" id="hzaddr" list="hzknown" placeholder="e.g. 57 Stevenson Avenue" required autocomplete="off"><datalist id="hzknown">${known.map(a => `<option value="${esc(a)}">`).join("")}</datalist></label>
    <div class="full"><button class="btn ghost sm" id="hzgps" type="button">📍 Use where I am</button> <span class="meta" id="hzgpsmsg"></span></div>
    <label class="f full">How bad?<select class="in" id="hzsev"><option value="high">High – don't go near it</option><option value="medium" selected>Medium – take care / card it</option><option value="low">Low – good to know</option></select></label>
    <label class="f full">What happened? (optional)<textarea class="in" id="hznote" rows="3" placeholder="Tap the 🎤 on your keyboard to say it instead of typing"></textarea></label>
    ${runs.length ? `<p class="meta full">Will be added to: ${esc(runs.join(", "))}</p>` : ""}
    <button class="btn warn full" type="submit">Send hazard</button></form>`, (bg, close) => {
    bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
    const msg = bg.querySelector("#hzgpsmsg"), addr = bg.querySelector("#hzaddr");
    const fill = async p => { pos = p; msg.textContent = "Finding the address…";
      try { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${p.coords.latitude}&lon=${p.coords.longitude}`, { headers: { "Accept-Language": "en-NZ" } }); const j = await r.json(); const a = j.address || {};
        const line = [a.house_number, a.road].filter(Boolean).join(" "); if (line && !addr.value) addr.value = line; msg.textContent = line ? `${[a.suburb || a.village || a.town, a.city].filter(Boolean).join(", ")} · check the number` : "Location saved. Type the address.";
      } catch { msg.textContent = "Location saved. Type the address."; } };
    bg.querySelector("#hzgps").onclick = () => { if (lastPos && Date.now() - lastPos.timestamp < 120000) return fill(lastPos); if (!("geolocation" in navigator)) return (msg.textContent = "No GPS on this phone.");
      msg.textContent = "Getting your location…"; navigator.geolocation.getCurrentPosition(fill, () => { msg.textContent = "Couldn't get your location. Type the address."; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }); };
    if (lastPos && Date.now() - lastPos.timestamp < 120000) fill(lastPos);
    bg.querySelector("#hzf").onsubmit = async e => { e.preventDefault(); const b = bg.querySelector("button[type=submit]");
      const kinds = [...bg.querySelectorAll("input[name=kind]:checked")].map(i => i.value); if (!kinds.length) return toast("Pick what the hazard is", "err");
      b.disabled = true; const sev = bg.querySelector("#hzsev").value; const note = bg.querySelector("#hznote").value.trim();
      const { data, error } = await sb.from("hazards").insert({ address: addr.value.trim(), kinds, severity: sev, note: note || null, runs, area: null, lat: pos?.coords.latitude ?? null, lng: pos?.coords.longitude ?? null, geo_precision: pos ? "gps" : null, source: "Driver app", reported_by: S.me.id }).select("id").single();
      if (error) { b.disabled = false; return toast(error.message, "err"); }
      if (data?.id && !DEMO) sb.functions.invoke("notify", { body: { type: "hazard", id: data.id } }).catch(() => { });
      close(); toast(sev === "high" ? "Hazard sent – Jeremy has been told ⚠️" : "Hazard added to the register ✓", "ok"); await loadAll(); render(); };
  });
}
/** on each GPS fix: a quick heads-up the first time a driver comes within ~150 m of a medium/high hazard that has a location */
function hazardNear(p) { const seen = S.hzSeen ||= {};
  for (const h of S.hazards || []) { if (h.severity === "low" || seen[h.id] || hzDist(h, p) > 150) continue; seen[h.id] = 1;
    toast(`⚠️ ${h.address}: ${h.note || (h.kinds || []).map(hzLabel).join(", ")}`, h.severity === "high" ? "err" : ""); try { navigator.vibrate?.([200, 100, 200]); } catch { } render(true); break; } }
