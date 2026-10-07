/**
 * LAS CARAS Y LAS VOCES, CIFRADAS EN REPOSO (auditoría A-7).
 *
 * Los cajones de caras (lib/caras-miembro.ts) y de voces (lib/voces-miembro.ts) iban a S3 y al disco como JSON en claro:
 * vectores de la cara y de la voz de la dueña y de su círculo, una menor incluida. Ahora cada cajón se guarda en un SOBRE:
 *
 *  · una llave de datos al azar por cada escritura (AES-256-GCM) cifra el cajón entero (nombres, parentescos, vectores,
 *    constancia del permiso, lápidas);
 *  · esa llave va envuelta (AES-256-GCM) con la llave maestra, que se DERIVA (HKDF-SHA256) de un secreto que el servidor
 *    ya tiene: BIOMETRIA_CLAVE_CIFRADO, o CORREO_CLAVE_CIFRADO, o ULTRON_SESION_SECRETO (lib/boveda.ts `biometria_cifrado`).
 *    Sin KMS ni ningún recurso nuevo de AWS;
 *  · la cabecera dice la versión (`v`), el algoritmo y el `kid` (8 bytes derivados del secreto, que no revelan nada de él);
 *    va autenticada (AAD) junto con el tipo y la huella de la cuenta: un sobre copiado a la cuenta de otra persona, o de
 *    caras a voces, no abre. Un byte cambiado tampoco (SobreIlegible);
 *  · por fuera, en claro y también autenticado, va lo DURABLE (lib/biometria-durable.ts: `rev`, las lápidas, `borradoTodo`,
 *    la marca de agua; solo ids y horas) con `personas: []`. Es para el despliegue sin cortes: una instancia con el código
 *    de antes que lea un sobre ve «nadie» con la versión y las lápidas de verdad, así que ninguna copia vieja suya le gana
 *    ni resucita a quien se olvidó (sin esto vería versión 0 y su disco viejo volvería a S3).
 *
 * Migración: lo viejo en claro se sigue leyendo (`abrirBiometria` lo deja pasar); el próximo guardado ya va en sobre; y al
 * arrancar `migrarAlSobre` recorre S3 (si el permiso de listar alcanza) y el disco y re-sella lo que siga en claro o con una
 * llave anterior. Es idempotente (lo ya sellado con la llave activa se salta) y segura con dos arranques a la vez: en S3
 * escribe con la condición del ETag leído (If-Match), así que nunca pisa un cambio de otra instancia (412 → se vuelve a leer).
 *
 * Rotar la llave: el secreto viejo va a BIOMETRIA_CLAVES_ANTERIORES (separados por coma) hasta que la migración del
 * arranque re-selle todo con la nueva. Los secretos de la cadena (los tres de arriba) se prueban siempre al abrir, por su
 * `kid`: fijar más tarde BIOMETRIA_CLAVE_CIFRADO no deja ilegible lo sellado con el de la sesión.
 *
 * Sin ningún secreto (desarrollo, pruebas) se guarda en claro, como antes, con un aviso una vez. Con
 * BIOMETRIA_SOLO_CIFRADO=1 (cuando la migración ya terminó) lo que llegue en claro NO se acepta.
 *
 * Nunca se escribe al log nada del cajón: ni vectores, ni nombres; solo el tipo, el kid y por qué no abrió.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { clave } from './boveda';
import { sanearDurable } from './biometria-durable';

export type TipoBiometria = 'caras' | 'voces';
export const MARCA_SOBRE = 'aura-bio';
export const VERSION_SOBRE = 1;
const ALG = 'A256GCM';

export type SobreBiometria = {
  sobre: typeof MARCA_SOBRE;
  v: typeof VERSION_SOBRE;
  alg: typeof ALG;
  kid: string;
  tipo: TipoBiometria;
  /** La llave de datos de este sobre, envuelta con la maestra: `iv.tag.cifrado` en base64url. */
  llave: string;
  iv: string;
  tag: string;
  datos: string;
  /** Para el código de antes (despliegue sin cortes): nadie, con la versión y las lápidas de verdad. Autenticado (AAD). */
  version: 1;
  personas: [];
} & ReturnType<typeof sanearDurable>;

/** El sobre no abre: llave desconocida o equivocada, alterado, de otra cuenta o de otro tipo. Nunca lleva el contenido. */
export class SobreIlegible extends Error {}

