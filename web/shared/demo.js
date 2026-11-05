// Demo driver profile: a pretend driver with made-up data, kept only in this browser. Nothing here touches the real database.
// Turned on by /?demo (or by typing a demo email on the sign-in screen); turned off by Sign out.
import { RUNS, ADDONS, RULES, SETTINGS, VANS } from "./demo-config.js";
import { TZ } from "./config.js";

export const DEMO_EMAILS = ["editacarla@outlook.com", "demo@taieripost.nz"];
const KEY = "tp-demo", STORE = "tp-demo-store";
export const ME = { id: "demo-edi", name: "Edi\u00a0❤️", email: "editacarla@outlook.com", phone: "021 555 0123", role: "driver", active: true, perms: [], cleared: false, licence_class: "Class 1 full", licence_expiry: null, dg_expiry: null, started: null, rate: 26, notes: null, pay_exclude: false, user_id: "demo" };
const JEREMY = { id: "demo-jeremy", name: "Jeremy", role: "owner" };

export function isDemo() { try { const u = new URL(location.href); if (u.searchParams.has("demo")) { localStorage.setItem(KEY, "1"); u.searchParams.delete("demo"); history.replaceState(null, "", u.pathname + u.search + u.hash); } return localStorage.getItem(KEY) === "1"; } catch { return false; } }
export function startDemo() { try { localStorage.setItem(KEY, "1"); } catch { } }
export function stopDemo() { try { localStorage.removeItem(KEY); localStorage.removeItem(STORE); } catch { } }

