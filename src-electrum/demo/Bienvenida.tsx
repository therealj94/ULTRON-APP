/**
 * LA BIENVENIDA.
 *
 * Al abrir, con la cara a pantalla completa, Dr Electrum saluda según la hora de Honduras y por el
 * nombre de quien entró (su nombre de pila, o el que se le puso al código temporal) y ofrece
 * un recorrido: la Etapa 1 (la presentación, primero), herramientas, legal, geológico o completo. «Saltar» lo cierra por esta vez y «No
 * volver a mostrar» lo apaga para esa persona en este aparato. Elegir o saltar lleva al mapa.
 */
import { useEffect, useRef } from 'react';
import { headersElectrum } from '../acceso';
import { hablar } from '../panel/voz';
import { guardarPreferencia, leerPreferencia } from '../preferencias';
import { nombreDePila, saludoHonduras } from './guion';
import type { ModoRecorrido } from './Recorrido';

const AMBAR = '#FFAE3B';

const clave = (correo: string) => `bienvenida-no:${correo.trim().toLowerCase()}`;
export const bienvenidaApagada = (correo: string) => leerPreferencia<boolean>(clave(correo), false, (v) => typeof v === 'boolean');

const OPCIONES: Array<{ modo: ModoRecorrido; titulo: string; texto: string }> = [
  { modo: 'herramientas', titulo: 'Herramientas', texto: 'Los botones y qué hace cada uno' },
  { modo: 'legal', titulo: 'Legal', texto: 'Restricciones, cartera, traslapes y vencimientos' },
  { modo: 'geologico', titulo: 'Recorrido geológico', texto: 'Geología, geoquímica histórica y satélite' },
  { modo: 'completo', titulo: 'Recorrido completo', texto: 'Todo Dr Electrum en unos minutos' },
];

export function Bienvenida({
  usuario,
  onElegir,
  onSaltar,
  cara,
}: {
  usuario: { nombre: string; correo: string };
  onElegir: (m: ModoRecorrido) => void;
  onSaltar: () => void;
  cara: (f: 'IDLE' | 'SPEAKING') => void;
}) {
  const nombre = nombreDePila(usuario.nombre);
  const saludo = `${saludoHonduras()}${nombre ? `, ${nombre}` : ''}.`;
  const dicho = useRef(false);
  const c = useRef(cara);
  c.current = cara;

  // Lo dice en voz alta una vez. Si el navegador no deja sonar audio sin un toque, queda escrito.
  useEffect(() => {
    if (dicho.current) return;
    dicho.current = true;
    c.current('SPEAKING');
    void hablar(`${saludo} ¿Quiere un tutorial para aprender lo que podemos hacer?`, 'alegre', headersElectrum(), {}).finally(() => c.current('IDLE'));
  }, [saludo]);

  return (
    <div className="absolute inset-x-0 bottom-5 z-[35] flex justify-center px-4" role="dialog" aria-label="Bienvenida">
      <div className="w-full max-w-[560px] rounded-2xl border border-[#FFAE3B]/30 bg-black/80 p-4 shadow-[0_12px_40px_rgba(0,0,0,.6)] backdrop-blur-xl md:p-5">
        <p className="font-display text-[20px] font-bold leading-tight text-[#F3F6F8] md:text-[24px]">{saludo}</p>
        <p className="mt-1 text-[13.5px] leading-snug text-[#9FB0B8] md:text-[14.5px]">¿Quiere un tutorial para aprender lo que podemos hacer?</p>
        {/* La Etapa 1 es la presentación: va primero, a todo lo ancho. */}
        <button
          type="button"
          onClick={() => onElegir('etapa1')}
          className="group relative mt-3 block w-full overflow-hidden rounded-xl border border-[#FFAE3B]/60 bg-gradient-to-r from-[#FFAE3B]/[0.16] via-[#FFAE3B]/[0.06] to-transparent px-4 py-3 text-left transition-colors hover:border-[#FFAE3B] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]"
        >
          <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent" style={{ animation: 'bienvenida-brillo 3.2s ease-in-out infinite' }} />
          <span className="flex items-center justify-between gap-2">
            <span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.24em] text-[#FFAE3B]">Etapa 1</span>
              <span className="block font-display text-[17px] font-bold text-[#F3F6F8] md:text-[19px]">El Recorrido</span>
              <span className="block text-[11.5px] leading-snug text-[#C9D4DA] md:text-[12.5px]">De la premisa geológica a la decisión del inversionista, en 12 pasos</span>
            </span>
            <span className="shrink-0 rounded-full bg-[#FFAE3B] px-3 py-1 text-[12px] font-bold text-black">▶ Ver</span>
          </span>
          <style>{'@keyframes bienvenida-brillo{0%{transform:translateX(0)}60%,100%{transform:translateX(420%)}}'}</style>
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {OPCIONES.map((o) => (
            <button
              key={o.modo}
              type="button"
              onClick={() => onElegir(o.modo)}
              className="rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2.5 text-left transition-colors hover:border-[#FFAE3B]/60 hover:bg-[#FFAE3B]/[0.08] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]"
            >
              <span className="block text-[14px] font-semibold md:text-[15px]" style={{ color: o.modo === 'completo' ? AMBAR : '#F3F6F8' }}>
                {o.titulo}
              </span>
              <span className="block text-[11.5px] leading-snug text-[#8FA3B0] md:text-[12px]">{o.texto}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              guardarPreferencia(clave(usuario.correo), true);
              onSaltar();
            }}
            className="text-[12px] text-[#7F939D] underline-offset-2 hover:text-[#DCE5EA] hover:underline cursor-pointer"
          >
            No volver a mostrar
          </button>
          <button type="button" onClick={onSaltar} className="rounded-lg border border-white/15 px-4 py-1.5 font-mono text-[11px] tracking-[0.12em] uppercase text-[#DCE5EA] hover:border-white/35 cursor-pointer">
            Saltar ▸
          </button>
        </div>
      </div>
    </div>
  );
}
