/**
 * A quién le puede escribir AURA: nombres y correos de la gente del chat, nunca sus mensajes.
 *
 * Sale de `RELEVO.contactosConocidos()` (las conversaciones 1 a 1 y los amigos del círculo que el
 * relevo ya trajo). Es SÍNCRONA: antes se la llamaba con `await nuevo().catch(…)`, el `.catch` de un
 * arreglo lanzaba un TypeError que se tragaba y al cerebro le llegaba `contactos: []` siempre.
 *
 * La lista del relevo solo se llena cuando alguien pide las conversaciones (hasta la 5.0, al abrir los
 * chats). Si está vacía y hay cuenta, se pide UNA vez por cuenta (`CHATS.refrescarLista`); si la
 * persona de verdad no tiene contactos, no se vuelve a pedir en cada envío del contexto.
 *
 * De cada contacto se toman SOLO `correo` y `nombre` (depurarContactos descarta todo lo demás).
 */
import * as RELEVO from '../pulse/relevo';
import * as CHATS from '../pulse/chats';
import { depurarContactos, type Contacto } from './acciones';

/** La cuenta para la que ya se pidió la lista (una vez por cuenta). */
let pedidaPara = '';

export async function contactosParaAura(): Promise<Contacto[]> {
  const yo = RELEVO.quien()?.correo || '';
  if (!yo) return [];
  let lista = depurarContactos(RELEVO.contactosConocidos());
  if (!lista.length && pedidaPara !== yo) {
    pedidaPara = yo;
    await CHATS.refrescarLista().catch(() => undefined);
    // Pudo salir de la cuenta mientras se pedía: lo de otra persona no se manda.
    if (RELEVO.quien()?.correo !== yo) return [];
    lista = depurarContactos(RELEVO.contactosConocidos());
  }
  return lista;
}
