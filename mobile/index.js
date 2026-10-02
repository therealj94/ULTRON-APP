/**
 * La entrada de la app (antes `expo/AppEntry.js`, que hace lo mismo sin el manejador de fondo).
 *
 * Primero el manejador de fondo de Firebase Messaging (src/push/fondo.ts): con la app cerrada, Android
 * despierta el JS solo para entregar un aviso del servidor, y el manejador tiene que estar registrado
 * antes que la app. Después, la app de siempre.
 */
// Los gestos nativos, primero (como hacía App.tsx al ser la entrada).
import 'react-native-gesture-handler';
import './src/push/fondo';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
