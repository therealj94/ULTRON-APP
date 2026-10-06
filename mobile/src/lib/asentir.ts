/**
 * ASENTIR MIENTRAS LA PERSONA HABLA («ajá», «mjm», «ya», «okey»), como alguien al teléfono que te oye sin quitarte la
 * palabra (José, 6-oct: «que no se sepa que es AI»).
 *
 * Lo que decide, sin micrófono ni bocina (se prueba en Node, tests/asentir.test.ts):
 *  · cuándo: la persona lleva hablando ≥ 7 s seguidos y hace una pausa corta A MEDIA IDEA (lo último que Turbo
 *    entendió termina en coma o en «y», «de», «para»…: turboLogica `silencioParaCerrar` da el silencio largo), así el
 *    «mjm» cae mucho antes de que la frase se cierre. Tras un punto o una pregunta, nunca: ahí quiere respuesta.
 *  · cuánto: uno cada 10 s como mucho y dos por turno; nunca dos iguales seguidos.
 *  · cuándo NO: mientras AU-RA habla, en un tema triste o delicado, en modo silencioso, si la persona lo apagó y si el
 *    micrófono NO tiene cancelación de eco (ver abajo).
 *  · lo que se coló: si el micrófono alcanzó a oír el «mjm» y Turbo lo escribió dentro de la frase de la persona,
 *    `quitarDelFinal` lo saca (solo la palabra que AU-RA dijo, tantas veces como la dijo).
 *
 * APAGADO POR OMISIÓN (ASENTIR_POR_OMISION = false). Mientras la persona habla, el oído Turbo abre el micrófono SIN la
 * cancelación de eco del teléfono (lib/turboMotor.ts: `conEco` solo cuando AU-RA habla). Un «mjm» por la bocina en ese
 * momento: (1) sube el volumen que mide el oído y alarga el silencio que cierra la frase (la respuesta tardaría más), y
 * (2) Turbo lo escribe como si lo hubiera dicho la persona. Además, en iOS reproducir un sonido con el micrófono abierto
 * puede cambiar la sesión de audio y cortar la grabación. Por eso `debeAsentir` exige `ecoCancelado`: se enciende solo
 * cuando el micrófono de escucha vaya con cancelación de eco y se haya probado en un teléfono de verdad, sonando con el
 * canal de efectos (lib/sfx.ts, volumen bajo), NUNCA por la voz de AU-RA (no debe entrar en «AU-RA hablando» ni en
 * lib/interrupcion.ts). La persona lo puede apagar con el ajuste `CLAVE_AJUSTE_ASENTIR`.
 */
import { SILENCIO_LARGO_MS, silencioParaCerrar } from './turboLogica';

/** Apagado hasta probarlo en un teléfono con el micrófono de escucha con cancelación de eco (ver arriba). */
export const ASENTIR_POR_OMISION = false;
/** El ajuste de la persona (AsyncStorage): '1' encendido, '0' apagado; sin valor, ASENTIR_POR_OMISION. */
export const CLAVE_AJUSTE_ASENTIR = 'aura.asentir';
/** Volumen del «mjm» (0..1): bajito, por debajo de la voz de la persona. */
export const VOLUMEN_ASENTIR = 0.35;

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
};

const FRASES: Record<'es' | 'en', string[]> = {
  es: ['mjm', 'ajá', 'ya', 'okey'],
  en: ['mhm', 'yeah', 'right', 'okay'],
};

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
};

/** ¿Toca un «mjm» ahora? (todas las reglas de la cabecera; sin efectos). */
export function debeAsentir(e: EstadoAsentir, a = AJUSTES_ASENTIR): boolean {
  if (!e.activo || e.silencioso || !e.ecoCancelado || e.auraHablando) return false;
  if (e.enTurno >= a.maxPorTurno || e.ahora - e.ultimoMs < a.separacionMs) return false;
  if (e.hablaMs < a.minHablaMs || e.pausaMs < a.pausaMinMs || e.pausaMs > a.pausaMaxMs) return false;
  const p = e.parcial.trim();
  if (!p || DELICADO.test(plano(p))) return false;
  // Solo a media idea: tras un punto o una pregunta la frase se cierra enseguida y quiere respuesta.
  return silencioParaCerrar(p) >= SILENCIO_LARGO_MS;
}

