# Reporte de correcciones — panel de capas, simbología, proyectos y Doctor Electrum

Base: `indice_capas_gis_kml.md` v1.4 · Instrucciones: `instrucciones_correcciones_panel_electrum.md` v1.0 · Manifiesto resultante: **v1.5** (`biblioteca/mapas/manifest.json`).
Se trabajó sobre copias: no se borró ni modificó ningún archivo original. Los IDs ya publicados no cambiaron; los 24 que se movieron quedaron retirados.

## 1. Clasificaciones que faltaban en el panel y cómo se corrigieron

Se comparó el árbol del panel contra el índice v1.4, entrada por entrada (bloques 0, 1, 2, 3, 4 y 8, todas las categorías `…000` y sus subcapas). Resultado:

- **Ninguna entrada del índice faltaba en el manifiesto publicado.** El panel en producción ya mostraba los 46 nodos del documento desde el despliegue del 10 de octubre; la revisión del 9 de octubre se hizo con la versión anterior (lista de categorías escrita a mano), que no tenía el índice.
- Lo que sí se corrigió en el panel:
  - Las entradas sin archivo se marcan `sin_datos` en el manifiesto y el panel las muestra en gris con la etiqueta **«Sin datos»** (antes decía «no disponible»). Hoy ninguna entrada oficial está sin datos; «no disponible» queda solo para lo que una organización no puede ver.
  - El panel ya no tiene **ninguna lista escrita a mano**: los nombres con que se piden las capas salen de `alias` y los colores de `estilo` del manifiesto (se borró la tabla `ALIAS` del frontal; la prueba falla si vuelve).
  - Los 4 proyectos Indexa muestran sus **subcarpetas** (KML, Shape, Datos de campo, Imágenes, Planos) a partir del campo `subgrupo`.
  - Tres entradas que el documento no traía (`107008` Zonas Indexa, `110003` Fichas de ocurrencia minera, `110004` Yacimientos y ocurrencias mineras) quedan marcadas `fuera_de_indice` con su explicación en `notas`.
- Verificado: División política con sus 5 subcapas en orden; Concesiones Indexa con las 7 (Buenavista, Chaparro, La Campana, Escalera, Pantaleona, El Tajo, Targets); Recursos mineros con Depósitos y Fichas seleccionadas; las 10 capas de geología con Suelos Simmons `210000`; los 4 proyectos con sus subcarpetas; Otros `800000`.
- Prueba automática: `tests/electrum-arbol-indice.test.ts` compara el árbol del panel contra `tests/fixtures/indice-v1.4.json` y falla si falta, sobra o cambia de orden algo.

## 2. Fuente del estilo de cada capa

Resumen: **42** con el estilo del KML/KMZ original, **212** con la paleta estándar (por mineral, por unidad/tipo o de un color), **45** imágenes (rásteres, con sus colores propios). Archivos de estilo junto al Shape: solo hay dos `.lyr` de ArcMap (Minas de Oro), binarios y no legibles; su mapa existe también en KMZ y se usaron los colores del KMZ. Campos de color: el de Suelos Simmons (`color`) describe el color del suelo, no la simbología, y `COLOR_H2O` es el color del agua; no se usaron como color de mapa.

Cómo se pinta: el servidor calcula el color de **cada rasgo** con la misma regla de la leyenda y lo manda en el rasgo (`_c` relleno, `_b` borde, `_o` opacidad del KML); el mapa MapLibre y el de Google lo leen igual.

