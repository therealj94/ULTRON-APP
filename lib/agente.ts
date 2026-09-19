/**
 * Cliente único hacia el nodo Qwen (ULTRON_NODO_URL /api/chat).
 * No toca el modelo: solo arma el fetch. cerebro.js / lib/agente.ts no existían;
 * este archivo es ese harness.
 */

import { criticaActiva, criticarCodigo, type Critica } from './critico';
import { ejecutarCodigo, ejecutorActivo, type Ejecucion } from './ejecutor';
import { construirMensajes, extraerPython, type ChatMessage } from './qwen';

export function nodoConfig() {
  return {
    url: (process.env.ULTRON_NODO_URL || process.env.QWEN_ENDPOINT_URL || '').replace(/\/$/, ''),
    secreto: process.env.ULTRON_NODO_SECRETO || '',
    modelo: process.env.ULTRON_NODO_MODELO || 'orcarouter/Qwen3.8-27B-Uncensored',
  };
}

export function extraerRespuestaQwen(raw: string): string {
  let acc = '';
  for (const line of String(raw || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const j = JSON.parse(s);
      acc += j.message?.content || j.content || j.response || '';
      if (j.done && acc) return acc;
    } catch {
      /* skip */
    }
  }
  try {
    const j = JSON.parse(raw);
    return j.message?.content || j.content || j.reply || raw;
  } catch {
    return raw;
  }
}

export async function llamarQwen(opts: {
  messages: ChatMessage[];
  stream?: boolean;
  timeoutMs?: number;
}): Promise<{ ok: boolean; text: string; raw: string; status: number }> {
  const n = nodoConfig();
  if (!n.url || !n.secreto) {
    return { ok: false, text: '', raw: 'Qwen no configurado', status: 503 };
  }
  const r = await fetch(`${n.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': n.secreto },
    body: JSON.stringify({
      model: n.modelo,
      stream: !!opts.stream,
      messages: opts.messages,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs || 60000),
  });
  const raw = await r.text();
  const text = extraerRespuestaQwen(raw).trim();
  return { ok: r.ok && !!text, text, raw, status: r.status };
}

export type TurnoAgente = {
  reply: string;
  bruto: string;
  critica?: Critica;
  ejecucion?: Ejecucion;
  corregido: boolean;
  meta: ReturnType<typeof construirMensajes>['meta'];
};

const PIDE_EJECUTAR = /\b(ejecuta(?:lo|r)?|corre(?:los)?\s+tests?|verifica(?:lo)?|run tests?)\b/i;

/**
 * Un turno de código: Qwen → (crítico Claude si hay clave) → corrección opcional → ejecutor si lo piden.
 * Charla de escritorio no entra aquí: el server llama construirMensajes + fetch stream.
 */
export async function completarTurnoCodigo(opts: {
  personalidad: string;
  user: string;
}): Promise<TurnoAgente> {
  const { messages, meta } = construirMensajes({ personalidad: opts.personalidad, user: opts.user });
  const primero = await llamarQwen({ messages, stream: false });
  let reply = primero.text;
  let corregido = false;
  let critica: Critica | undefined;

  const py = extraerPython(reply);
  if (py && criticaActiva()) {
    critica = await criticarCodigo(py, opts.user);
    if (critica.bugs && !critica.skipped) {
      const segundo = await llamarQwen({
        messages: [
          ...messages,
          { role: 'assistant', content: reply },
          {
            role: 'user',
            content:
              `Un revisor encontró esto:\n${critica.texto}\nCorrige el código. No afirmes que funciona ni que los tests pasan. Empieza con [TONO].`,
          },
        ],
        timeoutMs: 60000,
      });
      if (segundo.ok && segundo.text) {
        reply = segundo.text;
        corregido = true;
      }
    }
  }

  let ejecucion: Ejecucion | undefined;
  const codigoFinal = extraerPython(reply);
  if (codigoFinal && ejecutorActivo() && PIDE_EJECUTAR.test(opts.user)) {
    ejecucion = await ejecutarCodigo(codigoFinal);
    if (!ejecucion.ok) {
      reply = `${reply.trim()}\n\nEjecución real: falló (exit ${ejecucion.exit_code}). ${ejecucion.stderr || ejecucion.error || ''}`.trim();
    } else {
      reply = `${reply.trim()}\n\nEjecución real (stdout): ${ejecucion.stdout || '(vacío)'}`.trim();
    }
  }

  return { reply, bruto: primero.raw, critica, ejecucion, corregido, meta };
}
