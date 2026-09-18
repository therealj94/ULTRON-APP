let current: HTMLAudioElement | null = null;
let abortCtl: AbortController | null = null;
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaElementAudioSourceNode | null = null;
let lipTimer: number | null = null;
let queue: Blob[] = [];
let lipCb: ((n: number) => void) | null = null;

export function onLip(cb: ((n: number) => void) | null) {
  lipCb = cb;
}

export function stopVoice() {
  abortCtl?.abort();
  abortCtl = null;
  queue = [];
  if (lipTimer) {
    clearInterval(lipTimer);
    lipTimer = null;
  }
  lipCb?.(0);
  if (current) {
    current.pause();
    current.src = '';
    current = null;
  }
}

/** Baja volumen y para. Evita el corte a cuchillo del barge-in. */
export function fadeStopVoice(ms = 160) {
  const a = current;
  abortCtl?.abort();
  abortCtl = null;
  queue = [];
  if (!a) {
    stopVoice();
    return;
  }
  const start = a.volume;
  const t0 = performance.now();
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0) / ms);
    a.volume = Math.max(0, start * (1 - p));
    if (p < 1) requestAnimationFrame(tick);
    else stopVoice();
  };
  requestAnimationFrame(tick);
}

function ensureAnalyser(audio: HTMLAudioElement) {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(ctx.destination);
  } catch {
    analyser = null;
  }
}

function startLip() {
  if (lipTimer) clearInterval(lipTimer);
  const data = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
  lipTimer = window.setInterval(() => {
    if (!analyser) {
      lipCb?.(current && !current.paused ? 0.35 : 0);
      return;
    }
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    lipCb?.(Math.min(1, rms * 4));
  }, 40);
}

function playNext(onAllEnd?: () => void, onError?: () => void) {
  const blob = queue.shift();
  if (!blob) {
    lipCb?.(0);
    onAllEnd?.();
    return;
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  current = audio;
  ensureAnalyser(audio);
  audio.onplaying = () => startLip();
  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (current === audio) current = null;
    playNext(onAllEnd, onError);
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    if (current === audio) current = null;
    onError?.();
  };
  return audio.play();
}

export function playFile(src: string, onEnd?: () => void, onError?: () => void) {
  stopVoice();
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.playsInline = true;
  current = audio;
  try { ensureAnalyser(audio); } catch { /* */ }
  audio.onplaying = () => startLip();
  audio.onended = () => {
    if (current === audio) current = null;
    lipCb?.(0);
    onEnd?.();
  };
  audio.onerror = () => {
    if (current === audio) current = null;
    onError?.();
  };
  return audio.play().catch(() => onError?.());
}

export function playWavBlob(blob: Blob, onEnd?: () => void, onError?: () => void) {
  queue = [blob];
  if (current) {
    current.pause();
    current.src = '';
    current = null;
  }
  return playNext(onEnd, onError);
}

export function enqueueWav(blob: Blob) {
  queue.push(blob);
  if (!current) playNext();
}

export function newTtsAbort() {
  abortCtl?.abort();
  abortCtl = new AbortController();
  return abortCtl;
}

export function ttsSignal() {
  return abortCtl?.signal;
}
