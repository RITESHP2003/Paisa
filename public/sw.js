const CACHE_NAME = "paisa-v8";
const SHELL = [
  "./",
  "index.html",
  "styles.css?v=8",
  "app.js?v=8",
  "manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: try server, fall back to cache for offline
self.addEventListener("fetch", (e) => {
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const c = r.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, c));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
