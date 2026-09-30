/**
 * La memoria larga de la mesa web, POR CUENTA.
 *
 * Antes había un solo cajón (`ultron_memoria_larga`) para todo el navegador: en una tableta compartida
 * los hechos de A viajaban en cada turno de B y el servidor los guardaba como de B. Ahora:
 *  · cada cuenta tiene su cajón (clave con una huella de su correo, no el correo);
 *  · el cajón solo vale mientras el token de la mesa sea el mismo con el que se fijó la cuenta: si el
 *    token cambió (salió, entró otra persona) y la pantalla todavía no avisó, se lee vacío;
 *  · el cajón viejo compartido NO se le pasa a nadie: no se sabe de quién es cada hecho. Se descarta
 *    en este navegador (lo que ya había llegado al servidor sigue en la memoria de su dueño allá).
 * Sin cuenta no se guarda nada local: la memoria es de una persona con sesión.
 *
 * Guardar y olvidar devuelven lo que de verdad pasó (el servidor contestó bien, o no): la pantalla no
 * dice «listo» sin ese recibo.
 */
import { headersMesa, tokenMesa } from '../10-infra/sesionCliente';

/** El cajón viejo, compartido por todas las cuentas del navegador. Solo se lee para descartarlo. */
export const CLAVE_COMPARTIDA = 'ultron_memoria_larga';
const PREFIJO = 'ultron_memoria_larga:';
const MAX = 80;

let cuenta = '';
let tokenDeCuenta = '';

function almacen(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Huella corta y estable del correo (FNV-1a, 2×32 bits): la clave no lleva el correo a la vista. */
export function huellaCuenta(correo: string): string {
  const c = String(correo || '').trim().toLowerCase();
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ c.length;
  for (let i = 0; i < c.length; i++) {
    const x = c.charCodeAt(i);
    a = Math.imul(a ^ x, 0x01000193) >>> 0;
    b = Math.imul(b ^ x, 0x5bd1e995) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

export function claveDeCuenta(correo: string): string {
  return PREFIJO + huellaCuenta(correo);
}

/**
 * La cuenta que está en la mesa (su correo, de la sesión del servidor), o null al salir. Se ata al
 * token de ese momento. De paso descarta el cajón viejo compartido: no se migra a nadie.
 */
export function fijarCuentaMemoria(correo: string | null | undefined) {
  cuenta = String(correo || '').trim().toLowerCase();
  tokenDeCuenta = cuenta ? tokenMesa() : '';
  try {
    almacen()?.removeItem(CLAVE_COMPARTIDA);
  } catch {
    /* */
  }
}

/** La clave del cajón de quien está, o '' si no hay nadie (o el token ya no es el de esa cuenta). */
function claveVigente(): string {
  if (!cuenta || !tokenDeCuenta || tokenMesa() !== tokenDeCuenta) return '';
  return claveDeCuenta(cuenta);
}

/** El correo de la cuenta cuyo cajón se está leyendo ('' si no hay): viaja con la memoria en el turno. */
export function cuentaDeMemoria(): string {
  return claveVigente() ? cuenta : '';
}

export function leerLarga(): string[] {
  const k = claveVigente();
  if (!k) return [];
  try {
    const raw = almacen()?.getItem(k);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Lo que pasó al guardar u olvidar:
 *  · ok             → el servidor lo confirmó;
 *  · sin-sesion     → no hay cuenta (o el servidor dijo 401/403): no se guardó/olvidó allá;
 *  · fallo          → el servidor no confirmó (5xx, sin red): lo local se hizo, lo remoto no consta.
 */
export type ResultadoMemoria = { remoto: 'ok' | 'sin-sesion' | 'fallo'; status?: number };

async function enviarMemoria(cuerpo: Record<string, unknown>, confirma: (j: any) => boolean = (j) => !!j?.ok): Promise<ResultadoMemoria> {
  try {
    const r = await fetch('/api/memoria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headersMesa() },
      body: JSON.stringify(cuerpo),
    });
    if (r.status === 401 || r.status === 403) return { remoto: 'sin-sesion', status: r.status };
    if (!r.ok) return { remoto: 'fallo', status: r.status };
    const j = await r.json().catch(() => null);
    return confirma(j) ? { remoto: 'ok', status: r.status } : { remoto: 'fallo', status: r.status };
  } catch {
    return { remoto: 'fallo' };
  }
}

export async function guardarHecho(hecho: string, opts?: { usuario?: string; junta?: boolean }): Promise<ResultadoMemoria> {
  const k = claveVigente();
  if (!k) return { remoto: 'sin-sesion' };
  const next = [hecho, ...leerLarga().filter((x) => x !== hecho)].slice(0, MAX);
  try {
    almacen()?.setItem(k, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return enviarMemoria({ hecho, usuario: opts?.usuario, junta: !!opts?.junta });
}

/** Olvida lo de esta cuenta aquí y pide al servidor que lo olvide allá. Devuelve si el servidor lo confirmó. */
export async function olvidarTodo(opts?: { usuario?: string; junta?: boolean }): Promise<ResultadoMemoria> {
  const k = claveVigente();
  try {
    if (k) almacen()?.removeItem(k);
  } catch {
    /* */
  }
  if (!k) return { remoto: 'sin-sesion' };
  // El servidor contesta `olvidado: true` solo si de verdad olvidó: eso es el recibo.
  return enviarMemoria({ olvidar: true, usuario: opts?.usuario, junta: !!opts?.junta }, (j) => !!j?.ok && j?.olvidado === true);
}
