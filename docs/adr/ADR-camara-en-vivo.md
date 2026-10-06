# ADR — Cámara en vivo: CameraX + ML Kit, respaldo Expo y MediaPipe web

- **Estado:** aceptada (6-oct-2026), revisable con la evidencia de «Qué la cambiaría».
- **Contexto:** master §25 (cámara, reconocimiento y avatar). Corte revisado: `5754c78` (rama
  `claude/ultron-fp-premium-s46jxx`). Esto es una decisión sobre código y pruebas sin teléfono: no acredita APK
  recibido, latencias medidas ni comportamiento en hardware.

## Decisión

1. **Android:** seguir con el módulo propio `mobile/modules/aura-camara` (Kotlin, CameraX 1.5.0-rc01 + ML Kit face
   detection 16.1.7 en modo flujo con `enableTracking`), que ya está integrado detrás de `CamaraMesa`. Completar sus
   contratos en vez de reemplazarlo: hora de captura del sensor, contexto de origen inmutable (`epoca`, `lado`,
   `cuadro`), cercas antes de emitir y antes de aplicar, prioridad de la voz y mirada separada del render de React.
2. **Respaldo:** `CamaraVision` (expo-camera ~17, fotos + ML Kit sobre archivo) sigue entera para iOS, APK sin el
   módulo (OTA sobre un binario viejo), guardia contra cierres, interruptor remoto y fallos en la sesión. Si la marca
   de la guardia no se puede escribir, se usa la de fotos (no se monta el nativo sin red de seguridad).
3. **Web:** se conserva MediaPipe Tasks Vision 1.0.1 (`src/02-cara/vision`). Sacarlo del hilo de UI (Worker) es una
   mejora aparte; no se extiende MediaPipe a Android sin una brecha geométrica demostrada.
4. **Identidad** sigue separada (face-api en WebView, votos por pista) y con su propia decisión; un `trackId` nunca
   identifica ni autoriza.

## Por qué

- Ya existe y compila en el CI contra las mismas versiones que trae la APK (sin segunda copia de CameraX/ML Kit).
- Análisis latest-only en hilo nativo; a JS solo llegan eventos chicos (≤15 Hz) y recortes bajo demanda: no hay
  frames por el puente ni worklets/JSI (vision-camera + worklets-core cerraba la app, `0602318`).
- ML Kit da lo que la mesa necesita (caja, pose, ojos/sonrisa, trackingId) localmente y sin pesos propios que
  licenciar. La identidad persistente no depende de él.
- El respaldo y el kill switch permiten revertir sin APK nueva; MediaPipe web ya cubre Web/Windows.

## Objeción más fuerte

«ML Kit FAST con `minFaceSize` y 15 fps es una caja negra: no se puede medir captura→pose de punta a punta, su
tracking pierde ids con oclusiones, y CameraX 1.5.0-rc01 es una *release candidate*. Una pila más controlable
(MediaPipe Face Landmarker nativo, o VisionCamera V5 con Frame Output) daría landmarks, blendshapes y control del
pipeline.» Es real: hoy no hay medición en hardware de la latencia ni de la tasa de pérdida de ids, y el rc fija
nuestro techo a lo que traiga expo-camera. Mitigación en este cambio: cada evento lleva la hora del sensor
(`imageInfo.timestamp`, convertida al reloj monótono y a la hora de pared) y su `cuadro`, de modo que la latencia
captura→aplicación se puede medir en el teléfono antes de discutir otra pila; los resultados viejos o de otra cámara
se descartan, sin depender de que el detector sea rápido.

Riesgo principal de latencia: que la cámara compita con la voz. Contención: subidas de escena con `ocupada` en las
dos rutas, repasos de identidad en pausa mientras la mesa habla, y nada de la cámara en el camino del primer audio.

## Qué la cambiaría

- Medición en un Android medio y uno limitado (≥10 min, mismo build, cámara on/off) con p95 captura→pose > 300 ms
  o degradación de la voz > 10 % p95 atribuible al análisis, que no se arregle bajando `fps`/`ladoCorto`.
- Pérdida de `trackingId` frecuente (p. ej. > 1 cambio de id cada 30 s con una persona quieta) que rompa la
  identidad por pista.
- Necesidad probada de landmarks/blendshapes en el teléfono (p. ej. mirada o boca del avatar que lo requiera) que ML
  Kit no da: entonces un spike aislado de MediaPipe sobre el mismo analyzer, con rollback por el interruptor remoto.
- Crash del módulo en hardware real no explicable por nuestro código, o que expo-camera deje CameraX 1.5 y fuerce
  versiones incompatibles.

## Consecuencias

- Una OTA no trae el Kotlin: los campos nuevos (`epoca`, `cuadro`, `tsMono`, `base`) son opcionales en JS y el
  APK viejo sigue funcionando con las cercas que JS puede aplicar solo (lado, edad, generación).
- Pendiente de hardware: latencias, pérdida de ids, transformaciones `cropRect`/PreviewView en cada rotación,
  consumo/temperatura y A/B de la voz con cámara.
