# Subir los expedientes

## La manera fácil: la página suelta

`scripts/electrum/pagina-subida.mjs` genera un archivo HTML que se abre en el navegador, se le
arrastra la carpeta y sube. **No necesita servidor, ni la CLI de AWS, ni que quien la usa maneje
ninguna credencial.**

```bash
AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… node scripts/electrum/pagina-subida.mjs
```

Escribe `subir-expedientes.html`. Ese archivo se le pasa a quien vaya a subir.

Lo que lleva dentro es una **política POST firmada**, no una clave. Un permiso de un solo uso
concreto —dejar archivos en este bucket, bajo este prefijo, hasta esta fecha— del que no se puede
deducir el secreto que lo firmó ni usarlo para otra cosa. Si la página se filtra, lo peor que puede
hacer quien la tenga es dejar archivos en un bucket que caduca solo. Dura seis días, que es el
máximo que AWS permite para estas firmas menos un margen.

La página:

- Acepta **carpetas enteras**, arrastradas o elegidas con el botón. Arrastrar una carpeta no da
  archivos en `dataTransfer.files`: hay que recorrer las entradas a mano, y sin eso soltar una
  carpeta no hace nada y parece que la página está rota.
- Sube **directo a S3**, sin pasar por Render. Sin límite de tamaño de petición y sin gastar ancho
  de banda del servicio.
- **Se puede cortar y reanudar.** Lo ya subido se recuerda y se salta; volver a soltar la misma
  carpeta reintenta solo lo que falta. Con gigabytes la subida se corta, y esto es la diferencia
  entre continuar y empezar de cero.
- Reintenta tres veces cada archivo antes de darlo por fallido, y al final lista los que fallaron.
- Conserva la estructura de carpetas, que después sirve: la ruta de un expediente dice de qué
  concesión es.

## Después

```bash
./scripts/electrum/cargar.sh s3://electrum-expedientes-548380372606/entrada/
```

Baja, abre el túnel al nodo por SSM, ensaya sin escribir nada, enseña qué entraría, pregunta y
carga. Ver [ELECTRUM.md](ELECTRUM.md).

## Qué NO hace falta

- **No hay que convertir, renombrar ni comprimir nada.** Los PDF van tal cual.
- **No hay que separar lo geográfico de los documentos.** Se distingue solo por la extensión.
- **No hay que hacer OCR todavía.** Primero se mide cuántos lo necesitan; hacerlo a ciegas sobre
  todo el lote es caro y lento para nada.
- **No hay que evitar los duplicados.** Cada documento lleva la huella de su contenido y lo repetido
  se salta al indexar, aunque llegue con otro nombre.

## El bucket

`electrum-expedientes-548380372606`, en `us-east-1`. Acceso público bloqueado por los cuatro lados,
AES256 en reposo, caducidad a 60 días y limpieza de subidas a medias a los 7.

Es un **trasvase**, no un archivo: los documentos se dejan ahí para que Dr Electrum les extraiga el
texto una vez, y después se vacía. La caducidad está justamente para que no se use como copia de
seguridad.

## Si se prefiere la línea de comandos

Hay un usuario de IAM, `electrum-subida`, que solo puede escribir en ese bucket. Comprobado con el
simulador de políticas de IAM, no de palabra:

| acción | sobre el bucket de trasvase | sobre otro bucket |
|---|---|---|
| `s3:ListBucket` | permitida | — |
| `s3:PutObject` | permitida | **denegada** |
| `s3:GetObject` | **denegada** | **denegada** |
| `s3:DeleteObject` | **denegada** | — |

```bash
aws iam create-access-key --user-name electrum-subida     # el secreto se muestra una sola vez
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=us-east-1
aws s3 sync /ruta s3://electrum-expedientes-548380372606/entrada/ --only-show-errors
aws iam delete-access-key --user-name electrum-subida --access-key-id …   # al terminar
```

`sync` y no `cp`: relanzarlo continúa en vez de empezar de cero.
