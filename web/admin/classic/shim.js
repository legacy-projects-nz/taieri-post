// Shim: runs the old Run Board (board.js, unchanged) on top of Supabase.
// window.claude.use("db") → a Firestore-like store over the legacy_docs table (roster/<week>, settings/roster, approvals/<week>, …);
// database triggers keep roster/<week> docs and the new `shifts` table in sync both ways.
import { sb, q, toast, esc, first } from "/shared/core.js";
import { requireUser } from "/shared/auth.js";

const app = document.querySelector(".wrap") || document.body;
let me;
try { me = await requireUser(document.getElementById("shim-gate") || makeGate(), { staff: true }); } catch { throw new Error("no user"); }
if (!me.can("roster")) { document.body.innerHTML = `<div style="padding:40px;font-family:system-ui;color:#eee;background:#111;min-height:100vh"><h2>Run Board (classic)</h2><p>Your account can't edit the roster. Ask Jeremy for the roster area.</p><p><a href="/admin/" style="color:#5cc0dc">Back to the owner portal</a></p></div>`; throw new Error("no roster perm"); }
removeGate();

/* ---------------- legacy_docs store ---------------- */
const cache = new Map();                 // path → data|null (known)
const docSubs = new Map();               // path → Set<cb>
const colSubs = new Map();               // prefix → Set<cb>
const snap = (path, data) => ({ exists: data != null, id: path.split("/").pop(), data: () => data == null ? undefined : JSON.parse(JSON.stringify(data)) });
function notifyDoc(path) { const d = cache.get(path) ?? null; for (const cb of docSubs.get(path) || []) { try { cb(snap(path, d)); } catch (e) { console.warn(e); } } const pre = path.split("/")[0]; for (const cb of colSubs.get(pre) || []) queryCol(pre).then(cb); }
async function fetchDoc(path) {
  if (ROSTER.test(path)) { const d = await buildWeek(ROSTER.exec(path)[1]); cache.set(path, d); return d; }
  const row = await q(sb.from("legacy_docs").select("data").eq("path", path).maybeSingle()); let d = row ? row.data : null;
  if (path === "settings/roster") d = await withLivePeople(d || {});
  cache.set(path, d); return d;
}

/* ---- roster/<monday> = the live `shifts` table (7 Nov 2026) ----
   The classic board used to keep its own copy of each week in legacy_docs, which never reached the real roster
   and never showed edits made in the new Run Board or the app. Now each week is read straight from `shifts`
   (refreshed live on any shift change) and the board's edits are written back to `shifts` as they happen.
   Assignment key "Mon|RUN" ↔ shifts(day, run): drv → slot 1, drv2–drv4 → slots 2–4; van, add-ons, trainee on slot 1;
   st/st2… (support start hour) ↔ start_at. Only fields the board actually changed are written. */
