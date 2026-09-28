/**
 * LA CONCESIÓN FUERA DE LA APLICACIÓN — vértices y archivos para otros programas.
 *
 *  · Vértices en tres sistemas: lat/lon WGS84, UTM 16N WGS84 (el del GPS) y UTM 16N NAD27 (el de
 *    los mapas 1:50 000 de Honduras y muchos expedientes), para la ficha y para CSV.
 *  · KML para Google Earth, GeoJSON para cualquier SIG, DXF en metros UTM para AutoCAD.
 *
 * NAD27 va con el cambio de datum de Centroamérica publicado por NIMA (TR8350.2: ΔX 0, ΔY 125,
 * ΔZ 194 m), el mismo que usa el mapa: precisión de algunos metros, la del propio cambio de datum.
 */
import type { Express, Request, Response } from 'express';
import type { Geometry, Position } from 'geojson';
import proj4 from 'proj4';
import { exigirPlataforma, limitar } from '../seguridad';
import { consulta, geometriaDe, hayBase } from './db';

const UTM16_WGS = '+proj=utm +zone=16 +datum=WGS84 +units=m +no_defs';
const UTM16_NAD27 = '+proj=utm +zone=16 +ellps=clrk66 +towgs84=0,125,194,0,0,0,0 +units=m +no_defs';

export type Vertice = { n: number; parte: number; lon: number; lat: number; e: number; nn: number; e27: number; n27: number };

/** Los anillos exteriores de cada polígono (sin repetir el vértice de cierre). */
function anillos(g: Geometry): Position[][] {
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0]);
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(anillos);
  return [];
}

export function verticesDe(g: Geometry): Vertice[] {
  const out: Vertice[] = [];
  anillos(g).forEach((anillo, parte) => {
    const r = anillo.length > 1 && anillo[0][0] === anillo[anillo.length - 1][0] && anillo[0][1] === anillo[anillo.length - 1][1] ? anillo.slice(0, -1) : anillo;
    for (const [lon, lat] of r) {
      const [e, nn] = proj4('EPSG:4326', UTM16_WGS, [lon, lat]);
      const [e27, n27] = proj4('EPSG:4326', UTM16_NAD27, [lon, lat]);
      out.push({ n: out.length + 1, parte: parte + 1, lon, lat, e, nn, e27, n27 });
    }
  });
  return out;
}

const escXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

