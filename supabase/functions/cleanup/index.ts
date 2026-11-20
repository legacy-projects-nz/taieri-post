// cleanup: run nightly from pg_cron (x-cron-secret).
//  Photos are kept by type (Jeremy, 21 Nov 2026):
//   • Trays back, mail tray (incl. Lawrence) and mail left photos: 1 month
//   • Runsheet, Bay/NC and any other run photos: 6 weeks
//   • Vehicle check photos: 12 months
//   • Mistake photos: while the driver works here; removed once they've left and the photo is over 12 months old
//  Also trims GPS points and resolved alerts after 12 months, app error reports after 90 days.
// GET ?health=1 (no secret) is a tiny health check for UptimeRobot: it reads the database and answers "ok".
import { createClient } from "npm:@supabase/supabase-js@2";

const DAY = 864e5;
const TRAYS = ["%-tw_traysback-%", "%-tw_mailtrays-%", "%-tw_lawtrays-%", "%-mail_left-%"];
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (new URL(req.url).searchParams.has("health")) {
    const { error } = await sb.from("settings").select("key").limit(1);
    return error ? json({ ok: false }, 503) : new Response("ok", { status: 200 });
  }
  const { data: s } = await sb.from("app_secrets").select("value").eq("key", "cron_secret").single();
  if (!s?.value || req.headers.get("x-cron-secret") !== s.value) return json({ error: "nope" }, 401);

  const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
  const out: Record<string, number> = {};
  // storage files must be removed through the Storage API (deleting rows in SQL leaves the files behind)
  const remove = async (label: string, bucket: string, names: string[]) => { out[label] = 0; for (let i = 0; i < names.length; i += 100) { const { data } = await sb.storage.from(bucket).remove(names.slice(i, i + 100)); out[label] += data?.length || 0; } };
  const list = async (args: Record<string, unknown>) => ((await sb.rpc("old_photos", args)).data || []).map((o: any) => o.old_photos ?? o.name ?? o);
  const trays: string[] = []; for (const p of TRAYS) trays.push(...await list({ p_bucket: "runsheets", p_before: ago(30), p_like: p }));
  await remove("trays & mail photos", "runsheets", trays);
  await remove("runsheet & bay photos", "runsheets", await list({ p_bucket: "runsheets", p_before: ago(42), p_not_like: TRAYS }));
  await remove("vehicle check photos", "vchk", await list({ p_bucket: "vchk", p_before: ago(365) }));
  await remove("mistake photos", "errs", ((await sb.rpc("old_err_photos", { p_before: ago(365) })).data || []).map((o: any) => o.old_err_photos ?? o));

  const del = async (t: string, col: string, before: string, extra?: (q: any) => any) => { let q = sb.from(t).delete({ count: "exact" }).lt(col, before); if (extra) q = extra(q); const { count } = await q; out[t] = count || 0; };
  await del("locations", "at", ago(365));
  await del("alerts", "resolved_at", ago(365), q => q.not("resolved_at", "is", null));
  await del("client_errors", "at", ago(90));
  return json({ ok: true, removed: out });
});
