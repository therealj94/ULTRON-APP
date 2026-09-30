/**
 * El cliente del relevo de PULSE2CHAT (`https://cerebro.ordenscan.com/mensajes`) en el Centro.
 *
 * Portado de `mobile/src/pulse/relevo.ts`, con la misma regla de fondo: el Centro es UN APARATO MÁS de
 * la misma persona (mismos contactos, mismas conversaciones, su propio par de llaves) y cada escucha
 * dice qué aparato es (`aparato` = id de su llave), para no robarle el timbre al teléfono.
 *
 * La diferencia es la plomería: la página NO habla con el relevo (CORS, y la llave de la cuenta no
 * tiene por qué andar en `fetch`). Todo pasa por AURA (C#) con el puente:
 *   · `relevo` { ruta, cuerpo, ms } → { estado, datos }: el POST con su estado HTTP y el JSON;
 *   · `relevo.archivo` { id } → { base64, mime }: los bytes (cifrados) de una foto.
 * Un estado que no es 2xx se levanta con el MISMO error que el teléfono (`code`, `motivo`,
 * `correoReal`); si AURA no contestó o no hubo red, el error va sin `code`.
 *
 * La cuenta del chat (`{ correo, llave, aura }`) se guarda cifrada con DPAPI (`secreto.*`).
 *
 * La regla del cifrado es la de siempre: se cierra SIEMPRE; sin aparatos del otro lado el mensaje NO
 * sale (salvo decisión explícita de mandarlo sin cifrar). Un fallo de red no baja a texto en claro.
 */
import { pedir as pedirAura } from '../puente';
import * as CANDADO from './candado';
import type { Aparato, Bulto } from './candado';
import { secretos } from './secretos';

const CAJON_CUENTA = 'p2c.cuenta';

/** La cuenta del chat en este equipo. `aura`: el correo de la persona de AU-RA que la conectó. */
export type Cuenta = { correo: string; llave: string; aura?: string };

const normalCorreo = (c: string | null | undefined) => String(c || '').trim().toLowerCase();

function esDe(c: Cuenta, duenoAura: string): boolean {
  return c.aura ? normalCorreo(c.aura) === duenoAura : normalCorreo(c.correo) === duenoAura;
}
let yo: Cuenta | null = null;
let aparato = '';

export type ErrorRelevo = Error & { code?: number; motivo?: string; correoReal?: string };

/* ── el transporte: por el puente de AURA (las pruebas lo cambian) ────────────────────────── */

export type Transporte = {
  post(ruta: string, cuerpo: unknown, ms: number): Promise<{ estado: number; datos: unknown }>;
  archivo(id: string): Promise<{ base64: string; mime?: string }>;
};

const PUENTE: Transporte = {
  post: (ruta, cuerpo, ms) => pedirAura('relevo', { ruta, cuerpo, ms }, ms + 5_000),
  archivo: (id) => pedirAura('relevo.archivo', { id }, 120_000),
};
let transporte: Transporte = PUENTE;

/** Solo para pruebas: otro transporte (un relevo de mentira en memoria). */
export function ponerTransporte(t: Transporte | null) {
  transporte = t ?? PUENTE;
}

/** Una petición al relevo. Sin `code` = no hubo respuesta (red, plazo o AURA). */
async function pedir<T = any>(ruta: string, body: unknown, ms = 15_000): Promise<T> {
  let r: { estado: number; datos: unknown } | null;
  try {
    r = await transporte.post(ruta, body, ms);
  } catch (e: any) {
    throw new Error(String(e?.message || 'sin conexión con el relevo')) as ErrorRelevo;
  }
  const estado = Number(r?.estado) || 0;
  const d: any = r?.datos && typeof r.datos === 'object' ? r.datos : {};
  if (!estado) throw new Error(d.error || 'sin conexión con el relevo') as ErrorRelevo;
  if (estado < 200 || estado >= 300) {
    const e: ErrorRelevo = new Error(d.error || 'http ' + estado);
    e.code = estado;
    if (d.motivo) e.motivo = d.motivo;
    if (d.correoReal) e.correoReal = String(d.correoReal).toLowerCase();
    throw e;
  }
  return d as T;
}

