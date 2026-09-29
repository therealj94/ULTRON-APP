/**
 * LAS CARAS DE LOS PERSONAJES en un diálogo a varias voces.
 *
 * Dr Electrum sigue siendo la cara principal (el casco, arriba a la izquierda). Cuando se arma una
 * conversación con la ingeniera Tatiana, Don Chema o el narrador, aparece una mesa con la cara de
 * cada uno de los que participan: si son dos, dos; si son todos, todos. El que habla se agranda,
 * brilla con su color y mueve la boca con SU voz (el medidor del reproductor: en un diálogo suena
 * una voz a la vez); los demás escuchan, parpadean y lo miran.
 *
 * Quién habla lo dice la escena de voz.ts, con los tiempos por hablante que manda ElevenLabs.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { escucharEscena, nivelVoz, type Escena } from '../panel/voz';

type Rasgos = { nombre: string; papel: string; color: string; piel: string };

export const RETRATOS: Record<string, Rasgos> = {
  electrum: { nombre: 'Dr Electrum', papel: 'Geólogo', color: '#FFAE3B', piel: '#2A1E10' },
  tatiana: { nombre: 'Ing. Tatiana', papel: 'Ambiental y legal', color: '#5CD6C4', piel: '#10261F' },
  chema: { nombre: 'Don Chema', papel: 'Minero de campo', color: '#E08A5A', piel: '#2A160C' },
  narrador: { nombre: 'Narrador', papel: '', color: '#B39DFF', piel: '#1A1430' },
};

/** Una cara en SVG. `boca` 0..1 la abre; el resto (parpadeo, mirada) es CSS. */
function Cara({ quien, habla, boca }: { quien: string; habla: boolean; boca: React.RefObject<SVGEllipseElement | null> }) {
  const r = RETRATOS[quien] || RETRATOS.narrador;
  const c = r.color;
  const ojos = (
    <g className="retrato-ojos" style={{ transformOrigin: '50px 48px' }}>
      <ellipse cx="38" cy="48" rx="5" ry="6" fill={c} />
      <ellipse cx="62" cy="48" rx="5" ry="6" fill={c} />
      <circle cx="39.5" cy="46" r="1.6" fill="#fff" opacity=".85" />
      <circle cx="63.5" cy="46" r="1.6" fill="#fff" opacity=".85" />
    </g>
  );
  const bocaEl = <ellipse ref={boca} cx="50" cy="68" rx="9" ry="1.6" fill={c} opacity={habla ? 1 : 0.7} />;
  if (quien === 'narrador') {
    return (
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id="g-narrador" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor={c} stopOpacity=".55" />
            <stop offset="100%" stopColor={r.piel} stopOpacity="1" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="40" fill="url(#g-narrador)" stroke={c} strokeWidth="2" />
        {ojos}
        {bocaEl}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
      {/* cabeza */}
      <ellipse cx="50" cy="56" rx="30" ry="33" fill={r.piel} stroke={c} strokeWidth="2" />
      {quien === 'tatiana' && (
        <>
          {/* cabello a los lados y flequillo */}
          <path d="M20 58 C18 30 34 18 50 18 C66 18 82 30 80 58 L76 58 C76 38 66 28 50 28 C36 28 26 38 24 58 Z" fill={c} opacity=".85" />
          {/* lentes de seguridad */}
          <rect x="29" y="41" width="18" height="13" rx="5" fill="none" stroke={c} strokeWidth="1.8" />
          <rect x="53" y="41" width="18" height="13" rx="5" fill="none" stroke={c} strokeWidth="1.8" />
          <path d="M47 46 L53 46" stroke={c} strokeWidth="1.8" />
          {/* aretes */}
          <circle cx="21" cy="66" r="2.5" fill={c} />
          <circle cx="79" cy="66" r="2.5" fill={c} />
        </>
      )}
      {quien === 'chema' && (
        <>
          {/* sombrero de ala ancha */}
          <ellipse cx="50" cy="30" rx="44" ry="8" fill={c} opacity=".9" />
          <path d="M30 30 C30 12 70 12 70 30 Z" fill={c} />
          <path d="M31 25 L69 25" stroke={r.piel} strokeWidth="2.5" />
          {/* bigote */}
          <path d="M36 62 C42 58 47 60 50 62 C53 60 58 58 64 62 C58 66 53 64 50 63 C47 64 42 66 36 62 Z" fill={c} />
        </>
      )}
      {quien === 'electrum' && (
        <>
          {/* casco minero con lámpara */}
          <path d="M18 40 C18 16 82 16 82 40 Z" fill={c} />
          <rect x="14" y="38" width="72" height="6" rx="3" fill={c} />
          <circle cx="50" cy="28" r="6" fill="#FFF3C4" stroke={r.piel} strokeWidth="1.5" />
        </>
      )}
      {ojos}
      {bocaEl}
    </svg>
  );
}

function Retrato({ quien, habla, activo }: { quien: string; habla: boolean; activo: boolean }) {
  const r = RETRATOS[quien] || RETRATOS.narrador;
  const boca = useRef<SVGEllipseElement | null>(null);
  // La boca sigue la voz a 60 Hz sin re-renderizar: se toca el atributo del SVG directamente.
  useEffect(() => {
    if (!habla) {
      boca.current?.setAttribute('ry', '1.6');
      return;
    }
    let vivo = true;
    let t = 0;
    const paso = () => {
      if (!vivo) return;
      t += 1;
      const medido = nivelVoz();
      const n = medido >= 0 ? medido : 0.35 + 0.3 * Math.abs(Math.sin(t / 5));
      boca.current?.setAttribute('ry', String(1.6 + n * 9));
      boca.current?.setAttribute('rx', String(9 - n * 2));
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
    return () => {
      vivo = false;
    };
  }, [habla]);
  return (
    <div
      className="flex flex-col items-center transition-all duration-300"
      style={{ transform: habla ? 'scale(1.12)' : 'scale(1)', opacity: activo && !habla ? 0.62 : 1 }}
    >
      <div
        className="relative h-16 w-16 rounded-full md:h-20 md:w-20"
        style={{ boxShadow: habla ? `0 0 0 3px ${r.color}, 0 0 26px ${r.color}88` : `0 0 0 1px ${r.color}55` }}
      >
        <Cara quien={quien} habla={habla} boca={boca} />
      </div>
      <span className="mt-1 whitespace-nowrap font-mono text-[10px] tracking-[0.1em] uppercase" style={{ color: r.color }}>
        {r.nombre}
      </span>
      {r.papel && <span className="hidden whitespace-nowrap text-[9.5px] text-[#8FA2AC] md:block">{r.papel}</span>}
    </div>
  );
}

/** La mesa del diálogo: aparece con las caras de quienes participan y se va al terminar. */
export function Retratos() {
  const [escena, setEscena] = useState<Escena>({ hablante: null, participantes: null });
  useEffect(() => escucharEscena(setEscena), []);
  const participantes = escena.participantes;
  if (!participantes || participantes.length < 2) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex justify-center px-3" role="status" aria-label={`En conversación: ${participantes.map((q) => RETRATOS[q]?.nombre || q).join(', ')}`}>
      <div className="flex items-end gap-4 rounded-2xl border border-white/10 bg-black/65 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,.55)] backdrop-blur-md md:gap-6">
        {participantes.map((q) => (
          <Retrato key={q} quien={q} habla={escena.hablante === q} activo={!!escena.hablante} />
        ))}
      </div>
      <style>{'@keyframes retrato-parpadeo{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}.retrato-ojos{animation:retrato-parpadeo 4.2s infinite}'}</style>
    </div>,
    document.body
  );
}
