/**
 * HECHOS VIGENTES: QUIÉN ESTÁ HOY Y QUÉ DICE HOY LA LEY.
 *
 * «¿Quién es el director de INHGEOMIN?» no se contesta de memoria: los cargos cambian con cada
 * gobierno y la ley minera tuvo reformas (2019, 2024) y un fallo de inconstitucionalidad (2026). Cada
 * hecho lleva la fecha del dato y la fuente pública donde se leyó, y se dice así: «según La Prensa
 * del 3 de febrero de 2026…». Lo que no se pudo confirmar va marcado `confirmado: false` y se dice
 * como tal.
 *
 * No va en el system (que ya está en su tope): cuando la pregunta toca una institución, un cargo o
 * la ley, los hechos que le tocan van pegados a ella, como las fichas del catastro.
 *
 * Investigado en fuentes públicas el 29-09-2026. Para actualizar: cambiar el hecho, su `fecha` y su
 * `fuente`; `VERIFICADO` es la fecha de la última revisión completa.
 */

export const VERIFICADO = '2026-09-29';

export type Hecho = {
  /** Palabras (sin tildes, minúsculas) que, en la pregunta, traen este hecho. */
  temas: string[];
  texto: string;
  /** Fecha del dato (no de la revisión). */
  fecha: string;
  fuente: string;
  url: string;
  confirmado?: boolean;
};

const INHGEOMIN = ['inhgeomin', 'instituto hondureno de geologia', 'geologia y minas', 'autoridad minera'];
const SERNA = ['serna', 'miambiente', 'mi ambiente', 'secretaria de ambiente', 'recursos naturales y ambiente', 'ministro de ambiente', 'licencia ambiental'];
const ICF = ['icf', 'conservacion forestal', 'areas protegidas', 'area protegida', 'forestal', 'sinaph'];
const LEY = ['ley de mineria', 'ley general de mineria', 'ley minera', '238-2012', 'decreto 109-2019', '18-2024', 'inconstitucional', 'sala de lo constitucional', 'reforma', 'canon', 'regalia', 'impuesto', 'consulta previa', 'consulta ciudadana', 'oit 169', 'plazo', 'prorroga'];
const CARGO = ['director', 'directora', 'ministro', 'ministra', 'secretario', 'secretaria', 'subdirector', 'quien es', 'quien esta', 'quien dirige', 'titular de', 'autoridades', 'jefe', 'presidente'];

