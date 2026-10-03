/**
 * EL PERFIL DE LA PERSONA EN EL TELÉFONO: cómo le decimos, su avatar, su tema, su idioma, su
 * cumpleaños y lo que contó en la primera vez (la forma es `Perfil` de src/nucleo/contrato.ts).
 *
 * Un almacén de módulo con suscriptores (sin contexto de React), como el tema y el idioma: lo leen
 * la carcasa, la primera vez, Ajustes y la compañera, y las pantallas se redibujan con `usePerfil()`.
 *
 * De dónde sale y a dónde va:
 *   · CACHÉ LOCAL (AsyncStorage, una por correo): la app arranca con el perfil de la última vez sin
 *     esperar a la red, así el tema y el avatar ya están puestos cuando termina la intro.
 *   · SERVIDOR (`GET/PUT /api/perfil`, con la sesión de la mesa): la copia que lee el cerebro en
 *     cada turno para llamar a la persona por su apodo.
 * Cada cambio se aplica y se guarda local al instante, y después se manda. Si el servidor no está
 * (sin red, un 404 porque todavía no tiene la ruta, un 5xx), el cambio queda marcado como pendiente
 * y se reintenta solo (con espera creciente, al volver a cargar y al volver la app a primer plano).
 * NUNCA bloquea: la primera vez se termina y la mesa se abre aunque el servidor no conteste.
 *
 * Al cargarse o cambiar, el perfil SE APLICA: tema (`fijarTema`), idioma (`fijarIdioma`) y voz del
 * avatar (`setAvatarVoz`, más los ajustes del teléfono que lee la mesa), y se avisa por el bus
 * (`emitir('perfil', p)`) a quien escuche (la compañera, el relevo del contexto).
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { saveSettings } from './storage';
import { setAvatarVoz } from './tts';
import { normalizarAvatarId, type AvatarId } from '../avatares/catalogo';
import { fijarIdioma, idiomaActual, normalizarIdioma } from '../i18n';
import { emitir, NIVELES_INICIATIVA, RUTA_PERFIL, type Encuesta, type NivelIniciativa, type Perfil, type Tema } from '../nucleo/contrato';
import { fijarTema, temaElegido } from '../nucleo/tema';
import { normalizarPresencia } from '../avatar3d/presencia';

/* ── forma y reglas (puras: las prueba node) ─────────────────────────────────────────────── */

export const MAX_APODO = 40;
export const MAX_CAMPO_ENCUESTA = 300;
export const CAMPOS_ENCUESTA = ['vive', 'comida', 'musica', 'familia', 'trabajo', 'gustos', 'ayuda', 'otros'] as const;
export type CampoEncuesta = (typeof CAMPOS_ENCUESTA)[number];
const TEMAS: Tema[] = ['oscuro', 'claro', 'sistema'];
const DIAS_DEL_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Texto de una línea, sin caracteres de control y recortado (las mismas reglas que el servidor). */
export function textoLimpio(v: unknown, max: number): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** «MM-DD» de verdad (el 02-29 sí existe; el 02-30 no). Acepta también «AAAA-MM-DD» y toma mes y día. */
export function cumpleValido(v: unknown): string | null {
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const mes = Number(m[1]);
  const dia = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > DIAS_DEL_MES[mes - 1]) return null;
  return `${m[1]}-${m[2]}`;
}

/** «03-14» → «14 de marzo» / «March 14». */
export function cumpleLegible(cumple: string | undefined, idioma: 'es' | 'en' = idiomaActual()): string {
  const c = cumpleValido(cumple);
  if (!c) return '';
  const [m, d] = c.split('-').map(Number);
  const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return idioma === 'en' ? `${MESES_EN[m - 1]} ${d}` : `${d} de ${MESES_ES[m - 1]}`;
}

