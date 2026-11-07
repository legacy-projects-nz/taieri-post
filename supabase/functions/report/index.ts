// report: daily and weekly spreadsheet emails to the owner with all the data the app holds for the period.
// pg_cron calls this every hour at :45; it sends the daily at 8:40pm NZ (after the NZ Post feed is imported, ~8:17pm)
// and the weekly (Mon–Sun) on Sunday at 9pm NZ. Each report is sent once (report_log).
// Body (optional, for testing/resends): { kind: "daily"|"weekly", day: "YYYY-MM-DD" (daily) | from: "YYYY-MM-DD" (weekly Monday), to?: email, dry?: true, force?: true }
// The scoring engine is the app's own web/shared/score.js from the repo (same rules as the owner portal; bump the commit when score.js changes); deno.json maps its core.js import to ./core.js.
// Daily goes to the owner and Alejandro (admin, id AL); weekly to the owner.
import * as XLSX from "npm:xlsx@0.18.5";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { cfg, scoreFor, setEvidence, segTimes, addName, STATE_LABEL } from "https://cdn.jsdelivr.net/gh/legacy-projects-nz/taieri-post@da05319f36a24f44e0bdb36df2388f3a589b0bc8/web/shared/score.js";
import { nzNow as nz, addDays, dow, label } from "./core.js";

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
async function secrets(sb: any) { const { data } = await sb.from("app_secrets").select("key,value"); const o: Record<string, string> = {}; for (const r of data || []) o[r.key] = r.value; return o; }
async function settings(sb: any) { const { data } = await sb.from("settings").select("key,value"); const o: Record<string, any> = {}; for (const r of data || []) o[r.key] = r.value; return o; }
const wrap = (body: string) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:680px">${body}<p style="color:#777;font-size:12px;margin-top:24px">Taieri Post · automatic report from the driver system.</p></div>`;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

const DAILY_AT = 20 * 60 + 40, WEEKLY_AT = 21 * 60;
const tsNZ = (iso?: string | null) => { if (!iso) return ""; const n = nz(new Date(iso)); return `${n.date} ${n.hhmm}`; };
const r1 = (v: any) => v == null || isNaN(v) ? "" : Math.round(v * 10) / 10;
const r2 = (v: any) => v == null || isNaN(v) ? "" : Math.round(v * 100) / 100;
const flat = (v: any) => v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : typeof v === "boolean" ? (v ? "Yes" : "No") : v;

async function all(q: any) { const { data, error } = await q; if (error) throw new Error(error.message); return data || []; }

