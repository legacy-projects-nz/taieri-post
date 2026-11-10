// Wages sub-tab (Scorecard → Wages): hours per driver for a pay fortnight, a running total day by day,
// and a downloadable Excel report (Summary + Daily sheets). Hours use the same rule as Labour:
// actual = SOD → last EOD; where a post is missing the figure is estimated (flagged).
// Jeremy (pay_exclude) is left out.
import { addDays, label, fmtT, toMin, nzNow, today, esc, $, toast } from "/shared/core.js";
import { fortnight, sodStart } from "/shared/score.js";
import { S, render } from "/admin/admin.js";
import { driverDay } from "/admin/live.js";

let wf = null; // selected fortnight start
const r1 = n => Math.round(n * 100) / 100;
const hm = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };

function build(from) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(from, i)); const t = today();
  const staff = S.drivers.filter(d => !d.pay_exclude);
  const rows = staff.map(drv => {
    let run = 0, act = 0, est = 0, n = 0; const daily = [];
    for (const d of days) {
      const r = driverDay(drv, d); if (!r) continue;
      if (d > t && !r.holiday) continue;                      // future days: not worked yet
      const hrs = r.act ?? r.actEst ?? r.exp ?? 0; if (!hrs) continue;
      const isEst = r.act == null && !r.holiday; run += hrs; n++; if (isEst) est += hrs; else act += hrs;
      const sod = r.sod ? sodStart(r.sod, r.D?.start, S.C) : null; const lastE = r.eods?.[r.eods.length - 1];
      const fin = lastE ? (lastE.finish_time ? toMin(lastE.finish_time) : nzNow(new Date(lastE.sent_at)).min) : null;
      daily.push({ d, hrs, isEst, how: r.holiday ? `Public holiday (${r.hol?.name || ""})` : r.actHow, sod, fin, brk: r.brk || 0, run, runs: (r.D?.segs || []).map(x => x.shift.run).join(" + ") });
    }
    const rate = +(drv.rate || S.C.rules.hourRate || 0);
    return { drv, daily, total: run, act, est, n, rate, gross: run * rate, byDay: Object.fromEntries(daily.map(x => [x.d, x])) };
  }).filter(x => x.n);
  return { days, rows };
}

export function wagesView() {
  const F = fortnight(wf || S.week); wf = F.from; const { days, rows } = build(F.from);
  const tot = rows.reduce((a, r) => a + r.total, 0), totEst = rows.reduce((a, r) => a + r.est, 0), gross = rows.reduce((a, r) => a + r.gross, 0);
  const cell = x => x ? `<span class="${x.isEst ? "c-warn" : ""}" title="${esc(x.how)} · running ${hm(x.run)}">${x.isEst ? "≈" : ""}${x.hrs.toFixed(1)}</span>` : `<span class="meta">·</span>`;
  return `<div class="card"><h2>Wages<span>pay fortnight ${label(F.from)} – ${label(F.to, true)} · hours from SOD → EOD less unpaid breaks · <span class="c-warn">≈ estimated</span> where a post is missing · excludes Jeremy</span></h2>
    <div class="row"><button class="btn ghost sm" id="wg-prev">‹ Previous</button><button class="btn ghost sm" id="wg-next">Next ›</button><button class="btn sm" id="wg-xlsx" style="flex:0 0 auto">Download wages report (Excel)</button></div>
    <div class="tiles"><div class="tile"><div class="l">Hours so far · fortnight</div><div class="v">${tot.toFixed(1)} h</div><div class="s">${totEst ? `<span class="c-warn">≈${totEst.toFixed(1)} h estimated</span>` : "all from SOD → EOD"}</div></div><div class="tile"><div class="l">Gross wages so far</div><div class="v">$${Math.round(gross).toLocaleString()}</div><div class="s">hours × each driver's rate (NZD)</div></div></div>
    <div class="scroll"><table class="dt"><tr><th>Driver</th>${days.map(d => `<th>${label(d).slice(0, 6)}</th>`).join("")}<th>Total h</th><th>Rate</th><th>Gross</th></tr>
    ${rows.map(r => `<tr><td><b>${esc(r.drv.name)}</b></td>${days.map(d => `<td class="num">${cell(r.byDay[d])}</td>`).join("")}<td class="num"><b>${r.total.toFixed(2)}</b>${r.est ? ` <span class="c-warn">(≈${r.est.toFixed(1)})</span>` : ""}</td><td class="num">$${r.rate.toFixed(2)}</td><td class="num">$${r.gross.toFixed(2)}</td></tr>`).join("") || `<tr><td colspan="18" class="meta">No hours logged in this fortnight yet.</td></tr>`}
    </table></div><p class="hint">The totals build up day by day as SODs and EODs come in. The Excel file has a Summary sheet and a Daily sheet with each day's start, finish, unpaid breaks (already taken off the hours) and the running total for each driver.</p></div>`;
}

async function sheetjs() { if (window.XLSX) return window.XLSX; await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); return window.XLSX; }

async function download() {
  const F = fortnight(wf); const { days, rows } = build(F.from); const X = await sheetjs();
  const sum = [["Taieri Post wages report", `${label(F.from, true)} to ${label(F.to, true)}`], [],
    ["Driver", "Days worked", "Hours (SOD → EOD, less unpaid breaks)", "Hours estimated", "Total hours", "Rate (NZD/h)", "Gross (NZD)", ...days.map(d => label(d).slice(0, 6))]];
  for (const r of rows) sum.push([r.drv.name, r.n, r1(r.act), r1(r.est), r1(r.total), r.rate, r1(r.gross), ...days.map(d => r.byDay[d] ? r1(r.byDay[d].hrs) : "")]);
  sum.push([], ["Total", rows.reduce((a, r) => a + r.n, 0), r1(rows.reduce((a, r) => a + r.act, 0)), r1(rows.reduce((a, r) => a + r.est, 0)), r1(rows.reduce((a, r) => a + r.total, 0)), "", r1(rows.reduce((a, r) => a + r.gross, 0))]);
  const det = [["Driver", "Date", "Runs", "Start (SOD)", "Finish (EOD)", "Unpaid breaks (min)", "Hours", "Estimated?", "How worked out", "Running total (h)"]];
  for (const r of rows) for (const x of r.daily) det.push([r.drv.name, x.d, x.runs, x.sod != null ? fmtT(x.sod) : "", x.fin != null ? fmtT(x.fin) : "", x.brk || "", r1(x.hrs), x.isEst ? "Yes" : "", x.how, r1(x.run)]);
  const wb = X.utils.book_new(); const s1 = X.utils.aoa_to_sheet(sum), s2 = X.utils.aoa_to_sheet(det);
  s1["!cols"] = [{ wch: 22 }, { wch: 11 }, { wch: 17 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, ...days.map(() => ({ wch: 8 }))];
  s2["!cols"] = [{ wch: 22 }, { wch: 11 }, { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 34 }, { wch: 16 }];
  X.utils.book_append_sheet(wb, s1, "Summary"); X.utils.book_append_sheet(wb, s2, "Daily");
  X.writeFile(wb, `Taieri Post wages ${F.from} to ${F.to}.xlsx`);
}

export function wireWages() {
  $("#wg-prev")?.addEventListener("click", () => { wf = addDays(wf, -14); render(); });
  $("#wg-next")?.addEventListener("click", () => { wf = addDays(wf, 14); render(); });
  $("#wg-xlsx")?.addEventListener("click", async e => { e.target.disabled = true; try { await download(); } catch (err) { toast("Couldn't build the file: " + err.message, "err"); } e.target.disabled = false; });
}
