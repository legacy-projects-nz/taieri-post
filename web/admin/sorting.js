// Scorecard › Sorting: every sort shift's actual time against its expected (rostered) time, with the parcels and trays of the runs it sorted for.
// Actual = from the driver's SOD (or the tap that started the sort) to the ▶ Start tap of their run; falls back to the sorting minutes typed on the EOD.
// The team sorter (earliest on that sort that day) covers the whole set of runs (rules.sortCovers); anyone else on the sort covers their own next run.
// Once a sorter has 3+ tracked days, their minutes-per-parcel gives a volume-based expected time to firm the rostered one up.
import { nzNow, today, addDays, label, fmtT, esc } from "/shared/core.js";
import { sodStart, dayShifts, effCalc, ownerBreakHrs } from "/shared/score.js";
import { S, nm, weekBar } from "/admin/admin.js";

const COVERS = () => ({ SUP: ["RAM", "TUA", "FLY"], SUP3: ["PCB", "RSB"], ...(S.C.rules.sortCovers || {}) });
const at = ts => ts ? nzNow(new Date(ts)).min : null;
const hm = m => m == null ? "—" : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;

/** One row per sort shift on `day`. */
export function sortRows(day) {
  const shifts = S.shifts.filter(s => s.day === day && s.driver && s.run !== "BU"); const rows = [];
  for (const drv of new Set(shifts.map(s => s.driver))) { const D = dayShifts(shifts.filter(s => s.driver === drv), S.runsBy, drv)[day]; if (!D) continue;
    const sod = D.segs.map(x => S.sodBy[x.shift.id]).find(Boolean);
    D.segs.forEach((x, i) => { if (!x.sort) return; const nx = D.segs.slice(i + 1).find(y => !y.sort);
      const exp = Math.max(0, (x.en ?? x.st) - x.st);
      const st = at(x.shift.sor_at) ?? (i === 0 && sod ? sodStart(sod, D.start, S.C) : null);
      const en = at(x.shift.eor_at) ?? (nx ? at(nx.shift.sor_at) : null);
      const e = nx ? S.eodBy[nx.shift.id] : null; const typed = e?.extra?.sort_tap ?? e?.sort_min ?? null;
      let act = st != null && en != null && en > st ? en - st : null, how = act != null ? "taps" : null;
      if (act == null && typed != null) { act = +typed; how = "typed on EOD"; }
      // the delivery side of the same day: the run that follows this sort, on its own expected and actual (from the efficiency formula)
      let run = null; if (nx) { try { const c = effCalc(nx, e, S.ovs?.find(o => o.shift_id === nx.shift.id), S.C, S.runsBy, { sodMin: D.segs.indexOf(nx) === 0 && sod ? sodStart(sod, D.start, S.C) : (i === 0 && sod ? sodStart(sod, D.start, S.C) : null), brk: ownerBreakHrs(S.breaks, nx.shift, !!S.peopleBy?.[drv]?.pay_exclude) }); if (c) run = { exp: c.allowed, act: c.takenTrk != null && e ? c.takenTrk * 60 : null, est: c.est }; } catch { /* leave the delivery columns blank */ } }
      rows.push({ day, drv, code: x.shift.run, x, nx, exp, act, how, st, en, run }); }); }
  // who is the team sorter on each sort that day: the earliest start
  const C = COVERS(); const lead = {}; for (const r of rows) if (C[r.code] && (!lead[r.code] || r.x.st < lead[r.code].x.st)) lead[r.code] = r;
  for (const r of rows) { r.team = lead[r.code] === r; r.runs = r.team ? C[r.code] : r.nx ? [r.nx.shift.run] : [];
    const cov = shifts.filter(s => r.runs.includes(s.run) && (r.team || s.driver === r.drv)); r.nRuns = cov.length; r.nIn = 0; r.parcels = 0; r.trays = 0;
    for (const s of cov) { const e = S.eodBy[s.id], ov = S.ovs?.find(o => o.shift_id === s.id); const p = ov?.parcels ?? e?.parcels; if (p != null) { r.nIn++; r.parcels += +p; r.trays += +(ov?.trays ?? e?.trays ?? 0); } }
    r.runsOn = [...new Set(cov.map(s => s.run))]; r.full = r.nRuns > 0 && r.nIn === r.nRuns; }
  return rows;
}
/** Minutes per parcel for each sorter + sort, from every fully-tracked day in the last 8 weeks. */
function rates() { const t = today(), since = addDays(t, -56); const acc = {};
  for (const day of [...new Set(S.shifts.filter(s => s.day >= since && s.day <= t && /^SUP/.test(s.run)).map(s => s.day))]) for (const r of sortRows(day)) {
    if (r.act == null || !r.full || !r.parcels) continue; const o = acc[r.drv + "|" + r.code + "|" + (r.team ? "team" : "own")] ??= { n: 0, act: 0, exp: 0, parcels: 0, drv: r.drv, code: r.code, team: r.team, runs: new Set() };
    o.n++; o.act += r.act; o.exp += r.exp; o.parcels += r.parcels; r.runsOn.forEach(c => o.runs.add(c)); }
  for (const o of Object.values(acc)) o.rate = o.act / o.parcels; return acc; }

