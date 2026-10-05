/**
 * LA INICIATIVA Y LAS MISIONES EN EL SERVIDOR: rutas para la app y el reloj que propone solo.
 *
 * Lo que piensa vive en lib/iniciativa.ts y lib/misiones.ts. Aquí se junta lo de la persona (su perfil,
 * sus misiones, su hilo) y se sirve:
 *
 *   GET  /api/iniciativa                      → { propuesta | null, motivo, iniciativa }
 *   POST /api/iniciativa/responder {id, respuesta: 'si'|'no'|'luego'} → { ok, pedido }
 *   GET  /api/misiones[?todas=1]              → { misiones }
 *   POST /api/misiones {accion: 'crear'|'avanzar'|'cerrar'|'pausar'|'reanudar', …} → { mision }
 *   GET  /api/avisos/preferencias             → { preferencias }   (zona, quietas, canales, presupuesto, clases…)
 *   POST /api/avisos/preferencias {…cambios}  → { preferencias, cancelados, retiradas }
 *   POST /api/avisos/posponer {fecha, hora?} | {hasta} | {quitar: true} → { pospuestoHasta }
 *
 * La persona sale SIEMPRE de la sesión firmada (deps.sesionDe), nunca de la consulta ni del cuerpo: no
 * hay forma de pedir las propuestas, las misiones ni las preferencias de otro.
 *
 * `arrancarIniciativa` es el reloj (cada ~30 min): para quien usó la app hace poco, fuera de SUS horas
 * quietas (en su zona), piensa lo que toca y, si es nueva, la encola en su outbox de avisos (lib/avisos.ts):
 * se revalida contra las fuentes justo antes de avisar, respeta su canal y su presupuesto y se entrega UNA
 * vez (sello) por los `entregadores` que pone server.ts (canal de acciones del teléfono, push). No arranca
 * solo al importar.
 */
import type express from 'express';
import { hiloDe } from '../lib/memoria';
import { hiloMiembro } from '../lib/memoria-miembro';
import { miembrosUltron, quienEs } from '../lib/junta';
import { iniciativaDe, leerPerfil, reservasDe, type PerfilDeUso } from '../lib/perfil-persona';
import { vistaDePersona, vistaDeTerminos, type VistaTexto } from '../lib/conocer-persona';
import {
  enHorasQuietas,
  evidenciaDe,
  leerEstadoIniciativa,
  lineaPorConocer,
  observacionDe,
  responderPropuesta,
  revalidarPendiente,
  siguienteOrdenObservacion,
  siguientePropuesta,
  type ContextoIniciativa,
  type FuenteContada,
  type ModeloCorto,
  type Observacion,
  type Observaciones,
  type PersonaIniciativa,
  type Propuesta,
  type RespuestaPropuesta,
  type ResultadoSiguiente,
  type Revalidacion,
} from '../lib/iniciativa';
import { AlmacenNoDisponible, avanzarMision, bloqueMisiones, cerrarMision, correrMision, correrMisionConEstado, crearMision, leerMisiones, listarMisiones, validarNuevaMision, type EstadoMision, type Mision } from '../lib/misiones';
import {
  apagadaPara,
  cambiarPreferencias,
  cancelarAvisos,
  CANALES_RESUMEN,
  claseDe,
  CLASES_AVISO,
  encolarAviso,
  hastaDeLuego,
  leerAvisos,
  preferenciasDe,
  prefsPorOmision,
  procesarOutbox,
  registrarVista,
  temaDe,
  validarCambiosAvisos,
  type Entregador,
  type CanalAviso,
  type PreferenciasAvisos,
  type SelloEntrega,
} from '../lib/avisos';
import { fechaValida, instanteDeLocal } from '../lib/zona-horaria';

/**
 * Lo que se vio de sus canales. `observaciones` (server/fuentes-iniciativa.ts, el adaptador productivo) dice el
 * ESTADO de cada fuente: vigente con su número, empty, unavailable, disconnected o not_configured. La forma vieja
 * (null = conectada pero no se pudo leer; `desconectadas` = las que dejaron de responder) se sigue entendiendo.
 */
export type Contadores = { observaciones?: Observaciones; correoSinLeer?: number | null; whatsappSinLeer?: number | null; desconectadas?: string[] };
/** El adaptador de contadores: el MISMO para las rutas y para el reloj (componerIniciativa). Solo de SU dueño. */
export type FuenteContadores = (correo: string) => Promise<Contadores> | Contadores;

