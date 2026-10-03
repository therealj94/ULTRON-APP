/**
 * EL FLUJO DE LA PRIMERA VEZ, sin pantallas: qué pasos hay, en qué orden, cuándo se puede seguir,
 * qué se guarda en el perfil y cómo se arma cada respuesta de la encuesta. Vive aparte de React
 * para probarlo en node (las pantallas solo lo dibujan).
 *
 * PRIMERO UN RESULTADO (documento maestro, sección 14 y recorrido R1; AUR11): antes de configurar nada,
 *   objetivo    → «¿Qué te gustaría resolver primero? Puedes empezar sin conectar ninguna cuenta» (una opción
 *                 o con sus palabras; se puede saltar)
 *   restriccion → SOLO la restricción que cambia el resultado (presupuesto y uso para comparar, cuándo para
 *                 un recordatorio…), saltable
 *   conectar    → la cuenta, solo si el objetivo la necesita (revisar el correo, contestar WhatsApp)
 *   listo       → el MINIRESULTADO: la primera petición armada, que queda escrita en la mesa al terminar.
 *                 «Usar mi petición ahora» termina ya; «Personalizar primero» sigue con lo de siempre.
 * El plan (`pasosDelPlan`) depende del objetivo: sin objetivo no hay restricción ni miniresultado; la
 * conexión y los permisos solo entran si hacen falta. Lo personal (encuesta, cumpleaños) se puede saltar
 * siempre: el formulario no exige familia, salud ni finanzas.
 *
 * Y después, lo de antes:
 *   genesis  → «Genesis ID compartió contigo» (nombre y cumpleaños con ✔) o pregunta el cumpleaños
 *   idioma   → Español o English (la app, la voz y las respuestas cambian al instante)
 *   apodo    → «¿Cómo quieres que te diga?»
 *   avatar   → Guardián, AU-RA o Claudio, con su vista viva
 *   tema     → Oscuro, Claro o Sistema, aplicado al instante
 *   aura     → AURA se presenta (lo que sabe hacer)
 *   conectar → su WhatsApp y su correo, con instrucciones (José, 3-oct: «desde el principio… conectar
 *              WhatsApp y el correo»). El de Orden Global: solo correo y contraseña
 *   encuesta → una pregunta por tarjeta: a qué se dedica, dónde vive, familia, gustos, comida, música
 *              y qué quiere que AURA haga por él. Cada una con opciones de un toque, «Otro (escribir)»
 *              y «Responder hablando» (el dictado del teléfono, bienvenida/dictado.ts)
 *   iniciativa → cuánto quiere que AURA le proponga por su cuenta (Alta, Media, Baja, Apagada)
 *   permisos → solo los que pide el objetivo (los avisos para un recordatorio), explicados; los demás se
 *              piden donde se usan (el micrófono en la mesa) y todos están en Ajustes
 *   fiesta   → celebración, la primera petición y a la mesa
 *
 * Cada pregunta de la encuesta es su propio paso: la barra avanza con cada tarjeta, «atrás» vuelve a
 * la anterior y se retoma donde se quedó si Android cierra la app a la mitad. Lo que se salta se
 * retoma después desde la mesa (Más → Qué puedo hacer → «Contarte de mí»: pasosPendientes).
 *
 * Cada respuesta va al perfil (lo lee el cerebro en cada turno) y, como dato, a «lo que sé de ti»
 * (datoConocerDe → POST /api/cerebro/conocer), donde la persona lo ve, lo corrige o lo borra.
 */
import type { AvatarId } from '../avatares/catalogo';
import type { Bilingue } from '../i18n';
import type { Encuesta, NivelIniciativa, Perfil, Tema } from '../nucleo/contrato';
import type { NombreIcono } from '../ui/iconos';

export type CampoPregunta = 'vive' | 'comida' | 'musica' | 'familia' | 'trabajo' | 'gustos' | 'ayuda';

export type Pregunta = {
  campo: CampoPregunta;
  icono: NombreIcono;
  titulo: Bilingue;
  /** Por qué se pregunta, dicho por AURA. */
  nota: Bilingue;
  /** Lo que se escribe en el campo libre si no hay nada (ejemplo). */
  ejemplo: Bilingue;
  sugerencias: readonly Bilingue[];
};

