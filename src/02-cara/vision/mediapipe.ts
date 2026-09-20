/**
 * Carga del FaceLandmarker de MediaPipe Tasks Vision y traducción de su resultado a `Observacion`.
 *
 * El paquete JS viene por npm (se importa dinámicamente para no engordar el bundle inicial);
 * el WASM y el modelo .task se cargan por URL (no se empaquetan). Las URLs son constantes
 * configurables abajo (ver README, sección Cámara → «Cómo cambiar el modelo»).
 */
import type { FaceLandmarker, FaceLandmarkerResult, Category } from '@mediapipe/tasks-vision';
import type { Observacion } from './escena';

/**
 * Versión del paquete JS. La URL del WASM en jsDelivr lleva esta versión, así que DEBE coincidir con la
 * instalada: package.json la fija EXACTA (`"@mediapipe/tasks-vision": "1.0.1"`, sin ^) y
 * `tests/escena.test.ts` comprueba que package.json, node_modules y esta constante coinciden.
 */
export const MEDIAPIPE_VERSION = '1.0.1';
export const MEDIAPIPE_WASM_URL_DEFAULT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
export const FACE_LANDMARKER_MODEL_URL_DEFAULT =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * URLs efectivas. Se pueden cambiar sin tocar código, en este orden de prioridad:
 *  1. `window.__ULTRON_VISION = { wasmUrl, modelUrl }` antes de activar la cámara (kiosko / QA).
 *  2. Variables de build `VITE_VISION_WASM_URL` y `VITE_VISION_MODEL_URL` (.env) → copia autoalojada, útil sin internet.
 *  3. Los valores por defecto de arriba (CDN públicas).
 */
function leerOverride(clave: 'wasmUrl' | 'modelUrl'): string | undefined {
  try {
    const w = (globalThis as any).__ULTRON_VISION;
    if (w && typeof w[clave] === 'string' && w[clave]) return w[clave];
  } catch {
    /* sin window */
  }
  const env = (import.meta as any).env ?? {};
  const v = clave === 'wasmUrl' ? env.VITE_VISION_WASM_URL : env.VITE_VISION_MODEL_URL;
  return typeof v === 'string' && v ? v : undefined;
}
/** URL efectiva del WASM en este momento (respeta un override puesto en window después de cargar el módulo). */
export const urlWasm = (): string => leerOverride('wasmUrl') ?? MEDIAPIPE_WASM_URL_DEFAULT;
/** URL efectiva del modelo .task en este momento. */
export const urlModelo = (): string => leerOverride('modelUrl') ?? FACE_LANDMARKER_MODEL_URL_DEFAULT;
/** Tiempo máximo para tener el modelo listo antes de caer al tracker óptico. */
export const MEDIAPIPE_TIMEOUT_MS = 6000;
/** Cuántas caras como máximo busca el modelo (el costo crece solo con las caras que encuentra). */
export const MAX_CARAS = 3;

export type Delegado = 'GPU' | 'CPU';

export interface LandmarkerListo {
  landmarker: FaceLandmarker;
  delegado: Delegado;
}

export interface OpcionesCarga {
  wasmUrl?: string;
  modelUrl?: string;
  /** Orden de intentos de delegado. Por defecto GPU y, si falla, CPU. */
  delegados?: Delegado[];
  timeoutMs?: number;
  signal?: AbortSignal;
  log?: (...a: unknown[]) => void;
}

class TiempoAgotado extends Error {
  constructor() {
    super('mediapipe: tiempo agotado');
    this.name = 'TiempoAgotado';
  }
}

function conTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((res, rej) => {
    const id = setTimeout(() => rej(new TiempoAgotado()), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        res(v);
      },
      (e) => {
        clearTimeout(id);
        rej(e);
      }
    );
  });
}

function tieneWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * Crea el FaceLandmarker en modo VIDEO con blendshapes y matriz facial.
 * Intenta GPU (si hay WebGL2) y cae a CPU. Rechaza con `TiempoAgotado` si no está listo en `timeoutMs`.
 * Ojo: si se agota el tiempo, la carga real puede seguir en segundo plano; `crearLandmarker` devuelve
 * también `tardio`, una promesa que resuelve si el modelo termina de cargar después (para poder
 * subir de óptico a MediaPipe sin recargar).
 */
