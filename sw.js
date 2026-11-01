/* Note — service worker
   - HTML: network first (new deploys show up right away), cache as offline fallback
   - Static files + CDN libs: stale-while-revalidate
   - intro.mp4: cached, served with Range support (Safari needs it)
   - Push + notification click
   Bump VERSION when you add/rename precached files. */
const VERSION = 'note-v21';
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'intro.mp4'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NET_TIMEOUT = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) =>
      Promise.allSettled(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' }))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
}

async function rangeResponse(req, res) {
  const h = req.headers.get('range');
  const m = h && /bytes=(\d+)-(\d*)/.exec(h);
  if (!m || !res || !res.ok) return res;
  const buf = await res.arrayBuffer();
  const s = Number(m[1]);
  const e = m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
  if (s >= buf.byteLength) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + buf.byteLength } });
  }
  return new Response(buf.slice(s, e + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': 'bytes ' + s + '-' + e + '/' + buf.byteLength,
      'Content-Length': String(e - s + 1),
    },
  });
}

async function video(req) {
  const cache = await caches.open(VERSION);
  const key = new URL(req.url).pathname;
  let res = await cache.match(key, { ignoreSearch: true });
  if (!res) {
    res = await fetch(req.url);
    if (res.ok) cache.put(key, res.clone());
  }
  return rangeResponse(req, res);
}

async function pageNetworkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([fetch(req), timeout(NET_TIMEOUT)]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    return (await cache.match(req, { ignoreSearch: true })) ||
      (await cache.match('index.html')) ||
      (await cache.match('./')) ||
      Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;

  if (same && /\.mp4$/i.test(url.pathname)) {
    e.respondWith(video(req));
    return;
  }
  if (req.headers.has('range')) return;

  if (same && (req.mode === 'navigate' || req.destination === 'document')) {
    e.respondWith(pageNetworkFirst(req));
    return;
  }
  if (same || CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req));
  }
  // everything else (Supabase API, storage, realtime) goes straight to the network
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    d = { body: e.data ? e.data.text() : '' };
  }
  const opts = {
    body: d.body || d.message || '',
    icon: d.icon || 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: d.url || './' },
  };
  if (d.tag) opts.tag = d.tag;
  e.waitUntil(self.registration.showNotification(d.title || 'Note', opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
