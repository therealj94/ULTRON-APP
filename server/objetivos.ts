/**
 * LOS OBJETIVOS CON ESTADO EN EL SERVIDOR (Fase 2; la entidad vive en lib/objetivos.ts).
 *
 *   GET  /api/objetivos                                   → { objetivos: VistaObjetivo[], completo, noLeidos }
 *   GET  /api/objetivos/:id                               → { objetivo }   (reconciliado con sus tareas)
 *   GET  /api/objetivos/:id/cambios?desde=<revision>      → { revision, desde, resync, eventos[], campos{}, objetivo? }
 *   POST /api/objetivos {requestId, titulo, criterioCierre[], meta?, proyecto?, plataforma?, restricciones?, permisos?,
 *                        topeCosto?, siguientePaso?}       → 201 { objetivo, creado: true } | 200 { objetivo, creado: false }
 *   POST /api/objetivos/:id/decisiones {decisionId, opcion, revisionVista, aparato?}
 *                                                          → { objetivo, repetida? } | 409 { codigo, revision, objetivo }
 *   POST /api/objetivos/:id/pausar | /reanudar | /cancelar {revisionVista?}   → { objetivo, sinCambio? }
 *   POST /api/objetivos/:id/cerrar {revisionVista?, evidencias: [{criterioId, tipo, ref, etiqueta?}]}
 *                                                          → { objetivo } | 409 { codigo: 'sin-evidencia' }
 *   POST /api/objetivos/:id/documentos {archivoId, revisionVista?}            → { objetivo, documento }
 *   POST /api/objetivos/:id/tareas {requestId, titulo, objetivo?}             → { objetivo, tarea }  (una tarea `queued`)
 *   GET  /api/compromisos                                  → { compromisos[] }  (el libro de compromisos, solo registro)
 *
 * La persona sale SIEMPRE de la sesión firmada (deps.sesionDe); un correo en el cuerpo o en la consulta no cambia de
 * quién son. Lo que no es suyo es 404, igual que lo que no existe. Solo AU-RA (server.ts monta las rutas con
 * `exigirPlataforma('ultron')` además de la sesión de siempre). Un conflicto de revisión es 409 con la revisión y el
 * objetivo de ahora: el aparato que llegó tarde se pone al día sin otra lectura.
 */
import type express from 'express';
import { aparatoValido } from '../lib/acciones-app';
import { listarCompromisos, vistaCompromiso } from '../lib/compromisos';
import { almacenDurable, huellaDueno, leerDurable, type AlmacenDurable } from '../lib/durable';
import {
  cambiarObjetivo,
  cambiosDesde,
  crearObjetivo,
  decidirObjetivo,
  ErrorObjetivo,
  esTerminalObjetivo,
  leerObjetivo,
  listarObjetivos,
  pedirDecision,
  reconciliarObjetivo,
  textoObjetivo,
  vistaObjetivo,
  type CambioObjetivo,
  type Objetivo,
  type TareaParaObjetivo,
} from '../lib/objetivos';
import { claveManifiesto, type ManifiestoArchivo } from '../lib/oficina/almacen';
import { pedirDecisionPorPush, type PushDecision } from '../lib/push';
import { cambiarTarea, crearTarea, esTerminal, leerTarea, vistaTarea, type EstadoTarea, type RegistroTarea } from '../lib/tareas-durables';

export type DepsObjetivos = {
  /** Las puertas de siempre: la sesión de la mesa y `exigirPlataforma('ultron')` (Dr Electrum no entra). */
  exigir: express.RequestHandler[];
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo?: string } | null;
  reloj?: () => number;
  /** Pone al día una tarea con sus fuentes (server/trabajos.ts `revisarTarea`). Sin esto, se usa como está. */
  revisarTarea?: (dueno: string, reg: RegistroTarea) => Promise<RegistroTarea>;
  /** El aviso «necesito tu decisión» (lib/push.ts `pedirDecisionPorPush`, que lo manda una vez por decisión + revisión). */
  avisarDecision?: (correo: string, p: PushDecision) => Promise<unknown>;
  almacen?: AlmacenDurable;
};

const conCorreo = (c: string) => {
  const s = String(c || '').trim().toLowerCase();
  return s.includes('@') || /^veta:0x[0-9a-f]{40}$/.test(s) ? s : '';
};

/* ------------------------------------------------------------------ reconciliar y avisar */

