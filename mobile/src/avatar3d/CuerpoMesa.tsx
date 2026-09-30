/**
 * EL CUERPO 3D EN LA MESA (DeskScreen) para los avatares que se ven con fotos: Claudio y ANT-ONIO.
 *
 * La mesa habla en su idioma (el FaceState de la voz y el cerebro, la emoción del turno, la mirada de
 * la cámara); aquí se traduce al estado del contrato (contrato.ts, estadoDesdeMesa) y se le da a
 * AvatarVivo, con las fotos de siempre como respaldo (ClaudioRetrato acostado, ClaudioDePie derecho):
 * si no hay modelo, falla o el teléfono no da los cuadros, se ven las fotos exactamente como antes.
 *
 * El toque es el de la mesa (onTap / onLongPress: la reacción de la cara y la voz); además, el
 * cuerpo 3D hace su gesto de «le gusta» por la zona que tocó.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { AvatarVivo, type ControlCuerpo } from './AvatarVivo';
import { estadoDesdeMesa } from './contrato';
import type { AvatarId } from '../avatares/catalogo';
import type { Camara, EstadoAvatar } from './tipos';

type Props = {
  avatar: AvatarId;
  /** Retrato (acostado) o de cuerpo entero (derecho). */
  camara: Camara;
  face: string;
  emocion: string;
  mirada: { x: number; y: number; activa: boolean };
  /** Las fotos de siempre: lo que se ve sin 3D. */
  respaldo: ReactNode;
  onTap: () => void;
  onLongPress: () => void;
};

export function CuerpoMesa({ avatar, camara, face, emocion, mirada, respaldo, onTap, onLongPress }: Props) {
  const [lugar, setLugar] = useState({ w: 0, h: 0 });
  const [gesto, setGesto] = useState<EstadoAvatar['gesto']>(null);
  const cuerpo = useRef<ControlCuerpo>(null);
  const medir = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - lugar.w) > 1 || Math.abs(height - lugar.h) > 1) setLugar({ w: Math.round(width), h: Math.round(height) });
  };
  const { x, y, activa } = mirada;
  const estado = useMemo(() => estadoDesdeMesa(face, emocion, { mirar: { x, y, activa }, gesto }), [face, emocion, x, y, activa, gesto]);

  const tocar = async (px: number, py: number) => {
    onTap();
    const zona = await cuerpo.current?.zonaEn(px, py);
    if (!zona) return;
    const nombre = zona === 'mejilla' ? 'toque_mejilla' : zona === 'panza' ? 'toque_panza' : 'toque_cabeza';
    setGesto((g) => ({ nombre, n: (g?.n ?? 0) + 1 }));
  };

  return (
    <Pressable
      onLayout={medir}
      onPress={(e) => void tocar(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      onLongPress={onLongPress}
      delayLongPress={500}
      style={StyleSheet.absoluteFill}
      accessibilityRole="imagebutton"
    >
      {lugar.w > 0 && lugar.h > 0 ? (
        <AvatarVivo ref={cuerpo} avatar={avatar} camara={camara} estado={estado} ancho={lugar.w} alto={lugar.h} fpsMax={60} respaldo={respaldo} />
      ) : (
        respaldo
      )}
    </Pressable>
  );
}
