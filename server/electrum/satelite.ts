/**
 * LO QUE EL SATÉLITE VIO EN CADA CONCESIÓN — Sentinel-2 (Copernicus), temporada seca.
 *
 * Las capas raster (alteración por arcillas, óxidos de hierro, pérdida de vegetación) se calculan
 * fuera, con scripts/electrum/sentinel2/, y van al mapa como PMTiles. Aquí se guarda lo que eso mide
 * DENTRO de cada concesión, en hectáreas, para que la ficha y Dr Electrum lo digan con cifras:
 *
 *  · pérdida de vegetación entre dos temporadas secas, donde antes había vegetación densa;
 *  · suelo expuesto (lo único donde el satélite ve la roca) y cuánto de él tiene anomalía de
 *    arcillas o de óxidos de hierro.
 *
 * Cada renglón lleva su límite: una anomalía es una guía para mirar en campo, no un hallazgo, y una
 * caída del NDVI puede ser desmonte, un camino, un tajo… o una quema o una cosecha.
 */
import type { Express, Request, Response } from 'express';
import { exigirPlataforma, identidadDe, limitar } from '../seguridad';
import { nivelDe } from '../../lib/acceso';
import { consulta, hayBase } from './db';

/** Hectáreas por clase: [moderada, alta, muy alta]. */
type Tres = [number, number, number];
export type SateliteConcesion = {
  /** Hectáreas de la concesión que cayeron en el raster (40 m). */
  ha: number;
  /** Comparables entre los dos años (sin nubes ni agua en ninguno). */
  ha_comparable: number;
  veg: Tres;
  /** Suelo expuesto (NDVI < 0,30): donde los cocientes tienen sentido. */
  ha_expuesto: number;
  arc: Tres;
  fe: Tres;
};

let lista: Promise<void> | null = null;
export function asegurarSatelite(): Promise<void> {
  if (!lista) {
    lista = consulta(
      `CREATE TABLE IF NOT EXISTS satelite_concesion (
         concesion_id bigint PRIMARY KEY REFERENCES concesion(id) ON DELETE CASCADE,
         datos    jsonb NOT NULL,
         periodo  text NOT NULL,
         fuente   text NOT NULL,
         cargado  timestamptz NOT NULL DEFAULT now()
       )`
    )
      .then(() => undefined)
      .catch((e) => {
        lista = null;
        throw e;
      });
  }
  return lista;
}

const n = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 1e7;
const tres = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(n);

function valido(x: any): string | null {
  if (!x || !Number.isInteger(x.id) || x.id <= 0) return 'id inválido';
  const d = x.datos;
  if (!d || !n(d.ha) || !n(d.ha_comparable) || !n(d.ha_expuesto) || !tres(d.veg) || !tres(d.arc) || !tres(d.fe)) return 'datos incompletos';
  // Cada parte cabe en su todo (con la holgura del redondeo): si no, la ficha diría «120 %» y la
  // prospectividad y las alertas saldrían de un número imposible.
  const cabe = (parte: number, todo: number) => parte <= todo + Math.max(0.5, todo * 0.01);
  const s3 = (t: number[]) => t[0] + t[1] + t[2];
  if (!cabe(d.ha_comparable, d.ha)) return 'ha_comparable mayor que ha';
  if (!cabe(d.ha_expuesto, d.ha)) return 'ha_expuesto mayor que ha';
  if (!cabe(s3(d.veg), d.ha_comparable)) return 'la caída de vegetación suma más que lo comparable';
  if (!cabe(s3(d.arc), d.ha_expuesto) || !cabe(s3(d.fe), d.ha_expuesto)) return 'las anomalías suman más que el suelo expuesto';
  return null;
}

/** Guarda (o reemplaza) lo medido por concesión. Las que ya no están en el catastro se saltan. */
export async function cargarSatelite(filas: Array<{ id: number; datos: SateliteConcesion }>, periodo: string, fuente: string) {
  await asegurarSatelite();
  const rechazadas: Array<{ fila: number; motivo: string }> = [];
  const buenas = filas.filter((x, i) => {
    const m = valido(x);
    if (m) rechazadas.push({ fila: i, motivo: m });
    return !m;
  });
  let guardadas = 0;
  for (let i = 0; i < buenas.length; i += 500) {
    const lote = buenas.slice(i, i + 500);
    const r = await consulta<{ n: number }>(
      `WITH e AS (SELECT (x->>'id')::bigint AS id, x->'datos' AS datos FROM jsonb_array_elements($1::jsonb) x)
       , ins AS (
         INSERT INTO satelite_concesion (concesion_id, datos, periodo, fuente)
         SELECT e.id, e.datos, $2, $3 FROM e JOIN concesion c ON c.id = e.id
         ON CONFLICT (concesion_id) DO UPDATE SET datos = EXCLUDED.datos, periodo = EXCLUDED.periodo, fuente = EXCLUDED.fuente, cargado = now()
         RETURNING 1)
       SELECT count(*)::int AS n FROM ins`,
      [JSON.stringify(lote), periodo.slice(0, 80), fuente.slice(0, 200)]
    );
    guardadas += r[0]?.n ?? 0;
  }
  // La prospectividad guardada de estas concesiones usaba la medición anterior: se borra, y se
  // recalcula al abrir su ficha o en el próximo lote (que calcula las que faltan).
  if (buenas.length) {
    const [{ hay }] = await consulta<{ hay: boolean }>(`SELECT to_regclass('prospectividad_concesion') IS NOT NULL AS hay`);
    if (hay) await consulta(`DELETE FROM prospectividad_concesion WHERE concesion_id = ANY($1::bigint[])`, [buenas.map((x) => x.id)]);
  }
  return { guardadas, fuera_del_catastro: buenas.length - guardadas, rechazadas };
}

