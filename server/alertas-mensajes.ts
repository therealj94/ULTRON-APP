/**
 * LAS RUTAS DE LOS AVISOS DE MENSAJES IMPORTANTES (auditoría del 7-oct, A-6; la lógica vive en lib/alertas-mensajes.ts).
 *
 *   POST   /api/whatsapp/aviso               el PUENTE (sin sesión) avisa un mensaje nuevo: firmado con su clave
 *                                            (X-Puente-Firma, servicios/whatsapp-puente/aviso.go). 202 y se procesa aparte.
 *   GET    /api/avisos-mensajes/vip          → { contactos }   sus contactos importantes (sesión)
 *   POST   /api/avisos-mensajes/vip {nombre?, numero?, correo?} → { contacto, total }
 *   DELETE /api/avisos-mensajes/vip {ref}     → { quitados }
 *
 * Y la vuelta del correo (arrancarAlertasCorreo): cada 30 minutos (la cadencia de la iniciativa), a quien usó la app hace
 * poco, sus correos sin leer NUEVOS pasan por el mismo triaje; los importantes le llegan como aviso.
 *
 * La firma del puente: `t=<unix>,v1=<hex>`, HMAC-SHA256 con llave = sha256("aura-puente-aviso|" + WHATSAPP_PUENTE_CLAVE)
 * sobre «<t>.<cuerpo tal cual>». Más de 5 minutos de diferencia, o una firma ya vista: 401. El cuerpo se firma tal como
 * llegó (capturarCuerpoAviso lo guarda antes de que express lo convierta en JSON).
 */
import crypto from 'node:crypto';
import type express from 'express';
import { clave } from '../lib/boveda';
import { alertarSiImporta, type EventoMensaje, type ResultadoAlerta } from '../lib/alertas-mensajes';
import { agregarVip, quitarVip, vipsDe, VipNoDisponible } from '../lib/contactos-vip';
import { duenosDeCuentaWA } from '../lib/duenos-cuenta-wa';
import { claveCuentaWhatsapp, whatsappPermitido } from './whatsapp';

/* ------------------------------------------------------------------ la firma del puente */

export const RUTA_AVISO_WA = '/api/whatsapp/aviso';
export const CABECERA_FIRMA = 'x-puente-firma';
/** Lo más que puede diferir la hora de la firma de la de aquí. */
export const VENTANA_FIRMA_S = 300;

/** Para express.json({ verify }): guarda el cuerpo tal cual SOLO para la ruta del aviso (lo que se firmó). */
export function capturarCuerpoAviso(req: { url?: string; originalUrl?: string }, _res: unknown, buf: Buffer) {
  const u = String(req.originalUrl || req.url || '');
  if (u === RUTA_AVISO_WA || u.startsWith(`${RUTA_AVISO_WA}?`)) (req as any).cuerpoCrudo = Buffer.from(buf);
}

const llaveAviso = (claveP: string) => crypto.createHash('sha256').update(`aura-puente-aviso|${claveP}`).digest();

/** La firma de un cuerpo (la misma que hace el puente). */
export function firmarAviso(claveP: string, t: number, cuerpo: Buffer | string): string {
  const h = crypto.createHmac('sha256', llaveAviso(claveP)).update(`${t}.`).update(cuerpo).digest('hex');
  return `t=${t},v1=${h}`;
}

const FIRMAS_VISTAS = new Map<string, number>();

