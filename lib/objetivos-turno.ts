/**
 * LOS OBJETIVOS ABIERTOS EN EL TURNO DE AU-RA (Fase 2): «sigue con lo de la propuesta», «continúa el trabajo», «¿en qué
 * quedamos?». El turno (server.ts prepararTurno) suma un bloque CORTO con los objetivos abiertos de la persona —título,
 * estado, siguiente paso y la decisión que espera— y el modelo contesta desde ahí, sin inventar.
 *
 * Reglas:
 *  · solo AU-RA (`plataforma: 'ultron'`): Dr Electrum no tiene objetivos y su turno no lleva nada;
 *  · ≤ MAX_BLOQUE_OBJETIVOS caracteres en total (va en el mensaje de cada turno: cada ficha es tiempo antes de hablar);
 *  · sin objetivos abiertos, nada (ni el encabezado);
 *  · lo terminal (completado, cancelado, fallido) no entra.
 * Puro: sin red ni almacén (lo prueba tests/objetivos-clientes.test.ts).
 */

export const MAX_BLOQUE_OBJETIVOS = 400;
/** Cuántos objetivos entran como mucho (los más recientes). */
export const MAX_OBJETIVOS_TURNO = 3;

/** Lo mínimo de un objetivo para el bloque (lib/objetivos.ts `Objetivo` o `VistaObjetivo` lo cumplen). */
export type ObjetivoParaTurno = {
  titulo: string;
  estado: string;
  pausado?: boolean;
  siguientePaso?: string;
  actualizado: number;
  decisiones?: { pregunta: string; opciones: { etiqueta: string }[]; elegida?: string }[];
};

const TERMINALES = new Set(['completado', 'cancelado', 'fallido']);

const ESTADOS: Record<string, string> = {
  abierto: 'abierto',
  'esperando-decision': 'espera tu decisión',
  'en-curso': 'en curso',
  'esperando-recurso': 'espera un recurso',
  incierto: 'sin confirmar',
};

/** Una línea limpia y corta (sin saltos ni lo que el harness lee como orden). */
const corta = (v: unknown, max: number) => {
  const t = String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/PEDIR_HERRAMIENTA/gi, 'PEDIR-HERRAMIENTA')
    .replace(/ACCION_APP/gi, 'ACCION-APP')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
};

/* ------------------------------------------------------------------ ¿viene al caso en este turno? */

/**
 * «QUE HAGA LAS COSAS Y NO SE MIX CON OTRAS COSAS» (José, 10-oct, APK 5.7.0: le pidió abrir Spotify y AU-RA mezclaba lo
 * del trabajo). El bloque iba en CADA turno; ahora solo cuando el mensaje es de eso:
 *  · seguir o retomar («sigue», «continúa», «retoma», «¿en qué quedamos?», «¿dónde nos quedamos?»);
 *  · el trabajo, sus objetivos, tareas, pendientes, propuestas, avances («¿cómo va la propuesta?», «lo pendiente»);
 *  · nombra uno de sus objetivos abiertos (una palabra de su título de 4+ letras que no sea de relleno);
 *  · o un objetivo espera su decisión Y pregunta qué le toca («¿qué falta?», «¿qué necesitas de mí?», «¿qué decido?»).
 * Lo demás («abre Spotify», «¿cómo está el clima?», «cuéntame un chiste») va sin el bloque.
 */
const SIGUE = /^(y |bueno |ok |va |dale |entonces |ahora )*(sigue|seguimos|sigamos|segui|continua|continuemos|continuamos|retoma|retomemos|retomamos)( (por favor|pues|ya|asi|adelante))?$|\b(sigue|continua|retoma|seguir|continuar|retomar) (con|el|la|lo|los|las|donde|adelante|trabajando|en lo)\b/;
const QUEDAMOS = /\b(en que|donde) (quedamos|nos quedamos|ibamos|vamos)\b|\bcomo (vamos|ibamos|va|van) con\b|\bque (sigue|hay pendiente|tengo pendiente|queda pendiente)\b/;
const DEL_TRABAJO = /\b(el trabajo|mi trabajo|del trabajo|la propuesta|las propuestas|propuesta|pendiente\w*|objetivo\w*|metas?|tarea\w*|proyecto\w*|avance\w*|entregable\w*|lo que estabamos( haciendo)?)\b/;
const PIDE_DECIDIR = /\b(que (falta|me toca|necesitas de mi|decido|tengo que decidir|esperas de mi)|algo (que|por) decidir|que hay que decidir|mi decision|decidir)\b/;
const RELLENO = new Set(['para', 'sobre', 'como', 'esta', 'este', 'esto', 'todo', 'todos', 'nuevo', 'nueva', 'hacer', 'cosas', 'tema', 'plan', 'lista', 'final', 'banco']);

