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
 * a la primera reacción. Si no da su primera señal a tiempo, se lanza también el de respaldo (Kimi K2.5) SIN
 * cancelarlo y habla el primero que contesta (hablarConManos: cobertura en paralelo, orden según la salud de los
 * últimos minutos); si ninguno, el Qwen 27B del nodo como siempre, con una frase de espera. Tres fallos seguidos lo
 * apagan un rato (lib/cognitivo/interruptor.ts). Se apaga del todo con CEREBRO_VOZ=qwen; el modelo se cambia con
 * CEREBRO_VOZ_MODELO, el respaldo con CEREBRO_VOZ_RESPALDO y se añaden coberturas con CEREBRO_VOZ_EXTRA (variables
 * del servidor, sin desplegar código).
 *
 * hablarRapido, esSoloConversacion y PASO son del camino anterior (solo charla, sin manos): siguen aquí para
 * la prueba de arranque y sus pruebas.
 *
 * Usa las credenciales de AWS que el servidor ya tiene (las de S3, con permiso solo para estos modelos).
 */
import { BedrockRuntimeClient, ConverseStreamCommand, type Message, type SystemContentBlock, type Tool } from '@aws-sdk/client-bedrock-runtime';
import { anotarExito, anotarFallo, disponible } from './cognitivo/interruptor';
import { analizarRespuesta } from './afirmacion';

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
    /**
     * Sin la primera señal útil del principal en este rato, se lanza también el de respaldo (sin cancelar el principal:
     * hablarConManos). Medido el 6-oct con el pedido real (scripts/voz/latencia-voz.ts): GLM-5 da su primera señal en
     * 2,5 s de mediana con manos y 1,8 s en charla, con una cola larga (p90 3,9–10 s); con 2 s, simulado sobre esas
     * medidas, la primera señal con manos queda en p50 2,5 s y p90 3,4 s (en serie con 2,5 s: p50 3,4 s, p90 4,9 s).
     */
    primeraMs: Number(process.env.CEREBRO_VOZ_PRIMERA_MS || 2000),
    /**
     * La espera del de respaldo antes de lanzar el siguiente (otra vez el primero sano, un pedido nuevo). Si al final
     * ninguno contesta, el turno cae al Qwen del nodo, que no tiene las manos como tales (José, 4-oct: «[cerebro manos]
     * no contestó; sigue Qwen: AbortError» dos veces en tres minutos). Por omisión, una vez y media la del principal.
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
function modeloRespaldo(): string | null {
  const v = String(process.env.CEREBRO_VOZ_RESPALDO ?? MODELO_RESPALDO_OMISION).trim();
  return !v || v === 'no' ? null : v;
}

/* ── latencia de la voz: la ruta de charla, la cobertura en paralelo y el orden por salud (José, 6-oct; VOZ-06) ───── */

/**
 * LA CHARLA VA PRIMERO AL RÁPIDO. Medido el 6-oct con el pedido REAL de un turno hablado (scripts/voz/latencia-voz.ts:
 * el server.ts de verdad arma el pedido, 8 frases de charla × 3, con las 24 herramientas): primera palabra GLM-5 4,1 s
 * de mediana (p75 7,2 s), Kimi K2.5 1,0 s (p75 1,5 s), con respuestas de la misma calidad en charla. En ACCIONES GLM-5
 * sigue siendo el mejor (13–14/14 contra 9–10/14 de Kimi), así que solo la charla sin pedidos (esSoloConversacion y
 * nada esperando su «sí»; lo decide server.ts) va primero a este; si no contesta a tiempo, el principal. Con las mismas
 * herramientas: si en la charla hace falta una, la usa igual. CEREBRO_VOZ_CHARLA cambia el modelo; «no» lo apaga.
 * De punta a punta (el servidor de verdad contra Bedrock de verdad, 8 frases de charla habladas, primer texto del SSE):
 * con la ruta de antes mediana 3,2 s y p75 5,0 s (3 de 8 cayeron al Qwen del nodo); con esta, 1,2 s y 1,2 s.
 */
export const MODELO_CHARLA_OMISION = 'moonshotai.kimi-k2.5';
function modeloCharla(): string | null {
  const v = String(process.env.CEREBRO_VOZ_CHARLA ?? MODELO_CHARLA_OMISION).trim();
  return !v || v === 'no' ? null : v;
}
/**
 * Cuánto se espera la primera señal del de charla antes de lanzar también el principal (sin cancelarlo). Medido el 6-oct
 * con el pedido real: Kimi en charla p50 1,2 s y p75 2,3 s. CEREBRO_VOZ_CHARLA_PRIMERA_MS.
 */
