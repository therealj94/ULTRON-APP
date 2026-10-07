/**
 * LOS RECORDATORIOS EN EL SERVIDOR (auditoría del 7-oct, A-3: «vivían solo en la tabla de alarmas de UN teléfono: sin
 * lista, sin sincronía, sin repetirse»).
 *
 * Ahora cada cuenta tiene su cajón de recordatorios, durable y aparte de las demás (por el CORREO de la sesión, como las
 * misiones: lib/misiones.ts cajonPorCorreo → caché, disco y S3 en el cubo de la memoria, `ultron/recordatorios/
 * <huella>.json`; la huella es un sha256 del correo, un listado del cubo no enseña correos). Cada recordatorio:
 *   · su texto, la hora de reloj de pared (HH:MM) en su zona (Honduras, UTC−6, por omisión: lib/zona-horaria.ts), la
 *     primera vez y cada cuánto se repite (lib/recurrencia.ts: diario, de lunes a viernes, cada semana el día X, cada mes
 *     el día N, con los fines de mes);
 *   · `proxima`: la próxima vez que suena (null si ya no hay: uno de una vez que ya sonó o que se marcó hecho);
 *   · `ultimaEntrega`: la última vez que el servidor lo entregó por push. Una vez nunca se entrega dos veces.
 *
 * El TELÉFONO sigue siendo el timbre (notifee, que suena aunque no haya red): pone la alarma de la próxima vez de cada
 * uno y lo reconcilia al abrir la app y al llegarle un push (mobile/src/compa/recordatoriosServidor.ts). El servidor
 * manda además un push (FCM, server/push.ts) a la hora: le llega a los demás aparatos de la cuenta y despierta al
 * teléfono para poner la vez siguiente. El teléfono no lo enseña si su alarma de ESA vez ya estaba puesta (no suena
 * dos veces).
 *
 * EL RELOJ (`RelojRecordatorios`): un temporizador ligero en el mismo proceso del servidor, sin servicio nuevo. Sobrevive
 * a un reinicio sin repetir: al arrancar lee el índice (qué cuentas tienen recordatorios y su próxima vez, otro cajón en
 * S3), y cada entrega se RECLAMA antes de mandarse (se guarda `ultimaEntrega` y la próxima vez) y además se marca una
 * sola vez en el registro durable (lib/envios.ts primeraVezEvento). Lo que se pasó mientras el servidor estaba caído
 * (más de `TOLERANCIA_MS`) no se manda tarde: se salta a la vez siguiente (el teléfono ya sonó con su alarma).
 */
import crypto from 'node:crypto';
import { AlmacenNoDisponible, cajonPorCorreo } from './misiones';
import { describirRepeticion, horaDe, siguienteVez, validarRepeticion, type Repeticion } from './recurrencia';
import { cuandoValido, MAX_RECORDATORIO, puedeMano, type RecordatorioApp } from './manos-app';
import { ZONA_POR_OMISION, zonaValida } from './zona-horaria';
import type { AccionApp, ContextoApp } from './acciones-app';

export { AlmacenNoDisponible as RecordatoriosNoDisponibles };

/** El id de un recordatorio del servidor: cabe en la forma de los del teléfono (`aura-rec-…`), así se cancela por voz igual. */
export const RE_ID_SERVIDOR = /^aura-rec-s[a-z0-9]{8,20}$/;
/** La alarma que el teléfono pone para una vez de un recordatorio del servidor: `<id>-<vez en base 36>`. */
export const RE_BASE_SERVIDOR = /^(aura-rec-s[a-z0-9]{8,20})-([a-z0-9]{1,12})$/;
export const MAX_RECORDATORIOS = 100;
/** Cuánto se recuerda lo borrado (para que los teléfonos quiten su alarma al reconciliar). */
export const BORRADOS_VIVEN_MS = 30 * 24 * 3600_000;
/** Lo que llega más tarde que esto (el servidor estuvo caído) no se manda: se salta a la vez siguiente. */
export const TOLERANCIA_MS = 10 * 60_000;
/** Uno de una vez que ya sonó y nadie marcó hecho se olvida pasado este tiempo. */
const SONADO_VIVE_MS = 30 * 24 * 3600_000;

