// Live board: the old Scorecard dashboard, live. Day chips, KPIs, receivers & pick-ups, important points, team scores + labour,
// hours by day, admin action centre, roster changes not confirmed, drivers grid, posts board + live feed, newspapers, on-time by day, map.
import { sb, q, nzNow, today, addDays, dow, dayName, monOf, label, toMin, fmtT, fmtTs, fmtTime, ago, esc, $, $$, toast, pill, first, col, pct, isSort, avg, sum } from "/shared/core.js";
import { scoreFor, fortnight, itemNote, STATE_LABEL, effCalc, band, dayShifts, segTimes, addName } from "/shared/score.js";
import { S, sheet, opt, nm, fnm, loadAll, render, scoreData, alertRow, fn } from "/admin/admin.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function sel() { const t = today(); const wk = monOf(t); if (!S.daySel || S.daySelWk !== wk) { S.daySel = DAYS.map((_, i) => addDays(wk, i)); S.daySelWk = wk; } return S.daySel; }
const chip = it => `<button class="chip ${it.st} ${it.mark?.status ? "man" : ""}" data-item="${esc(it.key)}" title="${STATE_LABEL[it.st]}">${esc(it.label)} <span style="font-weight:500">${itemNote(it).replace(/^posted /, "")}</span></button>`;
const tile = (l, v, s = "", cls = null) => `<div class="tile"><div class="l">${l}</div><div class="v ${cls || "c-" + col(v)}">${typeof v === "number" || v == null ? pct(v) : v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;

export function liveTab() {
  const n = nzNow(); const t = n.date; const wk = monOf(t); const days = sel(); const one = days.length === 1; const R = S.C.rules; const D = scoreData();
  const from = days[0], to = days[days.length - 1];
  const drivers = S.drivers.filter(d => !d.pay_exclude || true);
  const scores = drivers.map(d => scoreFor(d.id, wk, addDays(wk, 6), D, S.C));                     // week to date (team tiles, drivers grid)
  const selScores = drivers.map(d => scoreFor(d.id, from, to, D, S.C));                             // selected days (posts, KPIs)
  const items = selScores.flatMap(s => s.items);
  const closed = items.filter(i => !["due", "over", "exc"].includes(i.st)); const ok = closed.filter(i => i.st === "ok").length;
  const over = items.filter(i => i.st === "over"), due = items.filter(i => i.st === "due"), late = items.filter(i => i.st === "late"), miss = items.filter(i => i.st === "miss");
  const rostered = new Set(S.shifts.filter(s => days.includes(s.day) && s.driver && s.run !== "BU").map(s => s.driver)).size;
  const team = k => avg(scores.filter(s => !S.peopleBy[s.driver]?.pay_exclude && (s.closed || s.effDays.length || s.accDays.length)).map(s => s[k]));

  const chips = `<div class="row" style="gap:4px"><div class="seg-btns" style="flex:1 1 auto">${DAYS.map((d, i) => { const dd = addDays(wk, i); return `<button data-day="${dd}" class="${days.includes(dd) ? "on" : ""}">${d} ${+dd.slice(8)}${dd === t ? " ·" : ""}</button>`; }).join("")}</div><div class="seg-btns" style="flex:0"><button data-days="today" class="${one && days[0] === t ? "on" : ""}">Today only</button><button data-days="week" class="${days.length === 7 ? "on" : ""}">Whole week</button></div></div><p class="hint" style="margin:0">Tap days to add or remove them.</p>`;
  const kpi = one ? `<div class="tiles">${tile("Posts due so far", String(items.length - due.length), `of ${items.length} for ${label(days[0])}`, "")}${tile("On time", String(ok), closed.length ? `${Math.round(ok / closed.length * 100)}% of posts` : "no posts yet", "c-ok")}${tile("Late", String(late.length), `late = −${R.perEvent}% Admin`, late.length ? "c-warn" : "")}${tile("Overdue now", String(over.length + miss.length), miss.length ? `${miss.length} missing` : "chased automatically when on", over.length + miss.length ? "c-crit" : "")}</div>`
    : `<div class="tiles">${tile("Team on-time rate", closed.length ? ok / closed.length * 100 : null, `${ok} of ${closed.length} posts on time`)}${tile("Late", String(late.length), "posted after the due time", late.length ? "c-warn" : "")}${tile("Missing", String(miss.length), "never posted", miss.length ? "c-crit" : "")}${tile("Drivers rostered", String(rostered), "tracked this week", "")}</div>`;

  return `<div class="card">${chips}${kpi}</div>
    ${receivers(t, n)}
    <div class="grid2">${important(scores, n)}${teamAndLabour(scores, team, wk)}</div>
    <div class="grid2">${hoursByDay(wk)}${actionCentre(scores, n)}</div>
    ${notConfirmed(n)}
    ${driversGrid(scores)}
    <div class="card"><h2>${one ? `Posts for ${label(days[0])}` : "Posts by driver and day"}<span>tap a chip to review</span></h2>${postsBoard(selScores, days, t)}</div>
    <div class="grid2">${newspapers(wk)}${onTimeByDay(wk, D)}</div>
    <div class="grid2"><div class="card"><h2>Live feed<span>today</span></h2>${feed(t)}</div><div class="card"><h2>Where everyone is<span>between SOD and EOD · app open</span></h2><div class="map" id="map"></div><p class="hint">Dots update every couple of minutes while a driver's app is on screen. Grey = older than 10 minutes.</p></div></div>`;
}

