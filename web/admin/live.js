// Live board: what is happening right now — shift right now, add-ons right now, available drivers & vans, unpaid breaks, live feed and the map.
import { sb, q, nzNow, today, addDays, dow, dayName, monOf, label, toMin, fmtT, fmtTs, fmtTime, ago, esc, $, $$, toast, pill, first, col, pct, isSort, avg, sum } from "/shared/core.js";
import { sodStart, scoreFor, fortnight, itemNote, STATE_LABEL, effCalc, ownerBreakHrs, band, fortnightBand, payBand, money, dayShifts, segTimes, addName, meetRule, meetOn, XT_KINDS, extraMins } from "/shared/score.js";
import { S, sheet, opt, nm, fnm, loadAll, render, scoreData, alertRow, fn, teamRange, rangeBar, teamStats } from "/admin/admin.js";
import { itemKeyFor } from "/admin/detail.js";
import { actBtns, addMark } from "/admin/settle.js";
import { eodEdit } from "/admin/scorecard.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The week the live board is showing: this week by default, back 8 weeks or forward 1 */
function liveWk() { const cur = monOf(today()); const w = S.liveWk || cur; return w > addDays(cur, 7) ? addDays(cur, 7) : w < addDays(cur, -56) ? addDays(cur, -56) : w; }
function weekNav(wk) { const cur = monOf(today()); const rel = wk === cur ? "This week" : wk === addDays(cur, 7) ? "Next week" : wk === addDays(cur, -7) ? "Last week" : wk > cur ? "Coming week" : "Past week";
  return `<div class="wkbar"><button class="ar" data-lwk="-1" ${wk <= addDays(cur, -56) ? "disabled" : ""}>‹</button><b>${rel} · ${label(wk)} – ${label(addDays(wk, 6))}</b><button class="ar" data-lwk="1" ${wk >= addDays(cur, 7) ? "disabled" : ""}>›</button><button class="btn ghost sm" data-lwk="0">This week</button><button class="btn ghost sm" data-lwk="next">Next week</button></div>`; }
function sel() { const wk = liveWk(); if (!S.daySel || S.daySelWk !== wk) { S.daySel = DAYS.map((_, i) => addDays(wk, i)); S.daySelWk = wk; } return S.daySel; }
const chip = it => `<button class="chip ${it.st} ${it.mark?.status ? "man" : ""}" data-item="${esc(it.key)}" title="${STATE_LABEL[it.st]}">${esc(it.label)} <span style="font-weight:500">${itemNote(it).replace(/^posted /, "")}</span></button>`;
const tile = (l, v, s = "", cls = null, attrs = "") => `<${attrs ? "button" : "div"} class="tile" ${attrs}><div class="l">${l}</div><div class="v ${cls || (typeof v === "number" || v == null ? "c-" + col(v) : "")}">${typeof v === "number" || v == null ? pct(v) : v}</div>${s ? `<div class="s">${s}</div>` : ""}</${attrs ? "button" : "div"}>`;

export function liveTab() {
  const n = nzNow(); const t = n.date;
  const boss = S.me.isOwner || S.me.role === "admin"; const nSod = boss ? (S.sodReqs || []).filter(r => r.status === "pending").length : 0, nXt = S.me.isOwner ? (S.extra || []).filter(r => r.status === "pending").length : 0;
  const signBar = nSod + nXt ? `<button class="btn sm" data-go="fix" style="margin-bottom:10px">⏱ ${[nSod ? `${nSod} start time${nSod > 1 ? "s" : ""}` : "", nXt ? `${nXt} hours` : ""].filter(Boolean).join(" · ")} to sign off → Admin</button>` : "";
  return `${signBar}<div class="top4">${nowCard(n)}${availCard(S.avDay || t, n)}${onBreakCard()}</div>
    <div class="grid2"><div class="card"><h2>Live feed<span>today</span></h2>${feed(t)}</div><div class="card"><h2>Where everyone is<span>app open · grey = 10+ min old</span></h2><div class="map" id="map"></div></div></div>`;
}
// Admin tab: sign-offs and the to-do list (moved off Live)
export function adminTop() { const n = nzNow(); const wk = monOf(n.date); const D = scoreData();
  const scores = S.drivers.map(d => scoreFor(d.id, wk, addDays(wk, 6), D, S.C));
  return `${S.me.isOwner || S.me.role === "admin" ? `<div class="grid2">${sodReqCard()}${xtCard()}</div>` : ""}${actionCentre(scores, n)}`; }
export function adminEnd() { return addonBoard(nzNow().date, nzNow()); }
export function hoursCard(wk) { return hoursByDay(wk); }

/* ---- Available · vans not in use and drivers free on the day (gaps of an hour or more, vans 5am–6pm, drivers 6am–5pm).
   Drivers who are never on call (Jeremy, James S, Jack, Pat, Peter) and anyone on approved leave are left out. ---- */
const AV_SKIP = new Set(["J", "JA", "CH", "dmudmfw51", "dmudma1p1", "dmuf17o3o"]);
function gaps(busy, from, to, min = 60) { const b = busy.filter(x => x[1] > from && x[0] < to).sort((x, y) => x[0] - y[0]); const out = []; let c = from;
  for (const [a, e] of b) { if (a - c >= min) out.push([c, a]); c = Math.max(c, e); } if (to - c >= min) out.push([c, to]); return out; }
const hrs = m => { const h = m / 60; return (Math.round(h * 2) / 2).toString().replace(/\.0$/, "") + "h"; };
function availCard(day, n) {
  const sh = S.shifts.filter(s => s.day === day && s.driver && s.run !== "BU").map(s => ({ s, ...segTimes(s, S.runsBy) })).filter(x => x.st != null);
  const isT = day === n.date; const fT = toMin(S.avFrom), tT = toMin(S.avTo); const nowM = Math.max(isT && fT == null ? n.min : 0, fT ?? 0); const endM = tT ?? 1440;
  const live = w => w.map(([a, e]) => [Math.max(a, nowM), Math.min(e, endM)]).filter(([a, e]) => e - a >= 60);
  const vans = (S.vans || []).filter(v => v.active && v.plate !== "OTHER").map(v => { const busy = sh.filter(x => x.s.van === v.plate).map(x => [x.st, x.en ?? x.st]); const w = live(gaps(busy, 300, 1080)); return { v, w, unused: !busy.length }; }).filter(x => x.w.length);
  const off = id => (S.leave || []).some(l => l.driver === id && l.status === "approved" && day >= l.date_from && day <= l.date_to);
  const drv = S.drivers.filter(d => d.role === "driver" && !AV_SKIP.has(d.id) && !off(d.id)).map(d => { const busy = sh.filter(x => x.s.driver === d.id).map(x => [x.st, x.en ?? x.st]); const w = live(gaps(busy, 360, 1020)); return { d, w, off: !busy.length }; }).filter(x => x.w.length).sort((a, b) => b.w.reduce((t, [x, y]) => t + y - x, 0) - a.w.reduce((t, [x, y]) => t + y - x, 0));
  const win = w => w.map(([a, e]) => `${fmtT(a)}–${fmtT(e)} <span class="meta">(${hrs(e - a)})</span>`).join(", ");
  const when = fT != null || tT != null ? ` · ${fmtT(fT ?? (isT ? n.min : 300))}–${fmtT(tT ?? 1080)}` : isT ? " from now" : "";
  return `<div class="card" id="avail"><h2><i class="ico">🚐</i>Available ${isT && fT == null ? "now" : label(day)}<span>${vans.length} van${vans.length === 1 ? "" : "s"} · ${drv.length} driver${drv.length === 1 ? "" : "s"} free${when} · gaps of 1h+</span></h2>
    <div class="row" style="gap:6px;align-items:flex-end;flex-wrap:wrap"><label class="f" style="flex:0 1 150px">Day<input class="in" type="date" id="av-day" value="${day}"></label><label class="f" style="flex:0 1 110px">From<input class="in" type="time" id="av-from" value="${S.avFrom || ""}"></label><label class="f" style="flex:0 1 110px">To<input class="in" type="time" id="av-to" value="${S.avTo || ""}"></label><button class="btn sm" id="av-go" style="flex:0 0 auto">Show</button><button class="btn ghost sm" id="av-now" style="flex:0 0 auto">Now</button></div>
    <div class="grid2" style="gap:10px;font-size:13px"><div><div class="meta mono" style="margin-bottom:4px">VEHICLES</div>${vans.length ? vans.map(x => `<div class="row" style="justify-content:space-between;gap:6px;padding:2px 0"><b>${esc(x.v.plate)}</b><span style="text-align:right">${x.unused ? `<span class="c-ok">not used${isT && nowM > 300 ? " · free" : ""}</span>` : win(x.w)}</span></div>`).join("") : `<p class="empty">All in use.</p>`}</div>
    <div><div class="meta mono" style="margin-bottom:4px">DRIVERS</div>${drv.length ? drv.map(x => `<div class="row" style="justify-content:space-between;gap:6px;padding:2px 0"><b>${esc(nm(x.d.id))}</b><span style="text-align:right">${x.off ? `<span class="c-ok">not rostered</span> · ` : ""}${win(x.w)}</span></div>`).join("") : `<p class="empty">Nobody free.</p>`}</div></div></div>`;
}

