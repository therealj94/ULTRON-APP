/**
 * CamaraVision — los ojos de ULTRON en el teléfono.
 *
 * Motor 'mlkit' (por defecto): react-native-vision-camera v4 + frame processor con ML Kit
 * (react-native-vision-camera-face-detector) a ~10 fps, modo 'fast', sin landmarks, con clasificación
 * (sonrisa y ojos abiertos). Cada cuadro se traduce a una `Observacion` y pasa por `MaquinaEscena`
 * (src/lib/escena.ts): la misma `Escena` que la web, con x espejado para la cámara frontal.
 *
 * Motor 'servidor' (respaldo): si vision-camera no está disponible en runtime (módulo ausente, plugin
 * sin compilar, error de dispositivo, DETECCION_NATIVA=false) se cae al modo anterior: expo-camera en
 * 1×1 px y una foto cada 12 s a /api/vision/analyze (etiquetas → presencia aproximada).
 *
 * Batería: el detector se pausa en background (isActive=false) y mientras la cara duerme la cámara solo
 * se enciende en una ventana de 2,5 s cada 12 s (sensor apagado el resto; ML Kit a 2 fps dentro de la
 * ventana, suficiente para detectar la llegada de alguien). onEscena sale como máximo cada 500 ms y de
 * inmediato con eventos; onGaze va suavizado (EMA) y solo mientras hay cara.
 *
 * Orientación: VisionCamera no asigna targetRotation al ImageAnalysis del frame processor («user is
 * responsible for rotating himself»), así que ML Kit endereza el cuadro respecto a la rotación de
 * pantalla que había al CREAR la cámara. Si la pantalla gira después (180° dentro del lock LANDSCAPE, o
 * el lock aterriza tras montar), cx/cy/yaw saldrían invertidos: <Camera> se remonta (key) al detectar
 * el giro para tomar la orientación actual como referencia.
 *
 * takePhoto sigue disponible por `grabRef` («qué ves»: frame bajo demanda en base64 jpeg).
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, View, type AppStateStatus } from 'react-native';
import { CameraView } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as ScreenOrientation from 'expo-screen-orientation';
import { describeImage } from '../lib/api';
import {
  FOV_DIAGONAL_GRADOS,
  MaquinaEscena,
  escenaApagada,
  escenaDesdeEtiquetas,
  fovDiagonalDesdeHorizontal,
  observacionMlkit,
  type CaraMlkit,
  type Escena,
  type MotorVision,
  type OrientacionCuadro,
} from '../lib/escena';

/**
 * Ponlo en false para forzar el respaldo por servidor en runtime (no se llama a vision-camera aunque
 * esté en el APK). OJO: no evita compilar lo nativo — vision-camera, el face-detector y worklets-core
 * entran por autolinking en cuanto están en package.json; si Gradle fallara por ellos, la contingencia
 * real es quitar las tres dependencias, el plugin de app.json y el plugin de babel.
 */
export const DETECCION_NATIVA = true;

/** Cuadros por segundo que analiza ML Kit despierto / dentro de la ventana dormida. */
export const FPS_DETECCION = 10;
export const FPS_DORMIDO = 2;
/** Cara dormida: la cámara se enciende DORMIDO_VENTANA_MS cada DORMIDO_PERIODO_MS (sensor apagado el resto). */
export const DORMIDO_VENTANA_MS = 2_500;
export const DORMIDO_PERIODO_MS = 12_000;
/** Emisión máxima de onEscena sin eventos. */
const ESCENA_CADA_MS = 500;
/** Respaldo por servidor: foto cada 12 s (30 s si la cara duerme). DeskScreen los usa para la frescura. */
export const SERVIDOR_CADA_MS = 12_000;
export const SERVIDOR_DORMIDO_MS = 30_000;
/** Con motor nativo, la mesa se escanea en el servidor mucho menos (solo si hay alguien). */
const MESA_NATIVO_MS = 60_000;
/** Si el frame processor no entrega nada en este tiempo, algo falta (worklets/plugin) → respaldo. */
const WATCHDOG_MS = 9_000;

