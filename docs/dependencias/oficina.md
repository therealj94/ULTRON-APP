# Ficha de adopción: generación de archivos de oficina (FILE-01 / FILE-02)

Auditoría maestra del 6-oct-2026, §8 (FILE-01, FILE-02) y §9 («Ficha de adopción obligatoria para cada dependencia
nueva»). Dos ensayos de «informe.docx, presupuesto.xlsx y carta.pdf» con la computadora del agente (Holo sobre
LibreOffice) llegaron a 31 pasos y unos 300 s sin guardar nada. La ruta nueva es **API antes que ratón**:

```
petición → especificación tipada (el modelo llena un esquema JSON)      lib/oficina/spec.ts
        → generación                                                    lib/oficina/generar.ts
        → temporal → RELECTURA del temporal                             lib/oficina/almacen.ts
        → validación estructural (tipo por dentro, ZIP/XML, sin macros ni enlaces de afuera)
        → validación semántica (todo el texto pedido; totales recalculados desde lo releído)   lib/oficina/validar.ts
        → render opcional con LibreOffice sin cabeza (perfil temporal, tope de tiempo)
        → confirmar bytes → lote durable «generado» → ficha «disponible» (una vez) → recibo   lib/oficina/entrega.ts
        → herramienta del cerebro `crear_documento` / `PEDIR_HERRAMIENTA: documento`          server/documentos.ts
        → descarga autenticada GET /api/documentos/:id (solo el dueño de la sesión)
```

Lo que ya existía y se reutiliza: `lib/pdf.ts` (el PDF sigue saliendo del escritor propio, sin biblioteca nueva),
`lib/leer-oficina.ts` (se le añadió `paginasDeDocx`; la relectura del .xlsx usa `paginasDeXlsx`), `lib/leer-pdf-pdfjs.ts`
(pdf.js vía `unpdf`, ya instalado), los validadores de `lib/entregables.ts` (cada cosa pedida es un requisito que se
cumple con SU archivo), `lib/durable.ts` (crear-una-vez, CAS, leases), `lib/tareas-durables.ts` (la tarea del panel),
`jszip` y `@xmldom/xmldom` (ya instalados).

Se añaden **dos** dependencias, fijadas a versión exacta en `package.json` (sin `^`):

| | `docx` | `exceljs` |
|---|---|---|
| Función concreta | Escribir el **.docx** (Word): títulos con estilo, viñetas, tablas con cabecera repetida, idioma es-HN, propiedades del documento | Escribir el **.xlsx** (Excel) con valores Y fórmulas, formatos de número y fila congelada; **releer** la hoja en la validación |
| Opción propia existente | Ninguna para escribir Word (solo había lectores) | Ninguna para escribir Excel (solo `paginasDeXlsx`, lector) |
| Repositorio oficial | https://github.com/dolanmiu/docx | https://github.com/exceljs/exceljs |
| Versión fijada | **9.8.1** (publicada 2026-09-28) | **4.4.0** (publicada 2023-10-19) |
| Licencia propia | MIT | MIT |
| Mantenimiento | Activo: 9.7.1 (may-2026), 9.7.2, 9.8.0 y 9.8.1 (sep-2026) | Lento: 4.3.0 (2021) → 4.4.0 (oct-2023); solo un prerelease 4.4.1 (dic-2024). Riesgo de abandono: por eso se usa detrás de un adaptador pequeño (`generar.ts`/`validar.ts`) |
| Node 22 / ESM | `"type": "module"` con `exports` ESM (`index.mjs`) y CJS (`index.cjs`): funciona con `tsx` (ESM) y con el bundle CJS de `esbuild --packages=external` | CommonJS (`excel.js`); `import ExcelJS from 'exceljs'` funciona en ESM (`tsx`) y en el bundle CJS. `engines: node >= 8.3` |
| Tipos | Incluidos | Incluidos (`index.d.ts`) |
| Permisos | Ninguno: CPU y memoria del proceso; no abre red ni disco | Ninguno en lo que usamos (`writeBuffer`/`load(buffer)` en memoria). Su lector/escritor *streaming* (no usado) escribe temporales con `tmp` |
| Datos enviados | Ninguno: todo es local | Ninguno |
| Coste medido | ≈9 KB por informe corto; generar + validar ≈0,1–0,2 s | ≈7 KB por presupuesto; generar + validar ≈0,2 s. El piloto de tres archivos completo: ≈0,5 s |
| Tamaño en disco | 8,8 MB (`node_modules/docx`) | 23 MB (`node_modules/exceljs`) + transitivas |

