/**
 * LAS MUESTRAS GEOQUÍMICAS DE JICA — cada punto donde se tomó una roca, un sedimento de quebrada
 * (alveo) o un mineral, con sus leyes.
 *
 * Salen de las tablas «Resultados de Análisis Químicos» de los informes de las Fases I, II y III
 * (JICA-MMAJ), leídas del OCR: código de la muestra, coordenadas UTM en metros (zona 16, NAD27,
 * referidas al mapa topográfico 1:50 000) y Au en ppb, Ag As Cu Hg Mo Pb Sb Zn en ppm.
 *
 * Tabla propia y no una capa más: son números que se comparan («¿dónde hay Au sobre 100 ppb cerca
 * de esta concesión?»), no rasgos con atributos de texto.
 *
 * Los límites del laboratorio se guardan tal cual: «<5» es menor que el límite de detección y
 * «>10000» es sobre el tope de medición. El valor numérico es el del límite, y `limites` dice
 * cuál de los dos fue, para no presentar un «<5» como si fueran 5 ppb.
 */
import { type Express, type Request, type Response } from 'express';
import { exigirPlataforma, identidadDe, limitar } from '../seguridad';
import { nivelDe } from '../../lib/acceso';
import { consulta, hayBase } from './db';

export const ELEMENTOS = ['au', 'ag', 'as', 'cu', 'hg', 'mo', 'pb', 'sb', 'zn'] as const;
export type Elemento = (typeof ELEMENTOS)[number];
export const UNIDAD: Record<Elemento, string> = { au: 'ppb', ag: 'ppm', as: 'ppm', cu: 'ppm', hg: 'ppm', mo: 'ppm', pb: 'ppm', sb: 'ppm', zn: 'ppm' };
const TIPOS = ['roca', 'sedimento', 'mineral'] as const;
/** Nombre de columna: «as» es palabra reservada de SQL. */
const col = (e: Elemento) => (e === 'as' ? 'as_' : e);

let lista: Promise<void> | null = null;

/** La tabla, una vez por proceso. Idempotente. */
export function asegurarMuestras(): Promise<void> {
  if (!lista) {
    lista = consulta(
      `CREATE TABLE IF NOT EXISTS muestra_geoquimica (
         id        bigserial PRIMARY KEY,
         codigo    text NOT NULL,
         tipo      text NOT NULL CHECK (tipo IN ('roca', 'sedimento', 'mineral')),
         fuente    text NOT NULL,
         utm_e     integer NOT NULL,
         utm_n     integer NOT NULL,
         datum     text NOT NULL DEFAULT 'NAD27 UTM 16N',
         geom      geometry(Point, 4326) NOT NULL,
         au double precision, ag double precision, as_ double precision, cu double precision,
         hg double precision, mo double precision, pb double precision, sb double precision,
         zn double precision,
         limites   jsonb NOT NULL DEFAULT '{}'::jsonb,
         completa  boolean NOT NULL DEFAULT true,
         lugar     text,
         cargada   timestamptz NOT NULL DEFAULT now(),
         UNIQUE (codigo, utm_e, utm_n, fuente)
       );
       CREATE INDEX IF NOT EXISTS muestra_geoquimica_geom_idx ON muestra_geoquimica USING gist (geom);`
    )
      .then(() => undefined)
      .catch((e) => {
        lista = null;
        throw e;
      });
  }
  return lista;
}

type Ley = { v: number; menor?: boolean; mayor?: boolean };
export type MuestraEntrada = {
  codigo: string;
  tipo: string;
  fuente: string;
  e: number;
  n: number;
  lon: number;
  lat: number;
  completa?: boolean;
  lugar?: string;
} & Partial<Record<Elemento, Ley>>;

