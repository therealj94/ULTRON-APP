/**
 * UN CHAT DE WHATSAPP, como en WhatsApp: la cabecera verde con la foto, el nombre y el número (o
 * «grupo») y los botones de llamar; el fondo del chat; las burbujas con su cola, la hora y la palomita
 * adentro; los separadores de día; y la caja para escribir con el botón verde.
 *
 *   · Lo que escribe y manda sale directo (es su «sí»); aparece en el acto y, si no sale, se queda con
 *     «toca para reintentar».
 *   · Abrirlo lo marca leído (también en su teléfono), y lo que llega estando a la vista también.
 *   · Trae los últimos 60; al subir hasta arriba trae los 60 anteriores (`antes`), y así.
 *   · Llamar: WhatsApp no deja llamar desde un dispositivo vinculado, así que el teléfono y la cámara
 *     abren SU app de WhatsApp en ese contacto (se explica una vez).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { fuente } from '../ui/tipografia';
import { Letra as Text } from '../ui/Letra';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MEDIDA, useTema } from '../nucleo/tema';
import { idiomaActual, tr } from '../i18n';
import * as API from './api';
import { registrarAtras } from './atras';
import { IconoWA } from './IconoWA';
import { AvatarWA, BurbujaWA, VisorFoto, VisorVideo } from './PiezasWA';
import {
  MENSAJES_POR_VUELTA,
  digitosLlamada,
  enlacesWhatsapp,
  etiquetaDiaWA,
  filasWA,
  fusionarInfoChat,
  horaWA,
  huellaMensajes,
  juntar,
  mensajeErrorWA,
  nombreChat,
  nombrePersona,
  paletaWA,
  sondeoWA,
  subtituloChat,
  unirMensajes,
  type ChatWA,
  type FilaWA,
  type MensajeWA,
} from './logica';

const CLAVE_LLAMADAS = 'whatsapp.llamadas.explicado';
let llamadasExplicadas = false;

/** Abre su app de WhatsApp en ese contacto (la primera vez, explica por qué). */
async function abrirEnWhatsapp(digitos: string, nombre: string) {
  const { app, web } = enlacesWhatsapp(digitos);
  const ir = async () => {
    try {
      await Linking.openURL(app);
    } catch {
      try {
        await Linking.openURL(web);
      } catch {
        Alert.alert(tr('No pude abrir WhatsApp', 'I couldn’t open WhatsApp'), tr('Revisa que WhatsApp esté instalado en este teléfono.', 'Check that WhatsApp is installed on this phone.'));
      }
    }
  };
  if (!llamadasExplicadas) llamadasExplicadas = (await AsyncStorage.getItem(CLAVE_LLAMADAS).catch(() => null)) === '1';
  if (llamadasExplicadas) return void ir();
  Alert.alert(
    tr('Las llamadas se hacen en tu app de WhatsApp', 'Calls happen in your WhatsApp app'),
    tr(
      `WhatsApp no deja llamar desde un dispositivo vinculado. Te abro el chat con ${nombre} en tu WhatsApp: ahí toca el teléfono o la cámara.`,
      `WhatsApp doesn’t allow calls from a linked device. I’ll open your chat with ${nombre} in WhatsApp: tap the phone or camera there.`
    ),
    [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      {
        text: tr('Abrir WhatsApp', 'Open WhatsApp'),
        onPress: () => {
          llamadasExplicadas = true;
          void AsyncStorage.setItem(CLAVE_LLAMADAS, '1').catch(() => {});
          void ir();
        },
      },
    ]
  );
}

