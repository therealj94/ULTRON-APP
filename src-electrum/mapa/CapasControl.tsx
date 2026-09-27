/**
 * ENCENDER CAPAS ENCIMA DEL CATASTRO.
 *
 * La geología, las fallas, los yacimientos, las áreas protegidas… ya estaban en la base: Dr
 * Electrum las cruzaba para contestar, pero en el mapa no se podían ver. Aquí se encienden y se
 * apagan una por una. La lista la da el servidor (solo las que un teléfono aguanta pintar); cada
 * capa se baja la primera vez que se enciende y queda guardada mientras la pantalla siga abierta.
 */
import { useCallback, useRef, useState } from 'react';
import { headersElectrum } from '../acceso';
import type { CapaExtra, RolVisible } from './captura';
import { COLOR_ROCA, ESTILO_ROL, NOMBRE_ROCA } from './capas';

const AMBAR = '#FFAE3B';
type Disponible = { id: number; nombre: string; rol: RolVisible; entidades: number };

export function CapasControl({ encendidas, onCambio }: { encendidas: CapaExtra[]; onCambio: (c: CapaExtra[]) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Disponible[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<number | null>(null);
  const guardadas = useRef(new Map<number, CapaExtra>());

  const abrir = useCallback(async () => {
    setAbierto((a) => !a);
    if (lista) return;
    try {
      const r = await fetch('/api/electrum/mapa/capas', { headers: headersElectrum() });
      const j = await r.json().catch(() => null);
      if (!r.ok) return setError(j?.error || `El servidor contestó ${r.status}.`);
      setLista(j.capas || []);
    } catch {
      setError('No alcancé el servidor.');
    }
  }, [lista]);

  const alternar = useCallback(
    async (c: Disponible) => {
      if (encendidas.some((x) => x.id === c.id)) return onCambio(encendidas.filter((x) => x.id !== c.id));
      let capa = guardadas.current.get(c.id);
      if (!capa) {
        setBajando(c.id);
        try {
          const r = await fetch(`/api/electrum/mapa/capa/${c.id}`, { headers: headersElectrum() });
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.geojson) {
            setError(j?.error || `No pude bajar ${c.nombre}.`);
            return;
          }
          capa = { id: c.id, nombre: c.nombre, rol: c.rol, geojson: j.geojson };
          guardadas.current.set(c.id, capa);
        } catch {
          setError(`No pude bajar ${c.nombre}: revisá la conexión.`);
          return;
        } finally {
          setBajando(null);
        }
      }
      setError(null);
      onCambio([...encendidas, capa]);
    },
    [encendidas, onCambio]
  );

  const hayRoca = encendidas.some((c) => c.rol === 'litologia');

  return (
    /*
     * La caja va de debajo de la cara hasta el pie del mapa, sin tocar nada: la lista crece hacia
     * arriba dentro de ella y se desplaza si no cabe, en vez de meterse debajo de la cara.
     */
    <div className="pointer-events-none absolute left-3 bottom-3 top-[150px] z-10 flex flex-col items-start justify-end gap-2">
      {abierto && (
        <div className="pointer-events-auto min-h-0 max-h-[420px] w-[280px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-white/12 bg-[#0A0C0E]/94 p-3 text-[12.5px] text-[#C9D5DB] shadow-[0_10px_30px_rgba(0,0,0,.55)] backdrop-blur-xl">
          <div className="mb-2 font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
            Capas sobre el catastro
          </div>
          {error && <p className="mb-2 text-[#E8A08F]">{error}</p>}
          {!lista && !error && <p className="text-[#7F939D]">Cargando la lista…</p>}
          {lista && !lista.length && <p className="text-[#7F939D]">No hay capas cargadas que se puedan pintar.</p>}
          <ul className="space-y-1">
            {lista?.map((c) => {
              const on = encendidas.some((x) => x.id === c.id);
              const e = ESTILO_ROL[c.rol];
              return (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-white/[0.05]">
                    <input type="checkbox" checked={on} disabled={bajando === c.id} onChange={() => void alternar(c)} className="mt-[3px] accent-[#FFAE3B]" />
                    <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: e?.color || '#fff' }} />
                    <span className="min-w-0">
                      <span className="block leading-snug text-[#E7EEF2]">{e?.nombre || c.rol}</span>
                      <span className="block truncate text-[11px] text-[#7F939D]" title={c.nombre}>
                        {bajando === c.id ? 'bajando…' : `${c.nombre} · ${c.entidades.toLocaleString('es-HN')}`}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {hayRoca && (
            <div className="mt-3 border-t border-white/[0.08] pt-2">
              <div className="mb-1 font-mono text-[10px] tracking-[0.14em] uppercase text-[#7F939D]">Clases de roca</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {Object.entries(COLOR_ROCA).map(([k, color]) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
                    {NOMBRE_ROCA[k]}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-snug text-[#61717A]">Tocá cualquier concesión, rasgo o punto del mapa para ver su información.</p>
        </div>
      )}
      <button
        type="button"
        onClick={() => void abrir()}
        aria-expanded={abierto}
        className="pointer-events-auto shrink-0 flex items-center gap-2 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase text-[#DCE5EA] shadow-lg backdrop-blur-md hover:border-white/30 cursor-pointer"
      >
        <span aria-hidden>▤</span> Capas{encendidas.length ? ` · ${encendidas.length}` : ''}
      </button>
    </div>
  );
}
