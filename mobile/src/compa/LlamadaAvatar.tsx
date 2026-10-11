/**
 * LA LLAMADA DEL AVATAR EN PANTALLA: «AU-RA te está llamando» como una llamada de PULSE2CHAT, con la
 * cara del avatar en el aro dorado en vez de la inicial (las mismas piezas: pulse/ui/llamadaPiezas).
 *
 *  · SONANDO: el aro late y echa ondas, el timbre y la vibración los pone el VozProvider (compa/timbre).
 *    Rechazar (rojo) y «desliza para contestar», como PULSE2CHAT. Con un recordatorio, para qué llama.
 *  · CONECTANDO → EN LLAMADA: la cara crece a la vista de llamada y su boca sigue la voz (Claudio y
 *    ANT-ONIO con su foto; AU-RA y el Guardián con sus anillos, que laten con la voz; el render 3D del
 *    avatar encima si el teléfono lo aguanta). Cronómetro,
 *    Silenciar, Altavoz, Minimizar y Colgar. Doble toque a la cara = silenciar / volver.
 *  · MINIMIZADA: se encoge a una píldora arriba (cara, nombre, cronómetro, colgar) y la app se usa
 *    debajo con la llamada viva: los chats de PULSE2CHAT, los ajustes… Tocar la píldora la agranda.
 *    Entrar a los chats la minimiza sola (VozProvider). La compañera no aparece mientras tanto: la
 *    píldora es la presencia del avatar.
 *  · COLGADA / PERDIDA / RECHAZADA: dice cómo terminó un momento y se va (y la compañera entra
 *    caminando: Companera.tsx).
 *
 * «Reducir movimiento» del sistema: sin ondas ni resortes, todo aparece y se va con un fundido corto.
 * La pantalla no se apaga en la llamada (con la app detrás la llamada se cuelga: sin micrófono ni
 * minutos en segundo plano). Todo lo que se toca mide 48 dp o más.
 *
 * Sin estado propio de la llamada: lo pinta todo desde `v` (el ciclo, compa/llamadaCiclo.ts) y avisa
 * con los `on…`. Así el banco de capturas (scripts/qa/mesa-movil) la dibuja sin la voz de verdad.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { MEDIDA, OSCURO as P } from '../nucleo/tema';
import { de, tr, type Idioma } from '../i18n';
import { avatarPorId, type AvatarId } from '../avatares/catalogo';
import { MiniAvatar } from '../avatares/MiniAvatar';
import { OrbeAuraChica } from '../avatar3d/OrbeAuraChica';
import { fotosRetrato } from '../avatares/ClaudioRetrato';
import { Avatar, Boton, Deslizar, Icono, ROJO, RESORTE_SUAVE, tocar } from '../pulse/ui/llamadaPiezas';
import { leyendaLlamada, llamadaActiva, llamadaTerminada, relojLlamada, type EstadoCiclo, type MotivoFin, type OrigenLlamada } from './llamadaCiclo';

/**
 * Lo que la píldora ocupa arriba, bajo la barra del teléfono (6 de aire + 60 de alto + 8 de aire). El
 * VozProvider baja la app esa altura mientras la llamada está minimizada, como la barra verde de
 * WhatsApp: la píldora nunca tapa el título de los chats ni los botones de arriba.
 */
export const ALTO_PILDORA = 74;

export type VistaLlamada = {
  estado: EstadoCiclo;
  origen: OrigenLlamada | null;
  motivo: MotivoFin | null;
  /** Epoch ms en que conectó (0: no conectó). */
  conectadaEn: number;
  minimizada: boolean;
  altavoz: boolean;
  avatar: AvatarId;
  idioma: Idioma;
};

type Props = {
  v: VistaLlamada;
  onContestar: () => void;
  onRechazar: () => void;
  onColgar: () => void;
  /** Silenciar / volver a escuchar (el botón del micrófono y el doble toque a la cara). */
  onSilenciar: () => void;
  onAltavoz: () => void;
  onMinimizar: (minimizada: boolean) => void;
  /** El nivel de la voz de la llamada (0..1, el mismo que mueve la boca de la mesa: tts.escucharNivelVoz). */
  nivelVoz?: (cb: (nivel: number) => void) => () => void;
  /** El render 3D del avatar para la cara grande (avatar3d/CuerpoLlamada), con el 2D de respaldo. */
  cuerpo3D?: (lado: number, respaldo: ReactNode) => ReactNode;
  /** Solo el banco de capturas: el reloj fijo. */
  ahora?: () => number;
};

