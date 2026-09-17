// ElevenLabs — 4 voces de escritorio LOOI (siempre vía proxy servidor)
import { ElevenLabsVoiceConfig } from '../types';

/** Voces curadas para robot de escritorio: claras, cortas, en español. */
export const DEFAULT_ELEVENLABS_VOICES: ElevenLabsVoiceConfig[] = [
  {
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam
    name: 'Nexo',
    category: 'Desk Calm',
    description: 'Asistente de mesa: grave, cercano, sin prisa. Ideal para idle y reportes.',
    stability: 0.62,
    similarityBoost: 0.82,
    pitch: 0.9,
    rate: 0.96,
    apiKey: '',
  },
  {
    voiceId: 'EXAVITQu4vr4xnSDxMaL', // Bella
    name: 'Aura',
    category: 'Warm Guide',
    description: 'Guía cálida y nítida para tutoriales, saludos y confirmaciones.',
    stability: 0.55,
    similarityBoost: 0.78,
    pitch: 1.05,
    rate: 1.0,
    apiKey: '',
  },
  {
    voiceId: 'onwK4e9ZLuTAKqWW03F9', // Daniel
    name: 'Órbita',
    category: 'Brief Crisp',
    description: 'Briefing ejecutivo: ritmo limpio, preciso, sin relleno.',
    stability: 0.7,
    similarityBoost: 0.85,
    pitch: 0.95,
    rate: 1.04,
    apiKey: '',
  },
  {
    voiceId: 'N2lVS1w4EtoT3dr4eOWO', // Callum
    name: 'Pulse',
    category: 'Alert Soft',
    description: 'Alertas y herramientas: presencia firme pero no agresiva.',
    stability: 0.68,
    similarityBoost: 0.8,
    pitch: 0.88,
    rate: 0.98,
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
  }
): Promise<void> {
  stopCurrentVoice();
  const gen = speakGeneration;
  const clean = text.trim();
  if (!clean) {
    callbacks?.onEnd?.();
    return;
  }

  // 1) Proxy servidor (clave nunca en el cliente)
  try {
    const proxyRes = await fetch('/api/vault/elevenlabs/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
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

  // 2) Clave cliente opcional (bóveda)
  if (config.apiKey && config.apiKey.trim().length >= 40) {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': config.apiKey.trim(),
          },
          body: JSON.stringify({
            text: clean,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: config.stability,
              similarity_boost: config.similarityBoost,
            },
          }),
        }
      );
      if (response.ok) {
        await playBlob(await response.blob(), callbacks, gen);
        return;
      }
    } catch (err) {
      console.warn('[ElevenLabs direct]', err);
    }
  }

  // 3) Fallback Web Speech (solo si ElevenLabs no responde)
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
