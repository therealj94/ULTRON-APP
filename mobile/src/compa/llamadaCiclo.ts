/**
 * LA LLAMADA DEL AVATAR: una máquina de estados explícita, pura (sin React Native) y probada en Node.
 *
 * José (30-sep, segundo diseño): «En vez de decirle el nombre, le digo que me llame y hace la animación
 * "te están llamando" como PULSE2CHAT, con el avatar; contesto y ahí empieza la llamada. Sirve también
 * para "recuérdame a las 2 pm tal cosa": me llama a esa hora, me dice y me habla hasta que yo cuelgue.»
 *
 *   REPOSO ──llamar (llámame / recordatorio / timer)──▶ SONANDO ──contestar──▶ CONECTANDO ──▶ EN_LLAMADA
 *     ▲                                                 │    │                                  ▲    │
 *     │                                      rechazar ◀─┘    └─▶ no contestó (60 s)          doble toque
 *     │                                          │                    │                          ▼    │
 *     │                                      RECHAZADA             PERDIDA                   SILENCIADO
 *     │                                          │                    │                           │
 *     └──────────── (se muestra un momento) ─────┴──── COLGADA ◀── colgar / silencio / tope / fallo ┘
 *
 *  · Fuera de una llamada NO hay sesión de ElevenLabs ni escucha para despertar: la mesa tiene su oído
 *    de siempre (botón Hablar, reconocedor del teléfono). «Llámame» lo reconoce el camino rápido (la
 *    mesa en el teléfono, las reglas y Laya ligera en el servidor) y llega aquí como `llamar`.
 *  · SONANDO: la pantalla «te está llamando» con la cara del avatar, timbre y vibración (efecto
 *    `timbre`). Con la app cerrada o el teléfono bloqueado, la de un recordatorio la hace sonar el aviso
 *    a pantalla completa de notifee (compa/recordatorios.ts), y sus botones llegan aquí igual.
 *  · Al contestar se abre la sesión (efecto `abrir`); al conectar, el PRIMER MENSAJE es el motivo de la
 *    llamada: `[[llamada]]` (llámame: saluda como quien llama) o `[[recordatorio]] <texto>` (lo dice y
 *    sigue la charla). Dura HASTA QUE LA PERSONA CUELGUE.
 *  · Protección de minutos: tras `preguntaMs` (3 min) sin que nadie hable, el avatar pregunta «¿sigues
 *    ahí?» (efecto `sigues`); si nadie contesta en `esperaSiguesMs` (20 s) después de preguntar, cuelga.
 *    Silenciada, cuelga pasado lo mismo (no puede preguntar). Configurable.
 *  · Topes: los minutos por nivel del servidor (server/tope-voz.ts): avisa antes de agotarlos y, al
 *    agotarse, cuelga. Sin minutos, «llámame» no suena (lo dice la mesa) y un recordatorio suena igual
 *    pero, al contestar, lo dice la mesa con su voz. «Sin minutos» se vence con el día de Honduras.
 *  · Doble toque (en la pantalla de la llamada): silenciar / volver a escuchar (mute de verdad).
 *
 * Entra un evento (con la hora), sale el estado nuevo y los EFECTOS que el VozProvider ejecuta.
 */
import type { Idioma } from '../i18n';

export type EstadoCiclo = 'reposo' | 'sonando' | 'conectando' | 'en_llamada' | 'silenciado' | 'colgada' | 'perdida' | 'rechazada';

/** Por qué suena: la persona pidió que la llamara, o un recordatorio / timer que ella programó. */
export type OrigenLlamada =
  | { tipo: 'llamame' }
  | { tipo: 'recordatorio'; texto: string; base: string; paso: 'l1' | 'l2'; cuando: number; dueno?: string }
  /** La sesión se abrió por otro lado (un botón «en vivo» viejo): se sigue como una llamada, sin timbre. */
  | { tipo: 'directa' };

