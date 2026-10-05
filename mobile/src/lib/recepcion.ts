/**
 * QUÉ BUILD CORRE ESTE TELÉFONO, EN CADA PETICIÓN A AURA: la cabecera `x-aura-cliente` que api() añade (evidencia de
 * operación, 5-oct). El servidor la anota en la cuenta de la sesión como mucho cada 10 minutos por instalación (o en
 * cuanto cambia el build: una OTA recién aplicada) y GET /api/build la enseña al dueño. Así, José abre la app y desde el
 * servidor se ve si la OTA o la APK le llegó.
 *
 * El id de la instalación: al azar, en SecureStore, atado a la cuenta que está dentro (su seudónimo, lib/cuenta.ts).
 * Se renueva al salir (se borra) y al cambiar de cuenta (otro seudónimo, otro id): lo de una cuenta no se puede
 * cruzar con lo de otra ni por este id. Sin nadie dentro no se manda nada.
 *
 * Los datos del build los da lib/ota.ts (`fijarDatosBuild`), que ya habla con expo-updates; aquí no se importa nada
 * nativo más que SecureStore y Crypto (como lib/aparato.ts), así los arneses de node lo cargan con sus dobles.
 * Formato y validación: lib/recepcionDescriptor.ts (y, en el servidor, lib/recepcion-clientes.ts).
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { alCambiarCuenta, generacionCuenta, seudonimoActual, sigueVigente } from './cuenta';
import { descriptorCliente, type DatosBuild } from './recepcionDescriptor';

export const CABECERA_CLIENTE = 'x-aura-cliente';
const CAJON = 'aura.recepcion.v1';
const FORMA_ID = /^[A-Za-z0-9-]{8,64}$/;

let datos: (() => DatosBuild | null) | null = null;
let propio: { de: string; id: string } | null = null;

/** Quien sabe del build (lib/ota.ts) lo deja aquí. `null` lo quita (pruebas, o «apagado»: sin datos no hay cabecera). */
export function fijarDatosBuild(f: (() => DatosBuild | null) | null) {
  datos = f;
}

// Salir o cambiar de cuenta: el id de antes ya no vale. Al salir, además, se borra del teléfono.
alCambiarCuenta(() => {
  const de = seudonimoActual();
  if (propio && propio.de === de) return;
  propio = null;
  if (!de) void SecureStore.deleteItemAsync(CAJON).catch(() => {});
});

function nuevoId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** El id de esta instalación PARA la cuenta que está dentro, o '' si no hay nadie (o cambió mientras se leía). */
export async function idInstalacion(): Promise<string> {
  const de = seudonimoActual();
  if (!de) return '';
  if (propio?.de === de) return propio.id;
  const gen = generacionCuenta();
  let guardado: { de?: string; id?: string } | null = null;
  try {
    guardado = JSON.parse((await SecureStore.getItemAsync(CAJON)) || 'null');
  } catch {
    guardado = null;
  }
  // La cuenta cambió mientras se leía: este id ya no es de nadie que esté aquí.
  if (!sigueVigente(gen)) return '';
  if (guardado && guardado.de === de && FORMA_ID.test(String(guardado.id || ''))) {
    propio = { de, id: String(guardado.id) };
    return propio.id;
  }
  const nuevo = { de, id: nuevoId() };
  propio = nuevo;
  await SecureStore.setItemAsync(CAJON, JSON.stringify(nuevo)).catch(() => {});
  return sigueVigente(gen) ? nuevo.id : '';
}

/** La cabecera para api(), o nada (sin datos del build, sin nadie dentro o si algo falla). Nunca lanza. */
export async function cabeceraCliente(): Promise<Record<string, string>> {
  try {
    const d = datos?.() ?? null;
    if (!d) return {};
    const id = await idInstalacion();
    const h = id ? descriptorCliente(d, id) : '';
    return h ? { [CABECERA_CLIENTE]: h } : {};
  } catch {
    return {};
  }
}

/** Solo pruebas. */
export function _reiniciarRecepcion() {
  propio = null;
  datos = null;
}
