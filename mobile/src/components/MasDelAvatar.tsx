/**
 * LO DEL AVATAR, DENTRO DE «MÁS» (auditoría del 7-oct, M-7: dos menús para una pantalla).
 *
 * La mesa tenía dos menús: la hoja «Más» (HojaMas.tsx) y el panel viejo de la derecha (DeskMenu). Lo que el panel tenía y
 * «Más» no (lo demás ya estaba en «Más» o en Ajustes: escribir, con quién, cámara, el oído, misiones, ajustes) vive ahora
 * aquí, debajo de los mosaicos de «Más», y el panel se fue:
 *
 *   · Atajos de <avatar>  lo de su oficio (av.acciones), como frase a la mesa;
 *   · Guardián            presencia (atento · dormir), el TONO (solo cambia cómo habla, M-6), conocerte, y el blaster y el
 *                         sable con la cara clásica;
 *   · AU-RA               recordar un hecho, orar y cantar (su repertorio y letras por género);
 *   · Claudio / ANT-ONIO  qué pedirles;
 *   · Investigar          una búsqueda en internet;
 *   · Qué sabe hacer      el catálogo del servidor (GET /api/capacidades) y «Probar voz»; la orden «catálogo» lo abre;
 *   · los gestos del avatar, si hay red y la versión.
 * «Mi círculo» y «Cartera» son mosaicos de «Más». La orden de voz «menú» abre «Más».
 *
 * Sin ScrollView propio: la hoja (ui/Hoja) ya desplaza todo su contenido (nunca un desplazable dentro de otro).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { APP_VERSION, type DeskPresence, type Mode } from '../config';
import type { Cancion } from '../lib/api';
import { agrupar, fetchCapacidades, type Capacidad, type CapacidadesPayload } from '../lib/capacidades';
import { GENEROS } from '../lib/intenciones';
import { de, tr, type Bilingue } from '../i18n';
import { avatarPorId, type AvatarId } from '../avatares/catalogo';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';

/**
 * El TONO con que habla (server/desk.ts TONO_MODO): solo cambia un adjetivo en las instrucciones, no abre funciones.
 * Antes se llamaban «Modo» con pistas como «Minería · señales» u «Oro · alto valor», que prometían cosas que no hay
 * (auditoría del 7-oct, M-6). «Conocerte» sí hace algo: la entrevista.
 */
const MODES: Array<{ id: Mode; label: Bilingue; hint: Bilingue }> = [
  { id: 'GUARDIAN', label: { es: 'Guardián', en: 'Guardian' }, hint: { es: 'firme, pocas palabras', en: 'firm, few words' } },
  { id: 'MINING', label: { es: 'Seco', en: 'Dry' }, hint: { es: 'va al grano', en: 'to the point' } },
  { id: 'GOLD', label: { es: 'Cálido', en: 'Warm' }, hint: { es: 'charla de metal', en: 'talks metal' } },
  { id: 'CREATIVE', label: { es: 'Creativo', en: 'Creative' }, hint: { es: 'propone ideas', en: 'suggests ideas' } },
  { id: 'ANALYTICAL', label: { es: 'Analítico', en: 'Analytical' }, hint: { es: 'cifras con fuente', en: 'figures with sources' } },
  { id: 'STRATEGIC', label: { es: 'Estratégico', en: 'Strategic' }, hint: { es: 'a largo plazo', en: 'long term' } },
  { id: 'EXPLORER', label: { es: 'Curioso', en: 'Curious' }, hint: { es: 'pregunta más', en: 'asks more' } },
  { id: 'CONOCER', label: { es: 'Conocerte', en: 'Get to know you' }, hint: { es: 'entrevista', en: 'interview' } },
];

type Props = {
  /** La hoja «Más» está abierta (el catálogo se baja al abrirla). */
  visible: boolean;
  avatar: AvatarId;
  online: boolean;
  mode: Mode;
  presence: DeskPresence;
  canciones: Cancion[];
  /** Se ve la cara clásica (respaldo): solo ella sabe dibujar el blaster y el sable. */
  caraClasica: boolean;
  /** AU-RA se ve como el orbe. */
  conOrbe: boolean;
  /** Sube cada vez que una orden de voz pide el catálogo: lo despliega. */
  catalogRequest: number;
  /** Una frase a la mesa (un atajo, un ejemplo del catálogo): cierra «Más» y la manda. */
  onCommand: (texto: string) => void;
  onSetMode: (m: Mode) => void;
  onSetPresence: (p: DeskPresence) => void;
  onConocer: () => void;
  onBlaster: () => void;
  onSaber: () => void;
  onSingSong: (id: string) => void;
  onSingGenre: (genreId: string) => void;
  onOrar: () => void;
  onRemember: (fact: string) => void;
  onSearch: (q: string) => void;
  onProbarVoz: () => void;
};

