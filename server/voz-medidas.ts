/**
 * LA COMPARACIÓN DE LOS DOS CAMINOS DE LA LLAMADA (docs/voz/SPEECH-ENGINE.md).
 *
 * Una medida por turno hablado, del camino de siempre (agente de ElevenLabs → /api/voz/llm) y del
 * prototipo de Speech Engine (server/voz-motor.ts), con los MISMOS campos y medidos en el MISMO sitio (la
 * ruta del LLM propio, server/voz-agente.ts, que los dos caminos comparten): así la comparación es de
 * manzanas con manzanas. NADA de contenido: ni lo que dijo la persona ni lo que contestó AURA, ni su
 * correo; solo tiempos, banderas y categorías (por dónde contestó el cerebro).
 *
 *  · primerTextoMs: desde que llegó el turno hasta que el primer texto salió hacia la voz (la frase de
 *    espera cuenta: es lo primero que se oye). Es lo que el servidor puede medir del «primer audio»; el
 *    tiempo de red y de voz de ElevenLabs se mira en sus métricas por turno (scripts/voz-comparar-eleven.ts).
 *  · cerebroMs: hasta lo primero del cerebro (sin la frase de espera).
 *  · interrupcion: 'nativa' si el camino lo supo por un evento suyo (Speech Engine: llegó un turno con
 *    `event_id` mayor mientras el anterior seguía saliendo), 'inferida' si se dedujo (el corte de la
 *    conexión o la respuesta recortada en el historial). null: este turno no cortó a ninguno.
 *  · repetido: un reintento de la misma frase que se enganchó al turno en curso, o un evento duplicado.
 *  · asentimiento: «ajá», «mjm» mientras AURA hablaba (no se tomó como interrupción), o un turno en el
 *    que la persona solo asintió. No es una respuesta: no cuenta para el mínimo ni para los percentiles.
 *  · respaldo: contestó el cerebro de respaldo (la vía o el proveedor lo dicen).
 *
 * LA COMPARACIÓN ES HONESTA (claseTurno, veredicto): solo las respuestas completas del cerebro principal
 * cuentan como respuestas y alimentan los percentiles del primer audio; asentimientos, cortados, solo la
 * frase de espera, vacíos, errores, respaldos, tardes y repetidos se cuentan aparte, y los fallos cuentan EN
 * CONTRA. Sin la evidencia mínima por camino y por red el veredicto es «insuficiente». Y SOLO INFORMA.
 *
 * Vive en memoria (las últimas MAX_MEDIDAS) y, solo mientras el motor está encendido (la prueba A/B) y hay
 * S3, se guarda cada GUARDAR_MS: un redespliegue a mitad de la prueba no la borra. Con el motor apagado no
 * se escribe ni se lee nada fuera del proceso.
 */
import { s3GetJson, s3Listo, s3PutJson } from '../lib/s3';
import { esAsentimiento } from './voz-asentir';

export type MotorVoz = 'agente' | 'speech-engine';
export type Interrupcion = 'nativa' | 'inferida' | null;

export type MedidaTurnoVoz = {
  motor: MotorVoz;
  /** Cuándo (ms). */
  t: number;
  /** Huella corta de la conversación (para contar llamadas), no su id. */
  conv: string;
  primerTextoMs: number | null;
  cerebroMs: number | null;
  totalMs: number;
  /** Se dijo una frase de espera (el cerebro tardó). */
  puente: boolean;
  interrupcion: Interrupcion;
  repetido: boolean;
  asentimiento: boolean;
  respaldo: boolean;
  error: boolean;
  /** Se pasó del tope del turno y pidió perdón. */
  tarde: boolean;
  /** Lo cortaron antes de terminar (otro turno o la persona). */
  cortado: boolean;
  /** La etiqueta de red que puso el dueño para esta tanda (wifi, 4g…); '' sin etiqueta. */
  red: string;
};

/** Lo que mide la ruta del LLM propio (server/voz-agente.ts); el motor y la red los pone quien la llama. */
export type MedidaRuta = Omit<MedidaTurnoVoz, 'motor' | 'red' | 't' | 'asentimiento'> & { t?: number; asentimiento?: boolean };

