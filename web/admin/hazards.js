// Hazards tab: the address-level hazard register (dogs, aggressive people, driveways, ice…).
// Seeded from the West Harbour and Taieri Post paper registers; drivers add to it from the app. Staff edit, resolve and add here.
import { sb, nzNow, label, esc, $, $$, toast, pill, first } from "/shared/core.js";
import { S, sheet, loadAll, render } from "/admin/admin.js";

export const HZ_KINDS = [["dog", "🐕 Dog"], ["person", "😠 Aggressive person"], ["driveway", "⛰️ Driveway / turning"], ["access", "🚧 Access / no-go"], ["ice", "🧊 Ice / slippery"], ["road", "🚗 Road / traffic"], ["rail", "🚆 Rail crossing"], ["lifting", "📦 Lifting / slips"], ["info", "ℹ️ Info"], ["other", "❓ Other"]];
const RULES = ["", "NO-GO", "CARD", "GATE", "WALK", "WET/ICE-NO", "CAUTION", "INFO"];
const kl = k => (HZ_KINDS.find(x => x[0] === k) || [k, k])[1];
const SEV = { high: ["High", "crit"], medium: ["Medium", "warn"], low: ["Low", "grey"] };
const st = { q: "", sev: "hm", run: "", src: "", resolved: false };
const ord = { high: 0, medium: 1, low: 2 };
/** driver-reported hazards still open → badge on the tab */
export const hazardBadge = () => (S.hazards || []).filter(h => !h.resolved_at && h.reported_by && Date.now() - new Date(h.created_at) < 14 * 86400e3).length;

