/**
 * AVISOS A LA AU-RA INSTALADA DESDE LA WEB (Web Push: el icono de AU-RA en un iPhone, iOS 16.4+, o en
 * cualquier navegador). Auditoría del 3-oct, IOS02: el teléfono Android tiene Firebase (lib/push.ts); el
 * iPhone, que entra por la web instalada, no tenía ningún canal con la app cerrada.
 *
 * Sin dependencias nuevas, como lib/push.ts: todo con node:crypto.
 *  · VAPID (RFC 8292): un JWT ES256 por servicio de avisos (aud = el origen del endpoint), firmado con el
 *    par P-256 de WEB_PUSH_VAPID_PUBLICA / WEB_PUSH_VAPID_PRIVADA (base64url; `npm run vapid` los crea).
 *  · El contenido va CIFRADO para ese navegador (RFC 8291, aes128gcm): ni Apple ni Google lo leen. Aun así
 *    viaja lo mínimo: el título y una línea, como en el teléfono.
 *  · Suscripciones por el correo de la SESIÓN (mismo cajón seguro que los teléfonos: caché, disco y S3; si
 *    S3 no se pudo leer no se escribe encima), hasta MAX_SUSCRIPCIONES. Solo endpoints de los servicios de
 *    avisos conocidos (Apple, Google, Mozilla, Microsoft): nunca se le hace POST a una dirección cualquiera.
 *  · 404/410 = esa suscripción murió (la persona quitó el permiso o borró el icono): se borra sola. Un fallo
 *    pasajero no borra nada.
 *  · Cada aviso lleva `para` (el seudónimo de la cuenta): en un navegador compartido, si ya entró otra
 *    persona, el service worker no lo enseña.
 */
import crypto from 'node:crypto';
import { clave } from './boveda';
import { AlmacenNoDisponible, cajonPorCorreo } from './misiones';
import { claveDe, huellaDueno, leerDurable, modificarDurable } from './durable';

/*
 * DE QUIÉN ES CADA APARATO AHORA (AUR13; lo usan este archivo y lib/push.ts). Marca: un hash del token o del endpoint
 * → un hash del dueño, en lib/durable.ts (ni el token ni el correo en claro). Ver lib/push.ts.
 */
export async function marcarDuenoAparato(claveIndice: string, correo: string): Promise<void> {
  await modificarDurable(claveIndice, () => ({ dueno: huellaDueno(correo), t: Date.now() })).catch((e) => console.warn('[push] no pude marcar de quién es el aparato:', String(e?.message || e).slice(0, 80)));
}

/** ¿Este aparato está marcado como de OTRA persona? false si es suyo, no tiene marca o no se pudo leer. */
export async function aparatoDeOtro(claveIndice: string, correo: string): Promise<boolean> {
  try {
    const l = await leerDurable<{ dueno?: string }>(claveIndice);
    return !!(l.ok && l.valor?.dueno && l.valor.dueno !== huellaDueno(correo));
  } catch {
    return false;
  }
}

const claveDuenoEndpoint = (endpoint: string) => claveDe('push/dueno-web', 'aura-push', crypto.createHash('sha256').update(`endpoint:${endpoint}`).digest('hex').slice(0, 40));

export const MAX_SUSCRIPCIONES = 5;
/** El contenido cifrado entra en un solo registro de 4096 (RFC 8291 §4): se acota antes. */
export const MAX_CONTENIDO = 3000;
const RS = 4096;
const ENDPOINT_PERMITIDO = /^(?:[a-z0-9-]+\.)*push\.apple\.com$|^fcm\.googleapis\.com$|^updates\.push\.services\.mozilla\.com$|^(?:[a-z0-9-]+\.)*notify\.windows\.com$/i;

export type SuscripcionWeb = { endpoint: string; p256dh: string; auth: string; aparato: string; fecha: number };
type CajonWeb = { version: 1; suscripciones: SuscripcionWeb[] };

const b64url = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const deB64url = (s: string) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* ------------------------------------------------------------------ las suscripciones */

/** ¿Es un endpoint de un servicio de avisos de verdad? https y host de la lista. */
export function endpointValido(x: unknown): string | null {
  try {
    const u = new URL(String(x || ''));
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !ENDPOINT_PERMITIDO.test(u.hostname)) return null;
    return u.toString().length <= 1000 ? u.toString() : null;
  } catch {
    return null;
  }
}

