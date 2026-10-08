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
 *   · Revisión 7 (G2, cerrar si no se comprueba): con su voz guardada, la frase no quedó identificada como suya ni por
 *     continuidad (dudosa, muy corta sin continuidad, la consulta tardó o falló: `quienHabla: { incierta: true }`); o vino
 *     el id de una voz que no es la dueña y no se pudo comprobar (el cajón tardó, S3 falló, el id ya no está). Antes, lo
 *     incierto contaba como la dueña.
 *   · En modo invitado tampoco van los nombres de la escena (las caras guardadas, «Por la voz, habla…»): `escenaSinNombres`.
 *
 * Lo que NO lleva identidad de voz (y por eso es la dueña, por su sesión): la conversación de voz en vivo (ElevenLabs,
 * /api/voz/llm), Windows, la web y Telegram. Ver docs/voz/VOCES-CONOCIDAS.md.
 */
import { nombresVocesPorConfirmar, vozDelTurno } from '../lib/voces-miembro';
import { nombresCarasPorConfirmar } from '../lib/caras-miembro';
import { escenaSinPorConfirmar } from '../lib/caras-turno';
import { otraVozDe } from './decision-turno';
import type { ManosDelTurno } from '../lib/cerebro-manos';

export type ModoInvitado = {
  motivo: 'voz-conocida' | 'voz-reciente' | 'voz-desconocida' | 'voz-incierta' | 'escena';
  /** El nombre guardado de quien habla (solo de una voz validada), si se sabe. */
  quien?: string;
};

/** ¿El turno es de un invitado? Mira la señal de voz del cuerpo ORIGINAL (con su sesión). Nunca lanza. */
export async function modoInvitadoDelTurno(body: any): Promise<ModoInvitado | null> {
  if (!body || typeof body !== 'object') return null;
  const q = body.quienHabla as { desconocida?: unknown; incierta?: unknown; id?: unknown } | null | undefined;
  const conSesion = body.origen === 'app' && !!String(body.sesion?.correo || '').trim();
  // Una voz guardada de ESA cuenta que no es la dueña (o la precaución `reciente`).
  const v = await vozDelTurno({ quienHabla: q, origen: body.origen, sesion: body.sesion }).catch(() => ({ tipo: 'sin_verificar' as const, reciente: false }));
  if (v.tipo === 'otra') return { motivo: v.voz.reciente ? 'voz-reciente' : 'voz-conocida', quien: v.voz.quien };
  // Revisión 7 (G2): el teléfono dijo que no es la dueña y no se pudo comprobar (cajón lento, S3, id que ya no está).
  if (v.tipo === 'sin_verificar') return { motivo: 'voz-incierta' };
  // La escena del teléfono (apps de antes) lo dice en palabras.
  if (otraVozDe(String(body.escena || '').slice(0, 400))) return { motivo: 'escena' };
  // Una voz que no es la de la dueña (que sí tiene la suya guardada): solo desde la app con sesión; solo frena.
  if (conSesion && q && typeof q === 'object' && q.desconocida === true) return { motivo: 'voz-desconocida' };
  // Revisión 7 (G2): con su voz guardada, la frase no se confirmó como suya (ni por continuidad): invitado.
  if (conSesion && q && typeof q === 'object' && q.incierta === true) return { motivo: 'voz-incierta' };
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
  // Revisión 7 (G2): la escena sin los nombres guardados (caras, «Por la voz, habla…»); lo demás de la cámara queda.
  if (typeof limpio.escena === 'string') {
    const e = escenaSinNombres(limpio.escena);
    if (e) limpio.escena = e;
    else delete limpio.escena;
  }
  limpio.nivel = 'miembro';
  limpio.modoInvitado = { motivo: m.motivo, ...(m.quien ? { quien: m.quien } : {}) };
  return limpio;
}

