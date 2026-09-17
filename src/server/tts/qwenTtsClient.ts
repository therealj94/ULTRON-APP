/**
 * Cliente del nodo Qwen3-TTS (EC2 g4dn.xlarge T4).
 * Nunca apunta al A10G del Qwen 27B ni al ojo Playwright.
 */
import { getVoice, UltronVoiceId } from './voices';
import { normalizeNumbersForSpeech } from './normalizeNumbers';

const TTS_URL = (process.env.ULTRON_TTS_URL || '').replace(/\/+$/, '');
const TTS_CLAVE = (process.env.ULTRON_TTS_CLAVE || '').trim();
const TTS_TIMEOUT_MS = Number(process.env.ULTRON_TTS_PLAZO_MS || 45_000);

export function ttsNodeStatus() {
  return {
    configured: Boolean(TTS_URL),
    urlHost: (() => {
      try {
        return TTS_URL ? new URL(TTS_URL).host : null;
      } catch {
        return null;
      }
    })(),
    hasClave: Boolean(TTS_CLAVE),
    note: 'Nodo dedicado T4 (g4dn). No usar 34.207.148.69 (Qwen 27B) ni 34.229.88.165 (Playwright).',
  };
}

export async function ttsSalud(): Promise<{ ok: boolean; detail?: unknown; error?: string }> {
  if (!TTS_URL) return { ok: false, error: 'ULTRON_TTS_URL no configurada' };
  try {
    const r = await fetch(`${TTS_URL}/salud`, {
      headers: TTS_CLAVE ? { 'x-ultron-tts-clave': TTS_CLAVE } : {},
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, detail: data } : { ok: false, error: `HTTP ${r.status}`, detail: data };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

export async function synthesizeWithQwenTts(opts: {
  text: string;
  voice?: string | UltronVoiceId;
  /** Overlay emocional (tono/ritmo) sobre el instruct de la voz */
  instructAddon?: string;
}): Promise<{ ok: true; audio: Buffer; contentType: string } | { ok: false; error: string }> {
  if (!TTS_URL) return { ok: false, error: 'ULTRON_TTS_URL no configurada' };
  const voice = getVoice(opts.voice);
  const text = normalizeNumbersForSpeech(opts.text.trim());
  if (!text) return { ok: false, error: 'texto vacío' };
  const instruct = opts.instructAddon
    ? `${voice.instruct}; ${opts.instructAddon}`
    : voice.instruct;

  try {
    const r = await fetch(`${TTS_URL}/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TTS_CLAVE ? { 'x-ultron-tts-clave': TTS_CLAVE } : {}),
      },
      body: JSON.stringify({
        text,
        voice: voice.id,
        name: voice.name,
        language: voice.language,
        instruct,
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
    if (!r.ok) {
      const err = await r.text();
      return { ok: false, error: `TTS ${r.status}: ${err.slice(0, 200)}` };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const contentType = r.headers.get('content-type') || 'audio/wav';
    return { ok: true, audio: buf, contentType };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}
