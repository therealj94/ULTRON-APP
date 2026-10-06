/**
 * LO ÚLTIMO QUE SE LE PRESENTÓ, POR CONVERSACIÓN (SEC-01, el «sí» ESCRITO).
 *
 * El «sí» hablado ya estaba atado a la huella exacta que muestra el aparato (server/decision-hablada.ts). El escrito
 * seguía el camino de antes: con un solo borrador esperando lo mandaba aunque esa versión nunca se hubiera mostrado
 * (editado en el panel después de leérselo; una ventana que mostraba otro y cuyo registro venció o se perdió). La
 * auditoría (§4, 5754c78) contó ocho negativos así, en correo y en WhatsApp.
 *
 * Aquí queda, por conversación (dueño + ámbito), la ÚLTIMA presentación concreta de un borrador:
 *  · `chat`    — el servidor armó el borrador en un turno y su texto exacto salió en la respuesta (y su tarjeta, con la
 *                huella): server/correo.ts y server/whatsapp.ts guardarBorrador; o el servidor lo volvió a presentar
 *                porque un «sí» no estaba atado (decision-turno.ts);
 *  · `ventana` — la ventana de decisión de un aparato dijo que lo muestra (server/decision-en-pantalla.ts fijarEnPantalla).
 * La más nueva reemplaza a la de antes: la pregunta más reciente es la que vale. Un «sí» escrito que mandaría un correo
 * o un WhatsApp sale solo si esa última presentación es EXACTAMENTE ese borrador (canal, intento, huella) y sigue viva:
 * la del chat, mientras el borrador vive (15 min); la de la ventana, solo mientras su registro sigue vigente (si venció,
 * se ocultó o la renovación dijo `registrada: false`, perdió la autoridad y no la recupera una presentación más vieja).
 * Sin eso no se busca otro candidato: se vuelve a presentar ESA versión y se pregunta.
 *
 * En memoria (como el registro de la ventana): tras un reinicio no hay presentación y se vuelve a presentar.
 */
import type { EnPantalla } from './decision-en-pantalla';

export type Presentacion = { canal: 'correo' | 'whatsapp'; intento: string; huella: string; t: number; via: 'chat' | 'ventana'; aparato?: string };

/** Lo que vale una presentación en el chat: lo mismo que vive un borrador. */
export const PRESENTACION_CHAT_VIVE_MS = 15 * 60_000;

const ULTIMA = new Map<string, Presentacion>();
/** Cada versión presentada en la conversación (por intento, la última huella que se presentó de él). */
const PRESENTADAS = new Map<string, Map<string, Presentacion>>();
const MAX = 20_000;
const llave = (dueno: string, ambito: string) => `${String(dueno || '').trim().toLowerCase()}|${String(ambito || '')}`;

function anotar(dueno: string, ambito: string, p: Presentacion) {
  if (!String(dueno || '').trim() || !p.intento || !p.huella) return;
  const k = llave(dueno, ambito);
  ULTIMA.delete(k);
  ULTIMA.set(k, p);
  while (ULTIMA.size > MAX) ULTIMA.delete(ULTIMA.keys().next().value!);
  const m = PRESENTADAS.get(k) || new Map<string, Presentacion>();
  m.delete(p.intento);
  m.set(p.intento, p);
  while (m.size > 50) m.delete(m.keys().next().value!);
  PRESENTADAS.delete(k);
  PRESENTADAS.set(k, m);
  while (PRESENTADAS.size > MAX) PRESENTADAS.delete(PRESENTADAS.keys().next().value!);
}

/** El texto exacto de este borrador salió en el chat de esta conversación (con su tarjeta y su huella). */
export function presentadoEnChat(dueno: string, ambito: string, b: { canal: 'correo' | 'whatsapp'; intento: string; huella: string }, ahora = Date.now()) {
  anotar(dueno, ambito, { canal: b.canal, intento: b.intento, huella: b.huella, t: ahora, via: 'chat' });
}

/** La ventana de decisión de un aparato lo muestra (se registró como visible). */
export function presentadoEnVentana(dueno: string, ambito: string, b: { canal: 'correo' | 'whatsapp'; intento: string; huella: string }, aparato?: string, ahora = Date.now()) {
  const antes = ULTIMA.get(llave(dueno, ambito));
  // La misma ventana con lo mismo: no se vuelve «más nueva».
  if (antes && antes.via === 'ventana' && antes.intento === b.intento && antes.huella === b.huella && antes.aparato === aparato) return;
  anotar(dueno, ambito, { canal: b.canal, intento: b.intento, huella: b.huella, t: ahora, via: 'ventana', ...(aparato ? { aparato } : {}) });
}

export function ultimaPresentacion(dueno: string, ambito: string): Presentacion | null {
  return ULTIMA.get(llave(dueno, ambito)) ?? null;
}

export type AtaduraEscrita = 'ok' | 'sin_presentacion' | 'otra_version' | 'ventana_sin_autoridad';

const esLa = (l: Presentacion, p: { origen: string; id?: string; huella?: string }) => l.canal === p.origen && l.intento === p.id && !!p.huella && l.huella === p.huella;

/** ¿Esa presentación sigue con autoridad? La del chat, mientras vive; la de la ventana, solo con su registro vigente. */
function conAutoridad(l: Presentacion, ventana: EnPantalla | null, ahora: number): boolean {
  if (l.via === 'chat') return ahora - l.t <= PRESENTACION_CHAT_VIVE_MS;
  const v = ventana;
  return !!v && v.canal === l.canal && v.intento === l.intento && v.huella === l.huella && (v.aparato ?? '') === (l.aparato ?? '');
}

/**
 * ¿Este «sí» ESCRITO puede mandar `p`? `ventana`: el registro de la ventana vigente en esta conversación (o null).
 *  · un «sí» que no nombra nada («sí», «mándalo»): `ok` solo si la ÚLTIMA presentación es exactamente `p` y sigue viva;
 *  · uno que nombra a cuál («sí, el correo», «sí, el de Bruno», `nombrada`): basta que ESA versión exacta se le haya
 *    presentado en esta conversación y siga viva (nombrarla la identifica; la versión tiene que ser la que vio).
 */
export function atadoAlPresentado(o: { dueno: string; ambito: string; p: { origen: string; id?: string; huella?: string }; ventana: EnPantalla | null; nombrada?: boolean; ahora?: number }): AtaduraEscrita {
  const ahora = o.ahora ?? Date.now();
  const l = ultimaPresentacion(o.dueno, o.ambito);
  if (l && esLa(l, o.p) && conAutoridad(l, o.ventana, ahora)) return 'ok';
  if (o.nombrada && o.p.id) {
    const suya = PRESENTADAS.get(llave(o.dueno, o.ambito))?.get(o.p.id);
    if (suya && esLa(suya, o.p) && conAutoridad(suya, o.ventana, ahora)) return 'ok';
  }
  if (!l) return 'sin_presentacion';
  if (!conAutoridad(l, o.ventana, ahora)) return l.via === 'ventana' ? 'ventana_sin_autoridad' : 'sin_presentacion';
  return 'otra_version';
}

export function _olvidarPresentaciones() {
  ULTIMA.clear();
  PRESENTADAS.clear();
}
