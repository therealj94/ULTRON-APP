/**
 * LO QUE SE ABRE AL TOCAR EL MAPA.
 *
 * Tocar una concesión abre su ficha: datos del catastro, alertas del entorno, geología y documentos,
 * con botones para volar a ella, bajar la ficha en PDF, pedir los mapas geológicos o preguntarle a
 * Dr Electrum. Tocar un punto cualquiera dice quién lo tiene, qué hay cerca y sobre qué roca está.
 * Tocar un rasgo de una capa encendida (una unidad de roca, una falla, un yacimiento) enseña sus
 * atributos tal cual vienen en la capa.
 *
 * No carga MapLibre: vive fuera del trozo del mapa y lo monta App encima de él.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Geometry } from 'geojson';
import { headersElectrum } from '../acceso';
import type { OrdenMapa, Tocado } from './captura';
import { colorProsp } from './prospectividad';
import { Timelapse } from './Timelapse';

const AMBAR = '#FFAE3B';

type Parte = { estado: 'ok'; renglones: string[] } | { estado: 'error'; motivo: string };
type Ficha = {
  id: number;
  nombre: string;
  datos: Array<[string, string]>;
  encuadre: [number, number, number, number] | null;
  geojson: Geometry | null;
  entorno: Parte;
  geologia: Parte;
  documentos: Parte;
  /** Sentinel-2 dentro de la concesión; un servidor anterior no lo manda. */
  satelite?: Parte;
  /** Geología + geoquímica + satélite, de 0 a 100; un servidor anterior no lo manda. */
  prospectividad?: Parte & { puntaje?: number; nivel?: string };
};
type Lista<T> = { estado: 'ok'; lista: T[] } | { estado: 'error'; motivo: string };
type Aqui = {
  lon: number;
  lat: number;
  concesiones: Lista<{ id: number; nombre: string; titular: string | null }>;
  cerca: Lista<{ id: number; nombre: string; km: number }>;
  geologia: Parte;
};
type Rasgo = { id: number; capa: string; rol: string | null; nombre: string; atributos: Array<[string, string]> };
type Muestra = {
  id: number;
  codigo: string;
  tipo: string;
  fuente: string;
  datum: string;
  utm: [number, number];
  lon: number;
  lat: number;
  lugar: string | null;
  completa: boolean;
  leyes: Array<[string, string]>;
  concesiones: Array<{ id: number; nombre: string }>;
};

type Props = {
  tocado: Tocado | null;
  onCerrar: () => void;
  onVolar: (o: OrdenMapa) => void;
  onPreguntar: (texto: string) => void;
  /** La ficha en PDF; con `presentarA`, el plano sale en el sistema de esa institución y con firma y sello. */
  onFicha: (id: number, presentarA?: 'INHGEOMIN' | 'ICF' | 'SERNA') => void;
  onTocar: (t: Tocado) => void;
  /** Entró con un código temporal: ve la ficha entera, pero sin los botones para bajar archivos. */
  invitado?: boolean;
};

function urlDe(t: Tocado): string {
  if (t.tipo === 'concesion') return `/api/electrum/mapa/concesion/${t.id}`;
  if (t.tipo === 'rasgo') return `/api/electrum/mapa/rasgo/${t.eid}`;
  if (t.tipo === 'muestra') return `/api/electrum/mapa/muestra/${t.id}`;
  return `/api/electrum/mapa/aqui?lon=${t.lngLat[0].toFixed(6)}&lat=${t.lngLat[1].toFixed(6)}`;
}

