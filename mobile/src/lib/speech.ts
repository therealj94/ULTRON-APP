/** Speech layer — text composer is primary; ASR module optional in future builds. */

import { useEffect } from 'react';

export async function ensureSpeechPermissions(): Promise<boolean> {
  return true;
}

export function startListening(_opts?: { lang?: string; continuous?: boolean }) {
  /* ASR nativo se reintroducirá cuando el módulo compile limpio en EAS */
}

export function stopListening() {}

export function abortListening() {}

export function useSpeechRecognitionEvent(
  _event: 'result' | 'start' | 'end' | 'error',
  _cb: (ev: any) => void
) {
  useEffect(() => {
    /* no-op */
  }, []);
}