export type RecordatorioServidor = {
  id: string;
  texto: string;
  /** La hora del reloj de pared en `zona` («07:00»). */
  hora: string;
  zona: string;
  /** La primera vez (instante). */
  primera: number;
  repetir: Repeticion;
  /** La próxima vez que suena; null si ya no hay. */
  proxima: number | null;
  llamada: boolean;
  /** Se marcó hecho (uno de una vez) o se terminó. */
  hecho: boolean;
  creado: number;
  actualizado: number;
  /** La última vez que el servidor lo entregó por push (nunca se entrega una vez <= esta). */
  ultimaEntrega?: number;
  /** La alarma vieja del teléfono que adoptó (para que el teléfono la cambie por la suya). */
  local?: string;
};

type Borrado = { id: string; t: number };
type CajonRecordatorios = { version: 1; recordatorios: RecordatorioServidor[]; borrados: Borrado[] };

const linea = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
const sinMarca = (s: string) => s.replace(/ACCI[OÓ]N_APP/gi, (m) => m.replace('_', '-'));

function sanearUno(x: unknown): RecordatorioServidor | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const id = String(r.id ?? '');
  const texto = sinMarca(linea(r.texto, MAX_RECORDATORIO));
  const zona = zonaValida(r.zona) || ZONA_POR_OMISION;
  const primera = Number(r.primera);
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.hora ?? '')) ? String(r.hora) : Number.isFinite(primera) ? horaDe(primera, zona) : '';
  const repetir = validarRepeticion(r.repetir, primera, zona) || { tipo: 'nunca' as const };
  if (!RE_ID_SERVIDOR.test(id) || !texto || !Number.isFinite(primera) || !hora) return null;
  const proxima = r.proxima === null || r.proxima === undefined ? null : Number(r.proxima);
  const ultima = Number(r.ultimaEntrega);
  const local = typeof r.local === 'string' && /^aura-rec-[a-z0-9-]{1,80}$/.test(r.local) ? r.local : undefined;
  return {
    id,
    texto,
    hora,
    zona,
    primera: Math.round(primera),
    repetir,
    proxima: proxima !== null && Number.isFinite(proxima) ? Math.round(proxima) : null,
    llamada: r.llamada === true,
    hecho: r.hecho === true,
    creado: Number(r.creado) || 0,
    actualizado: Number(r.actualizado) || 0,
    ...(Number.isFinite(ultima) && ultima > 0 ? { ultimaEntrega: Math.round(ultima) } : {}),
    ...(local ? { local } : {}),
  };
}

function sanear(x: unknown): CajonRecordatorios {
  const c = (x || {}) as Partial<CajonRecordatorios>;
  const vistos = new Set<string>();
  const recordatorios: RecordatorioServidor[] = [];
  for (const r of Array.isArray(c.recordatorios) ? c.recordatorios : []) {
    const s = sanearUno(r);
    if (!s || vistos.has(s.id)) continue;
    vistos.add(s.id);
    recordatorios.push(s);
  }
  const borrados = (Array.isArray(c.borrados) ? c.borrados : [])
    .filter((b) => b && RE_ID_SERVIDOR.test(String(b.id)) && Number.isFinite(Number(b.t)))
    .map((b) => ({ id: String(b.id), t: Number(b.t) }))
    .slice(-200);
  return { version: 1, recordatorios: recordatorios.slice(0, MAX_RECORDATORIOS * 2), borrados };
}

const almacen = cajonPorCorreo<CajonRecordatorios>({
  nombre: 'recordatorios',
  s3: 'ultron/recordatorios',
  dirEnv: 'ULTRON_RECORDATORIOS_DIR',
  dirDef: 'recordatorios',
  sanear,
  vacio: () => ({ version: 1, recordatorios: [], borrados: [] }),
  que: 'tus recordatorios',
});

/* ------------------------------------------------------------------ el índice (para el reloj) */

