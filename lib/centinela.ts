/**
 * Centinela: re-prueba nodos. Si uno que estaba vivo cae, avisa a la junta.
 * Primera pasada = línea base. No alarma al arrancar.
 */

import { canales } from './canales';
import { fotoSistema, type Nodo } from './sistema';
import { notaDeVoz } from './voz';

export type EstadoNodos = Record<string, boolean>;

let previa: EstadoNodos | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function estadoDe(nodos: Nodo[]): EstadoNodos {
  const out: EstadoNodos = {};
  for (const n of nodos) out[n.id] = !!n.vivo;
  return out;
}

export function detectarCambio(antes: EstadoNodos | null, ahora: EstadoNodos): string | null {
  if (!antes) return null;
  const ids = Array.from(new Set([...Object.keys(antes), ...Object.keys(ahora)]));
  const caidos = ids.filter((id) => antes[id] && !ahora[id]);
  const vuelven = ids.filter((id) => antes[id] === false && ahora[id]);
  if (!caidos.length && !vuelven.length) return null;
  const bits: string[] = [];
  if (caidos.length) bits.push(`Cayó ${caidos.join(', ')}`);
  if (vuelven.length) bits.push(`Volvió ${vuelven.join(', ')}`);
  return `Jefe. ${bits.join('. ')}. Re-probé. No toqué el cerebro Qwen.`;
}

export async function tickCentinela(opts?: {
  avisar?: (texto: string, voz?: Buffer) => Promise<void>;
}): Promise<{ cambio: string | null; estado: EstadoNodos }> {
  const foto = await fotoSistema();
  const ahora = estadoDe(foto.nodos);
  const cambio = detectarCambio(previa, ahora);
  previa = ahora;
  if (cambio) {
    const avisar =
      opts?.avisar ||
      (async (texto: string, voz?: Buffer) => {
        await canales.telegramUrgente(texto, voz);
      });
    const voz = await notaDeVoz(cambio);
    await avisar(cambio, voz);
  }
  return { cambio, estado: ahora };
}

export function iniciarCentinela(ms = 180_000) {
  if (timer) return;
  previa = null;
  const correr = () => {
    tickCentinela().catch((e) => console.warn('[AU-RA] centinela', String(e?.message || e).slice(0, 160)));
  };
  void correr();
  timer = setInterval(correr, Math.max(60_000, ms));
}

export function detenerCentinela() {
  if (timer) clearInterval(timer);
  timer = null;
  previa = null;
}
