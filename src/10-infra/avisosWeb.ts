/**
 * AVISOS CON AU-RA CERRADA, DESDE LA WEB (auditoría del 3-oct, IOS02). En iPhone solo existen para la AU-RA
 * instalada en Inicio (iOS 16.4+), y el permiso solo se puede pedir con un toque de la persona: por eso hay
 * un aviso «¿Te aviso aunque AU-RA esté cerrada? · Activar», nunca una ventana sola.
 *
 *  · Suscribirse: permiso → pushManager.subscribe con la llave VAPID del servidor (GET /api/push/web/clave)
 *    → POST /api/push/web/suscribir con la sesión. El servidor la guarda por el correo de la SESIÓN.
 *  · De quién es este navegador: se le deja al service worker el seudónimo de la cuenta (el mismo que
 *    calcula el servidor, lib/push.ts `seudonimoDe`) en su Cache Storage. Si llega un aviso de otra cuenta
 *    (navegador compartido), el worker no enseña su texto.
 *  · Al salir de la cuenta: se da de baja la suscripción del navegador. El servicio de avisos responde 410
 *    al siguiente envío y el servidor la borra sola; así nadie recibe en este aparato lo de la cuenta anterior.
 */
import { enIconoInstalado, esIosWebKit, headersMesa } from './sesionCliente';

const CACHE_CUENTA = 'aura-cuenta';
const LLAVE_PARA = '/__aura_para';
const CLAVE_LUEGO = 'aura_avisos_luego';
const LUEGO_MS = 7 * 86_400_000;

/** ¿Este navegador puede recibir avisos con la app cerrada? En iPhone, solo el icono instalado. */
export function avisosSoportados(): boolean {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !window.isSecureContext) return false;
    return esIosWebKit() ? enIconoInstalado() : true;
  } catch {
    return false;
  }
}

/** ¿Se le ofrece activar? Soportado, sin decidir todavía y sin «luego» reciente. */
export function ofrecerAvisos(ahora = Date.now()): boolean {
  if (!avisosSoportados() || Notification.permission !== 'default') return false;
  try {
    const luego = Number(localStorage.getItem(CLAVE_LUEGO) || 0);
    return !luego || ahora - luego > LUEGO_MS;
  } catch {
    return true;
  }
}

export function avisosLuego() {
  try {
    localStorage.setItem(CLAVE_LUEGO, String(Date.now()));
  } catch {
    /* sin almacenamiento: se volverá a ofrecer */
  }
}

/** El seudónimo de la cuenta, idéntico al del servidor: `u` + 16 hex de sha256("aura-dueno:<correo>"). */
export async function seudonimoDe(correo: string): Promise<string> {
  const n = String(correo || '').trim().toLowerCase();
  if (!n) return '';
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`aura-dueno:${n}`)));
  return `u${Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * De quién es el navegador AHORA (correo en minúsculas; '' = nadie). Lo fija `cuentaDeAvisos` en cuanto cambia la cuenta,
 * antes de cualquier espera: un alta de avisos que siga en vuelo de la cuenta anterior lo mira al volver y no deja el
 * navegador apuntando a quien ya salió (revisión independiente del 4-oct).
 */
let cuentaVigente = '';
const normal = (c: string | null | undefined) => String(c || '').trim().toLowerCase();

/** Le dice al service worker de quién es este navegador ('' = nadie: no enseña el texto de ningún aviso). */
async function fijarPara(para: string) {
  try {
    const c = await caches.open(CACHE_CUENTA);
    if (para) await c.put(LLAVE_PARA, new Response(para, { headers: { 'Content-Type': 'text/plain' } }));
    else await c.delete(LLAVE_PARA);
  } catch {
    /* sin Cache Storage: el worker enseña el aviso genérico */
  }
}

function deB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/**
 * Lo pide la persona con un toque: permiso, suscripción y alta en el servidor. Devuelve qué pasó, para
 * decirlo tal cual (nunca «listo» si no quedó guardado).
 */
export async function activarAvisos(correo: string): Promise<'activados' | 'denegado' | 'sin-servidor' | 'error'> {
  try {
    if (!avisosSoportados()) return 'error';
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') return 'denegado';
    const r = await fetch('/api/push/web/clave', { cache: 'no-store' });
    const publica = r.ok ? ((await r.json())?.publica as string | null) : null;
    if (!publica) return 'sin-servidor';
    const reg = await navigator.serviceWorker.ready;
    let sus = await reg.pushManager.getSubscription();
    if (!sus) sus = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: deB64url(publica) as BufferSource });
    const alta = await fetch('/api/push/web/suscribir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headersMesa() },
      body: JSON.stringify({ suscripcion: sus.toJSON() }),
    });
    if (!alta.ok) return alta.status === 503 ? 'sin-servidor' : 'error';
    // Mientras se pedía el permiso o el alta, la cuenta cambió: este navegador no queda apuntando a la anterior.
    if (normal(correo) !== cuentaVigente) {
      await cuentaDeAvisos(cuentaVigente || null);
      return 'error';
    }
    await fijarPara(await seudonimoDe(correo));
    return 'activados';
  } catch {
    return 'error';
  }
}

/** Entró una cuenta (o se recuperó la sesión): el worker sabe de quién es este navegador. */
export async function cuentaDeAvisos(correo: string | null) {
  cuentaVigente = normal(correo);
  if (!avisosSoportados()) return;
  if (correo) {
    // Si esta cuenta ya tenía el permiso dado, la suscripción del navegador se vuelve a apuntar a ella.
    if (Notification.permission === 'granted') void activarAvisos(correo);
    else await fijarPara(await seudonimoDe(correo));
    return;
  }
  // Salió: nada de lo que llegue para la cuenta anterior se enseña, y la suscripción se da de baja.
  await fijarPara('');
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sus = await reg?.pushManager.getSubscription();
    await sus?.unsubscribe();
  } catch {
    /* ya no estaba */
  }
}
