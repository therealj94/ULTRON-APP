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
    <div id="ultron-acceso" className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-[#ECE8E2]/40 backdrop-blur-md">
      <div className="w-full max-w-md bg-[#232528] rounded-[28px] p-6 shadow-[0_16px_48px_rgba(0,0,0,0.53)] flex flex-col gap-4 relative overflow-hidden">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-[#3A3C41] text-[#B9B2A8] hover:bg-[#3D3829] flex items-center justify-center cursor-pointer" aria-label="Cerrar">
          <X className="w-5 h-5" />
        </button>
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#D6B56C]/10 border border-[#46484D] text-[12px] font-mono text-[#E0C27F] mb-1">
            <Globe className="w-3 h-3" />
            <span>cerebro Orden Global</span>
            <span className={`w-1.5 h-1.5 rounded-full ${remoto === 'ok' ? 'bg-emerald-400 animate-pulse' : remoto === 'off' ? 'bg-red-400' : 'bg-amber-400'}`} />
          </div>
          <h2 className="font-display font-semibold text-2xl text-[#ECE8E2]">Entrar a la junta</h2>
          <p className="text-[14px] leading-snug text-[#B9B2A8] mt-1">Con sesión: memoria propia, bóveda, redespliegue. Sin sesión, AU-RA igual conversa.</p>
        </div>

        {usuario.authenticated ? (
          <div className="flex flex-col gap-3">
            <div className="p-3 rounded-lg bg-[#2F3A30] border border-[#3F4D3F] text-left text-xs font-mono text-[#A9C3A4]">
              <div className="flex items-center gap-1.5 font-semibold mb-1"><ShieldCheck className="w-4 h-4" /> Sesión activa</div>
              <div className="text-[#ECE8E2] text-sm font-semibold">{usuario.name}</div>
              <div className="text-[#B9B2A8] text-[13px]">{usuario.role}</div>
            </div>
            <button type="button" onClick={salir} className="py-3 rounded-full border border-[#6B4A3E] text-[#F0B39A] hover:bg-[#3F2E28] font-semibold text-[14px] flex items-center justify-center gap-2 cursor-pointer">
              <LogOut className="w-4 h-4" /> Cerrar sesión
            </button>
          </div>
        ) : (
          <form onSubmit={entrar} className="flex flex-col gap-3 text-left">
            <label className="block text-[13px] font-medium text-[#B9B2A8]">
              Correo
              <div className="relative mt-1">
                <Mail className="w-4 h-4 text-[#B9B2A8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="nombre@ordenglobal.org" required className="w-full pl-10 pr-4 py-3 bg-[#34363A] border border-[#46484D] rounded-full text-[15px] text-[#ECE8E2] placeholder:text-[#8A847C] focus:border-[#D6B56C] focus:outline-none" />
              </div>
            </label>
            <label className="block text-[13px] font-medium text-[#B9B2A8]">
              Clave
              <div className="relative mt-1">
                <Lock className="w-4 h-4 text-[#B9B2A8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="••••••••" required className="w-full pl-10 pr-4 py-3 bg-[#34363A] border border-[#46484D] rounded-full text-[15px] text-[#ECE8E2] placeholder:text-[#8A847C] focus:border-[#D6B56C] focus:outline-none" />
              </div>
            </label>
            {error && (
              <div className="p-2 rounded bg-[#3F2E28] border border-[#6B4A3E] text-[13px] font-mono text-[#E0726B] flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={enviando} className="mt-1 py-3 px-4 rounded-full bg-[#D6B56C] text-[#232528] hover:bg-[#C9A55A] shadow-[0_6px_16px_rgba(214,181,108,0.3)] font-semibold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
              {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              <span>{enviando ? 'Entrando…' : 'Entrar'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
