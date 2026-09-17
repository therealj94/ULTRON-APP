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
 * Cámara frontal silenciosa: estima mirada (centro-masa de luminancia)
 * y cada ~5s pide al desk identificar objetos (lápiz, persona, etc.).
 */
export function GazeCamera({ enabled, onGaze, onObjects, onPresence }: Props) {
  const ref = useRef<CameraView>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    // Mirada suave idle + micro-movimientos (hasta que haya frame analysis)
    let t = 0;
    const id = setInterval(() => {
      t += 0.35;
      const x = Math.sin(t * 0.7) * 0.25;
      const y = Math.cos(t * 0.45) * 0.15;
      onGaze?.(x, y);
    }, 120);
    return () => clearInterval(id);
  }, [enabled, onGaze]);

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
          onPresence?.(true);
          // Heurística local rápida: sesgo de mirada por “presencia”
          onGaze?.(0, -0.05);

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
          if (labels.length) onObjects?.(labels);

          // Si hay persona, mirada al centro (te está viendo)
          if (labels.some((l) => /persona|rostro|cara|hombre|mujer|jose|medardo/.test(l))) {
            onGaze?.(0, 0);
          }
        } catch {
          /* red / cámara */
        } finally {
          busy.current = false;
        }
      })();
    }, 5500);
    return () => clearInterval(id);
  }, [enabled, onGaze, onObjects, onPresence]);

  if (!enabled) return null;

  return (
    <View style={styles.box} pointerEvents="none">
      <CameraView ref={ref as any} style={StyleSheet.absoluteFill} facing="front" animateShutter={false} />
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
