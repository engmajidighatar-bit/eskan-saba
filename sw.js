/* sw.js v23 — اعلان در نوار اعلان گوشی (Web Push) + بازشدن فوری برنامه */
const V = 'v23';

self.addEventListener('install', function (e) { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    try { const ks = await caches.keys(); await Promise.all(ks.filter(function (k) { return k !== 'note-' + V; }).map(function (k) { return caches.delete(k); })); } catch (x) {}
    await self.clients.claim();
  })());
});

/* صفحه‌ی اصلی: فوری از کش نشان داده می‌شود و هم‌زمان در پس‌زمینه تازه می‌شود (نسخه‌ی جدید در بار بعد) */
self.addEventListener('fetch', function (e) {
  const r = e.request;
  if (r.method !== 'GET' || r.mode !== 'navigate') return;
  e.respondWith((async function () {
    const c = await caches.open('note-' + V);
    const cached = await c.match(r, { ignoreSearch: true });
    const net = fetch(r).then(function (res) {
      if (res && res.ok) { try { c.put(r, res.clone()); } catch (x) {} }
      return res;
    }).catch(function () { return null; });
    if (cached) { e.waitUntil(net); return cached; }
    const res = await net;
    return res || Response.error();
  })());
});

self.addEventListener('push', function (e) {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { try { d = { body: e.data.text() }; } catch (y) {} }
  e.waitUntil(self.registration.showNotification(d.title || 'Note', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    dir: 'rtl',
    lang: 'fa',
    vibrate: [200, 100, 200],
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async function () {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