const planoObj = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** ¿El bloque de objetivos viene al caso en este mensaje? (ver arriba). Sin objetivos abiertos, nunca. */
export function objetivosAlCaso(mensaje: string, xs: readonly ObjetivoParaTurno[]): boolean {
  const abiertos = objetivosAbiertos(xs || []);
  if (!abiertos.length) return false;
  const m = planoObj(mensaje);
  if (!m) return false;
  if (SIGUE.test(m) || QUEDAMOS.test(m) || DEL_TRABAJO.test(m)) return true;
  const palabras = new Set(m.split(' '));
  const nombra = abiertos.some((o) =>
    planoObj(o.titulo)
      .split(' ')
      .some((w) => w.length >= 4 && !RELLENO.has(w) && palabras.has(w))
  );
  if (nombra) return true;
  const espera = abiertos.some((o) => o.estado === 'esperando-decision' || (o.decisiones || []).some((d) => !d.elegida));
  return espera && PIDE_DECIDIR.test(m);
}

/** Los abiertos, del más reciente al más viejo. */
export function objetivosAbiertos<T extends ObjetivoParaTurno>(xs: readonly T[]): T[] {
  return xs.filter((o) => o && !TERMINALES.has(o.estado)).sort((a, b) => (b.actualizado || 0) - (a.actualizado || 0));
}

/** La línea de un objetivo: «Propuesta para el banco» — espera tu decisión; sigue: …; decide: ¿…? (A / B). */
export function lineaObjetivoTurno(o: ObjetivoParaTurno): string {
  const estado = o.pausado ? 'en pausa' : ESTADOS[o.estado] || o.estado;
  const partes = [`· «${corta(o.titulo, 60)}» — ${estado}`];
  if (o.siguientePaso) partes.push(`sigue: ${corta(o.siguientePaso, 70)}`);
  const pendiente = (o.decisiones || []).find((d) => !d.elegida);
  if (pendiente) {
    const ops = pendiente.opciones.map((x) => corta(x.etiqueta, 20)).join(' / ');
    partes.push(`decide: ${corta(pendiente.pregunta, 70)}${ops ? ` (${ops})` : ''}`);
  }
  return partes.join('; ');
}

/**
 * El bloque del turno, o '' (otra plataforma, sin objetivos abiertos). Nunca pasa de MAX_BLOQUE_OBJETIVOS: los
 * objetivos que no caben se cuentan («y 2 más»), y una sola línea larga se recorta.
 */
export function bloqueObjetivosTurno(xs: readonly ObjetivoParaTurno[], o: { plataforma: string }): string {
  if (o.plataforma !== 'ultron') return '';
  const abiertos = objetivosAbiertos(xs || []);
  if (!abiertos.length) return '';
  const cabeza = 'OBJETIVOS ABIERTOS (si dice «sigue con lo de…», «continúa» o «¿en qué quedamos?», contesta desde aquí; no inventes avances):';
  const lineas: string[] = [];
  let largo = cabeza.length;
  for (const ob of abiertos.slice(0, MAX_OBJETIVOS_TURNO)) {
    const l = lineaObjetivoTurno(ob);
    const resto = abiertos.length - lineas.length - 1;
    const reserva = resto > 0 ? 12 : 0; // lo que ocupa «\n· y N más»
    if (largo + 1 + l.length + reserva > MAX_BLOQUE_OBJETIVOS) {
      if (!lineas.length) lineas.push(corta(l, MAX_BLOQUE_OBJETIVOS - largo - 1 - reserva));
      break;
    }
    lineas.push(l);
    largo += 1 + l.length;
  }
  const faltan = abiertos.length - lineas.length;
  const texto = [cabeza, ...lineas, ...(faltan > 0 ? [`· y ${faltan} más`] : [])].join('\n');
  return texto.length <= MAX_BLOQUE_OBJETIVOS ? texto : `${texto.slice(0, MAX_BLOQUE_OBJETIVOS - 1).trimEnd()}…`;
}
