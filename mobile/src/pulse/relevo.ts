/**
 * El cliente del relevo de PULSE2CHAT (infra/mensajes en el repo de Orden Global), para AU-RA.
 *
 * Portado de `orden-global-app/src/og/mensajes.js`, con TRES diferencias que importan:
 *
 *   1. LA ENTRADA ES UN PASE DE GENESIS, no la sesión de la wallet. AU-RA no tiene esa sesión ni
 *      debe tenerla (abre la billetera entera). El relevo canjea el pase con Genesis y devuelve la
 *      llave de la cuenta de ESE correo —el que dice Genesis—. Así AU-RA es un aparato más de la
 *      misma persona: mismos contactos, mismas conversaciones.
 *   2. CADA PETICIÓN DE ESCUCHA DICE QUÉ APARATO ES (`aparato` = id de su llave). Sin eso, AU-RA y
 *      la app Orden Global se robaban el timbre y las respuestas de las llamadas.
 *   3. Sin grupos, pagos ni estados por ahora: conversaciones 1 a 1 cifradas, el círculo, buscar,
 *      fotos cifradas y llamadas. Lo que llega de un grupo se ve en su hilo si ya estaba.
 *
 * Y lo que se aprendió con la auditoría del 29-sep: lo ya abierto se guarda por id (el hilo se
 * sondea y Hermes, sin JIT, tardaba en volver a descifrar y verificar doscientos mensajes cada vez);
 * un mensaje mal formado ya no tumba la bandeja entera; la escucha larga de señales no pierde ninguna
 * al volver a primer plano; y las señales de llamada salen EN ORDEN y dicen por qué fallan.
 *
 * La regla del cifrado es la misma de allá: se cierra SIEMPRE; solo «la otra persona no tiene
 * ningún aparato publicado» baja a texto en claro, y ese mensaje queda marcado. Un fallo de red
 * NO baja a claro: se levanta como error de envío.
 */
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import * as CANDADO from './candado';
import type { Aparato, Bulto } from './candado';

const BASE = String((Constants.expoConfig?.extra as any)?.mensajesApi || 'https://cerebro.ordenscan.com/mensajes').replace(/\/+$/, '');
const CAJON_CUENTA = 'aura.p2c.cuenta';

export type Cuenta = { correo: string; llave: string };
let yo: Cuenta | null = null;
let aparato = '';

export type ErrorRelevo = Error & { code?: number; motivo?: string; correoReal?: string };

/**
 * Una petición al relevo. `senal` corta desde fuera (la escucha larga de /senales); el plazo `ms`
 * corta igual. Sin `code` = no hubo respuesta (red, plazo o corte).
 */
async function pedir<T = any>(ruta: string, body: unknown, ms = 15_000, senal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const alCortar = () => ctrl.abort();
  if (senal) {
    if (senal.aborted) ctrl.abort();
    else senal.addEventListener('abort', alCortar);
  }
  try {
    const res = await fetch(BASE + ruta, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e: ErrorRelevo = new Error(d.error || 'http ' + res.status);
      e.code = res.status;
      if (d.motivo) e.motivo = d.motivo;
      if (d.correoReal) e.correoReal = String(d.correoReal).toLowerCase();
      throw e;
    }
    return d as T;
  } finally {
    clearTimeout(t);
    senal?.removeEventListener('abort', alCortar);
  }
}

const firmado = (b: Record<string, unknown>) => ({ ...b, correo: yo?.correo, llave: yo?.llave });
const conAparato = (b: Record<string, unknown>) => (aparato ? { ...b, aparato } : b);

/** El id de ESTE aparato, siempre el del par vigente (si el llavero vuelve, cambia al guardado). */
async function miAparato(): Promise<string> {
  const m = await CANDADO.miLlave().catch(() => null);
  if (m?.id) aparato = m.id;
  return aparato;
}


/* ── la cuenta del chat en este teléfono ──────────────────────────────────────────────────── */

/** Limpiezas de otras piezas al salir (Genesis deja aquí la suya: importarla desde aquí daría un ciclo). */
const alSalirHacer = new Set<() => void>();
export function alSalir(f: () => void): () => void {
  alSalirHacer.add(f);
  return () => {
    alSalirHacer.delete(f);
  };
}

/** Quien quiera saber cuándo se entra o se sale de la cuenta (el proveedor, para redibujar). */
const oyentesCuenta = new Set<() => void>();
export function escucharCuenta(f: () => void): () => void {
  oyentesCuenta.add(f);
  return () => {
    oyentesCuenta.delete(f);
  };
}
function avisarCuenta() {
  for (const f of [...oyentesCuenta]) {
    try {
      f();
    } catch {
      /* un oyente roto no deja la cuenta a medias */
    }
  }
}

