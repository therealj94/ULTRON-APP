/**
 * PROSPECTIVIDAD — un puntaje de 0 a 100 por concesión que junta las tres miradas que ya existen:
 *
 *  · Geología (hasta 45): los indicios del análisis geológico (intrusivos, skarn, volcánicas
 *    terciarias, fallas y sus cruces, tracto permisivo del USGS, yacimientos y minas cerca).
 *  · Geoquímica (hasta 30): las muestras de JICA dentro o a menos de 1 km, por clase de ley (los
 *    mismos cortes que colorean el mapa), con más peso al oro y al cobre que a los indicadores.
 *  · Satélite (hasta 25): cuánto del suelo expuesto cae en anomalía de arcillas y de óxidos de
 *    hierro de Sentinel-2, comparado con lo esperable al azar (el 10 % del país está sobre el p90).
 *
 * Lo que no se midió no suma ni resta, y se dice: «sin muestreo» no es «muestras pobres». Por eso
 * cada componente lleva `medido`, y el puntaje trae la cobertura (cuántos puntos se pudieron mirar).
 * Es una guía para ordenar dónde mirar primero, no una estimación de recursos.
 */
import type { Express, Request, Response } from 'express';
import { exigirPlataforma, identidadDe, limitar } from '../seguridad';
import { nivelDe } from '../../lib/acceso';
import { consulta, conTextoReparado, hayBase } from './db';
import { geologiaDe, type Geologia } from './geologia';
import { asegurarMuestras, ELEMENTOS, type Elemento } from './muestras';
import { asegurarSatelite, type SateliteConcesion } from './satelite';
import { CORTES } from '../../src-electrum/mapa/muestras';

export type Componente = { clave: 'geologia' | 'geoquimica' | 'satelite'; nombre: string; puntos: number; max: number; medido: boolean; evidencia: string };
/**
 * `estado`: si hubo con qué evaluar. «No estudiado» no es «muy baja» (auditoría H07): sin ningún
 * componente medido el nivel es «sin datos», y con menos de COBERTURA_MINIMA puntos mirables el
 * puntaje existe pero es «insuficiente» para compararlo con una concesión bien documentada.
 */
export type EstadoProsp = 'sin_datos' | 'insuficiente' | 'evaluado';
export type Prospectividad = { puntaje: number; nivel: 'alta' | 'media' | 'baja' | 'muy baja' | 'sin datos'; cobertura: number; estado?: EstadoProsp; componentes: Componente[]; sello?: string };

/**
 * Versión del algoritmo (auditoría H15). Se sube cuando cambian los pesos, los cortes o las reglas:
 * lo guardado con otra versión deja de contarse y queda pendiente de recalcular.
 */
export const VERSION_PROSPECTIVIDAD = 'p2';

/** Por debajo de esto no se compara en el ranking: solo geología (45) no alcanza. */
export const COBERTURA_MINIMA = 50;

export function estadoDe(cobertura: number): EstadoProsp {
  return cobertura <= 0 ? 'sin_datos' : cobertura < COBERTURA_MINIMA ? 'insuficiente' : 'evaluado';
}
export type MuestraProsp = { codigo: string; tipo: string; km: number; leyes: Partial<Record<Elemento, number | null>>; limites: Record<string, string> | null };

const MAX = { geologia: 45, geoquimica: 30, satelite: 25 } as const;
/** Oro y cobre son lo que se busca; plata y molibdeno acompañan; plomo y zinc, y los indicadores (As, Sb, Hg), guían. */
const PESO: Record<Elemento, number> = { au: 1, cu: 1, ag: 0.8, mo: 0.8, zn: 0.6, pb: 0.6, as: 0.5, sb: 0.5, hg: 0.4 };
const NOMBRE: Record<Elemento, string> = { au: 'Au', ag: 'Ag', cu: 'Cu', pb: 'Pb', zn: 'Zn', as: 'As', sb: 'Sb', hg: 'Hg', mo: 'Mo' };
const r1 = (x: number) => Math.round(x * 10) / 10;
const nf = (x: number, d = 1) => x.toLocaleString('es-HN', { maximumFractionDigits: d });

/** Clase de ley 0–5 con los cortes del mapa; «<» (bajo el límite) es clase 0. */
export function claseLey(e: Elemento, v: number | null | undefined, limite?: string): number {
  if (v == null || !Number.isFinite(v) || limite === '<') return 0;
  return CORTES[e].filter((c) => v >= c).length;
}

