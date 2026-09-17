import React from 'react';
import { Mode, FaceState } from '../types';
import {
  Shield,
  Pickaxe,
  Award,
  Lightbulb,
  BarChart3,
  Castle,
  Compass,
  Radio,
  Cpu,
  Download,
  X,
  Volume2,
  Sparkles,
  Fingerprint,
  ShieldCheck,
  Camera,
  LogOut,
  BookOpen,
  HeartHandshake,
  Eye,
  EyeOff,
} from 'lucide-react';
import { playSfx } from '../utils/audio';
import { EXPERT_MODE_PROMPTS } from '../utils/expertModes';

interface SettingsSheetProps {
  isOpen: boolean;
  currentMode: Mode;
  currentFace: FaceState;
  soundFxEnabled: boolean;
  speakerEnabled: boolean;
  currentUser?: { name: string; role: string; correo?: string; authenticated: boolean };
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
  onLogout?: () => void;
  onStartConocer?: () => void;
  onRefreshTtsNode?: () => void;
  onOpenTutorial?: () => void;
  ttsNodeInfo?: {
    state?: string;
    publicIp?: string | null;
    suggestedUltronTtsUrl?: string | null;
    error?: string;
    proxyConfigured?: boolean;
  } | null;
}

const MODE_ICONS: Record<Mode, React.ReactNode> = {
  GUARDIAN: <Shield className="w-4 h-4" />,
  MINING: <Pickaxe className="w-4 h-4" />,
  GOLD: <Award className="w-4 h-4" />,
  CREATIVE: <Lightbulb className="w-4 h-4" />,
  ANALYTICAL: <BarChart3 className="w-4 h-4" />,
  STRATEGIC: <Castle className="w-4 h-4" />,
  EXPLORER: <Compass className="w-4 h-4" />,
  CONOCER: <HeartHandshake className="w-4 h-4" />,
};

const EMOTIONS_LIST: FaceState[] = [
  'IDLE',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'HAPPY',
  'WINK',
  'YAWNING',
  'CONCERNED',
  'CONFUSED',
  'ANGRY',
  'FURY',
  'SLEEPING',
  'MUSIC',
  'SCAN',
  'OFFLINE',
  'STARTLE',
];

