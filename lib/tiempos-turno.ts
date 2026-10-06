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
  /**
   * El tamaño de lo que se le mandó al modelo que contestó (José, 6-oct: «primera ficha» 905 → 2023 ms de un día a
   * otro y no se sabía si era el prompt o el proveedor): caracteres del system y los mensajes, y de las herramientas.
   */
  prompt?: { car: number; herramientas?: number; herramientasCar?: number };
  /** Quién contestó de verdad: `bedrock` (el principal o el de respaldo) o `nodo` (el Qwen de la A10G). */
  proveedor?: string;
  modelo?: string;
  /** Contestó el de respaldo porque el principal no dio su primera señal a tiempo (o falló). */
  respaldo?: boolean;
  /** `charla`: la charla hablada fue primero al cerebro rápido (lib/cerebro-rapido.ts planDeModelos). */
  ruta?: 'charla' | 'manos';
  /** Cuándo salió la frase de espera honesta (Bedrock no contestó y el turno hablado pasó al Qwen del nodo). */
  esperaLenta?: number;
};

/**
 * Fichas estimadas de un texto: ~3,2 caracteres por ficha. Medido el 6-oct con el pedido real de un turno hablado
 * (español, con las herramientas en JSON): 30 328 caracteres → 9 473 fichas en GLM-5 y 9 339 en Kimi K2.5 (Bedrock).
 */
export const CARACTERES_POR_FICHA = 3.2;
export function fichasEstimadas(caracteres: number): number {
  return Math.ceil(Math.max(0, caracteres) / CARACTERES_POR_FICHA);
}

const ms = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '—' : `${Math.max(0, Math.round(n))} ms`);
/** Un nombre de herramienta: la primera palabra, acotada (si viniera con argumentos, no salen). */
const nombre = (s: string) =>
  String(s || '')
    .trim()
    .split(/\s/)[0]
    .replace(/[^\w.-]/g, '')
    .slice(0, 24) || '?';

/** El id de un modelo (sin espacios ni nada raro): `zai.glm-5`, `moonshotai.kimi-k2.5`, `orcarouter/Qwen3.8-27B`. */
const nombreModelo = (s?: string) =>
  String(s || '')
    .trim()
    .replace(/[^\w.:/-]/g, '')
    .slice(0, 60);

/** La línea del log: `[mesa] turno <id>: preparado … · primera ficha … · primer texto … · modelo … · … · total …`. */
export function lineaTiemposTurno(id: string, m: MedidaTurno, ahora = Date.now()): string {
  const desde = (t?: number) => (t ? ms(t - m.inicio) : '—');
  const partes = [`preparado ${desde(m.preparado)}`, `primera ficha ${desde(m.primeraFicha)}`, `primer texto ${desde(m.primerTexto)}`, `modelo ${ms(m.modeloMs)}`];
  if (m.esperaLenta) partes.push(`frase de espera ${desde(m.esperaLenta)}`);
  if (m.herramientas.length || m.harnessMs !== undefined) {
    const lista = m.herramientas.map((h) => (h.ms === undefined ? nombre(h.nombre) : `${nombre(h.nombre)} ${ms(h.ms)}`)).join(', ') || 'ninguna';
    partes.push(`herramientas ${lista}${m.harnessMs !== undefined ? ` (harness ${ms(m.harnessMs)})` : ''}`);
  }
  if (m.correccion === 'repregunta') partes.push(`re-pregunta ${ms(m.repreguntaMs)}`);
  else if (m.correccion === 'local') partes.push('promesa corregida sin re-pregunta');
  if (m.tope) partes.push(`voz ${m.tope.dicho}/${m.tope.total} car.`);
  if (m.prompt) {
    const total = m.prompt.car + (m.prompt.herramientasCar || 0);
    const herr = m.prompt.herramientas ? ` (${m.prompt.herramientas} herr. ${m.prompt.herramientasCar || 0} car.)` : '';
    partes.push(`prompt ${total} car. ~${fichasEstimadas(total)} fichas${herr}`);
  }
  if (m.proveedor || m.modelo) partes.push(`por ${[m.proveedor, nombreModelo(m.modelo)].filter(Boolean).join(' ')}${m.ruta === 'charla' ? ' (charla)' : ''}${m.respaldo ? ' (respaldo)' : ''}`);
  partes.push(`total ${ms(ahora - m.inicio)}`);
  return `[${m.camino || 'mesa'}] turno ${String(id || '').slice(0, 8)}${m.hablado ? ' (hablado)' : ''}: ${partes.join(' · ')}`;
}
