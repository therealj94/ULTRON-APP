"""Piezas de plano, financiero, solicitud y otro."""
from comun import R, T, pool, elegir, seg, componer, subtipo, medio_de

# ================================================================== plano

PLA_CAB = pool(
    'PROYECTO: CONCESIÓN MINERA «{concesion}»\nCONTENIDO: PLANO DE UBICACIÓN Y POLÍGONO\nESCALA: {escala}   DATUM: {datum}   PROYECCIÓN: UTM ZONA 16N\nLÁMINA {n} DE {n2}',
    'PLANO TOPOGRÁFICO — LEVANTAMIENTO CON ESTACIÓN TOTAL\nPropiedad ubicada en {aldea}, municipio de {muni}, {depto}\nEscala {escala}',
    'MAPA GEOLÓGICO LOCAL\nConcesión «{concesion}»\nLEYENDA: Qal Aluvión cuaternario · Tpm Grupo Padre Miguel (ignimbritas) · Km Grupo Valle de Ángeles · Estructuras: falla inferida, veta de cuarzo, zona de alteración',
    'CROQUIS DE UBICACIÓN (sin escala)\nReferencias: a {km} km de la cabecera municipal de {muni} por camino de tierra; iglesia, escuela y cancha como puntos de referencia.',
    'PLANO DE ÁREA DE SERVIDUMBRE\nPredio sirviente — {empresa}\nEscala {escala}',
    'MAPA DE COBERTURA VEGETAL Y USO DEL SUELO\nProyecto «{concesion}» · Fuente: imagen satelital {anio}',
    'PLANO DE DISEÑO DEL TAJO — FASE ‹1|2|3|4›\nBancos de ‹5|6|8|10› m · bermas de 4 m · ángulo interrampa 50° · rampa al 10 %',
    'PLANO DE INSTALACIONES DE SUPERFICIE\nPlanta, poza de relaves, botadero, campamento y bodega de explosivos',
    'CUADRO DE COORDENADAS DE LA CONCESIÓN «{concesion}»',
    'LÁMINA {n}: PERFIL LONGITUDINAL DE LA VETA\nSección A–A\' — escala horizontal {escala}',
    'MAPA DE UBICACIÓN REGIONAL\nDepartamento de {depto} — Honduras\nSistema de referencia {datum}',
    'PLANO CATASTRAL — SOLICITUD DE CONCESIÓN\nÁrea: {ha} ha   Municipio: {muni}',
    T('PLANO DE CIERRE Y REHABILITACIÓN\nÁreas a revegetar, taludes a reconformar y bocaminas a sellar — «{concesion}»', 'X'),
    T('MAPA DE ÁREAS REHABILITADAS AL CIERRE\nConcesión «{concesion}» · Escala {escala}', 'X'),
)
PLA_T = pool(
    T('{coords_tabla}', 'C'),
    T('{cuadro}', 'C'),
    T('CUADRO DE CONSTRUCCIÓN: {rumbos}.', 'C'),
    T('Colindancias: {linderos}.', 'C'),
    T('Colindancias: {linderos_q}.', 'CA'),
    T('Hidrografía: quebrada {quebrada}, río {rio} y nacientes identificadas en campo (símbolo azul).', 'A'),
    T('Microcuenca de la quebrada {quebrada} — límite de la cuenca en línea discontinua; área de recarga hídrica sombreada.', 'A'),
    T('Área de influencia directa: comunidades de {aldea} ({hab} hab.) y {aldea2} ({hab2} hab.); territorio {pueblo} al norte.', 'M'),
    T('Áreas a revegetar al cierre · taludes a reconformar · bocaminas a sellar (achurado verde).', 'X'),
    T('Referencias: la quebrada {quebrada} corre al oeste del área, a unos {m} m del lindero.', 'A'),
)
PLA_NEG = pool(
    'Simbología: camino de tierra · curva de nivel maestra cada 50 m · curva secundaria cada 10 m · vivienda · escuela.',
    'Nota: las cotas están referidas al nivel medio del mar; las curvas de nivel se generaron a partir del modelo digital de elevación.',
    'Ubicación de la planta: {punto}. Ubicación del campamento: {punto2}.',
    'Área total: {ha} ha. Perímetro: {nn}.{n} m.',
    'Simbología hidrográfica: río permanente, quebrada intermitente, laguna (convenciones generales).',
    'Sondajes proyectados: {ddh} a {ddh2} (círculos rojos) y trincheras existentes (líneas negras).',
    'El polígono detallado se presenta en la lámina 2 de 3.',
)
PLA_COLA = pool(
    'DIBUJÓ: Técnico(a) en SIG   REVISÓ: Ingeniero(a) topógrafo(a)   FECHA: {fecha}',
    'Elaborado por: {consultora} · Archivo: plano_{n}.dwg · Revisión {n2}',
    'Sistema de coordenadas: UTM zona 16N, {datum}. Fuente cartográfica: hojas 1:50,000 del Instituto Geográfico Nacional.',
    'Levantó: cuadrilla de topografía — Calculó: [Firma] Ingeniero(a) civil colegiado(a)',
)
PLA_COLA_F = pool(
    T('REVISADO Y APROBADO — Unidad de Catastro Minero, INHGEOMIN. [Firma y sello] Fecha: {fecha}', 'F'),
    T('[Sello: INHGEOMIN · Catastro Minero · Revisado] [Firma y sello] Jefe(a) de Catastro', 'F'),
    T('Visto bueno: Unidad Municipal de Catastro de {muni} [Firma y sello]', 'F'),
)


