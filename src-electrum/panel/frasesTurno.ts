/**
 * LAS FRASES DE UNA RESPUESTA, A MEDIDA QUE LLEGAN.
 *
 * El turno en stream (/api/electrum/turno/stream) manda cada frase de la respuesta en cuanto el cerebro
 * la escribe (`frase`: {i, texto, voz}) y al final el texto entero (`fin`, con `frases`: cuántas mandó).
 * La pantalla las va enseñando y la voz las va diciendo; en el `fin` el texto entero reemplaza al que se
 * fue armando, pero lo ya dicho no se repite.
 *
 * Un reintento por red con el mismo `idTurno` puede volver a mandar frases que ya llegaron, o mandar OTRA
 * respuesta (si la primera vez no llegó a guardarse): se comparan por su texto (`reintento`, `llega`), no por su
 * número, y ni se dicen dos veces ni se mezclan dos respuestas. Un servidor de antes (o la mesa, que habla a varias voces) no
 * manda frases: entonces se dice el `fin` entero, como siempre.
 *
 * Sin DOM: se prueba en Node (tests/electrum-frases-turno.test.ts).
 */

export type FraseTurno = { i: number; texto: string; voz: string };

/** Lo que llega en el evento `frase`, validado. null si no sirve. */
export function fraseDeEvento(d: unknown): FraseTurno | null {
  const x = d as Record<string, unknown> | null;
  if (!x || typeof x !== 'object') return null;
  const i = Number(x.i);
  const texto = typeof x.texto === 'string' ? x.texto : '';
  const voz = typeof x.voz === 'string' && x.voz.trim() ? x.voz : texto;
  if (!Number.isSafeInteger(i) || i < 0 || !texto.trim()) return null;
  return { i, texto, voz };
}

/** Para comparar frases de dos intentos: solo letras y cifras, sin tildes ni mayúsculas. */
export function huellaFrase(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, '');
}

/**
 * Qué hacer con una frase que llegó:
 *  · `nueva`: enseñarla y decirla;
 *  · `dicha`: es la misma (por su TEXTO) que ya llegó en el intento anterior: se enseña, no se dice otra vez;
 *  · `reiniciar`: el reintento trae OTRA respuesta (el servidor la volvió a pensar): lo que sonaba de la primera se
 *    calla y se dice la nueva desde su comienzo (`paraDecir()`), para no oír media respuesta de cada una;
 *  · `repetida`: ese número ya llegó en este mismo intento: nada.
 */
export type Llegada = 'nueva' | 'dicha' | 'reiniciar' | 'repetida';

export class FrasesDelTurno {
  private vistas = new Map<number, FraseTurno>();
  /** Las frases del intento anterior (en orden), con su huella: lo que ya se mandó a decir. */
  private anteriores: string[] = [];
  /** Cuántas de las anteriores coincidieron, en orden, con las de este intento. */
  private coinciden = 0;
  /** Este intento ya se apartó de lo anterior (o no había nada anterior). */
  private aparte = true;

  /**
   * Empieza un reintento (mismo `idTurno`): lo que llegó hasta ahora pasa a ser «lo ya dicho», y lo que llegue se
   * compara por su TEXTO, no por su número (un turno repetido de antes se vuelve a cortar y los números se corren; uno
   * que se volvió a pensar es otra respuesta con los mismos números).
   */
  reintento(): void {
    if (this.vistas.size) {
      this.anteriores = this.ordenadas().map((f) => huellaFrase(f.texto));
      this.vistas = new Map();
    }
    this.coinciden = 0;
    this.aparte = this.anteriores.length === 0;
  }

  /** Una frase que llegó: qué hacer con ella (ver `Llegada`). */
  llega(f: FraseTurno): Llegada {
    if (this.vistas.has(f.i)) return 'repetida';
    this.vistas.set(f.i, f);
    if (this.aparte) return 'nueva';
    const h = huellaFrase(f.texto);
    if (this.coinciden < this.anteriores.length && this.anteriores[this.coinciden] === h) {
      this.coinciden++;
      return 'dicha';
    }
    this.aparte = true;
    // Lo anterior entero ya era el comienzo de esta: se sigue donde iba. Si no, es otra respuesta.
    return this.coinciden >= this.anteriores.length ? 'nueva' : 'reiniciar';
  }