/**
 * Entra al chat con el pase de Genesis que trajo la wallet. Devuelve el correo de la cuenta.
 *
 * El NOMBRE no viaja en el alta: si la cuenta ya existía, el relevo lo pisaba con el de Genesis y el
 * nombre con el que la persona sale en el chat (el que eligió en la wallet o en la web) desaparecía
 * para todos sus contactos. Solo si la ficha quedó SIN nombre —cuenta recién hecha— se le pone el de
 * Genesis, aparte y después.
 */
export async function entrarConPase(pase: string, verificador: string, nombre?: string): Promise<Cuenta> {
  const d = await pedir<{ llave: string; correo: string }>('/alta', { pase, verificador });
  if (!d?.llave || !d?.correo) throw new Error('el relevo no devolvió la llave');
  yo = { correo: String(d.correo).toLowerCase(), llave: d.llave };
  await SecureStore.setItemAsync(CAJON_CUENTA, JSON.stringify(yo)).catch(() => {});
  publicadaPara = null;
  await publicarMiLlave().catch(() => null);
  const n = String(nombre || '').trim();
  if (n) {
    try {
      const f = await ficha(yo.correo);
      if (!String(f?.nombre || '').trim()) await pedir('/perfil', firmado({ nombre: n.slice(0, 80) }));
    } catch {
      /* sin nombre no pasa nada: se ve la parte de antes de la @ */
    }
  }
  avisarCuenta();
  return yo;
}

/** La cuenta que ya estaba en este teléfono, comprobada contra el relevo. null si no hay o no vale. */
export async function recuperar(): Promise<Cuenta | null> {
  if (yo) return yo;
  const g = await SecureStore.getItemAsync(CAJON_CUENTA).catch(() => null);
  if (!g) return null;
  try {
    const c = JSON.parse(g) as Cuenta;
    if (!c?.correo || !c?.llave) return null;
    yo = c;
    avisarCuenta();
    await publicarMiLlave();
    return yo;
  } catch (e: any) {
    // 401: la llave ya no vale (la cuenta se rehízo en otro lado). Se olvida y se pide entrar de nuevo.
    if (e?.code === 401) await salir();
    return e?.code === 401 ? null : yo;
  }
}

/** Sale del chat en este teléfono: corta la escucha, olvida la cuenta y todo lo abierto en memoria. */
export async function salir() {
  dejarDeEscuchar(true);
  yo = null;
  publicadaPara = null;
  aparato = '';
  llavero.clear();
  abiertosMsg.clear();
  vaciarArchivos();
  colas.clear();
  conocidas = [];
  circuloConocido = [];
  avisarConocidos();
  for (const f of [...alSalirHacer]) {
    try {
      f();
    } catch {
      /* una limpieza ajena que falla no deja la cuenta a medias */
    }
  }
  await SecureStore.deleteItemAsync(CAJON_CUENTA).catch(() => {});
  avisarCuenta();
}

export const quien = () => yo;

/* ── las llaves de los aparatos ───────────────────────────────────────────────────────────── */

/** `correo|id` de lo último publicado: si el par cambia (el llavero volvió), se publica el nuevo. */
let publicadaPara: string | null = null;

/** La pública de este teléfono se publica AL ENTRAR: si no, no podría RECIBIR nada cifrado. */
async function publicarMiLlave() {
  if (!yo) return;
  const mia = await CANDADO.miLlave();
  if (!mia) return;
  aparato = mia.id;
  // Un par VOLÁTIL (el llavero no se dejó leer, o no guardó) NO se publica: el próximo arranque
  // tendría otro, y publicarlo haría que nos cerraran mensajes para una llave que va a desaparecer.
  if (mia.volatil) return;
  const clave = yo.correo + '|' + mia.id;
  if (publicadaPara === clave) return;
  await pedir('/llaves/publicar', firmado({ id: mia.id, pub: mia.pub, fir: mia.fir || '' }));
  publicadaPara = clave;
}

/** ¿El par de este teléfono es solo de memoria? La pantalla lo dice («no se pudo usar el llavero»). */
export async function llaveVolatil(): Promise<boolean> {
  const m = await CANDADO.miLlave().catch(() => null);
  return !m || m.volatil;
}

const VIDA_LLAVES = 5 * 60 * 1000;
const llavero = new Map<string, { aparatos: Aparato[]; en: number }>();

async function llaveroDe(correos: string[]): Promise<Record<string, Aparato[]>> {
  const ahora = Date.now();
  const faltan = correos.filter((c) => {
    const g = llavero.get(c);
    return !g || ahora - g.en > VIDA_LLAVES;
  });
  if (faltan.length) {
    const r = await pedir<{ llaves?: Record<string, Aparato[]> }>('/llaves/de', firmado({ correos: faltan }));
    for (const c of faltan) {
      const aps = Array.isArray(r.llaves?.[c]) ? (r.llaves as Record<string, Aparato[]>)[c] : [];
      // EL VACÍO NO SE GUARDA: guardarlo haría salir en claro lo primero que se escriba al ser aceptado.
      if (aps.length) llavero.set(c, { aparatos: aps, en: ahora });
      else llavero.delete(c);
    }
  }
  const mapa: Record<string, Aparato[]> = {};
  for (const c of correos) mapa[c] = llavero.get(c)?.aparatos || [];
  return mapa;
}

