'use strict';
const SHELL = 'daymark-v3-1';
const SHARES = 'daymark-share-inbox';
const shellFiles = ['/', '/index.html', '/style.css?v=3', '/model.js?v=3', '/app.js?v=3', '/device.js?v=3.1', '/reminder-config.js', '/manifest.webmanifest', '/assets/daymark.svg', '/assets/icon-192.png', '/assets/icon-512.png', '/assets/geist.woff2', '/assets/instrument-serif-italic.woff2', '/assets/notices.jpg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(shellFiles)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('daymark-v') && key !== SHELL).map(key => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

async function receiveShare(request) {
  const form = await request.formData();
  const parts = [...form.getAll('files')].filter(file => file instanceof File);
  if (parts.length > 1 || parts.some(file => file.size > 15 * 1024 * 1024)) {
    return Response.redirect(new URL('/?share-error=size', self.location.origin), 303);
  }
  const content = {
    text: [form.get('title'), form.get('text'), form.get('url')].filter(value => typeof value === 'string').join('\n').slice(0, 30000),
    name: parts[0]?.name || 'Shared message',
  };
  const id = crypto.randomUUID();
  const cache = await caches.open(SHARES);
  const stored = new FormData();
  stored.set('text', content.text);
  stored.set('name', content.name);
  if (parts[0]) stored.set('file', parts[0]);
  await cache.put(new Request(new URL('/shared/' + id, self.location.origin)), new Response(stored));
  for (const old of await cache.keys()) {
    if (!old.url.endsWith(id)) await cache.delete(old);
  }
  return Response.redirect(new URL('/?share=' + id, self.location.origin), 303);
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (url.pathname.startsWith('/shared/') && event.request.method === 'GET') {
    event.respondWith(caches.open(SHARES).then(async cache => {
      const response = await cache.match(event.request);
      if (response) { await cache.delete(event.request); return response; }
      return new Response('Shared item is no longer available.', { status: 404 });
    }));
    return;
  }
  if (event.request.method !== 'GET') return;
  // Keep API calls out of the offline cache.
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
    return;
  }
  if (!shellFiles.includes(url.pathname + url.search)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Show a generic reminder for malformed content. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'Daymark reminder', {
    body: payload.body || 'Open your action plan to check what is due.',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag: payload.tag || 'daymark-reminder',
    data: { actionId: payload.actionId || '' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.actionId || '';
  const url = new URL('/?action=' + encodeURIComponent(id), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (client) { await client.navigate(url); return client.focus(); }
    return self.clients.openWindow(url);
  }));
});
