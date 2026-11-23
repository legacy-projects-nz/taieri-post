// Allowances tab: back-up and on-call allowances, tracked as their own item.
// Each Back up (BU) slot on the Run Board becomes a line here. Amounts come from the rules; Jeremy marks what happened.
//   Not rostered that day            -> on-call phone window  $5   (if not needed)
//   Working, PM shift, non-compulsory     -> phone window          $5   (if not needed)
//   Working, committed, up to 5 h    -> back-up allowance     $10  (if not needed)
//   Working, committed, 6 to 10 h    -> back-up allowance     $20  (if not needed)
//   Working, AM shift, non-compulsory     -> no allowance (paid for hours worked only)
// Called in = paid for hours worked (timesheet), no allowance on top. Declined = no allowance.
import { sb, q, today, addDays, label, fmtT, esc, $$, toast, monOf } from "/shared/core.js";
import { segTimes, fortnight } from "/shared/score.js";
import { S, nm, render, loadAll } from "/admin/admin.js";

export const AMT = { phone: 5, block5: 10, block10: 20 };
const st = { outcomes: {}, week: null, loading: false };

export function lineFor(bu, shifts, runsBy) {
  const others = shifts.filter(x => x.day === bu.day && x.driver === bu.driver && x.run !== "BU");
  const works = others.length > 0;
  const starts = works ? Math.min(...others.map(x => segTimes(x, runsBy).st ?? 1e9)) : null;
  const pm = works && starts != null && starts >= 720;
  if (!works) return { kind: "On-call phone window", amt: AMT.phone, why: "Not rostered that day" };
  if (bu.bu_kind === "committed") return bu.bu_block === 10 ? { kind: "Committed back-up, over 5 to 10 h", amt: AMT.block10, why: "Working that day" } : { kind: "Committed back-up, up to 5 h", amt: AMT.block5, why: "Working that day" };
  if (pm) return { kind: "Phone window (PM shift)", amt: AMT.phone, why: "Non-compulsory back-up, shift starts after midday" };
  return { kind: "Non-compulsory back-up", amt: 0, why: "Paid for hours worked only" };
}

async function loadOutcomes() {
  const F = fortnight(S.week); if (st.week === F.from && !st.loading) return;
  st.loading = true; st.week = F.from;
  const { data, error } = await sb.from("allowance_outcomes").select("*").gte("day", F.from).lte("day", F.to);
  st.loading = false; if (error) { toast(error.message, "err"); return; }
  st.outcomes = Object.fromEntries((data || []).map(o => [o.day + "|" + o.driver, o]));
  render(true);
}

function lines(from, to) {
  return S.shifts.filter(x => x.run === "BU" && x.driver && x.day >= from && x.day <= to).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : nm(a.driver).localeCompare(nm(b.driver)))
    .map(bu => ({ bu, ...lineFor(bu, S.shifts, S.runsBy), out: st.outcomes[bu.day + "|" + bu.driver] }));
}

const OUT = { not_needed: "Not needed", called_in: "Used · forfeited", declined: "Declined" };   // used as back-up = allowance forfeited (paid for hours worked)

