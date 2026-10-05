/**
 * EL MOTOR DE VOCES: de unos segundos de voz a una «huella» de 192 números (lib/voces-miembro.ts la
 * guarda; server/voces-rutas.ts la usa). El audio entra, se convierte y se descarta aquí mismo: no se
 * guarda ni se escribe en ningún log.
 *
 * Con qué: sherpa-onnx (k2-fsa, Apache-2.0) y el modelo CAM++ de 3D-Speaker entrenado en chino e inglés
 * (`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`, 27 MB). Se eligió midiendo los seis
 * modelos de la página de sherpa-onnx en este servidor (scripts/voces-motor-prueba.ts):
 *   · es el más liviano que separa bien: +113 MB de memoria con el modelo cargado, ~50 ms por 3 s de voz
 *     y ~120 ms por 8 s con un hilo;
 *   · con 16 lectores reales de LibriSpeech, la misma persona da 0,57–0,95 de similitud y personas
 *     distintas ≤ 0,49 (EER 0 %); titanet_small separa igual pero pesa el doble en memoria, y los dos
 *     CAM++ «voxceleb» separaban mal (EER 20–36 %) con el extractor de sherpa.
 *
 * Por qué el paquete NATIVO (`sherpa-onnx-node`) y no el de WebAssembly (`sherpa-onnx`): el de WASM para
 * Node no trae el extractor de huellas de voz (solo la diarización entera); el nativo sí
 * (`SpeakerEmbeddingExtractor`) y trae su binario para linux-x64 en un paquete opcional.
 *
 * Por qué en un PROCESO APARTE: el extractor nativo no suelta la memoria de cada audio (medido: ~0,28 MB
 * por cada 8 s, aunque se llame al recolector). Un servidor que vive semanas se iría comiendo la memoria
 * de Render; en un proceso hijo, esa memoria vuelve entera al cerrarlo. El hijo se recicla cada
 * `USOS_POR_HIJO` huellas y se cierra tras `INACTIVO_MS` sin uso. Y si el binario se cae (un fallo
 * nativo), se cae el hijo, no el servidor.
 *
 * Opcional de punta a punta: nada se carga al arrancar. La primera vez que alguien usa las voces se baja
 * el modelo (con su sha256 fijado aquí), se arranca el hijo y queda listo. Si algo falla —sin red, sin el
 * binario, otro sistema—, las voces dicen «no disponible» y todo lo demás sigue igual. `ULTRON_VOCES=0`
 * lo apaga del todo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const MODELO_VOZ = {
  id: 'campplus-zh-en-common-advanced-v1',
  archivo: '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
  bytes: 28_281_164,
  dim: 192,
} as const;

export const FRECUENCIA = 16_000;
/** Lo mínimo de VOZ (sin contar silencios) para sacar una huella que sirva. */
export const MIN_VOZ_SEG = 1.5;
/** Lo máximo que se acepta de un audio (el teléfono manda hasta ~8 s). */
export const MAX_AUDIO_SEG = 12;
/** Un hijo se cierra tras estas huellas (su memoria vuelve entera) y el siguiente arranca limpio. */
export const USOS_POR_HIJO = 60;
/** Sin uso este rato, el hijo se cierra (la memoria no queda ocupada sin motivo). */
export const INACTIVO_MS = 10 * 60_000;
/** Lo que puede tardar una huella antes de darla por perdida. */
const TOPE_HUELLA_MS = 15_000;
/** Lo que puede tardar el hijo en cargar el modelo. */
const TOPE_ARRANQUE_MS = 30_000;
/** Peticiones esperando a la vez: más que esto es abuso o un hijo atascado. */
const COLA_MAX = 8;
/** Tras un fallo al cargar, cuánto se espera para volver a intentar. */
const PAUSA_FALLO_MS = 10 * 60_000;

/** El motor no está (apagado, sin red para bajar el modelo, sin binario) o no contestó a tiempo. */
export class VozNoDisponible extends Error {}

export type MotorVoces = {
  dim: number;
  /** La huella (sin normalizar) de unas muestras float de 16 kHz mono. */
  huella(muestras: Float32Array): Promise<number[]>;
};

export type EstadoMotor = 'desactivado' | 'apagado' | 'cargando' | 'listo' | 'fallo';

/* ── el audio: de base64 a muestras, y solo la voz ───────────────────────────────────────────── */

