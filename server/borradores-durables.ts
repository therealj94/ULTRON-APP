/**
 * EL BORRADOR QUE SE APRUEBA, DURABLE (Fase 2). Los borradores de correo y de WhatsApp que esperan su «sí» vivían SOLO en
 * mapas del proceso (server/correo.ts y server/whatsapp.ts, 15 minutos): tras un reinicio, o si la aprobación llegaba a
 * otra réplica (el teléfono, la web, Windows), su tarjeta del panel fallaba con `propuesta-cambiada` aunque la persona
 * estuviera aprobando exactamente lo que vio.
 *
 * Ahora cada borrador se guarda TAMBIÉN en lo durable (lib/durable.ts) por dueño + id de intento + huella del contenido,
 * con su vencimiento de siempre. El mapa del proceso sigue siendo el camino rápido (la caché); cuando no lo tiene, quien
 * lo necesita (el panel de tareas, server/trabajos.ts) lo REHIDRATA desde aquí, y solo si:
 *   · es del mismo dueño, de la misma conversación (ámbito) y del mismo intento;
 *   · la huella guardada es la que aprobó la tarjeta Y la que se recalcula con su contenido (nada lo tocó);
 *   · no venció y no consta que ya salió (lib/envios.ts `reciboDeBorrador`).
 * El envío sigue pasando por la operación una-vez del borrador (lib/envios.ts): rehidratar nunca lo manda dos veces.
 *
 * Lo que no se guarda: los bytes de un archivo adjunto de WhatsApp (viven solo en la memoria, a propósito): un borrador
 * con archivo no es durable y tras un reinicio pide armarse otra vez.
 *
 * Revisión de fases: la LÁPIDA. Un borrador que la persona rechazó (panel, ventana, tarjeta), que se reemplazó por otro
 * (una versión nueva del mismo correo o chat, «Editar») o que se descartó deja una marca durable por dueño + intento.
 * Rehidratar la respeta: tras un reinicio no vuelve a esperar un «sí» (antes la marca de rechazo vivía solo en la memoria,
 * server/borradores-cola.ts `rechazadoEnPanel`, y el borrador revivía desde lo durable). Si la lápida no se puede leer,
 * tampoco revive (no poder rehidratar solo es un 409 «propuesta-cambiada»; revivir lo rechazado sería peor).
 */
import { almacenDurable, claveDe, crearUnaVez, leerDurable, type AlmacenDurable } from '../lib/durable';
import { reciboDeBorrador } from '../lib/envios';

export type CanalBorrador = 'correo' | 'whatsapp';
type Guardado<B> = { v: 1; canal: CanalBorrador; ambito: string; intento: string; huella: string; vence: number; b: B };

const claveBorrador = (canal: CanalBorrador, dueno: string, intento: string, huella: string) => claveDe(`borradores/${canal}`, dueno, `${intento}:${huella}`);
const claveLapida = (dueno: string, intento: string) => claveDe('borradores/descartados', dueno, intento);
export type MotivoDescarte = 'rechazado' | 'reemplazado' | 'descartado';
type Lapida = { v: 1; intento: string; motivo: MotivoDescarte; t: number };
const amb = (ambito: string) => String(ambito || 'general').slice(0, 80);

/** Lo que falta por escribir (para las pruebas: «reiniciar» después de que todo quedó guardado). */
const enVuelo = new Set<Promise<unknown>>();

/**
 * Guarda el borrador (una vez por intento + huella). Lo mejor posible y sin esperar: el mapa del proceso ya lo tiene;
 * si esto falla, lo único que se pierde es la aprobación después de un reinicio (como antes).
 */
export function guardarBorradorDurable<B extends { intento: string; huella: string; vence: number }>(canal: CanalBorrador, dueno: string, ambito: string, b: B, a?: AlmacenDurable): void {
  if (!dueno || !b?.intento || !b.huella || !(b.vence > Date.now())) return;
  const p = crearUnaVez<Guardado<B>>(claveBorrador(canal, dueno, b.intento, b.huella), { v: 1, canal, ambito: amb(ambito), intento: b.intento, huella: b.huella, vence: b.vence, b }, a || almacenDurable())
    .catch(() => null)
    .finally(() => enVuelo.delete(p));
  enVuelo.add(p);
}

/**
 * Deja la lápida de un borrador (rechazado, reemplazado o descartado): ya no se rehidrata nunca. Una vez por intento (la
 * primera razón gana). Lo mejor posible: devuelve la promesa por si alguien quiere esperarla (las rutas la esperan).
 */
export function anotarDescarteDurable(dueno: string, intento: string, motivo: MotivoDescarte, a?: AlmacenDurable): Promise<boolean> {
  if (!dueno || !intento) return Promise.resolve(false);
  const p: Promise<boolean> = crearUnaVez<Lapida>(claveLapida(dueno, intento), { v: 1, intento, motivo, t: Date.now() }, a || almacenDurable())
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => enVuelo.delete(p));
  enVuelo.add(p);
  return p;
}

/** ¿Tiene lápida? 'incierto' si no se pudo leer. */
export async function borradorDescartado(dueno: string, intento: string, a?: AlmacenDurable): Promise<boolean | 'incierto'> {
  if (!dueno || !intento) return false;
  const l = await leerDurable<Lapida>(claveLapida(dueno, intento), a || almacenDurable()).catch(() => null);
  if (!l || l.ok === false) return 'incierto';
  return !!l.valor;
}

/**
 * El borrador guardado de ESE intento con ESA huella, si sigue valiendo (mismo ámbito, sin vencer, sin recibo de envío,
 * sin lápida). null si no. Quien lo usa vuelve a calcular la huella con su contenido antes de ponerlo a esperar.
 */
export async function leerBorradorDurable<B>(canal: CanalBorrador, dueno: string, ambito: string, intento: string, huella: string, o: { ahora?: number; almacen?: AlmacenDurable } = {}): Promise<B | null> {
  if (!dueno || !intento || !huella) return null;
  const a = o.almacen || almacenDurable();
  const l = await leerDurable<Guardado<B>>(claveBorrador(canal, dueno, intento, huella), a).catch(() => null);
  if (!l || l.ok === false || !l.valor) return null;
  const g = l.valor;
  if (g.v !== 1 || g.canal !== canal || g.intento !== intento || g.huella !== huella || g.ambito !== amb(ambito)) return null;
  if (!((o.ahora ?? Date.now()) <= g.vence)) return null;
  // Rechazado, reemplazado o descartado (o no se sabe): no vuelve.
  if ((await borradorDescartado(dueno, intento, a)) !== false) return null;
  // Si ya consta que salió (o no se sabe), no vuelve a esperar un «sí».
  const recibo = await reciboDeBorrador(canal, dueno, intento, a).catch(() => 'incierto' as const);
  if (recibo !== 'ninguno') return null;
  return g.b;
}

/** Solo pruebas: espera a que terminen las escrituras pendientes. */
export async function _esperarBorradoresDurables(): Promise<void> {
  await Promise.all([...enVuelo]);
}
