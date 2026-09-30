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
 *
 * LAS TAREAS (José: «muchísimas para que suene humano siempre… para diferentes acciones»): los estados
 * de espera (pensando, revisando, buscando, calculando, abriendo, leyendo, mirando y el seguimiento
 * «ya casi…») tienen de 15 a 25 frases por avatar e idioma. `TAREAS` dice, por cada herramienta del
 * turno, en qué estado se espera, qué sonido de fondo pone el teléfono y si siempre es lenta; y
 * `vozDeEspera` le pone a veces una etiqueta de audio de la voz v4 (comprobado abajo) solo a lo que se
 * DICE, nunca al banco ni al globito.
 */
import type { ExpresionAvatar } from '../avatar3d/tipos';

/**
 * Cuánto se espera al cerebro antes de decir una frase de espera («déjame ver», «pensando…»), en la
 * voz y en el globito: la mesa, la compañera y el puente de voz del servidor usan el mismo número.
 * José: «el "déjame ver" solo si lleva bastante tiempo o toma mucho pensar; no se siente conversación
 * fluida». Antes: 0,7 s en la mesa (y la respuesta esperaba a que el relleno terminara de sonar),
 * 1,2 s en el puente y al instante en el globito. Una charla o una orden rápida contestan antes y no
 * lo oyen nunca.
 */
export const ESPERA_FRASE_MS = 2_500;

