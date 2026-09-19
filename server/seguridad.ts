import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';

export type Sesion = {
  token: string;
  correo: string;
  nombre: string;
  rol: string;
  at: number;
};

const sesiones = new Map<string, Sesion>();
const hits = new Map<string, number[]>();

export function emitirSesion(user: { correo: string; nombre: string; rol: string }): Sesion {
  const token = crypto.randomBytes(24).toString('hex');
  const s: Sesion = { token, correo: user.correo, nombre: user.nombre, rol: user.rol, at: Date.now() };
  sesiones.set(token, s);
  return s;
}

export function borrarSesion(token?: string) {
  if (token) sesiones.delete(token);
}

export function tokenDe(req: Request): string {
  const h = String(req.headers['x-ultron-sesion'] || req.headers['authorization'] || '');
  return h.replace(/^Bearer\s+/i, '').trim();
}

export function sesionDe(req: Request): Sesion | null {
  const t = tokenDe(req);
  if (!t) return null;
  return sesiones.get(t) || null;
}

export function exigirSesion(req: Request, res: Response, next: NextFunction) {
  const s = sesionDe(req);
  if (!s) return res.status(401).json({ error: 'sesión requerida', honesto: true });
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

export function exigirMesa(req: Request, res: Response, next: NextFunction) {
  if (mesaAutorizada(req)) return next();
  return res.status(401).json({ error: 'ULTRON es privado. Entra con sesión de junta.', honesto: true });
}

export function limitar(max: number, ventanaMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = String(req.ip || req.socket.remoteAddress || 'x');
    const k = `${ip}:${req.path}`;
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < ventanaMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: 'demasiadas peticiones', honesto: true });
    }
    arr.push(now);
    hits.set(k, arr);
    next();
  };
}

function ipPrivada(ip: string) {
  if (!net.isIP(ip)) return true;
  const n = ip.toLowerCase();
  if (n === '::1' || n.startsWith('127.') || n.startsWith('10.') || n.startsWith('192.168.') || n.startsWith('169.254.')) return true;
  const m = n.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
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
  if (host === 'localhost' || host.endsWith('.local')) {
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
