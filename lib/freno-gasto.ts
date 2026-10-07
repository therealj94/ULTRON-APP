/**
 * EL FRENO DE GASTO DIARIO POR PROVEEDOR (auditoría del 7-oct, C-2).
 *
 * Las rutas que gastan dinero (voz, oído, ojos) ya piden sesión y tienen cupo por IP y por persona. Esto es la última
 * red: un tope GLOBAL por día y por proveedor, para todo el proceso, venga de donde venga el gasto (la mesa, la web,
 * Windows, Telegram, Dr Electrum). Si una cuenta robada o un error en un bucle se pone a gastar, el día se corta en el
 * tope y no en la factura.
 *
 *   AURA_TOPE_DIA_TTS_CARACTERES   caracteres de ElevenLabs TTS al día (por omisión 600 000, unas 11 h de habla).
 *   AURA_TOPE_DIA_STT_SEGUNDOS     segundos de audio oídos al día (por omisión 36 000 = 10 h). Cada permiso del oído
 *                                  Turbo en vivo cuenta SEGUNDOS_POR_PERMISO_TURBO (no se sabe cuánto va a durar).
 *   AURA_TOPE_DIA_VISION_LLAMADAS  llamadas a los ojos al día (por omisión 5 000).
 *
 * Un valor que no sea un número >= 0 se ignora (vale el de omisión); 0 apaga ese proveedor. El día es el de Honduras.
 * Al pasarse, una línea clara en el registro (una vez por día y proveedor) y el proveedor contesta «no» hasta
 * medianoche: la voz cae a Voicebox (sin créditos de ElevenLabs), el oído y los ojos dicen que no pueden.
 *
 * El contador vive en la memoria del proceso: un redespliegue lo pone en cero. Es un freno, no una factura.
 */
import { diaHonduras } from '../server/tope-voz';

export type ProveedorGasto = 'tts' | 'stt' | 'vision';

export const TOPES_GASTO_OMISION: Record<ProveedorGasto, number> = { tts: 600_000, stt: 36_000, vision: 5_000 };
export const ENV_TOPE_GASTO: Record<ProveedorGasto, string> = {
  tts: 'AURA_TOPE_DIA_TTS_CARACTERES',
  stt: 'AURA_TOPE_DIA_STT_SEGUNDOS',
  vision: 'AURA_TOPE_DIA_VISION_LLAMADAS',
};
const QUE: Record<ProveedorGasto, { nombre: string; unidad: string; luego: string }> = {
  tts: { nombre: 'ElevenLabs TTS', unidad: 'caracteres', luego: 'la voz pasa a Voicebox (sin créditos de ElevenLabs)' },
  stt: { nombre: 'el oído (STT)', unidad: 'segundos', luego: 'el oído contesta que no puede' },
  vision: { nombre: 'los ojos (visión)', unidad: 'llamadas', luego: 'los ojos contestan que no pueden' },
};
/** Lo que cuenta un permiso del oído Turbo en vivo: el teléfono puede tenerlo abierto un rato, no se sabe cuánto. */
export const SEGUNDOS_POR_PERMISO_TURBO = 60;

export function topeGasto(p: ProveedorGasto, env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env[ENV_TOPE_GASTO[p]] ?? '').trim();
  if (!raw) return TOPES_GASTO_OMISION[p];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : TOPES_GASTO_OMISION[p];
}

const usado = new Map<ProveedorGasto, { dia: string; cantidad: number; avisado: boolean }>();

function cuenta(p: ProveedorGasto, ahora: number) {
  const dia = diaHonduras(ahora);
  let c = usado.get(p);
  if (!c || c.dia !== dia) {
    c = { dia, cantidad: 0, avisado: false };
    usado.set(p, c);
  }
  return c;
}

/**
 * Reserva `cantidad` del cupo del día de ese proveedor. true: hay cupo y ya quedó anotado (se cobra al pedir, aunque
 * el proveedor falle después: es un freno). false: el tope se alcanzó; no se anota nada y no se debe llamar al
 * proveedor.
 */
export function gastarCupoDiario(p: ProveedorGasto, cantidad: number, ahora = Date.now()): boolean {
  const n = Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 0;
  const c = cuenta(p, ahora);
  const tope = topeGasto(p);
  if (c.cantidad + n > tope || (tope === 0 && n === 0)) {
    if (!c.avisado) {
      c.avisado = true;
      const q = QUE[p];
      console.error(
        `[freno-gasto] TOPE DIARIO ALCANZADO: ${q.nombre} lleva ${Math.round(c.cantidad)} de ${tope} ${q.unidad} hoy (${c.dia}, Honduras). ` +
          `Hasta medianoche no se gasta más: ${q.luego}. Si el gasto es legítimo, sube ${ENV_TOPE_GASTO[p]} en Render.`
      );
    }
    return false;
  }
  c.cantidad += n;
  return true;
}

/** Lo gastado hoy por proveedor (para el estado del sistema). */
export function estadoGasto(ahora = Date.now()): Record<ProveedorGasto, { usado: number; tope: number; dia: string }> {
  const out = {} as Record<ProveedorGasto, { usado: number; tope: number; dia: string }>;
  for (const p of Object.keys(TOPES_GASTO_OMISION) as ProveedorGasto[]) {
    const c = cuenta(p, ahora);
    out[p] = { usado: Math.round(c.cantidad), tope: topeGasto(p), dia: c.dia };
  }
  return out;
}

/** Solo pruebas: el contador en cero. */
export function _reiniciarFrenoGasto() {
  usado.clear();
}

/**
 * Cuántos segundos dura un audio, para el tope del oído. Un WAV dice su duración en la cabecera; lo demás (m4a, ogg,
 * webm del teléfono y Telegram) se estima por el peso a 32 kbps, que es lo que graban (de sobra para un freno). Al menos 1 s.
 */
export function segundosDeAudio(audio: Buffer, mime = ''): number {
  if (audio.length >= 44 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE') {
    const bytesPorSegundo = audio.readUInt32LE(28);
    if (bytesPorSegundo > 0) return Math.max(1, Math.ceil((audio.length - 44) / bytesPorSegundo));
  }
  if (/pcm|l16/i.test(mime)) return Math.max(1, Math.ceil(audio.length / 32_000));
  return Math.max(1, Math.ceil(audio.length / 4_000));
}
