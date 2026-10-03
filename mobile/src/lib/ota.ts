/**
 * Actualizaciones por aire (EAS Update): que lleguen en minutos, sin estorbar.
 *
 * El nativo pregunta al arrancar en frío (`checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`:
 * no espera a la red) y lo descargado se usaría en el siguiente arranque en frío. La mesa de la junta
 * puede pasar días abierta y delante sin arrancar en frío, así que aquí:
 *
 *  1. Se pregunta al servidor al montar, cada ENTRE_BUSQUEDAS_MS con la app delante y al volver a ella
 *     (con al menos MIN_ENTRE_BUSQUEDAS_MS entre preguntas). Lo nuevo se descarga en segundo plano.
 *  2. Lo descargado se aplica (`reloadAsync`) en un momento seguro: al volver tras un rato fuera, con
 *     la app quieta unos minutos o al terminar una llamada (barreraOta.ts decide). Nunca con trabajo
 *     activo (llamada, conversación con AURA, AURA hablando o pensando, borrador, teclado abierto,
 *     recordatorio sonando): se pospone al siguiente momento.
 *  3. Mientras tanto, la pastilla «Actualización lista · Reiniciar» (app/AvisoActualizacion.tsx).
 *  4. Si la APK publicada trae otro nativo (otra huella), lo nuevo ya no llega por aire: se avisa
 *     «Instala la APK nueva». La huella de la última APK de main está en el Release «latest».
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, Keyboard, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';
import { miga } from './reporte';
import { escuchar } from '../nucleo/contrato';
import { ecoMesa, mensajeVoz } from '../compa/canales';
import { VARIANTE } from '../variante';
import { QUIETO_TRAS_TRABAJO_MS, decidirAplicar, marcarActividad, motivosParaNoRecargar, necesitaApkNueva, prepararRecarga, registrarTrabajoActivo, type Momento } from './barreraOta';

/** Entre preguntas con la app delante. */
const ENTRE_BUSQUEDAS_MS = 15 * 60_000;
/** Al volver a la app, como mínimo esto desde la última pregunta (no martillar al servidor). */
const MIN_ENTRE_BUSQUEDAS_MS = 5 * 60_000;
/** La primera, un poco después de montar: el nativo acaba de preguntar al arrancar. */
const PRIMERA_BUSQUEDA_MS = 10_000;
/** Cada cuánto se mira si toca preguntar o si la app está quieta para aplicar. */
const TIC_MS = 30_000;

/** Donde se baja la APK de main (y la huella que trae, que escribe android-apk.yml). */
export const URL_APK = 'https://github.com/therealj94/ULTRON-APP/releases/latest';

/* ── lo que frena y lo que cuenta como actividad, además de lo que registra cada frente ───────── */

// Escribiendo en cualquier campo (el teclado no da toques a la app): no se recarga encima.
registrarTrabajoActivo('teclado', () => !!Keyboard.isVisible?.());
// AURA hablando o pensando con la voz de la mesa. Con hora: un «pensando» que quedó pegado caduca.
registrarTrabajoActivo('aura-habla', () => {
  const e = ecoMesa.ultimo();
  return e.hablando || e.pensando ? e.en || true : false;
});
ecoMesa.escuchar(() => marcarActividad());
mensajeVoz.escuchar(() => marcarActividad());

/* ── estado para la pantalla: ¿hay que instalar la APK nueva? ─────────────────────────────── */

let apkNueva = false;
const oyentes = new Set<() => void>();
function fijarApkNueva(v: boolean) {
  if (v === apkNueva) return;
  apkNueva = v;
  for (const f of [...oyentes]) f();
}
export function useApkNueva(): boolean {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => apkNueva,
    () => apkNueva
  );
}

async function revisarApk() {
  if (Updates.channel !== 'production' || !Updates.runtimeVersion) return;
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(`${URL_APK}/download/runtime-${VARIANTE}.txt`, { signal: ctl.signal });
    if (!r.ok) return;
    const nueva = necesitaApkNueva({ instalado: Updates.runtimeVersion, publicado: await r.text(), canal: Updates.channel });
    if (nueva && !apkNueva) miga('ota: la APK publicada trae otro nativo, hace falta instalarla');
    fijarApkNueva(nueva);
  } catch {
    /* sin red: se mira la próxima vez */
  } finally {
    clearTimeout(reloj);
  }
}

/* ── recargar ─────────────────────────────────────────────────────────────────────────────── */

