# Avatar 3D de AURA — especificación de entrega

Para quien modela y anima el avatar 3D de AURA (Codex). Todo lo que dice «exigido» lo comprueba una
máquina: `npx tsx scripts/avatar3d-modelo.mjs revisar assets/avatar3d/aura.glb` (desde `mobile/`)
tiene que terminar con **0 errores**. Los avisos se pueden dejar, pero cada uno baja la calidad.

La app ya está lista para recibirlo: el renderer 3D, el mapeo de estados, la voz → boca, los toques,
las cámaras y la caída al 2D existen y están probados con un modelo de prueba. Conectar el modelo es
copiarlo, correr el revisor y registrarlo (§11).

> **Estado (30-sep-2026): conectados los tres avatares de Codex** (AU-RA, Claudio y ANT-ONIO,
> `vendor/aura-avatar-suite`). No siguen esta especificación humanoide sino un rig de nodos con
> morph targets; la app los lee con el perfil «nodos» (§13). Esta especificación sigue valiendo para
> un modelo humanoide futuro.

---

## 0. Lista corta

| | Exigido |
|---|---|
| Archivo | `mobile/assets/avatar3d/aura.glb` — glTF 2.0 binario, todo adentro |
| Peso | ≤ 12 MB (recomendado ≤ 8 MB) |
| Triángulos | ≤ 70 000 (recomendado ≤ 50 000; la cabeza, 12–18 mil) |
| Texturas | ≤ 2048×2048, potencia de 2, WebP o JPEG (PNG solo con alfa) |
| Compresión | `EXT_meshopt_compression` + `KHR_mesh_quantization`. **Nada de Draco ni KTX2** |
| Escala | metros, pies en y = 0, mira hacia **+Z**, arriba +Y, 1,55–1,75 m de alto |
| Esqueleto | nombres de hueso VRM 1.0 (`hips`, `spine`, `chest`, `neck`, `head`, …), ≤ 120 huesos, ≤ 4 influencias por vértice |
| Blendshapes | los 52 de ARKit + 15 visemas `viseme_*`, nombres en `mesh.extras.targetNames` |
| Animaciones | `idle`, `caminar`, `pensar`, `saludar`, `senalar`, `toque_cabeza`, `toque_mejilla`, `toque_panza`, `enojo`, `gusto`, `entrar`, `salir` |
| Zonas tocables | nodos `zona_cabeza`, `zona_mejilla_izq`, `zona_mejilla_der`, `zona_panza` |
| Cámaras (recomendado) | nodos `camara_retrato`, `camara_cuerpo` |
| Fondo | ninguno: sin suelo, sin cielo, sin luces; la app lo dibuja sobre fondo transparente |

---

## 1. Con qué se dibuja (y por qué eso importa para el modelo)

**Motor: three.js (r186) dentro de una WebView** (`react-native-webview` 13.15, ya instalada), con
`GLTFLoader` y el decodificador meshopt empaquetados en la página (`src/12-avatar3d/escena.ts` →
`mobile/src/avatar3d/escenaHtml.ts`). La app es Expo SDK 54, React Native 0.81.5 con la arquitectura
nueva encendida (`newArchEnabled=true`, comprobado con `expo prebuild`).

Se compararon tres caminos:

