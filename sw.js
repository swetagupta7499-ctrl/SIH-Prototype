/* ===========================================================================
   TribalScholar service worker — basic offline support

   Strategy:
   • Precache the local app shell (HTML/CSS/JS) on install.
   • Navigations: network-first, falling back to the cached index.html so the
     app opens offline.
   • Same-origin static assets: stale-while-revalidate (fast, self-healing).
   • Cross-origin requests (Supabase, Google, CDNs) are NOT cached or
     intercepted — they pass straight through to the network.

   Bump CACHE_VERSION to invalidate old caches on the next deploy.
   =========================================================================== */
const CACHE_VERSION = "tribalscholar-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./features.css",
  "./script.js",
  "./manifest.webmanifest",
  "./js/data-service.js",
  "./js/ocr-preprocess.js",
  "./js/gov-integrations.js",
  "./js/assistant-i18n.js",
  "./js/ai-assistant.js",
  "./js/aadhaar-qr.js",
  "./js/kb/en.js",
  "./js/kb/hi.js",
  "./js/kb/bn.js",
  "./js/kb/mr.js",
  "./js/kb/te.js",
  "./js/kb/ta.js",
  "./js/kb/gu.js",
  "./js/kb/ur.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin requests; let cross-origin (Supabase, Google,
  // CDNs) go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first with index.html fallback for offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static same-origin assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