/** Una fila que se puede guardar, o el motivo por el que no. */
function validar(m: MuestraEntrada): string | null {
  if (!m || typeof m !== 'object') return 'no es un objeto';
  if (typeof m.codigo !== 'string' || !/^[A-Z0-9]{2,20}$/.test(m.codigo)) return 'código inválido';
  if (!TIPOS.includes(m.tipo as any)) return 'tipo inválido';
  if (typeof m.fuente !== 'string' || !m.fuente.trim() || m.fuente.length > 120) return 'fuente inválida';
  if (!Number.isInteger(m.e) || m.e < 100_000 || m.e > 900_000) return 'UTM E fuera de rango';
  if (!Number.isInteger(m.n) || m.n < 1_300_000 || m.n > 1_900_000) return 'UTM N fuera de rango';
  if (!(m.lon > -89.5 && m.lon < -83) || !(m.lat > 12.8 && m.lat < 16.6)) return 'fuera de Honduras';
  for (const e of ELEMENTOS) {
    const l = m[e];
    if (l === undefined) continue;
    if (!l || !Number.isFinite(l.v) || l.v < 0 || l.v > 1e6) return `ley de ${e} inválida`;
  }
  if (!ELEMENTOS.some((e) => m[e])) return 'sin ninguna ley';
  return null;
}

/**
 * Carga (o actualiza) muestras. La llave es código + coordenadas + fuente: volver a cargar la misma
 * tabla corrige los valores en vez de duplicar los puntos.
 */
