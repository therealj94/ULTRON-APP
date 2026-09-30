/**
 * EL FLUJO DE LA PRIMERA VEZ, sin pantallas: qué pasos hay, en qué orden, cuándo se puede seguir,
 * qué se guarda en el perfil y cómo se arma cada respuesta de la encuesta. Vive aparte de React
 * para probarlo en node (las pantallas solo lo dibujan).
 *
 *   genesis  → «Genesis ID compartió contigo» (nombre y cumpleaños con ✔) o pregunta el cumpleaños
 *   apodo    → «¿Cómo quieres que te diga?»
 *   avatar   → Guardián, AU-RA o Claudio, con su vista viva
 *   tema     → Oscuro, Claro o Sistema, aplicado al instante
 *   aura     → AURA se presenta (lo que sabe hacer)
 *   encuesta → una pregunta por tarjeta: dónde vive, comida, música, familia, trabajo, gustos
 *   permisos → micrófono, cámara, Bluetooth, avisos y ubicación, explicados
 *   fiesta   → celebración y a la mesa
 *
 * Cada pregunta de la encuesta es su propio paso: la barra avanza con cada tarjeta, «atrás» vuelve a
 * la anterior y se retoma donde se quedó si Android cierra la app a la mitad.
 */
import type { AvatarId } from '../avatares/catalogo';
import type { Bilingue } from '../i18n';
import type { Encuesta, Perfil, Tema } from '../nucleo/contrato';
import type { NombreIcono } from '../ui/iconos';

export type CampoPregunta = 'vive' | 'comida' | 'musica' | 'familia' | 'trabajo' | 'gustos';

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
];

export type PasoId = 'genesis' | 'apodo' | 'avatar' | 'tema' | 'aura' | `encuesta:${CampoPregunta}` | 'permisos' | 'fiesta';

export const PASOS: readonly PasoId[] = ['genesis', 'apodo', 'avatar', 'tema', 'aura', ...PREGUNTAS.map((p) => `encuesta:${p.campo}` as const), 'permisos', 'fiesta'];

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
  if (completado) c.completado = true;
  return c;
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
