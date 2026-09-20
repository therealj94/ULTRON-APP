# ELECTRUM — Dr Electrum FP

Estación de trabajo minera. Mapa, expedientes, especialistas y un doctor que lo explica todo.

## Qué es y qué no es

ULTRON FP es una cara que conversa. Electrum es otra cosa: **un mapa con expedientes al lado y un
especialista que los interpreta**. Comparte el motor —nodo Qwen, sesiones, oído, visión, harness,
memoria— y cambia todo lo que está encima.

No es un tercer perfil de ULTRON. Un perfil cambia el cerebro; Electrum cambia además la piel, los
datos y las manos. Lo que sí se reusa, se reusa: duplicar la voz o la cara sería condenarse a
arreglar cada cosa dos veces.

## Las cinco capas

```
PIEL        app nueva: mapa al centro, chat al lado, expedientes e informes.
            La cara de ULTRON arranca completa y cede el paso cuando se abre un mapa.
MANOS       harness extendido: mapa, catastro, gis, calculo, expediente, informe, web, leer.
DATOS       PostGIS en el nodo AWS: catastro espacial + documentos indexados con cita a página.
CEREBRO     conocimiento minero + panel de especialistas.
CUERPO      lo que ya existe: nodo Qwen, sesiones, voz, oído, visión, harness, memoria.
```

## El panel de especialistas

«Que active geólogo, ingeniero civil y todo lo que se le ocurra» no se resuelve con un prompt más
largo. Un prompt de seiscientas líneas obedece peor que uno de veinte, y nadie puede auditar de
dónde salió una respuesta.

En su lugar, cada especialista es un módulo con su porción de conocimiento, sus reglas, sus
herramientas y su forma de responder. Dr Electrum enruta la pregunta a uno o varios, los consulta y
sintetiza. La respuesta puede decir de quién viene, que es lo que un cliente técnico va a exigir.

| Especialista | De qué responde |
|---|---|
| Geólogo | yacimientos, estructura, alteración, interpretación de sondajes, modelo geológico |
| Ingeniero de minas | método, diseño, planeamiento, secuencia, dilución, recuperación minera |
| Ingeniero civil | accesos, botaderos, presas de relaves, estabilidad de taludes, obras |
| Metalurgista | pruebas, diagrama de flujo, recuperación, concentrados, refractariedad |
| Geomática / GIS | capas, proyecciones, traslapes, áreas, topografía |
| Ambiental | licencias, drenaje ácido, relaves, cierre, monitoreo |
| Legal minero | concesiones, vigencias, obligaciones, marco del país |
| Economista minero | costos, AISC, VAN y TIR, ley de corte, valuación |

El enrutador es determinista (tabla de disparo por tema) y además se puede pedir a uno por su nombre
(«dr, póngame al geólogo»), que manda sobre la tabla. Convoca **como mucho dos**: con tres o más, el
system se llena de reglas que se contradicen y la respuesta sale a comité.

Cada especialista lleva, además de sus reglas, **el error clásico de su oficio** que tiene que
corregir cuando lo ve: el geólogo vigila que nadie llame reserva a un recurso inferido; el civil, que
nadie diseñe una presa de relaves «provisional»; el economista, que no se presente un valor in situ
como si fuera el valor del proyecto.

Una trampa que encontró una prueba, no el diseño: los nombres de las concesiones están llenos de
accidentes geográficos. «Quebrada Seca» convocaba al ambiental por la palabra «quebrada». Los
disparadores llevan términos del oficio, no del paisaje.

A cada panel se le ofrecen **solo sus herramientas**. Un modelo con veinte delante elige peor que uno
con seis.

## Los datos: PostGIS en el nodo AWS

Un catastro nacional son miles de polígonos y las consultas que importan son espaciales: qué se
traslapa con qué, qué cae dentro de un área, qué está a menos de tal distancia de un río. Eso lo
hace una base con índice espacial, no un archivo en memoria.

Va en la máquina que ya tenemos, con su script de instalación, sus respaldos y su esquema
versionado. Los archivos originales (.shp, .kmz, PDF) se guardan tal cual: el expediente es la
fuente, la base es el índice.

## El motor GIS — **hecho y verificado**

