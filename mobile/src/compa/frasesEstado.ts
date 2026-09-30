/**
 * LO QUE DICE MIENTRAS HACE ALGO: escuchando, pensando, revisando, buscando, calculando, abriendo,
 * esperando el «sí», listo, no pude, perdón, sorpresa, alegría, empatía, humor…
 *
 * Un banco de frases CORTAS por estado, por avatar (cada uno con su forma de ser) y por idioma, con la
 * emoción que ya existe en el contrato del avatar (avatar3d/tipos.ts), en la voz (la emoción del
 * turno, lib/emocion.ts) y en la cara de la mesa (FaceState). Sirve igual para la burbuja de la
 * compañera (compa/frases.ts), para lo que dice en voz alta y para el puente de voz del servidor
 * (server/voz-agente.ts: si el cerebro tarda, dice una de estas en vez de quedarse callado).
 *
 * La forma de ser, la misma que el prompt de cada uno (server/eleven.ts, lineaAvatar):
 *  · Guardián (ojos): sereno, preciso y breve; nunca alarmista. Solo sus frases.
 *  · AU-RA: cálida, cercana y clara, con el habla de aquí («tantito», «ahorita»).
 *  · Claudio (el zorro): curioso, ingenioso y bromista, sin dejar de ser profesional.
 *  · ANT-ONIO (la hormiga de cuatro brazos): enérgico, práctico, positivo, con humor ligero.
 * Sin género («estoy lista»): las mismas frases de base las dicen personajes distintos.
 *
 * No se repiten seguidas: `MemoriaFrases` recuerda las últimas de cada estado (y la última dicha, sea
 * del estado que sea) y elige entre las demás. Sin React Native ni nada del teléfono: la usan las
 * pruebas en Node y el servidor.
 */
import type { ExpresionAvatar } from '../avatar3d/tipos';

export const ESTADOS_FRASE = [
  'escuchando',
  'conectando',
  'pensando',
  'revisando',
  'buscando',
  'calculando',
  'abriendo',
  'esperando_confirmacion',
  'listo',
  'no_pude',
  'disculpa',
  'sorpresa',
  'alegria',
  'empatia',
  'humor',
] as const;
export type EstadoFrase = (typeof ESTADOS_FRASE)[number];
export type AvatarFrase = 'ojos' | 'aura' | 'claudio' | 'antonio';
export type IdiomaFrase = 'es' | 'en';
/** Las emociones de la voz que usa el banco (todas existen en lib/emocion.ts y mobile/src/lib/emocion.ts). */
export type EmocionFrase = 'neutral' | 'feliz' | 'risa' | 'sorpresa' | 'curioso' | 'pensando' | 'preocupado' | 'carino' | 'travieso';
/** Las caras de la mesa que usa el banco (todas existen en caraTipos.ts, FaceState). */
export type CaraFrase = 'IDLE' | 'LISTENING' | 'THINKING' | 'SCAN' | 'CURIOUS' | 'HAPPY' | 'CONCERNED' | 'SURPRISED' | 'LAUGH' | 'SAD' | 'WINK';

