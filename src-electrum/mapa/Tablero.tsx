/**
 * EL TABLERO NACIONAL, EN PANTALLA.
 *
 * Las cifras del catastro de un vistazo —con contadores que suben y barras que crecen, porque en
 * una sala de reuniones lo que se mueve es lo que se mira— y, sobre todo, los conflictos: cada
 * concesión que pisa un área protegida, una microcuenca o tiene caseríos dentro, con cuánto pisa.
 * Tocar una cierra el tablero y vuela el mapa hasta ella con su ficha abierta.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { headersElectrum } from '../acceso';
import { sinMovimiento } from '../movimiento';

const AMBAR = '#FFAE3B';

type Conflicto = { id: number; concesion: string; estado: string | null; con: string; ha: number; pct: number };
export type DatosTablero = {
  generado: string;
  total: { concesiones: number; hectareas: number };
  porEstado: Array<{ nombre: string; n: number; ha: number }>;
  porClase: Array<{ nombre: string; n: number; ha: number }>;
  porDepartamento: Array<{ nombre: string; n: number }>;
  traslapes: { total: number; hectareas: number; mayores: Array<{ a: string; b: string; ha: number; aId: number; bId: number }> };
  areasProtegidas: { concesiones: number; hectareas: number; lista: Conflicto[] } | null;
  microcuencas: { concesiones: number; hectareas: number; lista: Conflicto[] } | null;
  poblados: { concesiones: number; caserios: number; lista: Array<{ id: number; concesion: string; n: number; nombres: string[] }> } | null;
};

const nf = (x: number, d = 0) => x.toLocaleString('es-ES', { maximumFractionDigits: d });

/** El tablero se pide una vez y se comparte (lo usa también el recorrido). */
let enMemoria: Promise<DatosTablero> | null = null;
export function pedirTablero(): Promise<DatosTablero> {
  if (!enMemoria) {
    enMemoria = fetch('/api/electrum/tablero', { headers: headersElectrum() })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.total) throw new Error(j?.error || `El servidor contestó ${r.status}.`);
        return j as DatosTablero;
      })
      .catch((e) => {
        enMemoria = null;
        throw e;
      });
  }
  return enMemoria;
}

/** Un número que sube desde cero hasta su valor. */
function Contador({ valor, ms = 1400, d = 0 }: { valor: number; ms?: number; d?: number }) {
  const [v, setV] = useState(sinMovimiento() ? valor : 0);
  useEffect(() => {
    if (sinMovimiento()) return setV(valor);
    let raf = 0;
    const t0 = performance.now();
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(valor * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor, ms]);
  return <>{nf(v, d)}</>;
}

function Barras({ filas, color = AMBAR }: { filas: Array<{ nombre: string; n: number }>; color?: string }) {
  const max = Math.max(1, ...filas.map((f) => f.n));
  const [lleno, setLleno] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLleno(true), 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <ul className="space-y-1.5">
      {filas.map((f) => (
        <li key={f.nombre} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-2 text-[12px]">
          <span className="truncate text-[#C9D5DB]" title={f.nombre}>
            {f.nombre}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <span
              className="block h-full rounded-full"
              style={{ width: lleno ? `${(f.n / max) * 100}%` : '0%', background: color, transition: 'width 1.2s cubic-bezier(.22,.61,.36,1)' }}
            />
          </span>
          <span className="w-10 text-right font-mono text-[11px] text-[#E7EEF2]">{nf(f.n)}</span>
        </li>
      ))}
    </ul>
  );
}

