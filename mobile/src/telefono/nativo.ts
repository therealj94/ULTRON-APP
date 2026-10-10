/**
 * EL MÓDULO NATIVO DE LAS MANOS DEL TELÉFONO (`AuraTelefono`, plugins/asistente-digital-nativo/java/TelefonoAura.kt).
 *
 * Solo existe en la APK de AU-RA desde la 5.7.1 (lo copia y registra plugins/asistente-digital.js). En una APK anterior,
 * en Dr Electrum o fuera de Android no está: `nativoTelefono()` devuelve null y el ejecutor (telefono/ejecutor.ts) contesta
 * «actualiza a la 5.7.1» sin romper nada. Es un módulo clásico de React Native: con la nueva arquitectura lo sirve la
 * interop (`NativeModules` / `TurboModuleRegistry.get`).
 */
import { DeviceEventEmitter, NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { ES_ELECTRUM } from '../variante';
import type { DepsEjecutor, NativoTelefono } from './ejecutor';
import { tr } from '../i18n';

type ModuloCrudo = NativoTelefono & {
  tomarCompartido?: () => Promise<{ tipo?: string; texto?: string; asunto?: string; imagen?: string } | null>;
};

let cache: ModuloCrudo | null | undefined;

/** El módulo, o null si esta APK no lo trae. */
export function nativoTelefono(): ModuloCrudo | null {
  if (cache !== undefined) return cache;
  if (Platform.OS !== 'android' || ES_ELECTRUM) return (cache = null);
  let m: unknown = null;
  try {
    m = (TurboModuleRegistry as { get?: (n: string) => unknown }).get?.('AuraTelefono') ?? null;
  } catch {
    m = null;
  }
  m = m || (NativeModules as Record<string, unknown>).AuraTelefono || null;
  const ok = !!m && typeof (m as ModuloCrudo).listarApps === 'function' && typeof (m as ModuloCrudo).abrirApp === 'function';
  return (cache = ok ? (m as ModuloCrudo) : null);
}

/** Las dependencias del ejecutor en la app de verdad. */
export function depsEjecutor(): DepsEjecutor {
  return { nativo: nativoTelefono(), plataforma: Platform.OS, electrum: ES_ELECTRUM, tr };
}

/** El aviso del módulo cuando otra app le compartió algo a AU-RA con la app abierta. */
export function alCompartir(f: () => void): () => void {
  if (!nativoTelefono()) return () => {};
  const s = DeviceEventEmitter.addListener('auraCompartido', f);
  return () => s.remove();
}
