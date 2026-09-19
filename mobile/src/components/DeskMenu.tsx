import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { APP_VERSION, type DeskPresence, type Mode } from '../config';
import type { SttEngine, TtsEngine } from '../lib/storage';

const MODES: Array<{ id: Mode; hint: string }> = [
  { id: 'GUARDIAN', hint: 'vigila' },
  { id: 'MINING', hint: 'señales' },
  { id: 'GOLD', hint: 'alto valor' },
  { id: 'CREATIVE', hint: 'ideas' },
  { id: 'ANALYTICAL', hint: 'frío' },
  { id: 'STRATEGIC', hint: 'junta' },
  { id: 'EXPLORER', hint: 'investiga' },
  { id: 'CONOCER', hint: 'entrevista' },
];

// Cuatro ganchos fijos (a capella, una voz). Letra e idioma fijos.
const HOOKS: Array<{ id: string; label: string; sub: string }> = [
  { id: 'mia', label: 'la mía', sub: 'sin nombre · EN' },
  { id: 'dramatica', label: 'la dramática', sub: 'la larga · EN' },
  { id: 'ligera', label: 'la suave', sub: 'ligera · ES' },
  { id: 'piano', label: 'la íntima', sub: 'piano · EN' },
];

type Props = {
  visible: boolean;
  userName: string;
  mode: Mode;
  presence: DeskPresence;
  micMuted: boolean;
  listening: boolean;
  visionOn: boolean;
  online: boolean;
  objects: string[];
  draft: string;
  onChangeDraft: (t: string) => void;
  onSendDraft: () => void;
  onClose: () => void;
  onSetMode: (m: Mode) => void;
  onSetPresence: (p: DeskPresence) => void;
  onToggleMic: () => void;
  onToggleVision: () => void;
  onConocer: () => void;
  onBlaster: () => void;
  onSaber: () => void;
  onSing: (hookId: string) => void;
  onWhatDoYouSee: () => void;
  onRemember: (fact: string) => void;
  settings: { ttsEngine: TtsEngine; sttEngine: SttEngine; proactive: boolean; sfx: boolean };
  memoryCount: number;
  onSetTtsEngine: (e: TtsEngine) => void;
  onSetSttEngine: (e: SttEngine) => void;
  onToggleProactive: () => void;
  onToggleSfx: () => void;
  onForget: () => void;
  onSearch: (q: string) => void;
  onLogout: () => void;
  canales?: Array<{ id: string; nombre: string; listo: boolean; falta?: string }>;
  onTaller: (cmd: string) => void;
};

