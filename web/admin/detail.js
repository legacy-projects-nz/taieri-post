// Drill-down sheets for the owner portal: every tile, row and chip opens the records and history behind it.
import { sb, q, nzNow, today, addDays, dow, monOf, label, toMin, fmtT, fmt24, fmtTs, fmtTime, ago, esc, $, $$, toast, pill, first, col, pct, isSort, avg } from "/shared/core.js";
import { scoreFor, fortnight, itemNote, STATE_LABEL, effCalc, band, dayShifts, segTimes, addName } from "/shared/score.js";
import { S, sheet, nm, fnm, scoreData, render, fn, closeSheets, editVan, editPerson } from "/admin/admin.js";
import { driverDay } from "/admin/live.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const chip = it => `<button class="chip ${it.st} ${it.mark?.status ? "man" : ""}" data-item="${esc(it.key)}" title="${STATE_LABEL[it.st]}">${esc(it.label)} <span style="font-weight:500">${itemNote(it).replace(/^posted /, "")}</span></button>`;
const tile = (l, v, s = "", cls = null, attrs = "") => `<button class="tile" ${attrs}><div class="l">${l}</div><div class="v ${cls || "c-" + col(v)}">${typeof v === "number" || v == null ? pct(v) : v}</div>${s ? `<div class="s">${s}</div>` : ""}</button>`;
const hrs = v => v == null ? "—" : `${(+v).toFixed(1)} h`;
const trkCls = v => v == null ? "grey" : v <= 0 ? "ok" : v <= 10 ? "warn" : "crit";
const trkTxt = v => v == null ? "—" : (v > 0 ? "+" : "") + Math.round(v) + "%";
const RAW_L = { sent_at: "sent", finish_time: "finish time", sort_min: "sorting (min)", parcels: "parcels / delivery total", stops: "stops / jobs", trays: "mail trays", pickups: "pick-up stops", pickup_parcels: "pick-up parcels", cycled: "next cycled", sorted_parcels: "sorted parcels", sorted_mail: "sorted mail", nzc_ph: "NZC/PH pick-up", legs: "legs done", newspapers: "newspapers done", run_id: "run ID", start_km: "start km", end_km: "end km", edited_at: "edited", van: "van", note: "note", extra: "extra" };
const rawRow = (row, skip = ["shift_id", "driver", "id"]) => row ? `<pre class="msg">${esc(Object.entries(row).filter(([k, v]) => v != null && v !== "" && !skip.includes(k) && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)).map(([k, v]) => `${RAW_L[k] || k}: ${Array.isArray(v) ? v.map(addName).join(", ") : typeof v === "object" ? JSON.stringify(v) : /_at$/.test(k) && /T/.test(String(v)) ? fmtTs(v) : typeof v === "boolean" ? (v ? "Yes" : "No") : /^\d{2}:\d{2}:\d{2}$/.test(String(v)) ? fmtT(toMin(v)) : v}`).join("\n"))}</pre>` : "";
const drvName = id => `<button class="linkbtn" data-driver="${esc(id)}" style="font-size:inherit;padding:0">${esc(nm(id))}</button>`;
const dayBtn = (id, day, txt) => `<button class="linkbtn" data-dayof="${esc(id)}|${day}" style="font-size:inherit;padding:0">${txt || label(day)}</button>`;

/* ---------- per driver-day working: expected (EOD figures, or estimated from past EODs), actual (SOD → EOD), efficiency rows ---------- */
export function dayRow(drv, d) {
  const r = driverDay(drv, d); if (!r) return null;
  return { ...r, driver: drv.id, day: d, target: r.D ? r.D.hours : r.exp, actual: r.act, actualEst: r.actEst ?? r.exp, actualIsEst: r.act == null, actHow: r.actHow || "", expected: r.exp, expEst: !!r.est, holiday: !!r.holiday, spendActual: r.act != null ? r.act * (r.rate || S.C.rules.hourRate) : null, runs: r.runSegs ? r.runSegs.map(x => x.shift.run) : [], runSegs: r.runSegs || [], eods: r.eods || [], sod: r.sod || null, effRows: r.effRows || [], trk: r.trk ?? null, train: r.train || 0 };
}
const expTxt = (r, bold = false) => r.expected ? `<span class="${r.expEst ? "c-warn" : ""}" title="${r.expEst ? "estimated from past EODs until this day's EODs are in" : "from the EOD figures"}">${r.expEst ? "≈" : ""}${bold ? "<b>" : ""}${hrs(r.expected)}${bold ? "</b>" : ""}</span>` : "—";
const weekDays = wk => Array.from({ length: 7 }, (_, i) => addDays(wk, i));

/* ---------- generic binding for everything inside a sheet or the main view ---------- */
export function bind(root) {
  if (!root) return;
  const on = (sel, f) => root.querySelectorAll(sel).forEach(el => { if (el._bound) return; el._bound = true; el.addEventListener("click", e => { const inner = e.target.closest("button,input,select,textarea,a,summary,label"); if (inner && inner !== el && el.contains(inner)) return; e.stopPropagation(); f(el, e); }); });
  const sc = () => import("/admin/scorecard.js");
  on("[data-item]", el => sc().then(m => m.itemSheet(el.dataset.item)));
  on("[data-driver]", el => sc().then(m => m.driverSheet(el.dataset.driver, el.dataset.from, el.dataset.to)));
  on("[data-dayof]", el => { const [id, day] = el.dataset.dayof.split("|"); openDay(id, day); });
  on("[data-weekof]", el => { const [id, w] = el.dataset.weekof.split("|"); openWeekFor(id, w); });
  on("[data-effshift]", el => sc().then(m => { const r = m.effRowFor(el.dataset.effshift); if (r) m.effSheet(r); else toast("No time formula for this run yet — set one under Scorecard → Formulas", "err"); }));
  on("[data-eodedit]", el => sc().then(m => { const e = S.eodBy[el.dataset.eodedit]; if (e) m.eodEdit(e); }));
  on("[data-metric]", el => openMetric(el.dataset.metric, el.dataset.mwk || S.week, el.dataset.mto || null));
  on("[data-kpi]", el => openKpi(el.dataset.kpi, el.dataset.days ? el.dataset.days.split(",") : [today()]));
  on("[data-alert]", el => { const a = S.alerts.find(x => x.id === el.dataset.alert); if (a) openAlert(a); });
  on("[data-vanof]", el => openVan(el.dataset.vanof));
  on("[data-vchk]", el => { const c = S.vchk.find(x => x.id === el.dataset.vchk); if (c) checkSheet(c); });
  on("[data-changes]", el => openChanges(el.dataset.changes));
  on("[data-task]", el => openTask(el.dataset.task, el.dataset.rule || null));
  on("[data-news]", el => openNews(el.dataset.news, el.dataset.mwk || monOf(today())));
  on("[data-hoursday]", el => openHoursDay(el.dataset.hoursday));
  on("[data-labour]", el => openLabour(el.dataset.labour || S.week));
  on("[data-ontime]", el => openOnTimeDay(el.dataset.ontime));
  on("[data-personof]", el => openPerson(el.dataset.personof));
  on("[data-entry]", el => { const e = S.entries.find(x => x.id === el.dataset.entry); if (e) openEntry(e); });
  on("[data-leaveof]", el => { const l = S.leave.find(x => x.id === el.dataset.leaveof); if (l) openLeave(l); });
  on("[data-msgof]", el => { const m = S.msgs.find(x => x.id === el.dataset.msgof); if (m) openMessage(m); });
  on("[data-important]", el => openImportant(JSON.parse(el.dataset.important)));
  on("[data-feed]", el => openFeed(JSON.parse(el.dataset.feed)));
  on("[data-tab-go]", el => { closeSheets(); S.tab = el.dataset.tabGo; location.hash = S.tab; render(); });
  on("[data-ack]", async el => { const ids = el.dataset.items.split(","); const patch = el.dataset.ack === "ok" ? { confirmed_at: new Date().toISOString(), confirmed_by: S.me.id } : { dismissed_at: new Date().toISOString(), confirmed_by: S.me.id }; await q(sb.from("change_acks").update(patch).in("item_id", ids).eq("driver", el.dataset.drv)); toast(el.dataset.ack === "ok" ? "Confirmed" : "Dismissed", "ok"); el.closest(".sheet-bg") ? refreshTop() : null; });
  on("[data-resolve]", async el => { await q(sb.from("alerts").update({ resolved_at: new Date().toISOString(), resolved_by: S.me.id }).eq("id", el.dataset.resolve)); toast("Resolved", "ok"); el.closest(".sheet-bg") ? refreshTop() : null; });
  on("[data-van-edit]", el => editVan(el.dataset.vanEdit));
  on("[data-mark-done]", async el => { const [sid, addon] = el.dataset.markDone.split("|"); const s = S.shifts.find(x => x.id === sid); if (!s) return; const done = { ...(s.done || {}), [addon]: new Date().toISOString() }; const { error } = await sb.from("shifts").update({ done }).eq("id", sid); if (error) return toast(error.message, "err"); s.done = done; toast("Marked done", "ok"); if (el.closest(".sheet-bg")) refreshTop(); else render(); });
  on("[data-person-edit]", el => editPerson(el.dataset.personEdit));
}
// re-open the top sheet with fresh data after a write
const stack = [];
function open(html, onOpen, opts = {}) { const re = () => { const { bg, close } = sheet(html(), (bg2, close2) => { bind(bg2); onOpen?.(bg2, close2); }, opts); bg._reopen = re; return { bg, close }; }; return re(); }
export async function refreshTop() { const { loadAll } = await import("/admin/admin.js"); await loadAll(); const tops = $$(".sheet-bg"); const top = tops[tops.length - 1]; if (top?._reopen) { top.remove(); top._reopen(); } }

