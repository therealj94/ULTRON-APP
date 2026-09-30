/**
 * RESTRICCIONES — lo que puede impedir trabajar una concesión, con su base legal y un semáforo.
 *
 * El entorno (entorno.ts) dice cuántas hectáreas pisa de cada capa. Para decidir hace falta más:
 * de QUÉ parte del área protegida (núcleo o amortiguamiento), por qué decreto, si la microcuenca
 * está declarada o en trámite y a cuánta gente le da agua, qué régimen tiene el patrimonio
 * forestal. Todo eso viene en los .dbf de ICF (AREAS PROTEGIDAS, MICROCUENCAS DECLARADAS,
 * PATRIMONIO PUBLICO FORESTAL) y hasta ahora se tiraba.
 *
 * El semáforo es una GUÍA para priorizar, no un dictamen:
 *
 *  · ROJO   Ley General de Minería (Decreto 238-2012), Art. 48 a): «En ningún caso la Autoridad
 *           Minera otorgará derechos mineros» en las Áreas Protegidas declaradas ni en las zonas
 *           productoras de agua declaradas. Pisar un área protegida declarada (núcleo o no) o una
 *           microcuenca declarada/aprobada es rojo.
 *  · ÁMBAR  microcuenca en proceso de declaratoria, patrimonio público forestal (requiere ICF;
 *           su régimen «área protegida» no es la declaratoria, que la da la capa de áreas protegidas),
 *           caseríos dentro (socialización y consulta), traslape con derechos de terceros.
 *  · VERDE  nada de lo anterior EN LAS CAPAS CARGADAS, y todas cargadas. Si falta alguna y no se
 *           encontró nada, el nivel es `incompleto`, no verde.
 *
 * Todo sale de PostGIS, set a set: la cartera entera (90 zonas) se revisa en tres consultas, no
 * en noventa.
 */
import { conTextoReparado, consultaConTope, hayBase } from './db';
import { capasPorRol } from './entorno';

/**
 * `incompleto`: no se encontró nada, pero falta alguna capa de restricción: no se puede decir verde
 * (sin la capa de áreas protegidas, «no pisa ninguna» no es un dato, es una ausencia de dato).
 */
export type Nivel = 'rojo' | 'ambar' | 'verde' | 'incompleto';
type NivelItem = 'rojo' | 'ambar';
export type TipoRestriccion = 'area_protegida' | 'microcuenca' | 'forestal' | 'poblados' | 'traslape';

export type Restriccion = {
  tipo: TipoRestriccion;
  nombre: string;
  nivel: NivelItem;
  ha: number;
  pct: number;
  /** Zona del área protegida (Núcleo, Amortiguamiento…), estado de la microcuenca, régimen forestal. */
  zona: string | null;
  /** Decreto, acuerdo o resolución que la declara. */
  instrumento: string | null;
  /** Lo demás que ayuda a decidir: categoría, población abastecida, co-manejador… */
  detalle: string | null;
  motivo: string;
};

export type Restricciones = {
  concesionId: number;
  nombre: string;
  hectareas: number;
  nivel: Nivel;
  items: Restriccion[];
  /** Capas que no están cargadas: sin ellas el verde no vale. */
  sinRevisar: string[];
};

export const BASE_LEGAL =
  'Ley General de Minería (Decreto 238-2012), Art. 48 a): no se otorgan derechos mineros en Áreas Protegidas declaradas ni en zonas productoras de agua declaradas.';

/** Menos que esto es ruido de digitalización en el borde, no una restricción. */
const MIN_HA = 0.05;
const MIN_PCT = 0.5;

const TOPE_MS = 20_000;
const consulta = <T = any>(sql: string, params: unknown[] = []) => consultaConTope<T>(sql, params, TOPE_MS).then(conTextoReparado);

const r2 = (x: number) => Math.round(x * 100) / 100;

/** El primer atributo del .dbf cuyo nombre case con el patrón y tenga texto de verdad. */
const ATR = (patron: string) =>
  `(SELECT nullif(trim(a.v), '') FROM jsonb_each_text(e.atributos) AS a(k, v)
     WHERE a.k ~* '${patron}' AND a.v ~ '[A-Za-z0-9]' AND a.v !~* '^(no definido|no tiene|n/?t|n/?a|nan|none|sin numero)$' LIMIT 1)`;

/** Qué se lee de cada capa. Los nombres son los de ICF; los patrones aceptan variantes. */
/** El nombre que puso el cargador (primera columna de nombre del .dbf), si es un nombre de verdad. */
const NOMBRE_CARGADOR = `(CASE WHEN e.nombre ~ '[A-Za-z]' AND e.nombre !~* '^entidad [0-9]+$' THEN trim(e.nombre) END)`;
/** Varios atributos EN ORDEN de preferencia: el primero que tenga valor. */
const PRIMERO = (...patrones: string[]) => `coalesce(${patrones.map(ATR).join(', ')})`;

