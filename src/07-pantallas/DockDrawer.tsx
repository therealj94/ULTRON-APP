import React, { useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Eye, Moon, Sun, Send, Sparkles, Camera, Music2, Smartphone } from 'lucide-react';
import { playSfx } from '../03-voz/audio';

interface Props {
  isOpen: boolean;
  micEnabled: boolean;
  speakerEnabled: boolean;
  visionEnabled: boolean;
  isSleeping: boolean;
  isKioskFrame: boolean;
  soundFxEnabled: boolean;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onToggleVision: () => void;
  onToggleSleep: () => void;
  onToggleKioskFrame: () => void;
  onOpenCamera: () => void;
  onSubmitCommand: (cmd: string) => void;
}

const CHIPS = [
  { label: 'Oro', cmd: 'precio del oro hoy' },
  { label: 'Plata', cmd: 'precio de la plata' },
  { label: 'Lempira', cmd: 'lempira a dólar' },
  { label: 'Qué ves', cmd: 'qué ves en la cámara' },
  { label: 'Sistema', cmd: 'cómo está el sistema' },
  { label: 'Chiste', cmd: 'contame un chiste' },
];

/** Dock: mic, voz, cámara, reposo, un campo de texto y seis chips. Nada más. */
export const DockDrawer: React.FC<Props> = (p) => {
  const [valor, setValor] = useState('');
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valor.trim()) return;
    playSfx('tap', p.soundFxEnabled);
    p.onSubmitCommand(valor.trim());
    setValor('');
  };
  const Btn = ({ on, title, onClick, children, warm }: { on: boolean; title: string; onClick: () => void; children: React.ReactNode; warm?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={on}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${
        on
          ? warm
            ? 'bg-[#D9825F] text-white shadow-[0_6px_16px_rgba(217,130,95,0.35)]'
            : 'bg-[#E2A83E] text-white shadow-[0_6px_16px_rgba(168,112,26,0.3)]'
          : 'bg-[#F6EFE4] text-[#6B6056] hover:bg-[#FBEBC9]'
      }`}
    >
      {children}
    </button>
  );
  return (
    <div
      id="ultron-dock-drawer"
      className={`absolute left-0 right-0 bottom-0 z-30 transition-transform duration-300 ease-out px-3 pb-4 ${
        p.isOpen ? 'translate-y-0' : 'translate-y-[115%] pointer-events-none'
      }`}
    >
      <div className="max-w-2xl mx-auto flex flex-col gap-3 bg-[#FEF9F3] rounded-[28px] p-4 shadow-[0_-8px_40px_rgba(90,60,25,0.18)]">
        <div className="mx-auto w-10 h-1.5 rounded-full bg-[#E3D5C0]" aria-hidden="true" />
        <div className="flex items-center justify-center gap-3">
          <Btn on={p.micEnabled} title={p.micEnabled ? 'Micrófono activo' : 'Micrófono apagado'} onClick={p.onToggleMic}>{p.micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}</Btn>
          <Btn on={p.speakerEnabled} title={p.speakerEnabled ? 'Voz activa' : 'Voz silenciada'} onClick={p.onToggleSpeaker}>{p.speakerEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}</Btn>
          <Btn on={p.visionEnabled} title={p.visionEnabled ? 'Cámara siguiéndote' : 'Activar cámara'} onClick={p.onToggleVision}><Eye className="w-5 h-5" /></Btn>
          <Btn on={false} title="Foto 3-2-1" onClick={p.onOpenCamera}><Camera className="w-5 h-5" /></Btn>
          <Btn on={p.isSleeping} warm title={p.isSleeping ? 'Despertar' : 'Reposo'} onClick={p.onToggleSleep}>{p.isSleeping ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</Btn>
          <Btn on={p.isKioskFrame} title="Marco de mesa / pantalla completa" onClick={p.onToggleKioskFrame}><Smartphone className="w-5 h-5" /></Btn>
        </div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {CHIPS.map((c) => (
            <button key={c.label} type="button" onClick={() => { playSfx('tap', p.soundFxEnabled); p.onSubmitCommand(c.cmd); }} className="text-[13px] font-medium px-3.5 py-2 rounded-full border border-[#EDE0CC] bg-white text-[#3A322C] hover:border-[#E2A83E] transition-colors flex items-center gap-1.5 cursor-pointer">
              <Sparkles className="w-3.5 h-3.5 text-[#A8701A]" />
              <span>{c.label}</span>
            </button>
          ))}
          <button type="button" onClick={() => { playSfx('tap', p.soundFxEnabled); p.onSubmitCommand('canta quiero conocer a Jesús'); }} className="text-[13px] font-medium px-3.5 py-2 rounded-full border border-[#EDE0CC] bg-white text-[#3A322C] hover:border-[#E2A83E] transition-colors flex items-center gap-1.5 cursor-pointer">
            <Music2 className="w-3.5 h-3.5 text-[#A8701A]" />
            <span>Canta</span>
          </button>
        </div>
        <form onSubmit={enviar} className="flex gap-2">
          <input
            id="dock-cmd-input"
            type="text"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="Escríbele: precio del oro, abre bch.hn, recuerda que…, canta…"
            autoComplete="off"
            aria-label="Escribirle a Aura"
            className="flex-1 min-w-0 bg-white border border-[#EDE0CC] text-[#3A322C] placeholder-[#8B7E72] text-[15px] px-4 py-3 rounded-full focus:outline-none focus:border-[#E2A83E] transition-all"
          />
          <button type="submit" className="bg-[#E2A83E] text-white font-semibold text-[14px] px-5 py-3 rounded-full hover:bg-[#D69A2E] active:scale-95 shadow-[0_6px_16px_rgba(168,112,26,0.3)] flex items-center gap-1.5 cursor-pointer">
            <Send className="w-4 h-4" />
            <span>Enviar</span>
          </button>
        </form>
      </div>
    </div>
  );
};
