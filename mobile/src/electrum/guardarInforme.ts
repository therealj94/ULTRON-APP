/**
 * GUARDAR EN EL TELÉFONO UN INFORME QUE ARMÓ EL DOCTOR.
 *
 * Cuando alguien pide «armame un informe de Quebrada Seca», la herramienta `informe_pdf` deja el
 * PDF en el servidor (media hora) y el doctor contesta «ya está listo para descargar». En el
 * teléfono no había nada que tocar: el informe existía y no se podía sacar.
 *
 * No se puede abrir la URL en el navegador: la ruta pide la credencial en la cabecera y el
 * navegador llegaría sin ella. Tampoco hay en el proyecto con qué pasarle un archivo a otra app
 * (ni `expo-sharing` ni `expo-intent-launcher`), y un `content://` abierto con `Linking` llega sin
 * permiso de lectura. Lo que sí hay es el Storage Access Framework de Android, en
 * `expo-file-system`: la persona elige UNA VEZ una carpeta (se recuerda) y el PDF queda ahí, donde
 * lo abre cualquier visor desde «Archivos».
 */
import { Platform } from 'react-native';
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { descargarInforme } from './api';
import { nombreDeCarpeta, type InformeListo } from './campo';

const K_CARPETA = 'electrum_carpeta_informes';

/** `null` = la persona cerró el selector de carpeta sin elegir: no es un fallo, no hay nada que avisar. */
export async function guardarInformeEnTelefono(inf: InformeListo): Promise<{ carpeta: string } | null> {
  if (Platform.OS !== 'android') throw new Error('Guardar informes solo está hecho para Android.');
  // Primero bajarlo: si el informe ya caducó (404) no tiene sentido pedir una carpeta.
  const base64 = await descargarInforme(inf.url);
  const SAF = FS.StorageAccessFramework;
  let carpeta: string | null = await SecureStore.getItemAsync(K_CARPETA).catch(() => null);
  const nombre = inf.nombre.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || `informe-${inf.id}`;

  // Dos vueltas como mucho: si la carpeta recordada ya no deja escribir (se borró, o se quitó el
  // permiso desde los ajustes), se olvida y se pide otra una sola vez.
  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    if (!carpeta) {
      const p = await SAF.requestDirectoryPermissionsAsync();
      if (!p.granted) return null;
      carpeta = p.directoryUri;
      await SecureStore.setItemAsync(K_CARPETA, carpeta).catch(() => {});
    }
    try {
      const archivo = await SAF.createFileAsync(carpeta, nombre, 'application/pdf');
      await FS.writeAsStringAsync(archivo, base64, { encoding: FS.EncodingType.Base64 });
      return { carpeta: nombreDeCarpeta(carpeta) };
    } catch (e) {
      console.warn('[electrum] informe: no se pudo escribir en', carpeta, (e as Error)?.message || e);
      await SecureStore.deleteItemAsync(K_CARPETA).catch(() => {});
      carpeta = null;
      if (vuelta === 1) throw e;
    }
  }
  return null;
}
