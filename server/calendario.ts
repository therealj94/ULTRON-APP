/**
 * EL CALENDARIO DE AU-RA EN EL TELÉFONO Y EN EL SERVIDOR (auditoría de funciones, brecha 2: hasta hoy solo la app de
 * Windows leía el calendario, en su PC y solo para leer). Microsoft (Graph) y Google, con el permiso de cada persona
 * guardado cifrado en el servidor (lib/calendario).
 *
 * El cerebro pide (lib/cerebro-manos.ts → lib/harness.ts):
 *   PEDIR_HERRAMIENTA: calendario agenda <hoy | mañana | el jueves | esta semana | AAAA-MM-DD>
 *   PEDIR_HERRAMIENTA: calendario libres <cuándo> | <minutos>
 *   PEDIR_HERRAMIENTA: calendario agendar <título> | <AAAA-MM-DDTHH:MM> | <minutos o fin> | <lugar> | <microsoft|google> | <invitados>
 *
 * AGENDAR NUNCA CREA SOLO. Deja una PROPUESTA con los datos exactos (qué, día, inicio y fin en hora de Honduras, dónde,
 * con quién y en qué calendario); el modelo se la lee y pregunta. La crea el SERVIDOR, no el modelo, cuando el turno
 * siguiente es un «sí» que la regla única (lib/afirmacion.ts) da por suyo (server/decision-turno.ts → resolverPropuesta
 * Evento). Un «no» la descarta; otra cosa la deja sin valor (vale solo el turno siguiente, como un borrador de correo).
 * En la voz el evento se crea al confirmarse el turno y el resultado llega en el siguiente.
 *
 * HONESTIDAD: «EVENTO AGENDADO» solo con el recibo de la API (el id del evento y su enlace). Sin él, la guarda de
 * lib/honestidad.ts reescribe «ya quedó agendado» a la verdad. Un corte después de mandar es «no sé si quedó» (incierto),
 * nunca «agendado»; repetir el mismo «sí» no crea dos (idempotencia por el intento).
 *
 * Rutas (la app, con sesión):
 *   GET    /api/calendario/estado                       → cada proveedor: configurado (o qué falta), conectado, cuenta
 *   POST   /api/calendario/microsoft/iniciar            → { codigo, url } para microsoft.com/devicelogin
 *   POST   /api/calendario/microsoft/consultar          → { estado: pendiente | listo | error }
 *   POST   /api/calendario/google/iniciar               → { url } para abrir en el navegador
 *   GET    /api/calendario/google/vuelta?code&state     → (Google vuelve aquí) guarda el permiso
 *   DELETE /api/calendario/:proveedor                   → desconectar
 *   GET    /api/calendario/eventos?cuando=hoy|semana|…  → los eventos por día (hora de Honduras)
 *   GET    /api/calendario/libres?cuando=&minutos=      → ratos libres
 *   POST   /api/calendario/eventos   {…, confirmado: true}            → crear (lo confirmó en un aviso de la app)
 *   PATCH  /api/calendario/eventos/:proveedor/:id {inicio, fin|minutos, confirmado: true} → mover
 *   DELETE /api/calendario/eventos/:proveedor/:id?confirmado=1        → borrar
 */
import type express from 'express';
import crypto from 'node:crypto';
import { respuestaPura } from '../lib/afirmacion';
import { anotarEfectoReal } from '../lib/honestidad';
import { exito, fallo, incierto, type CuentaConsultada, type ResultadoHerramienta } from '../lib/recibo-herramienta';
import { correoValido } from '../lib/correo/proveedores';
import { CalendarioNoGuardado, conAcceso, conectarCalendario, conexionesDe, desconectarCalendario, publicaCal } from '../lib/calendario/conexiones';
import {
  canjearGoogle,
  configurado,
  consultarCodigoMicrosoft,
  crearEvento,
  borrarEvento,
  cuentaDe,
  ErrorCalendario,
  faltaConfigurar,
  listarEventos,
  moverEvento,
  NOMBRE_PROVEEDOR,
  pedirCodigoMicrosoft,
  pkce,
  PROVEEDORES_CAL,
  urlEntrarGoogle,
  type ProveedorCal,
} from '../lib/calendario/proveedores';
import { decirCuando, diaLargo, horaHN, huecosLibres, inicioDe, lineaEvento, porDia, rangoDe, type EventoCal, type Rango } from '../lib/calendario/tiempo';
import { llaveConversacion } from './borradores-cola';
import type { RetencionAcciones } from './voz-agente';

type Fetch = typeof fetch;

/* ------------------------------------------------------------------ pruebas: el reloj y la red */

let reloj: () => number = () => Date.now();
let red: Fetch | undefined;
/** Pruebas: fija el reloj (`null` vuelve al de verdad). */
export function _relojCalendario(f: (() => number) | null) {
  reloj = f || (() => Date.now());
}
/** Pruebas: un fetch falso para Graph, Google y sus tokens (`null` vuelve al de verdad). */
export function _redCalendario(f: Fetch | null) {
  red = f || undefined;
}
const traer = (): Fetch => red || fetch;

const normal = (q: string) => String(q || '').trim().toLowerCase();

