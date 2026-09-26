// react-native-web con cara de Android, para el banco de pruebas.
//
// La app del doctor solo se publica como APK, y lo que se revisa acá (márgenes de las barras del
// sistema, el diálogo de salir) depende de `Platform.OS === 'android'`. Esto re-exporta
// react-native-web tal cual y cambia solo tres cosas:
//   · `Platform` dice android (y el nivel de API de `?api=`, 35 por omisión);
//   · `StatusBar.currentHeight` vale 24, lo que mide la barra de estado de un teléfono típico;
//   · `Alert.alert` no es mudo: anota el diálogo en `window.__alertas` y en la consola, y el banco
//     puede «tocar» un botón con `window.__tocarAlerta(texto)`;
//   · `BackHandler` existe (el de react-native-web solo se queja por consola) y el banco aprieta
//     «atrás» con `window.__atras()`.
// `?os=web` deja react-native-web sin tocar.
import { Alert as AlertWeb, Platform as PlatformWeb, StatusBar as StatusBarWeb } from 'react-native-web';

export * from 'react-native-web';

const q = new URLSearchParams(globalThis.location?.search || '');
const comoAndroid = q.get('os') !== 'web';
const w = globalThis as any;
w.__alertas = w.__alertas || [];

export const Platform = comoAndroid
  ? {
      ...PlatformWeb,
      OS: 'android',
      Version: Number(q.get('api') || 35),
      select: (o: Record<string, unknown>) => ('android' in o ? o.android : 'native' in o ? o.native : o.default),
    }
  : PlatformWeb;

class StatusBarAndroid extends (StatusBarWeb as any) {
  static currentHeight = 24;
}
export const StatusBar = comoAndroid ? StatusBarAndroid : StatusBarWeb;

type Boton = { text?: string; onPress?: () => void; style?: string };
export const Alert = {
  ...AlertWeb,
  alert(titulo: string, mensaje?: string, botones?: Boton[]) {
    const a = { titulo, mensaje: mensaje || '', botones: (botones || [{ text: 'OK' }]).map((b) => b.text || 'OK') };
    w.__alertas.push(a);
    console.log(`[alerta] ${titulo} | ${mensaje || ''} | [${a.botones.join(', ')}]`);
    w.__tocarAlerta = (texto: string) => (botones || []).find((b) => b.text === texto)?.onPress?.();
  },
};

const oyentesAtras: Array<() => boolean> = [];
export const BackHandler = {
  addEventListener(_ev: string, f: () => boolean) {
    oyentesAtras.push(f);
    return { remove: () => void oyentesAtras.splice(oyentesAtras.indexOf(f) >>> 0, 1) };
  },
  exitApp() {
    console.log('[salida] BackHandler.exitApp()');
  },
};
w.__atras = () => {
  // Como Android: el último que se suscribió contesta primero.
  for (const f of [...oyentesAtras].reverse()) if (f()) return true;
  console.log('[atras] nadie lo manejó: la app se iría al fondo');
  return false;
};
