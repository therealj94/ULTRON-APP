"""Financiero y otro, por subtipo."""
from comun import R, T, pool, seg, componer, subtipo, medio_de

# ================================================================== financiero

FACT_CAB = pool(
    'FACTURA\nServicios Geológicos y Topográficos Demo, S. de R.L.\nRTN: {fict}\nCAI: FICT-{n}A-{nn}B-{n2}C\nFactura No. {fict2}\nFecha: {fecha}\nCliente: {empresa}',
    'FACTURA No. {fict}\nFerretería y Suministros Mineros Demo\nCliente: {empresa}\nFecha de emisión: {fecha}',
    'FACTURA COMERCIAL\n{lab}\nNo. {fict} · Cliente: {empresa} · Proyecto «{concesion}»',
    'FACTURA No. {fict}\nTransportes de Carga Pesada Demo, S.A.\nCliente: {empresa}',
)
FACT_CUERPO = pool(
    '[TABLA] Cant. | Descripción | P. unitario | Total\n1 | Levantamiento topográfico del polígono | {lps_chico} | {lps_chico}\n1 | Elaboración de plano catastral | {lps_chico2} | {lps_chico2}',
    '[TABLA] Cant. | Descripción | Total\n{n} | Barras de perforación NQ | {lps_chico}\n{n2} | Coronas diamantadas | {lps_chico2}',
    '[TABLA] Descripción | Total\nAnálisis Au FA-AA de {nn} muestras de testigo | {lps}\nPreparación de muestras | {lps_chico}',
    'Flete de mineral de la concesión a la planta, {n} viajes de volqueta de 14 m³: {lps}.',
    'Total a pagar {lps} (ISV 15 % incluido). Forma de pago: ‹contado|transferencia|cheque›.',
    'Pago del servicio de agua potable y alcantarillado del campamento, mes de {mes}: {lps_chico}.',
)
FACT_T = pool(
    T('Fecha de vencimiento: {fecha_futura}. Condiciones: crédito a 30 días.', 'P'),
    T('Vence: {fecha_futura}. El pago tardío genera intereses moratorios.', 'P'),
    T('Análisis fisicoquímicos de agua de la quebrada {quebrada} (6 puntos de monitoreo): {lps_chico}.', 'A'),
    T('Servicio de revegetación de taludes y áreas minadas según plan de cierre: {lps}.', 'X'),
)
FACT_COLA = pool(
    'Fecha límite de emisión: {fecha_futura}. Rango autorizado: FICT-000-001-01-00000001 a FICT-000-001-01-00005000.',
    'Original: cliente — Copia: emisor. La factura es beneficio de todos, exíjala.',
    'Firma del cliente: ______________ Recibido conforme.',
)
CANON_CAB = pool(
    'RECIBO OFICIAL DE INGRESOS No. {fict}\nINSTITUTO HONDUREÑO DE GEOLOGÍA Y MINAS — Tesorería\nRecibimos de: {empresa}\nLa cantidad de: {lps}\nConcepto: Pago de canon territorial año {anio}, concesión «{concesion}», {ha} ha',
    'LIQUIDACIÓN DE CANON TERRITORIAL — AÑO {anio}\nConcesión: «{concesion}»   Titular: {empresa}\nSuperficie: {ha} ha × US$ ‹0.75|1.00|2.50|5.00› por hectárea',
    'COMPROBANTE DE PAGO — Formulario TGR-1\nTesorería General de la República\nInstitución: INHGEOMIN\nConcepto: Tasa por servicios de catastro',
    'AVISO DE COBRO — MUNICIPALIDAD DE {muni}\nTesorería Municipal\nContribuyente: {empresa}\nConcepto: Impuesto sobre extracción y explotación de recursos',
    'ESTADO DE CUENTA DE CANON\nINHGEOMIN — Tesorería\nTitular: {empresa} · Concesión «{concesion}»',
    'DECLARACIÓN MENSUAL DE VENTAS DE MINERAL Y PAGO DE TASAS\n{empresa} — {mes} {anio}',
)
CANON_CUERPO = pool(
    'Tipo de cambio de referencia: L. 24.{n} por US$ 1.00. Total en lempiras: {lps}.',
    'Tasa de seguridad poblacional (1 %): {lps_chico}. Tasa municipal (2 %): {lps_chico2}.',
    '[TABLA] Período | Canon (US$) | Pagado | Saldo\nAños anteriores | {usd_chico} | Sí | 0.00\nAño {anio} | {usd_chico2} | No | {usd_chico2}',
    'Depósito efectuado en {banco}, referencia {fict}.',
    'Valor declarado de las ventas del mes: {lps}; regalía y tasas liquidadas según la ley.',
)
CANON_T = pool(
    T('Fecha límite de pago: 31 de enero de {anio}. Después de esta fecha se aplicará un recargo del 2 % mensual.', 'P'),
    T('Vence: {fecha_prox}. La falta de pago en el plazo es causal de caducidad del derecho minero.', 'P'),
    T('Pago de canon por aprovechamiento de agua de la quebrada {quebrada}, permiso {fict}: {lps_chico}.', 'A'),
    T('Plazo para cancelar el saldo: {dias} días hábiles a partir de la notificación de este aviso.', 'P'),
)
CANON_COLA_F = pool(
    T('[Firma y sello] Cajero(a) — Tesorería INHGEOMIN', 'F'),
    T('[Firma y sello] Tesorero(a) Municipal de {muni}', 'F'),
    T('Firma y sello\n________________\nTesorería — Instituto Hondureño de Geología y Minas', 'F'),
)
CANON_COLA = pool(
    'Sello del banco receptor — Cajero(a) del banco. Conserve este comprobante.',
    'Este documento no es válido sin el sello de caja del banco.',
)
EEFF_CAB = pool(
    'ESTADO DE RESULTADOS\n{empresa}\nPor el período del 1 de enero al 31 de diciembre de {anio}\n(Cifras en lempiras)',
    'BALANCE GENERAL AL 31 DE DICIEMBRE DE {anio}\n{empresa}\nActivos corrientes: Efectivo y equivalentes {lps}; Inventario de mineral {lps2}',
    'ESTADO DE CUENTA — {banco}\nCuenta corriente No. {fict}\nTitular: {empresa}\nPeríodo: {mes} {anio}',
    'NOTAS A LOS ESTADOS FINANCIEROS\n{empresa} — ejercicio {anio}',
)
EEFF_CUERPO = pool(
    'Ingresos por venta de doré {lps}; costo de ventas {lps2}; gastos de administración {lps3}; utilidad antes de impuestos {lps4}.',
    'Depósitos {lps}; retiros {lps2}; saldo final {lps3}.',
    'Utilidad neta del ejercicio {lps}; cierre contable del ejercicio fiscal al 31 de diciembre.',
    'Propiedad, planta y equipo, neto {lps}; cuentas por pagar a proveedores {lps2}; préstamos bancarios {lps3}.',
    'Los inventarios de mineral en patio se valúan al costo promedio o al valor neto realizable, el menor.',
)
EEFF_T = pool(
    T('Provisión para cierre de mina y rehabilitación (Nota {n}): {lps}.', 'X'),
    T('Nota {n}. Obligación por retiro de activos: la compañía reconoce el valor presente de los costos de cierre y rehabilitación de la mina.', 'X'),
    T('Préstamo con {banco} con vencimiento el {fecha_futura}, pagadero en cuotas trimestrales.', 'P'),
    T('Aportes comunitarios al patronato de {aldea} según convenio: {lps_chico}.', 'M'),
)
EEFF_COLA = pool(
    'Elaborado por: Contador(a) General — Revisado por: Gerente Financiero(a)',
    'Las notas adjuntas forman parte integral de los estados financieros.',
    '[Firma] Contador(a) colegiado(a) — [Firma] Representante legal',
)
PRES_CAB = pool(
    'PRESUPUESTO DE EXPLORACIÓN {anio}\nProyecto «{concesion}»',
    'FLUJO DE CAJA PROYECTADO\nProyecto «{concesion}» — escenario base, precio del oro {usd_chico}/oz',
    'COTIZACIÓN No. {fict}\nEstimados señores de {empresa}: Por este medio les presentamos nuestra oferta de servicios de análisis químico de ‹muestras de roca|agua|suelos›.',
    'PRESUPUESTO DEL PLAN DE CIERRE\nConcesión «{concesion}»',
    'COTIZACIÓN\nAlquiler de maquinaria para el proyecto «{concesion}»',
    'PRESUPUESTO ANUAL DE OPERACIÓN {anio}\n{empresa}',
)
PRES_CUERPO = pool(
    '[TABLA] Rubro | Monto (US$)\nPerforación diamantina 3,000 m | {usd}\nAnálisis de laboratorio | {usd_chico}\nMapeo y muestreo | {usd_chico2}\nContingencias 10 % | {usd_chico3}',
    'Año 0: capex {usd}; años 1–6: ingresos netos crecientes; VAN al 5 %: {usd2}; TIR: {pct} %.',
    '[TABLA] Parámetro | Precio unitario (L.)\nOro total (FA-AA) | 450.00\nMetales por ICP 33 elementos | 780.00\nPreparación de muestra | 120.00',
    'Excavadora 320: {lps_chico} por hora; operador y combustible incluidos.',
    '[TABLA] Partida | Monto (L.)\nPlanilla | {lps}\nCombustibles | {lps2}\nMantenimiento | {lps3}',
)
PRES_T = pool(
    T('Validez de la oferta: {dias} días calendario a partir de la fecha de emisión.', 'P'),
    T('[TABLA] Actividad de cierre | Costo (US$)\nDesmantelamiento de planta | {usd_chico}\nRevegetación de áreas minadas | {usd_chico2}\nSellado de bocaminas | {usd_chico3}\nMonitoreo post-cierre | {usd_chico4}', 'X'),
    T('Año 9: costos de cierre y rehabilitación {usd}; valor de salvamento {usd_chico}.', 'X'),
    T('Monitoreo de calidad de agua en la quebrada {quebrada}, cuatro campañas: {usd_chico}.', 'A'),
    T('Programa de relaciones comunitarias y socialización en {aldea}: {usd_chico}.', 'M'),
    T('Oferta sujeta a confirmación antes del {fecha_futura}.', 'P'),
)
PRES_COLA = pool(
    'Precios no incluyen ISV. Forma de pago: 50 % anticipo y 50 % contra entrega.',
    'Atentamente, [Firma] Departamento de Ventas',
    'Preparado por: Gerencia de Finanzas — versión {n}',
)
FIANZA_CAB = pool(
    'PÓLIZA DE FIANZA No. {fict}\n{aseguradora}\nAfianzado: {empresa}\nBeneficiario: Instituto Hondureño de Geología y Minas',
    'GARANTÍA BANCARIA No. {fict}\n{banco}\nOrdenante: {empresa}\nBeneficiario: MiAmbiente',
)
FIANZA_CUERPO = pool(
    'Suma afianzada: {usd}. Prima: {usd_chico}.',
    'Monto garantizado: {lps}. Comisión bancaria: {lps_chico}.',
)
FIANZA_T = pool(
    T('Objeto de la fianza: garantizar la ejecución del plan de cierre de mina de la concesión «{concesion}». Vigencia: del {fecha} al {fecha_futura}.', 'XP'),
    T('Garantía de cierre: {usd}, renovable anualmente antes del vencimiento.', 'XP'),
    T('Objeto: garantizar el cumplimiento de las medidas de control ambiental. Vence el {fecha_futura}.', 'P'),
    T('Objeto: garantizar la rehabilitación de las áreas intervenidas al término de la explotación.', 'X'),
)

