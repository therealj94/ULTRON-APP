/**
 * EL ÍNDICE DE CAPAS (Índice Maestro de Capas GIS y KML v1.4).
 *
 * Todo lo que se subió —shapefiles, KML/KMZ, hojas cartográficas, planos— quedó clasificado con un
 * ID de seis dígitos `B CC SSS` (1 Información GIS, 2 Geología, 3 Proyectos Indexa, 4 Historia,
 * 8 Otros) en `biblioteca/mapas/manifest.json` del cubo. El frontal arma la pestaña «Índice de
 * capas» leyendo ese manifiesto, no a mano, y cada capa se baja solo cuando alguien la enciende.
 *
 * Cada entrada dice de dónde salen sus rasgos (`fuentes`): una o varias capas de la base (con
 * propiedades fijas, p. ej. el mineral de cada archivo de fichas, para poder filtrarlas), una cartera
 * de concesiones, el catastro, las teselas del cubo o un plano para el visor. Aquí se sirven las que
 * son de la base: con su `layer_id`, su nombre y SOLO los campos que se filtran, no la tabla entera.
 */
import type { Express, Request, Response } from 'express';
import type { FeatureCollection } from 'geojson';
import { bajarExpediente, bucketExpedientes } from '../../lib/s3';
import { esInvitado, exigirPlataforma, limitar } from '../seguridad';
import { conTextoReparado, consultaConTope, hayBase, type RolCapa } from './db';
import { capasPorRol, nombreDe } from './entorno';
import { CASA, organizacionActual, sqlCarteraVisible, sqlDocumentoVisible } from './organizacion';
import { camposDeEstilo, colorDeRasgo, colorPrincipal, type EntradaCatalogo, type Estilo, type Filtros } from '../../src-electrum/mapa/catalogo';

const PREFIJO = 'biblioteca/mapas/';
/** Más rasgos que esto no se manda entero a un teléfono: va por teselas. */
const MAX_RASGOS = 25000;

export type Filtro = { campo: string; etiqueta?: string; valores: Array<string | number> };
export type Fuente = {
  capa?: number;
  propiedades?: Record<string, string>;
  cartera?: string;
  catastro?: boolean;
  perimetro?: boolean;
  muestras?: boolean;
  tesela?: string;
  caja?: [number, number, number, number];
  plano?: string;
  documento?: number | null;
};
export type EntradaIndice = {
  id: number;
  nombre: string;
  tipo: 'grupo' | 'vector' | 'raster' | 'kml' | 'documento';
  padre: number | null;
  orden: number;
  formato_original?: string | null;
  ruta?: string | null;
  ruta_web?: string | null;
  crs_original?: string | null;
  geometria?: string | null;
  num_entidades?: number | null;
  visible_por_defecto?: boolean;
  carga?: string | null;
  filtros?: Filtro[];
  archivos_origen?: string[];
  notas?: string;
  fuentes?: Fuente[];
  caja?: [number, number, number, number] | null;
  /** Cómo se pinta: el estilo original del KML, por categorías de un campo, o un solo color (correcciones v1.0, 2.3). */
  estilo?: Estilo | null;
  /** Cómo la nombra la gente («fichas de ocurrencia», «zonas de reserva»). */
  alias?: string[];
  /** En el índice pero sin archivo: en gris, «Sin datos». */
  sin_datos?: boolean;
  /** Agregada con el siguiente ID libre: el documento no la traía. */
  fuera_de_indice?: boolean;
  /** Dentro de un proyecto: «KML», «Shape», «Planos»… */
  subgrupo?: string;
  /** El ID que tenía antes de reclasificarla (retirado, no se reutiliza). */
  id_anterior?: number;
};
export type Manifiesto = {
  version: string;
  crs_salida: string;
  capas: EntradaIndice[];
  cuarentena?: Array<{ archivo: string; motivo: string }>;
  retirados?: Array<{ id: number; ahora: number; nombre: string }>;
};

let leido: { cuando: number; m: Manifiesto | null } | null = null;