/* ---- Receivers & pick-ups · today ---- */
function receivers(t, n) {
  const segs = S.shifts.filter(s => s.day === t && s.driver && !isSort(s.run) && (s.addons || []).some(a => S.addons.find(x => x.id === a)?.task));
  if (!segs.length) return "";
  const ruleFor = a => S.rules.find(r => r.addon === a && r.active);
  const rows = segs.map(s => { const tasks = (s.addons || []).map(a => S.addons.find(x => x.id === a)).filter(a => a?.task); const planOk = Object.keys(s.plan || {}).length > 0; const gpRule = S.rules.find(r => r.active && r.runs.includes(s.run) && /game plan/i.test(r.name)); const gpDue = gpRule ? toMin(gpRule.closes) : 660;
    const gp = planOk ? `<span class="chip ok">✓ game plan</span>` : n.min > gpDue ? `<span class="chip miss">✗ no game plan by ${fmtT(gpDue)}</span>` : `<span class="chip due">game plan due ${fmtT(gpDue)}</span>`;
    return `<div class="item"><div class="row" style="justify-content:space-between"><b>${esc(s.run)} · ${esc(nm(s.driver))}</b>${gp}</div><div class="row" style="gap:3px">${tasks.map(a => { const done = s.done?.[a.id]; const plan = s.plan?.[a.id]; const r = ruleFor(a.id); const closes = r ? toMin(r.closes) : null; const missed = !done && closes != null && n.min > closes; return `<span class="chip ${done ? "ok" : missed ? "miss" : plan ? "due" : "over"}" title="${esc(r ? r.name : a.name)}">${esc(a.short || a.name)}${done ? ` ✓ ${fmtTime(done)}` : plan ? ` ~${fmtT(toMin(plan))}` : missed ? " ✗ not done" : " waiting"}</span>`; }).join("")}</div></div>`; });
  return `<div class="card"><h2>Receivers &amp; pick-ups · today<span>game plan + each task as the driver taps Done</span></h2><div class="list">${rows.join("")}</div></div>`;
}