def g_plano(c):
    cab = [seg(PLA_CAB, c)]
    memb = R.choice(['', c['consultora'], 'INHGEOMIN — Catastro Minero'])
    pc = 0.97 if any(k in cab[0].texto for k in ('COORDENADAS', 'CATASTRAL', 'POLÍGONO', 'SERVIDUMBRE', 'TOPOGRÁFICO')) else 0.6
    if R.random() < pc:
        cab.append(seg(elegir(pool(*PLA_T[:5])), c))
    if R.random() < 0.35:
        cab.append(seg(PLA_T, c))
    if R.random() < 0.45:
        cab.append(seg(PLA_NEG, c))
    cola = []
    if R.random() < 0.7:
        cola.append(seg(PLA_COLA, c))
    if R.random() < 0.2:
        cola.append(seg(PLA_COLA_F, c))
    return cab, cola, memb


def medio_plano(c):
    # una tabla de vértices sola, o tabla + nota
    s = [seg(elegir(pool(*PLA_T[:4])), c)]
    if R.random() < 0.5:
        s.append(seg(PLA_NEG, c))
    return s



# ================================================================== solicitud

S_ABOG = pool(  # pedimentos y fundamentos de un escrito de abogado
    'PETICIÓN: Al señor(a) Director(a) respetuosamente PIDO: admitir el presente escrito, darle el trámite de ley y en definitiva otorgar a mi representada lo solicitado.',
    'Acompaño: a) testimonio de la escritura de poder; b) copia de la escritura de constitución de la sociedad; c) recibo de pago de la tasa de solicitud.',
    'Señalo para recibir notificaciones la oficina del suscrito, ubicada en la colonia Palmira, Tegucigalpa, y el correo electrónico notificaciones@ejemplo.invalid.',
    'Fundo la presente solicitud en los artículos {art}, {art2} y demás aplicables de la Ley General de Minería y de la Ley de Procedimiento Administrativo.',
    'Mi representada ha cumplido con el pago del canon territorial y con la presentación de los informes de producción de los últimos semestres.',
    'Hago constar que la Resolución No. {res} de fecha {fecha2}, mediante la cual se otorgó la concesión «{concesion}», se encuentra firme y debidamente inscrita.',
)
S_COLA = pool(
    '{muni}, {fecha}.\n[Firma]\nApoderado(a) Legal\nColegio de Abogados de Honduras No. {fict}',
    'Es justicia que pido en la ciudad de Tegucigalpa, a los {fecha_l}. [Firma] Apoderado(a) Legal',
    'Tegucigalpa, M.D.C., {fecha}. [Firma] Abogado(a) — Colegio de Abogados de Honduras No. {fict}',
    'RECIBIDO — Secretaría General INHGEOMIN — {fecha} — hora {hora} — folios {n}. [sello de recibido]',
)
S_COLA_EMP = pool(
    'Tegucigalpa, M.D.C., {fecha}. [Firma] Gerente General — {empresa}',
    'Atentamente,\n[Firma]\nRepresentante Legal\n{empresa}',
    'Sin otro particular, nos suscribimos. [Firma] Superintendente de mina',
    'RECIBIDO — Secretaría General INHGEOMIN — {fecha} — hora {hora} — folios {n}. [sello de recibido]',
)
S_COLA_COM = pool(
    T('Firmas: [Firma] Presidente(a) del patronato; [Firma] Secretario(a); siguen {nn} firmas y huellas de vecinos de {aldea}.', 'M'),
    T('Por la comunidad: [Firma] Coordinador(a) del consejo indígena {pueblo}; [Firma] Presidente(a) de la junta de agua.', 'M'),
    T('Firman los miembros de la junta directiva del patronato de {aldea} y {nn} vecinos más.', 'M'),
)
S_C = pool(
    T('El área solicitada se describe con las coordenadas UTM siguientes (zona 16N, {datum}):\n{coords_tabla}', 'C'),
    T('El área solicitada queda delimitada por los vértices {coords_inline}.', 'C'),
    T('El polígono se describe por rumbos y distancias así: {rumbos}.', 'C'),
    T('Coordenadas del área (Datum {datum}):\n{coords_tabla}', 'C'),
)
CONC_CAB = pool(
    'SOLICITUD DE OTORGAMIENTO DE CONCESIÓN MINERA DE EXPLORACIÓN.- SE ACOMPAÑAN DOCUMENTOS.- PODER.-\nSEÑOR(A) DIRECTOR(A) EJECUTIVO(A) DEL INSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS.\nYo, [NOMBRE DEL APODERADO], Abogado(a), actuando en mi condición de Apoderado(a) Legal de la sociedad mercantil {empresa}, con todo respeto comparezco ante usted solicitando',
    'MEMORIAL.- SE AMPLÍA INFORMACIÓN.- SE ACOMPAÑA PLANO.-\nSEÑOR(A) DIRECTOR(A) EJECUTIVO(A) DEL INHGEOMIN.\nEl apoderado de {empresa}, en el expediente {exp}, expone:',
    'SOLICITUD DE CONSTANCIA DE NO TRASLAPE.-\nSeñor(a) Jefe(a) de la Unidad de Catastro Minero.\nLa sociedad {empresa} solicita se le extienda constancia de que el área que se describe no se traslapa con derechos mineros vigentes.',
    'SE SOLICITA RENUNCIA PARCIAL DE ÁREA.-\nSeñor(a) Director(a) Ejecutivo(a) del INHGEOMIN.\nEl representante de {empresa}, titular de la concesión «{concesion}», expone:',
    'SOLICITUD DE DERECHO MINERO NO METÁLICO.- Señor(a) Director(a) Ejecutivo(a).\n{empresa} solicita el otorgamiento del derecho denominado «{concesion}» para la extracción de ‹arena y grava|material selecto|piedra caliza›.',
)
CONC_CUERPO = pool(
    'La concesión solicitada es para la exploración de minerales metálicos (oro, plata, cobre) en un área de {ha} hectáreas, en jurisdicción de {muni}, {depto}.',
    'El área que se renuncia no presenta interés geológico, por lo que mi representada conserva únicamente la zona de vetas.',
    'El área se ubica en el municipio de {muni}, departamento de {depto}, en la hoja cartográfica 1:50,000 correspondiente.',
)
CONC_T = pool(
    T('Los trabajos se realizarán en la cercanía de la quebrada {quebrada}, para lo cual se acompaña el estudio hidrológico correspondiente.', 'A'),
    T('Se acompaña el acta de socialización suscrita con el patronato de la aldea {aldea}.', 'M'),
    T('Pido que el derecho se otorgue por el plazo máximo que permite la ley, contado desde su inscripción.', 'P'),
)
REC_CAB = pool(
    'SE INTERPONE RECURSO DE REPOSICIÓN CONTRA LA RESOLUCIÓN No. {res}.-\nSEÑOR(A) DIRECTOR(A) EJECUTIVO(A) DEL INHGEOMIN.\nEl suscrito apoderado de {empresa}, en el expediente {exp}, respetuosamente comparezco e interpongo recurso de reposición',
    'SE INTERPONE RECURSO DE APELACIÓN.-\nSeñor(a) Ministro(a).\nEl apoderado de {empresa} apela de la Resolución No. {res} dictada en el expediente {exp}.',
    'SE SOLICITA NULIDAD DE ACTUACIONES.-\nSEÑOR(A) SECRETARIO(A) GENERAL.\nEn el expediente {exp}, el apoderado de {empresa} expone:',
    'SE PERSONA.- SE ACREDITA PODER.- SE PIDE COPIA DEL EXPEDIENTE.-\nSEÑOR(A) SECRETARIO(A) GENERAL.\nComparezco en el expediente {exp} en representación de {empresa}.',
    'SE SOLICITA INSCRIPCIÓN DE CESIÓN DE DERECHOS.-\nSEÑOR(A) REGISTRADOR(A) MINERO(A).\nEl apoderado del cesionario {empresa2} comparece y pide:',
)
REC_CUERPO = pool(
    'La resolución recurrida no valoró las pruebas aportadas ni el dictamen técnico que obra en autos, por lo que causa agravio a mi representada.',
    'Adjunto la cédula de notificación de la Resolución No. {res}, para que se tenga presente al resolver.',
    'La caducidad declarada carece de fundamento, pues el canon fue pagado según consta en el recibo que se acompaña.',
    'No se notificó en legal forma a mi representada, lo que vulnera su derecho de defensa.',
    'Se acompaña el testimonio de la escritura de cesión debidamente autenticado.',
)
REC_T = pool(
    T('El recurso se interpone dentro del plazo de diez días hábiles que establece la ley, contados desde la notificación del {fecha_prox}.', 'P'),
    T('Solicito se suspenda el plazo concedido para el retiro de la maquinaria mientras se resuelve el recurso.', 'P'),
)
PRO_CAB = pool(
    T('SE SOLICITA PRÓRROGA.-\nSEÑOR(A) SECRETARIO(A) GENERAL DEL INHGEOMIN.\nEn el expediente {exp}, contentivo de la solicitud de concesión «{concesion}», comparezco en representación de {empresa} y expongo:', 'P'),
    T('SE PIDE AMPLIACIÓN DEL TÉRMINO.-\nSeñor(a) Director(a) de Fiscalización Minera.\n{empresa}, en el expediente {exp}, expone:', 'P'),
    T('SOLICITUD DE RENOVACIÓN DE LICENCIA.-\nSeñor(a) Director(a) General de Evaluación y Control Ambiental.\n{empresa}, proponente del proyecto «{concesion}», solicita:', 'P'),
)
PRO_T = pool(
    T('Solicito se me conceda una prórroga de {dias} días hábiles para presentar el estudio requerido, en virtud de que el laboratorio aún no entrega los resultados.', 'P'),
    T('El plazo de {dias} días concedido mediante providencia vence el {fecha_prox}, por lo que presento este escrito en tiempo.', 'P'),
    T('Solicito que se amplíe la vigencia de la licencia por {anios} años más, ya que vence el {fecha_futura}.', 'P'),
    T('Pido un término adicional de {dias} días para presentar el plan de cierre actualizado y la fianza de cierre.', 'XP'),
    T('Requiero prórroga para entregar los análisis de calidad de agua de la quebrada {quebrada}, pendientes por las lluvias.', 'AP'),
)
CARTA_CAB = pool(
    '{muni}, {fecha}\nSeñores\nDirección de Fiscalización Minera\nINHGEOMIN\nPresente\nEstimados señores: Por medio de la presente {empresa} remite el informe de producción correspondiente al mes de {mes}.',
    'OFICIO No. {fict}-GG-{anio}\nAsunto: Remisión de Plan de Labores {anio}\nSeñor(a) Director(a) de Minas, INHGEOMIN\nAdjunto remitimos el Plan de Labores de la concesión «{concesion}» para su revisión.',
    'SOLICITUD DE LICENCIA AMBIENTAL — FORMULARIO SLAS-1\nNombre del proyecto: «{concesion}»\nProponente: {empresa}\nCategoría solicitada: ‹1|2|3›\nMunicipio: {muni}, {depto}',
    'Tegucigalpa, {fecha}\nSeñor(a) Director(a) General de Evaluación y Control Ambiental\nMiAmbiente\nAsunto: presentación del ICMA del proyecto «{concesion}»',
    'SOLICITUD DE PERMISO DE MINERÍA ARTESANAL\nSeñor(a) Director(a) Ejecutivo(a) del INHGEOMIN.\nLos suscritos, miembros de la cooperativa de pequeños mineros de {aldea}, respetuosamente solicitamos',
)
CARTA_CUERPO = pool(
    'Quedamos a la orden para cualquier aclaración y agradecemos la atención a la presente.',
    'Descripción de la actividad: extracción y beneficio artesanal de oro mediante batea y rastra, sin uso de mercurio.',
    'El informe incluye el tonelaje procesado, la ley promedio y la producción en onzas del período.',
    'Se adjuntan en formato digital los anexos, planos y hojas de cálculo.',
)
CARTA_T = pool(
    T('La actividad se realizará en las márgenes de la quebrada {quebrada}; el agua se tomará sin desviar el cauce.', 'A'),
    T('Se adjunta la constancia de socialización con el patronato y la junta de agua de {aldea}.', 'M'),
    T('Se acompaña el plan de cierre de las áreas ya explotadas y la fianza de cierre emitida por {aseguradora}.', 'X'),
    T('Este informe se presenta dentro del plazo de {dias} días establecido en la licencia.', 'P'),
)
COM_CAB = pool(
    T('SE PRESENTA DENUNCIA.-\nSeñor(a) Ministro(a) de Recursos Naturales y Ambiente.\nNosotros, miembros del patronato pro-mejoramiento de la aldea {aldea}, municipio de {muni}, denunciamos que la empresa {empresa} descarga lodos en la quebrada {quebrada}', 'AM'),
    T('OPOSICIÓN A LA SOLICITUD DE CONCESIÓN «{concesion}».-\nSeñor(a) Director(a) Ejecutivo(a) del INHGEOMIN.\nLos abajo firmantes, vecinos de {aldea} y miembros del consejo indígena {pueblo}, nos oponemos', 'M'),
    T('QUEJA.- Señor(a) Alcalde(sa) Municipal de {muni}.\nLos vecinos de {aldea} exponemos que las voladuras de la mina están agrietando nuestras viviendas', 'M'),
    T('DENUNCIA ANTE LA FISCALÍA ESPECIAL DEL AMBIENTE.-\nEl patronato de {aldea} y la junta de agua denuncian la tala y el movimiento de tierra junto a la naciente que abastece a la comunidad.', 'AM'),
    T('CARTA DEL CONSEJO INDÍGENA {pueblo}.-\nSeñor(a) Ministro(a).\nPor este medio exigimos que se respete nuestro derecho a la consulta previa, libre e informada.', 'M'),
)
COM_CUERPO = pool(
    'Hemos intentado dialogar con la empresa sin obtener respuesta.',
    'Adjuntamos fotografías y copia de las notas enviadas anteriormente.',
    'Pedimos que se realice una inspección en presencia de los representantes de la comunidad.',
)
COM_T = pool(
    T('La comunidad de {aldea} no fue consultada ni informada sobre el proyecto, violentando el Convenio 169 de la OIT.', 'M'),
    T('Desde hace {n} semanas el agua de la quebrada {quebrada} baja turbia y el ganado ya no puede beber; exigimos una inspección.', 'AM'),
    T('Pedimos que se suspendan las labores y se otorgue a la empresa un plazo de {dias} días para reparar los daños.', 'MP'),
    T('La empresa abandonó los socavones sin cerrarlos y sin rehabilitar el terreno, con peligro para los niños.', 'MX'),
    T('Las tierras donde se pretende la concesión son comunales y colindan con el río {rio}, del que depende la comunidad.', 'AM'),
)
PAG_CAB = pool(
    T('SOLICITUD DE PERMISO DE APROVECHAMIENTO DE AGUAS.-\nDirección General de Recursos Hídricos — MiAmbiente.\n{empresa} solicita autorización para captar {q} l/s de la quebrada {quebrada}', 'A'),
    T('SE SOLICITA APROBACIÓN DEL PLAN DE CIERRE.-\nSeñor(a) Director(a) de Fiscalización Minera.\n{empresa} presenta el Plan de Cierre y Rehabilitación de la mina «{concesion}» y la propuesta de garantía de cierre.', 'X'),
    T('SE SOLICITA LIBERACIÓN DE LA GARANTÍA DE CIERRE.-\nSeñor(a) Director(a) Ejecutivo(a).\n{empresa} informa que concluyó la rehabilitación de las áreas intervenidas.', 'X'),
    T('SOLICITUD DE RENOVACIÓN DEL PERMISO DE USO DE AGUA.-\nMiAmbiente.\n{empresa} solicita renovar el permiso de captación en el río {rio}.', 'A'),
)
PAG_CUERPO = pool(
    T('El agua captada de la quebrada {quebrada} se destinará al campamento y a la planta, con recirculación del {pct} % desde la poza de relaves.', 'A'),
    T('Se adjunta el aforo de la quebrada realizado en época seca y el diseño de la obra de toma.', 'A'),
    T('El plan contempla el sellado de bocaminas, la reconformación de botaderos y la revegetación de {ha} ha.', 'X'),
    T('La garantía propuesta asciende a {usd}, mediante póliza de {aseguradora}.', 'X'),
    T('El permiso actual vence el {fecha_futura}.', 'P'),
)

