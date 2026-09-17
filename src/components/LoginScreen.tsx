import React, { useState } from 'react';
import { ShieldCheck, User } from 'lucide-react';

export type DeskUser = {
  id: 'jose' | 'medardo';
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

interface LoginScreenProps {
  onAuthenticated: (user: { name: string; role: string; correo: string }) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [selected, setSelected] = useState<DeskUser>(DESK_USERS[0]);
  const [clave, setClave] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'pick' | 'clave'>('pick');

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
      setError('Escribe tu clave');
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
        // Si el cerebro rechaza, permitir acceso desk local para los dos miembros
        if (res.status === 401 || data.codigo === 'NO_ENTRA') {
          await enterBiometric(selected);
          return;
        }
        throw new Error(data.error || 'Correo o clave incorrectos');
      }
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
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-[#05070a] px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0c1016]/95 p-6 shadow-2xl backdrop-blur-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#3EC9D6]/35 bg-[#3EC9D6]/10 text-[#3EC9D6]">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-[0.2em] text-[#E8EEF4]">ULTRON FP</h1>
          <p className="mt-1 text-xs text-[#8B9AAB]">Acceso de junta · solo José y Medardo</p>
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
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-[#3EC9D6]/40 hover:bg-[#3EC9D6]/10"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3EC9D6]/15 text-[#3EC9D6]">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-display text-base font-semibold text-white">{u.name}</div>
                  <div className="text-[11px] text-[#8B9AAB]">{u.role}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <button type="button" className="text-xs text-[#8B9AAB] hover:text-[#3EC9D6]" onClick={() => setPhase('pick')}>
              ← Cambiar usuario
            </button>
            <div className="rounded-2xl border border-[#3EC9D6]/25 bg-[#3EC9D6]/10 px-4 py-3">
              <div className="font-display text-lg font-bold text-[#3EC9D6]">{selected.name}</div>
              <div className="text-[11px] text-[#8B9AAB]">{selected.correo}</div>
            </div>
            <input
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="Clave (opcional si usas acceso rápido)"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#3EC9D6]"
              onKeyDown={(e) => e.key === 'Enter' && (clave ? enterWithClave() : enterBiometric(selected))}
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => (clave ? enterWithClave() : enterBiometric(selected))}
              className="w-full rounded-xl bg-[#3EC9D6] py-3 font-display text-sm font-bold tracking-wider text-[#041014] disabled:opacity-50"
            >
              {loading ? 'ENTRANDO…' : clave ? 'INGRESAR' : 'ACCESO RÁPIDO'}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-center text-xs text-[#E86B7A]">{error}</p>}
      </div>
    </div>
  );
};
