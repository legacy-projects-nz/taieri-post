// payperiod: fortnightly email to Alejandro with the on-call / back-up allowances owed to each driver.
// pg_cron calls this every Monday morning; it only sends on the Monday after a pay period ends.
// First period: Mon 2 Nov to Sun 15 Nov 2026 (sent Mon 16 Nov), then every 14 days.
// Body (optional, for testing): { start: "YYYY-MM-DD", end?: "YYYY-MM-DD", dry: true, force: true }
import { admin, nz, toMin, fmtT, label, addDays, dow, esc, first, secrets, settings, sendEmail, wrap, json } from "./lib.ts";

const ANCHOR = "2026-11-02";
const AMT = { phone: 5, block5: 10, block10: 20 };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const days = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
const money = (n: number) => `$${n.toFixed(2)}`;

// Same rules as web/admin/allowances.js (lineFor)
function lineFor(bu: any, shifts: any[], runsBy: Record<string, any>) {
  const others = shifts.filter(x => x.day === bu.day && x.driver === bu.driver && x.run !== "BU");
  const startOf = (s: any) => { const w = runsBy[s.run]?.windows?.[DAYS[dow(s.day)]]; return toMin(s.start_at) ?? (w ? toMin(w[0][0]) : null); };
  const works = others.length > 0;
  const starts = works ? Math.min(...others.map(x => startOf(x) ?? 1e9)) : null;
  const pm = works && starts != null && starts >= 720;
  if (!works) return { kind: "On-call phone window (not rostered)", amt: AMT.phone };
  if (bu.bu_kind === "committed") return bu.bu_block === 10 ? { kind: "Committed back-up, over 5 to 10 hours", amt: AMT.block10 } : { kind: "Committed back-up, up to 5 hours", amt: AMT.block5 };
  if (pm) return { kind: "Phone window (afternoon shift)", amt: AMT.phone };
  return { kind: "Non-compulsory back-up (paid for hours worked only)", amt: 0 };
}

