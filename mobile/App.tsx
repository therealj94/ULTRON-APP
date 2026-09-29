import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { Asset } from 'expo-asset';
import { useCallback, useEffect, useRef, useState } from 'react';
import { iniciarReporte, miga } from './src/lib/reporte';
import { Animated, AppState, Easing, PermissionsAndroid, Platform, StyleSheet, View, type AppStateStatus } from 'react-native';
import { APP_VERSION, type SessionUser } from './src/config';
import { healthCheck, logoutRemote } from './src/lib/api';
import { borrarRastrosViejos, loadSession, loadSettings, saveSession } from './src/lib/storage';
import { modoActual, orientar } from './src/lib/orientacion';
import { preloadSfx } from './src/lib/sfx';
import { setAvatarVoz } from './src/lib/tts';
import { Arranque, type PasoArranque } from './src/screens/Arranque';
import { FOTOS_CLAUDIO } from './src/avatares/ClaudioRetrato';
import { FOTOS_CLAUDIO_PIE } from './src/avatares/ClaudioDePie';
import { DeskScreen } from './src/screens/DeskScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ES_ELECTRUM } from './src/variante';
import { T } from './src/tema';
import ElectrumApp from './src/electrum/ElectrumApp';

type Phase = 'splash' | 'login' | 'desk';

/** El splash nativo (logo) se queda hasta que el splash JS está montado: sin pantallazo blanco ni corte. */
void SplashScreen.preventAutoHideAsync().catch(() => {});
try {
  SplashScreen.setOptions({ duration: 350, fade: true });
} catch {
  /* versión sin setOptions */
}

/** Un solo diálogo nativo (cámara + micrófono) al entrar al escritorio. */
async function requestDeskPermissions() {
  if (Platform.OS !== 'android') return;
  try {
    await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]);
  } catch {
    /* DeskScreen vuelve a pedir con contexto */
  }
}

/** Fondo grafito del sistema y barra de navegación oculta (lo único que edge-to-edge permite ajustar). */
async function hideSystemBars() {
  try {
    await SystemUI.setBackgroundColorAsync(T.fondo);
  } catch {
    /* */
  }
  if (Platform.OS !== 'android') return;
  try {
    const NavigationBar = require('expo-navigation-bar') as typeof import('expo-navigation-bar');
    await NavigationBar.setVisibilityAsync('hidden');
  } catch {
    /* */
  }
}

/** Lo que carga el arranque, en orden. La barra avanza con esto, no con un reloj. */
const PASOS: PasoArranque[] = [
  { id: 'sesion', texto: 'Abriendo tu sesión', hecho: false },
  { id: 'avatares', texto: 'Despertando a AU-RA y a Claudio', hecho: false },
  { id: 'voces', texto: 'Afinando las voces', hecho: false },
  { id: 'servidor', texto: 'Conectando con el servidor', hecho: false },
];

/** Las fotos de los avatares se decodifican durante la carga: al entrar ya están, sin parpadeo. */
async function precargarAvatares() {
  const fotos = [
    ...Object.values(FOTOS_CLAUDIO).flatMap((v) => (Array.isArray(v) ? v : [v])),
    ...Object.values(FOTOS_CLAUDIO_PIE),
    require('./assets/marca/logo-aura.png'),
  ].filter((m): m is number => typeof m === 'number');
  await Asset.loadAsync(fotos);
}

/** Una promesa con tope: el arranque nunca se queda esperando algo que no contesta. */
function conTope<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/**
 * Un binario, dos aplicaciones.
 *
 * La bifurcación va arriba del todo y es total: la app del doctor no atraviesa nada del arranque de
 * AU-RA. Ese arranque bloquea en horizontal, pide cámara al entrar a la mesa y esconde las barras
 * del sistema — tres decisiones correctas para la mesa de la junta y equivocadas para una app que
 * se usa de pie en un cerro.
 *
 * Que sea una constante del manifiesto y no una prop permite que Metro y el motor descarten el
 * camino muerto, y sobre todo garantiza que AU-RA siga arrancando exactamente igual que antes:
 * con la variante por omisión, todo lo que sigue es el mismo código de siempre, sin una rama nueva.
 */
export default function App() {
  if (ES_ELECTRUM) return <ElectrumApp />;
  return <AppUltron />;
}

function AppUltron() {
  const [phase, setPhase] = useState<Phase>('splash');
  const [cargaVisible, setCargaVisible] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [pasos, setPasos] = useState<PasoArranque[]>(PASOS);
  const [aviso, setAviso] = useState('');
  const cargaOp = useRef(new Animated.Value(1)).current;
  const marcar = (id: string) => setPasos((ps) => ps.map((p) => (p.id === id ? { ...p, hecho: true } : p)));

  const enterDesk = useCallback(async (u: SessionUser) => {
    miga('login ok, entrando a la mesa');
    setUser(u);
    await requestDeskPermissions();
    miga('permisos pedidos');
    // La mesa decide su orientación según el avatar (bienvenida en la suya, después libre).
    setPhase('desk');
    miga('fase desk');
  }, []);

  const boot = useCallback(async () => {
    await iniciarReporte();
    // El nativo se quita cuando esta pantalla ya está pintada con el planeta en el mismo lugar.
    void SplashScreen.hideAsync().catch(() => {});
    await hideSystemBars();
    const [session, ajustes] = await Promise.all([loadSession(), loadSettings()]);
    miga(session ? 'sesión guardada' : 'sin sesión');
    setAvatarVoz(ajustes.avatar);
    marcar('sesion');
    await conTope(precargarAvatares(), 6_000);
    marcar('avatares');
    await conTope(preloadSfx(), 3_000);
    marcar('voces');
    // Sin servidor se entra igual (la mesa tiene modo local); solo se avisa.
    const salud = await conTope(healthCheck(), 5_000);
    if (!salud) setAviso('Sin conexión con el servidor: entras en modo local');
    marcar('servidor');
    await new Promise((r) => setTimeout(r, salud ? 250 : 900));
    if (session) await enterDesk(session);
    else {
      await orientar('libre');
      setPhase('login');
      miga('fase login');
    }
  }, [enterDesk]);

  // La pantalla siguiente ya está montada debajo: la carga se funde encima.
  useEffect(() => {
    if (phase === 'splash') return;
    Animated.timing(cargaOp, { toValue: 0, duration: 520, delay: 80, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setCargaVisible(false);
    });
  }, [phase, cargaOp]);

  useEffect(() => {
    void boot();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        void orientar(modoActual());
        void hideSystemBars();
      }
    });
    return () => sub.remove();
  }, [boot]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden />
      {phase === 'login' && <LoginScreen onAuthenticated={(u) => void enterDesk(u)} />}
      {phase === 'desk' && user && (
        <DeskScreen
          user={user}
          onLogout={() => {
            // El historial del turno vive en la mesa y se va con ella; la memoria de largo plazo es por
            // persona (el siguiente no la ve). Las credenciales guardadas se quedan: las usa la entrada.
            void saveSession(null);
            void logoutRemote();
            void borrarRastrosViejos();
            setUser(null);
            setPhase('login');
            void orientar('libre');
          }}
        />
      )}
      {cargaVisible && <Arranque pasos={pasos} version={APP_VERSION} aviso={aviso} opacity={phase === 'splash' ? undefined : cargaOp} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.fondo },
});
