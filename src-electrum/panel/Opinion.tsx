/**
 * «¿SIRVIÓ?» — debajo de cada respuesta de la mesa.
 *
 * Es la señal más barata y más honesta sobre la calidad: la deja quien recibió la respuesta. Va a la
 * traza de ese turno (POST /api/cognitivo/trazas/:id/opinion) y es la materia prima del entrenamiento
 * de Laya y de Qwen: sin opiniones no hay nada revisado que enseñar (lib/entrenamiento/dataset.ts).
 * 👎 pide en una línea qué debió hacer; se puede mandar vacío.
 */
import { useState } from 'react';
import { headersElectrum } from '../acceso';

type Estado = 'nada' | 'pidiendo-nota' | 'enviando' | 'hecho' | 'fallo';

export function Opinion({ trazaId, valor, onValor }: { trazaId: string; valor?: 1 | -1; onValor: (v: 1 | -1) => void }) {
  const [estado, setEstado] = useState<Estado>(valor ? 'hecho' : 'nada');
  const [nota, setNota] = useState('');
  const [elegido, setElegido] = useState<1 | -1 | undefined>(valor);

  const enviar = async (v: 1 | -1, texto?: string) => {
    setElegido(v);
    setEstado('enviando');
    try {
      const r = await fetch(`/api/cognitivo/trazas/${encodeURIComponent(trazaId)}/opinion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersElectrum() },
        body: JSON.stringify({ valor: v, ...(texto?.trim() ? { nota: texto.trim().slice(0, 600) } : {}) }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error();
      setEstado('hecho');
      onValor(v);
    } catch {
      setEstado('fallo');
    }
  };

  const boton = 'rounded-md px-1.5 py-0.5 text-[12px] leading-none transition-colors cursor-pointer disabled:cursor-default';
  if (estado === 'hecho') {
    return (
      <div className="mt-1 font-mono text-[10px] tracking-[0.08em] text-[#7F939D]" data-opinion="hecha">
        {elegido === 1 ? '👍' : '👎'} Gracias: así aprende el equipo.
      </div>
    );
  }
  return (
    <div className="mt-1" data-opinion={estado}>
      <div className="flex items-center gap-1">
        <span className="mr-1 font-mono text-[10px] tracking-[0.1em] uppercase text-[#6F838D]">¿Sirvió?</span>
        <button type="button" aria-label="Sirvió" title="Sirvió" disabled={estado === 'enviando'} onClick={() => void enviar(1)} className={`${boton} hover:bg-white/10`}>
          👍
        </button>
        <button
          type="button"
          aria-label="No sirvió"
          title="No sirvió"
          disabled={estado === 'enviando'}
          onClick={() => {
            setElegido(-1);
            setEstado('pidiendo-nota');
          }}
          className={`${boton} hover:bg-white/10 ${elegido === -1 ? 'bg-white/10' : ''}`}
        >
          👎
        </button>
        {estado === 'fallo' && <span className="text-[10.5px] text-[#E98A7A]">No se guardó; probá otra vez.</span>}
      </div>
      {estado === 'pidiendo-nota' && (
        <form
          className="mt-1 flex max-w-[92%] items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar(-1, nota);
          }}
        >
          <input
            autoFocus
            value={nota}
            maxLength={600}
            onChange={(e) => setNota(e.target.value)}
            placeholder="¿Qué debió hacer? (opcional)"
            aria-label="Qué debió hacer"
            className="min-w-0 flex-1 rounded-md border border-white/12 bg-black/30 px-2 py-1 text-[12px] text-[#E7EEF2] placeholder:text-[#6F838D] focus:border-[#FFAE3B]/60 focus:outline-none"
          />
          <button type="submit" className="rounded-md border border-white/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#C9D5DB] hover:border-white/30 cursor-pointer">
            Enviar
          </button>
        </form>
      )}
    </div>
  );
}