/* ---- Right now · the start view: only who is due on shift at this moment (on shift = green, late = red with minutes) and only the
   add-ons / timed tasks that are due now or overdue and not done. Nothing that isn't due yet is shown. Always today, whatever week is picked. ---- */
const minsTxt = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
function nowCard(n) {
  const t = n.date, now = n.min, R = S.C.rules; const grace = R.sodGrace ?? 15;
  if (S.C.holidays[t]) return `<div class="card" id="rightnow"><h2><i class="ico">👥</i>Right now · ${fmtT(now)}<span>${label(t)}</span></h2><p class="empty">Public holiday · no runs today.</p></div>`;
  const off = id => (S.leave || []).some(l => l.driver === id && l.status === "approved" && t >= l.date_from && t <= l.date_to);
  const todays = S.shifts.filter(s => s.day === t && s.driver && s.run !== "BU" && !off(s.driver));
  const byDrv = {}; for (const s of todays) (byDrv[s.driver] ??= []).push(s);
  // ---- who's due on shift
  const ppl = [];
  for (const [id, list] of Object.entries(byDrv)) {
    const D = dayShifts(list, S.runsBy, id)[t]; if (!D || now < D.start) continue;                       // not started yet → not shown
    const runs = D.segs.filter(x => !x.sort); const sod = D.segs.map(x => S.sodBy[x.shift.id]).find(Boolean);
    const allEod = runs.length ? runs.every(x => S.eodBy[x.shift.id]) : D.segs.some(x => S.eodBy[x.shift.id]);
    if (allEod) continue;                                                                                // finished for the day → not shown
    if (!sod && now > D.end + (R.eodHours ?? 2) * 60) continue;                                         // day long over with no SOD → Alerts tab has it
    const segNm = x => x.sort ? (S.runsBy[x.shift.run]?.label || "Sort") : x.shift.run;
    const cur = D.segs.find(x => now >= x.st && now < (x.en ?? x.st)), nxt = D.segs.find(x => now < x.st);
    const what = cur ? segNm(cur) : nxt ? `between runs · next ${segNm(nxt)} ${fmtT(nxt.st)}` : segNm(D.segs[D.segs.length - 1]);
    const late = now - D.start;
    let lv, st, sub;
    if (sod) { const sm = nzNow(new Date(sod.sent_at)).min; const lateBy = sm - D.start;
      lv = "ok"; st = "On shift"; sub = `SOD ${fmtTime(sod.sent_at)}${lateBy > grace ? ` · started ${minsTxt(lateBy)} late` : ""}`;
      if (now > D.end) { lv = "warn"; st = "Past finish"; sub = `rostered to ${fmtT(D.end)} · EOD not in`; } }
    else if (late <= grace) { lv = "warn"; st = `Starting · ${late} min`; sub = `rostered ${fmtT(D.start)} · no SOD yet`; }
    else { lv = "crit"; st = `LATE ${minsTxt(late)}`; sub = `rostered ${fmtT(D.start)} · no SOD`; }
    ppl.push({ id, lv, st, sub, what, D, w: lv === "crit" ? 0 : lv === "warn" ? 1 : 2, late });
  }
  ppl.sort((a, b) => a.w - b.w || b.late - a.late || a.D.start - b.D.start);
  // ---- add-ons and timed tasks that are due now or overdue, not done
  const due = [];
  for (const s of todays) {
    const { st, en } = segTimes(s, S.runsBy); const dn = s.done || {}; const plan = s.plan || {}; const seen = new Set(); const srt = isSort(s.run);
    for (const r of rulesForShift(s)) { if (srt && r.runs.includes("ALL")) continue;                    // sorts: only their own sort tasks, not the any-run ones
 const key = r.done_key || r.addon; if (r.addon) seen.add(r.addon); if (!key || dn[key]) continue;
      if (key.startsWith("tw_") && /game plan/i.test(r.name) && Object.keys(plan).length) continue;
      const o = toMin(r.opens), c = toMin(r.closes);
      if (c != null && now > c) due.push({ s, rule: r.id, name: r.name, lv: "crit", txt: `${minsTxt(now - c)} overdue · was due by ${fmtT(c)}`, k: -(now - c) });
      else if (c != null && (o != null ? now >= o : now >= c - 30 && now >= (st ?? 0))) due.push({ s, rule: r.id, name: r.name, lv: c - now <= 15 ? "warn" : "accent", txt: `due by ${fmtT(c)} · ${minsTxt(c - now)} left`, k: c - now });   // window open, or closing within 30 min
      else if (c == null && en != null && now > en) due.push({ s, rule: r.id, name: r.name, lv: "crit", txt: `not done · shift finished ${fmtT(en)}`, k: -(now - en) });            // "before you finish" tasks
      else if (c == null && o != null && now >= o) due.push({ s, rule: r.id, name: r.name, lv: "accent", txt: `open since ${fmtT(o)}`, k: 600 }); }
    for (const id of s.addons || []) { if (seen.has(id) || dn[id]) continue; const a = S.addons.find(x => x.id === id); if (!a) continue; const pm = toMin(plan[id]);
      if (en != null && now > en) due.push({ s, name: a.short || a.name, lv: "crit", txt: `not marked done · run finished ${fmtT(en)}`, k: -(now - en) });
      else if (pm != null && now >= pm) due.push({ s, name: a.short || a.name, lv: "warn", txt: `planned ${fmtT(pm)} · not done yet`, k: 0 }); }
  }
  due.sort((a, b) => a.k - b.k);
  const nLate = ppl.filter(p => p.lv === "crit").length, nOver = due.filter(d => d.lv === "crit").length;
  const pRow = p => `<div class="item clk ${p.lv}" data-personof="${esc(p.id)}" title="Tap for ${esc(first(nm(p.id)))}'s sheet"><div class="row" style="justify-content:space-between;align-items:baseline"><b>${esc(nm(p.id))}</b><b class="c-${p.lv === "crit" ? "crit" : p.lv === "warn" ? "warn" : "ok"}">${p.lv === "ok" ? "● " : ""}${esc(p.st)}</b></div><div class="m">${esc(p.what)} · ${fmtT(p.D.start)}–${fmtT(p.D.end)} · ${esc(p.sub)}</div></div>`;
  const dRow = d => `<div class="item clk ${d.lv}" data-task="${d.s.id}"${d.rule ? ` data-rule="${esc(d.rule)}"` : ""} title="Tap for the plan, history and the driver's day"><div class="row" style="justify-content:space-between;align-items:baseline"><b>${esc(d.name)}</b><span class="meta">${esc(d.s.run)} · ${esc(fnm(d.s.driver))}</span></div><div class="m ${d.lv === "crit" ? "c-crit" : ""}">${esc(d.txt)}</div></div>`;
  return `<div class="card ${nLate ? "hot" : ""}" id="rightnow"><h2><i class="ico">👥</i>Shift right now · ${fmtT(now)}<span>${ppl.length} on${nLate ? ` · <b class="c-crit">${nLate} late for shift</b>` : " · ✓ nobody late"} · updates every minute</span></h2>
    ${ppl.length ? `<div class="list">${ppl.map(pRow).join("")}</div>` : `<p class="empty">Nobody due on shift right now.</p>`}</div>
  <div class="card ${nOver ? "hot" : ""}" id="rightnow-addons"><h2><i class="ico">✅</i>Add-ons right now · ${fmtT(now)}<span>${due.length} due${nOver ? ` · <b class="c-crit">${nOver} overdue</b>` : " · ✓ nothing overdue"} · updates every minute</span></h2>
    ${due.length ? `<div class="list">${due.map(dRow).join("")}</div>` : `<p class="empty">✓ Nothing due or overdue.</p>`}</div>`;
}

