import React from 'react';
import { Mode, FaceState } from '../types';
import { Shield, Pickaxe, Award, Lightbulb, BarChart3, Castle, Compass, Radio, Cpu, Download, X, Volume2, Sparkles, Fingerprint, ShieldCheck, Camera } from 'lucide-react';
import { playSfx } from '../03-voz/audio';

interface SettingsSheetProps {
  isOpen: boolean;
  currentMode: Mode;
  currentFace: FaceState;
  soundFxEnabled: boolean;
  speakerEnabled: boolean;
  onClose: () => void;
  onSelectMode: (mode: Mode) => void;
  onSelectFace: (face: FaceState) => void;
  onToggleSoundFx: () => void;
  onToggleSpeaker: () => void;
  onOpenBackendBridge: () => void;
  onOpenAndroidBlueprint: () => void;
  onDownloadSimulator: () => void;
  onOpenBiometric?: () => void;
  onOpenVoices?: () => void;
  onOpenVault?: () => void;
  onOpenPhotos?: () => void;
}

const MODES_CONFIG: Array<{ id: Mode; label: string; desc: string; icon: React.ReactNode; color: string }> = [
  { id: 'GUARDIAN', label: 'GUARDIAN', desc: 'Escudos y candados perimetrales', icon: <Shield className="w-4 h-4" />, color: '#05E1FF' },
  { id: 'MINING', label: 'MINING', desc: 'Engranaje de extracción y pico', icon: <Pickaxe className="w-4 h-4" />, color: '#05E1FF' },
  { id: 'GOLD', label: 'GOLD', desc: 'Lingote y aura dorada', icon: <Award className="w-4 h-4" />, color: '#F5C542' },
  { id: 'CREATIVE', label: 'CREATIVE', desc: 'Bombilla, vector y cromática', icon: <Lightbulb className="w-4 h-4" />, color: '#05E1FF' },
  { id: 'ANALYTICAL', label: 'ANALYTICAL', desc: 'Lupa ocular y crestas de datos', icon: <BarChart3 className="w-4 h-4" />, color: '#05E1FF' },
  { id: 'STRATEGIC', label: 'STRATEGIC', desc: 'Caballo y torre tácticos', icon: <Castle className="w-4 h-4" />, color: '#05E1FF' },
  { id: 'EXPLORER', label: 'EXPLORER', desc: 'Telescopio y rosa náutica', icon: <Compass className="w-4 h-4" />, color: '#05E1FF' },
];

const EMOTIONS_LIST: FaceState[] = [
  'IDLE',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'HAPPY',
  'CONCERNED',
  'ANGRY',
  'FURY',
  'SLEEPING',
  'STARTLE',
  'PURR',
  'WINK',
  'CURIOSITY',
  'JEDI',
];

