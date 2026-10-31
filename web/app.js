// Taieri Post · driver app
import { sb, q, me, nzNow, today, addDays, dow, dayName, monOf, label, longLabel, toMin, fmtT, fmtTs, fmtTime, ago, esc, $, $$, h, toast, pill, first, col, pct, live, debounce, isSort, enablePush, pushState, nzToIso, settings as loadSettings, signOut } from "/shared/core.js";
import { requireUser } from "/shared/auth.js";
import { VAPID_PUBLIC } from "/shared/config.js";
import { cfg, dayShifts, itemsFor, scoreFor, fortnight, itemNote, STATE_LABEL, addName, NET, PICKUP_RUNS, LEG_RUNS, effCalc } from "/shared/score.js";

const app = $("#app");
const S = { me: null, set: {}, C: null, runs: [], runsBy: {}, vans: {}, addons: [], rules: [], people: {}, shifts: [], sods: [], eods: [], marks: [], entries: [], feed: [], changes: [], acks: [], msgs: [], leave: [], alerts: [], loc: null, gotit: {} };
try { S.gotit = JSON.parse(localStorage.getItem("tp-gotit") || "{}"); } catch { }

/* ================= boot ================= */
(async () => {
  try { S.me = await requireUser(app); } catch { return; }
  await viewAs();
  await loadAll();
  render();
  window.addEventListener("hashchange", async () => { await viewAs(); await loadAll(); render(); });
  live(["shifts", "sod", "eod", "alerts", "roster_changes", "roster_change_items", "change_acks", "messages", "message_recipients", "leave_requests", "entries", "marks", "vans", "settings", "timing_rules", "addons"], debounce(async () => { await loadAll(); render(); }, 400), "drv");
  setInterval(render, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadAll().then(render); } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { });
})();

async function loadAll() {
  const m = S.me.id; const t = today(); const from = addDays(monOf(t), -7), to = addDays(monOf(t), 13);
  const [set, runs, vans, addons, rules, people, shifts, changes, acks, msgs, leave, alerts, entries, marks, feed] = await Promise.all([
    loadSettings(), q(sb.from("runs").select("*")), q(sb.from("vans").select("*")), q(sb.from("addons").select("*")), q(sb.from("timing_rules").select("*").eq("active", true)),
    q(sb.from("people").select("id,name,role")),
    q(sb.from("shifts").select("*").gte("day", from).lte("day", to).or(`driver.eq.${m},trainee.eq.${m}`)),
    q(sb.from("roster_change_items").select("*, roster_changes!inner(status, sent_at, created_by)").contains("affects", [m]).eq("roster_changes.status", "sent").gte("day", addDays(t, -7))),
    q(sb.from("change_acks").select("*").eq("driver", m)),
    q(sb.from("message_recipients").select("*, messages!inner(*)").eq("person", m).order("created_at", { referencedTable: "messages", ascending: false }).limit(30)),
    q(sb.from("leave_requests").select("*").eq("driver", m).order("created_at", { ascending: false }).limit(20)),
    q(sb.from("alerts").select("*").eq("driver", m).is("resolved_at", null).order("created_at", { ascending: false })),
    q(sb.from("entries").select("*").eq("driver", m).gte("day", from)),
    q(sb.from("marks").select("*").eq("driver", m)),
    q(sb.from("nzpost_feed").select("*").gte("day", from)),
  ]);
  S.set = set; S.C = cfg(set); S.runs = runs; S.runsBy = Object.fromEntries(runs.map(r => [r.code, r])); S.vans = Object.fromEntries(vans.map(v => [v.plate, v])); S.addons = addons; S.rules = rules;
  S.people = Object.fromEntries(people.map(p => [p.id, p])); S.shifts = shifts.filter(s => s.driver === m); S.trainee = shifts.filter(s => s.trainee === m && s.driver !== m);
  S.changes = changes; S.acks = acks; S.msgs = msgs; S.leave = leave; S.alerts = alerts; S.entries = entries; S.marks = marks; S.feed = feed;
  const ids = S.shifts.map(s => s.id);
  if (ids.length) { const [sods, eods] = await Promise.all([q(sb.from("sod").select("*").in("shift_id", ids)), q(sb.from("eod").select("*").in("shift_id", ids))]); S.sods = sods; S.eods = eods; } else { S.sods = []; S.eods = []; }
  S.days = dayShifts(S.shifts, S.runsBy, m);
  for (const d of Object.values(S.days)) for (const x of d.segs) { x.sod = S.sods.find(s => s.shift_id === x.shift.id); x.eod = S.eods.find(e => e.shift_id === x.shift.id); }
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
  S.drivers = S.viewer.isStaff ? await q(sb.from("people").select("id,name,role").eq("active", true).eq("cleared", false).order("name")) : [];
}
function viewBar() {
  if (!S.viewer?.isStaff) return "";
  const list = S.drivers.filter(d => d.id !== S.viewer.id);
  const i = S.viewAs ? list.findIndex(d => d.id === S.viewAs.id) : -1;
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  return `<div class="card" style="position:sticky;top:6px;z-index:5;border:2px solid var(--accent);background:var(--accent-fill);padding:8px 12px;gap:6px">
    <div class="row" style="align-items:center"><span class="mono" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);flex:0">${S.viewAs ? "Viewing as" : "View as"}</span>
      <select class="in" id="view-as" style="min-height:38px;font-size:14px;flex:1 1 140px"><option value="">— me (${esc(first(S.viewer.name))}) —</option>${list.map(d => `<option value="${d.id}" ${S.viewAs?.id === d.id ? "selected" : ""}>${esc(d.name)}${d.role !== "driver" ? ` (${d.role})` : ""}</option>`).join("")}</select>
      <button class="btn ghost sm" id="va-prev" ${prev ? `data-id="${prev.id}"` : "disabled"} style="flex:0">‹</button><button class="btn ghost sm" id="va-next" ${next ? `data-id="${next.id}"` : "disabled"} style="flex:0">›</button>
      <a class="btn ghost sm" href="/admin/" style="flex:0;text-decoration:none">Owner portal</a></div>
    ${S.viewAs ? `<div class="hint">This is exactly what ${esc(first(S.viewAs.name))} sees. You can post a SOD or EOD on their behalf; the other buttons are theirs alone.</div>` : ""}</div>`;
}