export const CHARLA_PRIMERA_MS_OMISION = 1_500;
/**
 * El plazo TOTAL para la primera señal útil (auditoría VOZ-06). Con la cobertura en paralelo los intentos ya no se suman:
 * el primero sigue vivo mientras se lanzan los demás, y a este plazo se cancelan todos y contesta el Qwen del nodo (en
 * voz, con la frase de espera). CEREBRO_VOZ_TOTAL_MS.
 */
export const TOTAL_PRIMERA_MS_OMISION = 7_000;
/** Con menos de esto por delante no vale la pena empezar otro intento. */
const MINIMO_INTENTO_MS = 150;
/**
 * Cuántos pedidos a Bedrock puede lanzar un turno como máximo, contando las coberturas. Con más que modelos en el plan, el
 * siguiente vuelve a ser el primero sano (un pedido NUEVO: medido el 6-oct, lo lento es la cola del proveedor antes de las
 * cabeceras, pedido a pedido, y el mismo modelo que tardó 6 s contesta el siguiente en 0,9 s). CEREBRO_VOZ_LANZAMIENTOS.
 */
export const LANZAMIENTOS_OMISION = 3;

/**
 * Modelos de más, al final del plan, separados por comas (CEREBRO_VOZ_EXTRA): otra cobertura de otro proveedor dentro de
 * Bedrock, sin tocar el orden de siempre. Vacío por omisión.
 */
