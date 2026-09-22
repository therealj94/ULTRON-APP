import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { iniciarReporte, miga } from './src/lib/reporte';
import { Animated, AppState, Easing, PermissionsAndroid, Platform, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { APP_VERSION, type FaceState, type SessionUser } from './src/config';
import { UltronFace } from './src/components/UltronFace';
import { logoutRemote } from './src/lib/api';
import { loadSession, saveSession } from './src/lib/storage';
import { DeskScreen } from './src/screens/DeskScreen';
import { LoginScreen } from './src/screens/LoginScreen';

type Phase = 'splash' | 'login' | 'desk';

/** El splash nativo (logo) se queda hasta que el splash JS está montado: sin pantallazo blanco ni corte. */
void SplashScreen.preventAutoHideAsync().catch(() => {});
try {
  SplashScreen.setOptions({ duration: 350, fade: true });
} catch {
  /* versión sin setOptions */
}

const SPLASH_MS = 1800;

/**
 * Login en vertical, escritorio en horizontal. El manifest arranca en landscape (la mesa es lo
 * principal); aquí forzamos el giro y, si el sistema tarda, reintentamos hasta que reporte el
 * lock correcto (algunos Android ignoran el primer lockAsync justo tras el arranque).
 */
async function lockOrientation(kind: 'portrait' | 'landscape') {
  const want = kind === 'portrait' ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE;
  for (let i = 0; i < 3; i += 1) {
    try {
      await ScreenOrientation.lockAsync(want);
      const cur = await ScreenOrientation.getOrientationLockAsync();
      if (cur === want || (kind === 'landscape' && (cur === ScreenOrientation.OrientationLock.LANDSCAPE_LEFT || cur === ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT))) return;
    } catch {
      /* reintento */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Fondo negro del sistema y barra de navegación oculta (lo único que edge-to-edge permite ajustar). */
async function hideSystemBars() {
  try {
    await SystemUI.setBackgroundColorAsync('#000000');
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

/** Un solo diálogo nativo (cámara + micrófono) al entrar al escritorio. */
async function requestDeskPermissions() {
  if (Platform.OS !== 'android') return;
  try {
    await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]);
  } catch {
    /* DeskScreen vuelve a pedir con contexto */
  }
}

/**
 * Splash JS: marca «AU-RA FP», «powered by ORDEN GLOBAL» y la cara compacta despertando
 * (ojos cerrados → abiertos) mientras se carga la sesión. Se desvanece encima de la pantalla siguiente.
 */
function JsSplash({ opacity }: { opacity: Animated.Value }) {
  const [face, setFace] = useState<FaceState>('SLEEPING');
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // el nativo se oculta cuando este ya está pintado: la transición la hace el fade nativo
    void SplashScreen.hideAsync().catch(() => {});
    Animated.timing(rise, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const t1 = setTimeout(() => setFace('IDLE'), 520);
    const t2 = setTimeout(() => setFace('HAPPY'), 1350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [rise]);

  const ty = rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return (
    <Animated.View pointerEvents="none" style={[styles.splash, { opacity }]}>
      <View style={styles.splashFace}>
        <UltronFace face={face} size={92} stageHeight={210} />
      </View>
      <Animated.View style={{ alignItems: 'center', opacity: rise, transform: [{ translateY: ty }] }}>
        <Text style={styles.wordmark}>AU-RA FP</Text>
        <Text style={styles.powered}>POWERED BY ORDEN GLOBAL</Text>
      </Animated.View>
      <Text style={styles.meta}>v{APP_VERSION}</Text>
    </Animated.View>
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('splash');
  const [splashShown, setSplashShown] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const splashOp = useRef(new Animated.Value(1)).current;

  const enterDesk = useCallback(async (u: SessionUser) => {
    miga('login ok, entrando a la mesa');
    setUser(u);
    await requestDeskPermissions();
    miga('permisos pedidos');
    await lockOrientation('landscape');
    miga('orientación horizontal');
    setPhase('desk');
    miga('fase desk');
  }, []);

  const boot = useCallback(async () => {
    await iniciarReporte();
    const minSplash = new Promise((r) => setTimeout(r, SPLASH_MS));
    await hideSystemBars();
    miga('barras ocultas');
    // Con sesión guardada la mesa arranca ya en horizontal (manifest); solo el login gira a vertical.
    const session = await loadSession();
    miga(session ? 'sesión guardada' : 'sin sesión');
    if (!session) await lockOrientation('portrait');
    await minSplash;
    if (session) await enterDesk(session);
    else {
      setPhase('login');
      miga('fase login');
    }
  }, [enterDesk]);

  // La pantalla siguiente ya está montada debajo: el splash se funde con suavidad.
  useEffect(() => {
    if (phase === 'splash') return;
    Animated.timing(splashOp, { toValue: 0, duration: 700, delay: 120, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setSplashShown(false);
    });
  }, [phase, splashOp]);

  useEffect(() => {
    void boot();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        void lockOrientation(phaseRef.current === 'desk' ? 'landscape' : 'portrait');
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
            void saveSession(null);
            void logoutRemote();
            setUser(null);
            setPhase('login');
            void lockOrientation('portrait');
          }}
        />
      )}
      {splashShown && <JsSplash opacity={splashOp} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  splash: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#000' },
  splashFace: { width: 320, alignItems: 'center' },
  wordmark: { color: '#E8FBFF', fontSize: 26, letterSpacing: 6, fontWeight: '700', marginTop: -6 },
  powered: { color: 'rgba(5,225,255,0.6)', fontSize: 10, letterSpacing: 2.5, fontWeight: '600', marginTop: 8 },
  meta: { position: 'absolute', bottom: 24, color: '#3A4A5A', fontSize: 11, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier' },
});
