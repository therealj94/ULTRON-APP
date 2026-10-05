/**
 * LA OTA QUE SE PUBLICÓ, PARA COMPARAR CON LA QUE CORRE CADA TELÉFONO. EAS publica la OTA desde
 * .github/workflows/ota.yml y no le avisa al servidor: GET /api/build decía `esperado: desconocido` en el teléfono. Ahora
 * el flujo, después de publicar, sube una ficha pública (`ota-aura.json`, la escribe scripts/qa/manifiesto-ota.mjs) al
 * Release fijo «aura-ota» del repositorio, y esto la lee:
 *
 *   https://github.com/therealj94/ULTRON-APP/releases/download/aura-ota/ota-aura.json   (AURA_OTA_MANIFIESTO_URL)
 *
 * La ficha: { v: 1, actualizado, publicaciones: [{ plataforma: ultron|electrum, canal, runtimeVersion, tipo: ota|embebido,
 * androidUpdateId, iosUpdateId, grupo, commit, publicado }] } — las últimas por app, canal y runtime (una APK vieja con
 * otro runtime sigue encontrando la suya). `tipo: embebido` = la marcha atrás al JS de la APK en ese runtime.
 *
 * NUNCA FRENA /api/build: se guarda 10 min en memoria; pasado eso, la ruta contesta con lo guardado y la refresca
 * aparte. Solo la primera vez (sin nada guardado) espera, como mucho ESPERA_RUTA_MS. La descarga sigue redirecciones
 * (GitHub manda a su CDN), corta a los 4 s y a los 64 KB. Si falla, se queda con la última buena y lo dice
 * (`fuente: 'no-disponible'`, con `leido` = cuándo se leyó la que se usa); sin ninguna buena, el teléfono sigue en
 * «desconocido». Lo que no tiene la forma exacta se descarta (una ficha rota no inventa un «sí»).
 *
 * Con AURA_OTA_MANIFIESTO_URL=off no se descarga nada (pruebas, o un servidor sin salida a internet).
 */

export const URL_OTA_POR_OMISION = 'https://github.com/therealj94/ULTRON-APP/releases/download/aura-ota/ota-aura.json';
/** Cuánto vale una lectura buena. */
export const CACHE_OTA_MS = 10 * 60_000;
/** Tras un fallo, cuánto esperar para volver a intentarlo (no se martilla a GitHub en cada petición). */
export const REINTENTO_OTA_MS = 60_000;
export const TIMEOUT_OTA_MS = 4_000;
/** Lo más que /api/build espera la primera lectura. Después, nunca espera. */
export const ESPERA_RUTA_MS = 1_500;
export const TOPE_FICHA_BYTES = 64 * 1024;
const TOPE_PUBLICACIONES = 50;

export const APPS_OTA = ['ultron', 'electrum'] as const;
export type AppOta = (typeof APPS_OTA)[number];