const LECTURA: Record<'area_protegida' | 'microcuenca' | 'forestal', { nombre: string; zona: string; instrumento: string; detalle: string[] }> = {
  area_protegida: {
    nombre: `coalesce(${NOMBRE_CARGADOR}, ${PRIMERO('^nomb_ap$', '^nombre_ap$', '^nombre$', '^nom_ap$')})`,
    zona: ATR('^zona$'),
    instrumento: ATR('^(inst_decla|decreto|instrumento)'),
    detalle: [ATR('^categor'), ATR('^(nomb_coma|comanej)'), ATR('^vigen_pm')],
  },
  microcuenca: {
    nombre: `coalesce(${NOMBRE_CARGADOR}, ${PRIMERO('^nomb_micro$', '^nombre$', '^nom_micro$')})`,
    zona: `(CASE upper(${ATR('^estado$')}) WHEN 'APR' THEN 'declarada' WHEN 'ENP' THEN 'en proceso' ELSE lower(${ATR('^estado$')}) END)`,
    instrumento: ATR('^(num_acuer|acuerdo)'),
    detalle: [
      `(SELECT 'abastece a ' || a.v || ' personas' FROM jsonb_each_text(e.atributos) AS a(k, v) WHERE a.k ~* '^pobla' AND a.v ~ '^[1-9][0-9]*(\\.0+)?$' LIMIT 1)`,
      `(SELECT a.v || ' familias' FROM jsonb_each_text(e.atributos) AS a(k, v) WHERE a.k ~* '^fami' AND a.v ~ '^[1-9][0-9]*(\\.0+)?$' LIMIT 1)`,
      `(SELECT 'cuenca ' || a.v FROM jsonb_each_text(e.atributos) AS a(k, v) WHERE a.k ~* '^cuen' AND a.v ~ '[A-Za-z]' LIMIT 1)`,
    ],
  },
  forestal: {
    nombre: `coalesce(${NOMBRE_CARGADOR}, ${PRIMERO('^nom_area$', '^nombre$', '^nom$')})`,
    zona: ATR('^regim'),
    instrumento: ATR('^(acuer_regu|inst_legal|resoluc)'),
    detalle: [ATR('^nom_propi')],
  },
};

/** Las concesiones a revisar, con su geometría. */
const FUENTE = `src AS (SELECT id, nombre, geom, (ST_Area(geom::geography) / 10000.0) AS ha FROM concesion WHERE id = ANY($1::bigint[]))`;
const VALIDA = `CASE WHEN ST_IsValid(e.geom) THEN e.geom ELSE ST_CollectionExtract(ST_MakeValid(e.geom), 3) END`;

type Fila = { cid: string; nombre: string | null; zona: string | null; instrumento: string | null; detalle: string | null; ha: number; ha_c: number };

async function cruzar(ids: number[], capas: number[], rol: keyof typeof LECTURA): Promise<Fila[]> {
  if (!capas.length || !ids.length) return [];
  const L = LECTURA[rol];
  /*
   * Se agrupa por concesión, nombre y zona ANTES de medir: el núcleo y el amortiguamiento de un
   * mismo parque son dos restricciones distintas, y dos rasgos solapados del mismo parque no
   * cuentan dos veces la misma hectárea.
   */
  return consulta<Fila>(
    `WITH ${FUENTE},
     t AS (
       SELECT s.id AS cid, s.ha AS ha_c,
              ${L.nombre} AS nombre, ${L.zona} AS zona, ${L.instrumento} AS instrumento,
              concat_ws(' · ', ${L.detalle.join(', ')}) AS detalle,
              ${VALIDA} AS g
         FROM src s JOIN entidad_geo e ON e.capa_id = ANY($2::bigint[]) AND e.geom && s.geom
        WHERE ST_Dimension(e.geom) = 2 AND ST_Intersects(e.geom, s.geom)
     )
     SELECT cid::text, nombre, zona, min(instrumento) AS instrumento, min(nullif(detalle, '')) AS detalle,
            max(ha_c)::float8 AS ha_c,
            (ST_Area(ST_Intersection((SELECT geom FROM src WHERE src.id = t.cid), ST_Union(g))::geography) / 10000.0)::float8 AS ha
       FROM t GROUP BY cid, nombre, zona`,
    [ids, capas]
  );
}