/**
 * El audio que manda el teléfono, en base64: un WAV PCM de 16 bits, mono, 16 kHz (el mismo que arma el
 * oído Turbo para /api/stt) o PCM de 16 bits crudo. null si no es eso o pasa de `MAX_AUDIO_SEG`.
 */
export function muestrasDeAudio(b64: unknown): Float32Array | null {
  if (typeof b64 !== 'string' || !b64) return null;
  const limpio = b64.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, '');
  if (limpio.length > Math.ceil(((MAX_AUDIO_SEG * FRECUENCIA * 2 + 4096) * 4) / 3)) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(limpio)) return null;
  const buf = Buffer.from(limpio, 'base64');
  let datos: Buffer = buf;
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    let o = 12;
    let fmtOk = false;
    let hallado: Buffer | null = null;
    while (o + 8 <= buf.length) {
      const id = buf.toString('ascii', o, o + 4);
      const largo = buf.readUInt32LE(o + 4);
      const cuerpo = o + 8;
      if (id === 'fmt ') {
        if (cuerpo + 16 > buf.length) return null;
        const formato = buf.readUInt16LE(cuerpo);
        const canales = buf.readUInt16LE(cuerpo + 2);
        const frecuencia = buf.readUInt32LE(cuerpo + 4);
        const bits = buf.readUInt16LE(cuerpo + 14);
        fmtOk = formato === 1 && canales === 1 && frecuencia === FRECUENCIA && bits === 16;
        if (!fmtOk) return null;
      } else if (id === 'data') {
        hallado = buf.subarray(cuerpo, Math.min(buf.length, cuerpo + largo));
        break;
      }
      o = cuerpo + largo + (largo % 2);
    }
    if (!fmtOk || !hallado) return null;
    datos = hallado;
  }
  const n = Math.floor(datos.length / 2);
  // Menos de 0,1 s no es una frase (es basura o un trozo suelto); más de MAX_AUDIO_SEG, demasiado.
  if (n < FRECUENCIA / 10 || n > MAX_AUDIO_SEG * FRECUENCIA) return null;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = datos.readInt16LE(i * 2) / 32768;
  return out;
}

const VENTANA = 320; // 20 ms
/** Por debajo de esto (≈ -47 dBFS) un cuadro es silencio aunque el cuarto sea muy callado. */
const PISO_ABSOLUTO = 0.0045;

/**
 * Solo la voz: cuadros de 20 ms por volumen, contra el ruido de fondo del propio audio (el 10 % más
 * callado). Se quedan los cuadros con voz y un poco alrededor (las consonantes suaves); los silencios
 * largos se quitan. `vozSeg`: cuánta voz hay de verdad (un audio callado da ~0).
 */
export function soloVoz(m: Float32Array): { muestras: Float32Array; vozSeg: number } {
  const cuadros = Math.floor(m.length / VENTANA);
  if (!cuadros) return { muestras: new Float32Array(0), vozSeg: 0 };
  const rms = new Float64Array(cuadros);
  for (let c = 0; c < cuadros; c++) {
    let s = 0;
    for (let i = c * VENTANA; i < (c + 1) * VENTANA; i++) s += m[i] * m[i];
    rms[c] = Math.sqrt(s / VENTANA);
  }
  const ordenados = Array.from(rms).sort((a, b) => a - b);
  const piso = ordenados[Math.floor(cuadros * 0.1)];
  const umbral = Math.max(PISO_ABSOLUTO, piso * 3);
  const voz = Array.from(rms, (r) => r >= umbral);
  const conVoz = voz.filter(Boolean).length;
  const quedar = voz.map((_, c) => voz.slice(Math.max(0, c - 3), c + 4).some(Boolean));
  const n = quedar.filter(Boolean).length;
  const out = new Float32Array(n * VENTANA);
  let o = 0;
  for (let c = 0; c < cuadros; c++) {
    if (!quedar[c]) continue;
    out.set(m.subarray(c * VENTANA, (c + 1) * VENTANA), o);
    o += VENTANA;
  }
  return { muestras: out, vozSeg: (conVoz * VENTANA) / FRECUENCIA };
}

/** La huella a largo 1 (así la similitud es un producto punto) y redondeada para guardarla. */
export function normalizar(v: ArrayLike<number>): number[] {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  return Array.from(v, (x) => Math.round((x / n) * 1e4) / 1e4);
}