function componenteGeologia(g: Geologia | null): Componente {
  const base = { clave: 'geologia' as const, nombre: 'Geología', max: MAX.geologia };
  const medido = !!g && !!(g.fuentes.litologia?.length || g.fuentes.falla?.length || g.fuentes.ocurrencia?.length);
  if (!g || !medido) return { ...base, puntos: 0, medido: false, evidencia: 'No hay mapas geológicos cargados para esta zona.' };
  const i = g.indicios;
  const cumplen = i.criterios.filter((c) => c.cumple);
  return {
    ...base,
    medido: true,
    puntos: r1((Math.min(10, i.puntos) / 10) * MAX.geologia),
    evidencia: cumplen.length
      ? `${i.puntos} puntos de indicios (${i.nivel}): ${cumplen.map((c) => c.clave.replace(/_/g, ' ')).join(', ')}${i.modelos.length ? `; modelos: ${i.modelos.join(', ')}` : ''}.`
      : 'Ningún indicio geológico de los que se miran (intrusivos, fallas, tracto permisivo, yacimientos cerca).',
  };
}

function componenteGeoquimica(ms: MuestraProsp[]): Componente {
  const base = { clave: 'geoquimica' as const, nombre: 'Geoquímica (JICA)', max: MAX.geoquimica };
  if (!ms.length) return { ...base, puntos: 0, medido: false, evidencia: 'Sin muestras de JICA dentro ni a menos de 1 km: no suma ni resta.' };
  const valor = (m: MuestraProsp) => {
    let mejor = 0;
    let quien: { e: Elemento; c: number } | null = null;
    for (const e of ELEMENTOS) {
      const c = claseLey(e, m.leyes[e], m.limites?.[e]);
      const v = (c / 5) * PESO[e];
      if (v > mejor) {
        mejor = v;
        quien = { e, c };
      }
    }
    return { m, v: mejor, quien };
  };
  const vs = ms.map(valor).sort((a, b) => b.v - a.v);
  // «Ley alta»: clase 3 de oro o cobre (≥ 100 ppb Au, ≥ 300 ppm Cu), o su equivalente con el peso de cada elemento.
  const buenas = vs.filter((x) => x.v >= 0.6).length;
  const puntos = r1((vs[0].v * 0.7 + Math.min(1, buenas / 5) * 0.3) * MAX.geoquimica);
  const top = vs.filter((x) => x.quien && x.v > 0).slice(0, 3);
  return {
    ...base,
    medido: true,
    puntos,
    evidencia: `${ms.length} ${ms.length === 1 ? 'muestra' : 'muestras'} a menos de 1 km, ${buenas} con ley alta para su elemento${
      top.length ? `; las mejores: ${top.map((x) => `${x.m.codigo} (${x.m.tipo}${x.m.km < 0.05 ? ', dentro' : `, a ${nf(x.m.km)} km`}) ${NOMBRE[x.quien!.e]} clase ${x.quien!.c} de 5`).join('; ')}` : ''
    }.`,
  };
}

function componenteSatelite(s: SateliteConcesion | null): Componente {
  const base = { clave: 'satelite' as const, nombre: 'Satélite (Sentinel-2)', max: MAX.satelite };
  if (!s) return { ...base, puntos: 0, medido: false, evidencia: 'Todavía no se midió con Sentinel-2.' };
  if (s.ha_expuesto < 2) return { ...base, puntos: 0, medido: false, evidencia: 'Casi todo bajo vegetación: el satélite no ve la roca, así que no suma ni resta.' };
  const suma = (t: number[]) => t[0] + t[1] + t[2];
  // Al azar, el 10 % del suelo expuesto cae sobre el percentil 90 nacional, el 3 % sobre el p97 y el
  // 0,5 % sobre el p99,5: se mide cuánto más que eso, en proporción (no en hectáreas, que crecen con el área).
  const parte = (t: [number, number, number]) => {
    const e = s.ha_expuesto;
    const enriquecimiento = suma(t) / e / 0.1;
    const extremo = t[2] >= 1 && t[2] / e > 0.01 ? 0.3 : t[1] + t[2] >= 1 && (t[1] + t[2]) / e > 0.06 ? 0.15 : 0;
    return Math.min(1, Math.max(0, (enriquecimiento - 1) / 3) * 0.7 + extremo);
  };
  const a = parte(s.arc);
  const f = parte(s.fe);
  return {
    ...base,
    medido: true,
    puntos: r1((0.6 * a + 0.4 * f) * MAX.satelite),
    evidencia: `${nf(s.ha_expuesto)} ha de suelo expuesto; arcillas anómalas en ${nf(suma(s.arc))} ha (${nf((suma(s.arc) / s.ha_expuesto) * 100)} %, al azar sería 10 %), óxidos de hierro en ${nf(suma(s.fe))} ha (${nf((suma(s.fe) / s.ha_expuesto) * 100)} %).`,
  };
}

