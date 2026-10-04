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
 *   · al salir de la cuenta (mensaje `purgar`, AUR14) borra todo lo que pudiera ser de ella y deja solo el
 *     shell público de esta versión;
 *   · avisos con la app cerrada (Web Push; en iPhone, solo la AU-RA instalada): el contenido llega cifrado
 *     para este navegador (lib/push-web.ts) y se enseña SOLO si es de la cuenta que está en este navegador
 *     (src/10-infra/avisosWeb.ts deja su seudónimo en el caché «aura-cuenta»); si no, un aviso genérico sin
 *     texto. Al tocarlo se abre AU-RA (o se enfoca la que ya estaba abierta).
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

/**
 * PURGA POR LOGOUT (AUR14): al salir de la cuenta la página manda `purgar`. Se borra todo caché de AU-RA
 * que pudiera tener algo de la cuenta: el seudónimo de los avisos (`aura-cuenta`), cualquier `aura-*` que
 * no sea el shell de ESTA versión, y del shell todo lo que no sea el shell (lo guardado de paso). Lo que
 * queda es el shell público del build, con clave por versión. Lo que no es de AU-RA no se toca.
 */
function purgarCuenta() {
  return caches.keys().then((nombres) =>
    Promise.all(
      nombres.map((n) => {
        if (n === CACHE)
          return caches.open(CACHE).then((c) =>
            c.keys().then((reqs) => Promise.all(reqs.filter((r) => PRECACHE.indexOf(new URL(r.url).pathname) < 0).map((r) => c.delete(r))))
          );
        if (n.indexOf('aura-') === 0) return caches.delete(n);
        return null;
      })
    )
  );
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'activar') self.skipWaiting();
  else if (e.data && e.data.tipo === 'purgar') {
    const hecho = purgarCuenta()
      .then(
        () => true,
        () => false
      )
      .then((ok) => {
        try {
          if (e.ports && e.ports[0]) e.ports[0].postMessage({ purgado: ok });
        } catch (err) {
          /* la página ya no escucha */
        }
      });
    if (e.waitUntil) e.waitUntil(hecho);
  }
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

/* ── avisos con la app cerrada ────────────────────────────────────────────────────────────── */

/** De quién es este navegador ('' = nadie). Lo deja la página al entrar (src/10-infra/avisosWeb.ts). */
function cuentaDeEsteNavegador() {
  return caches
    .open('aura-cuenta')
    .then((c) => c.match('/__aura_para'))
    .then((r) => (r ? r.text() : ''))
    .catch(() => '');
}

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (err) {
    d = {};
  }
  e.waitUntil(
    cuentaDeEsteNavegador().then((para) => {
      // Siempre se enseña algo (iOS retira el permiso a quien recibe avisos sin enseñarlos), pero el texto
      // solo si el aviso es de la cuenta que está aquí.
      const suyo = !!para && d.para === para;
      const titulo = suyo ? String(d.titulo || 'AURA').slice(0, 80) : 'AURA';
      const cuerpo = suyo ? String(d.texto || '').slice(0, 400) : 'Tienes algo nuevo en AU-RA.';
      return self.registration.showNotification(titulo, {
        body: cuerpo,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: suyo && d.id ? String(d.id) : 'aura',
        renotify: d.tipo === 'llamada',
        requireInteraction: d.tipo === 'llamada',
        data: { abrir: suyo ? String(d.abrir || 'mesa') : 'mesa' },
      });
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const abrir = (e.notification.data && e.notification.data.abrir) || 'mesa';
  const destino = abrir === 'mesa' ? '/' : '/?abrir=' + encodeURIComponent(abrir);
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if (new URL(v.url).origin === self.location.origin && 'focus' in v) {
          // Ya abierta: se le dice a qué pantalla ir (src/10-infra/abrirDesdeAviso.ts) en vez de navegarla,
          // que recargaría la app y cortaría una conversación en vivo.
          if ('postMessage' in v) v.postMessage({ tipo: 'aura-abrir', abrir });
          return v.focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
