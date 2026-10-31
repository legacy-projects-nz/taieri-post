// Routes tab: the saved GPS trail of every route, per driver, per day.
// Points are recorded by the driver app between SOD and EOD (about every 2 minutes) and kept in the `locations` table.
import { sb, nzNow, today, addDays, label, fmtT, fmtTs, nzToIso, esc, $, $$, first } from "/shared/core.js";
import { S, nm } from "/admin/admin.js";

const COLORS = ["#62c7e3", "#f0b04a", "#52cc8d", "#ff6178", "#b48cff", "#ffd166", "#4dd0c8", "#ff9f6b", "#8fd36a", "#e07bd0"];
const st = { day: null, driver: "", cache: {}, hidden: new Set(), map: null };
const dayOf = () => st.day || (st.day = today());

function km(a, b) { const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const dist = pts => pts.reduce((s, p, i) => s + (i && (p.accuracy == null || p.accuracy < 200) ? km(pts[i - 1], p) : 0), 0);
const hhmm = iso => { const n = nzNow(new Date(iso)); return fmtT(n.min); };

async function fetchDay(day) {
  if (st.cache[day]) return st.cache[day];
  const from = nzToIso(day, "00:00"), to = nzToIso(addDays(day, 1), "00:00"); const rows = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from("locations").select("*").gte("at", from).lt("at", to).order("at", { ascending: true }).range(off, off + 999);
    if (error) throw error; rows.push(...data); if (data.length < 1000) break;
  }
  const { data: shifts } = await sb.from("shifts").select("id,run,driver,day,start_at,end_at,van").eq("day", day);
  const by = {}; for (const l of rows) { const k = l.driver + "|" + (l.shift_id || "none"); (by[k] ??= []).push(l); }
  const routes = Object.entries(by).map(([k, pts], i) => { const sh = (shifts || []).find(s => s.id === pts[0].shift_id); return { key: k, driver: pts[0].driver, shift: sh || null, pts, km: dist(pts) }; })
    .sort((a, b) => nm(a.driver).localeCompare(nm(b.driver)) || a.pts[0].at.localeCompare(b.pts[0].at));
  return (st.cache[day] = routes);
}