export const SettingsSheet: React.FC<SettingsSheetProps> = ({
  isOpen,
  currentMode,
  currentFace,
  soundFxEnabled,
  speakerEnabled,
  onClose,
  onSelectMode,
  onSelectFace,
  onToggleSoundFx,
  onToggleSpeaker,
  onOpenBackendBridge,
  onOpenAndroidBlueprint,
  onDownloadSimulator,
  onOpenBiometric,
  onOpenVoices,
  onOpenVault,
  onOpenPhotos,
}) => {
  const handleModeClick = (mode: Mode) => {
    playSfx('mode', soundFxEnabled);
    onSelectMode(mode);
    onClose(); // Automatically closes sheet to reveal the transformed face
  };

  const handleFaceClick = (face: FaceState) => {
    playSfx('tap', soundFxEnabled);
    onSelectFace(face);
    onClose(); // Automatically closes sheet
  };

  return (
    <div
      id="ultron-settings-sheet"
      className={`absolute left-0 right-0 top-0 z-30 transition-transform duration-300 ease-out px-4 pt-4 pb-6 bg-gradient-to-b from-black via-black/95 to-transparent border-b border-[#05E1FF]/20 max-h-[82vh] overflow-y-auto ${
        isOpen ? 'translate-y-0' : '-translate-y-[115%] pointer-events-none'
      }`}
    >
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#05E1FF]/20 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#05E1FF] animate-pulse" />
            <h2 className="font-display font-bold tracking-[0.25em] text-[#05E1FF] text-base">
              AJUSTES DE SISTEMA · ULTRON FP
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#8FA3B0] hover:text-[#05E1FF] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Integration Utilities */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={onOpenBackendBridge}
            className="p-2.5 rounded border border-[#05E1FF]/40 bg-[#05E1FF]/10 text-[#05E1FF] hover:bg-[#05E1FF]/20 transition-all flex items-center justify-center gap-2 text-xs font-mono font-medium cursor-pointer"
          >
            <Radio className="w-4 h-4 text-[#05E1FF]" />
            <span>Puente WS</span>
          </button>

          {onOpenBiometric && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenBiometric();
              }}
              className="p-2.5 rounded border border-[#00FFA3]/40 bg-[#00FFA3]/10 text-[#00FFA3] hover:bg-[#00FFA3]/20 transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
            >
              <Fingerprint className="w-4 h-4 text-[#00FFA3]" />
              <span>Biométrico</span>
            </button>
          )}

          {onOpenVoices && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenVoices();
              }}
              className="p-2.5 rounded border border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542] hover:bg-[#F5C542]/20 transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
            >
              <Volume2 className="w-4 h-4 text-[#F5C542]" />
              <span>ElevenLabs</span>
            </button>
          )}

          {onOpenVault && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenVault();
              }}
              className="p-2.5 rounded border border-[#05E1FF]/40 bg-[#05E1FF]/10 text-[#05E1FF] hover:bg-[#05E1FF]/20 transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-[#05E1FF]" />
              <span>Bóveda APIs</span>
            </button>
          )}

          {onOpenPhotos && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPhotos();
              }}
              className="p-2.5 rounded border border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF] transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
            >
              <Camera className="w-4 h-4 text-[#05E1FF]" />
              <span>Fotos LOOI</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenAndroidBlueprint}
            className="p-2.5 rounded border border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF] transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
          >
            <Cpu className="w-4 h-4 text-[#05E1FF]" />
            <span>Código Android</span>
          </button>

          <button
            type="button"
            onClick={onDownloadSimulator}
            className="p-2.5 rounded border border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF] transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer col-span-2 sm:col-span-2"
          >
            <Download className="w-4 h-4 text-[#05E1FF]" />
            <span>Exportar Simulador HTML Autónomo</span>
          </button>
        </div>

        {/* Personality Modes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-display tracking-[0.2em] text-[#8FA3B0]">MODOS DE PERSONALIDAD</span>
            <span className="text-[10px] text-[#8FA3B0]/70 font-mono">Modo activo: {currentMode}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {MODES_CONFIG.map((m) => {
              const isActive = currentMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleModeClick(m.id)}
                  style={{ borderColor: isActive ? m.color : undefined }}
                  className={`p-2.5 rounded border text-left flex flex-col gap-1 transition-all ${
                    isActive
                      ? 'border-[#05E1FF] bg-[#05E1FF]/15 text-[#05E1FF] shadow-[0_0_10px_rgba(5,225,255,0.2)]'
                      : 'border-[#05E1FF]/20 bg-black/40 text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF]/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-xs tracking-wider" style={{ color: isActive ? m.color : undefined }}>
                      {m.label}
                    </span>
                    <span style={{ color: m.color }}>{m.icon}</span>
                  </div>
                  <span className="text-[10px] text-[#8FA3B0] line-clamp-1">{m.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Emotional States Test Bench */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-display tracking-[0.2em] text-[#8FA3B0]">EMULADOR DE ESTADOS / EXPRESIONES</span>
            <span className="text-[10px] text-[#8FA3B0]/70 font-mono">Estado: {currentFace}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EMOTIONS_LIST.map((emo) => {
              const isCurrent = currentFace === emo;
              return (
                <button
                  key={emo}
                  type="button"
                  onClick={() => handleFaceClick(emo)}
                  className={`px-2.5 py-1.5 rounded text-[11px] font-mono border transition-all ${
                    isCurrent
                      ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF] shadow-[0_0_8px_rgba(5,225,255,0.3)]'
                      : 'border-[#05E1FF]/20 bg-black/40 text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF]/40'
                  }`}
                >
                  {emo}
                </button>
              );
            })}
          </div>
        </div>

        {/* Audio switches & Telemetry */}
        <div className="flex items-center justify-between pt-2 border-t border-[#05E1FF]/15 text-xs text-[#8FA3B0]">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={soundFxEnabled}
                onChange={onToggleSoundFx}
                className="accent-[#05E1FF]"
              />
              <span className="flex items-center gap-1 font-mono text-[11px]">
                <Volume2 className="w-3.5 h-3.5" /> Efectos SFX
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={speakerEnabled}
                onChange={onToggleSpeaker}
                className="accent-[#05E1FF]"
              />
              <span className="flex items-center gap-1 font-mono text-[11px]">
                <Sparkles className="w-3.5 h-3.5" /> Voz Síntesis
              </span>
            </label>
          </div>

          <div className="text-[10px] font-mono text-[#8FA3B0]/60 hidden sm:block">
            DESK KIOSK · 100% VECTORIAL
          </div>
        </div>
      </div>
    </div>
  );
};
