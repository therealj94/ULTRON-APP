/**
 * EL CAMBIO DE CLIP, sin saltos: cuándo y cómo pasa Claudio o ANT-ONIO de un clip a otro.
 *
 * El guion (guion.ts) decide QUÉ clip toca; esto decide CÓMO se llega. Los 34 clips se generaron a
 * partir de una sola foto base: todos empiezan y terminan en esa pose (el «reposo»), pero en el medio
 * cada uno hace lo suyo (la mano en el mentón al pensar, la cámara que se acerca al escuchar, los brazos
 * arriba al celebrar). Medido (docs/avatares-video.md), a mitad de un clip la pose está a 7-20 de la foto
 * base (diferencia media, 0-255), y entre dos cuadros seguidos del mismo clip hay 0,5-5. Antes el clip
 * nuevo entraba en cuanto cargaba, desde su cuadro 0, con un fundido de 220 ms: si el viejo iba por la
 * mitad, durante el fundido se veían dos zorros a la vez (la mano que se desvanece en el mentón y aparece
 * abajo, la cabeza que cambia de tamaño). Eso era el «glitch» al cambiar de gesto.
 *
 * Ahora el cambio se hace SOLO en el reposo (reposos.ts dice dónde está en cada clip: el principio y el
 * final), donde los dos clips están en la misma pose y el fundido no se nota:
 *
 *  · si el clip de ahora está en reposo, el nuevo entra ya;
 *  · si no, el de ahora termina su gesto hasta el reposo: a su ritmo si no hay apuro (un fondo nuevo), un
 *    poco más rápido si lo hay (empezó a hablar: hasta 2,5×, para llegar en ~0,9 s). El nuevo se carga
 *    mientras tanto, quieto en su cuadro 0, y arranca justo al llegar;
 *  · con «reducir movimiento» nunca se acelera: espera a su ritmo; si empezó a hablar y el reposo queda
 *    a más de 1,5 s, se funde ahí mismo, más lento (450 ms).
 *
 * Y la mezcla de capas (MezclaCapas), que antes tenía carreras:
 *
 *  · una capa no se muestra hasta que DIBUJA: su posición avanzó estando en marcha. En Android,
 *    `onReadyForDisplay` de expo-av llega al cargar, antes del primer cuadro (VideoView.java lo manda en
 *    onLoadSuccess): fundir con eso dejaba ver un hueco; y si a los 2,5 s no avisaba, se fundía igual;
 *  · la nueva siempre se funde ENCIMA de la vieja, que sigue entera debajo hasta el final (nunca hay un
 *    momento con las dos a medias dejando ver el fondo);
 *  · un pedido que llega en medio de un fundido espera a que termine (antes la capa vieja se apagaba de
 *    golpe, a mitad del fundido: un fogonazo del fondo). Uno que llega mientras el nuevo todavía carga lo
 *    reemplaza: nadie lo vio;
 *  · ningún clip en pantalla se vuelve a montar ni a cargar.
 *
 * Puro y sin React Native: lo prueban en Node (pruebas/video.prueba.mjs). La vista (CuerpoVideo.tsx)
 * ejecuta sus órdenes con expo-av y reanimated.
 */
import { esDeFondo, type ClipVideo, type Reproduccion } from './guion';
import { FPS_VIDEO, REPOSOS } from './reposos';
import { MANO_FUERA } from './manos';

export type AvatarVideo = 'claudio' | 'antonio';

/** El fundido entre dos clips que están en la misma pose (con curva suave, entra y sale sin quiebre). */
export const FUNDIDO_MS = 260;
/** El fundido cuando no queda otra que cambiar fuera del reposo («reducir movimiento» y empezó a hablar). */
export const FUNDIDO_FORZADO_MS = 450;
/** La posición avanzó esto estando en marcha: el reproductor ya está dibujando cuadros. */
export const DIBUJANDO_MS = 60;
/** El clip nuevo arranca solo si al viejo le queda por lo menos esto de reposo (lo que tarda en dibujar y fundir). */
export const MARGEN_REPOSO_MS = 200;
/** Un clip que en esto no carga o no dibuja se vuelve a montar una vez; si tampoco, se deja el de ahora. */
export const ESPERA_MAX_MS = 2500;
/** Lo que se supone que tarda en cargar un clip (para no prometer un cambio que no llega a hacerse en este reposo). */
export const CARGA_ESTIMADA_MS = 500;
/** Un golpe avisa esto antes de terminar, para que el fondo que sigue ya esté cargado cuando llegue al reposo. */
export const ANTES_DEL_FIN_MS = 900;