export const PREGUNTAS: readonly Pregunta[] = [
  {
    campo: 'trabajo',
    icono: 'trabajo',
    titulo: { es: '¿A qué te dedicas?', en: 'What do you do?' },
    nota: { es: 'Para ayudarte de verdad en tu día.', en: 'To really help you through your day.' },
    ejemplo: { es: 'Tu oficio o tu empresa', en: 'Your job or company' },
    sugerencias: [
      { es: 'Negocio propio', en: 'My own business' },
      { es: 'Minería', en: 'Mining' },
      { es: 'Comercio', en: 'Retail' },
      { es: 'Oficina', en: 'Office' },
      { es: 'Estudio', en: 'I study' },
      { es: 'Tecnología', en: 'Technology' },
      { es: 'Campo', en: 'Farming' },
      { es: 'Hogar', en: 'Homemaker' },
    ],
  },
  {
    campo: 'vive',
    icono: 'casa',
    titulo: { es: '¿Dónde vives?', en: 'Where do you live?' },
    nota: { es: 'Para el clima, la hora y lo que pasa cerca de ti.', en: 'For the weather, the time and what’s happening near you.' },
    ejemplo: { es: 'Ciudad o colonia', en: 'City or neighborhood' },
    sugerencias: [
      { es: 'Tegucigalpa', en: 'Tegucigalpa' },
      { es: 'San Pedro Sula', en: 'San Pedro Sula' },
      { es: 'La Ceiba', en: 'La Ceiba' },
      { es: 'Choluteca', en: 'Choluteca' },
      { es: 'Estados Unidos', en: 'United States' },
      { es: 'España', en: 'Spain' },
    ],
  },
  {
    campo: 'familia',
    icono: 'familia',
    titulo: { es: 'Cuéntame de tu familia', en: 'Tell me about your family' },
    nota: { es: 'Para acordarme de los tuyos y de sus cumpleaños.', en: 'To remember your loved ones and their birthdays.' },
    ejemplo: { es: 'Ej.: casado, dos hijas: Ana y Sofía', en: 'E.g.: married, two daughters: Ana and Sofía' },
    sugerencias: [
      { es: 'Casado/a', en: 'Married' },
      { es: 'Soltero/a', en: 'Single' },
      { es: 'Tengo hijos', en: 'I have kids' },
      { es: 'Tengo nietos', en: 'I have grandkids' },
      { es: 'Tengo mascota', en: 'I have a pet' },
      { es: 'Vivo con mis papás', en: 'I live with my parents' },
    ],
  },
  {
    campo: 'gustos',
    icono: 'corazon',
    titulo: { es: '¿Qué te gusta hacer?', en: 'What do you enjoy doing?' },
    nota: { es: 'Tus pasatiempos: de eso también se platica.', en: 'Your hobbies: that’s worth chatting about too.' },
    ejemplo: { es: 'Deportes, series, viajar…', en: 'Sports, shows, travel…' },
    sugerencias: [
      { es: 'Fútbol', en: 'Soccer' },
      { es: 'Viajar', en: 'Traveling' },
      { es: 'Leer', en: 'Reading' },
      { es: 'Cocinar', en: 'Cooking' },
      { es: 'Series', en: 'TV shows' },
      { es: 'Iglesia', en: 'Church' },
      { es: 'Videojuegos', en: 'Video games' },
      { es: 'Naturaleza', en: 'Nature' },
    ],
  },
  {
    campo: 'comida',
    icono: 'comida',
    titulo: { es: '¿Qué comida te encanta?', en: 'What food do you love?' },
    nota: { es: 'Para recomendarte lugares y acordarme de tus antojos.', en: 'To suggest places and remember your cravings.' },
    ejemplo: { es: 'Tu plato favorito', en: 'Your favorite dish' },
    sugerencias: [
      { es: 'Baleadas', en: 'Baleadas' },
      { es: 'Sopa de caracol', en: 'Conch soup' },
      { es: 'Pupusas', en: 'Pupusas' },
      { es: 'Carne asada', en: 'Carne asada' },
      { es: 'Mariscos', en: 'Seafood' },
      { es: 'Pizza', en: 'Pizza' },
      { es: 'Comida china', en: 'Chinese food' },
      { es: 'Postres', en: 'Desserts' },
    ],
  },
  {
    campo: 'musica',
    icono: 'musica',
    titulo: { es: '¿Qué música te gusta?', en: 'What music do you like?' },
    nota: { es: 'AURA también canta: así sabe qué ponerte.', en: 'AURA sings too: this way she knows what to play.' },
    ejemplo: { es: 'Artistas o géneros', en: 'Artists or genres' },
    sugerencias: [
      { es: 'Punta', en: 'Punta' },
      { es: 'Bachata', en: 'Bachata' },
      { es: 'Salsa', en: 'Salsa' },
      { es: 'Reguetón', en: 'Reggaeton' },
      { es: 'Rancheras', en: 'Rancheras' },
      { es: 'Cristiana', en: 'Christian' },
      { es: 'Rock', en: 'Rock' },
      { es: 'Baladas', en: 'Ballads' },
    ],
  },
  {
    campo: 'ayuda',
    icono: 'chispas',
    titulo: { es: '¿Qué quieres que AURA haga por ti?', en: 'What do you want AURA to do for you?' },
    nota: { es: 'Para enfocarme en lo que de verdad te sirve. Elige todas las que quieras.', en: 'So I focus on what really helps you. Pick as many as you like.' },
    ejemplo: { es: 'Ej.: que me recuerde las pastillas', en: 'E.g.: remind me of my pills' },
    sugerencias: [
      { es: 'Recordarme cosas', en: 'Remind me of things' },
      { es: 'Organizar mi día', en: 'Organize my day' },
      { es: 'Leer y contestar mis mensajes', en: 'Read and answer my messages' },
      { es: 'Revisar mis correos', en: 'Check my email' },
      { es: 'Buscar en internet', en: 'Search the web' },
      { es: 'Ayudarme en el trabajo', en: 'Help me with work' },
      { es: 'Hacerme compañía', en: 'Keep me company' },
      { es: 'Orar conmigo', en: 'Pray with me' },
    ],
  },
];

