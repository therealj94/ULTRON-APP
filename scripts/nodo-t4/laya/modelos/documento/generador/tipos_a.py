"""Piezas de resolución, contrato, ambiental y técnico, organizadas por subtipo."""
from comun import R, T, pool, seg, componer, subtipo, medio_de

# ================================================================== firmas de autoridad (genéricas)

F_INH = pool(
    T('COMUNÍQUESE Y NOTIFÍQUESE.\n[Firma y sello]\nDirector(a) Ejecutivo(a) INHGEOMIN\n[Firma y sello]\nSecretario(a) General', 'F'),
    T('NOTIFÍQUESE. (f) [Firma] Director(a) Ejecutivo(a). (f) [Firma] Secretario(a) General. [Sello del INHGEOMIN]', 'F'),
    T('CÚMPLASE.\n________________________\n[Firma y sello]\nSubdirector(a) Ejecutivo(a) por delegación\nINHGEOMIN', 'F'),
    T('COMUNÍQUESE. ‹Director(a) Ejecutivo(a)|DIRECTOR(A) EJECUTIVO(A)› — [firma ilegible] — [sello: INHGEOMIN · Dirección Ejecutiva]', 'F'),
    T('NOTIFÍQUESE Y CÚMPLASE.\n[Firma y sello]\nDirector(a) Ejecutivo(a)\nINSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS', 'F'),
    T('COMUNÍQUESE Y ARCHÍVESE.\n[Firma y sello] Director(a) Ejecutivo(a) — [Firma y sello] Secretario(a) General', 'F'),
)
F_CONST = pool(
    T('Y para los fines que al interesado convengan se extiende la presente en Tegucigalpa, a los {fecha_l}.\n[Firma y sello]\nSecretario(a) General', 'F'),
    T('Dado en la ciudad de Tegucigalpa, M.D.C., {fecha}.\n[Firma y sello]\nSecretario(a) General INHGEOMIN', 'F'),
    T('[Firma y sello]\nJefe(a) de la Unidad de Catastro Minero\nVo.Bo. Director(a) de Minas', 'F'),
    T('Extendida a solicitud de parte interesada, {fecha}. [Firma y sello] Registrador(a) Minero(a) — INHGEOMIN', 'F'),
    T('[Firma y sello]\nTesorero(a)\nInstituto Hondureño de Geología y Minas', 'F'),
)
F_AMB = pool(
    T('NOTIFÍQUESE Y CÚMPLASE.\n[Firma y sello]\nMinistro(a) de Recursos Naturales y Ambiente\n[Firma y sello]\nSecretario(a) General MiAmbiente', 'F'),
    T('COMUNÍQUESE.\n[Firma y sello]\nDirector(a) General de Evaluación y Control Ambiental (DECA)', 'F'),
    T('(f) [Firma] Viceministro(a) de Ambiente. (f) [Firma] Secretario(a) General. [Sello de la Secretaría]', 'F'),
    T('[Firma y sello]\nDirector(a) General de Recursos Hídricos\nSecretaría de Recursos Naturales y Ambiente', 'F'),
    T('Tegucigalpa, M.D.C., {fecha}. COMUNÍQUESE Y PUBLÍQUESE. [Firma y sello] Secretario(a) de Estado', 'F'),
)
F_SLAS = pool(
    T('[Firma y sello]\nCoordinador(a) del SLAS — MiAmbiente', 'F'),
    T('Emitida electrónicamente. [Sello digital MiAmbiente — SLAS] [Firma y sello] Técnico(a) evaluador(a)', 'F'),
)
F_MUNI = pool(
    T('[Firma y sello]\nAlcalde(sa) Municipal de {muni}\n[Firma y sello]\nSecretario(a) Municipal', 'F'),
    T('Extendida en {muni}, departamento de {depto}, a los {fecha_l}. [Firma y sello] Secretario(a) Municipal', 'F'),
    T('Firma y sello\n_______________\nAlcaldía Municipal de {muni}', 'F'),
    T('(f) [Firma] Alcalde(sa). (f) [Firma] Secretario(a). [Sello de la Municipalidad de {muni}, {depto}]', 'F'),
)
F_REG = pool(
    T('[Firma y sello]\nRegistrador(a) de la Propiedad\nSección Registral de {muni}', 'F'),
    T('Dada en {muni}, {fecha}. [Firma y sello del Registrador(a)] — Instituto de la Propiedad', 'F'),
)
F_DICT = pool(
    T('[Firma y sello]\nTécnico(a) de la Dirección de Minas\nVo.Bo. Director(a) de Minas', 'F'),
    T('Es todo cuanto se informa. [Firma y sello] Inspector(a) de Fiscalización Minera — INHGEOMIN', 'F'),
    T('[Firma y sello]\nProcurador(a) — Procuraduría General de la República', 'F'),
    T('Tegucigalpa, M.D.C., {fecha}. [Firma y sello] Especialista Ambiental DECA', 'F'),
    T('[Firma y sello] Jefe(a) de Asesoría Legal — INHGEOMIN', 'F'),
)

# ================================================================== resolución

