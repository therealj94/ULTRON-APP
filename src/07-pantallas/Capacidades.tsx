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
  voz?: { oficial?: { nombre: string; motor: string; timbre: string; expresividad: string[] }; elevenlabs?: boolean; ttsLocal?: string | null };
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
        <div className="p-3 rounded-xl border border-[#05E1FF]/30 bg-[#05E1FF]/5 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-display tracking-[0.25em] text-[#8FA3B0]">VOZ OFICIAL</div>
            <div className="text-sm text-white font-medium mt-0.5">
              {cat.voz.oficial.nombre} · <span className="text-[#dff8ff]">{cat.voz.oficial.timbre}</span>
            </div>
            <div className="text-[11px] text-[#8FA3B0] mt-0.5">{cat.voz.oficial.motor}. Sabe: {cat.voz.oficial.expresividad.join(', ')}.</div>
            <div className="text-[10px] mt-1 font-mono">
              <span className={cat.voz.elevenlabs ? 'text-emerald-400' : 'text-amber-400'}>{cat.voz.elevenlabs ? '● ElevenLabs conectado' : '○ ElevenLabs sin clave'}</span>
              {cat.voz.ttsLocal && <span className="text-[#6B8A90]"> · respaldo local configurado</span>}
            </div>
          </div>
          <button type="button" onClick={onProbarVoz} className="shrink-0 px-3 py-1.5 rounded-lg border border-[#05E1FF]/50 text-[#05E1FF] text-xs font-display tracking-wider hover:bg-[#05E1FF]/15 flex items-center gap-1.5">
            <Play className="w-3.5 h-3.5" /> PROBAR
          </button>
        </div>
      )}
      {error && <div className="text-[11px] text-amber-400 font-mono">{error}</div>}
      {!cat && !error && <div className="text-[11px] text-[#8FA3B0] font-mono">Leyendo capacidades…</div>}
      {grupos.map((g) => (
        <div key={g}>
          <div className="text-[10px] font-display tracking-[0.25em] text-[#8FA3B0] mb-2 flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-[#05E1FF]" /> {GRUPOS[g].toUpperCase()}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {caps
              .filter((c) => c.grupo === g)
              .map((c) => (
                <div key={c.id} className="p-3 rounded-xl border border-white/10 bg-black/40 flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px] text-white font-medium leading-tight">{c.titulo}</div>
                    {c.vivo !== null && (
                      <span title={c.vivo ? 'responde ahora' : c.falta || 'no disponible'} className={`shrink-0 flex items-center gap-1 text-[10px] font-mono ${c.vivo ? 'text-emerald-400' : 'text-amber-400'}`}>
                        <CircleDot className="w-3 h-3" /> {c.vivo ? 'vivo' : 'falta'}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#8FA3B0] leading-snug">{c.detalle}</div>
                  {!c.vivo && c.falta && <div className="text-[10px] text-amber-400/80 font-mono">{c.falta}</div>}
                  {c.ejemplos.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {c.ejemplos.map((e) => (
                        <button key={e} type="button" onClick={() => onEjemplo(e)} className="text-[10px] px-2 py-0.5 rounded-md border border-[#05E1FF]/25 text-[#9fe9f7] hover:border-[#05E1FF] hover:bg-[#05E1FF]/10 font-mono">
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
          <div className="text-[10px] font-display tracking-[0.25em] text-[#8FA3B0] mb-2">REPERTORIO</div>
          <div className="flex flex-wrap gap-1.5">
            {cat.canciones.map((c) => (
              <button key={c.id} type="button" onClick={() => onEjemplo(c.pedir)} className="text-[11px] px-2.5 py-1 rounded-lg border border-[#05E1FF]/25 bg-black/40 text-[#dff8ff] hover:border-[#05E1FF] hover:bg-[#05E1FF]/10">
                ♪ {c.titulo} <span className="text-[#6B8A90]">· {c.artista}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
