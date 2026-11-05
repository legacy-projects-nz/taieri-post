// Sick days: long-press a Run Board shift tile (or right-click on a computer) to mark the driver off sick.
// Paid or unpaid: sick leave is paid once the person has been employed 6 months (people.started).
// The owner can override either way; other staff with the leave area get the default.
import { sb, q, label, esc, toast, first } from "/shared/core.js";
import { S, sheet, nm, fn } from "/admin/admin.js";

export const SIX_MONTHS_NOTE = "Sick leave is paid once someone has been employed for 6 months.";

// date (YYYY-MM-DD) six calendar months after a start date
export function sixMonthsFrom(started) {
  if (!started) return null; const [y, m, d] = started.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + 6, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last)); return t.toISOString().slice(0, 10);
}
// { paid: true|false|null, why } — null when no start date is on file
export function sickDefault(driver, day) {
  const p = S.peopleBy[driver]; const st = p?.started; if (!st) return { paid: null, why: `No start date on file for ${first(p?.name || driver)} — add it on their People sheet.` };
  const six = sixMonthsFrom(st);
  return day >= six ? { paid: true, why: `Started ${label(st, true)} · 6 months reached ${label(six, true)} → paid` }
    : { paid: false, why: `Started ${label(st, true)} · not 6 months until ${label(six, true)} → unpaid` };
}
export const paidPill = l => l.type !== "sick" && l.paid == null ? "" : l.paid === true ? `<span class="pill ok">paid</span>` : l.paid === false ? `<span class="pill crit">unpaid</span>` : `<span class="pill grey">paid?</span>`;
export const sickOn = (drv, day) => S.leave.find(l => l.driver === drv && l.type === "sick" && l.status === "approved" && day >= l.date_from && day <= l.date_to);

// the long-press menu
export function sickSheet(driver, day) {
  const canLeave = S.me.isOwner || S.me.can("leave"); if (!canLeave) return toast("You need the Leave area to mark someone sick", "err");
  const cur = sickOn(driver, day); const def = sickDefault(driver, day); const owner = S.me.isOwner;
  let paid = cur ? cur.paid : def.paid;
  const btn = (v, txt) => `<button type="button" class="btn ${paid === v ? "" : "ghost"}" data-paid="${v}" ${owner ? "" : "disabled"} style="flex:1">${txt}</button>`;
  sheet(`<h3>${esc(nm(driver))} · ${label(day)}</h3>
    <p class="meta">${cur ? "Already off sick this day." : "Mark off sick for the whole day."}</p>
    <div class="card" style="margin:10px 0"><div class="row" style="gap:6px" id="pd">${btn(true, "Paid")}${btn(false, "Unpaid")}</div>
      <p class="hint" style="margin-top:8px">${esc(def.why)}<br>${SIX_MONTHS_NOTE}${owner ? " You can change it either way." : " Only the owner can change paid / unpaid."}</p></div>
    <input class="in" id="sk-note" placeholder="Note (optional), e.g. texted at 5:40am" value="${esc(cur?.notes && !/^Entered by/.test(cur.notes) ? cur.notes : "")}" style="width:100%;margin-bottom:10px">
    <div class="row" style="gap:6px"><button class="btn" id="sk-go" style="flex:2">${cur ? "Save" : "Mark off sick"}</button>${cur ? `<button class="btn crit ghost" id="sk-del" style="flex:1">Not sick</button>` : ""}</div>
    <p class="hint">Their shift stays on the board marked "sick" so you can see who to cover. Tap the tile as normal to put someone else on it.</p>`, (bg, close) => {
    bg.querySelectorAll("[data-paid]").forEach(b => b.onclick = () => { paid = b.dataset.paid === "true"; bg.querySelectorAll("[data-paid]").forEach(x => x.classList.toggle("ghost", x !== b)); });
    bg.querySelector("#sk-go").onclick = async () => {
      if (paid == null) return toast("Pick paid or unpaid", "err");
      const note = bg.querySelector("#sk-note").value.trim(); const notes = note || `Entered by ${first(S.me.name)}`;
      if (cur) await q(sb.from("leave_requests").update({ paid, notes }).eq("id", cur.id));
      else await q(sb.from("leave_requests").insert({ driver, type: "sick", date_from: day, date_to: day, part: "full", notes, status: "approved", decided_by: S.me.id, decided_at: new Date().toISOString(), acked_email_at: new Date().toISOString(), paid }));
      close(); toast(`${first(nm(driver))} off sick · ${paid ? "paid" : "unpaid"}`, "ok"); };
    bg.querySelector("#sk-del")?.addEventListener("click", async () => { await q(sb.from("leave_requests").update({ status: "cancelled", reply: `Not sick after all · ${first(S.me.name)}` }).eq("id", cur.id)); close(); toast("Sick day removed", "ok"); });
  });
}

// long-press (touch) or right-click (mouse) on an element → cb; swallows the tap that follows a long-press
export function onLongPress(el, cb, ms = 550) {
  let t = null, fired = false, x0 = 0, y0 = 0;
  const stop = () => { clearTimeout(t); t = null; };
  el.addEventListener("pointerdown", e => { if (e.button && e.button !== 0) return; fired = false; x0 = e.clientX; y0 = e.clientY; stop(); t = setTimeout(() => { fired = true; navigator.vibrate?.(15); cb(); }, ms); });
  el.addEventListener("pointermove", e => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) stop(); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => el.addEventListener(ev, stop));
  el.addEventListener("click", e => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  el.addEventListener("contextmenu", e => { e.preventDefault(); stop(); cb(); });
  el.style.webkitTouchCallout = "none"; el.style.userSelect = "none";
}