export type Urgencia = 'habla' | 'golpe' | 'fondo';
export const urgenciaDe = (c: ClipVideo): Urgencia => (c === 'habla' ? 'habla' : esDeFondo(c) ? 'fondo' : 'golpe');
/** En cuánto tiene que llegar al reposo el clip de ahora, según lo que viene. */
export const LLEGAR_MS: Record<Urgencia, number> = { habla: 900, golpe: 1000, fondo: 2000 };
/** Lo más rápido que termina su gesto para llegar (más, y se nota acelerado). */
export const RITMO_MAX: Record<Urgencia, number> = { habla: 2.5, golpe: 2.5, fondo: 2 };
/** «Reducir movimiento»: si empezó a hablar y el reposo queda a más de esto, se funde sin esperarlo. */
export const REDUCIDO_ESPERA_MAX_MS = 1500;

/** Dónde está en reposo un clip, en ms: [0, hastaMs) al principio y [desdeMs, durMs] al final. */
export type Tramos = { durMs: number; hastaMs: number; desdeMs: number; bucle: boolean };

export function tramos(avatar: AvatarVideo, clip: ClipVideo, bucle: boolean): Tramos {
  const [n, hasta, desde] = REPOSOS[avatar][clip];
  const ms = (cuadros: number) => (cuadros * 1000) / FPS_VIDEO;
  return { durMs: ms(n), hastaMs: ms(hasta + 1), desdeMs: ms(desde), bucle };
}

/**
 * Cuánto reposo le queda desde `pos` (ms): 0 si no está en reposo. Un golpe que llegó al final se queda
 * quieto en su último cuadro (Infinity); un bucle sigue del final al principio, que también es reposo.
 */
export function restanteReposo(t: Tramos, pos: number): number {
  if (pos >= t.desdeMs) return t.bucle ? t.durMs - pos + t.hastaMs : Infinity;
  if (pos < t.hastaMs) return t.hastaMs - pos;
  return 0;
}

/** Cuánto le falta (a ritmo normal) para estar en un reposo con margen; 0: ya está. */
export function faltaReposo(t: Tramos, pos: number): number {
  if (restanteReposo(t, pos) >= MARGEN_REPOSO_MS) return 0;
  if (pos < t.desdeMs) return t.desdeMs - pos;
  // En el reposo del final sin margen (solo un bucle de reposo muy corto): el de la vuelta siguiente.
  return t.durMs - pos + t.desdeMs;
}

/* ── la mano del sable ───────────────────────────────────────────────────────────────────── */

/**
 * Lo menos que dura la mano en su lugar al empezar un fondo (el que viene después de un golpe, que todavía
 * no se sabe cuál es): el primer cuadro en que se va, entre todos los fondos de ese avatar.
 */
const MANO_TRAS_GOLPE_MS: Record<AvatarVideo, number> = (() => {
  const r = {} as Record<AvatarVideo, number>;
  for (const av of ['claudio', 'antonio'] as const) {
    const desde = (['reposo', 'escucha', 'habla', 'piensa', 'teclea', 'lee', 'espera'] as const).map((c) => MANO_FUERA[av][c]?.[0] ?? Infinity);
    r[av] = (Math.min(...desde) * 1000) / FPS_VIDEO;
  }
  return r;
})();

/**
 * Cuánto tiempo del clip (ms, a ritmo normal) sigue la mano que agarra el sable en su lugar de la foto
 * base desde `pos` (manos.ts, medido en cada clip): 0 si ahora no está. Un bucle vuelve a empezar (y su
 * principio es la foto base); un golpe que termina se queda quieto en la foto base, pero después viene un
 * fondo que todavía no se sabe: se cuenta lo menos que dura la mano en cualquiera.
 */
