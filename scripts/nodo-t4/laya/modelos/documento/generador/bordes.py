"""Casos de borde escritos a mano (todo inventado)."""
import json
import sys

B = []


def b(q, e, nota):
    B.append({'q': q.strip('\n'), 'e': e, 'nota': nota})


b("""SE INTERPONE RECURSO DE REPOSICIÓN.-
SEÑOR(A) DIRECTOR(A) EJECUTIVO(A) DEL INHGEOMIN.
El apoderado legal de Minera Lomas Verdes Demo, S.A., en el expediente EXP-FICT-2021-0417, comparece e interpone recurso de reposición contra la Resolución No. DEMO-DE-0388-2022, de fecha 14 de marzo de 2022, mediante la cual se declaró la caducidad de la concesión «Los Tizatillos». … Es justicia que pido. Tegucigalpa, 28 de marzo de 2022. [Firma] Apoderado(a) Legal""",
  ['doc_solicitud'], 'Recurso de parte que cita una resolución: es solicitud, no resolución, y citar su número no es firma de autoridad.')

b("""MEMORIAL.- SE TRANSCRIBE PARTE RESOLUTIVA.- El suscrito apoderado de Aurífera Montecristo FICT hace presente que la resolución notificada dice textualmente: «PRIMERO: Declarar sin lugar... NOTIFÍQUESE. (f) Director(a) Ejecutivo(a). (f) Secretario(a) General». Por lo anterior, pido se revoque lo resuelto y se admitan las pruebas que acompaño. [Firma] Apoderado(a)""",
  ['doc_solicitud'], 'La parte transcribe la fórmula «Notifíquese» y las firmas de la resolución, pero el documento es suyo: sin req_firma_autoridad.')

b("""CONTRATO DE SERVIDUMBRE DE PASO Y ACUEDUCTO
Comparecen el propietario del predio sirviente y el apoderado de Compañía Exploradora Los Pinares Demo, S.A. … SEGUNDA: La franja de servidumbre, de 8 metros de ancho, queda delimitada por los puntos siguientes (UTM 16N, WGS84): P1 (512340, 1623410); P2 (512980, 1623655); P3 (513402, 1624120); P4 (513390, 1624188). TERCERA: El plazo de la servidumbre es de veinte años prorrogables.""",
  ['doc_contrato', 'req_coordenadas', 'req_plazo'], 'Contrato de servidumbre con coordenadas: sigue siendo contrato; los puntos delimitan la franja (req_coordenadas) y fija plazo.')

b("""ESTUDIO DE IMPACTO AMBIENTAL — PROYECTO «CERRO LA CAMPANA»
Capítulo 11. PLAN DE CIERRE Y REHABILITACIÓN
11.1 Objetivos. Al término de la explotación se desmantelará la planta, se sellarán las bocaminas con tapones de concreto y se revegetarán las 34 ha intervenidas con especies nativas. … 11.4 Costo estimado del cierre: US$ 612,000.00, respaldado con garantía de cierre a favor de la autoridad minera.""",
  ['doc_ambiental', 'req_cierre'], 'EIA con el plan de cierre como capítulo: el tipo es ambiental (no «plan de cierre propio») y trae req_cierre.')

b("""AVISO DE COBRO No. FICT-00871 — CANON TERRITORIAL {2023}
Titular: Minerales Cerro Azul Demo, S.A. de C.V. · Concesión «El Zapotal» · 250.00 ha × US$ 2.50 = US$ 625.00
Tipo de cambio L. 24.65 · Total L. 15,406.25
Fecha de vencimiento: 31 de enero de 2023. Vencido el plazo se aplicará un recargo del 2 % mensual y podrá declararse la caducidad.""".replace('{2023}', '2023'),
  ['doc_financiero', 'req_plazo'], 'Cobro de canon con fecha de vencimiento: financiero + req_plazo; sin sello ni firma visible, no hay req_firma_autoridad.')