type Cierre = { cerrado: Bulto } | { motivo: 'sin-llave-propia' | 'sin-red' | 'sin-aparatos' };

async function cerrarPara(para: string, texto: string): Promise<Cierre> {
  try {
    await publicarMiLlave();
  } catch {
    return { motivo: 'sin-llave-propia' };
  }
  const yoCorreo = yo?.correo || '';
  const conMios = !!yoCorreo && yoCorreo !== para;
  let mapa: Record<string, Aparato[]>;
  try {
    mapa = await llaveroDe(conMios ? [para, yoCorreo] : [para]);
  } catch {
    return { motivo: 'sin-red' };
  }
  const mia = await CANDADO.miLlave().catch(() => null);
  const suyos = (mapa[para] || []).filter((a) => !mia || a.id !== mia.id);
  if (!suyos.length) return { motivo: 'sin-aparatos' };
  // Mis OTROS aparatos (la app Orden Global, la web) llevan sobre también: sin él, lo que mando desde
  // AU-RA se ve allá como «cifrado para otro de tus aparatos».
  const mios = conMios ? mapa[yoCorreo] || [] : [];
  try {
    return { cerrado: await CANDADO.cerrar(texto, [...suyos, ...mios]) };
  } catch {
    return { motivo: 'sin-llave-propia' };
  }
}

/* ── mensajes ─────────────────────────────────────────────────────────────────────────────── */

export type Mensaje = {
  id: string;
  de: string;
  para: string;
  cuando: number;
  texto: string;
  e2e?: boolean;
  cerrado?: boolean;
  verificado?: boolean;
  borrado?: boolean;
  tipo?: string;
  archivo?: string;
  nombre?: string;
  llaveArchivo?: string;
  ivArchivo?: string;
  cita?: string;
};

/** Un grupo no se escribe desde AU-RA: sin llaves de grupo, el mensaje saldría en claro. */
function soloPersonas(para: string) {
  if (!/^[^@\s]+@[^@\s]+$/.test(para)) {
    const e: ErrorRelevo = new Error('solo conversaciones con personas');
    e.motivo = 'no-es-persona';
    throw e;
  }
}

/** Envía un texto, cerrado siempre que se pueda. `e2e:false` = salió en claro (y se dice). */
export async function enviar(para: string, texto: string): Promise<{ ok: true; e2e: boolean; id?: string }> {
  para = String(para || '').toLowerCase();
  soloPersonas(para);
  const r = await cerrarPara(para, texto);
  if ('cerrado' in r) {
    const d = await pedir<{ id?: string }>('/enviar', firmado({ para, cif: r.cerrado }));
    return { ok: true, e2e: true, id: d?.id };
  }
  if (r.motivo !== 'sin-aparatos') {
    const e: ErrorRelevo = new Error('no se pudo cifrar: ' + r.motivo);
    e.motivo = r.motivo;
    throw e;
  }
  const d = await pedir<{ id?: string }>('/enviar', firmado({ para, texto: CANDADO.sanearTexto(texto) }));
  return { ok: true, e2e: false, id: d?.id };
}

/**
 * Sube una foto cifrada (la llave viaja DENTRO del mensaje cifrado) y la manda.
 *
 * PRIMERO se cierra el mensaje con la llave de la foto y SOLO si se pudo se suben los bytes: antes se
 * subía siempre, y si no había a quién cerrárselo quedaban en el relevo unos bytes cifrados cuya llave
 * no iba a llegar nunca. Sin aparato del otro lado la foto no sale (y el error lo dice: `motivo`).
 */
export async function enviarFoto(para: string, base64: string, mime = 'image/jpeg', texto = ''): Promise<{ ok: true; e2e: true; id?: string }> {
  para = String(para || '').toLowerCase();
  soloPersonas(para);
  const c = CANDADO.cerrarBytes(deB64Simple(base64));
  const carga = '{' + JSON.stringify({ t: CANDADO.sanearTexto(texto), k: c.llave, iv: c.iv });
  const r = await cerrarPara(para, carga);
  if (!('cerrado' in r)) {
    const e: ErrorRelevo = new Error('no se pudo cifrar: ' + r.motivo);
    e.motivo = r.motivo;
    throw e;
  }
  const sub = await pedir<{ id: string }>('/subir', firmado({ nombre: 'foto.jpg', tipo: 'imagen', mime, datos: aB64Simple(c.bytes) }), 120_000);
  const d = await pedir<{ id?: string }>('/enviar', firmado({ para, tipo: 'imagen', archivo: sub.id, nombre: 'foto.jpg', cif: r.cerrado }));
  return { ok: true, e2e: true, id: d?.id };
}

