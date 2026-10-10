/**
 * EL TARGET EJEMPLO DEL RECORRIDO (Doctor Electrum — Etapa 1: El Recorrido, sección 5).
 *
 * El documento pide un target para ilustrar el flujo y que, si es real, salga de la base y cite sus
 * fuentes. Aquí se arma con datos de verdad: de las fichas de ocurrencia de oro, la que tenga más
 * mineralización alrededor y cuya área de ~500 ha quede LIBRE (sin concesión que la pise, fuera de
 * áreas protegidas y microcuencas declaradas). Se analiza con lo mismo que el análisis de áreas de la
 * app (entorno.ts) y la geología de la zona (geologia.ts), y se devuelve ya resumido para contarlo.
 *
 * Es un EJEMPLO ILUSTRATIVO: un punto con indicios en un área libre, no un proyecto ni un recurso.
 * El recorrido lo dice así.
 */
import type { Express, Request, Response } from 'express';
import type { Geometry, Polygon } from 'geojson';
import { exigirPlataforma, limitar } from '../seguridad';
import { analizarArea } from './area';
import { convertir } from './datum';
import { consultaConTope, hayBase } from './db';
import { capasPorRol } from './entorno';
import { geologiaDe } from './geologia';
import { manifiesto } from './indice-capas';

export type TargetEjemplo = {
  nombre: string;
  ejemplo: true;
  ficha: { nombre: string; capa: string };
  mineral: string;
  centro: [number, number];
  /** El centro en UTM WGS84 zona 16N (el estándar de los mapas del recorrido), en metros. */
  utm: { este: number; norte: number; zona: '16N' };
  poligono: Polygon;
  caja: [number, number, number, number];
  ha: number;
  perimetroKm: number;
  libreHa: number;
  departamento: string | null;
  municipio: string | null;
  aldeas: string[];
  caserios: string[];
  pobladosCerca: number;
  poblacionDentro: number | null;
  protegida: Cercana | null;
  microcuenca: Cercana | null;
  rios: { kmDentro: number; masCercano: { nombre: string; km: number } | null };
  carreteraKm: number | null;
  ocurrencias: Array<{ nombre: string; km: number; detalle: string | null }>;
  /** Cuántas ocurrencias hay a 5 km (la lista de arriba es solo una muestra para mostrar). */
  ocurrenciasTotal: number;
  /** Si el conteo llegó al tope de la consulta (entonces son «al menos» tantas). */
  ocurrenciasTope: boolean;
  /** Las muestras geoquímicas de JICA a 5 km (los indicios del paso 2) y la de más oro. */
  jica: { muestras: number; mejorAu: { codigo: string; tipo: string; ppb: number; sobreTope: boolean; km: number } | null } | null;
  geologia: {
    unidad: string | null;
    descripcion: string | null;
    edad: string | null;
    fallasDentro: number;
    fallaCercana: { nombre: string; km: number } | null;
    rumbo: string | null;
    tracto: string | null;
    modelos: string[];
    indicios: string;
    yacimientos: Array<{ nombre: string; mineral: string; km: number }>;
  } | null;
  concesionCercana: (Cercana & { estado: string | null; tipo: string | null }) | null;
  fuentes: string[];
  alertas: string[];
  calculado: string;
};

/** Lo más cercano de algo, con su distancia y hacia dónde queda («al noreste»). */
export type Cercana = { nombre: string; km: number; rumbo: string | null };

const RUMBOS = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
/** Grados de azimut (0 = norte, en sentido horario) a un rumbo de ocho puntos. */
export function rumboDe(az: number | null | undefined): string | null {
  if (az == null || !Number.isFinite(az)) return null;
  return RUMBOS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

/** Un cuadrado de ~`ha` hectáreas centrado en el punto (en grados, corregido por la latitud). */
export function cuadrado([lon, lat]: [number, number], ha = 500): Polygon {
  const ladoKm = Math.sqrt(ha / 100);
  const dLat = ladoKm / 2 / 110.574;
  const dLon = ladoKm / 2 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  const [o, s, e, n] = [r(lon - dLon), r(lat - dLat), r(lon + dLon), r(lat + dLat)];
  return { type: 'Polygon', coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]] };
}