/* ================= KPI tiles ================= */
const KPI_T = { due: ["Posts due so far", "Every SOD and EOD whose due time has passed"], ok: ["On time", "Posts that landed before their due time"], late: ["Late", "Posted after the due time — each one takes off Admin points"], over: ["Overdue now", "Due and not in yet, or missing"], miss: ["Missing", "Never posted"], rate: ["Team on-time rate", "Closed posts: on time vs late/missing"], rostered: ["Drivers rostered", "Who is on the roster for these days"], all: ["All posts", "Everything required on these days"] };
export function openKpi(kind, days) {
  const [t, sub] = KPI_T[kind] || KPI_T.all; const D = scoreData();
  open(() => {
    if (kind === "rostered") { const rows = S.drivers.map(d => ({ d, days: days.map(day => dayRow(d, day)).filter(Boolean) })).filter(r => r.days.length);
      return `<h3>${t}</h3><p class="meta">${sub} · ${days.length === 1 ? label(days[0]) : `${label(days[0])} – ${label(days[days.length - 1])}`}</p><div class="scroll"><table class="dt"><tr><th>Driver</th><th>Days</th><th>Runs</th><th>Expected</th></tr>${rows.map(r => `<tr class="clk" data-driver="${r.d.id}"><td><b>${esc(r.d.name)}</b></td><td>${r.days.map(x => dayBtn(r.d.id, x.day, label(x.day).slice(0, 6))).join(" · ")}</td><td class="meta">${r.days.flatMap(x => x.runs).join(", ")}</td><td class="num">${expTxt({ expected: r.days.reduce((a, x) => a + x.expected, 0), expEst: r.days.some(x => x.expEst) })}</td></tr>`).join("")}</table></div><p class="hint"><span class="c-warn">≈ orange</span> = estimated from past EODs until the day's EODs are in.</p>`; }
    const all = S.drivers.flatMap(d => scoreFor(d.id, days[0], days[days.length - 1], D, S.C).items);
    const pick = { due: i => i.st !== "due", ok: i => i.st === "ok", late: i => i.st === "late", over: i => i.st === "over" || i.st === "miss", miss: i => i.st === "miss", rate: i => !["due", "over", "exc"].includes(i.st), all: () => true }[kind] || (() => true);
    const items = all.filter(pick); const by = {}; for (const i of items) (by[i.driver] ??= []).push(i);
    const n = { ok: items.filter(i => i.st === "ok").length, late: items.filter(i => i.st === "late").length, miss: items.filter(i => i.st === "miss").length, over: items.filter(i => i.st === "over").length };
    return `<h3>${t} · ${items.length}</h3><p class="meta">${sub} · ${days.length === 1 ? label(days[0]) : `${label(days[0])} – ${label(days[days.length - 1])}`}</p>
      <div class="row" style="gap:4px"><span class="chip ok">${n.ok} on time</span><span class="chip late">${n.late} late</span><span class="chip over">${n.over} overdue</span><span class="chip miss">${n.miss} missing</span></div>
      ${Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([d, L]) => `<div class="item"><div class="row" style="justify-content:space-between"><b>${drvName(d)} · ${L.length}</b></div><div class="row" style="gap:3px">${L.sort((a, b) => a.day.localeCompare(b.day)).map(i => `<span>${days.length > 1 ? `<span class="meta">${label(i.day).slice(0, 3)}</span> ` : ""}${chip(i)}</span>`).join("")}</div></div>`).join("") || `<p class="empty">Nothing in this group.</p>`}<p class="hint">Tap a chip to review, excuse or post it for them.</p>`;
  }, null, { wide: true });
}

