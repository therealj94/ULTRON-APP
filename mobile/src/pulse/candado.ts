/**
 * EL CANDADO de PULSE2CHAT: el mismo sobre que la web y que la app Orden Global, byte por byte.
 *
 * Portado de `orden-global-app/src/og/candado.js` sin cambiar una coma de la criptografía. La regla
 * que manda: un sobre cerrado aquí tiene que abrirse allá y al revés. Si las implementaciones se
 * separan un milímetro —un `info` distinto, un IV de otro largo, la firma en DER en vez de cruda—
 * los mensajes dejan de abrirse y el fallo se ve como «me llegó un mensaje vacío». La prueba
 * `tests/pulse-candado.test.ts` cruza ESTE archivo con el de la web.
 *
 * Esquema: cada aparato tiene un par P-256 para acordar (ECDH) y otro para firmar (ECDSA). Un
 * mensaje se cierra con una llave AES-256-GCM de un solo uso, y esa llave va en un sobre para cada
 * aparato (del destinatario y los propios), con HKDF-SHA256 sobre el ECDH. La v2 firma el bulto y
 * `abrir` juzga la firma contra las llaves PUBLICADAS del remitente.
 *
 * AU-RA es OTRO aparato de la misma cuenta, con su propio par (el llavero seguro es de cada app):
 * lo que llegó antes de que este teléfono publicara su llave no se puede abrir aquí, y la pantalla
 * lo dice en vez de enseñar un renglón vacío.
 */
import './azar';

import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import { hkdf } from '@noble/hashes/hkdf';
import { gcm } from '@noble/ciphers/aes';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const VERSION = 2;
const VERSION_SIN_FIRMA = 1;
// Los mismos textos que la web, letra por letra.
const INFO_SOBRE = 'pulse2chat/sobre/v1';
const INFO_CODIGO = 'pulse2chat/codigo/v1|';
const PREFIJO_FIRMA = 'pulse2chat/bulto/v2';

export type Aparato = { id: string; pub: string; fir?: string | null };
export type Sobre = { a: string; iv: string; k: string };
export type Bulto = { v: number; de: string; iv: string; ct: string; s: Sobre[]; fir?: string; f?: string };
export type Abierto = { texto: string; verificado: boolean; motivo: string };

// ── bytes: base64url a mano (el `btoa` del navegador no existe aquí) ──────────────────────────
const ALF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function aB64(bytes: Uint8Array | ArrayLike<number>): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayLike<number>);
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    s += ALF[(n >> 18) & 63] + ALF[(n >> 12) & 63];
    if (i + 1 < b.length) s += ALF[(n >> 6) & 63];
    if (i + 2 < b.length) s += ALF[n & 63];
  }
  return s;
}

export function deB64(txt: string): Uint8Array {
  const s = String(txt || '');
  const salida = new Uint8Array(Math.floor((s.length * 3) / 4));
  let n = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ALF.indexOf(s[i]);
    if (v < 0) continue;
    n = (n << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      salida[j++] = (n >> bits) & 255;
    }
  }
  return salida.subarray(0, j);
}

/**
 * Un surrogate SUELTO (lo que deja un `.slice()` a mitad de un emoji) hace lanzar a
 * `encodeURIComponent`. La web usa TextEncoder, que lo cambia por U+FFFD («�»); aquí igual, para que
 * el mismo texto dé los mismos bytes en los dos lados y el envío no se caiga por un emoji partido.
 */
export function sanearTexto(s: string): string {
  let r = '';
  let cambio = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        r += s[i] + s[i + 1];
        i++;
        continue;
      }
      r += '\uFFFD';
      cambio = true;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      r += '\uFFFD';
      cambio = true;
      continue;
    }
    r += s[i];
  }
  return cambio ? r : s;
}

const textoABytes = (s: string) => {
  const u = unescape(encodeURIComponent(sanearTexto(String(s))));
  const b = new Uint8Array(u.length);
  for (let i = 0; i < u.length; i++) b[i] = u.charCodeAt(i);
  return b;
};