/**
 * ¿Sirve como target libre? Ni una hectárea con concesión encima (tolerancia de redondeo, no de
 * traslape), y las tres restricciones REVISADAS con éxito y sin tocarla: una capa que no se cargó o
 * que falló no cuenta como «libre», porque el recorrido lo diría así.
 */
export function estaLibre(a: { ha: number; libreHa: number; entorno?: any }): boolean {
  const e = a.entorno;
  if (!e || a.ha <= 0 || a.ha - a.libreHa > 0.01) return false;
  const limpia = (s: any) => s?.estado === 'ok' && !(s.pisa?.length > 0);
  return limpia(e.areasProtegidas) && limpia(e.microcuencas) && limpia(e.forestal);
}

const n1 = (x: number) => Math.round(x * 10) / 10;

/** Un punto en UTM WGS84 16N, redondeado al metro. */
export function utm16(p: [number, number]): { este: number; norte: number; zona: '16N' } {
  const [x, y] = convertir(p, { datum: 'WGS84', forma: 'geo' }, { datum: 'WGS84', forma: 'utm', zona: 16 });
  return { este: Math.round(x), norte: Math.round(y), zona: '16N' };
}

async function candidatos(): Promise<Array<{ lon: number; lat: number; nombre: string; capa: string; vecinos: number }>> {
  const m = await manifiesto();
  const fichas = m?.capas.find((c) => c.id === 110002);
  const oro = (fichas?.fuentes || []).filter((f) => f.capa && /^oro$/i.test(String(f.propiedades?.mineral || ''))).map((f) => f.capa!) || [];
  const ocurr = (await capasPorRol()).filter((c) => c.rol === 'ocurrencia').map((c) => c.id);
  if (!oro.length) return [];
  // Las fichas de oro con más ocurrencias a 5 km (de cualquier fuente): más indicios, mejor ejemplo.
  return consultaConTope<{ lon: number; lat: number; nombre: string; capa: string; vecinos: number }>(
    `SELECT ST_X(ST_PointOnSurface(e.geom))::float8 AS lon, ST_Y(ST_PointOnSurface(e.geom))::float8 AS lat,
            coalesce(e.atributos->>'Name', e.nombre, 'Ficha de oro') AS nombre, k.nombre AS capa,
            (SELECT count(*) FROM entidad_geo o WHERE o.capa_id = ANY($2) AND o.id <> e.id
               AND ST_DWithin(o.geom::geography, e.geom::geography, 5000))::int AS vecinos
       FROM entidad_geo e JOIN capa k ON k.id = e.capa_id
      WHERE e.capa_id = ANY($1)
      ORDER BY vecinos DESC, e.id
      LIMIT 25`,
    [oro, ocurr],
    20000
  );
}