RES_CAB_INH = pool(
    T('INSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS\n(INHGEOMIN)\nRESOLUCIÓN No. {res}\nINSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS. Tegucigalpa, Municipio del Distrito Central, {fecha_l}.', 'F'),
    T('RESOLUCIÓN No. {res}\nINHGEOMIN.- DIRECCIÓN EJECUTIVA.- Tegucigalpa, M.D.C., {fecha}.', 'F'),
    T('REPÚBLICA DE HONDURAS\nINSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS\nSecretaría General\nResolución número {res} · Expediente {exp}', 'F'),
    T('INHGEOMIN\nRESOLUCIÓN No. {res}\nEXPEDIENTE: {exp}\nSOLICITANTE: {empresa}\nASUNTO: ‹Otorgamiento de concesión minera de exploración|Otorgamiento de concesión de explotación|Renuncia parcial de área|Cesión de derechos mineros|Caducidad por falta de pago›', 'F'),
    T('RESOLUCIÓN {res}\nINSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS, DIRECCIÓN EJECUTIVA, Tegucigalpa, {fecha}.', 'F'),
    'INSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS.- DIRECCIÓN EJECUTIVA.- Tegucigalpa, Municipio del Distrito Central, {fecha_l}.',
)
RES_VISTO = pool(
    'VISTO: Para resolver la solicitud de otorgamiento de la concesión minera de ‹exploración|explotación› denominada «{concesion}», presentada por el apoderado legal de la sociedad {empresa}, con una extensión de {ha} hectáreas, ubicada en el municipio de {muni}, departamento de {depto}.',
    'VISTA: La solicitud de ‹renuncia parcial|cesión› de la concesión «{concesion}», contenida en el expediente {exp}, presentada ante la Secretaría General el {fecha2}.',
    T('VISTA: La solicitud de prórroga de vigencia de la concesión «{concesion}», contenida en el expediente {exp}, presentada antes de su vencimiento.', 'P'),
    'RESULTANDO: Que en fecha {fecha2} compareció ante este Instituto el apoderado de {empresa} solicitando el otorgamiento de un derecho minero no metálico denominado «{concesion}» para la extracción de ‹material de río|arena y grava|piedra caliza|material selecto›.',
    'RESULTANDO: Que la solicitud fue publicada en el Diario Oficial La Gaceta y en un diario de circulación nacional, sin que se presentara oposición.',
    'RESULTANDO: Que la Unidad de Asesoría Legal emitió dictamen favorable, al encontrarse completa la documentación y acreditada la representación de {empresa}.',
    'VISTO: El expediente administrativo {exp} relativo a la concesión «{concesion}», con domicilio del proyecto en la aldea {aldea}, municipio de {muni}.',
    'RESULTANDO: Que mediante providencia de fecha {fecha2} se requirió al titular presentar la solvencia del canon territorial y la constancia de inscripción.',
    'RESULTANDO: Que la sociedad {empresa} acreditó la solvencia del canon territorial del año {anio} mediante el recibo {fict}.',
)
RES_CONS = pool(
    'CONSIDERANDO: Que de conformidad con el artículo {art} de la Ley General de Minería corresponde a la Autoridad Minera el otorgamiento, suspensión y cancelación de los derechos mineros.',
    'CONSIDERANDO: Que el solicitante ha cumplido con los requisitos legales y técnicos exigidos por la Ley General de Minería y su Reglamento.',
    'CONSIDERANDO: Que la Dirección de Minas, mediante dictamen técnico, recomienda aprobar el programa de exploración que contempla mapeo geológico, muestreo de superficie y {n} sondajes.',
    'CONSIDERANDO: Que el Instituto de Conservación Forestal informó que el área solicitada no se encuentra dentro de áreas protegidas ni zonas de amortiguamiento.',
    'CONSIDERANDO: Que la Procuraduría General de la República emitió dictamen en el sentido de que es procedente acceder a lo solicitado.',
    'CONSIDERANDO: Que el titular no acreditó el pago del canon territorial de los años {anio} y siguientes, lo que constituye causal de caducidad.',
    'CONSIDERANDO: Que la cesión de derechos fue otorgada en escritura pública y cumple con lo dispuesto en el artículo {art} de la Ley.',
    'CONSIDERANDO: Que el área de la concesión no se traslapa con derechos mineros vigentes ni con solicitudes en trámite con prelación, según el Registro Minero y Catastral.',
)
RES_CONS_C = pool(
    T('CONSIDERANDO: Que la Unidad de Catastro Minero verificó que el área solicitada queda delimitada por las coordenadas UTM siguientes (Datum {datum}, Zona 16): {coords_inline}.', 'C'),
    T('CONSIDERANDO: Que el polígono de la concesión, de {ha} ha, se define por los vértices siguientes:\n{coords_tabla}', 'C'),
    T('CONSIDERANDO: Que conforme al plano revisado por Catastro Minero el área se describe así: {rumbos}.', 'C'),
    T('CONSIDERANDO: Que la renuncia parcial reduce el área a {ha} ha, quedando el nuevo polígono con los vértices {coords_inline} (UTM zona 16N, {datum}).', 'C'),
    T('CONSIDERANDO: Que el inmueble donde se ubica el plantel colinda {linderos}.', 'C'),
    T('CONSIDERANDO: Que el área otorgada comprende los vértices siguientes, referidos al Datum {datum}:\n{coords_tabla}', 'C'),
)
RES_CONS_A = pool(
    T('CONSIDERANDO: Que la Dirección General de Recursos Hídricos emitió opinión favorable condicionada a respetar una franja de protección de {m} metros a ambos lados de la quebrada {quebrada}.', 'A'),
    T('CONSIDERANDO: Que el área del proyecto se encuentra dentro de la microcuenca del río {rio}, fuente de abastecimiento de agua de la cabecera municipal de {muni}.', 'A'),
    T('CONSIDERANDO: Que el titular solicitó el aprovechamiento de {q} litros por segundo de la quebrada {quebrada} para uso industrial en la planta de beneficio.', 'A'),
    T('CONSIDERANDO: Que la inspección constató arrastre de sedimentos hacia el cauce del río {rio}, aguas abajo de la zona de extracción.', 'A'),
    T('CONSIDERANDO: Que los análisis de calidad de agua presentados muestran arsénico y sólidos suspendidos por encima de la norma técnica en la quebrada {quebrada}.', 'A'),
)
RES_CONS_M = pool(
    T('CONSIDERANDO: Que en cumplimiento del Convenio 169 de la OIT se realizó el proceso de consulta previa, libre e informada con el consejo indígena {pueblo} de {aldea}.', 'M'),
    T('CONSIDERANDO: Que el proyecto fue socializado con el patronato de la aldea {aldea} y en cabildo abierto convocado por la Corporación Municipal de {muni}.', 'M'),
    T('CONSIDERANDO: Que se recibió oposición firmada por vecinos de la comunidad de {aldea}, quienes alegan afectación a sus cultivos y al camino vecinal.', 'M'),
    T('CONSIDERANDO: Que el titular suscribió acta de acuerdos con el patronato de {aldea} sobre contratación de mano de obra local.', 'M'),
    T('CONSIDERANDO: Que en el área de influencia habitan comunidades del pueblo {pueblo}, cuyos derechos territoriales deben respetarse.', 'M'),
)
RES_CONS_AM = pool(
    T('CONSIDERANDO: Que la junta administradora de agua de la aldea {aldea} manifestó preocupación por la naciente que abastece a la comunidad, ubicada aguas arriba del proyecto.', 'AM'),
    T('CONSIDERANDO: Que los pobladores de {aldea} denunciaron turbidez en la quebrada {quebrada}, de la cual se abastecen para consumo doméstico.', 'AM'),
    T('CONSIDERANDO: Que en la asamblea comunitaria se acordó que la empresa no captará agua de la quebrada {quebrada} en época seca.', 'AM'),
    T('CONSIDERANDO: Que el patronato de {aldea} solicitó la protección de la microcuenca que surte el sistema de agua comunitario.', 'AM'),
)
RES_CONS_X = pool(
    T('CONSIDERANDO: Que el solicitante presentó el Plan de Cierre y Rehabilitación de la mina, así como la garantía de cierre por un monto de {usd}.', 'X'),
    T('CONSIDERANDO: Que el titular no ha constituido la fianza de cierre de mina exigida por el Reglamento.', 'X'),
    T('CONSIDERANDO: Que la inspección verificó la revegetación de las áreas minadas y la estabilización de taludes conforme al plan de cierre aprobado.', 'X'),
    T('CONSIDERANDO: Que el abandono de labores subterráneas sin sellado de bocaminas representa un riesgo para terceros.', 'X'),
)
RES_POR = pool(
    'POR TANTO: Este Instituto, en uso de las facultades que la Ley le confiere y con fundamento en los artículos {art} y {art2} de la Ley General de Minería, RESUELVE:',
    'POR TANTO: Con base en lo expuesto y en los artículos citados, esta Dirección Ejecutiva RESUELVE:',
    'POR TANTO, en uso de sus facultades, RESUELVE:',
    'POR TANTO: La Dirección Ejecutiva del INHGEOMIN, en aplicación de los artículos {art}, {art2} y demás aplicables, RESUELVE:',
)
RES_RESUELVE = pool(
    'PRIMERO: Declarar CON LUGAR la solicitud presentada por {empresa} y otorgar la concesión minera denominada «{concesion}», con una extensión de {ha} hectáreas.',
    'PRIMERO: Declarar SIN LUGAR la solicitud por no haberse subsanado los requerimientos formulados. SEGUNDO: Archívense las presentes diligencias.',
    'PRIMERO: Declarar la caducidad de la concesión «{concesion}» por falta de pago del canon territorial. SEGUNDO: Liberar el área y comunicarlo al Registro Minero.',
    'PRIMERO: Aprobar la cesión de derechos mineros de la concesión «{concesion}» a favor de {empresa2}. SEGUNDO: Inscríbase en el Registro Minero y Catastral.',
    'SEGUNDO: Ordenar la inscripción de la presente resolución en el Registro Minero y Catastral. TERCERO: Remitir copia a la Dirección de Fiscalización Minera.',
    'PRIMERO: Tener por desistida la solicitud y ordenar el cierre del expediente. SEGUNDO: Devuélvanse los documentos originales al interesado.',
    'PRIMERO: Aprobar el Plan de Labores presentado para el año {anio}, que contempla la apertura de {n} trincheras y el muestreo de canal.',
    'PRIMERO: Imponer al titular una multa equivalente a {n} salarios mínimos por incumplimiento de las medidas de seguridad minera.',
)
RES_RESUELVE_P = pool(
    T('PRIMERO: Otorgar a la sociedad {empresa} la concesión minera de explotación «{concesion}» por un plazo de {anios} años, contados a partir de su inscripción.', 'P'),
    T('SEGUNDO: El titular deberá presentar dentro del plazo de {dias} días hábiles el Plan de Labores y el comprobante de pago del canon.', 'P'),
    T('TERCERO: Requerir al titular para que en el término de {dias_l} días subsane lo observado, bajo apercibimiento de tener por abandonada la solicitud.', 'P'),
    T('SEGUNDO: El derecho otorgado tendrá una vigencia de {anios} años y podrá prorrogarse a solicitud del titular presentada antes de su vencimiento.', 'P'),
    T('PRIMERO: Conceder prórroga de {dias} días hábiles, improrrogables, para presentar el estudio requerido.', 'P'),
    T('TERCERO: La presente autorización vence el {fecha_futura}; vencido este término sin renovación quedará sin valor.', 'P'),
    T('CUARTO: El titular deberá pagar el canon territorial a más tardar el 31 de enero de cada año.', 'P'),
    T('SEGUNDO: Otorgar un término de {dias} días calendario para retirar la maquinaria del área, contados desde la notificación.', 'P'),
)
RES_RESUELVE_A = pool(
    T('TERCERO: El titular deberá monitorear la calidad del agua aguas arriba y aguas abajo del proyecto en la quebrada {quebrada} y reportar los resultados en el ICMA.', 'A'),
    T('CUARTO: Queda prohibida la descarga de aguas residuales o sedimentos al río {rio} y a sus afluentes.', 'A'),
    T('TERCERO: Se autoriza el uso de agua de la quebrada {quebrada} hasta un caudal de {q} l/s, sujeto a la disponibilidad en época seca.', 'A'),
    T('QUINTO: El titular deberá proteger la naciente ubicada dentro del área, manteniendo un radio de exclusión de {m} metros.', 'A'),
)
RES_RESUELVE_X = pool(
    T('CUARTO: Aprobar el Plan de Cierre de Mina presentado y ordenar la constitución de garantía de cierre por {usd}.', 'X'),
    T('QUINTO: Al concluir la explotación el titular ejecutará la rehabilitación del área, el relleno de fosas y la revegetación con especies nativas.', 'X'),
    T('TERCERO: Ordenar el cierre técnico y el sellado de las bocaminas abandonadas dentro del área.', 'X'),
    T('SEXTO: La garantía de cierre se liberará una vez verificada la rehabilitación de las áreas intervenidas.', 'X'),
    T('QUINTO: El titular deberá presentar el plan de cierre actualizado y la fianza de cierre en un plazo de {dias} días hábiles.', 'XP'),
    T('CUARTO: La garantía de cierre deberá mantenerse vigente durante toda la vida útil de la mina y {anios} años después del cierre.', 'XP'),
)

# MiAmbiente
AMBR_CAB = pool(
    T('SECRETARÍA DE ESTADO EN LOS DESPACHOS DE RECURSOS NATURALES Y AMBIENTE (MiAmbiente)\nRESOLUCIÓN No. {res}\nTegucigalpa, M.D.C., {fecha}.', 'F'),
    T('SERNA\nSecretaría de Recursos Naturales y Ambiente\nDirección de Evaluación y Control Ambiental (DECA)\nResolución No. {res}', 'F'),
    T('LICENCIA AMBIENTAL No. {res}\nMiAmbiente — Dirección de Evaluación y Control Ambiental\nProyecto: «{concesion}»\nProponente: {empresa}', 'F'),
    'SECRETARÍA DE RECURSOS NATURALES Y AMBIENTE.- Tegucigalpa, M.D.C., {fecha}.- La Dirección de Evaluación y Control Ambiental, vista la solicitud de licencia ambiental del expediente {exp},',
    T('MiAmbiente\nRESOLUCIÓN DE CATEGORIZACIÓN AMBIENTAL No. {res}\nExpediente {exp}', 'F'),
)
AMBR_VISTO = pool(
    'VISTA: La solicitud de licencia ambiental del proyecto «{concesion}», categoría ‹2|3|4›, presentada por {empresa} en el expediente {exp}.',
    'RESULTANDO: Que el proponente presentó el Estudio de Impacto Ambiental elaborado por {consultora}, el cual fue revisado por el equipo técnico de la DECA.',
    'RESULTANDO: Que se practicó inspección de campo al sitio del proyecto, ubicado en el municipio de {muni}, departamento de {depto}.',
    'CONSIDERANDO: Que la Ley General del Ambiente establece que toda actividad que pueda causar deterioro ambiental requiere evaluación de impacto ambiental previa.',
    'CONSIDERANDO: Que el Contrato de Medidas de Mitigación fue suscrito por el proponente y forma parte integral de la licencia.',
)
AMBR_RESUELVE = pool(
    'PRIMERO: Otorgar Licencia Ambiental al proyecto «{concesion}» a favor de {empresa}, sujeta al cumplimiento de las medidas de control ambiental.',
    'PRIMERO: Categorizar el proyecto en la Categoría ‹2|3› de la Tabla de Categorización Ambiental.',
    'PRIMERO: Denegar la licencia ambiental solicitada por no haberse presentado la información complementaria requerida.',
    'SEGUNDO: El proponente deberá contar con un regente ambiental durante toda la operación del proyecto.',
)
AMBR_RESUELVE_T = pool(
    T('SEGUNDO: La licencia ambiental tendrá una vigencia de {anios} años y deberá renovarse con {meses} meses de anticipación a su vencimiento.', 'P'),
    T('TERCERO: El proponente presentará el Informe de Cumplimiento de Medidas cada seis meses, a más tardar el último día hábil del semestre.', 'P'),
    T('TERCERO: Monitorear la calidad del agua de la quebrada {quebrada} aguas arriba y aguas abajo de la descarga y reportar a la DECA.', 'A'),
    T('CUARTO: Se prohíbe el uso de mercurio y la descarga de relaves al río {rio}.', 'A'),
    T('QUINTO: Mantener el mecanismo de atención de quejas de las comunidades de {aldea} y {aldea2}.', 'M'),
    T('SEXTO: Presentar el plan de cierre y rehabilitación con su garantía antes del inicio de la explotación.', 'X'),
    T('CUARTO: Otorgar un plazo de {dias} días para subsanar las observaciones del dictamen técnico.', 'P'),
)

