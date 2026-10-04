/**
 * EL «SÍ» O EL «NO» DEL CHAT, AL EMPEZAR EL TURNO (server.ts, prepararTurno): lo que esperaba la decisión de la
 * persona —un correo o un WhatsApp que AURA dejó en borrador, la pregunta de su computadora, lo que espera la app— lo
 * resuelve el SERVIDOR aquí, no el modelo, y vuelve el HECHO para que AURA lo diga.
 *
 * Permisos exactos: la decisión la toma la REGLA ÚNICA (lib/afirmacion.ts, decidirPendiente). Una decisión se ejecuta
 * solo si el mensaje es una afirmación pura con una sola esperando, o si nombra exactamente esa (destinatario, canal,
 * hora). Lo demás pregunta. Las negativas pasan por la misma selección: «no» suelto con varias esperando pregunta cuál;
 * «no, el correo» descarta solo el correo.
 *
 * Exportado aparte para probarlo con efectos simulados (tests/permisos-exactos.test.ts, tests/permisos-ronda3.test.ts).
 */
import { borradorDe, resolverBorrador } from './correo';
import { borradorWhatsappDe, destinoWhatsapp, resolverBorradorWhatsapp, whatsappPermitido } from './whatsapp';
import { preguntasComputadora, resolverPreguntaComputadora } from './computadora';
import { cerrarDecisionPorChat, clasificarEnvio, type SalidaEnvio } from './trabajos';
import { analizarRespuesta, decidirPendiente, type DecisionPendiente, type TipoDecision } from '../lib/afirmacion';
import type { RetencionAcciones } from './voz-agente';

/** Lo que la app (PULSE2CHAT) tiene esperando el «sí» de un turno anterior: un mensaje, una llamada, un recordatorio. */
export type AppEsperando = { que: string; para: string; cuando?: number };

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
  /** Qué espera la app (su borrador o su propuesta de un turno anterior, o lo escrito en el chat abierto). */
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
  /** No se hizo ninguna: varias esperando sin decir cuál, o lo nombrado no coincide con ninguna. */
  ambiguo: boolean;
  /** Lo que espera la app NO se hace en este turno (el mensaje fue ambiguo, no coincide, o eligió otra cosa). */
  appBloqueada: boolean;
  /** La regla única eligió una decisión y la respondió (sí o no): el mensaje era la respuesta, no otra orden. */
  respondio: boolean;
};

/* ------------------------------------------------------------------ lo que espera en esta conversación */

/** Una decisión que espera su «sí» en esta conversación (la forma de la regla única, más de dónde viene). */
export type PendienteTurno = DecisionPendiente & { origen: 'correo' | 'whatsapp' | 'computadora' | 'app' };

const TIPO_APP: Record<string, TipoDecision> = { mensaje: 'mensaje', borrador: 'chat', llamar: 'llamar', recordatorio: 'recordatorio', cancelar_recordatorio: 'cancelar_recordatorio' };

/**
 * Lo que un «sí» o un «no» del chat podría resolver en este turno, en esta conversación: el borrador de correo y el de
 * WhatsApp (los que el chat todavía resuelve: no los apartados para el panel), cada pregunta de su computadora (de esta
 * conversación) y lo que espera la app. Lo escrito a mano en el chat abierto es «discreto»: solo cuenta si el mensaje
 * pide enviar o lo nombra.
 */
export function pendientesDelTurno(o: { dueno: string; ambito: string; whatsapp: boolean; app?: AppEsperando | null }): PendienteTurno[] {
  if (!o.dueno) return [];
  const out: PendienteTurno[] = [];
  const c = borradorDe(o.dueno, o.ambito);
  if (c && !c.soloPanel) {
    // Cuarta ronda: a varios, cada uno cuenta (nombrar solo a una parte no lo elige); a la persona misma, «a mí» coincide.
    const propia = c.para.length > 0 && c.para.every((x) => x.trim().toLowerCase() === o.dueno.trim().toLowerCase());
    out.push({ origen: 'correo', tipo: 'correo', destino: `${(c.nombres || []).join(' ')} ${c.para.join(' ')}`.trim(), ...(c.para.length > 1 ? { destinatarios: [...c.para] } : {}), ...(propia ? { propia: true } : {}), id: c.intento });
  }
  const w = o.whatsapp ? borradorWhatsappDe(o.dueno, o.ambito) : null;
  if (w && !w.soloPanel) out.push({ origen: 'whatsapp', tipo: 'whatsapp', destino: `${destinoWhatsapp(w)} ${w.chat}`, id: w.intento });
  for (const p of preguntasComputadora(o.dueno, o.ambito)) out.push({ origen: 'computadora', tipo: 'computadora', texto: p.texto, id: p.tareaId });
  if (o.app) {
    const tipo = TIPO_APP[o.app.que] ?? 'mensaje';
    out.push({ origen: 'app', tipo, destino: o.app.para, ...(tipo === 'recordatorio' || tipo === 'cancelar_recordatorio' ? { texto: o.app.para } : {}), ...(o.app.cuando ? { cuando: o.app.cuando } : {}), ...(tipo === 'chat' ? { discreta: true } : {}) });
  }
  return out;
}

