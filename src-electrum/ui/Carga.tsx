/**
 * LA CARGA: lo primero que se ve. El emblema de oro girando sobre el terreno vivo, el nombre que
 * aparece letra a letra y lo que se va preparando, con su barra. Sirve para comprobar el acceso al
 * abrir y para la entrada a la estación después de iniciar sesión (`Cortina`), que se desvanece
 * sola cuando la estación está lista.
 */
import { useEffect, useState } from 'react';
import { Emblema, Topografia } from './Topografia';

const ORO = '#FFAE3B';

const PASOS_ACCESO = ['Comprobando el acceso', 'Conectando con el catastro de Honduras', 'Despertando a Dr Electrum'];
const PASOS_ESTACION = ['Abriendo el catastro minero', 'Cargando el mapa en tres dimensiones', 'Preparando la mesa técnica', 'Su estación de trabajo está lista'];

export function Carga({ pasos = PASOS_ACCESO, ritmo = 1400, saliendo = false }: { pasos?: string[]; ritmo?: number; saliendo?: boolean }) {
  const [k, setK] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setK((x) => Math.min(pasos.length - 1, x + 1)), ritmo);
    return () => clearInterval(t);
  }, [pasos, ritmo]);
  const progreso = (k + 1) / pasos.length;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-[#050607]"
      role="status"
      aria-live="polite"
      style={{ animation: saliendo ? 'cg-salir .8s cubic-bezier(.4,0,.2,1) forwards' : 'cg-entrar .5s ease-out both' }}
    >
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 45%, #14100A 0%, #070708 55%, #030304 100%)' }} />
      <Topografia intensidad={0.9} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,.75) 100%)' }} />
      <div className="relative flex flex-col items-center px-6 text-center">
        <Emblema tam={124} progreso={progreso} />
        <div className="mt-7 font-display text-[30px] font-bold tracking-[0.42em] md:text-[38px]" aria-label="Dr Electrum">
          {'DR ELECTRUM'.split('').map((l, i) => (
            <span key={i} className="inline-block" style={{ color: '#F7E3BA', textShadow: '0 0 24px rgba(255,174,59,.45)', animation: `cg-letra .7s cubic-bezier(.2,.8,.2,1) ${0.15 + i * 0.05}s both` }}>
              {l === ' ' ? ' ' : l}
            </span>
          ))}
        </div>
        <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.34em] text-[#8FA3B0]" style={{ animation: 'cg-letra .8s ease-out .8s both' }}>
          Inteligencia geológico-minera · Honduras
        </div>
        <div className="mt-9 h-[2px] w-[min(280px,70vw)] overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full" style={{ width: `${progreso * 100}%`, background: `linear-gradient(90deg, #B86B0C, ${ORO}, #FFE3A3)`, boxShadow: `0 0 12px ${ORO}`, transition: 'width .7s cubic-bezier(.2,.8,.2,1)' }} />
        </div>
        <div key={k} className="mt-3 min-h-[18px] font-mono text-[11px] tracking-[0.12em] text-[#C9D4DA]" style={{ animation: 'cg-texto .45s ease-out both' }}>
          {pasos[k]}
          {k < pasos.length - 1 && <span style={{ animation: 'cg-parpadeo 1.1s ease-in-out infinite' }}>…</span>}
        </div>
      </div>
      <style>{`
@keyframes cg-entrar{from{opacity:0}to{opacity:1}}
@keyframes cg-salir{0%{opacity:1;filter:none;transform:none}100%{opacity:0;filter:blur(6px);transform:scale(1.04)}}
@keyframes cg-letra{from{opacity:0;transform:translateY(10px);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
@keyframes cg-texto{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes cg-parpadeo{0%,100%{opacity:.25}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){[role=status] *{animation-duration:.01s!important}}
`}</style>
    </div>
  );
}

/**
 * La cortina de entrada: después de iniciar sesión, la estación se arma detrás mientras esto cuenta
 * lo que se prepara; luego se desvanece y deja ver el mapa.
 */
export function Cortina({ ms = 2600, alTerminar }: { ms?: number; alTerminar: () => void }) {
  const [saliendo, setSaliendo] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setSaliendo(true), ms);
    const b = setTimeout(alTerminar, ms + 800);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [ms, alTerminar]);
  return <Carga pasos={PASOS_ESTACION} ritmo={Math.max(400, ms / PASOS_ESTACION.length)} saliendo={saliendo} />;
}
