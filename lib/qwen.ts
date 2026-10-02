/**
 * Compositor de mensajes hacia Qwen.
 * Orden: honestidad → (voz escritorio | few-shot+CoT+RAG) → personalidad/HECHOS → usuario.
 * Un solo sitio para que tests y server.ts verifiquen la inyección.
 */

import { FEW_SHOT_HONESTO } from './prompts/few-shot';
import { COT_FORZADO, pideCodigo, requiereCot } from './prompts/cot';
import { HONESTIDAD_CONVERSACION, promptHonesto, TEXTO_TELEGRAM, VOZ_ESCRITORIO } from './prompts/honestidad';
import { instruccionHarness } from './harness';
import type { NivelAura } from './perfiles/tipos';
import { buscarSnippets } from './rag';
import { esSaludoCorto, type MsgHilo } from './conversacion';

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
  historial?: MsgHilo[];
  harness?: boolean;
  /** Con quién habla (server/nivel.ts). Un miembro no oye «asistente de la junta» ni ve sistema/ejecutor. */
  nivel?: NivelAura;
  /** Es el dueño de un WhatsApp conectado (server/whatsapp.ts): se le ofrece la herramienta. */
  whatsapp?: boolean;
  /** El turno es de alguien con sesión: se le ofrecen sus misiones y su círculo (lib/harness.ts). */
  sesion?: boolean;
  /**
   * Lo que cambia en cada turno (hora, app, HECHOS: server/prompt-turno.ts piezasDelTurno). Va al FINAL
   * del system, después de las reglas fijas: así el principio es igual turno a turno y el nodo reutiliza
   * lo que ya leyó en vez de releer miles de fichas.
   */
  delTurno?: string;
}): { messages: ChatMessage[]; meta: MensajesMeta } {
  const user = String(opts.user || '').trim();
  // Solo un pedido de código cambia las instrucciones (pideCodigo); «analiza» solo es pensar con cuidado (cot).
  const codigo = pideCodigo(user);
  const cot = opts.cot ?? requiereCot(user);
  const fewShot = opts.fewShot ?? codigo;
  const ragOn = opts.rag ?? codigo;
  const telegram = opts.canal === 'telegram';
  const harness = opts.harness ?? (telegram || codigo || !esSaludoCorto(user));

  // Código: el prompt largo de honestidad (4 bloques, trazas). Conversación: la versión corta,
  // para que el 27B no arrastre reglas de tests y complejidad a una charla de mesa.
  const nivel: NivelAura = opts.nivel === 'miembro' ? 'miembro' : 'junta';
  const parts: string[] = [codigo ? promptHonesto(nivel) : HONESTIDAD_CONVERSACION];
  if (!codigo) parts.push(telegram ? TEXTO_TELEGRAM : VOZ_ESCRITORIO);
  parts.push(String(opts.personalidad || '').trim());
  if (harness) parts.push(instruccionHarness(nivel, undefined, !!opts.whatsapp, !!opts.sesion));
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

  if (opts.delTurno) parts.push(String(opts.delTurno).trim());
  const system = parts.filter(Boolean).join('\n\n');
  const historial = (opts.historial || []).slice(-16);
  return {
    messages: [{ role: 'system', content: system }, ...historial, { role: 'user', content: user }],
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
