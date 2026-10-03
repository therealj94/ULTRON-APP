/**
 * EL CUERPO QUE TOCA: AU-RA, su orbe (OrbeMini); el video de Claudio y ANT-ONIO (avatares/video) si lo tiene, y el 3D
 * (AvatarVivo) solo para los que no tienen video o si el video falla en este teléfono.
 *
 * José (1-oct): «cuando salta a la versión 3D Claudio parpadea raro y no mueve su boca». El acople al
 * lado de los chats (DockAura) y la pantalla completa (EscenarioAura) montaban el 3D directo, aunque
 * hubiera video; la mesa (CuerpoMesa) y la llamada (CuerpoLlamada) ya elegían el video. Ahora todos
 * eligen igual, aquí.
 */
import { forwardRef, useState, type ReactNode } from 'react';
import { AvatarVivo, type ControlCuerpo } from './AvatarVivo';
import type { PropsCuerpo } from './contrato';
import { CuerpoVideo } from '../avatares/video/CuerpoVideo';
import { hayVideo } from '../avatares/video/clips';
import { OrbeMini } from './OrbeMini';

type Props = PropsCuerpo & {
  /** Lo que se ve si no hay ni video ni 3D (las fotos o la figura 2D). */
  respaldo: ReactNode;
  activo?: boolean;
  /** Saluda al aparecer (solo el video tiene ese golpe). */
  saludar?: boolean;
};

export const CuerpoElegido = forwardRef<ControlCuerpo, Props>(function CuerpoElegido({ avatar, camara, estado, ancho, alto, fpsMax, respaldo, activo = true, saludar = false }, ref) {
  const [sinVideo, setSinVideo] = useState(false);
  // AU-RA es su orbe (José, 3-oct: «en chat sigue saliendo el aura viejo»): ni el robot 3D ni la figurita dorada.
  if (avatar === 'aura') return <OrbeMini lado={Math.min(ancho, alto)} estado={estado} activo={activo} />;
  if (hayVideo(avatar) && !sinVideo) {
    return <CuerpoVideo ref={ref} avatar={avatar} camara={camara} estado={estado} ancho={ancho} alto={alto} respaldo={respaldo} activo={activo} saludar={saludar} onFallo={() => setSinVideo(true)} />;
  }
  return <AvatarVivo ref={ref} avatar={avatar} camara={camara} estado={estado} ancho={ancho} alto={alto} fpsMax={fpsMax} respaldo={respaldo} activo={activo} />;
});
