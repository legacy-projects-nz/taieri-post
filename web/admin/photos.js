// Photo storage (owner, on ☰ Records): shrinks photos that went up full size before uploads were shrunk on the phone.
// Runs in this browser: downloads each big photo, shrinks it (≤1600px JPEG) and puts it back in the same place.
// Photos older than 12 months are deleted automatically every night (edge function "cleanup").
import { sb, esc, $, toast, shrinkPhoto } from "/shared/core.js";
import { S } from "/admin/admin.js";

const BUCKETS = [["runsheets", "Run sheets & task photos"], ["vchk", "Vehicle checks"], ["errs", "Mistake photos"]];
const BIG = 6e5;   // anything over ~600 KB gets shrunk

export function photosCard() {
  if (!S.me.isOwner) return "";
  return `<div class="card" id="photos"><h2>Photo storage<span>kept 12 months</span></h2>
    <p class="hint">New photos are shrunk on the phone before upload. This shrinks the older full-size ones (about 2–3 MB each down to about 300 KB). Keep this page open while it runs.</p>
    <div class="row" style="gap:6px;align-items:center"><button class="btn sm" id="ph-go">Shrink old photos</button><span class="meta" id="ph-st"></span></div></div>`;
}

async function listAll(bucket, prefix = "", out = []) {
  const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000 }); if (error) throw error;
  for (const f of data || []) { const p = prefix ? `${prefix}/${f.name}` : f.name; if (f.id === null || !f.metadata) await listAll(bucket, p, out); else out.push({ path: p, size: f.metadata.size || 0 }); }
  return out;
}

export function wirePhotos() {
  $("#ph-go")?.addEventListener("click", async e => {
    const b = e.target, st = $("#ph-st"); b.disabled = true; let done = 0, saved = 0, failed = 0;
    try {
      for (const [bucket, name] of BUCKETS) {
        st.textContent = `Looking through ${name.toLowerCase()}…`;
        const big = (await listAll(bucket)).filter(f => f.size > BIG);
        for (const f of big) {
          st.textContent = `${name}: ${done + 1} of ${big.length} · ${(saved / 1048576).toFixed(0)} MB saved so far`;
          try {
            const { data: blob, error } = await sb.storage.from(bucket).download(f.path); if (error) throw error;
            const small = await shrinkPhoto(new File([blob], "p.jpg", { type: blob.type || "image/jpeg" }));
            if (small.size < f.size * 0.8) { const { error: e2 } = await sb.storage.from(bucket).upload(f.path, small, { upsert: true, contentType: "image/jpeg" }); if (e2) throw e2; saved += f.size - small.size; }
          } catch (err) { failed++; console.warn("shrink", f.path, err); }
          done++;
        }
        done = 0;
      }
      st.textContent = `Done · ${(saved / 1048576).toFixed(0)} MB saved${failed ? ` · ${failed} couldn't be shrunk` : ""}`; toast("Photos shrunk", "ok");
    } catch (err) { st.textContent = ""; toast(esc(err.message || err), "err"); }
    b.disabled = false;
  });
}