type CatState = { status: 'idle' | 'loading' | 'ok' | 'fail'; payload: CapacidadesPayload | null; offline: boolean; at: string };

// Fuera del componente a propósito: definidos dentro del render eran un TIPO nuevo en cada render (DeskScreen re-renderiza
// a menudo), así que React desmontaba y montaba cada chip y el toque que empezaba en uno se perdía antes de soltar.
type St = ReturnType<typeof estilos>;
const Chip = ({ st, on, label, sub, onPress, ejemplo }: { st: St; on?: boolean; label: string; sub?: string; onPress: () => void; ejemplo?: boolean }) => (
  <Pressable
    onPress={onPress}
    style={[st.chip, on && st.chipOn, ejemplo && st.chipEx]}
    accessibilityRole="button"
    accessibilityLabel={sub ? `${label}, ${sub}` : label}
    accessibilityState={on === undefined ? undefined : { selected: on }}
  >
    <Text style={[st.chipText, on && st.chipTextOn, ejemplo && st.chipExText]} numberOfLines={2}>
      {ejemplo ? `«${label}»` : label}
    </Text>
    {!!sub && <Text style={[st.chipSub, on && st.chipTextOn]}>{sub}</Text>}
  </Pressable>
);

const Tarjeta = ({ st, tema, c, onCommand }: { st: St; tema: Paleta; c: Capacidad; onCommand: (t: string) => void }) => (
  <View style={st.card}>
    <View style={st.cardHead}>
      {c.vivo === null ? null : <View style={[st.capDot, { backgroundColor: c.vivo ? tema.exito : tema.borde }]} />}
      <Text style={st.cardTitle}>{c.titulo}</Text>
    </View>
    <Text style={st.cardDetail}>{c.detalle}</Text>
    {c.vivo === false && !!c.falta && <Text style={st.cardFalta}>falta: {c.falta}</Text>}
    {c.ejemplos.length > 0 && (
      <View style={st.chips}>
        {c.ejemplos.map((e) => (
          <Chip key={e} st={st} label={e} ejemplo onPress={() => onCommand(e)} />
        ))}
      </View>
    )}
  </View>
);