const ROSTER = /^roster\/(\d{4}-\d{2}-\d{2})$/;
const DN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const addD = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const FIELDS = ["drv", "drv2", "drv3", "drv4"];
let vanIdOf = {}, plateOfId = {}; // plate ↔ classic van id
let runsCache = null;
async function runDefs() { return runsCache ||= Object.fromEntries((await q(sb.from("runs").select("code,windows"))).map(r => [r.code, r])); }
async function withLivePeople(cfg) {
  const [people, vans] = await Promise.all([q(sb.from("people").select("id,name,role,active,cleared").eq("active", true).order("name")), q(sb.from("vans").select("plate,make,colour,active").order("plate"))]);
  const oldD = Object.fromEntries((cfg.drivers || []).map(d => [d.id, d]));
  const drivers = people.filter(p => !p.cleared && (p.role === "driver" || p.role === "owner")).map(p => ({ id: p.id, name: p.name, cleared: !!oldD[p.id]?.cleared }));
  const oldV = Object.fromEntries((cfg.vans || []).map(v => [String(v.plate).toUpperCase(), v]));
  const vlist = vans.filter(v => v.active !== false).map(v => { const o = oldV[String(v.plate).toUpperCase()]; return { id: o?.id || String(v.plate).toLowerCase().replace(/\s+/g, ""), plate: v.plate, make: o?.make ?? v.make ?? "", col: o?.col || (v.colour || "white").toLowerCase(), type: o?.type || "van" }; });
  vanIdOf = Object.fromEntries(vlist.map(v => [v.plate, v.id])); plateOfId = Object.fromEntries(vlist.map(v => [v.id, v.plate]));
  return { ...cfg, drivers, vans: vlist };
}
const hrs = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] + (+m[2]) / 60 : null; };
const hhmm = h => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
async function buildWeek(mon) {
  if (!Object.keys(vanIdOf).length) await withLivePeople((await q(sb.from("legacy_docs").select("data").eq("path", "settings/roster").maybeSingle()))?.data || {});
  const [rows, note, R] = await Promise.all([q(sb.from("shifts").select("*").gte("day", mon).lte("day", addD(mon, 6))), q(sb.from("week_notes").select("notes").eq("week_start", mon).maybeSingle()), runDefs()]);
  const assign = {};
  for (const s of rows) {
    if (!s.slot || s.slot > 4) continue; const D = DN[(new Date(s.day + "T12:00:00Z").getUTCDay() + 6) % 7]; const k = D + "|" + s.run; const o = assign[k] ||= {};
    const f = FIELDS[s.slot - 1]; if (s.driver) o[f] = s.driver;
    if (s.slot === 1) { if (s.van) o.van = vanIdOf[s.van] || String(s.van).toLowerCase(); if ((s.addons || []).length) o.add = s.addons.slice(); if (s.trainee) o.tr = s.trainee; }
    const def = R[s.run]?.windows?.[D]?.[0]?.[0]; const st = hrs(s.start_at);
    if (/^SUP/.test(s.run) && st != null && s.start_at?.slice(0, 5) !== def && st >= 5 && st <= 11) o["st" + f.slice(3)] = st;
  }
  return { assign, notes: note?.notes || "", updated: Date.now(), live: true };
}
async function writeWeek(path, data) {
  const mon = ROSTER.exec(path)[1]; const prev = cache.get(path) || await buildWeek(mon); const A = data.assign || {}, P = prev.assign || {};
  const cur = await q(sb.from("shifts").select("id,day,run,slot,driver,van,addons,trainee,start_at").gte("day", mon).lte("day", addD(mon, 6)));
  const find = (day, run, slot) => cur.find(s => s.day === day && s.run === run && s.slot === slot);
  const ops = [];
  for (const k of new Set([...Object.keys(A), ...Object.keys(P)])) {
    const a = A[k] || {}, b = P[k] || {}; if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const [D, run] = k.split("|"); const di = DN.indexOf(D); if (di < 0) continue; const day = addD(mon, di);
    FIELDS.forEach((f, i) => {
      const slot = i + 1, st = "st" + f.slice(3); const ex = find(day, run, slot);
      const same1 = slot !== 1 || (a.van === b.van && JSON.stringify(a.add || []) === JSON.stringify(b.add || []) && a.tr === b.tr);
      if (a[f] === b[f] && a[st] === b[st] && same1) return;
      if (!a[f]) { if (ex) ops.push(sb.from("shifts").delete().eq("id", ex.id)); return; }
      const patch = { driver: a[f] };
      if (slot === 1) { patch.van = a.van ? (plateOfId[a.van] || String(a.van).toUpperCase()) : null; patch.addons = a.add || []; patch.trainee = a.tr || null; }
      if (a[st] != null) patch.start_at = hhmm(+a[st]); else if (b[st] != null) patch.start_at = null;
      ops.push(ex ? sb.from("shifts").update(patch).eq("id", ex.id) : sb.from("shifts").insert({ day, run, slot, ...patch }));
    });
  }
  if ((data.notes || "") !== (prev.notes || "")) ops.push(sb.from("week_notes").upsert({ week_start: mon, notes: data.notes || "" }));
  for (const r of await Promise.all(ops)) if (r.error) throw r.error;
  cache.set(path, { assign: JSON.parse(JSON.stringify(A)), notes: data.notes || "", updated: Date.now(), live: true });
}
// any change to the live roster (new Run Board, driver app, another device) → rebuild the weeks this board has open
const refreshWeeks = (() => { let t; return () => { clearTimeout(t); t = setTimeout(async () => { for (const path of [...cache.keys()].filter(p => ROSTER.test(p) && docSubs.get(p)?.size)) { await fetchDoc(path); notifyDoc(path); } }, 700); }; })();
sb.channel("classic-shifts").on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, refreshWeeks).on("postgres_changes", { event: "*", schema: "public", table: "week_notes" }, refreshWeeks).subscribe();
async function queryCol(pre) { const rows = await q(sb.from("legacy_docs").select("path,data").like("path", pre + "/%")); for (const r of rows) cache.set(r.path, r.data); return { docs: rows.map(r => snap(r.path, r.data)), size: rows.length, empty: !rows.length, forEach(f) { this.docs.forEach(f); } }; }
function setDeep(obj, key, val) { const parts = key.split("."); let o = obj; for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = (o[parts[i]] && typeof o[parts[i]] === "object") ? o[parts[i]] : {}; o = o[parts[i]]; } o[parts[parts.length - 1]] = val; }
async function writeDoc(path, data) { if (ROSTER.test(path)) { await writeWeek(path, data); notifyDoc(path); return; } const { error } = await sb.from("legacy_docs").upsert({ path, data, updated_at: new Date().toISOString() }); if (error) throw error; cache.set(path, data); notifyDoc(path); }

