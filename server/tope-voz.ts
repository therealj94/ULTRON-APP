/**
 * TOPE DIARIO DE VOZ PARA MIEMBROS.
 *
 * La voz de AU-RA (la conversación fluida de ElevenLabs Agents y la voz v4 de /api/tts) gasta
 * créditos de ElevenLabs, que está en prueba. Abrir AU-RA a toda la comunidad sin tope podía gastarlos
 * en una tarde. Cada MIEMBRO (server/nivel.ts) tiene unos minutos de voz al día; la junta, sin tope.
 *
 *   VOZ_MIEMBRO_MIN_DIA   minutos por miembro y por día de Honduras (por omisión 10; 0 = sin voz
 *                         de ElevenLabs para miembros). Un valor que no sea un número >= 0 se ignora.
 *
 * Qué se cuenta:
 *   · la conversación fluida, por el tiempo entre que se abre y su último turno (y hasta que el
 *     teléfono la cierra): lo que ElevenLabs cobra por minuto de llamada;
 *   · /api/tts y la oración por tema, cuando de verdad habló ElevenLabs (no la caché ni Voicebox),
 *     por el largo del texto (unos quince caracteres por segundo).
 *
 * El contador vive en la memoria del proceso: un redespliegue lo pone en cero. Es un freno de gasto,
 * no una factura.
 */
import type { Idioma } from './eleven';

export const VOZ_MIEMBRO_MIN_DIA_DEFECTO = 10;
/** Caracteres por segundo de habla, para estimar lo que dura un texto dicho. */
export const CARACTERES_POR_SEGUNDO = 15;

export function topeVozMinDia(): number {
  const raw = String(process.env.VOZ_MIEMBRO_MIN_DIA ?? '').trim();
  if (!raw) return VOZ_MIEMBRO_MIN_DIA_DEFECTO;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : VOZ_MIEMBRO_MIN_DIA_DEFECTO;
}

/** El día de Honduras (AAAA-MM-DD): el tope se renueva a medianoche de allá, no de UTC. */
export function diaHonduras(ahora = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ahora));
}

const usados = new Map<string, { dia: string; ms: number }>();
const llave = (quien: string) => String(quien || '').trim().toLowerCase();

/** Lo que lleva hoy (ms) esta persona (correo, o `ip:…` si habló sin sesión). */
export function vozUsadaMs(quien: string, ahora = Date.now()): number {
  const u = usados.get(llave(quien));
  return u && u.dia === diaHonduras(ahora) ? u.ms : 0;
}

/** Suma lo hablado. Lo negativo o raro no suma. */
export function anotarVoz(quien: string, ms: number, ahora = Date.now()) {
  if (!quien || !Number.isFinite(ms) || ms <= 0) return;
  const k = llave(quien);
  const dia = diaHonduras(ahora);
  const u = usados.get(k);
  usados.set(k, { dia, ms: (u && u.dia === dia ? u.ms : 0) + ms });
  if (usados.size > 20_000) for (const [x, v] of usados) if (v.dia !== dia) usados.delete(x);
}

/** Lo que le queda hoy (ms). Siempre >= 0. */
export function restanteVozMs(quien: string, ahora = Date.now()): number {
  return Math.max(0, topeVozMinDia() * 60_000 - vozUsadaMs(quien, ahora));
}

/** Lo que dura, más o menos, decir este texto (ms). */
export function msDeHabla(texto: string): number {
  return Math.ceil((String(texto || '').length / CARACTERES_POR_SEGUNDO) * 1000);
}

/** Lo que se le dice a un miembro que llegó al tope: amable, con salida (el chat escrito sigue). */
export function fraseTopeVoz(idioma: Idioma = 'es'): string {
  const min = topeVozMinDia();
  if (idioma === 'en') {
    return min > 0
      ? `We've used today's ${min} minutes of voice. Let's keep going in the written chat, and tomorrow we can talk again.`
      : "Voice conversation isn't available for community members right now. Let's keep going in the written chat.";
  }
  return min > 0
    ? `Por hoy ya usamos tus ${min} minutos de voz. Sigamos por el chat escrito, y mañana volvemos a hablar.`
    : 'La conversación de voz no está disponible para miembros por ahora. Sigamos por el chat escrito.';
}

/** Solo pruebas. */
export function _reiniciarTopeVoz() {
  usados.clear();
}