/* ---- Add-ons & timings · one board for the day: every add-on and timed task on every run, done or not ---- */
function rulesForShift(s) {
  const d = dow(s.day) + 1; const out = [];
  for (const r of S.rules) { if (!r.active || !(r.days || []).includes(d)) continue; const all = r.runs.includes("ALL"); if (!all && !r.runs.includes(s.run)) continue;
    const ad = r.addon ? S.addons.find(a => a.id === r.addon) : null; if (ad?.always && ad.runs.includes(s.run)) { out.push(r); continue; } if (ad && ad.runs.includes(s.run)) { if (!(s.addons || []).includes(r.addon) && !meetOn(r, s)) continue; } else if (!all && r.runs.length > 1) continue; out.push(meetRule(r, s)); }
  return out.sort((a, b) => (toMin(a.closes) ?? toMin(a.opens) ?? 0) - (toMin(b.closes) ?? toMin(b.opens) ?? 0));
}
const winTxt = r => { const f = toMin(r.opens), t = toMin(r.closes); return f != null && t != null ? `${fmtT(f)}–${fmtT(t)}` : t != null ? `by ${fmtT(t)}` : f != null ? `from ${fmtT(f)}` : ""; };
function addonBoard(day, n) {
  const isT = day === n.date, past = day < n.date; const nowMin = isT ? n.min : past ? 1440 : -1;
  const segs = S.shifts.filter(s => s.day === day && s.driver && !isSort(s.run) && s.run !== "BU").map(s => ({ s, ...segTimes(s, S.runsBy) })).sort((a, b) => (a.st ?? 0) - (b.st ?? 0));
  if (!segs.length) return "";
  let tot = 0, done = 0, missed = 0; const rows = [];
  for (const { s, st, en } of segs) {
    const chips = []; const seen = new Set(); const dn = s.done || {}; const plan = s.plan || {};
    for (const r of rulesForShift(s)) { const key = r.done_key || r.addon; const d = key ? dn[key] : null; const gp = key?.startsWith("tw_") && /game plan/i.test(r.name); const planned = gp && Object.keys(plan).length > 0; const closes = toMin(r.closes), opens = toMin(r.opens);
      const mk = d || !key ? null : addMark(s.id, key); let cls = "due", txt = winTxt(r); if (mk) { [cls, txt] = mk; } else if (d) { cls = "ok"; txt = `✓ ${fmtTime(d)}`; } else if (planned) { cls = "ok"; txt = "✓ game plan in"; } else if (closes != null && nowMin > closes) { cls = "miss"; txt = `✗ not done by ${fmtT(closes)}`; } else if (closes != null && nowMin >= closes - 15 && nowMin >= (opens ?? -1)) { cls = "over"; txt = `due in ${closes - nowMin} min · ${txt}`; } else if (opens != null && nowMin >= opens) { cls = "now"; txt = `now · ${txt}`; }
      if (key) { seen.add(r.addon); tot++; if (cls === "ok") done++; if (cls === "miss") missed++; }
      chips.push(`<span class="chip ${cls}" title="${esc(r.name)}">${esc(r.name)} <span style="font-weight:500">${esc(txt)}</span></span>`); }
    for (const id of s.addons || []) { if (seen.has(id)) continue; const a = S.addons.find(x => x.id === id); if (!a) continue; const d = dn[id]; const p = plan[id]; const ended = en != null && nowMin > en;
      const mk = d ? null : addMark(s.id, id); const cls = mk ? mk[0] : d ? "ok" : ended ? "miss" : "due"; const txt = mk ? mk[1] : d ? `✓ ${fmtTime(d)}` : ended ? "✗ not marked" : p ? `~${fmtT(toMin(p))}` : isT ? "not yet" : ""; tot++; if (d) done++; else if (cls === "miss") missed++;
      chips.push(`<span class="chip ${cls}" title="${esc(a.name)}">${esc(a.short || a.name)}${txt ? ` <span style="font-weight:500">${esc(txt)}</span>` : ""}</span>`); }
    if (!chips.length) continue;
    const nd = chips.filter(c => c.includes('class="chip ok"')).length;
    rows.push(`<div class="item clk ${chips.some(c => c.includes('chip miss')) ? "crit" : nd === chips.length ? "done" : ""}" data-task="${s.id}" title="Tap for the plan, history and the driver's day"><div class="row" style="justify-content:space-between"><b>${esc(s.run)} · ${esc(nm(s.driver))}</b><span class="meta">${st != null ? `${fmtT(st)}–${fmtT(en)}` : ""}${s.van ? ` · ${esc(s.van)}` : ""} · ${nd}/${chips.length} done</span></div><div class="row" style="gap:3px">${chips.join("")}</div></div>`);
  }
  if (!rows.length) return "";
  return `<div class="card ${missed ? "hot" : ""}"><h2>Add-ons &amp; timings · ${isT ? "today" : label(day)}<span>${done}/${tot} done${missed ? ` · <b class="c-crit">${missed} missed</b>` : ""} · green ✓ as each driver taps Done · tap a run for the detail</span></h2><div class="list">${rows.join("")}</div></div>`;
}