b("""INSTITUT0 H0NDURENO DE GE0L0GIA Y MlNAS
RES0LUCI0N N0. DEM0-DE-O7l2-2Ol9
... VISTO: Para res0lver la s0licitud de pr0rr0ga de vigencia de la c0ncesi0n «Santa Rufina» ... P0R TANT0: RESUELVE: PRlMER0: C0nceder pr0rr0ga
de vigencia p0r un plaz0 de cinc0 (5) añ0s, c0ntad0s a partir del venci-
miento del plaz0 original. C0MUNIQUESE Y N0TlFIQUESE. [Firrna y sell0] Direct0r(a) Ejecutiv0(a)""",
  ['doc_resolucion', 'req_firma_autoridad', 'req_plazo'], 'OCR muy sucio (0 por O, l por I, rn por m): la etiqueta no cambia; número propio, fórmula y firma cuentan igual.')

b("""[TABLA] VÉRTICE | ESTE | NORTE
1 | 604 118 | 1 598 402
2 | 606 118 | 1 598 402
3 | 606 118 | 1 596 402
4 | 605 000 | 1 595 950
5 | 604 118 | 1 596 402""",
  ['doc_plano', 'req_coordenadas'], 'Plano que solo trae la tabla de vértices, sin cajetín: una tabla de vértices sola es doc_plano.')

b("""…que la Unidad de Asesoría Legal emitió dictamen favorable. CONSIDERANDO: Que la Dirección General de Recursos Hídricos condicionó su opinión a respetar una franja de 30 metros a ambos lados de la quebrada Los Guapotes. CONSIDERANDO: Que el solicitante acreditó la solvencia del canon territorial del año 2020.""",
  ['doc_resolucion', 'req_agua'], 'Fragmento del medio sin encabezado ni firma: por los considerandos es resolución, pero sin número propio ni firma a la vista no lleva req_firma_autoridad.')

b("""…LA ARRENDATARIA podrá instalar bodegas y un plantel de maquinaria. CUARTA: La renta mensual es de L. 12,500.00, pagaderos dentro de los primeros cinco días de cada mes. QUINTA: LA ARRENDATARIA no podrá subarrendar sin autorización escrita de EL ARRENDADOR.""",
  ['doc_contrato', 'req_plazo'], 'Medio de contrato sin encabezado; el día de pago de cada mes es fecha límite que obliga.')

b("""CÉDULA DE NOTIFICACIÓN
En la ciudad de Tegucigalpa, a las 10:15 horas del 3 de agosto de 2021, notifiqué al apoderado legal de Grupo Minero Ceibal Demo, S. de R.L. la Resolución No. DEMO-SG-0911-2021, entregándole copia íntegra.
[Firma y sello] Receptor(a) de la Secretaría General — Firma del notificado: [Firma]""",
  ['doc_resolucion', 'req_firma_autoridad'], 'Notificación: la emite la autoridad (doc_resolucion) y el número es de su propio acto, con firma y sello del receptor.')

b("""OFICIO No. DEMO-DFM-0342-2020
Señores Extracciones y Agregados El Porvenir Demo, S.A.
Presente
Por instrucciones de la Dirección Ejecutiva se les requiere presentar, en un plazo no mayor de diez días hábiles, el informe semestral de producción y el libro de voladuras.
[Firma y sello] Director(a) de Fiscalización Minera""",
  ['doc_resolucion', 'req_firma_autoridad', 'req_plazo'], 'Oficio de la autoridad (no de parte): cuenta como resolución; requerimiento con término.')

b("""SE ACOMPAÑA INFORME SEMESTRAL.- Señor(a) Director(a) de Fiscalización Minera. Minera Quetzaltepe Ficticia, S.A. remite el informe semestral de producción de la concesión «La Culebrilla». Atentamente, [Firma] Gerente General.
RECIBIDO — Secretaría General INHGEOMIN — 12/07/2019 — hora 11:40 — folios 23. [sello de recibido]""",
  ['doc_solicitud'], 'El sello de recibido de la Secretaría es solo acuse de recibo, no acto de autoridad: sin req_firma_autoridad.')

