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
 *
 * La persona sale SIEMPRE de la sesión firmada (deps.sesionDe), nunca de la consulta ni del cuerpo: no
 * hay forma de pedir las propuestas o las misiones de otro.
 *
 * `arrancarIniciativa` es el reloj (cada ~30 min, fuera de horas quietas): para quien usó la app hace
 * poco, piensa lo que toca y se lo entrega a `alProponer` (server.ts lo empuja al canal de acciones del
 * teléfono o a Telegram). No arranca solo al importar.
 */
import type express from 'express';
import { hiloDe } from '../lib/memoria';
import { hiloMiembro } from '../lib/memoria-miembro';
import { miembrosUltron, quienEs } from '../lib/junta';
import { iniciativaDe, leerPerfil, type Perfil } from '../lib/perfil-persona';
import {
  enHorasQuietas,
  lineaPorConocer,
  responderPropuesta,
  siguientePropuesta,
  type ContextoIniciativa,
  type ModeloCorto,
  type PersonaIniciativa,
  type Propuesta,
  type RespuestaPropuesta,
  type ResultadoSiguiente,
} from '../lib/iniciativa';
import { AlmacenNoDisponible, avanzarMision, bloqueMisiones, cerrarMision, correrMision, crearMision, leerMisiones, listarMisiones, validarNuevaMision, type EstadoMision, type Mision } from '../lib/misiones';

/** Cuántas cosas sin leer tiene en sus canales (server.ts lo sabe; aquí no se importan correo ni WhatsApp). */
export type Contadores = { correoSinLeer?: number; whatsappSinLeer?: number };

export type DepsIniciativa = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo: string; nombre?: string } | null;
  /** Para empujar una propuesta nueva al teléfono (o a Telegram). El GET no lo usa: ya la devuelve. */
  alProponer?: (correo: string, propuesta: Propuesta) => unknown;
  contadores?: (correo: string) => Promise<Contadores> | Contadores;
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

/**
 * Lo del turno para la iniciativa en la conversación: sus misiones abiertas y lo que aún no sabe de su
 * vida. Va en HECHOS (o en el bloque de la app), nunca en el system: cambia. Nunca lanza.
 */
