import React, { useState, useEffect } from 'react';
import { Fingerprint, ShieldCheck, ShieldAlert, Scan, CheckCircle2, XCircle, X } from 'lucide-react';
import { playSfx } from '../utils/audio';

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
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'granted' | 'denied'>('idle');
  const [progress, setProgress] = useState(0);
  const [userName, setUserName] = useState('Director Ejecutivo Amir');
  const [role, setRole] = useState('Miembro Permanente del Directorio · Nivel Alfa');

  useEffect(() => {
    if (!isOpen) {
      setPhase('idle');
      setProgress(0);
    }
  }, [isOpen]);

  const handleStartScan = (shouldSucceed = true) => {
    setPhase('scanning');
    setProgress(0);
    playSfx('biometric_scan', soundFxEnabled);

    let current = 0;
    const interval = setInterval(() => {
      current += 4;
      setProgress(current);

      if (current % 20 === 0) {
        playSfx('biometric_scan', soundFxEnabled);
      }

      if (current >= 100) {
        clearInterval(interval);
        if (shouldSucceed) {
          setPhase('granted');
          playSfx('biometric_success', soundFxEnabled);
          onAuthSuccess(userName, role);
          onSpeak(`Identidad biométrica verificada. Bienvenido, ${userName}. Acceso nivel Alfa concedido.`);
        } else {
          setPhase('denied');
          playSfx('biometric_fail', soundFxEnabled);
          onSpeak('Alerta de seguridad. Huella o patrón facial no reconocido por el Directorio.');
        }
      }
    }, 50);
  };

  if (!isOpen) return null;

  return (
    <div
      id="ultron-biometric-modal"
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md bg-[#05080c] border border-[#05E1FF]/40 rounded-2xl p-6 shadow-[0_0_35px_rgba(5,225,255,0.25)] flex flex-col gap-5 text-center relative overflow-hidden">
        {/* Background Grid Accent */}
        <div className="absolute inset-0 bg-[radial-gradient(#05E1FF_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded text-[#8FA3B0] hover:text-[#05E1FF] transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Title */}
        <div>
          <span className="text-[10px] font-mono tracking-[0.25em] text-[#8FA3B0] uppercase block">
            SISTEMA BIOMÉTRICO RETINIANO & DACTILAR
          </span>
          <h2 className="font-display font-bold text-xl text-[#05E1FF] tracking-wider mt-0.5">
            AUTENTICACIÓN DE DIRECTORIO
          </h2>
        </div>

        {/* Scanner Central Core */}
        <div className="relative mx-auto my-2 w-48 h-48 flex items-center justify-center">
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

          {/* Scanning Beam (Active only during scan) */}
          {phase === 'scanning' && (
            <div className="absolute inset-x-4 h-1 bg-gradient-to-r from-transparent via-[#05E1FF] to-transparent shadow-[0_0_15px_#05E1FF] animate-pulse" />
          )}

          {/* Central Icon */}
          <div className="relative z-10 flex flex-col items-center justify-center">
            {phase === 'granted' ? (
              <div className="text-[#00FF88] flex flex-col items-center gap-1 animate-bounce">
                <CheckCircle2 className="w-16 h-16" />
                <span className="text-xs font-mono tracking-widest font-bold">AUTORIZADO</span>
              </div>
            ) : phase === 'denied' ? (
              <div className="text-[#FF3B5C] flex flex-col items-center gap-1">
                <XCircle className="w-16 h-16" />
                <span className="text-xs font-mono tracking-widest font-bold">RECHAZADO</span>
              </div>
            ) : (
              <div
                onClick={() => handleStartScan(true)}
                className={`cursor-pointer p-4 rounded-full transition-transform active:scale-95 ${
                  phase === 'scanning' ? 'text-[#05E1FF]' : 'text-[#8FA3B0] hover:text-[#05E1FF]'
                }`}
              >
                <Fingerprint className="w-16 h-16 animate-pulse" />
              </div>
            )}
          </div>
        </div>

        {/* Progress Bar & Status Text */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[11px] font-mono text-[#8FA3B0]">
            <span>
              {phase === 'idle' && 'TOQUE LA HUELLA PARA ESCANEAR'}
              {phase === 'scanning' && `ESCANEANDO BIOMETRÍA... ${progress}%`}
              {phase === 'granted' && 'CONFIRMACIÓN CRIPTOGRÁFICA OK'}
              {phase === 'denied' && 'VERIFICACIÓN FALLIDA'}
            </span>
            <span className="text-[#05E1FF] font-bold">SHA-512 SECURE</span>
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

        {/* Identity Card (When granted) */}
        {phase === 'granted' && (
          <div className="p-3 rounded-lg bg-[#00FF88]/10 border border-[#00FF88]/40 text-left text-xs font-mono text-[#00FF88]">
            <div className="flex items-center gap-1.5 font-bold mb-1">
              <ShieldCheck className="w-4 h-4" />
              <span>CREDENCIAL BIOMÉTRICA ACTIVA</span>
            </div>
            <div className="text-white text-sm font-semibold">{userName}</div>
            <div className="text-[#8FA3B0] text-[11px]">{role}</div>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center gap-2 mt-2">
          {phase !== 'granted' ? (
            <>
              <button
                type="button"
                onClick={() => handleStartScan(true)}
                disabled={phase === 'scanning'}
                className="flex-1 py-2.5 px-4 rounded-lg bg-[#05E1FF]/20 border border-[#05E1FF]/50 text-[#05E1FF] hover:bg-[#05E1FF]/30 font-display font-semibold text-xs tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Scan className="w-4 h-4" />
                {phase === 'scanning' ? 'ESCANEANDO...' : 'INICIAR ESCANEO'}
              </button>
              <button
                type="button"
                onClick={() => handleStartScan(false)}
                disabled={phase === 'scanning'}
                title="Probar denegación de acceso"
                className="py-2.5 px-3 rounded-lg bg-[#FF3B5C]/15 border border-[#FF3B5C]/40 text-[#FF3B5C] hover:bg-[#FF3B5C]/25 text-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <ShieldAlert className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 px-4 rounded-lg bg-[#00FF88]/20 border border-[#00FF88]/50 text-[#00FF88] hover:bg-[#00FF88]/30 font-display font-semibold text-xs tracking-wider transition-all cursor-pointer"
            >
              ACCEDER AL TERMINAL EJECUTIVO
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