export type PasoId =
  | 'objetivo'
  | 'restriccion'
  | 'listo'
  | 'genesis'
  | 'idioma'
  | 'apodo'
  | 'avatar'
  | 'tema'
  | 'aura'
  | 'conectar'
  | `encuesta:${CampoPregunta}`
  | 'iniciativa'
  | 'permisos'
  | 'fiesta';

const PASOS_ENCUESTA = PREGUNTAS.map((p) => `encuesta:${p.campo}` as const);

/** Todos los pasos, en orden. Cada persona recorre los de su plan (`pasosDelPlan`). */
export const PASOS: readonly PasoId[] = ['objetivo', 'restriccion', 'conectar', 'listo', 'genesis', 'idioma', 'apodo', 'avatar', 'tema', 'aura', ...PASOS_ENCUESTA, 'iniciativa', 'permisos', 'fiesta'];

/**
 * Los pasos de la v2, CONGELADOS: el número de paso que guardó una versión vieja se traduce con esta lista
 * (antes se calculaba de PASOS, y cada paso nuevo corría los números).
 */
export const PASOS_V2: readonly PasoId[] = ['genesis', 'idioma', 'apodo', 'avatar', 'tema', 'aura', ...PASOS_ENCUESTA, 'iniciativa', 'permisos', 'fiesta'];

/** El orden de la v3 antes del objetivo: para seguir desde un paso que ya no está en el plan. */
const PASOS_ANTES: readonly PasoId[] = ['genesis', 'idioma', 'apodo', 'avatar', 'tema', 'aura', 'conectar', ...PASOS_ENCUESTA, 'iniciativa', 'permisos', 'fiesta'];

/* ── el primer resultado: qué quiere resolver y la restricción que lo cambia ─────────────── */

export type ObjetivoId = 'comparar' | 'organizar' | 'recordar' | 'escribir' | 'buscar' | 'correo' | 'whatsapp';
/** Los permisos que puede pedir un objetivo (de PERMISOS_ANDROID, src/nucleo/contrato.ts). */
export type PermisoObjetivo = 'android.permission.POST_NOTIFICATIONS' | 'android.permission.RECORD_AUDIO' | 'android.permission.CAMERA';

export type Objetivo = {
  id: ObjetivoId;
  icono: NombreIcono;
  titulo: Bilingue;
  /** Cómo empieza la petición que queda lista para AURA. */
  pedido: Bilingue;
  /** LA restricción que cambia el resultado: una sola pregunta. */
  restriccion: { pregunta: Bilingue; nota: Bilingue; etiqueta: Bilingue; ejemplo: Bilingue; sugerencias: readonly Bilingue[] };
  /** La cuenta que hace falta para hacerlo (si no la conecta, puede pegar el texto). */
  conexion?: 'correo' | 'whatsapp';
  permisos?: readonly PermisoObjetivo[];
};

