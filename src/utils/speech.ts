// Speech Synthesis & Recognition for ULTRON FP Board Assistant
// Features barge-in interruption detection, Spanish neural voices, and continuous conversational listening.

import { stopCurrentVoice } from './elevenlabs';

export function cancelSpeech(): void {
  stopCurrentVoice();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function speakUtterance(
  text: string,
  options?: {
    enabled?: boolean;
    onStart?: () => void;
    onEnd?: () => void;
  }
): void {
  if (options?.enabled === false) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    options?.onEnd?.();
    return;
  }

  cancelSpeech();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  utterance.rate = 0.96;
  utterance.pitch = 0.72; // Deep, institutional, dry cyber tone

  // Try to find a natural Spanish voice if available
  const voices = window.speechSynthesis.getVoices();
  const spanishVoice = voices.find(
    (v) =>
      v.lang.startsWith('es') &&
      (v.name.includes('Natural') ||
        v.name.includes('Google') ||
        v.name.includes('Microsoft') ||
        v.name.includes('Jorge') ||
        v.name.includes('Paulina'))
  ) || voices.find((v) => v.lang.startsWith('es'));

  if (spanishVoice) {
    utterance.voice = spanishVoice;
  }

  if (options?.onStart) utterance.onstart = options.onStart;
  if (options?.onEnd) utterance.onend = options.onEnd;
  utterance.onerror = () => options?.onEnd?.();

  window.speechSynthesis.speak(utterance);
}

// Browser Web Speech Recognition with Barge-in Interruption Support
export interface SpeechRecognizerHandle {
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export function initSpeechRecognizer(
  onResult: (text: string, isFinal: boolean) => void,
  onBargeIn?: () => void,
  onEnd?: () => void,
  onError?: (err: unknown) => void
): SpeechRecognizerHandle | null {
  if (typeof window === 'undefined') return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognitionClass) return null;

  try {
    const recognition = new SpeechRecognitionClass();
    recognition.lang = 'es-HN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    let isManuallyStopped = false;

    // Barge-in: The moment the user produces speech, signal interruption immediately!
    recognition.onspeechstart = () => {
      onBargeIn?.();
    };

    recognition.onsoundstart = () => {
      onBargeIn?.();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      // Whenever speech input arrives, trigger barge-in if agent is speaking
      onBargeIn?.();

      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        const transcript = item[0]?.transcript || '';
        if (item.isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (final.trim()) {
        onResult(final.trim(), true);
      } else if (interim.trim()) {
        onResult(interim.trim(), false);
      }
    };

    recognition.onend = () => {
      if (!isManuallyStopped) {
        // Auto-restart for continuous ambient listening
        try {
          recognition.start();
        } catch {
          onEnd?.();
        }
      } else {
        onEnd?.();
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (err: any) => {
      if (err.error !== 'no-speech') {
        onError?.(err);
      }
      if (err.error === 'not-allowed') {
        isManuallyStopped = true;
      }
    };

    return {
      start: () => {
        isManuallyStopped = false;
        try {
          recognition.start();
        } catch {
          // Already running
        }
      },
      stop: () => {
        isManuallyStopped = true;
        try {
          recognition.stop();
        } catch {
          // Ignore
        }
      },
      abort: () => {
        isManuallyStopped = true;
        try {
          recognition.abort();
        } catch {
          // Ignore
        }
      },
    };
  } catch {
    return null;
  }
}
