# Dr Electrum · el geólogo explorador, su oficina y su entrada

**24 de septiembre de 2026 · concepto, no construido.** Personaje elegido: **3 · geólogo explorador** (`3-geologo-explorador.png`).

| Archivo | Qué es |
|---|---|
| `4-logo-powered-by-orden-global.png` | Emblema + «Dr Electrum» + «Powered by Orden Global» |
| `5-oficina.png` | La oficina vacía: el fondo donde vive el personaje |
| `6-poses.png` | Cuatro poses: entra caminando, saluda, señala y explica |

---

## 1 · La entrada (cuando se abre la app)

Unos 4 segundos en total. Se puede saltar con un toque, y a partir de la tercera vez se acorta sola (solo el saludo).

| Tiempo | Qué pasa |
|---|---|
| 0,0 s | La oficina aparece vacía con luz de tarde. Se oye una puerta y unos pasos (sonido suave) |
| 0,6 s | Dr Electrum **entra caminando desde fuera de cámara** por la izquierda, con el mapa bajo el brazo (pose 1) |
| 1,8 s | Se detiene en el centro, deja el mapa en la mesa y **saluda** mirando a cámara (pose 2) |
| 2,2 s | Voz («Daniel», ElevenLabs): *«¡Buenas! Soy el Dr Electrum. ¿Qué terreno vemos hoy?»* El saludo cambia con la hora (buenos días / buenas tardes) y, si ya lo conoce, por el nombre |
| 3,0 s | Aparecen tres burbujas: **🗺️ Buscar un terreno**, **📂 Mis expedientes**, **💬 Preguntarle algo** |
| Pie | «Powered by Orden Global» pequeño, abajo al centro |

**Cómo se construye:** en la web, sprites o un Lottie/Rive sobre la imagen de la oficina. En el móvil, lo mismo con `react-native-reanimated` + Rive. La oficina es una imagen con **zonas tocables** encima, no un 3D completo. Así carga rápido en teléfonos de gama baja y con mala señal en el campo.

---

## 2 · La oficina: cada objeto es una puerta

Se toca un objeto y él camina hasta allí y lo explica.

| Objeto | Qué abre | Conecta con |
|---|---|---|
| **🖥️ La computadora** | El mapa del catastro: concesiones pintadas, búsqueda por nombre o coordenada, capas | `server/electrum` + PostGIS (1.079 concesiones). **Pendiente**: que el mapa pinte las concesiones |
| **🗂️ El archivador** | Los expedientes del usuario: sus terrenos guardados, informes y fotos | Base de datos de Electrum |
| **🪨 La estantería de rocas** | «Enséñame la roca»: foto de una muestra → qué puede ser, qué análisis pedir. Siempre dice que es orientativo | Especialista de mineralogía (de los 8) |
| **🗺️ Los mapas de la pared** | Geología y topografía de la zona: ríos, pendientes, accesos | Capas públicas |
| **📋 El tablero de corcho** | Avisos: una concesión cerca que cambió de estado, un plazo que vence | Notificaciones |
| **🪟 La ventana** | Clima y estado de los caminos de la zona del terreno | Servicio de clima |
| **🎒 El sombrero en el perchero** | **Modo campo**: sale de la oficina, cámara y GPS para ir al terreno | `CampoScreen` |
| **☎️ El teléfono** | Hablar con una persona del equipo | Traspaso a humano |

---

## 3 · Qué puede hacer Dr Electrum (ideas)

**Sobre el terreno**
1. **«¿De quién es este terreno?»**: marca un punto en el mapa o manda tu ubicación y te dice si cae dentro de una concesión, de quién es y en qué estado está.
2. **Traslapes**: dibujas un polígono y te avisa si choca con concesiones, áreas protegidas o zonas de reserva.
3. **Informe en PDF** del terreno: mapa, concesiones cercanas, datos públicos, con fecha y fuente. Aclara que no es un dictamen legal.
4. **Seguimiento**: «avísame si cambia algo en esta zona».

**En el campo**
5. **Modo campo**: foto con GPS y hora, nota de voz, y todo cae en el expediente sin señal (se sube después).
6. **Identificar la roca** con una foto, como orientación: siempre recomienda análisis de laboratorio.
7. **Ruta al punto**: cómo llegar y qué tan empinado está.

**Aprender**
8. **Explicar en sencillo**: qué es una concesión, cómo se tramita, qué es una muestra de canal, qué significa «ley» de un mineral.
9. **Glosario con dibujos**: él saca la roca o el mapa de su estantería y lo enseña.
10. **Mini lecciones de 1 minuto** en voz, para escuchar en el camino.

**Su personalidad**
- Habla como un geólogo de campo con experiencia: cercano, paciente, con alguna anécdota corta.
- **Nunca** promete oro, rendimientos ni precios. Si no sabe, lo dice y ofrece a una persona.
- Cuando piensa, se acaricia la barba. Cuando encuentra algo, levanta la lupa. Cuando termina, se sienta a esperar.

**Detalles vivos (poco costo, mucho encanto)**
- La luz de la ventana sigue la hora real: mañana, tarde, noche con lámpara.
- Si el usuario no toca nada en 20 s, él hojea un mapa o toma café del termo.
- En la primera visita le da al usuario su propio «expediente» con su nombre.

---

## 4 · Lo que falta antes de construirlo

1. Aprobar el personaje, el logo y la oficina (estas imágenes son el concepto).
2. Animación: encargar el rig de Rive/Lottie a partir de `6-poses.png`, o generar el paseo con video.
3. **Que el mapa pinte las concesiones**: sin eso, la computadora no tiene qué enseñar.
4. Textos legales: cada respuesta sobre titularidad lleva la fuente y la fecha del dato, y la nota «no sustituye una certificación oficial».
