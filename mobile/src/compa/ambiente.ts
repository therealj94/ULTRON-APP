/**
 * EL SONIDO DE FONDO DE LA CONVERSACIÓN (la «animación» sonora de José: «si busca en internet que se
 * escuche tecleando un teclado y diga "estoy revisando"»).
 *
 * Mientras AURA hace una tarea lenta en la llamada, el servidor (server/voz-agente.ts) manda por el
 * canal de acciones `event: ambiente` {sonido, on}: tecleo al buscar (web, sus chats), hojas de papel
 * al leer (una página, un PDF, un mensaje), lápiz al calcular. Suena bajito y en bucle, y se para:
 *  · cuando el servidor lo quita (`on: false`: el cerebro empezó a contestar o el turno terminó);
 *  · cuando el avatar dice algo que NO es una frase de espera (la respuesta ya empezó; por si el
 *    `off` del servidor se perdió). Lo que dice en GRACIA_MS desde que empezó el sonido no cuenta: es
 *    la frase que lo acompaña («Te lo busco en tus chats.»);
 *  · cuando la persona habla, cuelga, silencia, la conversación se cierra o la app se va atrás;
 *  · y siempre a los AMBIENTE_MAX_MS, pase lo que pase (un `off` perdido no deja tecleando para siempre).
 * Respeta el ajuste de sonidos de la app (`puede`).
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

/** Lo más que suena un sonido de fondo sin que el servidor lo renueve. */
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
    void Promise.resolve(this.d.reproductor.poner(a.sonido)).catch(() => {});
    this.renovarTope();
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
    this.cancelarTope = this.esperar(() => this.parar('tope'), this.d.maxMs ?? AMBIENTE_MAX_MS);
  }
}