const bytesATexto = (b: Uint8Array) => {
  let u = '';
  for (let i = 0; i < b.length; i++) u += String.fromCharCode(b[i]);
  return decodeURIComponent(escape(u));
};

const azar = (n: number) => Crypto.getRandomBytes(n);

/** Una llave privada con bytes del sistema; se REINTENTA en vez de recortar (recortar sesga). */
function llavePrivada(): Uint8Array {
  for (let i = 0; i < 8; i++) {
    const k = azar(32);
    if (p256.utils.isValidPrivateKey(k)) return k;
  }
  throw new Error('no se pudo generar una llave privada');
}

// ── el par de llaves de ESTE aparato ────────────────────────────────────────────────────────
// Cajones propios de AU-RA: el llavero seguro es de cada app, así que aunque se llamaran igual que
// los de Orden Global no se verían. Se nombran distinto para que nadie crea que se comparten.
const CAJON = 'aura.p2c.candado.priv';
const CAJON_FIRMA = 'aura.p2c.candado.firma';
export const CAJONES = [CAJON, CAJON_FIRMA];

type Mio = {
  id: string;
  priv: Uint8Array;
  pub: Uint8Array;
  pubB64: string;
  privF: Uint8Array | null;
  pubFB64: string | null;
  /** Solo en memoria: NO se publica (otro arranque tendría otra llave, o la guardada es otra). */
  volatil?: boolean;
  /** Volátil porque el llavero no se dejó LEER: se vuelve a probar de vez en cuando. */
  porLectura?: boolean;
};
let mio: Mio | null = null;
let arrancando: Promise<Mio | null> | null = null;
let ultimoIntento = 0;
const REINTENTO_LLAVERO_MS = 15_000;

function armar(priv: Uint8Array, privF: Uint8Array | null): Mio {
  // La pública SIN COMPRIMIR (65 bytes), como exporta WebCrypto en `raw`.
  const pub = p256.getPublicKey(priv, false);
  const pubB64 = aB64(pub);
  const id = idDeAparato(pubB64);
  const pubF = privF ? p256.getPublicKey(privF, false) : null;
  return { id, priv, pub, pubB64, privF: privF || null, pubFB64: pubF ? aB64(pubF) : null };
}

/** El id de un aparato es b64url(sha256(pub))[:22]: se deriva de la llave, no se declara. */
const ids = new Map<string, string>();
export function idDeAparato(pubB64: string): string {
  const ya = ids.get(pubB64);
  if (ya) return ya;
  const id = aB64(sha256(deB64(pubB64))).slice(0, 22);
  if (ids.size > 500) ids.clear();
  ids.set(pubB64, id);
  return id;
}

/**
 * Leer el llavero distingue TRES cosas: hay algo, NO hay nada (null) y NO SE PUDO LEER. Confundir la
 * última con la segunda era el fallo grave: un Keystore que no descifra en un arranque (pasa en Android
 * justo después de encender, o tras cambiar el bloqueo de pantalla) se tomaba por «teléfono nuevo», se
 * fabricaba otro par y se SOBRESCRIBÍA el bueno: todo lo recibido hasta entonces, perdido.
 */
async function leerCajon(k: string): Promise<{ ok: true; v: string | null } | { ok: false }> {
  try {
    const v = await SecureStore.getItemAsync(k);
    return { ok: true, v: v ?? null };
  } catch {
    return { ok: false };
  }
}

async function escribirCajon(k: string, v: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(k, v);
    return true;
  } catch {
    return false;
  }
}

const valida = (v: string | null): v is string => !!v && deB64(v).length === 32;

/** Un par solo en memoria: cifra mientras la app esté abierta, pero no se publica ni se guarda. */
function enMemoria(porLectura: boolean): Mio | null {
  try {
    return { ...armar(llavePrivada(), llavePrivada()), volatil: true, porLectura };
  } catch {
    return null;
  }
}

