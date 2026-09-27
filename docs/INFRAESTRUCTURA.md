# Infraestructura de Dr Electrum: qué sabe y cómo mantenerlo

Pestaña **Infraestructura** del panel de Dr Electrum. Muestra todo lo que el sistema tiene cargado, en carpetas y con su estado. Desde ahí se agrega, se ordena, se relee y se borra.

## Lo que se ve

- **Cifras**:
  - documentos y capas;
  - texto indexado;
  - carpetas;
  - lo que necesita atención;
  - cuánto tiene su original guardado.
- **Carpetas** en árbol, más tres vistas fijas: *Todo*, *Necesitan atención* y *Sin carpeta*.
- **Estado de cada pieza**, calculado de lo que hay de verdad en la base:

| Estado | Qué significa | Qué hacer |
| --- | --- | --- |
| bien | Leído entero y citable | — |
| sin texto | Ni un fragmento: casi siempre un escaneo | Pasarlo por OCR y releer |
| cortado | ~8 000 caracteres justos: el tope viejo de lectura de PDF | Releer desde el original |
| poco texto | Menos de 400 caracteres por página | Revisar; si es escaneo, OCR |
| repetido | Otro documento con el mismo nombre | Borrar el que sobra o renombrar |
| vacía | Capa sin geometrías | Borrar o volver a subir |

- **Detalle** (clic en una pieza):
  - páginas con texto;
  - fragmentos;
  - búsqueda por significado;
  - tipo según Laya;
  - dónde está el original;
  - un vistazo a cómo quedó leído.

## Quién puede qué

| Acción | Nivel |
| --- | --- |
| Mirar todo, bitácora, importaciones | cualquiera que entre a Dr Electrum |
| Subir, mover, renombrar, carpetas, releer | trabajo |
| Eliminar, importar desde el cubo | mando |

Cada cambio queda en la **bitácora**: quién, qué y cuándo.

## Formatos que lee

- **Documentos:**
  - PDF, con pdf.js, página por página;
  - Word `.docx` y `.doc` (97-2003);
  - `.rtf`;
  - PowerPoint `.pptx`: una página por diapositiva, con sus notas;
  - Excel `.xlsx`: una página por hoja;
  - `.txt` y `.md`.
- **Mapa:**
  - shapefile (las partes se agrupan solas);
  - KML y KMZ;
  - GeoJSON y CSV.
- **Fotos:** por el modelo de visión, solo si se pide.

## Importar una carpeta del cubo

1. Subir la carpeta con la página de carga. Queda en `entrada/<carpeta>/` del cubo `ELECTRUM_EXPEDIENTES_BUCKET`.
2. En Infraestructura, ir a **Importar del cubo** → elegir la carpeta → **Importar**.

Cómo trabaja la importación:

- **Dónde corre:** en un **trabajo de Render** aparte (`node dist/importar-cubo.cjs <id>`, plan `ELECTRUM_IMPORTAR_PLAN`, por defecto `standard`). El servicio web tiene 512 MB y sigue contestando mientras entran miles de archivos. El avance queda en la tabla `importacion` y el panel lo muestra.
- **Carpetas:** cada archivo cae en la carpeta del panel que corresponde a su carpeta de origen.
- **Duplicados:** lo que ya estaba (misma huella) no se duplica. Lo que no tenía carpeta ni original, los adopta.
- **Reanudable:** lo ya importado tiene su original anotado (`archivo = s3://…`) y se salta sin bajarlo. Si se corta, «retomar» sigue donde quedó.
- **Omitidos, siempre con motivo:**
  - acompañantes de SIG (`.sbn`, `.lyr`, `.mxd`, `.qgz`…);
  - temporales de Office;
  - `.rar` (hay que abrirlo antes);
  - `.xls` y `.ppt` viejos;
  - archivos de más de 64 MB;
  - imágenes, salvo que se pida leerlas.
- **Escaneos sin texto:** quedan anotados como **sin texto**, con su original, para releerlos cuando pasen por OCR.

## Lo que sube la pantalla también queda

Si `ELECTRUM_EXPEDIENTES_BUCKET` está puesto, `/api/electrum/subir` guarda el original en `biblioteca/AAAA-MM/…` del cubo. Por eso todo lo que se sube de ahora en adelante se puede **releer**.

## Variables y permisos

- `ELECTRUM_EXPEDIENTES_BUCKET`: cubo de expedientes.
- `ELECTRUM_IMPORTAR_PLAN`: plan del trabajo de importación: `starter`, `standard` (por defecto), `pro` o `pro_plus`. La API de Render pide el id interno (`plan-srv-008` es el estándar, 2 GB), y el servidor lo traduce.
- `ELECTRUM_IMPORTAR_EN_PROCESO=1`: importa dentro del servidor. Solo para desarrollo y pruebas.
- **IAM** (política `expedientes-electrum` del usuario del servicio):
  - `GetObject` sobre `entrada/*` y `biblioteca/*`;
  - `PutObject` solo sobre `biblioteca/*`;
  - `ListBucket` limitado a esos prefijos.
  - Nunca `DeleteObject`: borrar en el panel no toca los originales.
- **Esquema:** v9 (`scripts/electrum/esquema.sql`). El servidor lo aplica solo al arrancar.
