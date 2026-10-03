/*
 * EL SERVICE WORKER DE AU-RA (auditoría del 3-oct, IOS02). Mínimo y seguro, a propósito:
 *
 *   · guarda el SHELL de la web (la página, su JS y CSS del build, el manifest y los iconos) para que el
 *     icono instalado abra aunque la red tarde o falte; nada más;
 *   · la navegación va PRIMERO a la red (siempre lo último publicado); sin red, el shell guardado;
 *   · NUNCA toca /api, /sso (la vuelta de la wallet), /.well-known, el MCP, otros orígenes, lo que lleva la
 *     sesión (x-ultron-sesion, Authorization), la sala (la WebView de la app) ni la página de Dr Electrum;
 *     y no guarda respuestas no-store o privadas. No pone nada en cola para mandarlo «cuando vuelva la red»;
 *   · una versión nueva se instala y ESPERA: la web avisa «Hay una versión nueva · Recargar» y solo con ese
 *     toque (mensaje `activar`) toma el control. Al activarse borra los cachés viejos de AU-RA;
 *   · sin push: Web Push en iOS es otro trabajo (canal, consentimiento, baja por cuenta) y no se promete.
 *
 * El build (scripts/pwa/vite-sw.ts) rellena VERSION y PRECACHE; el interruptor está en GET /api/pwa (la web
 * lo mira al arrancar y, apagado, da de baja este worker y borra sus cachés). Lo prueba tests/pwa-sw.test.ts.
 */
const VERSION = '__AURA_VERSION__';
const PRECACHE = __AURA_PRECACHE__;
const PREFIJO = 'aura-shell-';
const CACHE = PREFIJO + VERSION;
/** Lo que nunca pasa por aquí: máquinas, la vuelta de la wallet, la sala de la app y la otra plataforma. */
const EXCLUIDAS = /^\/(api|sso|mcp|oauth|authorize|token|register|telegram|webhook|\.well-known)(\/|$)|^\/(sala|electrum)(\.html)?(\/|$)|^\/sw\.js$/i;

/** ¿Se puede guardar esta respuesta? Solo la propia, buena y sin no-store/privado. */
function cacheable(r) {
  if (!r || !r.ok || (r.type && r.type !== 'basic' && r.type !== 'default')) return false;
  return !/no-store|private/i.test(r.headers.get('Cache-Control') || '');
}

/** Qué hacer con una petición: 'red' (no se toca), 'navegacion' o 'asset'. */
function decidir(req, origen) {
  if (req.method !== 'GET') return 'red';
  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return 'red';
  }
  if (url.origin !== origen || EXCLUIDAS.test(url.pathname)) return 'red';
  if (req.headers.has('x-ultron-sesion') || req.headers.has('authorization')) return 'red';
  if (req.mode === 'navigate') return 'navegacion';
  if (PRECACHE.indexOf(url.pathname) >= 0 || /^\/assets\//.test(url.pathname)) return 'asset';
  return 'red';
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n.indexOf(PREFIJO) === 0 && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'activar') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const que = decidir(req, self.location.origin);
  if (que === 'red') return;
  if (que === 'navegacion') {
    e.respondWith(
      fetch(req).catch(() =>
        caches.match('/').then((r) => r || new Response('AU-RA necesita conexión para abrir.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
      )
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (guardada) =>
        guardada ||
        fetch(req).then((r) => {
          if (cacheable(r)) {
            const copia = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return r;
        })
    )
  );
});
