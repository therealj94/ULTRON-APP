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
import { emitir, RUTA_PERFIL, type Encuesta, type Perfil, type Tema } from '../nucleo/contrato';
import { fijarTema, temaElegido } from '../nucleo/tema';
import { normalizarPresencia } from '../avatar3d/presencia';

/* ── forma y reglas (puras: las prueba node) ─────────────────────────────────────────────── */

export const MAX_APODO = 40;
export const MAX_CAMPO_ENCUESTA = 300;
export const CAMPOS_ENCUESTA = ['vive', 'comida', 'musica', 'familia', 'trabajo', 'gustos', 'otros'] as const;
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
 * aquí (se manda vacío a propósito), así que un hueco del servidor nunca es una orden de borrar.
 */
export function huecosDelServidor(local: Perfil | null, servidor: Perfil | null): Partial<Perfil> {
  const h: Partial<Perfil> = {};
  if (!local || !servidor) return h;
  if (local.apodo && !servidor.apodo) h.apodo = local.apodo;
  if (local.cumple && !servidor.cumple) h.cumple = local.cumple;
  if (local.completado && !servidor.completado) h.completado = true;
  const enc: Encuesta = {};
  for (const k of CAMPOS_ENCUESTA) if (local.encuesta[k] && !servidor.encuesta[k]) enc[k] = local.encuesta[k];
  if (Object.keys(enc).length) h.encuesta = enc;
  return h;
}

/**
 * Local contra servidor: manda el servidor en las preferencias (avatar, tema, idioma: pudieron
 * cambiarse desde la web u otro teléfono), pero lo que aquí se sabe y allá falta se conserva
 * (`huecosDelServidor`), y los cambios pendientes de este teléfono van encima de todo.
 */
export function fusionar(local: Perfil | null, servidor: Perfil | null, pendiente: Partial<Perfil> | null): Perfil | null {
  if (!servidor) return local;
  if (!local) return servidor;
  let base = servidor;
  if (!base.nombreGenesis && local.nombreGenesis) base = { ...base, nombreGenesis: local.nombreGenesis };
  // Cómo tener a AURA es de este teléfono mientras el servidor no lo guarde: un servidor que todavía no
  // conoce el campo no lo borra (ni se le reenvía para siempre, como a un hueco).
  if (!base.presencia && local.presencia) base = { ...base, presencia: local.presencia };
  const cambios = juntarCambios(huecosDelServidor(local, servidor), pendiente || {});
  if (!Object.keys(cambios).length) return base;
  return aplicarCambios(base, cambios, Math.max(local.actualizado, servidor.actualizado));
}

/* ── el almacén ──────────────────────────────────────────────────────────────────────────── */

const CLAVE = (correo: string) => `aura.perfil.v1:${correo.trim().toLowerCase()}`;
const CLAVE_PENDIENTE = (correo: string) => `aura.perfil.pendiente.v1:${correo.trim().toLowerCase()}`;

let dueno = '';
let actual: Perfil | null = null;
let pendiente: Partial<Perfil> | null = null;
let reintento: ReturnType<typeof setTimeout> | null = null;
let espera = 4_000;
let enviando: Promise<void> | null = null;
/** El servidor contestó alguna vez en esta sesión (Ajustes lo muestra: «guardado en tu cuenta»). */
let sincronizado = false;
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

export function perfilSincronizado(): boolean {
  return sincronizado && !pendiente;
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

async function guardarLocal() {
  if (!dueno) return;
  try {
    await AsyncStorage.setItem(CLAVE(dueno), JSON.stringify(actual));
    if (pendiente) await AsyncStorage.setItem(CLAVE_PENDIENTE(dueno), JSON.stringify(pendiente));
    else await AsyncStorage.removeItem(CLAVE_PENDIENTE(dueno));
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

/** Manda lo pendiente. Un fallo (404, 5xx, sin red) lo deja para después, sin avisar a nadie. */
export async function enviarPendiente(): Promise<boolean> {
  if (enviando) {
    await enviando;
    return !pendiente;
  }
  if (!pendiente || !actual || !dueno) return !pendiente;
  const quien = dueno;
  const lote = pendiente;
  const cuerpo = cuerpoPut(actual, lote);
  let ok = false;
  enviando = (async () => {
    try {
      const r = await api<{ perfil?: unknown }>(RUTA_PERFIL, { method: 'PUT', body: JSON.stringify(cuerpo) }, 12_000);
      if (quien !== dueno) return;
      ok = true;
      sincronizado = true;
      espera = 4_000;
      // Lo que se cambió mientras viajaba este lote sigue pendiente.
      pendiente = pendiente === lote ? null : pendiente;
      const delServidor = normalizarPerfil(r?.perfil);
      const huecos = huecosDelServidor(actual, delServidor);
      if (Object.keys(huecos).length) pendiente = juntarCambios(huecos, pendiente || {});
      if (delServidor && actual) {
        // El servidor devuelve el perfil entero: se toma su `actualizado` y lo que puso él (nombreGenesis).
        const junto = fusionar(actual, delServidor, pendiente);
        if (junto) poner({ ...junto, actualizado: Math.max(junto.actualizado, actual.actualizado) });
      }
      await guardarLocal();
    } catch (e: any) {
      // 400 = el servidor no acepta ese valor: no se reintenta lo mismo para siempre.
      if (e?.status === 400) {
        pendiente = pendiente === lote ? null : pendiente;
        await guardarLocal();
      }
    }
  })();
  try {
    await enviando;
  } finally {
    enviando = null;
  }
  if (pendiente) programarReintento();
  return ok;
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
    actual = null;
    pendiente = null;
    sincronizado = false;
    espera = 4_000;
    if (reintento) clearTimeout(reintento);
    reintento = null;
  }
  let local: Perfil | null = null;
  try {
    local = normalizarPerfil(JSON.parse((await AsyncStorage.getItem(CLAVE(c))) || 'null'));
    const pen = JSON.parse((await AsyncStorage.getItem(CLAVE_PENDIENTE(c))) || 'null');
    pendiente = pen && typeof pen === 'object' ? (pen as Partial<Perfil>) : null;
  } catch {
    local = null;
  }
  if (local) poner(local);

  const traer = (async () => {
    try {
      const r = await api<{ perfil?: unknown }>(RUTA_PERFIL, undefined, o.topeMs ?? 8_000);
      if (dueno !== c) return;
      sincronizado = true;
      const servidor = normalizarPerfil(r?.perfil);
      // Lo que el servidor perdió (o nunca recibió) se le vuelve a mandar.
      const huecos = huecosDelServidor(actual, servidor);
      if (Object.keys(huecos).length) pendiente = juntarCambios(huecos, pendiente || {});
      const junto = fusionar(actual, servidor, pendiente);
      if (junto) poner(junto);
    } catch {
      /* 404, 5xx o sin red: se sigue con lo local */
    }
    if (dueno !== c) return;
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
    if (pendiente) void enviarPendiente();
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
  if (!actual) {
    if (cambios.tema) fijarTema(cambios.tema);
    if (cambios.idioma) fijarIdioma(cambios.idioma);
    if (cambios.avatar) setAvatarVoz(cambios.avatar);
    return null;
  }
  const nuevo = aplicarCambios(actual, cambios, Math.max(Date.now(), actual.actualizado + 1));
  pendiente = juntarCambios(pendiente || {}, cambios);
  poner(nuevo);
  void guardarLocal().then(() => enviarPendiente());
  return nuevo;
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
  actual = null;
  pendiente = null;
  sincronizado = false;
  avisar();
}