/** Caseríos y aldeas DENTRO, y traslapes con derechos de otro titular, en bloque. */
async function socialesYTerceros(ids: number[], poblados: number[]) {
  const [pob, tras] = await Promise.all([
    poblados.length
      ? consulta<{ cid: string; n: number; nombres: string | null }>(
          `WITH ${FUENTE}
           SELECT s.id::text AS cid, count(*)::int AS n,
                  string_agg(DISTINCT coalesce(${ATR('^(nom_?cas|nom_?ald|caserio|aldea|nombre|nom|comunid)')}, e.nombre), ', ') AS nombres
             FROM src s JOIN entidad_geo e ON e.capa_id = ANY($2::bigint[]) AND e.geom && s.geom
            WHERE ST_Intersects(e.geom, s.geom)
            GROUP BY s.id`,
          [ids, poblados]
        )
      : Promise.resolve([]),
    consulta<{ cid: string; con: string; titular: string | null; ha: number; ha_c: number }>(
      `WITH ${FUENTE}
       SELECT s.id::text AS cid, o.nombre AS con, o.titular, s.ha::float8 AS ha_c,
              (ST_Area(ST_Intersection(s.geom, o.geom)::geography) / 10000.0)::float8 AS ha
         FROM src s JOIN concesion o ON o.id <> s.id AND o.geom && s.geom AND ST_Intersects(o.geom, s.geom)
        WHERE coalesce(lower(o.titular), '') <> coalesce(lower((SELECT titular FROM concesion WHERE id = s.id)), '')`,
      [ids]
    ),
  ]);
  return { pob, tras };
}

function nivelDe(rol: TipoRestriccion, zona: string | null): NivelItem {
  const z = (zona || '').toLowerCase();
  if (rol === 'area_protegida') return 'rojo';
  if (rol === 'microcuenca') return /proceso/.test(z) ? 'ambar' : 'rojo';
  // El régimen «área protegida» del catálogo forestal no es la declaratoria: el rojo lo da la capa
  // de áreas protegidas, que es la que dice si está declarada. Aquí queda ámbar.
  if (rol === 'forestal') return 'ambar';
  return 'ambar';
}

function motivoDe(rol: TipoRestriccion, zona: string | null): string {
  const z = (zona || '').toLowerCase();
  switch (rol) {
    case 'area_protegida':
      return /n[uú]cleo/.test(z)
        ? 'Zona núcleo de un área protegida declarada: exclusión (Art. 48 a) LGM).'
        : `Área protegida declarada${zona ? ` (zona ${zona})` : ''}: exclusión según Art. 48 a) LGM; cualquier actividad exige revisar el plan de manejo con ICF.`;
    case 'microcuenca':
      return /proceso/.test(z)
        ? 'Microcuenca en proceso de declaratoria: si se declara, pasa a zona productora de agua excluida (Art. 48 a) LGM).'
        : 'Microcuenca declarada abastecedora de agua: zona productora de agua excluida (Art. 48 a) LGM).';
    case 'forestal':
      return /protegid/.test(z)
        ? 'Patrimonio público forestal con régimen de área protegida: confirmar con ICF si está declarada (si lo está, es exclusión por Art. 48 a) LGM).'
        : 'Patrimonio público forestal: el uso lo autoriza ICF y puede haber contrato de manejo con terceros.';
    case 'poblados':
      return 'Caseríos dentro: socialización y consulta previa antes de cualquier trabajo.';
    case 'traslape':
      return 'Se pisa con un derecho de otro titular: conflicto a resolver ante INHGEOMIN.';
  }
}

/**
 * Las restricciones de varias concesiones a la vez (una ficha, o una cartera entera).
 * Devuelve una entrada por concesión que exista, en el orden pedido.
 */