export type PublicacionOta = {
  plataforma: AppOta;
  canal: string;
  runtimeVersion: string;
  tipo: 'ota' | 'embebido';
  androidUpdateId: string | null;
  iosUpdateId: string | null;
  grupo: string | null;
  commit: string | null;
  publicado: string;
};
export type ManifiestoOta = { v: 1; actualizado: string | null; publicaciones: PublicacionOta[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNTIME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CANAL = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const COMMIT = /^[0-9a-f]{7,40}$/i;

const fechaIso = (v: unknown): string | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const uuidO = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);

/** Una publicación, solo si tiene la forma exacta (si no, null). */
export function validarPublicacion(x: unknown): PublicacionOta | null {
  const e = x as Record<string, unknown> | null;
  if (!e || typeof e !== 'object') return null;
  const plataforma = e.plataforma as AppOta;
  if (!APPS_OTA.includes(plataforma)) return null;
  if (typeof e.canal !== 'string' || !CANAL.test(e.canal)) return null;
  if (typeof e.runtimeVersion !== 'string' || !RUNTIME.test(e.runtimeVersion)) return null;
  const publicado = fechaIso(e.publicado);
  if (!publicado) return null;
  const androidUpdateId = uuidO(e.androidUpdateId);
  const iosUpdateId = uuidO(e.iosUpdateId);
  if (e.tipo !== 'ota' && e.tipo !== 'embebido') return null;
  if (e.tipo === 'ota' && !androidUpdateId && !iosUpdateId) return null;
  return {
    plataforma,
    canal: e.canal,
    runtimeVersion: e.runtimeVersion,
    tipo: e.tipo,
    androidUpdateId: e.tipo === 'ota' ? androidUpdateId : null,
    iosUpdateId: e.tipo === 'ota' ? iosUpdateId : null,
    grupo: uuidO(e.grupo),
    commit: typeof e.commit === 'string' && COMMIT.test(e.commit) ? e.commit.toLowerCase() : null,
    publicado,
  };
}

/** La ficha, o null si no es una ficha v1. Las publicaciones rotas se descartan; la más reciente primero. */
export function validarManifiestoOta(x: unknown): ManifiestoOta | null {
  const m = x as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || m.v !== 1 || !Array.isArray(m.publicaciones)) return null;
  const publicaciones = m.publicaciones
    .slice(0, TOPE_PUBLICACIONES)
    .map(validarPublicacion)
    .filter((p): p is PublicacionOta => !!p)
    .sort((a, b) => Date.parse(b.publicado) - Date.parse(a.publicado));
  return { v: 1, actualizado: fechaIso(m.actualizado), publicaciones };
}

/* ------------------------------------------------------------------ la descarga, con memoria */

export type FuenteOtaNombre = 'release' | 'no-disponible';
export type EstadoOta = {
  /**
   * `release`: la última descarga salió bien (vale 10 min; pasado eso se refresca aparte). `no-disponible`: la última
   * descarga falló (o está apagada); si hubo una buena antes, `manifiesto` es esa y `leido` dice de cuándo.
   */
  fuente: FuenteOtaNombre;
  /** La última ficha buena (aunque la última descarga haya fallado), o null si nunca hubo una. */
  manifiesto: ManifiestoOta | null;
  /** Cuándo se leyó la ficha que se usa. */
  leido: string | null;
  /** Por qué no está disponible (sin direcciones). */
  detalle?: string;
};

type RespuestaFetch = { ok: boolean; status: number; body?: ReadableStream<Uint8Array> | null; text(): Promise<string> };
type Fetch = (url: string, init?: { signal?: AbortSignal; redirect?: 'follow'; headers?: Record<string, string> }) => Promise<RespuestaFetch>;

/**
 * El cuerpo como texto, leído por trozos y CORTADO en cuanto pasa de `tope` bytes (se cancela la descarga): una
 * respuesta enorme, o una que no termina nunca, no se lee entera en memoria. Sin cuerpo en flujo (un fetch de
 * pruebas), `text()` y la misma cuenta en bytes.
 */
export async function leerConTope(r: RespuestaFetch, tope: number): Promise<string> {
  const demasiado = () => new Error('ficha demasiado grande');
  if (!r.body) {
    const t = await r.text();
    if (Buffer.byteLength(t) > tope) throw demasiado();
    return t;
  }
  const lector = r.body.getReader();
  const trozos: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    n += value.byteLength;
    if (n > tope) {
      await lector.cancel().catch(() => {});
      throw demasiado();
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos).toString('utf8');
}

export type OpcionesFuenteOta = {
  url?: string;
  fetch?: Fetch;
  ahora?: () => number;
  cacheMs?: number;
  reintentoMs?: number;
  timeoutMs?: number;
};

const limpiar = (s: string) => s.replace(/https?:\/\/\S+/g, '[dirección]').slice(0, 120);

export class FuenteOta {
  private bueno: { manifiesto: ManifiestoOta; en: number } | null = null;
  private fallo: { en: number; detalle: string } | null = null;
  private enCurso: Promise<EstadoOta> | null = null;
  private readonly url: string;
  private readonly apagada: boolean;
  private readonly fetchFn: Fetch;
  private readonly ahora: () => number;
  private readonly cacheMs: number;
  private readonly reintentoMs: number;
  private readonly timeoutMs: number;

