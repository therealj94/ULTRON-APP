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
export function setSfxEnabled(on: boolean) {
  sfxEnabled = on;
}

export function playSfx(name: SfxName) {
  if (!sfxEnabled) return;
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