/** Cada estado con su cara del avatar, su emoción de voz y su cara de la mesa. Nada inventado: solo lo que ya existe. */
export const EMOCION_DE_ESTADO: Record<EstadoFrase, { expresion: ExpresionAvatar; emocion: EmocionFrase; cara: CaraFrase }> = {
  escuchando: { expresion: 'escucha', emocion: 'curioso', cara: 'LISTENING' },
  conectando: { expresion: 'piensa', emocion: 'neutral', cara: 'THINKING' },
  pensando: { expresion: 'piensa', emocion: 'pensando', cara: 'THINKING' },
  revisando: { expresion: 'piensa', emocion: 'pensando', cara: 'SCAN' },
  buscando: { expresion: 'piensa', emocion: 'curioso', cara: 'SCAN' },
  calculando: { expresion: 'piensa', emocion: 'pensando', cara: 'THINKING' },
  abriendo: { expresion: 'tranquila', emocion: 'neutral', cara: 'IDLE' },
  esperando_confirmacion: { expresion: 'escucha', emocion: 'curioso', cara: 'CURIOUS' },
  listo: { expresion: 'contenta', emocion: 'feliz', cara: 'HAPPY' },
  no_pude: { expresion: 'uy', emocion: 'preocupado', cara: 'CONCERNED' },
  disculpa: { expresion: 'uy', emocion: 'preocupado', cara: 'CONCERNED' },
  sorpresa: { expresion: 'sorprendida', emocion: 'sorpresa', cara: 'SURPRISED' },
  alegria: { expresion: 'encantada', emocion: 'feliz', cara: 'HAPPY' },
  empatia: { expresion: 'triste', emocion: 'carino', cara: 'SAD' },
  humor: { expresion: 'encantada', emocion: 'travieso', cara: 'WINK' },
};

type Lista = Record<IdiomaFrase, readonly string[]>;

/** Las de base (AU-RA, Claudio y ANT-ONIO las comparten, junto con las suyas). */
const BASE: Record<EstadoFrase, Lista> = {
  escuchando: {
    es: ['Te escucho…', 'Dime…', 'Aquí estoy, dime.', 'Soy todo oídos.', 'Cuéntame…', 'Adelante, te escucho.'],
    en: ['I’m listening…', 'Go ahead…', 'I’m here, tell me.', 'I’m all ears.', 'Tell me…', 'Go on, I’m listening.'],
  },
  conectando: {
    es: ['Un segundito…', 'Ya casi…', 'Conectando…', 'Dame un momentito…', 'Ahorita estoy contigo.'],
    en: ['One sec…', 'Almost there…', 'Connecting…', 'Just a moment…', 'With you in a second.'],
  },
  pensando: {
    es: ['Déjame pensarlo…', 'Mmm, a ver…', 'Dame un segundo…', 'Estoy pensando…', 'Buena pregunta, a ver…', 'Déjame ver…'],
    en: ['Let me think…', 'Hmm, let’s see…', 'Give me a second…', 'Thinking…', 'Good question, let’s see…', 'Let me see…'],
  },
  revisando: {
    es: ['Estoy revisando…', 'Déjame revisar…', 'Lo reviso ahorita…', 'Revisando lo que hay…', 'Voy a confirmarlo…', 'Déjame confirmar…'],
    en: ['Checking…', 'Let me check…', 'Looking into it…', 'Going over it…', 'Let me confirm…', 'Double-checking…'],
  },
  buscando: {
    es: ['Déjame buscarlo…', 'Lo estoy buscando…', 'Buscando…', 'Ya lo busco…', 'Voy a averiguar…', 'A ver qué encuentro…'],
    en: ['Let me look it up…', 'Searching…', 'Looking for it…', 'On it, searching…', 'Let me find out…', 'Let’s see what I find…'],
  },
  calculando: {
    es: ['Sacando cuentas…', 'Déjame calcular…', 'Haciendo los números…', 'Un segundo, calculo…', 'Calculando…'],
    en: ['Crunching numbers…', 'Let me calculate…', 'Doing the math…', 'One sec, calculating…', 'Calculating…'],
  },
  abriendo: {
    es: ['Ya lo abro.', 'Abriendo…', 'Va, lo abro.', 'Enseguida.', 'Ahí te va.'],
    en: ['Opening it.', 'Opening…', 'Sure, opening it.', 'Right away.', 'Here it comes.'],
  },
  esperando_confirmacion: {
    es: ['¿Lo hago?', '¿Te parece?', '¿Le doy?', 'Dime sí o no.', '¿Confirmas?', '¿Sigo?'],
    en: ['Should I?', 'Sound good?', 'Go ahead?', 'Just say yes or no.', 'Confirm?', 'Shall I continue?'],
  },
  listo: {
    es: ['¡Listo!', '¡Hecho!', 'Ya está.', '¡Ya quedó!', 'Hecho, ¿algo más?', '¡Va, listo!'],
    en: ['Done!', 'All set!', 'There you go.', 'Finished!', 'Done, anything else?', 'Got it done!'],
  },
  no_pude: {
    es: ['No pude hacerlo.', 'Uy, no me salió.', 'No se pudo esta vez.', 'Algo falló, ¿probamos otra vez?', 'No lo logré, perdón.'],
    en: ['I couldn’t do it.', 'Oops, that didn’t work.', 'No luck this time.', 'Something failed, try again?', 'I didn’t manage, sorry.'],
  },
  disculpa: {
    es: ['¡Ah, perdón! Dime.', 'Perdón, te escucho.', '¡Uy, perdón!', 'Perdón, sigue tú.', 'Perdón, ¿qué decías?'],
    en: ['Oh, sorry! Go ahead.', 'Sorry, I’m listening.', 'Oops, sorry!', 'Sorry, you go first.', 'Sorry, what were you saying?'],
  },
  sorpresa: {
    es: ['¡Uy!', '¡No me digas!', '¡Wow!', '¿En serio?', '¡Qué sorpresa!'],
    en: ['Whoa!', 'No way!', 'Wow!', 'Really?', 'What a surprise!'],
  },
  alegria: {
    es: ['¡Qué alegre!', '¡Qué bueno!', '¡Me encanta!', '¡Excelente!', '¡Qué buena noticia!'],
    en: ['How nice!', 'That’s great!', 'I love it!', 'Excellent!', 'What good news!'],
  },
  empatia: {
    es: ['Ay, lo siento.', 'Te entiendo.', 'Aquí estoy contigo.', 'Qué difícil, lo siento.', 'Con calma, vamos por partes.'],
    en: ['Oh, I’m sorry.', 'I understand.', 'I’m here with you.', 'That’s tough, I’m sorry.', 'Easy, one step at a time.'],
  },
  humor: {
    es: ['Je, je.', '¡Esa estuvo buena!', 'Jaja, me hiciste reír.', 'No te rías que me contagias.', '¡Ja! Buenísima.'],
    en: ['Heh, heh.', 'Good one!', 'Haha, you made me laugh.', 'Don’t laugh, it’s contagious.', 'Ha! That’s great.'],
  },
};

