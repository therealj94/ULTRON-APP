/**
 * El reproductor de los sonidos de trabajo (compa/ambiente.ts en la llamada, compa/trabajoMesa.ts en la mesa): expo-av,
 * en bucle y bajito, como el timbre (timbre.ts). Sin módulos nativos nuevos.
 *
 * NO toca el modo de audio (`setAudioModeAsync`): la conversación de ElevenLabs (WebRTC) es la dueña del audio mientras
 * suena, y cambiarle el modo le movería la salida o el micrófono. El sonido sale por donde ya está saliendo la voz. Es
 * el canal de efectos: no pasa por la voz de la mesa (lib/tts), así que no cuenta como «AU-RA hablando».
 *
 * Los archivos (assets/sfx): teclado.mp3, papel.mp3 y lapiz.mp3 salieron de la API de efectos de sonido de ElevenLabs
 * (text-to-sound v2, `loop: true`, 4 s); pensando.mp3 y clics.mp3 (6-oct) se sintetizaron a mano con un guion propio
 * (un acorde suave que respira y clics de ratón, la ruedita y teclas sueltas; sin muestras de nadie, ~12 s, mp3 mono de
 * 32 kbps, ~50 KB). Cada vez empiezan en otro punto del archivo (compa/sonidosTrabajo.ts, inicioVariado) y cada uno con
 * su volumen (VOLUMEN_SONIDO).
 *
 * Cada `poner` y cada `quitar` cambian la generación: un sonido que termina de cargar tarde (ya se quitó o se cambió por
 * otro) se descarga solo.
 */
import { Audio } from 'expo-av';
import type { SonidoAmbiente } from '../nucleo/contrato';
import type { ReproductorAmbiente } from './ambiente';
import { VOLUMEN_SONIDO, inicioVariado } from './sonidosTrabajo';

const ARCHIVOS: Record<SonidoAmbiente, number> = {
  teclado: require('../../assets/sfx/teclado.mp3'),
  papel: require('../../assets/sfx/papel.mp3'),
  lapiz: require('../../assets/sfx/lapiz.mp3'),
  clics: require('../../assets/sfx/clics.mp3'),
  pensando: require('../../assets/sfx/pensando.mp3'),
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
    const archivo = ARCHIVOS[nombre];
    if (!archivo) return;
    try {
      const { sound } = await Audio.Sound.createAsync(archivo, {
        isLooping: true,
        volume: VOLUMEN_SONIDO[nombre] ?? 0.12,
        positionMillis: inicioVariado(nombre),
        shouldPlay: true,
      });
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
