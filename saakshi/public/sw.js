'use strict';
// App shell for the installed app: network first, cached copy when the network is weak or gone.
// Data (api/, photo/, feed) is never cached here: it always comes fresh from the server.
const CACHE = 'saakshi-shell-v1';
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'vendor/qrcode.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (/^(api\/|photo\/|feed)/.test(rel)) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