/** El cálculo, sin base de datos: lo que se prueba. */
export function puntuar(g: Geologia | null, ms: MuestraProsp[], s: SateliteConcesion | null): Prospectividad {
  const componentes = [componenteGeologia(g), componenteGeoquimica(ms), componenteSatelite(s)];
  const puntaje = Math.round(componentes.reduce((t, c) => t + c.puntos, 0));
  const cobertura = componentes.filter((c) => c.medido).reduce((t, c) => t + c.max, 0);
  const estado = estadoDe(cobertura);
  const nivel = estado === 'sin_datos' ? 'sin datos' : puntaje >= 55 ? 'alta' : puntaje >= 35 ? 'media' : puntaje >= 15 ? 'baja' : 'muy baja';
  return { puntaje, nivel, cobertura, estado, componentes };
}

/* ------------------------------------------------------------------ base */

let tabla: Promise<void> | null = null;
function asegurarTabla(): Promise<void> {
  if (!tabla) {
    tabla = consulta(
      `CREATE TABLE IF NOT EXISTS prospectividad_concesion (
         concesion_id bigint PRIMARY KEY REFERENCES concesion(id) ON DELETE CASCADE,
         puntaje   smallint NOT NULL,
         datos     jsonb NOT NULL,
         calculado timestamptz NOT NULL DEFAULT now()
       )`
    )
      .then(() => undefined)
      .catch((e) => {
        tabla = null;
        throw e;
      });
  }
  return tabla;
}

/**
 * El sello de lo que se usó para calcular: versión del algoritmo + estado de la geología (capas con
 * rol geológico) + estado de las muestras. Si alguien carga, borra o reemplaza una capa geológica o
 * un lote de muestras, el sello cambia y lo calculado antes pasa a pendiente, sin borrar nada. El
 * satélite es por concesión y ya borra su fila al recalcularse (satelite.ts).
 */
export async function selloInsumos(): Promise<string> {
  await asegurarMuestras();
  const [g] = await consulta<{ n: number; t: string | null; e: number }>(
    `SELECT count(*)::int AS n, max(subido)::text AS t, coalesce(sum(entidades), 0)::int AS e FROM capa
      WHERE rol IN ('litologia', 'falla', 'placa', 'provincia_geologica', 'tracto_permisivo', 'ocurrencia')`
  );
  const [m] = await consulta<{ n: number; t: string | null }>(`SELECT count(*)::int AS n, max(cargada)::text AS t FROM muestra_geoquimica`);
  return `${VERSION_PROSPECTIVIDAD}|g${g?.n ?? 0}:${g?.e ?? 0}:${g?.t ?? '-'}|m${m?.n ?? 0}:${m?.t ?? '-'}`;
}

async function muestrasDe(id: number): Promise<MuestraProsp[]> {
  await asegurarMuestras();
  const cols = ELEMENTOS.map((e) => (e === 'as' ? 'as_' : e));
  const filas = await consulta<any>(
    `SELECT m.codigo, m.tipo, ST_Distance(m.geom::geography, c.geom::geography) / 1000 AS km, ${cols.map((c) => `m.${c}`).join(', ')}, m.limites
       FROM muestra_geoquimica m, concesion c
      WHERE c.id = $1 AND m.geom && ST_Expand(c.geom, 0.012) AND ST_DWithin(m.geom::geography, c.geom::geography, 1000)`,
    [id]
  );
  return filas.map((f) => ({
    codigo: f.codigo,
    tipo: f.tipo,
    km: Number(f.km),
    leyes: Object.fromEntries(ELEMENTOS.map((e, i) => [e, f[cols[i]] == null ? null : Number(f[cols[i]])])),
    limites: f.limites,
  }));
}

