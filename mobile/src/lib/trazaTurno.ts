/**
 * LA TRAZA DE UN TURNO HABLADO (José, 6-oct, Samsung SM-S942B: «contestó con voz» pasó de ~2,6 s a ~6 s de mediana con
 * la cámara y el reconocimiento de caras encendidos, y el servidor solo explicaba la mitad). De la frase lista a la voz,
 * cada tramo medido desde la frase, en UNA miga corta por turno (la de siempre, con lo nuevo detrás):
 *
 *   mesa: contestó con voz 6009 ms después de la frase · esc 352/v348 env 360 txt 2900 tts 3600 rel 2500>3150 js 120 cám+caras
 *
 *  · esc   la escena del turno armada (y cuánto se esperó a las voces: v…);
 *  · env   el pedido sale;
 *  · txt   el primer texto de la respuesta (delta o replace del stream);
 *  · tts   el audio de la primera frase bajado (listo para preparar);
 *  · rel   el relleno («déjame ver») pedido > cuándo empezó a sonar (o «tirado»: llegó la respuesta antes de que sonara);
 *  · js    lo más que se trabó el hilo de JS durante el turno (lib/pulsoJs.ts);
 *  · cám   la cámara encendida (+caras: reconociendo).
 *
 * El comienzo no cambia («mesa: contestó con voz N ms después de la frase»): lo que ya leía esas migas sigue igual. Sin
 * React Native: se prueba en Node (tests/latencia-movil.test.ts).
 */

export type MarcaTurno = 'pide' | 'escena' | 'envio' | 'texto' | 'audio' | 'relleno' | 'rellenoSuena' | 'rellenoTirado';

export class TrazaTurno {
  private t0 = 0;
  private marcas = new Map<MarcaTurno, number>();
  private datos: { vozMs?: number } = {};

  /** La frase quedó lista (el oído la entregó) en `t0`. */
  empezar(t0: number) {
    this.t0 = t0 > 0 ? t0 : 0;
    this.marcas.clear();
    this.datos = {};
  }

  /** Solo cuenta la PRIMERA vez de cada marca (el primer texto, el primer audio). Sin turno empezado, nada. */
  marcar(k: MarcaTurno, t = Date.now()) {
    if (!this.t0 || this.marcas.has(k)) return;
    this.marcas.set(k, t);
  }

  dato(k: 'vozMs', v: number) {
    if (this.t0 && Number.isFinite(v)) this.datos[k] = Math.max(0, Math.round(v));
  }

  /** Cuándo empezó el turno (0 = no hay traza: un turno escrito o ya contado). */
  inicio(): number {
    return this.t0;
  }

  /** La miga del turno cuando empieza a sonar la respuesta (`suena`). null sin turno; después se reinicia (una por turno). */
  linea(suena: number, o: { jsMax?: number; camara?: boolean; caras?: boolean } = {}): string | null {
    if (!this.t0) return null;
    const d = (k: MarcaTurno) => {
      const t = this.marcas.get(k);
      return t === undefined ? null : Math.max(0, Math.round(t - this.t0));
    };
    const partes: string[] = [];
    const esc = d('escena');
    if (esc !== null) partes.push(`esc ${esc}${this.datos.vozMs ? `/v${this.datos.vozMs}` : ''}`);
    const env = d('envio');
    if (env !== null) partes.push(`env ${env}`);
    const txt = d('texto');
    if (txt !== null) partes.push(`txt ${txt}`);
    const tts = d('audio');
    if (tts !== null) partes.push(`tts ${tts}`);
    const rel = d('relleno');
    if (rel !== null) {
      const suenaRel = d('rellenoSuena');
      partes.push(suenaRel !== null ? `rel ${rel}>${suenaRel}` : d('rellenoTirado') !== null ? `rel ${rel} tirado` : `rel ${rel}`);
    }
    if (o.jsMax !== undefined && Number.isFinite(o.jsMax)) partes.push(`js ${Math.round(o.jsMax)}`);
    if (o.camara) partes.push(o.caras ? 'cám+caras' : 'cám');
    const total = Math.max(0, Math.round(suena - this.t0));
    this.t0 = 0;
    this.marcas.clear();
    this.datos = {};
    return `mesa: contestó con voz ${total} ms después de la frase${partes.length ? ` · ${partes.join(' ')}` : ''}`;
  }
}
