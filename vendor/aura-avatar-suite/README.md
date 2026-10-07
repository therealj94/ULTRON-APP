# AURA · Avatares 3D para Claude

Entrega del 30 de septiembre de 2026. Incluye ANT-ONIO v2 aprobado por la junta y nuevas propuestas funcionales de Claudio y AU-RA. Los tres son geometría 3D articulada; la demo, las capturas y el video muestran los modelos reales.

Abre **AVATARES-AURA-DEMO.html** en un navegador con WebGL. Es autónomo y funciona sin conexión. Si el visor de adjuntos bloquea JavaScript, descarga el HTML y ábrelo en el navegador. Selecciona el personaje, gira la cámara, prueba las expresiones y gestos, o carga un audio local. No se envía ese audio a ningún servicio.

## Modelos

En este repositorio, ANT-ONIO y Claudio se guardan por partes binarias verificadas debido al límite de carga. Ejecuta `npm run restore-models` en esta carpeta para reconstruir los GLB originales. `npm run build`, `npm run qa` y `npm run validate` también lo hacen automáticamente. AU-RA se conserva directamente como GLB.

| Personaje | Identidad conservada | Archivo |
|---|---|---|
| ANT-ONIO | Hormiga masculina, lentes claros, cuatro brazos, ropa negra y cian. Revisión 2 aprobada para integración. | `assets/ANT-ONIO.glb` |
| Claudio | Zorro masculino, lentes ámbar, hocico crema, corona verde, ropa negra y cola con punta clara. Ahora tiene cuerpo 3D, pelo corto geométrico y articulación facial. | `assets/CLAUDIO.glb` |
| AU-RA | Estilo vigente Grafito · Orbe: cerámica marfil, visor curvo grafito, ojos dorados, manos flotantes y órbita metálica. | `assets/AURA-ORBE.glb` |

Cada GLB incluye **30 clips**: 19 emociones, 2 estados y 9 gestos. El código permite 10 estados de actividad, seguimiento de mirada, parpadeo, intensidad de expresión y seis formas de boca. En AU-RA, `lentes` es un gesto de concentración y `caminar` es desplazamiento flotante en el sitio.

`src/characters.js` selecciona el modelo; `src/stage.js` monta la escena. `src/audio.js` conecta audio real y amplitud; el mapeo de tiempos por carácter a visemas es aproximado. La selección del estado «Hablando» no genera una voz ni conecta una IA.

## Integración

Lee **CLAUDE-INTEGRACION.md** primero. Incluye rutas concretas del repositorio revisado, decisiones visuales, interfaces y limitaciones. `integration/AvatarView.tsx` es el componente web; `integration/AvatarWebView.tsx` y `avatarHtml.ts` preparan el montaje móvil con el protocolo de AURA. La carpeta `integration/` contiene también un HTML autónomo por personaje, sin paneles de demo.

El paquete es una entrega para integración. Los archivos están preparados en `vendor/aura-avatar-suite` para su integración; los avatares no están activados en la app. La voz definitiva de ElevenLabs no está activada. ANT-ONIO mantiene su aprobación; Claudio y AU-RA son propuestas nuevas para revisar en esta demo.

## Reconstruir y verificar

```sh
npm ci
npm run build
npm test
npm run qa
npm run validate
```

Node 22 o superior. El QA de navegador está preparado para Linux con Chromium/SwiftShader; incluye exportación de Claudio y AU-RA. El GLB aceptado de ANT-ONIO se conserva byte por byte. Los informes, capturas y comprobaciones de recarga están en `qa/`.

La animación usa nodos articulados y morph targets. No incluye rig humanoide con pesos de piel ni archivo Blender. Los materiales de tela y pelo son estilizados; no equivalen al pelaje cinematográfico de la ilustración original. El pelo corto de Claudio está formado por cintas geométricas y no requiere un sistema de partículas.

En modo alto: Claudio ~353 mil triángulos, ANT-ONIO ~231 mil, AU-RA ~57 mil. El modo bajo reduce resolución, sombras y detalle de materiales; no es una retopología. Medir apertura, memoria y FPS en el Android de destino antes de convertirlo en opción predeterminada. Las pruebas realizadas aquí usan WebGL por software y no certifican rendimiento físico.
