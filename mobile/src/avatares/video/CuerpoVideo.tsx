/**
 * EL CUERPO EN VIDEO de Claudio y ANT-ONIO: sus clips animados (clips.ts), elegidos por el guion
 * (guion.ts) con el mismo estado que recibe el cuerpo 3D (EstadoAvatar).
 *
 * Dos capas de video, una encima de otra: el clip nuevo arranca en la capa de atrás, invisible, y
 * cuando ya tiene su primer cuadro se funde encima (220 ms) y la de adelante se descarga. Como todos
 * los clips empiezan y terminan en la misma pose, el cambio no se nota. Un golpe (risa, saludo…)
 * avisa un poco antes de terminar para que el fondo que sigue ya esté listo cuando acaba.
 *
 * El respaldo (las fotos de siempre) se ve debajo mientras arranca el primer clip, y se queda solo si
 * el video falla o el cuerpo está tapado (activo = false: sin decodificadores gastando batería).
 * Los bordes se funden con el color de fondo del avatar, para que no se vea un rectángulo.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { miga } from '../../lib/reporte';
import { avatarPorId } from '../catalogo';
import type { ControlCuerpo } from '../../avatar3d/AvatarVivo';
import type { Camara, EstadoAvatar } from '../../avatar3d/tipos';
import { CLIPS } from './clips';
import { CLIPS_VIDEO, DirectorVideo, encuadrar, VENTANAS, zonaVideo, type ClipVideo, type Reproduccion } from './guion';

/** Cuánto dura el fundido entre clips. */
const FUNDIDO_MS = 220;
/** Si el clip nuevo no da su primer cuadro en esto, se funde igual (nunca se queda trabado). */
const ESPERA_MAX_MS = 700;
/** Un golpe avisa que terminó esto antes del final, para que el fondo que sigue ya esté cargado. */
const ANTES_DEL_FIN_MS = 320;

type Props = {
  avatar: 'claudio' | 'antonio';
  camara: Camara;
  estado: EstadoAvatar;
  ancho: number;
  alto: number;
  /** Las fotos de siempre: debajo mientras arranca y solas si el video falla. */
  respaldo: ReactNode;
  /** false: tapado (una llamada encima, otra pantalla): solo el respaldo, sin video. */
  activo?: boolean;
  /** Saluda al aparecer en la pantalla. */
  saludar?: boolean;
};

/** Lo que falló en esta sesión no se vuelve a intentar (se queda con las fotos). */
let videoRoto = false;