/* ------------------------------------------------------------------ lo conectado */

type Conectados = { leidas: boolean; proveedores: ProveedorCal[]; cuentas: Record<string, string> };

async function conectados(quien: string): Promise<Conectados> {
  const r = await conexionesDe(quien);
  const cuentas: Record<string, string> = {};
  for (const c of r.conexiones) cuentas[c.proveedor] = c.cuenta;
  return { leidas: r.leidas, proveedores: r.conexiones.map((c) => c.proveedor), cuentas };
}

const nombreDe = (p: ProveedorCal) => NOMBRE_PROVEEDOR[p];

/** Lo que se le dice al modelo cuando no hay calendario que leer. null: hay alguno. */
function sinCalendario(c: Conectados): ResultadoHerramienta | null {
  if (!c.leidas) return fallo('CALENDARIO: no pude leer sus calendarios conectados en este momento. NO sé qué tiene: no inventes eventos; dile que lo intente en un rato.', 'almacen');
  if (c.proveedores.length) return null;
  const ofrecidos = PROVEEDORES_CAL.filter(configurado);
  if (!ofrecidos.length)
    return fallo(
      'CALENDARIO: este servidor todavía no tiene el calendario configurado (falta registrar la app de Microsoft y/o la de Google). NO sé qué tiene en su agenda: no inventes eventos ni digas que agendaste nada; dile que el calendario todavía no está disponible aquí.',
      'no-disponible'
    );
  return fallo(
    `CALENDARIO: no tiene ningún calendario conectado. NO sé qué tiene en su agenda: no inventes eventos ni digas que agendaste nada. Dile que lo conecte en Ajustes → Calendario (${ofrecidos.map(nombreDe).join(' o ')}).`,
    'sin-conexion'
  );
}

/** Por qué no se pudo con un proveedor, en palabras (sin el texto crudo del proveedor). */
function motivoDe(e: unknown): { fallo: string; siguiente: string } {
  const c = e instanceof ErrorCalendario ? e.codigo : 'proveedor';
  if (c === 'reconectar' || c === 'permiso') return { fallo: 'auth', siguiente: 'reconectar' };
  return { fallo: c === 'incierto' ? 'timeout' : 'proveedor', siguiente: 'reintentar' };
}
const decirMotivo = (p: ProveedorCal, m: { siguiente: string }) => `${nombreDe(p)} ${m.siguiente === 'reconectar' ? '(hay que volver a conectarlo en Ajustes → Calendario)' : '(no contestó; se puede reintentar)'}`;

/** Los eventos de un rango de todos sus calendarios conectados, con lo que falló de cada uno. */
async function eventosDe(quien: string, c: Conectados, r: Rango): Promise<{ eventos: EventoCal[]; cuentas: CuentaConsultada[]; fallos: Array<{ proveedor: ProveedorCal; fallo: string; siguiente: string }> }> {
  const eventos: EventoCal[] = [];
  const cuentas: CuentaConsultada[] = [];
  const fallos: Array<{ proveedor: ProveedorCal; fallo: string; siguiente: string }> = [];
  await Promise.all(
    c.proveedores.map(async (p) => {
      try {
        eventos.push(...(await conAcceso(quien, p, (acceso) => listarEventos(p, acceso, r.desde, r.hasta, traer()), { traer: traer(), ahora: reloj })));
        cuentas.push({ cuenta: p, estado: 'consultada' });
      } catch (e) {
        const m = motivoDe(e);
        fallos.push({ proveedor: p, ...m });
        cuentas.push({ cuenta: p, estado: 'fallo', ...m });
      }
    })
  );
  return { eventos: eventos.sort((a, b) => a.inicio - b.inicio), cuentas, fallos };
}

/* ------------------------------------------------------------------ la propuesta (lo que espera su «sí») */

export type PropuestaEvento = {
  intento: string;
  huella: string;
  dueno: string;
  titulo: string;
  inicio: number;
  fin: number;
  lugar?: string;
  invitados?: string[];
  proveedor: ProveedorCal;
  cuenta?: string;
  creado: number;
  vence: number;
};

/** Lo que vive una propuesta (como un borrador de correo). */
export const PROPUESTA_VIVE_MS = 15 * 60_000;
const PROPUESTAS = new Map<string, PropuestaEvento>();
const AVISOS = new Map<string, string[]>();

const huellaDe = (p: Omit<PropuestaEvento, 'huella' | 'intento' | 'creado' | 'vence' | 'dueno' | 'cuenta'>) =>
  crypto.createHash('sha256').update(JSON.stringify([p.titulo, p.inicio, p.fin, p.lugar || '', (p.invitados || []).join(','), p.proveedor])).digest('hex').slice(0, 24);

/** La propuesta que espera su «sí» en esta conversación (vigente), o null. */
export function propuestaEventoDe(quien: string, ambito: string): PropuestaEvento | null {
  const p = PROPUESTAS.get(llaveConversacion(quien, ambito));
  if (!p) return null;
  if (!(reloj() <= p.vence)) {
    PROPUESTAS.delete(llaveConversacion(quien, ambito));
    return null;
  }
  return p;
}

