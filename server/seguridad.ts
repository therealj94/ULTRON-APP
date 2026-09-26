import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { identificar, nivelDe, type Identificacion, type Plataforma } from '../lib/acceso';
import dns from 'dns/promises';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { ipPrivada } from '../lib/red-publica';
import { s3GetJson, s3Listo, s3PutJson } from '../lib/s3';

export type Sesion = {
  token: string;
  correo: string;
  nombre: string;
  rol: string;
  at: number;
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

function firmarSesion(user: { correo: string; nombre: string; rol: string; at: number; exp: number }): string {
  const body = Buffer.from(JSON.stringify(user)).toString('base64url');
  const sig = crypto.createHmac('sha256', secretoSesion()).update(body).digest('base64url');
  return `u1.${body}.${sig}`;
}

/** Lo que dice un token bien firmado (sin mirar si se cerró ni si venció). */
function cuerpoFirmado(token: string): any | null {
  if (!token.startsWith('u1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const body = parts[1];
  const sig = parts[2];
  const expect = crypto.createHmac('sha256', secretoSesion()).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (expect.length !== got.length || expect.length === 0) return null;
  if (!crypto.timingSafeEqual(expect, got)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function leerSesionFirmada(token: string): Sesion | null {
  const p = cuerpoFirmado(token);
  if (!p?.correo || !p?.nombre) return null;
  if (Number(p.exp) && Date.now() > Number(p.exp)) return null;
  return {
    token,
    correo: String(p.correo),
    nombre: String(p.nombre),
    rol: String(p.rol || 'Junta'),
    at: Number(p.at) || Date.now(),
  };
}

export function emitirSesion(user: { correo: string; nombre: string; rol: string }): Sesion {
  const at = Date.now();
  const token = firmarSesion({
    correo: user.correo,
    nombre: user.nombre,
    rol: user.rol,
    at,
    exp: at + SESION_TTL_MS,
  });
  const s: Sesion = { token, correo: user.correo, nombre: user.nombre, rol: user.rol, at };
  sesiones.set(token, s);
  return s;
}

/* ------------------------------------------------------- sesiones cerradas */

/**
 * Un token firmado vale por sí solo 14 días: borrarlo del Map no lo mataba, y «Cerrar sesión» dejaba
 * viva la copia de quien la hubiera sacado del teléfono o del navegador. Aquí se anota su huella hasta
 * que habría vencido. Se guarda en disco y en S3 (si hay), para que un redespliegue no lo resucite.
 */
const CERRADAS_S3 = 'ultron/sesiones-cerradas.json';
const MAX_CERRADAS = 5000;
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

function podarCerradas() {
  const ahora = Date.now();
  for (const [h, v] of cerradas) if (v <= ahora) cerradas.delete(h);
  // Tope: se van las que vencen antes (son las que menos riesgo dejan).
  if (cerradas.size > MAX_CERRADAS) {
    const orden = [...cerradas].sort((a, b) => a[1] - b[1]);
    for (const [h] of orden.slice(0, cerradas.size - MAX_CERRADAS)) cerradas.delete(h);
  }
}

async function guardarCerradas() {
  const datos = Object.fromEntries(cerradas);
  try {
    const f = archivoCerradas();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(datos));
    fs.renameSync(`${f}.tmp`, f);
  } catch (e: any) {
    console.warn('[AU-RA] sesiones cerradas: no pude escribir el disco', String(e?.message || e).slice(0, 120));
  }
  if (s3Listo()) {
    const r = await s3PutJson(CERRADAS_S3, datos).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
    if (!r.ok) console.warn('[AU-RA] sesiones cerradas: S3 no guardó', String(r.detalle).slice(0, 120));
  }
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

/** Cierra la sesión de verdad: el token deja de valer aquí y en cualquier copia. */
export async function borrarSesion(token?: string): Promise<boolean> {
  if (!token) return false;
  sesiones.delete(token);
  // Solo se anota lo que este servidor firmó: si no, cualquiera llenaría la lista con basura.
  const p = cuerpoFirmado(token);
  if (!p) return false;
  const vence = Number(p.exp) || Number(p.at) + SESION_TTL_MS || Date.now() + SESION_TTL_MS;
  if (vence <= Date.now()) return false;
  leerCerradasDeDisco();
  cerradas.set(huellaToken(token), vence);
  podarCerradas();
  await guardarCerradas();
  return true;
}

function sesionCerrada(token: string) {
  leerCerradasDeDisco();
  const v = cerradas.get(huellaToken(token));
  return v !== undefined && v > Date.now();
}

/** Solo pruebas: olvida el caché en memoria (no las cerradas), como tras un redespliegue. */
export function _olvidarCacheSesiones() {
  sesiones.clear();
}

export function tokenDe(req: Request): string {
  const h = String(req.headers['x-ultron-sesion'] || req.headers['authorization'] || '');
  return h.replace(/^Bearer\s+/i, '').trim();
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
    if (Date.now() - cached.at > SESION_TTL_MS) {
      sesiones.delete(t);
      return null;
    }
    return cached;
  }
  const firmada = leerSesionFirmada(t);
  if (firmada) {
    sesiones.set(t, firmada);
    return firmada;
  }
  return null;
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

/** Junta: sesión emitida en /entrar, o clave de mesa en header. En producción no hay hueco. */
export function mesaAutorizada(req: Request): boolean {
  if (sesionDe(req)) return true;
  const clave = process.env.ULTRON_MESA_CLAVE || '';
  const got = String(req.headers['x-ultron-mesa'] || '');
  if (clave && got && secretosIguales(clave, got)) return true;
  if (process.env.NODE_ENV !== 'production' && !clave) return true;
  return false;
}

/**
 * Rutas de conversación: hablar, oír y ver. Decisión de la junta (19-sep): la APK no debe
 * quedar muda si el token murió en un redespliegue, así que pasan con rate limit por IP.
 * Todo lo que cambia estado (memoria, bóveda, ejecutor, redeploy) exige sesión real.
 */
/**
 * La excepción de la APK (decisión de la junta, 19-sep): estas rutas pasan sin sesión, con límite
 * por IP, para que el teléfono no se quede mudo si el token murió en un redespliegue.
 *
 * `/api/electrum` ESTABA en esta lista y no debía: Dr Electrum no viaja en ninguna APK, no tiene
 * token que se le muera, y va a guardar el catastro de un país. Tenerlo aquí lo dejaba abierto a
 * cualquiera que diera con la URL —consultas al catastro y turnos de Qwen gratis, en el nodo de
 * José—. Se gobierna aparte, con `exigirPlataforma('electrum')`.
 */
const RUTAS_CONVERSACION = ['/api/turno', '/api/tts', '/api/stt', '/api/vision/analyze', '/api/cantar', '/api/orar', '/api/voz', '/api/diag'];

function rutaConversacion(path: string) {
  const p = String(path || '').split('?')[0];
  return RUTAS_CONVERSACION.some((r) => p === r || p.startsWith(`${r}/`));
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

export function plataformaAutorizada(req: Request, plataforma: Plataforma): boolean {
  if (nivelDe(identidadDe(req), plataforma)) return true;

  const clave = claveDemo(plataforma);
  const got = String(req.headers['x-ultron-llave'] || req.headers[plataforma === 'electrum' ? 'x-electrum-llave' : 'x-ultron-mesa'] || '');
  if (clave && got && secretosIguales(clave, got)) return true;

  // Fuera de producción y sin llave puesta, se abre: es lo que deja correr las pruebas y el QA de
  // Playwright. En producción no hay hueco, con llave o sin ella.
  if (process.env.NODE_ENV !== 'production' && !clave) {
    if (!avisadoHueco) {
      avisadoHueco = true;
      console.warn('[AU-RA] sin NODE_ENV=production y sin llave: las plataformas quedan abiertas. Solo desarrollo.');
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
          ? 'Dr Electrum FP es privado. Entrá con tu sesión o con la llave de la demostración.'
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
  const { telegramUserId: _u, telegramChatId: _c, canal: _canal, sesion: _s, ...resto } = body as Record<string, unknown>;
  return resto;
}