b("""ESCRITURA PÚBLICA NÚMERO 45.- CESIÓN DE DERECHOS MINEROS.- … EL CEDENTE cede al CESIONARIO la totalidad de sus derechos sobre la concesión «La Peña Blanca». … Y yo, el(la) Notario(a), doy fe de todo lo relacionado. [Firma] [Firma] [Firma y sello del Notario(a)]""",
  ['doc_contrato'], 'La firma y el sello del notario no son de autoridad competente en el sentido del ESPEC.')

b("""ESCRITURA PÚBLICA NÚMERO 18.- COMPRAVENTA DE INMUEBLE.- … el inmueble se vende libre de gravámenes. … Leído que fue, lo firman. Doy fe. [Firma y sello del Notario(a)]
Inscrito bajo el número 62 del Tomo 311 del Registro de la Propiedad Inmueble y Mercantil, Sección Registral de Juticalpa. 9 de mayo de 2018. [Firma y sello] Registrador(a)""",
  ['doc_contrato', 'req_firma_autoridad'], 'Escritura con la razón de inscripción del Registro: la firma y sello del registrador sí es de autoridad.')

b("""INFORME TÉCNICO NI 43-101 — PROYECTO «VETA RICA»
14.3 Los recursos indicados suman 412 kt con 4.1 g/t Au (54.3 koz), por encima de una ley de corte de 1.2 g/t Au. … [Firma] Geólogo(a) responsable — Colegio de Geólogos de Honduras, colegiado(a) No. FICT-2231 [sello del colegio profesional]""",
  ['doc_tecnico'], 'Sello de un colegio profesional y firma de la persona calificada: no son autoridad.')

b("""DICTAMEN TÉCNICO No. DEMO-DM-0117-2019
DIRECCIÓN DE MINAS — INHGEOMIN
Revisado el Plan de Labores, la mineralización en vetas de cuarzo con leyes medias de 6.8 g/t Au y el método de corte y relleno propuesto son consistentes; se recomienda su aprobación.
[Firma y sello] Técnico(a) de la Dirección de Minas""",
  ['doc_resolucion', 'req_firma_autoridad'], 'Dictamen técnico de la autoridad con contenido geológico: lo emite la autoridad, así que es resolución, no técnico.')

b("""CERTIFICADO DE ANÁLISIS DE AGUA No. FICT-5520
Laboratorio de Aguas El Roble Demo · Cliente: Oro de Occidente FICT
[TABLA] Punto | pH | SST (mg/L) | As (mg/L) | CN libre (mg/L)
M-1 quebrada El Hule aguas arriba | 7.3 | 9 | <0.005 | <0.01
M-2 quebrada El Hule aguas abajo | 6.9 | 41 | 0.011 | 0.02""",
  ['doc_ambiental', 'req_agua'], 'Certificado de laboratorio sobre calidad del agua: es monitoreo de agua (ambiental), no técnico.')

b("""[TABLA] Sondaje | Este | Norte | Cota | Azimut | Incl. | Prof. (m)
DDH-FICT-07 | 548 210 | 1 612 344 | 812 | 135 | -55 | 210.5
DDH-FICT-08 | 548 402 | 1 612 290 | 798 | 135 | -60 | 185.0
DDH-FICT-09 | 548 655 | 1 612 510 | 830 | 315 | -50 | 240.2""",
  ['doc_tecnico'], 'Tabla de collares de sondaje: son puntos sueltos, no delimitan un área; tipo técnico, sin req_coordenadas.')

b("""INFORME DE MONITOREO DE CALIDAD DE AGUA — TERCER TRIMESTRE 2022
Estación M-1: quebrada Las Lajas, aguas arriba del campamento (E 612340 N 1587220). Estación M-2: 200 m aguas abajo de la laguna de sedimentación (E 612790 N 1586980). La turbidez en M-2 superó el valor de referencia en dos campañas.""",
  ['doc_ambiental', 'req_agua'], 'Coordenadas de estaciones de muestreo: puntos sueltos, sin req_coordenadas.')