/** Las de cada uno. El Guardián usa SOLO las suyas (sereno y breve, sin la calidez de las de base). */
const PROPIAS: Record<AvatarFrase, Partial<Record<EstadoFrase, Lista>>> = {
  ojos: {
    escuchando: { es: ['Escuchando.', 'Te escucho.', 'Adelante.', 'Atento.', 'Dime.'], en: ['Listening.', 'I hear you.', 'Go ahead.', 'Standing by.', 'Tell me.'] },
    conectando: { es: ['Conectando.', 'Un momento.', 'Estableciendo conexión.', 'Casi listo el enlace.', 'En un instante.'], en: ['Connecting.', 'One moment.', 'Establishing link.', 'Link almost up.', 'In an instant.'] },
    pensando: { es: ['Analizando.', 'Un momento.', 'Procesando.', 'Evaluando.', 'Déjame analizarlo.'], en: ['Analyzing.', 'One moment.', 'Processing.', 'Evaluating.', 'Let me analyze it.'] },
    revisando: { es: ['Verificando.', 'Revisando datos.', 'Comprobando.', 'Confirmando.', 'Revisión en curso.'], en: ['Verifying.', 'Checking data.', 'Confirming.', 'Running a check.', 'Review in progress.'] },
    buscando: { es: ['Buscando.', 'Rastreando.', 'Consultando fuentes.', 'Búsqueda en curso.', 'Localizando.'], en: ['Searching.', 'Tracking it down.', 'Querying sources.', 'Search in progress.', 'Locating.'] },
    calculando: { es: ['Calculando.', 'Computando.', 'Haciendo el cálculo.', 'Midiendo.', 'Cifras en proceso.'], en: ['Calculating.', 'Computing.', 'Running the numbers.', 'Measuring.', 'Figures in progress.'] },
    abriendo: { es: ['Abriendo.', 'Enseguida.', 'En pantalla.', 'Hecho, abierto.', 'Accediendo.'], en: ['Opening.', 'Right away.', 'On screen.', 'Done, it’s open.', 'Accessing.'] },
    esperando_confirmacion: { es: ['¿Confirmas?', '¿Procedo?', 'Espero tu confirmación.', '¿Autorizas?', '¿Sí o no?'], en: ['Confirm?', 'Shall I proceed?', 'Awaiting your confirmation.', 'Do you authorize it?', 'Yes or no?'] },
    listo: { es: ['Hecho.', 'Completado.', 'Listo.', 'Terminado.', 'Confirmado.'], en: ['Done.', 'Completed.', 'All set.', 'Finished.', 'Confirmed.'] },
    no_pude: { es: ['No fue posible.', 'No se completó.', 'Falló el intento.', 'Sin éxito esta vez.', 'No pude completarlo.'], en: ['Not possible.', 'It didn’t complete.', 'The attempt failed.', 'No success this time.', 'I couldn’t complete it.'] },
    disculpa: { es: ['Perdón. Adelante.', 'Perdón, te escucho.', 'Perdón, continúa.', 'Perdón. Dime.', 'Me detengo, perdón.'], en: ['Sorry. Go ahead.', 'Sorry, I’m listening.', 'Sorry, continue.', 'Sorry. Tell me.', 'Stopping, sorry.'] },
    sorpresa: { es: ['Interesante.', 'Eso no lo esperaba.', 'Vaya.', 'Dato inesperado.', 'Curioso.'], en: ['Interesting.', 'I didn’t expect that.', 'Well.', 'Unexpected data.', 'Curious.'] },
    alegria: { es: ['Buena noticia.', 'Excelente.', 'Me alegra.', 'Muy bien.', 'Buen resultado.'], en: ['Good news.', 'Excellent.', 'Glad to hear it.', 'Very good.', 'Good result.'] },
    empatia: { es: ['Lo siento.', 'Entiendo.', 'Estoy aquí.', 'Vamos paso a paso.', 'Cuenta conmigo.'], en: ['I’m sorry.', 'I understand.', 'I’m here.', 'Step by step.', 'Count on me.'] },
    humor: { es: ['Je. Anotado.', 'Buena esa.', 'Registrado con humor.', 'Eso tiene gracia.', 'Sonrisa detectada.'], en: ['Heh. Noted.', 'Good one.', 'Logged, with humor.', 'That’s funny.', 'Smile detected.'] },
  },
  aura: {
    escuchando: { es: ['Aquí estoy, cuéntame.', 'Te escucho, dime.', 'Dime, que aquí estoy.'], en: ['I’m right here, tell me.', 'I’m listening, go on.', 'Tell me, I’m here.'] },
    conectando: { es: ['Ya voy, un segundito…', 'Ahorita estoy contigo…', 'Dame tantito…'], en: ['Coming, one sec…', 'With you in a moment…', 'Just a tiny bit…'] },
    pensando: { es: ['Déjame pensarlo tantito…', 'Mmm, dame un segundito…', 'A ver, a ver…'], en: ['Let me think a bit…', 'Hmm, one little second…', 'Let’s see, let’s see…'] },
    revisando: { es: ['Déjame revisar tantito…', 'Ya lo reviso…', 'Estoy viendo…'], en: ['Let me check real quick…', 'Checking it now…', 'I’m looking…'] },
    buscando: { es: ['Te lo busco ahorita…', 'Buscando, dame tantito…', 'Déjame ver qué encuentro…'], en: ['I’ll look it up now…', 'Searching, one sec…', 'Let me see what I find…'] },
    calculando: { es: ['Sacando cuentas…', 'Déjame hacer los números…', 'Calculo ahorita…'], en: ['Doing the math…', 'Let me run the numbers…', 'Calculating now…'] },
    abriendo: { es: ['Ya te lo abro.', 'Ahí te lo abro.', 'Va, enseguida.'], en: ['Opening it for you.', 'There, opening it.', 'Sure, right away.'] },
    esperando_confirmacion: { es: ['¿Lo hago?', '¿Te parece bien?', 'Dime y lo hago.'], en: ['Should I do it?', 'Is that okay?', 'Say the word and I’ll do it.'] },
    listo: { es: ['¡Listo!', '¡Ya quedó!', '¡Hecho, con gusto!'], en: ['Done!', 'All set!', 'Done, happy to help!'] },
    no_pude: { es: ['Ay, no me salió.', 'No pude esta vez, perdón.', 'Uy, no se pudo.'], en: ['Oh, it didn’t work.', 'I couldn’t this time, sorry.', 'Oops, no luck.'] },
    disculpa: { es: ['¡Ay, perdón! Dime.', 'Perdón, te escucho.', 'Perdón, perdón. Sigue.'], en: ['Oh, sorry! Tell me.', 'Sorry, I’m listening.', 'Sorry, sorry. Go on.'] },
    sorpresa: { es: ['¡Ay, no me digas!', '¡Uy, qué cosa!', '¿De veras?'], en: ['Oh, no way!', 'Oh, wow!', 'Really?'] },
    alegria: { es: ['¡Qué alegre me pone!', '¡Qué bonito!', '¡Me alegra mucho!'], en: ['That makes me so happy!', 'How lovely!', 'I’m so glad!'] },
    empatia: { es: ['Ay, cuánto lo siento.', 'Aquí estoy contigo.', 'Te entiendo, de verdad.'], en: ['Oh, I’m so sorry.', 'I’m here with you.', 'I really understand.'] },
    humor: { es: ['Jiji, qué risa.', '¡Ay, me hiciste reír!', 'Je, je, buenísima.'], en: ['Hehe, so funny.', 'Oh, you made me laugh!', 'Heh, that’s a good one.'] },
  },
  claudio: {
    escuchando: { es: ['Soy todo orejas… de zorro.', 'Cuéntame, que me interesa.', 'Te escucho, con las orejas paradas.'], en: ['All ears… fox ears.', 'Tell me, I’m curious.', 'Listening, ears up.'] },
    conectando: { es: ['Afinando el olfato…', 'Un segundo, me acomodo los lentes…', 'Ya casi, ya casi…'], en: ['Sharpening my nose…', 'One sec, fixing my glasses…', 'Almost, almost…'] },
    pensando: { es: ['Mmm, se me ocurre algo…', 'Déjame darle una vuelta…', 'Esto pide ideas…'], en: ['Hmm, I’ve got an idea…', 'Let me spin this around…', 'This calls for ideas…'] },
    revisando: { es: ['Olfateando los detalles…', 'Déjame revisar con lupa…', 'Reviso y te cuento…'], en: ['Sniffing out the details…', 'Let me check closely…', 'Checking, then I’ll tell you…'] },
    buscando: { es: ['Olfateando la respuesta…', 'Buscando la mejor pista…', 'Voy tras la pista…'], en: ['Sniffing out the answer…', 'Looking for the best lead…', 'On the trail…'] },
    calculando: { es: ['Números, mis viejos amigos…', 'Sacando cuentas con estilo…', 'Calculando, sin trampas…'], en: ['Numbers, my old friends…', 'Crunching numbers in style…', 'Calculating, no tricks…'] },
    abriendo: { es: ['¡Telón arriba!', 'Abriendo, con estilo.', 'Ahí va, en primera fila.'], en: ['Curtain up!', 'Opening, in style.', 'There it goes, front row.'] },
    esperando_confirmacion: { es: ['¿Le damos luz verde?', '¿Lo publicamos… digo, lo hago?', '¿Te gusta así?'], en: ['Green light?', 'Shall I… make it happen?', 'You like it?'] },
    listo: { es: ['¡Listo, y con estilo!', '¡Hecho! Quedó de portada.', '¡Misión cumplida!'], en: ['Done, and in style!', 'Done! Cover-worthy.', 'Mission accomplished!'] },
    no_pude: { es: ['Uy, esta se me escapó.', 'No salió, pero tengo un plan B.', 'Ni el zorro más listo… esta vez no.'], en: ['Oops, this one got away.', 'It didn’t work, but I have a plan B.', 'Not even the smartest fox… not this time.'] },
    disculpa: { es: ['¡Perdón! Te cedo el micrófono.', 'Perdón, tu turno.', 'Perdón, me emocioné.'], en: ['Sorry! The mic is yours.', 'Sorry, your turn.', 'Sorry, I got carried away.'] },
    sorpresa: { es: ['¡Eso es noticia!', '¡No me lo esperaba!', '¡Wow, titular!'], en: ['Now that’s news!', 'Didn’t see that coming!', 'Wow, headline!'] },
    alegria: { es: ['¡Eso merece un post!', '¡Me encanta, de verdad!', '¡Qué buena vibra!'], en: ['That deserves a post!', 'I really love it!', 'Such good vibes!'] },
    empatia: { es: ['Lo siento mucho. Aquí estoy.', 'Eso duele, te entiendo.', 'Vamos juntos, paso a paso.'], en: ['I’m so sorry. I’m here.', 'That hurts, I get it.', 'We’ll go together, step by step.'] },
    humor: { es: ['Jaja, ¡esa me la robo!', 'Buenísima, la guardo para un post.', 'Je, je, tienes chispa.'], en: ['Haha, I’m stealing that!', 'Great one, saving it for a post.', 'Heh, you’re witty.'] },
  },
  antonio: {
    escuchando: { es: ['¡Dime, dime!', 'Cuatro brazos listos, te escucho.', 'Aquí estoy, ¿qué resolvemos?'], en: ['Tell me, tell me!', 'Four arms ready, I’m listening.', 'Here I am, what are we solving?'] },
    conectando: { es: ['Arrancando motores…', 'Un segundito, me pongo los lentes…', 'Ya casi, organizando…'], en: ['Starting engines…', 'One sec, glasses on…', 'Almost, organizing…'] },
    pensando: { es: ['Pensando con las cuatro manos…', 'Armando el plan…', 'Déjame organizarlo…'], en: ['Thinking with all four hands…', 'Putting a plan together…', 'Let me organize it…'] },
    revisando: { es: ['Revisando, un brazo por pestaña…', 'Chequeando todo…', 'Déjame revisar punto por punto…'], en: ['Checking, one arm per tab…', 'Checking everything…', 'Let me go point by point…'] },
    buscando: { es: ['¡A buscar!', 'Buscando con las cuatro manos…', 'Rastreando, ya casi…'], en: ['Let’s search!', 'Searching with all four hands…', 'Tracking it, almost…'] },
    calculando: { es: ['Calculando a mil…', 'Números en marcha…', 'Déjame sacar la cuenta rapidito…'], en: ['Calculating at full speed…', 'Numbers in motion…', 'Let me work it out quick…'] },
    abriendo: { es: ['¡Abriendo!', 'Ahí va, rapidito.', 'Listo el acceso.'], en: ['Opening!', 'There it goes, quick.', 'Access ready.'] },
    esperando_confirmacion: { es: ['¿Le damos?', '¿Lo ejecuto?', 'Dame el sí y lo hago.'], en: ['Shall we?', 'Should I run it?', 'Give me the yes and I’ll do it.'] },
    listo: { es: ['¡Hecho y organizado!', '¡Resuelto!', '¡Listo! ¿Qué sigue?'], en: ['Done and organized!', 'Solved!', 'Done! What’s next?'] },
    no_pude: { es: ['Uy, se me trabó. ¿Otra vez?', 'No salió, busco otra forma.', 'Ni con cuatro brazos, perdón.'], en: ['Oops, it got stuck. Again?', 'It didn’t work, I’ll find another way.', 'Not even with four arms, sorry.'] },
    disculpa: { es: ['¡Perdón! Te escucho.', 'Perdón, freno de mano.', 'Perdón, dime tú.'], en: ['Sorry! I’m listening.', 'Sorry, hitting the brakes.', 'Sorry, you tell me.'] },
    sorpresa: { es: ['¡Púchica!', '¡No puede ser!', '¡Eso sí que no me lo esperaba!'], en: ['Whoa!', 'No way!', 'Did not see that coming!'] },
    alegria: { es: ['¡Eso! ¡Así se hace!', '¡Qué buena!', '¡Me alegra un montón!'], en: ['Yes! That’s how it’s done!', 'Great one!', 'That makes me so happy!'] },
    empatia: { es: ['Lo siento. Vamos a resolverlo.', 'Te entiendo, aquí estoy.', 'Con calma, paso por paso.'], en: ['I’m sorry. Let’s sort it out.', 'I get it, I’m here.', 'Easy, step by step.'] },
    humor: { es: ['Jaja, me hiciste reír con los cuatro brazos.', '¡Esa estuvo buena!', 'Je, je, qué ocurrencia.'], en: ['Haha, all four arms are laughing.', 'That was a good one!', 'Heh, what an idea.'] },
  },
};