export const OBJETIVOS: readonly Objetivo[] = [
  {
    id: 'comparar',
    icono: 'estrella',
    titulo: { es: 'Comparar opciones', en: 'Compare options' },
    pedido: { es: 'Compara estas opciones y déjame una recomendación con fuentes', en: 'Compare these options and give me a recommendation with sources' },
    restriccion: {
      pregunta: { es: '¿Qué pesa más: el presupuesto o el uso?', en: 'What matters most: budget or use?' },
      nota: { es: 'Con eso cambia cuál te recomiendo.', en: 'That changes which one I recommend.' },
      etiqueta: { es: 'Lo que más pesa', en: 'What matters most' },
      ejemplo: { es: 'Ej.: hasta L 15,000, para trabajar', en: 'E.g.: up to $600, for work' },
      sugerencias: [
        { es: 'Lo más barato', en: 'The cheapest' },
        { es: 'La mejor calidad', en: 'The best quality' },
        { es: 'Para trabajar', en: 'For work' },
        { es: 'Para la casa', en: 'For home' },
      ],
    },
  },
  {
    id: 'organizar',
    icono: 'reloj',
    titulo: { es: 'Organizar mi día', en: 'Organize my day' },
    pedido: { es: 'Ayúdame a organizar mi día', en: 'Help me organize my day' },
    restriccion: {
      pregunta: { es: '¿Qué tienes sí o sí hoy?', en: 'What do you have to do today, no matter what?' },
      nota: { es: 'Lo fijo primero; lo demás lo acomodo alrededor.', en: 'The fixed things first; I’ll fit the rest around them.' },
      etiqueta: { es: 'Lo que no se mueve', en: 'What can’t move' },
      ejemplo: { es: 'Ej.: reunión a las 10 y recoger a los niños a las 4', en: 'E.g.: meeting at 10 and school pickup at 4' },
      sugerencias: [
        { es: 'Trabajo en la mañana', en: 'Work in the morning' },
        { es: 'Una reunión', en: 'A meeting' },
        { es: 'Recoger a alguien', en: 'Picking someone up' },
        { es: 'Ir al banco', en: 'Going to the bank' },
      ],
    },
  },
  {
    id: 'recordar',
    icono: 'campana',
    titulo: { es: 'Recordarme algo', en: 'Remind me of something' },
    pedido: { es: 'Recuérdame algo', en: 'Remind me of something' },
    restriccion: {
      pregunta: { es: '¿Qué y cuándo te lo recuerdo?', en: 'What, and when should I remind you?' },
      nota: { es: 'Con la hora exacta te aviso a tiempo.', en: 'With the exact time I’ll let you know on time.' },
      etiqueta: { es: 'Qué y cuándo', en: 'What and when' },
      ejemplo: { es: 'Ej.: pagar la luz el viernes a las 9', en: 'E.g.: pay the power bill on Friday at 9' },
      sugerencias: [
        { es: 'Hoy en la tarde', en: 'This afternoon' },
        { es: 'Mañana temprano', en: 'Tomorrow morning' },
        { es: 'Cada día', en: 'Every day' },
        { es: 'El fin de semana', en: 'On the weekend' },
      ],
    },
    permisos: ['android.permission.POST_NOTIFICATIONS'],
  },
  {
    id: 'escribir',
    icono: 'lapiz',
    titulo: { es: 'Escribir un mensaje', en: 'Write a message' },
    pedido: { es: 'Ayúdame a escribir un mensaje (déjalo en borrador, no lo mandes)', en: 'Help me write a message (leave it as a draft, don’t send it)' },
    restriccion: {
      pregunta: { es: '¿Para quién y en qué tono?', en: 'Who is it for, and in what tone?' },
      nota: { es: 'No es lo mismo tu jefe que tu mamá.', en: 'Your boss isn’t your mom.' },
      etiqueta: { es: 'Para quién y tono', en: 'Who and tone' },
      ejemplo: { es: 'Ej.: a un cliente, serio pero amable', en: 'E.g.: to a client, serious but friendly' },
      sugerencias: [
        { es: 'Formal', en: 'Formal' },
        { es: 'Cariñoso', en: 'Warm' },
        { es: 'Corto y directo', en: 'Short and direct' },
        { es: 'Para un cliente', en: 'For a client' },
      ],
    },
  },
  {
    id: 'buscar',
    icono: 'globo',
    titulo: { es: 'Averiguar algo', en: 'Look something up' },
    pedido: { es: 'Averigua esto y dime lo que encontraste con sus fuentes', en: 'Look this up and tell me what you found, with sources' },
    restriccion: {
      pregunta: { es: '¿Para qué lo necesitas?', en: 'What do you need it for?' },
      nota: { es: 'Así busco lo que te sirve y no lo primero que sale.', en: 'So I look for what helps you, not just the first result.' },
      etiqueta: { es: 'Para qué', en: 'What for' },
      ejemplo: { es: 'Ej.: para decidir antes del lunes', en: 'E.g.: to decide before Monday' },
      sugerencias: [
        { es: 'Para decidir hoy', en: 'To decide today' },
        { es: 'En Honduras', en: 'In Honduras' },
        { es: 'Lo más reciente', en: 'The latest' },
        { es: 'Explicado fácil', en: 'Explained simply' },
      ],
    },
  },
  {
    id: 'correo',
    icono: 'correo',
    titulo: { es: 'Revisar mi correo', en: 'Check my email' },
    pedido: { es: 'Revisa mi correo y dime lo importante', en: 'Check my email and tell me what matters' },
    restriccion: {
      pregunta: { es: '¿Qué buscas en tu correo?', en: 'What are you looking for in your email?' },
      nota: { es: 'Para no leerte todo, solo lo que importa.', en: 'So I don’t read you everything, just what matters.' },
      etiqueta: { es: 'Lo que busco', en: 'What I’m looking for' },
      ejemplo: { es: 'Ej.: lo de un cliente de esta semana', en: 'E.g.: a client’s emails from this week' },
      sugerencias: [
        { es: 'Lo urgente', en: 'What’s urgent' },
        { es: 'De hoy', en: 'From today' },
        { es: 'De una persona', en: 'From one person' },
        { es: 'Facturas y pagos', en: 'Invoices and payments' },
      ],
    },
    conexion: 'correo',
  },
  {
    id: 'whatsapp',
    icono: 'chat',
    titulo: { es: 'Contestar mis WhatsApp', en: 'Answer my WhatsApp' },
    pedido: { es: 'Revisa mis WhatsApp y prepárame respuestas en borrador', en: 'Check my WhatsApp and draft replies for me' },
    restriccion: {
      pregunta: { es: '¿De quién o de qué?', en: 'From whom, or about what?' },
      nota: { es: 'Nada se manda sin tu «sí».', en: 'Nothing is sent without your “yes”.' },
      etiqueta: { es: 'De quién o de qué', en: 'From whom or about what' },
      ejemplo: { es: 'Ej.: el grupo de la familia', en: 'E.g.: the family group' },
      sugerencias: [
        { es: 'Lo que no he contestado', en: 'What I haven’t answered' },
        { es: 'De trabajo', en: 'Work' },
        { es: 'De la familia', en: 'Family' },
        { es: 'De hoy', en: 'From today' },
      ],
    },
    conexion: 'whatsapp',
  },
];

/** El objetivo elegido (por su id), o null si escribió el suyo o no eligió. */
export function objetivoDe(b: Pick<Borrador, 'objetivo'>): Objetivo | null {
  return OBJETIVOS.find((o) => o.id === b.objetivo) || null;
}

