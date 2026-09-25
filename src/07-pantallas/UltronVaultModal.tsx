import React, { useEffect, useState } from 'react';
import { ShieldCheck, X, KeyRound, Loader2 } from 'lucide-react';
import { headersMesa } from '../10-infra/sesionCliente';

type Caja = { id: string; name: string; configured: boolean; falta?: string; usa?: string };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSpeak: (t: string) => void;
}

/** Bóveda: qué claves hay (solo booleanos) y dónde poner la de ElevenLabs si falta. Nunca muestra valores. */
export const UltronVaultModal: React.FC<Props> = ({ isOpen, onClose, onSpeak }) => {
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [resumen, setResumen] = useState('');
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    fetch('/api/vault/status', { headers: headersMesa() })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) throw new Error('La bóveda pide sesión de junta.');
        if (!r.ok) throw new Error(j.error || 'No pude leer la bóveda.');
        setCajas(j.conduits || []);
        setResumen(j.resumen || '');
      })
      .catch((e) => setError(String(e.message || e)));
  }, [isOpen]);

  if (!isOpen) return null;

  const guardar = async () => {
    if (key.trim().length < 10) return;
    setGuardando(true);
    try {
      const r = await fetch('/api/vault/elevenlabs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headersMesa() }, body: JSON.stringify({ apiKey: key.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se guardó.');
      setKey('');
      onSpeak('Clave de voz archivada. Hasta el próximo redespliegue.');
      setCajas((c) => c.map((x) => (x.id === 'elevenlabs' ? { ...x, configured: true } : x)));
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-md">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[#34363A] border border-[#46484D] rounded-2xl p-5 shadow-[0_8px_24px_rgba(0,0,0,0.34)] flex flex-col gap-3 relative">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded text-[#B9B2A8] hover:text-[#ECE8E2] cursor-pointer" aria-label="Cerrar">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-[#E0C27F]">
          <ShieldCheck className="w-5 h-5" />
          <h2 className="font-display font-bold tracking-wider">BÓVEDA</h2>
        </div>
        <p className="text-[13px] text-[#B9B2A8] font-mono">{resumen || 'Qué claves tiene la mesa. Nunca se muestran valores.'}</p>
        {error && <div className="text-[13px] text-[#E39A7A] font-mono">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {cajas.map((c) => (
            <div key={c.id} className={`p-2.5 rounded-xl border text-xs ${c.configured ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-amber-400/30 bg-amber-400/5'}`}>
              <div className="flex items-center justify-between">
                <span className="text-[#ECE8E2] font-medium">{c.name}</span>
                <span className={`text-[12px] font-mono ${c.configured ? 'text-emerald-400' : 'text-[#E39A7A]'}`}>{c.configured ? '● lista' : '○ falta'}</span>
              </div>
              <div className="text-[12px] text-[#B9B2A8] mt-0.5">{c.configured ? c.usa : c.falta}</div>
            </div>
          ))}
        </div>
        <div className="mt-1 p-3 rounded-xl border border-[#46484D] bg-[#34363A]/90 flex flex-col gap-2">
          <div className="text-[12px] font-display tracking-normal text-[#B9B2A8]">CLAVE DE VOZ (ELEVENLABS) · solo mando con sesión</div>
          <div className="flex gap-2">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="pegar clave" className="flex-1 px-3 py-2 bg-[#34363A]/90 border border-[#46484D] rounded-lg text-xs font-mono text-[#ECE8E2] focus:border-[#D6B56C] focus:outline-none" />
            <button type="button" onClick={guardar} disabled={guardando || key.trim().length < 10} className="px-3 py-2 rounded-lg border border-[#46484D] text-[#E0C27F] text-xs font-display tracking-wider hover:bg-[#D6B56C]/15 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer">
              {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} GUARDAR
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
