import 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { AppAura } from './src/app/AppAura';
import { ES_ELECTRUM } from './src/variante';
import ElectrumApp from './src/electrum/ElectrumApp';
import { useActualizacionAlVolver } from './src/lib/ota';

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
  if (ES_ELECTRUM) return <ElectrumApp />;
  return <AppAura />;
}
