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
  /** F01/F05: tareas cuya acción ya estaba aceptada al cancelar, y lo que terminó después (sin reactivar nada). */
  enVueloAlCancelar?: string[];
  hechosTardios?: { tareaId: string; estado: string; t: number }[];
};

/** F01: lo que contesta cancelar (server/objetivos.ts `Cancelacion`). Sin esto (servidor viejo): solo «solicitada». */
export type CancelacionObjetivo = {
  estado: 'pendientes-cancelados' | 'accion-ya-aceptada' | 'resultado-incierto';
  tareas: { id: string; estado: 'cancelada' | 'ya-aceptada' | 'incierta' | 'sin-pendiente'; detalle?: string }[];
  reintentable: boolean;
  puntoSinRetorno: string;
};

/**
 * Los cuatro estados de cancelar que se le dicen a la persona: cancelación solicitada / pendientes cancelados / acción ya
 * aceptada (su resultado llega y se conserva) / resultado incierto (no se pudo dejar escrito: vuelve a intentarlo).
 */
export function lineaCancelacion(c: CancelacionObjetivo | null | undefined, idioma: 'es' | 'en' = 'es'): string {
  const es = {
    solicitada: 'Cancelación solicitada.',
    'pendientes-cancelados': 'Cancelado: lo pendiente no se hará.',
    'accion-ya-aceptada': 'Cancelado, pero una acción ya estaba aceptada: su resultado llegará y quedará anotado.',
    'resultado-incierto': 'Pedí cancelarlo, pero no pude confirmar que todo quedó detenido. Vuelve a tocar «Cancelar» en un momento.',
  };
  const en = {
    solicitada: 'Cancellation requested.',
    'pendientes-cancelados': 'Cancelled: nothing pending will happen.',
    'accion-ya-aceptada': 'Cancelled, but one action was already accepted: its result will arrive and be recorded.',
    'resultado-incierto': 'I asked to cancel it but could not confirm everything stopped. Tap “Cancel” again in a moment.',
  };
  const t = idioma === 'en' ? en : es;
  return t[c?.estado ?? 'solicitada'] || t.solicitada;
}

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
  | { ok: true; objetivo: VistaObjetivo | null; repetida?: boolean; sinCambio?: boolean; cancelacion?: CancelacionObjetivo }
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
  if (r.status >= 200 && r.status < 300)
    return { ok: true, objetivo: (j.objetivo as VistaObjetivo) ?? null, ...(j.repetida ? { repetida: true } : {}), ...(j.sinCambio ? { sinCambio: true } : {}), ...(j.cancelacion && typeof j.cancelacion === 'object' ? { cancelacion: j.cancelacion as CancelacionObjetivo } : {}) };
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
    /** Como `ver`, distinguiendo «ya no existe / no es tuyo» (404: se quita de la vista) de un fallo (se deja como estaba). */
    async leer(id: string): Promise<{ estado: 'ok'; objetivo: VistaObjetivo } | { estado: 'no-existe' } | { estado: 'error' }> {
      try {
        const r = await pedir(`/api/objetivos/${enc(id)}`, { method: 'GET' });
        if (r.status === 200 && r.json?.objetivo?.id === id) return { estado: 'ok', objetivo: r.json.objetivo as VistaObjetivo };
        return r.status === 404 ? { estado: 'no-existe' } : { estado: 'error' };
      } catch {
        return { estado: 'error' };
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

/* ------------------------------------------------------------------ la vista que solo avanza (F05) */

/**
 * Un objetivo que llega (de una acción, del detalle o de una lista) entra solo si es MÁS NUEVO que el que se tiene (por
 * su revisión, que el servidor sube en cada escritura). Una respuesta vieja que llega tarde no hace retroceder la vista.
 * La misma revisión no reemplaza (es lo mismo; así no hay parpadeo).
 */
export function fusionarObjetivo(xs: readonly VistaObjetivo[], o: VistaObjetivo | null | undefined): VistaObjetivo[] {
  if (!o || typeof o.id !== 'string') return [...xs];
  const previo = xs.find((x) => x.id === o.id);
  if (previo && !(Number(o.revision) > Number(previo.revision))) return [...xs];
  return ordenar([o, ...xs.filter((x) => x.id !== o.id)]);
}

/**
 * Una lista entera del servidor, por entidad: de cada objetivo queda el de revisión mayor (la lista vieja no pisa una
 * decisión ya confirmada). Lo que no vino en la lista se quita SOLO si la lista es completa (`completo`): una lista
 * parcial (algún objetivo no se pudo leer) no borra nada.
 */
export function fusionarListaObjetivos(xs: readonly VistaObjetivo[], lista: readonly VistaObjetivo[], o: { completo: boolean }): VistaObjetivo[] {
  const llegan = new Map(lista.filter((x) => x && typeof x.id === 'string').map((x) => [x.id, x] as const));
  const out: VistaObjetivo[] = [];
  for (const x of xs) {
    const n = llegan.get(x.id);
    if (n) {
      out.push(Number(n.revision) > Number(x.revision) ? n : x);
      llegan.delete(x.id);
    } else if (!o.completo) out.push(x);
  }
  for (const n of llegan.values()) out.push(n);
  return ordenar(out);
}

/** Quita un objetivo que el servidor dijo que ya no existe (o no es de esta cuenta): la «lápida» del cliente. */
export const quitarObjetivo = (xs: readonly VistaObjetivo[], id: string): VistaObjetivo[] => xs.filter((x) => x.id !== id);

const ordenar = (xs: VistaObjetivo[]) => xs.sort((a, b) => (b.actualizado || 0) - (a.actualizado || 0));

export type EstadoAlmacenObjetivos = {
  objetivos: VistaObjetivo[];
  cargado: boolean;
  error: string | null;
  vistos: VistosObjetivos;
  /** Lo último que dijo `cambios` por objetivo, con la revisión desde la que se pidió. */
  cambios: Record<string, { desde: number; revision: number; c: CambiosObjetivo }>;
  /** La cuenta de esta sesión y su generación: sube al salir o cambiar de cuenta; lo pedido antes ya no se aplica. */
  cuenta: string | null;
  generacion: number;
};

/**
 * EL ALMACÉN DE LOS OBJETIVOS (sin React): lo usa el teléfono (mobile/src/objetivos/useObjetivos.ts) y se prueba en Node.
 *  · Cada respuesta se aplica solo si es de la MISMA generación de sesión en que se pidió (salir y entrar con otra cuenta
 *    con pedidos en vuelo no deja datos ni efectos de la anterior).
 *  · La lista y las acciones se funden por entidad y revisión (nunca hacia atrás); una lista parcial no borra.
 *  · Un «ya no existe» del detalle quita esa entidad.
 */
export function crearAlmacenObjetivos(
  cliente: Pick<ClienteObjetivos, 'listar' | 'cambios'>,
  o: { leerVistos?: () => Promise<VistosObjetivos | null>; guardarVistos?: (v: VistosObjetivos) => void; ahora?: () => number } = {}
) {
  let estado: EstadoAlmacenObjetivos = { objetivos: [], cargado: false, error: null, vistos: {}, cambios: {}, cuenta: null, generacion: 0 };
  const oyentes = new Set<() => void>();
  const poner = (c: Partial<EstadoAlmacenObjetivos>) => {
    estado = { ...estado, ...c };
    for (const f of oyentes) f();
  };
  const ahora = o.ahora || Date.now;
  let vistosLeidos = false;
  let enVuelo: { generacion: number; p: Promise<void> } | null = null;

  async function leerVistos() {
    if (vistosLeidos || !o.leerVistos) return;
    vistosLeidos = true;
    try {
      const v = await o.leerVistos();
      if (v && typeof v === 'object') poner({ vistos: { ...v, ...estado.vistos } });
    } catch {
      /* sin lo guardado: todo cuenta como nuevo, que es lo honesto */
    }
  }

  const vaciar = (cuenta: string | null) => {
    enVuelo = null;
    poner({ objetivos: [], cargado: false, error: null, cambios: {}, cuenta, generacion: estado.generacion + 1 });
  };

  return {
    foto: () => estado,
    suscribir(f: () => void) {
      oyentes.add(f);
      return () => void oyentes.delete(f);
    },
    generacion: () => estado.generacion,
    /** La sesión es de `cuenta` (null: sin sesión). Otra cuenta, o salir: se olvida todo y sube la generación. */
    sesion(cuenta: string | null) {
      const c = cuenta ? String(cuenta).trim().toLowerCase() : null;
      if (c === estado.cuenta) return;
      vaciar(c);
    },
    /** Al salir de la sesión: nada de la persona anterior se queda a la vista (y lo que esté en vuelo ya no aplica). */
    olvidar() {
      vaciar(null);
    },
    /** Lo que contestó el servidor (acción, detalle o el objetivo de ahora de un 409), si es de esta generación y más nuevo. */
    aplicar(x: VistaObjetivo | null | undefined, generacion = estado.generacion) {
      if (generacion !== estado.generacion || !x) return;
      const objetivos = fusionarObjetivo(estado.objetivos, x);
      if (objetivos.length !== estado.objetivos.length || objetivos.some((y, i) => y !== estado.objetivos[i])) poner({ objetivos });
    },
    /** El servidor dijo que ya no existe (o no es de esta cuenta). */
    quitar(id: string, generacion = estado.generacion) {
      if (generacion !== estado.generacion || !estado.objetivos.some((x) => x.id === id)) return;
      poner({ objetivos: quitarObjetivo(estado.objetivos, id) });
    },
    marcarVisto(x: Pick<VistaObjetivo, 'id' | 'revision'>) {
      const v = anotarVista(estado.vistos, x.id, x.revision, ahora());
      if (JSON.stringify(v) === JSON.stringify(estado.vistos)) return;
      poner({ vistos: v });
      o.guardarVistos?.(v);
    },
    /** Pregunta la lista (una a la vez por generación) y los cambios del más reciente. */
    refrescar(): Promise<void> {
      if (enVuelo && enVuelo.generacion === estado.generacion) return enVuelo.p;
      const gen = estado.generacion;
      const p: Promise<void> = (async () => {
        await leerVistos();
        const r = await cliente.listar();
        if (gen !== estado.generacion) return; // de otra sesión: se descarta
        if (r.ok === false) {
          if (r.sinSesion) poner({ objetivos: [], cargado: true, error: null, cambios: {} });
          else poner({ error: r.mensaje });
          return;
        }
        poner({ objetivos: fusionarListaObjetivos(estado.objetivos, r.objetivos, { completo: r.completo }), cargado: true, error: null });
        const rec = objetivoReciente(estado.objetivos);
        if (!rec) return;
        const desde = desdeParaCambios(estado.vistos, rec);
        const ya = estado.cambios[rec.id];
        if (ya && ya.desde === desde && ya.revision === rec.revision) return;
        const c = await cliente.cambios(rec.id, desde);
        if (gen !== estado.generacion || !c) return;
        poner({ cambios: { ...estado.cambios, [rec.id]: { desde, revision: rec.revision, c } } });
      })().finally(() => {
        if (enVuelo?.p === p) enVuelo = null;
      });
      enVuelo = { generacion: gen, p };
      return p;
    },
  };
}

export type AlmacenObjetivos = ReturnType<typeof crearAlmacenObjetivos>;

/**
 * F04: ¿el aviso «decision» que se tocó sigue valiendo? Solo si el objetivo de ahora (pedido al abrir) tiene esa decisión
 * sin elegir y en esa revisión. Si no, se abre el objetivo y se dice «cambió mientras tanto» (no se aplica el botón).
 * Para quien maneja los avisos en el teléfono (otro equipo): el servidor ya lo verifica al mandar; esto es al abrir.
 */
export function avisoDecisionVigente(aviso: { objetivoId?: string; decisionId?: string; revision?: number | string; tareaId?: string }, actual: VistaObjetivo | null | undefined): boolean {
  if (!actual || actual.id !== aviso.objetivoId || esTerminalObjetivo(actual)) return false;
  if (aviso.tareaId) return actual.tareas.includes(String(aviso.tareaId));
  const d = actual.decisiones.find((x) => x.id === aviso.decisionId);
  return !!d && !d.elegida && Number(d.version) === Number(aviso.revision);
}
