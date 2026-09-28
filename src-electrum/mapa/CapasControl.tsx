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
import type { CapaExtra, RasterEncendido, RasterEscaneado, RolVisible } from './captura';
import { COLOR_ROCA, ESTILO_ROL, NOMBRE_ROCA } from './capas';
import { ELEMENTOS_MUESTRA, NOMBRE_ELEMENTO, leyendaMuestras, type ElementoMuestra } from './muestras';

/** Los rasters por sección, en el orden en que llegan: los mapas escaneados y lo calculado del satélite. */
function gruposRaster(xs: RasterEscaneado[] | null): Array<[string, RasterEscaneado[]]> {
  const g = new Map<string, RasterEscaneado[]>();
  for (const x of xs || []) {
    const k = x.grupo || 'Mapas escaneados';
    g.set(k, [...(g.get(k) || []), x]);
  }
  return [...g];
}

export type MuestrasEncendidas = { elemento: ElementoMuestra; geojson: { features?: unknown[] } };

const AMBAR = '#FFAE3B';
type Disponible = { id: number; nombre: string; rol: RolVisible; entidades: number };

/**
 * `onCambio` recibe una función sobre la lista del momento, no una lista armada aquí: dos capas
 * que terminan de bajar casi a la vez armaban cada una su lista con la vieja y la segunda borraba
 * a la primera (revisión de Codex en #44).
 */