/* ---- Important points ---- */
function teamAndLabour(scores, team, wk) {
  const W = S.C.weights; const R = S.C.rules; const t = today();
  const dueList = [];
  for (const v of S.vans.filter(v => v.active && v.plate !== "OTHER")) for (const [k, l] of [["wof_due", "WOF"], ["rego_due", "Rego"]]) if (v[k]) { const dd = Math.round((new Date(v[k]) - new Date(t)) / 86400000); if (dd <= R.dueSoonDays) dueList.push({ dd, txt: `${v.plate} ${l} ${dd < 0 ? "overdue" : "due"} · ${label(v[k])}`, plate: v.plate }); }
  for (const p of S.drivers) for (const [k, l] of [["licence_expiry", "licence"], ["dg_expiry", "DG"]]) if (p[k]) { const dd = Math.round((new Date(p[k]) - new Date(t)) / 86400000); if (dd <= R.dueSoonDays) dueList.push({ dd, txt: `${fnm(p.id)} ${l} ${dd < 0 ? "expired" : "due"} · ${label(p[k])}`, person: p.id }); }
  dueList.sort((a, b) => a.dd - b.dd);
  const L = labourWeek(wk); const cls = v => v == null ? "grey" : v <= 0 ? "ok" : v <= 10 ? "warn" : "crit";
  const m = k => `data-metric="${k}" data-mwk="${teamRange(wk).from}" ${teamRange(wk).r === "week" ? "" : `data-mto="${teamRange(wk).to}"`} title="Tap for every driver and the week-by-week history"`; const lb = `data-labour="${wk}" title="Tap for hours by driver and by day"`;
  const rg = teamRange(wk); const T = rg.r === "week" ? { n: scores.filter(s => s.closed || s.effDays.length).length, team } : teamStats(rg);
  return `<div class="card"><h2>Team scores<span>${rg.txt} · ${T.n} drivers · tap a score</span></h2>${rangeBar()}
      <div class="tiles">${tile("Overall", T.team("overall"), `admin ${W.admin} · eff ${W.eff} · acc ${W.acc} · safety ${W.safe}`, null, m("overall"))}${tile("Admin", T.team("admin"), "posts on time", null, m("admin"))}${tile("Efficiency", T.team("eff"), "expected ÷ actual", null, m("eff"))}${tile("Accuracy", T.team("acc"), "NZ Post feed − mistakes", null, m("acc"))}${tile("Safety", T.team("safe"), "100% unless entered", null, m("safe"))}</div>
      <div class="meta mono" style="margin-top:4px">DUE WITHIN ${R.dueSoonDays} DAYS</div>${dueList.length ? `<div class="row" style="gap:4px">${dueList.map(d => `<button class="chip ${d.dd < 0 ? "miss" : "late"}" ${d.plate ? `data-vanof="${esc(d.plate)}"` : `data-personof="${esc(d.person)}"`}>${esc(d.txt)}</button>`).join("")}</div>` : `<div class="meta c-ok">✓ Vehicles &amp; licences up to date</div>`}
      <h2 style="margin-top:10px">Labour<span>wage rates from profiles (default $${R.hourRate}/h) · Jeremy's hours are unpaid: tracked on their own line, not in the totals or spend · tap for the breakdown</span></h2>
      <div class="tiles"><button class="tile" ${lb}><div class="l">Expected · week</div><div class="v ${L.estH ? "c-warn" : ""}">${L.estH ? "≈" : ""}${L.E.toFixed(1)} h</div><div class="s">${L.estH ? `<span class="c-warn">${L.estH.toFixed(1)} h estimated</span> from past EODs · rest from EOD figures` : "all from EOD figures"}</div></button><button class="tile" ${lb}><div class="l">Actual · week</div><div class="v ${L.Aest ? "c-warn" : ""}">${L.Aest ? "≈" : ""}${L.At.toFixed(1)} h</div><div class="s">${L.A.toFixed(1)} h from SOD → EOD${L.trainAll ? ` · incl. ${L.trainAll.toFixed(1)} h training` : ""}${L.Aest ? ` · <span class="c-warn">≈${L.Aest.toFixed(1)} h estimated</span> (SOD/EOD not in)` : ""} · ${L.done} of ${L.runs} runs in</div></button><button class="tile" ${lb}><div class="l">Spend · week</div><div class="v ${L.Aest ? "c-warn" : ""}">$${Math.round(L.spend).toLocaleString()}</div><div class="s">actual hours × each driver's rate${L.Aest ? " · estimated part at expected" : ""}<br><small class="meta">On band rates: <b>$${Math.round(L.bandSpend).toLocaleString()}</b> (${L.bandSpend >= L.spend ? "+" : "−"}$${Math.abs(Math.round(L.bandSpend - L.spend)).toLocaleString()})${L.bandMissing ? " · no band yet → current rate" : ""}</small></div></button><button class="tile" ${lb}><div class="l">Tracking</div><div class="v c-${cls(L.trk)}">${L.trk == null ? "—" : (L.trk > 0 ? "+" : "") + Math.round(L.trk) + "%"}</div><div class="s">${L.Atk.toFixed(1)} h actual vs ${L.Ec.toFixed(1)} h expected · completed SOD + EOD figures only${L.train ? ` · ${L.train.toFixed(1)} h training not counted` : ""}</div></button></div>
      <div class="tiles"><button class="tile" ${lb}><div class="l">Jeremy · week (tracked, unpaid)</div><div class="v">${L.own.At.toFixed(1)} h</div><div class="s">actual · expected ${L.own.E.toFixed(1)} h · not in the totals above or in spend</div></button></div></div>`;
}
/** One expected figure per driver-day: the run formula on the EOD figures once they're in, otherwise on the average figures for that run and weekday (estimated, shown orange). Actual = SOD to last EOD. */
export const sickLeave = (id, d) => (S.leave || []).find(l => l.driver === id && l.type === "sick" && l.status === "approved" && d >= l.date_from && d <= l.date_to);
// paid hours for a sick day: the hours set on it, otherwise the driver's average worked day over the 4 weeks before (never less than what was rostered that day)
export function sickHours(drv, d, sk) {
  if (sk?.hours != null) return +sk.hours;
  const D = dayShifts(S.shifts.filter(s => s.day === d && s.driver === drv.id), S.runsBy, drv.id)[d]; const rost = D ? D.hours || 0 : 0;
  const hs = []; for (let i = 1; i <= 28; i++) { const x = addDays(d, -i); if (S.C.holidays[x] || sickLeave(drv.id, x)) continue; const r = driverDay(drv, x); const h = r ? (r.act ?? r.actEst ?? r.exp ?? 0) : 0; if (h > 0) hs.push(h); }
  const avg = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 0; return Math.round(Math.max(avg, rost) * 100) / 100;
}
// minutes of finished unpaid breaks a driver took on a day (NZ date). Only breaks from 2:48pm Mon 9 Nov 2026 on are taken off hours; earlier ones stay as they were.
// Everyone's breaks are unpaid, Jeremy's included (from 9 Nov 2026). They come off paid hours here and off efficiency time (score.js ownerBreakHrs).
const UNPAID_FROM = Date.parse("2026-11-09T01:48:00Z");
export function breakMins(id, d) { return (S.breaks || []).filter(b => b.driver === id && b.ended_at && Date.parse(b.started_at) >= UNPAID_FROM && nzNow(new Date(b.started_at)).date === d).reduce((a, b) => a + Math.max(0, (Date.parse(b.ended_at) - Date.parse(b.started_at)) / 60000), 0); }
export function driverDay(drv, d) {
  const R = S.C.rules; const rate = +(drv.rate || R.hourRate); const hol = S.C.holidays[d];
  if (hol) { const hh = Math.min(R.holidayCap ?? 8, hol.hours?.[drv.id] || 0); if (!hh) return null; return { d, drv, hol, holiday: true, exp: hh, est: false, act: hh, actEst: hh, actIsEst: false, actHow: "public holiday · paid", tracked: false, train: 0, spend: hh * rate, runs: 0, done: 0, effRows: [], D: null }; }
  const sk = sickLeave(drv.id, d);
  if (sk) { const D0 = dayShifts(S.shifts.filter(s => s.day === d && s.driver === drv.id), S.runsBy, drv.id)[d] || null; const hh = sk.paid ? sickHours(drv, d, sk) : 0;   // paid sick day = staff cost; unpaid = nothing
    return { d, drv, sick: sk, holiday: false, exp: hh, est: false, act: hh, actEst: hh, actIsEst: false, actHow: sk.paid ? `sick · paid ${hh.toFixed(2)} h${sk.hours != null ? "" : " (average day)"}` : "sick · unpaid", tracked: false, train: 0, spend: hh * rate, rate, runs: 0, done: 0, effRows: [], runSegs: [], eods: [], D: D0 }; }
  const D = dayShifts(S.shifts.filter(s => s.day === d && s.driver === drv.id), S.runsBy, drv.id)[d]; if (!D) return null;
  const runSegs = D.segs.filter(x => !x.sort); const sod = D.segs.map(x => S.sodBy[x.shift.id]).find(Boolean); const eods = runSegs.map(x => S.eodBy[x.shift.id]).filter(Boolean);
  const sortRost = D.segs.filter(x => x.sort).reduce((a, x) => a + x.min, 0);   // sort minutes not already covered by a run (no hour counted twice)
  let exp = 0, est = false, train = 0; const effRows = [];
  runSegs.forEach((x, i) => { const ov = S.ovs.find(o => o.shift_id === x.shift.id); const eod = S.eodBy[x.shift.id]; const c = effCalc(x, eod, ov, S.C, S.runsBy, { sortRost: i === 0 ? sortRost : 0, sodMin: i === 0 && sod ? sodStart(sod, D.start, S.C) : null, brk: ownerBreakHrs(S.breaks, x.shift, !!drv.pay_exclude) });
    if (!c) { exp += x.min / 60; est = true; return; }                       // no formula for this run yet → rostered length, flagged as an estimate
    effRows.push({ d, drv, x, eod, ov, c }); if (c.trainDay) { train += c.taken || 0; return; } exp += c.allowed / 60; if (!eod || c.est) est = true; if (ov?.train_min) train += ov.train_min / 60; });
  // team sort shifts (SUP…) count at the time they took (from the taps, else the roster), so they're paid and neutral in the hours tracking
  if (runSegs.length) for (const x of D.segs.filter(y => y.sort)) { const r = effRows.find(e => e.x.preSort === x); if (r?.c.sortIn != null) continue; exp += (r && !r.c.trainDay && r.c.start != null ? r.c.sortTaken : x.min) / 60; }
  if (!runSegs.length) { exp = D.hours; est = !D.segs.some(x => S.eodBy[x.shift.id]); }     // sort-only day
  const xtra = extraMins(S.extra, drv.id, d); if (xtra) exp += xtra / 60;   // "+ Hours" logged (approved): expected, and inside SOD → EOD
  const complete = sod && (runSegs.length ? eods.length === runSegs.length : D.segs.some(x => S.eodBy[x.shift.id]));
  const anyE = runSegs.length ? eods : D.segs.map(x => S.eodBy[x.shift.id]).filter(Boolean); const lastE = anyE[anyE.length - 1];
  const endOf = e => e.finish_time ? toMin(e.finish_time) : nzNow(new Date(e.sent_at)).min;
  const brk = breakMins(drv.id, d) / 60;   // unpaid breaks that day, taken off the SOD → EOD hours
  let act = null, badTimes = false; if (complete) { const sm = sodStart(sod, D.start, S.C), em = endOf(lastE); if (em > sm) act = Math.max(0, (em - sm) / 60 - brk); else badTimes = true; } // SOD posted after the finish (e.g. both posts sent together at the end) → not a measured day
  // estimated actual when the SOD and/or EODs are not in: what is in + the roster for the rest; nothing at all → the expected hours
  let actEst = act, actHow = "SOD → EOD"; if (act == null) { const n = nzNow(); const over = d < n.date || (d === n.date && n.min >= D.end);
    if (badTimes) { actEst = exp + train; actHow = "SOD time is after the EOD finish · = expected · fix the times"; }
    else if (!sod && !anyE.length) { actEst = exp + train; actHow = over ? "no SOD or EOD · = expected" + (train ? " + training" : "") : "to come · = expected" + (train ? " + training" : ""); }
    else { const sm = sod ? sodStart(sod, D.start, S.C) : D.start; const em = (complete || (anyE.length && (!runSegs.length || eods.length === runSegs.length))) ? endOf(lastE) : (lastE && over ? Math.max(endOf(lastE), D.end) : D.end); actEst = Math.max(0, (em - sm) / 60 - brk); actHow = `${sod ? "SOD" : "roster start"} → ${anyE.length === (runSegs.length || 1) ? "EOD" : "roster end"}`; } }
  if (sod && sodStart(sod, D.start, S.C) !== nzNow(new Date(sod.sent_at)).min) actHow += ` · early start not signed off, counted from ${fmtT(D.start)}`;
  if (brk && (act != null || /→/.test(actHow))) actHow += ` − ${Math.round(brk * 60)} min unpaid break`;
  // tracked = SOD in, every EOD in, and the expected worked out from the EOD figures (nothing averaged or guessed)
  const tracked = act != null && !est;
  return { d, drv, hol, D, exp, est, act, actEst, actIsEst: act == null, actHow, brk: Math.round(brk * 60), train, spend: (actEst ?? exp) * rate, rate, runs: runSegs.length, done: eods.length, sod, eods, runSegs, effRows, tracked, trk: tracked && exp ? ((act - train) - exp) / exp * 100 : null };
}
export function labourWeek(wk) { return labourRange(wk, addDays(wk, 6)); }
export function labourRange(from, to) {
  const bandBy = {}; const bandRateFor = (drv, d) => { const k = drv.id + "|" + fortnight(d).from; if (!(k in bandBy)) bandBy[k] = payBand(drv, d, scoreData(), S.C).rate; return bandBy[k]; };  // band rate for that pay fortnight; null → no band yet
  let bandSpend = 0, bandMissing = 0;
  let E = 0, Ec = 0, Atk = 0, A = 0, Aest = 0, P = 0, spend = 0, runs = 0, done = 0, train = 0, estH = 0, trainAll = 0, oE = 0, oA = 0; const rows = [];  // oE / oA = Jeremy's hours: tracked separately, never added to the totals or spend
  for (let d = from; d <= to; d = addDays(d, 1)) { let e = 0, ec = 0, ta = 0, a = null, aest = 0, sp = 0, tr = 0, est = 0, n = 0; const hol = S.C.holidays[d];
    for (const drv of S.drivers) { const r = driverDay(drv, d); if (!r) continue; if (drv.pay_exclude) { oE += r.exp; oA += r.act ?? r.actEst ?? r.exp; continue; } n++;
      e += r.exp; if (r.est) est += r.exp; runs += r.runs; done += r.done; sp += r.spend; { const br = bandRateFor(drv, d); bandSpend += r.rate ? r.spend / r.rate * (br ?? r.rate) : r.spend; if (br == null && r.spend) bandMissing++; } trainAll += r.train; if (r.act != null) a = (a || 0) + r.act; if (r.tracked) { ta += r.act; ec += r.exp; tr += r.train; } if (r.act == null) aest += r.actEst || 0; }
    E += e; Ec += ec; Atk += ta; A += a || 0; Aest += aest; spend += sp; train += tr; estH += est; P += (a || 0) + aest;
    rows.push({ d, e, ec, ta, a, aest, at: (a || 0) + aest, est, sp, tr, hol, n }); }
  const trk = Ec && Atk ? ((Atk - train) - Ec) / Ec * 100 : null;  // only driver-days with SOD + all EODs in and expected from those EOD figures
  // A = actual from SOD→EOD only · Aest = the estimated part (days/drivers without both posts) · At = the two together (= P)
  return { bandSpend, bandMissing, E, Ec, Atk, A, Aest, At: A + Aest, P, spend, trk, rows, runs, done, train, estH, own: { E: oE, At: oA }, ownTracked: true, trainAll };
}
function hoursByDay(wk) {
  const L = labourWeek(wk); const max = Math.max(1, ...L.rows.map(r => Math.max(r.a || 0, r.e))); const W = 420, H = 150, bw = 44;
  const bars = L.rows.map((r, i) => { const x = 20 + i * 56; const y = v => H - 20 - (v / max) * (H - 40); const over = r.ec && r.a != null ? ((r.a - r.tr) - r.ec) / r.ec * 100 : null; const fill = r.hol ? "var(--van, #9085e9)" : over == null ? "var(--accent)" : over <= 0 ? "var(--ok)" : over <= 10 ? "var(--warn)" : "var(--crit)";
    return `<rect x="${x}" y="${y(r.e)}" width="${bw / 2}" height="${H - 20 - y(r.e)}" fill="${r.est ? "var(--warn)" : "var(--line)"}" opacity="${r.est ? .55 : 1}"/>${r.a != null ? `<rect x="${x + bw / 2}" y="${y(r.a)}" width="${bw / 2}" height="${H - 20 - y(r.a)}" fill="${fill}"/>` : ""}<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--ink3)">${DAYS[i]}</text>${over != null ? `<text x="${x + bw / 2}" y="${Math.min(y(r.a), y(r.e)) - 4}" text-anchor="middle" font-size="10" fill="var(--ink2)">${over > 0 ? "+" : ""}${Math.round(over)}%</text>` : ""}`; }).join("");
  const eCell = r => r.e ? `<span class="${r.est ? "c-warn" : ""}" title="${r.est ? `${r.est.toFixed(1)} h of this is estimated from past EODs (orange)` : "from the EOD figures"}">${r.est ? "≈" : ""}${r.e.toFixed(1)}</span>` : "—";
  return `<div class="card"><h2>Hours tracking by day<span>expected vs actual</span></h2><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${bars}</svg>
    <div class="scroll"><table class="dt"><tr><th>Day</th><th>Expected</th><th>Actual</th><th>Training</th><th>Tracking</th><th>Spend</th></tr>${L.rows.map(r => { const v = r.ec && r.ta ? ((r.ta - r.tr) - r.ec) / r.ec * 100 : null; return `<tr class="clk" data-hoursday="${r.d}" title="Tap for everyone's hours that day"><td>${label(r.d).slice(0, 6)}${r.hol ? ` <span class="meta">${esc(r.hol.name)} · paid</span>` : ""}</td><td class="num">${eCell(r)}</td><td class="num">${r.a != null && !r.aest ? r.a.toFixed(1) : r.at ? `<span class="c-warn" title="${r.a ? r.a.toFixed(1) + " h from SOD → EOD, rest estimated" : r.d > today() ? "to come · expected" : "SOD/EOD not in · estimated"}">≈${r.at.toFixed(1)}</span>` : "—"}</td><td class="num">${r.tr ? r.tr.toFixed(1) : ""}</td><td class="c-${v == null ? "grey" : v <= 0 ? "ok" : v <= 10 ? "warn" : "crit"}">${v == null ? "—" : (v > 0 ? "+" : "") + Math.round(v) + "%"}</td><td class="num">$${Math.round(r.sp).toLocaleString()}</td></tr>`; }).join("")}<tr class="clk" data-labour="${wk}" title="Tap for the week by driver"><td><b>Week</b></td><td class="num"><b class="${L.estH ? "c-warn" : ""}">${L.estH ? "≈" : ""}${L.E.toFixed(1)}</b></td><td class="num"><b class="${L.Aest ? "c-warn" : ""}">${L.Aest ? "≈" : ""}${L.At.toFixed(1)}</b></td><td class="num">${L.train ? L.train.toFixed(1) : ""}</td><td class="c-${L.trk == null ? "grey" : L.trk <= 0 ? "ok" : L.trk <= 10 ? "warn" : "crit"}">${L.trk == null ? "—" : (L.trk > 0 ? "+" : "") + Math.round(L.trk) + "%"}</td><td class="num"><b>$${Math.round(L.spend).toLocaleString()}</b></td></tr></table></div><p class="hint">Expected is evidence-based: once a run's EOD is in it's the formula on those figures; until then it's the formula on the average figures that run has posted on that weekday, so it sharpens as more EODs come in. Actual is SOD → last EOD, less unpaid breaks; where the SOD or an EOD is missing it's <span class="c-warn">≈ estimated</span> (what is in + the roster for the rest, or the expected hours when nothing is in) until the posts arrive.</p></div>`;
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
  const rows = [[reviews, "Reviews to do", "posts to confirm or excuse", "scorecard", reviews ? "warn" : ""], [overdue, "Overdue right now", "SOD/EOD not in yet today", "fix", overdue ? "crit" : ""], [pending, "Missing EOD figures", "runs that can't be scored yet · tap to fix or ask", "pending", pending ? "warn" : ""], [aw, "Roster changes to approve", "made by Alejandro", "runboard", aw ? "warn" : ""], [unc, "Roster changes not confirmed", "drivers haven't tapped Got it", "runboard", unc ? "crit" : ""], [leave, "Leave requests waiting", "approve or decline", "leave", leave ? "warn" : ""], [mist, "Mistakes logged this week", "Driver Mistakes Record", "scorecard", mist ? "crit" : ""], [lic.length, "Licences & DG due", lic.map(p => first(p.name)).slice(0, 3).join(", "), "people", lic.length ? "warn" : ""], [vans.length, "Vehicles due", "WOF, rego, RUCs", "fleet", vans.length ? "warn" : ""], [alerts, "Open alerts", "resolve or let them clear", "alerts", alerts ? "warn" : ""]].filter(r => r[0]);
  return `<div class="card" id="todo"><h2>To do<span>${rows.length ? `${rows.length} item${rows.length > 1 ? "s" : ""}` : "all done"}</span></h2>${rows.length ? `<div class="list">${rows.map(([c, l, s, tab, cls]) => `<button class="item ${cls}" data-go="${tab}" style="border:0;color:inherit;text-align:left;cursor:pointer"><div class="row" style="justify-content:space-between"><b>${esc(l)}</b><span class="pill ${cls || "grey"}">${c}</span></div><div class="meta">${esc(s)}</div></button>`).join("")}</div>` : `<p class="empty">✓ All complete<br><span class="meta">No reviews, overdue posts, approvals or mistakes waiting.</span></p>`}</div>`;
}

