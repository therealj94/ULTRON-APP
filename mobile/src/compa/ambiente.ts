/**
 * EL SONIDO DE FONDO DE LA CONVERSACIÓN (la «animación» sonora de José: «si busca en internet que se
 * escuche tecleando un teclado y diga "estoy revisando"»).
 *
 * Mientras AURA hace una tarea lenta en la llamada, el servidor (server/voz-agente.ts) manda por el
 * canal de acciones `event: ambiente` {sonido, on}: tecleo al buscar (web, sus chats), hojas de papel
 * al leer (una página, un PDF, un mensaje), lápiz al calcular, clics al usar su computadora y, si la charla tarda en
 * contestar sin herramienta, un murmullo suave de «pensando» (compa/sonidosTrabajo.ts). Suena bajito y en bucle, y se para:
 *  · cuando el servidor lo quita (`on: false`: el cerebro empezó a contestar o el turno terminó);
 *  · cuando el avatar dice algo que NO es una frase de espera (la respuesta ya empezó; por si el
 *    `off` del servidor se perdió). Lo que dice en GRACIA_MS desde que empezó el sonido no cuenta: es
 *    la frase que lo acompaña («Te lo busco en tus chats.»);
 *  · mientras su voz suena (la frase de espera, un avance del narrador) calla debajo y vuelve al terminar (`alHablar`);
 *  · cuando la persona habla, cuelga, silencia, la conversación se cierra o la app se va atrás;
 *  · y siempre a los MAX_SONIDO_MS de ese sonido, pase lo que pase (un `off` perdido no deja tecleando para siempre).
 * Respeta el ajuste de sonidos de la app, el de «Sonidos mientras trabaja» y el interruptor del servidor (`puede`).
 *
 * Por qué el servidor y no deducirlo aquí de lo que dice el agente: el teléfono solo ve el texto
 * cuando ElevenLabs ya lo está diciendo, y una tarea lenta que no dijo nada (el cerebro habló antes
 * de pedir la herramienta) no deja rastro en el texto. El servidor sabe QUÉ tarea es y cuándo termina.
 *
 * Sin React Native: el reproductor entra por `deps` (compa/ambienteSonido.ts en la app; uno falso en
 * las pruebas).
 */
import type { Ambiente, SonidoAmbiente } from '../nucleo/contrato';
import { esRelleno } from './frasesEstado';
import { quitarExpresiones } from '../lib/expresiones';
import { MAX_SONIDO_MS } from './sonidosTrabajo';

/** Lo más que suena un sonido de fondo sin que el servidor lo renueve (el murmullo de «pensando», menos: MAX_SONIDO_MS). */
export const AMBIENTE_MAX_MS = 25_000;
/** Lo que dice el avatar en este rato desde que empezó el sonido es la frase que lo acompaña. */
export const GRACIA_MS = 1_500;
/** Bajito: por debajo de la voz (la voz de ElevenLabs va a volumen completo). */
export const VOLUMEN_AMBIENTE = 0.16;

export type ReproductorAmbiente = {
  poner: (s: SonidoAmbiente) => void | Promise<void>;
  quitar: () => void | Promise<void>;
};

type Temporizador = (f: () => void, ms: number) => () => void;
const temporizador: Temporizador = (f, ms) => {
  const t = setTimeout(f, ms);
  return () => clearTimeout(t);
};

export type DepsAmbiente = {
  reproductor: ReproductorAmbiente;
  /** ¿Puede sonar ahora? Conversación abierta y sin silencio, app delante y los sonidos activados. */
  puede: () => boolean;
  esperar?: Temporizador;
  reloj?: () => number;
  maxMs?: number;
  miga?: (t: string) => void;
};

export class AmbienteConversacion {
  private sonando: SonidoAmbiente | null = null;
  /** La voz del avatar suena ahora (el modo «hablando» de la sesión): el sonido espera callado debajo. */
  private hablando = false;
  private desde = 0;
  private cancelarTope: (() => void) | null = null;
  private esperar: Temporizador;
  private reloj: () => number;

  constructor(private d: DepsAmbiente) {
    this.esperar = d.esperar || temporizador;
    this.reloj = d.reloj || Date.now;
  }

  /** El sonido que está puesto (null: nada). */
  get actual(): SonidoAmbiente | null {
    return this.sonando;
  }

  /** Lo que mandó el servidor. */
  alEvento(a: Ambiente) {
    if (!a.on || !a.sonido) return this.parar('servidor');
    if (!this.d.puede()) return this.parar('no puede sonar');
    if (this.sonando === a.sonido) return this.renovarTope();
    this.sonando = a.sonido;
    this.desde = this.reloj();
    this.d.miga?.(`ambiente: ${a.sonido}`);
    // Con su voz sonando (la frase de espera) no va debajo: empieza en cuanto calle (`alHablar(false)`).
    if (!this.hablando) void Promise.resolve(this.d.reproductor.poner(a.sonido)).catch(() => {});
    this.renovarTope();
  }

  /**
   * La voz del avatar empieza (true) o termina (false) de sonar (el modo de la sesión de ElevenLabs: una señal real).
   * Mientras habla, el sonido calla (José, 6-oct: que se corten en cuanto AU-RA habla); al callar, si la tarea sigue (el
   * servidor no lo quitó y no llegó a su tope), vuelve desde otro punto del archivo.
   */
  alHablar(hablando: boolean) {
    if (this.hablando === hablando) return;
    this.hablando = hablando;
    if (!this.sonando) return;
    if (hablando) void Promise.resolve(this.d.reproductor.quitar()).catch(() => {});
    else if (this.d.puede()) void Promise.resolve(this.d.reproductor.poner(this.sonando)).catch(() => {});
    else this.parar('no puede sonar');
  }

  /** El avatar dijo algo: si ya es la respuesta (no una frase de espera), el sonido se va. */
  alHablaAvatar(texto: string) {
    if (!this.sonando || this.reloj() - this.desde < GRACIA_MS) return;
    const limpio = quitarExpresiones(String(texto || '')).trim();
    if (!limpio || esRelleno(limpio)) return;
    this.parar('habla');
  }

  /** La persona habló, colgó, silenció, se cerró la conversación o la app se fue atrás. */
  parar(motivo = '') {
    this.cancelarTope?.();
    this.cancelarTope = null;
    if (!this.sonando) return;
    this.sonando = null;
    this.d.miga?.(`ambiente: fuera (${motivo})`);
    void Promise.resolve(this.d.reproductor.quitar()).catch(() => {});
  }

  private renovarTope() {
    this.cancelarTope?.();
    const s = this.sonando;
    this.cancelarTope = this.esperar(() => this.parar('tope'), this.d.maxMs ?? (s ? MAX_SONIDO_MS[s] : undefined) ?? AMBIENTE_MAX_MS);
  }
}
