/**
 * QUÉ BUILD CORRE CADA APARATO DE LA CUENTA (evidencia de operación, revisión externa del 5-oct: «publicar la
 * actualización no confirma que ya funcione bien en tu teléfono»). Publicar una OTA, una APK o un build web dice lo
 * que SALIÓ; esto dice lo que LLEGÓ: cada cliente manda, con peticiones que ya hace, una descripción compacta de su
 * build en la cabecera `x-aura-cliente`, y el servidor guarda por cuenta las últimas instalaciones vistas. GET
 * /api/build (server/build-rutas.ts) las enseña a la misma cuenta, comparadas con lo publicado cuando el servidor lo
 * sabe («desconocido» cuando no).
 *
 * La cabecera (la arman mobile/src/lib/recepcionDescriptor.ts y src/10-infra/recepcion.ts):
 *
 *   x-aura-cliente: v1;p=android;v=5.3.0;b=53;rt=<runtime>;u=<updateId>;c=production;e=0;uc=<ISO>;os=14;i=<instalación>
 *
 *   p  plataforma: android | ios | web | windows (obligatoria)
 *   i  id de la instalación: al azar, guardado en el aparato y renovado al salir o cambiar de cuenta (obligatorio)
 *   v  versión de la app · b número de build · rt runtimeVersion (la huella nativa) · u updateId de la OTA ·
 *   c  canal · e 1 = JS de fábrica (embebido), 0 = OTA · uc cuándo se publicó esa OTA · w SHA del build web ·
 *   os versión mayor del sistema
 *
 * PRIVACIDAD: nada más que eso. Ni modelo del aparato, ni número de serie, ni ubicación, ni contenido. El id de la
 * instalación no se guarda tal cual: se guarda un hash con la huella de la cuenta (`instalacion`), así que ni el
 * almacén ni /api/build lo devuelven, y el mismo id en dos cuentas da dos hashes que no se pueden cruzar. Cada campo
 * se valida con su forma exacta y su tope de largo: lo que no la cumple se descarta (sin `p` o sin `i` válidos, la
 * cabecera entera). Sin cabecera (un cliente viejo, o con esto apagado) no se guarda nada y nada cambia.
 *
 * CUÁNTO SE ESCRIBE: como mucho una vez cada ESPACIO_ESCRITURA_MS por instalación, salvo que su build cambie (una OTA
 * que se acaba de aplicar se anota en la primera petición). El freno vive en la memoria del proceso (con tope de
 * entradas): otra réplica o un reinicio pueden escribir una vez más, nunca de más. Se guardan las últimas
 * MAX_INSTALACIONES instalaciones por cuenta (la más vieja sale). Un fallo del almacén no frena la petición: esto va
 * aparte, sin esperar (fire-and-forget).
 */
import crypto from 'node:crypto';
import { almacenDurable, claveDe, huellaDueno, modificarDurable, type AlmacenDurable } from './durable';

export const CABECERA_CLIENTE = 'x-aura-cliente';
/** Las últimas instalaciones que se guardan por cuenta. */
export const MAX_INSTALACIONES = 10;
/** Entre dos escrituras de la misma instalación con el mismo build. */
export const ESPACIO_ESCRITURA_MS = 10 * 60_000;
/** Tope de la cabecera entera y de sus pares (lo de más se ignora). */
export const TOPE_CABECERA = 600;
const TOPE_PARES = 16;
/** El espacio durable: `recepcion/<huella de la cuenta>/clientes`. */
export const ESPACIO_RECEPCION = 'recepcion';
export const ESQUEMA_RECEPCION = 1;

export const PLATAFORMAS = ['android', 'ios', 'web', 'windows'] as const;
export type PlataformaCliente = (typeof PLATAFORMAS)[number];

/** Lo que dijo el cliente, ya validado. Lo que no vino o no tenía la forma: null. */
export type DescriptorCliente = {
  instalacion: string;
  plataforma: PlataformaCliente;
  version: string | null;
  build: string | null;
  runtime: string | null;
  updateId: string | null;
  canal: string | null;
  embebido: boolean | null;
  creada: string | null;
  webSha: string | null;
  os: string | null;
};

