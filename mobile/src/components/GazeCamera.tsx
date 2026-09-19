import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { describeImage } from '../lib/api';

export type FrameGrabber = () => Promise<string | null>;

type Props = {
  enabled: boolean;
  /** Se rellena con una función que devuelve el frame actual en base64 (jpeg). */
  grabRef?: React.MutableRefObject<FrameGrabber | null>;
  onGaze?: (x: number, y: number) => void;
  onObjects?: (labels: string[]) => void;
  onScene?: (summary: string, labels: string[]) => void;
  onPresence?: (present: boolean) => void;
};

const SCENE_EVERY_MS = 12_000;
const LABEL_PROMPT =
  'Responde SOLO con una lista corta en español, separada por comas, de lo visible (máximo 6): persona, objetos, gestos evidentes (ej: persona, taza, teléfono, saluda). Sin frases.';

/**
 * Cámara frontal siempre activa (1x1 px, invisible): cada ~12 s manda un frame al nodo de visión (tarda ~10 s).
 * - Etiquetas → ULTRON sabe qué hay en la mesa ("¿qué ves?").
 * - Persona detectada → onPresence(true) y mirada al centro (la mirada errante vive en DeskScreen).
 * - grabRef → frame fresco bajo demanda (preguntas visuales al cerebro).
 */
export function GazeCamera({ enabled, grabRef, onGaze, onObjects, onScene, onPresence }: Props) {
  const ref = useRef<CameraView>(null);
  const busy = useRef(false);
  const cb = useRef({ onGaze, onObjects, onScene, onPresence });
  const readyRef = useRef(false);

  useEffect(() => {
    cb.current = { onGaze, onObjects, onScene, onPresence };
  }, [onGaze, onObjects, onScene, onPresence]);

  const grab = async (quality = 0.25): Promise<string | null> => {
    if (!ref.current || !readyRef.current) return null;
    try {
      const photo = await ref.current.takePictureAsync({ quality, base64: true, shutterSound: false, skipProcessing: true });
      return photo?.base64 || null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!grabRef) return;
    grabRef.current = enabled ? () => grab(0.35) : null;
    return () => {
      grabRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, grabRef]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      void (async () => {
        if (busy.current) return;
        busy.current = true;
        try {
          const b64 = await grab(0.2);
          if (!b64) return;
          const text = await describeImage(b64, LABEL_PROMPT);
          if (!text) return;
          const labels = text
            .replace(/\.$/, '')
            .split(/[,;\n]/)
            .map((s) => s.trim().toLowerCase().replace(/^(una?|el|la|los|las|unos|unas)\s+/, ''))
            .filter((s) => s.length > 2 && s.length < 32)
            .slice(0, 6);
          if (labels.length) cb.current.onObjects?.(labels);
          cb.current.onScene?.(text, labels);
          const person = labels.some((l) => /persona|rostro|cara|hombre|mujer|niñ|gente|face|person/.test(l));
          cb.current.onPresence?.(person);
          if (person) cb.current.onGaze?.(0, 0);
        } catch {
          /* red / cámara */
        } finally {
          busy.current = false;
        }
      })();
    }, SCENE_EVERY_MS);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

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

const styles = StyleSheet.create({
  box: { position: 'absolute', width: 1, height: 1, opacity: 0.02, overflow: 'hidden' },
});
