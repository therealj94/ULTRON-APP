import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { identificar, nivelDe, personaPorCorreoExacto, type Identificacion, type Plataforma } from '../lib/acceso';
import dns from 'dns/promises';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { ipPrivada } from '../lib/red-publica';
import { s3GetJson, s3Listo, s3PutJson } from '../lib/s3';
import { modoDesarrollo } from '../lib/entorno';
import { comprobarAutoridad, suspensionSabida } from './autoridad-cuenta';

export type Sesion = {
  token: string;
  correo: string;
  nombre: string;
  rol: string;
  at: number;
  /** Cuándo vence (ms). Las de un código temporal vencen con el código, no a los 14 días. */
  exp?: number;
  /**
   * Sesión de MIEMBRO DE LA COMUNIDAD: la emitió AU-RA a alguien que no está en el padrón (entró por el
   * cerebro remoto). Va firmada en el token: sin ella, un correo que el padrón no conoce no abre la mesa
   * (sesionAbreAura), así sacar a alguien del padrón le cierra AU-RA en vez de abrírsela como miembro.
   */
  comunidad?: boolean;
};

const sesiones = new Map<string, Sesion>();
const hits = new Map<string, number[]>();
const SESION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

let secretoDelArranque: string | null = null;
let avisadoSecreto = false;

/**
 * La llave que firma las sesiones: SOLO `ULTRON_SESION_SECRETO`.
 *
 * Antes caía en `ULTRON_MESA_CLAVE` (la mandan los clientes en cada petición) o en
 * `ULTRON_NODO_SECRETO` (viaja en cada llamada al nodo de AWS). Quien tuviera cualquiera de las dos
 * podía fabricarse una sesión de José, con mando. Sin la variable, una llave al azar por arranque:
 * las sesiones valen hasta el próximo despliegue (el teléfono vuelve a entrar solo con la clave
 * guardada; la web pide entrar otra vez). Se avisa en el log para que se fije.
 */
function secretoSesion(): string {
  const propio = String(process.env.ULTRON_SESION_SECRETO || '').trim();
  if (propio) {
    if (propio.length < 24 && !avisadoSecreto) {
      avisadoSecreto = true;
      console.warn('[AU-RA] ULTRON_SESION_SECRETO es corto (menos de 24 caracteres): conviene uno largo y al azar.');
    }
    return propio;
  }
  if (!secretoDelArranque) {
    secretoDelArranque = crypto.randomBytes(32).toString('base64url');
    console.warn('[AU-RA] falta ULTRON_SESION_SECRETO: las sesiones se firman con una llave de este arranque y se pierden al redesplegar.');
  }
  return secretoDelArranque;
}

function firmarSesion(user: { correo: string; nombre: string; rol: string; at: number; exp: number; n: string; aud?: string; tipo?: string; cid?: string }): string {
  const body = Buffer.from(JSON.stringify(user)).toString('base64url');
  const sig = crypto.createHmac('sha256', secretoSesion()).update(body).digest('base64url');
  return `u1.${body}.${sig}`;
}

/** Lo que dice un token bien firmado (sin mirar si se cerró ni si venció). */
/**
 * La firma se compara como TEXTO, tal cual la emitimos. Compararla decodificada dejaba pasar formas
 * equivalentes (`…=` al final, caracteres que el decodificador ignora): el token seguía siendo
 * válido pero su huella era otra, y una sesión cerrada volvía a abrir con un `=` agregado.
 */