| | react-native-filament (Margelo) | expo-gl + three / @react-three/fiber | **three.js en WebView** |
|---|---|---|---|
| glTF con blendshapes y esqueleto | sí (Filament gltfio) | sí (three) | **sí (three)** |
| Compatibilidad con esta app | exige `react-native-worklets-core` (≥ 1.3.2). La 1.6.3, la última, **ya tumbó esta APK** con la arquitectura nueva de RN 0.81: el proceso moría sin error de JS al montar la mesa (commit `0602318`, 20-sep). Además convive mal con el plugin de Babel de Reanimated 4 | expo-gl 16 existe para SDK 54 y r3f 9.8 pide React ≥ 19 < 19.4 y RN ≥ 0.78: encaja, pero **dibuja en el hilo de JS**, el mismo de la voz de ElevenLabs, el chat y los gestos. Hermes no tiene WebAssembly: meshopt/KTX2 no se decodifican; las texturas embebidas en un .glb necesitan parches (Blob/ImageBitmap) | **ya corre en esta APK**: la sala 3D (`SalaAura.tsx`, three.js 0.186) va así desde la 4.x. La WebView de Android es Chromium: WebGL 2 y WebAssembly en su propio proceso, sin tocar el hilo de JS |
| Nativo nuevo | sí (paquete de 343 MB desempacado, binarios de Filament + Bullet por ABI: varios MB más de APK) | sí (expo-gl) | **no** |
| Se actualiza por aire (EAS Update) | no: cambia la huella nativa, hace falta APK nueva | no: idem | **sí: la huella nativa no cambia** (`@expo/fingerprint`: `c9fcd3e…` antes y después) |
| Peso agregado | varios MB por ABI | ~1 MB nativo + three en el bundle | **673 KB de JS** (la página con three + GLTFLoader + meshopt) |
| Rendimiento | el mejor (Vulkan/GL en hilo propio) | el peor para esta app (hilo de JS) | bueno: GPU de Chromium en proceso aparte. La escena mide sus cuadros al arrancar, baja la resolución sola (2× → 1,5× → 1×) y si no pasa de 24 fps cae al 2D |

Consecuencias para el modelo:
- Geometría comprimida **solo con meshopt** (el decodificador va dentro de la página). Draco y KTX2
  no: sus decodificadores (≈ 300 KB y ≈ 700 KB) no van en la página.
- Materiales **PBR metallic-roughness** de glTF (three `MeshStandardMaterial`). Sin shaders propios
  (MToon, SSS): lo que haga falta, horneado en las texturas.
- Un teléfono Android de gama media (Adreno 610 / Mali-G57, tipo Galaxy A14–A25 o Redmi Note 12) tiene
  que dar **60 fps a pantalla completa**. Los límites de §3 están pensados para eso.

---

## 2. Formato

- **glTF 2.0 binario (`.glb`)**, un archivo por avatar, con todo adentro (buffers e imágenes; nada de
  `uri` externas). El revisor rechaza lo que no.
- **VRM 1.0: no como formato de entrega.** Un .vrm es un .glb con extensiones `VRMC_*`: la escena lo
  leería como glTF normal e ignoraría esas extensiones (expresiones VRM, MToon, spring bones), así que
  lo que importa son los nombres de §5–§6. Si se parte de un VRM, exportar a .glb con esos nombres y
  materiales PBR.
- Un solo juego de UV por malla. Sin cámaras (salvo §9), sin luces, sin nodos de ayuda sueltos.

## 3. Límites

| | Recomendado | Máximo (error) |
|---|---|---|
| Peso del .glb | 8 MB | 12 MB |
| Triángulos (todo) | 50 000 | 70 000 |
| Materiales | 3 (piel/cuerpo · ropa · pelo+ojos) | 6 (aviso) |
| Primitivas (llamadas de dibujo) | 8 | 12 (aviso) |
| Huesos | 90 | 120 |
| Influencias por vértice | 4 | 4 |
| Textura de color | 2048² (atlas) | 2048² |
| Normal, ORM | 1024² | 2048² |

- **Texturas**: color en WebP (`EXT_texture_webp`) o JPEG; PNG solo si tiene alfa. Metal, rugosidad y
  oclusión juntas en una ORM. Potencias de 2. Nada de KTX2/Basis (`KHR_texture_basisu`).
- **Compresión**: `gltfpack -cc -tw` (meshopt + cuantización + WebP) o gltf-transform (`meshopt`,
  `webp`). Extensiones permitidas: `EXT_meshopt_compression`, `KHR_mesh_quantization`,
  `EXT_texture_webp`, `KHR_texture_transform`, `KHR_materials_emissive_strength`, `KHR_materials_unlit`.
  Prohibidas: `KHR_draco_mesh_compression`, `KHR_texture_basisu`, `KHR_materials_transmission`,
  `KHR_materials_volume`, `KHR_materials_sheen`, `KHR_materials_iridescence`.
- **Pelo**: tarjetas con `alphaMode: MASK` (no `BLEND`: el orden de dibujo en un teléfono falla y cuesta).
  `BLEND` solo para la córnea, si hace falta.
- **Blendshapes solo en la cabeza** (y en dientes, lengua y pestañas, con los mismos nombres): el
  cuerpo no lleva ninguno. Cada blendshape en cada malla es memoria de GPU.

## 4. Escala, orientación y pose

