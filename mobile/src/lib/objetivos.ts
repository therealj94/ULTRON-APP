/**
 * LOS OBJETIVOS CON ESTADO, SIN PANTALLA (Fase 2). Lo que comparten el teléfono (mobile/src/objetivos/) y la web
 * (src/13-trabajo/Objetivos.tsx la importa tal cual, como lib/trabajos.ts): el contrato del servidor (server/objetivos.ts,
 * /api/objetivos), el cliente HTTP sobre el transporte de cada uno, qué hacer con un 409, la hoja del objetivo en datos
 * (criterios ✓/pendiente, documentos vigentes, decisiones, eventos) y «qué cambió desde la última vez» con la última
 * revisión que vio ESTE aparato (o este navegador).
 *
 * Reglas:
 *  · El servidor es la fuente de verdad. Toda decisión va con la revisión que se vio (`revisionVista`); si el objetivo
 *    cambió mientras tanto, el servidor contesta 409 con la revisión y el objetivo de ahora: se muestra ESE (no se
 *    reintenta solo) y se dice «Cambió mientras tanto».
 *  · Las opciones de una decisión no se arman hasta ARMADO_MS después de aparecer (como la tarjeta de las tareas).
 *  · La última revisión vista solo sube (un objetivo leído viejo no la baja) y se guarda por aparato, no en el servidor.
 * Puro: sin React ni React Native (lo prueba tests/objetivos-clientes.test.ts en Node).
 */
import type { Pedir } from './trabajos';

/* ------------------------------------------------------------------ el contrato (copia del servidor) */

export type EstadoObjetivo = 'abierto' | 'esperando-decision' | 'en-curso' | 'esperando-recurso' | 'incierto' | 'completado' | 'cancelado' | 'fallido';
export type EvidenciaObjetivo = { tipo: 'documento' | 'tarea' | 'enlace'; ref: string; etiqueta: string; t: number };
export type CriterioObjetivo = { id: string; texto: string; evidencias: EvidenciaObjetivo[] };
export type DocumentoObjetivo = { id: string; nombre: string; version: number; anteriorId?: string; vigente: boolean; sha256: string; creado: number };
export type OpcionObjetivo = { id: string; etiqueta: string; consecuencia: string };
export type DecisionObjetivo = { id: string; pregunta: string; opciones: OpcionObjetivo[]; elegida?: string; version: number; por?: 'persona' | 'aura'; cuando?: number; aparato?: string; creada: number };
export type EventoObjetivo = { revision: number; t: number; texto: string; campos?: string[] };

export type VistaObjetivo = {
  id: string;
  plataforma: 'ultron';
  proyecto: string;
  titulo: string;
  meta: string;
  criterioCierre: CriterioObjetivo[];
  documentos: DocumentoObjetivo[];
  decisiones: DecisionObjetivo[];
  restricciones: string[];
  permisos: string[];
  topeCosto: number | null;
  siguientePaso: string;
  estado: EstadoObjetivo;
  pausado: boolean;
  revision: number;
  eventos: EventoObjetivo[];
  tareas: string[];
  creado: number;
  actualizado: number;
  terminal: boolean;
  decisionesPendientes: number;
};

export type CambiosObjetivo = {
  revision: number;
  desde: number;
  resync: boolean;
  eventos: { revision: number; t: number; texto: string }[];
  campos: Record<string, unknown>;
  objetivo?: VistaObjetivo;
};

const TERMINALES = new Set<EstadoObjetivo>(['completado', 'cancelado', 'fallido']);
export const esTerminalObjetivo = (o: Pick<VistaObjetivo, 'estado'>) => TERMINALES.has(o.estado);

/** Cuánto espera una opción de decisión antes de poder tocarse (el mismo de las tareas: lib/trabajos.ts). */
export const ARMADO_MS = 1500;

/* ------------------------------------------------------------------ lo que contesta el servidor */

export type ResultadoObjetivo =
  | { ok: true; objetivo: VistaObjetivo | null; repetida?: boolean; sinCambio?: boolean }
  /** `conflicto`: el objetivo cambió (409): `objetivo` es el de ahora y hay que mirarlo antes de decidir otra vez. */
  | { ok: false; codigo: string; conflicto: boolean; mensaje: string; objetivo?: VistaObjetivo | null; revision?: number };

