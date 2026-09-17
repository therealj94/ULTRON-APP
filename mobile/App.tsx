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
  ScrollView,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useCallback, useEffect, useRef, useState } from 'react';

const ULTRON_URL =
  (Constants.expoConfig?.extra as { ultronUrl?: string } | undefined)?.ultronUrl ||
  'https://ultron-looi-desk.onrender.com';

const APP_VERSION = Constants.expoConfig?.version || '1.3.0';
const MAX_AUTO_RETRIES = 3;

type Phase = 'boot' | 'perms' | 'preflight' | 'web' | 'ready' | 'error';

type Diag = {
  at: string;
  phase: string;
  code: string;
  detail: string;
};

async function lockLandscape() {
  if (Platform.OS !== 'android') return;
  try {
    const ScreenOrientation = require('expo-screen-orientation') as typeof import('expo-screen-orientation');
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  } catch {
    /* optional until native rebuild includes the module */
  }
}

async function hideSystemBars() {
  try {
    await SystemUI.setBackgroundColorAsync('#000000');
  } catch {
    /* ignore */
  }
  if (Platform.OS !== 'android') return;
  try {
    const NavigationBar = require('expo-navigation-bar') as typeof import('expo-navigation-bar');
    await NavigationBar.setVisibilityAsync('hidden');
    await NavigationBar.setBehaviorAsync('overlay-swipe');
    await NavigationBar.setBackgroundColorAsync('#000000');
    await NavigationBar.setButtonStyleAsync('light');
  } catch {
    /* optional until native rebuild */
  }
}

function nowIso() {
  return new Date().toISOString();
}

/** Permisos ANTES de montar WebView — evita crash Chromium al pedir cámara en paralelo. */
async function requestAndroidPermissions(): Promise<{ ok: boolean; detail: string }> {
  if (Platform.OS !== 'android') return { ok: true, detail: 'ios/skip' };
  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    const cam = result[PermissionsAndroid.PERMISSIONS.CAMERA];
    const mic = result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    const ok =
      cam === PermissionsAndroid.RESULTS.GRANTED &&
      mic === PermissionsAndroid.RESULTS.GRANTED;
    return {
      ok,
      detail: `cam=${cam || '?'} mic=${mic || '?'}`,
    };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e) };
  }
}