export type FrameGrabber = () => Promise<string | null>;

export type CamaraVisionProps = {
  /** Permiso concedido y visión encendida. Con false se emite una vez `{ motor: 'ninguno' }`. */
  enabled: boolean;
  /** La cara está en SLEEPING: cámara solo 2,5 s cada 12 s (nativo) / una foto cada 30 s (servidor). */
  dormido?: boolean;
  /** Se rellena con una función que devuelve el frame actual en base64 (jpeg), o null. */
  grabRef?: React.MutableRefObject<FrameGrabber | null>;
  /** Escena interpretada: ≤ 1 cada 500 ms, inmediata cuando trae eventos. */
  onEscena?: (e: Escena) => void;
  /** Mirada suavizada hacia la persona (x,y en -1..1, x ya espejado). `activa` false = no hay cara. */
  onGaze?: (x: number, y: number, activa: boolean) => void;
  /** Etiquetas de la mesa según el nodo de visión (servidor). */
  onObjects?: (labels: string[]) => void;
  /** Resumen + etiquetas del servidor (comentario proactivo en DeskScreen). */
  onScene?: (summary: string, labels: string[]) => void;
  /** Cambio de motor real en uso. */
  onMotor?: (m: MotorVision) => void;
};

const LABEL_PROMPT =
  'Responde SOLO con una lista corta en español, separada por comas, de lo visible (máximo 6): persona, objetos, gestos evidentes (ej: persona, taza, teléfono, saluda). Sin frases.';

function parseLabels(text: string): string[] {
  return text
    .replace(/\.$/, '')
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase().replace(/^(una?|el|la|los|las|unos|unas)\s+/, ''))
    .filter((s) => s.length > 2 && s.length < 32)
    .slice(0, 6);
}

// ---------------------------------------------------------------- carga perezosa de lo nativo

type ModsNativos = {
  vc: typeof import('react-native-vision-camera');
  fd: typeof import('react-native-vision-camera-face-detector');
  wk: typeof import('react-native-worklets-core');
};

let modsCache: ModsNativos | null | undefined;

/** require() dentro de try: si el APK no trae el módulo nativo, no rompe la app. */
function cargarNativo(): ModsNativos | null {
  if (modsCache !== undefined) return modsCache;
  if (!DETECCION_NATIVA) return (modsCache = null);
  try {
    const vc = require('react-native-vision-camera') as ModsNativos['vc'];
    const fd = require('react-native-vision-camera-face-detector') as ModsNativos['fd'];
    const wk = require('react-native-worklets-core') as ModsNativos['wk'];
    if (typeof vc.useFrameProcessor !== 'function' || typeof fd.useFaceDetector !== 'function' || !wk.Worklets) throw new Error('módulos incompletos');
    modsCache = { vc, fd, wk };
  } catch (e) {
    console.warn('[vision] nativo no disponible:', (e as Error)?.message || e);
    modsCache = null;
  }
  return modsCache;
}

function useAppActiva() {
  const [activa, setActiva] = useState(AppState.currentState === 'active' || AppState.currentState == null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setActiva(s === 'active'));
    return () => sub.remove();
  }, []);
  return activa;
}

// ---------------------------------------------------------------- límite de errores

type LimiteProps = { onFallo: (motivo: string) => void; children: ReactNode };

class LimiteNativo extends Component<LimiteProps, { roto: boolean }> {
  state = { roto: false };
  static getDerivedStateFromError() {
    return { roto: true };
  }
  componentDidCatch(error: Error) {
    this.props.onFallo(`render: ${error?.message || String(error)}`);
  }
  render() {
    return this.state.roto ? null : this.props.children;
  }
}

// ---------------------------------------------------------------- motor nativo (ML Kit)

type ObsCb = (caras: CaraMlkit[], w: number, h: number, o: OrientacionCuadro, fovDiagonal: number) => void;

type NativaProps = {
  mods: ModsNativos;
  activa: boolean;
  dormido: boolean;
  grabRef?: React.MutableRefObject<FrameGrabber | null>;
  onObs: ObsCb;
  onFallo: (motivo: string) => void;
};