/* ── abrir lo que llega, una vez por mensaje ──────────────────────────────────────────────── */

/**
 * Lo ya abierto, por id. El hilo se sondea cada pocos segundos y el relevo devuelve SIEMPRE la última
 * página (hasta 200; `/bandeja` solo sabe ir hacia atrás con `antes`, no «lo nuevo desde»): sin esto
 * se volvían a descifrar y verificar los doscientos en cada vuelta, en JS puro y sin JIT. Se guarda
 * con el `ct` del bulto y el aparato que lo abrió: si cualquiera cambia, se abre de nuevo.
 */
type Guardado = { ct: string; yoId: string; m: Mensaje };
const abiertosMsg = new Map<string, Guardado>();
const TOPE_ABIERTOS = 2000;
// Solo se recuerdan veredictos que no cambian: un «llave no publicada» puede volverse bueno cuando el
// remitente publique, y se vuelve a juzgar.
const VEREDICTO_FIJO = new Set(['', 'sin-firma', 'firma-rota', 'firma-ilegible']);

const idDe = (m: any): string => (typeof m?.id === 'string' && m.id ? m.id : `${String(m?.de || '')}-${Number(m?.cuando) || 0}`);

function base(m: any): Mensaje {
  const { cif: _c, ...resto } = m || {};
  return {
    ...resto,
    id: idDe(m),
    de: String(m?.de || '').toLowerCase(),
    para: String(m?.para || '').toLowerCase(),
    cuando: Number(m?.cuando) || 0,
    texto: typeof m?.texto === 'string' ? m.texto : '',
  } as Mensaje;
}

async function abrirUno(m: any, aparatos: Aparato[], yoId: string): Promise<Mensaje> {
  const b = base(m);
  if (m.borrado) return { ...b, texto: '' };
  if (!m.cif) return { ...b, e2e: false };
  const r = await CANDADO.abrir(m.cif, aparatos);
  let salida: Mensaje;
  if (r == null) {
    salida = { ...b, texto: '', cerrado: true, e2e: true };
  } else {
    let texto = r.texto;
    let extra: Partial<Mensaje> = {};
    if (texto.startsWith('{')) {
      try {
        const j = JSON.parse(texto.slice(1));
        texto = typeof j.t === 'string' ? j.t : '';
        extra = {
          ...(typeof j.k === 'string' && typeof j.iv === 'string' ? { llaveArchivo: j.k, ivArchivo: j.iv } : {}),
          ...(j.c ? { cita: String(j.c).slice(0, 16) } : {}),
        };
      } catch {
        /* texto normal que empieza raro */
      }
    }
    salida = { ...b, texto, e2e: true, verificado: r.verificado, ...extra };
  }
  if (r == null || VEREDICTO_FIJO.has(r.motivo)) {
    abiertosMsg.set(b.id, { ct: String(m.cif?.ct ?? ''), yoId, m: salida });
    if (abiertosMsg.size > TOPE_ABIERTOS) abiertosMsg.delete(abiertosMsg.keys().next().value as string);
  }
  return salida;
}

/** El que ya estaba abierto, con los campos del relevo al día (borrado, reacciones…). */
function yaAbierto(m: any, yoId: string): Mensaje | null {
  if (!m?.cif || m.borrado) return null;
  const g = abiertosMsg.get(idDe(m));
  if (!g || g.yoId !== yoId || g.ct !== String(m.cif?.ct ?? '')) return null;
  // Al final del mapa: lo usado hace poco es lo último en salir.
  abiertosMsg.delete(g.m.id);
  abiertosMsg.set(g.m.id, g);
  const { cif: _c, texto: _t, ...resto } = m;
  return { ...resto, ...g.m };
}

const respirar = () => new Promise<void>((r) => setTimeout(r, 0));

/** Cuántos mensajes se abrieron de verdad (sin caché) desde que arrancó: lo miran las pruebas. */
let abiertosDeVerdad = 0;
export const _abiertosDeVerdad = () => abiertosDeVerdad;

/**
 * Abre una lista de mensajes crudos del relevo. Un mensaje malo sale `cerrado` y los demás se ven.
 * Cada tanto se suelta el hilo de JS para que la pantalla no se congele con el primer hilo largo.
 */
