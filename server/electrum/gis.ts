/**
 * MOTOR GIS DE ELECTRUM — de un archivo que alguien manda por correo a geometría en la que se puede confiar.
 *
 * Lo difícil de un catastro no es dibujar polígonos: es que los números sean ciertos.
 *
 *  - **Proyección.** Los shapefiles del catastro hondureño vienen en UTM 16N (EPSG:32616), y muchos
 *    viejos en NAD27. Si se ignora el `.prj`, las coordenadas se leen como grados y las concesiones
 *    aterrizan en mitad del Atlántico. Aquí siempre se reproyecta a WGS84 (EPSG:4326), y si el
 *    archivo no dice en qué proyección está, se avisa en vez de adivinar.
 *  - **Área.** El área planar que trae el `.dbf` está medida sobre la cuadrícula UTM, que deforma.
 *    Un cuadrado de 2.000 x 2.000 m en UTM no encierra 400 hectáreas de suelo, encierra 400,3.
 *    Electrum reporta el área geodésica y, cuando difiere de la declarada, lo dice.
 *  - **Traslapes.** Dos concesiones que se pisan es el problema número uno de cualquier catastro y
 *    lo que nadie ve mirando un mapa bonito. Se calcula de verdad, con recorte de polígonos.
 *
 * Formatos que entran: shapefile (.zip con .shp/.dbf/.shx/.prj, o los sueltos), GeoJSON, KML, KMZ y
 * CSV con columnas de coordenadas. Todo sale como la misma `Capa`.
 */
import proj4 from 'proj4';
import JSZip from 'jszip';
import { kml as kmlAGeojson } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

export type Aviso = { nivel: 'info' | 'ojo' | 'error'; texto: string };

export type Capa = {
  /** Nombre con el que se subió, sin extensión. */
  nombre: string;
  /** Siempre WGS84 (EPSG:4326). */
  geojson: FeatureCollection;
  /** De dónde salió: 'shapefile', 'geojson', 'kml', 'kmz', 'csv'. */
  formato: string;
  /** Sistema de coordenadas del archivo original, tal como lo declaraba. */
  origenCrs: string;
  /** Cuántas geometrías entraron y cuántas se descartaron por venir rotas. */
  entidades: number;
  descartadas: number;
};

export type Ingesta = { capa: Capa | null; avisos: Aviso[] };

const HECTAREA_M2 = 10_000;

/* ------------------------------------------------------------------ geometría */

/* --- área sobre el elipsoide WGS84 ---------------------------------------------------------- */

const A_WGS84 = 6378137.0; // semieje mayor
const F_WGS84 = 1 / 298.257223563; // achatamiento
const E2 = F_WGS84 * (2 - F_WGS84); // primera excentricidad al cuadrado
const E = Math.sqrt(E2);

/** q(φ) de Snyder: la integral que convierte latitud geodésica en área acumulada sobre el elipsoide. */
function qDe(sinPhi: number): number {
  return (
    (1 - E2) *
    (sinPhi / (1 - E2 * sinPhi * sinPhi) - (1 / (2 * E)) * Math.log((1 - E * sinPhi) / (1 + E * sinPhi)))
  );
}

const Q_POLO = qDe(1);
/** Radio de la esfera autálica: la esfera que encierra la misma área que el elipsoide. */
const R_AUTALICO = A_WGS84 * Math.sqrt(Q_POLO / 2);

/** Latitud autálica: la que hay que usar para que el área en la esfera sea la del elipsoide. */
function senoAutalico(latGrados: number): number {
  const s = Math.sin((latGrados * Math.PI) / 180);
  const r = qDe(s) / Q_POLO;
  return r > 1 ? 1 : r < -1 ? -1 : r;
}

/** Área con signo de un anillo, en metros cuadrados, por excedente esférico sobre la esfera autálica. */
function areaAnillo(anillo: Position[]): number {
  if (anillo.length < 4) return 0;
  let suma = 0;
  for (let i = 0; i < anillo.length - 1; i++) {
    const [lon1, lat1] = anillo[i];
    const [lon2, lat2] = anillo[i + 1];
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    suma += dLon * (2 + senoAutalico(lat1) + senoAutalico(lat2));
  }
  return (suma * R_AUTALICO * R_AUTALICO) / 2;
}

