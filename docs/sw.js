// VM 2026 — service worker: instant loads + offline.
// Strategy: app shell is cache-first (with background refresh); the JSON data is
// network-first (always try fresh, fall back to cache offline); cross-origin team
// logos / fonts are cached on first use. Bump CACHE to ship a new shell.
const CACHE = "wc26-v14";
const SHELL = [
  ".",
  "index.html",
  "js/app.js",
  "js/americas.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Live weather: always fresh, fall back to cache offline (never serve stale forecast).
  if (url.hostname.endsWith("open-meteo.com")) {
    e.respondWith(fetch(req).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return res; }).catch(() => caches.match(req)));
    return;
  }
  // Fresh data first (scores/standings update every couple of hours), cache as fallback.
  if (sameOrigin && url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else: cache-first, refresh in the background (stale-while-revalidate).
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