/* ================= Team score tiles ================= */
const METRIC = { overall: ["Overall", "weighted: admin · efficiency · accuracy · safety"], admin: ["Admin", "100% minus points for late and missing posts"], eff: ["Efficiency", "expected hours ÷ hours taken, from EOD figures"], acc: ["Accuracy", "NZ Post scan compliance minus mistakes"], safe: ["Safety", "100% unless an entry says otherwise"] };
export function openMetric(k, wk, toD = null) {
  const [t, sub] = METRIC[k] || METRIC.overall; const D = scoreData();
  open(() => {
    const rows = S.drivers.map(d => ({ d, s: scoreFor(d.id, wk, toD || addDays(wk, 6), D, S.C) })).filter(r => r.s.closed || r.s.effDays.length || r.s.nMist || r.s.accDays.length).sort((a, b) => (a.s[k] ?? 101) - (b.s[k] ?? 101));
    const team = avg(rows.filter(r => !r.d.pay_exclude).map(r => r.s[k]));
    const detail = s => k === "admin" ? `${s.onTime}/${s.closed} on time · ${s.late} late · ${s.missing} missing${s.adj ? ` · ${s.adj > 0 ? "+" : ""}${s.adj} adjust` : ""}` : k === "eff" ? `${s.effDays.filter(e => !e.pending).length} day${s.effDays.filter(e => !e.pending).length === 1 ? "" : "s"} scored${s.effDays.some(e => e.pending) ? ` · ${s.effDays.filter(e => e.pending).length} waiting on figures` : ""}${band(s.eff) != null ? ` · Band ${band(s.eff) || "<1"}` : ""}` : k === "acc" ? `${s.feedPct != null ? `${s.accComp} of ${s.accItems} compliant` : "no feed figures"}${s.nMist ? ` · ${s.nMist} mistake${s.nMist > 1 ? "s" : ""}` : ""}` : k === "safe" ? (s.safeSet ? `${s.entries.filter(e => e.safety_pct != null).length} safety entr${s.entries.filter(e => e.safety_pct != null).length === 1 ? "y" : "ies"}` : "nothing recorded") : `adm ${pct(s.admin)} · eff ${pct(s.eff)} · acc ${pct(s.acc)} · saf ${pct(s.safe)}`;
    const weeks = Array.from({ length: 8 }, (_, i) => addDays(wk, -7 * (7 - i))).map(w => { const ss = S.drivers.filter(d => !d.pay_exclude).map(d => scoreFor(d.id, w, addDays(w, 6), D, S.C)).filter(s => s.closed || s.effDays.length || s.accDays.length); const vals = ss.map(s => s[k]).filter(v => v != null); return { w, v: avg(vals), lo: vals.length ? Math.min(...vals) : null, hi: vals.length ? Math.max(...vals) : null, n: ss.length }; });
    return `<h3>Team ${t.toLowerCase()} · ${pct(team)}</h3><p class="meta">${sub} · ${toD ? `${label(wk)} – ${label(toD)}` : `week of ${label(wk)}${wk !== monOf(today()) ? "" : " (to date)"}`}</p>
      <div class="scroll"><table class="dt"><tr><th>Driver</th><th>${t}</th><th></th><th>Detail</th></tr>${rows.map(({ d, s }) => `<tr class="clk" data-driver="${d.id}" data-from="${wk}" data-to="${toD || addDays(wk, 6)}"><td><b>${esc(d.name)}</b>${d.pay_exclude ? ` <span class="meta">(owner)</span>` : ""}</td><td class="c-${col(s[k])} num"><b>${pct(s[k])}</b></td><td style="min-width:90px"><div class="bar"><i class="bg-${col(s[k])}" style="width:${Math.min(100, s[k] || 0)}%"></i></div></td><td class="meta">${detail(s)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No scores yet this week.</td></tr>`}</table></div>
      <h4 style="margin:6px 0 0">Team history</h4><div class="scroll"><table class="dt"><tr><th>Week of</th><th>Team</th><th></th><th>Lowest</th><th>Highest</th><th>Drivers</th></tr>${weeks.map(x => `<tr class="clk ${x.w === wk ? "c-accent" : ""}" data-metric="${k}" data-mwk="${x.w}"><td>${label(x.w)}</td><td class="c-${col(x.v)} num"><b>${pct(x.v)}</b></td><td style="min-width:90px"><div class="bar"><i class="bg-${col(x.v)}" style="width:${Math.min(100, x.v || 0)}%"></i></div></td><td class="c-${col(x.lo)}">${pct(x.lo)}</td><td class="c-${col(x.hi)}">${pct(x.hi)}</td><td class="num">${x.n || "—"}</td></tr>`).join("")}</table></div><p class="hint">Tap a driver for their full sheet, or a week to see that week's breakdown.</p>`;
  }, null, { wide: true });
}

/* ================= Labour ================= */
export function openLabour(wk) {
  open(() => {
    const days = weekDays(wk); const rows = S.drivers.filter(d => !d.pay_exclude).map(d => { const dr = days.map(day => dayRow(d, day)).filter(Boolean); const E = dr.reduce((a, r) => a + r.expected, 0), estH = dr.filter(r => r.expEst).reduce((a, r) => a + r.expected, 0), A = dr.reduce((a, r) => a + (r.actual || 0), 0), Aest = dr.filter(r => r.actualIsEst).reduce((a, r) => a + (r.actualEst || 0), 0), Ec = dr.filter(r => r.actual != null).reduce((a, r) => a + r.expected, 0), tr = dr.filter(r => r.actual != null).reduce((a, r) => a + r.train, 0), sp = dr.reduce((a, r) => a + r.spend, 0); return { d, dr, E, estH, A, Aest, At: A + Aest, Ec, tr, sp, trk: Ec && A ? ((A - tr) - Ec) / Ec * 100 : null, done: dr.filter(r => r.actual != null).length }; }).filter(r => r.dr.length).sort((a, b) => (b.trk ?? -999) - (a.trk ?? -999));
    const tot = rows.reduce((a, r) => ({ E: a.E + r.E, estH: a.estH + r.estH, A: a.A + r.A, Aest: a.Aest + r.Aest, Ec: a.Ec + r.Ec, tr: a.tr + r.tr, sp: a.sp + r.sp }), { E: 0, estH: 0, A: 0, Aest: 0, Ec: 0, tr: 0, sp: 0 });
    const ax = (a, aest, bold) => (a || aest) ? `<span class="${aest ? "c-warn" : ""}" title="${aest ? `${hrs(a)} from SOD → EOD · ≈${hrs(aest)} estimated (SOD/EOD not in)` : "SOD → EOD"}">${aest ? "≈" : ""}${bold ? "<b>" : ""}${hrs(a + aest)}${bold ? "</b>" : ""}</span>` : "—";
    const ex = (e, est, bold) => e ? `<span class="${est ? "c-warn" : ""}">${est ? "≈" : ""}${bold ? "<b>" : ""}${hrs(e)}${bold ? "</b>" : ""}</span>` : "—";
    return `<h3>Labour · week of ${label(wk)}</h3><p class="meta">Expected = run formula on the EOD figures, <span class="c-warn">orange ≈ = estimated</span> from the average figures that run posts on that weekday until its EOD is in · Actual = SOD to last EOD · Jeremy left out · rate from each profile (default $${S.C.rules.hourRate}/h)</p>
      <div class="scroll"><table class="dt"><tr><th>Driver</th><th>Expected</th><th>Actual</th><th>Training</th><th>Tracking</th><th>Spend</th><th>Days in</th></tr>${rows.map(r => `<tr class="clk" data-weekof="${r.d.id}|${wk}"><td><b>${esc(r.d.name)}</b><div class="meta">$${r.d.rate || S.C.rules.hourRate}/h</div></td><td class="num">${ex(r.E, r.estH > 0)}</td><td class="num">${ax(r.A, r.Aest)}</td><td class="num">${r.tr ? hrs(r.tr) : ""}</td><td class="c-${trkCls(r.trk)}">${trkTxt(r.trk)}</td><td class="num">$${Math.round(r.sp).toLocaleString()}</td><td class="num">${r.done}/${r.dr.length}</td></tr>`).join("")}<tr><td><b>Week</b></td><td class="num">${ex(tot.E, tot.estH > 0, true)}</td><td class="num">${ax(tot.A, tot.Aest, true)}</td><td class="num">${tot.tr ? hrs(tot.tr) : ""}</td><td class="c-${trkCls(tot.Ec && tot.A ? ((tot.A - tot.tr) - tot.Ec) / tot.Ec * 100 : null)}"><b>${trkTxt(tot.Ec && tot.A ? ((tot.A - tot.tr) - tot.Ec) / tot.Ec * 100 : null)}</b></td><td class="num"><b>$${Math.round(tot.sp).toLocaleString()}</b></td><td></td></tr></table></div>
      <h4 style="margin:6px 0 0">By day</h4><div class="scroll"><table class="dt"><tr><th>Day</th><th>Drivers</th><th>Expected</th><th>Actual</th><th>Tracking</th></tr>${days.map(day => { const dr = rows.map(r => r.dr.find(x => x.day === day)).filter(Boolean); if (!dr.length) return ""; const E = dr.reduce((a, r) => a + r.expected, 0), est = dr.some(r => r.expEst), A = dr.reduce((a, r) => a + (r.actual || 0), 0), Aest = dr.filter(r => r.actualIsEst).reduce((a, r) => a + (r.actualEst || 0), 0), Ec = dr.filter(r => r.actual != null).reduce((a, r) => a + r.expected, 0), tr = dr.filter(r => r.actual != null).reduce((a, r) => a + r.train, 0); const v = Ec && A ? ((A - tr) - Ec) / Ec * 100 : null; return `<tr class="clk" data-hoursday="${day}"><td>${label(day)}${S.C.holidays[day] ? ` <span class="meta">${esc(S.C.holidays[day].name)}</span>` : ""}</td><td class="num">${dr.length}</td><td class="num">${ex(E, est)}</td><td class="num">${ax(A, Aest)}</td><td class="c-${trkCls(v)}">${trkTxt(v)}</td></tr>`; }).join("")}</table></div><p class="hint">Actual is SOD → last EOD; <span class="c-warn">≈ orange</span> means the SOD or an EOD is missing and that part is estimated (what is in + the roster, or the expected hours) until the posts arrive. Tracking compares actual with expected only on days whose SOD and EODs are in. Tap a driver for their week, or a day for everyone on that day.</p>`;
  }, null, { wide: true });
}
export function openHoursDay(day) {
  open(() => {
    const rows = S.drivers.map(d => dayRow(d, day)).filter(Boolean).sort((a, b) => (b.trk ?? -999) - (a.trk ?? -999));
    const T = rows.filter(r => !S.peopleBy[r.driver].pay_exclude); const tot = { e: T.reduce((a, r) => a + r.expected, 0), est: T.some(r => r.expEst), a: T.reduce((a, r) => a + (r.actual || 0), 0), aest: T.filter(r => r.actualIsEst).reduce((a, r) => a + (r.actualEst || 0), 0), ec: T.filter(r => r.actual != null).reduce((a, r) => a + r.expected, 0), tr: T.reduce((a, r) => a + r.train, 0) };
    return `<h3>${label(day, true)}</h3><p class="meta">${S.C.holidays[day] ? `${esc(S.C.holidays[day].name)} · paid at the holiday hours · ` : ""}${rows.length} rostered · expected ${expTxt({ expected: tot.e, expEst: tot.est })} · actual ${tot.a || tot.aest ? `<span class="${tot.aest ? "c-warn" : ""}">${tot.aest ? "≈" : ""}${hrs(tot.a + tot.aest)}</span>` : "—"} (Jeremy left out of totals) · <span class="c-warn">orange ≈</span> = estimated until the EODs are in</p>
      <div class="scroll"><table class="dt"><tr><th>Driver</th><th>Runs</th><th>Rostered</th><th>SOD → EOD</th><th>Expected</th><th>Actual</th><th>Efficiency</th><th>Tracking</th></tr>${rows.map(r => { const live = r.effRows.filter(x => !x.c.trainDay); const perf = live.length && live.every(x => x.c.perf != null && !x.c.need.length) ? Math.max(0, Math.min(150, live.reduce((a, x) => a + x.c.allowed, 0) / 60 / live.reduce((a, x) => a + x.c.takenTrk, 0) * 100)) : null; const lastE = r.eods[r.eods.length - 1];
      return `<tr class="clk" data-dayof="${r.driver}|${day}"><td><b>${esc(nm(r.driver))}</b>${S.peopleBy[r.driver].pay_exclude ? ` <span class="meta">(owner)</span>` : ""}</td><td class="meta">${r.holiday ? "holiday" : r.D.segs.map(x => x.shift.run).join(" · ")}</td><td class="mono">${r.D ? `${fmtT(r.D.start)}–${fmtT(r.D.end)}` : ""}</td><td class="mono">${r.holiday ? "" : r.sod ? fmtTime(r.sod.sent_at) : "<span class='c-crit'>no SOD</span>"}${r.holiday ? "" : " → "}${r.holiday ? "" : lastE ? (lastE.finish_time ? fmtT(toMin(lastE.finish_time)) : fmtTime(lastE.sent_at)) : r.runSegs?.length ? `<span class="c-warn">${r.eods.length}/${r.runSegs.length} EOD</span>` : "—"}</td><td class="num">${expTxt(r)}</td><td class="num">${r.actual != null ? hrs(r.actual) : r.actualEst ? `<span class="c-warn" title="${esc(r.actHow)}">≈${hrs(r.actualEst)}</span>` : "—"}</td><td>${perf == null ? `<span class="meta">${r.effRows.some(x => x.c.need.length) ? "needs " + esc([...new Set(r.effRows.flatMap(x => x.c.need))].join(", ")) : "—"}</span>` : `<b class="c-${col(Math.min(100, perf))}">${Math.round(perf)}%</b>`}</td><td class="c-${trkCls(r.trk)}">${trkTxt(r.trk)}</td></tr>`; }).join("") || `<tr><td colspan="8" class="empty">Nobody rostered.</td></tr>`}</table></div>
      <div class="row"><button class="btn ghost sm" data-hoursday="${addDays(day, -1)}">‹ ${label(addDays(day, -1))}</button><button class="btn ghost sm" data-ontime="${day}">Posts that day</button><button class="btn ghost sm" data-hoursday="${addDays(day, 1)}">${label(addDays(day, 1))} ›</button></div><p class="hint">Tap a driver for their day: shifts, posts, figures and corrections.</p>`;
  }, null, { wide: true });
}

/* ================= One driver, one day ================= */
export function openDay(id, day) {
  open(() => {
    const p = S.peopleBy[id]; if (!p) return `<h3>Unknown driver</h3>`; const r = dayRow(p, day); const s = scoreFor(id, day, day, scoreData(), S.C); const n = nzNow();
    const ents = S.entries.filter(e => e.driver === id && e.day === day); const alerts = S.alerts.filter(a => a.driver === id && (a.created_at.slice(0, 10) === day || (a.shift_id && S.shifts.find(x => x.id === a.shift_id)?.day === day)));
    const changes = S.items.filter(i => i.day === day && i.affects.includes(id)); const ackOf = {}; for (const a of S.acks) (ackOf[a.item_id] ??= {})[a.driver] = a;
    const nav = `<div class="row"><button class="btn ghost sm" data-dayof="${id}|${addDays(day, -1)}">‹ ${label(addDays(day, -1))}</button><button class="btn ghost sm" data-driver="${id}">${esc(first(p.name))}'s sheet</button><button class="btn ghost sm" data-weekof="${id}|${monOf(day)}">Week</button><button class="btn ghost sm" data-dayof="${id}|${addDays(day, 1)}">${label(addDays(day, 1))} ›</button></div>`;
    if (!r) return `<h3>${esc(p.name)} · ${label(day, true)}</h3><p class="meta">Not rostered${S.C.holidays[day] ? ` · ${esc(S.C.holidays[day].name)}` : ""}</p>${ents.length ? `<h4>Entries</h4><div class="list">${ents.map(entryRow).join("")}</div>` : ""}${alerts.length ? `<h4>Alerts</h4><div class="list">${alerts.map(alertLine).join("")}</div>` : ""}${nav}`;
    const segs = r.holiday ? `<p>${esc(r.hol.name)} · paid ${hrs(r.target)}</p>` : r.D.segs.map(x => `<div class="seg"><div class="tm">${fmtT(x.st)} – ${fmtT(x.en)}</div><div class="rn">${x.sort ? esc(S.runsBy[x.shift.run]?.label || "Sort") : `${esc(x.shift.run)}<span class="sub">${esc(S.runsBy[x.shift.run]?.name || "")}${S.C.runCodes[x.shift.run] ? ` · ${esc(S.C.runCodes[x.shift.run])}` : ""}</span>`}<div class="tags">${x.shift.van ? `<button class="tag van" data-vanof="${esc(x.shift.van)}" style="border:0;cursor:pointer">${esc(x.shift.van)}</button>` : ""}${x.shift.trainee ? `<span class="tag tr">training ${esc(fnm(x.shift.trainee))}</span>` : ""}${(x.shift.addons || []).map(a => `<span class="tag">+ ${esc(S.addons.find(z => z.id === a)?.name || addName(a))}${x.shift.done?.[a] ? ` ✓ ${fmtTime(x.shift.done[a])}` : x.shift.plan?.[a] ? ` ~${fmtT(toMin(x.shift.plan[a]))}` : ""}</span>`).join("")}</div>${x.shift.note ? `<div class="meta">${esc(x.shift.note)}</div>` : ""}</div></div>`).join("");
    const effTbl = r.effRows.length ? `<div class="scroll"><table class="dt"><tr><th>Run</th><th>Expected</th><th>Actual</th><th>Efficiency</th><th>Parcels</th><th>Stops</th><th>Trays</th><th>Sort</th><th>Legs</th><th></th></tr>${r.effRows.map(x => `<tr class="clk" data-effshift="${x.x.shift.id}"><td><b>${esc(x.x.shift.run)}</b>${x.c.trainDay ? ` ${pill("training", "warn")}` : ""}${x.ov && Object.keys(x.ov).some(k => !["shift_id", "updated_at", "note"].includes(k) && x.ov[k] != null && x.ov[k] !== false && !(Array.isArray(x.ov[k]) && !x.ov[k].length)) ? ` ${pill("corrected", "accent")}` : ""}</td><td class="num">${x.c.est ? "≈" : ""}${(x.c.allowed / 60).toFixed(1)} h</td><td class="num">${x.c.taken ? x.c.taken.toFixed(1) + " h" : "—"}<div class="meta mono">${x.c.start != null ? fmtT(x.c.start) : "?"}→${x.c.end != null ? fmtT(x.c.end) : "?"}</div></td><td>${x.c.trainDay ? "training" : x.c.need.length ? `<span class="c-warn">needs ${esc(x.c.need.join(", "))}</span>` : x.c.perf == null ? "—" : `<b class="c-${col(Math.min(100, x.c.perf))}">${Math.round(x.c.perf)}%</b>`}</td><td class="num">${x.ov?.parcels ?? x.eod?.parcels ?? ""}</td><td class="num">${x.ov?.stops ?? x.eod?.stops ?? ""}</td><td class="num">${x.ov?.trays ?? x.eod?.trays ?? ""}</td><td class="num">${x.ov?.sort_min ?? x.eod?.sort_min ?? ""}</td><td class="meta">${((x.ov?.legs) || [...new Set([...(x.x.shift.addons || []), ...(x.eod?.legs || [])])]).filter(l => S.C.addMin[l]).map(addName).join(", ")}</td><td><button class="btn ghost sm" data-effshift="${x.x.shift.id}">Formula / correct</button></td></tr>`).join("")}</table></div>` : "";
    const posts = s.items.map(it => `<div class="item"><div class="row" style="justify-content:space-between;align-items:flex-start"><div>${chip(it)} <span class="meta">due ${fmtT(it.due % 1440)}${it.mark?.note ? ` · ${esc(it.mark.note)}` : ""}${it.row?.edited_at ? ` · <span class="c-warn">edited by driver ${fmtTs(it.row.edited_at)}</span>` : ""}</span></div><span class="row" style="flex:0;gap:4px">${it.row && it.kind === "EOD" ? `<button class="btn ghost sm" data-eodedit="${it.shift.id}">Edit figures</button>` : ""}<button class="btn ghost sm" data-item="${esc(it.key)}">${it.row ? "Review" : "Post it for them"}</button></span></div>${it.row ? rawRow(it.row) : `<div class="meta">Nothing posted.</div>`}</div>`).join("");
    const feed = s.accDays.map(a => `<div class="meta">${esc(a.code)} ${esc(S.C.runCodes[a.code] || "")}: ${a.compliant} of ${a.items} compliant (${a.v == null ? "—" : a.v.toFixed(1) + "%"})</div>`).join("");
    return `<h3>${esc(p.name)} · ${label(day, true)}</h3><p class="meta">${r.holiday ? `${esc(r.hol.name)} · paid ${hrs(r.target)}` : `rostered ${fmtT(r.D.start)}–${fmtT(r.D.end)}`}${r.expected && !r.holiday ? ` · expected ${expTxt(r)}` : ""}${r.actual != null && !r.holiday ? ` · actual ${hrs(r.actual)}` : ""}${r.trk != null ? ` · <span class="c-${trkCls(r.trk)}">${trkTxt(r.trk)}</span>` : ""}</p>
      ${nav}
      <h4 style="margin:4px 0 0">Shifts</h4>${segs}
      ${effTbl ? `<h4 style="margin:4px 0 0">Efficiency · tap a run for the formula and to correct figures</h4>${effTbl}` : ""}
      <h4 style="margin:4px 0 0">Posts</h4>${posts || `<p class="meta">No posts required (before ${label(S.C.rules.startDate)}).</p>`}
      ${feed ? `<h4 style="margin:4px 0 0">NZ Post feed</h4>${feed}` : ""}
      ${ents.length ? `<h4 style="margin:4px 0 0">Entries</h4><div class="list">${ents.map(entryRow).join("")}</div>` : ""}
      ${alerts.length ? `<h4 style="margin:4px 0 0">Alerts</h4><div class="list">${alerts.map(alertLine).join("")}</div>` : ""}
      ${changes.length ? `<h4 style="margin:4px 0 0">Roster changes for this day</h4><div class="list">${changes.map(i => { const a = ackOf[i.id]?.[id]; return `<div class="item ${a?.confirmed_at || a?.dismissed_at ? "done" : ""}"><div>${esc(i.summary)}</div><div class="meta">sent ${fmtTs(i.roster_changes.sent_at || i.roster_changes.created_at)} · ${a?.confirmed_at ? `✓ confirmed ${fmtTs(a.confirmed_at)}${a.confirmed_by ? " by " + esc(fnm(a.confirmed_by)) : ""}` : a?.dismissed_at ? "dismissed" : i.roster_changes.status === "sent" ? "<span class='c-crit'>not confirmed</span>" : esc(i.roster_changes.status)}</div></div>`; }).join("")}</div>` : ""}`;
  }, null, { wide: true });
}
const entryRow = e => `<div class="item clk ${e.excused ? "done" : e.kind === "mistake" ? "crit" : e.kind === "praise" ? "ok" : e.kind === "issue" ? "warn" : ""}" data-entry="${e.id}"><div><b>${esc(({ mistake: "Mistake", praise: "Praise", issue: "Went wrong", note: "Note", adjust: "Admin points", safety: "Safety", eff: "Efficiency set" })[e.kind] || e.kind)}</b> · ${esc(e.title)}${e.excused ? " " + pill("removed", "grey") : ""}${e.show_driver ? " " + pill("on their page", "accent") : ""}</div><div class="meta">${[e.note, e.run, e.admin_pts ? `Admin ${e.admin_pts > 0 ? "+" : ""}${e.admin_pts}` : "", e.safety_pct != null ? `Safety ${e.safety_pct}%` : "", e.eff_pct != null ? `Efficiency ${e.eff_pct}%` : ""].filter(Boolean).map(esc).join(" · ")}</div></div>`;
const alertLine = a => `<div class="item clk ${a.resolved_at ? "done" : String(a.kind).includes("miss") ? "crit" : "warn"}" data-alert="${a.id}"><div><b>${esc(a.title)}</b>${a.resolved_at ? " " + pill("resolved", "grey") : ""}</div><div class="meta">${esc(a.body || "")} · ${fmtTs(a.created_at)}</div></div>`;

/* ================= One driver, one week ================= */
export function openWeekFor(id, w) {
  open(() => {
    const p = S.peopleBy[id]; const s = scoreFor(id, w, addDays(w, 6), scoreData(), S.C); const days = weekDays(w).map(day => ({ day, r: dayRow(p, day), items: s.items.filter(i => i.day === day), e: s.effDays.find(x => x.day === day) }));
    const E = days.reduce((a, x) => a + (x.r?.expected || 0), 0), est = days.some(x => x.r?.expEst), A = days.reduce((a, x) => a + (x.r?.actual || 0), 0), Ec = days.filter(x => x.r?.actual != null).reduce((a, x) => a + (x.r?.expected || 0), 0), tr = days.reduce((a, x) => a + (x.r?.train || 0), 0); const trk = Ec && A ? ((A - tr) - Ec) / Ec * 100 : null;
    return `<h3>${esc(p.name)} · week of ${label(w)}</h3><p class="meta">${s.onTime}/${s.closed} posts on time · expected ${expTxt({ expected: E, expEst: est })}${A ? ` · ${hrs(A)} actual` : ""}${trk != null ? ` · <span class="c-${trkCls(trk)}">${trkTxt(trk)}</span>` : ""}${tr ? ` · ${hrs(tr)} training` : ""}</p>
      <div class="row"><button class="btn ghost sm" data-weekof="${id}|${addDays(w, -7)}">‹ week before</button><button class="btn ghost sm" data-driver="${id}" data-from="${w}" data-to="${addDays(w, 6)}">Full sheet</button><button class="btn ghost sm" data-weekof="${id}|${addDays(w, 7)}">week after ›</button></div>
      <div class="tiles">${tile("Overall", s.overall, "", null, `data-driver="${id}" data-from="${w}" data-to="${addDays(w, 6)}"`)}${tile("Admin", s.admin, `${s.late} late · ${s.missing} missing`, null, `data-driver="${id}" data-from="${w}" data-to="${addDays(w, 6)}"`)}${tile("Efficiency", s.eff, `${s.effDays.filter(e => !e.pending).length} days scored`, null, `data-driver="${id}" data-from="${w}" data-to="${addDays(w, 6)}"`)}${tile("Accuracy", s.acc, s.feedPct != null ? `${s.accComp}/${s.accItems} compliant` : "no feed figures", null, `data-driver="${id}" data-from="${w}" data-to="${addDays(w, 6)}"`)}${tile("Safety", s.safe, "", null, `data-driver="${id}" data-from="${w}" data-to="${addDays(w, 6)}"`)}</div>
      <div class="scroll"><table class="dt"><tr><th>Day</th><th>Runs</th><th>Rostered</th><th>Expected</th><th>Actual</th><th>Efficiency</th><th>Posts</th></tr>${days.map(x => `<tr class="clk ${x.r ? "" : "c-grey"}" data-dayof="${id}|${x.day}"><td>${label(x.day)}${x.r?.hol ? ` <span class="meta">${esc(x.r.hol.name)}</span>` : ""}</td><td class="meta">${x.r ? (x.r.holiday ? "holiday" : x.r.D.segs.map(y => y.shift.run).join(" · ")) : "off"}</td><td class="mono">${x.r?.D ? `${fmtT(x.r.D.start)}–${fmtT(x.r.D.end)}` : ""}</td><td class="num">${x.r ? expTxt(x.r) : ""}</td><td class="num">${x.r?.actual != null ? hrs(x.r.actual) : ""}</td><td>${x.e ? (x.e.pending ? `<span class="c-warn">waiting: ${esc(x.e.need || "EOD")}</span>` : `<b class="c-${col(Math.min(100, x.e.v))}">${Math.round(x.e.v)}%</b>${x.e.manual ? " set" : x.e.est ? " est" : ""}`) : ""}</td><td><span class="row" style="gap:3px">${x.items.map(chip).join("")}</span></td></tr>`).join("")}</table></div>
      ${s.mistakes.length || s.entries.length ? `<h4 style="margin:4px 0 0">Entries this week</h4><div class="list">${s.entries.map(entryRow).join("")}</div>` : ""}<p class="hint">Tap a day for the shifts, posts and figures behind it.</p>`;
  }, null, { wide: true });
}

/* ================= On-time by day ================= */
export function openOnTimeDay(day) {
  open(() => {
    const D = scoreData(); const rows = S.drivers.map(d => ({ d, items: scoreFor(d.id, day, day, D, S.C).items })).filter(r => r.items.length);
    const all = rows.flatMap(r => r.items); const closed = all.filter(i => !["due", "over", "exc"].includes(i.st)); const ok = closed.filter(i => i.st === "ok").length;
    return `<h3>Posts · ${label(day, true)}</h3><p class="meta">${closed.length ? `${ok} of ${closed.length} closed posts on time (${Math.round(ok / closed.length * 100)}%)` : "nothing closed yet"} · ${all.filter(i => i.st === "late").length} late · ${all.filter(i => i.st === "miss").length} missing · ${all.filter(i => i.st === "over").length} overdue · ${all.filter(i => i.st === "due").length} still to come</p>
      <div class="scroll"><table class="dt"><tr><th>Driver</th><th>Posts</th><th>Rate</th></tr>${rows.map(r => { const c = r.items.filter(i => !["due", "over", "exc"].includes(i.st)); return `<tr class="clk" data-dayof="${r.d.id}|${day}"><td><b>${esc(r.d.name)}</b></td><td><span class="row" style="gap:3px">${r.items.map(chip).join("")}</span></td><td class="num">${c.length ? Math.round(c.filter(i => i.st === "ok").length / c.length * 100) + "%" : "—"}</td></tr>`; }).join("") || `<tr><td colspan="3" class="empty">Nobody rostered.</td></tr>`}</table></div>
      <div class="row"><button class="btn ghost sm" data-ontime="${addDays(day, -1)}">‹ ${label(addDays(day, -1))}</button><button class="btn ghost sm" data-hoursday="${day}">Hours that day</button><button class="btn ghost sm" data-ontime="${addDays(day, 1)}">${label(addDays(day, 1))} ›</button></div>`;
  }, null, { wide: true });
}

/* ================= Newspapers ================= */
export function openNews(code, wk) {
  open(() => {
    const weeks = Array.from({ length: 8 }, (_, i) => addDays(wk, -7 * (7 - i)));
    const ws = S.shifts.filter(s => s.day >= wk && s.day <= addDays(wk, 6) && s.run === code && s.driver);
    const hist = weeks.map(w => { const sh = S.shifts.filter(s => s.day >= w && s.day <= addDays(w, 6) && s.run === code && s.driver); const hit = sh.map(s => ({ s, e: S.eodBy[s.id] })).find(x => x.e?.newspapers); return { w, sh, hit }; });
    return `<h3>Newspapers · ${esc(S.runsBy[code]?.label || code)}</h3><p class="meta">Claimed once a week on the EOD ("Newspapers done") · adds ${S.C.news.min} minutes to that day's time allowed</p>
      <h4 style="margin:4px 0 0">Week of ${label(wk)}</h4><div class="scroll"><table class="dt"><tr><th>Day</th><th>Driver</th><th>EOD</th><th>Newspapers</th></tr>${ws.sort((a, b) => a.day.localeCompare(b.day)).map(s => { const e = S.eodBy[s.id]; return `<tr class="clk" data-dayof="${s.driver}|${s.day}"><td>${label(s.day)}</td><td>${esc(nm(s.driver))}</td><td>${e ? `${fmtTime(e.sent_at)}` : "<span class='meta'>not in</span>"}</td><td>${e?.newspapers ? pill("✓ claimed", "ok") : e ? pill("no", "grey") : ""}</td></tr>`; }).join("") || `<tr><td colspan="4" class="empty">Not rostered this week.</td></tr>`}</table></div>
      <h4 style="margin:4px 0 0">History</h4><div class="scroll"><table class="dt"><tr><th>Week of</th><th>Claimed</th><th>By</th><th>Runs that week</th></tr>${hist.map(x => `<tr class="clk" data-news="${code}" data-mwk="${x.w}"><td>${label(x.w)}</td><td>${x.hit ? pill("✓ " + label(x.hit.s.day).slice(0, 6), "ok") : x.sh.length ? pill("not claimed", x.w < monOf(today()) ? "crit" : "grey") : "<span class='meta'>—</span>"}</td><td>${x.hit ? esc(fnm(x.hit.s.driver)) : ""}</td><td class="meta">${x.sh.length}</td></tr>`).join("")}</table></div>`;
  });
}

/* ================= Receivers & pick-ups (tasks on a shift) ================= */
export function openTask(shiftId, ruleId) {
  open(() => {
    const s = S.shifts.find(x => x.id === shiftId); if (!s) return `<h3>Shift not found</h3>`; const n = nzNow();
    const tasks = (s.addons || []).map(a => S.addons.find(x => x.id === a)).filter(a => a?.task);
    const rules = S.rules.filter(r => { if (!r.active || !r.days.includes(dow(s.day) + 1)) return false; const all = r.runs.includes("ALL"); if (!all && !r.runs.includes(s.run)) return false; const ad = r.addon ? S.addons.find(a => a.id === r.addon) : null; if (ad && ad.runs.includes(s.run)) return (s.addons || []).includes(r.addon); return all || r.runs.length === 1; });
    const rowFor = (a, r) => { const done = s.done?.[a?.id || r?.addon]; const plan = s.plan?.[a?.id || r?.addon]; const closes = r ? toMin(r.closes) : null; const opens = r ? toMin(r.opens) : null; const past = s.day < n.date || (s.day === n.date && closes != null && n.min > closes); const st = done ? ["ok", `done ${fmtTime(done)}`] : past && closes != null ? ["miss", `missed · due ${fmtT(closes)}`] : plan ? ["due", `planned ~${fmtT(toMin(plan))}`] : ["over", "no plan yet"]; const key = a?.id || r?.addon; return `<tr class="${r && ruleId === r.id ? "c-accent" : ""}"><td><b>${esc(r?.name || a?.name)}</b>${r?.note ? `<div class="meta">${esc(r.note)}</div>` : ""}</td><td class="mono">${closes != null && opens != null ? `${fmtT(opens)}–${fmtT(closes)}` : closes != null ? `by ${fmtT(closes)}` : opens != null ? `from ${fmtT(opens)}` : "any time"}</td><td class="mono">${plan ? fmtT(toMin(plan)) : "—"}</td><td><span class="chip ${st[0]}">${st[1]}</span>${!done && key && S.me.can("roster") ? ` <button class="btn ghost sm" data-mark-done="${s.id}|${esc(key)}">Mark done</button>` : ""}</td></tr>`; };
    const seen = new Set(); const rows = []; for (const r of rules) { seen.add(r.addon); rows.push(rowFor(S.addons.find(a => a.id === r.addon), r)); } for (const a of tasks) if (!seen.has(a.id)) rows.push(rowFor(a, null));
    const since = addDays(s.day, -28); const hist = S.shifts.filter(x => x.run === s.run && x.driver && x.day >= since && x.day < s.day && (x.addons || []).some(a => S.addons.find(z => z.id === a)?.task)).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 20);
    return `<h3>${esc(s.run)} · ${esc(nm(s.driver))} · ${label(s.day)}</h3><p class="meta">Game plan = the driver's planned times for each task · Done = when they tapped it in the app</p>
      <div class="scroll"><table class="dt"><tr><th>Task</th><th>Window</th><th>Planned</th><th>Status</th></tr>${rows.join("") || `<tr><td colspan="4" class="empty">No timed tasks on this shift.</td></tr>`}</table></div>
      <div class="row"><button class="btn ghost sm" data-dayof="${s.driver}|${s.day}">${esc(first(nm(s.driver)))}'s day</button><button class="btn ghost sm" data-driver="${s.driver}">Driver sheet</button></div>
      <h4 style="margin:4px 0 0">Last 4 weeks on ${esc(s.run)}</h4><div class="scroll"><table class="dt"><tr><th>Day</th><th>Driver</th><th>Tasks</th></tr>${hist.map(x => `<tr class="clk" data-task="${x.id}"><td>${label(x.day)}</td><td>${esc(fnm(x.driver))}</td><td><span class="row" style="gap:3px">${(x.addons || []).map(a => S.addons.find(z => z.id === a)).filter(a => a?.task).map(a => { const done = x.done?.[a.id]; const r = S.rules.find(z => z.addon === a.id && z.active); const closes = r ? toMin(r.closes) : null; return `<span class="chip ${done ? "ok" : closes != null ? "miss" : "due"}">${esc(a.short || a.name)}${done ? ` ✓ ${fmtTime(done)}` : closes != null ? " ✗" : ""}</span>`; }).join("")}</span></td></tr>`).join("") || `<tr><td colspan="3" class="meta">No earlier shifts with tasks.</td></tr>`}</table></div>`;
  }, null, { wide: true });
}

