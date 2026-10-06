/**
 * LO QUE QUEDÓ ATRÁS, EN ORDEN (José, 5-oct: «a veces se queda con algo que quedó atrás sin hacer»). Lo comparten los
 * borradores de correo (server/correo.ts) y de WhatsApp (server/whatsapp.ts).
 *
 * Antes cada conversación tenía UN solo lugar por canal: un borrador apartado para el panel (`soloPanel`: siguió con
 * otra cosa sin decir sí ni no) se perdía EN SILENCIO cuando se armaba otro en la misma conversación. Su tarjeta del
 * panel pasaba a «bloqueada: el borrador ya no está esperando (se resolvió en otro lado o el servidor se reinició)»,
 * que no era verdad: nadie lo resolvió, se pisó. Ahora:
 *   · un apartado que otro borrador desplaza (a OTRO destino) espera aquí, en orden, hasta que venza o se decida en su
 *     tarjeta (el panel o la ventana de decisión de la mesa). Uno al MISMO destino es otra versión del mismo mensaje:
 *     la nueva lo reemplaza (y se le dice a la persona).
 *   · lo que vence sin decidirse se le dice UNA vez («el borrador para Ana venció sin enviarse; ¿lo rehago?»): antes
 *     desaparecía sin aviso.
 *
 * Sin dependencias del correo ni de WhatsApp (la vigencia la pasa quien llama): se prueba sola.
 */

/** Lo mínimo de un borrador guardado para ordenarlo y saber si sigue valiendo. */
export type BorradorEnCola = { intento: string; huella: string; dueno: string; vence: number; creado: number };

/** Cuántos apartados esperan como mucho por conversación y canal (el más viejo se avisa como vencido). */
export const MAX_APARTADOS = 6;

/** La llave de una conversación: la misma que usan los borradores de correo y de WhatsApp («persona|ámbito»). */
export const llaveConversacion = (quien: string, ambito = '') => `${String(quien || '').trim().toLowerCase()}|${String(ambito || 'general').slice(0, 80)}`;

/** ¿Venció por tiempo (no por ser de otra sesión)? Solo eso se le avisa a la persona. */
export const vencioPorTiempo = (b: Pick<BorradorEnCola, 'vence'>, ahora = Date.now()) => !(ahora <= b.vence);

/**
 * Los apartados de cada conversación (llave «persona|ámbito»), del más viejo al más nuevo. `motivo` es la vigencia del
 * canal (motivoBorrador): lo que ya no vale se quita al leer, y lo que venció por tiempo se avisa (`alVencer`).
 */
export class ApartadosBorradores<B extends BorradorEnCola> {
  private m = new Map<string, B[]>();

  constructor(private motivo: (b: B, quien: string) => string | null, private alVencer: (llave: string, b: B) => void) {}

  /** Lo vigente de esta conversación, en orden (el más viejo primero). Lo vencido sale y se avisa. */
  lista(llave: string, quien: string): B[] {
    const xs = this.m.get(llave) || [];
    const vivos: B[] = [];
    for (const b of xs) {
      if (!this.motivo(b, quien)) vivos.push(b);
      else if (vencioPorTiempo(b)) this.alVencer(llave, b);
    }
    if (vivos.length !== xs.length) {
      if (vivos.length) this.m.set(llave, vivos);
      else this.m.delete(llave);
    }
    return vivos;
  }

  /** Aparta uno (desplazado por otro borrador). Si pasa del tope, el más viejo se avisa como vencido. */
  apartar(llave: string, b: B) {
    const xs = (this.m.get(llave) || []).filter((x) => x.intento !== b.intento);
    xs.push(b);
    xs.sort((a, c) => a.creado - c.creado);
    while (xs.length > MAX_APARTADOS) this.alVencer(llave, xs.shift()!);
    this.m.set(llave, xs);
  }

  porIntento(llave: string, quien: string, intento: string): B | null {
    return this.lista(llave, quien).find((x) => x.intento === intento) ?? null;
  }

  /** Lo saca (se decidió, se mandó, se descartó o se promovió al lugar principal). */
  quitar(llave: string, intento: string): B | null {
    const xs = this.m.get(llave) || [];
    const i = xs.findIndex((x) => x.intento === intento);
    if (i < 0) return null;
    const [b] = xs.splice(i, 1);
    if (xs.length) this.m.set(llave, xs);
    else this.m.delete(llave);
    return b;
  }

