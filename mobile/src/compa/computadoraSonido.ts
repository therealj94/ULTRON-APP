/**
 * El tecleo de fondo mientras trabaja su computadora en la nube (compa/computadora.ts, CompaneroPc): el
 * mismo archivo del sonido de la conversación (assets/sfx/teclado.mp3, en bucle de 4 s), por expo-av y
 * más bajito que aquel (VOLUMEN_PC). Reproductor aparte del de la conversación (ambienteSonido.ts):
 * aquel lo quita el servidor al contestar cada turno, y la computadora sigue trabajando después.
 *
 * Sin módulos nativos nuevos y sin tocar el modo de audio (la conversación de ElevenLabs es la dueña del
 * audio mientras suena). Cada `poner`/`quitar` cambia la generación: lo que termina de cargar tarde se
 * descarga solo.
 */
import { Audio } from 'expo-av';

/** Más bajito que el sonido de la conversación (0,16): es un fondo de minutos, no de segundos. */
export const VOLUMEN_PC = 0.1;

let sonido: Audio.Sound | null = null;
let gen = 0;
let puesto = false;

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

export const tecleoPc = {
  /** ¿Está sonando (o cargando)? */
  get puesto() {
    return puesto;
  },
  async poner() {
    if (puesto) return;
    puesto = true;
    const mia = ++gen;
    try {
      const { sound } = await Audio.Sound.createAsync(require('../../assets/sfx/teclado.mp3'), { isLooping: true, volume: VOLUMEN_PC, shouldPlay: true });
      if (mia !== gen) return void descargar(sound);
      sonido = sound;
    } catch {
      /* sin audio: la vista y las frases bastan */
      if (mia === gen) puesto = false;
    }
  },
  quitar() {
    if (!puesto && !sonido) return;
    gen++;
    puesto = false;
    const s = sonido;
    sonido = null;
    if (s) void descargar(s);
  },
};
