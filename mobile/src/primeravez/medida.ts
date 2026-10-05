/**
 * EL PRIMER RESULTADO EN EL TELÉFONO (auditoría del 4-oct, P4 · R1): guarda, por cuenta, el registro de
 * lib/primerResultado.ts (la copia de lib/primer-resultado.ts, donde está la explicación) y lo va moviendo
 * con lo que pasa: la primera vez cuenta los toques y deja la petición; la mesa anota el envío, el resultado
 * del turno o de sus tareas y el «¿Te sirvió?».
 *
 * Por cuenta y sin fugas: la clave lleva el correo, el registro lleva su dueño (leerPrimer descarta el de
 * otra cuenta) y cada escritura comprueba que la sesión sigue siendo la misma (lib/cuenta.ts): lo que llega
 * tarde de A no se escribe con B dentro. Las escrituras van en fila: dos eventos seguidos no se pisan.
 *
 * Al llegar el resultado (y al opinar) sale UNA línea al diagnóstico de campo que ya existe (lib/reporte.ts,
 * POST /api/diag): solo tiempos, conteos y estados; nada de lo pedido ni de lo contestado.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generacionCuenta, sigueVigente } from '../lib/cuenta';
import { reportarEstado } from '../lib/reporte';
import { aplicar, clavePrimer, hayResultado, leerPrimer, lineaMetrica, metricas, nuevoPrimer, type EventoPrimer, type PrimerResultado } from '../lib/primerResultado';

let fila: Promise<unknown> = Promise.resolve();
const oyentes = new Set<(correo: string, r: PrimerResultado | null) => void>();

/** Avisa cada cambio guardado (la mesa redibuja la pregunta «¿Te sirvió?»). Devuelve cómo dejar de oír. */
export function alCambiarPrimer(f: (correo: string, r: PrimerResultado | null) => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

export async function leerPrimerDe(correo: string): Promise<PrimerResultado | null> {
  if (!correo) return null;
  try {
    return leerPrimer(await AsyncStorage.getItem(clavePrimer(correo)), correo);
  } catch {
    return null;
  }
}

/** Lee, cambia y guarda en fila. Si la sesión cambió mientras tanto, no escribe nada. */
function cambiar(correo: string, f: (r: PrimerResultado | null) => PrimerResultado | null): Promise<PrimerResultado | null> {
  const gen = generacionCuenta();
  const paso = fila.then(async () => {
    if (!correo || !sigueVigente(gen)) return null;
    const antes = await leerPrimerDe(correo);
    const despues = f(antes);
    if (!despues || despues === antes || !sigueVigente(gen)) return antes;
    await AsyncStorage.setItem(clavePrimer(correo), JSON.stringify(despues));
    for (const o of [...oyentes]) o(correo, despues);
    // El resultado llegó (o la persona opinó): una línea, sin contenido, al diagnóstico de campo.
    if ((hayResultado(despues) && !hayResultado(antes)) || (despues.sirvio !== undefined && antes?.sirvio === undefined)) reportarEstado(lineaMetrica(metricas(despues)));
    return despues;
  });
  fila = paso.catch(() => undefined);
  return paso.catch(() => null);
}

/** La primera vez empieza (o se retoma): crea el registro solo si esta cuenta no tiene uno. */
export function empezarPrimer(correo: string) {
  return cambiar(correo, (r) => r ?? nuevoPrimer(correo, Date.now()));
}

/** Un evento del primer resultado (lib/primer-resultado.ts `aplicar`). Sin registro (cuenta de antes), no hace nada. */
export function anotarPrimer(correo: string, ev: EventoPrimer) {
  return cambiar(correo, (r) => aplicar(r, ev, Date.now()));
}