/** El primer nombre para saludar («ANA MARÍA LÓPEZ» → «Ana»). */
export function primerNombre(nombre: string | undefined): string {
  const p = textoLimpio(nombre, 120).split(' ')[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

/** El perfil con el que arranca quien todavía no contó nada (tema del sistema, como el servidor). */
export function perfilInicial(o: { apodo?: string; nombreGenesis?: string; cumple?: string; idioma?: 'es' | 'en'; avatar?: AvatarId; ahora?: number } = {}): Perfil {
  const p: Perfil = {
    apodo: textoLimpio(o.apodo, MAX_APODO) || primerNombre(o.nombreGenesis) || '',
    avatar: o.avatar ?? 'aura',
    tema: 'sistema',
    idioma: o.idioma ?? 'es',
    encuesta: {},
    completado: false,
    actualizado: o.ahora ?? 0,
  };
  const ng = textoLimpio(o.nombreGenesis, 120);
  if (ng) p.nombreGenesis = ng;
  const c = cumpleValido(o.cumple);
  if (c) p.cumple = c;
  return p;
}

/** Lo que venga (caché vieja, servidor, lo que sea) llevado a un Perfil válido; null si no se parece. */
export function normalizarPerfil(raw: unknown): Perfil | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const encuesta: Encuesta = {};
  const e = r.encuesta && typeof r.encuesta === 'object' && !Array.isArray(r.encuesta) ? (r.encuesta as Record<string, unknown>) : {};
  for (const k of CAMPOS_ENCUESTA) {
    const v = textoLimpio(e[k], MAX_CAMPO_ENCUESTA);
    if (v) encuesta[k] = v;
  }
  const p: Perfil = {
    apodo: textoLimpio(r.apodo, MAX_APODO),
    avatar: normalizarAvatarId(r.avatar),
    tema: TEMAS.includes(r.tema as Tema) ? (r.tema as Tema) : 'sistema',
    idioma: normalizarIdioma(r.idioma),
    encuesta,
    completado: r.completado === true,
    actualizado: Number.isFinite(Number(r.actualizado)) ? Number(r.actualizado) : 0,
  };
  const ng = textoLimpio(r.nombreGenesis, 120);
  if (ng) p.nombreGenesis = ng;
  const c = cumpleValido(r.cumple);
  if (c) p.cumple = c;
  const pr = normalizarPresencia(r.presencia);
  if (pr) p.presencia = pr;
  if (r.motorComputadora === 'gratis' || r.motorComputadora === 'pago') p.motorComputadora = r.motorComputadora;
  if (NIVELES_INICIATIVA.includes(r.iniciativa as NivelIniciativa)) p.iniciativa = r.iniciativa as NivelIniciativa;
  return p;
}

/**
 * Aplica cambios sobre un perfil. La encuesta se mezcla campo por campo (un campo vacío se borra);
 * `cumple: ''` lo borra; `nombreGenesis` solo lo pone el servidor, así que aquí se respeta el que hay
 * salvo que no hubiera ninguno (lo que llegó de Genesis en la entrada, antes de que conteste el servidor).
 */
export function aplicarCambios(base: Perfil, c: Partial<Perfil>, ahora: number): Perfil {
  const p: Perfil = { ...base, encuesta: { ...base.encuesta }, actualizado: ahora };
  if (c.apodo !== undefined) {
    const a = textoLimpio(c.apodo, MAX_APODO);
    if (a) p.apodo = a;
  }
  if (c.avatar !== undefined) p.avatar = normalizarAvatarId(c.avatar);
  if (c.tema !== undefined && TEMAS.includes(c.tema)) p.tema = c.tema;
  if (c.idioma !== undefined) p.idioma = normalizarIdioma(c.idioma);
  if (c.completado !== undefined) p.completado = !!c.completado;
  if (c.presencia !== undefined) {
    const pr = normalizarPresencia(c.presencia);
    if (pr) p.presencia = pr;
  }
  if (c.motorComputadora === 'gratis' || c.motorComputadora === 'pago') p.motorComputadora = c.motorComputadora;
  if (c.iniciativa !== undefined && NIVELES_INICIATIVA.includes(c.iniciativa)) p.iniciativa = c.iniciativa;
  if (c.nombreGenesis !== undefined && !base.nombreGenesis) {
    const ng = textoLimpio(c.nombreGenesis, 120);
    if (ng) p.nombreGenesis = ng;
  }
  if (c.cumple !== undefined) {
    const v = cumpleValido(c.cumple);
    if (v) p.cumple = v;
    else if (c.cumple === '' || c.cumple === null) delete p.cumple;
  }
  if (c.encuesta) {
    for (const k of CAMPOS_ENCUESTA) {
      if (!(k in c.encuesta)) continue;
      const v = textoLimpio(c.encuesta[k], MAX_CAMPO_ENCUESTA);
      if (v) p.encuesta[k] = v;
      else delete p.encuesta[k];
    }
  }
  return p;
}

/**
 * Lo que se manda en el PUT: solo lo que el servidor acepta (sin `actualizado` ni `nombreGenesis`,
 * que pone él) y la encuesta completa, para que un campo borrado aquí se borre allá.
 */
export function cuerpoPut(p: Perfil, cambios: Partial<Perfil>): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (cambios.apodo !== undefined && p.apodo) b.apodo = p.apodo;
  if (cambios.avatar !== undefined) b.avatar = p.avatar;
  if (cambios.tema !== undefined) b.tema = p.tema;
  if (cambios.idioma !== undefined) b.idioma = p.idioma;
  if (cambios.completado !== undefined) b.completado = p.completado;
  if (cambios.presencia !== undefined && p.presencia) b.presencia = p.presencia;
  if (cambios.motorComputadora !== undefined && p.motorComputadora) b.motorComputadora = p.motorComputadora;
  if (cambios.iniciativa !== undefined && p.iniciativa) b.iniciativa = p.iniciativa;
  if (cambios.cumple !== undefined) b.cumple = p.cumple || '';
  if (cambios.encuesta !== undefined) {
    const e: Record<string, string> = {};
    for (const k of CAMPOS_ENCUESTA) e[k] = p.encuesta[k] || '';
    b.encuesta = e;
  }
  return b;
}

