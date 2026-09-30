/**
 * EL CICLO DE LA LLAMADA: cuándo AURA está en llamada (ElevenLabs Agents), cuándo en espera barata y
 * cuándo cuelga. Una máquina de estados explícita, pura (sin React Native) y probada en Node.
 *
 * José (30-sep): la voz tiene que sentirse como una llamada, pero NO quedar conectada siempre (los
 * minutos de ElevenLabs se cobran mientras la sesión está abierta). Su uso real: «hablamos bastante
 * al principio y luego lo dejamos». Así que:
 *
 *   APAGADO ──app delante──▶ ESPERA ──«Aura, …» / tocar Hablar──▶ CONECTANDO ──▶ EN_LLAMADA
 *      ▲                      ▲  │                                     │            │   ▲
 *      │                      │  └─doble toque─▶ SILENCIADO ◀─doble toque┘            │   │
 *      │                      │                                                      ▼   │
 *      └──app detrás──── CERRANDO ◀── silencio sin turnos (30–60 s) / «gracias, eso es todo» ─┘
 *
 *  · ESPERA: escucha barata y local con el reconocedor del teléfono (sin minutos de ElevenLabs). Se
 *    despierta con la PALABRA DE ACTIVACIÓN (el nombre del avatar: «Aura», «Claudio», «Antonio»,
 *    «Guardián») o tocando Hablar. Con la mesa grande delante y poco ruido, también sin el nombre
 *    (quien le habla de frente a la mesa le habla a ella; con la tele o gente alrededor, no: ver
 *    `ruidoPermite`). Lo dicho en ESPERA no se pierde: entra como PRIMER MENSAJE de la llamada, o se
 *    resuelve por el camino rápido (reglas + Laya) si es una orden clara, sin conectar nada.
 *  · EN_LLAMADA: turnos, interrupciones y voz de ElevenLabs con nuestro cerebro como LLM.
 *  · Cuelga sola tras un silencio sin turnos (30 s desde la última respuesta; si la charla fue intensa,
 *    hasta 60 s), con una frase de cierre («Gracias, eso es todo», «adiós», «bye», «that's all»:
 *    cuelga cuando ella termina de despedirse) o al irse la app de primer plano. Al colgar por
 *    silencio dice una frase breve (con la voz de la mesa, sin gastar un turno) y vuelve a ESPERA.
 *  · SILENCIADO (doble toque): micrófono de la sesión en mute de verdad; otro doble toque, a escuchar.
 *    Silenciado mucho rato, la sesión se cierra (no gasta) y sigue silenciado hasta que la despierten.
 *  · Topes: los minutos por nivel del servidor (server/tope-voz.ts); avisa antes de agotarlos y, al
 *    agotarse o si la llamada no conecta, el oído del teléfono atiende (la mesa contesta con su voz).
 *
 * Entra un evento (con la hora), sale el estado nuevo y los EFECTOS que el VozProvider ejecuta.
 */
import type { Idioma } from '../i18n';

export type EstadoCiclo = 'apagado' | 'espera' | 'conectando' | 'en_llamada' | 'silenciado' | 'cerrando';

export type MotivoCierre = 'silencio' | 'despedida' | 'segundo_plano' | 'apagar' | 'boton';

export type EfectoCiclo =
  /** Abrir la sesión de ElevenLabs (ControlSesion.iniciar). */
  | { tipo: 'abrir' }
  /** Cerrarla (ControlSesion.terminar). */
  | { tipo: 'cerrar'; motivo: MotivoCierre }
  /** Mute real del micrófono de la sesión abierta (y su voz). */
  | { tipo: 'silenciar'; valor: boolean }
  /** Silenciado sin sesión: nadie escucha (ni la sesión ni el oído del teléfono). */
  | { tipo: 'dormir' }
  /** Salir del silenciado sin sesión: el oído del teléfono vuelve a escuchar (ControlSesion.terminar). */
  | { tipo: 'despertarOido' }
  /** Lo dicho en ESPERA, como primer mensaje de la llamada recién conectada. */
  | { tipo: 'primerMensaje'; texto: string }
  /** La frase breve al colgar por silencio (con la voz de la mesa, sin gastar un turno de la llamada). */
  | { tipo: 'despedida'; texto: string }
  /** Quedan pocos minutos de voz hoy. */
  | { tipo: 'avisoTope'; restanteMs: number }
  /** La llamada no está (no conectó, sin minutos): el oído del teléfono atiende; `texto` lo que quedó por contestar. */
  | { tipo: 'alNativo'; texto: string | null; motivo: string };

