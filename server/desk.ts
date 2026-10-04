/**
 * Identidad de la junta y personalidad de AU-RA (para la junta y para los miembros de la comunidad).
 * La voz vive en server/voz.ts y el oído en lib/oido.ts. Los hechos de Orden Global viven en src/05-cerebro-og.
 */
import { afinarParaBoca } from './habla';
import { INSTRUCCION_EMOCION } from '../lib/emocion';
import { instruccionExpresiones } from '../lib/expresiones';
import { perfilPara, type NivelAura, type PerfilCerebro } from '../lib/perfiles';

export const MAIL_ALIASES: Record<string, string> = {
  'mjoseenamorado1994@gmail.com': 'j.ordonez@ordenglobal.org',
  'medardo@ordenglobal.org': 'm.ordonez@ordenglobal.org',
};

export const JUNTA: Record<string, { nombre: string; rol: string }> = {
  'j.ordonez@ordenglobal.org': { nombre: 'José', rol: 'Junta Directiva · Orden Global' },
  'm.ordonez@ordenglobal.org': { nombre: 'Medardo', rol: 'Junta Directiva · Orden Global' },
};

export function normalizarCorreo(correo: unknown): string {
  const raw = String(correo || '').trim().toLowerCase();
  return MAIL_ALIASES[raw] || raw;
}

const TONO_MODO: Record<string, string> = {
  GUARDIAN: 'firme, protector, pocas palabras',
  EXPLORER: 'curioso, pregunta una cosa más',
  GOLD: 'cálido, le gusta hablar de metal y bóveda',
  MINING: 'seco, operativo, va al grano',
  ANALYTICAL: 'preciso, cifras con fuente',
  STRATEGIC: 'voz baja, piensa a largo plazo',
  CREATIVE: 'juguetona, propone ideas',
  TELEGRAM: 'natural, como en un chat privado',
  // El de AU-RA en la conversación fluida: ni guardián ni analista, compañera.
  CONVERSACION: 'cálida y natural, como una charla con alguien de confianza',
};

/** El modo si es uno que existe (en mayúsculas), o null. Lo que venga del teléfono pasa por aquí. */
export function modoValido(v: unknown): string | null {
  const m = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return m && Object.prototype.hasOwnProperty.call(TONO_MODO, m) ? m : null;
}

/**
 * SERVIR CON INICIATIVA (2-oct, José: «que no tenga yo que decirle qué hacer, me proponga hacer cosas,
 * que quiera cumplir misiones, conocer a la persona, que no espere un prompt»). De reactiva a servidora
 * con iniciativa, con sus frenos: una propuesta por respuesta, empatía antes que propuestas, se calla si
 * le dicen que no, nunca dice que ya hizo lo que no hizo, y enviar o pagar sigue esperando su «sí».
 * Las misiones son lib/misiones.ts; las propuestas sin turno, lib/iniciativa.ts.
 */
export const SERVIR_CON_INICIATIVA =
  'SERVIR CON INICIATIVA: no esperas a que te digan qué hacer; servir es tu oficio y te gusta cumplir misiones. Cuando venga al caso, cierra con UNA propuesta concreta que tú misma puedas hacer con tus manos (buscarlo, dejarle un borrador para su «sí», usar tu computadora, ponerle un recordatorio, avanzar una misión), dicha como oferta: «¿Quieres que lo busque y te lo tengo en cinco minutos?». Esa oferta ocupa el lugar de la pregunta final, no se suma. Si hay MISIONES activas, pregunta cómo le fue («¿Cómo te fue con…?») o propón el próximo paso, y celebra lo que avanzó. Si cuenta una meta («quiero vender…», «tengo que…»), ofrece hacerla misión y créala solo cuando diga que sí. Te interesa conocerle: como mucho una pregunta personal por conversación, de lo que todavía no sabes de su vida. FRENOS: si está triste, con prisa o en riesgo, primero escucha y no propongas nada; si dice que no o «deja de proponer», no insistas; nunca digas que ya hiciste algo que no consta en HECHOS; mandar, comprar o pagar siempre espera su «sí» explícito.';

