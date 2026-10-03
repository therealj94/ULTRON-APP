/**
 * EL FLUJO DE LA PRIMERA VEZ, sin pantallas: qué pasos hay, en qué orden, cuándo se puede seguir,
 * qué se guarda en el perfil y cómo se arma cada respuesta de la encuesta. Vive aparte de React
 * para probarlo en node (las pantallas solo lo dibujan).
 *
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
 *   permisos → micrófono, cámara, Bluetooth, avisos y ubicación, explicados
 *   fiesta   → celebración y a la mesa
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

export type PasoId = 'genesis' | 'idioma' | 'apodo' | 'avatar' | 'tema' | 'aura' | 'conectar' | `encuesta:${CampoPregunta}` | 'iniciativa' | 'permisos' | 'fiesta';

export const PASOS: readonly PasoId[] = ['genesis', 'idioma', 'apodo', 'avatar', 'tema', 'aura', 'conectar', ...PREGUNTAS.map((p) => `encuesta:${p.campo}` as const), 'iniciativa', 'permisos', 'fiesta'];

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

/** 0..1 para la barra (la fiesta es el 100 %). */
export function progreso(i: number): number {
  const n = PASOS.length - 1;
  return Math.max(0, Math.min(1, i / n));
}

export function siguiente(i: number): number {
  return Math.min(PASOS.length - 1, i + 1);
}

export function anterior(i: number): number {
  return Math.max(0, i - 1);
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
 * La respuesta de una pregunta → un dato para «lo que sé de ti» (lib/conocer-persona.ts en el servidor).
 * Con su clave: si la vuelve a contestar, el dato se reemplaza en vez de repetirse. null si está vacía.
 */
export function datoConocerDe(campo: CampoPregunta | 'apodo', respuesta: string | undefined): DatoConocer | null {
  const r = String(respuesta || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (r.length < 2) return null;
  switch (campo) {
    case 'trabajo':
      return { categoria: 'trabajo', dato: `Se dedica a: ${r}`, clave: 'oficio' };
    case 'vive':
      return { categoria: 'rutinas', dato: `Vive en ${r}`, clave: 'vive' };
    case 'familia':
      return { categoria: 'familia', dato: `Su familia: ${r}`, clave: 'familia:encuesta' };
    case 'gustos':
      return { categoria: 'gustos', dato: `Le gusta: ${r}`, clave: 'pasatiempos' };
    case 'comida':
      return { categoria: 'gustos', dato: `Comida favorita: ${r}`, clave: 'comida favorita' };
    case 'musica':
      return { categoria: 'gustos', dato: `Música que le gusta: ${r}`, clave: 'musica' };
    case 'ayuda':
      return { categoria: 'metas', dato: `Quiere que AURA le ayude a: ${r}`, clave: 'quiere de aura' };
    case 'apodo':
      return { categoria: 'otros', dato: `Quiere que le digan «${r}»`, clave: 'apodo' };
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
