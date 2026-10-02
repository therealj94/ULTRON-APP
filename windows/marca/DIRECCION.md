# AURA para Windows — dirección de diseño «Contraste»

## La idea
En orfebrería, el **contraste** es la marca que se golpea sobre el oro para garantizar su ley. AURA es eso para
Orden Global: la marca que garantiza. **Au** es el oro (y el principio de AU-RA); ORIGEN se mide en gramos de oro;
Orden Global viene de la minería. Todo el lenguaje visual sale de ese mundo: **metal golpeado, grabado, lingote,
punzón, el canto estriado de una moneda, el papel de un certificado de ensayo**. Nada de él sale del mundo «IA».

## Lo que hace que algo se vea «hecho por IA» (prohibido)
- Orbes, esferas o blobs brillantes; auras difusas; «glow» de neón; partículas flotando.
- Degradados morado-azul-rosa; mallas de gradiente; vidrio esmerilado con neón detrás.
- Chispas ✨, estrellitas, varitas mágicas, cerebros, redes neuronales, circuitos.
- Mascotas robot como identidad (los avatares viven en su lugar; el logo NO es un robot).
- Tres puntitos «escribiendo…», spinners genéricos, anillos que pulsan sin significado.
- Tarjetas idénticas con ícono redondo + título + subtítulo repetidas en cuadrícula.
- Texto genérico de producto («Tu asistente inteligente», «potenciado por IA»).
- Animaciones por todas partes que no dicen nada.

## Paleta (tokens)
| Nombre | Hex | Uso |
|---|---|---|
| Obsidiana | `#0D0C0A` | fondo (negro cálido, nunca #000) |
| Grafito | `#171512` | superficies, notch en reposo |
| Grafito 2 | `#221F1A` | superficies elevadas, campos |
| Oro crudo | `#B8913F` | líneas, marcas, acento principal |
| Oro pulido | `#E3C77E` | brillo puntual, foco, lo activo |
| Papel de ensayo | `#ECE5D6` | texto principal (cálido, no blanco puro) |
| Ceniza | `#8E877A` | texto secundario |
| Cardenillo | `#5E9C8C` | «te escucho» / en vivo (la pátina del cobre) |
| Lacre | `#B5482E` | error, grabando, colgar (cera de sello) |

El oro es material, no decoración: se usa en filos de 1 px, en la marca y en lo activo. Nunca en grandes áreas
salvo el punzón del logo.

## Tipografía (IBM Plex, OFL — en `windows/marca/fuentes`)
- **Plex Sans Condensed SemiBold**, mayúsculas con tracking +8–12 %: títulos cortos, marcas, «AU·RA», rótulos.
  Como los rótulos estampados en un lingote.
- **Plex Sans** (400/500/600): todo el texto de lectura.
- **Plex Mono** (400/500): cifras, saldos, horas, versiones, atajos de teclado — como la lectura de un ensayo.
  Las cifras siempre en Mono, alineadas.
Escala: 11 / 12.5 / 14 / 16 / 20 / 28 / 40. Nada por debajo de 11.

## La marca
`marca.svg` (punzón de lingote con «AU» calado), `marca-chica.svg` (≤ 32 px), `marca-tinta.svg` (una tinta,
`currentColor`). Geometría en `geometria.txt` (sirve tal cual como `Path.Data` en WPF). Wordmark: «AU·RA» en
Plex Sans Condensed SemiBold, tracking +12 %; «FP» en Plex Mono a 45 % del tamaño. Firma: «POWERED BY ORDEN GLOBAL»
en Plex Mono 11, tracking +18 %, ceniza.

## Movimiento: «el golpe» y «el grabado»
- **Golpe** (cosas que aparecen con decisión): escala 1.04 → 1 con easing `cubic-bezier(.2,.9,.1,1)` en 160–220 ms,
  sin rebotes blandos. Un único destello de 60–80 ms en el momento del golpe, nunca un glow permanente.
- **Grabado** (líneas, foco, progreso): un filo de 1 px de oro que se traza de un punto a otro (dashoffset /
  ScaleX desde el centro), 240–320 ms.
- **Canto estriado** (pensando): el patrón de estrías del canto de una moneda que se desplaza lento — reemplaza a
  los tres puntos y a los spinners.
- **Pátina** (escuchando): un filo cardenillo que respira (opacidad .45 ↔ .9, 1,6 s), no un anillo pulsante.
- **Voz** (hablando): la onda dibujada como líneas grabadas finas (trazo 1,5 px), no barras de ecualizador gordas.
- Todo con transform/opacity; `prefers-reduced-motion` / `SystemParameters.ClientAreaAnimation=false` → sin
  movimiento decorativo (los estados siguen visibles por color/texto).

## La pantalla de arranque (splash)
1. Obsidiana con viñeta muy leve (0–120 ms).
2. El punzón (cara del lingote) llega desde profundidad: escala 1.12 → 1.0, opacidad 0 → 1, 380 ms.
3. **El golpe**: a los ~520 ms, destello oro pulido de 70 ms + sacudida de 2 px; el «AU» queda calado (hundido).
4. El canto: un anillo de estrías finas alrededor gira 18° y se detiene (600 ms, ease-out).
5. «AU·RA FP» se escribe con el tracking cerrándose de +40 % a +12 % (420 ms); un filo de 1 px se graba debajo.
6. «POWERED BY ORDEN GLOBAL» aparece (Mono, ceniza), 200 ms.
7. Todo se encoge hacia el notch (arriba al centro) en 320 ms y aparece el notch.
Total ≈ 2,2 s. Clic / Esc / tecla lo salta. Al arrancar con Windows (inicio automático) va la versión corta
(≈ 0,9 s: pasos 2, 3 y 7). Con movimiento reducido: la marca fija 600 ms y fundido.
