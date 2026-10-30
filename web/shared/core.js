// Shared runtime: Supabase client, sign-in, NZ time, formatting, realtime, small UI helpers
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, TZ } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } });

/* ---------- NZ time ---------- */
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtParts = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
export function nzNow(d = new Date()) {
  const p = {}; for (const x of fmtParts.formatToParts(d)) p[x.type] = x.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  const min = (+p.hour) * 60 + (+p.minute);
  return { date, min, sec: +p.second, dow: DAYS.indexOf(p.weekday), hhmm: `${p.hour}:${p.minute}`, dt: d };
}
export const today = () => nzNow().date;
export function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function dow(iso) { return (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7; } // 0 = Mon
export function dayName(iso) { return DAYS[dow(iso)]; }
export function monOf(iso) { return addDays(iso, -dow(iso)); }
export function label(iso, withYear = false) { const d = new Date(iso + "T12:00:00Z"); return `${DAYS[dow(iso)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? " " + d.getUTCFullYear() : ""}`; }
export function longLabel(iso) { const d = new Date(iso + "T12:00:00Z"); const L = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]; const M = ["January","February","March","April","May","June","July","August","September","October","November","December"]; return `${L[dow(iso)]} ${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export function toMin(t) { if (t == null || t === "") return null; const m = /^(\d{1,2}):(\d{2})/.exec(String(t)); return m ? (+m[1]) * 60 + (+m[2]) : null; }
export function fmtT(min) { if (min == null) return ""; let h = Math.floor(min / 60) % 24, m = min % 60; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`; }
export function fmt24(min) { if (min == null) return ""; return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`; }
export function fmtTs(iso) { if (!iso) return ""; const d = new Date(iso); const n = nzNow(d); return `${label(n.date)} ${fmtT(n.min)}`; }
export function fmtTime(iso) { if (!iso) return ""; return fmtT(nzNow(new Date(iso)).min); }
export function ago(iso) { if (!iso) return ""; const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`; }
export function hours(a, b) { const x = toMin(a), y = toMin(b); if (x == null || y == null || y <= x) return 0; return Math.round((y - x) / 6) / 10; }
// NZ local date+time → ISO instant
export function nzToIso(date, hhmm) {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const off = (new Date(fmtParts.format(guess).replace(/(\w+), (\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, "$4-$3-$2T$5:$6:$7Z")) - guess) / 60000;
  return new Date(guess.getTime() - off * 60000).toISOString();
}

/* ---------- HTML helpers ---------- */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export function toast(msg, kind = "") { let el = $("#toast"); if (!el) { el = h(`<div id="toast" role="status"></div>`); document.body.appendChild(el); } el.textContent = msg; el.className = kind + " show"; clearTimeout(el._t); el._t = setTimeout(() => el.className = kind, 3800); }
export function pill(txt, cls = "") { return `<span class="pill ${cls}">${esc(txt)}</span>`; }
export const first = name => String(name || "").split(" ")[0];
export function groupBy(arr, f) { const o = {}; for (const x of arr) (o[f(x)] ??= []).push(x); return o; }
export const sum = a => a.reduce((s, x) => s + (+x || 0), 0);
export const avg = a => { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? sum(v) / v.length : null; };
export const col = v => v == null ? "grey" : v >= 95 ? "ok" : v >= 85 ? "accent" : v >= 75 ? "warn" : "crit";
export const pct = v => v == null ? "—" : Math.round(v) + "%";

/* ---------- Auth ---------- */
export async function session() { const { data } = await sb.auth.getSession(); return data.session; }
export async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function verifyCode(email, token) { const { data, error } = await sb.auth.verifyOtp({ email, token, type: "email" }); if (error) throw error; return data.session; }
export async function signOut() { await sb.auth.signOut(); location.reload(); }
export async function me() {
  const s = await session(); if (!s) return null;
  const { data, error } = await sb.from("people").select("*").eq("user_id", s.user.id).maybeSingle();
  if (error) throw error;
  return data ? { ...data, isOwner: data.role === "owner", isStaff: data.role === "owner" || (data.perms || []).length > 0, can: a => data.role === "owner" || (data.perms || []).includes(a) } : null;
}
export async function aal() { const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); return data; }

/* ---------- Data ---------- */
export async function q(p) { const { data, error } = await p; if (error) { console.error(error); throw error; } return data; }
export async function settings() { const rows = await q(sb.from("settings").select("key,value")); const o = {}; for (const r of rows) o[r.key] = r.value; return o; }
export function live(tables, cb, name = "live") {
  const ch = sb.channel(name + "-" + Math.random().toString(36).slice(2));
  for (const t of tables) ch.on("postgres_changes", { event: "*", schema: "public", table: t }, payload => cb(t, payload));
  ch.subscribe(); return ch;
}
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- Shift helpers ---------- */
export function windowsFor(run, iso) { const w = (run?.windows || {})[dayName(iso)]; return w && w.length ? w : null; }
export function shiftTimes(s, runsBy) { // start/end as minutes
  let st = toMin(s.start_at), en = toMin(s.end_at);
  if (st == null || en == null) { const w = windowsFor(runsBy[s.run], s.day); if (w) { st ??= toMin(w[0][0]); en ??= toMin(w[0][1]); } }
  return { st, en };
}
export function isSort(code) { return /^SUP/.test(code); }
export function runLabel(r) { return r?.label || r?.code || ""; }

/* ---------- Push ---------- */
export async function enablePush(personId, vapidPublic) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { ok: false, why: "This browser can't do notifications. On iPhone, add the app to your Home Screen first (Share → Add to Home Screen)." };
  const reg = await navigator.serviceWorker.register("/sw.js");
  const perm = await Notification.requestPermission(); if (perm !== "granted") return { ok: false, why: "Notifications were not allowed." };
  const key = Uint8Array.from(atob(vapidPublic.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(vapidPublic.length / 4) * 4, "=")), c => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const j = sub.toJSON();
  await q(sb.from("push_subs").upsert({ person: personId, endpoint: j.endpoint, keys: j.keys }, { onConflict: "endpoint" }));
  return { ok: true };
}
export async function pushState() { if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported"; const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub ? "on" : (Notification.permission === "denied" ? "denied" : "off"); }
