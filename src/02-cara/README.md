# 02 — Cara

La cara viva de AU-RA FP: dos ojos cian OLED, boca ciber, halo que respira, motas
y anillo de voz. Canvas 2D a 60 fps, pensada para tablet/teléfono en la mesa de la junta.
Paleta: negro + cian `#05E1FF` (tokens en `src/01-diseno/tokens.ts`).

## Archivos

| Archivo | Qué hay | Tócalo cuando… |
| --- | --- | --- |
| `FaceCanvas.tsx` | Componente React: bucle rAF, motor de animación (parpadeo, sacadas, mirada, respiración), capa de expresión por emoción, mapa táctil, composición de la escena. | cambies un comportamiento (tiempos, metas por cara, gestos táctiles, qué se dibuja y en qué orden). |
| `dibujo.ts` | Tema por modo, ojo vivo (con squash táctil y párpado sereno), ceja en arco, boca de dos labios con visemas e interior, halo, motas (sprite pre-renderizado), chispas, anillo de voz, ondas de toque, tipo `Vida`. | cambies el **aspecto**: forma del ojo, de la boca, colores, partículas. |
| `funPack.ts` | Pack de juguete: visor rojo, coronas y glifos de modo, sable jedi, blásters + láseres, vaso holográfico, mano que saluda, visor de cámara/flash. | toques algo que sólo aparece con `funMode`. |
| `emocion.ts` | `caraDeEmocion(e)` (emoción del cerebro → `FaceState`) y `caraDeTexto(texto)` (heurística por lo que dijo el jefe). | cambies qué cara de fondo corresponde a cada emoción. |
| `gestos.ts` | Lista `GESTOS` / tipo `Gesto` que la cara reporta por `onGesto`. | agregues un gesto nuevo. |
| `faceTracker.ts` | Tracker óptico de **respaldo** (luminancia + movimiento, 64×48). Solo corre si MediaPipe no carga. | casi nunca; ver sección Cámara. |
| `vision/escena.ts` | Contrato `Escena`, `describirEscena` y `MaquinaEscena` (eventos con histéresis). Puro, sin DOM: se testea en `tests/escena.test.ts`. | cambies umbrales, eventos o la frase en español. |
| `vision/mediapipe.ts` | Carga del FaceLandmarker (WASM + modelo por URL, GPU→CPU, timeout 6 s) y traducción de landmarks/blendshapes a `Observacion`. | cambies modelo, URLs o cómo se leen los gestos. |
| `vision/motor.ts` | `MotorVision`: un bucle rAF a 15–20 fps que elige motor, alimenta la máquina y emite `onEscena` / `onGaze`. | cambies fps, suavizado de mirada o la política de fallback. |

## Props de `FaceCanvas`

