import React, { useEffect, useState } from 'react';

/**
 * Bienvenida animada con el logo ULTRON (ojo cibernético cyan).
 * Secuencia: glow → anillos dibujados → pupil pulse → marca → listo.
 */
interface WelcomeBootScreenProps {
  visible: boolean;
  userName?: string;
  onFinished?: () => void;
}

export const WelcomeBootScreen: React.FC<WelcomeBootScreenProps> = ({
  visible,
  userName,
  onFinished,
}) => {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!visible) {
      setPhase(0);
      return;
    }
    const steps = [0, 1, 2, 3, 4];
    const timers = steps.map((s, i) =>
      setTimeout(() => {
        setPhase(s);
        if (s === 4) onFinished?.();
      }, 280 + i * 520)
    );
    return () => timers.forEach(clearTimeout);
  }, [visible, onFinished]);

  if (!visible && phase === 0) return null;

  return (
    <div
      id="ultron-boot-screen"
      className={`absolute inset-0 z-50 flex items-center justify-center transition-opacity duration-700 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        background:
          'radial-gradient(70% 55% at 50% 42%, rgba(0,229,255,0.14), #000 62%), #000',
      }}
      aria-hidden={!visible}
    >
      <div className="relative flex flex-col items-center gap-5">
        <div
          className="relative flex h-36 w-36 items-center justify-center"
          style={{
            filter: phase >= 1 ? 'drop-shadow(0 0 28px rgba(0,229,255,0.55))' : 'none',
            transition: 'filter 0.6s ease',
          }}
        >
          <img
            src="/brand/ultron-logo.jpg"
            alt="ULTRON"
            className="h-full w-full object-contain"
            style={{
              opacity: phase >= 1 ? 1 : 0,
              transform: `scale(${phase >= 1 ? 1 : 0.82})`,
              transition: 'opacity 0.7s ease, transform 0.85s cubic-bezier(0.22,1,0.36,1)',
              animation: phase >= 2 ? 'ultron-logo-breathe 2.4s ease-in-out infinite' : 'none',
            }}
          />
          {/* Anillo de escaneo */}
          <div
            className="pointer-events-none absolute inset-[-8%] rounded-full border border-[#00E5FF]/35"
            style={{
              opacity: phase >= 2 ? 1 : 0,
              animation: phase >= 2 ? 'ultron-ring-spin 6s linear infinite' : 'none',
              transition: 'opacity 0.5s',
            }}
          />
          <div
            className="pointer-events-none absolute inset-[-18%] rounded-full border border-dashed border-[#00E5FF]/20"
            style={{
              opacity: phase >= 2 ? 1 : 0,
              animation: phase >= 2 ? 'ultron-ring-spin-rev 9s linear infinite' : 'none',
              transition: 'opacity 0.5s',
            }}
          />
        </div>

        <div
          className="text-center"
          style={{
            opacity: phase >= 3 ? 1 : 0,
            transform: `translateY(${phase >= 3 ? 0 : 10}px)`,
            transition: 'opacity 0.5s ease, transform 0.5s ease',
          }}
        >
          <h1 className="font-display text-3xl font-bold tracking-[0.32em] text-[#E8FBFF]">
            ULTRON FP
          </h1>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.28em] text-[#00E5FF]/80">
            {userName ? `Bienvenido, ${userName}` : 'Núcleo óptico en línea'}
          </p>
        </div>

        <div
          className="h-0.5 w-40 overflow-hidden rounded-full bg-white/10"
          style={{ opacity: phase >= 2 && phase < 4 ? 1 : 0, transition: 'opacity 0.3s' }}
        >
          <div className="h-full w-1/2 animate-[ultron-boot-bar_1.1s_ease-in-out_infinite] bg-[#00E5FF]" />
        </div>
      </div>

      <style>{`
        @keyframes ultron-logo-breathe {
          0%, 100% { filter: brightness(1); transform: scale(1); }
          50% { filter: brightness(1.18); transform: scale(1.03); }
        }
        @keyframes ultron-ring-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ultron-ring-spin-rev {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes ultron-boot-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(220%); }
        }
      `}</style>
    </div>
  );
};