| ID | Capa | Fuente del estilo |
|---|---|---|
| 101001 | Áreas protegidas | paleta estándar por tipo (campo «categoria»; el SHP no trae archivo de estilo ni campo de color) |
| 102001 | Buffer de carreteras primarias | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 103001 | Curvas de nivel cada 20 m | paleta estándar (teselas vectoriales, un solo tipo de rasgo) |
| 104001 | Derechos mineros (catastro INHGEOMIN, junio 2026) | paleta estándar por estado del trámite (la tabla del catastro no trae mineral: 1076 de 1076 vacíos) |
| 105001 | Departamentos | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 105002 | Municipios | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 105003 | Caseríos | paleta estándar (teselas vectoriales, un solo tipo de rasgo) |
| 105004 | Aldeas | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 105005 | Red hídrica | paleta estándar (teselas vectoriales, un solo tipo de rasgo) |
| 106001 | Hoja 1603 | imagen original (ráster) |
| 106002 | Hoja 1604 | imagen original (ráster) |
| 106003 | Hoja 1605 | imagen original (ráster) |
| 106004 | Hoja 1606 | imagen original (ráster) |
| 106005 | Hoja 1607 | imagen original (ráster) |
| 106006 | Hoja 1608 | imagen original (ráster) |
| 106007 | Hoja 1610 | imagen original (ráster) |
| 106008 | Hoja 1611 | imagen original (ráster) |
| 106009 | Hoja 1612 | imagen original (ráster) |
| 106010 | Hoja 1613 | imagen original (ráster) |
| 106011 | Hoja 1614 | imagen original (ráster) |
| 106012 | Hoja 1615 | imagen original (ráster) |
| 106013 | Hoja 1616 | imagen original (ráster) |
| 106014 | Hoja 1617 | imagen original (ráster) |
| 106015 | Hoja 1618 | imagen original (ráster) |
| 106016 | Hoja 1619 | imagen original (ráster) |
| 106017 | Hoja 1620 | imagen original (ráster) |
| 106018 | Hoja 1621 | imagen original (ráster) |
| 106019 | Hoja 1622 | imagen original (ráster) |
| 106020 | Hoja 1623 | imagen original (ráster) |
| 106021 | Hoja 1624 | imagen original (ráster) |
| 106022 | Hoja 1626 | imagen original (ráster) |
| 106023 | Hoja 1627 | imagen original (ráster) |
| 106024 | Hoja 1628 | imagen original (ráster) |
| 106025 | Hoja 1629 | imagen original (ráster) |
| 106026 | Hoja 1630 | imagen original (ráster) |
| 106027 | Hoja 1632 | imagen original (ráster) |
| 106028 | Hoja 1634 | imagen original (ráster) |
| 106029 | Hoja 1635 | imagen original (ráster) |
| 106030 | Hoja 1643 | imagen original (ráster) |
| 106031 | Hoja 1644 | imagen original (ráster) |
| 106032 | Hoja 1645 | imagen original (ráster) |
| 106033 | Hoja 1652 | imagen original (ráster) |
| 106034 | Hoja 1660 | imagen original (ráster) |
| 106035 | Hoja 1661e | imagen original (ráster) |
| 106036 | Hoja 1661w | imagen original (ráster) |
| 106037 | Hoja 1662 | imagen original (ráster) |
| 107001 | Buenavista | KML/KMZ: estilo de cada Placemark (40 colores) |
| 107002 | Chaparro | KML/KMZ: estilo de cada Placemark (5 colores) |
| 107003 | La Campana | KML/KMZ: estilo de cada Placemark (1 color) |
| 107004 | Escalera | KML/KMZ: estilo de cada Placemark (4 colores) |
| 107005 | Pantaleona | KML/KMZ: estilo de cada Placemark (26 colores) |
| 107006 | El Tajo | KML/KMZ: estilo de cada Placemark (2 colores) |
| 107007 | Targets (blancos) | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 107008 | Zonas Indexa | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 108001 | Microcuencas declaradas (WGS 84) | paleta estándar por tipo (campo «estado»; el SHP no trae archivo de estilo ni campo de color) |
| 109001 | Patrimonio público forestal | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 110001 | Depósitos minerales | paleta estándar por mineral (2.2): el mineral sale del archivo de cada ficha (ORO.shp, PLATA.shp…); los SHP no traen color propio (SymbolID 0) |
| 110002 | Fichas seleccionadas (ocurrencia minera) | paleta estándar por mineral (2.2): el mineral sale del archivo de cada ficha (ORO.shp, PLATA.shp…); los SHP no traen color propio (SymbolID 0) |
| 110003 | Fichas de ocurrencia minera | paleta estándar por mineral. El KML original pinta las 166 fichas con un mismo ícono amarillo y no trae mineral: el mineral se tomó de la ficha seleccionada con el mismo número FOM (97 de 166); las otras 69 quedan «Sin dato». Conflicto anotado: se prefirió el color por mineral que pide la sección 2.2. |
| 110004 | Yacimientos y ocurrencias mineras | paleta estándar por mineral (campo «Mineral») |
| 111001 | Zonas informales | paleta estándar por tipo (campo «Zona»; el SHP no trae archivo de estilo ni campo de color) |
| 201001 | Estructural 2 | KML/KMZ: estilo de cada Placemark (1 color) |
| 202001 | Estructural | KML/KMZ: estilo de cada Placemark (6 colores) |
| 203001 | Fallas geológicas (centroamericanas) | KML/KMZ: estilo de cada Placemark (1 color) |
| 204001 | Geológico de Olancho 1:100,000 | KML/KMZ: estilo de cada Placemark (11 colores) |
| 205001 | Geológicos | KML/KMZ: estilo de cada Placemark (6 colores) |
| 206001 | Mapa estructural 1:50,000 | paleta estándar (teselas vectoriales, un solo tipo de rasgo) |
| 207001 | Mapa geotectónico | KML/KMZ: estilo de cada Placemark (12 colores) |
| 208001 | Mapa metalogenético | KML/KMZ: estilo de cada Placemark (23 colores) |
| 209001 | Mapa geológico 1:500,000 | KML/KMZ: estilo de cada Placemark (40 colores) |
| 210001 | Suelos Simmons | paleta estándar por unidad (campo «nombre_sue»; el SHP no trae archivo de estilo ni campo de color) El campo «color» de la tabla describe el color del suelo (40 % vacío), no la simbología: no se usó como color de mapa. |
| 301001 | PAN_ProyAsociados_190320 | KML/KMZ: estilo de cada Placemark (1 color) |
| 301002 | Terreno para planta_La Pantaleona_20211013_EE | KML/KMZ: estilo de cada Placemark (2 colores) |
| 301013 | Pantaleona | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 301014 | Terreno Planta El Teniente | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 302001 | visita 21-11-15 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 302002 | TERRENO TOTAL PALMILLA | KML/KMZ: estilo de cada Placemark (1 color) |
| 302004 | Buena Vista-Monarka | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 302005 | MONARKA I | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 302006 | MONARKA II | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 303001 | POLIGONOS CHIQUIN | KML/KMZ: estilo de cada Placemark (1 color) |
| 303002 | PROYECTO EL CHAPARRO | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 303003 | Afloramientos_Chaparro | KML/KMZ: estilo de cada Placemark (1 color) |
| 303004 | Vetas_CHAPARRO | KML/KMZ: estilo de cada Placemark (1 color) |
| 303005 | IND_ESC_Veins_030221 | KML/KMZ: estilo de cada Placemark (1 color) |
| 303006 | LaCampana | KML/KMZ: estilo de cada Placemark (1 color) |
| 303007 | Traza de vetas | KML/KMZ: estilo de cada Placemark (1 color) |
| 303008 | 1087 PIEDRA DORADA | KML/KMZ: estilo de cada Placemark (1 color) |
| 303009 | Baldoquin | KML/KMZ: estilo de cada Placemark (1 color) |
| 303010 | PROYECTO EL GUAYABAL2 | KML/KMZ: estilo de cada Placemark (1 color) |
| 303011 | TERRENO EL GUAYABAL | KML/KMZ: estilo de cada Placemark (1 color) |
| 303012 | TERRENO LA ESCALERA | KML/KMZ: estilo de cada Placemark (1 color) |
| 303013 | TERRENO PLANTA INFINITO | KML/KMZ: estilo de cada Placemark (1 color) |
| 303014 | La Moloncosa | KML/KMZ: estilo de cada Placemark (1 color) |
| 303015 | Vetas inferidas | KML/KMZ: estilo de cada Placemark (1 color) |
| 303018 | Campana | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 303019 | Chaparro | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 303020 | Cimarron | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 303021 | Escalera y Piedra Dorada | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 303022 | Estructuras medidas en campo El Chaparro (rumbo y buzamiento, mar-2020) | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 303023 | Videos de campo con GPS — El Chaparro (feb-2020) | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304001 | Estructural Minas de Oro | KML/KMZ: estilo de cada Placemark (15 colores) |
| 304002 | Geologia Minas de Oro | KML/KMZ: estilo de cada Placemark (17 colores) |
| 304003 | Geologia | KML: colores por unidad tomados de 304002 Geologia Minas de Oro, el KMZ del mismo mapa (el .lyr de ArcMap que acompaña al SHP es binario y no se puede leer) |
| 304004 | Punto de referencia | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304005 | Prop_Angel_David_Bonilla_2 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304006 | Prop_Angel_David_Bonilla_3 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304007 | Prop_Antonio_Aguilar_1 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304008 | Prop_Antonio_Aguilar_2 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304009 | Prop_Antonio_Aguilar_3 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304010 | Prop_Dixi_Donaire_2 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304011 | Prop_Dixi_Donaire_3 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304012 | Prop_Edgardo_Castro_Curry | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304013 | Prop_Exequiel_Caceres_2 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304014 | Prop_Francisco_Alcides_Ramirez | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304015 | Prop_Gumercinda_Licona | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304016 | Prop_Heriberto_Soler | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304017 | Prop_Isidoro_Canales | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304018 | Prop_Jely_Donaire | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304019 | Prop_Jeremias_Guerrero | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304020 | Prop_Jeronimo_Mejia_Lobo | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304021 | Prop_Jorge_Zuniga_Cruz | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304022 | Prop_Juan_FRancisco_Zuniga | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304023 | Prop_Luis_Aroldo_Zelaya_2 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304024 | Prop_Manuel_Antonio_Escoto_Soto | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304025 | Prop_Marco_Rodriguez | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304026 | Prop_Marcos_Rodriguez_2 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304027 | Prop_Miguel_Amador_1 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304028 | Prop_Miguel_Angel_Amador_Caceres_2 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304029 | Prop_Reiniero_Zepeda | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304030 | Prop_Ricardo_Pineda | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304031 | Prop_Urbano_Marques_1 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304032 | Prop_dixi_donaire_1 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304033 | Prop_exequiel_Caceres_1 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304034 | Propo_Dixi_Donaire_2 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304035 | pro_amarilis_pineda | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304036 | prop_Enrique_Fonsec | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304037 | prop_Joaquin_Calix_Garcia | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304038 | prop_Jorge_midence | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304039 | prop_Lester_Yuja | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304040 | prop_Ramon_Maradiaga_Canales | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304041 | prop_Ubaldo_Sauceda | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304042 | prop_adela_Carranza_2 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304043 | prop_adela_carranza | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304044 | prop_david_bonilla | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304045 | prop_luis_aroldo | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304046 | Calicatas | paleta estándar por tipo (campo «Prioridad»; el SHP no trae archivo de estilo ni campo de color) |
| 304047 | Camino | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304048 | catastro | paleta estándar por mineral (campo «MINERAL») |
| 304049 | lithology | paleta estándar por tipo (campo «lithology»; el SHP no trae archivo de estilo ni campo de color) |
| 304050 | mc al 30 junio 2012 | paleta estándar por tipo (campo «TIPO»; el SHP no trae archivo de estilo ni campo de color) |
| 304051 | v_concesion_minera | paleta estándar por tipo (campo «estado»; el SHP no trae archivo de estilo ni campo de color) |
| 304052 | Hoja 1620c (Minas de Oro) | imagen original (ráster) |
| 304055 | Camino | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304056 | Estructural Minas de Oro | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 304057 | lithology | paleta estándar por tipo (campo «lithology»; el SHP no trae archivo de estilo ni campo de color) |
| 304058 | MINAS DE ORO I | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304059 | MINAS DE ORO II | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304060 | MINAS DE ORO III | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304061 | MINAS DE ORO IV | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304062 | MINAS DE ORO V | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304063 | MONTECIELO 5 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304064 | MONTECIELO 6 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304065 | MONTECIELO I | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304066 | MONTECIELO II | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 304067 | Punto las hermosas | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 401001 | Mapa geológico de Olancho (JICA) | imagen original (ráster) |
| 401002 | Mapa estructural de Olancho (JICA) | imagen original (ráster) |
| 401003 | Anomalías geoquímicas de Cu en Olancho (JICA) | imagen original (ráster) |
| 401004 | Anomalías geoquímicas de Zn en Olancho (JICA) | imagen original (ráster) |
| 401005 | Muestras geoquímicas JICA (Fases I–III) | paleta estándar graduada por ley del elemento elegido |
| 401006 | Perfiles A-B-C | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 401007 | zona de estudio 3 fases jica | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 401008 | zona potencial olancho | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 401009 | zonas de JICA | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800001 | 20161011_La_Lola_NAD27 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800002 | 20161011_La_Lola_NAD27 | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800003 | Aluviales Olancho | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800004 | Antimonio_usgs | paleta estándar por mineral (campo «Deposito») |
| 800005 | area de estudio(geologico olancho 1;100,000) | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800006 | AREA DE GEOLOGIA OLANCHO | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800007 | au anomalias | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800011 | Cerro Rico | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800014 | Cortinas | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800015 | Depósitos | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800016 | Depósitos minerales | paleta estándar por mineral (campo «Deposito») |
| 800017 | El Blanco | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800019 | Estructural | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800020 | Estructural | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800021 | Estructural Agalteca | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800022 | Estructural Comayagua | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800023 | Estructural Danlí | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800024 | Estructural El Rosario | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800025 | Estructural Guaimaca | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800026 | Estructural Jamastrán | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800027 | Estructural La Unión | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800028 | Estructural Lepaterique | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800029 | ESTRUCTURAL LOLA | KML/KMZ: estilo de cada Placemark (2 colores) |
| 800031 | Estructural Morocelí | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800032 | Estructural Nueva Armenia | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800033 | Estructural Ojojona | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800034 | ESTRUCTURAL OLANCHO | paleta estándar por tipo (campo «TIPO»; el SHP no trae archivo de estilo ni campo de color) |
| 800035 | ESTRUCTURAL OLANCHO | paleta estándar por tipo (campo «TIPO»; el SHP no trae archivo de estilo ni campo de color) |
| 800036 | Estructural Orica Guayape | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800037 | Estructural Salamá | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800038 | Estructural San Buenaventura | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800039 | Estructural San Juan de Flores | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800040 | Estructural San Pedro Zacapa | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800041 | Estructural Santa Bárbara | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800042 | Estructural Santa Cruz de Yojoa | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800043 | Estructural Santa María del Real | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800044 | Estructural Siguatepeque | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800045 | Estructural Talanga | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800046 | Estructural Taulabé | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800047 | Estructural Tegucigalpa | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800048 | Estructural Yuscarán | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800049 | Estructural Zambrano | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800051 | Fallas activas GEM Centroamérica | paleta estándar por tipo (campo «TIPO»; el SHP no trae archivo de estilo ni campo de color) |
| 800052 | Fallas geológicas USGS Caribe 1:2.5M | paleta estándar por tipo (campo «TIPO»; el SHP no trae archivo de estilo ni campo de color) |
| 800053 | GEOLOGIA REGIONAL LA LOLA | paleta estándar por unidad (campo «UNIT»; el SHP no trae archivo de estilo ni campo de color) |
| 800054 | GEOLOGIA REGIONAL LOLA | KML/KMZ: estilo de cada Placemark (12 colores) |
| 800055 | Geología superficial USGS Caribe 1:2.5M | paleta estándar por unidad (campo «UNIDAD»; el SHP no trae archivo de estilo ni campo de color) |
| 800056 | Geológico | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800057 | Geológico | paleta estándar por tipo (campo «Formaci�n»; el SHP no trae archivo de estilo ni campo de color) |
| 800058 | Geológico Agalteca | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800059 | Geológico Comayagua | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800060 | Geológico El Rosario | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800061 | Geológico Guaimaca | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800062 | Geológico Jamastrán | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800063 | Geológico La Unión | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800064 | Geológico Lepaterique | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800065 | Geológico Morocelí | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800066 | Geologico_Nacional | paleta estándar por unidad (campo «UNIT»; el SHP no trae archivo de estilo ni campo de color) |
| 800067 | Geológico Nueva Armenia | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800068 | Geológico Ojojona | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800069 | Geológico Salamá | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800070 | Geológico San Buenaventura | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800071 | Geológico San Juan de Flores | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800072 | Geológico San Pedro Zacapa | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800073 | Geológico Santa Bárbara | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800074 | Geológico Santa Cruz de Yojoa | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800075 | Geológico Santa María del Real | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800076 | Geológico Siguatepeque | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800077 | Geológico Talanga | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800078 | Geológico Taulabé | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800079 | Geológico Tegucigalpa | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800080 | Geológico Yuscarán | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800081 | Geológico Zambrano | paleta estándar por unidad (campo «Unidad»; el SHP no trae archivo de estilo ni campo de color) |
| 800082 | Geoquímica | paleta estándar por tipo (campo «Categor�a»; el SHP no trae archivo de estilo ni campo de color) |
| 800083 | La Cortina I | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800084 | La Cortina II | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800085 | La Cortina III | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800086 | La Cortina IV | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800087 | La Cortina V | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800088 | La Jefa | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800089 | LA LOLA | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800090 | LA LOLA | KML/KMZ: estilo de cada Placemark (1 color) |
| 800091 | LA LOLA | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800092 | LA LOLA | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800093 | LA LOLA | KML/KMZ: estilo de cada Placemark (1 color) |
| 800094 | La Pochota | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800095 | La Roca | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800096 | LA ROCA I | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800097 | LA ROKA II | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800098 | Límites de placas tectónicas PB2002 | paleta estándar por tipo (campo «TIPO»; el SHP no trae archivo de estilo ni campo de color) |
| 800100 | Mapa geológico Danlí | paleta estándar por unidad (campo «Unit»; el SHP no trae archivo de estilo ni campo de color) |
| 800101 | MAPA GEOLOGICO OLANCHO | paleta estándar por unidad (campo «UNIT»; el SHP no trae archivo de estilo ni campo de color) |
| 800102 | Marimbero | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800108 | Mineralizacion | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800109 | Mineralizacion | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800110 | Mineralizacion | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800111 | MINERALIZACION LOLA | KML/KMZ: estilo de cada Placemark (2 colores) |
| 800112 | MINERALIZACION LOLA | KML/KMZ: estilo de cada Placemark (2 colores) |
| 800119 | Ocurrencias Minerales | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800121 | Perfiles A-B-C | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800122 | POLIGONO LA LOLA | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800123 | POLOGONO LA LOLA | KML/KMZ: estilo de cada Placemark (1 color) |
| 800124 | Provincias geológicas USGS Caribe | paleta estándar por tipo (campo «NOMBRE»; el SHP no trae archivo de estilo ni campo de color) |
| 800125 | Punto de referencia | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800127 | puntos de visita 10-10-16 hugo | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800128 | PUNTOS VISITA LOLA | KML/KMZ: estilo de cada Placemark (1 color) |
| 800129 | REFERENCIA | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800130 | Ríos | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800131 | Rumbos y echados | paleta estándar por tipo (campo «Tipo»; el SHP no trae archivo de estilo ni campo de color) |
| 800132 | San Judas | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800133 | Sectores de Estudio | paleta estándar por tipo (campo «Fase»; el SHP no trae archivo de estilo ni campo de color) |
| 800134 | Tajo | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800136 | Tractos permisivos pórfido de cobre USGS | paleta estándar por tipo (campo «TRACTO»; el SHP no trae archivo de estilo ni campo de color) |
| 800137 | Travesia | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800138 | Tule | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800140 | Yacimientos MRDS USGS | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800141 | Yacimientos y ocurrencias mineras DEFOMIN | paleta estándar por mineral (campo «Mineral») |
| 800142 | Yacimientos y prospectos pórfido de cobre USGS | paleta estándar por mineral (campo «MINERAL») |
| 800143 | Zona Beta | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800144 | zona potencial olancho | paleta estándar, un solo color (la tabla no tiene un campo de categorías) |
| 800145 | Alteración por arcillas (SWIR B11/B12) | imagen original (ráster) |
| 800146 | Óxidos de hierro (B04/B02) | imagen original (ráster) |
| 800147 | Caída de vegetación 2025 → 2026 | imagen original (ráster) |

