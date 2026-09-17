import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent };

export async function ensureSpeechPermissions(): Promise<boolean> {
  try {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return Boolean(result.granted);
  } catch {
    return false;
  }
}

export function startListening(opts?: { lang?: string; continuous?: boolean }) {
  try {
    ExpoSpeechRecognitionModule.start({
      lang: opts?.lang || 'es-ES',
      interimResults: true,
      continuous: opts?.continuous ?? true,
      addsPunctuation: false,
    });
  } catch {
    /* module may be unavailable in Expo Go */
  }
}

export function stopListening() {
  try {
    ExpoSpeechRecognitionModule.stop();
  } catch {
    /* */
  }
}

export function abortListening() {
  try {
    ExpoSpeechRecognitionModule.abort();
  } catch {
    /* */
  }
}