type Indice = { version: 1; cuentas: Record<string, number | null> };
const LLAVE_INDICE = 'indice@recordatorios.aura';
const indice = cajonPorCorreo<Indice>({
  nombre: 'recordatorios-indice',
  s3: 'ultron/recordatorios-indice',
  dirEnv: 'ULTRON_RECORDATORIOS_DIR',
  dirDef: 'recordatorios',
  sanear: (x) => {
    const c = ((x || {}) as Partial<Indice>).cuentas || {};
    const cuentas: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(c)) if (/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(k)) cuentas[k] = v === null || !Number.isFinite(Number(v)) ? null : Number(v);
    return { version: 1, cuentas };
  },
  vacio: () => ({ version: 1, cuentas: {} }),
  que: 'el índice de recordatorios',
});

/** La próxima vez de cada cuenta (en memoria; la fuente es el índice): lo que mira el reloj. */
const PROXIMAS = new Map<string, number | null>();
/** Lo último leído de cada cuenta (para el contexto del turno sin esperar a S3). */
const VISTOS = new Map<string, RecordatorioServidor[]>();
let alCambiar: (() => void) | null = null;

const normal = (c: string) => String(c || '').trim().toLowerCase();
const activos = (c: CajonRecordatorios) => c.recordatorios.filter((r) => !r.hecho);
const proximaDe = (c: CajonRecordatorios): number | null => {
  const ts = activos(c)
    .map((r) => r.proxima)
    .filter((t): t is number => t !== null);
  return ts.length ? Math.min(...ts) : null;
};

/** Después de cada cambio de una cuenta: su próxima vez en memoria y en el índice (si cambió). */
async function alGuardar(correo: string, c: CajonRecordatorios) {
  const k = normal(correo);
  VISTOS.set(k, c.recordatorios.map((r) => ({ ...r })));
  const p = proximaDe(c);
  const antes = PROXIMAS.has(k) ? PROXIMAS.get(k) : undefined;
  PROXIMAS.set(k, p);
  alCambiar?.();
  if (antes === p) return;
  try {
    await indice.modificar(LLAVE_INDICE, (i) => {
      if (p === null && !activos(c).length) delete i.cuentas[k];
      else i.cuentas[k] = p;
    });
  } catch (e: any) {
    console.warn('[recordatorios] no pude guardar el índice', String(e?.message || e).slice(0, 120));
  }
}

/* ------------------------------------------------------------------ lo que se pide */

export function nuevoIdServidor(): string {
  return `aura-rec-s${crypto.randomBytes(8).toString('hex').slice(0, 12)}`;
}

/** El id del recordatorio del servidor de un id o de la base de una alarma del teléfono (`<id>-<vez>`), o null. */
export function idServidorDe(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (RE_ID_SERVIDOR.test(s)) return s;
  const m = RE_BASE_SERVIDOR.exec(s);
  return m ? m[1] : null;
}

export class ErrorRecordatorio extends Error {
  constructor(
    msg: string,
    public codigo: 'no_esta' | 'no_vale' | 'lleno' = 'no_vale'
  ) {
    super(msg);
    this.name = 'ErrorRecordatorio';
  }
}

export type EntradaRecordatorio = {
  texto?: unknown;
  /** Epoch ms o «AAAA-MM-DDTHH:MM» en hora de Honduras (lib/manos-app.ts cuandoValido). */
  cuando?: unknown;
  repetir?: unknown;
  llamada?: unknown;
  zona?: unknown;
  /** Para adoptar (la alarma de un teléfono que no estaba en el servidor) o cumplir una acción con su `rid`. */
  id?: unknown;
  local?: unknown;
};

/** Cómo lo ve la app y la API: lo guardado, con su repetición dicha y si ya sonó. */
export type VistaRecordatorio = RecordatorioServidor & { repeticion: string; sonado: boolean };
const vista = (r: RecordatorioServidor): VistaRecordatorio => ({ ...r, repeticion: describirRepeticion(r.repetir), sonado: r.proxima === null && !r.hecho && !!r.ultimaEntrega });

function ordenar(xs: RecordatorioServidor[]): RecordatorioServidor[] {
  return [...xs].sort((a, b) => (a.proxima ?? Number.MAX_SAFE_INTEGER) - (b.proxima ?? Number.MAX_SAFE_INTEGER) || a.creado - b.creado);
}

