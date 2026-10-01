/**
 * LO QUE SIEMPRE SE CONTESTA IGUAL, AL INSTANTE (y sin sonar grabado).
 *
 * José (1-oct): «grabar bien todo, que tengamos suficientes; piensa preguntas comunes y no dejar pocas,
 * para poder rotar esas palabras y que no se sienta grabado… que se guarde el nombre de la persona para
 * que sea siempre personalizado… app, web, Windows y Dr Electrum».
 *
 * Un saludo, un «¿me escuchas?», «¿qué hora es?», «¿quién eres?» no necesitan memoria, clasificador ni
 * el 27B: contesta este banco en 0 s, con la forma de ser del avatar, el nombre (o apodo) de la persona
 * y una etiqueta de audio v4 que va con lo que dice (la cara y la voz «presentes»). Cada intención tiene
 * muchas variantes y no se repiten las últimas que oyó ESA persona.
 *
 * Solo entra si el mensaje ENTERO es eso (por su forma): «hola, ¿qué hora es?» es hora; «hola, mándale
 * un mensaje a Beto» no es nada de aquí y lo contesta el cerebro. «ok», «listo», «dale», «sí», «bien»
 * solos nunca entran: pueden ser el «sí» de algo pendiente.
 *
 * El audio de estas frases se guarda (server/voz.ts, caché en S3): la primera vez se genera con la voz
 * del avatar y después sale al instante y sin costo. En la llamada (ElevenLabs) el audio lo pone el
 * agente, pero el texto llega en 0 s y la voz arranca enseguida.
 *
 * Puro (sin Node ni red): lo usan server.ts (turno de texto y de voz) y las pruebas.
 */
import { tipoCharla } from './charla-rapida';
import { MemoriaEtiquetas, type EtiquetaVoz } from '../mobile/src/compa/etiquetasVoz';
import type { AvatarVoz, Idioma } from '../server/eleven';
import { ejemploDeManos, quePuedoDecir } from './manos-ficha';

export type Intencion =
  | 'saludo'
  | 'como_estas'
  | 'estoy_bien'
  | 'gracias'
  | 'adios'
  | 'quien_eres'
  | 'quien_te_creo'
  | 'que_puedes'
  | 'que_haces'
  | 'me_escuchas'
  | 'hora'
  | 'fecha'
  | 'espera'
  | 'elogio'
  | 'perdon'
  | 'risa'
  | 'eres_robot';

export type Plataforma = 'app' | 'web' | 'windows';

const plano = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Lo que puede ir delante o detrás sin cambiar la intención: el nombre del avatar, «oye», «por favor». */
const RELLENO = /\b(aura|au ra|claudio|antonio|ant onio|guardian|ojos|oye|hey|oiga|mira|por favor|porfa|please|amiga|amigo|compa)\b/g;

/** Cada intención: frases que, solas, la dicen (ya en plano, sin tildes ni signos). */
const PATRONES: Array<[Intencion, RegExp]> = [
  ['me_escuchas', /^(me (escuchas|escucha|oyes|oye|entiendes|entiende)|(estas|esta) (ahi|aqui|despierta|despierto)|(sigues|sigue) (ahi|aqui)|hola hola|alo|aló|bueno bueno|can you hear me|are you (there|listening|awake)|you there|hello hello)$/],
  ['hora', /^((me dices )?(que hora es|que horas son|la hora|hora)|what time is it|whats the time|what s the time|time please)$/],
  ['fecha', /^((que|a que) (dia|fecha) (es|estamos)( hoy)?|que dia es hoy|que fecha es hoy|en que dia estamos|what day is (it|today)|whats the date( today)?|what s the date( today)?|what is the date( today)?)$/],
  ['quien_eres', /^(quien eres( tu)?|quien es usted|como te llamas|como se llama( usted)?|cual es (tu|su) nombre|que eres( tu)?|presentate|who are you|whats your name|what s your name|what is your name|introduce yourself)$/],
  ['quien_te_creo', /^(quien te (creo|hizo|programo|invento|construyo)|de donde (eres|saliste)|quien es tu creador|who (made|created|built) you|who is your creator)$/],
  // «Ayuda» sola no entra: puede ser un apuro de verdad, y eso lo atiende el cerebro.
  ['que_puedes', /^(que (puedes|sabes|puede|sabe) hacer( usted)?|en que (me )?(puedes ayudar|puede ayudar|ayudas|me ayudas)|para que (sirves|sirve)|que cosas (puedes|sabes|puede|sabe) hacer|what can you do|how can you help( me)?)$/],
  ['que_haces', /^(que (haces|estas haciendo|cuentas|me cuentas|hay de nuevo)( tu)?|en que andas|que onda|what are you (doing|up to)|whats up|what s up|sup)$/],
  ['eres_robot', /^(eres (un )?(robot|humano|humana|persona|real|una ia|ia|inteligencia artificial|una maquina)|are you (a )?(robot|human|real|an ai|ai|person))$/],
  ['estoy_bien', /^((yo )?(estoy|ando|aqui) (bien|muy bien|super bien|excelente|tranquilo|tranquila)|todo bien( por aca| por aqui)?|bien gracias( y tu)?|muy bien gracias( y tu)?|i m (good|fine|great|doing well)|im (good|fine|great)|doing (good|well|great))( gracias| thanks)?$/],
  ['espera', /^(espera|esperame|espera un (momento|segundo|momentito)|un (momento|segundito|segundo|momentito)|dame un (momento|segundo|segundito)|aguanta|aguantame|hold on|wait|one (sec|second|moment)|give me a (sec|second|moment))$/],
  ['elogio', /^((eres|sos) (genial|increible|lo maximo|la mejor|el mejor|muy (lista|listo|inteligente|buena|bueno)|un amor|una maravilla)|te quiero( mucho)?|te amo|buen trabajo|bien hecho|excelente trabajo|me encantas|que (lista|listo|inteligente) (eres)?|you (are|re) (awesome|great|amazing|the best|smart)|good job|well done|great job|i love you|love you)$/],
  ['perdon', /^(perdon|perdoname|disculpa|disculpame|lo siento|sorry|my bad|i m sorry|im sorry)$/],
  ['risa', /^((ja|je|ji|ha|he|lol|xd)+|jajaja+|que risa|que gracioso|lol+|haha+)$/],
];