async function arrancar(): Promise<Mio | null> {
  ultimoIntento = Date.now();
  const r = await leerCajon(CAJON);
  // No se pudo leer: NO se genera nada que pise lo guardado.
  if (!r.ok) return enMemoria(true);
  if (valida(r.v)) {
    const rf = await leerCajon(CAJON_FIRMA);
    if (!rf.ok) {
      // La de acordar está bien; la de firmar no se pudo leer. Se sigue SIN firma (los mensajes salen
      // «sin firma», que es verdad) y sin publicar, para no pisar la firma publicada con otra.
      return { ...armar(deB64(r.v), null), volatil: true, porLectura: true };
    }
    if (valida(rf.v)) return armar(deB64(r.v), deB64(rf.v));
    // No había firma (llave de antes de la v2) o estaba rota: se hace y se guarda.
    const privF = llavePrivada();
    const guardo = await escribirCajon(CAJON_FIRMA, aB64(privF));
    return guardo ? armar(deB64(r.v), privF) : { ...armar(deB64(r.v), privF), volatil: true };
  }
  // No hay llave (o la guardada está rota): teléfono nuevo. Antes de fabricar, la de firma también
  // tiene que haberse podido leer —si no, el llavero está enfermo y se espera a otro arranque—.
  const rf = await leerCajon(CAJON_FIRMA);
  if (!rf.ok) return enMemoria(true);
  const priv = llavePrivada();
  const privF = llavePrivada();
  const ok1 = await escribirCajon(CAJON, aB64(priv));
  const ok2 = ok1 && (await escribirCajon(CAJON_FIRMA, aB64(privF)));
  const m = armar(priv, privF);
  // Si no quedó guardado, el próximo arranque tendría OTRA llave: esta no se publica.
  return ok1 && ok2 ? m : { ...m, volatil: true };
}

export async function mias(): Promise<Mio | null> {
  // Un par volátil por un llavero que no se dejó leer se reintenta cada tanto: si el Keystore ya
  // responde, vuelve el aparato de siempre sin reiniciar la app.
  if (mio && !(mio.porLectura && Date.now() - ultimoIntento > REINTENTO_LLAVERO_MS)) return mio;
  if (arrancando) return arrancando;
  const antes = mio;
  arrancando = (async () => {
    let nuevo: Mio | null;
    try {
      nuevo = await arrancar();
    } catch {
      nuevo = enMemoria(true);
    }
    // Reintento fallido: se sigue con el mismo par en memoria (cambiarlo movería el id otra vez).
    if (antes && nuevo?.porLectura) nuevo = antes;
    if (nuevo && antes && nuevo.id !== antes.id) cache.clear();
    mio = nuevo;
    arrancando = null;
    return mio;
  })();
  return arrancando;
}

/** La llave pública de este aparato, lista para publicar. */
export async function miLlave(): Promise<{ id: string; pub: string; fir: string | null; volatil: boolean } | null> {
  const m = await mias();
  return m ? { id: m.id, pub: m.pubB64, fir: m.pubFB64 || null, volatil: !!m.volatil } : null;
}

// ── el secreto compartido entre dos aparatos ────────────────────────────────────────────────
const cache = new Map<string, Uint8Array>();

function secretoCon(pubAjenaB64: string, priv: Uint8Array): Uint8Array {
  const guardada = cache.get(pubAjenaB64);
  if (guardada) return guardada;
  // WebCrypto `deriveBits` devuelve solo la X (32 bytes): el punto comprimido sin su prefijo.
  const compartido = p256.getSharedSecret(priv, deB64(pubAjenaB64), true).slice(1);
  const k = hkdf(sha256, compartido, new Uint8Array(0), textoABytes(INFO_SOBRE), 32);
  cache.set(pubAjenaB64, k);
  return k;
}