function CamaraNativa({ mods, activa, dormido, grabRef, onObs, onFallo }: NativaProps) {
  const { Camera, useCameraDevice, useCameraFormat, useFrameProcessor, runAtTargetFps, runAsync } = mods.vc;
  const { useFaceDetector } = mods.fd;
  const { Worklets, useSharedValue } = mods.wk;

  const camRef = useRef<InstanceType<typeof Camera>>(null);
  const device = useCameraDevice('front');
  const format = useCameraFormat(device, [{ videoResolution: { width: 640, height: 480 } }, { photoResolution: { width: 1280, height: 960 } }, { fps: 15 }]);
  const fps = format ? Math.max(format.minFps, Math.min(15, format.maxFps)) : undefined;

  // Campo de visión del formato → ángulo de posición que se descuenta del yaw (escena.anguloEsperado).
  // Android lo reporta como diagonal del sensor; iOS como horizontal del video.
  const fovDiagonal = useMemo(() => {
    const f = format?.fieldOfView;
    if (!format || !(typeof f === 'number' && f > 10 && f < 170)) return FOV_DIAGONAL_GRADOS;
    return Platform.OS === 'ios' ? fovDiagonalDesdeHorizontal(f, format.videoWidth, format.videoHeight) : f;
  }, [format]);
  const fovRef = useRef(fovDiagonal);
  fovRef.current = fovDiagonal;

  const opciones = useRef<import('react-native-vision-camera-face-detector').FrameFaceDetectionOptions>({
    performanceMode: 'fast',
    landmarkMode: 'none',
    contourMode: 'none',
    classificationMode: 'all',
    minFaceSize: 0.1,
    trackingEnabled: false,
    cameraFacing: 'front',
    autoMode: false,
  }).current;
  const { detectFaces, stopListeners } = useFaceDetector(opciones);
  useEffect(() => () => stopListeners(), [stopListeners]);

  const dormidoRef = useRef(dormido);
  dormidoRef.current = dormido;

  // --- cara dormida: la cámara solo se enciende en una ventana corta cada DORMIDO_PERIODO_MS
  const [ventana, setVentana] = useState(true);
  useEffect(() => {
    if (!dormido || !activa) {
      setVentana(true);
      return;
    }
    let abierta = true; // la cámara ya estaba encendida: el primer ciclo empieza con la ventana abierta
    let t: ReturnType<typeof setTimeout>;
    const ciclo = () => {
      abierta = !abierta;
      setVentana(abierta);
      t = setTimeout(ciclo, abierta ? DORMIDO_VENTANA_MS : DORMIDO_PERIODO_MS - DORMIDO_VENTANA_MS);
    };
    t = setTimeout(ciclo, DORMIDO_VENTANA_MS);
    return () => clearTimeout(t);
  }, [dormido, activa]);
  const camaraActiva = activa && (!dormido || ventana);

  const fpsObjetivo = useSharedValue(dormido ? FPS_DORMIDO : FPS_DETECCION);
  useEffect(() => {
    fpsObjetivo.value = dormido ? FPS_DORMIDO : FPS_DETECCION;
  }, [dormido, fpsObjetivo]);

  const obsRef = useRef(onObs);
  obsRef.current = onObs;
  const listoRef = useRef(false);

  const enviar = useMemo(
    () =>
      Worklets.createRunOnJS((caras: CaraMlkit[], w: number, h: number, o: string) => {
        listoRef.current = true;
        obsRef.current(caras, w, h, o as OrientacionCuadro, fovRef.current);
      }),
    [Worklets]
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      runAtTargetFps(fpsObjetivo.value, () => {
        'worklet';
        runAsync(frame, () => {
          'worklet';
          const caras = detectFaces(frame) as unknown as CaraMlkit[];
          enviar(caras, frame.width, frame.height, frame.orientation);
        });
      });
    },
    [detectFaces, enviar, fpsObjetivo]
  );

  // --- orientación: remontar <Camera> si la pantalla gira después de crearla (ver cabecera)
  const [claveCamara, setClaveCamara] = useState(0);
  const orientacionBase = useRef<ScreenOrientation.Orientation | null>(null);
  const remontar = useCallback(() => setClaveCamara((k) => k + 1), []);
  useEffect(() => {
    // Referencia = orientación de pantalla en el momento en que se crea esta instancia de la cámara.
    let viva = true;
    orientacionBase.current = null;
    ScreenOrientation.getOrientationAsync()
      .then((o) => {
        if (viva) orientacionBase.current = o;
      })
      .catch(() => {
        if (viva) orientacionBase.current = ScreenOrientation.Orientation.UNKNOWN;
      });
    return () => {
      viva = false;
    };
  }, [claveCamara]);
  const comprobarOrientacion = useCallback(() => {
    // Mientras `orientacionBase` sea null todavía no se sabe con qué referencia se creó la cámara: los
    // eventos se IGNORAN (nada de «cambio pendiente»). No se pierde nada, porque `getOrientationAsync`
    // se resuelve leyendo la orientación ACTUAL, así que la base que aterrice ya incluirá ese giro; y
    // marcarlo provocaría un remonte inútil que además vuelve a poner la base en null.
    ScreenOrientation.getOrientationAsync()
      .then((o) => {
        const base = orientacionBase.current;
        if (base === null) return;
        if (o !== base && o !== ScreenOrientation.Orientation.UNKNOWN) {
          console.info('[vision] pantalla girada', base, '→', o, ': remonto la cámara');
          remontar();
        }
      })
      .catch(() => {});
  }, [remontar]);
  useEffect(() => {
    const sub = ScreenOrientation.addOrientationChangeListener(() => comprobarOrientacion());
    return () => sub.remove();
  }, [comprobarOrientacion]);

  // Watchdog: cámara activa y ni un cuadro → el frame processor no corre (worklets/plugin) → respaldo.
  // Se rearma también tras errores recuperables (capture/*, format/*…): si en WATCHDOG_MS no vuelven los
  // cuadros, se pasa al servidor. Los errores session/* ya no esperan al watchdog (ver onError).
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armarWatchdog = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    listoRef.current = false;
    watchdog.current = setTimeout(() => {
      watchdog.current = null;
      if (!listoRef.current) onFallo('sin cuadros del frame processor');
    }, WATCHDOG_MS);
  }, [onFallo]);
  useEffect(() => {
    if (!activa || !device || dormido) return;
    armarWatchdog();
    return () => {
      if (watchdog.current) clearTimeout(watchdog.current);
      watchdog.current = null;
    };
  }, [activa, device, dormido, claveCamara, armarWatchdog]);

  useEffect(() => {
    if (!device) {
      const t = setTimeout(() => onFallo('sin cámara frontal'), 2500);
      return () => clearTimeout(t);
    }
  }, [device, onFallo]);

  // takePhoto bajo demanda → base64 (jpeg). El archivo temporal se borra después.
  useEffect(() => {
    if (!grabRef) return;
    grabRef.current = camaraActiva
      ? async () => {
          try {
            const cam = camRef.current;
            if (!cam) return null;
            const photo = await cam.takePhoto({ flash: 'off', enableShutterSound: false });
            const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
            const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
            void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
            return b64 || null;
          } catch {
            return null;
          }
        }
      : null;
    return () => {
      grabRef.current = null;
    };
  }, [camaraActiva, grabRef]);

  if (!device) return null;
  return (
    <Camera
      key={claveCamara}
      ref={camRef}
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={camaraActiva}
      format={format}
      fps={fps}
      photo
      photoQualityBalance="speed"
      pixelFormat="yuv"
      preview={false}
      outputOrientation="device"
      enableZoomGesture={false}
      frameProcessor={frameProcessor}
      onPreviewOrientationChanged={comprobarOrientacion}
      onError={(e) => {
        const code = String(e?.code || '');
        // session/* (cámara ocupada por otra app, sesión que no abre…) también cae al respaldo: con la cara
        // dormida el watchdog está desarmado, así que si no se pasara al servidor la app se quedaría ciega.
        if (/^(permission|device|system|session|frame-processor|unknown)\//.test(code) || code === '') {
          onFallo(`camera ${code}: ${e?.message || ''}`);
          return;
        }
        // capture/*, format/*, parameter/*…: no tumban el detector; si dejan de llegar cuadros, watchdog.
        console.warn('[vision] cámara:', code, e?.message);
        if (!dormidoRef.current) armarWatchdog();
      }}
    />
  );
}