async function sateliteDe(id: number): Promise<SateliteConcesion | null> {
  await asegurarSatelite();
  const [f] = await consulta<{ datos: SateliteConcesion }>(`SELECT datos FROM satelite_concesion WHERE concesion_id = $1`, [id]);
  return f?.datos ?? null;
}

/** Calcula y guarda. Si ya se tiene la geología (la ficha la calcula igual), se pasa y no se repite. */
export async function prospectividadDe(id: number, geo?: Geologia | { error: string } | null): Promise<Prospectividad> {
  const [g, ms, s, sello] = await Promise.all([geo !== undefined ? geo : geologiaDe({ concesion: id }), muestrasDe(id), sateliteDe(id), selloInsumos()]);
  const p = { ...puntuar(g && !('error' in g) ? g : null, ms, s), sello };
  await asegurarTabla();
  await consulta(
    `INSERT INTO prospectividad_concesion (concesion_id, puntaje, datos, calculado) VALUES ($1, $2, $3, now())
     ON CONFLICT (concesion_id) DO UPDATE SET puntaje = EXCLUDED.puntaje, datos = EXCLUDED.datos, calculado = now()`,
    [id, p.puntaje, JSON.stringify(p)]
  );
  return p;
}

export function prospectividadEnRenglones(p: Prospectividad): string[] {
  return [
    estadoDe(p.cobertura) === 'sin_datos'
      ? 'Sin datos para evaluar la prospectividad: no hay geología, muestras ni satélite sobre esta concesión. Eso no es un puntaje bajo, es una zona no estudiada.'
      : `Puntaje ${p.puntaje} de 100 (${p.nivel})${p.cobertura < 100 ? `; se pudieron mirar ${p.cobertura} de los 100 puntos` : ''}${estadoDe(p.cobertura) === 'insuficiente' ? '. Con tan poca evidencia no se compara con concesiones mejor documentadas' : ''}.`,
    ...p.componentes.map((c) => `${c.nombre}: ${c.medido ? `${nf(c.puntos)} de ${c.max}` : 'sin datos'}. ${c.evidencia}`),
    'Es una guía para ordenar dónde mirar primero, no una estimación de recursos.',
  ];
}

/**
 * Puntaje guardado por concesión, para colorear el mapa. `null` = sin datos para evaluar (se pinta
 * aparte, no como «muy baja»). La cobertura se lee de lo guardado, así que las filas viejas que
 * decían «muy baja» sin datos también se corrigen sin recalcular.
 */
export async function puntajesPorConcesion(): Promise<Map<number, number | null>> {
  await asegurarTabla();
  // Lo calculado con otro algoritmo u otros insumos no se pinta: queda como no calculado (H15).
  const filas = await consulta<{ id: string; p: number; cob: number | null }>(
    `SELECT concesion_id::text AS id, puntaje AS p, (datos->>'cobertura')::int AS cob FROM prospectividad_concesion WHERE datos->>'sello' = $1`,
    [await selloInsumos()]
  );
  return new Map(filas.map((f) => [Number(f.id), f.cob != null && f.cob <= 0 ? null : Number(f.p)]));
}

/* ------------------------------------------------------------------ en lote */

type Lote = { corriendo: boolean; hechas: number; total: number; fallidas: number; empezo: string | null; termino: string | null };
const lote: Lote = { corriendo: false, hechas: 0, total: 0, fallidas: 0, empezo: null, termino: null };

/** Todas las concesiones, de a una (la geología es pesada y la base es compartida). */
export async function calcularTodas(opts: { soloFaltantes?: boolean } = {}): Promise<void> {
  if (lote.corriendo) return;
  // Se marca antes del primer await: dos pedidos seguidos no arrancan dos lotes.
  lote.corriendo = true;
  let ids: Array<{ id: string }> = [];
  try {
    await asegurarTabla();
    // «Faltantes» incluye lo vencido: calculado con otro algoritmo o con otros insumos (H15).
    ids = opts.soloFaltantes
      ? await consulta<{ id: string }>(
          `SELECT c.id::text AS id FROM concesion c LEFT JOIN prospectividad_concesion p ON p.concesion_id = c.id
            WHERE (p.concesion_id IS NULL OR p.datos->>'sello' IS DISTINCT FROM $1) AND c.geom IS NOT NULL ORDER BY c.id`,
          [await selloInsumos()]
        )
      : await consulta<{ id: string }>(`SELECT id::text AS id FROM concesion WHERE geom IS NOT NULL ORDER BY id`);
  } catch (e) {
    lote.corriendo = false;
    throw e;
  }
  Object.assign(lote, { corriendo: true, hechas: 0, total: ids.length, fallidas: 0, empezo: new Date().toISOString(), termino: null });
  try {
    for (const { id } of ids) {
      try {
        await prospectividadDe(Number(id));
      } catch (e: any) {
        lote.fallidas++;
        if (lote.fallidas <= 5) console.error('[prospectividad]', id, String(e?.message || e).slice(0, 160));
      }
      lote.hechas++;
    }
  } finally {
    lote.corriendo = false;
    lote.termino = new Date().toISOString();
  }
}

