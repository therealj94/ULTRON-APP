/**
 * MODO INVITADO: SI NO HABLA LA DUEÑA, NADA PRIVADO DE ELLA LLEGA AL MODELO (revisión del 6-oct, bloqueante 2: «ningún
 * dato privado para invitados»).
 *
 * Antes, cuando la voz reconocía a alguien que no es la dueña (`quienHabla`, lib/voces-miembro.ts), el turno solo
 * agregaba una REGLA al prompt («no le leas lo privado de José»), pero el prompt seguía llevando su memoria, su perfil,
 * su hilo, sus tareas y sus herramientas privadas: dependía de que el modelo obedeciera.
 *
 * Ahora es UN corte, calculado una vez al entrar al turno (server.ts: correrTurnoInterno y turnoEnVivo llaman a
 * `conModoInvitado` antes que nada). En modo invitado el turno se arma como el de alguien SIN cuenta:
 *   · el cuerpo pierde la sesión, el correo, el nombre de la dueña, su memoria del teléfono (`memoria`), su hilo
 *     (`historial`), su contexto de la app y lo que espera su «sí»; el nivel es «miembro» (cerebro público). Sin sesión
 *     no hay dueño del turno: ni memoria ni perfil ni «lo que sé de ti», ni episodios, ni correos, ni WhatsApp, ni
 *     círculo, ni tareas o borradores, ni su computadora, ni nada se guarda en su memoria;
 *   · las herramientas privadas se apagan aunque el servidor las tenga (`manosDeInvitado`; el harness sin correo ni
 *     computadora: `construirMensajes({ invitado })`), y las acciones del teléfono de la dueña también (abrir sus
 *     correos, llamar, mandar…);
 *   · el modelo recibe una línea («MODO INVITADO…») y la persona oye/ve una frase corta: «Te respondo en modo invitado.»
 *
 * Cuándo (solo con voz; un turno ESCRITO desde el teléfono de la dueña, sin señal de voz, no cambia):
 *   · la voz reconoció a alguien guardado que NO es la dueña (`quienHabla: { id }`, validado contra SU cajón), también la
 *     precaución `reciente`, o la escena lo dice («Por la voz, habla Ana…, no José»);
 *   · la dueña tiene su voz guardada y una frase lo bastante larga NO fue de ella (`quienHabla: { desconocida: true }`,
 *     mobile/src/voces/voces.ts). Solo desde la app con sesión; solo puede QUITAR acceso, nunca darlo.
 */
import { otraVozDelTurno } from '../lib/voces-miembro';
import { otraVozDe } from './decision-turno';
import type { ManosDelTurno } from '../lib/cerebro-manos';

export type ModoInvitado = {
  motivo: 'voz-conocida' | 'voz-reciente' | 'voz-desconocida' | 'escena';
  /** El nombre guardado de quien habla (solo de una voz validada), si se sabe. */
  quien?: string;
};

/** ¿El turno es de un invitado? Mira la señal de voz del cuerpo ORIGINAL (con su sesión). Nunca lanza. */
export async function modoInvitadoDelTurno(body: any): Promise<ModoInvitado | null> {
  if (!body || typeof body !== 'object') return null;
  const q = body.quienHabla as { desconocida?: unknown; id?: unknown } | null | undefined;
  const conSesion = body.origen === 'app' && !!String(body.sesion?.correo || '').trim();
  // Una voz guardada de ESA cuenta que no es la dueña (o la precaución `reciente`).
  const v = await otraVozDelTurno({ quienHabla: q, origen: body.origen, sesion: body.sesion }).catch(() => null);
  if (v) return { motivo: v.reciente ? 'voz-reciente' : 'voz-conocida', quien: v.quien };
  // La escena del teléfono (apps de antes) lo dice en palabras.
  if (otraVozDe(String(body.escena || '').slice(0, 400))) return { motivo: 'escena' };
  // Una voz que no es la de la dueña (que sí tiene la suya guardada): solo desde la app con sesión; solo frena.
  if (conSesion && q && typeof q === 'object' && q.desconocida === true) return { motivo: 'voz-desconocida' };
  return null;
}

