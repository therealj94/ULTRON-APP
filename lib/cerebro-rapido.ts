/**
 * EL CEREBRO RÁPIDO Y CON MANOS DE AU-RA (José, 3-oct: «ChatGPT y Grok son fluidos y nosotros, con lo mejor,
 * tan lento…» y «le pedí que me llamara y no hizo la llamada… que haga bien sus manos»).
 *
 * Medido en las llamadas de José (ElevenLabs y los logs `[voz] turno`): el oído tarda 0,03–0,05 s y la voz
 * 0,08 s; el que tardaba era el cerebro, el Qwen 27B en una sola A10G: 1,5–2,3 s en charla y 3–10 s en
 * acciones, con las manos escritas como líneas de texto que tenía que recordar de memoria.
 *
 * Ahora el turno de la app, la voz y la mesa lo piensa un modelo de Bedrock con las manos como HERRAMIENTAS
 * de verdad (hablarConManos + lib/cerebro-manos.ts). Elegido con datos (scripts/voz/banco-cerebros.ts, con
 * el prompt real de AU-RA y los pedidos de José, la llamada del 3-oct incluida): GLM-5, 13–14 de 14, 0,8 s
 * a la primera reacción. Si no contesta a tiempo o falla antes de decir nada, el de respaldo (Kimi K2.5); si
 * tampoco, el Qwen 27B del nodo como siempre. Tres fallos seguidos lo apagan un rato
 * (lib/cognitivo/interruptor.ts). Se apaga del todo con CEREBRO_VOZ=qwen; el modelo se cambia con
 * CEREBRO_VOZ_MODELO y el respaldo con CEREBRO_VOZ_RESPALDO (variables del servidor, sin desplegar código).
 *
 * hablarRapido, esSoloConversacion y PASO son del camino anterior (solo charla, sin manos): siguen aquí para
 * la prueba de arranque y sus pruebas.
 *
 * Usa las credenciales de AWS que el servidor ya tiene (las de S3, con permiso solo para estos modelos).
 */
import { BedrockRuntimeClient, ConverseStreamCommand, type Message, type SystemContentBlock, type Tool } from '@aws-sdk/client-bedrock-runtime';
import { anotarExito, anotarFallo, disponible } from './cognitivo/interruptor';

/**
 * GLM-5 (Z.ai) en Bedrock. Medido el 3-oct con el prompt REAL de AU-RA y los pedidos de José
 * (scripts/voz/banco-cerebros.ts con SISTEMA_DE): GLM-5 14/14, 13/14 y 13/14 en tres corridas, 0,8 s a la
 * primera reacción; Kimi K2.5 9–10/14; DeepSeek 3.2 11/14 pero se le escapa su formato interno en el texto;
 * Qwen3 235B solo 5/14 con el prompt real (con uno corto, 13/14: el prompt largo lo hace hablar sin usar
 * las manos).
 */
export const MODELO_RAPIDO_OMISION = 'zai.glm-5';

function conf() {
  return {
    modo: String(process.env.CEREBRO_VOZ || 'nova').toLowerCase(),
    modelo: String(process.env.CEREBRO_VOZ_MODELO || MODELO_RAPIDO_OMISION),
    region: String(process.env.CEREBRO_VOZ_REGION || 'us-west-2'),
    /** Sin la primera palabra en este rato, contesta Qwen. */
    primeraMs: Number(process.env.CEREBRO_VOZ_PRIMERA_MS || 2500),
    /**
     * Lo mismo para el de respaldo, que es el ÚLTIMO con herramientas: si tampoco contesta, el turno cae al Qwen
     * del nodo, que no las tiene como tales (José, 4-oct: «[cerebro manos] no contestó; sigue Qwen: AbortError»
     * dos veces en tres minutos, y ese turno contestó de memoria). Por omisión, una vez y media la del principal.
     */
    respaldoPrimeraMs: Number(process.env.CEREBRO_VOZ_RESPALDO_PRIMERA_MS || 0),
  };
}

export function modeloRapido(): string {
  return conf().modelo;
}

/**
 * ¿Se usa en este servidor? (modo, que haya de dónde sacar credenciales de AWS y que no esté en pausa
 * por fallos). Las credenciales pueden venir de las variables, de un perfil, de un rol de ECS/EC2 o de
 * una identidad web (la cadena normal del SDK; revisión de Codex en #135); sin ninguna de esas pistas
 * (las pruebas, un servidor local sin AWS) no se intenta.
 */