async function preflightDesk(url: string): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = Date.now();
  const healthUrl = url.replace(/\/+$/, '') + '/api/health';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    const res = await fetch(healthUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} en /api/health`, ms };
    return { ok: true, detail: `health ${res.status}`, ms };
  } catch (e: any) {
    const ms = Date.now() - t0;
    const name = e?.name === 'AbortError' ? 'timeout 25s' : String(e?.message || e);
    return { ok: false, detail: `preflight: ${name}`, ms };
  }
}

/**
 * Solo reporta ready cuando existe #ultron-app-root con contenido real.
 * NUNCA usar document.title / #root / body — eso causaba pantalla negra
 * (overlay se quitaba antes de que React pintara el desk).
 */
const BOOTSTRAP_JS = `
(function(){
  try {
    window.__ULTRON_NATIVE__ = { platform: 'android', immersive: true, landscape: true, v: '${APP_VERSION}' };
    document.documentElement.style.background = '#000';
    if (document.body) document.body.style.background = '#000';
    var sentReady = false;
    function ping(type, extra) {
      try {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
          JSON.stringify(Object.assign({ type: type, t: Date.now() }, extra || {}))
        );
      } catch (e) {}
    }
    window.addEventListener('error', function (ev) {
      ping('js_error', { msg: String(ev.message || 'error'), src: String(ev.filename || ''), line: ev.lineno || 0 });
    });
    window.addEventListener('unhandledrejection', function (ev) {
      ping('js_reject', { msg: String((ev.reason && ev.reason.message) || ev.reason || 'reject') });
    });
    function deskRootReady() {
      var el = document.getElementById('ultron-app-root');
      if (!el) return false;
      if (el.children && el.children.length > 0) return true;
      if ((el.textContent || '').trim().length > 0) return true;
      return false;
    }
    function checkReady() {
      if (sentReady) return true;
      if (!deskRootReady()) return false;
      sentReady = true;
      ping('ready', { title: document.title || '', hasRoot: true, source: 'dom' });
      return true;
    }
    var mo = null;
    try {
      mo = new MutationObserver(function () { checkReady(); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    var iv = setInterval(function () {
      if (checkReady()) {
        clearInterval(iv);
        if (mo) try { mo.disconnect(); } catch (e) {}
      }
    }, 250);
    setTimeout(function () {
      clearInterval(iv);
      if (mo) try { mo.disconnect(); } catch (e) {}
      if (!sentReady) ping('slow', { state: document.readyState, hasRoot: !!document.getElementById('ultron-app-root') });
    }, 12000);
    setTimeout(function () {
      if (!sentReady) {
        ping('blank_suspect', {
          state: document.readyState,
          hasRoot: !!document.getElementById('ultron-app-root'),
          html: (document.body && document.body.innerText || '').slice(0, 120)
        });
      }
    }, 28000);
    ping('dom', { state: document.readyState });
  } catch (e) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'boot_js_fail', msg: String(e) })); } catch (_) {}
  }
  true;
})();
`;

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [statusLine, setStatusLine] = useState('Iniciando…');
  const [permsOk, setPermsOk] = useState(false);
  const [webMounted, setWebMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [webError, setWebError] = useState<string | null>(null);
  const [diag, setDiag] = useState<Diag[]>([]);
  const [showDiag, setShowDiag] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [autoRetries, setAutoRetries] = useState(0);
  const webRef = useRef<WebView>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyRef = useRef(false);
  const startingRef = useRef(false);

  const pushDiag = useCallback((code: string, detail: string, phaseName?: string) => {
    setDiag((prev) =>
      [{ at: nowIso(), phase: phaseName || phase, code, detail: detail.slice(0, 280) }, ...prev].slice(0, 12)
    );
  }, [phase]);

  const clearWatchdog = () => {
    if (watchdog.current) {
      clearTimeout(watchdog.current);
      watchdog.current = null;
    }
  };

  const armWatchdog = useCallback(
    (ms = 35_000, label = 'WebView sin respuesta') => {
      clearWatchdog();
      watchdog.current = setTimeout(() => {
        if (readyRef.current) return;
        const msg = `${label}. Toca Reintentar.`;
        setWebError(msg);
        setPhase('error');
        setLoading(false);
        pushDiag('WATCHDOG', msg);
        setShowDiag(true);
      }, ms);
    },
    [pushDiag]
  );

  const markReady = useCallback(
    (source: string, title?: string) => {
      if (readyRef.current) return;
      readyRef.current = true;
      clearWatchdog();
      setLoading(false);
      setWebError(null);
      setPhase('ready');
      setAutoRetries(0);
      pushDiag('READY', `src=${source} title=${title || ''}`);
      void hideSystemBars();
    },
    [pushDiag]
  );

  const startSequence = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    readyRef.current = false;
    setWebMounted(false);
    setWebError(null);
    setLoading(true);
    setShowDiag(false);
    setPhase('boot');
    setStatusLine('Preparando ULTRON…');
    await lockLandscape();
    await hideSystemBars();

    setPhase('perms');
    setStatusLine('Permisos de cámara y micrófono…');
    const perms = await requestAndroidPermissions();
    setPermsOk(perms.ok);
    pushDiag('PERMS', perms.detail, 'perms');
    if (!perms.ok) {
      setStatusLine('Sin cámara/mic — puedes continuar; visión/voz limitadas.');
    }

    setPhase('preflight');
    setStatusLine('Comprobando servidor…');
    const pf = await preflightDesk(ULTRON_URL);
    pushDiag(pf.ok ? 'HEALTH_OK' : 'HEALTH_WARN', `${pf.detail} (${pf.ms}ms)`, 'preflight');
    if (!pf.ok) {
      setStatusLine('Servidor despertando… cargando igual.');
    }

    setPhase('web');
    setStatusLine(pf.ok ? 'Cargando escritorio…' : 'Cargando (servidor lento)…');
    setWebMounted(true);
    armWatchdog(pf.ok ? 45_000 : 75_000, 'La página no terminó de cargar');
    startingRef.current = false;
  }, [armWatchdog, pushDiag]);

  useEffect(() => {
    void startSequence();
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
        /* no updates module */
      }
    }, 8_000);
    return () => {
      clearTimeout(t);
      clearWatchdog();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'active') {
        void lockLandscape();
        void hideSystemBars();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  const hardReload = useCallback(
    (reason: string) => {
      pushDiag('RELOAD', reason);
      readyRef.current = false;
      setAutoRetries(0);
      setReloadKey((k) => k + 1);
      void startSequence();
    },
    [pushDiag, startSequence]
  );

  const softReloadWeb = useCallback(
    (reason: string) => {
      pushDiag('SOFT_RELOAD', reason);
      readyRef.current = false;
      setLoading(true);
      setWebError(null);
      setPhase('web');
      setStatusLine('Reintentando WebView…');
      setReloadKey((k) => k + 1);
      setWebMounted(true);
      armWatchdog(45_000, 'Reintento falló');
    },
    [armWatchdog, pushDiag]
  );

  const onRenderProcessGone = useCallback(
    (e: any) => {
      const didCrash = Boolean(e?.nativeEvent?.didCrash);
      const msg = didCrash
        ? 'WebView crasheó (proceso Chromium). Suele pasar tras permisos o falta de memoria.'
        : 'WebView se detuvo. Reintentando…';
      pushDiag('RENDER_GONE', `didCrash=${didCrash}`);
      setLoading(false);
      setPhase('error');
      setWebError(msg);
      setShowDiag(true);
      setWebMounted(false);
      if (autoRetries < MAX_AUTO_RETRIES) {
        setAutoRetries((n) => n + 1);
        setTimeout(() => softReloadWeb(`auto after render-gone #${autoRetries + 1}`), 900);
      }
    },
    [autoRetries, pushDiag, softReloadWeb]
  );

  const onWebMessage = useCallback(
    (ev: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(ev.nativeEvent.data);
        if (data.type === 'ready') {
          // Crítico: ignorar ready falso (sin #ultron-app-root)
          if (data.hasRoot !== true) {
            pushDiag('READY_IGNORED', `title=${data.title || ''} hasRoot=${data.hasRoot}`);
            return;
          }
          markReady(String(data.source || 'unknown'), data.title);
        } else if (data.type === 'js_error' || data.type === 'js_reject' || data.type === 'boot_js_fail') {
          pushDiag(String(data.type).toUpperCase(), data.msg || JSON.stringify(data));
        } else if (data.type === 'blank_suspect') {
          pushDiag('BLANK', `root=${data.hasRoot} ${(data.html || data.state || 'blank')}`);
          if (!readyRef.current) {
            setWebError('La página cargó vacía (pantalla negra). Reintenta.');
            setPhase('error');
            setLoading(false);
            setShowDiag(true);
          }
        } else if (data.type === 'slow') {
          pushDiag('SLOW', `root=${data.hasRoot} ${data.state || 'slow'}`);
          setStatusLine('Casi listo… el desk responde lento');
        } else if (data.type === 'dom') {
          pushDiag('DOM', data.state || 'dom');
        }
      } catch {
        /* ignore non-json */
      }
    },
    [markReady, pushDiag]
  );

  const overlayVisible = phase !== 'ready' || !!webError;

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden />

      {webMounted && (
        <WebView
          key={reloadKey}
          ref={webRef}
          source={{ uri: ULTRON_URL }}
          style={styles.web}
          // hardware: software layer deja pantalla negra en muchos Android WebView
          androidLayerType="hardware"
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          overScrollMode="never"
          cacheEnabled={false}
          startInLoadingState={false}
          allowsFullscreenVideo
          nestedScrollEnabled
          originWhitelist={['https://*', 'http://*']}
          applicationNameForUserAgent={`ULTRON-FP/${APP_VERSION}`}
          onLoadStart={() => {
            setLoading(true);
            setStatusLine('Descargando escritorio…');
            armWatchdog(55_000, 'onLoadStart sin fin');
          }}
          onLoadEnd={() => {
            setStatusLine('Escritorio recibido… esperando UI nativa');
            // Overlay permanece hasta ping ready con hasRoot
            armWatchdog(35_000, 'UI del desk no montó (#ultron-app-root)');
          }}
          onError={(e) => {
            const d = e.nativeEvent?.description || 'Error de red WebView';
            pushDiag('WV_ERROR', d);
            setWebError(d);
            setPhase('error');
            setLoading(false);
            setShowDiag(true);
            clearWatchdog();
          }}
          onHttpError={(e) => {
            const code = e.nativeEvent?.statusCode;
            if (code && code >= 400) {
              pushDiag('HTTP', `status ${code}`);
              if (code >= 500) {
                setWebError(`Servidor ${code}. Render puede estar despertando — reintenta.`);
                setPhase('error');
                setLoading(false);
                setShowDiag(true);
              }
            }
          }}
          onRenderProcessGone={onRenderProcessGone}
          onContentProcessDidTerminate={onRenderProcessGone}
          onMessage={onWebMessage}
          injectedJavaScript={BOOTSTRAP_JS}
          injectedJavaScriptBeforeContentLoaded={`
            (function(){
              try {
                document.documentElement.style.background='#000';
                if (document.body) document.body.style.background='#000';
                window.__ULTRON_NATIVE__={permsOk:${permsOk ? 'true' : 'false'},platform:'android',landscape:true,immersive:true,v:'${APP_VERSION}'};
              } catch(e) {}
              true;
            })();
          `}
        />
      )}

      {overlayVisible && (
        <View style={styles.boot} pointerEvents="auto">
          <Image source={require('./assets/icon.png')} style={styles.logo} />
          {phase !== 'error' && !webError && <ActivityIndicator color="#00E5FF" size="large" />}
          <Text style={styles.bootText}>ULTRON FP</Text>
          <Text style={styles.bootSub}>{webError || statusLine}</Text>
          <Text style={styles.meta}>
            v{APP_VERSION} · {phase}
            {autoRetries > 0 ? ` · auto ${autoRetries}/${MAX_AUTO_RETRIES}` : ''}
          </Text>

          {(phase === 'error' || webError) && (
            <View style={styles.actions}>
              <Pressable onPress={() => hardReload('user retry')} style={styles.retryBtn}>
                <Text style={styles.retryText}>Reintentar</Text>
              </Pressable>
              <Pressable onPress={() => setShowDiag((v) => !v)} style={styles.diagBtn}>
                <Text style={styles.diagBtnText}>{showDiag ? 'Ocultar errores' : 'Ver diagnóstico'}</Text>
              </Pressable>
            </View>
          )}

          {phase !== 'error' && !webError && (
            <Pressable onPress={() => setShowDiag((v) => !v)} style={styles.diagLink}>
              <Text style={styles.diagLinkText}>Diagnóstico</Text>
            </Pressable>
          )}

          {showDiag && (
            <ScrollView style={styles.diagBox} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
              <Text style={styles.diagTitle}>Últimos eventos</Text>
              <Text style={styles.diagLine}>URL: {ULTRON_URL}</Text>
              {diag.length === 0 && <Text style={styles.diagLine}>Sin eventos aún.</Text>}
              {diag.map((d, i) => (
                <Text key={`${d.at}-${i}`} style={styles.diagLine}>
                  [{d.code}] {d.detail}
                </Text>
              ))}
            </ScrollView>
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
    gap: 8,
    paddingHorizontal: 20,
    zIndex: 10,
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
    fontSize: 13,
    letterSpacing: 0.5,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 420,
  },
  meta: {
    color: '#5A6A7A',
    fontSize: 11,
    marginTop: 4,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  retryBtn: {
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
  diagBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  diagBtnText: {
    color: '#C8D4DE',
    fontSize: 13,
  },
  diagLink: { marginTop: 16, padding: 8 },
  diagLinkText: { color: '#5A6A7A', fontSize: 12, textDecorationLine: 'underline' },
  diagBox: {
    marginTop: 12,
    maxHeight: 160,
    width: '100%',
    maxWidth: 480,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.2)',
    backgroundColor: 'rgba(10,14,20,0.95)',
    padding: 10,
  },
  diagTitle: {
    color: '#00E5FF',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 4,
    fontWeight: '700',
  },
  diagLine: {
    color: '#9AA8B5',
    fontSize: 10,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
});
