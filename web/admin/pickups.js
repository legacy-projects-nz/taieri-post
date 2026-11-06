// Pick-ups tab: Rural / South / Owaka / Lawrence / Balclutha depot parcel pick-ups that are invoiced separately.
// Drivers log counts in the app. Two sub-tabs:
//   Invoices   – month totals per customer + extra lines, exported as a Xero sales-invoice CSV (one invoice per customer)
//   Data entry – owner/admin enter counts for any driver, edit or delete entries, and add extra invoice lines
// Item codes, account codes, contacts and line wording match the invoices already in Xero.
import { sb, q, today, addDays, label, esc, $, $$, toast } from "/shared/core.js";
import { S, sheet, opt, nm, render } from "/admin/admin.js";

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
const reload = async () => { await loadMonth(); render(); };

// totals[cust][area] = { small, large }
function totals() { const t = {}; for (const r of rows) { const c = (t[r.customer] ??= {}); const a = (c[r.area] ??= { small: 0, large: 0 }); a.small += r.small; a.large += r.large; } return t; }
// Xero lines for a customer: one per area and size, then any extra lines
function linesFor(cust) {
  const C = rates()[cust]; const tot = totals()[cust] || {}; const out = [];
  for (const area of AREAS) { const a = tot[area]; if (!a) continue;
    if (a.small) out.push({ code: C.small.code, desc: `${C.small.desc} - Pick Ups - ${AREA_SHORT[area]}`, qty: a.small, price: C.small.rate, acct: C.acct });
    if (a.large) out.push({ code: C.large.code, desc: `${C.large.desc} - Pick Ups - ${AREA_SHORT[area]}`, qty: a.large, price: C.large.rate, acct: C.acct }); }
  for (const x of extras.filter(x => x.customer === cust)) out.push({ code: x.item_code || "", desc: x.description, qty: +x.qty, price: +x.price, acct: x.account || C.acct, extra: x.id });
  return out;
}

export function pickupsTab() {
  if (!ym) { ym = monthOf(today()); loadMonth().then(() => render(true)); }
  if (!canEdit()) sub = "invoices";
  const [y, m] = ym.split("-").map(Number); const to = lastDay(ym);
  const bar = `<div class="wkbar"><button class="ar" data-pu-m="-1">‹</button><b>${MONTH_L[m - 1]} ${y} <span class="meta">(1 – ${+to.slice(8)} ${MON[m - 1]})</span></b><button class="ar" data-pu-m="1">›</button></div>
    ${canEdit() ? `<div class="nav" style="margin-top:-4px"><button data-pu-sub="invoices" class="${sub === "invoices" ? "on" : ""}">Invoices</button><button data-pu-sub="entry" class="${sub === "entry" ? "on" : ""}">Data entry</button></div>` : ""}`;
  return bar + (sub === "entry" ? entryView() : invoicesView());
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
      <td>${inp(r, "small", `inputmode="numeric" style="width:64px"`)}</td><td>${inp(r, "large", `inputmode="numeric" style="width:64px"`)}</td>
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
  $$("[data-pu-m]").forEach(b => b.onclick = async () => { ym = shiftMonth(ym, +b.dataset.puM); await reload(); });
  $$("[data-pu-sub]").forEach(b => b.onclick = () => { sub = b.dataset.puSub; render(); });
  $$("[data-pu-del]").forEach(b => b.onclick = async () => { if (!confirm("Delete this pick-up?")) return; await q(sb.from("pickups").delete().eq("id", b.dataset.puDel)); await reload(); });
  $$("[data-save]").forEach(b => b.onclick = async () => { const id = b.dataset.save; const v = k => $(`[data-row="${id}"][data-k="${k}"]`).value;
    const row = { day: v("day"), area: v("area"), customer: v("customer"), source: v("source"), small: Math.max(0, parseInt(v("small")) || 0), large: Math.max(0, parseInt(v("large")) || 0), driver: v("driver") || null, note: v("note").trim() || null };
    if (!row.small && !row.large) return toast("Enter at least one parcel, or delete the line", "err");
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