/** Sus recordatorios (sin los hechos) y lo borrado hace poco. Lanza AlmacenNoDisponible si no se pudo leer. */
export async function listarRecordatoriosServidor(correo: string, ahora = Date.now()): Promise<{ recordatorios: VistaRecordatorio[]; borrados: string[] }> {
  const l = await almacen.leer(correo);
  if (!l.ok) throw new AlmacenNoDisponible('tus recordatorios');
  VISTOS.set(normal(correo), l.valor.recordatorios.map((r) => ({ ...r })));
  const recs = ordenar(l.valor.recordatorios.filter((r) => !r.hecho && !(r.proxima === null && r.ultimaEntrega && ahora - r.ultimaEntrega > SONADO_VIVE_MS)));
  return { recordatorios: recs.map(vista), borrados: l.valor.borrados.filter((b) => ahora - b.t <= BORRADOS_VIVEN_MS).map((b) => b.id) };
}

/** Lo que vale de una entrada para crear o editar (el texto, la primera vez, la repetición), o un error que se puede decir. */
function validarEntrada(e: EntradaRecordatorio, ahora: number, base?: RecordatorioServidor) {
  const zona = zonaValida(e.zona) || base?.zona || ZONA_POR_OMISION;
  const texto = e.texto === undefined && base ? base.texto : sinMarca(linea(e.texto, MAX_RECORDATORIO));
  if (!texto) throw new ErrorRecordatorio('Falta qué recordarte.');
  let primera = base?.primera ?? NaN;
  if (e.cuando !== undefined || !base) {
    const t = cuandoValido(e.cuando, ahora);
    if (t === null) throw new ErrorRecordatorio('Esa hora no vale: tiene que ser dentro de un rato y antes de un año.');
    primera = t;
  }
  const repetir = e.repetir === undefined && base ? (e.cuando !== undefined ? validarRepeticion(reDia(base.repetir), primera, zona) : base.repetir) : validarRepeticion(e.repetir, primera, zona);
  if (!repetir) throw new ErrorRecordatorio('No entendí cada cuánto se repite: diario, de lunes a viernes, cada semana o cada mes.');
  const llamada = e.llamada === undefined && base ? base.llamada : e.llamada === true;
  return { zona, texto, primera, repetir, llamada, hora: horaDe(primera, zona) };
}

/** Al cambiar la hora de uno semanal o mensual sin decir el día: el día sale de la hora nueva. */
const reDia = (r: Repeticion): unknown => (r.tipo === 'semanal' || r.tipo === 'mensual' ? r.tipo : r);

/**
 * Crea uno (o, con el `id` de uno que ya está, lo deja como estaba: la misma acción que llega dos veces, o el teléfono
 * que adopta su alarma dos veces, no lo duplica). Lanza ErrorRecordatorio o AlmacenNoDisponible.
 */
export async function crearRecordatorioServidor(correo: string, e: EntradaRecordatorio, ahora = Date.now()): Promise<{ recordatorio: VistaRecordatorio; durable: boolean; nuevo: boolean }> {
  const pedido = e.id === undefined || e.id === null || e.id === '' ? null : idServidorDe(e.id);
  if (e.id !== undefined && e.id !== null && e.id !== '' && !pedido) throw new ErrorRecordatorio('Ese id no tiene forma de recordatorio.');
  const v = validarEntrada(e, ahora);
  const local = typeof e.local === 'string' && /^aura-rec-[a-z0-9-]{1,80}$/.test(e.local) ? e.local : undefined;
  const { resultado, durable } = await almacen.modificar(correo, (c) => {
    if (pedido) {
      const ya = c.recordatorios.find((r) => r.id === pedido);
      if (ya) return { r: ya, nuevo: false };
      // Lo borrado no vuelve por una adopción tardía de un teléfono que no se había enterado.
      if (c.borrados.some((b) => b.id === pedido)) throw new ErrorRecordatorio('Ese recordatorio ya se borró.', 'no_esta');
    }
    // Una alarma vieja del teléfono que ya se adoptó: la misma.
    if (local) {
      const ya = c.recordatorios.find((r) => r.local === local);
      if (ya) return { r: ya, nuevo: false };
    }
    if (activos(c).length >= MAX_RECORDATORIOS) throw new ErrorRecordatorio(`Ya tienes ${MAX_RECORDATORIOS} recordatorios: borra alguno antes.`, 'lleno');
    const r: RecordatorioServidor = {
      id: pedido || nuevoIdServidor(),
      texto: v.texto,
      hora: v.hora,
      zona: v.zona,
      primera: v.primera,
      repetir: v.repetir,
      proxima: siguienteVez({ primera: v.primera, hora: v.hora, zona: v.zona, repetir: v.repetir }, ahora),
      llamada: v.llamada,
      hecho: false,
      creado: ahora,
      actualizado: ahora,
      ...(local ? { local } : {}),
    };
    c.recordatorios.push(r);
    limpiar(c, ahora);
    return { r, nuevo: true };
  });
  const l = await almacen.leer(correo);
  if (l.ok) await alGuardar(correo, l.valor);
  return { recordatorio: vista(resultado.r), durable, nuevo: resultado.nuevo };
}

