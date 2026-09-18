import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, PermissionsAndroid, Platform, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { APP_VERSION, type SessionUser } from './src/config';
import { UltronFace } from './src/components/UltronFace';
import { logoutRemote } from './src/lib/api';
import { loadSession, saveSession } from './src/lib/storage';
import { DeskScreen } from './src/screens/DeskScreen';
import { LoginScreen } from './src/screens/LoginScreen';

type Phase = 'boot' | 'login' | 'desk';

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
    await NavigationBar.setBehaviorAsync('overlay-swipe');
    await NavigationBar.setBackgroundColorAsync('#000000');
    await NavigationBar.setButtonStyleAsync('light');
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

function checkOta() {
  try {
    const Updates = require('expo-updates') as typeof import('expo-updates');
    if (!Updates?.checkForUpdateAsync) return;
    void Updates.checkForUpdateAsync()
      .then(async (check) => {
        if (!check.isAvailable) return;
        const result = await Updates.fetchUpdateAsync();
        if (result.isNew) await Updates.reloadAsync();
      })
      .catch(() => {});
  } catch {
    /* build sin expo-updates */
  }
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [user, setUser] = useState<SessionUser | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const fade = useRef(new Animated.Value(0)).current;

  const enterDesk = useCallback(async (u: SessionUser) => {
    setUser(u);
    await requestDeskPermissions();
    await lockOrientation('landscape');
    setPhase('desk');
  }, []);

  const boot = useCallback(async () => {
    setPhase('boot');
    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    await lockOrientation('portrait');
    await hideSystemBars();
    const [session] = await Promise.all([loadSession(), new Promise((r) => setTimeout(r, 900))]);
    if (session) await enterDesk(session);
    else setPhase('login');
  }, [enterDesk, fade]);

  useEffect(() => {
    void boot();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        void lockOrientation(phaseRef.current === 'desk' ? 'landscape' : 'portrait');
        void hideSystemBars();
      }
    });
    const t = setTimeout(checkOta, 5_000);
    return () => {
      sub.remove();
      clearTimeout(t);
    };
  }, [boot]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden />
      {phase === 'boot' && (
        <Animated.View style={[styles.boot, { opacity: fade }]}>
          <View pointerEvents="none">
            <UltronFace face="SLEEPING" size={96} stageHeight={220} />
          </View>
          <Text style={styles.bootTitle}>ULTRON FP</Text>
          <Text style={styles.meta}>v{APP_VERSION}</Text>
        </Animated.View>
      )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#000' },
  bootTitle: { color: '#E8FBFF', fontSize: 18, letterSpacing: 8, fontWeight: '800', marginTop: 8 },
  meta: { color: '#3A4A5A', fontSize: 11, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier' },
});