const unaLinea = (s: string | undefined, max: number) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();

/**
 * LA PRIMERA PETICIÓN: el objetivo (la opción, o lo que escribió) y la restricción, en una frase lista para
 * mandar a AURA. Vacía si no hay objetivo. Es el miniresultado de la primera vez: queda escrita en la mesa.
 */
export function peticionInicial(b: Pick<Borrador, 'objetivo' | 'objetivoTexto' | 'restriccion'>, idioma: 'es' | 'en'): string {
  const o = objetivoDe(b);
  const texto = unaLinea(b.objetivoTexto, 200);
  const r = unaLinea(b.restriccion, 160);
  const base = o ? (texto ? `${o.pedido[idioma]}: ${texto}` : o.pedido[idioma]) : texto;
  if (!base) return '';
  const fin = /[.!?]$/.test(base) ? base : `${base}.`;
  const etiqueta = o ? o.restriccion.etiqueta[idioma] : idioma === 'en' ? 'Keep in mind' : 'Ten en cuenta';
  return r ? `${fin} ${etiqueta}: ${r}${/[.!?]$/.test(r) ? '' : '.'}` : fin;
}

/** Los permisos que el plan pide (solo los del objetivo; los demás, donde se usan). */
export function permisosDelPlan(b: Pick<Borrador, 'objetivo'>): PermisoObjetivo[] {
  return [...(objetivoDe(b)?.permisos || [])];
}

/**
 * Los pasos de ESTA persona, en orden: sin objetivo no hay restricción ni miniresultado; los permisos solo si
 * el objetivo los necesita. Conectar WhatsApp y correo se OFRECE siempre (José, 3-oct: «desde el principio
 * … conectar WhatsApp y el correo cuando alguien entra la primera vez»), siempre saltable: el documento maestro
 * pide que se pueda empezar sin conectar nada, no que se esconda.
 */
export function pasosDelPlan(b: Pick<Borrador, 'objetivo' | 'objetivoTexto' | 'restriccion'>): PasoId[] {
  const o = objetivoDe(b);
  const conPeticion = !!peticionInicial(b, 'es');
  return PASOS.filter((p) => {
    if (p === 'restriccion' || p === 'listo') return conPeticion;
    if (p === 'permisos') return !!o?.permisos?.length;
    return true;
  });
}

/** El paso que sigue en el plan; si `paso` ya no está (cambió el objetivo), el siguiente que sí esté. */
export function siguienteEn(plan: readonly PasoId[], paso: PasoId): PasoId {
  const i = plan.indexOf(paso);
  if (i >= 0) return plan[Math.min(plan.length - 1, i + 1)];
  const j = PASOS.indexOf(paso);
  return PASOS.slice(j + 1).find((p) => plan.includes(p)) || plan[plan.length - 1];
}

export function anteriorEn(plan: readonly PasoId[], paso: PasoId): PasoId {
  const i = plan.indexOf(paso);
  if (i >= 0) return plan[Math.max(0, i - 1)];
  const j = PASOS.indexOf(paso);
  return [...PASOS.slice(0, Math.max(0, j))].reverse().find((p) => plan.includes(p)) || plan[0];
}

/** 0..1 para la barra (la fiesta es el 100 %). */
export function progresoEn(plan: readonly PasoId[], paso: PasoId): number {
  const n = plan.length - 1;
  const i = plan.indexOf(paso);
  return n > 0 && i >= 0 ? Math.max(0, Math.min(1, i / n)) : 0;
}

/**
 * DÓNDE RETOMAR: el nombre guardado (v3) o, si no hay, el número de la v2 (con sus pasos de entonces). Si ese
 * paso ya no está en el plan, el siguiente que sí esté (en el orden de antes, para lo de antes). Quien
 * estaba en el primer paso de antes (o en ninguno) empieza por el objetivo.
 */
export function pasoRetomado(plan: readonly PasoId[], v3: string | null | undefined, v2: number | null | undefined): PasoId {
  let nombre: PasoId | null = v3 && (PASOS as readonly string[]).includes(v3) ? (v3 as PasoId) : null;
  if (!nombre && Number.isInteger(v2) && (v2 as number) > 0 && (v2 as number) < PASOS_V2.length) nombre = PASOS_V2[v2 as number];
  if (!nombre || nombre === 'genesis') return plan[0];
  if (plan.includes(nombre)) return nombre;
  const orden = PASOS_ANTES.includes(nombre) ? PASOS_ANTES : PASOS;
  return orden.slice(orden.indexOf(nombre) + 1).find((p) => plan.includes(p)) || plan[0];
}

/** Lo del objetivo guardado aparte (si Android cierra la app a la mitad), sano. */
export function objetivoGuardado(raw: string | null | undefined): Pick<Borrador, 'objetivo' | 'objetivoTexto' | 'restriccion'> {
  let j: any = null;
  try {
    j = JSON.parse(String(raw || 'null'));
  } catch {
    return {};
  }
  if (!j || typeof j !== 'object') return {};
  const r: Pick<Borrador, 'objetivo' | 'objetivoTexto' | 'restriccion'> = {};
  if (OBJETIVOS.some((o) => o.id === j.objetivo)) r.objetivo = j.objetivo;
  const t = unaLinea(j.objetivoTexto, 200);
  if (t) r.objetivoTexto = t;
  const re = unaLinea(j.restriccion, 160);
  if (re && (r.objetivo || r.objetivoTexto)) r.restriccion = re;
  return r;
}