## Licencias transitivas (77 paquetes nuevos en `package-lock.json`)

Contadas sobre lo que `npm install` añadió al lock (nada existente cambió de versión):

- **MIT (59)**: `docx`, `xml`, `xml-js`, `nanoid@6`, `hash.js`, `exceljs`, `archiver@5`, `archiver-utils`, `zip-stream`,
  `compress-commons`, `crc32-stream`, `tar-stream`, `bl`, `readable-stream@3`, `unzipper@0.10`, `bluebird@3.4`,
  `buffer`, `base64-js`, `binary`… , `fast-csv`, `@fast-csv/*`, `dayjs`, `tmp@0.2.7`, `uuid@11.1.1` (override), los
  `lodash.*` sueltos, `@types/node@14` (anidado bajo `@fast-csv/*`, solo tipos).
- **ISC (9)**: `glob@7`, `minimatch@3/5`, `inflight`, `fs.realpath`, `fstream`, `rimraf@2`, `listenercount`, `minimalistic-assert`.
- **Apache-2.0 (2)**: `crc-32`, `readdir-glob`. **BSD-3-Clause (2)**: `duplexer2`, `ieee754`. **MIT/X11 (2)**: `chainsaw`,
  `traverse`. **Unlicense (1)**: `big-integer`. **BlueOak-1.0.0 (1)**: `sax` (permisiva).
- **Sin licencia declarada (1)**: `buffers@0.1.1` (transitiva de `unzipper → binary`; su `package.json` no trae campo
  `license` ni el README la menciona). Solo lo usa el lector *streaming* de ExcelJS, que AU-RA no llama. Riesgo legal
  menor, anotado; si molesta, la salida es la de abajo.
- `jszip` (MIT o GPL-3.0, a elección: se usa bajo MIT) ya estaba en el proyecto.

Todas son permisivas y compatibles con distribuir el servidor. Ninguna es copyleft.

## Vulnerabilidades / advisories (`npm audit`, 6-oct-2026)

- Al instalar, `npm audit` marcó **uuid < 11.1.1** (GHSA-w5hq-g745-h8pq, moderada: falta comprobar límites cuando se
  pasa `buf` a v3/v5/v6), traída por `exceljs`. ExcelJS solo llama `v4()` sin `buf` (no alcanzable), pero se corrigió
  igual con un **override** fijado: `"overrides": { "exceljs": { "uuid": "11.1.1" } }` (misma API `v4`, CJS y ESM).
- `docx@9.8.1` declara `@types/node ^26` como dependencia de producción: se fuerza a la del proyecto con
  `"overrides": { "docx": { "@types/node": "$@types/node" } }` (una sola copia de tipos, sin choques en `tsc`).
- Después de los overrides: **0 advisories** en los árboles de `docx` y `exceljs`. Lo que `npm audit` sigue mostrando
  (`pdfjs-dist`, alta; `source-map-js`, alta) ya estaba antes y no viene de estas dependencias. pdf.js solo relee aquí
  PDFs que generó el propio servidor (entrada confiable), con `isEvalSupported: false`.
- Paquetes deprecados en el árbol de ExcelJS (`inflight`, `glob@7`, `rimraf@2`, `fstream`, `lodash.isequal`): solo los
  carga el lector/escritor *streaming* y la exportación CSV, que no se usan. «Sin hallazgos» no es «seguro»: el riesgo
  real es el mantenimiento lento de ExcelJS (arriba).

## Seguridad del uso (no de la biblioteca)

- **Inyección de fórmulas**: ExcelJS solo crea una fórmula si se le pasa `{formula}`; aun así, todo texto del pedido que
  empiece por `=`, `+`, `-`, `@`, tabulador o retorno (y sus variantes de ancho completo) se escribe con un apóstrofo
  delante (`celdaSegura`). La validación rechaza cualquier fórmula que no sea una de las del presupuesto y cualquier
  texto que empiece como fórmula sin neutralizar.
- **ExcelJS no calcula fórmulas**: importes, subtotal, descuento, impuesto y total se calculan en código, en centavos
  enteros (`calcularTotales`, igual que `ROUND(;2)`), y se escriben como valor de la celda junto con su fórmula
  (`fullCalcOnLoad` para que Excel/LibreOffice recalculen al abrir). La validación relee la hoja con ExcelJS, vuelve a
  calcular desde las cantidades y precios releídos, y además comprueba con `paginasDeXlsx` (otro lector, sin ExcelJS)
  que el total escrito está en el XML. Un `total_declarado` que no cuadra no se entrega.