export const MAX_MEDIDAS = 5_000;
export const GUARDAR_MS = 30_000;
const CLAVE_S3 = 'aura/voz-comparacion.json';
/** Lo mínimo por camino (y por red) para decidir: la guía de muestras de la auditoría (≥20 turnos). */
export const MIN_TURNOS = 20;

let medidas: MedidaTurnoVoz[] = [];
/** Los ejercicios a propósito (anotarEjercicioVoz), con las medidas en el mismo guardado. */
let ejercicios: EjercicioVoz[] = [];
let red = '';
let cargado = false;
let cargando: Promise<void> | null = null;
let sucio = false;
let reloj: ReturnType<typeof setTimeout> | null = null;

/** Se guarda (y se lee) en S3 solo durante la prueba: motor encendido (AURA_MOTOR_VOZ) y S3 configurado. */
const conS3 = () => s3Listo() && String(process.env.AURA_MOTOR_VOZ || '').trim().toLowerCase() === 'speech-engine';

/** Lo que el camino de Speech Engine le cuenta a la ruta de cada turno suyo (la petición es interna). */
const extras = new WeakMap<object, { motor: MotorVoz; interrupcion?: Interrupcion; asentimiento?: boolean; repetido?: boolean }>();

/** El adaptador de Speech Engine marca SU petición interna: la ruta sabe de qué camino es el turno. */
export function marcarMotor(req: object, e: { motor: MotorVoz; interrupcion?: Interrupcion; asentimiento?: boolean; repetido?: boolean }) {
  extras.set(req, e);
}

function cargar(): Promise<void> {
  if (cargado || !conS3()) {
    cargado = true;
    return Promise.resolve();
  }
  if (!cargando)
    cargando = s3GetJson(CLAVE_S3)
      .then((r) => {
        if (r.ok && Array.isArray(r.json?.medidas)) medidas = [...r.json.medidas.filter(valida), ...medidas].slice(-MAX_MEDIDAS);
        if (r.ok && Array.isArray(r.json?.ejercicios)) ejercicios = [...r.json.ejercicios.filter(ejercicioValido), ...ejercicios].slice(-MAX_EJERCICIOS);
        if (r.ok && typeof r.json?.red === 'string' && !red) red = r.json.red;
      })
      .catch(() => undefined)
      .finally(() => {
        cargado = true;
        cargando = null;
      });
  return cargando;
}

function valida(m: any): m is MedidaTurnoVoz {
  return !!m && (m.motor === 'agente' || m.motor === 'speech-engine') && Number.isFinite(m.t) && Number.isFinite(m.totalMs);
}

function programarGuardado() {
  sucio = true;
  if (reloj || !conS3()) return;
  reloj = setTimeout(() => {
    reloj = null;
    if (!sucio) return;
    sucio = false;
    void cargar()
      .then(() => s3PutJson(CLAVE_S3, { medidas: medidas.slice(-MAX_MEDIDAS), red, ejercicios: ejercicios.slice(-MAX_EJERCICIOS) }))
      .catch(() => undefined);
  }, GUARDAR_MS);
  reloj.unref?.();
}

export function anotarTurnoVoz(m: Omit<MedidaTurnoVoz, 'red'> & { red?: string }) {
  void cargar();
  const limpia: MedidaTurnoVoz = {
    motor: m.motor === 'speech-engine' ? 'speech-engine' : 'agente',
    t: Number.isFinite(m.t) ? m.t : Date.now(),
    conv: String(m.conv || '').slice(0, 12),
    primerTextoMs: numeroONulo(m.primerTextoMs),
    cerebroMs: numeroONulo(m.cerebroMs),
    totalMs: Math.max(0, Math.round(Number(m.totalMs) || 0)),
    puente: !!m.puente,
    interrupcion: m.interrupcion === 'nativa' || m.interrupcion === 'inferida' ? m.interrupcion : null,
    repetido: !!m.repetido,
    asentimiento: !!m.asentimiento,
    respaldo: !!m.respaldo,
    error: !!m.error,
    tarde: !!m.tarde,
    cortado: !!m.cortado,
    red: String(m.red ?? red).slice(0, 24),
  };
  medidas.push(limpia);
  if (medidas.length > MAX_MEDIDAS) medidas = medidas.slice(-MAX_MEDIDAS);
  programarGuardado();
}

