/**
 * CamaraVision — los ojos de ULTRON en el teléfono.
 *
 * Motor 'servidor': expo-camera en 1×1 px toma una foto cada 12 s (30 s con la cara dormida) y la manda
 * a /api/vision/analyze; las etiquetas pasan por `escenaDesdeEtiquetas` (src/lib/escena.ts) y salen como
 * la misma `Escena` que usa la web. Presencia aproximada, sin coordenadas de cara.
 *
 * Batería: la cámara solo trabaja con la app en primer plano (AppState) y espacia las fotos mientras la
 * cara duerme. onEscena sale como máximo cada 500 ms y de inmediato cuando trae eventos.
 *
 * `grabRef` deja un frame bajo demanda en base64 jpeg (lo usa «qué ves» en DeskScreen).
 *
 * MOTOR NATIVO (ML Kit a 10 fps con vision-camera) — RETIRADO EN 4.1.1, ver DETECCION_NATIVA abajo.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import { CameraView } from 'expo-camera';
import { describeImage } from '../lib/api';
import {
  MaquinaEscena,
  escenaApagada,
  escenaDesdeEtiquetas,
  type Escena,
  type MotorVision,
} from '../lib/escena';

/**
 * RETIRADO EN 4.1.1. En el teléfono de la junta la app se cerraba sola justo al entrar a la mesa: el
 * crash caía donde se cargaba lo nativo — `react-native-worklets-core` instala su runtime por JSI y con
 * la arquitectura nueva de React Native 0.81 mata el proceso, que es exactamente el síntoma («entro y se
 * sale»). Quitar la bandera no bastaba: vision-camera, el face-detector y worklets-core entraban al APK
 * por autolinking con solo estar en package.json, y Metro resuelve sus `require()` aunque el código sea
 * inalcanzable. Así que se fueron las tres dependencias, el plugin de app.json, el de babel y el motor
 * nativo entero (queda en git: `git show HEAD~1:mobile/src/components/CamaraVision.tsx`).
 *
 * Para reactivarlo hay que validar worklets en un teléfono real, o migrar a `react-native-worklets` (el
 * de Software Mansion), que es el que VisionCamera recomienda desde RN 0.78.
 */
export const DETECCION_NATIVA = false;

/** Ritmo de referencia con la cara dormida; DeskScreen lo usa para juzgar si una escena sigue fresca. */
export const DORMIDO_PERIODO_MS = 12_000;
/** Emisión máxima de onEscena sin eventos. */
const ESCENA_CADA_MS = 500;
/** Respaldo por servidor: foto cada 12 s (30 s si la cara duerme). DeskScreen los usa para la frescura. */
export const SERVIDOR_CADA_MS = 12_000;
export const SERVIDOR_DORMIDO_MS = 30_000;

export type FrameGrabber = () => Promise<string | null>;

export type CamaraVisionProps = {
  /** Permiso concedido y visión encendida. Con false se emite una vez `{ motor: 'ninguno' }`. */
  enabled: boolean;
  /** La cara está en SLEEPING: una foto cada 30 s en vez de cada 12 s. */
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

function useAppActiva() {
  const [activa, setActiva] = useState(AppState.currentState === 'active' || AppState.currentState == null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setActiva(s === 'active'));
    return () => sub.remove();
  }, []);
  return activa;
}

// ---------------------------------------------------------------- motor servidor

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

  // etiquetas del nodo de visión → escena aproximada
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
  return <CamaraServidor activa={activa} dormido={dormido} grabRef={grabRef} onEtiquetas={onEtiquetas} />;
}

const styles = StyleSheet.create({
  box: { position: 'absolute', width: 1, height: 1, opacity: 0.02, overflow: 'hidden' },
});