Deno.serve(async (req) => {
  const sb = admin(); const sec = await secrets(sb);
  if (req.headers.get("x-cron-secret") !== sec.cron_secret) return json({ error: "nope" }, 401);
  const body = await req.json().catch(() => ({})); const now = nz();
  let start: string = body.start, end: string = body.end;
  if (!start) {
    const n = days(ANCHOR, now.date);
    if (now.dow !== 0 || n < 14 || n % 14 !== 0) return json({ ok: true, skipped: "not a pay-period Monday", today: now.date });
    start = addDays(now.date, -14); end = addDays(now.date, -1);
  }
  end = end || addDays(start, 13);
  if (!body.force && !body.dry) { const { data: done } = await sb.from("pay_period_reports").select("sent_at").eq("period_start", start).maybeSingle(); if (done) return json({ ok: true, skipped: "already sent", sent_at: done.sent_at }); }

  const set = await settings(sb);
  const [{ data: runs }, { data: people }, { data: shifts }, { data: outs }] = await Promise.all([
    sb.from("runs").select("*"), sb.from("people").select("id,name,email"),
    sb.from("shifts").select("*").gte("day", start).lte("day", end).not("driver", "is", null),
    sb.from("allowance_outcomes").select("*").gte("day", start).lte("day", end),
  ]);
  const runsBy = Object.fromEntries((runs || []).map(r => [r.code, r])); const ppl = Object.fromEntries((people || []).map(p => [p.id, p]));
  const outBy = Object.fromEntries((outs || []).map(o => [o.day + "|" + o.driver, o]));
  type L = { day: string; driver: string; kind: string; amt: number; outcome?: string };
  const lines: L[] = (shifts || []).filter(s => s.run === "BU").map(bu => ({ day: bu.day, driver: bu.driver, ...lineFor(bu, shifts || [], runsBy), outcome: outBy[bu.day + "|" + bu.driver]?.outcome }))
    .sort((a, b) => a.driver === b.driver ? (a.day < b.day ? -1 : 1) : (ppl[a.driver]?.name || "").localeCompare(ppl[b.driver]?.name || ""));

  const owed = lines.filter(l => l.outcome === "not_needed" && l.amt > 0);
  const calledIn = lines.filter(l => l.outcome === "called_in");
  const undecided = lines.filter(l => !l.outcome && l.amt > 0);
  const byDrv: Record<string, { rows: L[]; total: number }> = {};
  for (const l of owed) { const d = (byDrv[l.driver] ??= { rows: [], total: 0 }); d.rows.push(l); d.total += l.amt; }
  const grand = Object.values(byDrv).reduce((a, d) => a + d.total, 0);
  const nm = (id: string) => ppl[id]?.name || id;
  const range = `${label(start)} to ${label(end, true)}`;
  const th = `style="padding:6px 10px;border-bottom:2px solid #ccc;text-align:left"`, td = `style="padding:6px 10px;border-bottom:1px solid #eee"`, tr_ = `style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right"`;

  const summary = Object.keys(byDrv).length ? `<table style="border-collapse:collapse;min-width:300px"><tr><th ${th}>Driver</th><th ${th} align="right">Days</th><th ${th} align="right">Total (NZD)</th></tr>${Object.entries(byDrv).map(([d, v]) => `<tr><td ${td}><b>${esc(nm(d))}</b></td><td ${tr_}>${v.rows.length}</td><td ${tr_}><b>${money(v.total)}</b></td></tr>`).join("")}<tr><td ${td}><b>Total</b></td><td ${tr_}></td><td ${tr_}><b>${money(grand)}</b></td></tr></table>` : `<p>No on-call or back-up allowances are owed for this period.</p>`;
  const detail = Object.entries(byDrv).map(([d, v]) => `<p style="margin:14px 0 4px"><b>${esc(nm(d))}</b>: ${money(v.total)}</p><ul style="margin:0">${v.rows.map(r => `<li>${label(r.day)}: ${esc(r.kind)}, ${money(r.amt)}</li>`).join("")}</ul>`).join("");
  const callIn = calledIn.length ? `<p><b>Called in (no allowance, paid for the hours worked on the timesheet):</b></p><ul>${calledIn.map(r => `<li>${esc(nm(r.driver))}: ${label(r.day)}</li>`).join("")}</ul>` : "";
  const und = undecided.length ? `<p style="background:#fff4d6;padding:10px 12px;border-radius:8px"><b>Not included yet (${undecided.length}):</b> Jeremy hasn't marked these days as needed or not needed in the Allowances tab, so they aren't in the totals above. If any are owed, a follow-up will come.</p><ul>${undecided.map(r => `<li>${esc(nm(r.driver))}: ${label(r.day)}, ${esc(r.kind)}, ${money(r.amt)}</li>`).join("")}</ul>` : "";

  const html = wrap(`<p>Hi Alejandro,</p><p>Here are the on-call and back-up allowances owed for the pay period <b>${esc(range)}</b>. These are extra to normal wages. Amounts are in NZD.</p>${summary}${detail}${callIn}${und}<p style="color:#555;font-size:13px">The allowances are $5 for the phone window when not needed, $10 for committed back-up up to 5 hours, and $20 for committed back-up over 5 and up to 10 hours. Non-compulsory back-up is paid for hours worked only.</p><p>Thanks,<br>Jeremy<br>Taieri Post Limited</p>`);
  const subject = `On-call and back-up payments: pay period ${label(start)} to ${label(end, true)}`;
  const toP = ppl["AL"]; const ccP = ppl["J"];
  if (body.dry) return json({ ok: true, dry: true, subject, to: toP?.email, cc: ccP?.email, grand, byDrv, calledIn: calledIn.length, undecided: undecided.length, html });
  if (!toP?.email) return json({ error: "no email for Alejandro" }, 400);
  const r = await sendEmail(sec, set, toP.email, subject, html, ccP?.email);
  await sb.from("pay_period_reports").upsert({ period_start: start, period_end: end, sent_at: new Date().toISOString(), sent_to: toP.email, total: grand, detail: { byDrv, undecided: undecided.length, calledIn: calledIn.length } });
  return json({ ok: true, sent: true, subject, grand, r });
});