export const ESTADOS_FRASE = [
  'escuchando',
  'conectando',
  'pensando',
  'revisando',
  'buscando',
  'calculando',
  'abriendo',
  /** Leyendo una página, un PDF o un documento. */
  'leyendo',
  /** Mirando por la cámara o una imagen. */
  'mirando',
  /** La tarea sigue tardando: «ya casi lo tengo…» (la segunda frase de una espera larga). */
  'seguimiento',
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
  leyendo: { expresion: 'piensa', emocion: 'pensando', cara: 'SCAN' },
  mirando: { expresion: 'piensa', emocion: 'curioso', cara: 'CURIOUS' },
  seguimiento: { expresion: 'piensa', emocion: 'pensando', cara: 'THINKING' },
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
    es: [
      'Déjame pensarlo…', 'Mmm, a ver…', 'Dame un segundo…', 'Estoy pensando…', 'Buena pregunta, a ver…', 'Déjame ver…',
      'Déjame darle una pensada…', 'Un momentito, lo pienso…', 'Déjame acomodar las ideas…', 'Mmm, interesante… déjame ver.',
      'Dame chance de pensarlo…', 'A ver cómo te lo explico…', 'Pensando, pensando…', 'Buena esa, déjame pensar…',
    ],
    en: [
      'Let me think…', 'Hmm, let’s see…', 'Give me a second…', 'Thinking…', 'Good question, let’s see…', 'Let me see…',
      'Let me mull it over…', 'One moment, thinking…', 'Let me sort my thoughts…', 'Hmm, interesting… let me see.',
      'Give me a moment to think…', 'Let me figure out how to say it…', 'Thinking, thinking…', 'Good one, let me think…',
    ],
  },
  revisando: {
    es: [
      'Estoy revisando…', 'Déjame revisar…', 'Lo reviso ahorita…', 'Revisando lo que hay…', 'Voy a confirmarlo…', 'Déjame confirmar…',
      'Déjame chequearlo…', 'Voy a echarle un ojo…', 'Revisando con calma…', 'Déjame ver bien…', 'Lo estoy verificando…',
      'Un momento, lo reviso…', 'Revisando los detalles…', 'Déjame asegurarme…',
    ],
    en: [
      'Checking…', 'Let me check…', 'Looking into it…', 'Going over it…', 'Let me confirm…', 'Double-checking…',
      'Let me double-check…', 'Taking a look…', 'Checking carefully…', 'Let me look closely…', 'Verifying it…',
      'One moment, checking…', 'Going over the details…', 'Let me make sure…',
    ],
  },
  buscando: {
    es: [
      'Déjame buscarlo…', 'Lo estoy buscando…', 'Buscando…', 'Ya lo busco…', 'Voy a averiguar…', 'A ver qué encuentro…',
      'Buscando en internet…', 'Déjame investigar tantito…', 'Voy a ver qué dice la red…', 'Consultando…', 'Rastreando la info…',
      'Ya estoy buscando…', 'Déjame ver qué hay…', 'Buscando lo más reciente…',
    ],
    en: [
      'Let me look it up…', 'Searching…', 'Looking for it…', 'On it, searching…', 'Let me find out…', 'Let’s see what I find…',
      'Searching online…', 'Let me dig a little…', 'Let me see what the web says…', 'Looking it up…', 'Tracking down the info…',
      'Already searching…', 'Let me see what’s out there…', 'Finding the latest…',
    ],
  },
  calculando: {
    es: [
      'Sacando cuentas…', 'Déjame calcular…', 'Haciendo los números…', 'Un segundo, calculo…', 'Calculando…',
      'Déjame sacar la cuenta…', 'Números, números…', 'Haciendo cuentas…', 'Calculo y te digo…', 'Déjame hacer la operación…',
      'Sumando y restando…', 'Un momento, saco cuentas…', 'Cuadrando números…', 'Déjame revisar los números…',
    ],
    en: [
      'Crunching numbers…', 'Let me calculate…', 'Doing the math…', 'One sec, calculating…', 'Calculating…',
      'Let me work it out…', 'Numbers, numbers…', 'Adding it up…', 'I’ll calculate and tell you…', 'Let me run the math…',
      'Adding and subtracting…', 'One moment, doing the math…', 'Balancing the numbers…', 'Let me check the numbers…',
    ],
  },
  abriendo: {
    es: [
      'Ya lo abro.', 'Abriendo…', 'Va, lo abro.', 'Enseguida.', 'Ahí te va.',
      'Ya voy.', 'Abriendo, un segundo…', 'Déjame abrirlo.', 'Cargando…', 'Va, ahorita lo abro.', 'Ahí va.',
      'Lo abro de una vez.', 'Enseguida lo tienes.', 'Preparándolo…',
    ],
    en: [
      'Opening it.', 'Opening…', 'Sure, opening it.', 'Right away.', 'Here it comes.',
      'On my way.', 'Opening, one sec…', 'Let me open it.', 'Loading…', 'Sure, opening it now.', 'There it goes.',
      'Opening it right now.', 'You’ll have it in a sec.', 'Getting it ready…',
    ],
  },
  leyendo: {
    es: [
      'Déjame leerlo…', 'Leyendo…', 'Lo estoy leyendo…', 'Déjame echarle una leída…', 'Leyendo con calma…', 'Voy leyendo…',
      'Déjame ver qué dice…', 'Hojeando el documento…', 'Leyendo la página…', 'Un momento, lo leo…', 'Déjame leer bien…',
      'Revisando lo que dice…', 'Leyendo el texto…', 'Pasando las páginas…',
    ],
    en: [
      'Let me read it…', 'Reading…', 'I’m reading it…', 'Let me give it a read…', 'Reading carefully…', 'Reading through…',
      'Let me see what it says…', 'Skimming the document…', 'Reading the page…', 'One moment, reading it…', 'Let me read it properly…',
      'Going over what it says…', 'Reading the text…', 'Flipping through the pages…',
    ],
  },
  mirando: {
    es: [
      'Déjame mirar…', 'Mirando…', 'A ver qué veo…', 'Déjame enfocar…', 'Estoy mirando…', 'Déjame ver bien la imagen…',
      'Mirando con cuidado…', 'Un momento, observo…', 'A ver, a ver qué hay…', 'Enfocando…', 'Déjame fijarme…',
      'Observando…', 'Viendo qué hay…', 'Déjame acercarme…',
    ],
    en: [
      'Let me look…', 'Looking…', 'Let’s see what I see…', 'Let me focus…', 'I’m looking…', 'Let me see the image…',
      'Looking carefully…', 'One moment, observing…', 'Let’s see what’s there…', 'Focusing…', 'Let me take a look…',
      'Observing…', 'Seeing what’s there…', 'Let me zoom in…',
    ],
  },
  seguimiento: {
    es: [
      'Ya casi lo tengo…', 'Un poquito más…', 'Sigo en eso…', 'Ya mero…', 'Falta poquito…', 'Está tardando un poco, ya casi…',
      'Aguántame tantito…', 'Ya casi termino…', 'Dame un ratito más…', 'Casi, casi…', 'Ahí va saliendo…',
      'Perdón la espera, ya casi…', 'Un momentito más…', 'Sigo aquí, ya casi…',
    ],
    en: [
      'Almost got it…', 'Just a bit more…', 'Still on it…', 'Nearly there…', 'Not much longer…', 'It’s taking a bit, almost…',
      'Bear with me a sec…', 'Almost done…', 'Give me a little longer…', 'Almost, almost…', 'It’s coming together…',
      'Sorry for the wait, almost…', 'Just one more moment…', 'Still here, almost there…',
    ],
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
    pensando: {
      es: ['Analizando.', 'Un momento.', 'Procesando.', 'Evaluando.', 'Déjame analizarlo.', 'Considerando opciones.', 'Lo estoy evaluando.', 'Un instante.', 'Ponderando.', 'Razonando.', 'Ordenando datos.', 'Pensándolo.', 'Evaluando escenarios.', 'Análisis en curso.', 'Dame un instante.', 'Sopesando.', 'Lo analizo.'],
      en: ['Analyzing.', 'One moment.', 'Processing.', 'Evaluating.', 'Let me analyze it.', 'Weighing options.', 'Evaluating it now.', 'One instant.', 'Considering.', 'Reasoning it through.', 'Sorting the data.', 'Thinking it over.', 'Evaluating scenarios.', 'Analysis underway.', 'Give me an instant.', 'Weighing it.', 'Analyzing it.'],
    },
    revisando: {
      es: ['Verificando.', 'Revisando datos.', 'Comprobando.', 'Confirmando.', 'Revisión en curso.', 'Contrastando datos.', 'Cotejando.', 'Revisando registros.', 'Verificando fuentes.', 'Chequeo en curso.', 'Validando.', 'Lo verifico.', 'Revisando detalles.', 'Examinando.', 'Auditando datos.', 'Comprobando cifras.', 'Un momento, verifico.'],
      en: ['Verifying.', 'Checking data.', 'Confirming.', 'Running a check.', 'Review in progress.', 'Cross-checking.', 'Comparing records.', 'Reviewing records.', 'Verifying sources.', 'Check underway.', 'Validating.', 'Verifying it.', 'Reviewing details.', 'Examining.', 'Auditing data.', 'Checking figures.', 'One moment, verifying.'],
    },
    buscando: {
      es: ['Buscando.', 'Rastreando.', 'Consultando fuentes.', 'Búsqueda en curso.', 'Localizando.', 'Consultando la red.', 'Explorando fuentes.', 'Barrido en curso.', 'Buscando en la red.', 'Recopilando datos.', 'Filtrando resultados.', 'Siguiendo la pista.', 'Consultando.', 'Indagando.', 'Localizando fuentes.', 'Rastreo en curso.', 'Buscando datos.'],
      en: ['Searching.', 'Tracking it down.', 'Querying sources.', 'Search in progress.', 'Locating.', 'Querying the web.', 'Exploring sources.', 'Sweep underway.', 'Searching the web.', 'Gathering data.', 'Filtering results.', 'Following the trail.', 'Querying.', 'Investigating.', 'Locating sources.', 'Trace underway.', 'Searching for data.'],
    },
    calculando: {
      es: ['Calculando.', 'Computando.', 'Haciendo el cálculo.', 'Midiendo.', 'Cifras en proceso.', 'Cuantificando.', 'Estimando.', 'Operando cifras.', 'Cálculo en curso.', 'Proyectando.', 'Sumando datos.', 'Resolviendo.', 'Calculando valores.', 'Procesando cifras.', 'Ajustando números.', 'Midiendo cantidades.', 'Un momento, calculo.'],
      en: ['Calculating.', 'Computing.', 'Running the numbers.', 'Measuring.', 'Figures in progress.', 'Quantifying.', 'Estimating.', 'Working the figures.', 'Calculation underway.', 'Projecting.', 'Adding it up.', 'Solving.', 'Calculating values.', 'Processing figures.', 'Adjusting numbers.', 'Measuring amounts.', 'One moment, calculating.'],
    },
    abriendo: {
      es: ['Abriendo.', 'Enseguida.', 'En pantalla.', 'Hecho, abierto.', 'Accediendo.', 'Cargando.', 'Accediendo ahora.', 'Desplegando.', 'Iniciando.', 'Abriendo acceso.', 'Preparando vista.', 'En curso.', 'Ejecutando.', 'Mostrando.', 'Cargando vista.', 'Abierto en breve.', 'Un instante, abro.'],
      en: ['Opening.', 'Right away.', 'On screen.', 'Done, it’s open.', 'Accessing.', 'Loading.', 'Accessing now.', 'Deploying view.', 'Starting.', 'Opening access.', 'Preparing view.', 'In progress.', 'Executing.', 'Displaying.', 'Loading view.', 'Open shortly.', 'One instant, opening.'],
    },
    leyendo: {
      es: ['Leyendo.', 'Leyendo el documento.', 'Extrayendo datos.', 'Revisando el texto.', 'Lectura en curso.', 'Analizando el documento.', 'Procesando páginas.', 'Leyendo con atención.', 'Escaneando el texto.', 'Extrayendo lo clave.', 'Revisando páginas.', 'Leo y resumo.', 'Leyendo la fuente.', 'Examinando el texto.', 'Documento en análisis.', 'Leyendo cláusulas.'],
      en: ['Reading.', 'Reading the document.', 'Extracting data.', 'Reviewing the text.', 'Reading underway.', 'Analyzing the document.', 'Processing pages.', 'Reading closely.', 'Scanning the text.', 'Extracting key points.', 'Reviewing pages.', 'Reading, then summarizing.', 'Reading the source.', 'Examining the text.', 'Document under analysis.', 'Reading the clauses.'],
    },
    mirando: {
      es: ['Observando.', 'Mirando.', 'Analizando la imagen.', 'Enfocando.', 'Escaneando.', 'Procesando la imagen.', 'Observando con atención.', 'Identificando.', 'Revisando la imagen.', 'Enfoque en curso.', 'Analizando la escena.', 'Detectando.', 'Mirando de cerca.', 'Reconociendo.', 'Ajustando enfoque.', 'Examinando la vista.'],
      en: ['Observing.', 'Looking.', 'Analyzing the image.', 'Focusing.', 'Scanning.', 'Processing the image.', 'Observing closely.', 'Identifying.', 'Reviewing the image.', 'Focus underway.', 'Analyzing the scene.', 'Detecting.', 'Looking closely.', 'Recognizing.', 'Adjusting focus.', 'Examining the view.'],
    },
    seguimiento: {
      es: ['Casi listo.', 'Un poco más.', 'Sigo en ello.', 'Falta poco.', 'En proceso aún.', 'Casi completo.', 'Terminando.', 'Últimos detalles.', 'Ya casi.', 'Sigo trabajando.', 'Un momento más.', 'Afinando resultado.', 'Cerrando el análisis.', 'Tarda más de lo usual.', 'Casi termino.', 'Resultado en breve.'],
      en: ['Almost done.', 'A bit more.', 'Still on it.', 'Nearly there.', 'Still processing.', 'Almost complete.', 'Finishing.', 'Final details.', 'Almost.', 'Still working.', 'One more moment.', 'Refining the result.', 'Closing the analysis.', 'Taking longer than usual.', 'Nearly finished.', 'Result shortly.'],
    },
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
    pensando: {
      es: ['Déjame pensarlo tantito…', 'Mmm, dame un segundito…', 'A ver, a ver…', 'Ay, buena pregunta… déjame ver.', 'Fíjate que… déjame pensar.', 'Dame chancecito…', 'Mmm, ahorita te digo…', 'Déjame pensarlo bonito…'],
      en: ['Let me think a bit…', 'Hmm, one little second…', 'Let’s see, let’s see…', 'Oh, good question… let me see.', 'You know what… let me think.', 'Give me a tiny moment…', 'Hmm, I’ll tell you in a sec…', 'Let me think it through nicely…'],
    },
    revisando: {
      es: ['Déjame revisar tantito…', 'Ya lo reviso…', 'Estoy viendo…', 'Ahorita lo reviso…', 'Déjame chequearlo bien…', 'Lo reviso con cariño…', 'Viendo que todo esté bien…', 'Déjame confirmarlo tantito…'],
      en: ['Let me check real quick…', 'Checking it now…', 'I’m looking…', 'Checking it right now…', 'Let me check it properly…', 'Checking it with care…', 'Making sure it’s all good…', 'Let me confirm real quick…'],
    },
    buscando: {
      es: ['Te lo busco ahorita…', 'Buscando, dame tantito…', 'Déjame ver qué encuentro…', 'Ahorita te lo averiguo…', 'Buscando en internet, ya voy…', 'Déjame buscarte eso…', 'Voy a ver qué dicen por ahí…', 'Te lo investigo tantito…'],
      en: ['I’ll look it up now…', 'Searching, one sec…', 'Let me see what I find…', 'I’ll find out for you…', 'Searching online, coming…', 'Let me look that up for you…', 'Let me see what they say out there…', 'I’ll dig into it a bit…'],
    },
    calculando: {
      es: ['Sacando cuentas…', 'Déjame hacer los números…', 'Calculo ahorita…', 'Ahorita saco la cuenta…', 'Déjame sumar tantito…', 'Números van, números vienen…', 'Haciendo la cuentita…', 'Ya casi tengo el número…'],
      en: ['Doing the math…', 'Let me run the numbers…', 'Calculating now…', 'I’ll work it out now…', 'Let me add it up a bit…', 'Numbers here, numbers there…', 'Doing a quick count…', 'Almost have the number…'],
    },
    abriendo: {
      es: ['Ya te lo abro.', 'Ahí te lo abro.', 'Va, enseguida.', 'Ahorita te lo abro.', 'Con gusto, lo abro.', 'Ya está abriendo…', 'Te lo pongo enseguida.', 'Va pues, lo abro.'],
      en: ['Opening it for you.', 'There, opening it.', 'Sure, right away.', 'Opening it for you now.', 'Happy to, opening it.', 'It’s opening…', 'Putting it up now.', 'Alright, opening it.'],
    },
    leyendo: {
      es: ['Déjame leértelo tantito…', 'Ahorita lo leo…', 'Leyendo con cariño…', 'Déjame ver qué dice aquí…', 'Lo voy leyendo, ya casi…', 'Hojeando tantito…', 'Leyendo despacito…', 'Déjame leerlo bien…'],
      en: ['Let me read it for you…', 'Reading it now…', 'Reading it with care…', 'Let me see what it says here…', 'Reading through, almost…', 'Skimming a little…', 'Reading slowly…', 'Let me read it well…'],
    },
    mirando: {
      es: ['Déjame verte bien…', 'A ver qué tienes ahí…', 'Mirando tantito…', 'Déjame fijarme bien…', 'Ahorita te digo qué veo…', 'Enfocando, dame tantito…', 'Viendo con calma…', 'Déjame mirar bonito…'],
      en: ['Let me see you properly…', 'Let’s see what you have there…', 'Looking a little…', 'Let me look closely…', 'I’ll tell you what I see…', 'Focusing, one sec…', 'Looking calmly…', 'Let me take a good look…'],
    },
    seguimiento: {
      es: ['Ya casi, no me olvido…', 'Aguántame tantito más…', 'Ahorita sale, ya casi…', 'Perdón que tarde, ya mero…', 'Casi lo tengo, de veras…', 'Sigo aquí contigo, ya casi…', 'Un ratito más y listo…', 'Ya viene, ya viene…'],
      en: ['Almost, I haven’t forgotten…', 'Bear with me a little more…', 'It’s coming, almost…', 'Sorry it’s slow, nearly…', 'Almost have it, really…', 'Still here with you, almost…', 'A little longer and done…', 'Here it comes, here it comes…'],
    },
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
    pensando: {
      es: ['Mmm, se me ocurre algo…', 'Déjame darle una vuelta…', 'Esto pide ideas…', 'Mis orejas de zorro están pensando…', 'Déjame afilar la idea…', 'Interesante… déjame pensar.', 'Esto merece neuronas extra…', 'Se me prende el foco…'],
      en: ['Hmm, I’ve got an idea…', 'Let me spin this around…', 'This calls for ideas…', 'My fox ears are thinking…', 'Let me sharpen the idea…', 'Interesting… let me think.', 'This deserves extra brain cells…', 'A light bulb is turning on…'],
    },
    revisando: {
      es: ['Olfateando los detalles…', 'Déjame revisar con lupa…', 'Reviso y te cuento…', 'Lupa en mano, revisando…', 'Nada se le escapa a este zorro…', 'Revisando letra por letra…', 'Déjame olfatear bien…', 'Modo detective: revisando…'],
      en: ['Sniffing out the details…', 'Let me check closely…', 'Checking, then I’ll tell you…', 'Magnifier in hand, checking…', 'Nothing escapes this fox…', 'Checking letter by letter…', 'Let me sniff it out properly…', 'Detective mode: checking…'],
    },
    buscando: {
      es: ['Olfateando la respuesta…', 'Buscando la mejor pista…', 'Voy tras la pista…', 'Olfateando internet…', 'Tecleando como zorro veloz…', 'Siguiendo el rastro en la red…', 'A ver qué huele interesante…', 'Cazando el dato…'],
      en: ['Sniffing out the answer…', 'Looking for the best lead…', 'On the trail…', 'Sniffing around the web…', 'Typing like a quick fox…', 'Following the trail online…', 'Let’s see what smells interesting…', 'Hunting down the data…'],
    },
    calculando: {
      es: ['Números, mis viejos amigos…', 'Sacando cuentas con estilo…', 'Calculando, sin trampas…', 'Lápiz de zorro en acción…', 'Déjame domar estos números…', 'Contando con la cola…', 'Matemática con estilo…', 'Las cifras no se me escapan…'],
      en: ['Numbers, my old friends…', 'Crunching numbers in style…', 'Calculating, no tricks…', 'Fox pencil in action…', 'Let me tame these numbers…', 'Counting with my tail…', 'Math, with style…', 'No figure escapes me…'],
    },
    abriendo: {
      es: ['¡Telón arriba!', 'Abriendo, con estilo.', 'Ahí va, en primera fila.', '¡Y se abre el telón!', 'Pasen adelante, abriendo.', 'Abriendo, como buen anfitrión.', 'Con una reverencia, lo abro.', '¡Tarán! Abriendo.'],
      en: ['Curtain up!', 'Opening, in style.', 'There it goes, front row.', 'And the curtain rises!', 'Step right in, opening.', 'Opening, like a good host.', 'With a bow, opening it.', 'Ta-da! Opening.'],
    },
    leyendo: {
      es: ['Leyendo con mis lentes de zorro…', 'Devorando el documento…', 'Hojeando con estilo…', 'Leyendo entre líneas…', 'Esto se lee interesante…', 'Pasando páginas, olfateando…', 'Letra chiquita, no te me escapas…', 'Lectura rápida de zorro…'],
      en: ['Reading with my fox glasses…', 'Devouring the document…', 'Skimming in style…', 'Reading between the lines…', 'This reads interesting…', 'Flipping pages, sniffing…', 'Fine print, you won’t escape…', 'Speed-reading, fox style…'],
    },
    mirando: {
      es: ['Ojos de zorro enfocando…', 'A ver qué me enseñas…', 'Mirando con lupa…', 'Esto se ve interesante…', 'Enfocando la mirada…', 'Déjame ver ese detalle…', 'Olfato y vista en acción…', 'Mirando como fotógrafo…'],
      en: ['Fox eyes focusing…', 'Let’s see what you’re showing me…', 'Looking with a magnifier…', 'This looks interesting…', 'Focusing my gaze…', 'Let me see that detail…', 'Nose and eyes in action…', 'Looking like a photographer…'],
    },
    seguimiento: {
      es: ['La pista está caliente, ya casi…', 'Este dato se hace el difícil…', 'Ya casi lo atrapo…', 'Paciencia de zorro, ya casi…', 'Buen material, ya casi lo tengo…', 'Un momentito más, vale la pena…', 'Se está poniendo bueno, ya casi…', 'Casi lo huelo…'],
      en: ['The trail is hot, almost…', 'This one’s playing hard to get…', 'Almost caught it…', 'Fox patience, almost there…', 'Good stuff, almost have it…', 'One more moment, worth it…', 'It’s getting good, almost…', 'I can almost smell it…'],
    },
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
    pensando: {
      es: ['Pensando con las cuatro manos…', 'Armando el plan…', 'Déjame organizarlo…', '¡Engranes a mil!', 'Cuatro brazos, una idea…', 'Organizando las ideas…', 'Déjame armarlo rapidito…', 'Pensando en modo hormiga…'],
      en: ['Thinking with all four hands…', 'Putting a plan together…', 'Let me organize it…', 'Gears at full speed!', 'Four arms, one idea…', 'Organizing the ideas…', 'Let me put it together quick…', 'Thinking in ant mode…'],
    },
    revisando: {
      es: ['Revisando, un brazo por pestaña…', 'Chequeando todo…', 'Déjame revisar punto por punto…', 'Cuatro ojos… digo, brazos, revisando…', 'Revisando la lista, ¡va!', 'Todo en orden, revisando…', 'Chequeo rapidito…', 'Punto por punto, ¡vamos!'],
      en: ['Checking, one arm per tab…', 'Checking everything…', 'Let me go point by point…', 'Four eyes… I mean arms, checking…', 'Checking the list, go!', 'All in order, checking…', 'Quick check…', 'Point by point, let’s go!'],
    },
    buscando: {
      es: ['¡A buscar!', 'Buscando con las cuatro manos…', 'Rastreando, ya casi…', '¡Tecleando con los cuatro brazos!', 'Buscando en internet, ¡va!', 'Rastreando como hormiga…', 'A la caza del dato…', 'Buscando rapidito…'],
      en: ['Let’s search!', 'Searching with all four hands…', 'Tracking it, almost…', 'Typing with all four arms!', 'Searching online, go!', 'Tracking like an ant…', 'On the hunt for data…', 'Searching real quick…'],
    },
    calculando: {
      es: ['Calculando a mil…', 'Números en marcha…', 'Déjame sacar la cuenta rapidito…', 'Una mano suma, otra resta…', 'Calculadora en marcha…', 'Cuatro manos, cero errores…', 'Sacando números, ¡va!', 'Cuadrando todo rapidito…'],
      en: ['Calculating at full speed…', 'Numbers in motion…', 'Let me work it out quick…', 'One hand adds, one subtracts…', 'Calculator running…', 'Four hands, zero errors…', 'Crunching numbers, go!', 'Balancing it all quick…'],
    },
    abriendo: {
      es: ['¡Abriendo!', 'Ahí va, rapidito.', 'Listo el acceso.', '¡Va, abriendo!', 'Abriendo con un brazo libre.', 'En un dos por tres.', '¡Abierto en nada!', 'Ahí te lo pongo, ¡va!'],
      en: ['Opening!', 'There it goes, quick.', 'Access ready.', 'Okay, opening!', 'Opening with a spare arm.', 'In a flash.', 'Open in no time!', 'Putting it up for you, go!'],
    },
    leyendo: {
      es: ['Leyendo con dos brazos, anotando con dos…', 'Hojeando a toda máquina…', 'Leyendo rapidito…', 'Página por página, ¡va!', 'Leyendo y organizando…', 'Pasando hojas a mil…', 'Lectura en marcha…', 'Subrayando lo importante…'],
      en: ['Reading with two arms, noting with two…', 'Skimming at full speed…', 'Reading real quick…', 'Page by page, go!', 'Reading and organizing…', 'Flipping pages fast…', 'Reading in motion…', 'Underlining what matters…'],
    },
    mirando: {
      es: ['¡Lentes puestos, mirando!', 'Mirando con atención…', 'A ver qué tenemos aquí…', 'Enfocando rapidito…', 'Antenas y ojos atentos…', 'Mirando cada detalle…', 'Escaneando, ¡va!', 'Déjame ver de cerquita…'],
      en: ['Glasses on, looking!', 'Looking closely…', 'Let’s see what we’ve got…', 'Focusing real quick…', 'Antennas and eyes ready…', 'Looking at every detail…', 'Scanning, go!', 'Let me look up close…'],
    },
    seguimiento: {
      es: ['¡Ya casi, no aflojo!', 'Cuatro brazos trabajando, ya casi…', 'Un empujoncito más…', 'Esto pesa, pero ya casi…', 'Ya mero, ¡va!', 'Seguimos, falta poco…', 'Casi terminado, ¡aguanta!', 'Último jalón…'],
      en: ['Almost, not slowing down!', 'Four arms working, almost…', 'One more little push…', 'This one’s heavy, but almost…', 'Nearly, go!', 'Keep going, not much left…', 'Almost finished, hang on!', 'Last big push…'],
    },
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
  o: {
    azar?: () => number;
    memoria?: MemoriaFrases;
    /**
     * Sin las que EMPIEZAN con una muletilla («Mmm, a ver…», «Hmm, let’s see…»): para cuando el agente
     * de ElevenLabs ya dijo la suya («Mmm… a ver.») y la nuestra saldría pegada detrás.
     */
    sinMuletilla?: boolean;
    /** Frases que no deben salir ahora (las ya dichas en esta misma espera). */
    evitar?: readonly string[];
  } = {}
): FraseDeEstado {
  const a: AvatarFrase = avatar in PROPIAS ? avatar : 'aura';
  const i: IdiomaFrase = idioma === 'en' ? 'en' : 'es';
  const todas = frasesDe(estado, a, i);
  const evitar = new Set(o.evitar || []);
  const filtradas = todas.filter((f) => !evitar.has(f) && !(o.sinMuletilla && empiezaConMuletilla(f)));
  const texto = (o.memoria || memoria).elegir(filtradas.length ? filtradas : todas, `${estado}|${a}|${i}`, o.azar);
  return { texto, estado, ...EMOCION_DE_ESTADO[estado] };
}

