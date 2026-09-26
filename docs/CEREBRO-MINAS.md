# Cerebro de Minas

Segunda plataforma de AU-RA. Mismo cuerpo, otro cerebro.

## Qué es

Un asistente de minería: geología, exploración, muestreo, recursos y reservas, métodos de
explotación, metalurgia, costos, seguridad y permisos. **No sabe nada de Orden Global** — ni la
cadena 5550, ni AUKA, ni la bóveda, ni la junta. Si le preguntan por eso, manda a la otra
plataforma. Es una demostración y lo dice en voz alta: no está abierta al público y no sustituye a
una Persona Calificada ni a un informe firmado.

## Por qué no es otro AU-RA

AU-RA es un cuerpo: cara, voz, emociones, ojos, oído, harness, memoria, sesiones. Duplicar todo eso
para tener otro asistente significa que cada arreglo hay que hacerlo dos veces, y a la tercera
semana las dos copias ya no se parecen.

Lo que de verdad cambia entre una plataforma y otra es el **cerebro**: quién dice ser, qué sabe, con
qué palabras se busca ese saber, qué reglas obedece y qué herramientas tiene. Eso es un
`PerfilCerebro` (`lib/perfiles/tipos.ts`), y el binario carga uno solo según `ULTRON_PERFIL`.

```
lib/perfiles/
  tipos.ts     el contrato: identidad, conocimiento, sinónimos, reglas, herramientas, acento
  genesis.ts   Genesis Core — la junta de Orden Global (perfil por defecto)
  minas.ts     Cerebro de Minas
  index.ts     perfilActivo() según ULTRON_PERFIL; sin variable, Genesis
```

Consecuencias que importan:

- Arreglar la voz, la cara o la cámara arregla **las dos** plataformas a la vez.
- El cerebro de una no puede contaminar el de la otra: solo se carga el suyo. Hay pruebas que lo
  vigilan (`tests/perfiles.test.ts`): si alguien mete datos de la junta en el conocimiento de minas,
  se caen.
- Un perfil inventado en la variable no rompe nada: avisa en el arranque y usa Genesis.

## Desplegarlo

Es un **segundo servicio de Render sobre el mismo repositorio**. No hay que copiar nada.

1. Render → New → Web Service → mismo repo, rama `main`.
2. Build: `npm install && npm run build`. Start: `npm start`.
3. Variables de entorno: las mismas que el servicio actual (nodo Qwen, ElevenLabs, ojo) **más**:

   ```
   ULTRON_PERFIL=minas
   ```

4. Nada más. El nombre, el color, el catálogo de capacidades y las reglas del prompt salen solos del
   perfil.

Para la demo conviene **no** darle `ULTRON_MEMORIA_BUCKET` ni las claves de Telegram: así no
escribe en la memoria de la junta ni contesta en sus chats.

## Qué sabe

`src/08-cerebro-minas/conocimiento.ts`. Secciones: unidades y conversiones, tipos de yacimiento,
exploración, muestreo y ensayo, recursos y reservas, cielo abierto, subterráneo, procesamiento y
metalurgia, economía minera, seguridad y ambiente, minería artesanal, marco regulatorio en Honduras,
y un glosario.

Está escrito en líneas que empiezan con `-`, que es lo que lee el recuperador: para agregar un hecho
basta con agregar una línea.

## Qué hace, además de conversar

**Cálculos de minería** (`lib/minas/calculos.ts`). Un 27B habla bien de leyes y tonelajes pero no es
una calculadora: le pedís las onzas de 250.000 toneladas a 3,4 g/t y te da un número creíble y a
veces equivocado. Aquí la cuenta la hace el código, con la fórmula a la vista, y el modelo solo la
dice. Si la pregunta es solo la cuenta, la respuesta sale directa, sin pasar por el modelo, para que
el número no se parafrasee.

- Onzas contenidas, recuperables y su valor al spot del día.
- Ley de corte marginal. Si falta el costo o el precio, los pide en vez de suponerlos.
- Relación de descapote, dilución, vida de mina, AISC.
- Conversiones: g/t, ppm, porcentaje, onzas por tonelada corta, volumen y densidad a tonelaje.
- Entiende cómo escribe la gente: «250.000», «3,4», «1,5 millones», «3.4».

**Fichas de concesiones y permisos** (`lib/minas/concesiones.ts`, padrón en
`data/concesiones-demo.json`). Consultable por voz: «¿cómo va Cerro Partido?», «¿qué concesiones
vencen pronto?». Dice expediente, titular, área, tipo, estado ambiental, obligaciones pendientes y
vencimiento; avisa de los plazos cortos y, si el padrón se contradice (dice «vigente» sobre una
fecha ya pasada), lo señala en vez de callarlo. Cada respuesta aclara que el padrón es de
demostración.

**Precio de metales en vivo** y **lectura de documentos** (PDF, fotos de informes) reusan lo que ya
tenía la mesa.

## Qué NO hace

- No redespliega, no hace mantenimiento y no corre el ejecutor: el catálogo de capacidades ni
  siquiera muestra esas tarjetas.
- No canta ni ora. Eso es de Genesis.
- No afirma la vigencia, el área ni el titular de una concesión real sin el expediente delante.
- No opina sobre Orden Global.

## Añadir un tercer cerebro

Un archivo en `lib/perfiles/` que cumpla `PerfilCerebro`, más su conocimiento, más una línea en
`PERFILES` (`lib/perfiles/index.ts`). Nada del cuerpo se toca.

## Verificado

- `tsc` limpio; 186 pruebas en verde, de las cuales 45 son de los cálculos y el padrón, y 20 del
  aislamiento entre cerebros.
- Las dos plataformas levantadas a la vez en la misma máquina: `/api/perfil` devuelve identidades
  distintas, el prompt del Cerebro de Minas no contiene una sola línea de datos de Orden Global (solo
  la regla que manda a la otra plataforma), y el de Genesis quedó idéntico.
- Capturas de las dos pantallas de arranque, una al lado de la otra: cian «AU-RA FP» contra ámbar
  «CEREBRO DE MINAS · demostración».
- Cálculo de punta a punta contra el servidor: 1.200.000 t a 2,8 g/t con 91% de recuperación →
  108.027 onzas contenidas, 98.304 recuperables. Comprobado a mano.

### Límite conocido

El acento de la plataforma manda en la cara, en el arranque, en el título de la pestaña y en el
wordmark de la cabecera. El resto de la interfaz (botones, bordes del panel) todavía tiene el cian
escrito literal en las clases de Tailwind; se ve coherente pero no está teñido del todo. Cambiarlo
es un barrido de decenas de clases y no se hizo en esta ronda para no arriesgar Genesis.
