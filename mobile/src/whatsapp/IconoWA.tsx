/**
 * LOS ICONOS DE WHATSAPP EN LA APP (palomitas, documento, nota de voz, grupo…), trazados con Skia como
 * los del chat (pulse/ui/Icono): nítidos a cualquier tamaño y del color que se pida. Van aparte para no
 * tocar los de PULSE2CHAT.
 */
import { useMemo } from 'react';
import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

const TRAZOS = {
  atras: 'M15 5 L8 12 L15 19',
  cerrar: 'M6 6 L18 18 M18 6 L6 18',
  buscar: 'M4 10.5 A6.5 6.5 0 1 0 17 10.5 A6.5 6.5 0 1 0 4 10.5 Z M15.4 15.4 L20 20',
  puntos: 'M10.4 5 A1.6 1.6 0 1 0 13.6 5 A1.6 1.6 0 1 0 10.4 5 Z M10.4 12 A1.6 1.6 0 1 0 13.6 12 A1.6 1.6 0 1 0 10.4 12 Z M10.4 19 A1.6 1.6 0 1 0 13.6 19 A1.6 1.6 0 1 0 10.4 19 Z',
  llamar:
    'M6.6 3.5 L9.2 3.5 L10.5 7.6 L8.6 9.4 C9.7 11.8 12.2 14.3 14.6 15.4 L16.4 13.5 L20.5 14.8 L20.5 17.4 C20.5 19 19.2 20.3 17.6 20.1 C10.2 19.3 4.7 13.8 3.9 6.4 C3.7 4.8 5 3.5 6.6 3.5 Z',
  video: 'M4 7 H14 A2 2 0 0 1 16 9 V15 A2 2 0 0 1 14 17 H4 A2 2 0 0 1 2 15 V9 A2 2 0 0 1 4 7 Z M16 10.5 L21.5 7.5 V16.5 L16 13.5',
  camara: 'M4 8 H7.5 L9 6 H15 L16.5 8 H20 A1 1 0 0 1 21 9 V18 A1 1 0 0 1 20 19 H4 A1 1 0 0 1 3 18 V9 A1 1 0 0 1 4 8 Z M8.5 13 A3.5 3.5 0 1 0 15.5 13 A3.5 3.5 0 1 0 8.5 13 Z',
  microfono: 'M9 6 A3 3 0 0 1 15 6 V11 A3 3 0 0 1 9 11 Z M5.5 10.5 A6.5 6.5 0 0 0 18.5 10.5 M12 17 V20.5 M8.5 20.5 H15.5',
  enviar: 'M3.5 20 L21 12 L3.5 4 L3.5 10.2 L15 12 L3.5 13.8 Z',
  check: 'M4.5 12.5 L9.5 17.5 L19.5 7',
  reloj: 'M3.5 12 A8.5 8.5 0 1 0 20.5 12 A8.5 8.5 0 1 0 3.5 12 Z M12 7.5 V12 L15 14',
  alerta: 'M3.5 12 A8.5 8.5 0 1 0 20.5 12 A8.5 8.5 0 1 0 3.5 12 Z M12 7.5 V12.5 M12 16 V16.2',
  documento: 'M6 3 H14 L19 8 V20 A1 1 0 0 1 18 21 H6 A1 1 0 0 1 5 20 V4 A1 1 0 0 1 6 3 Z M14 3 V8 H19 M8.5 13 H15.5 M8.5 16.5 H13.5',
  play: 'M8 5 L19 12 L8 19 Z',
  pausa: 'M7 5 H10.5 V19 H7 Z M13.5 5 H17 V19 H13.5 Z',
  persona: 'M12 12 A4.5 4.5 0 1 0 12 3 A4.5 4.5 0 1 0 12 12 Z M3.5 21 C3.5 16.6 7.3 14 12 14 C16.7 14 20.5 16.6 20.5 21 Z',
  grupo: 'M5.5 8.5 A3.5 3.5 0 1 0 12.5 8.5 A3.5 3.5 0 1 0 5.5 8.5 Z M2 20 C2 16.5 5.1 14 9 14 C12.9 14 16 16.5 16 20 Z M13.6 8 A2.9 2.9 0 1 0 19.4 8 A2.9 2.9 0 1 0 13.6 8 Z M15.2 13.4 C19 13.2 22 15.9 22 20 H17.4 C17.4 17.4 16.6 15.2 15.2 13.4 Z',
  sticker: 'M5 4 H19 A1 1 0 0 1 20 5 V13 L13 20 H5 A1 1 0 0 1 4 19 V5 A1 1 0 0 1 5 4 Z M13 20 V14 A1 1 0 0 1 14 13 H20',
  ubicacion: 'M12 21 C12 21 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C19 14.5 12 21 12 21 Z M9.5 9.5 A2.5 2.5 0 1 0 14.5 9.5 A2.5 2.5 0 1 0 9.5 9.5 Z',
  contacto: 'M12 11.5 A3.5 3.5 0 1 0 12 4.5 A3.5 3.5 0 1 0 12 11.5 Z M5.5 19.5 C5.5 16.2 8.4 14 12 14 C15.6 14 18.5 16.2 18.5 19.5',
  encuesta: 'M5 20 V10 M12 20 V4 M19 20 V14',
  prohibido: 'M3.5 12 A8.5 8.5 0 1 0 20.5 12 A8.5 8.5 0 1 0 3.5 12 Z M6 6 L18 18',
  reintentar: 'M4.5 12 A7.5 7.5 0 1 0 6.7 6.7 M4.5 3.5 V8 H9',
  descargar: 'M12 4 V15 M7 10.5 L12 15.5 L17 10.5 M5 20 H19',
  nuevoChat: 'M4.5 4.5 H19.5 A1.5 1.5 0 0 1 21 6 V15.5 A1.5 1.5 0 0 1 19.5 17 H11 L6.5 20.5 V17 H4.5 A1.5 1.5 0 0 1 3 15.5 V6 A1.5 1.5 0 0 1 4.5 4.5 Z M12 7.8 V13.8 M9 10.8 H15',
} as const;

export type NombreIconoWA = keyof typeof TRAZOS;

/** Los que se rellenan (no se trazan). */
const LLENOS = new Set<NombreIconoWA>(['enviar', 'play', 'pausa', 'persona', 'grupo', 'llamar']);

const armados = new Map<string, ReturnType<typeof Skia.Path.MakeFromSVGString>>();
function trazo(n: NombreIconoWA) {
  let p = armados.get(n);
  if (!p) {
    p = Skia.Path.MakeFromSVGString(TRAZOS[n]);
    armados.set(n, p);
  }
  return p;
}

type Props = {
  nombre: NombreIconoWA;
  tam?: number;
  color: string;
  grosor?: number;
  /** Forzar relleno o trazo (por omisión, el de cada icono). */
  lleno?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IconoWA({ nombre, tam = 24, color, grosor = 2, lleno, style }: Props) {
  const camino = useMemo(() => trazo(nombre), [nombre]);
  const escala = useMemo(() => [{ scale: tam / 24 }], [tam]);
  const caja = useMemo(() => StyleSheet.flatten([{ width: tam, height: tam }, style]), [tam, style]);
  if (!camino) return null;
  const relleno = lleno ?? LLENOS.has(nombre);
  return (
    <Canvas style={caja} pointerEvents="none">
      <Group transform={escala}>
        <Path path={camino} color={color} style={relleno ? 'fill' : 'stroke'} strokeWidth={grosor} strokeCap="round" strokeJoin="round" />
      </Group>
    </Canvas>
  );
}