/** Las opciones de la decisión de una tarea, para los botones del aviso: sin «Editar» (pide texto), lo de riesgo primero. */
function opcionesDeTarea(reg: RegistroTarea): { id: string; etiqueta: string }[] {
  const ops = (reg.decision?.opciones || []).filter((o) => o.id !== 'editar');
  const orden = (id: string) => (id === 'aprobar' || id.startsWith('elegir:') ? 0 : id === 'rechazar' ? 1 : 2);
  return [...ops].sort((x, y) => orden(x.id) - orden(y.id)).slice(0, 3).map((o) => ({ id: o.id, etiqueta: o.etiqueta }));
}

/**
 * «Necesito tu decisión» por cada decisión pendiente del objetivo y por cada tarea suya que espera aprobación. El envío
 * se deduplica por decisión + revisión (lib/push.ts): llamarlo dos veces no avisa dos veces. Nunca lanza.
 */
export async function avisarDecisionesPendientes(correo: string, obj: Objetivo, tareas: (RegistroTarea | null)[], avisar?: DepsObjetivos['avisarDecision']): Promise<number> {
  if (!avisar || obj.estado !== 'esperando-decision' || esTerminalObjetivo(obj.estado)) return 0;
  const pedidos: PushDecision[] = [];
  for (const d of obj.decisiones) if (!d.elegida) pedidos.push({ objetivoId: obj.id, decisionId: d.id, revision: d.version, pregunta: d.pregunta, opciones: d.opciones.map((o) => ({ id: o.id, etiqueta: o.etiqueta })) });
  for (const t of tareas) {
    if (!t || esTerminal(t.estado) || t.estado !== 'awaiting_approval' || !t.decision) continue;
    pedidos.push({ objetivoId: obj.id, tareaId: t.id, decisionId: t.decision.id, revision: t.version, pregunta: t.decision.pregunta, opciones: opcionesDeTarea(t) });
  }
  for (const p of pedidos) await Promise.resolve(avisar(correo, p)).catch(() => undefined);
  return pedidos.length;
}

/**
 * Pone el objetivo al día con sus tareas (lib/objetivos.ts `reconciliarObjetivo`) y guarda solo si cambió. Si con eso
 * entra a `esperando-decision`, avisa (una vez por decisión + revisión). Nunca lanza: si no se pudo, devuelve el que había.
 */
export async function reconciliarObjetivoConTareas(
  dueno: string,
  obj: Objetivo,
  o: { revisarTarea?: DepsObjetivos['revisarTarea']; avisarDecision?: DepsObjetivos['avisarDecision']; almacen?: AlmacenDurable; ahora?: number } = {}
): Promise<Objetivo> {
  if (esTerminalObjetivo(obj.estado)) return obj;
  const a = o.almacen || almacenDurable();
  const leidas: (RegistroTarea | null)[] = await Promise.all(
    obj.tareas.map(async (id) => {
      const l = await leerTarea(dueno, id, a).catch(() => ({ ok: false as const }));
      if (l.ok === false) return null;
      if (!l.tarea) return { id, estado: 'cancelled' as EstadoTarea } as RegistroTarea; // ya no existe: no trabaja ni espera
      return !esTerminal(l.tarea.estado) && o.revisarTarea ? await o.revisarTarea(dueno, l.tarea).catch(() => l.tarea!) : l.tarea;
    })
  );
  const min: TareaParaObjetivo[] = leidas.map((t) => (t ? { id: t.id, estado: t.estado, decision: t.decision ? { id: t.decision.id } : null } : null));
  const c = reconciliarObjetivo(obj, min);
  if (!c) return obj;
  const r = await cambiarObjetivo(dueno, obj.id, (x) => reconciliarObjetivo(x, min), { almacen: a, ahora: o.ahora }).catch(() => null);
  if (!r || r.ok === false) return obj;
  if (r.cambiado && r.objetivo.estado === 'esperando-decision') await avisarDecisionesPendientes(dueno, r.objetivo, leidas, o.avisarDecision);
  return r.objetivo;
}

/* ------------------------------------------------------------------ rutas */

const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
const noEsta = (res: express.Response) => res.status(404).json({ error: 'No encuentro ese objetivo.', honesto: true });
const almacenCaido = (res: express.Response) => res.status(503).json({ error: 'No pude leer tus objetivos en este momento. Prueba otra vez en un rato.', code: 'almacen_no_disponible', honesto: true });