/** Cambia el texto, la hora, la repetición o si llama. La próxima vez se recalcula. */
export async function editarRecordatorioServidor(correo: string, idDicho: string, cambios: EntradaRecordatorio, ahora = Date.now()): Promise<{ recordatorio: VistaRecordatorio; durable: boolean }> {
  const id = idServidorDe(idDicho);
  if (!id) throw new ErrorRecordatorio('No encuentro ese recordatorio.', 'no_esta');
  const { resultado, durable } = await almacen.modificar(correo, (c) => {
    const r = c.recordatorios.find((x) => x.id === id && !x.hecho);
    if (!r) throw new ErrorRecordatorio('No encuentro ese recordatorio.', 'no_esta');
    const v = validarEntrada(cambios, ahora, r);
    Object.assign(r, { texto: v.texto, hora: v.hora, zona: v.zona, primera: v.primera, repetir: v.repetir, llamada: v.llamada, actualizado: ahora });
    // La próxima vez, desde ahora (y nunca una que ya se entregó).
    r.proxima = siguienteVez(r, Math.max(ahora, r.ultimaEntrega ?? 0));
    return { ...r };
  });
  const l = await almacen.leer(correo);
  if (l.ok) await alGuardar(correo, l.valor);
  return { recordatorio: vista(resultado), durable };
}

/** Lo borra (y lo recuerda un tiempo como borrado, para que los teléfonos quiten su alarma). */
export async function borrarRecordatorioServidor(correo: string, idDicho: string, ahora = Date.now()): Promise<{ borrado: boolean; durable: boolean }> {
  const id = idServidorDe(idDicho);
  if (!id) return { borrado: false, durable: true };
  const { resultado, durable } = await almacen.modificar(correo, (c) => {
    const antes = c.recordatorios.length;
    c.recordatorios = c.recordatorios.filter((r) => r.id !== id);
    if (c.recordatorios.length === antes) return false;
    c.borrados = [...c.borrados.filter((b) => b.id !== id), { id, t: ahora }];
    limpiar(c, ahora);
    return true;
  });
  const l = await almacen.leer(correo);
  if (l.ok) await alGuardar(correo, l.valor);
  return { borrado: resultado, durable };
}

/** Lo que pasa al marcarlo hecho, con lo que se dice. */
export type ResultadoHecho = { recordatorio: VistaRecordatorio; durable: boolean };
/** Una vez que ya sonó y se marca hecha dentro de este tiempo es ESA (no se salta la siguiente). */
const HECHO_DE_LA_QUE_SONO_MS = 12 * 3600_000;

/**
 * Hecho. Uno de una vez queda hecho (sale de la lista). Uno que se repite: si acaba de sonar (hace menos de 12 h), es esa
 * vez y nada cambia; si no, se salta la próxima vez («ya fui al banco esta semana»).
 */
