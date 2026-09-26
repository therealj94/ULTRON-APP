import React, { useEffect, useState } from 'react';
import { Sparkles, CircleDot, Play } from 'lucide-react';

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

type Catalogo = {
  voz?: { oficial?: { nombre: string; motor: string; timbre: string; expresividad: string[] }; voicebox?: boolean; servidor?: string | null };
  modos?: Array<{ id: string; etiqueta: string; tono: string }>;
  canciones?: Array<{ id: string; titulo: string; artista: string; pedir: string }>;
  capacidades?: Capacidad[];
};

const GRUPOS: Record<string, string> = {
  herramientas: 'Herramientas',
  voz: 'Voz y oído',
  personalidad: 'Personalidad',
  gestos: 'Gestos y tacto',
  canales: 'Canales',
  memoria: 'Memoria',
};

const KEY = 'ultron_capacidades_cache';

/** «Qué puede hacer AU-RA»: una tarjeta por capacidad real, con estado vivo/caído. */
export const Capacidades: React.FC<{ onEjemplo: (cmd: string) => void; onProbarVoz: () => void }> = ({ onEjemplo, onProbarVoz }) => {
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

  const caps = cat?.capacidades || [];
  const grupos = Object.keys(GRUPOS).filter((g) => caps.some((c) => c.grupo === g));

  return (
    <div className="flex flex-col gap-4">
      {cat?.voz?.oficial && (
        <div className="p-3 rounded-xl border border-[#46484D] bg-[#D6B56C]/5 flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-display tracking-normal text-[#B9B2A8]">VOZ OFICIAL</div>
            <div className="text-sm text-[#ECE8E2] font-medium mt-0.5">
              {cat.voz.oficial.nombre} · <span className="text-[#ECE8E2]">{cat.voz.oficial.timbre}</span>
            </div>
            <div className="text-[13px] text-[#B9B2A8] mt-0.5">{cat.voz.oficial.motor}. Sabe: {cat.voz.oficial.expresividad.join(', ')}.</div>
            <div className="text-[12px] mt-1 font-mono">
              <span className={cat.voz.voicebox ? 'text-emerald-400' : 'text-[#E39A7A]'}>{cat.voz.voicebox ? '● Voz en el servidor propio (Voicebox)' : '○ Voicebox sin configurar'}</span>
              {cat.voz.voicebox && cat.voz.servidor && <span className="text-[#8A847C]"> · {cat.voz.servidor}</span>}
            </div>
          </div>
          <button type="button" onClick={onProbarVoz} className="shrink-0 px-3 py-1.5 rounded-lg border border-[#46484D] text-[#E0C27F] text-xs font-display tracking-wider hover:bg-[#D6B56C]/15 flex items-center gap-1.5">
            <Play className="w-3.5 h-3.5" /> PROBAR
          </button>
        </div>
      )}
      {error && <div className="text-[13px] text-[#E39A7A] font-mono">{error}</div>}
      {!cat && !error && <div className="text-[13px] text-[#B9B2A8] font-mono">Leyendo capacidades…</div>}
      {grupos.map((g) => (
        <div key={g}>
          <div className="text-[12px] font-display tracking-normal text-[#B9B2A8] mb-2 flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-[#E0C27F]" /> {GRUPOS[g].toUpperCase()}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {caps
              .filter((c) => c.grupo === g)
              .map((c) => (
                <div key={c.id} className="p-3 rounded-xl border border-[#46484D] bg-[#34363A]/90 flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px] text-[#ECE8E2] font-medium leading-tight">{c.titulo}</div>
                    {c.vivo !== null && (
                      <span title={c.vivo ? 'responde ahora' : c.falta || 'no disponible'} className={`shrink-0 flex items-center gap-1 text-[12px] font-mono ${c.vivo ? 'text-emerald-400' : 'text-[#E39A7A]'}`}>
                        <CircleDot className="w-3 h-3" /> {c.vivo ? 'vivo' : 'falta'}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-[#B9B2A8] leading-snug">{c.detalle}</div>
                  {!c.vivo && c.falta && <div className="text-[12px] text-[#E39A7A]/80 font-mono">{c.falta}</div>}
                  {c.ejemplos.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {c.ejemplos.map((e) => (
                        <button key={e} type="button" onClick={() => onEjemplo(e)} className="text-[12px] px-2 py-0.5 rounded-md border border-[#46484D] text-[#E0C27F] hover:border-[#D6B56C] hover:bg-[#D6B56C]/10 font-mono">
                          «{e}»
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
      {cat?.canciones && cat.canciones.length > 0 && (
        <div>
          <div className="text-[12px] font-display tracking-normal text-[#B9B2A8] mb-2">REPERTORIO</div>
          <div className="flex flex-wrap gap-1.5">
            {cat.canciones.map((c) => (
              <button key={c.id} type="button" onClick={() => onEjemplo(c.pedir)} className="text-[13px] px-2.5 py-1 rounded-lg border border-[#46484D] bg-[#34363A]/90 text-[#ECE8E2] hover:border-[#D6B56C] hover:bg-[#D6B56C]/10">
                ♪ {c.titulo} <span className="text-[#8A847C]">· {c.artista}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