/** El texto que se dice para cada código del servidor (y «red»), sin culpar a nadie y diciendo que no se hizo nada. */
export function mensajeErrorObjetivo(codigo: string | undefined, idioma: 'es' | 'en' = 'es'): string {
  const es: Record<string, string> = {
    revision: 'Cambió mientras tanto. No apliqué nada: mira la versión nueva antes de decidir.',
    'decision-vieja': 'Esa pregunta ya cambió. No apliqué nada: mira la versión nueva.',
    'ya-decidida': 'Esa decisión ya se tomó (quizá desde otro aparato). No hice nada nuevo.',
    terminal: 'El objetivo ya terminó; no cambia.',
    opcion: 'Esa opción ya no se ofrece. No apliqué nada.',
    'sin-evidencia': 'Para cerrarlo, cada criterio necesita su evidencia.',
    almacen_no_disponible: 'No pude leer tus objetivos ahora. Prueba en un momento.',
    'no-existe': 'Ese objetivo ya no está.',
    red: 'No pude hablar con el servidor. No sé si llegó: vuelve a mirar antes de repetir.',
  };
  const en: Record<string, string> = {
    revision: 'It changed in the meantime. Nothing was applied: check the new version first.',
    'decision-vieja': 'That question changed. Nothing was applied: check the new version.',
    'ya-decidida': 'That decision was already made (maybe from another device). Nothing new was done.',
    terminal: 'The goal already finished; it does not change.',
    opcion: 'That option is no longer offered. Nothing was applied.',
    'sin-evidencia': 'To close it, every criterion needs its evidence.',
    almacen_no_disponible: 'I could not read your goals right now. Try again in a moment.',
    'no-existe': 'That goal is gone.',
    red: 'Could not reach the server. Check again before retrying.',
  };
  const m = (idioma === 'en' ? en : es)[String(codigo || '')];
  return m || (idioma === 'en' ? 'It could not be done. Nothing was applied.' : 'No se pudo. No apliqué nada.');
}

/** Los códigos que significan «cambió mientras tanto» (hay que mostrar la versión nueva, no reintentar). */
const CONFLICTO = new Set(['revision', 'decision-vieja', 'ya-decidida', 'terminal', 'opcion', 'version', 'propuesta-cambiada', 'sin-decision', 'caducada']);

/**
 * Qué significa una respuesta del servidor a una acción sobre un objetivo. 2xx: lo que quedó. 409 (o una opción que ya
 * no se ofrece): `conflicto` con el objetivo de ahora (viene en el cuerpo). 404: ya no está. Otro: error recuperable.
 */
export function interpretarRespuesta(r: { status: number; json: any }, idioma: 'es' | 'en' = 'es'): ResultadoObjetivo {
  const j = r.json || {};
  if (r.status >= 200 && r.status < 300) return { ok: true, objetivo: (j.objetivo as VistaObjetivo) ?? null, ...(j.repetida ? { repetida: true } : {}), ...(j.sinCambio ? { sinCambio: true } : {}) };
  const codigo = String(j.codigo || j.code || (r.status === 404 ? 'no-existe' : r.status));
  const conflicto = r.status === 409 || r.status === 404 || CONFLICTO.has(codigo);
  return {
    ok: false,
    codigo,
    conflicto,
    mensaje: mensajeErrorObjetivo(conflicto && !CONFLICTO.has(codigo) && r.status === 409 ? 'revision' : codigo, idioma),
    objetivo: (j.objetivo as VistaObjetivo) ?? null,
    ...(Number.isFinite(Number(j.revision)) && j.revision !== undefined ? { revision: Number(j.revision) } : {}),
  };
}

/* ------------------------------------------------------------------ el cliente HTTP */

const enc = encodeURIComponent;