const DOBLE_TOQUE_MS = 320;
const TAG = 'llamada-avatar';

export function LlamadaAvatar({ v, onContestar, onRechazar, onColgar, onSilenciar, onAltavoz, onMinimizar, nivelVoz, cuerpo3D, ahora = Date.now }: Props) {
  const { width: ancho, height: alto } = useWindowDimensions();
  const apaisado = ancho > alto;
  const quieto = !!useReducedMotion();
  const bordes = initialWindowMetrics?.insets || { top: 28, bottom: 16, left: 0, right: 0 };
  const activa = llamadaActiva(v.estado);
  const terminada = llamadaTerminada(v.estado);
  const enLlamada = v.estado === 'en_llamada' || v.estado === 'silenciado';
  const nombre = de(avatarPorId(v.avatar).nombre);

  // El cronómetro: cada segundo mientras se habla (y queda fijo al colgar).
  const [, setLatido] = useState(0);
  const fin = useRef(0);
  useEffect(() => {
    if (!enLlamada) return;
    fin.current = 0;
    const t = setInterval(() => setLatido((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [enLlamada]);
  if (terminada && v.conectadaEn && !fin.current) fin.current = ahora();
  const duracion = v.conectadaEn ? (fin.current || ahora()) - v.conectadaEn : 0;
  const leyenda = leyendaLlamada(v.estado, { idioma: v.idioma, origen: v.origen, motivo: v.motivo, duracionMs: duracion });

  // La pantalla no se apaga mientras suena o se habla (apagada, Android manda la app detrás y cuelga).
  useEffect(() => {
    if (!activa) return;
    void activateKeepAwakeAsync(TAG).catch(() => {});
    return () => void deactivateKeepAwake(TAG).catch(() => {});
  }, [activa]);

  // «Atrás»: sonando, rechaza (como PULSE2CHAT); en la llamada grande, la minimiza.
  useEffect(() => {
    if (!activa) return;
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      if (v.estado === 'sonando') {
        onRechazar();
        return true;
      }
      if (!v.minimizada) {
        onMinimizar(true);
        return true;
      }
      return false;
    });
    return () => h.remove();
  }, [activa, v.estado, v.minimizada, onRechazar, onMinimizar]);

  // Grande (1) ↔ píldora (0): la vista de llamada se encoge hacia arriba y la píldora aparece.
  // La vista grande se desmonta cuando termina de encogerse (sus botones no quedan escondidos debajo).
  const grande = v.minimizada ? 0 : 1;
  const abierta = useSharedValue(grande);
  const [grandeMontada, setGrandeMontada] = useState(!v.minimizada);
  useEffect(() => {
    if (grande) setGrandeMontada(true);
    abierta.value = withTiming(grande, { duration: quieto ? 120 : 300, easing: Easing.out(Easing.cubic) }, (fin) => {
      if (fin && !grande) runOnJS(setGrandeMontada)(false);
    });
  }, [grande, quieto, abierta]);
  const estiloGrande = useAnimatedStyle(() => ({
    opacity: interpolate(abierta.value, [0, 0.6, 1], [0, 0.4, 1]),
    transform: [{ translateY: interpolate(abierta.value, [0, 1], [-alto * 0.42, 0]) }, { scale: interpolate(abierta.value, [0, 1], [0.18, 1]) }],
  }));
  const estiloPildora = useAnimatedStyle(() => ({
    opacity: interpolate(abierta.value, [0, 0.5, 1], [1, 0.3, 0]),
    transform: [{ scale: interpolate(abierta.value, [0, 1], [1, 0.7]) }],
  }));

  // La cara crece al contestar (de la entrante a la vista de llamada).
  const crece = useSharedValue(v.estado === 'sonando' ? 0 : 1);
  useEffect(() => {
    const n = v.estado === 'sonando' ? 0 : 1;
    crece.value = quieto ? n : withSpring(n, RESORTE_SUAVE);
  }, [v.estado, quieto, crece]);
  const estiloCara = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(crece.value, [0, 1], [1, 1.16]) }] }));

  // Doble toque a la cara: silenciar / volver a escuchar.
  const ultimoToque = useRef(0);
  const tocarCara = () => {
    if (!enLlamada) return;
    const t = Date.now();
    if (t - ultimoToque.current < DOBLE_TOQUE_MS) {
      ultimoToque.current = 0;
      tocar('media');
      onSilenciar();
    } else ultimoToque.current = t;
  };

  if (v.estado === 'reposo') return null;
  const tamCara = apaisado ? 112 : 148;
  const verGrande = !v.minimizada;
  const leyendaPildora = enLlamada ? (v.estado === 'silenciado' ? `${tr('Silenciado', 'Muted')} · ${relojLlamada(duracion)}` : relojLlamada(duracion)) : leyenda;

  return (
    <>
      {grandeMontada ? (
        <Animated.View
          entering={quieto ? FadeIn.duration(120) : FadeIn.duration(MEDIDA.duracion.normal)}
          exiting={FadeOut.duration(quieto ? 120 : MEDIDA.duracion.normal)}
          pointerEvents={verGrande ? 'auto' : 'none'}
          style={[StyleSheet.absoluteFill, s.capa, estiloGrande]}
          accessibilityViewIsModal={verGrande}
          importantForAccessibility={verGrande ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={!verGrande}
        >
          <GestureHandlerRootView style={s.llenar}>
            <LinearGradient colors={['#0A0B0D', P.fondo, '#2A2417']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
            {enLlamada ? (
              <Pressable
                onPress={() => onMinimizar(true)}
                accessibilityRole="button"
                accessibilityLabel={tr('Minimizar la llamada y seguir usando la app', 'Minimize the call and keep using the app')}
                style={[s.minimizar, { top: bordes.top + 8 }]}
                hitSlop={8}
              >
                <Icono nombre="minimizar" tam={26} color={P.texto} />
              </Pressable>
          ) : null}
          <View style={[s.contenido, apaisado && s.contenidoApaisado, { paddingTop: bordes.top + (apaisado ? 16 : 56), paddingBottom: bordes.bottom + (apaisado ? 16 : 36) }]}>
            <View style={[s.info, apaisado && s.columna]}>
              <Pressable onPress={tocarCara} accessibilityRole={enLlamada ? 'button' : undefined} accessibilityLabel={enLlamada ? tr('Dos toques: silenciar o volver a escuchar', 'Double-tap: mute or listen again') : nombre}>
                <Animated.View style={estiloCara}>
                  <Avatar tam={tamCara} late={v.estado === 'sonando'} quieto={quieto}>
                    <CaraLlamada avatar={v.avatar} lado={tamCara - 6} habla={enLlamada && v.estado !== 'silenciado'} nivelVoz={nivelVoz} cuerpo3D={cuerpo3D} activo={verGrande} />
                  </Avatar>
                </Animated.View>
              </Pressable>
              <Text style={s.nombre} numberOfLines={1}>
                {nombre}
              </Text>
              <Text style={[s.leyenda, terminada && v.estado !== 'colgada' && { color: P.aviso }]} accessibilityLiveRegion="polite">
                {leyenda}
              </Text>
              {v.origen?.tipo === 'recordatorio' && (v.estado === 'sonando' || v.estado === 'conectando') ? (
                <Text style={s.motivo} numberOfLines={3}>
                  {tr(`Para recordarte: ${v.origen.texto}`, `To remind you: ${v.origen.texto}`)}
                </Text>
              ) : null}
              {enLlamada ? <Text style={s.pista}>{tr('Habla con naturalidad · dos toques a la cara para silenciar', 'Just talk · double-tap the face to mute')}</Text> : null}
            </View>
            <View style={[s.controles, apaisado && s.columna]}>
              {v.estado === 'sonando' ? (
                <View style={s.centro}>
                  <Boton icono="colgar" etiqueta={tr('Rechazar', 'Decline')} fondo={ROJO} haptica="media" onPress={onRechazar} />
                  <Deslizar ancho={Math.min((apaisado ? ancho / 2 : ancho) - 48, 340)} icono="telefono" texto={tr('Desliza para contestar', 'Slide to answer')} onListo={onContestar} />
                </View>
              ) : activa ? (
                <View style={s.centro}>
                  <View style={s.fila}>
                    <Boton icono={v.estado === 'silenciado' ? 'micNo' : 'mic'} activo={v.estado === 'silenciado'} etiqueta={v.estado === 'silenciado' ? tr('Silenciado', 'Muted') : tr('Silenciar', 'Mute')} onPress={onSilenciar} />
                    <Boton icono="altavoz" activo={v.altavoz} etiqueta={tr('Altavoz', 'Speaker')} onPress={onAltavoz} />
                    <Boton icono="minimizar" etiqueta={tr('Minimizar', 'Minimize')} onPress={() => onMinimizar(true)} />
                  </View>
                  <Boton icono="colgar" etiqueta={tr('Colgar', 'Hang up')} fondo={ROJO} tam={76} haptica="media" onPress={onColgar} />
                </View>
              ) : null}
            </View>
          </View>
        </GestureHandlerRootView>
      </Animated.View>
      ) : null}

      {v.minimizada ? (
        <Animated.View pointerEvents="box-none" style={[s.pildoraCaja, { top: bordes.top + 6 }, estiloPildora]}>
          <Pressable
            onPress={() => onMinimizar(false)}
            accessibilityRole="button"
            accessibilityLabel={tr(`Llamada con ${nombre}, ${leyendaPildora}. Toca para volver a la llamada`, `Call with ${nombre}, ${leyendaPildora}. Tap to return to the call`)}
            style={s.pildora}
          >
            <View style={s.pildoraCara}>
              {/* Minimizada, la cara de la píldora es la misma de la llamada (Claudio y ANT-ONIO en video). */}
              <CaraLlamada avatar={v.avatar} lado={40} habla={false} cuerpo3D={cuerpo3D} />
            </View>
            <View style={s.pildoraTextos}>
              <Text style={s.pildoraNombre} numberOfLines={1}>
                {nombre}
              </Text>
              <Text style={[s.pildoraLeyenda, v.estado === 'silenciado' && { color: P.aviso }]} numberOfLines={1}>
                {leyendaPildora}
              </Text>
            </View>
            {activa ? (
              <Pressable onPress={onColgar} accessibilityRole="button" accessibilityLabel={tr(`Colgar la llamada con ${nombre}`, `Hang up the call with ${nombre}`)} style={s.pildoraColgar} hitSlop={4}>
                <Icono nombre="colgar" tam={22} color="#FFFFFF" />
              </Pressable>
            ) : null}
          </Pressable>
        </Animated.View>
      ) : null}
    </>
  );
}

/**
 * La cara del avatar para la llamada. Claudio y ANT-ONIO: su foto 2D con la cara al centro del aro y la
 * boca que se abre con la voz de la llamada (el mismo nivel que mueve a la mesa). AU-RA y el Guardián:
 * sus anillos (su cara de la mesa), que laten con la voz. Con `cuerpo3D` (el VozProvider lo pasa: el
 * render 3D del avatar si el teléfono lo aguanta), la foto o los anillos son su respaldo mientras arranca
 * o si falla; el banco de capturas no lo pasa y enseña el 2D.
 *
 * AU-RA (José, 11-oct: «cuando se hace pequeño aura en chat se vea igual cuando es avatar»): ya no la foto del orbe
 * (MiniAvatar) sino el MISMO orbe de partículas de la mesa (avatar3d/OrbeAuraChica), en la llamada grande y en la
 * píldora: late con su voz y, si no le toca el turno del orbe vivo, queda la foto. `activo` en falso (la vista grande
 * encogiéndose hacia la píldora) suelta el turno en el acto para que lo tome la píldora.
 */
export function CaraLlamada({
  avatar,
  lado,
  habla,
  nivelVoz,
  cuerpo3D,
  activo = true,
}: {
  avatar: AvatarId;
  lado: number;
  habla: boolean;
  nivelVoz?: (cb: (nivel: number) => void) => () => void;
  cuerpo3D?: (lado: number, respaldo: ReactNode) => ReactNode;
  /** Se ve (la grande, mientras no se encoge): solo así AU-RA pide el orbe vivo. */
  activo?: boolean;
}) {
  const fotos = fotosRetrato(avatar);
  const nivel = useSharedValue(0);
  useEffect(() => {
    nivel.value = 0;
    if (!habla || !nivelVoz) return;
    return nivelVoz((l) => {
      nivel.value = withTiming(l, { duration: 70 });
    });
  }, [habla, nivel, nivelVoz]);
  const late = useAnimatedStyle(() => ({ transform: [{ scale: 1 + nivel.value * 0.12 }] }));
  const boca = useAnimatedStyle(() => ({ opacity: nivel.value > 0.18 ? 1 : 0 }));
  const tema = avatarPorId(avatar).tema;
  // La foto de cuerpo entero, acercada a la cara (como la compañera: figura.ts / Companera).
  const encuadre = { width: lado, height: lado, transform: [{ scale: 1.55 }, { translateY: lado * 0.12 }] };
  const respaldo = avatar === 'aura' ? (
    <OrbeAuraChica lado={lado} activo={activo} estado={{ hablando: habla, pensando: false, escuchando: false, silenciado: false, expresion: 'tranquila' }} />
  ) : fotos ? (
    <View style={{ width: lado, height: lado, backgroundColor: tema.fondo }}>
      <Image source={fotos.base} style={encuadre} resizeMode="cover" accessibilityIgnoresInvertColors />
      <Animated.Image source={fotos.habla[1]} style={[StyleSheet.absoluteFill, encuadre, boca]} resizeMode="cover" />
    </View>
  ) : (
    <Animated.View style={[{ width: lado, height: lado }, late]}>
      <MiniAvatar id={avatar} lado={lado} />
    </Animated.View>
  );
  return <View style={{ width: lado, height: lado, borderRadius: lado / 2, overflow: 'hidden', backgroundColor: tema.fondo }}>{cuerpo3D ? cuerpo3D(lado, respaldo) : respaldo}</View>;
}

const s = StyleSheet.create({
  capa: { zIndex: 1100, elevation: 1100 },
  llenar: { flex: 1 },
  contenido: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: MEDIDA.espacio.l },
  contenidoApaisado: { flexDirection: 'row', justifyContent: 'space-around' },
  columna: { flex: 1, justifyContent: 'center' },
  info: { alignItems: 'center', width: '100%' },
  controles: { alignItems: 'center', width: '100%' },
  centro: { alignItems: 'center', gap: MEDIDA.espacio.xl },
  fila: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: MEDIDA.espacio.l },
  minimizar: { position: 'absolute', left: 16, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(236,232,226,0.10)', zIndex: 2 },
  nombre: { color: P.texto, fontSize: 30, fontWeight: '600', letterSpacing: 0.2, marginTop: MEDIDA.espacio.s, textAlign: 'center' },
  leyenda: { color: P.texto2, fontSize: MEDIDA.letra.grande, marginTop: MEDIDA.espacio.xs + 2, textAlign: 'center', fontVariant: ['tabular-nums'] },
  motivo: { color: P.acentoTexto, fontSize: MEDIDA.letra.cuerpo, marginTop: MEDIDA.espacio.m, textAlign: 'center', maxWidth: 320 },
  pista: { color: P.texto3, fontSize: MEDIDA.letra.chica, marginTop: MEDIDA.espacio.l, textAlign: 'center' },
  pildoraCaja: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 1100, elevation: 1100 },
  pildora: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 60,
    minWidth: 220,
    maxWidth: 320,
    paddingLeft: 8,
    paddingRight: 8,
    borderRadius: 30,
    backgroundColor: 'rgba(20,21,23,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(214,181,108,0.45)',
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  pildoraCara: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', borderWidth: 2, borderColor: P.acento, alignItems: 'center', justifyContent: 'center' },
  pildoraTextos: { flexShrink: 1, minWidth: 90, paddingRight: 4 },
  pildoraNombre: { color: P.texto, fontSize: MEDIDA.letra.cuerpo, fontWeight: '700' },
  pildoraLeyenda: { color: '#8FC98F', fontSize: MEDIDA.letra.chica + 0.5, fontVariant: ['tabular-nums'], marginTop: 1 },
  pildoraColgar: { width: 48, height: 48, borderRadius: 24, backgroundColor: ROJO, alignItems: 'center', justifyContent: 'center' },
});
