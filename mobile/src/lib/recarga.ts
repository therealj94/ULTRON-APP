/**
 * RECARGAR SIN CERRARSE: la única puerta a `Updates.reloadAsync` (lib/ota.ts la usa al aplicar una OTA).
 *
 * El 8-oct, en el emulador, la app se cerró al recargar: «FATAL EXCEPTION … Player is accessed on the wrong thread»
 * (ExoPlayerImpl.release ← expo-av SimpleExoPlayerData.release ← AVManager.onHostDestroy ← ReactInstance.destroy).
 * React Native destruye la instancia vieja desde un hilo de fondo y expo-av suelta ahí los reproductores que siguen
 * vivos; ExoPlayer solo acepta el hilo principal. Dentro de los 10 s tras pintar, la recuperación de errores de
 * expo-updates convierte ese fallo en un cierre de la app (lo que vio José el 7-oct, ~13 s tras bajar la OTA).
 * El arreglo de verdad es nativo (patches/expo-av: soltar en el hilo principal) y llega solo con una APK nueva; esto
 * llega por aire: que al recargar no quede ningún reproductor de expo-av que soltar.
 *
 * Antes de `reloadAsync`, y en este orden:
 *  1. la voz se calla (tts.stopSpeaking: suelta la frase que suena y vacía la cola del streaming);
 *  2. la raíz se pinta vacía (App.tsx, `useRaizVacia`): todo `<Video>` (el cuerpo en video de Claudio y ANT-ONIO,
 *     los videos de WhatsApp…) se desmonta y expo-av suelta su reproductor en el hilo principal;
 *  3. todos los `Audio.Sound` del registro (avRegistro.ts) se descargan, con tope; el registro queda cerrado (nada
 *     carga un sonido nuevo mientras tanto);
 *  4. se espera ESPERA_VACIA_MS (que el desmontaje y las descargas lleguen al nativo);
 *  5. la marca de cierre intencional (reporte.ts: el próximo arranque no lo cuenta como caída) y `reloadAsync`.
 *
 * Idempotente: una segunda llamada mientras tanto recibe la misma promesa (un solo `reloadAsync`). Si `reloadAsync`
 * falla, la app vuelve (raíz pintada, registro abierto) y la promesa rechaza: se puede volver a intentar.
 */
import { useSyncExternalStore } from 'react';
import * as Updates from 'expo-updates';
import { cierreIntencional, miga } from './reporte';
import { abrirRegistro, soltarTodo } from './avRegistro';

/** Con la raíz vacía y los sonidos soltados, esto antes de recargar. */
export const ESPERA_VACIA_MS = 400;
/** Lo más que se espera a que expo-av confirme las descargas. */
export const TOPE_SONIDOS_MS = 1500;
/** Lo más que se espera a que la voz se calle. */
export const TOPE_VOZ_MS = 800;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function conTope(f: () => unknown, ms: number): Promise<boolean> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<false>((r) => (reloj = setTimeout(() => r(false), ms)));
  try {
    return await Promise.race([
      Promise.resolve()
        .then(f)
        .then(
          () => true,
          () => false
        ),
      tope,
    ]);
  } finally {
    clearTimeout(reloj);
  }
}

/* ── la raíz vacía ───────────────────────────────────────────────────────────────────────── */

let vacia = false;
const oyentes = new Set<() => void>();
function fijarVacia(v: boolean) {
  if (v === vacia) return;
  vacia = v;
  for (const f of [...oyentes]) f();
}
/** ¿La raíz se pinta vacía (recargando)? */
export function raizVacia(): boolean {
  return vacia;
}
/** Para la raíz (App.tsx): `true` = recargando, no pintar nada. */
export function escucharRaizVacia(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}
export function useRaizVacia(): boolean {
  return useSyncExternalStore(escucharRaizVacia, raizVacia, raizVacia);
}

/* ── recargar ───────────────────────────────────────────────────────────────────────────── */

let enCurso: Promise<void> | null = null;

/** ¿Hay una recarga en marcha? */
export function recargando(): boolean {
  return !!enCurso;
}

/** Suelta lo de expo-av y recarga el JS (`Updates.reloadAsync`). Una sola vez aunque se llame dos. */
export function recargarLimpio(motivo: string): Promise<void> {
  if (enCurso) return enCurso;
  const vuelta = { esta: null as Promise<void> | null };
  const esta: Promise<void> = (async () => {
    try {
      // 1. La voz. Perezoso: tts.ts no entra en el arranque de quien nunca recarga (Dr Electrum).
      const callada = await conTope(() => (require('./tts') as typeof import('./tts')).stopSpeaking(), TOPE_VOZ_MS);
      if (!callada) miga('recarga: la voz no confirmó que calló');
      // 2. La raíz vacía: los <Video> se desmontan y se sueltan en el hilo principal.
      fijarVacia(true);
      // 3. Los sonidos del registro.
      const r = await soltarTodo(TOPE_SONIDOS_MS);
      if (r.pendientes) miga(`recarga: ${r.pendientes} sonido(s) sin soltar de ${r.soltados}`);
      // 4. Que lo desmontado y lo descargado llegue al nativo.
      await dormir(ESPERA_VACIA_MS);
      // 5. La recarga es a propósito: el próximo arranque no la cuenta como crash.
      await cierreIntencional(motivo);
      await Updates.reloadAsync();
    } catch (e) {
      // No recargó: la app vuelve tal cual y se puede intentar de nuevo.
      miga(`recarga: falló (${e instanceof Error ? e.message : String(e)})`);
      abrirRegistro();
      fijarVacia(false);
      if (enCurso === vuelta.esta) enCurso = null;
      throw e;
    }
  })();
  vuelta.esta = esta;
  enCurso = esta;
  return esta;
}

/** Solo pruebas. */
export function _reiniciarRecarga() {
  enCurso = null;
  vacia = false;
  oyentes.clear();
}
