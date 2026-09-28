/**
 * TIMELAPSE SATELITAL — la concesión vista desde el espacio, un cuadro por año.
 *
 * De Sentinel-2 (Copernicus, ESA), por el catálogo abierto STAC de Element 84 y las imágenes en
 * color verdadero (TCI, 10 m) guardadas como COG en AWS Open Data: se leen solo los bytes de la
 * ventana que cubre la concesión, del nivel de resolución que hace falta, sin descargar la escena.
 *
 * Un cuadro por temporada seca (enero a abril) de cada año desde 2018: la misma estación, así el
 * cambio que se ve es del terreno y no de la lluvia. De cada año se toma la escena menos nublada
 * que cubra toda la ventana; si el recorte sale con nubes o sin datos, la siguiente.
 */
import type { Express, Request, Response } from 'express';
import type { Geometry, Position } from 'geojson';
import { fromUrl } from 'geotiff';
import jpeg from 'jpeg-js';
import proj4 from 'proj4';
import { exigirPlataforma, limitar } from '../seguridad';
import { geometriaDe, hayBase } from './db';

const STAC = 'https://earth-search.aws.element84.com/v1/search';
const LADO = 480;
const PRIMER_ANIO = 2018;
const NUBES_ESCENA = 30;
/** Fracción del recorte que puede ser nube o sin datos antes de probar otra escena. */
const TOPE_NUBE = 0.12;
const TOPE_VACIO = 0.02;
/** Promedio del canal más oscuro (0–1) por encima del cual el recorte se ve lechoso. */
const TOPE_BRUMA = 0.17;

export type Cuadro = { fecha: string; nubes: number; escena: string; img: string };
export type Timelapse = { cuadros: Cuadro[]; ancho: number; alto: number; contorno: number[][][]; fuente: string; faltan: number[] };

type Item = { id: string; fecha: string; nubes: number; epsg: number; href: string; bbox: number[] };

async function escenasDelAnio(anio: number, bbox: number[], ms: number): Promise<Item[]> {
  const r = await fetch(STAC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      bbox,
      datetime: `${anio}-01-01T00:00:00Z/${anio}-04-30T23:59:59Z`,
      query: { 'eo:cloud_cover': { lt: NUBES_ESCENA } },
      sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
      limit: 12,
      fields: { include: ['id', 'bbox', 'properties.datetime', 'properties.eo:cloud_cover', 'properties.proj:epsg', 'assets.visual.href'] },
    }),
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`STAC ${r.status}`);
  const j: any = await r.json();
  return (j.features || [])
    .filter((f: any) => f?.assets?.visual?.href && f?.properties?.['proj:epsg'])
    .map((f: any) => ({ id: f.id, fecha: String(f.properties.datetime).slice(0, 10), nubes: Number(f.properties['eo:cloud_cover']), epsg: Number(f.properties['proj:epsg']), href: f.assets.visual.href, bbox: f.bbox }))
    // La escena tiene que cubrir la ventana entera (el borde de una tesela MGRS es sin datos).
    .filter((it: Item) => it.bbox[0] <= bbox[0] && it.bbox[1] <= bbox[1] && it.bbox[2] >= bbox[2] && it.bbox[3] >= bbox[3]);
}

const utm = (epsg: number) => (epsg >= 32601 && epsg <= 32660 ? `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs` : epsg >= 32701 && epsg <= 32760 ? `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs` : null);

/** La ventana en metros de la proyección de la escena, cuadrada alrededor de la concesión. */
function ventana(bboxLL: number[], epsg: number): [number, number, number, number] | null {
  const p = utm(epsg);
  if (!p) return null;
  const esq = [
    [bboxLL[0], bboxLL[1]],
    [bboxLL[2], bboxLL[1]],
    [bboxLL[0], bboxLL[3]],
    [bboxLL[2], bboxLL[3]],
  ].map((c) => proj4('EPSG:4326', p, c));
  const xs = esq.map((c) => c[0]);
  const ys = esq.map((c) => c[1]);
  const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Un margen del 20 % y al menos 1,5 km de lado: la concesión se ve con su entorno.
  const lado = Math.max(1500, 1.2 * Math.max(x2 - x1, y2 - y1));
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return [cx - lado / 2, cy - lado / 2, cx + lado / 2, cy + lado / 2];
}