/** La intención del mensaje entero, o null si no es solo eso. */
export function intencionDe(texto: string): Intencion | null {
  const crudo = String(texto || '').trim();
  if (!crudo || crudo.length > 80) return null;
  const p = plano(crudo).replace(RELLENO, ' ').replace(/\s+/g, ' ').trim();
  if (!p) return null;
  for (const [i, re] of PATRONES) if (re.test(p)) return i;
  // Los de siempre (saludo, cómo estás, gracias, adiós), con su detector probado.
  const t = tipoCharla(crudo);
  return t;
}

/* ── el banco ─────────────────────────────────────────────────────────────────────────────── */

type Lista = { es: readonly string[]; en: readonly string[] };
type Banco = Partial<Record<Intencion, Lista>>;
type Persona = AvatarVoz | 'electrum';

/*
 * Marcadores: {n} = «, Nombre» (o nada si no se sabe); {N} = «Nombre» con coma después al empezar
 * (o nada); {yo} = el nombre del avatar; {momento} = «buenos días/tardes/noches» según la hora de
 * Honduras; {hora}, {fecha}; {puedo} = lo que el avatar puede hacer aquí (Plataforma).
 */
const BASE: Banco = {
  saludo: {
    es: [
      '¡Hola{n}! ¿En qué te ayudo?', '¡{Momento}{n}! Aquí estoy.', '¡Qué gusto oírte{n}! Dime.', '¡Hola{n}! ¿Qué hacemos hoy?',
      '¡{Momento}{n}! ¿Cómo te va?', '¡Hola, hola{n}! Te escucho.', '¡Hey{n}! ¿Qué se te ofrece?', '¡{Momento}{n}! ¿En qué andamos?',
      '¡Qué bueno que llegaste{n}! ¿Qué necesitas?', '¡Hola{n}! List{a} para lo que digas.', '¡Aquí estoy{n}! ¿Qué tienes en mente?',
      '¡{Momento}{n}! Cuéntame.',
    ],
    en: [
      'Hi{n}! How can I help?', '{Momento}{n}! I’m here.', 'So good to hear you{n}! Go ahead.', 'Hey{n}! What are we doing today?',
      '{Momento}{n}! How’s it going?', 'Hello, hello{n}! I’m listening.', 'Hey there{n}! What do you need?', '{Momento}{n}! What’s up?',
      'Glad you’re here{n}! What can I do?', 'Hi{n}! Ready when you are.', 'I’m here{n}! What’s on your mind?', '{Momento}{n}! Tell me.',
    ],
  },
  como_estas: {
    es: [
      '¡Muy bien, gracias por preguntar! ¿Y tú cómo vas?', '¡Aquí content{a} de oírte{n}! ¿Tú cómo estás?', 'Bien, bien. ¿Y tú qué tal tu día?',
      '¡De maravilla! ¿Y tú, cómo amaneciste?', 'Todo tranquilo por aquí. ¿Tú cómo te sientes?', '¡Mejor ahora que hablamos{n}! ¿Y tú?',
      'Con ganas de ayudarte. ¿Cómo va todo?', '¡Bien, gracias! ¿Qué tal te está yendo?', 'Muy bien. ¿Y por allá cómo andan las cosas?',
      '¡Excelente! ¿Y tú? Cuéntame.', 'Aquí, list{a} y de buen ánimo. ¿Tú qué tal?',
    ],
    en: [
      'Doing great, thanks for asking! How about you?', 'Happy to hear you{n}! How are you?', 'Good, good. How’s your day going?',
      'Wonderful! How did you wake up today?', 'All calm over here. How are you feeling?', 'Better now that we’re talking{n}! And you?',
      'Eager to help. How’s everything?', 'Good, thanks! How’s it going for you?', 'Very well. How are things on your end?',
      'Excellent! And you? Tell me.', 'Here, ready and in a good mood. How about you?',
    ],
  },
  estoy_bien: {
    es: [
      '¡Qué bueno{n}! Me alegra.', '¡Eso me encanta oír! ¿En qué te ayudo?', '¡Qué bien! ¿Qué hacemos?', '¡Me alegra mucho{n}!',
      '¡Así me gusta! Dime qué necesitas.', '¡Excelente! Aquí estoy para lo que sea.', '¡Qué bueno saberlo! ¿Seguimos?', '¡Me da gusto{n}!',
    ],
    en: [
      'Great to hear{n}!', 'Love hearing that! How can I help?', 'Nice! What shall we do?', 'So glad{n}!',
      'That’s what I like! Tell me what you need.', 'Excellent! I’m here for whatever.', 'Good to know! Shall we continue?', 'Happy to hear it{n}!',
    ],
  },
  gracias: {
    es: [
      '¡Con mucho gusto!', 'Para eso estoy.', '¡De nada{n}!', '¡Cuando quieras!', '¡Un placer ayudarte!', '¡A la orden{n}!',
      'No hay de qué.', '¡Me alegra que sirviera!', '¡Siempre{n}!', 'Con gusto, aquí sigo.', '¡Para servirte!',
    ],
    en: [
      'My pleasure!', 'That’s what I’m here for.', 'You’re welcome{n}!', 'Anytime!', 'Happy to help!', 'At your service{n}!',
      'No problem at all.', 'Glad it helped!', 'Always{n}!', 'Sure thing, I’m still here.', 'Happy to serve!',
    ],
  },
  adios: {
    es: [
      '¡Cuídate mucho{n}! Aquí estaré.', '¡Hasta luego{n}!', 'Nos hablamos pronto.', '¡Que te vaya muy bien{n}!', '¡Hasta pronto! Me llamas cuando quieras.',
      '¡Nos vemos{n}!', '¡Que descanses{n}!', '¡Chao{n}! Aquí sigo por si me necesitas.', '¡Hasta la próxima!', '¡Ve con cuidado{n}!',
    ],
    en: [
      'Take care{n}! I’ll be here.', 'See you later{n}!', 'Talk soon.', 'Have a great one{n}!', 'See you soon! Call me anytime.',
      'Bye{n}!', 'Rest well{n}!', 'Bye{n}! I’m here if you need me.', 'Until next time!', 'Take it easy{n}!',
    ],
  },
  quien_eres: {
    es: [
      'Soy {yo}, tu asistente de AU-RA. Estoy para ayudarte con lo que necesites.', 'Me llamo {yo}. Te acompaño y te ayudo a resolver lo que necesites.',
      '¡{yo}, para servirte{n}! Tu asistente personal.', 'Soy {yo}. Háblame con confianza: aquí estoy para ti.',
      '{yo}, de AU-RA, a tu lado. Dime y lo hacemos juntos.', 'Soy {yo}, de Orden Global. Te escucho y te ayudo.',
    ],
    en: [
      'I’m {yo}, your AU-RA assistant. I’m here to help with whatever you need.', 'My name is {yo}. I keep you company and help you get things done.',
      '{yo}, at your service{n}! Your personal assistant.', 'I’m {yo}. Talk to me like a friend: I’m here for you.',
      '{yo}, your AU-RA companion. Tell me and we’ll do it together.', 'I’m {yo}, from Orden Global. I’m listening.',
    ],
  },
  quien_te_creo: {
    es: [
      'Me hizo el equipo de Orden Global, para acompañarte y ayudarte.', 'Nací en Orden Global. Me entrenaron para ser tu asistente.',
      'Soy de Orden Global: me armaron para que tengas a alguien que te ayude siempre.', 'Me creó Orden Global. ¡Y aquí estoy para ti{n}!',
    ],
    en: [
      'The Orden Global team made me, to keep you company and help you.', 'I was born at Orden Global. They trained me to be your assistant.',
      'I’m from Orden Global: they built me so you always have someone to help.', 'Orden Global created me. And here I am for you{n}!',
    ],
  },
  que_puedes: {
    es: [
      'Puedo {puedo}. ¿Por dónde empezamos?', 'Puedo {puedo}. Dime qué necesitas.', 'Mira: puedo {puedo}. ¿Qué hacemos primero?',
      'Un montón de cosas: {puedo}. Tú dime.', 'Aquí puedo {puedo}. ¿Te ayudo con algo de eso?',
    ],
    en: [
      'I can {puedo}. Where do we start?', 'I can {puedo}. Tell me what you need.', 'Look: I can {puedo}. What first?',
      'Lots of things: {puedo}. You tell me.', 'Here I can {puedo}. Want help with any of that?',
    ],
  },
  que_haces: {
    es: [
      'Aquí, esperándote{n}. ¿Qué hacemos?', 'Nada, pendiente de ti. Dime.', 'Aquí, list{a} para lo que necesites.', 'Pensando en qué te puedo ayudar hoy. ¿Y tú?',
      'Aquí contigo{n}. ¿Qué se te ofrece?', 'Esperando que me cuentes algo. ¿Qué hay?', 'Aquí, de buen ánimo. ¿Tú en qué andas?', 'Lo de siempre: atent{a} a ti. ¿Qué necesitas?',
    ],
    en: [
      'Just here, waiting for you{n}. What shall we do?', 'Nothing, all yours. Tell me.', 'Here, ready for whatever you need.', 'Thinking about how I can help you today. And you?',
      'Right here with you{n}. What can I do?', 'Waiting for you to tell me something. What’s up?', 'Here, in a good mood. What are you up to?', 'The usual: all ears for you. What do you need?',
    ],
  },
  me_escuchas: {
    es: [
      '¡Sí, aquí estoy{n}! Te escucho.', 'Te escucho perfecto. Dime.', '¡Aquí estoy! Fuerte y claro.', 'Sí, sí, te oigo bien{n}.',
      '¡Claro que te escucho! ¿Qué pasó?', 'Aquí sigo, atent{a}. Cuéntame.', 'Te oigo{n}. Adelante.', '¡Presente! Dime qué necesitas.',
      'Sí, te escucho clarito.', 'Aquí estoy contigo{n}. Habla con calma.',
    ],
    en: [
      'Yes, I’m here{n}! I’m listening.', 'I hear you perfectly. Go ahead.', 'I’m here! Loud and clear.', 'Yes, yes, I hear you fine{n}.',
      'Of course I hear you! What’s up?', 'Still here, all ears. Tell me.', 'I hear you{n}. Go on.', 'Present! What do you need?',
      'Yes, I hear you clearly.', 'I’m right here{n}. Take your time.',
    ],
  },
  hora: {
    es: ['Son las {hora}.', 'Ahorita son las {hora}.', 'Mira, son las {hora}.', 'Son las {hora}, hora de Honduras.', 'Van a ser las {hora}.'],
    en: ['It’s {hora}.', 'It’s {hora} right now.', 'Right now it’s {hora}.', 'It’s {hora}, Honduras time.', 'It’s about {hora}.'],
  },
  fecha: {
    es: ['Hoy es {fecha}.', 'Estamos a {fecha}.', 'Hoy es {fecha}. ¿Agendamos algo?', 'Es {fecha}.'],
    en: ['Today is {fecha}.', 'It’s {fecha}.', 'Today is {fecha}. Shall we plan something?', 'It’s {fecha} today.'],
  },
  espera: {
    es: ['Claro, aquí espero.', 'Con calma, tómate tu tiempo.', 'Dale, te espero.', 'Sin prisa{n}, aquí estoy.', 'Va, cuando quieras sigo.', 'Aquí te espero{n}.'],
    en: ['Sure, I’ll wait.', 'No rush, take your time.', 'Okay, I’ll wait.', 'No hurry{n}, I’m here.', 'Sure, go ahead whenever.', 'I’ll be right here{n}.'],
  },
  elogio: {
    es: [
      '¡Ay, gracias{n}! Me alegras el día.', '¡Qué lindo! Gracias.', '¡Gracias! Tú haces que sea fácil.', '¡Me sonrojas{n}!',
      '¡Gracias! Hacemos buen equipo.', '¡Aww, gracias! Aquí para ti siempre.', '¡Eso me encanta oírlo{n}!',
    ],
    en: [
      'Aw, thanks{n}! You made my day.', 'That’s so sweet! Thank you.', 'Thanks! You make it easy.', 'You’re making me blush{n}!',
      'Thanks! We make a good team.', 'Aww, thank you! Always here for you.', 'Love hearing that{n}!',
    ],
  },
  perdon: {
    es: ['No pasa nada{n}.', 'No te preocupes.', 'Todo bien, sigue.', 'No hay problema{n}.', 'Para nada, dime.', 'Todo bien, aquí estoy.'],
    en: ['It’s okay{n}, no worries.', 'Don’t worry about it.', 'All good, go on.', 'No problem{n}.', 'Not at all, go ahead.', 'It’s fine, I’m here.'],
  },
  risa: {
    es: ['¡Jaja! Me contagias.', '¡Je, je! Qué bueno.', '¡Jaja, me hiciste reír!', '¡Ja! Esa estuvo buena.', '¡Jeje! Qué risa.'],
    en: ['Haha! It’s contagious.', 'Heh! That’s good.', 'Haha, you made me laugh!', 'Ha! Good one.', 'Hehe! So funny.'],
  },
  eres_robot: {
    es: [
      'Soy inteligencia artificial, pero aquí estoy de verdad para ti.', 'Soy una IA, sí. Pero te escucho y te ayudo como alguien de confianza.',
      'Inteligencia artificial, de Orden Global. ¡Con mucho corazón, eso sí!', 'Soy IA. No soy una persona, pero sí estoy contigo.',
    ],
    en: [
      'I’m an AI assistant, but I’m truly here for you.', 'I’m an AI, yes. But I listen and help like a friend.',
      'Artificial intelligence, from Orden Global. With a lot of heart, though!', 'I’m an AI. Not a person, but I am your companion.',
    ],
  },
};

