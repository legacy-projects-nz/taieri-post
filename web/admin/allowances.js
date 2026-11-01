// Allowances tab: back-up and on-call allowances, tracked as their own item.
// Each Back up (BU) slot on the Run Board becomes a line here. Amounts come from the rules; Jeremy marks what happened.
//   Not rostered that day            -> on-call phone window  $5   (if not needed)
//   Working, PM shift, non-compulsory     -> phone window          $5   (if not needed)
//   Working, committed, up to 5 h    -> back-up allowance     $10  (if not needed)
//   Working, committed, 6 to 10 h    -> back-up allowance     $20  (if not needed)
//   Working, AM shift, non-compulsory     -> no allowance (paid for hours worked only)
// Called in = paid for hours worked (timesheet), no allowance on top. Declined = no allowance.
import { sb, q, today, addDays, label, fmtT, esc, $$, toast } from "/shared/core.js";
import { segTimes } from "/shared/score.js";
import { S, nm, weekBar, wireWeek, render } from "/admin/admin.js";

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
  const wk = S.week; if (st.week === wk && !st.loading) return;
  st.loading = true; st.week = wk;
  const { data, error } = await sb.from("allowance_outcomes").select("*").gte("day", wk).lte("day", addDays(wk, 6));
  st.loading = false; if (error) { toast(error.message, "err"); return; }
  st.outcomes = Object.fromEntries((data || []).map(o => [o.day + "|" + o.driver, o]));
  render(true);
}

function lines() {
  const wk = S.week, end = addDays(wk, 6);
  return S.shifts.filter(x => x.run === "BU" && x.driver && x.day >= wk && x.day <= end).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : nm(a.driver).localeCompare(nm(b.driver)))
    .map(bu => ({ bu, ...lineFor(bu, S.shifts, S.runsBy), out: st.outcomes[bu.day + "|" + bu.driver] }));
}

export function allowancesTab() {
  loadOutcomes();
  const L = lines(), t = today();
  const owed = l => l.out?.outcome === "not_needed" ? l.amt : 0;
  const tot = {}; L.forEach(l => { tot[l.bu.driver] = (tot[l.bu.driver] || 0) + owed(l); });
  const grand = Object.values(tot).reduce((a, b) => a + b, 0);
  const row = l => { const d = l.bu.day, o = l.out?.outcome; const needs = !o && d <= t && l.amt > 0;
    return `<div class="row" style="align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line)">
      <div style="flex:1 1 210px"><b>${esc(nm(l.bu.driver))}</b><div class="meta">${label(d)} · ${esc(l.kind)}</div><div class="meta">${esc(l.why)}</div></div>
      <div style="flex:0 0 70px;text-align:right"><b>${l.amt ? "$" + l.amt : "—"}</b>${o === "not_needed" && l.amt ? `<div class="meta c-ok">owed</div>` : ""}</div>
      <div class="row" style="flex:1 1 260px;gap:6px">${[["not_needed", "Not needed"], ["called_in", "Called in"], ["declined", "Declined"]].map(([k, t2]) => `<button class="btn sm ${o === k ? "" : "ghost"}" data-al="${k}" data-day="${d}" data-drv="${esc(l.bu.driver)}">${t2}</button>`).join("")}${o ? `<button class="btn ghost sm" data-al="" data-day="${d}" data-drv="${esc(l.bu.driver)}" title="Clear">✕</button>` : ""}</div>
      ${needs ? `<span class="meta c-warn" style="flex:0 0 auto">needs a decision</span>` : ""}</div>`; };
  return `${weekBar()}
  <div class="card"><h2>Allowances<span>back-up and on-call, owed this week: <b>$${grand}</b></span></h2>
    <p class="hint">One line for every Back up slot on the Run Board. <b>Not needed</b> = the allowance is owed. <b>Called in</b> = paid for the hours worked (check the timesheet), no allowance on top. <b>Declined</b> = no allowance. Phone window $5, committed back-up $10 (up to 5 h) or $20 (over 5 up to 10 h). Non-compulsory back-up in the morning has no allowance.</p>
    ${L.length ? L.map(row).join("") : `<div class="empty">No back-up or on-call slots on the Run Board this week.</div>`}
    ${Object.keys(tot).length ? `<div style="border-top:1px solid var(--line);margin-top:8px;padding-top:10px"><div class="meta mono" style="margin-bottom:6px">OWED THIS WEEK, BY PERSON</div>${Object.entries(tot).map(([d, v]) => `<div class="row" style="justify-content:space-between"><span>${esc(nm(d))}</span><b>$${v}</b></div>`).join("")}</div>` : ""}
  </div>`;
}

export function wireAllowances() {
  wireWeek();
  $$("[data-al]").forEach(b => b.onclick = async () => {
    const day = b.dataset.day, driver = b.dataset.drv, k = b.dataset.al;
    const r = k ? await sb.from("allowance_outcomes").upsert({ day, driver, outcome: k, decided_by: S.me?.id || null, decided_at: new Date().toISOString() }) : await sb.from("allowance_outcomes").delete().match({ day, driver });
    if (r.error) return toast(r.error.message, "err");
    if (k) st.outcomes[day + "|" + driver] = { day, driver, outcome: k }; else delete st.outcomes[day + "|" + driver];
    render(true);
  });
}
