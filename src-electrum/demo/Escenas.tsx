/**
 * LAS ESCENAS DE LA ETAPA 1: lo que aparece sobre el mapa mientras el equipo cuenta el recorrido.
 *
 *  · `Escenario`: una escena a la vez (la apertura, el equipo, la fórmula del riesgo, la ecuación
 *    del target, los sellos, el catastro, el marco legal, la carpeta, la perforación, la decisión,
 *    la ficha de factibilidad y el cierre), cada una con su entrada animada.
 *  · `Flujo`: los 12 pasos del documento, siempre a la vista, con el paso en curso encendido.
 *  · `MarcoMapa`: el rótulo que el documento pide en cada mapa (título, norte, leyenda, fuentes,
 *    fecha, UTM WGS84 16N y «Ejemplo ilustrativo»). La escala gráfica es la del propio mapa.
 *
 * Nada de esto se toca (pointer-events: none): el cuadro del recorrido y el mapa siguen mandando.
 * Todo es CSS y SVG: no hay imágenes que bajar y en un teléfono se ve igual de nítido.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { MENSAJES, PASOS, PREGUNTAS_DESPUES, type FilaFicha } from './etapa1';

const ORO = '#FFAE3B';
const ROJO = '#FF2D2D';
const VERDE = '#3DDC97';

export type Quien = 'electrum' | 'tatiana' | 'chema' | 'super';

export type Escena =
  | { tipo: 'apertura' }
  | { tipo: 'equipo'; habla: Quien | null; vistos: Quien[] }
  | { tipo: 'formula'; fase: 1 | 2 | 3 }
  | { tipo: 'base'; cifras: Array<{ valor: string; etiqueta: string }> }
  | { tipo: 'ecuacion'; premisas: string; indicios: string; hallazgos: string }
  | { tipo: 'clase'; deposito: string | null; mineral: string }
  | { tipo: 'sello'; texto: string; detalle?: string; color?: 'verde' | 'rojo' }
  | { tipo: 'catastro'; libre: boolean }
  | { tipo: 'legal' }
  | { tipo: 'carpeta'; proyecto?: string }
  | { tipo: 'perforacion'; fase: number }
  | { tipo: 'decision'; ruta: 'A' | 'B' | null }
  | { tipo: 'ficha'; titulo: string; filas: FilaFicha[]; dictamen: string; factible: boolean }
  | { tipo: 'mensajes'; hasta: number }
  | { tipo: 'bienvenido' };

export type Marco = {
  titulo: string;
  subtitulo?: string;
  leyenda: Array<{ color: string; texto: string; forma?: 'area' | 'linea' | 'punto' | 'estrella' | 'trama' }>;
  fuentes: string[];
  fecha: string;
  utm?: { este: number; norte: number } | null;
  ejemplo?: boolean;
};

/* ------------------------------------------------------------------ el escenario */

/** `conFlujo`: el riel de los 12 pasos está a la izquierda (en la computadora la escena se corre). */
export function Escenario({ escena, conFlujo = false }: { escena: Escena | null; conFlujo?: boolean }) {
  // La escena que sale se desvanece antes de que entre la otra: nada aparece de golpe.
  const [vista, setVista] = useState<{ e: Escena; k: number; saliendo: boolean } | null>(null);
  useEffect(() => {
    if (!escena) {
      setVista((v) => (v ? { ...v, saliendo: true } : null));
      const t = setTimeout(() => setVista((v) => (v?.saliendo ? null : v)), 420);
      return () => clearTimeout(t);
    }
    setVista((v) => (v && v.e.tipo === escena.tipo ? { e: escena, k: v.k, saliendo: false } : { e: escena, k: (v?.k || 0) + 1, saliendo: false }));
  }, [escena]);
  if (!vista) return <Estilos />;
  const { e, k, saliendo } = vista;
  const completa = !['sello', 'clase'].includes(e.tipo);
  return (
    <>
      <Estilos />
      <div
        key={k}
        aria-hidden
        data-escena={e.tipo}
        className="pointer-events-none absolute inset-0 z-[28] overflow-hidden"
        style={{ animation: saliendo ? 'e1-salir .42s ease-in both' : 'e1-entrar .7s cubic-bezier(.2,.8,.2,1) both' }}
      >
        {completa && <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(6,10,14,.62) 0%, rgba(2,4,6,.88) 70%, rgba(0,0,0,.94) 100%)' }} />}
        <div className={`absolute inset-x-0 flex justify-center px-3 md:px-8 ${conFlujo ? 'md:pl-[232px]' : ''} ${completa ? `top-[max(7vh,52px)] bottom-[clamp(150px,32%,250px)] ${e.tipo === 'ficha' ? 'items-start md:items-center' : 'items-center'}` : 'top-[max(9vh,60px)]'}`}>
          <Contenido e={e} />
        </div>
      </div>
    </>
  );
}

function Contenido({ e }: { e: Escena }) {
  switch (e.tipo) {
    case 'apertura':
      return <Apertura />;
    case 'equipo':
      return <Equipo habla={e.habla} vistos={e.vistos} />;
    case 'formula':
      return <Formula fase={e.fase} />;
    case 'base':
      return <Base cifras={e.cifras} />;
    case 'ecuacion':
      return <Ecuacion {...e} />;
    case 'clase':
      return <Clase deposito={e.deposito} mineral={e.mineral} />;
    case 'sello':
      return <Sello texto={e.texto} detalle={e.detalle} color={e.color === 'rojo' ? ROJO : VERDE} />;
    case 'catastro':
      return <Catastro libre={e.libre} />;
    case 'legal':
      return <Legal />;
    case 'carpeta':
      return <Carpeta proyecto={e.proyecto} />;
    case 'perforacion':
      return <Perforacion fase={e.fase} />;
    case 'decision':
      return <Decision ruta={e.ruta} />;
    case 'ficha':
      return <Ficha {...e} />;
    case 'mensajes':
      return <Mensajes hasta={e.hasta} />;
    case 'bienvenido':
      return <Bienvenido />;
  }
}