- **Estructura**: tipo por dentro (bytes mágicos), partes obligatorias del ZIP, cada XML bien formado, sin
  `vbaProject.bin`/ActiveX/binarios, sin relaciones `TargetMode="External"`; el PDF con `startxref`, `%%EOF`, páginas y
  sin `/JavaScript`, `/Launch` ni archivos incrustados.
- **Render (opcional)**: `AURA_OFICINA_RENDER=1` en el turno; LibreOffice sin cabeza con perfil propio temporal
  (`-env:UserInstallation`), `HOME` temporal, `--norestore --nodefault`, tope de 45 s con `SIGKILL`, carpeta borrada al
  final. No aísla la red: los archivos que entran ahí son los nuestros, ya comprobados sin enlaces de afuera. Sin
  LibreOffice el recibo dice «omitido»; con un LibreOffice sin Writer/Calc (solo el núcleo, como el contenedor de
  desarrollo) dice «fallido» con el porqué. El render de LibreOffice no es idéntico al de Microsoft Office.
- **Descarga**: `GET /api/documentos/:id` con la sesión firmada (cabecera, como el resto de la app); la ficha vive bajo la
  huella del dueño (otra cuenta = 404, igual que un id inventado), MIME real del tipo, nombre saneado (ASCII + RFC 5987),
  `nosniff`, `Cache-Control: private, no-store`, sha256 de los bytes igual al comprobado (si no, 409), tamaño ≤ 8 MB,
  retención `AURA_DOCUMENTOS_DIAS` (7 por defecto; vencido = 410 y se borran los bytes). Bytes en S3
  (`ultron/documentos/`, conviene regla de ciclo de vida) o en `ULTRON_DOCUMENTOS_DIR`/`data/documentos/`.
- **Modo invitado**: no se ofrece (`manosDeInvitado` → `documentos: false`; sin sesión el runner no hace nada).

## Pruebas de integración

- `tests/oficina-spec.test.ts` — nombres saneados, números, totales en centavos, inyección de fórmulas, errores con su porqué.
- `tests/oficina-validar.test.ts` — genera y relee los tres tipos; detecta ZIP cortado, tipo cambiado, total alterado,
  fórmula colada, enlace de afuera, XML roto, párrafo faltante, caracteres que el PDF no puede mostrar; render.
- `tests/oficina-piloto.test.ts` — **FILE-02**: los tres entregables y sus repeticiones (interrupción, temporal dañado,
  cantidad insuficiente, crash entre generar y entregar sin entrega duplicada, mismo id con otro contenido), en memoria y en disco.
- `tests/oficina-herramienta.test.ts` — la herramienta nativa → línea → harness → runner, la tarea enlazada al turno, el
  reintento del mismo turno, y la ruta de descarga (dueño 200, otra cuenta 404, sin sesión 401).

## Presentaciones (.pptx) con PptxGenJS

La auditoría lo dejaba «opcional, solo si se prueba». Ahora se prueba y se adopta, con su propio validador y su piloto
(`tests/oficina-pptx.test.ts`). AU-RA hace presentaciones con la misma vara que Word, Excel y PDF:

```
crear_documento {tipo:"pptx", nombre, spec}   (o PEDIR_HERRAMIENTA: documento)       lib/cerebro-manos.ts, lib/harness.ts
  → especificación: diapositivas con tipo, topes de legibilidad            lib/oficina/spec.ts (validarPresentacion)
  → «de 8 diapositivas» dicho por la persona = requisito de contenido      lib/entregables.ts diapositivasPedidas
                                                                           + lib/oficina/entrega.ts conDiapositivasPedidas
  → PptxGenJS + diseño fijo (tema, tipografía, numeración, notas)          lib/oficina/pptx.ts
  → estructura + relectura diapositiva por diapositiva                     lib/oficina/validar.ts (semanticaPptx)
  → render opcional (LibreOffice Impress: una página por diapositiva) → recibo → descarga, igual que los demás
```

