/* 現場写真記録 service worker
   目的: 通信がなくても、アプリを起動できるようにする。
   方針: 通信できるときは、必ず最新の版を取りに行く(古い版が残り続けないようにする)。
         通信できないとき、または応答が遅いときだけ、端末に保存した版を使う。 */

const VERSION = '2026.10.31-1';            // index.html の APP_VERSION と同じ値にしておく
const CACHE = 'genba-photo-' + VERSION;
const SCOPE = self.registration.scope;
const INDEX = new URL('./index.html', SCOPE).href;
const OPTIONAL = ['./manifest.json', './icon.jpeg'].map((p) => new URL(p, SCOPE).href);
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* アプリ本体は必須。取得できないときは、インストールを失敗させて、あとでやり直す */
    const res = await fetch(INDEX, { cache: 'reload' });
    if (!res.ok) throw new Error('index.html を取得できません');
    await cache.put(INDEX, res);
    /* アイコンなどは、無くてもアプリは動く */
    await Promise.all(OPTIONAL.map(async (url) => {
      try {
        const r = await fetch(url, { cache: 'reload' });
        if (r.ok) await cache.put(url, r);
      } catch (e) { /* 無視 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    /* 古い版の保存を消す */
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('genba-photo-') && k !== CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function keyFor(req) {
  if (req.mode === 'navigate') return INDEX;
  const u = new URL(req.url);
  u.search = '';
  u.hash = '';
  if (u.href === new URL('./', SCOPE).href) return INDEX;
  return u.href;
}

function fetchFresh(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  /* cache: 'no-cache' で、ブラウザ内の短期保存(GitHub Pagesは約10分)を飛ばして、常に最新かどうか確かめる */
  return fetch(url, { cache: 'no-cache', credentials: 'same-origin', signal: ctl.signal })
    .finally(() => clearTimeout(timer));
}

async function handle(req) {
  const cache = await caches.open(CACHE);
  const key = keyFor(req);
  try {
    const res = await fetchFresh(req.url, NETWORK_TIMEOUT_MS);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(key);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      return new Response(
        '通信がなく、このアプリはまだ端末に保存されていません。通信できる場所で、一度アプリを開いてください。',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* 外部(国土地理院、番号読取のプログラム)は、そのままブラウザに任せる */
  if (url.origin !== self.location.origin) return;
  /* service worker 自身は、常にブラウザが直接確認する */
  if (url.pathname.endsWith('/service-worker.js')) return;
  event.respondWith(handle(req));
});
