/**
 * La pantalla de una llamada de PULSE2CHAT: entrante, sonando, conectando, en curso y terminada.
 *
 * Encima de todo (la pinta PulseProvider), porque una llamada no espera a que abras el chat. Se ve
 * como la app de teléfono del sistema, no como una web: fondo hondo con degradado, un anillo dorado
 * que late mientras suena, la inicial grande, botones redondos con iconos dibujados (Skia), háptica
 * en cada toque y «desliza para contestar» en la entrante. Con video, el del otro ocupa la pantalla
 * y el propio va en un recuadro que se arrastra a cualquier rincón.
 *
 * Siempre en la paleta OSCURA, en los dos temas: una llamada es un escenario, como la mesa.
 *
 * VOZ POR EL AURICULAR Y LA OREJA: el sensor de proximidad (apagar la pantalla al acercarla a la cara)
 * pide un wake lock nativo PROXIMITY_SCREEN_OFF que ningún módulo instalado expone, y sumar uno nuevo
 * (o código Kotlin que no se puede compilar aquí) arriesga el APK. En su lugar: durante una llamada de
 * voz por auricular se suelta el «pantalla siempre encendida» de la mesa —la pantalla se apaga sola
 * con el reposo del sistema, como en cualquier teléfono— y a los pocos segundos sin tocar se corre un
 * VELO negro que se traga los toques de la mejilla; para usar los botones se desliza hacia arriba.
 * Con altavoz, audífonos o video, la pantalla se queda encendida y sin velo.
 *
 * Al colgar se dice POR QUÉ terminó —no es lo mismo «colgó» que «no hubo camino de red»— y se va sola.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { RTCView } from '@livekit/react-native-webrtc';
import { LinearGradient } from 'expo-linear-gradient';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  FadeInUp,
  ZoomIn,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import * as LLAMADA from './llamada';
import { Avatar, Boton, Deslizar, Icono, RESORTE_SUAVE, RESORTE_VIVO, ROJO, reloj, tocar } from './ui/llamadaPiezas';
import { MEDIDA, OSCURO as P } from '../nucleo/tema';
import { tr } from '../i18n';

/** Segundos sin tocar antes de correr el velo en una llamada de voz por auricular. */
const ESPERA_VELO = 4000;
/** En videollamada, los botones se esconden solos para ver al otro; un toque los trae. */
const ESPERA_CONTROLES = 5000;
const TAG_PANTALLA = 'llamada';

const RAZON: Record<LLAMADA.Motivo, () => string> = {
  yo: () => tr('Llamada terminada', 'Call ended'),
  'el-otro': () => tr('La otra persona colgó', 'The other person hung up'),
  rechazada: () => tr('No contestó', 'Declined'),
  'el-otro-sin-permiso': () => tr('Quiso contestar, pero su teléfono no le dio el micrófono', 'They tried to answer, but their phone blocked the microphone'),
  ocupado: () => tr('Está en otra llamada', 'On another call'),
  'no-contesto': () => tr('No contestó', 'No answer'),
  perdida: () => tr('Llamada perdida', 'Missed call'),
  'sin-camino': () => tr('No hubo camino de red entre los dos', 'No network path between you'),
  corte: () => tr('Se cortó la conexión', 'The connection dropped'),
  'no-se-pudo': () => tr('No se pudo abrir la llamada', 'Couldn’t start the call'),
  'sin-permiso': () => tr('Hace falta permiso de micrófono', 'Microphone permission needed'),
  'en-otro-aparato': () => tr('Contestaste en otro aparato', 'Answered on another device'),
  'rechazada-en-otro-aparato': () => tr('Rechazada en otro aparato', 'Declined on another device'),
  'atendida-en-otro-aparato': () => tr('Se atendió en otro aparato', 'Handled on another device'),
  'no-te-acepto': () => tr('Todavía no te aceptó en su círculo', 'They haven’t accepted you yet'),
  'senal-grande': () => tr('La llamada no cupo en el relevo', 'The call didn’t fit through the relay'),
  demasiadas: () => tr('Demasiados intentos seguidos', 'Too many attempts in a row'),
  'sin-red': () => tr('Sin conexión a internet', 'No internet connection'),
  'no-llego': () => tr('La llamada no llegó al otro lado', 'The call didn’t reach them'),
};

