/**
 * EL NIVEL DE UNA SESIÓN EN AU-RA: junta o miembro.
 *
 * Con AURA_GENESIS_ABIERTO=1 entra a AU-RA toda persona con Genesis ID verificado. Eso no la hace de
 * la junta. Aquí se decide, en UN solo sitio y siempre en el servidor, con qué AU-RA habla cada quien:
 *
 *   · `junta`   — está en el padrón de AU-RA (lib/acceso.ts: `puedeEntrar(identificar({ correo }))`)
 *                 o en JUNTA (server/desk.ts). Todo como siempre: cerebro de la junta, taller,
 *                 Telegram de la organización, memoria de junta.
 *   · `miembro` — entró por Genesis abierto y NO está en el padrón. AU-RA como asistente personal de
 *                 la comunidad de Orden Global: conocimiento público, sin taller, sin Telegram de la
 *                 organización, sin nada interno de la junta.
 *
 * El nivel sale del CORREO de la sesión firmada, nunca del cuerpo de la petición ni de un nombre: un
 * miembro que se llame «José» sigue siendo miembro. Se recalcula en cada petición, así que quitar a
 * alguien del padrón lo baja a miembro sin esperar a que venza su sesión.
 */
import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { identificar, puedeEntrar, type Plataforma } from '../lib/acceso';
import type { NivelAura } from '../lib/perfiles/tipos';
import { JUNTA, normalizarCorreo } from './desk';
import { mesaAutorizada, sesionDe } from './seguridad';

export type { NivelAura } from '../lib/perfiles/tipos';

/** El rol visible de quien entró por Genesis abierto sin estar en el padrón. */
export const ROL_MIEMBRO = 'Miembro · Genesis ID';
/** El rol visible de la junta que no tiene uno propio en JUNTA. */
export const ROL_JUNTA = 'Junta Directiva · Orden Global';

/** Junta o miembro, a partir del correo (padrón o JUNTA). Sin correo válido: miembro. */
export function nivelDeCorreo(correo: unknown, plataforma: Plataforma = 'ultron'): NivelAura {
  const c = normalizarCorreo(correo);
  if (!c || !c.includes('@')) return 'miembro';
  if (JUNTA[c]) return 'junta';
  // Solo por correo: `identificar` con un nombre dejaría pasar por José a cualquiera llamado José.
  return puedeEntrar(identificar({ correo: c }), plataforma) ? 'junta' : 'miembro';
}

/** El rol con que se saluda y se firma la sesión: el propio de JUNTA, el de la junta o el de miembro. */
export function rolVisible(correo: unknown, nivel: NivelAura = nivelDeCorreo(correo)): string {
  const c = normalizarCorreo(correo);
  if (nivel === 'miembro') return ROL_MIEMBRO;
  return JUNTA[c]?.rol || ROL_JUNTA;
}

function mismaClave(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

/**
 * El nivel de una petición HTTP:
 *  · con sesión firmada, el de su correo (aunque además traiga la clave de la mesa);
 *  · sin sesión, con la clave de la mesa (`x-ultron-mesa`), junta: es el aparato de la junta;
 *  · fuera de producción y sin clave de mesa puesta, junta (el mismo hueco de desarrollo que
 *    `mesaAutorizada`, para que las pruebas y el QA local sigan como hoy);
 *  · cualquier otra cosa (las rutas de conversación abiertas por IP, sin sesión), miembro.
 */
export function nivelDePeticion(req: Request): NivelAura {
  const s = sesionDe(req);
  if (s) return nivelDeCorreo(s.correo);
  const clave = String(process.env.ULTRON_MESA_CLAVE || '');
  const dada = String(req.headers['x-ultron-mesa'] || '');
  if (clave && dada && mismaClave(clave, dada)) return 'junta';
  if (process.env.NODE_ENV !== 'production' && !clave) return 'junta';
  return 'miembro';
}

/**
 * De dos opiniones sobre el nivel (lo firmado en un pase y lo que dice hoy el padrón), la más
 * estrecha: junta solo si las dos dicen junta. Lo que falte no suma.
 */
export function nivelMasEstrecho(...niveles: Array<NivelAura | null | undefined>): NivelAura {
  const dados = niveles.filter((n): n is NivelAura => n === 'junta' || n === 'miembro');
  return dados.length && dados.every((n) => n === 'junta') ? 'junta' : 'miembro';
}

/** Lo que venga de afuera (un pase viejo, un cuerpo) como nivel, o null si no es uno válido. */
export function nivelValido(v: unknown): NivelAura | null {
  return v === 'junta' || v === 'miembro' ? v : null;
}

/**
 * Puerta de lo que es solo de la junta (estado del sistema, bóveda, pendientes, archivos del taller,
 * el ojo del nodo): primero la de siempre (sesión o clave de la mesa) y además nivel de junta. Un
 * miembro con sesión recibe un 403 que dice por qué, sin detalles de lo que hay detrás.
 */
export function exigirJunta(req: Request, res: Response, next: NextFunction) {
  if (!mesaAutorizada(req)) return res.status(401).json({ error: 'AU-RA es privado. Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
  if (nivelDePeticion(req) !== 'junta') return res.status(403).json({ error: 'Esto es de la junta directiva de Orden Global.', code: 'solo_junta', honesto: true });
  return next();
}
