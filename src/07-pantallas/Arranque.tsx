import React, { useEffect, useState } from 'react';
import { cargarPerfil, perfil as perfilActual, type PerfilPublico } from '../perfil';

/**
 * Pantalla de inicio de AU-RA: el logo sobre crema, cómo va el arranque y tres puntos que respiran.
 * Se desvanece sola; detrás, AU-RA ya está entrando a su sala.
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
  useEffect(() => {
    const t1 = setTimeout(() => setFase(1), 80);
    const t2 = setTimeout(() => setFase(2), 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  return (
    <div
      id="ultron-arranque"
      aria-hidden={!visible}
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#FEF9F3] transition-opacity duration-700 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="relative flex flex-col items-center gap-6 px-6">
        <img
          src="/marca/logo-aura.png"
          alt="AU-RA by Orden Global"
          draggable={false}
          className="w-[min(420px,78vw)] h-auto transition-all duration-700 ease-out"
          style={{ opacity: fase >= 1 ? 1 : 0, transform: `translateY(${fase >= 1 ? 0 : 12}px) scale(${fase >= 1 ? 1 : 0.97})` }}
        />
        {perfil.demo && <div className="text-[12px] font-medium text-[#8B7E72]">Demostración · no es producción</div>}
        <div className="flex flex-col items-center gap-3 transition-opacity duration-500" style={{ opacity: fase === 2 ? 1 : 0 }}>
          <div className="flex gap-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-2.5 h-2.5 rounded-full bg-[#E2A83E] animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
          <div className="h-5 text-[14px] text-[#6B6056]">{estado}</div>
        </div>
      </div>
    </div>
  );
};
