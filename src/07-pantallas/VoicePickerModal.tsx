import React, { useState } from 'react';
import { Volume2, Play, Check, X } from 'lucide-react';
import { VOCES, VozId, VozUltron } from '../03-voz/voces';

interface Props {
  isOpen: boolean;
  actual: VozId;
  onClose: () => void;
  onSelect: (id: VozId) => void;
}

export const VoicePickerModal: React.FC<Props> = ({ isOpen, actual, onClose, onSelect }) => {
  const [probando, setProbando] = useState<VozId | null>(null);

  if (!isOpen) return null;

  const probar = async (v: VozUltron) => {
    setProbando(v.id);
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text:
            v.id === 'looi'
              ? 'Ey. Estoy aquí en la mesa.'
              : v.id === 'luna'
                ? 'Hola. Lista para ayudarte.'
                : 'Listo. Te escucho.',
          voice: v.motor,
          instruct: v.instruct,
        }),
      });
      if (r.ok && (r.headers.get('content-type') || '').includes('audio')) {
        const url = URL.createObjectURL(await r.blob());
        const a = new Audio(url);
        a.onended = () => {
          URL.revokeObjectURL(url);
          setProbando(null);
        };
        a.onerror = () => setProbando(null);
        await a.play();
        return;
      }
    } catch {
      /* ignore */
    }
    setProbando(null);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md bg-[#0B1220] border border-[#05E1FF]/30 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-[#05E1FF]">
            <Volume2 className="w-4 h-4" />
            <span className="font-display tracking-wide text-sm">Tres voces</span>
          </div>
          <button type="button" onClick={onClose} className="text-[#8FA3B0]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {VOCES.map((v) => (
            <div
              key={v.id}
              className={`flex items-center justify-between gap-2 px-3 py-3 rounded-xl border ${
                actual === v.id ? 'border-[#05E1FF] bg-[#05E1FF]/10' : 'border-white/10 bg-black/40'
              }`}
            >
              <button type="button" className="text-left flex-1" onClick={() => onSelect(v.id)}>
                <div className="text-white font-medium">{v.etiqueta}</div>
                <div className="text-[11px] text-[#8FA3B0]">{v.rol}</div>
              </button>
              <button
                type="button"
                onClick={() => probar(v)}
                className="p-2 rounded-lg border border-[#05E1FF]/30 text-[#05E1FF]"
                title="Probar"
              >
                <Play className="w-4 h-4" />
              </button>
              {actual === v.id && <Check className="w-4 h-4 text-[#05E1FF]" />}
              {probando === v.id && <span className="text-[10px] text-[#8FA3B0]">…</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
