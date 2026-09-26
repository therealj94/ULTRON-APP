/**
 * Los bordes que tapa el sistema, para la pantalla que los pida. La cuenta está en `bordes.ts`.
 *
 * Se recalcula al girar: `useWindowDimensions` vuelve a pintar cuando cambia la ventana, y en ese
 * momento `Dimensions.get('screen')` ya trae la pantalla girada.
 */
import { useMemo } from 'react';
import { Dimensions, Platform, StatusBar, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calcularBordes, type Bordes } from './bordes';

/**
 * Primero los insets reales de la ventana (react-native-safe-area-context, con el SafeAreaProvider
 * de ElectrumApp): son exactos en cualquier Android, con gestos o con tres botones, y saben de qué
 * lado quedó la barra al girar. Si todavía no llegaron (primer cuadro) o vienen en cero en Android,
 * se usa la cuenta de `bordes.ts`, que nunca deja la marca ni el botón de mandar bajo el sistema.
 */
export function useBordes(): Bordes {
  const ventana = useWindowDimensions();
  const pantalla = Dimensions.get('screen');
  const i = useSafeAreaInsets();
  return useMemo(() => {
    const reales = { arriba: i.top, abajo: i.bottom, izquierda: i.left, derecha: i.right };
    if (Platform.OS !== 'android' || i.top > 0) return reales;
    return calcularBordes({
      os: Platform.OS,
      barraEstado: StatusBar.currentHeight,
      ventana: { width: ventana.width, height: ventana.height },
      pantalla: { width: pantalla.width, height: pantalla.height },
    });
  }, [i.top, i.bottom, i.left, i.right, ventana.width, ventana.height, pantalla.width, pantalla.height]);
}
