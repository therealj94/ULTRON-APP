/**
 * Los avatares de AU-RA FP. Se elige uno al entrar.
 *
 * Cuatro personajes, un solo cerebro (mismas herramientas y memoria), pero cada uno con su cara, su
 * voz, sus colores y su oficio: la interfaz y los atajos cambian con él.
 *
 *  · Guardián (los ojos celestes): cuida el espacio. Cámara, vigilancia, modos.
 *  · AU-RA (la dorada): compañera personal. Agenda, recordatorios, memoria, oración, canto.
 *  · Claudio (el zorro): anfitrión de marketing. Ideas, textos y publicaciones para redes.
 *    Acostado se le ve de retrato; derecho, de cuerpo entero a pantalla completa (está parado).
 *  · ANT-ONIO (la hormiga de lentes y cuatro brazos): aliado para organizar y resolver. Tareas,
 *    planes, recordatorios, trámites y cómo usar las apps. Se reparte la pantalla como Claudio.
 *
 * Claudio, AU-RA y ANT-ONIO tienen cuerpo 3D (avatar3d/modelo.ts) cuando el teléfono lo aguanta; si
 * no, Claudio y ANT-ONIO se ven con sus fotos (las de ANT-ONIO salen de su modelo) y AU-RA con su
 * figurita.
 *
 * Guardián y AU-RA, en vertical, se hacen un cuadro arriba con el chat abajo.
 *
 * Vive aparte (sin React Native) para que las pruebas y el almacenamiento lo lean sin arrastrar
 * componentes.
 */
import type { Bilingue } from '../i18n';

export type AvatarId = 'ojos' | 'aura' | 'claudio' | 'antonio';

/**
 * Un atajo del avatar: lo que se ve en el botón y lo que se le pide a la mesa al tocarlo. Si el
 * pedido es un comando de la mesa («qué ves», «modo guardian», «ora por el día») va en español en
 * los dos idiomas: lo reconoce intenciones.ts. Lo demás va al cerebro en el idioma elegido.
 */
export type Accion = { id: string; etiqueta: Bilingue; pedido: Bilingue };

/** Los colores del avatar: la interfaz entera toma su acento. */
export type TemaAvatar = {
  /** Color de acento (botones, anillos, burbujas propias). */
  acento: string;
  /** Texto sobre fondos oscuros con el tono del acento. */
  acentoTexto: string;
  /** El acento muy apagado, para fondos de burbujas y tarjetas elegidas. */
  acentoFondo: string;
  /** Texto sobre un botón de acento. */
  sobreAcento: string;
  /** El fondo de la pantalla del avatar. */
  fondo: string;
};

export type Avatar = {
  id: AvatarId;
  nombre: Bilingue;
  /** Una línea para la tarjeta de elección. */
  descripcion: Bilingue;
  /** Su oficio, dicho corto (tarjeta y encabezado del chat). */
  oficio: Bilingue;
  /** Qué voz tiene, dicho para una persona. */
  voz: Bilingue;
  /** Con qué saluda cuando se lo elige. */
  presentacion: Bilingue;
  tema: TemaAvatar;
  /** Sus atajos, en el chat y en el menú. */
  acciones: readonly Accion[];
};