/** El código HTTP de cada error tipado. */
function estadoHttp(e: ErrorObjetivo): number {
  if (e.codigo === 'no-existe') return 404;
  if (e.codigo === 'almacen') return 503;
  if (e.codigo === 'invalido' || e.codigo === 'opcion' || e.codigo === 'plataforma' || e.codigo === 'permiso') return 400;
  return 409;
}

function responderError(res: express.Response, e: ErrorObjetivo) {
  if (e.codigo === 'no-existe') return noEsta(res);
  if (e.codigo === 'almacen') return almacenCaido(res);
  return res.status(estadoHttp(e)).json({
    error: e.message,
    codigo: e.codigo,
    ...(e.objetivo ? { revision: e.objetivo.revision, objetivo: vistaObjetivo(e.objetivo) } : {}),
    honesto: true,
  });
}

/** `revisionVista` opcional: un número entero ≥ 1, o nada. NaN → inválida. */
function revisionDe(v: unknown): number | undefined | null {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function montarRutasObjetivos(app: express.Express, d: DepsObjetivos) {
  const ahora = () => (d.reloj ? d.reloj() : Date.now());
  const alm = () => d.almacen || almacenDurable();
  const correoDe = (req: express.Request) => conCorreo(String(d.sesionDe(req)?.correo || ''));
  const sinDueno = (req: express.Request, res: express.Response) =>
    d.sesionDe(req) ? res.status(403).json({ error: 'Tus objetivos van con tu cuenta.', code: 'sin_correo', honesto: true }) : sinSesion(res);
  const reconciliado = (dueno: string, obj: Objetivo) => reconciliarObjetivoConTareas(dueno, obj, { revisarTarea: d.revisarTarea, avisarDecision: d.avisarDecision, almacen: alm(), ahora: ahora() });

  async function buscar(dueno: string, id: string): Promise<{ tipo: 'ok'; obj: Objetivo } | { tipo: 'no' } | { tipo: 'almacen' }> {
    const l = await leerObjetivo(dueno, id, alm()).catch(() => ({ ok: false as const, detalle: '' }));
    if (l.ok === false) return { tipo: 'almacen' };
    return l.objetivo ? { tipo: 'ok', obj: l.objetivo } : { tipo: 'no' };
  }

  app.get('/api/objetivos', ...d.exigir, d.limitar(90), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const l = await listarObjetivos(dueno, alm()).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (l.ok === false) return almacenCaido(res);
    if (!l.objetivos.length && l.noLeidos.length) return almacenCaido(res);
    return res.json({ objetivos: l.objetivos.map(vistaObjetivo), completo: l.noLeidos.length === 0, noLeidos: l.noLeidos.length, honesto: true });
  });

  app.get('/api/objetivos/:id', ...d.exigir, d.limitar(120), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    if (e.tipo === 'no') return noEsta(res);
    return res.json({ objetivo: vistaObjetivo(await reconciliado(dueno, e.obj)), honesto: true });
  });

  /** «Qué cambió desde que te fuiste»: solo lo nuevo después de `desde` (la revisión que el aparato vio por última vez). */
  app.get('/api/objetivos/:id/cambios', ...d.exigir, d.limitar(120), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    if (e.tipo === 'no') return noEsta(res);
    const obj = await reconciliado(dueno, e.obj);
    return res.json({ ...cambiosDesde(obj, Number(req.query.desde) || 0), honesto: true });
  });

  app.post('/api/objetivos', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const r = await crearObjetivo(
      dueno,
      {
        requestId: String(b.requestId || ''),
        titulo: String(b.titulo ?? ''),
        meta: b.meta === undefined ? undefined : String(b.meta),
        proyecto: b.proyecto === undefined ? undefined : String(b.proyecto),
        plataforma: b.plataforma === undefined ? undefined : String(b.plataforma),
        criterioCierre: Array.isArray(b.criterioCierre) ? (b.criterioCierre as never[]) : [],
        restricciones: Array.isArray(b.restricciones) ? (b.restricciones as unknown[]).map(String) : undefined,
        permisos: b.permisos === undefined ? undefined : Array.isArray(b.permisos) ? (b.permisos as unknown[]).map(String) : (b.permisos as never),
        topeCosto: b.topeCosto === undefined ? undefined : (b.topeCosto as number | null),
        siguientePaso: b.siguientePaso === undefined ? undefined : String(b.siguientePaso),
      },
      { almacen: alm(), ahora: ahora() }
    ).catch((e) => ({ ok: false as const, error: new ErrorObjetivo('almacen', String(e?.message || e)) }));
    if (r.ok === false) return responderError(res, r.error);
    return res.status(r.creado ? 201 : 200).json({ objetivo: vistaObjetivo(r.objetivo), creado: r.creado, honesto: true });
  });

  /* ---------------------------------------------------------------- decidir */

  app.post('/api/objetivos/:id/decisiones', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const revisionVista = revisionDe(b.revisionVista);
    const decisionId = String(b.decisionId || '');
    const opcion = String(b.opcion || '');
    if (!decisionId || !opcion || !revisionVista) return res.status(400).json({ error: 'Faltan decisionId, opcion o revisionVista.', honesto: true });
    const aparato = aparatoValido(b.aparato) || aparatoValido(req.headers['x-aura-aparato']) || undefined;
    const r = await decidirObjetivo(dueno, String(req.params.id || ''), { decisionId, opcion, revisionVista, aparato, por: 'persona' }, { almacen: alm(), ahora: ahora() });
    if (r.ok === false) return responderError(res, r.error);
    return res.json({ objetivo: vistaObjetivo(r.objetivo), ...(r.repetida ? { repetida: true } : {}), honesto: true });
  });

  /* ---------------------------------------------------------------- pausar, reanudar, cancelar */

  for (const control of ['pausar', 'reanudar', 'cancelar'] as const) {
    app.post(`/api/objetivos/:id/${control}`, ...d.exigir, d.limitar(30), async (req, res) => {
      const dueno = correoDe(req);
      if (!dueno) return sinDueno(req, res);
      const revisionEsperada = revisionDe((req.body || {}).revisionVista);
      if (revisionEsperada === null) return res.status(400).json({ error: 'revisionVista no vale.', honesto: true });
      const e = await buscar(dueno, String(req.params.id || ''));
      if (e.tipo === 'almacen') return almacenCaido(res);
      if (e.tipo === 'no') return noEsta(res);
      const obj = e.obj;
      // Idempotente: lo que ya está así (o ya terminó, para pausar/reanudar) vuelve tal cual.
      const ya = (control === 'pausar' && obj.pausado) || (control === 'reanudar' && !obj.pausado) || (control === 'cancelar' && obj.estado === 'cancelado') || (control !== 'cancelar' && esTerminalObjetivo(obj.estado));
      if (ya) return res.json({ objetivo: vistaObjetivo(obj), sinCambio: true, honesto: true });
      const cambio: CambioObjetivo =
        control === 'pausar'
          ? { pausado: true, evento: 'Pausaste el objetivo: no arranco nada nuevo hasta que lo reanudes' }
          : control === 'reanudar'
            ? { pausado: false, evento: 'Lo reanudaste' }
            : { estado: 'cancelado', evento: 'Cancelaste el objetivo: no hago nada más; lo que ya se hizo queda anotado' };
      const r = await cambiarObjetivo(dueno, obj.id, () => cambio, { almacen: alm(), ahora: ahora(), revisionEsperada });
      if (r.ok === false) return responderError(res, r.error);
      // Cancelar impide lo que todavía no empezó (tareas en cola, propuestas esperando); lo que está a medio efecto se
      // reconcilia por su cuenta (no se finge que se paró).
      if (control === 'cancelar' && r.cambiado) {
        const quietas: ReadonlySet<EstadoTarea> = new Set<EstadoTarea>(['created', 'planning', 'queued', 'waiting_resource', 'awaiting_approval', 'blocked', 'paused']);
        for (const id of obj.tareas) {
          await cambiarTarea(
            dueno,
            id,
            (t) =>
              esTerminal(t.estado) || !quietas.has(t.estado)
                ? null
                : { estado: 'cancelled', pasoActual: null, decision: null, resultado: { id: `${t.id}:resultado`, resumen: 'Cancelada con su objetivo antes de hacer nada con efecto.', evidencias: [], parcial: [], pendiente: [], t: ahora() } },
            { almacen: alm(), ahora: ahora() }
          ).catch(() => null);
        }
      }
      return res.json({ objetivo: vistaObjetivo(r.objetivo), ...(r.cambiado ? {} : { sinCambio: true }), honesto: true });
    });
  }

  /* ---------------------------------------------------------------- cerrar (con evidencia) */

  app.post('/api/objetivos/:id/cerrar', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const revisionEsperada = revisionDe(b.revisionVista);
    if (revisionEsperada === null) return res.status(400).json({ error: 'revisionVista no vale.', honesto: true });
    const lista = Array.isArray(b.evidencias) ? (b.evidencias as Record<string, unknown>[]).slice(0, 24) : [];
    const evidencias = lista
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({ criterioId: String(x.criterioId || ''), tipo: String(x.tipo || '') as 'documento' | 'tarea' | 'enlace', ref: String(x.ref || '').slice(0, 500), etiqueta: x.etiqueta === undefined ? undefined : String(x.etiqueta) }))
      .filter((x) => x.tipo === 'documento' || x.tipo === 'tarea' || x.tipo === 'enlace');
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    if (e.tipo === 'no') return noEsta(res);
    // Una tarea es evidencia solo si es de este objetivo y TERMINÓ comprobada (`completed`): «respondida» o «partial» no.
    for (const ev of evidencias.filter((x) => x.tipo === 'tarea')) {
      const t = e.obj.tareas.includes(ev.ref) ? await leerTarea(dueno, ev.ref, alm()).catch(() => null) : null;
      if (!t || t.ok === false || !t.tarea || t.tarea.estado !== 'completed') {
        return res.status(409).json({ error: `La tarea que das como evidencia no terminó comprobada: no puedo cerrar «${textoObjetivo(e.obj.titulo, 80)}» con ella.`, codigo: 'sin-evidencia', revision: e.obj.revision, objetivo: vistaObjetivo(e.obj), honesto: true });
      }
    }
    const r = await cambiarObjetivo(dueno, e.obj.id, () => ({ evidencias, estado: 'completado', evento: 'Lo cerraste: cada criterio tiene su evidencia' }), { almacen: alm(), ahora: ahora(), revisionEsperada });
    if (r.ok === false) return responderError(res, r.error);
    return res.json({ objetivo: vistaObjetivo(r.objetivo), honesto: true });
  });

  /* ---------------------------------------------------------------- documentos (versiones) */

  app.post('/api/objetivos/:id/documentos', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const revisionEsperada = revisionDe(b.revisionVista);
    if (revisionEsperada === null) return res.status(400).json({ error: 'revisionVista no vale.', honesto: true });
    const archivoId = String(b.archivoId || '');
    if (!/^d_[0-9a-f]{24}$/.test(archivoId)) return res.status(400).json({ error: 'Falta el archivoId del documento (el de la oficina).', honesto: true });
    // La ficha del documento, del DUEÑO de la sesión (lib/oficina/almacen.ts): el nombre y la huella salen de ahí, nunca del
    // cuerpo. Un documento de otra cuenta, para esta, no existe.
    const l = await leerDurable<ManifiestoArchivo>(claveManifiesto(dueno, archivoId), alm()).catch(() => ({ ok: false as const, detalle: '' }));
    if (l.ok === false) return almacenCaido(res);
    const m = l.valor;
    if (!m || m.dueno !== huellaDueno(dueno) || m.id !== archivoId) return res.status(404).json({ error: 'No encuentro ese documento entre los tuyos.', honesto: true });
    if (ahora() > m.vence) return res.status(410).json({ error: 'Ese documento ya venció (la oficina guarda los archivos unos días). Pídeme una versión nueva.', codigo: 'vencido', honesto: true });
    let version = 1;
    const r = await cambiarObjetivo(
      dueno,
      String(req.params.id || ''),
      (obj) => {
        const previo = obj.documentos.find((x) => x.vigente && x.nombre.toLowerCase() === textoObjetivo(m.nombre, 160).toLowerCase());
        version = obj.documentos.find((x) => x.id === archivoId)?.version ?? (previo ? (previo.sha256 === m.sha256 ? previo.version : previo.version + 1) : 1);
        return { documento: { id: m.id, nombre: m.nombre, sha256: m.sha256, creado: m.creado }, evento: version > 1 ? `Preparé la versión ${version} de «${textoObjetivo(m.nombre, 80)}»` : `Agregué «${textoObjetivo(m.nombre, 80)}»` };
      },
      { almacen: alm(), ahora: ahora(), revisionEsperada }
    );
    if (r.ok === false) return responderError(res, r.error);
    const documento = r.objetivo.documentos.find((x) => x.id === archivoId) || r.objetivo.documentos.find((x) => x.vigente && x.sha256 === m.sha256) || null;
    return res.json({ objetivo: vistaObjetivo(r.objetivo), documento, ...(r.cambiado ? {} : { sinCambio: true }), honesto: true });
  });

  /* ---------------------------------------------------------------- tareas del objetivo */

  /** Una tarea nueva que es DE este objetivo (queda `queued`: el planificador la arranca). Una vez por requestId. */
  app.post('/api/objetivos/:id/tareas', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const requestId = String(b.requestId || '');
    const titulo = textoObjetivo(b.titulo, 100);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) return res.status(400).json({ error: 'Falta el requestId (8 a 64 letras, números, - o _).', honesto: true });
    if (titulo.length < 3) return res.status(400).json({ error: 'La tarea necesita un título.', honesto: true });
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    if (e.tipo === 'no') return noEsta(res);
    if (esTerminalObjetivo(e.obj.estado)) return responderError(res, new ErrorObjetivo('terminal', 'El objetivo ya terminó: no le agrego tareas.', e.obj));
    const t = await crearTarea(
      dueno,
      { requestId: `obj-${e.obj.id}-${requestId}`, titulo, objetivo: textoObjetivo(b.objetivo, 400) || titulo, estado: 'queued', entorno: { kind: 'chat', id: 'api', displayName: 'AURA' }, origen: { kind: 'api' }, objetivoId: e.obj.id },
      { almacen: alm(), ahora: ahora() }
    ).catch(() => null);
    if (!t || t.ok === false) return almacenCaido(res);
    const r = await cambiarObjetivo(dueno, e.obj.id, (obj) => (obj.tareas.includes(t.tarea.id) ? null : { tarea: t.tarea.id, estado: obj.estado === 'abierto' ? 'en-curso' : undefined, evento: `Sumé la tarea «${textoObjetivo(t.tarea.titulo, 80)}»` }), { almacen: alm(), ahora: ahora() });
    if (r.ok === false) return responderError(res, r.error);
    return res.status(t.creada ? 201 : 200).json({ objetivo: vistaObjetivo(r.objetivo), tarea: vistaTarea(t.tarea, ahora()), honesto: true });
  });

  /* ---------------------------------------------------------------- el libro de compromisos */

  app.get('/api/compromisos', ...d.exigir, d.limitar(60), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const l = await listarCompromisos(dueno, alm()).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (l.ok === false) return almacenCaido(res);
    return res.json({ compromisos: l.compromisos.map(vistaCompromiso), completo: l.noLeidos === 0, honesto: true });
  });
}

