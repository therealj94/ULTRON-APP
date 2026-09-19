/**
 * Cliente del backend (Render, rama main): /api/turno, /api/tts, /api/stt, /api/vision/analyze, /api/memoria.
 */
import { API_BASE } from '../config';
import type { Mode, SessionUser } from '../config';

async function api<T = any>(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
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
  return api<Health>('/api/health', undefined, 8_000);
}

export async function loginBiometric(user: SessionUser) {
  return api<{ user?: { nombre?: string; rol?: string; correo?: string } }>('/api/ultron/biometric-login', {
    method: 'POST',
    body: JSON.stringify({ biometricType: 'desk_access', userName: user.name, role: user.role, correo: user.correo }),
  }, 12_000);
}

export async function loginClave(correo: string, clave: string) {
  return api<{ miembro?: { nombre?: string; rol?: string; correo?: string } }>('/api/ultron/entrar', {
    method: 'POST',
    body: JSON.stringify({ correo: String(correo).trim().toLowerCase(), clave }),
  }, 15_000);
}

export async function logoutRemote() {
  try {
    await api('/api/ultron/salir', { method: 'POST', body: '{}' }, 6_000);
  } catch {
    /* offline ok */
  }
}

/** Memoria de largo plazo del servidor (hechos). */
export async function rememberFact(hecho: string) {
  try {
    await api('/api/memoria', { method: 'POST', body: JSON.stringify({ hecho }) }, 8_000);
  } catch {
    /* se guarda local igual */
  }
}

export type Turn = { rol: 'usuario' | 'ultron'; texto: string };

export type ChatResult = {
  reply: string;
  tono?: string;
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
          historial: opts.historial.slice(-10),
          memoria: opts.memoria || [],
          ...(opts.image ? { image: opts.image } : {}),
        }),
      },
      opts.image ? 45_000 : 28_000
    );
    return { reply: String(data.reply || ''), tono: data.tono, mode: data.mode, ms: data.ms, via: data.via, error: data.error };
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
  opts: { message: string; mode: Mode; userName: string; historial: Turn[]; memoria?: string[]; image?: string },
  onDelta: (piece: string) => void,
  onTools?: (tools: string[]) => void,
  onTono?: (tono: string) => void
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
        else if (ev === 'tono' && data.tono) onTono?.(String(data.tono));
        else if (ev === 'done') done = { reply: String(data.reply || full), tono: data.tono, ms: data.ms, via: data.via };
        else if (ev === 'error') done = { reply: full, error: String(data.error || 'error') };
      }
    };
    xhr.open('POST', `${API_BASE}/api/turno/stream`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.timeout = opts.image ? 60_000 : 45_000;
    xhr.onprogress = consume;
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status < 200 || xhr.status >= 300) return fail(new Error(`HTTP ${xhr.status}`));
      consume();
      finish(done || { reply: full.trim(), error: full ? undefined : 'stream vacío' });
    };
    xhr.onerror = () => fail(new Error('red'));
    xhr.ontimeout = () => (full ? finish({ reply: full.trim(), error: 'timeout' }) : fail(new Error('timeout')));
    xhr.send(
      JSON.stringify({
        message: opts.message,
        mode: opts.mode,
        usuario: opts.userName,
        historial: opts.historial.slice(-10),
        memoria: opts.memoria || [],
        ...(opts.image ? { image: opts.image } : {}),
      })
    );
  });
  return { promise, abort: () => xhr.abort() };
}

export type TtsEngineParam = 'eleven' | 'qwen' | 'auto';

export function ttsUrl(text: string, performance: 'speak' | 'sing', engine: TtsEngineParam = 'eleven', tono = 'IDLE', lang = 'es') {
  const q = new URLSearchParams({ text, performance, engine, tono, lang });
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

export type CanalTaller = { id: string; nombre: string; listo: boolean; falta?: string };

export async function tallerCatalogo() {
  try {
    return await api<{ canales: CanalTaller[] }>('/api/taller', undefined, 8_000);
  } catch {
    return { canales: [] as CanalTaller[] };
  }
}
