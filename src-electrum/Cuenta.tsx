/**
 * La cuenta, desde dentro de Dr Electrum: cambiar la contraseña y —solo quien aprueba— las
 * solicitudes de acceso. Las pantallas son las compartidas con AU-RA (src/cuentas); aquí van el
 * tema oscuro de la estación y el marco.
 */
import { useEffect, useState } from 'react';
import { CambiarClave, PanelCodigos, PanelSolicitudes, type Tema } from '../src/cuentas/Cuentas';
import { guardarSesion, headersElectrum } from './acceso';

const AMBAR = '#FFAE3B';

export const TEMA_ELECTRUM: Tema = {
  campo:
    'w-full rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2.5 text-[15px] text-[#E7EEF2] placeholder:text-[#7D909A] outline-none focus:border-[#FFAE3B]/60 transition-colors',
  boton: 'w-full rounded-lg py-2.5 text-[15px] font-semibold text-black transition-opacity disabled:opacity-35 cursor-pointer',
  botonStyle: { background: AMBAR },
  secundario: 'w-full rounded-lg py-2.5 text-[15px] font-semibold border border-white/15 text-[#E7EEF2] hover:bg-white/[0.06] disabled:opacity-35 cursor-pointer',
  enlace: 'w-full text-center text-[12px] text-[#8FA3B0] hover:text-[#E7EEF2] transition-colors cursor-pointer',
  titulo: 'text-[17px] font-semibold text-[#F3F6F8]',
  texto: 'text-[13px] leading-relaxed text-[#9FB0B8]',
  error: 'rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed border-[rgba(255,120,90,0.3)] bg-[rgba(255,120,90,0.07)] text-[#FFB0A0]',
  ok: 'rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed border-[rgba(46,204,113,0.3)] bg-[rgba(46,204,113,0.07)] text-[#9BE8B9]',
  tarjeta: 'rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[#E7EEF2]',
};

export function Cuenta({
  abierta,
  inicio = 'clave',
  pendientes,
  onPendientes,
  onCerrar,
}: {
  abierta: boolean;
  inicio?: 'clave' | 'solicitudes' | 'codigos';
  pendientes: number | null;
  onPendientes: (n: number) => void;
  onCerrar: () => void;
}) {
  const [pestana, setPestana] = useState<'clave' | 'solicitudes' | 'codigos'>(inicio);
  useEffect(() => {
    if (abierta) setPestana(pendientes === null ? 'clave' : inicio);
  }, [abierta, inicio, pendientes]);
  useEffect(() => {
    if (!abierta) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [abierta, onCerrar]);
  if (!abierta) return null;
  const aprueba = pendientes !== null;
  return (
    <div className="absolute inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm px-4 py-16" role="dialog" aria-label="Tu cuenta" onClick={onCerrar}>
      <div className="relative w-full max-w-[460px] rounded-2xl border border-white/10 bg-[#0b0e11] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="absolute right-3 top-3 h-8 w-8 rounded-full text-[18px] text-[#8FA3B0] hover:bg-white/10 hover:text-white cursor-pointer">
          ×
        </button>
        {aprueba && (
          <div className="mb-4 flex gap-1 rounded-full border border-white/10 p-1 w-fit">
            {(
              [
                ['clave', 'Contraseña'],
                ['solicitudes', `Solicitudes${pendientes ? ` · ${pendientes}` : ''}`],
                ['codigos', 'Códigos'],
              ] as const
            ).map(([id, txt]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPestana(id)}
                aria-pressed={pestana === id}
                className={`rounded-full px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] cursor-pointer ${pestana === id ? 'text-black' : 'text-[#9FB0B8] hover:text-white'}`}
                style={pestana === id ? { background: AMBAR } : undefined}
              >
                {txt}
              </button>
            ))}
          </div>
        )}
        {pestana === 'solicitudes' && aprueba ? (
          <PanelSolicitudes tema={TEMA_ELECTRUM} headers={headersElectrum} onCambio={onPendientes} />
        ) : pestana === 'codigos' && aprueba ? (
          <PanelCodigos tema={TEMA_ELECTRUM} headers={headersElectrum} />
        ) : (
          <CambiarClave tema={TEMA_ELECTRUM} headers={headersElectrum} onListo={(t) => guardarSesion(t)} />
        )}
      </div>
    </div>
  );
}
