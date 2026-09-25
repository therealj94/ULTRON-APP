import { perfil as perfilActual } from '../perfil';
import React, { useState } from 'react';
import { X, Volume2, Sparkles, Shield, ShieldCheck, Fingerprint, Camera, Wand2, BookOpen, Smile, Trash2 } from 'lucide-react';
import type { Mode, FaceState } from '../types';
import { playSfx } from '../03-voz/audio';
import { Capacidades } from './Capacidades';
import { Control } from './Control';

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

/** Cómo se llama cada expresión para quien la prueba: en español, no el nombre interno. */
const NOMBRE_CARA: Partial<Record<FaceState, string>> = {
  IDLE: 'Serena', HAPPY: 'Feliz', LAUGH: 'Risa', SURPRISED: 'Sorpresa', CURIOSITY: 'Curiosa', THINKING: 'Pensando',
  CONCERNED: 'Preocupada', SAD: 'Triste', ANGRY: 'Molesta', TIRED: 'Cansada', PURR: 'Cariño', WINK: 'Traviesa',
  SING: 'Cantando', SLEEPING: 'Dormida', SPEAKING: 'Hablando', LISTENING: 'Escuchando',
};

type Tab = 'capacidades' | 'personalidad' | 'sistema' | 'control';

export const SettingsSheet: React.FC<Props> = (p) => {
  const [tab, setTab] = useState<Tab>('capacidades');
  const Tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'capacidades', label: 'Qué hace', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'personalidad', label: 'Personalidad', icon: <Smile className="w-3.5 h-3.5" /> },
    { id: 'sistema', label: 'Sistema', icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'control', label: 'Control', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  ];
  return (
    <div
      id="ultron-settings-sheet"
      className={`absolute left-0 right-0 top-0 z-30 transition-transform duration-300 ease-out px-3 pt-3 ${
        p.isOpen ? 'translate-y-0' : '-translate-y-[115%] pointer-events-none'
      }`}
    >
      <div className="max-w-3xl mx-auto flex flex-col gap-4 bg-[#232528] rounded-[28px] p-4 sm:p-5 shadow-[0_12px_40px_rgba(0,0,0,0.48)] max-h-[86vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-xl text-[#ECE8E2]">Ajustes · {perfilActual().plataforma}</h2>
          <button type="button" onClick={p.onClose} className="w-9 h-9 rounded-full bg-[#3A3C41] text-[#B9B2A8] hover:bg-[#3D3829] flex items-center justify-center cursor-pointer" aria-label="Cerrar ajustes">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-1 rounded-full bg-[#34363A] p-1 text-[13px] font-medium">
          {Tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`flex-1 py-2 rounded-full flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                tab === t.id ? 'bg-[#34363A] text-[#ECE8E2] shadow-[0_1px_4px_rgba(0,0,0,0.29)]' : 'text-[#B9B2A8] hover:text-[#ECE8E2]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {tab === 'control' && p.isOpen && <Control />}

        {tab === 'capacidades' && <Capacidades onEjemplo={(c) => { p.onClose(); p.onEjemplo(c); }} onProbarVoz={p.onProbarVoz} />}

        {tab === 'personalidad' && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#B9B2A8]">Modo de personalidad</span>
                <span className="text-[12px] text-[#8A847C]">activo: {MODOS.find((m) => m.id === p.currentMode)?.label || p.currentMode}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {MODOS.map((m) => {
                  const on = p.currentMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { playSfx('mode', p.soundFxEnabled); p.onSelectMode(m.id); }}
                      aria-pressed={on}
                      className={`p-3 rounded-2xl border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                        on ? 'border-[#D6B56C] bg-[#3D3829] text-[#ECE8E2]' : 'border-[#46484D] bg-[#34363A] text-[#ECE8E2] hover:border-[#D6B56C]'
                      }`}
                    >
                      <span className="font-semibold text-[14px]">{m.label}</span>
                      <span className="text-[12px] text-[#B9B2A8]">{m.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#B9B2A8]">Expresiones (probar)</span>
                <span className="text-[12px] text-[#8A847C]">{NOMBRE_CARA[p.currentFace] || p.currentFace}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CARAS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { playSfx('tap', p.soundFxEnabled); p.onSelectFace(c); }}
                    aria-pressed={p.currentFace === c}
                    className={`px-3 py-1.5 rounded-full text-[13px] font-medium border transition-all cursor-pointer ${
                      p.currentFace === c ? 'border-[#D6B56C] bg-[#3D3829] text-[#ECE8E2]' : 'border-[#46484D] bg-[#34363A] text-[#ECE8E2] hover:border-[#D6B56C]'
                    }`}
                  >
                    {NOMBRE_CARA[c] || c}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between p-3 rounded-2xl border border-[#46484D] bg-[#34363A] cursor-pointer">
              <span className="flex items-center gap-2 text-[14px] text-[#ECE8E2]">
                <Wand2 className="w-4 h-4 text-[#E0C27F]" /> Modo diversión (solo en la cara clásica)
              </span>
              <input type="checkbox" checked={p.funMode} onChange={p.onToggleFunMode} className="accent-[#D6B56C] w-4 h-4" />
            </label>
          </div>
        )}

        {tab === 'sistema' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button type="button" onClick={() => { p.onClose(); p.onOpenAcceso(); }} className={`p-3 rounded-2xl border flex items-center gap-2 text-[14px] font-medium cursor-pointer ${p.usuario.authenticated ? 'border-[#3F4D3F] bg-[#2F3A30] text-[#A9C3A4]' : 'border-[#D6B56C] bg-[#3D3829] text-[#ECE8E2]'}`}>
                {p.usuario.authenticated ? <ShieldCheck className="w-4 h-4" /> : <Fingerprint className="w-4 h-4" />}
                <span>{p.usuario.authenticated ? `Sesión: ${p.usuario.name}` : 'Entrar a la junta'}</span>
              </button>
              <button type="button" onClick={() => { p.onClose(); p.onOpenVault(); }} className="p-3 rounded-2xl border border-[#46484D] bg-[#34363A] text-[#ECE8E2] hover:border-[#D6B56C] flex items-center gap-2 text-[14px] font-medium cursor-pointer">
                <ShieldCheck className="w-4 h-4 text-[#E0C27F]" /> Bóveda de claves
              </button>
              <button type="button" onClick={() => { p.onClose(); p.onOpenPhotos(); }} className="p-3 rounded-2xl border border-[#46484D] bg-[#34363A] text-[#ECE8E2] hover:border-[#D6B56C] flex items-center gap-2 text-[14px] font-medium cursor-pointer">
                <Camera className="w-4 h-4 text-[#E0C27F]" /> Fotos
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-5 pt-3 border-t border-[#46484D] text-[14px] text-[#ECE8E2]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={p.soundFxEnabled} onChange={p.onToggleSoundFx} className="accent-[#D6B56C] w-4 h-4" />
                <span className="flex items-center gap-1.5"><Volume2 className="w-4 h-4 text-[#E0C27F]" /> Efectos</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={p.speakerEnabled} onChange={p.onToggleSpeaker} className="accent-[#D6B56C] w-4 h-4" />
                <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-[#E0C27F]" /> Voz</span>
              </label>
              <button type="button" onClick={p.onOlvidar} className="ml-auto flex items-center gap-1.5 text-[13px] font-medium text-[#E39A7A] hover:text-[#F0B39A] cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" /> Borrar conversación y memoria local
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