/** Los pasos que se pueden saltar con el botón de arriba: todo lo que no hace falta para usar AURA. */
export function saltable(paso: PasoId): boolean {
  return paso.startsWith('encuesta:') || paso === 'objetivo' || paso === 'restriccion' || paso === 'permisos' || paso === 'aura' || paso === 'conectar' || paso === 'iniciativa';
}

/**
 * ¿Correo de Orden Global? El servidor ya conoce sus servidores (lib/correo/proveedores.ts): basta la
 * dirección y la contraseña, sin «contraseña de aplicación» ni servidores a mano.
 */
export function esCorreoOrdenGlobal(correo: string): boolean {
  return /^[^\s@]+@ordenglobal\.org$/i.test(String(correo || '').trim());
}

/** Cuánta iniciativa: lo que se elige en la primera vez (y en Ajustes → Iniciativa de AURA). */
export const OPCIONES_INICIATIVA: readonly { id: NivelIniciativa; titulo: Bilingue; detalle: Bilingue }[] = [
  { id: 'alta', titulo: { es: 'Alta', en: 'High' }, detalle: { es: 'Me propone cosas cada dos horas (hasta 6 al día). Nunca de noche.', en: 'Suggests things every two hours (up to 6 a day). Never at night.' } },
  { id: 'media', titulo: { es: 'Media', en: 'Medium' }, detalle: { es: 'Cada cuatro horas (hasta 3 al día). Si le digo que no, espera más.', en: 'Every four hours (up to 3 a day). If I say no, she waits longer.' } },
  { id: 'baja', titulo: { es: 'Baja', en: 'Low' }, detalle: { es: 'Una propuesta al día, como mucho.', en: 'At most one suggestion a day.' } },
  { id: 'apagada', titulo: { es: 'Apagada', en: 'Off' }, detalle: { es: 'Nada por su cuenta: solo contesta lo que le pida.', en: 'Nothing on her own: she only answers what I ask.' } },
];

export function preguntaDe(paso: PasoId): Pregunta | null {
  if (!paso.startsWith('encuesta:')) return null;
  const campo = paso.slice('encuesta:'.length);
  return PREGUNTAS.find((p) => p.campo === campo) || null;
}

/** Lo que se va juntando en la primera vez antes de escribirse en el perfil. */
export type Borrador = {
  apodo: string;
  cumple?: string;
  avatar: AvatarId;
  tema: Tema;
  encuesta: Encuesta;
  /** Sin elegir: no se manda (el servidor usa «media»). */
  iniciativa?: NivelIniciativa;
  /** Lo que quiere resolver primero (un ObjetivoId), lo que escribió con sus palabras y la restricción. No van al perfil. */
  objetivo?: string;
  objetivoTexto?: string;
  restriccion?: string;
};

export function borradorDesde(p: Perfil | null, nombre?: string): Borrador {
  const primer = (s?: string) => {
    const w = String(s || '').trim().split(/\s+/)[0] || '';
    return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '';
  };
  return {
    apodo: p?.apodo || primer(p?.nombreGenesis) || primer(nombre),
    cumple: p?.cumple,
    avatar: p?.avatar ?? 'aura',
    tema: p?.tema ?? 'sistema',
    encuesta: { ...(p?.encuesta || {}) },
    ...(p?.iniciativa ? { iniciativa: p.iniciativa } : {}),
  };
}

/** Si se puede tocar «Siguiente». Solo el apodo es obligatorio (sin él AURA no sabe cómo decirte). */
export function puedeSeguir(paso: PasoId, b: Borrador): boolean {
  if (paso === 'apodo') return b.apodo.trim().length >= 1 && b.apodo.trim().length <= 40;
  return true;
}

/** Los cambios de perfil que deja el borrador (lo que se manda al guardar). */
export function cambiosDe(b: Borrador, completado: boolean): Partial<Perfil> {
  const c: Partial<Perfil> = { apodo: b.apodo.trim(), avatar: b.avatar, tema: b.tema, encuesta: { ...b.encuesta } };
  if (b.cumple !== undefined) c.cumple = b.cumple;
  if (b.iniciativa) c.iniciativa = b.iniciativa;
  if (completado) c.completado = true;
  return c;
}

/** Lo que cada paso escribe en el perfil al seguir (la primera vez y las preguntas que se retoman). */
export function cambiosDelPaso(paso: PasoId, b: Borrador): Partial<Perfil> | null {
  if (paso === 'genesis') return b.cumple ? { cumple: b.cumple } : null;
  if (paso === 'apodo') return { apodo: b.apodo.trim() };
  if (paso === 'avatar') return { avatar: b.avatar };
  if (paso === 'tema') return { tema: b.tema };
  if (paso === 'iniciativa') return b.iniciativa ? { iniciativa: b.iniciativa } : null;
  const q = preguntaDe(paso);
  if (q) return { encuesta: { [q.campo]: b.encuesta[q.campo] || '' } };
  return null;
}

