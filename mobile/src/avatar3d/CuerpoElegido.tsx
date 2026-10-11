/**
 * EL CUERPO QUE TOCA: AU-RA, su orbe (OrbeAuraChica: el mismo orbe de partículas de la mesa, José 11-oct); el video de Claudio y ANT-ONIO (avatares/video) si lo tiene, y el 3D
 * (AvatarVivo) solo para los que no tienen video o si el video falla en este teléfono.
 *
 * José (1-oct): «cuando salta a la versión 3D Claudio parpadea raro y no mueve su boca». El acople al
 * lado de los chats (DockAura) y la pantalla completa (EscenarioAura) montaban el 3D directo, aunque
 * hubiera video; la mesa (CuerpoMesa) y la llamada (CuerpoLlamada) ya elegían el video. Ahora todos
 * eligen igual, aquí.
 *
 * José (11-oct): «cuando se hace pequeño aura en chat se vea igual cuando es avatar». AU-RA chiquita era la foto del orbe
 * (OrbeMini), sin sus colores ni sus expresiones; ahora es el MISMO orbe de partículas de la mesa, con su estado y su
 * emoción (avatar3d/OrbeAuraChica.tsx), y la foto solo mientras arranca o si no le toca el turno del orbe vivo.
 */
import { forwardRef, useState, type ForwardedRef, type ReactNode } from 'react';
import { AvatarVivo, type ControlCuerpo } from './AvatarVivo';
import type { PropsCuerpo } from './contrato';
import { CuerpoVideo, type ControlVideo } from '../avatares/video/CuerpoVideo';
import { hayVideo } from '../avatares/video/clips';
import { OrbeAuraChica } from './OrbeAuraChica';

type Props = PropsCuerpo & {
  /** Lo que se ve si no hay ni video ni 3D (las fotos o la figura 2D). */
  respaldo: ReactNode;
  activo?: boolean;
  /** Saluda al aparecer (solo el video tiene ese golpe). */
  saludar?: boolean;
};

export const CuerpoElegido = forwardRef<ControlCuerpo, Props>(function CuerpoElegido({ avatar, camara, estado, ancho, alto, fpsMax, respaldo, activo = true, saludar = false }, ref) {
  const [sinVideo, setSinVideo] = useState(false);
  // AU-RA es su orbe (José, 3-oct: «en chat sigue saliendo el aura viejo»): ni el robot 3D ni la figurita dorada. Y el
  // mismo de la mesa, con su estado y su emoción (José, 11-oct: «se vea igual cuando es avatar»).
  if (avatar === 'aura') return <OrbeAuraChica lado={Math.min(ancho, alto)} estado={estado} activo={activo} />;
  if (hayVideo(avatar) && !sinVideo) {
    // El video da más que ControlCuerpo (la mano del sable, sostener el clip): aquí solo se usa la zona.
    return <CuerpoVideo ref={ref as ForwardedRef<ControlVideo>} avatar={avatar} camara={camara} estado={estado} ancho={ancho} alto={alto} respaldo={respaldo} activo={activo} saludar={saludar} onFallo={() => setSinVideo(true)} />;
  }
  return <AvatarVivo ref={ref} avatar={avatar} camara={camara} estado={estado} ancho={ancho} alto={alto} fpsMax={fpsMax} respaldo={respaldo} activo={activo} />;
});