**Conflictos entre fuentes** (gana el estilo original del archivo):
- `304003`: SHP «Geologia» y KMZ «Geologia Minas de Oro» son el mismo mapa: se usaron los colores del KMZ, que es el estilo original.

**Íconos que el KML nombra pero no venían en el archivo** (se les dio un color de la paleta, distinto para cada ícono):
- `107001` Buenavista: 16 íconos.
- `107005` Pantaleona: 20 íconos.
- `303003` Afloramientos_Chaparro: 1 íconos.

## 3. Minerales encontrados y color asignado

Tabla 2.2 de las instrucciones; los no metálicos usan el marrón claro `#C2A878` y tonos de la misma familia para que cada mineral quede distinto; los que no están en la tabla tienen un color propio que no usa ningún otro. Con varios minerales («Oro/Plata»), manda el primero; los demás se ven en la ventana de atributos (campo `minerales`).

| Mineral | Color | Dónde aparece (capa: valor del dato) |
|---|---|---|
| Antimonio | `#8E44AD` | 110001: Antimonio; 110002: Antimonio; 110003: Antimonio; 110004: Antimonio; 800004: Antimonio; 800016: Antimonio; 800141: Antimonio |
| Bario | `#9E8A68` | 110004: Bario; 800141: Bario |
| Barita | `#B8A383` | 110002: Barita; 110003: Barita |
| Bentonita | `#A88E62` | 110002: Bentonita; 110003: Bentonita; 110004: bentonita; 800141: bentonita |
| Caliza | `#C2A878` | 110002: Caliza; 110003: Caliza |
| Cobre | `#B87333` | 110001: Cobre; 110002: Cobre; 110003: Cobre; 110004: Cobre; 800016: Cobre; 800141: Cobre; 800142: cobre, oro; 800142: cobre, plata, oro; 800142: cobre, zinc, plata |
| Hierro | `#8B2E16` | 110001: Hierro; 110002: Hierro; 110003: Hierro; 110004: Hierro; 800016: Hierro; 800141: Hierro |
| Manganeso | `#4B0082` | 110001: Manganeso; 110002: Manganeso; 110003: Manganeso; 800016: Manganeso |
| Mercurio | `#DC143C` | 110001: Mercurio; 110004: Mercurio; 800016: Mercurio; 800141: Mercurio |
| Oro | `#FFD700` | 110001: Oro; 110002: Oro; 110003: Oro; 110004: Oro; 110004: Oro/Plata; 110004: Oro/Plata/Cobre/Plomo; 110004: Oro/Plata/Plomo/Zinc/Cobre/Ars?nico/Antimonio; 304048: ORO; 800016: Oro y Plata; 800141: Oro; 800141: Oro/Plata; 800141: Oro/Plata/Cobre/Plomo; 800141: Oro/Plata/Plomo/Zinc/Cobre/Ars�nico/Antimonio; 800142: oro, cobre |
| Plata | `#C0C0C0` | 110002: Plata; 110003: Plata; 110004: Plata; 110004: Plata/Cobre; 110004: Plata/plomo /cobre; 110004: Plata/plomo /zinc; 800141: Plata; 800141: Plata/Cobre; 800141: Plata/plomo /cobre; 800141: Plata/plomo /zinc |
| Plomo | `#5B6770` | 110004: Plomo/Bario; 110004: Plomo/zinc /cobre; 800141: Plomo/Bario; 800141: Plomo/zinc /cobre |
| Polimetalico | `#FF8C00` | 110002: Polimetalicos; 110003: Polimetalicos; 110004: Polimetalico; 800141: Polimetalico |
| Sin dato | `#999999` | 110003: Sin dato; 110004: No Definido; 800141: No Definido |
| Uranio | `#9ACD32` | 110002: Uranio; 110003: Uranio |
| Yeso | `#D9C9A0` | 110002: Yeso; 110003: Yeso |