export function kml(nombre: string, g: Geometry, datos: Array<[string, string]>): string {
  const polis = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const anillo = (r: Position[]) => r.map(([x, y]) => `${x.toFixed(7)},${y.toFixed(7)},0`).join(' ');
  const poligonos = polis
    .map(
      (p) =>
        `<Polygon><outerBoundaryIs><LinearRing><coordinates>${anillo(p[0])}</coordinates></LinearRing></outerBoundaryIs>${p
          .slice(1)
          .map((h) => `<innerBoundaryIs><LinearRing><coordinates>${anillo(h)}</coordinates></LinearRing></innerBoundaryIs>`)
          .join('')}</Polygon>`
    )
    .join('');
  const extendido = datos.map(([k, v]) => `<Data name="${escXml(k)}"><value>${escXml(v)}</value></Data>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><name>${escXml(nombre)}</name>
<Style id="concesion"><LineStyle><color>ff3baeff</color><width>3</width></LineStyle><PolyStyle><color>553baeff</color></PolyStyle></Style>
<Placemark><name>${escXml(nombre)}</name><styleUrl>#concesion</styleUrl><ExtendedData>${extendido}</ExtendedData><MultiGeometry>${poligonos}</MultiGeometry></Placemark>
</Document></kml>
`;
}

/**
 * DXF R12 (el más compatible: AutoCAD, QGIS, LibreCAD), en metros UTM 16N WGS84: una POLYLINE
 * cerrada por anillo en la capa CONCESION y el número de cada vértice en la capa VERTICES.
 */
export function dxf(nombre: string, g: Geometry): string {
  const L: string[] = [];
  const par = (c: number | string, v: number | string) => L.push(String(c), typeof v === 'number' ? v.toFixed(3) : v);
  par(0, 'SECTION');
  par(2, 'HEADER');
  par(9, '$ACADVER');
  par(1, 'AC1009');
  par(0, 'ENDSEC');
  par(0, 'SECTION');
  par(2, 'ENTITIES');
  const polis = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let n = 0;
  for (const p of polis) {
    p.forEach((anillo, i) => {
      par(0, 'POLYLINE');
      par(8, i === 0 ? 'CONCESION' : 'HUECO');
      par(66, 1);
      par(70, 1);
      const r = anillo.slice(0, -1);
      for (const [lon, lat] of r) {
        const [e, nn] = proj4('EPSG:4326', UTM16_WGS, [lon, lat]);
        par(0, 'VERTEX');
        par(8, i === 0 ? 'CONCESION' : 'HUECO');
        par(10, e);
        par(20, nn);
        par(30, 0);
      }
      par(0, 'SEQEND');
      if (i === 0) {
        for (const [lon, lat] of r) {
          const [e, nn] = proj4('EPSG:4326', UTM16_WGS, [lon, lat]);
          par(0, 'TEXT');
          par(8, 'VERTICES');
          par(10, e);
          par(20, nn);
          par(30, 0);
          par(40, 5);
          par(1, String(++n));
        }
      }
    });
  }
  par(0, 'TEXT');
  par(8, 'ROTULO');
  const [cx, cy] = polis.length ? proj4('EPSG:4326', UTM16_WGS, polis[0][0][0] as [number, number]) : [0, 0];
  par(10, cx);
  par(20, cy + 20);
  par(30, 0);
  par(40, 12);
  par(1, nombre.replace(/[\r\n]/g, ' ').slice(0, 120));
  par(0, 'ENDSEC');
  par(0, 'EOF');
  return L.join('\r\n') + '\r\n';
}

export function csvVertices(v: Vertice[]): string {
  const filas = v.map((x) => [x.n, x.parte, x.lat.toFixed(7), x.lon.toFixed(7), x.e.toFixed(2), x.nn.toFixed(2), x.e27.toFixed(2), x.n27.toFixed(2)].join(','));
  return ['vertice,parte,lat_wgs84,lon_wgs84,este_utm16_wgs84,norte_utm16_wgs84,este_utm16_nad27,norte_utm16_nad27', ...filas].join('\r\n') + '\r\n';
}

/** Un nombre de archivo sin caracteres raros. */
export const nombreArchivo = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'concesion';

export function montarRutasExportar(app: Express) {
  app.get('/api/electrum/concesion/:id/exportar', exigirPlataforma('electrum'), limitar(30), async (req: Request, res: Response) => {
    if (!hayBase()) return res.status(503).json({ error: 'El catastro no está conectado en este servidor.', honesto: true });
    const id = Math.floor(Number(req.params.id));
    const formato = String(req.query.formato || '').toLowerCase();
    if (!(id > 0)) return res.status(400).json({ error: 'Id inválido.', honesto: true });
    if (!['kml', 'geojson', 'dxf', 'csv'].includes(formato)) return res.status(400).json({ error: 'Formato: kml, geojson, dxf o csv.', honesto: true });
    try {
      const [c] = await consulta<{ nombre: string; titular: string | null; expediente: string | null; estado: string | null; ha: number | null }>(
        `SELECT nombre, titular, expediente, estado, hectareas::float8 AS ha FROM concesion WHERE id = $1`,
        [id]
      );
      const geo = c ? await geometriaDe(id) : null;
      if (!c || !geo) return res.status(404).json({ error: 'Esa concesión no está o no tiene geometría.', honesto: true });
      const datos: Array<[string, string]> = [
        ['id', String(id)],
        ['expediente', c.expediente || ''],
        ['titular', c.titular || ''],
        ['estado', c.estado || ''],
        ['hectareas_catastro', c.ha != null ? String(c.ha) : ''],
        ['fuente', 'Dr Electrum FP'],
      ];
      const base = nombreArchivo(c.nombre);
      let cuerpo: string;
      let tipo: string;
      if (formato === 'kml') {
        cuerpo = kml(c.nombre, geo.geojson, datos);
        tipo = 'application/vnd.google-earth.kml+xml';
      } else if (formato === 'geojson') {
        cuerpo = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geo.geojson, properties: { nombre: c.nombre, ...Object.fromEntries(datos) } }] });
        tipo = 'application/geo+json';
      } else if (formato === 'dxf') {
        cuerpo = dxf(c.nombre, geo.geojson);
        tipo = 'application/dxf';
      } else {
        cuerpo = csvVertices(verticesDe(geo.geojson));
        tipo = 'text/csv; charset=utf-8';
      }
      res.setHeader('Content-Type', tipo);
      res.setHeader('Content-Disposition', `attachment; filename="${base}.${formato === 'csv' ? 'vertices.csv' : formato}"`);
      return res.send(cuerpo);
    } catch (e: any) {
      console.error('[exportar]', String(e?.message || e).slice(0, 200));
      return res.status(500).json({ error: 'No pude armar el archivo.', honesto: true });
    }
  });
}