/** Junta dos listas de cambios pendientes (lo nuevo pisa a lo viejo; la encuesta, campo por campo). */
export function juntarCambios(a: Partial<Perfil>, b: Partial<Perfil>): Partial<Perfil> {
  const r: Partial<Perfil> = { ...a, ...b };
  if (a.encuesta || b.encuesta) r.encuesta = { ...(a.encuesta || {}), ...(b.encuesta || {}) };
  return r;
}

/**
 * Lo que este teléfono sabe y el servidor no: el apodo, el cumpleaños, cada respuesta de la
 * encuesta y el «completado». Un servidor sin almacenamiento durable (Render sin S3) puede volver
 * vacío después de un redespliegue, y contestar un PUT con un perfil recién sembrado: eso no puede
 * borrar lo que la persona contó. Lo que falta allá se vuelve a mandar. Borrar algo se hace desde
 * aquí (se manda vacío a propósito), así que un hueco del servidor nunca es una orden de borrar…
 *
 * …salvo que el servidor MANDE (`servidorManda`, auditoría del 3-oct PRIV01): su almacén es durable y su
 * perfil es más nuevo que el último que vio este teléfono (las dos horas son del reloj del servidor). Ahí
 * el hueco es lo que se borró desde otro teléfono o la web, y reenviarlo desde esta caché lo resucitaba.
 */
export function huecosDelServidor(local: Perfil | null, servidor: Perfil | null, o: { servidorManda?: boolean; supresiones?: Supresiones } = {}): Partial<Perfil> {
  const h: Partial<Perfil> = {};
  if (!local || !servidor || o.servidorManda) return h;
  // …ni lo que el servidor MARCÓ como borrado (AUR11: `supresiones`, tenga o no un «visto» este teléfono).
  const sup = o.supresiones || {};
  if (local.apodo && !servidor.apodo) h.apodo = local.apodo;
  if (local.cumple && !servidor.cumple && !sup.cumple) h.cumple = local.cumple;
  if (local.completado && !servidor.completado) h.completado = true;
  const enc: Encuesta = {};
  for (const k of CAMPOS_ENCUESTA) if (local.encuesta[k] && !servidor.encuesta[k] && !sup[`encuesta.${k}`]) enc[k] = local.encuesta[k];
  if (Object.keys(enc).length) h.encuesta = enc;
  return h;
}

/* ── las marcas de supresión del servidor (AUR11) ─────────────────────────────────────────── */

/**
 * Cada respuesta borrada en la cuenta, con la hora de su marca (reloj del servidor): `{'encuesta.vive': …}`.
 * El servidor rechaza lo que llega sin hora o con una hora de antes; aquí se suelta esa copia vieja.
 */
export type Supresiones = Record<string, number>;
/** Cuándo se cambió aquí cada campo de lo pendiente (reloj del teléfono): va como `hechoEn` en el PUT. */
export type HorasPendientes = Record<string, number>;

const CAMPOS_CON_HORA = new Set<string>([...CAMPOS_ENCUESTA.map((k) => `encuesta.${k}`), 'cumple']);

/** Lo que mande el servidor, sano (solo campos del perfil con hora). */
export function supresionesDe(raw: unknown): Supresiones {
  const r: Supresiones = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return r;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (CAMPOS_CON_HORA.has(k) && Number(v) > 0) r[k] = Number(v);
  return r;
}

/** Los campos que tocan unos cambios: 'encuesta.vive', 'cumple'. */
export function camposDe(c: Partial<Perfil>): string[] {
  const r: string[] = [];
  for (const k of Object.keys(c.encuesta || {})) if (CAMPOS_CON_HORA.has(`encuesta.${k}`)) r.push(`encuesta.${k}`);
  if (c.cumple !== undefined) r.push('cumple');
  return r;
}

