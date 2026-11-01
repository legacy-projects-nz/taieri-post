// Quick "Record an error" card: driver, issue, description, % off (preset, changeable). Saved as a Mistake entry.
import { sb, q, today, esc, $, toast } from "/shared/core.js";
import { S, sheet, opt, nm, loadAll, render, fn } from "/admin/admin.js";

export const ERROR_ISSUES = ["Parcels", "Driving", "Admin", "Communication", "Vehicle", "Safety", "Timing", "Other"];

export function errorCard(driver = "") {
  const def = S.C.rules.mistakePct;
  sheet(`<h3>Record an error</h3>
    <form class="frm" id="qe">
      <label class="f">Driver<select class="in" id="qe-drv">${opt(S.drivers.filter(d => d.role === "driver" || true).map(d => [d.id, d.name]), driver)}</select></label>
      <label class="f">Category<select class="in" id="qe-issue">${opt(ERROR_ISSUES.map(x => [x, x]))}</select></label>
      <label class="f full">Description<textarea class="in" id="qe-desc" rows="3" placeholder="What happened, where, anything else to note" required></textarea></label>
      <label class="f">% off Accuracy<input class="in" id="qe-pct" inputmode="decimal" value="${def}"></label>
      <label class="f">Date<input class="in" type="date" id="qe-day" value="${today()}" required></label>
      <label class="chk on"><input type="checkbox" id="qe-show" checked>Show the driver</label>
      <button class="btn full" type="submit">Save error</button>
    </form><p class="hint">Takes ${def}% off Accuracy unless you change it here. Tick "Show the driver" to put it on their page under "From Jeremy" with a review button.</p>`, (bg, close) => {
    bg.querySelector("#qe").addEventListener("submit", async e => {
      e.preventDefault(); const g = x => bg.querySelector("#" + x).value; const pct = +g("qe-pct");
      if (!(pct >= 0 && pct <= 100)) return toast("% off must be 0 to 100", "err");
      const issue = g("qe-issue"), desc = g("qe-desc").trim(); const show = bg.querySelector("#qe-show").checked;
      const { error } = await sb.from("entries").insert({ driver: g("qe-drv"), day: g("qe-day"), kind: "mistake", title: issue, note: desc || null, issue, pct_off: pct, show_driver: show, created_by: S.me.id });
      if (error) return toast(error.message, "err");
      toast("Error recorded", "ok"); close(); fn("notify", { type: "entry", driver: g("qe-drv"), title: issue, kind: "mistake" }).catch(() => { }); await loadAll(); render();
    });
  });
}
