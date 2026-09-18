import { API_BASE } from '../config';
import type { FaceState, Mode, SessionUser } from '../config';

async function api<T = any>(path: string, init?: RequestInit, timeoutMs = 45_000): Promise<T> {
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

export async function healthCheck() {
  return api<{ status: string; tts?: { urlHost?: string } }>('/api/health');
}

export async function loginBiometric(user: SessionUser) {
  return api<{ user?: { nombre?: string; rol?: string } }>('/api/ultron/biometric-login', {
    method: 'POST',
    body: JSON.stringify({
      biometricType: 'desk_access',
      userName: user.name,
      role: user.role,
      correo: user.correo,
    }),
  });
}

export async function loginClave(correo: string, clave: string) {
  return api<{ miembro?: { nombre?: string; rol?: string }; codigo?: string }>('/api/ultron/entrar', {
    method: 'POST',
    body: JSON.stringify({ correo: String(correo).trim().toLowerCase(), clave }),
  });
}

export async function logoutRemote() {
  try {
    await api('/api/ultron/salir', { method: 'POST', body: '{}' });
  } catch {
    /* offline ok */
  }
}

export async function postPersonMemory(body: Record<string, unknown>) {
  try {
    await api('/api/memoria/personas', { method: 'POST', body: JSON.stringify(body) });
  } catch {
    /* keep local only */
  }
}

export type ChatResult = {
  reply: string;
  mode?: Mode;
  face?: FaceState;
  emotion?: string;
  error?: string;
  conversationId?: string;
};

/** Chat no-stream (más fiable en RN que SSE parcial). */
export async function chatUltron(opts: {
  message: string;
  mode: Mode;
  conversationId: string;
  context?: Array<{ role: string; content: string }>;
}): Promise<ChatResult> {
  try {
    const data = await api<any>(
      '/api/qwen/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          message: opts.message,
          mode: opts.mode,
          conversationId: opts.conversationId,
          stream: false,
          context: opts.context || [],
        }),
      },
      25_000
    );
    return {
      reply: data.reply || data.mensaje || '',
      mode: data.mode,
      face: data.face,
      emotion: data.emotion,
      conversationId: data.conversationId || opts.conversationId,
      error: data.error,
    };
  } catch (e: any) {
    return { reply: '', error: e?.message || 'Sin conexión al cerebro' };
  }
}

export async function synthesizeTts(opts: {
  text: string;
  voiceId?: string;
  engine?: 'fast' | 'auto';
  performance?: 'speak' | 'sing';
}): Promise<ArrayBuffer | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.performance === 'sing' ? 22_000 : opts.engine === 'fast' ? 14_000 : 45_000);
    const res = await fetch(`${API_BASE}/api/tts/synthesize`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg, audio/wav, application/json' },
      body: JSON.stringify({
        text: opts.text,
        voiceId: opts.voiceId || 'ultron',
        voice: opts.voiceId || 'ultron',
        engine: opts.engine || 'fast',
        performance: opts.performance || 'speak',
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await res.json();
      if (j.audioBase64) {
        const bin = atob(j.audioBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      }
      return null;
    }
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}