`server/electrum/gis.ts`. Es el cimiento: si la geometría miente, todo lo demás miente con ella.

**Entran**: shapefile (.zip o suelto), GeoJSON, KML, KMZ y CSV con coordenadas. GeoPackage y DXF
todavía no, y lo dicen claro en vez de fallar en silencio.

**Tres cosas que hace bien y casi nadie hace bien:**

1. **Reproyecta de verdad.** Los shapefiles del catastro hondureño vienen en UTM 16N y los viejos en
   NAD27. Quien ignora el `.prj` lee metros como si fueran grados y las concesiones aterrizan en
   mitad del Atlántico. Aquí se lee el `.prj`, se reproyecta a WGS84 y se dice de dónde venía. Sin
   `.prj`, avisa; no adivina.

2. **Mide sobre el elipsoide, no sobre una esfera ni sobre la cuadrícula.** Hay dos errores
   encadenados que nadie nota:

   - El área del `.dbf` está medida en la cuadrícula UTM, que a 45 km del meridiano central encoge
     todo. Un cuadrado de 2.000 × 2.000 m «de 400 ha» encierra **400,30 ha** de suelo.
   - Y la fórmula esférica que traen las librerías comunes (turf, radio único de 6.371 km) se pasa
     otro 0,37 % a la latitud de Honduras: daría **401,78 ha**.

   Hectárea y media de diferencia en una sola concesión, que es exactamente por lo que pelean dos
   titulares. Electrum usa la esfera autálica con latitudes transformadas (Snyder), que reproduce el
   elipsoide WGS84 con error por debajo del metro cuadrado en un polígono de este tamaño. Y cuando
   el área medida no coincide con la declarada, lo dice en vez de callarlo.

3. **Encuentra traslapes.** Dos concesiones que se pisan es el problema número uno de cualquier
   catastro y lo que no se ve mirando un mapa bonito. Recorte real de polígonos, con descarte previo
   por caja envolvente para que un padrón nacional termine en tiempo finito.

Lo que dice al terminar de leer un archivo, textual, corriendo contra los fixtures:

> Leí catastro: 2 entidades en formato shapefile, desde WGS 1984 UTM Zone 16N. Suman 800,60
> hectáreas de área real medida sobre el elipsoide. El archivo declara 800,00 hectáreas: 0,60 de
> diferencia con lo medido. Es lo normal cuando el área se calculó sobre la cuadrícula UTM y no
> sobre el terreno; la buena es la medida.

> Encontré 1 traslape en catastro: Quebrada Seca con Cerro Partido, 100,07 hectáreas. Eso es
> superposición de derechos y se resuelve por prelación de la solicitud, no en el mapa.

**Probado** (`tests/gis.test.ts`, 23 casos) contra cuadrados exactos en UTM 16N generados por
`scripts/gis/fixture-concesiones.py`: verdades conocidas, no números copiados de la salida.

## Los datos: PostGIS — **hecho y verificado**

Esquema en `scripts/electrum/esquema.sql`, instalador en `scripts/electrum/instalar-postgis.sh`,
acceso en `server/electrum/db.ts`.

Tablas: `capa` (cada archivo subido), `concesion`, `entidad_geo` (bocaminas, ríos, poblados, áreas
protegidas), `documento` y `fragmento` (expedientes troceados **con su página**, porque una cita sin
página no se puede comprobar y entonces no es una cita), y `traslape` (calculado y guardado: en un
padrón nacional recalcularlo en cada pregunta cuesta minutos).

Decisiones que conviene entender:

- **Todo en WGS84.** La reproyección se hace una sola vez, al entrar. Guardar cada capa en su propia
  proyección es cómodo el primer día e infernal al mes siguiente, cuando hay que cruzar dos capas.
- **`MULTIPOLYGON`, no `POLYGON`.** Una concesión puede venir partida en varios recintos.
- **El área se guarda dos veces**: la medida sobre el elipsoide y la que declaraba el archivo. Poder
  mostrar la diferencia es la comprobación que más pleitos evita.
- **Los atributos del `.dbf` van completos en JSONB.** Un catastro real trae columnas que nadie
  previó y tirarlas es perder el expediente.
