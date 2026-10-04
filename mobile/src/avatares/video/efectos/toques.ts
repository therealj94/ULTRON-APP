/**
 * LOS TOQUES A CLAUDIO Y ANT-ONIO EN VIDEO: qué pasa cada vez que alguien los toca.
 *
 *  · Un toque suelto: una onda de luz donde cayó el dedo y, a veces, un golpe del video (se ríe, duda, se
 *    sorprende, asiente, celebra, saluda…), variado: nunca el mismo dos veces seguidas, ninguno que el
 *    guion no vaya a hacer (ENFRIAR_GOLPE_MS) y no más de uno cada GOLPE_ENTRE_MS, para que tocar seguido
 *    no encadene fundidos.
 *  · Cuatro toques en VENTANA_MS (la misma ventana que el «ya, ya» de la mesa, DeskScreen.onTap): se
 *    molesta y saca el SABLE de luz o empiezan a volar los BLASTERS. Claudio prefiere el sable y ANT-ONIO
 *    los blasters, pero cualquiera puede salir, y nunca tres veces seguidas lo mismo.
 *  · Una secuencia a la vez. Después, ENFRIAR_MS de descanso: otra ráfaga en ese rato solo lo molesta
 *    (niega con la cabeza), sin sable ni blasters.
 *
 * Nunca se mete con la voz ni con la conversación: si habla, oye a la persona, piensa, duerme, hay una
 * conversación o una llamada, todo es SUTIL (sin sonido, sin golpes del video, sin frase; la ráfaga es una
 * versión chica y corta). Lo que decide si una ráfaga es sutil es cómo estaba al EMPEZAR la ráfaga: el
 * primer toque puede hacerlo hablar (la frase del toque de la mesa), y eso no le quita el sable al cuarto.
 * Una conversación o una llamada que empieza en medio sí la vuelve sutil.
 *
 * «Reducir movimiento» no quita nada: lo vuelve quieto (escena.ts dibuja el sable sin blandir y los
 * blasters sin volar ni sacudir la pantalla). Los golpes del video ya los quita el guion.
 *
 * Puro y sin React Native: lo prueban en Node (pruebas/efectos.prueba.mjs), con reloj y azar inyectables.
 */
import { ENFRIAR_GOLPE_MS, type ClipVideo } from '../guion';

export type AvatarVideo = 'claudio' | 'antonio';
export type Efecto = 'espada' | 'blasters';
export type ZonaToque = 'cabeza' | 'panza';

/** Toques que hacen una ráfaga. */
export const TOQUES_RAFAGA = 4;
/** Los toques de una ráfaga caben en esto (igual que `recentTaps` de DeskScreen: el «ya, ya» y el sable llegan juntos). */
export const VENTANA_MS = 2200;
/** Entre una secuencia (sable o blasters) y la siguiente, contado desde que empezó. */
export const ENFRIAR_MS = 12_000;
/** Entre un golpe pedido por un toque y el siguiente: tocar rápido no encadena fundidos de video. */
export const GOLPE_ENTRE_MS = 2600;

/** Lo que dura cada secuencia (ms): entera, sutil (hablando, en la llamada…) y quieta («reducir movimiento»). */
export const DURACION: Record<Efecto, { completa: number; sutil: number; quieta: number }> = {
  espada: { completa: 3200, sutil: 1700, quieta: 2000 },
  blasters: { completa: 2600, sutil: 1400, quieta: 2000 },
};
export function duracionEfecto(efecto: Efecto, sutil: boolean, reducido: boolean): number {
  const d = DURACION[efecto];
  return reducido ? d.quieta : sutil ? d.sutil : d.completa;
}

/** Cuánto prefiere el sable cada uno (el resto, blasters). */
export const PREFIERE_ESPADA: Record<AvatarVideo, number> = { claudio: 0.7, antonio: 0.3 };

/** El golpe del video que acompaña a cada secuencia: con el sable se molesta (niega: las manos quietas, el sable no se despega); con los blasters se asusta. */
export const GOLPE_DE_EFECTO: Record<Efecto, ClipVideo> = { espada: 'niega', blasters: 'sorpresa' };

