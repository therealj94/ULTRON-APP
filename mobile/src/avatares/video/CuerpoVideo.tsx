/**
 * EL CUERPO EN VIDEO de Claudio y ANT-ONIO: sus clips animados (clips.ts), elegidos por el guion
 * (guion.ts) con el mismo estado que recibe el cuerpo 3D (EstadoAvatar).
 *
 * Dos capas de video, una encima de otra. El guion dice qué clip toca; la mezcla (transicion.ts, pura y
 * probada) dice cuándo y cómo entra, y esta vista ejecuta sus órdenes:
 *
 *  · el clip nuevo se monta en la capa libre, invisible y quieto en su cuadro 0 (la pose de reposo);
 *  · arranca cuando el de ahora está en reposo (el principio o el final de su clip: reposos.ts). Si va por
 *    la mitad de su gesto, lo termina —un poco más rápido si hay apuro, como al empezar a hablar— y el
 *    nuevo arranca justo al llegar. Así los dos están en la misma pose durante el fundido y no se ven dos
 *    zorros a la vez (el «glitch» al cambiar de gesto que vio José);
 *  · se funde recién cuando su posición avanzó (está DIBUJANDO de verdad: en Android, onReadyForDisplay
 *    llega antes del primer cuadro), en 260 ms con curva suave, siempre sobre la vieja entera;
 *  · un pedido en medio de un fundido espera a que termine; uno que llega mientras el nuevo carga lo
 *    reemplaza. Nunca se remonta ni se recarga lo que se ve.
 *
 * Todas las capas se montan quietas (shouldPlay={false}, sin `positionMillis`) y se ponen en marcha o
 * cambian de ritmo con la API del reproductor (playAsync, setRateAsync): las props de estado no cambian
 * nunca después de montar, así que expo-av no vuelve a aplicarlas a mitad de un clip.
 *
 * El respaldo (las fotos de siempre) se ve debajo hasta que el primer clip terminó de aparecer, y se
 * queda solo si el video falla o el cuerpo está tapado (activo = false: sin decodificadores gastando
 * batería). Los bordes se funden con el color de fondo del avatar, para que no se vea un rectángulo.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import { Asset } from 'expo-asset';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { miga } from '../../lib/reporte';
import { avatarPorId } from '../catalogo';
import type { ControlCuerpo } from '../../avatar3d/AvatarVivo';
import type { Camara, EstadoAvatar } from '../../avatar3d/tipos';
import { CLIPS } from './clips';
import { pistasVideo, suscribirPistas } from './pistas';
import { CLIPS_VIDEO, DirectorVideo, encuadrar, GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS, VENTANAS, zonaVideo, type ClipVideo, type Reproduccion } from './guion';
import { ANTES_DEL_FIN_MS, MezclaCapas, type Capa, type Indice, type Orden } from './transicion';

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
  const reducidoRef = useRef(reducido);
  reducidoRef.current = reducido;
  const director = useRef<DirectorVideo | null>(null);
  if (!director.current) {
    // El golpe no se corta (transicion.ts lo termina hasta el reposo): pide «habla» antes.
    const d = new DirectorVideo({ hay: clips ? CLIPS_VIDEO.filter((c) => clips[c] != null) : [], reducido, golpeAntesDeHablarMs: GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS });
    // Lo que ya está pasando (su computadora trabajando, leyendo); un golpe viejo no se hace.
    d.pistas({ ...pistasVideo.ultimo(), golpe: null });
    if (saludar) d.golpe('saluda');
    director.current = d;
  }
  const [visto, setVisto] = useState(false);
  const [roto, setRoto] = useState(videoRoto);
  /** Las capas cambian dentro de la mezcla: esto solo hace que la vista se vuelva a pintar. */
  const [, setVersion] = useState(0);
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
  const ref0 = useRef<Video>(null);
  const ref1 = useRef<Video>(null);
  const refs = useMemo(() => [ref0, ref1] as const, []);

  // La mezcla de capas: sus órdenes se hacen aquí con expo-av y reanimated.
  const ordenar = useRef<(o: Orden) => void>(() => {});
  ordenar.current = (o: Orden) => {
    switch (o.tipo) {
      case 'montar':
      case 'quitar':
        op[o.capa].value = 0;
        setVersion((v) => v + 1);
        break;
      case 'tocar':
        refs[o.capa].current?.playAsync().catch(() => {});
        break;
      case 'ritmo':
        refs[o.capa].current?.setRateAsync(o.ritmo, false).catch(() => {});
        break;
      case 'fundir': {
        const otra: Indice = o.capa === 0 ? 1 : 0;
        const curva = { duration: o.ms, easing: Easing.inOut(Easing.cubic) };
        if (o.sobre === 'respaldo' || o.capa > otra) {
          // La nueva va arriba: se funde encima de la vieja, que sigue entera debajo.
          op[o.capa].value = withTiming(1, curva);
        } else {
          // La nueva va abajo, y ya está dibujando: se prende entera y la vieja se desvanece encima.
          // Con la misma curva, se ve exactamente igual que fundirla encima.
          op[o.capa].value = 1;
          op[otra].value = withTiming(0, curva);
        }
        break;
      }
      case 'listo':
        setVisto(true);
        break;
    }
  };
  /** Lo que decidió el guion, a la mezcla (abajo, con los relojes del guion). */
  const decidirRef = useRef<(r: Reproduccion | null) => void>(() => {});
  const mezcla = useRef<MezclaCapas | null>(null);
  if (!mezcla.current)
    mezcla.current = new MezclaCapas({
      avatar,
      reducido: () => !!reducidoRef.current,
      ordenar: (o) => ordenar.current(o),
      trabado: (clip, definitivo, r) => {
        miga(`avatar en video: el clip ${clip} no arrancó${definitivo ? ' (sigue el de antes)' : ' (otra vez)'}`);
        // Un golpe que no se pudo hacer: el guion no se queda esperando que termine.
        if (definitivo) decidirRef.current(director.current!.termino(r.n));
      },
    });
  const m = mezcla.current;

  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programar = useCallback(() => {
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = null;
    const ms = mezcla.current!.msParaRevisar();
    if (ms !== null)
      reloj.current = setTimeout(() => {
        mezcla.current!.revisar();
        programar();
      }, ms);
  }, []);
  useEffect(() => () => void (reloj.current && clearTimeout(reloj.current)), []);

  /** Hay videos en pantalla (si no, el guion sigue decidiendo y al volver se pide lo que toque). */
  const enVivo = !!clips && !!uris && !roto && activo && ancho > 0 && alto > 0;
  const enVivoRef = useRef(enVivo);
  enVivoRef.current = enVivo;
  const avisado = useRef(-1);

  // Cada estado nuevo y cada pista (pistas.ts: su computadora, la lectura, los golpes por lo que dijo o
  // pasó): el guion decide si cambia de clip. Además avisa cuándo tiene que volver a mirar sin que llegue
  // nada nuevo: empezó a hablar en medio de un golpe (pasa a «habla» cuando el golpe cumple su tiempo
  // mínimo), un fondo nuevo se está asentando (dejó de hablar: ¿fue solo una pausa?) o toca ponerse a
  // esperar o dejar de esperar. Un solo reloj, que se rearma después de cada cambio.
  const relojGuion = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armar = useRef(() => {});
  decidirRef.current = (r: Reproduccion | null) => {
    if (r && enVivoRef.current) {
      mezcla.current!.pedir(r);
      programar();
    }
    armar.current();
  };
  armar.current = () => {
    if (relojGuion.current) clearTimeout(relojGuion.current);
    relojGuion.current = null;
    const falta = director.current!.msParaRevisar();
    if (falta !== null) relojGuion.current = setTimeout(() => decidirRef.current(director.current!.revisar()), falta + 20);
  };
  useEffect(() => decidirRef.current(director.current!.estado(estado)), [estado]);
  useEffect(() => suscribirPistas((p) => decidirRef.current(director.current!.pistas(p))), []);
  useEffect(() => () => void (relojGuion.current && clearTimeout(relojGuion.current)), []);

  // Con videos en pantalla, se pide lo que toca. Tapados, se desmontan; si lo taparon con un golpe a
  // medias (un atajo que abre la llamada antes de que «señala» sonara), el guion se queda esperando un
  // «terminó» que no va a llegar: se da por terminado y vuelve al fondo. Al volver arranca limpio.
  // (Mientras los clips se preparan no es «tapado»: el saludo del principio espera a que estén.)
  const activoRef = useRef(activo);
  activoRef.current = activo;
  useEffect(() => {
    const d = director.current!;
    if (enVivo) {
      m.pedir(d.reproduccion);
      programar();
      return;
    }
    if (!activoRef.current && !d.reproduccion.bucle) d.termino(d.reproduccion.n);
    m.reiniciar();
    op0.value = 0;
    op1.value = 0;
    avisado.current = -1;
    setVisto(false);
    setVersion((v) => v + 1);
  }, [enVivo, m, op0, op1, programar]);

  const alEstado = useCallback(
    (i: Indice, c: Capa, s: AVPlaybackStatus) => {
      if (!s.isLoaded) return;
      const mz = mezcla.current!;
      mz.estado(i, c.clave, s.positionMillis, s.isPlaying);
      programar();
      // Un golpe en pantalla avisa antes de terminar: el fondo que sigue se carga mientras llega al reposo.
      if (c.r.bucle || mz.frente !== i || avisado.current === c.r.n) return;
      const dura = s.durationMillis ?? 0;
      if (s.didJustFinish || (dura > 0 && s.positionMillis >= dura - ANTES_DEL_FIN_MS)) {
        avisado.current = c.r.n;
        decidirRef.current(director.current!.termino(c.r.n));
      }
    },
    [programar]
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

  if (!enVivo || !uris) return <>{respaldo}</>;

  const capa = (i: Indice, estilo: typeof estilo0) => {
    const c = m.capas[i];
    return c ? (
      <Animated.View key={i} style={[StyleSheet.absoluteFill, estilo]} pointerEvents="none">
        <Video
          key={c.clave}
          ref={refs[i]}
          source={{ uri: uris[c.r.clip] || uris.reposo! }}
          style={{ position: 'absolute', left: encuadre.left, top: encuadre.top, width: encuadre.width, height: encuadre.height }}
          resizeMode={ResizeMode.COVER}
          shouldPlay={false}
          isLooping={c.r.bucle}
          isMuted
          progressUpdateIntervalMillis={100}
          onLoad={() => {
            mezcla.current!.cargado(i, c.clave);
            programar();
          }}
          onPlaybackStatusUpdate={(s) => alEstado(i, c, s)}
          onError={alFallar}
        />
      </Animated.View>
    ) : null;
  };

  const transparente = `${fondo}00`;
  const ladoIzq = Math.max(0, encuadre.left);
  const ladoDer = Math.min(ancho, encuadre.left + encuadre.width);
  const anchoLado = Math.max(8, (ladoDer - ladoIzq) * (encuadre.left > 0 ? 0.16 : 0.07));
  return (
    <View style={[StyleSheet.absoluteFill, s.recorte]} pointerEvents="none">
      {!visto ? respaldo : <View style={[StyleSheet.absoluteFill, { backgroundColor: fondo }]} />}
      {capa(0, estilo0)}
      {capa(1, estilo1)}
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
