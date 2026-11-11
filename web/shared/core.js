// Shared runtime: Supabase client, sign-in, NZ time, formatting, realtime, small UI helpers
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, TZ } from "./config.js";
import { isDemo, demoClient } from "./demo.js";

// Demo profile (made-up driver, data kept only in this browser) swaps in a pretend client; everything else talks to Supabase
export const DEMO = isDemo();
// Every request to Supabase goes through this, so the app knows when a save is still on its way (used by the double-tap guard below)
let _writes = 0;
const trackedFetch = (input, init) => { const m = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase(); const url = typeof input === "string" ? input : input?.url || "";
  if (m === "GET" || m === "HEAD" || url.includes("/auth/v1/")) return fetch(input, init);
  _writes++; return fetch(input, init).finally(() => { _writes = Math.max(0, _writes - 1); }); };
export const sb = DEMO ? demoClient() : createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }, global: { fetch: trackedFetch } });

/* ---------- Stability ---------- */
// Error log: anything that goes wrong on someone's phone (a failed load, a part of the page that could not be drawn, an unexpected crash)
// is written to client_errors so it can be seen and fixed. At most 12 a visit, each different error once.
const _ctx = { app: "", person: null }; let _errN = 0; const _errSeen = new Set();
export function errCtx(o) { Object.assign(_ctx, o); }
export function reportError(kind, err, detail) {
  try { const msg = String(err?.message || err || "").slice(0, 500); const key = kind + "|" + msg; if (!msg || _errSeen.has(key) || _errN >= 12) return; _errSeen.add(key); _errN++;
    console.warn("[tp error]", kind, err);
    if (DEMO) return;
    sb.from("client_errors").insert({ person: _ctx.person, app: _ctx.app, kind: String(kind).slice(0, 60), message: msg, stack: String(err?.stack || "").slice(0, 2000), url: location.pathname + location.hash, ua: navigator.userAgent.slice(0, 200), detail: detail ?? null }).then(() => { }, () => { });
  } catch { }
}
window.addEventListener("error", e => reportError("error", e.error || e.message, { src: String(e.filename || "").slice(-80), line: e.lineno }));
window.addEventListener("unhandledrejection", e => reportError("promise", e.reason));
// Double-tap guard: a form that is being saved, or a button whose save is still on its way, ignores more taps until the save has finished
// (on a slow connection people tap Save again, which used to store the same entry several times).
function lockWhileSaving(el, min) { el._tpLock = true; const t0 = Date.now(); const tick = () => { const dt = Date.now() - t0; if (dt >= 20000 || (dt >= min && _writes === 0) || !el.isConnected) { el._tpLock = false; return; } setTimeout(tick, 150); }; setTimeout(tick, min); }
document.addEventListener("submit", e => { const f = e.target; if (!(f instanceof HTMLFormElement)) return; if (f._tpLock) { e.preventDefault(); e.stopImmediatePropagation(); return; } lockWhileSaving(f, 600); }, true);
document.addEventListener("click", e => { const b = e.target?.closest?.("button"); if (!b || (b.type === "submit" && b.form)) return; if (b._tpLock && _writes > 0) { e.preventDefault(); e.stopImmediatePropagation(); return; } if (!b._tpLock) lockWhileSaving(b, 300); }, true);

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
export const esc = s => String(s ?? "").replace(/voluntary, offered/g, "non-compulsory, offered").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));   // stored change text says "voluntary" (emails use it); the app shows "non-compulsory"
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
export async function session() {
  const { data, error } = await sb.auth.getSession(); if (data?.session || DEMO) return data?.session ?? null;
  // no signal and the sign-in token has run out: the phone can't renew it right now, but it still knows who is signed in, so the app can open offline
  if (error && (!navigator.onLine || isNetErr(error))) { try { const raw = localStorage.getItem(`sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`); const st = raw && JSON.parse(raw); if (st?.user?.id) return st; } catch { } }
  return null;
}
export async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function verifyCode(email, token) { const { data, error } = await sb.auth.verifyOtp({ email, token, type: "email" }); if (error) throw error; return data.session; }
export async function signOut() { try { localStorage.removeItem("tp-me"); indexedDB.deleteDatabase("tp-offline"); } catch { } await sb.auth.signOut(); location.reload(); }
export async function me() {
  const s = await session(); if (!s) return null;
  let { data, error } = await sb.rpc("whoami").maybeSingle();   // security-definer lookup, works before two-factor
  if (error) {   // no signal: use who this phone last signed in as, so the app can open offline (the server still checks every request)
    if (!DEMO && isNetErr(error)) { try { const c = JSON.parse(localStorage.getItem("tp-me") || "null"); if (c && c.uid === s.user?.id) data = c.data; } catch { } }
    if (!data) throw error;
  } else if (data && !DEMO) { try { localStorage.setItem("tp-me", JSON.stringify({ uid: s.user?.id, data })); } catch { } }
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
const pushOk = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const vapidBytes = k => Uint8Array.from(atob(k.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(k.length / 4) * 4, "=")), c => c.charCodeAt(0));
// store this phone's subscription against the signed-in person (the server moves it if the phone was last used by someone else)
async function savePush(sub, personId) {
  const j = sub.toJSON();
  if (!DEMO) { const { error } = await sb.rpc("push_subscribe", { p_endpoint: j.endpoint, p_keys: j.keys }); if (!error) return; if (error.code !== "PGRST202") throw error; }   // PGRST202: database function not there yet, use the table
  await q(sb.from("push_subs").upsert({ person: personId, endpoint: j.endpoint, keys: j.keys }, { onConflict: "endpoint" }));
}
export async function enablePush(personId, vapidPublic) {
  if (!pushOk()) return { ok: false, why: "This browser can't do notifications. On iPhone, add the app to your Home Screen first (Share → Add to Home Screen)." };
  try {
    await navigator.serviceWorker.register("/sw.js"); const reg = await navigator.serviceWorker.ready;   // wait until the worker is running: subscribing before that fails
    const perm = await Notification.requestPermission(); if (perm !== "granted") return { ok: false, why: perm === "denied" ? "Notifications are blocked for this app in the phone's settings." : "Notifications were not allowed." };
    const key = vapidBytes(vapidPublic); let sub = await reg.pushManager.getSubscription();
    // a subscription made with a different key can't receive our notifications: drop it and make a fresh one
    if (sub) { const cur = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null; if (cur && (cur.length !== key.length || cur.some((v, i) => v !== key[i]))) { await sub.unsubscribe(); sub = null; } }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await savePush(sub, personId); return { ok: true };
  } catch (e) { reportError("push", e); return { ok: false, why: "Couldn't turn notifications on: " + String(e?.message || e).slice(0, 120) }; }
}
// Each time the app opens: if this phone already has notifications on, make sure the server still has its subscription
// (the phone can say "on" while the server has lost the record, and then nothing ever arrives).
export async function syncPush(personId) {
  try { if (DEMO || !pushOk() || Notification.permission !== "granted") return; const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await savePush(sub, personId); }
  catch (e) { reportError("push-sync", e); }
}
export async function pushState() { if (!pushOk()) return "unsupported"; const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub ? "on" : (Notification.permission === "denied" ? "denied" : "off"); }

