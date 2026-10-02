/**
 * Los sonidos del recorrido en el teléfono (coreografia.ts → SONIDOS): el obturador de la foto, el
 * timbre de la llamada, el teclado, el lápiz, el papel, la chispa y el golpe de cada capítulo. El
 * «whoosh» y el toque son los de la app (lib/sfx.ts). Respetan el ajuste «sonidos» y callan en una
 * llamada de PULSE2CHAT (sfxActivos), igual que todos los efectos de la app.
 *
 * Se cargan al abrir el recorrido y se sueltan al cerrarlo: no ocupan memoria el resto del tiempo.
 */
import { Audio } from 'expo-av';
import { playSfx, sfxActivos } from '../lib/sfx';
import type { SonidoId } from './coreografia';

const FUENTES: Record<Exclude<SonidoId, 'whoosh' | 'tap'>, { src: number; volumen: number }> = {
  obturador: { src: require('../../assets/recorrido/obturador.wav'), volumen: 0.95 },
  timbre: { src: require('../../assets/llamada/timbre.wav'), volumen: 0.5 },
  chispa: { src: require('../../assets/recorrido/chispa.wav'), volumen: 0.6 },
  capitulo: { src: require('../../assets/recorrido/capitulo.wav'), volumen: 0.7 },
  teclado: { src: require('../../assets/sfx/teclado.mp3'), volumen: 0.5 },
  lapiz: { src: require('../../assets/sfx/lapiz.mp3'), volumen: 0.6 },
  papel: { src: require('../../assets/sfx/papel.mp3'), volumen: 0.6 },
};

const cargados = new Map<string, Audio.Sound>();

export async function prepararSonidos(): Promise<void> {
  await Promise.all(
    (Object.keys(FUENTES) as (keyof typeof FUENTES)[]).map(async (k) => {
      if (cargados.has(k)) return;
      try {
        const { sound } = await Audio.Sound.createAsync(FUENTES[k].src, { shouldPlay: false, volume: FUENTES[k].volumen });
        cargados.set(k, sound);
      } catch {
        /* sin ese sonido, el recorrido sigue igual */
      }
    })
  );
}

export function sonar(s: SonidoId): void {
  if (!sfxActivos()) return;
  if (s === 'whoosh' || s === 'tap') return playSfx(s);
  const sonido = cargados.get(s);
  if (sonido) void sonido.replayAsync().catch(() => {});
}

export async function soltarSonidos(): Promise<void> {
  const todos = [...cargados.values()];
  cargados.clear();
  await Promise.all(todos.map((x) => x.unloadAsync().catch(() => {})));
}