b("""PLAN DE LABORES 2021 — CONCESIÓN «QUEBRADA HONDA II»
El método de explotación será corte y relleno ascendente con una producción de 120 t/día. El sostenimiento se hará con pernos y malla en roca clase IV. La flota comprende una excavadora y cuatro volquetas.""",
  ['doc_tecnico'], 'El nombre de la concesión dice «Quebrada», pero no trata de fuentes de agua: sin req_agua.')

b("""CONSTANCIA DE TRABAJO
La empresa Minas del Valle Escondido Demo, S.A. hace constar que el(la) señor(a) [NOMBRE], con domicilio en la aldea Río Abajo, municipio de Trojes, labora como operador(a) de equipo pesado desde 2017. Se extiende a solicitud del interesado.""",
  ['doc_otro'], 'La aldea «Río Abajo» es una dirección: ni req_agua ni req_comunidad. La constancia la da una empresa, no una autoridad: doc_otro.')

b("""CUARTA: SERVICIOS. Los servicios de agua potable, energía eléctrica y recolección de basura del inmueble arrendado correrán por cuenta de LA ARRENDATARIA, así como las reparaciones menores del plantel y de la bodega.""",
  ['doc_contrato'], 'Agua potable como servicio pagado: no es fuente de agua, así que no lleva req_agua.')

b("""RECIBO DE SERVICIO
Servicio de agua potable y alcantarillado — campamento de la concesión «El Pinabete»
Período: junio 2020 · Consumo: 38 m³ · Total a pagar: L. 1,240.00
Pague en cualquier agencia bancaria.""",
  ['doc_financiero'], 'Recibo de agua potable: financiero; el servicio no es fuente de agua.')

b("""RECIBO No. FICT-3310
Pago de canon anual por aprovechamiento de aguas de la quebrada La Pita, permiso de uso de agua FICT-0211, caudal autorizado 4.5 l/s: L. 6,800.00.
Depositado en Banco Cordillera Demo, S.A., referencia FICT-88120.""",
  ['doc_financiero', 'req_agua'], 'Pago del permiso de uso de una quebrada: trata de uso o permiso de agua (req_agua), a diferencia del agua potable.')

b("""ESTADO DE RESULTADOS — Metales del Altiplano Ficticio, S. de R.L. de C.V.
Ejercicio terminado el 31 de diciembre de 2019
Ingresos por venta de doré L. 48,220,114.00; costo de ventas L. 31,905,442.00; utilidad neta L. 6,114,020.00. Cierre contable del ejercicio fiscal aprobado por la asamblea.""",
  ['doc_financiero'], '«Cierre contable del ejercicio» no es cierre de mina: sin req_cierre.')

b("""BALANCE GENERAL AL 31 DE DICIEMBRE DE 2021
Pasivos no corrientes: préstamos bancarios L. 12,400,000.00; provisión para cierre de mina y rehabilitación (Nota 14) L. 8,215,300.00. Nota 14: la compañía reconoce el valor presente de los costos de cierre de la mina «Los Encinos».""",
  ['doc_financiero', 'req_cierre'], 'Provisión contable para el cierre de mina: sí es req_cierre.')

b("""RESOLUCIÓN No. DEMO-SG-1430-2018 … PRIMERO: Tener por desistida la solicitud de concesión «Las Golondrinas» y ordenar el cierre del expediente. SEGUNDO: Devuélvanse los documentos originales. NOTIFÍQUESE. [Firma y sello] Secretario(a) General""",
  ['doc_resolucion', 'req_firma_autoridad'], '«Cierre del expediente» es archivo administrativo, no cierre de mina.')

b("""CONTRATO DE COMPRAVENTA DE MINERAL AURÍFERO … SEXTA: EL COMPRADOR pagará el oro contenido a razón del 92 % del precio de cierre de Londres (LBMA) del día de la liquidación, deducidos refinación y transporte. SÉPTIMA: Las partes se someten a los tribunales de Tegucigalpa.""",
  ['doc_contrato'], '«Precio de cierre» del oro no es cierre de mina.')

