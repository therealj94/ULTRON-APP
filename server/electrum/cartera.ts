/**
 * CARTERAS — un grupo de concesiones del catastro que alguien quiere mirar junto: las zonas de una
 * empresa, las que se presentaron con anotación provisional, las de un proyecto.
 *
 * Se registran solas al subir una capa cuyas concesiones ya están en el catastro (db.ts,
 * `guardarCapa`) y se guardan por huella de geometría: el catastro se recarga y los ids cambian,
 * el polígono no. Aquí se analizan para decidir: estado de cada una, semáforo de restricciones
 * (restricciones.ts), traslapes con terceros y prospectividad, y un orden de prioridad.
 */
import type { Express, Request, Response } from 'express';
import { exigirPlataforma, limitar } from '../seguridad';
import { conTextoReparado, consulta, enTransaccion, hayBase, hayCarteras } from './db';
import { NOMBRE_NIVEL, restriccionesDe, type Nivel, type Restricciones } from './restricciones';
import { significadoEstado } from './estados';

export type ResumenCartera = { id: number; nombre: string; concesiones: number; enCatastro: number; actualizada: string };

export async function carteras(): Promise<ResumenCartera[]> {
  if (!hayBase() || !(await hayCarteras())) return [];
  return consulta<{ id: string; nombre: string; n: number; en: number; actualizada: string }>(
    `SELECT k.id::text, k.nombre, count(cc.huella)::int AS n,
            count(c.id)::int AS en, to_char(k.actualizada, 'YYYY-MM-DD') AS actualizada
       FROM cartera k
       LEFT JOIN cartera_concesion cc ON cc.cartera_id = k.id
       LEFT JOIN LATERAL (SELECT id FROM concesion WHERE huella = cc.huella LIMIT 1) c ON true
      GROUP BY k.id ORDER BY k.actualizada DESC`
  )
    .then(conTextoReparado)
    .then((xs) => xs.map((x) => ({ id: Number(x.id), nombre: x.nombre, concesiones: x.n, enCatastro: x.en, actualizada: x.actualizada })));
}

export type FilaCartera = {
  concesionId: number;
  nombre: string;
  expediente: string | null;
  titular: string | null;
  estado: string | null;
  tipo: string | null;
  hectareas: number;
  prospectividad: number | null;
  restricciones: Restricciones;
};

export type AnalisisCartera = {
  cartera: string;
  total: number;
  /** Registradas en la cartera que ya no están en el catastro vigente (se cayeron o cambió el polígono). */
  fuera: Array<{ nombre: string | null; expediente: string | null }>;
  hectareas: number;
  porEstado: Array<{ estado: string; n: number; ha: number }>;
  porNivel: Record<Nivel, number>;
  filas: FilaCartera[];
};

/** Busca la cartera por nombre (sin acentos ni mayúsculas) o la única que haya. */
async function resolver(nombre?: string | null): Promise<{ id: number; nombre: string } | { error: string }> {
  const todas = await carteras();
  if (!todas.length) return { error: 'No hay carteras registradas. Se crean solas al subir una capa con concesiones que ya están en el catastro (por ejemplo, las zonas de una empresa).' };
  if (!nombre) {
    if (todas.length === 1) return todas[0];
    return { error: `Hay ${todas.length} carteras: ${todas.map((c) => `«${c.nombre}» (${c.concesiones})`).join(', ')}. Decime cuál.` };
  }
  const n = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = n(nombre);
  const hit = todas.filter((c) => n(c.nombre).includes(q) || q.includes(n(c.nombre)));
  if (hit.length === 1) return hit[0];
  const palabras = q.split(/\s+/).filter((w) => w.length > 2);
  const porPalabras = todas.filter((c) => palabras.every((w) => n(c.nombre).includes(w)));
  if (porPalabras.length === 1) return porPalabras[0];
  return { error: `No encuentro una sola cartera «${nombre}». Hay: ${todas.map((c) => `«${c.nombre}»`).join(', ')}.` };
}

