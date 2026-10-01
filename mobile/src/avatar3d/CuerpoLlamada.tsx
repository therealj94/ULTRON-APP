/**
 * LA CARA 3D DE LA LLAMADA DEL AVATAR (compa/LlamadaAvatar): el mismo cuerpo que la compañera y la mesa
 * (AvatarVivo: el 3D si hay modelo y el teléfono lo aguanta; si no, el respaldo 2D que le pasan), con
 * la cámara de retrato y el estado del alma de AURA (contrato.ts, `estadoAvatar`): habla, escucha y
 * gesticula con la llamada. Mientras la llamada se ve, la compañera está escondida y la mesa tapada
 * (sus escenas 3D se apagan): nunca dos escenas 3D vivas a la vez. Claudio y ANT-ONIO van con su cuerpo
 * en video (avatares/video), con el mismo estado.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { AvatarVivo } from './AvatarVivo';
import { estadoAvatar } from './contrato';
import type { AvatarId } from '../avatares/catalogo';
import { CuerpoVideo } from '../avatares/video/CuerpoVideo';
import { hayVideo } from '../avatares/video/clips';

export function CuerpoLlamada({ avatar, lado, respaldo }: { avatar: AvatarId; lado: number; respaldo: ReactNode }) {
  const estado = useSyncExternalStore(estadoAvatar.escuchar, estadoAvatar.ultimo, estadoAvatar.ultimo);
  if (hayVideo(avatar)) return <CuerpoVideo avatar={avatar} camara="retrato" estado={estado} ancho={lado} alto={lado} respaldo={respaldo} />;
  return <AvatarVivo avatar={avatar} camara="retrato" estado={estado} ancho={lado} alto={lado} fpsMax={30} respaldo={respaldo} />;
}
