/**
 * QUÉ MODELO CONTESTA — el 27B para pensar, uno chico para lo simple.
 *
 * Un saludo, un «gracias», «¿cómo estás?» no necesitan 27 mil millones de parámetros ni hacer cola
 * en la A10G detrás de un análisis de contrato. Un modelo chico en la T4 (llama.cpp server, API
 * compatible con OpenAI; ver infra/t4) contesta eso en una fracción del tiempo y deja la A10G libre.
 *
 * Solo se usa si TODO esto se cumple:
 *  · `MODELO_CHICO_URL` está puesta y `MODELO_CHICO_MODO=activo` (por omisión, apagado);
 *  · el clasificador dice que no hace falta razonar (`requiereQwen` falso) y la tarea es conversación;
 *  · el riesgo es bajo y no hay sospecha de ataque;
 *  · Laya no vio urgencia, moderación ni un ánimo que cuidar: un «hola» triste lo contesta Qwen.
 * Si el modelo chico falla o tarda, contesta Qwen como siempre: nadie se queda sin respuesta.
 */
import type { Clasificacion } from './traza';
import { trazaActual } from './traza';
import { anotarExito, anotarFallo, disponible } from './interruptor';

function conf() {
  return {
    url: String(process.env.MODELO_CHICO_URL || '').replace(/\/$/, ''),
    clave: String(process.env.MODELO_CHICO_API_KEY || ''),
    nombre: String(process.env.MODELO_CHICO_NOMBRE || 'chico'),
    modo: String(process.env.MODELO_CHICO_MODO || 'apagado').toLowerCase(),
    ms: Number(process.env.MODELO_CHICO_TIMEOUT_MS || 5000),
  };
}

export function modeloChicoConfigurado() {
  const c = conf();
  return !!c.url && c.modo === 'activo';
}

/** Tareas que el modelo chico puede atender. Nada con herramientas, datos ni decisiones. */
const TAREAS_CHICAS = new Set(['conversacion']);

export function usarModeloChico(c: Clasificacion | null | undefined): boolean {
  if (!c || !modeloChicoConfigurado()) return false;
  return !c.requiereQwen && TAREAS_CHICAS.has(c.tarea) && c.riesgo < 40 && !c.inyeccion && !c.urgente && !c.moderacion?.length && !c.animo;
}

/**
 * ¿Las «herramientas» del turno son solo marcas de contexto? `harness`, `cot` y `rag` dicen cómo se
 * armó el prompt y `cerebro-*` que se pegó un hecho del cerebro («hola AU-RA» trae el de Genesis):
 * nada de eso es un dato que el modelo chico tenga que usar. Antes se exigía una lista vacía, y como
 * `harness` va siempre, el modelo chico no contestó nunca en producción.
 */
export function soloMarcasDeContexto(herramientas: string[]): boolean {
  return herramientas.every((t) => t === 'harness' || t === 'cot' || t === 'rag' || t.startsWith('cerebro-'));
}

/**
 * ¿Es solo un saludo, un gracias o una despedida? Con las reglas solas, «conversación» es lo que
 * queda cuando ninguna palabra casa: «implementa fizzbuzz» o «revisá lo de ayer» también caen ahí
 * (revisión de Codex en #37). Sin Laya, el modelo chico contesta solo lo que es charla por su forma:
 * todas las palabras son de saludo, gracias o despedida (y el nombre de la asistente). «dale» o «sí»
 * no: siguen algo anterior y eso lo contesta Qwen.
 */
const CHARLA = new Set(
  (
    'hola holi buenas buenos buen dia dias tardes noches hey que tal como estas esta estan te va vas saludos ' +
    'gracias muchas mil agradezco lo la adios chao chau bye hasta luego manana pronto nos vemos ok okay oki ' +
    'perfecto listo excelente genial bien muy y tu usted igualmente feliz todo amiga querida de nada gusto'
  ).split(' ')
);
const NOMBRES = new Set(['aura', 'au', 'ra', 'ultron']);
export function esCharlaTrivial(texto: string): boolean {
  const plano = String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const palabras = plano.split(/[^a-zñ]+/).filter(Boolean);
  if (!palabras.length) return /\p{Extended_Pictographic}/u.test(plano); // «👍»: sí; «?»: no
  if (palabras.length > 8) return false;
  return palabras.every((w) => CHARLA.has(w) || NOMBRES.has(w) || /^(ja|je|ji)+$/.test(w));
}

export type MensajeChat = { role: 'system' | 'user' | 'assistant'; content: string };

/** Una respuesta del modelo chico, o null si no está o falla (y entonces contesta Qwen). */
export async function preguntarModeloChico(mensajes: MensajeChat[]): Promise<{ texto: string } | null> {
  const c = conf();
  if (!c.url || !disponible('modelo_chico')) return null;
  try {
    const r = await fetch(`${c.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.clave ? { Authorization: `Bearer ${c.clave}` } : {}) },
      // Qwen3 piensa en voz alta por omisión; para un saludo sobra. llama.cpp (--jinja) y vLLM
      // pasan `chat_template_kwargs` a la plantilla; los servidores que no lo conocen lo ignoran.
      body: JSON.stringify({ model: c.nombre, messages: mensajes, temperature: 0.6, max_tokens: 300, chat_template_kwargs: { enable_thinking: false } }),
      signal: AbortSignal.timeout(c.ms),
    });
    if (!r.ok) {
      if (r.status >= 500) anotarFallo('modelo_chico');
      return null;
    }
    anotarExito('modelo_chico');
    const j: any = await r.json();
    // Si aun así vino un bloque de pensamiento, no se le lee a nadie.
    const texto = String(j?.choices?.[0]?.message?.content || '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    if (!texto) return null;
    trazaActual()?.tokens(j?.usage?.prompt_tokens, j?.usage?.completion_tokens);
    trazaActual()?.modelo(c.nombre, 'modelo-chico');
    return { texto };
  } catch {
    anotarFallo('modelo_chico');
    return null;
  }
}
