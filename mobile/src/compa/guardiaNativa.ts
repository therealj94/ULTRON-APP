/**
 * LA GUARDIA NATIVA DE LA LLAMADA DEL AVATAR (`AuraGuardiaLlamada`, plugins/asistente-digital-nativo/java/
 * GuardiaLlamadaAura.kt). Qué hace y por qué: compa/fondoLlamada.ts (arriba, «LA GUARDIA NATIVA»).
 *
 * Solo en la APK de AU-RA desde la 5.7.1 (la registra plugins/asistente-digital.js junto a AuraTelefono). En una APK
 * anterior, en Dr Electrum o fuera de Android no está: `guardiaNativa()` devuelve null y queda la guardia de JS de
 * siempre (que cuelga al volver). Módulo clásico de React Native, como telefono/nativo.ts.
 */
import { DeviceEventEmitter, NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { ES_ELECTRUM } from '../variante';
import type { CierreNativo } from './fondoLlamada';

/** El evento que manda el nativo cuando venció el plazo con la app detrás (el mismo nombre que en el Kotlin). */
export const EVENTO_GUARDIA_LLAMADA = 'auraGuardiaLlamada';

export type ModuloGuardia = {
  /** Arma (o vuelve a armar) el plazo; con `cierre`, al vencer también avisa al servidor desde el nativo. */
  armar: (ms: number, cierre: CierreNativo | null) => void;
  desarmar: () => void;
  /** Cuándo venció con la app detrás y nadie lo tomó (ms de pared), o null. Lo consume. */
  tomarDisparo: () => Promise<number | null>;
};

let cache: ModuloGuardia | null | undefined;

/** El módulo, o null si esta APK no lo trae. */
export function guardiaNativa(): ModuloGuardia | null {
  if (cache !== undefined) return cache;
  if (Platform.OS !== 'android' || ES_ELECTRUM) return (cache = null);
  let m: unknown = null;
  try {
    m = (TurboModuleRegistry as { get?: (n: string) => unknown }).get?.('AuraGuardiaLlamada') ?? null;
  } catch {
    m = null;
  }
  m = m || (NativeModules as Record<string, unknown>).AuraGuardiaLlamada || null;
  const g = m as Partial<ModuloGuardia> | null;
  const ok = !!g && typeof g.armar === 'function' && typeof g.desarmar === 'function' && typeof g.tomarDisparo === 'function';
  return (cache = ok ? (g as ModuloGuardia) : null);
}

/** El aviso del nativo: venció el plazo con la app detrás. */
export function alDispararGuardia(f: () => void): () => void {
  if (!guardiaNativa()) return () => {};
  const s = DeviceEventEmitter.addListener(EVENTO_GUARDIA_LLAMADA, f);
  return () => s.remove();
}
