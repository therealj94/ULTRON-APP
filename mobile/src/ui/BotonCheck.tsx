/**
 * EL BOTÓN CHECK ✔: la palomita de la app.
 *
 * Vacío es un aro fino. Al completarse, un círculo se llena desde el centro con un resorte, la
 * palomita se dibuja de izquierda a derecha (el trazo crece, no aparece) y el teléfono da el toque de
 * «hecho». Lo usan la primera vez (Genesis compartió tu nombre ✔, permiso concedido ✔), los ajustes y
 * cualquier frente que quiera confirmar algo (mensaje enviado, llamada conectada):
 *
 *   <BotonCheck hecho={concedido} onPress={pedir} etiqueta="Micrófono" />
 *   <Palomita hecho />               // solo la marca, sin toque
 *
 * El círculo y el trazo se animan en el hilo de la interfaz (Reanimated → Skia): no tartamudea
 * aunque JavaScript esté ocupado pidiendo un permiso.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import Animated, { Easing, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { MEDIDA, useTema } from '../nucleo/tema';
import { vibrar } from './hapticos';

type Props = {
  hecho: boolean;
  onPress?: () => void;
  tam?: number;
  /** Color del círculo lleno (por omisión, el acento del tema). */
  color?: string;
  /** Color de la palomita sobre el círculo. */
  colorMarca?: string;
  etiqueta?: string;
  cargando?: boolean;
  deshabilitado?: boolean;
  /** false = sin vibración al completarse (listas que se marcan solas al abrir). */
  vibra?: boolean;
  /** Si llega ya hecho, se dibuja igual con su animación después de estos milisegundos. */
  animarAlMontar?: number;
  style?: StyleProp<ViewStyle>;
};

const MARCA = Skia.Path.MakeFromSVGString('M7 12.6 L10.4 16 L17.2 8.6');

export function BotonCheck({ hecho: pedido, onPress, tam = 34, color, colorMarca, etiqueta, cargando, deshabilitado, vibra = true, animarAlMontar, style }: Props) {
  const tema = useTema();
  const [visto, setVisto] = useState(animarAlMontar === undefined ? pedido : false);
  useEffect(() => {
    if (animarAlMontar === undefined) return;
    const t = setTimeout(() => setVisto(pedido), animarAlMontar);
    return () => clearTimeout(t);
  }, [pedido, animarAlMontar]);
  const hecho = animarAlMontar === undefined ? pedido : visto;
  const lleno = useSharedValue(hecho ? 1 : 0);
  const trazo = useSharedValue(hecho ? 1 : 0);
  const pulso = useSharedValue(1);
  const antes = useRef(hecho);

  useEffect(() => {
    if (hecho === antes.current) return;
    antes.current = hecho;
    if (hecho) {
      lleno.value = withSpring(1, { damping: 11, stiffness: 190, mass: 0.7 });
      trazo.value = withDelay(110, withTiming(1, { duration: 340, easing: Easing.out(Easing.cubic) }));
      pulso.value = withSequence(withTiming(1.14, { duration: 140 }), withSpring(1, MEDIDA.resorte.vivo));
      if (vibra) vibrar('exito');
    } else {
      trazo.value = withTiming(0, { duration: 140 });
      lleno.value = withTiming(0, { duration: 200 });
    }
  }, [hecho, lleno, trazo, pulso, vibra]);

  const c = tam / 2;
  const radio = useDerivedValue(() => Math.max(0, lleno.value) * (c - 0.5));
  const escalaMarca = tam / 24;
  const aPulso = useAnimatedStyle(() => ({ transform: [{ scale: pulso.value }] }));

  const lienzo = (
    <Animated.View style={[{ width: tam, height: tam }, aPulso]}>
      <Canvas style={{ width: tam, height: tam }} pointerEvents="none">
        <Circle cx={c} cy={c} r={c - 1.25} style="stroke" strokeWidth={1.5} color={tema.borde} />
        <Circle cx={c} cy={c} r={radio} color={color || tema.acento} />
        {MARCA && (
          <Group transform={[{ scale: escalaMarca }]}>
            <Path path={MARCA} style="stroke" strokeWidth={2.6} strokeCap="round" strokeJoin="round" color={colorMarca || tema.sobreAcento} start={0} end={trazo} />
          </Group>
        )}
      </Canvas>
      {cargando && (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={tema.acento} />
        </View>
      )}
    </Animated.View>
  );

  if (!onPress) return <View style={style}>{lienzo}</View>;
  return (
    <Pressable
      onPress={deshabilitado || cargando ? undefined : onPress}
      onPressIn={() => {
        pulso.value = withSpring(0.9, MEDIDA.resorte.vivo);
        vibrar('seleccion');
      }}
      onPressOut={() => {
        pulso.value = withSpring(1, MEDIDA.resorte.vivo);
      }}
      hitSlop={10}
      style={style}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: hecho, disabled: !!deshabilitado, busy: !!cargando }}
      accessibilityLabel={etiqueta}
    >
      {lienzo}
    </Pressable>
  );
}

/** Solo la marca ✔ animada (sin toque): para filas que ya vienen confirmadas. */
export function Palomita(props: Omit<Props, 'onPress'>) {
  return <BotonCheck {...props} />;
}
