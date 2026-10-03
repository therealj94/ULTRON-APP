/**
 * LA PWA DE AU-RA EN EL NAVEGADOR (auditoría del 3-oct, IOS02): registrar el service worker del build
 * (scripts/pwa/sw-plantilla.js), avisar cuando hay una versión nueva y aplicarla SOLO cuando la persona toca
 * «Recargar» (nunca en medio de una llamada, de entrar o de un envío: lo decide ella).
 *
 * Y aun con el toque, en un punto seguro (AUR14): si hay una llamada en vivo, una decisión abierta o el
 * control de su computadora (10-infra/trabajoActivo.ts), «Recargar» espera a que termine y entonces aplica.
 * `controllerchange` (el worker nuevo tomó el control, también por otra pestaña) solo recarga si la persona
 * lo pidió, y tampoco encima de algo en curso. Ningún otro camino recarga la página.
 *
 * Interruptor: GET /api/pwa → `{ sw: false }` (AURA_SW=0 en el servidor) da de baja el worker y borra sus
 * cachés en el próximo arranque; `?sinsw` en la dirección hace lo mismo a mano (para un tester atascado).
 * Solo en producción, con https y fuera de la WebView de la app (la sala tiene su propia página).
 */
import { alTerminarTrabajo, trabajoActivo } from './trabajoActivo';

const PREFIJO_CACHE = 'aura-shell-';
const CADA_MS = 30 * 60_000;
/** Mientras espera un punto seguro, vuelve a mirar cada tanto (además del aviso de quien termina). */
const MIRAR_LIBRE_MS = 2_000;

type WorkerEsperando = { postMessage: (m: unknown) => void };

/**
 * Aplicar la versión nueva en un punto seguro (puro: sin window ni navigator, se prueba con dobles).
 *  · `aplicar()`: con algo en curso, espera ('esperando'); sin nada, activa el worker que espera (o, si ya
 *    no hay ninguno esperando, recarga) ('recargando');
 *  · `alCambiarControlador()`: el worker nuevo tomó el control; solo recarga si lo pidió la persona y no
 *    hay nada en curso (si lo hay, al terminar). El primer worker y otra pestaña también lo disparan.
 */
export class AplicadorVersion {
  /** La persona tocó «Recargar» y el worker nuevo ya recibió `activar`: el próximo cambio de control recarga. */
  private pedido = false;
  /** «Recargar» llegó con algo en curso: se aplica al quedar libre. */
  private pendiente: 'activar' | 'recargar' | null = null;
  private recargada = false;
  private dejar: (() => void) | null = null;
  private reloj: unknown = null;

  constructor(
    private d: {
      esperando: () => WorkerEsperando | null;
      recargar: () => void;
      ocupado: () => string[];
      alLibre: (f: () => void) => () => void;
      intervalo?: (f: () => void, ms: number) => unknown;
      limpiar?: (id: unknown) => void;
    }
  ) {}

  aplicar(): 'recargando' | 'esperando' {
    if (this.d.ocupado().length) {
      this.esperarLibre('activar');
      return 'esperando';
    }
    this.activar();
    return 'recargando';
  }

  alCambiarControlador() {
    if (!this.pedido || this.recargada) return;
    if (this.d.ocupado().length) return this.esperarLibre('recargar');
    this.recargar();
  }

  private activar() {
    const w = this.d.esperando();
    if (!w) return this.recargar();
    this.pedido = true;
    w.postMessage({ tipo: 'activar' });
  }

  private recargar() {
    if (this.recargada) return;
    this.recargada = true;
    this.dejarDeEsperar();
    this.d.recargar();
  }

  private esperarLibre(que: 'activar' | 'recargar') {
    this.pendiente = que;
    if (this.dejar) return;
    const mirar = () => {
      if (!this.pendiente || this.d.ocupado().length) return;
      const p = this.pendiente;
      this.pendiente = null;
      this.dejarDeEsperar();
      if (p === 'activar') this.activar();
      else this.recargar();
    };
    this.dejar = this.d.alLibre(mirar);
    this.reloj = (this.d.intervalo || ((f, ms) => setInterval(f, ms)))(mirar, MIRAR_LIBRE_MS);
  }

  private dejarDeEsperar() {
    this.dejar?.();
    this.dejar = null;
    if (this.reloj !== null) (this.d.limpiar || ((id) => clearInterval(id as ReturnType<typeof setInterval>)))(this.reloj);
    this.reloj = null;
  }
}

let registro: ServiceWorkerRegistration | null = null;
const aplicador = new AplicadorVersion({
  esperando: () => registro?.waiting || null,
  recargar: () => window.location.reload(),
  ocupado: trabajoActivo,
  alLibre: alTerminarTrabajo,
});

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
    // Solo si lo pidió la persona (el primer worker y otra pestaña también «cambian») y en un punto seguro.
    navigator.serviceWorker.addEventListener('controllerchange', () => aplicador.alCambiarControlador());
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

/**
 * «Recargar»: la versión que espera toma el control y la página se recarga una vez, en un punto seguro.
 * 'esperando': hay una llamada, una decisión o el control de su computadora en curso; se aplica al terminar.
 */
export function aplicarVersionNueva(): 'recargando' | 'esperando' {
  return aplicador.aplicar();
}