/** El `hechoEn` del PUT: la hora de cada campo de ESTE lote (no de toda la encuesta, que viaja entera). */
export function hechoEnDe(lote: Partial<Perfil>, horas: HorasPendientes): HorasPendientes {
  const r: HorasPendientes = {};
  for (const c of camposDe(lote)) if (horas[c] > 0) r[c] = horas[c];
  return r;
}

/** ¿Este campo de lo pendiente es una copia vieja? (lo cubre una marca y no se cambió aquí DESPUÉS de ella) */
const viejo = (campo: string, sup: Supresiones, horas: HorasPendientes) => !!sup[campo] && !(horas[campo] > sup[campo]);

/**
 * Lo pendiente sin las copias viejas de lo que el servidor borró (o rechazó: `rechazados`). Lo que se cambió
 * aquí después de la marca se queda. null si no queda nada.
 */
export function podarPendiente(p: Partial<Perfil> | null, sup: Supresiones, horas: HorasPendientes, rechazados: readonly string[] = []): Partial<Perfil> | null {
  if (!p) return null;
  const fuera = (campo: string) => rechazados.includes(campo) || viejo(campo, sup, horas);
  const r: Partial<Perfil> = { ...p };
  if (p.encuesta) {
    const e: Encuesta = { ...p.encuesta };
    // Vaciar (borrar) nunca es una copia vieja: solo se poda un valor.
    for (const k of Object.keys(e) as (keyof Encuesta)[]) if (e[k] && fuera(`encuesta.${k}`)) delete e[k];
    if (Object.keys(e).length) r.encuesta = e;
    else delete r.encuesta;
  }
  if (p.cumple && fuera('cumple')) delete r.cumple;
  return Object.keys(r).length ? r : null;
}

/** El perfil de este teléfono sin los valores que el servidor rechazó por una marca. */
export function sinRechazados(p: Perfil, rechazados: readonly string[]): Perfil {
  if (!rechazados.length) return p;
  const r: Perfil = { ...p, encuesta: { ...p.encuesta } };
  for (const c of rechazados) {
    if (c === 'cumple') delete r.cumple;
    else if (c.startsWith('encuesta.')) delete r.encuesta[c.slice('encuesta.'.length) as keyof Encuesta];
  }
  return r;
}

/**
 * Local contra servidor: manda el servidor en las preferencias (avatar, tema, idioma: pudieron
 * cambiarse desde la web u otro teléfono), pero lo que aquí se sabe y allá falta se conserva
 * (`huecosDelServidor`), y los cambios pendientes de este teléfono van encima de todo.
 */
export function fusionar(local: Perfil | null, servidor: Perfil | null, pendiente: Partial<Perfil> | null, o: { servidorManda?: boolean; supresiones?: Supresiones } = {}): Perfil | null {
  if (!servidor) return local;
  if (!local) return servidor;
  let base = servidor;
  if (!base.nombreGenesis && local.nombreGenesis) base = { ...base, nombreGenesis: local.nombreGenesis };
  // Cómo tener a AURA es de este teléfono mientras el servidor no lo guarde: un servidor que todavía no
  // conoce el campo no lo borra (ni se le reenvía para siempre, como a un hueco).
  if (!base.presencia && local.presencia) base = { ...base, presencia: local.presencia };
  const cambios = juntarCambios(huecosDelServidor(local, servidor, o), pendiente || {});
  if (!Object.keys(cambios).length) return base;
  return aplicarCambios(base, cambios, Math.max(local.actualizado, servidor.actualizado));
}

/* ── el almacén ──────────────────────────────────────────────────────────────────────────── */

const CLAVE = (correo: string) => `aura.perfil.v1:${correo.trim().toLowerCase()}`;
const CLAVE_PENDIENTE = (correo: string) => `aura.perfil.pendiente.v1:${correo.trim().toLowerCase()}`;
/** El `actualizado` (reloj del servidor) del último perfil que este teléfono recibió del servidor. */
const CLAVE_SERVIDOR = (correo: string) => `aura.perfil.servidor.v1:${correo.trim().toLowerCase()}`;
/** Cuándo se cambió aquí cada campo de lo pendiente (AUR11): una cola de antes de esto no la tiene. */
const CLAVE_HORAS = (correo: string) => `aura.perfil.pendiente.en.v1:${correo.trim().toLowerCase()}`;

let dueno = '';
/**
 * La generación del almacén: cambia al cambiar de dueño y al soltarlo. Toda operación asíncrona la
 * captura al empezar y la vuelve a mirar después de cada `await`: una lectura (local o del servidor)
 * que llega tarde, de otra persona o de una sesión anterior de la misma (A → B → A), no aplica nada.
 */
