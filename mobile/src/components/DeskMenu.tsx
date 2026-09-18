import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { DeskPresence, Mode } from '../config';

export const DESK_VOICES: Array<{ id: string; name: string; hint: string }> = [
  { id: 'ultron', name: 'ULTRON', hint: 'Asistente profesional' },
  { id: 'luna', name: 'LUNA', hint: 'Mujer, alegre' },
  { id: 'spark', name: 'SPARK', hint: 'Bot alegre' },
  { id: 'jarvis', name: 'JARVIS', hint: 'Mayordomo calmo' },
];

const MODES: Mode[] = ['GUARDIAN', 'MINING', 'GOLD', 'CREATIVE', 'ANALYTICAL', 'STRATEGIC', 'EXPLORER', 'CONOCER'];

type Props = {
  visible: boolean;
  userName: string;
  mode: Mode;
  presence: DeskPresence;
  voiceId: string;
  micMuted: boolean;
  listening: boolean;
  visionOn: boolean;
  draft: string;
  onChangeDraft: (t: string) => void;
  onSendDraft: () => void;
  onClose: () => void;
  onSetMode: (m: Mode) => void;
  onSetPresence: (p: DeskPresence) => void;
  onSetVoice: (id: string) => void;
  onToggleMic: () => void;
  onToggleVision: () => void;
  onConocer: () => void;
  onBlaster: () => void;
  onSaber: () => void;
  onSing: (genre: string) => void;
  onLogout: () => void;
};

const GENRES = ['balada', 'ranchera', 'pop', 'rock', 'salsa', 'cumbia', 'corrido', 'jazz', 'cuna'];

export function DeskMenu({
  visible,
  userName,
  mode,
  presence,
  voiceId,
  micMuted,
  listening,
  visionOn,
  draft,
  onChangeDraft,
  onSendDraft,
  onClose,
  onSetMode,
  onSetPresence,
  onSetVoice,
  onToggleMic,
  onToggleVision,
  onConocer,
  onBlaster,
  onSaber,
  onSing,
  onLogout,
}: Props) {
  if (!visible) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable style={styles.dim} onPress={onClose} />
      <View style={styles.panel}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 28 }}>
          <View style={styles.head}>
            <View>
              <Text style={styles.kicker}>ULTRON FP</Text>
              <Text style={styles.user}>{userName}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>Cerrar</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>Desliza desde el borde derecho · la cara ocupa toda la pantalla</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Micrófono {listening && !micMuted ? '· oyendo' : ''}</Text>
            <Switch value={!micMuted} onValueChange={() => onToggleMic()} trackColor={{ true: '#00E5FF' }} />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Visión / mirada</Text>
            <Switch value={visionOn} onValueChange={() => onToggleVision()} trackColor={{ true: '#00E5FF' }} />
          </View>

          <Text style={styles.section}>Presencia</Text>
          <View style={styles.chips}>
            {(['stay', 'explore', 'sleep'] as DeskPresence[]).map((p) => (
              <Pressable key={p} onPress={() => onSetPresence(p)} style={[styles.chip, presence === p && styles.chipOn]}>
                <Text style={[styles.chipText, presence === p && styles.chipTextOn]}>{p}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>Modo</Text>
          <View style={styles.chips}>
            {MODES.map((m) => (
              <Pressable key={m} onPress={() => onSetMode(m)} style={[styles.chip, mode === m && styles.chipOn]}>
                <Text style={[styles.chipText, mode === m && styles.chipTextOn]}>{m.toLowerCase()}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>Voces</Text>
          {DESK_VOICES.map((v) => (
            <Pressable key={v.id} onPress={() => onSetVoice(v.id)} style={[styles.voice, voiceId === v.id && styles.voiceOn]}>
              <Text style={styles.voiceName}>{v.name}</Text>
              <Text style={styles.voiceHint}>{v.hint}</Text>
            </Pressable>
          ))}

          <Text style={styles.section}>Juego</Text>
          <View style={styles.chips}>
            <Pressable onPress={onBlaster} style={styles.chip}>
              <Text style={styles.chipText}>blaster</Text>
            </Pressable>
            <Pressable onPress={onSaber} style={styles.chip}>
              <Text style={styles.chipText}>sable jedi</Text>
            </Pressable>
            <Pressable onPress={onConocer} style={styles.chip}>
              <Text style={styles.chipText}>conocerme</Text>
            </Pressable>
          </View>
          <Text style={styles.section}>Cantar</Text>
          <View style={styles.chips}>
            {GENRES.map((g) => (
              <Pressable key={g} onPress={() => onSing(g)} style={styles.chip}>
                <Text style={styles.chipText}>{g}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>Escribir (solo aquí)</Text>
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="Orden para ULTRON…"
              placeholderTextColor="#4A5A6A"
              style={styles.input}
              onSubmitEditing={onSendDraft}
              returnKeyType="send"
            />
            <Pressable onPress={onSendDraft} style={styles.send}>
              <Text style={styles.sendText}>OK</Text>
            </Pressable>
          </View>

          <Pressable onPress={onLogout} style={styles.logout}>
            <Text style={styles.logoutText}>Cerrar sesión</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: {
    width: '78%',
    maxWidth: 420,
    height: '100%',
    backgroundColor: 'rgba(6,10,16,0.97)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(0,229,255,0.28)',
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: '#00E5FF', letterSpacing: 3, fontWeight: '800', fontSize: 12 },
  user: { color: '#E8FBFF', fontSize: 18, fontWeight: '700', marginTop: 2 },
  close: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  closeText: { color: '#C8D4DE', fontSize: 12 },
  hint: { color: '#4A5A6A', fontSize: 11 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: '#E8FBFF', fontSize: 14 },
  section: { color: '#00E5FF', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  chipOn: { borderColor: '#00E5FF', backgroundColor: 'rgba(0,229,255,0.12)' },
  chipText: { color: '#9AAABA', fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#00E5FF' },
  voice: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  voiceOn: { borderColor: '#00E5FF', backgroundColor: 'rgba(0,229,255,0.1)' },
  voiceName: { color: '#E8FBFF', fontWeight: '800', letterSpacing: 1 },
  voiceHint: { color: '#7A8B9C', fontSize: 12, marginTop: 2 },
  composer: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: 'rgba(0,229,255,0.22)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#E8FBFF' },
  send: { backgroundColor: '#00E5FF', borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' },
  sendText: { color: '#001018', fontWeight: '800' },
  logout: { alignItems: 'center', paddingVertical: 12 },
  logoutText: { color: '#FF7A8A', fontSize: 13 },
});