FIN_SUBS = [
    (22, dict(cab=FACT_CAB, cuerpo=[(FACT_CUERPO, 1), (FACT_CUERPO, .5), (FACT_T, .45)], cola=[(FACT_COLA, .6)])),
    (26, dict(cab=CANON_CAB, cuerpo=[(CANON_CUERPO, 1), (CANON_T, .6), (CANON_CUERPO, .3)], cola=[(CANON_COLA_F, .6), (CANON_COLA, .15)])),
    (18, dict(cab=EEFF_CAB, cuerpo=[(EEFF_CUERPO, 1), (EEFF_CUERPO, .4), (EEFF_T, .6)], cola=[(EEFF_COLA, .6)], barajar=True)),
    (24, dict(cab=PRES_CAB, cuerpo=[(PRES_CUERPO, 1), (PRES_T, .6), (PRES_T, .2)], cola=[(PRES_COLA, .5)])),
    (8, dict(cab=FIANZA_CAB, cuerpo=[(FIANZA_CUERPO, 1), (FIANZA_T, .9)], cola=[(pool('[Firma] Representante autorizado(a) — {aseguradora}', 'Firma autorizada del banco emisor.'), .6)])),
]


def g_financiero(c):
    s = subtipo(FIN_SUBS)
    cab, cola = componer(c, s)
    # el cierre del presupuesto de cierre: que se vea que es de cierre
    if 'PLAN DE CIERRE' in cab[0].texto:
        cab[0].tags.add('X')
    return cab, cola, R.choice(['', c['empresa'], 'TESORERÍA'])