/** Una línea más para los motivos que tienen arreglo. */
const CONSEJO: Partial<Record<LLAMADA.Motivo, () => string>> = {
  'sin-camino': () => tr('Prueba con otra red: wifi o datos', 'Try another network: wifi or mobile data'),
  'sin-permiso': () => tr('Actívalo en Ajustes › Permisos › Micrófono', 'Turn it on in Settings › Permissions › Microphone'),
  demasiadas: () => tr('Espera un minuto y vuelve a intentar', 'Wait a minute and try again'),
  'senal-grande': () => tr('Vuelve a intentar en un momento', 'Try again in a moment'),
  'sin-red': () => tr('Revisa el wifi o los datos', 'Check wifi or mobile data'),
};

/** Los motivos que no son un problema: el aviso dura menos. */
const BREVES: LLAMADA.Motivo[] = ['yo', 'en-otro-aparato', 'rechazada-en-otro-aparato', 'atendida-en-otro-aparato'];

/** «maria.lopez@x.com» → «Maria Lopez». */
function nombreDe(correo: string | null): string {
  const local = (correo || '').split('@')[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ');
}



/* ── la pantalla ──────────────────────────────────────────────────────────────────────────── */

export function PantallaLlamada({ cuento: c, onListo, nombre }: { cuento: LLAMADA.Cuento; onListo: () => void; nombre?: string }) {
  const { width: ancho, height: alto } = useWindowDimensions();
  const apaisado = ancho > alto;
  const bordes = initialWindowMetrics?.insets || { top: 28, bottom: 16, left: 0, right: 0 };
  const terminada = c.estado === 'libre' && !!c.motivo;
  const sonando = c.estado === 'llamando' || c.estado === 'entrando';
  const quien = nombre || nombreDe(c.conQuien || c.entrante?.de || null) || tr('Llamada', 'Call');

  /* el reloj de la llamada, que se queda fijo al terminar */
  const inicio = useRef<number | null>(null);
  const fin = useRef<number | null>(null);
  const [, setLatido] = useState(0);
  useEffect(() => {
    if (c.estado === 'hablando') {
      if (!inicio.current) inicio.current = Date.now();
      fin.current = null;
      const t = setInterval(() => setLatido((n) => n + 1), 1000);
      return () => clearInterval(t);
    }
    if (c.estado === 'libre') {
      if (inicio.current && !fin.current) fin.current = Date.now();
    } else {
      inicio.current = null;
      fin.current = null;
    }
  }, [c.estado]);
  const duracion = inicio.current ? reloj((fin.current || Date.now()) - inicio.current) : '';

  /* salida: el aviso de cómo terminó se queda un momento y se desvanece solo */
  const opacidad = useSharedValue(1);
  useEffect(() => {
    if (!terminada) {
      cancelAnimation(opacidad);
      opacidad.value = 1;
      return;
    }
    const espera = c.abrirAjustes ? 9000 : BREVES.includes(c.motivo as LLAMADA.Motivo) ? 1100 : 2800;
    const t = setTimeout(() => {
      opacidad.value = withTiming(0, { duration: MEDIDA.duracion.normal }, (hecho) => {
        if (hecho) runOnJS(onListo)();
      });
    }, espera);
    return () => clearTimeout(t);
  }, [terminada, c.motivo, c.abrirAjustes, onListo, opacidad]);
  const estiloRaiz = useAnimatedStyle(() => ({ opacity: opacidad.value }));

  /* voz por auricular: la pantalla se apaga sola y un velo se traga los toques */
  const vozAuricular = !c.hayVideo && !c.porAltavoz && (c.estado === 'llamando' || c.estado === 'conectando' || c.estado === 'hablando');
  const libre = c.estado === 'libre';
  useEffect(() => {
    if (libre) return;
    if (vozAuricular) {
      void deactivateKeepAwake('mesa').catch(() => {});
      return () => void activateKeepAwakeAsync('mesa').catch(() => {});
    }
    void activateKeepAwakeAsync(TAG_PANTALLA).catch(() => {});
    return () => void deactivateKeepAwake(TAG_PANTALLA).catch(() => {});
  }, [vozAuricular, libre]);

  const [velo, setVelo] = useState(false);
  const relojVelo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armarVelo = useCallback(() => {
    if (relojVelo.current) clearTimeout(relojVelo.current);
    relojVelo.current = null;
    if (vozAuricular) relojVelo.current = setTimeout(() => setVelo(true), ESPERA_VELO);
  }, [vozAuricular]);
  useEffect(() => {
    if (!vozAuricular) setVelo(false);
    armarVelo();
    return () => {
      if (relojVelo.current) clearTimeout(relojVelo.current);
    };
  }, [vozAuricular, armarVelo]);

  /* videollamada: los botones se esconden para ver al otro y vuelven con un toque */
  const videoGrande = c.videoRemoto && !!c.flujoRemoto && c.estado === 'hablando';
  const [controles, setControles] = useState(true);
  useEffect(() => {
    if (!videoGrande || !controles) return;
    const t = setTimeout(() => setControles(false), ESPERA_CONTROLES);
    return () => clearTimeout(t);
  }, [videoGrande, controles]);
  useEffect(() => {
    if (!videoGrande) setControles(true);
  }, [videoGrande]);
  const visibles = useSharedValue(1);
  useEffect(() => {
    visibles.value = withTiming(controles ? 1 : 0, { duration: MEDIDA.duracion.normal });
  }, [controles, visibles]);
  const estiloControles = useAnimatedStyle(() => ({ opacity: visibles.value, transform: [{ translateY: interpolate(visibles.value, [0, 1], [24, 0]) }] }));
  const estiloInfo = useAnimatedStyle(() => ({ opacity: visibles.value }));

  const leyenda = terminada
    ? RAZON[c.motivo as LLAMADA.Motivo]?.() || ''
    : c.estado === 'entrando'
      ? c.entrante?.video
        ? tr('Videollamada entrante', 'Incoming video call')
        : tr('Llamada de voz entrante', 'Incoming voice call')
      : c.estado === 'llamando'
        ? tr('Sonando…', 'Ringing…')
        : c.estado === 'conectando'
          ? tr('Conectando…', 'Connecting…')
          : c.reconectando
            ? tr('Reconectando…', 'Reconnecting…')
            : duracion || reloj(0);
  const consejo = terminada ? CONSEJO[c.motivo as LLAMADA.Motivo]?.() || (duracion && c.motivo !== 'perdida' ? duracion : '') : '';
  const esProblema = terminada && !BREVES.includes(c.motivo as LLAMADA.Motivo) && c.motivo !== 'el-otro';

  const contestar = (video: boolean) => {
    tocar('exito');
    void LLAMADA.contestar(video).catch(() => {});
  };
  const propioGrande = c.hayVideo && c.camAbierta && !!c.flujoLocal && !videoGrande && !libre;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => (c.estado === 'entrando' ? LLAMADA.rechazar() : undefined)}>
      <GestureHandlerRootView style={s.llenar}>
        <Animated.View entering={FadeIn.duration(MEDIDA.duracion.normal)} style={[s.llenar, estiloRaiz]} onTouchStart={() => !velo && armarVelo()}>
          <LinearGradient colors={['#0A0B0D', P.fondo, '#2A2417']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />

          {videoGrande && <RTCView streamURL={(c.flujoRemoto as any).toURL()} style={StyleSheet.absoluteFill} objectFit="cover" zOrder={0} />}
          {propioGrande && <RTCView streamURL={(c.flujoLocal as any).toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror zOrder={0} />}
          {(videoGrande || propioGrande) && (
            <>
              <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']} style={[s.sombraArriba, { height: alto * 0.32 }]} />
              <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={[s.sombraAbajo, { height: alto * 0.4 }]} />
            </>
          )}
          {videoGrande && <Pressable style={StyleSheet.absoluteFill} onPress={() => setControles((v) => !v)} accessibilityLabel={tr('Mostrar u ocultar los botones', 'Show or hide the buttons')} />}

          <View
            pointerEvents="box-none"
            style={[s.contenido, apaisado && s.contenidoApaisado, { paddingTop: bordes.top + (apaisado ? 16 : 48), paddingBottom: bordes.bottom + (apaisado ? 16 : 36) }]}
          >
            <Animated.View pointerEvents="none" style={[s.info, apaisado && s.columna, videoGrande && estiloInfo]}>
              {!videoGrande && !propioGrande && (
                <Animated.View entering={ZoomIn.springify().damping(14)}>
                  <Avatar inicial={(quien[0] || '?').toUpperCase()} tam={apaisado ? 104 : 136} late={sonando} />
                </Animated.View>
              )}
              <Animated.Text entering={FadeInDown.delay(60).duration(MEDIDA.duracion.normal)} style={s.nombre} numberOfLines={1}>
                {quien}
              </Animated.Text>
              <Text style={[s.leyenda, esProblema && { color: P.aviso }]} accessibilityLiveRegion="polite">
                {leyenda}
              </Text>
              {!!consejo && <Text style={s.consejo}>{consejo}</Text>}
              {!terminada && <Insignia />}
            </Animated.View>

            <Animated.View pointerEvents={controles ? 'box-none' : 'none'} style={[s.controles, apaisado && s.columna, videoGrande && estiloControles]}>
              {terminada ? (
                c.abrirAjustes ? (
                  <Animated.View entering={FadeInUp.duration(MEDIDA.duracion.normal)} style={s.centro}>
                    <Pressable
                      onPress={() => {
                        tocar('ligera');
                        LLAMADA.abrirAjustes();
                        onListo();
                      }}
                      accessibilityRole="button"
                      style={s.botonAjustes}
                    >
                      <Text style={s.botonAjustesTxt}>{tr('Abrir Ajustes', 'Open Settings')}</Text>
                    </Pressable>
                    <Pressable onPress={onListo} accessibilityRole="button" hitSlop={12}>
                      <Text style={s.enlace}>{tr('Ahora no', 'Not now')}</Text>
                    </Pressable>
                  </Animated.View>
                ) : null
              ) : c.estado === 'entrando' ? (
                <Animated.View entering={FadeInUp.delay(120).duration(MEDIDA.duracion.lenta)} style={s.centro}>
                  <View style={s.fila}>
                    <Boton icono="colgar" etiqueta={tr('Rechazar', 'Decline')} fondo={ROJO} haptica="media" onPress={() => LLAMADA.rechazar()} />
                    {c.entrante?.video && <Boton icono="telefono" etiqueta={tr('Solo voz', 'Voice only')} onPress={() => contestar(false)} />}
                  </View>
                  <Deslizar
                    ancho={Math.min((apaisado ? ancho / 2 : ancho) - 48, 340)}
                    icono={c.entrante?.video ? 'video' : 'telefono'}
                    texto={c.entrante?.video ? tr('Desliza para contestar con video', 'Slide to answer with video') : tr('Desliza para contestar', 'Slide to answer')}
                    onListo={() => contestar(!!c.entrante?.video)}
                  />
                </Animated.View>
              ) : (
                <Animated.View entering={FadeInUp.delay(80).duration(MEDIDA.duracion.lenta)} style={s.centro}>
                  <View style={s.fila}>
                    <Boton icono={c.micAbierto ? 'mic' : 'micNo'} activo={!c.micAbierto} etiqueta={c.micAbierto ? tr('Silenciar', 'Mute') : tr('Silenciado', 'Muted')} onPress={() => LLAMADA.micro()} />
                    <Boton icono="altavoz" activo={c.porAltavoz} etiqueta={tr('Altavoz', 'Speaker')} onPress={() => void LLAMADA.altavoz()} />
                    {c.hayVideo && <Boton icono={c.camAbierta ? 'video' : 'videoNo'} activo={!c.camAbierta} etiqueta={tr('Cámara', 'Camera')} onPress={() => LLAMADA.camara()} />}
                    {c.hayVideo && <Boton icono="voltear" etiqueta={tr('Voltear', 'Flip')} onPress={() => LLAMADA.voltear()} />}
                  </View>
                  <Boton icono="colgar" etiqueta={tr('Colgar', 'Hang up')} fondo={ROJO} tam={76} haptica="media" onPress={() => LLAMADA.colgar('yo')} />
                </Animated.View>
              )}
            </Animated.View>
          </View>

          {videoGrande && c.hayVideo && c.flujoLocal && <VideoPropio flujo={c.flujoLocal} ancho={ancho} alto={alto} arriba={bordes.top + 12} abajo={bordes.bottom + (apaisado ? 16 : 220)} />}

          {velo && vozAuricular && (
            <Velo
              quien={quien}
              leyenda={leyenda}
              onQuitar={() => {
                setVelo(false);
                armarVelo();
              }}
            />
          )}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/* ── piezas ───────────────────────────────────────────────────────────────────────────────── */


function Insignia() {
  return (
    <View style={s.insignia} accessibilityLabel={tr('Cifrada de punta a punta', 'End-to-end encrypted')}>
      <Icono nombre="candado" tam={13} color={P.acentoTexto} grosor={2.4} />
      <Text style={s.insigniaTxt}>{tr('Cifrada de punta a punta', 'End-to-end encrypted')}</Text>
    </View>
  );
}


/** El recuadro del video propio: se arrastra y se acomoda solo en el rincón más cercano. */
function VideoPropio({ flujo, ancho, alto, arriba, abajo }: { flujo: any; ancho: number; alto: number; arriba: number; abajo: number }) {
  const W = 104;
  const H = 150;
  const M = 14;
  const x = useSharedValue(ancho - W - M);
  const y = useSharedValue(arriba);
  const desdeX = useSharedValue(0);
  const desdeY = useSharedValue(0);
  const alzado = useSharedValue(1);
  const gesto = Gesture.Pan()
    .onStart(() => {
      desdeX.value = x.value;
      desdeY.value = y.value;
      alzado.value = withSpring(1.06, RESORTE_VIVO);
    })
    .onUpdate((e) => {
      x.value = desdeX.value + e.translationX;
      y.value = desdeY.value + e.translationY;
    })
    .onEnd((e) => {
      // Con la inercia del gesto: un empujón hacia un lado lo manda a ese lado aunque no haya llegado.
      const cx = x.value + e.velocityX * 0.1 + W / 2;
      const cy = y.value + e.velocityY * 0.1 + H / 2;
      x.value = withSpring(cx < ancho / 2 ? M : ancho - W - M, RESORTE_SUAVE);
      y.value = withSpring(cy < alto / 2 ? arriba : alto - H - abajo, RESORTE_SUAVE);
      alzado.value = withSpring(1, RESORTE_VIVO);
    });
  const estilo = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: alzado.value }] }));
  return (
    <GestureDetector gesture={gesto}>
      <Animated.View entering={ZoomIn.springify().damping(16)} style={[s.propio, { width: W, height: H }, estilo]}>
        <RTCView streamURL={flujo.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror zOrder={1} />
      </Animated.View>
    </GestureDetector>
  );
}

