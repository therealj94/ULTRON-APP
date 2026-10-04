/**
 * GENERADO por mobile/scripts/avatares-video/reposos.py (docs/avatares-video.md): no editar a mano.
 * Para cada clip: [cuadros, último cuadro del reposo del principio, primer cuadro del reposo del final],
 * a 24 cuadros por segundo. «En reposo» = a no más de 2.5 (diferencia media, 0-255) de su cuadro 0, la foto base.
 */
import type { ClipVideo } from './guion';

export const FPS_VIDEO = 24;

export const REPOSOS: Record<'claudio' | 'antonio', Record<ClipVideo, readonly [number, number, number]>> = {
  claudio: {
    reposo: [120, 10, 112],
    escucha: [120, 10, 104],
    habla: [120, 14, 101],
    piensa: [120, 9, 107],
    teclea: [120, 7, 104],
    lee: [120, 10, 110],
    espera: [120, 9, 105],
    risa: [120, 16, 113],
    saluda: [120, 12, 100],
    senala: [120, 10, 107],
    sorpresa: [120, 25, 99],
    triste: [120, 11, 105],
    celebra: [120, 11, 113],
    asiente: [120, 9, 102],
    niega: [120, 14, 107],
    duda: [120, 9, 90],
    despide: [120, 9, 111],
  },
  antonio: {
    reposo: [120, 9, 111],
    escucha: [120, 13, 114],
    habla: [120, 11, 110],
    piensa: [120, 11, 113],
    teclea: [120, 9, 112],
    lee: [120, 10, 108],
    espera: [120, 9, 109],
    risa: [120, 7, 101],
    saluda: [120, 7, 108],
    senala: [120, 13, 100],
    sorpresa: [120, 16, 90],
    triste: [120, 16, 106],
    celebra: [120, 8, 111],
    asiente: [120, 13, 96],
    niega: [120, 10, 108],
    duda: [120, 10, 108],
    despide: [120, 9, 101],
  },
};
