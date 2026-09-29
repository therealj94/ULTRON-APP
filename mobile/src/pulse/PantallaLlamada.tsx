/**
 * La pantalla de una llamada de PULSE2CHAT: entrante, sonando, conectando y en curso.
 *
 * Encima de todo (la pinta PulseProvider), porque una llamada no espera a que abras el chat. Con
 * video, el del otro ocupa la pantalla y el propio va en un recuadro; con voz, su nombre y el tiempo.
 * Al colgar se dice POR QUÉ terminó —no es lo mismo «colgó» que «no hubo camino de red»— y se va sola.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { RTCView } from '@livekit/react-native-webrtc';
import * as LLAMADA from './llamada';
import { T } from '../tema';
import { tr } from '../i18n';

const RAZON: Record<LLAMADA.Motivo, () => string> = {
  yo: () => tr('Llamada terminada', 'Call ended'),
  'el-otro': () => tr('La otra persona colgó', 'The other person hung up'),
  rechazada: () => tr('No contestó', 'Declined'),
  ocupado: () => tr('Está en otra llamada', 'On another call'),
  'sin-camino': () => tr('No hubo camino de red entre los dos', 'No network path between you'),
  corte: () => tr('Se cortó la conexión', 'The connection dropped'),
  'no-se-pudo': () => tr('No se pudo abrir la llamada', 'Couldn’t start the call'),
  'sin-permiso': () => tr('Hace falta permiso de micrófono (y cámara para video)', 'Microphone (and camera for video) permission needed'),
  'en-otro-aparato': () => tr('Contestaste en otro aparato', 'Answered on another device'),
};

const nombreDe = (correo: string | null) => (correo ? correo.split('@')[0] : '');

export function PantallaLlamada({ cuento: c, onListo }: { cuento: LLAMADA.Cuento; onListo: () => void }) {
  const [segundos, setSegundos] = useState(0);
  const terminada = c.estado === 'libre' && !!c.motivo;

  useEffect(() => {
    if (c.estado !== 'hablando') return;
    setSegundos(0);
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [c.estado]);

  // El aviso de cómo terminó se queda un momento y se va solo.
  useEffect(() => {
    if (!terminada) return;
    const t = setTimeout(onListo, c.motivo === 'yo' || c.motivo === 'en-otro-aparato' ? 900 : 2600);
    return () => clearTimeout(t);
  }, [terminada, c.motivo, onListo]);

  const reloj = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
  const quien = nombreDe(c.conQuien || c.entrante?.de || null);
  const conVideoRemoto = !!c.flujoRemoto && c.hayVideo;
  const leyenda = terminada
    ? RAZON[c.motivo as LLAMADA.Motivo]?.() || ''
    : c.estado === 'entrando'
      ? c.entrante?.video
        ? tr('Videollamada entrante', 'Incoming video call')
        : tr('Llamada entrante', 'Incoming call')
      : c.estado === 'llamando'
        ? tr('Sonando…', 'Ringing…')
        : c.estado === 'conectando'
          ? tr('Conectando…', 'Connecting…')
          : reloj;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => (c.estado === 'entrando' ? LLAMADA.rechazar() : undefined)} statusBarTranslucent>
      <View style={s.fondo}>
        {conVideoRemoto && <RTCView streamURL={(c.flujoRemoto as any).toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />}
        {c.hayVideo && c.flujoLocal && c.estado !== 'libre' && (
          <RTCView streamURL={(c.flujoLocal as any).toURL()} style={s.propio} objectFit="cover" mirror zOrder={1} />
        )}

        <View style={s.arriba} pointerEvents="none">
          {!conVideoRemoto && (
            <View style={s.inicial}>
              <Text style={s.inicialTxt}>{(quien[0] || '?').toUpperCase()}</Text>
            </View>
          )}
          <Text style={s.nombre}>{quien}</Text>
          <Text style={s.leyenda}>{leyenda}</Text>
          <Text style={s.cifrado}>{tr('PULSE2CHAT · cifrada de punta a punta', 'PULSE2CHAT · end-to-end encrypted')}</Text>
        </View>

        {!terminada && (
          <View style={s.abajo}>
            {c.estado === 'entrando' ? (
              <View style={s.fila}>
                <Circulo color={T.aviso} icono="✕" etiqueta={tr('Rechazar', 'Decline')} onPress={() => LLAMADA.rechazar()} />
                <Circulo color={T.activo} icono="📞" etiqueta={tr('Voz', 'Voice')} onPress={() => void LLAMADA.contestar(false).catch(() => {})} />
                {c.entrante?.video && <Circulo color={T.principal} icono="🎥" etiqueta={tr('Video', 'Video')} onPress={() => void LLAMADA.contestar(true).catch(() => {})} />}
              </View>
            ) : (
              <View style={s.fila}>
                <Circulo apagado={!c.micAbierto} icono={c.micAbierto ? '🎙' : '🔇'} etiqueta={c.micAbierto ? tr('Silenciar', 'Mute') : tr('Activar', 'Unmute')} onPress={() => LLAMADA.micro()} />
                {c.hayVideo && <Circulo apagado={!c.camAbierta} icono="📷" etiqueta={tr('Cámara', 'Camera')} onPress={() => LLAMADA.camara()} />}
                {c.hayVideo && <Circulo icono="🔄" etiqueta={tr('Voltear', 'Flip')} onPress={() => LLAMADA.voltear()} />}
                <Circulo apagado={!c.porAltavoz} icono="🔊" etiqueta={tr('Altavoz', 'Speaker')} onPress={() => void LLAMADA.altavoz()} />
                <Circulo color={T.aviso} icono="✕" etiqueta={tr('Colgar', 'Hang up')} onPress={() => LLAMADA.colgar('yo')} />
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

function Circulo({ icono, etiqueta, onPress, color, apagado }: { icono: string; etiqueta: string; onPress: () => void; color?: string; apagado?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={etiqueta} style={s.boton}>
      <View style={[s.circulo, { backgroundColor: color || (apagado ? T.panel : 'rgba(236,232,226,0.18)') }]}>
        <Text style={s.icono}>{icono}</Text>
      </View>
      <Text style={s.etiqueta}>{etiqueta}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#15171A' },
  propio: { position: 'absolute', top: 54, right: 16, width: 110, height: 160, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  arriba: { position: 'absolute', top: 90, left: 16, right: 16, alignItems: 'center' },
  inicial: { width: 112, height: 112, borderRadius: 56, backgroundColor: T.principalFondo, borderWidth: 2, borderColor: T.principal, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  inicialTxt: { color: T.principalTexto, fontSize: 46, fontWeight: '700' },
  nombre: { color: T.texto, fontSize: 26, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  leyenda: { color: T.texto2, fontSize: 16, marginTop: 6, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  cifrado: { color: T.texto3, fontSize: 12, marginTop: 10 },
  abajo: { position: 'absolute', bottom: 44, left: 0, right: 0, alignItems: 'center' },
  fila: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18, paddingHorizontal: 16 },
  boton: { alignItems: 'center', width: 70 },
  circulo: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  icono: { fontSize: 24, color: T.texto },
  etiqueta: { color: T.texto2, fontSize: 12, marginTop: 6 },
});