// The board covers the whole pay fortnight. Every line is decided automatically once its back-up window ends;
// the fortnight's totals go to Alejandro in the pay email on the Monday after it closes. Tap a line only to override.
export function allowancesTab() {
  loadOutcomes();
  const F = fortnight(S.week), t = today(), L = lines(F.from, F.to);
  const P = {};
  L.forEach(l => { const o = l.out?.outcome, p = P[l.bu.driver] ||= { n: 0, owed: 0, nn: 0, ci: 0, de: 0, wait: 0 };
    p.n++; if (o === "not_needed") { p.nn++; p.owed += l.amt; } else if (o === "called_in") p.ci++; else if (o === "declined") p.de++; else p.wait++; });
  const rows = Object.entries(P).sort((a, b) => nm(a[0]).localeCompare(nm(b[0])));
  const sum = k => rows.reduce((a, [, p]) => a + p[k], 0);
  const c = (v, cls = "") => `<td style="text-align:right;padding:6px 8px" class="${cls}">${v}</td>`;
  const closed = F.to < t;
  const line = l => { const d = l.bu.day, o = l.out?.outcome, auto = l.out?.note === "auto";
    return `<div class="row" style="align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line)">
      <div style="flex:1 1 210px"><b>${esc(nm(l.bu.driver))}</b> <span class="meta">${label(d)}</span><div class="meta">${esc(l.kind)}</div></div>
      <div style="flex:0 0 110px"><b class="${o === "not_needed" ? "c-ok" : o ? "" : "c-grey"}">${o ? OUT[o] : d > t ? "Upcoming" : "Pending"}</b><div class="meta">${o === "called_in" ? "no back-up fee · " : ""}${o ? (auto ? "auto" : "set by hand") : "decides itself after the window"}</div></div>
      <div style="flex:0 0 60px;text-align:right"><b>${o === "not_needed" && l.amt ? "$" + l.amt : "—"}</b></div>
      <details style="flex:0 0 auto"><summary class="meta" style="cursor:pointer">change</summary><div class="row" style="gap:6px;margin-top:6px">${Object.entries(OUT).map(([k, t2]) => `<button class="btn sm ${o === k && !auto ? "" : "ghost"}" data-al="${k}" data-day="${d}" data-drv="${esc(l.bu.driver)}">${t2}</button>`).join("")}${o && !auto ? `<button class="btn ghost sm" data-al="" data-day="${d}" data-drv="${esc(l.bu.driver)}" title="Back to automatic">Auto</button>` : ""}</div></details></div>`; };
  return `<div class="wkbar"><button class="ar" data-fn="-1">‹</button><b>${label(F.from)} – ${label(F.to)}</b><button class="ar" data-fn="1">›</button><button class="btn ghost sm" data-fn="0">This fortnight</button></div>
  <div class="card"><h2>Pay fortnight<span>${closed ? "closed" : "in progress"} · owed: <b>$${sum("owed")}</b></span></h2>
    ${rows.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr class="meta"><th style="text-align:left;padding:6px 8px">Person</th><th style="text-align:right;padding:6px 8px">Slots</th><th style="text-align:right;padding:6px 8px">Not needed</th><th style="text-align:right;padding:6px 8px">Called in</th><th style="text-align:right;padding:6px 8px">Declined</th><th style="text-align:right;padding:6px 8px">Pending</th><th style="text-align:right;padding:6px 8px">Owed</th></tr></thead>
    <tbody>${rows.map(([d, p]) => `<tr style="border-top:1px solid var(--line)"><td style="padding:6px 8px">${esc(nm(d))}</td>${c(p.n)}${c(p.nn)}${c(p.ci)}${c(p.de)}${c(p.wait, "c-grey")}${c(`<b>$${p.owed}</b>`)}</tr>`).join("")}
    <tr style="border-top:2px solid var(--line)"><td style="padding:6px 8px"><b>Total</b></td>${c(sum("n"))}${c(sum("nn"))}${c(sum("ci"))}${c(sum("de"))}${c(sum("wait"), "c-grey")}${c(`<b>$${sum("owed")}</b>`)}</tr></tbody></table>` : `<div class="empty">No back-up or on-call slots on the Run Board this fortnight.</div>`}
    <p class="hint">Automatic: each line decides itself once its back-up window ends (<b>Used · forfeited</b> as soon as a run is moved onto them by a change sent after 5pm the day before or on the day — no back-up fee, paid for hours worked; otherwise <b>Not needed</b> = allowance owed). The totals go to Alejandro in the pay email on the Monday after the fortnight closes. Use “change” only to override.</p></div>
  <div class="card"><h2>Lines<span>${L.length}</span></h2>${L.map(line).join("")}</div>`;
}

export function wireAllowances() {
  $$("[data-fn]").forEach(b => b.onclick = async () => { const d = +b.dataset.fn; S.week = d === 0 ? monOf(today()) : addDays(fortnight(S.week).from, d * 14); await loadAll(); render(); });
  $$("[data-al]").forEach(b => b.onclick = async () => {
    const day = b.dataset.day, driver = b.dataset.drv, k = b.dataset.al;
    const r = k ? await sb.from("allowance_outcomes").upsert({ day, driver, outcome: k, note: null, decided_by: S.me?.id || null, decided_at: new Date().toISOString() })
                : await sb.from("allowance_outcomes").update({ note: "auto", decided_by: null }).match({ day, driver });
    if (r.error) return toast(r.error.message, "err");
    if (k) st.outcomes[day + "|" + driver] = { day, driver, outcome: k, note: null }; else if (st.outcomes[day + "|" + driver]) st.outcomes[day + "|" + driver].note = "auto";
    await sb.rpc("auto_allowances"); st.week = null; loadOutcomes();
  });
}