/** ¿Empieza con una muletilla de espera («Mmm», «Hmm», «A ver», «Este», «Bueno», «Let’s see»)? */
export function empiezaConMuletilla(frase: string): boolean {
  return /^(mmm+|hmm+|eh+|este|bueno|a ver|let s see|let me see|um+|uh+)\b/.test(plano(frase));
}

/* ------------------------------------------------------------------ las TAREAS del turno */

/**
 * El sonido de fondo que pone el teléfono mientras dura una tarea lenta en la conversación (la
 * «animación» sonora): tecleo para buscar, hojas de papel para leer, lápiz para calcular. Los archivos
 * están en mobile/assets/sfx/<sonido>.mp3 (salieron de la API de efectos de sonido de ElevenLabs).
 */
export const SONIDOS_AMBIENTE = ['teclado', 'papel', 'lapiz'] as const;
export type SonidoAmbiente = (typeof SONIDOS_AMBIENTE)[number];

export type Tarea = {
  estado: EstadoFrase;
  sonido: SonidoAmbiente | null;
  /**
   * Siempre tarda segundos (una búsqueda web, leer una página): la frase de espera puede salir antes
   * (ESPERA_TAREA_MS después de saberse). Las rápidas (un precio en caché, abrir una pantalla) solo
   * dan el estado y el sonido si el turno llega igual al puente de siempre.
   */
  lenta: boolean;
};

