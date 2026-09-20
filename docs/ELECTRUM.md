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

El enrutador es determinista (tabla de disparo por tema) y además el modelo puede pedir a uno por su
nombre. Eso lo hace predecible y probable con pruebas.

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

## Las manos

El harness ya existe (`PEDIR_HERRAMIENTA:`) con `web`, `leer`, `sistema` y `ejecutor`. Se extiende:

```
PEDIR_HERRAMIENTA: mapa <volar a … | mostrar capa … | medir …>
PEDIR_HERRAMIENTA: catastro <consulta por nombre, titular, municipio o mineral>
PEDIR_HERRAMIENTA: gis <traslapes | área | distancia | punto dentro>
PEDIR_HERRAMIENTA: calculo <cuenta de mina>      (ya existe, de lib/minas)
PEDIR_HERRAMIENTA: expediente <buscar en los documentos subidos>
PEDIR_HERRAMIENTA: informe <generar PDF>
```

## Estado

| Pieza | Estado |
|---|---|
| Motor GIS: ingesta, reproyección, área elipsoidal, traslapes | **hecho y probado** |
| Fixtures de catastro en UTM 16N | **hecho** |
| Esquema PostGIS, instalador y capa de acceso | **hecho y probado contra una base real** |
| Panel de especialistas + conocimiento Electrum | pendiente |
| Manos nuevas en el harness | pendiente |
| App: mapa doble, cara que cede el paso, expedientes, informes | pendiente |
| Indexado de documentos con cita a página | pendiente |
| Generador de informes en PDF | base mínima ya existe (`lib/pdf.ts`) |
| Voz con el API nuevo | adaptador pendiente, a la espera del API |
| Bot de Telegram Dr Electrum FP | pendiente |

## Decisiones tomadas

- Mapa: MapLibre y Google, con interruptor.
- Datos: PostGIS propio en el nodo AWS.
- Cara: completa al arrancar, se encoge a un lado cuando se abre un mapa o un expediente.
