import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Eye,
  Moon,
  Sun,
  Smartphone,
  Send,
  Sparkles,
  Cpu,
  Glasses,
  Fingerprint,
  Camera,
  Coffee,
  Hand,
  Zap,
  ShieldCheck,
  Globe,
  BookOpen,
  Cloud,
  HelpCircle,
  RotateCcw,
} from 'lucide-react';
import { playSfx } from '../03-voz/audio';

interface DockDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  micEnabled: boolean;
  speakerEnabled: boolean;
  visionEnabled: boolean;
  isSleeping: boolean;
  isKioskFrame: boolean;
  soundFxEnabled: boolean;
  hasVisor?: boolean;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onToggleVision: () => void;
  onToggleSleep: () => void;
  onToggleKioskFrame: () => void;
  onToggleVisor?: () => void;
  onOpenAgenticHarness?: () => void;
  onOpenBiometric?: () => void;
  onOpenPhotos?: () => void;
  onOpenVoices?: () => void;
  onOpenVault?: () => void;
  onOpenTutorial?: () => void;
  onResetToNormal?: () => void;
  onOpenCloudModal?: () => void;
  onOpenCameraCountdown?: () => void;
  onOpenVisionAnalyzer?: () => void;
  onOpenPlaywrightBrowser?: () => void;
  onOpenGlobalOrderBrain?: () => void;
  onTriggerDrink?: () => void;
  onTriggerWave?: () => void;
  onTriggerCombat?: () => void;
  onSubmitCommand: (cmd: string) => void;
}

const QUICK_COMMANDS = [
  { label: 'Oro', cmd: 'precio del oro hoy' },
  { label: 'Plata', cmd: 'precio de la plata' },
  { label: 'Lempira', cmd: 'lempira a dólar' },
  { label: 'Qué ves', cmd: 'qué ves en la cámara' },
  { label: 'Saludo', cmd: 'hola ultron' },
];

