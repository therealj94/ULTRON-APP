import React, { useState, useEffect } from 'react';
import { ShieldCheck, User, Eye, EyeOff, Save } from 'lucide-react';

export type DeskUser = {
  id: 'jose' | 'medardo' | 'custom';
  name: string;
  correo: string;
  role: string;
};

export const DESK_USERS: DeskUser[] = [
  {
    id: 'jose',
    name: 'José',
    correo: 'mjoseenamorado1994@gmail.com',
    role: 'Junta Directiva · Orden Global',
  },
  {
    id: 'medardo',
    name: 'Medardo',
    correo: 'medardo@ordenglobal.org',
    role: 'Junta Directiva · Orden Global',
  },
];

const LS_CREDS = 'ultron_fp_saved_creds';

type SavedCreds = { correo: string; clave: string; name?: string; remember: boolean };

function loadSaved(): SavedCreds | null {
  try {
    const raw = localStorage.getItem(LS_CREDS);
    if (!raw) return null;
    return JSON.parse(raw) as SavedCreds;
  } catch {
    return null;
  }
}

function persistCreds(c: SavedCreds | null) {
  if (!c || !c.remember) {
    localStorage.removeItem(LS_CREDS);
    return;
  }
  localStorage.setItem(LS_CREDS, JSON.stringify(c));
}

interface LoginScreenProps {
  onAuthenticated: (user: { name: string; role: string; correo: string }) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const saved = typeof window !== 'undefined' ? loadSaved() : null;
  const [selected, setSelected] = useState<DeskUser>(DESK_USERS[0]);
  const [clave, setClave] = useState(saved?.clave || '');
  const [showClave, setShowClave] = useState(false);
  const [remember, setRemember] = useState(Boolean(saved?.remember));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'pick' | 'clave'>(saved?.correo ? 'clave' : 'pick');
  const [logoReady, setLogoReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLogoReady(true), 80);
    if (saved?.correo) {
      const match = DESK_USERS.find((u) => u.correo === saved.correo);
      if (match) setSelected(match);
    }
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enterBiometric = async (user: DeskUser) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ultron/biometric-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biometricType: 'desk_access',
          userName: user.name,
          role: user.role,
          correo: user.correo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Acceso denegado');
      if (remember && clave) {
        persistCreds({ correo: user.correo, clave, name: user.name, remember: true });
      }
      onAuthenticated({
        name: data.user?.nombre || user.name,
        role: data.user?.rol || user.role,
        correo: user.correo,
      });
    } catch (e: any) {
      setError(e.message || 'No se pudo entrar');
    } finally {
      setLoading(false);
    }
  };

  const enterWithClave = async () => {
    if (!clave.trim()) {
      setError('Escribe tu clave de ultron.ordenglobal.link');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ultron/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: selected.correo, clave }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || data.codigo === 'NO_ENTRA') {
          await enterBiometric(selected);
          return;
        }
        throw new Error(data.error || 'Correo o clave incorrectos');
      }
      persistCreds(
        remember
          ? { correo: selected.correo, clave, name: selected.name, remember: true }
          : null
      );
      onAuthenticated({
        name: data.miembro?.nombre || selected.name,
        role: data.miembro?.rol || selected.role,
        correo: selected.correo,
      });
    } catch (e: any) {
      setError(e.message || 'Error de acceso');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 35%, rgba(0,229,255,0.12), transparent 70%)',
        }}
      />
      <div className="relative w-full max-w-md rounded-3xl border border-[#00E5FF]/20 bg-[#0a0e14]/95 p-6 shadow-[0_0_60px_rgba(0,229,255,0.12)] backdrop-blur-xl">
        <div className="mb-6 text-center">
          <div
            className="mx-auto mb-4 h-20 w-20 overflow-hidden rounded-full border border-[#00E5FF]/30 bg-black"
            style={{
              opacity: logoReady ? 1 : 0,
              transform: logoReady ? 'scale(1)' : 'scale(0.85)',
              transition: 'opacity 0.7s ease, transform 0.8s ease',
              boxShadow: '0 0 28px rgba(0,229,255,0.35)',
              animation: logoReady ? 'login-logo-pulse 2.8s ease-in-out infinite' : 'none',
            }}
          >
            <img src="/brand/ultron-logo.jpg" alt="ULTRON" className="h-full w-full object-cover" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-[0.22em] text-[#E8FBFF]">ULTRON FP</h1>
          <p className="mt-1 text-xs text-[#7A8B9C]">
            Acceso · ultron.ordenglobal.link · José / Medardo
          </p>
        </div>

        {phase === 'pick' ? (
          <div className="space-y-3">
            {DESK_USERS.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  setSelected(u);
                  setPhase('clave');
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-[#00E5FF]/40 hover:bg-[#00E5FF]/10"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00E5FF]/15 text-[#00E5FF]">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-display text-base font-semibold text-white">{u.name}</div>
                  <div className="text-[11px] text-[#8B9AAB]">{u.correo}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              className="text-xs text-[#8B9AAB] hover:text-[#00E5FF]"
              onClick={() => setPhase('pick')}
            >
              ← Cambiar usuario
            </button>
            <div className="rounded-2xl border border-[#00E5FF]/25 bg-[#00E5FF]/10 px-4 py-3">
              <div className="font-display text-lg font-bold text-[#00E5FF]">{selected.name}</div>
              <div className="text-[11px] text-[#8B9AAB]">{selected.correo}</div>
            </div>
            <div className="relative">
              <input
                type={showClave ? 'text' : 'password'}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder="Clave de ultron.ordenglobal.link"
                className="w-full rounded-xl border border-white/10 bg-black/40 py-3 pl-4 pr-12 text-sm text-white outline-none focus:border-[#00E5FF]"
                onKeyDown={(e) => e.key === 'Enter' && (clave ? enterWithClave() : enterBiometric(selected))}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowClave((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8B9AAB] hover:text-[#00E5FF]"
                title={showClave ? 'Ocultar clave' : 'Ver clave'}
              >
                {showClave ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[#8B9AAB]">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="accent-[#00E5FF]"
              />
              <Save className="h-3.5 w-3.5 text-[#00E5FF]" />
              Guardar credenciales en este dispositivo
            </label>
            <button
              type="button"
              disabled={loading}
              onClick={() => (clave ? enterWithClave() : enterBiometric(selected))}
              className="w-full rounded-xl bg-[#00E5FF] py-3 font-display text-sm font-bold tracking-wider text-[#041014] disabled:opacity-50"
            >
              {loading ? 'ENTRANDO…' : clave ? 'INGRESAR' : 'ACCESO RÁPIDO'}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-center text-xs text-[#E86B7A]">{error}</p>}
      </div>
      <style>{`
        @keyframes login-logo-pulse {
          0%, 100% { box-shadow: 0 0 22px rgba(0,229,255,0.3); }
          50% { box-shadow: 0 0 40px rgba(0,229,255,0.55); }
        }
      `}</style>
    </div>
  );
};
