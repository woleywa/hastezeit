// Service worker: makes the app installable and gives an offline fallback for the app shell.
// Strategy: network-first for everything (always fresh code + data), cache as fallback.
const CACHE = 'bock-v1';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/router.js',
  '/js/ui.js',
  '/js/store.js',
  '/js/share.js',
  '/js/components.js',
  '/js/views/feed.js',
  '/js/views/week.js',
  '/js/views/post.js',
  '/js/views/create.js',
  '/js/views/groups.js',
  '/js/views/profile.js',
  '/js/views/auth.js',
  '/js/views/notifications.js',
  '/shared/constants.js',
  '/shared/emoji.js',
  '/shared/format.js',
  '/shared/parse.js',
  '/shared/time.js',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && !url.pathname.startsWith('/e/') && !url.pathname.startsWith('/i/')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(request)) ?? (request.mode === 'navigate' ? caches.match('/index.html') : undefined)),
  );
});

// Prepared for Web Push (see server/notifications/channels.js)
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(data.title ?? 'Bock', { body: data.body, data: { url: data.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url ?? '/'));
});