export const HECHOS: Hecho[] = [
  // --- Gobierno
  {
    temas: ['presidente', 'gobierno', 'asfura', 'casa presidencial'],
    texto: 'Presidente de Honduras: Nasry Juan Asfura Zablah (Partido Nacional), período 2026-2030; juramentado el 27 de enero de 2026.',
    fecha: '2026-01-27',
    fuente: 'HRN',
    url: 'https://www.radiohrn.hn/nasry-asfura-llega-al-poder-y-marca-el-inicio-de-una-nueva-era-para-honduras-2026-01-27',
  },
  {
    temas: ['congreso', 'presidente del congreso', 'diputado', 'comision de mineria'],
    texto: 'Presidente del Congreso Nacional 2026-2030: José Tomás Zambrano Molina (electo con 86 votos).',
    fecha: '2026-01-24',
    fuente: 'Congreso Nacional',
    url: 'https://congresonacional.hn/noticias/69740ab8a4b2afcb89c68225',
  },
  {
    temas: ['comision de mineria', 'hidrocarburos', 'congreso', 'reforma', 'diputado'],
    texto: 'La Comisión de Minería e Hidrocarburos del Congreso la preside el diputado Erick Alvarado (PN, Copán); en 2026 revisa la reforma de la ley tras el fallo de inconstitucionalidad (artículos anulados, licencias, impuestos, minería artesanal). Aún no hay decreto aprobado.',
    fecha: '2026-06-27',
    fuente: 'Criterio.hn',
    url: 'https://criterio.hn/fallo-sobre-ley-de-mineria-sustenta-reforma-pero-no-garantiza-corregir-sus-vicios-de-inconstitucionalidad',
  },
  {
    temas: ['procurador', 'procuraduria', 'pgr'],
    texto: 'Procurador General de la República: Dagoberto Aspra; subprocurador: José Francisco Quiroz (electos el 2 de febrero de 2026, hasta 2030).',
    fecha: '2026-02-02',
    fuente: 'PGR',
    url: 'https://pgr.gob.hn/2026/02/04/la-procuraduria-general-de-la-republica-se-honra-en-recibir-a-la-maxima-autoridad-de-esta-institucion-quien-en-el-marco-de-la-constitucion-ha-sido-juramentado-en-fecha-02-02-2026-como-procurador-ge/',
  },
  {
    temas: ['energia', 'enee', 'secretaria de energia'],
    texto: 'Secretario de Energía: Eduardo Oviedo García (también gerente interino de la ENEE). La SEN no tiene competencia minera directa.',
    fecha: '2026-02-11',
    fuente: 'La Tribuna',
    url: 'https://www.latribuna.hn/2026/02/11/eduardo-oviedo-admite-quiebra-financiera-de-la-enee/',
  },
  {
    temas: ['desarrollo economico', 'sde', 'inversion'],
    texto: 'Secretario de Desarrollo Económico: Eddy Johans Ordóñez Rubí (desde el 7 de febrero de 2026).',
    fecha: '2026-03-04',
    fuente: 'Tiempo',
    url: 'https://tiempo.hn/honduras/2026/03/04/eddy-ordonez-apunta-secretaria-desarrollo-economico-eficiente/',
  },

  // --- INHGEOMIN
  {
    temas: [...INHGEOMIN, 'director'],
    texto: 'Director Ejecutivo de INHGEOMIN: abogado Óscar Felipe García López, juramentado por el presidente Asfura el 2 de febrero de 2026; seguía en el cargo en junio de 2026 (mesa técnica con mineros artesanales para censarlos y legalizarlos).',
    fecha: '2026-06-21',
    fuente: 'La Prensa (3-feb-2026 y 21-jun-2026)',
    url: 'https://www.laprensa.hn/honduras/asfura-juramenta-autoridades-defensa-bch-911-inhgeomin-IM29163759',
  },
  {
    temas: [...INHGEOMIN, 'subdirector'],
    texto: 'Subdirector de INHGEOMIN: abogado José Ramón León Madrid (una nota de Diario Roatán lo llama «director»; las demás fuentes, subdirector). Fecha de nombramiento sin confirmar.',
    fecha: '2026-06-04',
    fuente: 'Enter504 / Canal Colosuca',
    url: 'https://enter504.com/comision-de-mineria-del-cn-analiza-reformas-para-promover-inversion-responsable-y-proteccion-ambiental',
    confirmado: false,
  },
  {
    temas: [...INHGEOMIN, 'director anterior', 'antes'],
    texto: 'Directores anteriores de INHGEOMIN: Ing. Carlos Maradiaga (gobierno de Xiomara Castro, activo al menos en nov-2024) y Agapito Rodríguez (juramentado el 18-dic-2025, al cierre de ese gobierno; ya lo había sido con Juan Orlando Hernández).',
    fecha: '2025-12-18',
    fuente: 'HCH / El Heraldo',
    url: 'https://hch.tv/juramentados-olgaalvaradohn-como-encargada-presidencial-del-pani-y-agapito-rodriguez-como-director-inhgeomin/',
  },
  {
    temas: [...INHGEOMIN, 'que es', 'funciones', 'estructura', 'organigrama', 'adscrito'],
    texto: 'INHGEOMIN es un ente desconcentrado con independencia técnica y administrativa, creado por la Ley General de Minería (Decreto 238-2012, vigente desde el 23-abr-2013); el PCM 042-2014 lo adscribió a SERNA. Funciones: política minera; otorgar, modificar y extinguir concesiones; fiscalización ambiental y de seguridad e higiene; investigación geológica y banco de datos geocientíficos; catastro minero por cuadrículas; cobro de cánones y tasas. Tiene Plan Estratégico 2024-2028.',
    fecha: '2026-09-29',
    fuente: 'inhgeomin.gob.hn',
    url: 'https://www.inhgeomin.gob.hn/quienes-somos',
  },
  {
    temas: [...INHGEOMIN, 'unidad', 'estructura', 'mape', 'artesanal', 'conflictos', 'organigrama'],
    texto: 'Unidades de INHGEOMIN creadas por acuerdo: Unidad MAPE (064-09-2018); Prevención y Resolución de Conflictos Mineros (022-05-2018) y Fuerza de Tarea de Conflictos (059-09-2018); Modernización (19-02-2019); Cartera y Cobranzas (01-01-2020); Género (25-11-2021); Protocolo de Fiscalización (Acuerdo 111-2024); SIGEM/DUMAPE para minería artesanal y pequeña (Acuerdo 88-2024). El organigrama con nombres de direcciones no está publicado en texto.',
    fecha: '2026-09-29',
    fuente: 'Biblioteca jurídica de INHGEOMIN',
    url: 'https://www.inhgeomin.gob.hn/gesti%C3%B3n-minera/biblioteca-jur%C3%ADdica',
  },
  {
    temas: [...INHGEOMIN, 'tramite', 'tramites', 'solicitud', 'requisitos', 'dupai', 'calcumin', 'sigem', 'exportacion', 'cesion'],
    texto: 'Trámites que publica INHGEOMIN: concesión de exploración, de explotación y de beneficio; registro de comercializador; permiso de pequeña minería metálica y de gemas; convenio de áreas especiales; cambio de minerales, conversión a pequeña o artesanal, cesión, ampliación o reducción de área; renuncia; autorización de exportación; declaraciones (DAC); planes de cierre. Herramientas en línea: DUPAI (procedimientos) y CALCUMIN (calculadora); las municipalidades usan SIGEM.',
    fecha: '2026-09-29',
    fuente: 'inhgeomin.gob.hn — Trámites disponibles',
    url: 'https://www.inhgeomin.gob.hn/tramites-y-servicios/tramites-disponibles',
  },
  {
    temas: [...INHGEOMIN, 'artesanal', 'censo', 'legalizacion', 'pequena mineria'],
    texto: 'En junio de 2026 INHGEOMIN abrió una mesa técnica para censar y legalizar la minería artesanal (unas 200 familias dependen de ella) y dijo que no permitirá minería en zonas protegidas.',
    fecha: '2026-06-21',
    fuente: 'La Prensa',
    url: 'https://www.laprensa.hn/portada/instituto-hondureno-geologia-minas-impulsa-legalizacion-mineria-artesanal-KF31167814',
  },
  {
    temas: [...INHGEOMIN, 'direccion', 'oficina', 'contacto', 'donde queda', 'sitio web'],
    texto: 'INHGEOMIN: Col. Loma Linda Norte, Bulevar Centroamérica, Avenida La FAO, Tegucigalpa. Sitio: https://www.inhgeomin.gob.hn (el dominio sin «www» no abre). El teléfono no está verificado en fuente oficial.',
    fecha: '2026-09-29',
    fuente: 'inhgeomin.gob.hn / govserv',
    url: 'https://www.inhgeomin.gob.hn/',
  },

  // --- SERNA / MiAmbiente
  {
    temas: [...SERNA, 'ministro', 'secretario'],
    texto: 'Ministro de SERNA (Secretaría de Recursos Naturales y Ambiente, antes MiAmbiente): Juan Carlos Ramos, desde inicios de febrero de 2026 (período 2026-2030). El 30-ene-2026 había sido juramentado primero como director del ICF.',
    fecha: '2026-02-05',
    fuente: 'SERNA / EcoNoticias HN',
    url: 'https://ecohn.news/a/juan-carlos-ramos-asume-como-nuevo-secretario-de-recursos-naturales-y-ambiente-para-el-periodo-2026-2030.html',
  },
  {
    temas: [...SERNA, 'subsecretario', 'viceministro'],
    texto: 'Subsecretario de Ambiente de SERNA: Ramón Dagoberto Rodríguez (juramentado en marzo de 2026, recibido el 7-abr-2026). El viceministro de Recursos Naturales no está confirmado.',
    fecha: '2026-04-07',
    fuente: 'SERNA',
    url: 'https://serna.gob.hn/',
  },
  {
    temas: [...SERNA, 'sineia', 'categoria', 'deca', 'slas', 'estudio de impacto', 'eia', 'licencia'],
    texto: 'Licenciamiento ambiental: el SINEIA (reglamento reformado en 2019) clasifica los proyectos en categorías 1 a 4, de impacto bajo a muy alto; la tabla vigente es la del Acuerdo Ministerial 705-2021. Evalúa la DECA (Dirección de Evaluación y Control Ambiental) por la plataforma SLAS (slas.miambiente.gob.hn: registro, carga de documentos, viabilidad, presentación física). Algunas municipalidades emiten licencias de categorías 1 a 3. La Ley de Minería da 90 días hábiles para la licencia de explotación (art. 19).',
    fecha: '2026-07-16',
    fuente: 'Hondudiario / Leyes.hn / SERNA-SLAS',
    url: 'https://www.hondudiario.com/2026/07/16/serna-acelera-licencias-y-reduce-mora-pero-descarta-tramite-para-muelle-de-cruceros-en-omoa/',
  },
  {
    temas: [...SERNA, 'mora', 'atraso', 'cuanto tarda', 'demora'],
    texto: 'En julio de 2026 SERNA dijo haber bajado la mora de licencias de unos 12 000 a 3 600 expedientes. Antes, una encuesta del COHEP (ago-2024) medía de 9 meses a 2 años por licencia.',
    fecha: '2026-07-16',
    fuente: 'Hondudiario / La Prensa',
    url: 'https://www.hondudiario.com/2026/07/16/serna-acelera-licencias-y-reduce-mora-pero-descarta-tramite-para-muelle-de-cruceros-en-omoa/',
  },

  // --- ICF
  {
    temas: [...ICF, 'director', 'ministro director'],
    texto: 'Director Ejecutivo del ICF: José Armando Ramírez Mejía, designado el 13-14 de febrero de 2026; seguía en funciones el 21-sep-2026 (cuando el ICF adoptó la firma electrónica avanzada).',
    fecha: '2026-09-21',
    fuente: 'Tiempo / El Heraldo',
    url: 'https://www.elheraldo.hn/portada/icf-incorpora-firma-electronica-avanzada-para-agilizar-procesos-tramites-honduras-AI32095306',
  },
  {
    temas: [...ICF, 'constancia', 'dictamen', 'microcuenca', 'cambio de uso'],
    texto: 'Para minería, el ICF emite la constancia o dictamen de si el predio está en área protegida, microcuenca declarada o propuesta, o bosque (lo hace su Centro de Información y Patrimonio Forestal); se exige en el licenciamiento ambiental. También aprueba planes de manejo y cambio de uso del suelo forestal (Ley Forestal, Decreto 98-2007) y administra el SINAPH.',
    fecha: '2026-09-29',
    fuente: 'eRegulations Honduras',
    url: 'https://honduras.eregulations.org/procedure/373/586/step/979',
  },

  // --- Ley y fallos
  {
    temas: [...LEY, 'reglamento'],
    texto: 'Marco legal: Ley General de Minería, Decreto 238-2012 (La Gaceta 33,088, 2-abr-2013); Reglamento, Acuerdo Ejecutivo 042-2013; Reglamento Especial MAPE, Acuerdo 088-B-2018; Reglamento de Cierre de Minas, Acuerdo 011-2017.',
    fecha: '2013-04-02',
    fuente: 'TSC / Biblioteca INHGEOMIN',
    url: 'https://www.tsc.gob.hn/web/leyes/Ley_de_Mineria.pdf',
  },
  {
    temas: [...LEY, 'area protegida', 'areas protegidas', 'agua', 'botaderos', 'articulo 48'],
    texto: 'Decreto 18-2024 (aprobado el 21-feb-2024, vigente desde el 6-may-2024): reformó el art. 48 y prohíbe otorgar derechos mineros en áreas protegidas declaradas, zonas productoras de agua declaradas, las zonas del art. 123 de la Ley Forestal y playas o zonas de bajamar de vocación turística; además restituyó la zona núcleo del Parque Nacional Montaña de Botaderos «Carlos Escaleras».',
    fecha: '2024-05-06',
    fuente: 'Cespad / vLex',
    url: 'https://hn.vlex.com/vid/decreto-no-18-2024-1035049138',
  },
  {
    temas: [...LEY, 'fallo', 'sentencia', 'corte', 'anulados', 'articulos'],
    texto: 'Fallo 2026 de la Sala de lo Constitucional (recurso de 2014 de IDAMHO): declaró parcialmente inconstitucionales los arts. 22, 39, 43, 47, 48, 67 y 68 (duración de concesiones, profundidad, máximo por titular, reservas y áreas protegidas, consulta a pueblos y comunidades) y constitucionales los arts. 36, 49, 53, 55, 56, 60, 61, 66, 70, 76, 77, 86 y 111. Efectos hacia el futuro, sin tocar derechos ya otorgados; publicado en La Gaceta a inicios de junio de 2026. Exhorta al Congreso a legislar plazos, consulta previa efectiva, tributación y catálogo de áreas protegidas.',
    fecha: '2026-06-27',
    fuente: 'Criterio.hn / Diario Roatán / Centroamérica360',
    url: 'https://criterio.hn/fallo-sobre-ley-de-mineria-sustenta-reforma-pero-no-garantiza-corregir-sus-vicios-de-inconstitucionalidad',
  },
  {
    temas: [...LEY, 'plazo', 'exploracion', 'explotacion', 'cuantos anos', 'duracion'],
    texto: 'Plazos del texto de 2013 (OJO: los arts. 22 y 43 fueron anulados parcialmente en 2026, no darlos como vigentes sin advertirlo): exploración 5 años metálicos y 2 no metálicos/gemas, prorrogable una vez (art. 16); explotación mínimo 15 años metálicos y 10 no metálicos (art. 22), prórroga pedida con 3 meses de anticipación (art. 23); máximo 10 concesiones por titular (art. 43); pequeña minería hasta 10 ha (art. 45); artesanal hasta 100 ha por municipio (art. 44).',
    fecha: '2026-06-27',
    fuente: 'Ley 238-2012 (TSC) + fallo 2026 (Criterio.hn)',
    url: 'https://www.tsc.gob.hn/web/leyes/Ley_de_Mineria.pdf',
  },
  {
    temas: [...LEY, 'canon', 'territorial', 'hectarea', 'cuanto se paga', 'impuesto', 'regalia', 'fob', 'municipal', 'coalianza'],
    texto: 'Cargas (arts. 56 y 76, declarados constitucionales en 2026): canon territorial anual por hectárea, metálica US$1.50 en exploración y US$3.50 en explotación, no metálica o gemas US$0.50 y US$2.00; en minería metálica, 6 % del valor FOB (2 % tasa de seguridad, 2 % impuesto municipal, 1 % COALIANZA, 1 % Autoridad Minera), más renta, ventas y activo neto.',
    fecha: '2026-06-27',
    fuente: 'Ley 238-2012 (TSC)',
    url: 'https://www.tsc.gob.hn/web/leyes/Ley_de_Mineria.pdf',
  },
  {
    temas: [...LEY, 'consulta', 'indigena', 'pueblos', 'oit'],
    texto: 'Consulta: la Ley de Consulta Libre, Previa e Informada (Convenio OIT 169) NO está aprobada; los proyectos siguen en el Congreso. El fallo de 2026 anuló parcialmente los arts. 67-68 (consulta ciudadana municipal) y pide legislar un mecanismo efectivo.',
    fecha: '2026-06-27',
    fuente: 'Criterio.hn',
    url: 'https://criterio.hn/fallo-sobre-ley-de-mineria-sustenta-reforma-pero-no-garantiza-corregir-sus-vicios-de-inconstitucionalidad',
  },
  {
    temas: ['cielo abierto', 'libre de mineria', 'moratoria', 'prohibicion', 'suspension de concesiones'],
    texto: '«Honduras libre de minería a cielo abierto» (28-feb-2022) fue un comunicado de la Secretaría de Ambiente, no un decreto ni una reforma de ley; su aplicación fue desigual y las minas a cielo abierto grandes siguen operando en 2026. No se encontró una moratoria formal de concesiones vigente en 2025-2026.',
    fecha: '2026-09-29',
    fuente: 'Mongabay / Cespad',
    url: 'https://cespad.org.hn/honduras-libre-de-mineria-a-cielo-abierto-y-ahora-que/',
  },
  {
    temas: ['eiti', 'transparencia'],
    texto: 'EITI: Honduras entró en 2013, fue suspendida en oct-2020 y el Consejo EITI la dio de baja el 13-mar-2025.',
    fecha: '2025-03-13',
    fuente: 'EITI',
    url: 'https://eiti.org/news/honduras-delisted-eiti-due-stalled-implementation',
  },

  // --- Otros actores
  {
    temas: ['fema', 'fiscalia', 'ministerio publico', 'delito ambiental', 'mineria ilegal'],
    texto: 'La FEMA (Fiscalía Especial del Medio Ambiente, Ministerio Público) participa en las mesas de reforma y en operativos contra minería ilegal. Su jefatura actual no está confirmada.',
    fecha: '2026-06-27',
    fuente: 'MP / Criterio.hn',
    url: 'https://www.mp.hn/publicaciones/area/fema-fiscalia-del-medio-ambiente/',
    confirmado: false,
  },
  {
    temas: ['municipalidad', 'municipio', 'alcaldia', 'permiso de operacion', 'arbitrios'],
    texto: 'Municipalidades en minería: reciben el 2 % municipal (art. 76); piden las áreas de minería artesanal (art. 44); dan el permiso de operación según la Ley de Municipalidades y su Plan de Arbitrios; algunas emiten licencias ambientales de categorías 1 a 3; usan la plataforma SIGEM de INHGEOMIN.',
    fecha: '2026-07-16',
    fuente: 'Ley 238-2012 / Hondudiario',
    url: 'https://www.hondudiario.com/2026/07/16/serna-acelera-licencias-y-reduce-mora-pero-descarta-tramite-para-muelle-de-cruceros-en-omoa/',
  },
  {
    temas: ['minosa', 'san andres', 'azacualpa', 'aura minerals', 'copan'],
    texto: 'Minosa (Aura Minerals, mina San Andrés, Copán): 31 683 onzas equivalentes de oro en el 1S-2026 (11 % menos que en el 1S-2025). Una concesión de 390 ha venció en 2023: pidió prórroga por 30 años e INHGEOMIN no ha resuelto; hay acción de nulidad (MADJ) y conflicto con el Consejo Indígena Maya-Chortí de Azacualpa.',
    fecha: '2026-07-10',
    fuente: 'GlobeNewswire / Contracorriente',
    url: 'https://contracorriente.red/2026/06/05/azacualpa-consejo-indigena-maya-chorti-minosa-concesion-vencida/',
  },
];

