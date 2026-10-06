import { Audio } from 'expo-av';

const SOURCES = {
  tap: require('../../assets/sfx/tap.mp3'),
  blaster: require('../../assets/sfx/blaster.mp3'),
  saber: require('../../assets/sfx/saber.mp3'),
  purr: require('../../assets/sfx/purr.mp3'),
  giggle: require('../../assets/sfx/giggle.mp3'),
  wink: require('../../assets/sfx/wink.mp3'),
  boing: require('../../assets/sfx/boing.mp3'),
  whoosh: require('../../assets/sfx/whoosh.mp3'),
} as const;

export type SfxName = keyof typeof SOURCES;

const pool = new Map<SfxName, Audio.Sound>();
let ready = false;

export async function preloadSfx() {
  if (ready || enLlamada) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
      allowsRecordingIOS: true,
    });
    await Promise.all(
      (Object.keys(SOURCES) as SfxName[]).map(async (name) => {
        const { sound } = await Audio.Sound.createAsync(SOURCES[name], { shouldPlay: false, volume: 0.85 });
        pool.set(name, sound);
      })
    );
    ready = true;
  } catch {
    /* assets missing on old APK — ignore */
  }
}

let sfxEnabled = true;
export function setSfxEnabled(on: boolean) {
  sfxEnabled = on;
}
/** ¿Los sonidos de la app están activados (ajuste «sonidos») y no hay una llamada de PULSE2CHAT? */
export function sfxActivos(): boolean {
  return sfxEnabled && !enLlamada;
}

/** En una llamada no suena ningún efecto (ni la risita de la compañera): el audio es de la llamada. */
let enLlamada = false;
export function suspenderSfx(on: boolean) {
  enLlamada = on;
}

/**
 * Un clip de voz corto por el canal de efectos (las muletillas, lib/asentir.ts): no pasa por la voz de la mesa
 * (lib/tts), así que no cuenta como «AU-RA hablando», no pausa el micrófono, no mueve la boca ni queda en lo dicho.
 * No depende del ajuste «Efectos de sonido» (es su voz, no un efecto), pero en una llamada no suena.
 */
export type ClipEfecto = { sound: Audio.Sound; ms: number };

/** Carga un clip (archivo del teléfono) a `volumen`; null si no carga o no se sabe cuánto dura. */
export async function cargarClipEfecto(uri: string, volumen: number): Promise<ClipEfecto | null> {
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false, volume: volumen });
    const ms = status.isLoaded ? status.durationMillis || 0 : 0;
    if (!ms) {
      void sound.unloadAsync().catch(() => {});
      return null;
    }
    return { sound, ms };
  } catch {
    return null;
  }
}

/** Lo hace sonar desde el principio. false si no puede sonar ahora (una llamada). */
export function sonarClipEfecto(c: ClipEfecto): boolean {
  if (enLlamada) return false;
  void (async () => {
    try {
      await c.sound.setPositionAsync(0);
      await c.sound.playAsync();
    } catch {
      /* */
    }
  })();
  return true;
}

/** Lo calla si estaba sonando (empieza a hablar AU-RA). */
export function callarClipEfecto(c: ClipEfecto) {
  void c.sound.stopAsync().catch(() => {});
}

export function soltarClipEfecto(c: ClipEfecto) {
  void c.sound.unloadAsync().catch(() => {});
}

export function playSfx(name: SfxName) {
  if (!sfxEnabled || enLlamada) return;
  const s = pool.get(name);
  if (!s) {
    void (async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(SOURCES[name], { shouldPlay: true, volume: 0.9 });
        sound.setOnPlaybackStatusUpdate((st) => {
          if (st.isLoaded && st.didJustFinish) void sound.unloadAsync();
        });
      } catch {
        /* */
      }
    })();
    return;
  }
  void (async () => {
    try {
      await s.setPositionAsync(0);
      await s.playAsync();
    } catch {
      /* */
    }
  })();
}