def medio_financiero(c):
    return medio_de(FIN_SUBS, c)


# ================================================================== otro

CORREO_CAB = pool(
    'De: Ing. de campo <campo@ejemplo.invalid>\nEnviado: {fecha}\nPara: Gerencia <gerencia@ejemplo.invalid>\nAsunto: RE: visita al proyecto\nHola, te confirmo que el lunes pasamos por el campamento a revisar la bodega.',
    'From: logistica@ejemplo.invalid\nTo: compras@ejemplo.invalid\nSubject: pedido de repuestos\nBuenas, ¿ya salió el pedido de filtros para la excavadora?',
    '[{fecha}, 08:14] Supervisor: ya llegó el camión con el diésel\n[{fecha}, 08:20] Bodega: ok, lo descargamos después del almuerzo',
    'Asunto: fotos de la visita\nTe mando las fotos de la bocamina y del patio; están pesadas, van en dos correos.',
    'Mensaje reenviado — De: Administración. Para: todo el personal. Recordatorio: el viernes no hay trabajo por el feriado.',
)
CORREO_CUERPO = pool(
    'Recordá llevar las botas y el casco; el camino está malo por las lluvias.',
    'Ojo que el proveedor de explosivos sube los precios el otro mes.',
    'Sin otro particular, saludos cordiales y quedo atento a tus comentarios.',
    'La camioneta doble cabina sigue en el taller, así que vamos en el pick-up viejo.',
    'Pasame el número del mecánico, por favor.',
)
CORREO_T = pool(
    T('Los vecinos de {aldea} están molestos por el polvo; el presidente del patronato pidió una reunión.', 'M'),
    T('Hay que pagar el canon antes del 31 de enero o nos cae la multa, no lo olviden.', 'P'),
    T('La quebrada {quebrada} sigue crecida y no pudimos cruzar al área de las trincheras.', 'A'),
    T('El jefe dice que el plan de cierre lo tenemos que entregar antes de diciembre.', 'XP'),
    T('Según el alcalde, la licencia de operación vence el {fecha_futura} y habrá que renovarla.', 'P'),
    T('Mañana llegan los del patronato de {aldea} a ver lo del acuerdo del camino.', 'M'),
)
CORREO_COLA = pool('Saludos,\nIng. de campo', 'Enviado desde mi teléfono.', 'Gracias.', 'Slds.')
PRENSA_CAB = pool(
    'NOTA DE PRENSA\n{muni}, {depto}.— ',
    'BOLETÍN INFORMATIVO No. {n}\nNoticias del sector minero y energético',
    'COMUNICADO\nLa empresa {empresa} informa a la opinión pública:',
    'NOTICIAS REGIONALES — {mes} {anio}',
)
PRENSA = pool(
    'La Cámara Minera (ficticia) informó que las exportaciones del sector crecieron durante el último trimestre, impulsadas por el precio internacional del oro.',
    'Autoridades locales inauguraron un tramo de carretera que facilitará el acceso a varias aldeas del municipio.',
    'El evento reunió a pequeños mineros, técnicos y estudiantes interesados en la formalización de la actividad.',
    'Según la empresa, el proyecto generará alrededor de {nn} empleos directos durante la fase de construcción.',
    'La feria de proveedores contó con la participación de más de {n} empresas nacionales.',
)
PRENSA_T = pool(
    T('Pobladores de la aldea {aldea} protestaron frente a la alcaldía contra el proyecto minero «{concesion}», al que acusan de contaminar la quebrada {quebrada}.', 'AM'),
    T('Representantes del pueblo {pueblo} anunciaron que exigirán una consulta previa antes de cualquier actividad minera en su territorio.', 'M'),
    T('Los manifestantes, en su mayoría vecinos de {aldea}, exigieron la cancelación del proyecto y la presencia de la fiscalía ambiental.', 'M'),
    T('Ambientalistas advirtieron sobre el riesgo para el río {rio}, principal fuente de agua de la zona.', 'A'),
)
PRENSA_COLA = pool('Para más información: comunicaciones@ejemplo.invalid', 'Redacción regional.', '— Fin del comunicado —')
CV_CAB = pool(
    'CURRÍCULUM VITAE\nGeólogo(a) de exploración — [NOMBRE]\nPerfil: más de {n} años de experiencia en exploración de vetas epitermales y logueo de testigos.',
    'HOJA DE VIDA\nIngeniero(a) de Minas — [NOMBRE]\nObjetivo: aportar experiencia en operaciones subterráneas y seguridad minera.',
    'CURRICULUM VITAE — Técnico(a) ambiental [NOMBRE]',
)
CV_CUERPO = pool(
    'Experiencia: logueo de testigos, mapeo geológico 1:1,000, supervisión de campañas de perforación RC y diamantina.',
    'Formación: Ingeniería Geológica, maestría en recursos minerales.',
    'Idiomas: español nativo, inglés intermedio. Manejo de software: Leapfrog, QGIS, AutoCAD.',
    'Cursos: primeros auxilios, manejo defensivo, seguridad en espacios confinados.',
)
CV_COLA = pool('Referencias disponibles a solicitud.', 'Disponibilidad inmediata.')
MANUAL_CAB = pool(
    'MANUAL DE PROCEDIMIENTOS DE SEGURIDAD Y SALUD OCUPACIONAL\nSección {n}: Uso de equipo de protección personal',
    'HOJA DE DATOS DE SEGURIDAD — CIANURO DE SODIO (NaCN)\nSección 1: Identificación del producto y del proveedor',
    'INSTRUCTIVO PARA EL LLENADO DEL LIBRO DE BITÁCORA\nTodos los turnos deben registrar hora de entrada, actividades y novedades.',
    'MANUAL DE OPERACIÓN DE LA TRITURADORA DE MANDÍBULA\nCapítulo {n}: arranque y parada',
    'REGLAMENTO INTERNO DE TRABAJO\n{empresa}',
)
MANUAL_CUERPO = pool(
    'El equipo de protección personal obligatorio comprende casco, lentes, protectores auditivos, guantes y botas con puntera de acero.',
    'Evite el contacto con ácidos: libera gas cianhídrico altamente tóxico. Almacenar en lugar seco y ventilado.',
    'Primeros auxilios: en caso de inhalación, trasladar a la persona al aire libre y buscar atención médica inmediata.',
    'Antes del arranque verifique el nivel de aceite, la tensión de las fajas y que no haya material en la cámara.',
    'Está prohibido ingresar a las labores bajo los efectos del alcohol.',
    'En caso de derrame, contener con arena y recoger con pala antichispa.',
)
MANUAL_COLA = pool('Documento de uso interno.', 'Revisión {n} — {mes} {anio}', 'Aprobado por: Gerencia de Operaciones.')
LISTA_CAB = pool(
    'LISTA DE VERIFICACIÓN DE DOCUMENTOS ENTREGADOS\nCarpeta: concesión «{concesion}»',
    'AGENDA DE REUNIÓN INTERNA\n1. Avance de la campaña de perforación 2. Compras pendientes 3. Varios',
    'MINUTA DE REUNIÓN DEL EQUIPO TÉCNICO\nAsistentes: gerencia, geología, contabilidad y logística.',
    'INVITACIÓN\nSe invita cordialmente al taller «Buenas prácticas en la minería artesanal» que se realizará en el salón municipal de {muni}.',
    'CONSTANCIA DE TRABAJO\nLa empresa {empresa} hace constar que el(la) señor(a) [NOMBRE] labora con nosotros como operador(a) de equipo pesado desde {anio}.',
    'PRESENTACIÓN CORPORATIVA — {empresa}\nNuestra visión: ser referentes en minería responsable en Centroamérica.',
)
LISTA_CUERPO = pool(
    'Checklist: [x] escritura de constitución [x] RTN [ ] solvencia municipal [x] plano firmado.',
    'Se acordó comprar dos generadores y revisar el inventario de repuestos antes de fin de mes.',
    'El taller es gratuito e incluye refrigerio; favor confirmar asistencia por teléfono.',
    'La empresa cuenta con un equipo multidisciplinario y opera bajo estándares internacionales de seguridad.',
    'Se extiende la presente a solicitud del interesado para los fines que estime convenientes.',
)
LISTA_T = pool(
    T('LISTA DE ASISTENCIA — reunión informativa con la comunidad de {aldea}\n[TABLA] No. | Nombre | Comunidad | Firma\n1 | [NOMBRE] | {aldea} | [firma]\n2 | [NOMBRE] | {aldea2} | [huella]', 'M'),
    T('Asistentes por comunidad: {aldea} ({n}), {aldea2} ({n2}); se firmó la lista al final de la socialización.', 'M'),
    T('Pendiente: entregar el plan de cierre revisado antes del {fecha_futura}.', 'XP'),
)