/**
 * Cada herramienta del turno (las de `tools`, las del harness —PEDIR_HERRAMIENTA— y las manos de la
 * app que esperan al teléfono) → en qué estado se espera, qué sonido lleva y si siempre es lenta.
 */
export const TAREAS: Record<string, Tarea> = {
  web: { estado: 'buscando', sonido: 'teclado', lenta: true },
  leer: { estado: 'leyendo', sonido: 'papel', lenta: true },
  pagina: { estado: 'leyendo', sonido: 'papel', lenta: true },
  'pdf-leer': { estado: 'leyendo', sonido: 'papel', lenta: true },
  documento: { estado: 'leyendo', sonido: 'papel', lenta: true },
  sistema: { estado: 'revisando', sonido: 'teclado', lenta: true },
  ejecutor: { estado: 'calculando', sonido: 'teclado', lenta: true },
  vision: { estado: 'mirando', sonido: null, lenta: true },
  foto: { estado: 'mirando', sonido: null, lenta: true },
  /** «Busca en mis chats…»: lo busca el teléfono y vuelve como lectura. */
  buscar: { estado: 'buscando', sonido: 'teclado', lenta: true },
  /** «¿Qué me dijo Beto?»: el teléfono abre los mensajes y vuelve como lectura. */
  'leer-chat': { estado: 'leyendo', sonido: 'papel', lenta: true },
  oro: { estado: 'buscando', sonido: 'teclado', lenta: false },
  plata: { estado: 'buscando', sonido: 'teclado', lenta: false },
  hnl: { estado: 'buscando', sonido: 'teclado', lenta: false },
  'calculo-mina': { estado: 'calculando', sonido: 'lapiz', lenta: false },
  concesiones: { estado: 'revisando', sonido: 'papel', lenta: false },
  taller: { estado: 'revisando', sonido: 'teclado', lenta: false },
  escena: { estado: 'mirando', sonido: null, lenta: false },
  app: { estado: 'abriendo', sonido: null, lenta: false },
};

