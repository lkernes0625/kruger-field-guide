/* ============================================================
   Kruger Field Guide — Service Worker
   Stage 1: app shell offline
   ------------------------------------------------------------
   Design notes, read before changing anything:

   * Navigation is CACHE FIRST, not network first. In Kruger the
     phone often has one bar rather than no bars, and a network
     first strategy would sit waiting on a request that never
     completes. Cache first means the app always opens instantly,
     signal or not. Freshness is handled by revalidating in the
     background and by index.html's own version check.

   * Live data (Firebase, RSS, weather, version.json, audio) is
     NEVER cached and never intercepted. Stale sightings or a
     stale gate time would be worse than no data, and the app
     already has its own offline fallbacks for these.

   * Only GET is ever cached. POST and PUT pass straight through.

   * Cross origin responses (Firebase images, CDN, fonts) come
     back opaque. We cannot read their status, so we only store
     them when the fetch itself did not throw.
   ============================================================ */

var SHELL_CACHE = 'kfg-shell-v1';
var IMG_CACHE   = 'kfg-img-v1';
var TILE_CACHE  = 'kfg-tiles-v1';
var CURRENT     = [SHELL_CACHE, IMG_CACHE, TILE_CACHE];

// Runtime cache caps — stop a long trip filling the device.
var IMG_MAX  = 600;
var TILE_MAX = 800;

// The minimum set needed for the app to open and run with no signal.
var SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  // Brand logos live on Firebase Storage and are referenced by applyLogos().
  // Pre-cached here so the header and About screen are not blank offline.
  'https://firebasestorage.googleapis.com/v0/b/kruger-feed.firebasestorage.app/o/images%2Flogos%2Fkrantz-outdoors-homescreen.webp?alt=media',
  'https://firebasestorage.googleapis.com/v0/b/kruger-feed.firebasestorage.app/o/images%2Flogos%2Fkrantz-outdoors-favicon-trans.png?alt=media',
  'https://firebasestorage.googleapis.com/v0/b/kruger-feed.firebasestorage.app/o/images%2Flogos%2Fkrantz-outdoors-header-trans.png?alt=media',
  'https://firebasestorage.googleapis.com/v0/b/kruger-feed.firebasestorage.app/o/images%2Flogos%2Fkrantz-outdoors-main-app-trans.png?alt=media&token=91b71f50-05e9-4bca-9fea-84a490dd83ed',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js'
];

// Hosts whose responses must always come from the network.
var LIVE_HOSTS = [
  'kruger-feed-default-rtdb',        // Firebase Realtime Database
  'firebaseio.com',
  'api.rss2json.com',
  'kruger-feed-function.vercel.app',
  'kruger-bird-audio.lkernes.workers.dev',
  'xeno-canto.org',
  'api.open-meteo.com',
  'open-meteo.com'
];

function isLive(url) {
  // version.json must always be fresh or the update prompt breaks.
  if (url.pathname.indexOf('version.json') >= 0) return true;
  for (var i = 0; i < LIVE_HOSTS.length; i++) {
    if (url.hostname.indexOf(LIVE_HOSTS[i]) >= 0 || url.href.indexOf(LIVE_HOSTS[i]) >= 0) return true;
  }
  // Firebase Realtime Database reads are .json on the database hosts only.
  // Deliberately narrow: firebasestorage.googleapis.com also contains
  // "firebase" and must stay cacheable.
  if ((url.hostname.indexOf('firebasedatabase.app') >= 0 ||
       url.hostname.indexOf('firebaseio.com') >= 0) &&
      url.pathname.indexOf('.json') >= 0) return true;
  return false;
}

function isImage(url) {
  return url.hostname.indexOf('firebasestorage.googleapis.com') >= 0;
}

function isTile(url) {
  return url.hostname.indexOf('tile.openstreetmap.org') >= 0;
}

function isStatic(url) {
  return url.hostname.indexOf('cdn.jsdelivr.net') >= 0 ||
         url.hostname.indexOf('fonts.googleapis.com') >= 0 ||
         url.hostname.indexOf('fonts.gstatic.com') >= 0;
}

