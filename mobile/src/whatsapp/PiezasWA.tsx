/**
 * LAS PIEZAS QUE HACEN QUE SE VEA COMO WHATSAPP: el círculo con la foto de perfil (o las iniciales), la
 * burbuja con su cola, la hora y la palomita adentro, la foto que se baja sola (con la miniatura
 * borrosa mientras tanto), el sticker sin burbuja, el video, la nota de voz que se escucha, el
 * documento, y el visor de fotos a pantalla completa (pellizcar para acercar).
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Letra as Text } from '../ui/Letra';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio, ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import { tr } from '../i18n';
import { IconoWA, type NombreIconoWA } from './IconoWA';
import { olvidarFoto, olvidarMedia, useFotoPerfil, useMediaWA } from './medios';
import {
  colorAvatar,
  colorNombre,
  duracionTexto,
  etiquetaMedia,
  formaDe,
  horaWA,
  inicialesWA,
  mediaReintentable,
  nombrePersona,
  textoBurbuja,
  type FilaWA,
  type MensajeWA,
  type PaletaWA,
} from './logica';

/* ── el círculo del chat ──────────────────────────────────────────────────────────────────── */

export function AvatarWA({ jid, nombre, grupo, tam = 50, w, tiene = null, onFoto }: { jid: string; nombre: string; grupo: boolean; tam?: number; w: PaletaWA; tiene?: boolean | null; onFoto?: (uri: string) => void }) {
  const foto = useFotoPerfil(jid, tiene);
  const [rota, setRota] = useState(false);
  useEffect(() => setRota(false), [foto]);
  const ini = grupo ? '' : inicialesWA(nombre);
  const redondo = { width: tam, height: tam, borderRadius: tam / 2 };
  const contenido =
    foto && !rota ? (
      <Image
        source={{ uri: foto }}
        style={[redondo, { backgroundColor: w.sinFoto }]}
        onError={() => {
          setRota(true);
          olvidarFoto(jid);
        }}
        accessibilityIgnoresInvertColors
      />
    ) : (
      <View style={[redondo, { backgroundColor: ini ? colorAvatar(jid) : w.sinFoto, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
        {ini ? (
          <Text style={{ color: '#FFFFFF', fontSize: Math.round(tam * 0.38), fontWeight: '600' }} allowFontScaling={false}>
            {ini}
          </Text>
        ) : (
          <IconoWA nombre={grupo ? 'grupo' : 'persona'} tam={Math.round(tam * 0.62)} color="#FFFFFF" style={grupo ? undefined : { marginTop: tam * 0.12 }} />
        )}
      </View>
    );
  if (onFoto && foto && !rota)
    return (
      <Pressable onPress={() => onFoto(foto)} accessibilityRole="imagebutton" accessibilityLabel={tr(`Ver la foto de ${nombre}`, `See ${nombre}’s photo`)} hitSlop={4}>
        {contenido}
      </Pressable>
    );
  return contenido;
}

/* ── la burbuja ───────────────────────────────────────────────────────────────────────────── */

type PropsBurbuja = {
  f: Extract<FilaWA, { tipo: 'msg' }>;
  w: PaletaWA;
  oscuro: boolean;
  anchoMax: number;
  idioma: 'es' | 'en';
  onFoto: (uri: string, m: MensajeWA) => void;
  onVideo: (uri: string) => void;
  onReintentar: (texto: string) => void;
};

/** La hora y la palomita que van adentro, abajo a la derecha. */
function Meta({ m, w, sobreFoto, enLinea, idioma }: { m: MensajeWA; w: PaletaWA; sobreFoto?: boolean; enLinea?: boolean; idioma: 'es' | 'en' }) {
  const color = sobreFoto ? '#FFFFFF' : m.mio ? w.metaMia : w.metaOtra;
  return (
    <View style={enLinea ? st.metaEnLinea : [st.meta, sobreFoto && st.metaSobreFoto]} pointerEvents="none">
      {m.editado ? <Text style={[st.metaTxt, { color }]}>{idioma === 'en' ? 'Edited ' : 'Editado '}</Text> : null}
      <Text style={[st.metaTxt, { color }]}>{horaWA(m.hora)}</Text>
      {m.mio ? (
        m.fallo ? (
          <IconoWA nombre="alerta" tam={14} color={w.aviso} style={{ marginLeft: 3 }} />
        ) : m.enviando ? (
          <IconoWA nombre="reloj" tam={13} color={color} grosor={2.2} style={{ marginLeft: 3 }} />
        ) : (
          <IconoWA nombre="check" tam={15} color={color} grosor={2.2} style={{ marginLeft: 2 }} />
        )
      ) : null}
    </View>
  );
}

/** El hueco invisible al final del texto para que la hora quepa en la última línea (como WhatsApp). */
function hueco(m: MensajeWA, idioma: 'es' | 'en') {
  return `  ${m.editado ? (idioma === 'en' ? 'Edited ' : 'Editado ') : ''}${horaWA(m.hora)}${m.mio ? '    ' : ''}`;
}

function Cola({ mio, color }: { mio: boolean; color: string }) {
  return <View pointerEvents="none" style={[st.cola, mio ? { right: -7, borderLeftWidth: 8, borderLeftColor: color } : { left: -7, borderRightWidth: 8, borderRightColor: color }]} />;
}

function BurbujaWABase({ f, w, oscuro, anchoMax, idioma, onFoto, onVideo, onReintentar }: PropsBurbuja) {
  const m = f.m;
  const forma = formaDe(m);
  const conCola = !f.pegadaArriba;
  const fondo = m.mio ? w.mia : w.otra;
  const cuerpo = textoBurbuja(m);
  const nombre = f.conNombre ? (
    <Text style={[st.nombreGrupo, { color: colorNombre(m.de || m.nombreDe, oscuro) }]} numberOfLines={1}>
      {nombrePersona(m.nombreDe, idioma)}
    </Text>
  ) : null;
  const lado = { alignItems: m.mio ? ('flex-end' as const) : ('flex-start' as const), marginTop: f.pegadaArriba ? 2 : 8, paddingLeft: m.mio ? 48 : 8, paddingRight: m.mio ? 8 : 48 };
  // Un mensaje que no salió: por qué, y un botón «Reintentar» a la vista (auditoría A10), como en PULSE2CHAT.
  const fallo = m.fallo ? (
    <View style={st.fallo} accessibilityLiveRegion="polite">
      <IconoWA nombre="alerta" tam={14} color={w.aviso} />
      <View style={{ marginLeft: 4, flexShrink: 1, alignItems: 'flex-end' }}>
        <Text style={{ color: w.aviso, fontSize: 12.5, fontWeight: '600' }}>{tr('No se envió', 'Not sent')}</Text>
        {/* Por qué (el puente no contesta, se desvinculó, sin conexión…): sin esto solo se veía «no se envió». */}
        <Text style={{ color: w.aviso, fontSize: 11.5, opacity: 0.85 }} numberOfLines={2}>
          {m.fallo}
        </Text>
      </View>
      <Pressable
        onPress={() => onReintentar(m.texto)}
        accessibilityRole="button"
        accessibilityLabel={tr(`Reintentar el envío: ${m.fallo}`, `Retry sending: ${m.fallo}`)}
        hitSlop={6}
        style={({ pressed }) => [st.reintentar, { backgroundColor: w.avisoFondo, borderColor: w.aviso, opacity: pressed ? 0.7 : 1 }]}
      >
        <IconoWA nombre="reintentar" tam={14} color={w.aviso} grosor={2.2} />
        <Text style={{ color: w.aviso, fontSize: 12.5, fontWeight: '700' }}>{tr('Reintentar', 'Retry')}</Text>
      </Pressable>
    </View>
  ) : null;

  // El sticker va suelto, sin burbuja.
  if (forma === 'sticker')
    return (
      <View style={lado}>
        {nombre ? <View style={[st.chipNombre, { backgroundColor: w.chip }]}>{nombre}</View> : null}
        <Sticker m={m} w={w} onFoto={onFoto} />
      </View>
    );

  const media = forma === 'imagen' || forma === 'video';
  const anchoFoto = Math.min(anchoMax - 6, 300);
  return (
    <View style={lado}>
      <View
        style={[
          st.burbuja,
          { backgroundColor: fondo, maxWidth: anchoMax },
          media && { padding: 3, width: anchoFoto + 6 },
          forma === 'audio' && { width: Math.min(anchoMax, 290) },
          forma === 'documento' && { padding: 3, width: Math.min(anchoMax, 300) },
          conCola && (m.mio ? { borderTopRightRadius: 0 } : { borderTopLeftRadius: 0 }),
          !oscuro && st.sombra,
        ]}
      >
        {conCola ? <Cola mio={m.mio} color={fondo} /> : null}
        {nombre ? <View style={media || forma === 'documento' ? { paddingHorizontal: 6, paddingTop: 2 } : undefined}>{nombre}</View> : null}
        {forma === 'imagen' ? <FotoMsg m={m} w={w} ancho={anchoFoto} idioma={idioma} onFoto={onFoto} conMeta={!cuerpo} /> : null}
        {forma === 'video' ? <VideoMsg m={m} w={w} ancho={anchoFoto} idioma={idioma} onVideo={onVideo} conMeta={!cuerpo} /> : null}
        {forma === 'audio' ? <NotaVoz m={m} w={w} idioma={idioma} /> : null}
        {forma === 'documento' ? <Documento m={m} w={w} idioma={idioma} /> : null}
        {forma === 'otro' ? <Otro m={m} w={w} idioma={idioma} /> : null}
        {forma === 'eliminado' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconoWA nombre="prohibido" tam={16} color={w.metaOtra} />
            <Text style={[st.texto, { color: w.metaOtra, fontStyle: 'italic', marginLeft: 5 }]}>
              {m.mio ? tr('Eliminaste este mensaje', 'You deleted this message') : tr('Se eliminó este mensaje', 'This message was deleted')}
              <Text style={st.huecoTxt}>{hueco(m, idioma)}</Text>
            </Text>
          </View>
        ) : null}
        {cuerpo && forma !== 'eliminado' ? (
          <Text style={[st.texto, { color: w.texto }, (media || forma === 'documento') && { paddingHorizontal: 5, paddingTop: 4, paddingBottom: 2 }]} selectable>
            {cuerpo}
            <Text style={st.huecoTxt}>{hueco(m, idioma)}</Text>
          </Text>
        ) : null}
        {/* La hora: sobre la foto cuando no hay pie; debajo del documento; si no, abajo a la derecha. */}
        {media && !cuerpo ? null : forma === 'documento' && !cuerpo ? <Meta m={m} w={w} idioma={idioma} enLinea /> : <Meta m={m} w={w} idioma={idioma} />}
      </View>
      {fallo}
    </View>
  );
}

export const BurbujaWA = memo(
  BurbujaWABase,
  (a, b) =>
    a.f.m === b.f.m &&
    a.f.pegadaArriba === b.f.pegadaArriba &&
    a.f.conNombre === b.f.conNombre &&
    a.w === b.w &&
    a.anchoMax === b.anchoMax &&
    a.idioma === b.idioma &&
    a.onFoto === b.onFoto &&
    a.onVideo === b.onVideo &&
    a.onReintentar === b.onReintentar
);

/* ── la foto ──────────────────────────────────────────────────────────────────────────────── */

/** Alto de la foto según su forma, entre apaisada y vertical (como recorta WhatsApp). */
function useProporcion(uri: string | null, inicial = 0.75) {
  const [r, setR] = useState(inicial);
  useEffect(() => {
    if (!uri) return;
    let vivo = true;
    Image.getSize(
      uri,
      (ancho, alto) => {
        if (vivo && ancho > 0 && alto > 0) setR(Math.max(0.56, Math.min(1.33, alto / ancho)));
      },
      () => {}
    );
    return () => {
      vivo = false;
    };
  }, [uri]);
  return r;
}

function FotoMsg({ m, w, ancho, idioma, onFoto, conMeta }: { m: MensajeWA; w: PaletaWA; ancho: number; idioma: 'es' | 'en'; onFoto: (uri: string, m: MensajeWA) => void; conMeta: boolean }) {
  const med = useMediaWA(m, !!m.conMedia);
  const mini = m.miniatura ? `data:image/jpeg;base64,${m.miniatura}` : null;
  const [rota, setRota] = useState(false);
  const r = useProporcion(mini || med.uri);
  const alto = Math.round(ancho * r);
  const lista = !!med.uri && !rota;
  const tocar = () => {
    if (lista && med.uri) onFoto(med.uri, m);
    else if (!med.cargando && (rota || !med.error || mediaReintentable(med.status))) {
      setRota(false);
      void med.cargar();
    }
  };
  return (
    <Pressable onPress={tocar} accessibilityRole="imagebutton" accessibilityLabel={lista ? tr('Ver la foto', 'See the photo') : med.error ? `${med.error}` : tr('Foto', 'Photo')} style={[st.foto, { width: ancho, height: alto, backgroundColor: w.tarjeta }]}>
      {lista && med.uri ? (
        <Image
          source={{ uri: med.uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => {
            setRota(true);
            olvidarMedia(m);
          }}
        />
      ) : mini ? (
        <Image source={{ uri: mini }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={4} />
      ) : null}
      {!lista ? <EstadoCarga med={med} rota={rota} sinArchivo={!m.conMedia} w={w} idioma={idioma} /> : null}
      {conMeta ? <Meta m={m} w={w} sobreFoto idioma={idioma} /> : null}
    </Pressable>
  );
}

/** Encima de la miniatura: el círculo que gira, o qué pasó y «reintentar». */
function EstadoCarga({ med, rota, sinArchivo, w, idioma, icono = 'descargar' }: { med: ReturnType<typeof useMediaWA>; rota: boolean; sinArchivo: boolean; w: PaletaWA; idioma: 'es' | 'en'; icono?: NombreIconoWA }) {
  if (sinArchivo)
    return (
      <View style={[StyleSheet.absoluteFill, st.centro]} pointerEvents="none">
        <View style={st.pildora}>
          <Text style={st.pildoraTxt}>{idioma === 'en' ? 'Open it on your phone' : 'Ábrela en tu teléfono'}</Text>
        </View>
      </View>
    );
  return (
    <View style={[StyleSheet.absoluteFill, st.centro]} pointerEvents="none">
      {med.cargando ? (
        <View style={{ alignItems: 'center' }}>
          <View style={st.circuloOscuro}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
          {med.lento ? (
            <View style={[st.pildora, { marginTop: 8 }]}>
              <Text style={st.pildoraTxt}>{idioma === 'en' ? 'Getting it from WhatsApp…' : 'Trayéndola de WhatsApp…'}</Text>
            </View>
          ) : null}
        </View>
      ) : med.error || rota ? (
        <View style={{ alignItems: 'center', paddingHorizontal: 12 }}>
          {mediaReintentable(med.status) || rota ? (
            <View style={st.circuloOscuro}>
              <IconoWA nombre="reintentar" tam={24} color="#FFFFFF" />
            </View>
          ) : null}
          <View style={[st.pildora, { marginTop: 8 }]}>
            <Text style={st.pildoraTxt} numberOfLines={3}>
              {rota ? (idioma === 'en' ? 'The file is damaged. Tap to retry.' : 'El archivo llegó dañado. Toca para reintentar.') : med.error}
            </Text>
          </View>
        </View>
      ) : (
        <View style={st.circuloOscuro}>
          <IconoWA nombre={icono} tam={24} color="#FFFFFF" />
        </View>
      )}
    </View>
  );
}

/* ── el sticker ───────────────────────────────────────────────────────────────────────────── */

function Sticker({ m, w, onFoto }: { m: MensajeWA; w: PaletaWA; onFoto: (uri: string, m: MensajeWA) => void }) {
  const med = useMediaWA(m, !!m.conMedia);
  const [rota, setRota] = useState(false);
  const tam = 150;
  return (
    <Pressable
      onPress={() => (med.uri && !rota ? onFoto(med.uri, m) : !med.cargando && (rota || !med.error || mediaReintentable(med.status)) && (setRota(false), void med.cargar()))}
      accessibilityRole="imagebutton"
      accessibilityLabel="Sticker"
      style={{ width: tam, height: tam }}
    >
      {med.uri && !rota ? (
        <Image source={{ uri: med.uri }} style={{ width: tam, height: tam }} resizeMode="contain" onError={() => (setRota(true), olvidarMedia(m))} />
      ) : (
        <View style={[{ width: tam, height: tam, borderRadius: 16, backgroundColor: w.tarjeta }, st.centro]}>
          {med.cargando ? <ActivityIndicator color={w.metaOtra} /> : <IconoWA nombre={med.error || rota ? 'reintentar' : 'sticker'} tam={34} color={w.metaOtra} />}
          {med.error ? (
            <Text style={{ color: w.metaOtra, fontSize: 11.5, textAlign: 'center', marginTop: 6, paddingHorizontal: 8 }} numberOfLines={3}>
              {med.error}
            </Text>
          ) : null}
        </View>
      )}
      <View style={[st.meta, st.metaSticker, { backgroundColor: w.chip }]} pointerEvents="none">
        <Text style={[st.metaTxt, { color: w.chipTexto }]}>{horaWA(m.hora)}</Text>
        {m.mio ? <IconoWA nombre={m.enviando ? 'reloj' : 'check'} tam={14} color={w.chipTexto} grosor={2.2} style={{ marginLeft: 2 }} /> : null}
      </View>
    </Pressable>
  );
}

/* ── el video ─────────────────────────────────────────────────────────────────────────────── */

function VideoMsg({ m, w, ancho, idioma, onVideo, conMeta }: { m: MensajeWA; w: PaletaWA; ancho: number; idioma: 'es' | 'en'; onVideo: (uri: string) => void; conMeta: boolean }) {
  const med = useMediaWA(m, false);
  const mini = m.miniatura ? `data:image/jpeg;base64,${m.miniatura}` : null;
  const r = useProporcion(mini, 0.62);
  const alto = Math.round(ancho * r);
  const tocar = async () => {
    if ((med.error && !mediaReintentable(med.status)) || med.cargando || !m.conMedia) return;
    const uri = med.uri || (await med.cargar());
    if (uri) onVideo(uri);
  };
  const error = med.error && !med.cargando;
  return (
    <Pressable onPress={() => void tocar()} accessibilityRole="button" accessibilityLabel={tr(`Ver el video${m.duracion ? `, ${duracionTexto(m.duracion)}` : ''}`, `Play the video${m.duracion ? `, ${duracionTexto(m.duracion)}` : ''}`)} style={[st.foto, { width: ancho, height: alto, backgroundColor: '#000' }]}>
      {mini ? <Image source={{ uri: mini }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={[StyleSheet.absoluteFill, st.centro]} pointerEvents="none">
        {med.cargando ? (
          <View style={{ alignItems: 'center' }}>
            <View style={st.circuloOscuro}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
            {med.lento ? (
              <View style={[st.pildora, { marginTop: 8 }]}>
                <Text style={st.pildoraTxt}>{idioma === 'en' ? 'Getting it from WhatsApp…' : 'Trayéndolo de WhatsApp…'}</Text>
              </View>
            ) : null}
          </View>
        ) : !m.conMedia || (med.error && !mediaReintentable(med.status)) ? (
          <View style={st.pildora}>
            <Text style={st.pildoraTxt}>{med.error || (idioma === 'en' ? 'Open it on your phone' : 'Ábrelo en tu teléfono')}</Text>
          </View>
        ) : (
          <>
            <View style={[st.circuloOscuro, { width: 56, height: 56, borderRadius: 28 }]}>
              <IconoWA nombre={error ? 'reintentar' : 'play'} tam={26} color="#FFFFFF" style={error ? undefined : { marginLeft: 3 }} />
            </View>
            {error ? (
              <View style={[st.pildora, { marginTop: 8 }]}>
                <Text style={st.pildoraTxt} numberOfLines={3}>
                  {med.error}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>
      <View style={st.duracionVideo} pointerEvents="none">
        <IconoWA nombre="video" tam={14} color="#FFFFFF" grosor={2.2} />
        {m.duracion ? <Text style={[st.metaTxt, { color: '#FFFFFF', marginLeft: 4 }]}>{duracionTexto(m.duracion)}</Text> : null}
      </View>
      {conMeta ? <Meta m={m} w={w} sobreFoto idioma={idioma} /> : null}
    </Pressable>
  );
}

/* ── la nota de voz ───────────────────────────────────────────────────────────────────────── */

/** Una sola nota suena a la vez: al tocar otra, la anterior se detiene. */
let sonando: { sound: Audio.Sound; parar: () => void } | null = null;

function NotaVoz({ m, w, idioma }: { m: MensajeWA; w: PaletaWA; idioma: 'es' | 'en' }) {
  const med = useMediaWA(m, false);
  const [tocando, setTocando] = useState(false);
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState((m.duracion || 0) * 1000);
  const sonido = useRef<Audio.Sound | null>(null);
  const [falloAudio, setFalloAudio] = useState('');

  useEffect(
    () => () => {
      const s = sonido.current;
      sonido.current = null;
      if (s) {
        if (sonando?.sound === s) sonando = null;
        void s.unloadAsync().catch(() => {});
      }
    },
    []
  );

  const alEstado = (e: AVPlaybackStatus) => {
    if (!e.isLoaded) return;
    setPos(e.positionMillis || 0);
    if (e.durationMillis) setTotal(e.durationMillis);
    setTocando(e.isPlaying);
    if (e.didJustFinish) {
      setTocando(false);
      setPos(0);
      void sonido.current?.setPositionAsync(0).catch(() => {});
    }
  };

  const tocar = async () => {
    setFalloAudio('');
    try {
      if (sonido.current) {
        const e = await sonido.current.getStatusAsync();
        if (e.isLoaded && e.isPlaying) {
          await sonido.current.pauseAsync();
          return;
        }
        if (sonando && sonando.sound !== sonido.current) sonando.parar();
        sonando = { sound: sonido.current, parar: () => void sonido.current?.pauseAsync().catch(() => {}) };
        await sonido.current.playAsync();
        return;
      }
      const uri = med.uri || (await med.cargar());
      if (!uri) return;
      if (sonando) sonando.parar();
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, progressUpdateIntervalMillis: 250 }, alEstado);
      sonido.current = sound;
      sonando = { sound, parar: () => void sound.pauseAsync().catch(() => {}) };
    } catch {
      setFalloAudio(idioma === 'en' ? 'Couldn’t play it here: open it on your phone.' : 'No se pudo reproducir aquí: ábrela en tu teléfono.');
    }
  };

  const avance = total > 0 ? Math.min(1, pos / total) : 0;
  const sinArreglo = !!med.error && !mediaReintentable(med.status);
  const icono: NombreIconoWA = med.error && !med.cargando && !sinArreglo ? 'reintentar' : tocando ? 'pausa' : 'play';
  const texto = tocando || pos > 0 ? duracionTexto(pos / 1000) : duracionTexto(total / 1000);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={[st.circuloMic, { backgroundColor: m.mio ? w.enviar : w.verde }]}>
          <IconoWA nombre="microfono" tam={20} color={m.mio ? w.sobreEnviar : w.sobreGlobo} />
        </View>
        <Pressable
          onPress={() => void tocar()}
          disabled={med.cargando || !m.conMedia || sinArreglo}
          accessibilityRole="button"
          accessibilityLabel={tocando ? tr('Pausar la nota de voz', 'Pause the voice note') : tr(`Escuchar la nota de voz, ${duracionTexto(total / 1000)}`, `Play the voice note, ${duracionTexto(total / 1000)}`)}
          style={st.botonPlay}
        >
          {med.cargando ? <ActivityIndicator color={w.metaOtra} /> : <IconoWA nombre={icono} tam={26} color={w.metaOtra} lleno={icono !== 'reintentar'} />}
        </Pressable>
        <View style={{ flex: 1, marginRight: 4 }}>
          <View style={[st.pista, { backgroundColor: m.mio ? 'rgba(0,0,0,0.15)' : w.tarjeta }]}>
            <View style={[st.pistaLlena, { width: `${Math.round(avance * 100)}%`, backgroundColor: m.mio ? w.enviar : w.verde }]} />
            <View style={[st.bolita, { left: `${Math.round(avance * 100)}%`, backgroundColor: m.mio ? w.enviar : w.verde }]} />
          </View>
          <Text style={[st.metaTxt, { color: m.mio ? w.metaMia : w.metaOtra, marginTop: 6 }]}>{texto}</Text>
        </View>
      </View>
      {med.error || falloAudio || !m.conMedia ? (
        <Text style={{ color: w.metaOtra, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
          {falloAudio || med.error || (idioma === 'en' ? 'Open it on your phone' : 'Ábrela en tu teléfono')}
        </Text>
      ) : null}
    </View>
  );
}

/* ── el documento y lo demás ──────────────────────────────────────────────────────────────── */

function Documento({ m, w, idioma }: { m: MensajeWA; w: PaletaWA; idioma: 'es' | 'en' }) {
  const nombre = m.archivo || (idioma === 'en' ? 'Document' : 'Documento');
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(m.archivo || '')?.[1] || '').toUpperCase();
  return (
    <View style={[st.doc, { backgroundColor: w.tarjeta }]} accessible accessibilityLabel={`${idioma === 'en' ? 'Document' : 'Documento'}: ${nombre}`}>
      <View style={[st.docIcono, { backgroundColor: ext === 'PDF' ? '#E5252A' : '#5E97F6' }]}>
        {ext ? (
          <Text style={{ color: '#FFF', fontSize: 9.5, fontWeight: '800' }} allowFontScaling={false}>
            {ext}
          </Text>
        ) : (
          <IconoWA nombre="documento" tam={20} color="#FFFFFF" />
        )}
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ color: w.texto, fontSize: 14.5 }} numberOfLines={2}>
          {nombre}
        </Text>
        <Text style={{ color: w.metaOtra, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          {ext ? `${ext} · ` : ''}
          {idioma === 'en' ? 'open it on your phone' : 'ábrelo en tu teléfono'}
        </Text>
      </View>
    </View>
  );
}

function Otro({ m, w, idioma }: { m: MensajeWA; w: PaletaWA; idioma: 'es' | 'en' }) {
  const icono: NombreIconoWA = m.tipo === 'ubicacion' ? 'ubicacion' : m.tipo === 'contacto' ? 'contacto' : m.tipo === 'encuesta' ? 'encuesta' : 'documento';
  const etiqueta = (etiquetaMedia(m, idioma) || m.texto || (idioma === 'en' ? 'Message' : 'Mensaje')).replace(/^\p{Extended_Pictographic}️?\s*/u, '');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 4 }}>
      <IconoWA nombre={icono} tam={18} color={w.metaOtra} />
      <Text style={[st.texto, { color: w.texto, marginLeft: 6, flexShrink: 1 }]}>
        {etiqueta}
        <Text style={st.huecoTxt}>{hueco(m, idioma)}</Text>
      </Text>
    </View>
  );
}

/* ── el visor de fotos: pantalla completa, pellizcar para acercar, deslizar abajo para cerrar ── */

export function VisorFoto({ uri, titulo, detalle, onCerrar }: { uri: string; titulo?: string; detalle?: string; onCerrar: () => void }) {
  const ins = useSafeAreaInsets();
  const escala = useSharedValue(1);
  const base = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const bx = useSharedValue(0);
  const by = useSharedValue(0);

  const gesto = useMemo(() => {
    const pellizco = Gesture.Pinch()
      .onUpdate((e) => {
        escala.value = Math.max(1, Math.min(5, base.value * e.scale));
      })
      .onEnd(() => {
        base.value = escala.value;
        if (escala.value <= 1.02) {
          escala.value = withTiming(1);
          base.value = 1;
          x.value = withTiming(0);
          y.value = withTiming(0);
          bx.value = 0;
          by.value = 0;
        }
      });
    const arrastre = Gesture.Pan()
      .averageTouches(true)
      .onUpdate((e) => {
        if (base.value > 1) {
          x.value = bx.value + e.translationX;
          y.value = by.value + e.translationY;
        } else {
          y.value = e.translationY;
        }
      })
      .onEnd((e) => {
        if (base.value > 1) {
          bx.value = x.value;
          by.value = y.value;
        } else if (Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 1200) {
          scheduleOnRN(onCerrar);
        } else {
          y.value = withTiming(0);
        }
      });
    const doble = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        if (base.value > 1) {
          escala.value = withTiming(1);
          base.value = 1;
          x.value = withTiming(0);
          y.value = withTiming(0);
          bx.value = 0;
          by.value = 0;
        } else {
          escala.value = withTiming(2.5);
          base.value = 2.5;
        }
      });
    return Gesture.Simultaneous(pellizco, arrastre, doble);
  }, [onCerrar]); // eslint-disable-line react-hooks/exhaustive-deps

  const estilo = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: escala.value }] }));
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onCerrar}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
        <GestureDetector gesture={gesto}>
          <Animated.View style={[{ flex: 1 }, estilo]} collapsable={false}>
            <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel={tr('La foto', 'The photo')} />
          </Animated.View>
        </GestureDetector>
        <View style={[st.visorBarra, { paddingTop: ins.top + 4 }]}>
          <Pressable onPress={onCerrar} accessibilityRole="button" accessibilityLabel={tr('Cerrar la foto', 'Close the photo')} style={st.boton44} hitSlop={6}>
            <IconoWA nombre="atras" tam={24} color="#FFFFFF" grosor={2.2} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 4 }}>
            {titulo ? (
              <Text style={{ color: '#FFF', fontSize: 17, fontWeight: '600' }} numberOfLines={1}>
                {titulo}
              </Text>
            ) : null}
            {detalle ? (
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }} numberOfLines={1}>
                {detalle}
              </Text>
            ) : null}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** El video a pantalla completa, con los controles del sistema (expo-av, ya en la app). */