export function ConversacionWA({ chat, onAtras }: { chat: ChatWA; onAtras: () => void }) {
  const p = useTema();
  const w = useMemo(() => paletaWA(p), [p]);
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [mensajes, setMensajes] = useState<MensajeWA[] | null>(null);
  const [locales, setLocales] = useState<MensajeWA[]>([]);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [foto, setFoto] = useState<{ uri: string; titulo: string; detalle: string } | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [info, setInfo] = useState<ChatWA>(chat);
  const [viejos, setViejos] = useState<MensajeWA[]>([]);
  const [cargandoViejos, setCargandoViejos] = useState(false);
  const [sinMasViejos, setSinMasViejos] = useState(false);
  const ultimoAjeno = useRef('');
  const primera = useRef(true);
  const huella = useRef('');

  const nombre = nombreChat(info, idioma);
  const subtitulo = subtituloChat(info, idioma);
  const digitos = digitosLlamada(info);

  // «Atrás» cierra primero la foto o el video, luego el chat (en el Modal de los chats y en la pila).
  useEffect(() => {
    const atras = () => {
      if (video) setVideo(null);
      else if (foto) setFoto(null);
      else onAtras();
      return true;
    };
    const quitar = registrarAtras(atras);
    const sub = BackHandler.addEventListener('hardwareBackPress', atras);
    return () => {
      quitar();
      sub.remove();
    };
  }, [onAtras, foto, video]);

  useEffect(() => {
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      try {
        const r = await API.mensajesWA(chat.jid);
        if (!vivo) return;
        const h = huellaMensajes(r.mensajes);
        if (h !== huella.current) {
          huella.current = h;
          setMensajes(r.mensajes);
        } else setMensajes((ms) => ms ?? r.mensajes);
        // Menos de una vuelta entera la primera vez: no hay nada más viejo que pedir.
        if (primera.current) {
          primera.current = false;
          if (r.mensajes.length < MENSAJES_POR_VUELTA) setSinMasViejos(true);
        }
        // El servidor puede traer el nombre, el número o si tiene foto (un chat nuevo vuelve vacío: no se toca).
        setInfo((c) => fusionarInfoChat(c, r.chat));
        setError('');
        // Llegó algo nuevo de la otra persona estando a la vista: queda leído (también en su teléfono).
        const ajeno = [...r.mensajes].reverse().find((m) => !m.mio);
        if (ajeno && ajeno.id !== ultimoAjeno.current) {
          ultimoAjeno.current = ajeno.id;
          void API.leidoWA(chat.jid).catch(() => {});
        }
      } catch (e: any) {
        if (vivo) {
          // Un chat nuevo (desde «Nuevo chat») todavía no tiene mensajes: se ve vacío, listo para escribir.
          setMensajes((ms) => ms ?? []);
          if (e?.status !== 404) setError(mensajeErrorWA(Number(e?.status) || 0, e?.message, idiomaActual() === 'en' ? 'en' : 'es'));
        }
      }
      if (vivo) reloj = setTimeout(vuelta, sondeoWA('listo', true));
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [chat.jid]);

  const todos = useMemo(() => juntar(unirMensajes(viejos, mensajes || []), locales), [viejos, mensajes, locales]);

  /** Subió hasta arriba: los 60 anteriores al más viejo que se ve. */
  const cargarViejos = useCallback(async () => {
    if (cargandoViejos || sinMasViejos || !mensajes?.length) return;
    const masViejo = unirMensajes(viejos, mensajes)[0]?.hora || 0;
    if (!masViejo) return;
    setCargandoViejos(true);
    try {
      const r = await API.mensajesWA(chat.jid, masViejo);
      if (r.mensajes.length < MENSAJES_POR_VUELTA) setSinMasViejos(true);
      if (r.mensajes.length) setViejos((v) => unirMensajes(r.mensajes, v));
    } catch {
      /* se vuelve a intentar al subir otra vez */
    } finally {
      setCargandoViejos(false);
    }
  }, [cargandoViejos, sinMasViejos, mensajes, viejos, chat.jid]);
  // La lista va invertida (lo nuevo abajo, sin saltos al llegar fotos): las filas, de la más nueva a la más vieja.
  const filas = useMemo(() => filasWA(todos, !!info.grupo).reverse(), [todos, info.grupo]);

  const enviar = useCallback(
    async (contenido: string) => {
      const t = contenido.trim();
      if (!t) return;
      const local: MensajeWA = { id: `local-${Date.now()}`, chat: chat.jid, de: '', nombreDe: '', mio: true, hora: Date.now(), tipo: 'texto', texto: t, enviando: true };
      setLocales((l) => [...l.filter((x) => x.texto !== t || !x.fallo), local]);
      try {
        const m = await API.enviarWA(chat.jid, t);
        setLocales((l) => l.filter((x) => x.id !== local.id));
        if (m) setMensajes((ms) => (ms && !ms.some((x) => x.id === m.id) ? [...ms, m] : ms));
      } catch (e: any) {
        setLocales((l) => l.map((x) => (x.id === local.id ? { ...x, enviando: false, fallo: mensajeErrorWA(Number(e?.status) || 0, e?.message, idiomaActual() === 'en' ? 'en' : 'es') } : x)));
      }
    },
    [chat.jid]
  );

  const mandar = () => {
    const t = texto;
    if (!t.trim()) return;
    setTexto('');
    void enviar(t);
  };

  const verFoto = useCallback(
    (uri: string, m: MensajeWA) =>
      setFoto({ uri, titulo: m.mio ? tr('Tú', 'You') : info.grupo ? nombrePersona(m.nombreDe, idioma) : nombre, detalle: `${etiquetaDiaWA(m.hora, Date.now(), idioma)}, ${horaWA(m.hora)}` }),
    [info.grupo, nombre, idioma]
  );
  const verVideo = useCallback((uri: string) => setVideo(uri), []);
  const reintentar = useCallback((t: string) => void enviar(t), [enviar]);

  const anchoMax = Math.min(width * 0.8, 520);
  const hayTexto = !!texto.trim();

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: w.chat }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[s.cabecera, { backgroundColor: w.cabecera, borderBottomColor: w.separador, paddingTop: ins.top + 4 }]}>
        <Pressable onPress={onAtras} accessibilityRole="button" accessibilityLabel={tr('Volver a los chats', 'Back to chats')} style={s.atras} hitSlop={4}>
          <IconoWA nombre="atras" tam={24} color={w.sobreCabecera} grosor={2.2} />
        </Pressable>
        <AvatarWA jid={info.jid} nombre={nombre} grupo={!!info.grupo} tam={40} w={w} tiene={info.foto ?? null} onFoto={(uri) => setFoto({ uri, titulo: nombre, detalle: subtitulo })} />
        <View style={{ flex: 1, marginLeft: 10 }} accessible accessibilityRole="header" accessibilityLabel={subtitulo ? `${nombre}, ${subtitulo}` : nombre}>
          <Text style={[s.nombre, { color: w.sobreCabecera }]} numberOfLines={1}>
            {nombre}
          </Text>
          {subtitulo ? (
            <Text style={[s.subtitulo, { color: w.sobreCabecera2 }]} numberOfLines={1}>
              {subtitulo}
            </Text>
          ) : null}
        </View>
        {digitos ? (
          <>
            {/* Llamar o videollamar se hace en la app de WhatsApp: un solo botón que lo dice (antes eran dos
                que hacían lo mismo: abrir el chat allá). */}
            <Pressable onPress={() => void abrirEnWhatsapp(digitos, nombre)} accessibilityRole="button" accessibilityLabel={tr(`Llamar a ${nombre}: se abre en WhatsApp`, `Call ${nombre}: opens in WhatsApp`)} style={s.boton} hitSlop={2}>
              <IconoWA nombre="llamar" tam={22} color={w.sobreCabecera} />
            </Pressable>
          </>
        ) : null}
      </View>

      {!!error && (
        <View style={[s.banda, { backgroundColor: w.avisoFondo }]}>
          <Text style={{ color: w.aviso, fontSize: 13 }}>{error}</Text>
        </View>
      )}

      {mensajes === null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={w.enviar} size="large" />
        </View>
      ) : !filas.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={[s.chip, { backgroundColor: w.chip }]}>
            <Text style={{ color: w.chipTexto, fontSize: 13, textAlign: 'center' }}>{tr('Todavía no hay mensajes aquí.', 'No messages here yet.')}</Text>
          </View>
        </View>
      ) : (
        <FlatList
          inverted
          data={filas}
          keyExtractor={(f) => f.clave}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 8 }}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={18}
          windowSize={9}
          onEndReached={() => void cargarViejos()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={cargandoViejos ? <ActivityIndicator color={w.enviar} style={{ marginVertical: 12 }} /> : null}
          renderItem={({ item: f }: { item: FilaWA }) =>
            f.tipo === 'dia' ? (
              <View style={[s.chip, { backgroundColor: w.chip }, !p.oscuro && s.sombraChip]}>
                <Text style={{ color: w.chipTexto, fontSize: 12.5, fontWeight: '500' }}>{etiquetaDiaWA(f.ms, Date.now(), idioma)}</Text>
              </View>
            ) : (
              <BurbujaWA f={f} w={w} oscuro={p.oscuro} anchoMax={anchoMax} idioma={idioma} onFoto={verFoto} onVideo={verVideo} onReintentar={reintentar} />
            )
          }
        />
      )}

      <View style={[s.redactor, { paddingBottom: ins.bottom + 6 }]}>
        <View style={[s.caja, { backgroundColor: w.caja }, !p.oscuro && s.sombraChip]}>
          <TextInput
            value={texto}
            onChangeText={setTexto}
            placeholder={tr('Mensaje', 'Message')}
            placeholderTextColor={w.pista}
            multiline
            maxLength={4000}
            style={[s.entrada, fuente('regular'), { color: w.texto }]}
            accessibilityLabel={tr(`Escribe un mensaje para ${nombre}`, `Type a message to ${nombre}`)}
          />
        </View>
        <Pressable
          onPress={mandar}
          disabled={!hayTexto}
          accessibilityRole="button"
          accessibilityLabel={tr('Enviar', 'Send')}
          accessibilityState={{ disabled: !hayTexto }}
          style={({ pressed }) => [s.enviar, { backgroundColor: w.enviar, opacity: hayTexto ? (pressed ? 0.8 : 1) : 0.55 }]}
        >
          <IconoWA nombre="enviar" tam={22} color={w.sobreEnviar} style={{ marginLeft: 3 }} />
        </Pressable>
      </View>

      {foto ? <VisorFoto uri={foto.uri} titulo={foto.titulo} detalle={foto.detalle} onCerrar={() => setFoto(null)} /> : null}
      {video ? <VisorVideo uri={video} onCerrar={() => setVideo(null)} /> : null}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  cabecera: { flexDirection: 'row', alignItems: 'center', paddingLeft: 4, paddingRight: 4, paddingBottom: 8, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  atras: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  nombre: { fontSize: MEDIDA.letra.grande - 1, fontWeight: '700' },
  subtitulo: { fontSize: MEDIDA.letra.chica, marginTop: 1 },
  boton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  banda: { paddingVertical: 8, paddingHorizontal: 16 },
  chip: { alignSelf: 'center', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, marginVertical: 8 },
  sombraChip: { shadowColor: '#0B141A', shadowOpacity: 0.1, shadowRadius: 0.5, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  redactor: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 6, paddingTop: 6 },
  caja: { flex: 1, minHeight: 48, maxHeight: 150, borderRadius: 24, justifyContent: 'center', paddingHorizontal: 16, marginRight: 6 },
  entrada: { fontSize: 16.5, paddingTop: Platform.OS === 'ios' ? 13 : 10, paddingBottom: Platform.OS === 'ios' ? 13 : 10, maxHeight: 146 },
  enviar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