function firmaCanonica(esperada: string, dada: string): boolean {
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(dada));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function cuerpoFirmado(token: string): any | null {
  if (!token.startsWith('u1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const body = parts[1];
  const sig = parts[2];
  const expect = crypto.createHmac('sha256', secretoSesion()).update(body).digest('base64url');
  if (!firmaCanonica(expect, sig)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function leerSesionFirmada(token: string): Sesion | null {
  const p = cuerpoFirmado(token);
  if (!p?.correo || !p?.nombre) return null;
  // Un token de MCP (server/mcp-oauth.ts) no abre la app: solo sirve en /mcp, y solo para leer.
  if (p.aud) return null;
  if (Number(p.exp) && Date.now() > Number(p.exp)) return null;
  return {
    token,
    correo: String(p.correo),
    nombre: String(p.nombre),
    rol: String(p.rol || 'Junta'),
    at: Number(p.at) || Date.now(),
    exp: Number(p.exp) || undefined,
    ...(p.com === 1 ? { comunidad: true } : {}),
  };
}

export function emitirSesion(user: { correo: string; nombre: string; rol: string }, opciones: { vence?: number; comunidad?: boolean } = {}): Sesion {
  const at = Date.now();
  // Nunca más de 14 días; una sesión de código temporal vence justo con el código.
  const exp = Math.min(at + SESION_TTL_MS, opciones.vence ?? Infinity);
  const token = firmarSesion({
    correo: user.correo,
    nombre: user.nombre,
    rol: user.rol,
    at,
    exp,
    // Dos entradas del mismo miembro en el mismo milisegundo (teléfono y web a la vez) daban el mismo
    // token, y cerrar la de un aparato cerraba la del otro.
    n: crypto.randomBytes(9).toString('base64url'),
    ...(opciones.comunidad ? { com: 1 } : {}),
  });
  const s: Sesion = { token, correo: user.correo, nombre: user.nombre, rol: user.rol, at, exp, ...(opciones.comunidad ? { comunidad: true } : {}) };
  sesiones.set(token, s);
  return s;
}

/* ------------------------------------------------------- tokens de MCP */

/**
 * Los tokens que recibe un cliente MCP (Claude) tras entrar con la cuenta de Dr Electrum. Van
 * firmados como una sesión, pero con `aud: 'mcp'`: la app los rechaza (leerSesionFirmada) y /mcp
 * solo acepta estos. Heredan lo que ya protege a una sesión: se cierran con borrarSesion y mueren
 * si la persona cambia la contraseña.
 */
export type TokenMcp = { correo: string; nombre: string; rol: string; cid: string; at: number; exp: number };

export function emitirTokenMcp(
  user: { correo: string; nombre: string; rol: string },
  tipo: 'acceso' | 'refresco',
  cid: string,
  ttlMs: number,
  at = Date.now()
): { token: string; exp: number } {
  const exp = at + ttlMs;
  const token = firmarSesion({ ...user, at, exp, n: crypto.randomBytes(9).toString('base64url'), aud: 'mcp', tipo, cid });
  return { token, exp };
}

export function leerTokenMcp(token: string, tipo: 'acceso' | 'refresco'): TokenMcp | null {
  const p = cuerpoFirmado(String(token || ''));
  if (!p || p.aud !== 'mcp' || p.tipo !== tipo || !p.correo || !p.cid) return null;
  if (!Number(p.exp) || Date.now() > Number(p.exp)) return null;
  if (sesionCerrada(token)) return null;
  const t: TokenMcp = { correo: String(p.correo), nombre: String(p.nombre || ''), rol: String(p.rol || ''), cid: String(p.cid), at: Number(p.at) || 0, exp: Number(p.exp) };
  const desde = claveCambiadaEn(t.correo.toLowerCase());
  if (desde && t.at < desde) return null;
  return t;
}

/**
 * Datos firmados que no son sesiones (el id de un cliente registrado, un código de autorización).
 * El prefijo entra en la firma: un código no se puede presentar como id de cliente ni al revés.
 */
export function firmarDato(prefijo: string, dato: object): string {
  const body = Buffer.from(JSON.stringify(dato)).toString('base64url');
  const sig = crypto.createHmac('sha256', secretoSesion()).update(`${prefijo}.${body}`).digest('base64url');
  return `${prefijo}.${body}.${sig}`;
}

/**
 * Un secreto propio de un uso (p. ej. la llave que ElevenLabs manda a nuestro cerebro), derivado del
 * de las sesiones: no hace falta otra variable en Render, y rotar ULTRON_SESION_SECRETO lo rota.
 */
export function secretoDerivado(etiqueta: string): string {
  return crypto.createHmac('sha256', secretoSesion()).update(`derivado:${etiqueta}`).digest('base64url');
}

/** Compara dos secretos sin filtrar por el tiempo cuánto coinciden. */
export function mismoSecreto(esperado: string, dado: string): boolean {
  return firmaCanonica(esperado, dado);
}

export function leerDato(prefijo: string, token: string): any | null {
  const partes = String(token || '').split('.');
  if (partes.length !== 3 || partes[0] !== prefijo) return null;
  const expect = crypto.createHmac('sha256', secretoSesion()).update(`${prefijo}.${partes[1]}`).digest('base64url');
  if (!firmaCanonica(expect, partes[2])) return null;
  try {
    return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- sesiones cerradas */

/**
 * Un token firmado vale por sí solo 14 días: borrarlo del Map no lo mataba, y «Cerrar sesión» dejaba
 * viva la copia de quien la hubiera sacado del teléfono o del navegador. Aquí se anota su huella hasta
 * que habría vencido. Se guarda en disco y en S3 (si hay), para que un redespliegue no lo resucite.
 *
 * Una revocación VIGENTE nunca se descarta para ahorrar memoria: antes, pasadas 5.000, se tiraban las
 * que vencían antes aunque todavía no hubieran vencido, y esos tokens volvían a valer. Solo se podan
 * las vencidas. Cada huella son unas decenas de bytes y solo se anota un token que este servidor firmó
 * y que no ha vencido (no se puede llenar con basura); pasar de AVISO_CERRADAS se avisa en el log.
 * Antes de escribir en S3 se mezcla lo que ya hay allá: otra réplica pudo cerrar sesiones en medio.
 */
const CERRADAS_S3 = 'ultron/sesiones-cerradas.json';
const AVISO_CERRADAS = 5000;
let avisadoTope = false;
const cerradas = new Map<string, number>(); // huella → cuándo habría vencido
let cerradasDeDisco = false;

function archivoCerradas() {
  return process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO || path.join(process.cwd(), 'data', 'sesiones-cerradas.json');
}

function huellaToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 40);
}

function mezclarCerradas(raw: unknown) {
  if (!raw || typeof raw !== 'object') return;
  const ahora = Date.now();
  for (const [h, vence] of Object.entries(raw as Record<string, unknown>)) {
    const v = Number(vence);
    if (/^[0-9a-f]{40}$/.test(h) && v > ahora) cerradas.set(h, Math.max(v, cerradas.get(h) || 0));
  }
}

function leerCerradasDeDisco() {
  if (cerradasDeDisco) return;
  cerradasDeDisco = true;
  try {
    mezclarCerradas(JSON.parse(fs.readFileSync(archivoCerradas(), 'utf8')));
  } catch {
    /* no hay archivo todavía */
  }
}

/** Solo se van las VENCIDAS: una revocación vigente no se tira nunca. */
function podarCerradas() {
  const ahora = Date.now();
  for (const [h, v] of cerradas) if (v <= ahora) cerradas.delete(h);
  if (cerradas.size > AVISO_CERRADAS && !avisadoTope) {
    avisadoTope = true;
    console.warn(`[AU-RA] sesiones cerradas: ${cerradas.size} vigentes (más de ${AVISO_CERRADAS}). No se descartan; conviene un almacén compartido con vencimiento.`);
  }
}

/**
 * Guarda las cerradas. Devuelve si quedó DURABLE: en S3 si lo hay; sin S3, en el disco (lo más que hay).
 * Un fallo no se esconde: lo sabe quien cerró la sesión.
 */
async function guardarCerradas(): Promise<boolean> {
  let enDisco = false;
  let enS3 = false;
  if (s3Listo()) {
    // Lo que otra réplica anotó mientras tanto no se pisa con esta copia.
    const previo = await s3GetJson(CERRADAS_S3).catch(() => ({ ok: false, json: null }) as { ok: boolean; json: unknown });
    if (previo.ok) mezclarCerradas(previo.json);
  }
  const datos = Object.fromEntries(cerradas);
  try {
    const f = archivoCerradas();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(datos));
    fs.renameSync(`${f}.tmp`, f);
    enDisco = true;
  } catch (e: any) {
    console.warn('[AU-RA] sesiones cerradas: no pude escribir el disco', String(e?.message || e).slice(0, 120));
  }
  if (s3Listo()) {
    const r = await s3PutJson(CERRADAS_S3, datos).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
    if (!r.ok) console.warn('[AU-RA] sesiones cerradas: S3 no guardó', String(r.detalle).slice(0, 120));
    enS3 = !!r.ok;
    return enS3;
  }
  return enDisco;
}

/** Al arrancar: trae las sesiones cerradas de S3 (el disco de Render se borra al redesplegar). */
export async function cargarSesionesCerradas(): Promise<string> {
  leerCerradasDeDisco();
  if (!s3Listo()) return `${cerradas.size} cerradas (solo disco)`;
  const r = await s3GetJson(CERRADAS_S3);
  if (r.ok) mezclarCerradas(r.json);
  podarCerradas();
  return r.ok ? `${cerradas.size} cerradas (S3)` : `${cerradas.size} cerradas; S3 no respondió: ${r.detalle}`;
}

/**
 * Saca del caché en memoria una sesión de UN solo uso. No la revoca —vence sola—; solo evita que
 * deje un objeto para siempre en el mapa. (La voz ya no la usa: su turno corre en proceso, sin
 * sesión interna; queda para cualquier llamada interna que la necesite.)
 */
export function soltarSesion(token?: string) {
  if (token) sesiones.delete(token);
}

/**
 * Cierra la sesión de verdad: el token deja de valer aquí y en cualquier copia. `cerrada`: quedó
 * revocada en este proceso; `durable`: además quedó guardada (S3, o el disco si no hay S3). Un
 * `durable: false` no es un cierre fallido, pero un redespliegue podría olvidarlo: se dice.
 */
export async function cerrarSesion(token?: string): Promise<{ cerrada: boolean; durable: boolean }> {
  if (!token) return { cerrada: false, durable: false };
  sesiones.delete(token);
  // Solo se anota lo que este servidor firmó: si no, cualquiera llenaría la lista con basura.
  const p = cuerpoFirmado(token);
  if (!p) return { cerrada: false, durable: false };
  const vence = Number(p.exp) || Number(p.at) + SESION_TTL_MS || Date.now() + SESION_TTL_MS;
  if (vence <= Date.now()) return { cerrada: false, durable: false };
  leerCerradasDeDisco();
  cerradas.set(huellaToken(token), vence);
  podarCerradas();
  const durable = await guardarCerradas().catch(() => false);
  return { cerrada: true, durable };
}

/** Cierra la sesión (ver cerrarSesion). true si quedó revocada. */
export async function borrarSesion(token?: string): Promise<boolean> {
  return (await cerrarSesion(token)).cerrada;
}

/** Solo pruebas: cuántas revocaciones vigentes hay y si una huella sigue anotada. */
export function _cerradasParaPruebas() {
  return { total: cerradas.size, anotada: (token: string) => sesionCerrada(token) };
}

function sesionCerrada(token: string) {
  leerCerradasDeDisco();
  const v = cerradas.get(huellaToken(token));
  return v !== undefined && v > Date.now();
}

/**
 * La huella de una sesión: lo que se anota al cerrarla. Un pase de voz lleva la huella de la sesión
 * que lo pidió (no la sesión misma) para poder preguntar en cada turno si esa sesión sigue viva.
 */
export function huellaSesion(token: string): string {
  return huellaToken(token);
}

/**
 * ¿La sesión de esa huella sigue valiendo? No se cerró («Cerrar sesión» en cualquier aparato), no
 * venció y la contraseña no cambió después de abrirla. Es lo mismo que mira sesionDe, pero sin el
 * token: lo usa el pase de la voz, que no lleva la sesión dentro.
 */
export function sesionSigueViva(o: { huella: string; correo: string; at: number; exp?: number }, ahora = Date.now()): boolean {
  leerCerradasDeDisco();
  const cerrada = cerradas.get(o.huella);
  if (cerrada !== undefined && cerrada > ahora) return false;
  if (o.exp && ahora > o.exp) return false;
  // SEC-04: una cuenta que se sabe suspendida no sigue hablando por un pase de voz ya emitido.
  if (suspensionSabida(o.correo)) return false;
  const desde = claveCambiadaEn(String(o.correo || '').toLowerCase());
  return !(desde && o.at < desde);
}

/** Solo pruebas: olvida el caché en memoria (no las cerradas), como tras un redespliegue. */
export function _olvidarCacheSesiones() {
  sesiones.clear();
}

export function tokenDe(req: Request): string {
  const h = String(req.headers['x-ultron-sesion'] || req.headers['authorization'] || '');
  return h.replace(/^Bearer\s+/i, '').trim();
}

/**
 * Cuándo cambió por última vez la contraseña de un correo (ms), o null. Lo pone server/cuentas.ts:
 * una sesión abierta ANTES de ese momento ya no vale, porque la abrió alguien con la clave vieja —y
 * si alguien cambia la clave es, muchas veces, porque otro la conocía—.
 */
let claveCambiadaEn: (correo: string) => number | null = () => null;
export function fijarClaveCambiadaEn(fn: (correo: string) => number | null) {
  claveCambiadaEn = fn;
}

function anteriorALaClave(s: Sesion): boolean {
  const desde = claveCambiadaEn(s.correo.toLowerCase());
  return !!desde && s.at < desde;
}

export function sesionDe(req: Request): Sesion | null {
  const t = tokenDe(req);
  if (!t) return null;
  if (sesionCerrada(t)) {
    sesiones.delete(t);
    return null;
  }
  const cached = sesiones.get(t);
  if (cached) {
    // SEC-04: una suspensión ya sabida invalida la sesión emitida (no espera a que venza a los 14 días).
    if (Date.now() - cached.at > SESION_TTL_MS || (cached.exp && Date.now() > cached.exp) || anteriorALaClave(cached) || suspensionSabida(cached.correo)) {
      sesiones.delete(t);
      return null;
    }
    return cached;
  }
  const firmada = leerSesionFirmada(t);
  if (firmada && !anteriorALaClave(firmada) && !suspensionSabida(firmada.correo)) {
    sesiones.set(t, firmada);
    return firmada;
  }
  return null;
}

/** El dominio de los correos que se inventan para las sesiones de código temporal. */
export const DOMINIO_CODIGO = '@temporal.drelectrum';

/**
 * Un invitado mira pero no se lleva archivos: quien entró con un código temporal, o sin sesión
 * (la llave de la demostración). Los que tienen usuario propio sí pueden bajar.
 */
export function esInvitado(req: Request): boolean {
  const s = sesionDe(req);
  if (!s || s.correo.toLowerCase().endsWith(DOMINIO_CODIGO)) return true;
  // Una sesión que no da Dr Electrum (cuenta solo de AU-RA que entró con la llave de la demo) no
  // convierte al visitante en usuario de Electrum: mira como cualquier invitado.
  return !nivelDe(identidadDe(req), 'electrum');
}

/**
 * ¿Este correo es una identidad CONFIGURADA en el despliegue (el padrón del entorno: la junta, ULTRON_PADRON)? No las
 * cuentas aprobadas desde la web (viven en la base que acaso no contesta) ni los códigos temporales. Es la única que
 * sigue cuando la autoridad es desconocida (SEC-04), como los dueños de WhatsApp cuando la base cae.
 */
export function identidadDelEntorno(correo: string): boolean {
  const c = String(correo || '').trim().toLowerCase();
  if (!c || c.endsWith(DOMINIO_CODIGO)) return false;
  const p = personaPorCorreoExacto(c);
  return !!p && (p as { origen?: string }).origen !== 'web';
}

/**
 * Lo público e inocuo que sigue aunque no se pueda comprobar (o se sepa suspendida) la cuenta de la sesión: oír, la voz,
 * el canto, el diagnóstico (RUTAS_SIN_CEREBRO, sin datos de nadie ni efectos) y cerrar la sesión.
 */
const SIGUE_SIN_AUTORIDAD = ['/api/ultron/salir', '/api/health'];

/**
 * SEC-04 · AUTORIDAD VIGENTE DE LA SESIÓN. Toda petición a /api con una sesión válida pasa por aquí antes de su ruta:
 *  · cuenta suspendida (el registro lo dice, o ya se sabía): 403 `cuenta_suspendida`, y ESE token queda cerrado de forma
 *    durable (una reactivación posterior no lo resucita: hay que volver a entrar);
 *  · autoridad desconocida (el registro falló o tardó, o no hay registro y el despliegue no declaró política): 503
 *    `autoridad_desconocida` — salvo la identidad configurada en el despliegue (identidadDelEntorno), que sigue;
 *  · permitida (registro «activa» de hace < 30 s, o AURA_SUSPENSIONES=ninguna): sigue.
 * Sin sesión, o en lo público inocuo (SIGUE_SIN_AUTORIDAD y RUTAS_SIN_CEREBRO), no se mira: cada ruta sigue con su
 * propia puerta. Política y presupuesto de revocación: server/autoridad-cuenta.ts y SECURITY.md.
 */
export async function exigirAutoridadVigente(req: Request, res: Response, next: NextFunction) {
  const t = tokenDe(req);
  if (!t) return next();
  const ruta = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  if (SIGUE_SIN_AUTORIDAD.includes(ruta) || RUTAS_SIN_CEREBRO.includes(ruta)) return next();
  // Una cuenta que ya se sabe suspendida (sesionDe la rechaza): se confirma con el registro si lo sabido es viejo (una
  // reactivación entra en el mismo presupuesto); si sigue suspendida, ESE token se cierra y se dice por qué.
  const firmada = leerSesionFirmada(t);
  if (firmada && suspensionSabida(firmada.correo) && !sesionCerrada(t)) {
    const r = await comprobarAutoridad(firmada.correo);
    if (r.estado === 'suspendida') {
      await cerrarSesion(t).catch(() => null);
      return res.status(403).json({ error: 'Esta cuenta está suspendida.', code: 'cuenta_suspendida', honesto: true });
    }
  }
  const s = sesionDe(req);
  if (!s) return next();
  const r = await comprobarAutoridad(s.correo);
  if (r.estado === 'permitida') return next();
  if (r.estado === 'suspendida') {
    await cerrarSesion(t).catch(() => null);
    return res.status(403).json({ error: 'Esta cuenta está suspendida.', code: 'cuenta_suspendida', honesto: true });
  }
  if (identidadDelEntorno(s.correo)) return next();
  return res.status(503).json({
    error: 'No pude comprobar que tu cuenta sigue activa. No muestro datos privados ni hago nada a tu nombre hasta comprobarlo; inténtalo en un momento.',
    code: 'autoridad_desconocida',
    honesto: true,
  });
}

export function exigirSesion(req: Request, res: Response, next: NextFunction) {
  const s = sesionDe(req);
  if (!s) return res.status(401).json({ error: 'sesión requerida', code: 'sesion_requerida', honesto: true });
  (req as any).sesion = s;
  next();
}

function secretosIguales(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * ¿Esta sesión abre la mesa de AU-RA? La sesión es UNA para las dos plataformas (misma firma), así que
 * «tiene sesión» no basta: una de Dr Electrum —un código temporal de la demo, o alguien del padrón que
 * solo tiene Electrum— entraba a AU-RA y hablaba con el 27B. Abre la mesa:
 *  · quien está en el padrón CON acceso a AU-RA (la junta y quien se haya aprobado), o
 *  · el miembro de la comunidad: alguien que NO está en el padrón y cuya sesión AU-RA emitió como tal
 *    (`comunidad`, firmado en el token al entrar por el cerebro remoto; server/nivel.ts lo trata como
 *    miembro, con su perfil recortado).
 * No la abre quien el padrón conoce y deja fuera de AU-RA, ni un código temporal (son de Electrum), ni
 * un correo que el padrón ya no conoce con una sesión que no era de comunidad: alguien que sacaron del
 * padrón (o una cuenta solo de Electrum que borraron) con su token todavía vigente. Antes ese caso caía
 * en «no está en el padrón → miembro» y sacarlo le ABRÍA AU-RA por 14 días.
 */
export function sesionAbreAura(correo: string, comunidad = false): boolean {
  const c = String(correo || '').trim().toLowerCase();
  if (!c || c.endsWith(DOMINIO_CODIGO)) return false;
  const persona = personaPorCorreoExacto(c);
  return persona ? !!persona.acceso.ultron : comunidad;
}

/**
 * ¿La sesión que AU-RA está por emitir es de un miembro de la comunidad? Sí cuando la emite AU-RA (no
 * Dr Electrum) a alguien que el padrón no conoce: entró por el cerebro remoto, con Genesis ID abierto o
 * con una cuenta propia de miembro. Esa marca, firmada en el token, es lo único que deja a un correo
 * fuera del padrón abrir la mesa (sesionAbreAura).
 */
export function esDeComunidad(correo: string, plataforma: Plataforma): boolean {
  const c = String(correo || '').trim().toLowerCase();
  return plataforma !== 'electrum' && !!c && !c.endsWith(DOMINIO_CODIGO) && !personaPorCorreoExacto(c);
}

/** Junta: sesión de AU-RA (sesionAbreAura), o clave de mesa en header. Sin marca de desarrollo no hay hueco. */
export function mesaAutorizada(req: Request): boolean {
  const s = sesionDe(req);
  if (s && sesionAbreAura(s.correo, !!s.comunidad)) return true;
  const clave = process.env.ULTRON_MESA_CLAVE || '';
  const got = String(req.headers['x-ultron-mesa'] || '');
  if (clave && got && secretosIguales(clave, got)) return true;
  // El hueco de desarrollo solo con marca explícita (lib/entorno.ts): sin NODE_ENV ya no se abre.
  if (modoDesarrollo() && !clave) return true;
  return false;
}

/**
 * Lo que pasa SIN sesión, con límite por IP (decisión de la junta, 19-sep: la APK no debe quedar muda
 * si su token muere): oír, ver, la voz y el canto. Ninguna de estas rutas despierta al cerebro.
 *
 * `/api/turno` (y su stream) ESTABA aquí: cualquiera sin cuenta corría turnos en el 27B sin censura del
 * nodo de José (1-oct, Fase 0.3). Ahora un turno pide sesión de AU-RA o la clave de la mesa; el
 * teléfono renueva su token con la clave guardada ante el 401, y con ULTRON_SESION_SECRETO fijo el
 * token ya no muere en un redespliegue. La web abre «Entrar» ante el 401.
 *
 * `/api/electrum` tampoco va aquí: Dr Electrum se gobierna con `exigirPlataforma('electrum')`.
 *
 * Coincidencia EXACTA a propósito: con prefijo, `/api/voz` dejaba pasar `/api/voz/agente` (abrir una
 * conversación de ElevenLabs, que sí piensa con el 27B) por ser «una ruta de voz».
 */
const RUTAS_SIN_CEREBRO = ['/api/tts', '/api/tts/stream', '/api/tts/pcm', '/api/voz', '/api/stt', '/api/vision/analyze', '/api/cantar', '/api/orar', '/api/diag'];

function rutaConversacion(path: string) {
  const p = String(path || '').split('?')[0].replace(/\/+$/, '');
  return RUTAS_SIN_CEREBRO.includes(p);
}

export function mesaDeskAutorizada(req: Request): boolean {
  if (mesaAutorizada(req)) return true;
  return rutaConversacion(req.path) || rutaConversacion((req as any).originalUrl);
}

export function exigirMesa(req: Request, res: Response, next: NextFunction) {
  if (mesaAutorizada(req)) return next();
  return res.status(401).json({
    error: 'AU-RA es privado. Entra con sesión de junta.',
    code: 'sesion_requerida',
    honesto: true,
  });
}

export function exigirMesaODesk(req: Request, res: Response, next: NextFunction) {
  if (mesaDeskAutorizada(req)) return next();
  return res.status(401).json({
    error: 'AU-RA es privado. Entra con sesión de junta.',
    code: 'sesion_requerida',
    honesto: true,
  });
}

/**
 * Límite por IP. `grupo` junta varias rutas en un solo cupo: sin él, cada ruta tenía el suyo y las tres
 * de voz (`/api/tts`, `/api/tts/stream`, `/api/voz`) sumaban el triple de lo pensado.
 */
export function limitar(max: number, ventanaMs = 60_000, grupo?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // req.ip ya respeta `trust proxy` (Render pone la IP real). El body no entra en la clave:
    // rotar `usuario` no puede regalar más cupo.
    const ip = String(req.ip || req.socket.remoteAddress || 'x');
    const k = `${ip}:${grupo || req.path}`;
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < ventanaMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: 'demasiadas peticiones', honesto: true });
    }
    arr.push(now);
    hits.set(k, arr);
    if (hits.size > 5000) {
      for (const [key, arr2] of hits) if (!arr2.some((t) => now - t < ventanaMs)) hits.delete(key);
    }
    next();
  };
}