/** La suscripción del navegador (PushSubscription.toJSON()), validada; null si algo no cuadra. */
export function suscripcionValida(x: any, aparato = '', ahora = Date.now()): SuscripcionWeb | null {
  const endpoint = endpointValido(x?.endpoint);
  const p256dh = String(x?.keys?.p256dh ?? x?.p256dh ?? '');
  const auth = String(x?.keys?.auth ?? x?.auth ?? '');
  if (!endpoint || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return null;
  const pub = deB64url(p256dh);
  if (pub.length !== 65 || pub[0] !== 0x04 || deB64url(auth).length !== 16) return null;
  return { endpoint, p256dh, auth, aparato: /^[A-Za-z0-9_-]{1,64}$/.test(aparato) ? aparato : '', fecha: ahora };
}

function sanear(x: unknown): CajonWeb {
  const lista = Array.isArray((x as CajonWeb | null)?.suscripciones) ? (x as CajonWeb).suscripciones : [];
  const vistos = new Set<string>();
  const out: SuscripcionWeb[] = [];
  for (const s of lista) {
    const v = suscripcionValida(s, s?.aparato, Number(s?.fecha) || 0);
    if (!v || vistos.has(v.endpoint)) continue;
    vistos.add(v.endpoint);
    out.push(v);
  }
  out.sort((a, b) => b.fecha - a.fecha);
  return { version: 1, suscripciones: out.slice(0, MAX_SUSCRIPCIONES) };
}

const almacen = cajonPorCorreo<CajonWeb>({
  nombre: 'push-web',
  s3: 'ultron/push-web',
  dirEnv: 'ULTRON_PUSH_WEB_DIR',
  dirDef: 'push-web',
  sanear,
  vacio: () => ({ version: 1, suscripciones: [] }),
  que: 'tus avisos en la web',
});

export { AlmacenNoDisponible as PushWebNoDisponible };

/** El par VAPID de este servidor, o null si falta o no es un par P-256 válido. */
export function vapid(): { publica: string; privada: crypto.KeyObject; contacto: string } | null {
  const publica = clave('webpush_publica');
  const priv = clave('webpush_privada');
  if (!publica || !priv) return null;
  const pub = deB64url(publica);
  // La llave privada de P-256 son 32 bytes; algunas herramientas (y ECDH de Node) quitan los ceros de la izquierda
  // (≈1 de cada 256 pares): se completan, en vez de dar por roto un par válido y quedarse sin avisos web en silencio.
  const crudo = deB64url(priv);
  const d = crudo.length > 0 && crudo.length < 32 ? Buffer.concat([Buffer.alloc(32 - crudo.length), crudo]) : crudo;
  if (pub.length !== 65 || pub[0] !== 0x04 || d.length !== 32) return null;
  try {
    const privada = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64url(d), x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) }, format: 'jwk' });
    const contacto = clave('webpush_contacto') || 'mailto:soporte@ordenglobal.org';
    return { publica, privada, contacto: /^(mailto:|https:)/.test(contacto) ? contacto : `mailto:${contacto}` };
  } catch {
    return null;
  }
}

export const pushWebConfigurado = () => !!vapid();

/** Un par nuevo (para WEB_PUSH_VAPID_PUBLICA / WEB_PUSH_VAPID_PRIVADA). */
export function crearParVapid(): { publica: string; privada: string } {
  const e = crypto.createECDH('prime256v1');
  e.generateKeys();
  // getPrivateKey() quita los ceros de la izquierda (≈1 de cada 256): siempre 32 bytes.
  const d = e.getPrivateKey();
  return { publica: b64url(e.getPublicKey()), privada: b64url(Buffer.concat([Buffer.alloc(Math.max(0, 32 - d.length)), d])) };
}

export async function suscripcionesDe(correo: string): Promise<{ ok: true; suscripciones: SuscripcionWeb[] } | { ok: false }> {
  const r = await almacen.leer(correo);
  return r.ok ? { ok: true, suscripciones: r.valor.suscripciones } : { ok: false };
}

/** Guarda (o refresca) la suscripción de un navegador. El mismo aparato reemplaza a la vieja. */
export async function suscribirWeb(correo: string, sus: unknown, aparato = '', ahora = Date.now()): Promise<{ suscripciones: number; durable: boolean }> {
  const v = suscripcionValida(sus, aparato, ahora);
  if (!v) throw new Error('Esa suscripción de avisos no es de un servicio conocido o le faltan las llaves.');
  const { resultado, durable } = await almacen.modificar(correo, (c) => {
    c.suscripciones = c.suscripciones.filter((x) => x.endpoint !== v.endpoint && !(v.aparato && x.aparato === v.aparato));
    c.suscripciones.unshift(v);
    c.suscripciones = c.suscripciones.slice(0, MAX_SUSCRIPCIONES);
    return c.suscripciones.length;
  });
  // Desde ahora este navegador es de quien se suscribió: la cuenta que lo tenía antes ya no le manda avisos (AUR13).
  await marcarDuenoAparato(claveDuenoEndpoint(v.endpoint), correo);
  return { suscripciones: resultado, durable };
}