/** Lo guardado por instalación: el descriptor sin el id crudo, con su hash y cuándo se vio. */
export type RegistroCliente = Omit<DescriptorCliente, 'instalacion'> & { instalacion: string; primero: string; visto: string };
export type RegistroRecepcion = { v: number; clientes: RegistroCliente[] };

/* ------------------------------------------------------------------ leer y validar la cabecera */

/** La forma exacta de cada campo. Todo es ASCII sin espacios ni separadores: lo que trae otra cosa se descarta. */
const FORMAS: Record<string, RegExp> = {
  i: /^[A-Za-z0-9-]{8,64}$/,
  v: /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/,
  b: /^[0-9]{1,10}$/,
  rt: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  u: /^[0-9A-Fa-f][0-9A-Fa-f-]{7,63}$/,
  c: /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/,
  e: /^[01]$/,
  uc: /^[0-9][0-9TZ:.+-]{9,34}$/,
  w: /^[0-9A-Fa-f]{7,40}$/,
  os: /^[0-9]{1,3}$/,
};

const campo = (pares: Map<string, string>, k: string): string | null => {
  const v = pares.get(k);
  return v !== undefined && FORMAS[k].test(v) ? v : null;
};

/**
 * La cabecera como descriptor, o null si no hay, si es demasiado larga o si le falta la plataforma o el id de la
 * instalación (válidos). Nunca lanza. Una clave repetida vale la primera vez; las desconocidas se ignoran (un cliente
 * más nuevo puede mandar más sin romper a este servidor).
 */
export function leerDescriptor(cabecera: unknown): DescriptorCliente | null {
  const h = Array.isArray(cabecera) ? cabecera[0] : cabecera;
  if (typeof h !== 'string' || !h || h.length > TOPE_CABECERA) return null;
  const trozos = h.split(';').slice(0, TOPE_PARES + 1);
  if (trozos[0].trim() !== 'v1') return null;
  const pares = new Map<string, string>();
  for (const t of trozos.slice(1)) {
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    if (!(k in FORMAS) && k !== 'p') continue;
    if (!pares.has(k)) pares.set(k, t.slice(i + 1).trim());
  }
  const plataforma = pares.get('p') as PlataformaCliente | undefined;
  const instalacion = campo(pares, 'i');
  if (!plataforma || !PLATAFORMAS.includes(plataforma) || !instalacion) return null;
  const uc = campo(pares, 'uc');
  const t = uc ? Date.parse(uc) : NaN;
  const e = campo(pares, 'e');
  const minus = (v: string | null) => (v ? v.toLowerCase() : null);
  return {
    instalacion,
    plataforma,
    version: campo(pares, 'v'),
    build: campo(pares, 'b'),
    runtime: campo(pares, 'rt'),
    updateId: minus(campo(pares, 'u')),
    canal: campo(pares, 'c'),
    embebido: e === null ? null : e === '1',
    // Una fecha que no se entiende o fuera de rango (antes de 2020 o en el futuro lejano) no se guarda.
    creada: Number.isFinite(t) && t > Date.UTC(2020, 0, 1) && t < Date.now() + 2 * 86_400_000 ? new Date(t).toISOString() : null,
    webSha: minus(campo(pares, 'w')),
    os: campo(pares, 'os'),
  };
}

/** Lo que identifica el BUILD (todo menos la instalación): si cambia, se anota aunque no hayan pasado 10 minutos. */
export function firmaBuild(d: Omit<DescriptorCliente, 'instalacion'> | DescriptorCliente): string {
  return [d.plataforma, d.version, d.build, d.runtime, d.updateId, d.canal, d.embebido, d.creada, d.webSha, d.os].map((x) => (x === null || x === undefined ? '' : String(x))).join('|');
}