/**
 * Un cupo con la clave que se quiera (no la IP): la voz lo cuenta por PERSONA, porque todos los turnos
 * de ElevenLabs llegan de las mismas pocas IPs de sus servidores. Devuelve true si todavía hay cupo
 * (y lo gasta).
 */
export function gastarCupo(claveCupo: string, max: number, ventanaMs = 60_000, ahora = Date.now()): boolean {
  const k = `cupo:${claveCupo}`;
  const arr = (hits.get(k) || []).filter((t) => ahora - t < ventanaMs);
  if (arr.length >= max) {
    hits.set(k, arr);
    return false;
  }
  arr.push(ahora);
  hits.set(k, arr);
  return true;
}

/** Cuántos pedidos de UNA frase (mismo idTurno) entran con un solo lugar del cupo: el stream y sus dos reintentos por JSON. */
export const PEDIDOS_POR_FRASE = 3;
/** Las frases ya cobradas: «clave|idTurno» → cuándo se cobró y cuántos pedidos lleva. */
const frasesCobradas = new Map<string, { t: number; n: number }>();

/**
 * El cupo de turnos por PERSONA, contado por FRASE. La mesa del teléfono manda una frase por el stream y, si
 * se cae, la repite por JSON (y otra vez) con el MISMO idTurno; el servidor no la corre dos veces
 * (server/turno-unico.ts), pero el cupo cobraba cada pedido: tres lugares por frase, y el último reintento
 * podía volver 429 «demasiados_turnos» —la mesa decía «No alcanzo al cerebro remoto»— (José, 5-oct).
 * Ahora una frase gasta un lugar y sus reintentos entran sin gastar, hasta PEDIDOS_POR_FRASE: un id que se
 * repite sin fin vuelve a gastar. `clave` null: esa petición no tiene cupo por persona (la junta).
 */
