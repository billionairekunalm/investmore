// Class reminders (Firebase Cloud Messaging web push).
// Our own push handler: every reminder is ALWAYS shown as a phone/computer notification — app open, closed
// or phone locked. (No Firebase script here; the page only uses Firebase to get this device's push token.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { notification: { body: e.data ? e.data.text() : '' } }; }
  const n = p.notification || {}, d = p.data || {};
  const link = (p.fcmOptions && p.fcmOptions.link) || d.link || n.click_action || '/';
  e.waitUntil(self.registration.showNotification(n.title || d.title || 'InvestMore class reminder', {
    body: n.body || d.body || '',
    icon: n.icon || '/icon-512.png',
    badge: '/icon-192.png',
    tag: n.tag || p.fcmMessageId || String(Date.now()),
    renotify: true,
    vibrate: [200, 100, 200],
    data: { link },
  }));
});

// Tap: open (or focus) the app on that class.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.link) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : w));
    return self.clients.openWindow(url);
  }));
});