/** Distancia en km y azimut (grados) del punto (parámetros `lon`, `lat`) al borde más cercano de `geom`. */
const distanciaYAzimut = (lon: string, lat: string) => {
  const p = `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;
  return `(ST_Distance(geom::geography, ${p}::geography) / 1000)::float8 AS km, degrees(ST_Azimuth(${p}, ST_ClosestPoint(geom, ${p})))::float8 AS az`;
};

/** Las muestras de JICA a 5 km del punto: cuántas y la de más oro (sin las que están bajo el límite). */
async function jicaCerca([lon, lat]: [number, number]): Promise<TargetEjemplo['jica']> {
  const r = await consultaConTope<{ n: number; codigo: string | null; tipo: string | null; au: number | null; tope: string | null; km: number | null }>(
    `WITH m AS (
       SELECT codigo, tipo, au, limites->>'au' AS lim, ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 AS km
         FROM muestra_geoquimica WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 5000))
     SELECT (SELECT count(*) FROM m)::int AS n, b.codigo, b.tipo, b.au::float8 AS au, b.lim AS tope, b.km::float8 AS km
       FROM (SELECT 1) x LEFT JOIN LATERAL (SELECT * FROM m WHERE au IS NOT NULL AND coalesce(lim, '') <> '<' ORDER BY au DESC LIMIT 1) b ON true`,
    [lon, lat],
    10000
  ).catch(() => []);
  const f = r[0];
  if (!f || !f.n) return null;
  return { muestras: f.n, mejorAu: f.codigo && f.au != null ? { codigo: f.codigo, tipo: f.tipo || 'muestra', ppb: f.au, sobreTope: f.tope === '>', km: n1(f.km || 0) } : null };
}

async function masCercana(rol: string, punto: [number, number]): Promise<Cercana | null> {
  const ids = (await capasPorRol()).filter((c) => c.rol === rol).map((c) => c.id);
  if (!ids.length) return null;
  const [f] = await consultaConTope<{ nombre: string; km: number; az: number | null }>(
    `SELECT coalesce(nombre, '') AS nombre, ${distanciaYAzimut('$2', '$3')}
       FROM entidad_geo WHERE capa_id = ANY($1)
      ORDER BY geom <-> ST_SetSRID(ST_MakePoint($2, $3), 4326) LIMIT 1`,
    [ids, punto[0], punto[1]],
    10000
  );
  return f ? { nombre: f.nombre, km: n1(f.km), rumbo: rumboDe(f.az) } : null;
}

export async function armarTarget(): Promise<TargetEjemplo | { error: string }> {
  if (!hayBase()) return { error: 'No hay base conectada.' };
  const cs = await candidatos();
  if (!cs.length) return { error: 'No hay fichas de ocurrencia de oro cargadas.' };
  for (const c of cs.slice(0, 15)) {
    const g = cuadrado([c.lon, c.lat]);
    const a = await analizarArea(g as Geometry, 'Target Ejemplo').catch(() => null);
    if (!a || 'error' in a || !estaLibre(a as any)) continue;
    const e = (a as any).entorno;
    const ok = (s: any) => s?.estado === 'ok';
    const [geo, conc, micro, prot, jica] = await Promise.all([
      geologiaDe({ lon: c.lon, lat: c.lat, radioKm: 5 }).catch(() => null),
      consultaConTope<{ nombre: string; estado: string | null; tipo: string | null; km: number; az: number | null }>(
        `SELECT nombre, estado, tipo, ${distanciaYAzimut('$1', '$2')}
           FROM concesion WHERE geom IS NOT NULL ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326) LIMIT 1`,
        [c.lon, c.lat],
        10000
      ).then((r) => r[0] || null),
      masCercana('microcuenca', [c.lon, c.lat]),
      masCercana('area_protegida', [c.lon, c.lat]),
      jicaCerca([c.lon, c.lat]),
    ]);
    const gg = geo && !('error' in geo) ? geo : null;
    const u = gg?.litologia.dentro[0] || gg?.litologia.cerca[0] || null;
    const falla = gg ? [...gg.fallas.dentro, ...gg.fallas.cerca].filter((f) => f.nombre && !/sin nombre/i.test(f.nombre)).sort((x, y) => x.km - y.km)[0] || [...gg.fallas.dentro, ...gg.fallas.cerca].sort((x, y) => x.km - y.km)[0] || null : null;
    const poblados = ok(e.poblados) ? e.poblados.lista : [];
    const caja: [number, number, number, number] = [g.coordinates[0][0][0], g.coordinates[0][0][1], g.coordinates[0][2][0], g.coordinates[0][2][1]];
    const fuentes = [...new Set([...Object.values(e.capas || {}).flat(), ...Object.values(gg?.fuentes || {}).flat(), c.capa] as string[])].slice(0, 40);
    return {
      nombre: 'Target Ejemplo',
      ejemplo: true,
      ficha: { nombre: c.nombre, capa: c.capa },
      mineral: 'Oro',
      centro: [c.lon, c.lat],
      utm: utm16([c.lon, c.lat]),
      poligono: g,
      caja,
      ha: (a as any).ha,
      perimetroKm: (a as any).perimetroKm,
      libreHa: (a as any).libreHa,
      departamento: ok(e.departamentos) ? e.departamentos.lista[0]?.nombre ?? null : null,
      municipio: ok(e.municipios) ? e.municipios.lista[0]?.nombre ?? null : null,
      aldeas: poblados.filter((p: any) => p.tipo === 'aldea').sort((x: any, y: any) => x.km - y.km).slice(0, 3).map((p: any) => p.nombre),
      caserios: poblados.filter((p: any) => p.tipo !== 'aldea').sort((x: any, y: any) => x.km - y.km).slice(0, 3).map((p: any) => p.nombre),
      pobladosCerca: ok(e.poblados) ? e.poblados.dentro + e.poblados.cerca : 0,
      poblacionDentro: ok(e.poblados) ? e.poblados.poblacionDentro : null,
      protegida: prot,
      microcuenca: micro,
      rios: ok(e.rios) ? { kmDentro: n1(e.rios.kmDentro), masCercano: e.rios.masCercano ? { nombre: e.rios.masCercano.nombre || 'sin nombre', km: n1(e.rios.masCercano.km) } : null } : { kmDentro: 0, masCercano: null },
      carreteraKm: ok(e.carretera) && e.carretera.km != null ? n1(e.carretera.km) : null,
      ocurrencias: ok(e.ocurrencias) ? e.ocurrencias.lista.slice(0, 8).map((o: any) => ({ nombre: o.nombre, km: n1(o.km), detalle: o.detalle })) : [],
      ocurrenciasTotal: ok(e.ocurrencias) ? e.ocurrencias.lista.length : 0,
      // entorno.ts trae hasta 40 puntos cercanos.
      ocurrenciasTope: ok(e.ocurrencias) && e.ocurrencias.lista.length >= 40,
      jica,
      geologia: gg
        ? {
            unidad: u?.unidad ?? null,
            descripcion: u?.descripcion || null,
            edad: u?.edad || null,
            fallasDentro: gg.fallas.dentro.length,
            fallaCercana: falla ? { nombre: falla.nombre, km: n1(falla.km) } : null,
            rumbo: gg.fallas.rumbos.dominante,
            tracto: gg.recursos.tractos[0]?.nombre ?? null,
            modelos: gg.indicios.modelos.slice(0, 4),
            indicios: gg.indicios.nivel,
            yacimientos: gg.recursos.yacimientos.slice(0, 6).map((y) => ({ nombre: y.nombre, mineral: y.mineral, km: n1(y.km) })),
          }
        : null,
      concesionCercana: conc ? { nombre: conc.nombre, estado: conc.estado, tipo: conc.tipo, km: n1(conc.km), rumbo: rumboDe(conc.az) } : null,
      fuentes,
      alertas: (a as any).alertas || [],
      calculado: new Date().toISOString(),
    };
  }
  return { error: 'Ninguna de las fichas de oro revisadas quedó libre de concesiones y restricciones.' };
}

let memoria: { cuando: number; t: TargetEjemplo } | null = null;
let enCurso: Promise<TargetEjemplo | { error: string }> | null = null;

/** Seis horas de memoria: es pesado (varios análisis de área y uno de geología) y cambia poco. */
export async function targetEjemplo(): Promise<TargetEjemplo | { error: string }> {
  if (memoria && Date.now() - memoria.cuando < 6 * 3600_000) return memoria.t;
  enCurso ||= armarTarget()
    .then((t) => {
      if (!('error' in t)) memoria = { cuando: Date.now(), t };
      return t;
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}

export function montarRutasRecorrido(app: Express) {
  app.get('/api/electrum/recorrido/target', exigirPlataforma('electrum'), limitar(20), async (_req: Request, res: Response) => {
    try {
      const t = await targetEjemplo();
      if ('error' in t) return res.status(404).json({ error: t.error, honesto: true });
      res.setHeader('Cache-Control', 'private, max-age=600');
      return res.json({ target: t, honesto: true });
    } catch (e: any) {
      console.error('[recorrido] target', String(e?.message || e).slice(0, 200));
      return res.status(503).json({ error: 'No pude armar el target de ejemplo.', honesto: true });
    }
  });
}
