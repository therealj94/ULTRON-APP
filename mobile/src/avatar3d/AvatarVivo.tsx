/**
 * EL CUERPO QUE TOCA: el 3D si hay modelo para este avatar y el teléfono lo aguanta; si no, el
 * respaldo 2D que le pasen (la figurita de la compañera). La persona nunca ve el cambio:
 *
 *  · sin modelo (hoy): se dibuja SOLO el respaldo, exactamente como antes;
 *  · con modelo: el respaldo se dibuja mientras la escena 3D arranca debajo, invisible; cuando dice
 *    «listo», el 3D aparece fundiéndose y el respaldo se va;
 *  · si el 3D falla (en cualquier momento): se desmonta, vuelve el respaldo y se anota para no
 *    intentarlo otra vez con ese modelo en este teléfono (almacen.ts). Si falló la variante alta y el
 *    avatar tiene una ligera (modelo.ts), se prueba esa enseguida (capacidad.ts, varianteQueToca).
 *
 * El tacto lo pone quien lo monta; `zonaEn` le dice qué zona del modelo 3D hay bajo el dedo (null con
 * el respaldo: entonces vale la zona 2D, mapeo.zona2D).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { MODELOS_3D, type ModeloAvatar3D } from './modelo';
import { calidadGuardada, puedeProbar3D, recordarCalidad, recordarFallo3D } from './almacen';
import { cuerpoQueToca, varianteQueToca, type VarianteModelo } from './capacidad';
import { Avatar3D, type ControlAvatar3D } from './Avatar3D';
import type { PropsCuerpo } from './contrato';
import type { Calidad, ZonaToque } from './tipos';

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

/** El modelo de esa variante (la ligera lleva el mapeo de la alta). */
function modeloDe(m: ModeloAvatar3D | undefined, v: VarianteModelo | null): ModeloAvatar3D | undefined {
  if (!m || !v) return undefined;
  if (v === 'alta' || !m.ligero) return m;
  return { ...m.ligero, mapeo: m.mapeo };
}

export const AvatarVivo = forwardRef<ControlCuerpo, Props>(function AvatarVivo({ respaldo, dprMax, activo = true, ...cuerpo }, ref) {
  const base = MODELOS_3D[cuerpo.avatar];
  const [variante, setVariante] = useState<VarianteModelo | null>(null);
  const modelo = useMemo(() => modeloDe(base, variante), [base, variante]);
  const reducido = useReducedMotion();
  const [probar, setProbar] = useState(false);
  const [listo, setListo] = useState(false);
  const [calidad, setCalidad] = useState<Calidad>('alta');
  const control = useRef<ControlAvatar3D>(null);
  const opac3D = useSharedValue(0);

  // Qué variante toca: la alta si este teléfono no falló antes con ella; si falló, la ligera.
  useEffect(() => {
    setVariante(null);
    if (!base) return;
    let vivo = true;
    void Promise.all([puedeProbar3D(base.huella), base.ligero ? puedeProbar3D(base.ligero.huella) : false]).then(([alta, ligera]) => {
      if (vivo) setVariante(varianteQueToca({ puedeAlta: alta, hayLigera: !!base.ligero, puedeLigera: ligera }));
    });
    return () => {
      vivo = false;
    };
  }, [base]);

  // Solo se intenta si este teléfono no falló antes con este modelo.
  useEffect(() => {
    setListo(false);
    setProbar(false);
    opac3D.value = 0;
    if (!modelo) return;
    let vivo = true;
    void Promise.all([puedeProbar3D(modelo.huella), calidadGuardada(modelo.huella)]).then(([si, c]) => {
      if (!vivo) return;
      setCalidad(c);
      setProbar(si);
    });
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
  const alCalidad = useCallback((c: Calidad) => modelo && recordarCalidad(modelo.huella, c), [modelo]);
  const alFallo = useCallback(
    (motivo: string) => {
      if (modelo) recordarFallo3D(modelo.huella, motivo);
      opac3D.value = 0;
      setListo(false);
      setProbar(false);
      // Falló la alta: si hay ligera (y no falló antes), se prueba esa (otra huella, otra escena).
      if (variante === 'alta' && base?.ligero) void puedeProbar3D(base.ligero.huella).then((si) => si && setVariante('ligera'));
    },
    [base, modelo, opac3D, variante]
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
        {/* Otra huella (otro avatar u otro modelo) es otra escena: la WebView arranca de cero. */}
        <Avatar3D
          key={modelo.huella}
          ref={control}
          modelo={modelo}
          {...cuerpo}
          dprMax={dprMax}
          reducido={reducido}
          calidad={calidad}
          onListo={alListo}
          onFallo={alFallo}
          onCalidad={alCalidad}
        />
      </Animated.View>
    </View>
  );
});

const s = StyleSheet.create({ centro: { alignItems: 'center', justifyContent: 'center' } });
