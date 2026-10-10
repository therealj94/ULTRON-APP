# Parches nativos para la PRÓXIMA APK

Aquí, y no en `mobile/patches/`, porque esa carpeta entra en la huella (runtimeVersion): un parche ahí corta las OTA a
las APK instaladas hasta que se instale una APK nueva.

Para la próxima APK: copiar el parche a `mobile/patches/` (lo aplica patch-package en el postinstall) y compilar.

## Ya aplicados

- `expo-av+16.0.8.patch` → `mobile/patches/` en la **5.7.0** (versionCode 56, la del asistente digital: botón lateral,
  burbuja, mosaico y atajo; plugins/asistente-digital.js). `AVManager.onHostDestroy` y `SimpleExoPlayerData.release()`
  sueltan los reproductores en el hilo principal. Cierra el cierre «Player is accessed on the wrong thread» al recargar
  React (8-oct, emulador; y probablemente el cierre de José del 7-oct tras bajar una OTA). La OTA ya lo evitaba desde JS
  (`mobile/src/lib/recarga.ts`); el parche cubre además la recarga que lanza expo-updates por su cuenta. Comprobado con
  patch-package 8.0.1 sobre expo-av 16.0.8 limpio antes de moverlo.