| Prop | Tipo | Notas |
| --- | --- | --- |
| `face` | `FaceState` | Cara base. App decide el hold (`onFaceChange(face, ms)`). |
| `mode` | `Mode` | Tinte de paleta (GOLD es dorado; el resto cian con acento distinto). |
| `energy` | `number` 0–100 | Escala la energía ambiental (motas, halo). |
| `soundFxEnabled` | `boolean` | SFX de toques y reacciones (`03-voz/audio`). |
| `emocion?` | `Emocion` (`lib/emocion.ts`) | **Nuevo.** Al cambiar dispara una micro-expresión de 1.5–4 s sobre la cara base, aunque `face` siga en `SPEAKING`. `'neutral'` la limpia. |
| `funMode?` | `boolean` (false) | **Nuevo.** Enciende blásters, sable, coronas/glifos de modo, bocas de tablet (CREATIVE/EXPLORER) y la escalada al picar. Sin él la cara es limpia. |
| `hasVisor?` | `boolean` | Visor rojo. Se respeta aunque `funMode` sea false. |
| `cameraGaze?` | `{x,y,active}` | Mirada hacia la persona detectada por cámara. Manda sobre las sacadas. Con `active`, la cara se ilumina hasta un 8 % (`V.atencion`), se traslada 1.5 % del ancho y se inclina ~1.5° hacia el lado de la persona; al perderla vuelve despacio (rate 0.7). |
| `isDrinking?` / `isWaving?` | `boolean` | Vaso y mano. Se respetan aunque `funMode` sea false. |
| `isCameraFlashing?` | `boolean` | Visor de cámara + flash + `onSnapshotReady(dataUrl)`. |
| `isCombatBlasterActive?` | `boolean` | Sólo con `funMode`; sin él se responde `onBlasterCombatEnd()` de inmediato. |
| `resetTrigger?` | `number` | Cualquier incremento desarma todo y vuelve a `IDLE`. |
| `lipLevel?` | `number` 0–1 | Nivel de labios (voz). En `SPEAKING`/`SING`/`PRAY` (y expresiones `canto`/`oracion`) la boca lo sigue con ataque rápido (rate 20 subiendo, 11 bajando), una "mandíbula" (`V.jaw`: más alto + empuje hacia abajo 0.14·R) y **visemas** (ver abajo) para que se lea a tres metros; mueve también el anillo de voz. Si la señal se queda en 0 más de 1.5 s, entra un visema sintético. |
| `showHud?` | `boolean` | Con `funMode`: corona y ambiente de modo. |
| `onFaceChange(face, ms?)` | callback | La cara pide cambios (guiño, ronroneo, risa, curiosidad…). |
| `onModeChange`, `onSwipeUp`, `onSwipeDown`, `onWake`, `onSleep`, `onCloseOverlays`, `onSpeak`, `onTriggerVoice`, `onToggleVisor?` | callbacks | Sin cambios. |
| `onDrinkComplete?`, `onWaveComplete?`, `onBlasterCombatEnd?`, `onTriggerBlasterCombat?`, `onSnapshotReady?` | callbacks | Sin cambios. |
| `onGesto?(g: Gesto)` | callback | **Nuevo.** Reporta gestos táctiles y de expresión (ver `gestos.ts`). |

Helpers exportados: `caraDeEmocion`, `CARA_POR_EMOCION`, `caraDeTexto`, `GESTOS`, `FaceCanvasProps`.

## FaceStates

`IDLE · LISTENING · THINKING · SPEAKING · HAPPY · CONCERNED · ANGRY · FURY · SLEEPING · STARTLE · PURR · WINK · CURIOSITY · JEDI` (existentes) + **`LAUGH · SURPRISED · SAD · TIRED · SING · PRAY`** (nuevos).

| Cara | Micro-expresión |
| --- | --- |
| `LAUGH` | Ojos en arco apretados, brinco ~5 Hz que decae, boca abre/cierra al ritmo aunque no haya `lipLevel`, cejas arriba, cabeceo lateral. |
| `SURPRISED` | Pupila que se **cierra** de golpe (dilate 0.2, anillo de iris marcado), cejas muy altas y arqueadas (lift 1.05 → 0.8), ojos más abiertos que 1 (1.12 durante 1.4 s, luego 1.06), boca en «o» (`mouthRound` 1, apertura 0.62), congelado 0.35 s sin parpadear. |
| `SAD` | Cejas con interior arriba, párpados al 62 %, mirada abajo, respiración lenta, mueca leve. |
| `TIRED` | Párpados al 55 %, parpadeos lentos con alguno largo, deriva hacia abajo, un bostezo al entrar. |
| `SING` | Como HAPPY con ojos abiertos; boca sigue `lipLevel` con ganancia 1.0, balanceo suave, chispas suben desde la boca, anillo de voz. |
| `PRAY` | Ora en voz alta: párpados se cierran en ~0.8 s (rampa `cierre`, sin Z ni caída de sueño) y se dibujan como **arcos serenos hacia abajo** con pestaña exterior (no la raya plana de `SLEEPING`), micro-aleteo cada 3–7 s, cabeza quieta, respiración ×0.45, boca pequeña (ancho 0.62) con sonrisa mínima, cejas relajadas con interior apenas arriba y más cerca de los párpados, boca sigue `lipLevel` (ganancia 0.7) + anillo de voz, halo cálido más presente, motas lentas. Al salir los ojos abren en ~0.6 s. |
| `THINKING` | Mirada arriba-izquierda, una ceja más alta, pulso "hmm" cada 2.6–4.8 s (ceja + brinco leve + dilatación). |
| `LISTENING` | Mirada se centra tras 1.2 s sin interacción, pupila un poco más dilatada con pulso lento, cejas apenas arriba (atento), sin ceño. |
| `CONCERNED` | Interiores de ceja arriba y juntos (`browWorry` 0.7) con un leve ceño (brow 0.28), párpados al 86 %, comisuras abajo (smile −0.6), boca algo más estrecha. Se distingue de `LISTENING` (no frunce), de `SAD` (cejas caídas sin ceño, párpados al 62 %, mirada abajo) y de `ANGRY` (interiores abajo, labio apretado). |
| `ANGRY` | Cejas con interior abajo, párpados al 80 %, **labio apretado** (`mouthPress` 0.9: fino, ancho, línea central oscura), sacudida corta. |
| `IDLE` | Además de parpadeos y micro-sacadas: respiración visible (toda la cara escala ±1.5 %), tic de una ceja de 1 px cada 2.5–7 s (`browTwitch`), deriva lenta de pupila (`pupilDrift`, periodos 19 s y 7 s). Las cejas siempre están presentes, tenues (alfa 0.42) hasta que una expresión las llama. |