/**
 * La escena del teléfono sin nombres de nadie (revisión 7, G2): fuera «Reconozco a …» / "I recognize …" (las caras que
 * guardó la dueña, con su parentesco), «Por la voz, habla …» / "By voice, …" y «Con la cámara trasera: reconozco a …».
 * Queda lo que la cámara describe sin nombres («una persona sonriendo, una mesa»).
 */
export function escenaSinNombres(escena: string): string {
  return String(escena || '')
    .replace(/\b(Con la c[aá]mara trasera:\s*)?reconozco a\b[^;.]*[;.]?/gi, ' ')
    .replace(/\b(With the back camera:\s*)?I recognize\b[^;.]*[;.]?/gi, ' ')
    .replace(/\bPor la voz,[^.]*\.?/gi, ' ')
    .replace(/\bBy voice,[^.]*\.?/gi, ' ')
    .replace(/\s*;\s*(?=;|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s;,.]+/, '')
    .trim();
}

/** La escena nombra a alguien (una cara reconocida o una voz): solo entonces se mira quién espera su confirmación. */
const RE_ESCENA_CON_NOMBRES = /\b(reconozco a|I recognize|Por la voz,|By voice,)/i;

/**
 * Tanda F1: los nombres guardados que todavía no se pueden reconocer (un posible menor que la dueña no confirmó en su
 * pantalla), de las caras y de las voces de la cuenta del turno. Solo con la sesión de la app y una escena que nombra a
 * alguien; con tope (el cajón suele estar en caché). Nunca lanza.
 */
async function nombresPorConfirmarDelTurno(body: Record<string, unknown>): Promise<string[]> {
  const escena = typeof body.escena === 'string' ? body.escena : '';
  const correo = String((body.sesion as { correo?: unknown } | undefined)?.correo || '').trim();
  if (!escena || !correo || body.origen !== 'app' || !RE_ESCENA_CON_NOMBRES.test(escena)) return [];
  const [caras, voces] = await Promise.all([nombresCarasPorConfirmar(correo).catch(() => []), nombresVocesPorConfirmar(correo).catch(() => [])]);
  return [...caras, ...voces];
}

/**
 * El corte, en un solo lugar: el cuerpo tal cual (sin marca ajena) o el de invitado. Tanda F1: en los dos, la escena sin
 * el nombre de quien espera la confirmación de la dueña en su pantalla (lib/caras-turno.ts escenaSinPorConfirmar).
 */
export async function conModoInvitado<T>(body: T): Promise<T> {
  if (!body || typeof body !== 'object') return body;
  const b = { ...(body as Record<string, unknown>) };
  delete b.modoInvitado;
  const [m, porConfirmar] = await Promise.all([modoInvitadoDelTurno(b), nombresPorConfirmarDelTurno(b)]);
  // Nunca se quita a la dueña de la sesión (ni a quien la escena marca como quien habla), aunque alguien por confirmar se llame igual.
  const duena = String((b.sesion as { nombre?: unknown } | undefined)?.nombre || '').trim();
  if (porConfirmar.length && typeof b.escena === 'string') b.escena = escenaSinPorConfirmar(b.escena, porConfirmar, { proteger: duena ? [duena] : [] });
  return (m ? cuerpoDeInvitado(b, m) : b) as T;
}

/** La marca del turno (puesta por `conModoInvitado`), o null. */
export function modoInvitadoDe(body: any): ModoInvitado | null {
  const m = body?.modoInvitado;
  if (!m || typeof m !== 'object') return null;
  const motivo = ['voz-conocida', 'voz-reciente', 'voz-desconocida', 'voz-incierta', 'escena'].includes(m.motivo) ? (m.motivo as ModoInvitado['motivo']) : 'escena';
  const quien = typeof m.quien === 'string' ? m.quien.replace(/[\u0000-\u001f<>{}\[\]]/g, '').slice(0, 60).trim() : '';
  return { motivo, ...(quien ? { quien } : {}) };
}