/* ---- Important points ---- */
function important(scores, n) {
  const t = n.date; const wk = monOf(t); const P = []; const R = S.C.rules;
  const dismissed = new Set(S.marks.filter(m => m.key.startsWith("imp|") && m.status === "exc").map(m => m.key));
  for (const s of scores) { const d = S.peopleBy[s.driver]; if (d.pay_exclude || !(s.closed || s.effDays.length)) continue;
    if (s.admin != null && s.admin < 90) P.push({ lv: s.admin < 85 ? "crit" : "warn", who: d.name, t: `Admin ${Math.round(s.admin)}%`, d: `${s.late} late, ${s.missing} missing posts`, w: 100 - s.admin, sig: `${d.id}|admin` });
    if (s.eff != null && s.eff < 80) P.push({ lv: s.eff < 70 ? "crit" : "warn", who: d.name, t: `Efficiency ${Math.round(s.eff)}%`, d: "runs taking longer than the formula allows", w: 100 - s.eff, sig: `${d.id}|eff` });
    if (s.acc != null && s.acc < 95) P.push({ lv: s.acc < 90 ? "crit" : "warn", who: d.name, t: `Accuracy ${Math.round(s.acc)}%`, d: s.nMist ? `${s.nMist} mistake${s.nMist > 1 ? "s" : ""} logged` : "NZ Post scan compliance", w: 100 - s.acc, sig: `${d.id}|acc` });
    for (const e of s.effDays) if (!e.pending && !e.manual) for (const r of e.rows) if (r.perf != null && r.perf < 75 && r.taken) P.push({ lv: "warn", who: d.name, t: `${r.code} ${label(e.day)}`, d: `${r.taken.toFixed(1)} h vs ${(r.allowed / 60).toFixed(1)} h expected (${Math.round(r.perf)}%${r.est ? ", est" : ""})`, w: 100 - r.perf, sig: `${d.id}|${r.code}|${e.day}` }); }
  // vehicle checks this week (after Thursday 5pm)
  const thuDue = dow(t) + 1 > R.vchkDay || (dow(t) + 1 === R.vchkDay && n.min >= toMin(R.vchkTime));
  if (thuDue) for (const v of S.vans.filter(v => v.active && v.plate !== "OTHER")) if (!S.vchk.some(c => c.van === v.plate && c.week_start === wk) && S.shifts.some(s => s.day >= wk && s.day <= t && s.van === v.plate)) P.push({ lv: "warn", who: v.plate, t: `Vehicle check ${v.plate}`, d: "not done this week", w: 20, sig: `vchk|${wk}|${v.plate}` });
  // licences / DG
  for (const p of S.drivers) for (const [k, l] of [["licence_expiry", "Licence"], ["dg_expiry", "DG endorsement"]]) if (p[k]) { const dd = Math.round((new Date(p[k]) - new Date(t)) / 86400000); if (dd <= R.dueSoonDays) P.push({ lv: dd < 0 ? "crit" : "warn", who: p.name, t: `${l} ${dd < 0 ? "expired" : "expiring"}`, d: `${label(p[k], true)} · ${dd < 0 ? `${-dd} days ago` : `in ${dd} days`}`, w: dd < 0 ? 90 : 40, sig: `${p.id}|${k}|${dd < 0}` }); }
  // fleet
  for (const v of S.vans.filter(v => v.active && v.plate !== "OTHER")) { for (const [k, l] of [["wof_due", "WOF"], ["rego_due", "Rego"]]) if (v[k]) { const dd = Math.round((new Date(v[k]) - new Date(t)) / 86400000); if (dd <= R.dueSoonDays) P.push({ lv: dd < 0 ? "crit" : "warn", who: v.plate, t: `${l} ${dd < 0 ? "overdue" : "due soon"}`, d: `${label(v[k], true)}`, w: dd < 0 ? 85 : 35, sig: `${v.plate}|${k}|${dd < 0}` }); }
    if (v.wof_failed) P.push({ lv: "crit", who: v.plate, t: "WOF failed", d: "needs a recheck", w: 85, sig: `${v.plate}|woff` });
    if (!v.no_ruc && v.ruc_paid_to && v.odometer) { const left = v.ruc_paid_to - v.odometer; if (left <= R.rucSoonKm) P.push({ lv: left <= 0 ? "crit" : "warn", who: v.plate, t: left <= 0 ? "RUCs overdue" : "RUCs low", d: `${left.toLocaleString()} km left`, w: left <= 0 ? 85 : 35, sig: `${v.plate}|ruc|${left <= 0}` }); } }
  // unconfirmed roster changes
  const ackOf = {}; for (const a of S.acks) (ackOf[a.item_id] ??= {})[a.driver] = a;
  const unc = {}; for (const i of S.items.filter(i => i.roster_changes.status === "sent" && i.day >= t)) for (const d of i.affects) { const a = ackOf[i.id]?.[d]; if (!a?.confirmed_at && !a?.dismissed_at) (unc[d] ??= []).push(i); }
  for (const [d, L] of Object.entries(unc)) { const hrs = Math.round((Date.now() - new Date(L[0].roster_changes.sent_at)) / 3600e3); P.push({ lv: hrs > 24 ? "crit" : "warn", who: nm(d), t: "Roster change not confirmed", d: `${L.length} change${L.length > 1 ? "s" : ""} · ${hrs} h waiting`, w: hrs > 24 ? 80 : 45, sig: `${d}|ntc|${L.length}` }); }
  // open alerts (missed things)
  for (const a of S.alerts.filter(a => !a.resolved_at && a.created_at.slice(0, 10) >= addDays(t, -1) && ["timing_missed", "sod_late", "eod_late"].includes(a.kind))) P.push({ lv: "crit", who: a.driver ? fnm(a.driver) : "", t: a.title.replace(/^[^:]+: /, ""), d: a.body || "", w: 95, sig: `alert|${a.dedupe_key}` });
  // newspapers this week
  for (const code of S.C.news.runs || []) { const wkShifts = S.shifts.filter(s => s.day >= wk && s.day <= addDays(wk, 6) && s.run === code && s.driver); if (!wkShifts.length) continue; const done = wkShifts.some(s => S.eodBy[s.id]?.newspapers); if (!done && dow(t) >= 4) P.push({ lv: "warn", who: code, t: "Newspapers claim", d: `${code} not claimed this week`, w: 10, sig: `news|${wk}|${code}` }); }
  const live = P.filter(p => !dismissed.has("imp|" + p.sig)).sort((a, b) => (a.lv === b.lv ? b.w - a.w : a.lv === "crit" ? -1 : 1));
  const top = live.slice(0, 5); const nd = P.length - live.length;
  return `<div class="card"><h2>Important points<span>${top.length ? "the 5 most important this week, most urgent first" : `✓ nothing to look at`}</span></h2>
    ${top.length ? `<div class="list">${top.map((p, i) => `<div class="item ${p.lv}"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b>${i + 1}. ${esc(p.who)}</b> · ${esc(p.t)}<div class="meta">${esc(p.d)}</div></div><button class="btn ghost sm" data-dismiss="imp|${esc(p.sig)}" title="Hide this until it changes">Dismiss</button></div></div>`).join("")}</div>` : ""}
    ${nd ? `<button class="linkbtn" id="imp-undismiss">Bring back ${nd} dismissed</button>` : ""}</div>`;
}

