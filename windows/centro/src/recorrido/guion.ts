/**
 * EL GUION DEL RECORRIDO DE WINDOWS: Claudio y ANT-ONIO enseñan, hablando entre ellos y con ejemplos
 * animados sobre un escritorio de Windows, todo lo que hace AURA en la computadora (José, 2-oct:
 * «primero la app de AURA y luego Windows… que asombre… que lo hagas hablar y no sea plano e
 * interactuar», y después: «ahora arma el recorrido de Windows»).
 *
 * Igual que el del teléfono (mobile/src/recorrido/guion.ts): cada escena es una función con su
 * animación (escenas.ts); cada línea la dice uno de los dos con su voz y puede mover la animación a un
 * `paso`, pedir un gesto o una cara; algunas terminan en una INTERACCIÓN (tocar las teclas, el «Sí»,
 * contestar la llamada) y, si nadie toca, sigue sola a los pocos segundos.
 *
 * Solo funciones que EXISTEN en AURA para Windows (cada escena dice de dónde sale: windows/README.md
 * y el código). Los ejemplos son de mentira (Karla, la reunión, la canción) y se ven como tales.
 *
 * Sin DOM: lo prueba Node (test/recorrido.test.mjs).
 */

export type Bilingue = { es: string; en: string };
export type Anfitrion = 'claudio' | 'antonio';

/** Los gestos que el cuerpo en video sabe hacer (mobile/src/avatares/video/guion.ts: saluda, señala, risa). */
export type GestoLinea = 'saludar' | 'senalar' | 'gusto';
/** Las caras que piden un golpe al video (encantada → risa, sorprendida → sorpresa). */
export type CaraLinea = 'encantada' | 'sorprendida' | 'piensa';
/** Con qué emoción suena (la voz del servidor: /api/tts, `emocion`). */
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

export const DEMOS = ['portada', 'notch', 'voz', 'escribir', 'control', 'avisos', 'musica', 'dia', 'pulse', 'centro', 'privacidad', 'final'] as const;
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

/** Lo que se puede probar al final, de verdad, con un clic (lo hace recorrido.ts con el Centro y el notch). */
export const PRUEBAS = ['hablar', 'chat', 'musica', 'pulse', 'ajustes'] as const;
export type PruebaId = (typeof PRUEBAS)[number];

export const OPCIONES_FINAL: readonly { id: PruebaId; etiqueta: Bilingue; icono: string }[] = [
  { id: 'hablar', etiqueta: { es: 'Hablarle ahora', en: 'Talk to her now' }, icono: 'mic' },
  { id: 'chat', etiqueta: { es: 'Abrir el chat', en: 'Open the chat' }, icono: 'chat' },
  { id: 'musica', etiqueta: { es: 'Mi música', en: 'My music' }, icono: 'musica' },
  { id: 'pulse', etiqueta: { es: 'PULSE2CHAT', en: 'PULSE2CHAT' }, icono: 'pulse' },
  { id: 'ajustes', etiqueta: { es: 'Conectar mis cuentas', en: 'Connect my accounts' }, icono: 'ajustes' },
];

const C = 'claudio' as const;
const A = 'antonio' as const;

