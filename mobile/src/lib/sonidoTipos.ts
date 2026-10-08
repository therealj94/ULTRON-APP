/**
 * Los tipos de un sonido, aparte de lib/sonidoVivo.ts: así la lógica que se prueba sin teléfono (electrum/colaVoz.ts)
 * los usa sin arrastrar el módulo nativo (lib/auraVoz.ts importa expo y react-native, que el typecheck del servidor no tiene).
 */
/** Lo que playPrepared lee de cada aviso (expo-av AVPlaybackStatus lo cumple). */
export type EstadoSonido = { isLoaded: boolean; isPlaying?: boolean; positionMillis?: number; durationMillis?: number; didJustFinish?: boolean; error?: string };

/** Lo que la mesa usa de un sonido: Audio.Sound de expo-av o SonidoVivo. */
export type Reproducible = {
  setOnPlaybackStatusUpdate(cb: ((st: EstadoSonido) => void) | null): void;
  playAsync(): Promise<unknown>;
  stopAsync(): Promise<unknown>;
  unloadAsync(): Promise<unknown>;
};
