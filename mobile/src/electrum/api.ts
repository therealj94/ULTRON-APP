/**
 * El cliente de Dr Electrum en el teléfono.
 *
 * Habla con las rutas `/api/electrum/*`, que están cerradas: cada petición lleva la sesión o la
 * llave de demostración. No reusa el cliente de AU-RA a propósito — son dos cerebros y dos
 * puertas, y un cliente que sirva para los dos acaba mandando la credencial equivocada.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '../config';
import { LectorSse } from '../compa/sse';
import type { Traza, TurnoHilo } from './campo';
import { ErrorHttp, SinPuerta, type Puerta } from './frases';
import { CorteStream, esFalloDeRed, visitaDeBytes, visitaValida, type CuerpoTurno, type Personaje } from './turnoVivo';

// Las clases de error, la puerta y sus frases viven en `frases.ts` (sin React Native, para poder
// probarlas con node:test). Se reexportan para que las pantallas sigan importando de aquí.
export { ErrorHttp, SinPuerta, porQueNoAbre, type Puerta } from './frases';

const K_SESION = 'ultron_sesion_token';
const K_LLAVE = 'electrum_llave';
/** El visitante de esta instalación (turnoVivo.ts visitaDeBytes): no es una credencial y sobrevive a «Salir». */
const K_VISITA = 'electrum_visita';

let sesion: string | null = null;
let llave: string | null = null;
let visita: string | null = null;

export async function cargarCredenciales() {
  try {
    sesion = await SecureStore.getItemAsync(K_SESION);
    llave = await SecureStore.getItemAsync(K_LLAVE);
  } catch {
    /* almacén no disponible: se entra a mano */
  }
  try {
    const guardada = visitaValida(await SecureStore.getItemAsync(K_VISITA));
    if (guardada) visita = guardada;
    else if (visita) await SecureStore.setItemAsync(K_VISITA, visita);
  } catch {
    /* sin almacén: vale para esta vez */
  }
}

/** El visitante de este teléfono: el guardado o uno nuevo (que se guarda). Siempre con la forma que acepta el servidor. */
function visitaElectrum(): string {
  if (visita) return visita;
  let bytes: Uint8Array;
  try {
    bytes = Crypto.getRandomBytes(16);
  } catch {
    // Sin el azar del sistema (no debería pasar): uno de Math.random, mejor que la huella de IP compartida.
    bytes = Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  }
  visita = visitaDeBytes(bytes);
  void SecureStore.setItemAsync(K_VISITA, visita).catch(() => {});
  return visita;
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

/**
 * Cierra la sesión: la borra de aquí y avisa al servidor para que el token deje de valer en
 * cualquier copia.
 *
 * El orden importa. Antes se esperaba al servidor (hasta seis segundos) ANTES de borrar y de
 * cambiar de pantalla: en el campo, sin señal, tocar «Salir» dejaba la pantalla quieta seis
 * segundos, y lo normal ahí es volver a tocar. Ahora se borra primero —la promesa vuelve en cuanto
 * el teléfono ya no tiene la credencial— y el aviso al servidor sale detrás, con el token que había.
 */
export async function cerrarSesion(): Promise<void> {
  const token = sesion;
  await guardarSesion(null);
  await guardarLlave(null);
  if (!token) return;
  const corte = conTope(6_000);
  void fetch(`${API_BASE}/api/ultron/salir`, { method: 'POST', headers: { 'x-ultron-sesion': token }, signal: corte.signal })
    .catch(() => {
      /* sin red: en el teléfono ya no está; en el servidor caduca sola */
    })
    .finally(() => corte.soltar());
}

/**
 * Borra las credenciales de aquí sin avisar al servidor. Es para cuando el SERVIDOR ya dijo que no
 * valen (401 al arrancar): no hay nada que cerrar allá.
 */
export async function olvidarCredenciales(): Promise<void> {
  await guardarSesion(null);
  await guardarLlave(null);
}

export function hayCredencial(): boolean {
  return !!sesion || !!llave;
}

function cabeceras(extra: Record<string, string> = {}): Record<string, string> {
  // Siempre, como la web: con sesión manda la persona; sin ella, el turno, el hilo y el tope de voz son de este teléfono.
  const h: Record<string, string> = { ...extra, 'x-electrum-visita': visitaElectrum() };
  if (sesion) h['x-ultron-sesion'] = sesion;
  if (llave) h['x-electrum-llave'] = llave;
  return h;
}

/** La credencial de esta app, para quien pide por su cuenta (el reproductor de voz en streaming). */
export function cabecerasCampo(): Record<string, string> {
  return cabeceras();
}


/**
 * Lo que espera el teléfono. **Tiene que ser mayor que el presupuesto del turno en el servidor**
 * (50 s, en server/electrum/turno.ts).
 *
 * Estaba en 45 s, o sea por DEBAJO del presupuesto del servidor: la app abandonaba peticiones que
 * el servidor seguía atendiendo, y el usuario veía un fallo de red donde había una respuesta en
 * camino. Los dos números están ahora en el mismo orden, con holgura para la red del campo.
 */
const ESPERA_MS = 75_000;

/**
 * Un `AbortSignal` que se dispara a los `ms`. `AbortSignal.timeout()` NO existe en React Native: su
 * AbortSignal es el del paquete `abort-controller` (Libraries/Core/setUpXHR.js), que no lo trae, así
 * que la llamada lanzaba «undefined is not a function» antes de salir a la red. `soltar` limpia el
 * temporizador cuando la petición terminó antes.
 */
function conTope(ms: number): { signal: AbortSignal; soltar: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, soltar: () => clearTimeout(t) };
}

