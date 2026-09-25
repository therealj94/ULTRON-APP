/**
 * MEMORIA ESTRUCTURADA — lo que se sabe con certeza sobre las cosas del mundo.
 *
 * El RAG encuentra párrafos parecidos; esto guarda FICHAS: «Empresa XYZ · minería · Honduras ·
 * en revisión documental · riesgo medio · documentos: NI 43-101, contrato, KYC». Con relaciones
 * («XYZ es titular de la concesión El Porvenir», «Pedro es representante de XYZ») y un historial de
 * eventos con fecha y fuente.
 *
 * Tipos previstos: empresa, persona, proyecto, concesion, documento, wallet, decision, evento — y
 * cualquier otro en minúsculas: la lista no es cerrada a propósito.
 *
 * Cada plataforma tiene su propia memoria (la junta no ve las fichas de los clientes mineros y al
 * revés). Escribir pasa por el motor de reglas como cualquier otra escritura; cada cambio queda en la
 * cadena de auditoría.
 */
import { auditar } from './auditoria';
import { leerTodas, reescribir, sql, tipo as tipoAlmacen } from './base';

export type Entidad = {
  id: number;
  plataforma: string;
  tipo: string;
  nombre: string;
  clave: string;
  atributos: Record<string, unknown>;
  estado: string | null;
  riesgo: string | null;
  creada: string;
  actualizada: string;
  creada_por: string | null;
};

export type Relacion = { id: number; desde: number; hasta: number; tipo: string; atributos: Record<string, unknown>; creada: string };
export type Evento = { id: number; entidad: number; t: string; tipo: string; detalle: string; fuente: string | null; quien: string | null };