/** Las llamadas de los objetivos, sobre el transporte de cada cliente (la `api` del teléfono, `fetch` de la web). */
export function crearClienteObjetivos(pedir: Pedir, idioma: () => 'es' | 'en' = () => 'es') {
  const post = async (ruta: string, cuerpo: Record<string, unknown> = {}): Promise<ResultadoObjetivo> => {
    try {
      return interpretarRespuesta(await pedir(ruta, { method: 'POST', body: JSON.stringify(cuerpo) }), idioma());
    } catch {
      return { ok: false, codigo: 'red', conflicto: false, mensaje: mensajeErrorObjetivo('red', idioma()) };
    }
  };
  const conRevision = (revisionVista?: number) => (Number.isInteger(revisionVista) && (revisionVista as number) >= 1 ? { revisionVista } : {});
  return {
    /** Todos los suyos (el más reciente primero). `completo: false`: alguno no se pudo leer (no es que no exista). */
    async listar(): Promise<{ ok: true; objetivos: VistaObjetivo[]; completo: boolean } | { ok: false; sinSesion: boolean; mensaje: string }> {
      try {
        const r = await pedir('/api/objetivos', { method: 'GET' });
        if (r.status === 401 || r.status === 403) return { ok: false, sinSesion: true, mensaje: 'sin sesión' };
        if (r.status !== 200 || !Array.isArray(r.json?.objetivos)) return { ok: false, sinSesion: false, mensaje: String(r.json?.error || r.status) };
        return { ok: true, objetivos: r.json.objetivos as VistaObjetivo[], completo: r.json.completo !== false };
      } catch (e: any) {
        return { ok: false, sinSesion: false, mensaje: String(e?.message || e).slice(0, 120) };
      }
    },
    async ver(id: string): Promise<VistaObjetivo | null> {
      try {
        const r = await pedir(`/api/objetivos/${enc(id)}`, { method: 'GET' });
        return r.status === 200 && r.json?.objetivo?.id === id ? (r.json.objetivo as VistaObjetivo) : null;
      } catch {
        return null;
      }
    },
    /** «Qué cambió desde que te fuiste»: lo nuevo después de la revisión `desde` (la última que vio este aparato). */
    async cambios(id: string, desde: number): Promise<CambiosObjetivo | null> {
      try {
        const r = await pedir(`/api/objetivos/${enc(id)}/cambios?desde=${Math.max(0, Math.floor(desde) || 0)}`, { method: 'GET' });
        return r.status === 200 && Number.isFinite(Number(r.json?.revision)) ? (r.json as CambiosObjetivo) : null;
      } catch {
        return null;
      }
    },
    /** La opción EXACTA, ligada a la decisión y a la revisión que se vio. Un 409 trae el objetivo de ahora. */
    decidir: (objetivoId: string, p: { decisionId: string; opcion: string; revisionVista: number; aparato?: string }) =>
      post(`/api/objetivos/${enc(objetivoId)}/decisiones`, { decisionId: p.decisionId, opcion: p.opcion, revisionVista: p.revisionVista, ...(p.aparato ? { aparato: p.aparato } : {}) }),
    /** La decisión de una TAREA del objetivo (su aprobación): la ruta de las tareas, con su versión. */
    decidirTarea: (tareaId: string, p: { decisionId: string; opcion: string; version: number }) =>
      post(`/api/trabajos/${enc(tareaId)}/decisiones?estados=respondida`, { decisionId: p.decisionId, expectedVersion: p.version, opcion: p.opcion }),
    pausar: (id: string, revisionVista?: number) => post(`/api/objetivos/${enc(id)}/pausar`, conRevision(revisionVista)),
    reanudar: (id: string, revisionVista?: number) => post(`/api/objetivos/${enc(id)}/reanudar`, conRevision(revisionVista)),
    cancelar: (id: string, revisionVista?: number) => post(`/api/objetivos/${enc(id)}/cancelar`, conRevision(revisionVista)),
    cerrar: (id: string, revisionVista: number | undefined, evidencias: { criterioId: string; tipo: 'documento' | 'tarea' | 'enlace'; ref: string; etiqueta?: string }[]) =>
      post(`/api/objetivos/${enc(id)}/cerrar`, { ...conRevision(revisionVista), evidencias }),
  };
}

export type ClienteObjetivos = ReturnType<typeof crearClienteObjetivos>;

/* ------------------------------------------------------------------ la hoja del objetivo en datos */

/** El objetivo abierto más reciente (el de «Continuar trabajo»), o null. Lo terminal no cuenta. */
export function objetivoReciente(xs: readonly VistaObjetivo[] | null | undefined): VistaObjetivo | null {
  const abiertos = (xs || []).filter((o) => o && typeof o.id === 'string' && !esTerminalObjetivo(o));
  if (!abiertos.length) return null;
  return [...abiertos].sort((a, b) => (b.actualizado || 0) - (a.actualizado || 0))[0];
}

