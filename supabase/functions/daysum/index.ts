// daysum: end-of-day summary email to the owner only — every run that day (driver, van, times, SOD / EOD, parcels, stops),
// every note (roster, SOD, EOD, add-on / task notes) and every photo (runsheets, task photos, mistakes, vehicle checks), with missing
// data in red and listed at the top. pg_cron calls it every hour at :50; it sends at/after 8:40pm NZ, once a day (report_log "summary|day").
// Body (optional): { day: "YYYY-MM-DD", to?: email, dry?: true, html?: true, force?: true }
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { segTimes, addName } from "https://cdn.jsdelivr.net/gh/legacy-projects-nz/taieri-post@b574956fab3aa6c9ad4b6fd9d87df67e8c4d68c9/web/shared/score.js";
import { nzNow as nz, addDays, label, toMin, fmtT } from "./core.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const wrap = (body: string) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:680px">${body}<p style="color:#777;font-size:12px;margin-top:24px">Taieri Post · automatic day summary from the driver system.</p></div>`;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
async function all(q: any) { const { data, error } = await q; if (error) throw new Error(error.message); return data || []; }
const SEND_AT = 20 * 60 + 40;

// Day summary for Jeremy (end of each day, with the daily report): every run that day in start order — driver, van, times,
// SOD / EOD, parcels and stops, every note (SOD, EOD, add-on/task notes, roster note) and every photo (runsheets, task photos), plus
// pick-up notes, mistakes / entries and vehicle checks. Photos are private: each is a signed link (30 days) with a small preview.
async function daySummary(sb: any, day: string) {
  const [runs, people, addons, shifts, entries, pickups, vchk] = await Promise.all([
    all(sb.from("runs").select("*")), all(sb.from("people").select("id,name")), all(sb.from("addons").select("id,name")),
    all(sb.from("shifts").select("*").eq("day", day)), all(sb.from("entries").select("*").eq("day", day)),
    all(sb.from("pickups").select("*").eq("day", day)), all(sb.from("vehicle_checks").select("*").gte("at", new Date(day + "T00:00:00+13:00").toISOString()).lt("at", new Date(addDays(day, 1) + "T06:00:00+13:00").toISOString())),
  ]);
  const runsBy = Object.fromEntries(runs.map((r: any) => [r.code, r])); const nm = (id: string) => people.find((p: any) => p.id === id)?.name || id || "—";
  const an = (k: string) => k === "key_photo" ? "Key photo" : addons.find((a: any) => a.id === k)?.name || addName(k);
  const ids = shifts.map((s: any) => s.id);
  const [sods, eods] = ids.length ? await Promise.all([all(sb.from("sod").select("*").in("shift_id", ids)), all(sb.from("eod").select("*").in("shift_id", ids))]) : [[], []];
  // photos → signed links (full size) + small previews
  const SEC = 30 * 86400; const ph: Record<string, { full: string; thumb: string }> = {};
  const want = (bucket: string, path: string) => { if (path && !ph[bucket + "/" + path]) ph[bucket + "/" + path] = { full: "", thumb: "" }; };
  for (const s of shifts) { for (const p of s.runsheet_photos || []) want("runsheets", p); for (const L of Object.values(s.task_photos || {}) as any[]) for (const p of L || []) want("runsheets", p); }
  for (const e of entries) for (const p of e.photos || []) want("errs", String(p).replace(/^errs\//, ""));
  const vp = (v: any) => Array.isArray(v.photos) ? v.photos : []; for (const v of vchk) for (const p of vp(v)) want("vchk", p);
  await Promise.all(Object.keys(ph).map(async k => { const i = k.indexOf("/"); const b = k.slice(0, i), path = k.slice(i + 1);
    const [f, t] = await Promise.all([sb.storage.from(b).createSignedUrl(path, SEC), sb.storage.from(b).createSignedUrl(path, SEC, { transform: { width: 220, height: 220, resize: "cover", quality: 60 } })]);
    ph[k] = { full: f.data?.signedUrl || "", thumb: t.data?.signedUrl || f.data?.signedUrl || "" }; }));
  const pics = (bucket: string, L: string[]) => L.filter(p => ph[bucket + "/" + p]?.full).map(p => `<a href="${esc(ph[bucket + "/" + p].full)}"><img src="${esc(ph[bucket + "/" + p].thumb)}" width="110" height="110" style="object-fit:cover;border-radius:6px;margin:2px;border:1px solid #ddd" alt="photo"></a>`).join("");
  const tm = (iso?: string | null) => iso ? fmtT(nz(new Date(iso)).min) : "";
  const list = shifts.filter((s: any) => s.run !== "BU" && s.driver).map((s: any) => ({ s, t: segTimes(s, runsBy) })).sort((a: any, b: any) => (a.t.st ?? 0) - (b.t.st ?? 0) || a.s.run.localeCompare(b.s.run));
  let nPhotos = 0, nNotes = 0; const miss: string[] = []; const RED = "color:#c00;font-weight:bold";
  const sodDrv = new Set(list.filter(({ s }: any) => sods.some((x: any) => x.shift_id === s.id)).map(({ s }: any) => s.driver)); const sodFlagged = new Set<string>();
  const blocks = list.map(({ s, t }: any) => {
    const sod = sods.find((x: any) => x.shift_id === s.id), eod = eods.find((x: any) => x.shift_id === s.id); const sort = /^SUP/.test(s.run);
    const gaps: string[] = [];   // missing data on this run, shown in red and listed at the top
    if (!sodDrv.has(s.driver) && !sodFlagged.has(s.driver)) { sodFlagged.add(s.driver); gaps.push("no SOD"); }
    if (!sort) { if (!eod) gaps.push("no EOD"); else { if (!eod.finish_time) gaps.push("no finish time"); if (eod.parcels == null && ["nzp", "tge"].includes(runsBy[s.run]?.network)) gaps.push("no parcels"); }
      if (runsBy[s.run]?.network === "nzp" && !(s.runsheet_photos || []).length && !(s.task_photos?.tw_twrunsheet || []).length) gaps.push("no runsheet photo"); }
    const todo0 = (s.addons || []).filter((a: string) => !Object.keys(s.done || {}).includes(a)); if (todo0.length) gaps.push(`not ticked: ${todo0.map((k: string) => an(k)).join(", ")}`);
    if (gaps.length) miss.push(`<li><b>${esc(s.run)}</b> · ${esc(nm(s.driver))}: ${esc(gaps.join(", "))}</li>`);
    const notes: string[] = [];
    if (s.note) notes.push(`<b>Roster note:</b> ${esc(s.note)}`);
    if (sod?.note) notes.push(`<b>SOD:</b> ${esc(sod.note)}`);
    if (eod?.note) notes.push(`<b>EOD:</b> ${esc(eod.note)}`);
    for (const [k, v] of Object.entries(s.task_notes || {})) if (v) notes.push(`<b>${esc(an(k))}:</b> ${esc(v).replace(/\n/g, "<br>")}`);
    nNotes += notes.length;
    const photoSets: string[] = []; const seen = new Set<string>();
    for (const [k, L] of Object.entries(s.task_photos || {}) as [string, string[]][]) { const fresh = (L || []).filter(p => !seen.has(p)); fresh.forEach(p => seen.add(p)); if (fresh.length) { nPhotos += fresh.length; photoSets.push(`<div style="font-size:12px;color:#555;margin-top:4px">${esc(an(k))}</div>${pics("runsheets", fresh)}`); } }
    const rs = (s.runsheet_photos || []).filter((p: string) => !seen.has(p)); if (rs.length) { nPhotos += rs.length; photoSets.push(`<div style="font-size:12px;color:#555;margin-top:4px">Runsheet</div>${pics("runsheets", rs)}`); }
    const done = Object.keys(s.done || {}); const todo = (s.addons || []).filter((a: string) => !done.includes(a));
    const figs = eod ? [eod.finish_time ? `finished ${fmtT(toMin(eod.finish_time))}` : "", eod.parcels != null ? `${eod.parcels} parcels` : "", eod.stops != null ? `${eod.stops} stops` : ""].filter(Boolean).join(" · ") : "";
    return `<div style="border:1px solid ${gaps.length ? "#e99" : "#ddd"};${gaps.length ? "background:#fff5f5;" : ""}border-radius:8px;padding:8px 10px;margin:8px 0">${gaps.length ? `<div style="${RED};font-size:13px">⚠ Missing: ${esc(gaps.join(" · "))}</div>` : ""}<div><b>${esc(s.run)}</b> <span style="color:#555">${esc(runsBy[s.run]?.name || "")}</span> · <b>${esc(nm(s.driver))}</b>${s.van ? ` · ${esc(s.van)}` : ""} · ${fmtT(t.st)}–${fmtT(t.en)}</div>
      <div style="font-size:13px;color:#333">${sod ? `SOD ${tm(sod.sent_at)}` : ""}${sort ? "" : eod ? `${sod ? " · " : ""}EOD ${tm(eod.sent_at)}${figs ? ` · ${figs}` : ""}` : `${sod ? " · " : ""}<span style="color:#c00">no EOD</span>`}</div>
      ${done.length ? `<div style="font-size:13px">✓ ${done.map(k => `${esc(an(k))} ${tm((s.done as any)[k])}`).join(" · ")}</div>` : ""}${todo.length ? `<div style="font-size:13px;color:#c00">Not ticked: ${todo.map((k: string) => esc(an(k))).join(", ")}</div>` : ""}
      ${notes.length ? `<div style="font-size:13px;margin-top:4px">${notes.join("<br>")}</div>` : ""}${photoSets.join("")}</div>`;
  }).join("");
  const puN = pickups.filter((p: any) => p.note); const ents = entries.filter((e: any) => !e.excused);
  const extra = [
    puN.length ? `<h3 style="font-size:15px">Pick-up notes</h3>${puN.map((p: any) => `<div style="font-size:13px">${esc(nm(p.driver))} · ${esc(p.area)} ${esc(p.customer || "")}: ${esc(p.note)}</div>`).join("")}` : "",
    ents.length ? `<h3 style="font-size:15px">Mistakes &amp; notes logged</h3>${ents.map((e: any) => `<div style="font-size:13px;margin:4px 0"><b>${esc(nm(e.driver))}</b> · ${esc(e.kind)}${e.run ? ` · ${esc(e.run)}` : ""} · ${esc(e.title)}${e.note ? ` — ${esc(e.note)}` : ""}${(e.photos || []).length ? `<br>${pics("errs", (e.photos || []).map((p: string) => p.replace(/^errs\//, "")))}` : ""}</div>`).join("")}` : "",
    vchk.length ? `<h3 style="font-size:15px">Vehicle checks</h3>${vchk.map((v: any) => `<div style="font-size:13px;margin:4px 0"><b>${esc(v.van)}</b> · ${esc(nm(v.driver))}${v.odometer ? ` · ${v.odometer.toLocaleString()} km` : ""}${v.notes ? ` — ${esc(v.notes)}` : ""}${vp(v).length ? `<br>${pics("vchk", vp(v))}` : ""}</div>`).join("")}` : "",
  ].join("");
  const html = wrap(`<p><b>Day summary – ${esc(label(day, true))}</b><br><span style="color:#555">${list.length} run${list.length === 1 ? "" : "s"} · ${nPhotos} photo${nPhotos === 1 ? "" : "s"} · ${nNotes} note${nNotes === 1 ? "" : "s"}. Tap a photo for full size (links last 30 days).</span></p>${miss.length ? `<div style="border:2px solid #c00;border-radius:8px;padding:6px 12px;background:#fff5f5"><div style="${RED}">⚠ Missing data (${miss.length} run${miss.length === 1 ? "" : "s"})</div><ul style="margin:4px 0;padding-left:18px;font-size:13px">${miss.join("")}</ul></div>` : `<p style="color:#080;font-weight:bold">✓ Nothing missing.</p>`}${blocks || "<p>Nothing rostered.</p>"}${extra}`);
  return { html, runs: list.length, photos: nPhotos, notes: nNotes, missing: miss.length };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const sec: Record<string, string> = {}; for (const r of (await sb.from("app_secrets").select("key,value")).data || []) sec[r.key] = r.value;
  if (!sec.cron_secret || req.headers.get("x-cron-secret") !== sec.cron_secret) return json({ error: "nope" }, 401);
  const body = await req.json().catch(() => ({})); const now = nz();
  const day = body.day || now.date; if (!body.day && now.min < SEND_AT) return json({ ok: true, wait: "sends at 8:40pm" });
  const key = `summary|${day}`;
  if (!body.force && !body.dry) { const { data: done } = await sb.from("report_log").select("sent_at").eq("key", key).maybeSingle(); if (done) return json({ ok: true, key, skipped: "already sent" }); }
  const Sm = await daySummary(sb, day);
  const { data: owner } = await sb.from("people").select("email").eq("role", "owner").limit(1).maybeSingle();
  const to = body.to ? [body.to] : [owner?.email || "jeremy@lpnz.co.nz"];
  if (body.dry) return json({ ok: true, key, to, runs: Sm.runs, photos: Sm.photos, notes: Sm.notes, missing: Sm.missing, html: body.html ? Sm.html : undefined });
  const { data: st } = await sb.from("settings").select("value").eq("key", "links").maybeSingle();
  const from = st?.value?.email_from || sec.email_from || "Taieri Post <onboarding@resend.dev>"; const rk = sec.resend_api_key || Deno.env.get("RESEND_API_KEY");
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject: `[Taieri Post] Day summary – ${label(day, true)}${Sm.missing ? ` · ${Sm.missing} with missing data` : ""}`, html: Sm.html }) });
  const jr = await r.json().catch(() => ({})); if (!r.ok) return json({ ok: false, key, error: jr }, 500);
  await sb.from("report_log").upsert({ key, sent_at: new Date().toISOString(), sent_to: to.join(", "), detail: { runs: Sm.runs, photos: Sm.photos, notes: Sm.notes, missing: Sm.missing, id: jr.id } });
  return json({ ok: true, key, sent: to, id: jr.id, missing: Sm.missing });
});
