/**
 * Compositor de mensajes hacia Qwen.
 * Orden: honestidad → (voz escritorio | few-shot+CoT+RAG) → personalidad/HECHOS → usuario.
 * Un solo sitio para que tests y server.ts verifiquen la inyección.
 */

import { FEW_SHOT_HONESTO } from './prompts/few-shot';
import { COT_FORZADO, esTareaDeCodigo, requiereCot } from './prompts/cot';
import { SYSTEM_PROMPT_HONESTO, TEXTO_TELEGRAM, VOZ_ESCRITORIO } from './prompts/honestidad';
import { INSTRUCCION_HARNESS } from './harness';
import { buscarSnippets } from './rag';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type MensajesMeta = {
  cot: boolean;
  fewShot: boolean;
  codigo: boolean;
  rag: number;
  voz: boolean;
  harness: boolean;
};

export function construirMensajes(opts: {
  personalidad: string;
  user: string;
  fewShot?: boolean;
  cot?: boolean;
  rag?: boolean;
  canal?: 'mesa' | 'telegram';
}): { messages: ChatMessage[]; meta: MensajesMeta } {
  const user = String(opts.user || '').trim();
  const codigo = esTareaDeCodigo(user);
  const cot = opts.cot ?? requiereCot(user);
  const fewShot = opts.fewShot ?? codigo;
  const ragOn = opts.rag ?? codigo;
  const telegram = opts.canal === 'telegram';
  const harness = telegram || codigo;

  const parts: string[] = [SYSTEM_PROMPT_HONESTO];
  if (!codigo) parts.push(telegram ? TEXTO_TELEGRAM : VOZ_ESCRITORIO);
  parts.push(String(opts.personalidad || '').trim());
  if (harness) parts.push(INSTRUCCION_HARNESS);
  if (cot) parts.push(COT_FORZADO);
  if (fewShot) parts.push(FEW_SHOT_HONESTO);

  let rag = 0;
  if (ragOn) {
    const snips = buscarSnippets(user, 3);
    rag = snips.length;
    if (snips.length) {
      parts.push(
        'SNIPPETS VERIFICADOS (úsalos como referencia; no copies ciego si no encajan):\n' +
          snips.map((s, i) => `${i + 1}. ${s.descripcion}\n\`\`\`${s.lang}\n${s.codigo}\n\`\`\``).join('\n\n')
      );
    }
  }

  const system = parts.filter(Boolean).join('\n\n');
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    meta: { cot, fewShot, codigo, rag, voz: !codigo, harness },
  };
}

export function extraerBloquesDeCodigo(texto: string): { lang: string; codigo: string }[] {
  const out: { lang: string; codigo: string }[] = [];
  const re = /```([A-Za-z0-9_+-]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(texto || '')))) {
    out.push({ lang: (m[1] || '').toLowerCase(), codigo: m[2].trim() });
  }
  return out;
}

/** Primer bloque Python (o el primero si no hay lenguaje). */
export function extraerPython(texto: string): string {
  const bloques = extraerBloquesDeCodigo(texto);
  const py = bloques.find((b) => !b.lang || /py|python/.test(b.lang));
  return py?.codigo || '';
}