AUTO_CAB = pool(
    'AUTO.- INSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS.- Tegucigalpa, M.D.C., {fecha}.- Visto el escrito presentado por el apoderado legal de la sociedad {empresa}, contraído a ‹solicitar prórroga|acompañar documentos|subsanar lo requerido›, en el expediente {exp}.',
    'PROVIDENCIA.- SECRETARÍA GENERAL DEL INHGEOMIN.- {fecha}.- Admítase el escrito que antecede y agréguese a sus antecedentes en el expediente {exp}.',
    'PROVIDENCIA.- Tegucigalpa, {fecha}.- Pase el expediente {exp} a la Unidad de Catastro Minero para que emita el dictamen correspondiente.',
    'AUTO DE ADMISIÓN.- INHGEOMIN, Secretaría General, {fecha}.- Por recibida la solicitud de concesión «{concesion}» con sus anexos; fórmese el expediente {exp}.',
    'PROVIDENCIA.- Tegucigalpa, M.D.C., {fecha}.- Téngase por personado al apoderado de {empresa} y extiéndasele copia de lo solicitado.',
)
AUTO_CUERPO = pool(
    T('Se concede al peticionario un término de {dias_l} días hábiles para que subsane las omisiones señaladas.', 'P'),
    T('Se otorga la prórroga solicitada por un término de {dias} días, contados a partir de la notificación de la presente.', 'P'),
    'Se ordena la publicación de los avisos de ley en el Diario Oficial La Gaceta.',
    'Remítase a la Unidad de Asesoría Legal para su dictamen.',
    'Agréguense los documentos acompañados y téngase presente lo expuesto para resolver.',
)
F_AUTO = pool(
    T('NOTIFÍQUESE. [Firma y sello] Secretario(a) General', 'F'),
    T('CÚMPLASE. [Firma y sello] Director(a) Ejecutivo(a) — [Firma y sello] Secretario(a) General', 'F'),
)

CONST_CAB_INH = pool(
    'CONSTANCIA\nEl(la) infrascrito(a) Secretario(a) General del Instituto Hondureño de Geología y Minas (INHGEOMIN), HACE CONSTAR:',
    'CERTIFICACIÓN DE INSCRIPCIÓN\nREGISTRO MINERO Y CATASTRAL — INHGEOMIN\nEl(la) Registrador(a) Minero(a) CERTIFICA:',
    'CONSTANCIA DE SOLVENCIA\nLa Tesorería del INHGEOMIN hace constar:',
    T('CONSTANCIA DE VIGENCIA DE DERECHO MINERO\nEl Instituto Hondureño de Geología y Minas hace constar:', 'P'),
    'CERTIFICACIÓN\nLa Secretaría General del INHGEOMIN certifica la Resolución No. {res}, que literalmente dice en su parte resolutiva:',
)
CONST_CUERPO_INH = pool(
    'Que la sociedad {empresa} es titular de la concesión minera «{concesion}», inscrita en el Registro Minero bajo el asiento {fict}, con una extensión de {ha} hectáreas.',
    'Que la sociedad {empresa} se encuentra solvente en el pago del canon territorial hasta el año {anio}.',
    'Que sobre la concesión «{concesion}» no pesan anotaciones de embargo, caducidad ni suspensión.',
    'Que el titular presentó los informes semestrales de producción correspondientes al año {anio}.',
)
CONST_CUERPO_INH_T = pool(
    T('Que la concesión «{concesion}» se encuentra vigente hasta el {fecha_futura}.', 'P'),
    T('Que el derecho minero fue otorgado por {anios} años y vence el {fecha_futura}.', 'P'),
    T('Que el titular tiene constituida garantía de cierre de mina vigente hasta el {fecha_futura}.', 'XP'),
    T('Que el titular presentó el plan de cierre de mina, aprobado por la Dirección de Fiscalización Minera.', 'X'),
)
CONST_CAB_CAT = pool(
    'CONSTANCIA DE NO TRASLAPE\nLa Unidad de Catastro Minero del INHGEOMIN hace constar:',
    'CONSTANCIA CATASTRAL\nUnidad de Catastro Minero — INHGEOMIN\nSolicitud: {exp}',
    'CERTIFICACIÓN CATASTRAL\nEl(la) Jefe(a) de Catastro Minero certifica:',
    'CONSTANCIA DE UBICACIÓN\nCatastro Minero hace constar, para efectos de la solicitud {exp}:',
)
CONST_CUERPO_CAT = pool(
    'Que el área consultada, ubicada en el municipio de {muni}, no se traslapa con concesiones mineras otorgadas ni con solicitudes en trámite.',
    'Que el área presenta un traslape parcial de {ha} ha con la concesión «{concesion2}», que tiene prelación.',
    'Que el área no se ubica dentro de zonas de reserva ni de áreas protegidas declaradas.',
)
CONST_CUERPO_CAT_C = pool(
    T('Que el área consultada queda comprendida entre los vértices {coords_inline}.', 'C'),
    T('Coordenadas del área consultada (UTM 16N, {datum}):\n{coords_tabla}', 'C'),
    T('Que el polígono evaluado se describe así: {rumbos}.', 'C'),
)
CERT_MUNI_CAB = pool(
    'CERTIFICACIÓN\nEl(la) infrascrito(a) Secretario(a) Municipal de {muni}, departamento de {depto}, CERTIFICA: El punto número {n} del Acta No. {n2} de la sesión ordinaria de la Corporación Municipal, que literalmente dice:',
    'CONSTANCIA MUNICIPAL\nLa Unidad Municipal Ambiental (UMA) de {muni}, {depto}, hace constar:',
    'PERMISO DE OPERACIÓN No. {res}\nMunicipalidad de {muni}, {depto}\nActividad: extracción de ‹material pétreo|oro aluvial|arena›',
    'CERTIFICACIÓN DE PUNTO DE ACTA\nMunicipalidad de {muni}. La Secretaría Municipal certifica el acuerdo de la Corporación:',
)
CERT_MUNI_CUERPO = pool(
    'Que en la sesión de fecha {fecha2} la Corporación Municipal acordó emitir dictamen favorable al proyecto minero «{concesion}».',
    'Que el proyecto «{concesion}» cuenta con solvencia municipal y ha pagado los impuestos correspondientes al año {anio}.',
    'Se autoriza a {empresa} la operación en el sitio conocido como «{concesion}», con horario de 6:00 a 17:00 horas.',
)
CERT_MUNI_T = pool(
    T('ACUERDA: Otorgar el permiso de operación condicionado a que la empresa no utilice el agua de la quebrada {quebrada}, fuente de la comunidad de {aldea}.', 'AM'),
    T('El acuerdo se tomó previa consulta en cabildo abierto con los vecinos de las aldeas {aldea} y {aldea2}, quienes votaron a favor.', 'M'),
    T('El permiso tiene una vigencia de un año y deberá renovarse antes del {fecha_futura}.', 'P'),
    T('La empresa deberá presentar a la UMA, en un plazo de {dias} días, el plan de restauración y cierre de las áreas de extracción.', 'XP'),
    T('Queda prohibido extraer material del cauce del río {rio} durante la época de lluvias.', 'A'),
    T('La Corporación deja constancia de la oposición del patronato de {aldea}, que se registró en el acta.', 'M'),
)
CERT_REG_CAB = pool(
    'CERTIFICACIÓN REGISTRAL\nINSTITUTO DE LA PROPIEDAD — Registro de la Propiedad Inmueble y Mercantil, Sección Registral de {muni}. El(la) infrascrito(a) Registrador(a) CERTIFICA:',
    'CERTIFICACIÓN DE DOMINIO\nInstituto de la Propiedad, Sección Registral de {muni}. El(la) Registrador(a) certifica:',
    'CERTIFICACIÓN ÍNTEGRA DE ASIENTO\nRegistro de la Propiedad de {muni}, {depto}',
)
CERT_REG_CUERPO = pool(
    'Que el inmueble inscrito bajo la matrícula {fict} a favor de {empresa} no tiene gravámenes ni anotaciones preventivas.',
    'Que el inmueble tiene una extensión de {mz} manzanas y se ubica en la aldea {aldea}, jurisdicción de {muni}.',
    'Que consta la inscripción de la compraventa otorgada en escritura pública número {n} ante Notario(a).',
)
CERT_REG_T = pool(
    T('Que el inmueble tiene las colindancias siguientes: {linderos}.', 'C'),
    T('Que el inmueble colinda {linderos_q}.', 'CA'),
    T('Que según el plano inscrito sus medidas y rumbos son: {rumbos}.', 'C'),
)
SLAS_CAB = pool(
    'CONSTANCIA DE REGISTRO AMBIENTAL\nSistema de Licenciamiento Ambiental Simplificado (SLAS)\nRegistro {exp}',
    'SLAS — MiAmbiente\nCONSTANCIA DE CATEGORIZACIÓN\nProyecto: «{concesion}» · Proponente: {empresa}',
    'REGISTRO AMBIENTAL CATEGORÍA 1\nSLAS · Número de registro {exp}\nActividad: extracción de material pétreo',
)
SLAS_CUERPO = pool(
    'Que el proyecto «{concesion}» de extracción de ‹material pétreo|arena|grava› fue registrado en la categoría ‹1|2› del SLAS.',
    'El proponente declaró bajo juramento cumplir con la Guía de Buenas Prácticas Ambientales para su categoría.',
)
SLAS_T = pool(
    T('Que el registro ambiental tiene una vigencia de {anios} años a partir de su emisión, debiendo renovarse antes de su vencimiento.', 'P'),
    T('La extracción no podrá realizarse en el cauce activo de la quebrada {quebrada} ni a menos de {m} m de sus márgenes.', 'A'),
    T('Al finalizar la extracción el proponente rellenará y revegetará el área intervenida.', 'X'),
)

DICT_CAB = pool(
    'DICTAMEN TÉCNICO No. {res}\nDIRECCIÓN DE MINAS — INHGEOMIN\nPara: Secretaría General\nAsunto: Revisión del Plan de Labores, expediente {exp}',
    'DICTAMEN LEGAL No. {res}\nUnidad de Asesoría Legal — INHGEOMIN\nExpediente: {exp}',
    'PROCURADURÍA GENERAL DE LA REPÚBLICA\nDICTAMEN No. {res}\nMateria: Derechos mineros — Expediente {exp}',
    'INFORME DE INSPECCIÓN DE CAMPO No. {res}\nDirección de Fiscalización Minera — INHGEOMIN',
    'ACTA DE INSPECCIÓN\nEn el sitio denominado «{concesion}», jurisdicción de {muni}, siendo las {hora} horas del {fecha}, se constituyó el(la) inspector(a) de la Dirección de Fiscalización Minera del INHGEOMIN.',
    'DICTAMEN TÉCNICO AMBIENTAL No. {res}\nDECA — MiAmbiente\nProyecto: {concesion}',
    'DICTAMEN TÉCNICO\nUnidad de Catastro Minero — INHGEOMIN\nExpediente {exp}',
    'INFORME TÉCNICO DE VERIFICACIÓN\nDirección de Minas — INHGEOMIN\nConcesión «{concesion}»',
)
DICT_CUERPO = pool(
    'Revisada la información geológica presentada, el programa de {n} sondajes diamantinos con una profundidad promedio de {prof} m es técnicamente aceptable.',
    'Se verificó que la documentación legal presentada está completa y que el apoderado acredita representación suficiente; por lo que se OPINA que es procedente continuar el trámite.',
    'En la visita se observaron {n} frentes de trabajo activos, una planta de beneficio artesanal con rastras y ausencia de señalización de seguridad.',
    'Los volúmenes reportados en el informe de producción no coinciden con lo observado en el patio de acopio.',
    'El plan de minado propuesto por corte y relleno es consistente con la geometría de la veta y el ancho de minado de {m} m.',
    'Se recomienda requerir al titular la actualización del registro de trabajadores y del libro de voladuras.',
    'Ploteada el área en el sistema de catastro, no se detecta traslape con derechos vigentes.',
    'El Estudio de Impacto Ambiental cumple con los términos de referencia; se recomienda otorgar la licencia con las medidas propuestas.',
)
DICT_CUERPO_T = pool(
    T('Se georreferenciaron los mojones de la concesión: {coords_inline}; coinciden con el polígono inscrito.', 'C'),
    T('Se constató descarga de lodos de la planta hacia la quebrada {quebrada} sin tratamiento previo.', 'A'),
    T('Pobladores de {aldea} se presentaron durante la inspección manifestando su inconformidad por el polvo y el paso de volquetas.', 'M'),
    T('Se verificó que las áreas ya explotadas no han sido rehabilitadas ni revegetadas conforme al plan de cierre.', 'X'),
    T('Se recomienda otorgar al titular un plazo de {dias} días para corregir las observaciones.', 'P'),
    T('El punto de captación en la quebrada {quebrada} carece de medidor de caudal y el permiso de uso de agua está vencido.', 'AP'),
    T('El área solicitada queda delimitada por los vértices:\n{coords_tabla}', 'C'),
    T('Durante la inspección se entrevistó a miembros del patronato de {aldea}, quienes manifestaron no haber sido consultados.', 'M'),
)
DICT_COLA_NEUTRA = pool(
    'Se adjunta registro fotográfico y croquis de la visita.',
    'Salvo mejor criterio de la superioridad.',
    'Es todo cuanto se informa para los fines consiguientes.',
)

