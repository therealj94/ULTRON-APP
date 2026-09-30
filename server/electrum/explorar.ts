/**
 * EXPLORAR EL MAPA A MANO.
 *
 * Hasta ahora el mapa solo lo movía Dr Electrum: se le preguntaba y él volaba. Tocar una concesión
 * no hacía nada, y para saber de quién era un polígono había que escribirlo. Esto es lo que contesta
 * el mapa cuando se toca:
 *
 *  · una concesión → su ficha entera: datos del catastro, alertas del entorno (áreas protegidas,
 *    caseríos, ríos, traslapes), geología (roca, fallas, indicios) y los documentos que la nombran;
 *  · un punto cualquiera → qué concesión lo cubre, cuáles hay cerca y qué roca y fallas tiene;
 *  · un rasgo de una capa (una unidad de roca, una falla, un yacimiento) → todos sus atributos.
 *
 * Y las capas que se pueden encender encima del catastro. Todo sale de las mismas funciones que usa
 * Dr Electrum para contestar, así que lo que se ve al tocar y lo que él dice son las mismas cifras.
 * Cada parte se calcula por separado y con su tope: si la geología tarda, la ficha llega igual y lo
 * dice en esa sección.
 */
import type { FeatureCollection, Geometry } from 'geojson';
import { geometriaDe, concesionPorId, conTextoReparado, consultaConTope, type FilaConcesion, type RolCapa } from './db';
import { alertasDe, capasPorRol, entornoDe, type Entorno } from './entorno';
import { claseDeRoca, geologiaDe, type Geologia } from './geologia';
import { repararTexto } from './gis';
import { sateliteEnRenglones } from './satelite';
import { prospectividadDe, prospectividadEnRenglones, type Prospectividad } from './prospectividad';

const nf = (x: number, d = 1) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }).format(x);
const km = (x: number) => (x < 1 ? `${nf(x * 1000, 0)} m` : `${nf(x, 1)} km`);

/** Una sección de la ficha: sus renglones, o por qué no está. */
export type Parte = { estado: 'ok'; renglones: string[] } | { estado: 'error'; motivo: string };