- **Búsqueda que perdona.** Dos fallos distintos: escribir mal («Quebrda Seca» → trigramas) y
  escribir solo un pedazo («Andina» dentro de «Compañía Demo Andina Ltda.» → subcadena, porque la
  similitud ahí da 0,27 y el umbral es 0,3). Las dos, con `unaccent` para que «Danlí» y «Danli» sean
  lo mismo.

Consultas listas: buscar, por vencer, traslapes, qué concesión cubre este punto, qué hay a menos de
X kilómetros (medido sobre el elipsoide), la geometría con su centro y encuadre para volar el mapa,
la capa entera como GeoJSON, y búsqueda en expedientes con página.

**La verificación que importa**: se levantó un PostgreSQL 16 con PostGIS 3 de verdad, se cargó el
shapefile de prueba y se comprobó que **PostGIS y el motor de TypeScript dan el mismo número**. Son
dos implementaciones independientes del área geodésica —`ST_Area` sobre `geography` por un lado, la
esfera autálica de Snyder por el otro— y coinciden dentro de 0,01 ha. Si un día alguien rompe una,
la otra lo delata. 13 casos, todos en verde.

El instalador es idempotente, genera la clave si no se la dan, aplica el esquema y **se comprueba a
sí mismo**: mide un cuadrado conocido y falla si la cuenta no es geodésica. No abre el puerto a
internet a propósito: un catastro completo expuesto en 5432 con una clave es, tarde o temprano,
regalarlo.

## La app — **hecha y mirada**

`src-electrum/`, servida en `/electrum.html`. Vive junto a ULTRON FP en el mismo despliegue: dos
entradas de Vite, un solo servidor.

**La cara que cede el paso.** Arranca como ULTRON: cara completa, centrada, ámbar. En cuanto hay algo
que mirar se encoge a una esquina con su marco y le deja el escenario al mapa, pero sigue ahí,
reaccionando. Es el mismo nodo del DOM moviéndose entre dos sitios, no dos caras que se turnan: por
eso se lee como que ELLA se aparta. En teléfono se va arriba, sobre el mapa, porque abajo tapaba el
campo de escribir.

**El panel** va al costado en pantalla ancha y se vuelve lámina de abajo en teléfono. Muestra la
**traza de herramientas** bajo cada respuesta: qué consultó, qué midió, qué encontró. No es
depuración, es lo que un ingeniero exige para creerle.

### Cuatro fallos que solo se vieron mirando

Ninguno daba error; todos se veían en una captura:

1. **La cara se dimensionaba a la ventana**, no a su caja. Con ULTRON a pantalla completa da igual;
   encogida en un recuadro de 132 px seguía dibujando a tamaño de ventana y tapaba media interfaz.
   Ahora se mide por su contenedor, con un observador de tamaño.
2. **El servidor compilado no arrancaba.** `shpjs` está escrito para el navegador y toca `self` al
   cargarse, que en Node no existe: importarlo arriba tumbaba el proceso al arrancar aunque nadie
   subiera jamás un shapefile. Ahora se carga a demanda. Con `tsx` no se ve; con el bundle, sí.
3. **El mapa salía negro** con las teselas cargadas y los píxeles pintados. MapLibre le pone al
   contenedor su clase `.maplibregl-map`, que trae `position: relative`, y como su hoja se carga
   después le ganaba al `absolute` de Tailwind: la caja perdía la posición, `inset-0` dejaba de
   significar nada y la altura colapsaba a cero. Se dibujaba dentro de una caja de 0 px con recorte.
   La posición va en línea, que gana siempre.
4. **MapLibre mide su caja una sola vez**, al construirse, y después solo escucha a la ventana. Aquí
   la caja cambia sin que la ventana se mueva. Lleva su propio observador.

- **MapLibre** para el trabajo: teselas vectoriales, aguanta miles de polígonos, capas, medición.
- **Google Maps** como fondo alternativo para presentar, detrás de su clave y su facturación.

El mapa no es decorado: **se mueve solo cuando Dr Electrum habla**. Nombra una concesión y el mapa
vuela hacia ella; explica un traslape y lo resalta. Eso es lo que separa una demo de una herramienta.

## El harness — **hecho y probado**

Se investigó antes de escribir, y dos hallazgos cambiaron el diseño:

