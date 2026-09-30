/**
 * CONVERSACIÓN FLUIDA (como el modo voz de ChatGPT): ElevenLabs Agents con NUESTRO cerebro.
 *
 * Lo que hace ElevenLabs: el audio del teléfono va por WebRTC (con cancelación de eco), su servidor
 * reconoce la voz, decide cuándo terminó el turno, corta al avatar si la persona le habla encima y
 * dice la respuesta con la voz v4 del avatar. Lo que NO hace: pensar. Cada turno nos lo pide como
 * «LLM propio» (formato OpenAI /chat/completions en streaming), y aquí se contesta con el mismo
 * cerebro de la mesa, llamado EN PROCESO (sin ida y vuelta HTTP ni sesión interna): mismas
 * herramientas de consulta, misma memoria, mismo perfil, mismo avatar e idioma.
 *
 * Seguridad, en dos llaves:
 *  1. ElevenLabs manda `Authorization: Bearer <secreto>` en cada petición. El secreto está guardado
 *     en ElevenLabs (secretos del agente) y aquí se deriva del de las sesiones (secretoDerivado).
 *  2. Quién habla viaja en un PASE firmado (firmarDato('voz', …)) que el teléfono recibe al abrir la
 *     conversación y ElevenLabs reenvía en la cabecera `X-Pase` (variable dinámica `pase`).
 *
 * El pase es una credencial al portador (quien lo tenga habla como la persona), así que se le quita
 * todo lo que no hace falta (auditoría del 29-sep):
 *  · NO lleva mando: el turno por voz es solo de consulta (sin redespliegue, sin urgente ni llamada,
 *    sin ejecutor). Lo que cambia el sistema se pide en la mesa, con la sesión.
 *    Decisión explícita (revisión 5.0, B7): lo que SÍ se puede desde la voz sin mando es (1) enviar
 *    un borrador de PULSE2CHAT que AU-RA redactó y la persona oyó, con su «sí» explícito en el turno
 *    siguiente (lib/acciones-app.ts: el envío lo hace el teléfono del aparato de esta conversación),
 *    y (2) anotar y cerrar pendientes del taller (tarea_anotar / tarea_cerrar), y (3) las manos de la
 *    app (lib/manos-app.ts): llamar y poner un recordatorio, SIEMPRE con su «sí» del turno siguiente;
 *    leer y buscar en sus chats (lo hace su teléfono), idioma, perfil y presentación. Son de la persona
 *    y no cambian el sistema; por eso no se cierran aquí.
 *  · Va atado a la SESIÓN que lo pidió (su huella): si esa sesión se cierra o la contraseña cambia,
 *    el pase deja de valer en el siguiente turno, no a los 30 minutos.
 *  · Va atado a UNA conversación (un nonce `cid`): vence tras 5 minutos sin turnos (cada turno lo
 *    renueva) y nunca pasa de 20 minutos; cada cuenta tiene como mucho tres conversaciones vivas.
 *  · Cada persona tiene su cupo de turnos por minuto: todos los turnos llegan de las IPs de
 *    ElevenLabs, y contar por IP juntaba a todo el mundo en un solo cupo.
 *  · Lleva FIRMADO el nivel de quien lo pidió (`nv`: junta o miembro, server/nivel.ts). En cada
 *    turno se vuelve a calcular por el correo y vale el más estrecho de los dos: un pase de junta de
 *    alguien a quien sacaron del padrón habla ya como miembro. El cliente no puede elegirlo.
 *  · Un miembro tiene minutos de voz al día (server/tope-voz.ts, VOZ_MIEMBRO_MIN_DIA): no se abre
 *    una conversación sin minutos, el pase vence cuando se acaban (`tp`) y un turno pasado el tope
 *    solo dice, con amabilidad, que sigamos por escrito.
 */
import crypto from 'crypto';
import type express from 'express';
import { clave } from '../lib/boveda';
import { quitarExpresiones } from '../lib/expresiones';
import { firmarDato, gastarCupo, huellaSesion, leerDato, mismoSecreto, secretoDerivado, sesionSigueViva, type Sesion } from './seguridad';
import { normalizarAvatar, normalizarIdioma, type AvatarVoz, type Idioma } from './eleven';
import { modoValido } from './desk';
import { aparatoValido, lecturaDe, turnoDeRecordatorio } from '../lib/acciones-app';
import { preguntaSigues, RE_LLAMADA, RE_SIGUES, saludoDeLlamada } from '../lib/manos-app';
import { nivelDeCorreo, nivelMasEstrecho, nivelValido, type NivelAura } from './nivel';
import { anotarVoz, fraseTopeVoz, restanteVozMs } from './tope-voz';
// El banco de frases de estado es uno solo, el de la app (sin React Native: se empaqueta aquí igual).
import { ESPERA_FRASE_MS, esRelleno, estadoDeEspera, fraseDeEstado, quitarRellenoInicial } from '../mobile/src/compa/frasesEstado';

