// Service worker: lets the installed app open even when Wi-Fi drops
// (showing the last version of the page; sun, moon and panchang still work).
// Network first, so updates appear straight away. Never stores calendar or
// weather data, or anything to do with signing in.

const CACHE = 'whatsup-shell-v3';
const SHELL = [
  '/styles.css', '/js/app.js', '/js/sky.js', '/vendor/suncalc.js', '/vendor/astronomy.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon-32.png', '/img/moon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const NEVER_CACHE = /^\/(api|login|logout|auth)(\/|$)/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || NEVER_CACHE.test(url.pathname)) return;

  const isPage = req.mode === 'navigate';
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      // Keep a copy of the dashboard page only when it really is the dashboard
      // (signed in), and of the static files.
      if (res.ok && (!isPage || res.headers.get('X-Whatsup-Page') === 'dashboard')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(isPage ? '/' : req, copy));
      }
      return res;
    } catch (e) {
      const cached = await caches.match(isPage ? '/' : req);
      if (cached) return cached;
      throw e;
    }
  })());
});
