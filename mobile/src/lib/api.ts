/**
 * Cliente del backend (Render, rama main).
 *   POST /api/turno, /api/turno/stream (SSE) · GET|POST /api/tts · POST /api/stt · POST /api/vision/analyze
 *   POST /api/memoria (requiere sesión) · GET|POST /api/cantar · POST /api/orar · GET /api/capacidades · GET /api/health
 * Toda llamada pasa por api(): manda la cabecera de sesión y, si el servidor responde 401, renueva el
 * token con las credenciales guardadas y reintenta una vez.
 */
import { API_BASE } from '../config';
import type { Mode, SessionUser } from '../config';
import { normalizarEmocion, pelarEtiqueta, type Emocion } from './emocion';
import { loadCreds, loadMesaToken, saveMesaToken } from './storage';

let refreshing: Promise<boolean> | null = null;

async function renovarSesion(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const creds = await loadCreds();
    if (!creds?.correo || !creds?.clave) return false;
    try {
      const res = await fetch(`${API_BASE}/api/ultron/entrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ correo: creds.correo, clave: creds.clave }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) return false;
      await saveMesaToken(String(data.token));
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function esSesionCaida(status: number, data: any) {
  return status === 401 || data?.code === 'sesion_requerida' || /sesión requerida|privado/i.test(String(data?.error || ''));
}

export async function api<T = any>(path: string, init?: RequestInit, timeoutMs = 30_000, retry401 = true): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const token = await loadMesaToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { 'x-ultron-sesion': token } : {}),
        ...(init?.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429 && retry401) {
        await new Promise((r) => setTimeout(r, 900));
        return api<T>(path, init, timeoutMs, false);
      }
      if (retry401 && esSesionCaida(res.status, data) && !path.includes('/entrar')) {
        const ok = await renovarSesion();
        if (ok) return api<T>(path, init, timeoutMs, false);
      }
      const err = new Error((data as any).error || `HTTP ${res.status}`);
      (err as any).status = res.status;
      (err as any).data = data;
      throw err;
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Cabecera de sesión para descargas de audio (FileSystem/XHR no pasan por api()). */
export async function sessionHeaders(): Promise<Record<string, string>> {
  const token = await loadMesaToken();
  return token ? { 'x-ultron-sesion': token } : {};
}

export type Health = {
  ok: boolean;
  qwen?: { vivo?: boolean; modelo?: string | null };
  tts?: { vivo?: boolean };
  ojo?: { vivo?: boolean; vision?: boolean };
  elevenlabs?: boolean;
};

export async function healthCheck() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${API_BASE}/api/health`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    const data = (await res.json().catch(() => ({}))) as Health;
    if (!res.ok) throw new Error((data as any).error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function loginBiometric(user: SessionUser, timeoutMs = 12_000) {
  const data = await api<{ user?: { nombre?: string; rol?: string; correo?: string }; token?: string }>('/api/ultron/biometric-login', {
    method: 'POST',
    body: JSON.stringify({ biometricType: 'desk_access', userName: user.name, role: user.role, correo: user.correo }),
  }, timeoutMs);
  if (data.token) await saveMesaToken(data.token);
  return data;
}

export async function loginClave(correo: string, clave: string) {
  const data = await api<{ miembro?: { nombre?: string; rol?: string; correo?: string }; token?: string }>('/api/ultron/entrar', {
    method: 'POST',
    body: JSON.stringify({ correo: String(correo).trim().toLowerCase(), clave }),
  }, 15_000);
  if (data.token) await saveMesaToken(data.token);
  return data;
}

export async function logoutRemote() {
  try {
    await api('/api/ultron/salir', { method: 'POST', body: '{}' }, 6_000);
  } catch {
    /* offline ok */
  }
  await saveMesaToken(null);
}

/**
 * Memoria de largo plazo del servidor. /api/memoria exige sesión: al pasar por api() un 401 renueva el
 * token con las credenciales guardadas. `usuario` es el nombre del miembro (la memoria es por persona).
 */
export async function rememberFact(hecho: string, usuario: string): Promise<boolean> {
  try {
    await api('/api/memoria', { method: 'POST', body: JSON.stringify({ hecho, usuario }) }, 8_000);
    return true;
  } catch {
    return false; // se guarda local igual
  }
}

export type Turn = { rol: 'usuario' | 'ultron'; texto: string };

export type ChatResult = {
  reply: string;
  emocion: Emocion;
  mode?: Mode;
  ms?: number;
  via?: string;
  error?: string;
};

type TurnoOpts = {
  message: string;
  mode: Mode;
  userName: string;
  correo?: string;
  historial: Turn[];
  memoria?: string[];
  image?: string;
  /** Descripción de la escena que ya interpretó la cámara local (quién está, qué hace). El servidor la usa como hecho «ESCENA (cámara local): …». */
  escena?: string;
};

function turnoBody(opts: TurnoOpts) {
  const escena = String(opts.escena || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return JSON.stringify({
    message: opts.message,
    mode: opts.mode,
    usuario: opts.userName,
    correo: opts.correo,
    historial: opts.historial.slice(-10),
    memoria: opts.memoria || [],
    ...(opts.image ? { image: opts.image } : {}),
    ...(escena ? { escena } : {}),
  });
}

/** Un turno con el cerebro (Qwen 27B). `image` = data URL jpeg opcional para preguntas visuales. */
export async function turno(opts: TurnoOpts): Promise<ChatResult> {
  try {
    const data = await api<any>('/api/turno', { method: 'POST', body: turnoBody(opts) }, 70_000);
    const pelado = pelarEtiqueta(String(data.reply || ''));
    const emocion = data.emocion ? normalizarEmocion(data.emocion) : pelado.emocion || 'neutral';
    return { reply: pelado.texto.trim(), emocion, mode: data.mode, ms: data.ms, via: data.via, error: data.error };
  } catch (e: any) {
    return { reply: '', emocion: 'neutral', error: e?.message || 'Sin conexión al cerebro' };
  }
}

export type StreamHandlers = {
  /** Emoción del turno: llega ANTES del primer delta (la cara reacciona antes que la voz). */
  onEmocion?: (e: Emocion) => void;
  onDelta: (piece: string) => void;
  onTools?: (tools: string[]) => void;
};

/**
 * Turno en streaming (SSE por XHR: fetch de React Native no expone el body en trozos).
 * Eventos: `emocion` {emocion} · `delta` {text} · `tools` {tools[]} · `done` {reply, emocion, ms, via} · `error`.
 * Si el servidor no soporta stream (404/5xx) lanza para que el caller use turno().
 */
export function turnoStream(opts: TurnoOpts, h: StreamHandlers): { promise: Promise<ChatResult>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let full = '';
  let emocion: Emocion | null = null;
  let firstDelta = true;
  let done: ChatResult | null = null;
  let settled = false;
  let cancelar: (() => void) | null = null;
  const promise = new Promise<ChatResult>((resolve, reject) => {
    const finish = (r: ChatResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const setEmocion = (raw: unknown) => {
      if (emocion) return;
      emocion = normalizarEmocion(raw);
      h.onEmocion?.(emocion);
    };
    const consume = () => {
      const text = xhr.responseText || '';
      if (text.length <= seen) return;
      const chunk = text.slice(seen);
      const blocks = chunk.split('\n\n');
      // el último bloque puede estar incompleto: se conserva
      seen += chunk.length - blocks[blocks.length - 1].length;
      blocks.pop();
      for (const b of blocks) {
        const ev = b.match(/^event: (\w+)/m)?.[1];
        const dataLine = b.match(/^data: (.*)$/m)?.[1];
        if (!ev || dataLine === undefined) continue;
        let data: any = {};
        try {
          data = JSON.parse(dataLine);
        } catch {
          continue;
        }
        if (ev === 'emocion') setEmocion(data.emocion);
        else if (ev === 'delta' && data.text) {
          let piece = String(data.text);
          if (firstDelta) {
            // defensa: servidor viejo que no quitó la etiqueta inicial
            const pelado = pelarEtiqueta(piece);
            if (pelado.emocion) setEmocion(pelado.emocion);
            piece = pelado.texto;
            firstDelta = false;
            if (!piece) continue;
          }
          full += piece;
          h.onDelta(piece);
        } else if (ev === 'tools' && Array.isArray(data.tools)) h.onTools?.(data.tools);
        else if (ev === 'done') {
          if (data.emocion) setEmocion(data.emocion);
          done = { reply: pelarEtiqueta(String(data.reply || full)).texto, emocion: emocion || 'neutral', ms: data.ms, via: data.via };
        } else if (ev === 'error') done = { reply: full, emocion: emocion || 'neutral', error: String(data.error || 'error') };
      }
    };
    xhr.open('POST', `${API_BASE}/api/turno/stream`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.timeout = opts.image ? 75_000 : 70_000;
    xhr.onprogress = consume;
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 429) return fail(new Error('HTTP 429'));
      if (xhr.status < 200 || xhr.status >= 300) return fail(new Error(`HTTP ${xhr.status}`));
      consume();
      const reply = String((done && done.reply) || full).trim();
      if (!reply) return fail(new Error('stream vacío'));
      finish(done ? { ...done, reply, emocion: emocion || done.emocion } : { reply, emocion: emocion || 'neutral' });
    };
    xhr.onerror = () => fail(new Error('red'));
    // Cancelar (el usuario dijo «callar») rechaza ya, sin depender de cómo cierre el XHR al abortarlo.
    cancelar = () => fail(new Error('cancelado'));
    xhr.ontimeout = () => (full ? finish({ reply: full.trim(), emocion: emocion || 'neutral', error: 'timeout' }) : fail(new Error('timeout')));
    const payload = turnoBody(opts);
    void loadMesaToken().then((t) => {
      if (settled) return;
      if (t) xhr.setRequestHeader('x-ultron-sesion', t);
      xhr.send(payload);
    });
  });
  return {
    promise,
    abort: () => {
      cancelar?.();
      try {
        xhr.abort();
      } catch {
        /* todavía no se había enviado */
      }
    },
  };
}

/** GET /api/tts?text=&emocion=&performance= → audio/mpeg (cabecera X-Ultron-TTS con el motor). Sin `engine`. */
export function ttsUrl(text: string, performance: 'speak' | 'sing', emocion: Emocion = 'neutral') {
  const q = new URLSearchParams({ text, performance, emocion });
  return `${API_BASE}/api/tts?${q.toString()}`;
}

export const TTS_ENDPOINT = `${API_BASE}/api/tts`;
export const CANTAR_ENDPOINT = `${API_BASE}/api/cantar`;
export const ORAR_ENDPOINT = `${API_BASE}/api/orar`;

export type Cancion = { id: string; titulo: string; artista: string; pedir: string };

/** Repertorio fijo (mismo que lib/capacidades del servidor) por si GET /api/cantar no responde. */
export const CANCIONES_LOCAL: Cancion[] = [
  { id: 'jesus', titulo: 'Quiero conocer a Jesús', artista: 'Generación 12', pedir: 'canta quiero conocer a Jesús' },
  { id: 'bohemian', titulo: 'Bohemian Rhapsody', artista: 'Queen', pedir: 'canta 1' },
  { id: 'ligera', titulo: 'De música ligera', artista: 'Soda Stereo', pedir: 'canta 2' },
  { id: 'bittersweet', titulo: 'Bitter Sweet Symphony', artista: 'The Verve', pedir: 'canta 3' },
  { id: 'runaway', titulo: 'Runaway', artista: 'Kanye West', pedir: 'canta 4' },
  { id: 'bruno', titulo: 'Die With A Smile', artista: 'Bruno Mars', pedir: 'canta 5' },
  { id: 'waymaker', titulo: 'Way Maker', artista: 'Sinach', pedir: 'canta way maker' },
];

export async function listCanciones(): Promise<Cancion[]> {
  try {
    const data = await api<{ canciones?: Cancion[] }>('/api/cantar', { method: 'GET' }, 8_000);
    return Array.isArray(data.canciones) && data.canciones.length ? data.canciones : CANCIONES_LOCAL;
  } catch {
    return CANCIONES_LOCAL;
  }
}

export async function transcribe(opts: { base64: string; mime: string }): Promise<string> {
  const data = await api<{ text?: string }>(
    '/api/stt',
    {
      method: 'POST',
      // audioBase64/mimeType: servidor 3.1; audio/mime: servidor anterior
      body: JSON.stringify({ audioBase64: `data:${opts.mime};base64,${opts.base64}`, mimeType: opts.mime, audio: opts.base64, mime: opts.mime, language: 'es' }),
    },
    16_000
  );
  return String(data.text || '').trim();
}

export async function describeImage(base64Jpeg: string, prompt: string): Promise<string> {
  try {
    const data = await api<{ summary?: string }>(
      '/api/vision/analyze',
      {
        method: 'POST',
        body: JSON.stringify({ mediaType: 'image/jpeg', fileName: 'desk.jpg', base64Data: `data:image/jpeg;base64,${base64Jpeg}`, prompt }),
      },
      35_000
    );
    return String(data.summary || '').trim();
  } catch {
    return '';
  }
}