export function similitud(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/* ── el modelo: bajarlo una vez y comprobarlo ────────────────────────────────────────────────── */

const carpetaModelo = () => process.env.ULTRON_VOCES_MODELO_DIR || path.join(process.cwd(), 'data', 'modelos-voz');
const comprobados = new Map<string, string>();

async function shaDeArchivo(f: string): Promise<string> {
  const h = crypto.createHash('sha256');
  await new Promise<void>((ok, mal) => fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok()).on('error', mal));
  return h.digest('hex');
}

async function archivoBueno(f: string): Promise<boolean> {
  try {
    const st = fs.statSync(f);
    if (st.size !== MODELO_VOZ.bytes) return false;
    const marca = `${st.size}:${st.mtimeMs}`;
    if (comprobados.get(f) === marca) return true;
    if ((await shaDeArchivo(f)) !== MODELO_VOZ.sha256) return false;
    comprobados.set(f, marca);
    return true;
  } catch {
    return false;
  }
}

/** La ruta del modelo comprobado: el de `ULTRON_VOCES_MODELO`, el ya bajado, o lo baja (sha256 fijo). */
export async function asegurarModelo(bajar: typeof fetch = fetch): Promise<string> {
  const propio = process.env.ULTRON_VOCES_MODELO;
  if (propio) {
    if (await archivoBueno(propio)) return propio;
    throw new VozNoDisponible('el modelo indicado no es el esperado');
  }
  const destino = path.join(carpetaModelo(), MODELO_VOZ.archivo);
  if (await archivoBueno(destino)) return destino;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const parcial = `${destino}.${process.pid}.parte`;
  const ctrl = new AbortController();
  const tope = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const r = await bajar(MODELO_VOZ.url, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok || !r.body) throw new VozNoDisponible(`no pude bajar el modelo (HTTP ${r.status})`);
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(parcial, 'w', 0o600);
    let total = 0;
    try {
      for await (const trozo of r.body as unknown as AsyncIterable<Uint8Array>) {
        total += trozo.length;
        if (total > MODELO_VOZ.bytes) throw new VozNoDisponible('el modelo bajado es más grande de lo esperado');
        h.update(trozo);
        fs.writeSync(fd, trozo);
      }
    } finally {
      fs.closeSync(fd);
    }
    if (total !== MODELO_VOZ.bytes || h.digest('hex') !== MODELO_VOZ.sha256) throw new VozNoDisponible('el modelo bajado no es el esperado (sha256)');
    fs.renameSync(parcial, destino);
    return destino;
  } finally {
    clearTimeout(tope);
    fs.rmSync(parcial, { force: true });
  }
}

/* ── el proceso hijo ─────────────────────────────────────────────────────────────────────────── */

/**
 * Lo que corre en el hijo (`node -e`): carga sherpa-onnx y el modelo, avisa «listo» con la dimensión y
 * contesta cada `{ id, muestras }` con `{ id, v }`. Muere con el padre (al cortarse el canal).
 */
const CODIGO_HIJO = `
const [modelo, ruta] = process.argv.slice(1);
let ext;
try {
  const sherpa = require(ruta);
  ext = new sherpa.SpeakerEmbeddingExtractor({ model: modelo, numThreads: 1, debug: 0 });
  process.send({ listo: true, dim: ext.dim });
} catch (e) {
  process.send({ listo: false, error: String((e && e.message) || e).slice(0, 300) });
  setTimeout(() => process.exit(1), 50);
}
process.on('message', (m) => {
  try {
    const s = ext.createStream();
    s.acceptWaveform({ sampleRate: 16000, samples: m.muestras });
    s.inputFinished();
    if (!ext.isReady(s)) throw new Error('audio demasiado corto');
    const v = ext.compute(s, false);
    process.send({ id: m.id, v: Array.from(v) });
  } catch (e) {
    process.send({ id: m.id, error: String((e && e.message) || e).slice(0, 200) });
  }
});
process.on('disconnect', () => process.exit(0));
`;

type Pendiente = { ok: (v: number[]) => void; mal: (e: Error) => void; tope: ReturnType<typeof setTimeout> };

