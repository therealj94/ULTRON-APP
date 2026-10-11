/**
 * El chat de la mesa cuando el avatar va en un cuadro (Guardián o AU-RA con el teléfono derecho).
 *
 * Lo que se dijo en la mesa, como conversación: lo tuyo a la derecha, lo del avatar a la izquierda,
 * lo que estás dictando en gris mientras hablas. Todo con el color del avatar. Encima de la barra,
 * sus atajos; abajo la barra en píldora: escribir, el micrófono (abierto o en silencio) y enviar.
 * Arriba, con quién hablas (tocar cambia de avatar) y el menú.
 *
 * La cabecera (auditoría visual del 7-oct, C3): el nombre en UNA línea y el estado debajo, en su propia línea; el
 * nombre nunca se parte («AU-/RA») y el estado no se monta sobre nada. «Cambiar» se fue al menú (Más → Avatar);
 * tocar la cabecera sigue cambiando de avatar. Todo lo que se toca mide 48 dp o más.
 *
 * Un mensaje que no llegó (A10): tu burbuja queda marcada («No se envió») con «Reintentar», que lo vuelve a mandar
 * por el mismo camino.
 *
 * LETRA GRANDE (UX-01, auditoría del 11-oct): sin tope de tamaño (antes 1,3 y 1,4 en la cabecera). Desde
 * `LETRA_GRANDE` (1,6) la cabecera pasa a dos filas —el nombre y el estado a lo ancho; «En vivo» y el menú debajo— y
 * el nombre, el estado, el progreso y «En vivo» parten en renglones en vez de cortarse con «…». La caja de escribir
 * crece con la letra (altoMaxEntrada, la misma de «Escríbele…»).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { T } from '../tema';
import type { Turn } from '../lib/api';
import { tr } from '../i18n';
import { avatarPorId, type Accion, type AvatarId } from '../avatares/catalogo';
import { AccionesAvatar } from './AccionesAvatar';
import { Icono } from '../pulse/ui/Icono';
import { enLista } from './BarraMesa';
import { altoMaxEntrada } from './EscribeleMesa';

type Props = {
  mensajes: Turn[];
  avatar: AvatarId;
  acciones: readonly Accion[];
  onAccion: (pedido: string) => void;
  nombreAvatar: string;
  estado: string;
  /**
   * Lo que está haciendo ahora mientras trabaja («Revisando tu correo…» → «Encontré 2 de Ana»; compa/trabajoMesa.ts):
   * UNA línea suave al final del chat que cambia en su lugar y se va cuando llega la respuesta ('' = nada).
   */
  progreso?: string;
  colorEstado: string;
  parcial: string;
  borrador: string;
  micSilenciado: boolean;
  escuchando: boolean;
  onBorrador: (t: string) => void;
  onEnviar: () => void;
  onMic: () => void;
  onMenu: () => void;
  onCambiarAvatar: () => void;
  /** Conversación fluida: el botón para empezar o terminar, y si está conectando. */
  conversando: boolean;
  conectando: boolean;
  onConversar: () => void;
  /** El texto de tu último mensaje si no llegó (sin conexión o se cortó): se marca y se ofrece «Reintentar». */
  fallido?: string | null;
  onReintentar?: (texto: string) => void;
  /** Para poner el cursor en «Escríbele…» desde «Más → Escribir». */
  entradaRef?: RefObject<TextInput | null>;
};

