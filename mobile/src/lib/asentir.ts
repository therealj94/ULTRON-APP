/**
 * ASENTIR MIENTRAS LA PERSONA HABLA («ajá», «mjm», «ya», «okey»), como alguien al teléfono que te oye sin quitarte la
 * palabra (José, 6-oct: «que no se sepa que es AI»; «las muletillas agregarlas»).
 *
 * Lo que decide, sin micrófono ni bocina (se prueba en Node, tests/asentir.test.ts):
 *  · cuándo: la persona lleva hablando ≥ 7 s seguidos y hace una pausa corta A MEDIA IDEA (lo último que Turbo
 *    entendió termina en coma o en «y», «de», «para»…: turboLogica `silencioParaCerrar` da el silencio largo; y si el
 *    sondeo del fin de turno ya clasificó lo dicho, solo con `incompleto`), así el «mjm» cae mucho antes de que la frase
 *    se cierre. Tras un punto o una pregunta, nunca: ahí quiere respuesta. Y solo si el «mjm» TERMINA antes del
 *    silencio que cerraría la frase (`cierreMs`): nunca suena encima del cierre.
 *  · cuánto: uno cada 10 s como mucho y dos por turno; nunca dos iguales seguidos.
 *  · cuándo NO: mientras AU-RA habla, en un tema triste o delicado, en modo silencioso, si la persona lo apagó y si el
 *    micrófono NO tiene cancelación de eco (ver abajo).
 *  · lo que se coló: si el micrófono alcanzó a oír el «mjm» y Turbo lo escribió dentro de la frase de la persona,
 *    `quitarDelFinal` lo saca: solo la palabra que AU-RA dijo y solo en el tramo del texto que Turbo entregó justo
 *    después de que la persona retomó encima (`quitarAsentimientos`). Un «ya» de la persona no se toca.
 *
 * CÓMO SUENA SIN ROMPER EL OÍDO (desde el 6-oct; ADR docs/adr/ADR-muletillas.md). Antes estaba apagado porque, mientras
 * la persona habla, el oído Turbo abre el micrófono SIN cancelación de eco (lib/turboMotor.ts: la fuente de llamada solo
 * con «Interrumpir hablando», que en el Samsung de José hacía que el micrófono tardara en oír: lib/storage.ts). Un
 * «mjm» por la bocina: (1) subía el volumen que mide el oído y alargaba el silencio que cierra la frase, y (2) Turbo lo
 * escribía como si lo hubiera dicho la persona. Ahora, con las muletillas encendidas, hay tres capas:
 *  1. El micrófono de escucha sigue con la fuente de DICTADO (VOICE_RECOGNITION, la que mejor reconoce) y además lleva
 *     el AcousticEchoCanceler del teléfono pegado (modules/aura-mic, fuente «reconocimiento_eco»; sin el supresor de
 *     ruido ni el modo llamada). `ecoCancelado` es que el módulo dice que ese cancelador quedó ACTIVO en la grabación de
 *     ahora; una APK sin esa función, iOS (no hay micrófono crudo) o los otros oídos (teléfono, nube): nunca.
 *  2. El TRAMO del «mjm» (turboMotor `ignorarTramo`): mientras suena (su duración + `colaMs`), el oído no lo cuenta como
 *     voz, no mide con él el ruido del cuarto y le manda a Turbo silencio en su lugar. Ese rato cuenta como silencio: la
 *     frase se cierra exactamente cuando se habría cerrado sin el «mjm». Si la persona retoma encima (su voz pasa clara
 *     por encima de lo que se cuela), el tramo se corta y su voz sigue normal.
 *  3. `quitarDelFinal`, solo para los «mjm» cuyo tramo se cortó (ahí sí pudo colarse audio de la bocina): un «ya» o un
 *     «okey» de la persona en una frase sin colado no se toca. Y aun con colado, solo se quita la aparición que cae
 *     justo detrás de lo que Turbo ya había escrito cuando la persona retomó (ver `quitarAsentimientos`).
 * Suena por el canal de efectos (lib/sfx.ts `sonarClipEfecto`, VOLUMEN_ASENTIR), NUNCA por la voz de AU-RA: no entra en
 * «AU-RA hablando», no pausa el micrófono, no pasa por lib/interrupcion.ts ni por el registro de lo dicho. El audio es la
 * MISMA voz del avatar: frases cortas pedidas una vez por GET /api/tts (la ruta de siempre) y guardadas en el disco del
 * teléfono por avatar e idioma (lib/muletillasAudio.ts); solo se guardan si las hizo ElevenLabs (no la voz de respaldo)
 * y si duran menos de MAX_CLIP_MS (una mal leída, como «eme jota eme», se descarta sola).
 *
 * Encendido por omisión SOLO en Android con el micrófono crudo y cancelación de eco en el teléfono (`decidirAsentir`).
 * Cómo apagarlo: el ajuste de la persona (Ajustes → Voz y oído → «Muletillas al escuchar», `CLAVE_AJUSTE_ASENTIR`) o,
 * para todos y sin sacar APK, AURA_ASENTIR=0 en el servidor (server/movil-config.ts).
 */