  constructor(o: OpcionesFuenteOta = {}) {
    const url = (o.url ?? URL_OTA_POR_OMISION).trim();
    this.apagada = !url || url === 'off' || url === '0';
    this.url = url;
    this.fetchFn = o.fetch ?? (globalThis.fetch as unknown as Fetch);
    this.ahora = o.ahora ?? Date.now;
    this.cacheMs = o.cacheMs ?? CACHE_OTA_MS;
    this.reintentoMs = o.reintentoMs ?? REINTENTO_OTA_MS;
    this.timeoutMs = o.timeoutMs ?? TIMEOUT_OTA_MS;
  }

  /** Lo que hay ahora, sin descargar nada. */
  estado(): EstadoOta {
    const leido = this.bueno ? new Date(this.bueno.en).toISOString() : null;
    if (this.apagada) return { fuente: 'no-disponible', manifiesto: null, leido: null, detalle: 'apagada (AURA_OTA_MANIFIESTO_URL=off)' };
    // Un acierto borra el fallo: si hay fallo, es posterior a la última buena.
    if (this.bueno && !this.fallo) return { fuente: 'release', manifiesto: this.bueno.manifiesto, leido };
    return { fuente: 'no-disponible', manifiesto: this.bueno?.manifiesto ?? null, leido, detalle: this.fallo?.detalle ?? 'todavía no leída' };
  }

  /** ¿Toca descargar? (Lo bueno caducó, o nunca hubo; tras un fallo, no antes de reintentoMs.) */
  private toca(): boolean {
    if (this.apagada) return false;
    const t = this.ahora();
    if (this.fallo && t - this.fallo.en < this.reintentoMs) return false;
    return !this.bueno || t - this.bueno.en >= this.cacheMs;
  }

  /** Descarga y valida (una sola descarga a la vez). Nunca lanza. */
  refrescar(): Promise<EstadoOta> {
    if (this.apagada) return Promise.resolve(this.estado());
    if (this.enCurso) return this.enCurso;
    this.enCurso = (async () => {
      try {
        const r = await this.fetchFn(this.url, { redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: 'application/json, application/octet-stream' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Leída con tope: pasado TOPE_FICHA_BYTES se corta la descarga (no se lee entera para después medirla).
        const texto = await leerConTope(r, TOPE_FICHA_BYTES);
        const m = validarManifiestoOta(JSON.parse(texto));
        if (!m) throw new Error('la ficha no tiene la forma v1');
        this.bueno = { manifiesto: m, en: this.ahora() };
        this.fallo = null;
      } catch (e: any) {
        const nombre = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? `sin respuesta en ${this.timeoutMs} ms` : String(e?.message || e);
        this.fallo = { en: this.ahora(), detalle: limpiar(nombre) };
      } finally {
        this.enCurso = null;
      }
      return this.estado();
    })();
    return this.enCurso;
  }

  /**
   * Para /api/build: lo guardado si vale; si caducó, lo guardado igual y la descarga aparte; si nunca hubo nada,
   * espera la descarga como mucho `esperaMs`. Nunca lanza ni espera más que eso.
   */
  async obtener(esperaMs = ESPERA_RUTA_MS): Promise<EstadoOta> {
    if (!this.toca()) return this.estado();
    const p = this.refrescar();
    if (this.bueno) return this.estado();
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const tope = new Promise<EstadoOta>((r) => {
      reloj = setTimeout(() => r(this.estado()), esperaMs);
    });
    try {
      return await Promise.race([p, tope]);
    } finally {
      clearTimeout(reloj);
    }
  }
}

let delProceso: FuenteOta | null = null;
/** La del proceso: la URL de AURA_OTA_MANIFIESTO_URL (o la del Release «aura-ota»). */
export function fuenteOtaDelProceso(): FuenteOta {
  if (!delProceso) delProceso = new FuenteOta({ url: process.env.AURA_OTA_MANIFIESTO_URL ?? URL_OTA_POR_OMISION });
  return delProceso;
}