/** Lo propio de cada uno (se suma a lo de base; el Guardián usa solo lo suyo, sereno y breve). */
const PROPIAS: Record<Persona, Banco> = {
  aura: {
    saludo: { es: ['¡Hola{n}! ¿Cómo amaneciste?', '¡Qué alegría oírte{n}! ¿Qué hacemos?'], en: ['Hi{n}! How did you wake up?', 'So happy to hear you{n}! What shall we do?'] },
    como_estas: { es: ['¡Feliz de acompañarte{n}! ¿Y tú?'], en: ['Happy to be with you{n}! And you?'] },
  },
  ojos: {
    saludo: { es: ['Hola{n}. Te escucho.', '{Momento}{n}. Dime.', 'Aquí estoy{n}.', '{Momento}{n}. ¿En qué te ayudo?', 'Hola{n}. Todo en orden.', 'Presente{n}. Adelante.'], en: ['Hello{n}. I’m listening.', '{Momento}{n}. Go ahead.', 'I’m here{n}.', '{Momento}{n}. How can I help?', 'Hello{n}. All in order.', 'Present{n}. Go ahead.'] },
    como_estas: { es: ['Todo en orden, gracias. ¿Y tú?', 'Bien y atento. ¿Cómo estás tú?', 'Tranquilo y de guardia. ¿Tú?', 'Sin novedad. ¿Cómo va tu día?'], en: ['All in order, thanks. And you?', 'Well and alert. How are you?', 'Calm and on watch. You?', 'Nothing new. How’s your day?'] },
    estoy_bien: { es: ['Me alegra{n}.', 'Bien. ¿Seguimos?', 'Perfecto. Dime qué necesitas.'], en: ['Glad to hear{n}.', 'Good. Shall we go on?', 'Perfect. Tell me what you need.'] },
    gracias: { es: ['Con gusto.', 'Siempre.', 'A la orden{n}.', 'Para eso estoy.'], en: ['Glad to help.', 'Always.', 'At your service{n}.', 'That’s what I’m here for.'] },
    adios: { es: ['Hasta luego{n}. Sigo de guardia.', 'Cuídate{n}.', 'Aquí quedo vigilando.', 'Hasta pronto{n}.'], en: ['Until later{n}. Still on watch.', 'Take care{n}.', 'I’ll keep watch.', 'See you soon{n}.'] },
    quien_eres: { es: ['Soy el Guardián, tu asistente de AU-RA. Vigilo y te ayudo.', 'El Guardián. Atento a lo que necesites{n}.'], en: ['I’m the Guardian, your AU-RA assistant. I watch over things and help.', 'The Guardian. Ready for whatever you need{n}.'] },
    quien_te_creo: { es: ['Me creó Orden Global.', 'Vengo de Orden Global. Para cuidarte y ayudarte.'], en: ['Orden Global created me.', 'I come from Orden Global. To look after you and help.'] },
    que_puedes: { es: ['Puedo {puedo}. Dime.', 'Aquí: {puedo}.'], en: ['I can {puedo}. Go ahead.', 'Here: {puedo}.'] },
    que_haces: { es: ['De guardia{n}. ¿Qué necesitas?', 'Vigilando. Dime.', 'Aquí, atento a ti.'], en: ['On watch{n}. What do you need?', 'Keeping watch. Go ahead.', 'Here, watching out for you.'] },
    me_escuchas: { es: ['Te escucho{n}.', 'Sí. Fuerte y claro.', 'Aquí estoy. Adelante.', 'Te oigo bien{n}.', 'Atento. Dime.'], en: ['I hear you{n}.', 'Yes. Loud and clear.', 'I’m here. Go ahead.', 'I hear you fine{n}.', 'Listening. Go on.'] },
    hora: { es: ['Son las {hora}.', 'Las {hora}.'], en: ['It’s {hora}.', '{hora}.'] },
    fecha: { es: ['Hoy es {fecha}.', 'Es {fecha}.'], en: ['Today is {fecha}.', 'It’s {fecha}.'] },
    espera: { es: ['Aquí espero.', 'Tómate tu tiempo{n}.', 'Sin prisa.'], en: ['I’ll wait.', 'Take your time{n}.', 'No rush.'] },
    elogio: { es: ['Gracias{n}.', 'Lo aprecio.', 'Gracias. Hacemos buen equipo.'], en: ['Thank you{n}.', 'I appreciate it.', 'Thanks. Good team.'] },
    perdon: { es: ['No pasa nada.', 'Con calma{n}.', 'Todo bien.'], en: ['No problem.', 'It’s fine{n}.', 'All good.'] },
    risa: { es: ['Je. Buena esa.', 'Me alegra verte de buen ánimo.'], en: ['Heh. Good one.', 'Glad to see you in good spirits.'] },
    eres_robot: { es: ['Soy una inteligencia artificial. Tu guardián.', 'IA, sí. Siempre atento a ti.'], en: ['I’m an artificial intelligence. Your guardian.', 'AI, yes. Always watching out for you.'] },
  },
  claudio: {
    saludo: { es: ['¡Hola{n}! ¿Qué tramamos hoy?', '¡Hey{n}! Aquí tu zorro favorito.', '¡{Momento}{n}! Las orejas listas, dime.', '¡Hola{n}! Olfateo que traes algo interesante.'], en: ['Hi{n}! What are we up to today?', 'Hey{n}! Your favorite fox here.', '{Momento}{n}! Ears up, tell me.', 'Hi{n}! I sniff something interesting.'] },
    como_estas: { es: ['¡De maravilla, con la cola en alto! ¿Y tú?', 'Bien, curioseando como siempre. ¿Tú cómo vas?', '¡Astuto y de buen humor! ¿Y tú?'], en: ['Fantastic, tail up high! And you?', 'Good, curious as ever. How are you?', 'Clever and in a good mood! You?'] },
    gracias: { es: ['¡Un placer, como siempre!', 'Para servirte, sin cobrar comisión.', '¡Para eso tengo estas orejas!'], en: ['A pleasure, as always!', 'At your service, no fee.', 'That’s what these ears are for!'] },
    adios: { es: ['¡Nos vemos{n}! No me extrañes mucho.', '¡Hasta luego{n}! Me quedo vigilando la madriguera.'], en: ["See you{n}! Don't miss me too much.", 'Later{n}! I’ll guard the den.'] },
    quien_eres: { es: ['¡Claudio, el zorro más curioso de AU-RA! Tu asistente.', 'Soy Claudio: curioso, ingenioso y a tu servicio{n}.'], en: ['Claudio, the most curious fox in AU-RA! Your assistant.', 'I’m Claudio: curious, witty and at your service{n}.'] },
    elogio: { es: ['¡Ay, me vas a hacer mover la cola!', '¡Gracias! Un zorro no se sonroja… bueno, un poquito.'], en: ['Aw, you’ll make my tail wag!', 'Thanks! A fox doesn’t blush… well, a little.'] },
    risa: { es: ['¡Jaja! Esa estuvo de zorro.', '¡Je, je! Me hiciste reír con todo y orejas.'], en: ['Haha! That was foxy.', 'Hehe! You made me laugh, ears and all.'] },
  },
  antonio: {
    saludo: { es: ['¡Hola{n}! ¿Qué resolvemos?', '¡Aquí ANT-ONIO{n}! Dime.', '¡{Momento}{n}! Los cuatro brazos listos.', '¡Hola{n}! ¿Manos a la obra?'], en: ['Hi{n}! What are we solving?', 'ANT-ONIO here{n}! Go ahead.', '{Momento}{n}! All four arms ready.', 'Hi{n}! Shall we get to work?'] },
    como_estas: { es: ['¡Con los cuatro brazos listos! ¿Y tú cómo vas?', '¡Muy bien y con energía! ¿Tú qué tal?', '¡A tope! ¿Y tú?'], en: ['All four arms ready! How about you?', 'Great and full of energy! How are you?', 'Full power! And you?'] },
    gracias: { es: ['¡A la orden!', '¡Con gusto, para eso son los brazos!', '¡Cuando quieras, aquí sigo trabajando!'], en: ['Anytime!', "Happy to, that's what the arms are for!", 'Anytime, I keep working!'] },
    adios: { es: ['¡Hasta luego{n}! Aquí sigo.', '¡Nos vemos{n}! A seguir chambeando.'], en: ["See you{n}! I'll be around.", 'Bye{n}! Back to work.'] },
    quien_eres: { es: ['¡ANT-ONIO, la hormiga de cuatro brazos! Tu asistente práctico.', 'Soy ANT-ONIO: resuelvo rápido y con energía{n}.'], en: ['ANT-ONIO, the four-armed ant! Your practical assistant.', 'I’m ANT-ONIO: quick and full of energy{n}.'] },
    elogio: { es: ['¡Gracias! Los cuatro brazos te lo agradecen.', '¡Eso me da más energía{n}!'], en: ['Thanks! All four arms thank you.', 'That gives me more energy{n}!'] },
  },
  // Dr Electrum: geólogo sénior, de usted, sobrio (su servidor arma su propio prompt).
  electrum: {
    saludo: { es: ['{Momento}{n}. ¿En qué le ayudo?', 'Buen día{n}. Dígame.', '{Momento}{n}. A sus órdenes.', 'Hola{n}. ¿Qué revisamos hoy?', '{Momento}{n}. Aquí estoy para lo que necesite.'], en: ['{Momento}{n}. How can I help?', 'Good day{n}. Go ahead.', '{Momento}{n}. At your service.', 'Hello{n}. What shall we review today?'] },
    como_estas: { es: ['Muy bien, gracias. ¿Y usted?', 'Bien, trabajando. ¿Cómo está usted?', 'Todo en orden, gracias. ¿En qué le ayudo?'], en: ['Very well, thank you. And you?', 'Good, working. How are you?', 'All in order, thanks. How can I help?'] },
    gracias: { es: ['Con mucho gusto.', 'A sus órdenes{n}.', 'Para servirle.', 'Siempre es un placer.'], en: ['My pleasure.', 'At your service{n}.', 'Happy to help.', 'Always a pleasure.'] },
    adios: { es: ['Hasta luego{n}. Quedo pendiente.', 'Que le vaya bien.', 'A sus órdenes cuando guste.'], en: ['Goodbye{n}. I’ll stay available.', 'All the best.', 'At your service anytime.'] },
    quien_eres: { es: ['Soy Dr Electrum, su asesor geólogo de Orden Global.', 'Dr Electrum: geología, catastro minero y expedientes de Honduras, a su servicio.'], en: ['I’m Dr Electrum, your geology advisor from Orden Global.', 'Dr Electrum: geology, mining cadastre and Honduran files, at your service.'] },
    que_puedes: { es: ['Puedo {puedo}. ¿Por dónde empezamos?', 'Aquí puedo {puedo}. Dígame.'], en: ['I can {puedo}. Where do we start?', 'Here I can {puedo}. Go ahead.'] },
    que_haces: { es: ['Aquí, revisando expedientes. ¿En qué le ayudo?', 'Atento a lo que necesite{n}.', 'Trabajando. Dígame.'], en: ['Here, reviewing files. How can I help?', 'Ready for whatever you need{n}.', 'Working. Go ahead.'] },
    me_escuchas: { es: ['Sí, le escucho{n}.', 'Le escucho bien. Adelante.', 'Aquí estoy. Dígame.'], en: ['Yes, I hear you{n}.', 'I hear you fine. Go ahead.', 'I’m here. Go ahead.'] },
    espera: { es: ['Claro, aquí espero.', 'Tómese su tiempo.'], en: ['Of course, I’ll wait.', 'Take your time.'] },
    perdon: { es: ['No se preocupe.', 'No hay problema.'], en: ['No worries.', 'No problem.'] },
    elogio: { es: ['Muchas gracias{n}.', 'Se agradece.'], en: ['Thank you very much{n}.', 'Much appreciated.'] },
    estoy_bien: { es: ['Me alegra{n}.', 'Qué bueno. ¿En qué le ayudo?', 'Me da gusto. Dígame.'], en: ['Glad to hear{n}.', 'Good. How can I help?', 'Happy to hear. Go ahead.'] },
    quien_te_creo: { es: ['Me creó Orden Global, para asesorarle en geología y minería.', 'Vengo de Orden Global.'], en: ['Orden Global created me, to advise you on geology and mining.', 'I come from Orden Global.'] },
    risa: { es: ['Je. Buena esa.', 'Me alegra verle de buen ánimo.'], en: ['Heh. Good one.', 'Glad to see you in good spirits.'] },
    eres_robot: { es: ['Soy una inteligencia artificial, entrenada como geólogo.', 'IA, sí. Pero con el oficio de un geólogo sénior.'], en: ['I’m an artificial intelligence, trained as a geologist.', 'AI, yes. But with a senior geologist’s craft.'] },
  },
};