export function cupoPorFrase(clave: (req: Request) => string | null, max: number, ventanaMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const k = clave(req);
    if (!k) return next();
    const id = typeof req.body?.idTurno === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(req.body.idTurno) ? req.body.idTurno : '';
    const ahora = Date.now();
    const frase = id ? `${k}|${id}` : '';
    const previa = frase ? frasesCobradas.get(frase) : undefined;
    if (previa && ahora - previa.t < ventanaMs && previa.n < PEDIDOS_POR_FRASE) {
      previa.n += 1;
      return next();
    }
    if (gastarCupo(k, max, ventanaMs, ahora)) {
      if (frase) {
        frasesCobradas.set(frase, { t: ahora, n: 1 });
        if (frasesCobradas.size > 5000) for (const [f, v] of frasesCobradas) if (ahora - v.t >= ventanaMs) frasesCobradas.delete(f);
      }
      return next();
    }
    res.setHeader('Retry-After', String(Math.ceil(ventanaMs / 1000)));
    return res.status(429).json({ error: 'Vas muy rápido. Dame un minuto y seguimos.', code: 'demasiados_turnos', honesto: true });
  };
}

/**
 * Devuelve el lugar que se gastó en `marca` (el `ahora` con que se llamó a gastarCupo): un turno que no
 * llegó a ser turno, la frase a medias del especulativo. Se quita ESA entrada y no la última: si después
 * llegó otra, la de la persona sigue contando y la vieja no se queda ocupando la ventana.
 */
