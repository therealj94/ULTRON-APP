import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Switch, ScrollView } from 'react-native';
import { API_BASE, APP_VERSION } from '../config';
import { healthCheck } from '../lib/api';
import { loadLocalMemory, loadSettings, saveSettings, type AppSettings } from '../lib/storage';
import { MODE_HINTS } from '../lib/knowledge';

type Props = {
  onBack: () => void;
};

export function SettingsScreen({ onBack }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [health, setHealth] = useState('…');
  const [memoryCount, setMemoryCount] = useState(0);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void loadLocalMemory().then((m) => setMemoryCount(m.reduce((n, p) => n + p.hechos.length, 0)));
    void healthCheck()
      .then((h) => setHealth(`OK · TTS ${h.tts?.urlHost || 'n/d'}`))
      .catch((e) => setHealth(`Offline: ${e.message || e}`));
  }, []);

  const patch = async (p: Partial<AppSettings>) => {
    await saveSettings(p);
    setSettings(await loadSettings());
  };

  if (!settings) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Cargando…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← Escritorio</Text>
      </Pressable>
      <Text style={styles.title}>Ajustes</Text>
      <Text style={styles.sub}>
        v{APP_VERSION} · {API_BASE}
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Servidor</Text>
        <Text style={styles.value}>{health}</Text>
        <Text style={styles.value}>Memoria local: {memoryCount} hechos</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Visión / mirada</Text>
          <Switch
            value={settings.visionEnabled}
            onValueChange={(v) => void patch({ visionEnabled: v, gazeEnabled: v })}
            trackColor={{ true: '#00E5FF' }}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Mic silenciado al abrir</Text>
          <Switch
            value={settings.micMuted}
            onValueChange={(v) => void patch({ micMuted: v })}
            trackColor={{ true: '#00E5FF' }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Voz TTS</Text>
        {(['jarvis', 'formal', 'tierna', 'firme', 'narrador'] as const).map((v) => (
          <Pressable
            key={v}
            onPress={() => void patch({ voiceId: v })}
            style={[styles.voice, settings.voiceId === v && styles.voiceOn]}
          >
            <Text style={styles.voiceText}>{v.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Modos</Text>
        {Object.entries(MODE_HINTS).map(([k, v]) => (
          <Text key={k} style={styles.modeLine}>
            <Text style={{ color: '#00E5FF' }}>{k}</Text> — {v}
          </Text>
        ))}
      </View>

      <Text style={styles.hint}>
        Micrófono siempre activo por defecto. El botón Mic solo silencia. Huella y contraseña se guardan en
        SecureStore del teléfono.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  back: { color: '#00E5FF', marginBottom: 8 },
  title: { color: '#E8FBFF', fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  sub: { color: '#5A6A7A', fontSize: 11, marginBottom: 8 },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.2)',
    borderRadius: 16,
    padding: 14,
    gap: 10,
    backgroundColor: 'rgba(10,14,20,0.9)',
  },
  label: { color: '#E8FBFF', fontWeight: '700' },
  value: { color: '#8B9AAB', fontSize: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  voice: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  voiceOn: { borderColor: '#00E5FF', backgroundColor: 'rgba(0,229,255,0.12)' },
  voiceText: { color: '#C8D4DE', letterSpacing: 1 },
  modeLine: { color: '#8B9AAB', fontSize: 12, lineHeight: 18 },
  hint: { color: '#5A6A7A', fontSize: 11, lineHeight: 16, marginTop: 8 },
});