**Lo que pide el modelo** (`spec`): `{titulo, subtitulo?, autor?, tema?: azul|verde|grafito|vino, diapositivas: [...]}`.
Cada diapositiva tiene `tipo` y `titulo` (en la cita es opcional) y, según el tipo: `portada`/`cierre` (subtítulo),
`vinetas` (hasta 8, de hasta 220 caracteres), `dos_columnas` (exactamente 2 `{titulo?, vinetas}` de hasta 6), `tabla`
(`{cabecera, filas}`, hasta 6 columnas y 10 filas), `cifras` (1 a 4 `{valor, etiqueta}`), `grafico`
(`{tipo: barras|lineas|pastel, categorias, series: [{nombre, valores}], unidad?}`, hasta 12 categorías y 4 series; el
pastel, una serie de hasta 8 valores no negativos), `cita` (`{texto, autor?}`); `notas` (del orador) en cualquiera. Lo
que no cabe legible se rechaza con el porqué («divídela en dos diapositivas»); nada se encoge hasta no leerse ni se corta
en silencio. Si la persona dijo «de 8 diapositivas» y la especificación trae otro número, ese archivo no se hace y el
recibo lo dice para que el modelo lo rehaga.

**El diseño lo pone el código**, siempre igual: 16:9, Arial (segura: Windows, macOS y Liberation Sans con las mismas
medidas en Linux/LibreOffice), títulos de 30 pt y texto de 18 pt o más; cuatro temas sobrios donde cada par texto/fondo
cumple el contraste AA de WCAG (≥ 4,5:1) y cada color de serie ≥ 3:1 (la prueba lo calcula); el título de cada
diapositiva en el marcador de TÍTULO (idx 0: lo encuentran PowerPoint, los lectores de pantalla y python-pptx), idioma
es-HN en todo el texto (también en las notas), numeración en todas menos portada y cierre, el título de la presentación
al pie, gráficos nativos (editables en PowerPoint) con texto alternativo que lleva TODOS sus datos.

**La validación** (además de la de todo OOXML: ZIP entero, partes obligatorias, XML bien formado, sin `vbaProject.bin`,
ActiveX ni binarios, sin relaciones `TargetMode="External"`):

- estructura: `ppt/presentation.xml` y sus relaciones; cada diapositiva de la lista `sldIdLst` existe (una diapositiva
  faltante es un defecto); nada declarado `macroEnabled`; ningún objeto OLE; lo único incrustado que se acepta es el
  libro de datos de un gráfico (`ppt/embeddings/*.xlsx`), revisado por dentro (entero, sin macros, sin enlaces de afuera);
- relectura con `paginasDePptx` (lib/leer-oficina.ts, el lector de lo que LLEGA, sin código en común con PptxGenJS):
  el número de diapositivas (y el que pidió la persona), cada título, viñeta, cifra y cita en SU diapositiva y en su
  orden, las notas del orador;
- desde el XML: cada tabla con sus filas, columnas y el texto de cada celda; cada gráfico con su tipo, sus series,
  categorías y valores; la numeración; el título en su marcador; el texto alternativo; título en las propiedades; es-HN;
- render (opcional, `AURA_OFICINA_RENDER=1`): LibreOffice con Impress lo pasa a PDF y tiene que dar una página por
  diapositiva; sin LibreOffice, «omitido»; sin Impress (solo el núcleo), «fallido» con el porqué. Nunca bloquea.

**Ficha de la dependencia** (fijada a versión exacta en `package.json`, sin `^`):

| | `pptxgenjs` |
|---|---|
| Función concreta | Escribir el **.pptx**: patrones con marcador de título y numeración, texto con viñetas, tablas, gráficos nativos (barras, líneas, pastel) con su libro de datos, notas del orador, propiedades |
| Opción propia existente | Ninguna para escribir PowerPoint (solo `paginasDePptx`, lector) |
| Repositorio oficial | https://github.com/gitbrent/PptxGenJS |
| Versión fijada | **4.0.1** (publicada 2025-06-26; la 4.0.0 es de mayo de 2025, la 3.12.0 de 2023) |
| Licencia propia | MIT |
| Node 22 / ESM | `exports` con ESM (`pptxgen.es.js`) y CJS (`pptxgen.cjs.js`): funciona con `tsx` y con el bundle CJS de `esbuild --packages=external`. **Sin navegador**: detecta Node y escribe con `write({outputType: 'nodebuffer'})` |
| Tipos | Incluidos (`types/index.d.ts`) |
| Permisos | Ninguno en lo que usamos: CPU y memoria. Solo carga `node:fs`/`node:https` para imágenes o medios por ruta/URL, que AU-RA no usa (y la validación rechaza cualquier relación de afuera) |
| Datos enviados | Ninguno |
| Coste medido | La presentación de 8 diapositivas de la prueba (tabla, gráfico, cifras, cita, notas): ≈47 KB; generar ≈0,14 s, validar ≈0,15 s; render con LibreOffice Impress ≈1,5–2 s |
| Tamaño en disco | 2,6 MB (`node_modules/pptxgenjs`) + 0,5 MB (`image-size`) |