/** El id de la instalación como se guarda: un hash con la huella de la cuenta (nunca el id crudo). */
export function hashInstalacion(correo: string, instalacion: string): string {
  return crypto.createHash('sha256').update(`aura-recepcion:${huellaDueno(correo)}:${instalacion}`).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ el registro por cuenta (puro) */

/**
 * El registro con esta instalación anotada (puro): la actualiza si ya estaba (conserva `primero`), la agrega si no,
 * ordena por `visto` (la más reciente primero) y deja las MAX_INSTALACIONES más recientes. Lo que venga roto del
 * almacén (otro esquema, un objeto a medias) se descarta en vez de romper.
 */
export function anotarCliente(actual: RegistroRecepcion | null, correo: string, d: DescriptorCliente, ahora = Date.now()): RegistroRecepcion {
  const instalacion = hashInstalacion(correo, d.instalacion);
  const visto = new Date(ahora).toISOString();
  const previos = registroValido(actual).clientes;
  const antes = previos.find((c) => c.instalacion === instalacion);
  const { instalacion: _crudo, ...build } = d;
  const nuevo: RegistroCliente = { ...build, instalacion, primero: antes?.primero || visto, visto };
  const resto = previos.filter((c) => c.instalacion !== instalacion);
  return { v: ESQUEMA_RECEPCION, clientes: [nuevo, ...resto].sort((a, b) => Date.parse(b.visto) - Date.parse(a.visto)).slice(0, MAX_INSTALACIONES) };
}

/** Lo leído del almacén, solo si tiene la forma (si no, vacío). */
export function registroValido(r: unknown): RegistroRecepcion {
  const x = r as RegistroRecepcion | null;
  if (!x || typeof x !== 'object' || !Array.isArray(x.clientes)) return { v: ESQUEMA_RECEPCION, clientes: [] };
  const clientes = x.clientes
    .filter((c) => c && typeof c === 'object' && /^[0-9a-f]{16}$/.test(String(c.instalacion)) && PLATAFORMAS.includes(c.plataforma) && Date.parse(c.visto) > 0)
    .slice(0, MAX_INSTALACIONES);
  return { v: ESQUEMA_RECEPCION, clientes };
}

/* ------------------------------------------------------------------ el freno de escrituras */

/**
 * ¿Toca escribir? Sí la primera vez que se ve esta instalación (en este proceso), si su build cambió o si pasaron
 * ESPACIO_ESCRITURA_MS. Lo anota en el acto (dos peticiones seguidas no escriben dos veces). Con tope de entradas: al
 * pasarlo sale la más vieja (lo peor que pasa es una escritura de más).
 */
export class FrenoRecepcion {
  private vistos = new Map<string, { en: number; firma: string }>();
  constructor(
    private espacioMs = ESPACIO_ESCRITURA_MS,
    private tope = 5000
  ) {}

  toca(clave: string, firma: string, ahora = Date.now()): boolean {
    const v = this.vistos.get(clave);
    if (v && v.firma === firma && ahora - v.en < this.espacioMs) return false;
    this.vistos.delete(clave);
    this.vistos.set(clave, { en: ahora, firma });
    while (this.vistos.size > this.tope) this.vistos.delete(this.vistos.keys().next().value as string);
    return true;
  }

  /** La escritura falló: que la próxima petición lo vuelva a intentar. */
  olvidar(clave: string) {
    this.vistos.delete(clave);
  }

  get tamano() {
    return this.vistos.size;
  }
}

const frenoDelProceso = new FrenoRecepcion();

export const claveRecepcion = (correo: string) => claveDe(ESPACIO_RECEPCION, correo, 'clientes');

export type ResultadoRegistro = 'sin-cabecera' | 'invalida' | 'sin-cuenta' | 'frenada' | 'guardada' | 'fallo';

/**
 * Anota lo que dijo el cliente en el registro de ESA cuenta (la de la sesión: nunca la que diga el cliente). Para
 * esperar en pruebas; el servidor lo llama sin esperar. Nunca lanza.
 */
export async function registrarCliente(
  correo: string | null | undefined,
  cabecera: unknown,
  o: { almacen?: AlmacenDurable; freno?: FrenoRecepcion; ahora?: number } = {}
): Promise<ResultadoRegistro> {
  if (cabecera === undefined || cabecera === null || cabecera === '') return 'sin-cabecera';
  const d = leerDescriptor(cabecera);
  if (!d) return 'invalida';
  const c = String(correo || '').trim().toLowerCase();
  if (!c) return 'sin-cuenta';
  const freno = o.freno ?? frenoDelProceso;
  const ahora = o.ahora ?? Date.now();
  const clave = `${huellaDueno(c)}:${hashInstalacion(c, d.instalacion)}`;
  if (!freno.toca(clave, firmaBuild(d), ahora)) return 'frenada';
  try {
    const r = await modificarDurable<RegistroRecepcion>(claveRecepcion(c), (actual) => anotarCliente(actual, c, d, ahora), o.almacen ?? almacenDurable());
    if (r.ok) return 'guardada';
  } catch {
    /* abajo */
  }
  freno.olvidar(clave);
  return 'fallo';
}

/** Lo guardado de una cuenta. `ok: false` si el almacén no contestó (no es «no hay nada»). */
export async function clientesDe(correo: string, a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; clientes: RegistroCliente[] } | { ok: false; detalle: string }> {
  try {
    const l = await a.leer<RegistroRecepcion>(claveRecepcion(correo));
    if (l.ok === false) return { ok: false, detalle: l.detalle.replace(/https?:\/\/\S+/g, '[dirección]').slice(0, 120) };
    return { ok: true, clientes: registroValido(l.valor).clientes };
  } catch (e: any) {
    return { ok: false, detalle: String(e?.message || e).slice(0, 120) };
  }
}

/* ------------------------------------------------------------------ comparar con lo publicado */

export type Recibido = 'sí' | 'no' | 'desconocido';
export type EsperadoRecepcion = {
  /** El SHA del build web que sirve este servidor (dist/aura-build.json), o «desconocido». */
  webSha: string;
  /**
   * La OTA publicada para cada runtime, si el servidor la sabe. Hoy no la sabe (la publica EAS desde
   * .github/workflows/ota.yml y no le avisa): sin ella, el teléfono sale `esperado: desconocido`, honesto.
   */
  ota?: Record<string, string>;
};

export type ClienteVista = {
  plataforma: PlataformaCliente;
  version: string | null;
  build: string | null;
  runtime: string | null;
  updateId: string | null;
  canal: string | null;
  embebido: boolean | null;
  creada: string | null;
  webSha: string | null;
  os: string | null;
  /** Los 6 primeros del hash de la instalación: para distinguir dos aparatos, no para identificarlos. */
  instalacion: string;
  primero: string;
  visto: string;
  esperado: string;
  recibido: Recibido;
};

const DESCONOCIDO = 'desconocido';
/** Dos SHA de largo distinto (corto o completo) son el mismo si uno empieza por el otro (con al menos 7). */
const mismoSha = (a: string, b: string) => a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));

