/**
 * LA COMPARACIÓN DE LOS DOS CAMINOS DE LA LLAMADA (docs/voz/SPEECH-ENGINE.md).
 *
 * Una medida por turno hablado, del camino de siempre (agente de ElevenLabs → /api/voz/llm) y del
 * prototipo de Speech Engine (server/voz-motor.ts), con los MISMOS campos y medidos en el MISMO sitio (la
 * ruta del LLM propio, server/voz-agente.ts, que los dos caminos comparten): así la comparación es de
 * manzanas con manzanas. NADA de contenido: ni lo que dijo la persona ni lo que contestó AURA, ni su
 * correo; solo tiempos, banderas y categorías (por dónde contestó el cerebro).
 *
 *  · primerTextoServidorMs (guardado también como `primerTextoMs`, su nombre de antes): desde que llegó el
 *    turno hasta que el primer TEXTO salió del servidor hacia la voz (la frase de espera cuenta: es lo primero
 *    que se dirá). NO es audio (auditoría del 11-oct, VOZ-04: las razones lo llamaban «primer audio»): la voz
 *    de ElevenLabs y la red vienen después y se miran en sus métricas por turno (scripts/voz-comparar-eleven.ts).
 *  · primerByteAudioMs y primerCuadroSonadoMs: el primer byte de audio y el primer cuadro que de verdad sonó.
 *    El servidor no los ve: quedan en null hasta que alguien los mida (nunca un valor inventado ni copiado
 *    del texto).
 *  · cerebroMs: hasta lo primero del cerebro (sin la frase de espera ni su muletilla): la respuesta de
 *    verdad. La regla lo exige además del primer texto: una frase de espera rápida no tapa un cerebro lento.
 *  · interrupcion: 'nativa' si el camino lo supo por un evento suyo (Speech Engine: llegó un turno con
 *    `event_id` mayor mientras el anterior seguía saliendo), 'inferida' si se dedujo (el corte de la
 *    conexión o la respuesta recortada en el historial). null: este turno no cortó a ninguno.
 *  · repetido: un reintento de la misma frase que se enganchó al turno en curso, o un evento duplicado.
 *  · asentimiento: «ajá», «mjm» mientras AURA hablaba (no se tomó como interrupción), o un turno en el
 *    que la persona solo asintió. No es una respuesta: no cuenta para el mínimo ni para los percentiles.
 *  · respaldo: contestó el cerebro de respaldo (la vía o el proveedor lo dicen).
 *
 * LA COMPARACIÓN ES HONESTA (claseTurno, veredicto): solo las respuestas completas del cerebro principal
 * cuentan como respuestas y alimentan los percentiles del primer texto del servidor; asentimientos, cortados, solo la
 * frase de espera, vacíos, errores, respaldos, tardes y repetidos se cuentan aparte, y los fallos (también
 * los cortados) cuentan EN CONTRA. La respuesta de verdad (cerebroMs) no puede empeorar, y los cortados
 * entran en ella con lo que llevaban esperando. Sin la evidencia mínima por camino y por red (turnos,
 * conversaciones, bloques alternos de verdad, ejercicios) el veredicto es «insuficiente». Y SOLO INFORMA.
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
  /**
   * Cuándo salió el primer TEXTO del servidor hacia la voz (ms desde el turno). No es audio. Opcional en el tipo solo
   * para quien todavía arma medidas con el nombre viejo (server/voz-motor.ts); normalizarMedida lo escribe siempre.
   */
  primerTextoServidorMs?: number | null;
  /**
   * El mismo número con su nombre de antes: así se guardó en S3 y así lo escriben las rutas (server/voz-agente.ts,
   * server/voz-motor.ts). Se lee el que venga y se escriben los dos.
   * @deprecated usar primerTextoServidorMs.
   */
  primerTextoMs: number | null;
  /** El primer byte de AUDIO que salió hacia quien escucha. Sin medir: null (el servidor de hoy no lo ve). */
  primerByteAudioMs?: number | null;
  /** El primer cuadro de audio que de verdad SONÓ en el dispositivo. Sin medir: null. */
  primerCuadroSonadoMs?: number | null;
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

/** Los tiempos que se pueden traer con cualquiera de sus nombres (el viejo, el nuevo) o sin traer (los de audio). */
type TiemposEntrada = { primerTextoMs?: number | null; primerTextoServidorMs?: number | null; primerByteAudioMs?: number | null; primerCuadroSonadoMs?: number | null };
type SinTiempos = Omit<MedidaTurnoVoz, 'primerTextoMs' | 'primerTextoServidorMs' | 'primerByteAudioMs' | 'primerCuadroSonadoMs'>;