export const AVATARES: readonly Avatar[] = [
  {
    id: 'ojos',
    nombre: { es: 'Guardián', en: 'Guardian' },
    descripcion: { es: 'Los ojos celestes. Sereno, preciso y atento.', en: 'The cyan eyes. Calm, precise and alert.' },
    oficio: { es: 'Cuida tu espacio', en: 'Watches over your space' },
    voz: { es: 'Voz de hombre, serena', en: 'Calm male voice' },
    presentacion: { es: 'Te escucho. Soy tu Guardián: vigilo, veo y te aviso.', en: 'I’m listening. I’m your Guardian: I watch, I see, and I let you know.' },
    tema: { acento: '#5CE1FF', acentoTexto: '#8FEBFF', acentoFondo: 'rgba(92,225,255,0.14)', sobreAcento: '#031217', fondo: '#000000' },
    acciones: [
      { id: 'ver', etiqueta: { es: '¿Qué ves?', en: 'What do you see?' }, pedido: { es: 'qué ves', en: 'qué ves' } },
      { id: 'vigila', etiqueta: { es: 'Vigila', en: 'Keep watch' }, pedido: { es: 'modo guardian', en: 'modo guardian' } },
      { id: 'seguridad', etiqueta: { es: 'Consejo de seguridad', en: 'Safety tip' }, pedido: { es: 'Dame un consejo corto de seguridad para mi casa u oficina.', en: 'Give me a short safety tip for my home or office.' } },
      { id: 'escena', etiqueta: { es: 'Describe la escena', en: 'Describe the scene' }, pedido: { es: 'describe la escena', en: 'describe la escena' } },
    ],
  },
  {
    id: 'aura',
    nombre: { es: 'AU-RA', en: 'AU-RA' },
    descripcion: { es: 'Los ojos dorados. Cálida y cercana.', en: 'The golden eyes. Warm and close.' },
    oficio: { es: 'Tu compañera personal', en: 'Your personal companion' },
    voz: { es: 'Voz de mujer, cálida', en: 'Warm female voice' },
    presentacion: { es: 'Aquí estoy. Soy AU-RA, tu compañera. ¿Qué hacemos hoy?', en: 'Here I am. I’m AU-RA, your companion. What are we doing today?' },
    tema: { acento: '#D6B56C', acentoTexto: '#E7CD92', acentoFondo: 'rgba(214,181,108,0.16)', sobreAcento: '#1E1A12', fondo: '#232528' },
    acciones: [
      { id: 'agenda', etiqueta: { es: 'Mi día', en: 'My day' }, pedido: { es: 'Ayúdame a organizar mi día: pregúntame qué tengo pendiente y armamos un plan corto.', en: 'Help me organize my day: ask me what I have pending and let’s make a short plan.' } },
      { id: 'recuerda', etiqueta: { es: 'Recuérdame algo', en: 'Remember this' }, pedido: { es: 'Quiero que recuerdes algo importante. Pregúntame qué es.', en: 'I want you to remember something important. Ask me what it is.' } },
      { id: 'animo', etiqueta: { es: 'Dame ánimo', en: 'Cheer me up' }, pedido: { es: 'Dame unas palabras de ánimo cortas y sinceras para hoy.', en: 'Give me a few short, sincere words of encouragement for today.' } },
      { id: 'ora', etiqueta: { es: 'Ora conmigo', en: 'Pray with me' }, pedido: { es: 'ora por el día', en: 'ora por el día' } },
    ],
  },
  {
    id: 'claudio',
    nombre: { es: 'Claudio', en: 'Claudio' },
    descripcion: { es: 'El zorro de lentes. Ingenioso y bromista.', en: 'The fox with glasses. Witty and playful.' },
    oficio: { es: 'Tu anfitrión de marketing', en: 'Your marketing host' },
    voz: { es: 'CLAUDIO, voz de hombre juguetona', en: 'CLAUDIO, playful male voice' },
    presentacion: { es: '¡Hola! Soy Claudio. Traigo ideas frescas y los lentes puestos. ¿Qué vendemos hoy?', en: 'Hey! I’m Claudio. Fresh ideas, glasses on. What are we selling today?' },
    tema: { acento: '#FF9A4D', acentoTexto: '#FFB981', acentoFondo: 'rgba(255,154,77,0.16)', sobreAcento: '#231205', fondo: '#1F1B18' },
    acciones: [
      { id: 'ideas', etiqueta: { es: 'Ideas de contenido', en: 'Content ideas' }, pedido: { es: 'Dame 5 ideas de contenido para redes de Orden Global esta semana, cada una con su gancho.', en: 'Give me 5 social media content ideas for Orden Global this week, each with its hook.' } },
      { id: 'post', etiqueta: { es: 'Escribe un post', en: 'Write a post' }, pedido: { es: 'Escríbeme un post corto para Instagram. Pregúntame primero de qué producto o tema.', en: 'Write me a short Instagram post. First ask me which product or topic.' } },
      { id: 'eslogan', etiqueta: { es: 'Eslóganes', en: 'Slogans' }, pedido: { es: 'Propón 5 eslóganes cortos y memorables. Pregúntame para qué marca o campaña.', en: 'Suggest 5 short, catchy slogans. Ask me which brand or campaign.' } },
      { id: 'guion', etiqueta: { es: 'Guion de video', en: 'Video script' }, pedido: { es: 'Escribe un guion de video de 30 segundos para redes. Pregúntame el tema primero.', en: 'Write a 30-second social video script. Ask me the topic first.' } },
    ],
  },
  {
    id: 'antonio',
    nombre: { es: 'ANT-ONIO', en: 'ANT-ONIO' },
    descripcion: { es: 'La hormiga de lentes y cuatro brazos. Enérgico y práctico.', en: 'The ant with glasses and four arms. Energetic and practical.' },
    oficio: { es: 'Tu aliado para resolver', en: 'Your ally to get things done' },
    voz: { es: 'Voz de hombre, enérgica y clara', en: 'Energetic, clear male voice' },
    presentacion: { es: '¡Aquí ANT-ONIO! Con cuatro brazos hacemos varias cosas a la vez. ¿Qué resolvemos?', en: 'ANT-ONIO here! Four arms, several things at once. What are we solving?' },
    tema: { acento: '#45C9DE', acentoTexto: '#8FE3F0', acentoFondo: 'rgba(69,201,222,0.15)', sobreAcento: '#04161A', fondo: '#171B1E' },
    acciones: [
      { id: 'plan', etiqueta: { es: 'Plan paso a paso', en: 'Step-by-step plan' }, pedido: { es: 'Ayúdame a armar un plan paso a paso. Pregúntame primero qué quiero lograr.', en: 'Help me build a step-by-step plan. First ask me what I want to achieve.' } },
      { id: 'pendientes', etiqueta: { es: 'Mis pendientes', en: 'My to-dos' }, pedido: { es: 'Organicemos mis pendientes: pregúntame qué tengo y los ordenamos por prioridad.', en: 'Let’s organize my to-dos: ask me what I have and we’ll sort them by priority.' } },
      { id: 'resumen', etiqueta: { es: 'Resúmeme algo', en: 'Summarize this' }, pedido: { es: 'Quiero un resumen corto y claro. Pregúntame de qué.', en: 'I want a short, clear summary. Ask me what about.' } },
      { id: 'apps', etiqueta: { es: '¿Cómo uso la app?', en: 'How do I use the app?' }, pedido: { es: 'Explícame en pasos cortos cómo hacer algo en Veta Wallet, Genesis ID o PULSE2CHAT. Pregúntame qué necesito.', en: 'Explain in short steps how to do something in Veta Wallet, Genesis ID or PULSE2CHAT. Ask me what I need.' } },
    ],
  },
];