export function CapasControl({
  encendidas,
  onCambio,
  rasters = [],
  onRasters,
  onEncuadrar,
  muestras = null,
  onMuestras,
}: {
  encendidas: CapaExtra[];
  onCambio: (f: (antes: CapaExtra[]) => CapaExtra[]) => void;
  /** Mapas escaneados encendidos (JICA…), con su transparencia. */
  rasters?: RasterEncendido[];
  onRasters?: (f: (antes: RasterEncendido[]) => RasterEncendido[]) => void;
  /** Llevar el mapa al encuadre de un mapa escaneado al encenderlo. */
  onEncuadrar?: (encuadre: [number, number, number, number]) => void;
  /** Muestras geoquímicas de JICA encendidas y el elemento que las colorea. */
  muestras?: MuestrasEncendidas | null;
  onMuestras?: (m: MuestrasEncendidas | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Disponible[] | null>(null);
  const [escaneados, setEscaneados] = useState<RasterEscaneado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<number | null>(null);
  const guardadas = useRef(new Map<number, CapaExtra>());
  /** Los puntos, bajados la primera vez que se encienden y guardados mientras siga la pantalla. */
  const puntos = useRef<MuestrasEncendidas['geojson'] | null>(null);
  const [errorMuestras, setErrorMuestras] = useState<string | null>(null);
  const [bajandoMuestras, setBajandoMuestras] = useState(false);
  const [elemento, setElemento] = useState<ElementoMuestra>('au');

  const encenderMuestras = useCallback(
    async (e: ElementoMuestra) => {
      if (!onMuestras) return;
      if (!puntos.current) {
        setBajandoMuestras(true);
        try {
          const r = await fetch('/api/electrum/mapa/muestras', { headers: headersElectrum() });
          const j = await r.json().catch(() => null);
          if (!r.ok || !Array.isArray(j?.features)) return setErrorMuestras(j?.error || `No pude bajar las muestras (el servidor contestó ${r.status}).`);
          if (!j.features.length) return setErrorMuestras('Todavía no hay muestras cargadas en este servidor.');
          puntos.current = j;
        } catch {
          return setErrorMuestras('No pude bajar las muestras: revisá la conexión.');
        } finally {
          setBajandoMuestras(false);
        }
      }
      setErrorMuestras(null);
      onMuestras({ elemento: e, geojson: puntos.current! });
    },
    [onMuestras]
  );

  const abrir = useCallback(async () => {
    setAbierto((a) => !a);
    /*
     * Los mapas escaneados son un extra: si su índice falla (o llega vacío porque el cubo no
     * contestó), la lista de capas sigue sirviendo y el índice se vuelve a pedir la próxima vez que
     * se abra la caja, en vez de quedar vacío toda la sesión.
     */
    if (!escaneados?.length) {
      fetch('/api/electrum/mapa/rasters', { headers: headersElectrum() })
        .then((rr) => (rr.ok ? rr.json() : null))
        .then((jr) => setEscaneados(Array.isArray(jr?.rasters) ? jr.rasters : []))
        .catch(() => setEscaneados((antes) => antes ?? []));
    }
    if (lista) return;
    try {
      const r = await fetch('/api/electrum/mapa/capas', { headers: headersElectrum() });
      const j = await r.json().catch(() => null);
      if (!r.ok) return setError(j?.error || `El servidor contestó ${r.status}.`);
      setLista(j.capas || []);
    } catch {
      setError('No alcancé el servidor.');
    }
  }, [lista, escaneados]);

  const alternarRaster = useCallback(
    (x: RasterEscaneado) => {
      if (!onRasters) return;
      if (rasters.some((r) => r.clave === x.clave)) return onRasters((antes) => antes.filter((r) => r.clave !== x.clave));
      onRasters((antes) => (antes.some((r) => r.clave === x.clave) ? antes : [...antes, { ...x, opacidad: 0.75 }]));
      onEncuadrar?.(x.encuadre);
    },
    [rasters, onRasters, onEncuadrar]
  );

  const alternar = useCallback(
    async (c: Disponible) => {
      if (encendidas.some((x) => x.id === c.id)) return onCambio((antes) => antes.filter((x) => x.id !== c.id));
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
      const nueva = capa;
      onCambio((antes) => (antes.some((x) => x.id === nueva.id) ? antes : [...antes, nueva]));
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
          {gruposRaster(escaneados).map(([grupo, xs]) => (
            <div key={grupo} className="mt-3 border-t border-white/[0.08] pt-2">
              <div className="mb-1 font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: AMBAR }}>
                {grupo}
              </div>
              <ul className="space-y-1">
                {xs.map((x) => {
                  const on = rasters.find((r) => r.clave === x.clave);
                  return (
                    <li key={x.clave}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-white/[0.05]">
                        <input type="checkbox" checked={!!on} onChange={() => alternarRaster(x)} className="mt-[3px] accent-[#FFAE3B]" />
                        <span className="min-w-0">
                          <span className="block leading-snug text-[#E7EEF2]">{x.nombre}</span>
                          <span className="block truncate text-[11px] text-[#7F939D]" title={x.notas || x.fuente}>
                            {[x.fuente, x.escala].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </label>
                      {on && (
                        <div className="flex items-center gap-2 pl-7 pr-1 pb-1">
                          <span className="font-mono text-[10px] text-[#7F939D]">transparencia</span>
                          <input
                            type="range"
                            min={10}
                            max={100}
                            step={5}
                            value={Math.round(on.opacidad * 100)}
                            aria-label={`Transparencia de ${x.nombre}`}
                            onChange={(e) => {
                              const v = Number(e.target.value) / 100;
                              onRasters?.((antes) => antes.map((r) => (r.clave === x.clave ? { ...r, opacidad: v } : r)));
                            }}
                            className="h-1 flex-1 accent-[#FFAE3B]"
                          />
                          <button type="button" onClick={() => onEncuadrar?.(x.encuadre)} className="font-mono text-[10px] text-[#B9C7CE] hover:text-white cursor-pointer">
                            ir
                          </button>
                        </div>
                      )}
                      {on && !!x.leyenda?.length && (
                        <div className="grid grid-cols-1 gap-y-0.5 pl-7 pr-1 pb-1">
                          {x.leyenda.map((l) => (
                            <span key={l.texto} className="flex items-center gap-1.5 text-[10.5px]">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: l.color }} />
                              {l.texto}
                            </span>
                          ))}
                          {x.notas && <span className="mt-0.5 text-[10.5px] leading-snug text-[#61717A]">{x.notas}</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {onMuestras && (
            <div className="mt-3 border-t border-white/[0.08] pt-2">
              <div className="mb-1 font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: AMBAR }}>
                Muestras geoquímicas
              </div>
              <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-white/[0.05]">
                <input
                  type="checkbox"
                  checked={!!muestras}
                  disabled={bajandoMuestras}
                  onChange={() => (muestras ? onMuestras(null) : void encenderMuestras(elemento))}
                  className="mt-[3px] accent-[#FFAE3B]"
                />
                <span className="min-w-0">
                  <span className="block leading-snug text-[#E7EEF2]">Rocas, sedimentos y minerales (JICA)</span>
                  <span className="block text-[11px] text-[#7F939D]">
                    {bajandoMuestras ? 'Bajando…' : muestras ? `${muestras.geojson.features?.length ?? 0} muestras · Fases I–III` : 'Fases I–III · leyes de laboratorio'}
                  </span>
                </span>
              </label>
              {errorMuestras && <p className="px-1 text-[11px] text-[#E8A08F]">{errorMuestras}</p>}
              {muestras && (
                <div className="pl-7 pr-1 pb-1">
                  <select
                    value={muestras.elemento}
                    aria-label="Elemento que colorea las muestras"
                    onChange={(ev) => {
                      const e = ev.target.value as ElementoMuestra;
                      setElemento(e);
                      onMuestras({ ...muestras, elemento: e });
                    }}
                    className="mb-1.5 w-full rounded-md border border-white/12 bg-black/50 px-2 py-1 text-[12px] text-[#E7EEF2]"
                  >
                    {ELEMENTOS_MUESTRA.map((e) => (
                      <option key={e} value={e}>
                        {NOMBRE_ELEMENTO[e]}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {leyendaMuestras(muestras.elemento).map((l) => (
                      <span key={l.texto} className="flex items-center gap-1.5 whitespace-nowrap text-[10.5px]">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                        {l.texto}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
        <span aria-hidden>▤</span> Capas{encendidas.length + rasters.length + (muestras ? 1 : 0) ? ` · ${encendidas.length + rasters.length + (muestras ? 1 : 0)}` : ''}
      </button>
    </div>
  );
}
