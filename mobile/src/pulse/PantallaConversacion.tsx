/**
 * LA CONVERSACIÓN con alguien (5.0): burbujas agrupadas con cola, separadores de día, hora y
 * palomitas de leído, «escribiendo…», la insignia del cifrado con el código de seguridad, fotos en
 * grande, y la caja de escribir que crece con el texto y cuyo botón Enviar se vuelve una palomita ✔.
 *
 * El borrador vive en `borradores.ts`, no aquí: así lo que AURA redacta por voz («escríbele a Beto
 * que llego tarde») aparece en esta misma caja, RESALTADO con un brillo dorado suave hasta que se
 * envía o la persona lo toca.
 *
 * Desacoplada de la navegación: `con` (correo), `nombre` si ya se sabe, y `onAtras`. Avisa al bus
 * (`pantalla`) al abrirse y al cerrarse, para que AURA sepa en qué chat está la persona.
 *
 * AURA puede estar al lado mientras se chatea (avatar3d/DockAura.tsx): el botón de la cabecera la
 * acopla o la devuelve a caminar; acoplada, empuja el hilo (franja arriba o panel a la derecha) sin
 * tapar la caja de escribir.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sueloCompa } from '../compa/canales';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { cancelAnimation, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { emitir } from '../nucleo/contrato';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { tr, useIdioma } from '../i18n';
import * as RELEVO from './relevo';
import * as CHATS from './chats';
import * as LLAMADA from './llamada';
import { escribirBorrador, fijarChatAbierto, soltarChatAbierto, useBorrador } from './borradores';
import { usePulseSiHay } from './PulseProvider';
import { Avatar } from './ui/Avatar';
import { BotonEnviar } from './ui/BotonEnviar';
import { Burbuja } from './ui/Burbuja';
import { Escribiendo } from './ui/Escribiendo';
import { Icono } from './ui/Icono';
import { Tocable } from './ui/Tocable';
import { filasDelHilo, type Fila } from './ui/formato';
import { AuraAlLado, BotonAuraAlLado } from '../avatar3d/DockAura';
import { abrirPagar } from '../cartera/estado';

export type PropsPantallaConversacion = {
  /** Correo de la otra persona. */
  con: string;
  /** Su nombre, si quien abre ya lo sabe (si no, sale de la lista o del correo). */
  nombre?: string;
  onAtras: () => void;
};