function modelosExtra(): string[] {
  return String(process.env.CEREBRO_VOZ_EXTRA || '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => !!m && m !== 'no');
}

/** Qué camino lleva el turno: `charla` (primero el rápido) o `manos` (primero el que mejor usa las herramientas). */
export type RutaCerebro = 'charla' | 'manos';

/**
 * Lo que pasó con cada pedido lanzado (para el log y las pruebas): cuándo se lanzó desde el principio del turno
 * (`desdeMs`), cuándo dio su primera señal útil contada desde que se lanzó (`primeraMs`), cuándo empezó a razonar
 * (`razonMs`, si el modelo manda razonamiento) o por qué se dejó (`causa`).
 */
export type IntentoManos = { modelo: string; primeraMs?: number; causa?: string; desdeMs?: number; razonMs?: number };

/** Sin un trozo nuevo durante esto, a media respuesta, se corta (el Qwen del nodo contesta si aún no se dijo nada). */
function inactividadMs(): number {
  return Number(process.env.CEREBRO_VOZ_INACTIVIDAD_MS || 8_000);
}

/* ── la salud de cada modelo en los últimos minutos (el orden adaptativo) ── */

/**
 * Turnos SEGUIDOS en que un modelo no dio su primera señal útil dentro de su espera (o falló antes de decir algo) para
 * pasarlo detrás de los sanos. Medido el 6-oct en producción: GLM-5 casi nunca la daba en 2,5 s por las tardes, y cada
 * turno con manos esperaba esos 2,5 s antes de probar Kimi.
 */
export const FALLOS_PARA_DEGRADAR = 3;
/** Un modelo degradado vuelve a su lugar si no falla durante esto (o en cuanto contesta a tiempo de segundo). */
export const VENTANA_SALUD_MS = 5 * 60_000;
type Salud = { fallosSeguidos: number; ultimoFallo: number };
const salud = new Map<string, Salud>();

/** Contestó a tiempo: vuelve a contar desde cero. */
function saludExito(modelo: string): void {
  salud.delete(modelo);
}
/** No dio su primera señal dentro de su espera o falló antes de decir algo (una vez por turno). */
function saludFallo(modelo: string, ahora = Date.now()): void {
  const s = salud.get(modelo);
  const vigente = s && ahora - s.ultimoFallo < VENTANA_SALUD_MS;
  salud.set(modelo, { fallosSeguidos: (vigente ? s.fallosSeguidos : 0) + 1, ultimoFallo: ahora });
}
/** ¿Va detrás de los sanos? */
export function modeloDegradado(modelo: string, ahora = Date.now()): boolean {
  const s = salud.get(modelo);
  return !!s && s.fallosSeguidos >= FALLOS_PARA_DEGRADAR && ahora - s.ultimoFallo < VENTANA_SALUD_MS;
}
/** Para las pruebas: todos sanos. */
export function reiniciarSaludModelos(): void {
  salud.clear();
}

/**
 * Los modelos a probar en orden, cada uno con su espera de primera señal antes de lanzar el siguiente (sin cancelar los
 * anteriores). El orden de siempre (con `ruta: 'charla'`, primero el rápido; después el principal, el de respaldo y los
 * extra) y los degradados detrás de los sanos. Las esperas van por PUESTO (el primero espera lo del primero), así que un
 * principal degradado no le deja su espera corta al de respaldo ni se la quita.
 */
export function planDeModelos(ruta: RutaCerebro = 'manos', ahora = Date.now()): { modelo: string; primeraMs: number }[] {
  const c = conf();
  const respaldoMs = c.respaldoPrimeraMs > 0 ? c.respaldoPrimeraMs : Math.round(c.primeraMs * 1.5);
  const charla = ruta === 'charla' ? modeloCharla() : null;
  const orden = [...(charla ? [charla] : []), c.modelo, ...(modeloRespaldo() ? [modeloRespaldo() as string] : []), ...modelosExtra()].filter((m, i, a) => !!m && a.indexOf(m) === i);
  const esperas = [...(charla ? [Number(process.env.CEREBRO_VOZ_CHARLA_PRIMERA_MS || CHARLA_PRIMERA_MS_OMISION)] : []), c.primeraMs];
  const espera = (i: number) => esperas[i] ?? respaldoMs;
  const adaptado = [...orden.filter((m) => !modeloDegradado(m, ahora)), ...orden.filter((m) => modeloDegradado(m, ahora))];
  return adaptado.map((modelo, i) => ({ modelo, primeraMs: espera(i) }));
}

/**
 * Lo que pide HACER algo (o lo privado, o confirmar): eso va primero al de las manos. Se compara sin tildes. A diferencia
 * de PIDE_ALGO (abajo, pensado para un modelo SIN manos), aquí no están las consultas («busca», «el oro», «hoy», «el
 * clima»): el de charla tiene las mismas herramientas y las usa si hacen falta.
 */
const PIDE_ACCION = new RegExp(
  [
    '\\b(abr[eai]\\w*|cierr\\w*|cerr\\w*|pon(me|lo|la|le|elo|ga|gas)?|poner\\w*|pongas?|cambi\\w*|apag\\w*|encend\\w*|enciend\\w*|prend\\w*|activ\\w*|desactiv\\w*|sub[ei]\\w*|baj[ae]\\w*)\\b',
    '\\b(escrib\\w*|mand\\w*|envi\\w*|respond\\w*|contest\\w*|reenvi\\w*|borr\\w*|descart\\w*|redact\\w*|compart\\w*)\\b',
    '\\b(llam[aeo]\\w*|marc[ao]\\w*|recuerd\\w*|record\\w*|alarm\\w*|avis\\w*|despiert\\w*|agend\\w*|program\\w*|cancel\\w*|timer|temporizador)\\b',
    '\\b(guard\\w*|anot\\w*|apunt\\w*|olvid\\w*|descarg\\w*|computadora|naveg\\w*|fot\\w*|camara|pantalla)\\b',
    '\\b(music\\w*|cancion\\w*|reproduc\\w*|toca\\w*|cant[ae]\\w*|playlist|spotify|youtube|video\\w*|radio)\\b',
    '\\b(whats\\w*|wasap\\w*|correo\\w*|email\\w*|mensaje\\w*|chat\\w*|contacto\\w*|agenda|calendario|cita\\w*|reunion\\w*|pendiente\\w*|tarea\\w*|mision\\w*)\\b',
    '\\b(saldo|cartera|billetera|wallet|pag[aoeu]\\w*|transfer\\w*|origen|veta|auka|concesi\\w*|expediente\\w*|catastro)\\b',
    '\\b(modo|tema|oscuro|avatar|volumen|silencio|callate|calla|ajuste\\w*|perfil|idioma)\\b',
    '^\\s*(si|no|dale|va|ok(ay)?|listo|claro|hazlo|hagale|perfecto|eso|ese|esa|otra\\s+vez|de\\s+nuevo|y\\s+(en|a|el|la|si))\\b',
  ].join('|'),
  'i'
);
/** Lo que pide ir a fondo: ahí manda la calidad, no la latencia (va al de las manos, el que mejor razona). */
const PIDE_PROFUNDIDAD = /\b(a fondo|en detalle|a detalle|detallad\w*|paso a paso|con calma|analiza\w*|analisis|profund\w*)\b/i;

/**
 * Lo último que dijo AU-RA PROPONE o prepara una acción y espera la respuesta de la persona: «¿Le escribo esto?», «¿Lo
 * envío?», «¿Qué le querés decir?», «¿A cuál de los dos?», «¿Te lo agendo?». José, 6-oct (21:15:57): «Viejo.» y «Bien,
 * nada más» contestaban a eso y fueron por la charla (otro modelo, el más flojo con las manos); el del borrador inventó
 * «Listo, mensaje enviado». Lo que sigue a una propuesta va al de las manos.
 */
const OFRECE_ACCION =
  /¿[^?]*\b(escrib\w*|mand\w*|envi\w*|reenvi\w*|respond\w*|contest\w*|llam\w*|marc\w*|record\w*|recuerd\w*|agend\w*|program\w*|pong\w*|pon(go|emos|elo|selo)?|guard\w*|anot\w*|redact\w*|borrador|dig[oa]|decir|decirle|que le|a quien|a cual|cual de|para quien|send|call|remind|schedule|save|text)\b[^?]*\?/;
export function anteriorOfreceAccion(anterior: string | undefined): boolean {
  const p = String(anterior || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Lo citado (el texto del borrador que se le lee) no cuenta como pregunta de AU-RA.
  return OFRECE_ACCION.test(p.replace(/«[^»\n]*»|“[^”\n]*”|"[^"\n]*"/g, ' '));
}

/**
 * ¿Va por la ruta de charla? (lo decide server.ts junto con que sea hablado y que nada espere su «sí»). Nunca un «sí» /
 * «dale» / «mándalo» (lib/afirmacion.ts) ni lo que contesta a una propuesta de acción de AU-RA (`anterior`).
 */
export function esCharlaParaRuta(texto: string, anterior?: string): boolean {
  const t = String(texto || '').trim();
  if (!t || t.length > 400) return false;
  const plano = t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/gi, 'n');
  // Un sí que confirma («sí», «sale», «simón», «de una», «envíalo»), no un «va» dentro de una pregunta («¿cómo va todo?»).
  const a = analizarRespuesta(t);
  const confirma = !a.pregunta && (a.pura || a.envio || (a.afirma && a.unidades.find((x) => x.k !== 'cortesia')?.k === 'si'));
  if (confirma || anteriorOfreceAccion(anterior)) return false;
  return !PIDE_ACCION.test(plano) && !PIDE_PROFUNDIDAD.test(plano);
}

/* ── fin de la ruta de charla ── */

/**
 * Cómo terminó una respuesta de Bedrock (auditoría 3-oct, STREAM02): `completo` solo con un messageStop de
 * fin normal (end_turn, tool_use, stop_sequence). max_tokens, un filtro o la ventana llena la dejaron a
 * medias: `truncado`, con su motivo tal cual. Un stream que se acaba sin messageStop no llega aquí: lanza.
 * `intentos`: solo si contestó otro que el primero (qué pasó con cada uno).
 */
export type FinManos = { motivo: string; estado: 'completo' | 'truncado'; intentos?: IntentoManos[] };
const FIN_NORMAL = new Set(['end_turn', 'tool_use', 'stop_sequence']);

/**
 * Lo que va saliendo del cerebro con manos: texto para decir, una herramienta que pidió (ya completa), cuál
 * modelo contesta (`modelo`, al empezar) y cómo terminó (`fin`, siempre lo último).
 */
export type PiezaManos = { texto: string } | { herramienta: { nombre: string; input: Record<string, unknown> } } | { modelo: string } | { fin: FinManos };

/**
 * El reloj de la cascada: monótono (no salta con la hora del sistema ni con un Date simulado en las pruebas), en ms enteros.
 */
const reloj = () => Math.round(performance.now());

/**
 * Un turno con las manos como herramientas (lib/cerebro-manos.ts), a trozos: el texto en cuanto sale y cada
 * herramienta cuando terminó de escribirse. El primero es `{ modelo }`: cuál contestó.
 *
 * COBERTURA EN PARALELO (José, 6-oct: respuestas de voz de 9–38 s; en producción, la mitad de los turnos con manos
 * esperaban 2,5 s a GLM-5, otros 3,5 s a Kimi y después 8–17 s al Qwen del nodo). Medido ese día con el pedido real
 * (~8,7 k fichas, 25 herramientas; scripts/voz/latencia-voz.ts): ni GLM-5 ni Kimi razonan en Bedrock por omisión (cero
 * fichas de razonamiento, la salida son solo las fichas dichas); lo lento es la cola del proveedor ANTES de las
 * cabeceras, distinta en cada pedido (GLM-5: 0,9 s, 1,6 s, 6,2 s, 16,7 s con el mismo pedido). Por eso:
 *   · se lanza el primero del plan; si en su espera no dio una señal útil, se lanza el siguiente SIN cancelar el
 *     primero, y así hasta LANZAMIENTOS (con más lanzamientos que modelos, otra vez el primero sano: un pedido nuevo);
 *   · el primero que da una señal útil (texto que no es solo la etiqueta de ánimo, o una herramienta ENTERA) GANA y los demás
 *     se cancelan en ese instante (su stream se corta: no se genera ni se cobra una segunda respuesta). Antes de ganar,
 *     un intento no entrega NADA (ni su etiqueta, ni una herramienta): solo el ganador habla y solo sus herramientas
 *     llegan a quien llama, así que ninguna herramienta con efectos la piden dos modelos;
 *   · el razonamiento (si un modelo lo manda) cuenta como VIVO para el silencio a media respuesta, nunca como útil ni
 *     como algo que se dice;
 *   · el orden se adapta a la salud de los últimos minutos (planDeModelos): tres turnos seguidos sin señal a tiempo y
 *     ese modelo va detrás.
 * Un fallo antes de la primera señal lanza el siguiente al momento. Con algo útil ya dicho, un corte no se repite con
 * otro modelo (se oiría dos veces): lanza. Lanza también si ninguno dio señal en el plazo total, o si todos fallaron
 * con error (quien llama sigue con el Qwen del nodo), con `intentos` en el error.
 */
export async function* hablarConManos(mensajes: MensajeChat[], herramientas: Tool[], senal?: AbortSignal, o: { maxTokens?: number; ruta?: RutaCerebro } = {}): AsyncGenerator<PiezaManos> {
  const { system, messages } = aBedrock(mensajes);
  if (!messages.length) throw new Error('sin mensaje de la persona');
  const t0 = reloj();
  const plan = planDeModelos(o.ruta);
  const totalMs = Number(process.env.CEREBRO_VOZ_TOTAL_MS || TOTAL_PRIMERA_MS_OMISION);
  const maxLanzamientos = Math.max(1, Math.round(Number(process.env.CEREBRO_VOZ_LANZAMIENTOS || LANZAMIENTOS_OMISION)) || 1);
  const intentos: IntentoManos[] = [];
  const conIntentos = (e: unknown) => Object.assign(e instanceof Error ? e : new Error(String(e)), { intentos });
  const anotarLog = () => {
    if (intentos.length > 1 || intentos.some((i) => i.causa)) {
      const uno = (i: IntentoManos) => `${i.modelo}${i.desdeMs ? ` (desde ${i.desdeMs} ms)` : ''} ${i.causa ? i.causa : `primera señal útil ${i.primeraMs} ms`}${i.razonMs !== undefined ? ` · razonó desde ${i.razonMs} ms` : ''}`;
      console.warn(`[cerebro manos] intentos: ${intentos.map(uno).join(' → ')}`);
    }
  };

  /** Un pedido lanzado a Bedrock y lo suyo. */
  type Corrida = {
    intento: IntentoManos;
    modelo: string;
    /** Su espera (la de su puesto): sin señal útil en ese rato, se lanza el siguiente y cuenta como lento. */
    esperaMs: number;
    desde: number;
    corte: AbortController;
    /** Ya no cuenta: perdió la carrera, se agotó el plazo o la persona interrumpió (lo que llegue se tira). */
    cancelada: boolean;
    terminada: boolean;
    porQuieto: boolean;
    quieto: ReturnType<typeof setTimeout> | null;
    /** Lo que dijo antes de ganar: se entrega solo si gana. */
    guardado: PiezaManos[];
    escrito: string;
  };
  type Suceso = { corrida: Corrida; pieza?: PiezaManos; fin?: { motivo: string; estado: FinManos['estado'] }; error?: unknown };
  const cola: Suceso[] = [];
  let despertar: (() => void) | null = null;
  const empujar = (s: Suceso) => {
    cola.push(s);
    despertar?.();
  };
  const corridas: Corrida[] = [];
  // (con `as`: TypeScript no ve las asignaciones dentro de los cierres y lo daría por siempre null)
  let ganador = null as Corrida | null;
  /** Los modelos que fallaron con error en este turno (no se vuelven a lanzar) y los que ya se anotaron en la salud. */
  const conError = new Set<string>();
  const anotadosSalud = new Set<string>();
  const anotarSalud = (modelo: string, bien: boolean) => {
    if (anotadosSalud.has(modelo)) return;
    anotadosSalud.add(modelo);
    if (bien) saludExito(modelo);
    else saludFallo(modelo);
  };
  const cancelar = (c: Corrida, causa: string) => {
    if (c.cancelada || c.terminada) return;
    c.cancelada = true;
    c.intento.causa = causa;
    if (c.quieto) clearTimeout(c.quieto);
    c.corte.abort(new Error(causa));
  };
  const vigilar = (c: Corrida) => {
    if (c.quieto) clearTimeout(c.quieto);
    c.quieto = setTimeout(() => {
      c.porQuieto = true;
      c.corte.abort(new Error('se quedó callado a media respuesta'));
    }, inactividadMs());
  };
  /**
   * La primera señal útil de `c`: si nadie ganó todavía, gana (los demás se cancelan YA, antes de entregar nada suyo) y
   * sale lo que guardaba. Síncrono: dos corridas no pueden ganar a la vez. false si ya ganó otra (esta se tira).
   */
  const reclamar = (c: Corrida): boolean => {
    if (ganador === c) return true;
    if (ganador || c.cancelada) return false;
    ganador = c;
    const ms = reloj() - c.desde;
    c.intento.primeraMs = ms;
    anotarSalud(c.modelo, ms <= c.esperaMs);
    for (const otra of corridas) {
      if (otra === c || otra.cancelada || otra.terminada) continue;
      const lleva = reloj() - otra.desde;
      // El que ya pasó su espera sin decir nada fue lento de verdad (cuenta para la salud); el recién lanzado, no se sabe.
      if (lleva >= otra.esperaMs) anotarSalud(otra.modelo, false);
      cancelar(otra, `sin primera señal útil en ${lleva} ms (contestó antes ${c.modelo}; cancelado)`);
    }
    empujar({ corrida: c, pieza: { modelo: c.modelo } });
    for (const p of c.guardado.splice(0)) empujar({ corrida: c, pieza: p });
    return true;
  };
  /** Lo que dice el ganador, al momento (de otra corrida no se entrega nada). */
  const entregar = (c: Corrida, pieza: PiezaManos) => {
    if (ganador === c) empujar({ corrida: c, pieza });
  };

  const correr = async (c: Corrida) => {
    try {
      const r = await bedrock().send(
        new ConverseStreamCommand({
          modelId: c.modelo,
          system,
          messages,
          ...(herramientas.length ? { toolConfig: { tools: herramientas } } : {}),
          inferenceConfig: { maxTokens: o.maxTokens ?? 900, temperature: 0.5 },
        }),
        { abortSignal: c.corte.signal }
      );
      let actual: { nombre: string; json: string } | null = null;
      /** El motivo del messageStop. Sin él, el stream se cortó: no es un end_turn. */
      let motivo = '';
      for await (const ev of r.stream || []) {
        if (c.cancelada) break;
        const err = ev.internalServerException || ev.modelStreamErrorException || ev.throttlingException || ev.validationException || ev.serviceUnavailableException;
        if (err) throw new Error(String(err.message || 'error de Bedrock'));
        if (ev.messageStop) motivo = String(ev.messageStop.stopReason || 'sin motivo');
        const d = ev.contentBlockDelta?.delta;
        // El razonamiento: vivo (a media respuesta no lo corta el silencio), nunca útil ni dicho.
        if (d?.reasoningContent) {
          c.intento.razonMs ??= reloj() - c.desde;
          if (ganador === c) vigilar(c);
        }
        // Una herramienta GANA cuando llega entera (contentBlockStop), no al empezar: medido el 6-oct, GLM-5 a veces empieza
        // una herramienta y se queda callado a media escritura 8–20 s; si eso contara como señal, cancelaba a los demás y
        // el turno esperaba el silencio entero antes del Qwen del nodo. Mientras tanto la cobertura sigue corriendo.
        const inicio = ev.contentBlockStart?.start?.toolUse;
        if (inicio) {
          if (ganador === c) vigilar(c);
          actual = { nombre: String(inicio.name || ''), json: '' };
        }
        if (d?.toolUse?.input && actual) {
          actual.json += d.toolUse.input;
          if (ganador === c) vigilar(c);
        }
        if (d?.text) {
          c.escrito += d.text;
          if (ganador === c) {
            vigilar(c);
            entregar(c, { texto: d.text });
          } else {
            c.guardado.push({ texto: d.text });
            // La etiqueta de ánimo sola («[EMO: neutral]») no es una respuesta: ni gana ni se entrega.
            if (c.escrito.replace(/\[[^\]]*\]?/g, '').trim()) {
              if (!reclamar(c)) break;
              vigilar(c);
            }
          }
        }
        if (ev.contentBlockStop && actual) {
          let input: Record<string, unknown> = {};
          try {
            input = actual.json.trim() ? JSON.parse(actual.json) : {};
          } catch {
            input = {};
          }
          if (!reclamar(c)) break;
          entregar(c, { herramienta: { nombre: actual.nombre, input } });
          actual = null;
        }
      }
      if (c.cancelada) return;
      // Se acabó el stream sin messageStop: se cortó. Antes de la primera señal es un fallo de este intento; con algo
      // ya dicho, quien llama lo cierra como parcial.
      if (!motivo) throw new Error('Bedrock cerró el stream sin messageStop');
      const estado: FinManos['estado'] = FIN_NORMAL.has(motivo) ? 'completo' : 'truncado';
      // Truncado sin haber dicho nada útil (solo la etiqueta, o una herramienta a medio escribir): falló este intento.
      if (estado === 'truncado' && ganador !== c) throw new Error(`Bedrock terminó sin contestar (${motivo})`);
      // Terminó bien pero sin nada útil (solo «[EMO: neutral]», o vacío): mientras otra corrida siga viva, eso es un fallo
      // de ESTA (y de la salud de su modelo), no una respuesta: antes ganaba y cortaba a la otra, que sí iba a contestar
      // (revisión del 6-oct). Solo si es la última viva lo poco que dijo sale igual; quien llama decide.
      if (ganador !== c && corridas.some((otra) => otra !== c && !otra.cancelada && !otra.terminada)) throw new Error(`Bedrock terminó sin nada útil (${motivo}) con otra corrida viva`);
      if (ganador !== c && !reclamar(c)) return;
      empujar({ corrida: c, fin: { motivo, estado } });
    } catch (e) {
      if (!c.cancelada) empujar({ corrida: c, error: e });
    } finally {
      c.terminada = true;
      if (c.quieto) clearTimeout(c.quieto);
    }
  };

  let lanzados = 0;
  let ultimoError: unknown = null;
  /** Cuándo toca lanzar el siguiente (sin señal útil hasta entonces). */
  let proximoEn = t0;
  /**
   * Cuándo se rinde: el plazo total (las esperas solo dicen cuándo lanzar el siguiente; el que ya va en vuelo sigue
   * hasta aquí, porque lo que viene después es el Qwen del nodo, 8–17 s). Antes, si todos fallaron con error.
   */
  const limite = t0 + totalMs;
  /** El siguiente modelo a lanzar: el plan en orden y, con lanzamientos de sobra, otra vez desde el primero (sin los que fallaron con error). */
  const siguientePaso = (): { modelo: string; primeraMs: number } | null => {
    if (lanzados >= maxLanzamientos) return null;
    if (lanzados < plan.length) return plan[lanzados];
    const vivos = plan.filter((p) => !conError.has(p.modelo));
    if (!vivos.length) return null;
    const p = vivos[(lanzados - plan.length) % vivos.length];
    return { modelo: p.modelo, primeraMs: plan[Math.min(lanzados, plan.length - 1)].primeraMs };
  };
  const lanzar = (paso: { modelo: string; primeraMs: number }) => {
    const ahora = reloj();
    const intento: IntentoManos = { modelo: paso.modelo, ...(ahora - t0 > 0 && lanzados > 0 ? { desdeMs: ahora - t0 } : {}) };
    intentos.push(intento);
    const corte = new AbortController();
    const c: Corrida = { intento, modelo: paso.modelo, esperaMs: paso.primeraMs, desde: ahora, corte, cancelada: false, terminada: false, porQuieto: false, quieto: null, guardado: [], escrito: '' };
    corridas.push(c);
    lanzados++;
    proximoEn = ahora + paso.primeraMs;
    void correr(c);
  };
  /** Ya se cedió una vuelta al bucle de eventos antes de este lanzamiento (ver el empate, abajo). */
  let cedido = false;
  const alInterrumpir = () => despertar?.();
  senal?.addEventListener('abort', alInterrumpir, { once: true });
  const cancelarTodas = (causa: (c: Corrida) => string) => {
    for (const c of corridas) cancelar(c, causa(c));
  };
  try {
    for (;;) {
      if (senal?.aborted) {
        cancelarTodas(() => 'la persona interrumpió');
        anotarLog();
        throw conIntentos(senal.reason instanceof Error ? senal.reason : new Error('la persona interrumpió'));
      }
      const s = cola.shift();
      if (s) {
        const c = s.corrida;
        if (s.pieza) {
          if (c === ganador) yield s.pieza;
          continue;
        }
        if (s.fin) {
          if (c !== ganador) continue;
          anotarExitoRapido();
          anotarLog();
          yield { fin: { ...s.fin, ...(intentos.length > 1 ? { intentos } : {}) } };
          return;
        }
        // Un error de una corrida que sigue contando.
        ultimoError = s.error;
        const e: any = s.error;
        c.intento.causa = c.porQuieto ? 'se quedó callado a media respuesta' : `error: ${String(e?.name || '')} ${String(e?.message || e).slice(0, 120)}`.trim();
        if (c === ganador) {
          // Ya dijo algo: no se repite con otro (se oiría dos veces). Quien llama se queda con lo dicho.
          cancelarTodas((x) => `cancelado (${c.modelo} ya contestaba)`);
          anotarFalloRapido();
          anotarLog();
          throw conIntentos(e);
        }
        conError.add(c.modelo);
        anotarSalud(c.modelo, false);
        // Falló antes de su primera señal: el siguiente sale ya, sin esperar su turno.
        proximoEn = Math.min(proximoEn, reloj());
        continue;
      }
      if (ganador) {
        // Esperando lo que siga del ganador.
        await new Promise<void>((r) => (despertar = r));
        despertar = null;
        continue;
      }
      const ahora = reloj();
      const vivas = corridas.filter((c) => !c.terminada && !c.cancelada);
      if (ahora >= proximoEn && ahora < limite) {
        const paso = siguientePaso();
        if (paso && t0 + totalMs - ahora >= MINIMO_INTENTO_MS) {
          // Empate entre la primera señal de una corrida viva y el vencimiento de su espera (los dos en la misma vuelta
          // del bucle de eventos): antes se lanzaba la cobertura y se cancelaba al instante (un pedido pagado de más).
          // Se dejan correr los sucesos pendientes una vez (setImmediate: después de los relojes y la E/S de esta
          // vuelta) y se vuelve a mirar; si nada llegó, se lanza.
          if (vivas.length && !cedido) {
            cedido = true;
            await new Promise<void>((r) => setImmediate(r));
            continue;
          }
          cedido = false;
          lanzar(paso);
          continue;
        }
        // Ya no hay a quién lanzar (o no queda tiempo): se espera a los vivos hasta el plazo total.
        proximoEn = Infinity;
      }
      if (ahora >= limite || (!vivas.length && proximoEn === Infinity)) {
        cancelarTodas((c) => `sin primera señal útil en ${reloj() - c.desde} ms`);
        // Lento de verdad (agotó su espera sin decir nada): cuenta para la salud.
        for (const c of corridas) if (!c.intento.primeraMs && reloj() - c.desde >= c.esperaMs) anotarSalud(c.modelo, false);
        for (const p of plan.slice(lanzados)) intentos.push({ modelo: p.modelo, causa: `sin probar (plazo total de ${totalMs} ms)` });
        anotarFalloRapido();
        anotarLog();
        throw conIntentos(ultimoError instanceof Error && !vivas.length ? ultimoError : new Error(`el cerebro con manos no dio su primera señal útil en ${reloj() - t0} ms`));
      }
      const hasta = Math.min(proximoEn, limite) - ahora;
      await new Promise<void>((r) => {
        const t = setTimeout(r, Math.max(0, hasta));
        despertar = () => {
          clearTimeout(t);
          r();
        };
      });
      despertar = null;
    }
  } finally {
    senal?.removeEventListener('abort', alInterrumpir);
    // Quien llama dejó de leer (o terminó): nada queda corriendo ni pagándose.
    cancelarTodas(() => 'el turno ya no escucha');
    if (ganador) {
      const g: Corrida = ganador;
      if (g.quieto) clearTimeout(g.quieto);
      if (!g.terminada) g.corte.abort(new Error('el turno ya no escucha'));
    }
  }
}

/**
 * LA FRASE DE ESPERA HONESTA. Cuando ningún modelo de Bedrock dio su primera señal y el turno hablado pasa al Qwen del
 * nodo (8–17 s a la primera ficha en producción el 6-oct), se le dice la verdad en vez de dejarla en silencio después del
 * «déjame ver» del teléfono. Sin género (la dicen AU-RA, Claudio y el guardián) y sin prometer nada que no pase.
 */
const ESPERA_LENTA = {
  es: ['Perdona la demora, hoy me está costando contestar rápido; dame unos segundos.', 'Se me está tardando la respuesta; dame unos segundos más, ya casi.'],
  en: ["Sorry for the wait, I'm slower than usual right now; give me a few seconds.", "My answer is taking longer than it should; give me a few more seconds."],
};
let vueltaEspera = 0;
export function fraseDeEsperaLenta(idioma: 'es' | 'en' = 'es'): string {
  const lista = ESPERA_LENTA[idioma === 'en' ? 'en' : 'es'];
  return lista[vueltaEspera++ % lista.length];
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
