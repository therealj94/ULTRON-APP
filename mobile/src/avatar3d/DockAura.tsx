/**
 * AURA AL LADO DE LOS CHATS: mientras la persona escribe a sus amigos y a su familia, AURA está ahí,
 * acoplada, y se le habla ahí mismo.
 *
 *  · en vertical, una FRANJA debajo de la cabecera: su cara a la izquierda, lo que está haciendo y lo
 *    último que dijo en medio, y sus botones a la derecha. Empuja los mensajes hacia abajo; no tapa
 *    la barra de escribir ni ningún mensaje;
 *  · acostado o en tableta, un PANEL a la derecha (la pantalla dividida): de cuerpo entero arriba, el
 *    texto y los botones abajo.
 *
 * Los botones: el micrófono (hablarle / silenciarla, igual que el doble toque), agrandarla a pantalla
 * completa y achicarla a la compañera que camina. Tocarla es tocar a la compañera: la misma alma
 * reacciona (se ríe, se enoja, le gusta), con la zona que tocaste.
 *
 * Las pantallas del chat envuelven su contenido con <AuraAlLado>; si AURA no está al lado, devuelve
 * el contenido tal cual y la pantalla se ve exactamente como antes.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { tr, useIdioma } from '../i18n';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import type { Pantalla } from '../nucleo/contrato';
import { useVozOpcional, type ApiVoz } from '../compa/VozProvider';
import { Icono } from '../pulse/ui/Icono';
import { Tocable } from '../pulse/ui/Tocable';
import { AvatarVivo, type ControlCuerpo } from './AvatarVivo';
import { Figura2D } from './Figura2D';
import { disposicionDock, siguienteModo, type Disposicion } from './presencia';
import { fijarPresencia, useAnotarCuerpoAparte, useEsLaVisible, useEstadoAvatar, useModoPresencia, usePreferenciaPresencia } from './usePresencia';
import { useTacto } from './useTacto';
import type { Camara, EstadoAvatar } from './tipos';

/**
 * Envuelve lo que va debajo de la cabecera de una pantalla del chat. `chat`: el correo del hilo abierto
 * (la conversación) o null (la lista de chats).
 */
export function AuraAlLado({ pantalla, chat, children }: { pantalla: Pantalla; chat: string | null; children: ReactNode }) {
  const modo = useModoPresencia();
  const visible = useEsLaVisible(pantalla, chat);
  const { width, height } = useWindowDimensions();
  const voz = useVozOpcional();
  if (modo !== 'lado' || !visible || !voz) return <>{children}</>;
  const d = disposicionDock(width, height);
  if (d.tipo === 'franja') {
    return (
      <View style={s.columna}>
        <DockAura disposicion={d} voz={voz} />
        {children}
      </View>
    );
  }
  return (
    <View style={s.fila}>
      <View style={s.columna}>{children}</View>
      <DockAura disposicion={d} voz={voz} />
    </View>
  );
}

/** El botón de la cabecera del chat: pone a AURA al lado, o la devuelve a caminar. */
export function BotonAuraAlLado({ color, colorActivo }: { color: string; colorActivo: string }) {
  useIdioma();
  const pref = usePreferenciaPresencia();
  const voz = useVozOpcional();
  if (!voz) return null;
  const al = pref === 'lado';
  return (
    <Tocable
      onPress={() => fijarPresencia(al ? 'paseo' : 'lado')}
      deshabilitado={voz.vista.suspendida}
      etiqueta={al ? tr('Que AURA vuelva a caminar', 'Let AURA walk around again') : tr('Poner a AURA al lado del chat', 'Dock AURA beside the chat')}
      hitSlop={4}
      style={s.botonCab}
    >
      <Icono nombre={al ? 'chispa' : 'acoplar'} color={al ? colorActivo : color} tam={al ? 20 : 23} grosor={1.9} lleno={al} />
    </Tocable>
  );
}

/** Qué está haciendo, dicho corto (lo mismo en el panel y en la pantalla completa). */
export function textoEstado(e: EstadoAvatar, voz: ApiVoz): string {
  const v = voz.vista;
  if (e.silenciado) return tr('En silencio · toca dos veces para despertarla', 'Muted · double-tap to wake her');
  if (v.montada && v.estado === 'conectando') return tr('Conectando…', 'Connecting…');
  if (e.hablando) return tr('Hablando', 'Speaking');
  if (e.pensando) return tr('Pensando…', 'Thinking…');
  if (e.escuchando) return tr('Te escucho', 'I’m listening');
  return tr('Toca el micrófono para hablarle', 'Tap the mic to talk to her');
}

/** ¿La conversación está abierta y oyendo? (el micrófono la silencia; si no, la abre o la despierta). */
export function vozAbiertaAhora(voz: ApiVoz): boolean {
  const v = voz.vista;
  return v.montada && !v.silenciada && !v.dormida && v.estado !== 'error' && v.estado !== 'cerrada';
}