export function manoLibre(avatar: AvatarVideo, clip: ClipVideo, bucle: boolean, pos: number): number {
  const durMs = (REPOSOS[avatar][clip][0] * 1000) / FPS_VIDEO;
  const f = MANO_FUERA[avatar][clip];
  const despues = bucle ? Infinity : MANO_TRAS_GOLPE_MS[avatar];
  if (!f) return bucle ? Infinity : Math.max(0, durMs - pos) + despues;
  const a = (f[0] * 1000) / FPS_VIDEO;
  const b = ((f[1] + 1) * 1000) / FPS_VIDEO;
  if (pos < a) return a - pos;
  if (pos < b) return 0;
  return durMs - pos + (bucle ? a : despues);
}

export type Plan = {
  /** ya: entra apenas cargue · volver: espera a que el de ahora llegue al reposo · fundir: entra ya, fuera del reposo. */
  modo: 'ya' | 'volver' | 'fundir';
  /** El ritmo del clip de ahora mientras vuelve al reposo (1 = normal). */
  ritmo: number;
  /** Cuánto se espera hasta el cambio (sin contar lo que tarde en cargar). */
  esperaMs: number;
  fundidoMs: number;
};

const YA: Plan = { modo: 'ya', ritmo: 1, esperaMs: 0, fundidoMs: FUNDIDO_MS };

/** Cómo pasar al clip `hacia` desde uno que va por `pos` (null: no hay nada en pantalla todavía). */
export function planear(t: Tramos | null, pos: number, hacia: ClipVideo, reducido: boolean): Plan {
  if (!t) return YA;
  const falta = faltaReposo(t, pos);
  if (falta === 0) return YA;
  const u = urgenciaDe(hacia);
  if (reducido) {
    if (u !== 'fondo' && falta > REDUCIDO_ESPERA_MAX_MS) return { modo: 'fundir', ritmo: 1, esperaMs: 0, fundidoMs: FUNDIDO_FORZADO_MS };
    return { modo: 'volver', ritmo: 1, esperaMs: falta, fundidoMs: FUNDIDO_MS };
  }
  const ritmo = Math.round(Math.min(RITMO_MAX[u], Math.max(1, falta / LLEGAR_MS[u])) * 100) / 100;
  return { modo: 'volver', ritmo, esperaMs: falta / ritmo, fundidoMs: FUNDIDO_MS };
}

/* ── la mezcla de capas ──────────────────────────────────────────────────────────────────── */

export type Indice = 0 | 1;

/** Lo que la vista tiene que hacer. `clave` identifica el montaje (un clip montado de nuevo es otro). */
export type Orden =
  /** Montar el clip en la capa, invisible y quieto en su cuadro 0. */
  | { tipo: 'montar'; capa: Indice; r: Reproduccion; clave: number }
  /** Ponerlo en marcha. */
  | { tipo: 'tocar'; capa: Indice; clave: number }
  /** Cambiarle el ritmo (para terminar su gesto antes). */
  | { tipo: 'ritmo'; capa: Indice; clave: number; ritmo: number }
  /** Fundirlo encima de lo que se ve (la otra capa, o las fotos si es el primero), de 0 a 1 en `ms`. */
  | { tipo: 'fundir'; capa: Indice; clave: number; ms: number; sobre: 'capa' | 'respaldo' }
  /** El fundido terminó: esta capa es la que se ve (si era el primero, las fotos ya se pueden quitar). */
  | { tipo: 'listo'; capa: Indice; clave: number }
  /** Desmontar la capa (ya no se ve). */
  | { tipo: 'quitar'; capa: Indice };

export type Fase = 'cargando' | 'cargada' | 'sonando' | 'dibujando';

export type Capa = {
  r: Reproduccion;
  clave: number;
  fase: Fase;
  /** Desde cuándo está en esta fase (para darlo por trabado). */
  desde: number;
  ritmo: number;
  /** La última posición que contó el reproductor, cuándo, y si estaba en marcha. */
  pos: number;
  posEn: number;
  enMarcha: boolean;
  intentos: number;
};

type Opciones = {
  avatar: AvatarVideo;
  reducido?: () => boolean;
  ahora?: () => number;
  ordenar: (o: Orden) => void;
  /** Un clip no cargó ni dibujó (para la miga de reporte). */
  trabado?: (clip: ClipVideo, definitivo: boolean, r: Reproduccion) => void;
};