export function Tarjeta({ tocado, onCerrar, onVolar, onPreguntar, onFicha, onTocar, invitado = false }: Props) {
  const [datos, setDatos] = useState<Ficha | Aqui | Rasgo | Muestra | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pregunta, setPregunta] = useState('');

  useEffect(() => {
    setDatos(null);
    setError(null);
    setPregunta('');
    if (!tocado) return;
    const corte = new AbortController();
    (async () => {
      try {
        const r = await fetch(urlDe(tocado), { headers: headersElectrum(), signal: corte.signal });
        const j = await r.json().catch(() => null);
        if (corte.signal.aborted) return;
        if (!r.ok) return setError(j?.error || (r.status === 404 ? 'Esta función todavía no está activa en el servidor.' : `El servidor contestó ${r.status}.`));
        setDatos(j);
        // El puntaje recién calculado va al mapa, para que el relleno por prospectividad lo pinte ya.
        if (tocado.tipo === 'concesion' && typeof j?.prospectividad?.puntaje === 'number') {
          window.dispatchEvent(new CustomEvent('electrum:prospectividad', { detail: { id: tocado.id, puntaje: j.prospectividad.cobertura > 0 ? j.prospectividad.puntaje : null } }));
        }
      } catch (e: any) {
        if (!corte.signal.aborted) setError('No alcancé el servidor. Revisá la conexión y volvé a tocar.');
      }
    })();
    return () => corte.abort();
  }, [tocado]);

  // Esc cierra, como cualquier ventana.
  useEffect(() => {
    if (!tocado) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [tocado, onCerrar]);

  if (!tocado) return null;

  const titulo =
    tocado.tipo === 'concesion'
      ? (datos as Ficha | null)?.nombre || tocado.nombre || `Concesión ${tocado.id}`
      : tocado.tipo === 'rasgo'
        ? (datos as Rasgo | null)?.nombre || tocado.nombre || 'Rasgo de la capa'
        : tocado.tipo === 'muestra'
          ? `Muestra ${(datos as Muestra | null)?.codigo || tocado.nombre || tocado.id}`
          : `${tocado.lngLat[1].toFixed(5)}, ${tocado.lngLat[0].toFixed(5)}`;
  const etiqueta =
    tocado.tipo === 'concesion'
      ? 'Concesión'
      : tocado.tipo === 'rasgo'
        ? `${tocado.capa ? `${String(tocado.capa).padStart(6, '0')} · ` : ''}${(datos as Rasgo | null)?.capa || 'Capa'}`
        : tocado.tipo === 'muestra'
          ? 'Muestra geoquímica · JICA'
          : '¿Qué hay aquí?';

  const preguntarSobre = (q: string) => {
    const base =
      tocado.tipo === 'concesion'
        ? `Sobre la concesión ${titulo} (id ${tocado.id}): `
        : tocado.tipo === 'punto'
          ? `Sobre el punto ${tocado.lngLat[1].toFixed(5)}, ${tocado.lngLat[0].toFixed(5)}: `
          : tocado.tipo === 'muestra'
            ? `Sobre la ${titulo.toLowerCase()} de JICA (en ${tocado.lngLat[1].toFixed(5)}, ${tocado.lngLat[0].toFixed(5)}): `
            : `Sobre ${titulo} de la capa ${etiqueta}: `;
    onPreguntar(base + q);
  };

  return (
    <section
      role="dialog"
      aria-label={`${etiqueta}: ${titulo}`}
      data-tour="ficha"
      data-ventana
      className="absolute z-20 flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0A0C0E]/94 shadow-[0_12px_40px_rgba(0,0,0,.6)] backdrop-blur-xl left-2 right-[48px] bottom-2 max-h-[calc(100%-118px)] md:left-auto md:right-[52px] md:bottom-3 md:top-[118px] md:max-h-none md:w-[372px]"
    >
      <header className="flex items-start gap-2 border-b border-white/[0.08] px-4 pt-3 pb-2.5 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
            {etiqueta}
          </div>
          <h2 className="mt-0.5 text-[15px] font-semibold leading-snug text-[#F3F6F8] break-words">{titulo}</h2>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full text-[16px] text-[#8FA3B0] hover:bg-white/10 hover:text-white cursor-pointer"
          aria-label="Cerrar"
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-[13px] leading-relaxed text-[#C9D5DB]">
        {error && <p className="text-[#E8A08F]">{error}</p>}
        {!error && !datos && <Cargando />}

        {datos && tocado.tipo === 'concesion' && (
          <FichaVista f={datos as Ficha} onVolar={onVolar} onFicha={onFicha} onPreguntar={onPreguntar} invitado={invitado} />
        )}
        {datos && tocado.tipo === 'punto' && <AquiVista a={datos as Aqui} onTocar={onTocar} onPreguntar={onPreguntar} />}
        {datos && tocado.tipo === 'rasgo' && <RasgoVista r={datos as Rasgo} />}
        {datos && tocado.tipo === 'muestra' && <MuestraVista m={datos as Muestra} onTocar={onTocar} onPreguntar={onPreguntar} />}
      </div>

      <form
        className="flex gap-2 border-t border-white/[0.08] px-3 py-2.5 shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          if (pregunta.trim()) preguntarSobre(pregunta.trim());
          setPregunta('');
        }}
      >
        <input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          placeholder="Pregúntele a Dr Electrum sobre esto…"
          className="min-w-0 flex-1 rounded-lg border border-white/12 bg-black/40 px-3 py-1.5 text-[13px] text-[#E7EEF2] placeholder:text-[#7F939D] focus:border-[#FFAE3B]/60 focus:outline-none"
        />
        <button type="submit" className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-black cursor-pointer" style={{ background: AMBAR }}>
          Preguntar
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ piezas */

function Cargando() {
  return (
    <div className="space-y-2" role="status" aria-label="Cargando">
      {[80, 64, 72, 50].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-white/[0.07]" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 font-mono text-[10px] tracking-[0.16em] uppercase text-[#7F939D]">{titulo}</h3>
      {children}
    </div>
  );
}

function Renglones({ p, alerta = false }: { p: Parte; alerta?: boolean }) {
  if (p.estado === 'error') return <p className="text-[#8FA3B0]">No se pudo calcular: {p.motivo}</p>;
  return (
    <ul className="space-y-1">
      {p.renglones.map((r, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: alerta && !/^(No cruzado|Sin |Municipio|Carretera)/.test(r) ? '#E8805F' : '#5E7078' }} />
          <span>{r}</span>
        </li>
      ))}
    </ul>
  );
}

function Boton({ children, onClick, fuerte = false, tour }: { children: ReactNode; onClick: () => void; fuerte?: boolean; tour?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour={tour}
      className="rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer"
      style={fuerte ? { background: AMBAR, borderColor: AMBAR, color: '#000' } : { borderColor: 'rgba(255,255,255,.14)', color: '#DCE5EA' }}
    >
      {children}
    </button>
  );
}

/**
 * El plano para PRESENTAR: INHGEOMIN lo recibe en NAD27 / UTM con la cuadrícula en múltiplos de
 * 100 m; ICF y SERNA, en WGS84 / UTM. Los tres llevan la casilla de firma y sello del ingeniero.
 */
function PlanoTramite({ onElegir }: { onElegir: (a: 'INHGEOMIN' | 'ICF' | 'SERNA') => void }) {
  const [abierto, setAbierto] = useState(false);
  const opciones: Array<{ a: 'INHGEOMIN' | 'ICF' | 'SERNA'; datum: string }> = [
    { a: 'INHGEOMIN', datum: 'NAD27 · UTM 16N' },
    { a: 'ICF', datum: 'WGS84 · UTM 16N' },
    { a: 'SERNA', datum: 'WGS84 · UTM 16N' },
  ];
  return (
    <div className="relative">
      <Boton tour="btn-tramite" onClick={() => setAbierto((v) => !v)}>
        Plano para trámite ▾
      </Boton>
      {abierto && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-10 w-[230px] overflow-hidden rounded-lg border border-white/15 bg-[#0A0C0E] shadow-xl" role="menu">
          {opciones.map((o) => (
            <button
              key={o.a}
              type="button"
              role="menuitem"
              onClick={() => {
                setAbierto(false);
                onElegir(o.a);
              }}
              className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-[12.5px] text-[#DCE5EA] hover:bg-white/[0.07] cursor-pointer"
            >
              <span className="font-medium">Para {o.a}</span>
              <span className="font-mono text-[10.5px] text-[#8FA2AC]">{o.datum}</span>
            </button>
          ))}
          <div className="border-t border-white/10 px-3 py-1.5 text-[10.5px] leading-snug text-[#7F939D]">Con casilla de firma y sello del ingeniero.</div>
        </div>
      )}
    </div>
  );
}

function FichaVista({ f, onVolar, onFicha, onPreguntar, invitado }: { f: Ficha; onVolar: Props['onVolar']; onFicha: Props['onFicha']; onPreguntar: Props['onPreguntar']; invitado: boolean }) {
  const [timelapse, setTimelapse] = useState(false);
  return (
    <>
      {timelapse && <Timelapse id={f.id} nombre={f.nombre} resumen={f.satelite?.estado === 'ok' ? f.satelite.renglones.join(' ') : undefined} onCerrar={() => setTimelapse(false)} />}
      <div className="flex flex-wrap gap-1.5">
        {f.geojson && f.encuadre && <Boton onClick={() => onVolar({ accion: 'volar', geojson: f.geojson!, encuadre: f.encuadre! })}>Volar aquí</Boton>}
        <Boton fuerte tour="btn-pdf" onClick={() => onFicha(f.id)}>
          Ficha PDF
        </Boton>
        <PlanoTramite onElegir={(a) => onFicha(f.id, a)} />
        <Boton tour="btn-geologicos" onClick={() => onPreguntar(`Hacé los tres mapas geológicos (litológico, estructural y geotectónico) de la concesión ${f.nombre} (id ${f.id}).`)}>
          Mapas geológicos
        </Boton>
        <Boton tour="btn-analizar" onClick={() => onPreguntar(`Analizá la concesión ${f.nombre} (id ${f.id}): entorno, geología, riesgos legales y ambientales, y qué recomendás.`)}>
          Analizar
        </Boton>
        {f.geojson && (
          <Boton tour="btn-timelapse" onClick={() => setTimelapse(true)}>
            Timelapse satelital
          </Boton>
        )}
      </div>
      {!invitado && <Exportes id={f.id} />}
      <Seccion titulo="Catastro">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {f.datos.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[#7F939D]">{k}</dt>
              <dd className="text-[#E7EEF2] break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </Seccion>
      {f.prospectividad && (
        <Seccion titulo="Prospectividad">
          {f.prospectividad.puntaje != null && (
            <div className="mb-2 flex items-center gap-2" role="img" aria-label={`Prospectividad ${f.prospectividad.puntaje} de 100`}>
              <span className="font-mono text-[20px] font-semibold leading-none" style={{ color: colorProsp(f.prospectividad.puntaje) }}>
                {f.prospectividad.puntaje}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, f.prospectividad.puntaje))}%`, background: colorProsp(f.prospectividad.puntaje) }} />
              </div>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#9FB0B9]">{f.prospectividad.nivel}</span>
            </div>
          )}
          <Renglones p={f.prospectividad} />
        </Seccion>
      )}
      <Seccion titulo="Entorno y alertas">
        <Renglones p={f.entorno} alerta />
      </Seccion>
      <Seccion titulo="Geología">
        <Renglones p={f.geologia} />
      </Seccion>
      {f.satelite && (
        <Seccion titulo="Satélite (Sentinel-2)">
          <Renglones p={f.satelite} />
        </Seccion>
      )}
      <Seccion titulo="Documentos">
        <Renglones p={f.documentos} />
      </Seccion>
    </>
  );
}

function AquiVista({ a, onTocar, onPreguntar }: { a: Aqui; onTocar: Props['onTocar']; onPreguntar: Props['onPreguntar'] }) {
  const coord = `${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}`;
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Boton onClick={() => void navigator.clipboard?.writeText(coord).catch(() => {})}>Copiar coordenadas</Boton>
        <Boton fuerte onClick={() => onPreguntar(`¿Qué hay en el punto ${coord} (latitud, longitud)? Quién lo tiene, qué concesiones hay cerca, geología y entorno.`)}>
          Analizar este punto
        </Boton>
      </div>
      <Seccion titulo="Concesión en este punto">
        {a.concesiones.estado === 'error' ? (
          <p className="text-[#E8A08F]">No pude saber quién lo tiene: {a.concesiones.motivo}.</p>
        ) : a.concesiones.lista.length ? (
          <ul className="space-y-1">
            {a.concesiones.lista.map((c) => (
              <li key={c.id}>
                <button type="button" className="text-left underline decoration-white/25 underline-offset-2 hover:text-white cursor-pointer" onClick={() => onTocar({ tipo: 'concesion', id: c.id, nombre: c.nombre, lngLat: [a.lon, a.lat] })}>
                  {c.nombre}
                </button>
                {c.titular && <span className="text-[#7F939D]"> · {c.titular}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p>Ninguna concesión del catastro cubre este punto.</p>
        )}
      </Seccion>
      {a.cerca.estado === 'error' && (
        <Seccion titulo="Cerca (3 km)">
          <p className="text-[#E8A08F]">No pude revisar las cercanas: {a.cerca.motivo}.</p>
        </Seccion>
      )}
      {a.cerca.estado === 'ok' && a.cerca.lista.length > 0 && (
        <Seccion titulo="Cerca (3 km)">
          <ul className="space-y-1">
            {a.cerca.lista.map((c) => (
              <li key={c.id}>
                <button type="button" className="text-left underline decoration-white/25 underline-offset-2 hover:text-white cursor-pointer" onClick={() => onTocar({ tipo: 'concesion', id: c.id, nombre: c.nombre, lngLat: [a.lon, a.lat] })}>
                  {c.nombre}
                </button>
                <span className="text-[#7F939D]"> · a {c.km < 1 ? `${Math.round(c.km * 1000)} m` : `${c.km.toLocaleString('es-HN', { maximumFractionDigits: 1 })} km`}</span>
              </li>
            ))}
          </ul>
        </Seccion>
      )}
      <Seccion titulo="Geología (3 km alrededor)">
        <Renglones p={a.geologia} />
      </Seccion>
    </>
  );
}

function RasgoVista({ r }: { r: Rasgo }) {
  return (
    <Seccion titulo="Atributos">
      {r.atributos.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {r.atributos.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-[11px] text-[#7F939D]">{k}</dt>
              <dd className="text-[#E7EEF2] break-words">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>La capa no trae atributos para este rasgo.</p>
      )}
    </Seccion>
  );
}

function MuestraVista({ m, onTocar, onPreguntar }: { m: Muestra; onTocar: Props['onTocar']; onPreguntar: Props['onPreguntar'] }) {
  const coord = `${m.lat.toFixed(6)}, ${m.lon.toFixed(6)}`;
  return (
    <>
      <p className="text-[#9FB0BA]">
        {m.tipo}
        {m.lugar ? ` · ${m.lugar}` : ''}
      </p>
      <Seccion titulo="Leyes">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {m.leyes.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-[12px] text-[#7F939D]">{k}</dt>
              <dd className="font-mono text-[13px] text-[#E7EEF2]">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[11px] leading-snug text-[#7F939D]">
          «&lt;» es bajo el límite de detección; «&gt;», sobre el tope del laboratorio.
          {!m.completa && ' De esta muestra solo se leyeron con seguridad el oro y la plata.'} Leído del informe escaneado: si una cifra decide algo, verificala en la tabla original.
        </p>
      </Seccion>
      {m.concesiones.length > 0 && (
        <Seccion titulo="Cae en">
          <ul className="space-y-1">
            {m.concesiones.map((c) => (
              <li key={c.id}>
                <button type="button" className="text-left underline decoration-white/25 underline-offset-2 hover:text-white cursor-pointer" onClick={() => onTocar({ tipo: 'concesion', id: c.id, nombre: c.nombre, lngLat: [m.lon, m.lat] })}>
                  {c.nombre}
                </button>
              </li>
            ))}
          </ul>
        </Seccion>
      )}
      <Seccion titulo="Origen">
        <p>{m.fuente}</p>
        <p className="font-mono text-[11px] text-[#7F939D]">
          UTM {m.utm[0].toLocaleString('es-HN')} E · {m.utm[1].toLocaleString('es-HN')} N ({m.datum}) · {coord}
        </p>
      </Seccion>
      <div className="flex flex-wrap gap-1.5">
        <Boton fuerte onClick={() => onPreguntar(`¿Qué otras muestras de JICA hay cerca de la muestra ${m.codigo} (${coord}) y qué anomalías muestran?`)}>
          Muestras cercanas
        </Boton>
        <Boton onClick={() => onTocar({ tipo: 'punto', lngLat: [m.lon, m.lat] })}>¿Qué hay aquí?</Boton>
      </div>
    </>
  );
}

/** Bajar la concesión para otros programas: Google Earth, SIG, AutoCAD, y los vértices en CSV. */
function Exportes({ id }: { id: number }) {
  const [bajando, setBajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bajar = async (formato: string) => {
    setBajando(formato);
    setError(null);
    try {
      // «dxf-nad27»: el mismo DXF con las coordenadas en NAD27 (el que recibe INHGEOMIN).
      const [f, datum] = formato.split('-');
      const r = await fetch(`/api/electrum/concesion/${id}/exportar?formato=${f}${datum ? `&datum=${datum}` : ''}`, { headers: headersElectrum() });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        return setError(j?.error || (r.status === 404 ? 'Esta función todavía no está activa en el servidor.' : `El servidor contestó ${r.status}.`));
      }
      const nombre = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || `concesion-${id}.${formato}`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setError('No alcancé el servidor.');
    } finally {
      setBajando(null);
    }
  };
  return (
    <div data-tour="exportes">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-[#7F939D]">Bajar</span>
        {[
          ['kml', 'KML · Google Earth'],
          ['dxf', 'DXF · WGS84'],
          ['dxf-nad27', 'DXF · NAD27'],
          ['geojson', 'GeoJSON'],
          ['csv', 'Vértices CSV'],
        ].map(([f, t]) => (
          <button
            key={f}
            type="button"
            disabled={!!bajando}
            onClick={() => void bajar(f)}
            className="rounded-md border border-white/15 px-2 py-1 font-mono text-[10.5px] text-[#DCE5EA] hover:border-white/35 disabled:opacity-50 cursor-pointer"
          >
            {bajando === f ? 'Bajando…' : t}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-[11px] text-[#E8A08F]">{error}</p>}
    </div>
  );
}
