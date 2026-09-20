export const Accuracy = { High: 4 };
export async function requestForegroundPermissionsAsync() { return { status: 'granted' as const }; }
export async function getCurrentPositionAsync() {
  // Un punto dentro del fixture de catastro, para que la respuesta del campo sea creíble.
  return { coords: { longitude: -87.0421, latitude: 13.4218, accuracy: 6 } };
}