Metas por cara (`dilate/brow/mouth/smile/bounce`) en `getTargetsFor`; metas de la capa viva (párpados,
cejas en paralelo/asimetría/preocupación, inclinación, mirada, ritmo de respiración/parpadeo, forma de boca) en `metasDeCara`.

## Boca: formas y visemas

La boca (`drawCyberMouth`) son dos labios en Bézier cúbica con gradiente de volumen, interior oscuro con
profundidad (cavidad radial + "lengua" iluminada) cuando abre más de 0.14, y comisuras de brillo cuando la
sonrisa pasa de 0.55. Ancho base 1.2·R (antes 0.76·R) para que pese frente a los ojos. Parámetros:

| Parámetro | Quién lo mueve | Efecto |
| --- | --- | --- |
| `A.mouth` + `V.mouthExtra` | targets por cara, `lipLevel`, risa, bostezo, «hmm», tacto | apertura 0 (línea) → 1 (muy abierta) |
| `A.smile` + `V.smileExtra` | targets, expresiones, tacto en mejilla | + comisuras arriba (curva 0.24·R), − comisuras abajo (0.17·R) y labio inferior hacia afuera |
| `V.mouthRound` | `SURPRISED`/`STARTLE` (1), `THINKING` (0.3), `SING` (0.25), expresión `sorpresa`, «oh» táctil | boca en «o»: más estrecha, más alta, curvas más redondas |
| `V.mouthPress` | `ANGRY` (0.9), `FURY` (0.55), expresiones `molesto`/`preocupado`, ráfaga de toques | labio apretado: casi sin altura, más ancho, curvatura ×0.45, línea central oscura |
| `V.mouthWidth` | por cara (`PRAY` 0.62, `THINKING` 0.72, `SAD` 0.82, `IDLE` 0.95, `ANGRY` 1.08) | escala del ancho |
| `V.mouthSkew` | `THINKING` (0.45), expresión `travieso`, tacto en mejilla | ladeada / media sonrisa |
| `V.mouthStretch` | arrastre (lado del dedo) | se desplaza 0.26·R y se ensancha hacia ese lado |
| `V.jaw` | `lipLevel` | mandíbula: más alto + baja 0.14·R |

**Visemas** (sólo en caras que hablan): cada ataque de `lipLevel` (subida > 0.1) elige una forma nueva —
redonda («o/u», 38 %), ancha («e/i», 34 %) o neutra («a») — con una asimetría propia del labio inferior
(`visAsym` ±0.3). Una vocal sostenida cambia de forma sola cada ~0.4 s; sin señal, el visema sintético
cambia cada 0.18–0.32 s. Las formas entran a rate 24 y salen a 12: tres aperturas legibles (cerrada / media /
abierta redonda) más la mandíbula. Con `lipLevel` estático la boca igual se mueve.

## Emoción → expresión (`emocion` prop)

`caraDeEmocion` da la cara de fondo; la capa `expresion` pone encima el matiz durante unos segundos
con envolvente (0.3 s entra, 0.7 s sale). Se dispara al **cambiar** la prop.

