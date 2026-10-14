// Offline cache. Bump VERSION on every release so devices fetch new files.
const VERSION = 'v21';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/bee.js',
  'js/db.js',
  'js/seed.js',
  'js/learn.js',
  'js/util.js',
  'js/parents.js',
  'js/io.js',
  'js/srs.js',
  'js/profiles.js',
  'js/speech.js',
  'js/check.js',
  'js/child.js',
  'js/exams.js',
  'data/en.json',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first so updates arrive when online; cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    // no-cache: revalidate with the server so a new release shows up on the
    // next start instead of after GitHub's 10-minute cache expires.
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