export function PantallaConversacion({ con, nombre, onAtras }: PropsPantallaConversacion) {
  useIdioma();
  const p = useTema();
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const correo = String(con || '').toLowerCase();
  // Al salir del hilo, la compañera vuelve a su suelo de siempre.
  useEffect(() => () => sueloCompa.emitir(88), []);
  const pulse = usePulseSiHay();
  const yo = (pulse ? pulse.cuenta : RELEVO.quien())?.correo || '';

  const hilo = CHATS.useHilo(correo);
  const lista = CHATS.useListaQuieta();
  const escriben = CHATS.useEscribiendo();
  const borrador = useBorrador(correo);

  const persona = useMemo(
    () => (lista.conversaciones || []).find((c) => c.correo === correo) || (lista.circulo?.amigos || []).find((a) => a.correo === correo) || null,
    [lista, correo],
  );
  const nombreVisto = nombre || persona?.nombre || correo.split('@')[0];
  const escribe = CHATS.estaEscribiendo(escriben, correo);
  const texto = borrador?.texto || '';
  const deVoz = !!borrador?.deVoz && !!texto;
  const ocupado = pulse ? pulse.llamada.estado !== 'libre' : LLAMADA.enLlamada();

  const [aviso, setAviso] = useState('');
  const [codigo, setCodigo] = useState<string | null | undefined>(undefined);
  const [visor, setVisor] = useState<string | null>(null);
  const [abajo, setAbajo] = useState(false);
  const [teclado, setTeclado] = useState(false);
  const listaRef = useRef<FlatList<Fila>>(null);

  // Este es el chat abierto: lo sabe la voz (a quién va «envíalo») y el bus (el contexto de AURA).
  const nombreRef = useRef(nombreVisto);
  nombreRef.current = nombreVisto;
  useEffect(() => {
    fijarChatAbierto({ correo, nombre: nombreRef.current });
    emitir('pantalla', {
      pantalla: 'chats',
      chatAbierto: { correo, nombre: nombreRef.current },
    });
    return () => {
      soltarChatAbierto(correo);
      emitir('pantalla', { pantalla: 'chats', chatAbierto: null });
    };
  }, [correo]);
  const primerNombre = useRef(true);
  useEffect(() => {
    if (primerNombre.current) {
      primerNombre.current = false;
      return;
    }
    fijarChatAbierto({ correo, nombre: nombreVisto });
    emitir('pantalla', {
      pantalla: 'chats',
      chatAbierto: { correo, nombre: nombreVisto },
    });
  }, [correo, nombreVisto]);

  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setTeclado(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setTeclado(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  const filas = useMemo(() => filasDelHilo(hilo.mensajes || [], yo, hilo.leidoHasta), [hilo.mensajes, yo, hilo.leidoHasta]);
  const anchoMax = Math.min(520, Math.round(width * 0.78));

  const enviar = () => {
    const t = texto.trim();
    if (!t) return;
    escribirBorrador(correo, '');
    listaRef.current?.scrollToOffset({ offset: 0, animated: true });
    void CHATS.enviarTexto(correo, t).then((r) => {
      if (!r.ok) {
        if (r.code === 403)
          setAviso(tr(`Hace falta que ${nombreVisto} te acepte para escribirle.`, `${nombreVisto} needs to accept you before you can write.`));
        else if (r.motivo === 'sin-cuenta') setAviso(tr('El chat no está conectado.', 'The chat isn’t connected.'));
        // Sin aparatos del otro lado no se cifra, y sin cifrar no sale: queda en el hilo para reintentar.
        else if (r.motivo === 'sin-aparatos')
          setAviso(
            tr(
              `No lo envié: ${nombreVisto} todavía no abrió el chat en ningún aparato y no puedo cifrarlo. Queda aquí para reintentar.`,
              `Not sent: ${nombreVisto} hasn’t opened the chat on any device yet, so I can’t encrypt it. It stays here to retry.`,
            ),
          );
      } else if (!r.e2e) {
        setAviso(
          tr(
            `Salió sin cifrar: ${nombreVisto} todavía no abrió el chat en ningún aparato.`,
            `Sent unencrypted: ${nombreVisto} hasn’t opened the chat on any device yet.`,
          ),
        );
      }
    });
  };

  const reintentar = useCallback((id: string) => void CHATS.reintentar(correo, id), [correo]);
  const descartar = useCallback((id: string) => CHATS.descartarFallido(correo, id), [correo]);
  const verFoto = useCallback((uri: string) => setVisor(uri), []);

  const verCodigo = async () => {
    setCodigo(null);
    const c = await RELEVO.codigoCon(correo).catch(() => null);
    setCodigo(c || '');
  };

  const llamar = (video: boolean) => {
    Keyboard.dismiss();
    void Promise.resolve(LLAMADA.llamar(correo, video)).catch(() => undefined);
  };

  const alDesplazar = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const lejos = e.nativeEvent.contentOffset.y > 320;
    if (lejos !== abajo) setAbajo(lejos);
  };

  const render = useCallback(
    ({ item }: { item: Fila }) =>
      item.tipo === 'dia' ? (
        <View style={s.dia}>
          <Text style={s.diaTxt}>{item.texto}</Text>
        </View>
      ) : (
        <Burbuja fila={item} anchoMax={anchoMax} onReintentar={reintentar} onDescartar={descartar} onVerFoto={verFoto} />
      ),
    [s, anchoMax, reintentar, descartar, verFoto],
  );

  const subtitulo = escribe ? tr('escribiendo…', 'typing…') : hilo.enLinea ? tr('en línea', 'online') : tr('cifrado de punta a punta', 'end-to-end encrypted');

  const insigniaCifrado = (
    <View style={{ paddingTop: MEDIDA.espacio.l }}>
      {hilo.cargandoAntes ? <ActivityIndicator color={p.acento} style={{ marginBottom: MEDIDA.espacio.m }} /> : null}
      {!hilo.hayMas ? (
        <Pressable
          onPress={() => void verCodigo()}
          style={s.insignia}
          accessibilityRole="button"
          accessibilityLabel={tr('Ver el código de seguridad', 'View security code')}
        >
          <Icono nombre="candado" tam={14} color={p.acentoTexto} grosor={2.2} />
          <Text style={s.insigniaTxt}>
            {tr(
              'Los mensajes van cifrados de punta a punta: nadie más, ni el relevo, puede leerlos. Toca para ver el código de seguridad.',
              'Messages are end-to-end encrypted: no one else, not even the relay, can read them. Tap to see the security code.',
            )}
          </Text>
        </Pressable>
      ) : null}
      {hilo.mensajes && !hilo.mensajes.length ? (
        <Text style={s.saludo}>{tr(`Escríbele el primer mensaje a ${nombreVisto}.`, `Write the first message to ${nombreVisto}.`)}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: p.fondo }}>
      {/* la cabecera */}
      <View style={[s.cabecera, { paddingTop: ins.top + MEDIDA.espacio.xs }]}>
        <Tocable onPress={onAtras} etiqueta={tr('Volver', 'Back')} hitSlop={8} style={s.botonCab}>
          <Icono nombre="atras" color={p.texto} tam={24} grosor={2} />
        </Tocable>
        <Pressable onPress={() => void verCodigo()} style={s.quien} accessibilityRole="button" accessibilityLabel={nombreVisto}>
          <Avatar nombre={nombreVisto} foto={persona?.foto} tam={40} enLinea={hilo.enLinea} />
          <View style={{ flex: 1, marginLeft: MEDIDA.espacio.m }}>
            <Text style={s.nombre} numberOfLines={1}>
              {nombreVisto}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 1,
              }}
            >
              {!escribe && !hilo.enLinea ? <Icono nombre="candado" tam={11} color={p.texto3} grosor={2.2} style={{ marginRight: 4 }} /> : null}
              <Text style={[s.sub, escribe && { color: p.acentoTexto, fontStyle: 'italic' }, hilo.enLinea && !escribe && { color: p.exito }]} numberOfLines={1}>
                {subtitulo}
              </Text>
            </View>
          </View>
        </Pressable>
        <BotonAuraAlLado color={p.texto2} colorActivo={p.acentoTexto} />
        {/* Enviar dinero (cartera/HojaPagar.tsx): la dirección sale de su ficha y se firma en Veta Wallet. */}
        <Tocable
          onPress={() => {
            Keyboard.dismiss();
            abrirPagar({ correo, nombre: nombreVisto });
          }}
          etiqueta={tr('Enviar dinero', 'Send money')}
          hitSlop={4}
          style={s.botonCab}
        >
          <Icono nombre="dinero" color={p.acentoTexto} tam={23} grosor={1.9} />
        </Tocable>
        <Tocable onPress={() => llamar(true)} deshabilitado={ocupado} etiqueta={tr('Videollamada', 'Video call')} hitSlop={4} style={s.botonCab}>
          <Icono nombre="video" color={p.acentoTexto} tam={24} grosor={1.9} />
        </Tocable>
        <Tocable onPress={() => llamar(false)} deshabilitado={ocupado} etiqueta={tr('Llamar', 'Call')} hitSlop={4} style={s.botonCab}>
          <Icono nombre="llamar" color={p.acentoTexto} tam={22} grosor={1.9} />
        </Tocable>
      </View>

      <AuraAlLado pantalla="chats" chat={correo}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {hilo.error === 'sin-permiso' || hilo.error === 'sin-red' || aviso ? (
          <View style={s.banda}>
            <Text style={s.bandaTxt}>
              {aviso ||
                (hilo.error === 'sin-permiso'
                  ? tr(`Hace falta que ${nombreVisto} te acepte para escribirle.`, `${nombreVisto} needs to accept you before you can write.`)
                  : tr('Sin conexión con el chat. Reintentando…', 'No connection to the chat. Retrying…'))}
            </Text>
          </View>
        ) : null}

        {/* el hilo */}
        {hilo.mensajes === null ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={p.acento} />
          </View>
        ) : (
          <FlatList
            ref={listaRef}
            style={{ flex: 1 }}
            inverted
            data={filas}
            keyExtractor={(f) => f.clave}
            renderItem={render}
            contentContainerStyle={{
              paddingHorizontal: MEDIDA.espacio.m + 2,
              paddingBottom: MEDIDA.espacio.m,
            }}
            ListHeaderComponent={escribe ? <Escribiendo /> : null}
            ListFooterComponent={insigniaCifrado}
            onEndReached={() => hilo.hayMas && void CHATS.cargarAnteriores(correo)}
            onEndReachedThreshold={0.4}
            onScroll={alDesplazar}
            scrollEventThrottle={64}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            maintainVisibleContentPosition={Platform.OS === 'ios' ? { minIndexForVisible: 1 } : undefined}
            initialNumToRender={18}
            windowSize={11}
          />
        )}

        {abajo ? (
          <Animated.View entering={FadeIn.duration(MEDIDA.duracion.rapida)} exiting={FadeOut.duration(MEDIDA.duracion.rapida)} style={s.bajarCaja}>
            <Tocable
              onPress={() => listaRef.current?.scrollToOffset({ offset: 0, animated: true })}
              etiqueta={tr('Ir al último mensaje', 'Go to the latest message')}
              style={s.bajar}
            >
              <Icono nombre="abajo" tam={22} color={p.texto} grosor={2.2} />
            </Tocable>
          </Animated.View>
        ) : null}

        {/* escribir */}
        {deVoz ? (
          <Animated.View entering={FadeIn.duration(MEDIDA.duracion.normal)} style={s.deVoz}>
            <Icono nombre="chispa" tam={13} color={p.acentoTexto} lleno />
            <Text style={s.deVozTxt}>{tr('AURA lo escribió por ti · revísalo y envíalo', 'AURA wrote this for you · review and send')}</Text>
          </Animated.View>
        ) : null}
        <View
          style={[s.componer, { paddingBottom: (teclado ? 0 : ins.bottom) + MEDIDA.espacio.s }]}
          // La compañera AURA flota encima de todo: que no tape la barra de escribir (el teclado se suma solo).
          onLayout={(e) => sueloCompa.emitir(Math.round(e.nativeEvent.layout.height) + 12)}
        >
          <View style={{ flex: 1 }}>
            {deVoz ? <Brillo p={p} /> : null}
            <View style={[s.caja, deVoz && { borderColor: p.acento, borderWidth: 1.5 }]}>
              <TextInput
                value={texto}
                onChangeText={(v) => {
                  escribirBorrador(correo, v);
                  if (v.trim()) RELEVO.escribiendo(correo);
                }}
                placeholder={tr('Mensaje', 'Message')}
                placeholderTextColor={p.texto3}
                multiline
                maxLength={4000}
                style={s.entrada}
                accessibilityLabel={tr('Escribe un mensaje', 'Write a message')}
              />
            </View>
          </View>
          <View style={{ marginLeft: MEDIDA.espacio.s, marginBottom: 1 }}>
            <BotonEnviar activo={!!texto.trim()} onEnviar={enviar} />
          </View>
        </View>
      </KeyboardAvoidingView>
      </AuraAlLado>

      {/* el código de seguridad */}
      {codigo !== undefined ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setCodigo(undefined)}>
          <Pressable
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: p.velo,
                justifyContent: 'center',
                padding: MEDIDA.espacio.xl,
              },
            ]}
            onPress={() => setCodigo(undefined)}
          >
            <Pressable style={s.tarjetaCodigo} onPress={() => undefined}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Avatar nombre={nombreVisto} foto={persona?.foto} tam={44} />
                <View style={{ marginLeft: MEDIDA.espacio.m, flex: 1 }}>
                  <Text style={s.nombre} numberOfLines={1}>
                    {nombreVisto}
                  </Text>
                  <Text style={s.sub} numberOfLines={1}>
                    {correo}
                  </Text>
                </View>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: MEDIDA.espacio.l,
                }}
              >
                <Icono nombre="escudo" tam={20} color={p.exito} grosor={2} />
                <Text
                  style={[
                    s.nombre,
                    {
                      marginLeft: MEDIDA.espacio.s,
                      fontSize: MEDIDA.letra.cuerpo + 1,
                    },
                  ]}
                >
                  {tr('Código de seguridad', 'Security code')}
                </Text>
              </View>
              {codigo === null ? (
                <ActivityIndicator color={p.acento} style={{ marginVertical: MEDIDA.espacio.xl }} />
              ) : codigo ? (
                <Text style={s.codigo} selectable>
                  {codigo.split(/\s+/).reduce((acc, g, i) => acc + (i === 0 ? '' : i % 4 === 0 ? '\n' : '  ') + g, '')}
                </Text>
              ) : (
                <Text
                  style={[
                    s.sub,
                    {
                      marginVertical: MEDIDA.espacio.l,
                      fontSize: MEDIDA.letra.cuerpo,
                    },
                  ]}
                >
                  {tr('Todavía no se puede: a alguno de los dos le falta publicar su llave.', 'Not yet: one of you hasn’t published a key.')}
                </Text>
              )}
              <Text style={[s.sub, { lineHeight: 19 }]}>
                {tr(
                  'Compáralo con el que ve la otra persona en su teléfono. Si coincide, nadie se metió en medio.',
                  'Compare it with the one the other person sees on their phone. If it matches, no one is in between.',
                )}
              </Text>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* la foto en grande */}
      {visor ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setVisor(null)}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <Image source={{ uri: visor }} style={{ flex: 1 }} resizeMode="contain" />
            <Tocable
              onPress={() => setVisor(null)}
              etiqueta={tr('Cerrar', 'Close')}
              caja={{
                position: 'absolute',
                top: ins.top + MEDIDA.espacio.s,
                left: MEDIDA.espacio.s,
              }}
              style={s.botonCab}
            >
              <Icono nombre="cerrar" tam={24} color="#fff" grosor={2.2} />
            </Tocable>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