async function pedir<T>(ruta: string, init: RequestInit = {}, msIntento = ESPERA_MS): Promise<T> {
  const tope = conTope(msIntento);
  try {
    const r = await fetch(`${API_BASE}${ruta}`, {
      ...init,
      headers: cabeceras((init.headers as Record<string, string>) || {}),
      signal: tope.signal,
    });
    if (r.status === 401) throw new SinPuerta();
    const j = (await r.json().catch(() => ({}))) as any;
    // Tipado, no un `Error` con «Error 502» dentro: la pantalla distingue «caído» de «no te deja».
    if (!r.ok) throw new ErrorHttp(r.status, typeof j?.error === 'string' ? j.error : '', typeof j?.codigo === 'string' ? j.codigo : '');
    return j as T;
  } finally {
    tope.soltar();
  }
}

/**
 * Dictado Turbo: un token de un solo uso de ElevenLabs con la dirección del WebSocket lista (pistas del
 * oficio, idioma automático). La clave no llega al teléfono. null si el servidor no lo da.
 */
export async function permisoTurbo(): Promise<{ url: string } | null> {
  try {
    const j = await pedir<{ url?: string }>('/api/electrum/turbo/permiso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 8_000);
    return j?.url && /^wss:\/\//.test(j.url) ? { url: j.url } : null;
  } catch {
    return null;
  }
}

/** Una grabación (WAV en base64) al oído del servidor. `confirmar`: directo con Scribe v2, sin Turbo. */
export async function oirWav(wavB64: string, confirmar = false): Promise<string> {
  const j = await pedir<{ texto?: string }>(
    '/api/electrum/oir',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: wavB64, mime: 'audio/wav', ...(confirmar ? { confirmar: true } : {}) }) },
    20_000
  );
  return String(j?.texto || '').trim();
}

// Los tipos del hilo viven en `campo.ts`, que no importa nada nativo y se prueba sin teléfono.
export type { Traza, TurnoHilo } from './campo';

/** La respuesta de `/api/electrum/turno` (`RespuestaTurno` en server/electrum/turno.ts). */
export type Turno = {
  texto: string;
  emocion: string;
  panel: string;
  traza: Traza[];
  ui: Array<Record<string, unknown>>;
  /** En qué idioma contestó: inglés si le hablaron en inglés; si no, español. */
  idioma?: 'es' | 'en';
};

/** Lo que acompaña a una pregunta además del hilo: su id (para no contestarla dos veces) y lo que se oyó al cortar. */
export type ExtraTurno = { idTurno?: string; interrumpido?: { oido: string } };

/**
 * El cuerpo de una pregunta, el mismo para el stream y para la ruta de siempre.
 *
 * El hilo viaja con la pregunta. El servidor guarda el suyo y lo prefiere, pero Render reinicia el
 * proceso cuando quiere, y en el campo eso es justo lo que no se puede notar: el teléfono lleva su
 * propia copia para que «¿y el segundo?» siga significando algo.
 */
export function cuerpoTurno(mensaje: string, hilo: TurnoHilo[] = [], extra: ExtraTurno = {}): CuerpoTurno {
  return {
    mensaje,
    hilo: hilo.slice(-24).map((t) => ({ rol: t.de === 'doctor' ? 'electrum' : 'persona', texto: t.texto })),
    idTurno: extra.idTurno || '',
    ...(extra.interrumpido?.oido ? { interrumpido: { oido: extra.interrumpido.oido } } : {}),
  };
}

/** La pregunta por la ruta de siempre (la respuesta entera de una vez). Con `idTurno`, el servidor la contesta una vez. */
export function preguntar(mensaje: string, hilo: TurnoHilo[] = [], extra: ExtraTurno = {}): Promise<Turno> {
  return preguntarCuerpo(cuerpoTurno(mensaje, hilo, extra));
}