class MotorHijo implements MotorVoces {
  private pendientes = new Map<number, Pendiente>();
  private siguiente = 1;
  private usos = 0;
  private inactivo: ReturnType<typeof setTimeout> | null = null;
  vivo = true;
  constructor(
    readonly hijo: ChildProcess,
    readonly dim: number,
    private alMorir: (m: MotorHijo) => void
  ) {
    hijo.on('message', (m: any) => {
      const p = this.pendientes.get(m?.id);
      if (!p) return;
      this.pendientes.delete(m.id);
      clearTimeout(p.tope);
      if (Array.isArray(m.v) && m.v.length === this.dim) p.ok(m.v);
      else p.mal(new Error(String(m?.error || 'el motor no devolvió una huella')));
      this.quizasCerrar();
    });
    hijo.on('exit', () => this.morir('el motor de voces se cerró'));
    hijo.on('error', () => this.morir('el motor de voces falló'));
    this.programarInactivo();
  }

  huella(muestras: Float32Array): Promise<number[]> {
    if (!this.vivo) return Promise.reject(new VozNoDisponible('el motor de voces se cerró'));
    if (this.pendientes.size >= COLA_MAX) return Promise.reject(new VozNoDisponible('el motor de voces está ocupado'));
    const id = this.siguiente++;
    this.usos++;
    this.programarInactivo();
    return new Promise<number[]>((ok, mal) => {
      const tope = setTimeout(() => {
        this.pendientes.delete(id);
        mal(new VozNoDisponible('el motor de voces no contestó a tiempo'));
        this.cerrar();
      }, TOPE_HUELLA_MS);
      this.pendientes.set(id, { ok, mal, tope });
      try {
        this.hijo.send({ id, muestras });
      } catch {
        clearTimeout(tope);
        this.pendientes.delete(id);
        mal(new VozNoDisponible('el motor de voces se cerró'));
      }
    });
  }

  /** Ya dio sus huellas: deja de recibir y se cierra en cuanto termine lo que tiene. */
  private quizasCerrar() {
    if (this.usos >= USOS_POR_HIJO) {
      this.alMorir(this);
      if (!this.pendientes.size) this.cerrar();
    }
  }

  private programarInactivo() {
    if (this.inactivo) clearTimeout(this.inactivo);
    this.inactivo = setTimeout(() => this.cerrar(), INACTIVO_MS);
    this.inactivo.unref?.();
  }

  cerrar() {
    if (!this.vivo) return;
    try {
      this.hijo.kill();
    } catch {
      /* ya no estaba */
    }
    this.morir('el motor de voces se cerró');
  }

  private morir(motivo: string) {
    if (this.inactivo) clearTimeout(this.inactivo);
    this.inactivo = null;
    const estaba = this.vivo;
    this.vivo = false;
    for (const p of this.pendientes.values()) {
      clearTimeout(p.tope);
      p.mal(new VozNoDisponible(motivo));
    }
    this.pendientes.clear();
    if (estaba) this.alMorir(this);
  }
}

function rutaSherpa(): string {
  return createRequire(path.join(process.cwd(), 'package.json')).resolve('sherpa-onnx-node');
}

async function arrancarHijo(): Promise<MotorHijo> {
  const modelo = await asegurarModelo();
  let ruta: string;
  try {
    ruta = rutaSherpa();
  } catch {
    throw new VozNoDisponible('falta sherpa-onnx-node en este servidor');
  }
  // Un entorno mínimo: el hijo no necesita (ni debe ver) los secretos del servidor.
  const hijo = spawn(process.execPath, ['--max-old-space-size=96', '-e', CODIGO_HIJO, modelo, ruta], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    serialization: 'advanced',
    env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', LANG: 'C' },
  });
  let errores = '';
  hijo.stderr?.on('data', (d) => (errores = `${errores}${String(d)}`.slice(-400)));
  hijo.unref();
  (hijo.channel as any)?.unref?.();
  return await new Promise<MotorHijo>((ok, mal) => {
    const tope = setTimeout(() => {
      try {
        hijo.kill();
      } catch {
        /* */
      }
      mal(new VozNoDisponible('el motor de voces tardó demasiado en cargar'));
    }, TOPE_ARRANQUE_MS);
    hijo.once('message', (m: any) => {
      clearTimeout(tope);
      if (m?.listo && Number(m.dim) === MODELO_VOZ.dim) ok(new MotorHijo(hijo, MODELO_VOZ.dim, alMorirHijo));
      else {
        try {
          hijo.kill();
        } catch {
          /* */
        }
        mal(new VozNoDisponible(String(m?.error || 'el modelo de voces no cargó').slice(0, 200)));
      }
    });
    hijo.once('exit', (codigo) => {
      clearTimeout(tope);
      mal(new VozNoDisponible(`el motor de voces no arrancó (${codigo ?? 'señal'}) ${errores.trim().slice(-160)}`.trim()));
    });
    hijo.once('error', (e) => {
      clearTimeout(tope);
      mal(new VozNoDisponible(`el motor de voces no arrancó: ${String(e?.message || e).slice(0, 120)}`));
    });
  });
}