export async function analizarCartera(nombre?: string | null): Promise<AnalisisCartera | { error: string }> {
  if (!hayBase()) return { error: 'El catastro no está conectado.' };
  const k = await resolver(nombre);
  if ('error' in k) return k;

  const miembros = await consulta<{ huella: string; nombre: string | null; expediente: string | null; cid: string | null }>(
    `SELECT cc.huella, cc.nombre, cc.expediente, (SELECT id::text FROM concesion WHERE huella = cc.huella ORDER BY id LIMIT 1) AS cid
       FROM cartera_concesion cc WHERE cc.cartera_id = $1`,
    [k.id]
  ).then(conTextoReparado);
  const ids = miembros.map((m) => Number(m.cid)).filter((x) => x > 0);
  const fuera = miembros.filter((m) => !m.cid).map((m) => ({ nombre: m.nombre, expediente: m.expediente }));

  const [datos, rs, prosp] = await Promise.all([
    ids.length
      ? consulta<{ id: string; nombre: string; expediente: string | null; titular: string | null; estado: string | null; tipo: string | null; ha: number }>(
          `SELECT id::text, nombre, expediente, titular, estado, coalesce(tipo, atributos->>'clasificac', atributos->>'CLASIFICAC') AS tipo,
                  coalesce(hectareas, ST_Area(geom::geography) / 10000.0)::float8 AS ha
             FROM concesion WHERE id = ANY($1::bigint[])`,
          [ids]
        ).then(conTextoReparado)
      : Promise.resolve([]),
    restriccionesDe(ids),
    ids.length
      ? consulta<{ id: string; puntaje: number }>(
          `SELECT concesion_id::text AS id, puntaje FROM prospectividad_concesion WHERE concesion_id = ANY($1::bigint[])`,
          [ids]
        ).catch(() => [])
      : Promise.resolve([]),
  ]);
  const rPor = new Map(rs.map((r) => [r.concesionId, r]));
  const pPor = new Map(prosp.map((p) => [Number(p.id), Number(p.puntaje)]));

  const rango: Record<Nivel, number> = { verde: 0, incompleto: 1, ambar: 2, rojo: 3 };
  const filas: FilaCartera[] = datos
    .map((d) => ({
      concesionId: Number(d.id),
      nombre: d.nombre,
      expediente: d.expediente,
      titular: d.titular,
      estado: d.estado,
      tipo: d.tipo,
      hectareas: Math.round(d.ha * 100) / 100,
      prospectividad: pPor.get(Number(d.id)) ?? null,
      restricciones: rPor.get(Number(d.id)) || { concesionId: Number(d.id), nombre: d.nombre, hectareas: d.ha, nivel: 'verde' as Nivel, items: [], sinRevisar: [] },
    }))
    // Prioridad: primero lo que se puede trabajar (verde), y dentro, lo más prospectivo.
    .sort((a, b) => rango[a.restricciones.nivel] - rango[b.restricciones.nivel] || (b.prospectividad ?? -1) - (a.prospectividad ?? -1) || b.hectareas - a.hectareas);

  const porEstado = new Map<string, { n: number; ha: number }>();
  for (const f of filas) {
    const e = f.estado || 'sin estado';
    const x = porEstado.get(e) || { n: 0, ha: 0 };
    x.n++;
    x.ha += f.hectareas;
    porEstado.set(e, x);
  }
  const porNivel: Record<Nivel, number> = { rojo: 0, ambar: 0, verde: 0, incompleto: 0 };
  for (const f of filas) porNivel[f.restricciones.nivel]++;

  return {
    cartera: k.nombre,
    total: miembros.length,
    fuera,
    hectareas: Math.round(filas.reduce((s, f) => s + f.hectareas, 0) * 100) / 100,
    porEstado: [...porEstado].map(([estado, v]) => ({ estado, n: v.n, ha: Math.round(v.ha * 100) / 100 })).sort((a, b) => b.n - a.n),
    porNivel,
    filas,
  };
}

const nf = (x: number, d = 0) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }).format(x);