b("""CONVENIO DE COOPERACIÓN ENTRE LA MUNICIPALIDAD DE SAN IGNACIO Y SOCIEDAD MINERA LA CANDELILLA DEMO, S.A.
TERCERA: La Empresa rehabilitará el camino de acceso de 6 km, con balastro y cunetas, en un plazo de noventa días contados desde la firma. CUARTA: La Municipalidad facilitará los permisos de su competencia.""",
  ['doc_contrato', 'req_plazo'], 'Rehabilitar un camino no es rehabilitación de mina (sin req_cierre); el plazo de noventa días sí obliga.')

b("""FACTURA
Servicios Geológicos y Topográficos Demo, S. de R.L. · RTN FICT-40021 · CAI FICT-7A-21B-9C
Factura No. FICT-000-001-01-00000377 · Fecha: 14/02/2022 · Cliente: Compañía Minera Tres Valles Demo, S.A.
Levantamiento topográfico del polígono de la concesión: L. 58,000.00
Fecha límite de emisión: 30/11/2022. Rango autorizado: FICT-000-001-01-00000001 a FICT-000-001-01-00005000.""",
  ['doc_financiero'], '«Fecha límite de emisión» del CAI es un requisito fiscal del emisor, no un plazo que obligue en el expediente: sin req_plazo.')

b("""NI 43-101 TECHNICAL REPORT — LOS ACHIOTES GOLD PROJECT, OLANCHO DEPARTMENT, HONDURAS
Effective date: 30 June 2020 · Report date: 15 August 2020
Qualified Person: [signature] — Geominas Consultores Demo""",
  ['doc_tecnico'], 'Fecha efectiva y fecha del informe no obligan a nada: sin req_plazo.')

b("""LÍNEA BASE — CALIDAD DE AGUA SUPERFICIAL
La campaña de muestreo se realizó del 3 al 15 de marzo de 2019 en seis puntos del río Talquezal y sus tributarios; los resultados de sólidos suspendidos variaron entre 8 y 52 mg/L.""",
  ['doc_ambiental', 'req_agua'], 'Fechas de campaña de muestreo: descriptivas, sin req_plazo.')

b("""PRESUPUESTO DEL PLAN DE CIERRE — CONCESIÓN «EL CAMARÓN VIEJO»
[TABLA] Actividad | Costo (US$)
Desmantelamiento de planta | 84,500.00
Sellado de bocaminas | 21,300.00
Revegetación de 18 ha | 46,800.00
Monitoreo post-cierre (5 años) | 30,000.00
Total | 182,600.00""",
  ['doc_financiero', 'req_cierre'], 'Presupuesto de cierre suelto, sin encabezado de plan: el documento es un presupuesto (financiero) y trata de cierre.')

b("""PÓLIZA DE FIANZA No. FICT-20771 — Afianzadora Continental FICT
Afianzado: Oro de Occidente FICT, S.A. de C.V. · Beneficiario: Instituto Hondureño de Geología y Minas
Objeto: garantizar la ejecución del plan de cierre de mina de la concesión «San Isidro Alto». Suma afianzada: US$ 250,000.00. Vigencia: del 1 de marzo de 2023 al 28 de febrero de 2024.""",
  ['doc_financiero', 'req_cierre', 'req_plazo'], 'Regla elegida: una póliza o garantía es instrumento financiero (doc_financiero), no contrato; trae fianza de cierre y vigencia.')

b("""LISTA DE ASISTENCIA — REUNIÓN DE SOCIALIZACIÓN DEL PROYECTO «LA CHORRERA»
Aldea El Chagüite, 22 de septiembre de 2020
[TABLA] No. | Nombre | Comunidad | Firma
1 | [NOMBRE] | El Chagüite | [firma]
2 | [NOMBRE] | Las Joyas | [huella]
3 | [NOMBRE] | El Chagüite | [firma]""",
  ['doc_otro', 'req_comunidad'], 'Lista de asistencia: no es ninguno de los siete tipos (doc_otro), pero trata de socialización con comunidades.')

