/**
 * AURA A PANTALLA COMPLETA: de frente, grande, para hablar con ella como en la mesa, encima de la
 * pantalla en la que esté la persona (los chats, los ajustes). La voz es la misma de siempre (el
 * VozProvider): sigue oyendo, y en una llamada se va.
 *
 * Arriba, achicarla (vuelve a caminar) o acoplarla al lado de los chats; en medio, ella; abajo, lo
 * que está haciendo, lo último que se dijeron y el micrófono grande. El «atrás» del teléfono la
 * acopla al lado (no cierra la pantalla de abajo).
 *
 * Lo monta el VozProvider junto a la compañera; en la mesa no aparece (la mesa ya es esto).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { de, tr, useIdioma } from '../i18n';
import { avatarPorId } from '../avatares/catalogo';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { useVozOpcional } from '../compa/VozProvider';
import { mensajeVoz, type MensajeVoz } from '../compa/canales';
import { Icono } from '../pulse/ui/Icono';
import { Tocable } from '../pulse/ui/Tocable';
import { type ControlCuerpo } from './AvatarVivo';
import { CuerpoElegido } from './CuerpoElegido';
import { Figura2D } from './Figura2D';
import { BotonMicrofono, textoEstado } from './DockAura';
import { siguienteModo } from './presencia';
import { fijarPresencia, useAnotarCuerpoAparte, useEstadoAvatar, useModoPresencia } from './usePresencia';
import { useTacto } from './useTacto';

export function EscenarioAura() {
  const modo = useModoPresencia();
  const voz = useVozOpcional();
  if (modo !== 'completa' || !voz) return null;
  return <Escenario />;
}

function Escenario() {
  useIdioma();
  const p = useTema();
  const st = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const voz = useVozOpcional()!;
  const estado = useEstadoAvatar();
  const cuerpo = useRef<ControlCuerpo>(null);
  useAnotarCuerpoAparte(true);

  // Lo último que se dijeron (la persona y AURA), como subtítulos.
  const [ultimo, setUltimo] = useState<{ tuyo?: MensajeVoz; suyo?: MensajeVoz }>({});
  useEffect(
    () =>
      mensajeVoz.escuchar((m) => {
        if (!m) return;
        setUltimo((u) => (m.rol === 'usuario' ? { ...u, tuyo: m } : { ...u, suyo: m }));
      }),
    []
  );

  // El «atrás» del teléfono: se acopla al lado (la pantalla de abajo no se cierra).
  useEffect(() => {
    const s = BackHandler.addEventListener('hardwareBackPress', () => {
      fijarPresencia(siguienteModo('completa', 'atras'));
      return true;
    });
    return () => s.remove();
  }, []);

  const apaisado = width > height;
  const lado = Math.round(Math.min(width - MEDIDA.espacio.xl * 2, (height - ins.top - ins.bottom) * (apaisado ? 0.7 : 0.52)));
  const medida = { ancho: lado, alto: lado };
  const tacto = useTacto(cuerpo, medida);
  const avatar = voz.vista.avatar;
  const reciente = ultimo.suyo && (!ultimo.tuyo || ultimo.suyo.en >= ultimo.tuyo.en) ? ultimo.suyo : ultimo.tuyo;

  return (
    <Animated.View entering={FadeIn.duration(MEDIDA.duracion.normal)} exiting={FadeOut.duration(MEDIDA.duracion.rapida)} style={[StyleSheet.absoluteFill, st.fondo]}>
      <View style={[st.arriba, { paddingTop: ins.top + MEDIDA.espacio.s }]}>
        <Tocable onPress={() => fijarPresencia(siguienteModo('completa', 'achicar'))} etiqueta={tr('Que AURA vuelva a caminar', 'Let AURA walk around again')} hitSlop={8} style={st.boton}>
          <Icono nombre="achicar" tam={22} color={p.texto} grosor={2} />
        </Tocable>
        <Text style={st.nombre}>{de(avatarPorId(avatar).nombre)}</Text>
        <Tocable onPress={() => fijarPresencia(siguienteModo('completa', 'acoplar'))} etiqueta={tr('AURA al lado del chat', 'AURA beside the chat')} hitSlop={8} style={st.boton}>
          <Icono nombre="acoplar" tam={23} color={p.texto} grosor={1.9} />
        </Tocable>
      </View>
      <View style={[st.medio, apaisado && st.medioApaisado]}>
        <View
          style={{ width: lado, height: lado }}
          {...tacto}
          accessible
          accessibilityRole="button"
          accessibilityLabel={tr('AURA, tu compañera', 'AURA, your companion')}
          accessibilityHint={tr('Toca para saludarla; toca dos veces para silenciarla o despertarla', 'Tap to say hi; double-tap to mute or wake her')}
        >
          <CuerpoElegido
            ref={cuerpo}
            avatar={avatar}
            camara="retrato"
            estado={estado}
            ancho={lado}
            alto={lado}
            fpsMax={60}
            respaldo={<Figura2D avatar={avatar} camara="retrato" estado={estado} ancho={lado} alto={lado} />}
          />
        </View>
        <View style={[st.texto, apaisado && st.textoApaisado]}>
          <Text style={st.estado}>{textoEstado(estado, voz)}</Text>
          {reciente ? (
            <Text style={[st.dicho, reciente.rol === 'usuario' && st.dichoTuyo]} numberOfLines={4}>
              {reciente.texto}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[st.abajo, { paddingBottom: ins.bottom + MEDIDA.espacio.xl }]}>
        <BotonMicrofono voz={voz} p={p} tam={68} />
      </View>
    </Animated.View>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    fondo: { backgroundColor: p.fondo, zIndex: 50, elevation: 50 },
    arriba: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: MEDIDA.espacio.s },
    boton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    nombre: { color: p.acentoTexto, fontSize: MEDIDA.letra.grande, fontWeight: '700', letterSpacing: 2 },
    medio: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: MEDIDA.espacio.xl },
    medioApaisado: { flexDirection: 'row', gap: MEDIDA.espacio.xl },
    texto: { alignItems: 'center', marginTop: MEDIDA.espacio.l, maxWidth: 520 },
    textoApaisado: { flex: 1, alignItems: 'flex-start', marginTop: 0 },
    estado: { color: p.acentoTexto, fontSize: MEDIDA.letra.cuerpo, fontWeight: '700' },
    dicho: { color: p.texto, fontSize: MEDIDA.letra.grande, lineHeight: 24, marginTop: MEDIDA.espacio.s, textAlign: 'center' },
    dichoTuyo: { color: p.texto2, fontStyle: 'italic' },
    abajo: { alignItems: 'center' },
  });
}
