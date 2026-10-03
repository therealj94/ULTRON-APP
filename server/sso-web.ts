/**
 * LA VUELTA DE LA WALLET PARA LA WEB (Safari, el icono del iPhone, escritorio; auditoría del 3-oct, IOS01).
 *
 * El /sso de server/enlaces-app.ts solo sabía devolver el pase a la app Android (`intent://`). La web no
 * puede recibir el pase así, y en el iPhone la vuelta puede abrirse en Safari aunque la entrada empezara
 * en el icono instalado (otro almacén). Por eso el pase se queda en el SERVIDOR un rato, atado al intento:
 *
 *   1. La web inventa un `estado` (state) y un verificador; manda el estado y la huella del verificador
 *      (`reto`, como PKCE) a `POST /api/genesis/web/intento`. El verificador nunca sale del navegador.
 *   2. La wallet vuelve a `/sso?pase=…&estado=…` (la vuelta que acepta, sin cambios). Si el estado es de un
 *      intento web, se DEPOSITA aquí; la página no lo muestra y ofrece volver a AURA (sin nada en la URL).
 *   3. La web lo recoge con `POST /api/genesis/web/recoger {estado, verificador}`: si la huella coincide, se
 *      canjea UNA vez con Genesis (que también comprueba el verificador). Otro verificador no lo gasta.
 *
 * Todo vence: el intento en VIDA_INTENTO_MS (lo que la wallet guarda el pedido) y un pase depositado en
 * VIDA_VUELTA_MS. Vive en memoria (un proceso): un reinicio en medio solo obliga a entrar de nuevo.
 */
import { createHash } from 'node:crypto';

/** Lo que vive un intento sin vuelta: lo mismo que la wallet guarda el pedido (media hora). */
export const VIDA_INTENTO_MS = 30 * 60_000;
/** Lo que espera un pase depositado a que la web lo recoja. */
export const VIDA_VUELTA_MS = 10 * 60_000;
const MAX_INTENTOS = 5000;
/** El estado de la web: base64url de al menos 16 bytes al azar (≥ 128 bits). */
const ESTADO_WEB = /^[A-Za-z0-9_-]{22,128}$/;
const RETO = /^[A-Za-z0-9_-]{43}$/;

type Intento = { reto: string; creado: number; vuelta?: { pase?: string; error?: string; en: number } };
const intentos = new Map<string, Intento>();

/** La huella del verificador, como la calcula el teléfono: SHA-256 del texto, en base64url. */
export function retoDe(verificador: string): string {
  return createHash('sha256').update(String(verificador || ''), 'utf8').digest('base64url');
}

function vencido(i: Intento, ahora: number): boolean {
  return ahora - i.creado > VIDA_INTENTO_MS || (!!i.vuelta && ahora - i.vuelta.en > VIDA_VUELTA_MS);
}

function purgar(ahora: number) {
  for (const [k, i] of intentos) if (vencido(i, ahora)) intentos.delete(k);
}

/** Registra el intento de la web. false si la forma no vale, ya existía o no cabe uno más. */
export function registrarIntentoWeb(estado: string, reto: string, ahora = Date.now()): boolean {
  if (!ESTADO_WEB.test(String(estado || '')) || !RETO.test(String(reto || ''))) return false;
  purgar(ahora);
  if (intentos.has(estado) || intentos.size >= MAX_INTENTOS) return false;
  intentos.set(estado, { reto, creado: ahora });
  return true;
}

/** ¿Este estado es de un intento web vivo? (Si no, /sso sigue con la vuelta de Android.) */
export function esIntentoWeb(estado: string | undefined, ahora = Date.now()): boolean {
  const i = estado ? intentos.get(estado) : undefined;
  if (!i) return false;
  if (vencido(i, ahora)) {
    intentos.delete(estado!);
    return false;
  }
  return true;
}

/** Guarda la vuelta de la wallet para su intento. La primera gana; sin intento vivo no se guarda nada. */
export function depositarVuelta(v: { estado?: string; pase?: string; error?: string }, ahora = Date.now()): boolean {
  if (!v.estado || !esIntentoWeb(v.estado, ahora)) return false;
  const i = intentos.get(v.estado)!;
  if (i.vuelta) return false;
  i.vuelta = { ...(v.pase ? { pase: v.pase } : {}), ...(v.error ? { error: v.error } : {}), en: ahora };
  return true;
}

export type Recogida = { estado: 'listo'; pase: string } | { estado: 'error'; error: string } | { estado: 'pendiente' } | { estado: 'desconocido' } | { estado: 'reto' };

/**
 * La web recoge su vuelta. `reto`: el verificador no es el del intento (no se gasta nada). `pendiente`: la
 * wallet todavía no volvió. `desconocido`: no hay intento (nunca hubo, venció o ya se recogió).
 */
export function recogerVuelta(estado: string, verificador: string, ahora = Date.now()): Recogida {
  if (!estado || !esIntentoWeb(estado, ahora)) return { estado: 'desconocido' };
  const i = intentos.get(estado)!;
  if (retoDe(verificador) !== i.reto) return { estado: 'reto' };
  if (!i.vuelta) return { estado: 'pendiente' };
  intentos.delete(estado);
  return i.vuelta.pase ? { estado: 'listo', pase: i.vuelta.pase } : { estado: 'error', error: i.vuelta.error || 'desconocido' };
}

/** Solo pruebas. */
export function _olvidarIntentosWeb() {
  intentos.clear();
}