/** Todas las frases de un estado para un avatar e idioma (sin repetidas, las propias primero). */
export function frasesDe(estado: EstadoFrase, avatar: AvatarFrase = 'aura', idioma: IdiomaFrase = 'es'): string[] {
  const propias = PROPIAS[avatar]?.[estado]?.[idioma] || [];
  const base = avatar === 'ojos' && propias.length ? [] : BASE[estado][idioma];
  return [...new Set([...propias, ...base])];
}

/**
 * Lo que se dijo hace poco, para no repetir: las últimas de cada estado (hasta 4, o las que haya menos
 * una) y la última de todas (que no salga la misma aunque cambie el estado).
 */
export class MemoriaFrases {
  private recientes = new Map<string, string[]>();
  private ultima = '';
  elegir(opciones: readonly string[], clave: string, azar: () => number = Math.random): string {
    if (!opciones.length) return '';
    const antes = this.recientes.get(clave) || [];
    const tope = Math.min(4, opciones.length - 1);
    const sinUltima = opciones.filter((o) => o !== this.ultima);
    const libres = sinUltima.filter((o) => !antes.includes(o));
    const pool = libres.length ? libres : sinUltima.length ? sinUltima : [...opciones];
    const elegida = pool[Math.floor(azar() * pool.length) % pool.length];
    this.recientes.set(clave, tope > 0 ? [...antes, elegida].slice(-tope) : []);
    this.ultima = elegida;
    return elegida;
  }
  olvidar() {
    this.recientes.clear();
    this.ultima = '';
  }
}