export type MotivoFin = 'persona' | 'silencio' | 'tope' | 'fallo' | 'segundo_plano' | 'otra_llamada' | 'cortada';

export type EfectoCiclo =
  /** El timbre y la vibración de la llamada entrante (con la app delante). */
  | { tipo: 'timbre'; on: boolean }
  /** Abrir la sesión de ElevenLabs (ControlSesion.iniciar). */
  | { tipo: 'abrir' }
  /** Cerrarla (ControlSesion.terminar). */
  | { tipo: 'cerrar'; motivo: MotivoFin }
  /** Mute real del micrófono de la sesión abierta (y su voz). */
  | { tipo: 'silenciar'; valor: boolean }
  /** El motivo de la llamada, como primer mensaje de la sesión recién conectada. */
  | { tipo: 'primerMensaje'; texto: string }
  /** Un recordatorio que llegó en plena llamada: se le dice por la misma llamada. */
  | { tipo: 'decirEnLlamada'; texto: string }
  /** Nadie habla hace rato: el avatar pregunta «¿sigues ahí?» (el servidor lo dice sin cerebro). */
  | { tipo: 'sigues' }
  /** Quedan pocos minutos de voz hoy. */
  | { tipo: 'avisoTope'; restanteMs: number }
  /** Contestó: lo que faltaba del recordatorio (reintento, aviso final) se quita. */
  | { tipo: 'contestada'; origen: OrigenLlamada }
  /** Rechazó: el recordatorio queda escrito en un aviso normal. */
  | { tipo: 'rechazada'; origen: OrigenLlamada }
  /** No contestó: el reintento de notifee (ya programado) sigue su curso y queda como perdida. */
  | { tipo: 'perdida'; origen: OrigenLlamada }
  /** La llamada no está (sin minutos, no conectó): lo dice la mesa con su voz. `texto`: el recordatorio. */
  | { tipo: 'alNativo'; texto: string | null; motivo: string };

export type OpcionesCiclo = {
  reloj?: () => number;
  idioma?: () => Idioma;
  /** Cuánto suena antes de quedar perdida (como el aviso de notifee: SUENA_MS). */
  sonarMs?: number;
  /** Sin que nadie hable esto, el avatar pregunta «¿sigues ahí?». */
  preguntaMs?: number;
  /** Y sin respuesta esto después de preguntar, cuelga. */
  esperaSiguesMs?: number;
  /** Aviso cuando quede esto o menos de voz hoy. */
  avisoTopeMs?: number;
  /** Lo que se ve «Llamada terminada» antes de volver a REPOSO. */
  finVisibleMs?: number;
};

export const SONAR_MS = 60_000;
export const PREGUNTA_SIGUES_MS = 3 * 60_000;
export const ESPERA_SIGUES_MS = 20_000;
export const AVISO_TOPE_MS = 2 * 60_000;
export const FIN_VISIBLE_MS = 2_200;
/** Sin minutos hoy: no se intenta de nuevo en este rato (el día de Honduras cambia antes o el teléfono se reinicia). */
const TOPE_ESPERA_MS = 6 * 60 * 60_000;

export const MENSAJE_LLAMAME = '[[llamada]]';
export const MENSAJE_SIGUES = '[[sigues]]';
/** El recordatorio tal como viaja por la conversación (lo mismo que compa/acciones.ts, mensajeDeRecordatorio). */
export const mensajeRecordatorio = (texto: string) => `[[recordatorio]] ${String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 300)}`;

/**
 * El día de Honduras (AAAA-MM-DD), como lo cuenta el servidor para el tope de voz (server/tope-voz.ts,
 * America/Tegucigalpa). Honduras está en UTC−6 todo el año (sin horario de verano): se calcula sin Intl,
 * que en Hermes no siempre trae zonas horarias.
 */
export function diaHonduras(ahora = Date.now()): string {
  return new Date(ahora - 6 * 60 * 60_000).toISOString().slice(0, 10);
}

