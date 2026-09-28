/**
 * PEDIR UN ÁREA NUEVA — un polígono dibujado en el mapa, cruzado con todo antes de pedirlo.
 *
 * Quien piensa solicitar una concesión dibuja el área y ve lo mismo que la ficha de una concesión:
 * qué concesiones pisa (y cuántas hectáreas le quedan libres), áreas protegidas, microcuencas,
 * bosque, cauces, caseríos, municipio. Y se lleva un PDF con el plano de situación, los vértices en
 * WGS84 y NAD27, y ese entorno. No es una consulta registral: es la revisión previa que se hace
 * antes de ir al Instituto.
 */
import type { Express, Request, Response } from 'express';
import type { Geometry, Position } from 'geojson';
import { documentoPdf, type Bloque } from '../../lib/pdf';
import { exigirPlataforma, identidadDe, limitar } from '../seguridad';
import { consulta, hayBase } from './db';
import { entornoDeArea, type Entorno } from './entorno';
import { renglonesEntorno } from './explorar';
import { verticesDe } from './exportar';
import { AMBAR, bloquesEntorno, guardarInforme, pie } from './informe';
import { ALTO, ANCHO, datosPlano, jpegDeSvg, svgPlano } from './plano';

/** Hasta 200 000 ha (más que la concesión más grande del país) y 2 000 vértices. */
const HA_MAX = 200_000;
const VERTICES_MAX = 2000;

/** El polígono tal como llega del navegador, revisado: tipo, anillos cerrados, coordenadas en Honduras. */
export function poligonoValido(g: unknown): { ok: true; geojson: Geometry } | { ok: false; motivo: string } {
  const x = g as Geometry | null;
  if (!x || (x.type !== 'Polygon' && x.type !== 'MultiPolygon')) return { ok: false, motivo: 'Mandá un polígono (GeoJSON Polygon o MultiPolygon).' };
  const polis = (x.type === 'Polygon' ? [x.coordinates] : x.coordinates) as Position[][][];
  let n = 0;
  for (const p of polis) {
    if (!Array.isArray(p) || !p.length) return { ok: false, motivo: 'Polígono vacío.' };
    for (const anillo of p) {
      if (!Array.isArray(anillo) || anillo.length < 4) return { ok: false, motivo: 'Cada anillo necesita al menos tres vértices y cerrar en el primero.' };
      const [a, b] = [anillo[0], anillo[anillo.length - 1]];
      if (a[0] !== b[0] || a[1] !== b[1]) return { ok: false, motivo: 'El anillo no cierra: el último vértice tiene que ser el primero.' };
      for (const c of anillo) {
        if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return { ok: false, motivo: 'Hay una coordenada que no es un número.' };
        if (c[0] < -90 || c[0] > -82 || c[1] < 12.5 || c[1] > 17.5) return { ok: false, motivo: 'El área tiene que estar en Honduras (lon/lat WGS84).' };
      }
      n += anillo.length;
    }
  }
  if (n > VERTICES_MAX) return { ok: false, motivo: `Demasiados vértices (${n}; el tope es ${VERTICES_MAX}).` };
  return { ok: true, geojson: x };
}

export type AnalisisArea = {
  nombre: string;
  ha: number;
  perimetroKm: number;
  /** Lo que no pisa ninguna concesión del catastro. */
  libreHa: number;
  traslapes: Entorno['traslapes'];
  renglones: string[];
  alertas: string[];
};

