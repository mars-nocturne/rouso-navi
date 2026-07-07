/* 労組結成ナビ Service Worker — オフライン対応 */
const CACHE = 'union-app-v11';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './cloud.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* 事前キャッシュはHTTPキャッシュを迂回して必ずサーバーから取得する
   （更新時に古いファイルが新バージョンのキャッシュへ混入するのを防ぐ） */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* cache-first（静的アセット）。失敗時はネットワークへ。
   同一オリジンのみ対象。Supabase等のクロスオリジンAPI応答をキャッシュすると
   古いデータやエラーを返し続けてしまうため、外部通信には関与しない。 */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