/** El aviso de minutos (para el agente, que se lo dice a la persona con naturalidad). */
export function avisoMinutos(restanteMs: number, idioma: Idioma): string {
  const min = Math.max(1, Math.round(restanteMs / 60_000));
  return idioma === 'en'
    ? `[app] This person has about ${min} minute${min === 1 ? '' : 's'} of voice left today. Tell them briefly and naturally; after that the call ends.`
    : `[app] A esta persona le queda${min === 1 ? '' : 'n'} unos ${min} minuto${min === 1 ? '' : 's'} de voz por hoy. Díselo breve y con naturalidad; después la llamada se corta.`;
}

/** ¿Hay llamada a la vista (suena, conecta o se habla)? Mientras tanto la mesa no escucha ni habla. */
export function llamadaActiva(e: EstadoCiclo): boolean {
  return e === 'sonando' || e === 'conectando' || e === 'en_llamada' || e === 'silenciado';
}

/** ¿Terminó hace nada (se ve «Llamada terminada» un momento)? */
export function llamadaTerminada(e: EstadoCiclo): boolean {
  return e === 'colgada' || e === 'perdida' || e === 'rechazada';
}

export class CicloLlamada {
  private e: EstadoCiclo = 'reposo';
  private desde: number;
  private reloj: () => number;
  private o: Required<Omit<OpcionesCiclo, 'reloj' | 'idioma'>>;
  private oyentes = new Set<(e: EstadoCiclo) => void>();
  private origen_: OrigenLlamada | null = null;
  private motivo_: MotivoFin | null = null;
  private agenteHablando = false;
  /** La última vez que alguien habló (la persona o el avatar). */
  private ultimaVoz = 0;
  /** Cuándo preguntó «¿sigues ahí?» (0: no preguntó) y cuándo terminó de decirlo. */
  private preguntado = 0;
  private finPregunta = 0;
  private topeAgotado = false;
  private sinLlamadaHasta = 0;
  private diaTope = '';
  private restanteMs: number | null = null;
  private avisado = false;
  private conectadaDesde = 0;
  private usado = 0;
  private sesionDesde = -1;
  /** Estamos colgando nosotros (el `cerrada` que venga después no es un corte). */
  private cerrandoNosotros = false;

  constructor(o: OpcionesCiclo = {}) {
    this.reloj = o.reloj || Date.now;
    this.o = {
      sonarMs: o.sonarMs ?? SONAR_MS,
      preguntaMs: o.preguntaMs ?? PREGUNTA_SIGUES_MS,
      esperaSiguesMs: o.esperaSiguesMs ?? ESPERA_SIGUES_MS,
      avisoTopeMs: o.avisoTopeMs ?? AVISO_TOPE_MS,
      finVisibleMs: o.finVisibleMs ?? FIN_VISIBLE_MS,
    };
    this.desde = this.reloj();
  }

  estado(): EstadoCiclo {
    return this.e;
  }
  /** Por qué suena o sonó la llamada vigente (null en reposo). */
  origen(): OrigenLlamada | null {
    return this.origen_;
  }
  /** Por qué terminó (en COLGADA). */
  motivo(): MotivoFin | null {
    return this.motivo_;
  }
  /** Desde cuándo se habla (para el cronómetro); 0 si no conectó. */
  conectadaEn(): number {
    return this.conectadaDesde;
  }

  suscribir(f: (e: EstadoCiclo) => void): () => void {
    this.oyentes.add(f);
    return () => {
      this.oyentes.delete(f);
    };
  }

  /** ¿Hay sesión de ElevenLabs viva (se cobra)? */
  sesionViva(): boolean {
    return this.e === 'conectando' || this.e === 'en_llamada' || this.e === 'silenciado';
  }

  /** Lo conectado (ms) desde que se creó el ciclo: los minutos que ElevenLabs cobra. */
  usadoMs(): number {
    return this.usado + (this.sesionDesde >= 0 ? this.reloj() - this.sesionDesde : 0);
  }

