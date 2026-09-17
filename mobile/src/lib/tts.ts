import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import { synthesizeTts } from './api';

let sound: Audio.Sound | null = null;
let gen = 0;

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63];
    out += chars[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? chars[triple & 63] : '=';
  }
  return out;
}

export async function stopSpeaking() {
  gen += 1;
  try {
    Speech.stop();
  } catch {
    /* */
  }
  if (sound) {
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      /* */
    }
    sound = null;
  }
}

function isShortSystem(text: string) {
  const t = text.trim().toLowerCase().replace(/[.!…]+$/g, '');
  return t.length <= 32 && /^(ok|listo|te escucho|escuchando|ultron listo|modo\s+\w+)/i.test(t);
}

export async function speak(
  text: string,
  opts?: {
    voiceId?: string;
    onStart?: () => void;
    onEnd?: () => void;
  }
) {
  const clean = text.replace(/\[[^\]]+\]/g, '').trim();
  if (!clean) {
    opts?.onEnd?.();
    return;
  }
  await stopSpeaking();
  const my = gen;
  opts?.onStart?.();

  const finish = () => {
    if (my === gen) opts?.onEnd?.();
  };

  if (isShortSystem(clean)) {
    Speech.speak(clean, {
      language: 'es-ES',
      pitch: 0.9,
      rate: 1.0,
      onDone: finish,
      onStopped: finish,
      onError: finish,
    });
    return;
  }

  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {
    /* */
  }

  const buf = await synthesizeTts({ text: clean, voiceId: opts?.voiceId });
  if (my !== gen) return;

  if (buf && buf.byteLength > 64) {
    try {
      const b64 = bytesToBase64(buf);
      const path = `${FileSystem.cacheDirectory}ultron-tts-${Date.now()}.audio`;
      await FileSystem.writeAsStringAsync(path, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (sound) await sound.unloadAsync().catch(() => {});
      const { sound: s } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
      sound = s;
      s.setOnPlaybackStatusUpdate((st) => {
        if (!st.isLoaded) return;
        if (st.didJustFinish) {
          void s.unloadAsync();
          if (sound === s) sound = null;
          finish();
        }
      });
      return;
    } catch {
      /* local fallback */
    }
  }

  Speech.speak(clean, {
    language: 'es-ES',
    pitch: 0.92,
    rate: 0.98,
    onDone: finish,
    onStopped: finish,
    onError: finish,
  });
}