function areaGeometria(g: any): number {
  if (!g) return 0;
  switch (g.type) {
    case 'Polygon':
      // El primer anillo es el exterior; los demás son huecos y restan.
      return g.coordinates.reduce((acc: number, anillo: Position[], i: number) => {
        const a = Math.abs(areaAnillo(anillo));
        return i === 0 ? a : acc - a;
      }, 0);
    case 'MultiPolygon':
      return g.coordinates.reduce((acc: number, poly: Position[][]) => acc + areaGeometria({ type: 'Polygon', coordinates: poly }), 0);
    case 'GeometryCollection':
      return (g.geometries || []).reduce((acc: number, x: any) => acc + areaGeometria(x), 0);
    case 'Feature':
      return areaGeometria(g.geometry);
    default:
      return 0;
  }
}

/**
 * Área en hectáreas sobre el elipsoide WGS84, no sobre una esfera y no sobre la cuadrícula.
 *
 * Importa más de lo que parece. El área planar del `.dbf` está medida en la cuadrícula UTM, que a
 * 45 km del meridiano central encoge todo un 0,04 %: un cuadrado de 2.000 x 2.000 m «de 400 ha»
 * encierra en realidad 400,30 ha de suelo. Y la fórmula esférica que traen las librerías comunes
 * (radio único de 6.371 km) se pasa otro 0,37 % a la latitud de Honduras, porque el elipsoide es
 * más achatado de lo que una esfera admite: daría 401,78 ha. Hectárea y media de diferencia en una
 * sola concesión, que es exactamente por lo que se pelean dos titulares.
 *
 * Aquí se usa la esfera autálica —la que encierra la misma área que el elipsoide— con las latitudes
 * transformadas (Snyder, «Map Projections: A Working Manual»). Error por debajo del metro cuadrado
 * en un polígono de este tamaño.
 */
export function areaHectareas(geo: Geometry | Feature): number {
  try {
    return areaGeometria(geo) / HECTAREA_M2;
  } catch {
    return NaN;
  }
}

/** Perímetro en kilómetros. */
export function perimetroKm(geo: Geometry | Feature): number {
  try {
    const g: any = (geo as Feature).type === 'Feature' ? (geo as Feature).geometry : geo;
    const lineas = turf.polygonToLine(turf.feature(g) as any);
    return turf.length(lineas as any, { units: 'kilometers' });
  } catch {
    return NaN;
  }
}

/** Traslape entre dos polígonos, en hectáreas. Cero si no se tocan. */
export function traslapeHectareas(a: Geometry | Feature, b: Geometry | Feature): number {
  try {
    const fa = turf.feature(((a as Feature).geometry || a) as any);
    const fb = turf.feature(((b as Feature).geometry || b) as any);
    const corte = turf.intersect(turf.featureCollection([fa, fb]) as any);
    // Se mide con la misma vara que todo lo demás: elipsoide, no esfera.
    return corte ? areaHectareas(corte.geometry as Geometry) : 0;
  } catch {
    return 0;
  }
}

/** Distancia en kilómetros entre dos puntos [lon, lat]. */
export function distanciaKm(a: Position, b: Position): number {
  return turf.distance(turf.point(a as any), turf.point(b as any), { units: 'kilometers' });
}

/** ¿Este punto [lon, lat] cae dentro del polígono? */
export function puntoDentro(punto: Position, poligono: Geometry | Feature): boolean {
  try {
    const g: any = (poligono as Feature).geometry || poligono;
    return turf.booleanPointInPolygon(turf.point(punto as any), turf.feature(g) as any);
  } catch {
    return false;
  }
}

/** Centro de masa: a dónde vuela el mapa cuando Electrum nombra una concesión. */
export function centro(geo: Geometry | Feature): Position {
  const g: any = (geo as Feature).geometry || geo;
  return turf.centerOfMass(turf.feature(g) as any).geometry.coordinates as Position;
}

/** Caja envolvente [oeste, sur, este, norte], para encuadrar el mapa. */
export function encuadre(geo: Geometry | Feature | FeatureCollection): [number, number, number, number] {
  return turf.bbox(geo as any) as [number, number, number, number];
}

