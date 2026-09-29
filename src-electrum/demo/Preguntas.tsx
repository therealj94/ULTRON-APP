/**
 * AL TERMINAR EL RECORRIDO: «¿Tiene alguna pregunta?».
 *
 * Dr Electrum pregunta en voz alta y escucha (el micrófono abierto le entrega lo que se diga). Si
 * la respuesta es una pregunta, la manda al cerebro como cualquier consulta, espera a que termine
 * de contestar y ofrece seguir: «¿Algo más, o le muestro otro recorrido?». Un «no, gracias» cierra;
 * «muéstreme lo legal» arranca ese recorrido. Todo también con botones, para quien no quiere hablar.
 */
import { useEffect, useRef, useState } from 'react';
import { headersElectrum } from '../acceso';
import { hablar } from '../panel/voz';
import { capturarDicho } from '../panel/oido';
import { esAfirmativa, esNegativa, recorridoPedido } from '../panel/comandos';
import type { ModoRecorrido } from './Recorrido';

const AMBAR = '#FFAE3B';
/** Si nadie dice nada en este rato, se despide solo y deja la pantalla libre. */
const ESPERA_MS = 45_000;

const OTROS: Array<{ modo: ModoRecorrido; titulo: string }> = [
  { modo: 'herramientas', titulo: 'Herramientas' },
  { modo: 'legal', titulo: 'Legal' },
  { modo: 'geologico', titulo: 'Geológico' },
  { modo: 'completo', titulo: 'Completo' },
];

export function Preguntas({
  onPreguntar,
  onOtro,
  onCerrar,
  cara,
}: {
  onPreguntar: (texto: string) => void;
  onOtro: (modo: ModoRecorrido) => void;
  onCerrar: () => void;
  cara: (f: 'IDLE' | 'SPEAKING' | 'THINKING') => void;
}) {
  const [texto, setTexto] = useState('¿Tiene alguna pregunta? Dígamela en voz alta o escríbala abajo.');
  const [esperando, setEsperando] = useState(false);
  const c = useRef({ onPreguntar, onOtro, onCerrar, cara });
  c.current = { onPreguntar, onOtro, onCerrar, cara };
  const vivo = useRef(true);

  const decir = async (t: string, emocion = 'feliz') => {
    setTexto(t);
    c.current.cara('SPEAKING');
    await hablar(t, emocion, headersElectrum(), {}).catch(() => undefined);
    if (vivo.current) c.current.cara('IDLE');
  };

  useEffect(() => {
    vivo.current = true;
    let reloj = window.setTimeout(() => void despedir(), ESPERA_MS);
    const reiniciar = () => {
      clearTimeout(reloj);
      reloj = window.setTimeout(() => void despedir(), ESPERA_MS);
    };
    const despedir = async () => {
      if (!vivo.current) return;
      await decir('Perfecto. Cuando quiera, aquí estoy: pregúnteme lo que necesite.');
      c.current.onCerrar();
    };
    // Cuando termina de contestar una pregunta (hablada o escrita), ofrece seguir.
    const alResponder = () => {
      if (!vivo.current) return;
      setEsperando(false);
      reiniciar();
      void decir('¿Algo más? También le puedo mostrar otro recorrido.');
    };
    window.addEventListener('electrum:respondido', alResponder);
    const soltar = capturarDicho((dicho) => {
      reiniciar();
      if (esNegativa(dicho)) {
        void despedir();
        return true;
      }
      const otro = recorridoPedido(dicho);
      if (otro) {
        c.current.onOtro(otro);
        return true;
      }
      if (esAfirmativa(dicho)) {
        void decir('Dígame.');
        return true;
      }
      // Una pregunta de verdad: al cerebro, como cualquier consulta.
      setEsperando(true);
      setTexto(`«${dicho}»`);
      c.current.onPreguntar(dicho);
      return true;
    });
    void decir('¿Tiene alguna pregunta? Dígamela en voz alta, o escríbala abajo.');
    return () => {
      vivo.current = false;
      clearTimeout(reloj);
      soltar();
      window.removeEventListener('electrum:respondido', alResponder);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute inset-x-0 bottom-3 z-[32] flex justify-center px-3" role="dialog" aria-label="¿Alguna pregunta?">
      <div className="w-full max-w-[520px] rounded-2xl border border-[#FFAE3B]/30 bg-black/85 p-4 shadow-[0_12px_40px_rgba(0,0,0,.6)] backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: AMBAR }} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: AMBAR }} />
          </span>
          <span className="font-mono text-[10.5px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
            {esperando ? 'Buscando la respuesta…' : 'Lo escucho'}
          </span>
          <button type="button" onClick={onCerrar} className="ml-auto rounded-md px-1.5 text-[13px] text-[#9FB0B8] hover:text-white cursor-pointer" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <p className="mt-2 text-[14px] leading-snug text-[#F3F6F8] md:text-[15px]">{texto}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-[#7F939D]">Otro recorrido</span>
          {OTROS.map((o) => (
            <button
              key={o.modo}
              type="button"
              onClick={() => onOtro(o.modo)}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[12px] text-[#DCE5EA] hover:border-[#FFAE3B]/60 hover:bg-[#FFAE3B]/[0.08] cursor-pointer"
            >
              {o.titulo}
            </button>
          ))}
          <button type="button" onClick={onCerrar} className="ml-auto rounded-lg border border-white/15 px-3 py-1 font-mono text-[11px] tracking-[0.1em] uppercase text-[#DCE5EA] hover:border-white/35 cursor-pointer">
            No, gracias
          </button>
        </div>
      </div>
    </div>
  );
}
