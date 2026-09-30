# 07 — Pantallas

| Archivo | Qué |
|---|---|
| `Arranque.tsx` | Splash: AU-RA FP · powered by ORDEN GLOBAL, ojos que despiertan |
| `SettingsSheet.tsx` | Ajustes en pestañas (tablist): Preferencias (tema, postura, personalidad), Voz, Privacidad y datos (quién procesa cada cosa, sesión, borrar), Diagnóstico (capacidades y Control) |
| `Capacidades.tsx` | Tarjetas de `GET /api/capacidades` con estado vivo/caído y ejemplos clicables |
| `DockDrawer.tsx` | «Escribir» al conversar: el campo (recibe el foco al abrir) y atajos |
| `MenuMas.tsx` | «Más» del dock: voz, cámara, foto, reposo, marco, pantalla completa |
| `Dialogo.tsx`, `foco.ts` | Todo diálogo: cerrado no existe; abierto `role=dialog`, foco dentro, Escape cierra, el foco vuelve al disparador |
| `AccesoModal.tsx` | Login de junta (correo + clave contra el cerebro remoto), cerrar sesión |
| `UltronVaultModal.tsx` | Bóveda: qué claves hay (booleanos) y guardar la llave de Voicebox (voz y oído) con sesión de mando |
| `CameraCountdownModal.tsx`, `PhotoCaptureModal.tsx` | Foto 3-2-1 y galería |
| `VisionOverlay.tsx` | Cámara frontal sigilosa para el seguimiento de mirada |

Un modal = un archivo, siempre dentro de `Dialogo`. Nada montado con `isOpen={false}` permanente. Colores solo con tokens `(--aura-*)` (src/01-diseno/aura.ts); la superficie de trabajo (conversación, tarjetas de acción, inicio) vive en `src/13-trabajo/`.