/** La tarea de una herramienta, o null si no es una tarea (rag, cot, harness, cerebro-*…). */
export function tareaDe(herramienta: string): Tarea | null {
  return TAREAS[String(herramienta || '').trim().toLowerCase()] || null;
}

/** El sonido que va con un estado cuando no se sabe la herramienta (el respaldo por la pregunta). */
export function sonidoDeEstado(estado: EstadoFrase): SonidoAmbiente | null {
  return estado === 'buscando' || estado === 'revisando' ? 'teclado' : estado === 'leyendo' ? 'papel' : estado === 'calculando' ? 'lapiz' : null;
}

/**
 * Cuánto después de saberse una tarea LENTA sale la frase de espera. Si la respuesta llega antes, no se
 * dice nada. La primera en seguimiento sale si la tarea sigue sin respuesta tras SEGUIMIENTO_MS desde lo
 * último que se dijo (la frase de espera), y como mucho MAX_SEGUIMIENTOS.
 */
export const ESPERA_TAREA_MS = 900;
export const SEGUIMIENTO_MS = 7_000;
export const MAX_SEGUIMIENTOS = 2;

/* ------------------------------------------------------------------ la voz v4: etiquetas de audio */

/**
 * ETIQUETAS DE AUDIO EN LA VOZ v4 (eleven_v4_turbo). Comprobado el 30-sep con la API de ElevenLabs
 * (texto a voz con la voz de Claudio y el modelo v4, y después speech-to-text `scribe_v1` con
 * `tag_audio_events`):
 *  · «[sighs] Déjame revisar eso.» → «[suspiro] Déjame revisar eso»: suspira, NO dice «sighs».
 *  · «[exhales] Buscando en internet.» → «[suspiro] Buscando en Internet» (en inglés: «[sighs] Almost got it»).
 *  · «[laughs softly] Ya casi lo tengo.» y «[chuckles] Ya casi, ya casi.» → «[risa] …»: se ríe bajito.
 *  · «[thoughtful] …», «[curious] …», «[calm] …», «[whispers] …»: no se oyen como palabra (dirigen el tono).
 * Control: el mismo texto con eleven_flash_v2_5 transcribe «Thoughtful. Mmm, a ver…», «Laugh softly. Ya
 * casi…», «Exhales. Buscando…»: ese modelo SÍ las lee. Con v4 ninguna de las once salió leída.
 * Por eso las frases de espera de la voz llevan a veces (una de cada ~3, nunca en el globito ni en el
 * texto que se lee) una etiqueta: de tono al buscar o pensar, y una risita o una exhalación en la
 * de seguimiento. El Guardián, sereno: solo tono tranquilo o una exhalación, nunca risa.
 */
