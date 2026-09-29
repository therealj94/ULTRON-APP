/**
 * LA MESA DE TRABAJO: tres personas con oficio, no tres voces para lo mismo.
 *
 *  · Dr Electrum — geólogo sénior. Dirige la mesa: dónde está el mineral, cuánto hay de verdad, qué
 *    vale y en qué papel está el derecho (catastro, ley minera, datum).
 *  · Don Chema — metalurgista y minero de planta. Con qué se saca y cómo se procesa ESE mineral:
 *    arma el diagrama de flujo de la planta, sus equipos y su capacidad.
 *  · Ing. Tatiana — ingeniera civil y ambiental. Cómo se construye lo que Don Chema propone (obra
 *    civil, relaves, agua, energía, costo y plazo) y qué licencia ambiental y cuidados exige.
 *
 * Cada uno es DUEÑO de especialidades del panel (especialistas.ts): cuando la pregunta es de planta
 * contesta Don Chema con su voz y su cara; cuando es de obra o de licencia, Tatiana; y cuando toca a
 * más de uno, contestan los dos, cada uno de lo suyo, y se contestan entre ellos. «Mesa técnica»
 * los junta a los tres para analizar y decidir; el doctor cierra con la recomendación.
 *
 * Los datos de concesiones siguen saliendo SOLO de las herramientas. Lo que cada uno sabe de oficio
 * (procesos, equipos, obras, trámites) sí lo dice con la seguridad de quien lo ha hecho.
 */
import type { EspecialistaId } from './especialistas';

export type Personaje = 'electrum' | 'tatiana' | 'chema' | 'narrador';
export type Experto = Exclude<Personaje, 'narrador'>;

export type Oficio = {
  nombre: string;
  titulo: string;
  especialidades: EspecialistaId[];
  /** Lo que sabe de verdad. Va al modelo solo cuando habla. */
  saber: string;
  /** Cómo habla. */
  estilo: string;
};

export const OFICIOS: Record<Experto, Oficio> = {
  electrum: {
    nombre: 'Dr Electrum',
    titulo: 'geólogo sénior, cuarenta años de campo',
    especialidades: ['geologo', 'geomatica', 'legal', 'economista'],
    saber:
      'geología económica y regional de Honduras, modelos de yacimiento (epitermal, pórfido, skarn, VMS, placer), exploración, muestreo, recursos y reservas (JORC, NI 43-101), catastro y ley minera, datum y valor del proyecto',
    estilo: 'pausado, de señor del oficio; dirige la mesa y cierra con la recomendación',
  },
  chema: {
    nombre: 'Don Chema',
    titulo: 'metalurgista y minero de planta',
    especialidades: ['metalurgista', 'minas'],
    saber:
      'la planta según el mineral: oro libre (gravimetría, concentrador centrífugo, mesas), óxidos (lixiviación en pilas, ADR, Merrill-Crowe), sulfuros y refractarios (flotación, CIL/CIP, tostación, BIOX), Cu y Pb-Zn por flotación diferencial, no metálicos (chancado y clasificación); arma el diagrama de flujo con equipos y capacidad en t/d, y sabe de métodos de explotación, dilución y seguridad',
    estilo: 'práctico, sencillo, con algún refrán de Olancho, pero exacto en los números',
  },
  tatiana: {
    nombre: 'Ing. Tatiana',
    titulo: 'ingeniera civil y ambiental',
    especialidades: ['civil', 'ambiental'],
    saber:
      'cómo se construye lo que propone Don Chema: obra civil, cimentaciones de molinos, naves, presas de relaves y botaderos, caminos, agua y energía, costo y cronograma de obra; licencia ambiental (MiAmbiente/SERNA), EIA, permisos de agua e ICF, drenaje ácido, monitoreo y cierre',
    estilo: 'ordenada y directa; piensa en permisos y riesgos antes de mover tierra',
  },
};

export const EXPERTOS = Object.keys(OFICIOS) as Experto[];

/** De quién es cada especialidad. */
export function duenioDe(id: EspecialistaId): Experto {
  return EXPERTOS.find((p) => OFICIOS[p].especialidades.includes(id)) || 'electrum';
}

/** Quiénes hablan con este panel, sin repetir y en su orden. */
export function quienesDe(panel: Array<{ id: EspecialistaId }>): Experto[] {
  return [...new Set(panel.map((e) => duenioDe(e.id)))];
}

const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** «Don Chema, ¿qué planta…?», «Tatiana, ¿cómo lo construyo?»: llamados por su nombre. */
export function llamados(mensaje: string): EspecialistaId[] {
  const q = fold(mensaje);
  const out: EspecialistaId[] = [];
  if (/\b(don chema|chema|metalurgista)\b/.test(q)) out.push('metalurgista');
  if (/\b(tatiana|ingeniera)\b/.test(q)) out.push('civil');
  return out;
}

/** Las formas de juntar a los tres. */
export function esMesa(mensaje: string): boolean {
  return /\b(mesa tecnica|mesa de trabajo|entre los tres|opinen los tres|los tres opinen|opine la mesa|opinen todos|junta tecnica|consejo tecnico|todo el equipo)\b/.test(fold(mensaje));
}

/** La mesa entera: una especialidad por persona. */
export const PANEL_MESA: EspecialistaId[] = ['geologo', 'metalurgista', 'civil'];

/**
 * Lo que el modelo necesita saber para hablar como la mesa. Va pegado a la pregunta (no al system:
 * el system está medido contra el tope del nodo y esto solo hace falta cuando habla alguien más
 * que el doctor). null si contesta solo Dr Electrum como siempre.
 */
