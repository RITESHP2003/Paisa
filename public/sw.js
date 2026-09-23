const CACHE_NAME = "paisa-v3";
const SHELL = [
  "./",
  "index.html",
  "styles.css?v=3",
  "app.js?v=3",
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

// Force update message from app.js
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (e.data === "GET_VERSION") {
    e.source.postMessage({ type: "VERSION", version: CACHE_NAME });
  }
});