  /** ¿Hay minutos para una llamada ahora? «Sin minutos» se vence con el día de Honduras o tras la espera. */
  llamadaDisponible(): boolean {
    if (this.topeAgotado) {
      const ahora = this.reloj();
      if (ahora >= this.sinLlamadaHasta || diaHonduras(ahora) !== this.diaTope) {
        this.topeAgotado = false;
        this.sinLlamadaHasta = 0;
      }
    }
    return !this.topeAgotado;
  }

  /** Lo que le queda de voz hoy (del permiso del servidor; null: sin tope). Un cupo quita el «sin minutos». */
  fijarTope(restanteMs: number | null) {
    this.restanteMs = restanteMs;
    this.avisado = false;
    if (restanteMs === null || restanteMs > 0) {
      this.topeAgotado = false;
      this.sinLlamadaHasta = 0;
    }
  }

  private agotar(ahora: number) {
    this.topeAgotado = true;
    this.diaTope = diaHonduras(ahora);
    this.sinLlamadaHasta = ahora + TOPE_ESPERA_MS;
  }

  private ir(n: EstadoCiclo) {
    if (n === this.e) return;
    const ahora = this.reloj();
    const antesViva = this.sesionViva();
    this.e = n;
    this.desde = ahora;
    const viva = this.sesionViva();
    if (!antesViva && viva) this.sesionDesde = ahora;
    if (antesViva && !viva && this.sesionDesde >= 0) {
      this.usado += ahora - this.sesionDesde;
      this.sesionDesde = -1;
    }
    for (const f of [...this.oyentes]) f(n);
  }

  /** Terminar: COLGADA (con su motivo). Cerrar la sesión si la había. */
  private terminar(motivo: MotivoFin, cerrarSesion: boolean): EfectoCiclo[] {
    const ef: EfectoCiclo[] = [];
    if (this.e === 'sonando') ef.push({ tipo: 'timbre', on: false });
    this.motivo_ = motivo;
    this.agenteHablando = false;
    this.preguntado = 0;
    if (cerrarSesion) {
      this.cerrandoNosotros = true;
      ef.push({ tipo: 'cerrar', motivo });
    }
    this.ir('colgada');
    return ef;
  }

  /* ── eventos ── */

  /**
   * Que suene: «llámame» o la hora de un recordatorio / timer. En plena llamada, un recordatorio se le
   * dice por la misma llamada; otro «llámame» no hace nada (ya están hablando).
   */
  llamar(origen: OrigenLlamada): EfectoCiclo[] {
    if (this.e === 'sonando') {
      // Un recordatorio encima de un «llámame» que suena: manda el recordatorio (es lo que tenía hora).
      if (origen.tipo === 'recordatorio' && this.origen_?.tipo !== 'recordatorio') this.origen_ = origen;
      return [];
    }
    if (this.sesionViva()) {
      if (origen.tipo !== 'recordatorio') return [];
      return [
        { tipo: 'contestada', origen },
        { tipo: 'decirEnLlamada', texto: mensajeRecordatorio(origen.texto) },
      ];
    }
    // Sin minutos, «llámame» no suena (lo dice la mesa); un recordatorio sí (se dice con la mesa al contestar).
    if (origen.tipo === 'llamame' && !this.llamadaDisponible()) return [{ tipo: 'alNativo', texto: null, motivo: 'tope' }];
    this.origen_ = origen;
    this.motivo_ = null;
    this.conectadaDesde = 0;
    this.ir('sonando');
    return [{ tipo: 'timbre', on: true }];
  }