/** Los golpes de un toque suelto, por zona, con su peso. La risa es la de siempre; lo demás, para que no sea siempre lo mismo. */
export const GOLPES_DE_TOQUE: Record<ZonaToque, readonly (readonly [ClipVideo, number])[]> = {
  cabeza: [
    ['risa', 3],
    ['duda', 1.5],
    ['sorpresa', 1],
    ['asiente', 1],
  ],
  panza: [
    ['risa', 3],
    ['celebra', 1.2],
    ['sorpresa', 1],
    ['saluda', 1],
  ],
};
/** Molesto (otra ráfaga mientras descansa): niega; si ya negó hace poco, duda. */
const GOLPES_MOLESTO: readonly ClipVideo[] = ['niega', 'duda'];

/** Cómo está el avatar cuando lo tocan. */
export type Contexto = {
  /** Suena su voz. */
  hablando?: boolean;
  /** Oye a la persona (está hablando ella). */
  escuchando?: boolean;
  /** Esperando al cerebro. */
  pensando?: boolean;
  /** Dormido (silenciado): la mesa lo despierta con el toque. */
  dormido?: boolean;
  /** Hay una conversación o una llamada que tiene el micrófono. */
  conversando?: boolean;
  /** Se dibuja en el círculo de la llamada. */
  enLlamada?: boolean;
  /** «Reducir movimiento» del sistema. */
  reducido?: boolean;
};

/** ¿Hay algo que no hay que pisar? Entonces todo es sutil. */
export const esSutil = (c: Contexto) => !!(c.hablando || c.escuchando || c.pensando || c.dormido || c.conversando || c.enLlamada);
/** Lo que vuelve sutil una ráfaga aunque haya empezado tranquila: la conversación o la llamada. */
const pisaVoz = (c: Contexto) => !!(c.conversando || c.enLlamada);

type Comun = { x: number; y: number; sutil: boolean; reducido: boolean; golpe: ClipVideo | null };
export type Reaccion =
  /** Un toque: la onda donde tocó y quizá un golpe. `enSecuencia`: cayó con el sable o los blasters a la vista (solo la onda). */
  | (Comun & { tipo: 'toque'; enSecuencia: boolean })
  /** La ráfaga: sable o blasters. `sonido`: con efectos de sonido; `voz`: que la mesa diga su frase de molesto. */
  | (Comun & { tipo: 'secuencia'; efecto: Efecto; n: number; duracion: number; sonido: boolean; voz: boolean; externo: boolean })
  /** Otra ráfaga durante el descanso: solo molesto. */
  | (Comun & { tipo: 'molesto' });

type Opciones = { avatar: AvatarVideo; rng?: () => number };

/** El motor de los toques de un cuerpo. La vista le pasa cada toque (con la hora y el contexto) y hace lo que devuelve. */
export class MotorToques {
  private readonly avatar: AvatarVideo;
  private readonly rng: () => number;
  private toques: number[] = [];
  /** Cómo estaba al empezar la ráfaga en curso. */
  private rafagaSutil = false;
  private secuencia: { desde: number; hasta: number } | null = null;
  private efectos: Efecto[] = [];
  private n = 0;
  private ultimoGolpe = -Infinity;
  private golpePrevio: ClipVideo | null = null;
  private golpesHechos = new Map<ClipVideo, number>();

  constructor(o: Opciones) {
    this.avatar = o.avatar;
    this.rng = o.rng || Math.random;
  }

  /** ¿Hay una secuencia a la vista? */
  enCurso(ahora: number): boolean {
    return !!this.secuencia && ahora < this.secuencia.hasta;
  }

  /** ¿Está descansando de la última secuencia? */
  descansando(ahora: number): boolean {
    return !!this.secuencia && ahora - this.secuencia.desde < ENFRIAR_MS;
  }

