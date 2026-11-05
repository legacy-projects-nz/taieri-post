// Sign-in screen (email code / link) and two-factor for staff
import { sb, session, sendCode, verifyCode, me, aal, esc, $, h, toast } from "./core.js";
import { DEMO_EMAILS, startDemo } from "./demo.js";

const WHO = "Taieri Post";

export async function requireUser(root, { staff = false } = {}) {
  let s = await session();
  if (!s) { await signInScreen(root); s = await session(); }
  let person = await me();
  if (!person) { root.innerHTML = notOnList(s.user.email); throw new Error("not on list"); }
  if (!person.active) { root.innerHTML = `<div class="wrap"><div class="card"><h2>Account paused</h2><p>Your Taieri Post account is paused. Talk to Jeremy if that's a surprise.</p>${outBtn()}</div></div>`; wireOut(root); throw new Error("inactive"); }
  if (person.isStaff) {
    const a = await aal();
    if (a.currentLevel !== "aal2") { await mfaScreen(root, a, person); }
  }
  return person;
}

function outBtn() { return `<button class="btn ghost" id="signout">Sign out</button>`; }
function wireOut(root) { root.querySelector("#signout")?.addEventListener("click", () => sb.auth.signOut().then(() => location.reload())); }
function notOnList(email) { return `<div class="wrap"><div class="card hot"><h2>Not on the staff list</h2><p><b>${esc(email)}</b> isn't set up for ${WHO}. Ask Jeremy to add this address, or sign in with the one he has for you.</p>${outBtn()}</div></div>`; }

function signInScreen(root) {
  return new Promise(resolve => {
    root.innerHTML = `<div class="wrap" style="max-width:460px;min-height:80vh;justify-content:center">
      <div class="top"><div><div class="brand">${WHO}</div><h1>Sign in</h1></div></div>
      <form class="card" id="f1"><label class="f">Your email<input id="em" type="email" inputmode="email" autocomplete="email" required placeholder="you@example.com" autofocus></label>
        <button class="btn" type="submit">Email me a sign-in code</button>
        <p class="hint">We'll email you a 6-digit code. You only do this once on each phone. No password.</p></form>
      <form class="card hidden" id="f2"><p>Check your email at <b id="emb"></b>.</p>
        <label class="f">6-digit code<input id="code" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" placeholder="123456"></label>
        <button class="btn" type="submit">Sign in</button>
        <p class="hint">Didn't get it? Check spam, or <button type="button" class="linkbtn" id="again">send it again</button>.</p></form>
      <p class="foot">Safe. Sharp. Swift.</p></div>`;
    const f1 = $("#f1", root), f2 = $("#f2", root); let email = "";
    f1.onsubmit = async e => { e.preventDefault(); email = $("#em", root).value.trim().toLowerCase(); const b = f1.querySelector("button"); b.disabled = true; b.textContent = "Sending…";
      if (DEMO_EMAILS.includes(email)) { startDemo(); location.reload(); return; }   // demo profile: no code needed, nothing real behind it
      try { await sendCode(email); $("#emb", root).textContent = email; f1.classList.add("hidden"); f2.classList.remove("hidden"); $("#code", root).focus(); }
      catch (err) { toast(err.message || "Couldn't send the email", "err"); b.disabled = false; b.textContent = "Email me a sign-in code"; } };
    $("#again", root).onclick = async () => { try { await sendCode(email); toast("Sent again", "ok"); } catch (err) { toast(err.message, "err"); } };
    f2.onsubmit = async e => { e.preventDefault(); const b = f2.querySelector("button[type=submit]"); b.disabled = true;
      try { await verifyCode(email, $("#code", root).value.trim()); resolve(); } catch (err) { toast("That code didn't work. Check it and try again.", "err"); b.disabled = false; } };
    sb.auth.onAuthStateChange((ev, s) => { if (s && (ev === "SIGNED_IN" || ev === "TOKEN_REFRESHED")) resolve(); });
  });
}

async function mfaScreen(root, a, person) {
  const { data: f } = await sb.auth.mfa.listFactors();
  const totp = (f?.totp || []).find(x => x.status === "verified");
  return new Promise(resolve => {
    const wrap = html => { root.innerHTML = `<div class="wrap" style="max-width:460px;min-height:80vh;justify-content:center"><div class="top"><div><div class="brand">${WHO} · staff</div><h1>${totp ? "Second step" : "Set up two-factor"}</h1></div></div>${html}<p class="foot"><button class="linkbtn" id="signout">Sign out</button></p></div>`; wireOut(root); };
    if (totp) {
      wrap(`<form class="card" id="mf"><p>Hi ${esc(person.name.split(" ")[0])}. Open your authenticator app and type the 6-digit code for ${WHO}.</p>
        <label class="f">Code<input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" autofocus></label><button class="btn" type="submit">Continue</button></form>`);
      $("#mf", root).onsubmit = async e => { e.preventDefault(); try { const ch = await sb.auth.mfa.challenge({ factorId: totp.id }); if (ch.error) throw ch.error; const v = await sb.auth.mfa.verify({ factorId: totp.id, challengeId: ch.data.id, code: $("#code", root).value.trim() }); if (v.error) throw v.error; resolve(); } catch (err) { toast("That code didn't work.", "err"); } };
    } else {
      // a half-finished setup from an earlier visit blocks a new one ("factor already exists"), so clear it first
      Promise.all((f?.all || []).filter(x => x.factor_type === "totp" && x.status !== "verified").map(x => sb.auth.mfa.unenroll({ factorId: x.id })))
      .then(() => sb.auth.mfa.enroll({ factorType: "totp", friendlyName: WHO + " staff" })).then(({ data, error }) => {
        if (error) { wrap(`<div class="card hot"><p>${esc(error.message)}</p></div>`); return; }
        wrap(`<form class="card" id="mf"><p>Staff accounts need a second step. Install <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> on your phone, scan this code, then type the 6 digits it shows.</p>
          <div class="center" style="background:#fff;border-radius:12px;padding:10px">${data.totp.qr_code.startsWith("<svg") ? data.totp.qr_code : `<img src="${esc(data.totp.qr_code)}" alt="QR code" style="width:220px;height:220px">`}</div>
          <details><summary>Can't scan? Type this key instead</summary><pre class="msg">${esc(data.totp.secret)}</pre></details>
          <label class="f">6-digit code from the app<input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"></label><button class="btn" type="submit">Turn on and continue</button></form>`);
        $("#mf", root).onsubmit = async e => { e.preventDefault(); try { const ch = await sb.auth.mfa.challenge({ factorId: data.id }); if (ch.error) throw ch.error; const v = await sb.auth.mfa.verify({ factorId: data.id, challengeId: ch.data.id, code: $("#code", root).value.trim() }); if (v.error) throw v.error; toast("Two-factor is on", "ok"); resolve(); } catch (err) { toast("That code didn't work. Try the next one the app shows.", "err"); } };
      });
    }
  });
}
