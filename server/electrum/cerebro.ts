/**
 * EL CEREBRO DE DR ELECTRUM: Bedrock con sus manos como herramientas de verdad, y el Qwen del nodo de respaldo.
 *
 * Hasta ahora cada vuelta del harness (lib/agente/bucle.ts) esperaba al Qwen 27B entero, sin stream: la pantalla no
 * veía una palabra hasta el final y la voz empezaba cuando todo el turno ya había terminado. AU-RA ya piensa con
 * GLM-5 / Kimi en Bedrock (lib/cerebro-rapido.ts hablarConManos: cobertura en paralelo, orden por salud), y el servicio
 * de Electrum tiene las mismas credenciales de AWS. Aquí se usa ESE cerebro, con las herramientas de Electrum (no el
 * catálogo de AU-RA: ni WhatsApp, ni recordatorios, ni nada de asistente personal):
 *
 *  · las herramientas del turno (las que eligió el panel) pasan a `toolSpec` de Bedrock tal cual las declara manos.ts;
 *  · el hilo del bucle, con sus `tool_calls` y sus resultados (`role: 'tool'`), pasa a toolUse / toolResult
 *    (lib/cerebro-rapido.ts aBedrockConManos);
 *  · lo que sale se junta en la forma que el bucle espera: `{ texto, mensaje: { content, tool_calls } }`. El texto va
 *    saliendo por `alTexto` mientras llega (la pantalla y la voz no esperan al final);
 *  · si Bedrock no da nada útil (lanza antes del primer texto o herramienta), ESA vuelta la piensa el Qwen del nodo,
 *    con el protocolo Hermes en el system; si ya dijo algo, se queda con lo dicho (repetirlo con otro se oiría dos veces).
 *
 * Su salud y su cortacircuitos son los SUYOS (`espacio: 'electrum'`): un turno de minas con el catastro entero que
 * tarda o falla no apaga ni reordena la voz rápida de AU-RA si corren en el mismo proceso, ni al revés.
 *
 *   ELECTRUM_CEREBRO   `rapido` (Bedrock primero; por omisión si cerebroRapidoActivo()) o `qwen` (solo el nodo).
 */
import type { Tool } from '@aws-sdk/client-bedrock-runtime';
import type { DocumentType } from '@smithy/types';
import crypto from 'node:crypto';
import { cerebroRapidoActivo, hablarConManos, servicioDe, type MensajeChat } from '../../lib/cerebro-rapido';
import { instruccionHermes, limpiarTexto, type herramientasNativas } from '../../lib/agente/protocolo';
import type { Mensaje, Pensar } from '../../lib/agente/bucle';
import type { Herramienta } from '../../lib/agente/tipos';
import { trazaActual } from '../../lib/cognitivo/traza';
import { fetchNodo, NODO_MODELO, NODO_SECRETO, NODO_URL } from '../../lib/nodo';

/**
 * Ni una llamada eterna ni una que no alcanza a pensar. Antes había además un MÍNIMO de 8 s que se
 * daba aunque al turno le quedaran 2: así se pasaba de su presupuesto (auditoría H08). Ahora, con
 * menos de lo que hace falta para pensar, no se llama y el bucle cierra con lo que tiene.
 */
export const MIN_PARA_PENSAR_MS = 1_500;
export const MAX_LLAMADA_MS = 60_000;
/** Lo más que escribe en una vuelta: un análisis con citas, no un ensayo (Bedrock corta ahí y lo marca truncado). */
const MAX_FICHAS = 1_500;

type Nativas = ReturnType<typeof herramientasNativas>;
type SalidaPensar = Awaited<ReturnType<Pensar>>;

/**
 * Pregunta al nodo. Devuelve el mensaje entero para poder leer `tool_calls` nativo si el servidor
 * lo trae; si no, el harness lo saca del texto en formato Hermes.
 */