export type Decision =
  /** Despertar la llamada con `resto` (primero se prueba el camino rápido si es una orden). */
  | { tipo: 'despertar'; resto: string; porNombre: boolean }
  /** No iba para ella (sin nombre, en los chats o con ruido): se deja pasar. */
  | { tipo: 'ignorar' }
  /** Sin llamada disponible (modo llamada apagado, sin minutos, fallando): lo contesta la mesa. */
  | { tipo: 'nativo' };

export type OpcionesCiclo = {
  reloj?: () => number;
  /** El nombre del avatar activo (palabra de activación). */
  nombre?: () => string;
  idioma?: () => Idioma;
  /** Silencio sin turnos para colgar (base y máximo, ms). */
  silencioBaseMs?: number;
  silencioMaxMs?: number;
  /** Silenciado con la sesión abierta más de esto: la sesión se cierra (sigue silenciado). */
  silenciadoCierraMs?: number;
  /** Aviso cuando quede esto o menos de voz hoy. */
  avisoTopeMs?: number;
  /** Espera tras un fallo al conectar (se duplica con cada fallo seguido, hasta 5 min). */
  reintentoMs?: number;
};

export const SILENCIO_COLGAR_MS = 30_000;
export const SILENCIO_COLGAR_MAX_MS = 60_000;
export const SILENCIADO_CIERRA_MS = 2 * 60_000;
export const AVISO_TOPE_MS = 2 * 60_000;
export const REINTENTO_LLAMADA_MS = 30_000;
const REINTENTO_MAX_MS = 5 * 60_000;
/** Sin minutos hoy: no se intenta de nuevo en este rato (el día de Honduras cambia antes o el teléfono se reinicia). */
const TOPE_ESPERA_MS = 6 * 60 * 60_000;

/**
 * El día de Honduras (AAAA-MM-DD), como lo cuenta el servidor para el tope de voz (server/tope-voz.ts,
 * America/Tegucigalpa). Honduras está en UTC−6 todo el año (sin horario de verano): se calcula sin Intl,
 * que en Hermes no siempre trae zonas horarias.
 */
export function diaHonduras(ahora = Date.now()): string {
  return new Date(ahora - 6 * 60 * 60_000).toISOString().slice(0, 10);
}

/* ── la palabra de activación ────────────────────────────────────────────────────────────── */

const plano = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Cómo suena cada nombre en el reconocedor. «AU-RA» sale «aura», «au ra», «a u r a»; NUNCA se toma
 * «ahora» (la palabra más común que se le parece). ANT-ONIO sale «antonio» o «ant onio».
 */
export function variantesNombre(nombre: string): string[] {
  const p = plano(nombre).replace(/-/g, ' ');
  const junto = p.replace(/\s+/g, '');
  const v = new Set([p, junto]);
  if (junto === 'aura') ['aura', 'au ra', 'a u r a'].forEach((x) => v.add(x));
  if (junto === 'antonio') ['antonio', 'ant onio', 'ant-onio'].forEach((x) => v.add(x));
  if (junto === 'guardian') ['guardian', 'guardián'].forEach((x) => v.add(plano(x)));
  return [...v].filter(Boolean);
}

/**
 * ¿La frase trae el nombre (al principio, al final o suelto)? Devuelve lo dicho sin él («Aura, ¿qué
 * hora es?» → «¿qué hora es?»). Solo cuenta como palabra entera.
 */