function decirPendiente(p: PendienteTurno): string {
  if (p.origen === 'correo') return `el correo a ${p.destino}`;
  if (p.origen === 'whatsapp') return `el WhatsApp a ${p.destino}`;
  if (p.origen === 'computadora') return `lo que pregunta su computadora («${p.texto}»)`;
  if (p.tipo === 'llamar') return `la llamada a ${p.destino}`;
  if (p.tipo === 'chat') return `lo que está escrito en el chat de ${p.destino}`;
  if (p.tipo === 'mensaje') return `el mensaje del chat para ${p.destino}`;
  return `el recordatorio «${p.texto}»`;
}

/**
 * ¿El camino rápido de la app (server.ts ordenDeApp) NO puede resolver este turno? Si espera otra decisión en el
 * servidor (un correo, un WhatsApp, la pregunta de su computadora en esta conversación) y el mensaje responde a algo
 * (un sí, un no, un «mándalo») o la app tiene algo esperando, lo decide el turno completo con la regla única. (Además,
 * el atajo mismo solo ejecuta con una afirmación pura: lo que nombra algo siempre va al turno completo.)
 */
export function atajoDeAppBloqueado(o: { dueno: string; ambito: string; whatsapp: boolean; appEspera: boolean; mensaje?: string; contexto?: { borrador?: string | null } | null }): boolean {
  if (!pendientesDelTurno({ dueno: o.dueno, ambito: o.ambito, whatsapp: o.whatsapp }).length) return false;
  const a = analizarRespuesta(String(o.mensaje || ''));
  return o.appEspera || !!String(o.contexto?.borrador || '').trim() || a.afirma || a.niega;
}

/* ------------------------------------------------------------------ el turno */

