// Geometry Pong service worker: a versioned precache, so a table of players
// keeps their match through a dropped connection and through a deploy.
//
// UPDATE MODEL ("opt-in", hub CLAUDE.md §3). Bump VERSION on every committed
// batch that deploys, and keep it HERE, as a literal in this file: the browser
// decides a worker has changed by comparing this script's bytes. The page
// registers with { updateViaCache: 'none' } and calls reg.update() at launch
// and whenever it comes back into view. The new worker precaches the whole
// list below and then WAITS: js/update.js shows the UPDATE READY button on the
// start screen, and only that tap posts SKIP_WAITING. There is deliberately no
// skipWaiting() in install — taking over unasked could reload a match away
// ("a deploy must never destroy a run in progress", hub §1).
//
// GET_VERSION lets the page print the build that is actually serving it.
//
// The cache name is prefixed with the slug and the cleanup filter only ever
// deletes keys that carry that prefix: every game in this hub shares one
// origin and therefore one CacheStorage.
//
// All paths are RELATIVE: the game is served from /<slug>/ and is also framed
// by the arcade from a sibling directory.

const VERSION = 'v1.1.0'; // power-ups: ten of them, pixel badges and explosions, the Kaos slider on the start screen
const PREFIX = 'geometry_pong-';
const CACHE = `${PREFIX}${VERSION}`;

// Every shipped file; a file missing here vanishes offline, a file listed but
// not deployed fails the install and leaves the player on the old version.
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/touch-guard.js',
  './js/update.js',
  './js/screen.js',
  './js/main.js',
  './js/sim.js',
  './js/render.js',
  './js/input.js',
  './js/ui.js',
  './js/audio.js',
  './js/i18n.js',
  './js/powerups/index.js',
  './js/powerups/slow.js',
  './js/powerups/split.js',
  './js/powerups/bigball.js',
  './js/powerups/rush.js',
  './js/powerups/gravity.js',
  './js/powerups/bumpers.js',
  './js/powerups/curve.js',
  './js/powerups/wide.js',
  './js/powerups/shrink.js',
  './js/powerups/shield.js',
  './audio/hit.m4a',
  './audio/wall.m4a',
  './audio/goal.m4a',
  './audio/win.m4a',
  './audio/music-match.m4a',
  './audio/power.m4a',
  './audio/powerend.m4a',
  './audio/shield.m4a',
  './audio/bump.m4a',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png',
];

// `cache: 'reload'` on everything the install stores. Without it the precache
// reads through the browser's HTTP cache, which may still hold yesterday's copy
// of a file, so a new version could be filed with some of the old files in it —
// on 2026-10-11 dam_break ran a new screens.js against a stale sound.js and the
// menu never wired up. The arcade learned this first (arcade/sw.js, `fresh`).
const fresh = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  // No skipWaiting() here: after precaching, the new worker stays WAITING until
  // the player accepts the update from the start screen.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map(fresh))));
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // The prefix only. Every other game keeps its caches on this same
        // origin and none of them are ours to delete.
        keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Cache-first out of the current versioned precache, so every module in one
  // session comes from ONE deploy: the sim, the renderer and the menus can
  // never be from different builds. New versions arrive as a whole new cache through
  // install/activate above, never file by file.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : undefined));
    })
  );
});