export type Ficha = Entidad & {
  relaciones: Array<{ tipo: string; sentido: 'sale' | 'entra'; con: { id: number; tipo: string; nombre: string } }>;
  eventos: Evento[];
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/**
 * La clave natural: el nombre sin acentos, mayúsculas, signos ni sufijo societario. «Minera del Sur»,
 * «MINERA DEL SUR» y «Minera del Sur, S.A.» son la misma empresa, y nombrarla de cualquiera de esas
 * formas en una pregunta trae su ficha.
 */
const SUFIJO_SOCIETARIO = /(-(s-a|sa|s-a-de-c-v|sa-de-cv|s-de-r-l|s-de-rl|srl|s-r-l|inc|ltd|ltda|llc|corp|corporation|limited|gmbh|s-l|sl))+$/;
export const claveDe = (nombre: string) =>
  fold(nombre)
    .replace(/[^a-z0-9ñ]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(SUFIJO_SOCIETARIO, '');

const TIPO_VALIDO = /^[a-z][a-z_]{1,30}$/;

function iso(v: any) {
  return v ? new Date(v).toISOString() : v;
}
function normal(f: any): Entidad {
  return { ...f, id: Number(f.id), atributos: f.atributos || {}, creada: iso(f.creada), actualizada: iso(f.actualizada) };
}

/* ------------------------------------------------------------------ archivo (sin base) */

type Todo = { entidades: Entidad[]; relaciones: Relacion[]; eventos: Evento[] };
function leerArchivo(): Todo {
  const [t] = leerTodas<Todo>('memoria-estructurada');
  return t || { entidades: [], relaciones: [], eventos: [] };
}
function guardarArchivo(t: Todo) {
  reescribir('memoria-estructurada', [t]);
}
const siguiente = (xs: Array<{ id: number }>) => xs.reduce((m, x) => Math.max(m, x.id), 0) + 1;

/* ------------------------------------------------------------------ escribir */

/**
 * Crea o actualiza una ficha. Los atributos se FUNDEN con los que ya tenía (no se pierde lo que no
 * se mencionó); estado y riesgo se reemplazan si vienen. El nombre que se ve es el de la primera vez:
 * que alguien lo escriba en mayúsculas después no lo cambia.
 */
export async function registrarEntidad(o: {
  plataforma: string;
  tipo: string;
  nombre: string;
  atributos?: Record<string, unknown>;
  estado?: string | null;
  riesgo?: string | null;
  quien?: string | null;
}): Promise<Entidad> {
  const tipo = fold(o.tipo);
  if (!TIPO_VALIDO.test(tipo)) throw new Error(`tipo inválido: ${o.tipo}`);
  const nombre = o.nombre.trim().slice(0, 200);
  if (!nombre) throw new Error('falta el nombre');
  const clave = claveDe(nombre);
  const atributos = o.atributos || {};
  let e: Entidad;
  if (tipoAlmacen() === 'postgres') {
    const [f] = await sql(
      `INSERT INTO cognitivo.entidad (plataforma, tipo, nombre, clave, atributos, estado, riesgo, creada_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (plataforma, tipo, clave) DO UPDATE SET
         atributos = cognitivo.entidad.atributos || EXCLUDED.atributos,
         estado = COALESCE(EXCLUDED.estado, cognitivo.entidad.estado),
         riesgo = COALESCE(EXCLUDED.riesgo, cognitivo.entidad.riesgo),
         actualizada = now()
       RETURNING *`,
      [o.plataforma, tipo, nombre, clave, JSON.stringify(atributos), o.estado ?? null, o.riesgo ?? null, o.quien ?? null]
    );
    e = normal(f);
  } else {
    const t = leerArchivo();
    const ahora = new Date().toISOString();
    const i = t.entidades.findIndex((x) => x.plataforma === o.plataforma && x.tipo === tipo && x.clave === clave);
    if (i >= 0) {
      const v = t.entidades[i];
      e = { ...v, atributos: { ...v.atributos, ...atributos }, estado: o.estado ?? v.estado, riesgo: o.riesgo ?? v.riesgo, actualizada: ahora };
      t.entidades[i] = e;
    } else {
      e = { id: siguiente(t.entidades), plataforma: o.plataforma, tipo, nombre, clave, atributos, estado: o.estado ?? null, riesgo: o.riesgo ?? null, creada: ahora, actualizada: ahora, creada_por: o.quien ?? null };
      t.entidades.push(e);
    }
    guardarArchivo(t);
  }
  await auditar({ tipo: 'entidad.cambio', plataforma: o.plataforma, quien: o.quien ?? null, datos: { accion: 'registrar', id: e.id, tipo, nombre, atributos: atributos as any, estado: o.estado ?? null, riesgo: o.riesgo ?? null } });
  return e;
}

export async function relacionar(o: { plataforma: string; desde: number; hasta: number; tipo: string; atributos?: Record<string, unknown>; quien?: string | null }): Promise<Relacion> {
  const tipo = fold(o.tipo).replace(/\s+/g, '_');
  if (!TIPO_VALIDO.test(tipo)) throw new Error(`tipo de relación inválido: ${o.tipo}`);
  if (o.desde === o.hasta) throw new Error('una entidad no se relaciona consigo misma');
  const [a, b] = await Promise.all([entidadPorId(o.plataforma, o.desde), entidadPorId(o.plataforma, o.hasta)]);
  if (!a || !b) throw new Error('alguna de las dos entidades no existe en esta plataforma');
  let r: Relacion;
  if (tipoAlmacen() === 'postgres') {
    const [f] = await sql(
      `INSERT INTO cognitivo.relacion (desde, hasta, tipo, atributos) VALUES ($1,$2,$3,$4)
       ON CONFLICT (desde, hasta, tipo) DO UPDATE SET atributos = cognitivo.relacion.atributos || EXCLUDED.atributos
       RETURNING *`,
      [o.desde, o.hasta, tipo, JSON.stringify(o.atributos || {})]
    );
    r = { ...f, id: Number(f.id), desde: Number(f.desde), hasta: Number(f.hasta), creada: iso(f.creada) };
  } else {
    const t = leerArchivo();
    const ya = t.relaciones.find((x) => x.desde === o.desde && x.hasta === o.hasta && x.tipo === tipo);
    if (ya) {
      ya.atributos = { ...ya.atributos, ...(o.atributos || {}) };
      r = ya;
    } else {
      r = { id: siguiente(t.relaciones), desde: o.desde, hasta: o.hasta, tipo, atributos: o.atributos || {}, creada: new Date().toISOString() };
      t.relaciones.push(r);
    }
    guardarArchivo(t);
  }
  await auditar({ tipo: 'entidad.cambio', plataforma: o.plataforma, quien: o.quien ?? null, datos: { accion: 'relacionar', desde: o.desde, hasta: o.hasta, tipo } });
  return r;
}

export async function registrarEvento(o: { plataforma: string; entidad: number; tipo: string; detalle: string; fuente?: string | null; quien?: string | null }): Promise<Evento> {
  const e = await entidadPorId(o.plataforma, o.entidad);
  if (!e) throw new Error('la entidad no existe en esta plataforma');
  const tipo = fold(o.tipo).replace(/\s+/g, '_').slice(0, 40) || 'nota';
  const detalle = o.detalle.trim().slice(0, 2000);
  if (!detalle) throw new Error('falta el detalle');
  let ev: Evento;
  if (tipoAlmacen() === 'postgres') {
    const [f] = await sql(`INSERT INTO cognitivo.evento (entidad, tipo, detalle, fuente, quien) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [o.entidad, tipo, detalle, o.fuente ?? null, o.quien ?? null]);
    await sql(`UPDATE cognitivo.entidad SET actualizada = now() WHERE id = $1`, [o.entidad]);
    ev = { ...f, id: Number(f.id), entidad: Number(f.entidad), t: iso(f.t) };
  } else {
    const t = leerArchivo();
    ev = { id: siguiente(t.eventos), entidad: o.entidad, t: new Date().toISOString(), tipo, detalle, fuente: o.fuente ?? null, quien: o.quien ?? null };
    t.eventos.push(ev);
    guardarArchivo(t);
  }
  await auditar({ tipo: 'entidad.cambio', plataforma: o.plataforma, quien: o.quien ?? null, datos: { accion: 'evento', entidad: o.entidad, tipo, detalle: detalle.slice(0, 300) } });
  return ev;
}

/* ------------------------------------------------------------------ leer */

export async function entidadPorId(plataforma: string, id: number): Promise<Entidad | null> {
  if (tipoAlmacen() === 'postgres') {
    const [f] = await sql(`SELECT * FROM cognitivo.entidad WHERE id = $1 AND plataforma = $2`, [id, plataforma]);
    return f ? normal(f) : null;
  }
  return leerArchivo().entidades.find((e) => e.id === id && e.plataforma === plataforma) || null;
}

/** Busca por nombre (sin acentos, por pedazos) y opcionalmente por tipo. */
export async function buscarEntidades(plataforma: string, texto: string, o: { tipo?: string; limite?: number } = {}): Promise<Entidad[]> {
  const q = claveDe(texto);
  const limite = Math.min(Math.max(o.limite || 10, 1), 50);
  if (!q) return [];
  if (tipoAlmacen() === 'postgres') {
    const filas = await sql(
      `SELECT * FROM cognitivo.entidad
        WHERE plataforma = $1 AND ($2::text IS NULL OR tipo = $2) AND (clave LIKE '%' || $3 || '%' OR $3 LIKE '%' || clave || '%')
        ORDER BY (clave = $3) DESC, actualizada DESC LIMIT $4`,
      [plataforma, o.tipo ? fold(o.tipo) : null, q, limite]
    );
    return filas.map(normal);
  }
  return leerArchivo()
    .entidades.filter((e) => e.plataforma === plataforma && (!o.tipo || e.tipo === fold(o.tipo)) && (e.clave.includes(q) || q.includes(e.clave)))
    .sort((a, b) => Number(b.clave === q) - Number(a.clave === q) || b.actualizada.localeCompare(a.actualizada))
    .slice(0, limite);
}

export async function ficha(plataforma: string, id: number): Promise<Ficha | null> {
  const e = await entidadPorId(plataforma, id);
  if (!e) return null;
  let relaciones: Ficha['relaciones'];
  let eventos: Evento[];
  if (tipoAlmacen() === 'postgres') {
    const rs = await sql(
      `SELECT r.tipo, CASE WHEN r.desde = $1 THEN 'sale' ELSE 'entra' END AS sentido, o.id, o.tipo AS otipo, o.nombre
         FROM cognitivo.relacion r JOIN cognitivo.entidad o ON o.id = CASE WHEN r.desde = $1 THEN r.hasta ELSE r.desde END
        WHERE r.desde = $1 OR r.hasta = $1 ORDER BY r.creada`,
      [id]
    );
    relaciones = rs.map((r: any) => ({ tipo: r.tipo, sentido: r.sentido, con: { id: Number(r.id), tipo: r.otipo, nombre: r.nombre } }));
    eventos = (await sql(`SELECT * FROM cognitivo.evento WHERE entidad = $1 ORDER BY t DESC LIMIT 20`, [id])).map((f: any) => ({ ...f, id: Number(f.id), entidad: Number(f.entidad), t: iso(f.t) }));
  } else {
    const t = leerArchivo();
    const porId = new Map(t.entidades.map((x) => [x.id, x]));
    relaciones = t.relaciones
      .filter((r) => r.desde === id || r.hasta === id)
      .map((r) => {
        const otro = porId.get(r.desde === id ? r.hasta : r.desde)!;
        return { tipo: r.tipo, sentido: r.desde === id ? ('sale' as const) : ('entra' as const), con: { id: otro.id, tipo: otro.tipo, nombre: otro.nombre } };
      });
    eventos = t.eventos.filter((x) => x.entidad === id).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 20);
  }
  return { ...e, relaciones, eventos };
}

/** La ficha en texto corto para el modelo. */
export function fichaEnTexto(f: Ficha): string {
  const attrs = Object.entries(f.atributos)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ');
  const rels = f.relaciones.map((r) => (r.sentido === 'sale' ? `${r.tipo.replace(/_/g, ' ')} ${r.con.nombre}` : `${r.con.nombre} ${r.tipo.replace(/_/g, ' ')} (esta)`)).join('; ');
  const evs = f.eventos
    .slice(0, 5)
    .map((e) => `${e.t.slice(0, 10)} ${e.tipo}: ${e.detalle}${e.fuente ? ` [${e.fuente}]` : ''}`)
    .join(' | ');
  return [
    `FICHA [${f.tipo} #${f.id}] ${f.nombre}`,
    attrs && `atributos: ${attrs}`,
    f.estado && `estado: ${f.estado}`,
    f.riesgo && `riesgo: ${f.riesgo}`,
    rels && `relaciones: ${rels}`,
    evs && `eventos: ${evs}`,
    `actualizada ${f.actualizada.slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Las fichas de las entidades que se NOMBRAN en el mensaje (nombre de 4+ letras), para ponerlas al
 * lado de la pregunta como hecho. Así «¿cómo va Minera del Sur?» llega con su ficha sin que el
 * modelo tenga que pedirla.
 */
export async function fichasMencionadas(plataforma: string, mensaje: string, max = 3): Promise<Ficha[]> {
  const q = claveDe(mensaje);
  if (q.length < 4) return [];
  let ids: number[];
  if (tipoAlmacen() === 'postgres') {
    const filas = await sql<{ id: number }>(
      `SELECT id FROM cognitivo.entidad WHERE plataforma = $1 AND length(clave) >= 4 AND $2 LIKE '%' || clave || '%' ORDER BY length(clave) DESC LIMIT $3`,
      [plataforma, q, max]
    );
    ids = filas.map((f) => Number(f.id));
  } else {
    ids = leerArchivo()
      .entidades.filter((e) => e.plataforma === plataforma && e.clave.length >= 4 && q.includes(e.clave))
      .sort((a, b) => b.clave.length - a.clave.length)
      .slice(0, max)
      .map((e) => e.id);
  }
  const fs = await Promise.all(ids.map((id) => ficha(plataforma, id)));
  return fs.filter((f): f is Ficha => !!f);
}