function rows() {
  const t = st.q.trim().toLowerCase();
  return (S.hazards || []).filter(h => (st.resolved ? !!h.resolved_at : !h.resolved_at)
    && (st.sev === "all" || (st.sev === "hm" ? h.severity !== "low" : h.severity === st.sev))
    && (!st.run || (h.runs || []).includes(st.run))
    && (!st.src || (st.src === "drv" ? !!h.reported_by : !h.reported_by))
    && (!t || [h.address, h.area, h.note, h.control, h.rule, h.ref, ...(h.kinds || []).map(kl)].join(" ").toLowerCase().includes(t)))
    .sort((a, b) => (b.reported_by && !a.reported_by ? 1 : a.reported_by && !b.reported_by ? -1 : 0) || ord[a.severity] - ord[b.severity] || a.address.localeCompare(b.address));
}
const runsUsed = () => [...new Set((S.hazards || []).flatMap(h => h.runs || []))].sort();
function list() {
  const r = rows();
  return r.length ? r.map(h => `<div class="item ${SEV[h.severity]?.[1] || ""}" data-hzedit="${h.id}" style="cursor:pointer">
      <div class="row" style="justify-content:space-between;align-items:baseline"><b>${esc(h.address)}</b><span>${pill(SEV[h.severity][0], SEV[h.severity][1])}${h.rule ? " " + pill(h.rule, h.rule === "NO-GO" ? "crit" : "") : ""}</span></div>
      <div class="meta">${(h.kinds || []).map(kl).join(" · ")}${h.area ? ` · ${esc(h.area)}` : ""}${(h.runs || []).length ? ` · ${esc(h.runs.join(", "))}` : ""}${h.ref ? ` · ${esc(h.ref)}` : ""}</div>
      ${h.note ? `<div>${esc(h.note)}</div>` : ""}${h.control ? `<div class="meta">→ ${esc(h.control)}</div>` : ""}
      ${h.reported_by ? `<div class="meta">Reported by ${esc(first(S.peopleBy[h.reported_by]?.name || h.reported_by))} · ${label(nzNow(new Date(h.created_at)).date)}${h.lat != null ? ` · <a href="https://maps.google.com/?q=${h.lat},${h.lng}" target="_blank" rel="noopener">map</a>` : ""}</div>` : ""}
    </div>`).join("") + `<p class="meta">${r.length} shown</p>` : `<div class="empty">Nothing matches.</div>`;
}
export function hazardsTab() {
  const all = (S.hazards || []).filter(h => !h.resolved_at); const c = s => all.filter(h => h.severity === s).length;
  return `<div class="card"><h2>Hazard register<span>${all.length} open · ${c("high")} high · ${c("medium")} medium · ${c("low")} low</span></h2>
    <div class="row" style="align-items:flex-end;flex-wrap:wrap">
      <label class="f" style="flex:2 1 200px">Search<input class="in" id="hz-q" value="${esc(st.q)}" placeholder="Street, suburb, dog, ice…"></label>
      <label class="f" style="flex:1 1 120px">Level<select class="in" id="hz-sev">${[["hm", "High + medium"], ["high", "High"], ["medium", "Medium"], ["low", "Low / info"], ["all", "All"]].map(([v, l]) => `<option value="${v}" ${st.sev === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f" style="flex:1 1 110px">Run<select class="in" id="hz-run"><option value="">All runs</option>${runsUsed().map(r => `<option ${st.run === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></label>
      <label class="f" style="flex:1 1 130px">From<select class="in" id="hz-src">${[["", "Everything"], ["drv", "Driver reports"], ["reg", "Paper registers"]].map(([v, l]) => `<option value="${v}" ${st.src === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="chk ${st.resolved ? "on" : ""}" style="flex:0 0 auto"><input type="checkbox" id="hz-res" ${st.resolved ? "checked" : ""}>Resolved</label>
      <button class="btn sm" id="hz-add" style="flex:0 0 auto">+ Add hazard</button></div>
    <p class="hint" style="margin:6px 0 0">Driver reports show first. Drivers see high and medium hazards for the runs they're on today, and a heads-up near any hazard that has a GPS location.</p></div>
    <div class="card"><h2>Hazards</h2><div class="list" id="hz-list">${list()}</div></div>`;
}
export function wireHazards() {
  const redraw = () => { const el = $("#hz-list"); if (el) { el.innerHTML = list(); bindRows(); } };
  $("#hz-q")?.addEventListener("input", e => { st.q = e.target.value; redraw(); });
  $("#hz-sev")?.addEventListener("change", e => { st.sev = e.target.value; redraw(); });
  $("#hz-run")?.addEventListener("change", e => { st.run = e.target.value; redraw(); });
  $("#hz-src")?.addEventListener("change", e => { st.src = e.target.value; redraw(); });
  $("#hz-res")?.addEventListener("change", e => { st.resolved = e.target.checked; e.target.parentElement.classList.toggle("on", st.resolved); redraw(); });
  $("#hz-add")?.addEventListener("click", () => edit(null));
  bindRows();
}
function bindRows() { $$("[data-hzedit]").forEach(el => el.onclick = e => { if (e.target.closest("a")) return; edit(el.dataset.hzedit); }); }

function edit(id) {
  const h = id ? (S.hazards || []).find(x => x.id === id) : { kinds: [], runs: [], severity: "medium" }; if (!h) return;
  const runCodes = S.runs.map(r => r.code);
  sheet(`<h3>${id ? "Edit hazard" : "Add hazard"}</h3><form class="frm" id="hzf">
    <label class="f full">Address<input class="in" id="e-addr" value="${esc(h.address || "")}" required></label>
    <label class="f">Area / suburb<input class="in" id="e-area" value="${esc(h.area || "")}"></label>
    <label class="f">Level<select class="in" id="e-sev">${Object.entries(SEV).map(([v, [l]]) => `<option value="${v}" ${h.severity === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <div class="f full">Type<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">${HZ_KINDS.map(([k, l]) => `<label class="chk ${h.kinds?.includes(k) ? "on" : ""}"><input type="checkbox" name="kind" value="${k}" ${h.kinds?.includes(k) ? "checked" : ""}>${l}</label>`).join("")}</div></div>
    <div class="f full">Runs<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">${runCodes.map(c => `<label class="chk ${h.runs?.includes(c) ? "on" : ""}"><input type="checkbox" name="run" value="${c}" ${h.runs?.includes(c) ? "checked" : ""}>${esc(c)}</label>`).join("")}</div></div>
    <label class="f">Delivery rule<select class="in" id="e-rule">${RULES.map(r => `<option value="${r}" ${(h.rule || "") === r ? "selected" : ""}>${r || "—"}</option>`).join("")}</select></label>
    <label class="f full">Hazard<textarea class="in" id="e-note" rows="2">${esc(h.note || "")}</textarea></label>
    <label class="f full">What to do (control)<textarea class="in" id="e-ctl" rows="2">${esc(h.control || "")}</textarea></label>
    ${h.reported_by ? `<p class="meta full">Reported by ${esc(S.peopleBy[h.reported_by]?.name || h.reported_by)} · ${label(nzNow(new Date(h.created_at)).date, true)}</p>` : h.source ? `<p class="meta full">${esc(h.ref || "")} · ${esc(h.source)}</p>` : ""}
    <button class="btn full" type="submit">Save</button>
    ${id ? `<div class="row full"><button class="btn ghost" type="button" id="e-res">${h.resolved_at ? "Re-open" : "Mark resolved (no longer a hazard)"}</button><button class="btn ghost" type="button" id="e-del" style="color:var(--crit)">Delete</button></div>` : ""}
    </form>`, (bg, close) => {
    bg.querySelectorAll(".chk input").forEach(i => i.onchange = () => i.parentElement.classList.toggle("on", i.checked));
    const g = s => bg.querySelector(s);
    const done = async (msg) => { close(); toast(msg, "ok"); await loadAll(); render(); };
    g("#hzf").onsubmit = async e => { e.preventDefault();
      const row = { address: g("#e-addr").value.trim(), area: g("#e-area").value.trim() || null, severity: g("#e-sev").value, rule: g("#e-rule").value || null, note: g("#e-note").value.trim() || null, control: g("#e-ctl").value.trim() || null,
        kinds: [...bg.querySelectorAll("input[name=kind]:checked")].map(i => i.value), runs: [...bg.querySelectorAll("input[name=run]:checked")].map(i => i.value) };
      const { error } = id ? await sb.from("hazards").update(row).eq("id", id) : await sb.from("hazards").insert({ ...row, source: "Owner portal", reported_by: S.me.id });
      if (error) return toast(error.message, "err"); done("Saved ✓"); };
    g("#e-res")?.addEventListener("click", async () => { const { error } = await sb.from("hazards").update(h.resolved_at ? { resolved_at: null, resolved_by: null } : { resolved_at: new Date().toISOString(), resolved_by: S.me.id }).eq("id", id); if (error) return toast(error.message, "err"); done(h.resolved_at ? "Re-opened" : "Marked resolved"); });
    g("#e-del")?.addEventListener("click", async () => { if (!confirm("Delete this hazard for good? (Mark resolved keeps the record.)")) return; const { error } = await sb.from("hazards").delete().eq("id", id); if (error) return toast(error.message, "err"); done("Deleted"); });
  }, { wide: true });
}