export const CuerpoVideo = forwardRef<ControlCuerpo, Props>(function CuerpoVideo({ avatar, camara, estado, ancho, alto, respaldo, activo = true, saludar = false }, ref) {
  const clips = CLIPS[avatar];
  const reducido = useReducedMotion();
  const director = useRef<DirectorVideo | null>(null);
  if (!director.current) {
    director.current = new DirectorVideo({ hay: clips ? CLIPS_VIDEO.filter((c) => clips[c] != null) : [], reducido });
  }
  const [capas, setCapas] = useState<[Reproduccion | null, Reproduccion | null]>(() => {
    const d = director.current!;
    return [(saludar && d.golpe('saluda')) || d.reproduccion, null];
  });
  const frente = useRef<0 | 1>(0);
  const activoRef = useRef(activo);
  activoRef.current = activo;
  const pendiente = useRef<0 | 1 | null>(null);
  const avisado = useRef(-1);
  const [visto, setVisto] = useState(false);
  const [roto, setRoto] = useState(videoRoto);
  const op0 = useSharedValue(0);
  const op1 = useSharedValue(0);
  const op = useMemo(() => [op0, op1] as const, [op0, op1]);
  /** El clip que espera fundirse (para que un reloj viejo no funda uno más nuevo antes de tiempo). */
  const esperaN = useRef(-1);
  const relojes = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => relojes.current.forEach(clearTimeout), []);

  const fundir = useCallback(
    (capa: 0 | 1) => {
      if (pendiente.current !== capa && frente.current === capa) {
        // La primera capa: aparece sobre el respaldo.
        op[capa].value = withTiming(1, { duration: FUNDIDO_MS });
        setVisto(true);
        return;
      }
      if (pendiente.current !== capa) return;
      pendiente.current = null;
      const vieja = frente.current;
      frente.current = capa;
      op[capa].value = withTiming(1, { duration: FUNDIDO_MS });
      op[vieja].value = withTiming(0, { duration: FUNDIDO_MS });
      setVisto(true);
      relojes.current.push(
        setTimeout(() => {
          // Ya no se ve: se descarga (salvo que en el camino se haya vuelto a usar).
          if (frente.current !== vieja && pendiente.current !== vieja) setCapas((c) => (vieja === 0 ? [null, c[1]] : [c[0], null]));
        }, FUNDIDO_MS + 60)
      );
    },
    [op]
  );

  const poner = useCallback(
    (r: Reproduccion | null) => {
      if (!r) return;
      // Tapado no hay videos: el clip nuevo queda listo en la capa 0 para cuando vuelva.
      if (!activoRef.current) {
        frente.current = 0;
        pendiente.current = null;
        setCapas([r, null]);
        return;
      }
      const atras: 0 | 1 = frente.current === 0 ? 1 : 0;
      pendiente.current = atras;
      op[atras].value = 0;
      esperaN.current = r.n;
      setCapas((c) => (atras === 0 ? [r, c[1]] : [c[0], r]));
      relojes.current.push(setTimeout(() => esperaN.current === r.n && fundir(atras), ESPERA_MAX_MS));
    },
    [fundir, op]
  );

  // Tapado, los videos se desmontan; al volver, la capa de adelante aparece otra vez sobre el respaldo.
  // Si lo taparon con un golpe a medias (un atajo que abre la llamada antes de que «señala» sonara), el
  // guion se queda esperando un «terminó» que no va a llegar: se da por terminado y vuelve al fondo. Al
  // volver arranca limpio desde la capa 0, sin avisos ni relojes viejos.
  useEffect(() => {
    if (activo) return;
    const d = director.current!;
    const r = d.reproduccion.bucle ? d.reproduccion : d.termino(d.reproduccion.n) ?? d.reproduccion;
    op0.value = 0;
    op1.value = 0;
    pendiente.current = null;
    esperaN.current = -1;
    avisado.current = -1;
    frente.current = 0;
    setCapas([r, null]);
    setVisto(false);
  }, [activo, op0, op1]);

  // Cada estado nuevo: el guion decide si cambia de clip. Si empezó a hablar en medio de un golpe,
  // un reloj lo pasa a «habla» cuando el golpe cumple su tiempo mínimo (no hay otro estado que lo avise).
  const relojHabla = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const d = director.current!;
    poner(d.estado(estado));
    if (relojHabla.current) clearTimeout(relojHabla.current);
    relojHabla.current = null;
    const falta = d.msParaHablar();
    if (falta !== null) relojHabla.current = setTimeout(() => poner(d.revisar()), falta + 20);
  }, [estado, poner]);
  useEffect(() => () => void (relojHabla.current && clearTimeout(relojHabla.current)), []);

  const alEstado = useCallback(
    (r: Reproduccion, s: AVPlaybackStatus) => {
      if (!s.isLoaded || r.bucle || avisado.current === r.n) return;
      const dura = s.durationMillis ?? 0;
      if (s.didJustFinish || (dura > 0 && s.positionMillis >= dura - ANTES_DEL_FIN_MS)) {
        avisado.current = r.n;
        poner(director.current!.termino(r.n));
      }
    },
    [poner]
  );

  const alFallar = useCallback((e: string) => {
    videoRoto = true;
    miga(`avatar en video: vuelve a las fotos (${String(e).slice(0, 80)})`);
    setRoto(true);
  }, []);

  const encuadre = useMemo(() => encuadrar(ancho, alto, VENTANAS[avatar][camara]), [ancho, alto, avatar, camara]);
  useImperativeHandle(ref, () => ({ zonaEn: async (_x: number, y: number) => zonaVideo(y, encuadre, avatar) }), [encuadre, avatar]);

  const estilo0 = useAnimatedStyle(() => ({ opacity: op0.value }));
  const estilo1 = useAnimatedStyle(() => ({ opacity: op1.value }));
  const fondo = avatarPorId(avatar).tema.fondo;

  if (!clips || roto || !activo || ancho <= 0 || alto <= 0) return <>{respaldo}</>;

  const capa = (i: 0 | 1, r: Reproduccion | null, estilo: typeof estilo0) =>
    r ? (
      <Animated.View key={i} style={[StyleSheet.absoluteFill, estilo]} pointerEvents="none">
        <Video
          key={`${r.clip}-${r.n}`}
          source={clips[r.clip as ClipVideo]}
          style={{ position: 'absolute', left: encuadre.left, top: encuadre.top, width: encuadre.width, height: encuadre.height }}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping={r.bucle}
          isMuted
          progressUpdateIntervalMillis={100}
          onReadyForDisplay={() => fundir(i)}
          onPlaybackStatusUpdate={(s) => alEstado(r, s)}
          onError={alFallar}
        />
      </Animated.View>
    ) : null;

  const transparente = `${fondo}00`;
  const ladoIzq = Math.max(0, encuadre.left);
  const ladoDer = Math.min(ancho, encuadre.left + encuadre.width);
  const anchoLado = Math.max(8, (ladoDer - ladoIzq) * (encuadre.left > 0 ? 0.16 : 0.07));
  return (
    <View style={[StyleSheet.absoluteFill, s.recorte]} pointerEvents="none">
      {!visto ? respaldo : <View style={[StyleSheet.absoluteFill, { backgroundColor: fondo }]} />}
      {capa(0, capas[0], estilo0)}
      {capa(1, capas[1], estilo1)}
      <LinearGradient colors={[fondo, transparente]} style={[s.borde, s.arriba]} />
      <LinearGradient colors={[transparente, fondo]} style={[s.borde, s.abajo]} />
      {/* Los lados se funden donde termina el video (acostado quedan márgenes) o en el borde de la caja. */}
      <LinearGradient colors={[fondo, transparente]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.lado, { left: ladoIzq, width: anchoLado }]} />
      <LinearGradient colors={[transparente, fondo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.lado, { left: ladoDer - anchoLado, width: anchoLado }]} />
    </View>
  );
});

const s = StyleSheet.create({
  recorte: { overflow: 'hidden' },
  borde: { position: 'absolute', left: 0, right: 0, height: '9%' },
  arriba: { top: 0 },
  abajo: { bottom: 0 },
  lado: { position: 'absolute', top: 0, bottom: 0 },
});
