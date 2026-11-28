// Weekly roster brief: Jeremy writes the week's notes once on the Run Board, the app adds each driver's own van hand-overs and
// back-up days (and the West Harbour delivery standards for PCB / RSB drivers), and sends one brief per driver.
// The driver app pops it up until they tap "I've read it"; message_recipients.confirmed_at is the record.
// Live shows a "Roster read" button on Sundays (and Monday until everyone has read it).
import { sb, q, nzNow, today, addDays, dow, monOf, label, toMin, fmtT, fmtTs, esc, $, toast, first, briefHtml } from "/shared/core.js";
import { segTimes } from "/shared/score.js";
import { S, sheet, nm, fnm, loadAll, render, fn } from "/admin/admin.js";

const WH_PEOPLE = new Set(["dmudmnk49", "dmudmybov"]);   // James M and Allan only get the West Harbour delivery standards
const DEFAULT_ALL = `## This week\n- Check your days, start times and vans in My shifts.\n- Tell Jeremy today if anything looks wrong.`;
const wkLabel = wk => { const a = new Date(wk + "T12:00:00Z"), b = new Date(addDays(wk, 6) + "T12:00:00Z"); const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${M[b.getUTCMonth()]}` : `${a.getUTCDate()} ${M[a.getUTCMonth()]} – ${b.getUTCDate()} ${M[b.getUTCMonth()]}`; };
const weekOf = wk => S.shifts.filter(s => s.day >= wk && s.day <= addDays(wk, 6) && s.driver);
export const allText = wk => { const n = S.notes.find(x => x.week_start === wk); return n?.brief ?? DEFAULT_ALL; };
export const whText = () => S.set.brief_wh?.text || "";
/** drivers who get the brief: anyone rostered or on back-up that week (not the sender) */
export const briefPeople = wk => [...new Set(weekOf(wk).map(s => s.driver))].filter(d => d !== S.me.id && S.peopleBy[d]?.active !== false).sort((a, b) => nm(a).localeCompare(nm(b)));

/** the driver's own part: van hand-overs and back-up days */
function ownPart(wk, d) {
  const W = weekOf(wk); const tm = s => segTimes(s, S.runsBy); const out = [];
  const vans = [];
  for (const s of W.filter(x => x.driver === d && x.run !== "BU" && x.van).sort((a, b) => a.day.localeCompare(b.day) || (tm(a).st ?? 0) - (tm(b).st ?? 0))) {
    const mine = tm(s); const others = W.filter(o => o.day === s.day && o.van === s.van && o.driver !== d && o.run !== "BU");
    for (const o of others) { const t = tm(o);
      if (t.en != null && mine.st != null && t.en <= mine.st + 5) vans.push(`**${label(s.day)}:** ${s.van} comes from ${fnm(o.driver)} (${o.run}, back by ${fmtT(t.en)}) for your ${s.run} at ${fmtT(mine.st)}.`);
      else if (t.st != null && mine.en != null && t.st >= mine.en - 5) vans.push(`**${label(s.day)}:** have ${s.van} back, clean, with the keys and scanner in the cupboard, by ${fmtT(t.st)}. ${fnm(o.driver)} takes it for ${o.run}.`);
      else vans.push(`**${label(s.day)}:** ${s.van} is also down for ${fnm(o.driver)} (${o.run}). Check with Jeremy.`); } }
  if (vans.length) out.push("## Van hand-overs", ...vans.map(v => "- " + v));
  const bu = W.filter(x => x.driver === d && x.run === "BU").sort((a, b) => a.day.localeCompare(b.day));
  if (bu.length) out.push("## Your back-up days", ...bu.map(s => { const t = tm(s); return `- **${label(s.day)}:** ${t.st != null ? `${fmtT(t.st)}–${fmtT(t.en)}` : "all day"}, ${s.bu_kind === "committed" ? "compulsory" : "non-compulsory"}`; }));
  return out.join("\n");
}
export function briefFor(wk, d) {
  const isWH = WH_PEOPLE.has(d);
  return [`Hi ${first(nm(d))},`, "", allText(wk), "", ownPart(wk, d), isWH && whText() ? `\n## West Harbour delivery standards\n${whText()}` : ""].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** latest brief per driver for a week, with read / confirmed times */
export function briefStatus(wk) {
  const ms = S.msgs.filter(m => m.kind === "brief" && m.week_start === wk); const by = {};
  for (const m of ms.sort((a, b) => a.created_at.localeCompare(b.created_at))) for (const r of S.recips.filter(r => r.message_id === m.id)) by[r.person] = { m, r };
  return by;
}

/* ---- Run Board card ---- */
export function briefCard(wk) {
  const can = S.me.can("roster"); const ppl = briefPeople(wk); const st = briefStatus(wk); const sent = Object.keys(st).length;
  const done = Object.values(st).filter(x => x.r.confirmed_at).length; const pick = S.briefPick && ppl.includes(S.briefPick) ? S.briefPick : ppl[0];
  return `<div class="card" id="brief"><h2>Roster brief<span>${sent ? `${done} of ${sent} read & acknowledged` : "not sent yet"} · week of ${label(wk)}</span></h2>
    <p class="hint">Pops up in each driver's app until they tick Read on each section and tap Submit. Each driver also gets their own van hand-overs and back-up days, James M and Allan get the West Harbour delivery standards. Use ## for a heading, - for a bullet, **bold**.</p>
    <div class="grid2"><label class="f">For everyone this week<textarea class="in" id="br-all" rows="9" ${can ? "" : "disabled"}>${esc(allText(wk))}</textarea></label>
    <label class="f">West Harbour delivery standards (James M and Allan, every week)<textarea class="in" id="br-wh" rows="9" ${can ? "" : "disabled"}>${esc(whText())}</textarea></label></div>
    ${ppl.length ? `<div class="row" style="align-items:center;margin-top:8px"><span class="meta">Preview for</span><select class="in" id="br-pick" style="max-width:200px">${ppl.map(d => `<option value="${d}" ${d === pick ? "selected" : ""}>${esc(nm(d))}</option>`).join("")}</select></div>
    <div class="item" style="margin-top:6px">${briefHtml(briefFor(wk, pick))}</div>` : `<p class="empty">Nobody is rostered this week yet.</p>`}
    ${sent ? statusList(wk) : ""}
    ${can && ppl.length && !heldOf(wk).length ? `<button class="btn full" id="br-send" style="margin-top:8px">${sent ? "Send updated brief" : "Send roster brief"} to ${ppl.length} driver${ppl.length === 1 ? "" : "s"}</button>` : ""}</div>
    ${commsCard(wk)}`;
}
/* ---- Week comms: driver notes + group email, marked ready, then sent together with "Approve & send all" ---- */
const noteOf = wk => S.notes.find(x => x.week_start === wk) || {};
export const heldOf = wk => S.msgs.filter(m => m.kind === "brief" && m.week_start === wk && m.held);
export function commsState(wk) { const n = noteOf(wk); return { notes: !!n.notes_ready_at, email: !!n.email_ready_at, sent: n.comms_sent_at || null, held: heldOf(wk).length }; }
const mdMail = md => { const out = []; let ul = false; const inl = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  for (const raw of String(md || "").split(/\r?\n/)) { const l = raw.trim(); const li = /^[-•]\s+(.*)$/.exec(l); const h = /^#{1,3}\s+(.*)$/.exec(l);
    if (li) { if (!ul) { out.push("<ul>"); ul = true; } out.push(`<li>${inl(li[1])}</li>`); continue; }
    if (ul) { out.push("</ul>"); ul = false; }
    if (h) out.push(`<p><b>${inl(h[1])}</b></p>`); else if (l) out.push(`<p>${inl(l)}</p>`); }
  if (ul) out.push("</ul>"); return out.join(""); };
function commsCard(wk) {
  const can = S.me.isOwner || S.me.can("roster_approve"); const n = noteOf(wk); const c = commsState(wk); const st = briefStatus(wk);
  const notesN = c.held || Object.keys(st).length;
  return `<div class="card" id="comms"><h2>Week comms<span>${c.sent ? `✓ sent ${fmtTs(c.sent)}` : `${c.notes ? "✓ driver notes ready" : "driver notes not ready"} · ${c.email ? "✓ email ready" : "email not ready"}`}</span></h2>
    <p class="hint">Mark the driver notes and the group email ready once you're happy with them. "Approve & send all" then approves the roster, releases each driver's notes in the app and emails everyone.</p>
    <div class="row" style="align-items:center;gap:8px"><b style="flex:1">Driver notes</b><span class="meta">${c.held ? `${c.held} held until sent` : notesN ? `${notesN} sent` : "none yet"}</span>
      ${can && !c.sent ? `<button class="btn sm ${c.notes ? "ghost" : ""}" id="cm-notes">${c.notes ? "✓ Driver notes ready" : "Mark driver notes ready"}</button>` : ""}</div>
    <label class="f" style="margin-top:8px">Group email subject<input class="in" id="cm-subj" value="${esc(n.email_subject || `Roster – week of ${wkLabel(wk)}`)}" ${can && !c.sent ? "" : "disabled"}></label>
    <label class="f">Group email (## heading, - bullet, **bold**)<textarea class="in" id="cm-body" rows="12" ${can && !c.sent ? "" : "disabled"}>${esc(n.email_body || "")}</textarea></label>
    <details><summary>Preview</summary><div class="item" style="margin-top:6px">${mdMail(n.email_body)}</div></details>
    ${can && !c.sent ? `<button class="btn sm ${c.email ? "ghost" : ""}" id="cm-email" style="margin-top:6px">${c.email ? "✓ Email ready" : "Mark email ready"}</button>` : ""}</div>`;
}
export function wireComms(wk) {
  const save = async (extra = {}) => { const s = $("#cm-subj")?.value, b = $("#cm-body")?.value;
    await q(sb.from("week_notes").upsert({ week_start: wk, email_subject: s, email_body: b, updated_at: new Date().toISOString(), ...extra })); };
  $("#cm-subj")?.addEventListener("blur", async () => { await save({ email_ready_at: null }); await loadAll(); render(true); });
  $("#cm-body")?.addEventListener("blur", async () => { const n = noteOf(wk); if (($("#cm-body").value || "") === (n.email_body || "")) return; await save({ email_ready_at: null }); await loadAll(); render(true); toast("Email saved — mark it ready again when you're happy", "ok"); });
  $("#cm-email")?.addEventListener("click", async () => { const on = !commsState(wk).email; await save({ email_ready_at: on ? new Date().toISOString() : null }); await loadAll(); render(true); });
  $("#cm-notes")?.addEventListener("click", async () => { const on = !commsState(wk).notes; await q(sb.from("week_notes").upsert({ week_start: wk, notes_ready_at: on ? new Date().toISOString() : null, updated_at: new Date().toISOString() })); await loadAll(); render(true); });
}
/** release held driver notes (or create them), push each driver, email everyone the group email */
export async function sendAllComms(wk) {
  const n = noteOf(wk); const held = heldOf(wk); let ids = [];
  if (held.length) { await q(sb.from("messages").update({ held: false }).in("id", held.map(m => m.id))); ids = held.map(m => m.id); }
  else if (!Object.keys(briefStatus(wk)).length) for (const d of briefPeople(wk)) { const msg = await q(sb.from("messages").insert({ sender: S.me.id, kind: "brief", week_start: wk, title: `Roster · ${wkLabel(wk)}`, body: briefFor(wk, d), needs_confirm: true }).select().single()); await q(sb.from("message_recipients").insert({ message_id: msg.id, person: d })); ids.push(msg.id); }
  for (const id of ids) fn("notify", { type: "message", message_id: id }).catch(() => { });
  const to = [...new Set([...briefPeople(wk), ...S.recips.filter(r => held.some(m => m.id === r.message_id)).map(r => r.person)])].map(d => S.peopleBy[d]?.email).filter(Boolean);
  let fails = 0; if (n.email_body) for (const e of to) await fn("notify", { type: "email", to: [e], subject: n.email_subject || `Roster – week of ${wkLabel(wk)}`, html: mdMail(n.email_body) }).catch(() => { fails++; });
  await q(sb.from("week_notes").upsert({ week_start: wk, comms_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
  return { notes: ids.length, emails: to.length - fails, fails };
}
export function statusList(wk) {
  const st = briefStatus(wk); const ppl = [...new Set([...briefPeople(wk), ...Object.keys(st)])].sort((a, b) => nm(a).localeCompare(nm(b)));
  return `<div class="list" style="margin-top:8px">${ppl.map(d => { const x = st[d];
    const cls = !x ? "" : x.r.confirmed_at ? "ok done" : x.r.read_at ? "warn" : "crit";
    const txt = !x ? "not sent" : x.r.confirmed_at ? `✓ read & acknowledged ${fmtTs(x.r.confirmed_at)}` : x.r.read_at ? `opened ${fmtTs(x.r.read_at)}, not acknowledged` : `sent ${fmtTs(x.m.created_at)}, not opened`;
    return `<div class="item ${cls}"><div class="row" style="justify-content:space-between;align-items:center;gap:6px"><b>${esc(nm(d))}</b><span class="meta">${txt}</span>${x && !x.r.confirmed_at && S.me.can("roster") ? `<button class="btn sm ghost" data-brnudge="${x.m.id}|${d}">Nudge</button>` : ""}</div></div>`; }).join("")}</div>`;
}
export function wireBrief(wk) {
  const save = async () => {
    const a = $("#br-all")?.value, w = $("#br-wh")?.value;
    if (a != null && a !== allText(wk)) { await q(sb.from("week_notes").upsert({ week_start: wk, brief: a, updated_at: new Date().toISOString() })); }
    if (w != null && w !== whText()) { await q(sb.from("settings").upsert({ key: "brief_wh", value: { text: w } })); }
  };
  $("#br-all")?.addEventListener("blur", async () => { await save(); await loadAll(); render(true); toast("Brief saved", "ok"); });
  $("#br-wh")?.addEventListener("blur", async () => { await save(); await loadAll(); render(true); toast("Standards saved", "ok"); });
  $("#br-pick")?.addEventListener("change", e => { S.briefPick = e.target.value; render(true); });
  $("#br-send")?.addEventListener("click", async () => { await save(); await loadAll(); sendSheet(wk); });
  wireNudge(document);
}
export function wireNudge(root) {
  root.querySelectorAll("[data-brnudge]").forEach(b => b.onclick = async e => { e.stopPropagation(); b.disabled = true; const [mid] = b.dataset.brnudge.split("|");
    try { await fn("notify", { type: "message", message_id: mid }); toast("Nudge sent", "ok"); } catch (err) { b.disabled = false; toast(err.message, "err"); } });
}
function sendSheet(wk) {
  const ppl = briefPeople(wk); const noMail = ppl.filter(d => !S.peopleBy[d]?.email);
  sheet(`<h3>Send roster brief · ${wkLabel(wk)}</h3><p class="hint">Each driver gets their own brief as a pop-up in the app and a phone notification. It stays up until they tick Read on each section and tap Submit.</p>
    <p><b>To:</b> ${ppl.map(d => esc(fnm(d))).join(", ")}</p>
    <label class="chk full on"><input type="checkbox" id="br-mail" checked>Also email everyone that the roster is live in the app</label>
    ${noMail.length ? `<p class="hint c-warn">No email for ${noMail.map(d => esc(fnm(d))).join(", ")}. They still get the app pop-up.</p>` : ""}
    <details><summary>Email they'll get</summary><div class="item" style="margin-top:6px">${mailHtml(wk, "[first name]")}</div></details>
    <button class="btn full" id="br-go">Send</button>`, (bg, close) => {
    bg.querySelector("#br-go").onclick = async e => { e.target.disabled = true;
      try {
        for (const d of ppl) {
          const msg = await q(sb.from("messages").insert({ sender: S.me.id, kind: "brief", week_start: wk, title: `Roster · ${wkLabel(wk)}`, body: briefFor(wk, d), needs_confirm: true }).select().single());
          await q(sb.from("message_recipients").insert({ message_id: msg.id, person: d }));
          fn("notify", { type: "message", message_id: msg.id }).catch(() => { });
          const p = S.peopleBy[d]; if (bg.querySelector("#br-mail").checked && p?.email) await fn("notify", { type: "email", to: [p.email], subject: `Your roster for ${wkLabel(wk)} is live in the app – please read`, html: mailHtml(wk, first(p.name)) }).catch(err => toast(`Email to ${fnm(d)}: ${err.message}`, "err"));
        }
        close(); toast(`Brief sent to ${ppl.length}`, "ok"); await loadAll(); render(true);
      } catch (err) { e.target.disabled = false; toast(err.message, "err"); } };
  });
}
const mailHtml = (wk, name) => `<p>Hi ${esc(name)},</p><p>Your roster for <b>${wkLabel(wk)}</b> is live in the Taieri Post app.</p><p>Open the app: your roster brief pops up. Read it through, especially your vans, timing and back-up days, tick <b>Read</b> on each section, then tap <b>Submit</b>. If anything doesn't look right, tell me today.</p><p><a href="https://taieri-post.onrender.com/">Open the app</a></p><p>Thanks,<br>${esc(first(S.me.name))}</p>`;

/* ---- Live: "Roster read" button (Sundays, and Monday until everyone has read it) ---- */
function liveWeek() { const n = nzNow(); const d = dow(n.date); if (d === 6) return addDays(monOf(n.date), 7); if (d === 0) return monOf(n.date); return null; }
export function briefBtn() {
  const wk = liveWeek(); if (!wk) return ""; const st = briefStatus(wk); const ppl = briefPeople(wk); const sent = Object.keys(st).length;
  const done = Object.values(st).filter(x => x.r.confirmed_at).length;
  if (dow(today()) === 0 && sent && done === sent) return "";
  const cls = !sent ? "warn" : done === sent ? "ok" : "crit";
  return `<button class="btn sm ${cls === "crit" ? "crit" : cls === "warn" ? "" : "ghost"}" id="br-live" style="margin:0 6px 10px 0">📋 Roster read ${sent ? `${done}/${sent}` : `· brief not sent (${ppl.length} drivers)`}</button>`;
}
export function wireBriefLive() {
  $("#br-live")?.addEventListener("click", () => { const wk = liveWeek() || monOf(today());
    const open = () => { const st = briefStatus(wk); const sent = Object.keys(st).length;
      const { bg } = sheet(`<h3>Roster read & acknowledged · ${wkLabel(wk)}</h3>${sent ? statusList(wk) : `<p class="hint">The brief for this week hasn't been sent yet.</p>`}
        <button class="btn ghost full" id="br-go-rb" style="margin-top:8px">${sent ? "Open the brief on the Run Board" : "Write and send it on the Run Board"}</button>`, b => { wireNudge(b);
        b.querySelector("#br-go-rb").onclick = () => { b._close(); S.week = wk; S.rbView = "week"; S.tab = "runboard"; location.hash = "runboard"; render(); setTimeout(() => document.getElementById("brief")?.scrollIntoView({ behavior: "smooth" }), 300); }; }, { wide: true }); };
    open(); });
}
