// Shared helpers for the Taieri Post edge functions (Deno)
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import webpush from "npm:web-push@3.6.7";

export const TZ = "Pacific/Auckland";
export const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtParts = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
export function nz(d = new Date()) { const p: Record<string, string> = {}; for (const x of fmtParts.formatToParts(d)) p[x.type] = x.value; return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute), dow: DAYS.indexOf(p.weekday), hhmm: `${p.hour}:${p.minute}` }; }
export const toMin = (t?: string | null) => { if (!t) return null; const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? (+m[1]) * 60 + (+m[2]) : null; };
export function fmtT(min: number | null) { if (min == null) return ""; let h = Math.floor(min / 60) % 24; const m = min % 60; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`; }
export function addDays(iso: string, n: number) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function dow(iso: string) { return (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7; }
export function label(iso: string, year = false) { const d = new Date(iso + "T12:00:00Z"); return `${DAYS[dow(iso)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? " " + d.getUTCFullYear() : ""}`; }
export function longLabel(iso: string) { const d = new Date(iso + "T12:00:00Z"); const L = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]; const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; return `${L[dow(iso)]} ${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const first = (n?: string) => String(n || "").split(" ")[0];

export async function secrets(sb: ReturnType<typeof admin>) { const { data } = await sb.from("app_secrets").select("key,value"); const o: Record<string, string> = {}; for (const r of data || []) o[r.key] = r.value; return o; }
export async function settings(sb: ReturnType<typeof admin>) { const { data } = await sb.from("settings").select("key,value"); const o: Record<string, any> = {}; for (const r of data || []) o[r.key] = r.value; return o; }

/* ---- Email via Resend ---- */
export async function sendEmail(sec: Record<string, string>, set: Record<string, any>, to: string | string[], subject: string, html: string, cc?: string) {
  const key = Deno.env.get("RESEND_API_KEY") || sec.resend_api_key; if (!key) { console.warn("no Resend key; email skipped:", subject); return { skipped: true }; }
  const from = set.links?.email_from || sec.email_from || "Taieri Post <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, ...(cc ? { cc: [cc] } : {}) }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) console.error("Resend error", r.status, j); return j;
}
export const wrap = (body: string) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:620px">${body}<p style="color:#777;font-size:12px;margin-top:24px">Taieri Post · this is an automatic email from the driver system. If something looks wrong, just reply and Jeremy will take a look.</p></div>`;

/* ---- Push ---- */
export async function push(sb: ReturnType<typeof admin>, sec: Record<string, string>, set: Record<string, any>, people: string[], payload: { title: string; body?: string; url?: string; tag?: string; urgent?: boolean }) {
  const priv = sec.vapid_private, pub = set.push?.vapid_public || sec.vapid_public; if (!priv || !pub || !people.length) return 0;
  webpush.setVapidDetails("mailto:jeremy@lpnz.co.nz", pub, priv);
  const { data: subs } = await sb.from("push_subs").select("*").in("person", people); let n = 0;
  for (const s of subs || []) { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 3600 }); n++; } catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("push_subs").delete().eq("id", s.id); else console.warn("push fail", e?.statusCode, e?.message); } }
  return n;
}
export async function staffWith(sb: ReturnType<typeof admin>, area: string) { const { data } = await sb.from("people").select("id,role,perms,email,name").eq("active", true); return (data || []).filter(p => p.role === "owner" || (p.perms || []).includes(area)); }
export const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