/* ---- Team scores + Due within 14 days + Labour ---- */
function teamAndLabour(scores, team, wk) {
  const W = S.C.weights; const R = S.C.rules; const t = today();
  const dueList = [];
  for (const v of S.vans.filter(v => v.active && v.plate !== "OTHER")) for (const [k, l] of [["wof_due", "WOF"], ["rego_due", "Rego"]]) if (v[k]) { const dd = Math.round((new Date(v[k]) - new Date(t)) / 86400000); if (dd <= R.dueSoonDays) dueList.push({ dd, txt: `${v.plate} ${l} ${dd < 0 ? "overdue" : "due"} · ${label(v[k])}`, tab: "fleet" }); }
  for (const p of S.drivers) for (const [k, l] of [["licence_expiry", "licence"], ["dg_expiry", "DG"]]) if (p[k]) { const dd = Math.round((new Date(p[k]) - new Date(t)) / 86400000); if (dd <= R.dueSoonDays) dueList.push({ dd, txt: `${first(p.name)} ${l} ${dd < 0 ? "expired" : "due"} · ${label(p[k])}`, tab: "people" }); }
  dueList.sort((a, b) => a.dd - b.dd);
  const L = labourWeek(wk); const cls = v => v == null ? "grey" : v <= 0 ? "ok" : v <= 10 ? "warn" : "crit";
  return `<div class="card"><h2>Team scores<span>week of ${label(wk)} · ${scores.filter(s => s.closed || s.effDays.length).length} drivers</span></h2>
      <div class="tiles">${tile("Overall", team("overall"), `admin ${W.admin} · eff ${W.eff} · acc ${W.acc} · safety ${W.safe}`)}${tile("Admin", team("admin"), "posts on time")}${tile("Efficiency", team("eff"), "expected ÷ actual")}${tile("Accuracy", team("acc"), "NZ Post feed − mistakes")}${tile("Safety", team("safe"), "100% unless entered")}</div>
      <div class="meta mono" style="margin-top:4px">DUE WITHIN ${R.dueSoonDays} DAYS</div>${dueList.length ? `<div class="row" style="gap:4px">${dueList.map(d => `<button class="chip ${d.dd < 0 ? "miss" : "late"}" data-go="${d.tab}">${esc(d.txt)}</button>`).join("")}</div>` : `<div class="meta c-ok">✓ Vehicles &amp; licences up to date</div>`}
      <h2 style="margin-top:10px">Labour<span>wage rates from profiles (default $${R.hourRate}/h) · excludes Jeremy</span></h2>
      <div class="tiles"><div class="tile"><div class="l">Target (rostered)</div><div class="v">${L.T.toFixed(1)} h</div><div class="s">$${Math.round(L.spendT).toLocaleString()} planned</div></div><div class="tile"><div class="l">Actual so far</div><div class="v">${L.A.toFixed(1)} h</div><div class="s">$${Math.round(L.spendA).toLocaleString()} · ${L.done} of ${L.runs} runs in</div></div><div class="tile"><div class="l">Projected</div><div class="v">${L.P.toFixed(1)} h</div><div class="s">if the rest goes to roster</div></div><div class="tile"><div class="l">Tracking</div><div class="v c-${cls(L.trk)}">${L.trk == null ? "—" : (L.trk > 0 ? "+" : "") + Math.round(L.trk) + "%"}</div><div class="s">${L.A.toFixed(1)} h actual vs ${L.E.toFixed(1)} h expected${L.train ? ` · ${L.train.toFixed(1)} h training not counted` : ""}</div></div></div></div>`;
}
export function labourWeek(wk) {
  const R = S.C.rules; const rate = id => +(S.peopleBy[id]?.rate || R.hourRate); const t = today();
  let T = 0, A = 0, E = 0, P = 0, spendT = 0, spendA = 0, runs = 0, done = 0, train = 0; const rows = [];
  for (let i = 0; i < 7; i++) { const d = addDays(wk, i); let tt = 0, a = 0, e = 0, st = 0, sa = 0, tr = 0; const hol = S.C.holidays[d];
    for (const drv of S.drivers) { if (drv.pay_exclude) continue; const D = dayShifts(S.shifts.filter(s => s.day === d && s.driver === drv.id), S.runsBy, drv.id)[d];
      if (hol) { const hh = Math.min(R.holidayCap, hol.hours?.[drv.id] || 0); tt += hh; a += hh; st += hh * rate(drv.id); sa += hh * rate(drv.id); continue; }
      if (!D) continue; tt += D.hours; st += D.hours * rate(drv.id);
      const runSegs = D.segs.filter(x => !x.sort); runs += runSegs.length; const sod = D.segs.map(x => S.sodBy[x.shift.id]).find(Boolean); const eods = runSegs.map(x => S.eodBy[x.shift.id]).filter(Boolean); done += eods.length;
      if (sod && eods.length === runSegs.length && runSegs.length) { const lastE = eods[eods.length - 1]; const sm = nzNow(new Date(sod.sent_at)).min, em = lastE.finish_time ? toMin(lastE.finish_time) : nzNow(new Date(lastE.sent_at)).min; let act = Math.max(0, (em - sm) / 60);
        const sortRost = D.segs.filter(x => x.sort).reduce((q2, x) => q2 + ((x.en ?? x.st) - x.st), 0);
        runSegs.forEach((x, i2) => { const ov = S.ovs.find(o => o.shift_id === x.shift.id); const c = effCalc(x, S.eodBy[x.shift.id], ov, S.C, S.runsBy, { sortRost: i2 === 0 ? sortRost : 0 }); if (c) { if (c.trainDay) { tr += c.taken || 0; } else { e += c.allowed / 60; if (ov?.train_min) tr += ov.train_min / 60; } } });
        a += act; sa += act * rate(drv.id); } }
    T += tt; A += a; E += e; spendT += st; spendA += sa; train += tr; P += (d >= t && !hol) ? tt : a; rows.push({ d, t: tt, a, e, st, sa, hol, tr }); }
  const trk = E && A ? ((A - train) - E) / E * 100 : null;
  return { T, A, E, P, spendT, spendA, trk, rows, runs, done, train };
}
function hoursByDay(wk) {
  const L = labourWeek(wk); const max = Math.max(1, ...L.rows.map(r => Math.max(r.t, r.a, r.e))); const W = 420, H = 150, bw = 44;
  const bars = L.rows.map((r, i) => { const x = 20 + i * 56; const y = v => H - 20 - (v / max) * (H - 40); const over = r.e && r.a ? (r.a - r.e) / r.e * 100 : null; const fill = r.hol ? "var(--van, #9085e9)" : over == null ? "var(--accent)" : over <= 0 ? "var(--ok)" : over <= 10 ? "var(--warn)" : "var(--crit)";
    return `<rect x="${x}" y="${y(r.t)}" width="${bw / 2}" height="${H - 20 - y(r.t)}" fill="var(--line)"/><rect x="${x + bw / 2}" y="${y(r.a)}" width="${bw / 2}" height="${H - 20 - y(r.a)}" fill="${fill}"/>${r.e ? `<line x1="${x}" x2="${x + bw}" y1="${y(r.e)}" y2="${y(r.e)}" stroke="var(--ink)" stroke-width="2"/>` : ""}<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--ink3)">${DAYS[i]}</text>${over != null ? `<text x="${x + bw / 2}" y="${Math.min(y(r.a), y(r.e)) - 4}" text-anchor="middle" font-size="10" fill="var(--ink2)">${over > 0 ? "+" : ""}${Math.round(over)}%</text>` : ""}`; }).join("");
  return `<div class="card"><h2>Hours tracking by day<span>grey = target · colour = actual · line = expected from EOD figures</span></h2><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${bars}</svg>
    <div class="scroll"><table class="dt"><tr><th>Day</th><th>Target</th><th>Expected</th><th>Actual</th><th>Training</th><th>Tracking</th><th>Spend</th></tr>${L.rows.map(r => { const v = r.e && r.a ? ((r.a - r.tr) - r.e) / r.e * 100 : null; return `<tr><td>${label(r.d).slice(0, 6)}${r.hol ? ` <span class="meta">${esc(r.hol.name)} · paid</span>` : ""}</td><td class="num">${r.t.toFixed(1)}</td><td class="num">${r.e ? r.e.toFixed(1) : "—"}</td><td class="num">${r.a ? r.a.toFixed(1) : r.d > today() ? "to come" : "—"}</td><td class="num">${r.tr ? r.tr.toFixed(1) : ""}</td><td class="c-${v == null ? "grey" : v <= 0 ? "ok" : v <= 10 ? "warn" : "crit"}">${v == null ? "—" : (v > 0 ? "+" : "") + Math.round(v) + "%"}</td><td class="num">$${Math.round(r.sa || r.st).toLocaleString()}${r.sa ? "" : " plan"}</td></tr>`; }).join("")}<tr><td><b>Week</b></td><td class="num"><b>${L.T.toFixed(1)}</b></td><td class="num"><b>${L.E.toFixed(1)}</b></td><td class="num"><b>${L.A.toFixed(1)}</b></td><td class="num">${L.train ? L.train.toFixed(1) : ""}</td><td></td><td class="num"><b>$${Math.round(L.spendA || L.spendT).toLocaleString()}</b></td></tr></table></div></div>`;
}

