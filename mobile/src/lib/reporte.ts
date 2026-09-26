/**
 * Diagnóstico de campo. La APK cuenta dónde está y qué se rompió, para poder ver un crash
 * del teléfono de José en los logs de Render sin pedirle que conecte un cable.
 *
 * - `miga()` deja una marca de paso (arranque, login, desk montado, cámara…). Se acumulan.
 * - Un error de JS no capturado manda TODAS las migas + el error y luego deja que la app siga su curso.
 * - Un crash NATIVO mata el proceso sin avisar: por eso las migas se mandan también al reabrir,
 *   con `previo`, que es lo último que se alcanzó a hacer antes de morir.
 * - Solo cuenta como crash morir EN PRIMER PLANO. Al pasar a segundo plano (botón de inicio, cerrar
 *   desde recientes, apagar la pantalla) la sesión se marca cerrada: que Android mate después la app
 *   dormida es normal y no se reporta. Antes se marcaba «limpio» solo a los 8 s de abrir la mesa, y
 *   cerrar desde la entrada (o cualquier miga posterior) salía como crash la vez siguiente.
 * - Las promesas rechazadas sin catch también se reportan (en release; en desarrollo ya las muestra LogBox).
 * - Del teléfono solo va marca, modelo y sistema: nunca el nombre que le puso su dueño.
 * Nunca bloquea el arranque: todo va en try/catch y sin await en el camino crítico.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE } from '../config';

const CLAVE = 'ultron_migas_v1';
/** '1' mientras la app está en primer plano; '0' al irse a segundo plano. Si al abrir sigue en '1', murió. */
const CLAVE_VIVA = 'ultron_migas_viva_v1';
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

function marcarViva(viva: boolean) {
  AsyncStorage.setItem(CLAVE_VIVA, viva ? '1' : '0').catch(() => {});
}

/** Marca, modelo y sistema. Nada que identifique a la persona (ni el nombre del teléfono, ni el serial). */
function equipo(): string {
  try {
    if (Platform.OS === 'android') return `${Platform.constants.Brand || ''} ${Platform.constants.Model || ''}`.trim() || 'android';
    if (Platform.OS === 'ios') return Platform.constants.interfaceIdiom || 'ios';
  } catch {
    /* */
  }
  return '?';
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
        dispositivo: equipo(),
        ...cuerpo,
      }),
    }).catch(() => {});
  } catch {
    /* el diagnóstico jamás rompe la app */
  }
}

let iniciado = false;

/**
 * Arranca el reporte. Llamar lo antes posible en App.tsx.
 * Si la vez anterior la app murió en primer plano, sus migas se mandan como `crash-previo`.
 */
export async function iniciarReporte() {
  if (iniciado) return;
  iniciado = true;
  arranqueMs = Date.now();
  sesionId = Math.random().toString(36).slice(2, 10);
  try {
    const [previo, viva] = await Promise.all([AsyncStorage.getItem(CLAVE), AsyncStorage.getItem(CLAVE_VIVA)]);
    // Sin la marca (primera vez con esta versión) no se sabe cómo terminó: no se acusa un crash.
    if (previo && viva === '1') {
      const lista = JSON.parse(previo) as string[];
      if (Array.isArray(lista) && lista.length) {
        enviar({ tipo: 'crash-previo', murio_en: lista[lista.length - 1], migas: lista });
      }
    }
  } catch {
    /* */
  }
  migas = [];
  guardar();
  marcarViva(AppState.currentState !== 'background');
  miga('arranque');

  // Segundo plano = cierre normal. Al volver, la sesión vuelve a estar abierta.
  try {
    AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        marcarViva(true);
        miga('primer plano');
      } else if (s === 'background' || s === 'inactive') {
        miga('segundo plano');
        marcarViva(false);
      }
    });
  } catch {
    /* */
  }

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
        // Un fatal ya quedó reportado aquí con sus migas: al reabrir no se manda otra vez como crash.
        if (fatal) marcarViva(false);
        previo?.(error, fatal);
      });
    }
  } catch {
    /* */
  }

  // Promesas rechazadas que nadie atrapó. Hermes trae su propio rastreador (el mismo que RN activa
  // en desarrollo para LogBox, ver react-native/Libraries/Core/polyfillPromise.js). Solo en release:
  // activarlo en desarrollo reemplazaría el de LogBox.
  try {
    const hermes = (global as any).HermesInternal;
    if (!__DEV__ && hermes?.hasPromise?.() && typeof hermes.enablePromiseRejectionTracker === 'function') {
      hermes.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (_id: number, razon: any) => {
          enviar({
            tipo: 'error-js',
            fatal: false,
            error: `promesa sin catch: ${String(razon?.message || razon).slice(0, 380)}`,
            stack: String(razon?.stack || '').slice(0, 1500),
            migas,
          });
        },
        onHandled: () => {},
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
