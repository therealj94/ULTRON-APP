# Etiquetado: panel de especialistas de Dr Electrum

Dr Electrum es una estación de trabajo minera (Honduras y Centroamérica; clientes: dueños de
concesiones, consultores, inversionistas, técnicos de campo, funcionarios). El usuario le escribe o
le DICTA POR VOZ. Hay que decidir a qué especialistas les toca la consulta: 0, 1 o 2 (nunca más de 2),
el principal primero.

## Especialistas (id → de qué responde)
- geologo: yacimientos, tipos de depósito (pórfido, epitermal, skarn, vetas, placer), estructura, fallas,
  alteración, mineralización, sondajes/perforación de exploración, testigos, logueo, muestreo, ensayes,
  LEY DEL MINERAL (g/t, %), anomalías geoquímicas/geofísicas, recursos vs reservas, modelo geológico.
- minas: método de explotación (cielo abierto, subterráneo, corte y relleno, cámaras y pilares, caving),
  diseño de tajo/rampas/bancos, planeamiento y secuencia, dilución, recuperación minera, voladura,
  producción diaria, flota, carguío y acarreo, descapote/relación estéril-mineral.
- civil: caminos de acceso, puentes, botaderos, PRESAS DE RELAVES (diseño, estabilidad, método de
  crecimiento), geotecnia y estabilidad de taludes de obras, drenaje de obras, campamento, cimentaciones,
  movimiento de tierra.
- metalurgista: pruebas metalúrgicas, recuperación de planta, chancado, molienda, flotación, cianuración,
  CIL/CIP, lixiviación en pilas, Merrill-Crowe, carbón activado, doré, oro refractario, concentrados,
  reactivos, gravimetría.
- geomatica: mapas, capas, shapefile/KML/GeoJSON/DXF, proyecciones y datums (UTM, WGS84, NAD27),
  coordenadas, georreferenciar, medir áreas/hectáreas/perímetros, polígonos, superposición geométrica
  de capas, topografía, curvas de nivel, GPS, drones/ortofotos.
- ambiental: licencia ambiental, EIA, impacto, agua y cuencas, drenaje ácido, contaminación (mercurio,
  cianuro en el ambiente), cierre de mina y remediación, monitoreo, flora/fauna, áreas protegidas,
  comunidades, consulta previa, licencia social.
- legal: concesiones mineras, titularidad, vigencia/vencimiento/caducidad, prelación, expedientes,
  permisos y trámites ante la autoridad minera (INHGEOMIN en Honduras), canon, regalías como obligación
  legal, Ley General de Minería, contratos, servidumbres, dueño del suelo, registro, moratorias.
- economista: costos (por tonelada/por onza), AISC, capex/opex, VAN/NPV, TIR/IRR, payback, flujo de caja,
  ley de corte (cutoff) como decisión económica, precio de metales y mercado, valuación de proyecto,
  vida de mina, financiamiento, presupuesto.

## Reglas de frontera (importan)
- "ley" como grado del mineral → geologo; "ley" como norma jurídica → legal.
- Talud del tajo como diseño de banco/ángulo en el plan → minas; estabilidad/geotecnia de una obra,
  botadero o presa → civil. Si pide ambas cosas → las dos.
- Relaves: estabilidad/diseño de la presa → civil; contaminación, agua, cierre → ambiental;
  relave como producto de planta/recuperación → metalurgista.
- Cianuro: en el proceso de planta → metalurgista; en el ambiente/derrame → ambiental.
- Traslape: medir/dibujar la superposición → geomatica; quién tiene el derecho/prelación → legal.
  "¿Se traslapa X con Y y quién tiene prelación?" → legal + geomatica.
- Ley de corte: economista (si además habla de diseño del tajo → + minas).
- Valor in situ vs valor del proyecto → economista.
- Los NOMBRES de concesiones, minas, ríos y cerros NO convocan a nadie por sí mismos: "Quebrada Seca",
  "Río Blanco", "Cerro Partido", "Agua Caliente", "La Esperanza", "San Andrés", "Minas de Oro",
  "Clavo Rico", "Veta Grande", "Tajo Nuevo", "El Carbón", "Laguna Verde", "Puente Alto", "Las Presas".
  Se etiqueta por lo que se PIDE, no por las palabras del nombre.
- Pedido explícito ("póngame al geólogo", "que hable el abogado", "pasame al civil") → ese especialista
  primero, y si el tema pide otro, el segundo.
- Nada técnico (saludo, gracias, cómo usar la app, chiste, clima, fútbol, algo personal) → [].
- Pregunta minera general sin especialidad clara ("¿qué opinás del proyecto?", "resumime el expediente")
  → [] salvo que el contenido pida una especialidad.

## Formato
Un JSON por línea, sin comentarios: {"q": "<texto del usuario>", "e": ["<id principal>", "<id segundo>"]}
"e" puede ser [], ["x"] o ["x","y"] (principal primero). Ids exactamente como arriba.