Las 166 fichas de `110003` no traían mineral en el archivo: se tomó el de la ficha seleccionada con el mismo número FOM (97 de 166); las 69 restantes quedan «Sin dato» en gris. Las fichas seleccionadas (`110002`) guardan además, en `minerales`, todos los elementos que nombra cada ficha (por ejemplo «Oro, Plata»).

Derechos mineros (`104001`): la tabla del catastro no trae mineral (1076 de 1076 vacíos), así que se colorean por estado del trámite (otorgada, en trámite, delimitada, suspendida).

## 4. Reclasificación de proyectos

| Archivo (ruta original) | ID anterior | ID nuevo | Proyecto | Por qué |
|---|---|---|---|---|
| Pantaleona (Catastro minero/Proyectos y concesiones) | 800120 | 301013 | Pantaleona | nombre «Pantaleona» |
| Terreno Planta El Teniente (Catastro minero/Proyectos y concesiones) | 800135 | 301014 | Pantaleona | nombre «El Teniente» (Pantaleona/AMBIENTAL/EL TENIENTE) |
| Buena Vista-Monarka (Catastro minero/Proyectos y concesiones) | 800008 | 302004 | Buenavista Monarca | nombre «Buena Vista-Monarka» |
| MONARKA I (Catastro minero/Proyectos y concesiones) | 800113 | 302005 | Buenavista Monarca | nombre «Monarka» |
| MONARKA II (Catastro minero/Proyectos y concesiones) | 800114 | 302006 | Buenavista Monarca | nombre «Monarka» |
| Campana (Catastro minero/Proyectos y concesiones) | 800010 | 303018 | Cimarrón | nombre «Campana» (concesión de Cimarrón, junto a 107003) |
| Chaparro (Catastro minero/Proyectos y concesiones) | 800012 | 303019 | Cimarrón | nombre «Chaparro» |
| Cimarron (Catastro minero/Proyectos y concesiones) | 800013 | 303020 | Cimarrón | nombre «Cimarron» |
| Escalera y Piedra Dorada (Catastro minero/Proyectos y concesiones) | 800018 | 303021 | Cimarrón | nombre «Escalera y Piedra Dorada» (Cimarrón, junto a 107004) |
| Estructuras medidas en campo El Chaparro (rumbo y buzamiento, mar-2020) (INFORMACION ELECTRUM/5) | 800050 | 303022 | Cimarrón | carpeta 3 CIMARRON/2 EL CHAPARRO |
| Videos de campo con GPS — El Chaparro (feb-2020) ((sin carpeta)) | 800139 | 303023 | Cimarrón | nombre «El Chaparro» (videos de campo) |
| Camino (INDEXSA SEP 2026/MINAS DE ORO/shp_Minas de Oro) | 800009 | 304055 | Minas de Oro | carpeta MINAS DE ORO/shp_Minas de Oro |
| Estructural Minas de Oro (INDEXSA SEP 2026/MINAS DE ORO) | 800030 | 304056 | Minas de Oro | nombre «Minas de Oro» |
| lithology (INDEXSA SEP 2026/MINAS DE ORO/shp_Minas de Oro) | 800099 | 304057 | Minas de Oro | carpeta MINAS DE ORO/shp_Minas de Oro |
| MINAS DE ORO I (Catastro minero/Proyectos y concesiones) | 800103 | 304058 | Minas de Oro | nombre «Minas de Oro I» |
| MINAS DE ORO II (Catastro minero/Proyectos y concesiones) | 800104 | 304059 | Minas de Oro | nombre «Minas de Oro II» |
| MINAS DE ORO III (Catastro minero/Proyectos y concesiones) | 800105 | 304060 | Minas de Oro | nombre «Minas de Oro III» |
| MINAS DE ORO IV (Catastro minero/Proyectos y concesiones) | 800106 | 304061 | Minas de Oro | nombre «Minas de Oro IV» |
| MINAS DE ORO V (Catastro minero/Proyectos y concesiones) | 800107 | 304062 | Minas de Oro | nombre «Minas de Oro V» |
| MONTECIELO 5 (Catastro minero/Proyectos y concesiones) | 800115 | 304063 | Minas de Oro | Montecielo (carpeta MINAS DE ORO/11 Finca Montecielo) y ubicación junto a Minas de Oro I–V |
| MONTECIELO 6 (Catastro minero/Proyectos y concesiones) | 800116 | 304064 | Minas de Oro | Montecielo y ubicación junto a Minas de Oro I–V |
| MONTECIELO I (Catastro minero/Proyectos y concesiones) | 800117 | 304065 | Minas de Oro | Montecielo y ubicación junto a Minas de Oro I–V |
| MONTECIELO II (Catastro minero/Proyectos y concesiones) | 800118 | 304066 | Minas de Oro | Montecielo y ubicación junto a Minas de Oro I–V |
| Punto las hermosas (INDEXSA SEP 2026/INFORMACION TECNICA/Geologicas Municipios/Minas de Oro) | 800126 | 304067 | Minas de Oro | carpeta Geologicas Municipios/Minas de Oro; cae dentro de Montecielo |

Los IDs anteriores quedan retirados (no se reutilizan): están en `id_anterior` de cada capa y en la lista `retirados` del manifiesto; pedir una capa por su ID viejo lleva a la nueva. Las capas de concesiones del Bloque 1 (`107xxx`) se quedaron donde estaban. Dentro de cada proyecto, las capas se agrupan en KML, Shape, Datos de campo, Imágenes y Planos.

## 5. Archivos con proyecto dudoso (se dejaron en Otros)

