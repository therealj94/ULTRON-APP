/**
 * HERRAMIENTAS DEL MAPA — lo que un técnico usa con la concesión delante:
 *
 *  · Coordenadas bajo el cursor: latitud/longitud, UTM WGS84 (la del GPS) y UTM NAD27 (la de los
 *    mapas 1:50 000 de Honduras y de muchos expedientes).
 *  · Medir: distancia de una línea y área del polígono que cierra, sobre el elipsoide.
 *  · Perfil topográfico: el corte de elevación a lo largo de una línea, con desnivel y pendiente
 *    máxima. La elevación sale del mismo modelo abierto del 3D (Terrarium, AWS), leído aquí.
 *
 * Mientras una herramienta está activa, tocar el mapa pone un vértice en vez de abrir la tarjeta
 * (`herramientaEnUso`, que consulta Mapa.tsx).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as maplibregl from 'maplibre-gl';
import proj4 from 'proj4';
import { estiloCalles, estiloSatelite } from './estilos';
import { sinMovimiento } from '../movimiento';
import type { Fondo } from './captura';
import { headersElectrum } from '../acceso';

type Modo = 'medir' | 'perfil' | 'area' | null;
let enUso: Modo = null;
/** ¿Hay una herramienta que se está usando? Entonces el toque es un vértice. */
export function herramientaEnUso(): boolean {
  return enUso !== null;
}

const AMBAR = '#FFAE3B';
const R = 6371008.8;
// NAD27 con el cambio de datum de Centroamérica (NIMA TR8350.2: ΔX 0, ΔY 125, ΔZ 194 m).
const NAD27_16 = '+proj=utm +zone=16 +ellps=clrk66 +towgs84=0,125,194,0,0,0,0 +units=m +no_defs';
const utmWgs = (zona: number) => `+proj=utm +zone=${zona} +datum=WGS84 +units=m +no_defs`;

export function coordenadas(lon: number, lat: number) {
  const zona = Math.floor((lon + 180) / 6) + 1;
  const [e, n] = proj4('EPSG:4326', utmWgs(zona), [lon, lat]);
  const [e27, n27] = proj4('EPSG:4326', NAD27_16, [lon, lat]);
  return { zona, e, n, e27, n27 };
}