export const ESCENAS: readonly Escena[] = [
  {
    id: 'portada',
    titulo: { es: 'AURA en tu computadora', en: 'AURA on your computer' },
    fuente: 'windows/README.md (el mismo cerebro, las mismas voces y los mismos avatares que la app)',
    pasos: ['entra', 'escritorio'],
    lineas: [
      { quien: C, paso: 'entra', gesto: 'saludar', emocion: 'feliz', texto: { es: '¡Hola otra vez, {nombre}! Ahora te enseño AURA en tu computadora.', en: 'Hi again, {nombre}! Now I’ll show you AURA on your computer.' } },
      { quien: A, paso: 'escritorio', gesto: 'saludar', emocion: 'orgullo', texto: { es: 'El mismo cerebro y las mismas voces del teléfono. Pero aquí vive arriba, en tu pantalla.', en: 'Same brain and same voices as the phone. But here she lives up top, on your screen.' } },
    ],
  },
  {
    id: 'notch',
    titulo: { es: 'El notch', en: 'The notch' },
    fuente: 'Notch/NotchWindow.xaml(.cs): reposo, escucha, piensa, habla; se aparta en pantalla completa',
    pasos: ['reposo', 'escucha', 'habla', 'aparta'],
    lineas: [
      { quien: C, paso: 'reposo', gesto: 'senalar', emocion: 'travieso', texto: { es: '¿Ves esa isla negra arriba al centro? Es el notch. Mira: me hago chiquito y me meto ahí.', en: 'See that black island up top? That’s the notch. Watch: I shrink and slip right in.' } },
      { quien: A, paso: 'escucha', emocion: 'curioso', texto: { es: 'Cuando le hablas, crece: barras que siguen tu voz y una luz naranja de micrófono abierto.', en: 'When you talk, it grows: bars that follow your voice and an orange open-mic light.' } },
      { quien: C, paso: 'habla', cara: 'encantada', emocion: 'feliz', texto: { es: 'Y contesta hablando, con la boca al ritmo de la voz y el subtítulo de lo que dice.', en: 'And it answers out loud, mouth in sync with the voice, with subtitles.' } },
      { quien: A, paso: 'aparta', emocion: 'neutral', texto: { es: 'Si pones un juego o un video a pantalla completa, se aparta solito.', en: 'Put a game or a video in full screen and it steps aside on its own.' } },
    ],
  },
  {
    id: 'voz',
    titulo: { es: 'Háblale', en: 'Talk to her' },
    fuente: 'Atajos Ctrl+Alt+Espacio; «Oye AURA» con el reconocedor de Windows sin red; interrumpir hablando',
    pasos: ['atajo', 'oye', 'interrumpe'],
    lineas: [
      { quien: A, paso: 'atajo', gesto: 'senalar', emocion: 'curioso', texto: { es: 'Para hablarle: Control, Alt, Espacio. Anda, toca las teclas en la pantalla.', en: 'To talk to her: Control, Alt, Space. Go on, tap the keys on the screen.' }, espera: { etiqueta: { es: 'Toca Ctrl + Alt + Espacio', en: 'Tap Ctrl + Alt + Space' }, ms: 7000 } },
      { quien: C, paso: 'oye', emocion: 'feliz', texto: { es: 'O, si lo activas, solo di: Oye AURA. Eso se reconoce en tu PC, sin mandar audio.', en: 'Or, if you turn it on, just say: Hey AURA. That’s recognized on your PC, no audio sent.' } },
      { quien: A, paso: 'interrumpe', cara: 'encantada', emocion: 'risa', texto: { es: 'Y si le hablas encima mientras habla, se calla y te escucha. Muy educada.', en: 'And if you talk over her, she stops and listens. Very polite.' } },
    ],
  },
  {
    id: 'escribir',
    titulo: { es: 'Escribe por ti', en: 'She types for you' },
    fuente: 'NotchWindow.Manos.cs PrepararEscritura: hasta 280 letras y 3 renglones lo escribe directo; más largo pregunta «¿Lo escribo en…?»; Manos/Escritura.cs nunca en un campo de contraseña',
    pasos: ['bloc', 'escribe', 'largo', 'listo'],
    lineas: [
      { quien: C, paso: 'bloc', gesto: 'senalar', emocion: 'curioso', texto: { es: 'Abres el Bloc de notas y le dices: escribe «Hola Karla, ya voy en camino».', en: 'Open Notepad and say: type “Hi Karla, I’m on my way”.' } },
      { quien: A, paso: 'escribe', cara: 'encantada', emocion: 'feliz', texto: { es: 'Si es corto, lo escribe de una, letra por letra.', en: 'If it’s short, she types it right away, letter by letter.' } },
      { quien: C, paso: 'largo', emocion: 'neutral', texto: { es: 'Si es largo, como una carta, primero te pregunta. Dale que sí.', en: 'If it’s long, like a letter, she asks first. Go ahead, say yes.' }, espera: { etiqueta: { es: 'Toca «Sí»', en: 'Tap “Yes”' }, ms: 7000 } },
      { quien: A, paso: 'listo', emocion: 'orgullo', texto: { es: '¡Listo! Y nunca, nunca escribe en un campo de contraseña.', en: 'Done! And never, ever in a password field.' } },
    ],
  },
  {
    id: 'control',
    titulo: { es: 'Tu PC, a la voz', en: 'Your PC, by voice' },
    fuente: 'Manos: ventanas, brillo, modo oscuro, wifi, atajos («cópialo», «pégalo», «guárdalo»); lo que tiene efecto pregunta',
    pasos: ['izquierda', 'brillo', 'oscuro', 'atajos'],
    lineas: [
      { quien: A, paso: 'izquierda', gesto: 'senalar', emocion: 'neutral', texto: { es: 'Pon la ventana a la izquierda.', en: 'Put the window on the left.' } },
      { quien: C, paso: 'brillo', emocion: 'feliz', texto: { es: 'Sube el brillo.', en: 'Turn up the brightness.' } },
      { quien: A, paso: 'oscuro', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: 'Activa el modo oscuro. ¡Uy, qué elegante!', en: 'Turn on dark mode. Ooh, fancy!' } },
      { quien: C, paso: 'atajos', emocion: 'travieso', texto: { es: 'Y lo de todos los días: cópialo, pégalo, guárdalo, abre Excel. Lo que tenga efecto, primero te pregunta.', en: 'And the everyday stuff: copy it, paste it, save it, open Excel. Anything with consequences asks first.' } },
    ],
  },
  {
    id: 'avisos',
    titulo: { es: 'Tus notificaciones', en: 'Your notifications' },
    fuente: 'Notificaciones de otras apps (1.4): WhatsApp, Teams, Outlook… en el notch; leerlas y silenciar una app por voz',
    pasos: ['llegan', 'lee', 'silencia'],
    lineas: [
      { quien: C, paso: 'llegan', emocion: 'curioso', texto: { es: 'Lo que te llega de WhatsApp, Teams u Outlook sale en el notch, como en la isla del iPhone.', en: 'Whatever comes in from WhatsApp, Teams or Outlook shows in the notch, like the iPhone island.' } },
      { quien: A, paso: 'lee', gesto: 'senalar', emocion: 'neutral', texto: { es: 'Pregúntale: ¿qué notificaciones tengo? Y te las lee.', en: 'Ask: what notifications do I have? And she reads them to you.' } },
      { quien: C, paso: 'silencia', cara: 'encantada', emocion: 'risa', texto: { es: '¿El grupo de WhatsApp muy intenso? Silencia las notificaciones de WhatsApp. Y paz.', en: 'Group chat too intense? Mute WhatsApp notifications. Peace.' } },
    ],
  },
  {
    id: 'musica',
    titulo: { es: 'Tu música', en: 'Your music' },
    fuente: 'Música (1.2): lo que suena en el notch con portada y controles; «pon Bad Bunny en Spotify» con la conexión de Spotify',
    pasos: ['suena', 'pide'],
    lineas: [
      { quien: A, paso: 'suena', emocion: 'feliz', texto: { es: 'Si suena algo en Spotify o en YouTube, el notch lo muestra con su portada y sus controles.', en: 'If something plays on Spotify or YouTube, the notch shows it with its cover and controls.' } },
      { quien: C, paso: 'pide', gesto: 'gusto', emocion: 'risa', texto: { es: 'Y le pides: pon Bad Bunny en Spotify. ¡Y a bailar!', en: 'And you ask: play Bad Bunny on Spotify. Let’s dance!' } },
    ],
  },
  {
    id: 'dia',
    titulo: { es: 'Tu día', en: 'Your day' },
    fuente: 'Correo y agenda (1.2/1.3): aviso de correo nuevo, 10 min antes de cada evento, «¿qué tengo hoy?»; recordatorios en el notch',
    pasos: ['correo', 'agenda', 'recordatorio'],
    lineas: [
      { quien: A, paso: 'correo', emocion: 'neutral', texto: { es: 'Cuando te llega un correo, te avisa de quién es y de qué trata.', en: 'When an email arrives, she tells you who it’s from and what it’s about.' } },
      { quien: C, paso: 'agenda', gesto: 'senalar', emocion: 'curioso', texto: { es: 'Diez minutos antes de cada reunión te avisa. Y si le preguntas qué tienes hoy, te cuenta tu día.', en: 'Ten minutes before each meeting she reminds you. Ask what’s on today and she walks you through it.' } },
      { quien: A, paso: 'recordatorio', emocion: 'orgullo', texto: { es: 'Y los recordatorios: recuérdame en diez minutos llamar a mamá. A su hora, sale en el notch.', en: 'And reminders: remind me in ten minutes to call mom. Right on time, it pops in the notch.' } },
    ],
  },
  {
    id: 'pulse',
    titulo: { es: 'PULSE2CHAT', en: 'PULSE2CHAT' },
    fuente: 'PULSE2CHAT: llamadas en el notch aunque el Centro esté cerrado («sí» contesta, «no» rechaza); mensaje por voz con confirmación',
    pasos: ['llama', 'contesta', 'mensaje'],
    lineas: [
      { quien: C, paso: 'llama', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: 'Tus chats cifrados también viven aquí. ¡Mira, te está llamando Karla!', en: 'Your encrypted chats live here too. Look, Karla is calling you!' }, espera: { etiqueta: { es: 'Toca «Contestar»', en: 'Tap “Answer”' }, ms: 8000 } },
      { quien: A, paso: 'contesta', emocion: 'feliz', texto: { es: 'Contestas con un clic, o diciendo sí. Si dices no, la rechaza.', en: 'Answer with a click, or by saying yes. Say no and she declines it.' } },
      { quien: C, paso: 'mensaje', emocion: 'travieso', texto: { es: 'Y por voz: mándale un mensaje a Karla que ya voy. Te lo lee y espera tu sí antes de mandarlo.', en: 'And by voice: message Karla that I’m coming. She reads it back and waits for your yes.' } },
    ],
  },
  {
    id: 'centro',
    titulo: { es: 'El Centro', en: 'The Center' },
    fuente: 'El Centro (Ctrl+Alt+C): Inicio, Chat, PULSE2CHAT, Música, Cartera (solo lectura) y Ajustes',
    pasos: ['abre', 'secciones', 'cartera'],
    lineas: [
      { quien: A, paso: 'abre', gesto: 'senalar', emocion: 'orgullo', texto: { es: 'Control, Alt, C abre el Centro: la ventana grande de AURA. Justo donde estás ahora.', en: 'Control, Alt, C opens the Center: AURA’s big window. Right where you are now.' } },
      { quien: C, paso: 'secciones', emocion: 'feliz', texto: { es: 'Tu día en Inicio, el chat en grande, PULSE2CHAT, tu música, tu cartera y los ajustes.', en: 'Your day on Home, the big chat, PULSE2CHAT, your music, your wallet and settings.' } },
      { quien: A, paso: 'cartera', cara: 'encantada', emocion: 'orgullo', texto: { es: '¿Cuánto ORIGEN tengo? Te lo dice al instante. Aquí solo se mira: enviar se firma en Veta Wallet.', en: 'How much ORIGEN do I have? She tells you right away. Here you only look: sending is signed in Veta Wallet.' } },
    ],
  },
  {
    id: 'privacidad',
    titulo: { es: 'Tú mandas', en: 'You’re in charge' },
    fuente: 'Botón de silenciar el micrófono (rojo), Ctrl+Alt+Esc pausa todo; sesión, clave y tokens cifrados con DPAPI; Genesis ID y OAuth (Spotify, Google, Microsoft) sin ver la contraseña',
    pasos: ['mic', 'pausa', 'candado'],
    lineas: [
      { quien: C, paso: 'mic', gesto: 'senalar', emocion: 'neutral', texto: { es: 'El micrófono del notch se silencia con un clic: se pone rojo y no te oye hasta que lo vuelvas a tocar.', en: 'The notch mic mutes with one click: it turns red and won’t hear you until you click again.' } },
      { quien: A, paso: 'pausa', emocion: 'neutral', texto: { es: 'Control, Alt, Escape lo pausa todo.', en: 'Control, Alt, Escape pauses everything.' } },
      { quien: C, paso: 'candado', cara: 'encantada', emocion: 'orgullo', texto: { es: 'Y tu sesión y tus claves quedan cifradas en tu PC. Con Genesis ID, Spotify, Google u Outlook, AURA ni ve tu contraseña.', en: 'And your session and keys stay encrypted on your PC. With Genesis ID, Spotify, Google or Outlook, AURA never even sees your password.' } },
    ],
  },
  {
    id: 'final',
    titulo: { es: '¿Lo probamos?', en: 'Shall we try?' },
    fuente: 'Lo que se puede probar al final (OPCIONES_FINAL): hablarle, chat, música, PULSE2CHAT, conexiones',
    pasos: ['fin', 'opciones'],
    lineas: [
      { quien: A, paso: 'fin', gesto: 'saludar', emocion: 'feliz', texto: { es: 'Eso es AURA en Windows, {nombre}. Todo lo que viste, pídeselo cuando quieras.', en: 'That’s AURA on Windows, {nombre}. Anything you saw, just ask.' } },
      { quien: C, paso: 'opciones', cara: 'encantada', emocion: 'risa', texto: { es: 'Escoge por dónde empezar. ¡Nos vemos arriba, en el notch!', en: 'Pick where to start. See you up top, in the notch!' } },
    ],
  },
];

