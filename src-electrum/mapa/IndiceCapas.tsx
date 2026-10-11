/**
 * LA PESTAÑA «ÍNDICE DE CAPAS» (Índice Maestro de Capas GIS y KML v1.4, sección 12).
 *
 * Al entrar solo se ve el perímetro de Honduras. El índice se abre con su pestaña, se cierra con la
 * misma pestaña o con «✕», y cerrarlo NO apaga nada. El árbol sale del manifiesto del cubo, con la
 * estructura, el orden y los IDs del documento; los grupos empiezan cerrados y desplegar uno no
 * enciende nada. Cada capa se baja la primera vez que se enciende (con su indicador), se puede
 * filtrar por los campos reales de su tabla, aclarar, acercar, y queda recordada en el navegador.
 * «Limpiar mapa» deja solo el perímetro.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { headersElectrum } from '../acceso';
import { senalConTope } from '../red';
import type { CapaExtra, MuestrasEncendidas, PedidoCapas, RasterEncendido, RasterEscaneado } from './captura';
import type { ElementoMuestra } from './muestras';
import {
  CONFIRMAR_GRUPO,
  arbolDe,
  claseDeFuente,
  colorDe,
  encendible,
  expresionFiltro,
  hayFiltro,
  hojasDe,
  resolverIndice,
  rolDe,
  type EntradaIndice,
  type Nodo,
} from './indice';
import { normalizar } from './categorias';
import { leyendaProsp } from './prospectividad';
import { colorDeValor, cumpleFiltros, leyendaDe, type EntradaCatalogo, type Filtros } from './catalogo';
import { fijarEstadoMapa } from './estado-mapa';

/** Una orden de Dr Electrum para el índice (server/electrum/dialogo-capas.ts → OrdenMapa). */
export type OrdenIndice =
  | { op: 'encender'; id: number; filtros?: Filtros; encuadrar?: boolean }
  | { op: 'filtro'; id: number; filtros: Filtros }
  | { op: 'apagar'; id: number }
  | { op: 'solo'; ids: number[] }
  | { op: 'limpiar' }
  | { op: 'acercar'; id: number; filtros?: Filtros };

/** Las subcarpetas de un proyecto, en este orden. */
const ORDEN_SUBGRUPO = ['KML', 'Shape', 'Datos de campo', 'Imágenes', 'Planos'];

const AMBAR = '#FFAE3B';
const HONDURAS: [number, number, number, number] = [-89.4, 12.9, -83.1, 16.6];
const CAJON = 'electrum:indice:v1';
/** Cuántas capas bajadas se guardan en memoria; las más viejas apagadas se sueltan. */
const EN_MEMORIA = 10;

type Estado = { opacidad: number; filtros: Record<string, string[]> };
type Guardado = Array<{ id: number } & Estado>;

function leerGuardado(): Guardado {
  try {
    const v = JSON.parse(localStorage.getItem(CAJON) || '[]');
    return Array.isArray(v) ? v.filter((x) => Number.isSafeInteger(x?.id)) : [];
  } catch {
    return [];
  }
}
function guardar(on: Map<number, Estado>) {
  try {
    localStorage.setItem(CAJON, JSON.stringify([...on].map(([id, e]) => ({ id, ...e }))));
  } catch {
    /* sin almacenamiento: no se recuerda, y ya */
  }
}

