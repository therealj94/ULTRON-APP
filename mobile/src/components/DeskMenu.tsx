/**
 * EL MENÚ DE LA MESA: corto, con lo que se HACE con el avatar (José, 2-oct, con captura: la columna
 * angosta con voz, oído, memoria y «Olvidar» cortado fuera de la pantalla «se mira mal»).
 *
 *   Arriba          con quién está, si hay cerebro, el idioma y «Ajustes» (la pantalla completa)
 *   Escribir        una orden escrita (es lo que abre «Más → Escribir»)
 *   Con quién       Guardián · AU-RA · Claudio
 *   Escuchar / Ver  el micrófono y la cámara
 *   Lo suyo         atajos, y lo de cada avatar (vigilar, orar, cantar, recordar un hecho…)
 *   Juntos          misiones y tu círculo
 *   Investigar, los gestos y el catálogo de lo que sabe hacer
 *
 * Lo que es ajuste (la voz, el oído, «comenta lo que ve», los efectos, la memoria y «Olvidar», su cara,
 * cómo contesta, lo que sabe de ti, cerrar sesión) vive ordenado en Ajustes (ajustes/Ajustes.tsx), que
 * usa las mismas acciones de la mesa (app/mesaAjustes.ts).
 *
 * El panel sale de la derecha: casi todo el ancho en vertical (antes el 64 %: ~250 px en un teléfono),
 * hasta 440 dp acostado, respetando la muesca y la barra de gestos.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_VERSION, type DeskPresence, type Mode } from '../config';
import type { Cancion } from '../lib/api';
import { agrupar, fetchCapacidades, type Capacidad, type CapacidadesPayload } from '../lib/capacidades';
import { GENEROS } from '../lib/intenciones';
import { T, SOMBRA } from '../tema';
import { de, tr, useIdioma, type Bilingue } from '../i18n';
import { AVATARES, avatarPorId, type AvatarId } from '../avatares/catalogo';
import { SelectorIdioma } from '../ui/SelectorIdioma';
import { emitir } from '../nucleo/contrato';
import type { PantallaCerebro } from '../compa/cerebro';
import { abrirCartera } from '../cartera/estado';

/** Una fila del menú que abre una hoja (sus misiones, su círculo, lo que sabe de ti). */
const FilaHoja = ({ titulo, sub, onPress }: { titulo: string; sub: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={styles.row} accessibilityRole="button" accessibilityLabel={`${titulo}. ${sub}`}>
    <View style={styles.textos}>
      <Text style={styles.label}>{titulo}</Text>
      <Text style={styles.sub}>{sub}</Text>
    </View>
    <Text style={styles.chevron}>›</Text>
  </Pressable>
);

/** Ancho del panel: casi todo en vertical, una columna cómoda acostado (nunca la tira angosta de antes). */
export function anchoPanel(ancho: number): number {
  return Math.round(Math.min(440, Math.max(ancho * 0.64, Math.min(ancho - 32, 400))));
}

const MODES: Array<{ id: Mode; label: Bilingue; hint: Bilingue }> = [
  { id: 'GUARDIAN', label: { es: 'Guardián', en: 'Guardian' }, hint: { es: 'vigila', en: 'watches' } },
  { id: 'MINING', label: { es: 'Minería', en: 'Mining' }, hint: { es: 'señales', en: 'signals' } },
  { id: 'GOLD', label: { es: 'Oro', en: 'Gold' }, hint: { es: 'alto valor', en: 'high value' } },
  { id: 'CREATIVE', label: { es: 'Creativo', en: 'Creative' }, hint: { es: 'ideas', en: 'ideas' } },
  { id: 'ANALYTICAL', label: { es: 'Analítico', en: 'Analytical' }, hint: { es: 'frío', en: 'cold' } },
  { id: 'STRATEGIC', label: { es: 'Estratégico', en: 'Strategic' }, hint: { es: 'junta', en: 'board' } },
  { id: 'EXPLORER', label: { es: 'Explorador', en: 'Explorer' }, hint: { es: 'investiga', en: 'investigates' } },
  { id: 'CONOCER', label: { es: 'Conocerte', en: 'Get to know you' }, hint: { es: 'entrevista', en: 'interview' } },
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
  /** Sus misiones o tu círculo (app/HojasCerebro.tsx). Sin él, esas filas no salen. */
  onAbrirHoja?: (h: PantallaCerebro) => void;
  onSearch: (q: string) => void;
  /** Si AU-RA está de cuerpo entero (la sala) o con una cara (anillos o la de respaldo). */
  /** AU-RA se ve como el orbe (src/components/OrbeAura.tsx). */
  conOrbe: boolean;
  /** El avatar de la mesa (Guardián, AU-RA o Claudio): el menú muestra lo suyo. */
  avatar: AvatarId;
  onSetAvatar: (a: AvatarId) => void;
  /** Se ve la cara clásica (respaldo): solo ella sabe dibujar el blaster y el sable. */
  caraClasica: boolean;
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
  useIdioma();
  const { width } = useWindowDimensions();
  const ins = useSafeAreaInsets();
  const panelW = anchoPanel(width);
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

  const av = avatarPorId(p.avatar);
  const esOjos = p.avatar === 'ojos';
  const esAura = p.avatar === 'aura';
  // Claudio y ANT-ONIO se ven con fotos/video: los gestos de los ojos no les aplican.
  const esClaudio = p.avatar === 'claudio' || p.avatar === 'antonio';

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View style={[styles.dim, { opacity: dim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={p.onClose} />
      </Animated.View>
      <Animated.View style={[styles.panel, { width: panelW, transform: [{ translateX: x }] }]}>
        <ScrollView ref={scroll} contentContainerStyle={[styles.content, { paddingTop: ins.top + 16, paddingBottom: ins.bottom + 28, paddingRight: ins.right + 20 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <View style={styles.textos}>
              <Text style={[styles.kicker, { color: av.tema.acentoTexto }]}>
                {de(av.nombre).toUpperCase()} · {de(av.oficio)}
              </Text>
              <Text style={styles.user}>{p.userName}</Text>
            </View>
            <Pressable onPress={p.onClose} style={styles.close} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('Cerrar el menú', 'Close the menu')}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: p.online ? T.activo : T.aviso }]} />
            <Text style={[styles.statusText, { flex: 1 }]}>{p.online ? tr('Conectado', 'Connected') : tr('Sin cerebro · modo local', 'No brain · local mode')}</Text>
            <SelectorIdioma acento={av.tema.acento} sobreAcento={av.tema.sobreAcento} />
          </View>

          {/* Todo lo que es ajuste vive en la pantalla de Ajustes, ordenado y a lo ancho. */}
          <Pressable
            onPress={() => {
              p.onClose();
              emitir('accion', { tipo: 'abrir', pantalla: 'ajustes' });
            }}
            style={[styles.ajustes, { borderColor: av.tema.acento }]}
            accessibilityRole="button"
            accessibilityLabel={tr('Abrir Ajustes: voz, oído, memoria, tema, perfil, permisos y sesión', 'Open Settings: voice, hearing, memory, theme, profile, permissions and session')}
          >
            <View style={styles.textos}>
              <Text style={styles.label}>{tr('Ajustes', 'Settings')}</Text>
              <Text style={styles.sub}>{tr('Voz, oído, memoria, su cara, tema, perfil, permisos y sesión', 'Voice, hearing, memory, her face, theme, profile, permissions and session')}</Text>
            </View>
            <Text style={[styles.chevron, { color: av.tema.acentoTexto }]}>›</Text>
          </Pressable>

          <Text style={styles.section}>{tr('Escribir una orden', 'Type a request')}</Text>
          <View style={styles.composer}>
            <TextInput
              value={p.draft}
              onChangeText={p.onChangeDraft}
              placeholder={tr(`Escríbele a ${de(av.nombre)}…`, `Write to ${de(av.nombre)}…`)}
              placeholderTextColor={T.texto3}
              style={styles.input}
              onSubmitEditing={p.onSendDraft}
              returnKeyType="send"
            />
            <Pressable onPress={p.onSendDraft} style={[styles.send, { backgroundColor: av.tema.acento }]} accessibilityRole="button" accessibilityLabel={tr('Enviar la orden', 'Send the request')}>
              <Text style={[styles.sendText, { color: av.tema.sobreAcento }]}>OK</Text>
            </Pressable>
          </View>

          <Text style={styles.section}>{tr('Con quién hablas', 'Who you’re talking to')}</Text>
          <View style={styles.chips}>
            {AVATARES.map((a) => (
              <Chip key={a.id} on={p.avatar === a.id} label={de(a.nombre)} sub={de(a.oficio)} onPress={() => p.onSetAvatar(a.id)} />
            ))}
          </View>

          <Text style={styles.section}>{tr(`Atajos de ${de(av.nombre)}`, `${de(av.nombre)}’s shortcuts`)}</Text>
          <View style={styles.chips}>
            {av.acciones.map((a) => (
              <Chip key={a.id} label={de(a.etiqueta)} onPress={() => p.onCommand(de(a.pedido))} />
            ))}
          </View>

          {/* Lo que AURA lleva de ti: las metas que te ayuda a cumplir y tu gente cercana. */}
          {p.onAbrirHoja ? (
            <>
              <Text style={styles.section}>{tr('Lo que hacemos juntos', 'What we do together')}</Text>
              <FilaHoja titulo={tr('Misiones', 'Missions')} sub={tr('Tus metas, paso a paso', 'Your goals, step by step')} onPress={() => p.onAbrirHoja?.('misiones')} />
              <FilaHoja titulo={tr('Mi círculo', 'My circle')} sub={tr('Tu gente cercana y sus recordatorios', 'Your close people and their reminders')} onPress={() => p.onAbrirHoja?.('circulo')} />
              <FilaHoja titulo={tr('Cartera', 'Wallet')} sub={tr('Tus saldos de Veta Wallet (solo lectura)', 'Your Veta Wallet balances (read-only)')} onPress={() => {
                  p.onClose();
                  abrirCartera();
                }} />
            </>
          ) : null}

          <View style={styles.row}>
            <View style={styles.textos}>
              <Text style={styles.label}>{tr('Escuchar', 'Listen')}</Text>
              <Text style={styles.sub}>{p.micMuted ? tr('silenciado', 'muted') : p.listening ? tr('oyendo · sin palabra clave', 'listening · no wake word') : tr('conectando…', 'connecting…')}</Text>
            </View>
            <Switch value={!p.micMuted} onValueChange={p.onToggleMic} accessibilityLabel={tr('Escuchar', 'Listen')} trackColor={{ true: T.activo, false: T.borde }} thumbColor={T.panel} />
          </View>
          <View style={styles.row}>
            <View style={styles.textos}>
              <Text style={styles.label}>{tr('Ver', 'See')}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {p.visionOn ? (p.objects.length ? p.objects.join(' · ') : tr('cámara activa', 'camera on')) : tr('cámara apagada', 'camera off')}
              </Text>
            </View>
            <Switch value={p.visionOn} onValueChange={p.onToggleVision} accessibilityLabel={tr('Ver con la cámara', 'See with the camera')} trackColor={{ true: T.activo, false: T.borde }} thumbColor={T.panel} />
          </View>

          {/* ---------------- Guardián: vigilancia ---------------- */}
          {esOjos && (
            <>
              <Text style={styles.section}>{tr('Presencia', 'Presence')}</Text>
              <View style={styles.chips}>
                {(['stay', 'explore', 'sleep'] as DeskPresence[]).map((pr) => (
                  <Chip
                    key={pr}
                    on={p.presence === pr}
                    label={pr === 'stay' ? tr('atento', 'alert') : pr === 'explore' ? tr('explorar', 'explore') : tr('dormir', 'sleep')}
                    onPress={() => p.onSetPresence(pr)}
                  />
                ))}
              </View>
              <Text style={styles.section}>{tr('Modo', 'Mode')}</Text>
              <View style={styles.chips}>
                {MODES.map((m) => (
                  <Chip key={m.id} on={p.mode === m.id} label={de(m.label)} sub={de(m.hint)} onPress={() => p.onSetMode(m.id)} />
                ))}
              </View>
              <Text style={styles.section}>{tr('Acciones', 'Actions')}</Text>
              <View style={styles.chips}>
                <Chip label={tr('¿qué ves?', 'what do you see?')} onPress={p.onWhatDoYouSee} />
                <Chip label={tr('conocerme', 'get to know me')} sub={tr('entrevista opcional', 'optional interview')} onPress={p.onConocer} />
                {p.caraClasica ? (
                  <>
                    <Chip label="blaster" onPress={p.onBlaster} />
                    <Chip label={tr('sable jedi', 'jedi saber')} onPress={p.onSaber} />
                  </>
                ) : null}
              </View>
            </>
          )}

          {/* ---------------- AU-RA: compañera ---------------- */}
          {esAura && (
            <>
              <Text style={styles.section}>{tr('Recordar un hecho', 'Remember a fact')}</Text>
              <View style={styles.composer}>
                <TextInput
                  value={fact}
                  onChangeText={setFact}
                  placeholder={tr('Ej.: la reunión de junta es los lunes', 'E.g.: the board meeting is on Mondays')}
                  placeholderTextColor={T.texto3}
                  style={styles.input}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (fact.trim()) p.onRemember(fact.trim());
                    setFact('');
                  }}
                />
              </View>

              <Text style={styles.section}>{tr('Orar', 'Pray')}</Text>
              <Pressable onPress={p.onOrar} style={styles.orarBtn} accessibilityRole="button" accessibilityLabel={tr('Orar por el día', 'Pray for the day')}>
                <Text style={styles.orarText}>{tr('Orar por el día', 'Pray for the day')}</Text>
                <Text style={styles.orarSub}>{tr('La oración diaria con su voz (~3 min). También: «ora», «oremos», «bendice el día».', 'The daily prayer in her voice (~3 min).')}</Text>
              </Pressable>

              <Text style={styles.section}>{tr('Cantar', 'Sing')}</Text>
              <Text style={styles.sub}>{tr('Su repertorio grabado (la primera vez puede tardar unos segundos).', 'Her recorded repertoire (the first time may take a few seconds).')}</Text>
              <View style={styles.chips}>
                {p.canciones.map((c) => (
                  <Chip key={c.id} label={c.titulo} sub={c.artista} onPress={() => p.onSingSong(c.id)} />
                ))}
              </View>
              <Text style={styles.sub}>{tr('Letras propias por género, dichas en vivo.', 'Original lyrics by genre, performed live.')}</Text>
              <View style={styles.chips}>
                {GENEROS.map((g) => (
                  <Chip key={g.id} label={g.etiqueta} onPress={() => p.onSingGenre(g.id)} />
                ))}
              </View>
            </>
          )}

          {/* ---------------- Claudio: marketing ---------------- */}
          {p.avatar === 'antonio' && (
            <Text style={styles.hint}>
              {tr(
                'ANT-ONIO es tu aliado para resolver: pídele un plan paso a paso, ordenar tus pendientes, un resumen o cómo hacer algo en Veta Wallet, Genesis ID o PULSE2CHAT. Acostado lo ves de retrato; con el teléfono derecho, de cuerpo entero.',
                'ANT-ONIO is your ally to get things done: ask for a step-by-step plan, sorting your to-dos, a summary or how to do something in Veta Wallet, Genesis ID or PULSE2CHAT. Lay the phone down for his portrait; hold it upright to see him full body.'
              )}
            </Text>
          )}
          {p.avatar === 'claudio' && (
            <Text style={styles.hint}>
              {tr(
                'Claudio piensa en marketing: pídele ideas de contenido, textos para redes, eslóganes, guiones de video o un plan de campaña. Dale el producto y el público, y te lo deja listo para publicar. Acostado lo ves de retrato; con el teléfono derecho, de cuerpo entero.',
                'Claudio thinks marketing: ask for content ideas, social posts, slogans, video scripts or a campaign plan. Give him the product and the audience and he’ll leave it ready to publish. Lay the phone down for his portrait; hold it upright to see him full body.'
              )}
            </Text>
          )}

          <Text style={styles.section}>{tr('Investigar en internet', 'Search the web')}</Text>
          <View style={styles.composer}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={tr('Ej.: precio del café hoy en Honduras', 'E.g.: coffee price today in Honduras')}
              placeholderTextColor={T.texto3}
              style={styles.input}
              returnKeyType="search"
              onSubmitEditing={() => {
                if (query.trim()) p.onSearch(query.trim());
                setQuery('');
              }}
            />
          </View>

          {p.conOrbe ? (
            <Text style={styles.hint}>
              {tr(
                'Cuando habla, sus partículas forman las palabras. Cambia de color al escucharte, al pensar y al buscar. Tócala: una onda de luz (y le dan cosquillas). Toques seguidos: «ya, ya». Desliza hacia arriba sobre ella para abrir este menú. Sus sonidos se apagan en Ajustes → Efectos de sonido.',
                'When she talks, her particles form the words. She changes color as she listens, thinks and searches. Touch her: a ripple of light (and it tickles). Several taps: “okay, okay”. Swipe up on her to open this menu. Turn her sounds off in Settings → Sound effects.'
              )}
            </Text>
          ) : esClaudio ? null : !p.caraClasica ? (
            <Text style={styles.hint}>
              {tr(
                'Tócale un ojo y parpadea; tócala y te contesta. Arrastra el dedo y te sigue con la mirada. Mantén pulsado: duerme o despierta. Inclina el teléfono: sus ojos tienen profundidad. Desliza rápido hacia la izquierda para abrir este menú.',
                'Touch an eye and she blinks; touch her and she answers. Drag your finger and her eyes follow. Long press: sleep or wake. Tilt the phone: her eyes have depth. Swipe left quickly to open this menu.'
              )}
            </Text>
          ) : (
            <Text style={styles.hint}>
              {tr(
                'Tócalo: un ojo guiña, la frente le da curiosidad, la barbilla le hace cosquillas, frotar la mejilla lo calma. Arrastra el dedo y te sigue con la mirada. Toques seguidos: «ya, ya». Mantén pulsado: duerme o despierta. Sacude el teléfono: se asusta.',
                'Touch it: an eye winks, the forehead makes it curious, the chin tickles, rubbing the cheek calms it. Drag your finger and its eyes follow. Several taps: “okay, okay”. Long press: sleep or wake. Shake the phone: it gets startled.'
              )}
            </Text>
          )}

          {/* ---------------- catálogo ---------------- */}
          <View onLayout={(e) => (catY.current = e.nativeEvent.layout.y)}>
            <Pressable
              onPress={() => setCatOpen((o) => !o)}
              style={styles.catHead}
              accessibilityRole="button"
              accessibilityLabel={tr(`Qué puede hacer ${de(av.nombre)}`, `What ${de(av.nombre)} can do`)}
              accessibilityState={{ expanded: catOpen }}
            >
              <View style={styles.textos}>
                <Text style={styles.section}>{tr(`Qué puede hacer ${de(av.nombre)}`, `What ${de(av.nombre)} can do`)}</Text>
                <Text style={styles.sub}>
                  {cat.status === 'loading'
                    ? tr('consultando…', 'checking…')
                    : cat.payload
                      ? tr(
                          `${cat.payload.capacidades.length} capacidades · ${vivos} vivas${caidos ? ` · ${caidos} caídas` : ''}${cat.offline ? ' · sin red, copia guardada' : ''}`,
                          `${cat.payload.capacidades.length} capabilities · ${vivos} live${caidos ? ` · ${caidos} down` : ''}${cat.offline ? ' · offline, saved copy' : ''}`
                        )
                      : cat.status === 'fail'
                        ? tr('sin red y sin copia guardada', 'offline and no saved copy')
                        : tr('toca para ver el catálogo', 'tap to see the catalog')}
                </Text>
              </View>
              <Text style={[styles.chev, { color: av.tema.acentoTexto }]}>{catOpen ? '▾' : '▸'}</Text>
            </Pressable>
          </View>
          {catOpen && (
            <View style={{ gap: 10 }}>
              <View style={styles.voiceBox}>
                <Text style={styles.voiceName}>
                  {de(av.nombre)} · {de(av.voz)}
                </Text>
                <Text style={styles.sub}>{tr('Voz de ElevenLabs v4, en vivo, en el idioma que elegiste.', 'ElevenLabs v4 voice, live, in the language you chose.')}</Text>
                <Pressable onPress={p.onProbarVoz} style={[styles.voiceBtn, { backgroundColor: av.tema.acento }]} accessibilityRole="button">
                  <Text style={[styles.voiceBtnText, { color: av.tema.sobreAcento }]}>{tr('Probar voz', 'Try the voice')}</Text>
                </Pressable>
              </View>
              {cat.status === 'loading' && !cat.payload && <ActivityIndicator color={av.tema.acento} />}
              {cat.status === 'fail' && !cat.payload && (
                <Text style={styles.hint}>{tr('No pude bajar el catálogo. Cuando haya red se guarda una copia para verlo sin conexión.', 'I couldn’t download the catalog. When there’s a connection a copy is saved for offline use.')}</Text>
              )}
              {grupos.map((g) => (
                <View key={g.grupo} style={{ gap: 8 }}>
                  <Text style={styles.groupTitle}>{g.titulo}</Text>
                  {g.items.map((c) => (
                    <Card key={c.id} c={c} onCommand={p.onCommand} />
                  ))}
                </View>
              ))}
              {catAt && (
                <Text style={styles.hint}>
                  {tr('catálogo', 'catalog')} {cat.offline ? tr('guardado', 'saved') : tr('actualizado', 'updated')}{' '}
                  {catAt.toLocaleString(tr('es-HN', 'en-US'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
              )}
            </View>
          )}

          <Text style={styles.version}>
            v{APP_VERSION} · {de(av.nombre)}
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
  content: { paddingLeft: 20, gap: 12 },
  /** El texto de una fila ocupa lo que queda y se parte en renglones: nada se sale por la derecha. */
  textos: { flex: 1, minWidth: 0 },
  chevron: { color: T.texto2, fontSize: 22, fontWeight: '600', marginLeft: 8 },
  ajustes: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: T.panel, borderRadius: 18, borderWidth: 1 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: T.principalTexto, letterSpacing: 1.5, fontWeight: '700', fontSize: 12 },
  user: { color: T.texto, fontSize: 22, fontWeight: '700', marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.panel, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: T.texto2, fontSize: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: T.texto2, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: T.panel, borderRadius: 16 },
  label: { color: T.texto, fontSize: 15, fontWeight: '600' },
  sub: { color: T.texto3, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
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
