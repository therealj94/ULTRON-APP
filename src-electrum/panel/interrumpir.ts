/**
 * HABLARLE ENCIMA A DR ELECTRUM COMO A AU-RA.
 *
 * Antes bastaba la energía: 0,3 s de algo más fuerte que el eco aprendido y el doctor se callaba. Un
 * «ajá» de quien escucha, una tos o su propia voz rebotando en una sala con eco lo cortaban a media
 * frase, y lo oído se mandaba como pregunta. Ahora la energía solo PAUSA (o baja) la voz enseguida; lo
 * que decide es el TEXTO de lo que se oyó, con la misma lógica que AU-RA y el teléfono
 * (mobile/src/lib/interrupcion.ts):
 *  · su propio eco (las palabras que el doctor está diciendo) no lo corta: la voz sigue;
 *  · un «ajá», «mjm», «sí sí», «ok» tampoco (como en server/voz-asentir.ts): la voz sigue;
 *  · un «espera», «para», «oye», una orden de pantalla («siguiente», «acércate») o dos palabras suyas
 *    sí: se calla (bajando, no a cuchillo) y lo dicho, sin el eco con que pudo empezar, va a la mesa.
 *
 * Y lo que el oído en vivo a veces «oye» sin voz de verdad («Subtítulos realizados por…», «Gracias por
 * ver») no llega nunca a la mesa.
 *
 * Sin micrófono, sin red y sin DOM: se prueba en Node (tests/electrum-interrumpir.test.ts).
 */
import { esInterrupcionReal, palabras, quitarEco, soloEcoOMuletilla } from '../../mobile/src/lib/interrupcion';
import { limpiarFinal } from '../../mobile/src/lib/turboLogica';

/* ------------------------------------------------------------ asentir no es interrumpir */

/** Lo que dice quien escucha para que se sepa que sigue ahí (la lista de server/voz-asentir.ts). */
const ASENTIR = [
  'ajá', 'sí', 'ok', 'okay', 'mhm', 'claro', 'ya', 'exacto', 'ah ok', 'vale',
  'uh-huh', 'yeah', 'yes', 'right', 'sure', 'got it',
  'aja', 'aha', 'aham', 'ajam', 'mjm', 'mm', 'mmm', 'hmm', 'mhmm', 'uh huh', 'si', 'ah', 'oh ok', 'ujum', 'umjum',
];
const plano = (t: string) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-–—]/g, ' ')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const ASENTIR_PLANO = new Set(ASENTIR.map(plano));

/** ¿La frase es solo asentir («Ajá.», «sí, sí», «mjm»)? Como mucho cuatro palabras, todas de asentir. */
export function esAsentimiento(texto: string): boolean {
  const p = plano(texto);
  if (!p) return false;
  if (ASENTIR_PLANO.has(p)) return true;
  const ps = p.split(' ');
  if (ps.length > 4) return false;
  for (let i = 0; i < ps.length; ) {
    if (i + 1 < ps.length && ASENTIR_PLANO.has(`${ps[i]} ${ps[i + 1]}`)) i += 2;
    else if (ASENTIR_PLANO.has(ps[i])) i += 1;
    else return false;
  }
  return true;
}

/* ------------------------------------------------------------ lo que el oído inventa */

/**
 * Lo que los transcriptores devuelven sobre silencio, ruido o música (lo aprendieron de los subtítulos de
 * internet). Lo de siempre (limpiarFinal: «subtítulos…», «gracias por ver…», «[música]») más lo que se ve en
 * Dr Electrum: créditos de subtítulos, «thanks for watching», notas musicales.
 */
const ALUCINACIONES = [
  /^(¡\s*)?suscr[ií]bete\b/i,
  /^(subt[ií]tulos|subtitulado|subtitles)\s+(realizados\s+)?(por|by)\b/i,
  /amara\.org/i,
  /^(thanks?|thank you)\s+(for|4)\s+watching\b/i,
  /^(m[uú]sica|music|aplausos|applause|risas|silencio)\.?$/i,
  /^[♪♫\s.]+$/,
  /^(www\.|https?:\/\/)/i,
  /^(transcripci[oó]n|subt[ií]tulos)\s+(de|por|en)\b.*$/i,
  /^(no olvides|dale like|like y suscr)/i,
];

/** Una sola palabra repetida una y otra vez («la la la la la la…»): el transcriptor se quedó en un bucle. */
function esBucle(texto: string): boolean {
  const ps = palabras(texto);
  if (ps.length < 6) return false;
  const cuenta = new Map<string, number>();
  for (const p of ps) cuenta.set(p, (cuenta.get(p) || 0) + 1);
  return Math.max(...cuenta.values()) >= ps.length * 0.8;
}