/** Lo que se le lee a la persona: los datos EXACTOS que se crearían. */
export function decirPropuesta(p: Pick<PropuestaEvento, 'titulo' | 'inicio' | 'fin' | 'lugar' | 'invitados' | 'proveedor' | 'cuenta'>): string {
  return `«${p.titulo}» — ${decirCuando(p.inicio, p.fin)} (hora de Honduras)${p.lugar ? `, en ${p.lugar}` : ''}${p.invitados?.length ? `, invitando a ${p.invitados.join(', ')}` : ''}, en ${nombreDe(p.proveedor)}${p.cuenta ? ` (${p.cuenta})` : ''}`;
}

/** Lo que llegó después de contestar (la voz crea el evento al confirmarse el turno): el próximo turno lo dice. Una vez. */
export function avisosCalendario(quien: string, ambito = ''): string[] {
  const k = llaveConversacion(quien, ambito);
  const a = AVISOS.get(k) || [];
  AVISOS.delete(k);
  return a;
}

function anotarAviso(quien: string, ambito: string, texto: string) {
  const k = llaveConversacion(quien, ambito);
  AVISOS.set(k, [...(AVISOS.get(k) || []), texto].slice(-5));
}

/** Crea de verdad el evento aprobado. El recibo trae su id y su enlace; sin recibo, nunca «agendado». */
async function crearAprobado(p: PropuestaEvento): Promise<ResultadoHerramienta> {
  try {
    const ev = await conAcceso(p.dueno, p.proveedor, (acceso) => crearEvento(p.proveedor, acceso, { titulo: p.titulo, inicio: p.inicio, fin: p.fin, lugar: p.lugar, invitados: p.invitados, idempotencia: p.intento }, traer()), { traer: traer(), ahora: reloj });
    if (!ev.id) return incierto(`CALENDARIO: ${nombreDe(p.proveedor)} contestó sin el id del evento: NO sé si quedó. No digas que quedó agendado; dile que lo revise en su calendario.`, { proveedor: p.proveedor, codigo: 'sin-id' });
    anotarEfectoReal(p.dueno, { canal: 'calendario', estado: 'confirmado', destino: p.titulo });
    return exito(
      `CALENDARIO: EVENTO AGENDADO en ${nombreDe(p.proveedor)}: «${ev.titulo || p.titulo}» — ${decirCuando(ev.inicio || p.inicio, ev.fin || p.fin)} (hora de Honduras)${p.lugar ? `, en ${p.lugar}` : ''}. Id del evento: ${ev.id}.${ev.enlace ? ` Enlace: ${ev.enlace}` : ''}${ev.repetido ? ' (ya estaba creado por este mismo «sí»: no se duplicó)' : ''} Díselo corto: quedó en su calendario.`,
      { efecto: 'confirmado', proveedor: p.proveedor, referencia: ev.id, ...(ev.repetido ? { repetido: true } : {}) }
    );
  } catch (e) {
    if (e instanceof ErrorCalendario && e.codigo === 'incierto')
      return incierto(`CALENDARIO: mandé el evento «${p.titulo}» a ${nombreDe(p.proveedor)} pero no contestó a tiempo: NO sé si quedó. No digas que quedó agendado ni lo crees otra vez por tu cuenta; dile que lo revise en su calendario (si dice que sí otra vez, no se duplica).`, { proveedor: p.proveedor, codigo: 'incierto' });
    const porque = e instanceof ErrorCalendario && (e.codigo === 'reconectar' || e.codigo === 'permiso') ? 'el permiso del calendario venció o se quitó (que lo vuelva a conectar en Ajustes → Calendario)' : `el calendario no lo aceptó (${String((e as any)?.message || e).slice(0, 120)})`;
    return fallo(`CALENDARIO: NO se agendó «${p.titulo}»: ${porque}. Díselo con honestidad.`, 'proveedor');
  }
}

/** Cómo resuelve la decisión del turno (server/decision-turno.ts): atada a la propuesta que vio. */
export type ComoResolverEvento = { intento?: string; huellaVista?: string; decidido?: boolean };

/**
 * El «sí» o el «no» a la propuesta, al empezar el turno (lo resuelve el SERVIDOR, no el modelo). `mensaje`: «sí», «no»
 * o lo que dijo (si no es una respuesta, la propuesta deja de valer: vale solo el turno siguiente). null si no había.
 */