/* ---- Admin action centre ---- */
function actionCentre(scores, n) {
  const t = n.date; const R = S.C.rules;
  const reviews = scores.flatMap(s => s.items.filter(i => (i.st === "late" || i.st === "miss") && !i.mark?.reviewed && !i.pre)).length;
  const overdue = scores.flatMap(s => s.items.filter(i => i.day === t && i.st === "over")).length;
  const pending = scores.flatMap(s => s.effDays.filter(e => e.pending && e.day < t)).length;
  const leave = S.leave.filter(l => l.status === "pending").length;
  const ackOf = {}; for (const a of S.acks) (ackOf[a.item_id] ??= {})[a.driver] = a; let unc = 0; for (const i of S.items.filter(i => i.roster_changes.status === "sent" && i.day >= t)) for (const d of i.affects) { const a = ackOf[i.id]?.[d]; if (!a?.confirmed_at && !a?.dismissed_at) unc++; }
  const aw = S.items.filter(i => i.roster_changes.status === "awaiting_approval").length;
  const mist = S.entries.filter(e => e.kind === "mistake" && !e.excused && e.day >= monOf(t)).length;
  const lic = S.drivers.filter(p => [p.licence_expiry, p.dg_expiry].some(d => d && (new Date(d) - new Date(t)) / 86400000 <= R.dueSoonDays));
  const vans = S.vans.filter(v => v.active && v.plate !== "OTHER" && ([v.wof_due, v.rego_due].some(d => d && (new Date(d) - new Date(t)) / 86400000 <= R.dueSoonDays) || v.wof_failed || (!v.no_ruc && v.ruc_paid_to && v.odometer && v.ruc_paid_to - v.odometer <= R.rucSoonKm)));
  const alerts = S.alerts.filter(a => !a.resolved_at).length;
  const rows = [[reviews, "Reviews to do", "posts to confirm or excuse", "scorecard", reviews ? "warn" : ""], [overdue, "Overdue right now", "SOD/EOD not in yet today", "alerts", overdue ? "crit" : ""], [pending, "Missing EOD figures", "runs that can't be scored yet", "scorecard", pending ? "warn" : ""], [aw, "Roster changes to approve", "made by Alejandro", "runboard", aw ? "warn" : ""], [unc, "Roster changes not confirmed", "drivers haven't tapped Got it", "runboard", unc ? "crit" : ""], [leave, "Leave requests waiting", "approve or decline", "leave", leave ? "warn" : ""], [mist, "Mistakes logged this week", "Driver Mistakes Record", "scorecard", mist ? "crit" : ""], [lic.length, "Licences & DG due", lic.map(p => first(p.name)).slice(0, 3).join(", "), "people", lic.length ? "warn" : ""], [vans.length, "Vehicles due", "WOF, rego, RUCs", "fleet", vans.length ? "warn" : ""], [alerts, "Open alerts", "resolve or let them clear", "alerts", alerts ? "warn" : ""]].filter(r => r[0]);
  return `<div class="card"><h2>Admin<span>${rows.length ? "what needs you" : "all complete"}</span></h2>${rows.length ? `<div class="list">${rows.map(([c, l, s, tab, cls]) => `<button class="item ${cls}" data-go="${tab}" style="border:0;color:inherit;text-align:left;cursor:pointer"><div class="row" style="justify-content:space-between"><b>${esc(l)}</b><span class="pill ${cls || "grey"}">${c}</span></div><div class="meta">${esc(s)}</div></button>`).join("")}</div>` : `<p class="empty">✓ All complete<br><span class="meta">No reviews, overdue posts, approvals or mistakes waiting.</span></p>`}</div>`;
}

