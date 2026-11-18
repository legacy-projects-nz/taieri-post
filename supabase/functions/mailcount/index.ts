// mailcount: counts the mail tray slots that have mail in them, from the driver's mail tray photos (up to 6), with Claude vision.
// The count is the day's mail stops for the run: it goes straight onto the shift (shifts.mail_stops) and feeds the TDT. Drivers can't edit it.
// Needs an Anthropic API key: edge function secret ANTHROPIC_API_KEY, or app_secrets.anthropic_api_key. Model: app_secrets.anthropic_model (optional).
// Without a key it answers { error: "no_key" } and the driver types the count in by hand.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const PROMPT = `These are photos of a New Zealand Post courier driver's mail trays (sorting frames / pigeonhole trays) for one delivery run.
Each slot (pigeonhole, divider or labelled section) is one delivery address. For EACH photo, in order, count every slot you can see and how many of those slots have ANY mail in them (letters, envelopes, flyers, small packets). Empty slots don't count as having mail.
Count each photo on its own, even if photos overlap.
Reply with JSON only, no other text: {"photos": [{"slots_with_mail": <integer>, "slots_total": <integer>}], "confidence": "high" | "medium" | "low", "notes": "<one short sentence, e.g. what was hard to see>"}`;

// mode "left": end-of-day photo of mail that wasn't delivered (usually loose in a box) → estimated stops left, which come off the TDT
const PROMPT_LEFT = `This photo shows mail a New Zealand Post courier driver did NOT deliver today, brought back at the end of the run (usually loose in a box or tray).
Estimate how many separate delivery addresses (stops) this mail is for. Treat each separate letter, envelope, flyer or small packet as one stop, but items bundled together (rubber-banded or clipped) count as one stop. If there is no mail, answer 0.
Reply with JSON only, no other text: {"stops_left": <integer>, "items": <integer or null>, "confidence": "high" | "medium" | "low", "notes": "<one short sentence>"}`;

function b64(buf: ArrayBuffer) { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const auth = req.headers.get("Authorization") || "";
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await user.auth.getUser(); if (!who?.user) return json({ error: "sign in" }, 401);
  const sb = admin(); const { data: pid } = await sb.rpc("person_for_user", { p_uid: who.user.id });
  const { data: me } = pid ? await sb.from("people").select("id, role, perms").eq("id", pid).maybeSingle() : { data: null };
  if (!me) return json({ error: "not on the list" }, 403);

  const body = await req.json().catch(() => ({})); const shiftId = String(body.shift || ""); const paths: string[] = (body.paths || []).slice(0, 6).map(String); const left = body.mode === "left";
  if (!shiftId || !paths.length) return json({ error: "shift and photos needed" }, 400);
  const { data: sh } = await sb.from("shifts").select("id, driver, run, day, mail_stops, mail_ai").eq("id", shiftId).maybeSingle();
  if (!sh) return json({ error: "shift not found" }, 404);
  if (sh.driver !== me.id && me.role !== "owner" && !(me.perms || []).includes("roster")) {   // mail tray helpers (settings rules.mailHelpers) may count other drivers' trays on their runs
    const { data: rs } = await sb.from("settings").select("value").eq("key", "rules").maybeSingle();
    if (left || !(rs?.value?.mailHelpers?.[me.id] || []).includes(sh.run)) return json({ error: "not your shift" }, 403); }

  const { data: sec } = await sb.from("app_secrets").select("key, value").in("key", ["anthropic_api_key", "anthropic_model"]);
  const S = Object.fromEntries((sec || []).map(r => [r.key, r.value]));
  const key = Deno.env.get("ANTHROPIC_API_KEY") || S.anthropic_api_key; if (!key) return json({ error: "no_key" });
  const model = S.anthropic_model || Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";

  const images = [];
  for (const p of paths) { const { data: f, error } = await sb.storage.from("runsheets").download(p); if (error || !f) return json({ error: `photo not found: ${p}` }, 400);
    const mt = /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg";
    images.push({ type: "image", source: { type: "base64", media_type: f.type?.startsWith("image/") ? f.type : mt, data: b64(await f.arrayBuffer()) } }); }

  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: "user", content: [...images, { type: "text", text: `Run ${sh.run}, ${sh.day}.\n${left ? PROMPT_LEFT : PROMPT}` }] }] }) });
  const out = await r.json().catch(() => null);
  if (!r.ok) return json({ error: `count failed: ${out?.error?.message || r.status}` });
  const txt = (out?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const m = txt.match(/\{[\s\S]*\}/); let res: any = null; try { res = m ? JSON.parse(m[0]) : null; } catch { /* below */ }
  // tray count: add up every photo; if the photos show more slots than the run has (trays photographed twice / overlapping),
  // scale the mail count down in proportion (slots with mail × run slots ÷ slots counted)
  const P = Array.isArray(res?.photos) ? res.photos : res && res.slots_with_mail != null ? [res] : [];
  const rawMail = P.reduce((a: number, p: any) => a + (Math.round(+p.slots_with_mail) || 0), 0), rawTotal = P.reduce((a: number, p: any) => a + (Math.round(+p.slots_total) || 0), 0);
  let runSlots: number | null = null, scaled = false;
  if (!left) { const { data: st } = await sb.from("settings").select("value").eq("key", "effSimple").maybeSingle(); runSlots = +st?.value?.[sh.run]?.slots || null;
    if (!runSlots) {   // not set: learn it from this run's past counts (median of earlier slot totals, from 3 counts on)
      const { data: past } = await sb.from("shifts").select("mail_ai").eq("run", sh.run).not("mail_ai", "is", null).neq("id", shiftId).order("day", { ascending: false }).limit(30);
      const t = (past || []).map((x: any) => +x.mail_ai?.photos_total || +x.mail_ai?.total).filter((v: number) => v > 0).sort((a: number, b: number) => a - b); if (t.length >= 3) runSlots = t[Math.floor(t.length / 2)]; } }
  let n = Math.round(Number(left ? res?.stops_left : rawMail)); if (!res || !Number.isFinite(n) || n < 0 || (!left && !P.length)) return json({ error: "couldn't read a count from the photos" });
  if (!left && runSlots && rawTotal > runSlots) { n = Math.round(rawMail * runSlots / rawTotal); scaled = true; }
  if (left) { if (sh.mail_stops != null) n = Math.min(n, sh.mail_stops);   // can't leave more than the day's mail stops
    const ai = { count: n, items: res.items ?? null, confidence: res.confidence || null, notes: res.notes || null, model, at: new Date().toISOString() };
    await sb.from("shifts").update({ mail_left: n, mail_left_ai: ai }).eq("id", shiftId); return json({ ok: true, ...ai }); }
  const ai = { count: n, raw_mail: rawMail, photos_total: rawTotal, run_slots: runSlots, scaled, per_photo: P, total: runSlots && scaled ? runSlots : rawTotal || null, confidence: res.confidence || null, notes: res.notes || null, model, photos: paths.length, at: new Date().toISOString() };
  await sb.from("shifts").update({ mail_ai: ai, mail_stops: n }).eq("id", shiftId);   // the count is the mail stops: drivers can't change it (owner/admin can correct it)
  return json({ ok: true, ...ai });
});
