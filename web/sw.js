// Taieri Post service worker: push notifications + offline shell
// Offline shell: every app file that loads is also kept on the phone. With a connection the phone always gets the newest file from the server;
// with no connection it uses the copy it kept, so the app still opens.
const CACHE = "tp-shell-v1";
const SHELL = ["/", "/app.js", "/shared/core.js", "/shared/auth.js", "/shared/config.js", "/shared/demo.js", "/shared/demo-config.js", "/shared/score.js", "/shared/style.css", "/shared/driver.css",
  "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-180.png", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u))))); });
self.addEventListener("activate", e => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE && k.startsWith("tp-shell-")) await caches.delete(k); await clients.claim(); })()));
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  let u; try { u = new URL(r.url); } catch { return; }
  if (u.origin !== location.origin && u.hostname !== "cdn.jsdelivr.net") return;   // the database, sign-in and photos always go straight to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try { const res = await fetch(r); if (res && res.ok && (res.type === "basic" || res.type === "cors")) cache.put(r, res.clone()).catch(() => { }); return res; }
    catch (err) { const hit = await cache.match(r, { ignoreSearch: r.mode === "navigate" }) || (r.mode === "navigate" && u.pathname === "/" ? await cache.match("/") : null); if (hit) return hit; throw err; }
  })());
});
self.addEventListener("push", e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: "Taieri Post", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Taieri Post", { body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || "/" }, vibrate: d.urgent ? [400, 150, 400, 150, 400] : [100, 50, 100], requireInteraction: !!d.urgent, silent: false }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => { for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } } return clients.openWindow(url); }));
});
