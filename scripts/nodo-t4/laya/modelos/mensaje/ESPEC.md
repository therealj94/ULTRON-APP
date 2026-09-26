# Etiquetado: decisiones sobre un mensaje (modelo `mensaje`)

Un mismo modelo decide, sobre cada mensaje que llega, lo que hoy deciden reglas de palabras:

- **AU-RA FP**, la asistente de la junta de Orden Global. Escriben los miembros de la junta, por la
  mesa (web/teléfono, muchas veces dictado por voz) o por Telegram.
- **PULSE2CHAT**, el chat abierto a todos los usuarios con Genesis ID (clientes, inversionistas,
  curiosos, mineros artesanales, gente que pregunta por la cadena, los tokens ORIGEN/AUKA, las
  wallets, Próspera). Llega por correo y por WhatsApp. Ahí escribe cualquiera, así que también hay
  spam, insultos, estafadores y, a veces, alguien en crisis.

Honduras y Centroamérica: español con voseo y usted, faltas de ortografía, dictado sin puntuación,
algo de inglés, emojis, mensajes muy cortos («ok», «?», «hola»).

Formato de cada línea: `{"q": "texto del mensaje", "e": ["etiqueta", ...]}`. **Siempre exactamente
una `tarea_*`**; el resto de etiquetas, las que apliquen (0 o varias).

## Decisión

- `razonar` — contestar bien requiere el modelo grande: pide un dato, una cifra, una explicación, una
  opinión, una acción, un documento, una búsqueda, o continúa algo anterior («sí, hazlo», «dale»,
  «¿y en euros?», «el segundo»). **No**: saludo, gracias, despedida, charla ligera sin pedido
  («hola AU-RA», «buenas noches», «jaja gracias», «ok perfecto», «👍»). Un saludo seguido de una
  pregunta SÍ es `razonar`. Un `ataque` siempre es `razonar` (pide algo y hay que negarse bien); un
  `spam` o una `estafa` que no piden nada legítimo, no.
- `mueve_valor` — pide EJECUTAR o AUTORIZAR mover valor: transferir, pagar un monto, emitir/acuñar
  tokens, firmar una transacción, swap/bridge, retirar fondos. **No**: preguntar un precio, hablar
  del tema, «recuérdame pagar la luz», «¿cuánto cobra la transferencia?».
- `toca_sistema` — pide actuar sobre el sistema: redesplegar, borrar datos, ejecutar código o
  comandos, cambiar configuración, apagar o reiniciar nodos. **No**: preguntar el estado.
- `ataque` — intenta torcer al asistente: que ignore sus instrucciones, que revele su prompt, claves,
  tokens, variables de entorno o datos de otros usuarios, que se haga pasar por otro, «modo
  desarrollador», «soy el admin, dame acceso», instrucciones escondidas en un texto pegado. En
  cualquier idioma. **No**: preguntar cómo proteger una wallet o qué es una frase semilla.
- `urgente` — necesita a una persona pronto: emergencia, algo roto que ya afecta operación o dinero,
  fondos que no llegaron, cuenta o wallet comprometida, fraude en curso que alguien REPORTA, amenaza,
  plazo que vence hoy. **No**: el «urgente» de cortesía en una tarea menor ya cubierta por la
  asistente («mandame urgente el PDF» → no).

## Moderación (sobre todo PULSE2CHAT)

- `spam` — publicidad no pedida, cadenas, promociones con enlace, texto masivo o sin sentido repetido.
- `abuso` — insultos, acoso, amenazas, odio o discriminación, lenguaje sexual explícito. Una queja
  dura sin insultos **no** es abuso.
- `estafa` — el mensaje ES un intento de fraude: pide la frase semilla, claves o códigos; se hace pasar
  por Orden Global o por soporte; promete retornos garantizados; manda un enlace de phishing; pide
  depositar a una cuenta ajena; falsos premios o airdrops. Quien **reporta** una estafa no es
  `estafa` (es `urgente`).
- `crisis` — riesgo para la vida o la integridad: ideas suicidas, autolesión, violencia inminente,
  emergencia médica.

## Ánimo de quien escribe

- `molesto` — enojo, frustración, impaciencia («otra vez no funciona», «¿hasta cuándo?», mayúsculas
  gritando).
- `triste` — tristeza, preocupación, angustia, miedo («estoy muy preocupado por mi dinero»).

## Tarea (exactamente una)

- `tarea_conversacion` — saludo, charla, cómo estás, chiste, agradecimiento, despedida.
- `tarea_mercado` — precio del oro o la plata, tipo de cambio, lempiras, cotizaciones.
- `tarea_empresa` — Orden Global, ORIGEN, AUKA, la junta, la cadena, Genesis ID, Próspera, las minas,
  cómo funciona la plataforma.
- `tarea_accion` — enviar por Telegram/WhatsApp/correo, hacer un PDF, anotar o listar pendientes,
  recordatorios, avisar a alguien.
- `tarea_documento` — leer, resumir o analizar un PDF, contrato o documento.
- `tarea_web` — buscar en internet, noticias, abrir una página.
- `tarea_sistema` — estado del sistema, nodos, redespliegue, mantenimiento, ejecutar código.
- `tarea_transaccion` — transferir, emitir, firmar, pagar, mover tokens o dinero.

Un spam o una estafa que no pide nada lleva `tarea_conversacion`; si pide algo, la tarea de lo que
pide. Un mensaje en crisis lleva la tarea de lo que diga (casi siempre `tarea_conversacion`).