/**
 * Todos los pares que se pisan dentro de una capa. Es la consulta que de verdad se le pide a un
 * catastro y la que nadie hace hasta que hay un pleito.
 */
export function traslapesEnCapa(
  capa: Capa,
  minimoHa = 0.01
): Array<{ a: number; b: number; nombreA: string; nombreB: string; hectareas: number }> {
  const fs = capa.geojson.features.filter((f) => f.geometry && /Polygon/.test(f.geometry.type));
  const salida: Array<{ a: number; b: number; nombreA: string; nombreB: string; hectareas: number }> = [];
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      // Descarte rápido por caja envolvente: sin esto, un catastro nacional no termina nunca.
      if (!cajasSeTocan(encuadre(fs[i]), encuadre(fs[j]))) continue;
      const ha = traslapeHectareas(fs[i], fs[j]);
      if (ha >= minimoHa) {
        salida.push({ a: i, b: j, nombreA: etiqueta(fs[i], i), nombreB: etiqueta(fs[j], j), hectareas: ha });
      }
    }
  }
  return salida.sort((x, y) => y.hectareas - x.hectareas);
}

function cajasSeTocan(a: [number, number, number, number], b: [number, number, number, number]) {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

/** El nombre con el que un humano llama a esta entidad, buscando entre los campos habituales. */
export function etiqueta(f: Feature, i = 0): string {
  const p = (f.properties || {}) as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (/^(nombre|name|nom|denominac|proyecto|concesion|concesión)/i.test(k) && p[k]) return String(p[k]);
  }
  for (const k of Object.keys(p)) {
    if (/^(expediente|exp|codigo|código|clave|id)/i.test(k) && p[k]) return String(p[k]);
  }
  return `entidad ${i + 1}`;
}

/* ------------------------------------------------------------------ ingesta */

