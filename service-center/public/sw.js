/* GEAR service worker: cache the app shell; API calls always go to the network */
const CACHE = 'gear-v4';
const SHELL = ['/', '/css/app.css', '/js/i18n.js', '/js/core.js', '/js/app.js', '/js/pages-front.js', '/js/pages-workshop.js',
  '/js/pages-finance.js', '/js/pages-store.js', '/js/pages-admin.js', '/js/pages-hr.js', '/js/fb-backend.js', '/js/payroll-calc.js', '/js/vendor/firebase.mjs', '/firebase-config.js', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname === '/firebase-config.js') return;
  // network first, fall back to cache (so updates show immediately when online)
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