type Llave = { kid: string; kek: Buffer };
const SAL = 'aura-biometria/v1';
const derivadas = new Map<string, Llave>();

function derivar(secreto: string): Llave {
  const hit = derivadas.get(secreto);
  if (hit) return hit;
  const kek = Buffer.from(crypto.hkdfSync('sha256', secreto, SAL, 'kek', 32));
  const kid = Buffer.from(crypto.hkdfSync('sha256', secreto, SAL, 'kid', 8)).toString('hex');
  const l = { kid, kek };
  derivadas.set(secreto, l);
  return l;
}

/** La llave con que se sella ahora (null: sin secreto, se guarda en claro). */
function llaveActiva(): Llave | null {
  const s = clave('biometria_cifrado');
  return s ? derivar(s) : null;
}

/** Todas las llaves con que se puede abrir: la activa, las de la cadena y las anteriores declaradas. */
function llavesParaAbrir(): Map<string, Buffer> {
  const secretos = [clave('biometria_cifrado'), ...['BIOMETRIA_CLAVE_CIFRADO', 'CORREO_CLAVE_CIFRADO', 'ULTRON_SESION_SECRETO'].map((k) => String(process.env[k] || '').trim())];
  for (const s of String(process.env.BIOMETRIA_CLAVES_ANTERIORES || '').split(',')) secretos.push(s.trim());
  const m = new Map<string, Buffer>();
  for (const s of secretos) if (s) {
    const l = derivar(s);
    if (!m.has(l.kid)) m.set(l.kid, l.kek);
  }
  return m;
}

/** ¿Hay llave para sellar? */
export function hayLlaveBiometria(): boolean {
  return !!llaveActiva();
}
/** El kid de la llave activa (para el log y las pruebas; no revela el secreto). */
export function kidActivo(): string | null {
  return llaveActiva()?.kid ?? null;
}

export function esSobre(x: unknown): x is SobreBiometria {
  return !!x && typeof x === 'object' && (x as { sobre?: unknown }).sobre === MARCA_SOBRE;
}

const b64 = (b: Buffer) => b.toString('base64url');
const deB64 = (s: unknown) => Buffer.from(String(s || ''), 'base64url');
/** La cabecera, la cuenta y lo durable en claro: lo que el cifrado autentica sin cifrar. */
const aad = (kid: string, tipo: TipoBiometria, huella: string, durable: ReturnType<typeof sanearDurable>) =>
  Buffer.from(`${MARCA_SOBRE}|${VERSION_SOBRE}|${ALG}|${kid}|${tipo}|${huella}|${JSON.stringify(durable)}`, 'utf8');

export type Contexto = { tipo: TipoBiometria; huella: string };

let avisadoSinLlave = false;

/**
 * El cajón listo para guardar: en sobre con la llave activa. Sin llave, el mismo dato en claro (con un aviso, una vez).
 */
export function sellarBiometria(dato: unknown, ctx: Contexto): unknown {
  const l = llaveActiva();
  if (!l) {
    if (!avisadoSinLlave) {
      avisadoSinLlave = true;
      console.warn('[biometría] sin BIOMETRIA_CLAVE_CIFRADO / CORREO_CLAVE_CIFRADO / ULTRON_SESION_SECRETO: caras y voces quedan en claro');
    }
    return dato;
  }
  // Lo durable por fuera (saneado: idempotente, así quien abre lo vuelve a armar igual para el AAD).
  const durable = sanearDurable(dato);
  const a = aad(l.kid, ctx.tipo, ctx.huella, durable);
  const dek = crypto.randomBytes(32);
  const ivL = crypto.randomBytes(12);
  const env = crypto.createCipheriv('aes-256-gcm', l.kek, ivL);
  env.setAAD(a);
  const dekCifrada = Buffer.concat([env.update(dek), env.final()]);
  const llave = [b64(ivL), b64(env.getAuthTag()), b64(dekCifrada)].join('.');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dek, iv);
  c.setAAD(a);
  const datos = Buffer.concat([c.update(Buffer.from(JSON.stringify(dato), 'utf8')), c.final()]);
  dek.fill(0);
  return { sobre: MARCA_SOBRE, v: VERSION_SOBRE, alg: ALG, kid: l.kid, tipo: ctx.tipo, llave, iv: b64(iv), tag: b64(c.getAuthTag()), datos: b64(datos), version: 1, personas: [], ...durable } satisfies SobreBiometria;
}

