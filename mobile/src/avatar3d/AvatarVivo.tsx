/**
 * EL CUERPO QUE TOCA: el 3D si hay modelo para este avatar y el teléfono lo aguanta; si no, el
 * respaldo 2D que le pasen (la figurita de la compañera). La persona nunca ve el cambio:
 *
 *  · sin modelo (hoy): se dibuja SOLO el respaldo, exactamente como antes;
 *  · con modelo: el respaldo se dibuja mientras la escena 3D arranca debajo, invisible; cuando dice
 *    «listo», el 3D aparece fundiéndose y el respaldo se va;
 *  · si el 3D falla (en cualquier momento): se desmonta, vuelve el respaldo y se anota para no
 *    intentarlo otra vez con ese modelo en este teléfono (almacen.ts).
 *
 * El tacto lo pone quien lo monta; `zonaEn` le dice qué zona del modelo 3D hay bajo el dedo (null con
 * el respaldo: entonces vale la zona 2D, mapeo.zona2D).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { MODELOS_3D } from './modelo';
import { puedeProbar3D, recordarFallo3D } from './almacen';
import { cuerpoQueToca } from './capacidad';
import { Avatar3D, type ControlAvatar3D } from './Avatar3D';
import type { PropsCuerpo } from './contrato';
import type { ZonaToque } from './tipos';

export type ControlCuerpo = { zonaEn: (x: number, y: number) => Promise<ZonaToque | null> };

type Props = PropsCuerpo & {
  /** El cuerpo 2D (se ve siempre que el 3D no esté listo). */
  respaldo: ReactNode;
  dprMax?: number;
  /** false: escondido (una llamada, AURA en otro lado): sin escena 3D gastando batería. */
  activo?: boolean;
};

/** ¿Hay modelo 3D para este avatar? (sin él, AvatarVivo es solo su respaldo). */
export function hayModelo3D(avatar: PropsCuerpo['avatar']): boolean {
  return !!MODELOS_3D[avatar];
}

export const AvatarVivo = forwardRef<ControlCuerpo, Props>(function AvatarVivo({ respaldo, dprMax, activo = true, ...cuerpo }, ref) {
  const modelo = MODELOS_3D[cuerpo.avatar];
  const reducido = useReducedMotion();
  const [probar, setProbar] = useState(false);
  const [listo, setListo] = useState(false);
  const control = useRef<ControlAvatar3D>(null);
  const opac3D = useSharedValue(0);

  // Solo se intenta si este teléfono no falló antes con este modelo.
  useEffect(() => {
    setListo(false);
    setProbar(false);
    opac3D.value = 0;
    if (!modelo) return;
    let vivo = true;
    void puedeProbar3D(modelo.huella).then((si) => vivo && setProbar(si));
    return () => {
      vivo = false;
    };
  }, [modelo, opac3D]);

  // Escondido, la escena se desmonta: al volver arranca de nuevo con el respaldo a la vista.
  useEffect(() => {
    if (activo) return;
    opac3D.value = 0;
    setListo(false);
  }, [activo, opac3D]);

  const alListo = useCallback(() => {
    setListo(true);
    opac3D.value = withTiming(1, { duration: 320 });
  }, [opac3D]);
  const alFallo = useCallback(
    (motivo: string) => {
      if (modelo) recordarFallo3D(modelo.huella, motivo);
      opac3D.value = 0;
      setListo(false);
      setProbar(false);
    },
    [modelo, opac3D]
  );

  useImperativeHandle(ref, () => ({ zonaEn: async (x, y) => (listo && control.current ? control.current.zonaEn(x, y) : null) }), [listo]);

  const estilo3D = useAnimatedStyle(() => ({ opacity: opac3D.value }));
  const estiloRespaldo = useAnimatedStyle(() => ({ opacity: 1 - opac3D.value }));

  // Sin modelo, o este teléfono no lo aguanta: el respaldo tal cual, sin nada alrededor.
  if (cuerpoQueToca({ hayModelo: !!modelo, puedeProbar: probar, activo, listo }) === '2d' || !modelo) return <>{respaldo}</>;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, estiloRespaldo]}>{respaldo}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, s.centro, estilo3D]}>
        <Avatar3D ref={control} modelo={modelo} {...cuerpo} dprMax={dprMax} reducido={reducido} onListo={alListo} onFallo={alFallo} />
      </Animated.View>
    </View>
  );
});

const s = StyleSheet.create({ centro: { alignItems: 'center', justifyContent: 'center' } });