b("""NOTA DE PRENSA — Esquías, Comayagua.— Pobladores de la aldea Las Crucitas bloquearon el acceso al proyecto minero «Piedra Rayada», al que acusan de enturbiar la quebrada El Achiote, de la que se abastecen. El alcalde convocó a una mesa de diálogo para el lunes.""",
  ['doc_otro', 'req_agua', 'req_comunidad'], 'Nota de prensa: doc_otro aunque hable de conflicto y agua; los req_* se marcan igual.')

b("""LEY GENERAL DE MINERÍA — texto de consulta
Artículo 70 (transcripción de uso interno). El canon territorial se pagará anualmente, dentro del mes de enero de cada año. La falta de pago dentro de dicho término será causal de caducidad del derecho minero.""",
  ['doc_otro', 'req_plazo'], 'Regla elegida: una norma general transcrita no es un acto sobre un expediente, así que es doc_otro y no resolución; el término de pago sí obliga (req_plazo).')

b("""De: Gerencia <gerencia@ejemplo.invalid>
Para: Legal <legal@ejemplo.invalid>
Asunto: licencia
Ojo que la licencia ambiental de El Tigre Uno vence el 15 de noviembre y todavía no hemos metido la renovación. Porfa revisá qué falta.""",
  ['doc_otro', 'req_plazo'], 'Correo informal: doc_otro; menciona un vencimiento real (req_plazo).')

b("""ACTA DE INSPECCIÓN
En el sitio denominado «Montaña de Oro Viejo», jurisdicción de Silca, siendo las 09:30 horas del 6 de abril de 2022, se constituyó el(la) inspector(a) de la Dirección de Fiscalización Minera. Se constató descarga de lodos de la planta hacia la quebrada La Leona sin tratamiento. Es todo cuanto se hace constar. [Firma y sello] Inspector(a) — INHGEOMIN""",
  ['doc_resolucion', 'req_firma_autoridad', 'req_agua'], 'Regla elegida: el acta de inspección la levanta la autoridad, así que es doc_resolucion (constancia de hechos), no acta entre partes.')

b("""ACTA DE ACUERDOS
En la aldea Monte Grande, reunidos el patronato pro-mejoramiento, vecinos y representantes de Minera Lomas Verdes Demo, S.A., se acuerda: PRIMERO: La empresa reparará el camino vecinal. SEGUNDO: Contratará personal de la comunidad. Firmamos de conformidad: [Firma] Presidente(a) del Patronato — [Firma] Representante de la empresa.""",
  ['doc_contrato', 'req_comunidad'], 'Acta de acuerdos entre partes (empresa y patronato): doc_contrato según el ESPEC.')

b("""Señor(a) Ministro(a) de Recursos Naturales y Ambiente:
Nosotros, la junta de agua de la aldea El Rosario, denunciamos que desde hace un mes la naciente que abastece a 140 familias se secó después de que la empresa abrió un tajo en la parte alta. Pedimos una inspección urgente. Firman la presidenta de la junta y 60 vecinos.""",
  ['doc_solicitud', 'req_agua', 'req_comunidad'], 'Carta de la comunidad a una autoridad: es solicitud (denuncia de parte).')

b("""OFICIO No. FICT-081-GG-2023
Asunto: Presentación del Plan de Cierre
Señor(a) Director(a) de Fiscalización Minera, INHGEOMIN
Adjunto remitimos el Plan de Cierre y Rehabilitación de la mina «La Mina Vieja» y la propuesta de fianza de cierre, para su revisión y aprobación. Atentamente, [Firma] Gerente General""",
  ['doc_solicitud', 'req_cierre'], 'Oficio de parte que remite un plan de cierre: el oficio es solicitud (no ambiental) y trata de cierre.')

b("""CAPÍTULO 6. LÍNEA BASE SOCIOECONÓMICA
El área de influencia directa comprende las comunidades de Los Horcones (412 habitantes) y El Jícaro (238 habitantes), organizadas en patronatos; la principal actividad es la agricultura de subsistencia y el 30 % de los hogares tiene un miembro que ha trabajado en minería artesanal.""",
  ['doc_ambiental', 'req_comunidad'], 'La línea base social trata de las comunidades: req_comunidad.')