export function crearLandmarker(op: OpcionesCarga = {}): { listo: Promise<LandmarkerListo>; tardio: Promise<LandmarkerListo> } {
  // Se resuelven en cada arranque para respetar un override puesto en window después de cargar el módulo.
  const wasmUrl = op.wasmUrl ?? urlWasm();
  const modelUrl = op.modelUrl ?? urlModelo();
  const timeoutMs = op.timeoutMs ?? MEDIAPIPE_TIMEOUT_MS;
  const log = op.log ?? (() => {});
  const delegados = op.delegados ?? (tieneWebGL2() ? (['GPU', 'CPU'] as Delegado[]) : (['CPU'] as Delegado[]));
  log('[vision] cargando MediaPipe', { wasmUrl, modelUrl, delegados });

  const cargar = async (): Promise<LandmarkerListo> => {
    const mod = await import('@mediapipe/tasks-vision');
    if (op.signal?.aborted) throw new Error('abortado');
    const fileset = await mod.FilesetResolver.forVisionTasks(wasmUrl);
    let ultimoError: unknown = null;
    for (const delegado of delegados) {
      if (op.signal?.aborted) throw new Error('abortado');
      try {
        const landmarker = await mod.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl, delegate: delegado },
          runningMode: 'VIDEO',
          numFaces: MAX_CARAS,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        log('[vision] mediapipe listo, delegado', delegado);
        return { landmarker, delegado };
      } catch (e) {
        ultimoError = e;
        log('[vision] delegado', delegado, 'falló:', (e as Error)?.message ?? e);
      }
    }
    throw ultimoError ?? new Error('mediapipe: no se pudo crear el landmarker');
  };

  const tardio = cargar();
  tardio.catch(() => {});
  const listo = conTimeout(tardio, timeoutMs);
  return { listo, tardio };
}

export const esTiempoAgotado = (e: unknown) => e instanceof TiempoAgotado;

// ---- Traducción del resultado ---------------------------------------------------------------

function puntaje(cats: Category[] | undefined, nombre: string): number {
  if (!cats) return 0;
  for (let i = 0; i < cats.length; i++) if (cats[i].categoryName === nombre) return cats[i].score;
  return 0;
}

/**
 * Yaw/pitch en grados desde la matriz facial 4x4 (column-major) que entrega MediaPipe.
 * Devuelve magnitudes fiables; el signo de la dirección se toma de los landmarks (ver abajo).
 */
export function anguloDesdeMatriz(data: ArrayLike<number> | undefined): { yaw: number; pitch: number } | null {
  if (!data || data.length < 16) return null;
  const r02 = data[8];
  const r12 = data[9];
  const r22 = data[10];
  const yaw = (Math.atan2(r02, r22) * 180) / Math.PI;
  const pitch = (Math.asin(Math.max(-1, Math.min(1, -r12))) * 180) / Math.PI;
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  return { yaw, pitch };
}

// Índices de la malla (468 puntos + iris): punta de nariz, comisura ext. ojo derecho de la persona
// (aparece a la izquierda del cuadro sin espejar), ojo izquierdo, barbilla y frente.
const I_NARIZ = 1;
const I_OJO_DER = 33;
const I_OJO_IZQ = 263;
const I_BARBILLA = 152;
const I_FRENTE = 10;

/**
 * Yaw/pitch aproximados en grados a partir de la geometría de los landmarks.
 * yaw > 0 = la persona gira hacia SU derecha; pitch > 0 = mira hacia arriba.
 */
export function anguloDesdeLandmarks(lm: ArrayLike<{ x: number; y: number }>): { yaw: number; pitch: number } {
  const n = lm[I_NARIZ];
  const od = lm[I_OJO_DER];
  const oi = lm[I_OJO_IZQ];
  const b = lm[I_BARBILLA];
  const f = lm[I_FRENTE];
  if (!n || !od || !oi || !b || !f) return { yaw: 0, pitch: 0 };
  const ancho = oi.x - od.x || 1e-6;
  const ratioX = (n.x - od.x) / ancho; // 0.5 centrado; <0.5 nariz hacia el ojo derecho (su derecha)
  const yaw = (0.5 - ratioX) * 120; // ±0.25 de desvío ≈ ±30°
  const alto = b.y - f.y || 1e-6;
  const ratioY = (n.y - f.y) / alto; // ~0.55 frontal; menor = mira arriba
  const pitch = (0.55 - ratioY) * 150;
  return { yaw: Math.max(-90, Math.min(90, yaw)), pitch: Math.max(-90, Math.min(90, pitch)) };
}

/** Por debajo de este giro (grados) manda solo la geometría; a `GIRO_MEZCLA_MAX` manda la magnitud de la matriz. */
export const GIRO_MEZCLA_MIN = 5;
export const GIRO_MEZCLA_MAX = 10;

/**
 * Combina el ángulo de la geometría de landmarks (signo fiable, magnitud aproximada) con la magnitud de la
 * matriz facial (más precisa, signo no verificado) SIN discontinuidades: peso 0 de la matriz hasta 5° de
 * geometría y 1 a partir de 10°, lineal entre medio. Sin matriz devuelve la geometría tal cual.
 */
export function combinarAngulo(geo: number, matriz: number | undefined): number {
  if (matriz === undefined || !Number.isFinite(matriz)) return geo;
  const a = Math.abs(geo);
  const w = Math.max(0, Math.min(1, (a - GIRO_MEZCLA_MIN) / (GIRO_MEZCLA_MAX - GIRO_MEZCLA_MIN)));
  if (w === 0) return geo;
  return geo * (1 - w) + Math.sign(geo) * Math.abs(matriz) * w;
}

/** Campo de visión horizontal típico de una cámara frontal 640×480 (grados). */
export const HFOV_GRADOS = 60;