/** Lo que el servidor esperaría en ese cliente y si lo tiene. Puro. */
export function compararCliente(c: RegistroCliente, e: EsperadoRecepcion): { esperado: string; recibido: Recibido } {
  if (c.plataforma === 'web') {
    const sha = /^[0-9a-f]{7,40}$/i.test(e.webSha) ? e.webSha.toLowerCase() : null;
    if (!sha) return { esperado: DESCONOCIDO, recibido: DESCONOCIDO };
    if (!c.webSha) return { esperado: sha, recibido: DESCONOCIDO };
    return { esperado: sha, recibido: mismoSha(c.webSha, sha) ? 'sí' : 'no' };
  }
  if (c.plataforma === 'android' || c.plataforma === 'ios') {
    const ota = c.runtime && e.ota ? e.ota[c.runtime] : undefined;
    if (!ota) return { esperado: DESCONOCIDO, recibido: DESCONOCIDO };
    if (!c.updateId) return { esperado: ota, recibido: DESCONOCIDO };
    return { esperado: ota, recibido: c.updateId === ota.toLowerCase() ? 'sí' : 'no' };
  }
  // Windows: el .exe todavía no manda su build (windows/README.md).
  return { esperado: DESCONOCIDO, recibido: DESCONOCIDO };
}

/** Lo que enseña /api/build: cada instalación con lo esperado y si llegó. Puro. */
export function vistaClientes(clientes: RegistroCliente[], e: EsperadoRecepcion): ClienteVista[] {
  return clientes.map((c) => ({
    plataforma: c.plataforma,
    version: c.version ?? null,
    build: c.build ?? null,
    runtime: c.runtime ?? null,
    updateId: c.updateId ?? null,
    canal: c.canal ?? null,
    embebido: typeof c.embebido === 'boolean' ? c.embebido : null,
    creada: c.creada ?? null,
    webSha: c.webSha ?? null,
    os: c.os ?? null,
    instalacion: String(c.instalacion).slice(0, 6),
    primero: c.primero,
    visto: c.visto,
    ...compararCliente(c, e),
  }));
}
