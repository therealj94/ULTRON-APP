/**
 * AVISOS AL TELÉFONO CON LA APP CERRADA (Firebase Cloud Messaging, API HTTP v1).
 *
 * José (2-oct): que AURA lo pueda alcanzar aunque AU-RA esté cerrada: que lo LLAME (pantalla completa,
 * como la llamada de un recordatorio), que le proponga algo, que le recuerde y que le cuente lo que
 * terminó su computadora. El canal de acciones (server/app-rutas.ts) solo llega con la app abierta;
 * esto llega siempre.
 *
 * Sin dependencias nuevas: el JWT de la cuenta de servicio se firma aquí (RS256 con node:crypto), se
 * cambia por un token de acceso en https://oauth2.googleapis.com/token (scope firebase.messaging) y se
 * guarda hasta ~5 minutos antes de que venza. Cada aviso es un POST a
 * https://fcm.googleapis.com/v1/projects/<project_id>/messages:send.
 *
 *  · SOLO DATOS (sin bloque `notification`): la app decide cómo se ve (notifee: llamada a pantalla
 *    completa, botones «Sí» / «Luego»…). Todos los valores van como TEXTO (FCM lo exige en `data`).
 *  · La credencial es FIREBASE_SERVICE_ACCOUNT (el JSON entero de la cuenta de servicio; también vale
 *    en base64), leída por la bóveda (`firebase_cuenta`). NUNCA se escribe en un log, ni ella ni los
 *    tokens de los teléfonos.
 *  · Los teléfonos de cada persona, por el correo de su SESIÓN (cajón seguro de lib/misiones.ts: caché,
 *    disco `data/push/` o ULTRON_PUSH_DIR, y S3 `ultron/push/<huella>.json`; si S3 no se pudo leer no
 *    se escribe encima). Hasta MAX_DISPOSITIVOS por persona; el mismo aparato que vuelve reemplaza al viejo.
 *  · Un token que FCM da por muerto (UNREGISTERED, o INVALID_ARGUMENT que señala al token, o un token de
 *    otro proyecto) se borra solo. Un fallo pasajero (429, 5xx, sin red) no borra nada.
 *  · Cada aviso lleva `para`: el seudónimo de la cuenta (el mismo que calcula el teléfono,
 *    mobile/src/lib/cuenta.ts `seudonimoDe`). En un teléfono compartido, si ya entró otra persona, el
 *    aviso no se enseña.
 */
import crypto from 'node:crypto';
import { clave } from './boveda';
import { AlmacenNoDisponible, cajonPorCorreo } from './misiones';

/* ------------------------------------------------------------------ tipos */

export type TipoPush = 'llamada' | 'mensaje' | 'propuesta' | 'recordatorio' | 'computadora';
export const TIPOS_PUSH: readonly TipoPush[] = ['llamada', 'mensaje', 'propuesta', 'recordatorio', 'computadora'];

export type Plataforma = 'android' | 'ios' | 'web';
export type Dispositivo = { token: string; aparato: string; plataforma: Plataforma; app: string; fecha: number };
type CajonPush = { version: 1; dispositivos: Dispositivo[] };

export type DatosPush = { tipo: TipoPush; id?: string } & Record<string, unknown>;
export type ResultadoPush = { enviados: number; fallidos: number; quitados: number; configurado: boolean; detalle?: string };

export const MAX_DISPOSITIVOS = 5;
/** Lo que vive un aviso en FCM si el teléfono está apagado. La llamada, un minuto: una llamada vieja no suena. */
export const TTL_LLAMADA_S = 60;
export const TTL_NORMAL_S = 6 * 3600;
export const ALCANCE_FCM = 'https://www.googleapis.com/auth/firebase.messaging';
export const URL_TOKEN_GOOGLE = 'https://oauth2.googleapis.com/token';
/** El token de acceso se renueva cuando le quedan menos de esto. */
export const MARGEN_TOKEN_MS = 5 * 60_000;
const TOPE_HTTP_MS = 10_000;
/** FCM acepta 4 KB de datos; se deja holgura. */
const MAX_VALOR = 900;

/* ------------------------------------------------------------------ la cuenta de servicio */

export type CuentaServicio = { project_id: string; client_email: string; private_key: string; token_uri: string };

let cuentaLeida: { crudo: string; cuenta: CuentaServicio | null } | null = null;

