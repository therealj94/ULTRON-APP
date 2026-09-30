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
};

/* ── del ánimo al estado del cuerpo ──────────────────────────────────────────────────────── */

export type ExtraEstado = {
  caminando?: boolean;
  dir?: -1 | 1;
  mirar?: EstadoAvatar['mirar'];
  gesto?: EstadoAvatar['gesto'];
  globo?: string;
};

/** El ánimo de la compañera (animo.ts) → lo que cualquier cuerpo tiene que mostrar. */
export function estadoDesdeAnimo(a: Animo, ahora: number, x: ExtraEstado = {}): EstadoAvatar {
  const dormida = estaDormida(a.voz);
  return {
    expresion: expresion(a, ahora),
    hablando: hablando(a),
    escuchando: !dormida && a.voz.estado === 'escuchando',
    silenciado: dormida,
    pensando: a.mesa.pensando || a.voz.estado === 'conectando',
    caminando: !!x.caminando,
    dir: x.dir === -1 ? -1 : 1,
    mirar: x.mirar || { x: 0, y: 0, activa: false },
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