const memoria = new MemoriaFrases();

export type FraseDeEstado = { texto: string; estado: EstadoFrase; expresion: ExpresionAvatar; emocion: EmocionFrase; cara: CaraFrase };

/**
 * UNA frase para el estado, con la personalidad del avatar y en su idioma, que no repite las
 * últimas, y la emoción con que se dice (cara del avatar, emoción de voz, cara de la mesa).
 */
export function fraseDeEstado(
  estado: EstadoFrase,
  avatar: AvatarFrase = 'aura',
  idioma: IdiomaFrase = 'es',
  o: { azar?: () => number; memoria?: MemoriaFrases } = {}
): FraseDeEstado {
  const a: AvatarFrase = avatar in PROPIAS ? avatar : 'aura';
  const i: IdiomaFrase = idioma === 'en' ? 'en' : 'es';
  const texto = (o.memoria || memoria).elegir(frasesDe(estado, a, i), `${estado}|${a}|${i}`, o.azar);
  return { texto, estado, ...EMOCION_DE_ESTADO[estado] };
}

/**
 * ¿En qué estado se espera esta pregunta? Para el puente de voz: «busca…», «¿a cómo está…?» es buscar;
 * «calcula…», «¿cuánto es…?», es calcular; «revisa…», «¿qué dice el expediente…?», revisar; lo demás,
 * pensar.
 */
