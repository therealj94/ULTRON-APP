/**
 * Diagnóstico de campo. La APK cuenta dónde está y qué se rompió, para poder ver un crash
 * del teléfono de José en los logs de Render sin pedirle que conecte un cable.
 *
 * - `miga()` deja una marca de paso (arranque, login, desk montado, cámara…). Se acumulan.
 * - Un error de JS no capturado manda TODAS las migas + el error y luego deja que la app siga su curso.
 * - Un crash NATIVO mata el proceso sin avisar: por eso las migas se mandan también al reabrir,
 *   con `previo`, que es lo último que se alcanzó a hacer antes de morir.
 * Nunca bloquea el arranque: todo va en try/catch y sin await en el camino crítico.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE } from '../config';

const CLAVE = 'ultron_migas_v1';
const MAX = 40;

let migas: string[] = [];
let sesionId = '';
let arranqueMs = 0;

function ahora() {
  return arranqueMs ? `+${((Date.now() - arranqueMs) / 1000).toFixed(1)}s` : '0s';
}

function guardar() {
  AsyncStorage.setItem(CLAVE, JSON.stringify(migas.slice(-MAX))).catch(() => {});
}

/** Marca de paso. Barato: se guarda en disco para sobrevivir a un crash nativo. */
export function miga(texto: string) {
  const linea = `${ahora()} ${texto}`;
  migas.push(linea);
  if (migas.length > MAX) migas = migas.slice(-MAX);
  if (__DEV__) console.log('[miga]', linea);
  guardar();
}

function enviar(cuerpo: Record<string, unknown>) {
  try {
    void fetch(`${API_BASE}/api/diag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sesion: sesionId,
        version: Constants.expoConfig?.version || '?',
        plataforma: `${Platform.OS} ${Platform.Version}`,
        dispositivo: `${Constants.deviceName || '?'}`,
        ...cuerpo,
      }),
    }).catch(() => {});
  } catch {
    /* el diagnóstico jamás rompe la app */
  }
}

/**
 * Arranca el reporte. Llamar lo antes posible en App.tsx.
 * Si la vez anterior quedaron migas sin cerrar, es que el proceso murió: se mandan como `crash-previo`.
 */
export async function iniciarReporte() {
  arranqueMs = Date.now();
  sesionId = Math.random().toString(36).slice(2, 10);
  try {
    const previo = await AsyncStorage.getItem(CLAVE);
    if (previo) {
      const lista = JSON.parse(previo) as string[];
      // Si la sesión anterior no llegó a cerrar limpio, lo último de la lista es donde murió.
      if (Array.isArray(lista) && lista.length && !lista[lista.length - 1].includes('cierre-limpio')) {
        enviar({ tipo: 'crash-previo', murio_en: lista[lista.length - 1], migas: lista });
      }
    }
  } catch {
    /* */
  }
  migas = [];
  guardar();
  miga('arranque');

  // Errores de JS no capturados: se reportan y la app sigue su camino normal.
  try {
    const g = (global as any).ErrorUtils;
    if (g?.getGlobalHandler && g?.setGlobalHandler) {
      const previo = g.getGlobalHandler();
      g.setGlobalHandler((error: any, fatal?: boolean) => {
        enviar({
          tipo: 'error-js',
          fatal: !!fatal,
          error: String(error?.message || error).slice(0, 400),
          stack: String(error?.stack || '').slice(0, 1500),
          migas,
        });
        previo?.(error, fatal);
      });
    }
  } catch {
    /* */
  }
}

/** Manda las migas ahora (sin esperar a un crash): para confirmar que llegó bien a la mesa. */
export function reportarEstado(nota: string) {
  miga(nota);
  enviar({ tipo: 'estado', nota, migas });
}

/** Marca que la app llegó entera a donde tenía que llegar: la próxima vez no se reporta crash. */
export function cierreLimpio() {
  miga('cierre-limpio');
}