  /** Una frase que llegó. true si es nueva en este intento (hay que enseñarla); false si ya había llegado. */
  recibir(f: FraseTurno): boolean {
    return this.llega(f) !== 'repetida';
  }

  /** Lo que hay que decir al `reiniciar`: las frases de este intento, en orden. */
  paraDecir(): string[] {
    return this.ordenadas().map((f) => f.voz);
  }

  /** Cuántas llegaron (en este intento). */
  get cuantas(): number {
    return this.vistas.size;
  }

  /** ¿Se mandó a decir algo en un intento anterior? (un `fin` sin frases tiene que callarlo antes de hablar). */
  get dijoAntes(): boolean {
    return this.anteriores.length > 0;
  }

  /**
   * Un `fin` sin frases en un reintento que ya había dicho algo (un turno repetido que el servidor no partió): de su
   * texto, lo que falta después de lo que ya se mandó a decir, por TEXTO. Si su comienzo no es lo dicho, el texto
   * entero (es otra respuesta: quien lo dice calla lo anterior antes).
   */
  faltaDelFin(texto: string): string {
    const t = String(texto || '').trim();
    const dicho = this.anteriores.join('');
    if (!dicho) return t;
    const piezas = t.match(/[^.!?…\n]+(?:[.!?…]+["'»”)\]]*|\n|$)\s*/g) || [t];
    let acumulado = '';
    let k = 0;
    for (; k < piezas.length; k++) {
      const h = huellaFrase(piezas[k]);
      if (!h) continue;
      if (!dicho.startsWith(acumulado + h)) break;
      acumulado += h;
    }
    return acumulado ? piezas.slice(k).join('').trim() : t;
  }

  private ordenadas(): FraseTurno[] {
    return [...this.vistas.values()].sort((a, b) => a.i - b.i);
  }

  /** El texto que se va armando en la burbuja, en el orden de la respuesta. */
  texto(): string {
    return this.ordenadas()
      .map((f) => f.texto.trim())
      .filter(Boolean)
      .join(' ');
  }

  /**
   * En el `fin`: ¿hay que decir el texto entero? Solo si no llegó ninguna frase en este intento (servidor de antes, la
   * mesa, o `fin.frases` en 0). Si llegaron, ya se dijeron (o se están diciendo): repetirlo sería decirlo dos veces.
   * Aunque `fin.frases` diga que mandó alguna, si aquí no llegó ninguna se dice el `fin`: mejor entero que mudo.
   */
  decirFinEntero(): boolean {
    return this.vistas.size === 0;
  }
}

/**
 * Lo que va en el próximo pedido de voz: las frases que esperan, juntas hasta `tope` letras (menos pedidos y
 * mejor entonación entre frases). La primera de la respuesta va sola (`tope` 0) para que empiece a sonar ya.
 * Una frase sola nunca se parte aquí, aunque pase del tope.
 */
export function juntarFrases(cola: readonly string[], tope: number): { texto: string; usadas: number } {
  let texto = '';
  let usadas = 0;
  for (const f of cola) {
    const t = f.trim();
    if (!t) {
      usadas++;
      continue;
    }
    if (texto && (texto + ' ' + t).length > tope) break;
    texto = texto ? `${texto} ${t}` : t;
    usadas++;
  }
  return { texto, usadas };
}

/**
 * El id de una pregunta (`idTurno`): uno nuevo por pregunta y el MISMO en el reintento por red, para que el
 * servidor sepa que es la misma y no la conteste (ni la cobre) dos veces.
 */
export function nuevoIdTurno(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Tope de lo que viaja como «lo que alcanzó a oír» (como AU-RA, mobile/src/lib/interrupcion.ts). */
export const TOPE_OIDO = 400;

/**
 * Lo que va en `interrumpido` con la pregunta que sigue a una interrupción: lo que la persona alcanzó a oír
 * de la respuesta que cortó (el cerebro retoma de ahí en vez de repetirse). null: no cortó nada. Si es
 * largo se queda el FINAL: lo que importa es dónde quedó.
 */
export function interrumpidoDelTurno(oido: string | null): { oido: string } | undefined {
  if (oido === null) return undefined;
  const t = String(oido).trim();
  return { oido: t.length > TOPE_OIDO ? `…${t.slice(-(TOPE_OIDO - 1)).trimStart()}` : t };
}