/** El texto limpio de lo que oyó el oído; vacío si es basura del transcriptor y no una persona. */
export function filtrarAlucinacion(texto: string): string {
  const t = limpiarFinal(texto);
  if (!t) return '';
  if (ALUCINACIONES.some((r) => r.test(t)) || esBucle(t)) return '';
  return t;
}

/* ------------------------------------------------------------ el veredicto */

/**
 * Qué fue lo que se oyó mientras el doctor (o la mesa) hablaba:
 *  · `vacio`: nada que valga (silencio, basura del transcriptor);
 *  · `eco`: sus propias palabras rebotando, o muletillas;
 *  · `asentir`: un «ajá», «sí sí», «ok» de quien escucha;
 *  · `real`: la persona le habla: hay que callarse y escucharla.
 * `dichos`: lo que la voz está diciendo (y lo de hace un momento). `esOrden`: ¿es una orden de pantalla?
 * («siguiente», «acércate»): una sola palabra basta, como un «espera».
 */
export type Veredicto = 'vacio' | 'eco' | 'asentir' | 'real';

export function veredictoEncima(texto: string, dichos: readonly string[] = [], esOrden?: (t: string) => boolean): Veredicto {
  const t = filtrarAlucinacion(texto);
  if (!t) return 'vacio';
  if (esAsentimiento(t)) return 'asentir';
  if (soloEcoOMuletilla(t, dichos)) return 'eco';
  if (esOrden?.(quitarEco(t, dichos))) return 'real';
  return esInterrupcionReal(t, dichos) ? 'real' : 'eco';
}

/**
 * ¿Vale la pena bajar la voz mientras se confirma? Lo oído trae algo que no es eco ni muletilla: puede
 * ser la persona. Si al final no lo era, la voz vuelve a su volumen.
 */
export function dudaEncima(parcial: string, dichos: readonly string[] = []): boolean {
  const t = filtrarAlucinacion(parcial);
  return !!t && !esAsentimiento(t) && !soloEcoOMuletilla(t, dichos);
}

/** La frase de quien interrumpió, sin el eco de la voz con que pudo empezar. */
export function textoDeInterrupcion(texto: string, dichos: readonly string[] = []): string {
  return quitarEco(filtrarAlucinacion(texto), dichos);
}

/* ------------------------------------------------------------ decidir y avisar */

/** Lo que necesita `decidirEncima` del oído (oidoTurbo.ts, OpcionesOido). */
export type DecideEncima = {
  dichos: () => string[];
  esOrden?: (texto: string) => boolean;
  interrumpible?: () => boolean;
  /** Era su eco o un «ajá»: que la voz siga. */
  alSeguir: () => void;
  /** Es la persona: que la voz se calle. */
  alInterrumpir: () => void;
};

/**
 * Lo que se decide con cada frase oída encima de la voz, igual con los dos oídos. Devuelve el texto que va a
 * la mesa ('' si no va nada) y avisa a la voz (seguir o callarse).
 */
export function decidirEncima(texto: string, op: DecideEncima, yaCortada: readonly string[] | null): string {
  if (yaCortada) return textoDeInterrupcion(texto, yaCortada);
  const d = op.dichos();
  if (!(op.interrumpible?.() ?? true) || veredictoEncima(texto, d, op.esOrden) !== 'real') {
    op.alSeguir();
    return '';
  }
  op.alInterrumpir();
  return textoDeInterrupcion(texto, d);
}

/** Fallos seguidos del en vivo antes de pasarse al oído de siempre. */
export const FALLOS_TURBO = 3;

/**
 * Cuenta los fallos seguidos del en vivo: un permiso que no llega o un WebSocket que no abre. Un WebSocket
 * que abre pone la cuenta en cero. Al llegar a `tope`, `alRendirse` y la cuenta vuelve a empezar (para la
 * próxima vez que se pruebe el en vivo).
 */
export class VigiaTurbo {
  private fallos = 0;
  constructor(private readonly alRendirse: () => void, private readonly tope = FALLOS_TURBO) {}
  fallo() {
    this.fallos++;
    if (this.fallos >= this.tope) {
      this.fallos = 0;
      this.alRendirse();
    }
  }
  exito() {
    this.fallos = 0;
  }
  get cuenta() {
    return this.fallos;
  }
}