let generacion = 0;
let actual: Perfil | null = null;
let pendiente: Partial<Perfil> | null = null;
let reintento: ReturnType<typeof setTimeout> | null = null;
let espera = 4_000;
let enviando: Promise<void> | null = null;
/** El último lote que contestó el servidor y si quedó durable (para el recibo de `guardarPerfilConRecibo`). */
let ultimoRecibo: { lote: Partial<Perfil>; durable: boolean } | null = null;
/** El `actualizado` del último perfil recibido del servidor (0 = todavía ninguno en este teléfono). */
let vistoServidor = 0;
/** La hora (del teléfono) de cada campo pendiente: el servidor la compara con sus marcas de supresión. */
let horas: HorasPendientes = {};
/** Las marcas que dijo el servidor la última vez (AUR11): lo que cubren no se reenvía desde aquí. */
let supresiones: Supresiones = {};
/**
 * Dónde está lo último de esta persona:
 *   local     → solo en este teléfono (todavía no contestó el servidor);
 *   recibido  → el servidor lo tiene, pero dijo que NO quedó en almacenamiento durable (`durable:
 *               false`: sin S3, o S3 falló): un redespliegue lo puede perder, así que lo pendiente
 *               sigue pendiente y se reenvía;
 *   durable   → el servidor confirmó que quedó guardado de verdad.
 */
export type EstadoPerfil = 'local' | 'recibido' | 'durable';
let estado: EstadoPerfil = 'local';
const oyentes = new Set<() => void>();

function avisar() {
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* un oyente roto no rompe el almacén */
    }
  }
}

export function perfilActual(): Perfil | null {
  return actual;
}

/** Guardado de verdad en la cuenta: el servidor lo confirmó durable y no queda nada por mandar. */
export function perfilSincronizado(): boolean {
  return estado === 'durable' && !pendiente;
}

/** Para Ajustes y el perfil: local, recibido (sin garantía) o durable, y si queda algo por mandar. */
export function estadoPerfil(): { estado: EstadoPerfil; pendiente: boolean } {
  return { estado, pendiente: !!pendiente };
}

/** El perfil vigente; redibuja al cambiar. null mientras no hay sesión. */
export function usePerfil(): Perfil | null {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => actual,
    () => actual
  );
}

