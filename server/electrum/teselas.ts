/**
 * LAS TESELAS PROPIAS — el mapa base y los mapas escaneados, servidos desde el cubo.
 *
 * Todo en archivos PMTiles: un solo archivo por mapa con todas sus teselas adentro, que el mapa lee
 * a pedacitos pidiendo tramos de bytes (Range). Nada de miles de archivitos ni de un servidor de
 * teselas aparte, y nada de depender de teselas ajenas: las de calles de OpenStreetMap contestaban
 * 403 a esta aplicación, y el fondo «calles» quedaba negro.
 *
 *  - `honduras.pmtiles`: el mapa base vectorial (Protomaps, datos de OpenStreetMap), Honduras hasta
 *    zoom 15.
 *  - Un archivo por mapa escaneado y georreferenciado (los de JICA), en raster.
 *
 * Viven en `biblioteca/teselas/` del cubo de expedientes (privado) y pasan por aquí, con la misma
 * sesión que el resto de Dr Electrum. `indice.json`, al lado, dice qué mapas escaneados hay, con su
 * nombre, su fuente y su encuadre.
 */
import type { Express, Request, Response } from 'express';
import { exigirPlataforma, limitar } from '../seguridad';
import { bajarExpediente, bucketExpedientes, tramoExpediente } from '../../lib/s3';

const PREFIJO = 'biblioteca/teselas/';
const NOMBRE = /^[a-z0-9][a-z0-9-]{0,80}\.pmtiles$/;
/** Lo más que se sirve de una vez. El cliente de PMTiles pide 16 KB de cabecera y tramos chicos. */
const TRAMO_MAX = 8 * 1024 * 1024;

/*
 * Una memoria corta de tramos. El directorio de un PMTiles se pide en cada vista y las teselas de
 * zoom bajo las ve todo el mundo: guardarlas ahorra un viaje al cubo por tesela. Con tope de peso,
 * porque el servidor tiene 512 MB.
 */
const MEMORIA_MAX = 24 * 1024 * 1024;
/** Si un mapa se vuelve a subir, sus tramos viejos no pueden mezclarse con los nuevos más de esto. */
const MEMORIA_MS = 10 * 60_000;
type Tramo = { datos: Buffer; total: number; etag: string | null; cuando?: number };
const memoria = new Map<string, Tramo>();
let memoriaPeso = 0;

function recordar(k: string, v: Tramo) {
  if (v.datos.length > 2 * 1024 * 1024) return;
  const antes = memoria.get(k);
  if (antes) {
    memoria.delete(k);
    memoriaPeso -= antes.datos.length;
  }
  memoria.set(k, { ...v, cuando: Date.now() });
  memoriaPeso += v.datos.length;
  for (const [kk, vv] of memoria) {
    if (memoriaPeso <= MEMORIA_MAX) break;
    memoria.delete(kk);
    memoriaPeso -= vv.datos.length;
  }
}

function leido(k: string) {
  const v = memoria.get(k);
  if (v && Date.now() - (v.cuando ?? 0) > MEMORIA_MS) {
    memoria.delete(k);
    memoriaPeso -= v.datos.length;
    return undefined;
  }
  if (v) {
    // El más reciente al final: lo que sale primero es lo que menos se usa.
    memoria.delete(k);
    memoria.set(k, v);
  }
  return v;
}

/** Solo para pruebas. */
export function olvidarTeselas() {
  memoria.clear();
  memoriaPeso = 0;
  indice = null;
}

export type RasterEscaneado = {
  clave: string;
  nombre: string;
  fuente?: string;
  escala?: string;
  /** [oeste, sur, este, norte] en grados. */
  encuadre: [number, number, number, number];
  zoomMax?: number;
  notas?: string;
};

let indice: { cuando: number; rasters: RasterEscaneado[]; base: boolean } | null = null;

/** Qué mapas escaneados hay (y si está el mapa base), del `indice.json` del cubo. Cinco minutos de memoria. */
export async function indiceTeselas(): Promise<{ rasters: RasterEscaneado[]; base: boolean }> {
  if (indice && Date.now() - indice.cuando < 5 * 60_000) return indice;
  if (!bucketExpedientes()) return { rasters: [], base: false };
  const r = await bajarExpediente(`${PREFIJO}indice.json`);
  let rasters: RasterEscaneado[] = [];
  let base = false;
  if (r.ok) {
    try {
      const j = JSON.parse(r.datos.toString('utf8'));
      base = !!j.base;
      rasters = (Array.isArray(j.rasters) ? j.rasters : []).filter(
        (x: any) =>
          x &&
          typeof x.clave === 'string' &&
          NOMBRE.test(`${x.clave}.pmtiles`) &&
          typeof x.nombre === 'string' &&
          Array.isArray(x.encuadre) &&
          x.encuadre.length === 4 &&
          x.encuadre.every((n: unknown) => Number.isFinite(Number(n)))
      );
    } catch {
      console.error('[teselas] indice.json no es JSON válido');
    }
  }
  indice = { cuando: Date.now(), rasters, base };
  return indice;
}

export function montarRutasTeselas(app: Express) {
  const E = exigirPlataforma('electrum');

  app.get('/api/electrum/mapa/rasters', E, limitar(60), async (_req: Request, res: Response) => {
    try {
      const { rasters, base } = await indiceTeselas();
      return res.json({ rasters, base, honesto: true });
    } catch (e: any) {
      console.error('[teselas] índice:', String(e?.message || e).slice(0, 160));
      return res.json({ rasters: [], base: false, honesto: true });
    }
  });

  // Un mapa pide decenas de tramos al moverse: el tope es por archivo y por minuto, y generoso.
  app.get('/api/electrum/teselas/:archivo', E, limitar(3000, 60_000, 'teselas'), async (req: Request, res: Response) => {
    const archivo = String(req.params.archivo || '');
    if (!NOMBRE.test(archivo)) return res.status(404).json({ error: 'No existe ese archivo de teselas.', honesto: true });
    if (!bucketExpedientes()) return res.status(503).json({ error: 'Falta el cubo de expedientes en el servidor.', honesto: true });
    const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range || ''));
    if (!m) return res.status(416).json({ error: 'Las teselas se piden por tramos (Range: bytes=a-b).', honesto: true });
    const desde = Number(m[1]);
    const hasta = Number(m[2]);
    if (!(hasta >= desde) || hasta - desde + 1 > TRAMO_MAX) {
      return res.status(416).json({ error: `Tramo inválido (máximo ${TRAMO_MAX} bytes).`, honesto: true });
    }
    const k = `${archivo}:${desde}-${hasta}`;
    let v = leido(k);
    if (!v) {
      const r = await tramoExpediente(PREFIJO + archivo, desde, hasta);
      if (!r.ok) {
        if (r.status === 404) return res.status(404).json({ error: 'Ese mapa no está en el cubo.', honesto: true });
        if (r.status === 416) return res.status(416).json({ error: 'Ese tramo está fuera del archivo.', honesto: true });
        console.error('[teselas]', archivo, r.detalle);
        return res.status(502).json({ error: 'No pude leer el mapa del cubo.', honesto: true });
      }
      v = { datos: r.datos, total: r.total ?? desde + r.datos.length, etag: r.etag };
      recordar(k, v);
    }
    res.status(206);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Range', `bytes ${desde}-${desde + v.datos.length - 1}/${v.total}`);
    res.setHeader('Content-Length', String(v.datos.length));
    if (v.etag) res.setHeader('ETag', v.etag);
    // Privado (va con sesión) pero se puede guardar: un PMTiles no cambia sin cambiar de ETag.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.end(v.datos);
  });
}
