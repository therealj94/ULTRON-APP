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
import { sanearTexto } from './saneador';
import { lineaSalida, salidasNuevas } from './salidasPrevias';

const CLAVE = 'ultron_migas_v1';
/** '1' mientras la app está en primer plano; '0' al irse a segundo plano. Si al abrir sigue en '1', murió. */
const CLAVE_VIVA = 'ultron_migas_viva_v1';
const MAX = 40;
/** Hasta qué salida de Android (ApplicationExitInfo.timestamp) ya se contó (lib/salidasPrevias.ts). */
const CLAVE_SALIDAS = 'ultron_salidas_contadas_v1';

let migas: string[] = [];
let sesionId = '';
let arranqueMs = 0;
/** Cómo terminó la vez anterior: true = murió en primer plano, false = se cerró bien, null = no se sabe. */
let murioAntes: boolean | null = null;

/** ¿La vez anterior la app murió en primer plano? (lo usa la guardia de la cámara nueva, lib/guardiaCamara.ts) */
export function murioLaVezAnterior(): boolean | null {
  return murioAntes;
}

function ahora() {
  return arranqueMs ? `+${((Date.now() - arranqueMs) / 1000).toFixed(1)}s` : '0s';
}

function guardar() {
  AsyncStorage.setItem(CLAVE, JSON.stringify(migas.slice(-MAX))).catch(() => {});
}

function marcarViva(viva: boolean): Promise<void> {
  return AsyncStorage.setItem(CLAVE_VIVA, viva ? '1' : '0').catch(() => {});
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

/**
 * Un cierre que la app hace a propósito con la pantalla delante (la OTA recarga con `reloadAsync`): no es un
 * crash. Sin esto el siguiente arranque encuentra la marca de «viva» y acusa una caída que no hubo.
 */
export function cierreIntencional(motivo: string): Promise<void> {
  miga(motivo);
  // Se espera a que la marca quede escrita: la recarga mata el proceso enseguida.
  return marcarViva(false);
}

/** Marca de paso. Barato: se guarda en disco para sobrevivir a un crash nativo. */
export function miga(texto: string) {
  const linea = `${ahora()} ${texto}`;
  migas.push(linea);
  if (migas.length > MAX) migas = migas.slice(-MAX);
  if (__DEV__) console.log('[miga]', linea);
  guardar();
}

/** Lo que sale del teléfono, ya tapado (tokens, claves, correos, URL con parámetros…): ver saneador.ts. */
function sanearCuerpo(c: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...c };
  for (const [k, max] of [['error', 400], ['stack', 1500], ['murio_en', 200], ['nota', 300]] as const) if (out[k] !== undefined) out[k] = sanearTexto(out[k], max);
  if (Array.isArray(out.migas)) out.migas = (out.migas as unknown[]).map((m) => sanearTexto(m, 160));
  return out;
}

function enviar(cuerpo: Record<string, unknown>) {
  try {
    cuerpo = sanearCuerpo(cuerpo);
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
    murioAntes = viva === '1' ? true : viva === '0' ? false : null;
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
  // Lo que Android sabe de cómo terminó antes (un «no responde», memoria, crash nativo): después del arranque.
  setTimeout(() => void revisarSalidasPrevias(), 1500);

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

/**
 * Las salidas de la app que Android anotó y aún no se contaron (APK con el módulo de la cámara versión 2; con una
 * anterior no hay nada que leer). Cada una va como estado, con su motivo: «anr», «memoria», «crash-nativo»…
 */
async function revisarSalidasPrevias() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { salidasNativas } = require('./auraCamara') as typeof import('./auraCamara');
    const lista = salidasNativas(8);
    if (!lista.length) return;
    const contado = Number((await AsyncStorage.getItem(CLAVE_SALIDAS)) || 0) || 0;
    const ahora = Date.now();
    const { nuevas, hasta } = salidasNuevas(lista, contado, ahora);
    if (hasta > contado) await AsyncStorage.setItem(CLAVE_SALIDAS, String(hasta));
    for (const s of nuevas.reverse()) reportarEstado(lineaSalida(s, ahora));
  } catch {
    /* el diagnóstico jamás rompe la app */
  }
}

/** Manda las migas ahora (sin esperar a un crash): para confirmar que llegó bien a la mesa. */
export function reportarEstado(nota: string) {
  miga(nota);
  enviar({ tipo: 'estado', nota, migas });
}

/**
 * Una pantalla se rompió al dibujar y la atrapó su límite (app/LimitePantalla.tsx): la app sigue viva,
 * pero se manda como error (no fatal) con sus migas, para verlo en los logs igual que uno sin capturar.
 */
export function reportarErrorPantalla(pantalla: string, error: unknown) {
  const e = error as { message?: unknown; stack?: unknown } | null;
  const texto = String(e?.message || error).slice(0, 360);
  miga(`pantalla ${pantalla}: se rompió (${texto.slice(0, 80)})`);
  enviar({ tipo: 'error-js', fatal: false, error: `pantalla ${pantalla}: ${texto}`, stack: String(e?.stack || '').slice(0, 1500), migas });
}