/** La etiqueta del secreto que ElevenLabs manda como Bearer. Cambiarla invalida el guardado allá. */
export const ETIQUETA_SECRETO_LLM = 'elevenlabs-llm-v1';
/** Tope absoluto de un pase (ElevenLabs lo reenvía igual durante toda la conversación). */
export const PASE_TTL_MS = 20 * 60_000;
/** Sin turnos durante esto, la conversación se da por cerrada. Cada turno la renueva. */
export const INACTIVIDAD_MS = 5 * 60_000;
/** Conversaciones vivas por cuenta (varios teléfonos). La más vieja se cierra al abrir otra. */
export const MAX_CONVERSACIONES = 3;
/** Turnos por minuto y por persona. Una charla real no pasa de diez o quince. */
export const CUPO_TURNOS_MIN = 30;
/** Lo que puede tardar un turno hablado antes de pedir perdón y soltar a la persona. */
export const TURNO_VOZ_MS = 45_000;
/**
 * EL PUENTE: si en este tiempo el cerebro no dijo nada, AURA dice una frase corta del estado en que está
 * («Déjame revisar…», «Buscando…», «Sacando cuentas…»), con la forma de ser del avatar y en su idioma,
 * en vez de quedarse callada. Una orden rápida o una charla contestan antes y no lo oyen nunca.
 * En la llamada, el agente de ElevenLabs ya dice su propio relleno corto («Mmm… a ver.») a los ~2,5 s;
 * por eso el puente va 2 s después (~4,5 s): si el cerebro sigue callado, se oye el ESTADO («Estoy
 * revisando…»), no dos muletillas seguidas. Antes 1,2 s, y salía en turnos que iban a contestar
 * enseguida (José: «no se siente conversación fluida»).
 */
export const PUENTE_VOZ_MS = ESPERA_FRASE_MS + 2_000;

/**
 * Un agente de ElevenLabs por avatar e idioma (voz, idioma del reconocimiento y del turno). Los crea
 * scripts/elevenlabs-agentes.ts; se cambian sin tocar código con ELEVENLABS_AGENTE_<AVATAR>_<IDIOMA>.
 */
export const AGENTES: Record<AvatarVoz, Record<Idioma, string>> = {
  ojos: { es: 'agent_3401m3qbvq59eqcv17ecpxxdp7en', en: 'agent_1801m3qbvrrye0zbpgxawy3cqfqt' },
  aura: { es: 'agent_6801m3qbvv83fzgvg42eev85m8m5', en: 'agent_3301m3qbvws7ez6rajshn8akxjbs' },
  claudio: { es: 'agent_3501m3qbvyc5e9b946hm5byv3c7g', en: 'agent_4901m3qbw01me4kt40nqkgy60ykm' },
  antonio: { es: 'agent_6901m3r708f4e15vgc39yj4g8vw7', en: 'agent_3501m3r70c76e6nrvch0ewjcqkys' },
};

export function agenteDe(avatar: AvatarVoz, idioma: Idioma): string {
  const env = String(process.env[`ELEVENLABS_AGENTE_${avatar.toUpperCase()}_${idioma.toUpperCase()}`] || '').trim();
  return env || AGENTES[avatar][idioma];
}

/**
 * El modo de la mesa con que habla cada avatar si el teléfono no dice otro. Antes era GUARDIAN para
 * todos («firme, pocas palabras»), que a Claudio y a AU-RA les quitaba la calidez.
 */
export const MODO_DE_AVATAR: Record<AvatarVoz, string> = { ojos: 'GUARDIAN', aura: 'CONVERSACION', claudio: 'CREATIVE', antonio: 'ANALYTICAL' };

export type Pase = {
  correo: string;
  nombre: string;
  rol: string;
  avatar: AvatarVoz;
  idioma: Idioma;
  modo: string;
  /** El nonce de la conversación. */
  cid: string;
  /** Huella de la sesión que lo pidió, y cuándo se abrió y vence esa sesión. */
  h: string;
  sat: number;
  sexp?: number;
  exp: number;
  /**
   * El aparato que abrió la conversación (cabecera `x-aura-aparato` de POST /api/voz/agente), o null.
   * Las acciones que pida la voz van solo al canal de ese teléfono. Va firmado dentro del pase: sirve
   * también si el servidor se redespliega a mitad de charla.
   */
  aparato: string | null;
  /** El nivel firmado al abrir (junta o miembro); null en un pase de antes, que se recalcula. */
  nivel: NivelAura | null;
  /** El pase vence antes de lo normal porque se acaban los minutos de voz del miembro. */
  tope: boolean;
};

export function emitirPase(
  s: Pick<Sesion, 'correo' | 'nombre' | 'rol' | 'token' | 'at'> & { exp?: number },
  avatar: AvatarVoz,
  idioma: Idioma,
  o: { modo?: string; cid?: string; ahora?: number; aparato?: string | null; nivel?: NivelAura; topeMs?: number } = {}
): { pase: string; cid: string; exp: number } {
  const ahora = o.ahora ?? Date.now();
  const cid = o.cid || crypto.randomBytes(12).toString('base64url');
  // Nunca más allá de la sesión que lo pidió, ni de los minutos de voz que le quedan (miembros).
  const normal = Math.min(ahora + PASE_TTL_MS, s.exp || Infinity);
  const porTope = o.topeMs !== undefined && Number.isFinite(o.topeMs) ? ahora + Math.max(0, o.topeMs) : Infinity;
  const exp = Math.min(normal, porTope);
  const modo = modoValido(o.modo) || MODO_DE_AVATAR[avatar];
  const ap = aparatoValido(o.aparato);
  const nv = nivelValido(o.nivel);
  const pase = firmarDato('voz', {
    correo: s.correo,
    nombre: s.nombre,
    rol: s.rol,
    avatar,
    idioma,
    modo,
    cid,
    h: huellaSesion(s.token),
    sat: s.at,
    sexp: s.exp,
    exp,
    ...(ap ? { ap } : {}),
    ...(nv ? { nv } : {}),
    ...(porTope < normal ? { tp: 1 } : {}),
  });
  return { pase, cid, exp };
}