export async function pensarConQwen(mensajes: Mensaje[], herramientas: unknown[], msRestante: number, senal?: AbortSignal): Promise<SalidaPensar> {
  if (msRestante < MIN_PARA_PENSAR_MS) throw new Error('sin tiempo para pensar');
  const tope = Math.min(MAX_LLAMADA_MS, msRestante);
  const r = await fetchNodo(`${NODO_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': NODO_SECRETO },
    body: JSON.stringify({
      model: NODO_MODELO,
      stream: false,
      messages: mensajes,
      // Si el servidor no conoce `tools`, lo ignora y el harness cae al formato Hermes.
      tools: herramientas,
      options: { temperature: 0.4 },
    }),
    // Se corta por tiempo o porque quien preguntaba se fue (auditoría H09), lo que pase primero.
    signal: senal ? AbortSignal.any([AbortSignal.timeout(tope), senal]) : AbortSignal.timeout(tope),
  });
  /*
   * Un nodo que contesta 502 o 500 NO contestó.
   *
   * Antes se leía el cuerpo igual, salía `{}`, y el bucle lo tomaba por una respuesta vacía del
   * modelo: el turno terminaba «contestó» con texto en blanco. La pantalla ponía «No pude
   * contestar» sin decir por qué y Telegram mandaba un mensaje vacío. Lanzando, el bucle hace lo
   * que ya sabe hacer con un cerebro caído: decir que no lo alcanzó y lo que alcanzó a averiguar.
   */
  if (!r.ok) throw new Error(`el nodo contestó ${r.status}`);
  const j: any = await r.json().catch(() => ({}));
  const mensaje = j?.message || {};
  trazaActual()?.tokens(j?.prompt_eval_count, j?.eval_count);
  trazaActual()?.modelo(NODO_MODELO);
  return { texto: String(mensaje.content || ''), mensaje };
}

/**
 * LOS TIEMPOS DE LA COBERTURA, LOS DE ELECTRUM (no los de la voz de AU-RA). hablarConManos lanza otro pedido si el
 * primero no dio su primera señal en `primeraMs`, hasta `lanzamientos`, y se rinde a los `totalMs` (sigue el Qwen del
 * nodo). Los de AU-RA (2 s, 7 s, 3) están medidos con SU prompt (~8,7 k fichas); el de Electrum lleva el cerebro de
 * minas entero, el panel y lo leído (varias veces más), y Bedrock tarda más en dar la primera señal: con los de AU-RA
 * cada vuelta lanzaba hasta tres pedidos en paralelo y caía al Qwen a menudo. Siempre dentro de lo que le queda al turno.
 *
 *   ELECTRUM_CEREBRO_PRIMERA_MS (6000) · ELECTRUM_CEREBRO_TOTAL_MS (20000) · ELECTRUM_CEREBRO_LANZAMIENTOS (2)
 */
export const ELECTRUM_PRIMERA_MS_OMISION = 6_000;
export const ELECTRUM_TOTAL_MS_OMISION = 20_000;
export const ELECTRUM_LANZAMIENTOS_OMISION = 2;
export function tiemposCerebroElectrum(msRestante: number, env: NodeJS.ProcessEnv = process.env): { primeraMs: number; totalMs: number; lanzamientos: number } {
  const num = (v: string | undefined, omision: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : omision;
  };
  const tope = Math.max(MIN_PARA_PENSAR_MS, Math.min(MAX_LLAMADA_MS, msRestante));
  const totalMs = Math.min(num(env.ELECTRUM_CEREBRO_TOTAL_MS, ELECTRUM_TOTAL_MS_OMISION), tope);
  return {
    primeraMs: Math.min(num(env.ELECTRUM_CEREBRO_PRIMERA_MS, ELECTRUM_PRIMERA_MS_OMISION), totalMs),
    totalMs,
    lanzamientos: Math.max(1, Math.round(num(env.ELECTRUM_CEREBRO_LANZAMIENTOS, ELECTRUM_LANZAMIENTOS_OMISION))),
  };
}

/** Qué cerebro piensa los turnos de Electrum. Ver la cabecera. */
export type ModoCerebroElectrum = 'rapido' | 'qwen';
export function modoCerebroElectrum(env: NodeJS.ProcessEnv = process.env): ModoCerebroElectrum {
  const v = String(env.ELECTRUM_CEREBRO || '').trim().toLowerCase();
  if (v === 'qwen') return 'qwen';
  // Pedido a propósito para Electrum: vale aunque la voz de AU-RA esté en CEREBRO_VOZ=qwen (sus credenciales y su
  // cortacircuitos, sí).
  if (v === 'rapido') return cerebroRapidoActivo({ ...env, CEREBRO_VOZ: '' }, servicioDe('electrum')) ? 'rapido' : 'qwen';
  return cerebroRapidoActivo(env, servicioDe('electrum')) ? 'rapido' : 'qwen';
}

/**
 * Las herramientas del turno (las nativas que arma el bucle: `{ type, function: { name, description, parameters } }`)
 * como las pide Bedrock. El esquema va tal cual: es el mismo JSON Schema que manos.ts declara para Qwen.
 */
export function aHerramientasBedrock(nativas: Nativas): Tool[] {
  return nativas
    .filter((n) => n?.function?.name)
    .map((n) => ({
      toolSpec: {
        name: n.function.name,
        description: String(n.function.description || n.function.name).slice(0, 4000),
        inputSchema: { json: { type: 'object', properties: n.function.parameters?.properties || {}, required: n.function.parameters?.required || [] } as DocumentType },
      },
    }));
}

/** Para el Qwen de respaldo: el bucle corre en modo nativo con Bedrock, así que el protocolo Hermes va aquí. */
export function conHermes(mensajes: Mensaje[], nativas: Nativas): Mensaje[] {
  if (!nativas.length) return mensajes;
  // instruccionHermes solo lee nombre, descripción y esquema: lo demás de la herramienta no hace falta aquí.
  const firmas = nativas.map((n) => ({ nombre: n.function.name, descripcion: n.function.description, esquema: n.function.parameters }) as unknown as Herramienta);
  const instruccion = instruccionHermes(firmas);
  const i = mensajes.findIndex((m) => m.role === 'system');
  if (i < 0) return [{ role: 'system', content: instruccion }, ...mensajes];
  const copia = [...mensajes];
  copia[i] = { ...copia[i], content: `${copia[i].content}\n\n${instruccion}` } as Mensaje;
  return copia;
}

/** Lo que el turno quiere saber mientras piensa. */
export type GanchosPensar = {
  /** Un trozo de texto de esta vuelta, en cuanto llega (sin las etiquetas de herramienta). */
  alTexto?: (trozo: string) => void;
  /** Quién contestó esta vuelta (el modelo de Bedrock o el del nodo) y cuándo llegó su primera señal. */
  alModelo?: (m: { modelo: string; proveedor: 'bedrock' | 'nodo' }) => void;
  alPrimeraFicha?: () => void;
};

export type DepsCerebro = {
  hablar?: typeof hablarConManos;
  qwen?: typeof pensarConQwen;
};

/**
 * Una vuelta del bucle con Bedrock (ver la cabecera). Respeta lo que le queda al turno (`msRestante`) y a quien se fue
 * (`senal`): con la persona ida lanza, y el bucle lo cierra como abandonado.
 */
export async function pensarElectrum(o: Parameters<Pensar>[0] & GanchosPensar, deps: DepsCerebro = {}): Promise<SalidaPensar> {
  const hablar = deps.hablar ?? hablarConManos;
  const qwen = deps.qwen ?? pensarConQwen;
  if (o.msRestante < MIN_PARA_PENSAR_MS) throw new Error('sin tiempo para pensar');
  const t0 = Date.now();
  const tope = Math.min(MAX_LLAMADA_MS, o.msRestante);
  // El corte de esta vuelta: su tope de tiempo o la persona que se fue, lo que pase primero.
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(new DOMException('se acabó el tiempo del turno', 'TimeoutError')), tope);
  const alIrse = () => corte.abort(o.senal?.reason);
  if (o.senal?.aborted) alIrse();
  else o.senal?.addEventListener('abort', alIrse, { once: true });

  let texto = '';
  const llamadas: Array<{ id: string; type: 'function'; function: { name: string; arguments: Record<string, unknown> } }> = [];
  let util = false;
  let modelo = '';
  const primera = () => {
    if (util) return;
    util = true;
    o.alPrimeraFicha?.();
  };
  try {
    const mensajes = o.mensajes as unknown as MensajeChat[];
    const tiempos = tiemposCerebroElectrum(o.msRestante);
    for await (const p of hablar(mensajes, aHerramientasBedrock(o.herramientas), corte.signal, { maxTokens: MAX_FICHAS, ruta: 'manos', espacio: 'electrum', conVueltas: true, ...tiempos })) {
      if ('modelo' in p) {
        modelo = p.modelo;
        trazaActual()?.modelo(p.modelo);
        o.alModelo?.({ modelo: p.modelo, proveedor: 'bedrock' });
        continue;
      }
      if ('fin' in p) {
        if (p.fin.estado !== 'completo') console.warn(`[electrum cerebro] ${modelo || 'Bedrock'} la dejó a medias (${p.fin.motivo})`);
        continue;
      }
      if ('texto' in p) {
        primera();
        texto += p.texto;
        o.alTexto?.(p.texto);
        continue;
      }
      primera();
      // El id lo pone el servidor: Bedrock solo exige que su resultado vuelva con el mismo.
      llamadas.push({ id: `el_${crypto.randomBytes(6).toString('hex')}`, type: 'function', function: { name: p.herramienta.nombre, arguments: p.herramienta.input || {} } });
    }
  } catch (e: any) {
    if (o.senal?.aborted) throw e;
    if (!util) {
      // Nada útil de Bedrock: esta vuelta la piensa el Qwen del nodo, con lo que le queda al turno.
      const queda = o.msRestante - (Date.now() - t0);
      console.warn(`[electrum cerebro] Bedrock no contestó (${String(e?.message || e).slice(0, 120)}); esta vuelta la piensa el nodo`);
      const r = await qwen(conHermes(o.mensajes, o.herramientas), o.herramientas, queda, o.senal);
      o.alModelo?.({ modelo: NODO_MODELO, proveedor: 'nodo' });
      const dicho = limpiarTexto(r.texto || '');
      if (dicho) {
        o.alPrimeraFicha?.();
        o.alTexto?.(dicho);
      }
      return r;
    }
    // Ya dijo algo: se queda con lo dicho (el bucle sigue con eso, o lo cierra si no hay más).
    console.warn(`[electrum cerebro] ${modelo || 'Bedrock'} se cortó a media respuesta: ${String(e?.message || e).slice(0, 120)}`);
  } finally {
    clearTimeout(reloj);
    o.senal?.removeEventListener('abort', alIrse);
  }
  return { texto, mensaje: { role: 'assistant', content: texto, ...(llamadas.length ? { tool_calls: llamadas } : {}) } };
}