  /** Contestó (el botón de la pantalla o el del aviso). */
  contestar(): EfectoCiclo[] {
    if (this.e !== 'sonando' || !this.origen_) return [];
    const origen = this.origen_;
    const ef: EfectoCiclo[] = [{ tipo: 'timbre', on: false }, { tipo: 'contestada', origen }];
    if (!this.llamadaDisponible()) {
      // Sin minutos: el recordatorio lo dice la mesa con su voz; no se abre nada.
      this.motivo_ = 'tope';
      this.ir('colgada');
      ef.push({ tipo: 'alNativo', texto: origen.tipo === 'recordatorio' ? origen.texto : null, motivo: 'tope' });
      return ef;
    }
    this.agenteHablando = false;
    this.preguntado = 0;
    this.ir('conectando');
    ef.push({ tipo: 'abrir' });
    return ef;
  }

  /** Rechazó. */
  rechazar(): EfectoCiclo[] {
    if (this.e !== 'sonando' || !this.origen_) return [];
    const origen = this.origen_;
    this.motivo_ = null;
    this.ir('rechazada');
    return [
      { tipo: 'timbre', on: false },
      { tipo: 'rechazada', origen },
    ];
  }

  /** Colgar (el botón rojo, la píldora, «cuelga»). */
  colgar(): EfectoCiclo[] {
    if (!this.sesionViva()) return [];
    return this.terminar('persona', true);
  }

  /** La sesión se abrió por otro lado (un botón «en vivo» viejo): se sigue como llamada, sin timbre. */
  sesionAbriendo(): EfectoCiclo[] {
    if (this.e === 'reposo' || llamadaTerminada(this.e)) {
      this.origen_ = { tipo: 'directa' };
      this.motivo_ = null;
      this.conectadaDesde = 0;
      this.ir('conectando');
    }
    return [];
  }

  /** La sesión conectó: en llamada, y el motivo de la llamada entra como primer mensaje. */
  conectado(): EfectoCiclo[] {
    if (this.e !== 'conectando') {
      if (this.e === 'reposo' || llamadaTerminada(this.e)) this.sesionAbriendo();
      else return [];
    }
    const ahora = this.reloj();
    this.ultimaVoz = ahora;
    this.conectadaDesde = ahora;
    this.avisado = false;
    this.cerrandoNosotros = false;
    this.ir('en_llamada');
    const ef: EfectoCiclo[] = [];
    const o = this.origen_;
    if (o?.tipo === 'llamame') ef.push({ tipo: 'primerMensaje', texto: MENSAJE_LLAMAME });
    else if (o?.tipo === 'recordatorio') ef.push({ tipo: 'primerMensaje', texto: mensajeRecordatorio(o.texto) });
    const aviso = this.revisarTope();
    if (aviso) ef.push(aviso);
    return ef;
  }

  /** No conectó (o se cayó sin llegar a oír): COLGADA y la mesa lo dice (con el recordatorio, si era uno). */
  fallo(detalle?: string): EfectoCiclo[] {
    if (!this.sesionViva()) return [];
    const d = String(detalle || '').toLowerCase();
    const tope = /\b429\b|tope|minutos|minutes/.test(d);
    if (tope) this.agotar(this.reloj());
    const o = this.origen_;
    // Lo que no alcanzó a decir el avatar: el recordatorio, si todavía no conectó (en llamada ya lo dijo).
    const texto = o?.tipo === 'recordatorio' && this.e === 'conectando' ? o.texto : null;
    const ef = this.terminar(tope ? 'tope' : 'fallo', false);
    ef.push({ tipo: 'alNativo', texto, motivo: tope ? 'tope' : d || 'fallo' });
    return ef;
  }

  /** La sesión terminó de cerrarse (la cerramos nosotros, o ElevenLabs / una llamada de PULSE por su lado). */
  cerrada(motivo: MotivoFin = 'cortada'): EfectoCiclo[] {
    if (this.cerrandoNosotros && !this.sesionViva()) {
      this.cerrandoNosotros = false;
      return [];
    }
    if (!this.sesionViva()) return [];
    // Se cortó sola: se cuelga, y se le avisa al control para que no la reabra (cerrar es idempotente).
    return this.terminar(motivo, true);
  }

