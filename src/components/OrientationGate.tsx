import React, { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';

/** Pantalla de orientación: pide landscape (mejor experiencia LOOI). */
export const OrientationGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const check = () => {
      const isPortrait = window.matchMedia('(orientation: portrait)').matches || window.innerHeight > window.innerWidth;
      setPortrait(isPortrait);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  if (!portrait) return <>{children}</>;

  return (
    <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-[#05070a] px-6 text-center">
      <RotateCw className="h-12 w-12 animate-spin text-[#3EC9D6]" style={{ animationDuration: '3s' }} />
      <h2 className="font-display text-xl font-bold tracking-wide text-white">Gira el teléfono</h2>
      <p className="max-w-xs text-sm text-[#8B9AAB]">
        ULTRON FP está pensado en horizontal, como LOOI en el escritorio. Pon el aparato en landscape para continuar.
      </p>
    </div>
  );
};