async function conTope<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let reloj: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, no) => {
        reloj = setTimeout(() => no(new Error(`tardó más de ${ms / 1000} s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * El motivo que ve la persona es estable: «tardó demasiado» o «falló la consulta». El error de
 * Postgres (con su host, usuario o esquema) va al registro del servidor, no a la pantalla.
 */
function motivoPublico(e: any, que: string): string {
  const m = String(e?.message || e);
  console.error(`[electrum] mapa: ${que} falló:`, m.slice(0, 200));
  return /tard[oó] m[aá]s de|statement timeout|canceling statement/i.test(m) ? 'la consulta tardó demasiado; volvé a tocar en un momento' : 'falló la consulta a la base';
}

async function parte(que: string, fn: () => Promise<string[]>, ms = 12000): Promise<Parte> {
  try {
    return { estado: 'ok', renglones: await conTope(fn, ms) };
  } catch (e: any) {
    return { estado: 'error', motivo: motivoPublico(e, que) };
  }
}

/* ------------------------------------------------------------------ renglones */

/** Los datos del catastro como pares etiqueta → valor, en el orden en que se leen. */
export function datosDe(f: FilaConcesion, hoy = new Date()): Array<[string, string]> {
  const d: Array<[string, string | null | undefined]> = [
    ['Expediente', f.expediente],
    ['Titular', f.titular],
    ['Tipo', f.tipo],
    ['Mineral', f.mineral],
    ['Estado', f.estado],
    ['Otorgada', f.otorgada],
    ['Vence', f.vence ? `${f.vence}${venceEn(f.vence, hoy)}` : null],
    ['Área medida', f.hectareas != null ? `${nf(f.hectareas, 2)} ha` : null],
    ['Área declarada', f.hectareas_dec != null ? `${nf(f.hectareas_dec, 2)} ha` : null],
    ['Municipio', f.municipio],
    ['Departamento', f.departamento],
  ];
  return d.filter((x): x is [string, string] => !!x[1] && String(x[1]).trim() !== '').map(([k, v]) => [k, repararTexto(String(v))]);
}

function venceEn(vence: string, hoy: Date): string {
  const dias = Math.round((Date.parse(`${vence}T12:00:00-06:00`) - hoy.getTime()) / 86_400_000);
  if (!Number.isFinite(dias)) return '';
  if (dias < 0) return ` (venció hace ${nf(-dias, 0)} días)`;
  if (dias === 0) return ' (vence hoy)';
  return dias <= 365 ? ` (faltan ${nf(dias, 0)} días)` : '';
}

/** El entorno en renglones: lo que alerta primero, después dónde queda y lo que no se pudo cruzar. */
const NOMBRE_SECCION: Array<[keyof Entorno, string]> = [
  ['areasProtegidas', 'áreas protegidas'],
  ['microcuencas', 'microcuencas'],
  ['forestal', 'patrimonio forestal'],
  ['rios', 'ríos'],
  ['poblados', 'caseríos y aldeas'],
  ['carretera', 'carreteras'],
  ['zonasInformales', 'minería informal'],
  ['ocurrencias', 'yacimientos'],
  ['municipios', 'municipios'],
];

export function renglonesEntorno(e: Entorno): string[] {
  const r = [...alertasDe(e)];
  // Una revisión que falló no es una revisión limpia: se dice cuál no se pudo hacer.
  const fallidas = NOMBRE_SECCION.filter(([k]) => (e[k] as any)?.estado === 'error').map(([, n]) => n);
  if (e.municipios.estado === 'ok' && e.municipios.lista.length) {
    r.push(`Municipio: ${e.municipios.lista.map((m) => (m.pct < 99.5 ? `${m.nombre} (${nf(m.pct, 0)} %)` : m.nombre)).join(', ')}.`);
  }
  if (e.carretera.estado === 'ok' && e.carretera.km != null) r.push(`Carretera más cercana a ${km(e.carretera.km)}.`);
  if (e.rios.estado === 'ok' && !e.rios.kmDentro && e.rios.masCercano) r.push(`Sin cauces dentro; el más cercano, ${e.rios.masCercano.nombre}, a ${km(e.rios.masCercano.km)}.`);
  if (!r.length && !fallidas.length) r.push('Sin áreas protegidas, caseríos, ríos ni traslapes en las capas cargadas.');
  if (fallidas.length) r.unshift(`No se pudo revisar (falló la consulta; volvé a tocar): ${fallidas.join(', ')}.`);
  if (e.faltan.length) r.push(`No cruzado (capa no cargada): ${e.faltan.join(', ').replace(/_/g, ' ')}.`);
  return r;
}

/** La geología en renglones cortos: roca, intrusivos, fallas, recursos e indicios. */
export function renglonesGeologia(g: Geologia): string[] {
  const r: string[] = [];
  const u = g.litologia.dentro.slice(0, 3);
  if (u.length) r.push(`Roca: ${u.map((x) => `${x.unidad}${x.descripcion ? ` — ${x.descripcion}` : ''} (${nf(x.pct, 0)} %)`).join('; ')}.`);
  else if (g.litologia.cerca.length) r.push(`Roca más cercana: ${g.litologia.cerca[0].unidad} a ${km(g.litologia.cerca[0].km)}.`);
  if (g.intrusivos.dentro.length) r.push(`Intrusivos dentro: ${g.intrusivos.dentro.map((x) => x.unidad).join(', ')}.`);
  else if (g.intrusivos.kmAlContacto != null) r.push(`Intrusivo más cercano a ${km(g.intrusivos.kmAlContacto)}.`);
  if (g.fallas.kmDentro > 0) r.push(`Fallas: ${km(g.fallas.kmDentro)} dentro${g.fallas.rumbos.dominante ? `, rumbo dominante ${g.fallas.rumbos.dominante}` : ''}.`);
  else if (g.fallas.cerca.length) r.push(`Falla más cercana: ${g.fallas.cerca[0].nombre || 'sin nombre'} a ${km(g.fallas.cerca[0].km)}.`);
  if (g.fallas.activaMasCercana) r.push(`Falla activa más cercana: ${g.fallas.activaMasCercana.nombre || 'sin nombre'} a ${km(g.fallas.activaMasCercana.km)}.`);
  if (g.recursos.tractos.length) r.push(`Tracto permisivo: ${g.recursos.tractos.map((t) => `${t.nombre} (${nf(t.pct, 0)} %)`).join(', ')}.`);
  const y = g.recursos.yacimientos;
  if (y.length) {
    const dentro = y.filter((x) => x.dentro);
    r.push(
      `${y.length} yacimiento(s) u ocurrencia(s) en ${nf(g.radioKm, 0)} km${dentro.length ? `, ${dentro.length} dentro` : ''}: ${y
        .slice(0, 4)
        .map((x) => `${x.nombre}${x.mineral ? ` (${x.mineral})` : ''} a ${km(x.km)}`)
        .join('; ')}.`
    );
  }
  r.push(`Indicios: ${g.indicios.nivel}${g.indicios.modelos.length ? ` — ${g.indicios.modelos.slice(0, 3).join(', ')}` : ''}.`);
  if (g.escala) r.push(`Escala de la fuente: ${g.escala}.`);
  if (g.faltan.length) r.push(`Sin capa cargada: ${g.faltan.join(', ')}.`);
  return r;
}

/* ------------------------------------------------------------------ la ficha */

export type FichaMapa = {
  id: number;
  nombre: string;
  datos: Array<[string, string]>;
  /** Para volar a ella desde la tarjeta. */
  encuadre: [number, number, number, number] | null;
  geojson: Geometry | null;
  entorno: Parte;
  geologia: Parte;
  documentos: Parte;
  /** Lo que Sentinel-2 midió dentro (pérdida de vegetación, suelo expuesto, anomalías). */
  satelite: Parte;
  /** Geología + geoquímica + satélite en un puntaje de 0 a 100, con lo que suma cada uno. */
  prospectividad: Parte & { puntaje?: number; nivel?: string };
};

/** Todo lo que hay de una concesión, para la tarjeta que se abre al tocarla. */
export async function fichaParaMapa(id: number): Promise<FichaMapa | null> {
  const f = await concesionPorId(id);
  if (!f) return null;
  // La geología se calcula una vez: la usan su renglón y la prospectividad.
  const geologiaP = conTope(() => geologiaDe({ concesion: id }), 14000).catch((e) => ({ error: motivoPublico(e, 'geología') }));
  const [geo, entorno, geologia, documentos, satelite, prosp] = await Promise.all([
    geometriaDe(id).catch(() => null),
    parte('entorno', async () => {
      const e = await entornoDe(id);
      return e ? renglonesEntorno(e) : ['No tiene geometría: no hay entorno que cruzar.'];
    }),
    parte('geología', async () => {
      const g = await geologiaP;
      if ('error' in g) return [g.error];
      return renglonesGeologia(g);
    }, 15000),
    parte('documentos', async () => {
      const propios = await consultaConTope<{ nombre: string; tipo: string | null; paginas: number | null }>(
        `SELECT nombre, tipo, paginas FROM documento WHERE concesion_id = $1 ORDER BY subido DESC LIMIT 8`,
        [id],
        6000
      ).then(conTextoReparado);
      // Con tope en la base, igual que todo lo de aquí: un toque abandonado no deja la consulta viva.
      const nombran = await consultaConTope<{ documento: string; pagina: number | null; texto: string }>(
        `SELECT d.nombre AS documento, f.pagina, left(f.texto, 400) AS texto
           FROM fragmento f JOIN documento d ON d.id = f.documento_id
          WHERE f.tsv @@ phraseto_tsquery('spanish', $1)
          ORDER BY ts_rank(f.tsv, phraseto_tsquery('spanish', $1)) DESC LIMIT 4`,
        [f.nombre],
        6000
      ).then(conTextoReparado);
      const r = [
        ...propios.map((d) => `${d.nombre}${d.tipo ? ` · ${d.tipo}` : ''}${d.paginas ? ` · ${d.paginas} pág.` : ''}`),
        ...nombran
          .filter((h) => !propios.some((d) => d.nombre === h.documento))
          .map((h) => `${h.documento}${h.pagina ? `, pág. ${h.pagina}` : ''}: «${h.texto.replace(/\s+/g, ' ').slice(0, 160)}…»`),
      ];
      return r.length ? r : ['Ningún documento subido la nombra todavía.'];
    }, 8000),
    parte('satélite', async () => {
      const r = await sateliteEnRenglones(id);
      return r.length ? r : ['Esta concesión todavía no se midió con Sentinel-2.'];
    }, 6000),
    (async () => {
      let p: Prospectividad | null = null;
      const parteP = await parte('prospectividad', async () => {
        p = await prospectividadDe(id, await geologiaP);
        return prospectividadEnRenglones(p);
      }, 20000);
      const q = p as Prospectividad | null;
      return q ? { ...parteP, puntaje: q.puntaje, nivel: q.nivel } : parteP;
    })(),
  ]);
  return { id, nombre: repararTexto(f.nombre), datos: datosDe(f), encuadre: geo?.encuadre ?? null, geojson: geo?.geojson ?? null, entorno, geologia, documentos, satelite, prospectividad: prosp };
}

/* ------------------------------------------------------------------ un punto */

type Lista<T> = { estado: 'ok'; lista: T[] } | { estado: 'error'; motivo: string };

export type AquiMapa = {
  lon: number;
  lat: number;
  /** De quién es el punto. Si la consulta falla se dice: un error no es «no hay ninguna». */
  concesiones: Lista<{ id: number; nombre: string; titular: string | null }>;
  cerca: Lista<{ id: number; nombre: string; km: number }>;
  geologia: Parte;
};

/** «¿Qué hay aquí?»: quién tiene el punto, qué hay cerca y sobre qué roca está. */
export async function queHayAqui(lon: number, lat: number): Promise<AquiMapa> {
  const punto = `ST_SetSRID(ST_MakePoint($1, $2), 4326)`;
  const [en, cerca, geologia] = await Promise.all([
    consultaConTope<{ id: string; nombre: string; titular: string | null }>(
      `SELECT id::text, nombre, titular FROM concesion WHERE ST_Intersects(geom, ${punto}) LIMIT 20`,
      [lon, lat],
      6000
    ).then(
      (f) => ({ estado: 'ok' as const, lista: f }),
      (e) => ({ estado: 'error' as const, motivo: motivoPublico(e, 'concesión en el punto') })
    ),
    consultaConTope<{ id: string; nombre: string; km: number }>(
      `SELECT id::text, nombre, (ST_Distance(geom::geography, ${punto}::geography) / 1000.0)::float8 AS km
         FROM concesion WHERE ST_DWithin(geom::geography, ${punto}::geography, 3000)
        ORDER BY km LIMIT 8`,
      [lon, lat],
      6000
    ).then(
      (f) => ({ estado: 'ok' as const, lista: f }),
      (e) => ({ estado: 'error' as const, motivo: motivoPublico(e, 'concesiones cercanas') })
    ),
    parte('geología del punto', async () => {
      const g = await geologiaDe({ lon, lat, radioKm: 3 });
      if ('error' in g) return [g.error];
      return renglonesGeologia(g);
    }, 14000),
  ]);
  const dentro = new Set(en.estado === 'ok' ? en.lista.map((c) => Number(c.id)) : []);
  return {
    lon,
    lat,
    concesiones:
      en.estado === 'ok'
        ? { estado: 'ok', lista: en.lista.map((c) => ({ id: Number(c.id), nombre: repararTexto(c.nombre), titular: c.titular ? repararTexto(c.titular) : null })) }
        : en,
    cerca:
      cerca.estado === 'ok'
        ? {
            estado: 'ok',
            lista: cerca.lista
              .filter((c) => !dentro.has(Number(c.id)))
              .slice(0, 6)
              .map((c) => ({ id: Number(c.id), nombre: repararTexto(c.nombre), km: Math.round(c.km * 100) / 100 })),
          }
        : cerca,
    geologia,
  };
}

/* ------------------------------------------------------------------ capas */

/**
 * Las capas que se pueden encender. No todas: la red hídrica nacional son 119 mil líneas y los
 * caseríos decenas de miles de puntos; mandadas enteras al teléfono lo ahogan. Esas se ven en la
 * ficha de cada concesión, que las cruza en la base.
 */
export const ROLES_VISIBLES: RolCapa[] = [
  'litologia',
  'falla',
  'tracto_permisivo',
  'ocurrencia',
  'area_protegida',
  'microcuenca',
  'zona_informal',
  'forestal',
  'provincia_geologica',
  'placa',
  'municipio',
  // Referencia (v10): se encienden a mano; el catastro principal es el oficial.
  'proyecto',
  'historico',
];
const MAX_RASGOS = 20000;

export type CapaVisible = { id: number; nombre: string; rol: RolCapa; entidades: number };

export async function capasVisibles(): Promise<CapaVisible[]> {
  const capas = (await capasPorRol()).filter((c) => ROLES_VISIBLES.includes(c.rol));
  if (!capas.length) return [];
  const cuentas = await consultaConTope<{ id: string; n: number }>(
    `SELECT capa_id::text AS id, count(*)::int AS n FROM entidad_geo WHERE capa_id = ANY($1::bigint[]) GROUP BY capa_id`,
    [capas.map((c) => c.id)],
    6000
  );
  const n = new Map(cuentas.map((c) => [Number(c.id), c.n]));
  return capas
    .map((c) => ({ ...c, nombre: repararTexto(c.nombre), entidades: n.get(c.id) || 0 }))
    .filter((c) => c.entidades > 0 && c.entidades <= MAX_RASGOS)
    .sort((a, b) => ROLES_VISIBLES.indexOf(a.rol) - ROLES_VISIBLES.indexOf(b.rol) || a.nombre.localeCompare(b.nombre));
}

/**
 * Una capa para pintarla: geometría simplificada (es para mirar, no para medir) y lo mínimo en cada
 * rasgo —su id, nombre y, en la litología, la clase de roca para colorearla—. Los atributos enteros
 * se piden al tocar el rasgo.
 */
export async function capaParaMapa(capaId: number): Promise<{ rol: RolCapa; geojson: FeatureCollection } | null> {
  const capa = (await capasVisibles()).find((c) => c.id === capaId);
  if (!capa) return null;
  const tolerancia = capa.rol === 'ocurrencia' ? 0 : capa.rol === 'municipio' || capa.rol === 'placa' ? 0.002 : 0.0005;
  const filas = await consultaConTope<{ id: string; nombre: string | null; texto: string | null; g: string }>(
    `SELECT e.id::text, e.nombre,
            CASE WHEN $3::boolean THEN (SELECT string_agg(a.v, ' ') FROM jsonb_each_text(e.atributos) AS a(k, v)
                                WHERE a.k ~* '(desc|lito|roca|unit|unidad|label|clase|type|tipo|name|nombre)') END AS texto,
            ST_AsGeoJSON(CASE WHEN $2::float8 > 0 THEN ST_SimplifyPreserveTopology(e.geom, $2::float8) ELSE e.geom END, 5)::text AS g
       FROM entidad_geo e WHERE e.capa_id = $1 LIMIT ${MAX_RASGOS}`,
    [capaId, tolerancia, capa.rol === 'litologia'],
    15000
  ).then(conTextoReparado);
  return {
    rol: capa.rol,
    geojson: {
      type: 'FeatureCollection',
      features: filas
        .filter((f) => f.g)
        .map((f) => ({
          type: 'Feature',
          geometry: JSON.parse(f.g),
          properties: {
            eid: Number(f.id),
            nombre: f.nombre || '',
            ...(capa.rol === 'litologia' ? { clase: claseDeRoca(`${f.nombre || ''} ${f.texto || ''}`) } : {}),
          },
        })),
    },
  };
}

/** Un rasgo de una capa con todos sus atributos, para la tarjeta que se abre al tocarlo. */
export async function rasgoParaMapa(eid: number): Promise<{ id: number; capa: string; rol: string | null; nombre: string; atributos: Array<[string, string]> } | null> {
  const [f] = await consultaConTope<{ id: string; capa: string; rol: string | null; nombre: string | null; atributos: Record<string, unknown> }>(
    `SELECT e.id::text, c.nombre AS capa, c.rol, e.nombre, e.atributos
       FROM entidad_geo e JOIN capa c ON c.id = e.capa_id WHERE e.id = $1`,
    [eid],
    6000
  );
  if (!f) return null;
  const atributos = Object.entries(f.atributos || {})
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .slice(0, 30)
    .map(([k, v]) => [k, repararTexto(String(v)).slice(0, 240)] as [string, string]);
  // «entidad 12» es el nombre que le pone el cargador a un rasgo sin columna de nombre: no se enseña.
  const propio = f.nombre && !/^entidad \d+$/i.test(f.nombre) ? f.nombre : '';
  const porAtributo = atributos.find(([k]) => /^(nombre|nom|name|unidad|unit|label|desc)/i.test(k))?.[1] || '';
  return { id: Number(f.id), capa: repararTexto(f.capa), rol: f.rol, nombre: repararTexto(propio || porAtributo || 'Sin nombre en la capa'), atributos };
}
