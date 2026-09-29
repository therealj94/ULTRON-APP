/**
 * El chat de la mesa cuando el avatar va en un cuadro (Guardián o AU-RA con el teléfono derecho).
 *
 * Lo que se dijo en la mesa, como conversación: lo tuyo a la derecha, lo del avatar a la izquierda,
 * lo que estás dictando en gris mientras hablas. Todo con el color del avatar. Encima de la barra,
 * sus atajos; abajo la barra en píldora: escribir, el micrófono (abierto o en silencio) y enviar.
 * Arriba, con quién hablas (tocar cambia de avatar) y el menú.
 */
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { T } from '../tema';
import type { Turn } from '../lib/api';
import { tr } from '../i18n';
import { avatarPorId, type Accion, type AvatarId } from '../avatares/catalogo';
import { AccionesAvatar } from './AccionesAvatar';

type Props = {
  mensajes: Turn[];
  avatar: AvatarId;
  acciones: readonly Accion[];
  onAccion: (pedido: string) => void;
  nombreAvatar: string;
  estado: string;
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
};

export function ChatMesa(p: Props) {
  const lista = useRef<ScrollView>(null);
  useEffect(() => {
    const t = setTimeout(() => lista.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [p.mensajes.length, p.parcial]);

  const toque = () => void Haptics.selectionAsync().catch(() => {});
  const tema = avatarPorId(p.avatar).tema;

  return (
    <View style={s.raiz}>
      <View style={s.cabeza}>
        <Pressable
          onPress={() => {
            toque();
            p.onCambiarAvatar();
          }}
          style={s.quien}
          accessibilityRole="button"
          accessibilityLabel={tr(`Hablando con ${p.nombreAvatar}. Tocar para cambiar de avatar`, `Talking to ${p.nombreAvatar}. Tap to switch avatar`)}
        >
          <View style={[s.punto, { backgroundColor: p.colorEstado }]} />
          <Text style={s.quienNombre}>{p.nombreAvatar}</Text>
          <Text style={s.quienEstado}>· {p.estado}</Text>
          <Text style={[s.cambiar, { color: tema.acentoTexto }]}>{tr('Cambiar', 'Switch')}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            toque();
            p.onMenu();
          }}
          style={s.menu}
          accessibilityRole="button"
          accessibilityLabel={tr('Menú y ajustes', 'Menu and settings')}
          hitSlop={8}
        >
          <View style={s.raya} />
          <View style={s.raya} />
          <View style={s.raya} />
        </Pressable>
      </View>

      <ScrollView ref={lista} style={s.lista} contentContainerStyle={s.listaContenido} keyboardShouldPersistTaps="handled">
        {p.mensajes.length === 0 && !p.parcial ? (
          <Text style={s.vacio}>{tr(`Háblale o escríbele a ${p.nombreAvatar}. Lo que digan queda aquí.`, `Talk or write to ${p.nombreAvatar}. Your conversation stays here.`)}</Text>
        ) : null}
        {p.mensajes.map((m, i) => (
          <View key={i} style={[s.burbuja, m.rol === 'usuario' ? [s.mia, { backgroundColor: tema.acentoFondo }] : s.suya]}>
            <Text style={[s.texto, m.rol === 'usuario' && { color: tema.acentoTexto }]} selectable>
              {m.texto}
            </Text>
          </View>
        ))}
        {!!p.parcial && (
          <View style={[s.burbuja, s.mia, s.parcial, { backgroundColor: tema.acentoFondo }]}>
            <Text style={[s.texto, s.textoParcial]}>{p.parcial}</Text>
          </View>
        )}
      </ScrollView>

      <View style={s.acciones}>
        <AccionesAvatar acciones={p.acciones} tema={tema} onAccion={p.onAccion} />
      </View>

      <View style={s.barra}>
        <TextInput
          value={p.borrador}
          onChangeText={p.onBorrador}
          placeholder={tr(`Escríbele a ${p.nombreAvatar}…`, `Write to ${p.nombreAvatar}…`)}
          placeholderTextColor={T.texto3}
          style={s.entrada}
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
            accessibilityRole="button"
            accessibilityLabel={tr('Enviar', 'Send')}
          >
            <Text style={[s.enviarTexto, { color: tema.sobreAcento }]}>↑</Text>
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
            <View style={[s.micCuerpo, { backgroundColor: p.micSilenciado ? T.texto3 : tema.sobreAcento }]} />
            {p.micSilenciado && <View style={s.micTachado} />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: T.fondo },
  cabeza: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, gap: 10 },
  quien: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.panel, borderRadius: 999, paddingHorizontal: 12, minHeight: 40 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  quienNombre: { color: T.texto, fontSize: 15, fontWeight: '800' },
  quienEstado: { color: T.texto2, fontSize: 13, flexShrink: 1 },
  cambiar: { marginLeft: 'auto', fontSize: 13, fontWeight: '700' },
  menu: { width: 44, height: 40, borderRadius: 20, backgroundColor: T.panel, alignItems: 'center', justifyContent: 'center', gap: 4 },
  raya: { width: 18, height: 2, borderRadius: 1, backgroundColor: T.texto },
  lista: { flex: 1 },
  listaContenido: { padding: 14, gap: 8 },
  vacio: { color: T.texto3, fontSize: 14, textAlign: 'center', marginTop: 20, paddingHorizontal: 20 },
  burbuja: { maxWidth: '86%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  suya: { alignSelf: 'flex-start', backgroundColor: T.panel, borderBottomLeftRadius: 6 },
  mia: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  parcial: { opacity: 0.7 },
  texto: { color: T.texto, fontSize: 15, lineHeight: 21 },
  textoParcial: { fontStyle: 'italic' },
  barra: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, margin: 10, marginTop: 4, padding: 6, paddingLeft: 16, backgroundColor: T.panel, borderRadius: 28, borderWidth: 1, borderColor: T.borde },
  entrada: { flex: 1, color: T.texto, fontSize: 16, maxHeight: 110, paddingVertical: 10 },
  boton: { width: 46, height: 46, borderRadius: 23, backgroundColor: T.fondo2, alignItems: 'center', justifyContent: 'center' },
  micOyendo: { borderWidth: 3, borderColor: T.activo },
  micCuerpo: { width: 12, height: 20, borderRadius: 6 },
  micTachado: { position: 'absolute', width: 26, height: 2.5, borderRadius: 2, backgroundColor: T.aviso, transform: [{ rotate: '-45deg' }] },
  enviarTexto: { fontSize: 22, fontWeight: '800', marginTop: -2 },
  acciones: { paddingTop: 2 },
});