/** El Guardián y Dr Electrum hablan solo con lo suyo (más sobrio que la base) cuando lo tienen. */
const SOLO_PROPIAS = new Set<Persona>(['ojos', 'electrum']);

/** Todas las frases de una intención para esa persona e idioma (las propias primero, sin repetidas). */
export function frasesFijas(intencion: Intencion, persona: Persona = 'aura', idioma: Idioma = 'es'): string[] {
  const propias = PROPIAS[persona]?.[intencion]?.[idioma] || [];
  const base = SOLO_PROPIAS.has(persona) && propias.length ? [] : BASE[intencion]?.[idioma] || [];
  return [...new Set([...propias, ...base])];
}

/* ── etiquetas de audio que van con lo que se dice ────────────────────────────────────────── */

const ETIQUETAS: Record<Intencion, readonly EtiquetaVoz[]> = {
  saludo: ['warmly', 'cheerfully', 'delighted', 'gently'],
  como_estas: ['cheerfully', 'warmly', 'delighted'],
  estoy_bien: ['delighted', 'warmly', 'cheerfully'],
  gracias: ['warmly', 'tender', 'gently', 'cheerfully'],
  adios: ['warmly', 'gently', 'tender'],
  quien_eres: ['confident', 'warmly', 'proud'],
  quien_te_creo: ['proud', 'warmly', 'confident'],
  que_puedes: ['enthusiastic', 'confident', 'cheerfully'],
  que_haces: ['warmly', 'playfully', 'cheerfully', 'curious'],
  me_escuchas: ['reassuring', 'warmly', 'gently'],
  hora: ['matter-of-fact', 'calm', 'warmly'],
  fecha: ['matter-of-fact', 'calm', 'warmly'],
  espera: ['calm', 'gently', 'reassuring'],
  elogio: ['delighted', 'giggles', 'tender', 'warmly'],
  perdon: ['reassuring', 'gently', 'calm'],
  risa: ['laughs', 'chuckles', 'giggles'],
  eres_robot: ['warmly', 'playfully', 'confident'],
};
/** El Guardián y Dr Electrum: sobrios, sin risas ni euforia. */
const SOBRIAS: readonly EtiquetaVoz[] = ['calm', 'warmly', 'matter-of-fact', 'reassuring', 'gently', 'confident', 'focused'];
const memoriaEtiquetas = new MemoriaEtiquetas(3);

