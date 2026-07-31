const CACHE = 'freebie-cell-v1';

const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/constants.js',
  './js/deal.js',
  './js/rules.js',
  './js/state.js',
  './js/solver.js',
  './js/storage.js',
  './js/auth.js',
  './js/render.js',
  './js/drag.js',
  './js/dialogs.js',
  './js/app.js',
  'https://cdn.jsdelivr.net/npm/interactjs@1.10.27/dist/interact.min.js',
];

// Card SVG assets — generated list for all 52 cards + back
const RANKS = ['a','2','3','4','5','6','7','8','9','10','j','q','k'];
const SUITS = ['c','d','h','s'];
for (const r of RANKS) {
  for (const s of SUITS) {
    PRECACHE.push(`./cards/${r}${s}.svg`);
  }
}
PRECACHE.push('./cards/back.svg');

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Pass through Firebase, Google, and other external auth/API calls
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('google') ||
      url.hostname.includes('gstatic')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
