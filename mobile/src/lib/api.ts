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
          ...(opts.image ? { image: opts.image } : {}),
        }),
      },
      opts.image ? 45_000 : 28_000
    );
    return { reply: String(data.reply || ''), mode: data.mode, ms: data.ms, via: data.via, error: data.error };
  } catch (e: any) {
    return { reply: '', error: e?.message || 'Sin conexión al cerebro' };
  }
}

export function ttsUrl(text: string, performance: 'speak' | 'sing') {
  const q = new URLSearchParams({ text, performance, engine: 'fast' });
  return `${API_BASE}/api/tts?${q.toString()}`;
}

export async function transcribe(opts: { base64: string; mime: string }): Promise<string> {
  const data = await api<{ text?: string }>(
    '/api/stt',
    {
      method: 'POST',
      body: JSON.stringify({ audioBase64: `data:${opts.mime};base64,${opts.base64}`, mimeType: opts.mime, language: 'es' }),
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