/* ---- Roster changes not confirmed ---- */
function notConfirmed(n) {
  const t = n.date; const ackOf = {}; for (const a of S.acks) (ackOf[a.item_id] ??= {})[a.driver] = a; const by = {};
  for (const i of S.items.filter(i => i.roster_changes.status === "sent" && i.day >= t)) for (const d of i.affects) { const a = ackOf[i.id]?.[d]; const st = toMin(i.after?.start_at); const past = i.day === t && st != null && n.min >= st; if (!a?.confirmed_at && !a?.dismissed_at && !past) (by[d] ??= []).push(i); }
  const L = Object.entries(by).sort((a, b) => (a[1][0].roster_changes.sent_at || "").localeCompare(b[1][0].roster_changes.sent_at || ""));
  return `<div class="card ${L.length ? "hot" : ""}"><h2>Roster changes — not confirmed<span>${L.length ? `${L.length} driver${L.length > 1 ? "s" : ""} waiting, oldest first` : "nothing waiting"}</span></h2>${L.length ? `<div class="list">${L.map(([d, items]) => `<div class="item crit clk" data-changes="${d}" title="Tap for every change sent to ${esc(fnm(d))}"><div class="row" style="justify-content:space-between"><b>${esc(nm(d))}</b><span class="meta">sent ${fmtTs(items[0].roster_changes.sent_at)} · ${ago(items[0].roster_changes.sent_at)}</span><span class="row" style="flex:0;gap:4px;flex-wrap:wrap;justify-content:flex-end">${actBtns("chg", `data-drv="${d}" data-items="${items.map(i => i.id).join(",")}"`)}</span></div><ul style="margin:4px 0;padding-left:18px;color:var(--crit)">${items.map(i => `<li>${esc(i.summary)}</li>`).join("")}</ul></div>`).join("")}</div>` : ""}<p class="meta">Drivers confirm with one tap in the app. <button class="linkbtn" data-go="runboard">History of all roster changes →</button></p></div>`;
}