/**
 * `cuerpo` ya armado (`cuerpoTurno`). Sin red al primer intento (en el campo pasa: la señal va y viene), una vez más
 * con el MISMO `idTurno`: si la primera sí llegó, el servidor no la piensa dos veces. Sin id no se repite.
 */
export async function preguntarCuerpo(cuerpo: CuerpoTurno): Promise<Turno> {
  const { idTurno, ...resto } = cuerpo;
  const init = (): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(idTurno ? cuerpo : resto),
  });
  try {
    return await pedir<Turno>('/api/electrum/turno', init());
  } catch (e) {
    if (!idTurno || !esFalloDeRed(e)) throw e;
    return pedir<Turno>('/api/electrum/turno', init());
  }
}

/**
 * La pregunta EN VIVO (`/api/electrum/turno/stream`, SSE): cada evento llega a `alEvento` en cuanto el servidor lo
 * manda. `fetch` de React Native no entrega el cuerpo por partes; el XMLHttpRequest sí (onprogress con responseText
 * creciendo), como hace la compañera de AU-RA (compa/acciones.ts) y su turno (lib/api.ts).
 *
 * Termina cuando el servidor cierra. Rechaza con `CorteStream` (sin la ruta: 404/405; sin red; por tiempo),
 * `SinPuerta` (401) o `ErrorHttp`. `abortar` corta la petición (el servidor deja de pensar: auditoría H09).
 */
export function preguntarEnVivo(cuerpo: CuerpoTurno, alEvento: (nombre: string, datos: unknown) => void): { promesa: Promise<void>; abortar: () => void } {
  const xhr = new XMLHttpRequest();
  const lector = new LectorSse();
  let abortado = false;
  const leer = () => {
    for (const ev of lector.leer(xhr.responseText || '')) {
      let datos: unknown = null;
      try {
        datos = JSON.parse(ev.datos);
      } catch {
        continue;
      }
      try {
        alEvento(ev.evento, datos);
      } catch {
        /* quien escucha no corta el stream */
      }
    }
  };
  const promesa = new Promise<void>((resolver, rechazar) => {
    let listo = false;
    const fin = (e?: Error) => {
      if (listo) return;
      listo = true;
      if (e) rechazar(e);
      else resolver();
    };
    xhr.open('POST', `${API_BASE}/api/electrum/turno/stream`);
    for (const [k, v] of Object.entries(cabeceras({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }))) xhr.setRequestHeader(k, v);
    xhr.timeout = ESPERA_MS;
    xhr.onprogress = () => {
      if (xhr.status >= 200 && xhr.status < 300) leer();
    };
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4 || abortado) return;
      // 0: sin respuesta (sin red o por tiempo): lo dicen onerror / ontimeout.
      if (xhr.status === 0) return;
      if (xhr.status === 401) return fin(new SinPuerta());
      if (xhr.status === 404 || xhr.status === 405) return fin(new CorteStream('sin-ruta', String(xhr.status)));
      if (xhr.status < 200 || xhr.status >= 300) {
        let detalle = '';
        try {
          const j = JSON.parse(xhr.responseText || '{}');
          if (typeof j?.error === 'string') detalle = j.error;
        } catch {
          /* */
        }
        return fin(new ErrorHttp(xhr.status, detalle));
      }
      leer();
      // El último bloque puede venir sin su línea en blanco detrás: se cierra a mano.
      const resto = xhr.responseText || '';
      if (resto && !/\n\n\s*$/.test(resto)) {
        for (const ev of lector.leer(`${resto}\n\n`)) {
          try {
            alEvento(ev.evento, JSON.parse(ev.datos));
          } catch {
            /* */
          }
        }
      }
      fin();
    };
    xhr.onerror = () => !abortado && fin(new CorteStream('red'));
    xhr.ontimeout = () => !abortado && fin(new CorteStream('tiempo'));
    try {
      xhr.send(JSON.stringify(cuerpo));
    } catch {
      fin(new CorteStream('red'));
    }
  });
  return {
    promesa,
    abortar: () => {
      abortado = true;
      try {
        xhr.abort();
      } catch {
        /* todavía no se había enviado */
      }
    },
  };
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

export async function probarPuerta(): Promise<Puerta> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), 12_000);
  try {
    const r = await fetch(`${API_BASE}/api/electrum/salud`, { headers: cabeceras(), signal: corte.signal });
    if (r.ok) return { estado: 'abierta' };
    if (r.status === 401 || r.status === 403) return { estado: 'sin-permiso' };
    return { estado: 'servicio-caido', codigo: r.status };
  } catch (e: any) {
    return e?.name === 'AbortError' ? { estado: 'lento' } : { estado: 'sin-red' };
  } finally {
    clearTimeout(reloj);
  }
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

/**
 * Lo que acompaña a una frase para la voz: la primera va con el modelo rápido; en la mesa, quién la dice; `previo`, el
 * final de la frase anterior (que no suene cada frase como el comienzo de una respuesta).
 */