async function abrirCrudos(crudos: any[]): Promise<Mensaje[]> {
  const mia = await CANDADO.miLlave().catch(() => null);
  const yoId = mia?.id || '';
  const salida: (Mensaje | null)[] = crudos.map((m) => {
    if (!m || typeof m !== 'object') return null;
    try {
      return yaAbierto(m, yoId);
    } catch {
      return null;
    }
  });
  const faltan = crudos.map((m, i) => (salida[i] == null && m && typeof m === 'object' ? i : -1)).filter((i) => i >= 0);
  const deQuienes = [
    ...new Set(
      faltan
        .map((i) => crudos[i])
        .filter((m) => m.cif && !m.borrado && typeof m.de === 'string')
        .map((m) => String(m.de).toLowerCase())
    ),
  ];
  let llaves: Record<string, Aparato[]> = {};
  if (deQuienes.length) {
    try {
      llaves = await llaveroDe(deQuienes);
    } catch {
      llaves = {};
    }
  }
  let hechos = 0;
  // Del más nuevo al más viejo: si algo tarda, lo que se ve primero es lo último que llegó.
  for (let k = faltan.length - 1; k >= 0; k--) {
    const i = faltan[k];
    const m = crudos[i];
    try {
      if (m.cif && !m.borrado) abiertosDeVerdad++;
      salida[i] = await abrirUno(m, llaves[String(m.de || '').toLowerCase()] || [], yoId);
    } catch {
      salida[i] = { ...base(m), texto: '', cerrado: true, e2e: true };
    }
    if (m.cif && ++hechos % 12 === 0) await respirar();
  }
  return salida.filter((m): m is Mensaje => m != null);
}

export type Bandeja = { mensajes: Mensaje[]; hayMas: boolean; leidoHasta: number; enLinea?: boolean };

/** La bandeja de un hilo, con los sobres ya abiertos (la pantalla no sabe de criptografía). */
export async function bandeja(desde: string, antes?: number): Promise<Bandeja> {
  desde = String(desde || '').toLowerCase();
  const d = await pedir<any>('/bandeja', firmado(antes ? { desde, antes } : { desde }));
  const crudos: any[] = Array.isArray(d?.mensajes) ? d.mensajes : [];
  const mensajes = await abrirCrudos(crudos);
  return { mensajes, hayMas: d.hayMas === true, leidoHasta: Number(d.leidoHasta) || 0, enLinea: d.enLinea === true };
}

/* ── conversaciones, círculo y a quién se puede escribir ─────────────────────────────────── */

export type Persona = { correo: string; nombre: string; gid?: string; foto?: string; enLinea?: boolean; nota?: string; lazo?: string; en?: number };
export type Conversacion = Persona & { sinLeer: number; ultimo: Mensaje | null; esGrupo?: boolean };
export type Circulo = { amigos: Persona[]; recibidas: Persona[]; enviadas: Persona[] };

const nombreDe = (p: any) => String(p?.nombre || '').trim() || String(p?.correo || '').split('@')[0];

function persona(x: any): Persona {
  return {
    correo: String(x.correo).toLowerCase(),
    nombre: nombreDe(x),
    ...(x.gid ? { gid: String(x.gid) } : {}),
    ...(x.foto ? { foto: String(x.foto) } : {}),
    ...(x.enLinea ? { enLinea: true } : {}),
    ...(x.nota ? { nota: String(x.nota) } : {}),
    ...(x.lazo ? { lazo: String(x.lazo) } : {}),
    ...(x.en ? { en: Number(x.en) || 0 } : {}),
  };
}

let conocidas: Conversacion[] = [];
let circuloConocido: Persona[] = [];
const oyentesConocidos = new Set<() => void>();
function avisarConocidos() {
  for (const f of [...oyentesConocidos]) {
    try {
      f();
    } catch {
      /* nada */
    }
  }
}
/** Avisa cuando cambian los contactos conocidos (para mandarle el contexto al cerebro). */
export function escucharConocidos(f: () => void): () => void {
  oyentesConocidos.add(f);
  return () => {
    oyentesConocidos.delete(f);
  };
}

/** Todas mis charlas con lo último dicho YA ABIERTO. Los grupos vienen marcados (`esGrupo`). */
export async function conversaciones(): Promise<Conversacion[]> {
  const d = await pedir<{ conversaciones?: any[] }>('/conversaciones', firmado({}));
  const crudas = (Array.isArray(d?.conversaciones) ? d.conversaciones : []).filter((x) => x && typeof x.correo === 'string');
  const conUltimo = crudas.map((x, i) => (x.ultimo && typeof x.ultimo === 'object' ? i : -1)).filter((i) => i >= 0);
  const abiertos = await abrirCrudos(conUltimo.map((i) => crudas[i].ultimo));
  const ultimos = new Map<number, Mensaje>();
  conUltimo.forEach((i, k) => abiertos[k] && ultimos.set(i, abiertos[k]));
  const lista: Conversacion[] = crudas.map((x, i) => ({
    ...persona(x),
    sinLeer: Number(x.sinLeer) || 0,
    ultimo: ultimos.get(i) || null,
    ...(x.esGrupo ? { esGrupo: true } : {}),
  }));
  conocidas = lista.filter((c) => !c.esGrupo);
  avisarConocidos();
  return lista;
}

