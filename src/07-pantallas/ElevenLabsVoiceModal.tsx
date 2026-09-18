import React, { useState } from 'react';
import { Volume2, Mic, Play, Check, Sparkles, Sliders, X, Key } from 'lucide-react';
import { ElevenLabsVoiceConfig } from '../types';
import { DEFAULT_ELEVENLABS_VOICES, speakWithElevenLabsOrFallback } from '../03-voz/elevenlabs';

interface ElevenLabsVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeVoice: ElevenLabsVoiceConfig;
  onSelectVoice: (voice: ElevenLabsVoiceConfig) => void;
}

export const ElevenLabsVoiceModal: React.FC<ElevenLabsVoiceModalProps> = ({
  isOpen,
  onClose,
  activeVoice,
  onSelectVoice,
}) => {
  const [voices, setVoices] = useState<ElevenLabsVoiceConfig[]>(DEFAULT_ELEVENLABS_VOICES);
  const [apiKey, setApiKey] = useState<string>(activeVoice.apiKey || '');
  const [isPlayingId, setIsPlayingId] = useState<string | null>(null);
  const [testSampleText, setTestSampleText] = useState('Sesión de junta directiva iniciada. Soy Ultron, su asistente cibernético.');

  if (!isOpen) return null;

  const handleTestVoice = async (voice: ElevenLabsVoiceConfig) => {
    setIsPlayingId(voice.voiceId);
    await speakWithElevenLabsOrFallback(
      testSampleText,
      { ...voice, apiKey },
      {
        onEnd: () => setIsPlayingId(null),
        onError: () => setIsPlayingId(null),
      }
    );
  };

  const handleSaveAndApply = (voice: ElevenLabsVoiceConfig) => {
    const updated = { ...voice, apiKey };
    onSelectVoice(updated);
  };

  return (
    <div
      id="ultron-elevenlabs-modal"
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-2xl bg-[#05080c] border border-[#05E1FF]/40 rounded-2xl p-6 shadow-[0_0_35px_rgba(5,225,255,0.25)] flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#05E1FF]/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#05E1FF]/10 border border-[#05E1FF]/30 flex items-center justify-center text-[#05E1FF]">
              <Volume2 className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] font-mono tracking-[0.25em] text-[#8FA3B0] block uppercase">
                MOTOR NEURAL SINTETIZADOR · ELEVENLABS
              </span>
              <h2 className="font-display font-bold text-lg text-[#05E1FF] tracking-wider">
                CATÁLOGO DE VOCES NEURALES
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-[#8FA3B0] hover:text-[#05E1FF] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* API Key Banner */}
        <div className="p-3.5 rounded-xl bg-black/60 border border-[#05E1FF]/30 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono text-white">
              <Key className="w-4 h-4 text-[#05E1FF]" />
              <span>CLAVE API DE ELEVENLABS (OPCIONAL)</span>
            </div>
            <span className="text-[10px] font-mono text-[#00FF88]">
              {apiKey ? 'API KEY CONFIGURADA' : 'MODO EMULACIÓN ACTIVO'}
            </span>
          </div>
          <input
            type="password"
            placeholder="xi-api-key (Si está vacío, se emula la voz neural localmente)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="p-2 rounded bg-black/80 border border-white/10 text-white font-mono text-xs focus:border-[#05E1FF] outline-none"
          />
        </div>

        {/* Voices List */}
        <div className="flex flex-col gap-2.5">
          <span className="text-xs font-mono text-[#8FA3B0] tracking-wider uppercase">
            SELECCIONE LA VOZ DE ULTRON ({voices.length} OPCIONES DISPONIBLES)
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {voices.map((v) => {
              const isSelected = activeVoice.voiceId === v.voiceId;
              const isPlaying = isPlayingId === v.voiceId;

              return (
                <div
                  key={v.voiceId}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#05E1FF]/10 border-[#05E1FF] shadow-[0_0_20px_rgba(5,225,255,0.2)]'
                      : 'bg-black/40 border-white/10 hover:border-white/30'
                  }`}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-display font-semibold text-white text-sm">
                        {v.name}
                      </span>
                      {isSelected && (
                        <span className="px-2 py-0.5 rounded-full bg-[#05E1FF]/20 text-[#05E1FF] text-[9px] font-mono font-bold flex items-center gap-1">
                          <Check className="w-3 h-3" /> ACTIVA
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-[#05E1FF]">{v.category}</span>
                    <p className="text-xs text-[#8FA3B0] font-mono leading-relaxed mt-0.5">
                      {v.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => handleTestVoice(v)}
                      disabled={isPlaying}
                      className="flex-1 py-1.5 px-2.5 rounded bg-white/10 hover:bg-[#05E1FF]/20 text-white hover:text-[#05E1FF] text-xs font-mono transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Play className={`w-3 h-3 ${isPlaying ? 'animate-spin' : ''}`} />
                      {isPlaying ? 'REPRODUCIENDO...' : 'PROBAR VOZ'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSaveAndApply(v)}
                      className={`py-1.5 px-3 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#05E1FF] text-black'
                          : 'bg-white/5 hover:bg-[#05E1FF]/20 text-white'
                      }`}
                    >
                      SELECCIONAR
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-[#05E1FF]/20">
          <span className="text-[11px] font-mono text-[#8FA3B0]">
            Sintetizador adaptable con modulación de pitch y velocidad de lectura
          </span>
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 rounded-lg bg-[#05E1FF]/20 border border-[#05E1FF]/50 text-[#05E1FF] hover:bg-[#05E1FF]/30 font-display font-semibold text-xs tracking-wider transition-all cursor-pointer"
          >
            GUARDAR Y CERRAR
          </button>
        </div>
      </div>
    </div>
  );
};