  /**
   * Saca todos los que cumplen `cond` (revisión independiente, G3: una versión nueva para la MISMA persona reemplaza también
   * las versiones viejas que esperaban aquí; si no, podían salir las dos). Devuelve los que sacó.
   */
  quitarDonde(llave: string, cond: (b: B) => boolean): B[] {
    const xs = this.m.get(llave) || [];
    const fuera = xs.filter(cond);
    if (!fuera.length) return [];
    const quedan = xs.filter((x) => !cond(x));
    if (quedan.length) this.m.set(llave, quedan);
    else this.m.delete(llave);
    return fuera;
  }

  /** Cambia uno en su sitio (la persona editó el texto): el de `intento` por `nuevo`. */
  reemplazar(llave: string, intento: string, nuevo: B): boolean {
    const xs = this.m.get(llave) || [];
    const i = xs.findIndex((x) => x.intento === intento);
    if (i < 0) return false;
    xs[i] = nuevo;
    return true;
  }

  limpiar() {
    this.m.clear();
  }
}

/* ------------------------------------------------------------------ lo que venció, dicho una vez */

const VENCIDOS = new Map<string, string[]>();

/** Anota que un borrador venció sin decidirse (por «persona|ámbito»): el próximo turno lo dice, una vez. */
export function anotarVencido(llave: string, aviso: string) {
  const xs = VENCIDOS.get(llave) || [];
  if (xs.includes(aviso)) return;
  VENCIDOS.set(llave, [...xs, aviso].slice(-4));
}

/** Los avisos de lo vencido de esta conversación; se entregan una sola vez. */
export function tomarVencidos(llave: string): string[] {
  const xs = VENCIDOS.get(llave) || [];
  VENCIDOS.delete(llave);
  return xs;
}

/**
 * Revisión 9 (MENOR 8): los avisos de lo vencido SIN gastarlos. En la voz el turno puede descartarse (la frase seguía):
 * el aviso «se dice una vez» se gasta con `gastarVencidos` cuando el turno se confirma (retener.hacer), como la mención.
 */
export function verVencidos(llave: string): string[] {
  return [...(VENCIDOS.get(llave) || [])];
}

/** Gasta esos avisos (los que se dijeron); los que llegaron después siguen esperando su turno. */
export function gastarVencidos(llave: string, dichos: string[]) {
  const xs = (VENCIDOS.get(llave) || []).filter((x) => !dichos.includes(x));
  if (xs.length) VENCIDOS.set(llave, xs);
  else VENCIDOS.delete(llave);
}

export function _olvidarVencidos() {
  VENCIDOS.clear();
}

/* ------------------------------------------------------------------ lo que el panel rechazó */

/**
 * Revisión 9 (el freno de la voz): un turno de voz que se descarta repone el borrador que su «no» quitó (la frase
 * seguía). Si mientras tanto la persona lo RECHAZÓ en su panel o en su ventana de decisión, no vuelve: lo borrado por
 * su decisión no reaparece. Por intento (ids al azar), con un tope y lo que vive un borrador.
 */
const RECHAZADOS = new Map<string, number>();
const RECHAZO_VIVE_MS = 30 * 60_000;

export function anotarRechazoDePanel(intento: string, ahora = Date.now()) {
  if (!intento) return;
  RECHAZADOS.delete(intento);
  RECHAZADOS.set(intento, ahora);
  for (const [k, t] of RECHAZADOS) {
    if (RECHAZADOS.size <= 2000 && ahora - t <= RECHAZO_VIVE_MS) break;
    RECHAZADOS.delete(k);
  }
}

/** ¿La persona rechazó ese borrador por su panel o su ventana? (entonces nada lo repone). */
export function rechazadoEnPanel(intento: string, ahora = Date.now()): boolean {
  const t = RECHAZADOS.get(intento);
  return t !== undefined && ahora - t <= RECHAZO_VIVE_MS;
}

export function _olvidarRechazos() {
  RECHAZADOS.clear();
}

/* ------------------------------------------------------------------ editar desde la ventana de decisión */

/** Lo que devuelve editar un borrador: el nuevo (otro intento y otra huella) o por qué no. */
export type EdicionBorrador<B> = { ok: true; borrador: B } | { ok: false; codigo: 'no-esta' | 'huella' | 'vacio' | 'largo'; mensaje: string };

/** El texto que escribió la persona, limpio: sin caracteres de control (los saltos de línea se quedan). */
export const textoEditado = (t: unknown) =>
  String(t ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, ' ')
    .trim();

/** El texto corto de un borrador para decirlo («Hola Ana, ¿martes o…»). */
export const resumenTexto = (t: string, max = 80) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};