| ID | Capa | Motivo |
|---|---|---|
| 800011 | Cerro Rico | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800014 | Cortinas | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800017 | El Blanco | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800083 | La Cortina I | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800084 | La Cortina II | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800085 | La Cortina III | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800086 | La Cortina IV | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800087 | La Cortina V | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800095 | La Roca | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800096 | LA ROCA I | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800097 | LA ROKA II | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800132 | San Judas | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800143 | Zona Beta | Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros. |
| 800134 | Tajo | Mismo polígono que 107006 El Tajo, que el índice marca como proyecto independiente (ni Pantaleona ni Cimarrón): se deja en Otros. |
| 800001 | 20161011_La_Lola_NAD27 | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800002 | 20161011_La_Lola_NAD27 | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800006 | AREA DE GEOLOGIA OLANCHO | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800007 | au anomalias | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800029 | ESTRUCTURAL LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800034 | ESTRUCTURAL OLANCHO | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800035 | ESTRUCTURAL OLANCHO | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800053 | GEOLOGIA REGIONAL LA LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800054 | GEOLOGIA REGIONAL LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800089 | LA LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800090 | LA LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800091 | LA LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800092 | LA LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800093 | LA LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800101 | MAPA GEOLOGICO OLANCHO | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800108 | Mineralizacion | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800109 | Mineralizacion | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800110 | Mineralizacion | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800111 | MINERALIZACION LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800112 | MINERALIZACION LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800121 | Perfiles A-B-C | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800122 | POLIGONO LA LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800123 | POLOGONO LA LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800127 | puntos de visita 10-10-16 hugo | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800128 | PUNTOS VISITA LOLA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800129 | REFERENCIA | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |
| 800144 | zona potencial olancho | Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros. |

## 6. Alias por capa