import { SILENCIO_LARGO_MS, silencioParaCerrar } from './turboLogica';
import type { FinDeTurno } from './finDeTurno';

/** Sin decisión del teléfono (ver `decidirAsentir`): apagado. */
export const ASENTIR_POR_OMISION = false;
/** El ajuste de la persona (AsyncStorage): '1' encendido, '0' apagado; sin valor, lo de omisión (`decidirAsentir`). */
export const CLAVE_AJUSTE_ASENTIR = 'aura.asentir';
/** Volumen del «mjm» (0..1): bajito, por debajo de la voz de la persona. */
export const VOLUMEN_ASENTIR = 0.35;
/** Un clip más largo que esto no es un «mjm» (la voz lo leyó mal o le agregó algo): no se usa. */
export const MAX_CLIP_MS = 1000;

export const AJUSTES_ASENTIR = {
  /** Cuánto lleva hablando seguido antes del primero. */
  minHablaMs: 7000,
  /** La pausa en la que cae: ni un respiro de 0,2 s ni tan larga que la frase ya se esté cerrando. */
  pausaMinMs: 350,
  pausaMaxMs: 750,
  /** Una pausa más larga que esto corta el «hablando seguido» (empezó otra idea). */
  cortaHablaMs: 1500,
  /** Entre dos asentimientos. */
  separacionMs: 10_000,
  maxPorTurno: 2,
  /** Lo que el tramo dura además del clip: lo que tarda en empezar a sonar y su reverberación en el cuarto. */
  colaMs: 200,
};

const FRASES: Record<'es' | 'en', string[]> = {
  es: ['mjm', 'ajá', 'ya', 'okey'],
  en: ['mhm', 'yeah', 'right', 'okay'],
};

/** Las palabras de asentir de un idioma (las que se graban con la voz del avatar). */
export function frasesAsentir(idioma: 'es' | 'en'): readonly string[] {
  return FRASES[idioma === 'en' ? 'en' : 'es'];
}

/**
 * Lo que se le pide a la voz para cada palabra: con su punto (entonación de respuesta corta) y, para el «mjm», la forma
 * que la voz lee como un murmullo y no deletreada.
 */
const TEXTO_VOZ: Record<string, string> = {
  mjm: 'Mjm.',
  ajá: 'Ajá.',
  ya: 'Ya.',
  okey: 'Okey.',
  mhm: 'Mm-hmm.',
  yeah: 'Yeah.',
  right: 'Right.',
  okay: 'Okay.',
};
export function textoParaVoz(frase: string): string {
  return TEXTO_VOZ[frase] || `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.`;
}

/** Temas en los que un «ajá» suena frío o fuera de lugar (mejor escuchar en silencio). */
const DELICADO =
  /\b(muri\w*|murio|fallec\w*|velorio|funeral|entierro|cancer|hospital\w*|enferm\w*|diagnost\w*|depres\w*|ansiedad|suicid\w*|morir\w*|llor\w*|triste\w*|divorci\w*|despid\w*|accidente|violencia|abus\w*|died|passed away|funeral|sick|depress\w*|crying|cancer)\b/;

