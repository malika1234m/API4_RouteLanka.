/*
 * RouteLanka service worker: lets the driver's run open with no signal.
 *
 * - App code and images (/_next/static, /brand, /icons, fonts): cache first. They are versioned by name.
 * - Pages: network first, falling back to the last copy saved on the phone.
 * - /api: never cached here. The app keeps its last view of the day on the phone and queues field
 *   records in IndexedDB, so the data layer decides what works offline, not the cache.
 */
const CACHE = "routelanka-v1";
const PRECACHE = ["/driver", "/login", "/brand/routelanka-mark.png", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

const isStatic = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/") || /\.(woff2?|png|jpg|svg|ico)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/driver"))),
    );
  }
});