/* ---- Drivers grid ---- */
function driversGrid(scores, wk) {
  const list = scores.filter(s => s.closed || s.effDays.length || s.nMist).sort((a, b) => (a.overall ?? 101) - (b.overall ?? 101));
  return `<div class="card"><h2>Drivers<span>this week · tap a name for history and results · <span class="c-ok">light green</span> = signed in to the app · <b class="c-ok">dark green</b> = GPS in the last 20 min</span></h2>${list.length ? `<div class="dgrid">${list.map(s => { const d = S.peopleBy[s.driver]; const hrs = Object.values(s.days).reduce((a, x) => a + x.hours, 0);
    const lg = S.login?.[s.driver], gps = S.locs.find(l => l.driver === s.driver && Date.now() - new Date(l.at) <= 20 * 60e3); const st = gps ? "gps" : lg?.sessions > 0 ? "on" : "";
    return `<button class="dcard ${st}" data-driver="${s.driver}" style="border:0;color:inherit;text-align:left" title="${gps ? `In the app · GPS ${ago(gps.at)}` : st ? "Signed in to the app · no GPS in the last 20 min" : "Not signed in to the app"}"><div class="ring" style="--p:${Math.round(s.overall || 0)};--c:var(--${col(s.overall) === "grey" ? "grey" : col(s.overall)})"><span>${pct(s.overall)}</span></div><div style="flex:1"><b>${esc(d.name)}</b>${(pb => pb.b != null ? ` ${pill(`Band ${pb.b || "<1"}${pb.rate != null ? ` · ${money(pb.rate)}/h` : ""} · fortnight`, "accent")}<div class="meta">${pb.rate != null ? `Fortnight avg ${Math.round(pb.eff)}% → ${money(pb.rate)}/h${pb.note ? ` + ${esc(pb.note)}` : ""} ·` : `Band ${pb.b || "<1"} ·`} on ${money(pb.now)}/h now${(pb.diff == null ? "" : pb.diff > 0 ? ` <span class="c-ok">↑</span>` : pb.diff < 0 ? ` <span class="c-crit">↓</span>` : "")}</div>` : `<div class="meta">On ${money(pb.now)}/h now · no band yet this fortnight</div>`)(payBand(S.peopleBy[s.driver] || { id: s.driver }, wk, scoreData(), S.C))}<div class="meta">${hrs.toFixed(1)} h rostered · ${s.onTime}/${s.closed} on time</div><div class="mini">${[["Adm", s.admin], ["Eff", s.eff], ["Acc", s.acc], ["Saf", s.safe]].map(([l, v]) => `<span>${l}</span><div class="bar"><i class="bg-${col(v)}" style="width:${Math.min(100, v || 0)}%"></i></div><span class="c-${col(v)}">${pct(v)}</span>`).join("")}</div><div class="meta">${[s.missing ? `<span class="c-crit">${s.missing} missing</span>` : "", s.late ? `<span class="c-warn">${s.late} late</span>` : "", s.nMist ? `<span class="c-crit">${s.nMist} mistake${s.nMist > 1 ? "s" : ""}</span>` : ""].filter(Boolean).join(" · ") || "no issues"}</div></div></button>`; }).join("")}</div>` : `<p class="empty">No driver data for this week yet. Scores appear once SODs and EODs come in.</p>`}</div>`;
}
// amber note on a run's EOD: its start wasn't recorded (not the first shift of the day, no ▶ Start tap / EOD time), or the sorting minutes
// typed on the EOD are more than 15 min off what the taps say
function stageFlag(e, D) {
  if (!e.row || !e.shift || !D) return ""; const i = D.segs.findIndex(x => x.shift.id === e.shift.id); const f = [];
  if (i > 0 && !D.segs[i].sort && !e.shift.sor_at) f.push(`start of ${esc(e.shift.run)} not recorded`);
  const tap = e.row.extra?.sort_tap, typed = e.row.sort_min; if (tap != null && typed != null && Math.abs(typed - tap) > 15) f.push(`sorting ${typed} min typed vs ${tap} min from taps`);
  return f.length ? `<div class="meta c-warn" style="font-size:11px">⚠ ${f.join(" · ")}</div>` : "";
}
function postsBoard(selScores, days, t) {
  if (days.length === 1) { const d = days[0]; const rows = selScores.filter(s => s.items.length).map(s => { const D = s.days[d]; const sod = s.items.find(i => i.kind === "SOD"); const eods = s.items.filter(i => i.kind === "EOD"); return `<tr><td class="clk" data-dayof="${s.driver}|${d}" title="Tap for ${esc(fnm(s.driver))}'s day"><b>${esc(nm(s.driver))}</b><div class="meta">${D ? `${fmtT(D.start)}–${fmtT(D.end)} · ${D.hours}h · ${D.segs.map(x => x.shift.run + (x.shift.trainee ? " (training " + fnm(x.shift.trainee) + ")" : "")).join(" · ")}` : ""}</div></td><td>${sod ? chip(sod) : ""}</td><td>${eods.map(e => `<div style="margin:2px 0"><span class="meta mono">${esc(e.code || "day")}</span> ${chip(e)}${stageFlag(e, D)}</div>`).join("")}</td></tr>`; });
    return rows.length ? `<div class="scroll"><table class="dt"><tr><th>Driver</th><th>SOD</th><th>EOD (one per run)</th></tr>${rows.join("")}</table></div><p class="hint"><span class="c-ok">●</span> on time · <span class="c-ok" style="opacity:.6">●</span> waiting (past rostered time, inside the allowance) · <span class="c-crit">●</span> late / overdue / missing · ● due · <span class="chip exc" style="padding:0 5px;cursor:default">grey</span> = excused · outlined = set by hand</p>` : `<p class="empty">Nobody tracked is rostered on ${label(d)}.</p>`; }
  return `<div class="scroll"><table class="dt"><tr><th>Driver</th>${days.map(d => `<th class="${d === t ? "c-accent" : ""}">${label(d).slice(0, 6)}</th>`).join("")}<th>On time</th><th>Late</th><th>Missing</th><th>Rate</th><th>Admin</th></tr>${selScores.filter(s => s.items.length).map(s => `<tr><td class="clk" data-driver="${s.driver}" title="Tap for ${esc(fnm(s.driver))}'s sheet"><b>${esc(nm(s.driver))}</b></td>${days.map(d => `<td style="white-space:nowrap">${s.items.filter(i => i.day === d).map(it => `<button class="chip ${it.st}" data-item="${esc(it.key)}" title="${esc(it.label)} · ${itemNote(it)}" style="width:14px;height:14px;padding:0;border-radius:3px;margin:1px"></button>`).join("")}</td>`).join("")}<td class="num">${s.onTime}</td><td class="num">${s.late}</td><td class="num">${s.missing}</td><td class="num">${s.closed ? Math.round(s.onTime / s.closed * 100) + "%" : "—"}</td><td class="c-${col(s.admin)}">${pct(s.admin)}</td></tr>`).join("")}</table></div><p class="hint">One square per required post · tap a square to review it</p>`;
}
/* ---- Breaks · who's on a break right now, and every break on the selected days (staff only) ---- */
// Live: just who is on a break right now
function onBreakCard() {
  const open = (S.breaks || []).filter(b => !b.ended_at).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const runOf = b => S.shifts.find(s => s.id === b.shift_id)?.run || ""; const mins = b => Math.max(0, Math.round((Date.now() - new Date(b.started_at)) / 60000));
  return `<div class="card ${open.length ? "warnc" : ""}" id="onbreak"><h2><i class="ico">☕</i>On break<span>${open.length ? `${open.length} now` : "nobody"}</span></h2>${open.length ? `<div class="list">${open.map(b => `<div class="item warn"><div class="row" style="justify-content:space-between"><b>${esc(nm(b.driver))}</b><span class="meta">${esc(runOf(b))} · since ${fmtTime(b.started_at)} · ${mins(b)} min</span></div></div>`).join("")}</div>` : `<p class="empty">Nobody on a break.</p>`}</div>`;
}
function breaksCard(days, n) {
  const B = S.breaks || []; const dayOf = b => nzNow(new Date(b.started_at)).date; const mins = b => Math.max(0, Math.round(((b.ended_at ? new Date(b.ended_at) : new Date()) - new Date(b.started_at)) / 60000));
  const open = B.filter(b => !b.ended_at).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const list = B.filter(b => days.includes(dayOf(b))).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const runOf = b => S.shifts.find(s => s.id === b.shift_id)?.run || "";
  const now = open.length ? `<div class="list">${open.map(b => `<div class="item warn"><div class="row" style="justify-content:space-between"><b>☕ ${esc(nm(b.driver))}</b><span class="meta">${esc(runOf(b))} · since ${fmtTime(b.started_at)} · ${mins(b)} min</span></div></div>`).join("")}</div>` : `<p class="empty">Nobody on an unpaid break right now</p>`;
  const tbl = list.length ? `<div class="scroll"><table class="dt"><tr><th>Driver</th><th>Date</th><th>Run</th><th>Start</th><th>End</th><th>Length</th></tr>${list.map(b => `<tr><td><b>${esc(nm(b.driver))}</b></td><td>${label(dayOf(b))}</td><td>${esc(runOf(b))}</td><td class="mono">${fmtTime(b.started_at)}</td><td class="mono">${b.ended_at ? fmtTime(b.ended_at) : `<span class="c-warn">on break</span>`}</td><td class="mono">${mins(b)} min</td></tr>`).join("")}</table></div>` : `<p class="empty">No unpaid breaks on ${days.length === 1 ? label(days[0]) : "these days"}</p>`;
  return `<div class="card ${open.length ? "warnc" : ""}"><h2>Unpaid breaks<span>${open.length ? `${open.length} on an unpaid break now` : "nobody on a break"}</span></h2>${now}<h3 style="margin:10px 0 4px;font-size:14px">${days.length === 1 ? label(days[0]) : `${label(days[0])} – ${label(days[days.length - 1])}`}</h3>${tbl}</div>`;
}

