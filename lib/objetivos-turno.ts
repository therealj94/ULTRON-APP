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
