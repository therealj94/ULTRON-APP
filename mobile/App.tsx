import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { iniciarReporte, miga } from './src/lib/reporte';
import { Animated, AppState, Easing, PermissionsAndroid, Platform, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { APP_VERSION, type SessionUser } from './src/config';
import { logoutRemote } from './src/lib/api';
import { loadSession, saveSession } from './src/lib/storage';
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
 * Splash JS de AU-RA: el logo sobre grafito y tres puntos dorados que respiran mientras se carga la
 * sesión. Se funde encima de la pantalla siguiente (la sala, donde ella ya viene entrando).
 */
function JsSplash({ opacity }: { opacity: Animated.Value }) {
  const rise = useRef(new Animated.Value(0)).current;
  const puntos = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // el nativo se oculta cuando este ya está pintado: la transición la hace el fade nativo
    void SplashScreen.hideAsync().catch(() => {});
    Animated.timing(rise, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const ola = Animated.loop(
      Animated.stagger(
        150,
        puntos.map((v) =>
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(v, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ])
        )
      )
    );
    ola.start();
    return () => ola.stop();
  }, [rise, puntos]);

  const ty = rise.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return (
    <Animated.View pointerEvents="none" style={[styles.splash, { opacity }]}>
      <Animated.Image
        source={require('./assets/marca/logo-aura.png')}
        resizeMode="contain"
        accessibilityLabel="AU-RA by Orden Global"
        style={[styles.logo, { opacity: rise, transform: [{ translateY: ty }] }]}
      />
      <View style={styles.puntos}>
        {puntos.map((v, i) => (
          <Animated.View key={i} style={[styles.punto, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] }]} />
        ))}
      </View>
      <Text style={styles.meta}>v{APP_VERSION}</Text>
    </Animated.View>
  );
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
  root: { flex: 1, backgroundColor: T.fondo },
  splash: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 18, backgroundColor: T.fondo },
  logo: { width: 340, height: 128 },
  puntos: { flexDirection: 'row', gap: 8, height: 20, alignItems: 'flex-end' },
  punto: { width: 10, height: 10, borderRadius: 5, backgroundColor: T.principal },
  meta: { position: 'absolute', bottom: 24, color: T.texto3, fontSize: 11 },
});