const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const conPalabra = (t: string, p: string) => new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(t);

const PUESTOS = ['director', 'subdirector', 'ministro', 'ministro director', 'subsecretario', 'viceministro', 'presidente', 'procurador', 'secretario de energia', 'desarrollo economico'];

/** Los hechos que toca la pregunta, del más pertinente al menos. */
export function hechosDeLaPregunta(mensaje: string, max = 4): Hecho[] {
  const t = fold(mensaje);
  const esCargo = CARGO.some((c) => conPalabra(t, c));
  const puntos = HECHOS.map((h, i) => {
    let p = 0;
    for (const tema of h.temas) if (conPalabra(t, tema)) p += tema.includes(' ') ? 2 : 1;
    // «¿quién es el director…?»: el hecho que nombra a alguien pesa más que el que describe funciones.
    if (p && esCargo && h.temas.some((x) => PUESTOS.includes(x))) p += 2;
    return { h, p, i };
  })
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i);
  return puntos.slice(0, max).map((x) => x.h);
}

const fechaLarga = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d} de ${MESES[m - 1]} de ${a}`;
};

/** El bloque que va pegado a la pregunta (null si no toca instituciones ni la ley). */
export function bloqueInstituciones(mensaje: string): string | null {
  const hs = hechosDeLaPregunta(mensaje);
  if (!hs.length) return null;
  return [
    `HECHOS VIGENTES (revisados el ${fechaLarga(VERIFICADO)}; cada uno con su fecha y su fuente — decilos así, con la fuente y la fecha, y aclará que un cargo puede haber cambiado después; lo marcado SIN CONFIRMAR se dice como tal):`,
    ...hs.map((h) => `· ${h.texto} [${h.confirmado === false ? 'SIN CONFIRMAR · ' : ''}dato del ${fechaLarga(h.fecha)} · ${h.fuente} · ${h.url}]`),
  ].join('\n');
}
