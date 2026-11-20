// shrink: runs every 15 minutes from pg_cron (x-cron-secret). Finds photos still stored full size (over ~600 KB),
// has Supabase's image service resize each to ≤1600px JPEG (about 300 KB) and puts it back in the same place. A few per run so it stays inside the time limit.
// Photos it can't make smaller are remembered in settings "photo_shrink_skip" and left alone.
import { createClient } from "npm:@supabase/supabase-js@2";

const PER_RUN = 8, MAX = 1600, QUALITY = 75;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: s } = await sb.from("app_secrets").select("value").eq("key", "cron_secret").single();
  if (!s?.value || req.headers.get("x-cron-secret") !== s.value) return json({ error: "nope" }, 401);
  const { data: sk } = await sb.from("settings").select("value").eq("key", "photo_shrink_skip").maybeSingle();
  const skip: string[] = Array.isArray(sk?.value) ? sk!.value : [];
  const { data: big } = await sb.rpc("big_photos", { p_skip: skip, p_limit: PER_RUN });
  const out: string[] = []; let saved = 0; const t0 = Date.now();
  for (const f of big || []) {
    if (Date.now() - t0 > 100e3) break;
    const id = `${f.bucket}/${f.name}`;
    try {
      // the resizing is done by Supabase's image service (no CPU used here)
      const { data: blob, error } = await sb.storage.from(f.bucket).download(f.name, { transform: { width: MAX, height: MAX, resize: "contain", quality: QUALITY, format: "origin" } });
      if (error || !blob) throw error || new Error("no file");
      const jpg = new Uint8Array(await blob.arrayBuffer());
      if (jpg.length >= f.size * 0.8) { skip.push(id); out.push(`${id}: no smaller`); continue; }
      const { error: e2 } = await sb.storage.from(f.bucket).upload(f.name, new Blob([jpg], { type: blob.type || "image/jpeg" }), { upsert: true, contentType: blob.type || "image/jpeg" }); if (e2) throw e2;
      saved += f.size - jpg.length; out.push(`${id}: ${Math.round(f.size / 1024)}→${Math.round(jpg.length / 1024)} KB`);
    } catch (e) { out.push(`${id}: skipped (${(e as Error)?.message || e})`); }
  }
  if (skip.length !== (Array.isArray(sk?.value) ? sk!.value.length : 0)) await sb.from("settings").upsert({ key: "photo_shrink_skip", value: skip.slice(-2000) });
  return json({ ok: true, savedMB: +(saved / 1048576).toFixed(1), done: out });
});