export function ChatMesa(p: Props) {
  const lista = useRef<ScrollView>(null);
  useEffect(() => {
    const t = setTimeout(() => lista.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [p.mensajes.length, p.parcial, p.progreso]);

  const toque = () => void Haptics.selectionAsync().catch(() => {});
  const { height: altoVentana, fontScale } = useWindowDimensions();
  const grande = enLista(fontScale);
  // Con la letra grande, nada se corta con «…»: parte en los renglones que haga falta.
  const renglones = (normal: number) => (grande ? undefined : normal);
  const tema = avatarPorId(p.avatar).tema;
  // El que falló es TU último mensaje, si es el texto que no llegó (uno nuevo ya no se marca).
  let iFallido = -1;
  if (p.fallido) {
    for (let i = p.mensajes.length - 1; i >= 0; i--) {
      if (p.mensajes[i].rol !== 'usuario') continue;
      if (p.mensajes[i].texto === p.fallido) iFallido = i;
      break;
    }
  }

  return (
    <View style={s.raiz}>
      <View style={[s.cabeza, grande && s.cabezaGrande]}>
        <Pressable
          onPress={() => {
            toque();
            p.onCambiarAvatar();
          }}
          style={[s.quien, grande && s.quienGrande]}
          testID="mesa-avatar"
          accessibilityRole="button"
          accessibilityLabel={tr(`Hablando con ${p.nombreAvatar}. Tocar para cambiar de avatar`, `Talking to ${p.nombreAvatar}. Tap to switch avatar`)}
        >
          <View style={[s.punto, { backgroundColor: p.colorEstado }]} />
          <View style={s.quienTextos}>
            <Text style={s.quienNombre} numberOfLines={renglones(1)}>
              {p.nombreAvatar}
            </Text>
            <Text style={s.quienEstado} numberOfLines={renglones(2)} accessibilityLiveRegion="polite">
              {p.estado}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            toque();
            p.onConversar();
          }}
          style={[s.conversar, grande && s.conversarGrande, p.conversando ? { backgroundColor: tema.acento } : { borderColor: tema.acento, borderWidth: 1.5 }]}
          accessibilityRole="button"
          accessibilityState={{ selected: p.conversando }}
          accessibilityLabel={p.conversando ? tr('Terminar la conversación', 'End the conversation') : tr('Conversar de corrido', 'Talk freely')}
        >
          <Text style={[s.conversarTexto, { color: p.conversando ? tema.sobreAcento : tema.acentoTexto }]} numberOfLines={renglones(1)}>
            {p.conversando ? (p.conectando ? tr('Conectando…', 'Connecting…') : tr('Terminar', 'End')) : tr('En vivo', 'Live')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            toque();
            p.onMenu();
          }}
          style={s.menu}
          testID="mesa-mas"
          accessibilityRole="button"
          accessibilityLabel={tr('Más: cámara, caras, modo, qué puedo hacer y ajustes', 'More: camera, faces, mode, what I can do and settings')}
        >
          <Icono nombre="puntos" tam={22} color={T.texto} grosor={1.9} lleno />
        </Pressable>
      </View>

      <ScrollView ref={lista} testID="mesa-transcripcion" style={s.lista} contentContainerStyle={s.listaContenido} keyboardShouldPersistTaps="handled">
        {p.mensajes.length === 0 && !p.parcial ? (
          <Text style={s.vacio}>{tr(`Háblale o escríbele a ${p.nombreAvatar}. Lo que digan queda aquí.`, `Talk or write to ${p.nombreAvatar}. Your conversation stays here.`)}</Text>
        ) : null}
        {p.mensajes.map((m, i) => (
          <View key={i} style={i === iFallido ? s.filaFallida : undefined}>
            <View testID={m.rol === 'usuario' ? 'mesa-msg-usuario' : 'mesa-msg-avatar'} style={[s.burbuja, m.rol === 'usuario' ? [s.mia, { backgroundColor: tema.acentoFondo }] : s.suya, i === iFallido && s.miaFallida]}>
              <Text style={[s.texto, m.rol === 'usuario' && { color: tema.acentoTexto }]} selectable>
                {m.texto}
              </Text>
            </View>
            {i === iFallido ? (
              <View style={s.falloFila}>
                <Icono nombre="alerta" tam={16} color={T.aviso} grosor={2} />
                <Text style={s.falloTexto}>{tr('No se envió', 'Not sent')}</Text>
                {p.onReintentar ? (
                  <Pressable
                    onPress={() => {
                      toque();
                      p.onReintentar?.(m.texto);
                    }}
                    style={[s.reintentar, { borderColor: T.aviso }]}
                    testID="mesa-reintentar"
                    accessibilityRole="button"
                    accessibilityLabel={tr('Reintentar: mandar otra vez tu mensaje', 'Retry: send your message again')}
                  >
                    <Text style={s.reintentarTexto}>{tr('Reintentar', 'Retry')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
        {!!p.parcial && (
          <View style={[s.burbuja, s.mia, s.parcial, { backgroundColor: tema.acentoFondo }]}>
            <Text style={[s.texto, s.textoParcial]}>{p.parcial}</Text>
          </View>
        )}
        {!!p.progreso && (
          <View style={s.progreso} accessibilityLiveRegion="polite">
            <View style={[s.progresoPunto, { backgroundColor: tema.acento }]} />
            <Text style={s.progresoTexto} numberOfLines={renglones(1)}>
              {p.progreso}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={s.acciones}>
        <AccionesAvatar acciones={p.acciones} tema={tema} onAccion={p.onAccion} />
      </View>

      <View style={s.barra}>
        <TextInput
          ref={p.entradaRef}
          value={p.borrador}
          onChangeText={p.onBorrador}
          placeholder={tr(`Escríbele a ${p.nombreAvatar}…`, `Write to ${p.nombreAvatar}…`)}
          placeholderTextColor={T.texto3}
          style={[s.entrada, { maxHeight: Math.max(110, altoMaxEntrada(altoVentana, fontScale)) }]}
          testID="mesa-entrada"
          multiline
          onSubmitEditing={p.onEnviar}
          blurOnSubmit
          returnKeyType="send"
          accessibilityLabel={tr('Mensaje', 'Message')}
        />
        {p.borrador.trim() ? (
          <Pressable
            onPress={() => {
              toque();
              p.onEnviar();
            }}
            style={[s.boton, { backgroundColor: tema.acento }]}
            testID="mesa-enviar"
            accessibilityRole="button"
            accessibilityLabel={tr('Enviar', 'Send')}
          >
            <Icono nombre="enviar" tam={22} color={tema.sobreAcento} grosor={2} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              toque();
              p.onMic();
            }}
            style={[s.boton, !p.micSilenciado && { backgroundColor: tema.acento }, p.escuchando && !p.micSilenciado && s.micOyendo]}
            accessibilityRole="button"
            accessibilityLabel={p.micSilenciado ? tr('Activar el micrófono', 'Turn on the microphone') : tr('Silenciar el micrófono', 'Mute the microphone')}
          >
            <Icono nombre={p.micSilenciado ? 'microfonoNo' : 'microfono'} tam={24} color={p.micSilenciado ? T.texto2 : tema.sobreAcento} grosor={2} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: T.fondo },
  cabeza: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, gap: 10 },
  // Letra grande: el nombre y el estado a lo ancho, en su fila; «En vivo» (que se estira) y el menú en la de abajo.
  cabezaGrande: { flexWrap: 'wrap' },
  quienGrande: { flexBasis: '100%', paddingVertical: 8 },
  conversarGrande: { flexGrow: 1, flexShrink: 1, paddingVertical: 8 },
  quien: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.panel, borderRadius: 24, paddingHorizontal: 14, paddingVertical: 4, minHeight: 48 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  quienTextos: { flex: 1, minWidth: 0 },
  quienNombre: { color: T.texto, fontSize: 15, fontWeight: '800', lineHeight: 19 },
  quienEstado: { color: T.texto2, fontSize: 12.5, lineHeight: 16 },
  conversar: { minHeight: 48, borderRadius: 24, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  conversarTexto: { fontSize: 14, fontWeight: '800' },
  menu: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.panel, alignItems: 'center', justifyContent: 'center' },
  lista: { flex: 1 },
  listaContenido: { padding: 14, gap: 8 },
  vacio: { color: T.texto3, fontSize: 14, textAlign: 'center', marginTop: 20, paddingHorizontal: 20 },
  burbuja: { maxWidth: '86%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  suya: { alignSelf: 'flex-start', backgroundColor: T.panel, borderBottomLeftRadius: 6 },
  mia: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  parcial: { opacity: 0.7 },
  texto: { color: T.texto, fontSize: 15, lineHeight: 21 },
  textoParcial: { fontStyle: 'italic' },
  progreso: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 2, maxWidth: '90%' },
  progresoPunto: { width: 6, height: 6, borderRadius: 3, opacity: 0.7 },
  progresoTexto: { color: T.texto2, fontSize: 13, fontStyle: 'italic', flexShrink: 1 },
  barra: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, margin: 10, marginTop: 4, padding: 6, paddingLeft: 16, backgroundColor: T.panel, borderRadius: 28, borderWidth: 1, borderColor: T.borde },
  entrada: { flex: 1, color: T.texto, fontSize: 16, paddingVertical: 10 },
  boton: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.fondo2, alignItems: 'center', justifyContent: 'center' },
  micOyendo: { borderWidth: 3, borderColor: T.activo },
  filaFallida: { alignItems: 'flex-end', gap: 4 },
  miaFallida: { borderWidth: 1.5, borderColor: T.aviso },
  falloFila: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  falloTexto: { color: T.aviso, fontSize: 13, fontWeight: '700' },
  reintentar: { minHeight: 48, paddingHorizontal: 16, borderRadius: 24, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  reintentarTexto: { color: T.texto, fontSize: 14, fontWeight: '800' },
  acciones: { paddingTop: 2 },
});