export async function marcarHechoServidor(correo: string, idDicho: string, ahora = Date.now()): Promise<ResultadoHecho> {
  const id = idServidorDe(idDicho);
  if (!id) throw new ErrorRecordatorio('No encuentro ese recordatorio.', 'no_esta');
  const { resultado, durable } = await almacen.modificar(correo, (c) => {
    const r = c.recordatorios.find((x) => x.id === id && !x.hecho);
    if (!r) throw new ErrorRecordatorio('No encuentro ese recordatorio.', 'no_esta');
    if (r.repetir.tipo === 'nunca') {
      r.hecho = true;
      r.proxima = null;
    } else if (!(r.ultimaEntrega && ahora - r.ultimaEntrega < HECHO_DE_LA_QUE_SONO_MS) && r.proxima !== null) {
      r.proxima = siguienteVez(r, r.proxima);
    }
    r.actualizado = ahora;
    return { ...r };
  });
  const l = await almacen.leer(correo);
  if (l.ok) await alGuardar(correo, l.valor);
  return { recordatorio: vista(resultado), durable };
}

function limpiar(c: CajonRecordatorios, ahora: number) {
  c.borrados = c.borrados.filter((b) => ahora - b.t <= BORRADOS_VIVEN_MS).slice(-200);
  c.recordatorios = c.recordatorios.filter((r) => !(r.hecho && ahora - r.actualizado > SONADO_VIVE_MS) && !(r.proxima === null && r.ultimaEntrega && ahora - r.ultimaEntrega > SONADO_VIVE_MS));
}

/* ------------------------------------------------------------------ la acción del turno (la voz) */

/**
 * Una acción `recordatorio` que sale a un teléfono que sincroniza con el servidor: se le pone su `rid` (el teléfono pone
 * la alarma de esa vez con ese id) antes de empujarla. Lo demás, igual.
 */
export function conRidServidor<A extends AccionApp>(a: A, ctx: ContextoApp | null | undefined): A & { rid?: string } {
  if (a.tipo !== 'recordatorio' || (a as { rid?: string }).rid || !puedeMano(ctx, 'recordatorios_servidor')) return a;
  return { ...a, rid: nuevoIdServidor() };
}

/**
 * Lo que una acción que SALIÓ deja en el servidor: un recordatorio con `rid` se guarda (con su repetición); un
 * `cancelar_recordatorio` de uno del servidor lo borra. Nunca lanza (lo cuenta el registro): el teléfono ya tiene su
 * alarma, y al reconciliar sube lo que no esté (mobile/src/compa/recordatoriosServidor.ts).
 */
export async function efectoServidorDeAccion(correo: string, a: AccionApp, ahora = Date.now()): Promise<void> {
  try {
    if (a.tipo === 'recordatorio' && a.rid && RE_ID_SERVIDOR.test(a.rid)) {
      await crearRecordatorioServidor(correo, { id: a.rid, texto: a.texto, cuando: a.cuando, llamada: a.llamada === true, repetir: a.repetir }, Math.min(ahora, a.cuando - 25_000));
    } else if (a.tipo === 'cancelar_recordatorio' && idServidorDe(a.id)) {
      await borrarRecordatorioServidor(correo, a.id, ahora);
    }
  } catch (e: any) {
    console.warn(`[recordatorios] no quedó en el servidor (${a.tipo})`, String(e?.message || e).slice(0, 120));
  }
}

/* ------------------------------------------------------------------ el contexto del turno */

/** Lo último leído de una cuenta, sin esperar (para el turno). */
export function recordatoriosEnCache(correo: string): RecordatorioServidor[] {
  return VISTOS.get(normal(correo)) || [];
}

/** Lee la cuenta para tenerla a mano en el turno siguiente. Nunca lanza. */
export function precargarRecordatorios(correo: string): void {
  const k = normal(correo);
  if (!k || VISTOS.has(k)) return;
  void almacen
    .leer(k)
    .then((l) => {
      if (l.ok) VISTOS.set(k, l.valor.recordatorios.map((r) => ({ ...r })));
    })
    .catch(() => undefined);
}

/**
 * El contexto del teléfono con sus recordatorios del servidor (lo que AU-RA dice y cancela por voz): los del servidor con
 * su próxima vez y su repetición dicha, y del teléfono solo los que no son del servidor (sus alarmas de cada vez van en
 * el del servidor). Solo con la mano `recordatorios_servidor`.
 */