async function build(sb: any, from: string, to: string) {
  const set = await settings(sb); const C = cfg(set);
  const evFrom = addDays(from, -63);
  const [runs, people, shiftsAll, entries, marks, feed, ovs, pickups, leave, vchk, rules] = await Promise.all([
    all(sb.from("runs").select("*").order("sort")), all(sb.from("people").select("*").order("name")),
    all(sb.from("shifts").select("*").gte("day", evFrom).lte("day", to)),
    all(sb.from("entries").select("*").gte("day", addDays(from, -14)).lte("day", to)),
    all(sb.from("marks").select("*")), all(sb.from("nzpost_feed").select("*").gte("day", from).lte("day", to)),
    all(sb.from("eff_overrides").select("*")),
    all(sb.from("pickups").select("*").gte("day", from).lte("day", to).order("day")),
    all(sb.from("leave_requests").select("*").lte("date_from", to).gte("date_to", from)),
    all(sb.from("vehicle_checks").select("*").gte("week_start", addDays(from, -dow(from))).lte("week_start", to)),
    all(sb.from("timing_rules").select("*")),
  ]);
  const runsBy = Object.fromEntries(runs.map((r: any) => [r.code, r])); const nm = (id: string) => people.find((p: any) => p.id === id)?.name || id || "";
  const shIds = shiftsAll.map((s: any) => s.id); const sods: any[] = [], eods: any[] = [];
  for (let i = 0; i < shIds.length; i += 300) { const ids = shIds.slice(i, i + 300); sods.push(...await all(sb.from("sod").select("*").in("shift_id", ids))); eods.push(...await all(sb.from("eod").select("*").in("shift_id", ids))); }
  setEvidence(shiftsAll, eods);
  const startTs = new Date(from + "T00:00:00+13:00").toISOString(), endTs = new Date(addDays(to, 1) + "T06:00:00+13:00").toISOString();
  const [alerts, breaks] = await Promise.all([all(sb.from("alerts").select("*").gte("created_at", startTs).lt("created_at", endTs).order("created_at")), all(sb.from("breaks").select("*").gte("started_at", startTs).lt("started_at", endTs).order("started_at"))]);
  const shifts = shiftsAll.filter((s: any) => s.day >= from && s.day <= to); const shBy = Object.fromEntries(shiftsAll.map((s: any) => [s.id, s]));
  const D = { shifts: shiftsAll, sods, eods, marks, entries, feed, ovs, runsBy };
  const drivers = [...new Set(shifts.filter((s: any) => s.driver && s.run !== "BU").map((s: any) => s.driver))] as string[];
  const ppl = Object.fromEntries(people.map((p: any) => [p.id, p]));

  // per driver summary + per-day + efficiency rows + posts
  const summary: any[] = [], daily: any[] = [], effRows: any[] = [], posts: any[] = [];
  for (const d of drivers.sort((a, b) => nm(a).localeCompare(nm(b)))) {
    const s = scoreFor(d, from, to, D, C); const days = Object.values(s.days) as any[];
    const rost = days.reduce((a, x) => a + x.hours, 0);
    let exp = 0, act = 0, expEst = false, runsN = 0, eodsN = 0;
    for (const e of s.effDays) for (const r of (e.rows || [])) { if (r.trainDay) continue; exp += r.allowed / 60; act += r.taken || 0; if (r.est) expEst = true; }
    for (const x of days) for (const g of x.segs) if (!g.sort) { runsN++; if (eods.find((e: any) => e.shift_id === g.shift.id)) eodsN++; }
    const rate = +(ppl[d]?.rate || C.rules.hourRate);
    summary.push({ Driver: nm(d), "Days": days.length, "Runs": runsN, "EODs in": eodsN, "Rostered h": r1(rost), "Expected h": r1(exp) + (expEst ? " (est)" : ""), "Actual h": r1(act), "Efficiency %": r1(s.eff), "Admin %": r1(s.admin), "Accuracy %": r1(s.acc), "NZ Post feed %": r1(s.feedPct), "Safety %": r1(s.safe), "Overall %": r1(s.overall), "Posts closed": s.closed, "On time": s.onTime, "Late": s.late, "Missing": s.missing, "Mistakes": s.nMist, "Rate $/h": rate, "Spend $ (actual h × rate)": r2(act * rate) });
    for (const x of days.sort((a, b) => a.day.localeCompare(b.day))) {
      const sd = scoreFor(d, x.day, x.day, D, C); const ed = sd.effDays[0];
      const sod = x.segs.map((g: any) => sods.find((o: any) => o.shift_id === g.shift.id)).find(Boolean);
      daily.push({ Date: x.day, Day: label(x.day), Driver: nm(d), Runs: x.segs.map((g: any) => g.shift.run).join(", "), "Rostered h": r1(x.hours), "SOD at": tsNZ(sod?.sent_at), "Efficiency %": ed?.pending ? "pending" : r1(ed?.v), "Waiting on": ed?.need || "", "Admin %": r1(sd.admin), "Accuracy %": r1(sd.acc), "Mistakes": sd.nMist, "Posts on time": `${sd.onTime}/${sd.closed}` });
    }
    for (const e of s.effDays) for (const r of (e.rows || [])) {
      const ov = r.ov || {}; const eod = r.eod || {};
      effRows.push({ Date: e.day, Driver: nm(d), Run: r.code, "Expected min": Math.round(r.allowed), "Expected h": r2(r.allowed / 60), "Start": r.start != null ? `${String(Math.floor(r.start / 60)).padStart(2, "0")}:${String(r.start % 60).padStart(2, "0")}` : "", "Finish": r.end != null ? `${String(Math.floor(r.end / 60)).padStart(2, "0")}:${String(r.end % 60).padStart(2, "0")}` : "", "Actual h": r2(r.taken), "Efficiency %": r1(r.perf), "Estimated": r.est ? "Yes" : "", "Guessed figures": (r.guess || []).join(", "), "Needs": (r.need || []).join(", "), "Training day": r.trainDay ? "Yes" : "", "Parcels": r.figs?.parcels ?? "", "Stops": r.figs?.stops ?? "", "Trays": r.figs?.trays ?? "", "Pick-ups": r.figs?.pickups ?? "", "Corrected by hand": Object.keys(ov).filter(k => !["shift_id", "updated_at"].includes(k) && ov[k] != null && ov[k] !== false && !(Array.isArray(ov[k]) && !ov[k].length)).join(", "), "Formula": (r.parts || []).map((p: any) => `${p[0]} ${p[1] ?? ""}`.trim()).join(" + ") });
    }
    for (const it of s.items) posts.push({ Date: it.day, Driver: nm(d), Post: it.kind, Run: it.code || it.shift?.run || "", "Due": it.due != null ? `${String(Math.floor((it.due % 1440) / 60)).padStart(2, "0")}:${String(it.due % 60).padStart(2, "0")}` : "", "Posted at": tsNZ(it.row?.sent_at), Status: STATE_LABEL[it.st] || it.st, "Late (min)": it.late ?? "" });
  }
  const totals = summary.reduce((a, r) => { a.rost += +r["Rostered h"] || 0; a.exp += parseFloat(r["Expected h"]) || 0; a.act += +r["Actual h"] || 0; a.spend += +r["Spend $ (actual h × rate)"] || 0; a.mist += r.Mistakes || 0; a.late += r.Late || 0; a.miss += r.Missing || 0; return a; }, { rost: 0, exp: 0, act: 0, spend: 0, mist: 0, late: 0, miss: 0 });

  const shiftRows = shifts.sort((a: any, b: any) => a.day.localeCompare(b.day) || a.run.localeCompare(b.run)).map((s: any) => { const t = segTimes(s, runsBy); const hm = (m: number | null) => m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return { Date: s.day, Day: label(s.day), Run: s.run, "Run name": runsBy[s.run]?.name || "", Slot: s.slot, Driver: nm(s.driver), Trainee: nm(s.trainee), Van: s.van || "", Start: hm(t.st), Finish: hm(t.en), "Add-ons": (s.addons || []).map((a: string) => addName(a)).join(", "), "Tasks done": Object.entries(s.done || {}).map(([k, v]) => `${addName(k)} ${tsNZ(v as string).slice(11)}`).join(", "), "Tasks planned": Object.entries(s.plan || {}).map(([k, v]) => `${addName(k)} ${v}`).join(", "), "Back-up type": s.bu_kind || "", Note: s.note || "" }; });
  const withShift = (rows: any[], tsCols: string[]) => rows.filter((r: any) => shBy[r.shift_id] && shBy[r.shift_id].day >= from && shBy[r.shift_id].day <= to).map((r: any) => { const s = shBy[r.shift_id]; const o: any = { Date: s.day, Run: s.run, Driver: nm(r.driver || s.driver) }; for (const [k, v] of Object.entries(r)) { if (["shift_id", "driver"].includes(k)) continue; o[k] = tsCols.includes(k) ? tsNZ(v as string) : k === "legs" ? (v as string[] || []).map(addName).join(", ") : flat(v); } return o; }).sort((a, b) => a.Date.localeCompare(b.Date) || a.Run.localeCompare(b.Run));
  const sodRows = withShift(sods, ["sent_at", "edited_at"]), eodRows = withShift(eods, ["sent_at", "edited_at"]);
  const ovRows = withShift(ovs, ["updated_at"]);
  const entRows = entries.filter((e: any) => e.day >= from && e.day <= to).sort((a: any, b: any) => a.day.localeCompare(b.day)).map((e: any) => ({ Date: e.day, Driver: nm(e.driver), Kind: e.kind, Category: e.issue || "", Title: e.title, Note: e.note || "", Run: e.run || "", "% off Accuracy": e.kind === "mistake" ? (e.pct_off ?? C.rules.mistakePct) : "", "Admin pts": e.admin_pts ?? "", "Safety %": e.safety_pct ?? "", "Efficiency %": e.eff_pct ?? "", Excused: e.excused ? "Yes" : "", "Shown to driver": e.show_driver ? "Yes" : "", Photos: (e.photos || []).length || "", "Review asked": tsNZ(e.review_requested_at), "Review note": e.review_note || "", "Entered by": nm(e.created_by), "Entered at": tsNZ(e.created_at) }));
  const feedRows = feed.sort((a: any, b: any) => a.day.localeCompare(b.day) || a.feed_code.localeCompare(b.feed_code)).map((f: any) => { const run = Object.entries(C.runCodes).filter(([, v]) => v === f.feed_code).map(([k]) => k); const drv = shifts.filter((s: any) => s.day === f.day && run.includes(s.run)).map((s: any) => nm(s.driver)); return { Date: f.day, "NZ Post code": f.feed_code, Run: run.join(", "), Driver: [...new Set(drv)].join(", "), Items: f.items, Compliant: f.compliant, "%": f.items ? r1(f.compliant / f.items * 100) : "" }; });
  const puRows = pickups.map((p: any) => ({ Date: p.day, Driver: nm(p.driver), Area: p.area, Customer: p.customer, Source: p.source || "depot", Small: p.small, Large: p.large, Note: p.note || "", "Entered at": tsNZ(p.created_at) }));
  const brRows = breaks.map((b: any) => { const s = shBy[b.shift_id]; const mins = b.ended_at ? Math.round((Date.parse(b.ended_at) - Date.parse(b.started_at)) / 60000) : ""; return { Date: nz(new Date(b.started_at)).date, Driver: nm(b.driver), Run: s?.run || "", Started: tsNZ(b.started_at).slice(11), Ended: tsNZ(b.ended_at).slice(11), Minutes: mins }; });
  const alRows = alerts.map((a: any) => ({ Raised: tsNZ(a.created_at), Kind: a.kind, Driver: nm(a.driver), Run: shBy[a.shift_id]?.run || "", Title: a.title, Detail: a.body || "", Resolved: tsNZ(a.resolved_at), "Resolved by": nm(a.resolved_by), Pushes: a.push_count ?? "" }));
  const lvRows = leave.map((l: any) => ({ Driver: nm(l.driver), Type: l.type, From: l.date_from, To: l.date_to, Part: l.part, Status: l.status, Paid: l.paid ? "Yes" : "", Hours: l.hours ?? "", Notes: l.notes || "", Reply: l.reply || "", Decided: tsNZ(l.decided_at) }));
  const vcRows = vchk.map((v: any) => ({ "Week of": v.week_start, Van: v.van, Driver: nm(v.driver), Sent: tsNZ(v.at), Odometer: v.odometer ?? "", "RUCs left": v.rucs_left ?? "", Washed: v.washed ? "Yes" : "No", "Tyres OK": v.tyres_ok ? "Yes" : "No", "Vault OK": v.vault_ok ? "Yes" : "No", Bodywork: v.bodywork || "", "Service due": v.service_due || "", Notes: v.notes || "", Photos: Array.isArray(v.photos) ? v.photos.length : "" }));
  const timRows: any[] = []; for (const s of shifts) for (const r of rules.filter((r: any) => r.active && (r.runs || []).includes(s.run) && (!r.days || r.days.includes(dow(s.day) + 1)) && (!r.addon || (s.addons || []).includes(r.addon)))) { const k = r.addon || r.id; timRows.push({ Date: s.day, Driver: nm(s.driver), Run: s.run, Task: r.name, Window: `${r.opens?.slice(0, 5) || ""}–${r.closes?.slice(0, 5) || ""}`, Planned: s.plan?.[k] || "", Done: tsNZ(s.done?.[k]).slice(11) || "not marked" }); }

  const sheets: [string, any[]][] = [["Summary", summary], ["Daily by driver", daily], ["Efficiency", effRows], ["Posts (SOD-EOD)", posts], ["Roster", shiftRows], ["SOD", sodRows], ["EOD", eodRows], ["Corrections", ovRows], ["Mistakes & entries", entRows], ["NZ Post feed", feedRows], ["Pick-ups", puRows], ["Timed tasks", timRows], ["Breaks", brRows], ["Alerts", alRows], ["Leave", lvRows], ["Vehicle checks", vcRows]];
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) { const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["Nothing for this period"]]); if (rows.length) ws["!cols"] = Object.keys(rows[0]).map(k => ({ wch: Math.min(40, Math.max(k.length, ...rows.slice(0, 200).map(r => String(r[k] ?? "").length)) + 2) })); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); }
  const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  return { b64, summary, totals, counts: Object.fromEntries(sheets.map(([n, r]) => [n, r.length])), entRows, alRows };
}