- **Qwen3 ya habla Hermes de fábrica.** El formato `<tool_call>{…}</tool_call>` está en su propia
  plantilla de chat: el modelo fue entrenado con él. El `PEDIR_HERRAMIENTA:` que teníamos era una
  línea inventada por nosotros, y un modelo que emite el formato con el que fue entrenado se
  equivoca muchísimo menos en los argumentos.
- **Ollama acepta `tools` nativo** y devuelve `message.tool_calls` en array: varias herramientas a
  la vez. El harness viejo hacía una por turno.

`lib/agente/` habla los tres, en orden: nativo, Hermes, y el viejo por los nodos que quedaron atrás.
Todo sale normalizado; el bucle no sabe de dónde vino.

El bucle trae lo que separa un agente útil de uno que da vueltas:

- **Presupuesto** de rondas, llamadas y tiempo. Sin tope, un agente reintenta hasta que alguien lo
  mata, y la espera la paga el usuario frente a una pantalla quieta.
- **El error vuelve al modelo** con su motivo («falta el campo b»), así corrige en la ronda
  siguiente. Un fallo mudo se convierte siempre en una respuesta inventada.
- **Nada de repetir**: la misma llamada no se ejecuta dos veces; se le devuelve lo de antes.
- Una herramienta colgada no cuelga el turno; las que escriben no corren con acceso de consulta.

Probado con 31 casos y un modelo de mentira, porque el presupuesto agotado y la llamada repetida con
un modelo de verdad no se disparan cuando uno quiere.

## Las manos — **hechas**

`server/electrum/manos.ts`. Cada resultado lleva **dos cosas**: `texto` corto para el modelo y `ui`
para la pantalla. Por eso el mapa vuela a una concesión sin que el modelo escriba una coordenada.

| Mano | Qué hace |
|---|---|
| `catastro_buscar` | concesiones por nombre, titular, expediente o municipio |
| `catastro_vencimientos` | lo que vence y en cuántos días |
| `catastro_en_punto` | qué concesión cubre unas coordenadas y qué hay cerca |
| `gis_traslapes` | qué se pisa con qué, en hectáreas |
| `gis_medir` | área y perímetro sobre el elipsoide, distancia entre puntos |
| `mapa_volar` | mueve el mapa a una concesión y la resalta |
| `mapa_capa` | pinta una capa entera |
| `expediente_buscar` | busca en los documentos y devuelve el texto **con su página** |
| `calculo_mina` | las cuentas, en código y con la fórmula a la vista |
| `metales_spot` | precio del oro y la plata ahora |
| `web_buscar` / `web_leer` | busca en internet y abre páginas |
| `informe_pdf` | arma la ficha o la cartera en PDF, descargable |

## Aprender de lo que se sube — **hecho**

`server/electrum/aprender.ts`. Un archivo entra y sale convertido en algo consultable y citable.

- **Geográfico** (.shp, .zip, .kml, .kmz, .geojson, .csv) → motor GIS → PostGIS, y recalcula
  traslapes. Queda buscable, medible y el mapa puede volar a ello.
- **Documento** (.pdf, .txt, .md) → texto → troceado **sin cruzar de página** → índice de texto
  completo en español.

El troceado decide la calidad de todo lo que venga después. Se corta por párrafos respetando el
límite de página, con un solapamiento pequeño para que una frase partida siga encontrándose, y las
tablas largas se parten por frases: cortar a ciegas cada N caracteres parte números por la mitad,
que en un informe minero es lo único que no se puede partir. Un trozo nunca cruza de página, porque
si cruza, la cita miente.

Un PDF escaneado sin capa de texto se rechaza diciéndolo: «es un escaneo, necesito una versión con
texto o pasarlo por reconocimiento óptico». No se finge que se leyó.

### El cargador

`npx tsx scripts/electrum/aprender.ts <archivo|carpeta>...` mete cualquier cosa en el cerebro:
shapefiles, KML, PDF, texto. Acepta carpetas enteras y no se para por un archivo roto — cuando
alguien manda cincuenta, uno malo no puede detener la carga. Con `--seco` dice qué haría sin
escribir nada.

### Tres fallos que solo aparecieron cargando de verdad

Ninguno se veía leyendo el código:

