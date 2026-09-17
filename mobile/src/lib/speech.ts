/** Speech recognition layer — optional native module; text composer always works. */

type SpeechHandlers = {
  onResult?: (ev: { transcript: string; isFinal: boolean }) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (msg: string) => void;
};

let handlers: SpeechHandlers = {};

export function setSpeechHandlers(h: SpeechHandlers) {
  handlers = h;
}

export async function ensureSpeechPermissions(): Promise<boolean> {
  // OS RECORD_AUDIO is requested in App boot; no extra module required
  return true;
}

export function startListening(_opts?: { lang?: string; continuous?: boolean }) {
  handlers.onError?.(
    'Reconocimiento de voz nativo se activará en el próximo build con el módulo de speech. Usa el teclado por ahora.'
  );
}

export function stopListening() {
  /* no-op */
}

export function abortListening() {
  /* no-op */
}

/** Compatibility shim used by DeskScreen (replaces expo-speech-recognition hook). */
export function useSpeechRecognitionEvent(
  _event: 'result' | 'start' | 'end' | 'error',
  _cb: (ev: any) => void
) {
  // no native module in this build — events won't fire
}