NOTIF = pool(
    T('CÉDULA DE NOTIFICACIÓN\nEn la ciudad de Tegucigalpa, a las {hora} horas del {fecha}, notifiqué al apoderado legal de {empresa} la Resolución No. {res}, entregándole copia íntegra de la misma.', 'F'),
    T('NOTIFICACIÓN\nSe hace saber a {empresa} que en el expediente {exp} se dictó la Resolución No. {res}, cuya parte resolutiva dice: «PRIMERO: ...». Queda notificado(a).', 'F'),
    'OFICIO No. {res}\nSeñores\n{empresa}\nPresente\nPor instrucciones de la Dirección Ejecutiva se les comunica lo siguiente:',
    'OFICIO No. {res}\nAl titular de la concesión «{concesion}»\nAsunto: Requerimiento de pago de canon en mora',
    'CITACIÓN\nSe cita al representante legal de {empresa} para comparecer a audiencia en la Secretaría General del INHGEOMIN.',
    'AVISO\nMiAmbiente comunica a {empresa} lo relativo a la licencia ambiental del proyecto «{concesion}».',
)
NOTIF_CUERPO = pool(
    T('Se les requiere presentar en un plazo no mayor de {dias} días hábiles el informe semestral de producción.', 'P'),
    T('Se le requiere cancelar el canon de los años pendientes a más tardar el {fecha_prox}.', 'P'),
    T('La audiencia se celebrará el {fecha_prox} a las {hora} horas; su inasistencia se tendrá por renuncia al trámite.', 'P'),
    T('La licencia ambiental vence el {fecha_futura}; deberá presentar la solicitud de renovación antes de esa fecha.', 'P'),
    'Se le entrega copia íntegra de la resolución y de los dictámenes que le sirven de fundamento.',
    T('Se le comunica que deberá suspender las descargas a la quebrada {quebrada} hasta nueva inspección.', 'A'),
)
F_NOTIF = pool(
    T('[Firma y sello] Receptor(a) de la Secretaría General — Firma del notificado: [Firma]', 'F'),
    T('[Firma y sello] Notificador(a) INHGEOMIN', 'F'),
    T('[Firma y sello]\nDirector(a) de Fiscalización Minera', 'F'),
    T('[Firma y sello] Tesorero(a) INHGEOMIN', 'F'),
    T('[Sello de la DECA] [Firma y sello] Director(a) General', 'F'),
)

RES_SUBS = [
    (26, dict(cab=RES_CAB_INH, cuerpo=[(RES_VISTO, 1), (RES_CONS, .6), (RES_CONS_C, .45), (RES_CONS_A, .12), (RES_CONS_M, .1),
                                       (RES_CONS_AM, .05), (RES_CONS_X, .13)],
              cola=[(RES_POR, .8), (RES_RESUELVE, .55), (RES_RESUELVE_P, .6), (RES_RESUELVE_A, .1), (RES_RESUELVE_X, .2), (F_INH, .88)],
              memb='INSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS')),
    (10, dict(cab=AMBR_CAB, cuerpo=[(AMBR_VISTO, 1), (AMBR_VISTO, .4), (RES_CONS_A, .3), (RES_CONS_M, .2), (RES_CONS_AM, .1), (RES_CONS_C, .1)],
              cola=[(AMBR_RESUELVE, .8), (AMBR_RESUELVE_T, .7), (AMBR_RESUELVE_T, .35), (F_AMB, .85)],
              memb='MiAmbiente — Secretaría de Recursos Naturales y Ambiente')),
    (7, dict(cab=AUTO_CAB, cuerpo=[(AUTO_CUERPO, 1), (AUTO_CUERPO, .3)], cola=[(F_AUTO, .7)], memb='INHGEOMIN — Secretaría General')),
    (8, dict(cab=CONST_CAB_INH, cuerpo=[(CONST_CUERPO_INH, 1), (CONST_CUERPO_INH_T, .55)], cola=[(F_CONST, .9)], memb='INHGEOMIN')),
    (6, dict(cab=CONST_CAB_CAT, cuerpo=[(CONST_CUERPO_CAT, 1), (CONST_CUERPO_CAT_C, .85)], cola=[(F_CONST, .85)], memb='INHGEOMIN — Catastro Minero')),
    (6, dict(cab=CERT_MUNI_CAB, cuerpo=[(CERT_MUNI_CUERPO, 1), (CERT_MUNI_T, .6), (CERT_MUNI_T, .3)], cola=[(F_MUNI, .88)], memb='MUNICIPALIDAD')),
    (4, dict(cab=CERT_REG_CAB, cuerpo=[(CERT_REG_CUERPO, 1), (CERT_REG_T, .75)], cola=[(F_REG, .9)], memb='INSTITUTO DE LA PROPIEDAD')),
    (4, dict(cab=SLAS_CAB, cuerpo=[(SLAS_CUERPO, 1), (SLAS_T, .7), (SLAS_T, .35)], cola=[(F_SLAS, .85)], memb='MiAmbiente — SLAS')),
    (16, dict(cab=DICT_CAB, cuerpo=[(DICT_CUERPO, 1), (DICT_CUERPO_T, .6), (DICT_CUERPO_T, .3)], cola=[(DICT_COLA_NEUTRA, .3), (F_DICT, .8)],
              memb='INHGEOMIN')),
    (7, dict(cab=NOTIF, cuerpo=[(NOTIF_CUERPO, .85)], cola=[(F_NOTIF, .9)], memb='INHGEOMIN — Secretaría General')),
]


def g_resolucion(c):
    s = subtipo(RES_SUBS)
    cab, cola = componer(c, s)
    return cab, cola, s['memb']


def medio_resolucion(c):
    return medio_de(RES_SUBS, c)


# ================================================================== contrato

