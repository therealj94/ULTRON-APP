import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { APP_VERSION, VOICE_NAME, type DeskPresence, type Mode } from '../config';
import type { Cancion } from '../lib/api';
import { agrupar, fetchCapacidades, type Capacidad, type CapacidadesPayload } from '../lib/capacidades';
import { GENEROS } from '../lib/intenciones';
import type { SttEngine } from '../lib/storage';
import type { Postura } from '../lib/tareas';
import { T, SOMBRA } from '../tema';

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'GUARDIAN', label: 'Guardián', hint: 'vigila' },
  { id: 'MINING', label: 'Minería', hint: 'señales' },
  { id: 'GOLD', label: 'Oro', hint: 'alto valor' },
  { id: 'CREATIVE', label: 'Creativo', hint: 'ideas' },
  { id: 'ANALYTICAL', label: 'Analítico', hint: 'frío' },
  { id: 'STRATEGIC', label: 'Estratégico', hint: 'junta' },
  { id: 'EXPLORER', label: 'Explorador', hint: 'investiga' },
  { id: 'CONOCER', label: 'Conocerte', hint: 'entrevista' },
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
  onOrar: () => void;
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
  /** Si AU-RA está de cuerpo entero (la sala) o con una cara (anillos o la de respaldo). */
  conSala: boolean;
  /** Qué cara eligió: los anillos (Skia) o la habitación 3D. */
  cara: 'anillos' | 'sala';
  onSetCara: (c: 'anillos' | 'sala') => void;
  /** Se ve la cara clásica (respaldo): solo ella sabe dibujar el blaster y el sable. */
  caraClasica: boolean;
  /** Cómo contesta: de pie en el centro o sentada en su sillón. */
  postura: Postura;
  onSetPostura: (p: Postura) => void;
};

type CatState = { status: 'idle' | 'loading' | 'ok' | 'fail'; payload: CapacidadesPayload | null; offline: boolean; at: string };


// Fuera del componente a propósito: definidos dentro del render eran un TIPO nuevo en cada render
// (DeskScreen re-renderiza a menudo), así que React desmontaba y montaba cada chip y el toque que
// empezaba en uno se perdía antes de soltar.
const Chip = ({ on, label, sub, onPress, tone }: { on?: boolean; label: string; sub?: string; onPress: () => void; tone?: 'ex' }) => (
  <Pressable
    onPress={onPress}
    style={[styles.chip, on && styles.chipOn, tone === 'ex' && styles.chipEx]}
    accessibilityRole="button"
    accessibilityLabel={sub ? `${label}, ${sub}` : label}
    accessibilityState={on === undefined ? undefined : { selected: on }}
  >
    <Text style={[styles.chipText, on && styles.chipTextOn, tone === 'ex' && styles.chipExText]} numberOfLines={2}>
      {tone === 'ex' ? `«${label}»` : label}
    </Text>
    {!!sub && <Text style={[styles.chipSub, on && styles.chipTextOn]}>{sub}</Text>}
  </Pressable>
);

const Dot = ({ vivo }: { vivo: boolean | null }) =>
  vivo === null ? null : <View style={[styles.capDot, { backgroundColor: vivo ? T.activo : T.borde }]} />;

