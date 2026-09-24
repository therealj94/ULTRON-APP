import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, X, Lock, Mail, KeyRound, Globe, Loader2, LogOut } from 'lucide-react';
import { playSfx } from '../03-voz/audio';
import { guardarTokenMesa, headersMesa } from '../10-infra/sesionCliente';

interface Props {
  isOpen: boolean;
  usuario: { name: string; role: string; authenticated: boolean };
  soundFxEnabled: boolean;
  onClose: () => void;
  onAuthSuccess: (nombre: string, rol: string) => void;
  onLogout: () => void;
}

/**
 * Acceso de junta: correo + clave contra el cerebro remoto. Sin escáner de huella de teatro:
 * la sesión firmada dura catorce días y se renueva sola.
 */
export const AccesoModal: React.FC<Props> = ({ isOpen, usuario, soundFxEnabled, onClose, onAuthSuccess, onLogout }) => {
  const [correo, setCorreo] = useState(() => {
    try {
      return localStorage.getItem('ultron_correo') || '';
    } catch {
      return '';
    }
  });
  const [clave, setClave] = useState('');
  const [remoto, setRemoto] = useState<'?' | 'ok' | 'off'>('?');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    fetch('/api/ultron/salud')
      .then((r) => setRemoto(r.ok ? 'ok' : 'off'))
      .catch(() => setRemoto('off'));
  }, [isOpen]);

  if (!isOpen) return null;

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correo || !clave) return;
    setEnviando(true);
    setError('');
    try {
      const res = await fetch('/api/ultron/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, clave }),
      });
      const data = await res.json().catch(() => ({}));
      setEnviando(false);
      if (res.ok && data.ok) {
        if (data.token) guardarTokenMesa(String(data.token));
        try {
          localStorage.setItem('ultron_correo', correo);
        } catch {
          /* */
        }
        playSfx('grant', soundFxEnabled);
        onAuthSuccess(data.miembro?.nombre || correo.split('@')[0], data.miembro?.rol || 'Junta Directiva · Orden Global');
        setClave('');
        onClose();
      } else {
        setError(data.error || 'Clave no válida.');
        playSfx('deny', soundFxEnabled);
      }
    } catch {
      setEnviando(false);
      setError('No alcancé el servidor de la mesa.');
    }
  };

  const salir = async () => {
    try {
      await fetch('/api/ultron/salir', { method: 'POST', headers: headersMesa() });
    } catch {
      /* */
    }
    guardarTokenMesa('');
    onLogout();
    onClose();
  };

  return (
    <div id="ultron-acceso" className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-[#3A322C]/40 backdrop-blur-md">
      <div className="w-full max-w-md bg-[#FEF9F3] rounded-[28px] p-6 shadow-[0_16px_48px_rgba(90,60,25,0.22)] flex flex-col gap-4 relative overflow-hidden">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-[#F6EFE4] text-[#6B6056] hover:bg-[#FBEBC9] flex items-center justify-center cursor-pointer" aria-label="Cerrar">
          <X className="w-5 h-5" />
        </button>
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E2A83E]/10 border border-[#EDE0CC] text-[12px] font-mono text-[#A8701A] mb-1">
            <Globe className="w-3 h-3" />
            <span>cerebro Orden Global</span>
            <span className={`w-1.5 h-1.5 rounded-full ${remoto === 'ok' ? 'bg-emerald-400 animate-pulse' : remoto === 'off' ? 'bg-red-400' : 'bg-amber-400'}`} />
          </div>
          <h2 className="font-display font-semibold text-2xl text-[#3A322C]">Entrar a la junta</h2>
          <p className="text-[14px] leading-snug text-[#6B6056] mt-1">Con sesión: memoria propia, bóveda, redespliegue. Sin sesión, AU-RA igual conversa.</p>
        </div>

        {usuario.authenticated ? (
          <div className="flex flex-col gap-3">
            <div className="p-3 rounded-lg bg-[#E7F0E6] border border-[#C9DCC8] text-left text-xs font-mono text-[#4E6E54]">
              <div className="flex items-center gap-1.5 font-semibold mb-1"><ShieldCheck className="w-4 h-4" /> Sesión activa</div>
              <div className="text-[#3A322C] text-sm font-semibold">{usuario.name}</div>
              <div className="text-[#6B6056] text-[13px]">{usuario.role}</div>
            </div>
            <button type="button" onClick={salir} className="py-3 rounded-full border border-[#E9B6A6] text-[#8F4526] hover:bg-[#FBE3DC] font-semibold text-[14px] flex items-center justify-center gap-2 cursor-pointer">
              <LogOut className="w-4 h-4" /> Cerrar sesión
            </button>
          </div>
        ) : (
          <form onSubmit={entrar} className="flex flex-col gap-3 text-left">
            <label className="block text-[13px] font-medium text-[#6B6056]">
              Correo
              <div className="relative mt-1">
                <Mail className="w-4 h-4 text-[#6B6056] absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="nombre@ordenglobal.org" required className="w-full pl-10 pr-4 py-3 bg-white border border-[#EDE0CC] rounded-full text-[15px] text-[#3A322C] placeholder:text-[#8B7E72] focus:border-[#E2A83E] focus:outline-none" />
              </div>
            </label>
            <label className="block text-[13px] font-medium text-[#6B6056]">
              Clave
              <div className="relative mt-1">
                <Lock className="w-4 h-4 text-[#6B6056] absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="••••••••" required className="w-full pl-10 pr-4 py-3 bg-white border border-[#EDE0CC] rounded-full text-[15px] text-[#3A322C] placeholder:text-[#8B7E72] focus:border-[#E2A83E] focus:outline-none" />
              </div>
            </label>
            {error && (
              <div className="p-2 rounded bg-[#FBE3DC] border border-[#E9B6A6] text-[13px] font-mono text-[#B3413D] flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={enviando} className="mt-1 py-3 px-4 rounded-full bg-[#E2A83E] text-white hover:bg-[#D69A2E] shadow-[0_6px_16px_rgba(168,112,26,0.3)] font-semibold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
              {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              <span>{enviando ? 'Entrando…' : 'Entrar'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