/** Solo pruebas: mete una suscripción en la caja de alguien SIN marcar de quién es (como una vieja que no se pudo quitar). */
export async function _meterSinDueno(correo: string, sus: unknown, aparato = ''): Promise<void> {
  const v = suscripcionValida(sus, aparato);
  if (!v) throw new Error('suscripción');
  await almacen.modificar(correo, (c) => {
    c.suscripciones = [v, ...c.suscripciones.filter((x) => x.endpoint !== v.endpoint)].slice(0, MAX_SUSCRIPCIONES);
  });
}

/** Quita la suscripción de este navegador (por endpoint o por aparato). */
export async function desuscribirWeb(correo: string, o: { endpoint?: string; aparato?: string }): Promise<{ quitados: number; durable: boolean }> {
  const endpoint = endpointValido(o.endpoint);
  const aparato = /^[A-Za-z0-9_-]{1,64}$/.test(String(o.aparato || '')) ? String(o.aparato) : '';
  if (!endpoint && !aparato) return { quitados: 0, durable: true };
  const { resultado, durable } = await almacen.modificar(correo, (c) => {
    const antes = c.suscripciones.length;
    c.suscripciones = c.suscripciones.filter((x) => !((endpoint && x.endpoint === endpoint) || (aparato && x.aparato === aparato)));
    return antes - c.suscripciones.length;
  });
  return { quitados: resultado, durable };
}

/* ------------------------------------------------------------------ cifrar y firmar */

const hmac = (k: Buffer, d: Buffer) => crypto.createHmac('sha256', k).update(d).digest();

/**
 * El cuerpo aes128gcm de RFC 8291 para la suscripción `p256dh`/`auth`: salt(16) · rs(4) · idlen(1) ·
 * llave pública efímera(65) · registro cifrado. `efimera` y `salt` solo los pasan las pruebas.
 */