export function contextoConRecordatorios(ctx: ContextoApp | null, correo: string, ahora = Date.now()): ContextoApp | null {
  if (!ctx || !puedeMano(ctx, 'recordatorios_servidor')) return ctx;
  const servidor = recordatoriosEnCache(correo).filter((r) => !r.hecho && r.proxima !== null && r.proxima > ahora - 60_000);
  if (!servidor.length && !(ctx.recordatorios || []).some((r) => idServidorDe(r.id))) return ctx;
  const delServidor: RecordatorioApp[] = servidor.map((r) => {
    const rep = describirRepeticion(r.repetir);
    return { id: r.id, texto: r.texto, cuando: r.proxima as number, llamada: r.llamada, ...(rep ? { repetir: rep } : {}) };
  });
  const locales = (ctx.recordatorios || []).filter((r) => !idServidorDe(r.id));
  return { ...ctx, recordatorios: [...delServidor, ...locales].sort((a, b) => a.cuando - b.cuando).slice(0, 20) };
}

/* ------------------------------------------------------------------ el reloj */

export type DepsReloj = {
  /** Manda el aviso de esa vez (FCM). true si salió a algún aparato. */
  enviar: (correo: string, r: RecordatorioServidor, vez: number) => Promise<boolean>;
  /** Una sola vez por (cuenta, id, vez) en el registro durable (lib/envios.ts primeraVezEvento). */
  unaVez?: (correo: string, clave: string) => Promise<boolean>;
  ahora?: () => number;
  /** Un temporizador (pruebas: falso). Devuelve cómo cancelarlo. */
  programar?: (f: () => void, ms: number) => () => void;
  toleranciaMs?: number;
};

/** Lo más que se espera entre una revisión y otra (aunque no haya nada: lo cambiado por otro camino se ve igual). */
const VUELTA_MAX_MS = 60_000;

/** Los datos del push de una vez (FCM: solo texto): el teléfono reconoce por `rid` y `cuando` si su alarma ya sonó. */
export function datosPushRecordatorio(r: Pick<RecordatorioServidor, 'id' | 'texto' | 'llamada'>, vez: number): { tipo: 'recordatorio' | 'llamada'; id: string; rid: string; cuando: string } & Record<string, string> {
  const id = `rec-${r.id.slice(9)}-${vez.toString(36)}`;
  return r.llamada ? { tipo: 'llamada', id, de: 'AURA', motivo: r.texto, rid: r.id, cuando: String(vez) } : { tipo: 'recordatorio', id, texto: r.texto, rid: r.id, cuando: String(vez) };
}

export class RelojRecordatorios {
  private cancelar: (() => void) | null = null;
  private vivo = false;
  private revisando: Promise<number> | null = null;
  private atrasadas = 0;
  private readonly ahora: () => number;
  private readonly programar: (f: () => void, ms: number) => () => void;
  private readonly tolerancia: number;

  constructor(private d: DepsReloj) {
    this.ahora = d.ahora || Date.now;
    this.tolerancia = d.toleranciaMs ?? TOLERANCIA_MS;
    this.programar =
      d.programar ||
      ((f, ms) => {
        const t = setTimeout(f, ms);
        t.unref?.();
        return () => clearTimeout(t);
      });
  }

  /** Al arrancar el servidor: el índice (de S3) y una primera revisión. Nunca lanza. */
  async arrancar(): Promise<void> {
    this.vivo = true;
    alCambiar = () => this.reprogramar();
    const i = await indice.leer(LLAVE_INDICE).catch(() => ({ ok: false }) as const);
    if (i.ok) {
      for (const [c, p] of Object.entries(i.valor.cuentas)) if (!PROXIMAS.has(c)) PROXIMAS.set(c, p);
    } else {
      console.warn('[recordatorios] no pude leer el índice: reviso cuando cambie alguno y lo vuelvo a leer en 5 min');
      // Revisión tanda E: sin el índice no salían los avisos del servidor hasta reiniciar; se vuelve a intentar.
      this.programar(() => {
        if (this.vivo) void this.arrancar().catch(() => undefined);
      }, 5 * 60_000);
    }
    await this.revisar().catch(() => 0);
    this.reprogramar();
  }

  parar() {
    this.vivo = false;
    this.cancelar?.();
    this.cancelar = null;
    if (alCambiar) alCambiar = null;
  }