const plano = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export type EstadoAsentir = {
  /** El ajuste de la persona y el modo silencioso de la mesa. */
  activo: boolean;
  silencioso?: boolean;
  /** El micrófono de escucha va con cancelación de eco (sin ella, nunca: ver la cabecera). */
  ecoCancelado: boolean;
  /** AU-RA está hablando (o a punto): nunca encima de su propia voz. */
  auraHablando: boolean;
  /** Lo último que Turbo entendió de esta frase. */
  parcial: string;
  /** Cuánto lleva hablando seguido (ms) y cuánto lleva callada ahora mismo (ms). */
  hablaMs: number;
  pausaMs: number;
  /** Cuándo fue el último asentimiento (ms, reloj del teléfono) y cuántos van en este turno. */
  ultimoMs: number;
  enTurno: number;
  ahora: number;
  /** Lo que dijo el sondeo del fin de turno (lib/finDeTurno.ts), si ya lo hubo: solo con `incompleto`. */
  clase?: FinDeTurno;
  /**
   * Con cuánto silencio se cerraría la frase ahora (contado desde la última voz, como el oído), cuánto silencio lleva
   * desde la última voz (`calladoMs`; sin dato, `pausaMs`) y cuánto dura el tramo del «mjm»: tiene que acabar antes.
   */
  cierreMs?: number;
  calladoMs?: number;
  tramoMs?: number;
};

/** ¿Toca un «mjm» ahora? (todas las reglas de la cabecera; sin efectos). */
export function debeAsentir(e: EstadoAsentir, a = AJUSTES_ASENTIR): boolean {
  if (!e.activo || e.silencioso || !e.ecoCancelado || e.auraHablando) return false;
  if (e.enTurno >= a.maxPorTurno || e.ahora - e.ultimoMs < a.separacionMs) return false;
  if (e.hablaMs < a.minHablaMs || e.pausaMs < a.pausaMinMs || e.pausaMs > a.pausaMaxMs) return false;
  // El sondeo ya vio la idea cerrada o dudosa: la frase se cierra en nada (300–480 ms) y quiere respuesta.
  if (e.clase && e.clase !== 'incompleto') return false;
  // Nunca encima del cierre: el «mjm» entero (con su cola) tiene que caber antes de que la frase se cierre.
  if (e.cierreMs !== undefined && e.tramoMs !== undefined && (e.calladoMs ?? e.pausaMs) + e.tramoMs > e.cierreMs) return false;
  const p = e.parcial.trim();
  if (!p || DELICADO.test(plano(p))) return false;
  // Solo a media idea: tras un punto o una pregunta la frase se cierra enseguida y quiere respuesta.
  return silencioParaCerrar(p) >= SILENCIO_LARGO_MS;
}

/** Lo que el oído sabe de la pausa de ahora además de su largo (turboMotor `InfoTrozo`). */
export type ContextoPausa = { clase?: FinDeTurno; cierreMs?: number };

export type OpcionesAsentidor = {
  activo: boolean;
  ecoCancelado: boolean;
  idioma?: 'es' | 'en';
  ajustes?: Partial<typeof AJUSTES_ASENTIR>;
  /** Cuánto dura el clip de cada palabra (ms); null = no hay audio para esa palabra todavía (no se elige). */
  duracion?: (frase: string) => number | null;
};

/**
 * El que lleva la cuenta en el teléfono: se le dice cuándo empieza a hablar la persona, cada trozo de 0,1 s (con voz o
 * sin ella), lo que va entendiendo y si AU-RA habla; devuelve la palabra a decir cuando toca. `finTurno` al cerrar la
 * frase (y `quitarDelFinal` sobre lo que entendió).
 */
export class Asentidor {
  private hablaDesde = 0;
  private callaDesde = 0;
  /** El último trozo con voz (el oído cuenta el silencio de cierre desde ahí). */
  private ultimaVozEn = 0;
  private hablando = false;
  private ultimoMs = -Infinity;
  private enTurno = 0;
  private parcial = '';
  /** Las palabras que AU-RA dijo en este turno; las que se pudieron colar llevan dónde (`seColo`). */
  private dichas: Dicha[] = [];
  private ultimaFrase = '';
  /** El tramo de la última palabra elegida (su clip + la cola), para quien la hace sonar. */
  ultimoTramoMs = 0;
  auraHablando = false;
  silencioso = false;
  private o: OpcionesAsentidor;

  constructor(o: OpcionesAsentidor = { activo: ASENTIR_POR_OMISION, ecoCancelado: false }) {
    this.o = { ...o };
  }

  /** Cambia el ajuste, el eco o el idioma sin perder la cuenta del turno. */
  configurar(p: Partial<Pick<OpcionesAsentidor, 'activo' | 'ecoCancelado' | 'idioma'>>): void {
    this.o = { ...this.o, ...p };
  }