/** Las decisiones que esperan a la persona (sin elegir), en el orden en que se plantearon. */
export const decisionesSinElegir = (o: Pick<VistaObjetivo, 'decisiones' | 'estado'>): DecisionObjetivo[] => (TERMINALES.has(o.estado) ? [] : o.decisiones.filter((d) => !d.elegida));

const ESTADOS: Record<EstadoObjetivo, [string, string]> = {
  abierto: ['Abierto', 'Open'],
  'esperando-decision': ['Espera tu decisión', 'Needs your decision'],
  'en-curso': ['En curso', 'In progress'],
  'esperando-recurso': ['Espera un recurso', 'Waiting for a resource'],
  incierto: ['Sin confirmar · lo reviso', 'Unconfirmed · checking'],
  completado: ['Completado', 'Completed'],
  cancelado: ['Cancelado', 'Cancelled'],
  fallido: ['No se pudo', 'Failed'],
};

export function etiquetaEstadoObjetivo(o: Pick<VistaObjetivo, 'estado' | 'pausado'>, idioma: 'es' | 'en' = 'es'): string {
  if (o.pausado && !TERMINALES.has(o.estado)) return idioma === 'en' ? 'Paused' : 'En pausa';
  const e = ESTADOS[o.estado] || ESTADOS.incierto;
  return idioma === 'en' ? e[1] : e[0];
}

/** Los criterios de cierre con su marca: ✓ si ya tienen evidencia, «pendiente» si no. */
export function criteriosVista(o: Pick<VistaObjetivo, 'criterioCierre'>, idioma: 'es' | 'en' = 'es'): { id: string; texto: string; cumplido: boolean; marca: string; etiqueta: string }[] {
  return o.criterioCierre.map((c) => {
    const cumplido = c.evidencias.length > 0;
    const marca = cumplido ? '✓' : idioma === 'en' ? 'pending' : 'pendiente';
    return { id: c.id, texto: c.texto, cumplido, marca, etiqueta: `${c.texto}: ${cumplido ? (idioma === 'en' ? 'done' : 'cumplido') : marca}` };
  });
}

/** Los documentos vigentes (la última versión de cada uno), el más nuevo primero. */
export const documentosVigentes = (o: Pick<VistaObjetivo, 'documentos'>): DocumentoObjetivo[] => o.documentos.filter((d) => d.vigente).sort((a, b) => (b.creado || 0) - (a.creado || 0));

/** Qué controles tiene ahora. Cerrar solo si cada criterio puede tener evidencia (hay documentos vigentes, o ya la tiene). */
export function controlesObjetivo(o: Pick<VistaObjetivo, 'estado' | 'pausado' | 'criterioCierre' | 'documentos'>): { pausar: boolean; reanudar: boolean; cancelar: boolean; cerrar: boolean } {
  if (TERMINALES.has(o.estado)) return { pausar: false, reanudar: false, cancelar: false, cerrar: false };
  const conEvidencia = o.criterioCierre.every((c) => c.evidencias.length > 0) || documentosVigentes(o).length > 0;
  return { pausar: !o.pausado, reanudar: o.pausado, cancelar: true, cerrar: o.criterioCierre.length > 0 && conEvidencia };
}

/**
 * Las evidencias para cerrar: la que ya tenga cada criterio o el documento vigente que la persona eligió para él. null si
 * a algún criterio le falta (el servidor tampoco cerraría: cada criterio necesita la suya).
 */
export function evidenciasParaCerrar(o: Pick<VistaObjetivo, 'criterioCierre' | 'documentos'>, elegidos: Record<string, string>): { criterioId: string; tipo: 'documento' | 'tarea' | 'enlace'; ref: string; etiqueta?: string }[] | null {
  const vigentes = new Map(documentosVigentes(o).map((d) => [d.id, d]));
  const out: { criterioId: string; tipo: 'documento' | 'tarea' | 'enlace'; ref: string; etiqueta?: string }[] = [];
  for (const c of o.criterioCierre) {
    const doc = elegidos[c.id] ? vigentes.get(elegidos[c.id]) : undefined;
    if (doc) out.push({ criterioId: c.id, tipo: 'documento', ref: doc.id, etiqueta: `${doc.nombre} (v${doc.version})` });
    else if (c.evidencias.length) for (const e of c.evidencias) out.push({ criterioId: c.id, tipo: e.tipo, ref: e.ref, etiqueta: e.etiqueta });
    else return null;
  }
  return out;
}