/* ── el que se usa ───────────────────────────────────────────────────────────────────────────── */

let deprueba: MotorVoces | null | undefined;
let actual: MotorHijo | null = null;
let cargando: Promise<MotorHijo> | null = null;
let falloHasta = 0;
let ultimoFallo = '';

function alMorirHijo(m: MotorHijo) {
  if (actual === m) actual = null;
}

const desactivado = () => /^(0|no|off|false)$/i.test(String(process.env.ULTRON_VOCES || '').trim());

export function estadoMotorVoces(): { estado: EstadoMotor; detalle?: string } {
  if (deprueba !== undefined) return { estado: deprueba ? 'listo' : 'fallo', ...(deprueba ? {} : { detalle: 'sin motor (prueba)' }) };
  if (desactivado()) return { estado: 'desactivado' };
  if (actual?.vivo) return { estado: 'listo' };
  if (cargando) return { estado: 'cargando' };
  if (Date.now() < falloHasta) return { estado: 'fallo', detalle: ultimoFallo };
  return { estado: 'apagado' };
}

function cargar(): Promise<MotorHijo> {
  if (actual?.vivo) return Promise.resolve(actual);
  if (!cargando) {
    cargando = arrancarHijo()
      .then((m) => {
        actual = m;
        ultimoFallo = '';
        return m;
      })
      .catch((e) => {
        ultimoFallo = String(e?.message || e).slice(0, 200);
        falloHasta = Date.now() + PAUSA_FALLO_MS;
        console.warn('[voces] el motor no está disponible:', ultimoFallo);
        throw e instanceof VozNoDisponible ? e : new VozNoDisponible(ultimoFallo);
      })
      .finally(() => {
        cargando = null;
      });
  }
  return cargando;
}

/** Que empiece a cargar sin esperar (alguien con voces guardadas abrió la app). Nunca falla. */
export function precalentarMotorVoces(): void {
  const e = estadoMotorVoces().estado;
  if (e === 'apagado') void cargar().catch(() => undefined);
}

/** El motor listo, esperando hasta `esperaMs` a que cargue. VozNoDisponible si no está. */
export async function motorVoces(esperaMs = 30_000): Promise<MotorVoces> {
  if (deprueba !== undefined) {
    if (!deprueba) throw new VozNoDisponible('sin motor (prueba)');
    return deprueba;
  }
  if (desactivado()) throw new VozNoDisponible('las voces están apagadas en este servidor');
  if (actual?.vivo) return actual;
  if (!cargando && Date.now() < falloHasta) throw new VozNoDisponible(ultimoFallo || 'el motor de voces falló hace poco');
  let tope: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      cargar(),
      new Promise<never>((_, mal) => {
        tope = setTimeout(() => mal(new VozNoDisponible('el motor de voces todavía está cargando')), esperaMs);
      }),
    ]);
  } finally {
    if (tope) clearTimeout(tope);
  }
}

/** La huella normalizada de un audio ya recortado a la voz. */
export async function huellaDeVoz(muestras: Float32Array, esperaMs?: number): Promise<number[]> {
  const m = await motorVoces(esperaMs);
  let v: number[];
  try {
    v = await m.huella(muestras);
  } catch (e) {
    throw e instanceof VozNoDisponible ? e : new VozNoDisponible(String((e as Error)?.message || e));
  }
  if (!Array.isArray(v) || v.length !== MODELO_VOZ.dim || !v.every(Number.isFinite)) throw new VozNoDisponible('el motor devolvió una huella rara');
  return normalizar(v);
}

/** Pruebas: un motor falso (o null = no disponible); `undefined` vuelve al de verdad. */
export function _motorVocesDePrueba(m: MotorVoces | null | undefined) {
  deprueba = m;
}

/** El pid del hijo vivo (para medir su memoria en scripts/voces-motor-prueba.ts). */
export function _pidMotorVoces(): number | null {
  return actual?.vivo ? actual.hijo.pid ?? null : null;
}

/** Cierra el hijo (al terminar un script o una prueba con el motor de verdad). */
export function apagarMotorVoces() {
  actual?.cerrar();
  actual = null;
  falloHasta = 0;
}
