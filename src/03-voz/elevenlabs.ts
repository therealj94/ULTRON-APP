// ElevenLabs Voice Engine & Presets for ULTRON FP
import { ElevenLabsVoiceConfig } from '../types';

export const DEFAULT_ELEVENLABS_VOICES: ElevenLabsVoiceConfig[] = [
  {
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam
    name: 'Adam (Director Ejecutivo)',
    category: 'Executive Deep',
    description: 'Voz institucional profunda, serena y con autoridad corporativa.',
    stability: 0.65,
    similarityBoost: 0.85,
    pitch: 0.68,
    rate: 0.94,
    apiKey: '',
  },
  {
    voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel
    name: 'Rachel (Analítica & Calma)',
    category: 'Analytical Calm',
    description: 'Tono claro, preciso y estructurado para reportes y telemetría.',
    stability: 0.72,
    similarityBoost: 0.8,
    pitch: 1.05,
    rate: 0.98,
    apiKey: '',
  },
  {
    voiceId: 'ErXwobaYiN019PkySvjV', // Antoni
    name: 'Antoni (Estratégico & Firme)',
    category: 'Strategic Bold',
    description: 'Energía ejecutiva equilibrada con modulaciones tácticas.',
    stability: 0.58,
    similarityBoost: 0.82,
    pitch: 0.82,
    rate: 1.02,
    apiKey: '',
  },
  {
    voiceId: 'VR6AewLTigWG4xSOukaG', // Arnold
    name: 'Arnold (Cyber Ultron / Heavy)',
    category: 'Heavy Cyber Mecha',
    description: 'Voz de resonancia cibernética grave para órdenes de defensa.',
    stability: 0.8,
    similarityBoost: 0.9,
    pitch: 0.52,
    rate: 0.9,
    apiKey: '',
  },
  {
    voiceId: 'EXAVITQu4vr4xnSDxMaL', // Bella
    name: 'Bella (Creativa & Cálida)',
    category: 'Creative Expressive',
    description: 'Modulación amistosa, fluida e inspiradora para innovación.',
    stability: 0.5,
    similarityBoost: 0.75,
    pitch: 1.15,
    rate: 1.05,
    apiKey: '',
  },
  {
    voiceId: 'JBFqnCBsd6RMkjVDRZzb', // George
    name: 'George (Gobernanza / Formal)',
    category: 'Boardroom Formal',
    description: 'Cadencia solemne y formal para resoluciones de la junta directiva.',
    stability: 0.75,
    similarityBoost: 0.88,
    pitch: 0.78,
    rate: 0.92,
    apiKey: '',
  }
];

let currentAudio: HTMLAudioElement | null = null;

export function stopCurrentVoice(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

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

  // Try server-side synthesis proxy first (which has ELEVENLABS_API_KEY if configured in .env)
  try {
    const proxyRes = await fetch('/api/vault/elevenlabs/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceId: config.voiceId,
        stability: config.stability,
        similarityBoost: config.similarityBoost,
        apiKeyOverride: config.apiKey,
      }),
    });

    if (proxyRes.ok) {
      const contentType = proxyRes.headers.get('content-type');
      if (contentType && contentType.includes('audio')) {
        callbacks?.onStart?.();
        const blob = await proxyRes.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          currentAudio = null;
          callbacks?.onEnd?.();
        };
        audio.onerror = (e) => {
          URL.revokeObjectURL(url);
          currentAudio = null;
          callbacks?.onError?.(e);
        };

        await audio.play();
        return;
      }
    }
  } catch (err) {
    // Continue to direct client key or web speech fallback
  }

  // If user provided a real ElevenLabs API Key, make actual direct fetch
  if (config.apiKey && config.apiKey.trim().length > 10) {
    try {
      callbacks?.onStart?.();
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': config.apiKey.trim(),
          },
          body: JSON.stringify({
            text: text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: config.stability,
              similarity_boost: config.similarityBoost,
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`ElevenLabs API HTTP Error ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        callbacks?.onEnd?.();
      };
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        callbacks?.onError?.(e);
      };

      await audio.play();
      return;
    } catch (err) {
      console.warn('ElevenLabs API request failed, falling back to simulated neural acoustic speech:', err);
    }
  }

  // Fallback: Client Web Speech API configured with voice persona attributes
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    callbacks?.onStart?.();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.pitch = config.pitch;
    utterance.rate = config.rate;

    const voices = window.speechSynthesis.getVoices();
    // Prioritize natural or matching gender/profile
    const isFemale = config.pitch > 1.0;
    const matchedVoice = voices.find(v => {
      const matchLang = v.lang.startsWith('es');
      if (!matchLang) return false;
      const n = v.name.toLowerCase();
      if (isFemale) {
        return n.includes('monica') || n.includes('helena') || n.includes('paulina') || n.includes('female');
      }
      return n.includes('jorge') || n.includes('diego') || n.includes('pablo') || n.includes('natural') || n.includes('male');
    }) || voices.find(v => v.lang.startsWith('es'));

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    utterance.onend = () => callbacks?.onEnd?.();
    utterance.onerror = (e) => {
      callbacks?.onError?.(e);
      callbacks?.onEnd?.();
    };

    window.speechSynthesis.speak(utterance);
  } else {
    callbacks?.onEnd?.();
  }
}