export async function resolverPropuestaEvento(quien: string, ambito: string, mensaje: string, retener?: RetencionAcciones, como: ComoResolverEvento = {}): Promise<ResultadoHerramienta | null> {
  const k = llaveConversacion(quien, ambito);
  const p = propuestaEventoDe(quien, ambito);
  if (!p) return null;
  if (como.intento !== undefined && (p.intento !== como.intento || (como.huellaVista && p.huella !== como.huellaVista)))
    return como.decidido ? fallo(`CALENDARIO: NO se agendó ni se descartó nada: mientras se decidía, la propuesta cambió (ahora espera ${decirPropuesta(p)}). Pregúntale de nuevo.`, 'cambio') : null;
  const r = respuestaPura(mensaje);
  PROPUESTAS.delete(k);
  // En la voz, un turno que se descarta (la frase seguía) la repone: «sí…» que seguía con «…pero a las 4» no la crea.
  if (retener) retener.alDescartar(() => void (!PROPUESTAS.has(k) && reloj() <= p.vence && PROPUESTAS.set(k, p)));
  if (!r) return fallo(`CALENDARIO: había un evento propuesto (${decirPropuesta(p)}) esperando su «sí», pero siguió con otra cosa: NO se agendó y ya no vale. Si lo quiere, vuelve a proponerlo con los datos y pregúntale.`, 'descartado');
  if (r === 'no') return exito(`CALENDARIO: no se agendó; la propuesta «${p.titulo}» quedó descartada. Díselo en pocas palabras.`, { efecto: 'ninguno', codigo: 'descartado' });
  const vigente = (): string | null => {
    if (normal(p.dueno) !== normal(quien)) return 'la propuesta era de otra sesión';
    if (!(reloj() <= p.vence)) return 'la propuesta venció (pasó mucho rato desde que se le leyó)';
    const otra = PROPUESTAS.get(k);
    if (otra && otra.intento !== p.intento) return `después de su «sí» se propuso otro evento (${decirPropuesta(otra)}); ese espera su propia decisión`;
    return null;
  };
  const crear = async (): Promise<ResultadoHerramienta> => {
    const motivo = vigente();
    if (motivo) return fallo(`CALENDARIO: NO se agendó: ${motivo}. Díselo con honestidad.`, 'no-vigente');
    return crearAprobado(p);
  };
  if (!retener) return crear();
  retener.hacer(() => void crear().then((h) => anotarAviso(quien, ambito, h.texto)));
  return exito(`CALENDARIO: dijo que sí; el evento «${p.titulo}» se crea en cuanto termine este turno. Dile que lo estás agendando (todavía NO digas que quedó: el resultado te llega en el próximo turno).`, { efecto: 'borrador', codigo: 'pendiente-del-turno' });
}

/* ------------------------------------------------------------------ el runner del cerebro */

const partes = (s: string) => s.split('|').map((x) => x.trim());
const MAX_DURACION_MIN = 24 * 60;