const EMOCION: Record<Intencion, string> = {
  saludo: 'feliz', como_estas: 'feliz', estoy_bien: 'feliz', gracias: 'carino', adios: 'carino', quien_eres: 'feliz', quien_te_creo: 'orgullo',
  que_puedes: 'feliz', que_haces: 'feliz', me_escuchas: 'carino', hora: 'neutral', fecha: 'neutral', espera: 'neutral', elogio: 'carino', perdon: 'carino', risa: 'risa', eres_robot: 'feliz',
};

/* ── la hora y la fecha de Honduras ──────────────────────────────────────────────────────── */

function partesHonduras(d: Date) {
  const f = (o: Intl.DateTimeFormatOptions, loc = 'es-HN') => new Intl.DateTimeFormat(loc, { timeZone: 'America/Tegucigalpa', ...o }).format(d);
  const h = Number(f({ hour: 'numeric', hour12: false })) % 24;
  return { h, f };
}
function momento(d: Date, idioma: Idioma): string {
  const { h } = partesHonduras(d);
  if (idioma === 'en') return h < 12 ? 'Good morning' : h < 19 ? 'Good afternoon' : 'Good evening';
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}
function hora(d: Date, idioma: Idioma): string {
  const { h, f } = partesHonduras(d);
  const min = f({ minute: '2-digit' }).padStart(2, '0');
  const h12 = h % 12 || 12;
  if (idioma === 'en') return `${h12}:${min} ${h < 12 ? 'a.m.' : 'p.m.'}`;
  const parte = h < 6 ? 'de la madrugada' : h < 12 ? 'de la mañana' : h < 19 ? 'de la tarde' : 'de la noche';
  return `${h12}:${min} ${parte}`;
}
function fecha(d: Date, idioma: Idioma): string {
  const { f } = partesHonduras(d);
  return idioma === 'en' ? f({ weekday: 'long', month: 'long', day: 'numeric' }, 'en-US') : f({ weekday: 'long', day: 'numeric', month: 'long' });
}