export function estadoDeEspera(pregunta: string): EstadoFrase {
  const q = String(pregunta || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/\b(calcula|calcular|cuanto (es|son|da|sale)|convierte|convert|how much is|calculate|porcentaje|percent|suma|multiplica|divide)\b|\d+\s*[x*/+-]\s*\d+/.test(q)) return 'calculando';
  if (/\b(busca|buscame|internet|google|noticias|precio|cotiza|clima|search|look up|news|price|weather|averigua|investiga)\b/.test(q)) return 'buscando';
  if (/\b(revisa|revisar|verifica|confirma|expediente|documento|contrato|check|verify|review|pendientes|tareas|agenda)\b/.test(q)) return 'revisando';
  return 'pensando';
}

// Lo que se dice mientras se espera: si el cerebro EMPIEZA su respuesta con una de estas (o con una
// muletilla de espera cualquiera), sobra: ya se dijo. Se compara sin tildes, signos ni mayúsculas.
const ESPERA: EstadoFrase[] = ['escuchando', 'conectando', 'pensando', 'revisando', 'buscando', 'calculando'];
const plano = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const DE_ESPERA = new Set<string>();
for (const e of ESPERA) for (const a of ['ojos', 'aura', 'claudio', 'antonio'] as const) for (const i of ['es', 'en'] as const) for (const f of frasesDe(e, a, i)) DE_ESPERA.add(plano(f));
const RE_MULETILLA =
  /^(mmm+|hmm+|eh+|este|bueno|a ver( a ver)?|dejame (ver|pensar|pensarlo|revisar|buscar|checar)( un (momento|segundo|segundito))?|un (momento|segundo|segundito|momentito)|dame un (segundo|segundito|momento)|ya (casi|te digo)|let me (see|think|check|look)|one (moment|sec|second)|give me a (sec|second|moment)|hold on|just a (sec|second|moment))( (y|and|que|so))?$/;

/** ¿Este pedazo es SOLO una muletilla de espera (del banco o de las de siempre)? */
export function esRelleno(texto: string): boolean {
  const p = plano(texto);
  if (!p) return false;
  if (DE_ESPERA.has(p) || RE_MULETILLA.test(p)) return true;
  // «Mmm, déjame ver.»: cada pedazo es una muletilla.
  const partes = String(texto || '')
    .split(/[,.;:…!?]+/)
    .map(plano)
    .filter(Boolean);
  return partes.length > 1 && partes.every((x) => DE_ESPERA.has(x) || RE_MULETILLA.test(x));
}

/** Quita del principio de una respuesta la frase de espera que sobra («Mmm, déjame ver. El oro…» → «El oro…»). */
export function quitarRellenoInicial(texto: string): string {
  let t = String(texto || '');
  for (let vueltas = 0; vueltas < 3; vueltas++) {
    const m = /^\s*([^.!?…,]{1,60})([.!?…]+|,)(\s+|$)/.exec(t);
    if (!m || !esRelleno(m[1])) break;
    t = t.slice(m[0].length);
  }
  return t === String(texto || '') ? t : t.charAt(0).toUpperCase() + t.slice(1);
}