export function cifrar(contenido: Buffer, p256dh: string, auth: string, o: { efimera?: crypto.ECDH; salt?: Buffer } = {}): Buffer {
  if (contenido.length > MAX_CONTENIDO) throw new Error('El aviso es demasiado largo.');
  const uaPublica = deB64url(p256dh);
  const secretoAuth = deB64url(auth);
  const as = o.efimera || crypto.createECDH('prime256v1');
  if (!o.efimera) as.generateKeys();
  const asPublica = as.getPublicKey();
  const ecdh = as.computeSecret(uaPublica);
  // IKM = HKDF(auth, ecdh, "WebPush: info" 0x00 ua_public as_public, 32)
  const prkClave = hmac(secretoAuth, ecdh);
  const ikm = hmac(prkClave, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica, Buffer.from([1])]));
  const salt = o.salt || crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // Un solo registro: el contenido y el delimitador 0x02 (último registro), sin relleno.
  const cifrado = Buffer.concat([c.update(Buffer.concat([contenido, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const cabecera = Buffer.alloc(21);
  salt.copy(cabecera, 0);
  cabecera.writeUInt32BE(RS, 16);
  cabecera[20] = asPublica.length;
  return Buffer.concat([cabecera, asPublica, cifrado]);
}

/** El JWT de VAPID (ES256) para el servicio de avisos de `endpoint`; vence en 12 h. */
export function jwtVapid(endpoint: string, v: { privada: crypto.KeyObject; contacto: string }, ahoraMs = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const cab = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = b64url(Buffer.from(JSON.stringify({ aud, exp: Math.floor(ahoraMs / 1000) + 12 * 3600, sub: v.contacto })));
  const firma = crypto.sign('sha256', Buffer.from(`${cab}.${cuerpo}`), { key: v.privada, dsaEncoding: 'ieee-p1363' });
  return `${cab}.${cuerpo}.${b64url(firma)}`;
}

/* ------------------------------------------------------------------ el aviso */

export type AvisoWeb = { tipo: string; titulo: string; texto: string; id?: string; abrir?: string; para: string; enviado: number };
/**
 * AUR13: un 201 del servicio de avisos es ACEPTADO (lo guarda para el aparato), no «entregado»: el servicio no avisa
 * si el navegador lo mostró. `aceptados` = `enviados` (el nombre de siempre); `entrega` nunca es «entregado».
 */
export type ResultadoWeb = { enviados: number; aceptados: number; entrega: 'aceptado' | 'fallido' | 'sin-destino' | 'sin-configurar'; fallidos: number; quitados: number; configurado: boolean; detalle?: string };

function conEntregaWeb(r: Omit<ResultadoWeb, 'aceptados' | 'entrega'>): ResultadoWeb {
  return { ...r, aceptados: r.enviados, entrega: !r.configurado ? 'sin-configurar' : r.enviados > 0 ? 'aceptado' : r.fallidos > 0 ? 'fallido' : 'sin-destino' };
}

async function conTope(url: string, init: RequestInit, ms = 10_000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal, redirect: 'manual' });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Manda el aviso a todos los navegadores suscritos de la persona. Nunca lanza: lo que pase se cuenta.
 * `ttlS`: cuánto lo guarda el servicio si el aparato está apagado. `urgente`: llamada (Urgency: high).
 */
export async function enviarPushWeb(correo: string, aviso: AvisoWeb, o: { ttlS: number; urgente?: boolean; ahora?: () => number }): Promise<ResultadoWeb> {
  return conEntregaWeb(await enviarPushWebCuenta(correo, aviso, o));
}

async function enviarPushWebCuenta(correo: string, aviso: AvisoWeb, o: { ttlS: number; urgente?: boolean; ahora?: () => number }): Promise<Omit<ResultadoWeb, 'aceptados' | 'entrega'>> {
  const v = vapid();
  if (!v) return { enviados: 0, fallidos: 0, quitados: 0, configurado: false, detalle: 'sin VAPID' };
  const todas = await suscripcionesDe(correo);
  if (!todas.ok) return { enviados: 0, fallidos: 0, quitados: 0, configurado: true, detalle: 'no pude leer sus navegadores' };
  // AUR13: un navegador que ahora es de otra cuenta no recibe lo de esta (y se poda de aquí, con las muertas).
  const ajenos: string[] = [];
  await Promise.all(todas.suscripciones.map(async (s) => (await aparatoDeOtro(claveDuenoEndpoint(s.endpoint), correo)) && ajenos.push(s.endpoint)));
  const leidas = { suscripciones: todas.suscripciones.filter((s) => !ajenos.includes(s.endpoint)) };
  if (!leidas.suscripciones.length) {
    const quitados = ajenos.length ? await podar(correo, ajenos) : 0;
    return { enviados: 0, fallidos: 0, quitados, configurado: true, detalle: ajenos.length ? 'sus navegadores ahora son de otra cuenta' : 'sin navegadores suscritos' };
  }
  const contenido = Buffer.from(
    JSON.stringify({
      ...aviso,
      titulo: String(aviso.titulo || 'AURA').slice(0, 80),
      texto: String(aviso.texto || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    })
  );
  let enviados = 0;
  let fallidos = 0;
  const muertos: string[] = [];
  const detalles = new Set<string>();
  await Promise.all(
    leidas.suscripciones.map(async (s) => {
      try {
        const r = await conTope(s.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `vapid t=${jwtVapid(s.endpoint, v, (o.ahora || Date.now)())}, k=${v.publica}`,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(Math.max(0, Math.min(28 * 86400, Math.round(o.ttlS)))),
            Urgency: o.urgente ? 'high' : 'normal',
          },
          body: new Uint8Array(cifrar(contenido, s.p256dh, s.auth)),
        });
        if (r.status >= 200 && r.status < 300) enviados++;
        else {
          fallidos++;
          detalles.add(`HTTP ${r.status}`);
          if (r.status === 404 || r.status === 410) muertos.push(s.endpoint);
        }
      } catch (e: any) {
        fallidos++;
        detalles.add(`sin red (${String(e?.name || 'error')})`);
      }
    })
  );
  const quitados = muertos.length || ajenos.length ? await podar(correo, [...muertos, ...ajenos]) : 0;
  if (fallidos) console.warn(`[push-web] ${aviso.tipo}: ${enviados} enviados, ${fallidos} fallidos (${[...detalles].join('; ').slice(0, 120)})${quitados ? `, ${quitados} suscripción(es) muerta(s) quitada(s)` : ''}`);
  return { enviados, fallidos, quitados, configurado: true, ...(detalles.size ? { detalle: [...detalles].join('; ').slice(0, 200) } : {}) };
}

/** Quita esas suscripciones de la caja de la persona (muertas o de otra cuenta). S3 caído: en el próximo aviso. */
async function podar(correo: string, endpoints: string[]): Promise<number> {
  try {
    return (
      await almacen.modificar(correo, (c) => {
        const antes = c.suscripciones.length;
        c.suscripciones = c.suscripciones.filter((x) => !endpoints.includes(x.endpoint));
        return antes - c.suscripciones.length;
      })
    ).resultado;
  } catch {
    return 0;
  }
}

/** Solo pruebas. */
export function _olvidarPushWeb() {
  almacen._olvidar();
}