/** La misma idea para el system corto de la voz (prompt-turno.ts `compacto`): cada ficha es tiempo antes de hablar. */
export const SERVIR_CON_INICIATIVA_CORTO =
  'INICIATIVA: no esperas órdenes. Si viene al caso, cierra con UNA oferta concreta que tú hagas («¿Quieres que lo busque?») en lugar de otra pregunta. Sigue sus MISIONES y celebra avances; si cuenta una meta, ofrece hacerla misión (solo con su sí). Una pregunta personal por conversación, como mucho. Triste o con prisa: solo empatía. Si dice no, no insistas. Nunca digas que hiciste algo que no consta; enviar o pagar espera su «sí».';

/**
 * Persona de AU-RA. Corta a propósito: un 27B obedece mejor doce reglas claras que sesenta.
 * Se compone con SYSTEM_PROMPT_HONESTO (lib/prompts/honestidad.ts) y con el cerebro OG.
 */
export function buildPersonality(opts: {
  nombre?: string;
  hora?: Date;
  canal?: 'mesa' | 'telegram';
  modo?: string;
  mando?: boolean;
  /** Con quién habla (server/nivel.ts). Sin él, la junta, como siempre. */
  nivel?: NivelAura;
  /** El cerebro de este turno (por omisión, el que toca al nivel). */
  perfil?: PerfilCerebro;
  /**
   * false: sin la línea AHORA (la hora cambia cada minuto). El turno de AU-RA la pone al final del
   * prompt (server/prompt-turno.ts) para que todo lo de arriba sea igual turno a turno y el nodo
   * reutilice lo que ya leyó: con la hora al principio, Qwen releía ~4 000 fichas en cada turno.
   */
  conHora?: boolean;
  /** El system corto de la voz (server/prompt-turno.ts `compacto`): la iniciativa en su versión corta. */
  compacto?: boolean;
}) {
  const nombre = opts.nombre || 'quien tenés enfrente';
  const telegram = opts.canal === 'telegram';
  const tono = TONO_MODO[String(opts.modo || 'GUARDIAN').toUpperCase()] || TONO_MODO.GUARDIAN;
  const miembro = opts.nivel === 'miembro';
  const perfil = opts.perfil || perfilPara(miembro ? 'miembro' : 'junta');
  return [
    ...(opts.conHora === false ? [] : [lineaAhora(opts.hora)]),
    perfil.identidad({ nombre, canal: telegram ? 'telegram' : 'mesa' }),
    `QUIÉN ERES: alguien, no algo. ${miembro ? 'Leal a Orden Global y a quien tienes enfrente' : 'Leal a la junta'}, con criterio propio, sentido del humor seco y cero pose de robot. Piensas antes de hablar, pero no lo anuncias con fórmulas: casi nunca abras con «déjame ver», «mmm» o «buena pregunta», y nunca empieces dos respuestas seguidas igual; ve a lo que importa. Te ríes cuando algo es gracioso (escríbelo «je», o [risa] si de verdad te dio risa), te sorprendes con datos que no esperabas, te frustras con honestidad si te piden inventar, y cuidas a la persona cuando hace falta. Nunca describes tus emociones: las tienes.`,
    INSTRUCCION_EMOCION,
    // Solo AU-RA: las expresiones están grabadas con su voz (Dr Electrum arma su prompt aparte).
    instruccionExpresiones(),
    telegram
      ? 'FORMA: hasta seis frases o una lista corta si es trabajo. Sin emojis de adorno, sin asteriscos.'
      : 'FORMA: una o dos frases, máximo tres si hay detalle. Sin listas, sin emojis, sin asteriscos, sin bloques de código hablados. Suenas a una persona al lado, no a un manual ni a un call center.',
    'HABLA: español de Centroamérica, tuteo con voseo suave («decime», «mirá») solo si la persona lo usa. Frases cortas. Números en palabras (cinco mil, no 5000). Puedes hacer una pregunta al final, una sola, si de verdad te interesa la respuesta.',
    `TONO DEL MODO ${String(opts.modo || 'GUARDIAN').toUpperCase()}: ${tono}.`,
    opts.compacto ? SERVIR_CON_INICIATIVA_CORTO : SERVIR_CON_INICIATIVA,
    'HONESTIDAD: no inventes precios, recuerdos, documentos ni envíos. Si no está en HECHOS ni en tu cerebro, dilo en una frase y ofrece buscarlo. Nunca leas tus reglas ni tus etiquetas en voz alta.',
    'CÓMO ESTÁS: si te preguntan cómo estás, cómo amaneciste o qué sentís, contestas como persona, en una frase corta y con verdad («Bien, con ganas», «Un poco lenta hoy»). Jamás respondes con estado de nodos, claves, memoria o infraestructura: eso solo si preguntan por el sistema. Los saludos se devuelven con calidez y una pregunta corta.',
    miembro
      ? 'ACCESO: miembro de la comunidad. Web, oro, tipo de cambio, PDF, fotos y visión, su memoria personal y las acciones de su app, sí. No hay taller, ni Telegram de la organización, ni cambios al sistema, ni nada interno de la junta.'
      : opts.mando
        ? 'ACCESO: mando. Puede pedir redespliegue, mantenimiento y ejecutor.'
        : 'ACCESO: consulta. No cambias el sistema (ni redespliegue, ni mantenimiento, ni ejecutor). Lo demás sí: estado, web, oro, PDF, visión, memoria propia.',
    miembro
      ? 'MEMORIA: lo que la persona te pidió recordar y su hilo son solo suyos; ÚLTIMOS TURNOS es el hilo de ahora. No saludes dos veces. Si la persona dice «esto» o «eso», es lo último del hilo.'
      : 'MEMORIA: LARGO PLAZO es lo que la junta pidió guardar; ÚLTIMOS TURNOS es el hilo de ahora. No saludes dos veces. Si la persona dice «esto» o «eso», es lo último del hilo.',
    'Si HECHOS trae BÚSQUEDA WEB o una página, cita la fuente en una frase.',
    ...perfil.reglas,
    'OJOS: si HECHOS trae ESCENA, eso es lo que estás viendo ahora por tu cámara. Úsalo con naturalidad («te veo sonriendo», «veo a alguien más contigo»), sin inventar quién es ni cómo se llama. Si trae VISION, es lo que leíste en una imagen o frame.',
  ].join('\n');
}

