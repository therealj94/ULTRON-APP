/**
 * ENCENDER CAPAS ENCIMA DEL CATASTRO, POR CATEGORÍAS.
 *
 * La geología, las fallas, los yacimientos, las áreas protegidas, los ríos, las hojas
 * cartográficas… Todo está cargado, pero no todo se enciende: al abrir el mapa solo se ve el
 * catastro sobre el mapa político de Honduras (departamentos y municipios). Lo demás se pide por
 * categoría —una casilla enciende o apaga la categoría entera— o capa por capa, tocando o
 * diciéndolo («muéstrame los ríos», «esconde la geología», «deja solo el mapa político»).
 *
 * La lista la da el servidor (solo las capas que un teléfono aguanta pintar) y el índice de
 * teselas; cada capa se baja la primera vez que se enciende y queda guardada mientras la pantalla
 * siga abierta.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { headersElectrum } from '../acceso';
import type { CapaExtra, RasterEncendido, RasterEscaneado, RolVisible } from './captura';
import { COLOR_ROCA, ESTILO_ROL, GRUPOS_ESTADO, NOMBRE_ROCA } from './capas';
import { CATEGORIAS, POR_DEFECTO, categoriaDeItem, claveItem, nombreDePedido, resolverPedido, type ClaveCategoria, type ItemCapa } from './categorias';
import { leyendaProsp } from './prospectividad';
import { ELEMENTOS_MUESTRA, NOMBRE_ELEMENTO, leyendaMuestras, type ElementoMuestra } from './muestras';

export type MuestrasEncendidas = { elemento: ElementoMuestra; geojson: { features?: unknown[] } };

/** Lo que alguien pidió de palabra (o Dr Electrum con su herramienta). `n` distingue un pedido del siguiente. */
export type PedidoCapas = { mostrar: boolean; que: string; solo?: boolean; n: number };