export async function cargarMuestras(filas: MuestraEntrada[]): Promise<{ guardadas: number; rechazadas: Array<{ fila: number; motivo: string }> }> {
  await asegurarMuestras();
  const rechazadas: Array<{ fila: number; motivo: string }> = [];
  const buenas: MuestraEntrada[] = [];
  filas.forEach((m, i) => {
    const mal = validar(m);
    if (mal) rechazadas.push({ fila: i, motivo: mal });
    else buenas.push(m);
  });
  const LOTE = 400;
  for (let i = 0; i < buenas.length; i += LOTE) {
    const lote = buenas.slice(i, i + LOTE);
    const params: unknown[] = [];
    const valores = lote.map((m) => {
      const limites: Record<string, '<' | '>'> = {};
      for (const e of ELEMENTOS) {
        if (m[e]?.menor) limites[e] = '<';
        else if (m[e]?.mayor) limites[e] = '>';
      }
      const fila = [
        m.codigo,
        m.tipo,
        m.fuente.trim(),
        m.e,
        m.n,
        m.lon,
        m.lat,
        ...ELEMENTOS.map((e) => (m[e] ? m[e]!.v : null)),
        JSON.stringify(limites),
        m.completa !== false,
        m.lugar ? String(m.lugar).slice(0, 80) : null,
      ];
      const base = params.length;
      params.push(...fila);
      const p = (k: number) => `$${base + k}`;
      return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ST_SetSRID(ST_MakePoint(${p(6)}, ${p(7)}), 4326), ${ELEMENTOS.map((_, k) => p(8 + k)).join(', ')}, ${p(17)}::jsonb, ${p(18)}, ${p(19)})`;
    });
    await consulta(
      `INSERT INTO muestra_geoquimica (codigo, tipo, fuente, utm_e, utm_n, geom, ${ELEMENTOS.map(col).join(', ')}, limites, completa, lugar)
       VALUES ${valores.join(', ')}
       ON CONFLICT (codigo, utm_e, utm_n, fuente) DO UPDATE SET
         tipo = EXCLUDED.tipo, geom = EXCLUDED.geom, ${ELEMENTOS.map((e) => `${col(e)} = EXCLUDED.${col(e)}`).join(', ')},
         limites = EXCLUDED.limites, completa = EXCLUDED.completa, lugar = EXCLUDED.lugar, cargada = now()`,
      params
    );
  }
  memoriaMapa = null;
  return { guardadas: buenas.length, rechazadas };
}

/** «<5 ppb», «>10000 ppm», «214 ppm», o null si no se midió. */
export function textoLey(e: Elemento, v: number | null, limite?: string): string | null {
  if (v === null || v === undefined) return null;
  const n = v >= 100 ? Math.round(v).toLocaleString('es-HN') : String(Number(v.toPrecision(3)));
  return `${limite === '<' || limite === '>' ? limite : ''}${n} ${UNIDAD[e]}`;
}

let memoriaMapa: { cuando: number; datos: unknown } | null = null;

/**
 * Todas las muestras para pintarlas: un GeoJSON chico (~2 800 puntos). Por punto van solo el id,
 * el código, el tipo y las leyes para colorear; lo bajo el límite de detección va como 0 (no hay
 * nada que pintar) y lo que pasa del tope, con su tope.
 */
export async function muestrasParaMapa(): Promise<unknown> {
  if (memoriaMapa && Date.now() - memoriaMapa.cuando < 10 * 60_000) return memoriaMapa.datos;
  await asegurarMuestras();
  const filas = await consulta<any>(
    `SELECT id, codigo, tipo, round(ST_X(geom)::numeric, 6)::float AS lon, round(ST_Y(geom)::numeric, 6)::float AS lat,
            ${ELEMENTOS.map(col).join(', ')}, limites
       FROM muestra_geoquimica ORDER BY id`
  );
  const datos = {
    type: 'FeatureCollection',
    features: filas.map((f) => {
      const props: Record<string, unknown> = { id: Number(f.id), c: f.codigo, t: f.tipo };
      for (const e of ELEMENTOS) {
        const v = f[col(e)];
        if (v === null || v === undefined) continue;
        props[e] = f.limites?.[e] === '<' ? 0 : Number(v);
      }
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: props };
    }),
  };
  memoriaMapa = { cuando: Date.now(), datos };
  return datos;
}

export type MuestraFicha = {
  id: number;
  codigo: string;
  tipo: string;
  fuente: string;
  datum: string;
  utm: [number, number];
  lon: number;
  lat: number;
  lugar: string | null;
  completa: boolean;
  leyes: Array<[string, string]>;
  concesiones: Array<{ id: number; nombre: string }>;
};

const NOMBRE_TIPO: Record<string, string> = { roca: 'Roca', sedimento: 'Sedimento de quebrada (alveo)', mineral: 'Mineral' };

/** La tarjeta de una muestra: leyes con sus límites, y en qué concesión cae. */
export async function muestraFicha(id: number): Promise<MuestraFicha | null> {
  await asegurarMuestras();
  const [f] = await consulta<any>(
    `SELECT id, codigo, tipo, fuente, datum, utm_e, utm_n, ST_X(geom) AS lon, ST_Y(geom) AS lat, lugar, completa,
            ${ELEMENTOS.map(col).join(', ')}, limites
       FROM muestra_geoquimica WHERE id = $1`,
    [id]
  );
  if (!f) return null;
  const leyes: Array<[string, string]> = [];
  for (const e of ELEMENTOS) {
    const t = textoLey(e, f[col(e)] === null ? null : Number(f[col(e)]), f.limites?.[e]);
    if (t) leyes.push([e === 'as' ? 'As' : e[0].toUpperCase() + e.slice(1), t]);
  }
  // En qué concesión cae (si la tabla de concesiones está). Un fallo aquí no tumba la tarjeta.
  const concesiones = await consulta<{ id: number; nombre: string }>(
    `SELECT id, nombre FROM concesion WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) ORDER BY nombre LIMIT 5`,
    [Number(f.lon), Number(f.lat)]
  ).catch(() => []);
  return {
    id: Number(f.id),
    codigo: f.codigo,
    tipo: NOMBRE_TIPO[f.tipo] || f.tipo,
    fuente: f.fuente,
    datum: f.datum,
    utm: [f.utm_e, f.utm_n],
    lon: Number(f.lon),
    lat: Number(f.lat),
    lugar: f.lugar,
    completa: !!f.completa,
    leyes,
    concesiones: concesiones.map((c) => ({ id: Number(c.id), nombre: c.nombre })),
  };
}

/**
 * Las muestras cerca de un punto (o dentro de una concesión), ordenadas por la ley pedida. Es lo
 * que usa Dr Electrum para contestar «¿qué leyes hay cerca de…?».
 */
export async function muestrasCerca(o: {
  lon?: number;
  lat?: number;
  concesionId?: number;
  radioKm?: number;
  elemento?: Elemento;
  minimo?: number;
  limite?: number;
}): Promise<{ total: number; muestras: Array<{ id: number; codigo: string; tipo: string; km: number | null; ley: string | null; leyes: string; fuente: string }> }> {
  await asegurarMuestras();
  const elemento: Elemento = o.elemento && ELEMENTOS.includes(o.elemento) ? o.elemento : 'au';
  const radio = Math.min(Math.max(Number(o.radioKm) || 5, 0.1), 50) * 1000;
  const limite = Math.min(Math.max(Math.floor(Number(o.limite) || 15), 1), 50);
  const c = col(elemento);
  const params: unknown[] = [];
  let donde: string;
  let distancia: string;
  if (o.concesionId) {
    params.push(o.concesionId, radio);
    donde = `ST_DWithin(m.geom::geography, (SELECT geom FROM concesion WHERE id = $1)::geography, $2)`;
    distancia = `ST_Distance(m.geom::geography, (SELECT geom FROM concesion WHERE id = $1)::geography) / 1000`;
  } else if (Number.isFinite(o.lon) && Number.isFinite(o.lat)) {
    params.push(o.lon, o.lat, radio);
    donde = `ST_DWithin(m.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`;
    distancia = `ST_Distance(m.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000`;
  } else {
    donde = 'true';
    distancia = 'NULL::float';
  }
  let filtro = '';
  if (Number.isFinite(o.minimo) && Number(o.minimo) > 0) {
    params.push(o.minimo);
    filtro = ` AND m.${c} >= $${params.length} AND coalesce(m.limites->>'${elemento}', '') <> '<'`;
  }
  const filas = await consulta<any>(
    `SELECT m.id, m.codigo, m.tipo, m.fuente, ${distancia} AS km, ${ELEMENTOS.map((e) => `m.${col(e)}`).join(', ')}, m.limites,
            count(*) OVER () AS total
       FROM muestra_geoquimica m
      WHERE ${donde}${filtro}
      ORDER BY (coalesce(m.limites->>'${elemento}', '') = '<'), m.${c} DESC NULLS LAST, km NULLS LAST
      LIMIT ${limite}`,
    params
  );
  return {
    total: filas.length ? Number(filas[0].total) : 0,
    muestras: filas.map((f) => ({
      id: Number(f.id),
      codigo: f.codigo,
      tipo: f.tipo,
      km: f.km === null ? null : Math.round(Number(f.km) * 100) / 100,
      ley: textoLey(elemento, f[c] === null ? null : Number(f[c]), f.limites?.[elemento]),
      leyes: ELEMENTOS.map((e) => {
        const t = textoLey(e, f[col(e)] === null ? null : Number(f[col(e)]), f.limites?.[e]);
        return t ? `${e === 'as' ? 'As' : e[0].toUpperCase() + e.slice(1)} ${t}` : null;
      })
        .filter(Boolean)
        .join(', '),
      fuente: f.fuente,
    })),
  };
}

export function montarRutasMuestras(app: Express) {
  const E = exigirPlataforma('electrum');
  const sinBase = (res: Response) => res.status(503).json({ error: 'El catastro no está conectado en este servidor.', code: 'sin_base', honesto: true });
  const fallo = (res: Response, que: string, e: any) => {
    console.error('[muestras]', que, String(e?.message || e).slice(0, 200));
    return res.status(500).json({ error: `No pude ${que}.`, honesto: true });
  };

  app.get('/api/electrum/mapa/muestras', E, limitar(60), async (_req: Request, res: Response) => {
    if (!hayBase()) return sinBase(res);
    try {
      return res.json(await muestrasParaMapa());
    } catch (e) {
      return fallo(res, 'traer las muestras', e);
    }
  });

  app.get('/api/electrum/mapa/muestra/:id', E, limitar(120), async (req: Request, res: Response) => {
    if (!hayBase()) return sinBase(res);
    const id = Math.floor(Number(req.params.id));
    if (!(id > 0)) return res.status(400).json({ error: 'Id inválido.', honesto: true });
    try {
      const f = await muestraFicha(id);
      if (!f) return res.status(404).json({ error: 'Esa muestra ya no está.', honesto: true });
      return res.json(f);
    } catch (e) {
      return fallo(res, 'traer la muestra', e);
    }
  });

  // Cargar (o corregir) muestras: un arreglo JSON, como el que sale de leer las tablas de JICA.
  app.post('/api/electrum/muestras/cargar', E, limitar(10), async (req: Request, res: Response) => {
    if (!hayBase()) return sinBase(res);
    const nivel = nivelDe(identidadDe(req), 'electrum');
    if (nivel !== 'escribe' && nivel !== 'mando') {
      return res.status(403).json({ error: 'Tu acceso es de consulta: podés mirar, pero no cambiar nada.', code: 'nivel_insuficiente', honesto: true });
    }
    const filas = Array.isArray(req.body?.muestras) ? req.body.muestras : null;
    if (!filas || !filas.length) return res.status(400).json({ error: 'Mandá { muestras: [...] }.', honesto: true });
    if (filas.length > 20_000) return res.status(413).json({ error: 'Demasiadas muestras de una vez (máximo 20 000).', honesto: true });
    try {
      const r = await cargarMuestras(filas);
      return res.json({ ok: true, guardadas: r.guardadas, rechazadas: r.rechazadas.length, motivos: r.rechazadas.slice(0, 20), honesto: true });
    } catch (e) {
      return fallo(res, 'guardar las muestras', e);
    }
  });
}

/**
 * Lo medido en una zona, en texto para Dr Electrum: cuántas muestras de JICA hay en la zona (y a
 * `radioKm` alrededor), las de más oro y el máximo de cada metal base, con código y distancia.
 * Vacío si no hay ninguna muestra cargada en todo el servidor (no es «no hay»: es «no se cargó»).
 */
const PLURAL: Record<string, string> = { roca: 'rocas', sedimento: 'sedimentos', mineral: 'minerales' };

export async function muestrasDeZonaEnTexto(geojson: unknown, radioKm: number): Promise<string> {
  await asegurarMuestras();
  const [{ hay }] = await consulta<{ hay: boolean }>(`SELECT EXISTS (SELECT 1 FROM muestra_geoquimica) AS hay`);
  if (!hay) return '';
  const radio = Math.max(0, Math.min(50, Number(radioKm) || 0)) * 1000;
  const zona = `ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)`;
  const filas = await consulta<any>(
    `SELECT codigo, tipo, ST_Distance(geom::geography, ${zona}::geography) / 1000 AS km, ${ELEMENTOS.map(col).join(', ')}, limites
       FROM muestra_geoquimica
      WHERE ST_DWithin(geom::geography, ${zona}::geography, $2)`,
    [JSON.stringify(geojson), radio]
  );
  const donde = radio ? `en la zona y a ${radio / 1000} km alrededor` : 'en la zona';
  if (!filas.length) return `MUESTRAS GEOQUÍMICAS JICA: ninguna ${donde} (el muestreo de JICA cubre solo las zonas de las Fases I–III).`;
  const ley = (f: any, e: Elemento) => (f[col(e)] === null ? null : { v: Number(f[col(e)]), bajo: f.limites?.[e] === '<', t: textoLey(e, Number(f[col(e)]), f.limites?.[e]) });
  const lejos = (f: any) => (Number(f.km) < 0.05 ? 'dentro' : `a ${Number(f.km).toFixed(1)} km`);
  const tipos = ['roca', 'sedimento', 'mineral'].map((t) => [t, filas.filter((f) => f.tipo === t).length] as const).filter(([, n]) => n);
  const conOro = filas.filter((f) => ley(f, 'au') && !ley(f, 'au')!.bajo).sort((a, b) => ley(b, 'au')!.v - ley(a, 'au')!.v);
  const l: string[] = [`MUESTRAS GEOQUÍMICAS JICA ${donde}: ${filas.length} (${tipos.map(([t, n]) => `${n} ${n === 1 ? t : PLURAL[t]}`).join(', ')}).`];
  l.push(
    conOro.length
      ? `Más oro: ${conOro
          .slice(0, 5)
          .map((f) => `${f.codigo} (${f.tipo}, ${lejos(f)}) Au ${ley(f, 'au')!.t}${ley(f, 'ag') ? `, Ag ${ley(f, 'ag')!.t}` : ''}`)
          .join('; ')}.`
      : `Oro: todas bajo el límite de detección o sin medir.`
  );
  const maximos = (['ag', 'cu', 'pb', 'zn', 'as'] as Elemento[])
    .map((e) => {
      const f = filas.filter((x) => ley(x, e) && !ley(x, e)!.bajo).sort((a, b) => ley(b, e)!.v - ley(a, e)!.v)[0];
      return f ? `${e === 'as' ? 'As' : e[0].toUpperCase() + e[1]} ${ley(f, e)!.t} (${f.codigo})` : null;
    })
    .filter(Boolean);
  if (maximos.length) l.push(`Máximos: ${maximos.join(', ')}.`);
  l.push('«<» es bajo el límite de detección y «>» sobre el tope del laboratorio. Coordenadas UTM 16N NAD27; leyes leídas del OCR del informe: si una cifra decide algo, verificala en la tabla original.');
  return l.join('\n');
}
