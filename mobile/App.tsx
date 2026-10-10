import 'react-native-gesture-handler';
import { Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { AppAura } from './src/app/AppAura';
import { ES_ELECTRUM } from './src/variante';
import ElectrumApp from './src/electrum/ElectrumApp';
import { useActualizacionAlVolver } from './src/lib/ota';
import { marcarActividad } from './src/lib/barreraOta';
import { useRaizVacia } from './src/lib/recarga';
import { modoDeArranque } from './src/entrada/enlace';
import { RaizBurbuja } from './src/burbuja/Burbuja';

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
 * La burbuja del asistente digital (botón lateral, mosaico, atajo: plugins/asistente-digital.js). BurbujaActivity
 * arranca el MISMO componente con `{ modo: 'burbuja', origen, invocadaEn }` en las props: en vez de la app se dibuja la
 * burbuja sobre fondo transparente (src/burbuja/Burbuja.tsx). Antes de todo lo demás: sin la actualización al volver
 * (una OTA recargaría el JS con la persona hablándole encima de otra app) ni el splash, que es de MainActivity. Solo
 * AU-RA tiene esa actividad; en Dr Electrum las props nunca traen el modo.
 */
export default function App(props: Record<string, unknown>) {
  const modo = modoDeArranque(props);
  if (modo.modo === 'burbuja' && !ES_ELECTRUM) return <RaizBurbuja origen={modo.origen} invocadaEn={modo.invocadaEn} />;
  return <AppEntera />;
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
function AppEntera() {
  // Antes de bifurcar: las actualizaciones por aire. Solo AU-RA las tiene encendidas; en Dr Electrum
  // `Updates.isEnabled` es falso y el hook no hace nada.
  useActualizacionAlVolver();
  // Recargando (src/lib/recarga.ts): nada montado. Así todo <Video> de expo-av suelta su reproductor en el hilo
  // principal antes de que la recarga destruya la instancia desde otro (el cierre del 8-oct).
  const vacia = useRaizVacia();
  if (vacia)
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#8a8a8a', fontSize: 15 }}>Actualizando…</Text>
      </View>
    );
  // Cada toque, en cualquier pantalla, cuenta como actividad: la OTA no recarga en plena mano.
  // onTouchStart burbujea desde el hijo tocado sin quitarle el toque a nadie.
  return (
    <View style={{ flex: 1 }} onTouchStart={() => marcarActividad()}>
      {ES_ELECTRUM ? <ElectrumApp /> : <AppAura />}
    </View>
  );
}