/** El velo contra la mejilla: negro, sin botones; se quita deslizando hacia arriba. */
function Velo({ quien, leyenda, onQuitar }: { quien: string; leyenda: string; onQuitar: () => void }) {
  const y = useSharedValue(0);
  const flecha = useSharedValue(0);
  useEffect(() => {
    flecha.value = withRepeat(withSequence(withTiming(-8, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) })), -1, false);
    return () => cancelAnimation(flecha);
  }, [flecha]);
  const quitar = () => {
    tocar('seleccion');
    onQuitar();
  };
  const gesto = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onUpdate((e) => {
      y.value = Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      if (y.value < -110 || e.velocityY < -900) runOnJS(quitar)();
      else y.value = withSpring(0, RESORTE_VIVO);
    });
  const estilo = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [-160, 0], [0, 1], Extrapolation.CLAMP) }));
  const estiloFlecha = useAnimatedStyle(() => ({ transform: [{ translateY: flecha.value + y.value * 0.4 }] }));
  return (
    <GestureDetector gesture={gesto}>
      <Animated.View entering={FadeIn.duration(MEDIDA.duracion.lenta)} style={[StyleSheet.absoluteFill, s.velo, estilo]} accessible accessibilityLabel={tr('Pantalla bloqueada durante la llamada', 'Screen locked during the call')} accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={quitar}>
        <Text style={s.veloNombre}>{quien}</Text>
        <Text style={s.veloLeyenda}>{leyenda}</Text>
        <View style={s.veloAbajo}>
          <Animated.View style={estiloFlecha}>
            <Icono nombre="arriba" tam={28} color={P.texto3} />
          </Animated.View>
          <Text style={s.veloTxt}>{tr('Desliza hacia arriba para usar la pantalla', 'Swipe up to use the screen')}</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  llenar: { flex: 1 },
  sombraArriba: { position: 'absolute', top: 0, left: 0, right: 0 },
  sombraAbajo: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  contenido: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: MEDIDA.espacio.l },
  contenidoApaisado: { flexDirection: 'row', justifyContent: 'space-around' },
  columna: { flex: 1, justifyContent: 'center' },
  info: { alignItems: 'center', width: '100%' },
  controles: { alignItems: 'center', width: '100%' },
  centro: { alignItems: 'center', gap: MEDIDA.espacio.xl },
  fila: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: MEDIDA.espacio.xl },
  nombre: { color: P.texto, fontSize: 30, fontWeight: '600', letterSpacing: 0.2, marginTop: MEDIDA.espacio.s, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 8 },
  leyenda: { color: P.texto2, fontSize: MEDIDA.letra.grande, marginTop: MEDIDA.espacio.xs + 2, textAlign: 'center', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 6 },
  consejo: { color: P.texto3, fontSize: MEDIDA.letra.cuerpo, marginTop: MEDIDA.espacio.xs, textAlign: 'center' },
  insignia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: MEDIDA.espacio.l,
    paddingHorizontal: MEDIDA.espacio.m,
    paddingVertical: 6,
    borderRadius: MEDIDA.radio.redondo,
    backgroundColor: 'rgba(214,181,108,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(214,181,108,0.35)',
  },
  insigniaTxt: { color: P.acentoTexto, fontSize: MEDIDA.letra.chica, letterSpacing: 0.3 },
  propio: { position: 'absolute', top: 0, left: 0, borderRadius: MEDIDA.radio.m, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(236,232,226,0.35)', backgroundColor: P.superficie, elevation: 8 },
  botonAjustes: { backgroundColor: P.acento, paddingHorizontal: MEDIDA.espacio.xxl, paddingVertical: 14, borderRadius: MEDIDA.radio.redondo },
  botonAjustesTxt: { color: P.sobreAcento, fontSize: MEDIDA.letra.grande, fontWeight: '600' },
  enlace: { color: P.texto2, fontSize: MEDIDA.letra.cuerpo },
  velo: { backgroundColor: 'rgba(0,0,0,0.96)', alignItems: 'center', justifyContent: 'center' },
  veloNombre: { color: P.texto3, fontSize: MEDIDA.letra.titulo, fontWeight: '500' },
  veloLeyenda: { color: P.texto3, fontSize: MEDIDA.letra.cuerpo, marginTop: MEDIDA.espacio.xs, fontVariant: ['tabular-nums'] },
  veloAbajo: { position: 'absolute', bottom: 64, alignItems: 'center', gap: MEDIDA.espacio.s },
  veloTxt: { color: P.texto3, fontSize: MEDIDA.letra.chica },
});