/** Quien escucha el almacén sin React (la carcasa, para el color de las barras). */
export function alCambiarPerfil(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** Lo que el perfil decide en el resto de la app. Solo toca lo que cambió. */
function aplicar(p: Perfil, antes: Perfil | null) {
  if (temaElegido() !== p.tema) fijarTema(p.tema);
  if (idiomaActual() !== p.idioma) fijarIdioma(p.idioma);
  if (!antes || antes.avatar !== p.avatar || antes.idioma !== p.idioma) {
    setAvatarVoz(p.avatar);
    // La mesa lee el avatar y el idioma de los ajustes del teléfono al abrirse.
    void saveSettings({ avatar: p.avatar, idioma: p.idioma, ...(p.completado ? { avatarElegido: true } : null) }).catch(() => {});
  }
}

function poner(p: Perfil) {
  const antes = actual;
  actual = p;
  aplicar(p, antes);
  avisar();
  emitir('perfil', p);
}

/**
 * Guarda en la caché de este teléfono. Claves y valores se toman ANTES del primer `await`: si mientras
 * escribe cambia la persona, lo que se escribe sigue siendo de quien era (y en su clave), nunca el
 * perfil de uno en la clave del otro.
 */
async function guardarLocal() {
  if (!dueno) return;
  const clave = CLAVE(dueno);
  const clavePendiente = CLAVE_PENDIENTE(dueno);
  const claveServidor = CLAVE_SERVIDOR(dueno);
  const claveHoras = CLAVE_HORAS(dueno);
  const perfil = JSON.stringify(actual);
  const lote = pendiente ? JSON.stringify(pendiente) : null;
  const visto = vistoServidor;
  // Solo las horas de lo que sigue pendiente (lo ya guardado no necesita hora).
  horas = pendiente ? hechoEnDe(pendiente, horas) : {};
  const conHora = horas;
  try {
    await AsyncStorage.setItem(clave, perfil);
    if (lote) await AsyncStorage.setItem(clavePendiente, lote);
    else await AsyncStorage.removeItem(clavePendiente);
    if (Object.keys(conHora).length) await AsyncStorage.setItem(claveHoras, JSON.stringify(conHora));
    else await AsyncStorage.removeItem(claveHoras);
    if (visto) await AsyncStorage.setItem(claveServidor, String(visto));
  } catch {
    /* sin almacenamiento, vive en memoria hasta que se pueda */
  }
}

function programarReintento() {
  if (reintento || !pendiente || !dueno) return;
  reintento = setTimeout(() => {
    reintento = null;
    void enviarPendiente();
  }, espera);
  espera = Math.min(espera * 2, 5 * 60_000);
}

/**
 * ¿Manda el servidor sobre los huecos? Solo si dijo que su almacén es durable y su perfil es más nuevo que
 * el último que vio este teléfono (ver `huecosDelServidor`). Sin nada visto todavía (una instalación que
 * viene de antes de esto), no: se sigue como siempre.
 */
function servidorManda(servidor: Perfil | null, durable: boolean): boolean {
  return durable && !!servidor && vistoServidor > 0 && servidor.actualizado > vistoServidor;
}

/** Lo visto del servidor (su `actualizado`), para la próxima vez. */
function anotarVisto(servidor: Perfil | null) {
  if (servidor && servidor.actualizado > vistoServidor) vistoServidor = servidor.actualizado;
}

/** Manda UN lote (lo pendiente de ahora) y devuelve qué se mandó y si quedó durable; null si falló. */
function enviarLote(): Promise<{ lote: Partial<Perfil>; durable: boolean } | null> {
  if (!pendiente || !actual || !dueno) return Promise.resolve(null);
  const gen = generacion;
  const lote = pendiente;
  // Cada campo de ESTE lote con la hora en que se cambió aquí (AUR11): sin hora, el servidor lo toma por una
  // copia vieja si una marca de supresión lo cubre.
  const hechoEn = hechoEnDe(lote, horas);
  const cuerpo = { ...cuerpoPut(actual, lote), ...(Object.keys(hechoEn).length ? { hechoEn } : {}) };
  let res: { lote: Partial<Perfil>; durable: boolean } | null = null;
  const p = (async () => {
    try {
      const r = await api<{ perfil?: unknown; durable?: boolean; suprimidos?: unknown; supresiones?: unknown }>(RUTA_PERFIL, { method: 'PUT', body: JSON.stringify(cuerpo) }, 12_000);
      if (gen !== generacion) return;
      const durable = r?.durable === true;
      res = { lote, durable };
      ultimoRecibo = res;
      estado = durable ? 'durable' : 'recibido';
      if (durable) espera = 4_000;
      // Lo que se cambió mientras viajaba este lote sigue pendiente; el lote mismo, solo si no quedó durable.
      if (durable) pendiente = pendiente === lote ? null : pendiente;
      // Lo que el servidor rechazó por una marca (una copia vieja) se suelta: ni pendiente ni aquí.
      const rechazados = (Array.isArray(r?.suprimidos) ? r.suprimidos : []).filter((c): c is string => typeof c === 'string');
      supresiones = { ...supresiones, ...supresionesDe(r?.supresiones) };
      pendiente = podarPendiente(pendiente, supresiones, horas, rechazados);
      if (rechazados.length && actual) actual = sinRechazados(actual, rechazados);
      const delServidor = normalizarPerfil(r?.perfil);
      const manda = servidorManda(delServidor, durable);
      const huecos = huecosDelServidor(actual, delServidor, { servidorManda: manda, supresiones });
      if (Object.keys(huecos).length) pendiente = juntarCambios(huecos, pendiente || {});
      if (delServidor && actual) {
        // El servidor devuelve el perfil entero: se toma su `actualizado` y lo que puso él (nombreGenesis).
        const junto = fusionar(actual, delServidor, pendiente, { servidorManda: manda, supresiones });
        if (junto) poner({ ...junto, actualizado: Math.max(junto.actualizado, actual.actualizado) });
      }
      anotarVisto(delServidor);
      await guardarLocal();
    } catch (e: any) {
      // 400 = el servidor no acepta ese valor: no se reintenta lo mismo para siempre.
      if (e?.status === 400 && gen === generacion) {
        ultimoRecibo = { lote, durable: false };
        pendiente = pendiente === lote ? null : pendiente;
        await guardarLocal();
      }
    }
  })();
  enviando = p;
  return p
    .finally(() => {
      if (enviando === p) enviando = null;
    })
    .then(() => res);
}

/**
 * Manda lo pendiente. Un fallo (404, 5xx, sin red) lo deja para después, sin avisar a nadie. El lote
 * sale de la cola SOLO con recibo durable del servidor (`durable: true`); con `durable: false` el
 * servidor lo tiene pero puede perderlo, y se reintenta (el PUT es idempotente: mismos valores).
 * Si ya va un envío, se espera, y lo que quedó pendiente detrás de él sale después.
 * Devuelve true si quedó durable.
 */
export async function enviarPendiente(): Promise<boolean> {
  while (enviando) await enviando;
  if (!pendiente || !actual || !dueno) return !pendiente && estado === 'durable';
  const r = await enviarLote();
  if (pendiente) programarReintento();
  return !!r?.durable;
}

/** ¿El lote lleva estos cambios, con estos mismos valores? */
function loteCubre(lote: Partial<Perfil>, cambios: Partial<Perfil>): boolean {
  for (const k of Object.keys(cambios) as (keyof Perfil)[]) {
    if (k === 'encuesta') {
      for (const [campo, v] of Object.entries(cambios.encuesta || {})) if ((lote.encuesta as Record<string, unknown> | undefined)?.[campo] !== v) return false;
    } else if (lote[k] !== cambios[k]) return false;
  }
  return true;
}

/**
 * Carga el perfil de `correo`: primero la caché (al instante, ya aplicada), después el servidor. Si
 * no hay nada en ningún lado, uno inicial con lo que se sepa (nombre y cumple de Genesis). Nunca
 * lanza. `esperarServidor: false` devuelve con la caché y deja al servidor terminar por detrás (la
 * intro no espera a la red si ya tiene perfil).
 */
export async function cargarPerfil(
  correo: string,
  o: { nombre?: string; genesis?: { nombre?: string | null; cumple?: string | null } | null; esperarServidor?: boolean; topeMs?: number } = {}
): Promise<Perfil> {
  const c = String(correo || '').trim().toLowerCase();
  if (c !== dueno) {
    dueno = c;
    generacion++;
    actual = null;
    pendiente = null;
    estado = 'local';
    espera = 4_000;
    ultimoRecibo = null;
    vistoServidor = 0;
    horas = {};
    supresiones = {};
    if (reintento) clearTimeout(reintento);
    reintento = null;
  }
  const gen = generacion;
  /** ¿Sigue siendo esta carga la de la persona que está dentro? Se mira después de cada `await`. */
  const vigente = () => gen === generacion && dueno === c;
  let local: Perfil | null = null;
  let pen: unknown = null;
  let visto = 0;
  let horasGuardadas: unknown = null;
  try {
    local = normalizarPerfil(JSON.parse((await AsyncStorage.getItem(CLAVE(c))) || 'null'));
    pen = JSON.parse((await AsyncStorage.getItem(CLAVE_PENDIENTE(c))) || 'null');
    visto = Number(await AsyncStorage.getItem(CLAVE_SERVIDOR(c))) || 0;
    horasGuardadas = JSON.parse((await AsyncStorage.getItem(CLAVE_HORAS(c))) || 'null');
  } catch {
    local = null;
  }
  // La lectura local llegó tarde (ya está otra persona, o esta misma en otra sesión): no se aplica.
  if (!vigente()) return (actual ?? perfilInicial({ ahora: Date.now() })) as Perfil;
  if (visto > vistoServidor) vistoServidor = visto;
  // Las horas guardadas con la cola (una cola de antes de esto no las tiene: el servidor la tratará como vieja).
  horas = { ...supresionesDe(horasGuardadas), ...horas };
  pendiente = pen && typeof pen === 'object' ? juntarCambios(pen as Partial<Perfil>, pendiente || {}) : pendiente;
  if (local) poner(local);

  const traer = (async () => {
    try {
      const r = await api<{ perfil?: unknown; durable?: boolean; disponible?: boolean; supresiones?: unknown }>(RUTA_PERFIL, undefined, o.topeMs ?? 8_000);
      if (!vigente()) return;
      // `disponible: false`: el servidor no pudo leer lo guardado (S3 caído). Un perfil null ahí no
      // quiere decir «no tiene perfil»: no se toma como respuesta, se sigue con lo local.
      if (r?.disponible === false) throw new Error('perfil no disponible');
      // El servidor tiene lo de esta persona; es durable solo si él lo dice (almacén durable) y aquí
      // no queda nada por mandar.
      if (estado !== 'durable') estado = r?.durable === true ? 'durable' : 'recibido';
      const servidor = normalizarPerfil(r?.perfil);
      // Las marcas de supresión (AUR11): lo que cubren y aquí no se cambió después ya no se manda.
      supresiones = supresionesDe(r?.supresiones);
      pendiente = podarPendiente(pendiente, supresiones, horas);
      // Lo que el servidor perdió (o nunca recibió) se le vuelve a mandar; lo que se borró en otro
      // teléfono (servidor durable y más nuevo que lo visto aquí, o con su marca) no.
      const manda = servidorManda(servidor, r?.durable === true);
      const huecos = huecosDelServidor(actual, servidor, { servidorManda: manda, supresiones });
      if (Object.keys(huecos).length) pendiente = juntarCambios(huecos, pendiente || {});
      const junto = fusionar(actual, servidor, pendiente, { servidorManda: manda, supresiones });
      if (junto) poner(junto);
      anotarVisto(servidor);
    } catch {
      /* 404, 5xx o sin red: se sigue con lo local */
    }
    if (!vigente()) return;
    if (!actual) {
      poner(
        perfilInicial({
          apodo: primerNombre(o.genesis?.nombre || undefined) || primerNombre(o.nombre),
          nombreGenesis: o.genesis?.nombre || undefined,
          cumple: o.genesis?.cumple || undefined,
          idioma: idiomaActual(),
          ahora: Date.now(),
        })
      );
    } else if (o.genesis && (!actual.nombreGenesis || !actual.cumple)) {
      // El servidor no sembró (o todavía no tiene la ruta): se llenan los huecos con lo de Genesis.
      const huecos: Partial<Perfil> = {};
      if (!actual.nombreGenesis && o.genesis.nombre) huecos.nombreGenesis = o.genesis.nombre;
      if (!actual.cumple && o.genesis.cumple && cumpleValido(o.genesis.cumple)) huecos.cumple = o.genesis.cumple;
      if (Object.keys(huecos).length) poner(aplicarCambios(actual, huecos, actual.actualizado));
    }
    await guardarLocal();
    if (vigente() && pendiente) void enviarPendiente();
  })();

  if (o.esperarServidor === false && actual) {
    void traer;
    return actual;
  }
  await traer;
  return actual as unknown as Perfil;
}

/**
 * Cambia el perfil: se aplica y se guarda aquí al momento, y se manda al servidor. Devuelve el perfil
 * nuevo sin esperar a la red. Sin perfil cargado (no hay sesión) solo aplica tema/idioma/avatar.
 */
export function guardarPerfil(cambios: Partial<Perfil>): Perfil | null {
  const nuevo = aplicarYEncolar(cambios);
  if (nuevo) void guardarLocal().then(() => enviarPendiente());
  return nuevo;
}

/** Aplica aquí y encola para el servidor. Sin perfil cargado solo aplica tema/idioma/avatar (null). */
function aplicarYEncolar(cambios: Partial<Perfil>): Perfil | null {
  if (!actual) {
    if (cambios.tema) fijarTema(cambios.tema);
    if (cambios.idioma) fijarIdioma(cambios.idioma);
    if (cambios.avatar) setAvatarVoz(cambios.avatar);
    return null;
  }
  const nuevo = aplicarCambios(actual, cambios, Math.max(Date.now(), actual.actualizado + 1));
  pendiente = juntarCambios(pendiente || {}, cambios);
  const ahora = Date.now();
  for (const c of camposDe(cambios)) horas[c] = ahora;
  poner(nuevo);
  return nuevo;
}

/**
 * Como `guardarPerfil`, pero ESPERA el recibo: true solo si el servidor confirmó que ESTOS cambios quedaron
 * en almacenamiento durable (auditoría del 3-oct, PRIV01: un borrado no se confirma en pantalla sin eso).
 * Aquí se aplica al momento igual; sin recibo (red caída, `durable: false`, 404, 5xx) queda pendiente y se
 * reintenta solo. Nunca lanza.
 */
export async function guardarPerfilConRecibo(cambios: Partial<Perfil>): Promise<boolean> {
  if (!aplicarYEncolar(cambios)) return false;
  const gen = generacion;
  try {
    await guardarLocal();
    // Hasta tres vueltas: un envío que ya iba (y no llevaba esto) se espera, y después sale lo nuestro.
    for (let i = 0; i < 3; i++) {
      while (enviando) await enviando;
      if (gen !== generacion) return false;
      if (!pendiente) return !!ultimoRecibo && ultimoRecibo.durable && loteCubre(ultimoRecibo.lote, cambios);
      const r = await enviarLote();
      if (gen !== generacion || !r) return false;
      if (loteCubre(r.lote, cambios)) return r.durable;
    }
    return false;
  } finally {
    if (gen === generacion && pendiente) programarReintento();
  }
}

/** Al volver la app a primer plano: si algo quedó sin mandar, otra vez. */
export function reintentarAhora() {
  if (!pendiente) return;
  if (reintento) clearTimeout(reintento);
  reintento = null;
  void enviarPendiente();
}

/** Al cerrar sesión: el perfil se suelta (la caché de esa persona se queda para su próxima entrada). */
export function soltarPerfil() {
  if (reintento) clearTimeout(reintento);
  reintento = null;
  dueno = '';
  generacion++;
  actual = null;
  pendiente = null;
  estado = 'local';
  ultimoRecibo = null;
  vistoServidor = 0;
  horas = {};
  supresiones = {};
  avisar();
}
