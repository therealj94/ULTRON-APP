import React, { useEffect, useState } from 'react';
import { CircleDot, Play, Music2 } from 'lucide-react';

type Capacidad = {
  id: string;
  grupo: string;
  titulo: string;
  detalle: string;
  ejemplos: string[];
  vivo: boolean | null;
  falta?: string;
  donde: string;
};

export type Catalogo = {
  voz?: { oficial?: { nombre: string; motor: string; timbre: string; expresividad: string[]; respaldo?: string }; voicebox?: boolean; servidor?: string | null };
  modos?: Array<{ id: string; etiqueta: string; tono: string }>;
  canciones?: Array<{ id: string; titulo: string; artista: string; pedir: string }>;
  capacidades?: Capacidad[];
};

const GRUPOS: Record<string, string> = {
  herramientas: 'Herramientas',
  voz: 'Voz y oído',
  canales: 'Canales',
  memoria: 'Memoria',
  gestos: 'Gestos y tacto',
};

const KEY = 'ultron_capacidades_cache';

/** El catálogo de `GET /api/capacidades`, con el último conocido mientras llega. */
export function useCatalogo() {
  const [cat, setCat] = useState<Catalogo | null>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState('');
  useEffect(() => {
    let vivo = true;
    fetch('/api/capacidades')
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        setCat(j);
        try {
          localStorage.setItem(KEY, JSON.stringify(j));
        } catch {
          /* */
        }
      })
      .catch(() => vivo && setError('No pude leer el catálogo ahora; muestro el último conocido.'));
    return () => {
      vivo = false;
    };
  }, []);
  return { cat, error };
}

/** La voz oficial y con qué motor suena de verdad ahora (no lo que dice el nombre). */
export const VozOficial: React.FC<{ cat: Catalogo | null; onProbarVoz: () => void }> = ({ cat, onProbarVoz }) => {
  const v = cat?.voz;
  return (
    <div className="aura-tarjeta honda p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="aura-sobretitulo">Voz oficial</p>
        <p className="text-[16px] text-(--aura-tinta) font-medium mt-1">
          {v?.oficial ? `${v.oficial.nombre} · ${v.oficial.timbre}` : 'Leyendo la voz…'}
        </p>
        {v?.oficial && (
          <p className="text-[14px] text-(--aura-tinta-2) mt-1">
            {v.voicebox ? `Suena con ${v.oficial.motor}${v.servidor ? ` (${v.servidor})` : ''}.` : 'La voz sintetizada no está configurada en este servidor: suenan solo los clips grabados y el texto queda en pantalla.'}
          </p>
        )}
        {v && (
          <p className={`text-[14px] mt-1 flex items-center gap-1.5 ${v.voicebox ? 'text-(--aura-ok-texto)' : 'text-(--aura-barro-texto)'}`}>
            <CircleDot className="w-3.5 h-3.5" aria-hidden="true" />
            {v.voicebox ? 'Voz configurada' : 'Voz sin configurar'}
          </p>
        )}
      </div>
      <button type="button" onClick={onProbarVoz} className="aura-secundario shrink-0">
        <Play className="w-4 h-4" aria-hidden="true" /> Probar la voz
      </button>
    </div>
  );
};

export const Repertorio: React.FC<{ cat: Catalogo | null; onEjemplo: (cmd: string) => void }> = ({ cat, onEjemplo }) => {
  if (!cat?.canciones?.length) return null;
  return (
    <div>
      <p className="aura-sobretitulo mb-2">Repertorio</p>
      <ul className="flex flex-wrap gap-2" role="list">
        {cat.canciones.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onEjemplo(c.pedir)} className="aura-chip">
              <Music2 className="w-4 h-4" aria-hidden="true" />
              <span>
                {c.titulo} <span className="text-(--aura-tinta-2)">· {c.artista}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** «Qué puede hacer AU-RA y si responde ahora»: una tarjeta por capacidad real, con su estado. */
export const Capacidades: React.FC<{ cat: Catalogo | null; error?: string; onEjemplo: (cmd: string) => void }> = ({ cat, error, onEjemplo }) => {
  const caps = cat?.capacidades || [];
  const grupos = Object.keys(GRUPOS).filter((g) => caps.some((c) => c.grupo === g));

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-[14px] text-(--aura-barro-texto)">{error}</p>}
      {!cat && !error && <p className="text-[14px] text-(--aura-tinta-2)">Leyendo capacidades…</p>}
      {grupos.map((g) => (
        <section key={g} aria-labelledby={`cap-${g}`}>
          <h4 id={`cap-${g}`} className="aura-sobretitulo mb-2">
            {GRUPOS[g]}
          </h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2" role="list">
            {caps
              .filter((c) => c.grupo === g)
              .map((c) => (
                <li key={c.id} className="aura-tarjeta p-3 flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h5 className="text-[15px] text-(--aura-tinta) font-semibold leading-tight">{c.titulo}</h5>
                    {c.vivo !== null && (
                      <span className={`shrink-0 flex items-center gap-1 text-[13px] font-medium ${c.vivo ? 'text-(--aura-ok-texto)' : 'text-(--aura-barro-texto)'}`}>
                        <CircleDot className="w-3.5 h-3.5" aria-hidden="true" /> {c.vivo ? 'Responde' : 'No disponible'}
                      </span>
                    )}
                  </div>
                  <p className="text-[14px] text-(--aura-tinta-2) leading-snug">{c.detalle}</p>
                  {!c.vivo && c.falta && <p className="text-[13px] text-(--aura-barro-texto)">Falta: {c.falta}</p>}
                  {c.ejemplos.length > 0 && !c.ejemplos[0].startsWith('(') && (
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {c.ejemplos.map((e) => (
                        <button key={e} type="button" onClick={() => onEjemplo(e)} className="min-h-[40px] px-3 rounded-full text-[14px] border border-(--aura-borde) text-(--aura-oro-texto) hover:border-(--aura-oro) hover:bg-(--aura-oro-suave) cursor-pointer text-left">
                          «{e}»
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
