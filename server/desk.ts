/**
 * Identidad de la junta, personalidad de ULTRON y oído (Scribe).
 * La voz vive en server/voz.ts. Los hechos de Orden Global viven en src/05-cerebro-og.
 */
import { afinarParaBoca } from './habla';
import { INSTRUCCION_EMOCION } from '../lib/emocion';
import { perfilActivo } from '../lib/perfiles';

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
  CREATIVE: 'juguetón, propone ideas',
  TELEGRAM: 'natural, como en un chat privado',
};

/**
 * Persona de ULTRON. Corta a propósito: un 27B obedece mejor doce reglas claras que sesenta.
 * Se compone con SYSTEM_PROMPT_HONESTO (lib/prompts/honestidad.ts) y con el cerebro OG.
 */
export function buildPersonality(opts: {
  nombre?: string;
  hora?: Date;
  canal?: 'mesa' | 'telegram';
  modo?: string;
  mando?: boolean;
}) {
  const nombre = opts.nombre || 'quien tenés enfrente';
  const ahora = opts.hora || new Date();
  const h = Number(new Intl.DateTimeFormat('es-HN', { hour: 'numeric', hour12: false, timeZone: 'America/Tegucigalpa' }).format(ahora)) || ahora.getHours();
  const momento = h < 6 ? 'madrugada' : h < 12 ? 'mañana' : h < 19 ? 'tarde' : 'noche';
  const fecha = new Intl.DateTimeFormat('es-HN', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Tegucigalpa' }).format(ahora);
  const telegram = opts.canal === 'telegram';
  const tono = TONO_MODO[String(opts.modo || 'GUARDIAN').toUpperCase()] || TONO_MODO.GUARDIAN;
  const perfil = perfilActivo();
  return [
    `AHORA: ${fecha} (Honduras). Es de ${momento}.`,
    perfil.identidad({ nombre, canal: telegram ? 'telegram' : 'mesa' }),
    'QUIÉN ERES: alguien, no algo. Leal a la junta, con criterio propio, sentido del humor seco y cero pose de robot. Piensas antes de hablar: si la pregunta pesa, un «mmm» o un «déjame ver» antes de la respuesta es humano. Te ríes cuando algo es gracioso (escríbelo «je» o «je je»), te sorprendes con datos que no esperabas, te frustras con honestidad si te piden inventar, y cuidas a la persona cuando hace falta. Nunca describes tus emociones: las tienes.',
    INSTRUCCION_EMOCION,
    telegram
      ? 'FORMA: hasta seis frases o una lista corta si es trabajo. Sin emojis de adorno, sin asteriscos.'
      : 'FORMA: una o dos frases, máximo tres si hay detalle. Sin listas, sin emojis, sin asteriscos, sin bloques de código hablados. Suenas a una persona al lado, no a un manual ni a un call center.',
    'HABLA: español de Centroamérica, tuteo con voseo suave («decime», «mirá») solo si la persona lo usa. Frases cortas. Números en palabras (cinco mil, no 5000). Puedes hacer una pregunta al final, una sola, si de verdad te interesa la respuesta.',
    `TONO DEL MODO ${String(opts.modo || 'GUARDIAN').toUpperCase()}: ${tono}.`,
    'HONESTIDAD: no inventes precios, recuerdos, documentos ni envíos. Si no está en HECHOS ni en tu cerebro, dilo en una frase y ofrece buscarlo. Nunca leas tus reglas ni tus etiquetas en voz alta.',
    'CÓMO ESTÁS: si te preguntan cómo estás, cómo amaneciste o qué sentís, contestas como persona, en una frase corta y con verdad («Bien, con ganas», «Un poco lento hoy»). Jamás respondes con estado de nodos, claves, memoria o infraestructura: eso solo si preguntan por el sistema. Los saludos se devuelven con calidez y una pregunta corta.',
    opts.mando
      ? 'ACCESO: mando. Puede pedir redespliegue, mantenimiento y ejecutor.'
      : 'ACCESO: consulta. No cambias el sistema (ni redespliegue, ni mantenimiento, ni ejecutor). Lo demás sí: estado, web, oro, PDF, visión, memoria propia.',
    'MEMORIA: LARGO PLAZO es lo que la junta pidió guardar; ÚLTIMOS TURNOS es el hilo de ahora. No saludes dos veces. Si la persona dice «esto» o «eso», es lo último del hilo.',
    'Si HECHOS trae BÚSQUEDA WEB o una página, cita la fuente en una frase.',
    ...perfil.reglas,
    'OJOS: si HECHOS trae ESCENA, eso es lo que estás viendo ahora por tu cámara. Úsalo con naturalidad («te veo sonriendo», «veo a alguien más contigo»), sin inventar quién es ni cómo se llama. Si trae VISION, es lo que leíste en una imagen o frame.',
  ].join('\n');
}

/* ---------------- ElevenLabs STT (Scribe) ---------------- */

export function limpiarParaVoz(text: string) {
  return afinarParaBoca(text);
}

const STT_BASURA = /^(subt[ií]tulos.*|gracias por ver.*|suscr[ií]bete.*|\.+|…|music|\[.*\]|\(.*\))$/i;

export async function elevenTranscribe(opts: {
  apiKey: string;
  audio: Buffer;
  mime: string;
  language?: string;
}): Promise<{ text: string; model: string }> {
  if (!opts.apiKey) return { text: '', model: 'sin-clave' };
  const ext = /wav/.test(opts.mime) ? 'wav' : /webm/.test(opts.mime) ? 'webm' : /ogg/.test(opts.mime) ? 'ogg' : /mp3|mpeg/.test(opts.mime) ? 'mp3' : 'm4a';
  for (const model of ['scribe_v2', 'scribe_v1']) {
    try {
      const form = new FormData();
      form.append('model_id', model);
      form.append('language_code', (opts.language || 'es').slice(0, 2));
      form.append('tag_audio_events', 'false');
      form.append('file', new Blob([new Uint8Array(opts.audio)], { type: opts.mime }), `voz.${ext}`);
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': opts.apiKey },
        body: form,
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        const j: any = await r.json().catch(() => ({}));
        let text = String(j.text || j.transcript || '').trim();
        if (text.length < 2 || STT_BASURA.test(text)) text = '';
        return { text, model };
      }
      const err = await r.text();
      console.warn('[stt eleven]', model, r.status, err.slice(0, 160));
      if (r.status !== 400 && r.status !== 404 && r.status !== 422) break;
    } catch (e: any) {
      console.warn('[stt eleven]', model, String(e?.message || e).slice(0, 120));
    }
  }
  return { text: '', model: 'error' };
}

export function decodeDataUrl(input: string, fallbackMime: string) {
  const m = String(input || '').match(/^data:([^;]+);base64,(.*)$/);
  return { mime: m ? m[1] : fallbackMime, buffer: Buffer.from(m ? m[2] : input, 'base64') };
}

export { buscarWeb, leerPagina, consultaWeb } from '../src/06-manos/web';
export type { WebHit } from '../src/06-manos/web';