const numeroONulo = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/**
 * La medida de un turno de la ruta del LLM propio: el camino es el de siempre salvo que el adaptador de
 * Speech Engine haya marcado la petición (marcarMotor), y entonces suma lo que solo él sabe.
 */
export function anotarDesdeRuta(req: object, m: MedidaRuta) {
  const e = extras.get(req);
  anotarTurnoVoz({
    ...m,
    t: m.t ?? Date.now(),
    motor: e?.motor ?? 'agente',
    // La interrupción nativa la sabe el adaptador; si él no la vio, vale la inferida de la ruta.
    interrupcion: e?.interrupcion ?? m.interrupcion,
    // Un turno en el que la persona solo asintió («ajá», «sí») no es una pregunta: lo que conteste AURA no es
    // una respuesta comparable. Se mira aquí, en el sitio que comparten los dos caminos; lo dicho no se guarda.
    asentimiento: !!(e?.asentimiento || m.asentimiento || soloAsintio(req)),
    repetido: !!(e?.repetido || m.repetido),
  });
}

/** ¿La última frase de la persona en la petición (formato OpenAI de /api/voz/llm) es solo asentir? */
function soloAsintio(req: any): boolean {
  try {
    const msgs: any[] = Array.isArray(req?.body?.messages) ? req.body.messages : [];
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]?.role === 'user') return esAsentimiento(typeof msgs[i].content === 'string' ? msgs[i].content : '');
  } catch {
    /* sin petición legible: no se sabe, no se marca */
  }
  return false;
}

/** El dueño etiqueta la tanda que sigue («wifi», «4g»): las medidas nuevas la llevan. '' la quita. */
export function fijarRedVoz(r: unknown): string {
  red = String(r ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24);
  programarGuardado();
  return red;
}

export function redVoz(): string {
  return red;
}

/** El percentil (rango más cercano) de una lista; null sin datos. */
export function percentil(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const i = Math.min(o.length - 1, Math.max(0, Math.ceil((p / 100) * o.length) - 1));
  return o[i];
}

/**
 * Qué fue un turno, para la comparación. Solo `completo` es una RESPUESTA comparable: llegó el cerebro
 * principal (no el de respaldo), sin error, a tiempo, sin que la cortaran, y la persona no solo asintió.
 * Lo demás se cuenta aparte; y lo que es un fallo del camino (error, respaldo, repetido, tarde, vacío, solo
 * la frase de espera, sin cerebro) cuenta EN CONTRA de ese camino (las regresiones del veredicto).
 */
export type ClaseTurno = 'completo' | 'repetido' | 'asentimiento' | 'error' | 'respaldo' | 'tarde' | 'cortado' | 'vacio' | 'soloEspera' | 'sinCerebro';

export function claseTurno(m: MedidaTurnoVoz): ClaseTurno {
  if (m.repetido) return 'repetido';
  if (m.asentimiento) return 'asentimiento';
  if (m.error) return 'error';
  if (m.respaldo) return 'respaldo';
  if (m.tarde) return 'tarde';
  if (m.cortado) return 'cortado';
  // Nada salió hacia la voz.
  if (m.primerTextoMs === null) return 'vacio';
  // Salió algo, pero no del cerebro: solo la frase de espera, o una frase nuestra («se me fue el hilo»).
  if (m.cerebroMs === null) return m.puente ? 'soloEspera' : 'sinCerebro';
  return 'completo';
}