/* ---- Roster changes not confirmed ---- */
function notConfirmed(n) {
  const t = n.date; const ackOf = {}; for (const a of S.acks) (ackOf[a.item_id] ??= {})[a.driver] = a; const by = {};
  for (const i of S.items.filter(i => i.roster_changes.status === "sent" && i.day >= t)) for (const d of i.affects) { const a = ackOf[i.id]?.[d]; const st = toMin(i.after?.start_at); const past = i.day === t && st != null && n.min >= st; if (!a?.confirmed_at && !a?.dismissed_at && !past) (by[d] ??= []).push(i); }
  const L = Object.entries(by).sort((a, b) => (a[1][0].roster_changes.sent_at || "").localeCompare(b[1][0].roster_changes.sent_at || ""));
  return `<div class="card ${L.length ? "hot" : ""}"><h2>Roster changes — not confirmed<span>${L.length ? `${L.length} driver${L.length > 1 ? "s" : ""} waiting, oldest first` : "nothing waiting"}</span></h2>${L.length ? `<div class="list">${L.map(([d, items]) => `<div class="item crit"><div class="row" style="justify-content:space-between"><b>${esc(nm(d))}</b><span class="meta">sent ${fmtTs(items[0].roster_changes.sent_at)} · ${ago(items[0].roster_changes.sent_at)}</span><span class="row" style="flex:0"><button class="btn sm ghost" data-ack="ok" data-drv="${d}" data-items="${items.map(i => i.id).join(",")}">✓ Confirm</button><button class="btn sm ghost" data-ack="dis" data-drv="${d}" data-items="${items.map(i => i.id).join(",")}">Dismiss</button></span></div><ul style="margin:4px 0;padding-left:18px;color:var(--crit)">${items.map(i => `<li>${esc(i.summary)}</li>`).join("")}</ul></div>`).join("")}</div>` : ""}<p class="meta">Drivers confirm with one tap in the app. <button class="linkbtn" data-go="runboard">History of all roster changes →</button></p></div>`;
}