async function medidas(g: Geometry): Promise<{ ha: number; perimetroKm: number; libreHa: number; valido: boolean }> {
  // La validez primero y sola: con un polígono que se corta a sí mismo, GEOS revienta en la diferencia.
  const [v] = await consulta<{ valido: boolean }>(`SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS valido`, [JSON.stringify(g)]);
  if (!v?.valido) return { ha: 0, perimetroKm: 0, libreHa: 0, valido: false };
  const [r] = await consulta<{ ha: number; km: number; libre: number; valido: boolean }>(
    `WITH a AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
          o AS (SELECT ST_Union(c.geom) AS u FROM concesion c, a WHERE c.geom && a.g AND ST_Intersects(c.geom, a.g))
     SELECT (ST_Area(a.g::geography) / 10000.0)::float8 AS ha, (ST_Perimeter(a.g::geography) / 1000.0)::float8 AS km,
            (ST_Area(COALESCE(ST_Difference(a.g, o.u), a.g)::geography) / 10000.0)::float8 AS libre, ST_IsValid(a.g) AS valido
       FROM a, o`,
    [JSON.stringify(g)]
  );
  return { ha: r.ha, perimetroKm: r.km, libreHa: r.libre, valido: r.valido };
}

export async function analizarArea(g: Geometry, nombre = 'Área solicitada'): Promise<AnalisisArea | { error: string }> {
  const m = await medidas(g);
  if (!m.valido) return { error: 'El polígono se cruza consigo mismo: redibujalo sin que los lados se corten.' };
  if (m.ha > HA_MAX) return { error: `Es demasiado grande (${Math.round(m.ha).toLocaleString('es-HN')} ha; el tope es ${HA_MAX.toLocaleString('es-HN')} ha).` };
  const e = await entornoDeArea(g, nombre);
  if (!e) return { error: 'No pude leer ese polígono.' };
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { nombre, ha: r2(m.ha), perimetroKm: r2(m.perimetroKm), libreHa: r2(Math.max(0, m.libreHa)), traslapes: e.traslapes, renglones: renglonesEntorno(e), alertas: e.alertas };
}

/** El PDF: resumen, plano de situación, vértices y entorno. */
export async function informeArea(g: Geometry, nombre: string, quien: string | null) {
  const a = await analizarArea(g, nombre);
  if ('error' in a) return a;
  const e = await entornoDeArea(g, nombre);
  const municipio = e && e.municipios.estado === 'ok' ? e.municipios.lista.map((x) => x.nombre).join(', ') : '';
  const d = await datosPlano({ geojson: g, nombre, ubicacion: municipio || undefined }, { pie: 'Área dibujada en el mapa de Dr Electrum FP · WGS 84 / UTM zona 16N' });
  const nf = (x: number, dec = 2) => new Intl.NumberFormat('es-HN', { maximumFractionDigits: dec, minimumFractionDigits: dec }).format(x);
  const bloques: Bloque[] = [];
  if (a.traslapes.length) {
    bloques.push({
      tipo: 'aviso',
      texto: `Pisa ${a.traslapes.length} ${a.traslapes.length === 1 ? 'concesión del catastro' : 'concesiones del catastro'}: quedan libres ${nf(a.libreHa)} ha de ${nf(a.ha)} ha.`,
    });
  }
  bloques.push(
    { tipo: 'seccion', texto: 'Medidas' },
    {
      tipo: 'campos',
      filas: [
        ['Área', `${nf(a.ha)} ha`],
        ['Perímetro', `${nf(a.perimetroKm)} km`],
        ['Libre de concesiones', `${nf(a.libreHa)} ha (${nf(a.ha > 0 ? (a.libreHa / a.ha) * 100 : 0, 1)} %)`],
        ['Municipio', municipio || 'capa no cargada o fuera de todos'],
      ],
    }
  );
  if (d) {
    const jpeg = await jpegDeSvg(svgPlano(d));
    bloques.push({ tipo: 'seccion', texto: 'Plano de situación' }, { tipo: 'imagen', jpeg, ancho: ANCHO, alto: ALTO, altoMax: 520, pie: 'Plano generado en el servidor con el catastro y las capas cargadas · UTM zona 16N.' });
  }
  const vs = verticesDe(g);
  const m1 = (n: number) => new Intl.NumberFormat('es-HN', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);
  bloques.push(
    { tipo: 'seccion', texto: 'Vértices' },
    { tipo: 'tabla', cabecera: ['#', 'Este WGS84', 'Norte WGS84', 'Este NAD27', 'Norte NAD27'], filas: vs.slice(0, 60).map((v) => [String(v.n), m1(v.e), m1(v.nn), m1(v.e27), m1(v.n27)]), anchos: [30, 118, 118, 118, 118] },
    { tipo: 'nota', texto: `UTM zona 16N, en metros. NAD27 con el cambio de datum de Centroamérica (NIMA): precisión de algunos metros.${vs.length > 60 ? ` Son ${vs.length} vértices; aquí van los primeros 60.` : ''}` }
  );
  bloques.push({ tipo: 'seccion', texto: 'Concesiones que pisa' });
  if (a.traslapes.length) {
    bloques.push({
      tipo: 'tabla',
      cabecera: ['Concesión', 'Hectáreas', '% del área'],
      filas: a.traslapes.map((t) => [t.con, nf(t.hectareas), nf(t.pct, 1)]),
      anchos: [260, 120, 120],
    });
  } else {
    bloques.push({ tipo: 'parrafo', texto: 'No pisa ninguna concesión de las cargadas. Vale para lo que hay en el catastro, no para lo que no se ha subido ni para solicitudes en trámite fuera de él.' });
  }
  if (e) bloques.push(...bloquesEntorno(e));
  bloques.push(
    { tipo: 'regla' },
    {
      tipo: 'nota',
      texto: 'Revisión previa generada por Dr Electrum FP con el catastro y las capas cargadas en esta plataforma. No es una constancia registral ni reemplaza la consulta al catastro oficial.',
    }
  );
  const pdf = documentoPdf({ titulo: `Área solicitada — ${nombre}`, subtitulo: `${nf(a.ha)} ha · revisión previa`, bloques, pie: pie(quien), acento: AMBAR });
  return { pdf, nombre: `area-${nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').toLowerCase().slice(0, 40) || 'solicitada'}.pdf`, dicho: `Armé la revisión del área ${nombre}.` };
}