/** Lo que mide la ruta del LLM propio (server/voz-agente.ts); el motor y la red los pone quien la llama. */
export type MedidaRuta = Omit<SinTiempos, 'motor' | 'red' | 't' | 'asentimiento'> & TiemposEntrada & { t?: number; asentimiento?: boolean };

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
        // Las guardadas antes del 11-oct solo traen `primerTextoMs`: se normalizan (los dos nombres, el audio en null).
        if (r.ok && Array.isArray(r.json?.medidas)) medidas = [...r.json.medidas.filter((m: any) => Number.isFinite(m?.t)).map(normalizarMedida).filter((m: MedidaTurnoVoz | null): m is MedidaTurnoVoz => !!m), ...medidas].slice(-MAX_MEDIDAS);
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

/**
 * Una medida limpia, venga de una ruta o de lo guardado (con el nombre viejo `primerTextoMs` o el nuevo
 * `primerTextoServidorMs`): se escriben los dos. El primer byte de audio y el primer cuadro sonado solo si alguien
 * los midió de verdad; si no, null. null si no es una medida (sin motor conocido, sin tiempos).
 */
export function normalizarMedida(m: any): MedidaTurnoVoz | null {
  if (!m || (m.motor !== 'agente' && m.motor !== 'speech-engine') || !Number.isFinite(m.totalMs)) return null;
  const primerTexto = numeroONulo(m.primerTextoServidorMs ?? m.primerTextoMs);
  return {
    motor: m.motor,
    t: Number.isFinite(m.t) ? m.t : Date.now(),
    conv: String(m.conv || '').slice(0, 12),
    primerTextoServidorMs: primerTexto,
    primerTextoMs: primerTexto,
    primerByteAudioMs: numeroONulo(m.primerByteAudioMs),
    primerCuadroSonadoMs: numeroONulo(m.primerCuadroSonadoMs),
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
}

export function anotarTurnoVoz(m: Omit<SinTiempos, 'red'> & TiemposEntrada & { red?: string }) {
  void cargar();
  const limpia = normalizarMedida({ ...m, motor: m.motor === 'speech-engine' ? 'speech-engine' : 'agente', totalMs: Number.isFinite(m.totalMs) ? m.totalMs : 0 });
  if (!limpia) return;
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
/** El primer texto del servidor de una medida, con cualquiera de sus dos nombres. */
const primerTextoDe = (m: Partial<MedidaTurnoVoz>): number | null => m.primerTextoServidorMs ?? m.primerTextoMs ?? null;

export type ClaseTurno = 'completo' | 'repetido' | 'asentimiento' | 'error' | 'respaldo' | 'tarde' | 'cortado' | 'vacio' | 'soloEspera' | 'sinCerebro';

export function claseTurno(m: MedidaTurnoVoz): ClaseTurno {
  if (m.repetido) return 'repetido';
  if (m.asentimiento) return 'asentimiento';
  if (m.error) return 'error';
  if (m.respaldo) return 'respaldo';
  if (m.tarde) return 'tarde';
  if (m.cortado) return 'cortado';
  // Nada salió hacia la voz.
  if (primerTextoDe(m) === null) return 'vacio';
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
/**
 * Lo que, si a Speech Engine le pasa más (en proporción), bloquea «adoptar». Los cortados también: si la
 * persona corta más en un camino es, casi siempre, porque tarda (y sin contarlos, los turnos lentos que la
 * persona corta desaparecían de los percentiles). Los cortes de las interrupciones a propósito anotadas se
 * descuentan antes de comparar (cortadosSinEjercicios), y esos ejercicios tienen que estar parejos (R16-3).
 */
export const REGRESIONES = ['errores', 'respaldos', 'repetidos', 'tardes', 'vacios', 'soloEspera', 'sinCerebro', 'cortados'] as const;

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
/** Un bloque cuenta solo con ≥5 respuestas comparables: un cambio de paso suelto (19 A, 1 B, 1 A, 19 B) no alterna. */
export const MIN_TURNOS_BLOQUE = 5;
/**
 * Los ejercicios a propósito, PAREJOS entre caminos (revisión 16, R16-3): de cada tipo, el camino con menos tiene al
 * menos el 80 % de los del otro (±20 %). Si no, los cortes a propósito pesan distinto en cada camino (10 en el agente
 * contra 5 en Speech Engine tapaban 5 cortes de impaciencia) y el veredicto es «insuficiente».
 */
export const EJERCICIOS_PAREJOS = 0.8;
/** Llamadas distintas (con respuestas comparables) por camino y por red: 20 turnos de UNA llamada no son una muestra. */
export const MIN_CONVERSACIONES = 5;
/**
 * El margen para que «mejor» no sea ruido: en p50 Y en p95, al menos 150 ms Y al menos el 10 %. El mismo
 * margen dice cuánto puede empeorar la respuesta de verdad sin que cuente (noPeor).
 */
export const MARGEN_MS = 150;
export const MARGEN_RELATIVO = 0.1;

const tasa = (n: number, de: number) => (de ? n / de : 0);

export type ResumenCamino = {
  /** Todo lo anotado (respuestas o no). */
  turnos: number;
  /** Las respuestas comparables: las únicas que cuentan para el mínimo y para los percentiles. */
  completos: number;
  conversaciones: number;
  /** Las conversaciones con al menos una respuesta comparable: las que cuentan para MIN_CONVERSACIONES. */
  conversacionesComparables: number;
  /** El primer TEXTO del servidor (no audio) y el cerebro, SOLO de las respuestas comparables. */
  primerTextoServidor: { p50: number | null; p95: number | null };
  /** @deprecated el mismo objeto que primerTextoServidor, con su nombre de antes (quien ya lo lee no se rompe). */
  primerTexto: { p50: number | null; p95: number | null };
  /** El primer byte de audio y el primer cuadro sonado: solo de las medidas que de verdad los traen (hoy, ninguna). */
  primerByteAudio: { p50: number | null; p95: number | null; medidas: number };
  primerCuadroSonado: { p50: number | null; p95: number | null; medidas: number };
  cerebro: { p50: number | null; p95: number | null };
  /**
   * La respuesta de verdad (cerebroMs, sin la frase de espera) de las comparables MÁS los cortados: un
   * cortado antes de que hablara el cerebro entra con lo que llevaba esperando (totalMs), una observación
   * censurada (la respuesta habría tardado eso o más: es una cota por debajo). Es la que usa la regla.
   */
  cerebroConCortados: { p50: number | null; p95: number | null; censurados: number };
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
  const pt = completos.map(primerTextoDe).filter((x): x is number => x !== null);
  const deAudio = (k: 'primerByteAudioMs' | 'primerCuadroSonadoMs') => {
    const xs = completos.map((m) => m[k] ?? null).filter((x): x is number => x !== null);
    return { p50: percentil(xs, 50), p95: percentil(xs, 95), medidas: xs.length };
  };
  const primerTexto = { p50: percentil(pt, 50), p95: percentil(pt, 95) };
  const cb = completos.map((m) => m.cerebroMs).filter((x): x is number => x !== null);
  // Los cortados no desaparecen de la latencia: con su cerebro si llegó a hablar, si no con lo que esperaron.
  const cortados = ms.filter((m) => claseTurno(m) === 'cortado');
  const cbc = [...cb, ...cortados.map((m) => m.cerebroMs ?? m.totalMs)];
  const censurados = cortados.filter((m) => m.cerebroMs === null).length;
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
    conversacionesComparables: new Set(completos.map((m) => m.conv).filter(Boolean)).size,
    primerTextoServidor: primerTexto,
    primerTexto,
    primerByteAudio: deAudio('primerByteAudioMs'),
    primerCuadroSonado: deAudio('primerCuadroSonadoMs'),
    cerebro: { p50: percentil(cb, 50), p95: percentil(cb, 95) },
    cerebroConCortados: { p50: percentil(cbc, 50), p95: percentil(cbc, 95), censurados },
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

/**
 * Los bloques alternos de verdad (A-B-A-B), en orden de tiempo, entre las respuestas comparables: los tramos
 * seguidos de un mismo camino con menos de MIN_TURNOS_BLOQUE no cuentan (un cambio de paso suelto no es un
 * bloque), y al quitarlos los tramos vecinos del mismo camino se juntan en uno (con sus respuestas).
 */
export function bloquesAlternos(ms: MedidaTurnoVoz[]): { motor: MotorVoz; ms: MedidaTurnoVoz[] }[] {
  const o = ms.filter((m) => claseTurno(m) === 'completo').sort((a, b) => a.t - b.t);
  const tramos: { motor: MotorVoz; ms: MedidaTurnoVoz[] }[] = [];
  for (const m of o) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo?.motor === m.motor) ultimo.ms.push(m);
    else tramos.push({ motor: m.motor, ms: [m] });
  }
  const bloques: { motor: MotorVoz; ms: MedidaTurnoVoz[] }[] = [];
  for (const tr of tramos) {
    if (tr.ms.length < MIN_TURNOS_BLOQUE) continue;
    const ultimo = bloques[bloques.length - 1];
    if (ultimo?.motor === tr.motor) ultimo.ms.push(...tr.ms);
    else bloques.push({ motor: tr.motor, ms: [...tr.ms] });
  }
  return bloques;
}

/** Cuántos bloques alternos de verdad hay (A-B-A-B = 4): ver bloquesAlternos. */
export function contarBloques(ms: MedidaTurnoVoz[]): number {
  return bloquesAlternos(ms).length;
}

/** Los pares de bloques vecinos (1.º con 2.º, 3.º con 4.º…) y en cuántos gana Speech Engine. */
export type ParesBloques = { total: number; ganaSE: number };

/**
 * La comparación POR PARES de bloques vecinos (revisión 16, R16-4: la paradoja de Simpson). Juntar todas las
 * respuestas de cada camino deja que el reparto de las horas decida: con 40 del agente y 5 de Speech Engine en la
 * hora mala, y 5 del agente y 100 de Speech Engine en la buena, Speech Engine «ganaba» junto aunque perdiera en las
 * dos horas. Cada par (A/B seguidos, la misma hora) pesa uno, tenga los turnos que tenga: Speech Engine gana el par
 * si el p50 de su primer texto del servidor es menor que el del agente en ese par. Un bloque suelto al final no tiene par.
 */
export function paresDeBloques(ms: MedidaTurnoVoz[]): ParesBloques {
  const b = bloquesAlternos(ms);
  const p50 = (xs: MedidaTurnoVoz[]) => percentil(xs.map(primerTextoDe).filter((x): x is number => x !== null), 50);
  let total = 0;
  let ganaSE = 0;
  for (let i = 0; i + 1 < b.length; i += 2) {
    const [ag, se] = b[i].motor === 'agente' ? [b[i], b[i + 1]] : [b[i + 1], b[i]];
    const a = p50(ag.ms);
    const s = p50(se.ms);
    total++;
    if (a !== null && s !== null && s < a) ganaSE++;
  }
  return { total, ganaSE };
}

/**
 * Los cortados de un camino SIN los de sus interrupciones a propósito anotadas (R16-3): cada una corta un turno a
 * sabiendas, no por impaciencia. Devuelve los que quedan y de cuántos turnos que esperaban respuesta.
 */
export function cortadosSinEjercicios(r: ResumenCamino): { cortados: number; de: number } {
  const aProposito = Math.min(r.excluidos.cortados, r.ejercicios.interrupciones.hechas);
  return { cortados: r.excluidos.cortados - aProposito, de: r.turnos - r.excluidos.asentimientos - aProposito };
}

/** ¿`nuevo` es mejor que `actual` por más que el ruido? (menos es mejor; los dos márgenes a la vez). */
export function mejorClaro(actual: number | null, nuevo: number | null): boolean {
  if (actual === null || nuevo === null) return false;
  return actual - nuevo >= Math.max(MARGEN_MS, MARGEN_RELATIVO * actual);
}

/** ¿`nuevo` no es peor que `actual` más allá del ruido? (el mismo margen; sin datos, no se sabe: no). */
export function noPeor(actual: number | null, nuevo: number | null): boolean {
  if (actual === null || nuevo === null) return false;
  return nuevo - actual < Math.max(MARGEN_MS, MARGEN_RELATIVO * actual);
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
  /** El primer TEXTO del servidor (no audio) mejora en p50 / p95 por más que el margen. */
  primerTextoServidorP50Mejor: boolean;
  primerTextoServidorP95Mejor: boolean;
  /** @deprecated alias de primerTextoServidorP50Mejor (nombre de antes). */
  primerTextoP50Mejor: boolean;
  /** @deprecated alias de primerTextoServidorP95Mejor (nombre de antes). */
  primerTextoP95Mejor: boolean;
  /** La respuesta de verdad (sin la frase de espera, con los cortados) no empeora más que el margen. */
  cerebroP50NoPeor: boolean;
  cerebroP95NoPeor: boolean;
  interrupcionesIgualOMas: boolean;
  asentimientosIgualOMas: boolean;
  regresiones: string[];
  /** R16-4: Speech Engine gana en la mayoría de los pares de bloques vecinos (A/B de la misma hora). */
  ganaEnLaMayoriaDePares: boolean;
  /** Solo informa: nunca enciende ni apaga nada. */
  consultivo: true;
};

const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * La regla acordada con José, honesta, para UNA red. Primero la evidencia mínima por camino (≥ MIN_TURNOS
 * respuestas comparables de ≥ MIN_CONVERSACIONES llamadas distintas, ≥ MIN_INTERRUPCIONES interrupciones y
 * ≥ MIN_ASENTIMIENTOS asentimientos a propósito, parejos entre caminos: EJERCICIOS_PAREJOS) y en ≥ MIN_BLOQUES
 * bloques alternos de ≥ MIN_TURNOS_BLOQUE; sin eso, «insuficiente» y qué falta. Con evidencia, se adopta SOLO si
 * el primer texto del servidor de las respuestas comparables es mejor en p50 Y en p95 por más que el margen, Speech Engine
 * gana en la mayoría de los pares de bloques vecinos (`pares`, R16-4: que el reparto de las horas no decida), la
 * respuesta de verdad (cerebro, sin la frase de espera y con los cortados censurados) no es peor en p50 NI en p95
 * más que el margen, atiende las interrupciones a propósito y aguanta los asentimientos al menos como el agente
 * (en tasa), y no empeora nada (REGRESIONES, cortados incluidos sin los de las interrupciones a propósito, en
 * proporción a los turnos que esperaban respuesta). Si no, «mantener» (el agente). Sin `pares` (quien llama no
 * tiene los bloques), esa condición no se mira.
 */
export function veredicto(ag: ResumenCamino, se: ResumenCamino, bloques: number, pares?: ParesBloques): Veredicto {
  const faltan: string[] = [];
  for (const [motor, r] of [['agente', ag], ['speech-engine', se]] as const) {
    if (r.completos < MIN_TURNOS) faltan.push(`${motor}: faltan ${MIN_TURNOS - r.completos} turnos comparables (hay ${r.completos} de ${MIN_TURNOS})`);
    const fc = MIN_CONVERSACIONES - r.conversacionesComparables;
    if (fc > 0) faltan.push(`${motor}: faltan ${cuantos(fc, 'conversación distinta', 'conversaciones distintas')} con respuestas comparables (hay ${r.conversacionesComparables} de ${MIN_CONVERSACIONES})`);
    const fi = MIN_INTERRUPCIONES - r.ejercicios.interrupciones.hechas;
    if (fi > 0) faltan.push(`${motor}: faltan ${cuantos(fi, 'interrupción', 'interrupciones')} a propósito`);
    const fa = MIN_ASENTIMIENTOS - r.ejercicios.asentimientos.hechas;
    if (fa > 0) faltan.push(`${motor}: faltan ${cuantos(fa, 'asentimiento', 'asentimientos')} a propósito`);
  }
  // R16-3: los ejercicios a propósito, parejos (si no, sus cortes pesan distinto en cada camino).
  for (const k of ['interrupciones', 'asentimientos'] as const) {
    const a = ag.ejercicios[k].hechas;
    const b = se.ejercicios[k].hechas;
    if (Math.min(a, b) < EJERCICIOS_PAREJOS * Math.max(a, b))
      faltan.push(`${k} a propósito desparejos (agente ${a}, speech-engine ${b}): hacen falta casi los mismos en los dos caminos (±${Math.round((1 - EJERCICIOS_PAREJOS) * 100)} %), si no sus cortes pesan distinto`);
  }
  if (bloques < MIN_BLOQUES) faltan.push(`faltan bloques alternos A-B-A-B de ≥${MIN_TURNOS_BLOQUE} turnos comparables (hay ${bloques} de ${MIN_BLOQUES}): que la hora no sesgue`);
  const p50 = mejorClaro(ag.primerTexto.p50, se.primerTexto.p50);
  const p95 = mejorClaro(ag.primerTexto.p95, se.primerTexto.p95);
  // El primer texto puede ser la frase de espera: la respuesta de verdad tampoco puede empeorar.
  const cb50 = noPeor(ag.cerebroConCortados.p50, se.cerebroConCortados.p50);
  const cb95 = noPeor(ag.cerebroConCortados.p95, se.cerebroConCortados.p95);
  const tasaEj = (r: ResumenCamino, k: 'interrupciones' | 'asentimientos') => tasa(r.ejercicios[k].bien, r.ejercicios[k].hechas);
  const interrupciones = tasaEj(se, 'interrupciones') >= tasaEj(ag, 'interrupciones');
  const asentimientos = tasaEj(se, 'asentimientos') >= tasaEj(ag, 'asentimientos');
  // Lo que esperaba respuesta: todo menos los «ajá».
  const esperaban = (r: ResumenCamino) => r.turnos - r.excluidos.asentimientos;
  // Los cortados, sin los de las interrupciones a propósito (R16-3).
  const tasaRegresion = (r: ResumenCamino, k: (typeof REGRESIONES)[number]) => {
    if (k !== 'cortados') return tasa(r.excluidos[k], esperaban(r));
    const c = cortadosSinEjercicios(r);
    return tasa(c.cortados, c.de);
  };
  const regresiones: string[] = REGRESIONES.filter((k) => tasaRegresion(se, k) > tasaRegresion(ag, k));
  // R16-4: por pares de bloques vecinos, Speech Engine gana en más de la mitad.
  const mayoria = !pares || pares.ganaSE * 2 > pares.total;
  const suficientes = !faltan.length;
  const motivos: string[] = [];
  if (suficientes) {
    // Es el primer TEXTO que salió del servidor, no el primer audio que se oyó (VOZ-04): así lo dice la razón.
    if (!p50) motivos.push(`primer texto del servidor p50 sin mejora clara (agente ${ag.primerTextoServidor.p50} ms, speech-engine ${se.primerTextoServidor.p50} ms)`);
    if (!p95) motivos.push(`primer texto del servidor p95 sin mejora clara (agente ${ag.primerTextoServidor.p95} ms, speech-engine ${se.primerTextoServidor.p95} ms)`);
    if (!mayoria) motivos.push(`no gana en la mayoría de los pares de bloques A/B (gana ${pares!.ganaSE} de ${pares!.total}): lo junto lo decide el reparto de las horas`);
    if (!cb50) motivos.push(`respuesta de verdad p50 peor (agente ${ag.cerebroConCortados.p50} ms, speech-engine ${se.cerebroConCortados.p50} ms; sin la frase de espera, con los cortados)`);
    if (!cb95) motivos.push(`respuesta de verdad p95 peor (agente ${ag.cerebroConCortados.p95} ms, speech-engine ${se.cerebroConCortados.p95} ms; sin la frase de espera, con los cortados)`);
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
    primerTextoServidorP50Mejor: p50,
    primerTextoServidorP95Mejor: p95,
    primerTextoP50Mejor: p50,
    primerTextoP95Mejor: p95,
    cerebroP50NoPeor: cb50,
    cerebroP95NoPeor: cb95,
    interrupcionesIgualOMas: interrupciones,
    asentimientosIgualOMas: asentimientos,
    regresiones,
    ganaEnLaMayoriaDePares: mayoria,
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
    primerTextoServidorP50Mejor: todas((v) => v.primerTextoServidorP50Mejor),
    primerTextoServidorP95Mejor: todas((v) => v.primerTextoServidorP95Mejor),
    primerTextoP50Mejor: todas((v) => v.primerTextoServidorP50Mejor),
    primerTextoP95Mejor: todas((v) => v.primerTextoServidorP95Mejor),
    cerebroP50NoPeor: todas((v) => v.cerebroP50NoPeor),
    cerebroP95NoPeor: todas((v) => v.cerebroP95NoPeor),
    interrupcionesIgualOMas: todas((v) => v.interrupcionesIgualOMas),
    asentimientosIgualOMas: todas((v) => v.asentimientosIgualOMas),
    regresiones: [...new Set(redes.flatMap(([, v]) => v.regresiones))],
    ganaEnLaMayoriaDePares: todas((v) => v.ganaEnLaMayoriaDePares),
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
  const pares = paresDeBloques(ms);
  return { agente, 'speech-engine': se, bloques, pares, veredicto: veredicto(agente, se, bloques, pares) };
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
      pares: todo.pares,
      veredicto: combinarVeredictos(Object.fromEntries(Object.entries(porRed).map(([r, x]) => [r, x.veredicto]))),
    },
    porRed,
    redActual: red,
    minimoPorCamino: MIN_TURNOS,
    minimos: { turnosComparables: MIN_TURNOS, interrupciones: MIN_INTERRUPCIONES, asentimientos: MIN_ASENTIMIENTOS, bloques: MIN_BLOQUES },
    /** Cómo tiene que estar repartida la muestra: llamadas distintas por camino y respuestas por bloque. */
    minimosMuestra: { conversaciones: MIN_CONVERSACIONES, turnosPorBloque: MIN_TURNOS_BLOQUE },
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
