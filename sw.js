/* Note — service worker
   - HTML: network first (new deploys show up right away), cache as offline fallback
   - Static files + CDN libs: stale-while-revalidate
   - intro.mp4: cached + kept in memory, served with fast Range support (Safari needs it)
   - Push + notification click
   Bump VERSION when you add/rename precached files. */
const VERSION = 'note-v22';
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

/* intro.mp4: one in-memory Blob per worker run, Range answered by zero-copy Blob slices */
const vids = new Map();

function loadVideo(path, url) {
  return (async () => {
    const cache = await caches.open(VERSION);
    let res = await cache.match(path, { ignoreSearch: true });
    if (!res) {
      res = await fetch(url);
      if (res.ok) cache.put(path, res.clone());
    }
    if (!res || !res.ok) throw new Error('video');
    const type = res.headers.get('Content-Type') || 'video/mp4';
    return { blob: new Blob([await res.arrayBuffer()], { type }), type };
  })();
}

function serveVideo(req, v) {
  const size = v.blob.size;
  const base = { 'Content-Type': v.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const h = req.headers.get('range');
  const m = h && /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(v.blob, { status: 200, headers: Object.assign({ 'Content-Length': String(size) }, base) });
  }
  let s, e;
  if (m[1] === '') {
    s = Math.max(0, size - Number(m[2]));
    e = size - 1;
  } else {
    s = Number(m[1]);
    e = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (s >= size || s > e) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  return new Response(v.blob.slice(s, e + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: Object.assign({ 'Content-Range': 'bytes ' + s + '-' + e + '/' + size, 'Content-Length': String(e - s + 1) }, base),
  });
}

async function video(req) {
  const path = new URL(req.url).pathname;
  let p = vids.get(path);
  if (!p) {
    p = loadVideo(path, req.url);
    vids.set(path, p);
    p.catch(() => vids.delete(path));
  }
  try {
    return serveVideo(req, await p);
  } catch (_) {
    return fetch(req);
  }
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