export async function circulo(): Promise<Circulo> {
  const d = await pedir<{ recibidas?: any[]; enviadas?: any[]; amigos?: any[] }>('/amistad/lista', firmado({}));
  const lista = (v: unknown) => (Array.isArray(v) ? v : []).filter((x) => x && typeof x.correo === 'string').map(persona);
  const c = { amigos: lista(d?.amigos), recibidas: lista(d?.recibidas), enviadas: lista(d?.enviadas) };
  circuloConocido = c.amigos;
  avisarConocidos();
  return c;
}

/** A quién le puede escribir la persona (lo que el cerebro necesita para «escríbele a mi mamá»). */
export function contactosConocidos(): { correo: string; nombre: string }[] {
  const vistos = new Map<string, { correo: string; nombre: string }>();
  for (const p of [...conocidas, ...circuloConocido]) if (!vistos.has(p.correo)) vistos.set(p.correo, { correo: p.correo, nombre: p.nombre });
  return [...vistos.values()];
}

/** Minúsculas y sin acentos: «María» y «maria» son la misma. */
export const normalizar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const arriba = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = arriba;
    }
  }
  return fila[b.length];
}

/**
 * Quién es «con»: correo exacto, nombre exacto o parecido (sin acentos, una palabra del nombre, el
 * principio, o una letra mal oída por la voz). Entre las conversaciones y el círculo conocidos; si dos
 * empatan gana la charla más reciente (las conversaciones vienen ordenadas así).
 */
export function resolverContacto(con: string): { correo: string; nombre: string } | null {
  const q = normalizar(con);
  if (!q) return null;
  const lista = contactosConocidos();
  const porCorreo = lista.find((p) => p.correo === q);
  if (porCorreo) return porCorreo;
  let mejor: { correo: string; nombre: string } | null = null;
  let puntos = 0;
  for (const p of lista) {
    const n = normalizar(p.nombre);
    const palabras = n.split(' ');
    const local = p.correo.split('@')[0];
    let v = 0;
    if (n === q) v = 100;
    else if (local === q) v = 90;
    else if (n.startsWith(q + ' ') || palabras.includes(q)) v = 80;
    else if (q.includes(' ') && n.includes(q)) v = 70;
    else if (q.length >= 3 && (n.startsWith(q) || palabras.some((w) => w.startsWith(q)))) v = 60;
    else if (q.length >= 3 && local.startsWith(q)) v = 50;
    else if (q.length >= 4 && palabras.some((w) => w.length >= 4 && distancia(w, q) <= (q.length >= 7 ? 2 : 1))) v = 40;
    if (v > puntos) {
      puntos = v;
      mejor = p;
    }
  }
  return mejor;
}

export const buscar = async (q: string): Promise<Persona[]> => {
  const d = await pedir<{ gente?: any[]; resultados?: any[] }>('/buscar', firmado({ q }));
  return ((d?.gente || d?.resultados || []) as any[]).filter((x) => x && typeof x.correo === 'string' && x.correo !== yo?.correo).map(persona);
};
export const pedirAmistad = (para: string, nota = '') => pedir<{ estado?: string }>('/amistad/pedir', firmado({ para: String(para).toLowerCase(), nota }));
export const responderAmistad = async (de: string, aceptar: boolean) => {
  const r = await pedir('/amistad/responder', firmado({ de, aceptar }));
  if (aceptar) llavero.delete(String(de || '').toLowerCase());
  return r;
};
export const leido = (de: string) => pedir('/leido', firmado({ de })).catch(() => null);
export const ficha = (de: string) => pedir<any>('/ficha', firmado({ de }));

/** El código de seguridad con alguien: si coincide en los dos teléfonos, no hay nadie en medio. */
export async function codigoCon(correo: string): Promise<string | null> {
  if (!yo) return null;
  const r = await pedir<{ llaves?: Record<string, Aparato[]> }>('/llaves/de', firmado({ correos: [yo.correo, correo] }));
  const mias = (r.llaves?.[yo.correo] || []).map((a) => a.pub);
  const suyas = (r.llaves?.[correo] || []).map((a) => a.pub);
  if (!mias.length || !suyas.length) return null;
  return CANDADO.codigoDeSeguridad(mias, suyas);
}

/* ── fotos ────────────────────────────────────────────────────────────────────────────────── */

export const urlArchivo = (id: string) => BASE + '/archivo/' + id;

/**
 * Las fotos ya abiertas, como `data:`. Con tope (cada una son megas de texto en memoria): se va la que
 * lleva más tiempo sin mirarse. Se vacía al salir de la cuenta —son fotos de ESA persona—.
 */
const abiertos = new Map<string, string>();
const TOPE_FOTOS = 40;
const TOPE_FOTOS_BYTES = 48 * 1024 * 1024;
let bytesFotos = 0;