/** Lo que se cuenta aparte (por su clase; cada turno en una sola). */
export type Excluidos = { asentimientos: number; cortados: number; soloEspera: number; vacios: number; errores: number; respaldos: number; tardes: number; repetidos: number; sinCerebro: number };
const CLAVE_EXCLUIDO: Record<Exclude<ClaseTurno, 'completo'>, keyof Excluidos> = {
  asentimiento: 'asentimientos',
  cortado: 'cortados',
  soloEspera: 'soloEspera',
  vacio: 'vacios',
  error: 'errores',
  respaldo: 'respaldos',
  tarde: 'tardes',
  repetido: 'repetidos',
  sinCerebro: 'sinCerebro',
};
/** Lo que, si a Speech Engine le pasa más (en proporción), bloquea «adoptar». Los cortados no: los corta la persona. */
export const REGRESIONES = ['errores', 'respaldos', 'repetidos', 'tardes', 'vacios', 'soloEspera', 'sinCerebro'] as const;

/* ------------------------------------------------------------------ los ejercicios a propósito */

/**
 * Lo que José hace a propósito en cada camino (docs/voz/SPEECH-ENGINE.md §5, paso 4) y si salió bien: una
 * interrupción (le habló encima: ¿se calló y siguió con lo nuevo, sin repetir?) o un asentimiento («ajá»
 * mientras hablaba: ¿siguió sin cortarse?). El servidor no puede verlos todos (en el camino del agente,
 * ElevenLabs se traga el «ajá» y nunca llega), así que se anotan (POST /api/voz/comparacion/ejercicio).
 */
export type EjercicioVoz = { motor: MotorVoz; tipo: 'interrupcion' | 'asentimiento'; bien: boolean; t: number; red: string };
export const MAX_EJERCICIOS = 1_000;

/** Anota un ejercicio (con la red de la tanda actual). null si no es válido: sin decir si salió bien, no cuenta. */
export function anotarEjercicioVoz(e: any): EjercicioVoz | null {
  if (!e || (e.motor !== 'agente' && e.motor !== 'speech-engine') || (e.tipo !== 'interrupcion' && e.tipo !== 'asentimiento') || typeof e.bien !== 'boolean') return null;
  void cargar();
  const limpio: EjercicioVoz = { motor: e.motor, tipo: e.tipo, bien: e.bien, t: Number.isFinite(e.t) ? e.t : Date.now(), red: String(e.red ?? red).slice(0, 24) };
  ejercicios.push(limpio);
  if (ejercicios.length > MAX_EJERCICIOS) ejercicios = ejercicios.slice(-MAX_EJERCICIOS);
  programarGuardado();
  return limpio;
}

function ejercicioValido(e: any): e is EjercicioVoz {
  return !!e && (e.motor === 'agente' || e.motor === 'speech-engine') && (e.tipo === 'interrupcion' || e.tipo === 'asentimiento') && typeof e.bien === 'boolean' && Number.isFinite(e.t);
}

/* ------------------------------------------------------------------ el resumen y la regla */

/** La evidencia mínima por camino Y por red antes de decir algo que no sea «insuficiente». */
export const MIN_INTERRUPCIONES = 5;
export const MIN_ASENTIMIENTOS = 5;
/** Bloques alternos (A-B-A-B) en el tiempo: que la hora o el día no sesguen la comparación. */
export const MIN_BLOQUES = 4;
/** El margen para que «mejor» no sea ruido: en p50 Y en p95, al menos 150 ms Y al menos el 10 %. */
export const MARGEN_MS = 150;
export const MARGEN_RELATIVO = 0.1;

const tasa = (n: number, de: number) => (de ? n / de : 0);

export type ResumenCamino = {
  /** Todo lo anotado (respuestas o no). */
  turnos: number;
  /** Las respuestas comparables: las únicas que cuentan para el mínimo y para los percentiles. */
  completos: number;
  conversaciones: number;
  /** El primer audio y el cerebro, SOLO de las respuestas comparables. */
  primerTexto: { p50: number | null; p95: number | null };
  cerebro: { p50: number | null; p95: number | null };
  excluidos: Excluidos;
  puentes: number;
  /** Las que vio el servidor (en cualquier turno): para mirar; la regla usa los ejercicios a propósito. */
  interrupciones: { nativas: number; inferidas: number; total: number };
  ejercicios: { interrupciones: { hechas: number; bien: number }; asentimientos: { hechas: number; bien: number } };
  repetidos: number;
  asentimientos: number;
  respaldos: number;
  errores: number;
  tardes: number;
  cortados: number;
};