Retoque propio tras generar (`retocar` en lib/oficina/pptx.ts, sin tocar el contenido): PptxGenJS pone `idx="101"` al
marcador de título (los lectores que buscan el título por idx 0 no lo veían), marca las notas en-US y declara en
`[Content_Types].xml` patrones que no existen; las tres cosas se corrigen al reempaquetar.

Transitivas nuevas en `package-lock.json` (3; `jszip` y `@types/node` ya estaban y se deduplican):

- **`https@1.0.0`** (ISC): es SOLO un `package.json` (sin código, sin scripts de instalación; revisado el tarball). Node
  siempre resuelve `https`/`node:https` a su módulo propio, así que nunca se carga. Es mala higiene del autor de
  PptxGenJS, no un riesgo; anotado.
- **`image-size`** (MIT): PptxGenJS 4.0.1 lo declara pero su `dist` no lo importa (la función que lo usaba está
  comentada). `npm audit` marcaba `image-size` ≤ 2.0.2 (GHSA-5p2g-fcmc-qvqq y GHSA-w3rx-r6r6-pgpr, alta: bucles infinitos
  con JXL/HEIF/ICNS); aunque no es alcanzable, se fuerza a la corregida con un override fijado:
  `"overrides": { "pptxgenjs": { "image-size": "2.0.4" } }`. Después: **0 advisories** en el árbol de PptxGenJS (lo que
  `npm audit` sigue mostrando, `pdfjs-dist` y `source-map-js`, ya estaba).

Salida: `npm uninstall pptxgenjs`, quitar el override, `lib/oficina/pptx.ts`, la rama `pptx` de `generarArchivo` y
`semanticaPptx`, y `'pptx'` de `TIPOS_ARCHIVO` (el esquema vuelve a rechazarlo con un mensaje claro); o sustituirla
reescribiendo solo `generarPptx` (p. ej. ZIP+XML propio sobre `jszip`): la especificación, la validación, la entrega y
la descarga no cambian.

## Pruebas de las presentaciones

- `tests/oficina-pptx.test.ts` — la especificación y sus rechazos con porqué; el contraste AA de los cuatro temas; una
  presentación realista de 8 diapositivas (tabla, gráfico, cifras, dos columnas, cita, notas) generada y releída entera;
  un **segundo lector independiente** (python-pptx si hay un Python con `pptx` —`PYTHON_PPTX=/ruta/python`—, si no un
  parseo DOM propio con @xmldom) que comprueba títulos, tabla celda por celda, series y valores del gráfico, notas y
  16:9; barras, líneas y pastel; lo malo que se caza (ZIP cortado, diapositiva faltante, enlace de afuera, macros, tipo
  `macroEnabled`, objeto OLE, libro incrustado con enlace externo, un docx disfrazado, viñeta/celda/fila/valor del
  gráfico/numeración/título/orden alterados, una diapositiva menos); el render (omitido sin LibreOffice; con Impress,
  8 páginas); los requisitos («una presentación de 8 diapositivas» es una presentación con 8; «presentación en
  PowerPoint» es una sola); la entrega (8 pedidas y 8 hechas = completo; 8 pedidas y 6 en la especificación = no se
  hace, con el porqué); la herramienta para el modelo; y de punta a punta: crear_documento → línea → harness → runner →
  recibo → descarga con sesión (MIME, nombre saneado, sha256) y con el enlace firmado de la tarjeta.

## Salida / rollback

1. Apagar sin desinstalar: quitar `documentos: !!duenoComputadora` de `manosTurno` en `server.ts` (o ponerlo en
   `false`) y la línea `conSesion ? INSTRUCCION_DOCUMENTO : ''` de `lib/harness.ts`. El modelo deja de ver la
   herramienta; lo ya entregado se sigue pudiendo bajar hasta que venza.
2. Quitar del todo: `npm uninstall docx exceljs pptxgenjs`, borrar el bloque `overrides` de `package.json`, `lib/oficina/`,
   `server/documentos.ts`, la ruta `montarRutasDocumentos` y el runner `documento` en `server.ts`, y los cinco
   `tests/oficina-*.test.ts`. Nada más depende de ellas (el PDF sigue siendo `lib/pdf.ts`).
3. Sustituir solo una: el resto del pipeline (especificación, validación, entrega, descarga) no cambia; se reescribe
   `generarDocx` o `generarXlsx`/`semanticaXlsx` (p. ej. con un ZIP+XML propio sobre `jszip`, ya instalado).
