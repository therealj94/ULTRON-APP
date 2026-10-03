/**
 * LA PWA DE AU-RA EN EL NAVEGADOR (auditoría del 3-oct, IOS02): registrar el service worker del build
 * (scripts/pwa/sw-plantilla.js), avisar cuando hay una versión nueva y aplicarla SOLO cuando la persona toca
 * «Recargar» (nunca en medio de una llamada, de entrar o de un envío: lo decide ella).
 *
 * Interruptor: GET /api/pwa → `{ sw: false }` (AURA_SW=0 en el servidor) da de baja el worker y borra sus
 * cachés en el próximo arranque; `?sinsw` en la dirección hace lo mismo a mano (para un tester atascado).
 * Solo en producción, con https y fuera de la WebView de la app (la sala tiene su propia página).
 */
const PREFIJO_CACHE = 'aura-shell-';
const CADA_MS = 30 * 60_000;

let registro: ServiceWorkerRegistration | null = null;
/** Solo se recarga al cambiar de worker si lo pidió la persona (el primer worker también «cambia»). */
let pedidoPorLaPersona = false;

/** Da de baja el service worker de AU-RA y borra sus cachés. Nunca lanza. */
export async function apagarPwa(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  } catch {
    /* sin service worker */
  }
  try {
    const nombres = (await caches?.keys?.()) || [];
    await Promise.all(nombres.filter((n) => n.startsWith(PREFIJO_CACHE)).map((n) => caches.delete(n)));
  } catch {
    /* sin Cache Storage */
  }
}

/** ¿Lo dice el servidor? `true`/`false`, o null si no contestó (sin red: no se cambia nada). */
async function interruptor(): Promise<boolean | null> {
  try {
    const r = await fetch('/api/pwa', { cache: 'no-store' });
    if (r.status === 404) return true;
    if (!r.ok) return null;
    const d = await r.json();
    return d?.sw !== false;
  } catch {
    return null;
  }
}

/**
 * Registra el service worker y llama a `alHayVersionNueva` cuando una versión nueva quedó instalada
 * esperando. Nunca lanza.
 */
export async function registrarPwa(alHayVersionNueva: () => void): Promise<void> {
  try {
    if (!import.meta.env?.PROD) return;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    if (new URLSearchParams(window.location.search).has('sinsw')) return void (await apagarPwa());
    const encendido = await interruptor();
    if (encendido === false) return void (await apagarPwa());
    if (encendido === null && !navigator.serviceWorker.controller) return;
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    registro = reg;
    const avisarSiEspera = () => {
      if (reg.waiting && navigator.serviceWorker.controller) alHayVersionNueva();
    };
    avisarSiEspera();
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo?.addEventListener('statechange', () => {
        if (nuevo.state === 'installed') avisarSiEspera();
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (pedidoPorLaPersona) window.location.reload();
    });
    // La web puede pasar días abierta: se pregunta por una versión nueva cada rato y al volver a ella.
    const buscar = () => void reg.update().catch(() => undefined);
    setInterval(buscar, CADA_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') buscar();
    });
  } catch {
    /* sin service worker, la web funciona igual */
  }
}

/** «Recargar»: la versión que espera toma el control y la página se recarga una vez. */
export function aplicarVersionNueva() {
  const esperando = registro?.waiting;
  if (!esperando) return window.location.reload();
  pedidoPorLaPersona = true;
  esperando.postMessage({ tipo: 'activar' });
}