// ---------------------------------------------------------------- motor servidor (respaldo)

type ServidorProps = {
  activa: boolean;
  dormido: boolean;
  grabRef?: React.MutableRefObject<FrameGrabber | null>;
  onEtiquetas: (summary: string, labels: string[]) => void;
};

function CamaraServidor({ activa, dormido, grabRef, onEtiquetas }: ServidorProps) {
  const ref = useRef<CameraView>(null);
  const busy = useRef(false);
  const readyRef = useRef(false);
  const cb = useRef(onEtiquetas);
  cb.current = onEtiquetas;

  const grab = useCallback(async (quality = 0.25): Promise<string | null> => {
    if (!ref.current || !readyRef.current) return null;
    try {
      const photo = await ref.current.takePictureAsync({ quality, base64: true, shutterSound: false, skipProcessing: true });
      return photo?.base64 || null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!grabRef) return;
    grabRef.current = activa ? () => grab(0.35) : null;
    return () => {
      grabRef.current = null;
    };
  }, [activa, grab, grabRef]);

  useEffect(() => {
    if (!activa) return;
    const id = setInterval(() => {
      void (async () => {
        if (busy.current) return;
        busy.current = true;
        try {
          const b64 = await grab(0.2);
          if (!b64) return;
          const text = await describeImage(b64, LABEL_PROMPT);
          if (!text) return;
          cb.current(text, parseLabels(text));
        } catch {
          /* red / cámara */
        } finally {
          busy.current = false;
        }
      })();
    }, dormido ? SERVIDOR_DORMIDO_MS : SERVIDOR_CADA_MS);
    return () => clearInterval(id);
  }, [activa, dormido, grab]);

  if (!activa) return null;
  return (
    <View style={styles.box} pointerEvents="none">
      <CameraView
        ref={ref}
        style={StyleSheet.absoluteFill}
        facing="front"
        animateShutter={false}
        onCameraReady={() => {
          readyRef.current = true;
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------- componente público

export function CamaraVision({ enabled, dormido = false, grabRef, onEscena, onGaze, onObjects, onScene, onMotor }: CamaraVisionProps) {
  const cb = useRef({ onEscena, onGaze, onObjects, onScene, onMotor });
  cb.current = { onEscena, onGaze, onObjects, onScene, onMotor };
  const appActiva = useAppActiva();
  const mods = useMemo(() => cargarNativo(), []);
  const [modo, setModo] = useState<'nativo' | 'servidor'>(mods ? 'nativo' : 'servidor');
  const maquina = useRef(new MaquinaEscena()).current;
  const ultimaEscena = useRef<Escena | null>(null);
  const ultimaEmision = useRef(0);
  const gaze = useRef({ x: 0, y: 0, activa: false });
  const motorAnunciado = useRef<MotorVision | null>(null);
  const dormidoRef = useRef(dormido);
  dormidoRef.current = dormido;
  const activa = enabled && appActiva;

  const anunciarMotor = useCallback((m: MotorVision) => {
    if (motorAnunciado.current === m) return;
    motorAnunciado.current = m;
    cb.current.onMotor?.(m);
  }, []);

  const emitir = useCallback((e: Escena) => {
    ultimaEscena.current = e;
    const now = Date.now();
    if (e.eventos.length || now - ultimaEmision.current >= ESCENA_CADA_MS) {
      ultimaEmision.current = now;
      cb.current.onEscena?.(e);
    }
  }, []);

  const fallo = useCallback(
    (motivo: string) => {
      console.warn('[vision] paso a respaldo por servidor:', motivo);
      maquina.reiniciar();
      ultimaEscena.current = null; // el primer ciclo del servidor debe poder emitir 'llego'
      if (gaze.current.activa) {
        gaze.current = { x: 0, y: 0, activa: false };
        cb.current.onGaze?.(0, 0, false);
      }
      setModo('servidor');
    },
    [maquina]
  );

  // Cámara apagada / sin permiso: una sola escena 'ninguno' y mirada libre.
  useEffect(() => {
    if (enabled) return;
    maquina.reiniciar();
    anunciarMotor('ninguno');
    const e = escenaApagada(Date.now());
    ultimaEscena.current = e;
    cb.current.onEscena?.(e);
    if (gaze.current.activa) {
      gaze.current = { x: 0, y: 0, activa: false };
      cb.current.onGaze?.(0, 0, false);
    }
  }, [enabled, anunciarMotor, maquina]);

  // --- nativo: cada cuadro analizado
  const onObs = useCallback<ObsCb>(
    (caras, w, h, o, fovDiagonal) => {
      const ts = Date.now();
      anunciarMotor('mlkit');
      const obs = observacionMlkit(caras, w, h, o, ts, fovDiagonal);
      const e = maquina.procesar(obs, { inmediato: dormidoRef.current });
      const g = gaze.current;
      if (e.principal) {
        const a = g.activa ? 0.35 : 1;
        g.x += (e.principal.x - g.x) * a;
        g.y += (e.principal.y - g.y) * a;
        g.activa = true;
        cb.current.onGaze?.(g.x, g.y, true);
      } else if (g.activa && e.personas === 0) {
        g.activa = false;
        cb.current.onGaze?.(g.x, g.y, false);
      }
      emitir(e);
    },
    [anunciarMotor, emitir, maquina]
  );

  // --- nativo: escaneo lento de la mesa en el servidor (solo con alguien delante y despierto)
  useEffect(() => {
    if (modo !== 'nativo' || !activa) return;
    let busy = false;
    const id = setInterval(() => {
      if (busy || dormidoRef.current || !maquina.hayPersona || !grabRef?.current) return;
      busy = true;
      void (async () => {
        try {
          const b64 = await grabRef.current?.();
          if (!b64) return;
          const text = await describeImage(b64, LABEL_PROMPT);
          if (!text) return;
          const labels = parseLabels(text);
          if (labels.length) cb.current.onObjects?.(labels);
          cb.current.onScene?.(text, labels);
        } catch {
          /* red */
        } finally {
          busy = false;
        }
      })();
    }, MESA_NATIVO_MS);
    return () => clearInterval(id);
  }, [modo, activa, grabRef, maquina]);

  // --- servidor: etiquetas → escena aproximada
  const onEtiquetas = useCallback(
    (summary: string, labels: string[]) => {
      anunciarMotor('servidor');
      if (labels.length) cb.current.onObjects?.(labels);
      cb.current.onScene?.(summary, labels);
      const e = escenaDesdeEtiquetas(labels, Date.now(), ultimaEscena.current);
      const hay = e.personas > 0;
      if (hay !== gaze.current.activa) {
        gaze.current = { x: 0, y: 0, activa: hay };
        cb.current.onGaze?.(0, 0, hay);
      }
      emitir(e);
    },
    [anunciarMotor, emitir]
  );

  if (!enabled) return null;

  if (modo === 'nativo' && mods) {
    return (
      <View style={styles.box} pointerEvents="none">
        <LimiteNativo onFallo={fallo}>
          <CamaraNativa mods={mods} activa={activa} dormido={dormido} grabRef={grabRef} onObs={onObs} onFallo={fallo} />
        </LimiteNativo>
      </View>
    );
  }
  return <CamaraServidor activa={activa} dormido={dormido} grabRef={grabRef} onEtiquetas={onEtiquetas} />;
}

const styles = StyleSheet.create({
  box: { position: 'absolute', width: 1, height: 1, opacity: 0.02, overflow: 'hidden' },
});
