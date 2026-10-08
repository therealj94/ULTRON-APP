/**
 * LA RESPUESTA DE DR ELECTRUM, FRASE POR FRASE, MIENTRAS LLEGA (/api/electrum/turno/stream, evento `frase`).
 *
 * Antes la pantalla y el teléfono no recibían una palabra hasta el `fin`: la voz empezaba cuando el turno entero (con
 * sus tres vueltas de herramientas) ya había terminado. Ahora cada frase cerrada sale en cuanto el modelo la escribe,
 * con dos caras:
 *
 *   { i, texto, voz }   `texto` para leer (sin los códigos de cita sin verificar ni las etiquetas de expresión) y
 *                       `voz` para decir (además sin las citas legibles, sin markdown ni fórmulas de asistente:
 *                       lib/habla-natural.ts PulidorVoz, con la voz del doctor).
 *
 * Dónde se corta es el contrato compartido con la app (lib/trozos.ts puntoDeCorte → mobile/src/lib/cortesVoz.ts).
 * Lo que una vuelta dice antes de pedir una herramienta («Déjame mirar el catastro») también sale: es lo que diría
 * cualquiera mientras busca. Lo que NO sale mientras llega, porque las guardas del final pueden cambiarlo:
 *   · lo que da algo por hecho («te generé el informe», «lo puse en el mapa»; server/electrum/honestidad.ts);
 *   · lo que dice que algo ya está en el mapa (lo revisan las garantías del mapa: mapa-garantia.ts, geo-garantia.ts);
 *   · lo que repite tal cual una respuesta anterior (lib/repeticion.ts).
 * Desde esa frase, esa vuelta se retiene entera.
 *
 * Al final (`finalizar`), con el texto que de verdad vale (ya con las citas verificadas y las garantías), sale como
 * `frase` lo que falte: las frases de la respuesta final que no sonaron ya en la última vuelta. Así quien escucha
 * frases no necesita el `fin` para decir nada: el `fin.texto` sigue siendo el texto de autoridad y `fin.frases` dice
 * cuántas frases salieron (para no volver a decirlas). La mesa (varias voces) no pasa por aquí.
 */
import { cortesDesde } from '../../lib/trozos';
import { limpiarTexto } from '../../lib/agente/protocolo';
import { extraerEmocion } from '../../lib/emocion';
import { quitarExpresiones } from '../../lib/expresiones';
import { PulidorVoz } from '../../lib/habla-natural';
import { trozoRepite } from '../../lib/repeticion';
import { trozoAfirmaHechoElectrum } from './honestidad';
import { DICE_MAPA } from './mapa-garantia';
import { DICE_MAPAS_GEO } from './geo-garantia';

export type Frase = { i: number; texto: string; voz: string };

/** Los códigos de cita que escribe el modelo ([D12-p5], [D12]): sin verificar todavía, no se enseñan ni se dicen. */
const CODIGO_CITA = /\s?\[D\d+(?:-p\d+)?\]/g;
/** La cita ya verificada (evidencias.ts: « (Informe JICA, p. 31)») y la fuente de internet («(fuente: ihcafe.hn)»). */
const CITA_LEGIBLE = /\s?\((?:[^()\n]{1,160}, p\. ?\d+[^()\n]{0,60}|[^()\n]{1,160}, (?:transcripción de foto sin revisar|unreviewed photo transcription)|fuente: [^()\n]{1,120}|source: [^()\n]{1,120})\)/gi;
/** Lo que empieza un pedido de herramienta escrito en el texto (Hermes, XML o el formato viejo): desde ahí no se suelta. */
const PEDIDO = /<tool_call|<function=|PEDIR_HERRAMIENTA/i;

