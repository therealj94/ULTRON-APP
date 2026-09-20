# 02 — Cara

La cara viva de ULTRON FP: dos ojos cian OLED, boca ciber, halo que respira, motas
y anillo de voz. Canvas 2D a 60 fps, pensada para tablet/teléfono en la mesa de la junta.
Paleta: negro + cian `#05E1FF` (tokens en `src/01-diseno/tokens.ts`).

## Archivos

| Archivo | Qué hay | Tócalo cuando… |
| --- | --- | --- |
| `FaceCanvas.tsx` | Componente React: bucle rAF, motor de animación (parpadeo, sacadas, mirada, respiración), capa de expresión por emoción, mapa táctil, composición de la escena. | cambies un comportamiento (tiempos, metas por cara, gestos táctiles, qué se dibuja y en qué orden). |
| `dibujo.ts` | Tema por modo, ojo vivo, ceja, boca paramétrica, halo, motas (sprite pre-renderizado), chispas, anillo de voz, ondas de toque, tipo `Vida`. | cambies el **aspecto**: forma del ojo, de la boca, colores, partículas. |
| `funPack.ts` | Pack de juguete: visor rojo, coronas y glifos de modo, sable jedi, blásters + láseres, vaso holográfico, mano que saluda, visor de cámara/flash. | toques algo que sólo aparece con `funMode`. |
| `emocion.ts` | `caraDeEmocion(e)` (emoción del cerebro → `FaceState`) y `caraDeTexto(texto)` (heurística por lo que dijo el jefe). | cambies qué cara de fondo corresponde a cada emoción. |
| `gestos.ts` | Lista `GESTOS` / tipo `Gesto` que la cara reporta por `onGesto`. | agregues un gesto nuevo. |
| `faceTracker.ts` | Seguimiento óptico de cara para `cameraGaze` (lo usa `07-pantallas/VisionOverlay`). | — |

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
| `cameraGaze?` | `{x,y,active}` | Mirada hacia la persona detectada por cámara. Manda sobre las sacadas. |
| `isDrinking?` / `isWaving?` | `boolean` | Vaso y mano. Se respetan aunque `funMode` sea false. |
| `isCameraFlashing?` | `boolean` | Visor de cámara + flash + `onSnapshotReady(dataUrl)`. |
| `isCombatBlasterActive?` | `boolean` | Sólo con `funMode`; sin él se responde `onBlasterCombatEnd()` de inmediato. |
| `resetTrigger?` | `number` | Cualquier incremento desarma todo y vuelve a `IDLE`. |
| `lipLevel?` | `number` 0–1 | Nivel de labios (voz). En `SPEAKING`/`SING`/`PRAY` (y expresiones `canto`/`oracion`) la boca lo sigue con ataque rápido (rate 18 subiendo, 11 bajando) y una "mandíbula" (`V.jaw`: más alto + empuje hacia abajo 0.14·R) para que se lea de lejos; mueve también el anillo de voz. Si la señal se queda en 0 más de 1.5 s, entra un visema sintético. |
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
| `SURPRISED` | Dilatación casi instantánea, cejas muy altas, ojos más abiertos que 1 (1.12), congelado 0.35 s sin parpadear, luego asienta. |
| `SAD` | Cejas con interior arriba, párpados al 62 %, mirada abajo, respiración lenta, mueca leve. |
| `TIRED` | Párpados al 55 %, parpadeos lentos con alguno largo, deriva hacia abajo, un bostezo al entrar. |
| `SING` | Como HAPPY con ojos abiertos; boca sigue `lipLevel` con ganancia 1.0, balanceo suave, chispas suben desde la boca, anillo de voz. |
| `PRAY` | Ora en voz alta: párpados se cierran en ~0.8 s (rampa `cierre`, sin Z ni caída de sueño), micro-aleteo cada 3–7 s, cabeza quieta (sin vaivén ni sacadas), respiración ×0.45, sonrisa mínima, cejas relajadas con interior arriba, boca sigue `lipLevel` (ganancia 0.7) + anillo de voz, halo cálido y estable, motas lentas. Sin parpadeos programados. Al salir los ojos abren en ~0.6 s. |
| `THINKING` | Mirada arriba-izquierda, una ceja más alta, pulso "hmm" cada 2.6–4.8 s (ceja + brinco leve + dilatación). |
| `LISTENING` | Mirada se centra tras 1.2 s sin interacción, pupila un poco más dilatada con pulso lento. |

Metas por cara (`dilate/brow/mouth/smile/bounce`) en `getTargetsFor`; metas de la capa viva (párpados,
cejas en paralelo/asimetría, inclinación, mirada, ritmo de respiración/parpadeo) en `metasDeCara`.

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

| Gesto | Reacción | `onGesto` |
| --- | --- | --- |
| Tap en un ojo | Guiño de ese ojo (`WINK` 1.6 s) | `tapOjo`, `wink` |
| Tap en la frente (arriba de los ojos) | `CURIOSITY` 1.8 s con cejas arriba | `tapFrente`, `curioso` |
| Tap en barbilla / boca | Cosquillas: `LAUGH` 2.2 s | `tapBarbilla`, `risa` |
| Tap en mejilla u otro sitio | Guiño/doble parpadeo suave + media sonrisa | `tapMejilla` |
| 3+ taps en 1.4 s | "Ya, ya": `ANGRY` 1.2 s → `LAUGH` 1.8 s; `onSpeak('Ya, ya. Je.')` una vez por ráfaga | `molestoJuego`, `risa` |
| Frotar mitad inferior (trazo) | `PURR` 3.4 s | `frotarMejilla` |
| Arrastrar | Los ojos siguen el dedo; al soltar, micro-sacadas hacia el último punto y vuelta lenta al centro (~7 s) | `arrastre` |
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
  El `shadowBlur` queda sólo en ojos, boca y piezas del fun pack.
- Límites: 40 motas, 24 chispas, 5 ondas de toque.
- Los callbacks van por refs (`onFaceChangeRef`, `onSpeakRef`, `onGestoRef`…) para no re-crear el bucle.

## Dónde cambiar qué

- Tiempo o forma de una reacción táctil → `handleTap` / `handlePointerMove` en `FaceCanvas.tsx`.
- Intensidad de una emoción → `switch (X.tipo)` dentro del bucle (`FaceCanvas.tsx`) y `EXPRESION_DUR`.
- Cara de fondo de una emoción → `CARA_POR_EMOCION` en `emocion.ts`.
- Aspecto del ojo / ceja / boca → `drawLivingEye`, `drawBrow`, `drawCyberMouth` en `dibujo.ts`.
- Cantidad o brillo de motas → `N_MOTAS`, `crearMotas`, `drawMotes`.
- Paleta por modo → `getThemeColors` en `dibujo.ts` (respetar `01-diseno/tokens.ts`).
- Nuevo `FaceState` → `src/types.ts` (unión), `getTargetsFor`, `metasDeCara`, `ENERGIA`, y si aplica `entrarCara`.
- Nueva emoción en `lib/emocion.ts` → `CARA_POR_EMOCION` (emocion.ts), `EXPRESION_DUR` y `GESTO_POR_EMOCION` (FaceCanvas.tsx; son `Record<Emocion,…>`, tsc avisa), un `case` en el `switch (X.tipo)` y un nombre en `gestos.ts`.
- Cierre de ojos sereno / mandíbula → `V.cierre`, `V.flutter`, `V.jaw` en `dibujo.ts` (`aperturaOjo`, `drawCyberMouth`), rampas en el bucle de `FaceCanvas.tsx`.
