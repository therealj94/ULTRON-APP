/**
 * LOS ICONOS DE LA PESTAÑA CORREOS (sobre, responder, responder a todos, redactar, clip…), trazados con
 * Skia como los del chat (pulse/ui/Icono) y los de WhatsApp: nítidos a cualquier tamaño y del color que
 * se pida. Van aparte para no tocar los de los otros chats.
 */
import { useMemo } from 'react';
import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

const TRAZOS = {
  atras: 'M15 5 L8 12 L15 19',
  cerrar: 'M6 6 L18 18 M18 6 L6 18',
  buscar: 'M4 10.5 A6.5 6.5 0 1 0 17 10.5 A6.5 6.5 0 1 0 4 10.5 Z M15.4 15.4 L20 20',
  reintentar: 'M4.5 12 A7.5 7.5 0 1 0 6.7 6.7 M4.5 3.5 V8 H9',
  sobre: 'M4 6 H20 A1 1 0 0 1 21 7 V17 A1 1 0 0 1 20 18 H4 A1 1 0 0 1 3 17 V7 A1 1 0 0 1 4 6 Z M3.5 7 L12 13 L20.5 7',
  responder: 'M10 6 L4 12 L10 18 M4 12 H14 A6 6 0 0 1 20 18',
  responderTodos: 'M12.5 6.5 L7 12 L12.5 17.5 M7.5 6.5 L2 12 L7.5 17.5 M7 12 H15 A6 6 0 0 1 21 18',
  lapiz: 'M4 20 L4.8 16.2 L15.5 5.5 A2.1 2.1 0 0 1 18.5 8.5 L7.8 19.2 Z M13.8 7.2 L16.8 10.2',
  enviar: 'M3.5 20 L21 12 L3.5 4 L3.5 10.2 L15 12 L3.5 13.8 Z',
  clip: 'M16.5 7.5 L9 15 A2 2 0 0 0 11.8 17.8 L19.2 10.4 A4 4 0 0 0 13.6 4.8 L6 12.4 A6 6 0 0 0 14.5 20.9 L20 15.4',
  abajo: 'M6 9.5 L12 15.5 L18 9.5',
  arriba: 'M6 14.5 L12 8.5 L18 14.5',
  mas: 'M12 5 V19 M5 12 H19',
  cuentas: 'M12 12 A4.5 4.5 0 1 0 12 3 A4.5 4.5 0 1 0 12 12 Z M3.5 21 C3.5 16.6 7.3 14 12 14 C16.7 14 20.5 16.6 20.5 21',
  alerta: 'M3.5 12 A8.5 8.5 0 1 0 20.5 12 A8.5 8.5 0 1 0 3.5 12 Z M12 7.5 V12.5 M12 16 V16.2',
} as const;

export type NombreIconoCorreo = keyof typeof TRAZOS;

const LLENOS = new Set<NombreIconoCorreo>(['enviar']);

const armados = new Map<string, ReturnType<typeof Skia.Path.MakeFromSVGString>>();
function trazo(n: NombreIconoCorreo) {
  let p = armados.get(n);
  if (!p) {
    p = Skia.Path.MakeFromSVGString(TRAZOS[n]);
    armados.set(n, p);
  }
  return p;
}

type Props = { nombre: NombreIconoCorreo; tam?: number; color: string; grosor?: number; style?: StyleProp<ViewStyle> };

export function IconoCorreo({ nombre, tam = 24, color, grosor = 2, style }: Props) {
  const camino = useMemo(() => trazo(nombre), [nombre]);
  const escala = useMemo(() => [{ scale: tam / 24 }], [tam]);
  const caja = useMemo(() => StyleSheet.flatten([{ width: tam, height: tam }, style]), [tam, style]);
  if (!camino) return null;
  return (
    <Canvas style={caja} pointerEvents="none">
      <Group transform={escala}>
        <Path path={camino} color={color} style={LLENOS.has(nombre) ? 'fill' : 'stroke'} strokeWidth={grosor} strokeCap="round" strokeJoin="round" />
      </Group>
    </Canvas>
  );
}
