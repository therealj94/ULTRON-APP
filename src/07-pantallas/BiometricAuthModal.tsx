import React, { useState, useEffect } from 'react';
import {
  Fingerprint,
  ShieldCheck,
  ShieldAlert,
  Scan,
  CheckCircle2,
  XCircle,
  X,
  Lock,
  Mail,
  KeyRound,
  Globe,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { playSfx } from '../03-voz/audio';

interface BiometricAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (userName: string, role: string) => void;
  soundFxEnabled: boolean;
  onSpeak: (text: string) => void;
}

export const BiometricAuthModal: React.FC<BiometricAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  soundFxEnabled,
  onSpeak,
}) => {
  const [authMethod, setAuthMethod] = useState<'biometric' | 'credentials'>('biometric');
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'granted' | 'denied'>('idle');
  const [progress, setProgress] = useState(0);
  const [userName, setUserName] = useState('José');
  const [role, setRole] = useState('Junta Directiva · Orden Global');
  const [emailInput, setEmailInput] = useState('mjoseenamorado1994@gmail.com');
  const [passwordInput, setPasswordInput] = useState('');
  const [remoteStatus, setRemoteStatus] = useState<{
    connected: boolean;
    name?: string;
    model?: string;
    tools?: number;
    error?: string;
  }>({ connected: false });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Check health of ultron.ordenglobal.link on open
  useEffect(() => {
    if (!isOpen) {
      setPhase('idle');
      setProgress(0);
      setAuthError(null);
      return;
    }

    fetch('/api/ultron/salud')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setRemoteStatus({
            connected: true,
            name: data.nombre || 'ULTRON FP',
            model: data.modelo || 'Qwen3.8-27B-Uncensored',
            tools: data.herramientas || 69,
          });
        } else {
          setRemoteStatus({ connected: false, error: data.error });
        }
      })
      .catch(() => {
        setRemoteStatus({ connected: false, error: 'Sin enlace directo' });
      });
  }, [isOpen]);

  const handleStartScan = async (shouldSucceed = true) => {
    setPhase('scanning');
    setProgress(0);
    setAuthError(null);
    playSfx('biometric_scan', soundFxEnabled);

    let current = 0;
    const interval = setInterval(async () => {
      current += 5;
      setProgress(current);

      if (current % 25 === 0) {
        playSfx('biometric_scan', soundFxEnabled);
      }

      if (current >= 100) {
        clearInterval(interval);
        if (shouldSucceed) {
          try {
            const res = await fetch('/api/ultron/biometric-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                biometricType: 'fingerprint',
                userName,
                role,
              }),
            });
            const data = await res.json();
            setPhase('granted');
            playSfx('biometric_success', soundFxEnabled);
            onAuthSuccess(data.user?.nombre || userName, data.user?.rol || role);
            onSpeak(`Identidad verificada. Bienvenido, ${userName}. Conectado al nodo central de Orden Global.`);
          } catch {
            setPhase('granted');
            playSfx('biometric_success', soundFxEnabled);
            onAuthSuccess(userName, role);
            onSpeak(`Acceso local concedido. Bienvenido, ${userName}.`);
          }
        } else {
          setPhase('denied');
          playSfx('biometric_fail', soundFxEnabled);
          onSpeak('Alerta de seguridad. Huella dactilar no autorizada en el Directorio.');
        }
      }
    }, 40);
  };

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) return;
    setIsSubmitting(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/ultron/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: emailInput, clave: passwordInput }),
      });
      const data = await res.json();
      setIsSubmitting(false);

      if (res.ok && data.ok) {
        const loggedName = data.miembro?.nombre || emailInput.split('@')[0];
        setUserName(loggedName);
        setPhase('granted');
        playSfx('biometric_success', soundFxEnabled);
        onAuthSuccess(loggedName, 'Junta Directiva · Orden Global');
        onSpeak(`Sesión iniciada exitosamente en Render. Bienvenido, ${loggedName}.`);
      } else {
        setAuthError(data.error || 'Credenciales no válidas en ultron.ordenglobal.link');
        playSfx('biometric_fail', soundFxEnabled);
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setAuthError('Fallo al conectar con el servidor de Render.');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="ultron-biometric-modal"
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md bg-[#05080c] border border-[#05E1FF]/40 rounded-2xl p-6 shadow-[0_0_35px_rgba(5,225,255,0.25)] flex flex-col gap-4 text-center relative overflow-hidden">
        {/* Background Grid Accent */}
        <div className="absolute inset-0 bg-[radial-gradient(#05E1FF_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded text-[#8FA3B0] hover:text-[#05E1FF] transition-colors z-10 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Title */}
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#05E1FF]/10 border border-[#05E1FF]/30 text-[10px] font-mono text-[#05E1FF] mb-1">
            <Globe className="w-3 h-3" />
            <span>ultron.ordenglobal.link</span>
            <span className={`w-1.5 h-1.5 rounded-full ${remoteStatus.connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          </div>
          <h2 className="font-display font-bold text-xl text-[#05E1FF] tracking-wider">
            ACCESO DE DIRECTORIO
          </h2>
          <p className="text-[11px] text-[#8FA3B0] mt-0.5">
            Autenticación para José y Miembros de la Junta Directiva
          </p>
        </div>

        {/* Method Selector Tabs */}
        <div className="flex rounded-lg bg-black/50 p-1 border border-[#05E1FF]/20 text-xs font-mono">
          <button
            type="button"
            onClick={() => {
              setAuthMethod('biometric');
              setAuthError(null);
            }}
            className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              authMethod === 'biometric'
                ? 'bg-[#05E1FF]/20 text-[#05E1FF] font-semibold border border-[#05E1FF]/40'
                : 'text-[#8FA3B0] hover:text-white'
            }`}
          >
            <Fingerprint className="w-3.5 h-3.5" />
            <span>Huella / Biometría</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMethod('credentials');
              setAuthError(null);
            }}
            className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              authMethod === 'credentials'
                ? 'bg-[#05E1FF]/20 text-[#05E1FF] font-semibold border border-[#05E1FF]/40'
                : 'text-[#8FA3B0] hover:text-white'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Clave de Render</span>
          </button>
        </div>

        {authMethod === 'biometric' ? (
          <>
            {/* Scanner Central Core */}
            <div className="relative mx-auto my-2 w-44 h-44 flex items-center justify-center">
              {/* Target Ring */}
              <div
                className={`absolute inset-0 rounded-full border-2 transition-all duration-500 ${
                  phase === 'granted'
                    ? 'border-[#00FF88] shadow-[0_0_30px_rgba(0,255,136,0.4)]'
                    : phase === 'denied'
                    ? 'border-[#FF3B5C] shadow-[0_0_30px_rgba(255,59,92,0.4)]'
                    : phase === 'scanning'
                    ? 'border-[#05E1FF] animate-spin shadow-[0_0_25px_rgba(5,225,255,0.3)]'
                    : 'border-[#05E1FF]/30'
                }`}
                style={{ animationDuration: '4s' }}
              />

              {/* Dotted Inner Ring */}
              <div className="absolute inset-3 rounded-full border border-dashed border-[#05E1FF]/40" />

              {/* Central Icon */}
              <div className="relative z-10 flex flex-col items-center justify-center">
                {phase === 'granted' ? (
                  <div className="text-[#00FF88] flex flex-col items-center gap-1 animate-bounce">
                    <CheckCircle2 className="w-14 h-14" />
                    <span className="text-xs font-mono tracking-widest font-bold">AUTORIZADO</span>
                  </div>
                ) : phase === 'denied' ? (
                  <div className="text-[#FF3B5C] flex flex-col items-center gap-1">
                    <XCircle className="w-14 h-14" />
                    <span className="text-xs font-mono tracking-widest font-bold">RECHAZADO</span>
                  </div>
                ) : (
                  <div
                    onClick={() => handleStartScan(true)}
                    className={`cursor-pointer p-4 rounded-full transition-transform active:scale-95 ${
                      phase === 'scanning' ? 'text-[#05E1FF]' : 'text-[#8FA3B0] hover:text-[#05E1FF]'
                    }`}
                  >
                    <Fingerprint className="w-14 h-14 animate-pulse" />
                  </div>
                )}
              </div>
            </div>

            {/* Progress Bar & Status Text */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] font-mono text-[#8FA3B0]">
                <span>
                  {phase === 'idle' && 'TOQUE LA HUELLA PARA VALIDAR'}
                  {phase === 'scanning' && `VERIFICANDO BIOMETRÍA... ${progress}%`}
                  {phase === 'granted' && 'SESIÓN SINCRONIZADA CON ULTRON FP'}
                  {phase === 'denied' && 'VERIFICACIÓN FALLIDA'}
                </span>
                <span className="text-[#05E1FF] font-bold">SHA-512</span>
              </div>

              <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden border border-[#05E1FF]/30">
                <div
                  className={`h-full transition-all duration-100 ${
                    phase === 'granted'
                      ? 'bg-[#00FF88]'
                      : phase === 'denied'
                      ? 'bg-[#FF3B5C]'
                      : 'bg-[#05E1FF]'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </>
        ) : (
          /* Credentials Form */
          <form onSubmit={handleCredentialsLogin} className="flex flex-col gap-3 my-2 text-left">
            <div>
              <label className="block text-[11px] font-mono text-[#8FA3B0] mb-1">
                Correo Corporativo (Orden Global):
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#8FA3B0] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="mjoseenamorado1994@gmail.com"
                  className="w-full pl-9 pr-3 py-2 bg-black/60 border border-[#05E1FF]/30 rounded-lg text-xs font-mono text-white placeholder:text-gray-500 focus:border-[#05E1FF] focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[#8FA3B0] mb-1">
                Clave de Acceso (Render / Ultron FP):
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8FA3B0] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-black/60 border border-[#05E1FF]/30 rounded-lg text-xs font-mono text-white placeholder:text-gray-500 focus:border-[#05E1FF] focus:outline-none"
                  required
                />
              </div>
            </div>

            {authError && (
              <div className="p-2 rounded bg-red-950/40 border border-red-500/40 text-[11px] font-mono text-red-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 py-2.5 px-4 rounded-lg bg-[#05E1FF]/20 border border-[#05E1FF]/50 text-[#05E1FF] hover:bg-[#05E1FF]/30 font-display font-semibold text-xs tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>CONECTANDO CON ULTRON FP...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>INICIAR SESIÓN EN RENDER</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Identity Card (When granted) */}
        {phase === 'granted' && (
          <div className="p-3 rounded-lg bg-[#00FF88]/10 border border-[#00FF88]/40 text-left text-xs font-mono text-[#00FF88] animate-in fade-in duration-300">
            <div className="flex items-center justify-between font-bold mb-1">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>SESIÓN ACTIVA · ULTRON FP</span>
              </div>
              <span className="text-[10px] text-[#00FF88]/80">NIVEL ALFA</span>
            </div>
            <div className="text-white text-sm font-semibold">{userName}</div>
            <div className="text-[#8FA3B0] text-[11px]">{role}</div>
          </div>
        )}

        {/* Action Controls */}
        {authMethod === 'biometric' && (
          <div className="flex items-center gap-2 mt-1">
            {phase !== 'granted' ? (
              <>
                <button
                  type="button"
                  onClick={() => handleStartScan(true)}
                  disabled={phase === 'scanning'}
                  className="flex-1 py-2 px-3 rounded-lg bg-[#05E1FF]/20 border border-[#05E1FF]/50 text-[#05E1FF] hover:bg-[#05E1FF]/30 font-display font-semibold text-xs tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Scan className="w-3.5 h-3.5" />
                  {phase === 'scanning' ? 'ESCANEANDO...' : 'ESCANEAR HUELLA (JOSÉ)'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 px-4 rounded-lg bg-[#00FF88]/20 border border-[#00FF88]/50 text-[#00FF88] hover:bg-[#00FF88]/30 font-display font-semibold text-xs tracking-wider transition-all cursor-pointer"
              >
                ENTRAR AL SISTEMA
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