CON_COLA = pool(
    'En fe de lo cual firmamos el presente contrato en dos ejemplares de igual valor en la ciudad de {muni}, a los {fecha_l}.\n[Firma] Primera parte          [Firma] Segunda parte',
    'Y yo, el(la) Notario(a), doy fe de todo lo relacionado, de haber leído íntegramente este instrumento a los comparecientes, quienes lo ratifican y firman. [Firma] [Firma] [Firma y sello del Notario(a)]',
    'Las partes aceptan el contenido de todas y cada una de las cláusulas y firman para constancia. [Firma] Representante legal — [Firma] Representante legal',
    'Leído que fue el presente, los comparecientes lo aceptan y firman. Doy fe. [Firma y sello del Notario(a)]',
    'Firmado en {muni}, {fecha}.\n________________ PRIMERA PARTE\n________________ SEGUNDA PARTE\nTestigo: ________________',
    'Autenticación: el(la) suscrito(a) Notario(a) da fe de que las firmas que anteceden son auténticas. [Firma y sello]',
)
CON_COLA_F = pool(
    T('Inscrito bajo el número {n} del Tomo {nn} del Registro de la Propiedad Inmueble y Mercantil, Sección Registral de {muni}. {fecha}. [Firma y sello] Registrador(a)', 'F'),
    T('RAZÓN: Inscrita la presente cesión en el Registro Minero y Catastral del INHGEOMIN bajo el asiento {fict}. [Firma y sello] Registrador(a) Minero(a)', 'F'),
)
C_PLAZO = pool(
    T('PLAZO. El plazo del presente contrato es de {anios} años, contados a partir de su firma, prorrogable por períodos iguales si ninguna de las partes da aviso con {meses} meses de anticipación.', 'P'),
    T('VIGENCIA. El presente instrumento tendrá vigencia de {anios} años a partir de su firma y vencerá el {fecha_futura}.', 'P'),
    T('DURACIÓN. El contrato durará {meses} meses; vencido el plazo podrá renovarse por escrito.', 'P'),
    T('TÉRMINO. Las obligaciones deberán cumplirse a más tardar el {fecha_futura}; el incumplimiento dará derecho a resolver el contrato.', 'P'),
)
C_LIND = pool(
    T('El inmueble tiene las colindancias siguientes: {linderos}.', 'C'),
    T('El predio colinda {linderos_q}.', 'CA'),
    T('El área objeto del contrato está delimitada por los vértices {coords_inline} (UTM, {datum}).', 'C'),
    T('El lote se describe así: {rumbos}; con un área de {mz} manzanas.', 'C'),
)
C_AGUA = pool(
    T('USO DEL AGUA. LA ARRENDATARIA podrá captar agua de la quebrada {quebrada} para uso doméstico del campamento, respetando el caudal ecológico.', 'A'),
    T('LA EMPRESA no podrá desviar ni contaminar el cauce del río {rio} que atraviesa el inmueble.', 'A'),
    T('Queda excluida del arrendamiento la naciente ubicada al norte del predio y su área de protección de {m} metros.', 'A'),
)
C_CIERRE = pool(
    T('RESTAURACIÓN. Al término del contrato LA ARRENDATARIA rehabilitará el terreno, rellenará las excavaciones y reforestará las áreas intervenidas.', 'X'),
    T('Al abandonar las labores, EL OPERADOR ejecutará el plan de cierre aprobado y mantendrá la fianza de cierre hasta su liberación.', 'X'),
    T('Los costos del cierre de mina y de la garantía de cierre se distribuirán entre las partes en proporción a su participación.', 'X'),
)
C_COMUN = pool(
    T('RELACIONES CON LA COMUNIDAD. LA EMPRESA contratará preferentemente mano de obra de la aldea {aldea} y aportará al patronato para el mantenimiento del camino.', 'M'),
    T('Las partes reconocen los derechos del pueblo {pueblo} sobre las tierras comunales colindantes y se obligan a no intervenirlas.', 'M'),
    T('LA EMPRESA atenderá las quejas de los vecinos de {aldea} por medio de un comité conjunto con el patronato.', 'M'),
)
ARR_CAB = pool(
    'CONTRATO DE ARRENDAMIENTO DE TERRENO\nComparecen el(la) propietario(a) del inmueble, mayor de edad, agricultor(a) y vecino(a) de la aldea {aldea}, en adelante «EL ARRENDADOR», y el(la) Gerente General de la sociedad {empresa}, en adelante «LA ARRENDATARIA», quienes celebran el presente contrato de arrendamiento:',
    'CONTRATO PRIVADO DE USUFRUCTO\nEntre el(la) propietario(a) del inmueble ubicado en {aldea}, municipio de {muni}, y la {empresa}, se celebra el presente contrato de usufructo.',
    'CONTRATO DE ARRENDAMIENTO DE MAQUINARIA PESADA\nEntre Alquileres del Norte Demo, S. de R.L., «LA ARRENDADORA», y {empresa}, «LA ARRENDATARIA», se acuerda:',
    'CONTRATO DE ARRENDAMIENTO\nPrimera parte: el(la) propietario(a) del terreno. Segunda parte: {empresa}, titular de la concesión «{concesion}». Ambas partes convienen:',
)
ARR_CLAUS = pool(
    'PRIMERA: OBJETO. EL ARRENDADOR da en arrendamiento a LA ARRENDATARIA un lote de terreno de {mz} manzanas, ubicado en la aldea {aldea}, municipio de {muni}, para la instalación de un plantel y bodega.',
    'SERVICIOS. Los servicios de agua potable, energía eléctrica y teléfono del inmueble correrán por cuenta de LA ARRENDATARIA.',
    'RENTA. LA ARRENDATARIA pagará una renta anual de {lps}, por adelantado, mediante depósito en la cuenta de EL ARRENDADOR en {banco}.',
    'El arrendamiento incluye una excavadora sobre orugas y dos volquetas, que LA ARRENDATARIA recibe en buen estado.',
    'LA ARRENDATARIA no podrá subarrendar ni ceder el contrato sin autorización escrita.',
    T('RENTA. La renta mensual es de {lps_chico}, pagaderos dentro de los primeros cinco días de cada mes.', 'P'),
)
CES_CAB = pool(
    'ESCRITURA PÚBLICA NÚMERO {n} ({n}).- CESIÓN DE DERECHOS MINEROS.- En la ciudad de Tegucigalpa, Municipio del Distrito Central, a los {fecha_l}, ante mí, Notario(a) Público(a) de este domicilio, comparecen el representante legal de {empresa}, en adelante «EL CEDENTE», y el representante legal de {empresa2}, en adelante «EL CESIONARIO».',
    'CONTRATO DE OPCIÓN DE COMPRA DE DERECHOS MINEROS\nReunidos {empresa} («EL OPTANTE») y {empresa2} («EL TITULAR»), convienen celebrar el presente contrato de opción:',
    'CONTRATO DE CESIÓN PARCIAL DE DERECHOS\n{empresa} cede a {empresa2} el ‹cincuenta|treinta|setenta› por ciento de sus derechos sobre la concesión «{concesion}».',
    'ESCRITURA PÚBLICA NÚMERO {n}.- COMPRAVENTA DE INMUEBLE.- En la ciudad de {muni}, departamento de {depto}, a los {fecha_l}, ante mí, Notario(a), comparecen el(la) vendedor(a) y el apoderado de {empresa}.',
)
CES_CLAUS = pool(
    'EL CEDENTE cede y traspasa a favor del CESIONARIO la totalidad de los derechos sobre la concesión minera «{concesion}», otorgada mediante Resolución No. {res} del INHGEOMIN.',
    'PRECIO. El precio de la cesión es de {usd}, que el CESIONARIO pagará mediante transferencia bancaria.',
    'EL OPTANTE tendrá derecho exclusivo a realizar trabajos de exploración dentro del área y a adquirir el cien por ciento de los derechos pagando {usd}.',
    'EL VENDEDOR declara que el inmueble está libre de gravámenes y lo entrega con sus usos, costumbres y servidumbres.',
    'EL CEDENTE garantiza que la concesión está al día en el pago del canon territorial y libre de litigios.',
    T('El saldo del precio, equivalente a {usd}, se pagará a más tardar el {fecha_futura}, y su falta de pago dará lugar a la resolución del contrato.', 'P'),
    T('La opción deberá ejercerse dentro de un plazo de {meses} meses; vencido este sin ejercerla, el contrato quedará sin valor.', 'P'),
)
SERV_CAB = pool(
    'CONTRATO DE SERVIDUMBRE DE PASO\nComparecen, por una parte, el propietario del predio sirviente, y por otra, el apoderado de {empresa}, titular de la concesión «{concesion}», quienes convienen:',
    'ESCRITURA PÚBLICA NÚMERO {n}.- CONSTITUCIÓN DE SERVIDUMBRE.- ante mí, Notario(a), comparecen el propietario del predio sirviente y el representante de {empresa}.',
    'CONVENIO DE SERVIDUMBRE MINERA\nEntre el propietario superficial y {empresa}, para el acceso a la concesión «{concesion}».',
)
SERV_CLAUS = pool(
    T('La servidumbre tendrá un ancho de {m} metros y seguirá el trazo siguiente: {rumbos}.', 'C'),
    'La servidumbre se constituye a perpetuidad y a título oneroso, por un precio único de {lps}.',
    'El dueño del predio dominante podrá ingresar con maquinaria y vehículos para el transporte de mineral.',
    T('El trazo de la servidumbre sigue los puntos {coords_inline}.', 'C'),
    'EL PROPIETARIO conserva el uso agrícola del terreno fuera de la franja de servidumbre.',
)
PODER_CAB = pool(
    'ESCRITURA PÚBLICA NÚMERO {n}.- PODER GENERAL PARA PLEITOS.- En la ciudad de ‹Tegucigalpa|Comayagua|Juticalpa|Danlí›, a los {fecha_l}, ante mí, Notario(a), comparece el(la) Presidente(a) del Consejo de Administración de {empresa} y dice:',
    'PODER ESPECIAL\nEl(la) Gerente General de {empresa} otorga poder especial, amplio y suficiente, a favor del abogado(a) que se designa, para que represente a la sociedad en el expediente {exp}.',
    'CARTA PODER\nPor medio de la presente, {empresa} autoriza a su apoderado para realizar trámites ante el INHGEOMIN relativos a la concesión «{concesion}».',
)
PODER_CLAUS = pool(
    'El(la) poderdante confiere PODER GENERAL PARA PLEITOS, con las facultades de ley, para que represente a la sociedad ante el INHGEOMIN, MiAmbiente, la Procuraduría General de la República y los tribunales.',
    'El(la) apoderado(a) queda facultado(a) para desistir, transigir, sustituir el poder y recibir notificaciones.',
    'El poder comprende la facultad de presentar solicitudes, recursos y escritos en los expedientes de la sociedad.',
    T('El presente poder tendrá vigencia de {anios} años contados desde su otorgamiento.', 'P'),
)
SERVI_CAB = pool(
    'CONTRATO DE PRESTACIÓN DE SERVICIOS DE PERFORACIÓN DIAMANTINA\nEntre {empresa}, en adelante «LA EMPRESA», y Perforaciones Técnicas del Istmo Demo, S.A., en adelante «EL CONTRATISTA», se celebra el presente contrato:',
    'CONTRATO DE COMPRAVENTA DE MINERAL AURÍFERO\nEntre {empresa}, en adelante «EL VENDEDOR», y {empresa2}, en adelante «EL COMPRADOR», se pacta lo siguiente:',
    'CONTRATO DE SERVICIOS DE CONSULTORÍA AMBIENTAL\nEntre {empresa} y {consultora} para la elaboración del Estudio de Impacto Ambiental del proyecto «{concesion}».',
    'CONTRATO DE SUMINISTRO DE EXPLOSIVOS\nEntre {empresa} y Distribuidora Industrial Demo, S.A., con autorización de la autoridad competente.',
)
SERVI_CLAUS = pool(
    'EL CONTRATISTA ejecutará un programa de {nn} metros de perforación diamantina en diámetro ‹HQ|NQ|HQ reducido a NQ›, a un precio unitario de {usd_chico} por metro perforado.',
    'EL COMPRADOR pagará el oro contenido a razón del {pct} % del precio de cierre de Londres (LBMA) del día de la liquidación, deducidos los costos de refinación.',
    'CONFIDENCIALIDAD. Toda la información geológica y comercial intercambiada será tratada como confidencial.',
    'Las partes se someten a la jurisdicción de los tribunales de Tegucigalpa y renuncian a su domicilio.',
    T('EL CONSULTOR entregará el borrador del estudio, las presentaciones de socialización con las comunidades y la versión final aprobada.', 'M'),
    'El pago se realizará contra entrega de las facturas y de los reportes diarios de perforación.',
    T('EL CONTRATISTA concluirá los trabajos en un plazo de {dias} días calendario a partir de la orden de inicio.', 'P'),
)
JV_CAB = pool(
    'CONTRATO DE OPERACIÓN MINERA (JOINT VENTURE)\nLas sociedades {empresa} y {empresa2} acuerdan asociarse para la exploración y explotación de la concesión «{concesion}», de acuerdo con las cláusulas siguientes:',
    'CONVENIO DE COOPERACIÓN INTERINSTITUCIONAL ENTRE LA MUNICIPALIDAD DE {muni} Y LA SOCIEDAD {empresa}\nLas partes, debidamente representadas, acuerdan suscribir el presente convenio al tenor de las cláusulas siguientes:',
    'CONVENIO MARCO DE COLABORACIÓN\nEntre {empresa} y la Mancomunidad de municipios (ficticia) de la región, para apoyar proyectos de desarrollo local.',
)
JV_CLAUS = pool(
    'Las partes aportarán capital en proporción de {n} % y el resto, respectivamente, y compartirán los resultados en la misma proporción.',
    'La Municipalidad facilitará los permisos de su competencia y la Empresa apoyará el mantenimiento de la red vial terciaria.',
    'Se crea un comité técnico integrado por dos representantes de cada parte.',
    'La operadora del proyecto será {empresa}, que llevará la contabilidad separada de la operación conjunta.',
)
ACTA_CAB = pool(
    T('ACTA DE ACUERDOS\nEn la aldea {aldea}, municipio de {muni}, departamento de {depto}, a los {fecha_l}, reunidos la junta directiva del patronato pro-mejoramiento, vecinos de la comunidad y representantes de {empresa}, se llegó a los siguientes acuerdos:', 'M'),
    T('ACTA DE ENTENDIMIENTO ENTRE LA COMUNIDAD DE {aldea} Y LA EMPRESA {empresa}\nReunidos en el centro comunal, las partes acuerdan:', 'M'),
    T('CONVENIO DE BUENA VECINDAD\nEntre el patronato de la aldea {aldea} y la {empresa}, con la presencia del consejo indígena {pueblo}, se suscribe el presente convenio:', 'M'),
    T('ACTA No. {n}\nReunión entre la junta de agua de {aldea} y la empresa {empresa}. Acuerdos tomados por las partes:', 'AM'),
)
ACTA_ACUERDOS = pool(
    T('PRIMERO: La empresa se compromete a reparar el camino vecinal y a mantenerlo transitable. SEGUNDO: Se contratará personal de la comunidad.', 'M'),
    T('PRIMERO: La empresa construirá un tanque de captación para la naciente que abastece a {aldea}. SEGUNDO: No se trabajará en la quebrada {quebrada}.', 'AM'),
    T('TERCERO: La empresa entregará al patronato un aporte anual de {lps} para proyectos comunitarios.', 'M'),
    T('CUARTO: La empresa realizará monitoreo trimestral de la quebrada {quebrada} con participación de la junta de agua.', 'AM'),
    T('QUINTO: Al finalizar el proyecto, la empresa reforestará las áreas afectadas y entregará el terreno rehabilitado a la comunidad.', 'MX'),
    T('SEXTO: Los compromisos se cumplirán en un plazo de {meses} meses; se revisarán en asamblea.', 'MP'),
)
ACTA_COLA = pool(
    T('Firmamos de conformidad: [Firma] Presidente(a) del Patronato — [Firma] Representante de la empresa — [Firma] Tesorero(a) de la junta de agua. Siguen {n} firmas de vecinos.', 'M'),
    T('No habiendo más que tratar se cierra la sesión y firman los asistentes: patronato, vecinos y empresa.', 'M'),
)