/** Las más prospectivas y cuántas hay calculadas: lo comparten la ruta del tablero y Dr Electrum. */
export async function rankingProspectividad(limite = 30): Promise<{
  calculadas: number;
  pendientes: number;
  ranking: Array<{ id: number; nombre: string; puntaje: number; nivel: Prospectividad['nivel']; cobertura: number; estado: EstadoProsp }>;
}> {
  await asegurarTabla();
  const sello = await selloInsumos();
  // Las sin datos no entran; las evaluadas van antes que las de evidencia insuficiente, para no
  // poner arriba a una concesión solo porque tiene un componente medido y alto.
  const top = await consulta<{ id: string; nombre: string; puntaje: number; datos: Prospectividad }>(
    `SELECT c.id::text AS id, c.nombre, p.puntaje, p.datos FROM prospectividad_concesion p JOIN concesion c ON c.id = p.concesion_id
      WHERE coalesce((p.datos->>'cobertura')::int, 0) > 0 AND p.datos->>'sello' = $2
      ORDER BY coalesce((p.datos->>'cobertura')::int, 0) >= ${COBERTURA_MINIMA} DESC, p.puntaje DESC, c.nombre LIMIT $1`,
    [limite, sello]
  ).then(conTextoReparado);
  const [{ n, viejas }] = await consulta<{ n: number; viejas: number }>(
    `SELECT count(*) FILTER (WHERE datos->>'sello' = $1)::int AS n, count(*) FILTER (WHERE datos->>'sello' IS DISTINCT FROM $1)::int AS viejas FROM prospectividad_concesion`,
    [sello]
  );
  return {
    calculadas: n,
    pendientes: viejas,
    ranking: top.map((t) => ({ id: Number(t.id), nombre: t.nombre, puntaje: t.puntaje, nivel: t.datos.nivel, cobertura: t.datos.cobertura, estado: estadoDe(t.datos.cobertura) })),
  };
}

export function montarRutasProspectividad(app: Express) {
  const E = exigirPlataforma('electrum');
  app.get('/api/electrum/prospectividad', E, limitar(30), async (_req: Request, res: Response) => {
    if (!hayBase()) return res.status(503).json({ error: 'El catastro no está conectado en este servidor.', honesto: true });
    try {
      const { calculadas, pendientes, ranking } = await rankingProspectividad(30);
      return res.json({ calculadas, pendientes, lote, ranking, honesto: true });
    } catch (e: any) {
      console.error('[prospectividad]', String(e?.message || e).slice(0, 200));
      return res.status(500).json({ error: 'No pude leer la prospectividad.', honesto: true });
    }
  });
  app.post('/api/electrum/prospectividad/calcular', E, limitar(5), (req: Request, res: Response) => {
    if (!hayBase()) return res.status(503).json({ error: 'El catastro no está conectado en este servidor.', honesto: true });
    const nivel = nivelDe(identidadDe(req), 'electrum');
    if (nivel !== 'escribe' && nivel !== 'mando') {
      return res.status(403).json({ error: 'Tu acceso es de consulta: podés mirar, pero no cambiar nada.', code: 'nivel_insuficiente', honesto: true });
    }
    if (lote.corriendo) return res.status(202).json({ ok: true, lote, honesto: true });
    void calcularTodas({ soloFaltantes: req.body?.todas !== true }).catch((e) => console.error('[prospectividad] lote:', String(e?.message || e).slice(0, 200)));
    return res.status(202).json({ ok: true, lote, honesto: true });
  });
}
