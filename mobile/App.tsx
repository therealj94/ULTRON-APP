import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as SystemUI from 'expo-system-ui';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Image,
  Pressable,
  BackHandler,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useCallback, useEffect, useRef, useState } from 'react';

const ULTRON_URL =
  (Constants.expoConfig?.extra as { ultronUrl?: string } | undefined)?.ultronUrl ||
  'https://ultron-looi-desk.onrender.com';

async function hideSystemBars() {
  try {
    await SystemUI.setBackgroundColorAsync('#000000');
  } catch {
    /* ignore */
  }
  if (Platform.OS !== 'android') return;
  try {
    // Lazy require so older clients without the native module don't crash
    const NavigationBar = require('expo-navigation-bar') as typeof import('expo-navigation-bar');
    await NavigationBar.setVisibilityAsync('hidden');
    await NavigationBar.setBehaviorAsync('overlay-swipe');
    await NavigationBar.setBackgroundColorAsync('#000000');
    await NavigationBar.setButtonStyleAsync('light');
  } catch {
    /* module missing until rebuild */
  }
}

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
  const [permsOk, setPermsOk] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const webRef = useRef<WebView>(null);
  const loadWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armWatchdog = useCallback(() => {
    if (loadWatchdog.current) clearTimeout(loadWatchdog.current);
    loadWatchdog.current = setTimeout(() => {
      setLoading((still) => {
        if (still) setWebError('El desk tarda en responder. Toca reintentar.');
        return still;
      });
    }, 45_000);
  }, []);

  useEffect(() => {
    void hideSystemBars();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    let mounted = true;
    (async () => {
      // No bloqueamos la WebView: pedimos permisos en paralelo
      const ok = await requestAndroidPermissions();
      if (mounted) setPermsOk(ok);
      await hideSystemBars();
      // OTA: si hay update publicada en el channel, aplicar en próximo cold start
      try {
        const Updates = require('expo-updates') as typeof import('expo-updates');
        if (!Updates.isEmbeddedLaunch && Updates.checkForUpdateAsync) {
          const check = await Updates.checkForUpdateAsync();
          if (check.isAvailable) {
            await Updates.fetchUpdateAsync();
            // No forzar reload inmediato en kiosko; queda para el próximo arranque
          }
        }
      } catch {
        /* updates opcional hasta rebuild con expo-updates */
      }
    })();
    armWatchdog();
    return () => {
      mounted = false;
      sub.remove();
      if (loadWatchdog.current) clearTimeout(loadWatchdog.current);
    };
  }, [armWatchdog]);

  const retry = () => {
    setWebError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
    armWatchdog();
    void hideSystemBars();
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden translucent backgroundColor="#000000" />
      <WebView
        key={reloadKey}
        ref={webRef}
        source={{ uri: ULTRON_URL }}
        style={styles.web}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
        onLoadStart={() => {
          setLoading(true);
          setWebError(null);
          armWatchdog();
        }}
        onLoadEnd={() => {
          setLoading(false);
          if (loadWatchdog.current) clearTimeout(loadWatchdog.current);
          void hideSystemBars();
        }}
        onError={(e) => {
          setLoading(false);
          setWebError(e.nativeEvent?.description || 'Error al cargar ULTRON');
        }}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500) {
            setWebError(`Servidor ${e.nativeEvent.statusCode}. Reintenta en unos segundos.`);
          }
        }}
        // Auto-grant getUserMedia when OS already approved (prop segura en RN WebView reciente)
        mediaCapturePermissionGrantType="grant"
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        overScrollMode="never"
        bounces={false}
        androidLayerType="hardware"
        userAgent={`ULTRON-FP-Android/${Constants.expoConfig?.version || '1.2'} WebView`}
        injectedJavaScriptBeforeContentLoaded={`
          (function(){
            try {
              window.__ULTRON_NATIVE__ = { permsOk: ${permsOk ? 'true' : 'false'}, platform: 'android', immersive: true };
              document.documentElement.style.background = '#000';
              document.body && (document.body.style.background = '#000');
            } catch(e) {}
          })();
          true;
        `}
      />
      {(loading || webError) && (
        <View style={styles.boot}>
          <Image source={require('./assets/icon.png')} style={styles.logo} />
          {!webError && <ActivityIndicator color="#00E5FF" size="large" />}
          <Text style={styles.bootText}>ULTRON FP</Text>
          <Text style={styles.bootSub}>
            {webError
              ? webError
              : permsOk
                ? 'Conectando desk…'
                : 'Concede cámara/mic si el sistema lo pide'}
          </Text>
          {webError && (
            <Pressable onPress={retry} style={styles.retryBtn}>
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000', opacity: 0.99 },
  boot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    gap: 10,
    paddingHorizontal: 24,
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
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.45)',
    backgroundColor: 'rgba(0,229,255,0.12)',
  },
  retryText: {
    color: '#00E5FF',
    fontSize: 14,
    letterSpacing: 1,
    fontWeight: '600',
  },
});