const firmado = (b: Record<string, unknown>) => ({ ...b, correo: yo?.correo, llave: yo?.llave });
const conAparato = (b: Record<string, unknown>) => (aparato ? { ...b, aparato } : b);

/** El id de ESTE equipo, siempre el del par vigente. */
async function miAparato(): Promise<string> {
  const m = await CANDADO.miLlave().catch(() => null);
  if (m?.id) aparato = m.id;
  return aparato;
}

/* ── la cuenta del chat en este equipo ────────────────────────────────────────────────────── */

const alSalirHacer = new Set<() => void>();
/** Limpiezas de otras piezas al salir (chats, la pantalla). */
export function alSalir(f: () => void): () => void {
  alSalirHacer.add(f);
  return () => void alSalirHacer.delete(f);
}

/** Lo que hay que hacer ANTES de soltar la cuenta, con la llave todavía puesta (colgar la llamada). */
const antesDeSalirHacer = new Set<() => void>();
export function antesDeSalir(f: () => void): () => void {
  antesDeSalirHacer.add(f);
  return () => void antesDeSalirHacer.delete(f);
}

const oyentesCuenta = new Set<() => void>();
/** Avisa al entrar o salir de la cuenta. */
export function escucharCuenta(f: () => void): () => void {
  oyentesCuenta.add(f);
  return () => void oyentesCuenta.delete(f);
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

async function guardarCuenta(c: Cuenta) {
  await secretos().guardar(CAJON_CUENTA, JSON.stringify(c)).catch(() => {});
}

/**
 * Entra al chat con el pase de Genesis (el que devolvió `entrar.genesis`: el mismo pase sirve una vez
 * para AU-RA y una vez para el relevo). Devuelve la cuenta. El NOMBRE no viaja en el alta: solo si la
 * ficha quedó SIN nombre —cuenta recién hecha— se le pone el de Genesis, aparte y después.
 */
export async function entrarConPase(pase: string, verificador: string, nombre?: string, duenoAura?: string): Promise<Cuenta> {
  const d = await pedir<{ llave: string; correo: string }>('/alta', { pase, verificador });
  if (!d?.llave || !d?.correo) throw new Error('el relevo no devolvió la llave');
  const aura = normalCorreo(duenoAura);
  yo = { correo: String(d.correo).toLowerCase(), llave: d.llave, ...(aura ? { aura } : {}) };
  await guardarCuenta(yo);
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

/**
 * La cuenta que ya estaba en este equipo, comprobada contra el relevo. null si no hay, no vale o no es
 * de quien está dentro de AU-RA (`duenoAura`). La de otra persona no se borra: es suya.
 */
export async function recuperar(duenoAura?: string): Promise<Cuenta | null> {
  const dueno = normalCorreo(duenoAura);
  if (!dueno) return null;
  if (yo) {
    if (esDe(yo, dueno)) return yo;
    await salir(false);
    return null;
  }
  let g: string | null = null;
  try {
    g = await secretos().leer(CAJON_CUENTA);
  } catch {
    g = null;
  }
  if (!g) return null;
  try {
    const c = JSON.parse(g) as Cuenta;
    if (!c?.correo || !c?.llave) return null;
    if (!esDe(c, dueno)) return null;
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

/** Sale del chat en este equipo: cuelga, corta la escucha, olvida la cuenta y lo abierto en memoria. */
export async function salir(borrarGuardada = true) {
  for (const f of [...antesDeSalirHacer]) {
    try {
      f();
    } catch {
      /* colgar no impide salir */
    }
  }
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
  for (const f of [...alSalirHacer]) {
    try {
      f();
    } catch {
      /* una limpieza ajena que falla no deja la cuenta a medias */
    }
  }
  if (borrarGuardada) await secretos().borrar(CAJON_CUENTA).catch(() => {});
  avisarCuenta();
}

export const quien = () => yo;

/* ── las llaves de los aparatos ───────────────────────────────────────────────────────────── */

let publicadaPara: string | null = null;

/** La pública de este equipo se publica AL ENTRAR: si no, no podría RECIBIR nada cifrado. */
async function publicarMiLlave() {
  if (!yo) return;
  const mia = await CANDADO.miLlave();
  if (!mia) return;
  aparato = mia.id;
  // Un par VOLÁTIL (el cajón no se dejó leer, o no guardó) NO se publica.
  if (mia.volatil) return;
  const clave = yo.correo + '|' + mia.id;
  if (publicadaPara === clave) return;
  await pedir('/llaves/publicar', firmado({ id: mia.id, pub: mia.pub, fir: mia.fir || '' }));
  publicadaPara = clave;
}

/** ¿El par de este equipo es solo de memoria? La pantalla lo dice. */
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
  // Mis OTROS aparatos (el teléfono, la web) llevan sobre también.
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

function soloPersonas(para: string) {
  if (!/^[^@\s]+@[^@\s]+$/.test(para)) {
    const e: ErrorRelevo = new Error('solo conversaciones con personas');
    e.motivo = 'no-es-persona';
    throw e;
  }
}

/**
 * Envía un texto CIFRADO de punta a punta. Si no se puede cifrar NO sale: lanza con `motivo`. Legible
 * solo con una decisión explícita y previa de la persona (`sinCifrar: true`).
 */
export async function enviar(para: string, texto: string, o: { sinCifrar?: boolean } = {}): Promise<{ ok: true; e2e: boolean; id?: string }> {
  para = String(para || '').toLowerCase();
  soloPersonas(para);
  const r = await cerrarPara(para, texto);
  if ('cerrado' in r) {
    const d = await pedir<{ id?: string }>('/enviar', firmado({ para, cif: r.cerrado }));
    return { ok: true, e2e: true, id: d?.id };
  }
  if (r.motivo !== 'sin-aparatos' || o.sinCifrar !== true) {
    const e: ErrorRelevo = new Error('no se pudo cifrar: ' + r.motivo);
    e.motivo = r.motivo;
    throw e;
  }
  const d = await pedir<{ id?: string }>('/enviar', firmado({ para, texto: CANDADO.sanearTexto(texto) }));
  return { ok: true, e2e: false, id: d?.id };
}

/**
 * Sube una foto cifrada (la llave viaja DENTRO del mensaje cifrado) y la manda. PRIMERO se cierra el
 * mensaje y SOLO si se pudo se suben los bytes.
 */
export async function enviarFoto(para: string, bytes: Uint8Array, mime = 'image/jpeg', texto = ''): Promise<{ ok: true; e2e: true; id?: string }> {
  para = String(para || '').toLowerCase();
  soloPersonas(para);
  const c = CANDADO.cerrarBytes(bytes);
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

type Guardado = { ct: string; yoId: string; m: Mensaje };
const abiertosMsg = new Map<string, Guardado>();
const TOPE_ABIERTOS = 2000;
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

function yaAbierto(m: any, yoId: string): Mensaje | null {
  if (!m?.cif || m.borrado) return null;
  const g = abiertosMsg.get(idDe(m));
  if (!g || g.yoId !== yoId || g.ct !== String(m.cif?.ct ?? '')) return null;
  abiertosMsg.delete(g.m.id);
  abiertosMsg.set(g.m.id, g);
  const { cif: _c, texto: _t, ...resto } = m;
  return { ...resto, ...g.m };
}

const respirar = () => new Promise<void>((r) => setTimeout(r, 0));

/** Abre una lista de mensajes crudos del relevo. Un mensaje malo sale `cerrado` y los demás se ven. */
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
        .map((m) => String(m.de).toLowerCase()),
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
  for (let k = faltan.length - 1; k >= 0; k--) {
    const i = faltan[k];
    const m = crudos[i];
    try {
      salida[i] = await abrirUno(m, llaves[String(m.de || '').toLowerCase()] || [], yoId);
    } catch {
      salida[i] = { ...base(m), texto: '', cerrado: true, e2e: true };
    }
    if (m.cif && ++hechos % 12 === 0) await respirar();
  }
  return salida.filter((m): m is Mensaje => m != null);
}

export type Bandeja = { mensajes: Mensaje[]; hayMas: boolean; leidoHasta: number; enLinea?: boolean };

/** La bandeja de un hilo, con los sobres ya abiertos. */
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
  return lista;
}

export async function circulo(): Promise<Circulo> {
  const d = await pedir<{ recibidas?: any[]; enviadas?: any[]; amigos?: any[] }>('/amistad/lista', firmado({}));
  const lista = (v: unknown) => (Array.isArray(v) ? v : []).filter((x) => x && typeof x.correo === 'string').map(persona);
  const c = { amigos: lista(d?.amigos), recibidas: lista(d?.recibidas), enviadas: lista(d?.enviadas) };
  circuloConocido = c.amigos;
  return c;
}

/** A quién le puede escribir la persona (nombres para la llamada y los avisos). */
export function contactosConocidos(): Persona[] {
  const vistos = new Map<string, Persona>();
  for (const p of [...conocidas, ...circuloConocido]) if (!vistos.has(p.correo)) vistos.set(p.correo, p);
  return [...vistos.values()];
}

/** Cómo se llama alguien (lo que sale en la lista), o la parte de antes de la @. */
export function nombreDeCorreo(correo: string): string {
  const c = normalCorreo(correo);
  return contactosConocidos().find((x) => x.correo === c)?.nombre || c.split('@')[0] || c;
}

/** Minúsculas y sin acentos: «María» y «maria» son la misma. */
export const normalizar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

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

/** El código de seguridad con alguien: si coincide en los dos aparatos, no hay nadie en medio. */
export async function codigoCon(correo: string): Promise<string | null> {
  if (!yo) return null;
  const r = await pedir<{ llaves?: Record<string, Aparato[]> }>('/llaves/de', firmado({ correos: [yo.correo, correo] }));
  const mias = (r.llaves?.[yo.correo] || []).map((a) => a.pub);
  const suyas = (r.llaves?.[correo] || []).map((a) => a.pub);
  if (!mias.length || !suyas.length) return null;
  return CANDADO.codigoDeSeguridad(mias, suyas);
}

/* ── fotos ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Las fotos ya abiertas, como `data:`. Con tope (cada una son megas de texto en memoria): se va la que
 * lleva más tiempo sin mirarse. Se vacía al salir de la cuenta.
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

/** La foto ABIERTA como `data:` (también la que vino en claro); null si no se pudo. Por el puente. */
export async function archivoAbierto(id: string, llave?: string, iv?: string, mime = 'image/jpeg'): Promise<string | null> {
  const ya = abiertos.get(id);
  if (ya) {
    abiertos.delete(id);
    abiertos.set(id, ya);
    return ya;
  }
  const cuenta = yo?.correo;
  try {
    const r = await transporte.archivo(id);
    if (!r?.base64) throw new Error('no está');
    const crudos = deB64Simple(r.base64);
    const claros = llave && iv ? CANDADO.abrirBytes(crudos, llave, iv) : crudos;
    const tipo = llave && iv ? mime : r.mime || mime;
    const uri = `data:${tipo};base64,${aB64Simple(claros)}`;
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
let enVuelo: { hecho: Promise<number>; cortada: boolean; cuenta: string } | null = null;
/** Señales que trajo esa petición cuando ya nadie escuchaba: se entregan al volver, en orden. */
let retenidas: { s: Senal; en: number }[] = [];
let despertar: (() => void) | null = null;
const VIDA_RETENIDA = 60_000;
const TOPE_RETENIDAS = 60;
/** Lo que se espera la escucha larga (el relevo la suelta a los ≤25 s; esto es el tope). */
const PLAZO_SENALES = 45_000;

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
 * La petición larga de `/senales`, compartida (el relevo lleva UN cursor por aparato: dos a la vez se
 * repartirían las señales al azar). Por el puente no se puede abortar: `cortada` hace que lo que traiga
 * se tire (al salir de la cuenta).
 */
function largaDeSenales(): Promise<number> {
  const cuenta = yo?.correo || '';
  if (enVuelo && enVuelo.cuenta === cuenta) return enVuelo.hecho;
  const esta: { hecho: Promise<number>; cortada: boolean; cuenta: string } = { hecho: Promise.resolve(0), cortada: false, cuenta };
  esta.hecho = pedir<{ senales?: Senal[] }>('/senales', conAparato(firmado({})), PLAZO_SENALES).then(
    (d) => {
      if (enVuelo === esta) enVuelo = null;
      const lista = Array.isArray(d?.senales) ? d.senales : [];
      if (!esta.cortada) entregar(lista);
      return lista.length;
    },
    (e) => {
      if (enVuelo === esta) enVuelo = null;
      throw e;
    },
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

/** Escucha el buzón de ESTE equipo. En el Centro se escucha SIEMPRE con la cuenta puesta. */
export async function escuchar(alLlegar: (s: Senal) => void) {
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
  let fallos = 0;
  while (escuchando && mia === generacion && yo) {
    try {
      const t0 = Date.now();
      const trajo = await largaDeSenales();
      fallos = 0;
      // Una espera larga que vuelve AL INSTANTE y vacía (un relevo sin espera larga, un proxy que la
      // corta) haría girar este bucle sin freno: se respira un segundo antes de la siguiente.
      if (!trajo && Date.now() - t0 < 1000 && escuchando && mia === generacion) await dormir(1000);
    } catch (e: any) {
      if (!escuchando || mia !== generacion) break;
      // 401: la llave ya no vale. Lo decide quien escucha la cuenta (chats.ts); aquí se espera más.
      fallos++;
      await dormir(e?.code === 401 ? 30_000 : Math.min(15_000, 2000 * fallos));
    }
  }
}

/** Deja de escuchar. `soltar` (salir de la cuenta) tira lo que traiga la petición en vuelo. */
export function dejarDeEscuchar(soltar = false) {
  escuchando = false;
  generacion++;
  despertar?.();
  if (soltar) {
    if (enVuelo) enVuelo.cortada = true;
    enVuelo = null;
    retenidas = [];
    oyente = null;
  }
}

export const miId = () => aparato;

let ultimoAviso = 0;
/** «Estoy escribiendo», como mucho cada 2 s. */
export function escribiendo(para: string) {
  if (!yo) return;
  const ahora = Date.now();
  if (ahora - ultimoAviso < 2000) return;
  ultimoAviso = ahora;
  pedir('/escribiendo', firmado({ para })).catch(() => null);
}

export type MotivoSenal = 'no-te-acepta' | 'muy-grande' | 'buzon-lleno' | 'tipo-invalido' | 'sin-cuenta' | 'sin-red' | 'otro';
export type ErrorSenal = ErrorRelevo & { motivoSenal: MotivoSenal; tipoSenal: string };

const MOTIVO_POR_CODIGO: Record<number, MotivoSenal> = { 400: 'tipo-invalido', 401: 'sin-cuenta', 403: 'no-te-acepta', 413: 'muy-grande', 429: 'buzon-lleno' };

/** Una cola por destinatario: las señales a una misma persona salen EN ORDEN (la oferta antes que sus ICE). */
const colas = new Map<string, Promise<unknown>>();

/**
 * Deja una señal (llamadas). Resuelve `{ ok: true }` si el relevo la aceptó; si no, RECHAZA con un
 * `ErrorSenal` (`code` = 403/413/429/400/401, sin `code` si fue la red).
 */
export function senalar(para: string, tipo: string, datos?: unknown): Promise<{ ok: true }> {
  const clave = String(para || '').toLowerCase();
  const cuenta = yo;
  const antes = colas.get(clave) || Promise.resolve();
  const esta = antes
    .catch(() => undefined)
    .then(async () => {
      try {
        if (!cuenta) throw Object.assign(new Error('sin cuenta del chat'), { code: 401 });
        await miAparato();
        await pedir('/senal', conAparato({ para: clave, tipo, datos: datos || {}, correo: cuenta.correo, llave: cuenta.llave }));
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

/** Credenciales cortas del TURN (las pide el relevo; el token grande no baja nunca). */
export const turno = () =>
  pedir<{ iceServers?: any[] }>('/turno', firmado({}))
    .then((d) => d.iceServers || [])
    .catch(() => []);

/* ── base64 clásico (el del relevo para /subir y los archivos, distinto del base64url del candado) ── */
const ALF64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function aB64Simple(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += ALF64[(n >> 18) & 63] + ALF64[(n >> 12) & 63];
    s += i + 1 < bytes.length ? ALF64[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? ALF64[n & 63] : '=';
  }
  return s;
}
export function deB64Simple(txt: string): Uint8Array {
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