async function json<T>(url: string): Promise<T> {
  // Con tope de espera: un servidor ocupado no puede dejar la casilla «cargando» para siempre.
  const r = await fetch(url, { headers: headersElectrum(), signal: senalConTope(60_000) }).catch((e) => {
    throw new Error(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'El servidor tardó demasiado; pruebe de nuevo en un momento.' : 'No alcancé el servidor.');
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `El servidor contestó ${r.status}.`);
  return j as T;
}

export function IndiceCapas({
  onExtras,
  onRasters,
  onCatastro,
  onMuestras,
  onPerimetro,
  onEncuadrar,
  prospectividad = false,
  onProspectividad,
  pedido = null,
  onRespuesta,
  ordenes = null,
}: {
  onExtras: (xs: CapaExtra[]) => void;
  onRasters: (xs: RasterEncendido[]) => void;
  onCatastro: (c: { visible: boolean; filtro: unknown[] | null }) => void;
  onMuestras: (m: MuestrasEncendidas | null) => void;
  onPerimetro: (fc: unknown) => void;
  onEncuadrar: (caja: [number, number, number, number]) => void;
  prospectividad?: boolean;
  onProspectividad?: (v: boolean) => void;
  pedido?: PedidoCapas | null;
  onRespuesta?: (texto: string, ok: boolean) => void;
  /** Lo que mandó hacer Dr Electrum: se hace con las MISMAS funciones que las casillas. */
  ordenes?: { n: number; lista: OrdenIndice[] } | null;
}) {
  const [abierto, setAbierto] = useState(false);
  // La cara de Dr Electrum vive en la misma esquina: se aparta mientras el índice está abierto.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('electrum:indice-abierto', { detail: abierto }));
  }, [abierto]);
  const [capas, setCapas] = useState<EntradaIndice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rastersIdx, setRastersIdx] = useState<RasterEscaneado[]>([]);
  const [on, setOn] = useState<Map<number, Estado>>(new Map());
  const [cargando, setCargando] = useState<Set<number>>(new Set());
  const [fallos, setFallos] = useState<Map<number, string>>(new Map());
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [filtroAbierto, setFiltroAbierto] = useState<number | null>(null);
  const [busca, setBusca] = useState('');
  const [zoom, setZoom] = useState(7);
  const [version, setVersion] = useState(0);
  /** Lo bajado, por ID, en orden de uso (para soltar lo más viejo). */
  const datos = useRef(new Map<number, unknown>());
  const muestrasDatos = useRef<MuestrasEncendidas['geojson'] | null>(null);

  /* ---------------------------------------------------------------- al montar: índice, teselas, perímetro */

  /** El índice en sí; se puede volver a pedir con «Reintentar» si falló (antes había que recargar la página). */
  const cargarIndice = useCallback(() => {
    setError(null);
    json<{ capas: EntradaIndice[] }>('/api/electrum/mapa/indice')
      .then((j) => setCapas(j.capas || []))
      .catch((e) => setError(`No pude cargar el índice de capas. ${String(e?.message || e)}`));
  }, []);
  useEffect(() => {
    cargarIndice();
    json<{ rasters: RasterEscaneado[] }>('/api/electrum/mapa/rasters')
      .then((j) => setRastersIdx(j.rasters || []))
      .catch(() => setRastersIdx([]));
    json<{ geojson: unknown }>('/api/electrum/mapa/perimetro')
      .then((j) => onPerimetro(j.geojson))
      .catch(() => onPerimetro(null));
    const z = (e: Event) => setZoom(Number((e as CustomEvent<number>).detail) || 7);
    window.addEventListener('electrum:zoom', z);
    return () => window.removeEventListener('electrum:zoom', z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const porId = useMemo(() => new Map((capas || []).map((c) => [c.id, c])), [capas]);
  const arbol = useMemo(() => arbolDe(capas || []), [capas]);

  /* ---------------------------------------------------------------- bajar */

  const bajar = useCallback(
    async (e: EntradaIndice): Promise<boolean> => {
      const clase = claseDeFuente(e);
      if (clase === 'muestras') {
        if (muestrasDatos.current) return true;
      } else if (clase !== 'base' || datos.current.has(e.id)) {
        if (datos.current.has(e.id)) {
          // Usada otra vez: pasa al final de la cola.
          const v = datos.current.get(e.id);
          datos.current.delete(e.id);
          datos.current.set(e.id, v);
        }
        return true;
      }
      setCargando((s) => new Set(s).add(e.id));
      try {
        if (clase === 'muestras') {
          const j = await json<{ features?: unknown[] }>('/api/electrum/mapa/muestras');
          muestrasDatos.current = j;
        } else {
          const j = await json<{ geojson: unknown }>(`/api/electrum/mapa/indice/capa/${e.id}`);
          datos.current.set(e.id, j.geojson);
        }
        setFallos((m) => {
          const n = new Map(m);
          n.delete(e.id);
          return n;
        });
        return true;
      } catch (err: any) {
        setFallos((m) => new Map(m).set(e.id, String(err?.message || err)));
        return false;
      } finally {
        setCargando((s) => {
          const n = new Set(s);
          n.delete(e.id);
          return n;
        });
        setVersion((v) => v + 1);
      }
    },
    []
  );

  const encender = useCallback(
    async (ids: number[], estado?: Partial<Estado>, encuadrar = false) => {
      const xs = ids.map((i) => porId.get(i)).filter((x): x is EntradaIndice => !!x && encendible(x));
      if (!xs.length) return;
      setOn((m) => {
        const n = new Map(m);
        for (const x of xs) if (!n.has(x.id)) n.set(x.id, { opacidad: estado?.opacidad ?? 0.85, filtros: estado?.filtros ?? {} });
        return n;
      });
      // De a cuatro, para no ahogar ni al teléfono ni al servidor.
      const cola = [...xs];
      await Promise.all(
        Array.from({ length: Math.min(4, cola.length) }, async () => {
          while (cola.length) {
            const x = cola.shift()!;
            const ok = await bajar(x);
            if (!ok) setOn((m) => {
              const n = new Map(m);
              n.delete(x.id);
              return n;
            });
          }
        })
      );
      if (encuadrar && xs.length === 1 && xs[0].caja) onEncuadrar(xs[0].caja);
    },
    [porId, bajar, onEncuadrar]
  );

  const apagar = useCallback((ids: number[]) => {
    setOn((m) => {
      const n = new Map(m);
      ids.forEach((i) => n.delete(i));
      return n;
    });
  }, []);

  // Lo que se recordaba de la última vez, cuando ya llegó el índice.
  const restaurado = useRef(false);
  useEffect(() => {
    if (!capas || restaurado.current) return;
    restaurado.current = true;
    for (const g of leerGuardado()) void encender([g.id], { opacidad: g.opacidad, filtros: g.filtros });
  }, [capas, encender]);

  useEffect(() => {
    if (restaurado.current) guardar(on);
  }, [on]);

  // Más de diez capas en memoria: se sueltan las más viejas que no estén encendidas.
  useEffect(() => {
    for (const id of [...datos.current.keys()]) {
      if (datos.current.size <= EN_MEMORIA) break;
      if (!on.has(id)) datos.current.delete(id);
    }
  }, [on, version]);

  /* ---------------------------------------------------------------- al mapa */

  useEffect(() => {
    if (!capas) return;
    const extras: CapaExtra[] = [];
    const rasters = new Map<string, RasterEncendido>();
    let catastro = { visible: false, filtro: null as unknown[] | null };
    let muestras: MuestrasEncendidas | null = null;
    for (const [id, est] of on) {
      const e = porId.get(id);
      if (!e) continue;
      const clase = claseDeFuente(e);
      if (clase === 'base' && datos.current.has(id)) {
        extras.push({ id, nombre: e.nombre, rol: rolDe(e) as any, geojson: datos.current.get(id) as any, opacidad: est.opacidad, filtro: expresionFiltro(est.filtros), color: colorDe(e), estilo: e.estilo?.tipo ?? null });
      } else if (clase === 'tesela') {
        for (const f of e.fuentes || []) {
          const r = f.tesela ? rastersIdx.find((x) => x.clave === f.tesela) : null;
          if (r) rasters.set(r.clave, { ...r, opacidad: est.opacidad });
        }
      } else if (clase === 'catastro') {
        catastro = { visible: true, filtro: expresionFiltro(est.filtros) };
      } else if (clase === 'muestras' && muestrasDatos.current) {
        muestras = { elemento: ((est.filtros.elemento || [])[0] || 'au') as ElementoMuestra, geojson: muestrasDatos.current };
      }
    }
    onExtras(extras);
    onRasters([...rasters.values()]);
    onCatastro(catastro);
    onMuestras(muestras);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, version, capas, rastersIdx]);

  /* ---------------------------------------------------------------- Dr Electrum */

  // Lo encendido, para que Electrum lo sepa en la pregunta siguiente (de lo más viejo a lo más nuevo).
  useEffect(() => {
    fijarEstadoMapa({ capas: [...on].map(([id, e]) => ({ id, filtros: e.filtros })) });
  }, [on]);

  const filtrar = useCallback((id: number, filtros: Filtros) => {
    setOn((m) => {
      const n = new Map<number, Estado>(m);
      const base: Estado = n.get(id) || { opacidad: 0.85, filtros: {} };
      n.set(id, { ...base, filtros });
      return n;
    });
  }, []);

  /** Encuadra una capa, o solo sus rasgos filtrados si ya están bajados. */
  const acercar = useCallback(
    (id: number, filtros?: Filtros) => {
      const e = porId.get(id);
      const fc = datos.current.get(id) as { features?: Array<{ geometry: any; properties: Record<string, unknown> }> } | undefined;
      if (fc?.features?.length) {
        let caja: [number, number, number, number] | null = null;
        const sumar = (c: any): void => {
          if (typeof c?.[0] === 'number') {
            caja = caja ? [Math.min(caja[0], c[0]), Math.min(caja[1], c[1]), Math.max(caja[2], c[0]), Math.max(caja[3], c[1])] : [c[0], c[1], c[0], c[1]];
          } else if (Array.isArray(c)) c.forEach(sumar);
        };
        for (const f of fc.features) if (cumpleFiltros((k) => f.properties?.[k], filtros)) sumar(f.geometry?.coordinates);
        if (caja) return onEncuadrar(caja);
      }
      if (e?.caja) onEncuadrar(e.caja);
    },
    [porId, onEncuadrar]
  );

  const hechas = useRef(0);
  useEffect(() => {
    if (!ordenes || ordenes.n === hechas.current || !capas) return;
    hechas.current = ordenes.n;
    for (const o of ordenes.lista) {
      if (o.op === 'limpiar') {
        setOn(new Map());
        setFiltroAbierto(null);
      } else if (o.op === 'solo') apagar([...on.keys()].filter((i) => !o.ids.includes(i)));
      else if (o.op === 'apagar') apagar([o.id]);
      else if (o.op === 'filtro') {
        if (!on.has(o.id)) void encender([o.id], { filtros: o.filtros });
        else filtrar(o.id, o.filtros);
      } else if (o.op === 'encender') {
        if (on.has(o.id)) filtrar(o.id, o.filtros || {});
        else void encender([o.id], { filtros: o.filtros || {} }).then(() => o.encuadrar && acercar(o.id, o.filtros));
      } else if (o.op === 'acercar') {
        if (!on.has(o.id)) void encender([o.id], { filtros: o.filtros || {} }).then(() => acercar(o.id, o.filtros));
        else acercar(o.id, o.filtros);
      }
    }
  }, [ordenes, capas, on, encender, apagar, filtrar, acercar]);

  /* ---------------------------------------------------------------- de palabra */

  const atendido = useRef(0);
  useEffect(() => {
    if (!pedido || pedido.n === atendido.current || !capas) return;
    atendido.current = pedido.n;
    const r = resolverIndice(pedido.que, arbol);
    if (r.varias?.length) return void onRespuesta?.(`«${pedido.que}» puede ser ${r.varias.join(' o ')}. ¿Cuál?`, false);
    if (!r.ids.length) return void onRespuesta?.(`No encontré «${pedido.que}» en el índice de capas.`, false);
    if (pedido.mostrar && r.todo) return void onRespuesta?.('Son demasiadas para encenderlas todas juntas. Pídame una categoría: la geología, los ríos, el catastro…', false);
    if (pedido.solo) apagar([...on.keys()].filter((i) => !r.ids.includes(i)));
    if (pedido.mostrar) void encender(r.ids, undefined, r.ids.length === 1);
    else apagar(r.ids);
    onRespuesta?.(`${pedido.mostrar ? 'Encendí' : 'Apagué'} ${r.nombre}.`, true);
  }, [pedido, capas, arbol, on, encender, apagar, onRespuesta]);

  /* ---------------------------------------------------------------- planos */

  const abrirPlano = useCallback(async (e: EntradaIndice) => {
    if (!e.ruta_web) return;
    setCargando((s) => new Set(s).add(e.id));
    try {
      const r = await fetch(e.ruta_web, { headers: headersElectrum() });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || `El servidor contestó ${r.status}.`);
      }
      const b = await r.blob();
      const url = URL.createObjectURL(b);
      const pdf = /pdf/.test(b.type);
      window.dispatchEvent(new CustomEvent('electrum:visor', { detail: { tipo: pdf ? 'pdf' : 'imagen', nombre: e.nombre, url, titulo: `${String(e.id).padStart(6, '0')} · ${e.nombre}` } }));
      // El visor lo lee enseguida y se queda con su propia copia: esta se suelta (si no, cada plano
      // abierto quedaba en memoria hasta cerrar la página).
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      setFallos((m) => new Map(m).set(e.id, String(err?.message || err)));
    } finally {
      setCargando((s) => {
        const n = new Set(s);
        n.delete(e.id);
        return n;
      });
    }
  }, []);

  /* ---------------------------------------------------------------- dibujo */

  const q = normalizar(busca);
  const casa = (n: Nodo): boolean => !q || normalizar(n.nombre).includes(q) || String(n.id).padStart(6, '0').includes(q) || n.hijos.some(casa);
  const desplegar = (id: number) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const minzoomDe = (e: EntradaIndice) => {
    const t = (e.fuentes || []).find((f) => f.tesela)?.tesela;
    const r = t ? rastersIdx.find((x) => x.clave === t) : null;
    return r?.vector?.desde ?? (t === 'referencia-rios-hn' ? 7 : 0);
  };

  const fila = (n: Nodo, nivel: number): ReactElement | null => {
    if (!casa(n)) return null;
    const id6 = String(n.id).padStart(6, '0');
    if (n.tipo === 'grupo') {
      const hojas = hojasDe(n).filter(encendible);
      const prendidas = hojas.filter((h) => on.has(h.id)).length;
      const ab = abiertos.has(n.id) || !!q;
      const vacio = !hojas.length && !n.hijos.length;
      return (
        <li key={n.id}>
          <div className="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-white/[0.05]" style={{ paddingLeft: 4 + nivel * 12 }}>
            <input
              type="checkbox"
              aria-label={`Todo el grupo ${n.nombre}`}
              disabled={!hojas.length}
              checked={prendidas > 0 && prendidas === hojas.length}
              ref={(el) => {
                if (el) el.indeterminate = prendidas > 0 && prendidas < hojas.length;
              }}
              onChange={() => {
                if (prendidas) return apagar(hojas.map((h) => h.id));
                if (hojas.length > CONFIRMAR_GRUPO && !window.confirm(`«${n.nombre}» tiene ${hojas.length} capas. ¿Encenderlas todas?`)) return;
                void encender(hojas.map((h) => h.id));
              }}
              className="mt-[3px] accent-[#FFAE3B]"
            />
            <button type="button" onClick={() => desplegar(n.id)} aria-expanded={ab} className="flex min-w-0 flex-1 items-start justify-between gap-2 text-left cursor-pointer">
              <span className="min-w-0">
                <span className={`block leading-snug ${nivel === 0 ? 'font-semibold text-[#F1F5F7]' : 'text-[#E7EEF2]'} ${vacio ? 'opacity-50' : ''}`}>{n.nombre}</span>
                <span className="block font-mono text-[9.5px] text-[#7F939D]">{id6}{vacio ? ' · sin capas' : ''}</span>
              </span>
              <span className="mt-[2px] shrink-0 font-mono text-[10px] text-[#7F939D]">
                {prendidas ? <span style={{ color: AMBAR }}>{prendidas}/</span> : null}
                {hojas.length} {ab ? '▾' : '▸'}
              </span>
            </button>
          </div>
          {ab && <ul>{conSubgrupos(n.hijos).map((h) => ('titulo' in h ? <li key={`${n.id}-${h.titulo}`} className="mt-1 px-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[#7F939D]" style={{ paddingLeft: 8 + (nivel + 1) * 12 }}>{h.titulo}</li> : fila(h, nivel + 1)))}</ul>}
        </li>
      );
    }
    const est = on.get(n.id);
    const carga = cargando.has(n.id);
    const falla = fallos.get(n.id);
    const puede = encendible(n);
    const doc = n.tipo === 'documento';
    const mz = minzoomDe(n);
    return (
      <li key={n.id}>
        <div className="flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-white/[0.05]" style={{ paddingLeft: 4 + nivel * 12 }}>
          {doc ? (
            <span className="mt-[2px] w-[13px] shrink-0 text-center text-[11px] text-[#9FB0B8]" aria-hidden>
              ▤
            </span>
          ) : (
            <input
              type="checkbox"
              aria-label={`Encender ${n.nombre}`}
              disabled={!puede || carga}
              checked={!!est}
              onChange={() => (est ? apagar([n.id]) : void encender([n.id], undefined, claseDeFuente(n) === 'tesela'))}
              className="mt-[3px] accent-[#FFAE3B]"
            />
          )}
          {!doc && <Muestra e={n} activa={puede} />}
          <span className="min-w-0 flex-1">
            {doc ? (
              <button type="button" onClick={() => void abrirPlano(n)} disabled={!n.ruta_web} className="block text-left leading-snug text-[#CFE2EA] underline decoration-white/20 underline-offset-2 hover:text-white cursor-pointer disabled:opacity-40">
                {n.nombre}
              </button>
            ) : (
              <span className={`block leading-snug ${puede ? 'text-[#E7EEF2]' : 'text-[#5C6A71]'}`} title={n.notas || ''}>
                {n.nombre}
              </span>
            )}
            <span className="block font-mono text-[9.5px] text-[#7F939D]">
              {String(n.id).padStart(6, '0')}
              {carga ? ' · cargando…' : ''}
              {!puede && !doc ? (n.sin_datos || !n.fuentes?.length ? ' · Sin datos' : ' · no disponible') : ''}
              {n.num_entidades ? ` · ${n.num_entidades.toLocaleString('es-HN')} rasgos` : ''}
              {est && hayFiltro(est.filtros) ? <span style={{ color: AMBAR }}> · filtrado</span> : null}
            </span>
            {falla && <span className="block text-[10.5px] text-[#E8A08F]">{falla}</span>}
            {est && mz > zoom && <span className="block text-[10.5px] text-[#E8C38F]">Acérquese para ver esta capa.</span>}
          </span>
          {!!n.filtros?.length && puede && (
            <button
              type="button"
              onClick={() => setFiltroAbierto((x) => (x === n.id ? null : n.id))}
              aria-expanded={filtroAbierto === n.id}
              title="Filtrar"
              className={`mt-[1px] shrink-0 rounded px-1 font-mono text-[10px] cursor-pointer ${est && hayFiltro(est.filtros) ? 'text-[#FFAE3B]' : 'text-[#9FB0B8] hover:text-white'}`}
            >
              ⚙ Filtrar
            </button>
          )}
        </div>
        {filtroAbierto === n.id && !!n.filtros?.length && (
          <div className="mb-1 ml-7 mr-1 rounded-md border border-white/10 bg-black/40 p-2" style={{ marginLeft: 28 + nivel * 12 }}>
            {n.filtros.map((f) => {
              const marcados = est?.filtros[f.campo] || [];
              const cambiar = (v: string) => {
                const nuevos = marcados.includes(v) ? marcados.filter((x) => x !== v) : [...marcados, v];
                setOn((m) => {
                  const nm = new Map<number, Estado>(m);
                  const base: Estado = nm.get(n.id) || { opacidad: 0.85, filtros: {} };
                  nm.set(n.id, { ...base, filtros: { ...base.filtros, [f.campo]: f.campo === 'elemento' ? nuevos.slice(-1) : nuevos } });
                  return nm;
                });
                if (!est) void encender([n.id]);
              };
              return (
                <div key={f.campo} className="mb-1.5">
                  <div className="mb-0.5 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#9FB0B8]">{f.etiqueta || f.campo}</span>
                    {!!marcados.length && (
                      <button
                        type="button"
                        onClick={() =>
                          setOn((m) => {
                            const nm = new Map<number, Estado>(m);
                            const base: Estado = m.get(n.id) || { opacidad: 0.85, filtros: {} };
                            nm.set(n.id, { ...base, filtros: { ...base.filtros, [f.campo]: [] } });
                            return nm;
                          })
                        }
                        className="font-mono text-[10px] text-[#B9C7CE] hover:text-white cursor-pointer"
                      >
                        todos
                      </button>
                    )}
                  </div>
                  <div className="flex max-h-[140px] flex-wrap gap-1 overflow-y-auto">
                    {f.valores.map((v) => {
                      // Junto a cada valor, su color en el mapa (correcciones v1.0, 2.3).
                      const col = colorDeValor(n as EntradaCatalogo, f.campo, v);
                      const etq = n.estilo?.campo === f.campo ? n.estilo.categorias?.find((c) => c.valor === v)?.etiqueta : undefined;
                      return (
                        <label key={v} className={`flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${marcados.includes(v) ? 'border-[#FFAE3B]/70 bg-[#FFAE3B]/15 text-[#FFE2B8]' : 'border-white/12 text-[#C9D5DB] hover:border-white/30'}`}>
                          <input type="checkbox" className="sr-only" checked={marcados.includes(v)} onChange={() => cambiar(v)} />
                          {col && <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/40" style={{ background: col }} aria-hidden />}
                          {etq || v}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <p className="text-[10.5px] text-[#7F939D]">Sin nada marcado se ve todo.</p>
          </div>
        )}
        {est && (
          <div className="flex items-center gap-2 pb-1 pr-1" style={{ paddingLeft: 28 + nivel * 12 }}>
            <span className="font-mono text-[9.5px] text-[#7F939D]">transparencia</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(est.opacidad * 100)}
              aria-label={`Transparencia de ${n.nombre}`}
              onChange={(ev) => {
                const v = Number(ev.target.value) / 100;
                setOn((m) => new Map(m).set(n.id, { ...est, opacidad: v }));
              }}
              className="h-1 flex-1 accent-[#FFAE3B]"
            />
            {n.caja && (
              <button type="button" onClick={() => onEncuadrar(n.caja!)} className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[#B9C7CE] hover:text-white cursor-pointer">
                Acercar
              </button>
            )}
          </div>
        )}
        {est && n.id === 104001 && onProspectividad && (
          <label className="flex cursor-pointer items-center gap-2 pb-1 text-[11px] text-[#C9D5DB]" style={{ paddingLeft: 28 + nivel * 12 }}>
            <input type="checkbox" checked={prospectividad} onChange={() => onProspectividad(!prospectividad)} className="accent-[#FFAE3B]" />
            Colorear por prospectividad
            {prospectividad && (
              <span className="flex gap-1">
                {leyendaProsp().map((l) => (
                  <span key={l.texto} className="h-2 w-3 rounded-sm" title={l.texto} style={{ background: l.color }} />
                ))}
              </span>
            )}
          </label>
        )}
      </li>
    );
  };

  const encendidas = [...on.keys()].map((i) => porId.get(i)).filter((x): x is EntradaIndice => !!x);

  return (
    <>
      {/* La pestaña, siempre a la vista en el costado izquierdo del mapa. */}
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        data-tour="capas"
        aria-expanded={abierto}
        className="absolute left-3 bottom-3 z-20 flex items-center gap-2 rounded-full border border-white/15 bg-black/80 px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase text-[#DCE5EA] shadow-lg backdrop-blur-md hover:border-white/30 cursor-pointer"
      >
        <span aria-hidden>▤</span> Índice de capas{encendidas.length ? ` · ${encendidas.length}` : ''}
      </button>

      {/* La leyenda: solo de lo encendido, y solo con el índice cerrado. */}
      {!abierto && encendidas.length > 0 && (
        <div className="pointer-events-none absolute left-3 bottom-12 z-10 max-h-[45vh] max-w-[280px] overflow-hidden rounded-lg border border-white/10 bg-black/70 px-2.5 py-1.5 text-[10.5px] text-[#DCE5EA] backdrop-blur-md">
          {encendidas.slice(-6).reverse().map((e) => {
            const ley = leyendaDe(e as EntradaCatalogo, on.get(e.id)?.filtros);
            return (
              <div key={e.id} className="mb-0.5">
                <div className="flex items-center gap-1.5 truncate">
                  {ley.length <= 1 && <span className="h-2 w-2.5 shrink-0 rounded-sm" style={{ background: ley[0]?.color || colorDe(e) }} />}
                  <span className="truncate font-medium">{e.nombre}</span>
                  {hayFiltro(on.get(e.id)?.filtros) && <span style={{ color: AMBAR }}>·filtro</span>}
                </div>
                {ley.length > 1 && (
                  <div className="ml-1 flex flex-wrap gap-x-2">
                    {ley.slice(0, 12).map((l) => (
                      <span key={l.texto + l.color} className="flex items-center gap-1 truncate text-[10px] text-[#C9D5DB]">
                        <span className="h-2 w-2 shrink-0 rounded-sm border border-black/40" style={{ background: l.color }} />
                        {l.texto}
                      </span>
                    ))}
                    {ley.length > 12 && <span className="text-[10px] text-[#7F939D]">+{ley.length - 12}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {abierto && (
        <aside
          className="absolute inset-x-2 bottom-12 top-2 z-30 flex flex-col overflow-hidden rounded-xl border border-white/12 bg-[#0A0C0E]/95 text-[12.5px] text-[#C9D5DB] shadow-[0_10px_30px_rgba(0,0,0,.55)] backdrop-blur-xl md:inset-x-auto md:left-3 md:w-[360px]"
          aria-label="Índice de capas"
        >
          <header className="flex items-center justify-between gap-2 border-b border-white/[0.08] px-3 py-2">
            <span className="font-mono text-[11px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
              Índice de capas
            </span>
            <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar el índice" className="rounded px-2 text-[15px] text-[#B9C7CE] hover:text-white cursor-pointer">
              ✕
            </button>
          </header>
          <div className="flex gap-1.5 border-b border-white/[0.08] px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setAbierto(false);
                onEncuadrar(HONDURAS);
              }}
              className="flex-1 rounded-md border border-white/12 px-2 py-1 text-[11px] text-[#DCE5EA] hover:border-white/30 cursor-pointer"
            >
              Ver mapa principal
            </button>
            <button
              type="button"
              onClick={() => {
                setOn(new Map());
                setFiltroAbierto(null);
              }}
              className="flex-1 rounded-md border border-white/12 px-2 py-1 text-[11px] text-[#DCE5EA] hover:border-white/30 cursor-pointer"
            >
              Limpiar mapa
            </button>
          </div>
          <div className="px-3 pt-2">
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nombre o ID…"
              aria-label="Buscar capa por nombre o ID"
              className="w-full rounded-md border border-white/12 bg-black/50 px-2 py-1.5 text-[12px] text-[#E7EEF2] placeholder:text-[#7F939D] outline-none focus:border-white/30"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {error && (
              <div className="mx-1 rounded-lg border border-[#E8A08F]/30 bg-[#E8A08F]/[0.06] px-2.5 py-2">
                <p className="text-[#E8A08F]">{error}</p>
                <button type="button" onClick={cargarIndice} className="mt-1.5 rounded-md border border-white/15 px-2.5 py-1 text-[11.5px] text-[#DCE5EA] hover:border-white/35 cursor-pointer">
                  Reintentar
                </button>
              </div>
            )}
            {!capas && !error && <p className="px-1 text-[#8FA3B0]">Cargando el índice…</p>}
            <ul>{arbol.map((n) => fila(n, 0))}</ul>
            {capas && q && !arbol.some(casa) && (
              <div className="px-1 py-3 text-[#8FA3B0]">
                <p>Ninguna capa coincide con «{busca}».</p>
                <button type="button" onClick={() => setBusca('')} className="mt-1.5 rounded-md border border-white/15 px-2.5 py-1 text-[11.5px] text-[#DCE5EA] hover:border-white/35 cursor-pointer">
                  Limpiar búsqueda
                </button>
              </div>
            )}
          </div>
          <footer className="border-t border-white/[0.08] px-3 py-1.5 text-[10.5px] leading-snug text-[#8FA3B0]">
            Nada se baja hasta que lo enciende. También de palabra: «muéstrame los ríos», «esconde la geología», «deja solo el catastro».
          </footer>
        </aside>
      )}
    </>
  );
}

/** Los hijos de un grupo con sus subcarpetas («KML», «Shape», «Planos») intercaladas como títulos. */
function conSubgrupos(hijos: Nodo[]): Array<Nodo | { titulo: string }> {
  if (!hijos.some((h) => h.subgrupo)) return hijos;
  const rango = (h: Nodo) => {
    const i = ORDEN_SUBGRUPO.indexOf(h.subgrupo || '');
    return i < 0 ? ORDEN_SUBGRUPO.length : i;
  };
  const xs = [...hijos].sort((a, b) => rango(a) - rango(b) || a.orden - b.orden || a.id - b.id);
  const out: Array<Nodo | { titulo: string }> = [];
  let antes: string | undefined;
  for (const h of xs) {
    if (h.subgrupo && h.subgrupo !== antes) out.push({ titulo: h.subgrupo });
    antes = h.subgrupo;
    out.push(h);
  }
  return out;
}

/** El cuadrito de color de una capa: varios colores si se pinta por categorías; gris si no tiene datos. */
function Muestra({ e, activa }: { e: EntradaIndice; activa: boolean }) {
  if (!activa) return <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-sm bg-[#3A4248]" />;
  const cols = [...new Set((e.estilo?.categorias || []).map((c) => c.color))].slice(0, 4);
  if (cols.length < 2) return <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorDe(e) }} />;
  return (
    <span className="mt-[5px] grid h-2.5 w-2.5 shrink-0 grid-cols-2 overflow-hidden rounded-sm" aria-hidden>
      {cols.concat(cols).slice(0, 4).map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}