- Unidades: **metros**. Altura total 1,55–1,75 m; el revisor exige la cabeza entre 1,2 y 2,1 m del suelo.
- **Pies en y = 0**, centrado en x = 0, z = 0.
- **Mira hacia +Z** (convención de glTF): su brazo izquierdo queda en +X. El revisor lo comprueba.
- Pose de reposo en **A** (brazos a ~45°). Sin escalas no uniformes en los huesos.
- Nada de desplazamiento de raíz en las animaciones (§7): la app mueve el cuerpo.

## 5. Esqueleto (nombres de hueso VRM 1.0)

Nombres de nodo **exactos** (se aceptan mayúsculas distintas y `mixamorig:`, pero mejor exactos):

- **Exigidos**: `hips`, `spine`, `chest`, `neck`, `head`, `leftUpperArm`, `leftLowerArm`, `leftHand`,
  `rightUpperArm`, `rightLowerArm`, `rightHand`, `leftUpperLeg`, `leftLowerLeg`, `leftFoot`,
  `rightUpperLeg`, `rightLowerLeg`, `rightFoot`.
- **Recomendados** (aviso si faltan): `upperChest`, `leftShoulder`, `rightShoulder`, `leftEye`,
  `rightEye`, `jaw`, `leftToes`, `rightToes`.
- **Dedos** (opcionales, con nombres VRM: `leftThumbMetacarpal`, `leftIndexProximal`, …): cuentan en el
  tope de huesos.

Qué mueve la app por su cuenta, encima de la animación: `head` y `neck` (adónde mira: el dedo, la
persona), `leftEye`/`rightEye` (los ojos llegan más lejos que la cabeza), `chest`/`upperChest` (respira
si no hay `idle`) y `jaw` (la boca, solo si el modelo no trae blendshapes de boca). Por eso esos
huesos tienen que existir, con el eje de rotación natural y sin restricciones raras.

Si un modelo trae otros nombres, se corrigen sin tocarlo con `aura.mapeo.json` (§11): `"humanoide":
{"hips": "Pelvis", …}` para el revisor y `"huesos": {"cabeza": ["Head"], …}` para la escena.

## 6. Blendshapes (la cara)

Nombres en **`mesh.extras.targetNames`** (lo que exportan Blender y los demás; three.js los lee de ahí).
Rango 0..1. Cada uno tiene que verse bien **solo y combinado** con los de su expresión (tabla abajo).

### 6.1 ARKit: los 52, exigidos

`eyeBlinkLeft` `eyeLookDownLeft` `eyeLookInLeft` `eyeLookOutLeft` `eyeLookUpLeft` `eyeSquintLeft`
`eyeWideLeft` `eyeBlinkRight` `eyeLookDownRight` `eyeLookInRight` `eyeLookOutRight` `eyeLookUpRight`
`eyeSquintRight` `eyeWideRight` `jawForward` `jawLeft` `jawRight` `jawOpen` `mouthClose`
`mouthFunnel` `mouthPucker` `mouthLeft` `mouthRight` `mouthSmileLeft` `mouthSmileRight`
`mouthFrownLeft` `mouthFrownRight` `mouthDimpleLeft` `mouthDimpleRight` `mouthStretchLeft`
`mouthStretchRight` `mouthRollLower` `mouthRollUpper` `mouthShrugLower` `mouthShrugUpper`
`mouthPressLeft` `mouthPressRight` `mouthLowerDownLeft` `mouthLowerDownRight` `mouthUpperUpLeft`
`mouthUpperUpRight` `browDownLeft` `browDownRight` `browInnerUp` `browOuterUpLeft`
`browOuterUpRight` `cheekPuff` `cheekSquintLeft` `cheekSquintRight` `noseSneerLeft`
`noseSneerRight` `tongueOut`

### 6.2 Visemas: los 15, exigidos

`viseme_sil` `viseme_PP` `viseme_FF` `viseme_TH` `viseme_DD` `viseme_kk` `viseme_CH` `viseme_SS`
`viseme_nn` `viseme_RR` `viseme_aa` `viseme_E` `viseme_I` `viseme_O` `viseme_U` (estándar de Oculus).

Cómo los usa la app (en español; Honduras sesea, así que la «c» y la «z» son `SS`):

