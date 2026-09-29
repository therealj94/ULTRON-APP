/**
 * NAD27 Y WGS84: LOS DOS SISTEMAS CON LOS QUE SE TRABAJA EN HONDURAS.
 *
 *  · INHGEOMIN recibe los planos en NAD27 / UTM, con la cuadrícula en coordenadas que terminan en
 *    múltiplos de 100 (los mapas 1:50 000 del IGN y el catastro histórico están así).
 *  · ICF y SERNA (MiAmbiente) los reciben en WGS84 / UTM, que es el del GPS.
 *
 * El cambio de datum es el de NAD27 para Centroamérica (NIMA TR8350.2: ΔX 0, ΔY 125, ΔZ 194 m),
 * el mismo que usan la importación de shapefiles (gis.ts) y los vértices de la ficha (exportar.ts).
 * Precisión: algunos metros, la del propio cambio de datum publicado. Entre un sistema y otro, en
 * Honduras, el mismo punto se corre unos 200 a 230 m: por eso un plano con el datum equivocado
 * pone el lindero en el terreno del vecino.
 *
 * Zona UTM: casi todo el país cae en la 16; el extremo oriental de Gracias a Dios (al este de
 * 84° O) cae en la 17. El catastro usa la 16 para todo, y eso es lo que se hace por omisión.
 */
import proj4 from 'proj4';
import type { Geometry, Position } from 'geojson';

export type Datum = 'WGS84' | 'NAD27';
export type Forma = 'utm' | 'geo';
export type Sistema = { datum: Datum; forma: Forma; zona?: 16 | 17 };

const NAD27_CA = '+towgs84=0,125,194,0,0,0,0';

function definicion(s: Sistema): string {
  if (s.forma === 'geo') return s.datum === 'WGS84' ? '+proj=longlat +datum=WGS84 +no_defs' : `+proj=longlat +ellps=clrk66 ${NAD27_CA} +no_defs`;
  const z = s.zona ?? 16;
  return s.datum === 'WGS84' ? `+proj=utm +zone=${z} +datum=WGS84 +units=m +no_defs` : `+proj=utm +zone=${z} +ellps=clrk66 ${NAD27_CA} +units=m +no_defs`;
}

/** Nombre corto y EPSG, para rotular planos y tablas. */
export function nombreSistema(s: Sistema): string {
  const z = s.zona ?? 16;
  if (s.forma === 'geo') return s.datum === 'WGS84' ? 'WGS 84 geográficas (EPSG:4326)' : 'NAD27 geográficas (EPSG:4267)';
  return s.datum === 'WGS84' ? `WGS 84 / UTM zona ${z}N (EPSG:326${z})` : `NAD27 / UTM zona ${z}N (EPSG:267${z})`;
}

/** Pasa un punto de un sistema a otro. En geográficas el orden es [lon, lat]; en UTM, [este, norte]. */
export function convertir(p: [number, number], desde: Sistema, hacia: Sistema): [number, number] {
  const [x, y] = proj4(definicion(desde), definicion(hacia), [p[0], p[1]]);
  return [x, y];
}

/** El sistema que pide cada institución. */
export function sistemaPara(institucion: string | null | undefined): Sistema {
  const i = String(institucion || '').toUpperCase();
  if (/INHGEOMIN|DEFOMIN|MINER/.test(i)) return { datum: 'NAD27', forma: 'utm', zona: 16 };
  return { datum: 'WGS84', forma: 'utm', zona: 16 };
}

/** La zona UTM de una longitud en Honduras (la 17 solo al este de 84° O). */
export function zonaDe(lon: number): 16 | 17 {
  return lon > -84 ? 17 : 16;
}

/** Aplica una función a cada coordenada de una geometría (sin tocar la original). */
export function mapearGeometria(g: Geometry, f: (p: Position) => Position): Geometry {
  switch (g.type) {
    case 'Point':
      return { ...g, coordinates: f(g.coordinates) };
    case 'MultiPoint':
    case 'LineString':
      return { ...g, coordinates: g.coordinates.map(f) } as Geometry;
    case 'MultiLineString':
    case 'Polygon':
      return { ...g, coordinates: g.coordinates.map((r) => r.map(f)) } as Geometry;
    case 'MultiPolygon':
      return { ...g, coordinates: g.coordinates.map((p) => p.map((r) => r.map(f))) };
    case 'GeometryCollection':
      return { ...g, geometries: g.geometries.map((x) => mapearGeometria(x, f)) };
  }
}

const UTM16_WGS: Sistema = { datum: 'WGS84', forma: 'utm', zona: 16 };
const UTM16_NAD27: Sistema = { datum: 'NAD27', forma: 'utm', zona: 16 };

/** De WGS84/UTM16 a NAD27/UTM16 (lo que usa el plano para dibujarse en NAD27). */
export function utmWgsANad27(p: Position): Position {
  const [e, n] = convertir([p[0], p[1]], UTM16_WGS, UTM16_NAD27);
  return [e, n];
}

/**
 * Entiende cómo se escribe el sistema en una conversación: «NAD27», «nad 27 utm», «WGS84
 * geográficas», «grados», «lat/lon»… Por omisión UTM zona 16.
 */
export function leerSistema(texto: string | null | undefined): Sistema | null {
  const t = String(texto || '').toLowerCase().replace(/\s+/g, ' ');
  if (!t.trim()) return null;
  const datum: Datum | null = /nad ?-?27|1927/.test(t) ? 'NAD27' : /wgs ?-?84|gps|4326|326/.test(t) ? 'WGS84' : null;
  if (!datum) return null;
  const forma: Forma = /geo|grado|lat|lon|decimal|°|4326|4267/.test(t) ? 'geo' : 'utm';
  const zona = /\b17\b|zona 17|17 ?n/.test(t) ? 17 : 16;
  return { datum, forma, zona };
}