const esCaja = (x: unknown): x is [number, number, number, number] => Array.isArray(x) && x.length === 4 && x.every((n) => Number.isFinite(Number(n)));

/** Lo que el manifiesto del cubo dice, limpio: un ID que no es de seis dígitos o un tipo raro no pasa. */
export function validarManifiesto(j: any): Manifiesto | null {
  if (!j || !Array.isArray(j.capas)) return null;
  const TIPOS = new Set(['grupo', 'vector', 'raster', 'kml', 'documento']);
  const capas: EntradaIndice[] = [];
  const ids = new Set<number>();
  for (const x of j.capas) {
    const id = Number(x?.id);
    if (!Number.isSafeInteger(id) || id < 1 || id > 999999 || ids.has(id) || !TIPOS.has(x.tipo) || typeof x.nombre !== 'string') continue;
    ids.add(id);
    capas.push({
      ...x,
      id,
      nombre: String(x.nombre).slice(0, 160),
      padre: x.padre == null ? null : Number(x.padre),
      orden: Number(x.orden) || 0,
      filtros: (Array.isArray(x.filtros) ? x.filtros : [])
        .filter((f: any) => f && typeof f.campo === 'string' && Array.isArray(f.valores))
        .map((f: any) => ({ campo: String(f.campo).slice(0, 80), etiqueta: String(f.etiqueta || f.campo).slice(0, 80), valores: f.valores.slice(0, 60).map((v: unknown) => String(v).slice(0, 120)) })),
      fuentes: Array.isArray(x.fuentes) ? x.fuentes : [],
      caja: esCaja(x.caja) ? (x.caja.map(Number) as [number, number, number, number]) : null,
      alias: (Array.isArray(x.alias) ? x.alias : []).filter((a: unknown) => typeof a === 'string').slice(0, 40).map((a: string) => a.slice(0, 80)),
      estilo: estiloValido(x.estilo),
    });
  }
  return {
    version: String(j.version || ''),
    crs_salida: String(j.crs_salida || 'EPSG:4326'),
    capas,
    cuarentena: Array.isArray(j.cuarentena) ? j.cuarentena : [],
    retirados: Array.isArray(j.retirados) ? j.retirados.filter((r: any) => Number.isSafeInteger(Number(r?.id))) : [],
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Un estilo con colores de verdad (#rrggbb): lo que no lo es se cae, no llega a pintar nada raro. */
function estiloValido(x: any): Estilo | null {
  if (!x || typeof x !== 'object' || typeof x.tipo !== 'string') return null;
  const categorias = Array.isArray(x.categorias)
    ? x.categorias.filter((c: any) => c && HEX.test(String(c.color)) && c.valor != null).slice(0, 300).map((c: any) => ({ ...c, valor: String(c.valor).slice(0, 120) }))
    : undefined;
  const iconos = x.iconos && typeof x.iconos === 'object' ? Object.fromEntries(Object.entries(x.iconos).filter(([, v]) => HEX.test(String(v)))) : undefined;
  return {
    fuente: x.fuente,
    tipo: x.tipo,
    ...(typeof x.campo === 'string' ? { campo: x.campo } : {}),
    ...(HEX.test(String(x.color)) ? { color: x.color } : {}),
    ...(HEX.test(String(x.otro)) ? { otro: x.otro } : {}),
    ...(categorias ? { categorias } : {}),
    ...(iconos ? { iconos: iconos as Record<string, string> } : {}),
    ...(typeof x.nota === 'string' ? { nota: x.nota.slice(0, 300) } : {}),
  };
}

/** El manifiesto del cubo, con cinco minutos de memoria. Null si no hay. */
export async function manifiesto(): Promise<Manifiesto | null> {
  if (leido && Date.now() - leido.cuando < 5 * 60_000) return leido.m;
  let m: Manifiesto | null = null;
  if (bucketExpedientes()) {
    const r = await bajarExpediente(`${PREFIJO}manifest.json`);
    if (r.ok) {
      try {
        m = validarManifiesto(JSON.parse(r.datos.toString('utf8')));
      } catch {
        console.error('[indice] manifest.json no es JSON válido');
      }
    }
  }
  leido = { cuando: Date.now(), m };
  return m;
}

export function olvidarManifiesto() {
  leido = null;
  paraMem.clear();
}

/** Para las pruebas: un manifiesto en memoria, como si viniera del cubo. */
export function usarManifiesto(m: Manifiesto | null) {
  leido = { cuando: Date.now(), m };
  paraMem.clear();
}

/**
 * ¿Puede esta organización abrir este plano? Si su texto está en el cerebro, manda la visibilidad de
 * ese documento (la misma regla que en todas las rutas de documentos). Si no hay documento (una
 * imagen sin texto), es material de la casa: solo la casa.
 */
export async function planoVisible(e: EntradaIndice): Promise<boolean> {
  const f = (e.fuentes || []).find((x) => typeof x.plano === 'string');
  if (!f) return false;
  const org = organizacionActual();
  if (f.documento) {
    if (!hayBase()) return !org || org === CASA;
    const [d] = await consultaConTope<{ id: string }>(`SELECT d.id::text FROM documento d WHERE d.id = $1${sqlDocumentoVisible('d')}`, [f.documento], 6000);
    return !!d;
  }
  return !org || org === CASA;
}

/**
 * El manifiesto para esta persona: las capas de la base que su organización no ve quedan sin
 * fuente (se muestran en gris, como las faltantes), y no se dice de qué capa interna salen.
 */
const paraMem = new Map<string, { cuando: number; base: Manifiesto; m: Manifiesto }>();

export async function manifiestoPara(): Promise<Manifiesto | null> {
  const m = await manifiesto();
  if (!m) return null;
  // Dr Electrum lo mira en cada pregunta desde el mapa: un minuto de memoria por organización
  // (y se rehace si cambió el manifiesto del cubo).
  const clave = organizacionActual() || '';
  const ya = paraMem.get(clave);
  if (ya && ya.base === m && Date.now() - ya.cuando < 60_000) return ya.m;
  const r = await armarPara(m);
  paraMem.set(clave, { cuando: Date.now(), base: m, m: r });
  return r;
}

async function armarPara(m: Manifiesto): Promise<Manifiesto> {
  const visibles = new Set((hayBase() ? await capasPorRol() : []).map((c) => c.id));
  // Los planos que esta organización no puede abrir no se listan (revisión de Codex en #168).
  const planos = await Promise.all(m.capas.filter((c) => c.tipo === 'documento').map(async (c) => [c.id, await planoVisible(c)] as const));
  const ocultos = new Set(planos.filter(([, ok]) => !ok).map(([id]) => id));
  return {
    ...m,
    capas: m.capas.filter((c) => !ocultos.has(c.id)).map((c) => {
      const fuentes = (c.fuentes || []).filter((f) => !f.capa || visibles.has(f.capa));
      const sinBase = (c.fuentes || []).some((f) => f.capa) && !fuentes.some((f) => f.capa || f.cartera);
      // Al frontal le basta saber QUÉ tipo de fuente es; los ids internos de capa se quedan aquí.
      return { ...c, fuentes: fuentes.map((f) => (f.capa ? { base: true, propiedades: f.propiedades } : f)) as Fuente[], ...(sinBase ? { ruta_web: null } : {}) };
    }),
  };
}

type Fila = { id: string; nombre: string | null; props: Record<string, unknown> | null; g: string };

/** Los rasgos de una capa del índice que vive en la base, listos para el mapa. */
export async function capaDelIndice(id: number): Promise<{ geojson: FeatureCollection; entrada: EntradaIndice } | { error: string; status: number }> {
  const m = await manifiesto();
  const e = m?.capas.find((c) => c.id === id);
  if (!e) return { error: 'Esa capa no está en el índice.', status: 404 };
  const fuentes = (e.fuentes || []).filter((f) => f.capa || f.cartera);
  if (!fuentes.length) return { error: 'Esa capa no se sirve desde la base (es teselas, catastro o un plano).', status: 404 };
  const roles = new Map((await capasPorRol()).map((c) => [c.id, c.rol] as [number, RolCapa]));
  // Lo que se filtra y lo que hace falta para pintarla con su estilo (el campo de categorías o el relleno/borde/ícono del KML).
  const campos = [...new Set([...(e.filtros || []).map((f) => f.campo), ...camposDeEstilo(e.estilo), 'minerales'])];
  const total = fuentes.reduce((s, f) => s + (f.capa ? 1 : 0), 0);
  if (!total && !fuentes.some((f) => f.cartera)) return { error: 'Esa capa no está disponible para su organización.', status: 404 };
  const features: FeatureCollection['features'] = [];
  for (const f of fuentes) {
    let filas: Fila[] = [];
    if (f.capa) {
      const rol = roles.get(f.capa);
      if (!rol) continue; // no la ve esta organización
      /*
       * Para el mapa, simplificado: ~30 m de tolerancia (≈50 m en las de miles de rasgos). Sin esto,
       * aldeas, municipios y departamentos pesaban 53, 44 y 19 MB de GeoJSON y trababan el navegador
       * (el recorrido se quedaba mudo en el paso siguiente). Con esto, 3,8, 1,2 y 0,5 MB. A los puntos
       * no les cambia nada. El análisis de áreas usa la geometría completa de la base, no esta ruta.
       */
      const n = (e.num_entidades || 0) > 4000 ? 0.0005 : 0.0003;
      filas = await consultaConTope<Fila>(
        `SELECT e.id::text, ${nombreDe(rol)} AS nombre,
                (SELECT jsonb_object_agg(a.k, a.v) FROM jsonb_each_text(e.atributos) a(k, v) WHERE a.k = ANY($2::text[])) AS props,
                ST_AsGeoJSON(CASE WHEN $3::float8 > 0 THEN ST_SimplifyPreserveTopology(e.geom, $3::float8) ELSE e.geom END, 5)::text AS g
           FROM entidad_geo e WHERE e.capa_id = $1 LIMIT ${MAX_RASGOS + 1}`,
        [f.capa, campos, n],
        20000
      ).then(conTextoReparado);
    } else if (f.cartera) {
      filas = await consultaConTope<Fila>(
        `SELECT c.id::text, c.nombre, jsonb_build_object('estado', c.estado, 'titular', c.titular) AS props, ST_AsGeoJSON(c.geom, 6)::text AS g
           FROM cartera k JOIN cartera_concesion kc ON kc.cartera_id = k.id JOIN concesion c ON c.huella = kc.huella
          WHERE k.nombre = $1${sqlCarteraVisible('k')} LIMIT ${MAX_RASGOS + 1}`,
        [f.cartera],
        20000
      ).then(conTextoReparado);
    }
    const porDefecto = colorPrincipal(e as unknown as EntradaCatalogo);
    for (const r of filas) {
      if (!r.g) continue;
      const geometry = JSON.parse(r.g);
      const props: Record<string, unknown> = { ...(r.props || {}), ...(f.propiedades || {}), layer_id: e.id, ...(f.capa ? { eid: Number(r.id) } : { concesion: Number(r.id) }), nombre: r.nombre || '' };
      // El color de CADA rasgo, con la misma regla que la leyenda (src-electrum/mapa/catalogo.ts):
      // MapLibre y Google lo leen de aquí y pintan igual.
      const c = colorDeRasgo(e.estilo, (k) => props[k], String(geometry?.type || ''), porDefecto);
      props._c = c.relleno;
      props._b = c.borde;
      if (c.opacidadRelleno != null) props._o = c.opacidadRelleno;
      features.push({ type: 'Feature', geometry, properties: props });
    }
    if (features.length > MAX_RASGOS) return { error: `Esa capa tiene más de ${MAX_RASGOS} rasgos: se ve por teselas.`, status: 413 };
  }
  return { geojson: { type: 'FeatureCollection', features }, entrada: e };
}

/**
 * contar_entidades: cuántos rasgos de una capa del índice cumplen los filtros (varios valores = O,
 * varios campos = Y). Con los mismos datos que se pintan; null si la capa no se cuenta (teselas,
 * imágenes) o si no hay base.
 */
export async function contarIndice(id: number, filtros: Filtros = {}): Promise<number | null> {
  const m = await manifiesto();
  const e = m?.capas.find((c) => c.id === id);
  if (!e || !hayBase()) return null;
  const activos = Object.entries(filtros || {}).filter(([, vs]) => vs?.length);
  const fu = e.fuentes || [];
  if (fu.some((f) => f.catastro)) {
    const conds: string[] = ['geom IS NOT NULL'];
    const params: unknown[] = [];
    for (const [campo, vs] of activos) {
      if (campo !== 'estado' && campo !== 'tipo') return null;
      params.push(vs);
      conds.push(`${campo} = ANY($${params.length}::text[])`);
    }
    const [r] = await consultaConTope<{ n: string }>(`SELECT count(*)::text AS n FROM concesion WHERE ${conds.join(' AND ')}`, params, 10000);
    return Number(r?.n ?? 0);
  }
  const base = fu.filter((f) => f.capa || f.cartera);
  if (!base.length) return activos.length ? null : e.num_entidades ?? null;
  const visibles = new Set((await capasPorRol()).map((c) => c.id));
  let total = 0;
  for (const f of base) {
    if (f.capa && !visibles.has(f.capa)) continue;
    // Lo que la fuente trae fijo (el mineral de cada archivo de fichas) se resuelve aquí, sin SQL.
    let cumple = true;
    const resto: Array<[string, string[]]> = [];
    for (const [campo, vs] of activos) {
      const fijo = f.propiedades?.[campo];
      if (fijo != null) cumple = cumple && vs.includes(String(fijo));
      else resto.push([campo, vs]);
    }
    if (!cumple) continue;
    const params: unknown[] = [f.capa ?? f.cartera];
    const conds = resto.map(([campo, vs]) => {
      params.push(campo, vs);
      return f.capa ? `(e.atributos->>$${params.length - 1}) = ANY($${params.length}::text[])` : `(CASE $${params.length - 1} WHEN 'estado' THEN c.estado WHEN 'titular' THEN c.titular END) = ANY($${params.length}::text[])`;
    });
    const sql = f.capa
      ? `SELECT count(*)::text AS n FROM entidad_geo e WHERE e.capa_id = $1${conds.map((c) => ` AND ${c}`).join('')}`
      : `SELECT count(*)::text AS n FROM cartera k JOIN cartera_concesion kc ON kc.cartera_id = k.id JOIN concesion c ON c.huella = kc.huella WHERE k.nombre = $1${sqlCarteraVisible('k')}${conds.map((c) => ` AND ${c}`).join('')}`;
    const [r] = await consultaConTope<{ n: string }>(sql, params, 10000);
    total += Number(r?.n ?? 0);
  }
  return total;
}

let perimetroMem: { cuando: number; fc: FeatureCollection } | null = null;
/** El contorno de Honduras (los departamentos disueltos en un polígono), del cubo o de la base. */
export async function perimetro(): Promise<FeatureCollection | null> {
  if (perimetroMem && Date.now() - perimetroMem.cuando < 60 * 60_000) return perimetroMem.fc;
  let fc: FeatureCollection | null = null;
  if (bucketExpedientes()) {
    const r = await bajarExpediente(`${PREFIJO}perimetro.geojson`);
    if (r.ok) {
      try {
        fc = JSON.parse(r.datos.toString('utf8'));
      } catch {
        fc = null;
      }
    }
  }
  if (!fc && hayBase()) {
    const [f] = await consultaConTope<{ g: string | null }>(
      `SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Union(ST_MakeValid(e.geom)), 0.002), 5)::text AS g
         FROM entidad_geo e JOIN capa c ON c.id = e.capa_id WHERE c.rol = 'departamento'`,
      [],
      30000
    );
    if (f?.g) fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: JSON.parse(f.g), properties: { layer_id: 1, nombre: 'Honduras' } }] };
  }
  if (fc) perimetroMem = { cuando: Date.now(), fc };
  return fc;
}

