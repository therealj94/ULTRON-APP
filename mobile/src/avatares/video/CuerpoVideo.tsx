/**
 * EL CUERPO EN VIDEO de Claudio y ANT-ONIO: sus clips animados (clips.ts), elegidos por el guion
 * (guion.ts) con el mismo estado que recibe el cuerpo 3D (EstadoAvatar).
 *
 * Dos capas de video, una encima de otra: el clip nuevo arranca en la otra capa, invisible, y cuando
 * ya está DIBUJANDO cuadros se cambia sin que la imagen baje nunca: si la capa nueva va arriba, se funde
 * encima de la vieja (que sigue entera debajo); si va abajo, se prende entera detrás y la vieja se
 * desvanece encima. Antes las dos se cruzaban a la vez (a la mitad, las dos a 0,5 dejaban ver el fondo:
 * un bajón de luz en cada cambio) y, si el clip nuevo tardaba, se fundía igual una capa todavía negra.
 * Eso, más un cambio de clip en cada pausa entre frases (guion.ts lo frena ahora), era el «parpadea
 * bien raro» que vio José el 2-oct. Como todos los clips empiezan y terminan en la misma pose, el
 * cambio no se nota. Un golpe (risa, saludo…) avisa un poco antes de terminar para que el fondo que
 * sigue ya esté listo cuando acaba.
 *
 * El respaldo (las fotos de siempre) se ve debajo hasta que el primer clip terminó de aparecer, y se
 * queda solo si el video falla o el cuerpo está tapado (activo = false: sin decodificadores gastando
 * batería).
 * Los bordes se funden con el color de fondo del avatar, para que no se vea un rectángulo.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import { Asset } from 'expo-asset';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { miga } from '../../lib/reporte';
import { avatarPorId } from '../catalogo';
import type { ControlCuerpo } from '../../avatar3d/AvatarVivo';
import type { Camara, EstadoAvatar } from '../../avatar3d/tipos';
import { CLIPS } from './clips';
import { pistasVideo, suscribirPistas } from './pistas';
import { CLIPS_VIDEO, DirectorVideo, encuadrar, VENTANAS, zonaVideo, type ClipVideo, type Reproduccion } from './guion';

/** Cuánto dura el fundido entre clips. */
const FUNDIDO_MS = 220;
/**
 * Último recurso: si el clip nuevo no avisa que dibuja en esto (ni por onReadyForDisplay ni porque su
 * posición avanza), se cambia igual para no quedarse trabado en un clip que ya no toca.
 */
const ESPERA_MAX_MS = 2500;
/** La posición avanzó esto: el reproductor ya está dibujando cuadros (algunos Android no avisan de otra forma). */
const DIBUJANDO_MS = 60;
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
  /** El video no se pudo usar: quien lo monta puede pasar a otro cuerpo (el 3D) en vez de las fotos. */
  onFallo?: () => void;
};

/** Lo que falló en esta sesión no se vuelve a intentar (se queda con las fotos). */
let videoRoto = false;

/**
 * Cada clip, copiado a un archivo de verdad en el teléfono (file://…). En la APK los videos van
 * empaquetados como recursos (res/raw) y `require()` da solo el NOMBRE del recurso: el reproductor
 * de expo-av lo trataba como ruta de archivo y fallaba (FileDataSourceException en el Samsung de
 * José, 1-oct): se veían las fotos quietas. expo-asset lo copia una vez a la caché —igual que hace
 * el modelo 3D (Avatar3D.tsx)— y se reproduce desde ahí. Por OTA ya llegan como archivo: no copia.
 */
const archivos = new Map<number, Promise<string>>();
function archivoDe(mod: number): Promise<string> {
  let p = archivos.get(mod);
  if (!p) {
    p = (async () => {
      const a = Asset.fromModule(mod);
      await a.downloadAsync();
      const uri = a.localUri || a.uri || '';
      // `file:///android_res/…` es la dirección del recurso dentro de la APK: el reproductor no la abre.
      // Lo demás se reproduce: un archivo (teléfono), o http(s)/blob (desarrollo y web, Codex en #109).
      if (!/^(file|content|https?|blob):/.test(uri) || uri.startsWith('file:///android_res/')) throw new Error(`el clip no quedó en archivo (${uri.slice(0, 40) || 'sin dirección'})`);
      return uri;
    })();
    p.catch(() => archivos.delete(mod));
    archivos.set(mod, p);
  }
  return p;
}