  /** La persona dijo algo en la llamada: contesta el «¿sigues ahí?» y reinicia la cuenta. */
  turnoUsuario(_texto?: string): EfectoCiclo[] {
    if (this.e !== 'en_llamada') return [];
    this.ultimaVoz = this.reloj();
    this.preguntado = 0;
    this.finPregunta = 0;
    return [];
  }

  /** El avatar empezó o terminó de hablar. Lo que dice cuenta como voz, salvo su propio «¿sigues ahí?». */
  agente(hablando: boolean): EfectoCiclo[] {
    if (this.e !== 'en_llamada' && this.e !== 'silenciado') return [];
    this.agenteHablando = hablando;
    const ahora = this.reloj();
    if (this.preguntado) {
      if (!hablando) this.finPregunta = ahora;
    } else this.ultimaVoz = ahora;
    return [];
  }

  /** Doble toque o el botón del micrófono: silenciar / volver a escuchar. */
  dobleToque(): EfectoCiclo[] {
    if (this.e === 'en_llamada') {
      this.ir('silenciado');
      return [{ tipo: 'silenciar', valor: true }];
    }
    if (this.e === 'silenciado') {
      this.ultimaVoz = this.reloj();
      this.preguntado = 0;
      this.ir('en_llamada');
      return [{ tipo: 'silenciar', valor: false }];
    }
    return [];
  }

  /** La app se fue detrás: la llamada se cuelga (sin micrófono ni minutos en segundo plano). */
  apagar(): EfectoCiclo[] {
    if (this.sesionViva()) return this.terminar('segundo_plano', true);
    if (this.e === 'sonando') {
      // «Llámame» suena solo en la app: detrás, perdida. Un recordatorio lo sigue sonando notifee.
      if (this.origen_?.tipo === 'recordatorio') return [{ tipo: 'timbre', on: false }];
      const origen = this.origen_!;
      this.ir('perdida');
      return [
        { tipo: 'timbre', on: false },
        { tipo: 'perdida', origen },
      ];
    }
    return [];
  }

  /** La pantalla ya mostró cómo terminó: a REPOSO. */
  listo(): EfectoCiclo[] {
    if (llamadaTerminada(this.e)) {
      this.origen_ = null;
      this.ir('reposo');
    }
    return [];
  }

  /** El reloj (cada segundo): no contestó, «¿sigues ahí?», colgar por silencio, los minutos. */
  tic(): EfectoCiclo[] {
    const ahora = this.reloj();
    switch (this.e) {
      case 'sonando': {
        if (ahora - this.desde < this.o.sonarMs) return [];
        const origen = this.origen_!;
        this.ir('perdida');
        return [
          { tipo: 'timbre', on: false },
          { tipo: 'perdida', origen },
        ];
      }
      case 'en_llamada': {
        if (this.restanteMs !== null && this.restanteMs - (ahora - this.conectadaDesde) <= 0) {
          this.agotar(ahora);
          return this.terminar('tope', true);
        }
        const aviso = this.revisarTope();
        if (aviso) return [aviso];
        if (this.agenteHablando) return [];
        if (!this.preguntado) {
          if (ahora - this.ultimaVoz >= this.o.preguntaMs) {
            this.preguntado = ahora;
            this.finPregunta = 0;
            return [{ tipo: 'sigues' }];
          }
          return [];
        }
        if (ahora - Math.max(this.preguntado, this.finPregunta) >= this.o.esperaSiguesMs) return this.terminar('silencio', true);
        return [];
      }
      case 'silenciado':
        if (this.restanteMs !== null && this.restanteMs - (ahora - this.conectadaDesde) <= 0) {
          this.agotar(ahora);
          return this.terminar('tope', true);
        }
        if (ahora - this.desde >= this.o.preguntaMs + this.o.esperaSiguesMs) return this.terminar('silencio', true);
        return [];
      case 'colgada':
      case 'perdida':
      case 'rechazada':
        if (ahora - this.desde >= this.o.finVisibleMs) this.listo();
        return [];
      default:
        return [];
    }
  }

