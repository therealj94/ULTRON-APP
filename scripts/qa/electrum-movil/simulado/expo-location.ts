// Doble de expo-location para el banco de pruebas. Contesta lo que contestaría un teléfono con el
// permiso concedido y el GPS encendido; `?gps=lento` simula un GPS que no fija nunca (bajo árboles)
// y `?gps=apagado` la ubicación del sistema desactivada.
const gps = new URLSearchParams(globalThis.location?.search || '').get('gps') || '';

export const Accuracy = { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 };
export async function getForegroundPermissionsAsync() {
  return { status: 'granted' as const, granted: true, canAskAgain: true, expires: 'never' as const };
}
export async function requestForegroundPermissionsAsync() {
  return { status: 'granted' as const, granted: true, canAskAgain: true, expires: 'never' as const };
}
export async function hasServicesEnabledAsync() {
  return gps !== 'apagado';
}
export async function getLastKnownPositionAsync() {
  return null;
}
export async function getCurrentPositionAsync() {
  if (gps === 'lento') return new Promise<never>(() => {});
  // Un punto dentro del fixture de catastro, para que la respuesta del campo sea creíble.
  return { coords: { longitude: -87.0421, latitude: 13.4218, accuracy: 6, altitude: 540, altitudeAccuracy: 8, heading: 0, speed: 0 }, timestamp: Date.now() };
}
