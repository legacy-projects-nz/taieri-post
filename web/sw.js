// Taieri Post service worker: push notifications + offline shell
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(clients.claim()));
self.addEventListener("push", e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: "Taieri Post", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Taieri Post", { body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || "/" }, vibrate: [100, 50, 100] }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => { for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } } return clients.openWindow(url); }));
});