/** ¿La firma es del puente, reciente y no repetida? `claveP`: WHATSAPP_PUENTE_CLAVE. */
export function verificarFirmaAviso(cabecera: unknown, cuerpo: Buffer | null | undefined, claveP: string, ahoraMs = Date.now()): { ok: true } | { ok: false; motivo: string } {
  if (!claveP || claveP.length < 24) return { ok: false, motivo: 'sin clave del puente' };
  if (!cuerpo) return { ok: false, motivo: 'sin cuerpo' };
  const m = /^t=(\d{9,12}),v1=([0-9a-f]{64})$/.exec(String(cabecera || '').trim());
  if (!m) return { ok: false, motivo: 'firma mal formada' };
  const t = Number(m[1]);
  if (Math.abs(ahoraMs / 1000 - t) > VENTANA_FIRMA_S) return { ok: false, motivo: 'firma vieja' };
  const esperada = Buffer.from(firmarAviso(claveP, t, cuerpo).slice(-64), 'hex');
  const dada = Buffer.from(m[2], 'hex');
  if (esperada.length !== dada.length || !crypto.timingSafeEqual(esperada, dada)) return { ok: false, motivo: 'firma incorrecta' };
  // La misma firma dos veces (alguien la repite): no.
  for (const [k, v] of FIRMAS_VISTAS) if (ahoraMs - v > VENTANA_FIRMA_S * 2000) FIRMAS_VISTAS.delete(k);
  if (FIRMAS_VISTAS.has(m[2])) return { ok: false, motivo: 'firma repetida' };
  if (FIRMAS_VISTAS.size > 20_000) FIRMAS_VISTAS.clear();
  FIRMAS_VISTAS.set(m[2], ahoraMs);
  return { ok: true };
}

/* ------------------------------------------------------------------ un aviso del puente */

export type AvisoPuente = {
  cuenta: string;
  id: string;
  chat: string;
  de?: string;
  nombreDe?: string;
  nombreChat?: string;
  grupo?: boolean;
  hora?: number;
  tipo?: string;
  texto?: string;
  archivo?: string;
  duracion?: number;
};

const linea = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** El aviso, validado (null si le falta lo imprescindible o no tiene la forma del puente). */
export function leerAvisoPuente(j: any): AvisoPuente | null {
  if (!j || typeof j !== 'object') return null;
  const cuenta = String(j.cuenta || '');
  const id = String(j.id || '');
  const chat = String(j.chat || '');
  if (!/^(legado|[a-f0-9]{32,64})$/.test(cuenta) || !/^[A-Za-z0-9._:-]{1,128}$/.test(id) || !/^[0-9A-Za-z._:-]{3,120}@[a-z.]{2,40}$/.test(chat)) return null;
  return {
    cuenta,
    id,
    chat,
    de: linea(j.de, 120),
    nombreDe: linea(j.nombreDe, 80),
    nombreChat: linea(j.nombreChat, 80),
    grupo: j.grupo === true || /@g\.us$/.test(chat),
    hora: Number(j.hora) || 0,
    tipo: linea(j.tipo, 20) || 'texto',
    texto: String(j.texto ?? '').slice(0, 1000),
    archivo: linea(j.archivo, 120),
    duracion: Number(j.duracion) || 0,
  };
}

/** El número de un jid de persona («50499990000@s.whatsapp.net» → «+50499990000»). */
const numeroDeJid = (jid?: string) => {
  const m = String(jid || '').match(/^(\d{7,15})@(s\.whatsapp\.net|c\.us)$/);
  return m ? `+${m[1]}` : '';
};

/** Lo que hace falta de afuera para un aviso del puente (las pruebas ponen otros). */
export type DepsAvisoWA = {
  duenos: (cuenta: string) => Promise<string[]>;
  claveDe: (correo: string) => string;
  permitido: (correo: string) => Promise<boolean>;
  alertar: (correo: string, ev: EventoMensaje, fuente: string) => Promise<ResultadoAlerta>;
};
const DEPS_AVISO: DepsAvisoWA = { duenos: duenosDeCuentaWA, claveDe: claveCuentaWhatsapp, permitido: (c) => whatsappPermitido(c), alertar: alertarSiImporta };

/**
 * Un mensaje nuevo en una cuenta del puente: a cada persona dueña de ESA cuenta (comprobado otra vez con su clave) que
 * puede usar su WhatsApp, el triaje y, si importa, el aviso. Nunca lanza.
 */