export type DepsIniciativa = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo: string; nombre?: string } | null;
  /** Para empujar una propuesta nueva al teléfono (o a Telegram). El GET no lo usa: ya la devuelve. */
  alProponer?: (correo: string, propuesta: Propuesta) => unknown;
  contadores?: FuenteContadores;
  /** Junta o miembro (server/nivel.ts nivelDeCorreo). Solo da tono a las propuestas. */
  nivelDe?: (correo: string) => 'junta' | 'miembro';
  /** Pruebas: otro modelo (o null, sin modelo). */
  modelo?: ModeloCorto | null;
  /** Pruebas: otro reloj. */
  reloj?: () => number;
};

/* ------------------------------------------------------------------ de quién es */

/** El correo de la persona como lo usan el perfil, la computadora y el turno (correoApp): minúsculas. */
export function correoDeSesion(s: { correo?: string } | null | undefined): string {
  const c = String(s?.correo || '').trim().toLowerCase();
  return c.includes('@') ? c : '';
}

/**
 * El dueño de las misiones en un turno (server.ts `dueno`: el correo de la app, o el id de la junta
 * en Telegram). Un id del padrón se lleva a su correo; sin correo, nadie.
 */
export function duenoMisiones(dueno: string): string {
  const d = String(dueno || '').trim().toLowerCase();
  if (d.includes('@')) return d;
  const m = d ? miembrosUltron()[d] : undefined;
  return m?.correo ? m.correo.toLowerCase() : '';
}

/** El runner del harness para el turno: `mision: (arg) => correrMisionTurno(dueno, arg)`. */
export function correrMisionTurno(dueno: string, arg: string): Promise<string> {
  return correrMision(duenoMisiones(dueno), arg);
}

/** Lo mismo con su estado y su recibo (AUR07): `mision: (arg) => correrMisionTurnoConEstado(dueno, arg)`. */
export async function correrMisionTurnoConEstado(dueno: string, arg: string, vista?: VistaTexto) {
  // Lo que limitó es de quien habla (`dueno`, la vista del turno), aunque sus misiones se guarden por su correo.
  return correrMisionConEstado(duenoMisiones(dueno), arg, Date.now(), vista ?? (dueno ? await vistaDePersona(dueno) : undefined));
}

/**
 * Lo del turno para la iniciativa en la conversación: sus misiones abiertas y lo que aún no sabe de su
 * vida. Va en HECHOS (o en el bloque de la app), nunca en el system: cambia. Nunca lanza.
 *
 * Sus misiones pasan por la vista autorizada (lo que marcó «No usarlo» se tapa): la del turno
 * (server/contexto-turno.ts vistaAutorizada) o, sin ella, la que sale del estado durable (reservasDe). Sin
 * saber qué limitó, sus misiones no entran: se dice que no están a mano, no que no tiene.
 */
export async function bloqueIniciativaTurno(dueno: string, perfil?: PerfilDeUso | null, vista?: VistaTexto): Promise<string> {
  const correo = duenoMisiones(dueno);
  if (!correo) return '';
  const p = perfil === undefined ? await leerPerfil(correo).catch(() => null) : perfil;
  const v = vista ?? vistaDeTerminos(await reservasDe(correo).catch(() => null));
  const misiones = await bloqueMisiones(correo);
  const deMisiones = !misiones ? '' : v.sabe ? v.texto(misiones) : 'MISIONES DE LA PERSONA: no las tengo a mano en este turno. No digas que no tiene ni inventes cuáles son.';
  return [deMisiones, lineaPorConocer(p)].filter(Boolean).join('\n');
}

