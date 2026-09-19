import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { APP_VERSION, VOICE_NAME, type DeskPresence, type Mode } from '../config';
import type { Cancion } from '../lib/api';
import { agrupar, fetchCapacidades, type Capacidad, type CapacidadesPayload } from '../lib/capacidades';
import { GENEROS } from '../lib/intenciones';
import type { SttEngine } from '../lib/storage';

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
  /** Sube cada vez que una orden de voz pide el catálogo: lo despliega. */
  catalogRequest: number;
  canciones: Cancion[];
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
  onSingSong: (id: string) => void;
  onSingGenre: (genreId: string) => void;
  onWhatDoYouSee: () => void;
  onRemember: (fact: string) => void;
  /** Un ejemplo del catálogo o cualquier texto: se manda como orden. */
  onCommand: (text: string) => void;
  onProbarVoz: () => void;
  settings: { sttEngine: SttEngine; proactive: boolean; sfx: boolean };
  memoryCount: number;
  onSetSttEngine: (e: SttEngine) => void;
  onToggleProactive: () => void;
  onToggleSfx: () => void;
  onForget: () => void;
  onSearch: (q: string) => void;
  onLogout: () => void;
};

type CatState = { status: 'idle' | 'loading' | 'ok' | 'fail'; payload: CapacidadesPayload | null; offline: boolean; at: string };