const READONLY = { "settings/timing": true };
function docRef(path) {
  return {
    id: path.split("/").pop(), path,
    async get() { if (path === "settings/timing") return snap(path, await timingDoc()); if (path.startsWith("leave/")) return snap(path, null); return snap(path, cache.has(path) ? cache.get(path) : await fetchDoc(path)); },
    async set(data, opts) { if (READONLY[path] || path.startsWith("leave")) { toast("Leave and timing rules are managed in the new portal tabs", "err"); return; } if (opts?.merge) { const cur = (cache.has(path) ? cache.get(path) : await fetchDoc(path)) || {}; data = { ...cur, ...data }; } await writeDoc(path, data); },
    async update(patch) { if (READONLY[path] || path.startsWith("leave")) { toast("Leave is managed in the new Leave tab", "err"); return; } const cur = JSON.parse(JSON.stringify((cache.has(path) ? cache.get(path) : await fetchDoc(path)) || {})); for (const [k, v] of Object.entries(patch)) setDeep(cur, k, v); await writeDoc(path, cur); },
    async delete() { const { error } = await sb.from("legacy_docs").delete().eq("path", path); if (error) throw error; cache.set(path, null); notifyDoc(path); },
    onSnapshot(cb, err) {
      if (path === "settings/timing") { timingDoc().then(d => cb(snap(path, d))).catch(err || (() => { })); return () => { }; }
      if (path.startsWith("leave/")) { cb(snap(path, null)); return () => { }; }
      if (!docSubs.has(path)) docSubs.set(path, new Set()); docSubs.get(path).add(cb);
      (cache.has(path) ? Promise.resolve(cache.get(path)) : fetchDoc(path)).then(d => cb(snap(path, d))).catch(e => err && err(e));
      return () => docSubs.get(path)?.delete(cb);
    },
  };
}
function colRef(pre) {
  const r = { orderBy() { return r; }, limit() { return r; }, where() { return r; }, doc: id => docRef(pre + "/" + id),
    async get() { return pre === "leave" ? leaveQuery() : queryCol(pre); },
    async add(data) { const id = Math.random().toString(36).slice(2, 12); await writeDoc(pre + "/" + id, data); return { id }; },
    onSnapshot(cb, err) { if (pre === "leave") { leaveQuery().then(cb).catch(err || (() => { })); const ch = sb.channel("legacy-leave").on("postgres_changes", { event: "*", schema: "public", table: "leave_requests" }, () => leaveQuery().then(cb)).subscribe(); return () => sb.removeChannel(ch); }
      if (!colSubs.has(pre)) colSubs.set(pre, new Set()); colSubs.get(pre).add(cb); queryCol(pre).then(cb).catch(e => err && err(e)); return () => colSubs.get(pre)?.delete(cb); } };
  return r;
}
// Leave for the classic board: read-only mirror of the new leave_requests table in the old {driver, requests[]} shape
async function leaveQuery() {
  const rows = await q(sb.from("leave_requests").select("*")); const by = {};
  for (const l of rows) (by[l.driver] ??= []).push({ id: l.id, driver: l.driver, type: l.type, from: l.date_from, to: l.date_to, part: l.part, notes: l.notes || "", email: "", status: l.status, created: l.created_at, decided: l.decided_at || "", reply: l.reply || "" });
  const docs = Object.entries(by).map(([d, requests]) => snap("leave/" + d, { driver: d, requests }));
  return { docs, size: docs.length, empty: !docs.length, forEach(f) { docs.forEach(f); } };
}
// Timing rules for the classic board (tw_ add-ons), read-only from timing_rules
async function timingDoc() {
  const rules = await q(sb.from("timing_rules").select("*").eq("active", true));
  return { updated: new Date().toISOString(), rules: rules.map(r => ({ id: r.id, name: r.name, from: r.opens ? r.opens.slice(0, 5) : "", to: r.closes ? r.closes.slice(0, 5) : "", runs: r.runs, run: r.runs[0], rl: r.runs.join(" / "), days: r.days.map(d => d - 1), note: r.note || "", add: r.addon && !r.addon.startsWith("tw_") ? r.addon : "" })) };
}
// realtime: any legacy_docs change → notify
sb.channel("legacy-docs").on("postgres_changes", { event: "*", schema: "public", table: "legacy_docs" }, p => { const row = p.new?.path ? p.new : p.old; if (!row?.path) return; cache.set(row.path, p.eventType === "DELETE" ? null : p.new.data); notifyDoc(row.path); }).subscribe();

