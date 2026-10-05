/**
 * CUANDO UN TURNO DE LA MESA NO TRAE RESPUESTA: qué se le dice a la persona y qué miga queda.
 *
 * José, 5-oct: la mesa dijo «No alcanzo al cerebro remoto ahora. Sigo contigo con lo básico.» y en los
 * logs no había nada que dijera por qué: las migas solo salían con otros avisos y el servidor no anotaba
 * el turno fallido. Ahora la mesa deja una miga con lo que pasó en cada camino (el stream y el JSON de
 * respaldo: el error, el estado HTTP, el código del servidor) y la manda en el acto. NUNCA lo que dijo la
 * persona ni la respuesta: solo errores y números, y el idTurno (aleatorio, por frase), que es el mismo
 * que el servidor pone en su línea `[turno] FALLA … id=…` (server/registro-turno.ts).
 *
 * Además no todo fallo es «no alcanzo al cerebro»: si el servidor dice que el turno SIGUE en curso (409)
 * o que va muy rápido (429), la mesa dice eso (la frase honesta que trae el servidor).
 *
 * Puro y sin React Native: lo prueban en Node (pruebas/mesa/mesa.prueba.mjs).
 */

/** Lo que se sabe de un intento fallido (ChatResult de lib/api.ts, o el error del stream). */
export type IntentoFallido = { error?: string; status?: number; codigo?: string; via?: string; pendiente?: boolean };

/**
 * Qué se le dice: `sesion` (se cerró la sesión de la mesa), `en-curso` (el servidor sigue con ese mismo
 * turno), `rapido` (el cupo de turnos: 429), `sin-red` (el teléfono no llega a nada) o `sin-cerebro` (llegó
 * al servidor y el cerebro no contestó).
 */
export type ClaseFallo = 'sesion' | 'en-curso' | 'rapido' | 'sin-red' | 'sin-cerebro';

export function clasificarFallo(r: IntentoFallido): ClaseFallo {
  const e = String(r.error || '');
  if (r.status === 401 || /sesión|privado|401/i.test(e)) return 'sesion';
  if (r.pendiente || r.status === 409 || r.codigo === 'en-curso') return 'en-curso';
  if (r.status === 429 || r.codigo === 'demasiados_turnos') return 'rapido';
  if (!r.status && /network|red\b|conexi[oó]n|timeout|abort/i.test(e)) return 'sin-red';
  return 'sin-cerebro';
}

/** ¿Vale la pena repetir el pedido por JSON? Un 429 no (ya esperó lo que pidió el servidor y gastaría otro turno). */
export function reintentarFallo(r: IntentoFallido): boolean {
  return clasificarFallo(r) !== 'rapido';
}

/** Un texto corto, en una línea, para la miga (el saneador de lib/reporte tapa lo sensible al mandarla). */
function corto(v: unknown, max = 60): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function intento(r: IntentoFallido | null | undefined): string {
  if (!r) return '-';
  const partes = [r.status ? `HTTP ${r.status}` : '', r.codigo ? `código ${corto(r.codigo, 30)}` : '', r.via ? `vía ${corto(r.via, 30)}` : '', r.error ? `«${corto(r.error)}»` : ''].filter(Boolean);
  return partes.join(' ') || 'sin respuesta';
}

export type FalloTurno = {
  /** Lo que la mesa terminó diciendo. */
  dijo: ClaseFallo | 'hilo';
  /** El id de la frase (lib/api.ts nuevoIdTurno): el mismo en la línea del servidor. */
  idTurno: string;
  /** Desde que salió el turno. */
  ms: number;
  /** Por qué cayó el stream (su mensaje de error), si se intentó. */
  stream?: string | null;
  /** El último intento por JSON y cuántos hubo. */
  json?: IntentoFallido | null;
  intentosJson?: number;
};

/** La miga del turno fallido. Solo errores y números: nada de lo que dijo la persona ni de la respuesta. */
export function migaFalloTurno(f: FalloTurno): string {
  const partes = [`mesa: turno sin respuesta → ${f.dijo} (id …${corto(f.idTurno, 64).slice(-12)}, ${(Math.max(0, f.ms) / 1000).toFixed(1)} s)`];
  if (f.stream !== undefined) partes.push(`stream: ${f.stream ? `«${corto(f.stream)}»` : 'no se intentó'}`);
  if (f.json || f.intentosJson) partes.push(`json×${f.intentosJson ?? 1}: ${intento(f.json)}`);
  return partes.join(' · ');
}