export function BotonMicrofono({ voz, p, tam = 44 }: { voz: ApiVoz; p: Paleta; tam?: number }) {
  const abierta = vozAbiertaAhora(voz);
  return (
    <Tocable
      onPress={() => (abierta ? voz.silenciar(true) : voz.iniciar())}
      deshabilitado={voz.vista.suspendida}
      vibrar
      etiqueta={abierta ? tr('Silenciar a AURA', 'Mute AURA') : tr('Hablarle a AURA', 'Talk to AURA')}
      style={[s.redondo, { width: tam, height: tam, borderRadius: tam / 2, backgroundColor: abierta ? p.acento : p.superficie2 }]}
    >
      <Icono nombre={abierta ? 'microfono' : 'microfonoNo'} tam={Math.round(tam * 0.5)} color={abierta ? p.sobreAcento : p.texto2} grosor={2} />
    </Tocable>
  );
}

function DockAura({ disposicion, voz }: { disposicion: Disposicion; voz: ApiVoz }) {
  useIdioma();
  const p = useTema();
  const st = useMemo(() => estilos(p), [p]);
  const estado = useEstadoAvatar();
  const cuerpo = useRef<ControlCuerpo>(null);
  useAnotarCuerpoAparte(true);
  const franja = disposicion.tipo === 'franja';
  const ladoCara = franja ? disposicion.alto - MEDIDA.espacio.s * 2 : Math.min(disposicion.ancho - MEDIDA.espacio.l * 2, 300);
  const medida = { ancho: ladoCara, alto: franja ? ladoCara : Math.round(ladoCara * 1.25) };
  const camara: Camara = franja ? 'retrato' : 'cuerpo';
  const tacto = useTacto(cuerpo, medida);
  const avatar = voz.vista.avatar;
  const cara = (
    <View
      style={[st.cara, { width: medida.ancho, height: medida.alto }]}
      {...tacto}
      accessible
      accessibilityRole="button"
      accessibilityLabel={tr('AURA, tu compañera', 'AURA, your companion')}
      accessibilityHint={tr('Toca para saludarla; toca dos veces para silenciarla o despertarla', 'Tap to say hi; double-tap to mute or wake her')}
    >
      <AvatarVivo
        ref={cuerpo}
        avatar={avatar}
        camara={camara}
        estado={estado}
        ancho={medida.ancho}
        alto={medida.alto}
        fpsMax={franja ? 30 : 60}
        respaldo={<Figura2D avatar={avatar} camara={camara} estado={estado} ancho={medida.ancho} alto={medida.alto} />}
      />
    </View>
  );
  const botones = (
    <View style={franja ? st.botonesFranja : st.botonesPanel}>
      <BotonMicrofono voz={voz} p={p} tam={franja ? 40 : 48} />
      {/* En la franja, los dos chicos van uno encima del otro: el texto necesita el ancho. */}
      <View style={franja ? st.pila : st.botonesPanel}>
        <Tocable onPress={() => fijarPresencia(siguienteModo('lado', 'agrandar'))} etiqueta={tr('AURA a pantalla completa', 'AURA full screen')} hitSlop={4} style={st.chico}>
          <Icono nombre="expandir" tam={19} color={p.texto2} grosor={2} />
        </Tocable>
        <Tocable onPress={() => fijarPresencia(siguienteModo('lado', 'achicar'))} etiqueta={tr('Que AURA vuelva a caminar', 'Let AURA walk around again')} hitSlop={4} style={st.chico}>
          <Icono nombre="achicar" tam={19} color={p.texto2} grosor={2} />
        </Tocable>
      </View>
    </View>
  );
  const texto = (
    <View style={franja ? st.textoFranja : st.textoPanel}>
      <Text style={st.estado} numberOfLines={1}>
        {textoEstado(estado, voz)}
      </Text>
      {estado.globo ? (
        <Text style={st.dijo} numberOfLines={franja ? 2 : 6}>
          {estado.globo}
        </Text>
      ) : null}
    </View>
  );
  return (
    <Animated.View
      entering={FadeIn.duration(MEDIDA.duracion.normal)}
      exiting={FadeOut.duration(MEDIDA.duracion.rapida)}
      style={franja ? [st.franja, { height: disposicion.alto }] : [st.panel, { width: disposicion.ancho }]}
    >
      {cara}
      {texto}
      {botones}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  columna: { flex: 1 },
  fila: { flex: 1, flexDirection: 'row' },
  botonCab: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  redondo: { alignItems: 'center', justifyContent: 'center' },
});

function estilos(p: Paleta) {
  return StyleSheet.create({
    franja: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: MEDIDA.espacio.m,
      paddingVertical: MEDIDA.espacio.s,
      backgroundColor: p.fondo2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.borde,
    },
    panel: {
      alignItems: 'center',
      paddingHorizontal: MEDIDA.espacio.l,
      paddingVertical: MEDIDA.espacio.l,
      backgroundColor: p.fondo2,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: p.borde,
    },
    cara: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: MEDIDA.radio.m },
    textoFranja: { flex: 1, marginHorizontal: MEDIDA.espacio.m },
    textoPanel: { alignSelf: 'stretch', flex: 1, marginTop: MEDIDA.espacio.m },
    estado: { color: p.acentoTexto, fontSize: MEDIDA.letra.chica + 1, fontWeight: '700' },
    dijo: { color: p.texto, fontSize: MEDIDA.letra.cuerpo - 1, lineHeight: 19, marginTop: 2 },
    botonesFranja: { flexDirection: 'row', alignItems: 'center', gap: MEDIDA.espacio.xs },
    botonesPanel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: MEDIDA.espacio.m, marginTop: MEDIDA.espacio.m },
    pila: { gap: 2 },
    chico: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  });
}
