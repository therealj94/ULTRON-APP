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
 * José (2-oct, versión 2: «hemos agregado cosas… que explique todo detallado… señalando dónde tocar»):
 * la mesa y sus tres botones, los avisos con la app cerrada, WhatsApp, la pestaña de Correos, lo que sé de
 * ti, Mi círculo, Misiones, las propuestas de AURA con su nivel de iniciativa y Ajustes. Las escenas nuevas
 * enseñan la pantalla de verdad en miniatura y señalan dónde se toca (escenas/guia.tsx). Lo mismo que
 * AURA sabe del menú para guiar a alguien (lib/menu-app.ts en el servidor).
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

export const DEMOS = ['portada', 'mesa', 'hablar', 'camara', 'llamada', 'recordatorio', 'avisos', 'chat', 'whatsapp', 'correo', 'cartera', 'internet', 'computadora', 'memoria', 'conocer', 'propuestas', 'avatares', 'ajustes', 'final'] as const;
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
    id: 'mesa',
    titulo: { es: 'La mesa', en: 'The desk' },
    fuente: 'components/BarraMesa.tsx (Mensajes · Hablar · Más) · components/HojaMas.tsx (la hoja «Más»)',
    pasos: ['barra', 'hablar', 'chat', 'mas', 'hoja'],
    lineas: [
      { quien: A, paso: 'barra', gesto: 'senalar', texto: { es: 'Empecemos por la mesa, la pantalla principal. Abajo hay solo tres botones.', en: 'Let’s start with the desk, the main screen. There are just three buttons at the bottom.' } },
      { quien: C, paso: 'hablar', emocion: 'curioso', texto: { es: 'El grande del centro es Hablar: AU-RA te oye siempre, sin palabra clave. Un toque la silencia; otro, y vuelve.', en: 'The big one in the middle is Talk: AU-RA always hears you, no wake word. One tap mutes her; another brings her back.' } },
      { quien: A, paso: 'chat', gesto: 'senalar', texto: { es: 'El de la izquierda es Mensajes: tus conversaciones de PULSE2CHAT, tu WhatsApp y tus correos. Para escribirle a tu avatar, «Escríbele…», justo encima.', en: 'The one on the left is Messages: your PULSE2CHAT conversations, your WhatsApp and your email. To write to your avatar, «Write to…», right above.' } },
      {
        quien: C,
        paso: 'mas',
        gesto: 'senalar',
        texto: { es: 'Y el de la derecha, Más, guarda todo lo demás. Anda, tócalo.', en: 'And the one on the right, More, holds everything else. Go on, tap it.' },
        espera: { etiqueta: { es: 'Toca «Más»', en: 'Tap “More”' }, ms: 6500 },
      },
      { quien: A, paso: 'hoja', emocion: 'feliz', texto: { es: 'Aquí está todo: que te llame, escribir, la cámara, tus misiones, su computadora, este recorrido y Ajustes.', en: 'Everything’s here: call me, type, the camera, your missions, her computer, this tour and Settings.' } },
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
      { quien: A, gesto: 'senalar', texto: { es: 'La enciendes en Más, Cámara: apagada, solo ahora o siempre. Y si quieres que comente sola lo que ve, en Más, Ajustes: «Comenta lo que ve».', en: 'Turn it on in More, Camera: off, just now or always. And if you want her to comment on what she sees, go to More, Settings: “Comments on what it sees”.' } },
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
      { quien: C, gesto: 'senalar', texto: { es: 'También tienes el botón en Más: «Que te llame». Y en la llamada, el botón rojo cuelga.', en: 'There’s also a button in More: “Have her call you”. And during the call, the red button hangs up.' } },
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
      { quien: C, paso: 'achica', emocion: 'travieso', texto: { es: 'Y mira: si te vas a tus chats, yo me hago chiquito y me quedo aquí arriba, sin estorbar.', en: 'And look: if you go to your chats, I get tiny and stay right up here, out of the way.' } },
      { quien: A, paso: 'suena', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: 'Y a las cinco en punto, ¡ring! Te llama y te lo dice con su voz, aunque tengas la app cerrada.', en: 'And at five sharp, ring! She calls you and tells you, even with the app closed.' } },
    ],
  },
  {
    id: 'avisos',
    titulo: { es: 'Con la app cerrada', en: 'With the app closed' },
    fuente: 'src/push/nativo.ts (avisos de Firebase con la app cerrada) · primeravez/permisos.ts · ajustes/Ajustes.tsx (Privacidad)',
    pasos: ['llega', 'responde', 'permiso'],
    lineas: [
      { quien: C, paso: 'llega', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: 'Aunque tengas la app cerrada, AU-RA te escribe: te llega un aviso como este.', en: 'Even with the app closed, AU-RA reaches you: you get a notification like this.' } },
      { quien: A, paso: 'responde', gesto: 'senalar', texto: { es: 'Le contestas desde el aviso mismo: sí o luego. Y si es una llamada, contestas y te habla.', en: 'You answer right from the notification: yes or later. And if it’s a call, you pick up and she talks.' } },
      { quien: C, paso: 'permiso', gesto: 'senalar', texto: { es: 'Para que lleguen: Ajustes, Privacidad, Permisos del teléfono, Avisos. Y «Alarmas y recordatorios», para la hora exacta.', en: 'For them to arrive: Settings, Privacy, Phone permissions, Notifications. And “Alarms & reminders”, to be right on time.' } },
    ],
  },
  {
    id: 'chat',
    titulo: { es: 'Tus mensajes', en: 'Your messages' },
    fuente: 'pulse/* (PULSE2CHAT) · lib/manos-app.ts (leer, buscar) · lib/acciones-app.ts (redactar, enviar solo tras el «sí»)',
    pasos: ['lee', 'borrador', 'enviado'],
    lineas: [
      { quien: A, paso: 'lee', texto: { es: 'Tus mensajes de PULSE2CHAT están en el botón Mensajes. Y ella te ayuda: pregúntale, ¿qué me dijo Beto?', en: 'Your PULSE2CHAT messages are under the Messages button. And she helps: ask her, what did Beto say?' } },
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
    id: 'whatsapp',
    titulo: { es: 'Tu WhatsApp', en: 'Your WhatsApp' },
    fuente: 'src/whatsapp/ChatsConWhatsapp.tsx (las pestañas) · src/whatsapp/PantallaWhatsapp.tsx (vincular con un código) · server/whatsapp.ts',
    pasos: ['pestanas', 'vincular', 'codigo', 'listo'],
    lineas: [
      {
        quien: A,
        paso: 'pestanas',
        gesto: 'senalar',
        texto: { es: 'Arriba de tus chats hay pestañas: PULSE2CHAT, WhatsApp y Correos. Deslizas de lado o tocas una. Toca WhatsApp.', en: 'Above your chats there are tabs: PULSE2CHAT, WhatsApp and Email. Swipe sideways or tap one. Tap WhatsApp.' },
        espera: { etiqueta: { es: 'Toca la pestaña WhatsApp', en: 'Tap the WhatsApp tab' }, ms: 6500 },
      },
      { quien: C, paso: 'vincular', texto: { es: 'La primera vez se vincula: tocas «Con un código» y escribes tu número con el código de país.', en: 'The first time you link it: tap “With a code” and type your number with the country code.' } },
      { quien: A, paso: 'codigo', gesto: 'senalar', texto: { es: 'En tu WhatsApp: los tres puntitos, Dispositivos vinculados, Vincular con el número de teléfono, y escribes el código.', en: 'In your WhatsApp: the three dots, Linked devices, Link with phone number instead, and type the code.' } },
      { quien: C, paso: 'listo', gesto: 'gusto', emocion: 'feliz', texto: { es: '¡Y listo! Te lee tus WhatsApp, busca en ellos y contesta solo cuando le dices que sí.', en: 'And done! She reads your WhatsApp, searches it and replies only when you say yes.' } },
    ],
  },
  {
    id: 'correo',
    titulo: { es: 'Tus correos', en: 'Your email' },
    fuente: 'server/correo.ts (revisar, buscar, leer, responder; borrador y «sí») · ajustes/Correos.tsx (conectar) · la pestaña Correos de los chats',
    pasos: ['bandeja', 'lee', 'responde', 'conectar'],
    lineas: [
      { quien: C, paso: 'bandeja', emocion: 'orgullo', texto: { es: 'Y tus correos, aunque no sean de Gmail: Outlook, Yahoo o el de tu empresa.', en: 'And your email, even if it isn’t Gmail: Outlook, Yahoo or your company’s.' } },
      { quien: A, paso: 'lee', gesto: 'senalar', texto: { es: 'Te dice cuáles son nuevos, te los lee y te ayuda a contestar.', en: 'She tells you which ones are new, reads them and helps you reply.' } },
      { quien: C, paso: 'responde', texto: { es: 'Igual que con los mensajes: te lee la respuesta y solo la manda con tu sí.', en: 'Same as messages: she reads you the reply and only sends it with your yes.' } },
      { quien: A, paso: 'conectar', texto: { es: 'Están en la pestaña Correos, al lado de WhatsApp. Se conectan en Ajustes, «Tus correos»: tu dirección y una contraseña de aplicación.', en: 'They’re in the Email tab, next to WhatsApp. You connect them in Settings, “Your email”: your address and an app password.' } },
      { quien: C, emocion: 'feliz', texto: { es: 'Si es Outlook o Hotmail, tocas «Entrar con Microsoft» y escribes un código en su página. Así de fácil.', en: 'If it’s Outlook or Hotmail, tap “Sign in with Microsoft” and type a code on their page. That easy.' } },
    ],
  },
  {
    id: 'cartera',
    titulo: { es: 'Tu Veta Wallet', en: 'Your Veta Wallet' },
    fuente: 'cartera/HojaCartera.tsx (saldos) · cartera/HojaPagar.tsx (Enviar dinero desde un chat) · cartera/TarjetaPago.tsx (comprobante en la cadena) · lib/cartera.ts',
    pasos: ['saldos', 'pagar', 'firma', 'comprobante'],
    lineas: [
      { quien: A, paso: 'saldos', gesto: 'senalar', texto: { es: 'Si tienes Veta Wallet, AU-RA ve tus saldos: tus tokens y tu ORIGEN. Los pagos los firmas tú en Veta Wallet; tu tarjeta, AU-RA puede mostrarla y recargarla con tu contraseña.', en: 'If you have Veta Wallet, AU-RA sees your balances: your tokens and your ORIGEN. You sign payments in Veta Wallet; AU-RA can show your card and top it up with your password.' } },
      { quien: C, paso: 'saldos', texto: { es: 'Está en Ajustes, «Veta Wallet». O pregúntale: ¿cuánto tengo en mi wallet?', en: 'It’s in Settings, “Veta Wallet”. Or ask her: how much do I have in my wallet?' } },
      { quien: A, paso: 'pagar', gesto: 'senalar', texto: { es: 'Y pagas por PULSE2CHAT: en el chat de la persona tocas la moneda de arriba, «Enviar dinero». O le dices «mándale 5 ORIGEN a Ana».', en: 'And you pay through PULSE2CHAT: in that person’s chat tap the coin at the top, “Send money”. Or say “send Ana 5 ORIGEN”.' } },
      { quien: C, paso: 'firma', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: 'AU-RA lo deja listo, pero tú lo firmas en Veta Wallet, con tu misma contraseña de siempre.', en: 'AU-RA gets it ready, but you sign it in Veta Wallet, with your usual password.' } },
      { quien: A, paso: 'comprobante', gesto: 'gusto', emocion: 'feliz', texto: { es: 'Al volver, en el chat queda el comprobante: «Verificado en la cadena». Así de seguro.', en: 'When you come back, the receipt is in the chat: “Verified on chain”. That safe.' } },
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
      { quien: A, gesto: 'senalar', texto: { es: 'La ves en vivo en Más, «Su computadora», o le dices «abre tu computadora». En Ajustes eliges Gratis o Claude.', en: 'Watch it live in More, “Their computer”, or say “open your computer”. In Settings you pick Free or Claude.' } },
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
    id: 'conocer',
    titulo: { es: 'Te conoce', en: 'She knows you' },
    fuente: 'ajustes/LoQueSeDeTi.tsx · ajustes/Circulo.tsx · ajustes/Misiones.tsx (src/app/HojasCerebro.tsx)',
    pasos: ['sabe', 'circulo', 'misiones'],
    lineas: [
      { quien: A, paso: 'sabe', gesto: 'senalar', texto: { es: 'Lo que va aprendiendo de ti lo ves en Ajustes, «Lo que sé de ti». Puedes corregir o borrar cualquier dato.', en: 'What she learns about you is in Settings, “What I know about you”. You can fix or erase anything.' } },
      { quien: C, paso: 'circulo', emocion: 'feliz', texto: { es: 'En «Mi círculo» pones a tu gente: tu familia, tus amigos. Y dices qué puede hacer AU-RA por ellos.', en: 'In “My circle” you add your people: family, friends. And you say what AU-RA can do for them.' } },
      { quien: A, paso: 'misiones', gesto: 'senalar', texto: { es: 'Y en Más, Misiones: tus metas. Te ayuda a cumplirlas paso a paso y te pregunta cómo vas.', en: 'And in More, Missions: your goals. She helps you reach them step by step and checks in.' } },
    ],
  },
  {
    id: 'propuestas',
    titulo: { es: 'Te propone', en: 'She suggests' },
    fuente: 'components/TarjetaPropuesta.tsx (Sí, hazlo · Luego · No) · compa/iniciativa.ts · server/iniciativa.ts',
    pasos: ['tarjeta', 'responde', 'nivel'],
    lineas: [
      { quien: C, paso: 'tarjeta', cara: 'sorprendida', emocion: 'sorpresa', texto: { es: 'Y lo mejor: no tienes que pedirle todo. A veces ella te propone algo, con una tarjeta arriba.', en: 'And the best part: you don’t have to ask for everything. Sometimes she suggests something, with a card on top.' } },
      {
        quien: A,
        paso: 'responde',
        gesto: 'senalar',
        texto: { es: 'Tú decides: «Sí, hazlo», «Luego» o «No». Prueba: toca «Sí, hazlo».', en: 'You decide: “Yes, do it”, “Later” or “No”. Try it: tap “Yes, do it”.' },
        espera: { etiqueta: { es: 'Toca «Sí, hazlo»', en: 'Tap “Yes, do it”' }, ms: 6500 },
      },
      { quien: C, paso: 'nivel', texto: { es: '¿Mucho o poco? En Ajustes, «Iniciativa de AURA»: alta, media, baja o apagada. Y nunca de noche.', en: 'A lot or a little? In Settings, “AURA’s initiative”: high, medium, low or off. And never at night.' } },
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
    id: 'ajustes',
    titulo: { es: 'Ajustes', en: 'Settings' },
    fuente: 'ajustes/Ajustes.tsx · lib/menu-app.ts (lo que AURA sabe del menú para guiarte)',
    pasos: ['abre', 'perfil', 'aura', 'privacidad', 'pide'],
    lineas: [
      { quien: C, paso: 'abre', gesto: 'senalar', texto: { es: 'Por último, Ajustes: tocas Más y luego Ajustes. O le dices «abre ajustes».', en: 'Last, Settings: tap More and then Settings. Or say “open settings”.' } },
      { quien: A, paso: 'perfil', texto: { es: 'Arriba, tu perfil: cómo te dice, tu avatar y tu cumpleaños. Luego el tema, oscuro o claro, y el idioma.', en: 'At the top, your profile: what she calls you, your avatar and your birthday. Then the theme, dark or light, and the language.' } },
      { quien: C, paso: 'aura', texto: { es: 'En AURA: lo que sabe de ti, tu círculo, tus misiones y tus correos. Abajo, la iniciativa y su computadora.', en: 'Under AURA: what she knows about you, your circle, your missions and your email. Below, initiative and her computer.' } },
      { quien: A, paso: 'privacidad', texto: { es: 'En Privacidad, los permisos del teléfono y las alarmas. Y al final, cerrar sesión.', en: 'Under Privacy, phone permissions and alarms. And at the end, sign out.' } },
      { quien: C, paso: 'pide', gesto: 'gusto', emocion: 'feliz', texto: { es: '¿Te perdiste? Pregúntale «¿cómo conecto mi correo?» o «¿dónde cambio el idioma?»: te guía paso a paso y te lleva.', en: 'Lost? Ask her “how do I connect my email?” or “where do I change the language?”: she guides you step by step and takes you there.' } },
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