export function resumir(ms: MedidaTurnoVoz[], ej: EjercicioVoz[] = []): ResumenCamino {
  const excluidos: Excluidos = { asentimientos: 0, cortados: 0, soloEspera: 0, vacios: 0, errores: 0, respaldos: 0, tardes: 0, repetidos: 0, sinCerebro: 0 };
  const completos: MedidaTurnoVoz[] = [];
  for (const m of ms) {
    const c = claseTurno(m);
    if (c === 'completo') completos.push(m);
    else excluidos[CLAVE_EXCLUIDO[c]]++;
  }
  const pt = completos.map((m) => m.primerTextoMs).filter((x): x is number => x !== null);
  const cb = completos.map((m) => m.cerebroMs).filter((x): x is number => x !== null);
  const nativas = ms.filter((m) => m.interrupcion === 'nativa').length;
  const inferidas = ms.filter((m) => m.interrupcion === 'inferida').length;
  const de = (tipo: EjercicioVoz['tipo']) => {
    const xs = ej.filter((e) => e.tipo === tipo);
    return { hechas: xs.length, bien: xs.filter((e) => e.bien).length };
  };
  return {
    turnos: ms.length,
    completos: completos.length,
    conversaciones: new Set(ms.map((m) => m.conv).filter(Boolean)).size,
    primerTexto: { p50: percentil(pt, 50), p95: percentil(pt, 95) },
    cerebro: { p50: percentil(cb, 50), p95: percentil(cb, 95) },
    excluidos,
    puentes: ms.filter((m) => m.puente).length,
    interrupciones: { nativas, inferidas, total: nativas + inferidas },
    ejercicios: { interrupciones: de('interrupcion'), asentimientos: de('asentimiento') },
    repetidos: ms.filter((m) => m.repetido).length,
    asentimientos: ms.filter((m) => m.asentimiento).length,
    respaldos: ms.filter((m) => m.respaldo).length,
    errores: ms.filter((m) => m.error).length,
    tardes: ms.filter((m) => m.tarde).length,
    cortados: ms.filter((m) => m.cortado).length,
  };
}

/** Cuántos tramos seguidos del mismo camino hay, en orden de tiempo (A-B-A-B = 4), entre las respuestas comparables. */
export function contarBloques(ms: MedidaTurnoVoz[]): number {
  const o = ms.filter((m) => claseTurno(m) === 'completo').sort((a, b) => a.t - b.t);
  let n = 0;
  for (let i = 0; i < o.length; i++) if (i === 0 || o[i].motor !== o[i - 1].motor) n++;
  return n;
}

/** ¿`nuevo` es mejor que `actual` por más que el ruido? (menos es mejor; los dos márgenes a la vez). */
export function mejorClaro(actual: number | null, nuevo: number | null): boolean {
  if (actual === null || nuevo === null) return false;
  return actual - nuevo >= Math.max(MARGEN_MS, MARGEN_RELATIVO * actual);
}

export type EstadoVeredicto = 'insuficiente' | 'adoptar' | 'mantener';
export type Veredicto = {
  estado: EstadoVeredicto;
  adoptar: boolean;
  suficientes: boolean;
  /** Lo que falta para poder decidir (vacío si hay evidencia). */
  faltan: string[];
  /** Por qué no se adopta, con evidencia (vacío si se adopta o si falta evidencia). */
  motivos: string[];
  primerTextoP50Mejor: boolean;
  primerTextoP95Mejor: boolean;
  interrupcionesIgualOMas: boolean;
  asentimientosIgualOMas: boolean;
  regresiones: string[];
  /** Solo informa: nunca enciende ni apaga nada. */
  consultivo: true;
};