/* ------------------------------------------------------------------ qué cambió desde la última vez (por aparato) */

/** La última revisión que vio ESTE aparato de cada objetivo (en el teléfono o en el navegador, nunca en el servidor). */
export type VistosObjetivos = Record<string, { r: number; t: number }>;
export const MAX_VISTOS_OBJETIVOS = 60;

export function ultimaVista(v: VistosObjetivos | null | undefined, id: string): number {
  const x = v?.[id];
  return x && Number.isInteger(x.r) && x.r > 0 ? x.r : 0;
}

/** Anota que se vio `revision`. Solo sube (una lectura vieja no la baja); guarda las más recientes hasta el tope. */
export function anotarVista(v: VistosObjetivos | null | undefined, id: string, revision: number, ahora: number): VistosObjetivos {
  const base: VistosObjetivos = { ...(v || {}) };
  if (!id || !Number.isInteger(revision) || revision < 1) return base;
  const antes = ultimaVista(base, id);
  if (revision <= antes) return base;
  base[id] = { r: revision, t: ahora };
  const vivos = Object.entries(base)
    .filter(([, x]) => x && Number.isFinite(x.t))
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, MAX_VISTOS_OBJETIVOS);
  return Object.fromEntries(vivos);
}

/** ¿Hay algo nuevo para este aparato? (nunca lo vio, o su revisión de ahora es mayor que la vista) */
export const hayNovedad = (o: Pick<VistaObjetivo, 'id' | 'revision'>, v: VistosObjetivos | null | undefined) => o.revision > ultimaVista(v, o.id);

/**
 * «Qué cambió desde la última vez», en UNA línea: el hecho más reciente y cuántos más. Sin nada nuevo, lo dice. Si el
 * cursor ya no alcanza (`resync`), el último hecho del objetivo entero. `desde` 0 (este aparato nunca lo vio): lo último.
 */
export function lineaQueCambio(c: CambiosObjetivo | null | undefined, idioma: 'es' | 'en' = 'es', o?: Pick<VistaObjetivo, 'eventos'>): string {
  if (!c) return '';
  const eventos = c.resync ? (c.objetivo?.eventos || o?.eventos || []).slice(-1) : c.eventos;
  if (!eventos.length) return idioma === 'en' ? 'Nothing new since last time.' : 'Nada nuevo desde la última vez.';
  const ultimo = eventos[eventos.length - 1];
  const mas = c.resync ? 0 : eventos.length - 1;
  const texto = String(ultimo.texto || '').replace(/\s+/g, ' ').trim();
  const corto = texto.length > 110 ? `${texto.slice(0, 109).trimEnd()}…` : texto;
  if (c.desde === 0 && !c.resync) return corto;
  return mas > 0 ? (idioma === 'en' ? `${corto} (+${mas} more)` : `${corto} (y ${mas} más)`) : corto;
}

/** Desde qué revisión pedir los cambios: la última vista en este aparato (0 si nunca lo vio). */
export const desdeParaCambios = (v: VistosObjetivos | null | undefined, o: Pick<VistaObjetivo, 'id'>) => ultimaVista(v, o.id);

/** Lo que se anuncia (región viva) cuando el estado del objetivo cambia entre dos lecturas; null si nada que decir. */
export function anuncioCambioEstado(antes: Pick<VistaObjetivo, 'id' | 'estado' | 'pausado' | 'revision'> | null | undefined, ahora: Pick<VistaObjetivo, 'id' | 'titulo' | 'estado' | 'pausado' | 'revision'> | null | undefined, idioma: 'es' | 'en' = 'es'): string | null {
  if (!antes || !ahora || antes.id !== ahora.id) return null;
  if (antes.estado === ahora.estado && antes.pausado === ahora.pausado) return null;
  return idioma === 'en' ? `${ahora.titulo}: ${etiquetaEstadoObjetivo(ahora, 'en')}` : `${ahora.titulo}: ${etiquetaEstadoObjetivo(ahora, 'es')}`;
}