const AMBAR = '#FFAE3B';
type Disponible = { id: number; nombre: string; rol: RolVisible; entidades: number };
/** Cuántas capas se bajan a la vez al encender una categoría entera. */
const A_LA_VEZ = 4;

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
  curvas = false,
  onCurvas,
  prospectividad = false,
  onProspectividad,
  pedido = null,
  onRespuesta,
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
  /** Curvas de nivel y sombreado del terreno. */
  curvas?: boolean;
  onCurvas?: (v: boolean) => void;
  /** Colorear las concesiones por puntaje de prospectividad (geología + muestras + satélite). */
  prospectividad?: boolean;
  onProspectividad?: (v: boolean) => void;
  /** Encender o apagar por nombre o categoría, dicho de palabra. */
  pedido?: PedidoCapas | null;
  /** Qué pasó con el pedido, para decirlo o mostrarlo. */
  onRespuesta?: (texto: string, ok: boolean) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Disponible[] | null>(null);
  const [escaneados, setEscaneados] = useState<RasterEscaneado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Las capas que se están bajando (por `claveItem`). */
  const [bajando, setBajando] = useState<Set<string>>(new Set());
  const [desplegadas, setDesplegadas] = useState<Set<string>>(new Set());
  const guardadas = useRef(new Map<number, CapaExtra>());
  /** Los puntos, bajados la primera vez que se encienden y guardados mientras siga la pantalla. */
  const puntos = useRef<MuestrasEncendidas['geojson'] | null>(null);
  const [errorMuestras, setErrorMuestras] = useState<string | null>(null);
  const [bajandoMuestras, setBajandoMuestras] = useState(false);
  const [elemento, setElemento] = useState<ElementoMuestra>('au');

  /* ---------------------------------------------------------------- el catálogo */

  /*
   * Se pide al montar, no al abrir la caja: el mapa político se enciende solo, y lo que se pide de
   * palabra tiene que encontrar la capa aunque la caja nunca se haya abierto. Los mapas escaneados
   * son un extra: si su índice falla, la lista de capas sigue sirviendo y el índice se vuelve a
   * pedir la próxima vez que se abra la caja.
   */
  const pedirRasters = useCallback(() => {
    fetch('/api/electrum/mapa/rasters', { headers: headersElectrum() })
      .then((rr) => (rr.ok ? rr.json() : null))
      .then((jr) => setEscaneados(Array.isArray(jr?.rasters) ? jr.rasters : []))
      .catch(() => setEscaneados((antes) => antes ?? []));
  }, []);
  const pedirLista = useCallback(async () => {
    try {
      const r = await fetch('/api/electrum/mapa/capas', { headers: headersElectrum() });
      const j = await r.json().catch(() => null);
      if (!r.ok) return setError(j?.error || `El servidor contestó ${r.status}.`);
      setError(null);
      setLista(j.capas || []);
    } catch {
      setError('No alcancé el servidor.');
    }
  }, []);
  useEffect(() => {
    void pedirLista();
    pedirRasters();
  }, [pedirLista, pedirRasters]);

  const abrir = useCallback(() => {
    setAbierto((a) => !a);
    if (!escaneados?.length) pedirRasters();
    if (!lista) void pedirLista();
  }, [lista, escaneados, pedirLista, pedirRasters]);

  const items = useMemo<ItemCapa[]>(
    () => [
      ...(lista || []).map((c) => ({ tipo: 'capa' as const, id: c.id, nombre: c.nombre, rol: c.rol })),
      ...(escaneados || []).map((x) => ({ tipo: 'raster' as const, clave: x.clave, nombre: x.nombre, grupo: x.grupo })),
      ...(onMuestras ? [{ tipo: 'muestras' as const }] : []),
      ...(onCurvas ? [{ tipo: 'curvas' as const }] : []),
    ],
    [lista, escaneados, onMuestras, onCurvas]
  );
  const porId = useMemo(() => new Map((lista || []).map((c) => [c.id, c])), [lista]);
  const rasterPorClave = useMemo(() => new Map((escaneados || []).map((x) => [x.clave, x])), [escaneados]);

  const encendido = useCallback(
    (i: ItemCapa): boolean => {
      if (i.tipo === 'capa') return encendidas.some((x) => x.id === i.id);
      if (i.tipo === 'raster') return rasters.some((r) => r.clave === i.clave);
      if (i.tipo === 'muestras') return !!muestras;
      return curvas;
    },
    [encendidas, rasters, muestras, curvas]
  );

  /* ---------------------------------------------------------------- encender y apagar */

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

  /** Una capa de la base, bajada una vez y guardada. Null si no se pudo. */
  const bajarCapa = useCallback(async (c: Disponible): Promise<CapaExtra | null> => {
    const ya = guardadas.current.get(c.id);
    if (ya) return ya;
    const k = `capa:${c.id}`;
    setBajando((b) => new Set(b).add(k));
    try {
      const r = await fetch(`/api/electrum/mapa/capa/${c.id}`, { headers: headersElectrum() });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.geojson) {
        setError(j?.error || `No pude bajar ${c.nombre}.`);
        return null;
      }
      const capa: CapaExtra = { id: c.id, nombre: c.nombre, rol: c.rol, geojson: j.geojson };
      guardadas.current.set(c.id, capa);
      return capa;
    } catch {
      setError(`No pude bajar ${c.nombre}: revisá la conexión.`);
      return null;
    } finally {
      setBajando((b) => {
        const n = new Set(b);
        n.delete(k);
        return n;
      });
    }
  }, []);

  const poner = useCallback(
    async (i: ItemCapa, mostrar: boolean, encuadrar = false) => {
      if (i.tipo === 'capa') {
        if (!mostrar) return onCambio((antes) => antes.filter((x) => x.id !== i.id));
        const c = porId.get(i.id);
        const capa = c ? await bajarCapa(c) : null;
        if (capa) onCambio((antes) => (antes.some((x) => x.id === capa.id) ? antes : [...antes, capa]));
        return;
      }
      if (i.tipo === 'raster') {
        if (!onRasters) return;
        if (!mostrar) return onRasters((antes) => antes.filter((r) => r.clave !== i.clave));
        const x = rasterPorClave.get(i.clave);
        if (!x) return;
        onRasters((antes) => (antes.some((r) => r.clave === x.clave) ? antes : [...antes, { ...x, opacidad: 0.75 }]));
        if (encuadrar) onEncuadrar?.(x.encuadre);
        return;
      }
      if (i.tipo === 'muestras') {
        if (!mostrar) return onMuestras?.(null);
        if (!muestras) await encenderMuestras(elemento);
        return;
      }
      onCurvas?.(mostrar);
    },
    [onCambio, porId, bajarCapa, onRasters, rasterPorClave, onEncuadrar, onMuestras, muestras, encenderMuestras, elemento, onCurvas]
  );

  /** Varias a la vez (una categoría entera): de a cuatro, para no ahogar ni al teléfono ni al servidor. */
  const ponerVarias = useCallback(
    async (xs: ItemCapa[], mostrar: boolean) => {
      if (!mostrar) {
        for (const i of xs) void poner(i, false);
        return;
      }
      const cola = [...xs];
      await Promise.all(
        Array.from({ length: Math.min(A_LA_VEZ, cola.length) }, async () => {
          while (cola.length) await poner(cola.shift()!, true, xs.length === 1);
        })
      );
    },
    [poner]
  );

  /* ---------------------------------------------------------------- el mapa político, solo */

  const conDefecto = useRef(false);
  useEffect(() => {
    if (conDefecto.current || !lista) return;
    conDefecto.current = true;
    void ponerVarias(
      items.filter((i) => i.tipo === 'capa' && categoriaDeItem(i) === POR_DEFECTO),
      true
    );
  }, [lista, items, ponerVarias]);

  /* ---------------------------------------------------------------- lo que se pide de palabra */

  const atendido = useRef(0);
  useEffect(() => {
    if (!pedido || pedido.n === atendido.current) return;
    // Hasta que llegue el catálogo no se sabe qué hay: se espera (el efecto vuelve a correr).
    if (!lista || escaneados === null) return;
    atendido.current = pedido.n;
    const r = resolverPedido(pedido.que, items);
    if (!r.items.length) {
      onRespuesta?.(`No encontré «${pedido.que}» entre las capas del mapa.`, false);
      return;
    }
    if (pedido.mostrar && r.todo) {
      onRespuesta?.('Son demasiadas para encenderlas todas juntas. Pídame una categoría: la geología, los ríos, el ambiente…', false);
      return;
    }
    if (pedido.solo) void ponerVarias(items.filter((i) => encendido(i) && !r.items.includes(i)), false);
    void ponerVarias(
      r.items.filter((i) => encendido(i) !== pedido.mostrar),
      pedido.mostrar
    );
    // Que se vea en la caja dónde quedó lo pedido.
    if (pedido.mostrar) setDesplegadas((d) => new Set([...d, ...r.items.map(categoriaDeItem)]));
    onRespuesta?.(`${pedido.mostrar ? 'Encendí' : 'Apagué'} ${nombreDePedido(r)}.`, true);
  }, [pedido, lista, escaneados, items, encendido, ponerVarias, onRespuesta]);

  /* ---------------------------------------------------------------- dibujo */

  const categorias = useMemo(() => {
    const g = new Map<ClaveCategoria, ItemCapa[]>();
    for (const i of items) {
      const k = categoriaDeItem(i);
      g.set(k, [...(g.get(k) || []), i]);
    }
    return CATEGORIAS.filter((c) => g.has(c.clave)).map((c) => ({ ...c, items: g.get(c.clave)! }));
  }, [items]);

  const desplegar = (k: string) =>
    setDesplegadas((d) => {
      const n = new Set(d);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const hayRoca = encendidas.some((c) => c.rol === 'litologia');
  const cuantas = encendidas.length + rasters.length + (muestras ? 1 : 0) + (curvas ? 1 : 0);

  /** La casilla de un grupo: marcada si está todo, a medias si algo. Tocarla apaga lo que haya o enciende todo. */
  const casilla = (xs: ItemCapa[], etiqueta: string) => {
    const on = xs.filter(encendido).length;
    return (
      <input
        type="checkbox"
        aria-label={etiqueta}
        checked={on > 0 && on === xs.length}
        ref={(el) => {
          if (el) el.indeterminate = on > 0 && on < xs.length;
        }}
        disabled={xs.some((i) => bajando.has(claveItem(i)))}
        onChange={() => void ponerVarias(on > 0 ? xs.filter(encendido) : xs, on === 0)}
        className="mt-[3px] accent-[#FFAE3B]"
      />
    );
  };

  const filaItem = (i: ItemCapa) => {
    const k = claveItem(i);
    const on = encendido(i);
    if (i.tipo === 'capa') {
      const c = porId.get(i.id)!;
      return (
        <li key={k}>
          <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 hover:bg-white/[0.05]">
            <input type="checkbox" checked={on} disabled={bajando.has(k)} onChange={() => void poner(i, !on)} className="mt-[3px] accent-[#FFAE3B]" />
            <span className="min-w-0">
              <span className="block truncate leading-snug text-[#E7EEF2]" title={c.nombre}>
                {c.nombre}
              </span>
              <span className="block text-[10.5px] text-[#7F939D]">{bajando.has(k) ? 'Bajando…' : `${c.entidades.toLocaleString('es-HN')} rasgos`}</span>
            </span>
          </label>
        </li>
      );
    }
    if (i.tipo === 'curvas') {
      return (
        <li key={k}>
          <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 hover:bg-white/[0.05]">
            <input type="checkbox" checked={on} onChange={() => onCurvas?.(!on)} className="mt-[3px] accent-[#FFAE3B]" />
            <span className="min-w-0">
              <span className="block leading-snug text-[#E7EEF2]">Curvas y sombreado del terreno</span>
              <span className="block text-[10.5px] text-[#7F939D]">Del modelo de elevación, al acercarse</span>
            </span>
          </label>
        </li>
      );
    }
    if (i.tipo === 'muestras') {
      return (
        <li key={k}>
          <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 hover:bg-white/[0.05]">
            <input
              type="checkbox"
              checked={on}
              disabled={bajandoMuestras}
              onChange={() => (muestras ? onMuestras?.(null) : void encenderMuestras(elemento))}
              className="mt-[3px] accent-[#FFAE3B]"
            />
            <span className="min-w-0">
              <span className="block leading-snug text-[#E7EEF2]">Muestras geoquímicas (JICA)</span>
              <span className="block text-[10.5px] text-[#7F939D]">
                {bajandoMuestras ? 'Bajando…' : muestras ? `${muestras.geojson.features?.length ?? 0} muestras · Fases I–III` : 'Rocas, sedimentos y minerales · leyes de laboratorio'}
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
                  onMuestras?.({ ...muestras, elemento: e });
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
        </li>
      );
    }
    const x = rasterPorClave.get(i.clave)!;
    const r = rasters.find((y) => y.clave === i.clave);
    return (
      <li key={k}>
        <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 hover:bg-white/[0.05]">
          <input type="checkbox" checked={on} onChange={() => void poner(i, !on, true)} className="mt-[3px] accent-[#FFAE3B]" />
          {x.vector?.color && <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: x.vector.color }} />}
          <span className="min-w-0">
            <span className="block leading-snug text-[#E7EEF2]">{x.nombre}</span>
            <span className="block truncate text-[10.5px] text-[#7F939D]" title={x.notas || x.fuente}>
              {[x.fuente, x.escala].filter(Boolean).join(' · ') || x.grupo}
            </span>
          </span>
        </label>
        {r && (
          <div className="flex items-center gap-2 pl-7 pr-1 pb-1">
            <span className="font-mono text-[10px] text-[#7F939D]">opacidad</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(r.opacidad * 100)}
              aria-label={`Opacidad de ${x.nombre}`}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                onRasters?.((antes) => antes.map((y) => (y.clave === x.clave ? { ...y, opacidad: v } : y)));
              }}
              className="h-1 flex-1 accent-[#FFAE3B]"
            />
            <button type="button" onClick={() => onEncuadrar?.(x.encuadre)} aria-label={`Ir a ${x.nombre}`} className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#B9C7CE] hover:text-white cursor-pointer">
              Ir
            </button>
          </div>
        )}
        {r && !!x.leyenda?.length && (
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
  };

  /**
   * Dentro de una categoría, las capas de la base van por clase («Fallas · 39») con su propia
   * casilla: cuarenta litologías sueltas no se leen. Lo demás va suelto.
   */
  const contenido = (xs: ItemCapa[]) => {
    const porRol = new Map<string, ItemCapa[]>();
    const sueltos: ItemCapa[] = [];
    for (const i of xs) {
      if (i.tipo === 'capa') porRol.set(i.rol, [...(porRol.get(i.rol) || []), i]);
      else sueltos.push(i);
    }
    return (
      <ul className="space-y-0.5 pl-5">
        {[...porRol].map(([rol, ys]) => {
          const e = ESTILO_ROL[rol];
          const k = `rol:${rol}`;
          const abierta = desplegadas.has(k);
          const on = ys.filter(encendido).length;
          return (
            <li key={k}>
              <div className="flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-white/[0.05]">
                {casilla(ys, `Todas: ${e?.nombre || rol}`)}
                <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: e?.color || '#fff' }} />
                <button type="button" onClick={() => desplegar(k)} aria-expanded={abierta} className="flex min-w-0 flex-1 items-start justify-between gap-2 text-left cursor-pointer">
                  <span className="leading-snug text-[#E7EEF2]">{e?.nombre || rol}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[#7F939D]">
                    {on ? `${on}/` : ''}
                    {ys.length} {abierta ? '▾' : '▸'}
                  </span>
                </button>
              </div>
              {abierta && <ul className="space-y-0.5 pl-5">{ys.map(filaItem)}</ul>}
            </li>
          );
        })}
        {sueltos.map(filaItem)}
      </ul>
    );
  };

  return (
    /*
     * La caja va de debajo de la cara hasta el pie del mapa, sin tocar nada: la lista crece hacia
     * arriba dentro de ella y se desplaza si no cabe, en vez de meterse debajo de la cara.
     */
    <div className="pointer-events-none absolute left-3 bottom-3 top-[150px] z-10 flex flex-col items-start justify-end gap-2">
      {abierto && (
        <div className="pointer-events-auto min-h-0 max-h-[480px] w-[300px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-white/12 bg-[#0A0C0E]/94 p-3 text-[12.5px] text-[#C9D5DB] shadow-[0_10px_30px_rgba(0,0,0,.55)] backdrop-blur-xl">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
              {prospectividad ? 'Catastro por estado (el borde)' : 'Catastro minero'}
            </span>
            {cuantas > 0 && (
              <button
                type="button"
                onClick={() => void ponerVarias(items.filter(encendido), false)}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#B9C7CE] hover:text-white cursor-pointer"
              >
                Apagar capas
              </button>
            )}
          </div>
          <div className="mb-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
            {GRUPOS_ESTADO.map((g) => (
              <span key={g.clave} className="flex items-center gap-1.5 text-[10.5px]">
                <span className="h-2.5 w-3.5 shrink-0 rounded-[2px] border" style={{ borderColor: g.color, background: `${g.color}33`, borderStyle: g.clave === 'tramite' ? 'dashed' : 'solid' }} />
                {g.nombre}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[10.5px]">
              <span className="h-2.5 w-3.5 shrink-0 rounded-[2px] border border-[#FF5A5A]" style={{ background: 'repeating-linear-gradient(135deg, rgba(255,80,80,.8) 0 2px, transparent 2px 5px)' }} />
              Traslape
            </span>
            <span className="flex items-center gap-1.5 text-[10.5px]">
              <span className="h-2.5 w-3.5 shrink-0 rounded-[2px] border-2 border-[#FF7A45] animate-pulse" />
              Vence en ≤ 90 días
            </span>
            <span className="flex items-center gap-1.5 text-[10.5px]">
              <span className="h-2.5 w-3.5 shrink-0 rounded-[2px] border-2 border-[#FF4FD8] animate-pulse" />
              Pérdida de vegetación
            </span>
          </div>
          {onProspectividad && (
            <div className="mb-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-white/[0.05]">
                <input type="checkbox" checked={prospectividad} onChange={() => onProspectividad(!prospectividad)} className="accent-[#FFAE3B]" />
                <span className="text-[#E7EEF2]">Colorear por prospectividad</span>
              </label>
              {prospectividad && (
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pl-7 pr-1">
                  {leyendaProsp().map((l) => (
                    <span key={l.texto} className="flex items-center gap-1.5 text-[10.5px]">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: l.color }} />
                      {l.texto}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5 text-[10.5px]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-white/40" style={{ background: 'rgba(160,170,176,0.35)' }} />
                    Sin calcular
                  </span>
                  <span className="col-span-2 mt-0.5 text-[10.5px] leading-snug text-[#61717A]">
                    Geología, muestras de JICA y Sentinel-2, de 0 a 100. Se calcula al abrir la ficha de cada concesión.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mb-1 border-t border-white/[0.08] pt-2 font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
            Capas por categoría
          </div>
          {error && <p className="mb-2 text-[#E8A08F]">{error}</p>}
          {!lista && !error && <p className="text-[#7F939D]">Cargando la lista…</p>}
          <ul className="space-y-0.5">
            {categorias.map((c) => {
              const abierta = desplegadas.has(c.clave);
              const on = c.items.filter(encendido).length;
              return (
                <li key={c.clave}>
                  <div className="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-white/[0.05]">
                    {casilla(c.items, `Toda la categoría ${c.nombre}`)}
                    <span className="mt-[4px] h-3 w-3 shrink-0 rounded-sm border border-white/25" style={{ background: c.color }} />
                    <button type="button" onClick={() => desplegar(c.clave)} aria-expanded={abierta} className="flex min-w-0 flex-1 items-start justify-between gap-2 text-left cursor-pointer">
                      <span className="min-w-0">
                        <span className="block font-medium leading-snug text-[#F1F5F7]">{c.nombre}</span>
                        <span className="block truncate text-[10.5px] text-[#7F939D]">{c.detalle}</span>
                      </span>
                      <span className="mt-[2px] shrink-0 font-mono text-[10px] text-[#7F939D]">
                        {on ? <span style={{ color: AMBAR }}>{on}/</span> : null}
                        {c.items.length} {abierta ? '▾' : '▸'}
                      </span>
                    </button>
                  </div>
                  {abierta && contenido(c.items)}
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
          <p className="mt-3 text-[11px] leading-snug text-[#61717A]">
            También de palabra: «muéstrame los ríos», «esconde la geología», «deja solo el mapa político». Tocá cualquier concesión, rasgo o punto para ver su información.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={abrir}
        data-tour="capas"
        aria-expanded={abierto}
        className="pointer-events-auto shrink-0 flex items-center gap-2 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase text-[#DCE5EA] shadow-lg backdrop-blur-md hover:border-white/30 cursor-pointer"
      >
        <span aria-hidden>▤</span> Capas{cuantas ? ` · ${cuantas}` : ''}
      </button>
    </div>
  );
}
