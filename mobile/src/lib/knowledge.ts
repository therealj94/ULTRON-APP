/** Respuestas locales (sin red) y la entrevista opcional «Conocer». */

export const CONOCER_QUESTIONS = [
  { id: 'nombre', prompt: 'Para conocerte mejor… ¿cómo te gusta que te diga?', memoryKey: 'nombre_preferido' },
  { id: 'origen', prompt: '¿De dónde eres, o dónde vives ahora?', memoryKey: 'origen' },
  { id: 'trabajo', prompt: '¿Cuál es tu rol en la junta o a qué te dedicas día a día?', memoryKey: 'trabajo' },
  { id: 'familia', prompt: 'Cuéntame de alguien importante para ti — familia o personas cercanas.', memoryKey: 'familia' },
  { id: 'gustos', prompt: 'Cuando sales del modo junta… ¿qué te gusta hacer?', memoryKey: 'gustos' },
  { id: 'musica', prompt: '¿Qué música te relaja o te pone de buen humor?', memoryKey: 'musica' },
  { id: 'comida', prompt: '¿Comida o bebida favorita?', memoryKey: 'comida' },
  { id: 'meta', prompt: '¿Qué objetivo grande tienes este año?', memoryKey: 'meta_anual' },
  { id: 'estilo', prompt: '¿Prefieres que te hable formal, cálido o bien directo?', memoryKey: 'estilo_habla' },
  { id: 'apodo', prompt: '¿Algún apodo o detalle raro que deba recordar de ti?', memoryKey: 'apodo' },
  // Extra (después de las 10): solo con «conocer más»
  { id: 'miedo', prompt: '¿Hay algo que te preocupe y quieras que yo vigile?', memoryKey: 'preocupacion' },
  { id: 'energia', prompt: '¿En qué momento del día sueles estar más cansado o más afilado?', memoryKey: 'ritmo_energia' },
  { id: 'limites', prompt: '¿Hay temas que prefieres que yo no toque?', memoryKey: 'limites' },
  { id: 'cumple', prompt: 'Si quieres, dime tu cumpleaños (día/mes).', memoryKey: 'cumpleanos' },
] as const;

/** Preguntas del núcleo (la entrevista termina sola al responderlas). */
export const CONOCER_CORE = 10;

export function horaLocal(d = new Date()) {
  return `Son las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`;
}

export function fechaLocal(d = new Date()) {
  return `Hoy es ${d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}.`;
}

export const AYUDA =
  'Habla y te respondo; no hace falta llamarme. Desliza desde el borde derecho para el menú y el catálogo de lo que puedo hacer. ' +
  'Tócame: los ojos guiñan, la frente me da curiosidad, la barbilla me hace reír; arrastra el dedo y te sigo con la mirada. ' +
  'Di «qué ves», «canta 1», «cuéntame un chiste» o «modo gold».';
