// Pick-ups tab: Rural / South / Owaka / Lawrence / Balclutha depot parcel pick-ups that are invoiced separately.
// Drivers log counts in the app. Two sub-tabs:
//   Invoices   – month totals per customer + extra lines, exported as a Xero sales-invoice CSV (one invoice per customer)
//   Data entry – owner/admin enter counts for any driver, edit or delete entries, and add extra invoice lines
// Item codes, account codes, contacts and line wording match the invoices already in Xero.
import { sb, q, today, addDays, label, esc, $, $$, toast } from "/shared/core.js";
import { S, sheet, opt, nm, render, fn } from "/admin/admin.js";

export const AREAS = ["Rural", "South", "Owaka", "Lawrence", "Balclutha"];
const custFor = a => a === "South" ? ["TGE"] : a === "Rural" ? ["NZC", "PH", "TGE"] : ["NZC", "PH"];   // South = TGE only; TGE also on Rural; never on Owaka / Lawrence / Balclutha
const custErr = r => custFor(r.area).includes(r.customer) ? null : r.area === "South" ? "South is for TGE pick-ups only" : "TGE pick-ups are Rural or South only";
const SOURCES = [["depot", "Depot"], ["customer", "Customer"]];
const AREA_SHORT = { Lawrence: "Law", Owaka: "Owaka", Rural: "Rural", South: "South", Balclutha: "Bal Depot" };
export const CUSTOMERS = {
  NZC: { name: "NZ Couriers - Aaron Johnston", short: "NZC", due: 7, acct: "200", tax: "15% GST on Income", small: { code: "NZCS", rate: 4.5, desc: "NZC - Small" }, large: { code: "NZCL", rate: 8, desc: "NZ Couriers - Large" } },
  PH: { name: "Post Haste", short: "Post Haste", due: 7, acct: "200", tax: "15% GST on Income", small: { code: "PHS", rate: 4, desc: "Post Haste - Small" }, large: { code: "PHL", rate: 8, desc: "Post Haste - Large" } },
  TGE: { name: "NZ National Network LTD", short: "TGE", due: 0, acct: "201", tax: "15% GST on Income", small: { code: "TGE - OD - Pick ups", rate: 6, desc: "TGE - Small" }, large: { code: "TGE - OD - Pick ups", rate: 7.5, desc: "TGE - Large" } },
};
// Ready-made extra lines (from items already used in Xero); "Other" is free text
const EXTRA_PRESETS = [
  { k: "tge-add", cust: "TGE", code: "TGE - Special Add", acct: "202", desc: "TGE Request Additional Work", price: "" },
  { k: "tge-pu", cust: "TGE", code: "TGE - OD - Pick ups", acct: "201", desc: "TGE - OD - Pick ups", price: 6 },
  { k: "nzc-s", cust: "NZC", code: "NZCS", acct: "200", desc: "NZC - Small", price: 4.5 },
  { k: "nzc-l", cust: "NZC", code: "NZCL", acct: "200", desc: "NZ Couriers - Large", price: 8 },
  { k: "ph-s", cust: "PH", code: "PHS", acct: "200", desc: "Post Haste - Small", price: 4 },
  { k: "ph-l", cust: "PH", code: "PHL", acct: "200", desc: "Post Haste - Large", price: 8 },
  // Owaka extras
  { k: "nzc-telford", cust: "NZC", code: "", acct: "200", desc: "NZC - Telford Fee - Owaka", price: 5 },
  { k: "nzc-owaka-min", cust: "NZC", code: "", acct: "200", desc: "NZC - Minimum Charge - Owaka - Bal Depot Pick Up", price: 2.5 },
  { k: "ph-owaka-min", cust: "PH", code: "", acct: "200", desc: "Post Haste - Minimum Charge - Owaka - Bal Depot Pick Up", price: 2.5 },
  // Balclutha depot pick-ups (priced at the current small/large rates)
  { k: "nzc-bal-s", cust: "NZC", code: "NZCS", acct: "200", desc: "NZC - Small - Pick Ups - Bal Depot", price: () => rates().NZC.small.rate },
  { k: "nzc-bal-l", cust: "NZC", code: "NZCL", acct: "200", desc: "NZ Couriers - Large - Pick Ups - Bal Depot", price: () => rates().NZC.large.rate },
  { k: "ph-bal-s", cust: "PH", code: "PHS", acct: "200", desc: "Post Haste - Small - Pick Ups - Bal Depot", price: () => rates().PH.small.rate },
  { k: "ph-bal-l", cust: "PH", code: "PHL", acct: "200", desc: "Post Haste - Large - Pick Ups - Bal Depot", price: () => rates().PH.large.rate },
  { k: "other", cust: "", code: "", acct: "200", desc: "", price: "" },
];
const ACCOUNTS = [["200", "200 · Sales"], ["201", "201 · Sales - Other Post Companies"], ["202", "202 · Sales - TGE"], ["203", "203 · Sales - Other"], ["204", "204 · Sales - MFB"], ["260", "260 · Other Revenue"]];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_L = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let ym = null;    // "YYYY-MM"
let rows = [];    // pickups for the selected month
let extras = [];  // extra invoice lines for the selected month
let sub = "invoices";
// At-a-glance period: the month above (default), a Mon–Sun week, or any dates
let gp = { mode: "month", from: null, to: null }; let grows = [];
// At-a-glance filters: areas and transport companies (none picked = all)
const gf = { areas: new Set(), custs: new Set() };
const gfOk = r => (!gf.areas.size || gf.areas.has(r.area)) && (!gf.custs.size || gf.custs.has(r.customer));
const monOfD = d => addDays(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));
const gRange = () => gp.mode === "month" ? { from: ym + "-01", to: lastDay(ym) } : { from: gp.from, to: gp.to };
async function loadGlance() { if (gp.mode === "month") { grows = rows; return; } const { from, to } = gRange(); grows = await q(sb.from("pickups").select("*").gte("day", from).lte("day", to).order("day", { ascending: false })); }

