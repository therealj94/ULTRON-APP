/**
 * Actualizaciones por aire (EAS Update), sin estorbar.
 *
 * El nativo ya hace lo principal: al arrancar en frío pregunta por el canal y, si hay algo nuevo
 * para ESTA huella nativa, lo descarga en segundo plano (`checkAutomatically: ON_LOAD`,
 * `fallbackToCacheTimeout: 0`: no espera a la red, arranca con lo que tiene). Lo descargado se
 * usa en el siguiente arranque en frío.
 *
 * Aquí solo se añade lo que el nativo no hace:
 *  1. Volver a preguntar al regresar a la app si hace rato que no se pregunta: la mesa de la junta
 *     puede pasar días abierta sin arrancar en frío.
 *  2. Aplicar lo ya descargado cuando la persona VUELVE a la app tras un rato fuera, que para ella
 *     es «volver a abrirla». Nunca en mitad de una conversación ni al girar la pantalla.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';
import { miga } from './reporte';

/** Fuera al menos esto = «la volvió a abrir». Menos es mirar un mensaje y regresar. */
const FUERA_PARA_APLICAR_MS = 10 * 60_000;
/** Entre preguntas al servidor. El arranque en frío ya pregunta por su cuenta. */
const ENTRE_BUSQUEDAS_MS = 30 * 60_000;

export function useActualizacionAlVolver() {
  const { isUpdatePending } = Updates.useUpdates();
  const pendiente = useRef(isUpdatePending);
  pendiente.current = isUpdatePending;

  useEffect(() => {
    // En desarrollo y en builds sin expo-updates no hay nada que hacer (y reloadAsync rechaza).
    if (__DEV__ || !Updates.isEnabled) return;
    let salioEn = 0;
    let ultimaBusqueda = Date.now();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'background') {
        salioEn = Date.now();
        return;
      }
      if (s !== 'active' || !salioEn) return;
      const fuera = Date.now() - salioEn;
      salioEn = 0;
      if (pendiente.current && fuera >= FUERA_PARA_APLICAR_MS) {
        miga('ota: aplicando la actualización descargada al volver');
        void Updates.reloadAsync().catch(() => {});
        return;
      }
      if (Date.now() - ultimaBusqueda < ENTRE_BUSQUEDAS_MS) return;
      ultimaBusqueda = Date.now();
      // Solo descarga: queda pendiente y se aplica la próxima vez que vuelva tras un rato fuera.
      void Updates.checkForUpdateAsync()
        .then((r) => (r.isAvailable ? Updates.fetchUpdateAsync() : null))
        .then((f) => {
          if (f?.isNew) miga('ota: actualización descargada, se aplica al volver');
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);
}