/* ── elegir sin repetir ───────────────────────────────────────────────────────────────────── */

const recientes = new Map<string, string[]>();
function elegir(opciones: readonly string[], clave: string, azar: () => number): string {
  const antes = recientes.get(clave) || [];
  const libres = opciones.filter((o) => !antes.includes(o));
  const pool = libres.length ? libres : opciones;
  const e = pool[Math.floor(azar() * pool.length) % pool.length];
  recientes.set(clave, [...antes, e].slice(-Math.max(1, Math.min(6, opciones.length - 1))));
  if (recientes.size > 5_000) recientes.delete(recientes.keys().next().value as string);
  return e;
}

export type RespuestaFija = {
  intencion: Intencion;
  /** Lo que se lee (sin etiquetas). */
  texto: string;
  /** Lo que se dice: con su etiqueta de audio v4 delante la mayoría de las veces. */
  voz: string;
  emocion: string;
};

const NOMBRE_AVATAR: Record<Persona, string> = { aura: 'AU-RA', ojos: 'el Guardián', claudio: 'Claudio', antonio: 'ANT-ONIO', electrum: 'Dr Electrum' };

/**
 * La respuesta al instante, o null si el mensaje no es SOLO una de estas cosas. `quien` (correo o id
 * de la persona) separa la rotación: a cada persona no se le repiten las últimas.
 */