| Visema | Suena en | Visema | Suena en |
|---|---|---|---|
| `PP` | **m**amá, **b**eso, **v**aso, **p**apá | `nn` | **n**o, **l**una, **ñ**o |
| `FF` | **f**e | `RR` | pe**r**o, **r**osa |
| `TH` | (inglés «th»; casi no se usa) | `aa` | c**a**s**a** |
| `DD` | **t**ú, **d**e | `E` | m**e**s**e** |
| `kk` | **c**asa, **qu**eso, **g**ato, **j**ugo | `I` | s**í**, ho**y** |
| `CH` | **ch**ico, **ll**ave, **y**o | `O` | **o**jo |
| `SS` | **s**í, **c**ena, **z**apato | `U` | **u**va |

**De dónde sale la boca** (revisado en el SDK que usa la app, `@elevenlabs/react-native` 1.2.28 sobre
`@elevenlabs/client` 1.26): la conversación de ElevenLabs le da al teléfono el **volumen** de la voz de
AURA (`getOutputVolume`) y su **espectro** en bandas de 100 a 8000 Hz (`getOutputByteFrequencyData`,
calculado en nativo por LiveKit). La **alineación por letra** (`onAudioAlignment`: letras con su
tiempo) solo llega cuando el audio viaja en eventos; en React Native la conexión es WebRTC y el audio va
por la pista de LiveKit, así que normalmente no llega. La app usa, de mejor a peor: alineación (la letra
exacta) → espectro (distingue fricativas, vocales cerradas y abiertas) → volumen (solo cuánto abre).
Todo en `mobile/src/avatar3d/visemas.ts` y `senalVoz.ts`.

Consecuencia para el modelo: **los visemas casi nunca llegan a 1**. Trabajan entre 0,3 y 0,8, mezclados
entre sí y con una `aa` de relleno cuando la forma es dudosa. Tienen que verse naturales a medio camino
y sin «saltos» al mezclarse. `viseme_sil` es la boca cerrada relajada (no apretada).

### 6.3 Opcional

`rubor`: tiñe las mejillas (la cara tímida). Si no está, se nota igual, un poco menos.

### 6.4 Expresiones: qué pesos usa la app

Mientras habla, lo marcado con * baja al 60 % para no pelear con los visemas.

| Expresión (cuándo) | Pesos |
|---|---|
| `tranquila` (reposo) | ninguno |
| `contenta` (feliz, le gusta el toque) | mouthSmile* 0,6 · cheekSquint 0,3 · eyeSquint 0,18 |
| `encantada` (le acarician, se ríe) | mouthSmile* 0,9 · jawOpen* 0,12 · cheekSquint 0,5 · eyeSquint 0,45 · browInnerUp 0,15 |
| `enojada` (muchos toques seguidos) | browDown 0,9 · mouthFrown* 0,5 · noseSneer 0,35 · eyeSquint 0,3 · mouthPress* 0,3 |
| `dormida` (silenciada: doble toque o «cállate») | eyeBlink 1 · jawOpen* 0,04 · mouthSmile* 0,1 |
| `escucha` (conversación abierta) | browInnerUp 0,25 · eyeWide 0,12 · mouthSmile* 0,15 |
| `piensa` (esperando al cerebro) | browInnerUp 0,2 · browDownLeft 0,25 · eyeLookUp 0,45 · eyeLookOutLeft 0,3 · eyeLookInRight 0,3 · mouthPucker* 0,2 · mouthLeft 0,2 |
| `sorprendida` (la despiertan, sorpresa) | browInnerUp 0,8 · browOuterUp 0,8 · eyeWide 0,7 · jawOpen* 0,3 · mouthFunnel* 0,2 |
| `triste` (no pudo hacer algo) | browInnerUp 0,7 · mouthFrown* 0,6 · eyeLookDown 0,2 · mouthPress* 0,15 |
| `uy` (le hablaron encima) | eyeSquint 0,8 · eyeBlink 0,5 · mouthStretch* 0,4 · browDown 0,3 · jawOpen* 0,1 |
| `levantada` (la levantan con el dedo) | eyeWide 0,5 · jawOpen* 0,22 · browOuterUp 0,4 · mouthSmile* 0,3 |
| `timida` (le tocan la mejilla) | mouthSmile* 0,45 · eyeLookDown 0,4 · cheekSquint 0,3 · browInnerUp 0,25 · rubor 1 |