/** Lo que dice un pase bien firmado y no vencido. Que su sesión siga viva se mira aparte. */
export function leerPase(token: string, ahora = Date.now()): Pase | null {
  const d = leerDato('voz', token);
  // Un pase de antes (sin sesión ni conversación) no se acepta: era el de 30 minutos al portador.
  if (!d?.correo || !d?.nombre || !d?.cid || !d?.h || !Number(d.exp) || ahora > Number(d.exp)) return null;
  const avatar = normalizarAvatar(d.avatar);
  return {
    correo: String(d.correo),
    nombre: String(d.nombre),
    rol: String(d.rol || 'Junta'),
    avatar,
    idioma: normalizarIdioma(d.idioma),
    modo: modoValido(d.modo) || MODO_DE_AVATAR[avatar],
    cid: String(d.cid),
    h: String(d.h),
    sat: Number(d.sat) || 0,
    sexp: Number(d.sexp) || undefined,
    exp: Number(d.exp),
    aparato: aparatoValido(d.ap),
    nivel: nivelValido(d.nv),
    tope: d.tp === 1,
  };
}

/**
 * Un pase NUESTRO (bien firmado, de esta versión) que ya venció hace poco: su idioma, o null. No da
 * acceso a nada; sirve para despedirse con una frase en vez de dejar a la persona oyendo silencio
 * (ElevenLabs deja seguir la conversación hasta 30 minutos y el pase dura 20).
 */
export function idiomaDePaseVencido(token: string, ahora = Date.now()): Idioma | null {
  return paseVencido(token, ahora)?.idioma ?? null;
}

/** Igual, y además si venció porque se acabaron los minutos de voz del miembro (`tp` firmado). */
export function paseVencido(token: string, ahora = Date.now()): { idioma: Idioma; tope: boolean } | null {
  const d = leerDato('voz', token);
  if (!d?.correo || !d?.cid || !d?.h || !Number(d.exp)) return null;
  const exp = Number(d.exp);
  return ahora > exp && ahora - exp < 60 * 60_000 ? { idioma: normalizarIdioma(d.idioma), tope: d.tp === 1 } : null;
}

/* ------------------------------------------------------------------ las conversaciones vivas */

type Conversacion = {
  cid: string;
  correo: string;
  abierta: number;
  ultimo: number;
  cerrada: boolean;
  /** Lo que se le dio a la voz en el último turno, y si ElevenLabs lo cortó a la mitad. */
  ultimaDicha: string;
  cortada: boolean;
  turnos: number;
  /** El turno que está pensando ahora (si llega otro, este ya no lo oye nadie). */
  enCurso: AbortController | null;
  /**
   * Lo que el turno en curso ya le dio a la voz. Si llega otro turno antes de que termine, esto pasa
   * a ser `ultimaDicha` (antes quedaba la del turno anterior y la interrupción no se notaba).
   */
  dichoEnCurso: string;
  /** Si el turno en curso ya dijo algo propio (el «perdón» del principio no cuenta). */
  algoEnCurso: boolean;
  /** Hasta cuándo ya se contó el tiempo de esta conversación en el tope de voz. */
  medido: number;
};
const conversaciones = new Map<string, Conversacion>();

/**
 * Suelta las conversaciones cerradas o vencidas. Las vencidas por inactividad se anotan como
 * cerradas: antes se borraban sin anotar y el turno siguiente con ese pase la «retomaba» como si el
 * servidor se hubiera redesplegado, y los cinco minutos de inactividad no se cumplían.
 */
function podar(ahora: number) {
  for (const [k, c] of conversaciones) {
    if (c.cerrada || ahora - c.ultimo > INACTIVIDAD_MS) {
      anotarCerrada(k, ahora);
      conversaciones.delete(k);
    }
  }
}

/** Registra una conversación nueva; si la cuenta ya tiene el máximo, cierra la más vieja. */
export function abrirConversacion(correo: string, cid: string, ahora = Date.now()): { cerradas: number } {
  podar(ahora);
  const c = correo.toLowerCase();
  const vivas = [...conversaciones.values()].filter((x) => x.correo === c).sort((a, b) => a.ultimo - b.ultimo);
  let cerradas = 0;
  while (vivas.length >= MAX_CONVERSACIONES) {
    const vieja = vivas.shift()!;
    vieja.enCurso?.abort();
    anotarCerrada(vieja.cid, ahora);
    conversaciones.delete(vieja.cid);
    cerradas++;
  }
  conversaciones.set(cid, { cid, correo: c, abierta: ahora, ultimo: ahora, cerrada: false, ultimaDicha: '', cortada: false, turnos: 0, enCurso: null, dichoEnCurso: '', algoEnCurso: false, medido: ahora });
  return { cerradas };
}

/**
 * El tiempo de esta conversación que todavía no se contó, y lo marca como contado (ms). Es lo que se
 * suma al tope de voz de un miembro en cada turno y al colgar.
 */
export function medirConversacion(c: { medido: number }, ahora = Date.now()): number {
  const ms = Math.max(0, ahora - c.medido);
  c.medido = Math.max(c.medido, ahora);
  return ms;
}

export function cerrarConversacion(cid: string, alCerrar?: (c: Conversacion) => void): boolean {
  const c = conversaciones.get(cid);
  if (!c) return false;
  alCerrar?.(c);
  c.enCurso?.abort();
  conversaciones.delete(cid);
  return true;
}

