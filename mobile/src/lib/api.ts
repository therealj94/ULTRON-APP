/**
 * Cliente del backend (Render, rama main): /api/turno, /api/tts, /api/stt, /api/vision/analyze, /api/memoria.
 */
import { API_BASE } from '../config';
import type { Mode, SessionUser } from '../config';
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

async function api<T = any>(path: string, init?: RequestInit, timeoutMs = 30_000, retry401 = true): Promise<T> {
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

export async function loginBiometric(user: SessionUser) {
  const data = await api<{ user?: { nombre?: string; rol?: string; correo?: string }; token?: string }>('/api/ultron/biometric-login', {
    method: 'POST',
    body: JSON.stringify({ biometricType: 'desk_access', userName: user.name, role: user.role, correo: user.correo }),
  }, 12_000);
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

/** Memoria de largo plazo del servidor (hechos). */
export async function rememberFact(hecho: string, usuario?: string) {
  try {
    await api('/api/memoria', { method: 'POST', body: JSON.stringify({ hecho, usuario }) }, 8_000);
  } catch {
    /* se guarda local igual */
  }
}

export type Turn = { rol: 'usuario' | 'ultron'; texto: string };

export type ChatResult = {
  reply: string;
  mode?: Mode;
  ms?: number;
  via?: string;
  error?: string;
};

/** Un turno con el cerebro (Qwen 27B). `image` = data URL jpeg opcional para preguntas visuales. */
export async function turno(opts: {
  message: string;
  mode: Mode;
  userName: string;
  correo?: string;
  historial: Turn[];
  memoria?: string[];
  image?: string;
}): Promise<ChatResult> {
  try {
    const data = await api<any>(
      '/api/turno',
      {
        method: 'POST',
        body: JSON.stringify({
          message: opts.message,
          mode: opts.mode,
          usuario: opts.userName,
          correo: opts.correo,
          historial: opts.historial.slice(-10),
          memoria: opts.memoria || [],
          ...(opts.image ? { image: opts.image } : {}),
        }),
      },
      opts.image ? 70_000 : 70_000
    );
    return { reply: String(data.reply || ''), mode: data.mode, ms: data.ms, via: data.via, error: data.error };
  } catch (e: any) {
    return { reply: '', error: e?.message || 'Sin conexión al cerebro' };
  }
}

/**
 * Turno en streaming (SSE por XHR: fetch de React Native no expone el body en trozos).
 * Llama onDelta con cada pedazo de texto; resuelve con la respuesta completa.
 * Si el servidor no soporta stream (404/5xx) lanza para que el caller use turno().
 */
export function turnoStream(
  opts: { message: string; mode: Mode; userName: string; correo?: string; historial: Turn[]; memoria?: string[]; image?: string },
  onDelta: (piece: string) => void,
  onTools?: (tools: string[]) => void
): { promise: Promise<ChatResult>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let full = '';
  let done: ChatResult | null = null;
  let settled = false;
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
        if (ev === 'delta' && data.text) {
          full += data.text;
          onDelta(String(data.text));
        } else if (ev === 'tools' && Array.isArray(data.tools)) onTools?.(data.tools);
        else if (ev === 'done') done = { reply: String(data.reply || full), ms: data.ms, via: data.via };
        else if (ev === 'error') done = { reply: full, error: String(data.error || 'error') };
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
      finish(done || { reply });
    };
    xhr.onerror = () => fail(new Error('red'));
    xhr.ontimeout = () => (full ? finish({ reply: full.trim(), error: 'timeout' }) : fail(new Error('timeout')));
    const payload = JSON.stringify({
      message: opts.message,
      mode: opts.mode,
      usuario: opts.userName,
      correo: opts.correo,
      historial: opts.historial.slice(-10),
      memoria: opts.memoria || [],
      ...(opts.image ? { image: opts.image } : {}),
    });
    void loadMesaToken().then((t) => {
      if (settled) return;
      if (t) xhr.setRequestHeader('x-ultron-sesion', t);
      xhr.send(payload);
    });
  });
  return { promise, abort: () => xhr.abort() };
}

export type TtsEngineParam = 'eleven' | 'qwen' | 'auto';

export function ttsUrl(text: string, performance: 'speak' | 'sing', engine: TtsEngineParam = 'eleven') {
  const q = new URLSearchParams({ text, performance, engine });
  return `${API_BASE}/api/tts?${q.toString()}`;
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
