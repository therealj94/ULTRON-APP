/**
 * El timbre de la LLAMADA DEL AVATAR con la app delante: el mismo sonido y la misma vibración que una
 * llamada entrante de PULSE2CHAT (assets/llamada/timbre.wav, pulse/llamada.ts). Con la app cerrada o el
 * teléfono bloqueado suena el aviso de notifee (compa/recordatorios.ts), no esto.
 *
 * Cada `sonar` y cada `callar` cambian la generación: un sonido que termina de cargar tarde (ya se
 * contestó o se rechazó) se descarga solo.
 */
import { Vibration } from 'react-native';
import { Audio } from 'expo-av';

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

export async function sonarTimbre() {
  callarTimbre();
  const mia = gen;
  // La vibración primero: si el sonido tarda en cargar (o el teléfono está en silencio), igual se siente.
  try {
    Vibration.vibrate([0, 700, 1300], true);
  } catch {
    /* sin vibración */
  }
  try {
    const { sound } = await Audio.Sound.createAsync(require('../../assets/llamada/timbre.wav'), { isLooping: true, volume: 1, shouldPlay: true });
    if (mia !== gen) return void descargar(sound);
    sonido = sound;
  } catch {
    /* sin sonido, la pantalla y la vibración bastan */
  }
}

export function callarTimbre() {
  gen++;
  try {
    Vibration.cancel();
  } catch {
    /* */
  }
  const s = sonido;
  sonido = null;
  if (s) void descargar(s);
}