| Emoción | Cara base | Capa de expresión | Dur. |
| --- | --- | --- | --- |
| `neutral` | IDLE | limpia la capa | — |
| `feliz` | HAPPY | sonrisa +, cejas relajadas, brinco, más energía ambiental | 2.8 s |
| `risa` | LAUGH | pulsos de risa cada ~1.1 s (boca, brinco, cabeceo) incluso hablando | 3.4 s |
| `sorpresa` | SURPRISED | flash de cejas, ojos anchos, dilatación, congelado 0.25 s | 1.5 s |
| `curioso` | CURIOSITY | cabeza inclinada, una ceja arriba, pupila + | 2.8 s |
| `pensando` | THINKING | mirada arriba-izquierda, ceja asimétrica, "hmm" | 3.0 s |
| `preocupado` | CONCERNED | ceño fruncido, comisuras abajo, párpados 90 % | 2.8 s |
| `triste` | SAD | cejas caídas (interior arriba), párpados 70 %, mirada abajo, respiración lenta | 3.2 s |
| `molesto` | ANGRY | cejas abajo, pupila más cerrada, mueca, sacudida corta | 2.4 s |
| `cansado` | TIRED | párpados pesados, parpadeo lento, deriva abajo | 3.4 s |
| `carino` | PURR | sonrisa suave, párpados 80 %, pupila +, leve inclinación | 3.0 s |
| `orgullo` | HAPPY | pecho arriba (lift), sonrisa, cejas relajadas, brinco | 2.8 s |
| `travieso` | WINK | guiño (ojo derecho), media sonrisa ladeada, ceja | 2.2 s |
| `canto` | SING | balanceo, chispas, boca sigue `lipLevel`, anillo de voz | 4.0 s |

Cada disparo también llama `onGesto` con `feliz | risa | sorpresa | curioso | pensar | preocupado | tristeza | molesto | cansado | carino | orgullo | travieso | canto | orar`.

## Mapa táctil (por defecto, humano)

Al **bajar el dedo** (`pointerdown`, antes de saber si es tap, arrastre o pulsación larga) la cara responde en el
mismo frame: las pupilas saltan al punto de contacto (`A.lx/ly` se fijan, no se suavizan), sale una onda fina que se
expande desacelerando y se disuelve (anillo + eco interior + punto de contacto), y la zona tocada reacciona con una
envolvente que decae (`squashL/R` rate 6.5, `touchOh` 2.8, `touchSmile` 1.8, `annoy` 1.3). Al **soltar** se decide el
gesto y, si es tap, se aplica el estado de la tabla.

| Gesto | Al bajar el dedo (<50 ms) | Al soltar | `onGesto` |
| --- | --- | --- | --- |
| Tap en un ojo | Squash de ese ojo (más ancho, 45 % menos alto) + guiño | `WINK` 1.6 s | `tapOjo`, `wink` |
| Tap en el centro (entre los ojos, \|y\| < 0.6 R) | Squash de los dos ojos + «oh» leve | guiño suave | `tapMejilla` |
| Tap en la frente (arriba de los ojos) | Cejas arriba de golpe, ojos un poco más abiertos | `CURIOSITY` 1.8 s | `tapFrente`, `curioso` |
| Tap en barbilla / boca | «Oh» corto: boca en «o», cejas arriba | Cosquillas: `LAUGH` 2.2 s | `tapBarbilla`, `risa` |
| Tap en mejilla u otro sitio | Sonrisa que tira hacia el lado tocado (`touchSmileSide` → `mouthSkewT`, ladeada mientras dura la sonrisa, sin tirón) | Guiño/doble parpadeo suave; la meta de sonrisa sólo sube (hasta 0.6), nunca baja la de una cara ya feliz | `tapMejilla` |
| 2º tap seguido | Molestia leve: cejas empiezan a juntarse (`annoy` 0.55) | — | — |
| 3+ taps en 1.4 s | Molestia juguetona plena: cejas juntas, párpados al 72 %, labio apretado (`annoy` 1) | "Ya, ya": `ANGRY` 1.2 s → `LAUGH` 1.8 s; `onSpeak('Ya, ya. Je.')` una vez por ráfaga, **al empezar la risa** (si se dijera antes, la cara de habla de App taparía la molestia) | `molestoJuego`, `risa` |
| Frotar mitad inferior (trazo) | — | `PURR` 3.4 s | `frotarMejilla` |
| Arrastrar | Los ojos persiguen el dedo con un muelle sub-amortiguado (k 55, c 10: un pelo de rebote) y la boca se estira hacia ese lado | Micro-sacadas hacia el último punto y vuelta lenta al centro (~7 s) | `arrastre` |