b("""CAPÍTULO 4. DESCRIPCIÓN DEL PROYECTO
4.1 Localización y accesos. El proyecto se ubica a 14 km de la cabecera municipal de Yuscarán; se llega por carretera pavimentada hasta la aldea El Terrero y luego por 5 km de camino de tierra transitable todo el año.""",
  ['doc_ambiental'], 'La aldea aparece solo como referencia de acceso: sin req_comunidad.')

b("""CROQUIS DE UBICACIÓN (sin escala)
A 3 km de la aldea Las Pitas por camino de tierra. La quebrada El Coyol pasa al oeste del área, a unos 150 m del lindero. Referencias: escuela, cancha y tanque de agua comunitario.""",
  ['doc_plano', 'req_agua'], 'Croquis con una quebrada real junto al área: req_agua; no hay polígono ni vértices, así que sin req_coordenadas.')

b("""PROYECTO: CONCESIÓN MINERA «SAN LUCAS NORTE» · CONTENIDO: PLANO DE UBICACIÓN Y POLÍGONO · ESCALA 1:10,000 · DATUM WGS84 UTM 16N · LÁMINA 1 DE 2
V1 588 400 1 602 300 / V2 590 400 1 602 300 / V3 590 400 1 600 300 / V4 588 400 1 600 300
REVISADO Y APROBADO — Unidad de Catastro Minero, INHGEOMIN. [Firma y sello]""",
  ['doc_plano', 'req_firma_autoridad', 'req_coordenadas'], 'Plano con sello de aprobación de Catastro: la firma y sello de autoridad cuentan también en un plano.')

b("""…ntadas en andesitas del Grupo Padre Miguel. La veta principal tiene un rumbo N52°E, un buzamiento de 70° al SE y una potencia media de 1.6 m; se reconoció a lo largo de 480 m mediante trincheras y dos niveles de galería.""",
  ['doc_tecnico'], 'Fragmento del medio que empieza a mitad de palabra; el rumbo de una veta no delimita un área (sin req_coordenadas).')

b("""ITEM 4 — PROPERTY DESCRIPTION AND LOCATION
The El Guayabo Dorado concession covers 600 ha and is defined by the following vertices (UTM 16N, NAD27): V1 512000 1650000; V2 515000 1650000; V3 515000 1648000; V4 512000 1648000. The exploitation concession was granted for 20 years and expires on 11 May 2034.""",
  ['doc_tecnico', 'req_coordenadas', 'req_plazo'], 'Fragmento en inglés de un 43-101: técnico, con vértices y vencimiento.')

b("""CONSTANCIA MUNICIPAL
La Unidad Municipal Ambiental de Gualcince, Lempira, hace constar que el proyecto de extracción de material selecto «Cuesta del Aire» cuenta con permiso de operación vigente hasta el 31 de diciembre de 2024.
[Firma y sello] Alcalde(sa) Municipal""",
  ['doc_resolucion', 'req_firma_autoridad', 'req_plazo'], 'Constancia de una municipalidad: la autoridad hace constar (doc_resolucion), con vigencia.')

b("""SOLICITUD DE LICENCIA AMBIENTAL — FORMULARIO SLAS-1
Nombre del proyecto: «El Pinabete» · Proponente: Mármoles y Calizas del Sur Demo, S.A. · Categoría solicitada: 2
Descripción: extracción de piedra caliza a cielo abierto en 12 ha; el agua para riego de caminos se comprará a un distribuidor en cisterna.""",
  ['doc_solicitud'], 'El formulario de solicitud de licencia lo presenta la parte: solicitud, no ambiental. El agua comprada en cisterna no viene de una fuente del área, así que no hay req_agua.')

b("""LICENCIA AMBIENTAL No. DEMO-DECA-0671-2020
MiAmbiente — Dirección de Evaluación y Control Ambiental
PRIMERO: Otorgar licencia ambiental al proyecto «La Esmeralda del Sur». SEGUNDO: La licencia tendrá una vigencia de cinco años. TERCERO: Queda prohibida la descarga de relaves al río Las Cañas.
[Firma y sello] Director(a) General DECA""",
  ['doc_resolucion', 'req_firma_autoridad', 'req_agua', 'req_plazo'], 'Una licencia ambiental otorgada es resolución, no documento ambiental.')

