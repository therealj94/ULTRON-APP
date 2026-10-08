import 'react-native-gesture-handler';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { AppAura } from './src/app/AppAura';
import { ES_ELECTRUM } from './src/variante';
import ElectrumApp from './src/electrum/ElectrumApp';
import { useActualizacionAlVolver } from './src/lib/ota';
import { marcarActividad } from './src/lib/barreraOta';
import { useRaizVacia } from './src/lib/recarga';

/**
 * El splash nativo (negro con el ícono) se queda hasta que la intro está pintada encima: negro sobre
 * negro, sin pantallazo blanco ni corte. La intro (src/app/pantallas/Intro.tsx) lo quita.
 */
void SplashScreen.preventAutoHideAsync().catch(() => {});
try {
  SplashScreen.setOptions({ duration: 350, fade: true });
} catch {
  /* versión sin setOptions */
}

/**
 * Un binario, dos aplicaciones.
 *
 * La bifurcación va arriba del todo y es total: la app del doctor no atraviesa nada del arranque de
 * AU-RA. La carcasa de AU-RA (intro, entrada con Genesis ID, primera vez, navegación nativa, la mesa
 * y Ajustes) vive en src/app/AppAura.tsx; Dr Electrum sigue con la suya, igual que antes.
 *
 * Que sea una constante del manifiesto y no una prop permite que Metro y el motor descarten el
 * camino muerto.
 */
export default function App() {
  // Antes de bifurcar: las actualizaciones por aire. Solo AU-RA las tiene encendidas; en Dr Electrum
  // `Updates.isEnabled` es falso y el hook no hace nada.
  useActualizacionAlVolver();
  // Recargando (src/lib/recarga.ts): nada montado. Así todo <Video> de expo-av suelta su reproductor en el hilo
  // principal antes de que la recarga destruya la instancia desde otro (el cierre del 8-oct).
  const vacia = useRaizVacia();
  if (vacia) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  // Cada toque, en cualquier pantalla, cuenta como actividad: la OTA no recarga en plena mano.
  // onTouchStart burbujea desde el hijo tocado sin quitarle el toque a nadie.
  return (
    <View style={{ flex: 1 }} onTouchStart={() => marcarActividad()}>
      {ES_ELECTRUM ? <ElectrumApp /> : <AppAura />}
    </View>
  );
}