export function sortingView() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(S.week, i)); const R = rates(); const rows = days.flatMap(sortRows).sort((a, b) => a.day.localeCompare(b.day) || a.x.st - b.x.st);
  const cls = (a, e) => a == null || !e ? "" : a <= e * 1.1 ? "c-ok" : a <= e * 1.25 ? "c-warn" : "c-crit";
  const tot = { exp: 0, act: 0 }; for (const r of rows) if (r.act != null) { tot.exp += r.exp; tot.act += r.act; }
  const body = rows.map(r => { const k = R[r.drv + "|" + r.code + "|" + (r.team ? "team" : "own")]; const vol = k && k.n >= 3 && r.full ? k.rate * r.parcels : null; const d = r.act != null ? r.act - r.exp : null;
    return `<tr><td>${label(r.day).slice(0, 6)}</td><td><b>${esc(nm(r.drv))}</b></td><td>${esc(r.code)}${r.team ? ` <span class="meta">team</span>` : ""}</td><td class="meta">${esc(r.runsOn.join(" + ") || r.runs.join(" + ") || "—")}</td>
      <td class="num">${hm(r.exp)}</td><td class="num ${cls(r.act, r.exp)}" title="${r.how === "taps" ? `${fmtT(r.st)}–${fmtT(r.en)}` : r.how || "no ▶ Start tap and no sorting minutes on the EOD"}">${r.act != null ? hm(r.act) + (r.how === "taps" ? "" : " *") : `<span class="meta">${r.day > today() ? "" : "not recorded"}</span>`}</td>
      <td class="num ${cls(r.act, r.exp)}">${d == null ? "" : (d > 0 ? "+" : "") + Math.round(d) + "m"}</td>
      <td class="num">${r.nIn ? r.parcels + (r.full ? "" : ` <span class="meta" title="${r.nIn} of ${r.nRuns} EODs in">…</span>`) : ""}</td><td class="num">${r.nIn && r.trays ? r.trays : ""}</td>
      <td class="num">${r.act != null && r.full && r.parcels ? (r.act / r.parcels).toFixed(2) : ""}</td><td class="num meta" title="This sorter's average minutes per parcel × the day's parcels">${vol != null ? hm(vol) : ""}</td>
      <td class="meta" style="border-left:1px solid var(--line, #333)">${r.nx ? esc(r.nx.shift.run) : ""}</td><td class="num">${r.run ? (r.run.est ? "≈" : "") + hm(r.run.exp) : ""}</td><td class="num ${r.run ? cls(r.run.act, r.run.exp) : ""}">${r.run?.act != null ? hm(r.run.act) : ""}</td></tr>`; }).join("");
  const sum = Object.values(R).sort((a, b) => nm(a.drv).localeCompare(nm(b.drv))).map(o => `<tr><td><b>${esc(nm(o.drv))}</b></td><td>${esc(o.code)}${o.team ? ` <span class="meta">team</span>` : ""}</td><td class="meta">${esc([...o.runs].join(" + "))}</td><td class="num">${o.n}</td><td class="num">${hm(o.exp / o.n)}</td><td class="num ${cls(o.act, o.exp)}">${hm(o.act / o.n)}</td><td class="num">${Math.round(o.parcels / o.n)}</td><td class="num">${o.rate.toFixed(2)}</td><td class="num">${o.n >= 3 ? hm(o.rate * o.parcels / o.n) : `<span class="meta">needs ${3 - o.n} more</span>`}</td></tr>`).join("");
  return `<div class="card"><h2>Sorting times<span>week of ${label(S.week)} · ${tot.act ? `${hm(tot.act)} actual vs ${hm(tot.exp)} expected on the sorts recorded` : "nothing recorded yet"}</span></h2>
    <p class="hint">Expected is the rostered sort. Actual runs from the driver's SOD to their <b>▶ Start</b> tap (* = the minutes typed on the EOD instead). Parcels and trays are the EOD totals of the runs that sort covered: the team sorter (earliest on that sort) gets all of them, anyone else gets their own run. Green = within 10% of expected, orange within 25%, red over. A driver who sorts and delivers has two expected times: the sort on the left, and their run on the right (the same figures as the Efficiency page).</p>
    <div class="scroll"><table class="dt"><tr><th>Day</th><th>Sorter</th><th>Sort</th><th>For runs</th><th>Expected</th><th>Actual</th><th>+/−</th><th>Parcels</th><th>Trays</th><th>Min / parcel</th><th>By volume</th><th>Then run</th><th>Run expected</th><th>Run actual</th></tr>${body || `<tr><td colspan="14" class="meta">No sort shifts this week.</td></tr>`}</table></div></div>
    <div class="card"><h2>Firming up the expected times<span>last 8 weeks · days with the sort recorded and every covered run's EOD in</span></h2>
    <p class="hint">Each sorter's average against their rostered time, and their minutes per parcel. From 3 tracked days, "By volume" above shows what that day's parcels should have taken at their own average, and "Suggested" is the sort length to roster for an average day.</p>
    <div class="scroll"><table class="dt"><tr><th>Sorter</th><th>Sort</th><th>For runs</th><th>Days</th><th>Avg expected</th><th>Avg actual</th><th>Avg parcels</th><th>Min / parcel</th><th>Suggested</th></tr>${sum || `<tr><td colspan="9" class="meta">No fully tracked sorts yet. They build up as drivers tap ▶ Start after sorting and the EODs come in.</td></tr>`}</table></div></div>`;
}