/* ================= render ================= */
function render() {
  const n = nzNow(); const t = n.date; const name = first(S.me.name);
  const greet = n.min < 720 ? "Morning" : n.min < 1020 ? "Hi" : "Evening";
  const T = S.days[t];
  const nextDay = Object.values(S.days).filter(d => d.day > t).sort((a, b) => a.day < b.day ? -1 : 1)[0];
  app.innerHTML = `<div class="wrap">
    ${viewBar()}
    <div class="top"><div><div class="brand">Taieri Post · driver portal${S.viewAs ? " · viewing as " + esc(first(S.viewAs.name)) : ""}</div><h1>${greet} ${esc(name)} 👋</h1></div><div class="upd"><span class="dot live"></span>live<br>${fmtT(n.min)}</div></div>
    ${rosterChanges(n)}
    ${fromJeremy()}
    ${alertsCard()}
    ${messagesCard()}
    <div class="grid2">${todayCard(T, nextDay, n)}${vanCard(T, nextDay)}<div class="span">${shiftsCard(t)}</div></div>
    ${addonsCard(T, nextDay, n)}
    ${scoresCard()}
    ${toFixCard(n)}
    ${leaveCard()}
    ${detailsCard()}
    ${moreCard()}
    <p class="foot">Shift or score looks wrong? Message Jeremy.<br>Signed in as ${esc((S.viewer || S.me).email || "")}</p>
  </div>`;
  wire();
}