El canvas hace `setPointerCapture` al bajar el dedo: si se suelta sobre un overlay (barra, panel, burbuja) el
`pointerup` igual llega y el arrastre no queda pegado. Red de seguridad `soltarPuntero()` en `pointercancel`,
`lostpointercapture` y `pointerleave`: termina el contacto (sin gesto), suelta la boca y apaga el muelle.
| Pulsación larga (>650 ms) | Dormir / despertar | `longPress`, `dormir` / `despertar` |
| Tap dormido | Despierta | `despertar` |
| Swipe arriba / abajo | `onSwipeUp` / `onSwipeDown` | `swipeArriba` / `swipeAbajo` |
| Swipe horizontal | Cicla el modo | `swipeLado` |

Con `funMode` la ráfaga de taps vuelve a la escalada vieja: guiño → `ANGRY` "Cuidado." → blásters → sable jedi
(tap con sable lo guarda). Las zonas se calculan en `zonaDe` con la misma geometría del dibujo
(`baseR = min(w·0.115, h·0.22)`, ojos a `±1.58·baseR`).

## Ambiente y despertar

- **Motas**: 40 (`N_MOTAS`) sprites radiales pre-renderizados por color (`spriteMota`), deriva hacia arriba,
  velocidad y brillo según energía: casi quietas en `SLEEPING`/`TIRED`, vivas en `HAPPY`/`LAUGH`/`SING`.
  Se expanden/contraen con la respiración de la cara.
- **Halo**: un gradiente radial ancho que respira con `A.breath` y crece con la energía y la voz.
- **Anillo de voz**: elipse fina alrededor de la cara que se expande con `lipLevel` en `SPEAKING`/`SING`/`PRAY`/`canto`/`oracion`,
  con un eco rezagado.
- **Despertar (`wake`)**: al montar, párpados de 0 → 1 con rebote (`backOut`) en 1.5 s; sin parpadeos
  autónomos hasta terminar; boca y halo aparecen con el mismo fundido. Sirve para el paso splash → cara.

## Rendimiento

- Un solo `requestAnimationFrame`; se detiene con `document.hidden` y se reanuda al volver.
- `dpr` limitado a 2. `dt` limitado a 60 ms.
- Sin `shadowBlur` en bucles por partícula (motas: `drawImage` de sprite; chispas y ondas: trazos planos).
  El `shadowBlur` queda sólo en piezas únicas: ojos, cejas (`strokeNeon`), párpados serenos, boca y fun pack.
  Las cejas usan blur 8 en reposo y 14 sólo cuando expresan (`strength` ≥ 0.3).
- Boca: dos `Path2D` y dos gradientes por frame (labio + cavidad), sin pasadas extra.
- La atención de cámara no usa `ctx.filter`: aclara el tema con `mixHex` (dos mezclas por frame).
- Límites: 40 motas, 24 chispas, 5 ondas de toque.
- Los callbacks van por refs (`onFaceChangeRef`, `onSpeakRef`, `onGestoRef`…) para no re-crear el bucle.

## Dónde cambiar qué

- Tiempo o forma de una reacción táctil → `handlePointerDown` (respuesta inmediata por zona), `handleTap` (estado al soltar) y `handlePointerMove` (arrastre) en `FaceCanvas.tsx`; decaimientos de las envolventes táctiles al inicio del bucle.
- Forma de boca por cara (redonda, apretada, ancho, ladeo) → `metasDeCara` (`mouthRound/mouthPress/mouthWidth/mouthSkew`); dibujo → `drawCyberMouth`.
- Visemas (probabilidades, tiempos de sostén, asimetría) → `nuevoVisema` dentro del bucle.
- Cejas (arco, preocupación, tic) → `drawBrow`; `browWorry` en `metasDeCara` y expresiones.
  Convención de `drawBrow`: el ojo izquierdo (side = −1) está en x negativa, así que el extremo **lateral** (sien)
  es `side·R` y el **medial** (nariz) es `−side·R·…`. Enojo = medial abajo (V); tristeza / preocupación = medial
  arriba (/ \) y, con `browWorry`, más juntas. Verificar siempre en captura (ANGRY, SAD, CONCERNED).