export const CuerpoVideo = forwardRef<ControlCuerpo, Props>(function CuerpoVideo({ avatar, camara, estado, ancho, alto, respaldo, activo = true, saludar = false, onFallo }, ref) {
  const clips = CLIPS[avatar];
  /** Los clips de este avatar ya copiados a archivo (null mientras se preparan: se ven las fotos). */
  const [uris, setUris] = useState<Partial<Record<ClipVideo, string>> | null>(null);
  const reducido = useReducedMotion();
  const director = useRef<DirectorVideo | null>(null);
  if (!director.current) {
    director.current = new DirectorVideo({ hay: clips ? CLIPS_VIDEO.filter((c) => clips[c] != null) : [], reducido });
    // Lo que ya está pasando (su computadora trabajando, leyendo); un golpe viejo no se hace.
    director.current.pistas({ ...pistasVideo.ultimo(), golpe: null });
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
  const onFalloRef = useRef(onFallo);
  onFalloRef.current = onFallo;
  useEffect(() => {
    setUris(null);
    if (!clips) return;
    if (videoRoto) {
      // Ya falló antes en esta sesión: que quien lo monta pase directo a su otro cuerpo.
      onFalloRef.current?.();
      return;
    }
    let vivo = true;
    void Promise.all(CLIPS_VIDEO.filter((c) => clips[c] != null).map(async (c) => [c, await archivoDe(clips[c])] as const))
      .then((pares) => vivo && setUris(Object.fromEntries(pares)))
      .catch((e) => {
        if (!vivo) return;
        videoRoto = true;
        miga(`avatar en video: no pude preparar los clips (${String(e?.message || e).slice(0, 80)})`);
        setRoto(true);
        onFalloRef.current?.();
      });
    return () => {
      vivo = false;
    };
  }, [clips]);
  const op0 = useSharedValue(0);
  const op1 = useSharedValue(0);
  const op = useMemo(() => [op0, op1] as const, [op0, op1]);
  /** El clip que espera fundirse (para que un reloj viejo no funda uno más nuevo antes de tiempo). */
  const esperaN = useRef(-1);
  const relojes = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => relojes.current.forEach(clearTimeout), []);

  /** Las reproducciones que ya se fundieron (los avisos de que dibuja llegan muchas veces). */
  const fundidas = useRef(new Set<number>());

  const fundir = useCallback(
    (capa: 0 | 1, n: number) => {
      if (fundidas.current.has(n)) return;
      if (pendiente.current !== capa && frente.current === capa) {
        // La primera capa: aparece sobre el respaldo, que se quita cuando ya terminó de aparecer.
        fundidas.current.add(n);
        op[capa].value = withTiming(1, { duration: FUNDIDO_MS });
        relojes.current.push(setTimeout(() => setVisto(true), FUNDIDO_MS + 40));
        return;
      }
      if (pendiente.current !== capa || esperaN.current !== n) return;
      fundidas.current.add(n);
      pendiente.current = null;
      esperaN.current = -1;
      const vieja = frente.current;
      frente.current = capa;
      if (capa > vieja) {
        // La nueva va arriba: se funde encima de la vieja, que sigue entera debajo.
        op[capa].value = withTiming(1, { duration: FUNDIDO_MS });
      } else {
        // La nueva va abajo: se prende entera detrás y la vieja se desvanece encima.
        op[capa].value = 1;
        op[vieja].value = withTiming(0, { duration: FUNDIDO_MS });
      }
      relojes.current.push(
        setTimeout(() => {
          if (frente.current === vieja || pendiente.current === vieja) return;
          op[vieja].value = 0;
          // Ya no se ve: se descarga (salvo que en el camino se haya vuelto a usar).
          setCapas((c) => (vieja === 0 ? [null, c[1]] : [c[0], null]));
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
      relojes.current.push(setTimeout(() => esperaN.current === r.n && fundir(atras, r.n), ESPERA_MAX_MS));
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
    // Al volver se monta de nuevo: tiene que poder fundirse otra vez aunque sea la misma reproducción.
    fundidas.current.clear();
    setCapas([r, null]);
    setVisto(false);
  }, [activo, op0, op1]);

  // Cada estado nuevo y cada pista (pistas.ts: su computadora, la lectura, los golpes por lo que dijo o
  // pasó): el guion decide si cambia de clip. Además avisa cuándo tiene que volver a mirar sin que llegue
  // nada nuevo: empezó a hablar en medio de un golpe (pasa a «habla» cuando el golpe cumple su tiempo
  // mínimo), un fondo nuevo se está asentando (dejó de hablar: ¿fue solo una pausa?) o toca ponerse a
  // esperar o dejar de esperar. Un solo reloj, que se rearma después de cada cambio.
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armar = useRef(() => {});
  armar.current = () => {
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = null;
    const falta = director.current!.msParaRevisar();
    if (falta !== null)
      reloj.current = setTimeout(() => {
        poner(director.current!.revisar());
        armar.current();
      }, falta + 20);
  };
  const decidir = useCallback(
    (r: Reproduccion | null) => {
      poner(r);
      armar.current();
    },
    [poner]
  );
  useEffect(() => decidir(director.current!.estado(estado)), [estado, decidir]);
  useEffect(() => suscribirPistas((p) => decidir(director.current!.pistas(p))), [decidir]);
  useEffect(() => () => void (reloj.current && clearTimeout(reloj.current)), []);

  const alEstado = useCallback(
    (capa: 0 | 1, r: Reproduccion, s: AVPlaybackStatus) => {
      if (!s.isLoaded) return;
      // Ya avanza: está dibujando cuadros (respaldo de onReadyForDisplay, que no todos los Android mandan).
      if (s.positionMillis >= DIBUJANDO_MS) fundir(capa, r.n);
      if (r.bucle || avisado.current === r.n) return;
      const dura = s.durationMillis ?? 0;
      if (s.didJustFinish || (dura > 0 && s.positionMillis >= dura - ANTES_DEL_FIN_MS)) {
        avisado.current = r.n;
        decidir(director.current!.termino(r.n));
      }
    },
    [decidir, fundir]
  );

  const alFallar = useCallback((e: string) => {
    videoRoto = true;
    miga(`avatar en video: no se pudo reproducir (${String(e).slice(0, 80)})`);
    setRoto(true);
    onFalloRef.current?.();
  }, []);

  const encuadre = useMemo(() => encuadrar(ancho, alto, VENTANAS[avatar][camara]), [ancho, alto, avatar, camara]);
  useImperativeHandle(ref, () => ({ zonaEn: async (_x: number, y: number) => zonaVideo(y, encuadre, avatar) }), [encuadre, avatar]);

  const estilo0 = useAnimatedStyle(() => ({ opacity: op0.value }));
  const estilo1 = useAnimatedStyle(() => ({ opacity: op1.value }));
  const fondo = avatarPorId(avatar).tema.fondo;

  if (!clips || !uris || roto || !activo || ancho <= 0 || alto <= 0) return <>{respaldo}</>;

  const capa = (i: 0 | 1, r: Reproduccion | null, estilo: typeof estilo0) =>
    r ? (
      <Animated.View key={i} style={[StyleSheet.absoluteFill, estilo]} pointerEvents="none">
        <Video
          key={`${r.clip}-${r.n}`}
          source={{ uri: uris[r.clip as ClipVideo] || uris.reposo! }}
          style={{ position: 'absolute', left: encuadre.left, top: encuadre.top, width: encuadre.width, height: encuadre.height }}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping={r.bucle}
          isMuted
          progressUpdateIntervalMillis={100}
          onReadyForDisplay={() => fundir(i, r.n)}
          onPlaybackStatusUpdate={(s) => alEstado(i, r, s)}
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
