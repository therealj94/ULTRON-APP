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
      className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all duration-200 cursor-pointer ${
        on
          ? warm
            ? 'border-[#FFB648] bg-[#FFB648]/20 text-[#FFB648]'
            : 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF] shadow-[0_0_12px_rgba(5,225,255,0.4)]'
          : 'border-[#05E1FF]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF]'
      }`}
    >
      {children}
    </button>
  );
  return (
    <div
      id="ultron-dock-drawer"
      className={`absolute left-0 right-0 bottom-0 z-30 transition-transform duration-300 ease-out px-4 pb-5 pt-3 bg-gradient-to-t from-black via-black/95 to-transparent ${
        p.isOpen ? 'translate-y-0' : 'translate-y-[115%] pointer-events-none'
      }`}
    >
      <div className="max-w-2xl mx-auto flex flex-col gap-3">
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
            <button key={c.label} type="button" onClick={() => { playSfx('tap', p.soundFxEnabled); p.onSubmitCommand(c.cmd); }} className="text-xs px-3 py-1 rounded-md border border-[#05E1FF]/25 bg-black/50 text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF] hover:bg-[#05E1FF]/10 transition-colors flex items-center gap-1.5 cursor-pointer font-mono">
              <Sparkles className="w-3 h-3 text-[#05E1FF]" />
              <span>{c.label}</span>
            </button>
          ))}
          <button type="button" onClick={() => { playSfx('tap', p.soundFxEnabled); p.onSubmitCommand('canta quiero conocer a Jesús'); }} className="text-xs px-3 py-1 rounded-md border border-[#05E1FF]/25 bg-black/50 text-[#8FA3B0] hover:text-[#05E1FF] hover:border-[#05E1FF] hover:bg-[#05E1FF]/10 transition-colors flex items-center gap-1.5 cursor-pointer font-mono">
            <Music2 className="w-3 h-3 text-[#05E1FF]" />
            <span>Canta</span>
          </button>
        </div>
        <form onSubmit={enviar} className="flex gap-2">
          <input
            id="dock-cmd-input"
            type="text"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="Escribí o dictá: precio del oro, abrí bch.hn, recordá que…, canta…"
            autoComplete="off"
            className="flex-1 bg-[#05080c] border border-[#05E1FF]/30 text-[#dff8ff] placeholder-[#8FA3B0]/50 text-sm font-mono px-4 py-2.5 rounded-lg focus:outline-none focus:border-[#05E1FF] focus:shadow-[0_0_12px_rgba(5,225,255,0.25)] transition-all"
          />
          <button type="submit" className="bg-[#05E1FF] text-[#001418] font-display font-bold text-xs tracking-wider px-5 py-2.5 rounded-lg hover:bg-[#05E1FF]/90 active:scale-95 shadow-[0_0_15px_rgba(5,225,255,0.3)] flex items-center gap-1.5 cursor-pointer uppercase">
            <Send className="w-3.5 h-3.5" />
            <span>Enviar</span>
          </button>
        </form>
      </div>
    </div>
  );
};