/** El JSON de FIREBASE_SERVICE_ACCOUNT (o en base64), validado. null si falta o no se entiende. Nunca lanza. */
export function cuentaServicio(): CuentaServicio | null {
  const crudo = clave('firebase_cuenta');
  if (!crudo) return null;
  if (cuentaLeida && cuentaLeida.crudo === crudo) return cuentaLeida.cuenta;
  let cuenta: CuentaServicio | null = null;
  try {
    const texto = crudo.startsWith('{') ? crudo : Buffer.from(crudo, 'base64').toString('utf8');
    const j = JSON.parse(texto) as Record<string, unknown>;
    // Pegada en un panel, la llave suele llegar con «\n» escritos en vez de saltos de línea.
    const llave = String(j.private_key || '').replace(/\\n/g, '\n');
    const proyecto = String(j.project_id || '').trim();
    const correo = String(j.client_email || '').trim();
    if (proyecto && correo && llave.includes('PRIVATE KEY')) {
      const uri = String(j.token_uri || URL_TOKEN_GOOGLE).trim();
      // Solo el de Google: un JSON manipulado no puede mandar la firma a otra parte.
      cuenta = { project_id: proyecto, client_email: correo, private_key: llave, token_uri: /^https:\/\/oauth2\.googleapis\.com\//.test(uri) ? uri : URL_TOKEN_GOOGLE };
    }
  } catch {
    cuenta = null;
  }
  if (!cuenta) console.warn('[push] FIREBASE_SERVICE_ACCOUNT no se entiende (se espera el JSON de la cuenta de servicio)');
  cuentaLeida = { crudo, cuenta };
  return cuenta;
}

/** ¿Hay con qué mandar avisos? */
export function pushConfigurado(): boolean {
  return !!cuentaServicio();
}

/* ------------------------------------------------------------------ el JWT y el token de acceso */

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** El JWT firmado (RS256) que Google cambia por un token de acceso. */
export function construirJwt(c: Pick<CuentaServicio, 'client_email' | 'private_key' | 'token_uri'>, ahoraMs = Date.now()): string {
  const iat = Math.floor(ahoraMs / 1000);
  const cabecera = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify({ iss: c.client_email, scope: ALCANCE_FCM, aud: c.token_uri || URL_TOKEN_GOOGLE, iat, exp: iat + 3600 }));
  const firma = crypto.sign('RSA-SHA256', Buffer.from(`${cabecera}.${cuerpo}`), c.private_key);
  return `${cabecera}.${cuerpo}.${b64url(firma)}`;
}

let acceso: { token: string; vence: number; de: string } | null = null;
let pidiendoAcceso: { de: string; p: Promise<string> } | null = null;

