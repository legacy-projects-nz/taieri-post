// notify: emails and push notifications triggered from the portals (roster changes, leave decisions, messages, scorecard emails)
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { admin, nz, toMin, fmtT, label, longLabel, esc, first, secrets, settings, sendEmail, wrap, push, json } from "./lib.ts";

const LEAVE_T: Record<string, string> = { annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave", bereave: "Bereavement leave", dayoff: "Day off request", other: "Other" };
const SITE = "https://taieri-post.onrender.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const auth = req.headers.get("Authorization") || "";
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await user.auth.getUser(); if (!who?.user) return json({ error: "sign in" }, 401);
  const sb = admin(); const { data: caller } = await sb.from("people").select("*").eq("user_id", who.user.id).maybeSingle();
  if (!caller) return json({ error: "not on the list" }, 403);
  const can = (a: string) => caller.role === "owner" || (caller.perms || []).includes(a);
  const body = await req.json().catch(() => ({})); const sec = await secrets(sb); const set = await settings(sb);
  const people = Object.fromEntries((await sb.from("people").select("*")).data!.map(p => [p.id, p]));
  const sig = `<p>Thanks,<br>${esc(first(caller.name))}<br>Taieri Post Limited</p>`;

  if (body.type === "roster_change") {
    if (!can("roster")) return json({ error: "no" }, 403);
    const { data: items } = await sb.from("roster_change_items").select("*, roster_changes!inner(*)").eq("change_id", body.change_id); if (!items?.length) return json({ error: "no items" }, 404);
    if (items[0].roster_changes.status !== "sent") return json({ error: "not sent" }, 400);
    const by: Record<string, string[]> = {}; for (const i of items) for (const d of i.affects) (by[d] ??= []).push(i.summary);
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
  if (body.type === "message") {
    if (!can("messages")) return json({ error: "no" }, 403);
    const { data: m } = await sb.from("messages").select("*").eq("id", body.message_id).single(); const { data: rs } = await sb.from("message_recipients").select("person").eq("message_id", m.id);
    const n = await push(sb, sec, set, (rs || []).map(r => r.person), { title: `Message from ${first(people[m.sender]?.name)}${m.needs_confirm ? " · please confirm" : ""}`, body: m.body.slice(0, 160), url: "/", tag: "msg-" + m.id });
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