/** Lee el recorte RGB de una escena, del nivel de resolución que alcanza para LADO píxeles. */
async function recorte(it: Item, v: [number, number, number, number]): Promise<{ rgb: Uint8Array; nube: number; vacio: number; bruma: number } | null> {
  const tif = await fromUrl(it.href);
  const base = await tif.getImage(0);
  const [ox, oy] = base.getOrigin();
  const [rx] = base.getResolution();
  const w0 = base.getWidth();
  const necesario = (v[2] - v[0]) / LADO;
  // El nivel más grueso que todavía da la resolución pedida (los overviews no traen su propia georreferencia).
  let nivel = 0;
  const n = await tif.getImageCount();
  for (let i = 1; i < n; i++) {
    const im = await tif.getImage(i);
    if (rx * (w0 / im.getWidth()) <= necesario) nivel = i;
  }
  const img = nivel ? await tif.getImage(nivel) : base;
  const r = rx * (w0 / img.getWidth());
  const px = (x: number) => Math.round((x - ox) / r);
  const py = (y: number) => Math.round((oy - y) / r);
  const win = [px(v[0]), py(v[3]), px(v[2]), py(v[1])];
  if (win[0] < 0 || win[1] < 0 || win[2] > img.getWidth() || win[3] > img.getHeight()) return null;
  const datos = (await img.readRasters({ window: win, width: LADO, height: LADO, interleave: true, resampleMethod: 'bilinear' })) as unknown as Uint8Array;
  let nube = 0;
  let vacio = 0;
  let oscuro = 0;
  for (let i = 0; i < LADO * LADO; i++) {
    const [a, b, c] = [datos[3 * i], datos[3 * i + 1], datos[3 * i + 2]];
    const m = Math.min(a, b, c);
    if (a === 0 && b === 0 && c === 0) vacio++;
    else if (m > 175) nube++;
    oscuro += m;
  }
  const t = LADO * LADO;
  // Bruma y humo (las quemas de la temporada seca) levantan el canal más oscuro de cada píxel:
  // en escenas despejadas de Olancho su promedio medido va de 0,07 a 0,16; con una pluma de humo, 0,2.
  return { rgb: datos, nube: nube / t, vacio: vacio / t, bruma: oscuro / Math.max(1, t - vacio) / 255 };
}

/** RGB → JPEG, con un poco de gamma: el TCI es oscuro sobre bosque. */
function aJpeg(rgb: Uint8Array): string {
  const tabla = new Uint8Array(256);
  for (let i = 0; i < 256; i++) tabla[i] = Math.round(255 * Math.pow(i / 255, 0.8));
  const px = new Uint8Array(LADO * LADO * 4);
  for (let i = 0; i < LADO * LADO; i++) {
    px[4 * i] = tabla[rgb[3 * i]];
    px[4 * i + 1] = tabla[rgb[3 * i + 1]];
    px[4 * i + 2] = tabla[rgb[3 * i + 2]];
    px[4 * i + 3] = 255;
  }
  return `data:image/jpeg;base64,${Buffer.from(jpeg.encode({ data: px, width: LADO, height: LADO }, 84).data).toString('base64')}`;
}

function anillos(g: Geometry): Position[][] {
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(anillos);
  return [];
}

const cache = new Map<number, { at: number; t: Timelapse }>();
const VIDA_MS = 12 * 3600_000;
const enCurso = new Map<number, Promise<Timelapse | { error: string }>>();

export async function timelapseConcesion(id: number, hoy = new Date()): Promise<Timelapse | { error: string }> {
  const c = cache.get(id);
  if (c && Date.now() - c.at < VIDA_MS) return c.t;
  if (enCurso.has(id)) return enCurso.get(id)!;
  const p = armar(id, hoy).finally(() => enCurso.delete(id));
  enCurso.set(id, p);
  return p;
}

