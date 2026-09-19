import React, { useState } from 'react';
import { X, Volume2, Sparkles, Shield, ShieldCheck, Fingerprint, Camera, Wand2, BookOpen, Smile, Trash2 } from 'lucide-react';
import type { Mode, FaceState } from '../types';
import { playSfx } from '../03-voz/audio';
import { Capacidades } from './Capacidades';

interface Props {
  isOpen: boolean;
  currentMode: Mode;
  currentFace: FaceState;
  soundFxEnabled: boolean;
  speakerEnabled: boolean;
  funMode: boolean;
  usuario: { name: string; authenticated: boolean };
  onClose: () => void;
  onSelectMode: (mode: Mode) => void;
  onSelectFace: (face: FaceState) => void;
  onToggleSoundFx: () => void;
  onToggleSpeaker: () => void;
  onToggleFunMode: () => void;
  onOpenAcceso: () => void;
  onOpenVault: () => void;
  onOpenPhotos: () => void;
  onProbarVoz: () => void;
  onEjemplo: (cmd: string) => void;
  onOlvidar: () => void;
}

const MODOS: Array<{ id: Mode; label: string; desc: string }> = [
  { id: 'GUARDIAN', label: 'Guardián', desc: 'Firme, protege a la junta' },
  { id: 'EXPLORER', label: 'Explorador', desc: 'Curioso, pregunta más' },
  { id: 'GOLD', label: 'Oro', desc: 'Cálido, metal y bóveda' },
  { id: 'MINING', label: 'Minería', desc: 'Seco, operativo' },
  { id: 'ANALYTICAL', label: 'Analítico', desc: 'Preciso, cifras y fuentes' },
  { id: 'STRATEGIC', label: 'Estratégico', desc: 'Bajo, piensa a largo' },
  { id: 'CREATIVE', label: 'Creativo', desc: 'Juguetón, propone' },
];

const CARAS: FaceState[] = ['IDLE', 'HAPPY', 'LAUGH', 'SURPRISED', 'CURIOSITY', 'THINKING', 'CONCERNED', 'SAD', 'ANGRY', 'TIRED', 'PURR', 'WINK', 'SING', 'SLEEPING'];

type Tab = 'capacidades' | 'personalidad' | 'sistema';