/** Sus últimos turnos: los de la junta en lib/memoria.ts, los de un miembro en lib/memoria-miembro.ts. */
function hiloPara(correo: string): { rol: string; texto: string }[] {
  try {
    const quien = quienEs({ correo });
    return (quien ? hiloDe(quien) : hiloMiembro(correo)).slice(-12);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ pensar para una persona */

/**
 * Junta todo lo de la persona y pide la propuesta que toca (lib/iniciativa.ts siguientePropuesta).
 * Lanza AlmacenNoDisponible si su estado no se pudo leer.
 */
export async function proponerPara(
  persona: PersonaIniciativa,
  d: Pick<DepsIniciativa, 'contadores' | 'modelo' | 'reloj' | 'nivelDe'> & { prefs?: PreferenciasAvisos } = {}
): Promise<ResultadoSiguiente & { iniciativa: string }> {
  const ahora = d.reloj ? d.reloj() : Date.now();
  const perfil = await leerPerfil(persona.correo).catch(() => null);
  const iniciativa = iniciativaDe(perfil);
  if (iniciativa === 'apagada') return { propuesta: null, nueva: false, motivo: 'apagada', iniciativa };
  const prefs = d.prefs || (await preferenciasDe(persona.correo));
  if (enHorasQuietas(ahora, prefs)) return { propuesta: null, nueva: false, motivo: 'horas_quietas', iniciativa };
  const fuentes = await fuentesAhora(persona.correo, d, perfil);
  const ctx: ContextoIniciativa & { nivelIniciativa: typeof iniciativa } = {
    ahora,
    perfil,
    misiones: fuentes.misiones,
    hilo: hiloPara(persona.correo),
    // Lo que limitó («No usarlo»), del estado durable: tampoco entra por lo último que dijo (null: no se supo → sin hilo).
    reservas: await reservasDe(persona.correo),
    observaciones: fuentes.observaciones,
    ...(fuentes.desconectadas ? { desconectadas: fuentes.desconectadas } : {}),
    zona: prefs.zona,
    quietas: prefs.quietas,
    excluir: (p) => apagadaPara(prefs, p),
    nivelIniciativa: iniciativa,
    ...(d.modelo !== undefined ? { modelo: d.modelo } : {}),
  };
  const nombre = perfil?.apodo || persona.nombre;
  const r = await siguientePropuesta({ ...persona, nombre, nivel: persona.nivel || d.nivelDe?.(persona.correo) }, ctx);
  return { ...r, iniciativa };
}

/**
 * Lo que se vio de correo y WhatsApp, con su estado, a partir de lo que devolvió el adaptador. Si el adaptador
 * FALLÓ, cada fuente queda `unavailable` (nunca «0 sin leer», nunca vigente); si no hay adaptador, no se observó
 * nada (y una propuesta que dependa de esas fuentes no es vigente). Nunca se busca en otra cuenta.
 */
export function observacionesDe(c: Contadores | null, ahora: number): Observaciones {
  const out: Observaciones = {};
  for (const f of ['correo', 'whatsapp'] as FuenteContada[]) {
    const o: Observacion | undefined = c === null ? { estado: 'unavailable', visto: ahora } : observacionDe(c, f);
    if (o) out[f] = o;
  }
  return out;
}

/**
 * Cada lectura queda SELLADA con cuándo empezó la consulta y su orden (A2, revisión del 5-oct): la hora que dio la
 * fuente si la dio (server/fuentes-iniciativa.ts la toma al empezar) o, si no, la de este inicio; y el orden de esta
 * consulta. Así, si dos consultas terminan fuera de orden, la más vieja no pisa lo que ya guardó la más nueva
 * (lib/iniciativa.ts revalidarORegenerar). No cambia ningún estado ni número.
 */
export function sellarObservaciones(obs: Observaciones, inicio: number, orden: number): Observaciones {
  const out: Observaciones = {};
  for (const f of Object.keys(obs) as FuenteContada[]) {
    const o = obs[f];
    if (!o) continue;
    out[f] = { ...o, visto: Number(o.visto) > 0 ? Number(o.visto) : inicio, orden: Number.isInteger(o.orden) && Number(o.orden) > 0 ? Number(o.orden) : orden };
  }
  return out;
}

/** Lo que se lee de sus fuentes AHORA: misiones (null si no se pudieron leer), lo observado por el adaptador y el perfil. */
async function fuentesAhora(correo: string, d: Pick<DepsIniciativa, 'contadores' | 'reloj'>, perfil?: PerfilDeUso | null) {
  const leidas = await leerMisiones(correo);
  // El inicio de ESTA consulta (antes de esperar al adaptador): lo que ordena las lecturas si terminan fuera de orden.
  const ahora = d.reloj ? d.reloj() : Date.now();
  const orden = siguienteOrdenObservacion();
  // Si quien cuenta FALLA, la fuente no se pudo leer (unavailable): nunca es 0 ni «siguen igual».
  let contadores: Contadores | null = {};
  if (d.contadores) {
    try {
      contadores = await Promise.resolve(d.contadores(correo));
    } catch {
      contadores = null;
    }
  }
  const observaciones = sellarObservaciones(observacionesDe(contadores, ahora), ahora, orden);
  const desconectadas = [...new Set([...(contadores?.desconectadas || []), ...(['correo', 'whatsapp'] as const).filter((f) => observaciones[f]?.estado === 'disconnected')])];
  return {
    misiones: leidas.ok ? leidas.misiones : null,
    observaciones,
    desconectadas: desconectadas.length ? desconectadas : undefined,
    perfil: perfil === undefined ? await leerPerfil(correo).catch(() => null) : perfil,
  };
}

/**
 * REVALIDAR JUSTO ANTES DE AVISAR: la propuesta tiene que seguir pendiente (no contestada, no retirada) y su
 * evidencia valer con las fuentes leídas ahora, con el MISMO adaptador que la pensó. Lo que no se pudo leer no
 * se da por bueno.
 *
 * A2 (5-oct): se revalida la versión GUARDADA (lib/iniciativa.ts revalidarPendiente, en un paso del cajón), no la
 * copia que trae la outbox; si el número contado cambió (3→1), se regenera desde lo observado y se devuelve esa
 * versión en `propuesta` para que el despacho entregue ESA, una sola vez (mismo id, mismo sello). Si otra consulta
 * más nueva (un GET, otra réplica) ya guardó su número, esta lectura más vieja no lo pisa: se entrega lo guardado.
 */
export async function revalidarAhora(correo: string, p: Propuesta, d: Pick<DepsIniciativa, 'contadores' | 'reloj'>, ahora: number): Promise<Revalidacion> {
  const est = await leerEstadoIniciativa(correo);
  if (!est.ok) return { vigente: false, motivo: 'fuente_no_disponible' };
  if (est.estado.pendiente?.id !== p.id) return { vigente: false, motivo: 'resuelta' };
  const f = await fuentesAhora(correo, { contadores: d.contadores, reloj: () => ahora });
  try {
    return await revalidarPendiente(correo, p.id, { misiones: f.misiones, observaciones: f.observaciones, perfil: f.perfil, ...(f.desconectadas ? { desconectadas: f.desconectadas } : {}) }, ahora);
  } catch (e) {
    if (e instanceof AlmacenNoDisponible) return { vigente: false, motivo: 'fuente_no_disponible' };
    throw e;
  }
}

/**
 * Cuándo se leyó el número que dice una propuesta de un hecho contado (correo, WhatsApp). La app no deja que una
 * versión con una lectura más vieja pise la tarjeta del mismo id, venga por el GET o por el canal de acciones.
 */
function observadaDe(p: Propuesta): { observada?: number } {
  const f = evidenciaDe(p).fuente;
  return (f.tipo === 'correo' || f.tipo === 'whatsapp') && Number(f.visto) > 0 ? { observada: Number(f.visto) } : {};
}

/** La propuesta como la ve la app, con lo necesario para «ver la propuesta»: por qué, el paso, el permiso y hasta cuándo. */
export function propuestaParaApp(p: Propuesta) {
  const e = evidenciaDe(p);
  return {
    id: p.id,
    texto: p.texto,
    tipo: p.tipo,
    pedido: p.pedido,
    prioridad: p.prioridad,
    creada: p.creada,
    // Sube cuando se regeneró con el número de ahora (A2): la app reemplaza la tarjeta del mismo id.
    rev: p.rev || 1,
    ...observadaDe(p),
    ...(p.misionId ? { misionId: p.misionId } : {}),
    clase: claseDe(p),
    porQue: e.porQue || 'Una idea para ti.',
    paso: e.paso || p.pedido,
    permiso: e.permiso,
    caduca: e.caduca,
  };
}

/**
 * La propuesta como acción del teléfono (lo que `alProponer` empuja al canal de acciones). `tipo` es el de
 * la acción ('iniciativa'); el tipo de la propuesta va en `clase`.
 */
export function accionIniciativa(p: Propuesta) {
  return { tipo: 'iniciativa' as const, id: p.id, texto: p.texto, pedido: p.pedido, clase: p.tipo, prioridad: p.prioridad, creada: p.creada, rev: p.rev || 1, ...observadaDe(p), ...(p.misionId ? { misionId: p.misionId } : {}) };
}

/** La misión como la ve la app (con su número entre las abiertas, si está abierta). */
export function misionParaApp(m: Mision, numero?: number) {
  return { ...m, ...(numero ? { numero } : {}) };
}

/* ------------------------------------------------------------------ rutas */

function sinSesion(res: express.Response) {
  return res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
}

/**
 * Hasta cuándo, de lo que manda la app: `hasta` (instante) o `fecha` + `hora` en SU zona (sin hora, al
 * terminar sus horas quietas). Futuro y dentro de 60 días. Sin nada, `{}` (quien llama aplica su preferencia).
 */
export function hastaDe(b: Record<string, any>, prefs: PreferenciasAvisos, ahora: number): { hasta?: number } | { error: string } {
  let hasta: number | undefined;
  if (b.hasta !== undefined && b.hasta !== null) {
    if (typeof b.hasta !== 'number' || !Number.isFinite(b.hasta)) return { error: 'hasta es un instante (ms).' };
    hasta = b.hasta;
  } else if (b.fecha !== undefined) {
    const f = fechaValida(b.fecha);
    if (!f) return { error: 'La fecha va como AAAA-MM-DD.' };
    try {
      hasta = instanteDeLocal(f, b.hora === undefined ? prefs.quietas.hasta : String(b.hora), prefs.zona);
    } catch {
      return { error: 'La hora va como HH:MM.' };
    }
  }
  if (hasta === undefined) return {};
  if (hasta <= ahora || hasta > ahora + 60 * 86_400_000) return { error: 'La fecha tiene que ser futura y dentro de 60 días.' };
  return { hasta };
}

function fallo(res: express.Response, e: unknown, que: string) {
  if (e instanceof AlmacenNoDisponible) return res.status(503).json({ error: e.message, code: 'almacen_no_disponible', honesto: true });
  const msg = String((e as any)?.message || e).slice(0, 160);
  // Lo que dicen las funciones de las misiones es para la persona («No encuentro esa misión.»).
  if (/^No encuentro/.test(msg)) return res.status(404).json({ error: msg, honesto: true });
  return res.status(400).json({ error: msg || `No pude ${que}.`, honesto: true });
}

export function montarRutasIniciativa(app: express.Express, d: DepsIniciativa) {
  const persona = (req: express.Request): PersonaIniciativa | null => {
    const s = d.sesionDe(req);
    const correo = correoDeSesion(s);
    return correo ? { correo, nombre: s?.nombre ? String(s.nombre).slice(0, 60) : undefined } : null;
  };

  /** La propuesta que toca ahora (o null y por qué). Si toca y no hay, la piensa (hasta ~15 s con el modelo). */
  app.get('/api/iniciativa', d.exigirMesa, d.limitar(30), async (req, res) => {
    const p = persona(req);
    if (!p) return sinSesion(res);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const r = await proponerPara(p, d);
      // La vio al abrir la app: cuenta como entregada por el chat (el reloj ya no la empuja por push).
      if (r.propuesta) await registrarVista(p.correo, r.propuesta, d.reloj ? d.reloj() : Date.now()).catch(() => undefined);
      return res.json({ propuesta: r.propuesta ? propuestaParaApp(r.propuesta) : null, motivo: r.motivo, iniciativa: r.iniciativa, honesto: true });
    } catch (e) {
      return fallo(res, e, 'pensar una propuesta');
    }
  });

  /*
   * Cuerpo: { id, respuesta: 'si'|'no'|'luego', fecha?: 'AAAA-MM-DD', hora?: 'HH:MM', hasta?: ms, silenciar?: 'tema'|'clase' }.
   * «Luego» con fecha (en SU zona) o, sin fecha, su preferencia («luego» de /api/avisos/preferencias).
   * `silenciar`: «no sobre este tema» o «no sobre esta clase» (apaga y retira lo pendiente de eso).
   */
  app.post('/api/iniciativa/responder', d.exigirMesa, d.limitar(30), async (req, res) => {
    const p = persona(req);
    if (!p) return sinSesion(res);
    const b = (req.body || {}) as Record<string, any>;
    const id = String(b.id || '').trim();
    const respuesta = String(b.respuesta || '').trim().toLowerCase().replace('í', 'i') as RespuestaPropuesta;
    if (!id) return res.status(400).json({ error: 'Falta el id de la propuesta.', honesto: true });
    if (!['si', 'no', 'luego'].includes(respuesta)) return res.status(400).json({ error: 'La respuesta es si, no o luego.', honesto: true });
    if (b.silenciar !== undefined && !['tema', 'clase'].includes(b.silenciar)) return res.status(400).json({ error: 'silenciar es tema o clase.', honesto: true });
    const ahora = d.reloj ? d.reloj() : Date.now();
    try {
      const est = await leerEstadoIniciativa(p.correo);
      const propuesta = est.ok && est.estado.pendiente?.id === id ? est.estado.pendiente : null;
      let hasta: number | undefined;
      if (respuesta === 'luego') {
        const prefs = await preferenciasDe(p.correo);
        const h = hastaDe(b, prefs, ahora);
        if ('error' in h) return res.status(400).json({ error: h.error, honesto: true });
        hasta = h.hasta ?? hastaDeLuego(prefs.luego, ahora, prefs.zona, prefs.quietas);
      }
      const r = await responderPropuesta(p.correo, id, respuesta, ahora, hasta ? { hasta } : {});
      if (!r.ok) return res.status(404).json({ error: 'Esa propuesta ya no está pendiente.', honesto: true });
      // Contestada: lo que esperaba en la outbox para ella ya no se avisa.
      await cancelarAvisos(p.correo, (x) => x.propuestaId === id, `contestada_${respuesta}`, ahora).catch(() => undefined);
      if (b.silenciar && propuesta) {
        const prefs = await preferenciasDe(p.correo);
        await cambiarPreferencias(p.correo, b.silenciar === 'clase' ? { clasesApagadas: [...new Set([...prefs.clasesApagadas, claseDe(propuesta)])] } : { silenciarTema: temaDe(propuesta) }, ahora);
      }
      return res.json({ ok: true, pedido: r.pedido, ...(r.hasta ? { hasta: r.hasta } : {}), honesto: true });
    } catch (e) {
      return fallo(res, e, 'guardar tu respuesta');
    }
  });

  /* ---------------------------------------------- avisos: zona, horario, canal, presupuesto, apagado */

  app.get('/api/avisos/preferencias', d.exigirMesa, d.limitar(30), async (req, res) => {
    const p = persona(req);
    if (!p) return sinSesion(res);
    res.setHeader('Cache-Control', 'no-store');
    const r = await leerAvisos(p.correo);
    if (!r.ok) return res.status(503).json({ error: 'Ahora mismo no pude leer tus preferencias de avisos.', code: 'almacen_no_disponible', honesto: true });
    return res.json({ preferencias: r.estado.prefs, clases: CLASES_AVISO, canales: CANALES_RESUMEN, porOmision: prefsPorOmision(), honesto: true });
  });

  app.post('/api/avisos/preferencias', d.exigirMesa, d.limitar(30), async (req, res) => {
    const p = persona(req);
    if (!p) return sinSesion(res);
    const v = validarCambiosAvisos(req.body);
    if (!v.ok) return res.status(400).json({ error: (v as { error: string }).error, honesto: true });
    const ahora = d.reloj ? d.reloj() : Date.now();
    if (typeof v.cambios.pospuestoHasta === 'number' && v.cambios.pospuestoHasta <= ahora) return res.status(400).json({ error: 'Posponer es hasta una fecha futura.', honesto: true });
    try {
      const r = await cambiarPreferencias(p.correo, v.cambios, ahora);
      return res.json({ preferencias: r.prefs, cancelados: r.cancelados, retiradas: r.retiradas, honesto: true });
    } catch (e) {
      return fallo(res, e, 'guardar tus preferencias de avisos');
    }
  });

  /** Posponer todos los avisos hasta una fecha (y hora) de SU zona, o un instante; `quitar` lo deshace. */
  app.post('/api/avisos/posponer', d.exigirMesa, d.limitar(30), async (req, res) => {
    const p = persona(req);
    if (!p) return sinSesion(res);
    const b = (req.body || {}) as Record<string, any>;
    const ahora = d.reloj ? d.reloj() : Date.now();
    try {
      if (b.quitar === true) {
        await cambiarPreferencias(p.correo, { pospuestoHasta: null }, ahora);
        return res.json({ pospuestoHasta: null, honesto: true });
      }
      const prefs = await preferenciasDe(p.correo);
      const h = hastaDe(b, prefs, ahora);
      if ('error' in h) return res.status(400).json({ error: h.error, honesto: true });
      if (!h.hasta) return res.status(400).json({ error: 'Falta hasta cuándo (fecha AAAA-MM-DD y hora HH:MM).', honesto: true });
      const r = await cambiarPreferencias(p.correo, { pospuestoHasta: h.hasta }, ahora);
      return res.json({ pospuestoHasta: r.prefs.pospuestoHasta ?? null, honesto: true });
    } catch (e) {
      return fallo(res, e, 'posponer tus avisos');
    }
  });

  app.get('/api/misiones', d.exigirMesa, d.limitar(40), async (req, res) => {
    const p = persona(req);
    if (!p) return sinSesion(res);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const todas = req.query.todas === '1' || req.query.todas === 'true';
      const ms = await listarMisiones(p.correo, { todas });
      let n = 0;
      return res.json({ misiones: ms.map((m) => misionParaApp(m, m.estado === 'activa' || m.estado === 'pausada' ? ++n : undefined)), honesto: true });
    } catch (e) {
      return fallo(res, e, 'leer tus misiones');
    }
  });

  app.post('/api/misiones', d.exigirMesa, d.limitar(30), async (req, res) => {
    const p = persona(req);
    if (!p) return sinSesion(res);
    const b = (req.body || {}) as Record<string, any>;
    const accion = String(b.accion || '').trim().toLowerCase();
    const ahora = d.reloj ? d.reloj() : Date.now();
    try {
      if (accion === 'crear') {
        // Una fecha sin hora es el final de ese día en SU zona (lib/zona-horaria.ts).
        const { zona } = await preferenciasDe(p.correo);
        const v = validarNuevaMision(b, { zona });
        if (!v.ok) return res.status(400).json({ error: (v as { error: string }).error, honesto: true });
        const r = await crearMision(p.correo, v.datos, ahora, { zona });
        return res.json({ mision: misionParaApp(r.mision, r.numero), durable: r.durable, honesto: true });
      }
      const id = String(b.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'Falta el id de la misión.', honesto: true });
      if (accion === 'avanzar') {
        const pasoHecho = typeof b.pasoHecho === 'number' ? b.pasoHecho : typeof b.pasoHecho === 'string' ? b.pasoHecho : undefined;
        const r = await avanzarMision(p.correo, id, { pasoHecho, proximoPaso: b.proximoPaso, agregarPaso: b.agregarPaso, nota: b.nota }, ahora);
        return res.json({ mision: misionParaApp(r.mision), efecto: r.efecto, durable: r.durable, honesto: true });
      }
      const estados: Record<string, EstadoMision> = { cerrar: 'hecha', pausar: 'pausada', reanudar: 'activa', descartar: 'descartada' };
      if (accion in estados) {
        const estado: EstadoMision = accion === 'cerrar' && b.estado === 'descartada' ? 'descartada' : estados[accion];
        const r = await cerrarMision(p.correo, id, estado, ahora);
        return res.json({ mision: misionParaApp(r.mision), durable: r.durable, honesto: true });
      }
      return res.status(400).json({ error: 'La acción es crear, avanzar, cerrar, pausar, reanudar o descartar.', honesto: true });
    } catch (e) {
      return fallo(res, e, 'guardar la misión');
    }
  });
}