1. **Todo parecía un PDF.** Se le pasaba a mano el tipo `application/pdf`, así que un `.txt` se
   rechazaba como «escaneo sin texto».
2. **Cargar dos veces el mismo archivo duplicaba el catastro** — y peor: cada concesión aparecía
   traslapada al 100 % con su propia copia, de modo que un padrón sano parecía un desastre de
   superposiciones. Ahora cada geometría lleva una huella (`md5` de su forma normalizada) y la misma
   no entra dos veces.
3. **Preguntar en forma de pregunta no encontraba nada.** `websearch_to_tsquery` une todos los
   términos con Y, y «cuál» no está en las palabras vacías del español: «¿cuál es la ley media?»
   exigía que el documento dijera literalmente «cuál». Ahora se limpian los interrogativos y, si la
   búsqueda exacta no da nada, se repite pidiendo cualquiera de los términos. Y la cita sale
   centrada en la coincidencia (`ts_headline`), no en el principio del trozo: citar el encabezado
   del informe es técnicamente la misma fuente y no le sirve a nadie.

## Estado

| Pieza | Estado |
|---|---|
| Motor GIS: ingesta, reproyección, área elipsoidal, traslapes | **hecho y probado** |
| Fixtures de catastro en UTM 16N | **hecho** |
| Esquema PostGIS, instalador y capa de acceso | **hecho y probado contra una base real** |
| Harness agéntico (nativo + Hermes + legado, con presupuesto) | **hecho y probado** |
| Panel de ocho especialistas con enrutado | **hecho y probado** |
| Las manos (diez herramientas) | **hechas y probadas** |
| Aprender de lo que se sube (GIS y documentos con página) | **hecho** |
| App: mapa doble, cara que cede el paso, panel y expedientes | **hecha y mirada** |
| Padrón y puerta propia, separada de ULTRON | **hecho y probado contra el servidor compilado** |
| Bot de Telegram Dr Electrum FP | **hecho** (falta darle de alta el bot en BotFather) |
| Generador de informes en PDF | **hecho y mirado** — ficha de concesión y estado de cartera, con el mapa dentro |
| Voz propia con ElevenLabs | **hecha** — Daniel, grave y de edad |

## Quién entra

Dr Electrum **no hereda la gente de ULTRON**. Está en [`ACCESOS.md`](./ACCESOS.md): padrón propio,
llave propia, bot propio y secreto propio. Estar en la junta de Orden Global no te abre la demo
minera, y al revés.

## Decisiones tomadas

- Mapa: MapLibre y Google, con interruptor.
- Datos: PostGIS propio en el nodo AWS.
- Cara: completa al arrancar, se encoge a un lado cuando se abre un mapa o un expediente.


## Los informes

Dos, y los dos se arman **del catastro**, no de lo que escriba el modelo:

- **Ficha de concesión** — identificación, geometría medida sobre el elipsoide, el mapa como se
  estaba viendo, traslapes que le tocan y lo que digan los expedientes **citado con su página**.
- **Estado de la cartera** — cuánto hay, cuánto tiene geometría, qué vence dentro del año y qué se
  pisa con qué.

### Por qué el modelo no escribe el informe

Es la decisión de diseño de esta pieza, y no es de estilo. **Un PDF se imprime y se lleva a una
reunión.** El día que una cifra inventada sale con membrete deja de ser una respuesta desafortunada
y pasa a ser un documento falso.

Así que el reparto es estricto: los datos salen del catastro y de las medidas; el modelo elige
*qué* informe y puede aportar un párrafo, que va en una sección rotulada **«Lectura de Dr
Electrum»** con una nota debajo diciendo que eso es interpretación y no medida. El esquema de la
herramienta ni siquiera acepta números, y hay una prueba que lo vigila.

Los avisos —vigencia contradictoria, vencimiento cercano, área que no cuadra con el plano, titular
en blanco— se buscan a propósito y van arriba. Nadie abre un PDF de cuarenta concesiones a
comprobar fechas a mano.

### El escritor de PDF