export function cerebroRapidoActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.CEREBRO_VOZ || 'nova').toLowerCase() === 'qwen') return false;
  const hayCredenciales =
    !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) ||
    !!env.AWS_PROFILE ||
    !!env.AWS_WEB_IDENTITY_TOKEN_FILE ||
    !!env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    !!env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
    String(env.CEREBRO_VOZ || '').toLowerCase() === 'nova';
  return hayCredenciales && disponible('cerebro_rapido');
}

/**
 * Fallos seguidos de Bedrock: el cortacircuitos se abre al tercero, no al primero (un tropiezo de red
 * no apaga la voz rápida para todos; revisión de Codex en #135). Un éxito lo pone en cero.
 */
export const FALLOS_PARA_APAGAR = 3;
let fallosSeguidos = 0;
export function anotarFalloRapido(): void {
  fallosSeguidos++;
  if (fallosSeguidos >= FALLOS_PARA_APAGAR) {
    fallosSeguidos = 0;
    anotarFallo('cerebro_rapido');
  }
}
export function anotarExitoRapido(): void {
  fallosSeguidos = 0;
  anotarExito('cerebro_rapido');
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
    anotarExitoRapido();
  } catch (e) {
    if (!senal?.aborted) anotarFalloRapido();
    throw e;
  } finally {
    clearTimeout(vence);
    senal?.removeEventListener('abort', alCortar);
  }
}

/* ------------------------------------------------------------------ el cerebro con manos */

/**
 * El de respaldo cuando el principal no contesta a tiempo o falla: otro proveedor dentro de Bedrock
 * (medido el 3-oct con scripts/voz/banco-cerebros.ts: Kimi K2.5 13/14 con el prompt corto, 9–10/14 con el real).
 * Con CEREBRO_VOZ_RESPALDO=no, ninguno (pasa directo al Qwen 27B del nodo).
 */
export const MODELO_RESPALDO_OMISION = 'moonshotai.kimi-k2.5';
/** Sin un trozo nuevo durante esto, a media respuesta, se corta (el Qwen del nodo contesta si aún no se dijo nada). */
const INACTIVIDAD_MS = 8_000;
function modeloRespaldo(): string | null {
  const v = String(process.env.CEREBRO_VOZ_RESPALDO ?? MODELO_RESPALDO_OMISION).trim();
  return !v || v === 'no' ? null : v;
}

/**
 * Cómo terminó una respuesta de Bedrock (auditoría 3-oct, STREAM02): `completo` solo con un messageStop de
 * fin normal (end_turn, tool_use, stop_sequence). max_tokens, un filtro o la ventana llena la dejaron a
 * medias: `truncado`, con su motivo tal cual. Un stream que se acaba sin messageStop no llega aquí: lanza.
 */
export type FinManos = { motivo: string; estado: 'completo' | 'truncado' };
const FIN_NORMAL = new Set(['end_turn', 'tool_use', 'stop_sequence']);

/**
 * Lo que va saliendo del cerebro con manos: texto para decir, una herramienta que pidió (ya completa), cuál
 * modelo contesta (`modelo`, al empezar) y cómo terminó (`fin`, siempre lo último).
 */
export type PiezaManos = { texto: string } | { herramienta: { nombre: string; input: Record<string, unknown> } } | { modelo: string } | { fin: FinManos };

/**
 * Un turno con las manos como herramientas (lib/cerebro-manos.ts), a trozos: el texto en cuanto sale y cada
 * herramienta cuando terminó de escribirse. Primero el modelo principal; si no da la primera señal a tiempo o
 * falla ANTES de decir nada, el de respaldo. Lanza si ninguno pudo (quien llama sigue con el Qwen del nodo).
 * El primer evento es `{ modelo }`: cuál contestó.
 */