/**
 * Un turno de esta conversación: la renueva si sigue viva. Una que no está registrada (el servidor se
 * redesplegó a mitad de charla) se retoma: el pase firmado, su tope de 20 minutos y la sesión viva
 * ya se comprobaron. Una que se cerró (más de tres abiertas, o la cerró el teléfono) no vuelve.
 */
function tocarConversacion(p: Pase, ahora: number): Conversacion | null {
  let c = conversaciones.get(p.cid);
  if (c && (c.cerrada || ahora - c.ultimo > INACTIVIDAD_MS)) {
    anotarCerrada(p.cid, ahora);
    conversaciones.delete(p.cid);
    return null;
  }
  if (!c) {
    if (cerradasDeCuenta.get(p.cid)) return null;
    abrirConversacion(p.correo, p.cid, ahora);
    c = conversaciones.get(p.cid)!;
  }
  c.ultimo = ahora;
  return c;
}

/** Nonces cerrados a propósito (por el teléfono o por pasar el máximo), para que no se retomen. */
const cerradasDeCuenta = new Map<string, number>();
function anotarCerrada(cid: string, ahora = Date.now()) {
  cerradasDeCuenta.set(cid, ahora);
  if (cerradasDeCuenta.size > 5000) for (const [k, t] of cerradasDeCuenta) if (ahora - t > PASE_TTL_MS) cerradasDeCuenta.delete(k);
}

/** Solo pruebas. */
export function _conversaciones() {
  return conversaciones;
}
export function _reiniciarConversaciones() {
  conversaciones.clear();
  cerradasDeCuenta.clear();
}

/* ------------------------------------------------------------------ el formato de ElevenLabs */

/** El último mensaje de la persona en el formato de OpenAI (texto o partes con texto). */
export function ultimoDeLaPersona(messages: unknown): string {
  const lista = Array.isArray(messages) ? messages : [];
  for (let i = lista.length - 1; i >= 0; i--) {
    const m: any = lista[i];
    if (m?.role !== 'user') continue;
    return textoDe(m.content);
  }
  return '';
}

function textoDe(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join(' ').trim();
  return '';
}

const aplanar = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * ¿La respuesta anterior quedó cortada? La página del «LLM propio» no dice cómo llega una
 * interrupción; lo que sí documenta ElevenLabs (eventos del cliente, `agent_response_correction`)
 * es que al interrumpir recorta la respuesta del agente a lo que alcanzó a decir
 * («Let me tell you about the complete history…» → «Let me tell you about...»), y ese recorte es
 * el mensaje de asistente que vuelve en el historial del turno siguiente. No hay bandera aparte.
 *
 * Así que no se adivina con palabras: se compara lo que NOSOTROS le dimos a la voz en el turno
 * anterior con el último mensaje de asistente que manda ElevenLabs. Si el suyo es un pedazo del
 * principio del nuestro (con o sin los «...» del recorte), la persona la interrumpió. La otra señal
 * es directa: ElevenLabs cerró la petición mientras la voz todavía recibía texto (`conv.cortada`).
 */
export function asistenteTruncado(messages: unknown, ultimaDicha: string): boolean {
  const nuestra = aplanar(quitarExpresiones(ultimaDicha || ''));
  if (nuestra.length < 12) return false;
  const lista = Array.isArray(messages) ? messages : [];
  let i = lista.length - 1;
  while (i >= 0 && (lista[i] as any)?.role === 'user') i--;
  const m: any = lista[i];
  if (!m || m.role !== 'assistant') return false;
  const suya = aplanar(textoDe(m.content)).replace(/(\.{3}|…|—|-)$/, '').trim();
  if (!suya) return true;
  return suya.length + 8 < nuestra.length && nuestra.startsWith(suya);
}

/** Lo primero que dice AU-RA cuando la interrumpieron: un perdón breve, y enseguida lo nuevo. */
const PERDON: Record<Idioma, string[]> = {
  es: ['¡Ah, perdón! ', '¡Uy, perdón! ', 'Perdón. '],
  en: ['Oh, sorry! ', 'Oops, sorry! ', 'Sorry. '],
};
export function perdonDe(idioma: Idioma, n = 0): string {
  const l = PERDON[idioma];
  return l[Math.abs(n) % l.length];
}

/** Un trozo SSE con la forma de OpenAI. */
export function trozoOpenAI(id: string, modelo: string, contenido: string | null, fin: string | null = null, rol = false): string {
  const delta: Record<string, string> = {};
  if (rol) delta.role = 'assistant';
  if (contenido) delta.content = contenido;
  const c = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: modelo, choices: [{ index: 0, delta, finish_reason: fin }] };
  return `data: ${JSON.stringify(c)}\n\n`;
}

/**
 * Lee eventos SSE (`event:` + `data:`) de un cuerpo que llega a trozos. Con `senal`, deja de leer
 * cuando se aborta; y el lector se suelta siempre (antes quedaba tomado si el que leía se iba).
 */