export type ExtraVoz = { primera?: boolean; personaje?: Personaje; previo?: string };

/** Lo que viaja de la frase anterior: su final, con tope (en el GET va en la dirección). */
const previoDeVoz = (v: string | undefined): string => String(v || '').replace(/\s+/g, ' ').trim().slice(-300);

/** La voz del doctor (WAV de Voicebox, perfil Alex). Se pide aparte porque no devuelve JSON. */
export async function voz(texto: string, emocion?: string, idioma?: 'es' | 'en', extra: ExtraVoz = {}): Promise<string | null> {
  const tope = conTope(30_000);
  try {
    const r = await fetch(`${API_BASE}/api/electrum/voz`, {
      method: 'POST',
      headers: cabeceras({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        texto: texto.slice(0, 1200),
        emocion,
        idioma,
        ...(extra.primera ? { primera: true } : {}),
        ...(extra.personaje && extra.personaje !== 'electrum' ? { personaje: extra.personaje } : {}),
        ...(previoDeVoz(extra.previo) ? { previo: previoDeVoz(extra.previo) } : {}),
      }),
      signal: tope.signal,
    });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    // El tipo real del servidor, no uno supuesto: el reproductor elige el decodificador por él.
    const tipo = (r.headers.get('content-type') || 'audio/wav').split(';')[0].trim();
    return `data:${tipo};base64,${base64De(buf)}`;
  } catch {
    return null;
  } finally {
    tope.soltar();
  }
}

/**
 * La dirección de una frase en PCM para el reproductor en streaming (modules/aura-voz: AudioTrack, como AU-RA con
 * /api/tts/pcm). El reproductor nativo pide por GET (no sabe mandar un cuerpo), así que todo va en la dirección:
 * `texto`, `idioma`, `personaje` (en la mesa), `primera` y `previo` (el final de la frase anterior). Contesta
 * PCM16 mono con la cabecera X-Ultron-Pcm-Hz; si el
 * servidor no tiene la ruta, el nativo avisa el fallo y la frase va por `voz()` (expo-av).
 */
export function urlVozPcm(texto: string, o: { idioma?: 'es' | 'en'; personaje?: Personaje; primera?: boolean; emocion?: string; previo?: string } = {}): string {
  const q = new URLSearchParams({ texto: texto.slice(0, 1200) });
  if (o.idioma) q.set('idioma', o.idioma);
  if (o.personaje) q.set('personaje', o.personaje);
  if (o.primera) q.set('primera', '1');
  if (o.emocion) q.set('emocion', o.emocion);
  const previo = previoDeVoz(o.previo);
  if (previo) q.set('previo', previo);
  return `${API_BASE}/api/electrum/voz/pcm?${q.toString()}`;
}

function base64De(buf: ArrayBuffer): string {
  let bin = '';
  const bytes = new Uint8Array(buf);
  // En trozos: un apply sobre 200 000 bytes revienta la pila de argumentos en Hermes.
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

/**
 * Bajar un informe PDF que armó el doctor, en base64 (lo que `expo-file-system` sabe escribir).
 *
 * Pide la credencial en la cabecera, igual que el resto de `/api/electrum/*`: por eso no se puede
 * abrir la URL en el navegador del teléfono, que llegaría sin ella y rebotaría con 401. La ruta la
 * valida `rutaDeInforme` (campo.ts) antes de llegar aquí.
 */
export async function descargarInforme(ruta: string): Promise<string> {
  const tope = conTope(60_000);
  try {
    const r = await fetch(`${API_BASE}${ruta}`, { headers: cabeceras(), signal: tope.signal });
    if (r.status === 401) throw new SinPuerta();
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as any;
      throw new ErrorHttp(r.status, typeof j?.error === 'string' ? j.error : '');
    }
    return base64De(await r.arrayBuffer());
  } finally {
    tope.soltar();
  }
}

/** Entrar con el correo de la junta. La misma sesión que abre AU-RA, si el padrón la deja pasar. */
export async function entrar(correo: string, clave: string): Promise<string> {
  // La puerta de Dr Electrum. El servidor mantiene `/api/ultron/entrar` como alias para las
  // APK que ya están instaladas; las nuevas llaman a la suya.
  const tope = conTope(20_000);
  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/electrum/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, clave }),
      signal: tope.signal,
    });
  } catch (e) {
    // Sin red o sin respuesta a tiempo: se deja pasar el error tal cual, y `fraseDeError` lo traduce.
    tope.soltar();
    throw e;
  }
  tope.soltar();
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new ErrorHttp(r.status, typeof j?.error === 'string' ? j.error : '');
  if (!j?.token) throw new ErrorHttp(500); // contestó «ok» sin sesión: es del servidor
  return String(j.token);
}
