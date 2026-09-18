import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { API_BASE } from '../config';

type Props = {
  enabled: boolean;
  onGaze?: (x: number, y: number) => void;
  onObjects?: (labels: string[]) => void;
  onPresence?: (present: boolean) => void;
};

/**
 * Cámara frontal: cuando hay persona → mirada al centro.
 * Sin detección reciente → micro-saccades suaves (no overwrite constante).
 */
export function GazeCamera({ enabled, onGaze, onObjects, onPresence }: Props) {
  const ref = useRef<CameraView>(null);
  const busy = useRef(false);
  const onGazeRef = useRef(onGaze);
  const onObjectsRef = useRef(onObjects);
  const onPresenceRef = useRef(onPresence);
  const lastPersonAt = useRef(0);

  useEffect(() => {
    onGazeRef.current = onGaze;
    onObjectsRef.current = onObjects;
    onPresenceRef.current = onPresence;
  }, [onGaze, onObjects, onPresence]);

  useEffect(() => {
    if (!enabled) return;
    let t = 0;
    const id = setInterval(() => {
      // Solo idle si no vimos persona en los últimos 4s
      if (Date.now() - lastPersonAt.current < 4000) return;
      t += 0.2;
      const x = Math.sin(t * 0.35) * 0.12;
      const y = Math.cos(t * 0.22) * 0.08;
      onGazeRef.current?.(x, y);
    }, 400);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      void (async () => {
        if (busy.current || !ref.current) return;
        busy.current = true;
        try {
          const photo = await ref.current.takePictureAsync({
            quality: 0.2,
            base64: true,
            shutterSound: false,
            skipProcessing: true,
          });
          if (!photo?.base64) return;
          onPresenceRef.current?.(true);

          const res = await fetch(`${API_BASE}/api/vision/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mediaType: 'image/jpeg',
              fileName: 'gaze.jpg',
              base64Data: `data:image/jpeg;base64,${photo.base64}`,
              prompt:
                'Lista en español, máximo 6 objetos o personas visibles (ej: persona, lápiz, teléfono, taza, libro). Solo palabras separadas por coma.',
            }),
          });
          if (!res.ok) return;
          const data = await res.json();
          const text = String(data.analysis || data.summary || data.result || data.reply || '');
          const labels = text
            .split(/[,;\n]/)
            .map((s: string) => s.trim().toLowerCase())
            .filter((s: string) => s.length > 2 && s.length < 28)
            .slice(0, 6);
          if (labels.length) onObjectsRef.current?.(labels);

          if (labels.some((l) => /persona|rostro|cara|hombre|mujer|face|person/.test(l))) {
            lastPersonAt.current = Date.now();
            onGazeRef.current?.(0, 0);
          }
        } catch {
          /* red / cámara */
        } finally {
          busy.current = false;
        }
      })();
    }, 5500);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <View style={styles.box} pointerEvents="none">
      <CameraView ref={ref} style={StyleSheet.absoluteFill} facing="front" animateShutter={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.02,
    overflow: 'hidden',
  },
});