/* ---------- Roster changes ---------- */
function linePast(item, n) {
  if (item.day < n.date) return true; if (item.day > n.date) return false;
  const st = toMin(item.after?.start_at) ?? toMin(item.before?.start_at) ?? (() => { const w = S.runsBy[item.run]?.windows?.[dayName(item.day)]; return w ? toMin(w[0][0]) : null; })();
  return st != null ? n.min >= st : false;
}
function rosterChanges(n) {
  const ackBy = Object.fromEntries(S.acks.map(a => [a.item_id, a]));
  const live_ = S.changes.filter(i => !linePast(i, n)).sort((a, b) => (b.roster_changes.sent_at || "").localeCompare(a.roster_changes.sent_at || ""));
  const fresh = live_.filter(i => !ackBy[i.id]?.confirmed_at && !S.gotit[i.id]);
  const tapped = live_.filter(i => !ackBy[i.id]?.confirmed_at && S.gotit[i.id]);
  const old = live_.filter(i => ackBy[i.id]?.confirmed_at).slice(0, 3);
  if (!fresh.length && !tapped.length && !old.length) return "";
  const grp = list => { const by = {}; for (const i of list) (by[i.change_id] ??= { at: i.roster_changes.sent_at, items: [] }).items.push(i); return Object.values(by); };
  return `<div class="card ${fresh.length ? "hot" : ""}" id="rc"><h2>Roster changes<span>${fresh.length ? `${fresh.length} to confirm` : tapped.length ? "Got it sent" : "confirmed"}</span></h2>
    ${grp(fresh).map(g => `<div><div class="meta mono">Sent ${fmtTs(g.at)}</div><ul style="margin:4px 0 0 18px;padding:0;color:var(--crit);font-weight:700">${g.items.map(i => `<li>${esc(i.summary)}</li>`).join("")}</ul></div>`).join("")}
    ${fresh.length ? `<button class="btn crit" id="gotit" data-ids="${fresh.map(i => i.id).join(",")}">Got it, I've read ${fresh.length === 1 ? "this change" : "these changes"}</button><p class="hint">One tap. Jeremy sees your ✓ straight away.</p>` : ""}
    ${tapped.length ? `<p class="hint c-ok">✓ Got it sent for ${tapped.length} change${tapped.length === 1 ? "" : "s"} · <button class="linkbtn" id="gotit-again">Didn't go through? Show again</button></p>` : ""}
    ${grp(old).map(g => `<div><div class="meta mono c-ok">Sent ${fmtTs(g.at)} · ✓ you confirmed ${fmtTs(ackBy[g.items[0].id].confirmed_at)}</div><ul style="margin:4px 0 0 18px;padding:0;color:var(--ink3)">${g.items.map(i => `<li>${esc(i.summary)}</li>`).join("")}</ul></div>`).join("")}
  </div>`;
}

/* ---------- From Jeremy / alerts / messages ---------- */
function fromJeremy() {
  const list = S.entries.filter(e => e.show_driver).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 6); if (!list.length) return "";
  const K = { praise: ["ok", "Nice work 👏"], issue: ["warn", "Heads up"], note: ["accent", "Note"], mistake: ["crit", "Mistake recorded"] };
  return `<div class="card"><h2>From Jeremy<span>${list.length}</span></h2><div class="list">${list.map(e => { const k = K[e.kind] || K.note; return `<div class="item ${k[0]}"><div class="m">${k[1]} · ${label(e.day)}</div><div>${esc(e.title)}${e.note ? `<div class="meta">${esc(e.note)}</div>` : ""}</div></div>`; }).join("")}</div></div>`;
}
function alertsCard() {
  if (!S.alerts.length) return "";
  return `<div class="card hot"><h2>Needs attention<span>${S.alerts.length}</span></h2><div class="list">${S.alerts.map(a => `<div class="item ${a.kind.includes("missed") || a.kind === "sod_missing" ? "crit" : "warn"}"><b>${esc(a.title)}</b>${a.body ? `<div class="meta">${esc(a.body)}</div>` : ""}<div class="m">${ago(a.created_at)}</div></div>`).join("")}</div></div>`;
}
function messagesCard() {
  const unread = S.msgs.filter(m => !m.read_at); const toConfirm = S.msgs.filter(m => m.messages.needs_confirm && !m.confirmed_at);
  const show = S.msgs.slice(0, 5); if (!show.length) return "";
  return `<div class="card ${toConfirm.length ? "warnc" : ""}" id="msgs"><h2>Messages<span>${toConfirm.length ? `${toConfirm.length} to confirm` : unread.length ? `${unread.length} new` : ""}</span></h2>
    <div class="list">${show.map(m => `<div class="item ${m.messages.needs_confirm && !m.confirmed_at ? "warn" : m.read_at ? "" : "accent"}"><div class="m">${esc(first(S.people[m.messages.sender]?.name || "Jeremy"))} · ${fmtTs(m.messages.created_at)}${m.confirmed_at ? ` · <span class="c-ok">✓ confirmed</span>` : ""}</div><div style="white-space:pre-wrap">${esc(m.messages.body)}</div>${m.messages.needs_confirm && !m.confirmed_at ? `<button class="btn sm" data-confirm="${m.message_id}">Got it</button>` : ""}</div>`).join("")}</div>
    ${S.msgs.length > 5 ? `<details><summary>Older messages</summary><div class="list" style="margin-top:8px">${S.msgs.slice(5).map(m => `<div class="item"><div class="m">${fmtTs(m.messages.created_at)}</div><div style="white-space:pre-wrap">${esc(m.messages.body)}</div></div>`).join("")}</div></details>` : ""}</div>`;
}

/* ---------- Today / next shift ---------- */
function runName(code) { const r = S.runsBy[code]; const fc = S.C.runCodes[code]; return r ? `${r.name}${fc ? ` (${fc})` : ""}` : code; }
function segRow(x, day, n, isToday) {
  const code = x.shift.run; const r = S.runsBy[code];
  const tags = [x.shift.van ? `<span class="tag van">${esc(x.shift.van)}</span>` : "", x.shift.trainee ? `<span class="tag tr">training ${esc(first(S.people[x.shift.trainee]?.name || ""))}</span>` : "", ...(x.shift.addons || []).map(a => `<span class="tag">+ ${esc(addName(a))}</span>`)].join("");
  const tw = x.sort ? "" : timingRows(x, day, isToday ? n.min : null);
  const act = isToday ? segActions(x, day, n) : "";
  return `<div class="seg"><div class="tm">${fmtT(x.st)} – ${fmtT(x.en)}</div><div class="rn">${x.sort ? esc(r?.label || "Sort") : `${esc(code)}<span class="sub">${esc(runName(code))}</span>`}<div class="tags">${tags}</div>${tw}${act}</div></div>`;
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
function timingRows(x, day, nowMin) {
  const rows = rulesFor(x, day).map(r => { const f = toMin(r.opens), t = toMin(r.closes); let tag = "", cls = "";
    if (nowMin != null) { if (t != null && nowMin > t) return ""; if (f != null && nowMin >= f) { tag = "now"; cls = "now"; } else if (f == null && t != null && t - nowMin <= 60) { tag = "due soon"; cls = "now"; } }
    return `<div class="tw-r ${cls}"><div class="w">${winTxt(r)}${tag ? `<span class="tw-tag">${tag}</span>` : ""}</div><div><span class="n">${esc(r.name)}</span>${r.note ? `<span class="x">${esc(r.note)}</span>` : ""}</div></div>`; }).filter(Boolean);
  return rows.length ? `<div class="tw"><h4>Timing windows</h4>${rows.join("")}</div>` : "";
}
function segActions(x, day, n) {
  if (x.sort) return x.eod ? `<div class="meta c-ok">✓ Sort finished ${fmtTime(x.eod.sent_at)}</div>` : "";
  const T = S.days[day]; const sodDone = T.segs.some(s => s.sod);
  if (x.eod) return `<div class="meta c-ok" style="margin-top:6px">✓ EOD sent ${fmtTime(x.eod.sent_at)}${x.eod.finish_time ? ` · finished ${fmtT(toMin(x.eod.finish_time))}` : ""}</div>`;
  if (!sodDone) return "";
  const due = (x.en ?? x.st) + S.C.rules.eodHours * 60; const lateNow = n.min > due;
  return `<button class="btn ${lateNow ? "warn" : "accent"} sm" style="margin-top:8px" data-eod="${x.shift.id}">EOD for ${esc(x.shift.run)}${lateNow ? " (overdue)" : ""}</button>`;
}
function todayCard(T, N, n) {
  const hol = S.C.holidays[n.date];
  if (T) {
    const left = T.segs.filter(x => n.min < (x.en ?? x.st));
    const sodSeg = T.segs.find(x => x.sod); const allEod = T.segs.filter(x => !x.sort).length ? T.segs.filter(x => !x.sort).every(x => x.eod) : T.segs.some(x => x.eod);
    if (left.length || (!allEod && sodSeg)) {
      const sodBtn = !sodSeg ? `<button class="btn" id="sod" data-shift="${T.segs[0].shift.id}">▶ Start of day · SOD</button><p class="hint">One tap sends your SOD with the time, run${T.segs.filter(x => !x.sort).length > 1 ? "s" : ""} and van. You can edit it until your EOD.</p>`
        : `<div class="row"><div class="meta c-ok">✓ SOD ${fmtTime(sodSeg.sod.sent_at)}${sodSeg.sod.van ? ` · ${esc(sodSeg.sod.van)}` : ""}${sodSeg.sod.edited_at ? " (edited)" : ""}</div>${allEod ? "" : `<button class="btn ghost sm" id="sod-edit" data-shift="${sodSeg.shift.id}">Edit SOD</button>`}</div>`;
      const sortOnly = !T.segs.some(x => !x.sort) && sodSeg && !allEod;
      return `<div class="card today"><h2>Today<span>${label(T.day)}</span></h2><div class="big">${fmtT((left[0] || T.segs[0]).st)} – ${fmtT(T.end)}${left.length === T.segs.length ? ` <small>· ${T.hours} h</small>` : ""}</div>
        ${sodBtn}${(left.length ? left : T.segs).map(x => segRow(x, T.day, n, true)).join("")}
        ${sortOnly ? `<button class="btn accent sm" data-eod="${T.segs[T.segs.length - 1].shift.id}" data-sort="1">Finished sorting · EOD</button>` : ""}
        ${S.locOn ? `<p class="hint">📍 Sharing your location with the depot until your EOD.</p>` : ""}</div>`;
    }
  }
  const lead = !T ? (hol ? `<p class="hint">Today: ${esc(hol.name)}</p>` : `<p class="hint">Day off today</p>`) : "";
  if (N) return `<div class="card today"><h2>Next shift<span>${label(N.day)}</span></h2>${lead}<div class="big">${fmtT(N.start)} – ${fmtT(N.end)} <small>· ${N.hours} h</small></div>${N.segs.map(x => segRow(x, N.day, n, false)).join("")}</div>`;
  return `<div class="card today"><h2>Next shift</h2>${lead}<div class="big">Not on the roster yet</div><p class="hint">Your next shift shows here once the roster is out.</p></div>`;
}
function vanCard(T, N) {
  const src = T && T.segs.some(x => x.shift.van) ? T : N && N.segs.some(x => x.shift.van) ? N : null; if (!src) return "";
  const plates = [...new Set(src.segs.map(x => x.shift.van).filter(Boolean))];
  const st = (d, soonDays = 14) => { if (!d) return ["unknown", "not on file"]; const n = Math.round((new Date(d) - new Date(today())) / 86400000); return n < 0 ? ["crit", "overdue"] : n <= soonDays ? ["warn", `due in ${n}d`] : ["ok", "✓"]; };
  return `<div class="card"><h2>My van<span>${src === T ? "Today" : `Next shift · ${label(src.day)}`}</span></h2>${plates.map(p => { const v = S.vans[p] || {}; const w = st(v.wof_due), r = st(v.rego_due); let ruc = ["unknown", "not on file"], rtxt = "";
    if (v.no_ruc) { ruc = ["ok", "✓"]; rtxt = "not needed (petrol)"; } else if (v.ruc_paid_to) { const left = v.odometer ? v.ruc_paid_to - v.odometer : null; rtxt = `paid to ${v.ruc_paid_to.toLocaleString()} km${left != null ? ` · ${left.toLocaleString()} km left` : ""}`; ruc = left == null ? ["ok", "✓"] : left <= 0 ? ["crit", "overdue"] : left <= (S.C.rules.rucSoonKm || 1000) ? ["warn", "low"] : ["ok", "✓"]; }
    return `<div><span class="plate">${esc(p)}</span>${v.model ? ` <span class="meta">${esc(v.model)}</span>` : ""}<dl class="kv" style="margin-top:8px;grid-template-columns:56px 1fr"><dt>WOF</dt><dd>${v.wof_due ? label(v.wof_due, true) + " " : ""}${pill(w[1], w[0] === "unknown" ? "grey" : w[0])}</dd><dt>Rego</dt><dd>${v.rego_due ? label(v.rego_due, true) + " " : ""}${pill(r[1], r[0] === "unknown" ? "grey" : r[0])}</dd><dt>RUCs</dt><dd>${esc(rtxt)} ${pill(ruc[1], ruc[0] === "unknown" ? "grey" : ruc[0])}</dd></dl></div>`; }).join("")}
    <p class="hint">Low or overdue? Tell Stu.</p></div>`;
}
function shiftsCard(t) {
  const mon = monOf(t); const nextMon = addDays(mon, 7);
  const row = d => { const D = S.days[d]; const hol = S.C.holidays[d]; const isT = d === t;
    const txt = hol ? esc(hol.name) : D ? D.segs.map(x => x.sort ? esc(S.runsBy[x.shift.run]?.label || "Sort") : `${esc(x.shift.run)}${x.shift.van ? ` · ${esc(x.shift.van)}` : ""}`).join(" → ") : "Off";
    return `<div class="day ${D ? "" : "off"} ${isT ? "todayrow" : ""}"><div class="dl">${label(d).slice(0, 6)}</div><div>${txt}</div><div class="dh">${D ? `${fmtT(D.start)}–${fmtT(D.end)}` : ""}</div></div>`; };
  const thisW = []; for (let d = addDays(t, 1); d < nextMon; d = addDays(d, 1)) thisW.push(d);
  const nextW = []; for (let d = nextMon; d < addDays(nextMon, 7); d = addDays(d, 1)) nextW.push(d);
  const nShifts = nextW.filter(d => S.days[d]).length; const rosterOut = S.shifts.some(s => s.day >= nextMon) || nShifts > 0;
  return `<div class="card"><h2>My shifts</h2><div class="meta mono">This week</div>${thisW.length ? thisW.map(row).join("") : `<div class="day off"><div class="dl"></div><div>Nothing left this week</div><div></div></div>`}
    <details><summary>Next week<span class="meta">${rosterOut ? `${nShifts} shift${nShifts === 1 ? "" : "s"}` : "roster not out yet"}</span></summary>${nextW.map(row).join("")}</details></div>`;
}

/* ---------- Add-ons & tasks ---------- */
function addonsCard(T, N, n) {
  const runSeg = D => D && D.segs.filter(x => !x.sort && (S.addons.some(a => a.runs.includes(x.shift.run)) || x.shift.addons?.length));
  const thisDone = !T || !runSeg(T)?.length || n.min >= Math.max(...runSeg(T).map(x => x.en ?? x.st));
  const nextDays = Object.values(S.days).filter(d => d.day > n.date && runSeg(d)?.length).sort((a, b) => a.day < b.day ? -1 : 1)[0];
  const showThis = !thisDone && runSeg(T)?.length, showNext = nextDays && runSeg(nextDays)?.length;
  if (!showThis && !showNext) return "";
  S.addTab ??= showThis ? "this" : "next"; if (S.addTab === "this" && !showThis) S.addTab = "next"; if (S.addTab === "next" && !showNext) S.addTab = "this";
  const D = S.addTab === "this" ? T : nextDays; const isT = D.day === n.date;
  const sat = dayName(D.day) === "Sat";
  const blocks = runSeg(D).map(x => {
    const code = x.shift.run; const opts = S.addons.filter(a => a.runs.includes(code) && !(sat && a.no_saturday) && !a.id.startsWith("tw_"));
    const on = new Set(x.shift.addons || []); const plan = x.shift.plan || {}; const done = x.shift.done || {};
    const tasks = opts.filter(o => o.task);
    return `<div style="border-top:1px solid var(--line);padding-top:8px"><div class="row" style="justify-content:space-between"><b style="font-size:16px">${esc(code)}</b><span class="meta">${fmtT(x.st)} – ${fmtT(x.en)}${x.shift.van ? ` · ${esc(x.shift.van)}` : ""}</span></div>
      <div class="list" style="margin-top:6px">${opts.map(o => { const isOn = on.has(o.id); const rule = S.rules.find(r => r.addon === o.id);
        return `<div class="row" style="align-items:center"><label class="chk ${isOn ? "on" : ""}" style="flex:1 1 60%"><input type="checkbox" data-addon="${o.id}" data-shift="${x.shift.id}" ${isOn ? "checked" : ""}>${esc(o.name)}${rule ? `<span class="meta" style="margin-left:auto">${winTxt(rule)}</span>` : ""}</label>
          ${o.task && isOn ? `<input class="in" type="time" step="900" style="flex:0 0 120px;min-height:40px" value="${esc(plan[o.id] || "")}" data-plan="${o.id}" data-shift="${x.shift.id}" aria-label="Planned time for ${esc(o.name)}">` : ""}
          ${o.task && isOn && isT ? (done[o.id] ? `<span class="pill ok">✓ done ${fmtTime(done[o.id])}</span>` : `<button class="btn sm ghost" data-done="${o.id}" data-shift="${x.shift.id}">Done</button>`) : ""}</div>`; }).join("")}</div>
      ${tasks.length ? `<p class="hint" style="margin:6px 0 0">Tick what you're doing and set a rough time for each: that's your game plan, Jeremy sees it live. Tap <b>Done</b> as you finish each one.</p>` : `<p class="hint" style="margin:6px 0 0">Changes save straight away and show on the Run Board.</p>`}</div>`;
  }).join("");
  return `<div class="card"><h2>Add-ons &amp; tasks<span>${nextDays && S.addTab === "this" ? `next: ${label(nextDays.day)}` : ""}</span></h2>
    ${showThis && showNext ? `<div class="seg-btns"><button data-tab="this" class="${S.addTab === "this" ? "on" : ""}">This shift</button><button data-tab="next" class="${S.addTab === "next" ? "on" : ""}">Next shift</button></div>` : ""}
    <div class="meta mono" style="text-transform:uppercase">${label(D.day)}${isT ? " · today" : ""}</div>${blocks}</div>`;
}

/* ---------- Scores ---------- */
function scoresCard() {
  const F = fortnight(today()); const D = { shifts: S.shifts, sods: S.sods, eods: S.eods, marks: S.marks, entries: S.entries, feed: S.feed, runsBy: S.runsBy };
  const sc = scoreFor(S.me.id, F.from, F.to, D, S.C); S.sc = sc; S.F = F;
  const tile = (k, l, v) => `<button class="tile ${S.scSel === k ? "sel" : ""}" data-sc="${k}"><div class="l">${l} ▾</div><div class="v c-${col(v)}">${pct(v)}</div><div class="bar"><i class="bg-${col(v)}" style="width:${Math.min(100, v || 0)}%"></i></div></button>`;
  const line = [`${sc.onTime} of ${sc.closed} posts on time`, sc.late ? `${sc.late} late` : "", sc.missing ? `${sc.missing} missing` : "", sc.nMist ? `${sc.nMist} mistake${sc.nMist === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  return `<div class="card" id="scores"><h2>My scores<span>${label(F.from)} – ${label(F.to)}</span></h2>
    <div class="tiles" style="grid-template-columns:1fr 1fr">${tile("admin", "Admin", sc.admin)}${tile("eff", "Efficiency", sc.eff)}${tile("acc", "Accuracy", sc.acc)}${tile("safe", "Safety", sc.safe)}</div>
    <div class="meta">Overall <b class="c-${col(sc.overall)}">${pct(sc.overall)}</b> · ${line} · tap a score to see the figures</div>
    ${S.scSel ? scoreDetail(sc, S.scSel) : ""}</div>`;
}
function scoreDetail(sc, k) {
  const R = S.C.rules; const tbl = (head, rows) => rows.length ? `<div class="scroll"><table class="dt"><tr>${head.map(x => `<th>${x}</th>`).join("")}</tr>${rows.join("")}</table></div>` : "";
  let body = "";
  if (k === "admin") { const rows = sc.items.filter(i => !["due", "over"].includes(i.st) || i.st === "over").sort((a, b) => a.day.localeCompare(b.day)).map(i => `<tr><td>${label(i.day)}</td><td>${esc(i.label)}<div class="meta">${itemNote(i)}</div></td><td>${pill(STATE_LABEL[i.st], i.st === "ok" ? "ok" : i.st === "miss" ? "crit" : i.st === "due" || i.st === "over" ? "grey" : "warn")}</td></tr>`);
    body = `<p class="hint">Starts at 100%. Each late or missing post takes off ${R.perEvent}%. It never drops below ${R.adminFloor}%.</p>${tbl(["Day", "Post", "Result"], rows) || `<p class="empty">No posts counted for these days. Posts count from ${label(R.adminStart)}.</p>`}${sc.adj ? `<p class="meta">Adjustments from Jeremy: ${sc.entries.filter(e => e.admin_pts).map(e => `${label(e.day)} ${e.admin_pts > 0 ? "+" : ""}${e.admin_pts} (${esc(e.title)})`).join(", ")}</p>` : ""}`; }
  if (k === "eff") { const rows = sc.effDays.filter(e => !e.pending).map(e => `<tr><td>${label(e.day)}</td><td>${e.manual ? "set by Jeremy" : e.rows.map(r => r.code).join(" + ")}</td><td class="num">${e.allowed ? (e.est ? "≈" : "") + e.allowed.toFixed(1) + " h" : ""}</td><td class="num">${e.taken ? e.taken.toFixed(1) + " h" : ""}</td><td class="c-${col(Math.min(100, e.v))}">${Math.round(e.v)}%${e.est ? " est" : ""}</td></tr>`);
    const pend = sc.effDays.filter(e => e.pending);
    body = `<p class="hint">Expected hours (sorting plus the run, worked out from your EOD figures) divided by the hours you actually took. 100% means right on the expected time.</p>${tbl(["Day", "Run", "Expected", "Actual", "Score"], rows) || `<p class="empty">No finished runs with full figures on these days.</p>`}${pend.length ? `<p class="meta">Waiting on figures: ${pend.map(e => `${label(e.day)} ${esc(e.need || "EOD")}`).join(" · ")}</p>` : ""}${sc.effDays.some(e => e.est) ? `<p class="meta">≈ means a best guess was used for a missing EOD figure.</p>` : ""}`; }
  if (k === "acc") { const rows = sc.accDays.map(a => `<tr><td>${label(a.day)}</td><td>${esc(a.code)}</td><td class="num">${a.items}</td><td class="num">${a.compliant}</td><td class="c-${col(a.v)}">${a.v == null ? "—" : a.v.toFixed(1) + "%"}</td></tr>`);
    body = `<p class="hint">From NZ Post's daily report: items scanned correctly ÷ items for delivery. Each mistake in the Driver Mistakes Record takes off ${R.mistakePct}%.</p>${tbl(["Day", "Run", "Items", "Correct", "%"], rows) || `<p class="empty">No NZ Post report figures for your runs on these days.</p>`}${sc.nMist ? `<p class="meta">Mistakes: ${sc.mistakes.map(m => `${label(m.day)} ${esc(m.title)}`).join(" · ")}</p>` : `<p class="meta">No mistakes logged. 👍</p>`}`; }
  if (k === "safe") { const rows = sc.entries.filter(e => e.safety_pct != null).map(e => `<tr><td>${label(e.day)}</td><td class="num">${e.safety_pct}%</td><td>${esc(e.title)}</td></tr>`); body = `<p class="hint">Stays at 100% unless Jeremy records a safety issue.</p>${tbl(["Day", "Score", "Note"], rows) || `<p class="meta">Nothing recorded. 👍</p>`}`; }
  return `<div style="border-top:1px solid var(--line);padding-top:8px">${body}</div>`;
}

/* ---------- To fix ---------- */
function toFixCard(n) {
  const its = (S.sc?.items || []).filter(i => ["late", "miss", "over"].includes(i.st) && !i.pre);
  const pend = (S.sc?.effDays || []).filter(e => e.pending && e.need && !e.need.includes("EOD"));
  if (!its.length && !pend.length) return "";
  return `<div class="card warnc"><h2>To fix<span>${its.length + pend.length} to check</span></h2><div class="list">
    ${its.sort((a, b) => b.day.localeCompare(a.day)).map(i => `<div class="item warn"><div class="m c-warn">${label(i.day)}</div><div>${esc(i.label)}: ${itemNote(i)}</div>${!i.row ? `<button class="btn sm ${i.kind === "SOD" ? "" : "accent"}" data-${i.kind === "SOD" ? "sod-late" : "eod"}="${i.shift.id}" data-day="${i.day}">Post it now</button>` : ""}</div>`).join("")}
    ${pend.map(e => `<div class="item warn"><div class="m c-warn">${label(e.day)}</div><div>EOD figures missing: ${esc(e.need)}</div><div class="meta">Ask Jeremy to add them, or include them next time.</div></div>`).join("")}</div></div>`;
}

/* ---------- Leave ---------- */
const LEAVE_T = { annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave", bereave: "Bereavement leave", dayoff: "Day off request", other: "Other" };
function leaveCard() {
  const mine = S.leave; const st = s => pill(s, s === "approved" ? "ok" : s === "declined" ? "crit" : s === "pending" ? "warn" : "grey");
  return `<div class="card" id="leave"><h2>Leave<span>${mine.filter(l => l.status === "pending").length ? `${mine.filter(l => l.status === "pending").length} waiting` : ""}</span></h2>
    ${mine.length ? `<div class="list">${mine.slice(0, 6).map(l => `<div class="item"><div class="row" style="justify-content:space-between"><b>${esc(LEAVE_T[l.type] || l.type)}</b>${st(l.status)}</div><div class="meta mono">${label(l.date_from)}${l.date_to !== l.date_from ? ` – ${label(l.date_to)}` : ""}${l.part !== "full" ? ` · ${l.part === "AM" ? "morning off" : "afternoon off"}` : ""}</div>${l.notes ? `<div class="meta">${esc(l.notes)}</div>` : ""}${l.reply ? `<div style="background:var(--card);border-radius:6px;padding:6px 8px;font-size:13px">${esc(l.reply)}</div>` : ""}</div>`).join("")}</div>` : ""}
    <button class="btn ghost" id="leave-new">Request leave</button></div>`;
}

/* ---------- Details / more ---------- */
function detailsCard() {
  const p = S.me; const d = (v, soon = 30) => { if (!v) return pill("not on file", "grey"); const n = Math.round((new Date(v) - new Date(today())) / 86400000); return `${label(v, true)} ${n < 0 ? pill("expired", "crit") : n <= soon ? pill(`due in ${n}d`, "warn") : pill("✓", "ok")}`; };
  return `<div class="card"><h2>My details</h2><dl class="kv"><dt>Phone</dt><dd>${p.phone ? esc(p.phone) : pill("not on file", "grey")}</dd><dt>Email</dt><dd>${esc(p.email || "")}</dd><dt>Licence</dt><dd>${p.licence_class ? esc(p.licence_class) + " · " : ""}${d(p.licence_expiry)}</dd><dt>DG</dt><dd>${d(p.dg_expiry)}</dd></dl>
    <button class="btn ghost sm" id="prof-edit">Update my details</button></div>`;
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
  $("#view-as")?.addEventListener("change", e => { location.hash = e.target.value ? "as=" + e.target.value : ""; });
  $$("#va-prev,#va-next").forEach(b => b.onclick = () => { if (b.dataset.id) location.hash = "as=" + b.dataset.id; });
  if (S.viewAs) { $$("#gotit,#gotit-again,[data-confirm],[data-addon],[data-plan],[data-done],#leave-new,#prof-edit,#push-btn,#vchk-btn").forEach(el => { el.disabled = true; el.title = "Only " + first(S.viewAs.name) + " can do this"; el.style.opacity = ".5"; }); }
  pushState().then(s => { const el = $("#push-state"); if (el) el.textContent = s === "on" ? "on" : s === "denied" ? "blocked in phone settings" : s === "unsupported" ? "add to Home Screen first" : "off, tap to turn on"; });
  $("#push-btn")?.addEventListener("click", async () => { const r = await enablePush(S.me.id, VAPID_PUBLIC); toast(r.ok ? "Notifications are on" : r.why, r.ok ? "ok" : "err"); render(); });
  $("#gotit")?.addEventListener("click", async e => { const ids = e.currentTarget.dataset.ids.split(","); for (const id of ids) S.gotit[id] = new Date().toISOString(); localStorage.setItem("tp-gotit", JSON.stringify(S.gotit)); render();
    const { error } = await sb.from("change_acks").update({ confirmed_at: new Date().toISOString(), seen_at: new Date().toISOString() }).in("item_id", ids).eq("driver", S.me.id); if (error) toast("Couldn't send. Try again.", "err"); else toast("Confirmed ✓", "ok"); });
  $("#gotit-again")?.addEventListener("click", () => { S.gotit = {}; localStorage.removeItem("tp-gotit"); render(); });
  $$("[data-confirm]").forEach(b => b.onclick = async () => { await q(sb.from("message_recipients").update({ confirmed_at: new Date().toISOString(), read_at: new Date().toISOString() }).eq("message_id", b.dataset.confirm).eq("person", S.me.id)); toast("Confirmed ✓", "ok"); });
  const unread = S.msgs.filter(m => !m.read_at).map(m => m.message_id); if (unread.length) sb.from("message_recipients").update({ read_at: new Date().toISOString() }).in("message_id", unread).eq("person", S.me.id).then(() => { });
  $("#sod")?.addEventListener("click", e => sendSod(e.currentTarget.dataset.shift));
  $("#sod-edit")?.addEventListener("click", e => editSod(e.currentTarget.dataset.shift));
  $$("[data-sod-late]").forEach(b => b.onclick = () => sendSod(b.dataset.sodLate, true));
  $$("[data-eod]").forEach(b => b.onclick = () => eodForm(b.dataset.eod, !!b.dataset.sort));
  $$("[data-tab]").forEach(b => b.onclick = () => { S.addTab = b.dataset.tab; render(); });
  $$("[data-addon]").forEach(c => c.onchange = async () => { const shift = S.shifts.find(s => s.id === c.dataset.shift); const set = new Set(shift.addons || []); c.checked ? set.add(c.dataset.addon) : set.delete(c.dataset.addon); const { error } = await sb.rpc("set_my_addons", { p_shift: shift.id, p_addons: [...set] }); if (error) { toast(error.message, "err"); c.checked = !c.checked; } else { shift.addons = [...set]; render(); } });
  $$("[data-plan]").forEach(i => i.onchange = async () => { const shift = S.shifts.find(s => s.id === i.dataset.shift); const plan = { ...(shift.plan || {}), [i.dataset.plan]: i.value }; const { error } = await sb.rpc("set_my_plan", { p_shift: shift.id, p_plan: plan }); if (error) toast(error.message, "err"); else { shift.plan = plan; toast("Saved", "ok"); } });
  $$("[data-done]").forEach(b => b.onclick = async () => { const { error } = await sb.rpc("task_done", { p_shift: b.dataset.shift, p_addon: b.dataset.done }); if (error) toast(error.message, "err"); else { toast("Marked done ✓", "ok"); await loadAll(); render(); } });
  $$("[data-sc]").forEach(b => b.onclick = () => { S.scSel = S.scSel === b.dataset.sc ? null : b.dataset.sc; render(); setTimeout(() => $("#scores")?.scrollIntoView({ block: "nearest" }), 0); });
  $("#leave-new")?.addEventListener("click", leaveForm);
  $("#prof-edit")?.addEventListener("click", profileForm);
  $("#vchk-btn")?.addEventListener("click", vehicleCheckForm);
}

/* ================= sheets ================= */
function sheet(html, onOpen) {
  const bg = h(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" style="position:relative"><button class="x" aria-label="Close">×</button>${html}</div></div>`);
  const close = () => bg.remove(); bg.querySelector(".x").onclick = close; bg.addEventListener("click", e => { if (e.target === bg) close(); });
  document.body.appendChild(bg); onOpen?.(bg, close); return { bg, close };
}
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
function eodForm(shiftId, sortOnly) {
  const shift = S.shifts.find(s => s.id === shiftId); const code = shift.run; const net = NET(code); const n = nzNow();
  const yn = id => `<select class="in" id="${id}"><option value="">Pick…</option><option value="true">Yes</option><option value="false">No</option></select>`;
  const legs = LEG_RUNS[code] || []; const newsRun = (S.C.news.runs || []).includes(code);
  let fields = `<label class="f full">Finish time<input class="in" type="time" id="finish" value="${fmt24s(n.min)}" required></label>`;
  if (!sortOnly && !isSort(code)) {
    if (net === "tge") fields += `<label class="f">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 90"></label><label class="f">Delivery total<input class="in" id="parcels" inputmode="numeric" required></label><label class="f">Jobs (stops)<input class="in" id="stops" inputmode="numeric" required></label><label class="f">Pick-up stops<input class="in" id="pickups" inputmode="numeric"></label><label class="f">Pick-up parcels<input class="in" id="pickup_parcels" inputmode="numeric"></label><label class="f">Next cycled<input class="in" id="cycled" inputmode="numeric"></label>`;
    else if (net === "fb") fields += `<label class="f">Total parcels<input class="in" id="parcels" inputmode="numeric" required></label><label class="f">Stops<input class="in" id="stops" inputmode="numeric" required></label>`;
    else fields += `<label class="f">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 90"></label><label class="f">Total parcels<input class="in" id="parcels" inputmode="numeric" required></label><label class="f">Stops<input class="in" id="stops" inputmode="numeric" required></label><label class="f">Mail trays<input class="in" id="trays" inputmode="decimal" placeholder="e.g. 1 or 0.5"></label><label class="f">Sorted parcels?${yn("sorted_parcels")}</label><label class="f">Sorted mail?${yn("sorted_mail")}</label>${PICKUP_RUNS.includes(code) ? `<label class="f">NZC / PH pick-up?${yn("nzc_ph")}</label>` : ""}<label class="f">Next cycled<input class="in" id="cycled" inputmode="numeric"></label>`;
    if (legs.length) fields += `<div class="full"><div class="meta mono" style="margin-bottom:6px">ADD-ON LEGS YOU DID</div><div class="row">${legs.map(l => `<label class="chk ${(shift.addons || []).includes(l) ? "on" : ""}"><input type="checkbox" name="leg" value="${l}" ${(shift.addons || []).includes(l) ? "checked" : ""}>${esc(addName(l))}</label>`).join("")}</div></div>`;
    if (newsRun) fields += `<label class="chk full"><input type="checkbox" id="news">Newspapers done today (once a week, ${S.C.news.min} min allowed)</label>`;
  } else fields += `<label class="f full">Sorting time (min)<input class="in" id="sort_min" inputmode="numeric" placeholder="e.g. 100"></label>`;
  fields += `<label class="f full">Note (optional)<input class="in" id="note" placeholder="anything Jeremy should know"></label>`;
  sheet(`<h3>EOD · ${esc(sortOnly || isSort(code) ? (S.runsBy[code]?.label || "Sort") : code)}</h3><p class="hint">${label(shift.day)}${shift.van ? ` · ${esc(shift.van)}` : ""}. Fill in every box that applies.</p><form class="frm" id="ef">${fields}<button class="btn full" type="submit">Send EOD</button></form>`, (bg, close) => {
    bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
    bg.querySelector("#ef").onsubmit = async e => { e.preventDefault(); const g = id => bg.querySelector("#" + id); const num = id => g(id) && g(id).value !== "" ? +g(id).value : null; const bool = id => g(id) && g(id).value !== "" ? g(id).value === "true" : null;
      const row = { shift_id: shiftId, driver: S.me.id, finish_time: g("finish").value, sort_min: num("sort_min"), parcels: num("parcels"), stops: num("stops"), trays: num("trays"), pickups: num("pickups"), pickup_parcels: num("pickup_parcels"), cycled: num("cycled"), sorted_parcels: bool("sorted_parcels"), sorted_mail: bool("sorted_mail"), nzc_ph: bool("nzc_ph"), legs: [...bg.querySelectorAll("input[name=leg]:checked")].map(i => i.value), newspapers: !!g("news")?.checked, note: g("note").value || null, run_id: S.C.runCodes[code] || null };
      if (shift.day !== n.date) row.sent_at = nzToIso(shift.day, g("finish").value);
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
  const p = S.me;
  sheet(`<h3>Update my details</h3><form class="frm" id="pf"><label class="f full">Phone<input class="in" id="phone" type="tel" value="${esc(p.phone || "")}"></label><label class="f">Licence class<input class="in" id="lc" value="${esc(p.licence_class || "")}" placeholder="e.g. Class 1 full"></label><label class="f">Licence expires<input class="in" type="date" id="le" value="${p.licence_expiry || ""}"></label><label class="f full">DG endorsement expires<input class="in" type="date" id="dg" value="${p.dg_expiry || ""}"></label><button class="btn full" type="submit">Save</button></form><p class="hint">Email changes go through Jeremy, because it's how you sign in.</p>`, (bg, close) => {
    bg.querySelector("#pf").onsubmit = async e => { e.preventDefault(); const { error } = await sb.rpc("update_my_profile", { p_phone: bg.querySelector("#phone").value || null, p_lic_class: bg.querySelector("#lc").value || null, p_lic_exp: bg.querySelector("#le").value || null, p_dg_exp: bg.querySelector("#dg").value || null }); if (error) return toast(error.message, "err"); close(); toast("Saved", "ok"); S.me = await me(); render(); };
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