  private revisarTope(): EfectoCiclo | null {
    if (this.restanteMs === null || this.avisado || this.e !== 'en_llamada') return null;
    const queda = this.restanteMs - (this.reloj() - this.conectadaDesde);
    if (queda > this.o.avisoTopeMs) return null;
    this.avisado = true;
    return { tipo: 'avisoTope', restanteMs: Math.max(0, queda) };
  }
}

/* ── lo que se ve ────────────────────────────────────────────────────────────────────────── */

/** «3:07» / «1:02:05». */
export function relojLlamada(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Minutos de voz para leer («3 min», «<1 min»). */
export function textoMinutos(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  return min < 1 ? '<1 min' : `${min} min`;
}

/** La leyenda de la pantalla de la llamada, según el estado y cómo terminó. */
export function leyendaLlamada(e: EstadoCiclo, o: { idioma: Idioma; origen: OrigenLlamada | null; motivo: MotivoFin | null; duracionMs: number }): string {
  const en = o.idioma === 'en';
  const dur = o.duracionMs >= 1000 ? ` · ${relojLlamada(o.duracionMs)}` : '';
  switch (e) {
    case 'sonando':
      return o.origen?.tipo === 'recordatorio' ? (en ? 'Reminder call' : 'Llamada de recordatorio') : en ? 'is calling you' : 'te está llamando';
    case 'conectando':
      return en ? 'Connecting…' : 'Conectando…';
    case 'en_llamada':
      return relojLlamada(o.duracionMs);
    case 'silenciado':
      return `${en ? 'Muted' : 'Silenciado'} · ${relojLlamada(o.duracionMs)}`;
    case 'rechazada':
      return en ? 'Call declined' : 'Llamada rechazada';
    case 'perdida':
      return en ? 'Missed call' : 'Llamada perdida';
    case 'colgada':
      if (o.motivo === 'silencio') return (en ? 'Hung up: nobody was talking' : 'Colgó: nadie hablaba') + dur;
      if (o.motivo === 'tope') return en ? 'No voice minutes left today' : 'Se acabaron los minutos de voz de hoy';
      if (o.motivo === 'fallo') return en ? 'The call couldn’t connect' : 'No se pudo conectar la llamada';
      if (o.motivo === 'otra_llamada') return en ? 'Another call came in' : 'Entró otra llamada';
      if (o.motivo === 'cortada') return (en ? 'The call dropped' : 'Se cortó la llamada') + dur;
      return (en ? 'Call ended' : 'Llamada terminada') + dur;
    default:
      return '';
  }
}

export type TonoCiclo = 'verde' | 'azul' | 'gris' | 'ambar';

/** La línea de estado de la mesa y del panel durante una llamada (null fuera de ella: lo de siempre). */
export function etiquetaCiclo(e: EstadoCiclo, nombre: string, idioma: Idioma, usadoHoyMs = 0): { texto: string; tono: TonoCiclo } | null {
  const en = idioma === 'en';
  const hoy = usadoHoyMs >= 30_000 ? ` · ${textoMinutos(usadoHoyMs)} ${en ? 'today' : 'hoy'}` : '';
  switch (e) {
    case 'sonando':
      return { texto: en ? `${nombre} is calling…` : `${nombre} te llama…`, tono: 'azul' };
    case 'conectando':
      return { texto: en ? 'connecting…' : 'conectando…', tono: 'azul' };
    case 'en_llamada':
      return { texto: (en ? 'on call' : 'en llamada') + hoy, tono: 'verde' };
    case 'silenciado':
      return { texto: (en ? 'muted · double-tap to talk' : 'silenciado · dos toques para hablar') + hoy, tono: 'ambar' };
    default:
      return null;
  }
}
