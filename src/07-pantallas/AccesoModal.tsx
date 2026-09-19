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
    <div id="ultron-acceso" className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="w-full max-w-md bg-[#05080c] border border-[#05E1FF]/40 rounded-2xl p-6 shadow-[0_0_35px_rgba(5,225,255,0.25)] flex flex-col gap-4 relative overflow-hidden">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded text-[#8FA3B0] hover:text-[#05E1FF] cursor-pointer" aria-label="Cerrar">
          <X className="w-5 h-5" />
        </button>
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#05E1FF]/10 border border-[#05E1FF]/30 text-[10px] font-mono text-[#05E1FF] mb-1">
            <Globe className="w-3 h-3" />
            <span>cerebro Orden Global</span>
            <span className={`w-1.5 h-1.5 rounded-full ${remoto === 'ok' ? 'bg-emerald-400 animate-pulse' : remoto === 'off' ? 'bg-red-400' : 'bg-amber-400'}`} />
          </div>
          <h2 className="font-display font-bold text-xl text-[#05E1FF] tracking-wider">ACCESO DE JUNTA</h2>
          <p className="text-[11px] text-[#8FA3B0] mt-0.5">Con sesión: memoria propia, bóveda, redespliegue. Sin sesión, ULTRON igual conversa.</p>
        </div>

        {usuario.authenticated ? (
          <div className="flex flex-col gap-3">
            <div className="p-3 rounded-lg bg-[#00FF88]/10 border border-[#00FF88]/40 text-left text-xs font-mono text-[#00FF88]">
              <div className="flex items-center gap-1.5 font-bold mb-1"><ShieldCheck className="w-4 h-4" /> SESIÓN ACTIVA</div>
              <div className="text-white text-sm font-semibold">{usuario.name}</div>
              <div className="text-[#8FA3B0] text-[11px]">{usuario.role}</div>
            </div>
            <button type="button" onClick={salir} className="py-2.5 rounded-lg border border-amber-400/50 text-amber-300 hover:bg-amber-400/10 font-display text-xs tracking-wider flex items-center justify-center gap-2 cursor-pointer">
              <LogOut className="w-3.5 h-3.5" /> CERRAR SESIÓN
            </button>
          </div>
        ) : (
          <form onSubmit={entrar} className="flex flex-col gap-3 text-left">
            <label className="block text-[11px] font-mono text-[#8FA3B0]">
              Correo
              <div className="relative mt-1">
                <Mail className="w-4 h-4 text-[#8FA3B0] absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="nombre@ordenglobal.org" required className="w-full pl-9 pr-3 py-2 bg-black/60 border border-[#05E1FF]/30 rounded-lg text-xs font-mono text-white placeholder:text-gray-500 focus:border-[#05E1FF] focus:outline-none" />
              </div>
            </label>
            <label className="block text-[11px] font-mono text-[#8FA3B0]">
              Clave
              <div className="relative mt-1">
                <Lock className="w-4 h-4 text-[#8FA3B0] absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="••••••••" required className="w-full pl-9 pr-3 py-2 bg-black/60 border border-[#05E1FF]/30 rounded-lg text-xs font-mono text-white placeholder:text-gray-500 focus:border-[#05E1FF] focus:outline-none" />
              </div>
            </label>
            {error && (
              <div className="p-2 rounded bg-red-950/40 border border-red-500/40 text-[11px] font-mono text-red-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={enviando} className="mt-1 py-2.5 px-4 rounded-lg bg-[#05E1FF]/20 border border-[#05E1FF]/50 text-[#05E1FF] hover:bg-[#05E1FF]/30 font-display font-semibold text-xs tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
              {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              <span>{enviando ? 'ENTRANDO…' : 'ENTRAR'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
