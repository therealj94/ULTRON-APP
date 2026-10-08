/**
 * LAS FRASES DE UNA RESPUESTA, A MEDIDA QUE LLEGAN.
 *
 * El turno en stream (/api/electrum/turno/stream) manda cada frase de la respuesta en cuanto el cerebro
 * la escribe (`frase`: {i, texto, voz}) y al final el texto entero (`fin`, con `frases`: cuántas mandó).
 * La pantalla las va enseñando y la voz las va diciendo; en el `fin` el texto entero reemplaza al que se
 * fue armando, pero lo ya dicho no se repite.
 *
 * Un reintento por red con el mismo `idTurno` puede volver a mandar frases que ya llegaron: van por su
 * número (`i`) y no se dicen dos veces. Un servidor de antes (o la mesa, que habla a varias voces) no
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

export class FrasesDelTurno {
  private readonly vistas = new Map<number, FraseTurno>();

  /** Una frase que llegó. true si es nueva (hay que enseñarla y decirla); false si ya había llegado. */
  recibir(f: FraseTurno): boolean {
    if (this.vistas.has(f.i)) return false;
    this.vistas.set(f.i, f);
    return true;
  }

  /** Cuántas llegaron. */
  get cuantas(): number {
    return this.vistas.size;
  }

  /** El texto que se va armando en la burbuja, en el orden de la respuesta. */
  texto(): string {
    return [...this.vistas.values()]
      .sort((a, b) => a.i - b.i)
      .map((f) => f.texto.trim())
      .filter(Boolean)
      .join(' ');
  }

  /**
   * En el `fin`: ¿hay que decir el texto entero? Solo si no llegó ninguna frase (servidor de antes, la mesa,
   * o `fin.frases` en 0). Si llegaron, ya se dijeron (o se están diciendo): repetirlo sería decirlo dos veces.
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