(«mouthSmile 0,6» = `mouthSmileLeft` y `mouthSmileRight` a 0,6.) «Hablando» no es una cara: es la cara
del momento + los visemas + la animación `hablar` si existe. El parpadeo lo pone la app (cada 2,5–6 s,
140 ms, con `eyeBlinkLeft/Right`).

## 7. Animaciones

Nombres **exactos**, en minúsculas y sin tildes. Solo pistas de **huesos** (nada de pistas de
blendshapes: la cara la manda la app). 30 cuadros por segundo. **En el sitio**: sin desplazar la raíz
(`hips` puede subir y bajar, no avanzar). Los gestos de una vez empiezan y terminan en la pose de
`idle` (la app funde 0,2–0,35 s), duran 0,8–2,5 s; los bucles cierran sin salto. Ninguna dura más de 12 s.

| Nombre | Tipo | Qué hace |
|---|---|---|
| `idle` | bucle 4–8 s | reposo vivo: respira, se balancea apenas, cambia el peso de pie |
| `caminar` | bucle ~1,1 s | paso ligero en el sitio (la app la desplaza por el borde de la pantalla) |
| `pensar` | bucle | mano al mentón o mirada arriba, pensativa |
| `saludar` | una vez | saluda con la mano (al conectar la conversación) |
| `senalar` | una vez | señala hacia abajo y a su izquierda (a la caja de escribir: «te lo dejé escrito») |
| `toque_cabeza` | una vez | le dan palmaditas: se encoge un poco, contenta |
| `toque_mejilla` | una vez | tímida: hombros arriba, se lleva una mano a la cara, mira de lado |
| `toque_panza` | una vez | cosquillas: se dobla riendo |
| `enojo` | una vez | enojada: brazos en jarra o sacude la cabeza, un pisotón |
| `gusto` | una vez | le encanta: saltito, manos juntas o pulgar arriba |
| `entrar` | una vez | aparece (vuelve de una llamada): llega con un saltito |
| `salir` | una vez | se va (empieza una llamada): se despide y se agacha/desvanece |
| `escuchar` | bucle, opcional | atenta: se inclina un poco hacia adelante |
| `hablar` | bucle, opcional | gestos suaves de manos mientras habla (sin boca) |
| `dormir` | bucle, opcional | dormida de pie, cabeza caída, respiración lenta |
| `despertar` | una vez, opcional | se despereza |
| `levantada` | bucle, opcional | colgando del dedo: piernas sueltas |

Qué toca cuándo (la app lo decide, `mobile/src/avatar3d/mapeo.ts`): de fondo, `levantada` > `dormir` >
`caminar` > `hablar` > `pensar` > `escuchar` > `idle`; si falta una, cae a la siguiente de su cadena
(`hablar` → `escuchar` → `idle`). Los gestos de una vez salen de lo que le pasa: tocarla (según la
zona), molestarla (`enojo`), acariciarla o enviar un mensaje (`gusto`), conectar (`saludar`), redactar
un borrador (`senalar`), una llamada (`salir` / `entrar`), despertarla (`despertar`).

## 8. Zonas tocables

Nodos malla **no deformados** (no skinned), hijos del hueso que les toca, de ≤ 200 triángulos cada uno,
que cubran la zona con holgura (un dedo mide ~1 cm). La app los esconde y hace raycast contra ellos.

| Nodo | Hijo de | Qué pasa al tocarlo |
|---|---|---|
| `zona_cabeza` (exigido) | `head` | contenta, `toque_cabeza` |
| `zona_mejilla_izq`, `zona_mejilla_der` (exigidos) | `head` | tímida, `toque_mejilla` |
| `zona_panza` (exigido) | `spine` o `chest` | risa, `toque_panza` |
| `zona_mano_izq`, `zona_mano_der` (opcionales) | `leftHand`, `rightHand` | un toque cualquiera |

Los nombres pueden llevar sufijo (`zona_panza.001`): cuenta el prefijo. Además de la zona, la app
distingue el gesto: un toque, doble toque (silenciarla / despertarla), muchos seguidos (se enoja),
caricia (le encanta).

## 9. Cámaras (recomendado)

