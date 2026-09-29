/**
 * DE LAS TRAZAS A LOS DATOS DE ENTRENAMIENTO — lo que la mesa hizo de verdad, revisado por una
 * persona, convertido en ejemplos para Laya y para Qwen.
 *
 * Reglas que no se negocian (y que las pruebas fijan):
 *  · Solo entra lo que una persona aprobó (👍) o corrigió. Una respuesta sin revisar no enseña nada:
 *    el modelo aprendería sus propios errores.
 *  · Para Qwen, solo respuestas que escribió Qwen (el modelo del nodo) o correcciones escritas por
 *    una persona. Nunca salidas de otros modelos comerciales: sus términos lo prohíben y además
 *    arrastrarían su estilo y sus errores.
 *  · Se tapan los datos personales (correos, teléfonos, DNI, RTN) y los secretos antes de que un
 *    ejemplo salga de la base.
 *  · Los hechos no se entrenan: cargos, leyes y concesiones cambian y tienen que venir de las
 *    herramientas con su fuente. Lo que se enseña es el comportamiento: qué herramienta usar, con qué
 *    argumentos, cómo contestar y a quién de la mesa convocar.
 *
 * La revisión se guarda en la opinión de la traza que ya existe (feedback ±1 y su nota), en un
 * formato de líneas que sobrevive al recorte de 600 caracteres: sin tablas nuevas en la base.
 */
import { redactar } from '../cognitivo/base';

/** Lo que el exportador necesita de una traza (subconjunto de lib/cognitivo/traza.ts). */
export type TrazaParaEntrenar = {
  id: string;
  t_inicio: string;
  canal: string | null;
  pregunta: string;
  modelo: string | null;
  via: string | null;
  pasos: Array<{ herramienta: string; ok: boolean; args?: Record<string, unknown>; resumen?: string; ronda?: number }>;
  respuesta: string | null;
  error: string | null;
  feedback: number | null;
  feedback_nota: string | null;
};

import { ESPECIALISTAS, leerRevision, type Especialista } from './revision';
export { ESPECIALISTAS, escribirRevision, leerRevision, type Especialista, type Revision } from './revision';

/* ------------------------------------------------------------------ datos personales */

/**
 * Tapa lo que identifica a una persona. Los nombres de concesiones, titulares (empresas) y lugares
 * se quedan: son el oficio. Correos, teléfonos de Honduras, DNI (0801-1990-12345) y RTN (14 dígitos)
 * se van, igual que los secretos que ya tapa `redactar`.
 */
export function taparPersonales(texto: string): string {
  return redactar(String(texto ?? ''))
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[CORREO]')
    .replace(/\b\d{4}-?\d{4}-?\d{5}\b/g, '[DNI]')
    .replace(/\b\d{14}\b/g, '[RTN]')
    // 8 dígitos que empiezan en 2, 3, 8 o 9 (fijo o celular), con o sin +504. «2019-2025» es un
    // rango de años, no un teléfono.
    .replace(/(\+?504[\s-]?)?\b[2389]\d{3}[\s-]?\d{4}\b/g, (m) => (/^(19|20)\d{2}[\s-](19|20)\d{2}$/.test(m) ? m : '[TELÉFONO]'));
}

/* ------------------------------------------------------------------ qué sirve */

/** La escribió el modelo del nodo (Qwen). Las del MCP las escribe otro cliente: no son de Qwen. */
export function esDeQwen(t: TrazaParaEntrenar): boolean {
  return /qwen/i.test(t.modelo || '') && t.via !== 'mcp' && t.canal !== 'mcp';
}

/** Una «pregunta» que en realidad es una llamada directa a herramienta (lo que manda el MCP). */
const PARECE_LLAMADA = /^[a-z_]+\s*\{/;

const normal = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export type FilaLaya = { q: string; e: Especialista[]; origen: string };

/** Una fila para Laya «electrum», si alguien marcó a quién tocaba convocar. */
export function filaLaya(t: TrazaParaEntrenar): FilaLaya | null {
  const r = leerRevision(t.feedback_nota);
  if (!r.panel) return null;
  const q = taparPersonales(t.pregunta).trim();
  if (!q || PARECE_LLAMADA.test(q)) return null;
  return { q, e: r.panel, origen: `traza:${t.id}` };
}

export type MensajeChat =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: Array<{ type: 'function'; function: { name: string; arguments: Record<string, unknown> } }> }
  | { role: 'tool'; name: string; content: string };

export type EjemploQwen = { id: string; messages: MensajeChat[]; herramientas: string[]; origen: 'aprobada' | 'corregida' };

export type Motivo =
  | 'sin revisar'
  | 'no sirvió y sin corrección'
  | 'no es de Qwen'
  | 'es una llamada directa (MCP)'
  | 'terminó con error'
  | 'sin respuesta'
  | 'faltan los argumentos de una herramienta'
  | 'repetida';

/**
 * Un ejemplo de conversación para ajustar a Qwen: la pregunta, las llamadas a herramientas tal como
 * se hicieron (solo las reales, las internas del arnés no), lo que devolvieron y la respuesta final:
 * la aprobada, o la corrección escrita por la persona que revisó.
 */