export function normalizarAvatarId(v: unknown): AvatarId {
  // «claudio-pie» es de la 4.5: el de pie es el mismo Claudio (se pone de pie en vertical).
  if (v === 'claudio' || v === 'claudio-pie') return 'claudio';
  if (v === 'ojos') return 'ojos';
  if (v === 'antonio' || v === 'ant-onio') return 'antonio';
  return 'aura';
}

/** ¿Se le ve con fotos (retrato acostado, de pie derecho) cuando no hay 3D? Claudio y ANT-ONIO. */
export function conFotos(id: AvatarId): boolean {
  return id === 'claudio' || id === 'antonio';
}

export function avatarPorId(id: AvatarId): Avatar {
  return AVATARES.find((a) => a.id === id) || AVATARES[1];
}

export type Distribucion = {
  /** `completa`: el avatar ocupa todo y el chat flota encima. `cuadro`: recuadro + chat. */
  tipo: 'completa' | 'cuadro';
  chat: 'abajo' | 'lado' | 'flota';
  /** Claudio y ANT-ONIO: retrato acostado, de cuerpo entero derecho. */
  pose: 'retrato' | 'pie' | null;
};

/** Cómo se reparte la pantalla para este avatar en esta orientación. */
export function distribucion(id: AvatarId, horizontal: boolean): Distribucion {
  if (conFotos(id)) return { tipo: 'completa', chat: 'flota', pose: horizontal ? 'retrato' : 'pie' };
  if (horizontal) return { tipo: 'completa', chat: 'flota', pose: null };
  return { tipo: 'cuadro', chat: 'abajo', pose: null };
}
