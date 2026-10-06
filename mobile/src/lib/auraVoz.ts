/**
 * La voz en streaming (modules/aura-voz, Android): el puente con el nativo. docs/adr/ADR-voz-en-streaming.md.
 *
 * `moduloVoz()` es null si este binario no trae el módulo (una APK anterior que recibió este JS por OTA, o iOS):
 * entonces la voz sigue por el camino de siempre (lib/tts.ts: bajar la frase entera y sonarla con expo-av). Si
 * preguntarle al módulo truena, también null: nada de la voz se rompe por esto.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type OpcionesFrase = { esperar?: boolean; prebufferMs?: number };

export type ModuloVoz = {
  disponible(): boolean;
  version(): number;
  encolar(id: string, url: string, cabeceras: Record<string, string>, opciones: OpcionesFrase): boolean;
  soltar(id: string): void;
  cancelar(id: string): void;
  parar(): void;
  addListener(evento: 'onVoz', cb: (e: unknown) => void): { remove(): void };
};

let modulo: ModuloVoz | null | undefined;

export function moduloVoz(): ModuloVoz | null {
  if (modulo !== undefined) return modulo;
  try {
    const m = Platform.OS === 'android' ? requireOptionalNativeModule<ModuloVoz>('AuraVoz') : null;
    modulo = m && m.disponible() ? m : null;
  } catch {
    modulo = null;
  }
  return modulo;
}

export function vozVivoDisponible(): boolean {
  return !!moduloVoz();
}
