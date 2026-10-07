/**
 * SUS CONTACTOS IMPORTANTES (VIP) PARA LOS AVISOS DE MENSAJES (auditoría del 7-oct, A-6). Los marca la persona («avísame
 * cuando me escriba Ana», la herramienta `contactos_vip` o Ajustes): un mensaje de uno de ellos por WhatsApp o por correo
 * le llega como aviso al teléfono (lib/alertas-mensajes.ts); de noche solo si es urgente.
 *
 * Por cuenta de AU-RA (el correo de su sesión), en el cajón seguro de siempre (lib/misiones.ts: caché, disco
 * `data/vip-mensajes/` o ULTRON_VIP_DIR, y S3 `ultron/vip-mensajes/<huella>.json`). Solo el nombre, el número y el correo
 * que dio la persona; nada de mensajes.
 */
import { cajonPorCorreo, AlmacenNoDisponible } from './misiones';

export type ContactoVip = { nombre: string; numero?: string; correo?: string; t: number };
type CajonVip = { version: 1; contactos: ContactoVip[] };

export const MAX_VIP = 50;
export { AlmacenNoDisponible as VipNoDisponible };

const linea = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
export const plegarVip = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ@.\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const correoValido = (s: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(s);

function sanear(x: unknown): CajonVip {
  const xs = Array.isArray((x as any)?.contactos) ? ((x as any).contactos as unknown[]) : [];
  const contactos: ContactoVip[] = [];
  for (const c of xs) {
    const o = (c || {}) as Record<string, unknown>;
    const nombre = linea(o.nombre, 80);
    const numero = digitos(o.numero).slice(0, 15);
    const correo = linea(o.correo, 200).toLowerCase();
    if (!nombre && !numero && !correo) continue;
    contactos.push({ nombre: nombre || numero || correo, ...(numero.length >= 7 ? { numero } : {}), ...(correoValido(correo) ? { correo } : {}), t: Number(o.t) || 0 });
  }
  return { version: 1, contactos: contactos.slice(0, MAX_VIP) };
}

const cajon = cajonPorCorreo<CajonVip>({
  nombre: 'vip-mensajes',
  s3: 'ultron/vip-mensajes',
  dirEnv: 'ULTRON_VIP_DIR',
  dirDef: 'vip-mensajes',
  sanear,
  vacio: () => ({ version: 1, contactos: [] }),
  que: 'tus contactos importantes',
});

/** Sus VIP; `{ ok: false }` si no se pudieron leer (nunca «no tiene»). Nunca lanza. */
export async function vipsDe(correo: string): Promise<{ ok: true; contactos: ContactoVip[] } | { ok: false }> {
  const r = await cajon.leer(correo).catch(() => ({ ok: false as const }));
  return r.ok ? { ok: true, contactos: r.valor.contactos } : { ok: false };
}

/**
 * Agrega (o actualiza) un VIP: el mismo número, correo o nombre exacto es el mismo contacto. Lanza VipNoDisponible si lo
 * guardado no se pudo leer (guardar encima borraría los demás).
 */
export async function agregarVip(correo: string, c: { nombre?: string; numero?: string; correo?: string }, ahora = Date.now()): Promise<{ contacto: ContactoVip; nuevo: boolean; total: number; durable: boolean; lleno?: boolean }> {
  const nuevoC = sanear({ contactos: [{ ...c, t: ahora }] }).contactos[0];
  if (!nuevoC) throw new Error('falta a quién (el nombre, el número o el correo)');
  const r = await cajon.modificar(correo, (cj) => {
    const i = cj.contactos.findIndex((x) => mismoContacto(x, nuevoC));
    if (i >= 0) {
      const viejo = cj.contactos[i];
      cj.contactos[i] = { nombre: nuevoC.nombre || viejo.nombre, ...(nuevoC.numero || viejo.numero ? { numero: nuevoC.numero || viejo.numero } : {}), ...(nuevoC.correo || viejo.correo ? { correo: nuevoC.correo || viejo.correo } : {}), t: ahora };
      return { contacto: cj.contactos[i], nuevo: false, total: cj.contactos.length };
    }
    if (cj.contactos.length >= MAX_VIP) return { contacto: nuevoC, nuevo: false, total: cj.contactos.length, lleno: true };
    cj.contactos.push(nuevoC);
    return { contacto: nuevoC, nuevo: true, total: cj.contactos.length };
  });
  return { ...r.resultado, durable: r.durable };
}

/** Quita los VIP que encajan con `ref` (nombre exacto, número o correo). */
export async function quitarVip(correo: string, ref: string): Promise<{ quitados: ContactoVip[]; durable: boolean }> {
  const r = await cajon.modificar(correo, (cj) => {
    const fuera = cj.contactos.filter((x) => encajaRef(x, ref));
    cj.contactos = cj.contactos.filter((x) => !encajaRef(x, ref));
    return fuera;
  });
  return { quitados: r.resultado, durable: r.durable };
}

/** Dos números son el mismo si uno termina en el otro y comparten al menos 8 dígitos (con o sin el +504). */
export function mismoNumero(a: string | undefined, b: string | undefined): boolean {
  const x = digitos(a);
  const y = digitos(b);
  if (x.length < 8 || y.length < 8) return false;
  return x.endsWith(y) || y.endsWith(x);
}

function mismoContacto(a: ContactoVip, b: ContactoVip): boolean {
  if (a.numero && b.numero) return mismoNumero(a.numero, b.numero);
  if (a.correo && b.correo) return a.correo === b.correo;
  return plegarVip(a.nombre) === plegarVip(b.nombre);
}

function encajaRef(x: ContactoVip, ref: string): boolean {
  const r = String(ref || '').trim();
  if (!r) return false;
  if (r.includes('@')) return !!x.correo && x.correo === r.toLowerCase();
  if (digitos(r).length >= 8 && digitos(r).length >= r.replace(/[\s+()-]/g, '').length - 1) return mismoNumero(x.numero, r);
  return plegarVip(x.nombre) === plegarVip(r);
}

/**
 * ¿Quien escribe es uno de sus VIP? Por su número (lo más seguro), su correo, o su nombre EXACTO como lo tiene guardado
 * (un VIP dado solo por nombre: «Ana» no encaja con «Ana Paz»). null si no.
 */
export function vipDe(contactos: readonly ContactoVip[], quien: { nombre?: string; numero?: string; correo?: string }): ContactoVip | null {
  const correo = String(quien.correo || '').trim().toLowerCase();
  for (const c of contactos) {
    if (c.numero && quien.numero && mismoNumero(c.numero, quien.numero)) return c;
    if (c.correo && correo && c.correo === correo) return c;
  }
  const nombre = plegarVip(quien.nombre);
  if (!nombre) return null;
  return contactos.find((c) => !c.numero && !c.correo && plegarVip(c.nombre) === nombre) || contactos.find((c) => plegarVip(c.nombre) === nombre && !quien.numero && !correo) || null;
}

/** Pruebas. */
export function _olvidarVips() {
  cajon._olvidar();
}