/**
 * Un aparato por id, el PROPIO primero, y fuera los que dicen un id que no es el de su llave. Sin eso,
 * alguien a quien le escribo podía publicar en SU cuenta un aparato con el id del mío y otra llave: el
 * sobre para mí iba cifrado a su llave y yo no podía releer lo que acababa de mandar.
 */
function dedup(lista: Aparato[], propio: Aparato): Aparato[] {
  const visto = new Set<string>();
  const salida: Aparato[] = [];
  for (const x of [propio, ...(lista || [])]) {
    if (!x || typeof x.id !== 'string' || typeof x.pub !== 'string' || !x.id || !x.pub || visto.has(x.id)) continue;
    try {
      if (idDeAparato(x.pub) !== x.id) continue;
    } catch {
      continue;
    }
    visto.add(x.id);
    salida.push(x);
  }
  return salida;
}

/** Cierra un texto para una lista de aparatos (los de quien recibe; los propios se agregan solos). */
export async function cerrar(texto: string, aparatos: Aparato[]): Promise<Bulto> {
  const m = await mias();
  if (!m) throw new Error('sin-llaves');
  const todos = dedup(aparatos || [], { id: m.id, pub: m.pubB64 });
  if (!todos.length) throw new Error('sin-destino');

  const llaveMsg = azar(32);
  const iv = azar(12);
  const cerrado = gcm(llaveMsg, iv).encrypt(textoABytes(texto));

  const sobres: Sobre[] = [];
  for (const ap of todos) {
    try {
      const k = secretoCon(ap.pub, m.priv);
      const ivS = azar(12);
      sobres.push({ a: ap.id, iv: aB64(ivS), k: aB64(gcm(k, ivS).encrypt(llaveMsg)) });
    } catch {
      // Una llave pública corrupta no tumba el envío a los demás.
    }
  }
  if (!sobres.length) throw new Error('sin-destino');

  const cuerpo: Bulto = { v: VERSION, de: m.pubB64, iv: aB64(iv), ct: aB64(cerrado), s: sobres };
  if (!m.privF) return cuerpo;
  const firma = p256.sign(sha256(textoABytes(paraFirmar(cuerpo))), m.privF);
  // CRUDA (r‖s, 64 bytes), que es lo que produce y espera WebCrypto; @noble da DER por omisión.
  return { ...cuerpo, fir: m.pubFB64 || undefined, f: aB64(firma.toCompactRawBytes()) };
}

function paraFirmar(c: Pick<Bulto, 'v' | 'de' | 'iv' | 'ct' | 's'>): string {
  return [PREFIJO_FIRMA, c.v, c.de, c.iv, c.ct, (c.s || []).map((x) => `${x.a}.${x.iv}.${x.k}`).join('|')].join('\n');
}

/** La firma se juzga contra las llaves PUBLICADAS del remitente, no contra la que trae el bulto. */
function juzgarFirma(bulto: Bulto, aparatos: Aparato[]): { verificado: boolean; motivo: string } {
  if (!bulto.f || !bulto.fir) return { verificado: false, motivo: 'sin-firma' };
  if (!Array.isArray(aparatos) || !aparatos.length) return { verificado: false, motivo: 'sin-llaves-del-remitente' };
  const publicadas = aparatos.map((a) => a && a.fir).filter(Boolean);
  if (!publicadas.includes(bulto.fir)) return { verificado: false, motivo: 'llave-no-publicada' };
  const suyo = aparatos.find((a) => a && a.fir === bulto.fir);
  if (!suyo || suyo.pub !== bulto.de) return { verificado: false, motivo: 'aparato-no-cuadra' };
  try {
    const ok = p256.verify(
      deB64(bulto.f),
      sha256(textoABytes(paraFirmar({ v: bulto.v, de: bulto.de, iv: bulto.iv, ct: bulto.ct, s: bulto.s }))),
      deB64(bulto.fir)
    );
    return ok ? { verificado: true, motivo: '' } : { verificado: false, motivo: 'firma-rota' };
  } catch {
    return { verificado: false, motivo: 'firma-ilegible' };
  }
}

