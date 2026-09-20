/**
 * CEREBRO DE MINAS — conocimiento de minería como oficio.
 *
 * Minería general: geología, exploración, muestreo, recursos y reservas, métodos de explotación,
 * metalurgia, economía, seguridad, ambiente y marco regulatorio. NO contiene datos internos de
 * Orden Global: esta plataforma es de demostración y se puede enseñar a cualquiera.
 *
 * Formato: secciones en MAYÚSCULA y hechos en líneas que empiezan con «- ». El recuperador
 * (lib/cerebro.ts) solo mira esas líneas, así que un hecho nuevo se agrega como una línea más.
 * Números exactos donde los hay; donde hay rango, se dice que es rango y de qué depende.
 */
export const CONOCIMIENTO_MINAS = `CEREBRO DE MINAS — minería como oficio. Hechos para no inventar. Si no está aquí, decilo y ofrecé buscarlo.

UNIDADES Y CONVERSIONES
- Onza troy = 31,1034768 gramos. Es la unidad de oro, plata, platino y paladio. La onza común (avoirdupois, 28,35 g) NO se usa para metales preciosos.
- Ley en g/t (gramos por tonelada) equivale exactamente a ppm (partes por millón): 1 g/t = 1 ppm.
- 1 onza troy por tonelada corta (short ton, 907,185 kg) = 34,2857 g/t.
- 1 onza troy por tonelada métrica = 31,1035 g/t.
- Tonelada métrica = 1.000 kg. Tonelada corta = 907,185 kg. Tonelada larga = 1.016,05 kg.
- Cobre, plomo, zinc y níquel se reportan en porcentaje (%). 1% = 10.000 g/t = 10.000 ppm.
- Onzas contenidas = tonelaje (t) x ley (g/t) / 31,1035.
- Libras de cobre contenidas = tonelaje (t) x ley (%) / 100 x 2.204,62.
- Densidad aparente (bulk density) convierte volumen a tonelaje: tonelaje = volumen (m3) x densidad (t/m3). Roca de mina típica 2,5 a 3,0 t/m3; sulfuros masivos hasta 4,5.

TIPOS DE YACIMIENTO
- Pórfido de cobre (Cu-Mo, Cu-Au): enorme tonelaje y ley baja, 0,3 a 1,0% Cu. Se mina a cielo abierto. Es la fuente de la mayoría del cobre del mundo. Zonación: potásica, fílica, argílica, propilítica.
- Epitermal de alta sulfuración: oro y cobre en rocas muy alteradas (sílice oquerosa, alunita). Suele ser oro diseminado, lixiviable.
- Epitermal de baja sulfuración: vetas de cuarzo con oro y plata, texturas bandeadas y de crustificación. Leyes altas y erráticas, tonelaje chico. Es el clásico de la minería de veta.
- Orogénico (mesotermal) de oro: vetas de cuarzo en cinturones metamórficos. Continuidad a mucha profundidad. Es la fuente histórica del oro de filón.
- Skarn: reemplazo en caliza junto a una intrusión. Cu, Au, Zn, W. Leyes buenas, geometría caprichosa.
- VMS (sulfuros masivos volcanogénicos): lentes de Cu-Zn-Pb-Ag-Au en secuencias volcánicas submarinas. Ley alta, cuerpos chicos y apilados.
- IOCG (óxido de hierro-cobre-oro): grandes, Cu-Au-U. Olympic Dam es el arquetipo.
- Placer (aluvial): oro libre concentrado por el río en gravas. Se recupera por gravedad, sin química. Es la minería artesanal más común.
- Laterita de níquel: perfil de meteorización sobre peridotita. Limonita arriba (proceso HPAL), saprolita abajo (ferroníquel).
- SEDEX: Pb-Zn en cuencas sedimentarias. Carbonatita: tierras raras y niobio.

EXPLORACIÓN
- Secuencia normal: mapeo geológico, geoquímica de suelos y sedimentos, geofísica, trincheras, perforación, estimación de recursos, estudios de ingeniería.
- Geoquímica: muestras de suelo, roca (rock chip) y sedimento de quebrada. Se buscan anomalías contra el fondo regional. Elementos guía del oro: arsénico, antimonio, mercurio, bismuto, telurio.
- Geofísica: magnetometría (cuerpos magnéticos y estructuras), IP o polarización inducida (sulfuros diseminados, la mejor para pórfidos), resistividad, gravimetría (sulfuros masivos), electromagnetismo.
- Perforación de aire reverso (RC): rápida y barata, entrega detritos, no testigo. Sirve para definir volumen.
- Perforación diamantina (DDH): entrega testigo continuo, permite ver estructura, alteración y densidad. Más cara y más lenta. Es la que exige un informe serio.
- Recuperación de testigo: por debajo de 90% el dato es sospechoso, sobre todo en zonas ricas donde el mineral blando se pierde.
- Sesgo de muestreo: perforar paralelo a la estructura infla la potencia aparente. El ángulo de intersección se corrige a potencia verdadera.

MUESTREO Y ENSAYO
- Ensayo al fuego (fire assay) es el método patrón para oro: fusión, copelación y pesada del botón. Es el único aceptado como definitivo en un informe.
- Screen fire assay o metálicos: obligatorio cuando hay oro grueso (efecto pepita), porque una muestra chica no representa la ley.
- Digestión con agua regia o multielemento por ICP: buena para exploración y elementos base, no sustituye al fire assay para oro.
- QA/QC es innegociable: estándares certificados, blancos y duplicados insertados a razón de una de cada 20 muestras aproximadamente. Sin QA/QC, el dato no vale para un recurso.
- Cadena de custodia: muestra sellada, numerada y trazable desde el sondaje hasta el laboratorio.

RECURSOS Y RESERVAS
- Recurso mineral: concentración con perspectiva razonable de extracción económica eventual. Reserva mineral: la parte del recurso que un estudio demostró que se puede minar y pagar hoy.
- Categorías de recurso, de menos a más confianza: Inferido, Indicado, Medido.
- Categorías de reserva: Probable (viene de Indicado) y Probada (viene de Medido).
- Un recurso Inferido NO se convierte en reserva. Es la regla que más se viola en la publicidad minera.
- Recursos y reservas no se suman: la reserva ya está contenida en el recurso. Sumarlas es doble conteo.
- NI 43-101: norma canadiense. Exige una Persona Calificada (QP) que firma. Es la que citan las empresas listadas en Toronto.
- JORC: norma australasiática, firma una Persona Competente. SAMREC: Sudáfrica. S-K 1300: Estados Unidos, vigente desde 2021. Todas cuelgan de CRIRSCO y son equivalentes en espíritu.
- Escalera de estudios: PEA o evaluación económica preliminar (puede usar Inferido, no sirve para decidir inversión), Prefactibilidad (PFS, ya exige reservas), Factibilidad (FS, precisión de mas menos 15%).
- Estimación: modelo de bloques con kriging ordinario o inverso de la distancia; se acotan los valores extremos (top cut) para que una muestra excepcional no infle todo el bloque.
- Ley de corte (cutoff): la ley mínima a la que un bloque paga su propio procesamiento. Todo lo que está por debajo es estéril aunque tenga metal.

MÉTODOS A CIELO ABIERTO
- Se usa cuando el cuerpo es ancho, somero y de ley baja. Ciclo: perforación, voladura, carguío, acarreo.
- Banco típico de 5 a 15 metros de altura. Rampa con pendiente de 8 a 10%.
- Relación de descapote (strip ratio) = toneladas de estéril por tonelada de mineral. Por encima de 3 a 1 el estéril ya manda en el costo; por encima de 8 a 1 solo aguanta con ley alta.
- Ángulo de talud: lo define la geotecnia, no el deseo. Un grado de más en el talud ahorra millones de toneladas de estéril, y un grado de más equivocado tumba el banco.
- Voladura: ANFO en roca seca, emulsión en roca con agua. Factor de carga típico 0,2 a 0,4 kg por tonelada.
- Ventajas: bajo costo por tonelada (2 a 5 USD), alta recuperación del cuerpo, seguro. Desventajas: huella enorme, estéril, y es lo que más resistencia social genera.

MÉTODOS SUBTERRÁNEOS
- Corte y relleno (cut and fill): se saca una tajada y se rellena para sostener. Flexible, selectivo, caro. Ideal para vetas angostas de ley alta.
- Sublevel stoping (tajeo por subniveles): cámaras grandes con barrenos largos. Barato por tonelada, exige roca competente.
- Shrinkage: el mineral volado sostiene el techo mientras se extrae por abajo. Viejo, barato, peligroso y poco selectivo.
- Cámaras y pilares (room and pillar): horizontal, mantos. Deja mineral en los pilares.
- Block caving: se socava el cuerpo y la gravedad lo quiebra. El costo por tonelada más bajo del subterráneo, comparable a cielo abierto, pero exige capital enorme y de cinco a diez años antes de la primera tonelada.
- Dilución: estéril que entra con el mineral y baja la ley enviada a planta. 5 a 15% es normal; sobre 20% se come el negocio.
- Recuperación minera: fracción del cuerpo que efectivamente se extrae. 70 a 95% según método.
- Costo subterráneo típico: 30 a 120 USD por tonelada. Un orden de magnitud sobre el cielo abierto.

PROCESAMIENTO Y METALURGIA
- Conminución (chancado y molienda) es la etapa que más energía consume, del orden del 40 al 50% de la energía del sitio. Se dimensiona con el índice de trabajo de Bond.
- Circuito común: chancado primario, molino SAG, molino de bolas, clasificación con hidrociclones.
- Gravedad (Knelson, Falcon, mesa) recupera el oro libre y grueso antes de la química. Barato y siempre conviene si hay oro libre.
- Flotación: separa sulfuros con reactivos (colectores xantatos, espumantes, depresores). Produce concentrado. Es la ruta del cobre, plomo, zinc y del oro asociado a sulfuros.
- Cianuración: el oro se disuelve en cianuro alcalino con oxígeno. CIL (carbón en lixiviación) y CIP (carbón en pulpa) recuperan el oro con carbón activado.
- Lixiviación en pilas (heap leach): mineral chancado sobre una membrana, regado con solución. Ley baja (0,3 a 1,0 g/t), inversión baja, recuperación de 60 a 75% y meses de ciclo.
- Merrill-Crowe: precipitación con polvo de zinc. Se prefiere sobre carbón cuando hay mucha plata.
- Desorción del carbón, electrodeposición y fundición dan el doré: barra de oro y plata impura que se manda a refinar a 99,99%.
- Oro de molienda libre (free milling): recuperación de 90 a 95% con cianuración.
- Oro refractario: encapsulado en pirita o arsenopirita, o con carbón orgánico que lo roba de la solución. Sin pretratamiento la recuperación cae a 30 a 50%. Pretratamientos: tostación, oxidación a presión (POX), biooxidación (BIOX), ultrafina.
- Concentrado de cobre: 20 a 30% Cu típico. La fundición paga alrededor del 96,5% del cobre y descuenta cargos de tratamiento (TC) y refinación (RC), más penalidades por arsénico, antimonio o flúor.
- Recuperación metalúrgica = metal recuperado / metal alimentado. Es el número que convierte una ley en dinero. Un recurso sin pruebas metalúrgicas no tiene valor demostrado.

ECONOMÍA MINERA
- Cash cost: costo directo de producir una onza o una libra. AISC (all-in sustaining cost): el estándar del World Gold Council, agrega sostenimiento, exploración de mina, regalías y corporativo. Es el número honesto para comparar minas de oro.
- AISC de referencia en oro: bajo 1.000 USD por onza es competitivo, sobre 1.600 USD por onza la mina es frágil ante una caída de precio.
- Capital de desarrollo (capex) de una mina de oro mediana: cientos de millones de dólares. El capital de sostenimiento es el que mantiene la flota y la profundización.
- Valuación por flujo descontado: VAN a tasa del 5% para oro y 8 a 10% para metales base es la convención; TIR y período de recuperación acompañan.
- Ley de corte marginal = costo de proceso y G&A por tonelada / (precio x recuperación x factor de unidades). No incluye el costo de mina cuando el mineral ya está en cancha.
- Valor in situ NO es valor: es tonelaje por ley por precio, sin descontar costo, recuperación ni tiempo. Citarlo como si fuera riqueza es la señal más clara de un proyecto mal presentado.
- Vida de mina (LOM): reservas / ritmo anual de tratamiento. Menos de siete años cuesta financiar.
- Regalías: pago sobre producción o sobre valor. NSR (net smelter return) es la forma más común y se calcula sobre el ingreso neto de fundición.

SEGURIDAD Y AMBIENTE
- Depósito de relaves (TSF) es el mayor riesgo de una mina. Tipos de crecimiento: aguas arriba (el más barato y el que falla), línea central, aguas abajo (el más seguro).
- Mariana 2015 y Brumadinho 2019 en Brasil fueron fallas de presas aguas arriba con cientos de muertos. De ahí salió el GISTM, el estándar global de gestión de relaves de 2020.
- Drenaje ácido de roca (DAR o AMD): la pirita expuesta al aire y al agua genera ácido sulfúrico y moviliza metales. Es un pasivo que dura siglos y se previene, no se cura.
- Código Internacional de Manejo de Cianuro (ICMI): certificación voluntaria de transporte, uso y destrucción del cianuro.
- ICMM: consejo internacional de minería y metales; sus principios son el piso de conducta que exige la banca.
- Riesgos de vida en mina: caída de rocas, atmósferas sin oxígeno o con monóxido, polvo de sílice (silicosis), tránsito de equipo pesado, energía almacenada.
- Licencia social: sin acuerdo con la comunidad, un proyecto permisado igual se detiene. El consentimiento libre, previo e informado aplica a pueblos indígenas (Convenio 169 de la OIT).
- Cierre de mina: se planifica desde el diseño y se garantiza con fondos. Incluye estabilidad física y química, y uso posterior del terreno.

MINERÍA ARTESANAL
- La minería artesanal y de pequeña escala (MAPE o ASGM) produce cerca del 20% del oro del mundo y ocupa a millones de personas.
- Es la mayor fuente mundial de emisiones de mercurio por acción humana: la amalgama se quema al aire libre.
- El Convenio de Minamata sobre el mercurio busca eliminar esa práctica. Alternativas: concentración por gravedad, mesas y retortas que recuperan el mercurio.

MARCO REGULATORIO EN HONDURAS
- La autoridad minera es el INHGEOMIN, Instituto Hondureño de Geología y Minas.
- La norma base es la Ley General de Minería, Decreto 238-2012, con su reglamento.
- Los derechos mineros se otorgan por concesión, con etapas de exploración y de explotación, y obligaciones de canon, informes y cierre.
- El permiso ambiental lo tramita la autoridad ambiental (MiAmbiente / SERNA), aparte de la concesión minera.
- En 2022 el gobierno declaró a Honduras libre de minería a cielo abierto y anunció cancelación de permisos. Es una declaración de política cuya aplicación legal ha sido discutida caso por caso: antes de afirmar el estado de una concesión concreta, hay que verificarlo en el expediente, no en la noticia.
- No confirmes vigencias, áreas ni titulares de una concesión real sin el documento delante.

GLOSARIO
- Ley (grade): concentración de metal en la roca. Potencia (width): espesor del cuerpo. Corrida (strike): longitud horizontal. Clavo (shoot): zona rica dentro de la veta.
- Estéril (waste): roca sin ley suficiente. Mineral (ore): roca que paga. La diferencia la fija la ley de corte, no la geología.
- Cancha o stockpile: acopio de mineral. Frente: cara de trabajo. Labor: excavación subterránea. Pique o shaft: labor vertical. Socavón o adit: labor horizontal desde superficie.
- Doré: barra impura de oro y plata que sale de la mina. Bullion: metal ya refinado.
- Efecto pepita (nugget effect): variabilidad extrema del oro grueso que arruina la representatividad de muestras chicas.

REGLAS DE ESTA PLATAFORMA
- Es una demostración. No está abierta al público y no reemplaza a una Persona Calificada ni a un informe firmado.
- No se opina sobre concesiones, titulares ni vigencias reales sin documento.
- Ninguna cifra de Orden Global vive aquí: si preguntan por las minas, la bóveda, la cadena 5550 o la junta, eso es Genesis Core, otra plataforma.
- Números con unidad siempre. Si falta un dato para calcular, se pide; no se supone.
`;