const rates = () => { const o = JSON.parse(JSON.stringify(CUSTOMERS)); const ov = S.set?.pickup_rates || {}; for (const [c, v] of Object.entries(ov)) if (o[c]) { if (v.small != null) o[c].small.rate = +v.small; if (v.large != null) o[c].large.rate = +v.large; } return o; };
const monthOf = d => d.slice(0, 7);
const lastDay = ym_ => { const [y, m] = ym_.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shiftMonth = (ym_, n) => { const [y, m] = ym_.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const money = n => "$" + (+n).toFixed(2);
const canEdit = () => !!(S.me?.isOwner || S.me?.id === "AL");   // Data entry sub-tab: owner and Alejandro
const refFor = c => { const [y, m] = ym.split("-").map(Number); return S.set?.pickup_refs?.[ym]?.[c] ?? (c === "TGE" ? "" : `${y} - ${MON[m - 1]} Pick Ups`); };

async function loadMonth() {
  ym ||= monthOf(today());
  [rows, extras] = await Promise.all([
    q(sb.from("pickups").select("*").gte("day", ym + "-01").lte("day", lastDay(ym)).order("day", { ascending: false }).order("created_at", { ascending: false })),
    q(sb.from("invoice_extras").select("*").eq("month", ym).order("created_at")).catch(() => []),
  ]);
}
const reload = async () => { await loadMonth(); await loadGlance(); render(); };

// totals[cust][area] = { small, large }
function totals() { const t = {}; for (const r of rows) { if (r.min_fee != null) continue; const c = (t[r.customer] ??= {}); const a = (c[r.area] ??= { small: 0, large: 0 }); a.small += r.small; a.large += r.large; } return t; }
// Xero lines for a customer: one per area and size, then any extra lines
function linesFor(cust) {
  const C = rates()[cust]; const tot = totals()[cust] || {}; const out = [];
  for (const area of AREAS) { const a = tot[area]; if (!a) continue;
    if (a.small) out.push({ code: C.small.code, desc: `${C.small.desc} - Pick Ups - ${AREA_SHORT[area]}`, qty: a.small, price: C.small.rate, acct: C.acct });
    if (a.large) out.push({ code: C.large.code, desc: `${C.large.desc} - Pick Ups - ${AREA_SHORT[area]}`, qty: a.large, price: C.large.rate, acct: C.acct }); }
  // no-parcel days at the Balclutha depot: split fee (one line per customer, qty = days)
  const mins = rows.filter(r => r.customer === cust && r.min_fee != null);
  for (const [fee, n] of Object.entries(mins.reduce((a, r) => (a[+r.min_fee] = (a[+r.min_fee] || 0) + 1, a), {})))
    out.push({ code: "", desc: `${C.short} - Minimum Charge - Bal Depot Pick Up`, qty: n, price: +fee, acct: C.acct });
  for (const x of extras.filter(x => x.customer === cust)) out.push({ code: x.item_code || "", desc: x.description, qty: +x.qty, price: +x.price, acct: x.account || C.acct, extra: x.id });
  return out;
}

export function pickupsTab() {
  if (!ym) { ym = monthOf(today()); loadMonth().then(() => render(true)); }
  if (!canEdit()) sub = "invoices";
  const [y, m] = ym.split("-").map(Number); const to = lastDay(ym);
  const bar = `<div class="wkbar"><button class="ar" data-pu-m="-1">‹</button><b>${MONTH_L[m - 1]} ${y} <span class="meta">(1 – ${+to.slice(8)} ${MON[m - 1]})</span></b><button class="ar" data-pu-m="1">›</button></div>
    ${canEdit() ? `<div class="nav" style="margin-top:-4px"><button data-pu-sub="invoices" class="${sub === "invoices" ? "on" : ""}">Invoices</button><button data-pu-sub="entry" class="${sub === "entry" ? "on" : ""}">Data entry</button></div>` : ""}`;
  return bar + glance() + (sub === "entry" ? entryView() : invoicesView());
}

/* At a glance: the month's pick-ups by customer, area, driver and day, plus downloads (entries CSV, full Excel report) */
const fee = r => { if (r.min_fee != null) return +r.min_fee; const C = rates()[r.customer]; return C ? r.small * C.small.rate + r.large * C.large.rate : 0; };
function glance() {
  if (gp.mode === "month") grows = rows;
  const rows_ = grows.filter(gfOk); const R = rates(); const [, m] = ym.split("-").map(Number); const t = today(); const { from: gF, to: gT } = gRange(); const inRange = gF <= t && t <= gT;
  const pname = gp.mode === "month" ? MONTH_L[m - 1] : gp.mode === "week" ? `week of ${label(gF)}` : `${label(gF)} – ${label(gT)}`;
  const parcels = rows_.reduce((a, r) => a + (r.small || 0) + (r.large || 0), 0);
  const invNet = rows_.reduce((a, r) => a + fee(r), 0) + (gp.mode === "month" && !gf.areas.size ? extras.filter(x => !gf.custs.size || gf.custs.has(x.customer)).reduce((a, x) => a + (+x.qty) * (+x.price), 0) : 0);
  const days = [...new Set(rows_.map(r => r.day))].sort().reverse();
  const wkFrom = addDays(t, -((new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7));
  const sumP = rs => rs.reduce((a, r) => a + (r.small || 0) + (r.large || 0), 0);
  const tile = (v, l) => `<div class="tile"><span class="v">${v}</span><span class="l">${l}</span></div>`;
  const tiles = `<div class="tiles">${tile(parcels, "parcels picked up")}${tile(money(invNet), "to invoice (excl GST)")}${tile(days.length, "days with pick-ups")}${tile(days.length ? Math.round(parcels / days.length) : "–", "parcels a day (avg)")}${inRange ? tile(sumP(rows_.filter(r => r.day === t)), "today") + tile(sumP(rows_.filter(r => r.day >= wkFrom)), "this week") : ""}</div>`;
  // area × customer
  const cell = (area, c) => { const rs = rows_.filter(r => r.area === area && r.customer === c); if (!rs.length) return `<td class="meta" align="right">–</td>`; const sm = rs.reduce((a, r) => a + (r.small || 0), 0), lg = rs.reduce((a, r) => a + (r.large || 0), 0), mins = rs.filter(r => r.min_fee != null).length; return `<td align="right">${sm}${lg ? ` + ${lg}L` : ""}${mins ? ` <span class="meta">· ${mins} min</span>` : ""}<div class="meta">${money(rs.reduce((a, r) => a + fee(r), 0))}</div></td>`; };
  const custs = Object.keys(CUSTOMERS).filter(c => !gf.custs.size || gf.custs.has(c)); const areas = AREAS.filter(a => !gf.areas.size || gf.areas.has(a));
  const areaTbl = `<table class="dt"><tr><th>Area</th>${custs.map(c => `<th align="right">${esc(R[c].short)}</th>`).join("")}<th align="right">Total</th></tr>${areas.map(a => { const rs = rows_.filter(r => r.area === a); return `<tr><td>${a}</td>${custs.map(c => cell(a, c)).join("")}<td align="right"><b>${sumP(rs)}</b><div class="meta">${money(rs.reduce((x, r) => x + fee(r), 0))}</div></td></tr>`; }).join("")}
    <tr><td><b>Total</b></td>${custs.map(c => { const rs = rows_.filter(r => r.customer === c); return `<td align="right"><b>${sumP(rs)}</b><div class="meta">${money(rs.reduce((x, r) => x + fee(r), 0))}</div></td>`; }).join("")}<td align="right"><b>${parcels}</b><div class="meta">${money(rows_.reduce((x, r) => x + fee(r), 0))}</div></td></tr></table>`;
  // by driver
  const drv = Object.entries(rows_.reduce((a, r) => { const o = (a[r.driver] ??= { n: 0, p: 0, f: 0 }); o.n++; o.p += (r.small || 0) + (r.large || 0); o.f += fee(r); return a; }, {})).sort((a, b) => b[1].p - a[1].p);
  const drvTbl = drv.length ? `<table class="dt"><tr><th>Driver</th><th align="right">Entries</th><th align="right">Parcels</th><th align="right">Value</th></tr>${drv.map(([d, o]) => `<tr><td>${esc(nm(d))}</td><td align="right">${o.n}</td><td align="right">${o.p}</td><td align="right">${money(o.f)}</td></tr>`).join("")}</table>` : "";
  // by day (latest first)
  const dayTbl = days.length ? `<table class="dt"><tr><th>Day</th>${custs.map(c => `<th align="right">${esc(R[c].short)}</th>`).join("")}<th align="right">Total</th><th>Areas</th></tr>${days.slice(0, 31).map(d => { const rs = rows_.filter(r => r.day === d); return `<tr${canEdit() ? ` class="clk" data-pu-day="${d}" title="Tap to edit this day's totals" style="cursor:pointer"` : ""}><td>${label(d)}${canEdit() ? ` <span class="meta">✎</span>` : ""}</td>${custs.map(c => `<td align="right">${sumP(rs.filter(r => r.customer === c)) || `<span class="meta">–</span>`}</td>`).join("")}<td align="right"><b>${sumP(rs)}</b></td><td class="meta">${[...new Set(rs.map(r => r.area))].join(", ")}</td></tr>`; }).join("")}</table>` : "";
  const canRep = S.me?.isOwner || S.me?.id === "AL";
  return `<div class="card"><h2>Pick-ups at a glance<span>${esc(pname)} · small + large (L) · value at invoice rates, excl GST</span></h2>
    <div class="row" style="align-items:flex-end;margin-bottom:8px"><div class="nav" style="margin:0;flex:0 0 auto">${[["month", "Month"], ["week", "Week"], ["custom", "Dates"]].map(([k, l]) => `<button data-gp="${k}" class="${gp.mode === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${gp.mode === "week" ? `<div class="wkbar" style="margin:0;flex:1 1 220px"><button class="ar" data-gw="-1">‹</button><b>${label(gF)} – ${label(gT)}</b><button class="ar" data-gw="1">›</button></div>` : ""}
      ${gp.mode === "custom" ? `<label class="f" style="flex:1 1 130px">From<input class="in" type="date" id="gp-from" value="${gF}"></label><label class="f" style="flex:1 1 130px">To<input class="in" type="date" id="gp-to" value="${gT}"></label><button class="btn sm" id="gp-go" style="flex:0 0 auto">Show</button>` : ""}
      ${gp.mode === "month" ? `<span class="meta" style="flex:1 1 200px">Use ‹ › at the top to change month.</span>` : ""}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${AREAS.filter(a => a !== "Balclutha").map(a => `<button class="btn sm ${gf.areas.has(a) ? "" : "ghost"}" data-gfa="${a}" style="flex:0 0 auto">${a}</button>`).join("")}<span style="flex:0 0 8px"></span>${Object.keys(CUSTOMERS).map(c => `<button class="btn sm ${gf.custs.has(c) ? "" : "ghost"}" data-gfc="${c}" style="flex:0 0 auto">${esc(R[c].short)}</button>`).join("")}${gf.areas.size || gf.custs.size ? `<button class="btn ghost sm" data-gfx="1" style="flex:0 0 auto">✕ All</button>` : ""}</div>${tiles}
    ${rows_.length ? `<div class="scroll" style="margin-top:8px">${areaTbl}</div>
    <div class="row" style="align-items:flex-start;gap:12px;margin-top:8px"><div style="flex:1 1 260px"><h4 style="margin:4px 0">By driver</h4><div class="scroll">${drvTbl}</div></div><div style="flex:2 1 360px"><h4 style="margin:4px 0">By day${canEdit() ? ` <span class="meta">· tap a day to edit its totals</span>` : ""}</h4><div class="scroll" style="max-height:320px;overflow:auto">${dayTbl}</div></div></div>` : `<p class="meta">No pick-ups logged for ${esc(pname)}.</p>`}
    ${(() => { const ms = missingPU(); return `<h4 style="margin:12px 0 4px">Missing pick-up totals <span class="meta">${ms.length ? `${ms.length} · tap Remind to message the driver now (they're also chased automatically once their EOD is in)` : "none · every pick-up run has its totals in"}</span></h4>${ms.length ? `<div class="scroll"><table class="dt"><tr><th>Day</th><th>Driver</th><th>Area</th><th>Run</th><th></th></tr>${ms.map((m, i) => `<tr><td>${label(m.day)}</td><td>${esc(nm(m.driver))}</td><td>${esc(m.area)}</td><td>${esc(m.run)}</td><td align="right"><button class="btn ghost sm" data-pu-remind="${i}">Remind</button></td></tr>`).join("")}</table></div>${ms.length > 1 ? `<div class="row" style="margin-top:6px"><button class="btn sm" id="pu-remind-all" style="flex:0 0 auto">Remind everyone (${new Set(ms.map(m => m.driver)).size})</button></div>` : ""}` : ""}`; })()}
    <div class="row" style="margin-top:10px">${rows_.length ? `<button class="btn ghost sm" id="pu-csv" style="flex:0 0 auto">⬇ Pick-up entries (CSV)</button>` : ""}${canRep ? `<button class="btn ghost sm" id="pu-rep" style="flex:0 0 auto">⬇ Full report for ${esc(pname)} (Excel)</button>` : ""}</div></div>`;
}
/* Runs with a pick-up add-on whose area has no totals logged that day (owner's own runs left out). Today only counts once that run's EOD is in. */
function missingPU() {
  const { from, to } = gRange(); const t = today(); const end = to < t ? to : t; const pu = (S.addons || []).filter(a => a.pu_area);
  const have = new Set(grows.map(r => r.day + "|" + r.area)); const out = []; const seen = new Set();
  for (const s of S.shifts || []) { if (s.day < from || s.day > end || !s.driver || S.peopleBy?.[s.driver]?.role === "owner") continue;
    if (s.day === t && !S.eodBy?.[s.id] && !/^SUP/.test(s.run)) continue;
    for (const a of pu) { if (!(s.addons || []).includes(a.id) || have.has(s.day + "|" + a.pu_area)) continue; const k = s.day + "|" + a.pu_area + "|" + s.driver; if (seen.has(k)) continue; seen.add(k); out.push({ day: s.day, area: a.pu_area, driver: s.driver, run: s.run }); } }
  return out.sort((a, b) => b.day.localeCompare(a.day) || nm(a.driver).localeCompare(nm(b.driver)));
}
async function remind(list) {
  if (!list.length) return; const by = {}; for (const m of list) (by[m.driver] ??= []).push(m); let n = 0;
  for (const [d, ms] of Object.entries(by)) {
    const what = ms.map(m => `${m.area} on ${label(m.day)} (${m.run})`).join(", ");
    const body = `Hi ${nm(d).split(" ")[0]}, your pick-up totals for ${what} aren't in yet. Please enter them in the app under Pick-ups (or tap None if there weren't any). Thanks!`;
    const msg = await q(sb.from("messages").insert({ sender: S.me.id, body, needs_confirm: false }).select().single());
    await q(sb.from("message_recipients").insert({ message_id: msg.id, person: d })); fn("notify", { type: "message", message_id: msg.id }).catch(() => { }); n++;
  }
  toast(`Reminder sent to ${n} driver${n === 1 ? "" : "s"}`, "ok");
}
function entriesCsv() {
  const head = ["Date", "Driver", "Area", "Customer", "Source", "Small", "Large", "Split fee", "Value excl GST", "Note", "Entered"];
  const lines = grows.filter(gfOk).sort((a, b) => a.day.localeCompare(b.day) || a.area.localeCompare(b.area)).map(r => [r.day, nm(r.driver), r.area, rates()[r.customer]?.short || r.customer, r.source || "depot", r.small, r.large, r.min_fee ?? "", fee(r).toFixed(2), r.note || "", (r.created_at || "").slice(0, 16).replace("T", " ")]);
  const csv = [head, ...lines].map(r => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); { const r = gRange(); a.download = gp.mode === "month" ? `pick-ups-${ym}.csv` : `pick-ups-${r.from}-to-${r.to}.csv`; } document.body.appendChild(a); a.click(); a.remove();
}
/** Full spreadsheet (same as the emailed daily/weekly report) for any dates, built on the server. Owner and Alejandro only. */
export async function downloadReport(from, to, btn) {
  if (btn) { btn.disabled = true; btn.dataset.l ??= btn.textContent; btn.textContent = "Building report…"; }
  try {
    const { data, error } = await sb.functions.invoke("report", { body: { download: true, from, to } });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch { } throw new Error(m); }
    if (!data?.b64) throw new Error(data?.error || "No file came back");
    const bin = atob(data.b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([u8], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); a.download = data.filename; document.body.appendChild(a); a.click(); a.remove();
    toast("Report downloaded", "ok");
  } catch (e) { toast("Couldn't build the report: " + e.message, "err"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.l; } }
}

function invoicesView() {
  const R = rates(); const [, m] = ym.split("-").map(Number);
  const all = Object.keys(CUSTOMERS).map(c => [c, linesFor(c)]); const any = all.some(([, L]) => L.length);
  const cards = all.map(([c, L]) => { const net = L.reduce((a, l) => a + l.qty * l.price, 0);
    return `<div class="card"><h2>${esc(CUSTOMERS[c].name)}<span>${L.length ? money(net) + " + GST " + money(net * 0.15) + " = " + money(net * 1.15) : "nothing this month"}</span></h2>
      ${L.length ? `<div class="scroll"><table class="dt"><tr><th>Item</th><th>Description</th><th>Acct</th><th align="right">Qty</th><th align="right">Rate</th><th align="right">Amount</th></tr>${L.map(l => `<tr><td class="meta">${esc(l.code)}</td><td>${esc(l.desc)}${l.extra ? ` <span class="meta">· extra</span>` : ""}</td><td>${esc(l.acct)}</td><td align="right">${l.qty}</td><td align="right">${money(l.price)}</td><td align="right">${money(l.qty * l.price)}</td></tr>`).join("")}</table></div>` : `<p class="meta">No pick-ups or extras for ${MONTH_L[m - 1]}.</p>`}
      <div class="row" style="margin-top:8px;align-items:flex-end"><label class="f" style="flex:1 1 200px">Reference${c === "TGE" ? " (PO number)" : ""}<input class="in" data-ref="${c}" value="${esc(refFor(c))}" placeholder="${c === "TGE" ? "e.g. PO100022976" : ""}"></label>
        ${canEdit() ? `<button class="btn ghost sm" data-x-add="${c}" style="flex:0 0 auto">+ Extra item</button>` : ""}${L.length ? `<button class="btn sm" data-xero="${c}" style="flex:0 0 auto">Export to Xero (CSV)</button>` : ""}</div></div>`; }).join("");
  return `<div class="card"><h2>Pick-ups to invoice<span>Rural · South · Owaka · Lawrence · Balclutha</span></h2>
    <p class="hint">Drivers enter counts in their app; you can add or fix them under Data entry. Each month becomes one invoice per customer, dated the last day of the month, using the same Xero items, accounts and wording as your existing invoices. Export, then in Xero go to Sales › Invoices › Import and upload the file; invoices come in as drafts to check and approve.</p>
    ${any ? `<div class="row"><button class="btn sm" id="xero-all" style="flex:0 0 auto">Export all customers to Xero (one CSV)</button></div>` : ""}</div>
    ${cards}
    <div class="card"><h2>Rates<span>per parcel, before GST (NZD)</span></h2><form class="row" id="pu-rates">${Object.entries(R).map(([c, v]) => `<label class="f" style="flex:1 1 150px">${esc(v.short)} small<input class="in" data-r="${c}.small" inputmode="decimal" value="${v.small.rate}"></label><label class="f" style="flex:1 1 150px">${esc(v.short)} large<input class="in" data-r="${c}.large" inputmode="decimal" value="${v.large.rate}"></label>`).join("")}<button class="btn sm" type="submit" style="flex:0 0 auto">Save rates</button></form></div>`;
}

function entryView() {
  const inp = (r, k, extra = "") => `<input class="in" data-row="${r.id}" data-k="${k}" value="${esc(r[k] ?? "")}" ${extra}>`;
  const table = rows.length ? `<div class="scroll"><table class="dt"><tr><th>Date</th><th>Area</th><th>Customer</th><th>Pick-up at</th><th>Small</th><th>Large</th><th>Driver</th><th>Note</th><th></th></tr>${rows.map(r => `<tr>
      <td>${inp(r, "day", `type="date" style="width:140px"`)}</td>
      <td><select class="in" data-row="${r.id}" data-k="area">${opt(AREAS.map(a => [a, a]), r.area)}</select></td>
      <td><select class="in" data-row="${r.id}" data-k="customer">${opt(Object.entries(CUSTOMERS).map(([k, v]) => [k, v.short]), r.customer)}</select></td>
      <td><select class="in" data-row="${r.id}" data-k="source">${opt(SOURCES, r.source || "depot")}</select></td>
      ${r.min_fee != null ? `<td colspan="2" class="meta">none · split fee ${money(r.min_fee)}</td>` : `<td>${inp(r, "small", `inputmode="numeric" style="width:64px"`)}</td><td>${inp(r, "large", `inputmode="numeric" style="width:64px"`)}</td>`}
      <td><select class="in" data-row="${r.id}" data-k="driver">${opt([["", "—"], ...S.drivers.map(d => [d.id, d.name])], r.driver || "")}</select></td>
      <td>${inp(r, "note", `style="min-width:120px"`)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-save="${r.id}">Save</button> <button class="btn ghost sm" data-pu-del="${r.id}">Delete</button></td></tr>`).join("")}</table></div>` : `<p class="meta">Nothing logged this month yet.</p>`;
  const xl = extras.length ? `<div class="scroll"><table class="dt"><tr><th>Customer</th><th>Item</th><th>Description</th><th>Acct</th><th align="right">Qty</th><th align="right">Rate</th><th align="right">Amount</th><th></th></tr>${extras.map(x => `<tr><td>${esc(CUSTOMERS[x.customer]?.short || x.customer)}</td><td class="meta">${esc(x.item_code || "")}</td><td>${esc(x.description)}</td><td>${esc(x.account || "")}</td><td align="right">${+x.qty}</td><td align="right">${money(x.price)}</td><td align="right">${money(x.qty * x.price)}</td><td style="white-space:nowrap"><button class="btn ghost sm" data-x-edit="${x.id}">Edit</button> <button class="btn ghost sm" data-x-del="${x.id}">Delete</button></td></tr>`).join("")}</table></div>` : `<p class="meta">No extra items this month.</p>`;
  return `<div class="card"><h2>Enter pick-ups<span>for any driver and date</span></h2>
      <form class="frm" id="pe-f"><label class="f">Date<input class="in" type="date" id="pe-day" value="${today() < ym + "-01" || today() > lastDay(ym) ? lastDay(ym) : today()}" required></label>
      <label class="f">Area<select class="in" id="pe-area">${opt(AREAS.map(a => [a, a]), "Lawrence")}</select></label>
      <label class="f">Driver<select class="in" id="pe-drv">${opt([["", "—"], ...S.drivers.map(d => [d.id, d.name])], "")}</select></label>
      <div class="full scroll"><table class="dt"><tr><th rowspan="2">Customer</th><th colspan="2">Depot pick-ups</th><th colspan="2">Customer pick-ups</th></tr><tr><th>Small</th><th>Large</th><th>Small</th><th>Large</th></tr>${Object.entries(CUSTOMERS).map(([k, v]) => `<tr data-cust="${k}"><td>${esc(v.name)}</td>${SOURCES.map(([src]) => `<td><input class="in" data-pe="${k}.${src}.small" inputmode="numeric" placeholder="0" style="width:64px"></td><td><input class="in" data-pe="${k}.${src}.large" inputmode="numeric" placeholder="0" style="width:64px"></td>`).join("")}</tr>`).join("")}</table></div>
      <label class="f full">Note (optional)<input class="in" id="pe-n"></label><button class="btn full" type="submit">Save pick-ups</button></form></div>
    <div class="card"><h2>Entries this month<span>${rows.length} · change a figure then tap Save on that line</span></h2>${table}</div>
    <div class="card"><h2>Extra items<span>added to that customer's invoice for ${MONTH_L[+ym.slice(5) - 1]}</span></h2>${xl}<div class="row" style="margin-top:8px"><button class="btn sm" data-x-add="" style="flex:0 0 auto">+ Extra item</button></div></div>`;
}

function extraSheet(existing = null, cust = "") {
  const e = existing || { customer: cust || "TGE", item_code: "", description: "", qty: 1, price: "", account: "" };
  sheet(`<h3>${existing ? "Edit extra item" : "Add an extra item"}</h3><form class="frm" id="xf">
    ${existing ? "" : `<label class="f full">Start from<select class="in" id="x-pre">${opt(EXTRA_PRESETS.map(p => [p.k, p.k === "other" ? "Other (type your own)" : p.code ? `${p.desc} · ${p.code}` : p.desc]), "")}</select></label>`}
    <label class="f">Customer<select class="in" id="x-cust">${opt(Object.entries(CUSTOMERS).map(([k, v]) => [k, v.name]), e.customer)}</select></label>
    <label class="f">Xero item code<input class="in" id="x-code" value="${esc(e.item_code || "")}" placeholder="optional"></label>
    <label class="f full">Description (shows on the invoice)<input class="in" id="x-desc" value="${esc(e.description)}" required placeholder="e.g. TGE Request Additional Work (4 hours @ $35/hour)"></label>
    <label class="f">Quantity<input class="in" id="x-qty" inputmode="decimal" value="${e.qty}" required></label>
    <label class="f">Unit price (NZD, excl GST)<input class="in" id="x-price" inputmode="decimal" value="${e.price}" required></label>
    <label class="f">Account<select class="in" id="x-acct">${opt(ACCOUNTS, e.account || CUSTOMERS[e.customer]?.acct || "200")}</select></label>
    <button class="btn full" type="submit">${existing ? "Save changes" : "Add to invoice"}</button></form>`, (bg, close) => {
    const g = id => bg.querySelector("#" + id);
    g("x-pre")?.addEventListener("change", () => { const p = EXTRA_PRESETS.find(p => p.k === g("x-pre").value); if (!p) return; if (p.cust) g("x-cust").value = p.cust; g("x-code").value = p.code; g("x-desc").value = p.desc; g("x-price").value = typeof p.price === "function" ? p.price() : p.price; g("x-acct").value = p.acct; });
    g("x-pre")?.dispatchEvent(new Event("change"));
    if (!existing && cust) g("x-cust").value = cust;
    g("xf").addEventListener("submit", async ev => { ev.preventDefault();
      const row = { month: ym, customer: g("x-cust").value, item_code: g("x-code").value.trim() || null, description: g("x-desc").value.trim(), qty: +g("x-qty").value || 0, price: +g("x-price").value || 0, account: g("x-acct").value };
      if (!row.description || !row.qty) return toast("Add a description and quantity", "err");
      const { error } = existing ? await sb.from("invoice_extras").update(row).eq("id", existing.id) : await sb.from("invoice_extras").insert({ ...row, created_by: S.me.id });
      if (error) return toast(error.message, "err"); toast("Saved", "ok"); close(); await reload(); });
  });
}

/** Edit one day's pick-up totals in place (owner and Alejandro): counts, note, or delete a line */
function daySheet(d) {
  const rs = grows.filter(r => r.day === d).sort((a, b) => a.area.localeCompare(b.area) || a.customer.localeCompare(b.customer));
  if (!rs.length) return;
  const R = rates();
  sheet(`<h3>Pick-ups · ${label(d)}</h3><p class="hint">Change a figure and tap Save on that line. To add a line for this day, use Data entry.</p>
    <div class="scroll"><table class="dt"><tr><th>Area</th><th>Customer</th><th>Driver</th><th>Small</th><th>Large</th><th>Note</th><th></th></tr>${rs.map(r => `<tr data-dr="${r.id}">
      <td>${esc(r.area)}<div class="meta">${r.source === "customer" ? "customer" : "depot"}</div></td><td>${esc(R[r.customer]?.short || r.customer)}</td><td>${esc(nm(r.driver))}</td>
      ${r.min_fee != null ? `<td colspan="2" class="meta">none · split fee ${money(r.min_fee)}</td>` : `<td><input class="in" data-dk="small" inputmode="numeric" value="${r.small}" style="width:60px"></td><td><input class="in" data-dk="large" inputmode="numeric" value="${r.large}" style="width:60px"></td>`}
      <td><input class="in" data-dk="note" value="${esc(r.note || "")}" style="min-width:110px"></td>
      <td style="white-space:nowrap"><button class="btn sm" data-dsave="${r.id}">Save</button> <button class="btn ghost sm" data-ddel="${r.id}">Delete</button></td></tr>`).join("")}</table></div>`, (bg, close) => {
    const after = async () => { await reload(); if (grows.some(r => r.day === d)) { close(); daySheet(d); } else close(); };
    bg.querySelectorAll("[data-dsave]").forEach(b => b.onclick = async () => { const tr = bg.querySelector(`[data-dr="${b.dataset.dsave}"]`); const g = k => tr.querySelector(`[data-dk="${k}"]`);
      const patch = { note: g("note").value.trim() || null }; if (g("small")) { patch.small = Math.max(0, parseInt(g("small").value) || 0); patch.large = Math.max(0, parseInt(g("large").value) || 0); }
      const { error } = await sb.from("pickups").update(patch).eq("id", b.dataset.dsave); if (error) return toast(error.message, "err"); toast("Saved", "ok"); await after(); });
    bg.querySelectorAll("[data-ddel]").forEach(b => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Sure?"; return; }
      const { error } = await sb.from("pickups").delete().eq("id", b.dataset.ddel); if (error) return toast(error.message, "err"); toast("Deleted", "ok"); await after(); });
  });
}

function csvCell(v) { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
const HEAD = ["*ContactName", "EmailAddress", "POAddressLine1", "POAddressLine2", "POAddressLine3", "POAddressLine4", "POCity", "PORegion", "POPostalCode", "POCountry", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate", "InventoryItemCode", "*Description", "*Quantity", "*UnitAmount", "Discount", "*AccountCode", "*TaxType", "TrackingName1", "TrackingOption1", "TrackingName2", "TrackingOption2", "Currency"];
function csvLines(c) {
  const C = rates()[c]; const L = linesFor(c); const inv = lastDay(ym); const due = C.due ? addDays(inv, C.due) : inv;
  const dmy = d => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`; const num = `PU-${ym.replace("-", "")}-${c}`;
  const ref = $(`[data-ref="${c}"]`)?.value ?? refFor(c);
  return L.map(l => [C.name, "", "", "", "", "", "", "", "", "", num, ref, dmy(inv), dmy(due), l.code, l.desc, l.qty, l.price, "", l.acct, C.tax, "", "", "", "", "NZD"]);
}
function download(lines, name) {
  const csv = [HEAD, ...lines].map(r => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  toast(`Downloaded ${name}`, "ok");
}
async function saveRefs() { const refs = { ...(S.set?.pickup_refs || {}) }; refs[ym] = { ...(refs[ym] || {}) }; $$("[data-ref]").forEach(i => refs[ym][i.dataset.ref] = i.value.trim()); S.set.pickup_refs = refs; await sb.from("settings").upsert({ key: "pickup_refs", value: refs }); }
async function exportXero(c) { const L = csvLines(c); if (!L.length) return toast("Nothing to export", "err"); await saveRefs(); download(L, `xero-invoice-${c}-${ym}.csv`); }
async function exportAll() { const L = Object.keys(CUSTOMERS).flatMap(csvLines); if (!L.length) return toast("Nothing to export", "err"); await saveRefs(); download(L, `xero-invoices-pickups-${ym}.csv`); }

export function pickupSheet(existing = null, onSaved = null) {
  const e = existing || { day: today(), area: "Lawrence", customer: "NZC", source: "depot", small: 0, large: 0, note: "" };
  sheet(`<h3>${existing ? "Edit pick-up" : "Log a pick-up"}</h3><form class="frm" id="pf">
    <label class="f">Date<input class="in" type="date" id="pu-day" value="${e.day}" required></label>
    <label class="f">Area<select class="in" id="pu-area">${opt(AREAS.map(a => [a, a]), e.area)}</select></label>
    <label class="f">Customer<select class="in" id="pu-cust">${opt(Object.entries(CUSTOMERS).map(([k, v]) => [k, v.name]), e.customer)}</select></label>
    <label class="f">Picked up at<select class="in" id="pu-src">${opt(SOURCES, e.source || "depot")}</select></label>
    <label class="f">Small parcels<input class="in" id="pu-s" inputmode="numeric" value="${e.small || ""}" placeholder="0"></label>
    <label class="f">Large parcels<input class="in" id="pu-l" inputmode="numeric" value="${e.large || ""}" placeholder="0"></label>
    <label class="f full">Note (optional)<input class="in" id="pu-n" value="${esc(e.note || "")}"></label>
    <button class="btn full" type="submit">${existing ? "Save changes" : "Save pick-up"}</button></form>`, (bg, close) => {
    bg.querySelector("#pf").addEventListener("submit", async ev => {
      ev.preventDefault(); const g = x => bg.querySelector("#" + x).value; const s = +g("pu-s") || 0, l = +g("pu-l") || 0;
      if (!s && !l) return toast("Enter at least one parcel", "err");
      const row = { day: g("pu-day"), area: g("pu-area"), customer: g("pu-cust"), source: g("pu-src"), small: s, large: l, note: g("pu-n") || null };
      if (custErr(row)) return toast(custErr(row), "err");
      const { error } = existing ? await sb.from("pickups").update(row).eq("id", existing.id) : await sb.from("pickups").insert({ ...row, driver: S.viewer?.id || S.me.id, created_by: S.viewer?.id || S.me.id });
      if (error) return toast(error.message, "err"); toast("Saved", "ok"); close(); if (onSaved) await onSaved(); });
  });
}

export function wirePickups() {
  $$("[data-pu-remind]").forEach(b => b.onclick = async () => { const m = missingPU()[+b.dataset.puRemind]; if (!m) return; b.disabled = true; try { await remind([m]); b.textContent = "Sent ✓"; } catch (e) { b.disabled = false; toast(e.message, "err"); } });
  $("#pu-remind-all")?.addEventListener("click", async e => { const b = e.currentTarget; b.disabled = true; try { await remind(missingPU()); b.textContent = "Sent ✓"; } catch (er) { b.disabled = false; toast(er.message, "err"); } });
  $("#pu-csv")?.addEventListener("click", entriesCsv);
  $("#pu-rep")?.addEventListener("click", e => { const r = gRange(); downloadReport(r.from, r.to < today() ? r.to : (r.from > today() ? r.to : today()), e.currentTarget); });
  $$("[data-gfa]").forEach(b => b.onclick = () => { const k = b.dataset.gfa; gf.areas.has(k) ? gf.areas.delete(k) : gf.areas.add(k); render(); });
  $$("[data-gfc]").forEach(b => b.onclick = () => { const k = b.dataset.gfc; gf.custs.has(k) ? gf.custs.delete(k) : gf.custs.add(k); render(); });
  $$("[data-gfx]").forEach(b => b.onclick = () => { gf.areas.clear(); gf.custs.clear(); render(); });
  $$("[data-gp]").forEach(b => b.onclick = async () => { const k = b.dataset.gp; const t = today();
    if (k === "week") { const f = monOfD(t); gp = { mode: k, from: f, to: addDays(f, 6) }; }
    else if (k === "custom") gp = { mode: k, from: gp.from || ym + "-01", to: gp.to || (lastDay(ym) < t ? lastDay(ym) : t) };
    else gp = { mode: "month", from: null, to: null };
    await loadGlance(); render(); });
  $$("[data-gw]").forEach(b => b.onclick = async () => { const f = addDays(gp.from, 7 * +b.dataset.gw); gp = { mode: "week", from: f, to: addDays(f, 6) }; await loadGlance(); render(); });
  $("#gp-go")?.addEventListener("click", async () => { const f = $("#gp-from").value, t2 = $("#gp-to").value; if (!f || !t2 || t2 < f) return toast("Pick a from and to date", "err"); gp = { mode: "custom", from: f, to: t2 }; await loadGlance(); render(); });
  $$("[data-pu-m]").forEach(b => b.onclick = async () => { ym = shiftMonth(ym, +b.dataset.puM); await reload(); });
  $$("[data-pu-sub]").forEach(b => b.onclick = () => { sub = b.dataset.puSub; render(); });
  $$("[data-pu-day]").forEach(tr => tr.onclick = () => daySheet(tr.dataset.puDay));
  $$("[data-pu-del]").forEach(b => b.onclick = async () => { if (!confirm("Delete this pick-up?")) return; await q(sb.from("pickups").delete().eq("id", b.dataset.puDel)); await reload(); });
  $$("[data-save]").forEach(b => b.onclick = async () => { const id = b.dataset.save; const v = k => $(`[data-row="${id}"][data-k="${k}"]`).value;
    const isMin = rows.find(r => r.id === id)?.min_fee != null;
    const row = { day: v("day"), area: v("area"), customer: v("customer"), source: v("source"), driver: v("driver") || null, note: v("note").trim() || null, ...(isMin ? {} : { small: Math.max(0, parseInt(v("small")) || 0), large: Math.max(0, parseInt(v("large")) || 0) }) };
    if (!isMin && !row.small && !row.large) return toast("Enter at least one parcel, or delete the line", "err");
    if (custErr(row)) return toast(custErr(row), "err");
    const { error } = await sb.from("pickups").update(row).eq("id", id); if (error) return toast(error.message, "err"); toast("Saved", "ok"); await reload(); });
  $("#pe-f")?.addEventListener("submit", async ev => { ev.preventDefault(); const v = k => Math.max(0, parseInt($(`[data-pe="${k}"]`).value) || 0);
    const base = { day: $("#pe-day").value, area: $("#pe-area").value, driver: $("#pe-drv").value || null, note: $("#pe-n").value.trim() || null, created_by: S.me.id };
    const ins = Object.keys(CUSTOMERS).filter(c => custFor(base.area).includes(c)).flatMap(c => SOURCES.map(([src]) => ({ ...base, customer: c, source: src, small: v(`${c}.${src}.small`), large: v(`${c}.${src}.large`) }))).filter(r => r.small || r.large);
    if (!ins.length) return toast("Enter at least one parcel", "err");
    const { error } = await sb.from("pickups").insert(ins); if (error) return toast(error.message, "err"); toast(`Saved ${ins.length} line${ins.length > 1 ? "s" : ""}`, "ok");
    if (monthOf(base.day) !== ym) ym = monthOf(base.day); await reload(); });
  const tgeRow = () => { const a = $("#pe-area")?.value; if (!a) return; const ok = custFor(a); $$("[data-cust]").forEach(r => r.hidden = !ok.includes(r.dataset.cust)); }; $("#pe-area")?.addEventListener("change", tgeRow); tgeRow();
  $$("[data-x-add]").forEach(b => b.onclick = () => extraSheet(null, b.dataset.xAdd));
  $$("[data-x-edit]").forEach(b => b.onclick = () => extraSheet(extras.find(x => x.id === b.dataset.xEdit)));
  $$("[data-x-del]").forEach(b => b.onclick = async () => { if (!confirm("Remove this extra item?")) return; await q(sb.from("invoice_extras").delete().eq("id", b.dataset.xDel)); await reload(); });
  $$("[data-xero]").forEach(b => b.onclick = () => exportXero(b.dataset.xero));
  $("#xero-all")?.addEventListener("click", exportAll);
  $("#pu-rates")?.addEventListener("submit", async ev => { ev.preventDefault(); const ov = { ...(S.set?.pickup_rates || {}) }; $$("[data-r]").forEach(i => { const [c, k] = i.dataset.r.split("."); (ov[c] ??= {})[k] = +i.value; });
    const { error } = await sb.from("settings").upsert({ key: "pickup_rates", value: ov }); if (error) return toast(error.message, "err"); S.set.pickup_rates = ov; toast("Rates saved", "ok"); render(); });
}
