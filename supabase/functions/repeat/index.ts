// repeat: re-sends a driver's phone alert every 5 minutes while their overdue alert is still open.
// Runs every minute from pg_cron. Stops when the alert is resolved (done / Got it), after 24 repeats, or 6 hours after it was raised.
import { admin, secrets, settings, push, json } from "./lib.ts";

const KINDS = ["sod_late", "sod_missing", "eod_late", "timing_missed"];
const EVERY_S = 295, MAX = 24, STOP_AFTER_H = 6;

Deno.serve(async (req) => {
  const sb = admin(); const sec = await secrets(sb);
  if (req.headers.get("x-cron-secret") !== sec.cron_secret) return json({ error: "nope" }, 401);
  const set = await settings(sb); const now = Date.now(); const out: string[] = [];
  const { data: open } = await sb.from("alerts").select("*").is("resolved_at", null).in("kind", KINDS).not("driver", "is", null);
  for (const a of open || []) {
    const last = Date.parse(a.last_pushed_at || a.created_at); const n = a.push_count || 0;
    if (n >= MAX || now - last < EVERY_S * 1000 || now - Date.parse(a.created_at) > STOP_AFTER_H * 3600e3) continue;
    const what = String(a.title || "").replace(/^[^:]+: /, "");
    const sent = await push(sb, sec, set, [a.driver], { title: `⏰ ${what}`, body: `${a.body ? a.body + " · " : ""}Open the app and sort it.`, url: "/", tag: a.dedupe_key, urgent: true });
    await sb.from("alerts").update({ last_pushed_at: new Date().toISOString(), push_count: n + 1 }).eq("id", a.id); out.push(`${a.driver}:${a.kind}:${sent}`);
  }
  return json({ ok: true, repeated: out });
});