/* ---------- Offline ---------- */
// A save that could not reach the server (no signal) is kept on the phone and sent, in order, when the connection is back.
// Each entry carries the time it was made, so a SOD or a ticked task keeps its real time rather than the time it finally got through.
export function isNetErr(e) { return !!e && !e.code && !e.status && (!navigator.onLine || /fetch|network|load failed|abort|timeout|timed out/i.test(String(e.message || e))); }
export const uuid = () => crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16));
const OB_KEY = "tp-outbox";
function obAll() { try { const a = JSON.parse(localStorage.getItem(OB_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }
function obSave(a) { try { localStorage.setItem(OB_KEY, JSON.stringify(a)); } catch (e) { reportError("outbox-save", e); } }
/** saves waiting on this phone for the signed-in person */
export function pending() { if (DEMO) return []; return obAll().filter(o => o.who === _ctx.person); }
/** op: { kind:"insert", table, row, ret?, notify? } or { kind:"rpc", fn, args }; stamp: "sent_at" (row) or "p_at" (args) is filled with the time now */
export function queueOp(op) {
  const at = new Date().toISOString(); const o = { ...op, id: uuid(), at, who: _ctx.person };
  if (op.stamp === "sent_at" && !o.row?.sent_at) o.row = { ...o.row, sent_at: at };
  if (op.stamp === "p_at" && !o.args?.p_at) o.args = { ...o.args, p_at: at };
  obSave([...obAll(), o]); return o;
}
/** run one save now; gives up after 15 s so a dead connection doesn't leave the driver waiting */
export async function runOp(op) {
  let ctl = null, tm = null; const sig = () => { if (DEMO || typeof AbortController === "undefined") return null; ctl = new AbortController(); tm = setTimeout(() => ctl.abort(), 15000); return ctl.signal; };
  try {
    if (op.kind === "insert") { let p = sb.from(op.table).insert(op.row); if (op.ret) p = p.select("id").single(); const sg = sig(); if (sg && p.abortSignal) p = p.abortSignal(sg); return await p; }
    if (op.kind === "rpc") { let p = sb.rpc(op.fn, op.args); const sg = sig(); if (sg && p.abortSignal) p = p.abortSignal(sg); return await p; }
    return { error: { message: "unknown save", code: "tp" } };
  } catch (e) { return { data: null, error: { message: String(e?.message || e) } }; }
  finally { clearTimeout(tm); }
}
let _flushing = false;
/** send what's waiting, oldest first. Stops at the first one that still can't get through. */
export async function flushOutbox() {
  if (DEMO || _flushing || !navigator.onLine) return { sent: 0, bad: [] };
  _flushing = true; let sent = 0; const bad = [];
  try {
    for (;;) { const op = pending()[0]; if (!op) break;
      let { data, error } = await runOp(op);
      if (error && op.kind === "rpc" && op.args?.p_at && error.code === "PGRST202") { const { p_at, ...rest } = op.args; ({ data, error } = await runOp({ ...op, args: rest })); }   // database not updated to take a time yet
      if (error && isNetErr(error)) break;
      if (error && error.code !== "23505") { bad.push(String(error.message || "").slice(0, 140)); reportError("outbox", error, { op }); }   // 23505: it's already there (sent twice), which is fine
      else { sent++; if (!error && op.notify && data?.id) sb.functions.invoke("notify", { body: { type: op.notify, id: data.id } }).catch(() => { }); }
      obSave(obAll().filter(x => x.id !== op.id));
    }
  } finally { _flushing = false; }
  return { sent, bad };
}
// Last loaded data, kept on the phone so the app can open with no signal
function idb() { return new Promise((res, rej) => { const r = indexedDB.open("tp-offline", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export async function snapSave(key, val) { try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); db.close(); } catch (e) { console.warn("snapshot not saved", e); } }
export async function snapLoad(key) { try { const db = await idb(); const v = await new Promise((res, rej) => { const rq = db.transaction("kv").objectStore("kv").get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); db.close(); return v ?? null; } catch { return null; } }