/** Lo que se le quita al cuerpo del turno de un invitado (todo lo que diría de quién es o qué tiene la dueña). */
const PRIVADOS = ['sesion', 'correo', 'usuario', 'userName', 'memoria', 'memoriaDe', 'historial', 'contexto', 'decisionVista', 'quienHabla', 'telegramUserId', 'telegramChatId', 'interrumpido'] as const;

/**
 * El cuerpo de un turno de invitado: sin sesión ni nada de la dueña, nivel miembro y la marca `modoInvitado` (la pone
 * SOLO esto: la que mande el cliente se borra en `conModoInvitado`).
 */
export function cuerpoDeInvitado(body: Record<string, unknown>, m: ModoInvitado): Record<string, unknown> {
  const limpio: Record<string, unknown> = { ...body };
  for (const k of PRIVADOS) delete limpio[k];
  limpio.nivel = 'miembro';
  limpio.modoInvitado = { motivo: m.motivo, ...(m.quien ? { quien: m.quien } : {}) };
  return limpio;
}

/** El corte, en un solo lugar: el cuerpo tal cual (sin marca ajena) o el de invitado. */
export async function conModoInvitado<T>(body: T): Promise<T> {
  if (!body || typeof body !== 'object') return body;
  const b = { ...(body as Record<string, unknown>) };
  delete b.modoInvitado;
  const m = await modoInvitadoDelTurno(b);
  return (m ? cuerpoDeInvitado(b, m) : b) as T;
}

/** La marca del turno (puesta por `conModoInvitado`), o null. */
export function modoInvitadoDe(body: any): ModoInvitado | null {
  const m = body?.modoInvitado;
  if (!m || typeof m !== 'object') return null;
  const motivo = ['voz-conocida', 'voz-reciente', 'voz-desconocida', 'escena'].includes(m.motivo) ? (m.motivo as ModoInvitado['motivo']) : 'escena';
  const quien = typeof m.quien === 'string' ? m.quien.replace(/[\u0000-\u001f<>{}\[\]]/g, '').slice(0, 60).trim() : '';
  return { motivo, ...(quien ? { quien } : {}) };
}

/** Las herramientas de un invitado: ninguna privada ni del teléfono de la dueña (lo público —web, leer— sigue). Tampoco crear archivos: quedan en la cuenta de la dueña. */
export function manosDeInvitado(base: ManosDelTurno): ManosDelTurno {
  return { ...base, app: false, manos: [], sistema: false, computadora: false, correo: false, whatsapp: false, sesion: false, triaje: false, investigar: false, documentos: false };
}

/** La línea para el modelo en un turno de invitado. */
export function hechoInvitado(m: ModoInvitado, idioma: 'es' | 'en' = 'es'): string {
  const quien = m.quien || '';
  if (idioma === 'en')
    return `GUEST MODE: the person speaking now is ${quien || 'not the account owner (the voice did not match)'}${quien ? ', not the account owner' : ''}. You have NO access to the owner's private information in this turn (no memory, profile, emails, messages, contacts, tasks, calendar or anything you know about the owner) and you cannot act on their behalf. Chat normally about general things. If they ask for something private or to send/do something, say kindly that it belongs to the account owner. Never guess or make up private details.`;
  return `MODO INVITADO: quien habla ahora es ${quien || 'alguien que no es la persona dueña de la cuenta (la voz no coincidió)'}${quien ? ', no la persona dueña de la cuenta' : ''}. En este turno NO tienes nada privado de la dueña (ni su memoria, ni su perfil, ni correos, mensajes, contactos, tareas, agenda ni lo que sabes de ella) y no puedes actuar en su nombre. Charla normal de cosas generales. Si pide algo privado o mandar/hacer algo de la cuenta, di con amabilidad que eso es de la dueña. Nunca adivines ni inventes datos privados.`;
}

/** La frase corta que oye/ve la persona (sin nada privado). */
export function avisoInvitado(idioma: 'es' | 'en' = 'es'): string {
  return idioma === 'en' ? 'Answering in guest mode.' : 'Te respondo en modo invitado.';
}