- Atención a la persona (brillo, traslación, inclinación, velocidad de vuelta) → `V.atencion`/`V.camX` en el bucle y `drawScene`.
- Intensidad de una emoción → `switch (X.tipo)` dentro del bucle (`FaceCanvas.tsx`) y `EXPRESION_DUR`.
- Cara de fondo de una emoción → `CARA_POR_EMOCION` en `emocion.ts`.
- Aspecto del ojo / ceja / boca → `drawLivingEye`, `drawBrow`, `drawCyberMouth` en `dibujo.ts`.
- Cantidad o brillo de motas → `N_MOTAS`, `crearMotas`, `drawMotes`.
- Paleta por modo → `getThemeColors` en `dibujo.ts` (respetar `01-diseno/tokens.ts`).
- Nuevo `FaceState` → `src/types.ts` (unión), `getTargetsFor`, `metasDeCara`, `ENERGIA`, y si aplica `entrarCara`.
- Nueva emoción en `lib/emocion.ts` → `CARA_POR_EMOCION` (emocion.ts), `EXPRESION_DUR` y `GESTO_POR_EMOCION` (FaceCanvas.tsx; son `Record<Emocion,…>`, tsc avisa), un `case` en el `switch (X.tipo)` y un nombre en `gestos.ts`.
- Cierre de ojos sereno / mandíbula → `V.cierre`, `V.flutter`, `V.jaw` en `dibujo.ts` (`aperturaOjo`, párpado en arco dentro de `drawLivingEye`, `drawCyberMouth`), rampas en el bucle de `FaceCanvas.tsx`.

## QA visual

`scripts/qa/capturas.mjs` captura cada estado y las vistas táctiles (`TACTO-ojo/barbilla/mejilla/frente/centro`,
`YAYA-molesto/risa`, `MIRADA-persona`, `ARRASTRE`, `SPEAKING` (abierta) / `SPEAKING-cerrada` / `SPEAKING-media`) y arma `hoja.png`.
En el preview no hay backend de voz y el reproductor (`03-voz/player.ts`, `startLip`) deja un `setInterval` de
40 ms que nunca se limpia y manda `lip=0`; el script lo neutraliza sólo en QA (devuelve un id inerte, sin programar
nada) y sólo para ese callback (lo reconoce por `getByteTimeDomainData` en su código; cualquier otro intervalo de
40 ms de la app corre normal). El arreglo real (clearInterval en onended/onerror) es del área de voz; hecho eso,
quitar el parche.
Para no capturar a mitad de un parpadeo, cada estado se muestrea ~700 ms midiendo la apertura de ojos en el canvas
(píxeles cian en la banda de los ojos) y el screenshot espera a que vuelva al ≥ 92 % del máximo (`sinParpadeo`).
Las vistas de tacto se capturan al instante (la reacción es lo que se quiere ver), así que un guiño o doble
parpadeo propio del tap puede salir a medias.

## Cámara (visión real)

AU-RA ve a la persona con **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`, FaceLandmarker con
blendshapes y matriz facial) corriendo en el navegador. Lo orquesta `07-pantallas/VisionOverlay.tsx`
(abre la cámara frontal, `<video>` oculto en modo `stealth`) con `02-cara/vision/motor.ts`.

### Cómo funciona

```
getUserMedia (frontal 640×480) ─► <video> (window.__ultronVideo, lo usa 04-cerebro/grabFrame)
        │
        ▼  un solo requestAnimationFrame limitado a 18 fps (no bloquea la UI)
  MotorVision ─► FaceLandmarker.detectForVideo ─► Observacion ─► MaquinaEscena ─► Escena ─► onEscena
        │                (mediapipe)                                     │
        │                                                                └─► mirada suavizada ─► onGazeUpdate
        └─► si el modelo no está listo en 6 s ─► OpticalFaceTracker.paso (motor 'optico')
