# Índice Maestro de Capas (v1.4)

Cómo se armó `biblioteca/mapas/manifest.json`, la carpeta `s3://electrum-lotes-548380372606/mapas/`
y el `reporte_clasificacion.md` (todo copia: los originales de `lote-1/` no se tocan).

1. **En el nodo de carga** (archivos en `/datos/lote-1/listo`, base por `con-cerebro`):
   - `con-cerebro python3 clasificar.py` → `/root/indice/clasificacion.json`: cada SHP/KML/KMZ
     (también los que venían dentro de .zip/.rar) con su categoría del índice, su capa en la base,
     CRS, entidades, huella para duplicados; las hojas cartográficas con su extensión; los planos de
     cada proyecto; y los campos útiles para filtrar de cada capa (valores reales de la tabla).
   - `python3 empatar.py` → `/root/indice/empates.json`: lo que no casó por nombre se empata con
     la capa de la base de la misma extensión (el cargador no duplica el mismo contenido con otro nombre).
2. **Donde haya acceso al cubo**: `python3 manifiesto.py <carpeta>` con `clasificacion.json`,
   `empates.json` y el `indice.json` de teselas → `manifest.json`, `manifest.csv`,
   `reporte_clasificacion.md`, `copias.tsv` (origen → `mapas/…`) y `planos.tsv`.
3. Copiar con `aws s3 cp` según `copias.tsv` y `planos.tsv`, y subir `manifest.json` y
   `perimetro.geojson` a `s3://electrum-expedientes-548380372606/biblioteca/mapas/`.

El servidor lo lee en `server/electrum/indice-capas.ts` (`/api/electrum/mapa/indice`,
`/indice/capa/:id`, `/perimetro`, `/plano/:id`) y el frontal lo pinta en
`src-electrum/mapa/IndiceCapas.tsx`. Los IDs son permanentes: una capa nueva toma el siguiente
número libre de su grupo; nunca se reutiliza uno.

## Correcciones v1.0 (manifiesto v1.5)

`correcciones.py` toma el manifiesto v1.4 publicado y le agrega, sin cambiar ningún ID publicado:
`estilo` por capa (KML original, paleta por mineral o por unidad), `alias`, `sin_datos`,
`subgrupo` de los proyectos y la reclasificación de Otros a los proyectos 301000–304000 (con
`id_anterior` y la lista `retirados`). Lee los volcados del nodo (`atributos.json`,
`kmlestilos.json`, `iconos.json`, `leyendas.json`, `capa-ext.txt`) y deja `salida/manifest.json`
y `salida/correcciones.json`; `reporte_correcciones.py` arma el reporte. El resultado vive en el
repositorio (`manifest.json`, que prueba `tests/electrum-arbol-indice.test.ts`) y en el cubo
(`biblioteca/mapas/manifest.json`).