export function routesTab() {
  const day = dayOf();
  return `<div class="card"><div class="row" style="align-items:flex-end">
    <button class="btn ghost sm" id="rt-prev" style="flex:0">‹</button>
    <label class="f" style="flex:1 1 150px">Day<input class="in" type="date" id="rt-day" value="${day}"></label>
    <button class="btn ghost sm" id="rt-next" style="flex:0">›</button>
    <button class="btn ghost sm" id="rt-today" style="flex:0">Today</button>
    <label class="f" style="flex:1 1 170px">Driver<select class="in" id="rt-driver"><option value="">All drivers</option>${S.drivers.map(d => `<option value="${d.id}" ${st.driver === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label></div>
    <p class="hint" style="margin:0">${label(day, true)} · each route is the saved GPS trail from start of day to end of day. Trails are kept, nothing is deleted.</p></div>
    <div class="card" style="padding:8px"><div id="rt-map" class="map" style="height:460px"></div></div>
    <div class="card"><h2>Routes<span id="rt-count"></span></h2><div id="rt-list" class="list"><div class="empty">Loading…</div></div></div>`;
}

function paint(routes) {
  const list = routes.filter(r => !st.driver || r.driver === st.driver);
  $("#rt-count").textContent = list.length ? `${list.length} route${list.length === 1 ? "" : "s"}` : "";
  $("#rt-list").innerHTML = list.length ? list.map((r, i) => { const c = COLORS[routes.indexOf(r) % COLORS.length]; const a = r.pts[0], z = r.pts[r.pts.length - 1]; const sh = r.shift;
    return `<label class="item" style="border-left:6px solid ${c};cursor:pointer"><div class="row" style="justify-content:space-between;align-items:center"><div><b>${esc(nm(r.driver))}</b> · ${sh ? esc(sh.run) : "no shift linked"}${sh?.van ? ` · ${esc(sh.van)}` : ""}</div><span class="chk ${st.hidden.has(r.key) ? "" : "on"}" style="min-height:36px"><input type="checkbox" data-rt-show="${esc(r.key)}" ${st.hidden.has(r.key) ? "" : "checked"}> Show</span></div>
      <div class="meta">${hhmm(a.at)} to ${hhmm(z.at)} · ${r.pts.length} points · ${r.km.toFixed(1)} km${sh ? ` · rostered ${fmtT(Number(sh.start_at?.slice(0, 2)) * 60 + Number(sh.start_at?.slice(3, 5)))}` : ""}</div></label>`; }).join("")
    : `<div class="empty">No saved routes for ${label(dayOf())}${st.driver ? " for " + esc(nm(st.driver)) : ""}.<br><span class="hint">Routes appear once a driver posts their start of day with the app open and location allowed.</span></div>`;
  $$("[data-rt-show]").forEach(b => b.onchange = () => { b.checked ? st.hidden.delete(b.dataset.rtShow) : st.hidden.add(b.dataset.rtShow); paint(routes); });
  draw(routes, list);
}

function draw(all, list) {
  const el = $("#rt-map"); if (!el || !window.L) return;
  if (st.map) { st.map.remove(); st.map = null; }
  const map = st.map = L.map(el).setView([-45.88, 170.4], 10);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19, className: "osm-dark" }).addTo(map);
  const bounds = [];
  for (const r of list) { if (st.hidden.has(r.key)) continue; const c = COLORS[all.indexOf(r) % COLORS.length]; const ll = r.pts.map(p => [p.lat, p.lng]); bounds.push(...ll);
    L.polyline(ll, { color: c, weight: 4, opacity: .9 }).addTo(map).bindPopup(`<b>${esc(nm(r.driver))}</b> ${r.shift ? esc(r.shift.run) : ""}<br>${hhmm(r.pts[0].at)} to ${hhmm(r.pts[r.pts.length - 1].at)} · ${r.km.toFixed(1)} km`);
    for (const p of r.pts) L.circleMarker([p.lat, p.lng], { radius: 3, color: c, fillColor: c, fillOpacity: 1, weight: 1 }).addTo(map).bindPopup(`<b>${esc(nm(r.driver))}</b><br>${esc(fmtTs(p.at))}${p.speed ? `<br>${Math.round(p.speed * 3.6)} km/h` : ""}`);
    const mk = (p, t) => L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: `<div class="mk" style="background:${c}">${esc(first(nm(r.driver)))} ${t}</div>`, iconAnchor: [20, 12] }) }).addTo(map);
    mk(r.pts[0], "start " + hhmm(r.pts[0].at)); if (r.pts.length > 1) mk(r.pts[r.pts.length - 1], "end " + hhmm(r.pts[r.pts.length - 1].at)); }
  if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 15 });
}

async function load() {
  const day = dayOf(); try { const routes = await fetchDay(day); if (day === dayOf()) paint(routes); } catch (e) { const l = $("#rt-list"); if (l) l.innerHTML = `<div class="empty">Couldn't load routes: ${esc(e.message || e)}</div>`; }
}
export function wireRoutes() {
  const go = d => { st.day = d; st.hidden = new Set(); const i = $("#rt-day"); if (i) i.value = d; $("#rt-list").innerHTML = '<div class="empty">Loading…</div>'; load(); };
  $("#rt-day").onchange = e => e.target.value && go(e.target.value);
  $("#rt-prev").onclick = () => go(addDays(dayOf(), -1)); $("#rt-next").onclick = () => go(addDays(dayOf(), 1)); $("#rt-today").onclick = () => go(today());
  $("#rt-driver").onchange = e => { st.driver = e.target.value; load(); };
  delete st.cache[today()]; load();   // today's trail is still growing, so always reload it
}
