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

const textoABytes = (s: string) => {
  const u = unescape(encodeURIComponent(String(s)));
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

type Mio = { id: string; priv: Uint8Array; pub: Uint8Array; pubB64: string; privF: Uint8Array | null; pubFB64: string | null; volatil?: boolean };
let mio: Mio | null = null;
let arrancando: Promise<Mio | null> | null = null;

function armar(priv: Uint8Array, privF: Uint8Array | null): Mio {
  // La pública SIN COMPRIMIR (65 bytes), como exporta WebCrypto en `raw`.
  const pub = p256.getPublicKey(priv, false);
  const pubB64 = aB64(pub);
  const id = aB64(sha256(pub)).slice(0, 22);
  const pubF = privF ? p256.getPublicKey(privF, false) : null;
  return { id, priv, pub, pubB64, privF: privF || null, pubFB64: pubF ? aB64(pubF) : null };
}

export async function mias(): Promise<Mio | null> {
  if (mio) return mio;
  if (arrancando) return arrancando;
  arrancando = (async () => {
    try {
      const guardada = await SecureStore.getItemAsync(CAJON).catch(() => null);
      let guardadaF = await SecureStore.getItemAsync(CAJON_FIRMA).catch(() => null);
      if (guardada && deB64(guardada).length === 32) {
        if (!guardadaF || deB64(guardadaF).length !== 32) {
          guardadaF = aB64(llavePrivada());
          await SecureStore.setItemAsync(CAJON_FIRMA, guardadaF).catch(() => {});
        }
        mio = armar(deB64(guardada), deB64(guardadaF));
        return mio;
      }
      const priv = llavePrivada();
      const privF = llavePrivada();
      await SecureStore.setItemAsync(CAJON, aB64(priv)).catch(() => {});
      await SecureStore.setItemAsync(CAJON_FIRMA, aB64(privF)).catch(() => {});
      mio = armar(priv, privF);
    } catch {
      // El llavero puede negarse: un par solo en memoria cifra igual mientras la app esté abierta.
      try {
        mio = { ...armar(llavePrivada(), llavePrivada()), volatil: true };
      } catch {
        mio = null;
      }
    }
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

function dedup(lista: Aparato[]): Aparato[] {
  const visto = new Set<string>();
  return (lista || []).filter((x) => {
    if (!x?.id || !x?.pub || visto.has(x.id)) return false;
    visto.add(x.id);
    return true;
  });
}

/** Cierra un texto para una lista de aparatos (los de quien recibe; los propios se agregan solos). */
export async function cerrar(texto: string, aparatos: Aparato[]): Promise<Bulto> {
  const m = await mias();
  if (!m) throw new Error('sin-llaves');
  const todos = dedup([...(aparatos || []), { id: m.id, pub: m.pubB64 }]);
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

/** Abre un bulto; null si este aparato no tiene sobre (llegó antes de que existiera) o fue tocado. */
export async function abrir(bulto: Bulto | null | undefined, aparatosDelRemitente: Aparato[]): Promise<Abierto | null> {
  const m = await mias();
  if (!m || !bulto) return null;
  if (bulto.v !== VERSION && bulto.v !== VERSION_SIN_FIRMA) return null;
  const sobre = (bulto.s || []).find((x) => x.a === m.id);
  if (!sobre) return null;
  let texto: string;
  try {
    const k = secretoCon(bulto.de, m.priv);
    const llaveMsg = gcm(k, deB64(sobre.iv)).decrypt(deB64(sobre.k));
    texto = bytesATexto(gcm(llaveMsg, deB64(bulto.iv)).decrypt(deB64(bulto.ct)));
  } catch {
    return null;
  }
  return { texto, ...juzgarFirma(bulto, aparatosDelRemitente) };
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
  cache.clear();
}