export function DeskMenu(p: Props) {
  const { width } = useWindowDimensions();
  const panelW = Math.min(460, width * 0.64);
  const x = useRef(new Animated.Value(panelW)).current;
  const dim = useRef(new Animated.Value(0)).current;
  const scroll = useRef<ScrollView>(null);
  const catY = useRef(0);
  const [mounted, setMounted] = useState(p.visible);
  const [fact, setFact] = useState('');
  const [query, setQuery] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [cat, setCat] = useState<CatState>({ status: 'idle', payload: null, offline: false, at: '' });

  useEffect(() => {
    if (p.visible) setMounted(true);
    Animated.parallel([
      Animated.timing(x, { toValue: p.visible ? 0 : panelW, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(dim, { toValue: p.visible ? 1 : 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && !p.visible) setMounted(false);
    });
  }, [p.visible, panelW, x, dim]);

  // catálogo: se baja al abrir el menú (y se refresca si ya pasó un rato)
  const lastFetch = useRef(0);
  useEffect(() => {
    if (!p.visible) return;
    if (Date.now() - lastFetch.current < 60_000 && cat.status === 'ok') return;
    lastFetch.current = Date.now();
    setCat((c) => ({ ...c, status: c.payload ? c.status : 'loading' }));
    void fetchCapacidades().then((r) => {
      if (!r) return setCat((c) => ({ ...c, status: c.payload ? 'ok' : 'fail' }));
      setCat({ status: 'ok', payload: r.payload, offline: r.offline, at: r.at });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.visible]);

  useEffect(() => {
    if (!p.catalogRequest) return;
    setCatOpen(true);
    const t = setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, catY.current - 12), animated: true }), 350);
    return () => clearTimeout(t);
  }, [p.catalogRequest]);

  if (!mounted) return null;

  const Chip = ({ on, label, sub, onPress, tone }: { on?: boolean; label: string; sub?: string; onPress: () => void; tone?: 'ex' }) => (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn, tone === 'ex' && styles.chipEx]}>
      <Text style={[styles.chipText, on && styles.chipTextOn, tone === 'ex' && styles.chipExText]} numberOfLines={2}>
        {tone === 'ex' ? `«${label}»` : label}
      </Text>
      {!!sub && <Text style={[styles.chipSub, on && styles.chipTextOn]}>{sub}</Text>}
    </Pressable>
  );

  const Dot = ({ vivo }: { vivo: boolean | null }) =>
    vivo === null ? null : <View style={[styles.capDot, { backgroundColor: vivo ? '#39FF14' : '#55657A' }]} />;

  const Card = ({ c }: { c: Capacidad }) => (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Dot vivo={c.vivo} />
        <Text style={styles.cardTitle}>{c.titulo}</Text>
      </View>
      <Text style={styles.cardDetail}>{c.detalle}</Text>
      {c.vivo === false && !!c.falta && <Text style={styles.cardFalta}>falta: {c.falta}</Text>}
      {c.ejemplos.length > 0 && (
        <View style={styles.chips}>
          {c.ejemplos.map((e) => (
            <Chip key={e} label={e} tone="ex" onPress={() => p.onCommand(e)} />
          ))}
        </View>
      )}
    </View>
  );

  const grupos = cat.payload ? agrupar(cat.payload.capacidades) : [];
  const vivos = cat.payload ? cat.payload.capacidades.filter((c) => c.vivo === true).length : 0;
  const caidos = cat.payload ? cat.payload.capacidades.filter((c) => c.vivo === false).length : 0;
  const catAt = cat.at ? new Date(cat.at) : null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View style={[styles.dim, { opacity: dim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={p.onClose} />
      </Animated.View>
      <Animated.View style={[styles.panel, { width: panelW, transform: [{ translateX: x }] }]}>
        <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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

          {/* ---------------- catálogo ---------------- */}
          <View onLayout={(e) => (catY.current = e.nativeEvent.layout.y)}>
            <Pressable onPress={() => setCatOpen((o) => !o)} style={styles.catHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.section}>Qué puede hacer ULTRON</Text>
                <Text style={styles.sub}>
                  {cat.status === 'loading'
                    ? 'consultando…'
                    : cat.payload
                      ? `${cat.payload.capacidades.length} capacidades · ${vivos} vivas${caidos ? ` · ${caidos} caídas` : ''}${cat.offline ? ' · sin red, copia guardada' : ''}`
                      : cat.status === 'fail'
                        ? 'sin red y sin copia guardada'
                        : 'toca para ver el catálogo'}
                </Text>
              </View>
              <Text style={styles.chev}>{catOpen ? '▾' : '▸'}</Text>
            </Pressable>
          </View>
          {catOpen && (
            <View style={{ gap: 10 }}>
              <View style={styles.voiceBox}>
                <Text style={styles.voiceName}>{VOICE_NAME}</Text>
                <Text style={styles.sub}>
                  {cat.payload?.voz?.motor || 'ElevenLabs v3 (diálogo expresivo)'} · {cat.payload?.voz?.timbre || 'español latino, cálida, cercana'}
                </Text>
                <Pressable onPress={p.onProbarVoz} style={styles.voiceBtn}>
                  <Text style={styles.voiceBtnText}>Probar voz</Text>
                </Pressable>
              </View>
              {cat.status === 'loading' && !cat.payload && <ActivityIndicator color="#00E5FF" />}
              {cat.status === 'fail' && !cat.payload && (
                <Text style={styles.hint}>No pude bajar el catálogo. Cuando haya red se guarda una copia para verlo sin conexión.</Text>
              )}
              {grupos.map((g) => (
                <View key={g.grupo} style={{ gap: 8 }}>
                  <Text style={styles.groupTitle}>{g.titulo}</Text>
                  {g.items.map((c) => (
                    <Card key={c.id} c={c} />
                  ))}
                </View>
              ))}
              {catAt && <Text style={styles.hint}>catálogo {cat.offline ? 'guardado' : 'actualizado'} {catAt.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>}
            </View>
          )}

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
            <Chip label="conocerme" sub="entrevista opcional" onPress={p.onConocer} />
            <Chip label="chiste" onPress={() => p.onCommand('cuéntame un chiste')} />
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

          <Text style={styles.section}>Cantar</Text>
          <Text style={styles.sub}>Repertorio grabado con su voz (la primera vez puede tardar unos segundos).</Text>
          <View style={styles.chips}>
            {p.canciones.map((c) => (
              <Chip key={c.id} label={c.titulo} sub={c.artista} onPress={() => p.onSingSong(c.id)} />
            ))}
          </View>
          <Text style={styles.sub}>Letras propias por género: ULTRON las canta en vivo.</Text>
          <View style={styles.chips}>
            {GENEROS.map((g) => (
              <Chip key={g.id} label={g.etiqueta} onPress={() => p.onSingGenre(g.id)} />
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
            Tócalo: un ojo guiña, la frente le da curiosidad, la barbilla le hace cosquillas, frotar la mejilla lo calma. Arrastra el dedo y te sigue con
            la mirada. Toques seguidos: «ya, ya». Mantén pulsado: duerme o despierta. Sacude el teléfono: se asusta.
          </Text>

          <Text style={styles.section}>Ajustes</Text>
          <Text style={styles.label}>Voz</Text>
          <Text style={styles.sub}>{VOICE_NAME}. Una sola voz; las frases fijas van grabadas en el APK.</Text>
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
            v{APP_VERSION} · {VOICE_NAME} · cerebro Qwen 27B
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
  sub: { color: '#6A7A8A', fontSize: 11, marginTop: 2, maxWidth: 300 },
  section: { color: '#00E5FF', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', maxWidth: 260 },
  chipOn: { borderColor: '#00E5FF', backgroundColor: 'rgba(0,229,255,0.12)' },
  chipEx: { borderColor: 'rgba(0,229,255,0.28)', backgroundColor: 'rgba(0,229,255,0.05)', paddingVertical: 6 },
  chipText: { color: '#9AAABA', fontSize: 12, fontWeight: '600' },
  chipExText: { color: '#BFEFF7', fontWeight: '500', fontStyle: 'italic' },
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
  // catálogo
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: 'rgba(0,229,255,0.12)', marginTop: 4 },
  chev: { color: '#00E5FF', fontSize: 16 },
  voiceBox: { borderWidth: 1, borderColor: 'rgba(0,229,255,0.3)', borderRadius: 14, padding: 12, gap: 6, backgroundColor: 'rgba(0,229,255,0.05)' },
  voiceName: { color: '#E8FBFF', fontSize: 14, fontWeight: '700' },
  voiceBtn: { alignSelf: 'flex-start', backgroundColor: '#00E5FF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7, marginTop: 4 },
  voiceBtnText: { color: '#001018', fontWeight: '800', fontSize: 12 },
  groupTitle: { color: '#9AAABA', fontSize: 12, letterSpacing: 1.5, fontWeight: '700', textTransform: 'uppercase', marginTop: 4 },
  card: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 12, gap: 6, backgroundColor: 'rgba(255,255,255,0.02)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  capDot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { color: '#E8FBFF', fontSize: 14, fontWeight: '700', flex: 1 },
  cardDetail: { color: '#8B9AAB', fontSize: 12, lineHeight: 17 },
  cardFalta: { color: '#FFB86B', fontSize: 11 },
});