/**
 * Lo guardado, abierto. Lo viejo en claro pasa tal cual (`enClaro: true`), salvo con BIOMETRIA_SOLO_CIFRADO=1. Un sobre que
 * no abre lanza SobreIlegible: quien lee NO debe tomarlo por «vacío» ni escribir encima (falla cerrado).
 */
export function abrirBiometria(x: unknown, ctx: Contexto): { dato: unknown; enClaro: boolean; kid?: string } {
  if (!esSobre(x)) {
    if (x != null && process.env.BIOMETRIA_SOLO_CIFRADO === '1') throw new SobreIlegible(`${ctx.tipo}: llegó en claro y solo se acepta cifrado`);
    return { dato: x, enClaro: true };
  }
  if (x.v !== VERSION_SOBRE || x.alg !== ALG) throw new SobreIlegible(`${ctx.tipo}: sobre de versión desconocida`);
  if (x.tipo !== ctx.tipo) throw new SobreIlegible(`${ctx.tipo}: el sobre es de otro tipo`);
  const kek = llavesParaAbrir().get(String(x.kid || ''));
  if (!kek) throw new SobreIlegible(`${ctx.tipo}: no tengo la llave ${String(x.kid || '?').slice(0, 16)}`);
  const a = aad(x.kid, ctx.tipo, ctx.huella, sanearDurable(x));
  let dek: Buffer | null = null;
  try {
    const [ivL, tagL, dekC] = String(x.llave || '').split('.');
    const d1 = crypto.createDecipheriv('aes-256-gcm', kek, deB64(ivL));
    d1.setAAD(a);
    d1.setAuthTag(deB64(tagL));
    dek = Buffer.concat([d1.update(deB64(dekC)), d1.final()]);
    const d2 = crypto.createDecipheriv('aes-256-gcm', dek, deB64(x.iv));
    d2.setAAD(a);
    d2.setAuthTag(deB64(x.tag));
    const plano = Buffer.concat([d2.update(deB64(x.datos)), d2.final()]);
    return { dato: JSON.parse(plano.toString('utf8')), enClaro: false, kid: x.kid };
  } catch {
    // Sin el detalle de crypto ni nada del contenido.
    throw new SobreIlegible(`${ctx.tipo}: el sobre no abre (llave equivocada, alterado o de otra cuenta)`);
  } finally {
    dek?.fill(0);
  }
}

/** ¿Hay que (re)sellarlo? En claro, o sellado con una llave que ya no es la activa. Sin llave activa, nunca. */
export function pideSellar(x: unknown): boolean {
  const l = llaveActiva();
  if (!l || x == null) return false;
  return !esSobre(x) || x.kid !== l.kid;
}

/* ── migración ─────────────────────────────────────────────────────────────────────────────────────── */

type GetEtag = (key: string) => Promise<{ ok: boolean; json: any | null; etag: string | null; detalle: string; missing?: boolean }>;
type PutCond = (key: string, json: unknown, cond: { siNoExiste?: boolean; siCoincide?: string }) => Promise<{ ok: boolean; conflicto: boolean; detalle: string }>;
type Listar = (prefijo: string, o: { desde?: string | null }) => Promise<{ ok: true; claves: string[]; truncado: boolean } | { ok: false; detalle: string }>;

const RE_ARCHIVO = /^([0-9a-f]{40})\.json$/;

/**
 * Re-sella UN objeto de S3 si sigue en claro (o con llave vieja), con la condición del ETag leído. 412 → se vuelve a leer
 * (otra instancia lo cambió: lo nuevo ya viene sellado o se re-sella). Nunca escribe sin condición.
 */
export async function resellarS3(key: string, tipo: TipoBiometria, d: { getEtag: GetEtag; putCond: PutCond }): Promise<'sellado' | 'ya_sellado' | 'no_existe' | 'conflicto' | 'fallo'> {
  const m = RE_ARCHIVO.exec(key.split('/').pop() || '');
  if (!m) return 'fallo';
  const ctx = { tipo, huella: m[1] };
  for (let intento = 0; intento < 3; intento++) {
    const r = await d.getEtag(key).catch(() => ({ ok: false, json: null, etag: null, detalle: 'S3 no contestó', missing: false }));
    if (!r.ok) return 'fallo';
    if (r.missing || r.json == null) return 'no_existe';
    if (!pideSellar(r.json)) return 'ya_sellado';
    let dato: unknown;
    try {
      dato = abrirBiometria(r.json, ctx).dato;
    } catch {
      return 'fallo';
    }
    if (!r.etag) return 'fallo';
    const w = await d.putCond(key, sellarBiometria(dato, ctx), { siCoincide: r.etag }).catch(() => ({ ok: false, conflicto: false, detalle: 'S3 no guardó' }));
    if (w.ok) return 'sellado';
    if (!w.conflicto) return 'fallo';
  }
  return 'conflicto';
}

