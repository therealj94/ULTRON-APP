// Doble de expo-camera para el banco de pruebas: no hay lente en un navegador headless. Pinta un
// recuadro oscuro del tamaño de la vista y da el permiso por concedido, que es lo que se revisa
// acá: cómo queda la pantalla, no la foto.
import { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';

export const CameraView = forwardRef<any, any>(function CameraView({ style }, ref) {
  useImperativeHandle(ref, () => ({ takePictureAsync: async () => ({ uri: '', base64: '' }) }));
  return <View style={[{ backgroundColor: '#111' }, style]} />;
});
export type CameraView = { takePictureAsync: (o?: unknown) => Promise<{ uri: string; base64?: string }> };

export function useCameraPermissions() {
  return [{ granted: true, canAskAgain: true, status: 'granted' }, async () => ({ granted: true })] as const;
}
