/**
 * EL «SÍ» O EL «NO» DEL CHAT, AL EMPEZAR EL TURNO (server.ts, prepararTurno): lo que esperaba la decisión de la
 * persona —un correo o un WhatsApp que AURA dejó en borrador, la pregunta de su computadora— lo resuelve el
 * SERVIDOR aquí, no el modelo, y vuelve el HECHO para que AURA lo diga.
 *
 * Permisos exactos (revisión externa, 4-oct): un «sí» contesta UNA decisión exacta. Con varias esperando a la vez (un
 * correo para Ana y un WhatsApp para Bruno, la pregunta de su computadora, lo que espera la app), un «sí» suelto no se
 * aplica a «lo que haya»: solo vale si nombra exactamente una (por su canal o por a quién va); si no, no se hace
 * ninguna y se le pregunta cuál.
 *
 * Exportado aparte para probarlo con efectos simulados (tests/permisos-exactos.test.ts).
 */
import { borradorDe, resolverBorrador, respuestaAlBorrador } from './correo';
import { borradorWhatsappDe, destinoWhatsapp, resolverBorradorWhatsapp, whatsappPermitido } from './whatsapp';
import { preguntasComputadora, resolverPreguntaComputadora, respuestaSiNo } from './computadora';
import { cerrarDecisionPorChat, clasificarEnvio, type SalidaEnvio } from './trabajos';
import type { RetencionAcciones } from './voz-agente';

/** Lo que la app (PULSE2CHAT) tiene esperando el «sí» de un turno anterior: un mensaje, una llamada, un recordatorio. */
export type AppEsperando = { que: string; para: string };

export type OpcionesDecisionTurno = {
  /** De quién es la decisión (la sesión del turno). */
  dueno: string;
  /** La conversación (el aparato, la web, la voz): los borradores son de una persona EN una conversación. */
  ambito: string;
  mensaje: string;
  /** En la voz el efecto espera a que el turno se confirme. */
  retener?: RetencionAcciones;
  /** ¿Esta cuenta tiene su WhatsApp aquí? (whatsappPermitido). */
  whatsapp: boolean;
  /** ¿La app (PULSE2CHAT) tiene un borrador de un turno anterior esperando su «sí»? (pendienteAnterior). */
  appEspera?: boolean;
  /** Qué espera la app (su borrador o su propuesta de un turno anterior), para saber si un «sí» es ambiguo. */
  app?: AppEsperando | null;
  /** Persistir antes de actuar (server/turno-unico.ts efectoDelTurno('decision')): false = no se resuelve nada. */
  registrarEfecto: () => Promise<boolean>;
};

export type SalidaDecisionTurno = {
  hechos: string[];
  turnoVigente: boolean;
  delCorreo: string | null;
  delWhatsapp: string | null;
  deLaPregunta: string | null;
  /** Dijo «sí» con varias cosas esperando y sin decir cuál: no se hizo ninguna. */
  ambiguo: boolean;
  /** Lo que espera la app NO se hace en este turno (el «sí» fue ambiguo, o nombró otra cosa). */
  appBloqueada: boolean;
};

/* ------------------------------------------------------------------ ¿a qué contesta este «sí»? */

/** Una decisión que espera su «sí» en esta conversación. `para`: a quién va (o lo que pregunta su computadora). */
export type PendienteTurno = { tipo: 'correo' | 'whatsapp' | 'computadora' | 'app'; para: string; que?: string };

/**
 * Lo que un «sí» del chat podría resolver en este turno, en esta conversación: el borrador de correo y el de WhatsApp
 * (los que el chat todavía resuelve: no los apartados para el panel), cada pregunta de su computadora y lo que espera
 * la app.
 */