/**
 * El que lleva la cuenta en el teléfono: se le dice cuándo empieza a hablar la persona, cada trozo de 0,1 s (con voz o
 * sin ella), lo que va entendiendo y si AU-RA habla; devuelve la palabra a decir cuando toca. `finTurno` al cerrar la
 * frase (y `quitarDelFinal` sobre lo que entendió).
 */
export class Asentidor {
  private hablaDesde = 0;
  private callaDesde = 0;
  private hablando = false;
  private ultimoMs = -Infinity;
  private enTurno = 0;
  private parcial = '';
  private dichas: string[] = [];
  private ultimaFrase = '';
  auraHablando = false;
  silencioso = false;

  constructor(
    private readonly o: { activo: boolean; ecoCancelado: boolean; idioma?: 'es' | 'en'; ajustes?: Partial<typeof AJUSTES_ASENTIR> } = { activo: ASENTIR_POR_OMISION, ecoCancelado: false }
  ) {}

  private get ajustes() {
    return { ...AJUSTES_ASENTIR, ...(this.o.ajustes || {}) };
  }

  /** Lo que Turbo va entendiendo de la frase. */
  oir(parcial: string): void {
    this.parcial = String(parcial || '');
  }

  /** Un trozo de audio: `voz` si el oído oyó voz en él. Devuelve la palabra a decir, o null. */
  trozo(voz: boolean, ahora: number): string | null {
    const a = this.ajustes;
    if (voz) {
      if (!this.hablando || (this.callaDesde && ahora - this.callaDesde > a.cortaHablaMs)) this.hablaDesde = ahora;
      this.hablando = true;
      this.callaDesde = 0;
      return null;
    }
    if (!this.hablando) return null;
    if (!this.callaDesde) this.callaDesde = ahora;
    const pausaMs = ahora - this.callaDesde;
    const toca = debeAsentir(
      {
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
      },
      a
    );
    if (!toca) return null;
    const frases = FRASES[this.o.idioma === 'en' ? 'en' : 'es'];
    const frase = frases.find((f, i) => f !== this.ultimaFrase && i === (this.enTurno + Math.floor(ahora / 1000)) % frases.length) || frases.find((f) => f !== this.ultimaFrase) || frases[0];
    this.ultimoMs = ahora;
    this.enTurno++;
    this.ultimaFrase = frase;
    this.dichas.push(frase);
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

  /** Lo que entendió el oído, sin los «mjm» de AU-RA que se colaron al micrófono (y olvida los de este turno). */
  quitarDelFinal(texto: string): string {
    const r = quitarAsentimientos(texto, this.dichas);
    this.dichas = [];
    return r;
  }
}

/**
 * Saca de lo que entendió el oído las palabras que AU-RA dijo para asentir (cada una tantas veces como la dijo), con su
 * coma o punto pegados. Lo demás queda tal cual: un «ajá» de la persona que AU-RA no dijo no se toca.
 */
export function quitarAsentimientos(texto: string, dichas: readonly string[]): string {
  let t = String(texto || '');
  for (const d of dichas) {
    const forma = plano(d).replace(/[^a-z]/g, '');
    if (!forma) continue;
    const re = new RegExp(`(^|[\\s,.;])(${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${forma})[,.!…]?(?=\\s|$)`, 'i');
    t = t.replace(re, '$1');
  }
  return t.replace(/\s{2,}/g, ' ').replace(/^[\s,.;]+/, '').replace(/\s+([,.;!?])/g, '$1').trim();
}
