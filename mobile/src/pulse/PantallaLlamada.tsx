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
import * as Haptics from 'expo-haptics';
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
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import * as LLAMADA from './llamada';
import { MEDIDA, OSCURO as P } from '../nucleo/tema';
import { tr } from '../i18n';

/** Contestar y colgar: la salvia y la terracota de la paleta, más vivas (un botón de llamada se reconoce por el color). */
const VERDE = '#5E9E62';
const ROJO = '#D4533C';
/** Segundos sin tocar antes de correr el velo en una llamada de voz por auricular. */
const ESPERA_VELO = 4000;
/** En videollamada, los botones se esconden solos para ver al otro; un toque los trae. */
const ESPERA_CONTROLES = 5000;
const TAG_PANTALLA = 'llamada';
const RESORTE_SUAVE = { ...MEDIDA.resorte.suave };
const RESORTE_VIVO = { ...MEDIDA.resorte.vivo };

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

function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function tocar(tipo: 'ligera' | 'media' | 'exito' | 'seleccion') {
  try {
    const p =
      tipo === 'exito'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : tipo === 'seleccion'
          ? Haptics.selectionAsync()
          : Haptics.impactAsync(tipo === 'media' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    void p.catch(() => {});
  } catch {
    /* sin motor de vibración no pasa nada */
  }
}

/* ── iconos: trazos de 24×24 (familia Lucide, ISC) dibujados con Skia ─────────────────────── */

type NombreIcono = 'telefono' | 'colgar' | 'mic' | 'micNo' | 'video' | 'videoNo' | 'voltear' | 'altavoz' | 'candado' | 'arriba';
const TRAZOS: Record<NombreIcono, string[]> = {
  telefono: [
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 0.7 2.81 2 2 0 0 1-0.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-0.45 12.84 12.84 0 0 0 2.81 0.7A2 2 0 0 1 22 16.92z',
  ],
  colgar: [
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 0.7 2.81 2 2 0 0 1-0.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-0.45 12.84 12.84 0 0 0 2.81 0.7A2 2 0 0 1 22 16.92z',
  ],
  mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  micNo: ['M2 2l20 20', 'M18.89 13.23A7.12 7.12 0 0 0 19 12v-2', 'M5 10v2a7 7 0 0 0 12 5', 'M15 9.34V5a3 3 0 0 0-5.68-1.33', 'M9 9v3a3 3 0 0 0 5.12 2.12', 'M12 19v3'],
  video: ['M22 8l-6 4 6 4V8z', 'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
  videoNo: ['M2 2l20 20', 'M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8', 'M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2'],
  voltear: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  altavoz: ['M11 5L6 9H2v6h4l5 4V5z', 'M15.54 8.46a5 5 0 0 1 0 7.07', 'M19.07 4.93a10 10 0 0 1 0 14.14'],
  candado: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  arriba: ['M18 15l-6-6-6 6'],
};
const trazos = new Map<string, SkPath | null>();
function trazo(d: string): SkPath | null {
  if (!trazos.has(d)) trazos.set(d, Skia.Path.MakeFromSVGString(d));
  return trazos.get(d) || null;
}
/** El auricular colgado es el mismo teléfono girado 135°, como en todos los teléfonos. */
const GIRO_COLGAR = [{ rotate: (135 * Math.PI) / 180 }];

function Icono({ nombre, tam, color, grosor = 2 }: { nombre: NombreIcono; tam: number; color: string; grosor?: number }) {
  return (
    <View pointerEvents="none" style={{ width: tam, height: tam }}>
      <Canvas style={{ width: tam, height: tam }}>
        <Group transform={[{ scale: tam / 24 }]}>
          <Group origin={{ x: 12, y: 12 }} transform={nombre === 'colgar' ? GIRO_COLGAR : []}>
            {TRAZOS[nombre].map((d, i) => {
              const p = trazo(d);
              return p ? <Path key={i} path={p} style="stroke" strokeWidth={grosor} strokeCap="round" strokeJoin="round" color={color} /> : null;
            })}
          </Group>
        </Group>
      </Canvas>
    </View>
  );
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

/** La inicial en un aro dorado; mientras suena, el aro late y dos ondas salen de él. */
function Avatar({ inicial, tam, late }: { inicial: string; tam: number; late: boolean }) {
  const onda = useSharedValue(0);
  const latido = useSharedValue(1);
  useEffect(() => {
    if (late) {
      onda.value = 0;
      onda.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }), -1, false);
      latido.value = withRepeat(withSequence(withTiming(1.045, { duration: 420, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 580, easing: Easing.inOut(Easing.quad) })), -1, false);
    } else {
      cancelAnimation(onda);
      cancelAnimation(latido);
      onda.value = withTiming(0, { duration: MEDIDA.duracion.normal });
      latido.value = withSpring(1, RESORTE_SUAVE);
    }
  }, [late, onda, latido]);
  // Dos ondas desfasadas media vuelta: mientras una se apaga, la otra nace.
  const onda1 = useAnimatedStyle(() => {
    const v = onda.value % 1;
    return { opacity: late ? interpolate(v, [0, 0.15, 1], [0, 0.5, 0]) : 0, transform: [{ scale: interpolate(v, [0, 1], [1, 1.6]) }] };
  });
  const onda2 = useAnimatedStyle(() => {
    const v = (onda.value + 0.5) % 1;
    return { opacity: late ? interpolate(v, [0, 0.15, 1], [0, 0.5, 0]) : 0, transform: [{ scale: interpolate(v, [0, 1], [1, 1.6]) }] };
  });
  const estiloAro = useAnimatedStyle(() => ({ transform: [{ scale: latido.value }] }));
  const r = tam / 2;
  return (
    <View style={{ width: tam * 1.7, height: tam * 1.7, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[s.onda, { width: tam, height: tam, borderRadius: r }, onda1]} />
      <Animated.View style={[s.onda, { width: tam, height: tam, borderRadius: r }, onda2]} />
      <Animated.View style={estiloAro}>
        <LinearGradient colors={[P.acentoTexto, P.acento, '#8C6D2F']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ width: tam, height: tam, borderRadius: r, padding: 3 }}>
          <View style={[s.avatarDentro, { borderRadius: r }]}>
            <Text style={[s.inicial, { fontSize: tam * 0.4 }]}>{inicial}</Text>
          </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

function Insignia() {
  return (
    <View style={s.insignia} accessibilityLabel={tr('Cifrada de punta a punta', 'End-to-end encrypted')}>
      <Icono nombre="candado" tam={13} color={P.acentoTexto} grosor={2.4} />
      <Text style={s.insigniaTxt}>{tr('Cifrada de punta a punta', 'End-to-end encrypted')}</Text>
    </View>
  );
}

function Boton({
  icono,
  etiqueta,
  onPress,
  fondo,
  activo,
  tam = 68,
  haptica = 'ligera',
}: {
  icono: NombreIcono;
  etiqueta: string;
  onPress: () => void;
  fondo?: string;
  activo?: boolean;
  tam?: number;
  haptica?: 'ligera' | 'media';
}) {
  const escala = useSharedValue(1);
  const estilo = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }));
  // Encendido = círculo claro con el icono oscuro, como en la app de teléfono del sistema.
  const color = fondo ? '#FFFFFF' : activo ? P.fondo : P.texto;
  const bg = fondo || (activo ? P.texto : 'rgba(236,232,226,0.13)');
  return (
    <Pressable
      onPressIn={() => (escala.value = withSpring(0.88, RESORTE_VIVO))}
      onPressOut={() => (escala.value = withSpring(1, RESORTE_VIVO))}
      onPress={() => {
        tocar(haptica);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityState={{ selected: !!activo }}
      hitSlop={6}
      style={s.boton}
    >
      <Animated.View style={[s.circulo, { width: tam, height: tam, borderRadius: tam / 2, backgroundColor: bg }, !fondo && !activo && s.circuloVidrio, estilo]}>
        <Icono nombre={icono} tam={Math.round(tam * 0.4)} color={color} />
      </Animated.View>
      <Text style={s.etiqueta} numberOfLines={1}>
        {etiqueta}
      </Text>
    </Pressable>
  );
}

/** «Desliza para contestar»: la perilla va hasta el final (82 %) o vuelve con un resorte. */
function Deslizar({ ancho, icono, texto, onListo }: { ancho: number; icono: NombreIcono; texto: string; onListo: () => void }) {
  const PERILLA = 64;
  const recorrido = Math.max(1, ancho - PERILLA - 8);
  const x = useSharedValue(0);
  const pista = useSharedValue(0);
  const hecho = useSharedValue(false);
  const brillo = useSharedValue(0);
  useEffect(() => {
    // Un empujoncito cada tanto: dice que la perilla se mueve sin tener que leerlo.
    pista.value = withRepeat(withSequence(withDelay(1800, withTiming(18, { duration: 260, easing: Easing.out(Easing.quad) })), withSpring(0, RESORTE_VIVO)), -1, false);
    brillo.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => {
      cancelAnimation(pista);
      cancelAnimation(brillo);
    };
  }, [pista, brillo]);
  const listo = () => {
    tocar('exito');
    onListo();
  };
  const gesto = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .onBegin(() => {
      cancelAnimation(pista);
      pista.value = withTiming(0, { duration: 80 });
      runOnJS(tocar)('seleccion');
    })
    .onUpdate((e) => {
      if (hecho.value) return;
      x.value = Math.min(recorrido, Math.max(0, e.translationX));
    })
    .onEnd(() => {
      if (hecho.value) return;
      if (x.value > recorrido * 0.82) {
        hecho.value = true;
        x.value = withTiming(recorrido, { duration: 120 });
        runOnJS(listo)();
      } else {
        x.value = withSpring(0, RESORTE_VIVO);
      }
    });
  const estiloPerilla = useAnimatedStyle(() => ({ transform: [{ translateX: x.value + pista.value }] }));
  const estiloRelleno = useAnimatedStyle(() => ({ width: x.value + pista.value + PERILLA + 8, opacity: interpolate(x.value, [0, recorrido], [0.35, 1], Extrapolation.CLAMP) }));
  const estiloTexto = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, recorrido * 0.5], [0.55 + brillo.value * 0.45, 0], Extrapolation.CLAMP) }));
  return (
    <View
      style={[s.pistaDeslizar, { width: ancho }]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={texto}
      accessibilityActions={[{ name: 'activate', label: tr('Contestar', 'Answer') }]}
      onAccessibilityAction={listo}
      onAccessibilityTap={listo}
    >
      <Animated.View style={[s.rellenoDeslizar, estiloRelleno]} />
      <Animated.Text style={[s.textoDeslizar, { paddingLeft: PERILLA }, estiloTexto]} numberOfLines={1}>
        {texto}
      </Animated.Text>
      <GestureDetector gesture={gesto}>
        <Animated.View style={[s.perilla, { width: PERILLA, height: PERILLA, borderRadius: PERILLA / 2 }, estiloPerilla]}>
          <Icono nombre={icono} tam={26} color="#FFFFFF" />
        </Animated.View>
      </GestureDetector>
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
  onda: { position: 'absolute', borderWidth: 2, borderColor: P.acento },
  avatarDentro: { flex: 1, backgroundColor: P.superficie, alignItems: 'center', justifyContent: 'center' },
  inicial: { color: P.acentoTexto, fontWeight: '600', letterSpacing: 1 },
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
  boton: { alignItems: 'center', width: 84 },
  circulo: { alignItems: 'center', justifyContent: 'center' },
  circuloVidrio: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(236,232,226,0.18)' },
  etiqueta: { color: P.texto2, fontSize: MEDIDA.letra.chica, marginTop: MEDIDA.espacio.s },
  pistaDeslizar: {
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(236,232,226,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(236,232,226,0.2)',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rellenoDeslizar: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 38, backgroundColor: 'rgba(94,158,98,0.45)' },
  textoDeslizar: { color: P.texto, fontSize: MEDIDA.letra.cuerpo, textAlign: 'center', letterSpacing: 0.3, paddingRight: MEDIDA.espacio.l },
  perilla: { position: 'absolute', left: 6, backgroundColor: VERDE, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
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