const DBshim = { doc: docRef, collection: colRef };
const userShim = { isOwner: async () => me.isOwner, canEdit: async () => me.can("roster"), id: async () => me.id, email: async () => me.email };
const mcpShim = { callTool: async (server, tool, args) => {
  if (tool === "outlook_send_mail") { const { data, error } = await sb.functions.invoke("notify", { body: { type: "email", to: args.to, cc: args.cc, subject: args.subject, html: args.body } }); if (error) throw error; return data; }
  if (tool === "fire_trigger") return { ok: true }; // the new system is live already; nothing to sync
  throw new Error("not available: " + tool); } };
window.claude = { use: async name => ({ db: DBshim, user: userShim, mcp: mcpShim, sample: null })[name] ?? null, hot: null };

// a small banner so it's clear this is the classic board on the new database
const b = document.createElement("div"); b.style.cssText = "font:600 12px/1.4 ui-monospace,monospace;background:#16323b;color:#5cc0dc;border:1px solid #5cc0dc;border-radius:8px;padding:6px 10px;margin:8px 0";
b.innerHTML = `Classic Run Board on the new database · every change lands on the live roster straight away · when you're done, open <a href="/admin/#runboard" style="color:#eef1f4">Run Board (new)</a> and press <b>Approve roster</b> (new week) or <b>Push changes</b> (edits) so drivers get it · signed in as ${esc(first(me.name))}`;
document.querySelector(".wrap")?.prepend(b);

// public holidays from settings: board.js blanks those days out
try { window.TP_HOLIDAYS = (await q(sb.from("settings").select("value").eq("key", "holidays").maybeSingle()))?.value || {}; } catch { window.TP_HOLIDAYS = {}; }

// finally load the untouched board code
const s = document.createElement("script"); s.src = "/admin/classic/board.js"; document.body.appendChild(s);

function makeGate() { const g = document.createElement("div"); g.id = "shim-gate"; g.style.cssText = "position:fixed;inset:0;background:#000;z-index:999;overflow:auto;color:#eef1f4"; document.body.appendChild(g); return g; }
function removeGate() { document.getElementById("shim-gate")?.remove(); }
