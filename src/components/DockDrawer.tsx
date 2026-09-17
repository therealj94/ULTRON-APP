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
  AudioLines,
} from 'lucide-react';
import { playSfx } from '../utils/audio';

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
  { label: 'Foto', cmd: 'toma una foto' },
  { label: 'Web', cmd: 'revisar página web con playwright' },
  { label: 'Visión', cmd: 'analizar imagen o video con visión' },
  { label: 'Orden', cmd: 'consultar cerebro de orden global' },
  { label: 'Hola', cmd: 'hola ultron saluda' },
  { label: 'Normal', cmd: 'normalizar sistemas' },
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

  return (
    <div
      id="ultron-dock-drawer"
      className={`absolute left-0 right-0 bottom-0 z-30 transition-transform duration-300 ease-out px-3 pb-4 pt-2 ${
        isOpen ? 'translate-y-0' : 'translate-y-[115%] pointer-events-none'
      }`}
    >
      <div className="ui-dock max-w-3xl mx-auto p-4 flex flex-col gap-4">
        {/* Hardware */}
        <div>
          <div className="ui-section-label mb-2">Hardware</div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button type="button" id="dock-btn-mic" className={`ui-icon-btn ${micEnabled ? 'ui-icon-btn--on' : ''}`} onClick={onToggleMic} title="Micrófono">
              {micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>
            <button type="button" id="dock-btn-speaker" className={`ui-icon-btn ${speakerEnabled ? 'ui-icon-btn--on' : ''}`} onClick={onToggleSpeaker} title="Voz">
              {speakerEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <button type="button" id="dock-btn-vision" className={`ui-icon-btn ${visionEnabled ? 'ui-icon-btn--on' : ''}`} onClick={onToggleVision} title="Cámara">
              <Eye className="w-5 h-5" />
            </button>
            <button type="button" id="dock-btn-sleep" className={`ui-icon-btn ${isSleeping ? 'ui-icon-btn--on' : ''}`} onClick={onToggleSleep} title="Reposo">
              {isSleeping ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button type="button" id="dock-btn-frame" className={`ui-icon-btn ${isKioskFrame ? 'ui-icon-btn--on' : ''}`} onClick={onToggleKioskFrame} title="Kiosk">
              <Smartphone className="w-5 h-5" />
            </button>
            {onToggleVisor && (
              <button type="button" id="dock-btn-visor" className={`ui-icon-btn ${hasVisor ? 'ui-icon-btn--on' : ''}`} onClick={onToggleVisor} title="Visor">
                <Glasses className="w-5 h-5" />
              </button>
            )}
            {onResetToNormal && (
              <button type="button" className="ui-icon-btn" onClick={onResetToNormal} title="Normalizar">
                <RotateCcw className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Tools grid — keep all tools, clearer icons */}
        <div>
          <div className="ui-section-label mb-2">Herramientas</div>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1">
            {onOpenAgenticHarness && (
              <button type="button" id="dock-btn-harness" className="ui-tool" onClick={onOpenAgenticHarness}>
                <div className="ui-tool__icon"><Cpu className="w-4 h-4" /></div>
                <span>Harness</span>
              </button>
            )}
            {onOpenVoices && (
              <button type="button" className="ui-tool" onClick={onOpenVoices}>
                <div className="ui-tool__icon"><AudioLines className="w-4 h-4" /></div>
                <span>Voces</span>
              </button>
            )}
            {onOpenVault && (
              <button type="button" id="dock-btn-vault" className="ui-tool" onClick={onOpenVault}>
                <div className="ui-tool__icon"><ShieldCheck className="w-4 h-4" /></div>
                <span>Bóveda</span>
              </button>
            )}
            {onOpenCameraCountdown && (
              <button type="button" className="ui-tool" onClick={onOpenCameraCountdown}>
                <div className="ui-tool__icon"><Camera className="w-4 h-4" /></div>
                <span>Foto</span>
              </button>
            )}
            {onOpenPlaywrightBrowser && (
              <button type="button" className="ui-tool" onClick={onOpenPlaywrightBrowser}>
                <div className="ui-tool__icon"><Globe className="w-4 h-4" /></div>
                <span>Web</span>
              </button>
            )}
            {onOpenVisionAnalyzer && (
              <button type="button" className="ui-tool" onClick={onOpenVisionAnalyzer}>
                <div className="ui-tool__icon"><Eye className="w-4 h-4" /></div>
                <span>Visión</span>
              </button>
            )}
            {onOpenGlobalOrderBrain && (
              <button type="button" className="ui-tool" onClick={onOpenGlobalOrderBrain}>
                <div className="ui-tool__icon"><BookOpen className="w-4 h-4" /></div>
                <span>Orden</span>
              </button>
            )}
            {onOpenCloudModal && (
              <button type="button" className="ui-tool" onClick={onOpenCloudModal}>
                <div className="ui-tool__icon"><Cloud className="w-4 h-4" /></div>
                <span>Cloud</span>
              </button>
            )}
            {onOpenBiometric && (
              <button type="button" className="ui-tool" onClick={onOpenBiometric}>
                <div className="ui-tool__icon"><Fingerprint className="w-4 h-4" /></div>
                <span>Acceso</span>
              </button>
            )}
            {onOpenPhotos && (
              <button type="button" className="ui-tool" onClick={onOpenPhotos}>
                <div className="ui-tool__icon"><Camera className="w-4 h-4" /></div>
                <span>Galería</span>
              </button>
            )}
            {onTriggerWave && (
              <button type="button" className="ui-tool" onClick={onTriggerWave}>
                <div className="ui-tool__icon"><Hand className="w-4 h-4" /></div>
                <span>Saludo</span>
              </button>
            )}
            {onTriggerDrink && (
              <button type="button" className="ui-tool" onClick={onTriggerDrink}>
                <div className="ui-tool__icon"><Coffee className="w-4 h-4" /></div>
                <span>Bebida</span>
              </button>
            )}
            {onTriggerCombat && (
              <button type="button" className="ui-tool" onClick={onTriggerCombat}>
                <div className="ui-tool__icon"><Zap className="w-4 h-4" /></div>
                <span>Blaster</span>
              </button>
            )}
            {onOpenTutorial && (
              <button type="button" className="ui-tool" onClick={onOpenTutorial}>
                <div className="ui-tool__icon"><HelpCircle className="w-4 h-4" /></div>
                <span>Guía</span>
              </button>
            )}
          </div>
        </div>

        {/* Quick chips */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {QUICK_COMMANDS.map((item) => (
            <button
              key={item.cmd}
              type="button"
              className="ui-chip whitespace-nowrap"
              onClick={() => {
                playSfx('tap', soundFxEnabled);
                onSubmitCommand(item.cmd);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Command line */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Orden para ULTRON…"
            className="flex-1 rounded-xl bg-black/40 border border-[var(--line)] px-4 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] font-body"
          />
          <button
            type="submit"
            className="rounded-xl px-4 py-2.5 bg-[var(--accent)] text-[var(--bg-0)] font-display font-bold text-xs tracking-wider flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            ENVIAR
          </button>
        </form>
      </div>
    </div>
  );
};