export class MezclaCapas {
  readonly capas: [Capa | null, Capa | null] = [null, null];
  /** La capa que se ve entera (null: todavía las fotos). */
  frente: Indice | null = null;
  /** La capa que espera para entrar, y cómo. */
  private entrante: { capa: Indice; plan: Plan; enReposo: boolean } | null = null;
  private fundido: { capa: Indice; termina: number } | null = null;
  /** El último pedido que llegó en medio de un fundido: va cuando termine. */
  private cola: Reproduccion | null = null;
  private claves = 0;
  private readonly ahora: () => number;

  constructor(private readonly o: Opciones) {
    this.ahora = o.ahora || Date.now;
  }

  /** El clip que se ve (o null). */
  get actual(): Reproduccion | null {
    return this.frente === null ? null : this.capas[this.frente]?.r ?? null;
  }

  /** El último clip pedido (el que va a quedar): el de la cola, el que entra o el que se ve. */
  get destino(): Reproduccion | null {
    if (this.cola) return this.cola;
    if (this.entrante) return this.capas[this.entrante.capa]?.r ?? null;
    if (this.fundido) return this.capas[this.fundido.capa]?.r ?? null;
    return this.actual;
  }

  get fundiendo(): boolean {
    return !!this.fundido;
  }

  get plan(): Plan | null {
    return this.entrante?.plan ?? null;
  }

  /** Dónde va el clip de una capa ahora (estimado desde lo último que contó el reproductor). */
  posicion(i: Indice): number {
    const c = this.capas[i];
    if (!c) return 0;
    const t = tramos(this.o.avatar, c.r.clip, c.r.bucle);
    const p = c.enMarcha ? c.pos + (this.ahora() - c.posEn) * c.ritmo : c.pos;
    return c.r.bucle ? ((p % t.durMs) + t.durMs) % t.durMs : Math.min(p, t.durMs);
  }

  private tramosDe(i: Indice): Tramos {
    const c = this.capas[i]!;
    return tramos(this.o.avatar, c.r.clip, c.r.bucle);
  }

  /** El guion pide este clip. */
  pedir(r: Reproduccion) {
    if (this.fundido) {
      this.cola = r;
      return;
    }
    const f = this.frente === null ? null : this.capas[this.frente];
    if (f && (f.r.n === r.n || (r.bucle && f.r.bucle && f.r.clip === r.clip))) {
      // Ya es lo que se ve: si había otro esperando para entrar, se descarta (nadie lo vio).
      this.descartarEntrante();
      return;
    }
    const capa: Indice = this.frente === null ? 0 : this.frente === 0 ? 1 : 0;
    const b = this.capas[capa];
    if (b && b.r.n === r.n) return;
    // El que espera para entrar todavía no se ve (aunque ya haya arrancado, es invisible hasta que dibuja
    // y se funde): se reemplaza. Lo que ya se está fundiendo sí espera (arriba, la cola).
    this.montar(capa, r, 0);
  }

  private montar(capa: Indice, r: Reproduccion, intentos: number) {
    if (this.capas[capa]) this.o.ordenar({ tipo: 'quitar', capa });
    const clave = ++this.claves;
    this.capas[capa] = { r, clave, fase: 'cargando', desde: this.ahora(), ritmo: 1, pos: 0, posEn: this.ahora(), enMarcha: false, intentos };
    this.o.ordenar({ tipo: 'montar', capa, r, clave });
    this.entrante = { capa, plan: YA, enReposo: true };
    this.replanear();
    this.entrante.enReposo = this.entrante.plan.modo === 'ya';
  }

  private descartarEntrante() {
    const e = this.entrante;
    if (!e) return;
    this.entrante = null;
    this.capas[e.capa] = null;
    this.o.ordenar({ tipo: 'quitar', capa: e.capa });
    if (this.frente !== null) this.ponerRitmo(this.frente, 1);
  }