export async function procesarAvisoWhatsapp(a: AvisoPuente, d: Partial<DepsAvisoWA> = {}): Promise<ResultadoAlerta[]> {
  const dep = { ...DEPS_AVISO, ...d };
  const out: ResultadoAlerta[] = [];
  const correos = await dep.duenos(a.cuenta).catch(() => [] as string[]);
  for (const correo of correos) {
    // El registro dice quién la usó; la clave lo confirma (un registro alterado no avisa a otra persona).
    if (dep.claveDe(correo) !== a.cuenta) {
      out.push({ correo, avisado: false, porque: 'no es su cuenta' });
      continue;
    }
    if (!(await dep.permitido(correo).catch(() => false))) {
      out.push({ correo, avisado: false, porque: 'sin permiso de WhatsApp' });
      continue;
    }
    const ev: EventoMensaje = {
      canal: 'whatsapp',
      id: a.id,
      chat: a.chat,
      nombre: a.nombreDe || numeroDeJid(a.de) || 'Alguien',
      numero: numeroDeJid(a.de) || (a.grupo ? '' : numeroDeJid(a.chat)),
      grupo: !!a.grupo,
      ...(a.nombreChat ? { nombreChat: a.nombreChat } : {}),
      hora: a.hora || Date.now(),
      tipo: a.tipo,
      texto: a.texto || '',
      ...(a.archivo ? { archivo: a.archivo } : {}),
      ...(a.duracion ? { duracion: a.duracion } : {}),
    };
    out.push(await dep.alertar(correo, ev, 'wa-alerta'));
  }
  return out;
}

/* ------------------------------------------------------------------ la vuelta del correo */

type ResumenCorreo = { ref: string; de: string; deCorreo: string; asunto: string; fecha: string; extracto?: string };
export type DepsCorreoAlertas = {
  cuentas: (correo: string) => Promise<{ ok: true; cuentas: Array<{ id: string; correo: string }> } | { ok: false }>;
  noLeidos: (correo: string, cuenta: any) => Promise<ResumenCorreo[]>;
  alertar: (correo: string, ev: EventoMensaje, fuente: string) => Promise<ResultadoAlerta>;
  ahora: () => number;
};
const DEPS_CORREO: DepsCorreoAlertas = {
  cuentas: async (c) => (await import('../lib/correo/cuentas')).leerCuentasSeguro(c) as any,
  noLeidos: async (c, cuenta) => (await import('../lib/correo/buzon')).listar(c, cuenta, { soloNoLeidos: true, n: 8, extractos: true }),
  alertar: alertarSiImporta,
  ahora: () => Date.now(),
};

/** Lo más viejo que se avisa en una vuelta: lo de las dos últimas vueltas (al arrancar no llueven avisos de lo de ayer). */
export const VIDA_CORREO_ALERTA_MS = 65 * 60_000;

/** Los correos sin leer NUEVOS de una persona, por el triaje. Nunca lanza. */
export async function revisarCorreoParaAlertas(correo: string, d: Partial<DepsCorreoAlertas> = {}): Promise<ResultadoAlerta[]> {
  const dep = { ...DEPS_CORREO, ...d };
  const out: ResultadoAlerta[] = [];
  const leidas = await dep.cuentas(correo).catch(() => ({ ok: false as const }));
  if (leidas.ok === false) return out;
  const ahora = dep.ahora();
  for (const cuenta of leidas.cuentas) {
    let lista: ResumenCorreo[] = [];
    try {
      lista = await dep.noLeidos(correo, cuenta);
    } catch {
      continue; // una cuenta caída no frena las otras (y no es «no hay nada»: simplemente no se avisa)
    }
    for (const r of lista) {
      const hora = Date.parse(r.fecha) || 0;
      if (!hora || ahora - hora > VIDA_CORREO_ALERTA_MS) continue;
      const ev: EventoMensaje = { canal: 'correo', id: r.ref, chat: r.ref, nombre: r.de || r.deCorreo, correoDe: r.deCorreo, grupo: false, hora, texto: r.extracto || '', asunto: r.asunto };
      out.push(await dep.alertar(correo, ev, 'correo-alerta'));
    }
  }
  return out;
}

/** La vuelta del correo, cada `cadaMs` (30 min, como la iniciativa). No arranca al importar. */
export function arrancarAlertasCorreo(o: { personas: () => Array<{ correo: string }>; cadaMs?: number; max?: number }): { parar(): void; vuelta(): Promise<number> } {
  let corriendo = false;
  const vuelta = async () => {
    if (corriendo) return 0;
    corriendo = true;
    let avisados = 0;
    try {
      const vistos = new Set<string>();
      for (const p of o.personas()) {
        const c = String(p.correo || '').trim().toLowerCase();
        if (!c.includes('@') || vistos.has(c)) continue;
        vistos.add(c);
        if (vistos.size > (o.max ?? 40)) break;
        avisados += (await revisarCorreoParaAlertas(c)).filter((r) => r.avisado).length;
      }
    } finally {
      corriendo = false;
    }
    return avisados;
  };
  const t = setInterval(() => void vuelta().catch(() => undefined), o.cadaMs ?? 30 * 60_000);
  t.unref?.();
  return { parar: () => clearInterval(t), vuelta };
}

