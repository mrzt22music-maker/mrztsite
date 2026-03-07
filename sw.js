// Grammy — Service Worker for Push Notifications
// Place this file at the ROOT of your GitHub Pages repo (same level as index.html)

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Handle push events (from Firebase Cloud Messaging, if configured)
self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Grammy', body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(data.title || 'Grammy', {
      body: data.body || 'Новое сообщение',
      icon: data.icon || '/favicon.ico',
      badge: '/favicon.ico',
      tag: data.tag || 'grammy-msg',
      renotify: true,
      data: { url: data.url || self.location.origin },
    })
  );
});

// Click on notification → open/focus the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || self.location.origin;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.startsWith(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
