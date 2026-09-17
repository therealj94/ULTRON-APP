import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Image,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useEffect, useRef, useState } from 'react';

const ULTRON_URL =
  (Constants.expoConfig?.extra as { ultronUrl?: string } | undefined)?.ultronUrl ||
  'https://ultron-looi-desk.onrender.com';

async function requestAndroidPermissions() {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    const cam = result[PermissionsAndroid.PERMISSIONS.CAMERA];
    const mic = result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    return (
      cam === PermissionsAndroid.RESULTS.GRANTED &&
      mic === PermissionsAndroid.RESULTS.GRANTED
    );
  } catch {
    return false;
  }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [permsOk, setPermsOk] = useState(false);
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const ok = await requestAndroidPermissions();
      if (mounted) {
        setPermsOk(ok);
        setReady(true);
      }
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
          <Image source={require('./assets/icon.png')} style={styles.logo} />
          <ActivityIndicator color="#00E5FF" size="large" />
          <Text style={styles.bootText}>ULTRON FP</Text>
          <Text style={styles.bootSub}>Preparando cámara y micrófono…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden />
      <WebView
        ref={webRef}
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
        allowsProtectedMedia
        // @ts-expect-error RN WebView Android media permission hook
        onPermissionRequest={(e: any) => {
          // Auto-grant camera/mic inside WebView when OS already approved
          try {
            e?.nativeEvent?.request?.grant?.(e.nativeEvent.resources);
          } catch {
            /* older RN WebView */
          }
        }}
        userAgent={`ULTRON-FP-Android/${Constants.expoConfig?.version || '1.1'} WebView`}
        injectedJavaScriptBeforeContentLoaded={`
          (function(){
            try {
              window.__ULTRON_NATIVE__ = { permsOk: ${permsOk ? 'true' : 'false'}, platform: 'android' };
            } catch(e) {}
          })();
          true;
        `}
      />
      {loading && (
        <View style={styles.boot}>
          <Image source={require('./assets/icon.png')} style={styles.logo} />
          <ActivityIndicator color="#00E5FF" size="large" />
          <Text style={styles.bootText}>ULTRON FP</Text>
          <Text style={styles.bootSub}>
            {permsOk ? 'Conectando desk…' : 'Concede cámara/mic y reabre la app'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
  boot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    gap: 10,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: 8,
  },
  bootText: {
    color: '#E8FBFF',
    fontSize: 18,
    letterSpacing: 6,
    fontWeight: '700',
  },
  bootSub: {
    color: '#8B9AAB',
    fontSize: 12,
    letterSpacing: 1,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
