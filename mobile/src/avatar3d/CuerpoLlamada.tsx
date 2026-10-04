/**
 * LA CARA 3D DE LA LLAMADA DEL AVATAR (compa/LlamadaAvatar): el mismo cuerpo que la compañera y la mesa
 * (AvatarVivo: el 3D si hay modelo y el teléfono lo aguanta; si no, el respaldo 2D que le pasan), con
 * la cámara de retrato y el estado del alma de AURA (contrato.ts, `estadoAvatar`): habla, escucha y
 * gesticula con la llamada. Mientras la llamada se ve, la compañera está escondida y la mesa tapada
 * (sus escenas 3D se apagan): nunca dos escenas 3D vivas a la vez. Claudio y ANT-ONIO van con su cuerpo
 * en video (avatares/video), con el mismo estado.
 *
 * En video, los toques también hacen sus efectos (avatares/video/efectos), pero en la llamada siempre
 * en chico: una onda, y con cuatro toques un sable o unos blasters cortos, sin sonido, sin golpes del
 * video y sin frase (la voz es de la llamada). El toque lo sigue recibiendo la cara de LlamadaAvatar (el
 * doble toque que silencia): aquí solo se mira, en la fase de captura, y se devuelve false para no
 * quedárselo.
 */
import { useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { AvatarVivo } from './AvatarVivo';
import { estadoAvatar } from './contrato';
import type { AvatarId } from '../avatares/catalogo';
import { CuerpoVideo } from '../avatares/video/CuerpoVideo';
import { hayVideo } from '../avatares/video/clips';
import { CapaEfectos, type ControlEfectos } from '../avatares/video/efectos/CapaEfectos';

export function CuerpoLlamada({ avatar, lado, respaldo }: { avatar: AvatarId; lado: number; respaldo: ReactNode }) {
  const estado = useSyncExternalStore(estadoAvatar.escuchar, estadoAvatar.ultimo, estadoAvatar.ultimo);
  const efectos = useRef<ControlEfectos>(null);
  const contexto = useMemo(
    () => ({ enLlamada: true, hablando: estado.hablando, escuchando: estado.escuchando, pensando: estado.pensando, dormido: estado.silenciado }),
    [estado.hablando, estado.escuchando, estado.pensando, estado.silenciado]
  );
  if (hayVideo(avatar)) {
    const mirar = (e: GestureResponderEvent) => {
      efectos.current?.tocar(e.nativeEvent.locationX, e.nativeEvent.locationY);
      return false;
    };
    return (
      <View style={StyleSheet.absoluteFill} collapsable={false} onStartShouldSetResponderCapture={mirar}>
        <CapaEfectos ref={efectos} avatar={avatar} lugar="llamada" ancho={lado} alto={lado} contexto={contexto}>
          <CuerpoVideo avatar={avatar} camara="retrato" estado={estado} ancho={lado} alto={lado} respaldo={respaldo} />
        </CapaEfectos>
      </View>
    );
  }
  return <AvatarVivo avatar={avatar} camara="retrato" estado={estado} ancho={lado} alto={lado} fpsMax={30} respaldo={respaldo} />;
}