export function textoDe(l: Linea, idioma: 'es' | 'en', nombre: string): string {
  const n = String(nombre || '').trim().split(/\s+/)[0] || '';
  const t = l.texto[idioma];
  return n ? t.replace(/\{nombre\}/g, n) : t.replace(/,?\s*\{nombre\}/g, '').replace(/\s+([!?.,])/g, '$1');
}

/** Cuánto dura una línea si no hay voz (sin red, en silencio o sin el .exe): lo que tarda en leerse con calma. */
export function duracionLectura(texto: string): number {
  return Math.round(900 + texto.length * 58);
}

/** El paso de la animación con la línea `l` en curso: el último que pidió una línea hasta ahí (o el primero de la escena). */
export function pasoEn(e: Escena, l: number): string {
  for (let i = Math.min(l, e.lineas.length - 1); i >= 0; i--) {
    const p = e.lineas[i].paso;
    if (p) return p;
  }
  return e.pasos[0];
}

/** Las líneas que siguen a la posición (e, l), en orden: para preparar su audio mientras suena la actual. */
export function siguientes(e: number, l: number, n = 2, escenas: readonly Escena[] = ESCENAS): { e: number; l: number }[] {
  const out: { e: number; l: number }[] = [];
  let ce = e;
  let cl = l + 1;
  while (out.length < n && ce < escenas.length) {
    if (cl < escenas[ce].lineas.length) out.push({ e: ce, l: cl++ });
    else {
      ce++;
      cl = 0;
    }
  }
  return out;
}