export function devolverCupo(claveCupo: string, marca: number) {
  const arr = hits.get(`cupo:${claveCupo}`);
  const i = arr ? arr.indexOf(marca) : -1;
  if (i >= 0) arr!.splice(i, 1);
}

/* ------------------------------------------------------- intentos de clave por cuenta */

/**
 * `limitar` frena por IP, pero quien prueba claves de una cuenta cambia de IP. Esto cuenta los fallos
 * de CADA CUENTA: 5 desde la misma IP o 10 desde cualquiera en 15 minutos, y la cuenta espera lo que
 * falte para que el fallo más viejo salga de la ventana. Las sesiones ya abiertas siguen valiendo:
 * un bloqueo no echa a José de su teléfono.
 */
export const FRENO_ENTRADA = { ventanaMs: 15 * 60_000, porIp: 5, porCuenta: 10 };
const fallosEntrada = new Map<string, number[]>();

function fallosVivos(k: string, ahora: number) {
  const arr = (fallosEntrada.get(k) || []).filter((t) => ahora - t < FRENO_ENTRADA.ventanaMs);
  if (arr.length) fallosEntrada.set(k, arr);
  else fallosEntrada.delete(k);
  return arr;
}

function claveCuenta(correo: string) {
  return `c:${String(correo || '').trim().toLowerCase()}`;
}