/* ---- Drivers grid ---- */
function driversGrid(scores) {
  const list = scores.filter(s => s.closed || s.effDays.length || s.nMist).sort((a, b) => (a.overall ?? 101) - (b.overall ?? 101));
  return `<div class="card"><h2>Drivers<span>this week · tap a name for history and results</span></h2>${list.length ? `<div class="dgrid">${list.map(s => { const d = S.peopleBy[s.driver]; const hrs = Object.values(s.days).reduce((a, x) => a + x.hours, 0);
    return `<button class="dcard" data-driver="${s.driver}" style="border:0;color:inherit;text-align:left"><div class="ring" style="--p:${Math.round(s.overall || 0)};--c:var(--${col(s.overall) === "grey" ? "grey" : col(s.overall)})"><span>${pct(s.overall)}</span></div><div style="flex:1"><b>${esc(d.name)}</b>${band(s.eff) != null ? ` <span class="meta">Band ${band(s.eff) || "<1"}</span>` : ""}<div class="meta">${hrs.toFixed(1)} h rostered · ${s.onTime}/${s.closed} on time</div><div class="mini">${[["Adm", s.admin], ["Eff", s.eff], ["Acc", s.acc], ["Saf", s.safe]].map(([l, v]) => `<span>${l}</span><div class="bar"><i class="bg-${col(v)}" style="width:${Math.min(100, v || 0)}%"></i></div><span class="c-${col(v)}">${pct(v)}</span>`).join("")}</div><div class="meta">${[s.missing ? `<span class="c-crit">${s.missing} missing</span>` : "", s.late ? `<span class="c-warn">${s.late} late</span>` : "", s.nMist ? `<span class="c-crit">${s.nMist} mistake${s.nMist > 1 ? "s" : ""}</span>` : ""].filter(Boolean).join(" · ") || "no issues"}</div></div></button>`; }).join("")}</div>` : `<p class="empty">No driver data for this week yet. Scores appear once SODs and EODs come in.</p>`}</div>`;
}
function postsBoard(selScores, days, t) {
  if (days.length === 1) { const d = days[0]; const rows = selScores.filter(s => s.items.length).map(s => { const D = s.days[d]; const sod = s.items.find(i => i.kind === "SOD"); const eods = s.items.filter(i => i.kind === "EOD"); return `<tr><td><b>${esc(nm(s.driver))}</b><div class="meta">${D ? `${fmtT(D.start)}–${fmtT(D.end)} · ${D.hours}h · ${D.segs.map(x => x.shift.run + (x.shift.trainee ? " (training " + fnm(x.shift.trainee) + ")" : "")).join(" · ")}` : ""}</div></td><td>${sod ? chip(sod) : ""}</td><td>${eods.map(e => `<div style="margin:2px 0"><span class="meta mono">${esc(e.code || "day")}</span> ${chip(e)}</div>`).join("")}</td></tr>`; });
    return rows.length ? `<div class="scroll"><table class="dt"><tr><th>Driver</th><th>SOD</th><th>EOD (one per run)</th></tr>${rows.join("")}</table></div><p class="hint">● on time · ● late · ● overdue / missing · ● due · struck = excused · outlined = set by hand</p>` : `<p class="empty">Nobody tracked is rostered on ${label(d)}.</p>`; }
  return `<div class="scroll"><table class="dt"><tr><th>Driver</th>${days.map(d => `<th class="${d === t ? "c-accent" : ""}">${label(d).slice(0, 6)}</th>`).join("")}<th>On time</th><th>Late</th><th>Missing</th><th>Rate</th><th>Admin</th></tr>${selScores.filter(s => s.items.length).map(s => `<tr><td><b>${esc(nm(s.driver))}</b></td>${days.map(d => `<td style="white-space:nowrap">${s.items.filter(i => i.day === d).map(it => `<button class="chip ${it.st}" data-item="${esc(it.key)}" title="${esc(it.label)} · ${itemNote(it)}" style="width:14px;height:14px;padding:0;border-radius:3px;margin:1px"></button>`).join("")}</td>`).join("")}<td class="num">${s.onTime}</td><td class="num">${s.late}</td><td class="num">${s.missing}</td><td class="num">${s.closed ? Math.round(s.onTime / s.closed * 100) + "%" : "—"}</td><td class="c-${col(s.admin)}">${pct(s.admin)}</td></tr>`).join("")}</table></div><p class="hint">One square per required post · tap a square to review it</p>`;
}
function newspapers(wk) {
  const runs = S.C.news.runs || []; const chips = runs.map(code => { const ws = S.shifts.filter(s => s.day >= wk && s.day <= addDays(wk, 6) && s.run === code && s.driver); const hit = ws.map(s => ({ s, e: S.eodBy[s.id] })).find(x => x.e?.newspapers); return `<span class="chip ${hit ? "ok" : dow(today()) >= 6 ? "miss" : "due"}">${esc(code)} · ${hit ? `${esc(fnm(hit.s.driver))} · ${label(hit.s.day)} ✓` : ws.length ? "not claimed yet" : "not rostered"}</span>`; });
  return `<div class="card"><h2>Newspapers claim<span>once a week · ${S.C.news.min} minutes added to that day's time allowed</span></h2><div class="row" style="gap:4px">${chips.join("")}</div></div>`;
}
function onTimeByDay(wk, D) {
  const vals = DAYS.map((_, i) => { const d = addDays(wk, i); const its = S.drivers.flatMap(dr => scoreFor(dr.id, d, d, D, S.C).items).filter(x => !["due", "over", "exc"].includes(x.st)); return { d, n: its.length, ok: its.filter(x => x.st === "ok").length }; });
  const W = 420, H = 130;
  return `<div class="card"><h2>Team on-time rate by day<span>posts that are due and closed</span></h2><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${vals.map((v, i) => { const x = 20 + i * 56; const pctv = v.n ? v.ok / v.n * 100 : null; const h = pctv == null ? 0 : (pctv / 100) * (H - 40); return `<rect x="${x}" y="${H - 20 - h}" width="40" height="${h}" fill="var(--${col(pctv) === "grey" ? "line" : col(pctv)})"/><text x="${x + 20}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--ink3)">${DAYS[i]}</text>${pctv != null ? `<text x="${x + 20}" y="${H - 24 - h}" text-anchor="middle" font-size="10" fill="var(--ink2)">${Math.round(pctv)}%</text>` : ""}`; }).join("")}</svg></div>`;
}
function feed(t) {
  const ev = [];
  for (const s of S.sods) { const sh = S.shifts.find(x => x.id === s.shift_id); if (sh?.day === t) ev.push({ at: s.sent_at, txt: `${nm(s.driver)} · SOD${s.van ? ` · ${s.van}` : ""}${s.note ? ` · ${s.note}` : ""}`, cls: "ok" }); }
  for (const e of S.eods) { const sh = S.shifts.find(x => x.id === e.shift_id); if (sh?.day === t) ev.push({ at: e.sent_at, txt: `${nm(e.driver)} · EOD ${sh.run}${e.parcels != null ? ` · ${e.parcels} parcels` : ""}${e.stops != null ? ` · ${e.stops} stops` : ""}${e.note ? ` · ${e.note}` : ""}`, cls: "accent" }); }
  for (const a of S.acks) if (a.confirmed_at?.slice(0, 10) === t) ev.push({ at: a.confirmed_at, txt: `${nm(a.driver)} confirmed a roster change${a.confirmed_by ? ` (by ${fnm(a.confirmed_by)})` : ""}`, cls: "ok" });
  for (const r of S.recips) if (r.read_at?.slice(0, 10) === t) ev.push({ at: r.confirmed_at || r.read_at, txt: `${nm(r.person)} ${r.confirmed_at ? "confirmed" : "read"} a message`, cls: "" });
  for (const l of S.leave) if (l.created_at.slice(0, 10) === t) ev.push({ at: l.created_at, txt: `${nm(l.driver)} asked for leave · ${label(l.date_from)}`, cls: "warn" });
  for (const a of S.alerts) if (a.created_at.slice(0, 10) === t) ev.push({ at: a.created_at, txt: `⚠ ${a.title}`, cls: a.resolved_at ? "" : "crit" });
  for (const c of S.vchk) if (c.at.slice(0, 10) === t) ev.push({ at: c.at, txt: `${nm(c.driver)} · vehicle check ${c.van}`, cls: "ok" });
  ev.sort((a, b) => b.at.localeCompare(a.at));
  return ev.length ? `<div class="list" style="max-height:420px;overflow:auto">${ev.slice(0, 60).map(e => `<div class="item ${e.cls}" style="padding:6px 10px"><span class="m">${fmtTime(e.at)}</span> ${esc(e.txt)}</div>`).join("")}</div>` : `<p class="empty">Nothing yet today. SODs, EODs, confirmations and alerts show here as they happen.</p>`;
}

