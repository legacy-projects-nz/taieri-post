// geocode: fills lat/lng on hazards that have a lookup text (geo_q) but no GPS yet, using OpenStreetMap data via Photon
// (one request a second, to be polite). A house-number address that isn't found falls back to the street.
// Called by staff from the portal, or with the x-geo-key secret (one-off backfills). Processes up to `limit` rows per call.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function secrets(sb: ReturnType<typeof admin>) { const { data } = await sb.from("app_secrets").select("key,value"); const o: Record<string, string> = {}; for (const r of data || []) o[r.key] = r.value; return o; }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-geo-key" } });

const UA = "TaieriPost-hazard-register/1.0 (jeremy@lpnz.co.nz)";
const inOtago = (lat: number, lng: number) => lat < -45.0 && lat > -46.8 && lng > 168.8 && lng < 171.3;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Nominatim refuses requests from cloud servers (403), so the server side uses Photon (komoot, also OpenStreetMap data)
async function look(q: string) {
  const r = await fetch(`https://photon.komoot.io/api/?limit=1&lang=en&lat=-45.85&lon=170.45&q=${encodeURIComponent(q.replace(/, New Zealand$/, ""))}`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("photon " + r.status);
  const j = await r.json(); const f = j?.features?.[0]; if (!f) return null;
  const [lng, lat] = f.geometry.coordinates; if (!inOtago(lat, lng)) return null;
  const p = f.properties || {}; const street = p.type === "street" || (p.osm_key === "highway");
  // make sure it found the right street (Photon will happily return the nearest thing that half-matches)
  const want = q.split(",")[0].replace(/^\d+[A-Za-z]?\s+/, "").split(" ")[0].toLowerCase();
  const got = `${p.street || ""} ${p.name || ""}`.toLowerCase(); if (want && !got.includes(want)) return null;
  return { lat, lng, street, hasNumber: !!p.housenumber };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const sb = admin(); const sec = await secrets(sb);
  let ok = !!sec.geo_key && req.headers.get("x-geo-key") === sec.geo_key;
  if (!ok) {   // or a signed-in owner / roster staff member
    const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } }, auth: { persistSession: false } });
    const { data: who } = await user.auth.getUser();
    if (who?.user) { const { data: pid } = await sb.rpc("person_for_user", { p_uid: who.user.id }); const { data: p } = pid ? await sb.from("people").select("role,perms").eq("id", pid).maybeSingle() : { data: null }; ok = !!p && (p.role === "owner" || (p.perms || []).includes("roster")); }
  }
  if (!ok) return json({ error: "no" }, 403);
  const body = await req.json().catch(() => ({})); const limit = Math.min(+body.limit || 40, 80);
  const { data: rows } = await sb.from("hazards").select("id,geo_q").is("lat", null).is("geo_precision", null).not("geo_q", "is", null).limit(limit);
  const done: Record<string, string> = {}; const cache: Record<string, any> = {};
  for (const h of rows || []) {
    try {
      let q = h.geo_q as string; let g = cache[q];
      if (g === undefined) { g = await look(q); await sleep(1100); cache[q] = g; }
      const num = /^\d+[A-Za-z]?\s/.test(q);
      if (num && (!g || g.street || !g.hasNumber)) {   // number not found → try the street on its own
        const sq = q.replace(/^\d+[A-Za-z]?\s+/, ""); let s = cache[sq];
        if (s === undefined) { s = await look(sq); await sleep(1100); cache[sq] = s; }
        if (!g && s) g = { ...s, street: true }; else if (g) g = { ...g, street: true };
      }
      const prec = !g ? "none" : g.street ? "street" : "address";
      await sb.from("hazards").update(g ? { lat: g.lat, lng: g.lng, geo_precision: prec } : { geo_precision: "none" }).eq("id", h.id);
      done[h.id] = prec;
    } catch (e) { console.warn("geocode", h.geo_q, String(e)); break; }
  }
  const { count } = await sb.from("hazards").select("id", { count: "exact", head: true }).is("lat", null).is("geo_precision", null).not("geo_q", "is", null);
  return json({ ok: true, processed: Object.keys(done).length, left: count ?? null, summary: Object.values(done).reduce((a: any, p) => (a[p] = (a[p] || 0) + 1, a), {}) });
});
