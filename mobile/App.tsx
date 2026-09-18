import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, StatusBar as RNStatusBar } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

const DESK = 'https://ultron-looi-desk.onrender.com';

export default function App() {
  const ref = useRef<WebView>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [load, setLoad] = useState(true);
  return (
    <View style={st.root}>
      <StatusBar style="light" hidden />
      <RNStatusBar hidden />
      {fail ? (
        <View style={st.err}>
          <Text style={st.errT}>Mesa offline</Text>
          <Text style={st.errD}>{fail}</Text>
          <Pressable style={st.btn} onPress={() => { setFail(null); setLoad(true); ref.current?.reload(); }}>
            <Text style={st.btnT}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          ref={ref}
          source={{ uri: DESK }}
          style={st.web}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          startInLoadingState
          mixedContentMode="always"
          originWhitelist={['*']}
          setSupportMultipleWindows={false}
          androidLayerType={Platform.OS === 'android' ? 'hardware' : undefined}
          onLoadEnd={() => setLoad(false)}
          onError={(e) => setFail(e.nativeEvent.description || 'red')}
          onPermissionRequest={(req: any) => {
            try { req.grant?.(req.nativeEvent?.resources || req.resources); } catch {}
          }}
        />
      )}
      {load && !fail ? (
        <View style={st.boot} pointerEvents="none">
          <ActivityIndicator color="#05E1FF" />
        </View>
      ) : null}
    </View>
  );
}
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  web: { flex: 1, backgroundColor: '#000' },
  boot: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  err: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errT: { color: '#fff', fontSize: 18, marginBottom: 8 },
  errD: { color: '#888', marginBottom: 16, textAlign: 'center' },
  btn: { backgroundColor: '#05E1FF', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  btnT: { color: '#000', fontWeight: '800' },
});