export function respuestaFija(
  texto: string,
  o: { avatar?: AvatarVoz | 'electrum'; idioma?: Idioma; nombre?: string | null; plataforma?: Plataforma; quien?: string; ahora?: Date; azar?: () => number } = {}
): RespuestaFija | null {
  const intencion = intencionDe(texto);
  if (!intencion) return null;
  const persona: Persona = o.avatar && o.avatar in PROPIAS ? (o.avatar as Persona) : 'aura';
  const idioma: Idioma = o.idioma === 'en' ? 'en' : 'es';
  const azar = o.azar || Math.random;
  const ahora = o.ahora || new Date();
  // «¿Cómo amaneciste?» solo en la mañana (hora de Honduras).
  const manana = partesHonduras(ahora).h < 12;
  const opciones = frasesFijas(intencion, persona, idioma).filter((f) => manana || !/amaneciste|wake up/.test(f));
  if (!opciones.length) return null;
  const nombre = String(o.nombre || '').trim().split(/\s+/)[0] || '';
  const conNombre = nombre && nombre.length <= 20 ? `, ${nombre}` : '';
  const elegida = elegir(opciones, `${o.quien || '-'}|${persona}|${idioma}|${intencion}`, azar);
  const donde = persona === 'electrum' ? 'electrum' : o.plataforma || 'app';
  let textoFinal = elegida
    .replace('{Momento}', momento(ahora, idioma))
    .replace('{n}', conNombre)
    .replace('{a}', persona === 'aura' ? 'a' : 'o')
    .replace('{yo}', NOMBRE_AVATAR[persona])
    .replace('{hora}', hora(ahora, idioma))
    .replace('{fecha}', fecha(ahora, idioma))
    .replace('{puedo}', () => quePuedoDecir(donde, idioma, azar))
    .replace(/^el Guardián/, 'El Guardián');
  // «¿Qué puedes hacer?»: la mitad de las veces, un ejemplo de cómo pedirlo (de usted con Electrum).
  if (intencion === 'que_puedes' && azar() < 0.5) {
    const ej = ejemploDeManos(donde, idioma, azar);
    // Si ya cerraba con «Dime.», el ejemplo toma su lugar («Dime. Por ejemplo, dime…» suena a fórmula).
    if (ej) textoFinal = textoFinal.replace(/ (Dime|Dígame|Go ahead)\.$/, '') + (idioma === 'en' ? ` For example: ${ej}.` : persona === 'electrum' ? ` Por ejemplo, dígame ${ej}.` : ` Por ejemplo, dime ${ej}.`);
  }
  const sobria = persona === 'ojos' || persona === 'electrum';
  const lista = sobria ? ETIQUETAS[intencion].filter((e) => SOBRIAS.includes(e)) : ETIQUETAS[intencion];
  const etiqueta = azar() < 0.8 ? memoriaEtiquetas.elegir(lista.length ? lista : SOBRIAS, persona, azar) : null;
  return { intencion, texto: textoFinal, voz: etiqueta ? `[${etiqueta}] ${textoFinal}` : textoFinal, emocion: EMOCION[intencion] };
}
