/**
 * Catálogo de expresiones humanas para ULTRON (voz JARVIS).
 * Se insertan de forma natural según contexto — no forzadas en cada frase.
 */
export type ExpressionContext =
  | 'thinking'
  | 'searching'
  | 'confirming'
  | 'reacting'
  | 'waiting'
  | 'understanding'
  | 'agreeing'
  | 'greeting'
  | 'closing';

export interface HumanExpression {
  id: string;
  text: string;
  context: ExpressionContext;
}

export const HUMAN_EXPRESSIONS: HumanExpression[] = [
  // thinking
  { id: 'mmm', text: 'Mmm…', context: 'thinking' },
  { id: 'dejame_pensar', text: 'Déjame pensar…', context: 'thinking' },
  { id: 'veamos', text: 'Veamos…', context: 'thinking' },
  { id: 'hmm', text: 'Hmm…', context: 'thinking' },
  { id: 'un_segundo', text: 'Un segundo…', context: 'thinking' },
  // searching
  { id: 'a_ver', text: 'A ver…', context: 'searching' },
  { id: 'busco', text: 'Déjame buscar…', context: 'searching' },
  { id: 'reviso', text: 'Reviso eso…', context: 'searching' },
  { id: 'miro', text: 'Mira, veamos…', context: 'searching' },
  // reacting
  { id: 'interesante', text: 'Interesante…', context: 'reacting' },
  { id: 'vaya', text: 'Vaya…', context: 'reacting' },
  { id: 'ojo', text: 'Ojo con eso…', context: 'reacting' },
  { id: 'buen_punto', text: 'Buen punto.', context: 'reacting' },
  // understanding
  { id: 'ah_entiendo', text: 'Ah, entiendo.', context: 'understanding' },
  { id: 'claro_si', text: 'Claro, sí.', context: 'understanding' },
  { id: 'tiene_sentido', text: 'Tiene sentido.', context: 'understanding' },
  // waiting
  { id: 'un_momento', text: 'Un momento.', context: 'waiting' },
  { id: 'dame_un_instante', text: 'Dame un instante.', context: 'waiting' },
  { id: 'ya_voy', text: 'Ya voy.', context: 'waiting' },
  // confirming
  { id: 'perfecto', text: 'Perfecto.', context: 'confirming' },
  { id: 'listo', text: 'Listo.', context: 'confirming' },
  { id: 'hecho', text: 'Hecho.', context: 'confirming' },
  { id: 'de_acuerdo', text: 'De acuerdo.', context: 'confirming' },
  // agreeing
  { id: 'claro', text: 'Claro.', context: 'agreeing' },
  { id: 'por_supuesto', text: 'Por supuesto.', context: 'agreeing' },
  { id: 'sin_problema', text: 'Sin problema.', context: 'agreeing' },
  { id: 'como_gustes', text: 'Como gustes.', context: 'agreeing' },
  // greeting / closing
  { id: 'aqui_estoy', text: 'Aquí estoy.', context: 'greeting' },
  { id: 'dime', text: 'Dime.', context: 'greeting' },
  { id: 'cuando_quieras', text: 'Cuando quieras.', context: 'closing' },
  { id: 'quedamos_asi', text: 'Quedamos así.', context: 'closing' },
];

const BY_CONTEXT = HUMAN_EXPRESSIONS.reduce(
  (acc, e) => {
    (acc[e.context] ||= []).push(e);
    return acc;
  },
  {} as Record<ExpressionContext, HumanExpression[]>
);

export function pickExpression(context: ExpressionContext, seed?: number): HumanExpression {
  const list = BY_CONTEXT[context] || BY_CONTEXT.thinking;
  const i = Math.abs(seed ?? Date.now()) % list.length;
  return list[i];
}

/** Guía para el system prompt: usar 0–1 expresión natural, no forzar. */
export function expressionsSystemHint(): string {
  return `Puedes empezar ocasionalmente (no siempre) con una expresión humana breve según el momento:
pensando: "Mmm…", "Déjame pensar…"; buscando: "A ver…"; confirmando: "Perfecto.", "Claro.";
entendiendo: "Ah, entiendo."; esperando: "Un momento.". Máximo una por respuesta, tono calmado.`;
}

export function inferExpressionContext(userMessage: string, assistantDraft?: string): ExpressionContext | null {
  const q = userMessage.toLowerCase();
  if (/^(hola|hey|buenas|saludos)/.test(q)) return 'greeting';
  if (/busca|encuentra|dónde|donde|quién|quien|orden global|doctrina/.test(q)) return 'searching';
  if (/explica|por qué|porque|cómo|como|analiza|calcul/.test(q)) return 'thinking';
  if (/ok|vale|hazlo|confirma|sí|si\b|adelante/.test(q)) return 'confirming';
  if (assistantDraft && /interesante|vaya/.test(assistantDraft.toLowerCase())) return 'reacting';
  // ~35% chance of a soft lead-in for longer replies
  if ((assistantDraft?.length || 0) > 40 && Date.now() % 10 < 4) return 'thinking';
  return null;
}