export async function restriccionesDe(idsPedidos: number[]): Promise<Restricciones[]> {
  if (!hayBase()) return [];
  const ids = [...new Set(idsPedidos.map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length) return [];
  const capas = await capasPorRol();
  const de = (rol: string) => capas.filter((c) => c.rol === rol).map((c) => c.id);

  const [cab, ap, mc, fo, st] = await Promise.all([
    consulta<{ id: string; nombre: string; ha: number }>(
      `SELECT id::text, nombre, (ST_Area(geom::geography) / 10000.0)::float8 AS ha FROM concesion WHERE id = ANY($1::bigint[])`,
      [ids]
    ),
    cruzar(ids, de('area_protegida'), 'area_protegida'),
    cruzar(ids, de('microcuenca'), 'microcuenca'),
    cruzar(ids, de('forestal'), 'forestal'),
    socialesYTerceros(ids, de('poblado')),
  ]);

  const sinRevisar = (
    [
      ['area_protegida', 'áreas protegidas'],
      ['microcuenca', 'microcuencas declaradas'],
      ['forestal', 'patrimonio público forestal'],
      ['poblado', 'caseríos y aldeas'],
    ] as const
  )
    .filter(([rol]) => !de(rol).length)
    .map(([, n]) => n);

  const porId = new Map<string, Restriccion[]>();
  const agregar = (cid: string, r: Restriccion) => porId.set(cid, [...(porId.get(cid) || []), r]);
  for (const [rol, filas] of [
    ['area_protegida', ap],
    ['microcuenca', mc],
    ['forestal', fo],
  ] as const) {
    for (const f of filas) {
      const pct = f.ha_c > 0 ? (f.ha / f.ha_c) * 100 : 0;
      if (!(f.ha >= MIN_HA) || pct < MIN_PCT) continue;
      agregar(f.cid, {
        tipo: rol,
        nombre: f.nombre || 'sin nombre en la capa',
        nivel: nivelDe(rol, f.zona),
        ha: r2(f.ha),
        pct: r2(pct),
        zona: f.zona,
        instrumento: f.instrumento,
        detalle: f.detalle,
        motivo: motivoDe(rol, f.zona),
      });
    }
  }
  for (const p of st.pob) {
    agregar(p.cid, { tipo: 'poblados', nombre: p.nombres || `${p.n} poblados`, nivel: 'ambar', ha: 0, pct: 0, zona: null, instrumento: null, detalle: `${p.n} dentro`, motivo: motivoDe('poblados', null) });
  }
  for (const t of st.tras) {
    const pct = t.ha_c > 0 ? (t.ha / t.ha_c) * 100 : 0;
    if (!(t.ha >= MIN_HA) || pct < MIN_PCT) continue;
    agregar(t.cid, { tipo: 'traslape', nombre: t.con, nivel: 'ambar', ha: r2(t.ha), pct: r2(pct), zona: null, instrumento: null, detalle: t.titular, motivo: motivoDe('traslape', null) });
  }

  const orden = new Map(ids.map((id, i) => [String(id), i]));
  return cab
    .map((c) => {
      const items = (porId.get(c.id) || []).sort((a, b) => (a.nivel === b.nivel ? b.ha - a.ha : a.nivel === 'rojo' ? -1 : 1));
      const nivel: Nivel = items.some((i) => i.nivel === 'rojo') ? 'rojo' : items.length ? 'ambar' : sinRevisar.length ? 'incompleto' : 'verde';
      return { concesionId: Number(c.id), nombre: c.nombre, hectareas: r2(c.ha), nivel, items, sinRevisar };
    })
    .sort((a, b) => (orden.get(String(a.concesionId)) ?? 0) - (orden.get(String(b.concesionId)) ?? 0));
}

const nf = (x: number, d = 1) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }).format(x);
const ha1 = (x: number) => `${nf(x)} ha`;
const pc = (x: number) => `${nf(x)} %`;
export const NOMBRE_NIVEL: Record<Nivel, string> = { rojo: 'ROJO', ambar: 'ÁMBAR', verde: 'VERDE', incompleto: 'SIN REVISAR COMPLETO' };

/** Una restricción en una línea, con sus cifras y su instrumento. */
export function lineaRestriccion(r: Restriccion): string {
  const cuanto = r.ha > 0 ? ` ${ha1(r.ha)} (${pc(r.pct)})` : '';
  const que =
    r.tipo === 'area_protegida'
      ? `Área protegida ${r.nombre}${r.zona ? `, zona ${r.zona}` : ''}`
      : r.tipo === 'microcuenca'
        ? `Microcuenca ${r.nombre}${r.zona ? ` (${r.zona})` : ''}`
        : r.tipo === 'forestal'
          ? `Patrimonio forestal ${r.nombre}${r.zona ? ` (${r.zona})` : ''}`
          : r.tipo === 'poblados'
            ? `Poblados dentro: ${r.nombre}`
            : `Traslape con ${r.nombre}${r.detalle ? ` (${r.detalle})` : ''}`;
  const extra = [r.instrumento, r.tipo !== 'traslape' && r.tipo !== 'poblados' ? r.detalle : null].filter(Boolean).join('; ');
  return `[${NOMBRE_NIVEL[r.nivel]}] ${que}:${cuanto}${extra ? ` — ${extra}` : ''}. ${r.motivo}`;
}

/** Las restricciones de una concesión en texto, para que el modelo las cite tal cual. */
export function restriccionesEnTexto(r: Restricciones): string {
  const partes = [`Semáforo de restricciones de ${r.nombre}: ${NOMBRE_NIVEL[r.nivel]}.`];
  if (r.items.length) partes.push(r.items.map(lineaRestriccion).join(' '));
  else partes.push('Sin restricciones en las capas cargadas.');
  if (r.sinRevisar.length) partes.push(`No se pudo revisar (capa no cargada): ${r.sinRevisar.join(', ')}; el verde no cubre eso.`);
  if (r.nivel === 'rojo' || r.nivel === 'ambar') partes.push(`Base: ${BASE_LEGAL} Es una guía para priorizar, no un dictamen: se confirma con ICF e INHGEOMIN.`);
  return partes.join(' ');
}