  private get ajustes() {
    return { ...AJUSTES_ASENTIR, ...(this.o.ajustes || {}) };
  }

  /** Lo que Turbo va entendiendo de la frase. */
  oir(parcial: string): void {
    this.parcial = String(parcial || '');
  }

  /** Las palabras que se pueden decir ahora (con audio, si se sabe), empezando por una que rota. */
  private candidatas(ahora: number): string[] {
    const frases = FRASES[this.o.idioma === 'en' ? 'en' : 'es'];
    const desde = (this.enTurno + Math.floor(ahora / 1000)) % frases.length;
    const orden = [...frases.slice(desde), ...frases.slice(0, desde)];
    const conAudio = orden.filter((f) => !this.o.duracion || this.o.duracion(f) !== null);
    const distintas = conAudio.filter((f) => f !== this.ultimaFrase);
    return distintas.length ? distintas : conAudio;
  }

  private tramoDe(frase: string): number | undefined {
    const d = this.o.duracion?.(frase);
    return typeof d === 'number' ? d + this.ajustes.colaMs : undefined;
  }

  /** Un trozo de audio: `voz` si el oído oyó voz en él. Devuelve la palabra a decir, o null. */
  trozo(voz: boolean, ahora: number, ctx: ContextoPausa = {}): string | null {
    const a = this.ajustes;
    if (voz) {
      if (!this.hablando || (this.callaDesde && ahora - this.callaDesde > a.cortaHablaMs)) this.hablaDesde = ahora;
      this.hablando = true;
      this.callaDesde = 0;
      this.ultimaVozEn = ahora;
      return null;
    }
    if (!this.hablando) return null;
    if (!this.callaDesde) this.callaDesde = ahora;
    const pausaMs = ahora - this.callaDesde;
    const base: EstadoAsentir = {
      activo: this.o.activo,
      silencioso: this.silencioso,
      ecoCancelado: this.o.ecoCancelado,
      auraHablando: this.auraHablando,
      parcial: this.parcial,
      hablaMs: this.callaDesde - this.hablaDesde,
      pausaMs,
      ultimoMs: this.ultimoMs,
      enTurno: this.enTurno,
      ahora,
      clase: ctx.clase,
      cierreMs: ctx.cierreMs,
      calladoMs: ahora - this.ultimaVozEn,
    };
    // La primera palabra (con audio, no repetida) que cabe antes del cierre.
    const frase = this.candidatas(ahora).find((f) => debeAsentir({ ...base, tramoMs: this.tramoDe(f) }, a));
    if (!frase) return null;
    this.ultimoMs = ahora;
    this.enTurno++;
    this.ultimaFrase = frase;
    this.ultimoTramoMs = this.tramoDe(frase) ?? 0;
    this.dichas.push({ frase });
    return frase;
  }

  /** Se cerró la frase de la persona: la cuenta del turno vuelve a cero (la separación entre asentimientos, no). */
  finTurno(): void {
    this.hablando = false;
    this.hablaDesde = 0;
    this.callaDesde = 0;
    this.enTurno = 0;
    this.parcial = '';
  }

  /** El audio de esta palabra nunca llegó al oído (su tramo terminó limpio): no hay nada que quitar de la frase. */
  noSeColo(frase: string): void {
    for (let i = this.dichas.length - 1; i >= 0; i--) {
      if (this.dichas[i].frase === frase && !this.dichas[i].colado) {
        this.dichas.splice(i, 1);
        return;
      }
    }
  }

  /**
   * La persona retomó encima de esta palabra (su tramo se cortó): desde aquí su audio va a Turbo y puede llevar lo que
   * quedaba del clip. `antes` es lo que Turbo ya había escrito de la frase (no puede traerla: mientras sonaba le llegó
   * silencio) y `deCero`, que lo que Turbo entregue desde ahora empieza un texto nuevo (va detrás de `antes`).
   */
  seColo(frase: string, antes: string, deCero = false): void {
    for (let i = this.dichas.length - 1; i >= 0; i--) {
      const d = this.dichas[i];
      if (d.frase === frase && !d.colado) {
        d.colado = { antes: String(antes || ''), deCero };
        return;
      }
    }
  }

  /** Olvida lo dicho sin limpiar nada (una frase que se tiró y nunca dio texto). */
  olvidarDichas(): void {
    this.dichas = [];
  }

  private colados(): Colado[] {
    return this.dichas.flatMap((d) => (d.colado ? [{ frase: d.frase, ...d.colado }] : []));
  }