/* ------------------------------------------------------------------ piezas */

const Rotulo = ({ children, color = ORO }: { children: ReactNode; color?: string }) => (
  <div className="font-mono text-[10px] uppercase tracking-[0.32em] md:text-[11px]" style={{ color }}>
    {children}
  </div>
);

function Tarjeta({ children, className = '', estilo }: { children: ReactNode; className?: string; estilo?: CSSProperties; key?: string }) {
  return (
  <div className={`rounded-2xl border border-white/10 bg-[rgba(10,14,18,.78)] shadow-[0_20px_60px_rgba(0,0,0,.55)] backdrop-blur-xl ${className}`} style={estilo}>
    {children}
  </div>
  );
}

/** Aparece en cascada: `i` es su turno. */
const cascada = (i: number, base = 0.15): CSSProperties => ({ animation: `e1-subir .7s cubic-bezier(.2,.8,.2,1) ${base + i * 0.12}s both` });

function Apertura() {
  return (
    <div className="relative flex w-full max-w-4xl flex-col items-center text-center">
      <div className="absolute left-1/2 top-1/2 h-[46vmin] w-[46vmin] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: `radial-gradient(circle, ${ORO}33 0%, transparent 65%)`, animation: 'e1-latir 4s ease-in-out infinite' }} />
      <svg viewBox="0 0 120 120" className="relative h-20 w-20 md:h-28 md:w-28" style={{ animation: 'e1-girar 24s linear infinite' }}>
        <defs>
          <linearGradient id="e1-oro" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#FFE3A3" />
            <stop offset="1" stopColor="#C77A12" />
          </linearGradient>
        </defs>
        <polygon points="60,6 107,33 107,87 60,114 13,87 13,33" fill="none" stroke="url(#e1-oro)" strokeWidth="2" />
        <polygon points="60,24 91,42 91,78 60,96 29,78 29,42" fill="none" stroke="url(#e1-oro)" strokeWidth="1" opacity=".6" />
        <text x="60" y="70" textAnchor="middle" fontSize="30" fontWeight="700" fill="url(#e1-oro)" fontFamily="ui-serif, Georgia, serif" style={{ animation: 'e1-contragirar 24s linear infinite', transformOrigin: '60px 60px' }}>
          Au
        </text>
      </svg>
      <div className="relative mt-4" style={cascada(1, 0.4)}>
        <Rotulo>Etapa 1 · El Recorrido</Rotulo>
      </div>
      <h1
        className="relative mt-3 font-display text-[34px] font-bold leading-[1.02] tracking-tight md:text-[68px]"
        style={{ ...cascada(2, 0.4), background: 'linear-gradient(100deg,#fff 0%,#FFE3A3 40%,#FFAE3B 55%,#fff 75%)', backgroundSize: '220% 100%', WebkitBackgroundClip: 'text', color: 'transparent', animation: 'e1-subir .9s cubic-bezier(.2,.8,.2,1) .64s both, e1-brillo 5s linear 1.4s infinite' }}
      >
        Doctor Electrum
      </h1>
      <p className="relative mt-3 max-w-xl text-[14px] leading-snug text-[#C9D4DA] md:text-[18px]" style={cascada(3, 0.5)}>
        La minería de Honduras, de la premisa geológica a la decisión del inversionista.
      </p>
      <div className="relative mt-5 h-px w-48 bg-gradient-to-r from-transparent via-[#FFAE3B] to-transparent" style={{ animation: 'e1-trazo 1.6s ease-out .9s both' }} />
    </div>
  );
}

const EQUIPO: Array<{ id: Quien; nombre: string; papel: string; areas: string; color: string }> = [
  { id: 'electrum', nombre: 'Doctor Electrum', papel: 'Guía y anfitrión', areas: 'Geología · exploración · recursos · catastro · marco legal', color: ORO },
  { id: 'tatiana', nombre: 'Ing. Tatiana', papel: 'Ingeniera en minas', areas: 'Plan de minado · caminos · plataformas · relaveras · obra civil', color: '#5CD6C4' },
  { id: 'chema', nombre: 'Ing. Chema', papel: 'Ingeniero metalurgista', areas: 'Pruebas metalúrgicas · diagrama de proceso · planta · capacidad', color: '#E08A5A' },
  { id: 'super', nombre: 'Superinteligencia', papel: 'Motor de análisis', areas: 'Cruza capas · lee leyes · genera mapas e informes · aprende', color: '#B39DFF' },
];