  private replanear() {
    const e = this.entrante;
    if (!e) return;
    const hacia = this.capas[e.capa]!.r.clip;
    const a = this.frente;
    e.plan = a === null ? YA : planear(this.tramosDe(a), this.posicion(a), hacia, !!this.o.reducido?.());
    if (a !== null) this.ponerRitmo(a, e.plan.modo === 'volver' ? e.plan.ritmo : 1);
  }

  private ponerRitmo(i: Indice, ritmo: number) {
    const c = this.capas[i];
    if (!c || c.ritmo === ritmo) return;
    // La posición estimada se reancla en el cambio de ritmo.
    c.pos = this.posicion(i);
    c.posEn = this.ahora();
    c.ritmo = ritmo;
    this.o.ordenar({ tipo: 'ritmo', capa: i, clave: c.clave, ritmo });
  }

  /** El reproductor de la capa cargó el clip (quieto en su cuadro 0). */
  cargado(i: Indice, clave: number) {
    const c = this.capas[i];
    if (!c || c.clave !== clave || c.fase !== 'cargando') return;
    c.fase = 'cargada';
    c.desde = this.ahora();
    this.revisar();
  }

  /** Lo que cuenta el reproductor de la capa (onPlaybackStatusUpdate). */
  estado(i: Indice, clave: number, posMs: number, enMarcha: boolean) {
    const c = this.capas[i];
    if (!c || c.clave !== clave) return;
    c.pos = posMs;
    c.posEn = this.ahora();
    c.enMarcha = enMarcha;
    if (c.fase === 'sonando' && enMarcha && posMs >= DIBUJANDO_MS) {
      c.fase = 'dibujando';
      c.desde = this.ahora();
      const ms = this.entrante?.capa === i ? this.entrante.plan.fundidoMs : FUNDIDO_MS;
      this.entrante = null;
      this.fundido = { capa: i, termina: this.ahora() + ms };
      this.o.ordenar({ tipo: 'fundir', capa: i, clave, ms, sobre: this.frente === null ? 'respaldo' : 'capa' });
    }
    this.revisar();
  }

  /** Vuelve a mirar (después de cada aviso y cuando se cumple `msParaRevisar`). */
  revisar() {
    const ahora = this.ahora();
    const f = this.fundido;
    if (f && ahora >= f.termina) {
      this.fundido = null;
      const vieja: Indice = f.capa === 0 ? 1 : 0;
      this.frente = f.capa;
      const c = this.capas[f.capa]!;
      this.o.ordenar({ tipo: 'listo', capa: f.capa, clave: c.clave });
      if (this.capas[vieja]) {
        this.capas[vieja] = null;
        this.o.ordenar({ tipo: 'quitar', capa: vieja });
      }
      const r = this.cola;
      this.cola = null;
      if (r) this.pedir(r);
    }
    const e = this.entrante;
    if (!e) return;
    const b = this.capas[e.capa]!;
    if ((b.fase === 'cargando' || b.fase === 'sonando') && ahora - b.desde >= ESPERA_MAX_MS) {
      // No cargó o no dibuja: se monta de nuevo una vez; si tampoco, se queda con lo que hay.
      this.o.trabado?.(b.r.clip, b.intentos >= 1, b.r);
      if (b.intentos < 1) this.montar(e.capa, b.r, b.intentos + 1);
      else this.descartarEntrante();
      return;
    }
    if (b.fase !== 'cargando' && b.fase !== 'cargada') return;
    const a = this.frente;
    const enReposo = a === null || restanteReposo(this.tramosDe(a), this.posicion(a)) >= MARGEN_REPOSO_MS;
    if (a !== null) {
      // Llegó al reposo: a su ritmo, que el reposo le dure. Si lo pasó sin que el nuevo cargara, vuelve a planear.
      if (enReposo) this.ponerRitmo(a, 1);
      else if (e.enReposo) this.replanear();
    }
    e.enReposo = enReposo;
    if (b.fase !== 'cargada' || !(enReposo || e.plan.modo === 'fundir')) return;
    b.fase = 'sonando';
    b.desde = ahora;
    b.enMarcha = true;
    b.posEn = ahora;
    this.o.ordenar({ tipo: 'tocar', capa: e.capa, clave: b.clave });
    // Ya llegó: el que se va termina de desvanecerse a su ritmo.
    if (a !== null) this.ponerRitmo(a, 1);
  }