const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * La regla acordada con José, honesta, para UNA red. Primero la evidencia mínima por camino (≥ MIN_TURNOS
 * respuestas comparables, ≥ MIN_INTERRUPCIONES interrupciones y ≥ MIN_ASENTIMIENTOS asentimientos a
 * propósito) y en bloques alternos; sin eso, «insuficiente» y qué falta. Con evidencia, se adopta SOLO si el
 * primer audio de las respuestas comparables es mejor en p50 Y en p95 por más que el margen, atiende las
 * interrupciones a propósito y aguanta los asentimientos al menos como el agente (en tasa), y no empeora
 * nada (REGRESIONES, en proporción a los turnos que esperaban respuesta). Si no, «mantener» (el agente).
 */
export function veredicto(ag: ResumenCamino, se: ResumenCamino, bloques: number): Veredicto {
  const faltan: string[] = [];
  for (const [motor, r] of [['agente', ag], ['speech-engine', se]] as const) {
    if (r.completos < MIN_TURNOS) faltan.push(`${motor}: faltan ${MIN_TURNOS - r.completos} turnos comparables (hay ${r.completos} de ${MIN_TURNOS})`);
    const fi = MIN_INTERRUPCIONES - r.ejercicios.interrupciones.hechas;
    if (fi > 0) faltan.push(`${motor}: faltan ${cuantos(fi, 'interrupción', 'interrupciones')} a propósito`);
    const fa = MIN_ASENTIMIENTOS - r.ejercicios.asentimientos.hechas;
    if (fa > 0) faltan.push(`${motor}: faltan ${cuantos(fa, 'asentimiento', 'asentimientos')} a propósito`);
  }
  if (bloques < MIN_BLOQUES) faltan.push(`faltan bloques alternos A-B-A-B (hay ${bloques} de ${MIN_BLOQUES}): que la hora no sesgue`);
  const p50 = mejorClaro(ag.primerTexto.p50, se.primerTexto.p50);
  const p95 = mejorClaro(ag.primerTexto.p95, se.primerTexto.p95);
  const tasaEj = (r: ResumenCamino, k: 'interrupciones' | 'asentimientos') => tasa(r.ejercicios[k].bien, r.ejercicios[k].hechas);
  const interrupciones = tasaEj(se, 'interrupciones') >= tasaEj(ag, 'interrupciones');
  const asentimientos = tasaEj(se, 'asentimientos') >= tasaEj(ag, 'asentimientos');
  // Lo que esperaba respuesta: todo menos los «ajá».
  const esperaban = (r: ResumenCamino) => r.turnos - r.excluidos.asentimientos;
  const regresiones: string[] = REGRESIONES.filter((k) => tasa(se.excluidos[k], esperaban(se)) > tasa(ag.excluidos[k], esperaban(ag)));
  const suficientes = !faltan.length;
  const motivos: string[] = [];
  if (suficientes) {
    if (!p50) motivos.push(`primer audio p50 sin mejora clara (agente ${ag.primerTexto.p50} ms, speech-engine ${se.primerTexto.p50} ms)`);
    if (!p95) motivos.push(`primer audio p95 sin mejora clara (agente ${ag.primerTexto.p95} ms, speech-engine ${se.primerTexto.p95} ms)`);
    if (!interrupciones) motivos.push('atiende peor las interrupciones a propósito');
    if (!asentimientos) motivos.push('se corta con más asentimientos a propósito');
    for (const k of regresiones) motivos.push(`más ${k} que el agente (en proporción)`);
  }
  const adoptar = suficientes && !motivos.length;
  return {
    estado: !suficientes ? 'insuficiente' : adoptar ? 'adoptar' : 'mantener',
    adoptar,
    suficientes,
    faltan,
    motivos,
    primerTextoP50Mejor: p50,
    primerTextoP95Mejor: p95,
    interrupcionesIgualOMas: interrupciones,
    asentimientosIgualOMas: asentimientos,
    regresiones,
    consultivo: true,
  };
}