Dos nodos: `camara_retrato` (cara y hombros, a la altura de los ojos, ~0,9 m, para el panel al lado de
los chats y la pantalla completa) y `camara_cuerpo` (cuerpo entero con ~5 % de margen, para la
compañera que camina y el panel acostado). Mejor como cámara perspectiva de glTF (con su `yfov`, ~28°);
también sirve un vacío. Miran por su −Z local hacia el modelo. Sin ellos, la app encuadra sola con el
hueso `head` y la caja del cuerpo.

## 10. El look: «como Muse de Meta, pero mejor»

- Estilizada-realista, cálida y cercana: AURA es la compañera personal («los ojos dorados, cálida y
  cercana»). Acento dorado **#D6B56C**; que se reconozca como la AU-RA de la app.
- Ojos muy expresivos (son la mitad de la personalidad): iris con profundidad, brillo horneado, párpados
  que cierran de verdad con `eyeBlink`.
- Se dibuja sobre **fondo transparente**, encima de la app en tema oscuro (#1C1D20) y claro (#F7F3EC):
  tiene que verse bien en los dos. Sin suelo ni sombra en el modelo (si acaso, oclusión horneada).
- Luz de la escena: hemisférica cálida, una principal arriba-derecha y un contraluz dorado; entorno
  neutro. Nada de emisivos fuertes.
- Tamaños en pantalla: ~104 px (la compañera que camina), 96–132 px de alto (la franja al lado del
  chat), hasta media pantalla (pantalla completa). Que la silueta y la cara se lean a 104 px.

## 11. Entrega y cómo se conecta

1. Archivos en el repo:
   - `mobile/assets/avatar3d/aura.glb` (exigido). `ojos.glb` y `claudio.glb` si hay para los otros
     avatares: mismas reglas.
   - `mobile/assets/avatar3d/aura.mapeo.json` **solo** si algún nombre no es el de esta especificación
     (forma de `MapeoParcial` en `mobile/src/avatar3d/mapeo.ts`, más `humanoide` para el revisor). Por
     ejemplo: `{"animaciones": {"gestos": {"saludar": ["Wave"]}}, "humanoide": {"hips": "Pelvis"}}`.
   - En la descripción del PR: autoría y licencia del modelo, herramientas y una captura.
2. Revisar (desde `mobile/`): `npx tsx scripts/avatar3d-modelo.mjs revisar assets/avatar3d/aura.glb` → **0 errores**.
3. Registrar: `npx tsx scripts/avatar3d-modelo.mjs registrar` (reescribe `src/avatar3d/modelo.ts` con el
   `require` del modelo, su huella y su mapeo). Sin este paso la app sigue en 2D.
4. Probarlo de verdad en un Chromium sin pantalla (el motor de la WebView):
   `node pruebas/avatar3d/navegador.mjs` → «todo bien» (arranca, carga, cara y boca, gesto, zona, cuadros).
   `AVATAR3D_FOTO=/tmp/aura.png node pruebas/avatar3d/navegador.mjs` guarda cómo se ve.
5. Lo de siempre: `npx tsc --noEmit` y `npx tsx src/avatar3d/pruebas/avatar3d.prueba.mjs` en verde.
6. En el teléfono: sale por aire (EAS Update), sin APK nueva. Si el teléfono no aguanta (sin WebGL, no
   carga en 15 s, se cae la WebView o menos de 24 fps a 1×), cae solo a la figurita 2D y no lo vuelve a
   intentar con ese modelo en dos semanas.

## 12. Criterios de aceptación

- [ ] `revisar` sin errores (formato, peso, triángulos, texturas, extensiones, esqueleto, escala, frente,
      52 ARKit + 15 visemas con nombre, 12 animaciones exigidas, 4 zonas).
- [ ] `registrar` hecho y `src/avatar3d/pruebas/avatar3d.prueba.mjs` en verde.
- [ ] `pruebas/avatar3d/navegador.mjs` en verde, sin errores en la página.
- [ ] Se ve bien sobre fondo oscuro y claro, en la compañera (104 px), la franja y la pantalla completa.
- [ ] Hablando con AURA, la boca acompaña la voz sin temblar ni quedarse abierta; en silencio, ojos
      cerrados y boca quieta.
- [ ] Tocar cabeza, mejilla y panza da tres reacciones distintas.
- [ ] 60 fps a pantalla completa en un Android de gama media (la app lo mide: el diagnóstico de campo
      dice «avatar 3D: vuelve a 2D (…)» si no).

## 13. Los avatares de Codex (perfil «nodos»)

La entrega de Codex (`vendor/aura-avatar-suite`, no se edita desde la app: se consume) trae AU-RA
(Grafito · Orbe), Claudio (zorro) y ANT-ONIO (hormiga, aprobado por Medardo). Cada GLB tiene 30 clips
(19 emociones, escuchar, dormir y 9 gestos), una jerarquía de nodos articulados y seis morph targets de
boca (`open`, `laugh`, `round`, `wide`, `frown`, `closed`). Sin esqueleto con piel, sin ARKit.

**Decisión: una sola escena, la de la app.** El controlador de Codex (`src/avatar.js`, `stage.js`)
no se usa en el teléfono: arma el personaje en JavaScript (Claudio, 353 mil triángulos con pelo, en
cada arranque) y su `animate()` trabaja sobre los objetos que él mismo creó, así que no se puede
aplicar a un GLB optimizado; su adaptador (`integration/AvatarWebView.tsx`) traía una página de
684 KB por avatar con su propia copia de three.js. Lo que su controlador sabe hacer quedó horneado en
los 30 clips, y eso es lo que la escena de la app (`src/12-avatar3d/escena.ts`, three 0.186.1, una
sola copia, la misma versión que la de Codex) reproduce. Lo que un clip no hace en vivo lo pone la
escena, traducido en `mobile/src/avatar3d/mapeo.ts` (`PERFIL_NODOS`):

| AURA | Codex |
|---|---|
| expresión (tranquila, contenta, encantada, enojada, dormida, escucha, piensa, sorprendida, triste, uy, levantada, tímida) | clip neutral, feliz, risa, molesto, dormido, escuchando, pensando, sorpresa, triste, preocupado, alarma, cariño |
| fondo (reposo, habla, escucha, piensa, duerme, camina) | neutral, neutral, escuchando, pensando, dormido, caminar |
| toque cabeza / mejilla / panza, enojo, gusto, saludo, entrar/salir | asentir / corazón / celebrar, negar, celebrar, saludar, saludar |
| visemas (15) | O/U → `round`, E/I/S → `wide`, P/B/M → `closed`, lo demás `open` (como su controlador) |
| mirada | `head` + `gaze_1` (ojo izquierdo) / `gaze_-1`; AU-RA tiene un solo `gaze` |

- Cada clip se parte al cargar en **cara** (lo que cuelga de `head` y los morph targets) y **cuerpo**:
  un gesto mueve el cuerpo y la cara de la emoción sigue (Claudio tímido se lleva la mano al pecho
  con cara de cariño).
- La voz va **encima** de la boca del clip: la suelta hasta un 80 % mientras habla y la suma de las
  formas no pasa de 1 (lo mismo que hacía su controlador).
- Toques sin colisionadores: la zona sale de la caja de la cabeza (su geometría), no de un radio fijo.
- Retrato: cabeza entera y hombros; si la cabeza es casi todo el cuerpo (AU-RA) se ve entera. En un
  recuadro chico (< 200 px: la franja del modo «lado», ~116 px) el retrato es solo la cabeza, que
  llena el cuadro: la cara se lee a ese tamaño.
- Mirada viva: sin nadie a quien mirar, los ojos se pasean solos (saltitos cortos cada 1,2–3,5 s);
  el parpadeo y la respiración vienen horneados en los clips de Codex.

**El estudio** (30-sep, «avatares HD»): la luz de la demo de Codex (`vendor/aura-avatar-suite/src/stage.js`),
que es la referencia de cómo se ven: ACES a 1,05, entorno `RoomEnvironment` por PMREM, cielo frío y
suelo cálido, principal arriba a la izquierda, contraluz cálido (contorno de orejas, pelo y antenas) y
relleno frío (el reflejo azulado del visor de AU-RA). Más una sombra de contacto bajo los pies (Claudio
y ANT-ONIO; AU-RA flota) y, en `alta`, un halo suave aditivo en las piezas chicas que emiten luz (los
ojos y cejas doradas de AU-RA). Sin sombras propias: con un mapa de sombras de teléfono salían manchas
en la esclerótica y las mejillas.

**Calidad automática** (`capacidad.ts`, `almacen.ts`): la escena mide sus cuadros y baja sola de
`alta` (hasta 2×, materiales de Codex) a `media` (1,5×, sin barniz ni brillo especular) y a `baja`
(1×, materiales estándar sin relieve ni reflejos); si ni así pasa de 24 fps, cae al 2D. El nivel que
aguantó se recuerda por modelo (huella) dos semanas. Si ni en `baja` da los cuadros con la variante
alta, se prueba la **ligera** (otra huella; `capacidad.ts`, `varianteQueToca`) antes de caer al 2D.

**Dónde se ve.** AU-RA conserva su **sala** en la mesa (silla, escritorio, tareas con objetos: la sala
es la mesa y no se reemplaza; no se muestra ninguna opción «sentada» del cuerpo nuevo). Su cuerpo 3D
nuevo va en la compañera que pasea, al lado de los chats y a pantalla completa. Claudio y ANT-ONIO
usan su 3D también en la mesa (`CuerpoMesa.tsx`), con sus fotos de respaldo (las de ANT-ONIO se
renderizan desde su modelo: `scripts/avatar3d-fotos.mjs`).

**Un solo comando** (desde la raíz; lo corre también cuando el relevo deje los finales en
`vendor/aura-avatar-suite/assets/movil/{aura,claudio,antonio}.glb`):

    npm run avatar3d

Empaqueta la escena, toma de la entrega el GLB final si existe (si no, uno provisional desde los
originales) y saca DOS variantes por avatar (`mapeo.ts`, `VARIANTES_NODOS`):

- **alta** (`<avatar>.glb`), sin pérdida visible frente al original: morphs con nombre, dedup y prune,
  **sin remuestrear las animaciones** (el `resample` de antes movía cabeza y torso unas décimas de grado
  en cada pose: solo eso corría la cara varios píxeles), **con** `KHR_materials_sheen` (el brillo de
  pelo y tela del original), la cabeza entera sin simplificar (cara, ojos, párpados, boca, labios,
  cejas, lentes, orejas, pelaje, antenas), el cuerpo con error acotado en unidades del modelo (≤ 0,001:
  menos de un píxel aun en el retrato), la punta de cada cinta del pelaje (dos vértices a 0,00003) en
  un vértice (3 triángulos en vez de 4, misma silueta), texturas WebP 92–95 en su tamaño (512) y
  meshopt con posición a 16 bits y normales a 12. Objetivo 150 mil triángulos, tope 240 mil (Claudio
  se pasa: solo su pelaje son ~96 mil y aligerarlo más se nota);
- **ligera** (`<avatar>-ligero.glb`), para el teléfono que no aguanta la alta: cuerpo, cráneo, orejas y
  pelo más simplificados (la mitad de los pelos, el doble de anchos), pero ojos, cejas, boca, labios,
  nariz y lentes como el original. ≤ 3 MB y ≤ 110 mil triángulos. Solo si la alta pasa de 70 mil
  (AU-RA no la necesita).

Un Draco de entrada se convierte a meshopt (la escena solo lleva ese decodificador, empaquetado, sin
CDN). Revisa las dos con el perfil «nodos» (peso, triángulos, clips y formas de boca que pide el
mapeo), reescribe `src/avatar3d/modelo.ts` y rehace las fotos 2D de ANT-ONIO. Después: `cd mobile && npx tsx
src/avatar3d/pruebas/avatar3d.prueba.mjs` y `node pruebas/avatar3d/navegador.mjs assets/avatar3d/<avatar>.glb`.

Medido el 30-sep («avatares HD»), recorte de la cara frente al original de Codex en la misma escena y
la misma luz (SSIM, 10 emociones, 390×844): antes claudio 0,869 / antonio 0,926 / aura 0,999; ahora
claudio 0,995 / antonio 0,998 / aura 1,000 (ver el informe de la rama). Alta: aura 0,42 MB / 56 800
triángulos, claudio 3,95 MB / 224 340, antonio 2,94 MB / 135 540; ligera: claudio 2,53 MB / 103 126,
antonio 2,11 MB / 74 156. La APK/OTA pasa de 4,35 MB de GLB (2,30 comprimidos) a 12,53 MB (7,27
comprimidos; 4,86 MB son las ligeras). La huella nativa no cambia: se publica por aire.