/* ---------- NZ dates (self-contained so this file has no dependency on core.js) ---------- */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const F = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function nz(d = new Date()) { const p = {}; for (const x of F.formatToParts(d)) p[x.type] = x.value; return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute }; }
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = iso => (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7;
const monOf = iso => addDays(iso, -dow(iso));
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? +m[1] * 60 + +m[2] : null; };
const hhmm = min => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
function nzToIso(date, min) { const guess = new Date(`${date}T${hhmm(min)}:00Z`); const p = {}; for (const x of F.formatToParts(guess)) p[x.type] = x.value; const asNz = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`); return new Date(guess.getTime() - (asNz - guess)).toISOString(); }
const nowIso = () => new Date().toISOString();

/* ---------- seeded random so Reset gives the same roster back and New runs gives a fresh one ---------- */
let seed = 1; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)]; const between = (a, b) => Math.round(a + rnd() * (b - a));
let uid = 0; const id = p => `${p}-${++uid}`;

/* ---------- generate a whole driver's world ---------- */
export function generate(s = 1) {
  seed = s; uid = 0;
  const t = nz().date, n = nz();
  const D = { people: [{ ...ME }], people_public: [{ id: ME.id, name: ME.name, role: "driver" }, JEREMY], runs: RUNS, vans: VANS.map(v => ({ ...v, wof_due: addDays(t, between(20, 150)), rego_due: addDays(t, between(10, 300)), odometer_at: addDays(t, -between(1, 6)) })), addons: ADDONS, timing_rules: RULES,
    settings: Object.entries(SETTINGS).map(([key, value]) => ({ key, value })), shifts: [], sod: [], eod: [], marks: [], entries: [], nzpost_feed: [], roster_changes: [], roster_change_items: [], change_acks: [], messages: [], message_recipients: [], leave_requests: [], alerts: [], breaks: [], pickups: [], vehicle_checks: [], eff_overrides: [], locations: [], push_subs: [], access_info: [{ id: 1, body: "Demo only — these aren't real.\nScanner PIN: 1234\nDepot key box: 0000", updated_at: nowIso(), updated_by: JEREMY.id }] };
  // weekly pattern: a sort then a run most weekdays, a second run some afternoons, some Saturdays
  const patterns = [
    { Mon: ["SUP", "TUA"], Tue: ["SUP", "TUA", "RAM"], Wed: ["SUP", "TUA"], Thu: ["SUP", "TUA", "RAM"], Fri: ["SUP", "TUA"], Sat: ["WH"] },
    { Mon: ["SUP", "FLY"], Tue: ["SUP", "FLY"], Wed: ["SUP", "FLY"], Thu: ["SUP", "FLY", "RAM"], Fri: ["SUP", "FLY"] },
    { Mon: ["PCB", "RSB"], Tue: ["PCB"], Wed: ["PCB", "RSB"], Thu: ["PCB"], Fri: ["PCB", "RSB"], Sat: ["WH"] },
    { Mon: ["SUP2", "S"], Tue: ["SUP2", "S"], Wed: ["SUP2", "T"], Thu: ["SUP2", "S"], Fri: ["SUP2", "T"] },
    { Mon: ["SUP", "DB"], Tue: ["SUP", "DB", "RAM"], Wed: ["SUP", "LAW"], Thu: ["SUP", "DB"], Fri: ["SUP", "LAW"] },
  ];
  const pat = pick(patterns); const van = pick(VANS).plate; const runsBy = Object.fromEntries(RUNS.map(r => [r.code, r]));
  const legsFor = code => ({ TUA: ["outram", "airport"], FLY: ["airport", "milton"], DB: ["milton", "balclutha", "owaka"], RAM: ["airport"], PCB: ["fish", "rose"], RSB: ["sb", "pc", "digi"], LAW: [] })[code] || [];
  const from = addDays(monOf(t), -56), to = addDays(monOf(t), 13);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dn = DAYS[dow(d)]; const codes = pat[dn]; if (!codes || SETTINGS.holidays[d]) continue;
    if (d > t && d >= addDays(monOf(t), 7) && rnd() < 0.15) continue;   // next week: the odd day off
    const dayShifts = codes.map(code => { const r = runsBy[code]; const w = r.windows[dn]; if (!w) return null; const isSort = /^SUP/.test(code);
      const sh = { id: id("shift"), day: d, run: code, driver: ME.id, van: r.needs_van ? van : null, start_at: w[0][0], end_at: w[0][1], addons: isSort ? [] : legsFor(code).filter(() => rnd() < 0.6), note: null, updated_at: nowIso(), slot: 1, trainee: null, plan: {}, done: {}, bu_kind: null, bu_block: null };
      return sh; }).filter(Boolean);
    if (d === t) { // today: shift it so the run starts about now, so SOD / EOD can be tried straight away
      const st = Math.max(0, n.min - 10); let cur = st; for (const sh of dayShifts) { const len = toMin(sh.end_at) - toMin(sh.start_at); sh.start_at = hhmm(cur); sh.end_at = hhmm(Math.min(1439, cur + len)); cur += len; }
    }
    D.shifts.push(...dayShifts);
    if (d >= t) continue;
    // the past: SOD and EODs, mostly on time
    const first = dayShifts[0]; const st = toMin(first.start_at); const lateSod = rnd() < 0.12, missSod = rnd() < 0.04;
    if (!missSod) D.sod.push({ shift_id: first.id, driver: ME.id, sent_at: nzToIso(d, st + (lateSod ? between(8, 40) : between(-6, 4))), edited_at: null, van: first.van || dayShifts.find(x => x.van)?.van || null, start_km: null, note: null, run_id: dayShifts.filter(x => !/^SUP/.test(x.run)).map(x => SETTINGS.runCodes[x.run] || x.run).join(" + ") });
    for (const sh of dayShifts) { const isSort = /^SUP/.test(sh.run); if (isSort && dayShifts.length > 1) continue; if (rnd() < 0.04) continue;   // the odd missing EOD
      const en = toMin(sh.end_at); const fin = en + between(-25, 35); const late = rnd() < 0.1; const typ = SETTINGS.typical[sh.run] || 60; const net = runsBy[sh.run].network;
      D.eod.push({ shift_id: sh.id, driver: ME.id, sent_at: nzToIso(d, fin + (late ? between(95, 160) : between(2, 25))), finish_time: hhmm(fin), end_km: null, stops: Math.round(typ * (net === "tge" ? 0.65 : 0.8) * (0.85 + rnd() * 0.3)), parcels: Math.round(typ * (0.8 + rnd() * 0.4)), pickups: net === "tge" ? between(0, 4) : null, pickup_parcels: net === "tge" ? between(0, 8) : null, trays: isSort ? null : pick([0.5, 1, 1, 1.5]), sort_min: isSort ? between(80, 110) : (net === "tge" ? between(60, 95) : null), sorted_parcels: net === "nzp" ? rnd() < 0.7 : null, sorted_mail: net === "nzp" ? rnd() < 0.5 : null, nzc_ph: ["TUA", "FLY", "DB"].includes(sh.run) ? rnd() < 0.3 : null, cycled: between(0, 6), legs: sh.addons.filter(a => !["fish", "rose", "sb", "pc", "digi"].includes(a)), newspapers: ["TUA", "FLY"].includes(sh.run) && dow(d) === 2, note: null, run_id: SETTINGS.runCodes[sh.run] || null, edited_at: null, edited_by: null, extra: null });
      for (const a of sh.addons) if (rnd() < 0.8) sh.done[a] = nzToIso(d, between(st + 60, fin)); if (rnd() < 0.8) sh.done.tw_twrunsheet = nzToIso(d, fin);
      const fc = SETTINGS.runCodes[sh.run]; if (fc && !isSort) { const items = between(40, 130); D.nzpost_feed.push({ day: d, feed_code: fc, items, compliant: items - (rnd() < 0.7 ? 0 : between(1, 4)), read_at: nzToIso(addDays(d, 1), 420) }); }
    }
  }
  // notes from Jeremy
  const past = [...new Set(D.shifts.filter(s => s.day < t && s.day >= addDays(t, -30)).map(s => s.day))].sort();
  const E = (day, kind, title, note, o = {}) => D.entries.push({ id: id("entry"), driver: ME.id, day, run: null, kind, title, note, admin_pts: null, safety_pct: null, eff_pct: null, excused: false, show_driver: true, created_by: JEREMY.id, created_at: nzToIso(day, 1100), seen_at: null, review_requested_at: null, review_note: null, review_resolved_at: null, review_resolved_by: null, pct_off: null, issue: null, ...o });
  if (past.length > 6) { E(past[past.length - 2], "praise", "Great week — every post on time", "Keep it up 👏"); E(past[Math.floor(past.length / 2)], "mistake", "Parcel left at the wrong address", "Customer rang the depot. Double-check the house number on rural boxes.", { pct_off: 10 }); E(past[2], "note", "Reminder: photos of receivers", "Caption each one with the time, please."); E(past[past.length - 4], "adjust", "Bonus point for covering Saturday", null, { admin_pts: 2 }); }
  // messages
  const M = (daysAgo, body, needs = false, read = true, confirmed = false) => { const m = { id: id("msg"), sender: JEREMY.id, body, needs_confirm: needs, created_at: new Date(Date.now() - daysAgo * 86400e3 - 3600e3).toISOString() }; D.messages.push(m); D.message_recipients.push({ message_id: m.id, person: ME.id, read_at: read ? m.created_at : null, confirmed_at: confirmed ? m.created_at : null }); };
  M(9, "Roster for next week is out. Shout if anything clashes.", false, true); M(4, "Depot gate code changes Monday — it's in Passwords & logins in the app.", true, true, true); M(0.5, "Please do the weekly vehicle check before 5pm Thursday. Tap Got it so I know you've seen this. 🙂", true, false);
  // roster change for next week, not confirmed yet
  const nxt = D.shifts.find(s => s.day >= addDays(monOf(t), 7) && !/^SUP/.test(s.run)); if (nxt) { const rc = { id: id("rc"), created_by: JEREMY.id, status: "sent", approved_by: JEREMY.id, sent_at: new Date(Date.now() - 2 * 3600e3).toISOString(), reason: "Swap to cover leave", created_at: nowIso() }; D.roster_changes.push(rc);
    const it = { id: id("rci"), change_id: rc.id, shift_id: nxt.id, day: nxt.day, run: nxt.run, before: { start_at: nxt.start_at }, after: { start_at: nxt.start_at }, affects: [ME.id], summary: `${DAYS[dow(nxt.day)]} ${nxt.day.slice(8)}: ${nxt.run} — van changes to ${VANS.find(v => v.plate !== van).plate}` }; D.roster_change_items.push(it); D.change_acks.push({ item_id: it.id, driver: ME.id, seen_at: null, confirmed_at: null, dismissed_at: null, confirmed_by: null }); }
  // leave: one approved in the past, one waiting
  const L = (f, to, status, type, notes, reply) => D.leave_requests.push({ id: id("leave"), driver: ME.id, type, date_from: f, date_to: to, part: "full", notes, status, decided_by: status === "pending" ? null : JEREMY.id, decided_at: status === "pending" ? null : nzToIso(addDays(f, -10), 900), reply, acked_email_at: nzToIso(addDays(f, -12), 1000), created_at: nzToIso(addDays(f, -12), 1000) });
  L(addDays(t, -21), addDays(t, -20), "approved", "annual", "Long weekend away", "No problem, enjoy!"); L(addDays(t, 18), addDays(t, 19), "pending", "dayoff", "Family visiting", null);
  // one vehicle check two weeks ago, a few pick-ups this month
  D.vehicle_checks.push({ id: id("vchk"), van, driver: ME.id, week_start: addDays(monOf(t), -14), at: nzToIso(addDays(monOf(t), -11), 960), odometer: (VANS.find(v => v.plate === van).odometer || 100000) - 900, rucs_left: 2600, washed: true, tyres_ok: true, bodywork: "OK", vault_ok: true, service_due: null, notes: null, photos: [] });
  for (const d of past.slice(-6).filter(() => rnd() < 0.6)) D.pickups.push({ id: id("pu"), day: d, area: "Rural", customer: pick(["NZC", "PH"]), small: between(1, 6), large: between(0, 2), note: null, driver: ME.id, created_by: ME.id, created_at: nzToIso(d, 1000), source: "depot" });
  return D;
}

/* ---------- the pretend database ---------- */
let DB = null; let SEED = 1;
function load() { if (DB) return DB; try { const s = JSON.parse(localStorage.getItem(STORE) || "null"); if (s && s.db) { if (s.day === nz().date) { DB = s.db; SEED = s.seed; uid = s.uid || 5000; return DB; } return regen(s.seed); } } catch { } return regen(1); }
function save() { try { localStorage.setItem(STORE, JSON.stringify({ db: DB, seed: SEED, uid, day: nz().date })); } catch { } }
export function regen(s) { SEED = s ?? (Math.floor(Math.random() * 1e6) + 2); DB = generate(SEED); uid = 5000; save(); return DB; }
export function resetDemo() { return regen(SEED); }
export function newRuns() { return regen(); }

const FK = { roster_changes: ["change_id", "roster_changes"], messages: ["message_id", "messages"] };   // embedded selects used by the app
function get(row, path) { return path.split(".").reduce((o, k) => o?.[k], row); }
function builder(table) {
  const st = { table, op: "select", filters: [], order: null, limit: null, single: null, embed: [], rows: null, opts: {} };
  const b = {
    select(cols = "*") { if (st.op === "select") { for (const m of String(cols).matchAll(/(\w+)!inner\(/g)) st.embed.push(m[1]); } return b; },
    insert(rows) { st.op = "insert"; st.rows = Array.isArray(rows) ? rows : [rows]; return b; },
    upsert(rows, opts = {}) { st.op = "upsert"; st.rows = Array.isArray(rows) ? rows : [rows]; st.opts = opts; return b; },
    update(patch) { st.op = "update"; st.patch = patch; return b; },
    delete() { st.op = "delete"; return b; },
    eq(k, v) { st.filters.push(r => get(r, k) == v); return b; }, neq(k, v) { st.filters.push(r => get(r, k) != v); return b; },
    gte(k, v) { st.filters.push(r => get(r, k) != null && get(r, k) >= v); return b; }, lte(k, v) { st.filters.push(r => get(r, k) != null && get(r, k) <= v); return b; },
    gt(k, v) { st.filters.push(r => get(r, k) != null && get(r, k) > v); return b; }, lt(k, v) { st.filters.push(r => get(r, k) != null && get(r, k) < v); return b; },
    in(k, vs) { st.filters.push(r => vs.includes(get(r, k))); return b; }, is(k, v) { st.filters.push(r => get(r, k) == v); return b; },
    contains(k, vs) { st.filters.push(r => (get(r, k) || []).some(x => vs.includes(x))); return b; },
    or(expr) { const alts = expr.split(",").map(a => { const [k, op, ...v] = a.split("."); return { k, op, v: v.join(".") }; }); st.filters.push(r => alts.some(({ k, op, v }) => op === "eq" ? get(r, k) == v : op === "is" ? get(r, k) == (v === "null" ? null : v) : false)); return b; },
    order(k, o = {}) { st.order = { k: o.referencedTable ? `${o.referencedTable}.${k}` : k, asc: o.ascending !== false }; return b; },
    limit(n) { st.limit = n; return b; }, maybeSingle() { st.single = "maybe"; return b; }, single() { st.single = "one"; return b; },
    then(res, rej) { try { res(run(st)); } catch (e) { res({ data: null, error: { message: e.message } }); } },
  };
  return b;
}
function run(st) {
  const db = load(); const T = db[st.table] ??= [];
  const hydrate = r => { if (!st.embed.length) return r; const o = { ...r }; for (const e of st.embed) { const [fk, tbl] = FK[e] || []; if (fk) o[e] = (db[tbl] || []).find(x => x.id === r[fk]) || null; } return o; };
  const match = r => st.filters.every(f => f(hydrate(r)));
  if (st.op === "select") {
    let rows = T.map(hydrate).filter(r => st.filters.every(f => f(r))); if (st.embed.length) rows = rows.filter(r => st.embed.every(e => r[e]));
    if (st.order) rows.sort((a, b) => { const x = get(a, st.order.k) ?? "", y = get(b, st.order.k) ?? ""; return (x < y ? -1 : x > y ? 1 : 0) * (st.order.asc ? 1 : -1); });
    if (st.limit) rows = rows.slice(0, st.limit);
    if (st.single) return { data: rows[0] ?? null, error: st.single === "one" && !rows[0] ? { message: "No rows" } : null };
    return { data: rows, error: null };
  }
  if (st.op === "insert" || st.op === "upsert") {
    const keys = st.opts.onConflict ? st.opts.onConflict.split(",") : st.table === "sod" || st.table === "eod" ? ["shift_id"] : ["id"];
    for (const r of st.rows) { const row = { created_at: nowIso(), ...r }; if (!("id" in row) && keys[0] === "id") row.id = id(st.table); if ((st.table === "sod" || st.table === "eod") && !row.sent_at) row.sent_at = nowIso(); if (st.table === "leave_requests") Object.assign(row, { status: "pending", acked_email_at: nowIso() });
      const i = T.findIndex(x => keys.every(k => x[k] == row[k])); if (i >= 0) { if (st.op === "insert") return { data: null, error: { message: "Already posted" } }; T[i] = { ...T[i], ...row }; } else T.push(row); }
    save(); return { data: st.rows, error: null };
  }
  if (st.op === "update") { let n = 0; for (const r of T) if (match(r)) { Object.assign(r, st.patch); n++; } save(); return { data: null, error: null, count: n }; }
  if (st.op === "delete") { db[st.table] = T.filter(r => !match(r)); save(); return { data: null, error: null }; }
  return { data: null, error: { message: "unsupported" } };
}
function rpc(name, a = {}) {
  const db = load(); const shift = () => db.shifts.find(s => s.id === a.p_shift); const err = m => ({ data: null, error: { message: m } });
  switch (name) {
    case "whoami": return { data: db.people[0], error: null };
    case "login_status": return { data: [], error: null };
    case "my_eff_overrides": return { data: [], error: null };
    case "break_start": { if (db.breaks.some(b => !b.ended_at)) return err("You're already on a break"); const r = { id: id("brk"), shift_id: a.p_shift, driver: ME.id, started_at: nowIso(), ended_at: null }; db.breaks.push(r); save(); return { data: r, error: null }; }
    case "break_end": { const r = db.breaks.find(b => !b.ended_at); if (!r) return err("No break running"); r.ended_at = nowIso(); save(); return { data: r, error: null }; }
    case "task_done": { const s = shift(); if (!s) return err("No such shift"); (s.done ??= {})[a.p_addon] = nowIso(); save(); return { data: null, error: null }; }
    case "task_undo": { const s = shift(); if (s?.done) delete s.done[a.p_addon]; save(); return { data: null, error: null }; }
    case "set_my_addons": { const s = shift(); if (!s) return err("No such shift"); s.addons = a.p_addons; save(); return { data: null, error: null }; }
    case "set_my_plan": { const s = shift(); if (!s) return err("No such shift"); s.plan = a.p_plan; save(); return { data: null, error: null }; }
    case "alert_ack": { db.alerts = db.alerts.filter(x => x.id !== a.p_id); save(); return { data: null, error: null }; }
    case "entry_seen": { const e = db.entries.find(x => x.id === a.p_id); if (e) e.seen_at = nowIso(); save(); return { data: null, error: null }; }
    case "entry_review": { const e = db.entries.find(x => x.id === a.p_id); if (e) { e.review_requested_at = nowIso(); e.review_note = a.p_note || null; } save(); return { data: null, error: null }; }
    case "update_my_profile": { Object.assign(db.people[0], { phone: a.p_phone, licence_class: a.p_lic_class, licence_expiry: a.p_lic_exp, dg_expiry: a.p_dg_exp }); save(); return { data: null, error: null }; }
    default: return { data: null, error: null };
  }
}
const session = { user: { id: "demo", email: ME.email }, access_token: "demo" };
export function demoClient() {
  return {
    demo: true,
    from: builder,
    rpc: (name, args) => { const r = rpc(name, args); const p = Promise.resolve(r); p.maybeSingle = () => Promise.resolve(r); p.single = () => Promise.resolve(r); return p; },
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() { } }),
    removeChannel() { },
    storage: { from: () => ({ upload: async () => ({ data: { path: "demo" }, error: null }) }) },
    auth: {
      getSession: async () => ({ data: { session } }), getUser: async () => ({ data: { user: session.user } }),
      signOut: async () => { stopDemo(); }, onAuthStateChange() { return { data: { subscription: { unsubscribe() { } } } }; },
      signInWithOtp: async () => ({ error: null }), verifyOtp: async () => ({ data: { session }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" } }), listFactors: async () => ({ data: { totp: [], all: [] } }) },
    },
  };
}
