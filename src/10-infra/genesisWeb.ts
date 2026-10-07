/**
 * ENTRAR CON GENESIS ID DESDE LA WEB (Safari, el icono del iPhone, escritorio; auditoría del 3-oct, IOS01).
 *
 * Como la app (mobile/src/lib/genesis.ts): AU-RA no ve nunca la contraseña de la wallet; le pide un PASE de
 * Genesis ID con un `estado` (state) y la huella de un verificador (`reto`, como PKCE). Lo distinto es la
 * vuelta: la wallet solo acepta volver a `https://aura-fp.onrender.com/sso`, y en el iPhone esa vuelta puede
 * abrirse en Safari aunque la entrada empezara en el icono (otro almacén). Por eso:
 *
 *   1. `iniciarEntradaGenesis` registra el intento en el servidor (estado + reto), guarda estado y
 *      verificador AQUÍ (localStorage de este contexto) y va a la web de la wallet.
 *   2. La wallet vuelve a /sso: el servidor deposita el pase atado al intento (server/sso-web.ts).
 *   3. `retomarEntradaGenesis` (al volver a la pestaña o al icono) lo recoge con el verificador: un canje,
 *      con plazo. Nunca hay un token de sesión en una URL.
 */

const CAJON = 'aura.genesis.web';
/** La vuelta que acepta la wallet (la misma exacta que usa la app Android). */
export const VUELTA_WEB = 'https://aura-fp.onrender.com/sso';
/** Lo que vive el intento (lo mismo que el servidor y que la wallet guardan el pedido). */
export const VIDA_PEDIDO_MS = 30 * 60_000;

export type PedidoWeb = { verificador: string; estado: string; en: number };
export type Recogida =
  | { tipo: 'nada' }
  | { tipo: 'pendiente' }
  | { tipo: 'listo'; token: string; miembro: { nombre?: string; correo?: string; rol?: string } }
  | { tipo: 'error'; codigo: string; mensaje: string };

/** base64url sin relleno. */
export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Un pedido nuevo: verificador (32 bytes), su huella SHA-256 y un estado (18 bytes), todo base64url. */
export async function nuevoPedido(): Promise<{ verificador: string; reto: string; estado: string }> {
  const verificador = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const huella = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador));
  return { verificador, reto: b64url(new Uint8Array(huella)), estado: b64url(crypto.getRandomValues(new Uint8Array(18))) };
}

/** La dirección de la web de la wallet con el pedido (la misma forma que usa la app: `…#sso-aura?…`). */
export function urlWallet(walletWeb: string, reto: string, estado: string): string {
  return `${walletWeb}?reto=${encodeURIComponent(reto)}&estado=${encodeURIComponent(estado)}&vuelta=${encodeURIComponent(VUELTA_WEB)}`;
}