  private reprogramar() {
    if (!this.vivo) return;
    this.cancelar?.();
    const ahora = this.ahora();
    const ts = [...PROXIMAS.values()].filter((t): t is number => t !== null);
    // Revisión tanda E: si lo atrasado sigue atrasado (S3 caído), no se reintenta cada segundo: 1 s, 2, 4… hasta 1 min.
    const minimo = ts.length ? Math.min(...ts) : Infinity;
    this.atrasadas = minimo <= ahora ? this.atrasadas + 1 : 0;
    const piso = this.atrasadas > 1 ? Math.min(60_000, 1_000 * 2 ** Math.min(6, this.atrasadas - 1)) : 1_000;
    const espera = ts.length ? Math.max(piso, Math.min(VUELTA_MAX_MS, minimo - ahora)) : VUELTA_MAX_MS;
    this.cancelar = this.programar(() => {
      void this.revisar()
        .catch(() => 0)
        .finally(() => this.reprogramar());
    }, espera);
  }

  /** Entrega lo que ya tocó en todas las cuentas. Devuelve cuántos avisos salieron. Una revisión a la vez. */
  revisar(): Promise<number> {
    if (this.revisando) return this.revisando;
    this.revisando = this.revisarYa().finally(() => {
      this.revisando = null;
    });
    return this.revisando;
  }

  private async revisarYa(): Promise<number> {
    const ahora = this.ahora();
    let enviados = 0;
    for (const [correo, p] of [...PROXIMAS.entries()]) {
      if (p === null || p > ahora) continue;
      enviados += await this.entregarCuenta(correo, ahora).catch((e) => {
        console.warn('[recordatorios] no pude revisar una cuenta', String(e?.message || e).slice(0, 120));
        return 0;
      });
    }
    return enviados;
  }

  /**
   * Las vencidas de UNA cuenta: primero se RECLAMAN (se guarda la entrega y la vez siguiente), después se mandan. Así un
   * reinicio a mitad nunca las manda dos veces (a lo sumo, una se pierde: el teléfono igual suena con su alarma).
   */
  async entregarCuenta(correo: string, ahora = this.ahora()): Promise<number> {
    const tolerancia = this.tolerancia;
    let salen: Array<{ r: RecordatorioServidor; vez: number }> = [];
    try {
      const { resultado } = await almacen.modificar(correo, (c) => {
        const out: Array<{ r: RecordatorioServidor; vez: number }> = [];
        for (const r of c.recordatorios) {
          if (r.hecho || r.proxima === null || r.proxima > ahora) continue;
          const vez = r.proxima;
          // Ya entregada (o una anterior): nunca otra vez. Se pone al día y nada más.
          if (r.ultimaEntrega !== undefined && vez <= r.ultimaEntrega) {
            r.proxima = siguienteVez(r, Math.max(ahora, r.ultimaEntrega));
            continue;
          }
          r.ultimaEntrega = vez;
          // Lo que se pasó mientras no había servidor no se repite: la siguiente es la que viene DESPUÉS de ahora.
          r.proxima = siguienteVez(r, Math.max(vez, ahora));
          r.actualizado = ahora;
          if (ahora - vez <= tolerancia) out.push({ r: { ...r }, vez });
        }
        return out;
      });
      salen = resultado;
    } catch (e) {
      if (e instanceof AlmacenNoDisponible) return 0;
      throw e;
    }
    const l = await almacen.leer(correo);
    if (l.ok) await alGuardar(correo, l.valor);
    let n = 0;
    for (const { r, vez } of salen) {
      const primera = this.d.unaVez ? await this.d.unaVez(correo, `${r.id}@${vez}`).catch(() => true) : true;
      if (!primera) continue;
      if (await this.d.enviar(correo, r, vez).catch(() => false)) n++;
    }
    return n;
  }
}

/* ------------------------------------------------------------------ pruebas */

export function _olvidarRecordatoriosServidor(o: { disco?: boolean } = {}) {
  almacen._olvidar();
  indice._olvidar();
  PROXIMAS.clear();
  VISTOS.clear();
  alCambiar = null;
  void o;
}

/** Pruebas: la próxima vez que el reloj tiene en memoria para una cuenta. */
export function _proximaEnMemoria(correo: string): number | null | undefined {
  return PROXIMAS.get(normal(correo));
}
