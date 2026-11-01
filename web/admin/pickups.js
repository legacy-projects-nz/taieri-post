// Pick-ups tab: Rural / Owaka / Lawrence parcel pick-ups that are invoiced separately.
// Drivers log counts in the app; this tab totals a calendar month and exports a Xero sales-invoice CSV (one invoice per customer).
import { sb, q, today, addDays, label, fmtTs, esc, $, $$, toast } from "/shared/core.js";
import { S, sheet, opt, nm, loadAll, render } from "/admin/admin.js";

export const AREAS = ["Rural", "Owaka", "Lawrence"];
// Same Xero contacts, items and rates as the existing monthly invoices
export const CUSTOMERS = {
  NZC: { name: "NZ Couriers - Aaron Johnston", short: "NZC", due: 7, acct: "200", tax: "15% GST on Income", small: { code: "NZCS", rate: 4.5 }, large: { code: "NZCL", rate: 8 } },
  PH: { name: "Post Haste", short: "Post Haste", due: 7, acct: "200", tax: "15% GST on Income", small: { code: "PHS", rate: 4 }, large: { code: "PHL", rate: 8 } },
  TGE: { name: "NZ National Network LTD", short: "TGE", due: 0, acct: "201", tax: "15% GST on Income", small: { code: "TGE - OD - Pick ups", rate: 6 }, large: { code: "TGE - OD - Pick ups", rate: 7.5 } },
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_L = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let ym = null;   // "YYYY-MM"
let rows = [];   // pickups for the selected month

const rates = () => { const o = JSON.parse(JSON.stringify(CUSTOMERS)); const ov = S.set?.pickup_rates || {}; for (const [c, v] of Object.entries(ov)) if (o[c]) { if (v.small != null) o[c].small.rate = +v.small; if (v.large != null) o[c].large.rate = +v.large; } return o; };
const monthOf = d => d.slice(0, 7);
const lastDay = ym_ => { const [y, m] = ym_.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shiftMonth = (ym_, n) => { const [y, m] = ym_.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const money = n => "$" + (+n).toFixed(2);

async function loadMonth() {
  ym ||= monthOf(today());
  rows = await q(sb.from("pickups").select("*").gte("day", ym + "-01").lte("day", lastDay(ym)).order("day", { ascending: false }).order("created_at", { ascending: false }));
}

// totals[cust][area] = { small, large }
function totals() {
  const t = {}; for (const r of rows) { const c = (t[r.customer] ??= {}); const a = (c[r.area] ??= { small: 0, large: 0 }); a.small += r.small; a.large += r.large; } return t;
}
// Xero invoice lines for a customer: one line per area and size
function linesFor(cust, tot) {
  const C = rates()[cust]; const out = [];
  for (const area of AREAS) { const a = tot[area]; if (!a) continue;
    if (a.small) out.push({ code: C.small.code, desc: `${C.short} - Small - Pick Ups - ${area}`, qty: a.small, price: C.small.rate });
    if (a.large) out.push({ code: C.large.code, desc: `${C.short} - Large - Pick Ups - ${area}`, qty: a.large, price: C.large.rate }); }
  return out;
}

export function pickupsTab() {
  if (!ym) { ym = monthOf(today()); loadMonth().then(() => render(true)); }
  const t = totals(); const R = rates(); const [y, m] = ym.split("-").map(Number); const to = lastDay(ym);
  const cards = Object.keys(CUSTOMERS).map(c => {
    const L = linesFor(c, t[c] || {}); const net = L.reduce((a, l) => a + l.qty * l.price, 0);
    return `<div class="card"><h2>${esc(CUSTOMERS[c].name)}<span>${L.length ? money(net) + " + GST " + money(net * 0.15) : "nothing this month"}</span></h2>
      ${L.length ? `<div class="scroll"><table class="dt"><tr><th>Line</th><th align="right">Qty</th><th align="right">Rate</th><th align="right">Amount</th></tr>${L.map(l => `<tr><td>${esc(l.desc)}</td><td align="right">${l.qty}</td><td align="right">${money(l.price)}</td><td align="right">${money(l.qty * l.price)}</td></tr>`).join("")}</table></div>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-xero="${c}" style="flex:0 0 auto">Export Xero invoice (CSV)</button></div>` : `<p class="meta">No pick-ups logged for ${MONTH_L[m - 1]}.</p>`}</div>`; }).join("");
  const list = rows.map(r => `<div class="item"><div class="row" style="justify-content:space-between;align-items:center"><span><b>${label(r.day)}</b> · ${esc(r.area)} · ${esc(CUSTOMERS[r.customer]?.short || r.customer)} · ${r.small} small${r.large ? ` · ${r.large} large` : ""}${r.note ? ` · ${esc(r.note)}` : ""}<span class="meta"> · ${esc(nm(r.driver) || "")}</span></span><span class="row" style="flex:0;gap:4px"><button class="btn ghost sm" data-pu-edit="${r.id}">Edit</button><button class="btn ghost sm" data-pu-del="${r.id}">Delete</button></span></div></div>`).join("");
  return `<div class="card"><h2>Pick-ups to invoice<span>Rural · Owaka · Lawrence</span></h2>
    <div class="wkbar"><button class="ar" data-pu-m="-1">‹</button><b>${MONTH_L[m - 1]} ${y} <span class="meta">(1 – ${+to.slice(8)} ${MON[m - 1]})</span></b><button class="ar" data-pu-m="1">›</button><button class="btn sm" id="pu-add" style="flex:0 0 auto">+ Log pick-up</button></div>
    <p class="hint">Drivers log counts in their app. Each month's totals become one invoice per customer, dated the last day of the month. Export a CSV and import it in Xero under Sales › Invoices › Import.</p></div>
    ${cards}
    <div class="card"><h2>Rates<span>per parcel, before GST</span></h2><form class="row" id="pu-rates">${Object.entries(R).map(([c, v]) => `<label class="f" style="flex:1 1 150px">${esc(v.short)} small<input class="in" data-r="${c}.small" inputmode="decimal" value="${v.small.rate}"></label><label class="f" style="flex:1 1 150px">${esc(v.short)} large<input class="in" data-r="${c}.large" inputmode="decimal" value="${v.large.rate}"></label>`).join("")}<button class="btn sm" type="submit" style="flex:0 0 auto">Save rates</button></form></div>
    <div class="card"><h2>Logged this month<span>${rows.length} entr${rows.length === 1 ? "y" : "ies"}</span></h2>${list || `<p class="meta">Nothing logged yet.</p>`}</div>`;
}

function csvCell(v) { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
function exportXero(c) {
  const C = rates()[c]; const L = linesFor(c, totals()[c] || {}); if (!L.length) return toast("Nothing to export", "err");
  const [y, m] = ym.split("-").map(Number); const inv = lastDay(ym); const due = C.due ? addDays(inv, C.due) : inv;
  const head = ["*ContactName", "EmailAddress", "POAddressLine1", "POAddressLine2", "POAddressLine3", "POAddressLine4", "POCity", "PORegion", "POPostalCode", "POCountry", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate", "InventoryItemCode", "*Description", "*Quantity", "*UnitAmount", "Discount", "*AccountCode", "*TaxType", "TrackingName1", "TrackingOption1", "TrackingName2", "TrackingOption2", "Currency"];
  const num = `PU-${ym.replace("-", "")}-${c}`; const ref = `${y} - ${MONTH_L[m - 1]} Pick Ups`;
  const dmy = d => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const lines = L.map(l => [C.name, "", "", "", "", "", "", "", "", "", num, ref, dmy(inv), dmy(due), l.code, l.desc, l.qty, l.price, "", C.acct, C.tax, "", "", "", "", "NZD"]);
  const csv = [head, ...lines].map(r => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `xero-invoice-${c}-${ym}.csv`; document.body.appendChild(a); a.click(); a.remove();
  toast(`Downloaded ${a.download}`, "ok");
}

export function pickupSheet(existing = null, onSaved = null) {
  const e = existing || { day: today(), area: "Lawrence", customer: "NZC", small: 0, large: 0, note: "" };
  sheet(`<h3>${existing ? "Edit pick-up" : "Log a pick-up"}</h3><form class="frm" id="pf">
    <label class="f">Date<input class="in" type="date" id="pu-day" value="${e.day}" required></label>
    <label class="f">Area<select class="in" id="pu-area">${opt(AREAS.map(a => [a, a]), e.area)}</select></label>
    <label class="f">Customer<select class="in" id="pu-cust">${opt(Object.entries(CUSTOMERS).map(([k, v]) => [k, v.name]), e.customer)}</select></label>
    <label class="f">Small parcels<input class="in" id="pu-s" inputmode="numeric" value="${e.small || ""}" placeholder="0"></label>
    <label class="f">Large parcels<input class="in" id="pu-l" inputmode="numeric" value="${e.large || ""}" placeholder="0"></label>
    <label class="f full">Note (optional)<input class="in" id="pu-n" value="${esc(e.note || "")}"></label>
    <button class="btn full" type="submit">${existing ? "Save changes" : "Save pick-up"}</button></form>`, (bg, close) => {
    bg.querySelector("#pf").addEventListener("submit", async ev => {
      ev.preventDefault(); const g = x => bg.querySelector("#" + x).value; const s = +g("pu-s") || 0, l = +g("pu-l") || 0;
      if (!s && !l) return toast("Enter at least one parcel", "err");
      const row = { day: g("pu-day"), area: g("pu-area"), customer: g("pu-cust"), small: s, large: l, note: g("pu-n") || null };
      const { error } = existing ? await sb.from("pickups").update(row).eq("id", existing.id) : await sb.from("pickups").insert({ ...row, driver: S.viewer?.id || S.me.id, created_by: S.viewer?.id || S.me.id });
      if (error) return toast(error.message, "err"); toast("Saved", "ok"); close(); if (onSaved) await onSaved(); });
  });
}

export function wirePickups() {
  $$("[data-pu-m]").forEach(b => b.onclick = async () => { ym = shiftMonth(ym, +b.dataset.puM); await loadMonth(); render(); });
  $("#pu-add")?.addEventListener("click", () => pickupSheet(null, async () => { await loadMonth(); render(); }));
  $$("[data-pu-edit]").forEach(b => b.onclick = () => pickupSheet(rows.find(r => r.id === b.dataset.puEdit), async () => { await loadMonth(); render(); }));
  $$("[data-pu-del]").forEach(b => b.onclick = async () => { if (!confirm("Delete this pick-up?")) return; await q(sb.from("pickups").delete().eq("id", b.dataset.puDel)); await loadMonth(); render(); });
  $$("[data-xero]").forEach(b => b.onclick = () => exportXero(b.dataset.xero));
  $("#pu-rates")?.addEventListener("submit", async ev => { ev.preventDefault(); const ov = { ...(S.set?.pickup_rates || {}) }; $$("[data-r]").forEach(i => { const [c, k] = i.dataset.r.split("."); (ov[c] ??= {})[k] = +i.value; });
    const { error } = await sb.from("settings").upsert({ key: "pickup_rates", value: ov }); if (error) return toast(error.message, "err"); S.set.pickup_rates = ov; toast("Rates saved", "ok"); render(); });
}