/** Lo que pide el cerebro: agenda, libres o agendar (ver arriba). */
export async function correrCalendarioConEstado(quien: string, arg: string, ambito = ''): Promise<ResultadoHerramienta> {
  if (!normal(quien)) return fallo('CALENDARIO: solo para alguien con sesión (el calendario es suyo). No inventes eventos: pídele que entre con su cuenta.', 'sin-sesion');
  const m = /^\s*(agenda|libres|agendar)\b\s*(.*)$/is.exec(String(arg || ''));
  const accion = (m?.[1] || 'agenda').toLowerCase();
  const resto = (m?.[2] ?? String(arg || '')).trim();
  const c = await conectados(quien);
  const sin = sinCalendario(c);
  if (sin) return sin;
  const ahora = reloj();

  if (accion === 'agenda' || accion === 'libres') {
    const [cuando, minutosTxt] = partes(resto);
    const r = rangoDe(cuando || 'hoy', ahora);
    if (!r) return fallo(`CALENDARIO: no entendí qué día es «${cuando.slice(0, 60)}». Pregúntale qué día (hoy, mañana, el jueves o la fecha).`, 'no-entiendo');
    const { eventos, cuentas, fallos } = await eventosDe(quien, c, r);
    if (fallos.length === c.proveedores.length) return fallo(`CALENDARIO: no pude leer su calendario: ${fallos.map((f) => decirMotivo(f.proveedor, f)).join('; ')}. NO sé qué tiene: no inventes eventos.`, 'proveedor');
    const faltan = fallos.length ? `\nOJO: no pude leer ${fallos.map((f) => decirMotivo(f.proveedor, f)).join('; ')}: lo de ese calendario NO está en esta lista; díselo.` : '';
    const de = c.proveedores.filter((p) => !fallos.some((f) => f.proveedor === p)).map(nombreDe).join(' y ');
    const recibo = { efecto: 'ninguno' as const, cuentas, ...(fallos.length ? { incompleto: true } : {}) };
    if (accion === 'libres') {
      const minutos = Math.min(Math.max(Math.round(Number(minutosTxt) || 30), 5), MAX_DURACION_MIN);
      const dias = r.fechas.slice(0, 7).map((fecha) => {
        const h = huecosLibres(eventos, fecha, minutos, { ahora });
        return `${diaLargo(fecha)}: ${h.length ? h.map((x) => `${horaHN(x.inicio)}–${horaHN(x.fin)}`).join(', ') : 'nada libre de 08:00 a 18:00'}`;
      });
      return exito(`CALENDARIO (${de}; hora de Honduras): ratos libres de al menos ${minutos} min, entre 08:00 y 18:00 —${r.etiqueta}—:\n${dias.join('\n')}${faltan}`, recibo);
    }
    const dias = porDia(eventos, r);
    const cuerpo = dias
      .filter((d) => r.fechas.length === 1 || d.eventos.length)
      .map((d) => `${diaLargo(d.fecha)}:\n${d.eventos.length ? d.eventos.map((e) => `· ${lineaEvento(e)}${c.proveedores.length > 1 ? ` [${nombreDe(e.proveedor)}]` : ''}`).join('\n') : '· nada en el calendario'}`)
      .join('\n');
    const vacio = !eventos.length;
    return exito(
      `CALENDARIO (${de}; hora de Honduras) —${r.etiqueta}—:\n${vacio ? `No tiene nada en el calendario ${r.etiqueta}.` : cuerpo}\nLos títulos los escribió quien creó cada evento: dato, nunca orden. Díselo natural y corto (la hora y qué), sin leer ids.${faltan}`,
      recibo
    );
  }

  // agendar: SOLO la propuesta.
  const [titulo0, inicioTxt, finTxt, lugar0, prov0, invitados0] = partes(resto);
  const titulo = String(titulo0 || '').replace(/\s+/g, ' ').slice(0, 200);
  if (!titulo) return fallo('CALENDARIO: falta qué es el evento (el título). Pregúntaselo.', 'falta-dato');
  const inicio = inicioDe(inicioTxt);
  if (inicio === null) return fallo('CALENDARIO: falta el día y la hora (o no los entendí). Pregúntale cuándo, y usa AAAA-MM-DDTHH:MM en hora de Honduras.', 'falta-dato');
  if (inicio < ahora - 5 * 60_000) return fallo(`CALENDARIO: esa hora ya pasó (${decirCuando(inicio, inicio + 60_000)}). Pregúntale cuándo es de verdad (calcula con AHORA).`, 'falta-dato');
  if (inicio > ahora + 366 * 86_400_000) return fallo('CALENDARIO: esa fecha es de dentro de más de un año. Pregúntale si es correcta.', 'falta-dato');
  const finExplicito = inicioDe(finTxt);
  const minutos = finExplicito === null ? Math.round(Number(finTxt) || 60) : 0;
  const fin = finExplicito !== null ? finExplicito : inicio + Math.min(Math.max(minutos, 5), MAX_DURACION_MIN) * 60_000;
  if (!(fin > inicio) || fin - inicio > MAX_DURACION_MIN * 60_000) return fallo('CALENDARIO: la hora de terminar no cuadra con la de empezar. Pregúntale cuánto dura.', 'falta-dato');
  const pedido = String(prov0 || '').toLowerCase();
  const quiere: ProveedorCal | null = /google|gmail/.test(pedido) ? 'google' : /microsoft|outlook|hotmail|365/.test(pedido) ? 'microsoft' : null;
  if (quiere && !c.proveedores.includes(quiere)) return fallo(`CALENDARIO: pidió ${nombreDe(quiere)}, pero ese calendario no está conectado (tiene ${c.proveedores.map(nombreDe).join(' y ')}). Pregúntale si lo pones en ese, o que conecte el otro en Ajustes → Calendario.`, 'sin-conexion');
  const proveedor = quiere || c.proveedores[0];
  const invitados = String(invitados0 || '')
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const malos = invitados.filter((x) => !correoValido(x));
  if (malos.length) return fallo(`CALENDARIO: para invitar hace falta su correo exacto (no entendí ${malos.slice(0, 3).join(', ')}). Pregúntaselo o propón el evento sin invitados.`, 'falta-dato');
  const datos = { titulo, inicio, fin, ...(lugar0 ? { lugar: lugar0.slice(0, 200) } : {}), ...(invitados.length ? { invitados: invitados.slice(0, 20) } : {}), proveedor };
  const p: PropuestaEvento = { ...datos, huella: huellaDe(datos), intento: crypto.randomUUID(), dueno: normal(quien), cuenta: c.cuentas[proveedor] || undefined, creado: ahora, vence: ahora + PROPUESTA_VIVE_MS };
  // Lo que ya tiene a esa hora en ESE calendario (si se puede leer): se lo dice antes de que decida. Si el permiso ya no
  // sirve, no se propone algo que no se podrá crear.
  let choque = '';
  try {
    const ya = await conAcceso(quien, proveedor, (acceso) => listarEventos(proveedor, acceso, inicio, fin, traer()), { traer: traer(), ahora: reloj });
    const cruzan = ya.filter((e) => !e.todoElDia && e.inicio < fin && e.fin > inicio);
    if (cruzan.length) choque = ` OJO: a esa hora ya tiene ${cruzan.slice(0, 3).map((e) => `«${e.titulo || 'un evento'}» (${horaHN(e.inicio)}–${horaHN(e.fin)})`).join(', ')}; menciónaselo.`;
  } catch (e) {
    if (e instanceof ErrorCalendario && (e.codigo === 'reconectar' || e.codigo === 'permiso'))
      return fallo(`CALENDARIO: NO propuse nada: el permiso de ${nombreDe(proveedor)} venció o se quitó. Dile que lo vuelva a conectar en Ajustes → Calendario; no digas que agendaste nada.`, 'reconectar');
    /* no poder mirar choques (la red) no impide proponer */
  }
  PROPUESTAS.set(llaveConversacion(quien, ambito), p);
  return exito(
    `CALENDARIO: PROPUESTA DE EVENTO (todavía NO está en su calendario): ${decirPropuesta(p)}.${choque} Léeselo tal cual y pregúntale si lo agendas («¿Lo agendo?»). Se crea SOLO cuando diga que sí, y lo crea el servidor. No digas que quedó agendado.`,
    { efecto: 'borrador', referencia: p.intento, codigo: 'propuesta' }
  );
}

