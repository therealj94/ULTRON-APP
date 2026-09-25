// Doble de expo-speech-recognition: dice que el dictado existe (para que se vea el botón del
// micrófono) y no escucha nada. Cualquier otro método es un no-op.
const sinEfecto = async () => ({ granted: true });
export const ExpoSpeechRecognitionModule: any = new Proxy(
  {
    isRecognitionAvailable: () => true,
    requestPermissionsAsync: sinEfecto,
    getPermissionsAsync: sinEfecto,
    addListener: () => ({ remove: () => {} }),
  },
  { get: (o: any, k) => (k in o ? o[k] : () => {}) }
);
export type ExpoSpeechRecognitionErrorCode = string;
export function useSpeechRecognitionEvent() {}
