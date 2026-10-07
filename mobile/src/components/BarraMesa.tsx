/**
 * LA BARRA DE LA MESA: tres botones y nada más (lo pidió José: «no cargar con botones»).
 *
 *   [ Mensajes ]      [ ◉ Hablar ]      [ ··· Más ]
 *
 *  · Mensajes: los chats de PULSE2CHAT (personas y llamadas). Antes decía «Chat» y prometía un chat con el
 *    avatar (auditoría visual del 7-oct, C4); para escribirle al avatar está «Escríbele…» (EscribeleMesa),
 *    justo encima de la barra. Al entrar, el avatar grande se encoge hasta la compañera (avatar3d/presencia.ts).
 *  · Hablar (el grande, al centro): el micrófono. Tocar abre o silencia; su color dice si oye. Con la
 *    conversación en vivo abierta, silencia esa (un solo dueño del audio: compa/duenoAudio.ts).
 *  · Más: una hoja que sube desde abajo con todo lo demás (HojaMas.tsx): conversación en vivo,
 *    cámara, caras, avatar, el recorrido de qué puede hacer y los ajustes.
 *
 * Tres columnas iguales que se reparten el ancho: nada se corta en un teléfono angosto (antes eran
 * cinco píldoras en fila y la primera, «Conversar», quedaba cortada a la izquierda). Todo lo que se
 * toca mide 48 dp o más (el mínimo de Android).
 *
 * ACOSTADO (auditoría del 7-oct, C1): la barra de abajo tapaba el 27 % del alto (la boca del Guardián, la barbilla
 * de ANT-ONIO, la cabeza de Claudio). Ahora es un RIEL vertical en el borde derecho con los mismos tres botones, fuera
 * del recorte de la cámara (insets), y el avatar se queda con todo el alto. «Escríbele…», la sugerencia y «En vivo»
 * van en una fila baja a la izquierda del riel.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tr } from '../i18n';
import { T } from '../tema';
import type { TemaAvatar } from '../avatares/catalogo';
import { Icono } from '../pulse/ui/Icono';
import { Tocable } from '../pulse/ui/Tocable';

export const ALTO_BARRA = 96;
/** El ancho de la tarjeta del riel (acostado). */
export const ANCHO_RIEL = 100;
/** Lo que el riel le quita al ancho de la pantalla (su tarjeta y su margen, fuera del recorte de la cámara). */
export function anchoRiel(insetDerecho: number): number {
  return ANCHO_RIEL + Math.max(10, insetDerecho + 6);
}
type Insets = { top: number; right: number; bottom: number; left: number };
/**
 * La fila baja acostado: dónde empieza (fuera del recorte de la cámara), cuánto mide «Escríbele…» (la mitad de la
 * fila, hasta 440) y a qué altura va. La burbuja de lo que dice el avatar va en la otra mitad, a la misma altura:
 * así no tapa la boca ni la barbilla.
 */
export function filaRiel(ancho: number, ins: Insets): { izquierda: number; derecha: number; abajo: number; anchoEscribir: number } {
  const izquierda = Math.max(16, ins.left + 8);
  const derecha = anchoRiel(ins.right) + 8;
  const fila = Math.max(0, ancho - izquierda - derecha);
  return { izquierda, derecha, abajo: Math.max(10, ins.bottom + 6), anchoEscribir: Math.min(440, Math.round(fila * 0.5)) };
}

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
  /** «Escríbele…» (EscribeleMesa): justo encima de la barra; acostado, en la fila baja. */
  escribir?: ReactNode;
  /** Acostado: el riel vertical a la derecha en vez de la barra de abajo. */
  riel?: boolean;
  /** El alto de lo que ocupa abajo (atajos + píldora + escribir + barra; acostado, la fila baja), para la burbuja. */
  onAlto?: (alto: number) => void;
};

