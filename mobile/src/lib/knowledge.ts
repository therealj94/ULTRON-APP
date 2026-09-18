/** Pack offline embebido — responde sin red cuando el servidor falla. */

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

type FaqItem = { match: RegExp; answer: string | (() => string) };

export const LOCAL_FAQ: FaqItem[] = [
  {
    match: /estado|status|salud|como estas|cómo estás/,
    answer: 'Estoy en línea en modo nativo Android. Sensores listos. Núcleo ULTRON FP operativo.',
  },
  {
    match: /hora|que hora|qué hora/,
    answer: () => {
      const d = new Date();
      return `Son las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`;
    },
  },
  {
    match: /fecha|que dia|qué día|que dia es/,
    answer: () => {
      const d = new Date();
      return `Hoy es ${d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}.`;
    },
  },
  {
    match: /ayuda|tutorial|que puedes|qué puedes|comandos/,
    answer:
      'Habla y te respondo. Desliza desde la derecha para el menú. Tócame: reacciono; si insistes, me enojo y disparo. Di «canta salsa» o «sable jedi».',
  },
  {
    match: /orden global|doctrina|alfa/,
    answer: () =>
      'Orden Global es el Directorio Alfa-1. Tengo cinco doctrinas: ALFA-770 soberanía tecnológica, BETA-912 tesorería, GAMMA-404 voto blindado, DELTA-108 perímetro y EPSILON-221 cadena de mando. ¿Cuál quieres?',
  },
  {
    match: /offline|sin internet|sin red/,
    answer:
      'Sin red sigo contigo: gestos de voz, memoria local, conocer, y respuestas básicas. El cerebro Qwen y TTS neural necesitan servidor.',
  },
];

export function localAnswer(cmd: string): string | null {
  const q = cmd.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const item of LOCAL_FAQ) {
    if (item.match.test(q)) {
      return typeof item.answer === 'function' ? item.answer() : item.answer;
    }
  }
  if (/modo\s+(guardian|guardian)/.test(q)) return 'Modo GUARDIAN activo. Vigilo el escritorio.';
  if (/modo\s+(conocer)/.test(q)) return 'Modo CONOCER. Vamos a conocernos mejor.';
  if (/modo\s+(explorer|explorar)/.test(q)) return 'Modo EXPLORER. Listo para investigar.';
  if (/modo\s+(creative|creativo)/.test(q)) return 'Modo CREATIVE. Ideas en marcha.';
  if (/duerme|a dormir|modo sleep|vete a dormir/.test(q)) return 'Modo sleep. Háblame o tócame para despertar.';
  if (/despierta|wake|levantate/.test(q)) return 'Despierto. Te escucho.';
  return null;
}

export const MODE_HINTS: Record<string, string> = {
  GUARDIAN: 'Vigilancia y seguridad del escritorio',
  MINING: 'Extracción de datos y señales',
  GOLD: 'Prioridad alto valor',
  CREATIVE: 'Ideas y narrativa',
  ANALYTICAL: 'Análisis frío',
  STRATEGIC: 'Decisiones de junta',
  EXPLORER: 'Investigación abierta',
  CONOCER: 'Entrevista personal',
};