/** El análisis en texto, para que el modelo lo cite. Corto arriba, detalle abajo. */
export function carteraEnTexto(a: AnalisisCartera): string {
  const p: string[] = [];
  p.push(
    `Cartera «${a.cartera}»: ${a.total} concesiones registradas, ${a.filas.length} en el catastro vigente (${nf(a.hectareas, 1)} ha).` +
      (a.fuera.length ? ` ${a.fuera.length} ya no están en el catastro vigente: ${a.fuera.slice(0, 5).map((f) => f.nombre || f.expediente).join(', ')}${a.fuera.length > 5 ? '…' : ''}.` : '')
  );
  p.push(`Por estado: ${a.porEstado.map((e) => `${e.estado} ${e.n} (${significadoEstado(e.estado)}, ${nf(e.ha, 1)} ha)`).join('; ')}.`);
  p.push(
    `Semáforo de restricciones: ${a.porNivel.verde} verdes, ${a.porNivel.ambar} ámbar, ${a.porNivel.rojo} rojas` +
      (a.porNivel.incompleto ? `, ${a.porNivel.incompleto} sin revisar completas (falta alguna capa de restricción)` : '') +
      '.'
  );
  const cuenta = (tipo: string) => a.filas.filter((f) => f.restricciones.items.some((i) => i.tipo === tipo)).length;
  p.push(
    `Pisan área protegida ${cuenta('area_protegida')}, microcuenca declarada o en trámite ${cuenta('microcuenca')}, patrimonio forestal ${cuenta('forestal')}; con caseríos dentro ${cuenta('poblados')}; traslapadas con terceros ${cuenta('traslape')}.`
  );
  const linea = (f: FilaCartera) => {
    const r = f.restricciones;
    const que = r.items
      .slice(0, 3)
      .map((i) =>
        i.tipo === 'area_protegida'
          ? `AP ${i.nombre}${i.zona ? ` (${i.zona})` : ''} ${nf(i.pct, 1)} %`
          : i.tipo === 'microcuenca'
            ? `microcuenca ${i.nombre} ${nf(i.pct, 1)} %`
            : i.tipo === 'forestal'
              ? `forestal ${i.nombre} ${nf(i.pct, 1)} %`
              : i.tipo === 'poblados'
                ? `caseríos dentro (${i.detalle})`
                : `traslape con ${i.nombre} ${nf(i.pct, 1)} %`
      )
      .join('; ');
    return `${f.nombre} (id ${f.concesionId}, ${f.estado || 's/e'}, ${nf(f.hectareas, 1)} ha${f.prospectividad != null ? `, prospectividad ${f.prospectividad}/100` : ''}) ${NOMBRE_NIVEL[r.nivel]}${que ? `: ${que}` : ''}`;
  };
  const verdes = a.filas.filter((f) => f.restricciones.nivel === 'verde');
  const rojas = a.filas.filter((f) => f.restricciones.nivel === 'rojo');
  if (verdes.length) p.push(`Prioridad (sin restricciones en las capas cargadas, las más prospectivas primero): ${verdes.slice(0, 8).map(linea).join(' | ')}.`);
  if (rojas.length) p.push(`Rojas (zona de exclusión, Art. 48 a) LGM): ${rojas.slice(0, 10).map(linea).join(' | ')}${rojas.length > 10 ? ' | …' : ''}.`);
  const ambar = a.filas.filter((f) => f.restricciones.nivel === 'ambar');
  if (ambar.length) p.push(`Ámbar (se pueden trabajar con condiciones): ${ambar.slice(0, 8).map(linea).join(' | ')}${ambar.length > 8 ? ' | …' : ''}.`);
  const sinRev = a.filas[0]?.restricciones.sinRevisar || [];
  if (sinRev.length) p.push(`No se revisó (capa no cargada): ${sinRev.join(', ')}.`);
  p.push('El semáforo es una guía para priorizar, no un dictamen; cada ficha se abre con concesion_entorno.');
  return p.join(' ');
}

/* ------------------------------------------------------------------ rutas */


/**
 * Para la pantalla y el recorrido: las carteras y, de una (la pedida o la más reciente), el
 * resumen para decidir. Sin geometrías: las fichas se piden aparte, por id.
 */
export function montarRutasCartera(app: Express) {
  app.get('/api/electrum/cartera', exigirPlataforma('electrum'), limitar(30), async (req: Request, res: Response) => {
    if (!hayBase()) return res.status(503).json({ error: 'El catastro no está conectado en este servidor.', honesto: true });
    try {
      const lista = await carteras();
      const nombre = typeof req.query.nombre === 'string' ? req.query.nombre : lista[0]?.nombre;
      const a = nombre ? await analizarCartera(nombre) : null;
      res.setHeader('Cache-Control', 'private, max-age=120');
      return res.json({
        carteras: lista,
        analisis:
          a && !('error' in a)
            ? {
                cartera: a.cartera,
                total: a.total,
                enCatastro: a.filas.length,
                hectareas: a.hectareas,
                porNivel: a.porNivel,
                porEstado: a.porEstado,
                filas: a.filas.map((f) => ({
                  id: f.concesionId,
                  nombre: f.nombre,
                  estado: f.estado,
                  hectareas: f.hectareas,
                  prospectividad: f.prospectividad,
                  nivel: f.restricciones.nivel,
                  motivos: f.restricciones.items.slice(0, 3).map((i) => ({ tipo: i.tipo, nombre: i.nombre, zona: i.zona, pct: i.pct })),
                })),
              }
            : null,
        honesto: true,
      });
    } catch (e: any) {
      console.error('[cartera]', String(e?.message || e).slice(0, 200));
      return res.status(500).json({ error: 'No pude analizar la cartera.', honesto: true });
    }
  });
}