| ID | Capa | Alias |
|---|---|---|
| 000001 | Perímetro de Honduras | perímetro, contorno de honduras, frontera, Perímetro de Honduras |
| 100000 | 1 Información GIS | información gis, capas gis, bloque 1 |
| 101000 | Áreas protegidas | zonas protegidas, reservas, zonas de reserva, parques, parques nacionales, áreas protegidas |
| 101001 | Áreas protegidas | zonas protegidas, reservas, zonas de reserva, parques, parques nacionales, áreas protegidas |
| 102000 | Buffer de carreteras primarias | carreteras, carreteras primarias, vías, buffer de carreteras, franja de carreteras, Buffer de carreteras primarias |
| 102001 | Buffer de carreteras primarias | Buffer de carreteras primarias |
| 103000 | Curvas de nivel | curvas de nivel, curvas, topografía, relieve, altimetría |
| 103001 | Curvas de nivel cada 20 m | Curvas de nivel cada 20 m |
| 104000 | Derechos mineros de Honduras | concesiones mineras, derechos, títulos mineros, catastro, catastro minero, concesiones, derechos mineros, Derechos mineros de Honduras |
| 104001 | Derechos mineros (catastro INHGEOMIN, junio 2026) | Derechos mineros (catastro INHGEOMIN, junio 2026) |
| 105000 | División política de Honduras | mapa político, división política, límites, político, División política de Honduras |
| 105001 | Departamentos | departamentos, límites departamentales |
| 105002 | Municipios | municipios, límites municipales, alcaldías |
| 105003 | Caseríos | caseríos, poblados, comunidades, pueblos |
| 105004 | Aldeas | aldeas |
| 105005 | Red hídrica | ríos, red hídrica, quebradas, hidrografía, drenajes |
| 106000 | Hojas cartográficas | hojas cartográficas, hojas, cartas topográficas, mapas topográficos, hojas topográficas |
| 106001 | Hoja 1603 | Hoja 1603, hoja 1603 |
| 106002 | Hoja 1604 | Hoja 1604, hoja 1604 |
| 106003 | Hoja 1605 | Hoja 1605, hoja 1605 |
| 106004 | Hoja 1606 | Hoja 1606, hoja 1606 |
| 106005 | Hoja 1607 | Hoja 1607, hoja 1607 |
| 106006 | Hoja 1608 | Hoja 1608, hoja 1608 |
| 106007 | Hoja 1610 | Hoja 1610, hoja 1610 |
| 106008 | Hoja 1611 | Hoja 1611, hoja 1611 |
| 106009 | Hoja 1612 | Hoja 1612, hoja 1612 |
| 106010 | Hoja 1613 | Hoja 1613, hoja 1613 |
| 106011 | Hoja 1614 | Hoja 1614, hoja 1614 |
| 106012 | Hoja 1615 | Hoja 1615, hoja 1615 |
| 106013 | Hoja 1616 | Hoja 1616, hoja 1616 |
| 106014 | Hoja 1617 | Hoja 1617, hoja 1617 |
| 106015 | Hoja 1618 | Hoja 1618, hoja 1618 |
| 106016 | Hoja 1619 | Hoja 1619, hoja 1619 |
| 106017 | Hoja 1620 | Hoja 1620, hoja 1620 |
| 106018 | Hoja 1621 | Hoja 1621, hoja 1621 |
| 106019 | Hoja 1622 | Hoja 1622, hoja 1622 |
| 106020 | Hoja 1623 | Hoja 1623, hoja 1623 |
| 106021 | Hoja 1624 | Hoja 1624, hoja 1624 |
| 106022 | Hoja 1626 | Hoja 1626, hoja 1626 |
| 106023 | Hoja 1627 | Hoja 1627, hoja 1627 |
| 106024 | Hoja 1628 | Hoja 1628, hoja 1628 |
| 106025 | Hoja 1629 | Hoja 1629, hoja 1629 |
| 106026 | Hoja 1630 | Hoja 1630, hoja 1630 |
| 106027 | Hoja 1632 | Hoja 1632, hoja 1632 |
| 106028 | Hoja 1634 | Hoja 1634, hoja 1634 |
| 106029 | Hoja 1635 | Hoja 1635, hoja 1635 |
| 106030 | Hoja 1643 | Hoja 1643, hoja 1643 |
| 106031 | Hoja 1644 | Hoja 1644, hoja 1644 |
| 106032 | Hoja 1645 | Hoja 1645, hoja 1645 |
| 106033 | Hoja 1652 | Hoja 1652, hoja 1652 |
| 106034 | Hoja 1660 | Hoja 1660, hoja 1660 |
| 106035 | Hoja 1661e | Hoja 1661e, hoja 1661e |
| 106036 | Hoja 1661w | Hoja 1661w, hoja 1661w |
| 106037 | Hoja 1662 | Hoja 1662, hoja 1662 |
| 107000 | Información de concesiones Indexa | concesiones indexa, concesiones de indexa, indexa, nuestras concesiones, Información de concesiones Indexa |
| 107001 | Buenavista | concesiones indexa, concesiones de indexa, indexa, nuestras concesiones |
| 107002 | Chaparro | Chaparro |
| 107003 | La Campana | La Campana |
| 107004 | Escalera | Escalera |
| 107005 | Pantaleona | concesiones indexa, concesiones de indexa, indexa, nuestras concesiones |
| 107006 | El Tajo | El Tajo |
| 107007 | Targets (blancos) | targets, blancos, objetivos, Targets (blancos) |
| 107008 | Zonas Indexa | zonas indexa, zonas de indexa |
| 108000 | Microcuencas declaradas (WGS 84) | microcuencas, zonas de recarga, cuencas, microcuencas declaradas, Microcuencas declaradas (WGS 84) |
| 108001 | Microcuencas declaradas (WGS 84) | Microcuencas declaradas (WGS 84) |
| 109000 | Patrimonio público forestal | reservas forestales, patrimonio forestal, bosque nacional, zonas de reserva, bosques, forestal, Patrimonio público forestal |
| 109001 | Patrimonio público forestal | Patrimonio público forestal |
| 110000 | Recursos mineros de Honduras (WGS 84) | recursos mineros, recursos, minerales, Recursos mineros de Honduras, Recursos mineros de Honduras (WGS 84) |
| 110001 | Depósitos minerales | depósitos, yacimientos, depósitos minerales |
| 110002 | Fichas seleccionadas (ocurrencia minera) | fichas de ocurrencia, fichas de ocurrencia minera, ocurrencias, fichas, fichas seleccionadas, Fichas seleccionadas (ocurrencia minera) |
| 110003 | Fichas de ocurrencia minera | todas las fichas de ocurrencia, fichas completas, inventario de fichas |
| 110004 | Yacimientos y ocurrencias mineras | yacimientos y ocurrencias, ocurrencias defomin, yacimientos defomin, Yacimientos y ocurrencias mineras |
| 111000 | Zonas informales | zonas informales, minería informal, minería artesanal, informales, güirises |
| 111001 | Zonas informales | zonas informales, minería informal, minería artesanal, informales, güirises |
| 200000 | 2 Información geológica | geología, información geológica, mapas geológicos |
| 201000 | Estructural 2 | estructural 2 |
| 201001 | Estructural 2 | estructural 2 |
| 202000 | Estructural | estructural, estructuras |
| 202001 | Estructural | estructural, estructuras |
| 203000 | Fallas geológicas (centroamericanas) | fallas, fallas geológicas, fallas centroamericanas, Fallas geológicas (centroamericanas) |
| 203001 | Fallas geológicas (centroamericanas) | Fallas geológicas (centroamericanas) |
| 204000 | Geológico de Olancho (1:100,000) | geológico de olancho, geología de olancho, Geológico de Olancho (1:100,000) |
| 204001 | Geológico de Olancho 1:100,000 | Geológico de Olancho 1:100,000 |
| 205000 | Geológicos | geológicos |
| 205001 | Geológicos | geológicos |
| 206000 | Mapa estructural (1:50,000) | mapa estructural, estructural 50 mil, Mapa estructural (1:50,000) |
| 206001 | Mapa estructural 1:50,000 | Mapa estructural 1:50,000 |
| 207000 | Mapa geotectónico | geotectónico, mapa geotectónico, tectónica |
| 207001 | Mapa geotectónico | geotectónico, mapa geotectónico, tectónica |
| 208000 | Mapa metalogenético | metalogenético, mapa metalogenético, metalogenia |
| 208001 | Mapa metalogenético | metalogenético, mapa metalogenético, metalogenia |
| 209000 | Mapa geológico (1:500,000) | mapa geológico, geológico nacional, geología de honduras, Mapa geológico (1:500,000) |
| 209001 | Mapa geológico 1:500,000 | Mapa geológico 1:500,000 |
| 210000 | Suelos Simmons | suelos, suelos simmons, tipos de suelo, simmons |
| 210001 | Suelos Simmons | suelos, suelos simmons, tipos de suelo, simmons |
| 300000 | 3 Proyectos Indexa (planos) | proyectos, proyectos indexa, nuestros proyectos |
| 301000 | Pantaleona | pantaleona, proyecto pantaleona |
| 301001 | PAN_ProyAsociados_190320 | PAN_ProyAsociados_190320 |
| 301002 | Terreno para planta_La Pantaleona_20211013_EE | Terreno para planta_La Pantaleona_20211013_EE |
| 301003 | ANEXO 1 Proyecto 374   ubicacion general | ANEXO 1 Proyecto 374   ubicacion general |
| 301004 | ANEXO 1 Proyecto_teniente_ubicacion general_102san_marcos | ANEXO 1 Proyecto_teniente_ubicacion general_102san_marcos |
| 301005 | ANEXO 2 Proyecto_teniente_ubicacion General_102concepcion de maria | ANEXO 2 Proyecto_teniente_ubicacion General_102concepcion de maria |
| 301006 | ANEXO 6 PLANO CAMPAMENTO MINAS MODIFICADO | anexo 6 plano campamento minas modificado |
| 301007 | PLANOS EL TENIENTE II | planos el teniente ii |
| 301008 | PLANOS PROYECTO EL TENIENTE | planos proyecto el teniente |
| 301009 | ANEXO 1 Proyecto_la poderosa_ubicacion general_102 | ANEXO 1 Proyecto_la poderosa_ubicacion general_102 |
| 301010 | ANEXO 5 PLANO CAMPAMENTO MINAS MODIFICADO | anexo 5 plano campamento minas modificado |
| 301011 | 3. Plano 374-I | 3. Plano 374-I |
| 301012 | 4. Plano 374-V | 4. Plano 374-V |
| 301013 | Pantaleona | 800120 |
| 301014 | Terreno Planta El Teniente | Terreno Planta El Teniente, 800135 |
| 302000 | Buenavista Monarca | buenavista, buena vista, monarca, monarka, proyecto buenavista, Buenavista Monarca |
| 302001 | visita 21-11-15 | visita 21-11-15 |
| 302002 | TERRENO TOTAL PALMILLA | terreno total palmilla |
| 302003 | PERFIL TECNICO PROYECTO BUENA VISTA | perfil tecnico proyecto buena vista |
| 302004 | Buena Vista-Monarka | Buena Vista-Monarka, 800008 |
| 302005 | MONARKA I | monarka i, 800113 |
| 302006 | MONARKA II | monarka ii, 800114 |
| 303000 | Cimarrón | cimarrón, cimarron, el chaparro, proyecto cimarrón |
| 303001 | POLIGONOS CHIQUIN | poligonos chiquin |
| 303002 | PROYECTO EL CHAPARRO | proyecto el chaparro |
| 303003 | Afloramientos_Chaparro | Afloramientos_Chaparro |
| 303004 | Vetas_CHAPARRO | Vetas_CHAPARRO |
| 303005 | IND_ESC_Veins_030221 | IND_ESC_Veins_030221 |
| 303006 | LaCampana | LaCampana |
| 303007 | Traza de vetas | Traza de vetas |
| 303008 | 1087 PIEDRA DORADA | 1087 piedra dorada |
| 303009 | Baldoquin | Baldoquin |
| 303010 | PROYECTO EL GUAYABAL2 | proyecto el guayabal2 |
| 303011 | TERRENO EL GUAYABAL | terreno el guayabal |
| 303012 | TERRENO LA ESCALERA | terreno la escalera |
| 303013 | TERRENO PLANTA INFINITO | terreno planta infinito |
| 303014 | La Moloncosa | La Moloncosa |
| 303015 | Vetas inferidas | Vetas inferidas |
| 303016 | PLANO PROYECTO EL CHAPARRO | plano proyecto el chaparro |
| 303017 | PLANO PROYECTO SAN BENITO LA VICTORIA | plano proyecto san benito la victoria |
| 303018 | Campana | Campana, 800010 |
| 303019 | Chaparro | Chaparro, 800012 |
| 303020 | Cimarron | 800013 |
| 303021 | Escalera y Piedra Dorada | Escalera y Piedra Dorada, 800018 |
| 303022 | Estructuras medidas en campo El Chaparro (rumbo y buzamiento, mar-2020) | Estructuras medidas en campo El Chaparro, Estructuras medidas en campo El Chaparro (rumbo y buzamiento, mar-2020), 800050 |
| 303023 | Videos de campo con GPS — El Chaparro (feb-2020) | Videos de campo con GPS — El Chaparro, Videos de campo con GPS — El Chaparro (feb-2020), 800139 |
| 304000 | Minas de Oro | minas de oro, mdo, proyecto minas de oro, montecielo |
| 304001 | Estructural Minas de Oro | Estructural Minas de Oro |
| 304002 | Geologia Minas de Oro | Geologia Minas de Oro |
| 304003 | Geologia | minas de oro, mdo, proyecto minas de oro, montecielo |
| 304004 | Punto de referencia | Punto de referencia |
| 304005 | Prop_Angel_David_Bonilla_2 | Prop_Angel_David_Bonilla_2 |
| 304006 | Prop_Angel_David_Bonilla_3 | Prop_Angel_David_Bonilla_3 |
| 304007 | Prop_Antonio_Aguilar_1 | Prop_Antonio_Aguilar_1 |
| 304008 | Prop_Antonio_Aguilar_2 | Prop_Antonio_Aguilar_2 |
| 304009 | Prop_Antonio_Aguilar_3 | Prop_Antonio_Aguilar_3 |
| 304010 | Prop_Dixi_Donaire_2 | Prop_Dixi_Donaire_2 |
| 304011 | Prop_Dixi_Donaire_3 | Prop_Dixi_Donaire_3 |
| 304012 | Prop_Edgardo_Castro_Curry | Prop_Edgardo_Castro_Curry |
| 304013 | Prop_Exequiel_Caceres_2 | Prop_Exequiel_Caceres_2 |
| 304014 | Prop_Francisco_Alcides_Ramirez | Prop_Francisco_Alcides_Ramirez |
| 304015 | Prop_Gumercinda_Licona | Prop_Gumercinda_Licona |
| 304016 | Prop_Heriberto_Soler | Prop_Heriberto_Soler |
| 304017 | Prop_Isidoro_Canales | Prop_Isidoro_Canales |
| 304018 | Prop_Jely_Donaire | Prop_Jely_Donaire |
| 304019 | Prop_Jeremias_Guerrero | Prop_Jeremias_Guerrero |
| 304020 | Prop_Jeronimo_Mejia_Lobo | Prop_Jeronimo_Mejia_Lobo |
| 304021 | Prop_Jorge_Zuniga_Cruz | Prop_Jorge_Zuniga_Cruz |
| 304022 | Prop_Juan_FRancisco_Zuniga | Prop_Juan_FRancisco_Zuniga |
| 304023 | Prop_Luis_Aroldo_Zelaya_2 | Prop_Luis_Aroldo_Zelaya_2 |
| 304024 | Prop_Manuel_Antonio_Escoto_Soto | Prop_Manuel_Antonio_Escoto_Soto |
| 304025 | Prop_Marco_Rodriguez | Prop_Marco_Rodriguez |
| 304026 | Prop_Marcos_Rodriguez_2 | Prop_Marcos_Rodriguez_2 |
| 304027 | Prop_Miguel_Amador_1 | Prop_Miguel_Amador_1 |
| 304028 | Prop_Miguel_Angel_Amador_Caceres_2 | Prop_Miguel_Angel_Amador_Caceres_2 |
| 304029 | Prop_Reiniero_Zepeda | Prop_Reiniero_Zepeda |
| 304030 | Prop_Ricardo_Pineda | Prop_Ricardo_Pineda |
| 304031 | Prop_Urbano_Marques_1 | Prop_Urbano_Marques_1 |
| 304032 | Prop_dixi_donaire_1 | Prop_dixi_donaire_1 |
| 304033 | Prop_exequiel_Caceres_1 | Prop_exequiel_Caceres_1 |
| 304034 | Propo_Dixi_Donaire_2 | Propo_Dixi_Donaire_2 |
| 304035 | pro_amarilis_pineda | pro_amarilis_pineda |
| 304036 | prop_Enrique_Fonsec | prop_Enrique_Fonsec |
| 304037 | prop_Joaquin_Calix_Garcia | prop_Joaquin_Calix_Garcia |
| 304038 | prop_Jorge_midence | prop_Jorge_midence |
| 304039 | prop_Lester_Yuja | prop_Lester_Yuja |
| 304040 | prop_Ramon_Maradiaga_Canales | prop_Ramon_Maradiaga_Canales |
| 304041 | prop_Ubaldo_Sauceda | prop_Ubaldo_Sauceda |
| 304042 | prop_adela_Carranza_2 | prop_adela_Carranza_2 |
| 304043 | prop_adela_carranza | prop_adela_carranza |
| 304044 | prop_david_bonilla | prop_david_bonilla |
| 304045 | prop_luis_aroldo | prop_luis_aroldo |
| 304046 | Calicatas | Calicatas |
| 304047 | Camino | Camino |
| 304048 | catastro | minas de oro, mdo, proyecto minas de oro, montecielo |
| 304049 | lithology | lithology |
| 304050 | mc al 30 junio 2012 | mc al 30 junio 2012 |
| 304051 | v_concesion_minera | v_concesion_minera |
| 304052 | Hoja 1620c (Minas de Oro) | Hoja 1620c, Hoja 1620c (Minas de Oro) |
| 304053 | 2760_3 MINAS DE ORO | 2760_3 minas de oro |
| 304054 | 2760_3 MINAS DE ORO | 2760_3 minas de oro |
| 304055 | Camino | Camino, 800009 |
| 304056 | Estructural Minas de Oro | Estructural Minas de Oro, 800030 |
| 304057 | lithology | lithology, 800099 |
| 304058 | MINAS DE ORO I | minas de oro i, 800103 |
| 304059 | MINAS DE ORO II | minas de oro ii, 800104 |
| 304060 | MINAS DE ORO III | minas de oro iii, 800105 |
| 304061 | MINAS DE ORO IV | minas de oro iv, 800106 |
| 304062 | MINAS DE ORO V | minas de oro v, 800107 |
| 304063 | MONTECIELO 5 | montecielo 5, 800115 |
| 304064 | MONTECIELO 6 | montecielo 6, 800116 |
| 304065 | MONTECIELO I | montecielo i, 800117 |
| 304066 | MONTECIELO II | montecielo ii, 800118 |
| 304067 | Punto las hermosas | Punto las hermosas, 800126 |
| 400000 | 4 Historia de Honduras | historia, historia de honduras |
| 401000 | Historia de Honduras | históricos, mapas históricos, jica |
| 401001 | Mapa geológico de Olancho (JICA) | Mapa geológico de Olancho, Mapa geológico de Olancho (JICA) |
| 401002 | Mapa estructural de Olancho (JICA) | Mapa estructural de Olancho, Mapa estructural de Olancho (JICA) |
| 401003 | Anomalías geoquímicas de Cu en Olancho (JICA) | Anomalías geoquímicas de Cu en Olancho, Anomalías geoquímicas de Cu en Olancho (JICA) |
| 401004 | Anomalías geoquímicas de Zn en Olancho (JICA) | Anomalías geoquímicas de Zn en Olancho, Anomalías geoquímicas de Zn en Olancho (JICA) |
| 401005 | Muestras geoquímicas JICA (Fases I–III) | Muestras geoquímicas JICA, Muestras geoquímicas JICA (Fases I–III) |
| 401006 | Perfiles A-B-C | Perfiles A-B-C |
| 401007 | zona de estudio 3 fases jica | zona de estudio 3 fases jica |
| 401008 | zona potencial olancho | zona potencial olancho |
| 401009 | zonas de JICA | zonas de JICA |
| 800000 | 8 Otros | otros, otras capas, varios |
| 800001 | 20161011_La_Lola_NAD27 | 20161011_La_Lola_NAD27 |
| 800002 | 20161011_La_Lola_NAD27 | 20161011_La_Lola_NAD27 |
| 800003 | Aluviales Olancho | Aluviales Olancho |
| 800004 | Antimonio_usgs | Antimonio_usgs |
| 800005 | area de estudio(geologico olancho 1;100,000) | area de estudio, area de estudio(geologico olancho 1;100,000) |
| 800006 | AREA DE GEOLOGIA OLANCHO | area de geologia olancho |
| 800007 | au anomalias | au anomalias |
| 800011 | Cerro Rico | Cerro Rico |
| 800014 | Cortinas | Cortinas |
| 800015 | Depósitos | otros, otras capas, varios |
| 800016 | Depósitos minerales | otros, otras capas, varios |
| 800017 | El Blanco | El Blanco |
| 800019 | Estructural | otros, otras capas, varios |
| 800020 | Estructural | otros, otras capas, varios |
| 800021 | Estructural Agalteca | Estructural Agalteca |
| 800022 | Estructural Comayagua | Estructural Comayagua |
| 800023 | Estructural Danlí | Estructural Danlí |
| 800024 | Estructural El Rosario | Estructural El Rosario |
| 800025 | Estructural Guaimaca | Estructural Guaimaca |
| 800026 | Estructural Jamastrán | Estructural Jamastrán |
| 800027 | Estructural La Unión | Estructural La Unión |
| 800028 | Estructural Lepaterique | Estructural Lepaterique |
| 800029 | ESTRUCTURAL LOLA | estructural lola |
| 800031 | Estructural Morocelí | Estructural Morocelí |
| 800032 | Estructural Nueva Armenia | Estructural Nueva Armenia |
| 800033 | Estructural Ojojona | Estructural Ojojona |
| 800034 | ESTRUCTURAL OLANCHO | estructural olancho |
| 800035 | ESTRUCTURAL OLANCHO | estructural olancho |
| 800036 | Estructural Orica Guayape | Estructural Orica Guayape |
| 800037 | Estructural Salamá | Estructural Salamá |
| 800038 | Estructural San Buenaventura | Estructural San Buenaventura |
| 800039 | Estructural San Juan de Flores | Estructural San Juan de Flores |
| 800040 | Estructural San Pedro Zacapa | Estructural San Pedro Zacapa |
| 800041 | Estructural Santa Bárbara | Estructural Santa Bárbara |
| 800042 | Estructural Santa Cruz de Yojoa | Estructural Santa Cruz de Yojoa |
| 800043 | Estructural Santa María del Real | Estructural Santa María del Real |
| 800044 | Estructural Siguatepeque | Estructural Siguatepeque |
| 800045 | Estructural Talanga | Estructural Talanga |
| 800046 | Estructural Taulabé | Estructural Taulabé |
| 800047 | Estructural Tegucigalpa | Estructural Tegucigalpa |
| 800048 | Estructural Yuscarán | Estructural Yuscarán |
| 800049 | Estructural Zambrano | Estructural Zambrano |
| 800051 | Fallas activas GEM Centroamérica | Fallas activas GEM Centroamérica |
| 800052 | Fallas geológicas USGS Caribe 1:2.5M | Fallas geológicas USGS Caribe 1:2.5M |
| 800053 | GEOLOGIA REGIONAL LA LOLA | geologia regional la lola |
| 800054 | GEOLOGIA REGIONAL LOLA | geologia regional lola |
| 800055 | Geología superficial USGS Caribe 1:2.5M | Geología superficial USGS Caribe 1:2.5M |
| 800056 | Geológico | Geológico |
| 800057 | Geológico | Geológico |
| 800058 | Geológico Agalteca | Geológico Agalteca |
| 800059 | Geológico Comayagua | Geológico Comayagua |
| 800060 | Geológico El Rosario | Geológico El Rosario |
| 800061 | Geológico Guaimaca | Geológico Guaimaca |
| 800062 | Geológico Jamastrán | Geológico Jamastrán |
| 800063 | Geológico La Unión | Geológico La Unión |
| 800064 | Geológico Lepaterique | Geológico Lepaterique |
| 800065 | Geológico Morocelí | Geológico Morocelí |
| 800066 | Geologico_Nacional | otros, otras capas, varios |
| 800067 | Geológico Nueva Armenia | Geológico Nueva Armenia |
| 800068 | Geológico Ojojona | Geológico Ojojona |
| 800069 | Geológico Salamá | Geológico Salamá |
| 800070 | Geológico San Buenaventura | Geológico San Buenaventura |
| 800071 | Geológico San Juan de Flores | Geológico San Juan de Flores |
| 800072 | Geológico San Pedro Zacapa | Geológico San Pedro Zacapa |
| 800073 | Geológico Santa Bárbara | Geológico Santa Bárbara |
| 800074 | Geológico Santa Cruz de Yojoa | Geológico Santa Cruz de Yojoa |
| 800075 | Geológico Santa María del Real | Geológico Santa María del Real |
| 800076 | Geológico Siguatepeque | Geológico Siguatepeque |
| 800077 | Geológico Talanga | Geológico Talanga |
| 800078 | Geológico Taulabé | Geológico Taulabé |
| 800079 | Geológico Tegucigalpa | Geológico Tegucigalpa |
| 800080 | Geológico Yuscarán | Geológico Yuscarán |
| 800081 | Geológico Zambrano | Geológico Zambrano |
| 800082 | Geoquímica | Geoquímica |
| 800083 | La Cortina I | La Cortina I |
| 800084 | La Cortina II | La Cortina II |
| 800085 | La Cortina III | La Cortina III |
| 800086 | La Cortina IV | La Cortina IV |
| 800087 | La Cortina V | La Cortina V |
| 800088 | La Jefa | La Jefa |
| 800089 | LA LOLA | la lola |
| 800090 | LA LOLA | la lola |
| 800091 | LA LOLA | la lola |
| 800092 | LA LOLA | la lola |
| 800093 | LA LOLA | la lola |
| 800094 | La Pochota | La Pochota |
| 800095 | La Roca | La Roca |
| 800096 | LA ROCA I | la roca i |
| 800097 | LA ROKA II | la roka ii |
| 800098 | Límites de placas tectónicas PB2002 | Límites de placas tectónicas PB2002 |
| 800100 | Mapa geológico Danlí | Mapa geológico Danlí |
| 800101 | MAPA GEOLOGICO OLANCHO | mapa geologico olancho |
| 800102 | Marimbero | Marimbero |
| 800108 | Mineralizacion | Mineralizacion |
| 800109 | Mineralizacion | Mineralizacion |
| 800110 | Mineralizacion | Mineralizacion |
| 800111 | MINERALIZACION LOLA | mineralizacion lola |
| 800112 | MINERALIZACION LOLA | mineralizacion lola |
| 800119 | Ocurrencias Minerales | Ocurrencias Minerales |
| 800121 | Perfiles A-B-C | Perfiles A-B-C |
| 800122 | POLIGONO LA LOLA | poligono la lola |
| 800123 | POLOGONO LA LOLA | pologono la lola |
| 800124 | Provincias geológicas USGS Caribe | Provincias geológicas USGS Caribe |
| 800125 | Punto de referencia | Punto de referencia |
| 800127 | puntos de visita 10-10-16 hugo | puntos de visita 10-10-16 hugo |
| 800128 | PUNTOS VISITA LOLA | puntos visita lola |
| 800129 | REFERENCIA | referencia |
| 800130 | Ríos | otros, otras capas, varios |
| 800131 | Rumbos y echados | Rumbos y echados |
| 800132 | San Judas | San Judas |
| 800133 | Sectores de Estudio | Sectores de Estudio |
| 800134 | Tajo | Tajo |
| 800136 | Tractos permisivos pórfido de cobre USGS | Tractos permisivos pórfido de cobre USGS |
| 800137 | Travesia | Travesia |
| 800138 | Tule | Tule |
| 800140 | Yacimientos MRDS USGS | Yacimientos MRDS USGS |
| 800141 | Yacimientos y ocurrencias mineras DEFOMIN | Yacimientos y ocurrencias mineras DEFOMIN |
| 800142 | Yacimientos y prospectos pórfido de cobre USGS | Yacimientos y prospectos pórfido de cobre USGS |
| 800143 | Zona Beta | Zona Beta |
| 800144 | zona potencial olancho | zona potencial olancho |
| 800145 | Alteración por arcillas (SWIR B11/B12) | Alteración por arcillas, Alteración por arcillas (SWIR B11/B12) |
| 800146 | Óxidos de hierro (B04/B02) | Óxidos de hierro, Óxidos de hierro (B04/B02) |
| 800147 | Caída de vegetación 2025 → 2026 | Caída de vegetación 2025 → 2026 |
| 900000 | 9 Cuarentena | cuarentena, archivos en revisión |

