/**
 * EL GUION DEL RECORRIDO: Claudio y ANT-ONIO enseñan, hablando entre ellos y con ejemplos animados,
 * todo lo que hace AU-RA en el teléfono (José, 2-oct: «que asombre… que diga puedo ver la cámara y
 * saque una cámara y tire flash y analice la imagen, llamar y siga en la llamada, recordatorios y
 * aparezca pequeño y explique ahí puede estar… que lo hagas hablar y no sea plano y interactuar»).
 *
 * Cada escena es una función de la app con su animación (escenas/*.tsx). Cada línea la dice uno de los
 * dos con su voz; al empezar puede mover la animación a un `paso` (la cámara se abre, suena el flash,
 * entra la llamada…) y pedirle un gesto o una cara al cuerpo del que habla. Algunas líneas terminan
 * en una INTERACCIÓN: la animación espera a que la persona toque (la foto, contestar, «sí, envíalo»);
 * si no toca, sigue sola a los pocos segundos, para que nadie se quede trabado.
 *
 * Solo funciones que EXISTEN (cada escena dice de dónde sale, como tutorial/pasos.ts). Los ejemplos
 * son de mentira y se ven como tales (nadie confunde el oro del ejemplo con el de hoy).
 *
 * Sin React Native: lo prueba Node (pruebas/recorrido.prueba.mjs).
 */
import type { Bilingue } from '../i18n';

export type Anfitrion = 'claudio' | 'antonio';

/** Los gestos que el cuerpo en video sabe hacer (avatares/video/guion.ts: saluda, señala, risa). */
export type GestoLinea = 'saludar' | 'senalar' | 'gusto';
/** Las caras que piden un golpe al video (encantada → risa, sorprendida → sorpresa). */
export type CaraLinea = 'encantada' | 'sorprendida' | 'piensa';
/** Con qué emoción suena (la voz del servidor: lib/emocion.ts). */
export type EmocionLinea = 'neutral' | 'feliz' | 'risa' | 'sorpresa' | 'curioso' | 'pensando' | 'orgullo' | 'travieso';

export type Linea = {
  quien: Anfitrion;
  texto: Bilingue;
  emocion?: EmocionLinea;
  gesto?: GestoLinea;
  cara?: CaraLinea;
  /** Al empezar esta línea, la animación pasa a este paso. */
  paso?: string;
  /** Al terminar, espera un toque de la persona (con su indicación); `ms` 0 = espera sin límite. */
  espera?: { etiqueta: Bilingue; ms: number };
};

export const DEMOS = ['portada', 'hablar', 'camara', 'llamada', 'recordatorio', 'chat', 'correo', 'internet', 'computadora', 'memoria', 'avatares', 'final'] as const;
export type DemoId = (typeof DEMOS)[number];

export type Escena = {
  id: DemoId;
  titulo: Bilingue;
  /** De dónde sale la función (para revisar; no se muestra). */
  fuente: string;
  /** Los pasos que entiende su animación, en orden. */
  pasos: readonly string[];
  lineas: readonly Linea[];
};

/** Lo que se puede probar al final, de verdad, con un toque (lo hace la mesa: DeskScreen). */
export const PRUEBAS = ['hablar', 'camara', 'llamame', 'recordatorio', 'chat'] as const;
export type PruebaId = (typeof PRUEBAS)[number];

export const OPCIONES_FINAL: readonly { id: PruebaId; etiqueta: Bilingue }[] = [
  { id: 'hablar', etiqueta: { es: 'Hablarle', en: 'Talk to her' } },
  { id: 'camara', etiqueta: { es: 'Que vea con la cámara', en: 'Let her see' } },
  { id: 'llamame', etiqueta: { es: 'Que me llame', en: 'Have her call me' } },
  { id: 'recordatorio', etiqueta: { es: 'Un recordatorio', en: 'A reminder' } },
  { id: 'chat', etiqueta: { es: 'Mis chats', en: 'My chats' } },
];

const C = 'claudio' as const;
const A = 'antonio' as const;