export function pendientesDelTurno(o: { dueno: string; ambito: string; whatsapp: boolean; app?: AppEsperando | null }): PendienteTurno[] {
  if (!o.dueno) return [];
  const out: PendienteTurno[] = [];
  const c = borradorDe(o.dueno, o.ambito);
  if (c && !c.soloPanel) out.push({ tipo: 'correo', para: c.para.join(', ') });
  const w = o.whatsapp ? borradorWhatsappDe(o.dueno, o.ambito) : null;
  if (w && !w.soloPanel) out.push({ tipo: 'whatsapp', para: destinoWhatsapp(w) });
  for (const p of preguntasComputadora(o.dueno)) out.push({ tipo: 'computadora', para: p.texto });
  if (o.app) out.push({ tipo: 'app', para: o.app.para, que: o.app.que });
  return out;
}

const normal = (s: string) =>
  ` ${String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ@.+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;

/** Cómo se nombra cada cosa al decir cuál: «sí, el correo», «el de WhatsApp», «lo de la computadora». */
const NOMBRES: Record<PendienteTurno['tipo'], RegExp> = {
  correo: / (correo|mail|email|e mail|imeil)s? /,
  whatsapp: / (whats ?app|wasap|guasap|wsp|whats) /,
  computadora: / (computadora|compu|pc|maquina|ordenador) /,
  app: / (pulse|pulse2chat|llamada|llamar|llamale|recordatorio|recordatorios) /,
};
/** Palabras que salen en cualquier destino o pregunta: no sirven para decir cuál. */
const COMUNES = new Set('com net org test example gmail hotmail outlook yahoo para por con que los las del una uno voy tocar toco hago enviar envio mandar boton sigo with the and'.split(' '));

/** ¿El mensaje nombra ESTA decisión (por su canal o por a quién va)? */
function nombra(q: string, p: PendienteTurno): boolean {
  if (NOMBRES[p.tipo].test(q)) return true;
  const fichas = normal(p.para)
    .split(/[\s@.+]+/)
    .filter((x) => x.length >= 3 && !COMUNES.has(x) && !/^\d+$/.test(x));
  return fichas.some((f) => q.includes(` ${f} `));
}

/**
 * Con varias decisiones esperando, un «sí» solo vale si nombra exactamente una (por su canal o por a quién va); si no,
 * es ambiguo. Antes se aplicaba a todas (mandaba el correo Y el WhatsApp) o a la primera que hubiera.
 */
/**
 * ¿El camino rápido de la app (server.ts ordenDeApp) NO puede resolver este turno? Si además de lo que espera la app
 * espera otra decisión en el servidor, el «sí» lo decide el turno completo.
 */
export function atajoDeAppBloqueado(o: { dueno: string; ambito: string; whatsapp: boolean; appEspera: boolean; mensaje?: string; contexto?: unknown }): boolean {
  return o.appEspera && pendientesDelTurno({ dueno: o.dueno, ambito: o.ambito, whatsapp: o.whatsapp }).length > 0;
}

export function elegirPendiente(mensaje: string, ps: PendienteTurno[]): { tipo: 'uno'; p: PendienteTurno } | { tipo: 'ninguno' } | { tipo: 'ambiguo' } {
  if (!ps.length) return { tipo: 'ninguno' };
  if (ps.length === 1) return { tipo: 'uno', p: ps[0] };
  const q = normal(mensaje);
  const nombrados = ps.filter((p) => nombra(q, p));
  return nombrados.length === 1 ? { tipo: 'uno', p: nombrados[0] } : { tipo: 'ambiguo' };
}

function decirPendiente(p: PendienteTurno): string {
  if (p.tipo === 'correo') return `el correo a ${p.para}`;
  if (p.tipo === 'whatsapp') return `el WhatsApp a ${p.para}`;
  if (p.tipo === 'computadora') return `lo que pregunta su computadora («${p.para}»)`;
  if (p.que === 'llamar' || p.que === 'llamada') return `la llamada a ${p.para}`;
  return p.que === 'mensaje' ? `el mensaje del chat para ${p.para}` : `el recordatorio «${p.para}»`;
}

/* ------------------------------------------------------------------ el turno */

export async function resolverDecisionesDelTurno(o: OpcionesDecisionTurno): Promise<SalidaDecisionTurno> {
  const { dueno, ambito, mensaje: message, retener } = o;
  const hechos: string[] = [];
  // Un «sí» puede mandar un borrador o soltar a su computadora: antes se deja anotado en el turno durable
  // (AUR06, persistir antes de actuar). Si este proceso ya no es el dueño del turno, no se resuelve nada aquí.
  // El «sí» de su computadora tiene sus propias palabras (respuestaSiNo: «yes», «hazlo»…): también cuenta.
  const diceSi = respuestaAlBorrador(message) === 'si' || respuestaSiNo(message) === 'si';
  const turnoVigente = dueno && diceSi ? await o.registrarEfecto() : true;
  if (!turnoVigente) hechos.push('HECHO: este turno no quedó registrado para mandar nada (o ya lo atiende otro proceso del servidor). NO se mandó ningún borrador ni se soltó la computadora. No digas que se envió: dile que lo intente otra vez en un momento.');
  // Permisos exactos (4-oct): ¿a QUÉ contesta este «sí»? Con varias decisiones esperando, solo a la que nombre.
  const pendientes = dueno && turnoVigente && diceSi ? pendientesDelTurno({ dueno, ambito, whatsapp: o.whatsapp, app: o.app }) : [];
  const eleccion = pendientes.length > 1 ? elegirPendiente(message, pendientes) : null;
  if (eleccion?.tipo === 'ambiguo') {
    hechos.push(
      `HECHO: dijo «sí», pero hay ${pendientes.length} cosas esperando su decisión: ${pendientes.map((p, i) => `${i + 1}) ${decirPendiente(p)}`).join('; ')}. ` +
        'Su «sí» no dice a cuál: NO hice ninguna (no se mandó nada ni se le contestó a su computadora). Pregúntale cuál —que diga, por ejemplo, «sí, el correo» o a quién va—; un «sí» suelto no decide.'
    );
    return { hechos, turnoVigente: !!turnoVigente, delCorreo: null, delWhatsapp: null, deLaPregunta: null, ambiguo: true, appBloqueada: !!o.app };
  }
  const solo = eleccion?.tipo === 'uno' ? eleccion.p.tipo : null;
  const toca = (t: PendienteTurno['tipo']) => !solo || solo === t;
  // En la voz el envío espera a que el turno se confirme (retener): un «sí…» especulativo no manda.
  // El borrador que esperaba (su id de intento): si el chat lo resuelve, su decisión del panel se cierra con
  // lo que pasó (AUR08, sin doble efecto). En la voz no: el envío espera a que se confirme el turno, y el
  // panel lo verá como «ya no está esperando» sin decir que se envió.
  const intentoCorreo = dueno && turnoVigente && !retener ? borradorDe(dueno, ambito)?.intento : undefined;
  const intentoWhatsapp = dueno && turnoVigente && !retener ? borradorWhatsappDe(dueno, ambito)?.intento : undefined;
  const delCorreo = dueno && turnoVigente && toca('correo') ? await resolverBorrador(dueno, ambito, message, retener) : null;
  if (delCorreo) hechos.push(delCorreo);
  // Si el mismo borrador sigue esperando (hay que confirmar a quién va, o repetir un envío incierto), su decisión del
  // panel queda abierta: no se cierra como si se hubiera decidido.
  const sigueCorreo = !!intentoCorreo && borradorDe(dueno, ambito)?.intento === intentoCorreo;
  if (delCorreo && intentoCorreo && !sigueCorreo) void cerrarDecisionPorChat(dueno, intentoCorreo, respuestaAlBorrador(message), delCorreo).catch(() => undefined);
  // Lo mismo con un mensaje de WhatsApp que esperaba su «sí» (server/whatsapp.ts).
  const delWhatsapp = dueno && turnoVigente && o.whatsapp && toca('whatsapp') ? await resolverBorradorWhatsapp(dueno, ambito, message, retener) : null;
  if (delWhatsapp) hechos.push(delWhatsapp);
  const sigueWhatsapp = !!intentoWhatsapp && borradorWhatsappDe(dueno, ambito)?.intento === intentoWhatsapp;
  if (delWhatsapp && intentoWhatsapp && !sigueWhatsapp) void cerrarDecisionPorChat(dueno, intentoWhatsapp, respuestaAlBorrador(message), delWhatsapp).catch(() => undefined);
  // Su computadora se detuvo a pedir su sí (o le ofreció seguir): el «sí» o el «no» lo resuelve el servidor
  // (server/computadora.ts). Si había un borrador esperando, ese «sí» era para el borrador.
  const deLaPregunta = dueno && turnoVigente && toca('computadora') && !delCorreo && !delWhatsapp ? await resolverPreguntaComputadora(dueno, message, retener) : null;
  if (deLaPregunta) hechos.push(deLaPregunta);
  // Un «sí» que no tiene a qué contestar (el borrador venció, el servidor se reinició o nunca se armó): que
  // el modelo no lo tome por un envío y diga «enviado» por el historial (José, 3-oct).
  if (turnoVigente && !delCorreo && !delWhatsapp && !deLaPregunta && respuestaAlBorrador(message) === 'si' && !o.appEspera && !o.app) {
    const apartado = dueno && (borradorDe(dueno, ambito)?.soloPanel || borradorWhatsappDe(dueno, ambito)?.soloPanel);
    hechos.push(
      apartado
        ? 'HECHO: si su «sí» era para el borrador de antes: ese ya no se resuelve por el chat (siguió con otra cosa en medio). NO se mandó nada. Está en su panel de tareas, por si lo quiere aprobar ahí; o arma uno nuevo y vuelve a preguntar. No digas que se envió.'
        : 'HECHO: si su «sí» era para mandar un mensaje o un correo: ahora no hay ningún borrador esperando (venció o no se armó). NO se mandó nada. No digas que se envió: pregúntale qué quiere mandar y a quién.'
    );
  }
  return { hechos, turnoVigente: !!turnoVigente, delCorreo, delWhatsapp, deLaPregunta, ambiguo: false, appBloqueada: !!o.app && !!solo && solo !== 'app' };
}

/**
 * «Aprobar» o «Rechazar» desde el panel: el MISMO camino que el «sí»/«no» del chat (server/correo.ts y
 * server/whatsapp.ts, que vuelven a mirar vigencia y dueño justo antes de mandar), pero solo si el borrador
 * que espera es exactamente el aprobado: su id de intento y la huella que mostró la tarjeta (destinatario o chat,
 * cuenta y contenido; revisión 4-oct). Si cambió, no se toca nada (`stale`).
 */
export async function resolverBorradorDesdePanel(correo: string, canal: 'correo' | 'whatsapp', ambito: string, intento: string, respuesta: 'sí' | 'no', huella?: string): Promise<SalidaEnvio> {
  const b = canal === 'correo' ? borradorDe(correo, ambito) : borradorWhatsappDe(correo, ambito);
  if (!b || b.intento !== intento) return { estado: 'stale', resumen: 'El borrador ya no era el aprobado; no se envió nada.' };
  if (respuesta === 'sí' && (!huella || !b.huella || b.huella !== huella)) return { estado: 'stale', resumen: 'Lo que espera ya no es lo que aprobaste (otro destinatario, cuenta o contenido); no se envió nada.' };
  if (canal === 'whatsapp' && !whatsappPermitido(correo)) return { estado: 'failed', resumen: 'WHATSAPP: no lo mandé: esta cuenta ya no tiene su WhatsApp.' };
  const como = { desdePanel: true, ...(huella ? { huella } : {}) };
  const hecho = canal === 'correo' ? await resolverBorrador(correo, ambito, respuesta, undefined, como) : await resolverBorradorWhatsapp(correo, ambito, respuesta, undefined, como);
  if (hecho === null) return { estado: 'stale', resumen: 'El borrador ya no estaba esperando; no se envió nada.' };
  return { estado: respuesta === 'no' ? 'failed' : clasificarEnvio(hecho), resumen: hecho };
}