export async function resolverDecisionesDelTurno(o: OpcionesDecisionTurno): Promise<SalidaDecisionTurno> {
  const { dueno, ambito, mensaje: message, retener } = o;
  const hechos: string[] = [];
  const nada = (extra: Partial<SalidaDecisionTurno> = {}): SalidaDecisionTurno => ({ hechos, turnoVigente: true, delCorreo: null, delWhatsapp: null, deLaPregunta: null, ambiguo: false, appBloqueada: false, respondio: false, ...extra });
  if (!dueno) return nada();
  const pendientes = pendientesDelTurno({ dueno, ambito, whatsapp: o.whatsapp, app: o.app });
  const d = decidirPendiente(message, pendientes);
  const efecto = d.tipo === 'ejecutar' && d.p.origen !== 'app';
  // Un «sí» que va a mandar un borrador o soltar a su computadora: antes se deja anotado en el turno durable (AUR06,
  // persistir antes de actuar). Si este proceso ya no es el dueño del turno, no se resuelve nada aquí.
  const turnoVigente = efecto ? await o.registrarEfecto() : true;
  if (!turnoVigente) {
    hechos.push('HECHO: este turno no quedó registrado para mandar nada (o ya lo atiende otro proceso del servidor). NO se mandó ningún borrador ni se soltó la computadora. No digas que se envió: dile que lo intente otra vez en un momento.');
    return nada({ turnoVigente: false, appBloqueada: !!o.app });
  }
  if (d.tipo === 'preguntar') {
    const una = d.candidatos.length === 1;
    const lista = una ? decirPendiente(d.candidatos[0]) : d.candidatos.map((p, i) => `${i + 1}) ${decirPendiente(p)}`).join('; ');
    const espera = una ? `lo que espera su decisión es ${lista}` : `lo que espera su decisión son ${d.candidatos.length} cosas: ${lista}`;
    const dijo = d.analisis.niega ? '«no»' : '«sí»';
    hechos.push(
      d.motivo === 'ambiguo'
        ? `HECHO: dijo ${dijo} («${message.slice(0, 80)}»), pero ${espera}. Su respuesta no dice a cuál: NO hice ninguna (no se mandó, no se descartó ni se le contestó nada). Pregúntale cuál —que diga, por ejemplo, «sí, el correo» o a quién va—.`
        : d.motivo === 'aclarar'
          ? `HECHO: dijo «${message.slice(0, 80)}», y ${espera}. No queda claro si es su respuesta (es una pregunta, o un «no» que nombra a alguien y puede ser una corrección): NO hice nada (no se mandó ni se descartó). Pregúntale qué quiere —que confirme con un «sí» o diga qué cambiar—.`
          : `HECHO: dijo «${message.slice(0, 80)}», pero ${espera}, y lo que nombró no coincide (otra persona, el propio, otro canal, otra hora, solo una parte de los destinatarios o varios a la vez). NO hice nada. Pregúntale si es eso lo que quiere —que lo diga— o qué otra cosa quería.`
    );
    return nada({ ambiguo: true, appBloqueada: !!o.app });
  }
  // Lo que decidió la regla, o nada: con `nada` (no respondió a lo que espera, o cambió de tema) cada borrador recibe el
  // mensaje tal cual y queda apartado para el panel, como siempre.
  const elegido = d.tipo === 'ejecutar' || d.tipo === 'no' ? d.p : null;
  const respuesta = d.tipo === 'ejecutar' ? 'sí' : d.tipo === 'no' ? 'no' : message;
  const toca = (origen: PendienteTurno['origen']) => !elegido || elegido.origen === origen;
  // En la voz el envío espera a que el turno se confirme (retener): un «sí…» especulativo no manda.
  // El borrador que esperaba (su id de intento): si el chat lo resuelve, su decisión del panel se cierra con
  // lo que pasó (AUR08, sin doble efecto). En la voz no: el envío espera a que se confirme el turno.
  const decision = d.tipo === 'ejecutar' ? ('si' as const) : d.tipo === 'no' ? ('no' as const) : null;
  const intentoCorreo = !retener ? borradorDe(dueno, ambito)?.intento : undefined;
  const intentoWhatsapp = !retener ? borradorWhatsappDe(dueno, ambito)?.intento : undefined;
  const delCorreo = toca('correo') ? await resolverBorrador(dueno, ambito, respuesta, retener) : null;
  if (delCorreo) hechos.push(delCorreo);
  // Si el mismo borrador sigue esperando (hay que confirmar a quién va, o repetir un envío incierto), su decisión del
  // panel queda abierta: no se cierra como si se hubiera decidido.
  const sigueCorreo = !!intentoCorreo && borradorDe(dueno, ambito)?.intento === intentoCorreo;
  if (delCorreo && intentoCorreo && !sigueCorreo) void cerrarDecisionPorChat(dueno, intentoCorreo, decision, delCorreo).catch(() => undefined);
  const delWhatsapp = o.whatsapp && toca('whatsapp') ? await resolverBorradorWhatsapp(dueno, ambito, respuesta, retener) : null;
  if (delWhatsapp) hechos.push(delWhatsapp);
  const sigueWhatsapp = !!intentoWhatsapp && borradorWhatsappDe(dueno, ambito)?.intento === intentoWhatsapp;
  if (delWhatsapp && intentoWhatsapp && !sigueWhatsapp) void cerrarDecisionPorChat(dueno, intentoWhatsapp, decision, delWhatsapp).catch(() => undefined);
  // Su computadora se detuvo a pedir su sí (o le ofreció seguir): solo la que eligió la regla (o, sin elección, como
  // siempre: un mensaje que no es respuesta no la toca).
  const elegida = elegido?.origen === 'computadora' ? elegido.id : undefined;
  const deLaPregunta = toca('computadora') && !delCorreo && !delWhatsapp ? await resolverPreguntaComputadora(dueno, respuesta, retener, { ambito, ...(elegida ? { elegida } : {}) }) : null;
  if (deLaPregunta) hechos.push(deLaPregunta);
  // Un «sí» que no tiene a qué contestar (el borrador venció, el servidor se reinició o nunca se armó): que
  // el modelo no lo tome por un envío y diga «enviado» por el historial (José, 3-oct).
  if (!pendientes.length && d.analisis.pura && !o.appEspera && !o.app) {
    const apartado = borradorDe(dueno, ambito)?.soloPanel || borradorWhatsappDe(dueno, ambito)?.soloPanel;
    hechos.push(
      apartado
        ? 'HECHO: si su «sí» era para el borrador de antes: ese ya no se resuelve por el chat (siguió con otra cosa en medio). NO se mandó nada. Está en su panel de tareas, por si lo quiere aprobar ahí; o arma uno nuevo y vuelve a preguntar. No digas que se envió.'
        : 'HECHO: si su «sí» era para mandar un mensaje o un correo: ahora no hay ningún borrador esperando (venció o no se armó). NO se mandó nada. No digas que se envió: pregúntale qué quiere mandar y a quién.'
    );
  }
  return nada({ delCorreo, delWhatsapp, deLaPregunta, appBloqueada: !!o.app && !!elegido && elegido.origen !== 'app', respondio: !!elegido });
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