// Keep a runtime cache under its cap, oldest entries first.
function trim(cacheName, max) {
  return caches.open(cacheName).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= max) return;
      return Promise.all(keys.slice(0, keys.length - max).map(function (k) {
        return cache.delete(k);
      }));
    });
  });
}

// ── Install: pre-cache the shell ────────────────────────────
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll is all-or-nothing; add individually so one CDN hiccup
      // does not abort the whole install.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (e) {
          console.warn('[sw] shell miss:', url, e);
        });
      }));
    })
    // No skipWaiting here. A new worker waits until the app tells it to
    // take over, so we never swap the shell out from under a live session.
  );
});

// ── Activate: drop old caches, take control ─────────────────
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (CURRENT.indexOf(n) < 0) return caches.delete(n);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ── Messages from the page ──────────────────────────────────
self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CACHE_STATUS') {
    Promise.all([
      caches.open(SHELL_CACHE).then(function (c) { return c.keys(); }),
      caches.open(IMG_CACHE).then(function (c) { return c.keys(); }),
      caches.open(TILE_CACHE).then(function (c) { return c.keys(); })
    ]).then(function (r) {
      if (event.source) {
        event.source.postMessage({
          type: 'CACHE_STATUS',
          shell: r[0].length, images: r[1].length, tiles: r[2].length
        });
      }
    });
  }
});

// ── Fetch ───────────────────────────────────────────────────
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Live data: do not touch it at all.
  if (isLive(url)) return;

  // ── Navigation: cache first, revalidate in the background ──
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(SHELL_CACHE).then(function (cache) {
        return cache.match('/index.html').then(function (cached) {
          var network = fetch(req).then(function (res) {
            if (res && res.ok) cache.put('/index.html', res.clone());
            return res;
          }).catch(function () { return null; });

          // Cached copy wins immediately; the network copy refreshes
          // the cache for next launch.
          if (cached) { event.waitUntil(network); return cached; }

          return network.then(function (res) {
            return res || new Response(
              '<!doctype html><meta charset="utf-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<style>body{background:#15191c;color:#a8b4bc;font-family:system-ui,sans-serif;' +
              'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;' +
              'text-align:center;padding:24px}b{color:#e8a020;display:block;margin-bottom:8px;' +
              'font-size:16px}</style><div><b>Kruger Field Guide</b>' +
              'The app has not finished installing for offline use.<br>' +
              'Connect to the internet once and reopen.</div>',
              { headers: { 'Content-Type': 'text/html' } }
            );
          });
        });
      })
    );
    return;
  }

  // ── Species photos: cache first, capped ────────────────────
  if (isImage(url)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            // Opaque responses have status 0; store them anyway, that is
            // the only way cross origin images can be cached.
            if (res) {
              cache.put(req, res.clone());
              event.waitUntil(trim(IMG_CACHE, IMG_MAX));
            }
            return res;
          }).catch(function () {
            return new Response('', { status: 504, statusText: 'offline' });
          });
        });
      })
    );
    return;
  }

  // ── Map tiles: cache what was legitimately viewed, capped ──
  // This is not bulk downloading; it only keeps tiles already fetched
  // for the user. A proper offline tile pack comes in stage 4.
  if (isTile(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res) {
              cache.put(req, res.clone());
              event.waitUntil(trim(TILE_CACHE, TILE_MAX));
            }
            return res;
          }).catch(function () {
            return new Response('', { status: 504, statusText: 'offline' });
          });
        });
      })
    );
    return;
  }

  // ── Shell assets and CDN: cache first ──────────────────────
  if (url.origin === self.location.origin || isStatic(url)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) {
            // Refresh quietly for next time.
            event.waitUntil(
              fetch(req).then(function (res) {
                if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
              }).catch(function () {})
            );
            return hit;
          }
          return fetch(req).then(function (res) {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(function () {
            return new Response('', { status: 504, statusText: 'offline' });
          });
        });
      })
    );
    return;
  }

  // Everything else: straight to the network.
});