const RE_EPSG = /\bEPSG[":\s]*(\d{4,6})/i;

/*
 * EL DATUM VIEJO: NAD27.
 *
 * Buena parte del catastro hondureño antiguo está en NAD27 / UTM 16N. proj4 reconoce el .prj, pero
 * para pasar de NAD27 a WGS84 busca las rejillas de corrimiento de Estados Unidos (NADCON), que no
 * vienen con la librería y que además no cubren Centroamérica: sin ellas NO aplica ningún
 * corrimiento y deja el datum igual. Medido sobre el cuadrado de prueba de Danlí: la concesión
 * quedaba unos 107 m al sur de donde está. Eso es media concesión chica, y basta para inventar un
 * traslape con la vecina cargada en WGS84 —o para esconder uno que existe—.
 *
 * El corrimiento que corresponde es el publicado para NAD27 en Centroamérica (Belice, Costa Rica,
 * El Salvador, Guatemala, Honduras, Nicaragua): ΔX = 0, ΔY = +125, ΔZ = +194 m (NIMA TR8350.2,
 * «North American 1927 — Central America»). Se inyecta como TOWGS84 en el .prj solo si el archivo
 * no trae uno propio: el que declara el archivo manda.
 */
const TOWGS84_NAD27_CA = 'TOWGS84[0,125,194,0,0,0,0]';
const AVISO_NAD27 =
  'El archivo está en NAD27: lo pasé a WGS84 con el corrimiento de NAD27 para Centroamérica (0, 125, 194 m). Sin él quedaba unos 100 m corrido al sur.';

export function conCorrimientoNad27(prj: string): string {
  const t = String(prj || '');
  if (!/North_American_1927|NAD[ _]?27|North American Datum 1927/i.test(t) || /TOWGS84/i.test(t)) return t;
  // Dentro del DATUM, justo después del SPHEROID[...] — que no tiene corchetes anidados.
  // El SPHEROID puede traer su propio AUTHORITY[...] dentro (WKT de OGC): se salta entero.
  return t.replace(/(DATUM\[[^\[]*SPHEROID\[[^\[\]]*(?:\[[^\]]*\][^\[\]]*)*\])/i, `$1,${TOWGS84_NAD27_CA}`);
}

/**
 * Los EPSG que proj4 no trae de fábrica y que aparecen en un catastro de Honduras (zonas UTM 16 y
 * 17, que es donde cae el país): NAD27 y NAD83 en UTM, y NAD27 geográfico. WGS84 / UTM (326xx) sí
 * los conoce proj4. Sin esto, un GeoJSON que declaraba «EPSG:26716» se quedaba sin reproyectar y
 * entraba en metros.
 */
function definirEpsg(epsg: number): boolean {
  const clave = `EPSG:${epsg}`;
  if (proj4.defs(clave)) return true;
  let def = '';
  if (epsg >= 26701 && epsg <= 26722) def = `+proj=utm +zone=${epsg - 26700} +ellps=clrk66 +towgs84=0,125,194,0,0,0,0 +units=m +no_defs`;
  else if (epsg >= 26901 && epsg <= 26923) def = `+proj=utm +zone=${epsg - 26900} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  else if (epsg === 4267) def = '+proj=longlat +ellps=clrk66 +towgs84=0,125,194,0,0,0,0 +no_defs';
  if (!def) return false;
  proj4.defs(clave, def);
  return true;
}

/** Lee el nombre y el código del sistema de coordenadas de un .prj, para poder decirlo en voz alta. */
export function leerPrj(prj: string): { nombre: string; epsg: number | null } {
  const texto = String(prj || '').trim();
  if (!texto) return { nombre: 'sin declarar', epsg: null };
  const nombre = /PROJCS\["([^"]+)"/i.exec(texto)?.[1] || /GEOGCS\["([^"]+)"/i.exec(texto)?.[1] || 'desconocido';
  const epsg = Number(RE_EPSG.exec(texto)?.[1]) || null;
  return { nombre: nombre.replace(/_/g, ' '), epsg };
}

/** ¿Estas coordenadas parecen grados? Si no, el archivo venía proyectado y nadie lo reproyectó. */
function pareceGrados(fc: FeatureCollection): boolean {
  for (const f of fc.features.slice(0, 20)) {
    const c = primeraCoordenada(f.geometry);
    if (!c) continue;
    if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) return false;
  }
  return true;
}

function primeraCoordenada(g: Geometry | null): Position | null {
  if (!g) return null;
  const anida = (x: any): Position | null => {
    if (!Array.isArray(x)) return null;
    if (typeof x[0] === 'number') return x as Position;
    for (const y of x) {
      const r = anida(y);
      if (r) return r;
    }
    return null;
  };
  return anida((g as any).coordinates);
}

/** Descarta lo que no tiene geometría usable, que en un catastro real es más común de lo que parece. */
function limpiar(fc: FeatureCollection): { fc: FeatureCollection; descartadas: number } {
  const buenas = fc.features.filter((f) => {
    if (!f?.geometry) return false;
    const c = primeraCoordenada(f.geometry);
    return !!c && isFinite(c[0]) && isFinite(c[1]);
  });
  return { fc: { type: 'FeatureCollection', features: buenas }, descartadas: fc.features.length - buenas.length };
}

/**
 * Un zip que se infla hasta ocupar la memoria del servidor no entra.
 *
 * El cargador acepta 64 MB comprimidos, y un zip bien armado de ese tamaño se descomprime en
 * gigabytes: `shpjs` y `JSZip` lo abren entero en memoria y Render mata el proceso —Dr Electrum
 * entero, para todos—. Se mira lo que declara cada entrada ANTES de descomprimir nada.
 */
const MAX_DESCOMPRIMIDO = 512 * 1024 * 1024;
const MAX_ENTRADAS = 5000;
export function revisarZip(zip: JSZip): void {
  const archivos = Object.values(zip.files);
  if (archivos.length > MAX_ENTRADAS) throw new Error(`el zip trae ${archivos.length} archivos; más de ${MAX_ENTRADAS} no es una capa`);
  const total = archivos.reduce((n, f: any) => n + (Number(f?._data?.uncompressedSize) || 0), 0);
  if (total > MAX_DESCOMPRIMIDO) {
    throw new Error(`descomprimido ocuparía ${Math.round(total / 1048576)} MB, más de lo que se puede abrir de una vez; partilo en varios`);
  }
}

const baseNombre = (n: string) => String(n || 'capa').replace(/\.[a-z0-9]+$/i, '').replace(/[\\/]/g, '_');

/**
 * Convierte lo que sea que hayan subido en una `Capa` en WGS84.
 * Nunca lanza: los problemas salen como avisos, porque el que sube un archivo necesita saber qué pasó.
 */
export async function ingerir(nombreArchivo: string, datos: Buffer): Promise<Ingesta> {
  return soloGrados(await ingerirCrudo(nombreArchivo, datos));
}

/**
 * Lo que no está en grados NO entra.
 *
 * Cada lector ya avisaba cuando las coordenadas venían en metros —un shapefile sin .prj, un CSV en
 * UTM—, pero devolvía la capa igual y quien llamaba la guardaba: «545000, 1551000» metido en una
 * columna de grados. Con un polígono eso reventaba la carga («numeric field overflow» al guardar un
 * área de millones de hectáreas); con puntos entraba sin error y quedaba a medio mundo de Honduras,
 * estirando el encuadre del mapa hasta dejar el catastro entero reducido a un punto. Un aviso que
 * no impide el daño no es una protección: la capa se rechaza y se dice por qué.
 */
function soloGrados(ing: Ingesta): Ingesta {
  const fc = ing.capa?.geojson;
  if (!fc || !fc.features.length || pareceGrados(fc)) return ing;
  const avisos = ing.avisos.some((a) => /no son grados/i.test(a.texto))
    ? ing.avisos
    : [...ing.avisos, { nivel: 'error' as const, texto: 'Las coordenadas no son grados: el archivo está proyectado y no dice en qué sistema.' }];
  avisos.push({
    nivel: 'error',
    texto:
      'No lo guardé: meter metros donde van grados deja las concesiones fuera del mapa y las áreas sin sentido. ' +
      'Mandámelo con su .prj, o exportado a WGS84 (EPSG:4326).',
  });
  return { capa: null, avisos };
}

async function ingerirCrudo(nombreArchivo: string, datos: Buffer): Promise<Ingesta> {
  const avisos: Aviso[] = [];
  const ext = (/\.([a-z0-9]+)$/i.exec(nombreArchivo)?.[1] || '').toLowerCase();
  const nombre = baseNombre(nombreArchivo);

  try {
    if (ext === 'zip' || ext === 'shp') return await ingerirShapefile(nombre, datos, avisos);
    if (ext === 'kmz') return await ingerirKmz(nombre, datos, avisos);
    if (ext === 'kml') return ingerirKml(nombre, datos.toString('utf8'), avisos, 'kml');
    if (ext === 'geojson' || ext === 'json') return ingerirGeojson(nombre, datos.toString('utf8'), avisos);
    if (ext === 'csv') return ingerirCsv(nombre, datos.toString('utf8'), avisos);
    if (ext === 'gpkg') {
      avisos.push({
        nivel: 'error',
        texto: 'GeoPackage (.gpkg) todavía no se lee aquí: es una base SQLite y necesita GDAL. Exportalo a shapefile o GeoJSON y lo tomo.',
      });
      return { capa: null, avisos };
    }
    if (ext === 'dxf') {
      avisos.push({
        nivel: 'error',
        texto: 'DXF todavía no se lee aquí: es dibujo CAD sin sistema de coordenadas declarado, hay que georreferenciarlo antes. Exportalo a shapefile.',
      });
      return { capa: null, avisos };
    }
    avisos.push({ nivel: 'error', texto: `No conozco el formato «${ext || 'sin extensión'}». Entran shapefile (.zip), GeoJSON, KML, KMZ y CSV.` });
    return { capa: null, avisos };
  } catch (e: any) {
    avisos.push({ nivel: 'error', texto: `No pude leer el archivo: ${String(e?.message || e).slice(0, 160)}` });
    return { capa: null, avisos };
  }
}

/**
 * `shpjs` está escrito para el navegador y toca `self` al cargarse, que en Node no existe: importarlo
 * arriba tumba el servidor al ARRANCAR, aunque nadie suba nunca un shapefile. Se carga a demanda y
 * con `self` puesto justo antes. Lo cazó el arranque del servidor compilado; con tsx no se ve.
 */
let shpCargado: any = null;
async function cargarShp() {
  if (shpCargado) return shpCargado;
  const g = globalThis as any;
  if (typeof g.self === 'undefined') g.self = g;
  shpCargado = (await import('shpjs')).default;
  return shpCargado;
}

async function ingerirShapefile(nombre: string, datos: Buffer, avisos: Aviso[]): Promise<Ingesta> {
  // shpjs reproyecta solo si encuentra el .prj; si no está, devuelve las coordenadas crudas.
  let prj = '';
  let paraLeer = datos;
  try {
    const zip = await JSZip.loadAsync(datos);
    revisarZip(zip);
    const archivoPrj = Object.keys(zip.files).find((f) => /\.prj$/i.test(f));
    if (archivoPrj) {
      prj = await zip.files[archivoPrj].async('text');
      const corregido = conCorrimientoNad27(prj);
      if (corregido !== prj) {
        // El .prj corregido va DENTRO del zip que lee shpjs: es él quien reproyecta.
        zip.file(archivoPrj, corregido);
        paraLeer = await zip.generateAsync({ type: 'nodebuffer' });
        avisos.push({ nivel: 'ojo', texto: AVISO_NAD27 });
      }
    }
  } catch (e: any) {
    // Un zip demasiado grande se rechaza; lo que no es zip es un .shp suelto y sigue.
    if (/descomprimido ocuparía|el zip trae/.test(String(e?.message))) throw e;
  }

  const shp = await cargarShp();
  const crudo: any = await shp(paraLeer as any);
  const colecciones: FeatureCollection[] = Array.isArray(crudo) ? crudo : [crudo];
  const features = colecciones.flatMap((c) => c?.features || []);
  const { fc, descartadas } = limpiar({ type: 'FeatureCollection', features });

  const info = leerPrj(prj);
  if (!prj) {
    avisos.push({
      nivel: 'ojo',
      texto: 'El shapefile venía sin .prj, así que nadie declara en qué proyección está. Lo leí tal cual: si las concesiones aparecen fuera de lugar, es esto. Pedí el .prj o decime la zona UTM.',
    });
  }
  if (fc.features.length && !pareceGrados(fc)) {
    avisos.push({
      nivel: 'error',
      texto: 'Las coordenadas no son grados: el archivo quedó proyectado y sin reproyectar. Sin el .prj correcto no puedo ubicarlo en el mapa.',
    });
  } else if (prj) {
    avisos.push({ nivel: 'info', texto: `Reproyectado desde ${info.nombre} a WGS84.` });
  }

  return {
    capa: {
      nombre,
      geojson: fc,
      formato: 'shapefile',
      origenCrs: prj ? info.nombre : 'sin declarar',
      entidades: fc.features.length,
      descartadas,
    },
    avisos: avisar(avisos, fc, descartadas),
  };
}

async function ingerirKmz(nombre: string, datos: Buffer, avisos: Aviso[]): Promise<Ingesta> {
  const zip = await JSZip.loadAsync(datos);
  revisarZip(zip);
  const archivo = Object.keys(zip.files).find((f) => /\.kml$/i.test(f));
  if (!archivo) {
    avisos.push({ nivel: 'error', texto: 'El KMZ no trae ningún .kml adentro.' });
    return { capa: null, avisos };
  }
  return ingerirKml(nombre, await zip.files[archivo].async('text'), avisos, 'kmz');
}

function ingerirKml(nombre: string, texto: string, avisos: Aviso[], formato: string): Ingesta {
  const doc = new DOMParser().parseFromString(texto, 'text/xml');
  const crudo = kmlAGeojson(doc as any) as FeatureCollection;
  const { fc, descartadas } = limpiar(crudo);
  // KML es WGS84 por definición del formato; no hay nada que reproyectar.
  return {
    capa: { nombre, geojson: fc, formato, origenCrs: 'WGS84 (KML siempre lo es)', entidades: fc.features.length, descartadas },
    avisos: avisar(avisos, fc, descartadas),
  };
}

function ingerirGeojson(nombre: string, texto: string, avisos: Aviso[]): Ingesta {
  const j = JSON.parse(texto);
  const crudo: FeatureCollection =
    j.type === 'FeatureCollection' ? j : j.type === 'Feature' ? { type: 'FeatureCollection', features: [j] } : { type: 'FeatureCollection', features: [] };

  // Un GeoJSON con "crs" viejo puede no ser WGS84, aunque la norma actual diga que siempre lo es.
  const crs = j?.crs?.properties?.name ? String(j.crs.properties.name) : '';
  const epsg = Number(RE_EPSG.exec(crs)?.[1]) || null;
  let fc = limpiar(crudo).fc;
  const descartadas = limpiar(crudo).descartadas;
  let origen = 'WGS84';
  if (epsg && epsg !== 4326) {
    try {
      definirEpsg(epsg);
      fc = reproyectar(fc, `EPSG:${epsg}`);
      origen = crs;
      avisos.push({ nivel: 'info', texto: `El GeoJSON declaraba ${crs}; lo reproyecté a WGS84.` });
    } catch {
      avisos.push({ nivel: 'ojo', texto: `El GeoJSON declara ${crs} y no sé reproyectar desde ahí. Lo dejo como viene.` });
    }
  } else if (fc.features.length && !pareceGrados(fc)) {
    avisos.push({ nivel: 'error', texto: 'El GeoJSON trae coordenadas que no son grados. Está proyectado y no declara en qué sistema.' });
  }

  return { capa: { nombre, geojson: fc, formato: 'geojson', origenCrs: origen, entidades: fc.features.length, descartadas }, avisos: avisar(avisos, fc, descartadas) };
}

/** CSV con columnas de longitud y latitud. Lo más humilde y lo que más se usa para mandar puntos. */
function ingerirCsv(nombre: string, texto: string, avisos: Aviso[]): Ingesta {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2) {
    avisos.push({ nivel: 'error', texto: 'El CSV no tiene filas de datos.' });
    return { capa: null, avisos };
  }
  const sep = (lineas[0].match(/;/g)?.length || 0) > (lineas[0].match(/,/g)?.length || 0) ? ';' : ',';
  const cab = lineas[0].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const iLon = cab.findIndex((c) => /^(lon|lng|longitud|longitude|x|este|easting)$/i.test(c));
  const iLat = cab.findIndex((c) => /^(lat|latitud|latitude|y|norte|northing)$/i.test(c));
  if (iLon < 0 || iLat < 0) {
    avisos.push({ nivel: 'error', texto: `El CSV no trae columnas de coordenadas reconocibles. Encontré: ${cab.join(', ')}. Necesito lon/lat o x/y.` });
    return { capa: null, avisos };
  }
  const features: Feature[] = [];
  let descartadas = 0;
  for (const l of lineas.slice(1)) {
    const celdas = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const lon = Number(celdas[iLon].replace(',', '.'));
    const lat = Number(celdas[iLat].replace(',', '.'));
    if (!isFinite(lon) || !isFinite(lat)) {
      descartadas++;
      continue;
    }
    const props: Record<string, string> = {};
    cab.forEach((c, i) => {
      if (i !== iLon && i !== iLat) props[c] = celdas[i] ?? '';
    });
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });
  }
  const fc: FeatureCollection = { type: 'FeatureCollection', features };
  if (features.length && !pareceGrados(fc)) {
    avisos.push({ nivel: 'ojo', texto: 'Las coordenadas del CSV no son grados: parecen UTM. Decime la zona y las convierto.' });
  }
  return { capa: { nombre, geojson: fc, formato: 'csv', origenCrs: 'WGS84 (asumido)', entidades: features.length, descartadas }, avisos: avisar(avisos, fc, descartadas) };
}

/** Reproyecta una colección entera desde un sistema conocido por proj4 hacia WGS84. */
export function reproyectar(fc: FeatureCollection, desde: string): FeatureCollection {
  const tr = (c: Position): Position => {
    const [x, y] = proj4(desde, 'EPSG:4326', [c[0], c[1]]);
    return c.length > 2 ? [x, y, c[2]] : [x, y];
  };
  const mapa = (x: any): any => (typeof x[0] === 'number' ? tr(x) : x.map(mapa));
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => ({
      ...f,
      geometry: f.geometry ? ({ ...f.geometry, coordinates: mapa((f.geometry as any).coordinates) } as Geometry) : f.geometry,
    })),
  };
}

function avisar(avisos: Aviso[], fc: FeatureCollection, descartadas: number): Aviso[] {
  if (!fc.features.length) avisos.push({ nivel: 'error', texto: 'El archivo no traía ninguna geometría usable.' });
  if (descartadas) avisos.push({ nivel: 'ojo', texto: `Descarté ${descartadas} ${descartadas === 1 ? 'entidad' : 'entidades'} sin geometría válida.` });
  return avisos;
}

/* ------------------------------------------------------------------ lectura humana */

const nf = (n: number, d = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

/**
 * Lo que Electrum dice al terminar de leer un archivo. No es un volcado de metadatos: es lo que un
 * geomático le diría a un colega, incluyendo lo que está mal.
 */
export function resumenCapa(capa: Capa, avisos: Aviso[] = []): string {
  const ha = capa.geojson.features.map((f) => areaHectareas(f)).filter((n) => isFinite(n) && n > 0);
  const total = ha.reduce((a, b) => a + b, 0);
  const partes = [`Leí ${capa.nombre}: ${capa.entidades} ${capa.entidades === 1 ? 'entidad' : 'entidades'} en formato ${capa.formato}, desde ${capa.origenCrs}.`];
  if (total > 0) partes.push(`Suman ${nf(total)} hectáreas de área real medida sobre el elipsoide.`);

  // Si el archivo declara hectáreas y no coinciden con las medidas, hay que decirlo.
  const declaradas = capa.geojson.features
    .map((f) => {
      const p = (f.properties || {}) as Record<string, unknown>;
      const k = Object.keys(p).find((x) => /^(hectarea|hectárea|has?|area|área|superficie)/i.test(x));
      return k ? Number(p[k]) : NaN;
    })
    .filter((n) => isFinite(n) && n > 0);
  if (declaradas.length === ha.length && declaradas.length > 0) {
    const sumaDec = declaradas.reduce((a, b) => a + b, 0);
    const dif = Math.abs(sumaDec - total);
    // Media hectárea ya es discutible en un lindero; el 0,05 % atrapa las diferencias sistemáticas
    // en padrones grandes. Callar una diferencia de área es lo que después se vuelve un pleito.
    if (dif >= 0.1 || dif / total > 0.0005) {
      /*
       * La cuadrícula UTM explica décimas de por ciento, no más: su factor de escala se mueve entre
       * 0,9996 en el meridiano central y poco más de 1,001 en el borde de la zona. Se decía «es lo
       * normal» para CUALQUIER diferencia, y un 7 % —un lindero corrido, un polígono de otra
       * concesión— salía tranquilizado con la misma frase que un 0,07 %.
       */
      const rel = dif / Math.max(total, sumaDec);
      partes.push(
        rel <= 0.003
          ? `El archivo declara ${nf(sumaDec)} hectáreas: ${nf(dif)} de diferencia con lo medido. Es lo normal cuando el área se calculó sobre la cuadrícula UTM y no sobre el terreno; la buena es la medida.`
          : `El archivo declara ${nf(sumaDec)} hectáreas: ${nf(dif)} de diferencia con lo medido (${nf(rel * 100, 1)} %). Eso ya no lo explica la cuadrícula UTM, que da décimas de por ciento: hay linderos que no cuadran con lo declarado y hay que mirar los planos.`
      );
    }
  }

  const errores = avisos.filter((a) => a.nivel === 'error');
  const ojos = avisos.filter((a) => a.nivel === 'ojo');
  for (const a of [...errores, ...ojos]) partes.push(a.texto);
  return partes.join(' ');
}

/** Lo que dice al encontrar concesiones que se pisan. */
export function resumenTraslapes(capa: Capa): string {
  const t = traslapesEnCapa(capa);
  if (!t.length) {
    return capa.entidades === 1
      ? `${capa.nombre} trae un solo polígono, así que dentro de la capa no hay nada con qué pisarse.`
      : `Revisé los ${capa.entidades} polígonos de ${capa.nombre} y no se pisa ninguno.`;
  }
  const lista = t.slice(0, 5).map((x) => `${x.nombreA} con ${x.nombreB}, ${nf(x.hectareas)} hectáreas`);
  return `Encontré ${t.length} ${t.length === 1 ? 'traslape' : 'traslapes'} en ${capa.nombre}: ${lista.join('; ')}${t.length > 5 ? ', y más' : ''}. Eso es superposición de derechos y se resuelve por prelación de la solicitud, no en el mapa.`;
}