/* ---- wiring ---- */
export function wireLive() {
  $$("[data-day]").forEach(b => b.onclick = () => { const d = b.dataset.day; const cur = sel(); S.daySel = cur.includes(d) ? (cur.length > 1 ? cur.filter(x => x !== d) : cur) : [...cur, d].sort(); render(); });
  $$("[data-days]").forEach(b => b.onclick = () => { const wk = monOf(today()); S.daySel = b.dataset.days === "today" ? [today()] : DAYS.map((_, i) => addDays(wk, i)); render(); });
  $$("[data-go]").forEach(b => b.onclick = () => { S.tab = b.dataset.go; location.hash = S.tab; render(); });
  $$("[data-dismiss]").forEach(b => b.onclick = async () => { await q(sb.from("marks").upsert({ key: b.dataset.dismiss, status: "exc", reviewed: true, note: "Dismissed on the dashboard", by_person: S.me.id, at: new Date().toISOString() })); });
  $("#imp-undismiss")?.addEventListener("click", async () => { await sb.from("marks").delete().like("key", "imp|%"); });
  $$("[data-ack]").forEach(b => b.onclick = async () => { const ids = b.dataset.items.split(","); const patch = b.dataset.ack === "ok" ? { confirmed_at: new Date().toISOString(), confirmed_by: S.me.id } : { dismissed_at: new Date().toISOString(), confirmed_by: S.me.id }; await q(sb.from("change_acks").update(patch).in("item_id", ids).eq("driver", b.dataset.drv)); toast(b.dataset.ack === "ok" ? "Confirmed" : "Dismissed", "ok"); });
  $$("[data-item]").forEach(b => b.onclick = () => import("/admin/scorecard.js").then(m => m.itemSheet(b.dataset.item)));
  $$("[data-driver]").forEach(b => b.onclick = () => import("/admin/scorecard.js").then(m => m.driverSheet(b.dataset.driver)));
  const el = $("#map"); if (!el || !window.L) return;
  const map = L.map(el, { zoomControl: true }).setView([-45.88, 170.4], 10);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap © CARTO", maxZoom: 19 }).addTo(map);
  const latest = {}; for (const l of S.locs) if (!latest[l.driver]) latest[l.driver] = l;
  const pts = Object.values(latest).filter(l => { const sh = S.shifts.find(s => s.id === l.shift_id); return sh ? !S.eodBy[sh.id] : true; });
  for (const l of pts) { const stale = Date.now() - new Date(l.at) > 600e3; L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "", html: `<div class="mk ${stale ? "stale" : ""}">${esc(fnm(l.driver))}</div>`, iconAnchor: [20, 12] }) }).addTo(map).bindPopup(`<b>${esc(nm(l.driver))}</b><br>${esc(fmtTs(l.at))}${l.speed ? `<br>${Math.round(l.speed * 3.6)} km/h` : ""}`); }
  if (pts.length) map.fitBounds(L.latLngBounds(pts.map(l => [l.lat, l.lng])).pad(0.3), { maxZoom: 13 });
}
