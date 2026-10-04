/**
 * El reproductor del sonido de fondo de la conversación (compa/ambiente.ts): expo-av, en bucle y
 * bajito, como el timbre (timbre.ts). Sin módulos nativos nuevos.
 *
 * NO toca el modo de audio (`setAudioModeAsync`): la conversación de ElevenLabs (WebRTC) es la dueña
 * del audio mientras suena, y cambiarle el modo le movería la salida o el micrófono. El sonido sale
 * por donde ya está saliendo la voz.
 *
 * Los archivos (assets/sfx/teclado.mp3, papel.mp3, lapiz.mp3) salieron de la API de efectos de sonido
 * de ElevenLabs (text-to-sound v2, `loop: true`, 4 s, mp3 de 64 kbps, ~32 KB cada uno).
 *
 * Cada `poner` y cada `quitar` cambian la generación: un sonido que termina de cargar tarde (ya se
 * quitó o se cambió por otro) se descarga solo.
 */
import { Audio } from 'expo-av';
import type { SonidoAmbiente } from '../nucleo/contrato';
import { VOLUMEN_AMBIENTE, type ReproductorAmbiente } from './ambiente';

const ARCHIVOS: Record<SonidoAmbiente, number> = {
  teclado: require('../../assets/sfx/teclado.mp3'),
  papel: require('../../assets/sfx/papel.mp3'),
  lapiz: require('../../assets/sfx/lapiz.mp3'),
};

let sonido: Audio.Sound | null = null;
let gen = 0;

async function descargar(s: Audio.Sound) {
  try {
    await s.stopAsync();
  } catch {
    /* ya parado */
  }
  try {
    await s.unloadAsync();
  } catch {
    /* ya descargado */
  }
}

function soltar() {
  const s = sonido;
  sonido = null;
  if (s) void descargar(s);
}

export const reproductorAmbiente: ReproductorAmbiente = {
  async poner(nombre) {
    gen++;
    soltar();
    const mia = gen;
    try {
      const { sound } = await Audio.Sound.createAsync(ARCHIVOS[nombre], { isLooping: true, volume: VOLUMEN_AMBIENTE, shouldPlay: true });
      if (mia !== gen) return void descargar(sound);
      sonido = sound;
    } catch {
      /* sin el archivo (una APK vieja sin el bundle nuevo) o sin audio: la frase de espera basta */
    }
  },
  quitar() {
    gen++;
    soltar();
  },
};