export const ESCENAS: readonly Escena[] = [
  {
    id: 'portada',
    titulo: { es: 'Bienvenida', en: 'Welcome' },
    fuente: 'avatares/catalogo.ts (los cuatro avatares, un solo cerebro)',
    pasos: ['entra', 'antonio', 'iconos'],
    lineas: [
      { quien: C, paso: 'entra', gesto: 'saludar', emocion: 'feliz', texto: { es: '¡Hola, {nombre}! Soy Claudio, y hoy te voy a enseñar todo lo que puede hacer AU-RA.', en: 'Hi, {nombre}! I’m Claudio, and today I’ll show you everything AU-RA can do.' } },
      { quien: A, paso: 'antonio', gesto: 'saludar', emocion: 'orgullo', texto: { es: '¡Y yo soy ANT-ONIO! Cuatro brazos, cero excusas. Vamos con ejemplos de verdad.', en: 'And I’m ANT-ONIO! Four arms, zero excuses. Let’s go with real examples.' } },
      { quien: C, paso: 'iconos', cara: 'encantada', emocion: 'risa', texto: { es: 'Ponte cómodo, que esto se pone bueno.', en: 'Get comfy, this gets good.' } },
    ],
  },
  {
    id: 'hablar',
    titulo: { es: 'Háblale', en: 'Talk to her' },
    fuente: 'screens/DeskScreen (oído siempre abierto, intención callar) · components/ModoConversacion',
    pasos: ['mic', 'pregunta', 'respuesta', 'interrumpe'],
    lineas: [
      { quien: A, paso: 'mic', gesto: 'senalar', texto: { es: 'Lo primero: no tienes que escribir. Le hablas, como a una persona.', en: 'First: you don’t have to type. You talk to her, like to a person.' } },
      { quien: C, paso: 'pregunta', emocion: 'curioso', texto: { es: 'Por ejemplo, le dices: ¿qué tengo que hacer hoy?', en: 'For example, you say: what do I have to do today?' } },
      { quien: A, paso: 'respuesta', emocion: 'feliz', texto: { es: 'Y te contesta con su voz, al momento.', en: 'And she answers with her voice, right away.' } },
      { quien: C, paso: 'interrumpe', emocion: 'travieso', texto: { es: 'Y si se pone a hablar mucho, como yo, le hablas encima y se calla.', en: 'And if she talks too much, like me, just talk over her and she stops.' } },
      { quien: A, cara: 'encantada', emocion: 'risa', texto: { es: '¡Ojalá contigo funcionara igual, Claudio!', en: 'I wish that worked on you, Claudio!' } },
    ],
  },
  {
    id: 'camara',
    titulo: { es: 'Ve con la cámara', en: 'She can see' },
    fuente: 'lib/camaraModo.ts (empieza apagada) · intención «qué ves» · src/caras (con consentimiento)',
    pasos: ['abre', 'flash', 'analiza', 'resultado'],
    lineas: [
      { quien: C, paso: 'abre', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: 'Ahora mira esto: AU-RA también puede ver.', en: 'Now look at this: AU-RA can also see.' } },
      {
        quien: A,
        gesto: 'senalar',
        texto: { es: 'La cámara empieza apagada: solo mira cuando tú quieres. ¿Tomamos una foto? Toca el botón.', en: 'The camera starts off: she only looks when you want. Shall we take a photo? Tap the button.' },
        espera: { etiqueta: { es: 'Toca el botón para tomar la foto', en: 'Tap the button to take the photo' }, ms: 6500 },
      },
      { quien: C, paso: 'flash', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: '¡Flash! Listo.', en: 'Flash! Done.' } },
      { quien: A, paso: 'analiza', cara: 'piensa', emocion: 'pensando', texto: { es: 'Ahora la analiza…', en: 'Now she analyzes it…' } },
      { quien: C, paso: 'resultado', emocion: 'feliz', texto: { es: 'Una taza de café, una laptop, una planta y un cuaderno. Te dice qué ve, te lee un papel y reconoce a quien le presentes, con tu permiso.', en: 'A cup of coffee, a laptop, a plant and a notebook. She tells you what she sees, reads a paper for you and recognizes people you introduce, with your permission.' } },
    ],
  },
  {
    id: 'llamada',
    titulo: { es: 'Te llama', en: 'She calls you' },
    fuente: 'compa/llamadaCiclo.ts · compa/LlamadaAvatar.tsx · lib/manos-app.ts (llamame)',
    pasos: ['suena', 'encurso', 'cuelga'],
    lineas: [
      { quien: A, paso: 'suena', emocion: 'travieso', texto: { es: '¿Te da pereza escribir? Dile «llámame»…', en: 'Too lazy to type? Say “call me”…' } },
      {
        quien: C,
        gesto: 'senalar',
        texto: { es: '…y te llama de verdad, como cualquier llamada. Anda, contesta.', en: '…and she really calls you, like any call. Go on, answer.' },
        espera: { etiqueta: { es: 'Contesta la llamada', en: 'Answer the call' }, ms: 7000 },
      },
      { quien: A, paso: 'encurso', gesto: 'saludar', emocion: 'feliz', texto: { es: '¡Aló! Aquí seguimos hablando, de corrido, sin tocar nada.', en: 'Hello! Here we keep talking, hands-free, without tapping anything.' } },
      { quien: C, texto: { es: 'Puedes caminar o cocinar, y la conversación sigue hasta que cuelgues.', en: 'You can walk or cook, and the conversation goes on until you hang up.' } },
      { quien: A, paso: 'cuelga', texto: { es: 'Y cuando terminas, cuelgas y listo.', en: 'And when you’re done, hang up and that’s it.' } },
    ],
  },
  {
    id: 'recordatorio',
    titulo: { es: 'Te recuerda', en: 'She reminds you' },
    fuente: 'compa/recordatorios.ts (aviso o llamada a la hora, con la app cerrada) · avatar3d/DockAura.tsx (al lado de los chats)',
    pasos: ['pide', 'confirma', 'achica', 'suena'],
    lineas: [
      { quien: C, paso: 'pide', texto: { es: 'Ahora, los recordatorios. Le dices: recuérdame a las cinco tomar la pastilla.', en: 'Now, reminders. You say: remind me at five to take my pill.' } },
      { quien: A, paso: 'confirma', gesto: 'gusto', emocion: 'feliz', texto: { es: 'Te repite la hora para confirmar, le dices que sí, y queda guardado.', en: 'She repeats the time to confirm, you say yes, and it’s saved.' } },
      { quien: C, paso: 'achica', gesto: 'senalar', emocion: 'travieso', texto: { es: 'Y mira dónde se queda: si te vas a tus chats, se hace chiquita arriba, sin estorbar.', en: 'And look where she stays: if you go to your chats, she gets tiny up top, out of the way.' } },
      { quien: A, paso: 'suena', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: 'Y a las cinco en punto, ¡ring! Te llama y te lo dice con su voz, aunque tengas la app cerrada.', en: 'And at five sharp, ring! She calls you and tells you, even with the app closed.' } },
    ],
  },
  {
    id: 'chat',
    titulo: { es: 'Tus mensajes', en: 'Your messages' },
    fuente: 'pulse/* (PULSE2CHAT) · lib/manos-app.ts (leer, buscar) · lib/acciones-app.ts (redactar, enviar solo tras el «sí»)',
    pasos: ['lee', 'borrador', 'enviado'],
    lineas: [
      { quien: A, paso: 'lee', texto: { es: 'También te ayuda con tus mensajes de PULSE2CHAT. Pregúntale: ¿qué me dijo Beto?', en: 'She also helps with your PULSE2CHAT messages. Ask her: what did Beto say?' } },
      { quien: C, emocion: 'curioso', texto: { es: 'Te lo lee: ¿llegas a la reunión de las tres?', en: 'She reads it to you: are you coming to the three o’clock meeting?' } },
      {
        quien: A,
        paso: 'borrador',
        texto: { es: 'Le dices: contéstale que sí llego. Te lee el borrador y espera tu sí.', en: 'You say: tell him yes, I’ll be there. She reads you the draft and waits for your yes.' },
        espera: { etiqueta: { es: 'Toca «Sí, envíalo»', en: 'Tap “Yes, send it”' }, ms: 7000 },
      },
      { quien: C, paso: 'enviado', gesto: 'gusto', emocion: 'feliz', texto: { es: 'Enviado. Nada sale sin que tú digas que sí.', en: 'Sent. Nothing goes out unless you say yes.' } },
    ],
  },
  {
    id: 'correo',
    titulo: { es: 'Tus correos', en: 'Your email' },
    fuente: 'server/correo.ts (revisar, buscar, leer, responder; borrador y «sí») · ajustes/Correos.tsx',
    pasos: ['bandeja', 'lee', 'responde', 'conectar'],
    lineas: [
      { quien: C, paso: 'bandeja', emocion: 'orgullo', texto: { es: 'Y tus correos, aunque no sean de Gmail: Outlook, Yahoo o el de tu empresa.', en: 'And your email, even if it isn’t Gmail: Outlook, Yahoo or your company’s.' } },
      { quien: A, paso: 'lee', gesto: 'senalar', texto: { es: 'Te dice cuáles son nuevos, te los lee y te ayuda a contestar.', en: 'She tells you which ones are new, reads them and helps you reply.' } },
      { quien: C, paso: 'responde', texto: { es: 'Igual que con los mensajes: te lee la respuesta y solo la manda con tu sí.', en: 'Same as messages: she reads you the reply and only sends it with your yes.' } },
      { quien: A, paso: 'conectar', texto: { es: 'Se conectan en Ajustes, en «Tus correos».', en: 'You connect them in Settings, under “Your email”.' } },
    ],
  },
  {
    id: 'internet',
    titulo: { es: 'Busca en internet', en: 'Searches the web' },
    fuente: 'src/06-manos/web.ts (búsqueda y lectura web del servidor)',
    pasos: ['busca', 'resultado'],
    lineas: [
      { quien: A, paso: 'busca', texto: { es: '¿Quieres saber algo de hoy? Lo busca en internet por ti.', en: 'Want to know something about today? She searches the web for you.' } },
      { quien: C, paso: 'resultado', emocion: 'feliz', texto: { es: 'El precio del oro, el clima o una noticia: lo busca, lo lee y te lo resume en dos frases.', en: 'The gold price, the weather or a news story: she finds it, reads it and sums it up in two sentences.' } },
    ],
  },
  {
    id: 'computadora',
    titulo: { es: 'Su computadora', en: 'Her computer' },
    fuente: 'server/computadora.ts + scripts/nodo-computadora (escritorio en la nube) · avisos al terminar',
    pasos: ['abre', 'cursor', 'listo'],
    lineas: [
      { quien: C, paso: 'abre', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: 'Y ahora lo más loco: AU-RA tiene su propia computadora en la nube.', en: 'And now the craziest part: AU-RA has her own computer in the cloud.' } },
      { quien: A, paso: 'cursor', gesto: 'senalar', texto: { es: 'Entra a páginas, busca, hace clic y escribe por ti, mientras tú haces otra cosa.', en: 'She opens pages, searches, clicks and types for you, while you do something else.' } },
      { quien: C, paso: 'listo', cara: 'encantada', emocion: 'risa', texto: { es: 'Y cuando termina, te avisa con lo que encontró.', en: 'And when she’s done, she tells you what she found.' } },
    ],
  },
  {
    id: 'memoria',
    titulo: { es: 'Se acuerda', en: 'She remembers' },
    fuente: 'lib/storage.ts (memoria larga por persona) · el turno la manda al cerebro',
    pasos: ['guarda', 'recuerda'],
    lineas: [
      { quien: A, paso: 'guarda', texto: { es: 'También tiene memoria. Dile: acuérdate de que el cumpleaños de mi mamá es el catorce de marzo.', en: 'She also has memory. Say: remember that my mom’s birthday is March fourteenth.' } },
      { quien: C, paso: 'recuerda', emocion: 'feliz', texto: { es: 'Semanas después le preguntas, y se acuerda. Como un buen amigo que no se olvida.', en: 'Weeks later you ask, and she remembers. Like a good friend who doesn’t forget.' } },
    ],
  },
  {
    id: 'avatares',
    titulo: { es: 'Elige con quién', en: 'Pick who' },
    fuente: 'avatares/catalogo.ts · avatares/SelectorAvatar · tts.ts (oración y canto de AU-RA)',
    pasos: ['ojos', 'aura', 'claudio', 'antonio'],
    lineas: [
      { quien: C, paso: 'ojos', texto: { es: 'Y eliges con quién hablar: el Guardián, que cuida tu espacio…', en: 'And you pick who to talk to: the Guardian, who watches over your space…' } },
      { quien: A, paso: 'aura', emocion: 'feliz', texto: { es: '…AU-RA, que te organiza el día, ora contigo y hasta te canta…', en: '…AU-RA, who organizes your day, prays with you and even sings…' } },
      { quien: C, paso: 'claudio', gesto: 'gusto', emocion: 'orgullo', texto: { es: '…yo, para ideas y redes sociales…', en: '…me, for ideas and social media…' } },
      { quien: A, paso: 'antonio', gesto: 'saludar', emocion: 'orgullo', texto: { es: '…y yo, para resolver pendientes y planes. Un solo cerebro, cuatro personalidades.', en: '…and me, to get to-dos and plans done. One brain, four personalities.' } },
    ],
  },
  {
    id: 'final',
    titulo: { es: '¡Te toca!', en: 'Your turn!' },
    fuente: 'DeskScreen (cada opción hace lo mismo que su botón o su frase)',
    pasos: ['fin', 'opciones'],
    lineas: [
      { quien: C, paso: 'fin', cara: 'encantada', emocion: 'risa', texto: { es: '¡Y eso no es todo! AU-RA también vive en tu computadora con Windows; ese recorrido te lo damos aparte.', en: 'And that’s not all! AU-RA also lives on your Windows computer; we’ll give you that tour separately.' } },
      {
        quien: A,
        paso: 'opciones',
        gesto: 'saludar',
        emocion: 'feliz',
        texto: { es: 'Ahora te toca a ti, {nombre}. ¿Qué quieres probar primero?', en: 'Now it’s your turn, {nombre}. What do you want to try first?' },
        espera: { etiqueta: { es: 'Elige qué probar', en: 'Pick what to try' }, ms: 0 },
      },
    ],
  },
];

