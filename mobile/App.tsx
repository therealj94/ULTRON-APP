import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useEffect, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';

const ULTRON_URL =
  (Constants.expoConfig?.extra as { ultronUrl?: string } | undefined)?.ultronUrl ||
  'https://ultron-looi-desk.onrender.com';

async function requestAndroidPermissions() {
  if (Platform.OS !== 'android') return;
  try {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
  } catch {
    // La WebView pedirá de nuevo al usar mic/cámara
  }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await ScreenOrientation.unlockAsync();
        // Preferimos landscape pero permitimos girar (OrientationGate en web guía)
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } catch {
        // Emuladores / tablets pueden fallar el lock
      }
      await requestAndroidPermissions();
      if (mounted) setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" hidden />
        <View style={styles.boot}>
          <ActivityIndicator color="#3EC9D6" size="large" />
          <Text style={styles.bootText}>ULTRON FP</Text>
          <Text style={styles.bootSub}>Preparando permisos…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden />
      <WebView
        source={{ uri: ULTRON_URL }}
        style={styles.web}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        onLoadEnd={() => setLoading(false)}
        mediaCapturePermissionGrantType="grant"
        allowsFullscreenVideo
        mixedContentMode="always"
        geolocationEnabled={false}
        setSupportMultipleWindows={false}
        // No forzar cámara: el sitio decide (visionEnabled=false al abrir)
        userAgent={`ULTRON-FP-Android/${Constants.expoConfig?.version || '1.0'} WebView`}
      />
      {loading && (
        <View style={styles.boot}>
          <ActivityIndicator color="#3EC9D6" size="large" />
          <Text style={styles.bootText}>ULTRON FP</Text>
          <Text style={styles.bootSub}>Conectando desk…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07090c' },
  web: { flex: 1, backgroundColor: '#07090c' },
  boot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#07090c',
    gap: 10,
  },
  bootText: {
    color: '#E8EEF4',
    fontSize: 18,
    letterSpacing: 6,
    fontWeight: '700',
  },
  bootSub: {
    color: '#8B9AAB',
    fontSize: 12,
    letterSpacing: 1,
  },
});
