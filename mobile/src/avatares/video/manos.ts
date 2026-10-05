/**
 * GENERADO por mobile/scripts/avatares-video/manos.py (docs/avatares-video.md): no editar a mano.
 * Para cada clip: [primer cuadro, último cuadro] del tramo en que la mano que agarra el sable (AGARRES de
 * efectos/escena.ts, la mesa vertical) se va de su lugar de la foto base: a más de 0.04 del alto del cuadro.
 * Sin entrada: la mano no se va en todo el clip. A 24 cuadros por segundo (reposos.ts).
 */
import type { ClipVideo } from './guion';

export const MANO_FUERA: Record<'claudio' | 'antonio', Partial<Record<ClipVideo, readonly [number, number]>>> = {
  claudio: {
    habla: [21, 94],
    piensa: [16, 103],
    teclea: [7, 102],
    lee: [14, 105],
    espera: [70, 98],
    risa: [24, 83],
    saluda: [15, 50],
    senala: [9, 83],
    sorpresa: [27, 76],
    triste: [24, 85],
    celebra: [14, 109],
    asiente: [22, 38],
    duda: [11, 87],
  },
  antonio: {
    habla: [35, 98],
    piensa: [13, 104],
    teclea: [11, 93],
    lee: [11, 104],
    espera: [76, 83],
    risa: [12, 66],
    saluda: [9, 98],
    sorpresa: [29, 74],
    celebra: [12, 93],
    duda: [25, 99],
    despide: [26, 98],
  },
};