export async function bloqueIniciativaTurno(dueno: string, perfil?: Perfil | null): Promise<string> {
  const correo = duenoMisiones(dueno);
  if (!correo) return '';
  const p = perfil === undefined ? await leerPerfil(correo).catch(() => null) : perfil;
  return [await bloqueMisiones(correo), lineaPorConocer(p)].filter(Boolean).join('\n');
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
export async function proponerPara(persona: PersonaIniciativa, d: Pick<DepsIniciativa, 'contadores' | 'modelo' | 'reloj' | 'nivelDe'> = {}): Promise<ResultadoSiguiente & { iniciativa: string }> {
  const ahora = d.reloj ? d.reloj() : Date.now();
  const perfil = await leerPerfil(persona.correo).catch(() => null);
  const iniciativa = iniciativaDe(perfil);
  if (iniciativa === 'apagada') return { propuesta: null, nueva: false, motivo: 'apagada', iniciativa };
  if (enHorasQuietas(ahora)) return { propuesta: null, nueva: false, motivo: 'horas_quietas', iniciativa };
  const leidas = await leerMisiones(persona.correo);
  const contadores = d.contadores ? await Promise.resolve(d.contadores(persona.correo)).catch(() => ({}) as Contadores) : {};
  const ctx: ContextoIniciativa & { nivelIniciativa: typeof iniciativa } = {
    ahora,
    perfil,
    misiones: leidas.ok ? leidas.misiones : [],
    hilo: hiloPara(persona.correo),
    correoSinLeer: contadores.correoSinLeer,
    whatsappSinLeer: contadores.whatsappSinLeer,
    nivelIniciativa: iniciativa,
    ...(d.modelo !== undefined ? { modelo: d.modelo } : {}),
  };
  const nombre = perfil?.apodo || persona.nombre;
  const r = await siguientePropuesta({ ...persona, nombre, nivel: persona.nivel || d.nivelDe?.(persona.correo) }, ctx);
  return { ...r, iniciativa };
}

/** La propuesta como la ve la app. */
export function propuestaParaApp(p: Propuesta) {
  return { id: p.id, texto: p.texto, tipo: p.tipo, pedido: p.pedido, prioridad: p.prioridad, creada: p.creada, ...(p.misionId ? { misionId: p.misionId } : {}) };
}

/**
 * La propuesta como acción del teléfono (lo que `alProponer` empuja al canal de acciones). `tipo` es el de
 * la acción ('iniciativa'); el tipo de la propuesta va en `clase`.
 */
export function accionIniciativa(p: Propuesta) {
  return { tipo: 'iniciativa' as const, id: p.id, texto: p.texto, pedido: p.pedido, clase: p.tipo, prioridad: p.prioridad, creada: p.creada, ...(p.misionId ? { misionId: p.misionId } : {}) };
}

/** La misión como la ve la app (con su número entre las abiertas, si está abierta). */
export function misionParaApp(m: Mision, numero?: number) {
  return { ...m, ...(numero ? { numero } : {}) };
}

/* ------------------------------------------------------------------ rutas */

function sinSesion(res: express.Response) {
  return res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
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
      return res.json({ propuesta: r.propuesta ? propuestaParaApp(r.propuesta) : null, motivo: r.motivo, iniciativa: r.iniciativa, honesto: true });
    } catch (e) {
      return fallo(res, e, 'pensar una propuesta');
    }
  });

  app.post('/api/iniciativa/responder', d.exigirMesa, d.limitar(30), async (req, res) => {
    const p = persona(req);
    if (!p) return sinSesion(res);
    const id = String(req.body?.id || '').trim();
    const respuesta = String(req.body?.respuesta || '').trim().toLowerCase().replace('í', 'i') as RespuestaPropuesta;
    if (!id) return res.status(400).json({ error: 'Falta el id de la propuesta.', honesto: true });
    if (!['si', 'no', 'luego'].includes(respuesta)) return res.status(400).json({ error: 'La respuesta es si, no o luego.', honesto: true });
    try {
      const r = await responderPropuesta(p.correo, id, respuesta, d.reloj ? d.reloj() : Date.now());
      if (!r.ok) return res.status(404).json({ error: 'Esa propuesta ya no está pendiente.', honesto: true });
      return res.json({ ok: true, pedido: r.pedido, honesto: true });
    } catch (e) {
      return fallo(res, e, 'guardar tu respuesta');
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
        const v = validarNuevaMision(b);
        if (!v.ok) return res.status(400).json({ error: (v as { error: string }).error, honesto: true });
        const r = await crearMision(p.correo, v.datos, ahora);
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
 * Cada `cadaMs` (30 min), fuera de horas quietas: a cada persona que dé `personas()` (quien usó la app
 * hace poco; server.ts decide), le piensa lo que toca y, si es NUEVA, la entrega a `alProponer`. Una vuelta
 * no se pisa con la siguiente; un fallo con una persona no para a las demás. No arranca al importar:
 * server.ts lo llama una vez. `parar()` lo detiene; `vuelta()` corre una a mano (pruebas).
 */
export function arrancarIniciativa(o: {
  personas: () => Promise<PersonaIniciativa[]> | PersonaIniciativa[];
  alProponer: (correo: string, propuesta: Propuesta) => unknown;
  contadores?: DepsIniciativa['contadores'];
  nivelDe?: DepsIniciativa['nivelDe'];
  modelo?: ModeloCorto | null;
  reloj?: () => number;
  cadaMs?: number;
  /** Máximo de personas por vuelta (cada una puede pedir al modelo). */
  max?: number;
}): { parar(): void; vuelta(): Promise<number> } {
  let corriendo = false;
  const vuelta = async (): Promise<number> => {
    const ahora = o.reloj ? o.reloj() : Date.now();
    if (corriendo || enHorasQuietas(ahora)) return 0;
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
          const r = await proponerPara({ ...p, correo }, o);
          if (r.nueva && r.propuesta) {
            await Promise.resolve(o.alProponer(correo, r.propuesta));
            entregadas++;
          }
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
