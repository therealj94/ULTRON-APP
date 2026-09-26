// Doble de expo-camera para el banco de pruebas: no hay lente en un navegador headless. Pinta un
// recuadro oscuro del tamaño de la vista, avisa que está lista como lo hace la de verdad y da el
// permiso por concedido, que es lo que se revisa acá: cómo queda la pantalla, no la foto.
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { View } from 'react-native';

export const CameraView = forwardRef<any, any>(function CameraView({ style, onCameraReady }, ref) {
  useImperativeHandle(ref, () => ({ takePictureAsync: async () => ({ uri: 'data:image/jpeg;base64,' + 'A'.repeat(200), width: 10, height: 10 }) }));
  useEffect(() => {
    const t = setTimeout(() => onCameraReady?.(), 150);
    return () => clearTimeout(t);
  }, [onCameraReady]);
  return <View style={[{ backgroundColor: '#111' }, style]} />;
});
export type CameraView = { takePictureAsync: (o?: unknown) => Promise<{ uri: string; base64?: string }> };

export function useCameraPermissions() {
  return [{ granted: true, canAskAgain: true, status: 'granted' }, async () => ({ granted: true })] as const;
}