/** Milisegundos que esta cuenta, desde esta IP, tiene que esperar antes de probar otra clave (0 = puede). */
export function esperaEntrada(correo: string, ip: string, ahora = Date.now()): number {
  const cuenta = claveCuenta(correo);
  const porIp = fallosVivos(`${cuenta}|${ip}`, ahora);
  const todos = fallosVivos(cuenta, ahora);
  let espera = 0;
  if (porIp.length >= FRENO_ENTRADA.porIp) espera = Math.max(espera, porIp[porIp.length - FRENO_ENTRADA.porIp] + FRENO_ENTRADA.ventanaMs - ahora);
  if (todos.length >= FRENO_ENTRADA.porCuenta) espera = Math.max(espera, todos[todos.length - FRENO_ENTRADA.porCuenta] + FRENO_ENTRADA.ventanaMs - ahora);
  return Math.max(0, espera);
}

export function anotarFalloEntrada(correo: string, ip: string, ahora = Date.now()) {
  const cuenta = claveCuenta(correo);
  for (const k of [cuenta, `${cuenta}|${ip}`]) fallosEntrada.set(k, [...fallosVivos(k, ahora), ahora]);
  if (fallosEntrada.size > 5000) for (const k of [...fallosEntrada.keys()]) fallosVivos(k, ahora);
}

