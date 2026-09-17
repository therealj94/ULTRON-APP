/** Preguntas del modo CONOCER — se guardan en memoria de personas. */

export type ConocerQuestion = {
  id: string;
  prompt: string;
  memoryKey: string;
};

export const CONOCER_QUESTIONS: ConocerQuestion[] = [
  { id: 'nombre', prompt: 'Para conocerte mejor: ¿cómo te gusta que te diga?', memoryKey: 'nombre_preferido' },
  { id: 'origen', prompt: '¿De dónde eres o dónde vives ahora?', memoryKey: 'origen' },
  { id: 'trabajo', prompt: '¿A qué te dedicas o cuál es tu rol en la junta?', memoryKey: 'trabajo' },
  { id: 'familia', prompt: 'Cuéntame algo de tu familia o personas importantes para ti.', memoryKey: 'familia' },
  { id: 'gustos', prompt: '¿Qué te gusta hacer cuando no estás en modo junta?', memoryKey: 'gustos' },
  { id: 'musica', prompt: '¿Qué música o estilo te relaja?', memoryKey: 'musica' },
  { id: 'comida', prompt: '¿Cuál es tu comida o bebida favorita?', memoryKey: 'comida' },
  { id: 'meta', prompt: '¿Qué objetivo grande tienes este año?', memoryKey: 'meta_anual' },
  { id: 'miedo', prompt: '¿Hay algo que te preocupe y quieras que yo vigile?', memoryKey: 'preocupacion' },
  { id: 'estilo', prompt: '¿Prefieres que te hable formal, cálido o directo?', memoryKey: 'estilo_habla' },
  { id: 'cumple', prompt: 'Si quieres, dime tu fecha de cumpleaños (día/mes).', memoryKey: 'cumpleanos' },
  { id: 'apodo', prompt: 'Última por ahora: ¿tienes algún apodo o detalle que deba recordar?', memoryKey: 'apodo' },
];

export function nextConocerIndex(answeredIds: string[]): number {
  return CONOCER_QUESTIONS.findIndex((q) => !answeredIds.includes(q.id));
}

export async function savePersonFact(opts: {
  nombre: string;
  rol?: string;
  correo?: string;
  key: string;
  value: string;
  conversationId?: string;
}) {
  await fetch('/api/memoria/personas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: opts.nombre,
      rol: opts.rol,
      correo: opts.correo,
      conversationId: opts.conversationId,
      hecho: { key: opts.key, value: opts.value, source: 'conocer' },
    }),
  });
}