CON_SUBS = [
    (24, dict(cab=ARR_CAB, cuerpo=[(ARR_CLAUS, 1), (ARR_CLAUS, .5), (C_LIND, .4), (C_PLAZO, .45), (C_AGUA, .15), (C_CIERRE, .25), (C_COMUN, .1)],
              cola=[(CON_COLA, .85)], barajar=True)),
    (18, dict(cab=CES_CAB, cuerpo=[(CES_CLAUS, 1), (CES_CLAUS, .6), (C_LIND, .28), (C_PLAZO, .2)], cola=[(CON_COLA, .8), (CON_COLA_F, .3)])),
    (10, dict(cab=SERV_CAB, cuerpo=[(SERV_CLAUS, 1), (C_LIND, .7), (C_AGUA, .2), (C_PLAZO, .2)], cola=[(CON_COLA, .8), (CON_COLA_F, .15)])),
    (9, dict(cab=PODER_CAB, cuerpo=[(PODER_CLAUS, 1), (PODER_CLAUS, .5)], cola=[(CON_COLA, .8)])),
    (14, dict(cab=SERVI_CAB, cuerpo=[(SERVI_CLAUS, 1), (SERVI_CLAUS, .6), (C_PLAZO, .3)], cola=[(CON_COLA, .8)])),
    (11, dict(cab=JV_CAB, cuerpo=[(JV_CLAUS, 1), (C_COMUN, .35), (C_CIERRE, .45), (C_AGUA, .15), (C_PLAZO, .4)], cola=[(CON_COLA, .8)], barajar=True)),
    (14, dict(cab=ACTA_CAB, cuerpo=[(ACTA_ACUERDOS, 1), (ACTA_ACUERDOS, .7), (ACTA_ACUERDOS, .3)], cola=[(ACTA_COLA, .8)])),
]


def g_contrato(c):
    s = subtipo(CON_SUBS)
    cab, cola = componer(c, s)
    return cab, cola, R.choice(['', 'Notaría — Escritura Pública', c['empresa']])


def medio_contrato(c):
    return medio_de(CON_SUBS, c)


# ================================================================== ambiental

