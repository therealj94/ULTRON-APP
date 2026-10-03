/**
 * EL CEREBRO RÁPIDO DE LA VOZ (José, 3-oct: «ChatGPT y Grok son fluidos y nosotros, con lo mejor, tan
 * lento… le cuesta responder rápido preguntas sencillas»).
 *
 * Medido en las llamadas de José (ElevenLabs y los logs `[voz] turno`): el oído tarda 0,03–0,05 s y la
 * voz 0,08 s; el que tardaba era el cerebro, el Qwen 27B en una sola A10G: 1,5–2,3 s hasta la primera
 * palabra en preguntas normales.
 *
 * Probado el 3-oct en Bedrock (cuenta de AWS de José, us-west-2) con el prompt REAL de un turno hablado
 * (~5 600 fichas; scripts/voz/evaluar-cerebro-rapido.ts): Nova 2 Lite 0,5 s pero se equivoca en datos
 * («febrero bisiesto tiene 30 días»); Qwen3 Next 0,65 s pero inventa (el precio del oro, un partido);
 * Qwen3 235B 0,77 s (0,5–0,95) y acierta, y si le falta un dato de hoy lo dice. Por omisión, ese.
 *
 * Ninguno hace las ACCIONES tan bien como nuestro Qwen ya afinado (WhatsApp, «llámame», recordatorios),
 * así que por aquí van solo los turnos hablados que son conversación (esSoloConversacion); los que piden
 * hacer algo siguen con Qwen. Escribe con el MISMO prompt y mensajes que Qwen y su texto pasa por el
 * mismo camino (server.ts turnoEnVivo, `procesar`). Si le piden hacer algo igual, contesta «PASO» y el
 * turno lo toma Qwen: nunca dice que hizo algo sin hacerlo.
 *
 * Si Bedrock falla, no tiene permiso o no da la primera palabra a tiempo, contesta Qwen como siempre; tres
 * fallos seguidos lo apagan un rato (lib/cognitivo/interruptor.ts). Se apaga del todo con CEREBRO_VOZ=qwen
 * y se cambia el modelo con CEREBRO_VOZ_MODELO (variables del servidor, sin desplegar código).
 *
 * Usa las credenciales de AWS que el servidor ya tiene (las de S3).
 */
import { BedrockRuntimeClient, ConverseStreamCommand, type Message, type SystemContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { anotarExito, anotarFallo, disponible } from './cognitivo/interruptor';

export const MODELO_RAPIDO_OMISION = 'qwen.qwen3-235b-a22b-2507-v1:0';

function conf() {
  return {
    modo: String(process.env.CEREBRO_VOZ || 'nova').toLowerCase(),
    modelo: String(process.env.CEREBRO_VOZ_MODELO || MODELO_RAPIDO_OMISION),
    region: String(process.env.CEREBRO_VOZ_REGION || 'us-west-2'),
    /** Sin la primera palabra en este rato, contesta Qwen. */
    primeraMs: Number(process.env.CEREBRO_VOZ_PRIMERA_MS || 2500),
  };
}

export function modeloRapido(): string {
  return conf().modelo;
}

/** ¿Se usa en este servidor? (modo, credenciales y que no esté en pausa por fallos). */
export function cerebroRapidoActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.CEREBRO_VOZ || 'nova').toLowerCase() === 'qwen') return false;
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return false;
  return disponible('cerebro_rapido');
}

let cliente: BedrockRuntimeClient | null = null;
function bedrock(): BedrockRuntimeClient {
  if (!cliente) cliente = new BedrockRuntimeClient({ region: conf().region, maxAttempts: 1 });
  return cliente;
}

export type MensajeChat = { role: string; content: string };

/**
 * Los mensajes de Qwen (system + hilo + el del turno) en la forma de Bedrock: el system aparte, los
 * demás alternando persona/asistente, empezando y terminando por la persona (Bedrock lo exige). Dos
 * seguidos del mismo lado se juntan.
 */
export function aBedrock(mensajes: MensajeChat[]): { system: SystemContentBlock[]; messages: Message[] } {
  const system: SystemContentBlock[] = [];
  const messages: Message[] = [];
  for (const m of mensajes) {
    const texto = String(m.content ?? '').trim();
    if (!texto) continue;
    if (m.role === 'system') {
      system.push({ text: texto });
      continue;
    }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (!messages.length && role === 'assistant') continue;
    const ultimo = messages[messages.length - 1];
    if (ultimo && ultimo.role === role) {
      const prev = (ultimo.content?.[0] as { text?: string })?.text || '';
      ultimo.content = [{ text: `${prev}\n\n${texto}` }];
    } else messages.push({ role, content: [{ text: texto }] });
  }
  while (messages.length && messages[messages.length - 1].role !== 'user') messages.pop();
  return { system, messages };
}

