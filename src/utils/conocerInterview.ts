/** Preguntas del modo CONOCER — se guardan en memoria de personas. */

export type ConocerQuestion = {
  id: string;
  prompt: string;
  memoryKey: string;
};

export const CONOCER_QUESTIONS: ConocerQuestion[] = [
  { id: 'nombre', prompt: 'Para conocerte mejor… ¿cómo te gusta que te diga?', memoryKey: 'nombre_preferido' },
  { id: 'origen', prompt: '¿De dónde eres, o dónde vives ahora?', memoryKey: 'origen' },
  { id: 'trabajo', prompt: '¿Cuál es tu rol en la junta o a qué te dedicas día a día?', memoryKey: 'trabajo' },
  { id: 'familia', prompt: 'Cuéntame de alguien importante para ti — familia o personas cercanas.', memoryKey: 'familia' },
  { id: 'gustos', prompt: 'Cuando sales del modo junta… ¿qué te gusta hacer?', memoryKey: 'gustos' },
  { id: 'musica', prompt: '¿Qué música te relaja o te pone de buen humor?', memoryKey: 'musica' },
  { id: 'comida', prompt: '¿Comida o bebida favorita? Por si algún día te sorprendo.', memoryKey: 'comida' },
  { id: 'meta', prompt: '¿Qué objetivo grande tienes este año?', memoryKey: 'meta_anual' },
  { id: 'miedo', prompt: '¿Hay algo que te preocupe y quieras que yo vigile?', memoryKey: 'preocupacion' },
  { id: 'estilo', prompt: '¿Prefieres que te hable formal, cálido o bien directo?', memoryKey: 'estilo_habla' },
  { id: 'energia', prompt: '¿En qué momento del día sueles estar más cansado o más afilado?', memoryKey: 'ritmo_energia' },
  { id: 'limites', prompt: '¿Hay temas que prefieres que yo no toque?', memoryKey: 'limites' },
  { id: 'cumple', prompt: 'Si quieres, dime tu cumpleaños (día/mes).', memoryKey: 'cumpleanos' },
  { id: 'apodo', prompt: 'Última por ahora: ¿algún apodo o detalle raro que deba recordar de ti?', memoryKey: 'apodo' },
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
