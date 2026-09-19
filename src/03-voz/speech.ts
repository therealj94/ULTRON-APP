import { stopCurrentVoice } from './elevenlabs';

export function cancelSpeech(): void {
  stopCurrentVoice();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function speakUtterance(
  text: string,
  options?: { enabled?: boolean; onStart?: () => void; onEnd?: () => void }
): void {
  if (options?.enabled === false) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    options?.onEnd?.();
    return;
  }
  cancelSpeech();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-MX';
  utterance.rate = 0.96;
  utterance.pitch = 0.72;
  const voices = window.speechSynthesis.getVoices();
  const spanishVoice =
    voices.find((v) => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Microsoft'))) ||
    voices.find((v) => v.lang.startsWith('es'));
  if (spanishVoice) utterance.voice = spanishVoice;
  if (options?.onStart) utterance.onstart = options.onStart;
  if (options?.onEnd) utterance.onend = options.onEnd;
  utterance.onerror = () => options?.onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export interface SpeechRecognizerHandle {
  start: () => void;
  stop: () => void;
  abort: () => void;
}

const LANGS = ['es-HN', 'es-MX', 'es-US', 'es-ES'];

export function initSpeechRecognizer(
  onResult: (text: string, isFinal: boolean) => void,
  onBargeIn?: () => void,
  onEnd?: () => void,
  onError?: (err: unknown) => void
): SpeechRecognizerHandle | null {
  if (typeof window === 'undefined') return null;
  const SpeechRecognitionClass =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognitionClass) return null;

  try {
    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.lang = LANGS[0];

    let isManuallyStopped = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFinal = '';
    let lastFinalAt = 0;
    let barged = false;
    let micStream: MediaStream | null = null;
    let langTries = 0;

    const ensureMic = async () => {
      if (micStream && micStream.getAudioTracks().some((t) => t.readyState === 'live')) return true;
      if (!navigator.mediaDevices?.getUserMedia) return true;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        return true;
      } catch {
        return false;
      }
    };

    const pick = (item: any): { text: string; conf: number } => {
      let best = { text: String(item?.[0]?.transcript || ''), conf: Number(item?.[0]?.confidence || 0) };
      const n = item?.length || 0;
      for (let i = 1; i < n; i++) {
        const c = Number(item[i]?.confidence || 0);
        if (c > best.conf) best = { text: String(item[i]?.transcript || ''), conf: c };
      }
      return best;
    };

    const scheduleRestart = (ms = 220) => {
      if (isManuallyStopped) return;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (isManuallyStopped) return;
        try {
          recognition.start();
        } catch {
          scheduleRestart(600);
        }
      }, ms);
    };

    recognition.onspeechstart = () => {
      barged = false;
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalTxt = '';
      let conf = 0;
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        const p = pick(item);
        if (item.isFinal) {
          finalTxt += p.text;
          conf = Math.max(conf, p.conf);
        } else {
          interim += p.text;
        }
      }
      const live = (finalTxt || interim).trim();
      // 3+ chars evita barge por ruido / "eh"
      if (live.length >= 3 && !barged) {
        barged = true;
        onBargeIn?.();
      }
      if (finalTxt.trim()) {
        const t = finalTxt.trim();
        const now = Date.now();
        const bajo = t.toLowerCase().replace(/[¿?¡!.,]/g, '').trim();
        const fantasma = /^(la hora|hora|ah|eh|mm+|este|este este|ok|okay)$/.test(bajo);
        if (fantasma || t.length < 3) return;
        if (t === lastFinal && now - lastFinalAt < 2500) return;
        if (conf > 0 && conf < 0.42) {
          onResult(t, false);
          return;
        }
        lastFinal = t;
        lastFinalAt = now;
        barged = false;
        onResult(t, true);
      } else if (interim.trim()) {
        onResult(interim.trim(), false);
      }
    };

    recognition.onend = () => {
      barged = false;
      if (!isManuallyStopped) scheduleRestart(180);
      else onEnd?.();
    };

    recognition.onerror = (err: any) => {
      const code = err?.error || '';
      if (code === 'not-allowed') {
        isManuallyStopped = true;
        onError?.(err);
        return;
      }
      if (code === 'language-not-supported') {
        langTries += 1;
        const i = LANGS.indexOf(recognition.lang);
        recognition.lang = LANGS[(i + 1) % LANGS.length];
        if (langTries > LANGS.length) {
          onError?.(err);
          return;
        }
      }
      if (code !== 'no-speech' && code !== 'aborted') onError?.(err);
    };

    return {
      start: () => {
        isManuallyStopped = false;
        if (restartTimer) clearTimeout(restartTimer);
        void ensureMic().then((ok) => {
          if (isManuallyStopped) return;
          if (!ok) {
            onError?.(new Error('mic-denied'));
            return;
          }
          try {
            recognition.start();
          } catch {
            scheduleRestart(300);
          }
        });
      },
      stop: () => {
        isManuallyStopped = true;
        if (restartTimer) clearTimeout(restartTimer);
        try {
          recognition.stop();
        } catch {}
      },
      abort: () => {
        isManuallyStopped = true;
        if (restartTimer) clearTimeout(restartTimer);
        try {
          recognition.abort();
        } catch {}
      },
    };
  } catch {
    return null;
  }
}