/* ------------------------------------------------------------------ ganchos para AURA */

/**
 * AURA necesita una decisión de la persona sobre un objetivo (≤3 opciones, cada una con su consecuencia): queda en el
 * objetivo (`esperando-decision`) y sale el aviso «necesito tu decisión» con un botón por opción (una vez por decisión +
 * revisión).
 */
export async function pedirDecisionObjetivo(
  correo: string,
  objetivoId: string,
  d: { pregunta: string; opciones: { id?: string; etiqueta: string; consecuencia: string }[] },
  o: { avisarDecision?: DepsObjetivos['avisarDecision']; almacen?: AlmacenDurable; ahora?: number; revisionEsperada?: number } = {}
): Promise<{ ok: true; objetivo: Objetivo; decisionId: string } | { ok: false; error: ErrorObjetivo }> {
  const dueno = conCorreo(correo);
  if (!dueno) return { ok: false, error: new ErrorObjetivo('invalido', 'Sin cuenta no hay objetivos.') };
  const r = await pedirDecision(dueno, objetivoId, d, { almacen: o.almacen, ahora: o.ahora, revisionEsperada: o.revisionEsperada });
  if (r.ok === false) return r;
  const nueva = [...r.objetivo.decisiones].reverse().find((x) => !x.elegida)!;
  await avisarDecisionesPendientes(dueno, r.objetivo, [], o.avisarDecision ?? ((c, p) => pedirDecisionPorPush(c, p, { almacen: o.almacen })));
  return { ok: true, objetivo: r.objetivo, decisionId: nueva.id };
}