export function BarraMesa(p: Props) {
  const ins = useSafeAreaInsets();
  const { width: anchoVentana } = useWindowDimensions();
  const abierto = !p.micApagado;
  const etiquetaHablar = p.conectando ? tr('Conectando…', 'Connecting…') : abierto ? (p.oyendo ? tr('Te escucho', 'Listening') : tr('Hablar', 'Talk')) : tr('Silenciado', 'Muted');
  const enVivo = p.conversando ? (
    <Tocable onPress={p.onTerminar} etiqueta={tr(`Terminar la conversación en vivo con ${p.nombreAvatar}`, `End the live conversation with ${p.nombreAvatar}`)} style={[s.enVivo, p.riel && s.enVivoRiel, { borderColor: p.tema.acento }]}>
      <View style={[s.puntoVivo, { backgroundColor: p.conectando ? T.aviso : T.activo }]} />
      <Text style={s.enVivoTexto} numberOfLines={1}>
        {p.conectando ? tr('Conectando en vivo…', 'Connecting live…') : tr(`En vivo con ${p.nombreAvatar}`, `Live with ${p.nombreAvatar}`)}
      </Text>
      <Text style={[s.enVivoTerminar, { color: p.tema.acentoTexto }]}>{tr('Terminar', 'End')}</Text>
    </Tocable>
  ) : null;
  const botones = (
    <>
      <Columna etiqueta={tr('Mensajes', 'Messages')} riel={p.riel}>
        <Tocable onPress={p.onChat} vibrar etiqueta={tr('Mensajes: tus chats y llamadas con tu gente', 'Messages: your chats and calls with your people')} style={s.lateral}>
          <Icono nombre="burbujas" tam={26} color={T.texto} grosor={1.9} />
          {p.chatSinLeer ? <View style={[s.aviso, { backgroundColor: p.tema.acento }]} /> : null}
        </Tocable>
      </Columna>
      <Columna etiqueta={etiquetaHablar} activa={abierto} color={p.tema.acentoTexto} riel={p.riel}>
        <Tocable
          onPress={p.onHablar}
          vibrar
          etiqueta={abierto ? tr('Silenciar el micrófono', 'Mute the microphone') : tr('Hablarle: abrir el micrófono', 'Talk: turn on the microphone')}
          style={[s.central, abierto ? { backgroundColor: p.tema.acento } : s.centralApagado, abierto && p.oyendo && { borderColor: T.activo, borderWidth: 3 }]}
        >
          <Icono nombre={abierto ? 'microfono' : 'microfonoNo'} tam={32} color={abierto ? p.tema.sobreAcento : T.texto2} grosor={2} />
        </Tocable>
      </Columna>
      <Columna etiqueta={tr('Más', 'More')} riel={p.riel}>
        <Tocable onPress={p.onMas} vibrar etiqueta={tr('Más opciones: llamada, cámara, caras, avatar, modo y ajustes', 'More options: call, camera, faces, avatar, mode and settings')} style={s.lateral}>
          <Icono nombre="puntos" tam={26} color={T.texto} grosor={1.9} lleno />
        </Tocable>
      </Columna>
    </>
  );

  if (p.riel) {
    // Acostado: el riel a la derecha (fuera del recorte de la cámara) y una fila baja a su izquierda.
    const derecha = Math.max(10, ins.right + 6);
    const f = filaRiel(anchoVentana, ins);
    return (
      <>
        <View style={[s.rielRaiz, { width: anchoRiel(ins.right), paddingRight: derecha, paddingTop: Math.max(8, ins.top), paddingBottom: Math.max(8, ins.bottom) }]} pointerEvents="box-none">
          <View style={s.riel}>{botones}</View>
        </View>
        <View
          style={[s.filaBaja, { left: f.izquierda, right: f.derecha, bottom: f.abajo }]}
          pointerEvents="box-none"
          onLayout={(e) => p.onAlto?.(Math.round(e.nativeEvent.layout.height) + f.abajo)}
        >
          {p.escribir ? <View style={{ width: f.anchoEscribir }}>{p.escribir}</View> : null}
          {enVivo}
          {p.encima ? <View style={s.encimaRiel}>{p.encima}</View> : null}
        </View>
      </>
    );
  }

  return (
    <View style={[s.raiz, { paddingBottom: Math.max(10, ins.bottom) }]} pointerEvents="box-none" onLayout={(e) => p.onAlto?.(Math.round(e.nativeEvent.layout.height))}>
      {p.encima ? <View style={s.encima}>{p.encima}</View> : null}
      {enVivo}
      {p.escribir ? <View style={s.escribir}>{p.escribir}</View> : null}
      <View style={s.barra}>{botones}</View>
    </View>
  );
}

function Columna({ etiqueta, children, activa, color, riel }: { etiqueta: string; children: ReactNode; activa?: boolean; color?: string; riel?: boolean }) {
  return (
    <View style={riel ? s.columnaRiel : s.columna} pointerEvents="box-none">
      {children}
      {/* En el riel (angosto): varias palabras, hasta dos renglones; UNA palabra, un renglón que se achica antes de
          partirse («Mensajes» nunca queda «Mensaje/s»). */}
      <Text
        style={[s.etiqueta, activa && color ? { color } : null]}
        numberOfLines={riel && !/\s/.test(etiqueta) ? 1 : 2}
        adjustsFontSizeToFit={riel && !/\s/.test(etiqueta)}
        minimumFontScale={0.75}
        maxFontSizeMultiplier={riel ? 1.25 : 1.6}
      >
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
  escribir: { marginBottom: 8 },
  // Acostado: el riel ocupa todo el alto a la derecha; la tarjeta va centrada en él.
  rielRaiz: { position: 'absolute', top: 0, bottom: 0, right: 0, alignItems: 'flex-end', justifyContent: 'center' },
  riel: {
    width: ANCHO_RIEL,
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(20,21,23,0.86)',
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  columnaRiel: { alignSelf: 'stretch', alignItems: 'center', gap: 4 },
  filaBaja: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  encimaRiel: { flexShrink: 1 },
  enVivoRiel: { alignSelf: 'auto', marginBottom: 0, flexShrink: 1 },
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
