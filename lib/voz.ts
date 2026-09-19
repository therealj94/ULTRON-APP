/**
 * Nota de voz real para Telegram y avisos. Misma voz y misma política que la mesa (server/voz.ts).
 */

import { notaDeVozBuffer } from '../server/voz';
import type { Nodo } from './sistema';
import type { Canal } from './sistema';

export async function notaDeVoz(texto: string): Promise<Buffer | undefined> {
  return notaDeVozBuffer(texto);
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
    .replace(/[̀-ͯ]/g, '');
  return (
    /\b(nota de voz|audio del sistema|voz del sistema|\/audio\b)\b/.test(l) ||
    (/\b(audio|nota de voz)\b/.test(l) && /\b(manda|envia|sistema|nodos|salud|estado|contesta)\b/.test(l))
  );
}