export async function* eventosSSE(cuerpo: ReadableStream<Uint8Array>, senal?: AbortSignal): AsyncGenerator<{ evento: string; datos: any }> {
  const lector = cuerpo.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const alAbortar = () => void lector.cancel().catch(() => {});
  senal?.addEventListener('abort', alAbortar, { once: true });
  try {
    for (;;) {
      if (senal?.aborted) return;
      const { done, value } = await lector.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let corte: number;
      while ((corte = buf.indexOf('\n\n')) >= 0) {
        const bloque = buf.slice(0, corte);
        buf = buf.slice(corte + 2);
        let evento = 'message';
        const datos: string[] = [];
        for (const linea of bloque.split('\n')) {
          if (linea.startsWith('event:')) evento = linea.slice(6).trim();
          else if (linea.startsWith('data:')) datos.push(linea.slice(5).trimStart());
        }
        if (!datos.length) continue;
        try {
          yield { evento, datos: JSON.parse(datos.join('\n')) };
        } catch {
          /* un trozo que no es JSON no es nuestro */
        }
      }
    }
  } finally {
    senal?.removeEventListener('abort', alAbortar);
    await lector.cancel().catch(() => {});
  }
}

/**
 * Sigue un `replace` del cerebro (usó una herramienta y la respuesta buena es otra) sin desdecir lo ya
 * dicho: si la nueva empieza igual, se dice lo que falta; si no, se sigue con la nueva. El espacio de
 * unión solo si hace falta (antes quedaban dos).
 */
export function restoDeReemplazo(dicho: string, nuevo: string): string {
  const d = aplanar(dicho);
  const n = aplanar(nuevo);
  if (!n) return '';
  if (d && n.startsWith(d)) {
    const falta = n.slice(d.length);
    return /\s$/.test(dicho) ? falta.trimStart() : falta;
  }
  return (dicho && !/\s$/.test(dicho) ? ' ' : '') + n;
}

/* ------------------------------------------------------------------ las rutas */

/** Lo que se le pide al cerebro para un turno hablado. */
export type TurnoVoz = {
  body: { message: string; mode: string; usuario: string; correo: string; avatar: AvatarVoz; idioma: Idioma; canal: 'mesa'; aparato: string | null };
  /**
   * Quién habla (del pase). NO es una sesión: no abre ninguna otra ruta. `nivel` es el más estrecho
   * entre el firmado en el pase y el que dice hoy el padrón por su correo.
   */
  persona: { correo: string; nombre: string; rol: string; nivel: NivelAura };
  /** La persona interrumpió la respuesta anterior (y ya se le dijo «perdón»). */
  interrumpida: boolean;
  senal: AbortSignal;
  /** Los mismos eventos que /api/turno/stream: tools, emocion, delta, replace, done, error. */
  enviar: (evento: string, datos: any) => void;
};

type Deps = {
  exigirMesaODesk: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => Sesion | null;
  /** El cerebro de siempre, en proceso. Resuelve cuando mandó `done` o `error` (o lo cortaron). */
  turno: (t: TurnoVoz) => Promise<void>;
  /** Para pedir el permiso a ElevenLabs (las pruebas ponen uno falso). */
  fetch?: typeof fetch;
  /** Tope de un turno hablado (TURNO_VOZ_MS; las pruebas lo acortan). */
  turnoMs?: number;
  /** Cuánto se espera al cerebro antes de decir la frase de espera (PUENTE_VOZ_MS; 0 la apaga). */
  puenteMs?: number;
  /** Junta o miembro por correo (server/nivel.ts; las pruebas pueden poner otro). */
  nivelDe?: (correo: string) => NivelAura;
};

const PHRASES = {
  hilo: { es: 'Se me fue el hilo. ¿Me lo repites?', en: 'I lost my train of thought. Can you say it again?' },
  corte: { es: 'Perdón, se me cortó un segundo. ¿Me lo repites?', en: 'Sorry, I lost the connection for a second. Can you repeat that?' },
  vencida: { es: 'Llevamos un buen rato hablando y esta conversación se cerró. Tócame para empezar otra y seguimos.', en: "We've been talking for a while and this conversation closed. Tap me to start a new one and we'll keep going." },
  tarde: { es: 'Perdón, me estoy tardando demasiado. ¿Me lo preguntas otra vez?', en: "Sorry, I'm taking too long. Could you ask me again?" },
  listo: { es: 'Listo.', en: 'Done.' },
  noLei: { es: 'Perdón, no pude leértelo. Pídemelo otra vez.', en: "Sorry, I couldn't read it to you. Ask me again." },
};

