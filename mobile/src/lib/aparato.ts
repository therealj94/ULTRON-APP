/**
 * Qué teléfono es este, para el servidor: la cabecera `x-aura-aparato`.
 *
 * El servidor la usa para empujar las acciones de AURA al aparato que habló (SSE /api/app/acciones) y
 * para no mezclar los turnos de dos teléfonos de la misma persona. Tiene que ser ESTABLE:
 *  · con cuenta del chat, el id de la llave de este aparato en el relevo (`RELEVO.miId()`), el mismo
 *    con el que el relevo reparte el timbre de las llamadas;
 *  · sin cuenta del chat (o antes de que el relevo lo sepa), un id aleatorio que se crea UNA vez y
 *    queda en SecureStore.
 *
 * Y `x-aura-origen: app` en los turnos que salen de la app: el servidor aplica el camino rápido de
 * órdenes («abre ajustes», «envíalo») solo a la app y a la voz, no a la web.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const CAJON = 'aura.aparato.v1';
let propio: string | null = null;
let pidiendo: Promise<string> | null = null;

/** El id del relevo si hay cuenta del chat (se carga tarde: el relevo trae la criptografía del chat). */
function delRelevo(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require('../pulse/relevo') as typeof import('../pulse/relevo');
    return R.quien() ? String(R.miId() || '') : '';
  } catch {
    return '';
  }
}

function nuevoId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** El id propio de este teléfono: se crea la primera vez y se guarda. Si SecureStore falla, vale para esta vez. */
function idPropio(): Promise<string> {
  if (propio) return Promise.resolve(propio);
  if (!pidiendo) {
    pidiendo = (async () => {
      const g = await SecureStore.getItemAsync(CAJON).catch(() => null);
      if (g && /^[\w-]{8,80}$/.test(g)) return (propio = g);
      const n = nuevoId();
      await SecureStore.setItemAsync(CAJON, n).catch(() => {});
      return (propio = n);
    })().finally(() => {
      pidiendo = null;
    });
  }
  return pidiendo;
}

export async function idAparato(): Promise<string> {
  return delRelevo() || (await idPropio());
}

/** Las cabeceras de este teléfono. `turno`: además, que el turno sale de la app. */
export async function cabecerasAparato(turno = false): Promise<Record<string, string>> {
  const id = await idAparato().catch(() => '');
  return { ...(id ? { 'x-aura-aparato': id } : {}), ...(turno ? { 'x-aura-origen': 'app' } : {}) };
}
