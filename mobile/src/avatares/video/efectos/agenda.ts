/**
 * LA AGENDA DE LOS EFECTOS: los relojes de una capa (sonidos, vibración, cuándo se desmonta el lienzo) y
 * cuándo sale el sable de luz.
 *
 *  · Todos los relojes de la capa pasan por `Agenda`: `cortar()` los apaga juntos (la tapan, se desmonta)
 *    y después nada suena ni se pinta.
 *  · El golpe del video de un toque suelto espera a que el dedo se quede quieto (`GolpesDeToque`).
 *  · El sable en la mesa vertical va en la mano del video, en el lugar que tiene en la foto base (AGARRES
 *    de escena.ts). Pero la mano no siempre está ahí: con la risa va a la panza, al celebrar sube, al
 *    hablar gesticula (manos.ts, medido en cada clip). Un sable dibujado en ese lugar con la mano en otro
 *    queda en el aire: el «glitch» que más se notaría. Así que:
 *      · con la ráfaga de cuatro toques, el sable espera (hasta ESPERA_MANO_MS) a que la mano quede en su
 *        lugar todo lo que dura (`manoLibreMs` de CuerpoVideo, que sabe lo que se ve y lo que entra: el
 *        `niega` que pidió la ráfaga no mueve las manos). Mientras espera y mientras está en la mano, el
 *        video se queda con su clip (`sostener`): ni otro golpe ni «habla» le sacan la mano. La frase de
 *        molesto es corta y suena con el `niega` (antes «habla» llegaba recién cuando ya había terminado);
 *      · si no llega a tiempo, sale desde el borde (AGARRES_BORDE), sin la mano;
 *      · ya en la mano, sigue mirando: si la mano se fuera igual (un clip que tardó más de lo previsto en
 *        cargar y el cambio no llegó al reposo), el sable se desvanece antes (CORTE_MS) en vez de quedar
 *        en el aire;
 *      · hablando, oyendo, pensando (sutil) o con el comando de voz de la mesa (que habla enseguida), la
 *        voz manda: el video sigue con «habla» (la boca se mueve con la frase) y el sable sale desde el
 *        borde, sin esperar ni sostener nada.
 *    En el retrato y en la llamada la mano queda bajo el borde: el sable ya entra desde abajo y sale ya.
 *
 * Pura y sin React Native: la prueban en Node (pruebas/efectos.prueba.mjs), con reloj inyectable.
 */
import { CORTE_MS, sableEnLaMano, type Anclaje, type LugarEfectos } from './escena';
import type { ClipVideo } from '../guion';
import type { Reaccion } from './toques';

export type Reloj = { poner: (ms: number, f: () => void) => unknown; quitar: (r: unknown) => void };
export const RELOJ_REAL: Reloj = {
  poner: (ms, f) => setTimeout(f, ms),
  quitar: (r) => clearTimeout(r as ReturnType<typeof setTimeout>),
};

/** Los relojes de una capa: todos pasan por aquí y `cortar()` los apaga juntos. */
export class Agenda {
  private readonly vivos = new Set<unknown>();
  constructor(private readonly reloj: Reloj = RELOJ_REAL) {}

  /** Llama a `f` en `ms`. Devuelve el reloj, por si hay que quitarlo antes (`quitar`). */
  despues(ms: number, f: () => void): unknown {
    const r = this.reloj.poner(Math.max(0, ms), () => {
      this.vivos.delete(r);
      f();
    });
    this.vivos.add(r);
    return r;
  }

  quitar(r: unknown) {
    if (!this.vivos.delete(r)) return;
    this.reloj.quitar(r);
  }

  cortar() {
    this.vivos.forEach((r) => this.reloj.quitar(r));
    this.vivos.clear();
  }

  /** Los relojes que quedan por sonar. */
  get pendientes(): number {
    return this.vivos.size;
  }
}

/**
 * El golpe del video de un toque suelto espera esto a que el dedo se quede quieto. Si llega otro toque, se
 * corre al último; si es la ráfaga (sable o blasters) o un «molesto», se descarta. Antes el primer toque de
 * una ráfaga ya pedía su golpe (una risa con la mano en la panza, un saludo con el brazo arriba): al cuarto
 * toque el video estaba a mitad de ese gesto, el `niega` del sable tenía que esperar a que terminara, y el
 * sable tardaba ~1,5 s más en poder estar en la mano. La cara y la voz de la mesa siguen siendo inmediatas.
 */
export const GOLPE_TOQUE_ESPERA_MS = 450;