function Tarjeta({ titulo, children, className = '' }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-white/10 bg-white/[0.03] p-3 ${className}`}>
      <h3 className="mb-2 font-mono text-[10px] tracking-[0.16em] uppercase text-[#7F939D]">{titulo}</h3>
      {children}
    </section>
  );
}

function Cifra({ etiqueta, valor, sufijo, color = AMBAR, d = 0 }: { etiqueta: string; valor: number; sufijo?: string; color?: string; d?: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="font-display text-[26px] font-bold leading-none md:text-[30px]" style={{ color }}>
        <Contador valor={valor} d={d} />
        {sufijo && <span className="ml-1 text-[13px] font-medium text-[#9FB0B8]">{sufijo}</span>}
      </div>
      <div className="mt-1.5 text-[11.5px] leading-snug text-[#9FB0B8]">{etiqueta}</div>
    </div>
  );
}

function ListaConflictos({ lista, onIr, color }: { lista: Conflicto[]; onIr: (id: number) => void; color: string }) {
  return (
    <ol className="space-y-1">
      {lista.slice(0, 8).map((c, i) => (
        <li key={`${c.id}-${c.con}`}>
          <button
            type="button"
            onClick={() => onIr(c.id)}
            className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-white/[0.06] cursor-pointer"
          >
            <span className="w-4 shrink-0 font-mono text-[10px] text-[#61717A]">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="text-[#E7EEF2]">{c.concesion}</span>
              <span className="text-[#7F939D]"> · {c.con}</span>
            </span>
            <span className="shrink-0 font-mono text-[11px]" style={{ color }}>
              {nf(c.ha, 1)} ha{c.pct ? ` · ${nf(c.pct)} %` : ''}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function Tablero({ abierto, onCerrar, onIr }: { abierto: boolean; onCerrar: () => void; onIr: (id: number) => void }) {
  const [datos, setDatos] = useState<DatosTablero | null>(null);
  const [error, setError] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    setError(null);
    pedirTablero().then(setDatos, (e) => setError(String(e?.message || e)));
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [abierto, onCerrar]);

  if (!abierto) return null;
  const d = datos;

  return (
    <div className="absolute inset-x-0 bottom-0 top-[52px] z-[35] overflow-hidden bg-[#06080a]/88 backdrop-blur-md" role="dialog" aria-label="Tablero nacional">
      <div ref={caja} className="mx-auto h-full max-w-6xl overflow-y-auto px-3 py-3 pb-28 md:px-6 md:py-5">
        <header className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] tracking-[0.2em] uppercase" style={{ color: AMBAR }}>
              Tablero nacional · catastro minero de Honduras
            </div>
            <h2 className="mt-0.5 text-[17px] font-semibold text-[#F3F6F8] md:text-[20px]">Lo que hay, dónde está y qué pisa</h2>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar el tablero" className="h-8 w-8 shrink-0 rounded-full text-[18px] text-[#8FA3B0] hover:bg-white/10 hover:text-white cursor-pointer">
            ×
          </button>
        </header>

        {error && <p className="text-[#E8A08F]">No pude armar el tablero: {error}</p>}
        {!d && !error && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4" role="status" aria-label="Cargando">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-white/[0.05]" />
            ))}
          </div>
        )}

        {d && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Cifra etiqueta="concesiones en el catastro" valor={d.total.concesiones} />
              <Cifra etiqueta="hectáreas concesionadas" valor={d.total.hectareas} sufijo="ha" />
              <Cifra etiqueta={`traslapes entre derechos (${nf(d.traslapes.hectareas)} ha)`} valor={d.traslapes.total} color="#FFD98A" />
              {d.areasProtegidas && (
                <Cifra etiqueta={`concesiones que pisan áreas protegidas (${nf(d.areasProtegidas.hectareas)} ha)`} valor={d.areasProtegidas.concesiones} color="#2ECC71" />
              )}
              {d.microcuencas && (
                <Cifra etiqueta={`pisan microcuencas declaradas (${nf(d.microcuencas.hectareas)} ha)`} valor={d.microcuencas.concesiones} color="#4DA3FF" />
              )}
              {d.poblados && <Cifra etiqueta={`concesiones con caseríos dentro (${nf(d.poblados.caserios)} caseríos)`} valor={d.poblados.concesiones} color="#E8805F" />}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Tarjeta titulo="Por estado">
                <Barras filas={d.porEstado} />
              </Tarjeta>
              <Tarjeta titulo="Por clase">
                <Barras filas={d.porClase} color="#C9A0FF" />
              </Tarjeta>
              <Tarjeta titulo="Por departamento">
                <Barras filas={d.porDepartamento.slice(0, 10)} color="#7CFFB2" />
              </Tarjeta>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {d.areasProtegidas && d.areasProtegidas.lista.length > 0 && (
                <Tarjeta titulo="Pisan áreas protegidas · tocá una para ir">
                  <ListaConflictos lista={d.areasProtegidas.lista} onIr={onIr} color="#2ECC71" />
                </Tarjeta>
              )}
              {d.microcuencas && d.microcuencas.lista.length > 0 && (
                <Tarjeta titulo="Pisan microcuencas declaradas">
                  <ListaConflictos lista={d.microcuencas.lista} onIr={onIr} color="#4DA3FF" />
                </Tarjeta>
              )}
              {d.poblados && d.poblados.lista.length > 0 && (
                <Tarjeta titulo="Caseríos dentro de la concesión">
                  <ol className="space-y-1">
                    {d.poblados.lista.slice(0, 8).map((p, i) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => onIr(p.id)} className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-white/[0.06] cursor-pointer">
                          <span className="w-4 shrink-0 font-mono text-[10px] text-[#61717A]">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="text-[#E7EEF2]">{p.concesion}</span>
                            {p.nombres.length > 0 && <span className="text-[#7F939D]"> · {p.nombres.join(', ')}</span>}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-[#E8805F]">{p.n}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </Tarjeta>
              )}
              {d.traslapes.mayores.length > 0 && (
                <Tarjeta titulo="Mayores traslapes entre concesiones">
                  <ol className="space-y-1">
                    {d.traslapes.mayores.map((t, i) => (
                      <li key={`${t.aId}-${t.bId}`}>
                        <button type="button" onClick={() => onIr(t.aId)} className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-white/[0.06] cursor-pointer">
                          <span className="w-4 shrink-0 font-mono text-[10px] text-[#61717A]">{i + 1}</span>
                          <span className="min-w-0 flex-1 text-[#E7EEF2]">
                            {t.a} <span className="text-[#7F939D]">con</span> {t.b}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-[#FFD98A]">{nf(t.ha, 1)} ha</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </Tarjeta>
              )}
            </div>
            <p className="pb-2 text-[11px] text-[#61717A]">
              Cruces hechos en PostGIS con las capas cargadas (catastro nacional, áreas protegidas, microcuencas declaradas y caseríos). Actualizado{' '}
              {new Date(d.generado).toLocaleString('es-HN')}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
