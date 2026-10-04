/**
 * EL «SÍ» O EL «NO» DEL CHAT, AL EMPEZAR EL TURNO (server.ts, prepararTurno): lo que esperaba la decisión de la
 * persona —un correo o un WhatsApp que AURA dejó en borrador, la pregunta de su computadora— lo resuelve el
 * SERVIDOR aquí, no el modelo, y vuelve el HECHO para que AURA lo diga.
 *
 * Exportado aparte para probarlo con efectos simulados (tests/permisos-exactos.test.ts).
 */
import { borradorDe, resolverBorrador, respuestaAlBorrador } from './correo';
import { borradorWhatsappDe, resolverBorradorWhatsapp, whatsappPermitido } from './whatsapp';
import { resolverPreguntaComputadora, respuestaSiNo } from './computadora';
import { cerrarDecisionPorChat, clasificarEnvio, type SalidaEnvio } from './trabajos';
import type { RetencionAcciones } from './voz-agente';

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
  /** Persistir antes de actuar (server/turno-unico.ts efectoDelTurno('decision')): false = no se resuelve nada. */
  registrarEfecto: () => Promise<boolean>;
};

export type SalidaDecisionTurno = {
  hechos: string[];
  turnoVigente: boolean;
  delCorreo: string | null;
  delWhatsapp: string | null;
  deLaPregunta: string | null;
};

export async function resolverDecisionesDelTurno(o: OpcionesDecisionTurno): Promise<SalidaDecisionTurno> {
  const { dueno, ambito, mensaje: message, retener } = o;
  const hechos: string[] = [];
  // Un «sí» puede mandar un borrador o soltar a su computadora: antes se deja anotado en el turno durable
  // (AUR06, persistir antes de actuar). Si este proceso ya no es el dueño del turno, no se resuelve nada aquí.
  // El «sí» de su computadora tiene sus propias palabras (respuestaSiNo: «yes», «hazlo»…): también cuenta.
  const diceSi = respuestaAlBorrador(message) === 'si' || respuestaSiNo(message) === 'si';
  const turnoVigente = dueno && diceSi ? await o.registrarEfecto() : true;
  if (!turnoVigente) hechos.push('HECHO: este turno no quedó registrado para mandar nada (o ya lo atiende otro proceso del servidor). NO se mandó ningún borrador ni se soltó la computadora. No digas que se envió: dile que lo intente otra vez en un momento.');
  // En la voz el envío espera a que el turno se confirme (retener): un «sí…» especulativo no manda.
  // El borrador que esperaba (su id de intento): si el chat lo resuelve, su decisión del panel se cierra con
  // lo que pasó (AUR08, sin doble efecto). En la voz no: el envío espera a que se confirme el turno, y el
  // panel lo verá como «ya no está esperando» sin decir que se envió.
  const intentoCorreo = dueno && turnoVigente && !retener ? borradorDe(dueno, ambito)?.intento : undefined;
  const intentoWhatsapp = dueno && turnoVigente && !retener ? borradorWhatsappDe(dueno, ambito)?.intento : undefined;
  const delCorreo = dueno && turnoVigente ? await resolverBorrador(dueno, ambito, message, retener) : null;
  if (delCorreo) hechos.push(delCorreo);
  // Si el mismo borrador sigue esperando (hay que confirmar a quién va, o repetir un envío incierto), su decisión del
  // panel queda abierta: no se cierra como si se hubiera decidido.
  const sigueCorreo = !!intentoCorreo && borradorDe(dueno, ambito)?.intento === intentoCorreo;
  if (delCorreo && intentoCorreo && !sigueCorreo) void cerrarDecisionPorChat(dueno, intentoCorreo, respuestaAlBorrador(message), delCorreo).catch(() => undefined);
  // Lo mismo con un mensaje de WhatsApp que esperaba su «sí» (server/whatsapp.ts).
  const delWhatsapp = dueno && turnoVigente && o.whatsapp ? await resolverBorradorWhatsapp(dueno, ambito, message, retener) : null;
  if (delWhatsapp) hechos.push(delWhatsapp);
  const sigueWhatsapp = !!intentoWhatsapp && borradorWhatsappDe(dueno, ambito)?.intento === intentoWhatsapp;
  if (delWhatsapp && intentoWhatsapp && !sigueWhatsapp) void cerrarDecisionPorChat(dueno, intentoWhatsapp, respuestaAlBorrador(message), delWhatsapp).catch(() => undefined);
  // Su computadora se detuvo a pedir su sí (o le ofreció seguir): el «sí» o el «no» lo resuelve el servidor
  // (server/computadora.ts). Si había un borrador esperando, ese «sí» era para el borrador.
  const deLaPregunta = dueno && turnoVigente && !delCorreo && !delWhatsapp ? await resolverPreguntaComputadora(dueno, message, retener) : null;
  if (deLaPregunta) hechos.push(deLaPregunta);
  // Un «sí» que no tiene a qué contestar (el borrador venció, el servidor se reinició o nunca se armó): que
  // el modelo no lo tome por un envío y diga «enviado» por el historial (José, 3-oct).
  if (turnoVigente && !delCorreo && !delWhatsapp && !deLaPregunta && respuestaAlBorrador(message) === 'si' && !o.appEspera) {
    const apartado = dueno && (borradorDe(dueno, ambito)?.soloPanel || borradorWhatsappDe(dueno, ambito)?.soloPanel);
    hechos.push(
      apartado
        ? 'HECHO: si su «sí» era para el borrador de antes: ese ya no se resuelve por el chat (siguió con otra cosa en medio). NO se mandó nada. Está en su panel de tareas, por si lo quiere aprobar ahí; o arma uno nuevo y vuelve a preguntar. No digas que se envió.'
        : 'HECHO: si su «sí» era para mandar un mensaje o un correo: ahora no hay ningún borrador esperando (venció o no se armó). NO se mandó nada. No digas que se envió: pregúntale qué quiere mandar y a quién.'
    );
  }
  return { hechos, turnoVigente: !!turnoVigente, delCorreo, delWhatsapp, deLaPregunta };
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
  if (respuesta === 'sí' && (!huella || b.huella !== huella)) return { estado: 'stale', resumen: 'Lo que espera ya no es lo que aprobaste (otro destinatario, cuenta o contenido); no se envió nada.' };
  if (canal === 'whatsapp' && !whatsappPermitido(correo)) return { estado: 'failed', resumen: 'WHATSAPP: no lo mandé: esta cuenta ya no tiene su WhatsApp.' };
  const como = { desdePanel: true, ...(huella ? { huella } : {}) };
  const hecho = canal === 'correo' ? await resolverBorrador(correo, ambito, respuesta, undefined, como) : await resolverBorradorWhatsapp(correo, ambito, respuesta, undefined, como);
  if (hecho === null) return { estado: 'stale', resumen: 'El borrador ya no estaba esperando; no se envió nada.' };
  return { estado: respuesta === 'no' ? 'failed' : clasificarEnvio(hecho), resumen: hecho };
}
