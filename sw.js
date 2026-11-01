// TTM service worker: shows lock-screen alerts for Pro spot moves.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch (x) { d = {title: 'TTM', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'TTM', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || 'ttm', data: {url: d.url || './crypto/index.html'}
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const u = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  if (new URL(u).origin !== new URL(self.registration.scope).origin) { e.waitUntil(clients.openWindow(u)); return; }
  e.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(l => {
    for (const c of l) if ('focus' in c) return c.focus();
    return clients.openWindow(u);
  }));
});