export function ejemploQwen(t: TrazaParaEntrenar, herramientasReales: Set<string>, sistema: string): { ejemplo: EjemploQwen } | { motivo: Motivo } {
  const r = leerRevision(t.feedback_nota);
  if (PARECE_LLAMADA.test(t.pregunta.trim()) || t.canal === 'mcp' || t.via === 'mcp') return { motivo: 'es una llamada directa (MCP)' };
  if (t.feedback == null) return { motivo: 'sin revisar' };
  if (t.feedback < 0 && !r.corrige) return { motivo: 'no sirvió y sin corrección' };
  // Una corrección la escribió una persona: vale aunque la respuesta original no fuera de Qwen.
  if (!r.corrige && !esDeQwen(t)) return { motivo: 'no es de Qwen' };
  if (t.error && !r.corrige) return { motivo: 'terminó con error' };
  const final = taparPersonales(r.corrige || t.respuesta || '').trim();
  if (!final) return { motivo: 'sin respuesta' };

  const reales = t.pasos.filter((p) => p.ok && herramientasReales.has(p.herramienta));
  if (reales.some((p) => !p.args)) return { motivo: 'faltan los argumentos de una herramienta' };

  const messages: MensajeChat[] = [
    { role: 'system', content: sistema },
    { role: 'user', content: taparPersonales(t.pregunta) },
  ];
  // Las llamadas de una misma ronda van juntas (el modelo las pidió a la vez), como en el turno real.
  const rondas = new Map<number, typeof reales>();
  reales.forEach((p, i) => {
    const k = p.ronda ?? i;
    rondas.set(k, [...(rondas.get(k) || []), p]);
  });
  for (const ps of [...rondas.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)) {
    messages.push({ role: 'assistant', content: '', tool_calls: ps.map((p) => ({ type: 'function' as const, function: { name: p.herramienta, arguments: p.args || {} } })) });
    for (const p of ps) messages.push({ role: 'tool', name: p.herramienta, content: taparPersonales(p.resumen || '(sin resumen)') });
  }
  messages.push({ role: 'assistant', content: final });
  return {
    ejemplo: {
      id: `traza:${t.id}`,
      messages,
      herramientas: [...new Set(reales.map((p) => p.herramienta))],
      origen: r.corrige ? 'corregida' : 'aprobada',
    },
  };
}

export type CasoEval = { id: string; area: string; pregunta: string; espera: { herramientas?: string[]; agente?: string }; nota: string };

/** Un caso para evals/electrum.jsonl: lo que una respuesta aprobada hizo bien, para no perderlo. */
export function casoEval(t: TrazaParaEntrenar, herramientasReales: Set<string>): CasoEval | null {
  if (t.feedback !== 1 || PARECE_LLAMADA.test(t.pregunta.trim()) || t.canal === 'mcp') return null;
  const r = leerRevision(t.feedback_nota);
  const herramientas = [...new Set(t.pasos.filter((p) => p.ok && herramientasReales.has(p.herramienta)).map((p) => p.herramienta))];
  const agente = r.panel?.[0];
  if (!herramientas.length && !agente) return null;
  return {
    id: `real-${t.id.slice(0, 8)}`,
    area: agente || 'real',
    pregunta: taparPersonales(t.pregunta),
    espera: { ...(herramientas.length ? { herramientas } : {}), ...(agente ? { agente } : {}) },
    nota: `De una respuesta aprobada el ${t.t_inicio.slice(0, 10)}.`,
  };
}

export type Exportacion = {
  laya: FilaLaya[];
  qwen: EjemploQwen[];
  evals: CasoEval[];
  informe: {
    trazas: number;
    revisadas: number;
    laya: number;
    qwen: { aprobadas: number; corregidas: number };
    evals: number;
    excluidas: Partial<Record<Motivo, number>>;
    /** Señales de dónde falla hoy, para priorizar la revisión. */
    senales: { llamadasIlegibles: number; sinRondas: number; errores: number };
  };
};

/** Todo junto, sin repetir la misma pregunta dos veces en un mismo conjunto. */
export function exportar(trazas: TrazaParaEntrenar[], herramientasReales: Set<string>, sistema: string): Exportacion {
  const laya: FilaLaya[] = [];
  const qwen: EjemploQwen[] = [];
  const evals: CasoEval[] = [];
  const excluidas: Partial<Record<Motivo, number>> = {};
  const vistas = { laya: new Set<string>(), qwen: new Set<string>(), evals: new Set<string>() };
  const excluir = (m: Motivo) => (excluidas[m] = (excluidas[m] || 0) + 1);

  for (const t of trazas) {
    const clave = normal(t.pregunta);
    const f = filaLaya(t);
    if (f && !vistas.laya.has(clave)) {
      vistas.laya.add(clave);
      laya.push(f);
    }
    const q = ejemploQwen(t, herramientasReales, sistema);
    if ('motivo' in q) excluir(q.motivo);
    else if (vistas.qwen.has(clave)) excluir('repetida');
    else {
      vistas.qwen.add(clave);
      qwen.push(q.ejemplo);
    }
    const c = casoEval(t, herramientasReales);
    if (c && !vistas.evals.has(clave)) {
      vistas.evals.add(clave);
      evals.push(c);
    }
  }
  return {
    laya,
    qwen,
    evals,
    informe: {
      trazas: trazas.length,
      revisadas: trazas.filter((t) => t.feedback != null).length,
      laya: laya.length,
      qwen: { aprobadas: qwen.filter((e) => e.origen === 'aprobada').length, corregidas: qwen.filter((e) => e.origen === 'corregida').length },
      evals: evals.length,
      excluidas,
      senales: {
        llamadasIlegibles: trazas.filter((t) => t.pasos.some((p) => p.herramienta === 'pedido_rechazado')).length,
        sinRondas: trazas.filter((t) => t.via === 'sin rondas').length,
        errores: trazas.filter((t) => !!t.error).length,
      },
    },
  };
}
