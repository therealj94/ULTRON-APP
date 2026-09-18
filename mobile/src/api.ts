import { API } from './modes';

export type Hist = { rol: string; texto: string };

export async function turno(message: string, opts: {
  mode: string;
  image?: string;
  historial: Hist[];
}): Promise<string> {
  const r = await fetch(API + '/api/turno', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      mode: opts.mode,
      image: opts.image,
      historial: opts.historial,
    }),
  });
  const j = await r.json();
  return String(j.reply || j.error || 'Sin respuesta');
}

export async function ttsWav(text: string, voice: string, instruct: string): Promise<ArrayBuffer> {
  const r = await fetch(API + '/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 420), voice, instruct }),
  });
  if (!r.ok) throw new Error('TTS ' + r.status);
  return r.arrayBuffer();
}

export async function stt(b64: string, mime = 'audio/m4a'): Promise<string> {
  const r = await fetch(API + '/api/stt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: b64, mime }),
  });
  const j = await r.json();
  return String(j.text || '').trim();
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return (global as any).btoa(binary);
}

export { bufToB64 };
