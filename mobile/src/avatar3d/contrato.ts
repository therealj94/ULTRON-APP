/**
 * EL CONTRATO DEL AVATAR: lo que cualquier cuerpo de AURA recibe y avisa, sin importar con qué se
 * dibuje.
 *
 * La compañera (compa/) es el ALMA: el ánimo, el tacto, la voz. Un CUERPO solo pinta lo que el alma
 * siente y le cuenta dónde lo tocaron:
 *
 *   alma (Companera + animo.ts) ── estadoAvatar ──▶ cuerpo (figurita 2D · modelo 3D · …)
 *                              ◀── toqueAvatar ───
 *   voz (senalVoz.ts) ─────────── boca (0..1 + visema, 20 Hz) ──▶ cuerpo
 *
 * Así el 3D es un cuerpo más, intercambiable: si no hay modelo, falla o el teléfono no da, se dibuja
 * la figurita de siempre con el mismo estado y los mismos toques.
 *
 * Sin React Native: lo usan las pruebas en Node.
 */
import { expresion, hablando, estaDormida, type Animo, type Efecto, type EventoAnimo, type Expresion } from '../compa/animo';
import { canal } from '../compa/canales';
import type { AvatarId } from '../avatares/catalogo';
import { ESTADO_INICIAL, type Camara, type EstadoAvatar, type ExpresionAvatar, type GestoAvatar, type ToqueAvatar, type ZonaToque } from './tipos';
import type { FuenteMirada } from '../lib/miradaAvatar';

export * from './tipos';

// Las caras de la compañera y las del avatar son las mismas: si alguien agrega una en animo.ts y no
// aquí, esto deja de compilar.
type CarasIguales = [Expresion] extends [ExpresionAvatar] ? ([ExpresionAvatar] extends [Expresion] ? true : false) : false;
const carasIguales: CarasIguales = true;
void carasIguales;

/* ── los canales del contrato ────────────────────────────────────────────────────────────── */

/** Lo que siente el alma, para todos los cuerpos (cambia pocas veces por segundo). */
export const estadoAvatar = canal<EstadoAvatar>(ESTADO_INICIAL);

/** Un cuerpo avisa que lo tocaron (el alma decide qué siente). */
export const toqueAvatar = canal<ToqueAvatar | null>(null);

/** Lo que recibe un cuerpo (la figurita 2D y el modelo 3D reciben lo mismo). */
export type PropsCuerpo = {
  avatar: AvatarId;
  camara: Camara;
  estado: EstadoAvatar;
  /** Lado de la vista, en px (el cuerpo es cuadrado en paseo y en el panel). */
  ancho: number;
  alto: number;
  /** Tope de cuadros por segundo (la compañera chiquita no necesita 60). */
  fpsMax?: number;
  /**
   * La mirada hacia la persona leída en el cuadro del cuerpo (lib/miradaAvatar.ts, CAM-A), sin pasar por el estado
   * de React. Sin esto, la de `estado.mirar` como siempre.
   */
  fuenteMirada?: FuenteMirada;
};

/* ── del ánimo al estado del cuerpo ──────────────────────────────────────────────────────── */

export type ExtraEstado = {
  caminando?: boolean;
  dir?: -1 | 1;
  mirar?: EstadoAvatar['mirar'];
  gesto?: EstadoAvatar['gesto'];
  globo?: string;
  /** Solo la mesa (estadoDesdeMesa): lo que de verdad suena. Sin esto, el cuerpo de la mesa no habla. */
  voz?: VozMesa;
};

/**
 * Lo que manda sobre la boca del cuerpo en la mesa: el AUDIO, no la cara (José, 5-oct: «habla cuando no
 * está diciendo nada»; avatar3d/sonando.ts).
 */
export type VozMesa = {
  /** Suena la voz de la mesa (lib/tts: el reproductor sonando; no al pedirla, ni después de callar). */
  sonando: boolean;
  /** La conversación fluida: el agente habla (su audio va por WebRTC, no por tts; lo dice el SDK). */
  agenteHabla?: boolean;
  /** El turno sigue (el cerebro piensa) o la voz se está preparando: sin audio, piensa. */
  pensando?: boolean;
};

/** El ánimo de la compañera (animo.ts) → lo que cualquier cuerpo tiene que mostrar. */
export function estadoDesdeAnimo(a: Animo, ahora: number, x: ExtraEstado = {}): EstadoAvatar {
  const dormida = estaDormida(a.voz);
  return {
    expresion: expresion(a, ahora),
    hablando: hablando(a),
    escuchando: !dormida && a.voz.estado === 'escuchando' && !a.voz.pensando,
    silenciado: dormida,
    pensando: a.mesa.pensando || a.voz.estado === 'conectando' || !!a.voz.pensando,
    caminando: !!x.caminando,
    dir: x.dir === -1 ? -1 : 1,
    mirar: x.mirar || { x: 0, y: 0, activa: false },
    gesto: x.gesto ?? null,
    globo: x.globo || '',
  };
}

/**
 * La cara que pide la MESA (DeskScreen: el FaceState de la voz y el cerebro, más la emoción del
 * turno) → lo que un cuerpo 3D tiene que mostrar. En la mesa, Claudio y ANT-ONIO son su cuerpo 3D
 * (con sus fotos de respaldo); la emoción del turno afina la cara cuando la mesa solo dice «habla»
 * o «en reposo».
 */
