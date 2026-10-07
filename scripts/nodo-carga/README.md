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
- **Rásteres** (`.tif`, `.ecw`, `.jp2`, `.img`…): no van a la base. Se convierten a PMTiles y se publican en
  `biblioteca/teselas/` (ver `server/electrum/teselas.ts`).
- **Comprimidos rotos o con clave**.

## Antes de cargar 26 GB, mirar

- **Disco del cerebro**: el volumen es de 120 GB. El texto de 26 GB de expedientes son pocos GB, pero cada
  fragmento lleva un vector de 1024 dimensiones (~4 KB más su índice HNSW). Comprobar `df -h` y el tamaño
  de la base antes, y tener una copia.
- **Los lotes van a su propio cubo**, `electrum-lotes-548380372606` (privado, cifrado, solo TLS). Los
  conserva: solo limpia subidas multiparte cortadas a los 7 días. El cubo de trasvase
  (`electrum-expedientes-…`) en cambio borra TODO a los 60 días —su regla `limpiar-trasvase` tiene el prefijo
  vacío y alcanza también a `biblioteca/`—; `cargar-lote s3://…/entrada/x/` sigue sirviendo para lo de ahí.
- **Coste**: m6i.2xlarge ≈ 0,38 USD/h encendido. Apagado solo se paga el disco (200 GB gp3 ≈ 16 USD/mes);
  destruido, nada.

## Permisos del nodo (rol `electrum-carga`)

- `AmazonSSMManagedInstanceCore` para entrar por SSM.
- Leer el cubo de lotes y `entrada/*` y `nodo-carga/*` del de trasvase. No puede borrar ni escribir en ninguno.
- `ssm:StartSession` solo hacia el cerebro y solo con los dos documentos de reenvío de puerto: puede abrir
  los túneles, pero no una consola.

La clave de la base no se guarda en el nodo: se teclea en cada carga, o va en `ELECTRUM_CLAVE_DB` solo para
esa terminal.