export async function* hablarConManos(mensajes: MensajeChat[], herramientas: Tool[], senal?: AbortSignal, o: { maxTokens?: number } = {}): AsyncGenerator<PiezaManos> {
  const c = conf();
  const { system, messages } = aBedrock(mensajes);
  if (!messages.length) throw new Error('sin mensaje de la persona');
  const modelos = [c.modelo, modeloRespaldo()].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  let ultimoError: unknown = null;
  for (const [i, modelo] of modelos.entries()) {
    const corte = new AbortController();
    const alCortar = () => corte.abort();
    senal?.addEventListener('abort', alCortar, { once: true });
    // El de respaldo es el último con herramientas antes del Qwen del nodo: un poco más de margen para la primera señal.
    const primera = i === 0 ? c.primeraMs : c.respaldoPrimeraMs > 0 ? c.respaldoPrimeraMs : Math.round(c.primeraMs * 1.5);
    const vence = setTimeout(() => corte.abort(new Error('sin primera señal a tiempo')), primera);
    // Ya con algo útil, un silencio largo a media respuesta también corta (antes solo se vigilaba la primera
    // señal; auditoría de Codex del 3-oct).
    let quieto: ReturnType<typeof setTimeout> | null = null;
    const vigilar = () => {
      if (quieto) clearTimeout(quieto);
      quieto = setTimeout(() => corte.abort(new Error('se quedó callado a media respuesta')), INACTIVIDAD_MS);
    };
    let alguna = false;
    let escrito = '';
    const marcar = () => {
      if (!alguna) {
        alguna = true;
        clearTimeout(vence);
      }
      vigilar();
    };
    try {
      const r = await bedrock().send(
        new ConverseStreamCommand({
          modelId: modelo,
          system,
          messages,
          ...(herramientas.length ? { toolConfig: { tools: herramientas } } : {}),
          inferenceConfig: { maxTokens: o.maxTokens ?? 900, temperature: 0.5 },
        }),
        { abortSignal: corte.signal }
      );
      let actual: { nombre: string; json: string } | null = null;
      let dijoModelo = false;
      /** El motivo del messageStop. Sin él, el stream se cortó: no es un end_turn. */
      let motivo = '';
      for await (const ev of r.stream || []) {
        const err = ev.internalServerException || ev.modelStreamErrorException || ev.throttlingException || ev.validationException || ev.serviceUnavailableException;
        if (err) throw new Error(String(err.message || 'error de Bedrock'));
        if (ev.messageStop) motivo = String(ev.messageStop.stopReason || 'sin motivo');
        const inicio = ev.contentBlockStart?.start?.toolUse;
        if (inicio) {
          marcar();
          actual = { nombre: String(inicio.name || ''), json: '' };
        }
        const d = ev.contentBlockDelta?.delta;
        if (d?.toolUse?.input && actual) actual.json += d.toolUse.input;
        if (d?.text) {
          // La etiqueta de ánimo sola («[EMO: neutral]») no es una respuesta: no cuenta como primera señal.
          escrito += d.text;
          if (escrito.replace(/\[[^\]]*\]?/g, '').trim()) marcar();
          else if (alguna) vigilar();
          if (!dijoModelo) {
            dijoModelo = true;
            yield { modelo };
          }
          yield { texto: d.text };
        }
        if (ev.contentBlockStop && actual) {
          let input: Record<string, unknown> = {};
          try {
            input = actual.json.trim() ? JSON.parse(actual.json) : {};
          } catch {
            input = {};
          }
          if (!dijoModelo) {
            dijoModelo = true;
            yield { modelo };
          }
          yield { herramienta: { nombre: actual.nombre, input } };
          actual = null;
        }
      }
      // Se acabó el stream sin messageStop: se cortó (antes se anotaba como un end_turn). Antes de la primera
      // señal, pasa al de respaldo; con algo ya dicho, quien llama lo cierra como parcial.
      if (!motivo) throw new Error('Bedrock cerró el stream sin messageStop');
      const fin: FinManos = { motivo, estado: FIN_NORMAL.has(motivo) ? 'completo' : 'truncado' };
      // Truncado sin haber dicho nada útil (solo la etiqueta de ánimo, o una herramienta a medio escribir): como
      // un fallo antes de la primera frase, prueba el de respaldo.
      if (fin.estado === 'truncado' && !alguna) throw new Error(`Bedrock terminó sin contestar (${motivo})`);
      anotarExitoRapido();
      yield { fin };
      return;
    } catch (e) {
      ultimoError = e;
      // Ya dijo algo: no se repite con otro (se oiría dos veces). Quien llama se queda con lo dicho.
      if (alguna || senal?.aborted) {
        if (!senal?.aborted) anotarFalloRapido();
        throw e;
      }
    } finally {
      clearTimeout(vence);
      if (quieto) clearTimeout(quieto);
      senal?.removeEventListener('abort', alCortar);
    }
  }
  if (!senal?.aborted) anotarFalloRapido();
  throw ultimoError instanceof Error ? ultimoError : new Error('el cerebro con manos no contestó');
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