/**
 * El texto del cerebro rápido a trozos, mientras lo escribe. Lanza si no se puede (sin permiso, sin red, sin la
 * primera palabra a tiempo): quien llama contesta con Qwen. Un corte de la persona (`senal`) no cuenta
 * como fallo.
 */
export async function* hablarRapido(mensajes: MensajeChat[], senal?: AbortSignal, o: { maxTokens?: number } = {}): AsyncGenerator<string> {
  const c = conf();
  const { system, messages } = aBedrock(mensajes);
  if (!messages.length) throw new Error('sin mensaje de la persona');
  const corte = new AbortController();
  const alCortar = () => corte.abort();
  senal?.addEventListener('abort', alCortar, { once: true });
  const vence = setTimeout(() => corte.abort(new Error('sin primera palabra a tiempo')), c.primeraMs);
  let alguna = false;
  try {
    const r = await bedrock().send(
      new ConverseStreamCommand({
        modelId: c.modelo,
        system,
        messages,
        inferenceConfig: { maxTokens: o.maxTokens ?? 700, temperature: 0.6 },
      }),
      { abortSignal: corte.signal }
    );
    for await (const ev of r.stream || []) {
      const t = ev.contentBlockDelta?.delta?.text;
      if (t) {
        if (!alguna) {
          alguna = true;
          clearTimeout(vence);
        }
        yield t;
      }
      if (ev.internalServerException || ev.modelStreamErrorException || ev.throttlingException || ev.validationException || ev.serviceUnavailableException) {
        throw new Error(String((ev.internalServerException || ev.modelStreamErrorException || ev.throttlingException || ev.validationException || ev.serviceUnavailableException)?.message || 'error de Bedrock'));
      }
    }
    anotarExito('cerebro_rapido');
  } catch (e) {
    if (!senal?.aborted) anotarFallo('cerebro_rapido');
    throw e;
  } finally {
    clearTimeout(vence);
    senal?.removeEventListener('abort', alCortar);
  }
}

/** Prueba de arranque (una sola, barata): ¿contesta Bedrock con estas credenciales? Para los logs. */
export async function probarCerebroRapido(): Promise<{ ok: boolean; ms: number; detalle?: string }> {
  const t0 = Date.now();
  try {
    let texto = '';
    for await (const t of hablarRapido([{ role: 'user', content: 'Responde solo: listo' }], undefined, { maxTokens: 5 })) texto += t;
    return { ok: !!texto.trim(), ms: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - t0, detalle: String(e?.name || '') + ': ' + String(e?.message || e).slice(0, 160) };
  }
}

/* ------------------------------------------------------------------ qué turnos van por aquí */

/**
 * Probado el 3-oct con el prompt real (scripts/voz/evaluar-cerebro-rapido.ts): los modelos rápidos de
 * Bedrock hacen mal las ACCIONES (Nova 2 Lite, Nova Pro, Llama 3.3 70B, Qwen3 235B): «llámame en diez
 * minutos» → «te llamo» sin poner nada; un WhatsApp por los chats de AU-RA; la marca mal escrita. Por
 * aquí va solo lo que no pide hacer nada; lo demás sigue con Qwen.
 */