async function conTope(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TOPE_HTTP_MS);
  try {
    return await globalThis.fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** El token de acceso de FCM (de la caché si le quedan más de 5 minutos). Lanza si Google no lo da. */
export async function tokenDeAcceso(ahora: () => number = Date.now): Promise<string> {
  const c = cuentaServicio();
  if (!c) throw new Error('Push sin configurar (FIREBASE_SERVICE_ACCOUNT).');
  const de = `${c.client_email}|${c.project_id}`;
  if (acceso && acceso.de === de && acceso.vence - MARGEN_TOKEN_MS > ahora()) return acceso.token;
  if (pidiendoAcceso && pidiendoAcceso.de === de) return pidiendoAcceso.p;
  const p = (async () => {
    const assertion = construirJwt(c, ahora());
    const r = await conTope(c.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    // Sin el cuerpo en el log: puede traer detalles de la cuenta.
    if (!r.ok || !j.access_token) throw new Error(`Google no dio el token de FCM (HTTP ${r.status}${j.error ? `, ${String(j.error).slice(0, 40)}` : ''}).`);
    const vence = ahora() + Math.max(60, Number(j.expires_in) || 3600) * 1000;
    acceso = { token: j.access_token, vence, de };
    return j.access_token;
  })().finally(() => {
    if (pidiendoAcceso?.p === p) pidiendoAcceso = null;
  });
  pidiendoAcceso = { de, p };
  return p;
}

/* ------------------------------------------------------------------ los teléfonos de cada persona */

const RE_TOKEN = /^[A-Za-z0-9_:.\-]{20,4096}$/;
const RE_APARATO = /^[A-Za-z0-9._:-]{1,128}$/;

export function tokenValido(x: unknown): string | null {
  const t = String(x ?? '').trim();
  return RE_TOKEN.test(t) ? t : null;
}

function sanearCajon(x: unknown): CajonPush {
  const lista = Array.isArray((x as CajonPush | null)?.dispositivos) ? (x as CajonPush).dispositivos : [];
  const vistos = new Set<string>();
  const dispositivos: Dispositivo[] = [];
  for (const d of lista) {
    const token = tokenValido(d?.token);
    if (!token || vistos.has(token)) continue;
    vistos.add(token);
    const plataforma: Plataforma = d.plataforma === 'ios' || d.plataforma === 'web' ? d.plataforma : 'android';
    dispositivos.push({
      token,
      aparato: RE_APARATO.test(String(d.aparato || '')) ? String(d.aparato) : '',
      plataforma,
      app: /^[a-z0-9-]{1,20}$/.test(String(d.app || '')) ? String(d.app) : 'aura',
      fecha: Number.isFinite(Number(d.fecha)) ? Number(d.fecha) : 0,
    });
  }
  // Los más recientes primero; los que pasan del tope se van.
  dispositivos.sort((a, b) => b.fecha - a.fecha);
  return { version: 1, dispositivos: dispositivos.slice(0, MAX_DISPOSITIVOS) };
}

const almacen = cajonPorCorreo<CajonPush>({
  nombre: 'push',
  s3: 'ultron/push',
  dirEnv: 'ULTRON_PUSH_DIR',
  dirDef: 'push',
  sanear: sanearCajon,
  vacio: () => ({ version: 1, dispositivos: [] }),
  que: 'tus teléfonos para avisos',
});

export { AlmacenNoDisponible as PushNoDisponible };

/** Los teléfonos de la persona; `{ ok: false }` si no se pudieron leer. Nunca lanza. */
export async function dispositivosDe(correo: string): Promise<{ ok: true; dispositivos: Dispositivo[] } | { ok: false }> {
  const r = await almacen.leer(correo);
  return r.ok ? { ok: true, dispositivos: r.valor.dispositivos } : { ok: false };
}

/**
 * Guarda (o refresca) el token de un teléfono. El mismo aparato con un token nuevo reemplaza al viejo;
 * pasando el tope se va el más viejo. Lanza AlmacenNoDisponible si lo guardado no se pudo leer.
 */
export async function registrarToken(
  correo: string,
  d: { token: string; aparato?: string; plataforma?: string; app?: string },
  ahora = Date.now()
): Promise<{ dispositivos: number; durable: boolean }> {
  const token = tokenValido(d.token);
  if (!token) throw new Error('Ese token de avisos no tiene forma de token.');
  const aparato = RE_APARATO.test(String(d.aparato || '')) ? String(d.aparato) : '';
  const plataforma: Plataforma = d.plataforma === 'ios' || d.plataforma === 'web' ? d.plataforma : 'android';
  const app = /^[a-z0-9-]{1,20}$/.test(String(d.app || '')) ? String(d.app) : 'aura';
  const { resultado, durable } = await almacen.modificar(correo, (c) => {
    c.dispositivos = c.dispositivos.filter((x) => x.token !== token && !(aparato && x.aparato === aparato && x.app === app));
    c.dispositivos.unshift({ token, aparato, plataforma, app, fecha: ahora });
    c.dispositivos = c.dispositivos.slice(0, MAX_DISPOSITIVOS);
    return c.dispositivos.length;
  });
  return { dispositivos: resultado, durable };
}

/** Quita un teléfono por token o por aparato (al salir de la sesión). Lanza AlmacenNoDisponible si no se pudo leer. */
export async function quitarToken(correo: string, d: { token?: string; aparato?: string }): Promise<{ quitados: number; durable: boolean }> {
  const token = tokenValido(d.token);
  const aparato = RE_APARATO.test(String(d.aparato || '')) ? String(d.aparato) : '';
  if (!token && !aparato) return { quitados: 0, durable: true };
  const { resultado, durable } = await almacen.modificar(correo, (c) => {
    const antes = c.dispositivos.length;
    c.dispositivos = c.dispositivos.filter((x) => !((token && x.token === token) || (aparato && x.aparato === aparato)));
    return antes - c.dispositivos.length;
  });
  return { quitados: resultado, durable };
}

/* ------------------------------------------------------------------ el aviso */

/** El seudónimo de una cuenta, idéntico al del teléfono (mobile/src/lib/cuenta.ts `seudonimoDe`). */
export function seudonimoDe(correo: string): string {
  const n = String(correo || '').trim().toLowerCase();
  if (!n) return '';
  return `u${crypto.createHash('sha256').update(`aura-dueno:${n}`, 'utf8').digest('hex').slice(0, 16)}`;
}

function nuevoId(): string {
  return `p${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
}

/**
 * Los datos tal como viajan: SOLO texto (FCM rechaza otra cosa en `data`), sin claves reservadas, cada
 * valor acotado, con `aura`, `tipo`, `id`, `para` y `enviado`.
 */
export function datosParaFcm(correo: string, datos: DatosPush, ahora = Date.now()): Record<string, string> {
  if (!TIPOS_PUSH.includes(datos?.tipo)) throw new Error(`Tipo de aviso desconocido: ${String(datos?.tipo).slice(0, 20)}`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(datos)) {
    if (v === undefined || v === null) continue;
    // Reservadas por FCM (`from`, `notification`, `message_type`, `google.*`, `gcm.*`, `collapse_key`).
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k) || /^(from|notification|message_type|collapse_key)$/i.test(k) || /^(google|gcm)/i.test(k)) continue;
    const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
    out[k] = s.replace(/\s+/g, ' ').trim().slice(0, MAX_VALOR);
  }
  out.aura = 'push';
  out.tipo = datos.tipo;
  out.id = /^[A-Za-z0-9_.:-]{1,80}$/.test(String(datos.id || '')) ? String(datos.id) : nuevoId();
  out.para = seudonimoDe(correo);
  out.enviado = String(ahora);
  return out;
}

type Envio = { ok: boolean; muerto?: boolean; reintentar401?: boolean; detalle?: string };

async function mandarUno(proyecto: string, accessToken: string, token: string, data: Record<string, string>, ttlS: number): Promise<Envio> {
  let r: Response;
  try {
    r = await conTope(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(proyecto)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: `${ttlS}s` } } }),
    });
  } catch (e: any) {
    return { ok: false, muerto: false, reintentar401: false, detalle: `sin red (${String(e?.name || 'error')})` };
  }
  if (r.ok) return { ok: true };
  const j = (await r.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: any[] } };
  const err = j.error || {};
  const codigos = (err.details || []).map((d) => String(d?.errorCode || '')).filter(Boolean);
  const campos = (err.details || []).flatMap((d) => (Array.isArray(d?.fieldViolations) ? d.fieldViolations.map((f: any) => String(f?.field || '')) : []));
  const estado = String(err.status || '');
  const muerto =
    codigos.includes('UNREGISTERED') ||
    estado === 'NOT_FOUND' ||
    codigos.includes('SENDER_ID_MISMATCH') ||
    // INVALID_ARGUMENT también lo da un cuerpo mal hecho: solo se borra el token si FCM señala al token.
    ((estado === 'INVALID_ARGUMENT' || codigos.includes('INVALID_ARGUMENT')) && (campos.some((f) => /token/i.test(f)) || /registration token|token/i.test(String(err.message || ''))));
  return { ok: false, muerto, reintentar401: r.status === 401, detalle: `HTTP ${r.status} ${codigos[0] || estado}`.trim() };
}

/**
 * Manda un aviso (solo datos) a todos los teléfonos de la persona. Nunca lanza: lo que pase se cuenta.
 * `app` filtra por app ('aura' por omisión).
 */
export async function enviarPush(correo: string, datos: DatosPush, o: { ttlS?: number; app?: string; ahora?: () => number } = {}): Promise<ResultadoPush> {
  const ahora = o.ahora || Date.now;
  const c = cuentaServicio();
  if (!c) return { enviados: 0, fallidos: 0, quitados: 0, configurado: false, detalle: 'sin FIREBASE_SERVICE_ACCOUNT' };
  let data: Record<string, string>;
  try {
    data = datosParaFcm(correo, datos, ahora());
  } catch (e: any) {
    return { enviados: 0, fallidos: 0, quitados: 0, configurado: true, detalle: String(e?.message || e).slice(0, 120) };
  }
  const leidos = await dispositivosDe(correo);
  if (!leidos.ok) return { enviados: 0, fallidos: 0, quitados: 0, configurado: true, detalle: 'no pude leer sus teléfonos' };
  const app = o.app || 'aura';
  const destinos = leidos.dispositivos.filter((d) => d.app === app);
  if (!destinos.length) return { enviados: 0, fallidos: 0, quitados: 0, configurado: true, detalle: 'sin teléfonos registrados' };
  const ttl = Math.max(0, Math.min(28 * 86400, Math.round(o.ttlS ?? (datos.tipo === 'llamada' ? TTL_LLAMADA_S : TTL_NORMAL_S))));
  let token: string;
  try {
    token = await tokenDeAcceso(ahora);
  } catch (e: any) {
    console.warn('[push] sin token de acceso', String(e?.message || e).slice(0, 120));
    return { enviados: 0, fallidos: destinos.length, quitados: 0, configurado: true, detalle: 'sin token de acceso de FCM' };
  }
  let enviados = 0;
  let fallidos = 0;
  const muertos: string[] = [];
  const detalles = new Set<string>();
  await Promise.all(
    destinos.map(async (d) => {
      let r = await mandarUno(c.project_id, token, d.token, data, ttl);
      if (!r.ok && r.reintentar401) {
        // El token de acceso venció antes de lo dicho (o lo revocaron): uno nuevo y una vez más.
        acceso = null;
        try {
          r = await mandarUno(c.project_id, await tokenDeAcceso(ahora), d.token, data, ttl);
        } catch {
          /* se cuenta como fallido */
        }
      }
      if (r.ok) enviados++;
      else {
        fallidos++;
        detalles.add(r.detalle || 'error');
        if (r.muerto) muertos.push(d.token);
      }
    })
  );
  let quitados = 0;
  if (muertos.length) {
    try {
      quitados = (
        await almacen.modificar(correo, (cj) => {
          const antes = cj.dispositivos.length;
          cj.dispositivos = cj.dispositivos.filter((x) => !muertos.includes(x.token));
          return antes - cj.dispositivos.length;
        })
      ).resultado;
    } catch {
      /* S3 caído: se borran en el próximo aviso */
    }
  }
  if (fallidos) console.warn(`[push] ${datos.tipo}: ${enviados} enviados, ${fallidos} fallidos (${[...detalles].join('; ').slice(0, 120)})${quitados ? `, ${quitados} token(s) muerto(s) quitados` : ''}`);
  return { enviados, fallidos, quitados, configurado: true, ...(detalles.size ? { detalle: [...detalles].join('; ').slice(0, 200) } : {}) };
}

/* ------------------------------------------------------------------ atajos */

/** AURA lo llama: aviso de llamada entrante a pantalla completa; al contestar, AURA abre con `motivo`. */
export function llamarConAura(correo: string, motivo: string, id?: string): Promise<ResultadoPush> {
  return enviarPush(correo, { tipo: 'llamada', de: 'AURA', motivo: String(motivo || '').slice(0, 300), ...(id ? { id } : {}) }, { ttlS: TTL_LLAMADA_S });
}

/** Un mensaje de AURA: al tocarlo se abre la mesa y AURA lo lee. `abrir`: 'mesa' | 'chats' | 'computadora' | 'correos'. */
export function avisarConAura(correo: string, titulo: string, texto: string, o: { id?: string; abrir?: string } = {}): Promise<ResultadoPush> {
  return enviarPush(correo, { tipo: 'mensaje', titulo: titulo || 'AURA', texto, ...(o.id ? { id: o.id } : {}), ...(o.abrir ? { abrir: o.abrir } : {}) });
}

/** Una propuesta de la iniciativa (lib/iniciativa.ts) con «Sí» / «Luego». */
export function proponerPorPush(correo: string, p: { id: string; texto: string; pedido?: string }): Promise<ResultadoPush> {
  return enviarPush(correo, { tipo: 'propuesta', id: p.id, texto: p.texto, pedido: p.pedido || '' });
}

/** Un recordatorio que sale del servidor. */
export function recordarPorPush(correo: string, texto: string, id?: string): Promise<ResultadoPush> {
  return enviarPush(correo, { tipo: 'recordatorio', texto, ...(id ? { id } : {}) });
}

/** Lo que terminó su computadora (server/computadora.ts): al tocarlo se abre la vista en vivo de esa tarea. */
export function avisarComputadoraPorPush(correo: string, tareaId: string, texto: string): Promise<ResultadoPush> {
  return enviarPush(correo, { tipo: 'computadora', id: tareaId, texto });
}

/*
 * Las mismas, con un objeto (como las llama el resto del servidor: iniciativa, círculo, computadora).
 * Cada una devuelve { enviados, fallidos, quitados, configurado, detalle? } y nunca lanza.
 */
export function llamarPorPush(correo: string, o: { motivo: string; id?: string }): Promise<ResultadoPush> {
  return llamarConAura(correo, o.motivo, o.id);
}
export function avisarPush(correo: string, o: { titulo?: string; texto: string; id?: string; abrir?: string }): Promise<ResultadoPush> {
  return avisarConAura(correo, o.titulo || 'AURA', o.texto, { id: o.id, abrir: o.abrir });
}

/** Solo pruebas: olvida la caché de la cuenta, del token de acceso y de los teléfonos. */
export function _olvidarPush() {
  cuentaLeida = null;
  acceso = null;
  pidiendoAcceso = null;
  almacen._olvidar();
}