const ETIQUETAS_V4: Record<'ojos' | 'otros', Partial<Record<EstadoFrase, readonly string[]>>> = {
  ojos: { pensando: ['[calm]'], revisando: ['[calm]'], buscando: ['[calm]'], leyendo: ['[calm]'], calculando: ['[calm]'], mirando: ['[calm]'], seguimiento: ['[calm]', '[exhales]'] },
  otros: {
    pensando: ['[thoughtful]'],
    revisando: ['[thoughtful]'],
    buscando: ['[curious]'],
    leyendo: ['[thoughtful]'],
    calculando: ['[thoughtful]'],
    mirando: ['[curious]'],
    seguimiento: ['[laughs softly]', '[exhales]', '[chuckles]'],
  },
};
/** Una de cada cuántas frases de espera lleva etiqueta (con mesura: si todas la llevan, cansa). */
export const CADA_ETIQUETA = 3;

/**
 * La frase de espera como la DICE la voz v4: a veces con su etiqueta de audio delante. `azar` decide
 * (0..1). El texto sin etiqueta (el que se lee o va al globito) es `texto` tal cual.
 */
export function vozDeEspera(texto: string, estado: EstadoFrase, avatar: AvatarFrase = 'aura', azar: () => number = Math.random): string {
  const lista = ETIQUETAS_V4[avatar === 'ojos' ? 'ojos' : 'otros'][estado];
  if (!lista?.length || !texto || azar() * CADA_ETIQUETA >= 1) return texto;
  const etiqueta = lista[Math.floor(azar() * lista.length) % lista.length];
  return `${etiqueta} ${texto}`;
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
  if (/\b(lee|leeme|leer|pdf|pagina|articulo|read)\b|https?:\/\//.test(q)) return 'leyendo';
  if (/\b(que ves|me ves|mira esto|camara|look at this|what do you see)\b/.test(q)) return 'mirando';
  if (/\b(revisa|revisar|verifica|confirma|expediente|documento|contrato|check|verify|review|pendientes|tareas|agenda)\b/.test(q)) return 'revisando';
  return 'pensando';
}

// Lo que se dice mientras se espera: si el cerebro EMPIEZA su respuesta con una de estas (o con una
// muletilla de espera cualquiera), sobra: ya se dijo. Se compara sin tildes, signos ni mayúsculas.
const ESPERA: EstadoFrase[] = ['escuchando', 'conectando', 'pensando', 'revisando', 'buscando', 'calculando', 'leyendo', 'mirando', 'seguimiento'];
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