/**
 * Lo que quedó sin contestar (se saltó, o la persona hizo la primera vez antes de que existiera la
 * pregunta): las preguntas de la encuesta en blanco y la iniciativa sin elegir. Es lo que la mesa ofrece
 * retomar (Más → Qué puedo hacer → «Contarte de mí»).
 */
export function pasosPendientes(p: Perfil | null): PasoId[] {
  const e = p?.encuesta || {};
  const faltan: PasoId[] = PREGUNTAS.filter((q) => !String(e[q.campo] || '').trim()).map((q) => `encuesta:${q.campo}` as const);
  if (!p?.iniciativa) faltan.push('iniciativa');
  return faltan;
}

/* ── «lo que sé de ti»: cada respuesta como un dato ──────────────────────────────────────── */

export type DatoConocer = { categoria: 'familia' | 'trabajo' | 'metas' | 'gustos' | 'rutinas' | 'otros'; dato: string; clave: string };

/**
 * LA CLAVE COMÚN de cada respuesta: la categoría y la clave con que su copia vive en «lo que sé de ti».
 * Una sola tabla para escribir la copia (datoConocerDe) y para borrarla junto con la respuesta del perfil
 * (lib/supresion.ts, auditoría del 3-oct PRIV01): si se separaran, borrar dejaría la otra copia.
 */
export const CLAVE_CONOCER: Record<CampoPregunta | 'apodo', { categoria: DatoConocer['categoria']; clave: string }> = {
  trabajo: { categoria: 'trabajo', clave: 'oficio' },
  vive: { categoria: 'rutinas', clave: 'vive' },
  familia: { categoria: 'familia', clave: 'familia:encuesta' },
  gustos: { categoria: 'gustos', clave: 'pasatiempos' },
  comida: { categoria: 'gustos', clave: 'comida favorita' },
  musica: { categoria: 'gustos', clave: 'musica' },
  ayuda: { categoria: 'metas', clave: 'quiere de aura' },
  apodo: { categoria: 'otros', clave: 'apodo' },
};

/**
 * La respuesta de una pregunta → un dato para «lo que sé de ti» (lib/conocer-persona.ts en el servidor).
 * Con su clave: si la vuelve a contestar, el dato se reemplaza en vez de repetirse. null si está vacía.
 */
export function datoConocerDe(campo: CampoPregunta | 'apodo', respuesta: string | undefined): DatoConocer | null {
  const r = String(respuesta || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (r.length < 2) return null;
  const k = CLAVE_CONOCER[campo];
  if (!k) return null;
  switch (campo) {
    case 'trabajo':
      return { ...k, dato: `Se dedica a: ${r}` };
    case 'vive':
      return { ...k, dato: `Vive en ${r}` };
    case 'familia':
      return { ...k, dato: `Su familia: ${r}` };
    case 'gustos':
      return { ...k, dato: `Le gusta: ${r}` };
    case 'comida':
      return { ...k, dato: `Comida favorita: ${r}` };
    case 'musica':
      return { ...k, dato: `Música que le gusta: ${r}` };
    case 'ayuda':
      return { ...k, dato: `Quiere que AURA le ayude a: ${r}` };
    case 'apodo':
      return { ...k, dato: `Quiere que le digan «${r}»` };
  }
}

/* ── responder hablando: lo dictado → las opciones que nombró ─────────────────────────────── */

const plegar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Lo que sobra entre opciones dichas («baleadas y pupusas») y no es contenido. */
const UNION = new Set('y e o u and or tambien me gusta gustan encanta encantan la el los las de del con mucho mucha muchos sobre todo pues este a en mi mis'.split(' '));

/**
 * Lo dictado («me gustan las baleadas y la sopa de caracol») → qué opciones nombró (en el idioma de la
 * pantalla) y qué texto queda para el campo libre. Si todo lo dicho eran opciones, el texto queda vacío;
 * si dijo algo más, se deja entero (con sus palabras).
 */
export function chipsDeDictado(texto: string, sugerencias: readonly Bilingue[], idioma: 'es' | 'en'): { chips: string[]; texto: string } {
  const t = ` ${plegar(texto)} `;
  const original = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t.trim()) return { chips: [], texto: '' };
  let resto = t;
  const chips: string[] = [];
  for (const s of sugerencias) {
    const formas = [plegar(s.es), plegar(s.en)].filter(Boolean);
    const forma = formas.find((f) => t.includes(` ${f} `));
    if (!forma) continue;
    chips.push(s[idioma]);
    resto = resto.split(` ${forma} `).join('  ');
  }
  const sobra = resto.split(' ').filter((w) => w && !UNION.has(w));
  return { chips, texto: chips.length && !sobra.length ? '' : original };
}

/** Lo dictado para una pregunta de UNA opción (la iniciativa, el idioma): la opción que nombró, o null. */
export function opcionDeDictado<T extends string>(texto: string, opciones: readonly { id: T; palabras: readonly string[] }[]): T | null {
  const t = ` ${plegar(texto)} `;
  for (const o of opciones) if (o.palabras.some((p) => t.includes(` ${plegar(p)} `))) return o.id;
  return null;
}

