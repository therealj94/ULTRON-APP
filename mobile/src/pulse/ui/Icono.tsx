/**
 * LOS ICONOS DEL CHAT, trazados con Skia: líneas limpias del mismo grueso en una rejilla de 24,
 * nítidos a cualquier tamaño y del color del tema (nada de emojis que cambian de un teléfono a otro).
 *
 * `fin` (0 → 1) recorta el trazo: con un valor de Reanimated el icono SE DIBUJA solo, en el hilo de
 * la interfaz —así nace la palomita del botón Enviar—.
 */
import { useMemo } from 'react';
import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

const TRAZOS = {
  atras: 'M15 5 L8 12 L15 19',
  cerrar: 'M6 6 L18 18 M18 6 L6 18',
  abajo: 'M6 9.5 L12 15.5 L18 9.5',
  mas: 'M12 5 V19 M5 12 H19',
  buscar: 'M4 10.5 A6.5 6.5 0 1 0 17 10.5 A6.5 6.5 0 1 0 4 10.5 Z M15.4 15.4 L20 20',
  llamar:
    'M6.6 3.5 L9.2 3.5 L10.5 7.6 L8.6 9.4 C9.7 11.8 12.2 14.3 14.6 15.4 L16.4 13.5 L20.5 14.8 L20.5 17.4 C20.5 19 19.2 20.3 17.6 20.1 C10.2 19.3 4.7 13.8 3.9 6.4 C3.7 4.8 5 3.5 6.6 3.5 Z',
  video: 'M4 7 H14 A2 2 0 0 1 16 9 V15 A2 2 0 0 1 14 17 H4 A2 2 0 0 1 2 15 V9 A2 2 0 0 1 4 7 Z M16 10.5 L21.5 7.5 V16.5 L16 13.5',
  candado:
    'M6.5 11 H17.5 A1.5 1.5 0 0 1 19 12.5 V18.5 A1.5 1.5 0 0 1 17.5 20 H6.5 A1.5 1.5 0 0 1 5 18.5 V12.5 A1.5 1.5 0 0 1 6.5 11 Z M8.5 11 V8 A3.5 3.5 0 0 1 15.5 8 V11',
  escudo: 'M12 3 L19.5 6 V11.5 C19.5 16 16.3 19.6 12 21 C7.7 19.6 4.5 16 4.5 11.5 V6 Z M8.8 12 L11 14.2 L15.4 9.8',
  enviar: 'M4.5 12 L19.5 4.5 L15 19.5 L11.2 12.8 Z M11.2 12.8 L19.5 4.5',
  palomita: 'M5 12.5 L10 17.5 L19 7',
  personaMas: 'M5 8 A4 4 0 1 0 13 8 A4 4 0 1 0 5 8 Z M2.5 20 C2.5 16.4 5.4 14 9 14 C12.6 14 15.5 16.4 15.5 20 M19 8 V14 M16 11 H22',
  burbujas:
    'M4.5 5 H19.5 A1.5 1.5 0 0 1 21 6.5 V15.5 A1.5 1.5 0 0 1 19.5 17 H11 L6.5 20.5 V17 H4.5 A1.5 1.5 0 0 1 3 15.5 V6.5 A1.5 1.5 0 0 1 4.5 5 Z M7.5 9.5 H16.5 M7.5 12.5 H13.5',
  reloj: 'M3.5 12 A8.5 8.5 0 1 0 20.5 12 A8.5 8.5 0 1 0 3.5 12 Z M12 7.5 V12 L15 14',
  alerta: 'M3.5 12 A8.5 8.5 0 1 0 20.5 12 A8.5 8.5 0 1 0 3.5 12 Z M12 7.5 V12.5 M12 16 V16.2',
  chispa: 'M12 3 C12.6 8.4 15.6 11.4 21 12 C15.6 12.6 12.6 15.6 12 21 C11.4 15.6 8.4 12.6 3 12 C8.4 11.4 11.4 8.4 12 3 Z',
  // AURA al lado de los chats: agrandarla, acoplarla, achicarla, y su micrófono.
  expandir: 'M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15',
  achicar: 'M9 4 V9 H4 M20 9 H15 V4 M15 20 V15 H20 M4 15 H9 V20',
  acoplar: 'M4.5 5 H19.5 A1.5 1.5 0 0 1 21 6.5 V17.5 A1.5 1.5 0 0 1 19.5 19 H4.5 A1.5 1.5 0 0 1 3 17.5 V6.5 A1.5 1.5 0 0 1 4.5 5 Z M14.5 5 V19',
  microfono: 'M9 6 A3 3 0 0 1 15 6 V11 A3 3 0 0 1 9 11 Z M5.5 10.5 A6.5 6.5 0 0 0 18.5 10.5 M12 17 V20.5 M8.5 20.5 H15.5',
  microfonoNo: 'M9 6 A3 3 0 0 1 15 6 V11 A3 3 0 0 1 9 11 Z M5.5 10.5 A6.5 6.5 0 0 0 18.5 10.5 M12 17 V20.5 M8.5 20.5 H15.5 M4 4 L20 20',
  // La barra de la mesa y su hoja «Más».
  puntos: 'M4.5 12 A1.6 1.6 0 1 0 7.7 12 A1.6 1.6 0 1 0 4.5 12 Z M10.4 12 A1.6 1.6 0 1 0 13.6 12 A1.6 1.6 0 1 0 10.4 12 Z M16.3 12 A1.6 1.6 0 1 0 19.5 12 A1.6 1.6 0 1 0 16.3 12 Z',
  camara: 'M4 8 H7.5 L9 6 H15 L16.5 8 H20 A1 1 0 0 1 21 9 V18 A1 1 0 0 1 20 19 H4 A1 1 0 0 1 3 18 V9 A1 1 0 0 1 4 8 Z M8.5 13 A3.5 3.5 0 1 0 15.5 13 A3.5 3.5 0 1 0 8.5 13 Z',
  camaraNo: 'M4 8 H7.5 L9 6 H15 L16.5 8 H20 A1 1 0 0 1 21 9 V18 A1 1 0 0 1 20 19 H4 A1 1 0 0 1 3 18 V9 A1 1 0 0 1 4 8 Z M8.5 13 A3.5 3.5 0 1 0 15.5 13 A3.5 3.5 0 1 0 8.5 13 Z M3 3 L21 21',
  teclado: 'M3.5 7 H20.5 A1 1 0 0 1 21.5 8 V16 A1 1 0 0 1 20.5 17 H3.5 A1 1 0 0 1 2.5 16 V8 A1 1 0 0 1 3.5 7 Z M6 10.5 H6.1 M9 10.5 H9.1 M12 10.5 H12.1 M15 10.5 H15.1 M18 10.5 H18.1 M7.5 14 H16.5',
  caraId: 'M4 8 V5 A1 1 0 0 1 5 4 H8 M16 4 H19 A1 1 0 0 1 20 5 V8 M20 16 V19 A1 1 0 0 1 19 20 H16 M8 20 H5 A1 1 0 0 1 4 19 V16 M9 10 V10.5 M15 10 V10.5 M9.5 15 C10.8 16.2 13.2 16.2 14.5 15',
  ayuda: 'M3.5 12 A8.5 8.5 0 1 0 20.5 12 A8.5 8.5 0 1 0 3.5 12 Z M9.6 9.5 A2.5 2.5 0 1 1 12 12 V13.5 M12 16.6 V16.8',
  ajustes: 'M4 7 H14 M18 7 H20 M16 5 V9 M4 17 H8 M12 17 H20 M10 15 V19',
  cambiar: 'M7 7 H18 L15 4 M17 17 H6 L9 20',
} as const;

