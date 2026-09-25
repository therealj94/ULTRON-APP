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
 *  · el riesgo es bajo y no hay sospecha de ataque.
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
  return !c.requiereQwen && TAREAS_CHICAS.has(c.tarea) && c.riesgo < 40 && !c.inyeccion;
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
