/* Prospection Toiture : fonctionnement hors ligne.
   - l'appli elle-même : réseau d'abord (pour recevoir les mises à jour), sinon la copie gardée
   - les bibliothèques et polices : copie gardée, rafraîchie en arrière-plan
   - les fonds de carte : copie gardée en priorité (le secteur reste visible sans réseau)
   - adresses, bâtiments et sauvegarde en ligne : toujours le réseau
   Changer VERSION à chaque mise en ligne : l'appli propose alors « Mettre à jour ». */
const VERSION = '2026-10-22.1';
const SHELL = 'shell-' + VERSION;
const TILES = 'tiles-v1';
const MAX_TILES = 4000;
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      Promise.all(SHELL_FILES.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip') self.skipWaiting();
  if (event.data === 'version' && event.source) event.source.postMessage({ version: VERSION });
});

function isTile(url) {
  return (url.hostname === 'data.geopf.fr' && url.pathname.startsWith('/wmts')) || url.hostname === 'tile.openstreetmap.org';
}
function isStatic(url) {
  return ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
}

let tilePuts = 0;
async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) {
    await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
  }
}

async function tileFirst(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(request, res.clone());
      if (++tilePuts % 100 === 0) trimTiles();
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Hors ligne' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  const net = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await net) || new Response('', { status: 504 });
}

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('lent')), 5000))
    ]);
    if (res && res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch (e) {
    return (await cache.match('./index.html')) || (await cache.match('./')) || new Response('Hors ligne', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' || (url.origin === self.location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')))) {
    event.respondWith(networkFirstPage(request));
  } else if (isTile(url)) {
    event.respondWith(tileFirst(request));
  } else if (isStatic(url) || (url.origin === self.location.origin && /\.(webmanifest|svg)$/.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
