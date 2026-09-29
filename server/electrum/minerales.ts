/**
 * «QUIERO VER LAS CONCESIONES QUE TENGAN ORO.»
 *
 * El catastro de INHGEOMIN no dice qué mineral trabaja cada concesión: trae la clase (Metálica, No
 * Metálica, Banco de Préstamo…) y nada más. Lo que sí está es DÓNDE hay oro, plata, cobre o
 * antimonio registrado: las capas de yacimientos y ocurrencias (DEFOMIN, USGS MRDS, pórfidos de
 * cobre, ocurrencias minerales). Así que el mineral de una concesión se deduce, y se dice cómo:
 *
 *  · por OCURRENCIA: hay un yacimiento u ocurrencia de ese mineral dentro de la concesión o a menos
 *    de 1 km de su lindero;
 *  · por NOMBRE, solo para materiales que el nombre declara sin ambigüedad («Arenera…», «Cantera…»,
 *    «Calera…», «Mina de Oro…»).
 *
 * Nunca se presenta como dato del catastro: «con indicios de oro registrados», no «de oro».
 */
import { consulta, hayBase } from './db';
import { capasPorRol } from './entorno';
import { claseDeCapa, normalizarClase } from './tablero';

import type { Mineral } from '../../lib/pedidos-mapa';
export type { Mineral };

const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Cómo aparece cada mineral en los atributos de las capas (nombre, símbolo, mineral guía). */
const EN_CAPAS: Array<[Mineral, RegExp]> = [
  ['oro', /\b(oro|au|gold|aurifer[oa]s?)\b/],
  ['plata', /\b(plata|ag|silver|argentifer[oa]s?)\b/],
  ['cobre', /\b(cobre|cu|copper|calcopirita|cuprifer[oa]s?)\b/],
  ['zinc', /\b(zinc|zn|esfalerita|blenda)\b/],
  ['plomo', /\b(plomo|pb|lead|galena)\b/],
  ['hierro', /\b(hierro|fe|iron|magnetita|hematita|limonita)\b/],
  ['antimonio', /\b(antimonio|sb|estibina|stibnite|antimony)\b/],
  ['manganeso', /\b(manganeso|mn|manganese)\b/],
  ['molibdeno', /\b(molibdeno|molibdenita|molybdenum)\b/],
  ['estaño', /\b(estano|tin|casiterita)\b/],
  ['ópalo', /\b(opalo|opal)\b/],
  ['carbón', /\b(carbon|lignito|coal)\b/],
  ['caliza', /\b(caliza|calizas|calera|limestone)\b/],
  ['mármol', /\b(marmol|marble)\b/],
  ['yeso', /\b(yeso|gypsum)\b/],
  ['arcilla', /\b(arcilla|caolin|bentonita|clay|kaolin)\b/],
];

/** Lo que el NOMBRE de una concesión declara sin ambigüedad. */
const EN_NOMBRE: Array<[Mineral, RegExp]> = [
  ['arena', /\b(arenera|areneros?|arenas?|arenal)\b/],
  ['grava', /\b(grava|balastre|balasto)\b/],
  ['piedra', /\b(cantera|piedrera|piedra|trituradora)\b/],
  ['caliza', /\b(calera|caliza|cal)\b/],
  ['mármol', /\b(marmol)\b/],
  ['puzolana', /\b(puzolana)\b/],
  ['oro', /\b(oro|aurifera)\b/],
  ['plata', /\b(plata)\b/],
];

export function mineralesEnTexto(texto: string): Mineral[] {
  const t = fold(texto);
  return EN_CAPAS.filter(([, re]) => re.test(t)).map(([m]) => m);
}

export function mineralesEnNombre(nombre: string): Mineral[] {
  const t = fold(nombre);
  return EN_NOMBRE.filter(([, re]) => re.test(t)).map(([m]) => m);
}

export { mineralDePedido, pedidoDeFiltro } from '../../lib/pedidos-mapa';
import { mineralDePedido } from '../../lib/pedidos-mapa';

export type MineralesDeConcesion = { minerales: Mineral[]; porOcurrencia: Mineral[]; clase: string | null };

let cache: { en: number; datos: Map<number, MineralesDeConcesion> } | null = null;
let enCurso: Promise<Map<number, MineralesDeConcesion>> | null = null;
const VIGENCIA_MS = 30 * 60_000;

