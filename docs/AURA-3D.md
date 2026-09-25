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

## Elegido (24-sep)

- **Personaje**: `docs/aura-concepto/v2/p2.jpg` — frijol color crema de vinilo suave, neutral,
  bufanda verde salvia, anillo de luz dorada que gira a la altura de la cintura. Su sala: ventana
  en arco, plantas y un sillón huevo mostaza.
- **Logo**: `docs/aura-concepto/v2/logo-aura.png` (el 1, sin el corazón) e `icono-aura.png`.
  Falta redibujarlo en vector para la versión final.
- **Prototipo en movimiento**: `docs/aura-concepto/v2/prototipo-sala.html`.

## Interacciones con objetos

Cada herramienta de AU-RA tiene su gesto, para que se vea qué está haciendo:

| Herramienta | Lo que se ve |
|---|---|
| Buscar en internet | camina al escritorio, se sienta en el puf, abre la computadora y teclea |
| Enviar (Telegram, correo) | dobla un avión de papel y lo lanza por la ventana |
| Anotar, recordatorios | saca una libreta y escribe |
| Oro y metales | levanta una tarjeta con la gráfica |
| Leer un PDF | sostiene la hoja y la recorre con la vista |
| Contestar | de pie en el centro o sentada en su sillón, según la preferencia, gesticulando |

En la app de verdad, esto se engancha a las herramientas que el cerebro ya usa: cuando el turno
llama a `web`, `telegram`, `memoria`, `metales` o `pdf`, la pantalla recibe el evento y el
personaje hace el gesto que le toca.

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

1. Concepto: **hecho** (personaje 2, logo sin corazón).
2. Modelo 3D con esqueleto: artista 3D, o IA de imagen a 3D más limpieza a mano.
3. Motor del personaje: en paralelo con la 2, sobre un muñeco de prueba.
4. Voz a boca.
5. Pruebas en un teléfono de gama media: 60 cuadros por segundo de objetivo, 30 de mínimo.
6. Salida en web y APK: **hecha en la rama**, sin publicar hasta el merge a main.

## En el teléfono (APK de AU-RA)

La sala del teléfono es la misma de la web, no una copia. `scripts/sala-movil.mjs` empaqueta
`src/11-sala/embed.ts` con three.js en una sola página y la escribe en `mobile/src/sala/salaHtml.ts`,
que va dentro de la APK. Así ella aparece al instante y también sin red, y no depende de qué sirva
Render. `tests/sala-movil.test.ts` vuelve a empaquetar y falla si alguien cambió la sala sin
regenerarla.

- `mobile/src/components/SalaAura.tsx`: la WebView con el puente. Manda estado, emoción, boca (con
  la voz real, ~15 veces por segundo), mirada de la cámara, tarea y postura; recibe toques
  (cabeza → curiosa, cuerpo → cosquillas) y deslizar (arriba abre el menú).
- Si la WebView no tiene WebGL, se cae o no dice «listo» en 12 s, vuelve la cara 2D de siempre.
- `mobile/src/lib/tareas.ts`: el reparto herramienta → gesto, comprobado contra el de la web.
- «Te contesta: de pie / sentada» está en el menú y se guarda en los ajustes.
- Íconos: `mobile/scripts/marca-aura.py` dibuja el planeta del logo. Dr Electrum conserva los suyos
  en `mobile/assets/electrum/`.
- Pantallas de AU-RA en crema, miel y salvia (`mobile/src/tema.ts`): arranque con el logo, entrada,
  menú y mesa. Dr Electrum no cambia.
- Prueba sin teléfono: `node scripts/qa/sala-movil-qa.mjs <carpeta>` carga la página empaquetada en
  Chromium con el mismo puente, en horizontal, de pie y sentada, y falla con cualquier error.

En pantallas bajas y anchas (un teléfono en horizontal) la cámara se acerca y la acompaña, porque
con el encuadre de escritorio quedaba chiquita.

## Lo que el cambio de nombre dejó pendiente

Tres clips grabados decían «ULTRON» (`bienvenida`, `quien`, `discurso`). Se retiraron y esas
preguntas las contesta ella en vivo. Los saludos por hora del teléfono (`dias`, `tardes`, `noches`)
ya dicen «Estoy lista» en el texto, pero el audio empaquetado se grabó en masculino: hay que
regenerarlos con `mobile/scripts/build-voice-bank.mjs`. Nada de lo interno cambió de nombre: las
variables `ULTRON_*`, las rutas `/api/ultron/*`, el paquete Android `link.ordenglobal.ultronfp` y
el servicio de Render. Cambiarlos cortaría la app instalada y la configuración de producción.

## Forma y color: opciones (25-sep)

José pidió algo más neutral: el frijol con rubor, bufanda y mostaza se siente de niño. La sala
ahora acepta un estilo (`src/11-sala/estilos.ts`): tres formas (Frijol, Serena, Orbe) y cuatro
paletas (Miel, Piedra, Arena, Grafito). Sin elegir, sale el aspecto de siempre (Miel · Frijol).
Las opciones renderizadas con el motor real están en `aura-concepto/v3/opciones-forma-color.png`.
Para verlas en vivo: `sala.html?paleta=piedra&forma=serena`. Pendiente: que José elija y se fije
como estilo de la web y del teléfono, con los colores de los botones y pantallas a juego.
