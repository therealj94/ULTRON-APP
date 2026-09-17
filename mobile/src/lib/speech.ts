import { useEffect } from 'react';

type ResultEv = { results?: Array<{ transcript?: string }>; transcript?: string; isFinal?: boolean };
type ErrorEv = { error?: string };

let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEventImpl: any = null;

try {
  // Optional native module — present in EAS builds with the config plugin
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEventImpl = mod.useSpeechRecognitionEvent;
} catch {
  /* module not linked */
}

export async function ensureSpeechPermissions(): Promise<boolean> {
  try {
    if (!ExpoSpeechRecognitionModule?.requestPermissionsAsync) return true;
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return Boolean(result.granted);
  } catch {
    return false;
  }
}

export function startListening(opts?: { lang?: string; continuous?: boolean }) {
  try {
    ExpoSpeechRecognitionModule?.start?.({
      lang: opts?.lang || 'es-ES',
      interimResults: true,
      continuous: opts?.continuous ?? true,
      addsPunctuation: false,
    });
  } catch {
    /* */
  }
}

export function stopListening() {
  try {
    ExpoSpeechRecognitionModule?.stop?.();
  } catch {
    /* */
  }
}

export function abortListening() {
  try {
    ExpoSpeechRecognitionModule?.abort?.();
  } catch {
    /* */
  }
}

export function useSpeechRecognitionEvent(
  event: 'result' | 'start' | 'end' | 'error',
  cb: (ev: any) => void
) {
  if (useSpeechRecognitionEventImpl) {
    useSpeechRecognitionEventImpl(event, cb);
    return;
  }
  // no-op hook when module missing
  useEffect(() => {
    /* unavailable */
  }, [event, cb]);
}

export type { ResultEv, ErrorEv };