AMB_NEUTRO = pool(
    'Los impactos más significativos identificados son la remoción de cobertura vegetal, la generación de polvo y el ruido por el tránsito de volquetas en el camino de acceso.',
    'La matriz de Leopold arrojó {n} impactos negativos moderados y {n2} impactos positivos, principalmente en empleo y dinamización de la economía local.',
    'Se implementarán barreras vivas, riego de caminos en época seca y limitación de velocidad a 30 km/h para reducir el polvo.',
    'El suelo del área corresponde a la serie ‹Milile|Salalica|Chimizales›, de textura franco-arcillosa, con pendientes entre 15 y 45 %.',
    'El proyecto se desarrolla en una zona de bosque de pino ralo con áreas de pasto y guamiles, a una altitud entre {nn} y 1,200 msnm.',
    'La precipitación media anual en la estación meteorológica más cercana es de {nn} mm, con una estación seca de noviembre a abril.',
    'Se estableció un vivero forestal con capacidad para {nn} plántulas de especies nativas.',
)
AMB_BIO = pool(
    'Se registraron {n} especies de flora, destacando pino ocote (Pinus oocarpa), roble (Quercus sp.) y liquidámbar; ninguna se encuentra en lista de especies amenazadas.',
    'Se observaron {n} especies de aves, entre ellas el guardabarranco y el zopilote, así como huellas de mamíferos pequeños.',
    'La cobertura vegetal dominante es bosque de pino denso (42 %), seguido de pastizales (31 %) y cultivos anuales.',
    'Se recomienda el rescate y reubicación de epífitas y orquídeas antes del desmonte.',
    'Los transectos de 100 m permitieron identificar {n} especies de mamíferos, incluyendo guatusa y armadillo.',
)
AMB_AIRE = pool(
    'Los niveles de presión sonora registrados en el perímetro de la planta oscilaron entre 52 y 68 dB(A), por debajo del límite de referencia diurno.',
    'La concentración de partículas PM10 en la estación ubicada junto al patio de acopio fue de {n} µg/m³, promedio de 24 horas.',
    '[TABLA] Punto | Leq dB(A) día | Leq dB(A) noche | Límite\nR-1 portón | 61.2 | 48.0 | 70/60\nR-2 planta | 67.9 | 55.3 | 70/60\nR-3 vivienda cercana | 49.5 | 41.2 | 55/45',
    'Las mediciones de vibración por voladura no superaron 5 mm/s en la vivienda más cercana.',
)
AMB_DESECHOS = pool(
    'Los desechos sólidos domésticos se clasificarán en la fuente y se dispondrán en el relleno sanitario municipal; los aceites usados se almacenarán en bodega con dique de contención.',
    'En caso de derrame de hidrocarburos se aplicará material absorbente y se notificará a la autoridad dentro de las primeras horas.',
    'Los envases vacíos de cianuro se triple-lavarán y devolverán al proveedor.',
    'La bodega de sustancias químicas contará con ventilación, piso impermeable y hojas de seguridad visibles.',
    'Brigada de emergencias: coordinador, primeros auxilios, combate de incendios y evacuación.',
)
AMB_A = pool(
    T('El área del proyecto se ubica en la microcuenca de la quebrada {quebrada}, tributaria del río {rio}, con un área de drenaje de {km} km². El caudal medido en época seca fue de {q} l/s.', 'A'),
    T('[TABLA] Parámetro | Unidad | M-1 aguas arriba | M-2 aguas abajo | Norma\npH | — | 7.2 | 6.8 | 6.5–8.5\nSólidos suspendidos totales | mg/L | 12 | 48 | —\nArsénico | mg/L | <0.005 | 0.012 | 0.01\nMercurio | mg/L | <0.0005 | <0.0005 | 0.001', 'A'),
    T('Estación M-1: quebrada {quebrada}, aguas arriba del campamento ({punto}). Estación M-2: 200 m aguas abajo de la descarga de la pila de sedimentación ({punto2}).', 'A'),
    T('Se identificaron {n} nacientes dentro del área de influencia directa; dos de ellas abastecen sistemas de agua de consumo humano.', 'A'),
    T('Los resultados de turbidez en la quebrada {quebrada} superaron el valor de referencia durante los eventos de lluvia, asociados al arrastre de sedimentos desde el botadero.', 'A'),
    T('El potencial de generación de drenaje ácido de roca en el material estéril podría afectar la calidad del agua del río {rio} si no se implementan medidas de control.', 'A'),
    T('La demanda de agua del proyecto será de {q} m³/día, captada de un pozo perforado y de la quebrada {quebrada} bajo permiso de la autoridad del agua.', 'A'),
    T('Se construirán cunetas de coronación, trampas de sedimentos y una laguna de sedimentación antes de la descarga al cauce de la quebrada {quebrada}.', 'A'),
    T('Oxígeno disuelto 6.4 mg/L, conductividad 210 µS/cm y coliformes fecales 240 NMP/100 mL en el punto de muestreo del río {rio}.', 'A'),
    T('El nivel freático medido en los piezómetros varía entre ‹4|6|8|12› y 40 m; el acuífero local es de tipo fisurado.', 'A'),
)
AMB_M = pool(
    T('La población del área de influencia directa comprende las comunidades de {aldea} y {aldea2}, con aproximadamente {hab} habitantes dedicados a la agricultura de subsistencia.', 'M'),
    T('En el área de influencia indirecta se identificó presencia de población {pueblo}, por lo que se recomienda realizar un proceso de consulta previa, libre e informada.', 'M'),
    T('Se realizaron {n} asambleas de socialización con los patronatos de {aldea} y {aldea2}, con participación de {nn} personas; las principales inquietudes fueron el empleo y el polvo.', 'M'),
    T('Durante la socialización algunos vecinos manifestaron oposición al proyecto por temor a la afectación de sus tierras de cultivo.', 'M'),
    T('La empresa establecerá un mecanismo de atención de quejas y reclamos para los vecinos, con registro y respuesta oportuna.', 'M'),
    T('Los servicios básicos de {aldea} incluyen escuela, centro de salud y un sistema de agua administrado por la junta de agua local.', 'M'),
    T('El programa de relacionamiento prevé reuniones trimestrales con los patronatos y la contratación prioritaria de mano de obra local.', 'M'),
)
AMB_AM = pool(
    T('Las comunidades de {aldea} y {aldea2} se abastecen de agua de la quebrada {quebrada}, por lo que su protección fue la principal preocupación expresada en la socialización.', 'AM'),
    T('La junta de agua de {aldea} participará en el monitoreo comunitario de la calidad del agua en la naciente que abastece al caserío.', 'AM'),
)
AMB_X = pool(
    T('Al finalizar la vida útil de la mina se ejecutará el cierre progresivo de los frentes: estabilización de taludes, relleno de socavones, reconformación del terreno y revegetación con especies nativas.', 'X'),
    T('El costo estimado del cierre asciende a {usd}, monto que será respaldado mediante garantía de cierre a favor de la autoridad minera.', 'X'),
    T('La fase de cierre incluye el desmantelamiento de la planta, la remoción de estructuras y el sellado de bocaminas con tapones de concreto.', 'X'),
    T('El plan de cierre contempla el monitoreo post-cierre de la estabilidad física y química de los depósitos de relaves durante cinco años.', 'X'),
    T('Objetivo del cierre: devolver el área a un uso compatible con el entorno, ya sea forestal o agropecuario, garantizando la seguridad de las personas.', 'X'),
    T('Cierre temporal: en caso de suspensión de operaciones se asegurarán los accesos, se mantendrá el drenaje y se vigilarán los taludes.', 'X'),
)
AMB_C = pool(
    T('El polígono del proyecto se delimita por los vértices siguientes (WGS84, UTM zona 16N):\n{coords_tabla}', 'C'),
    T('El área de influencia directa corresponde al polígono de la concesión, delimitado por {coords_inline}.', 'C'),
    T('El predio del proyecto colinda {linderos}.', 'C'),
)
AMB_P = pool(
    T('El titular deberá presentar el ICMA semestralmente, a más tardar el 30 de junio y el 31 de diciembre de cada año.', 'P'),
    T('Las medidas de mitigación deberán implementarse en un plazo máximo de {meses} meses contados desde el otorgamiento de la licencia.', 'P'),
    T('La licencia ambiental del proyecto vence el {fecha_futura}; la renovación deberá tramitarse con {meses} meses de anticipación.', 'P'),
)
AMB_ICMA = pool(
    'Se dio cumplimiento a {n} de las 48 medidas establecidas en el contrato de medidas de mitigación; las restantes se encuentran en ejecución.',
    'Se adjuntan las constancias de capacitación del personal en manejo de sustancias peligrosas.',
    'La regencia ambiental realizó {n} visitas de verificación durante el período.',
)
AMB_DESC = pool(
    'El acceso al proyecto se realiza desde la cabecera municipal de {muni} por una carretera de tierra de {km} km, transitable todo el año.',
    'El proyecto contempla un tajo abierto, una planta de beneficio con capacidad de {nn} t/día, un botadero de estériles y un depósito de relaves.',
    'La vida útil estimada del proyecto es de {n} años, con una etapa de construcción de 18 meses.',
)
AMB_COLA = pool(
    'Elaborado por: {consultora}. Prestador(a) de servicios ambientales registrado(a) en MiAmbiente bajo el número {fict}.',
    'Coordinador(a) del estudio: [Firma] Consultor(a) ambiental — {consultora}',
    'Referencias: Ley General del Ambiente (Decreto 104-93); Reglamento del SINEIA; Normas Técnicas de las Descargas de Aguas Residuales.',
    '{consultora} — Página {pag} de {tot}',
    'Anexos: A. Mapas temáticos. B. Registro fotográfico. C. Resultados de laboratorio. D. Listas de asistencia.',
    'Los resultados se comparan con los valores de referencia nacionales e internacionales aplicables.',
)
AMB_CAB_GEN = pool(
    'ESTUDIO DE IMPACTO AMBIENTAL (EsIA)\nPROYECTO MINERO «{concesion}»\nProponente: {empresa}\nElaborado por: {consultora}\n{muni}, {depto} — {mes} de {anio}',
    'DIAGNÓSTICO AMBIENTAL CUALITATIVO (DAC)\nProyecto de extracción de ‹material pétreo|oro aluvial|caliza› «{concesion}», municipio de {muni}',
    'PLAN DE GESTIÓN AMBIENTAL (PGA)\nConcesión minera «{concesion}» — {empresa}',
    'RESUMEN EJECUTIVO\nEstudio de Impacto Ambiental del proyecto «{concesion}»',
    'EVALUACIÓN AMBIENTAL INICIAL\nProyecto «{concesion}» · {empresa} · {anio}',
)
AMB_SUBS = [
    (26, dict(cab=AMB_CAB_GEN, cuerpo=[(AMB_NEUTRO, .6), (AMB_A, .45), (AMB_M, .3), (AMB_AM, .08), (AMB_X, .32), (AMB_C, .18), (AMB_P, .15), (AMB_BIO, .2)],
              relleno=AMB_NEUTRO, barajar=True, cola=[(AMB_COLA, .5)])),
    (9, dict(cab=pool(
        T('INFORME DE MONITOREO DE CALIDAD DE AGUA SUPERFICIAL\n{trim} trimestre {anio}\nProyecto «{concesion}» — Laboratorio: {lab}', 'A'),
        T('MONITOREO DE AGUAS — PUNTOS DE CONTROL\nConcesión «{concesion}» · campaña de {mes} {anio}', 'A'),
        T('ESTUDIO HIDROLÓGICO E HIDROGEOLÓGICO\nMicrocuenca de la quebrada {quebrada}', 'A'),
        T('CAPÍTULO 5. LÍNEA BASE FÍSICA\n5.3 Hidrología superficial', 'A')),
        cuerpo=[(AMB_A, 1), (AMB_A, .6), (AMB_AM, .15), (AMB_P, .1)], cola=[(AMB_COLA, .5)])),
    (5, dict(cab=pool(
        'INFORME DE MONITOREO DE RUIDO AMBIENTAL Y CALIDAD DEL AIRE\nPlanta de beneficio «{concesion}» — {mes} {anio}',
        'MONITOREO DE VIBRACIONES Y RUIDO POR VOLADURAS\nProyecto «{concesion}»',
        'CAPÍTULO 5. LÍNEA BASE FÍSICA\n5.6 Calidad del aire y ruido'),
        cuerpo=[(AMB_AIRE, 1), (AMB_AIRE, .5), (AMB_M, .1)], cola=[(AMB_COLA, .5)])),
    (13, dict(cab=pool(
        T('PLAN DE CIERRE Y REHABILITACIÓN DE MINA\nProyecto «{concesion}»\n{empresa} — Versión {n}.0', 'X'),
        T('PLAN DE CIERRE CONCEPTUAL\nConcesión «{concesion}»', 'X'),
        T('PLAN DE CIERRE PROGRESIVO Y FINAL\nMina «{concesion}» — {consultora}', 'X')),
        cuerpo=[(AMB_X, 1), (AMB_X, .6), (AMB_A, .2), (AMB_M, .15), (AMB_P, .2), (AMB_C, .15)], cola=[(AMB_COLA, .5)])),
    (7, dict(cab=pool(
        T('CAPÍTULO 6. LÍNEA BASE SOCIOECONÓMICA Y CULTURAL', 'M'),
        T('PLAN DE RELACIONAMIENTO COMUNITARIO\nÁrea de influencia directa del proyecto «{concesion}»', 'M'),
        T('INFORME DE SOCIALIZACIÓN DEL PROYECTO «{concesion}»', 'M')),
        cuerpo=[(AMB_M, 1), (AMB_M, .6), (AMB_AM, .2)], cola=[(AMB_COLA, .4)])),
    (8, dict(cab=pool(
        'INFORME DE CUMPLIMIENTO DE MEDIDAS DE CONTROL AMBIENTAL (ICMA)\nPeríodo: {mes} {anio}\nLicencia ambiental del proyecto «{concesion}»',
        'ICMA No. {n}\nProyecto «{concesion}» · {empresa}'),
        cuerpo=[(AMB_ICMA, 1), (AMB_A, .4), (AMB_M, .25), (AMB_P, .35), (AMB_X, .25)], cola=[(AMB_COLA, .5)], barajar=True)),
    (8, dict(cab=pool(
        'CAPÍTULO 8. IDENTIFICACIÓN Y VALORACIÓN DE IMPACTOS AMBIENTALES',
        'PROGRAMA DE MANEJO DE DESECHOS SÓLIDOS Y PELIGROSOS\nProyecto «{concesion}»',
        'PLAN DE CONTINGENCIAS Y RESPUESTA A EMERGENCIAS\nPlanta de cianuración «{concesion}»',
        'LÍNEA BASE BIOLÓGICA — FLORA Y FAUNA\nProyecto «{concesion}»'),
        cuerpo=[(AMB_NEUTRO, .5), (AMB_DESECHOS, .5), (AMB_BIO, .5), (AMB_A, .2)], relleno=AMB_DESECHOS, cola=[(AMB_COLA, .4)])),
    (5, dict(cab=pool('CAPÍTULO 4. DESCRIPCIÓN DEL PROYECTO\n4.1 Localización y accesos', 'CAPÍTULO 3. DESCRIPCIÓN DEL PROYECTO Y SUS ALTERNATIVAS'),
             cuerpo=[(AMB_DESC, 1), (AMB_C, .55), (AMB_DESC, .4)], cola=[(AMB_COLA, .3)])),
]


def g_ambiental(c):
    s = subtipo(AMB_SUBS)
    cab, cola = componer(c, s)
    memb = R.choice([f'EsIA Proyecto {c["concesion"]}', c['consultora'], f'PGA — {c["empresa"]}'])
    return cab, cola, memb


def medio_ambiental(c):
    return medio_de(AMB_SUBS, c)


# ================================================================== técnico