SOL_SUBS = [
    (26, dict(cab=CONC_CAB, cuerpo=[(CONC_CUERPO, .7), (S_C, .9), (CONC_T, .3), (S_ABOG, .5)], cola=[(S_COLA, .9)])),
    (16, dict(cab=REC_CAB, cuerpo=[(REC_CUERPO, 1), (REC_T, .35), (S_ABOG, .5)], cola=[(S_COLA, .9)])),
    (14, dict(cab=PRO_CAB, cuerpo=[(PRO_T, 1), (S_ABOG, .4)], cola=[(S_COLA, .9)])),
    (18, dict(cab=CARTA_CAB, cuerpo=[(CARTA_CUERPO, 1), (CARTA_T, .45)], cola=[(S_COLA_EMP, .85)])),
    (16, dict(cab=COM_CAB, cuerpo=[(COM_CUERPO, .6), (COM_T, .7)], relleno=COM_CUERPO, cola=[(S_COLA_COM, .75)])),
    (10, dict(cab=PAG_CAB, cuerpo=[(PAG_CUERPO, 1), (PAG_CUERPO, .4), (S_ABOG, .3)], cola=[(S_COLA_EMP, .85)])),
]


def g_solicitud(c):
    s = subtipo(SOL_SUBS)
    cab, cola = componer(c, s)
    return cab, cola, R.choice(['', c['empresa'], 'Bufete Legal Demo'])


def medio_solicitud(c):
    return medio_de(SOL_SUBS, c)