/**
 * Re-sella los archivos locales en claro de una carpeta. SÍNCRONO a propósito: corre al arrancar sin ceder el hilo, así
 * ningún guardado de esta instancia se mete entre la lectura y el rename. tmp + rename (atómico), modo 0600.
 */
export function resellarCarpeta(carpeta: string, tipo: TipoBiometria): { sellados: number; yaSellados: number; fallos: number } {
  const out = { sellados: 0, yaSellados: 0, fallos: 0 };
  let nombres: string[] = [];
  try {
    nombres = fs.readdirSync(carpeta);
  } catch {
    return out;
  }
  for (const n of nombres) {
    const m = RE_ARCHIVO.exec(n);
    if (!m) continue;
    const f = path.join(carpeta, n);
    try {
      const x = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!pideSellar(x)) {
        out.yaSellados++;
        continue;
      }
      const ctx = { tipo, huella: m[1] };
      const sellado = sellarBiometria(abrirBiometria(x, ctx).dato, ctx);
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(sellado), { mode: 0o600 });
      fs.renameSync(`${f}.tmp`, f);
      out.sellados++;
    } catch {
      out.fallos++;
    }
  }
  return out;
}

export type ResultadoMigracion = {
  tipo: TipoBiometria;
  s3: { estado: 'ok' | 'sin_s3' | 'sin_listado' | 'sin_llave'; sellados: number; yaSellados: number; conflictos: number; fallos: number; detalle?: string };
  disco: { sellados: number; yaSellados: number; fallos: number };
};

/**
 * La migración del arranque, para un tipo: el disco (síncrono) y S3 (listando el prefijo; si el permiso de listar no
 * alcanza, `sin_listado`: lo que siga en claro se re-sella al leerlo o al guardarlo). Idempotente; con dos arranques a la
 * vez, cada objeto lo sella uno solo (el otro recibe 412, relee, ya está sellado).
 */
export async function migrarAlSobre(d: {
  tipo: TipoBiometria;
  carpeta: string;
  prefijo: string;
  s3Listo: boolean;
  listar?: Listar;
  getEtag?: GetEtag;
  putCond?: PutCond;
}): Promise<ResultadoMigracion> {
  const s3: ResultadoMigracion['s3'] = { estado: 'ok', sellados: 0, yaSellados: 0, conflictos: 0, fallos: 0 };
  if (!hayLlaveBiometria()) return { tipo: d.tipo, s3: { ...s3, estado: 'sin_llave' }, disco: { sellados: 0, yaSellados: 0, fallos: 0 } };
  const disco = resellarCarpeta(d.carpeta, d.tipo);
  if (!d.s3Listo || !d.getEtag || !d.putCond) return { tipo: d.tipo, s3: { ...s3, estado: 'sin_s3' }, disco };
  if (!d.listar) return { tipo: d.tipo, s3: { ...s3, estado: 'sin_listado' }, disco };
  let desde: string | null = null;
  for (let pagina = 0; pagina < 100; pagina++) {
    const l = await d.listar(d.prefijo, { desde }).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (l.ok === false) return { tipo: d.tipo, s3: { ...s3, estado: 'sin_listado', detalle: String(l.detalle || '').slice(0, 120) }, disco };
    for (const k of l.claves) {
      if (!RE_ARCHIVO.test(k.split('/').pop() || '')) continue;
      const r = await resellarS3(k, d.tipo, { getEtag: d.getEtag, putCond: d.putCond });
      if (r === 'sellado') s3.sellados++;
      else if (r === 'ya_sellado' || r === 'no_existe') s3.yaSellados++;
      else if (r === 'conflicto') s3.conflictos++;
      else s3.fallos++;
    }
    if (!l.truncado || !l.claves.length) break;
    desde = l.claves[l.claves.length - 1];
  }
  return { tipo: d.tipo, s3, disco };
}
