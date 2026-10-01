/**
 * Los clips de video de Claudio y ANT-ONIO (assets/avatares/video, 720×1280 H.264 sin audio, ~300 KB
 * cada uno). Metro los empaqueta como cualquier foto: van en la actualización OTA y funcionan sin red.
 * Cómo se hicieron y cómo se regeneran: docs/avatares-video.md.
 */
import type { AvatarId } from '../catalogo';
import type { ClipVideo } from './guion';

export type ClipsAvatar = Record<ClipVideo, number>;

export const CLIPS: Partial<Record<AvatarId, ClipsAvatar>> = {
  claudio: {
    reposo: require('../../../assets/avatares/video/claudio-reposo.mp4'),
    escucha: require('../../../assets/avatares/video/claudio-escucha.mp4'),
    habla: require('../../../assets/avatares/video/claudio-habla.mp4'),
    piensa: require('../../../assets/avatares/video/claudio-piensa.mp4'),
    risa: require('../../../assets/avatares/video/claudio-risa.mp4'),
    saluda: require('../../../assets/avatares/video/claudio-saluda.mp4'),
    senala: require('../../../assets/avatares/video/claudio-senala.mp4'),
    sorpresa: require('../../../assets/avatares/video/claudio-sorpresa.mp4'),
    triste: require('../../../assets/avatares/video/claudio-triste.mp4'),
  },
  antonio: {
    reposo: require('../../../assets/avatares/video/antonio-reposo.mp4'),
    escucha: require('../../../assets/avatares/video/antonio-escucha.mp4'),
    habla: require('../../../assets/avatares/video/antonio-habla.mp4'),
    piensa: require('../../../assets/avatares/video/antonio-piensa.mp4'),
    risa: require('../../../assets/avatares/video/antonio-risa.mp4'),
    saluda: require('../../../assets/avatares/video/antonio-saluda.mp4'),
    senala: require('../../../assets/avatares/video/antonio-senala.mp4'),
    sorpresa: require('../../../assets/avatares/video/antonio-sorpresa.mp4'),
    triste: require('../../../assets/avatares/video/antonio-triste.mp4'),
  },
};

/** ¿Tiene este avatar su cuerpo en video? */
export function hayVideo(avatar: AvatarId): avatar is 'claudio' | 'antonio' {
  return !!CLIPS[avatar];
}