TEC_GEO = pool(
    'La mineralización se hospeda en vetas de cuarzo-calcita con rumbo N{n}°E y buzamiento {n2}° al SE, emplazadas en andesitas y tobas del Grupo Padre Miguel.',
    'La alteración hidrotermal presenta un halo argílico con sericita-illita y silicificación en las cajas de las vetas; la pirita diseminada alcanza el 3 %.',
    'Se tomaron {nn} muestras de canal en trincheras y afloramientos; el 18 % reportó valores superiores a 1 g/t Au.',
    'The deposit is classified as a low-sulphidation epithermal gold-silver system hosted in Tertiary volcanic rocks.',
    'La veta principal tiene un rumbo N{n}°O, una longitud reconocida de {nn} m y una potencia media de 1.4 m.',
    'Las texturas bandeadas coloformes y el cuarzo en hoja de platino sugieren un nivel alto dentro del sistema epitermal.',
    'El basamento está constituido por esquistos y filitas del Grupo Cacaguapa, cortados por diques andesíticos.',
)
TEC_SOND = pool(
    '[TABLA] Sondaje | Desde (m) | Hasta (m) | Long. (m) | Au (g/t) | Ag (g/t)\n{ddh} | 45.20 | 47.10 | 1.90 | {au} | {ag}\n{ddh2} | 112.00 | 115.35 | 3.35 | {au2} | {ag2}\n{ddh3} | 88.60 | 89.40 | 0.80 | {au3} | {ag3}',
    'La campaña comprendió {n} sondajes diamantinos (HQ/NQ) por un total de {nn}0 m; la recuperación media de testigo fue de 94 %.',
    '[TABLA] Sondaje | Este | Norte | Cota | Azimut | Incl. | Prof. (m)\n{ddh} | {punto} | 845 | 135 | -55 | {prof}\n{ddh2} | {punto2} | 812 | 140 | -60 | {prof2}',
    'El collar del sondaje {ddh} se ubicó en las coordenadas {punto} ({datum}), con azimut 135° e inclinación -55°.',
    'Los testigos se loguearon, fotografiaron y cortaron por la mitad con sierra diamantada; la mitad se envió al laboratorio.',
    'El mejor intercepto se obtuvo en {ddh}: {m}.0 m con {au} g/t Au desde {prof} m.',
)
TEC_REC = pool(
    '[TABLA] Categoría | Toneladas (kt) | Au (g/t) | Au (koz)\nIndicado | {nn} | {au} | {n}.4\nInferido | {nn2} | {au2} | {n2}.9',
    'La estimación se realizó por kriging ordinario en bloques de 5×5×5 m, con leyes topadas a {n} g/t Au según el análisis de valores extremos.',
    'La densidad aparente media, determinada por el método de inmersión en {nn} muestras, es de 2.62 t/m³.',
    'Los recursos se reportan por encima de una ley de corte de {au} g/t Au, considerando un precio de {usd_chico}/oz.',
    'El programa QA/QC incluyó estándares certificados, blancos y duplicados; los resultados no muestran sesgo significativo.',
)
TEC_MET = pool(
    'Las pruebas de cianuración en botella a 72 horas con P80 de 75 µm alcanzaron recuperaciones de oro entre {pct} % y 93.1 %, con consumo de NaCN de 1.2 kg/t.',
    'El circuito de planta comprende chancado en dos etapas, molienda en molino de bolas, cianuración en tanques (CIL) y desorción de carbón.',
    'La prueba de columna de 90 días alcanzó una extracción de {pct} % con granulometría de 1/2 pulgada.',
    'El agua de proceso se recircula desde la poza de relaves al circuito de molienda; el consumo de reposición es de {q} m³/día.',
    'La mineralogía indica oro libre asociado a cuarzo y en menor proporción incluido en pirita, lo que explica la recuperación parcial.',
)
TEC_MIN = pool(
    'El método de explotación será corte y relleno ascendente, con una producción de {nn} t/día y una dilución estimada del {n} %.',
    'El diseño del tajo considera bancos de {m} m de altura, bermas de 4 m y un ángulo interrampa de 50°.',
    'Los ensayos de compresión uniaxial arrojaron valores entre 45 y 90 MPa; el RMR de la roca encajonante varía entre 40 y 58, clase III.',
    'El sostenimiento se realizará con pernos de anclaje y malla en las zonas de roca clase IV.',
    'La flota estará compuesta por una excavadora de 1.5 m³ y cuatro volquetas de 14 m³ para el acarreo al patio.',
    'El factor de seguridad del talud global, calculado por Bishop simplificado, es de 1.35 en condición estática.',
)
TEC_PROD = pool(
    'Durante el mes se procesaron {ton} toneladas de mineral con ley de cabeza de {au} g/t Au y recuperación de planta de {pct} %, obteniéndose {oz} onzas troy de doré.',
    '[TABLA] Concepto | Mes | Acumulado\nMineral procesado (t) | {ton} | {ton2}\nLey de cabeza (g/t Au) | {au} | {au2}\nOro producido (oz) | {oz} | {oz2}',
    'Se avanzaron {nn} metros de galerías y chimeneas en los niveles 2 y 3.',
    'El consumo de explosivos fue de {nn} kg de emulsión y {n}00 detonadores no eléctricos.',
)
TEC_LAB = pool(
    'Método: ensayo al fuego con 30 g y acabado por absorción atómica (FA-AA30). Límite de detección 0.005 g/t Au. Se insertaron blancos y estándares certificados cada 20 muestras.',
    '[TABLA] Muestra | Au (g/t) | Ag (g/t) | Cu (%)\n{fict} | {au} | {ag} | 0.02\n{fict2} | {au2} | {ag2} | 0.05',
    'Las muestras se lavaron con agua destilada antes de la pulverización a 85 % pasante malla 200.',
    'Fecha de recepción: {fecha}. Número de muestras: {n}. Tipo: testigo de perforación.',
)
TEC_NEG = pool(
    'La planta de beneficio se localiza en el punto {punto}, a 2 km de la bocamina principal.',
    'La concesión tiene una extensión de {ha} ha; los detalles del polígono se presentan en el Anexo 2.',
    'El precio de cierre promedio del oro en el período fue de {usd_chico} por onza.',
    'La campaña de campo se realizó entre el {fecha} y el {fecha2}.',
)
TEC_T = pool(
    T('Durante la perforación del {ddh} se interceptó el nivel freático a {m} m; se estima un aporte de agua subterránea de {q} l/s que será bombeado hacia la quebrada {quebrada}.', 'A'),
    T('El agua para el proceso se captará del río {rio} mediante una toma con capacidad de {q} l/s, sujeto al permiso correspondiente.', 'A'),
    T('El plan de minado contempla el cierre progresivo de los tajos agotados y su relleno con material estéril, seguido de revegetación.', 'X'),
    T('Item 20: los costos de cierre y rehabilitación se estiman en {usd}, incluidos en el flujo de caja del último año de operación.', 'X'),
    T('Acceso a la propiedad superficial: las comunidades de {aldea} y {aldea2} han otorgado acceso mediante acuerdos firmados con los patronatos.', 'M'),
    T('La concesión «{concesion}» cubre {ha} ha y está definida por los vértices {coords_inline} (UTM zona 16N, {datum}).', 'C'),
    T('La concesión fue otorgada por un plazo de {anios} años y vence el {fecha_futura}; el canon anual se encuentra al día.', 'P'),
    T('Item 4: El área está delimitada por el siguiente polígono:\n{coords_tabla}', 'C'),
    T('Las labores subterráneas abandonadas del nivel 3 serán selladas y los rellenos compactados como parte del cierre de mina.', 'X'),
    T('Item 20: no se identificaron comunidades indígenas; la socialización con la aldea {aldea} se realizó en {anio}.', 'M'),
    T('Se observaron filtraciones de agua en el nivel 2 que drenan hacia la quebrada {quebrada}; se recomienda un estudio hidrogeológico.', 'A'),
)
TEC_X = pool(
    T('Al agotarse las reservas, las rampas y chimeneas se sellarán y los botaderos se reconformarán y revegetarán según el plan de cierre.', 'X'),
    T('20.4 Cierre de mina: el costo de cierre estimado de {usd} está respaldado por una garantía de cierre.', 'X'),
    T('El botadero de estériles se diseñó para su rehabilitación final con taludes 3H:1V y cobertura de suelo orgánico.', 'X'),
)
TEC_COLA = pool(
    'Persona Calificada: [NOMBRE], P.Geo. Fecha de firma: {fecha}.',
    '[Firma] Geólogo(a) responsable — Colegio de Geólogos de Honduras, colegiado(a) No. {fict} [sello del colegio profesional]',
    'Preparado por: [Firma] Ingeniero(a) de Minas responsable del plan de labores.',
    'Qualified Person: [signature] — {consultora}. Dated {fecha}.',
    'Referencias bibliográficas y Anexo A: logueo de sondajes.',
)
TEC_COLA_LAB = pool(
    'Analista responsable: [Firma] — {lab}. Los resultados corresponden únicamente a las muestras recibidas.',
    'Gerente de laboratorio: [Firma] — Este certificado no podrá reproducirse parcialmente sin autorización.',
)
TEC_SUBS = [
    (20, dict(cab=pool(
        'INFORME TÉCNICO NI 43-101\nESTIMACIÓN DE RECURSOS MINERALES\nPROYECTO «{concesion}», DEPARTAMENTO DE {depto}, HONDURAS\nPreparado para: {empresa}\nFecha efectiva: {fecha}',
        'NI 43-101 TECHNICAL REPORT\n{concesion} GOLD PROJECT, {depto} DEPARTMENT, HONDURAS\nEffective date: {fecha}',
        '14. ESTIMACIÓN DE RECURSOS MINERALES\n14.1 Base de datos y validación',
        'INFORME DE ESTIMACIÓN DE RECURSOS (JORC)\nProyecto «{concesion}»'),
        cuerpo=[(TEC_REC, 1), (TEC_GEO, .4), (TEC_SOND, .3), (TEC_T, .45), (TEC_T, .15), (TEC_NEG, .15)], cola=[(TEC_COLA, .55)], barajar=True)),
    (20, dict(cab=pool(
        'INFORME DE EXPLORACIÓN — CAMPAÑA DE SONDAJES {anio}\nConcesión «{concesion}»',
        'INFORME GEOLÓGICO DE LA CONCESIÓN «{concesion}»\nMunicipio de {muni}, {depto}',
        'INFORME DE MAPEO Y MUESTREO SUPERFICIAL\nZona de vetas «{concesion}»',
        'INFORME DE AVANCE DE EXPLORACIÓN\nPeríodo {mes} {anio} — {empresa}'),
        cuerpo=[(TEC_GEO, 1), (TEC_SOND, .7), (TEC_T, .3), (TEC_NEG, .25)], cola=[(TEC_COLA, .5)])),
    (10, dict(cab=pool(
        'ESTUDIO METALÚRGICO\nPRUEBAS DE CIANURACIÓN EN BOTELLA Y COLUMNA\nMuestras compósito del proyecto «{concesion}»',
        'INFORME DE PRUEBAS METALÚRGICAS\nFlotación y cianuración — «{concesion}»',
        '13. PROCESAMIENTO DE MINERALES Y PRUEBAS METALÚRGICAS'),
        cuerpo=[(TEC_MET, 1), (TEC_MET, .6), (TEC_T, .15)], cola=[(TEC_COLA, .4)])),
    (16, dict(cab=pool(
        'PLAN DE LABORES {anio}\nConcesión de explotación «{concesion}» — {empresa}',
        'ESTUDIO GEOTÉCNICO DE ESTABILIDAD DE TALUDES DEL TAJO\nProyecto «{concesion}»',
        'PLAN DE MINADO SUBTERRÁNEO\nVeta ‹San Rafael|La Dorada|El Carmen|Los Cuervos› — «{concesion}»',
        '16. MÉTODOS DE MINADO'),
        cuerpo=[(TEC_MIN, 1), (TEC_MIN, .5), (TEC_T, .4), (TEC_X, .3), (TEC_NEG, .15)], cola=[(TEC_COLA, .5)])),
    (12, dict(cab=pool(
        'INFORME MENSUAL DE PRODUCCIÓN\nMes: {mes} {anio}\nConcesión «{concesion}»',
        'INFORME SEMESTRAL DE PRODUCCIÓN Y ACTIVIDADES MINERAS\n{empresa} — semestre {n} de {anio}',
        'REPORTE DE OPERACIONES DE PLANTA\n{mes} {anio}'),
        cuerpo=[(TEC_PROD, 1), (TEC_PROD, .5), (TEC_T, .15), (TEC_NEG, .2)], cola=[(TEC_COLA, .35)])),
    (8, dict(cab=pool(
        'CERTIFICADO DE ANÁLISIS No. {fict}\n{lab}\nCliente: {empresa}\nProyecto: {concesion}',
        'REPORTE DE ENSAYES\n{lab} · Lote {fict}',
        'CERTIFICATE OF ANALYSIS {fict}\n{lab}'),
        cuerpo=[(TEC_LAB, 1), (TEC_LAB, .6)], cola=[(TEC_COLA_LAB, .7)])),
]


def g_tecnico(c):
    s = subtipo(TEC_SUBS)
    cab, cola = componer(c, s)
    memb = R.choice([f'NI 43-101 — Proyecto {c["concesion"]}', c['empresa'], c['lab']])
    return cab, cola, memb


def medio_tecnico(c):
    return medio_de(TEC_SUBS, c)


# Un acto de autoridad que trae su propio número oficial (resolución, licencia, dictamen, oficio,
# permiso, certificación de resolución) lleva req_firma_autoridad; un número de expediente no.
for _p in (DICT_CAB, NOTIF, CERT_MUNI_CAB, CONST_CAB_INH, AMBR_CAB, RES_CAB_INH):
    for _t in _p:
        if '{res}' in _t.t:
            _t.tags.add('F')