const Card = ({ c, onCommand }: { c: Capacidad; onCommand: (text: string) => void }) => (
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
          <Chip key={e} label={e} tone="ex" onPress={() => onCommand(e)} />
        ))}
      </View>
    )}
  </View>
);

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
              <Text style={styles.kicker}>AU-RA FP</Text>
              <Text style={styles.user}>{p.userName}</Text>
            </View>
            <Pressable onPress={p.onClose} style={styles.close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar el menú">
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: p.online ? T.activo : T.aviso }]} />
            <Text style={styles.statusText}>{p.online ? 'Conectada' : 'Sin cerebro · modo local'}</Text>
          </View>

          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Escuchar</Text>
              <Text style={styles.sub}>{p.micMuted ? 'silenciado' : p.listening ? 'oyendo · sin palabra clave' : 'conectando…'}</Text>
            </View>
            <Switch value={!p.micMuted} onValueChange={p.onToggleMic} accessibilityLabel="Escuchar" trackColor={{ true: T.activo, false: T.borde }} thumbColor={T.panel} />
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Ver</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {p.visionOn ? (p.objects.length ? p.objects.join(' · ') : 'cámara activa') : 'cámara apagada'}
              </Text>
            </View>
            <Switch value={p.visionOn} onValueChange={p.onToggleVision} accessibilityLabel="Ver con la cámara" trackColor={{ true: T.activo, false: T.borde }} thumbColor={T.panel} />
          </View>

          {/* ---------------- catálogo ---------------- */}
          <View onLayout={(e) => (catY.current = e.nativeEvent.layout.y)}>
            <Pressable
              onPress={() => setCatOpen((o) => !o)}
              style={styles.catHead}
              accessibilityRole="button"
              accessibilityLabel="Qué puede hacer AU-RA"
              accessibilityState={{ expanded: catOpen }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.section}>Qué puede hacer AU-RA</Text>
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
                <Pressable onPress={p.onProbarVoz} style={styles.voiceBtn} accessibilityRole="button">
                  <Text style={styles.voiceBtnText}>Probar voz</Text>
                </Pressable>
              </View>
              {cat.status === 'loading' && !cat.payload && <ActivityIndicator color={T.principal} />}
              {cat.status === 'fail' && !cat.payload && (
                <Text style={styles.hint}>No pude bajar el catálogo. Cuando haya red se guarda una copia para verlo sin conexión.</Text>
              )}
              {grupos.map((g) => (
                <View key={g.grupo} style={{ gap: 8 }}>
                  <Text style={styles.groupTitle}>{g.titulo}</Text>
                  {g.items.map((c) => (
                    <Card key={c.id} c={c} onCommand={p.onCommand} />
                  ))}
                </View>
              ))}
              {catAt && <Text style={styles.hint}>catálogo {cat.offline ? 'guardado' : 'actualizado'} {catAt.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>}
            </View>
          )}

          <Text style={styles.section}>Su cara</Text>
          <View style={styles.chips}>
            <Chip on={p.cara === 'anillos'} label="Anillos" sub="sus ojos de luz" onPress={() => p.onSetCara('anillos')} />
            <Chip on={p.cara === 'sala'} label="Habitación 3D" sub="de cuerpo entero" onPress={() => p.onSetCara('sala')} />
          </View>

          {p.cara === 'sala' ? (
            <>
              <Text style={styles.section}>Te contesta</Text>
              <View style={styles.chips}>
                <Chip on={p.postura === 'pie'} label="De pie" sub="en el centro" onPress={() => p.onSetPostura('pie')} />
                <Chip on={p.postura === 'sentada'} label="Sentada" sub="en su sillón" onPress={() => p.onSetPostura('sentada')} />
              </View>
            </>
          ) : null}

          <Text style={styles.section}>Presencia</Text>
          <View style={styles.chips}>
            {(['stay', 'explore', 'sleep'] as DeskPresence[]).map((pr) => (
              <Chip key={pr} on={p.presence === pr} label={pr === 'stay' ? 'atento' : pr === 'explore' ? 'explorar' : 'dormir'} onPress={() => p.onSetPresence(pr)} />
            ))}
          </View>

          <Text style={styles.section}>Modo</Text>
          <View style={styles.chips}>
            {MODES.map((m) => (
              <Chip key={m.id} on={p.mode === m.id} label={m.label} sub={m.hint} onPress={() => p.onSetMode(m.id)} />
            ))}
          </View>

          <Text style={styles.section}>Acciones</Text>
          <View style={styles.chips}>
            <Chip label="¿qué ves?" onPress={p.onWhatDoYouSee} />
            <Chip label="conocerme" sub="entrevista opcional" onPress={p.onConocer} />
            <Chip label="chiste" onPress={() => p.onCommand('cuéntame un chiste')} />
            {p.caraClasica ? (
              <>
                <Chip label="blaster" onPress={p.onBlaster} />
                <Chip label="sable jedi" onPress={p.onSaber} />
              </>
            ) : null}
          </View>

          <Text style={styles.section}>Investigar en internet</Text>
          <View style={styles.composer}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Ej.: precio del café hoy en Honduras"
              placeholderTextColor={T.texto3}
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
          <Text style={styles.sub}>Letras propias por género: AU-RA las canta en vivo.</Text>
          <View style={styles.chips}>
            {GENEROS.map((g) => (
              <Chip key={g.id} label={g.etiqueta} onPress={() => p.onSingGenre(g.id)} />
            ))}
          </View>

          <Text style={styles.section}>Orar</Text>
          <Pressable onPress={p.onOrar} style={styles.orarBtn} accessibilityRole="button" accessibilityLabel="Orar por el día">
            <Text style={styles.orarText}>Orar por el día</Text>
            <Text style={styles.orarSub}>La oración diaria con su voz (~3 min). También: «ora», «oremos», «bendice el día».</Text>
          </Pressable>

          <Text style={styles.section}>Recordar un hecho</Text>
          <View style={styles.composer}>
            <TextInput
              value={fact}
              onChangeText={setFact}
              placeholder="Ej.: la reunión de junta es los lunes"
              placeholderTextColor={T.texto3}
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
              placeholder="Orden para AU-RA…"
              placeholderTextColor={T.texto3}
              style={styles.input}
              onSubmitEditing={p.onSendDraft}
              returnKeyType="send"
            />
            <Pressable onPress={p.onSendDraft} style={styles.send} accessibilityRole="button" accessibilityLabel="Enviar la orden">
              <Text style={styles.sendText}>OK</Text>
            </Pressable>
          </View>

          {p.conSala ? (
            <Text style={styles.hint}>
              Tócale la cabeza y se pone curiosa; el cuerpo le da cosquillas. Toques seguidos: «ya, ya». Desliza hacia arriba sobre ella para abrir este
              menú. Cuando busca en internet se sienta en su escritorio; si envía algo, lanza un avión de papel. Sacude el teléfono: se asusta.
            </Text>
          ) : !p.caraClasica ? (
            <Text style={styles.hint}>
              Tócale un ojo y parpadea; tócala y te contesta. Arrastra el dedo y te sigue con la mirada. Mantén pulsado: duerme o despierta. Inclina
              el teléfono: sus ojos tienen profundidad. Desliza rápido hacia la izquierda para abrir este menú.
            </Text>
          ) : (
            <Text style={styles.hint}>
              Tócala: un ojo guiña, la frente le da curiosidad, la barbilla le hace cosquillas, frotar la mejilla la calma. Arrastra el dedo y te sigue
              con la mirada. Toques seguidos: «ya, ya». Mantén pulsado: duerme o despierta. Sacude el teléfono: se asusta.
            </Text>
          )}

          <Text style={styles.section}>Ajustes</Text>
          <Text style={styles.label}>Voz</Text>
          <Text style={styles.sub}>{VOICE_NAME}. Una sola voz; las frases fijas van grabadas en el APK.</Text>
          <Text style={styles.label}>Oído</Text>
          <Text style={styles.sub}>Cómo convierte tu voz en texto.</Text>
          <View style={styles.chips}>
            <Chip on={p.settings.sttEngine === 'native'} label="Teléfono" sub="Google · en vivo" onPress={() => p.onSetSttEngine('native')} />
            <Chip on={p.settings.sttEngine === 'cloud'} label="Nube" sub="en el servidor" onPress={() => p.onSetSttEngine('cloud')} />
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Comenta lo que ve</Text>
              <Text style={styles.sub}>Observaciones espontáneas de la cámara</Text>
            </View>
            <Switch value={p.settings.proactive} onValueChange={p.onToggleProactive} accessibilityLabel="Comenta lo que ve" trackColor={{ true: T.activo, false: T.borde }} thumbColor={T.panel} />
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Efectos de sonido</Text>
              <Text style={styles.sub}>Toques, blaster, sable</Text>
            </View>
            <Switch value={p.settings.sfx} onValueChange={p.onToggleSfx} accessibilityLabel="Efectos de sonido" trackColor={{ true: T.activo, false: T.borde }} thumbColor={T.panel} />
          </View>
          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Memoria de largo plazo</Text>
              <Text style={styles.sub}>{p.memoryCount ? `${p.memoryCount} hechos guardados` : 'nada guardado aún'}</Text>
            </View>
            <Pressable onPress={p.onForget} style={styles.smallBtn} accessibilityRole="button" accessibilityLabel="Olvidar la memoria de largo plazo">
              <Text style={styles.smallBtnText}>Olvidar</Text>
            </Pressable>
          </View>

          <Pressable onPress={p.onLogout} style={styles.logout} accessibilityRole="button">
            <Text style={styles.logoutText}>Cerrar sesión</Text>
          </Pressable>
          <Text style={styles.version}>
            v{APP_VERSION} · {VOICE_NAME}
          </Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: {
    height: '100%',
    backgroundColor: T.fondo,
    borderTopLeftRadius: 28,
    borderBottomLeftRadius: 28,
    ...SOMBRA,
  },
  content: { padding: 20, gap: 12, paddingBottom: 32 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: T.principalTexto, letterSpacing: 1.5, fontWeight: '700', fontSize: 12 },
  user: { color: T.texto, fontSize: 22, fontWeight: '700', marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.panel, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: T.texto2, fontSize: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: T.texto2, fontSize: 13 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 14, backgroundColor: T.panel, borderRadius: 16 },
  label: { color: T.texto, fontSize: 15, fontWeight: '600' },
  sub: { color: T.texto3, fontSize: 12, marginTop: 2, maxWidth: 300 },
  section: { color: T.texto2, fontSize: 13, fontWeight: '700', marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // minHeight 44: el mínimo cómodo para un dedo (antes quedaban en ~36 px).
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: T.panel, borderWidth: 1, borderColor: T.borde, alignItems: 'center', maxWidth: 260 },
  chipOn: { borderColor: T.activo, backgroundColor: T.activoFondo },
  chipEx: { borderColor: T.borde, backgroundColor: T.principalFondo, paddingVertical: 7 },
  chipText: { color: T.texto, fontSize: 13, fontWeight: '600' },
  chipExText: { color: T.principalTexto, fontWeight: '500', fontStyle: 'italic' },
  chipSub: { color: T.texto3, fontSize: 10, marginTop: 1 },
  chipTextOn: { color: T.activoTexto },
  composer: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: T.borde, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, color: T.texto, fontSize: 15, backgroundColor: T.panel },
  send: { minHeight: 44, minWidth: 44, backgroundColor: T.principal, borderRadius: 999, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center' },
  sendText: { color: T.sobrePrincipal, fontWeight: '700' },
  hint: { color: T.texto3, fontSize: 12, lineHeight: 17, marginTop: 4 },
  smallBtn: { minHeight: 44, justifyContent: 'center', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: T.avisoFondo },
  smallBtnText: { color: T.avisoTexto, fontSize: 13, fontWeight: '600' },
  logout: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
  logoutText: { color: T.avisoTexto, fontSize: 14, fontWeight: '600' },
  version: { color: T.texto3, fontSize: 11, textAlign: 'center' },
  orarBtn: { borderRadius: 18, padding: 14, gap: 4, backgroundColor: T.panel, borderWidth: 1, borderColor: T.borde },
  orarText: { color: T.texto, fontSize: 15, fontWeight: '700' },
  orarSub: { color: T.texto3, fontSize: 12 },
  // catálogo
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: T.borde, marginTop: 4 },
  chev: { color: T.principalTexto, fontSize: 16 },
  voiceBox: { borderRadius: 18, padding: 14, gap: 6, backgroundColor: T.panel },
  voiceName: { color: T.texto, fontSize: 14, fontWeight: '700' },
  voiceBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', backgroundColor: T.principal, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, marginTop: 4 },
  voiceBtnText: { color: T.sobrePrincipal, fontWeight: '700', fontSize: 13 },
  groupTitle: { color: T.texto2, fontSize: 13, fontWeight: '700', marginTop: 4 },
  card: { borderRadius: 18, padding: 14, gap: 6, backgroundColor: T.panel },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  capDot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { color: T.texto, fontSize: 14, fontWeight: '700', flex: 1 },
  cardDetail: { color: T.texto2, fontSize: 12, lineHeight: 17 },
  cardFalta: { color: T.avisoTexto, fontSize: 12 },
});