OTR_SUBS = [
    (26, dict(cab=CORREO_CAB, cuerpo=[(CORREO_CUERPO, .8), (CORREO_T, .45)], relleno=CORREO_CUERPO, cola=[(CORREO_COLA, .5)])),
    (18, dict(cab=PRENSA_CAB, cuerpo=[(PRENSA, 1), (PRENSA, .5), (PRENSA_T, .45)], cola=[(PRENSA_COLA, .4)])),
    (12, dict(cab=CV_CAB, cuerpo=[(CV_CUERPO, 1), (CV_CUERPO, .6)], cola=[(CV_COLA, .5)])),
    (20, dict(cab=MANUAL_CAB, cuerpo=[(MANUAL_CUERPO, 1), (MANUAL_CUERPO, .5)], cola=[(MANUAL_COLA, .5)])),
    (24, dict(cab=LISTA_CAB, cuerpo=[(LISTA_CUERPO, .8), (LISTA_T, .35)], relleno=LISTA_CUERPO, cola=[(MANUAL_COLA, .3)])),
]


def g_otro(c):
    s = subtipo(OTR_SUBS)
    cab, cola = componer(c, s)
    return cab, cola, R.choice(['', c['empresa']])


def medio_otro(c):
    return medio_de(OTR_SUBS, c)