## 7. Resultado de las pruebas (sección 5)

CI del PR #169 sobre `c79a439`: **todo en verde** (pruebas 1/4–4/4, navegador, nodo, web). Revisión de código y de seguridad de Codex: 2 hallazgos (modo mapa demasiado amplio; «deja solo» perdido al preguntar cuál), corregidos con prueba; sin hallazgos de seguridad. Desplegado en Render (`299d66f`, live) y manifiesto v1.5 publicado en el cubo (el v1.4 queda como `manifest-v1.4.json`).

**Panel**
- [x] El árbol coincide 100 % con el índice — `tests/electrum-arbol-indice.test.ts` (11 pruebas) en verde: falla si falta, sobra o cambia de orden una entrada.
- [x] Las entradas sin archivo aparecen en gris como «Sin datos» (hoy ninguna entrada oficial está sin datos; comprobado en navegador con una de prueba).

**Colores**
- [x] Ninguna capa categorizada de un solo color (prueba sobre las 299 capas con estilo).
- [x] Oro `#FFD700` amarillo y un color distinto por mineral en 110001, 110002 y 110003 (prueba).
- [x] KML/KMZ con su estilo original por elemento (48 capas); el SHP de Minas de Oro toma los colores del KMZ del mismo mapa (prueba).
- [x] Leyenda por categoría y cuadrito de color en cada valor de filtro (comprobado en Chromium).

