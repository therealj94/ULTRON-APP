let current: HTMLAudioElement | null = null;
let abortCtl: AbortController | null = null;
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaElementAudioSourceNode | null = null;
let lipTimer: number | null = null;
let queue: Blob[] = [];
let lipCb: ((n: number) => void) | null = null;
/** El «terminé» pendiente del audio que suena: si se corta, se avisa igual para que la cola no se trabe. */
let alCortar: (() => void) | null = null;

export function onLip(cb: ((n: number) => void) | null) {
  lipCb = cb;
}

let desbloqueado = false;
/** true después del primer gesto del usuario (los navegadores no dejan sonar nada antes). */
export function audioDesbloqueado() {
  return desbloqueado;
}

/** Llamar dentro de un gesto del usuario: crea/reanuda el AudioContext para que el lip-sync y el audio suenen. */
export function desbloquearAudio() {
  desbloqueado = true;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* sin WebAudio: el audio igual suena por el <audio> */
  }
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
  soltarActual();
}

/**
 * Corta el audio actual sin disparar sus manejadores: vaciar `src` con onerror puesto hacía que la
 * frase cortada se dijera con la voz del navegador, o que su `fin` nunca resolviera.
 */
function soltarActual() {
  const a = current;
  const fin = alCortar;
  current = null;
  alCortar = null;
  if (a) {
    a.onplaying = null;
    a.onended = null;
    a.onerror = null;
    a.pause();
    a.removeAttribute('src');
    try {
      a.load();
    } catch {
      /* */
    }
  }
  fin?.();
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
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(ctx.destination);
    }
    try {
      source?.disconnect();
    } catch {
      /* */
    }
    source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
  } catch {
    /* sin analizador: la boca usa un nivel fijo */
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

function playNext(onAllEnd?: () => void, onError?: () => void, onStart?: () => void) {
  const blob = queue.shift();
  if (!blob) {
    alCortar = null;
    lipCb?.(0);
    onAllEnd?.();
    return;
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.setAttribute('playsinline', 'true');
  current = audio;
  alCortar = onAllEnd || null;
  ensureAnalyser(audio);
  audio.onplaying = () => {
    startLip();
    onStart?.();
  };
  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (current === audio) current = null;
    playNext(onAllEnd, onError);
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    if (current === audio) {
      current = null;
      alCortar = null;
    }
    onError?.();
  };
  return audio.play();
}

export function playFile(src: string, onEnd?: () => void, onError?: () => void, onStart?: () => void) {
  stopVoice();
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.setAttribute('playsinline', 'true');
  current = audio;
  alCortar = onEnd || null;
  try { ensureAnalyser(audio); } catch { /* */ }
  audio.onplaying = () => {
    startLip();
    onStart?.();
  };
  audio.onended = () => {
    if (current === audio) {
      current = null;
      alCortar = null;
    }
    lipCb?.(0);
    onEnd?.();
  };
  audio.onerror = () => {
    if (current === audio) {
      current = null;
      alCortar = null;
    }
    onError?.();
  };
  return audio.play().catch(() => onError?.());
}

export function playWavBlob(blob: Blob, onEnd?: () => void, onError?: () => void, onStart?: () => void) {
  queue = [blob];
  soltarActual();
  return playNext(onEnd, onError, onStart);
}

export function enqueueWav(blob: Blob) {
  queue.push(blob);
  if (!current) playNext();
}

export function colaVacia() {
  return !current && queue.length === 0;
}

export function newTtsAbort() {
  abortCtl?.abort();
  abortCtl = new AbortController();
  return abortCtl;
}

export function ttsSignal() {
  return abortCtl?.signal;
}