const esTexto = (x: unknown): x is string => typeof x === 'string';

/**
 * ¿Tiene la forma de un bulto? El relevo solo mira que `s` sea una lista y `ct` no esté vacío: un
 * `s: [null]` o un `de` numérico llegaban hasta aquí y hacían LANZAR, y con eso se caía la bandeja
 * entera —el hilo se veía vacío por un solo mensaje malo—.
 */
export function esBulto(b: unknown): b is Bulto {
  if (!b || typeof b !== 'object') return false;
  const x = b as Record<string, unknown>;
  if (!esTexto(x.de) || !esTexto(x.iv) || !esTexto(x.ct) || !Array.isArray(x.s)) return false;
  if (x.f !== undefined && !esTexto(x.f)) return false;
  if (x.fir !== undefined && !esTexto(x.fir)) return false;
  return x.s.every((o) => !!o && typeof o === 'object' && esTexto((o as Sobre).a) && esTexto((o as Sobre).iv) && esTexto((o as Sobre).k));
}

/** Abre un bulto; null si este aparato no tiene sobre (llegó antes de que existiera) o fue tocado. */
export async function abrir(bulto: Bulto | null | undefined, aparatosDelRemitente: Aparato[]): Promise<Abierto | null> {
  const m = await mias();
  if (!m || !esBulto(bulto)) return null;
  if (bulto.v !== VERSION && bulto.v !== VERSION_SIN_FIRMA) return null;
  const sobre = bulto.s.find((x) => x.a === m.id);
  if (!sobre) return null;
  let texto: string;
  try {
    const k = secretoCon(bulto.de, m.priv);
    const llaveMsg = gcm(k, deB64(sobre.iv)).decrypt(deB64(sobre.k));
    texto = bytesATexto(gcm(llaveMsg, deB64(bulto.iv)).decrypt(deB64(bulto.ct)));
  } catch {
    return null;
  }
  try {
    return { texto, ...juzgarFirma(bulto, Array.isArray(aparatosDelRemitente) ? aparatosDelRemitente : []) };
  } catch {
    return { texto, verificado: false, motivo: 'firma-ilegible' };
  }
}

/** Cierra bytes (una foto) con una llave suelta que viaja DENTRO del texto cifrado del mensaje. */
export function cerrarBytes(bytes: Uint8Array) {
  const llave = azar(32);
  const iv = azar(12);
  return { bytes: gcm(llave, iv).encrypt(bytes), llave: aB64(llave), iv: aB64(iv) };
}

export function abrirBytes(bytes: Uint8Array, llaveB64: string, ivB64: string): Uint8Array {
  return gcm(deB64(llaveB64), deB64(ivB64)).decrypt(bytes);
}

/** El código de seguridad: sale IDÉNTICO en los dos aparatos si no hay nadie en medio. */
export function codigoDeSeguridad(pubsMias: string[], pubsSuyas: string[]): string {
  const huella = (lista: string[]) => {
    const juntas = (lista || []).slice().sort().join('|');
    const b = sha256(textoABytes(INFO_CODIGO + juntas));
    let s = '';
    for (let i = 0; i < 15; i += 3) {
      const n = (((b[i] << 16) | (b[i + 1] << 8) | b[i + 2]) >>> 0) % 100000;
      s += String(n).padStart(5, '0') + ' ';
    }
    return s.trim();
  };
  const a = huella(pubsMias);
  const b = huella(pubsSuyas);
  return a < b ? `${a}  ${b}` : `${b}  ${a}`;
}

/** Solo para pruebas: olvida el par en memoria. */
export function _olvidarParaPruebas() {
  mio = null;
  arrancando = null;
  ultimoIntento = 0;
  cache.clear();
}