function Equipo({ habla, vistos }: { habla: Quien | null; vistos: Quien[] }) {
  return (
    <div className="w-full max-w-5xl">
      <div className="mb-3 text-center md:mb-5" style={cascada(0)}>
        <Rotulo>El equipo</Rotulo>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
        {EQUIPO.filter((p) => vistos.includes(p.id)).map((p, i) => {
          const activo = habla === p.id;
          return (
            <div key={p.id} style={cascada(i)}>
              <Tarjeta
                className="relative h-full overflow-hidden p-3 transition-all duration-500 md:p-4"
                estilo={{ borderColor: activo ? p.color : 'rgba(255,255,255,.1)', transform: activo ? 'translateY(-4px) scale(1.03)' : 'none', boxShadow: activo ? `0 0 0 1px ${p.color}66, 0 18px 50px ${p.color}33` : undefined, opacity: habla && !activo ? 0.62 : 1 }}
              >
                <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: p.color, opacity: activo ? 1 : 0.4 }} />
                <Insignia quien={p.id} color={p.color} activo={activo} />
                <div className="mt-2 font-display text-[14px] font-bold leading-tight text-white md:mt-3 md:text-[18px]">{p.nombre}</div>
                <div className="mt-0.5 text-[11px] font-semibold md:text-[12.5px]" style={{ color: p.color }}>
                  {p.papel}
                </div>
                <div className="mt-1.5 hidden text-[11.5px] leading-snug text-[#9FB0B8] md:block">{p.areas}</div>
                {activo && (
                  <div className="mt-2 flex items-end gap-[3px]" aria-hidden>
                    {[0, 1, 2, 3, 4].map((b) => (
                      <span key={b} className="w-[3px] rounded-full" style={{ background: p.color, height: 12, animation: `e1-onda .9s ease-in-out ${b * 0.12}s infinite` }} />
                    ))}
                  </div>
                )}
              </Tarjeta>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Un emblema por personaje (las caras animadas viven en Retratos.tsx; aquí va el oficio). */
function Insignia({ quien, color, activo }: { quien: Quien; color: string; activo: boolean }) {
  const icono: Record<Quien, ReactNode> = {
    electrum: <path d="M8 26 L16 10 L24 26 Z M12 20 h8" stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round" />,
    tatiana: <path d="M7 25 h18 M10 25 l4-12 h4 l4 12 M13 17 h6 M16 6 v7" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />,
    chema: <path d="M11 6 h10 M13 6 v7 l-6 11 a2 2 0 0 0 2 3 h14 a2 2 0 0 0 2-3 l-6-11 v-7 M10 20 h12" stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round" />,
    super: (
      <g stroke={color} strokeWidth="1.6" fill="none">
        <circle cx="16" cy="16" r="9" style={{ animation: 'e1-latir 2.4s ease-in-out infinite', transformOrigin: '16px 16px' }} />
        <circle cx="16" cy="16" r="3" fill={color} />
        <path d="M16 3 v4 M16 25 v4 M3 16 h4 M25 16 h4 M7 7 l3 3 M22 22 l3 3 M25 7 l-3 3 M7 25 l3-3" />
      </g>
    ),
  };
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl md:h-12 md:w-12" style={{ background: `${color}18`, border: `1px solid ${color}55`, boxShadow: activo ? `0 0 24px ${color}66` : 'none' }}>
      <svg viewBox="0 0 32 32" className="h-6 w-6 md:h-7 md:w-7">
        {icono[quien]}
      </svg>
    </div>
  );
}

function Formula({ fase }: { fase: 1 | 2 | 3 }) {
  const Fila = ({ a, b, flechaA, flechaB, colorB, i }: { a: string; b: string; flechaA: string; flechaB: string; colorB: string; i: number }) => (
    <div className="flex items-center justify-center gap-3 md:gap-6" style={cascada(i, 0.1)}>
      <Termino flecha={flechaA} texto={a} color={ORO} />
      <span className="font-display text-[22px] text-white/50 md:text-[34px]">→</span>
      <Termino flecha={flechaB} texto={b} color={colorB} />
    </div>
  );
  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-4 text-center md:gap-7">
      <Rotulo>La ecuación de la minería</Rotulo>
      <Fila a="Riesgo" b="Utilidad" flechaA="▲" flechaB="▲" colorB={VERDE} i={0} />
      {fase >= 2 && <Fila a="Información" b="Riesgo" flechaA="▲" flechaB="▼" colorB={VERDE} i={0} />}
      {fase >= 3 && (
        <div className="mt-1 rounded-full border px-5 py-2 md:px-8 md:py-3" style={{ ...cascada(0, 0.1), borderColor: `${ORO}88`, background: `${ORO}14`, boxShadow: `0 0 40px ${ORO}33` }}>
          <span className="font-display text-[17px] font-bold tracking-wide text-[#FFE3A3] md:text-[26px]">Administradores del riesgo</span>
        </div>
      )}
    </div>
  );
}

const Termino = ({ flecha, texto, color }: { flecha: string; texto: string; color: string }) => (
  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 md:px-6 md:py-4">
    <span className="text-[18px] md:text-[30px]" style={{ color, animation: 'e1-latir 1.6s ease-in-out infinite' }}>
      {flecha}
    </span>
    <span className="font-display text-[20px] font-bold text-white md:text-[38px]">{texto}</span>
  </div>
);

const FUENTES = ['JICA', 'Naciones Unidas · PNUD', 'USGS', 'DEFOMIN', 'INHGEOMIN', 'Mapas geológicos', 'Mapas estructurales', 'Informes históricos'];

function Base({ cifras }: { cifras: Array<{ valor: string; etiqueta: string }> }) {
  return (
    <div className="flex w-full max-w-4xl flex-col items-center text-center">
      <Rotulo>Base de datos geológico-minera de Honduras</Rotulo>
      <div className="relative mt-4 flex flex-wrap justify-center gap-1.5 md:mt-6 md:gap-2.5">
        {FUENTES.map((f, i) => (
          <span key={f} className="rounded-full border border-[#FFAE3B]/35 bg-[#FFAE3B]/[0.08] px-2.5 py-1 text-[11.5px] font-medium text-[#FFE3A3] md:px-3.5 md:py-1.5 md:text-[14px]" style={cascada(i, 0.05)}>
            {f}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 200 30" className="mt-2 h-6 w-48 md:h-8 md:w-72" aria-hidden>
        <path d="M10 2 Q100 40 190 2" stroke={ORO} strokeWidth="1" fill="none" strokeDasharray="4 4" style={{ animation: 'e1-guion 1.2s linear infinite' }} />
        <path d="M100 4 V28" stroke={ORO} strokeWidth="1.5" />
      </svg>
      <div className="grid w-full grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        {cifras.map((c, i) => (
          <Tarjeta key={c.etiqueta} className="px-3 py-2.5 md:py-4" estilo={cascada(i, 0.9)}>
            <div className="font-display text-[22px] font-bold tabular-nums text-white md:text-[34px]">{c.valor}</div>
            <div className="text-[11px] text-[#9FB0B8] md:text-[13px]">{c.etiqueta}</div>
          </Tarjeta>
        ))}
      </div>
      <div className="mt-3 text-[12px] text-[#C9D4DA] md:mt-4 md:text-[15px]" style={cascada(5, 0.9)}>
        Acumular · procesar · interpretar · <span className="text-[#FFE3A3]">poner a su disposición</span>
      </div>
    </div>
  );
}

function Ecuacion({ premisas, indicios, hallazgos }: { premisas: string; indicios: string; hallazgos: string }) {
  const partes = [
    { t: 'Premisas', d: premisas },
    { t: 'Indicios', d: indicios },
    { t: 'Hallazgos', d: hallazgos },
  ];
  return (
    <div className="flex w-full max-w-5xl flex-col items-center text-center">
      <div className="flex w-full flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-3">
        {partes.map((p, i) => (
          <div key={p.t} className="contents">
            <Tarjeta className="flex-1 px-3 py-2.5 md:px-4 md:py-4" estilo={cascada(i * 2)}>
              <div className="font-display text-[17px] font-bold text-white md:text-[22px]">{p.t}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-[#9FB0B8] md:text-[13px]">{p.d}</div>
            </Tarjeta>
            <span className="self-center font-display text-[20px] text-[#FFAE3B] md:text-[30px]" style={cascada(i * 2 + 1)}>
              {i < 2 ? '+' : '='}
            </span>
          </div>
        ))}
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 px-5 py-3 md:px-7 md:py-5" style={{ ...cascada(6), borderColor: ROJO, background: `${ROJO}1A`, boxShadow: `0 0 50px ${ROJO}55` }}>
          <svg viewBox="0 0 24 24" className="h-8 w-8 md:h-11 md:w-11" style={{ animation: 'e1-latir 1.8s ease-in-out infinite', filter: `drop-shadow(0 0 10px ${ROJO})` }}>
            <path d="M12 2.2l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17l-6 3.3 1.3-6.6L2.4 9.1l6.7-.8z" fill={ROJO} stroke="#fff" strokeWidth="1" />
          </svg>
          <div className="mt-1 font-display text-[22px] font-black tracking-wider text-white md:text-[30px]">TARGET</div>
        </div>
      </div>
      <div className="mt-4 text-[14px] text-[#E8EEF1] md:mt-6 md:text-[19px]" style={cascada(8)}>
        Un target es un <b className="text-[#FFE3A3]">probable proyecto</b>. Todavía <b className="text-white underline decoration-[#FF2D2D] decoration-2 underline-offset-4">no es un proyecto</b>.
      </div>
    </div>
  );
}

function Clase({ deposito, mineral }: { deposito: string | null; mineral: string }) {
  const tipos = [
    { id: 'metalico', t: 'Metálico', d: 'Oro · plata · cobre · plomo · zinc · antimonio · hierro' },
    { id: 'no', t: 'No metálico', d: 'Calizas · arcillas · agregados · yeso' },
    { id: 'gemas', t: 'Gemas', d: 'Ópalo · jade' },
  ];
  return (
    <div className="grid w-full max-w-3xl grid-cols-3 gap-1.5 md:gap-3">
      {tipos.map((x, i) => {
        const si = x.id === 'metalico';
        return (
          <Tarjeta key={x.id} className="px-2.5 py-2 md:px-4 md:py-3" estilo={{ ...cascada(i), borderColor: si ? ORO : undefined, opacity: si ? 1 : 0.5, boxShadow: si ? `0 0 34px ${ORO}44` : undefined }}>
            <div className="flex items-center gap-1.5">
              <span className="font-display text-[13px] font-bold text-white md:text-[17px]">{x.t}</span>
              {si && <span className="text-[13px]" style={{ color: VERDE }}>✓</span>}
            </div>
            <div className="mt-0.5 hidden text-[11px] leading-snug text-[#9FB0B8] md:block">{x.d}</div>
            {si && (
              <div className="mt-1 text-[11px] font-semibold leading-tight text-[#FFE3A3] md:text-[12.5px]">
                {mineral}
                {deposito ? ` · ${deposito} (probable)` : ''}
              </div>
            )}
          </Tarjeta>
        );
      })}
    </div>
  );
}

function Sello({ texto, detalle, color, chico = false }: { texto: string; detalle?: string; color: string; chico?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`rounded-xl border-[3px] ${chico ? 'px-4 py-1.5 md:px-6 md:py-2' : 'px-5 py-2 md:px-8 md:py-3'}`}
        style={{ borderColor: color, color, background: 'rgba(5,10,8,.72)', boxShadow: `0 0 40px ${color}55, inset 0 0 20px ${color}22`, animation: 'e1-sello .65s cubic-bezier(.2,1.6,.4,1) both', backdropFilter: 'blur(8px)' }}
      >
        <span className={`font-display font-black uppercase tracking-[0.14em] ${chico ? 'text-[18px] md:text-[26px]' : 'text-[24px] md:text-[40px]'}`}>{texto}</span>
      </div>
      {detalle && (
        <div className="mt-2 max-w-md rounded-full bg-black/70 px-3 py-1 text-center text-[11.5px] text-[#DCE5EA] backdrop-blur md:text-[13px]" style={cascada(1, 0.4)}>
          {detalle}
        </div>
      )}
    </div>
  );
}

function Catastro({ libre }: { libre: boolean }) {
  const filas = [
    ['Metálica', 'Gran / pequeña minería', 'Solicitud · Exploración · Explotación'],
    ['No metálica', 'Gran / pequeña minería', 'Solicitud · Exploración · Explotación'],
    ['Gemas', '—', 'Solicitud · Otorgada'],
  ];
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-2 flex items-center justify-between gap-2" style={cascada(0)}>
        <Rotulo>Catastro minero · INHGEOMIN</Rotulo>
        <span className="text-[10.5px] text-[#9FB0B8] md:text-[12px]">Se obtiene por solicitud formal</span>
      </div>
      <Tarjeta className="overflow-hidden" estilo={cascada(1)}>
        <table className="w-full text-left text-[11.5px] md:text-[14px]">
          <thead className="bg-white/[0.04] text-[10px] uppercase tracking-[0.14em] text-[#8FA3B0] md:text-[11px]">
            <tr>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Escala</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f[0]} className="border-t border-white/[0.06]" style={cascada(i, 0.4)}>
                <td className="px-3 py-2 font-semibold text-white">{f[0]}</td>
                <td className="px-3 py-2 text-[#C9D4DA]">{f[1]}</td>
                <td className="px-3 py-2 text-[#C9D4DA]">{f[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tarjeta>
      <div className="mt-3 flex justify-center" style={cascada(5, 0.4)}>
        <Sello chico texto={libre ? 'Área libre' : 'Ocupada'} detalle={libre ? 'Sin concesión ni solicitud que la cubra' : 'Se descarta o se reubica'} color={libre ? VERDE : ROJO} />
      </div>
    </div>
  );
}

function Legal() {
  const leyes = [
    { t: 'Ley General de Minería', d: 'y su Reglamento' },
    { t: 'Ley General del Ambiente', d: 'Licenciamiento ambiental de SERNA' },
    { t: 'Normativa municipal', d: 'y consulta comunitaria' },
    { t: 'Legislación internacional', d: 'Solo como referencia' },
  ];
  return (
    <div className="w-full max-w-4xl">
      <div className="mb-3 text-center" style={cascada(0)}>
        <Rotulo>Marco legal y solicitud</Rotulo>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        {leyes.map((l, i) => (
          <Tarjeta key={l.t} className="px-3 py-3 md:py-4" estilo={cascada(i + 1)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 md:h-6 md:w-6" fill="none" stroke={ORO} strokeWidth="1.6">
              <path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0zM8 21h8" strokeLinejoin="round" />
            </svg>
            <div className="mt-1.5 font-display text-[13px] font-bold leading-tight text-white md:text-[16px]">{l.t}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-[#9FB0B8] md:text-[12.5px]">{l.d}</div>
          </Tarjeta>
        ))}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto] md:items-center" style={cascada(6)}>
        <div className="flex flex-wrap gap-1.5">
          {['Preparamos la solicitud', 'Acompañamos el trámite', 'Le recomendamos abogado'].map((x) => (
            <span key={x} className="rounded-full border border-[#3DDC97]/40 bg-[#3DDC97]/10 px-2.5 py-1 text-[11px] text-[#BFF5DD] md:text-[13px]">
              ✓ {x}
            </span>
          ))}
        </div>
        <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[10.5px] leading-snug text-[#9FB0B8] md:text-[11.5px]">
          No sustituye a un abogado ni es opinión legal vinculante. Confirme siempre la versión vigente de la ley.
        </div>
      </div>
    </div>
  );
}

function Carpeta({ proyecto }: { proyecto?: string }) {
  const cosas = ['Mapeo geológico', 'Trincheras', 'Muestreos', 'Geoquímica', 'Geofísica · mag · IP', 'Fotos', 'KML', 'Planos'];
  const etapas = ['Reconocimiento', 'Mapeo y muestreo', 'Geofísica', 'Trincheras', 'Perforación'];
  return (
    <div className="grid w-full max-w-4xl gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-5">
      <Tarjeta className="relative overflow-hidden p-3 md:p-5" estilo={cascada(0)}>
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-7 w-7 md:h-9 md:w-9" style={{ animation: 'e1-abrir 1s ease-out .2s both' }}>
            <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={`${ORO}33`} stroke={ORO} strokeWidth="1.4" />
          </svg>
          <div>
            <div className="font-display text-[15px] font-bold text-white md:text-[19px]">Carpeta del proyecto</div>
            <div className="text-[11px] text-[#9FB0B8] md:text-[12.5px]">{proyecto ? `Ejemplo real: ${proyecto}` : 'Cada proyecto, su propia carpeta'}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {cosas.map((x, i) => (
            <div key={x} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-[#DCE5EA] md:text-[12.5px]" style={cascada(i, 0.3)}>
              {x}
            </div>
          ))}
        </div>
      </Tarjeta>
      <Tarjeta className="p-3 md:p-5" estilo={cascada(1)}>
        <Rotulo>Plan de exploración por etapas</Rotulo>
        <ol className="mt-3 space-y-1.5">
          {etapas.map((x, i) => (
            <li key={x} className="flex items-center gap-2" style={cascada(i, 0.6)}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-black md:h-6 md:w-6 md:text-[11px]" style={{ background: i === etapas.length - 1 ? ROJO : ORO }}>
                {i + 1}
              </span>
              <span className="text-[12.5px] text-white md:text-[14px]">{x}</span>
            </li>
          ))}
        </ol>
      </Tarjeta>
    </div>
  );
}

function Perforacion({ fase }: { fase: number }) {
  const etapas = ['Plan de perforación', 'Logueo y fotos de cajas', 'Química con QA/QC', 'Secciones y modelo 3D', 'Estimación de recurso'];
  return (
    <div className="w-full max-w-4xl">
      <div className="mb-3 text-center" style={cascada(0)}>
        <Rotulo>Del sondaje al recurso</Rotulo>
      </div>
      <div className="flex flex-col gap-1.5 md:flex-row md:items-stretch md:gap-2">
        {etapas.map((x, i) => {
          const hecho = i < fase;
          const ahora = i === fase;
          return (
            <Tarjeta key={x} className="flex-1 px-3 py-2 transition-all duration-500 md:py-3" estilo={{ ...cascada(i), borderColor: ahora ? ORO : hecho ? `${ORO}55` : undefined, boxShadow: ahora ? `0 0 30px ${ORO}44` : undefined }}>
              <div className="font-mono text-[10px] text-[#FFAE3B]">{String(i + 1).padStart(2, '0')}</div>
              <div className={`text-[12.5px] font-semibold leading-tight md:text-[14px] ${hecho || ahora ? 'text-white' : 'text-[#7E8E98]'}`}>{x}</div>
            </Tarjeta>
          );
        })}
      </div>
      <div className="mt-4 flex items-end justify-center gap-2 md:gap-3" style={cascada(6)}>
        {[
          { t: 'Inferido', h: 44, o: 0.45 },
          { t: 'Indicado', h: 64, o: 0.7 },
          { t: 'Medido', h: 86, o: 1 },
        ].map((r) => (
          <div key={r.t} className="flex flex-col items-center">
            <div className="w-16 rounded-t-lg md:w-24" style={{ height: r.h, background: `linear-gradient(180deg, ${ORO}, #8A5310)`, opacity: fase >= 4 ? r.o : 0.15, transition: 'opacity .8s' }} />
            <div className="mt-1 text-[11px] font-semibold text-white md:text-[13px]">{r.t}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-center text-[11px] text-[#9FB0B8] md:text-[12.5px]" style={cascada(7)}>
        Recurso solo cuando los datos y el estándar lo respaldan. Indicio ≠ target ≠ recurso.
      </div>
    </div>
  );
}

function Decision({ ruta }: { ruta: 'A' | 'B' | null }) {
  const rutas = [
    { id: 'A' as const, t: 'Explotar', color: '#E08A5A', items: ['Ing. Chema: pruebas metalúrgicas, diagrama de proceso y planta', 'Ing. Tatiana: plan de minado y obras civiles'] },
    { id: 'B' as const, t: 'Bolsa de valores', color: '#B39DFF', items: ['NI 43-101 (Canadá) o JORC (Australia)', 'QA/QC · Persona Calificada · informe técnico', 'Listar en TSX / TSX-V'] },
  ];
  return (
    <div className="flex w-full max-w-4xl flex-col items-center">
      <div className="flex items-center gap-2 rounded-full border border-[#FFAE3B]/50 bg-[#FFAE3B]/10 px-4 py-1.5" style={cascada(0)}>
        <span className="font-display text-[15px] font-bold text-[#FFE3A3] md:text-[19px]">12 · Decisión del inversionista</span>
      </div>
      <svg viewBox="0 0 200 34" className="h-7 w-56 md:h-9 md:w-80" aria-hidden>
        <path d="M100 0 V10 Q100 18 70 22 L30 32 M100 10 Q100 18 130 22 L170 32" stroke={ORO} strokeWidth="1.5" fill="none" strokeDasharray="200" style={{ animation: 'e1-trazo-svg 1.2s ease-out .3s both' }} />
      </svg>
      <div className="grid w-full grid-cols-2 gap-2 md:gap-4">
        {rutas.map((r, i) => {
          const si = !ruta || ruta === r.id;
          return (
            <Tarjeta key={r.id} className="p-3 transition-all duration-500 md:p-5" estilo={{ ...cascada(i + 1), borderColor: ruta === r.id ? r.color : undefined, opacity: si ? 1 : 0.45, boxShadow: ruta === r.id ? `0 0 40px ${r.color}44` : undefined }}>
              <div className="font-mono text-[10px] tracking-[0.2em]" style={{ color: r.color }}>
                RUTA {r.id}
              </div>
              <div className="font-display text-[17px] font-bold text-white md:text-[24px]">{r.t}</div>
              <ul className="mt-2 space-y-1">
                {r.items.map((x) => (
                  <li key={x} className="text-[11px] leading-snug text-[#C9D4DA] md:text-[13.5px]">
                    · {x}
                  </li>
                ))}
              </ul>
            </Tarjeta>
          );
        })}
      </div>
    </div>
  );
}

function Ficha({ titulo, filas, dictamen, factible }: { titulo: string; filas: FilaFicha[]; dictamen: string; factible: boolean }) {
  const marca = { ok: { s: '✓', c: VERDE }, aviso: { s: '!', c: '#FFC34D' }, info: { s: 'i', c: '#7FB8FF' } };
  return (
    <div className="w-full max-w-3xl">
      <div className="mb-2 flex items-end justify-between gap-2" style={cascada(0)}>
        <div>
          <Rotulo>Mapa 5 · Ficha de factibilidad</Rotulo>
          <div className="mt-1 font-display text-[16px] font-bold text-white md:text-[21px]">{titulo}</div>
        </div>
        <span className="shrink-0 rounded-md border border-[#FF2D2D]/60 bg-[#FF2D2D]/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#FFB3B3] md:text-[10.5px]">Ejemplo ilustrativo</span>
      </div>
      <Tarjeta className="overflow-hidden">
        <div>
          {filas.map((f, i) => (
            <div key={f.criterio} className="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-x-2 border-t border-white/[0.06] px-3 py-[4px] first:border-t-0 md:grid-cols-[22px_minmax(0,0.9fr)_minmax(0,1.6fr)] md:py-2" style={cascada(i, 0.25)}>
              <span className="row-span-2 flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-black text-black md:row-span-1" style={{ background: marca[f.marca].c }}>
                {marca[f.marca].s}
              </span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#8FA3B0] md:text-[13.5px] md:normal-case md:tracking-normal md:text-white">{f.criterio}</span>
              <span className="truncate text-[12px] leading-tight text-[#E8EEF1] md:text-[13.5px] md:text-[#C9D4DA]">{f.resultado}</span>
            </div>
          ))}
        </div>
      </Tarjeta>
      <div className="mt-3 flex justify-center" style={cascada(filas.length + 1, 0.25)}>
        <Sello chico texto={dictamen} color={factible ? VERDE : ROJO} detalle="Verificar con el catastro más reciente de INHGEOMIN antes de solicitar" />
      </div>
    </div>
  );
}

function Mensajes({ hasta }: { hasta: number }) {
  return (
    <div className="w-full max-w-4xl">
      <div className="mb-3 text-center" style={cascada(0)}>
        <Rotulo>Lo que nos define</Rotulo>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
        {MENSAJES.map((m, i) => (
          <Tarjeta key={m.titulo} className="px-3 py-2.5 transition-all duration-700 md:px-4 md:py-4" estilo={{ opacity: i < hasta ? 1 : 0.12, transform: i < hasta ? 'none' : 'translateY(8px)', borderColor: i === hasta - 1 ? `${ORO}AA` : undefined }}>
            <div className="font-mono text-[10px] text-[#FFAE3B]">{String(i + 1).padStart(2, '0')}</div>
            <div className="font-display text-[13px] font-bold leading-tight text-white md:text-[17px]">{m.titulo}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-[#9FB0B8] md:text-[13px]">{m.texto}</div>
          </Tarjeta>
        ))}
      </div>
    </div>
  );
}

function Bienvenido() {
  return (
    <div className="flex w-full max-w-4xl flex-col items-center text-center">
      <div style={cascada(0)}>
        <Rotulo>Vamos con todo · cuente con nosotros</Rotulo>
      </div>
      <div className="mt-2 font-display text-[44px] font-black leading-none md:text-[88px]" style={{ ...cascada(1), background: 'linear-gradient(100deg,#fff 0%,#FFE3A3 40%,#FFAE3B 55%,#fff 75%)', backgroundSize: '220% 100%', WebkitBackgroundClip: 'text', color: 'transparent', animation: 'e1-subir .9s cubic-bezier(.2,.8,.2,1) .25s both, e1-brillo 4s linear 1s infinite' }}>
        ¡Bienvenido!
      </div>
      <div className="mt-4 text-[12px] text-[#9FB0B8] md:text-[14px]" style={cascada(2)}>
        De aquí en adelante, pregúntenos lo que quiera. Por ejemplo:
      </div>
      <div className="mt-2 flex max-w-3xl flex-wrap justify-center gap-1.5 md:gap-2">
        {PREGUNTAS_DESPUES.map((p, i) => (
          <span key={p} className="rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[11px] text-[#DCE5EA] md:px-3 md:text-[13px]" style={cascada(i, 0.5)}>
            «{p}»
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ el flujo de 12 pasos */

/** El paso en curso, a la izquierda en la computadora y como franja en el teléfono. */
export function Flujo({ paso }: { paso: number | null }) {
  if (!paso) return null;
  const actual = PASOS[paso - 1];
  return (
    <>
      <nav aria-label="Pasos del recorrido" className="pointer-events-none absolute left-3 top-1/2 z-[29] hidden -translate-y-1/2 md:block" style={{ animation: 'e1-entrar-izq .6s ease-out both' }}>
        <div className="rounded-2xl border border-white/10 bg-[rgba(8,12,16,.72)] px-3 py-3 shadow-[0_14px_40px_rgba(0,0,0,.5)] backdrop-blur-xl">
          <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.28em] text-[#FFAE3B]">El flujo</div>
          <ol className="relative space-y-[3px]">
            <span className="absolute left-[9px] top-1 bottom-1 w-px bg-white/10" aria-hidden />
            <span className="absolute left-[9px] top-1 w-px bg-[#FFAE3B] transition-all duration-700" style={{ height: `calc(${((paso - 1) / 11) * 100}% - 4px)` }} aria-hidden />
            {PASOS.map((p) => {
              const hecho = p.n < paso;
              const ahora = p.n === paso;
              return (
                <li key={p.n} className="relative flex items-center gap-2" aria-current={ahora ? 'step' : undefined}>
                  <span
                    className="relative z-[1] flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold transition-all duration-500"
                    style={{ background: ahora ? ORO : hecho ? '#5A3E12' : '#1A2229', color: ahora ? '#000' : hecho ? '#FFD08A' : '#6E7F89', boxShadow: ahora ? `0 0 14px ${ORO}` : 'none' }}
                  >
                    {hecho ? '✓' : p.n}
                  </span>
                  <span className={`whitespace-nowrap text-[11.5px] transition-all duration-500 ${ahora ? 'font-semibold text-white' : hecho ? 'text-[#B9A27C]' : 'text-[#6E7F89]'}`}>{p.corto}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </nav>
      <div className="pointer-events-none absolute inset-x-3 top-[max(6vh,50px)] z-[29] md:hidden" aria-hidden>
        <div className="flex gap-[3px]">
          {PASOS.map((p) => (
            <span key={p.n} className="h-[3px] flex-1 rounded-full transition-colors duration-500" style={{ background: p.n <= paso ? ORO : 'rgba(255,255,255,.18)' }} />
          ))}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#FFD08A] drop-shadow">
          Paso {paso} de 12 · {actual.corto}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ el marco del mapa */

/** El rótulo de cada mapa (sección 5 del documento): título, norte, leyenda, fuentes, fecha y UTM. */
export function MarcoMapa({ marco }: { marco: Marco | null }) {
  const [rumbo, setRumbo] = useState(0);
  useEffect(() => {
    const f = (e: Event) => setRumbo(Number((e as CustomEvent<number>).detail) || 0);
    window.addEventListener('electrum:rumbo', f);
    return () => window.removeEventListener('electrum:rumbo', f);
  }, []);
  if (!marco) return null;
  return (
    <div
      key={marco.titulo}
      aria-label={`Mapa: ${marco.titulo}`}
      className="pointer-events-none absolute right-2 top-[max(11vh,88px)] z-[29] w-[min(250px,62vw)] md:right-14 md:top-[max(7vh,56px)] md:w-[280px]"
      style={{ animation: 'e1-entrar-der .6s ease-out both' }}
    >
      <div className="overflow-hidden rounded-xl border border-white/12 bg-[rgba(8,12,16,.8)] shadow-[0_14px_40px_rgba(0,0,0,.5)] backdrop-blur-xl">
        <div className="flex items-start gap-2 border-b border-white/[0.08] px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold leading-tight text-white md:text-[13.5px]">{marco.titulo}</div>
            {marco.subtitulo && <div className="mt-0.5 truncate text-[10.5px] text-[#9FB0B8] md:text-[11.5px]">{marco.subtitulo}</div>}
          </div>
          <svg viewBox="0 0 24 30" className="h-7 w-6 shrink-0 transition-transform duration-300" style={{ transform: `rotate(${-rumbo}deg)` }} aria-label="Norte">
            <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="#fff" />
            <path d="M12 2 L12 16 L6 20 Z" fill="#9FB0B8" />
            <text x="12" y="29" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">
              N
            </text>
          </svg>
        </div>
        <ul className="space-y-[3px] px-3 py-2">
          {marco.leyenda.map((l) => (
            <li key={l.texto} className="flex items-center gap-2 text-[10.5px] text-[#DCE5EA] md:text-[11.5px]">
              <Simbolo color={l.color} forma={l.forma || 'area'} />
              <span className="truncate">{l.texto}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-white/[0.08] px-3 py-1.5 text-[9.5px] leading-snug text-[#8FA3B0] md:text-[10.5px]">
          <div className="truncate">Fuentes: {marco.fuentes.join(' · ')}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2">
            <span>UTM WGS84 16N</span>
            {marco.utm && (
              <span className="tabular-nums">
                E {marco.utm.este.toLocaleString('es-HN')} · N {marco.utm.norte.toLocaleString('es-HN')}
              </span>
            )}
            <span>{marco.fecha}</span>
          </div>
          {marco.ejemplo && <div className="mt-1 inline-block rounded border border-[#FF2D2D]/60 px-1.5 font-mono uppercase tracking-[0.12em] text-[#FFB3B3]">Ejemplo ilustrativo</div>}
        </div>
      </div>
    </div>
  );
}

function Simbolo({ color, forma }: { color: string; forma: NonNullable<Marco['leyenda'][number]['forma']> }) {
  return (
    <svg viewBox="0 0 16 12" className="h-3 w-4 shrink-0" aria-hidden>
      {forma === 'area' && <rect x="1" y="1" width="14" height="10" rx="2" fill={`${color}55`} stroke={color} strokeWidth="1.4" />}
      {forma === 'trama' && (
        <>
          <rect x="1" y="1" width="14" height="10" rx="2" fill="none" stroke={color} strokeWidth="1.4" />
          <path d="M3 11 L9 1 M8 11 L14 1" stroke={color} strokeWidth="1" />
        </>
      )}
      {forma === 'linea' && <path d="M1 8 Q5 2 8 6 T15 4" stroke={color} strokeWidth="1.8" fill="none" />}
      {forma === 'punto' && <circle cx="8" cy="6" r="3.4" fill={color} stroke="#000" strokeWidth=".8" />}
      {forma === 'estrella' && <path d="M8 .8l1.7 3.4 3.8.5-2.8 2.6.7 3.7L8 9.2 4.6 11l.7-3.7L2.5 4.7l3.8-.5z" fill={ROJO} stroke="#fff" strokeWidth=".6" />}
    </svg>
  );
}

/* ------------------------------------------------------------------ animaciones */

function Estilos() {
  return (
    <style>{`
@keyframes e1-entrar{from{opacity:0;filter:blur(6px)}to{opacity:1;filter:none}}
@keyframes e1-salir{from{opacity:1}to{opacity:0;filter:blur(4px)}}
@keyframes e1-subir{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}
@keyframes e1-entrar-izq{from{opacity:0;transform:translate(-16px,-50%)}to{opacity:1;transform:translate(0,-50%)}}
@keyframes e1-entrar-der{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
@keyframes e1-latir{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.08);opacity:1}}
@keyframes e1-girar{to{transform:rotate(360deg)}}
@keyframes e1-contragirar{to{transform:rotate(-360deg)}}
@keyframes e1-brillo{to{background-position:-220% 0}}
@keyframes e1-trazo{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
@keyframes e1-trazo-svg{from{stroke-dashoffset:200}to{stroke-dashoffset:0}}
@keyframes e1-guion{to{stroke-dashoffset:-16}}
@keyframes e1-onda{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
@keyframes e1-sello{0%{opacity:0;transform:scale(2.2) rotate(-14deg)}60%{opacity:1;transform:scale(.94) rotate(-6deg)}100%{transform:scale(1) rotate(-5deg)}}
@keyframes e1-abrir{from{transform:rotateX(70deg);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion: reduce){[data-escena] *{animation-duration:.01s!important;animation-iteration-count:1!important}}
`}</style>
  );
}