  /**
   * Lo que se ve mientras habla (un parcial de Turbo), sin los «mjm» que se colaron (sin olvidarlos: la frase sigue). Un
   * parcial puede traer solo lo nuevo (`deCero`): ahí el tramo es su comienzo.
   */
  limpiar(texto: string): string {
    const c = this.colados();
    return c.length ? quitarAsentimientos(texto, c, { parcialTurbo: true }) : texto;
  }

  /** Lo especulado (la frase entera hasta el sondeo), sin los «mjm» que se colaron (sin olvidarlos). */
  limpiarEntera(texto: string): string {
    const c = this.colados();
    return c.length ? quitarAsentimientos(texto, c) : texto;
  }

  /** Lo que entendió el oído, sin los «mjm» de AU-RA que se colaron al micrófono (y olvida los de este turno). */
  quitarDelFinal(texto: string): string {
    const c = this.colados();
    this.dichas = [];
    return c.length ? quitarAsentimientos(texto, c) : texto;
  }
}

/** Una palabra que AU-RA dijo; `colado`, si la persona retomó encima (ver `Asentidor.seColo`). */
type Dicha = { frase: string; colado?: { antes: string; deCero: boolean } };

/**
 * Una palabra de AU-RA que se pudo colar al micrófono, y dónde: `antes` es lo que Turbo ya había escrito cuando la
 * persona retomó encima (lo que va DELANTE del tramo) y `deCero`, que los parciales de Turbo desde ahí empiezan de cero.
 */
export type Colado = { frase: string; antes: string; deCero?: boolean };

/** El tramo del texto donde puede estar lo colado: las primeras palabras que Turbo escribió tras retomar la persona. */
export const PALABRAS_TRAMO = 3;
/** Cuántas palabras del final de `antes` sirven de ancla para hallar dónde empieza el tramo. */
const PALABRAS_ANCLA = 3;

const palabraPlana = (t: string) => plano(t).replace(/[^a-z0-9]/g, '');

/** ¿Este pedazo del texto es la palabra de asentir (con su coma o punto pegados)? */
function esLaPalabra(token: string, forma: string): boolean {
  return plano(token).replace(/[,.!…]$/, '') === forma;
}

/** Dónde empieza cada aparición de `ancla` (palabras planas seguidas) en `palabras`. */
function apariciones(palabras: string[], ancla: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + ancla.length <= palabras.length; i++) if (ancla.every((a, k) => palabras[i + k] === a)) out.push(i);
  return out;
}

/**
 * El tramo (en palabras) donde Turbo pudo escribir lo colado, y si se ubicó con certeza:
 *  · cierto: el final de `antes` (el ancla) aparece una sola vez en el texto → el tramo son las PALABRAS_TRAMO palabras
 *    que le siguen; sin `antes`, el comienzo. Un parcial que empezó de cero (`deCero`) y no trae el ancla: su comienzo.
 *  · aproximado: el ancla no está (Turbo reescribió algo) o está repetida → alrededor de donde terminaba `antes`
 *    contando palabras.
 */
function ubicarTramo(palabras: string[], c: Colado, parcialTurbo: boolean): { desde: number; hasta: number; cierto: boolean } {
  const antes = String(c.antes || '').split(/\s+/).map(palabraPlana).filter(Boolean);
  if (!antes.length) return { desde: 0, hasta: PALABRAS_TRAMO, cierto: true };
  const ancla = antes.slice(-PALABRAS_ANCLA);
  const hay = apariciones(palabras, ancla);
  if (hay.length === 1) {
    const desde = hay[0] + ancla.length;
    return { desde, hasta: desde + PALABRAS_TRAMO, cierto: true };
  }
  if (!hay.length && parcialTurbo && c.deCero) return { desde: 0, hasta: PALABRAS_TRAMO, cierto: true };
  return { desde: antes.length - 1, hasta: antes.length + PALABRAS_TRAMO, cierto: false };
}

/**
 * Saca de lo que entendió el oído las palabras que AU-RA dijo para asentir y se pudieron colar, con su coma o punto
 * pegados: cada una UNA vez y solo en su tramo, las primeras palabras que Turbo escribió después de que la persona
 * retomó encima (antes de eso a Turbo le llegaba silencio en lugar del clip: no pudo escribirla ahí). Si el tramo se
 * ubica con certeza, sale la aparición que cae en él; si solo se ubica aproximado, sale la ÚLTIMA aparición del texto y
 * solo si cae en ese tramo; si no está en el tramo, no se toca nada. Un «ya» de la persona fuera del tramo (o cuando
 * Turbo no escribió el «mjm») queda tal cual. `parcialTurbo`: el texto es un parcial de Turbo (puede empezar de cero).
 */