/** Para cada concesión, sus minerales deducidos y su clase. Se calcula una vez cada media hora. */
export function mineralesPorConcesion(): Promise<Map<number, MineralesDeConcesion>> {
  if (cache && Date.now() - cache.en < VIGENCIA_MS) return Promise.resolve(cache.datos);
  if (!enCurso) {
    enCurso = calcular()
      .then((datos) => {
        cache = { en: Date.now(), datos };
        return datos;
      })
      .finally(() => {
        enCurso = null;
      });
  }
  return enCurso;
}

async function calcular(): Promise<Map<number, MineralesDeConcesion>> {
  const out = new Map<number, MineralesDeConcesion>();
  if (!hayBase()) return out;
  const capas = (await capasPorRol()).filter((c) => c.rol === 'ocurrencia').map((c) => c.id);
  const base = await consulta<{ id: number; nombre: string; clase: string | null; capa: string | null }>(
    `SELECT k.id, k.nombre, c.nombre AS capa,
            (SELECT a.v FROM jsonb_each_text(k.atributos) AS a(k, v) WHERE lower(a.k) = 'clasificac' LIMIT 1) AS clase
       FROM concesion k LEFT JOIN capa c ON c.id = k.capa_id`
  );
  const cerca = capas.length
    ? await consulta<{ id: number; txt: string | null }>(
        `WITH oc AS (
           SELECT e.geom,
                  (SELECT string_agg(a.v, ' ') FROM jsonb_each_text(e.atributos) AS a(k, v)
                    WHERE a.k ~* '^(mineral|sustanc|commod|codigo|element|recurso|metal|tipo)') AS txt
             FROM entidad_geo e WHERE e.capa_id = ANY($1)
         )
         SELECT c.id, string_agg(DISTINCT oc.txt, ' | ') AS txt
           FROM concesion c JOIN oc
             ON c.geom && ST_Expand(oc.geom, 0.012)
            AND ST_DWithin(c.geom::geography, oc.geom::geography, 1000)
          WHERE oc.txt IS NOT NULL
          GROUP BY c.id`,
        [capas]
      )
    : [];
  const porOc = new Map(cerca.map((f) => [Number(f.id), mineralesEnTexto(f.txt || '')]));
  for (const f of base) {
    const oc = porOc.get(Number(f.id)) || [];
    const nom = mineralesEnNombre(f.nombre || '');
    const todos = [...new Set([...oc, ...nom])];
    out.set(Number(f.id), { minerales: todos, porOcurrencia: oc, clase: claseDeConcesion(f.clase, f.capa) });
  }
  return out;
}

/**
 * La clase legible, como la cuenta el tablero: el .dbf perdió las tildes («Peque?a Min. No Met?lica»)
 * y hay filas sin CLASIFICAC que solo se saben por la capa de la que vinieron.
 */
export function claseDeConcesion(clase: string | null | undefined, capa: string | null | undefined): string | null {
  const c = normalizarClase(clase) ?? claseDeCapa(capa);
  return c === 'Sin clase en la capa' ? null : c;
}

/** Los ids que cumplen el pedido (un mineral o una clase). */
export function idsQueCumplen(datos: Map<number, MineralesDeConcesion>, pedido: Mineral | 'metalicas' | 'no metalicas'): number[] {
  const ids: number[] = [];
  for (const [id, d] of datos) {
    const clase = fold(d.clase || '');
    const ok =
      pedido === 'metalicas'
        ? /metalic/.test(clase) && !/no metalic/.test(clase)
        : pedido === 'no metalicas'
          ? /no metalic|banco de prestamo/.test(clase)
          : d.minerales.includes(pedido);
    if (ok) ids.push(id);
  }
  return ids;
}

/** Cómo se dice qué se marcó, sin hacerlo pasar por dato del catastro. */
export function comoSeSabe(pedido: Mineral | 'metalicas' | 'no metalicas'): string {
  if (pedido === 'metalicas' || pedido === 'no metalicas') return `según la clase que declara el catastro`;
  return `con indicios de ${pedido}: un yacimiento u ocurrencia de ${pedido} registrado dentro o a menos de 1 km (DEFOMIN, USGS)${
    ['arena', 'grava', 'piedra', 'caliza', 'mármol', 'puzolana'].includes(pedido) ? ', o el material declarado en el nombre' : ''
  }. El catastro no guarda el mineral de cada concesión`;
}