/** Los golpes del video que piden los toques (`pedir`: pistas.ts, `pedirGolpe`), con la espera de arriba. */
export class GolpesDeToque {
  private reloj: unknown = null;
  private clip: ClipVideo | null = null;
  constructor(
    private readonly agenda: Agenda,
    private readonly pedir: (clip: ClipVideo) => void
  ) {}

  /** Lo que devolvió el motor para un toque. */
  toque(r: Reaccion) {
    if (this.reloj !== null) this.agenda.quitar(this.reloj);
    this.reloj = null;
    if (r.tipo !== 'toque' || r.enSecuencia) {
      // La ráfaga o el «molesto» traen su golpe y va ya; lo que estaba esperando, no.
      this.clip = null;
      if (r.golpe) this.pedir(r.golpe);
      return;
    }
    this.clip = r.golpe ?? this.clip;
    if (!this.clip) return;
    this.reloj = this.agenda.despues(GOLPE_TOQUE_ESPERA_MS, () => {
      this.reloj = null;
      const c = this.clip;
      this.clip = null;
      if (c) this.pedir(c);
    });
  }

  /** Se cortó todo (la agenda ya quitó el reloj): nada queda esperando. */
  olvidar() {
    this.reloj = null;
    this.clip = null;
  }
}

/** Lo más que espera el sable a que la mano del video quede en su lugar. */
export const ESPERA_MANO_MS = 1800;
/** Cada cuánto vuelve a mirar (un reloj de JS, nada por cuadro). */
export const MIRAR_MANO_MS = 100;

/** Cómo sale el sable: dónde, cuánto esperó y cuánto se queda el video con su clip (0: nada). */
export type Arranque = { anclaje: Anclaje; esperoMs: number; sostenerMs: number };

export type Cuerpo = {
  manoLibreMs: () => number;
  sostener: (ms: number) => void;
};

type OpcionesSable = {
  ahora: () => number;
  lugar: LugarEfectos;
  /** Hablando, oyendo, pensando, dormido, en una conversación o en la llamada. */
  sutil: boolean;
  /** Lo pidió la mesa (comando de voz, enojo): habla enseguida. */
  externo: boolean;
  /** Lo que dura el sable a la vista (hasta que se va la empuñadura). */
  necesitaMs: number;
  /** El cuerpo en video (null: sin video que preguntar). */
  cuerpo: Cuerpo | null;
  arrancar: (a: Arranque) => void;
  /** La mano se va antes de que termine: que el sable se desvanezca ya (CORTE_MS). */
  cortar?: () => void;
};

/**
 * Saca el sable cuando corresponde (ver arriba). Devuelve cómo soltar lo sostenido si se corta antes
 * (la capa la llama al cortar); los relojes van en la agenda.
 */
export function sacarSable(agenda: Agenda, o: OpcionesSable): () => void {
  const c = o.cuerpo;
  if (!sableEnLaMano(o.lugar) || !c) {
    o.arrancar({ anclaje: 'mano', esperoMs: 0, sostenerMs: 0 });
    return () => {};
  }
  if (o.sutil || o.externo) {
    o.arrancar({ anclaje: 'borde', esperoMs: 0, sostenerMs: 0 });
    return () => {};
  }
  const t0 = o.ahora();
  let sostenido = true;
  const soltar = () => {
    if (!sostenido) return;
    sostenido = false;
    c.sostener(0);
  };
  // Desde ya: que nada le saque la mano mientras espera (el `niega` de la ráfaga ya está pedido).
  c.sostener(ESPERA_MANO_MS + o.necesitaMs);
  const mirar = () => {
    const esperoMs = o.ahora() - t0;
    if (c.manoLibreMs() >= o.necesitaMs) {
      c.sostener(o.necesitaMs);
      o.arrancar({ anclaje: 'mano', esperoMs, sostenerMs: o.necesitaMs });
      // Se suelta solo al cumplirse (el reloj del guion); al cortar antes, se suelta aquí.
      const fin = o.ahora() + o.necesitaMs;
      const vigilar = () => {
        const queda = fin - o.ahora();
        if (queda <= CORTE_MS) return;
        if (c.manoLibreMs() < CORTE_MS + MIRAR_MANO_MS + 40) {
          soltar();
          o.cortar?.();
          return;
        }
        agenda.despues(Math.min(MIRAR_MANO_MS, queda - CORTE_MS), vigilar);
      };
      agenda.despues(MIRAR_MANO_MS, vigilar);
      return;
    }
    if (esperoMs >= ESPERA_MANO_MS) {
      soltar();
      o.arrancar({ anclaje: 'borde', esperoMs, sostenerMs: 0 });
      return;
    }
    agenda.despues(Math.min(MIRAR_MANO_MS, ESPERA_MANO_MS - esperoMs), mirar);
  };
  mirar();
  return soltar;
}
