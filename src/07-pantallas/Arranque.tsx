import React, { useEffect, useState } from 'react';
import { cargarPerfil, perfil as perfilActual, type PerfilPublico } from '../perfil';

/** rgba() a partir del hex del acento, para las sombras y el resplandor. */
function rgba(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(5,225,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Pantalla de inicio. El nombre y el color los pone el perfil del servidor: «AU-RA FP · powered by
 * ORDEN GLOBAL» en Genesis, «CEREBRO DE MINAS» en la plataforma de minería. Negro siempre.
 * Los ojos despiertan detrás del wordmark; se desvanece sola.
 */
export const Arranque: React.FC<{ visible: boolean; estado: string }> = ({ visible, estado }) => {
  const [fase, setFase] = useState(0);
  const [perfil, setPerfil] = useState<PerfilPublico>(perfilActual());
  useEffect(() => {
    let vivo = true;
    void cargarPerfil().then((p) => vivo && setPerfil(p));
    return () => {
      vivo = false;
    };
  }, []);
  const acento = perfil.acento;
  useEffect(() => {
    const t1 = setTimeout(() => setFase(1), 120);
    const t2 = setTimeout(() => setFase(2), 900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  return (
    <div
      id="ultron-arranque"
      aria-hidden={!visible}
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-700 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at center, ${rgba(acento, 0.1)} 0%, rgba(0,0,0,0) 55%)` }} />
      <div className="relative flex flex-col items-center gap-7">
        <div className="flex gap-9">
          {[0, 1].map((i) => (
            <span
              key={i}
              className="block rounded-full transition-all duration-700 ease-out"
              style={{
                backgroundColor: acento,
                width: 64,
                height: fase === 0 ? 4 : fase === 1 ? 22 : 64,
                boxShadow: `0 0 34px ${rgba(acento, 0.85)}, 0 0 90px ${rgba(acento, 0.35)}`,
                transform: `translateY(${fase === 2 ? 0 : 8}px)`,
              }}
            />
          ))}
        </div>
        <div
          className="flex flex-col items-center transition-all duration-700"
          style={{ opacity: fase >= 1 ? 1 : 0, transform: `translateY(${fase >= 1 ? 0 : 10}px)` }}
        >
          <div className="font-display font-bold text-3xl sm:text-4xl tracking-[0.42em] pl-[0.42em]" style={{ color: acento }}>
            {perfil.plataforma}
          </div>
          <div className="mt-2 font-mono text-[10px] sm:text-[11px] tracking-[0.34em] pl-[0.34em] uppercase" style={{ color: rgba(acento, 0.6) }}>
            powered by Orden Global
          </div>
          {perfil.demo && (
            <div className="mt-3 font-mono text-[9px] tracking-[0.3em] uppercase text-[#8FA3B0]/70">demostración · no es producción</div>
          )}
        </div>
        <div className="h-4 font-mono text-[10px] tracking-[0.25em] text-[#6B8A90] transition-opacity duration-500" style={{ opacity: fase === 2 ? 1 : 0 }}>
          {estado}
        </div>
      </div>
    </div>
  );
};