/** Sin códigos de cita, etiquetas de herramienta, de ánimo ni de expresión: lo que se enseña de una frase. */
export function textoDeFrase(crudo: string): string {
  const t = limpiarTexto(String(crudo || '')).replace(CODIGO_CITA, '');
  return quitarExpresiones(extraerEmocion(t).texto)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Lo que se dice de un texto: además sin citas legibles ni ninguna etiqueta entre corchetes. Sin pulir. */
export function sinCitasParaVoz(texto: string): string {
  return textoDeFrase(texto)
    .replace(CITA_LEGIBLE, '')
    .replace(/[ \t]*\[[^\]\n]{1,40}\](?!\()/g, '')
    .replace(/[ \t]+([,.;:!?…])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Para comparar lo dicho con lo final: solo letras y cifras, sin tildes ni mayúsculas. */
export function huella(texto: string): string {
  return sinCitasParaVoz(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, '');
}

/** ¿Esta frase puede cambiarla una guarda del final? Entonces no se suelta mientras llega. */
export function fraseARetener(frase: string, previas: readonly string[] = []): boolean {
  const t = textoDeFrase(frase);
  return trozoAfirmaHechoElectrum(t) || DICE_MAPA.test(t) || DICE_MAPAS_GEO.test(t) || (previas.length > 0 && trozoRepite(t, previas));
}

/** Las frases de un texto entero, por los mismos cortes que el stream. */
export function partirEnFrases(texto: string): string[] {
  const t = String(texto || '');
  const out: string[] = [];
  let enviado = 0;
  for (const fin of cortesDesde(t, 0)) {
    out.push(t.slice(enviado, fin));
    enviado = fin;
  }
  if (t.slice(enviado).trim()) out.push(t.slice(enviado));
  return out.filter((f) => f.trim());
}

export type OpcionesCortador = {
  emitir: (f: Frase) => void;
  idioma?: 'es' | 'en';
  /** Lo que dijo la persona (para el pulidor: la honestidad sobre qué es, un tema serio). */
  mensaje?: string;
  /** Sus últimas respuestas en el hilo (lib/repeticion.ts previasDe). */
  previas?: readonly string[];
};

/** Corta lo que va llegando y emite las frases cerradas. Una instancia por turno. */
export class CortadorFrases {
  private cuerpo = '';
  private enviado = 0;
  private retenido = false;
  private i = 0;
  /** Huellas de lo que sonó en la vuelta en curso y en la última vuelta que soltó algo. */
  private ronda: string[] = [];
  private ultimaRonda: string[] = [];
  private readonly pulidor: PulidorVoz;

  constructor(private readonly o: OpcionesCortador) {
    // Sin etiquetas de voz (la frase rápida no las entiende) y sin cambiar aperturas: solo lo que sobra al decirlo.
    this.pulidor = new PulidorVoz({ idioma: o.idioma, mensaje: o.mensaje, avatar: 'electrum', maxEtiquetas: 0 });
  }

  /** Cuántas frases salieron (va en `fin.frases`). */
  get cuantas(): number {
    return this.i;
  }

  /** Un trozo de texto de la vuelta en curso, tal como llega del modelo. */
  empujar(trozo: string): void {
    if (!trozo) return;
    this.cuerpo += trozo;
    this.soltar(false);
  }

  /** Terminó una vuelta del modelo: lo que quedó sin punto también se dice, y la próxima vuelta empieza de cero. */
  finDeRonda(): void {
    this.soltar(true);
    if (this.ronda.length) this.ultimaRonda = this.ronda;
    this.ronda = [];
    this.cuerpo = '';
    this.enviado = 0;
    this.retenido = false;
  }

  /**
   * El turno terminó con este texto (el de autoridad, el que se dice). Sale lo que falte: las frases que no sonaron ya
   * en la última vuelta, desde la primera que no coincide. Devuelve cuántas salieron aquí.
   */
  finalizar(textoFinal: string): number {
    // Lo que quedaba a medias de la vuelta en curso ya no se suelta por su cuenta: lo decide el texto final.
    if (this.cuerpo) {
      if (this.ronda.length) this.ultimaRonda = this.ronda;
      this.ronda = [];
      this.cuerpo = '';
      this.enviado = 0;
    }
    const piezas = partirEnFrases(sinCitasParaVoz(textoFinal));
    const dicho = this.ultimaRonda.join('');
    let acumulado = '';
    let k = 0;
    let resto: string | null = null;
    for (; k < piezas.length && dicho; k++) {
      const h = huella(piezas[k]);
      if (!h) continue;
      if (dicho.startsWith(acumulado + h)) {
        acumulado += h;
        continue;
      }
      // Lo dicho terminó a media pieza (se soltó en una coma): sale solo lo que falta de esa pieza.
      const falta = dicho.slice(acumulado.length);
      if (falta && (acumulado + h).startsWith(dicho)) {
        resto = colaDespuesDe(piezas[k], falta);
        k++;
      }
      break;
    }
    const antes = this.i;
    if (resto) this.emitirFrase(resto);
    for (const p of piezas.slice(k)) this.emitirFrase(p);
    this.ultimaRonda = [];
    return this.i - antes;
  }

  private soltar(todo: boolean): void {
    if (this.retenido) return;
    // Hasta un pedido de herramienta escrito en el texto (si lo hay): eso no se dice nunca.
    const p = PEDIDO.exec(this.cuerpo);
    const base = p ? this.cuerpo.slice(0, p.index) : this.cuerpo;
    const cortes = cortesDesde(base, this.enviado);
    // Al cerrar la vuelta, lo que quedó sin punto también es una frase.
    if (todo && base.slice(cortes.length ? cortes[cortes.length - 1] : this.enviado).trim()) cortes.push(base.length);
    for (const hasta of cortes) {
      const frase = base.slice(this.enviado, hasta);
      if (fraseARetener(frase, this.o.previas)) {
        this.retenido = true;
        return;
      }
      this.enviado = hasta;
      // Cuenta como dicha aunque el pulidor la callara (una fórmula de asistente): al final no se vuelve a mirar.
      this.emitirFrase(frase);
      this.ronda.push(huella(frase));
    }
  }

  /** Sale una frase si tiene algo que decir. */
  private emitirFrase(crudo: string): boolean {
    const texto = textoDeFrase(crudo);
    const voz = this.pulidor.trozo(sinCitasParaVoz(crudo)).replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(texto) || !/[\p{L}\p{N}]/u.test(voz)) return false;
    this.o.emitir({ i: this.i++, texto, voz });
    return true;
  }
}

/** Lo que queda de `pieza` después de lo que ya sonó (`dicho`, en huella). La pieza entera si no se encuentra. */
function colaDespuesDe(pieza: string, dicho: string): string {
  for (let j = 1; j <= pieza.length; j++) {
    if (huella(pieza.slice(0, j)) === dicho) return pieza.slice(j).replace(/^[\s,;:.]+/, '');
  }
  return pieza;
}