/* ------------------------------------------------------------------ el reloj */

export const CADA_MS_INICIATIVA = 30 * 60_000;

/**
 * Cada `cadaMs` (30 min): a cada persona que dé `personas()` (quien usó la app hace poco; server.ts decide),
 * fuera de SUS horas quietas y con sus avisos encendidos, le piensa lo que toca; si es NUEVA, la encola en
 * su outbox (lib/avisos.ts) y despacha lo que toque: revalidada con las fuentes de ese momento, por su canal
 * elegido, dentro de su presupuesto y UNA sola vez (el `sello`, compartido entre réplicas; ver lib/avisos.ts).
 *
 * `entregadores` (canal → función que dice a cuántos aparatos llegó) los pone server.ts; `alProponer` es la
 * forma vieja (un solo canal, el de la app). Una vuelta no se pisa con la siguiente; un fallo con una persona
 * no para a las demás. No arranca al importar. `parar()` lo detiene; `vuelta()` corre una a mano (pruebas) y
 * devuelve cuántos avisos se entregaron.
 */
export function arrancarIniciativa(o: {
  personas: () => Promise<PersonaIniciativa[]> | PersonaIniciativa[];
  alProponer?: (correo: string, propuesta: Propuesta) => unknown;
  entregadores?: Partial<Record<CanalAviso, Entregador>>;
  sello?: SelloEntrega;
  contadores?: DepsIniciativa['contadores'];
  nivelDe?: DepsIniciativa['nivelDe'];
  modelo?: ModeloCorto | null;
  reloj?: () => number;
  cadaMs?: number;
  /** Máximo de personas por vuelta (cada una puede pedir al modelo). */
  max?: number;
}): { parar(): void; vuelta(): Promise<number> } {
  let corriendo = false;
  const alProponer = o.alProponer;
  const entregadores: Partial<Record<CanalAviso, Entregador>> = o.entregadores || (alProponer ? { app: async (c, a) => Number(await Promise.resolve(alProponer(c, a.propuesta))) || 0 } : {});
  const vuelta = async (): Promise<number> => {
    const ahora = o.reloj ? o.reloj() : Date.now();
    if (corriendo) return 0;
    corriendo = true;
    let entregadas = 0;
    try {
      const lista = await Promise.resolve(o.personas()).catch(() => [] as PersonaIniciativa[]);
      const vistos = new Set<string>();
      for (const p of lista) {
        const correo = correoDeSesion(p);
        if (!correo || vistos.has(correo)) continue;
        vistos.add(correo);
        if (vistos.size > (o.max ?? 40)) break;
        try {
          const prefs = await preferenciasDe(correo);
          // Avisos apagados: nada que empujar (lo pendiente ya se canceló al apagar).
          if (prefs.apagado) continue;
          if (!enHorasQuietas(ahora, prefs)) {
            const r = await proponerPara({ ...p, correo }, { ...o, prefs });
            if (r.nueva && r.propuesta) await encolarAviso(correo, r.propuesta, ahora);
          }
          // Lo encolado (también lo que esperaba el fin de sus horas quietas) se revalida y se despacha.
          // Se revalida con la hora de ESE momento (no la del inicio de la vuelta): es la que sella la lectura.
          const hechos = await procesarOutbox(correo, { revalidar: (q) => revalidarAhora(correo, q, o, o.reloj ? o.reloj() : Date.now()), entregadores, sello: o.sello, ahora });
          entregadas += hechos.filter((h) => h.entregado).length;
        } catch (e: any) {
          if (!(e instanceof AlmacenNoDisponible)) console.warn('[iniciativa] no pude proponer', String(e?.message || e).slice(0, 120));
        }
      }
    } finally {
      corriendo = false;
    }
    return entregadas;
  };
  const t = setInterval(() => void vuelta().catch(() => undefined), o.cadaMs ?? CADA_MS_INICIATIVA);
  t.unref?.();
  return { parar: () => clearInterval(t), vuelta };
}

/* ------------------------------------------------------------------ la composición (P1/A2) */

/**
 * UN adaptador de contadores (server/fuentes-iniciativa.ts contadoresProductivos en server.ts) para las rutas
 * (GET /api/iniciativa: revalida antes de MOSTRAR) y para el reloj (revalida antes de ENTREGAR). Así lo que se
 * ve al pensar y lo que se ve al despachar salen de la misma fuente, y ninguno de los dos se monta sin ella.
 */
export function componerIniciativa(o: { contadores: FuenteContadores }) {
  return {
    contadores: o.contadores,
    montarRutas: (app: express.Express, d: Omit<DepsIniciativa, 'contadores'>) => montarRutasIniciativa(app, { ...d, contadores: o.contadores }),
    arrancar: (r: Omit<Parameters<typeof arrancarIniciativa>[0], 'contadores'>) => arrancarIniciativa({ ...r, contadores: o.contadores }),
  };
}