/* ================= Alerts ================= */
export function openAlert(a) {
  open(() => {
    const sh = a.shift_id ? S.shifts.find(x => x.id === a.shift_id) : null; const rule = a.rule_id ? S.rules.find(r => r.id === a.rule_id) : null; const day = sh?.day || a.created_at.slice(0, 10);
    const hist = S.alerts.filter(x => x.id !== a.id && x.driver && x.driver === a.driver).slice(0, 12);
    return `<h3>${esc(a.title)}</h3><p class="meta">${esc(String(a.kind).replace(/_/g, " "))} · ${fmtTs(a.created_at)} (${ago(a.created_at)})${a.resolved_at ? ` · resolved ${fmtTs(a.resolved_at)}${a.resolved_by ? " by " + esc(fnm(a.resolved_by)) : ""}` : ""}</p>
      ${a.body ? `<p>${esc(a.body)}</p>` : ""}
      <dl class="kv">${a.driver ? `<dt>Driver</dt><dd>${drvName(a.driver)}</dd>` : ""}${sh ? `<dt>Shift</dt><dd>${esc(sh.run)} · ${dayBtn(sh.driver, sh.day)} · ${fmtT(segTimes(sh, S.runsBy).st)}–${fmtT(segTimes(sh, S.runsBy).en)}</dd>` : ""}${rule ? `<dt>Rule</dt><dd>${esc(rule.name)} · ${rule.closes ? "by " + fmtT(toMin(rule.closes)) : rule.opens ? "from " + fmtT(toMin(rule.opens)) : ""}</dd>` : ""}<dt>Status</dt><dd>${a.resolved_at ? pill("resolved", "grey") : pill("open", "crit")}</dd></dl>
      <div class="row">${!a.resolved_at && S.me.can("alerts") ? `<button class="btn sm" data-resolve="${a.id}">Resolve</button>` : ""}${a.driver ? `<button class="btn ghost sm" data-dayof="${a.driver}|${day}">${esc(fnm(a.driver))}'s ${label(day)}</button>` : ""}${sh ? `<button class="btn ghost sm" data-task="${sh.id}" ${rule ? `data-rule="${rule.id}"` : ""}>Tasks on that shift</button>` : ""}</div>
      ${hist.length ? `<h4 style="margin:4px 0 0">Other alerts for ${esc(fnm(a.driver))}</h4><div class="list">${hist.map(alertLine).join("")}</div>` : ""}`;
  });
}

/* ================= Vans ================= */
export function openVan(plate) {
  open(() => {
    const v = S.vansBy[plate]; if (!v) return `<h3>${esc(plate)}</h3><p class="meta">Not in the fleet list.</p>`; const t = today(); const R = S.C.rules; const wk = monOf(t);
    const dd = d => d ? Math.round((new Date(d) - new Date(t)) / 86400000) : null; const st = d => { const n = dd(d); return n == null ? pill("not set", "grey") : n < 0 ? pill("overdue", "crit") : n <= R.dueSoonDays ? pill(`due in ${n}d`, "warn") : pill("✓", "ok"); };
    const checks = S.vchk.filter(c => c.van === plate).sort((a, b) => b.at.localeCompare(a.at)); const odo = checks[0]?.odometer && (!v.odometer_at || checks[0].at.slice(0, 10) >= v.odometer_at) ? checks[0].odometer : v.odometer; const left = v.ruc_paid_to && odo ? v.ruc_paid_to - odo : null;
    const use = S.shifts.filter(s => s.van === plate && s.driver && s.day >= addDays(wk, -7) && s.day <= addDays(wk, 13)).sort((a, b) => a.day.localeCompare(b.day));
    return `<h3><span class="plate">${esc(plate)}</span> ${esc(v.model || "")}</h3><p class="meta">${esc([v.make, v.colour].filter(Boolean).join(" · "))}${v.active ? "" : " · inactive"}</p>
      <dl class="kv"><dt>WOF</dt><dd>${v.wof_due ? label(v.wof_due, true) + " " : ""}${v.wof_failed ? pill("failed", "crit") : st(v.wof_due)}</dd><dt>Rego</dt><dd>${v.rego_due ? label(v.rego_due, true) + " " : ""}${st(v.rego_due)}</dd><dt>RUCs</dt><dd>${v.no_ruc ? "petrol, no RUCs" : v.ruc_paid_to ? `paid to ${v.ruc_paid_to.toLocaleString()} km${left != null ? ` · ${left.toLocaleString()} km left ${left <= 0 ? pill("overdue", "crit") : left <= R.rucSoonKm ? pill("low", "warn") : pill("✓", "ok")}` : ""}` : pill("not set", "grey")}</dd><dt>Odometer</dt><dd>${odo ? `${odo.toLocaleString()} km` : "—"}${checks[0]?.odometer ? ` <span class="meta">(check ${label(checks[0].at.slice(0, 10))})</span>` : ""}</dd><dt>Service</dt><dd>${v.service_due_km ? `${v.service_due_km.toLocaleString()} km` : checks.find(c => c.service_due)?.service_due ? esc(checks.find(c => c.service_due).service_due) : "—"}</dd><dt>Responsible</dt><dd>${v.responsible ? drvName(v.responsible) : "<span class='meta'>main driver</span>"}</dd></dl>
      <div class="row">${S.me.can("fleet") ? `<button class="btn ghost sm" data-van-edit="${esc(plate)}">Edit van</button>` : ""}<button class="btn ghost sm" data-tab-go="fleet">Fleet tab</button></div>
      <h4 style="margin:4px 0 0">Weekly checks</h4><div class="scroll"><table class="dt"><tr><th>Week of</th><th>By</th><th>Sent</th><th>Odometer</th><th>RUCs left</th><th>Flags</th></tr>${checks.slice(0, 10).map(c => `<tr class="clk" data-vchk="${c.id}"><td>${label(c.week_start)}</td><td>${esc(fnm(c.driver))}</td><td class="mono">${fmtTs(c.at)}</td><td class="num">${c.odometer?.toLocaleString() || "—"}</td><td class="num">${c.rucs_left?.toLocaleString() || "—"}</td><td class="meta">${[c.washed ? "" : "not washed", c.tyres_ok ? "" : "tyres", c.vault_ok ? "" : "vault", c.bodywork && !/^ok/i.test(c.bodywork) ? "bodywork" : "", (c.photos || []).length ? `${c.photos.length} photo${c.photos.length === 1 ? "" : "s"}` : "no photos"].filter(Boolean).join(" · ")}</td></tr>`).join("") || `<tr><td colspan="6" class="meta">No checks recorded.</td></tr>`}</table></div>
      <h4 style="margin:4px 0 0">On the roster</h4><div class="scroll"><table class="dt"><tr><th>Day</th><th>Run</th><th>Driver</th><th>Times</th></tr>${use.map(s => { const { st: a, en } = segTimes(s, S.runsBy); return `<tr class="clk ${s.day === t ? "c-accent" : ""}" data-dayof="${s.driver}|${s.day}"><td>${label(s.day)}</td><td>${esc(s.run)}</td><td>${esc(nm(s.driver))}</td><td class="mono">${fmtT(a)}–${fmtT(en)}</td></tr>`; }).join("") || `<tr><td colspan="4" class="meta">Not rostered these weeks.</td></tr>`}</table></div>`;
  }, null, { wide: true });
}
export function checkSheet(c) {
  open(() => `<h3>${esc(c.van)} · ${esc(nm(c.driver))}</h3><p class="meta">Week of ${label(c.week_start)} · sent ${fmtTs(c.at)}</p><dl class="kv"><dt>Odometer</dt><dd>${c.odometer?.toLocaleString() || "—"} km</dd><dt>RUCs left</dt><dd>${c.rucs_left?.toLocaleString() || "—"}</dd><dt>Washed</dt><dd>${c.washed ? "Yes" : "No"}</dd><dt>Tyres</dt><dd>${c.tyres_ok ? "OK" : "Check"}</dd><dt>Vault</dt><dd>${c.vault_ok ? "OK" : "Check"}</dd><dt>Bodywork</dt><dd>${esc(c.bodywork || "—")}</dd><dt>Service</dt><dd>${esc(c.service_due || "—")}</dd><dt>Notes</dt><dd>${esc(c.notes || "—")}</dd></dl><div class="row" id="photos"><span class="meta">${(c.photos || []).length ? "Loading photos…" : "No photos"}</span></div><div class="row"><button class="btn ghost sm" data-vanof="${esc(c.van)}">Van history</button><button class="btn ghost sm" data-driver="${c.driver}">${esc(fnm(c.driver))}'s sheet</button></div>`,
    async bg => { const urls = []; for (const p of c.photos || []) { const { data } = await sb.storage.from("vchk").createSignedUrl(p, 3600); if (data) urls.push(data.signedUrl); } const el = bg.querySelector("#photos"); if (el && urls.length) el.innerHTML = urls.map(u => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="vehicle check photo" style="width:140px;height:140px;object-fit:cover;border-radius:8px"></a>`).join(""); });
}

/* ================= Roster changes for one driver ================= */
export function openChanges(id) {
  open(() => {
    const n = nzNow(); const ackOf = {}; for (const a of S.acks) (ackOf[a.item_id] ??= {})[a.driver] = a;
    const items = S.items.filter(i => i.affects.includes(id) && i.roster_changes.status !== "rejected").sort((a, b) => (b.roster_changes.sent_at || b.roster_changes.created_at).localeCompare(a.roster_changes.sent_at || a.roster_changes.created_at)).slice(0, 60);
    const waiting = items.filter(i => i.roster_changes.status === "sent" && i.day >= n.date && !ackOf[i.id]?.[id]?.confirmed_at && !ackOf[i.id]?.[id]?.dismissed_at);
    const line = i => { const a = ackOf[i.id]?.[id]; const past = i.day < n.date; return `<div class="item ${a?.confirmed_at ? "ok done" : a?.dismissed_at ? "done" : past ? "done" : "crit"}"><div class="row" style="justify-content:space-between;align-items:flex-start"><div>${esc(i.summary)}<div class="meta">sent ${fmtTs(i.roster_changes.sent_at || i.roster_changes.created_at)} by ${esc(fnm(i.roster_changes.created_by))}${i.roster_changes.status !== "sent" ? ` · ${esc(i.roster_changes.status)}` : ""}</div></div><span style="flex:0;white-space:nowrap">${a?.confirmed_at ? `<span class="chip ok">✓ ${a.confirmed_by ? "by " + esc(fnm(a.confirmed_by)) : fmtTs(a.confirmed_at)}</span>` : a?.dismissed_at ? `<span class="chip exc">dismissed</span>` : past ? `<span class="chip due">never confirmed</span>` : `<span class="chip over">waiting${a?.seen_at ? " · seen" : ""}</span>`}</span></div></div>`; };
    return `<h3>Roster changes · ${esc(nm(id))}</h3><p class="meta">${waiting.length ? `${waiting.length} waiting to be confirmed` : "nothing waiting"} · last ${items.length} lines</p>
      ${waiting.length ? `<div class="row"><button class="btn sm" data-ack="ok" data-drv="${id}" data-items="${waiting.map(i => i.id).join(",")}">✓ Confirm all for them</button><button class="btn sm ghost" data-ack="dis" data-drv="${id}" data-items="${waiting.map(i => i.id).join(",")}">Dismiss all</button><button class="btn ghost sm" data-driver="${id}">Driver sheet</button></div>` : `<div class="row"><button class="btn ghost sm" data-driver="${id}">Driver sheet</button></div>`}
      <div class="list">${items.map(line).join("") || `<p class="empty">No roster changes sent to ${esc(fnm(id))}.</p>`}</div>`;
  });
}

/* ================= Entries, leave, messages, people ================= */
export function openEntry(e) {
  open(() => `<h3>${esc(({ mistake: "Mistake", praise: "Praise", issue: "Went wrong", note: "Note", adjust: "Admin points", safety: "Safety", eff: "Efficiency set" })[e.kind] || e.kind)} · ${esc(nm(e.driver))}</h3><p class="meta">${label(e.day, true)}${e.run ? ` · ${esc(e.run)}` : ""} · entered ${fmtTs(e.created_at)}${e.created_by ? " by " + esc(fnm(e.created_by)) : ""}</p>
    <p><b>${esc(e.title)}</b></p>${e.note ? `<p>${esc(e.note)}</p>` : ""}
    <dl class="kv">${e.admin_pts ? `<dt>Admin</dt><dd>${e.admin_pts > 0 ? "+" : ""}${e.admin_pts} points</dd>` : ""}${e.safety_pct != null ? `<dt>Safety</dt><dd>${e.safety_pct}%</dd>` : ""}${e.eff_pct != null ? `<dt>Efficiency</dt><dd>${e.eff_pct}% (replaces the day)</dd>` : ""}<dt>Shown to driver</dt><dd>${e.show_driver ? (e.seen_at ? `Yes · viewed ${fmtTs(e.seen_at)}` : "Yes · <span class='c-warn'>not viewed yet</span>") : "No"}</dd>${e.excused ? `<dt>Status</dt><dd>${pill("removed — doesn't count", "grey")}</dd>` : ""}</dl>
    <div class="row"><button class="btn ghost sm" data-dayof="${e.driver}|${e.day}">That day</button><button class="btn ghost sm" data-driver="${e.driver}">Driver sheet</button>${S.me.can("scorecard") && !e.excused && e.kind === "mistake" ? `<button class="btn ghost sm" id="rm-entry">Remove (doesn't count)</button>` : ""}${S.me.can("scorecard") ? `<button class="btn ghost sm crit" id="del-entry">Delete</button>` : ""}</div>`,
    (bg, close) => { bg.querySelector("#rm-entry")?.addEventListener("click", async () => { await q(sb.from("entries").update({ excused: true }).eq("id", e.id)); close(); toast("Removed", "ok"); }); bg.querySelector("#del-entry")?.addEventListener("click", async () => { if (!confirm("Delete this entry?")) return; await q(sb.from("entries").delete().eq("id", e.id)); close(); toast("Deleted", "ok"); }); });
}
const LEAVE_T = { annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave", bereave: "Bereavement leave", dayoff: "Day off request", other: "Other" };
export function openLeave(l) {
  open(() => { const days = []; for (let d = l.date_from; d <= l.date_to && days.length < 31; d = addDays(d, 1)) days.push(d); const clash = S.shifts.filter(s => s.driver === l.driver && days.includes(s.day));
    return `<h3>${esc(LEAVE_T[l.type] || l.type)} · ${esc(nm(l.driver))}</h3><p class="meta">${label(l.date_from, true)}${l.date_to !== l.date_from ? ` – ${label(l.date_to, true)}` : ""}${l.part !== "full" ? ` · ${l.part === "AM" ? "morning off" : "afternoon off"}` : ""} · asked ${fmtTs(l.created_at)}</p>
    <dl class="kv"><dt>Status</dt><dd>${pill(l.status, l.status === "approved" ? "ok" : l.status === "declined" ? "crit" : l.status === "pending" ? "warn" : "grey")}${l.decided_at ? ` <span class="meta">${fmtTs(l.decided_at)}${l.decided_by ? " by " + esc(fnm(l.decided_by)) : ""}</span>` : ""}</dd>${l.notes ? `<dt>Note</dt><dd>${esc(l.notes)}</dd>` : ""}${l.reply ? `<dt>Reply</dt><dd>${esc(l.reply)}</dd>` : ""}<dt>Received email</dt><dd>${l.acked_email_at ? fmtTs(l.acked_email_at) : "not yet"}</dd></dl>
    ${clash.length ? `<h4 style="margin:4px 0 0">Rostered on those days</h4><div class="list">${clash.map(s => `<div class="item clk ${l.status === "approved" ? "crit" : "warn"}" data-dayof="${s.driver}|${s.day}">${label(s.day)} · ${esc(s.run)} ${fmtT(segTimes(s, S.runsBy).st)}–${fmtT(segTimes(s, S.runsBy).en)}</div>`).join("")}</div>` : `<p class="meta">Not rostered on those days.</p>`}
    <div class="row"><button class="btn ghost sm" data-driver="${l.driver}">Driver sheet</button><button class="btn ghost sm" data-tab-go="leave">Leave tab</button></div>`; });
}
export function openMessage(m) {
  open(() => { const rs = S.recips.filter(r => r.message_id === m.id); return `<h3>Message · ${fmtTs(m.created_at)}</h3><p class="meta">from ${esc(nm(m.sender))} → ${rs.length} ${rs.length === 1 ? "person" : "people"}${m.needs_confirm ? " · asked for Got it" : ""}</p><pre class="msg">${esc(m.body)}</pre>
    <div class="scroll"><table class="dt"><tr><th>To</th><th>Read</th><th>Confirmed</th></tr>${rs.map(r => `<tr class="clk" data-driver="${r.person}"><td>${esc(nm(r.person))}</td><td>${r.read_at ? `<span class="c-ok">✓ ${fmtTs(r.read_at)}</span>` : "<span class='meta'>not yet</span>"}</td><td>${r.confirmed_at ? `<span class="c-ok">✓✓ ${fmtTs(r.confirmed_at)}</span>` : m.needs_confirm ? "<span class='c-warn'>waiting</span>" : ""}</td></tr>`).join("")}</table></div>`; });
}
export function openPerson(id) {
  const p = S.peopleBy[id]; if (!p) return;
  if (p.role === "driver" && !(p.perms || []).length) return import("/admin/scorecard.js").then(m => m.driverSheet(id));
  open(() => `<h3>${esc(p.name)}</h3><p class="meta">${esc(p.role)}${p.email ? ` · ${esc(p.email)}` : ""}${p.phone ? ` · ${esc(p.phone)}` : ""}</p><dl class="kv"><dt>Areas</dt><dd>${(p.perms || []).join(", ") || (p.role === "owner" ? "everything" : "—")}</dd><dt>Signed in</dt><dd>${p.user_id ? "yes" : "never"}</dd><dt>Active</dt><dd>${p.active ? "yes" : "paused"}</dd>${p.started ? `<dt>Started</dt><dd>${label(p.started, true)}</dd>` : ""}${p.notes ? `<dt>Notes</dt><dd>${esc(p.notes)}</dd>` : ""}</dl><div class="row">${S.me.can("people") ? `<button class="btn ghost sm" data-person-edit="${id}">Edit</button>` : ""}${S.shifts.some(s => s.driver === id) ? `<button class="btn ghost sm" data-driver="${id}">Driver sheet</button>` : ""}</div>`);
}

/* ================= Routing: important points & live feed ================= */
export function openImportant(p) {
  const sig = p.sig || ""; const parts = sig.split("|");
  if (sig.startsWith("alert|")) { const a = S.alerts.find(x => x.dedupe_key === parts.slice(1).join("|")); return a ? openAlert(a) : toast("That alert has cleared", ""); }
  if (sig.startsWith("vchk|")) return openVan(parts[2]);
  if (sig.startsWith("news|")) return openNews(parts[2], parts[1]);
  if (parts[1] === "ntc") return openChanges(parts[0]);
  if (S.vansBy[parts[0]]) return openVan(parts[0]);
  if (S.peopleBy[parts[0]]) { if (parts.length === 3 && /^\d{4}-\d{2}-\d{2}$/.test(parts[2])) return openDay(parts[0], parts[2]); if (["admin", "eff", "acc"].includes(parts[1])) return import("/admin/scorecard.js").then(m => m.driverSheet(parts[0], monOf(today()), addDays(monOf(today()), 6))); return import("/admin/scorecard.js").then(m => m.driverSheet(parts[0])); }
  toast("No more detail for this one", "");
}
export function openFeed(g) {
  if (g.k === "item") return import("/admin/scorecard.js").then(m => m.itemSheet(g.key));
  if (g.k === "day") return openDay(g.d, g.day);
  if (g.k === "alert") { const a = S.alerts.find(x => x.id === g.id); return a && openAlert(a); }
  if (g.k === "vchk") { const c = S.vchk.find(x => x.id === g.id); return c && checkSheet(c); }
  if (g.k === "changes") return openChanges(g.d);
  if (g.k === "leave") { const l = S.leave.find(x => x.id === g.id); return l && openLeave(l); }
  if (g.k === "msg") { const m = S.msgs.find(x => x.id === g.id); return m && openMessage(m); }
  if (g.k === "driver") return import("/admin/scorecard.js").then(m => m.driverSheet(g.d));
}
/** item key for a shift's SOD or EOD, matching how the score engine names it */
export function itemKeyFor(shift, kind) {
  const s = scoreFor(shift.driver, shift.day, shift.day, scoreData(), S.C); const it = s.items.find(i => i.kind === kind && (kind === "SOD" || i.shift.id === shift.id)) || s.items.find(i => i.kind === kind); return it?.key || null;
}
