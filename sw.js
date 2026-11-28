/* CRM do Cooperado: service worker (abre sem internet e guarda as fotos no aparelho) */
const VERSAO = 'crm-v6-4';
const BASE = ['./', './index.html', './shim.js', './config.js', './manifest.webmanifest', './vendor/supabase.js', './vendor/jspdf.umd.min.js', './icons/icon-192.png', './icons/icon-512.png'];
const FOTOS = 'crm-fotos', FONTES = 'crm-fontes', AUTH = 'crm-auth';

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSAO).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (![VERSAO, FOTOS, FONTES, AUTH].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

/* sessão para baixar fotos privadas do Supabase */
let auth = null; let espera = [];
self.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (d.tipo === 'auth' && d.token) {
    auth = d; espera.forEach((r) => r(auth)); espera = [];
    caches.open(AUTH).then((c) => c.put('auth', new Response(JSON.stringify(d))));
  }
});
async function pegarAuth() {
  if (auth) return auth;
  try { const r = await (await caches.open(AUTH)).match('auth'); if (r) { auth = await r.json(); } } catch (e) {}
  const cs = await self.clients.matchAll(); cs.forEach((c) => c.postMessage({ tipo: 'pedeToken' }));
  if (auth) return auth;
  return new Promise((ok) => { espera.push(ok); setTimeout(() => ok(auth), 6000); });
}
async function foto(req, id) {
  const cache = await caches.open(FOTOS);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const a = await pegarAuth();
    if (!a) break;
    try {
      const r = await fetch(`${a.url}/storage/v1/object/authenticated/fotos/${a.uid}/${id}`, { headers: { Authorization: 'Bearer ' + a.token, apikey: a.key } });
      if (r.ok) { await cache.put(req.url, r.clone()); return r; }
      if ((r.status === 400 || r.status === 401 || r.status === 403) && tentativa === 0) { auth = null; await caches.delete(AUTH); continue; }
      return new Response('', { status: r.status });
    } catch (e) { return new Response('', { status: 504 }); }
  }
  return new Response('', { status: 401 });
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const escopo = new URL(self.registration.scope);
  if (u.origin === escopo.origin) {
    const m = u.pathname.match(/\/_blob\/([\w-]+)$/);
    if (m) { ev.respondWith(foto(req, m[1])); return; }
    if (req.mode === 'navigate') {
      ev.respondWith((async () => {
        try {
          const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
          const r = await fetch(req, { signal: ctl.signal }); clearTimeout(t);
          if (r.ok) (await caches.open(VERSAO)).put('./index.html', r.clone());
          return r;
        } catch (e) {
          return (await caches.match('./index.html')) || (await caches.match('./')) || new Response('Sem internet e sem cópia do app neste aparelho.', { status: 503 });
        }
      })());
      return;
    }
    if (/\/(config|shim|sw)\.js$/.test(u.pathname)) {
      ev.respondWith((async () => {
        const c = await caches.open(VERSAO);
        try { const r = await fetch(req, { cache: 'no-store' }); if (r.ok) c.put(req, r.clone()); return r; }
        catch (e) { return (await c.match(req, { ignoreSearch: true })) || new Response('', { status: 504 }); }
      })());
      return;
    }
    if (u.pathname.startsWith(escopo.pathname)) {
      ev.respondWith((async () => {
        const c = await caches.open(VERSAO); const hit = await c.match(req, { ignoreSearch: true });
        const rede = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
        return hit || (await rede) || new Response('', { status: 504 });
      })());
    }
    return;
  }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    ev.respondWith((async () => {
      const c = await caches.open(FONTES); const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; } catch (e) { return new Response('', { status: 504 }); }
    })());
  }
});