const ha = (v: number) => (v >= 10 ? Math.round(v).toLocaleString('es-HN') : v.toLocaleString('es-HN', { maximumFractionDigits: 1 }));
const suma = (t: Tres) => t[0] + t[1] + t[2];

/** Los renglones de la ficha (y del texto de Dr Electrum). Vacío si no se midió esta concesión. */
export async function sateliteEnRenglones(concesionId: number): Promise<string[]> {
  await asegurarSatelite();
  const [f] = await consulta<{ datos: SateliteConcesion; periodo: string; fuente: string }>(
    `SELECT datos, periodo, fuente FROM satelite_concesion WHERE concesion_id = $1`,
    [concesionId]
  );
  if (!f) return [];
  const d = f.datos;
  const r: string[] = [`${f.fuente}, ${f.periodo}; píxel de 40 m.`];
  if (d.ha_comparable > 0) {
    const p = suma(d.veg);
    r.push(
      p > 0
        ? `Caída de vegetación densa: ${ha(p)} ha (${((p / d.ha_comparable) * 100).toLocaleString('es-HN', { maximumFractionDigits: 1 })} % de las ${ha(d.ha_comparable)} ha comparables; moderada ${ha(d.veg[0])}, fuerte ${ha(d.veg[1])}, muy fuerte ${ha(d.veg[2])}). Puede ser desmonte, camino o tajo, pero también quema, sequía o cosecha: se confirma con la imagen o en campo.`
        : `Sin caída de vegetación densa en las ${ha(d.ha_comparable)} ha comparables.`
    );
  } else {
    r.push('Caída de vegetación: sin datos comparables (nubes o agua en alguno de los dos años).');
  }
  if (d.ha_expuesto > 0) {
    const a = suma(d.arc);
    const fe = suma(d.fe);
    r.push(
      `Suelo expuesto: ${ha(d.ha_expuesto)} ha de ${ha(d.ha)}. Anomalía de arcillas (alteración argílica/sericítica): ${a > 0 ? `${ha(a)} ha, ${ha(d.arc[1] + d.arc[2])} alta o muy alta` : 'ninguna'}. Óxidos de hierro: ${fe > 0 ? `${ha(fe)} ha, ${ha(d.fe[1] + d.fe[2])} alta o muy alta` : 'ninguna'}. Es una guía para mirar en campo, no un hallazgo: suelos arcillosos, lateritas y caminos de tierra también dan anomalía.`
    );
  } else {
    r.push(`Sin suelo expuesto: bajo la vegetación el satélite no ve la roca (sin anomalía no quiere decir sin alteración).`);
  }
  return r;
}

/** Hectáreas de pérdida de vegetación fuerte o muy fuerte por concesión, para marcarlas en el mapa. */
export async function perdidaPorConcesion(): Promise<Map<number, number>> {
  await asegurarSatelite();
  const filas = await consulta<{ id: string; p: number }>(
    `SELECT concesion_id::text AS id, (datos->'veg'->>1)::float8 + (datos->'veg'->>2)::float8 AS p FROM satelite_concesion`
  );
  return new Map(filas.map((f) => [Number(f.id), Number(f.p)]));
}

export function montarRutasSatelite(app: Express) {
  const E = exigirPlataforma('electrum');
  app.post('/api/electrum/satelite/cargar', E, limitar(10), async (req: Request, res: Response) => {
    if (!hayBase()) return res.status(503).json({ error: 'El catastro no está conectado en este servidor.', code: 'sin_base', honesto: true });
    const nivel = nivelDe(identidadDe(req), 'electrum');
    if (nivel !== 'escribe' && nivel !== 'mando') {
      return res.status(403).json({ error: 'Tu acceso es de consulta: podés mirar, pero no cambiar nada.', code: 'nivel_insuficiente', honesto: true });
    }
    const { concesiones, periodo, fuente } = req.body || {};
    if (!Array.isArray(concesiones) || !concesiones.length || typeof periodo !== 'string' || typeof fuente !== 'string' || !periodo.trim() || !fuente.trim()) {
      return res.status(400).json({ error: 'Mandá { concesiones: [{ id, datos }], periodo, fuente }.', honesto: true });
    }
    if (concesiones.length > 20_000) return res.status(413).json({ error: 'Demasiadas concesiones de una vez.', honesto: true });
    try {
      const r = await cargarSatelite(concesiones, periodo.trim(), fuente.trim());
      return res.json({ ok: true, ...r, rechazadas: r.rechazadas.length, motivos: r.rechazadas.slice(0, 20), honesto: true });
    } catch (e: any) {
      console.error('[satelite]', String(e?.message || e).slice(0, 200));
      return res.status(500).json({ error: 'No pude guardar lo medido por el satélite.', honesto: true });
    }
  });
}