/** Entró con la clave buena: se olvidan los fallos de esa IP (los de otras IPs siguen contando). */
export function anotarExitoEntrada(correo: string, ip: string) {
  fallosEntrada.delete(`${claveCuenta(correo)}|${ip}`);
}

export async function urlPublica(raw: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'URL inválida' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'solo http(s)' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, error: 'host privado bloqueado' };
  }
  if (net.isIP(host) && ipPrivada(host)) {
    return { ok: false, error: 'host privado bloqueado' };
  }
  try {
    const recs = await dns.lookup(host, { all: true });
    if (recs.some((r) => ipPrivada(r.address))) return { ok: false, error: 'resuelve a red privada' };
  } catch {
    return { ok: false, error: 'DNS falló' };
  }
  return { ok: true, url: u.toString() };
}


/* ------------------------------------------------------- acceso por plataforma */

/**
 * Quién viene en esta petición, según el padrón. La prueba sale de la SESIÓN FIRMADA, nunca del
 * cuerpo: el correo de una sesión `u1.` lo emitió este servidor con su HMAC, así que vale.
 */
export function identidadDe(req: Request): Identificacion | null {
  const s = sesionDe(req);
  if (!s) return null;
  const id = identificar({ correo: s.correo, nombre: s.nombre });
  // Una sesión viva de alguien a quien sacaron del padrón ya no identifica a nadie.
  return id && id.prueba === 'sesion' ? id : null;
}