function feed(t) {
  const ev = [];
  const nzDay = iso => iso ? nzNow(new Date(iso)).date : null;
  for (const s of S.sods) { const sh = S.shifts.find(x => x.id === s.shift_id); if (sh?.day === t) ev.push({ at: s.sent_at, txt: `${nm(s.driver)} · SOD${s.van ? ` · ${s.van}` : ""}${s.note ? ` · ${s.note}` : ""}`, cls: "ok", go: { k: "item", key: itemKeyFor(sh, "SOD") || "" } }); }
  for (const e of S.eods) { const sh = S.shifts.find(x => x.id === e.shift_id); if (sh?.day === t) ev.push({ at: e.sent_at, txt: `${nm(e.driver)} · EOD ${sh.run}${e.parcels != null ? ` · ${e.parcels} parcels` : ""}${e.stops != null ? ` · ${e.stops} stops` : ""}${e.note ? ` · ${e.note}` : ""}`, cls: "accent", go: { k: "item", key: itemKeyFor(sh, "EOD") || "" } }); }
  for (const b of S.breaks || []) { if (nzDay(b.started_at) === t) ev.push({ at: b.started_at, txt: `${nm(b.driver)} · started an unpaid break`, cls: "", go: null }); if (nzDay(b.ended_at) === t) ev.push({ at: b.ended_at, txt: `${nm(b.driver)} · ended unpaid break (${Math.round((new Date(b.ended_at) - new Date(b.started_at)) / 60000)} min)`, cls: "", go: null }); }
  for (const a of S.acks) if (nzDay(a.confirmed_at) === t) ev.push({ at: a.confirmed_at, txt: `${nm(a.driver)} confirmed a roster change${a.confirmed_by ? ` (by ${fnm(a.confirmed_by)})` : ""}`, cls: "ok", go: { k: "changes", d: a.driver } });
  for (const r of S.recips) if (nzDay(r.read_at) === t) ev.push({ at: r.confirmed_at || r.read_at, txt: `${nm(r.person)} ${r.confirmed_at ? "confirmed" : "read"} a message`, cls: "", go: { k: "msg", id: r.message_id } });
  for (const r of S.sodReqs || []) if (nzDay(r.created_at) === t) ev.push({ at: r.created_at, txt: `${nm(r.driver)} · ${r.kind === "early" ? "early" : "late"} start ${fmtT(toMin(r.started))} to sign off${r.status !== "pending" ? ` · ${r.status}` : ""}`, cls: r.status === "pending" ? "warn" : "", go: null });
  for (const l of S.leave) if (nzDay(l.created_at) === t) ev.push({ at: l.created_at, txt: `${nm(l.driver)} asked for leave · ${label(l.date_from)}`, cls: "warn", go: { k: "leave", id: l.id } });
  for (const a of S.alerts) if (nzDay(a.created_at) === t) ev.push({ at: a.created_at, txt: `⚠ ${a.title}`, cls: a.resolved_at ? "" : "crit", go: { k: "alert", id: a.id } });
  for (const w of S.washes || []) if (nzDay(w.at) === t) ev.push({ at: w.at, txt: `${nm(w.driver)} · washed ${w.van}`, cls: "ok", go: null });
  for (const c of S.vchk) if (nzDay(c.at) === t) ev.push({ at: c.at, txt: `${nm(c.driver)} · vehicle check ${c.van}`, cls: "ok", go: { k: "vchk", id: c.id } });
  ev.sort((a, b) => b.at.localeCompare(a.at));
  return ev.length ? `<div class="list" style="max-height:420px;overflow:auto">${ev.slice(0, 60).map(e => `<div class="item clk ${e.cls}" style="padding:6px 10px" ${e.go && (e.go.key !== "") ? `data-feed="${esc(JSON.stringify(e.go))}"` : ""} title="Tap to open"><span class="m">${fmtTime(e.at)}</span> ${esc(e.txt)}</div>`).join("")}</div><p class="hint">Tap a line to open the post, alert or check behind it.</p>` : `<p class="empty">Nothing yet today. SODs, EODs, confirmations and alerts show here as they happen.</p>`;
}

/* ---- Start-time sign-off: SODs posted more than 20 min before or after the rostered start. Approving moves that driver's
   run times for the day by the same amount (start and end); declining leaves the roster as it was. Jeremy (owner) and admins decide,
   and can edit the time started first (that time is then used for hours, and the run times move to match). ---- */
const canSign = () => S.me.isOwner || S.me.role === "admin";
const t24 = t => String(t || "").slice(0, 5);
const minsOff = m => { const a = Math.abs(m); return a >= 60 ? `${Math.floor(a / 60)} h${a % 60 ? ` ${a % 60} min` : ""}` : `${a} min`; };
function sodReqCard() {
  const all = S.sodReqs || []; const pend = all.filter(r => r.status === "pending"); const recent = all.filter(r => r.status !== "pending").slice(0, 8);
  const what = r => `${r.kind === "early" ? "Started early" : "Started late"} · ${r.sod_at ? `SOD ${fmtT(toMin(r.sod_at))}, start set to ${fmtT(toMin(r.started))}` : `SOD ${fmtT(toMin(r.started))}`}, rostered ${fmtT(toMin(r.rostered))} (${minsOff(r.delta_min)} ${r.kind === "early" ? "early" : "late"})`;
  const moves = r => (r.moves || []).map(m => { const sh = S.shifts.find(s => s.id === m.shift_id); return sh ? `${esc(sh.run)} → ${fmtT(toMin(m.start_at))}${m.end_at ? `–${fmtT(toMin(m.end_at))}` : ""}` : ""; }).filter(Boolean).join(" · ");
  const row = r => `<div class="item ${r.status === "pending" ? "warn" : r.status === "approved" ? "done" : ""}"><div class="row" style="justify-content:space-between"><b>${esc(nm(r.driver))} · ${label(r.day)}</b><span class="meta">${ago(r.created_at)}</span></div>
    <div>${what(r)}</div>${r.note ? `<div class="meta">“${esc(r.note)}”</div>` : `<div class="meta">No note</div>`}
    ${r.status === "pending" ? `<div class="meta">If approved, run times become: ${moves(r) || "—"}${r.kind === "early" ? ` · until then hours count from ${fmtT(toMin(r.rostered))}` : ""}</div>
      ${canSign() ? `<div class="row" style="margin-top:6px"><label class="meta" style="display:flex;align-items:center;gap:4px">Started <input class="in" type="time" data-sstart="${r.id}" value="${t24(r.started)}" style="width:110px"></label><input class="in" data-sreply="${r.id}" placeholder="Reply to ${esc(first(nm(r.driver)))} (optional)" style="flex:2 1 160px"><button class="btn sm" data-sreq="${r.id}" data-ok="1">✓ Approve</button><button class="btn ghost sm" data-sreq="${r.id}" data-ok="0">Decline</button></div>` : `<div class="meta">Waiting for Jeremy or admin</div>`}`
      : `<div class="meta ${r.status === "approved" ? "c-ok" : "c-crit"}">${r.status === "approved" ? "✓ Approved · run times moved" : "✗ Declined · roster unchanged"}${r.decided_by ? ` by ${esc(fnm(r.decided_by))}` : ""}${r.reply ? ` · ${esc(r.reply)}` : ""}</div>
      ${r.status === "approved" && canSign() ? `<div class="row" style="margin-top:6px"><label class="meta" style="display:flex;align-items:center;gap:4px">Edit start <input class="in" type="time" data-sstart="${r.id}" value="${t24(r.started)}" style="width:110px"></label><button class="btn ghost sm" data-sreq="${r.id}" data-ok="1">Save start</button></div>` : ""}`}</div>`;
  return `<div class="card ${pend.length ? "hot" : ""}" id="sodreq" ${pend.length ? "" : `data-empty="1"`}><h2><i class="ico">⏱</i>Start times to sign off<span>${pend.length ? `${pend.length} waiting` : "nothing waiting"}</span></h2>
    ${pend.length ? `<div class="list">${pend.map(row).join("")}</div>` : `<p class="empty">✓ Nothing to sign off.</p>`}${recent.length ? `<details><summary>Recent decisions</summary><div class="list" style="margin-top:8px">${recent.map(row).join("")}</div></details>` : ""}</div>`;
}
function xtCard() {
  const all = (S.extra || []); const pend = all.filter(r => r.status === "pending"); const recent = all.filter(r => r.status !== "pending").slice(0, 12);
  const row = r => `<div class="item ${r.status === "pending" ? "warn" : r.status === "declined" ? "" : "done"}"><div class="row" style="justify-content:space-between"><b>${esc(nm(r.driver))} · ${label(r.day)} · ${esc(XT_KINDS[r.kind]?.name || r.kind)} · ${r.minutes} min</b><span class="meta">${ago(r.created_at)}</span></div>
    ${r.note ? `<div class="meta">“${esc(r.note)}”</div>` : ""}
    ${r.status === "pending" ? (S.me.isOwner ? `<div class="row" style="margin-top:6px"><input class="in" data-xreply="${r.id}" placeholder="Reply to ${esc(first(nm(r.driver)))} (optional)" style="flex:2 1 160px"><button class="btn sm" data-xreq="${r.id}" data-ok="1">✓ Approve</button><button class="btn ghost sm" data-xreq="${r.id}" data-ok="0">Decline</button></div>` : `<div class="meta">Waiting for Jeremy</div>`)
      : `<div class="meta ${r.status === "approved" ? "c-ok" : "c-crit"}">${r.status === "approved" ? (r.decided_by ? `✓ Approved by ${esc(fnm(r.decided_by))}` : "✓ Added") : `✗ Declined${r.decided_by ? ` by ${esc(fnm(r.decided_by))}` : ""}`}${r.reply ? ` · ${esc(r.reply)}` : ""}${S.me.isOwner && !r.decided_by ? ` · <button class="btn ghost sm" data-xreq="${r.id}" data-ok="0">Decline</button>` : ""}</div>`}</div>`;
  return `<div class="card ${pend.length ? "hot" : ""}" id="xtreq" ${pend.length ? "" : `data-empty="1"`}><h2><i class="ico">＋</i>Hours to sign off<span>${pend.length ? `${pend.length} to approve` : "nothing waiting"}</span></h2>
    ${pend.length ? `<div class="list">${pend.map(row).join("")}</div>` : `<p class="empty">✓ Nothing to approve.</p>`}${recent.length ? `<details><summary>Recent</summary><div class="list" style="margin-top:8px">${recent.map(row).join("")}</div></details>` : ""}</div>`;
}
async function decideXt(id, ok) {
  const reply = $(`[data-xreply="${id}"]`)?.value.trim() || null;
  const { error } = await sb.rpc("extra_time_decide", { p_id: id, p_approve: ok, p_reply: reply }); if (error) return toast(error.message, "err");
  toast(ok ? "Approved · added to their hours" : "Declined", "ok"); await loadAll(); render();
}
async function decideSodReq(id, ok) {
  const reply = $(`[data-sreply="${id}"]`)?.value.trim() || null;
  const st = $(`[data-sstart="${id}"]`)?.value || null; if (st === "") { await loadAll(); render(); return toast("Enter the time started", "err"); }
  const { error } = await sb.rpc("sod_request_decide", { p_id: id, p_approve: ok, p_reply: reply, p_started: st ? st + ":00" : null }); if (error) { await loadAll(); render(); return toast(error.message, "err"); }
  fn("notify", { type: "sod_request_decided", id }).catch(() => { });
  toast(ok ? "Approved · run times updated" : "Declined", "ok"); await loadAll(); render();
}