const rad = (g: number) => (g * Math.PI) / 180;
export function distanciaM(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Área de un anillo lon/lat sobre la esfera (m²), el mismo cálculo que usan turf y Google. */
export function areaM2(anillo: Array<[number, number]>): number {
  if (anillo.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < anillo.length; i++) {
    const [l1, f1] = anillo[i];
    const [l2, f2] = anillo[(i + 1) % anillo.length];
    s += rad(l2 - l1) * (2 + Math.sin(rad(f1)) + Math.sin(rad(f2)));
  }
  return Math.abs((s * R * R) / 2);
}
const largo = (p: Array<[number, number]>) => p.slice(1).reduce((t, q, i) => t + distanciaM(p[i], q), 0);
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString('es-HN', { maximumFractionDigits: 2 })} km` : `${Math.round(m).toLocaleString('es-HN')} m`);
const ha = (m2: number) => (m2 >= 1e6 ? `${(m2 / 1e4).toLocaleString('es-HN', { maximumFractionDigits: 0 })} ha (${(m2 / 1e6).toLocaleString('es-HN', { maximumFractionDigits: 2 })} km²)` : `${(m2 / 1e4).toLocaleString('es-HN', { maximumFractionDigits: 2 })} ha`);

/* --------------------------------------------------------------- elevación (Terrarium) */

const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const Z_DEM = 12;
const cacheDem = new Map<string, Promise<ImageData | null>>();
function teselaDem(x: number, y: number): Promise<ImageData | null> {
  const k = `${x}/${y}`;
  if (!cacheDem.has(k)) {
    cacheDem.set(
      k,
      new Promise((ok) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 256;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0);
          ok(ctx.getImageData(0, 0, 256, 256));
        };
        img.onerror = () => ok(null);
        img.src = `${DEM}/${Z_DEM}/${x}/${y}.png`;
      })
    );
  }
  return cacheDem.get(k)!;
}
/** Elevación en metros de un punto (lectura bilineal del modelo a zoom 12, ≈ 38 m por píxel). */
export async function elevacion(lon: number, lat: number): Promise<number | null> {
  const n = 2 ** Z_DEM;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * n;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  const d = await teselaDem(x, y);
  if (!d) return null;
  const px = Math.min(255, Math.max(0, (fx - x) * 256));
  const py = Math.min(255, Math.max(0, (fy - y) * 256));
  const v = (i: number, j: number) => {
    const o = (Math.min(255, j) * 256 + Math.min(255, i)) * 4;
    return d.data[o] * 256 + d.data[o + 1] + d.data[o + 2] / 256 - 32768;
  };
  const i = Math.floor(px);
  const j = Math.floor(py);
  const tx = px - i;
  const ty = py - j;
  return v(i, j) * (1 - tx) * (1 - ty) + v(i + 1, j) * tx * (1 - ty) + v(i, j + 1) * (1 - tx) * ty + v(i + 1, j + 1) * tx * ty;
}

type Perfil = { d: number[]; z: number[]; total: number; min: number; max: number; sube: number; baja: number; pendienteMax: number };
async function perfilDe(p: Array<[number, number]>, muestras = 160): Promise<Perfil | null> {
  const total = largo(p);
  if (total <= 0) return null;
  const puntos: Array<{ d: number; ll: [number, number] }> = [];
  for (let k = 0; k <= muestras; k++) {
    let objetivo = (total * k) / muestras;
    for (let i = 1; i < p.length; i++) {
      const seg = distanciaM(p[i - 1], p[i]);
      if (objetivo <= seg || i === p.length - 1) {
        const t = seg ? Math.min(1, objetivo / seg) : 0;
        puntos.push({ d: (total * k) / muestras, ll: [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t] });
        break;
      }
      objetivo -= seg;
    }
  }
  const z = await Promise.all(puntos.map((q) => elevacion(q.ll[0], q.ll[1])));
  if (z.some((v) => v === null)) return null;
  const zz = z as number[];
  let sube = 0;
  let baja = 0;
  let pendienteMax = 0;
  for (let i = 1; i < zz.length; i++) {
    const dz = zz[i] - zz[i - 1];
    if (dz > 0) sube += dz;
    else baja -= dz;
    const dd = puntos[i].d - puntos[i - 1].d;
    if (dd > 0) pendienteMax = Math.max(pendienteMax, (Math.abs(dz) / dd) * 100);
  }
  return { d: puntos.map((q) => q.d), z: zz, total, min: Math.min(...zz), max: Math.max(...zz), sube, baja, pendienteMax };
}

/* --------------------------------------------------------------- dibujo en el mapa */

const FUENTE = 'herramienta';
function pintarTrazo(m: maplibregl.Map, puntos: Array<[number, number]>, cursor: [number, number] | null, modo: Modo, cerrado: boolean) {
  const linea = cursor && !cerrado ? [...puntos, cursor] : puntos;
  const feats: any[] = [];
  if ((modo === 'medir' || modo === 'area') && linea.length >= 3) feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...linea, linea[0]]] }, properties: { k: 'area' } });
  if (linea.length >= 2) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: linea }, properties: { k: 'linea' } });
  for (const p of puntos) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { k: 'vertice' } });
  const datos = { type: 'FeatureCollection', features: feats };
  const src = m.getSource(FUENTE) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(datos as any);
  else {
    m.addSource(FUENTE, { type: 'geojson', data: datos as any });
    m.addLayer({ id: 'herr-area', type: 'fill', source: FUENTE, filter: ['==', ['get', 'k'], 'area'], paint: { 'fill-color': AMBAR, 'fill-opacity': 0.14 } } as any);
    m.addLayer({ id: 'herr-linea', type: 'line', source: FUENTE, filter: ['==', ['get', 'k'], 'linea'], paint: { 'line-color': '#FFFFFF', 'line-width': 2.2, 'line-dasharray': [2, 1.2] } } as any);
    m.addLayer({ id: 'herr-vertice', type: 'circle', source: FUENTE, filter: ['==', ['get', 'k'], 'vertice'], paint: { 'circle-radius': 4.5, 'circle-color': AMBAR, 'circle-stroke-color': '#0B0D0F', 'circle-stroke-width': 1.5 } } as any);
  }
}
function quitarTrazo(m: maplibregl.Map) {
  for (const id of ['herr-vertice', 'herr-linea', 'herr-area']) if (m.getLayer(id)) m.removeLayer(id);
  if (m.getSource(FUENTE)) m.removeSource(FUENTE);
}

/* --------------------------------------------------------------- componente */

export function Herramientas({ mapa, tresD, fondo }: { mapa: maplibregl.Map; tresD: boolean; fondo: Fondo }) {
  const [comparar, setComparar] = useState(false);
  const [orbitando, setOrbitando] = useState(false);
  const [coord, setCoord] = useState<{ lon: number; lat: number } | null>(null);
  const [modo, setModo] = useState<Modo>(null);
  const [puntos, setPuntos] = useState<Array<[number, number]>>([]);
  const [cerrado, setCerrado] = useState(false);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [perfilError, setPerfilError] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  const cursor = useRef<[number, number] | null>(null);
  // Estable: si cambiara en cada render (el de las coordenadas bajo el cursor, por ejemplo), la órbita
  // se reiniciaría y su inclinación inicial la frenaría a cada rato.
  const pararOrbita = useCallback(() => setOrbitando(false), []);
  const estado = useRef({ modo, puntos, cerrado });
  estado.current = { modo, puntos, cerrado };

  // Coordenadas bajo el cursor (una vez por cuadro, no en cada evento).
  useEffect(() => {
    let cuadro = 0;
    const mover = (e: maplibregl.MapMouseEvent) => {
      cursor.current = [e.lngLat.lng, e.lngLat.lat];
      if (cuadro) return;
      cuadro = requestAnimationFrame(() => {
        cuadro = 0;
        if (cursor.current) setCoord({ lon: cursor.current[0], lat: cursor.current[1] });
        const s = estado.current;
        if (s.modo && s.puntos.length && !s.cerrado) pintarTrazo(mapa, s.puntos, cursor.current, s.modo, false);
      });
    };
    const salir = () => setCoord(null);
    mapa.on('mousemove', mover);
    mapa.getCanvas().addEventListener('mouseleave', salir);
    return () => {
      mapa.off('mousemove', mover);
      mapa.getCanvas().removeEventListener('mouseleave', salir);
      if (cuadro) cancelAnimationFrame(cuadro);
    };
  }, [mapa]);

  // Vértices: cada toque suma uno; doble toque (o «Terminar») cierra.
  useEffect(() => {
    enUso = modo;
    if (!modo) {
      mapa.doubleClickZoom.enable();
      mapa.getCanvas().style.cursor = '';
      return;
    }
    mapa.doubleClickZoom.disable();
    mapa.getCanvas().style.cursor = 'crosshair';
    const minimo = modo === 'area' ? 3 : 2;
    // Terminar solo con los vértices que la herramienta necesita: un perfil de un punto o un área de
    // dos no es un resultado, es un error que se vería en la pantalla.
    const terminar = () => {
      if (estado.current.puntos.length >= minimo) setCerrado(true);
    };
    const tocar = (e: maplibregl.MapMouseEvent) => {
      if (estado.current.cerrado) return;
      const nuevo: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      // El doble toque dispara dos clics en el mismo lugar: el segundo vértice repetido no cuenta.
      setPuntos((p) => {
        const u = p[p.length - 1];
        return u && Math.abs(u[0] - nuevo[0]) < 1e-9 && Math.abs(u[1] - nuevo[1]) < 1e-9 ? p : [...p, nuevo];
      });
    };
    const doble = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      terminar();
    };
    const tecla = (e: KeyboardEvent) => {
      // Mientras se escribe (el chat, el nombre del área), Enter y Esc son del campo, no de la herramienta.
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea,select')) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        cerrar();
      }
      if (e.key === 'Enter') {
        // Que no «apriete» el botón con el foco (el de la herramienta, que la apagaría).
        e.preventDefault();
        terminar();
      }
    };
    mapa.on('click', tocar);
    mapa.on('dblclick', doble);
    window.addEventListener('keydown', tecla, { capture: true });
    return () => {
      mapa.off('click', tocar);
      mapa.off('dblclick', doble);
      window.removeEventListener('keydown', tecla, { capture: true });
      mapa.getCanvas().style.cursor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, mapa]);

  useEffect(() => () => {
    enUso = null;
  }, []);

  // Dibujar (y volver a dibujar si el estilo se recarga al cambiar de fondo).
  useEffect(() => {
    const dibujar = () => {
      if (!mapa.isStyleLoaded()) return;
      if (modo && puntos.length) pintarTrazo(mapa, puntos, cursor.current, modo, cerrado);
      else quitarTrazo(mapa);
    };
    dibujar();
    mapa.on('style.load', dibujar);
    return () => {
      mapa.off('style.load', dibujar);
    };
  }, [mapa, modo, puntos, cerrado]);

  // El perfil se calcula al cerrar la línea.
  useEffect(() => {
    if (modo !== 'perfil' || !cerrado || puntos.length < 2) return;
    let vivo = true;
    setCalculando(true);
    setPerfilError(null);
    perfilDe(puntos)
      .then((p) => {
        if (!vivo) return;
        if (!p) setPerfilError('No pude leer la elevación de todo el trazo (sin conexión al modelo de elevación).');
        setPerfil(p);
      })
      .finally(() => vivo && setCalculando(false));
    return () => {
      vivo = false;
    };
  }, [modo, cerrado, puntos]);

  const cerrar = useCallback(() => {
    setModo(null);
    setPuntos([]);
    setCerrado(false);
    setPerfil(null);
    setPerfilError(null);
  }, []);
  const empezar = (m: Modo) => {
    if (modo === m) return cerrar();
    // La ficha abierta ocupa el mismo rincón que el panel de la herramienta: se cierra.
    window.dispatchEvent(new Event('electrum:herramienta'));
    setModo(m);
    setPuntos([]);
    setCerrado(false);
    setPerfil(null);
    setPerfilError(null);
  };

  const c = useMemo(() => (coord ? coordenadas(coord.lon, coord.lat) : null), [coord]);
  const dist = largo(puntos);
  const area = (modo === 'medir' || modo === 'area') && puntos.length >= 3 ? areaM2(puntos) : 0;

  return (
    <>
      {/* Botonera, debajo del zoom de MapLibre. */}
      <div className="pointer-events-auto absolute right-[10px] top-[118px] z-10 flex flex-col overflow-hidden rounded-md border border-white/15 bg-black/75 shadow-lg backdrop-blur-md">
        <BotonHerr activo={modo === 'medir'} onClick={() => empezar('medir')} titulo="Medir distancia y área">
          <path d="M3 17 17 3m-11 3 2 2m1-5 2 2m1 1 2 2m1-5 2 2" />
        </BotonHerr>
        <BotonHerr activo={modo === 'perfil'} onClick={() => empezar('perfil')} titulo="Perfil topográfico">
          <path d="M2 16 7 8l3 4 3-6 5 10z" />
        </BotonHerr>
        <BotonHerr activo={modo === 'area'} onClick={() => empezar('area')} titulo="Pedir un área nueva: dibujarla y revisar qué pisa">
          <path d="M4 15 3 6l7-3 7 5-2 8zM10 7v6M7 10h6" />
        </BotonHerr>
        <BotonHerr activo={comparar} onClick={() => setComparar((v) => !v)} titulo={fondo === 'satelite' ? 'Comparar con el mapa de calles' : 'Comparar con la imagen satelital'}>
          <path d="M10 2v16M3 4h5v12H3zM12 4h5v12h-5z" />
        </BotonHerr>
        {!sinMovimiento() && (
          <BotonHerr activo={orbitando} onClick={() => setOrbitando((v) => !v)} titulo="Órbita de 360° alrededor del centro">
            <path d="M16.5 7A7 7 0 1 0 17 11M17 3v4h-4" />
          </BotonHerr>
        )}
      </div>
      {comparar && <Comparador mapa={mapa} fondo={fondo} onCerrar={() => setComparar(false)} />}
      <Orbita mapa={mapa} activa={orbitando} onParar={pararOrbita} tresD={tresD} />

      {modo && (
        <div className="pointer-events-auto absolute right-[52px] top-[118px] z-30 w-[240px] rounded-lg border border-white/12 bg-[#0A0C0E]/94 p-2.5 text-[12px] text-[#C9D5DB] shadow-lg backdrop-blur-xl">
          <div className="mb-1 font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: AMBAR }}>
            {modo === 'medir' ? 'Medir' : modo === 'area' ? 'Área nueva' : 'Perfil topográfico'}
          </div>
          {puntos.length < 2 ? (
            <p className="text-[#8FA3B0]">
              {modo === 'area' ? 'Dibujá el área que pensás pedir: tocá cada vértice; ' : 'Tocá el mapa para poner puntos; '}doble toque o Enter para terminar, Esc para salir.
            </p>
          ) : (
            <p>
              Distancia: <b className="text-[#F3F6F8]">{km(dist)}</b>
              {area > 0 && (
                <>
                  <br />
                  Área: <b className="text-[#F3F6F8]">{ha(area)}</b>
                </>
              )}
            </p>
          )}
          <div className="mt-2 flex gap-1.5">
            {!cerrado && puntos.length >= (modo === 'area' ? 3 : 2) && (
              <button type="button" onClick={() => setCerrado(true)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-black cursor-pointer" style={{ background: AMBAR }}>
                Terminar
              </button>
            )}
            <button type="button" onClick={() => { setPuntos([]); setCerrado(false); setPerfil(null); }} className="rounded-md border border-white/15 px-2 py-1 text-[11px] hover:bg-white/10 cursor-pointer">
              Borrar
            </button>
            <button type="button" onClick={cerrar} className="rounded-md border border-white/15 px-2 py-1 text-[11px] hover:bg-white/10 cursor-pointer">
              Salir
            </button>
          </div>
        </div>
      )}

      {modo === 'perfil' && cerrado && (
        <div className="pointer-events-auto absolute left-3 right-3 bottom-12 z-10 mx-auto max-w-[760px] rounded-xl border border-white/12 bg-[#0A0C0E]/95 p-3 shadow-[0_10px_30px_rgba(0,0,0,.55)] backdrop-blur-xl">
          {calculando && <p className="text-[12px] text-[#8FA3B0]">Leyendo la elevación…</p>}
          {perfilError && <p className="text-[12px] text-[#E8A08F]">{perfilError}</p>}
          {perfil && <GraficoPerfil p={perfil} />}
        </div>
      )}

      {modo === 'area' && cerrado && puntos.length >= 3 && <PanelArea puntos={puntos} />}

      {c && coord && (
        <div className="pointer-events-none absolute bottom-[52px] left-3 z-10 hidden rounded-md bg-black/70 sm:block px-2 py-1 font-mono text-[10.5px] leading-snug text-[#DCE5EA] backdrop-blur-sm">
          {coord.lat.toFixed(5)}°, {coord.lon.toFixed(5)}°
          <br />
          UTM {c.zona}N WGS84 {Math.round(c.e).toLocaleString('es-HN')} E · {Math.round(c.n).toLocaleString('es-HN')} N
          <br />
          <span className="text-[#8FA3B0]">
            NAD27 16N {Math.round(c.e27).toLocaleString('es-HN')} E · {Math.round(c.n27).toLocaleString('es-HN')} N
          </span>
        </div>
      )}
    </>
  );
}

export function BotonHerr({ activo, onClick, titulo, children }: { activo: boolean; onClick: () => void; titulo: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={activo}
      onClick={onClick}
      className="flex h-[30px] w-[30px] items-center justify-center border-b border-white/10 last:border-b-0 hover:bg-white/10 cursor-pointer"
      style={activo ? { background: 'rgba(255,174,59,0.25)' } : undefined}
    >
      <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke={activo ? AMBAR : '#DCE5EA'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

/** El corte de elevación en SVG, con cotas, desnivel y pendiente máxima. */
function GraficoPerfil({ p }: { p: Perfil }) {
  const W = 720;
  const H = 150;
  const m = { l: 44, r: 10, t: 10, b: 22 };
  const rango = Math.max(10, p.max - p.min);
  const x = (d: number) => m.l + (d / p.total) * (W - m.l - m.r);
  const y = (z: number) => m.t + (1 - (z - (p.min - rango * 0.08)) / (rango * 1.16)) * (H - m.t - m.b);
  const linea = p.d.map((d, i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(p.z[i]).toFixed(1)}`).join('');
  const area = `${linea}L${x(p.total).toFixed(1)},${H - m.b}L${m.l},${H - m.b}Z`;
  const cotas = [p.min, (p.min + p.max) / 2, p.max];
  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-[#C9D5DB]">
        <span>Largo {km(p.total)}</span>
        <span>Cota {Math.round(p.min).toLocaleString('es-HN')}–{Math.round(p.max).toLocaleString('es-HN')} m</span>
        <span>Sube {Math.round(p.sube).toLocaleString('es-HN')} m · baja {Math.round(p.baja).toLocaleString('es-HN')} m</span>
        <span>Pendiente máx. {p.pendienteMax.toFixed(0)} %</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Perfil topográfico">
        <defs>
          <linearGradient id="perfil-relleno" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={AMBAR} stopOpacity="0.45" />
            <stop offset="1" stopColor={AMBAR} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {cotas.map((z) => (
          <g key={z}>
            <line x1={m.l} x2={W - m.r} y1={y(z)} y2={y(z)} stroke="rgba(255,255,255,0.08)" />
            <text x={m.l - 5} y={y(z) + 3} textAnchor="end" fontSize="10" fill="#7F939D">
              {Math.round(z)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#perfil-relleno)" />
        <path d={linea} fill="none" stroke={AMBAR} strokeWidth="1.8" />
        <text x={m.l} y={H - 6} fontSize="10" fill="#7F939D">
          0
        </text>
        <text x={W - m.r} y={H - 6} fontSize="10" fill="#7F939D" textAnchor="end">
          {km(p.total)}
        </text>
      </svg>
      <p className="mt-1 text-[10.5px] text-[#61717A]">Modelo de elevación abierto (Terrarium, ≈ 38 m por píxel): sirve para planificar, no reemplaza un levantamiento topográfico.</p>
    </div>
  );
}

/**
 * ÓRBITA: la cámara gira alrededor del centro, inclinada, una vuelta cada ~40 s. Se detiene en
 * cuanto alguien toca, arrastra o hace zoom: es para mirar, no para pelear con el mapa.
 */
function Orbita({ mapa, activa, onParar, tresD }: { mapa: maplibregl.Map; activa: boolean; onParar: () => void; tresD: boolean }) {
  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    let antes = 0;
    mapa.easeTo({ pitch: Math.max(mapa.getPitch(), tresD ? 62 : 50), duration: 900 });
    const paso = (t: number) => {
      if (!vivo) return;
      // El paso se acota: tras una pestaña oculta o un cuadro lento, no pega un salto.
      if (antes && !mapa.isMoving()) mapa.setBearing(mapa.getBearing() + (Math.min(100, t - antes) / 1000) * 9);
      antes = t;
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
    const parar = () => onParar();
    const canvas = mapa.getCanvas();
    canvas.addEventListener('pointerdown', parar);
    canvas.addEventListener('wheel', parar, { passive: true });
    return () => {
      vivo = false;
      canvas.removeEventListener('pointerdown', parar);
      canvas.removeEventListener('wheel', parar);
    };
  }, [activa, mapa, onParar, tresD]);
  return null;
}

/**
 * COMPARADOR: un segundo mapa, quieto y sincronizado con el principal, recortado a la derecha de
 * una cortina que se arrastra. A un lado todo lo encendido (catastro, capas, mapas escaneados); al
 * otro, la imagen satelital de hoy (o las calles, si el principal ya está en satélite).
 */
function Comparador({ mapa, fondo, onCerrar }: { mapa: maplibregl.Map; fondo: Fondo; onCerrar: () => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0.5);
  const arrastrando = useRef(false);
  useEffect(() => {
    if (!caja.current) return;
    const otro = new maplibregl.Map({
      container: caja.current,
      style: fondo === 'satelite' ? estiloCalles() : estiloSatelite(),
      center: mapa.getCenter(),
      zoom: mapa.getZoom(),
      bearing: mapa.getBearing(),
      pitch: mapa.getPitch(),
      interactive: false,
      attributionControl: false,
    });
    const seguir = () => otro.jumpTo({ center: mapa.getCenter(), zoom: mapa.getZoom(), bearing: mapa.getBearing(), pitch: mapa.getPitch() });
    mapa.on('move', seguir);
    const medir = new ResizeObserver(() => otro.resize());
    medir.observe(caja.current);
    // El tamaño del lienzo se toma al crear el mapa, antes de que el estilo absoluto termine de
    // aplicarse: se vuelve a medir en el cuadro siguiente y al cargar, o queda una franja sin dibujar.
    const cuadro = requestAnimationFrame(() => otro.resize());
    otro.once('load', () => {
      otro.resize();
      seguir();
    });
    return () => {
      cancelAnimationFrame(cuadro);
      mapa.off('move', seguir);
      medir.disconnect();
      otro.remove();
    };
  }, [mapa, fondo]);
  useEffect(() => {
    const mover = (e: PointerEvent) => {
      if (!arrastrando.current || !caja.current) return;
      const r = caja.current.getBoundingClientRect();
      setX(Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width)));
    };
    const soltar = () => (arrastrando.current = false);
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
  }, []);
  const otroNombre = fondo === 'satelite' ? 'Calles' : 'Satélite (Esri)';
  return (
    <>
      {/* Posición en línea: la clase `.maplibregl-map` trae `position: relative` y le gana a Tailwind (ver Mapa.tsx). */}
      <div ref={caja} style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', clipPath: `inset(0 0 0 ${x * 100}%)` }} />
      <div className="pointer-events-none absolute inset-y-0 z-[6]" style={{ left: `${x * 100}%` }}>
        <div className="absolute inset-y-0 -left-px w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,.6)]" />
        <button
          type="button"
          aria-label="Arrastrá para comparar"
          onPointerDown={(e) => {
            arrastrando.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          className="pointer-events-auto absolute top-1/2 -left-4 flex h-8 w-8 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-white/70 bg-black/80 text-[13px] text-white shadow-lg"
        >
          ⇆
        </button>
        <span className="absolute top-12 -left-2 -translate-x-full whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-[#DCE5EA]">Mapa con capas</span>
        <span className="absolute top-12 left-2 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-[#DCE5EA]">{otroNombre}</span>
      </div>
      <button
        type="button"
        onClick={onCerrar}
        className="pointer-events-auto absolute bottom-[34px] left-1/2 z-[6] -translate-x-1/2 rounded-full border border-white/20 bg-black/80 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#DCE5EA] hover:border-white/40 cursor-pointer"
      >
        Cerrar comparación
      </button>
    </>
  );
}

/* --------------------------------------------------------------- área nueva */

type Analisis = {
  nombre: string;
  ha: number;
  perimetroKm: number;
  libreHa: number;
  traslapes: Array<{ con: string; conId: number; hectareas: number; pct: number }>;
  renglones: string[];
};

/**
 * ÁREA NUEVA: al cerrar el polígono se cruza en el servidor con el catastro y todas las capas; de ahí
 * sale la revisión previa en PDF (plano de situación, vértices WGS84/NAD27 y entorno).
 */
function PanelArea({ puntos }: { puntos: Array<[number, number]> }) {
  const [nombre, setNombre] = useState('Área solicitada');
  const [r, setR] = useState<Analisis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [armando, setArmando] = useState(false);
  const geojson = useMemo(() => ({ type: 'Polygon', coordinates: [[...puntos, puntos[0]]] }), [puntos]);
  const hf = (x: number) => x.toLocaleString('es-HN', { maximumFractionDigits: 2 });

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    setR(null);
    fetch('/api/electrum/area/analizar', { method: 'POST', headers: { ...headersElectrum(), 'Content-Type': 'application/json' }, body: JSON.stringify({ geojson }) })
      .then(async (res) => {
        const j = await res.json().catch(() => null);
        if (!vivo) return;
        if (!res.ok) setError(j?.error || (res.status === 404 ? 'Esta función todavía no está activa en el servidor.' : `El servidor contestó ${res.status}.`));
        else setR(j);
      })
      .catch(() => vivo && setError('No alcancé el servidor.'))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [geojson]);

  const pdf = async () => {
    setArmando(true);
    setError(null);
    try {
      const res = await fetch('/api/electrum/area/informe', { method: 'POST', headers: { ...headersElectrum(), 'Content-Type': 'application/json' }, body: JSON.stringify({ geojson, nombre }) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.url) return setError(j?.error || (res.status === 404 ? 'Esta función todavía no está activa en el servidor.' : `El servidor contestó ${res.status}.`));
      const b = await fetch(j.url, { headers: headersElectrum() });
      if (!b.ok) return setError(`No pude bajar el PDF (${b.status}).`);
      const url = URL.createObjectURL(await b.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = j.nombre || 'area-solicitada.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setError('No alcancé el servidor.');
    } finally {
      setArmando(false);
    }
  };

  return (
    <div className="pointer-events-auto absolute left-3 right-3 bottom-12 z-30 mx-auto max-h-[60%] max-w-[560px] overflow-y-auto rounded-xl border border-white/12 bg-[#0A0C0E]/95 p-3 text-[12px] text-[#C9D5DB] shadow-[0_10px_30px_rgba(0,0,0,.55)] backdrop-blur-xl">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value.slice(0, 80))}
          aria-label="Nombre del área"
          className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[12.5px] text-[#F3F6F8] outline-none focus:border-white/35"
        />
        <button type="button" disabled={armando || cargando || !r} onClick={() => void pdf()} className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-black disabled:opacity-50 cursor-pointer" style={{ background: AMBAR }}>
          {armando ? 'Armando…' : 'Revisión en PDF'}
        </button>
      </div>
      {cargando && <p className="text-[#8FA3B0]">Cruzando el área con el catastro y las capas…</p>}
      {error && <p className="text-[#E8A08F]">{error}</p>}
      {r && (
        <div className="space-y-2">
          <p>
            <b className="text-[#F3F6F8]">{hf(r.ha)} ha</b> · perímetro {hf(r.perimetroKm)} km ·{' '}
            <span style={{ color: r.traslapes.length ? '#E8A08F' : '#8FD19E' }}>
              {r.traslapes.length ? `libres ${hf(r.libreHa)} ha (${r.ha > 0 ? Math.round((r.libreHa / r.ha) * 100) : 0} %)` : 'libre de concesiones'}
            </span>
          </p>
          {!!r.traslapes.length && (
            <div>
              <div className="mb-1 font-mono text-[10px] tracking-[0.14em] uppercase text-[#7F939D]">Concesiones que pisa</div>
              <ul className="space-y-0.5">
                {r.traslapes.slice(0, 12).map((t) => (
                  <li key={t.conId} className="flex justify-between gap-2">
                    <span className="truncate">{t.con}</span>
                    <span className="shrink-0 font-mono text-[11px] text-[#E8A08F]">
                      {hf(t.hectareas)} ha · {t.pct.toLocaleString('es-HN', { maximumFractionDigits: 1 })} %
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="mb-1 font-mono text-[10px] tracking-[0.14em] uppercase text-[#7F939D]">Entorno</div>
            <ul className="space-y-1">
              {r.renglones.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#5E7078]" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[10.5px] text-[#61717A]">Revisión previa con lo cargado en la plataforma: no es una constancia del catastro oficial.</p>
        </div>
      )}
    </div>
  );
}