export const SettingsSheet: React.FC<Props> = (p) => {
  const [tab, setTab] = useState<Tab>('capacidades');
  const Tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'capacidades', label: 'Qué puede hacer', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'personalidad', label: 'Personalidad', icon: <Smile className="w-3.5 h-3.5" /> },
    { id: 'sistema', label: 'Sistema', icon: <Shield className="w-3.5 h-3.5" /> },
  ];
  return (
    <div
      id="ultron-settings-sheet"
      className={`absolute left-0 right-0 top-0 z-30 transition-transform duration-300 ease-out px-4 pt-4 pb-6 bg-gradient-to-b from-black via-black/97 to-black/80 border-b border-[#05E1FF]/20 max-h-[88vh] overflow-y-auto ${
        p.isOpen ? 'translate-y-0' : '-translate-y-[115%] pointer-events-none'
      }`}
    >
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-[#05E1FF]/20 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#05E1FF] animate-pulse" />
            <h2 className="font-display font-bold tracking-[0.25em] text-[#05E1FF] text-base">AJUSTES · ULTRON FP</h2>
          </div>
          <button type="button" onClick={p.onClose} className="p-1 rounded text-[#8FA3B0] hover:text-[#05E1FF] cursor-pointer" aria-label="Cerrar ajustes">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-1 rounded-lg bg-black/50 p-1 border border-[#05E1FF]/20 text-xs font-mono">
          {Tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                tab === t.id ? 'bg-[#05E1FF]/20 text-[#05E1FF] border border-[#05E1FF]/40' : 'text-[#8FA3B0] hover:text-white'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {tab === 'capacidades' && <Capacidades onEjemplo={(c) => { p.onClose(); p.onEjemplo(c); }} onProbarVoz={p.onProbarVoz} />}

        {tab === 'personalidad' && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-display tracking-[0.2em] text-[#8FA3B0]">MODO DE PERSONALIDAD</span>
                <span className="text-[10px] text-[#8FA3B0]/70 font-mono">activo: {p.currentMode}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {MODOS.map((m) => {
                  const on = p.currentMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { playSfx('mode', p.soundFxEnabled); p.onSelectMode(m.id); }}
                      className={`p-2.5 rounded-xl border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                        on ? 'border-[#05E1FF] bg-[#05E1FF]/15 text-[#05E1FF] shadow-[0_0_10px_rgba(5,225,255,0.2)]' : 'border-white/10 bg-black/40 text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF]/50'
                      }`}
                    >
                      <span className="font-display font-bold text-xs tracking-wider">{m.label}</span>
                      <span className="text-[10px] text-[#8FA3B0]">{m.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-display tracking-[0.2em] text-[#8FA3B0]">EXPRESIONES (probar)</span>
                <span className="text-[10px] text-[#8FA3B0]/70 font-mono">{p.currentFace}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CARAS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { playSfx('tap', p.soundFxEnabled); p.onSelectFace(c); }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono border transition-all cursor-pointer ${
                      p.currentFace === c ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF]' : 'border-white/10 bg-black/40 text-[#8FA3B0] hover:text-[#05E1FF]'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-black/40 cursor-pointer">
              <span className="flex items-center gap-2 text-xs font-mono text-[#dff8ff]">
                <Wand2 className="w-4 h-4 text-[#05E1FF]" /> Modo diversión (blasters, sable, visor, coronas de modo)
              </span>
              <input type="checkbox" checked={p.funMode} onChange={p.onToggleFunMode} className="accent-[#05E1FF]" />
            </label>
          </div>
        )}

        {tab === 'sistema' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button type="button" onClick={() => { p.onClose(); p.onOpenAcceso(); }} className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-mono cursor-pointer ${p.usuario.authenticated ? 'border-[#00FF88]/40 bg-[#00FF88]/10 text-[#00FF88]' : 'border-[#05E1FF]/40 bg-[#05E1FF]/10 text-[#05E1FF]'}`}>
                {p.usuario.authenticated ? <ShieldCheck className="w-4 h-4" /> : <Fingerprint className="w-4 h-4" />}
                <span>{p.usuario.authenticated ? `Sesión: ${p.usuario.name}` : 'Entrar a la junta'}</span>
              </button>
              <button type="button" onClick={() => { p.onClose(); p.onOpenVault(); }} className="p-3 rounded-xl border border-[#05E1FF]/30 bg-black/60 text-[#dff8ff] hover:border-[#05E1FF] flex items-center gap-2 text-xs font-mono cursor-pointer">
                <ShieldCheck className="w-4 h-4 text-[#05E1FF]" /> Bóveda de claves
              </button>
              <button type="button" onClick={() => { p.onClose(); p.onOpenPhotos(); }} className="p-3 rounded-xl border border-[#05E1FF]/30 bg-black/60 text-[#dff8ff] hover:border-[#05E1FF] flex items-center gap-2 text-xs font-mono cursor-pointer">
                <Camera className="w-4 h-4 text-[#05E1FF]" /> Fotos
              </button>
            </div>
            <div className="flex items-center gap-5 pt-2 border-t border-[#05E1FF]/15 text-xs text-[#8FA3B0]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={p.soundFxEnabled} onChange={p.onToggleSoundFx} className="accent-[#05E1FF]" />
                <span className="flex items-center gap-1 font-mono text-[11px]"><Volume2 className="w-3.5 h-3.5" /> Efectos</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={p.speakerEnabled} onChange={p.onToggleSpeaker} className="accent-[#05E1FF]" />
                <span className="flex items-center gap-1 font-mono text-[11px]"><Sparkles className="w-3.5 h-3.5" /> Voz</span>
              </label>
              <button type="button" onClick={p.onOlvidar} className="ml-auto flex items-center gap-1 font-mono text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" /> Borrar conversación y memoria local
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