function vaciarArchivos() {
  abiertos.clear();
  bytesFotos = 0;
}

function guardarFoto(id: string, uri: string) {
  const vieja = abiertos.get(id);
  if (vieja) bytesFotos -= vieja.length;
  abiertos.delete(id);
  abiertos.set(id, uri);
  bytesFotos += uri.length;
  while (abiertos.size > 1 && (abiertos.size > TOPE_FOTOS || bytesFotos > TOPE_FOTOS_BYTES)) {
    const [k, v] = abiertos.entries().next().value as [string, string];
    abiertos.delete(k);
    bytesFotos -= v.length;
  }
}

/** Solo para pruebas: cuántas fotos abiertas quedan en memoria. */
export const _fotosEnMemoria = () => abiertos.size;

/** La foto ABIERTA como `data:`; la URL tal cual si vino en claro; null si no se pudo abrir. */
export async function archivoAbierto(id: string, llave?: string, iv?: string, mime = 'image/jpeg'): Promise<string | null> {
  if (!llave || !iv) return urlArchivo(id);
  const ya = abiertos.get(id);
  if (ya) {
    abiertos.delete(id);
    abiertos.set(id, ya);
    return ya;
  }
  const cuenta = yo?.correo;
  try {
    const r = await fetch(urlArchivo(id));
    if (!r.ok) throw new Error('no está');
    const claros = CANDADO.abrirBytes(new Uint8Array(await r.arrayBuffer()), llave, iv);
    const uri = `data:${mime};base64,${aB64Simple(claros)}`;
    // Si mientras bajaba se salió de la cuenta, no se guarda.
    if (cuenta && yo?.correo === cuenta) guardarFoto(id, uri);
    return uri;
  } catch {
    return null;
  }
}

/* ── el buzón de señales (escribiendo, llamadas) ─────────────────────────────────────────── */

export type Senal = { de: string; tipo: string; datos: any; desde?: string };

let escuchando = false;
let generacion = 0;
let oyente: ((s: Senal) => void) | null = null;
/** La petición larga en curso. Es UNA por aparato, la use la escucha que la use. */
let enVuelo: { hecho: Promise<void>; ctrl: AbortController; cuenta: string } | null = null;
/** Señales que trajo esa petición cuando ya nadie escuchaba: se entregan al volver, en orden. */
let retenidas: { s: Senal; en: number }[] = [];
/** Despierta la espera entre reintentos (antes, `clearTimeout` la dejaba colgada para siempre). */
let despertar: (() => void) | null = null;
const VIDA_RETENIDA = 60_000; // lo que vive una señal en el relevo sin que nadie la recoja
const TOPE_RETENIDAS = 60;

function entregar(lista: Senal[]) {
  for (const s of lista) {
    if (!s || typeof s !== 'object') continue;
    if (escuchando && oyente) {
      try {
        oyente(s);
      } catch {
        /* una señal mal formada no tumba el bucle */
      }
    } else {
      retenidas.push({ s, en: Date.now() });
      if (retenidas.length > TOPE_RETENIDAS) retenidas.shift();
    }
  }
}

/**
 * La petición larga de `/senales`, compartida. El relevo lleva un CURSOR por aparato: si hubiera dos
 * peticiones a la vez (la de antes de irse a segundo plano y la de al volver), la señal que llegara se
 * la llevaría una de las dos al azar. Por eso al volver se ADOPTA la que sigue en vuelo, y lo que
 * trae se entrega una sola vez, aquí, a quien esté escuchando en ese momento.
 */
function largaDeSenales(): Promise<void> {
  const cuenta = yo?.correo || '';
  if (enVuelo && enVuelo.cuenta === cuenta) return enVuelo.hecho;
  const ctrl = new AbortController();
  const esta: { hecho: Promise<void>; ctrl: AbortController; cuenta: string } = { hecho: Promise.resolve(), ctrl, cuenta };
  esta.hecho = pedir<{ senales?: Senal[] }>('/senales', conAparato(firmado({})), 40_000, ctrl.signal).then(
    (d) => {
      if (enVuelo === esta) enVuelo = null;
      if (!ctrl.signal.aborted) entregar(Array.isArray(d?.senales) ? d.senales : []);
    },
    (e) => {
      if (enVuelo === esta) enVuelo = null;
      throw e;
    }
  );
  enVuelo = esta;
  return esta.hecho;
}

function dormir(ms: number) {
  return new Promise<void>((listo) => {
    const fin = () => {
      clearTimeout(t);
      if (despertar === fin) despertar = null;
      listo();
    };
    const t = setTimeout(fin, ms);
    despertar = fin;
  });
}

