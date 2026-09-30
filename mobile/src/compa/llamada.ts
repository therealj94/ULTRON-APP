/**
 * AURA en una llamada: se apaga del todo y vuelve al colgar.
 *
 * Cuando el motor de llamadas avisa `llamada {activa:true}` (voz o video, entrante o saliente):
 *  · la conversación fluida se cierra (y al colgar se reabre si estaba abierta, silenciada si lo estaba;
 *    con la app detrás no se reabre);
 *  · la voz de la mesa se calla y NO vuelve a tocar el modo de audio de expo-av (speechCloud y tts lo
 *    ponían en modo multimedia y rompían el de la llamada);
 *  · el oído de la mesa se suelta y nadie lo rearma hasta colgar;
 *  · ningún efecto de sonido suena.
 * La cámara de la mesa y la compañera se apagan cada una por su lado (escuchan el mismo evento).
 *
 * Todo entra por `deps` para probarlo en Node sin teléfono.
 */
import type { Eventos } from '../nucleo/contrato';

export type DepsLlamada = {
  escuchar: (tipo: 'llamada', f: (d: Eventos['llamada']) => void) => () => void;
  sesion: { llamada: (activa: boolean, enPrimerPlano?: boolean) => void };
  /** ¿La app está delante? (AppState 'active'). Al colgar con la app detrás, la conversación no se reabre. */
  enPrimerPlano?: () => boolean;
  suspenderVoz: (on: boolean) => void;
  suspenderOido: (on: boolean) => Promise<void> | void;
  suspenderSfx: (on: boolean) => void;
  miga?: (texto: string) => void;
};

/** Empieza a coordinar; devuelve cómo dejar de hacerlo (y si había una llamada, la da por terminada). */
export function coordinarLlamadas(d: DepsLlamada): () => void {
  let enLlamada = false;
  const aplicar = (activa: boolean, video = false) => {
    if (activa === enLlamada) return;
    enLlamada = activa;
    d.miga?.(activa ? `llamada: AURA se apaga (${video ? 'video' : 'voz'})` : 'llamada: AURA vuelve');
    // Orden: primero se suelta todo lo que suena o escucha, al final se reabre la conversación.
    if (activa) {
      d.sesion.llamada(true);
      d.suspenderVoz(true);
      d.suspenderSfx(true);
      void Promise.resolve(d.suspenderOido(true)).catch(() => {});
    } else {
      d.suspenderSfx(false);
      d.suspenderVoz(false);
      void Promise.resolve(d.suspenderOido(false)).catch(() => {});
      d.sesion.llamada(false, d.enPrimerPlano ? d.enPrimerPlano() : true);
    }
  };
  const off = d.escuchar('llamada', ({ activa, video }) => aplicar(!!activa, !!video));
  return () => {
    off();
    if (enLlamada) aplicar(false);
  };
}
