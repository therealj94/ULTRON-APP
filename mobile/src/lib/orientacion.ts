/**
 * Orientación de AU-RA en el teléfono.
 *
 * El flujo que pidió José (29-sep): la entrada sigue al teléfono (se ve bien derecha o acostada);
 * al entrar, la bienvenida arranca en la orientación del avatar (horizontal para AU-RA y Claudio,
 * vertical para Claudio de pie, que está parado) y después se suelta: si la persona gira el
 * teléfono, la mesa se reacomoda (en vertical, cuadro con la cara y el chat abajo).
 *
 * Se recuerda el último modo pedido para volver a aplicarlo al volver de segundo plano: algunos
 * Android sueltan el bloqueo al pausar la app.
 */
import * as ScreenOrientation from 'expo-screen-orientation';

export type ModoOrientacion = 'libre' | 'horizontal' | 'vertical';

let ultimo: ModoOrientacion = 'horizontal';

export function modoActual(): ModoOrientacion {
  return ultimo;
}

export async function orientar(modo: ModoOrientacion): Promise<void> {
  ultimo = modo;
  try {
    if (modo === 'libre') {
      // Libre = sigue al sensor, sin quedar boca abajo (y respeta el bloqueo de giro del sistema).
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
      return;
    }
    const quiere = modo === 'vertical' ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE;
    // Algunos Android ignoran el primer bloqueo justo tras arrancar: se reintenta hasta que conste.
    for (let i = 0; i < 3; i += 1) {
      await ScreenOrientation.lockAsync(quiere);
      const cur = await ScreenOrientation.getOrientationLockAsync();
      const ok =
        cur === quiere ||
        (modo === 'horizontal' && (cur === ScreenOrientation.OrientationLock.LANDSCAPE_LEFT || cur === ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT));
      if (ok) return;
      await new Promise((r) => setTimeout(r, 150));
    }
  } catch {
    /* sin permiso para girar (tablet con bloqueo): se queda como está */
  }
}
