let current: HTMLAudioElement | null = null;
let abortCtl: AbortController | null = null;

export function stopVoice() {
  abortCtl?.abort();
  abortCtl = null;
  if (current) {
    current.pause();
    current.src = '';
    current = null;
  }
}

export function playWavBlob(blob: Blob, onEnd?: () => void, onError?: () => void) {
  stopVoice();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  current = audio;
  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (current === audio) current = null;
    onEnd?.();
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    if (current === audio) current = null;
    onError?.();
  };
  return audio.play();
}

export function newTtsAbort() {
  abortCtl?.abort();
  abortCtl = new AbortController();
  return abortCtl;
}

export function ttsSignal() {
  return abortCtl?.signal;
}