/** Escucha el buzón de ESTE aparato: cada señal llega una vez aquí, sin robársela a la app Orden Global. */
export async function escuchar(alLlegar: (s: Senal) => void) {
  // El oyente más reciente manda, aunque el bucle ya estuviera andando.
  oyente = alLlegar;
  if (escuchando || !yo) return;
  escuchando = true;
  const mia = ++generacion;
  await miAparato();
  if (mia !== generacion) return;
  const ahora = Date.now();
  const antes = retenidas.filter((x) => ahora - x.en < VIDA_RETENIDA).map((x) => x.s);
  retenidas = [];
  entregar(antes);
  while (escuchando && mia === generacion && yo) {
    try {
      await largaDeSenales();
    } catch {
      if (!escuchando || mia !== generacion) break;
      await dormir(2000);
    }
  }
}

/**
 * Deja de escuchar. La petición larga que ya salió se deja terminar (≤25 s en el relevo): cortarla no
 * detiene la espera del otro lado, y la señal que llegara en ese rato se la quedaría una conexión
 * muerta con el cursor de este aparato —perdida—. Lo que traiga se guarda para el próximo `escuchar`.
 * `soltar` (salir de la cuenta) sí la corta con su AbortController y tira lo guardado.
 */
export function dejarDeEscuchar(soltar = false) {
  escuchando = false;
  generacion++;
  despertar?.();
  if (soltar) {
    enVuelo?.ctrl.abort();
    enVuelo = null;
    retenidas = [];
    oyente = null;
  }
}

export const miId = () => aparato;

let ultimoAviso = 0;
export function escribiendo(para: string) {
  if (!yo) return;
  const ahora = Date.now();
  if (ahora - ultimoAviso < 2000) return;
  ultimoAviso = ahora;
  pedir('/escribiendo', firmado({ para })).catch(() => null);
}

/** Por qué no salió una señal: lo que la pantalla de llamada le dice a la persona. */
export type MotivoSenal = 'no-te-acepta' | 'muy-grande' | 'buzon-lleno' | 'tipo-invalido' | 'sin-cuenta' | 'sin-red' | 'otro';
export type ErrorSenal = ErrorRelevo & { motivoSenal: MotivoSenal; tipoSenal: string };

const MOTIVO_POR_CODIGO: Record<number, MotivoSenal> = { 400: 'tipo-invalido', 401: 'sin-cuenta', 403: 'no-te-acepta', 413: 'muy-grande', 429: 'buzon-lleno' };

/** Una cola por destinatario: las señales a una misma persona salen EN ORDEN (la oferta antes que sus ICE). */
const colas = new Map<string, Promise<unknown>>();

/**
 * Deja una señal (llamadas). Resuelve `{ ok: true }` cuando el relevo la aceptó; si no, RECHAZA con
 * un `ErrorSenal` (`code` = 403/413/429/400/401, sin `code` si fue la red) y `motivoSenal` legible.
 * Las de un mismo destinatario salen de a una, en el orden en que se pidieron; el relevo las entrega
 * en ese orden. Ignorar la promesa no deja un rechazo suelto: ya lleva un manejador.
 */
export function senalar(para: string, tipo: string, datos?: unknown): Promise<{ ok: true }> {
  const clave = String(para || '').toLowerCase();
  const antes = colas.get(clave) || Promise.resolve();
  const esta = antes
    .catch(() => undefined)
    .then(async () => {
      try {
        if (!yo) throw Object.assign(new Error('sin cuenta del chat'), { code: 401 });
        await miAparato();
        await pedir('/senal', conAparato(firmado({ para: clave, tipo, datos: datos || {} })));
        return { ok: true as const };
      } catch (e: any) {
        const err = (e instanceof Error ? e : new Error(String(e))) as ErrorSenal;
        err.motivoSenal = err.code ? MOTIVO_POR_CODIGO[err.code] || 'otro' : 'sin-red';
        err.tipoSenal = tipo;
        throw err;
      }
    });
  colas.set(clave, esta);
  const limpiar = () => {
    if (colas.get(clave) === esta) colas.delete(clave);
  };
  esta.then(limpiar, limpiar);
  return esta;
}

/** Credenciales cortas del TURN de Cloudflare (las pide el relevo; el token grande no baja nunca). */
export const turno = () =>
  pedir<{ iceServers?: any[] }>('/turno', firmado({}))
    .then((d) => d.iceServers || [])
    .catch(() => []);

/* ── base64 clásico (el del relevo para /subir, distinto del base64url del candado) ─────────── */
const ALF64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function aB64Simple(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += ALF64[(n >> 18) & 63] + ALF64[(n >> 12) & 63];
    s += i + 1 < bytes.length ? ALF64[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? ALF64[n & 63] : '=';
  }
  return s;
}
function deB64Simple(txt: string): Uint8Array {
  const s = String(txt || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let n = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    n = (n << 6) | ALF64.indexOf(s[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (n >> bits) & 255;
    }
  }
  return out.subarray(0, j);
}