let recargando = false;
function recargar(por: string) {
  if (recargando) return;
  recargando = true;
  miga(`ota: aplicando la actualización descargada (${por})`);
  // Antes, lo que cada frente no quiere perder (el borrador del chat, al llavero; UI01). Con tope: nunca
  // cuelga la recarga.
  void prepararRecarga()
    .then((r) => {
      if (r.fallaron.length) miga(`ota: no se guardó antes de recargar (${r.fallaron.join(', ')})`);
      return Updates.reloadAsync();
    })
    .catch(() => {
      recargando = false;
    });
}

/** El botón «Reiniciar»: recarga si nada lo impide; si no, devuelve por qué no (vacío = recargando). */
export function aplicarAhora(): string[] {
  const motivos = motivosParaNoRecargar();
  if (decidirAplicar({ pendiente: true, momento: 'boton', motivos }) === 'aplicar') recargar('botón');
  return motivos;
}

/** Lo instalado, para Ajustes: la OTA que corre (o la de fábrica), cuándo se publicó y la huella. */
export function versionInstalada(): { ota: string | null; creada: Date | null; runtime: string | null } {
  if (!Updates.isEnabled) return { ota: null, creada: null, runtime: null };
  return {
    ota: Updates.isEmbeddedLaunch ? null : Updates.updateId?.slice(0, 8) || null,
    creada: Updates.createdAt ?? null,
    runtime: Updates.runtimeVersion?.slice(0, 8) || null,
  };
}

export function useActualizacionAlVolver() {
  const { isUpdatePending } = Updates.useUpdates();
  const pendiente = useRef(isUpdatePending);
  pendiente.current = isUpdatePending;

  useEffect(() => {
    // En desarrollo y en builds sin expo-updates no hay nada que hacer (y reloadAsync rechaza).
    if (__DEV__ || !Updates.isEnabled) return;
    let salioEn = 0;
    let ultimaBusqueda = 0;
    let buscando = false;
    let pospuestoPor = '';
    let relojFin: ReturnType<typeof setTimeout> | null = null;

    const intentar = (momento: Momento, fueraMs?: number) => {
      const motivos = motivosParaNoRecargar();
      const que = decidirAplicar({ pendiente: !!pendiente.current, momento, fueraMs, motivos });
      if (que === 'aplicar') return recargar(momento);
      // Hay trabajo entre manos: no se corta. Una miga por cada motivo distinto, no una por tic.
      const k = que === 'posponer' ? motivos.join(', ') : '';
      if (k && k !== pospuestoPor) miga(`ota: pospuesta (${k})`);
      pospuestoPor = k;
    };

    const buscar = (espacio: number) => {
      if (buscando || AppState.currentState !== 'active' || Date.now() - ultimaBusqueda < espacio) return;
      ultimaBusqueda = Date.now();
      buscando = true;
      void revisarApk();
      void Updates.checkForUpdateAsync()
        .then((r) => (r.isAvailable ? Updates.fetchUpdateAsync() : null))
        .then((f) => {
          if (!f?.isNew) return;
          miga('ota: actualización descargada');
          pendiente.current = true;
          intentar('quieto');
        })
        .catch(() => {})
        .finally(() => {
          buscando = false;
        });
    };

    const primera = setTimeout(() => buscar(0), PRIMERA_BUSQUEDA_MS);
    const tic = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      buscar(ENTRE_BUSQUEDAS_MS);
      intentar('quieto');
    }, TIC_MS);

    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'background') {
        salioEn = Date.now();
        return;
      }
      if (s !== 'active' || !salioEn) return;
      const fuera = Date.now() - salioEn;
      salioEn = 0;
      intentar('volver', fuera);
      marcarActividad();
      buscar(MIN_ENTRE_BUSQUEDAS_MS);
    });

    // Terminó la llamada o la conversación con AURA: si nadie toca nada en un rato, es buen momento.
    const alTerminar = () => {
      if (relojFin) clearTimeout(relojFin);
      relojFin = setTimeout(() => intentar('fin-trabajo'), QUIETO_TRAS_TRABAJO_MS + 1_000);
    };
    const sinLlamada = escuchar('llamada', (e) => {
      if (!e?.activa) alTerminar();
    });
    const sinVoz = escuchar('voz', (e) => {
      if (e?.libre) alTerminar();
    });

    return () => {
      clearTimeout(primera);
      clearInterval(tic);
      if (relojFin) clearTimeout(relojFin);
      sub.remove();
      sinLlamada();
      sinVoz();
    };
  }, []);
}
