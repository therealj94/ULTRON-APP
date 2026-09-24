# AU-RA en 3D: el personaje

AU-RA FP (antes ULTRON FP) pasa de una cara dibujada a un personaje de cuerpo entero: femenina,
estilo peluche 3D, con emociones en la cara y en el cuerpo. Primero ella; Dr Electrum después, con
el mismo motor.

## Lo que ya existe y se reusa

- **Emociones**: el 27B abre cada respuesta con `[EMO:x]`, 19 emociones en un solo contrato
  (`lib/emocion.ts`). El personaje las recibe igual que hoy la cara.
- **Voz**: ElevenLabs v3 con la voz de Gabriela. «AU-RA» se pronuncia «Aura»
  (`server/habla.ts`, con prueba en `tests/voz.test.ts`).
- **Tacto, mirada y cámara**: los mismos eventos que mueven la cara de hoy.

## Concepto (fase 1)

Cuatro propuestas en `docs/aura-concepto/` (`aura-conceptos-4.jpg` las reúne). Rasgos comunes:
peluche color crema, moño, pestañas, mejillas rosadas, halo dorado que flota (su «aura»), vestido
drapeado verde petróleo `#062B2C` con ribete dorado `#C9A961` y un broche dorado en el pecho.
Generadas en ElevenLabs (flujo «AU-RA · concepto del personaje»).

Siguiente paso: elegir una, ajustarla y sacar la hoja completa (frente, perfil, espalda y ocho
expresiones), que es lo que recibe quien modele.

## Cómo se construye

| Pieza | Decisión |
|---|---|
| Modelo | GLB con esqueleto, ~15 formas de boca y ~20 de expresión |
| Animaciones | ~15 clips: reposo, respirar, saludar, asentir, pensar, reír, celebrar, preocuparse, rezar, cantar, sorprenderse… |
| Motor | three.js en web y su versión nativa en Expo; un solo código de comportamiento |
| Boca | tiempos por letra de ElevenLabs convertidos en formas de boca |
| Respaldo | la cara 2D de hoy, si el aparato no puede con el 3D |

## Fases

1. Concepto: **en curso**.
2. Modelo 3D con esqueleto: artista 3D, o IA de imagen a 3D más limpieza a mano.
3. Motor del personaje: en paralelo con la 2, sobre un muñeco de prueba.
4. Voz a boca.
5. Pruebas en un teléfono de gama media: 60 cuadros por segundo de objetivo, 30 de mínimo.
6. Salida en web y APK.

## Lo que el cambio de nombre dejó pendiente

Tres clips grabados decían «ULTRON» (`bienvenida`, `quien`, `discurso`). Se retiraron y esas
preguntas las contesta ella en vivo. Los saludos por hora del teléfono (`dias`, `tardes`, `noches`)
ya dicen «Estoy lista» en el texto, pero el audio empaquetado se grabó en masculino: hay que
regenerarlos con `mobile/scripts/build-voice-bank.mjs`. Nada de lo interno cambió de nombre: las
variables `ULTRON_*`, las rutas `/api/ultron/*`, el paquete Android `link.ordenglobal.ultronfp` y
el servicio de Render. Cambiarlos cortaría la app instalada y la configuración de producción.
