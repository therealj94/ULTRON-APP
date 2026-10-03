import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

/**
 * «Hay una versión nueva de AU-RA · Recargar» (IOS02). La versión nueva del service worker espera; solo
 * este toque la aplica, así nunca se recarga en medio de una llamada, de entrar o de un envío. Y si al tocar
 * hay algo en curso (una llamada en vivo, una decisión, el control de su computadora), espera a que termine
 * y lo dice (AUR14, 10-infra/pwa.ts).
 */
export const AvisoVersion: React.FC<{ visible: boolean; onRecargar: () => void | 'recargando' | 'esperando'; onLuego: () => void }> = ({ visible, onRecargar, onLuego }) => {
  const [esperando, setEsperando] = useState(false);
  if (!visible) return null;
  if (esperando)
    return (
      <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-50 max-w-[calc(100vw-32px)] px-4 py-2 rounded-full bg-(--aura-panel) border border-(--aura-borde) shadow-[0_8px_24px_rgba(0,0,0,0.35)] text-[14px] text-(--aura-tinta)">
        <span className="truncate">La versión nueva se aplica al terminar lo que está en curso</span>
      </div>
    );
  return (
    <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-50 max-w-[calc(100vw-32px)] flex items-center gap-2 pl-4 pr-2 py-2 rounded-full bg-(--aura-panel) border border-(--aura-borde) shadow-[0_8px_24px_rgba(0,0,0,0.35)] text-[14px] text-(--aura-tinta)">
      <span className="truncate">Hay una versión nueva de AU-RA</span>
      <button type="button" onClick={() => setEsperando(onRecargar() === 'esperando')} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-(--aura-oro) text-(--aura-fondo) font-semibold cursor-pointer">
        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Recargar
      </button>
      <button type="button" onClick={onLuego} aria-label="Más tarde" className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-(--aura-tinta-2) hover:bg-(--aura-panel-2) cursor-pointer">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
