import { Audio } from 'expo-av';

const SOURCES = {
  tap: require('../../assets/sfx/tap.mp3'),
  wink: require('../../assets/sfx/wink.mp3'),
  purr: require('../../assets/sfx/purr.mp3'),
  wake: require('../../assets/sfx/wake.mp3'),
  blaster: require('../../assets/sfx/blaster.mp3'),
  saber: require('../../assets/sfx/saber.mp3'),
} as const;

/** Duración aproximada: nunca dos SFX a la vez. */
const DURATION_MS: Record<keyof typeof SOURCES, number> = { tap: 130, wink: 110, purr: 1750, wake: 240, blaster: 900, saber: 1400 };

export type SfxName = keyof typeof SOURCES;

const pool = new Map<SfxName, Audio.Sound>();
let ready = false;

export async function preloadSfx() {
  if (ready) return;
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
let busyUntil = 0;
let silencedUntil = 0;
export function setSfxEnabled(on: boolean) {
  sfxEnabled = on;
}
/** Canto en curso: sin SFX. */
export function silenceSfx(ms: number) {
  silencedUntil = Date.now() + ms;
}

export function playSfx(name: SfxName) {
  if (!sfxEnabled) return;
  const now = Date.now();
  if (now < silencedUntil || now < busyUntil) return;
  busyUntil = now + DURATION_MS[name];
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
