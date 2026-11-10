const VERSION = 'bookvoice-v1';
const APP_FILES = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.svg'];
const DEPENDENCY_HOST = 'cdnjs.cloudflare.com';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))), self.clients.claim()]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && url.host !== DEPENDENCY_HOST) return;
  event.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone()).catch(() => {});
      return response;
    } catch (err) {
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      throw err;
    }
  }));
});
