// Doble de expo-file-system/legacy para el banco: el Storage Access Framework «elige» la carpeta
// Download/Informes y anota en `window.__archivos` lo que se escribió, para comprobarlo.
const w = globalThis as any;
w.__archivos = w.__archivos || [];
export const EncodingType = { UTF8: 'utf8', Base64: 'base64' } as const;
export const StorageAccessFramework = {
  requestDirectoryPermissionsAsync: async () => ({
    granted: true,
    directoryUri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2FInformes',
  }),
  createFileAsync: async (dir: string, nombre: string, mime: string) => `${dir}/document/${encodeURIComponent(nombre)}?mime=${mime}`,
};
export async function writeAsStringAsync(uri: string, datos: string, o?: { encoding?: string }) {
  w.__archivos.push({ uri, bytesBase64: datos.length, encoding: o?.encoding, cabecera: atob(datos.slice(0, 12)).slice(0, 5) });
  console.log(`[archivo] ${uri} (${datos.length} en base64, ${o?.encoding})`);
}
