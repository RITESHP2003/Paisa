const CACHE_NAME = "paisa-v12";
const SHELL = [
  "./",
  "index.html",
  "styles.css?v=12",
  "app.js?v=12",
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

// Force activate when the app sends SKIP_WAITING
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});
