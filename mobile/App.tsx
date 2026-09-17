import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { APP_VERSION, type SessionUser } from './src/config';
import { healthCheck } from './src/lib/api';
import { loadSession, saveSession } from './src/lib/storage';
import { ensureSpeechPermissions } from './src/lib/speech';
import { DeskScreen } from './src/screens/DeskScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

type Phase = 'boot' | 'login' | 'desk' | 'settings';

async function lockLandscape() {
  try {
    const ScreenOrientation = require('expo-screen-orientation') as typeof import('expo-screen-orientation');
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  } catch {
    /* */
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

async function requestOsPermissions() {
  if (Platform.OS !== 'android') return;
  try {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
  } catch {
    /* */
  }
  await ensureSpeechPermissions();
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootLine, setBootLine] = useState('Iniciando ULTRON nativo…');

  const boot = useCallback(async () => {
    setPhase('boot');
    setBootLine('Bloqueando landscape…');
    await lockLandscape();
    await hideSystemBars();
    setBootLine('Permisos de sensores…');
    await requestOsPermissions();
    setBootLine('Comprobando núcleo…');
    try {
      const h = await healthCheck();
      setBootLine(`Núcleo OK · ${h.status}`);
    } catch {
      setBootLine('Sin red — modo offline local');
    }
    const session = await loadSession();
    if (session) {
      setUser(session);
      setPhase('desk');
    } else {
      setPhase('login');
    }
  }, []);

  useEffect(() => {
    void boot();
    const onChange = (s: AppStateStatus) => {
      if (s === 'active') {
        void lockLandscape();
        void hideSystemBars();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    const t = setTimeout(() => {
      try {
        const Updates = require('expo-updates') as typeof import('expo-updates');
        if (Updates?.checkForUpdateAsync) {
          void Updates.checkForUpdateAsync()
            .then(async (check) => {
              if (check.isAvailable) await Updates.fetchUpdateAsync();
            })
            .catch(() => {});
        }
      } catch {
        /* */
      }
    }, 10_000);
    return () => {
      sub.remove();
      clearTimeout(t);
    };
  }, [boot]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden />
      {phase === 'boot' && (
        <View style={styles.boot}>
          <Image source={require('./assets/icon.png')} style={styles.logo} />
          <ActivityIndicator color="#00E5FF" size="large" />
          <Text style={styles.bootTitle}>ULTRON FP</Text>
          <Text style={styles.bootSub}>{bootLine}</Text>
          <Text style={styles.meta}>v{APP_VERSION} · native</Text>
        </View>
      )}
      {phase === 'login' && (
        <LoginScreen
          onAuthenticated={(u) => {
            setUser(u);
            setPhase('desk');
          }}
        />
      )}
      {phase === 'desk' && user && (
        <DeskScreen
          user={user}
          onOpenSettings={() => setPhase('settings')}
          onLogout={() => {
            void saveSession(null);
            setUser(null);
            setPhase('login');
          }}
        />
      )}
      {phase === 'settings' && <SettingsScreen onBack={() => setPhase('desk')} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#000',
  },
  logo: { width: 88, height: 88, borderRadius: 44, marginBottom: 8 },
  bootTitle: { color: '#E8FBFF', fontSize: 18, letterSpacing: 6, fontWeight: '800' },
  bootSub: { color: '#8B9AAB', fontSize: 13, textAlign: 'center', maxWidth: 360 },
  meta: {
    color: '#5A6A7A',
    fontSize: 11,
    marginTop: 4,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
});
