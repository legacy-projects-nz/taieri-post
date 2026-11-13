// notify: emails and push notifications triggered from the portals (roster changes, leave decisions, messages, scorecard emails)
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { admin, nz, toMin, fmtT, label, longLabel, esc, first, secrets, settings, sendEmail, wrap, push, json } from "./lib.ts";
// Only shift and van changes need the driver to confirm; add-on/note-only changes go straight onto their portal.
function needsConfirm(i: any) { const a = i?.after || null, b = i?.before || null; if (!a?.driver || !b?.driver) return true;
  return ["driver", "trainee", "van", "start_at", "end_at", "bu_kind", "bu_block"].some(k => (a[k] ?? null) !== (b[k] ?? null)); }


const LEAVE_T: Record<string, string> = { annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave", bereave: "Bereavement leave", dayoff: "Day off request", other: "Other" };
const SITE = "https://taieri-post.onrender.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const auth = req.headers.get("Authorization") || "";
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await user.auth.getUser(); if (!who?.user) return json({ error: "sign in" }, 401);
  const sb = admin(); const { data: pid } = await sb.rpc("person_for_user", { p_uid: who.user.id }); const { data: caller } = pid ? await sb.from("people").select("*").eq("id", pid).maybeSingle() : { data: null };
  if (!caller) return json({ error: "not on the list" }, 403);
  const can = (a: string) => caller.role === "owner" || (caller.perms || []).includes(a);
  const body = await req.json().catch(() => ({})); const sec = await secrets(sb); const set = await settings(sb);
  const people = Object.fromEntries((await sb.from("people").select("*")).data!.map(p => [p.id, p]));
  const sig = `<p>Thanks,<br>${esc(first(caller.name))}<br>Taieri Post Limited</p>`;

  if (body.type === "roster_change") {
    if (!can("roster")) return json({ error: "no" }, 403);
    const { data: items } = await sb.from("roster_change_items").select("*, roster_changes!inner(*)").eq("change_id", body.change_id); if (!items?.length) return json({ error: "no items" }, 404);
    if (items[0].roster_changes.status !== "sent") return json({ error: "not sent" }, 400);
    const by: Record<string, string[]> = {}; for (const i of items) { if (!needsConfirm(i)) continue; for (const d of i.affects) (by[d] ??= []).push(i.summary); }
    const reason = items[0].roster_changes.reason; let sent = 0;
    for (const [d, lines] of Object.entries(by)) { const p = people[d]; if (!p) continue;
      await push(sb, sec, set, [d], { title: `Roster change${lines.length > 1 ? "s" : ""} – please confirm`, body: lines[0] + (lines.length > 1 ? ` (+${lines.length - 1} more)` : ""), url: "/", tag: "rc-" + body.change_id });
      if (p.email) { await sendEmail(sec, set, p.email, `Roster change${lines.length > 1 ? "s" : ""} – ${lines.length === 1 ? lines[0].split(":")[0] : "please confirm"}`, wrap(`<p>Hi ${esc(first(p.name))},</p><p>Your roster has changed:</p><ul>${lines.map(l => `<li><b>${esc(l)}</b></li>`).join("")}</ul>${reason ? `<p>${esc(reason)}</p>` : ""}<p><a href="${SITE}/" style="display:inline-block;background:#e34948;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Open the app and tap "Got it"</a></p><p>Please confirm so we know you've seen it.</p>${sig}`)); sent++; } }
    return json({ ok: true, emailed: sent });
  }
  if (body.type === "leave_decided") {
    if (!can("leave")) return json({ error: "no" }, 403);
    const { data: l } = await sb.from("leave_requests").select("*").eq("id", body.leave_id).single(); const p = people[l.driver];
    const dates = l.date_from === l.date_to ? longLabel(l.date_from) : `${longLabel(l.date_from)} to ${longLabel(l.date_to)}`; const ok = l.status === "approved";
    await push(sb, sec, set, [l.driver], { title: `Leave ${ok ? "approved ✓" : "declined"}`, body: `${LEAVE_T[l.type] || l.type} · ${dates}`, url: "/" });
    if (p?.email) await sendEmail(sec, set, p.email, `Leave ${ok ? "approved" : "declined"} – ${l.date_from === l.date_to ? label(l.date_from) : `${label(l.date_from)} to ${label(l.date_to)}`}`, wrap(`<p>Hi ${esc(first(p.name))},</p><p>Your ${esc((LEAVE_T[l.type] || l.type).toLowerCase())} request for <b>${esc(dates)}</b>${l.part !== "full" ? ` (${l.part === "AM" ? "morning" : "afternoon"} off)` : ""} has been <b>${ok ? "approved" : "declined"}</b>.</p>${l.reply ? `<p>${esc(l.reply)}</p>` : ""}${ok ? "<p>It's on the roster as leave. Enjoy the time off.</p>" : "<p>If you'd like to talk about it, give Jeremy a call.</p>"}${sig}`));
    return json({ ok: true });
  }
  if (body.type === "sod_request") {   // driver's SOD was more than 20 min off the rostered start → push Jeremy (owner) and admins to sign it off
    const { data: r } = await sb.from("sod_requests").select("*").eq("id", body.id).maybeSingle(); if (!r) return json({ error: "no request" }, 404);
    if (r.driver !== caller.id && !can("roster")) return json({ error: "no" }, 403);
    const owners = Object.values(people).filter((p: any) => (p.role === "owner" || p.role === "admin") && p.active !== false).map((p: any) => p.id);
    const off = Math.abs(r.delta_min); const offT = off >= 60 ? `${Math.floor(off / 60)} h ${off % 60} min` : `${off} min`;
    const n = await push(sb, sec, set, owners, { title: `${first(people[r.driver]?.name)} started ${offT} ${r.kind} · sign off?`, body: `SOD ${fmtT(toMin(r.started))}, rostered ${fmtT(toMin(r.rostered))}${r.note ? ` · ${String(r.note).slice(0, 120)}` : ""}`, url: "/admin/#live", tag: "sodreq-" + r.id });
    return json({ ok: true, pushed: n });
  }
  if (body.type === "sod_request_decided") {
    if (caller.role !== "owner" && caller.role !== "admin") return json({ error: "no" }, 403);
    const { data: r } = await sb.from("sod_requests").select("*").eq("id", body.id).maybeSingle(); if (!r || r.status === "pending") return json({ error: "not decided" }, 400);
    const ok = r.status === "approved";
    const n = await push(sb, sec, set, [r.driver], { title: `${r.kind === "early" ? "Early" : "Late"} start ${ok ? "signed off ✓" : "not signed off"}${r.sod_at ? ` · start set to ${fmtT(toMin(r.started))}` : ""}`, body: ok ? `Today's run times now start at ${fmtT(toMin(r.started))}.${r.reply ? " " + r.reply : ""}` : `Your rostered times stay as they were.${r.reply ? " " + r.reply : ""}`, url: "/", tag: "sodreq-" + r.id });
    return json({ ok: true, pushed: n });
  }
  if (body.type === "hazard") {   // driver reported a hazard: push the owner(s) for high ones, and other drivers on the same run(s)
    const { data: h } = await sb.from("hazards").select("*").eq("id", body.id).maybeSingle(); if (!h) return json({ error: "no hazard" }, 404);
    if (h.reported_by !== caller.id && !can("roster")) return json({ error: "no" }, 403);
    const owners = Object.values(people).filter((p: any) => p.role === "owner" && p.active !== false).map((p: any) => p.id);
    const what = (h.kinds || []).join(", "); const who = first(people[h.reported_by]?.name || "A driver");
    let n = 0;
    if (h.severity === "high") n += await push(sb, sec, set, owners.filter(o => o !== caller.id), { title: `⚠️ High hazard: ${h.address}`, body: `${who} reported ${what}${h.note ? ` · ${String(h.note).slice(0, 120)}` : ""}`, url: "/admin/#hazards", tag: "hz-" + h.id, urgent: true });
    if (h.severity !== "low" && (h.runs || []).length) {
      const today = nz().date; const { data: sh } = await sb.from("shifts").select("driver,run").eq("day", today).in("run", h.runs);
      const drv = [...new Set((sh || []).map((s: any) => s.driver).filter((d: string) => d && d !== caller.id && !owners.includes(d)))];
      if (drv.length) n += await push(sb, sec, set, drv, { title: `⚠️ New hazard on your run: ${h.address}`, body: `${what}${h.note ? ` · ${String(h.note).slice(0, 120)}` : ""}`, url: "/", tag: "hz-" + h.id });
    }
    return json({ ok: true, pushed: n });
  }
  if (body.type === "message") {
    if (!can("messages")) return json({ error: "no" }, 403);
    const { data: m } = await sb.from("messages").select("*").eq("id", body.message_id).single(); const { data: rs } = await sb.from("message_recipients").select("person").eq("message_id", m.id);
    const n = await push(sb, sec, set, (rs || []).map(r => r.person), { title: `Message from ${first(people[m.sender]?.name)}${m.needs_confirm ? " · please confirm" : ""}`, body: m.body.slice(0, 160), url: "/", tag: "msg-" + m.id });
    return json({ ok: true, pushed: n });
  }
  if (body.type === "milton_time") {   // D>B driver changed the Milton meet time: push the message set_milton_time wrote to the Lawrence driver
    const { data: m } = await sb.from("messages").select("*").eq("id", body.message_id).maybeSingle(); if (!m) return json({ error: "no message" }, 404);
    if (m.sender !== caller.id && !can("roster")) return json({ error: "no" }, 403);
    const { data: rs } = await sb.from("message_recipients").select("person").eq("message_id", m.id);
    const n = await push(sb, sec, set, (rs || []).map(r => r.person), { title: "Milton meet time changed · please confirm", body: m.body.slice(0, 160), url: "/", tag: "milton-" + m.id });
    return json({ ok: true, pushed: n });
  }
  if (body.type === "entry") {
    if (!can("scorecard")) return json({ error: "no" }, 403);
    const n = await push(sb, sec, set, [body.driver], { title: body.kind === "mistake" ? "A mistake was recorded" : body.kind === "praise" ? "Nice work 👏" : "Note from Jeremy", body: String(body.title || "").slice(0, 160), url: "/" });
    return json({ ok: true, pushed: n });
  }
  if (body.type === "posts_email") {
    if (!can("scorecard")) return json({ error: "no" }, 403);
    const p = people[body.driver]; if (!p?.email) return json({ error: "no email" }, 400);
    const lines = (body.keys as string[]).map(k => { const [day, , code, kind] = k.split("|"); return `<li><b>${kind}${code !== "day" ? ` · ${code}` : ""} · ${label(day)}</b></li>`; }).join("");
    await sendEmail(sec, set, p.email, `[TP SYSTEM EMAIL] ${body.keys.length === 1 ? "A post" : `${body.keys.length} posts`} to look at`, wrap(`<p>Hi ${esc(first(p.name))},</p><p>Quick one from the Driver Scorecard (automatic, so nobody is chasing you personally). These posts were late or missing:</p><ul>${lines}</ul><p>If one is missing, you can still send it from the app (it'll count as late, but late beats missing). If something here looks wrong, reply and Jeremy will sort it.</p><p>Why it matters: every late or missing post counts against your Admin score. A post on time keeps you at 100%.</p>${sig}`), (set.reminders || {}).cc || undefined);
    return json({ ok: true });
  }
  if (body.type === "weekly") {
    if (!can("scorecard")) return json({ error: "no" }, 403);
    const p = people[body.driver]; if (!p?.email) return json({ error: "no email" }, 400);
    const s = body.scores || {};
    const row = (l: string, v: any) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${l}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right"><b>${v == null ? "—" : v}</b></td></tr>`;
    // scores are worked out by the portal and passed in, so the email matches what Jeremy sees
    await sendEmail(sec, set, p.email, `Your Taieri Post scorecard: ${label(body.from)} – ${label(body.to)}`, wrap(`<p>Hi ${esc(first(p.name))},</p><p>Here is your Taieri Post scorecard for ${esc(longLabel(body.from))} to ${esc(longLabel(body.to))}.</p><table style="border-collapse:collapse;min-width:280px">${row("Posts on time", s.onTime != null ? `${s.onTime} of ${s.closed}` : null)}${row("Admin", pct(s.admin))}${row("Efficiency", pct(s.eff))}${row("Accuracy", pct(s.acc))}${row("Safety", pct(s.safe))}${row("Overall", pct(s.overall))}</table>${s.mistakes?.length ? `<p><b>Mistakes recorded (${s.mistakes.length})</b> (−${set.rules?.mistakePct ?? 10}% Accuracy each)</p><ul>${s.mistakes.map((m: string) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}${s.misses?.length ? `<p><b>Posts late or missing (${s.misses.length})</b></p><ul>${s.misses.map((m: string) => `<li>${esc(m)}</li>`).join("")}</ul>` : "<p><b>No misses. Great work.</b></p>"}<p>SOD is due within ${set.rules?.sodGrace ?? 15} minutes of your rostered start, and the EOD within ${set.rules?.eodHours ?? 2} hours of finishing. Every field in the EOD counts toward your Admin and Efficiency scores.</p><p><a href="${SITE}/">Open your page</a> to see the figures behind each score.</p>${sig}`));
    return json({ ok: true });
  }
  if (body.type === "email") {   // classic Run Board: approval / roster emails that used to go through Outlook
    if (!can("roster") && !can("leave") && !can("scorecard")) return json({ error: "no" }, 403);
    const to = (Array.isArray(body.to) ? body.to : [body.to]).filter((x: string) => /@/.test(x || "")); if (!to.length) return json({ error: "no recipient" }, 400);
    const r = await sendEmail(sec, set, to, String(body.subject || "Taieri Post").slice(0, 200), wrap(String(body.html || "")), body.cc?.[0]);
    return json({ ok: true, r });
  }
  return json({ error: "unknown type" }, 400);
});
const pct = (v: any) => v == null ? "—" : `${Math.round(v)}%`;
