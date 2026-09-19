/**
 * Nota de voz real: ElevenLabs, si falla Chatterbox. Cero teatro.
 */

import { clave } from './boveda';
import { chatterboxSpeak, elevenSpeak } from '../server/desk';
import type { Nodo } from './sistema';
import type { Canal } from './sistema';

export async function notaDeVoz(texto: string): Promise<Buffer | undefined> {
  const dicho = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 420);
  if (dicho.length < 8) return undefined;
  const el = clave('elevenlabs');
  if (el) {
    const spoken = await elevenSpeak({ apiKey: el, text: dicho, performance: 'speak' });
    if (spoken?.audio && spoken.audio.length > 80) return spoken.audio;
  }
  const tts = clave('tts_url');
  if (tts) {
    const local = await chatterboxSpeak({ baseUrl: tts, text: dicho, clave: clave('tts_clave') || undefined });
    if (local?.audio && local.audio.length > 80) return local.audio;
  }
  return undefined;
}

export function dictarSistema(foto: { nodos: Nodo[]; canales: Canal[] }): string {
  const vivos = foto.nodos.filter((n) => n.vivo).map((n) => n.id);
  const caidos = foto.nodos.filter((n) => !n.vivo).map((n) => n.id);
  const faltan = foto.canales.filter((c) => !c.listo).map((c) => c.nombre);
  if (caidos.length) {
    return `Jefe. Cayó ${caidos.join(', ')}. En pie: ${vivos.join(', ') || 'nadie'}. Sin clave: ${faltan.join(', ') || 'ningún canal'}. No toqué el cerebro Qwen.`;
  }
  return `Jefe. Sistema en pie: ${vivos.join(', ') || 'sin nodos medidos'}. Sin clave: ${faltan.join(', ') || 'ningún canal'}. No toqué el cerebro Qwen.`;
}

export function pideNotaDeVoz(raw: string): boolean {
  const l = String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    /\b(nota de voz|audio del sistema|voz del sistema|\/audio\b)\b/.test(l) ||
    (/\b(audio|nota de voz)\b/.test(l) && /\b(manda|envia|sistema|nodos|salud|estado|contesta)\b/.test(l))
  );
}
