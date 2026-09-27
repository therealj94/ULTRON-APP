/**
 * El paquete de geología abierta (data/geologia, armado por scripts/electrum/geologia/preparar.py)
 * y su carga en PostGIS.
 *
 * Cada archivo es una capa con su nombre, y el nombre decide el rol (esquema v8): «Geología
 * superficial…» → litologia, «Fallas…» → falla, «Límites de placas…» → placa, etc. Se carga por la
 * MISMA vía que una capa subida a mano (`guardarCapa`), así que entra con sus avisos, su rol y sus
 * rasgos en `entidad_geo`, y todo lo que ya cruza capas la ve.
 *
 * Los países de Natural Earth no van a la base: solo son el fondo del mapa geotectónico.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { FeatureCollection } from 'geojson';
import { consulta, guardarCapa, hayBase, rolDeCapa } from './db';
import type { Capa } from './gis';

export const CARPETA_GEOLOGIA = path.join(process.cwd(), 'data', 'geologia');
const PAISES = 'paises-natural-earth.geojson.gz';

function leer(archivo: string): FeatureCollection & { name?: string } {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CARPETA_GEOLOGIA, archivo))).toString('utf8'));
}

/** Las capas del paquete, en el orden en que conviene cargarlas (la roca primero). */
export function paqueteGeologia(): Array<{ archivo: string; capa: Capa }> {
  if (!fs.existsSync(CARPETA_GEOLOGIA)) return [];
  const orden = ['geologia', 'fallas-usgs', 'fallas-activas', 'provincias', 'placas', 'tractos', 'yacimientos'];
  return fs
    .readdirSync(CARPETA_GEOLOGIA)
    .filter((f) => f.endsWith('.geojson.gz') && f !== PAISES)
    .sort((a, b) => orden.findIndex((o) => a.startsWith(o)) - orden.findIndex((o) => b.startsWith(o)) || a.localeCompare(b))
    .map((archivo) => {
      const fc = leer(archivo);
      const nombre = String(fc.name || archivo.replace(/\.geojson\.gz$/, ''));
      return {
        archivo,
        capa: { nombre, geojson: { type: 'FeatureCollection', features: fc.features }, formato: 'geojson', origenCrs: 'WGS 84 (EPSG:4326)', entidades: fc.features.length, descartadas: 0 },
      };
    });
}

let paisesCache: FeatureCollection | null = null;
/** El contorno de los países de la región, para el fondo del mapa geotectónico. */
export function paisesRegion(): FeatureCollection {
  if (!paisesCache) {
    try {
      paisesCache = leer(PAISES);
    } catch {
      paisesCache = { type: 'FeatureCollection', features: [] };
    }
  }
  return paisesCache;
}

export type ResultadoCarga = { nombre: string; estado: 'cargada' | 'ya estaba' | 'reemplazada'; entidades: number; rol: string | null };

/**
 * Carga el paquete. Lo que ya está (misma capa, mismo nombre) no se duplica: se deja, o se
 * reemplaza con `reemplazar`. Exige el esquema v8, porque sin él el rol de geología no pasa la
 * restricción de `capa.rol` y la carga entera se desharía a medias.
 */
export async function cargarGeologia(opts: { reemplazar?: boolean } = {}): Promise<ResultadoCarga[]> {
  if (!hayBase()) throw new Error('sin ELECTRUM_DB_URL');
  const [v] = await consulta<{ v: number }>(`SELECT coalesce(max(version), 0)::int AS v FROM esquema_version`);
  if ((v?.v ?? 0) < 8) throw new Error(`la base está en el esquema v${v?.v ?? 0}; la geología necesita la v8 (scripts/electrum/esquema.sql)`);
  const paquete = paqueteGeologia();
  if (!paquete.length) throw new Error(`no encuentro el paquete de geología en ${CARPETA_GEOLOGIA}`);
  const out: ResultadoCarga[] = [];
  for (const { archivo, capa } of paquete) {
    const rol = rolDeCapa(capa.nombre);
    const previas = await consulta<{ id: number }>(`SELECT id::int FROM capa WHERE nombre = $1`, [capa.nombre]);
    if (previas.length && !opts.reemplazar) {
      // Si se cargó antes de la v8, puede haberse quedado sin rol.
      await consulta(`UPDATE capa SET rol = $2 WHERE nombre = $1 AND rol IS NULL`, [capa.nombre, rol]);
      out.push({ nombre: capa.nombre, estado: 'ya estaba', entidades: capa.entidades, rol });
      continue;
    }
    /*
     * La nueva primero y la vieja después: si la carga falla a la mitad, la capa anterior sigue
     * ahí. Borrar antes dejaba la capa ausente ante cualquier error (revisión de Codex en #41).
     */
    const r = await guardarCapa(capa, { archivo, subidoPor: 'paquete de geología (data/geologia)', comoConcesiones: false });
    if (previas.length) await consulta(`DELETE FROM capa WHERE id = ANY($1::bigint[])`, [previas.map((p) => p.id)]);
    out.push({ nombre: capa.nombre, estado: previas.length ? 'reemplazada' : 'cargada', entidades: r.entidades, rol });
  }
  return out;
}