/** Las herramientas de un invitado: ninguna privada ni del teléfono de la dueña (lo público —web, leer— sigue). Tampoco crear archivos: quedan en la cuenta de la dueña. */
export function manosDeInvitado(base: ManosDelTurno): ManosDelTurno {
  return { ...base, app: false, manos: [], sistema: false, computadora: false, correo: false, whatsapp: false, sesion: false, triaje: false, investigar: false, documentos: false, calendario: false };
}

/** La línea para el modelo en un turno de invitado. */
export function hechoInvitado(m: ModoInvitado, idioma: 'es' | 'en' = 'es'): string {
  const quien = m.quien || '';
  // Revisión 7 (G2): no se pudo confirmar que sea la dueña (puede serlo): lo privado no está, y si lo pide se le dice
  // cómo confirmarlo, sin culpar a nadie.
  if (m.motivo === 'voz-incierta') {
    const frase = idioma === 'en' ? VOZ_NO_CONFIRMADA.en : VOZ_NO_CONFIRMADA.es;
    return idioma === 'en'
      ? `GUEST MODE (voice not confirmed): I could not confirm by voice that the account owner is the one speaking. In this turn you have NO access to the owner's private information (memory, profile, emails, messages, contacts, tasks, calendar, pending drafts) and you cannot act on their behalf. Chat normally about general things. If the request needs something private or is a short reply to something pending («yes», «go ahead», «send it»), answer only: «${frase}» Never guess or make up private details.`
      : `MODO INVITADO (voz sin confirmar): no pude confirmar por la voz que quien habla sea la persona dueña de la cuenta. En este turno NO tienes nada privado de la dueña (ni su memoria, ni su perfil, ni correos, mensajes, contactos, tareas, agenda ni borradores pendientes) y no puedes actuar en su nombre. Charla normal de cosas generales. Si lo que pide necesita algo privado o es una respuesta corta a algo pendiente («sí», «dale», «mándalo»), responde solo: «${frase}» Nunca adivines ni inventes datos privados.`;
  }
  if (idioma === 'en')
    return `GUEST MODE: the person speaking now is ${quien || 'not the account owner (the voice did not match)'}${quien ? ', not the account owner' : ''}. You have NO access to the owner's private information in this turn (no memory, profile, emails, messages, contacts, tasks, calendar or anything you know about the owner) and you cannot act on their behalf. Chat normally about general things. If they ask for something private or to send/do something, say kindly that it belongs to the account owner. Never guess or make up private details.`;
  return `MODO INVITADO: quien habla ahora es ${quien || 'alguien que no es la persona dueña de la cuenta (la voz no coincidió)'}${quien ? ', no la persona dueña de la cuenta' : ''}. En este turno NO tienes nada privado de la dueña (ni su memoria, ni su perfil, ni correos, mensajes, contactos, tareas, agenda ni lo que sabes de ella) y no puedes actuar en su nombre. Charla normal de cosas generales. Si pide algo privado o mandar/hacer algo de la cuenta, di con amabilidad que eso es de la dueña. Nunca adivines ni inventes datos privados.`;
}

/** La frase de la voz sin confirmar (la misma que dice el teléfono: mobile/src/voces/voces.ts fraseVozNoConfirmada). */
export const VOZ_NO_CONFIRMADA = { es: 'No reconocí tu voz; dímelo con una frase un poco más larga.', en: "I didn't recognize your voice; tell me with a slightly longer sentence." } as const;

/**
 * La frase corta que oye/ve la persona (sin nada privado). Con la voz sin confirmar (`voz-incierta`), nada: puede ser la
 * dueña con un «sí» corto, y la frase de confirmar solo se dice si lo pedido necesitaba algo privado (hechoInvitado).
 */
export function avisoInvitado(idioma: 'es' | 'en' = 'es', m?: ModoInvitado | null): string {
  if (m?.motivo === 'voz-incierta') return '';
  return idioma === 'en' ? 'Answering in guest mode.' : 'Te respondo en modo invitado.';
}
