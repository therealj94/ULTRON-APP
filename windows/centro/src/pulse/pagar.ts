/**
 * Mandar ORIGEN (o un token de la red) por PULSE2CHAT, como en Veta Wallet: la dirección sale de la ficha
 * de la persona en el chat, nunca de algo escrito a mano (ahí es donde la gente se equivoca y pierde el
 * dinero).
 *
 * AURA NO MUEVE DINERO. Lo que hace:
 *   1. abre Veta Wallet con el envío ya llenado (`#pagar?a=…&m=…&s=…`): allá se revisa y se firma con la
 *      contraseña de la persona; si no lo firma, no pasa nada;
 *   2. mira la cadena (solo lectura) hasta ver ese envío, y RECIÉN ENTONCES publica el comprobante en el
 *      hilo (`/pago` con el hash; el relevo lo comprueba contra la cadena). Un comprobante de algo que
 *      todavía no pasó sería una mentira.
 *
 * Y la cartera del Centro se conecta sola: la dirección de la persona es la de su ficha en PULSE2CHAT.
 */
import { pedir } from '../puente';
import * as RELEVO from './relevo';

const DIRECCION = /^0x[0-9a-fA-F]{40}$/;

/** Las monedas de la red (las mismas de Veta Wallet): copia de respaldo de la lista única. */
export const MONEDAS = ['ORIGEN', 'AUKA', 'AGKA', 'ONDK', 'MNKA', 'IBS', 'HARV', 'AUBEX', 'ASL', 'LOVE', 'REST', 'SOL', 'AIT', 'AGRO', 'POLITICAL'];

/**
 * Las monedas que se pueden enviar hoy: las que muestra la cartera según la lista única (una moneda oculta ya
 * no se ofrece, y la cartera no la aceptaría). Si la cartera no contesta, la copia de respaldo.
 */
export async function monedasVisibles(): Promise<string[]> {
  try {
    const c = await pedir<any>('cartera.saldos', {});
    const l = Array.isArray(c?.monedas) ? c.monedas.filter((x: unknown) => typeof x === 'string' && x) : [];
    return l.length ? l : MONEDAS;
  } catch {
    return MONEDAS;
  }
}

/** La dirección de Veta Wallet de alguien del chat (su ficha), o null si no la tiene a la vista. */
export async function direccionDe(correo: string): Promise<string | null> {
  try {
    const f = await RELEVO.ficha(correo);
    const d = String(f?.addr || f?.direccion || '').trim();
    return DIRECCION.test(d) ? d : null;
  } catch {
    return null;
  }
}

/** La cantidad tal cual se escribió («2,5» o «2.5») → texto con punto, o null si no es mayor que cero. */
export function montoValido(s: string): string | null {
  const t = String(s || '').trim().replace(/\s/g, '');
  if (!/^\d{1,15}([.,]\d{1,18})?$/.test(t)) return null;
  const n = t.replace(',', '.');
  return Number(n) > 0 ? n : null;
}

let conectando: Promise<boolean> | null = null;

/**
 * Si la cartera del Centro todavía no tiene dirección y PULSE2CHAT está conectado, pone la de la ficha
 * de la persona. La dirección es pública: con ella AURA solo puede LEER saldos.
 */
export function autoConectarCartera(): Promise<boolean> {
  conectando ??= (async () => {
    try {
      const yo = RELEVO.quien();
      if (!yo) return false;
      const c = await pedir<any>('cartera.saldos', {}).catch(() => null);
      if (c?.direccion) return true;
      const d = await direccionDe(yo.correo);
      if (!d) return false;
      await pedir('cartera.direccion', { direccion: d });
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (conectando = null), 0);
    }
  })();
  return conectando;
}

export type Envio = { correo: string; nombre: string; direccion: string; monto: string; moneda: string };

const vigilando = new Map<string, number>();
/** Hashes que ya se publicaron como comprobante: el mismo envío nunca prueba dos pagos. */
const usados = new Set<string>();

/**
 * Abre el envío en Veta Wallet y vigila la cadena hasta 15 min. Cuando el envío aparece, publica el
 * comprobante en el hilo. `alCambiar` cuenta en qué va (para la interfaz).
 */
export async function pagar(e: Envio, alCambiar?: (estado: 'abierto' | 'confirmado' | 'sin-comprobante' | 'sin-ver', hash?: string) => void): Promise<void> {
  const r = await pedir<{ ok: boolean; bloque: number; desde: string }>('cartera.pagar', { direccion: e.direccion, monto: e.monto, simbolo: e.moneda });
  alCambiar?.('abierto');
  // Sin la dirección propia no se puede reconocer el envío: queda hecho en la wallet, sin comprobante aquí.
  if (!r?.desde) {
    alCambiar?.('sin-ver');
    return;
  }
  const clave = `${e.correo}|${e.monto}|${e.moneda}`;
  window.clearTimeout(vigilando.get(clave));
  // Solo bloques DESPUÉS de abrir el envío: uno anterior con la misma cantidad sería otro pago, no este.
  let desde = Number(r.bloque) > 0 ? String(Number(r.bloque) + 1) : '0';
  const hasta = Date.now() + 15 * 60_000;
  const mirar = async () => {
    if (Date.now() > hasta) {
      vigilando.delete(clave);
      alCambiar?.('sin-ver');
      return;
    }
    try {
      const v = await pedir<{ hash: string | null; siguiente: string }>('cartera.buscarEnvio', { para: e.direccion, simbolo: e.moneda, monto: e.monto, desde }, 60_000);
      if (v?.hash && !usados.has(v.hash.toLowerCase())) {
        vigilando.delete(clave);
        usados.add(v.hash.toLowerCase());
        // El relevo comprueba el hash contra la cadena: solo si lo aceptó se dice que el comprobante quedó.
        const publicado = await RELEVO.pago({ para: e.correo, monto: e.monto, moneda: e.moneda, hash: v.hash }).then(() => true, () => false);
        pedir('notch.aviso', publicado
          ? { titulo: `Enviaste ${e.monto} ${e.moneda}`, cuerpo: `A ${e.nombre}. El comprobante quedó en su chat.` }
          : { titulo: `Vi tu envío de ${e.monto} ${e.moneda}`, cuerpo: `Pero el chat no aceptó el comprobante. Revísalo en OrdenScan: ${v.hash.slice(0, 12)}…` }).catch(() => {});
        alCambiar?.(publicado ? 'confirmado' : 'sin-comprobante', v.hash);
        return;
      }
      if (v?.siguiente) desde = v.siguiente;
    } catch {
      /* sin red un momento: se vuelve a mirar */
    }
    vigilando.set(clave, window.setTimeout(mirar, 6000));
  };
  vigilando.set(clave, window.setTimeout(mirar, 8000));
}