b("""P L A N O   T O P O G R A F I C O
Est.  PO   Rumbo           Dist.
l-2   N 4S°l2'3O" E   l,0OO.OO
2-3   S 44°5O'l0" E   8l2.4O
3-4   S 45°l2'3O" O   l,0OO.OO
4-l   N 44°5O'l0" O   8l2.4O
Area: 8l.24 ha""",
  ['doc_plano', 'req_coordenadas'], 'Plano con OCR muy sucio (l por 1, O por 0, S por 5): los rumbos y distancias delimitan un área.')

b("""…del Registro Minero y Catastral. Dada en Tegucigalpa, M.D.C., a los diez días del mes de mayo de dos mil veintiuno. COMUNÍQUESE Y NOTIFÍQUESE.
[Firma y sello]
Director(a) Ejecutivo(a) INHGEOMIN
[Firma y sello]
Secretario(a) General""",
  ['doc_resolucion', 'req_firma_autoridad'], 'Fragmento corto: solo la fórmula y las firmas; basta para resolución con req_firma_autoridad.')

b("""CONTRATO DE ARRENDAMIENTO DE TERRENO … TERCERA: El inmueble tiene las colindancias siguientes: AL NORTE, quebrada La Danta de por medio; AL SUR, camino real; AL ESTE, propiedad de [NOMBRE]; AL OESTE, terreno ejidal. … En fe de lo cual firmamos. [Firma] [Firma]""",
  ['doc_contrato', 'req_coordenadas', 'req_agua'], 'Regla elegida: una quebrada que sirve de lindero es un cuerpo de agua real junto al área, así que también lleva req_agua.')

b("""SE INTERPONE RECURSO CONTRA LA DECLARATORIA DE CADUCIDAD.- … Mi representada constituyó en tiempo la garantía de cierre de mina por US$ 180,000.00, según póliza que se acompaña, y ha ejecutado la revegetación de las áreas minadas. PIDO se revoque la resolución recurrida. [Firma] Apoderado(a)""",
  ['doc_solicitud', 'req_cierre'], 'Recurso de parte: trae req_cierre por la garantía y la revegetación, pero no firma de autoridad.')

b("""EVALUACIÓN AMBIENTAL — PLAN DE MANEJO
Programa de monitoreo: se medirá el ruido en el perímetro de la planta y las partículas PM10 junto al patio de acopio; los resultados se compararán con los valores de referencia. No se prevén descargas líquidas al exterior.""",
  ['doc_ambiental'], 'Documento ambiental sin agua, comunidad, cierre ni plazo: solo el tipo.')

b("""REPORTE DE ENSAYES — LabMinero Centroamericano FICT · Lote FICT-7781
Método: ensayo al fuego 30 g con acabado AA. Las muestras se lavaron con agua destilada antes de pulverizarlas a 85 % pasante malla 200.
[TABLA] Muestra | Au (g/t) | Ag (g/t)
FICT-11201 | 3.42 | 18.1
FICT-11202 | 0.18 | 2.4""",
  ['doc_tecnico'], 'El agua destilada del laboratorio no es fuente de agua: sin req_agua.')

b("""HOJA DE DATOS DE SEGURIDAD — CIANURO DE SODIO
Sección 6: medidas en caso de vertido accidental. Contener el derrame con arena seca, evitar el contacto con ácidos y no permitir que llegue a drenajes ni a cursos de agua. Usar equipo de respiración autónomo.""",
  ['doc_otro'], 'Regla elegida: la mención genérica de «cursos de agua» en una hoja de seguridad no nombra ninguna fuente del área, así que no lleva req_agua.')


def main():
    out = sys.argv[1]
    with open(out, 'w', encoding='utf-8') as fh:
        for f in B:
            fh.write(json.dumps(f, ensure_ascii=False) + '\n')
    print(len(B), 'bordes')


if __name__ == '__main__':
    main()
