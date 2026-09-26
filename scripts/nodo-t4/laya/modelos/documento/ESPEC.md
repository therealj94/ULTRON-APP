# Etiquetado: qué es un documento y qué trae (modelo `documento`)

Dr Electrum recibe expedientes mineros de Honduras y Centroamérica: PDFs escaneados con OCR (con
errores: letras cambiadas, saltos de línea rotos, encabezados repetidos), Word, fotos de planos. El
texto que ve el modelo es un **fragmento**: el principio y el final de un documento o de una sección
(hasta ~700 caracteres; si es más largo, cabeza + «…» + cola).

Instituciones que aparecen: INHGEOMIN (Instituto Hondureño de Geología y Minas), SERNA / MiAmbiente
(SLAS, licencias ambientales), municipalidades, Procuraduría, Registro de la Propiedad, notarios,
empresas mineras, consultoras, bancos. Ley General de Minería, canon territorial, concesiones de
exploración y explotación, pequeña minería, minería artesanal.

Formato: `{"q": "texto del fragmento", "e": ["etiqueta", ...]}`. **Siempre exactamente un `doc_*`**;
los `req_*` que apliquen (0 o varios).

## Tipo (exactamente uno)

- `doc_resolucion` — lo emite una autoridad: resolución, auto, dictamen, providencia, constancia,
  certificación oficial, licencia otorgada, notificación.
- `doc_contrato` — contrato, convenio, cesión de derechos, arrendamiento, servidumbre, poder,
  escritura, acta de acuerdo entre partes.
- `doc_ambiental` — estudio de impacto ambiental, diagnóstico ambiental, plan de gestión, monitoreo de
  agua/aire/ruido, plan de cierre como documento propio.
- `doc_tecnico` — informe geológico, de exploración o de sondajes, estimación de recursos (NI 43-101,
  JORC), estudio metalúrgico, plan de minado, estudio geotécnico, informe de producción.
- `doc_plano` — plano, mapa, levantamiento topográfico, tabla de coordenadas o vértices, croquis.
- `doc_financiero` — factura, recibo, pago de canon o tasas, estado financiero, presupuesto, flujo de
  caja, cotización comercial.
- `doc_solicitud` — lo presenta una parte: solicitud, escrito, memorial, oficio de parte, denuncia,
  recurso, carta a una autoridad.
- `doc_otro` — nada de lo anterior (correo informal, nota de prensa, currículum, manual…).

## Qué trae (los que apliquen)

- `req_firma_autoridad` — firma, sello o número de resolución de una autoridad competente («Firma y
  sello», «Resolución No. …», «Comuníquese», «Director Ejecutivo INHGEOMIN»).
- `req_coordenadas` — coordenadas, vértices, linderos o rumbos que delimitan un área.
- `req_agua` — fuentes de agua: ríos, quebradas, nacientes, microcuencas, uso o permiso de agua,
  calidad del agua.
- `req_comunidad` — comunidades: consulta o socialización, pueblos indígenas o afrohondureños,
  patronatos, acuerdos o conflictos con vecinos.
- `req_cierre` — cierre de mina: plan de cierre, rehabilitación, abandono, garantía o fianza de
  cierre.
- `req_plazo` — plazos o fechas que obligan: vigencia, vencimiento, término para cumplir, fecha
  límite, prórroga.
