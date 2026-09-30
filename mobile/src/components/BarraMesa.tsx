/**
 * LA BARRA DE LA MESA: tres botones y nada más (lo pidió José: «no cargar con botones»).
 *
 *   [ Chat ]      [ ◉ Hablar ]      [ ··· Más ]
 *
 *  · Chat: los chats de PULSE2CHAT (personas y llamadas). Al entrar, el avatar grande se encoge
 *    hasta la compañera (avatar3d/presencia.ts, transicionMesa).
 *  · Hablar (el grande, al centro): el micrófono. Tocar abre o silencia; su color dice si oye. Con la
 *    conversación en vivo abierta, silencia esa (un solo dueño del audio: compa/duenoAudio.ts).
 *  · Más: una hoja que sube desde abajo con todo lo demás (HojaMas.tsx): conversación en vivo,
 *    escribir, cámara, caras, avatar, el recorrido de qué puede hacer y los ajustes.
 *
 * Tres columnas iguales que se reparten el ancho: nada se corta en un teléfono angosto (antes eran
 * cinco píldoras en fila y la primera, «Conversar», quedaba cortada a la izquierda). Todo lo que se
 * toca mide 56 dp o más de alto (el mínimo de Android es 48).
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { tr } from '../i18n';
import { T } from '../tema';
import type { TemaAvatar } from '../avatares/catalogo';
import { Icono } from '../pulse/ui/Icono';
import { Tocable } from '../pulse/ui/Tocable';

export const ALTO_BARRA = 96;

type Props = {
  tema: TemaAvatar;
  nombreAvatar: string;
  micApagado: boolean;
  /** El micrófono (de la mesa o de la conversación) está oyendo ahora. */
  oyendo: boolean;
  /** La conversación en vivo está abierta (o conectando). */
  conversando: boolean;
  conectando: boolean;
  onHablar: () => void;
  onChat: () => void;
  onMas: () => void;
  onTerminar: () => void;
  /** Hay avisos sin ver en el chat (un puntito en el botón). */
  chatSinLeer?: boolean;
  /** Lo que va justo encima de la barra, en la misma columna (los atajos): crece con ella y no se encima. */
  encima?: ReactNode;
  /** El alto de toda la columna de abajo (atajos + píldora + barra), para poner la burbuja encima. */
  onAlto?: (alto: number) => void;
};

export function BarraMesa(p: Props) {
  const abierto = !p.micApagado;
  const etiquetaHablar = p.conectando ? tr('Conectando…', 'Connecting…') : abierto ? (p.oyendo ? tr('Te escucho', 'Listening') : tr('Hablar', 'Talk')) : tr('Silenciado', 'Muted');
  return (
    <View style={s.raiz} pointerEvents="box-none" onLayout={(e) => p.onAlto?.(Math.round(e.nativeEvent.layout.height))}>
      {p.encima ? <View style={s.encima}>{p.encima}</View> : null}
      {p.conversando ? (
        <Tocable onPress={p.onTerminar} etiqueta={tr(`Terminar la conversación en vivo con ${p.nombreAvatar}`, `End the live conversation with ${p.nombreAvatar}`)} style={[s.enVivo, { borderColor: p.tema.acento }]}>
          <View style={[s.puntoVivo, { backgroundColor: p.conectando ? T.aviso : T.activo }]} />
          <Text style={s.enVivoTexto} numberOfLines={2}>
            {p.conectando ? tr('Conectando en vivo…', 'Connecting live…') : tr(`En vivo con ${p.nombreAvatar}`, `Live with ${p.nombreAvatar}`)}
          </Text>
          <Text style={[s.enVivoTerminar, { color: p.tema.acentoTexto }]}>{tr('Terminar', 'End')}</Text>
        </Tocable>
      ) : null}
      <View style={s.barra}>
        <Columna etiqueta={tr('Chat', 'Chat')}>
          <Tocable onPress={p.onChat} vibrar etiqueta={tr('Abrir tus chats y llamadas', 'Open your chats and calls')} style={s.lateral}>
            <Icono nombre="burbujas" tam={26} color={T.texto} grosor={1.9} />
            {p.chatSinLeer ? <View style={[s.aviso, { backgroundColor: p.tema.acento }]} /> : null}
          </Tocable>
        </Columna>
        <Columna etiqueta={etiquetaHablar} activa={abierto} color={p.tema.acentoTexto}>
          <Tocable
            onPress={p.onHablar}
            vibrar
            etiqueta={abierto ? tr('Silenciar el micrófono', 'Mute the microphone') : tr('Hablarle: abrir el micrófono', 'Talk: turn on the microphone')}
            style={[s.central, abierto ? { backgroundColor: p.tema.acento } : s.centralApagado, abierto && p.oyendo && { borderColor: T.activo, borderWidth: 3 }]}
          >
            <Icono nombre={abierto ? 'microfono' : 'microfonoNo'} tam={32} color={abierto ? p.tema.sobreAcento : T.texto2} grosor={2} />
          </Tocable>
        </Columna>
        <Columna etiqueta={tr('Más', 'More')}>
          <Tocable onPress={p.onMas} vibrar etiqueta={tr('Más opciones: conversación en vivo, escribir, cámara, caras, avatar, qué puedo hacer y ajustes', 'More: live conversation, type, camera, faces, avatar, what I can do and settings')} style={s.lateral}>
            <Icono nombre="puntos" tam={26} color={T.texto} grosor={1.9} lleno />
          </Tocable>
        </Columna>
      </View>
    </View>
  );
}

function Columna({ etiqueta, children, activa, color }: { etiqueta: string; children: ReactNode; activa?: boolean; color?: string }) {
  return (
    <View style={s.columna} pointerEvents="box-none">
      {children}
      <Text style={[s.etiqueta, activa && color ? { color } : null]} numberOfLines={2}>
        {etiqueta}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 10, alignItems: 'stretch' },
  // Los atajos van de borde a borde (se deslizan de lado): se come el margen de la columna.
  encima: { marginHorizontal: -16, marginBottom: 8 },
  barra: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(20,21,23,0.86)',
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  columna: { flex: 1, alignItems: 'center', gap: 4 },
  lateral: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  central: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  centralApagado: { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)' },
  etiqueta: { color: T.texto2, fontSize: 12.5, fontWeight: '700', maxWidth: '100%', textAlign: 'center' },
  aviso: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: 5 },
  enVivo: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    maxWidth: '100%',
    paddingHorizontal: 16,
    marginBottom: 8,
    borderRadius: 24,
    borderWidth: 1.5,
    backgroundColor: 'rgba(20,21,23,0.9)',
  },
  puntoVivo: { width: 9, height: 9, borderRadius: 5 },
  enVivoTexto: { color: T.texto, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  enVivoTerminar: { fontSize: 14, fontWeight: '800' },
});