export function DeskMenu(p: Props) {
  const { width } = useWindowDimensions();
  const panelW = Math.min(440, width * 0.62);
  const x = useRef(new Animated.Value(panelW)).current;
  const dim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(p.visible);
  const [fact, setFact] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (p.visible) setMounted(true);
    Animated.parallel([
      Animated.timing(x, { toValue: p.visible ? 0 : panelW, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(dim, { toValue: p.visible ? 1 : 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && !p.visible) setMounted(false);
    });
  }, [p.visible, panelW, x, dim]);

  if (!mounted) return null;

  const Chip = ({ on, label, sub, onPress }: { on?: boolean; label: string; sub?: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
      {!!sub && <Text style={[styles.chipSub, on && styles.chipTextOn]}>{sub}</Text>}
    </Pressable>
  );

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View style={[styles.dim, { opacity: dim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={p.onClose} />
      </Animated.View>
      <Animated.View style={[styles.panel, { width: panelW, transform: [{ translateX: x }] }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <View>
              <Text style={styles.kicker}>ULTRON FP</Text>
              <Text style={styles.user}>{p.userName}</Text>
            </View>
            <Pressable onPress={p.onClose} style={styles.close} hitSlop={10}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: p.online ? '#39FF14' : '#FF7A8A' }]} />
            <Text style={styles.statusText}>{p.online ? 'cerebro en línea' : 'sin cerebro · modo local'}</Text>
          </View>

          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Escuchar</Text>
              <Text style={styles.sub}>{p.micMuted ? 'silenciado' : p.listening ? 'oyendo · sin palabra clave' : 'conectando…'}</Text>
            </View>
            <Switch value={!p.micMuted} onValueChange={p.onToggleMic} trackColor={{ true: '#00E5FF', false: '#333' }} thumbColor="#E8FBFF" />
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Ver</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {p.visionOn ? (p.objects.length ? p.objects.join(' · ') : 'cámara activa') : 'cámara apagada'}
              </Text>
            </View>
            <Switch value={p.visionOn} onValueChange={p.onToggleVision} trackColor={{ true: '#00E5FF', false: '#333' }} thumbColor="#E8FBFF" />
          </View>

          <Text style={styles.section}>Presencia</Text>
          <View style={styles.chips}>
            {(['stay', 'explore', 'sleep'] as DeskPresence[]).map((pr) => (
              <Chip key={pr} on={p.presence === pr} label={pr === 'stay' ? 'atento' : pr === 'explore' ? 'explorar' : 'dormir'} onPress={() => p.onSetPresence(pr)} />
            ))}
          </View>

          <Text style={styles.section}>Modo</Text>
          <View style={styles.chips}>
            {MODES.map((m) => (
              <Chip key={m.id} on={p.mode === m.id} label={m.id.toLowerCase()} sub={m.hint} onPress={() => p.onSetMode(m.id)} />
            ))}
          </View>

          <Text style={styles.section}>Acciones</Text>
          <View style={styles.chips}>
            <Chip label="¿qué ves?" onPress={p.onWhatDoYouSee} />
            <Chip label="conocerme" onPress={p.onConocer} />
            <Chip label="blaster" onPress={p.onBlaster} />
            <Chip label="sable jedi" onPress={p.onSaber} />
          </View>

          <Text style={styles.section}>Investigar en internet</Text>
          <View style={styles.composer}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Ej.: precio del café hoy en Honduras"
              placeholderTextColor="#4A5A6A"
              style={styles.input}
              returnKeyType="search"
              onSubmitEditing={() => {
                if (query.trim()) p.onSearch(query.trim());
                setQuery('');
              }}
            />
          </View>
          <Text style={styles.hint}>También por voz: «busca…», «investiga…», «noticias de…».</Text>

          <Text style={styles.section}>Taller</Text>
          <Text style={styles.sub}>
            Estado del sistema, pendientes, PDF y canales. Lo que no tenga clave no se finge: ULTRON te dice qué falta.
          </Text>
          <View style={styles.chips}>
            <Chip label="sistema" sub="nodos" onPress={() => p.onTaller('cómo está el sistema')} />
            <Chip label="mantenimiento" sub="re-probar" onPress={() => p.onTaller('mantenimiento')} />
            <Chip label="pendientes" sub="tareas" onPress={() => p.onTaller('pendientes')} />
          </View>
          <View style={styles.chips}>
            {(p.canales || []).filter((c) => ['telegram', 'whatsapp', 'correo', 'llamada', 'pdf'].includes(c.id)).map((c) => (
              <Chip
                key={c.id}
                on={c.listo}
                label={c.nombre.toLowerCase()}
                sub={c.listo ? 'listo' : 'falta clave'}
                onPress={() => {
                  if (c.id === 'pdf') p.onTaller('haz un pdf de nota de junta');
                  else if (c.id === 'llamada') p.onTaller('llámame y dime que es ULTRON');
                  else p.onTaller(`envía por ${c.id} un saludo de ULTRON`);
                }}
              />
            ))}
          </View>

          <Text style={styles.section}>Cantar</Text>
          <Text style={styles.sub}>A capella, una voz. Por voz: «canta», «canta la dramática», «canta la suave», «canta la íntima». «Para» = silencio.</Text>
          <View style={styles.chips}>
            {HOOKS.map((h) => (
              <Chip key={h.id} label={h.label} sub={h.sub} onPress={() => p.onSing(h.id)} />
            ))}
          </View>

          <Text style={styles.section}>Recordar un hecho</Text>
          <View style={styles.composer}>
            <TextInput
              value={fact}
              onChangeText={setFact}
              placeholder="Ej.: la reunión de junta es los lunes"
              placeholderTextColor="#4A5A6A"
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (fact.trim()) p.onRemember(fact.trim());
                setFact('');
              }}
            />
          </View>

          <Text style={styles.section}>Escribir una orden</Text>
          <View style={styles.composer}>
            <TextInput
              value={p.draft}
              onChangeText={p.onChangeDraft}
              placeholder="Orden para ULTRON…"
              placeholderTextColor="#4A5A6A"
              style={styles.input}
              onSubmitEditing={p.onSendDraft}
              returnKeyType="send"
            />
            <Pressable onPress={p.onSendDraft} style={styles.send}>
              <Text style={styles.sendText}>OK</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Un toque: parpadea. Toca un ojo: guiña. Dos toques: despierta y escucha. Tres: «Aquí estoy». Cuatro: ronronea. Mantén pulsado:
            se concentra y espera tu orden. Desliza: te sigue con la mirada. Menú: desliza desde el borde derecho.
          </Text>

          <Text style={styles.section}>Ajustes</Text>
          <Text style={styles.label}>Voz</Text>
          <Text style={styles.sub}>De dónde sale la voz de ULTRON. Misma voz, distinto motor: compara.</Text>
          <View style={styles.chips}>
            <Chip on={p.settings.ttsEngine === 'eleven'} label="ElevenLabs" sub="rápida · 0.3 s" onPress={() => p.onSetTtsEngine('eleven')} />
            <Chip on={p.settings.ttsEngine === 'qwen'} label="Nodo local" sub="Qwen3-TTS · T4" onPress={() => p.onSetTtsEngine('qwen')} />
            <Chip on={p.settings.ttsEngine === 'auto'} label="Auto" sub="local, si cae Eleven" onPress={() => p.onSetTtsEngine('auto')} />
          </View>
          <Text style={styles.label}>Oído</Text>
          <Text style={styles.sub}>Cómo convierte tu voz en texto.</Text>
          <View style={styles.chips}>
            <Chip on={p.settings.sttEngine === 'native'} label="Teléfono" sub="Google · en vivo" onPress={() => p.onSetSttEngine('native')} />
            <Chip on={p.settings.sttEngine === 'cloud'} label="Nube" sub="Scribe · ElevenLabs" onPress={() => p.onSetSttEngine('cloud')} />
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Comenta lo que ve</Text>
              <Text style={styles.sub}>Observaciones espontáneas de la cámara</Text>
            </View>
            <Switch value={p.settings.proactive} onValueChange={p.onToggleProactive} trackColor={{ true: '#00E5FF', false: '#333' }} thumbColor="#E8FBFF" />
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Efectos de sonido</Text>
              <Text style={styles.sub}>Toques, blaster, sable</Text>
            </View>
            <Switch value={p.settings.sfx} onValueChange={p.onToggleSfx} trackColor={{ true: '#00E5FF', false: '#333' }} thumbColor="#E8FBFF" />
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Memoria de largo plazo</Text>
              <Text style={styles.sub}>{p.memoryCount ? `${p.memoryCount} hechos guardados` : 'nada guardado aún'}</Text>
            </View>
            <Pressable onPress={p.onForget} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Olvidar</Text>
            </Pressable>
          </View>

          <Pressable onPress={p.onLogout} style={styles.logout}>
            <Text style={styles.logoutText}>Cerrar sesión</Text>
          </Pressable>
          <Text style={styles.version}>
            v{APP_VERSION} · voz ULTRON · {p.settings.ttsEngine === 'eleven' ? 'ElevenLabs Flash' : p.settings.ttsEngine === 'qwen' ? 'Qwen3-TTS local' : 'auto'} · cerebro Qwen 27B
          </Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  panel: {
    height: '100%',
    backgroundColor: 'rgba(5,9,14,0.985)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(0,229,255,0.28)',
  },
  content: { padding: 18, gap: 12, paddingBottom: 32 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: '#00E5FF', letterSpacing: 3, fontWeight: '800', fontSize: 11 },
  user: { color: '#E8FBFF', fontSize: 20, fontWeight: '700', marginTop: 2 },
  close: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#C8D4DE', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: '#7A8B9C', fontSize: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  label: { color: '#E8FBFF', fontSize: 15, fontWeight: '600' },
  sub: { color: '#6A7A8A', fontSize: 11, marginTop: 2, maxWidth: 220 },
  section: { color: '#00E5FF', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center' },
  chipOn: { borderColor: '#00E5FF', backgroundColor: 'rgba(0,229,255,0.12)' },
  chipText: { color: '#9AAABA', fontSize: 12, fontWeight: '600' },
  chipSub: { color: '#55657A', fontSize: 9, marginTop: 1 },
  chipTextOn: { color: '#00E5FF' },
  composer: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: 'rgba(0,229,255,0.22)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#E8FBFF' },
  send: { backgroundColor: '#00E5FF', borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' },
  sendText: { color: '#001018', fontWeight: '800' },
  hint: { color: '#4A5A6A', fontSize: 11, lineHeight: 16, marginTop: 4 },
  smallBtn: { borderWidth: 1, borderColor: 'rgba(255,122,138,0.5)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  smallBtnText: { color: '#FF7A8A', fontSize: 12, fontWeight: '600' },
  logout: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
  logoutText: { color: '#FF7A8A', fontSize: 13 },
  version: { color: '#3A4A5A', fontSize: 10, textAlign: 'center' },
});