Deno.serve(async (req) => {
  const sb = admin(); const sec = await secrets(sb);
  if (req.headers.get("x-cron-secret") !== sec.cron_secret) return json({ error: "nope" }, 401);
  const body = await req.json().catch(() => ({})); const now = nz();
  const jobs: { kind: string; from: string; to: string }[] = [];
  if (body.kind === "daily") { const d = body.day || now.date; jobs.push({ kind: "daily", from: d, to: d }); }
  else if (body.kind === "weekly") { const f = body.from || addDays(now.date, -dow(now.date)); jobs.push({ kind: "weekly", from: f, to: addDays(f, 6) }); }
  else {
    if (now.min >= DAILY_AT) jobs.push({ kind: "daily", from: now.date, to: now.date });
    if (now.dow === 6 && now.min >= WEEKLY_AT) jobs.push({ kind: "weekly", from: addDays(now.date, -6), to: now.date });
  }
  const set = await settings(sb); const out: any[] = [];
  const { data: owner } = await sb.from("people").select("email").eq("role", "owner").limit(1).maybeSingle();
  const { data: ale } = await sb.from("people").select("email").eq("id", "AL").maybeSingle();
  const me = owner?.email || "jeremy@lpnz.co.nz";
  for (const j of jobs) {
    const key = `${j.kind}|${j.from}`; const to = body.to ? [body.to] : j.kind === "daily" ? [me, ale?.email].filter(Boolean) : [me];
    if (!body.force && !body.dry) { const { data: done } = await sb.from("report_log").select("sent_at").eq("key", key).maybeSingle(); if (done) { out.push({ key, skipped: "already sent" }); continue; } }
    const R = await build(sb, j.from, j.to);
    const title = j.kind === "daily" ? `Daily report – ${label(j.from, true)}` : `Weekly report – ${label(j.from)} to ${label(j.to, true)}`;
    const T = R.totals; const pct = (v: any) => v === "" || v == null ? "—" : `${v}%`;
    const rows = R.summary.map((r: any) => `<tr><td>${esc(r.Driver)}</td><td align="right">${r["Actual h"] || "—"}</td><td align="right">${pct(r["Efficiency %"])}</td><td align="right">${pct(r["Admin %"])}</td><td align="right">${pct(r["Accuracy %"])}</td><td align="right">${pct(r["Overall %"])}</td><td align="right">${r.Mistakes || ""}</td></tr>`).join("");
    const html = wrap(`<p><b>${esc(title)}</b></p><p>Full spreadsheet attached: summary, every driver-day, efficiency per run, SOD/EOD posts, roster, raw SOD and EOD figures, corrections, mistakes and entries, NZ Post feed, pick-ups, timed tasks, breaks, alerts, leave and vehicle checks.</p>
      <p>Rostered ${r1(T.rost)} h · expected ${r1(T.exp)} h · actual ${r1(T.act)} h · spend $${Math.round(T.spend).toLocaleString()} · ${T.late} late / ${T.miss} missing posts · ${T.mist} mistake${T.mist === 1 ? "" : "s"}</p>
      ${rows ? `<table cellpadding="4" style="border-collapse:collapse;font-size:13px"><tr style="background:#eee"><th align="left">Driver</th><th>Actual h</th><th>Eff</th><th>Admin</th><th>Acc</th><th>Overall</th><th>Mist.</th></tr>${rows}</table>` : `<p>No one was rostered.</p>`}`);
    const filename = j.kind === "daily" ? `Taieri Post daily ${j.from}.xlsx` : `Taieri Post weekly ${j.from} to ${j.to}.xlsx`;
    if (body.dry) { out.push({ key, to, title, counts: R.counts, totals: T, bytes: R.b64.length }); continue; }
    const rk = sec.resend_api_key || Deno.env.get("RESEND_API_KEY"); const from = set.links?.email_from || sec.email_from || "Taieri Post <onboarding@resend.dev>";
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject: `[Taieri Post] ${title}`, html, attachments: [{ filename, content: R.b64 }] }) });
    const jr = await r.json().catch(() => ({}));
    if (!r.ok) { out.push({ key, error: jr }); continue; }
    await sb.from("report_log").upsert({ key, sent_at: new Date().toISOString(), sent_to: to.join(", "), detail: { counts: R.counts, totals: T, id: jr.id } });
    out.push({ key, sent: to, id: jr.id, counts: R.counts });
  }
  return json({ ok: true, now: now.date + " " + now.hhmm, out });
});