let avisadoHueco = false;

/**
 * La llave de demostración de una plataforma. Permite enseñar Dr Electrum sin crearle sesión a
 * nadie, que es como se va a enseñar a un cliente. Igual que `ULTRON_MESA_CLAVE`, pero por
 * plataforma, para que la llave de la demo minera no abra la mesa de la junta.
 */
function claveDemo(plataforma: Plataforma): string {
  if (plataforma === 'electrum') return String(process.env.ELECTRUM_CLAVE || '').trim();
  return String(process.env.ULTRON_MESA_CLAVE || '').trim();
}

/**
 * ¿La llave FIJA de Dr Electrum abre? (auditoría 3-oct, SEC01). Dr Electrum es solo de la junta y sus
 * datos son reales: una llave que no vence ni se revoca y se pasa de mano en mano no abre nada en
 * producción, y no hay variable que la reactive (una puerta que se puede volver a abrir sigue siendo
 * una puerta). Para que alguien lo PRUEBE están los códigos `DE-…` que crea el aprobador (1, 5 o 24 h,
 * revocables, con el nombre de la persona: server/cuentas.ts), que entran como sesión del padrón y
 * vencen solos. La llave fija queda solo para desarrollo (AURA_DEV=1 / NODE_ENV=test).
 */
export function llaveFijaElectrumPermitida(env: NodeJS.ProcessEnv = process.env): boolean {
  return modoDesarrollo(env);
}

let avisadoLlaveFija = false;

export function plataformaAutorizada(req: Request, plataforma: Plataforma): boolean {
  if (nivelDe(identidadDe(req), plataforma)) return true;

  const clave = claveDemo(plataforma);
  const got = String(req.headers['x-ultron-llave'] || req.headers[plataforma === 'electrum' ? 'x-electrum-llave' : 'x-ultron-mesa'] || '');
  if (clave && got && secretosIguales(clave, got)) {
    if (plataforma !== 'electrum' || llaveFijaElectrumPermitida()) return true;
    if (!avisadoLlaveFija) {
      avisadoLlaveFija = true;
      console.warn('[Electrum] alguien trajo la llave fija y en producción ya no abre: para probar, un código DE-.');
    }
    return false;
  }

  // En modo desarrollo (AURA_DEV=1 o NODE_ENV=test, lib/entorno.ts) y sin llave puesta, se abre: es
  // lo que deja correr las pruebas y el QA de Playwright. Sin esa marca no hay hueco, con llave o sin ella.
  if (modoDesarrollo() && !clave) {
    if (!avisadoHueco) {
      avisadoHueco = true;
      console.warn('[AU-RA] modo desarrollo y sin llave: las plataformas quedan abiertas. Solo desarrollo.');
    }
    return true;
  }
  return false;
}

/** Puerta de una plataforma. Se niega por omisión y dice cuál es la puerta, no por qué se cerró. */
export function exigirPlataforma(plataforma: Plataforma) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (plataformaAutorizada(req, plataforma)) {
      (req as any).identidad = identidadDe(req);
      return next();
    }
    return res.status(401).json({
      error:
        plataforma === 'electrum'
          ? 'Dr Electrum FP es privado. Entrá con tu sesión o con el código de prueba que te dio José.'
          : 'AU-RA es privado. Entra con sesión de junta.',
      code: 'sesion_requerida',
      plataforma,
      honesto: true,
    });
  };
}

/**
 * El cuerpo de un turno que llega por HTTP, sin lo que solo puede poner el servidor: la identidad de
 * Telegram (la pone el webhook, que sí la comprobó), el canal y la sesión (sale del token). Sin esto,
 * cualquiera sin sesión mandaba el id de Telegram de José en `/api/turno` y hablaba con mando.
 */
export function cuerpoHttp(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  // `nivel` (junta o miembro) tampoco: lo pone el servidor por el correo de la sesión (server/nivel.ts).
  const { telegramUserId: _u, telegramChatId: _c, canal: _canal, sesion: _s, nivel: _n, ...resto } = body as Record<string, unknown>;
  return resto;
}
