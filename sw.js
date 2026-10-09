const CACHE = "hb-v17";
const SHARED = ["cdn.jsdelivr.net"];
const FONTS = ["./fonts/bricolage.woff", "./fonts/atkinson-regular.woff", "./fonts/atkinson-bold.woff", "./fonts/atkinson-italic.woff"];
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "./manifest.webmanifest", "./icon-192.png"].concat(FONTS))).catch(() => {}));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (SHARED.includes(u.hostname)) {
    // libraries and fonts: answer from the cache at once, refresh it in the background
    e.respondWith(caches.open(CACHE).then(c => c.match(r).then(hit => {
      const net = fetch(r).then(res => { if (res && (res.ok || res.type === "opaque")) c.put(r, res.clone()).catch(() => {}); return res; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  if (u.origin !== location.origin) return;
  // fonts never change: answer from the cache
  if (u.pathname.includes("/fonts/")) {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {}); } return res; })));
    return;
  }
  // the app itself: always try the network first so updates arrive, fall back to the cache offline
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(r).then(m => m || caches.match("./")))
  );
});

// reminders
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Hushållsbalans", {
    body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: d.tag || undefined, data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
