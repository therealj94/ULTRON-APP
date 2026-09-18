import React from 'react';
import { BoardPermissionRequest } from '../types';
import { ShieldAlert, CheckCircle, XCircle } from 'lucide-react';

interface PermissionModalProps {
  request: BoardPermissionRequest | null;
  onDeny: () => void;
  onGrant: () => void;
}

export const PermissionModal: React.FC<PermissionModalProps> = ({
  request,
  onDeny,
  onGrant,
}) => {
  if (!request) return null;

  return (
    <div
      id="ultron-permission-modal"
      className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md bg-[#05080c] border border-[#05E1FF]/40 rounded-lg p-6 shadow-[0_0_30px_rgba(5,225,255,0.2)] flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#05E1FF]/20 pb-3">
          <div className="w-10 h-10 rounded-full bg-[#05E1FF]/15 border border-[#05E1FF]/40 flex items-center justify-center text-[#05E1FF]">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-mono tracking-[0.2em] text-[#8FA3B0] uppercase block">
              AUTORIZACIÓN DE JUNTA DIRECTIVA
            </span>
            <h3 className="font-display font-bold text-lg text-[#05E1FF] tracking-wide">
              {request.title}
            </h3>
          </div>
        </div>

        {/* Body content */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-mono text-[#8FA3B0] leading-relaxed">
            {request.description}
          </p>
          <div className="p-3 bg-black/60 border border-[#05E1FF]/20 rounded text-xs font-mono text-[#05E1FF]/80">
            <span className="text-[#8FA3B0] text-[10px] block mb-1 uppercase tracking-wider">
              Detalle del despacho:
            </span>
            {request.payloadSummary}
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            id="perm-btn-deny"
            onClick={onDeny}
            className="px-4 py-3 rounded border border-[#FF3B3B] bg-transparent text-[#FF3B3B] font-display font-bold text-sm tracking-wider hover:bg-[#FF3B3B]/10 transition-colors flex items-center justify-center gap-2 active:scale-95"
          >
            <XCircle className="w-4 h-4" />
            DENEGAR
          </button>

          <button
            type="button"
            id="perm-btn-grant"
            onClick={onGrant}
            className="px-4 py-3 rounded bg-[#05E1FF] text-[#001418] font-display font-bold text-sm tracking-wider hover:bg-[#05E1FF]/90 transition-all flex items-center justify-center gap-2 active:scale-95 shadow-[0_0_15px_rgba(5,225,255,0.35)]"
          >
            <CheckCircle className="w-4 h-4" />
            CONCEDER
          </button>
        </div>
      </div>
    </div>
  );
};