export type NombreIcono = keyof typeof TRAZOS;

type Props = {
  nombre: NombreIcono;
  tam?: number;
  color: string;
  /** Grueso del trazo en la rejilla de 24 (1,8 por omisión). */
  grosor?: number;
  /** Relleno en vez de línea (la chispa de AURA). */
  lleno?: boolean;
  /** 0 → 1: cuánto del trazo se ve. Acepta un valor de Reanimated. */
  fin?: number | SharedValue<number>;
  opacidad?: number | SharedValue<number>;
  style?: StyleProp<ViewStyle>;
};

// Los trazos se leen una vez: Skia los guarda ya armados.
const armados = new Map<string, ReturnType<typeof Skia.Path.MakeFromSVGString>>();
function trazo(n: NombreIcono) {
  let p = armados.get(n);
  if (!p) {
    p = Skia.Path.MakeFromSVGString(TRAZOS[n]);
    armados.set(n, p);
  }
  return p;
}

export function Icono({ nombre, tam = 24, color, grosor = 1.8, lleno, fin, opacidad, style }: Props) {
  const camino = useMemo(() => trazo(nombre), [nombre]);
  const escala = useMemo(() => [{ scale: tam / 24 }], [tam]);
  // Plano (no una lista): el lienzo de Skia en la web lo pasa tal cual a un <div>.
  const caja = useMemo(() => StyleSheet.flatten([{ width: tam, height: tam }, style]), [tam, style]);
  if (!camino) return null;
  return (
    <Canvas style={caja} pointerEvents="none">
      <Group transform={escala} opacity={opacidad ?? 1}>
        <Path
          path={camino}
          color={color}
          style={lleno ? 'fill' : 'stroke'}
          strokeWidth={grosor}
          strokeCap="round"
          strokeJoin="round"
          start={0}
          end={fin ?? 1}
        />
      </Group>
    </Canvas>
  );
}
