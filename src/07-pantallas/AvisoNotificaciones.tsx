import React from 'react';
import { Bell, X } from 'lucide-react';

/**
 * «¿Te aviso aunque AU-RA esté cerrada? · Activar» (IOS02). El permiso de avisos solo se puede pedir con un
 * toque de la persona (en iPhone, además, solo desde la AU-RA instalada): por eso se ofrece aquí y nunca se
 * abre la ventana del sistema por sorpresa. «Luego» lo esconde una semana.
 */
export const AvisoNotificaciones: React.FC<{ visible: boolean; ocupado: boolean; onActivar: () => void; onLuego: () => void }> = ({ visible, ocupado, onActivar, onLuego }) => {
  if (!visible) return null;
  return (
    <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-50 max-w-[calc(100vw-32px)] flex items-center gap-2 pl-4 pr-2 py-2 rounded-full bg-(--aura-panel) border border-(--aura-borde) shadow-[0_8px_24px_rgba(0,0,0,0.35)] text-[14px] text-(--aura-tinta)">
      <span className="truncate">¿Te aviso aunque AU-RA esté cerrada?</span>
      <button type="button" disabled={ocupado} onClick={onActivar} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-(--aura-oro) text-(--aura-fondo) font-semibold cursor-pointer disabled:opacity-60">
        <Bell className="w-3.5 h-3.5" aria-hidden="true" /> {ocupado ? 'Activando…' : 'Activar'}
      </button>
      <button type="button" onClick={onLuego} aria-label="Luego" className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-(--aura-tinta-2) hover:bg-(--aura-panel-2) cursor-pointer">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
