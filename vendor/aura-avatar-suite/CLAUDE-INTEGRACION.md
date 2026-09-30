# Claude · Integrar los avatares de AURA

Medardo pidió preparar esta entrega para que tú la integres y la subas después. **ANT-ONIO revisión 2 está aprobado**: «Perfecto ahi si dejarlo listo claude lo suba». No pedirle de nuevo aprobación del mismo diseño. Conservar su GLB. Claudio y AU-RA son dos propuestas nuevas de esta entrega; mostrar el render real al revisar el montaje.

## Repositorio revisado

`https://github.com/therealj94/ULTRON-APP`

Commit leído: `794cc8369fa9c50600e283043217e6b55508d731`. La entrega se incorpora en una rama dedicada dentro de `vendor/aura-avatar-suite`; no modifica el funcionamiento activo de la app. Antes de integrar, leer la revisión actual y sus instrucciones; no sobrescribir cambios posteriores. La inspección del commit no encontró `AGENTS.md`.

| Evidencia actual | Resultado y decisión |
|---|---|
| `mobile/src/avatares/ClaudioRetrato.tsx` y `ClaudioDePie.tsx` | Claudio usa imágenes WebP con fundidos, respiración por escala y tres bocas. Crear una opción 3D real, conservando los WebP como alternativa de recuperación. |
| `mobile/assets/avatares/claudio/base.webp` y `claudio-pie/base.webp` | Zorro naranja masculino, lentes ámbar, sudadera negra/corona verde, cola crema. Se conserva esa identidad. |
| `docs/AURA-3D.md`, `src/11-sala/estilos.ts` | La identidad seleccionada de AU-RA es **Grafito · Orbe**, no las antiguas propuestas de muñeca con vestido o moño. Se mantiene el orbe. |
| `src/11-sala/sala.ts` | AU-RA ya tiene un cuerpo 3D procedural y una sala con objetos/tareas. Se refina el personaje; esta entrega no sustituye las acciones de mobiliario de esa sala. |
| `mobile/src/avatares/catalogo.ts` | IDs persistidos `ojos`, `aura`, `claudio`; `claudio-pie` se normaliza a `claudio`. Añadir `antonio` explícitamente. Mantener los IDs existentes. |
| `mobile/src/screens/DeskScreen.tsx` | La vista de sala se usa para `aura`; Claudio cambia entre retrato y cuerpo según orientación. Añadir la opción 3D y probar ambos encuadres. |
| `src/11-sala/embed.ts`, `mobile/src/components/SalaAura.tsx` | Contrato `window.__aura`, preparación de estado tras `listo`, boca a ~15 Hz y recuperación por fallo WebGL. El adaptador nuevo usa un subconjunto compatible. |

No modificar el cerebro Qwen, memoria, sesiones, permisos, herramientas, contratos SSE ni voces vigentes por introducir el nuevo aspecto. Mantener las paletas de cada avatar: dorado de AU-RA, naranja de Claudio y cian de ANT-ONIO.

## Archivos y montaje

En esta rama, ejecutar `npm run restore-models` dentro de `vendor/aura-avatar-suite` para restaurar ANT-ONIO y Claudio desde `assets/model-parts/`. El script verifica SHA-256 y reproduce los GLB originales byte por byte, sin descargar nada. Los scripts de build, QA y validación ejecutan ese paso automáticamente.

Copiar esta entrega a `vendor/aura-avatar-suite` o adaptar sus importaciones de forma explícita. Mantener `src/`, `integration/` y los GLB versionados. Three.js está fijado en 0.186.1 en este paquete; comprobar compatibilidad antes de unificarlo con el usado por la sala. No mezclar clases de dos copias distintas de Three.js en una misma escena.

