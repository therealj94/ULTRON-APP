# Nodo de carga de Dr Electrum

Una máquina de EC2 de usar y apagar para meter lotes grandes (decenas de GB) en el cerebro de Dr Electrum
sin pasar por el panel ni por tu computadora.

## Por qué hace falta

| Camino | Tope que rompe un lote de 26 GB |
|---|---|
| Panel → «Subir» (`POST /api/electrum/subir`) | 64 MB por archivo, todo en la memoria de Render (512 MB) |
| Panel → «Importar del cubo» (Job de Render) | 64 MB por archivo, 20.000 objetos por listado, 0,5–8 GB de memoria |
| `cargar.sh` desde tu computadora | bajar 26 GB de S3 y empujar el texto por un túnel durante horas |
| Cargar en el nodo del cerebro (A10G) | le quita memoria y núcleos a Qwen, la base y los embeddings en producción |

El nodo de carga vive en la misma región y zona que el cubo y el cerebro: baja de S3 a velocidad de red
interna, hace el OCR con todos sus núcleos y llega a la base y a los embeddings del cerebro por **túneles de
SSM** (el mismo camino que `scripts/electrum/cargar.sh`). No abre ningún puerto y no toca la red del cerebro.
Al cerebro solo llega texto: el PDF no se guarda en la base.

```
 tu PC ──aws s3 sync──▶ s3://electrum-lotes-548380372606/<lote>/
                                   │ (red interna)
                                   ▼
                       nodo de carga (m6i.2xlarge, 200 GB)
              abre zip/rar · aparta rásteres y SHP gigantes · OCR en paralelo
                    │ túnel SSM :5432            │ túnel SSM :8794
                    ▼                            ▼
          PostGIS + pgvector (cerebro)     TEI bge-m3 (cerebro)
                    ▲
          Render (Dr Electrum, MCP) lee de aquí
```

## Uso

Desde tu computadora, con la CLI de AWS y credenciales de administrador de la cuenta:

```bash
# 1. Crear el nodo (rol, grupo sin entrada, máquina; ~5 min hasta que queda preparado)
scripts/nodo-carga/nodo.sh crear

# 2. Subir el lote al cubo. Se puede cortar y relanzar; maneja archivos de más de 5 GB.
aws s3 sync /ruta/a/los/26gb s3://electrum-lotes-548380372606/<lote>/

# 3. Entrar y cargar
scripts/nodo-carga/nodo.sh entrar
sudo -i
tmux new -s carga            # si se corta la consola, `tmux attach -t carga`
cargar-lote <lote>           # pide la clave de la base (está en el cerebro, /root/electrum-db-url)

# 4. Al terminar
scripts/nodo-carga/nodo.sh apagar      # o destruir
```

`cargar-lote` hace, en orden y relanzable: bajar → inventario por tipo → copia de trabajo con los zip/rar/7z
abiertos y lo intragable apartado → túneles → ensayo (`--seco`) → OCR en paralelo de los escaneos → carga →
vectores pendientes. Todo queda en `/datos/<lote>/informe/`: `inventario.txt`, `ensayo.log`, `carga.log`
y `aparte.txt`, que dice qué no entró y por qué.

Lo que se aparta a propósito, y qué hacer con ello:

- **Shapefiles de más de 300 MB**: el cargador los lee enteros en memoria. Si son catastro, partirlos con
  `ogr2ogr`; si son relieve o curvas de nivel, van como teselas.
- **Rásteres** (`.tif`, `.ecw`, `.jp2`, `.img`…): no van a la base. Los convierte `teselas-lote` (abajo).
- **Comprimidos rotos o con clave**.

## Antes de cargar 26 GB, mirar

- **Disco del cerebro**: el volumen es de 120 GB. El texto de 26 GB de expedientes son pocos GB, pero cada
  fragmento lleva un vector de 1024 dimensiones (~4 KB más su índice HNSW). Comprobar `df -h` y el tamaño
  de la base antes, y tener una copia.
- **Los lotes van a su propio cubo**, `electrum-lotes-548380372606` (privado, cifrado, solo TLS). Los
  conserva: solo limpia subidas multiparte cortadas a los 7 días. En el cubo de trasvase
  (`electrum-expedientes-…`) caducan a los 60 días `entrada/` y `tmp-claude/` (hasta el 8-oct-2026 la regla
  tenía el prefijo vacío y alcanzaba también a `biblioteca/`); `cargar-lote s3://…/entrada/x/` sigue sirviendo
  para lo de ahí.
- **Coste**: m6i.2xlarge ≈ 0,38 USD/h encendido. Apagado solo se paga el disco (200 GB gp3 ≈ 16 USD/mes);
  destruido, nada.

## Permisos del nodo (rol `electrum-carga`)

- `AmazonSSMManagedInstanceCore` para entrar por SSM.
- Leer el cubo de lotes y `entrada/*` y `nodo-carga/*` del de trasvase. No puede borrar ni escribir en ninguno.
- `ssm:StartSession` solo hacia el cerebro y solo con los dos documentos de reenvío de puerto: puede abrir
  los túneles, pero no una consola.

La clave de la base no se guarda en el nodo: se teclea en cada carga, o va en `ELECTRUM_CLAVE_DB` solo para
esa terminal.

## Rásteres → teselas del mapa (`teselas-lote`)

Las hojas cartográficas y los mapas georreferenciados no van a la base: se convierten en PMTiles y salen como
capas del mapa de Dr Electrum, igual que los de JICA y Sentinel-2.

```bash
teselas-lote lote-1                                      # convierte y deja todo en /datos/lote-1/teselas
teselas-lote lote-1 --mosaico "HOJAS CARTOGRAFICAS"      # las hojas de esa carpeta, cosidas en una capa
teselas-lote lote-1 --mosaico "HOJAS CARTOGRAFICAS" --publicar
```

- Aparta (con la razón, en `informe/teselas-apartados.txt`) lo que no tiene georreferencia y lo que no es imagen
  de 8 bits, como un modelo de elevación.
- Web Mercator, WebP, hasta zoom 15 (`ZOOM_MAX`). Una hoja 1606 de 0,5 GB quedó en 209 MB, zoom 9 a 15.
- `--publicar` sube a `biblioteca/teselas/` y **fusiona** `indice.json`: lo que ya estaba se queda y antes se guarda
  `indice.antes-<fecha>.json` en el cubo para volver atrás. Dr Electrum relee el índice cada 5 minutos.
- `biblioteca/` ya no caduca: desde el 8-oct-2026 la regla de 60 días del cubo de trasvase alcanza solo a
  `entrada/` y `tmp-claude/`.

## Curvas de nivel (`curvas-lote`)

```bash
curvas-lote lote-1          # el shapefile de curvas del lote → PMTiles vectorial (tippecanoe)
teselas-lote lote-1 --publicar
```

Un millón de líneas de 20 m no van a la base: van como teselas vectoriales, con su cota. De lejos solo las
maestras (cada 100 m), desde el zoom 13 todas, rotuladas. En el mapa salen en la sección «Relieve» del control
de capas (necesita el soporte de líneas de `Mapa.tsx`, que entra con el mismo cambio).

## La clave de la base, sin que pase en claro

`cargar-lote` la toma de `ELECTRUM_CLAVE_DB`, o de `/root/.electrum/db-url` (600), o la pregunta. Para dejarla
en el nodo sin teclearla: el nodo genera un par de llaves, el cerebro cifra `/root/electrum-db-url` con la
pública (RSA-OAEP) y el nodo la descifra. Por SSM solo viajan la llave pública y el texto cifrado.