/* ---- wiring ---- */
// runs that can't be scored yet (EOD figures missing), by the driver responsible: Edit their EOD, or ask them to fill it in
function pendingRuns() { const t = today(); const wk = monOf(t); const D = scoreData(); const out = [];
  for (const d of S.drivers) for (const e of scoreFor(d.id, wk, addDays(wk, 6), D, S.C).effDays.filter(e => e.pending && e.day < t)) for (const r of e.rows || []) if (r.need?.length) out.push({ drv: d.id, day: e.day, code: r.shift?.run || r.code, need: r.need, eod: r.eod, shift: r.shift });
  return out; }
function pendingSheet() {
  const L = pendingRuns(); const by = {}; for (const r of L) (by[r.drv] ??= []).push(r);
  sheet(`<h3>Runs that can't be scored yet</h3>${L.length ? Object.entries(by).map(([d, rs]) => `<div class="item warn" style="margin-bottom:8px"><div class="row" style="justify-content:space-between;align-items:center"><b>${esc(nm(d))}</b><button class="btn sm ghost" data-pask="${d}">Ask ${esc(first(nm(d)))}</button></div>
    ${rs.map((r, i) => `<div class="row" style="justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:6px;margin-top:6px"><span>${esc(r.code)} · ${label(r.day)}<span class="meta"> · missing ${esc(r.need.join(", "))}</span></span>${r.eod ? `<button class="btn sm" data-pedit="${d}|${i}">Edit</button>` : `<span class="meta">no EOD</span>`}</div>`).join("")}</div>`).join("") : `<p class="empty">✓ Every run can be scored.</p>`}`, bg => {
    bg.querySelectorAll("[data-pedit]").forEach(b => b.onclick = () => { const [d, i] = b.dataset.pedit.split("|"); const r = by[d]?.[+i]; if (r?.eod) eodEdit(r.eod); });
    bg.querySelectorAll("[data-pask]").forEach(b => b.onclick = async () => { b.disabled = true; const d = b.dataset.pask; const rs = by[d] || [];
      const body = `Hi ${first(nm(d))}, I can't score ${rs.length > 1 ? "these runs" : "this run"} yet because some EOD figures are missing:\n${rs.map(r => `• ${r.code} · ${label(r.day)}: ${r.need.join(", ")}`).join("\n")}\nPlease open the EOD in the app and fill them in. Thanks, ${first(S.me.name)}`;
      try { const msg = await q(sb.from("messages").insert({ sender: S.me.id, body, needs_confirm: true }).select().single()); await q(sb.from("message_recipients").insert({ message_id: msg.id, person: d })); fn("notify", { type: "message", message_id: msg.id }).catch(() => { }); toast(`Asked ${first(nm(d))}`, "ok"); b.textContent = "Asked ✓"; }
      catch (e) { b.disabled = false; toast(e.message, "err"); } }); });
}
export function wireAdmin() {
  $$("[data-go]").forEach(b => b.onclick = () => { if (b.dataset.go === "pending") return pendingSheet(); S.tab = b.dataset.go; location.hash = S.tab; render(); });
  $$("[data-sreq]").forEach(b => b.onclick = e => { e.stopPropagation(); b.disabled = true; decideSodReq(b.dataset.sreq, b.dataset.ok === "1"); });
  $$("[data-xreq]").forEach(b => b.onclick = e => { e.stopPropagation(); b.disabled = true; decideXt(b.dataset.xreq, b.dataset.ok === "1"); });
}
export function wireLive() {
  $$("[data-go]").forEach(b => b.onclick = () => { S.tab = b.dataset.go; location.hash = S.tab; render(); });
  $("#av-go")?.addEventListener("click", async () => { const d = $("#av-day").value || null; S.avFrom = $("#av-from").value || null; S.avTo = $("#av-to").value || null; S.avDay = d;
    if (d && !S.shifts.some(s => s.day === d)) { if (!S.cmpFrom || d < S.cmpFrom) S.cmpFrom = d; await loadAll(); } render(); });
  $("#av-now")?.addEventListener("click", () => { S.avDay = S.avFrom = S.avTo = null; render(); });
  $$("[data-day]").forEach(b => b.onclick = () => { const d = b.dataset.day; const cur = sel(); S.daySel = cur.includes(d) ? (cur.length > 1 ? cur.filter(x => x !== d) : cur) : [...cur, d].sort(); render(); });
  $$("[data-days]").forEach(b => b.onclick = () => { const today_ = b.dataset.days === "today"; if (today_) S.liveWk = monOf(today()); const wk = liveWk(); S.daySel = today_ ? [today()] : DAYS.map((_, i) => addDays(wk, i)); S.daySelWk = wk; render(); });
  $$("[data-lwk]").forEach(b => b.onclick = () => { const cur = monOf(today()); const v = b.dataset.lwk; S.liveWk = v === "0" ? cur : v === "next" ? addDays(cur, 7) : addDays(liveWk(), +v * 7); render(); });
  $$("[data-go]").forEach(b => b.onclick = () => { S.tab = b.dataset.go; location.hash = S.tab; render(); });
  $$("[data-dismiss]").forEach(b => b.addEventListener("click", e => e.stopPropagation()));
  $$("[data-dismiss]").forEach(b => b.onclick = async () => { await q(sb.from("marks").upsert({ key: b.dataset.dismiss, status: "exc", reviewed: true, note: "Dismissed on the dashboard", by_person: S.me.id, at: new Date().toISOString() })); });
  $("#imp-undismiss")?.addEventListener("click", async () => { await sb.from("marks").delete().like("key", "imp|%"); });
  const el = $("#map"); if (!el || !window.L) return;
  const map = L.map(el, { zoomControl: true }).setView([-45.88, 170.4], 10);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19, className: "osm-dark" }).addTo(map);
  const latest = {}; for (const l of S.locs) if (!latest[l.driver]) latest[l.driver] = l;
  const pts = Object.values(latest).filter(l => { const sh = S.shifts.find(s => s.id === l.shift_id); return sh ? !S.eodBy[sh.id] : true; });
  for (const l of pts) { const stale = Date.now() - new Date(l.at) > 600e3; L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "", html: `<div class="mk ${stale ? "stale" : ""}">${esc(fnm(l.driver))}</div>`, iconAnchor: [20, 12] }) }).addTo(map).bindPopup(`<b>${esc(nm(l.driver))}</b><br>${esc(fmtTs(l.at))}${l.speed ? `<br>${Math.round(l.speed * 3.6)} km/h` : ""}`); }
  if (pts.length) map.fitBounds(L.latLngBounds(pts.map(l => [l.lat, l.lng])).pad(0.3), { maxZoom: 13 });
}