```

- El paquete JS entra por npm y se **importa dinámicamente** (chunk aparte, ~46 kB gzip); el **WASM** y el
  **modelo** `.task` no se empaquetan: se cargan por URL (CDN de jsDelivr y storage de MediaPipe).
- Delegado **GPU** si hay WebGL2, si falla se reintenta en **CPU** (XNNPACK). Objetivo: ≥ 12 fps en Chrome Android.
- Cuando MediaPipe está activo **no hay `getImageData` por cuadro**: el frame va directo al detector.
- Si el modelo no está listo en **6 s** (offline, CDN caído, WebGL roto) entra el tracker óptico y la escena
  sale con `motor: 'optico'`. Si el modelo termina de cargar después, el motor sube solo a `'mediapipe'`.
- El óptico **no inventa presencia**: `detected` exige energía real (`vision/optico.ts`): textura (desvío de
  luminancia ≥ 14) **y** movimiento sostenido (≥ 3 cuadros con ≥ 3 muestras cambiadas en los últimos 3 s).
  Una sala vacía, una pared, la cámara tapada o un póster dan `personas: 0` mientras carga el modelo (antes un
  gris uniforme bastaba para un `llego` falso). Contrapartida: alguien totalmente inmóvil > 3 s se pierde en
  el óptico (MediaPipe no tiene esa limitación).
- Al desactivar la cámara (`isActive → false` o el botón «Pausar») se cierra el landmarker (`close()`), se paran
  los tracks, se limpia `__ultronVideo` y se emite **una vez** `onEscena({ motor: 'ninguno', descripcion: 'La
  cámara está apagada.' })` (también en `window.__ultronEscena` con `?qa=1`), para que el cerebro no se quede
  con la última frase («Veo a una persona…») como hecho. El stream vive en un `streamRef` propio (no en `videoRef`, que React
  vacía al desmontar el `<video>`), y un contador de generación descarta el `getUserMedia` que resuelva tarde tras
  un apagado o un doble toggle: nunca quedan dos streams vivos.
- `mirando`/`cabeza` se calculan con el giro **relativo a la línea persona→cámara**: `observacionDesdeResultado`
  resta el ángulo esperado por la posición en el cuadro (`anguloEsperado(cx, cy, aspecto)`, HFOV 60°), así quien
  está a un lado de la tablet mirando la pantalla sale con `yaw ≈ 0` y `mirando: true`. El giro absoluto sale de
  **un solo estimador cerca del frontal** (`combinarAngulo`: geometría de landmarks hasta 5°, magnitud de la
  matriz facial a partir de 10°, mezcla lineal entre medio, así el signo del ruido no lo hace saltar ±10°), y la
  máquina lo **alisa** (EMA `UMBRALES.alisadoGiro` 0.35) antes de la histéresis.
- En consola: `[vision] motor mediapipe|optico` al elegir motor; con `?qa=1` además `[vision] escena …`,
  `[vision] estado … fps` y `window.__ultronEscena` con la última escena.

### Contrato (`src/02-cara/vision/escena.ts`)

```ts
type Escena = {
  personas: number;
  principal: null | {
    x: number; y: number;      // -1..1. x>0 = a SU derecha (ESPEJADO respecto al video frontal) = a la IZQUIERDA de AU-RA
    tam: number;               // alto de la cara / alto del cuadro (0..1)
    mirando: boolean;          // la cabeza apunta a la pantalla, descontada su posición en el cuadro (|yaw|<20°, |pitch|<15°, histéresis 28°/22°)
    sonrisa: number;           // (mouthSmileLeft+Right)/2
    sorpresa: number;          // browInnerUp·0.6 + eyeWide·0.3 + max(0, jawOpen−0.3)·0.4; sin cejas (browInnerUp ≤ 0.3) tope 0.45
    ojosCerrados: boolean;     // eyeBlink > 0.6 sostenido > 0.4 s
    bocaAbierta: number;       // jawOpen
    cabeza: 'centro'|'izquierda'|'derecha'|'arriba'|'abajo';
  };
  eventos: Array<'llego'|'se_fue'|'sonrie'|'deja_de_sonreir'|'saluda'|'dos_personas'|'mira'|'aparta_mirada'|'cerca'|'lejos'>;
  descripcion: string;         // «Veo a una persona cerca, a mi izquierda, sonriendo y mirando la pantalla.» (AU-RA en primera persona)
  motor: 'mediapipe'|'optico'|'ninguno';
  ts: number;
};
```

Props de `VisionOverlay`: `isActive`, `stealth` (true por defecto), `onClose`,
`onGazeUpdate({x,y,active})` (mirada suavizada hacia la cara principal, ya espejada; `active` solo con cara),
**`onEscena(e: Escena)`** (como máximo cada 500 ms, y de inmediato cuando `eventos.length > 0`),
`onPresenceEvent` (compatibilidad: `'wave'` cuando llega `saluda`). Si el usuario niega la cámara se emite
**una sola vez** `{ motor: 'ninguno', descripcion: 'La cámara está apagada.' }`.

Histéresis (`UMBRALES` en `escena.ts`): `llego` tras 0.6 s de cara continua; `se_fue` tras 2 s sin cara;
`sonrie` al cruzar 0.55 y `deja_de_sonreir` al bajar de 0.3; `cerca` si `tam > 0.45` (sale < 0.38);
`lejos` si `tam < 0.12` (sale > 0.16); `dos_personas` con `personas ≥ 2` estable 1 s (solo con alguien ya
confirmado) y **con salida**: la segunda cara debe faltar ≥ 1.5 s (`dosPersonasOffMs`) o emitirse `se_fue`
para poder re-anunciarse (una cara que parpadea en el borde no repite el evento); `saluda` solo lo estima el
tracker óptico (movimiento lateral alto repetido) con debounce de 4 s.
Antes del `llego` nadie cuenta (`personas: 0`, `principal: null`, aunque el detector vea dos caras) para no
reaccionar a falsos positivos de un cuadro. La histéresis también protege la salida: si el detector pierde la
cara uno o varios cuadros (< 2 s), `principal` sigue publicado con la última posición y gestos congelados, y
`onGazeUpdate.active` no parpadea; `principal` pasa a `null` solo al emitir `se_fue`. Si el motor sube de
óptico a MediaPipe con alguien presente (`MaquinaEscena.cambiarMotor()`), no se repite `llego` y la última cara
sigue publicada hasta el primer cuadro del motor nuevo (nunca `personas: 1` con `principal: null`).

`describirEscena` habla siempre desde AU-RA en primera persona («a mi izquierda» / «a mi derecha» /
«frente a mí»; nunca «a tu…», que le sugeriría al único presente una segunda persona) y coherente con el
espejo: `x > 0` (persona a SU derecha) es la izquierda de AU-RA. Nunca inventa edad, género ni identidad.
Con motor `'optico'` la frase es honesta («Creo que hay alguien frente a mí, pero el sensor básico no
distingue detalles.»).

`onGazeUpdate` se emite solo cuando la mirada cambia de verdad (x,y cuantizados a 0.01 o cambia `active`):
con la sala vacía no hay emisiones, así App no re-renderiza 18 veces por segundo.

### Cómo cambiar el modelo o las URLs

- Versión del paquete: `MEDIAPIPE_VERSION` en `vision/mediapipe.ts` **debe coincidir** con `package.json`
  (la URL del WASM en jsDelivr lleva esa versión). Por eso `package.json` la fija **exacta** (`"1.0.1"`, sin `^`)
  y un test (`tests/escena.test.ts`) comprueba constante = package.json = `node_modules`. Para subir de versión:
  cambiar los dos sitios y `npm install`.
- Modelo: `FACE_LANDMARKER_MODEL_URL_DEFAULT` (float16/1). Cualquier `face_landmarker.task` compatible sirve.
- Sin tocar código: `VITE_VISION_WASM_URL` y `VITE_VISION_MODEL_URL` en `.env` (copia autoalojada para el
  kiosko sin internet: copiar `node_modules/@mediapipe/tasks-vision/wasm/*` y el `.task` a `public/`), o en
  caliente `window.__ULTRON_VISION = { wasmUrl, modelUrl }` antes de activar la cámara. Las URLs efectivas se
  consultan con `urlWasm()` / `urlModelo()` (funciones, no constantes: se resuelven en cada arranque).
- Campo de visión asumido para el giro relativo: `HFOV_GRADOS` (60) en `vision/mediapipe.ts`.
- Timeout de carga: `MEDIAPIPE_TIMEOUT_MS` (6000). Caras máximas: `MAX_CARAS` (3).

### Pruebas

- Unitarias (sin DOM): `NODE_ENV=test npx tsx --test tests/escena.test.ts` (descripción 0/1/2 personas,
  espejado, histéresis de `llego`/`se_fue`, umbrales de sonrisa, cerca/lejos, dos personas con entrada y salida,
  mirada, ojos cerrados, giro relativo y `combinarAngulo`, alisado del giro, energía del óptico con cuadro gris
  uniforme / textura + movimiento / póster, versión de MediaPipe alineada).
- Navegador: Chromium con `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, abrir `/?qa=1`,
  clic en «Activar cámara» y esperar `[vision] motor mediapipe` y `window.__ultronEscena.personas === 0`
  (el stream falso no tiene cara).