const TIPO_PLANO: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

export function montarRutasIndice(app: Express, enviar: (req: Request, res: Response, cuerpo: unknown) => unknown) {
  const E = exigirPlataforma('electrum');

  app.get('/api/electrum/mapa/indice', E, limitar(60), async (req: Request, res: Response) => {
    try {
      const m = await manifiestoPara();
      if (!m) return res.status(404).json({ error: 'Todavía no hay índice de capas en el cubo.', honesto: true });
      res.setHeader('Cache-Control', 'private, max-age=300');
      return enviar(req, res, { ...m, cuarentena: undefined, honesto: true });
    } catch (e: any) {
      console.error('[indice]', String(e?.message || e).slice(0, 160));
      return res.status(503).json({ error: 'No pude leer el índice de capas.', honesto: true });
    }
  });

  app.get('/api/electrum/mapa/indice/capa/:id', E, limitar(60), async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || id > 999999) return res.status(400).json({ error: 'ID de capa inválido.', honesto: true });
    if (!hayBase()) return res.status(503).json({ error: 'No hay base conectada.', honesto: true });
    try {
      const r = await capaDelIndice(id);
      if ('error' in r) return res.status(r.status).json({ error: r.error, honesto: true });
      res.setHeader('Cache-Control', 'private, max-age=300');
      return enviar(req, res, { id, nombre: r.entrada.nombre, geojson: r.geojson, honesto: true });
    } catch (e: any) {
      console.error('[indice] capa', id, String(e?.message || e).slice(0, 160));
      return res.status(503).json({ error: 'No pude leer esa capa de la base.', honesto: true });
    }
  });

  app.get('/api/electrum/mapa/perimetro', E, limitar(60), async (req: Request, res: Response) => {
    try {
      const fc = await perimetro();
      if (!fc) return res.status(404).json({ error: 'No tengo el perímetro de Honduras.', honesto: true });
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return enviar(req, res, { geojson: fc, honesto: true });
    } catch (e: any) {
      console.error('[indice] perímetro', String(e?.message || e).slice(0, 160));
      return res.status(503).json({ error: 'No pude armar el perímetro.', honesto: true });
    }
  });

  // Un plano sin georreferencia, para el visor. Mirar sí; llevárselo, no: con código temporal no se baja.
  app.get('/api/electrum/mapa/plano/:id', E, limitar(60), async (req: Request, res: Response) => {
    if (esInvitado(req)) return res.status(403).json({ error: 'Los planos se abren con usuario propio. Con un código temporal se puede mirar el mapa, pero no los archivos.', code: 'invitado', honesto: true });
    const id = Number(req.params.id);
    const m = await manifiesto();
    const e = m?.capas.find((c) => c.id === id && c.tipo === 'documento');
    const clave = e?.fuentes?.find((f) => typeof f.plano === 'string')?.plano;
    if (!e || !clave || !/^biblioteca\/mapas\/planos\/\d{6}\.(pdf|jpe?g|png)$/.test(clave)) return res.status(404).json({ error: 'Ese plano no está en el índice.', honesto: true });
    // De otra organización: como si no existiera.
    if (!(await planoVisible(e).catch(() => false))) return res.status(404).json({ error: 'Ese plano no está en el índice.', honesto: true });
    const r = await bajarExpediente(clave);
    if (!r.ok) return res.status(404).json({ error: 'Ese plano no está en el cubo.', honesto: true });
    const ext = clave.split('.').pop()!.toLowerCase();
    res.setHeader('Content-Type', TIPO_PLANO[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${id}.${ext}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(r.datos);
  });
}