export function bloqueMesa(quienes: Experto[], mesa: boolean): string | null {
  if (!mesa && !quienes.some((q) => q !== 'electrum')) return null;
  const hablan = mesa ? EXPERTOS : quienes;
  const fichas = hablan.map((p) => `· ${OFICIOS[p].nombre} (${OFICIOS[p].titulo}): sabe ${OFICIOS[p].saber}. Habla ${OFICIOS[p].estilo}.`);
  return [
    `MESA DE TRABAJO — contesta${hablan.length > 1 ? 'n' : ''} ${hablan.map((p) => OFICIOS[p].nombre).join(', ')}:`,
    ...fichas,
    'FORMATO: cada intervención en su propio párrafo y empezando con el nombre en negrita, así: **Don Chema:** … (hasta tres frases por intervención; la etiqueta de voz, si va, justo después del nombre).',
    hablan.length > 1
      ? 'Se contestan entre ellos: cada uno aporta lo suyo sobre lo que dijo el otro (Tatiana construye y permisa lo que Don Chema propone; el doctor lo aterriza en la geología y el valor).'
      : '',
    mesa ? 'Analizan juntos y CIERRA Dr Electrum con la recomendación de la mesa en una o dos frases.' : '',
    'El oficio lo saben de verdad; los datos de una concesión, solo de las herramientas.',
  ]
    .filter(Boolean)
    .join('\n');
}

/* ------------------------------------------------------------ de la respuesta a las voces */

const ETIQUETA = /^[\s>*_-]*\**\s*(dr\.?\s*electrum|doctor|electrum|don\s+chema|chema|ing\.?\s*tatiana|ingeniera\s+tatiana|tatiana)\s*\**\s*:\s*\**\s*/i;

function quienDeEtiqueta(e: string): Experto {
  const f = fold(e);
  if (f.includes('chema')) return 'chema';
  if (f.includes('tatiana')) return 'tatiana';
  return 'electrum';
}

export type Voz = { quien: Experto; texto: string };

/** Parte una intervención larga en líneas que caben en el diálogo de ElevenLabs, por frases. */
export function partirLargo(texto: string, tope = 450): string[] {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (t.length <= tope) return t ? [t] : [];
  const frases = t.match(/[^.!?…]+[.!?…]+["»”]?\s*|[^.!?…]+$/g) || [t];
  const out: string[] = [];
  let actual = '';
  for (const f of frases) {
    if (actual && (actual + f).length > tope) {
      out.push(actual.trim());
      actual = '';
    }
    actual += f;
    while (actual.length > tope) {
      const corte = actual.lastIndexOf(' ', tope);
      const i = corte > tope / 2 ? corte : tope;
      out.push(actual.slice(0, i).trim());
      actual = actual.slice(i);
    }
  }
  if (actual.trim()) out.push(actual.trim());
  return out;
}

/**
 * Las intervenciones de una respuesta de la mesa («**Don Chema:** …»). Sin ninguna etiqueta
 * devuelve []; lo que va antes de la primera etiqueta es del doctor.
 */
export function vocesDe(texto: string): Voz[] {
  const bloques: Voz[] = [];
  let actual: Voz | null = null;
  let hubo = false;
  for (const linea of String(texto || '').split('\n')) {
    const m = linea.match(ETIQUETA);
    if (m) {
      hubo = true;
      if (actual && actual.texto.trim()) bloques.push(actual);
      actual = { quien: quienDeEtiqueta(m[1]), texto: linea.slice(m[0].length) };
    } else if (actual) actual.texto += `\n${linea}`;
    else if (linea.trim()) actual = { quien: 'electrum', texto: linea };
  }
  if (actual && actual.texto.trim()) bloques.push(actual);
  if (!hubo) return [];
  // Dos seguidas del mismo se juntan; las largas se parten.
  const juntas: Voz[] = [];
  for (const b of bloques) {
    const t = b.texto.replace(/\*\*/g, '').trim();
    if (!t) continue;
    const ultima = juntas[juntas.length - 1];
    if (ultima && ultima.quien === b.quien) ultima.texto += ` ${t}`;
    else juntas.push({ quien: b.quien, texto: t });
  }
  return juntas.flatMap((b) => partirLargo(b.texto).map((texto) => ({ quien: b.quien, texto })));
}

/** El texto para leer (pantalla, hilo, Telegram): «Don Chema: …» sin asteriscos ni etiquetas. */
export function textoDeVoces(voces: Voz[]): string {
  const juntas: Voz[] = [];
  for (const v of voces) {
    const t = v.texto.replace(/\[[^\]\n]{1,40}\]\s*/g, '').trim();
    const u = juntas[juntas.length - 1];
    if (u && u.quien === v.quien) u.texto += ` ${t}`;
    else juntas.push({ quien: v.quien, texto: t });
  }
  return juntas.map((v) => `${OFICIOS[v.quien].nombre}: ${v.texto}`).join('\n\n');
}

/**
 * Las voces de un turno. Con etiquetas, las de las etiquetas. Sin etiquetas pero con el panel de
 * UNA persona que no es el doctor, todo es de esa persona (contestó Don Chema aunque no se
 * presentara). Con solo el doctor, [] (se dice con su voz de siempre).
 */
export function vocesDelTurno(dicho: string, quienes: Experto[]): Voz[] {
  const v = vocesDe(dicho);
  if (v.length) return v.some((x) => x.quien !== 'electrum') ? v : [];
  if (quienes.length === 1 && quienes[0] !== 'electrum') {
    return partirLargo(String(dicho || '').replace(/\*\*/g, '')).map((texto) => ({ quien: quienes[0], texto }));
  }
  return [];
}