/** El brillo dorado suave detrás de un borrador que escribió AURA: late despacio hasta que se toca. */
function Brillo({ p }: { p: Paleta }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })), -1);
    return () => cancelAnimation(v);
  }, [v]);
  const st = useAnimatedStyle(
    () => ({
      opacity: 0.16 + v.value * 0.22,
      transform: [{ scaleX: 1 + v.value * 0.015 }, { scaleY: 1 + v.value * 0.08 }],
    }),
    [v],
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          margin: -5,
          borderRadius: MEDIDA.radio.l + 5,
          backgroundColor: p.acento,
        },
        st,
      ]}
    />
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    cabecera: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: MEDIDA.espacio.xs,
      paddingBottom: MEDIDA.espacio.s,
      backgroundColor: p.fondo2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.borde,
    },
    botonCab: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quien: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 2,
    },
    nombre: {
      color: p.texto,
      fontSize: MEDIDA.letra.grande,
      fontWeight: '700',
    },
    sub: { color: p.texto3, fontSize: MEDIDA.letra.chica },
    banda: {
      backgroundColor: p.avisoFondo,
      paddingVertical: MEDIDA.espacio.s,
      paddingHorizontal: MEDIDA.espacio.l,
    },
    bandaTxt: {
      color: p.aviso,
      fontSize: MEDIDA.letra.chica + 1,
      fontWeight: '600',
      lineHeight: 18,
    },
    dia: {
      alignSelf: 'center',
      backgroundColor: p.superficie2,
      borderRadius: MEDIDA.radio.redondo,
      paddingHorizontal: MEDIDA.espacio.m,
      paddingVertical: 5,
      marginVertical: MEDIDA.espacio.m,
    },
    diaTxt: {
      color: p.texto2,
      fontSize: MEDIDA.letra.chica,
      fontWeight: '600',
    },
    insignia: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      alignSelf: 'center',
      maxWidth: 340,
      gap: MEDIDA.espacio.s,
      backgroundColor: p.acentoFondo,
      borderRadius: MEDIDA.radio.m,
      paddingHorizontal: MEDIDA.espacio.m,
      paddingVertical: MEDIDA.espacio.s + 2,
      marginBottom: MEDIDA.espacio.s,
    },
    insigniaTxt: {
      flex: 1,
      color: p.acentoTexto,
      fontSize: MEDIDA.letra.chica,
      lineHeight: 17,
      textAlign: 'center',
    },
    saludo: {
      color: p.texto3,
      fontSize: MEDIDA.letra.cuerpo - 1,
      textAlign: 'center',
      marginTop: MEDIDA.espacio.l,
    },
    bajarCaja: { position: 'absolute', right: MEDIDA.espacio.l, bottom: 86 },
    bajar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: p.superficie,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.borde,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    deVoz: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      marginLeft: MEDIDA.espacio.l,
      marginBottom: 2,
      gap: 6,
    },
    deVozTxt: {
      color: p.acentoTexto,
      fontSize: MEDIDA.letra.chica,
      fontWeight: '600',
    },
    componer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: MEDIDA.espacio.s + 2,
      paddingTop: MEDIDA.espacio.s,
      backgroundColor: p.fondo,
    },
    caja: {
      minHeight: 46,
      borderRadius: MEDIDA.radio.l,
      backgroundColor: p.superficie,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.borde,
      justifyContent: 'center',
    },
    entrada: {
      color: p.texto,
      fontSize: MEDIDA.letra.cuerpo + 1,
      lineHeight: 21,
      maxHeight: 140,
      paddingHorizontal: MEDIDA.espacio.l,
      paddingTop: Platform.OS === 'ios' ? 12 : 10,
      paddingBottom: Platform.OS === 'ios' ? 12 : 10,
      textAlignVertical: 'center',
    },
    tarjetaCodigo: {
      backgroundColor: p.superficie,
      borderRadius: MEDIDA.radio.l,
      padding: MEDIDA.espacio.xl,
    },
    codigo: {
      color: p.texto,
      fontSize: MEDIDA.letra.cuerpo,
      lineHeight: 28,
      letterSpacing: 0.5,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      textAlign: 'center',
      marginVertical: MEDIDA.espacio.l,
    },
  });
}
