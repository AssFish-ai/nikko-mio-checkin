// sw.js — Service Worker for Nikko-Mio Check-in
const CACHE = 'nikko-mio-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

// ── INSTALL: cache core assets ────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: serve from cache, fall back to network ────────────────────────────
self.addEventListener('fetch', e => {
  // Only cache GET requests for our own origin
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || networkFetch;
    })
  );
});

// ── PUSH: receive push notification ──────────────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  const title = data.title || 'Nikko-Mio Check-in';
  const body  = data.body  || "Don't forget to log today! 💪";
  const icon  = data.icon  || '/icon-192.png';

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icon-192.png',
      tag: 'daily-checkin',        // replaces previous notification
      renotify: false,
      data: { url: '/' },
      actions: [
        { action: 'log', title: 'Log now' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // If app already open, focus it
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      // Otherwise open it
      return clients.openWindow('/');
    })
  );
});

// ── SCHEDULED CHECK: fire at 9pm if not logged ───────────────────────────────
// The app registers a daily alarm via the Periodic Background Sync API
// as a fallback. Primary scheduling is done via the app itself.
self.addEventListener('periodicsync', e => {
  if (e.tag === 'daily-reminder') {
    e.waitUntil(checkAndNotify());
  }
});

async function checkAndNotify() {
  // Ask all open clients if today is logged
  const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

  // Check localStorage via a client message
  for (const client of allClients) {
    const channel = new MessageChannel();
    client.postMessage({ type: 'CHECK_LOGGED' }, [channel.port2]);
    const logged = await new Promise(resolve => {
      channel.port1.onmessage = e => resolve(e.data.logged);
      setTimeout(() => resolve(false), 1000); // timeout fallback
    });
    if (logged) return; // already logged, no notification needed
  }

  // Not logged — show notification
  await self.registration.showNotification('Nikko-Mio Check-in', {
    body: "You haven't logged today yet! Takes 30 seconds. 💪",
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'daily-checkin',
    data: { url: '/' }
  });
}