async function armar(id: number, hoy: Date): Promise<Timelapse | { error: string }> {
  const geo = await geometriaDe(id);
  if (!geo) return { error: 'Esa concesión no tiene geometría.' };
  const [x1, y1, x2, y2] = geo.encuadre;
  const anios: number[] = [];
  const ultimo = hoy.getUTCMonth() >= 4 ? hoy.getUTCFullYear() : hoy.getUTCFullYear() - 1;
  for (let a = PRIMER_ANIO; a <= ultimo; a++) anios.push(a);
  // Las búsquedas de todos los años a la vez; las lecturas de a tres (son las que pesan).
  const candidatos = await Promise.all(anios.map((a) => escenasDelAnio(a, [x1, y1, x2, y2], 20000).catch(() => [] as Item[])));
  let epsg: number | null = null;
  let v: [number, number, number, number] | null = null;
  const cuadros: Array<Cuadro | null> = anios.map(() => null);
  /** El cuadro de un año: la escena menos nublada cuyo recorte sale limpio (hasta cuatro intentos). */
  const uno = async (i: number) => {
    // Si ninguna sale limpia de bruma, la menos brumosa de las que no tienen nubes ni huecos.
    let mejor: { it: Item; r: NonNullable<Awaited<ReturnType<typeof recorte>>> } | null = null;
    // Todas las escenas en la misma proyección, para que los cuadros calcen píxel a píxel.
    for (const it of candidatos[i].filter((x) => epsg === null || x.epsg === epsg).slice(0, 4)) {
      if (epsg === null) {
        epsg = it.epsg;
        v = ventana([x1, y1, x2, y2], it.epsg);
      }
      if (!v) return;
      try {
        const r = await recorte(it, v);
        if (!r || r.vacio > TOPE_VACIO || r.nube > TOPE_NUBE) continue;
        if (!mejor || r.bruma < mejor.r.bruma) mejor = { it, r };
        if (r.bruma <= TOPE_BRUMA) break;
      } catch (e: any) {
        console.warn('[timelapse]', it.id, String(e?.message || e).slice(0, 120));
      }
    }
    if (mejor) cuadros[i] = { fecha: mejor.it.fecha, nubes: Math.round(mejor.r.nube * 1000) / 10, escena: mejor.it.id, img: aJpeg(mejor.r.rgb) };
  };
  // El año más reciente con escenas fija la proyección; después, los demás de a tres.
  const conEscenas = anios.map((_, i) => i).filter((i) => candidatos[i].length);
  if (!conEscenas.length) return { error: 'No encontré escenas de Sentinel-2 sin nubes que cubran esta concesión.' };
  const primero = conEscenas[conEscenas.length - 1];
  await uno(primero);
  const cola = conEscenas.filter((i) => i !== primero);
  await Promise.all(
    [0, 1, 2].map(async () => {
      while (cola.length) await uno(cola.shift()!);
    })
  );
  const listos = cuadros.filter((x): x is Cuadro => !!x);
  if (!listos.length || !v || epsg === null) return { error: 'Las escenas de esta zona salieron nubladas o sin datos en todos los años.' };
  // El contorno de la concesión en píxeles del cuadro.
  const p = utm(epsg)!;
  const [vx1, vy1, vx2, vy2] = v as [number, number, number, number];
  const contorno = anillos(geo.geojson).map((r) =>
    r.map(([lon, lat]) => {
      const [x, y] = proj4('EPSG:4326', p, [lon, lat]);
      return [Math.round(((x - vx1) / (vx2 - vx1)) * LADO * 10) / 10, Math.round(((vy2 - y) / (vy2 - vy1)) * LADO * 10) / 10];
    })
  );
  const t: Timelapse = {
    cuadros: listos,
    ancho: LADO,
    alto: LADO,
    contorno,
    fuente: 'Copernicus Sentinel-2 L2A (ESA), color verdadero, por Element 84 Earth Search · AWS Open Data',
    faltan: anios.filter((_, i) => !cuadros[i]),
  };
  cache.set(id, { at: Date.now(), t });
  while (cache.size > 30) cache.delete(cache.keys().next().value as number);
  return t;
}

export function montarRutasTimelapse(app: Express) {
  app.get('/api/electrum/concesion/:id/timelapse', exigirPlataforma('electrum'), limitar(8), async (req: Request, res: Response) => {
    if (!hayBase()) return res.status(503).json({ error: 'El catastro no está conectado en este servidor.', honesto: true });
    const id = Math.floor(Number(req.params.id));
    if (!(id > 0)) return res.status(400).json({ error: 'Id inválido.', honesto: true });
    try {
      const t = await timelapseConcesion(id);
      if ('error' in t) return res.status(404).json({ error: t.error, honesto: true });
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.json({ ...t, honesto: true });
    } catch (e: any) {
      console.error('[timelapse]', String(e?.message || e).slice(0, 200));
      return res.status(502).json({ error: 'No pude leer las imágenes de Sentinel-2 ahora. Probá en un rato.', honesto: true });
    }
  });
}
