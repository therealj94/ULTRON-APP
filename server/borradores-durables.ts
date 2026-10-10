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
 * Descartar (cancelar su objetivo, rechazarlo en el panel) deja una marca durable por dueño + intento
 * (`descartarBorradorDurable`): ninguna réplica lo rehidrata después, aunque su huella siga siendo la misma.
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
import { almacenDurable, claveDe, crearUnaVez, leerDurable, modificarDurable, type AlmacenDurable } from '../lib/durable';
import { reciboDeBorrador } from '../lib/envios';
import { claveLapidaBorrador } from '../lib/puerta-efecto';

export type CanalBorrador = 'correo' | 'whatsapp';
type Guardado<B> = { v: 1; canal: CanalBorrador; ambito: string; intento: string; huella: string; vence: number; b: B };

const claveBorrador = (canal: CanalBorrador, dueno: string, intento: string, huella: string) => claveDe(`borradores/${canal}`, dueno, `${intento}:${huella}`);
const claveLapida = claveLapidaBorrador;
/** F01 + auditoría de superficies: dónde se PRESENTÓ una propuesta exacta (intento + huella) y lo último presentado en cada superficie. */
const clavePresentacion = (dueno: string, intento: string, huella: string, superficie: string) => claveDe('borradores/presentados', dueno, `${intento}:${huella}:${superficie}`);
const claveUltimaPresentada = (dueno: string, superficie: string) => claveDe('borradores/presentado-en', dueno, superficie);
export type Presentacion = { v: 1; canal: CanalBorrador; intento: string; huella: string; origen: string; superficie: string; t: number };
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
  if (g.v !== 1 || g.canal !== canal || g.intento !== intento || g.huella !== huella) return null;
  // El borrador durable es de la CUENTA (dueño + intento); la superficie donde se armó es metadato (`ambito`). Desde otra
  // superficie del mismo dueño vale solo si ESA superficie mostró exactamente esta propuesta (intento + huella).
  if (g.ambito !== amb(ambito) && !(await borradorPresentadoEn(dueno, intento, huella, ambito, a))) return null;
  if (!((o.ahora ?? Date.now()) <= g.vence)) return null;
  // Rechazado, reemplazado o descartado (o no se sabe): no vuelve.
  if ((await borradorDescartado(dueno, intento, a)) !== false) return null;
  // Si ya consta que salió (o no se sabe), no vuelve a esperar un «sí».
  const recibo = await reciboDeBorrador(canal, dueno, intento, a).catch(() => 'incierto' as const);
  if (recibo !== 'ninguno') return null;
  return g.b;
}

/**
 * Descarta el borrador de ESE intento en lo durable (una marca por dueño + intento, con cualquier huella): después,
 * `leerBorradorDurable` no lo devuelve y ninguna réplica lo vuelve a poner a esperar. true si la marca quedó (o ya estaba).
 * Nunca lanza.
 */
export async function descartarBorradorDurable(_canal: CanalBorrador, dueno: string, intento: string, a?: AlmacenDurable, ahora = Date.now()): Promise<boolean> {
  if (!dueno || !intento) return false;
  // La misma lápida que el rechazo del panel (una por dueño + intento): `leerBorradorDurable` la respeta igual.
  const r = await crearUnaVez<Lapida>(claveLapida(dueno, intento), { v: 1, intento, motivo: 'descartado', t: ahora }, a || almacenDurable()).catch(() => null);
  return !!r && r.ok === true;
}

/**
 * La superficie `superficie` (un aparato, la web, Windows: el ámbito de su conversación) le MOSTRÓ a la persona esta
 * propuesta exacta. Sin esto, aprobarla desde otra superficie no vale (la regla de «presentación válida»: quien aprueba
 * tiene que haber visto la huella exacta). También queda como lo último presentado en esa superficie, para que un «sí,
 * mándalo» dicho allí encuentre ESA propuesta (`ultimoPresentadoEn`).
 *
 * Gancho para quien pinta la tarjeta en el teléfono (lib/acciones-app.ts, otro equipo): llamar esto al mostrarla con su
 * `correo#aparato` como superficie, y resolver el «sí» de ese aparato con `ultimoPresentadoEn`. true si quedó anotado.
 */
export async function anotarPresentacionBorrador(canal: CanalBorrador, dueno: string, p: { intento: string; huella: string; origen: string }, superficie: string, a?: AlmacenDurable, ahora = Date.now()): Promise<boolean> {
  if (!dueno || !p?.intento || !p.huella || !superficie) return false;
  const alm = a || almacenDurable();
  const reg: Presentacion = { v: 1, canal, intento: p.intento, huella: p.huella, origen: amb(p.origen), superficie: amb(superficie), t: ahora };
  const c = await crearUnaVez<Presentacion>(clavePresentacion(dueno, p.intento, p.huella, amb(superficie)), reg, alm).catch(() => null);
  if (!c || c.ok === false) return false;
  const u = await modificarDurable<Presentacion>(claveUltimaPresentada(dueno, amb(superficie)), (x) => (x && x.t > ahora ? undefined : reg), alm).catch(() => null);
  return !!u && u.ok === true;
}

/** ¿Esa superficie mostró exactamente esa propuesta? (o es donde se armó, que la mostró al armarla). */
export async function borradorPresentadoEn(dueno: string, intento: string, huella: string, superficie: string, a?: AlmacenDurable): Promise<boolean> {
  if (!dueno || !intento || !huella || !superficie) return false;
  const l = await leerDurable<Presentacion>(clavePresentacion(dueno, intento, huella, amb(superficie)), a || almacenDurable()).catch(() => null);
  return !!(l && l.ok && l.valor && l.valor.intento === intento && l.valor.huella === huella);
}

/** Lo último que se le presentó a la persona en esa superficie (para resolver un «sí» dicho allí). null si nada. */
export async function ultimoPresentadoEn(dueno: string, superficie: string, a?: AlmacenDurable): Promise<Presentacion | null> {
  if (!dueno || !superficie) return null;
  const l = await leerDurable<Presentacion>(claveUltimaPresentada(dueno, amb(superficie)), a || almacenDurable()).catch(() => null);
  return l && l.ok && l.valor ? l.valor : null;
}

/** Solo pruebas: espera a que terminen las escrituras pendientes. */
export async function _esperarBorradoresDurables(): Promise<void> {
  await Promise.all([...enVuelo]);
}
