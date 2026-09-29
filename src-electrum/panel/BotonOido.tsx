/**
 * EL BOTÓN DEL MICRÓFONO, arriba a la izquierda y siempre a la vista.
 *
 * Dos modos, y se ve en cuál se está:
 *  · «Micrófono abierto» (por omisión): Dr Electrum escucha todo el tiempo. Un punto que respira y
 *    tres barras que siguen la voz; cuando oye a alguien dice «Te escucho…».
 *  · «Tocar para hablar»: el micrófono se apaga y cada toque escucha UNA frase.
 * El interruptor «Siempre» cambia de modo. Lo último que entendió aparece un momento debajo.
 */
import { useEffect, useState } from 'react';
import type { EstadoOido } from './oido';

const AMBAR = '#FFAE3B';
const ROJO = '#FF5A5A';

export type ModoOido = 'siempre' | 'tocar';

export function BotonOido({
  modo,
  estado,
  nivel,
  oido,
  onModo,
  onTocar,
}: {
  modo: ModoOido;
  estado: EstadoOido;
  /** 0..1, para las barras. */
  nivel: () => number;
  /** Lo último que entendió (se muestra unos segundos). */
  oido: string;
  onModo: (m: ModoOido) => void;
  /** En «tocar para hablar»: escuchar una frase. En «siempre»: reintentar si no hay permiso. */
  onTocar: () => void;
}) {
  const [barras, setBarras] = useState([0.2, 0.2, 0.2]);
  const activo = estado === 'escuchando' || estado === 'oyendo' || estado === 'pasando';
  useEffect(() => {
    if (!activo) return setBarras([0.2, 0.2, 0.2]);
    const t = window.setInterval(() => {
      const n = nivel();
      setBarras([Math.max(0.2, n * 0.8), Math.max(0.2, n), Math.max(0.2, n * 0.65)]);
    }, 90);
    return () => clearInterval(t);
  }, [activo, nivel]);

  const [visto, setVisto] = useState('');
  useEffect(() => {
    if (!oido) return;
    setVisto(oido);
    const t = window.setTimeout(() => setVisto(''), 4500);
    return () => clearTimeout(t);
  }, [oido]);

  const bloqueado = estado === 'sin-permiso' || estado === 'sin-soporte';
  const etiqueta =
    estado === 'sin-permiso'
      ? 'Permitir micrófono'
      : estado === 'sin-soporte'
        ? 'Sin micrófono'
        : estado === 'pidiendo'
          ? 'Pidiendo permiso…'
          : estado === 'oyendo'
            ? 'Te escucho…'
            : estado === 'pasando'
              ? 'Entendiendo…'
              : modo === 'siempre'
                ? 'Micrófono abierto'
                : 'Tocar para hablar';
  const color = bloqueado ? '#7F939D' : estado === 'oyendo' ? ROJO : activo ? AMBAR : '#9FB0B8';

  return (
    <div className="pointer-events-auto relative" data-tour="microfono">
      <div className="flex items-center rounded-full border border-white/12 bg-black/55 backdrop-blur-md" style={estado === 'oyendo' ? { borderColor: `${ROJO}88` } : undefined}>
        <button
          type="button"
          onClick={onTocar}
          className="flex items-center gap-2 whitespace-nowrap rounded-full py-1.5 pl-3 pr-2 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]"
          title={modo === 'siempre' ? 'Dr Electrum le escucha todo el tiempo: pregúntele en voz alta o diga «siguiente», «acércate», «cierra la ventana»' : 'Toque y hable: escucho una frase'}
          aria-label={etiqueta}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" fill={activo ? `${color}33` : 'none'} />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            {bloqueado && <path d="M4 4l16 16" stroke={ROJO} />}
          </svg>
          {activo && (
            <span className="flex h-3.5 items-end gap-[2px]" aria-hidden="true">
              {barras.map((b, k) => (
                <span key={k} className="w-[3px] rounded-full transition-[height] duration-100" style={{ height: `${Math.round(b * 14)}px`, background: color }} />
              ))}
            </span>
          )}
          <span className="font-mono text-[10.5px] tracking-[0.1em] uppercase" style={{ color }}>
            <span className="hidden sm:inline">{etiqueta}</span>
            <span className="sm:hidden">{estado === 'oyendo' ? 'Te oigo' : modo === 'siempre' ? (bloqueado ? 'Mic' : 'Abierto') : 'Hablar'}</span>
          </span>
        </button>
        {/* El interruptor de modo: encendido = siempre escuchando. */}
        <button
          type="button"
          role="switch"
          aria-checked={modo === 'siempre'}
          onClick={() => onModo(modo === 'siempre' ? 'tocar' : 'siempre')}
          className="mr-1.5 flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-1 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]"
          title={modo === 'siempre' ? 'Pasar a «tocar para hablar»' : 'Dejar el micrófono siempre abierto'}
        >
          <span className="hidden font-mono text-[9.5px] tracking-[0.1em] uppercase text-[#7F939D] md:inline">Siempre</span>
          <span className="relative h-4 w-7 rounded-full transition-colors" style={{ background: modo === 'siempre' ? `${AMBAR}cc` : 'rgba(255,255,255,.18)' }}>
            <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all" style={{ left: modo === 'siempre' ? 14 : 2 }} />
          </span>
        </button>
      </div>
      {visto && (
        <div className="absolute left-0 top-[calc(100%+6px)] max-w-[70vw] truncate rounded-lg border border-white/10 bg-black/80 px-2.5 py-1 text-[12px] text-[#DCE5EA] shadow-lg backdrop-blur" role="status">
          «{visto}»
        </div>
      )}
    </div>
  );
}