// Se compara sin tildes (se quitan antes): «escríbele», «llámame», «envíale», «recuérdame».
const PIDE_ALGO = new RegExp(
  [
    // hacer algo en el teléfono o afuera
    '\\b(abr[eai]\\w*|cierr\\w*|cerr\\w*|pon(me|lo|la|le|elo|ga|gas)?|poner\\w*|pongas?|cambi\\w*|apag\\w*|encend\\w*|enciend\\w*|prend\\w*|activ\\w*|desactiv\\w*|sub[ei]\\w*|baj[ae]\\w*)\\b',
    '\\b(escrib\\w*|mand\\w*|envi\\w*|respond\\w*|contest\\w*|reenvi\\w*|borr\\w*|descart\\w*|redact\\w*|comparte\\w*|compart\\w*)\\b',
    '\\b(llam\\w*|marc[ao]\\w*|recuerd\\w*|record\\w*|alarm\\w*|avis\\w*|despiert\\w*|agend\\w*|program\\w*|cancel\\w*|timer|temporizador)\\b',
    '\\b(busc\\w*|investig\\w*|averig\\w*|revis\\w*|lee\\w*|leer|leis\\w*|mir[ae]\\w*|ver\\s+(mi|la|el|lo)|fot\\w*|camara|pantalla|computadora|naveg\\w*|descarg\\w*|guard\\w*|anot\\w*|apunt\\w*|olvid\\w*|traduc\\w*)\\b',
    '\\b(music\\w*|cancion\\w*|reproduc\\w*|toca\\w*|cant[ae]\\w*|playlist|spotify|youtube|video\\w*|radio)\\b',
    // cosas que necesitan datos de afuera o del sistema
    '\\b(whats\\w*|wasap\\w*|correo\\w*|email\\w*|mensaje\\w*|chat\\w*|contacto\\w*|agenda|calendario|cita\\w*|reunion\\w*|pendiente\\w*|tarea\\w*|mision\\w*)\\b',
    '\\b(precio\\w*|cotiza\\w*|cuanto\\s+(esta|vale|cuesta|sale|hay)|oro|plata|cobre|dolar\\w*|lempira\\w*|euro\\w*|bitcoin|saldo|cartera|billetera|wallet|pag[aoeu]\\w*|transfer\\w*|origen|veta|auka|concesi\\w*|expediente\\w*|catastro|clima|tiempo\\s+(hace|va|en)|noticia\\w*|partido|resultado\\w*|hoy|ayer|anoche|manana)\\b',
    // la app misma
    '\\b(modo|tema|oscuro|claro|avatar|volumen|silencio|callate|calla|ajuste\\w*|perfil|idioma|ingles|espanol)\\b',
    // continuar o confirmar algo de antes
    '^\\s*(si|no|dale|va|ok(ay)?|listo|claro|hazlo|hagale|perfecto|eso|ese|esa|otra\\s+vez|de\\s+nuevo|y\\s+(en|a|el|la|si))\\b',
  ].join('|'),
  'i'
);

/** ¿Es una pregunta o charla que no pide hacer nada? (lo que contesta el cerebro rápido). */
export function esSoloConversacion(texto: string): boolean {
  const t = String(texto || '').trim();
  if (!t || t.length > 400) return false;
  const plano = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/gi, 'n');
  return !PIDE_ALGO.test(plano);
}

/**
 * Lo que se le dice al cerebro rápido al final del mensaje del turno: sin acciones. Si de todos modos le piden hacer
 * algo, contesta solo «PASO» y el turno lo toma Qwen (nunca dice que hizo algo sin hacerlo).
 */
export const SOLO_CONVERSAR_ES =
  'ESTE TURNO (solo hablar): contesta en voz, corto y natural. No escribas ACCION_APP ni PEDIR_HERRAMIENTA y no digas que hiciste, pusiste, mandaste o buscaste nada. Si la persona te pide HACER algo (abrir, escribir, mandar, llamar, recordar, buscar, mirar, pagar) o un dato de hoy que no está en los HECHOS (precios, clima, noticias, resultados), responde exactamente: PASO';
export const SOLO_CONVERSAR_EN =
  'THIS TURN (talk only): answer by voice, short and natural. Do not write ACCION_APP or PEDIR_HERRAMIENTA and never say you did, set, sent or searched anything. If the person asks you to DO something (open, write, send, call, remind, search, look, pay) or for today’s data not in the FACTS (prices, weather, news, scores), answer exactly: PASO';

/** ¿El cerebro rápido se echó para atrás? («PASO», con o sin etiqueta de ánimo delante). */
export function esPaso(inicio: string): boolean {
  return /^\s*(\[[^\]]{0,30}\]\s*)?PASO\b/i.test(inicio);
}

/** ¿Lo escrito hasta ahora todavía podría ser un «PASO»? (se espera antes de soltar nada). */
export function podriaSerPaso(inicio: string): boolean {
  const t = inicio.replace(/^\s*(\[[^\]]{0,30}\]\s*)?/, '');
  if (/^\s*\[[^\]]{0,30}$/.test(inicio)) return true; // la etiqueta todavía no cerró
  return t.length < 4 && 'PASO'.startsWith(t.trim().toUpperCase());
}