export function MasDelAvatar(p: Props) {
  const tema = useTema();
  const st = useMemo(() => estilos(tema), [tema]);
  const [fact, setFact] = useState('');
  const [query, setQuery] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [cat, setCat] = useState<CatState>({ status: 'idle', payload: null, offline: false, at: '' });

  // El catálogo se baja al abrir «Más» (y se refresca si ya pasó un rato).
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
    if (p.catalogRequest) setCatOpen(true);
  }, [p.catalogRequest]);

  const av = avatarPorId(p.avatar);
  const esOjos = p.avatar === 'ojos';
  const esAura = p.avatar === 'aura';
  // Claudio y ANT-ONIO se ven con fotos/video: los gestos de los ojos no les aplican.
  const esClaudio = p.avatar === 'claudio' || p.avatar === 'antonio';
  const grupos = cat.payload ? agrupar(cat.payload.capacidades) : [];
  const vivos = cat.payload ? cat.payload.capacidades.filter((c) => c.vivo === true).length : 0;
  const caidos = cat.payload ? cat.payload.capacidades.filter((c) => c.vivo === false).length : 0;
  const catAt = cat.at ? new Date(cat.at) : null;

  return (
    <View style={st.wrap}>
      <Text style={st.section}>{tr(`Atajos de ${de(av.nombre)}`, `${de(av.nombre)}’s shortcuts`)}</Text>
      <View style={st.chips}>
        {av.acciones.map((a) => (
          <Chip key={a.id} st={st} label={de(a.etiqueta)} onPress={() => p.onCommand(de(a.pedido))} />
        ))}
      </View>

      {/* ---------------- Guardián: vigilancia ---------------- */}
      {esOjos && (
        <>
          <Text style={st.section}>{tr('Presencia', 'Presence')}</Text>
          <View style={st.chips}>
            {/* «explorar» solo cambiaba el tono a Curioso y decía «listo para investigar» (M-6): queda en Tono. */}
            {(['stay', 'sleep'] as DeskPresence[]).map((pr) => (
              <Chip key={pr} st={st} on={p.presence === pr} label={pr === 'stay' ? tr('atento', 'alert') : tr('dormir', 'sleep')} onPress={() => p.onSetPresence(pr)} />
            ))}
          </View>
          <Text style={st.section}>{tr('Tono (solo cambia cómo habla)', 'Tone (only changes how it talks)')}</Text>
          <View style={st.chips}>
            {MODES.map((m) => (
              <Chip key={m.id} st={st} on={p.mode === m.id} label={de(m.label)} sub={de(m.hint)} onPress={() => p.onSetMode(m.id)} />
            ))}
          </View>
          <Text style={st.section}>{tr('Acciones', 'Actions')}</Text>
          <View style={st.chips}>
            <Chip st={st} label={tr('conocerme', 'get to know me')} sub={tr('entrevista opcional', 'optional interview')} onPress={p.onConocer} />
            {p.caraClasica ? (
              <>
                <Chip st={st} label="blaster" onPress={p.onBlaster} />
                <Chip st={st} label={tr('sable jedi', 'jedi saber')} onPress={p.onSaber} />
              </>
            ) : null}
          </View>
        </>
      )}

      {/* ---------------- AU-RA: compañera ---------------- */}
      {esAura && (
        <>
          <Text style={st.section}>{tr('Recordar un hecho', 'Remember a fact')}</Text>
          <TextInput
            value={fact}
            onChangeText={setFact}
            placeholder={tr('Ej.: la reunión de junta es los lunes', 'E.g.: the board meeting is on Mondays')}
            placeholderTextColor={tema.texto3}
            style={st.input}
            returnKeyType="done"
            accessibilityLabel={tr('Recordar un hecho', 'Remember a fact')}
            onSubmitEditing={() => {
              if (fact.trim()) p.onRemember(fact.trim());
              setFact('');
            }}
          />
          <Text style={st.section}>{tr('Orar', 'Pray')}</Text>
          <Pressable onPress={p.onOrar} style={st.orarBtn} accessibilityRole="button" accessibilityLabel={tr('Orar por el día', 'Pray for the day')}>
            <Text style={st.orarText}>{tr('Orar por el día', 'Pray for the day')}</Text>
            <Text style={st.sub}>{tr('La oración diaria con su voz (~3 min). También: «ora», «oremos», «bendice el día».', 'The daily prayer in her voice (~3 min).')}</Text>
          </Pressable>
          <Text style={st.section}>{tr('Cantar', 'Sing')}</Text>
          <Text style={st.sub}>{tr('Su repertorio grabado (la primera vez puede tardar unos segundos).', 'Her recorded repertoire (the first time may take a few seconds).')}</Text>
          <View style={st.chips}>
            {p.canciones.map((c) => (
              <Chip key={c.id} st={st} label={c.titulo} sub={c.artista} onPress={() => p.onSingSong(c.id)} />
            ))}
          </View>
          <Text style={st.sub}>{tr('Letras propias por género, dichas en vivo.', 'Original lyrics by genre, performed live.')}</Text>
          <View style={st.chips}>
            {GENEROS.map((g) => (
              <Chip key={g.id} st={st} label={g.etiqueta} onPress={() => p.onSingGenre(g.id)} />
            ))}
          </View>
        </>
      )}

      {/* ---------------- Claudio y ANT-ONIO ---------------- */}
      {p.avatar === 'antonio' && (
        <Text style={st.hint}>
          {tr(
            'ANT-ONIO es tu aliado para resolver: pídele un plan paso a paso, ordenar tus pendientes, un resumen o cómo hacer algo en Veta Wallet, Genesis ID o PULSE2CHAT. Acostado lo ves de retrato; con el teléfono derecho, de cuerpo entero.',
            'ANT-ONIO is your ally to get things done: ask for a step-by-step plan, sorting your to-dos, a summary or how to do something in Veta Wallet, Genesis ID or PULSE2CHAT. Lay the phone down for his portrait; hold it upright to see him full body.'
          )}
        </Text>
      )}
      {p.avatar === 'claudio' && (
        <Text style={st.hint}>
          {tr(
            'Claudio piensa en marketing: pídele ideas de contenido, textos para redes, eslóganes, guiones de video o un plan de campaña. Dale el producto y el público, y te lo deja listo para publicar. Acostado lo ves de retrato; con el teléfono derecho, de cuerpo entero.',
            'Claudio thinks marketing: ask for content ideas, social posts, slogans, video scripts or a campaign plan. Give him the product and the audience and he’ll leave it ready to publish. Lay the phone down for his portrait; hold it upright to see him full body.'
          )}
        </Text>
      )}

      <Text style={st.section}>{tr('Investigar en internet', 'Search the web')}</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={tr('Ej.: precio del café hoy en Honduras', 'E.g.: coffee price today in Honduras')}
        placeholderTextColor={tema.texto3}
        style={st.input}
        returnKeyType="search"
        accessibilityLabel={tr('Investigar en internet', 'Search the web')}
        onSubmitEditing={() => {
          if (query.trim()) p.onSearch(query.trim());
          setQuery('');
        }}
      />

      {/* ---------------- qué sabe hacer: el catálogo ---------------- */}
      <Pressable
        onPress={() => setCatOpen((o) => !o)}
        style={st.catHead}
        accessibilityRole="button"
        accessibilityLabel={tr(`Qué puede hacer ${de(av.nombre)}`, `What ${de(av.nombre)} can do`)}
        accessibilityState={{ expanded: catOpen }}
      >
        <View style={st.textos}>
          <Text style={st.section}>{tr(`Qué puede hacer ${de(av.nombre)}`, `What ${de(av.nombre)} can do`)}</Text>
          <Text style={st.sub}>
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
        <Text style={[st.chev, { color: tema.acentoTexto }]}>{catOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {catOpen && (
        <View style={{ gap: MEDIDA.espacio.s }}>
          <View style={st.card}>
            <Text style={st.cardTitle}>
              {de(av.nombre)} · {de(av.voz)}
            </Text>
            <Text style={st.sub}>{tr('Voz de ElevenLabs v4, en vivo, en el idioma que elegiste.', 'ElevenLabs v4 voice, live, in the language you chose.')}</Text>
            <Pressable onPress={p.onProbarVoz} style={[st.voiceBtn, { backgroundColor: tema.acento }]} accessibilityRole="button">
              <Text style={[st.voiceBtnText, { color: tema.sobreAcento }]}>{tr('Probar voz', 'Try the voice')}</Text>
            </Pressable>
          </View>
          {cat.status === 'loading' && !cat.payload && <ActivityIndicator color={tema.acento} />}
          {cat.status === 'fail' && !cat.payload && (
            <Text style={st.hint}>{tr('No pude bajar el catálogo. Cuando haya red se guarda una copia para verlo sin conexión.', 'I couldn’t download the catalog. When there’s a connection a copy is saved for offline use.')}</Text>
          )}
          {grupos.map((g) => (
            <View key={g.grupo} style={{ gap: MEDIDA.espacio.s }}>
              <Text style={st.section}>{g.titulo}</Text>
              {g.items.map((c) => (
                <Tarjeta key={c.id} st={st} tema={tema} c={c} onCommand={p.onCommand} />
              ))}
            </View>
          ))}
          {catAt && (
            <Text style={st.hint}>
              {tr('catálogo', 'catalog')} {cat.offline ? tr('guardado', 'saved') : tr('actualizado', 'updated')}{' '}
              {catAt.toLocaleString(tr('es-HN', 'en-US'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
      )}

      {p.conOrbe ? (
        <Text style={st.hint}>
          {tr(
            'Cuando habla, sus partículas forman las palabras. Cambia de color al escucharte, al pensar y al buscar. Tócala: una onda de luz (y le dan cosquillas). Toques seguidos: «ya, ya». Desliza hacia arriba sobre ella para abrir «Más». Sus sonidos se apagan en Ajustes → Efectos de sonido.',
            'When she talks, her particles form the words. She changes color as she listens, thinks and searches. Touch her: a ripple of light (and it tickles). Several taps: “okay, okay”. Swipe up on her to open “More”. Turn her sounds off in Settings → Sound effects.'
          )}
        </Text>
      ) : esClaudio ? null : !p.caraClasica ? (
        <Text style={st.hint}>
          {tr(
            'Tócale un ojo y parpadea; tócala y te contesta. Arrastra el dedo y te sigue con la mirada. Mantén pulsado: duerme o despierta. Inclina el teléfono: sus ojos tienen profundidad. Desliza rápido hacia la izquierda para abrir «Más».',
            'Touch an eye and she blinks; touch her and she answers. Drag your finger and her eyes follow. Long press: sleep or wake. Tilt the phone: her eyes have depth. Swipe left quickly to open “More”.'
          )}
        </Text>
      ) : (
        <Text style={st.hint}>
          {tr(
            'Tócalo: un ojo guiña, la frente le da curiosidad, la barbilla le hace cosquillas, frotar la mejilla lo calma. Arrastra el dedo y te sigue con la mirada. Toques seguidos: «ya, ya». Mantén pulsado: duerme o despierta. Sacude el teléfono: se asusta.',
            'Touch it: an eye winks, the forehead makes it curious, the chin tickles, rubbing the cheek calms it. Drag your finger and its eyes follow. Several taps: “okay, okay”. Long press: sleep or wake. Shake the phone: it gets startled.'
          )}
        </Text>
      )}

      <View style={st.pie}>
        <View style={[st.dot, { backgroundColor: p.online ? tema.exito : tema.aviso }]} />
        <Text style={st.hint}>
          {p.online ? tr('Conectado', 'Connected') : tr('Sin cerebro · modo local', 'No brain · local mode')} · v{APP_VERSION} · {de(av.nombre)}
        </Text>
      </View>
    </View>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    wrap: { gap: MEDIDA.espacio.s, paddingTop: MEDIDA.espacio.m, paddingBottom: MEDIDA.espacio.s },
    /** El texto de una fila ocupa lo que queda y se parte en renglones: nada se sale por la derecha. */
    textos: { flex: 1, minWidth: 0 },
    section: { color: p.texto2, fontSize: 13, fontWeight: '700', marginTop: MEDIDA.espacio.s },
    sub: { color: p.texto3, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
    hint: { color: p.texto3, fontSize: 12, lineHeight: 17, marginTop: MEDIDA.espacio.xs, flexShrink: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: MEDIDA.espacio.s },
    // minHeight 44: el mínimo cómodo para un dedo.
    chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: MEDIDA.radio.redondo, backgroundColor: p.superficie, borderWidth: 1, borderColor: p.borde, alignItems: 'center', maxWidth: 260 },
    chipOn: { borderColor: p.acento, backgroundColor: p.acentoFondo },
    chipEx: { backgroundColor: p.superficie2, paddingVertical: 7 },
    chipText: { color: p.texto, fontSize: 13, fontWeight: '600' },
    chipExText: { color: p.acentoTexto, fontWeight: '500', fontStyle: 'italic' },
    chipSub: { color: p.texto3, fontSize: 10, marginTop: 1 },
    chipTextOn: { color: p.acentoTexto },
    input: { borderWidth: 1, borderColor: p.borde, borderRadius: MEDIDA.radio.m, paddingHorizontal: 14, paddingVertical: 10, color: p.texto, fontSize: 15, backgroundColor: p.superficie },
    orarBtn: { borderRadius: MEDIDA.radio.m, padding: 14, gap: 4, backgroundColor: p.superficie, borderWidth: 1, borderColor: p.borde },
    orarText: { color: p.texto, fontSize: 15, fontWeight: '700' },
    catHead: { flexDirection: 'row', alignItems: 'center', gap: MEDIDA.espacio.s, paddingVertical: MEDIDA.espacio.s, borderTopWidth: 1, borderTopColor: p.borde, marginTop: MEDIDA.espacio.xs },
    chev: { fontSize: 16 },
    voiceBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderRadius: MEDIDA.radio.redondo, paddingHorizontal: 16, paddingVertical: 8, marginTop: 4 },
    voiceBtnText: { fontWeight: '700', fontSize: 13 },
    card: { borderRadius: MEDIDA.radio.m, padding: 14, gap: 6, backgroundColor: p.superficie },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: MEDIDA.espacio.s },
    capDot: { width: 8, height: 8, borderRadius: 4 },
    cardTitle: { color: p.texto, fontSize: 14, fontWeight: '700', flexShrink: 1 },
    cardDetail: { color: p.texto2, fontSize: 12, lineHeight: 17 },
    cardFalta: { color: p.texto2, fontSize: 12 },
    pie: { flexDirection: 'row', alignItems: 'center', gap: MEDIDA.espacio.s, marginTop: MEDIDA.espacio.s },
    dot: { width: 8, height: 8, borderRadius: 4 },
  });
}