/** Cómo se nombra cada nivel de iniciativa al decirlo. */
export const PALABRAS_INICIATIVA: readonly { id: NivelIniciativa; palabras: readonly string[] }[] = [
  { id: 'apagada', palabras: ['apagada', 'apagado', 'ninguna', 'nada', 'nunca', 'off', 'none', 'never'] },
  { id: 'alta', palabras: ['alta', 'alto', 'mucha', 'mucho', 'seguido', 'high', 'a lot', 'often'] },
  { id: 'baja', palabras: ['baja', 'bajo', 'poca', 'poco', 'una al dia', 'low', 'rarely'] },
  { id: 'media', palabras: ['media', 'medio', 'normal', 'regular', 'medium'] },
];

/** Cómo se nombra cada idioma al decirlo. */
export const PALABRAS_IDIOMA: readonly { id: 'es' | 'en'; palabras: readonly string[] }[] = [
  { id: 'en', palabras: ['ingles', 'english', 'en ingles'] },
  { id: 'es', palabras: ['espanol', 'castellano', 'spanish'] },
];

/**
 * El apodo dicho («dime Chepe», «me dicen Toño», «José está bien») → el nombre, con mayúscula. Lo mismo que
 * reconoce el servidor en una conversación (lib/apodo.ts), en chico: aquí la persona lo ve antes de seguir.
 */
export function apodoDeDictado(texto: string): string {
  const limpio = String(texto || '')
    .replace(/[.!¡¿?,;:"«»“”]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:pues|bueno|mmm+|este|ok|claro)\s+)*(?:(?:de ahora en adelante|desde ahora)\s+)?(?:(?:me puedes|puedes|quiero que me|prefiero que me)\s+)?(?:ll[aá]mame|dime|decime|digas|me dicen|todos me dicen|mi apodo es|mi nombre es|me llamo|soy|call me|my name is)\s+/i, '')
    .replace(/\s+(?:est[aá] bien|por favor|nada m[aá]s|please|is fine)$/i, '')
    .trim();
  return limpio
    .split(' ')
    .slice(0, 3)
    .map((w) => (w ? w[0].toLocaleUpperCase('es') + w.slice(1) : w))
    .join(' ')
    .slice(0, 40);
}

/** Qué muestra el paso de Genesis: lo compartido con ✔, y si hay que preguntar el cumpleaños. */
export function queCompartioGenesis(p: Perfil | null): { nombre?: string; cumple?: string; preguntarCumple: boolean } {
  const nombre = p?.nombreGenesis || undefined;
  const cumple = p?.cumple || undefined;
  return { nombre, cumple, preguntarCumple: !cumple };
}

/* ── una respuesta de la encuesta: chips + texto libre en un solo campo ─────────────────── */

const SEP_CHIPS = ', ';
const SEP_TEXTO = '. ';

/**
 * Chips elegidos y texto libre → el texto que se guarda («Baleadas, Pupusas. Y la sopa de mi abuela»).
 * Es lo que lee el cerebro, así que va como una frase, no como una lista técnica.
 */
export function armarRespuesta(chips: readonly string[], texto: string): string {
  const t = texto.replace(/\s+/g, ' ').trim();
  const c = chips.map((x) => x.trim()).filter(Boolean);
  if (!c.length) return t;
  if (!t) return c.join(SEP_CHIPS);
  return `${c.join(SEP_CHIPS)}${SEP_TEXTO}${t}`;
}

/**
 * Al revés, para volver a editar: qué sugerencias están elegidas y qué quedó como texto libre.
 * Se reconocen las sugerencias en los dos idiomas (se pudo responder en inglés y editar en español).
 */
export function separarRespuesta(respuesta: string | undefined, sugerencias: readonly Bilingue[], idioma: 'es' | 'en'): { chips: string[]; texto: string } {
  const r = String(respuesta || '').trim();
  if (!r) return { chips: [], texto: '' };
  const i = r.indexOf(SEP_TEXTO);
  const cabeza = i >= 0 ? r.slice(0, i) : r;
  const cola = i >= 0 ? r.slice(i + SEP_TEXTO.length) : '';
  const piezas = cabeza.split(SEP_CHIPS).map((x) => x.trim());
  const conocida = (x: string) => sugerencias.find((s) => s.es.toLowerCase() === x.toLowerCase() || s.en.toLowerCase() === x.toLowerCase());
  if (piezas.length && piezas.every((x) => conocida(x))) {
    return { chips: piezas.map((x) => conocida(x)![idioma]), texto: cola };
  }
  return { chips: [], texto: r };
}

/* ── el cumpleaños sin año ───────────────────────────────────────────────────────────────── */

export const DIAS_POR_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function armarCumple(mes: number, dia: number): string | undefined {
  if (mes < 1 || mes > 12 || dia < 1 || dia > DIAS_POR_MES[mes - 1]) return undefined;
  return `${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function leerCumple(c: string | undefined): { mes: number; dia: number } | null {
  const m = /^(\d{2})-(\d{2})$/.exec(String(c || ''));
  if (!m) return null;
  return { mes: Number(m[1]), dia: Number(m[2]) };
}
