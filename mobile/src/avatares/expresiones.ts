/**
 * Qué foto de Claudio corresponde a cada estado de la cara, y qué cuadro de boca a cada nivel de voz.
 *
 * Claudio no se dibuja: son las ilustraciones de José, sin fondo, más tres cuadros de habla sacados
 * de la misma foto (scripts/avatares-claudio.py). Cada estado de la cara (el mismo que mueve los
 * ojos de AU-RA) elige una foto; al hablar, la boca sigue el nivel de la voz.
 *
 * Sin React Native: las pruebas lo leen en Node.
 */
import type { FaceState } from '../caraTipos';

/** Fotos del retrato con pose propia. Los cuadros de habla van aparte (encima de `base`). */
export type FotoRetrato = 'base' | 'canta' | 'risa' | 'sorpresa' | 'pensando' | 'sueno' | 'mira' | 'aparta' | 'perfil';

/** Cuadros de habla del retrato, de menos a más abierta (0 = la boca cerrada de `base`). */
export const HABLA_RETRATO = ['habla1', 'habla2', 'habla3'] as const;

/** Cuadros del cuerpo entero: su boca ya sonríe abierta; al hablar se junta o se abre más. */
export type FotoCuerpo = 'base' | 'cierra' | 'habla1' | 'habla2';

export function fotoRetrato(face: FaceState): FotoRetrato {
  switch (face) {
    case 'LAUGH':
    case 'PROUD':
    case 'WINK':
      return 'risa';
    case 'SURPRISED':
    case 'STARTLE':
      return 'sorpresa';
    case 'THINKING':
    case 'CONFUSED':
    case 'CURIOUS':
    case 'SCAN':
      return 'pensando';
    case 'SLEEPING':
    case 'TIRED':
    case 'YAWNING':
      return 'sueno';
    case 'SAD':
    case 'CONCERNED':
    case 'ANGRY':
      return 'aparta';
    case 'SING':
    case 'MUSIC':
      return 'canta';
    default:
      // IDLE, LISTENING, SPEAKING, HAPPY, PRAY: la cara de siempre (con la boca que sigue a la voz).
      return 'base';
  }
}

/** ¿En este estado la boca sigue a la voz? Solo con la cara de siempre: las otras fotos ya traen su boca. */
export function bocaSigueVoz(face: FaceState): boolean {
  return fotoRetrato(face) === 'base';
}

/**
 * Cuánto abre la boca (0 cerrada … 3 abierta) según el nivel de la voz 0..1. Con histéresis: sin
 * ella, un nivel que ronda un umbral hace temblar la boca en vez de hablar.
 */
const UMBRALES = [0.16, 0.36, 0.6];
export function aperturaBoca(nivel: number, antes: number): number {
  let n = 0;
  for (let i = 0; i < UMBRALES.length; i++) {
    // Para subir hay que pasar el umbral; para bajar, caer 0,06 por debajo.
    const u = i < antes ? UMBRALES[i] - 0.06 : UMBRALES[i];
    if (nivel > u) n = i + 1;
  }
  return n;
}

/** El cuadro del cuerpo: quieto sonríe; hablando, su boca se junta o se abre con la voz. */
export function fotoCuerpo(hablando: boolean, apertura: number): FotoCuerpo {
  if (!hablando) return 'base';
  return (['cierra', 'base', 'habla1', 'habla2'] as const)[Math.max(0, Math.min(3, apertura))];
}

/** Hacia dónde mira según la mirada (la cámara o el dedo): -1 izquierda … 1 derecha. */
export function fotoPorMirada(gazeX: number): FotoRetrato | null {
  if (gazeX < -0.55) return 'mira';
  if (gazeX > 0.7) return 'perfil';
  return null;
}
