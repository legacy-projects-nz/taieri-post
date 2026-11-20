// cleanup: run nightly from pg_cron (x-cron-secret).
//  • deletes photos older than 12 months (run sheets & task photos, vehicle checks, mistake photos)
//  • trims old housekeeping rows: GPS points and resolved alerts after 12 months, app error reports after 90 days
// GET ?health=1 (no secret) is a tiny health check for UptimeRobot: it reads the database and answers "ok".
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKETS = ["runsheets", "vchk", "errs"];
const KEEP_PHOTO_DAYS = 365;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const url = new URL(req.url);
  if (url.searchParams.has("health")) {
    const { error } = await sb.from("settings").select("key").limit(1);
    return error ? json({ ok: false }, 503) : new Response("ok", { status: 200 });
  }
  const { data: s } = await sb.from("app_secrets").select("value").eq("key", "cron_secret").single();
  if (!s?.value || req.headers.get("x-cron-secret") !== s.value) return json({ error: "nope" }, 401);

  const cutoff = new Date(Date.now() - KEEP_PHOTO_DAYS * 864e5).toISOString();
  const out: Record<string, number> = {};
  for (const b of BUCKETS) {
    // storage files must be removed through the Storage API (deleting rows in SQL leaves the files behind)
    const { data: old } = await sb.rpc("old_photos", { p_bucket: b, p_before: cutoff });
    const names = (old || []).map((o: any) => o.name ?? o); out[b] = 0;
    for (let i = 0; i < names.length; i += 100) { const { data } = await sb.storage.from(b).remove(names.slice(i, i + 100)); out[b] += data?.length || 0; }
  }
  const yearAgo = cutoff, d90 = new Date(Date.now() - 90 * 864e5).toISOString();
  const del = async (t: string, col: string, before: string, extra?: (q: any) => any) => { let q = sb.from(t).delete({ count: "exact" }).lt(col, before); if (extra) q = extra(q); const { count } = await q; out[t] = count || 0; };
  await del("locations", "at", yearAgo);
  await del("alerts", "resolved_at", yearAgo, q => q.not("resolved_at", "is", null));
  await del("client_errors", "at", d90);
  return json({ ok: true, removed: out });
});
