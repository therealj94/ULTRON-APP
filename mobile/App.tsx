import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { useState } from 'react';

const ULTRON_URL =
  (Constants.expoConfig?.extra as { ultronUrl?: string } | undefined)?.ultronUrl ||
  'https://ultron-looi-desk.onrender.com';

export default function App() {
  const [loading, setLoading] = useState(true);

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
        // Cámara / mic para visión y voz
        mediaCapturePermissionGrantType="grant"
        allowsFullscreenVideo
      />
      {loading && (
        <View style={styles.boot}>
          <ActivityIndicator color="#3EC9D6" size="large" />
          <Text style={styles.bootText}>ULTRON FP</Text>
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
    gap: 12,
  },
  bootText: {
    color: '#E8EEF4',
    fontSize: 18,
    letterSpacing: 6,
    fontWeight: '700',
  },
});
