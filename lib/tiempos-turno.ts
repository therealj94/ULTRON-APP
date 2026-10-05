/**
 * DÓNDE SE VAN LOS SEGUNDOS DE UN TURNO DE LA MESA (José, 5-oct, APK 5.3.0: «contestó con voz 7479 ms después
 * de la frase» y «la voz aún siento poco lenta»). La conversación de voz ya deja su línea por turno
 * (server/voz-agente.ts: `[voz] turno …: primer texto … · cerebro … · total …`); la mesa del teléfono no dejaba
 * nada y no se sabía si el tiempo era de preparar, del modelo, de una herramienta o de la segunda vuelta de
 * «prometió sin herramienta».
 *
 * Una línea por turno, sin NADA de lo que dijo la persona ni de lo que contestó: solo tiempos, los nombres de
 * las herramientas que corrieron y cómo se corrigió una promesa. Va al log del servidor (Render).
 */

export type MedidaTurno = {
  /** Cuándo empezó el turno en el servidor (ms de época). */
  inicio: number;
  /** Terminó de preparar (memoria, clasificación, hechos, prompt). */
  preparado?: number;
  /** Llegó el primer trozo del modelo (texto o pedido de herramienta). */
  primeraFicha?: number;
  /** Salió el primer texto hacia la voz o la pantalla. */
  primerTexto?: number;
  /** Lo que tardó la primera llamada al modelo, de punta a punta (Bedrock y, si falló, el nodo). */
  modeloMs?: number;
  /** El harness entero (herramientas y las vueltas del modelo que las cuentan). */
  harnessMs?: number;
  /** Las herramientas que corrieron, con lo que tardó cada una (solo el nombre: nunca sus argumentos). */
  herramientas: { nombre: string; ms?: number }[];
  /** La segunda vuelta de «prometió sin herramienta» (solo si se hizo). */
  repreguntaMs?: number;
  /** Cómo se corrigió una promesa sin herramienta: con una segunda vuelta o aquí mismo, sin red. */
  correccion?: 'repregunta' | 'local';
  /** Lo que se dijo en voz con tope (caracteres dichos de los que tenía la respuesta). */
  tope?: { dicho: number; total: number };
  /** Turno dictado por voz (con los topes de la voz). */
  hablado?: boolean;
  /** `llamada`: el turno vino de la conversación de voz (server/voz-agente.ts, que ya deja su `[voz] turno`). */
  camino?: 'mesa' | 'llamada';
};

const ms = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '—' : `${Math.max(0, Math.round(n))} ms`);
/** Un nombre de herramienta: la primera palabra, acotada (si viniera con argumentos, no salen). */
const nombre = (s: string) =>
  String(s || '')
    .trim()
    .split(/\s/)[0]
    .replace(/[^\w.-]/g, '')
    .slice(0, 24) || '?';

/** La línea del log: `[mesa] turno <id>: preparado … · primera ficha … · primer texto … · modelo … · … · total …`. */
export function lineaTiemposTurno(id: string, m: MedidaTurno, ahora = Date.now()): string {
  const desde = (t?: number) => (t ? ms(t - m.inicio) : '—');
  const partes = [`preparado ${desde(m.preparado)}`, `primera ficha ${desde(m.primeraFicha)}`, `primer texto ${desde(m.primerTexto)}`, `modelo ${ms(m.modeloMs)}`];
  if (m.herramientas.length || m.harnessMs !== undefined) {
    const lista = m.herramientas.map((h) => (h.ms === undefined ? nombre(h.nombre) : `${nombre(h.nombre)} ${ms(h.ms)}`)).join(', ') || 'ninguna';
    partes.push(`herramientas ${lista}${m.harnessMs !== undefined ? ` (harness ${ms(m.harnessMs)})` : ''}`);
  }
  if (m.correccion === 'repregunta') partes.push(`re-pregunta ${ms(m.repreguntaMs)}`);
  else if (m.correccion === 'local') partes.push('promesa corregida sin re-pregunta');
  if (m.tope) partes.push(`voz ${m.tope.dicho}/${m.tope.total} car.`);
  partes.push(`total ${ms(ahora - m.inicio)}`);
  return `[${m.camino || 'mesa'}] turno ${String(id || '').slice(0, 8)}${m.hablado ? ' (hablado)' : ''}: ${partes.join(' · ')}`;
}