export const DockDrawer: React.FC<DockDrawerProps> = ({
  isOpen,
  micEnabled,
  speakerEnabled,
  visionEnabled,
  isSleeping,
  isKioskFrame,
  soundFxEnabled,
  hasVisor = false,
  onToggleMic,
  onToggleSpeaker,
  onToggleVision,
  onToggleSleep,
  onToggleKioskFrame,
  onToggleVisor,
  onOpenAgenticHarness,
  onOpenBiometric,
  onOpenPhotos,
  onOpenVoices,
  onOpenVault,
  onOpenTutorial,
  onResetToNormal,
  onOpenCloudModal,
  onOpenCameraCountdown,
  onOpenVisionAnalyzer,
  onOpenPlaywrightBrowser,
  onOpenGlobalOrderBrain,
  onTriggerDrink,
  onTriggerWave,
  onTriggerCombat,
  onSubmitCommand,
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    playSfx('tap', soundFxEnabled);
    onSubmitCommand(inputValue.trim());
    setInputValue('');
  };

  const handleChipClick = (cmd: string) => {
    playSfx('tap', soundFxEnabled);
    onSubmitCommand(cmd);
  };

  return (
    <div
      id="ultron-dock-drawer"
      className={`absolute left-0 right-0 bottom-0 z-30 transition-transform duration-300 ease-out px-4 pb-5 pt-3 bg-gradient-to-t from-black via-black/95 to-transparent ${
        isOpen ? 'translate-y-0' : 'translate-y-[115%] pointer-events-none'
      }`}
    >
      <div className="max-w-2xl mx-auto flex flex-col gap-3">
        {/* Primary Hardware Controls */}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            id="dock-btn-mic"
            onClick={onToggleMic}
            title={micEnabled ? 'Micrófono activo (escuchando)' : 'Micrófono silenciado'}
            className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer ${
              micEnabled
                ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF] shadow-[0_0_12px_rgba(5,225,255,0.4)]'
                : 'border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF]'
            }`}
          >
            {micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          <button
            type="button"
            id="dock-btn-speaker"
            onClick={onToggleSpeaker}
            title={speakerEnabled ? 'Voz sintética activa' : 'Voz silenciada'}
            className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer ${
              speakerEnabled
                ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF] shadow-[0_0_12px_rgba(5,225,255,0.4)]'
                : 'border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF]'
            }`}
          >
            {speakerEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          <button
            type="button"
            id="dock-btn-vision"
            onClick={onToggleVision}
            title={visionEnabled ? 'Visor de seguimiento biométrico activo' : 'Activar cámara / tracking'}
            className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer ${
              visionEnabled
                ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF] shadow-[0_0_12px_rgba(5,225,255,0.4)]'
                : 'border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF]'
            }`}
          >
            <Eye className="w-5 h-5" />
          </button>

          <button
            type="button"
            id="dock-btn-sleep"
            onClick={onToggleSleep}
            title={isSleeping ? 'Despertar ULTRON' : 'Poner en reposo'}
            className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer ${
              isSleeping
                ? 'border-[#FFB648] bg-[#FFB648]/20 text-[#FFB648]'
                : 'border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF]'
            }`}
          >
            {isSleeping ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          <button
            type="button"
            id="dock-btn-frame"
            onClick={onToggleKioskFrame}
            title="Alternar vista soporte de mesa (Stand) / Kiosk pantalla completa"
            className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer ${
              isKioskFrame
                ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF]'
                : 'border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF]'
            }`}
          >
            <Smartphone className="w-5 h-5" />
          </button>

          {onToggleVisor && (
            <button
              type="button"
              id="dock-btn-visor"
              onClick={onToggleVisor}
              title={hasVisor ? 'Quitar visor óptico' : 'Equipar visor óptico'}
              className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer ${
                hasVisor
                  ? 'border-[#FF3B5C] bg-[#FF3B5C]/20 text-[#FF3B5C] shadow-[0_0_12px_rgba(255,59,92,0.4)]'
                  : 'border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#FF3B5C]'
              }`}
            >
              <Glasses className="w-5 h-5" />
            </button>
          )}

          {onOpenVault && (
            <button
              type="button"
              id="dock-btn-vault"
              onClick={onOpenVault}
              title="Bóveda Central de APIs · ULTRON FP"
              className="w-11 h-11 rounded-full flex items-center justify-center border border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF] shadow-[0_0_12px_rgba(5,225,255,0.4)] hover:scale-105 transition-all cursor-pointer"
            >
              <ShieldCheck className="w-5 h-5" />
            </button>
          )}

          {onOpenAgenticHarness && (
            <button
              type="button"
              id="dock-btn-harness"
              onClick={onOpenAgenticHarness}
              title="Núcleo de Inteligencia y Modos Semánticos"
              className="w-11 h-11 rounded-full flex items-center justify-center border border-[#05E1FF]/40 bg-[#05E1FF]/10 text-[#05E1FF] hover:border-[#05E1FF] hover:bg-[#05E1FF]/20 transition-all cursor-pointer"
            >
              <Cpu className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Secondary Executive Action Toolbar */}
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          {onResetToNormal && (
            <button
              type="button"
              onClick={onResetToNormal}
              className="px-3 py-1.5 rounded-full border border-emerald-400/50 bg-emerald-400/15 text-emerald-400 hover:bg-emerald-400/25 text-xs font-display font-bold tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-[0_0_10px_rgba(52,211,153,0.2)]"
              title="Restaurar a estado normal y disarmar cualquier sistema de defensa"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>NORMALIZAR</span>
            </button>
          )}

          {onOpenTutorial && (
            <button
              type="button"
              onClick={onOpenTutorial}
              className="px-3 py-1.5 rounded-full border border-[#05E1FF]/50 bg-[#05E1FF]/15 text-[#05E1FF] hover:bg-[#05E1FF]/25 text-xs font-display font-bold tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-[0_0_10px_rgba(5,225,255,0.2)]"
              title="Abrir guía de uso y tutorial de botones"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>GUÍA & TUTORIAL</span>
            </button>
          )}

          {onOpenVault && (
            <button
              type="button"
              onClick={onOpenVault}
              className="px-3 py-1.5 rounded-full border border-[#05E1FF] bg-[#05E1FF]/15 text-[#05E1FF] hover:bg-[#05E1FF]/25 text-xs font-display font-bold tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-[0_0_10px_rgba(5,225,255,0.25)]"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>BÓVEDA DE APIS</span>
            </button>
          )}

          {onOpenCameraCountdown && (
            <button
              type="button"
              onClick={onOpenCameraCountdown}
              className="px-3 py-1.5 rounded-full border border-[#05E1FF]/40 bg-[#05E1FF]/10 text-[#05E1FF] hover:bg-[#05E1FF]/20 text-xs font-display font-medium tracking-wide flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Cámara 3-2-1</span>
            </button>
          )}

          {onOpenPlaywrightBrowser && (
            <button
              type="button"
              onClick={onOpenPlaywrightBrowser}
              className="px-3 py-1.5 rounded-full border border-[#05E1FF]/40 bg-[#05E1FF]/10 text-[#05E1FF] hover:bg-[#05E1FF]/20 text-xs font-display font-medium tracking-wide flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Explorador Web</span>
            </button>
          )}

          {onOpenVisionAnalyzer && (
            <button
              type="button"
              onClick={onOpenVisionAnalyzer}
              className="px-3 py-1.5 rounded-full border border-[#00FFA3]/40 bg-[#00FFA3]/10 text-[#00FFA3] hover:bg-[#00FFA3]/20 text-xs font-display font-medium tracking-wide flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Visión Neural</span>
            </button>
          )}

          {onOpenGlobalOrderBrain && (
            <button
              type="button"
              onClick={onOpenGlobalOrderBrain}
              className="px-3 py-1.5 rounded-full border border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542] hover:bg-[#F5C542]/20 text-xs font-display font-medium tracking-wide flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Doctrinas</span>
            </button>
          )}

          {onOpenBiometric && (
            <button
              type="button"
              onClick={onOpenBiometric}
              className="px-3 py-1.5 rounded-full border border-[#00FFA3]/40 bg-[#00FFA3]/10 text-[#00FFA3] hover:bg-[#00FFA3]/20 text-xs font-display font-medium tracking-wide flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Fingerprint className="w-3.5 h-3.5" />
              <span>Biometría</span>
            </button>
          )}

          {onTriggerDrink && (
            <button
              type="button"
              onClick={onTriggerDrink}
              className="px-3 py-1.5 rounded-full border border-[#00FFA3]/40 bg-[#00FFA3]/10 text-[#00FFA3] hover:bg-[#00FFA3]/20 text-xs font-display font-medium tracking-wide flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Coffee className="w-3.5 h-3.5" />
              <span>Bebida</span>
            </button>
          )}

          {onTriggerWave && (
            <button
              type="button"
              onClick={onTriggerWave}
              className="px-3 py-1.5 rounded-full border border-[#FFD800]/40 bg-[#FFD800]/10 text-[#FFD800] hover:bg-[#FFD800]/20 text-xs font-display font-medium tracking-wide flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Hand className="w-3.5 h-3.5" />
              <span>Saludo</span>
            </button>
          )}

          {onTriggerCombat && (
            <button
              type="button"
              onClick={onTriggerCombat}
              className="px-3 py-1.5 rounded-full border border-red-500/50 bg-red-500/15 text-red-400 hover:bg-red-500/25 text-xs font-display font-medium tracking-wide flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Blaster</span>
            </button>
          )}

          {onOpenVoices && (
            <button
              type="button"
              onClick={onOpenVoices}
              className="px-3 py-1.5 rounded-full border border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542] hover:bg-[#F5C542]/20 text-xs font-display font-medium tracking-wide flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Voces</span>
            </button>
          )}
        </div>

        {/* Quick Prompt Chips (Professional Clean Design) */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {QUICK_COMMANDS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => handleChipClick(chip.cmd)}
              className="text-xs px-3 py-1 rounded-md border border-[#05E1FF]/25 bg-black/50 text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF] hover:bg-[#05E1FF]/10 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer font-mono"
            >
              <Sparkles className="w-3 h-3 text-[#05E1FF]" />
              <span>{chip.label}</span>
            </button>
          ))}
        </div>

        {/* Command Input Form */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            id="dock-cmd-input"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Escribe o dicta una instrucción ejecutiva (ej: toma una foto, abre la bóveda, revisa la web)..."
            autoComplete="off"
            className="flex-1 bg-[#05080c] border border-[#05E1FF]/30 text-[#05E1FF] placeholder-[#8FA3B0]/50 text-xs font-mono px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#05E1FF] focus:shadow-[0_0_12px_rgba(5,225,255,0.25)] transition-all"
          />
          <button
            type="submit"
            id="dock-btn-submit"
            className="bg-[#05E1FF] text-[#001418] font-display font-bold text-xs tracking-wider px-5 py-2.5 rounded-lg hover:bg-[#05E1FF]/90 transition-all active:scale-95 shadow-[0_0_15px_rgba(5,225,255,0.3)] flex items-center gap-1.5 cursor-pointer uppercase"
          >
            <Send className="w-3.5 h-3.5" />
            <span>EJECUTAR</span>
          </button>
        </form>
      </div>
    </div>
  );
};
