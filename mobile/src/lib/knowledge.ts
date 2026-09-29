/** Respuestas locales (sin red) y la entrevista opcional «Conocer», en español e inglés. */
import { idiomaActual, localeActual, tr } from '../i18n';

export const CONOCER_QUESTIONS = [
  { id: 'nombre', prompt: 'Para conocerte mejor… ¿cómo te gusta que te diga?', promptEn: 'To get to know you better… what would you like me to call you?', memoryKey: 'nombre_preferido' },
  { id: 'origen', prompt: '¿De dónde eres, o dónde vives ahora?', promptEn: 'Where are you from, or where do you live now?', memoryKey: 'origen' },
  { id: 'trabajo', prompt: '¿Cuál es tu rol en la junta o a qué te dedicas día a día?', promptEn: 'What’s your role on the board, or what do you do day to day?', memoryKey: 'trabajo' },
  { id: 'familia', prompt: 'Cuéntame de alguien importante para ti — familia o personas cercanas.', promptEn: 'Tell me about someone important to you — family or people close to you.', memoryKey: 'familia' },
  { id: 'gustos', prompt: 'Cuando sales del modo junta… ¿qué te gusta hacer?', promptEn: 'When you step out of board mode… what do you like to do?', memoryKey: 'gustos' },
  { id: 'musica', prompt: '¿Qué música te relaja o te pone de buen humor?', promptEn: 'What music relaxes you or puts you in a good mood?', memoryKey: 'musica' },
  { id: 'comida', prompt: '¿Comida o bebida favorita?', promptEn: 'Favorite food or drink?', memoryKey: 'comida' },
  { id: 'meta', prompt: '¿Qué objetivo grande tienes este año?', promptEn: 'What big goal do you have this year?', memoryKey: 'meta_anual' },
  { id: 'estilo', prompt: '¿Prefieres que te hable formal, cálido o bien directo?', promptEn: 'Do you prefer I speak to you formally, warmly, or very directly?', memoryKey: 'estilo_habla' },
  { id: 'apodo', prompt: '¿Algún apodo o detalle raro que deba recordar de ti?', promptEn: 'Any nickname or quirky detail I should remember about you?', memoryKey: 'apodo' },
  // Extra (después de las 10): solo con «conocer más»
  { id: 'miedo', prompt: '¿Hay algo que te preocupe y quieras que yo vigile?', promptEn: 'Is there something that worries you that you’d like me to keep an eye on?', memoryKey: 'preocupacion' },
  { id: 'energia', prompt: '¿En qué momento del día sueles estar más cansado o más afilado?', promptEn: 'At what time of day are you usually most tired, or sharpest?', memoryKey: 'ritmo_energia' },
  { id: 'limites', prompt: '¿Hay temas que prefieres que yo no toque?', promptEn: 'Are there topics you’d rather I didn’t bring up?', memoryKey: 'limites' },
  { id: 'cumple', prompt: 'Si quieres, dime tu cumpleaños (día/mes).', promptEn: 'If you want, tell me your birthday (day/month).', memoryKey: 'cumpleanos' },
] as const;

/** La pregunta de la entrevista en el idioma elegido. */
export function preguntaConocer(i: number): string {
  const q = CONOCER_QUESTIONS[i];
  return idiomaActual() === 'en' ? q.promptEn : q.prompt;
}

/** Preguntas del núcleo (la entrevista termina sola al responderlas). */
export const CONOCER_CORE = 10;

export function horaLocal(d = new Date()) {
  const hora = d.toLocaleTimeString(localeActual(), { hour: '2-digit', minute: '2-digit' });
  return tr(`Son las ${hora}.`, `It’s ${hora}.`);
}

export function fechaLocal(d = new Date()) {
  const fecha = d.toLocaleDateString(localeActual(), { weekday: 'long', day: 'numeric', month: 'long' });
  return tr(`Hoy es ${fecha}.`, `Today is ${fecha}.`);
}

/** La ayuda en voz alta, en el idioma elegido. */
export function ayuda(): string {
  return tr(
    'Habla y te respondo; no hace falta llamarme. Desliza desde el borde derecho para el menú y el catálogo de lo que puedo hacer. ' +
      'Tócame: los ojos guiñan, la frente me da curiosidad, la barbilla me hace reír; arrastra el dedo y te sigo con la mirada. ' +
      'Abajo tienes mis atajos. Di «qué ves», «cuéntame un chiste» o «modo gold».',
    'Talk and I’ll answer; no need to call me. Swipe from the right edge for the menu and the catalog of what I can do. ' +
      'Touch me: my eyes wink, my forehead gets curious, my chin makes me laugh; drag your finger and my eyes follow. ' +
      'My shortcuts are at the bottom. Try “what do you see”, “tell me a joke” or ask me anything.'
  );
}