/** El veredicto de toda la prueba: cada red tiene que tener su evidencia y pasar la regla (las redes no se suman). */
export function combinarVeredictos(porRed: Record<string, Veredicto>): Veredicto {
  const redes = Object.entries(porRed);
  const conRed = (f: (v: Veredicto) => string[]) => redes.flatMap(([r, v]) => f(v).map((x) => `${r}: ${x}`));
  const faltan = redes.length ? conRed((v) => v.faltan) : ['no hay medidas en esta ventana'];
  const motivos = faltan.length ? [] : conRed((v) => v.motivos);
  const todas = (f: (v: Veredicto) => boolean) => redes.length > 0 && redes.every(([, v]) => f(v));
  const adoptar = !faltan.length && !motivos.length;
  return {
    estado: faltan.length ? 'insuficiente' : adoptar ? 'adoptar' : 'mantener',
    adoptar,
    suficientes: !faltan.length,
    faltan,
    motivos,
    primerTextoP50Mejor: todas((v) => v.primerTextoP50Mejor),
    primerTextoP95Mejor: todas((v) => v.primerTextoP95Mejor),
    interrupcionesIgualOMas: todas((v) => v.interrupcionesIgualOMas),
    asentimientosIgualOMas: todas((v) => v.asentimientosIgualOMas),
    regresiones: [...new Set(redes.flatMap(([, v]) => v.regresiones))],
    consultivo: true,
  };
}

export const AVISO_CONSULTIVO = 'Solo informa: este veredicto no enciende ni apaga nada. Encender o apagar el motor (AURA_MOTOR_VOZ y el interruptor por cuenta) lo decide José.';

/** Una red (o todo junto, para mirar): los dos caminos, sus bloques y su veredicto. */
function compararTramo(ms: MedidaTurnoVoz[], ej: EjercicioVoz[]) {
  const de = <T extends { motor: MotorVoz }>(xs: T[], motor: MotorVoz) => xs.filter((x) => x.motor === motor);
  const agente = resumir(de(ms, 'agente'), de(ej, 'agente'));
  const se = resumir(de(ms, 'speech-engine'), de(ej, 'speech-engine'));
  const bloques = contarBloques(ms);
  return { agente, 'speech-engine': se, bloques, veredicto: veredicto(agente, se, bloques) };
}

/**
 * La comparación entera: por etiqueta de red (cada red se decide por separado) y el total (los dos caminos
 * sumados, para mirar; su veredicto es el de todas las redes a la vez). `desde`/`hasta` en ms. SOLO INFORMA:
 * no cambia el motor, ni el interruptor, ni nada.
 */
export async function comparacionVoz(o: { desde?: number; hasta?: number } = {}) {
  await cargar();
  const enVentana = (t: number) => (!o.desde || t >= o.desde) && (!o.hasta || t <= o.hasta);
  const ms = medidas.filter((m) => enVentana(m.t));
  const ej = ejercicios.filter((e) => enVentana(e.t));
  const redes = [...new Set([...ms.map((m) => m.red), ...ej.map((e) => e.red)])];
  const porRed = Object.fromEntries(
    redes.map((r) => [
      r || 'sin-etiqueta',
      compararTramo(
        ms.filter((m) => m.red === r),
        ej.filter((e) => e.red === r)
      ),
    ])
  );
  const todo = compararTramo(ms, ej);
  return {
    total: {
      agente: todo.agente,
      'speech-engine': todo['speech-engine'],
      bloques: todo.bloques,
      veredicto: combinarVeredictos(Object.fromEntries(Object.entries(porRed).map(([r, x]) => [r, x.veredicto]))),
    },
    porRed,
    redActual: red,
    minimoPorCamino: MIN_TURNOS,
    minimos: { turnosComparables: MIN_TURNOS, interrupciones: MIN_INTERRUPCIONES, asentimientos: MIN_ASENTIMIENTOS, bloques: MIN_BLOQUES },
    margen: { ms: MARGEN_MS, relativo: MARGEN_RELATIVO },
    consultivo: true,
    aviso: AVISO_CONSULTIVO,
  };
}

/** Solo pruebas. */
export function _reiniciarMedidas() {
  medidas = [];
  ejercicios = [];
  red = '';
  cargado = true;
  sucio = false;
  if (reloj) clearTimeout(reloj);
  reloj = null;
}
export function _medidas() {
  return medidas;
}
export function _ejercicios() {
  return ejercicios;
}