export function quitarAsentimientos(texto: string, colados: readonly Colado[], o: { parcialTurbo?: boolean } = {}): string {
  const original = String(texto || '');
  let tokens = original.split(/\s+/).filter(Boolean);
  let quito = false;
  // De la última a la primera: quitar una no mueve el ancla de las anteriores (que van delante).
  for (const c of [...colados].reverse()) {
    const forma = plano(c.frase).replace(/[^a-z]/g, '');
    if (!forma) continue;
    // Las palabras con letras o números (la puntuación suelta no cuenta) y a qué pedazo del texto corresponde cada una.
    const idx: number[] = [];
    const palabras: string[] = [];
    tokens.forEach((t, i) => {
      const p = palabraPlana(t);
      if (p) {
        idx.push(i);
        palabras.push(p);
      }
    });
    const tramo = ubicarTramo(palabras, c, !!o.parcialTurbo);
    let k = -1;
    if (tramo.cierto) {
      for (let i = Math.max(0, tramo.desde); i < Math.min(palabras.length, tramo.hasta); i++) {
        if (esLaPalabra(tokens[idx[i]], forma)) {
          k = i;
          break;
        }
      }
    } else {
      for (let i = palabras.length - 1; i >= 0; i--) {
        if (esLaPalabra(tokens[idx[i]], forma)) {
          k = i;
          break;
        }
      }
      if (k < tramo.desde || k >= tramo.hasta) k = -1;
    }
    if (k < 0) continue;
    tokens = tokens.filter((_, i) => i !== idx[k]);
    quito = true;
  }
  if (!quito) return original;
  return tokens.join(' ').replace(/^[\s,.;]+/, '').replace(/\s+([,.;!?])/g, '$1').trim();
}

/** Lo que dice GET /api/movil/config de las muletillas (server/movil-config.ts). Sin dato o servidor viejo: permitidas. */
export function asentirRemotoValido(r: unknown): boolean {
  const a = r && typeof r === 'object' ? (r as { asentir?: unknown }).asentir : undefined;
  return !(a && typeof a === 'object' && (a as { activo?: unknown }).activo === false);
}

/** El ajuste guardado ('1' / '0'); cualquier otra cosa es «sin elegir». */
export function ajusteAsentirGuardado(v: string | null | undefined): boolean | null {
  return v === '1' ? true : v === '0' ? false : null;
}

export type MotivoAsentir = 'encendidas' | 'apagadas_por_la_persona' | 'apagadas_por_el_servidor' | 'sin_microfono_crudo' | 'sin_cancelacion_de_eco';

/**
 * ¿Muletillas encendidas en este teléfono? Solo Android con el micrófono crudo (el oído Turbo) y cancelación de eco;
 * ahí, encendidas por omisión salvo que la persona las apague. El servidor las apaga para todos (AURA_ASENTIR=0). En
 * iOS nunca: no hay micrófono crudo con el que ignorar el tramo y reproducir con el micrófono abierto puede cortar la
 * grabación (la sesión de audio de iOS), sin una prueba en un iPhone que diga lo contrario.
 */
export function decidirAsentir(p: { android: boolean; microfonoCrudo: boolean; ecoDisponible: boolean; ajuste: boolean | null; remoto: boolean }): { encendidas: boolean; porOmision: boolean; motivo: MotivoAsentir } {
  const porOmision = p.android && p.microfonoCrudo && p.ecoDisponible;
  if (!p.android || !p.microfonoCrudo) return { encendidas: false, porOmision, motivo: 'sin_microfono_crudo' };
  if (!p.ecoDisponible) return { encendidas: false, porOmision, motivo: 'sin_cancelacion_de_eco' };
  if (!p.remoto) return { encendidas: false, porOmision, motivo: 'apagadas_por_el_servidor' };
  if (!(p.ajuste ?? porOmision)) return { encendidas: false, porOmision, motivo: 'apagadas_por_la_persona' };
  return { encendidas: true, porOmision, motivo: 'encendidas' };
}