1. Web: montar `integration/AvatarView.tsx` dentro de un contenedor con dimensiones. El efecto limpia recursos al desmontar y vuelve a aplicar señales cuando cambia el avatar.
2. Móvil: montar `integration/AvatarWebView.tsx`. Recibe `id`, `face`, `emocion`, `speechLevelSource`, `mirada`, `pedido`, `onTocar` y `onFallo`. `avatarHtml.ts` se genera con `npm run build`; todo queda empaquetado en la APK y no requiere CDN. Un cambio de `id` remonta la WebView y reinicia el protocolo de preparación.
3. Usar la reproducción de voz nativa ya existente en el teléfono y enviar su nivel a la boca. No activar además el reproductor del demo. Una sola capa debe ser dueña del audio.
4. Ante fallo, recuperar el avatar previo de imágenes o cara actual. El adaptador conserva timeout de preparación, manejo de errores y muerte del proceso WebView.
5. Añadir ANT-ONIO al selector y a la normalización de ID. Revisar también la selección de voz en servidor: añadir un aspecto no autoriza cambiar o duplicar voces.
6. Las escenas incluidas son de presentación de pie o flotando. **No implementan silla, escritorio ni tareas con objetos.** Mantener la sala de AU-RA como vista independiente, o insertar su nuevo cuerpo en la sala conservando `crearSala`, los puntos de contacto y sus tareas. No mostrar una opción «sentada» que no funcione.

Los adaptadores TSX se comprobaron sintácticamente; no se compilaron dentro de la app completa ni se instaló una APK. Adaptar los tipos/importaciones al estado actual de la rama y ejecutar sus pruebas antes de publicar.

## Señales y animación

```js
import {mountAvatar} from './src/stage.js';
const stage=mountAvatar(host,{id:'claudio',quality:'high',transparent:true});
stage.avatar.setEmotion('curioso',0.8);
stage.avatar.setState('listening');
stage.avatar.playGesture('saludar');
stage.avatar.lookAt(0.3,-0.2); // y positiva hacia abajo, sin invertir dos veces
stage.avatar.setSpeech(0.7,'O');
// Al interrumpir voz: setSpeech(0). Al desmontar:
stage.dispose();
```

El puente acepta `estado`, `boca`, `mirar`, `tarea`, `gesto`, `entrar` y `postura:pie`. Rechaza niveles no finitos, tareas desconocidas y postura sentada. Las tareas conocidas solo producen un gesto; «éxito» debe provenir de la respuesta real del servidor, no del gesto. `onTocar` distingue cabeza y cuerpo mediante intersección con el modelo.

Los GLB también funcionan con `GLTFLoader` y `AnimationMixer`. Sus clips contienen las poses completas: usar transiciones de unos 0,25 s, gestos de una sola ejecución y un solo controlador por nodo. Mirada interactiva y boca en tiempo real necesitan el controlador del paquete o uno equivalente; un clip de canto no sincroniza audio.

## Voz posterior

La voz definitiva no está seleccionada ni se hizo una llamada facturable. El puente de boca funciona con audio real. Mantener la voz individual vigente de cada avatar.

La documentación oficial consultada el 30-09-2026 indica que **Eleven v4 usa Text to Dialogue WebSocket**. Preparar esa conexión en servidor cuando Medardo elija su voz; no enviar `eleven_v4` a un ejemplo antiguo de TTS HTTP con timestamps. Claves, selección de voz, autenticación, cancelación y límites quedan en servidor. El paquete ANT-ONIO actualizado bloquea ese uso erróneo del ejemplo HTTP.

Referencia: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd

La amplitud mueve la boca; los tiempos por carácter permiten un mapeo aproximado de vocales. Para una interpretación vocal más fiel, ajustar visemas y tiempos a la voz elegida. No presentar la demo como un asistente conectado.

## Comprobaciones en la rama de integración

- Verificar `tests/avatares-movil.test.ts` al añadir un cuarto ID; actualmente presupone tres.
- Revisar `tests/aura-avatares-voz.test.ts` para conservar las voces por personaje.
- Actualizar `tests/sala-movil.test.ts` únicamente si cambia su bundle; no reemplazar la sala por un HTML de personaje sin conservar sus contratos.
- Probar contexto WebGL perdido, orientación, cambio de avatar durante voz, interrupción, reinicio y restauración del avatar elegido.
- Comparar capturas del montaje real con esta demo; mostrar frente, perfil, parpadeo, risa, tristeza, gesto de lentes y seguimiento de mirada.
- Medir memoria/FPS en Android físico y escoger resolución/LOD. Claudio es el modelo más pesado por el pelo; `quality:low` reduce materiales y sombras pero no geometría.
- Ejecutar las pruebas propias de la app y las del paquete. Entregar el commit/PR, capturas y resultados antes del despliegue correspondiente.

Esta entrega contiene fuentes editables y GLB; no contiene archivo Blender ni rig humanoide de piel ponderada. La articulación es una jerarquía de nodos y morph targets. El acabado es estilizado y no debe confundirse con la imagen original cinematográfica.
