/**
 * LO QUE SE SABE DE CÓMO TERMINÓ LA VEZ ANTERIOR, para las guardias contra cierres (lib/guardiaVoz.ts,
 * lib/guardiaCamara.ts; la regla pura es camaraNativa.ts `causaDelCierre`):
 *  · la marca de «viva» de lib/reporte.ts, ESPERANDO a que se haya leído (antes se podía leer `null` antes de tiempo);
 *  · lo que Android anotó de la salida que vino después de la marca (ApplicationExitInfo, módulo de la cámara v2);
 *  · el JS (OTA) que corre ahora: si la marca la puso otro, la app se reabrió para aplicar una actualización.
 */
import * as Updates from 'expo-updates';
import { salidasNativas } from './auraCamara';
import { motivoDeSalidaTrasMarca, type EstadoGuardia, type SalidaAnterior } from './camaraNativa';
import { murioLaVezAnteriorLeido } from './reporte';

/** El JS que corre: el id de la OTA, 'apk' si es el de fábrica, '' si no se sabe (desarrollo, sin expo-updates). */
export function bundleActual(): string {
  try {
    if (!Updates.isEnabled) return '';
    return Updates.isEmbeddedLaunch ? 'apk' : String(Updates.updateId || '');
  } catch {
    return '';
  }
}

export async function salidaAnterior(e: EstadoGuardia): Promise<SalidaAnterior> {
  const murio = await murioLaVezAnteriorLeido();
  let motivoAndroid: string | null = null;
  try {
    motivoAndroid = motivoDeSalidaTrasMarca(salidasNativas(8), e.montando ?? e.enUso);
  } catch {
    /* sin el módulo: no se sabe */
  }
  return { murio, motivoAndroid, bundle: bundleActual() || null };
}