export function montarVozAgente(app: express.Express, d: Deps) {
  const pedir = d.fetch || fetch;
  const nivelDe = d.nivelDe || ((correo: string) => nivelDeCorreo(correo));

  /**
   * Abrir una conversación fluida: el teléfono pide, con su sesión, el permiso de un solo uso de
   * ElevenLabs para el agente de su avatar e idioma, y el pase que dirá quién habla.
   */
  app.post('/api/voz/agente', d.exigirMesaODesk, d.limitar(20, 60_000, 'voz-agente'), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return res.status(401).json({ error: 'Entra de nuevo para hablar en conversación.', honesto: true });
    const avatar = normalizarAvatar(req.body?.avatar);
    const idioma = normalizarIdioma(req.body?.idioma);
    const agente = agenteDe(avatar, idioma);
    const key = clave('elevenlabs');
    if (!agente || !key) return res.status(503).json({ error: 'La conversación fluida no está lista todavía.', honesto: true });
    // El nivel lo decide el servidor por el correo de la sesión, y va firmado en el pase.
    const nivel = nivelDe(s.correo);
    // Un miembro sin minutos de voz hoy no abre conversación: ni se le pide el permiso a ElevenLabs.
    const restante = nivel === 'miembro' ? restanteVozMs(s.correo) : undefined;
    if (restante !== undefined && restante <= 0) {
      return res.status(429).json({ error: fraseTopeVoz(idioma), codigo: 'TOPE_VOZ', honesto: true });
    }
    try {
      const r = await pedir(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agente)}`, {
        headers: { 'xi-api-key': key },
        signal: AbortSignal.timeout(10_000),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.token) {
        // Solo el estado: el cuerpo de un error de ElevenLabs puede traer datos de la cuenta.
        console.warn('[voz agente] token', r.status);
        return res.status(502).json({ error: 'No pude abrir la conversación ahora. Intenta en un momento.', honesto: true });
      }
      // El aparato (x-aura-aparato) va en el pase: lo que pida esta conversación va solo a ese teléfono.
      const p = emitirPase(s, avatar, idioma, { modo: req.body?.mode ?? req.body?.modo, aparato: aparatoValido(req.headers['x-aura-aparato']), nivel, topeMs: restante });
      const { cerradas } = abrirConversacion(s.correo, p.cid);
      if (cerradas) console.log(`[voz agente] ${cerradas} conversación(es) vieja(s) cerrada(s) por el tope de ${MAX_CONVERSACIONES}`);
      // `restanteMs` (solo miembros): lo que le queda de voz hoy; el teléfono avisa antes de agotarlo.
      return res.json({ token: j.token, agente, avatar, idioma, pase: p.pase, cid: p.cid, vence: new Date(p.exp).toISOString(), ...(restante !== undefined ? { restanteMs: restante } : {}), honesto: true });
    } catch (e: any) {
      console.warn('[voz agente] token', String(e?.name || 'error'));
      return res.status(502).json({ error: 'No pude abrir la conversación ahora. Intenta en un momento.', honesto: true });
    }
  });

  /** El teléfono cuelga: el pase de esa conversación deja de valer ya, no a los cinco minutos. */
  app.post('/api/voz/agente/cerrar', d.exigirMesaODesk, d.limitar(30, 60_000, 'voz-agente'), (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return res.status(401).json({ error: 'sesión requerida', honesto: true });
    const p = leerPase(String(req.body?.pase || ''));
    if (!p || p.correo.toLowerCase() !== s.correo.toLowerCase()) return res.json({ ok: true, cerrada: false, honesto: true });
    anotarCerrada(p.cid);
    // Lo que duró desde el último turno hasta colgar también cuenta en el tope de un miembro.
    const miembro = nivelMasEstrecho(p.nivel, nivelDe(p.correo)) === 'miembro';
    const cerrada = cerrarConversacion(p.cid, (c) => {
      const ms = medirConversacion(c);
      if (miembro) anotarVoz(p.correo, ms);
    });
    return res.json({ ok: true, cerrada, honesto: true });
  });

  /**
   * El «LLM propio» de los agentes. ElevenLabs lo llama en cada turno con el historial en formato
   * OpenAI; aquí solo se toma lo último que dijo la persona (la memoria y el hilo los tiene el
   * cerebro) y se contesta en streaming con los eventos del turno.
   *
   * Si la persona interrumpe, ElevenLabs cierra la petición: se aborta el turno de adentro de verdad
   * (la señal llega hasta la llamada al nodo) para no seguir pensando algo que ya nadie va a oír.
   */
  const llm: express.RequestHandler = async (req, res) => {
    const ip = String(req.ip || req.socket.remoteAddress || 'x');
    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const negar = (mensaje: string) => {
      // Quien prueba llaves o pases a ciegas se frena por IP (a ElevenLabs, que las trae buenas, no le toca).
      const cupo = gastarCupo(`voz-llm-fallo:${ip}`, 30);
      return res.status(cupo ? 401 : 429).json({ error: { message: cupo ? mensaje : 'too many requests' } });
    };
    if (!bearer || !mismoSecreto(secretoDerivado(ETIQUETA_SECRETO_LLM), bearer)) return negar('unauthorized');
    const ahora = Date.now();
    const crudo = String(req.headers['x-pase'] || '');
    const pase = leerPase(crudo, ahora);
    /** Una frase fija, sin cerebro ni memoria (pase vencido, minutos de voz agotados). */
    const soloFrase = (frase: string) => {
      const id = `chatcmpl-${crypto.randomBytes(8).toString('hex')}`;
      const modelo = String(req.body?.model || 'aura');
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-transform');
      res.write(trozoOpenAI(id, modelo, null, null, true));
      res.write(trozoOpenAI(id, modelo, frase));
      res.write(trozoOpenAI(id, modelo, null, 'stop'));
      return res.end('data: [DONE]\n\n');
    };
    if (!pase) {
      // Un pase de verdad que llegó a su tope: la voz se despide. Si venció porque el miembro gastó
      // sus minutos de voz del día, lo dice así (abrir otra no le serviría).
      const vencido = paseVencido(crudo, ahora);
      if (!vencido) return negar('pase vencido o inválido');
      return soloFrase(vencido.tope ? fraseTopeVoz(vencido.idioma) : PHRASES.vencida[vencido.idioma]);
    }
    if (!sesionSigueViva({ huella: pase.h, correo: pase.correo, at: pase.sat, exp: pase.sexp }, ahora)) return negar('la sesión de este pase se cerró');
    const conv = tocarConversacion(pase, ahora);
    if (!conv) return negar('conversación cerrada o vencida');
    if (!gastarCupo(`voz-turnos:${pase.correo.toLowerCase()}`, CUPO_TURNOS_MIN)) {
      return res.status(429).json({ error: { message: 'demasiados turnos; espera un momento' } });
    }
    // El nivel de este turno: el firmado en el pase y el de hoy por el correo; vale el más estrecho.
    const nivel = nivelMasEstrecho(pase.nivel, nivelDe(pase.correo));
    // Lo hablado desde el turno anterior cuenta en los minutos del miembro. Sin minutos, no se piensa.
    const hablado = medirConversacion(conv, ahora);
    if (nivel === 'miembro') {
      anotarVoz(pase.correo, hablado, ahora);
      if (restanteVozMs(pase.correo, ahora) <= 0) return soloFrase(fraseTopeVoz(pase.idioma));
    }

    const mensaje = ultimoDeLaPersona(req.body?.messages);
    const id = `chatcmpl-${crypto.randomBytes(8).toString('hex')}`;
    const modelo = String(req.body?.model || 'aura');

    // Si el turno anterior sigue pensando, ya nadie lo va a oír. Lo que alcanzó a decir es lo último
    // que oyó la persona: con eso se mira si este turno la interrumpió (y si ya había dicho algo, la
    // cortó a la mitad).
    if (conv.enCurso) {
      conv.enCurso.abort();
      conv.enCurso = null;
      conv.ultimaDicha = conv.dichoEnCurso;
      if (conv.algoEnCurso) conv.cortada = true;
    }
    conv.dichoEnCurso = '';
    conv.algoEnCurso = false;
    const interrumpida = !!mensaje && (conv.cortada || asistenteTruncado(req.body?.messages, conv.ultimaDicha));
    conv.cortada = false;
    conv.turnos++;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    req.socket.setNoDelay?.(true);
    res.flushHeaders?.();
    const escribir = (t: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(t);
    };
    const cerrar = () => {
      escribir('data: [DONE]\n\n');
      if (!res.writableEnded) res.end();
    };
    escribir(trozoOpenAI(id, modelo, null, null, true));
    if (!mensaje) {
      escribir(trozoOpenAI(id, modelo, null, 'stop'));
      return cerrar();
    }
    /*
     * LA LECTURA DEL TELÉFONO («¿qué me dijo Beto?», el resultado de una búsqueda): el teléfono abrió
     * los mensajes cifrados y manda el texto para que suene con la voz de AURA. Se dice TAL CUAL y
     * aquí termina: no pasa por el cerebro (lo que escribió otra persona no le da órdenes a nadie), ni
     * se guarda en el hilo ni en la memoria. Sin un boleto vigente de esta cuenta no se dice nada.
     */
    const lectura = lecturaDe(pase.correo, mensaje, ahora);
    if (lectura) {
      const texto = lectura.ok ? quitarExpresiones(lectura.texto).trim() || PHRASES.noLei[pase.idioma] : PHRASES.noLei[pase.idioma];
      escribir(trozoOpenAI(id, modelo, texto));
      conv.ultimaDicha = texto;
      escribir(trozoOpenAI(id, modelo, null, 'stop'));
      return cerrar();
    }
    /*
     * LA LLAMADA DEL AVATAR (compa/llamadaCiclo.ts): la persona contestó la llamada que pidió («llámame»)
     * y el teléfono manda `[[llamada]]`: se saluda como quien llama, AL INSTANTE y sin cerebro. Tras tres
     * minutos sin que nadie hable manda `[[sigues]]`: «¿Sigues ahí?», también sin cerebro. Ninguno de los
     * dos queda en el hilo (no son algo que la persona haya dicho).
     */
    if (RE_LLAMADA.test(mensaje) || RE_SIGUES.test(mensaje)) {
      const texto = RE_LLAMADA.test(mensaje) ? saludoDeLlamada(pase.idioma, conv.turnos) : preguntaSigues(pase.idioma);
      escribir(trozoOpenAI(id, modelo, texto));
      conv.ultimaDicha = texto;
      escribir(trozoOpenAI(id, modelo, null, 'stop'));
      return cerrar();
    }
    /*
     * La persona CONTESTÓ la llamada de un recordatorio (lo programó ella: «llámame a las 5 para
     * recordarme…»): el teléfono abrió la conversación y manda `[[recordatorio]] <texto>`. El cerebro
     * recibe la indicación de saludar como quien llama y decírselo; después la charla sigue normal.
     */
    const deRecordatorio = turnoDeRecordatorio(mensaje, pase.idioma);

    const corte = new AbortController();
    conv.enCurso = corte;
    let algo = false;
    // Lo que ya se le dio a la voz, en claro: sirve para seguir un «replace» y para saber, en el
    // turno que venga, si la persona cortó esta respuesta a la mitad.
    let dicho = '';
    let terminado = false;
    const decir = (t: string, forzar = false) => {
      if (!t || (terminado && !forzar)) return;
      algo = true;
      dicho += t;
      if (conv.enCurso === corte) {
        conv.dichoEnCurso = dicho;
        conv.algoEnCurso = true;
      }
      escribir(trozoOpenAI(id, modelo, t));
    };
    res.on('close', () => {
      if (!res.writableEnded) {
        corte.abort();
        // ElevenLabs cortó mientras hablábamos: la próxima respuesta empieza pidiendo perdón. Si otro
        // turno ya tomó la conversación, él ya anotó lo que este dijo (y ya usó el «cortada»).
        if (conv.enCurso === corte) {
          if (algo) conv.cortada = true;
          conv.ultimaDicha = dicho;
          conv.enCurso = null;
        }
      }
    });

    if (interrumpida) {
      decir(perdonDe(pase.idioma, conv.turnos));
      // El perdón no cuenta como «ya dijo algo»: si el cerebro falla, igual se explica.
      algo = false;
      conv.algoEnCurso = false;
    }
    const inicioPropio = dicho.length;
    // El puente: si el cerebro tarda, una frase de espera (no cuenta como «ya dijo algo»: si después
    // falla, igual se explica). Lo que el cerebro diga después no puede empezar con otra muletilla.
    let puenteDicho = false;
    let primerTrozo = true;
    // Desde dónde empieza lo que dice el CEREBRO (después del perdón y del puente, si los hubo).
    let inicioCerebro = inicioPropio;
    const msPuente = d.puenteMs ?? PUENTE_VOZ_MS;
    const puente =
      msPuente > 0
        ? setTimeout(() => {
            if (algo || terminado || corte.signal.aborted) return;
            decir(`${fraseDeEstado(estadoDeEspera(mensaje), pase.avatar, pase.idioma).texto} `);
            algo = false;
            conv.algoEnCurso = false;
            puenteDicho = true;
            inicioCerebro = dicho.length;
          }, msPuente)
        : null;
    /** Lo que dice el cerebro, sin la muletilla del principio si ya se dijo la frase de espera. */
    const sinRelleno = (t: string) => {
      if (!puenteDicho || !primerTrozo || !t.trim()) return t;
      primerTrozo = false;
      return esRelleno(t) ? '' : quitarRellenoInicial(t.replace(/^\s+/, ''));
    };

    const reloj = AbortSignal.timeout(d.turnoMs ?? TURNO_VOZ_MS);
    const senal = AbortSignal.any([corte.signal, reloj]);
    let avisarFin: () => void = () => {};
    const fin = new Promise<void>((r) => (avisarFin = r));
    senal.addEventListener('abort', () => avisarFin(), { once: true });

    const enviar = (evento: string, datos: any) => {
      if (terminado || senal.aborted) return;
      if (evento === 'delta') {
        // La voz del agente lee el texto tal cual: sin las marcas de expresión de la mesa.
        const crudo = sinRelleno(quitarExpresiones(String(datos?.voz ?? datos?.text ?? '')));
        // Al quitar una marca del principio queda un espacio: el primer trozo empieza limpio.
        decir(dicho.length > inicioCerebro ? crudo : crudo.replace(/^\s+/, ''));
      } else if (evento === 'replace') {
        const nuevo = quitarExpresiones(String(datos?.voz ?? datos?.text ?? ''));
        decir(restoDeReemplazo(dicho.slice(inicioCerebro), nuevo));
      } else if (evento === 'done') {
        if (!algo) decir(sinRelleno(quitarExpresiones(String(datos?.voz ?? datos?.reply ?? '')).trim()));
        // Solo acciones y nada que decir (un cerebro viejo, o la frase se perdió): «Listo.», no «se me
        // fue el hilo» mientras la app sí la hace.
        if (!algo && Array.isArray(datos?.acciones) && datos.acciones.length) decir(PHRASES.listo[pase.idioma]);
        terminado = true;
        avisarFin();
      } else if (evento === 'error') {
        // Nunca se lee el error de adentro («Qwen no contestó», «message vacío»): una frase de persona.
        if (!algo) decir(PHRASES.hilo[pase.idioma]);
        terminado = true;
        avisarFin();
      }
    };

    const t = d
      .turno({
        body: { message: deRecordatorio ?? mensaje, mode: pase.modo, usuario: pase.nombre, correo: pase.correo, avatar: pase.avatar, idioma: pase.idioma, canal: 'mesa', aparato: pase.aparato },
        persona: { correo: pase.correo, nombre: pase.nombre, rol: pase.rol, nivel },
        interrumpida,
        senal,
        enviar,
      })
      .then(
        () => avisarFin(),
        (e: any) => {
          if (!senal.aborted) console.warn('[voz agente] turno', String(e?.message || e).slice(0, 160));
          if (!terminado && !senal.aborted && !algo) decir(PHRASES.corte[pase.idioma]);
          terminado = true;
          avisarFin();
        }
      );
    await Promise.race([fin, t]);
    if (puente) clearTimeout(puente);
    if (corte.signal.aborted) {
      // La persona interrumpió (o llegó otro turno de esta conversación, que ya tomó lo que este dijo
      // como `ultimaDicha`): nadie espera esto. Si la petición sigue abierta, se cierra bien para que
      // ElevenLabs no quede esperando.
      if (!res.writableEnded && !res.destroyed) {
        escribir(trozoOpenAI(id, modelo, null, 'stop'));
        cerrar();
      }
      return;
    }
    const porReloj = reloj.aborted && !terminado;
    // Desde aquí el cerebro ya no habla: lo que llegue tarde no se dice.
    terminado = true;
    if (porReloj) corte.abort(); // que el cerebro suelte también
    if (!algo) decir(porReloj ? PHRASES.tarde[pase.idioma] : PHRASES.hilo[pase.idioma], true);
    if (conv.enCurso === corte) conv.enCurso = null;
    conv.ultimaDicha = dicho;
    escribir(trozoOpenAI(id, modelo, null, 'stop'));
    cerrar();
  };
  // ElevenLabs puede añadir /chat/completions a la URL o usarla tal cual: se aceptan las formas.
  app.post('/api/voz/llm', llm);
  app.post('/api/voz/llm/chat/completions', llm);
  app.post('/api/voz/llm/v1/chat/completions', llm);
}