export function montarRutasArea(app: Express) {
  const E = exigirPlataforma('electrum');
  const leer = (req: Request, res: Response): { g: Geometry; nombre: string } | null => {
    if (!hayBase()) {
      res.status(503).json({ error: 'El catastro no está conectado en este servidor.', honesto: true });
      return null;
    }
    const v = poligonoValido(req.body?.geojson);
    if ('motivo' in v) {
      res.status(400).json({ error: v.motivo, honesto: true });
      return null;
    }
    const nombre = String(req.body?.nombre || 'Área solicitada').replace(/[\r\n]+/g, ' ').trim().slice(0, 80) || 'Área solicitada';
    return { g: v.geojson, nombre };
  };
  app.post('/api/electrum/area/analizar', E, limitar(30), async (req: Request, res: Response) => {
    const x = leer(req, res);
    if (!x) return;
    try {
      const a = await analizarArea(x.g, x.nombre);
      if ('error' in a) return res.status(400).json({ error: a.error, honesto: true });
      return res.json({ ...a, honesto: true });
    } catch (e: any) {
      console.error('[area]', String(e?.message || e).slice(0, 200));
      return res.status(500).json({ error: 'No pude cruzar el área con las capas.', honesto: true });
    }
  });
  app.post('/api/electrum/area/informe', E, limitar(10), async (req: Request, res: Response) => {
    const x = leer(req, res);
    if (!x) return;
    try {
      const id = identidadDe(req);
      const r = await informeArea(x.g, x.nombre, id?.persona.nombre || null);
      if ('error' in r) return res.status(400).json({ error: r.error, honesto: true });
      const guardado = guardarInforme({ ...r }, id?.persona.id || null);
      return res.json({ id: guardado, nombre: r.nombre, url: `/api/electrum/informe/${guardado}`, bytes: r.pdf.length, honesto: true });
    } catch (e: any) {
      console.error('[area] informe:', String(e?.message || e).slice(0, 200));
      return res.status(500).json({ error: 'Se me cayó armando la revisión del área.', honesto: true });
    }
  });
}
