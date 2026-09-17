// ElevenLabs — 4 voces de escritorio ULTRON FP (siempre vía proxy servidor)
import { ElevenLabsVoiceConfig } from '../types';

/** Frases cortas de sistema: Web Speech local (ahorra tokens ElevenLabs). */
const LOCAL_SYSTEM_PHRASES = new Set(
  [
    'modo stay',
    'modo explore',
    'modo sleep',
    'ultron listo',
    'te escucho',
    'escuchando',
    'listo',
    'ok',
  ].map((s) => s.toLowerCase())
);

export function isLocalSystemPhrase(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!…]+$/g, '');
  if (t.length <= 28 && LOCAL_SYSTEM_PHRASES.has(t)) return true;
  if (/^(modo\s+\w+|hola\s+\w+|ultron\s+listo)/i.test(t) && t.split(/\s+/).length <= 4) {
    return true;
  }
  return false;
}

/** Habla local (sin ElevenLabs) para confirmaciones cortas. */
export function speakLocalSystem(
  text: string,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (err: unknown) => void;
  }
): void {
  stopCurrentVoice();
  const gen = speakGeneration;
  const clean = text.trim();
  if (!clean) {
    callbacks?.onEnd?.();
    return;
  }
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    callbacks?.onEnd?.();
    return;
  }
  callbacks?.onStart?.();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = 'es-ES';
  utterance.rate = 1.02;
  utterance.pitch = 0.85;
  const voices = window.speechSynthesis.getVoices();
  const matched =
    voices.find((v) => v.lang.startsWith('es')) || voices[0];
  if (matched) utterance.voice = matched;
  utterance.onend = () => {
    if (gen === speakGeneration) callbacks?.onEnd?.();
  };
  utterance.onerror = (e) => {
    callbacks?.onError?.(e);
    if (gen === speakGeneration) callbacks?.onEnd?.();
  };
  window.speechSynthesis.speak(utterance);
}

/** Voces ULTRON FP (JARVIS default). voiceId = id Qwen3-TTS; ElevenLabs solo fallback. */
export const DEFAULT_ELEVENLABS_VOICES: ElevenLabsVoiceConfig[] = [
  {
    voiceId: 'jarvis',
    name: 'JARVIS',
    category: 'Principal',
    description: 'Formal, calmado, elegante. Voz por defecto.',
    stability: 0.62,
    similarityBoost: 0.82,
    pitch: 0.9,
    rate: 0.96,
    apiKey: '',
  },
  {
    voiceId: 'formal',
    name: 'FORMAL',
    category: 'Junta',
    description: 'Institucional y seria para la junta directiva.',
    stability: 0.7,
    similarityBoost: 0.85,
    pitch: 0.92,
    rate: 0.95,
    apiKey: '',
  },
  {
    voiceId: 'tierna',
    name: 'TIERNA',
    category: 'Cálida',
    description: 'Suave y amigable — cara luminosa de ULTRON.',
    stability: 0.55,
    similarityBoost: 0.78,
    pitch: 1.05,
    rate: 0.98,
    apiKey: '',
  },
  {
    voiceId: 'estrategia',
    name: 'ESTRATEGIA',
    category: 'Analítica',
    description: 'Precisa para reportes y Cerebro de Orden Global.',
    stability: 0.68,
    similarityBoost: 0.8,
    pitch: 0.88,
    rate: 0.98,
    apiKey: '',
  },
  {
    voiceId: 'orbita',
    name: 'ÓRBITA',
    category: 'Exploradora',
    description: 'Curiosa y ligera para modos creativos.',
    stability: 0.6,
    similarityBoost: 0.8,
    pitch: 1.0,
    rate: 1.0,
    apiKey: '',
  },
];

let currentAudio: HTMLAudioElement | null = null;
let speakGeneration = 0;

export function stopCurrentVoice(): void {
  speakGeneration += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

async function playBlob(
  blob: Blob,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (err: unknown) => void;
  },
  gen?: number
): Promise<void> {
  callbacks?.onStart?.();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      if (gen === undefined || gen === speakGeneration) callbacks?.onEnd?.();
      resolve();
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      callbacks?.onError?.(e);
      reject(e);
    };
    audio.play().catch(reject);
  });
}

/**
 * Siempre intenta ElevenLabs (proxy servidor con ELEVENLABS_API_KEY).
 * Solo cae a Web Speech si el nodo de voz falla.
 */
export async function speakWithElevenLabsOrFallback(
  text: string,
  config: ElevenLabsVoiceConfig,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (err: unknown) => void;
  },
  opts?: { forceEleven?: boolean }
): Promise<void> {
  stopCurrentVoice();
  const gen = speakGeneration;
  const clean = text.trim();
  if (!clean) {
    callbacks?.onEnd?.();
    return;
  }

  // Confirmaciones cortas → voz local (ahorra tokens)
  if (!opts?.forceEleven && isLocalSystemPhrase(clean)) {
    speakLocalSystem(clean, callbacks);
    return;
  }

  // 1) API unificada: Qwen3-TTS (T4) → ElevenLabs → …
  try {
    const ttsRes = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        voice: config.voiceId,
      }),
    });
    if (ttsRes.ok) {
      const contentType = ttsRes.headers.get('content-type') || '';
      if (contentType.includes('audio')) {
        await playBlob(await ttsRes.blob(), callbacks, gen);
        return;
      }
    }
  } catch (err) {
    console.warn('[ULTRON TTS]', err);
  }

  // 2) Legacy proxy bóveda (también intenta Qwen3 luego ElevenLabs)
  try {
    const proxyRes = await fetch('/api/vault/elevenlabs/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        voice: config.voiceId,
        voiceId: config.voiceId,
        stability: config.stability,
        similarityBoost: config.similarityBoost,
        apiKeyOverride: config.apiKey || undefined,
      }),
    });

    if (proxyRes.ok) {
      const contentType = proxyRes.headers.get('content-type') || '';
      if (contentType.includes('audio')) {
        await playBlob(await proxyRes.blob(), callbacks, gen);
        return;
      }
    }
  } catch (err) {
    console.warn('[ElevenLabs proxy]', err);
  }

  // 3) Fallback Web Speech
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    callbacks?.onStart?.();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'es-ES';
    utterance.pitch = config.pitch;
    utterance.rate = config.rate;
    const voices = window.speechSynthesis.getVoices();
    const matched =
      voices.find((v) => v.lang.startsWith('es') && /jorge|diego|pablo|monica|helena/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith('es'));
    if (matched) utterance.voice = matched;
    utterance.onend = () => {
      if (gen === speakGeneration) callbacks?.onEnd?.();
    };
    utterance.onerror = (e) => {
      callbacks?.onError?.(e);
      if (gen === speakGeneration) callbacks?.onEnd?.();
    };
    window.speechSynthesis.speak(utterance);
    return;
  }

  callbacks?.onEnd?.();
}