const CARA_DE_MESA: Record<string, ExpresionAvatar> = {
  IDLE: 'tranquila',
  LISTENING: 'escucha',
  THINKING: 'piensa',
  SCAN: 'piensa',
  CONFUSED: 'piensa',
  CURIOUS: 'escucha',
  SPEAKING: 'tranquila',
  SING: 'contenta',
  MUSIC: 'contenta',
  HAPPY: 'contenta',
  PROUD: 'contenta',
  WINK: 'contenta',
  LAUGH: 'encantada',
  CONCERNED: 'uy',
  SAD: 'triste',
  ANGRY: 'enojada',
  SLEEPING: 'dormida',
  YAWNING: 'dormida',
  TIRED: 'dormida',
  STARTLE: 'sorprendida',
  SURPRISED: 'sorprendida',
  PRAY: 'tranquila',
};
const CARA_DE_EMOCION: Record<string, ExpresionAvatar> = {
  feliz: 'contenta',
  orgullo: 'contenta',
  travieso: 'contenta',
  canto: 'contenta',
  risa: 'encantada',
  sorpresa: 'sorprendida',
  curioso: 'escucha',
  pensando: 'piensa',
  preocupado: 'uy',
  triste: 'triste',
  molesto: 'enojada',
  carino: 'timida',
};

/**
 * ¿Habla o piensa el cuerpo de la mesa? Habla SOLO si suena algo (su voz o la del agente), con la cara que
 * sea; la cara SPEAKING o SING sin audio no es hablar (llega antes que la voz, o se queda después). Sin
 * audio piensa si la cara lo pide o si el turno sigue o la voz se prepara.
 */
export function bocaDeMesa(face: string, voz?: VozMesa): { hablando: boolean; pensando: boolean } {
  const hablando = !!voz && (voz.sonando || !!voz.agenteHabla);
  return { hablando, pensando: !hablando && (face === 'THINKING' || face === 'SCAN' || !!voz?.pensando) };
}

export function estadoDesdeMesa(face: string, emocion: string, x: ExtraEstado = {}): EstadoAvatar {
  const deCara = CARA_DE_MESA[face] || 'tranquila';
  const afinable = face === 'IDLE' || face === 'SPEAKING';
  const expresion = afinable ? CARA_DE_EMOCION[emocion] || deCara : deCara;
  const { hablando, pensando } = bocaDeMesa(face, x.voz);
  return {
    ...ESTADO_INICIAL,
    expresion,
    hablando,
    escuchando: face === 'LISTENING' || face === 'CURIOUS',
    silenciado: face === 'SLEEPING',
    pensando,
    mirar: x.mirar || ESTADO_INICIAL.mirar,
    gesto: x.gesto ?? null,
    globo: x.globo || '',
  };
}

/** ¿Cambió algo que un cuerpo tenga que ver? (el globo y la mirada cuentan; la hora no). */
export function mismoEstado(a: EstadoAvatar, b: EstadoAvatar): boolean {
  return (
    a.expresion === b.expresion &&
    a.hablando === b.hablando &&
    a.escuchando === b.escuchando &&
    a.silenciado === b.silenciado &&
    a.pensando === b.pensando &&
    a.caminando === b.caminando &&
    a.dir === b.dir &&
    a.globo === b.globo &&
    (a.gesto?.n ?? -1) === (b.gesto?.n ?? -1) &&
    a.mirar.activa === b.mirar.activa &&
    Math.abs(a.mirar.x - b.mirar.x) < 0.05 &&
    Math.abs(a.mirar.y - b.mirar.y) < 0.05
  );
}

const TOQUE_DE_ZONA: Partial<Record<ZonaToque, GestoAvatar>> = { cabeza: 'toque_cabeza', mejilla: 'toque_mejilla', panza: 'toque_panza' };

/**
 * El gesto de cuerpo que acompaña a lo que pasó (lo que la figurita 2D hace con un brinco o una
 * sacudida, el 3D lo hace con una animación). null: nada que hacer con el cuerpo.
 */
export function gestoDeEvento(ev: EventoAnimo, antes: Animo, despues: Animo, efectos: readonly Efecto[]): GestoAvatar | null {
  if (efectos.some((e) => e.tipo === 'desaparecer')) return 'salir';
  if (efectos.some((e) => e.tipo === 'aparecer')) return 'entrar';
  if (efectos.some((e) => e.tipo === 'sacudir')) return 'enojo';
  switch (ev.tipo) {
    case 'toque':
      if (estaDormida(antes.voz) || despues.reaccion?.exp === 'enojada') return null;
      return ev.zona ? TOQUE_DE_ZONA[ev.zona] ?? null : 'toque_cabeza';
    case 'caricia':
      return despues === antes ? null : 'gusto';
    case 'dobleToque':
      return despues.reaccion?.exp === 'sorprendida' ? 'despertar' : null;
    case 'enviado':
      return efectos.some((e) => e.tipo === 'palomita') ? 'gusto' : null;
    case 'accion':
      return ev.accion.tipo === 'redactar' ? 'senalar' : null;
    case 'voz':
      // Recién conectada, la primera vez que la oye: saluda.
      return antes.voz.estado === 'conectando' && despues.voz.estado === 'escuchando' && !despues.voz.silenciada ? 'saludar' : null;
    default:
      return null;
  }
}