/**
 * Ángulo (grados) con que la cámara ve un punto del cuadro: cuánto tendría que girar la cabeza
 * alguien situado en (cx, cy) para mirar a la cámara. Se resta del giro absoluto para decidir
 * `mirando` sin castigar a quien está a un lado de la tablet.
 *  - yaw > 0 = giro hacia SU derecha. Persona a la izquierda del cuadro (cx<0.5, sin espejar, o sea
 *    a la izquierda de la cámara) mira a la cámara girando hacia SU izquierda → yaw esperado < 0.
 *  - pitch > 0 = mira arriba. Persona en la parte alta del cuadro (cy<0.5) mira a la cámara bajando
 *    la cabeza → pitch esperado < 0.
 * `aspecto` = ancho/alto del video (el FOV vertical se deriva del horizontal).
 */
export function anguloEsperado(cx: number, cy: number, aspecto = 4 / 3, hfov = HFOV_GRADOS): { yaw: number; pitch: number } {
  const tanH = Math.tan((hfov * Math.PI) / 360);
  const tanV = tanH / (aspecto > 0 ? aspecto : 4 / 3);
  const u = Math.max(-1, Math.min(1, (cx - 0.5) * 2));
  const v = Math.max(-1, Math.min(1, (cy - 0.5) * 2));
  return {
    yaw: (Math.atan(u * tanH) * 180) / Math.PI,
    pitch: (Math.atan(v * tanV) * 180) / Math.PI,
  };
}

/**
 * Convierte un `FaceLandmarkerResult` en `Observacion` (coordenadas del video sin espejar).
 * `aspecto` = videoWidth/videoHeight, para descontar la posición en el cuadro del giro de la cabeza.
 */
export function observacionDesdeResultado(r: FaceLandmarkerResult, ts: number, aspecto = 4 / 3): Observacion {
  const caras = r.faceLandmarks ?? [];
  if (caras.length === 0) return { ts, motor: 'mediapipe', personas: 0, cara: null };

  // Cara principal = la más grande (más cerca).
  let mejor = -1;
  let mejorAlto = -1;
  const cajas: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [];
  for (let i = 0; i < caras.length; i++) {
    const lm = caras[i];
    let minX = 1,
      maxX = 0,
      minY = 1,
      maxY = 0;
    for (let k = 0; k < lm.length; k++) {
      const p = lm[k];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    cajas.push({ minX, maxX, minY, maxY });
    const alto = maxY - minY;
    if (alto > mejorAlto) {
      mejorAlto = alto;
      mejor = i;
    }
  }

  const lm = caras[mejor];
  const caja = cajas[mejor];
  const bs = r.faceBlendshapes?.[mejor]?.categories;
  const sonrisa = (puntaje(bs, 'mouthSmileLeft') + puntaje(bs, 'mouthSmileRight')) / 2;
  const jaw = puntaje(bs, 'jawOpen');
  const cejas = puntaje(bs, 'browInnerUp');
  const ojosAbiertos = (puntaje(bs, 'eyeWideLeft') + puntaje(bs, 'eyeWideRight')) / 2;
  // Sorpresa exige cejas: una boca abierta sola (hablar fuerte, bostezo) no cuenta como sorpresa.
  const sorpresaBruta = Math.min(1, cejas * 0.6 + ojosAbiertos * 0.3 + Math.max(0, jaw - 0.3) * 0.4);
  const sorpresa = cejas > 0.3 ? sorpresaBruta : Math.min(0.45, sorpresaBruta);
  const parpadeo = (puntaje(bs, 'eyeBlinkLeft') + puntaje(bs, 'eyeBlinkRight')) / 2;

  const cx = (caja.minX + caja.maxX) / 2;
  const cy = (caja.minY + caja.maxY) / 2;

  const geo = anguloDesdeLandmarks(lm);
  const mat = anguloDesdeMatriz(r.facialTransformationMatrixes?.[mejor]?.data);
  // Un solo estimador cerca del frontal (la geometría, cuyo signo es conocido); la magnitud de la matriz
  // entra de forma continua solo cuando la geometría ya marca un giro claro (≥ 5°, plena a 10°). Así, con
  // geo ≈ 0 y matriz 10°, el yaw no salta entre ±10° según el signo del ruido.
  const yawAbs = combinarAngulo(geo.yaw, mat?.yaw);
  const pitchAbs = combinarAngulo(geo.pitch, mat?.pitch);
  // Se descuenta la posición en el cuadro: quien está a un lado y mira la pantalla queda en yaw ≈ 0.
  const esperado = anguloEsperado(cx, cy, aspecto);
  const yaw = yawAbs - esperado.yaw;
  const pitch = pitchAbs - esperado.pitch;

  return {
    ts,
    motor: 'mediapipe',
    personas: caras.length,
    cara: {
      cx,
      cy,
      tam: Math.max(0, Math.min(1, caja.maxY - caja.minY)),
      yaw,
      pitch,
      sonrisa,
      sorpresa,
      bocaAbierta: jaw,
      parpadeo,
    },
  };
}