/** El texto que se dice, con el nombre de la persona (o sin él, limpio, si no se sabe). */
export function textoDe(l: Linea, idioma: 'es' | 'en', nombre: string): string {
  const n = String(nombre || '').trim().split(/\s+/)[0] || '';
  const t = l.texto[idioma];
  return n ? t.replace(/\{nombre\}/g, n) : t.replace(/,?\s*\{nombre\}/g, '').replace(/\s+([!?.,])/g, '$1');
}

/** Cuánto dura una línea si no hay voz (sin red o en silencio): lo que tarda en leerse con calma. */
export function duracionLectura(texto: string): number {
  return Math.round(900 + texto.length * 58);
}

/**
 * El paso de la animación con la línea `l` en curso: el último que pidió una línea hasta ahí (o el
 * primero de la escena).
 */
export function pasoEn(e: Escena, l: number): string {
  for (let i = Math.min(l, e.lineas.length - 1); i >= 0; i--) {
    const p = e.lineas[i].paso;
    if (p) return p;
  }
  return e.pasos[0];
}

/** Las líneas que siguen a la posición (e, l), en orden: para preparar su audio mientras suena la actual. */
export function siguientes(e: number, l: number, n = 2): { e: number; l: number }[] {
  const out: { e: number; l: number }[] = [];
  let ce = e;
  let cl = l + 1;
  while (out.length < n && ce < ESCENAS.length) {
    if (cl < ESCENAS[ce].lineas.length) out.push({ e: ce, l: cl++ });
    else {
      ce++;
      cl = 0;
    }
  }
  return out;
}