/* ------------------------------------------------------------------ las rutas */

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo: string } | null;
  /** Pruebas: procesar el aviso de otra forma (y esperarlo). */
  procesar?: (a: AvisoPuente) => Promise<unknown>;
  /** Pruebas: esperar al proceso antes de contestar. */
  esperar?: boolean;
};

export function montarRutasAlertas(app: express.Express, d: Deps) {
  const procesar = d.procesar || ((a: AvisoPuente) => procesarAvisoWhatsapp(a));

  app.post(RUTA_AVISO_WA, d.limitar(600, 60_000, 'whatsapp-aviso'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const crudo: Buffer | undefined = (req as any).cuerpoCrudo || (Buffer.isBuffer(req.body) ? req.body : undefined);
    const v = verificarFirmaAviso(req.headers[CABECERA_FIRMA], crudo, clave('whatsapp_clave'));
    if (v.ok === false) return res.status(401).json({ error: 'firma', motivo: v.motivo });
    let j: unknown;
    try {
      j = JSON.parse(crudo!.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'cuerpo' });
    }
    const a = leerAvisoPuente(j);
    if (!a) return res.status(400).json({ error: 'aviso incompleto' });
    // El puente no espera al triaje ni a Firebase (su trabajador es uno solo): se contesta y se procesa aparte.
    const p = Promise.resolve()
      .then(() => procesar(a))
      .catch((e) => console.warn('[avisos wa] no pude procesar un aviso', String(e?.message || e).slice(0, 120)));
    if (d.esperar) await p;
    return res.status(202).json({ ok: true });
  });

  const correoDe = (req: express.Request) => String(d.sesionDe(req)?.correo || '').trim().toLowerCase();
  const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
  const noDisponible = (res: express.Response) => res.status(503).json({ error: 'Ahora mismo no pude leer tus contactos importantes; no cambié nada. Prueba en un momento.', code: 'vip_no_disponible', honesto: true });

  app.get('/api/avisos-mensajes/vip', d.exigirMesa, d.limitar(60), async (req, res) => {
    const correo = correoDe(req);
    res.setHeader('Cache-Control', 'no-store');
    if (!correo) return sinSesion(res);
    const r = await vipsDe(correo);
    if (r.ok === false) return noDisponible(res);
    return res.json({ contactos: r.contactos, honesto: true });
  });

  app.post('/api/avisos-mensajes/vip', d.exigirMesa, d.limitar(30), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const b = (req.body || {}) as Record<string, unknown>;
    try {
      const r = await agregarVip(correo, { nombre: linea(b.nombre, 80), numero: linea(b.numero, 30), correo: linea(b.correo, 200) });
      if (r.lleno) return res.status(409).json({ error: 'Ya tienes 50 contactos importantes: quita alguno primero.', code: 'vip_lleno', honesto: true });
      return res.json({ contacto: r.contacto, nuevo: r.nuevo, total: r.total, durable: r.durable, honesto: true });
    } catch (e) {
      if (e instanceof VipNoDisponible) return noDisponible(res);
      return res.status(400).json({ error: String((e as Error)?.message || e).slice(0, 120), honesto: true });
    }
  });

  app.delete('/api/avisos-mensajes/vip', d.exigirMesa, d.limitar(30), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const ref = linea((req.body || {}).ref ?? req.query.ref, 200);
    if (!ref) return res.status(400).json({ error: 'Falta a quién quitar.', honesto: true });
    try {
      const r = await quitarVip(correo, ref);
      return res.json({ quitados: r.quitados.length, durable: r.durable, honesto: true });
    } catch (e) {
      if (e instanceof VipNoDisponible) return noDisponible(res);
      return res.status(500).json({ error: 'No pude quitarlo.', honesto: true });
    }
  });
}

/** Pruebas. */
export function _olvidarFirmasAviso() {
  FIRMAS_VISTAS.clear();
}
