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

## El mapa: los dos, con interruptor

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
| App: mapa doble, cara que cede el paso, expedientes, informes | pendiente |

| Generador de informes en PDF | base mínima ya existe (`lib/pdf.ts`) |
| Voz con el API nuevo | adaptador pendiente, a la espera del API |
| Bot de Telegram Dr Electrum FP | pendiente |

## Decisiones tomadas

- Mapa: MapLibre y Google, con interruptor.
- Datos: PostGIS propio en el nodo AWS.
- Cara: completa al arrancar, se encoge a un lado cuando se abre un mapa o un expediente.