export const SettingsSheet: React.FC<SettingsSheetProps> = ({
  isOpen,
  currentMode,
  currentFace,
  soundFxEnabled,
  speakerEnabled,
  currentUser,
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
  onLogout,
  onStartConocer,
  onRefreshTtsNode,
  onOpenTutorial,
  ttsNodeInfo,
}) => {
  const [showSavedClave, setShowSavedClave] = React.useState(false);
  const savedClave = React.useMemo(() => {
    try {
      const raw = localStorage.getItem('ultron_fp_saved_creds');
      if (!raw) return '';
      return (JSON.parse(raw) as { clave?: string }).clave || '';
    } catch {
      return '';
    }
  }, [isOpen]);

  const handleModeClick = (mode: Mode) => {
    playSfx('mode', soundFxEnabled);
    onSelectMode(mode);
    onClose();
  };

  const handleFaceClick = (face: FaceState) => {
    playSfx('tap', soundFxEnabled);
    onSelectFace(face);
    onClose();
  };

  return (
    <div
      id="ultron-settings-sheet"
      className={`absolute left-0 right-0 top-0 z-30 transition-transform duration-300 ease-out px-4 pt-4 pb-6 bg-gradient-to-b from-black via-black/95 to-transparent border-b border-[#00E5FF]/20 max-h-[82vh] overflow-y-auto ${
        isOpen ? 'translate-y-0' : '-translate-y-[115%] pointer-events-none'
      }`}
    >
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-[#00E5FF]/20 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00E5FF] animate-pulse" />
            <h2 className="font-display font-bold tracking-[0.25em] text-[#00E5FF] text-base">
              AJUSTES DE SISTEMA · ULTRON FP
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[#8FA3B0] hover:text-[#00E5FF] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="rounded-xl border border-[#00E5FF]/25 bg-black/50 p-3 space-y-2">
          <div className="text-xs font-display tracking-[0.2em] text-[#8FA3B0]">
            SESIÓN · ultron.ordenglobal.link
          </div>
          <div className="text-sm text-white font-mono">
            {currentUser?.authenticated
              ? `${currentUser.name} · ${currentUser.correo || 'sin correo'}`
              : 'Sin sesión activa'}
          </div>
          {savedClave ? (
            <div className="flex items-center gap-2 text-[11px] font-mono text-[#8FA3B0]">
              <span>Clave guardada:</span>
              <span className="text-[#00E5FF]">{showSavedClave ? savedClave : '••••••••'}</span>
              <button type="button" className="text-[#00E5FF]" onClick={() => setShowSavedClave((v) => !v)}>
                {showSavedClave ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-[#8FA3B0]">No hay clave guardada en este dispositivo.</div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {onOpenTutorial && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTutorial();
                }}
                className="px-3 py-1.5 rounded-lg border border-[#00E5FF]/40 bg-[#00E5FF]/10 text-[#00E5FF] text-xs font-mono flex items-center gap-1.5"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Tutorial
              </button>
            )}
            {onStartConocer && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartConocer();
                }}
                className="px-3 py-1.5 rounded-lg border border-pink-400/40 bg-pink-500/10 text-pink-200 text-xs font-mono flex items-center gap-1.5"
              >
                <HeartHandshake className="w-3.5 h-3.5" />
                Conocerme
              </button>
            )}
            {onLogout && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="px-3 py-1.5 rounded-lg border border-red-400/40 bg-red-500/10 text-red-200 text-xs font-mono flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                Cerrar sesión
              </button>
            )}
          </div>
        </div>

        {/* Nodo TTS T4 */}
        <div className="rounded-xl border border-[#F5C542]/25 bg-black/50 p-3 space-y-2">
          <div className="text-xs font-display tracking-[0.2em] text-[#8FA3B0]">
            QWEN3-TTS · T4 dedicada
          </div>
          <div className="text-[11px] font-mono text-[#8FA3B0] space-y-1">
            <div>
              Estado:{' '}
              <span className="text-[#F5C542]">
                {ttsNodeInfo?.state || (ttsNodeInfo?.error ? 'sin AWS env' : '—')}
              </span>
            </div>
            <div>IP: {ttsNodeInfo?.publicIp || '—'}</div>
            <div className="break-all">
              URL:{' '}
              <span className="text-[#00E5FF]">
                {ttsNodeInfo?.suggestedUltronTtsUrl ||
                  (ttsNodeInfo?.proxyConfigured ? 'proxy configurado' : 'ULTRON_TTS_URL pendiente')}
              </span>
            </div>
            {ttsNodeInfo?.error && <div className="text-amber-300">{ttsNodeInfo.error}</div>}
          </div>
          {onRefreshTtsNode && (
            <button
              type="button"
              onClick={onRefreshTtsNode}
              className="px-3 py-1.5 rounded-lg border border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542] text-xs font-mono"
            >
              Consultar / arrancar T4
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={onOpenBackendBridge}
            className="p-2.5 rounded border border-[#00E5FF]/40 bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF]/20 transition-all flex items-center justify-center gap-2 text-xs font-mono font-medium cursor-pointer"
          >
            <Radio className="w-4 h-4" />
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
              <Fingerprint className="w-4 h-4" />
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
              <Volume2 className="w-4 h-4" />
              <span>Voces</span>
            </button>
          )}

          {onOpenVault && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenVault();
              }}
              className="p-2.5 rounded border border-[#00E5FF]/40 bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF]/20 transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Bóveda</span>
            </button>
          )}

          {onOpenPhotos && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPhotos();
              }}
              className="p-2.5 rounded border border-[#00E5FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#00E5FF] hover:border-[#00E5FF] transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
            >
              <Camera className="w-4 h-4 text-[#00E5FF]" />
              <span>Fotos</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenAndroidBlueprint}
            className="p-2.5 rounded border border-[#00E5FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#00E5FF] hover:border-[#00E5FF] transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
          >
            <Cpu className="w-4 h-4 text-[#00E5FF]" />
            <span>Android</span>
          </button>

          <button
            type="button"
            onClick={onDownloadSimulator}
            className="p-2.5 rounded border border-[#00E5FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#00E5FF] hover:border-[#00E5FF] transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer col-span-2"
          >
            <Download className="w-4 h-4 text-[#00E5FF]" />
            <span>Exportar Simulador HTML</span>
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-display tracking-[0.2em] text-[#8FA3B0]">MODOS EXPERTO</span>
            <span className="text-[10px] text-[#00E5FF]/70 font-mono flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> cada modo = papel de experto
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.keys(EXPERT_MODE_PROMPTS) as Mode[]).map((id) => {
              const meta = EXPERT_MODE_PROMPTS[id];
              const active = currentMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleModeClick(id)}
                  className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                    active
                      ? 'border-[#00E5FF] bg-[#00E5FF]/15 text-[#00E5FF]'
                      : 'border-white/10 bg-black/40 text-[#8FA3B0] hover:border-[#00E5FF]/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    {MODE_ICONS[id]}
                    <span className="text-[11px] font-bold font-mono">{meta.title}</span>
                  </div>
                  <p className="text-[10px] leading-snug opacity-80 line-clamp-2">{meta.focus}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="text-xs font-display tracking-[0.2em] text-[#8FA3B0]">EMULADOR DE ROSTRO</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EMOTIONS_LIST.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => handleFaceClick(f)}
                className={`px-2 py-1 rounded text-[10px] font-mono border cursor-pointer ${
                  currentFace === f
                    ? 'border-[#00E5FF] text-[#00E5FF] bg-[#00E5FF]/10'
                    : 'border-white/10 text-[#8FA3B0]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onToggleSoundFx}
            className="flex-1 py-2 rounded border border-white/10 text-xs font-mono text-[#8FA3B0]"
          >
            SFX: {soundFxEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={onToggleSpeaker}
            className="flex-1 py-2 rounded border border-white/10 text-xs font-mono text-[#8FA3B0]"
          >
            Voz: {speakerEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </div>
  );
};
