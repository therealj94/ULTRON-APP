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
 *  · asentimiento: «ajá», «mjm» mientras AURA hablaba: no se tomó como interrupción.
 *  · respaldo: contestó el cerebro de respaldo (la vía o el proveedor lo dicen).
 *
 * Vive en memoria (las últimas MAX_MEDIDAS) y, solo mientras el motor está encendido (la prueba A/B) y hay
 * S3, se guarda cada GUARDAR_MS: un redespliegue a mitad de la prueba no la borra. Con el motor apagado no
 * se escribe ni se lee nada fuera del proceso.
 */
import { s3GetJson, s3Listo, s3PutJson } from '../lib/s3';

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
      .then(() => s3PutJson(CLAVE_S3, { medidas: medidas.slice(-MAX_MEDIDAS), red }))
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
    asentimiento: !!(e?.asentimiento || m.asentimiento),
    repetido: !!(e?.repetido || m.repetido),
  });
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

export type ResumenCamino = {
  turnos: number;
  conversaciones: number;
  primerTexto: { p50: number | null; p95: number | null };
  cerebro: { p50: number | null; p95: number | null };
  puentes: number;
  interrupciones: { nativas: number; inferidas: number; total: number };
  repetidos: number;
  asentimientos: number;
  respaldos: number;
  errores: number;
  tardes: number;
  cortados: number;
};

export function resumir(ms: MedidaTurnoVoz[]): ResumenCamino {
  const pt = ms.map((m) => m.primerTextoMs).filter((x): x is number => x !== null);
  const cb = ms.map((m) => m.cerebroMs).filter((x): x is number => x !== null);
  const nativas = ms.filter((m) => m.interrupcion === 'nativa').length;
  const inferidas = ms.filter((m) => m.interrupcion === 'inferida').length;
  return {
    turnos: ms.length,
    conversaciones: new Set(ms.map((m) => m.conv).filter(Boolean)).size,
    primerTexto: { p50: percentil(pt, 50), p95: percentil(pt, 95) },
    cerebro: { p50: percentil(cb, 50), p95: percentil(cb, 95) },
    puentes: ms.filter((m) => m.puente).length,
    interrupciones: { nativas, inferidas, total: nativas + inferidas },
    repetidos: ms.filter((m) => m.repetido).length,
    asentimientos: ms.filter((m) => m.asentimiento).length,
    respaldos: ms.filter((m) => m.respaldo).length,
    errores: ms.filter((m) => m.error).length,
    tardes: ms.filter((m) => m.tarde).length,
    cortados: ms.filter((m) => m.cortado).length,
  };
}

const tasa = (n: number, de: number) => (de ? n / de : 0);

/**
 * La regla acordada con José: se adopta SOLO si Speech Engine gana claro. Con al menos MIN_TURNOS por
 * camino, su primer texto es mejor en p50 Y en p95, detecta al menos las mismas interrupciones (con la
 * misma cantidad de interrupciones a propósito en cada camino) y no empeora nada: errores, turnos tarde,
 * repeticiones ni respaldos (en proporción a sus turnos).
 */
export function veredicto(ag: ResumenCamino, se: ResumenCamino) {
  const faltan = { agente: Math.max(0, MIN_TURNOS - ag.turnos), 'speech-engine': Math.max(0, MIN_TURNOS - se.turnos) };
  const suficientes = !faltan.agente && !faltan['speech-engine'];
  const mejor = (a: number | null, b: number | null) => a !== null && b !== null && b < a;
  const p50 = mejor(ag.primerTexto.p50, se.primerTexto.p50);
  const p95 = mejor(ag.primerTexto.p95, se.primerTexto.p95);
  const interrupciones = se.interrupciones.total >= ag.interrupciones.total;
  const regresiones: string[] = [];
  for (const k of ['errores', 'tardes', 'repetidos', 'respaldos'] as const) if (tasa(se[k], se.turnos) > tasa(ag[k], ag.turnos)) regresiones.push(k);
  const adoptar = suficientes && p50 && p95 && interrupciones && !regresiones.length;
  return { suficientes, faltan, primerTextoP50Mejor: p50, primerTextoP95Mejor: p95, interrupcionesIgualOMas: interrupciones, regresiones, adoptar };
}

/** La comparación entera: en total y por etiqueta de red. `desde`/`hasta` en ms. */
export async function comparacionVoz(o: { desde?: number; hasta?: number } = {}) {
  await cargar();
  const ms = medidas.filter((m) => (!o.desde || m.t >= o.desde) && (!o.hasta || m.t <= o.hasta));
  const de = (xs: MedidaTurnoVoz[]) => {
    const agente = resumir(xs.filter((m) => m.motor === 'agente'));
    const se = resumir(xs.filter((m) => m.motor === 'speech-engine'));
    return { agente, 'speech-engine': se, veredicto: veredicto(agente, se) };
  };
  const redes = [...new Set(ms.map((m) => m.red))];
  return {
    total: de(ms),
    porRed: Object.fromEntries(redes.map((r) => [r || 'sin-etiqueta', de(ms.filter((m) => m.red === r))])),
    redActual: red,
    minimoPorCamino: MIN_TURNOS,
  };
}

/** Solo pruebas. */
export function _reiniciarMedidas() {
  medidas = [];
  red = '';
  cargado = true;
  sucio = false;
  if (reloj) clearTimeout(reloj);
  reloj = null;
}
export function _medidas() {
  return medidas;
}