**Proyectos**
- [x] 24 archivos de Pantaleona, Buenavista Monarca, Cimarrón y Minas de Oro movidos a su proyecto; ninguno con esos nombres queda en Otros (prueba). Copias en `mapas/3_proyectos_indexa/…` (originales sin tocar).
- [x] IDs retirados en `id_anterior` y en `retirados`; no se reutilizan y siguen funcionando como alias (prueba).

**Doctor Electrum**
- [x] Casos A–E tal como están escritos — `tests/electrum-dialogo-capas.test.ts` (11 pruebas). Con los datos reales de producción: todas las fichas seleccionadas = 123 puntos, de oro = 73, de plata = 1.
- [x] Lo que Electrum abre o cierra se refleja en el panel y viceversa (Chromium: la orden marca la casilla, el cambio a plata llega al mapa, apagar la casilla le quita la capa; el estado viaja con cada pregunta).
- [x] Solo ofrece valores de filtro reales (`validarFiltros`; un valor inventado como «Litio» se rechaza).
- [x] Nunca dice haber abierto algo que no abrió: con una capa inexistente o sin datos no manda orden y lo dice.
- [x] Funciona con todas las capas filtrables (depósitos, derechos mineros por estado, áreas protegidas, geología por unidad…), y las preguntas que no son de capas siguen al modelo.
- [x] El prompt cabe en el nodo también en modo mapa (`tests/electrum-prompt-cabe.test.ts`).
- [x] Conteo contra PostGIS: varios valores = O, varios campos = Y; color por rasgo (`tests/electrum-indice-capas.test.ts`).