/**
 * Una capa que se cargó como concesiones pero es una selección del catastro (sus polígonos caen
 * ≥ 80 % dentro de concesiones del oficial) se convierte en cartera: cada rasgo se enlaza con SU
 * concesión oficial —la del mismo expediente si la hay, si no la de más superficie en común— y la
 * capa duplicada se borra. Pasa cuando el archivo de la cartera y el del catastro se convirtieron
 * por caminos distintos (NAD27 y WGS84) y la huella exacta no coincide aunque el polígono sea el mismo.
 */
export async function carteraDesdeCapa(
  capaId: number,
  opts: { nombre?: string; quien?: string | null; borrarCapa?: boolean } = {}
): Promise<{ ok: boolean; dicho: string; enlazadas: number; total: number }> {
  if (!hayBase() || !(await hayCarteras())) return { ok: false, dicho: 'Sin base o sin tablas de cartera.', enlazadas: 0, total: 0 };
  const [k] = await consulta<{ nombre: string }>(`SELECT nombre FROM capa WHERE id = $1`, [capaId]);
  if (!k) return { ok: false, dicho: `No existe la capa ${capaId}.`, enlazadas: 0, total: 0 };
  const nombre = (opts.nombre || k.nombre).replace(/[\s_-]*(nad[\s_-]?27|wgs[\s_-]?84)$/i, '').trim() || k.nombre;
  return enTransaccion(async (q) => {
    const pares = (await q(
      `SELECT DISTINCT ON (c.id) c.id AS cid, o.huella, o.expediente, o.nombre, c.atributos
         FROM concesion c
         JOIN concesion o ON o.capa_id <> c.capa_id AND o.geom && c.geom AND ST_Intersects(o.geom, c.geom)
                         AND ST_Area(ST_Intersection(o.geom, c.geom)) >= 0.8 * ST_Area(c.geom)
        WHERE c.capa_id = $1
        ORDER BY c.id, (o.expediente IS NOT DISTINCT FROM c.expediente) DESC, ST_Area(ST_Intersection(o.geom, c.geom)) DESC`,
      [capaId]
    )) as Array<{ cid: string; huella: string; expediente: string | null; nombre: string; atributos: unknown }>;
    const [{ n: total }] = (await q(`SELECT count(*)::int AS n FROM concesion WHERE capa_id = $1`, [capaId])) as Array<{ n: number }>;
    if (!pares.length) return { ok: false, dicho: `Ninguno de los ${total} polígonos de «${k.nombre}» cae en el catastro: no es una cartera.`, enlazadas: 0, total };
    const [c] = (await q(
      `INSERT INTO cartera (nombre, origen, por) VALUES ($1, $2, $3)
       ON CONFLICT (nombre) DO UPDATE SET origen = EXCLUDED.origen, por = EXCLUDED.por, actualizada = now() RETURNING id`,
      [nombre, `capa ${capaId} (${k.nombre})`, opts.quien || null]
    )) as Array<{ id: string }>;
    // Se SUMAN a los miembros que ya tenga (revisión de Codex en #78): en una subida mezclada, los
    // polígonos idénticos ya los registró el cargador y aquí solo llegan los corridos.
    await q(
      `INSERT INTO cartera_concesion (cartera_id, huella, expediente, nombre, atributos)
       SELECT $1, x.huella, x.expediente, x.nombre, coalesce(x.atributos, '{}'::jsonb)
         FROM jsonb_to_recordset($2::jsonb) AS x(huella text, expediente text, nombre text, atributos jsonb)
       ON CONFLICT (cartera_id, huella) DO NOTHING`,
      [c.id, JSON.stringify(pares.map(({ huella, expediente, nombre, atributos }) => ({ huella, expediente, nombre, atributos })))]
    );
    // La capa solo se borra si TODO lo suyo quedó enlazado: si algo no cae en el catastro, se queda.
    const completa = pares.length === total;
    if (opts.borrarCapa !== false && completa) {
      await q(`DELETE FROM capa WHERE id = $1`, [capaId]);
      await q(`INSERT INTO biblioteca_bitacora (quien, accion, objeto, detalle) VALUES ($1, 'eliminar', $2, $3)`, [
        opts.quien || null,
        `capa ${capaId}`,
        JSON.stringify({ nombre: k.nombre, concesiones: total, por: 'cartera desde capa', cartera: nombre }),
      ]);
    }
    return {
      ok: true,
      dicho: `Cartera «${nombre}»: ${pares.length} de ${total} enlazadas con su concesión del catastro.${completa ? ' La capa duplicada se borró.' : ' Hay polígonos que no caen en el catastro: la capa se deja.'}`,
      enlazadas: pares.length,
      total,
    };
  });
}