export function conNombre(texto: string, nombre: string): { tenia: boolean; resto: string } {
  const original = String(texto || '').trim();
  const p = plano(original).replace(/-/g, ' ');
  for (const v of variantesNombre(nombre)) {
    const re = new RegExp(`(^|\\s)(oye |hey |hola |ok |okay )?${v.replace(/\s+/g, '\\s+')}(\\s|$)`);
    if (!re.test(p)) continue;
    // Quitar el nombre (y un «oye»/«hey» delante) del texto original, con su coma.
    const reOrig = new RegExp(`(^|[\\s,¡¿])((?:oye|hey|hola|ok|okay)[\\s,]+)?${v.split(/\s+/).map((x) => `${x}[\\s-]*`).join('')}[\\s,.:;!?]*`, 'i');
    const sinTildes = original.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const m = reOrig.exec(sinTildes);
    let resto = original;
    if (m) resto = (original.slice(0, m.index + m[1].length) + ' ' + original.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    resto = resto.replace(/^[,.;:\s]+/, '').replace(/[,;:\s]+$/, '');
    return { tenia: true, resto };
  }
  return { tenia: false, resto: original };
}

/** Frases con que la persona cierra la charla: se cuelga cuando ella termina de despedirse. */
const RE_CIERRE =
  /\b(gracias,? (eso es todo|es todo|nada mas|ya esta)|eso es todo|es todo por (ahora|hoy)|nada mas,? gracias|adios|hasta luego|hasta manana|nos vemos|chao|chau|bye|goodbye|that'?s all|that is all|see you|talk (to you )?later|thanks,? that'?s it)\b/;
export function esDespedida(texto: string): boolean {
  return RE_CIERRE.test(plano(String(texto || '').replace(/['’]/g, '')).replace(/-/g, ' '));
}

/**
 * Sin el nombre, ¿se le habla a ella? Solo con la MESA grande delante (quien mira al avatar de frente
 * le habla a él; en los chats se habla con los amigos) y si el ruido de fondo lo permite: con la tele
 * o gente alrededor el reconocedor transcribe frases ajenas y cada una abriría una llamada (minutos).
 *
 * `ruido`: el nivel de fondo entre frases, 0..1, del volumen que da el reconocedor (0 silencio, 1
 * gritos); null si no se sabe (entonces no: se pide el nombre). El umbral (RUIDO_MAX) sale de la
 * escala del reconocedor (rmsdB −2..10 → 0..1): una habitación callada queda por debajo de ~0,2 y
 * una tele a volumen de sala sube de ~0,35; se deja un margen. Cada decisión deja una miga con el
 * nivel medido, para ajustar el número con los datos del teléfono de José.
 */
export const RUIDO_MAX = 0.3;
export function ruidoPermite(ruido: number | null | undefined): boolean {
  return typeof ruido === 'number' && Number.isFinite(ruido) && ruido <= RUIDO_MAX;
}

/** Una frase que parece dicha a alguien (no un «mmm» ni una palabra suelta de fondo). */
function dirigida(texto: string): boolean {
  const palabras = plano(texto).split(' ').filter(Boolean);
  return palabras.length >= 2 && palabras.length <= 30;
}

/** Lo que dice al colgar por silencio: breve, amable y con cómo volver a llamarla. */
export function fraseColgar(nombre: string, idioma: Idioma, n = 0): string {
  const quien = nombre || 'AU-RA';
  const es = [`Aquí estaré. Si me necesitas, di «${quien}».`, `Te dejo tranquilo. Di «${quien}» y vuelvo.`, `Cuelgo por ahora. Llámame con «${quien}».`];
  const en = [`I'll be here. Say "${quien}" if you need me.`, `I'll let you be. Say "${quien}" and I'm back.`, `Hanging up for now. Call me with "${quien}".`];
  const l = idioma === 'en' ? en : es;
  return l[((n % l.length) + l.length) % l.length];
}

/** El aviso de minutos (para el agente, que se lo dice a la persona con naturalidad). */
export function avisoMinutos(restanteMs: number, idioma: Idioma): string {
  const min = Math.max(1, Math.round(restanteMs / 60_000));
  return idioma === 'en'
    ? `[app] This person has about ${min} minute${min === 1 ? '' : 's'} of voice left today. Tell them briefly and naturally; after that the call ends and the phone keeps listening.`
    : `[app] A esta persona le queda${min === 1 ? '' : 'n'} unos ${min} minuto${min === 1 ? '' : 's'} de voz por hoy. Díselo breve y con naturalidad; después la llamada se corta y el teléfono sigue escuchando.`;
}

/* ── la máquina ──────────────────────────────────────────────────────────────────────────── */

export class CicloLlamada {
  private e: EstadoCiclo = 'apagado';
  private desde: number;
  private reloj: () => number;
  private o: Required<Omit<OpcionesCiclo, 'reloj' | 'nombre' | 'idioma'>>;
  private nombre: () => string;
  private idioma: () => Idioma;
  private oyentes = new Set<(e: EstadoCiclo) => void>();
  /** Lo dicho en ESPERA que abrió la llamada: su primer mensaje. */
  private pendiente: string | null = null;
  /** SILENCIADO con la sesión todavía abierta (mute) o ya cerrada. */
  private sesionEnSilencio = false;
  private agenteHablando = false;
  private ultimaActividad = 0;
  /** Turnos de la persona en esta llamada (sus horas): la charla intensa alarga la espera para colgar. */
  private turnos: number[] = [];
  private despedidaPedida = false;
  private motivoCierre: MotivoCierre | null = null;
  private fallos = 0;
  private sinLlamadaHasta = 0;
  private topeAgotado = false;
  private restanteMs: number | null = null;
  private avisado = false;
  private conectadaDesde = 0;
  private usado = 0;
  private sesionDesde = -1;
  private despedidas = 0;
  /** Modo llamada encendido (Ajustes). Apagado, todo lo atiende el oído del teléfono como antes. */
  private activo = true;

  constructor(o: OpcionesCiclo = {}) {
    this.reloj = o.reloj || Date.now;
    this.nombre = o.nombre || (() => 'AU-RA');
    this.idioma = o.idioma || (() => 'es');
    this.o = {
      silencioBaseMs: o.silencioBaseMs ?? SILENCIO_COLGAR_MS,
      silencioMaxMs: o.silencioMaxMs ?? SILENCIO_COLGAR_MAX_MS,
      silenciadoCierraMs: o.silenciadoCierraMs ?? SILENCIADO_CIERRA_MS,
      avisoTopeMs: o.avisoTopeMs ?? AVISO_TOPE_MS,
      reintentoMs: o.reintentoMs ?? REINTENTO_LLAMADA_MS,
    };
    this.desde = this.reloj();
  }

  estado(): EstadoCiclo {
    return this.e;
  }

  suscribir(f: (e: EstadoCiclo) => void): () => void {
    this.oyentes.add(f);
    return () => {
      this.oyentes.delete(f);
    };
  }

  /** ¿Hay sesión de ElevenLabs viva (se cobra)? */
  sesionViva(): boolean {
    return this.e === 'conectando' || this.e === 'en_llamada' || this.e === 'cerrando' || (this.e === 'silenciado' && this.sesionEnSilencio);
  }

  /** Lo conectado (ms) desde que se creó el ciclo: los minutos que ElevenLabs cobra. */
  usadoMs(): number {
    return this.usado + (this.sesionDesde >= 0 ? this.reloj() - this.sesionDesde : 0);
  }

  /** ¿Se puede llamar ahora? (modo llamada encendido, con minutos y sin estar esperando tras un fallo). */
  llamadaDisponible(): boolean {
    this.revisarTopeVencido();
    return this.activo && !this.topeAgotado && this.reloj() >= this.sinLlamadaHasta;
  }

  /**
   * Sin minutos no es para siempre: se vuelve a intentar al pasar la espera o al cambiar el día de
   * Honduras (cuando el servidor renueva el cupo, server/tope-voz.ts). Antes quedaba agotado mientras el
   * proceso siguiera vivo: nunca más abría la llamada ni pedía permiso.
   */
  private revisarTopeVencido() {
    if (!this.topeAgotado) return;
    const ahora = this.reloj();
    if (ahora >= this.sinLlamadaHasta || diaHonduras(ahora) !== this.diaTope) {
      this.topeAgotado = false;
      this.sinLlamadaHasta = 0;
    }
  }
  /** El día de Honduras en que se agotaron los minutos. */
  private diaTope = '';

  /**
   * Encender o apagar el modo llamada (Ajustes). Apagarlo cuelga lo que haya; y si estaba silenciado
   * sin sesión (doble toque en espera: ControlSesion dormida), devuelve el oído del teléfono. Antes no
   * había efecto: la sesión «dormida» seguía teniendo el audio (vozOcupaMicrofono) y nadie escuchaba.
   */
  fijarActivo(on: boolean): EfectoCiclo[] {
    if (this.activo === on) return [];
    this.activo = on;
    if (on) return [];
    if (this.sesionViva()) return this.cerrar('apagar', 'espera');
    if (this.e === 'silenciado') {
      this.ir('espera');
      this.sesionEnSilencio = false;
      return [{ tipo: 'despertarOido' }];
    }
    return [];
  }

  /**
   * Lo que le queda de voz hoy (del permiso del servidor; null: sin tope, la junta). Un permiso con cupo
   * también quita el «sin minutos» (el servidor dice que sí hay).
   */
  fijarTope(restanteMs: number | null) {
    this.restanteMs = restanteMs;
    this.avisado = false;
    if (restanteMs === null || restanteMs > 0) {
      this.topeAgotado = false;
      if (this.sinLlamadaHasta > this.reloj()) this.sinLlamadaHasta = 0;
    }
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

  /** Recalcula la sesión viva cuando cambia `sesionEnSilencio` sin cambiar de estado. */
  private cuentaSesion() {
    const ahora = this.reloj();
    const viva = this.sesionViva();
    if (viva && this.sesionDesde < 0) this.sesionDesde = ahora;
    if (!viva && this.sesionDesde >= 0) {
      this.usado += ahora - this.sesionDesde;
      this.sesionDesde = -1;
    }
  }

  private cerrar(motivo: MotivoCierre, luego: EstadoCiclo = 'espera'): EfectoCiclo[] {
    this.motivoCierre = motivo;
    this.despedidaPedida = false;
    this.agenteHablando = false;
    this.pendiente = null;
    const efectos: EfectoCiclo[] = [{ tipo: 'cerrar', motivo }];
    this.ir('cerrando');
    // La sesión se cierra en el acto (ControlSesion.terminar): CERRANDO dura hasta que avisa `cerrada`.
    this.siguienteAlCerrar = luego;
    return efectos;
  }
  private siguienteAlCerrar: EstadoCiclo = 'espera';

  /** Cuánto silencio sin turnos antes de colgar: 30 s, y hasta 60 s si la charla fue intensa. */
  silencioColgarMs(): number {
    const ahora = this.reloj();
    const recientes = this.turnos.filter((t) => ahora - t <= 3 * 60_000).length;
    return Math.min(this.o.silencioMaxMs, this.o.silencioBaseMs + 5_000 * Math.max(0, recientes - 2));
  }

  /* ── eventos ── */

  /** La app está delante y hay sesión: a escuchar barato. */
  encender(): EfectoCiclo[] {
    if (this.e === 'apagado') this.ir('espera');
    return [];
  }

  /** La app se fue detrás (o se cerró la sesión de la cuenta): se cuelga y no escucha nadie. */
  apagar(): EfectoCiclo[] {
    if (this.sesionViva()) return this.cerrar('segundo_plano', 'apagado');
    this.pendiente = null;
    this.sesionEnSilencio = false;
    this.ir('apagado');
    return [];
  }

  /**
   * Una frase que el oído del teléfono transcribió en ESPERA. `mesaVisible`: la mesa grande delante;
   * `ruido`: el fondo entre frases (0..1). Decide si despierta la llamada, se ignora o la contesta la mesa.
   */
  frase(texto: string, ctx: { mesaVisible: boolean; ruido: number | null }): Decision {
    if (this.e !== 'espera') return { tipo: 'ignorar' };
    if (!this.llamadaDisponible()) return { tipo: 'nativo' };
    const n = conNombre(texto, this.nombre());
    if (n.tenia) return { tipo: 'despertar', resto: n.resto, porNombre: true };
    if (ctx.mesaVisible && ruidoPermite(ctx.ruido) && dirigida(texto)) return { tipo: 'despertar', resto: String(texto || '').trim(), porNombre: false };
    return { tipo: 'ignorar' };
  }

  /** Abrir la llamada (con lo dicho en ESPERA como primer mensaje, si lo hay). */
  despertar(texto?: string | null): EfectoCiclo[] {
    if (this.e === 'conectando' || this.e === 'en_llamada' || this.e === 'cerrando') return [];
    if (this.e === 'silenciado' && this.sesionEnSilencio) return this.dobleToque();
    if (!this.llamadaDisponible()) {
      // Sin llamada (sin minutos, fallando): lo atiende el oído del teléfono.
      if (this.e === 'apagado' || this.e === 'silenciado') this.ir('espera');
      return [{ tipo: 'alNativo', texto: texto?.trim() || null, motivo: this.topeAgotado ? 'tope' : this.activo ? 'reintento' : 'apagado' }];
    }
    this.pendiente = texto?.trim() || null;
    this.sesionEnSilencio = false;
    this.despedidaPedida = false;
    this.turnos = [];
    this.ir('conectando');
    return [{ tipo: 'abrir' }];
  }

  /** Colgar a pedido (el botón, «cuelga»): a ESPERA. */
  colgar(): EfectoCiclo[] {
    if (!this.sesionViva() || this.e === 'cerrando') return [];
    return this.cerrar('boton', 'espera');
  }

  /** Tocar «Hablar» / «Conversar»: en llamada, cuelga; si no, llama. */
  tocarHablar(): EfectoCiclo[] {
    if (this.e === 'en_llamada' || this.e === 'conectando' || (this.e === 'silenciado' && this.sesionEnSilencio)) return this.cerrar('boton', 'espera');
    return this.despertar(null);
  }

  /** La sesión se abrió por otro lado (el botón «en vivo», el fin de una llamada de PULSE): se sigue. */
  sesionAbriendo(): EfectoCiclo[] {
    if (this.e === 'espera' || this.e === 'apagado' || (this.e === 'silenciado' && !this.sesionEnSilencio)) {
      this.pendiente = null;
      this.turnos = [];
      this.ir('conectando');
    }
    return [];
  }

  /** La sesión conectó: en llamada, y lo dicho en ESPERA entra como primer mensaje. */
  conectado(): EfectoCiclo[] {
    if (this.e !== 'conectando') {
      if (this.e === 'espera' || this.e === 'apagado') this.sesionAbriendo();
      else return [];
    }
    const efectos: EfectoCiclo[] = [];
    this.fallos = 0;
    this.ultimaActividad = this.reloj();
    this.conectadaDesde = this.reloj();
    this.avisado = false;
    this.ir('en_llamada');
    if (this.pendiente) efectos.push({ tipo: 'primerMensaje', texto: this.pendiente });
    this.pendiente = null;
    const aviso = this.revisarTope();
    if (aviso) efectos.push(aviso);
    return efectos;
  }

  /** No conectó (o se cayó sin llegar a oír): el oído del teléfono atiende, y se espera antes de reintentar. */
  fallo(detalle?: string): EfectoCiclo[] {
    const d = String(detalle || '').toLowerCase();
    const tope = /\b429\b|tope|minutos|minutes/.test(d);
    const pendiente = this.pendiente;
    this.pendiente = null;
    if (this.e !== 'conectando' && this.e !== 'en_llamada' && this.e !== 'cerrando' && this.e !== 'silenciado') return [];
    this.fallos += 1;
    if (tope) {
      this.topeAgotado = true;
      this.diaTope = diaHonduras(this.reloj());
      this.sinLlamadaHasta = this.reloj() + TOPE_ESPERA_MS;
    } else {
      this.sinLlamadaHasta = this.reloj() + Math.min(REINTENTO_MAX_MS, this.o.reintentoMs * 2 ** (this.fallos - 1));
    }
    this.ir('espera');
    this.sesionEnSilencio = false;
    return [{ tipo: 'alNativo', texto: pendiente, motivo: tope ? 'tope' : d || 'fallo' }];
  }

  /** La sesión terminó de cerrarse (la cerramos nosotros o ElevenLabs por su lado). */
  cerrada(): EfectoCiclo[] {
    const efectos: EfectoCiclo[] = [];
    if (this.e === 'cerrando') {
      const motivo = this.motivoCierre;
      this.motivoCierre = null;
      this.ir(this.siguienteAlCerrar);
      if (motivo === 'silencio') efectos.push({ tipo: 'despedida', texto: fraseColgar(this.nombre(), this.idioma(), this.despedidas++) });
      return efectos;
    }
    if (this.e === 'en_llamada' || this.e === 'conectando') this.ir('espera');
    else if (this.e === 'silenciado' && this.sesionEnSilencio) {
      this.sesionEnSilencio = false;
      this.cuentaSesion();
    }
    return efectos;
  }

  /** La persona dijo algo en la llamada. */
  turnoUsuario(texto: string): EfectoCiclo[] {
    if (this.e !== 'en_llamada') return [];
    const ahora = this.reloj();
    this.ultimaActividad = ahora;
    this.turnos.push(ahora);
    if (this.turnos.length > 40) this.turnos.shift();
    if (esDespedida(texto)) this.despedidaPedida = true;
    return [];
  }

  /** El agente empezó o terminó de hablar. */
  agente(hablando: boolean): EfectoCiclo[] {
    if (this.e !== 'en_llamada' && this.e !== 'silenciado') return [];
    this.agenteHablando = hablando;
    this.ultimaActividad = this.reloj();
    // Se despidió de la persona que se despidió: ahora sí se cuelga (sin frase extra).
    if (!hablando && this.despedidaPedida && this.e === 'en_llamada') return this.cerrar('despedida', 'espera');
    return [];
  }

  /** Doble toque: interruptor silenciar / volver a escuchar. */
  dobleToque(): EfectoCiclo[] {
    switch (this.e) {
      case 'en_llamada':
        this.sesionEnSilencio = true;
        this.ir('silenciado');
        return [{ tipo: 'silenciar', valor: true }];
      case 'silenciado':
        if (this.sesionEnSilencio) {
          this.ultimaActividad = this.reloj();
          this.ir('en_llamada');
          this.sesionEnSilencio = false;
          return [{ tipo: 'silenciar', valor: false }];
        }
        return this.despertar(null);
      case 'espera':
        this.sesionEnSilencio = false;
        this.ir('silenciado');
        return [{ tipo: 'dormir' }];
      case 'conectando': {
        const ef = this.cerrar('apagar', 'silenciado');
        this.sesionEnSilencio = false;
        return [...ef, { tipo: 'dormir' }];
      }
      default:
        return [];
    }
  }

  /** El reloj (cada segundo): colgar por silencio, cerrar la sesión silenciada, el aviso de minutos. */
  tic(): EfectoCiclo[] {
    const ahora = this.reloj();
    if (this.e === 'en_llamada') {
      // Se acabaron los minutos de hoy en plena llamada: se cuelga y atiende el oído del teléfono.
      if (this.restanteMs !== null && this.restanteMs - (ahora - this.conectadaDesde) <= 0) {
        this.topeAgotado = true;
        this.diaTope = diaHonduras(ahora);
        this.sinLlamadaHasta = ahora + TOPE_ESPERA_MS;
        return [...this.cerrar('apagar', 'espera'), { tipo: 'alNativo', texto: null, motivo: 'tope' }];
      }
      const aviso = this.revisarTope();
      if (aviso) return [aviso];
      if (!this.agenteHablando && ahora - this.ultimaActividad >= this.silencioColgarMs()) return this.cerrar('silencio', 'espera');
    }
    if (this.e === 'silenciado' && this.sesionEnSilencio && ahora - this.desde >= this.o.silenciadoCierraMs) {
      this.sesionEnSilencio = false;
      this.cuentaSesion();
      return [{ tipo: 'dormir' }];
    }
    return [];
  }

  private revisarTope(): EfectoCiclo | null {
    if (this.restanteMs === null || this.avisado || this.e !== 'en_llamada') return null;
    const queda = this.restanteMs - (this.reloj() - this.conectadaDesde);
    if (queda > this.o.avisoTopeMs) return null;
    this.avisado = true;
    return { tipo: 'avisoTope', restanteMs: Math.max(0, queda) };
  }
}

/* ── el indicador ────────────────────────────────────────────────────────────────────────── */

export type TonoCiclo = 'verde' | 'azul' | 'gris' | 'ambar';

/** Minutos de voz para leer («3 min», «<1 min»). */
export function textoMinutos(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  return min < 1 ? '<1 min' : `${min} min`;
}

/**
 * Lo que se ve del ciclo en la mesa y junto a la compañera: verde en llamada, azul llamando o
 * colgando, gris en espera o apagado, ámbar silenciado; y los minutos de voz de hoy.
 */
export function etiquetaCiclo(e: EstadoCiclo, nombre: string, idioma: Idioma, usadoHoyMs = 0): { texto: string; tono: TonoCiclo } {
  const en = idioma === 'en';
  const hoy = usadoHoyMs >= 30_000 ? ` · ${textoMinutos(usadoHoyMs)} ${en ? 'today' : 'hoy'}` : '';
  switch (e) {
    case 'en_llamada':
      return { texto: (en ? 'on call' : 'en llamada') + hoy, tono: 'verde' };
    case 'conectando':
      return { texto: en ? 'calling…' : 'llamando…', tono: 'azul' };
    case 'cerrando':
      return { texto: en ? 'hanging up…' : 'colgando…', tono: 'azul' };
    case 'silenciado':
      return { texto: (en ? 'muted · double-tap to talk' : 'silenciado · dos toques para hablar') + hoy, tono: 'ambar' };
    case 'espera':
      return { texto: (en ? `standby · say "${nombre}"` : `en espera · di «${nombre}»`) + hoy, tono: 'gris' };
    default:
      return { texto: en ? 'off' : 'apagado', tono: 'gris' };
  }
}
