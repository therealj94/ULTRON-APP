/**
 * El cliente de Dr Electrum en el teléfono.
 *
 * Habla con las rutas `/api/electrum/*`, que están cerradas: cada petición lleva la sesión o la
 * llave de demostración. No reusa el cliente de ULTRON a propósito — son dos cerebros y dos
 * puertas, y un cliente que sirva para los dos acaba mandando la credencial equivocada.
 */
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '../config';

const K_SESION = 'ultron_sesion_token';
const K_LLAVE = 'electrum_llave';

let sesion: string | null = null;
let llave: string | null = null;

export async function cargarCredenciales() {
  try {
    sesion = await SecureStore.getItemAsync(K_SESION);
    llave = await SecureStore.getItemAsync(K_LLAVE);
  } catch {
    /* almacén no disponible: se entra a mano */
  }
}

export async function guardarSesion(token: string | null) {
  sesion = token;
  try {
    if (token) await SecureStore.setItemAsync(K_SESION, token);
    else await SecureStore.deleteItemAsync(K_SESION);
  } catch {
    /* queda solo en memoria */
  }
}

export async function guardarLlave(v: string | null) {
  llave = v;
  try {
    if (v) await SecureStore.setItemAsync(K_LLAVE, v);
    else await SecureStore.deleteItemAsync(K_LLAVE);
  } catch {
    /* queda solo en memoria */
  }
}

export function hayCredencial(): boolean {
  return !!sesion || !!llave;
}

function cabeceras(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (sesion) h['x-ultron-sesion'] = sesion;
  if (llave) h['x-electrum-llave'] = llave;
  return h;
}

export class SinPuerta extends Error {
  constructor() {
    super('Dr Electrum FP es privado y esta sesión no tiene acceso.');
  }
}

async function pedir<T>(ruta: string, init: RequestInit = {}, msIntento = 45_000): Promise<T> {
  const r = await fetch(`${API_BASE}${ruta}`, {
    ...init,
    headers: cabeceras((init.headers as Record<string, string>) || {}),
    signal: AbortSignal.timeout(msIntento),
  });
  if (r.status === 401) throw new SinPuerta();
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new Error(j?.error || `Error ${r.status}`);
  return j as T;
}

export type Traza = { herramienta: string; ok: boolean; resumen: string };

export type Turno = {
  texto: string;
  emocion: string;
  panel: string;
  traza: Traza[];
  ui: Array<Record<string, unknown>>;
};

/** Lo que se venía hablando, como lo guarda la pantalla del campo. */
export type TurnoHilo = { de: 'persona' | 'doctor'; texto: string };

/**
 * El hilo viaja con la pregunta. El servidor guarda el suyo y lo prefiere, pero Render reinicia el
 * proceso cuando quiere, y en el campo eso es justo lo que no se puede notar: el teléfono lleva su
 * propia copia para que «¿y el segundo?» siga significando algo.
 */
export function preguntar(mensaje: string, hilo: TurnoHilo[] = []): Promise<Turno> {
  return pedir<Turno>('/api/electrum/turno', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mensaje,
      hilo: hilo.slice(-24).map((t) => ({ rol: t.de === 'doctor' ? 'electrum' : 'persona', texto: t.texto })),
    }),
  });
}

/** Lo que contesta el cerebro tras tragarse un archivo. */
export type Aprendido = {
  clase: 'catastro' | 'documento' | 'nada';
  dicho: string;
  avisos: Array<{ nivel: string; texto: string }>;
};

/**
 * La foto de un papel, al expediente.
 *
 * Va como cuerpo crudo y no como multipart: una foto de teléfono son tres o cuatro megas, y en
 * base64 crecen un tercio más para nada. El nombre viaja en la URL y el tipo en la cabecera, que es
 * lo que el servidor necesita para saber que esto es una imagen y mandarla a leer.
 *
 * Nota de campo: el timeout es largo a propósito. Leer una foto de un plano tarda más que contestar
 * una pregunta, y en el campo la señal es la que es.
 */
export async function subirFoto(uri: string, nombre: string, mime = 'image/jpeg'): Promise<Aprendido> {
  const datos = await fetch(uri).then((r) => r.blob());
  return pedir<Aprendido>(
    `/api/electrum/subir?nombre=${encodeURIComponent(nombre)}`,
    { method: 'POST', headers: { 'Content-Type': mime }, body: datos as any },
    90_000
  );
}

export type Salud = {
  viva: boolean;
  motivo?: string;
  concesiones?: number;
  quien: string | null;
  nivel: 'lee' | 'escribe' | 'mando' | null;
};

export function salud(): Promise<Salud> {
  return pedir<Salud>('/api/electrum/salud', {}, 12_000);
}

/** La voz del doctor, en MP3. Se pide aparte porque no devuelve JSON. */
export async function voz(texto: string, emocion?: string): Promise<string | null> {
  try {
    const r = await fetch(`${API_BASE}/api/electrum/voz`, {
      method: 'POST',
      headers: cabeceras({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ texto: texto.slice(0, 1200), emocion }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    // En trozos: un apply sobre 200 000 bytes revienta la pila de argumentos en Hermes.
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:audio/mpeg;base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

/** Entrar con el correo de la junta. La misma sesión que abre ULTRON, si el padrón la deja pasar. */
export async function entrar(correo: string, clave: string): Promise<string> {
  const r = await fetch(`${API_BASE}/api/ultron/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, clave }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok || !j?.token) throw new Error(j?.error || 'No pude entrar con eso.');
  return String(j.token);
}