  /** Un toque en (x, y) de la caja, en la zona `zona` del cuerpo. */
  tocar(ahora: number, c: Contexto, zona: ZonaToque = 'cabeza', x = 0, y = 0): Reaccion {
    const reducido = !!c.reducido;
    this.toques = this.toques.filter((t) => ahora - t < VENTANA_MS);
    if (!this.toques.length) this.rafagaSutil = esSutil(c);
    this.toques.push(ahora);
    const sutilAhora = esSutil(c);

    // Con el sable o los blasters a la vista: solo la onda (una secuencia a la vez, nada se apila).
    if (this.enCurso(ahora)) {
      if (this.toques.length >= TOQUES_RAFAGA) this.toques = [];
      return { tipo: 'toque', enSecuencia: true, x, y, sutil: true, reducido, golpe: null };
    }

    if (this.toques.length >= TOQUES_RAFAGA) {
      this.toques = [];
      const sutil = this.rafagaSutil || pisaVoz(c);
      if (this.descansando(ahora)) {
        // Niega con la cabeza; si ya negó hace poco, duda; si tampoco, solo la onda.
        let golpe: ClipVideo | null = null;
        for (const g of GOLPES_MOLESTO) if (!sutil && !golpe) golpe = this.elegirGolpe(ahora, [[g, 1]], true);
        return { tipo: 'molesto', x, y, sutil, reducido, golpe };
      }
      return this.empezar(ahora, this.elegirEfecto(), sutil, reducido, x, y, false);
    }

    const golpe = sutilAhora ? null : this.elegirGolpe(ahora, GOLPES_DE_TOQUE[zona], false);
    return { tipo: 'toque', enSecuencia: false, x, y, sutil: sutilAhora, reducido, golpe };
  }

  /**
   * Lo pidió la app (la mesa disparó su blaster o su sable: el comando de voz, o el enojo de muchos toques).
   * Sin sonido (la mesa ya lo puso). null si ya hay una secuencia a la vista: nunca dos encimadas. No
   * espera el descanso (lo pidió la app, no un dedo), pero lo reinicia.
   */
  ataque(ahora: number, efecto: Efecto, c: Contexto): Reaccion | null {
    if (this.enCurso(ahora)) return null;
    // La mesa ya está hablando su frase: eso no lo vuelve sutil; una conversación o la llamada, sí.
    return this.empezar(ahora, efecto, pisaVoz(c), !!c.reducido, -1, -1, true);
  }

  /** El cuerpo se tapó o se fue: la secuencia en curso se da por terminada (el descanso sigue contando). */
  cancelar(ahora: number) {
    this.toques = [];
    if (this.secuencia && ahora < this.secuencia.hasta) this.secuencia = { ...this.secuencia, hasta: ahora };
  }

  private empezar(ahora: number, efecto: Efecto, sutil: boolean, reducido: boolean, x: number, y: number, externo: boolean): Reaccion {
    const duracion = duracionEfecto(efecto, sutil, reducido);
    this.secuencia = { desde: ahora, hasta: ahora + duracion };
    this.efectos = [...this.efectos.slice(-1), efecto];
    this.n += 1;
    // El golpe de la secuencia no espera GOLPE_ENTRE_MS (gana al del primer toque), pero sí el enfriamiento del guion.
    const golpe = sutil ? null : this.elegirGolpe(ahora, [[GOLPE_DE_EFECTO[efecto], 1]], true);
    return { tipo: 'secuencia', efecto, n: this.n, duracion, x, y, sutil, reducido, golpe, sonido: !sutil && !externo, voz: !sutil && !externo, externo };
  }

  /** Sable o blasters: el gusto de cada uno, pero nunca tres veces seguidas lo mismo. */
  private elegirEfecto(): Efecto {
    const [a, b] = this.efectos;
    if (a && a === b) return a === 'espada' ? 'blasters' : 'espada';
    return this.rng() < PREFIERE_ESPADA[this.avatar] ? 'espada' : 'blasters';
  }

  /** Un golpe de la lista que el guion vaya a hacer (sin enfriar), sin repetir el anterior; null si ninguno o si es muy pronto. */
  private elegirGolpe(ahora: number, lista: readonly (readonly [ClipVideo, number])[], urgente: boolean): ClipVideo | null {
    if (!urgente && ahora - this.ultimoGolpe < GOLPE_ENTRE_MS) return null;
    const libres = lista.filter(([g]) => {
      const antes = this.golpesHechos.get(g);
      return (antes === undefined || ahora - antes >= ENFRIAR_GOLPE_MS) && (urgente || g !== this.golpePrevio);
    });
    if (!libres.length) return null;
    const total = libres.reduce((s, [, p]) => s + p, 0);
    let r = this.rng() * total;
    let elegido = libres[libres.length - 1][0];
    for (const [g, p] of libres) {
      if (r < p) {
        elegido = g;
        break;
      }
      r -= p;
    }
    this.ultimoGolpe = ahora;
    this.golpePrevio = elegido;
    this.golpesHechos.set(elegido, ahora);
    return elegido;
  }
}
