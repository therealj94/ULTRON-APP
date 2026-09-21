# Subir los expedientes al bucket de trasvase

Instrucciones para quien haga la subida —persona u otra IA—. Son completas: no hace falta nada de
lo que se habló antes en ninguna conversación.

## Qué es esto y qué no

Un bucket de **trasvase**, no de archivo. Los documentos se dejan ahí para que Dr Electrum los lea
una vez, les extraiga el texto y lo indexe; después el bucket se puede vaciar. Tiene caducidad
automática a 60 días justamente por eso: no es una copia de seguridad y no debe usarse como tal.

- **Bucket:** `electrum-expedientes-548380372606`
- **Región:** `us-east-1`
- **Cuenta:** `548380372606`
- Acceso público bloqueado por los cuatro lados, cifrado en reposo AES256, caducidad a 60 días y
  limpieza de subidas a medias a los 7.

## La credencial

Hay un usuario de IAM, `electrum-subida`, que **solo puede escribir en ese bucket**. No puede leer
lo que hay dentro, ni tocar otro bucket, ni nada más en la cuenta. Si esa credencial se filtra, lo
peor que puede hacer quien la tenga es dejar basura en un bucket que caduca solo.

Comprobado con el simulador de políticas de IAM, no de palabra:

| acción | sobre el bucket de trasvase | sobre otro bucket |
|---|---|---|
| `s3:ListBucket` | permitida | — |
| `s3:PutObject` | permitida | **denegada** |
| `s3:AbortMultipartUpload` | permitida | — |
| `s3:GetObject` | **denegada** | **denegada** |
| `s3:DeleteObject` | **denegada** | — |

Escribir sí, leer no, borrar no. Es todo lo que `aws s3 sync` necesita para subir.

Usar esa y no las claves de administrador de la cuenta. La clave se genera una vez:

```bash
aws iam create-access-key --user-name electrum-subida
```

Devuelve `AccessKeyId` y `SecretAccessKey`. El secreto **se muestra una sola vez**.

Cuando la carga termine, se borra:

```bash
aws iam delete-access-key --user-name electrum-subida --access-key-id <la-que-se-creó>
```

## La subida

```bash
export AWS_ACCESS_KEY_ID=<AccessKeyId de electrum-subida>
export AWS_SECRET_ACCESS_KEY=<SecretAccessKey de electrum-subida>
export AWS_DEFAULT_REGION=us-east-1

aws s3 sync /ruta/a/los/expedientes s3://electrum-expedientes-548380372606/entrada/ \
  --no-progress --only-show-errors
```

Puntos que importan:

- **`sync`, no `cp`.** Si la subida se corta —y con gigabytes se corta— volver a lanzar el mismo
  comando continúa en vez de empezar de cero.
- **Todo bajo `entrada/`.** Es donde se va a leer; fuera de ahí no se mira.
- **Respetar las carpetas tal como estén.** `sync` conserva la estructura y eso ayuda después: el
  nombre y la ruta de un expediente dicen de qué concesión es.
- La CLI parte sola los archivos grandes en varias piezas. No hay que hacer nada especial.

Comprobar al terminar, con las claves normales de la cuenta (la de subida no puede leer):

```bash
aws s3 ls s3://electrum-expedientes-548380372606/entrada/ --recursive --summarize | tail -3
```

## Qué NO hace falta

- **No hay que convertir, renombrar ni comprimir nada.** Los PDF van tal cual.
- **No hay que separar lo geográfico de los documentos.** Se distingue solo por la extensión.
- **No hay que hacer OCR todavía.** Primero se mide cuántos lo necesitan; hacerlo a ciegas sobre
  todo el lote es caro y lento para nada.
- **No hay que subir nada dos veces.** Cada documento lleva la huella de su contenido y lo repetido
  se salta al indexar, aunque llegue con otro nombre.

## Qué pasa después

Los PDF **no** se quedan en el cerebro. Se les extrae el texto, se trocea respetando el número de
página —una cita sin página no se puede comprobar, y entonces no es una cita— y el binario se
descarta. Por eso una carpeta de gigabytes acaba siendo decenas de megabytes de base de datos.

Un PDF que sea un escaneo sin capa de texto **no entra**, y se dice en vez de fingir que se leyó.
Con expedientes mineros esa proporción suele ser alta, así que el primer paso tras la subida es un
ensayo que cuenta cuántos son, y con ese número se decide si merece la pena pasarlos por OCR.