  /** Cuándo tiene que volver a llamar a `revisar()` la vista (ms), o null si no hace falta. */
  msParaRevisar(): number | null {
    const ahora = this.ahora();
    const ms: number[] = [];
    if (this.fundido) ms.push(this.fundido.termina - ahora);
    const e = this.entrante;
    if (e) {
      const b = this.capas[e.capa]!;
      if (b.fase === 'cargando' || b.fase === 'sonando') ms.push(b.desde + ESPERA_MAX_MS - ahora);
      if ((b.fase === 'cargada' || b.fase === 'cargando') && this.frente !== null) {
        const a = this.capas[this.frente]!;
        const t = this.tramosDe(this.frente);
        const pos = this.posicion(this.frente);
        const falta = faltaReposo(t, pos);
        // Cuándo llega al reposo; o, si ya está, cuándo se le acaba (un bucle sigue de largo).
        if (falta > 0) ms.push(falta / a.ritmo);
        else if (Number.isFinite(restanteReposo(t, pos))) ms.push((restanteReposo(t, pos) - MARGEN_REPOSO_MS) / a.ritmo + 1);
      }
    }
    return ms.length ? Math.max(16, Math.min(...ms)) : null;
  }

  /**
   * Cuánto tiempo seguido (ms de reloj) va a estar la mano del sable en su lugar, con lo que se ve y lo que
   * ya está pedido: el clip de ahora hasta su reposo (a su ritmo) y, si hay otro esperando, ese desde su
   * cuadro 0. 0 si ahora no está, si no hay video todavía o si el cambio va a ser fuera del reposo (la pose
   * salta). La capa de efectos lo mira para sacar el sable recién cuando quede en la mano (efectos/agenda.ts).
   */
  manoLibreMs(): number {
    const i = this.fundido ? this.fundido.capa : this.frente;
    if (i === null) return 0;
    const c = this.capas[i]!;
    const pos = this.posicion(i);
    const libre = manoLibre(this.o.avatar, c.r.clip, c.r.bucle, pos);
    const b = this.entrante ? this.capas[this.entrante.capa] : null;
    const otro = this.cola ?? b?.r ?? null;
    if (!otro) return libre / Math.max(0.1, c.ritmo);
    if (this.entrante?.plan.modo === 'fundir') return 0;
    // El cambio se hace en un reposo: la mano tiene que aguantar hasta ahí (tiempo del clip, sea cual sea el
    // ritmo); después, el que entra desde su cuadro 0. Para no prometer de más, el clip llega lo más rápido que puede.
    // Lo que tarda en poder arrancar: lo que queda del fundido (el pedido en cola espera) y la carga.
    const demora = this.cola ? Math.max(0, (this.fundido?.termina ?? 0) - this.ahora()) + CARGA_ESTIMADA_MS : b?.fase === 'cargando' ? CARGA_ESTIMADA_MS : 0;
    const hasta = this.esperaCambio(i, pos, demora);
    if (libre < hasta) return libre / Math.max(0.1, c.ritmo);
    return hasta / RITMO_MAX.golpe + manoLibre(this.o.avatar, otro.clip, otro.bucle, 0);
  }

  /**
   * Cuánto le falta (tiempo del clip) a la capa `i` para el reposo donde se va a hacer el cambio. Si el que
   * entra todavía tarda `demoraMs` en poder arrancar y el reposo de ahora no le alcanza, queda para el siguiente.
   */
  private esperaCambio(i: Indice, pos: number, demoraMs: number): number {
    const t = this.tramosDe(i);
    const restante = restanteReposo(t, pos);
    if (restante >= MARGEN_REPOSO_MS + demoraMs) return 0;
    if (restante > 0) return pos < t.hastaMs ? t.desdeMs - pos : t.durMs - pos + t.desdeMs;
    return faltaReposo(t, pos);
  }

  /** Tapado (sin videos): todo vuelve a empezar; al volver, la vista pide otra vez el clip que toca. */
  reiniciar() {
    this.capas[0] = null;
    this.capas[1] = null;
    this.frente = null;
    this.entrante = null;
    this.fundido = null;
    this.cola = null;
  }
}