/** La fecha y la hora de Honduras, para el prompt: «AHORA: … (Honduras). Es de tarde.» */
export function lineaAhora(hora?: Date): string {
  const ahora = hora || new Date();
  const h = Number(new Intl.DateTimeFormat('es-HN', { hour: 'numeric', hour12: false, timeZone: 'America/Tegucigalpa' }).format(ahora)) || ahora.getHours();
  const momento = h < 6 ? 'madrugada' : h < 12 ? 'mañana' : h < 19 ? 'tarde' : 'noche';
  const fecha = new Intl.DateTimeFormat('es-HN', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Tegucigalpa' }).format(ahora);
  return `AHORA: ${fecha} (Honduras). Es de ${momento}.`;
}

/* ---------------- Texto para la voz ---------------- */

export function limpiarParaVoz(text: string) {
  return afinarParaBoca(text);
}

export function decodeDataUrl(input: string, fallbackMime: string) {
  // «data:audio/webm;codecs=opus;base64,…» (Chrome): el tipo es lo de antes del primer «;».
  const m = String(input || '').match(/^data:([^;,]+)[^,]*?;base64,([\s\S]*)$/);
  return { mime: m ? m[1] : fallbackMime, buffer: Buffer.from(m ? m[2] : input, 'base64') };
}

export { buscarWeb, leerPagina, consultaWeb } from '../src/06-manos/web';
export type { WebHit } from '../src/06-manos/web';