function leerPedido(ahora = Date.now()): PedidoWeb | null {
  try {
    const p = JSON.parse(localStorage.getItem(CAJON) || 'null') as PedidoWeb | null;
    if (!p || typeof p.verificador !== 'string' || typeof p.estado !== 'string' || !p.en) return null;
    if (ahora - p.en > VIDA_PEDIDO_MS) {
      localStorage.removeItem(CAJON);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

function olvidarPedido() {
  try {
    localStorage.removeItem(CAJON);
  } catch {
    /* sin almacenamiento */
  }
}

/** ¿Hay una entrada con Genesis a medias en este navegador (o en este icono)? */
export function hayEntradaPendiente(): boolean {
  return !!leerPedido();
}

/**
 * Empieza la entrada: registra el intento, guarda el verificador aquí y devuelve a dónde ir (la web de la
 * wallet). Quien llama navega (`location.assign`): así el icono instalado no abre otra pestaña.
 */
export async function iniciarEntradaGenesis(f: typeof fetch = fetch): Promise<{ ok: true; ir: string } | { ok: false; mensaje: string }> {
  try {
    const c = await f('/api/genesis/config').then((r) => (r.ok ? r.json() : null));
    if (!c?.disponible || typeof c.walletWeb !== 'string' || !/^https:\/\//.test(c.walletWeb)) return { ok: false, mensaje: 'La entrada con Genesis ID no está disponible ahora.' };
    const p = await nuevoPedido();
    const r = await f('/api/genesis/web/intento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: p.estado, reto: p.reto }) });
    if (!r.ok) return { ok: false, mensaje: 'No pude empezar la entrada con Genesis ID. Prueba otra vez.' };
    localStorage.setItem(CAJON, JSON.stringify({ verificador: p.verificador, estado: p.estado, en: Date.now() } satisfies PedidoWeb));
    return { ok: true, ir: urlWallet(c.walletWeb, p.reto, p.estado) };
  } catch {
    return { ok: false, mensaje: 'No alcancé el servidor para entrar con Genesis ID.' };
  }
}

/** Lo que la wallet manda en `error=` → la frase para la persona. */
function mensajeWallet(codigo: string): string {
  switch (codigo) {
    case 'cancelado':
      return 'Cancelaste la entrada con Genesis ID.';
    case 'sin-gid':
      return 'Tu wallet todavía no tiene un Genesis ID. Créalo y vuelve a entrar.';
    case 'gid-pendiente':
      return 'Tu Genesis ID está en verificación; cuando lo aprueben, entras con este mismo botón.';
    default:
      return 'Tu wallet no completó la entrada. Prueba otra vez.';
  }
}

/**
 * Recoge la vuelta, si ya llegó. `nada`: no hay entrada a medias. `pendiente`: la wallet todavía no volvió
 * (se vuelve a preguntar). `listo`: la sesión (quien llama la guarda). `error`: se dice y se olvida el pedido.
 */
export async function retomarEntradaGenesis(f: typeof fetch = fetch): Promise<Recogida> {
  const p = leerPedido();
  if (!p) return { tipo: 'nada' };
  let r: Response;
  try {
    r = await f('/api/genesis/web/recoger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: p.estado, verificador: p.verificador }) });
  } catch {
    return { tipo: 'pendiente' };
  }
  if (r.status === 202) return { tipo: 'pendiente' };
  // 429 (preguntó muy seguido) o un 5xx: sigue a medias, se vuelve a preguntar.
  if (r.status === 429 || r.status >= 500) return { tipo: 'pendiente' };
  const d = await r.json().catch(() => ({}) as any);
  olvidarPedido();
  if (r.ok && d?.ok && typeof d.token === 'string' && d.token) return { tipo: 'listo', token: d.token, miembro: d.miembro || {} };
  const codigo = String(d?.codigo || 'ERROR');
  return { tipo: 'error', codigo, mensaje: r.status === 400 && d?.estado === 'error' ? mensajeWallet(codigo) : String(d?.error || 'No se pudo entrar con Genesis ID.') };
}

/**
 * Mientras haya una entrada a medias: pregunta al volver a la pestaña o al icono, y cada `cadaMs` con la
 * página visible. Devuelve cómo dejar de escuchar.
 */
export function escucharVueltaGenesis(alTerminar: (r: Exclude<Recogida, { tipo: 'nada' } | { tipo: 'pendiente' }>) => void, cadaMs = 3000): () => void {
  let vivo = true;
  let enCurso = false;
  const mirar = async () => {
    if (!vivo || enCurso || !hayEntradaPendiente()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    enCurso = true;
    try {
      const r = await retomarEntradaGenesis();
      if (vivo && (r.tipo === 'listo' || r.tipo === 'error')) alTerminar(r);
    } finally {
      enCurso = false;
    }
  };
  const alVolver = () => void mirar();
  document.addEventListener('visibilitychange', alVolver);
  window.addEventListener('focus', alVolver);
  const reloj = setInterval(alVolver, cadaMs);
  void mirar();
  return () => {
    vivo = false;
    clearInterval(reloj);
    document.removeEventListener('visibilitychange', alVolver);
    window.removeEventListener('focus', alVolver);
  };
}