`lib/pdf.ts` se rehízo entero. El anterior era una página suelta cortada a noventa y dos
**caracteres**, y Helvetica es proporcional: una línea de emes se salía del papel y una de íes
dejaba medio folio vacío. El nuevo trae las métricas reales de Adobe, páginas que se derraman,
tablas que repiten cabecera al cambiar de folio, títulos que no se quedan huérfanos al pie, e
imágenes JPEG incrustadas con `/DCTDecode`.

Sin dependencias, y se verifica mirándolo: `scripts/qa/ver-pdf.mjs` lo renderiza en Chromium y saca
una captura por página. Tres de los fallos que tiene arreglados —el título huérfano, la cartera sin
mapa y un «Hay 1 traslapes»— no daban ningún error: salían en la hoja.

## La voz

Dr Electrum habla con **Bill**, la más veterana de las que probamos. La edad es parte del personaje
— a quien te va a decir que un recurso inferido no es una reserva se le cree más si suena a haberlo
visto. Se cambia con `ELECTRUM_VOZ`.

El respaldo **no** es la voz de ULTRON, y eso es deliberado: si la variable se queda vacía por un
descuido, más vale que el Doctor siga sonando a él que descubrir el error cuando ya está hablando
con la voz de la otra plataforma delante de un cliente. Hay una prueba que lo vigila.

La ruta también es propia (`/api/electrum/voz`). La ruta es aparte por una razón concreta: `/api/tts` está en la lista de
rutas abiertas de la APK, y un sintetizador abierto es una factura de ElevenLabs con la puerta
quitada.

El id de voz entra en la clave de la caché de audio. Sin eso, el primer cerebro que hablara dejaría
su timbre guardado y el otro contestaría con la voz ajena.

En la pantalla la voz **arranca apagada**: los navegadores no dejan sonar nada hasta que alguien
toca algo, y una demostración que empieza hablando sola en una sala de reunión es peor que una que
espera a que se lo pidan.


## Quién es Dr Electrum

Hasta ahora era ocho líneas dentro de `turno.ts`, y se le notaba: contestaba correcto y no era
nadie. Un asistente sin carácter es un buscador con modales, y a un buscador con modales no se le
discute un número — que es exactamente lo que esta plataforma necesita que pase.

El personaje no es adorno; es el mecanismo de honestidad del sistema. **La mentira que arruina
gente en minería casi nunca es un número inventado.** Es un número verdadero presentado como otra
cosa:

- un recurso **inferido** enseñado como reserva,
- una ley de **testigo** enseñada como ley de mina,
- un **valor in situ** enseñado como riqueza.

Un modelo amable deja pasar las tres, porque corregirlas suena a llevar la contraria. Un viejo del
oficio no las deja pasar, porque para él corregirlas **es** el trabajo. La personalidad
(`server/electrum/personalidad.ts`) está escrita para que decir «eso no es lo que ese número
significa» le salga natural y quedarse callado le resulte incómodo.

## Las emociones: más en el sistema, menos por cerebro

Suena al revés y es a propósito. Agregar emociones al **sistema** mejora; ofrecerle más al
**modelo** empeora: un 27B con quince opciones delante elige peor que uno con once. Y las que
sobran no son inocentes — si `travieso` está en la lista, tarde o temprano el doctor guiña mientras
te explica un traslape.

Así que **Dr Electrum tiene once emociones y ULTRON quince.** Se le quitan cantar, orar, la
travesura y la tristeza de la junta, y se le dan cuatro que ULTRON no necesita:

| Emoción | Cuándo | Voz | Cara |
|---|---|---|---|
| `escepticismo` | un número que no cuadra, un recurso vendido como reserva | `[skeptical]` | ceja levantada |
| `alarma` | riesgo real e inmediato: una presa, un talud, cianuro sin plan | `[urgently]` | preocupada |
| `firme` | un límite del oficio que no se negocia | `[firmly]` | serena |
| `seco` | dato operativo, medida, sin adorno | *(ninguna)* | serena |

`seco` no lleva etiqueta de audio a propósito: la sequedad se oye en lo que **no** se pone, y un
`[flatly]` delante de una medida suena a desgana, no a oficio. Y `firme` deja la cara serena en vez
de mapearla a enfado: el doctor sostiene un límite varias veces por conversación, y no puede
parecer molesto cada vez.

La paleta es del **cerebro**; la cara y la voz, que son **cuerpo**, saben expresarlas todas.