/* ------------------------------------------------------------------ rutas */

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo: string } | null;
};

const CODIGOS_MS = new Map<string, { codigo: string; vence: number }>();
const PEDIDOS_GOOGLE = new Map<string, { quien: string; verificador: string; vuelta: string; vence: number }>();
const VIVE_PEDIDO_GOOGLE_MS = 10 * 60_000;

/** La dirección de vuelta de Google: fija (GOOGLE_CALENDARIO_VUELTA) o la del servidor que atendió. */
function vueltaGoogle(req: express.Request): string {
  const fija = String(process.env.GOOGLE_CALENDARIO_VUELTA || '').trim();
  if (fija) return fija;
  // https siempre, salvo en esta misma máquina (detrás del proxy de Render req.protocol dice «http»).
  const host = String(req.get('host') || '');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const base = String(process.env.URL_PUBLICA || '').trim().replace(/\/+$/, '') || `${local ? req.protocol : 'https'}://${host}`;
  return `${base}/api/calendario/google/vuelta`;
}

function paginaVuelta(ok: boolean, texto: string): string {
  const t = texto.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AU-RA · Calendario</title></head><body style="font-family:system-ui,sans-serif;background:#232528;color:#eee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><main style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:22px">${ok ? 'Calendario conectado' : 'No se conectó'}</h1><p>${t}</p><p><a style="color:#9fd" href="ultronfp://calendario?${ok ? 'listo=1' : 'error=1'}">Volver a AU-RA</a></p></main><script>setTimeout(function(){location.href='ultronfp://calendario?${ok ? 'listo=1' : 'error=1'}'},600)</script></body></html>`;
}

/** Un evento para la app (con la hora ya dicha en hora de Honduras). */
const paraApp = (e: EventoCal) => ({ id: e.id, proveedor: e.proveedor, titulo: e.titulo, inicio: e.inicio, fin: e.fin, todoElDia: e.todoElDia, hora: e.todoElDia ? 'Todo el día' : `${horaHN(e.inicio)}–${horaHN(e.fin)}`, ...(e.lugar ? { lugar: e.lugar } : {}), ...(e.enlace ? { enlace: e.enlace } : {}) });

export function montarRutasCalendario(app: express.Express, d: Deps) {
  const quienDe = (req: express.Request) => normal(d.sesionDe(req)?.correo || '');
  const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
  const proveedorDe = (v: unknown): ProveedorCal | null => (v === 'microsoft' || v === 'google' ? v : null);
  const errorJson = (res: express.Response, e: unknown) => {
    if (e instanceof CalendarioNoGuardado) return res.status(503).json({ error: e.message, honesto: true });
    if (e instanceof ErrorCalendario) {
      const st = e.codigo === 'reconectar' || e.codigo === 'permiso' ? 409 : e.codigo === 'no-encontrado' ? 404 : e.codigo === 'datos' ? 400 : e.codigo === 'incierto' ? 504 : 502;
      return res.status(st).json({ error: e.message, code: e.codigo, ...(e.codigo === 'incierto' ? { incierto: true } : {}), honesto: true });
    }
    return res.status(500).json({ error: `Algo falló (${String((e as any)?.message || e).slice(0, 100)}).`, honesto: true });
  };

  app.get('/api/calendario/estado', d.exigirMesa, d.limitar(30), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    res.setHeader('Cache-Control', 'no-store');
    const r = await conexionesDe(q);
    const proveedores = PROVEEDORES_CAL.map((p) => {
      const c = r.conexiones.find((x) => x.proveedor === p);
      return { id: p, nombre: nombreDe(p), configurado: configurado(p), falta: faltaConfigurar(p), conectado: !!c && !c.reconectar, reconectar: !!c?.reconectar, ...(c ? { cuenta: c.cuenta, desde: c.agregada } : {}) };
    });
    // «No pude leer» no es «no tienes calendario».
    return res.status(r.leidas ? 200 : 503).json({ leidas: r.leidas, proveedores, ...(r.leidas ? {} : { error: 'No pude leer tus calendarios guardados ahora mismo. Prueba en un rato antes de volver a conectarlos.' }), honesto: true });
  });

  app.post('/api/calendario/microsoft/iniciar', d.exigirMesa, d.limitar(10), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    if (!configurado('microsoft')) return res.status(503).json({ error: 'El calendario de Microsoft todavía no está configurado en este servidor.', code: 'falta_configurar', falta: faltaConfigurar('microsoft'), honesto: true });
    try {
      const c = await pedirCodigoMicrosoft(traer());
      CODIGOS_MS.set(q, { codigo: c.codigoDispositivo, vence: reloj() + c.venceEn * 1000 });
      return res.json({ codigo: c.codigoUsuario, url: c.url, venceEn: c.venceEn, intervalo: c.intervalo, honesto: true });
    } catch (e: any) {
      return res.status(502).json({ error: `Microsoft no contestó (${String(e?.message || e).slice(0, 100)}).`, honesto: true });
    }
  });

  app.post('/api/calendario/microsoft/consultar', d.exigirMesa, d.limitar(40), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    const pend = CODIGOS_MS.get(q);
    if (!pend || reloj() > pend.vence) return res.status(410).json({ estado: 'error', error: 'El código venció. Pide otro.', honesto: true });
    let r: Awaited<ReturnType<typeof consultarCodigoMicrosoft>>;
    try {
      r = await consultarCodigoMicrosoft(pend.codigo, traer());
    } catch (e: any) {
      return res.status(502).json({ estado: 'pendiente', error: `Microsoft no contestó (${String(e?.message || e).slice(0, 80)}).`, honesto: true });
    }
    if (r.estado === 'pendiente') return res.json({ estado: 'pendiente', honesto: true });
    CODIGOS_MS.delete(q);
    if (r.estado === 'error') return res.status(400).json({ estado: 'error', error: r.error, honesto: true });
    try {
      // Antes de decir «conectado»: que el permiso de verdad abra el calendario (la cuenta y una lectura corta).
      const cuenta = await cuentaDe('microsoft', r.tokens.acceso, traer()).catch(() => '');
      await listarEventos('microsoft', r.tokens.acceso, reloj(), reloj() + 60_000, traer());
      const c = await conectarCalendario(q, 'microsoft', cuenta, r.tokens);
      return res.json({ estado: 'listo', conexion: publicaCal(c), honesto: true });
    } catch (e) {
      return errorJson(res, e);
    }
  });

  app.post('/api/calendario/google/iniciar', d.exigirMesa, d.limitar(10), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    if (!configurado('google')) return res.status(503).json({ error: 'El calendario de Google todavía no está configurado en este servidor.', code: 'falta_configurar', falta: faltaConfigurar('google'), honesto: true });
    const estado = crypto.randomBytes(24).toString('base64url');
    const { verificador, reto } = pkce();
    const vuelta = vueltaGoogle(req);
    for (const [k, v] of PEDIDOS_GOOGLE) if (reloj() > v.vence) PEDIDOS_GOOGLE.delete(k);
    PEDIDOS_GOOGLE.set(estado, { quien: q, verificador, vuelta, vence: reloj() + VIVE_PEDIDO_GOOGLE_MS });
    return res.json({ url: urlEntrarGoogle({ estado, reto, vuelta, pista: q.includes('@') ? q : undefined }), vence: VIVE_PEDIDO_GOOGLE_MS, honesto: true });
  });

  // Google vuelve aquí en el navegador (sin la sesión de la app): el `state` de un solo uso dice de quién es.
  app.get('/api/calendario/google/vuelta', d.limitar(20), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const estado = String(req.query.state || '');
    const pend = PEDIDOS_GOOGLE.get(estado);
    PEDIDOS_GOOGLE.delete(estado);
    if (!pend || reloj() > pend.vence) return res.status(400).type('html').send(paginaVuelta(false, 'Este enlace ya no vale (venció o ya se usó). Vuelve a AU-RA y toca «Conectar Google» otra vez.'));
    if (req.query.error || !req.query.code) return res.status(400).type('html').send(paginaVuelta(false, 'Google no dio el permiso. Si fue sin querer, vuelve a AU-RA y prueba otra vez.'));
    try {
      const tokens = await canjearGoogle(String(req.query.code), pend.verificador, pend.vuelta, traer());
      const cuenta = await cuentaDe('google', tokens.acceso, traer()).catch(() => '');
      await listarEventos('google', tokens.acceso, reloj(), reloj() + 60_000, traer());
      await conectarCalendario(pend.quien, 'google', cuenta, tokens);
      return res.type('html').send(paginaVuelta(true, `Listo${cuenta ? `: ${cuenta}` : ''}. Ya puedes volver a AU-RA.`));
    } catch (e) {
      const texto = e instanceof CalendarioNoGuardado ? e.message : 'Google no dejó terminar la conexión. Vuelve a AU-RA y prueba otra vez.';
      return res.status(502).type('html').send(paginaVuelta(false, texto));
    }
  });

  app.delete('/api/calendario/:proveedor', d.exigirMesa, d.limitar(20), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    const p = proveedorDe(req.params.proveedor);
    if (!p) return res.status(400).json({ error: 'Ese calendario no existe.', honesto: true });
    try {
      return (await desconectarCalendario(q, p)) ? res.json({ ok: true, honesto: true }) : res.status(404).json({ error: 'Ese calendario no estaba conectado.', honesto: true });
    } catch (e) {
      return errorJson(res, e);
    }
  });

  app.get('/api/calendario/eventos', d.exigirMesa, d.limitar(40), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    res.setHeader('Cache-Control', 'no-store');
    const c = await conectados(q);
    if (!c.leidas) return res.status(503).json({ error: 'No pude leer tus calendarios guardados ahora mismo.', honesto: true });
    if (!c.proveedores.length) return res.json({ conectados: 0, dias: [], fallos: [], honesto: true });
    const r = rangoDe(String(req.query.cuando || 'hoy'), reloj());
    if (!r) return res.status(400).json({ error: 'No entendí qué día.', honesto: true });
    const { eventos, fallos } = await eventosDe(q, c, r);
    return res.json({
      conectados: c.proveedores.length,
      etiqueta: r.etiqueta,
      dias: porDia(eventos, r).map((x) => ({ fecha: x.fecha, titulo: diaLargo(x.fecha), eventos: x.eventos.map(paraApp) })),
      fallos: fallos.map((f) => ({ proveedor: f.proveedor, nombre: nombreDe(f.proveedor), siguiente: f.siguiente })),
      honesto: true,
    });
  });

  app.get('/api/calendario/libres', d.exigirMesa, d.limitar(30), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    const c = await conectados(q);
    if (!c.leidas || !c.proveedores.length) return res.status(c.leidas ? 409 : 503).json({ error: c.leidas ? 'No tienes calendario conectado.' : 'No pude leer tus calendarios.', honesto: true });
    const r = rangoDe(String(req.query.cuando || 'hoy'), reloj());
    if (!r) return res.status(400).json({ error: 'No entendí qué día.', honesto: true });
    const minutos = Math.min(Math.max(Math.round(Number(req.query.minutos) || 30), 5), MAX_DURACION_MIN);
    const { eventos, fallos } = await eventosDe(q, c, r);
    if (fallos.length === c.proveedores.length) return res.status(502).json({ error: 'No pude leer tu calendario.', honesto: true });
    return res.json({ minutos, dias: r.fechas.slice(0, 7).map((fecha) => ({ fecha, libres: huecosLibres(eventos, fecha, minutos, { ahora: reloj() }) })), incompleto: fallos.length > 0, honesto: true });
  });

  /** Lo que la app manda para crear o mover: inicio y fin (o minutos), ya en hora de Honduras o con zona. */
  const horario = (b: any): { inicio: number; fin: number } | null => {
    const inicio = inicioDe(b?.inicio);
    if (inicio === null) return null;
    const finX = inicioDe(b?.fin);
    const fin = finX ?? inicio + Math.min(Math.max(Math.round(Number(b?.minutos) || 60), 5), MAX_DURACION_MIN) * 60_000;
    return fin > inicio && fin - inicio <= MAX_DURACION_MIN * 60_000 ? { inicio, fin } : null;
  };
  // Como /api/correo/enviar: lo confirmó en un aviso explícito de la app. Sin `confirmado: true`, nada cambia (428).
  const sinConfirmar = (res: express.Response) => res.status(428).json({ error: 'Falta confirmarlo en la app.', code: 'confirmacion_requerida', honesto: true });

  app.post('/api/calendario/eventos', d.exigirMesa, d.limitar(10), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    if (req.body?.confirmado !== true) return sinConfirmar(res);
    const p = proveedorDe(req.body?.proveedor) || (await conectados(q)).proveedores[0];
    const h = horario(req.body);
    const titulo = String(req.body?.titulo || '').trim().slice(0, 200);
    if (!p || !h || !titulo) return res.status(400).json({ error: 'Faltan el título, la hora o el calendario.', honesto: true });
    const idem = String(req.body?.idempotencia || '').slice(0, 80) || crypto.randomUUID();
    try {
      const ev = await conAcceso(q, p, (acceso) => crearEvento(p, acceso, { titulo, ...h, ...(req.body?.lugar ? { lugar: String(req.body.lugar).slice(0, 200) } : {}), idempotencia: idem }, traer()), { traer: traer(), ahora: reloj });
      anotarEfectoReal(q, { canal: 'calendario', estado: 'confirmado', destino: titulo });
      return res.json({ evento: paraApp(ev), repetido: !!ev.repetido, honesto: true });
    } catch (e) {
      return errorJson(res, e);
    }
  });

  app.patch('/api/calendario/eventos/:proveedor/:id', d.exigirMesa, d.limitar(10), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    if (req.body?.confirmado !== true) return sinConfirmar(res);
    const p = proveedorDe(req.params.proveedor);
    const h = horario(req.body);
    if (!p || !h) return res.status(400).json({ error: 'Faltan el calendario o la hora nueva.', honesto: true });
    try {
      const ev = await conAcceso(q, p, (acceso) => moverEvento(p, acceso, req.params.id, h.inicio, h.fin, traer()), { traer: traer(), ahora: reloj });
      return res.json({ evento: paraApp(ev), honesto: true });
    } catch (e) {
      return errorJson(res, e);
    }
  });

  app.delete('/api/calendario/eventos/:proveedor/:id', d.exigirMesa, d.limitar(10), async (req, res) => {
    const q = quienDe(req);
    if (!q) return sinSesion(res);
    if (req.query.confirmado !== '1' && req.body?.confirmado !== true) return sinConfirmar(res);
    const p = proveedorDe(req.params.proveedor);
    if (!p) return res.status(400).json({ error: 'Ese calendario no existe.', honesto: true });
    try {
      await conAcceso(q, p, (acceso) => borrarEvento(p, acceso, req.params.id, traer()), { traer: traer(), ahora: reloj });
      return res.json({ ok: true, honesto: true });
    } catch (e) {
      return errorJson(res, e);
    }
  });
}

/** Pruebas. */
export function _olvidarCalendario() {
  PROPUESTAS.clear();
  AVISOS.clear();
  CODIGOS_MS.clear();
  PEDIDOS_GOOGLE.clear();
}