export function VisorVideo({ uri, onCerrar }: { uri: string; onCerrar: () => void }) {
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [fallo, setFallo] = useState(false);
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onCerrar}>
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}>
        {fallo ? (
          <Text style={{ color: '#FFF', textAlign: 'center', padding: 24, fontSize: 15 }}>{tr('Este video no se puede reproducir aquí: ábrelo en tu teléfono.', 'This video can’t play here: open it on your phone.')}</Text>
        ) : (
          <Video source={{ uri }} style={{ width, height: height * 0.8 }} resizeMode={ResizeMode.CONTAIN} useNativeControls shouldPlay onError={() => setFallo(true)} />
        )}
        <Pressable onPress={onCerrar} accessibilityRole="button" accessibilityLabel={tr('Cerrar el video', 'Close the video')} style={[st.boton44, { position: 'absolute', top: ins.top + 4, left: 8 }]} hitSlop={6}>
          <IconoWA nombre="cerrar" tam={24} color="#FFFFFF" grosor={2.2} />
        </Pressable>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  burbuja: { borderRadius: 8, paddingHorizontal: 8, paddingTop: 5, paddingBottom: 6, minWidth: 64 },
  sombra: { shadowColor: '#0B141A', shadowOpacity: 0.13, shadowRadius: 0.5, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  cola: { position: 'absolute', top: 0, width: 0, height: 0, borderBottomWidth: 10, borderBottomColor: 'transparent' },
  nombreGrupo: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  chipNombre: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 4 },
  texto: { fontSize: 15.5, lineHeight: 21 },
  huecoTxt: { fontSize: 11, color: 'transparent' },
  meta: { position: 'absolute', right: 7, bottom: 4, flexDirection: 'row', alignItems: 'center' },
  metaEnLinea: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', marginTop: 3, marginRight: 4, marginBottom: 1 },
  metaSobreFoto: { right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  metaSticker: { right: 4, bottom: 4, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  metaTxt: { fontSize: 11, lineHeight: 15 },
  fallo: { flexDirection: 'row', alignItems: 'center', marginTop: 4, minHeight: 24, gap: 8 },
  reintentar: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  foto: { borderRadius: 6, overflow: 'hidden' },
  centro: { alignItems: 'center', justifyContent: 'center' },
  circuloOscuro: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(11,20,26,0.55)', alignItems: 'center', justifyContent: 'center' },
  pildora: { backgroundColor: 'rgba(11,20,26,0.66)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 240 },
  pildoraTxt: { color: '#FFFFFF', fontSize: 12.5, textAlign: 'center' },
  duracionVideo: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center' },
  circuloMic: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  botonPlay: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pista: { height: 4, borderRadius: 2, justifyContent: 'center' },
  pistaLlena: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2 },
  bolita: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6, top: -4 },
  doc: { flexDirection: 'row', alignItems: 'center', borderRadius: 6, padding: 10, minHeight: 60 },
  docIcono: { width: 34, height: 40, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  visorBarra: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 8, backgroundColor: 'rgba(0,0,0,0.45)' },
  boton44: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
