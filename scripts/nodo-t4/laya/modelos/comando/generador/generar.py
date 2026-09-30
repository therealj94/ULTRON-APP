"""Genera los datos de Laya «comando»: frases dichas en voz alta → la orden de pantalla (o ninguna).

    python generar.py            # escribe ../datos/train_a.jsonl y ../datos/test.jsonl

Cada frase sale de plantillas por acción, con lo que tiene el habla de verdad: cortesía («por
favor», «doctor»), muletillas («eh», «a ver», «este»), habla hondureña («dale pues», «porfa»,
«vaya»), y lo que deja el dictado (sin tildes, sin signos, minúsculas). La prueba (test.jsonl) sale
de OTRAS plantillas y de otra semilla: mide si el modelo entendió la orden o solo memorizó frases.
bordes.jsonl lo escribe una persona (casos difíciles) y no se toca aquí.

El modelo es COMPARTIDO con AU-RA: cada frase lleva además una etiqueta del grupo `app` (las manos de
AURA, ver generar_aura.py). Para las frases de Electrum casi siempre es `app_ninguna`; las de pantalla
completa / mitad son `app_presencia` (en AU-RA, cómo se presenta AURA) y «busca en internet…»,
`app_buscar_internet`. La etiqueta se añade al escribir: las frases y la semilla no cambian.

Solo biblioteca estándar y determinista (misma semilla → mismos archivos).
"""
import json
import os
import random
import unicodedata

AQUI = os.path.dirname(os.path.abspath(__file__))
DATOS = os.path.join(AQUI, '..', 'datos')

PRE = ['', '', '', '', 'por favor ', 'doctor, ', 'oye, ', 'a ver, ', 'eh, ', 'bueno, ', 'dale, ', 'porfa ', 'doctor electrum, ',
       'ok, ', 'vaya, ', 'ahora ', 'mira, ', 'este... ', 'ya, ', 'oiga, ', 'ey, ']
POST = ['', '', '', '', ' por favor', ' porfa', ' gracias', ' ahí', ' ya', ' rápido', ' pues', ' un poquito', ' doctor', ' ahorita', ' si puedes']

# Plantillas de ENTRENAMIENTO por acción. {m} = el mapa (varía), {e} = esto/esta concesión.
MAPA = ['el mapa', 'la vista', 'la cámara', 'la pantalla', 'el mapa', 'eso']
ESTA = ['esta concesión', 'esta', 'la concesión abierta', 'la que está abierta', 'esta mina', 'la ficha abierta', 'esta área']

T = {
 'siguiente': ['siguiente', 'sigue', 'continúa', 'continuemos', 'adelante', 'pasa al siguiente', 'el que sigue', 'pasemos a lo siguiente',
               'siguiente capítulo', 'dale al siguiente', 'avanza', 'sigamos', 'vamos con lo que sigue', 'next', 'pásale', 'ok siguiente',
               'ya entendí, sigue', 'continúa con el recorrido', 'avanza al próximo', 'muéstrame el siguiente paso'],
 'detener': ['para el recorrido', 'termina el recorrido', 'detén el tour', 'ya no quiero el recorrido', 'sal del recorrido', 'para la presentación',
             'termina la presentación', 'stop al recorrido', 'corta el tour', 'ya basta de recorrido', 'finaliza el tutorial', 'cancela el recorrido',
             'detén la presentación', 'quita el recorrido', 'no sigas con el tour'],
 'callar': ['cállate', 'silencio', 'shh', 'deja de hablar', 'ya no hables', 'calla', 'basta', 'para de hablar', 'no hables más', 'mutéate',
            'silencio por favor', 'baja la voz y cállate', 'ya, cállate', 'no digas nada', 'guarda silencio'],
 'cerrar': ['cierra la ventana', 'cierra eso', 'quita la ficha', 'cierra la ficha', 'cierra el visor', 'quita esa imagen', 'cierra la tarjeta',
            'ciérralo', 'quítalo', 'oculta eso', 'cierra el pdf', 'cierra el mapa geológico', 'cierra el timelapse', 'esconde la ventana',
            'quita esa ventana', 'cierra todo eso', 'cierra el tablero', 'ya cierra', 'fuera esa ventana', 'desaparece eso'],
 'zoom_mas': ['acércate', 'acerca {m}', 'más cerca', 'haz zoom', 'zoom in', 'amplía', 'amplíalo', 'agranda la imagen del mapa', 'entra más',
              'acércame', 'más zoom', 'quiero ver más de cerca', 'acércate más', 'haz zoom aquí', 'ponlo más cerca', 'arrímate', 'dale zoom',
              'métete más', 'acércate a la concesión', 'enfoca más cerca'],
 'zoom_menos': ['aléjate', 'aleja {m}', 'más lejos', 'zoom out', 'menos zoom', 'abre la vista', 'aléjalo', 'quiero ver más área', 'sal un poco',
                'aléjate un poco', 'retrocede', 'haz zoom hacia afuera', 'ponlo más lejos', 'reduce el zoom', 'ver más amplio', 'desenfoca y aleja',
                'aléjame', 'más alejado', 'quita zoom', 'que se vea más territorio'],
 'mover_arriba': ['sube {m}', 'muévete al norte', 'más arriba', 'mueve {m} hacia arriba', 've hacia el norte', 'desplázate al norte', 'arriba',
                  'corre {m} para arriba', 'súbelo', 'llévame más al norte', 'mueve hacia arriba', 'un poco más arriba', 'hacia el norte',
                  'desliza {m} hacia arriba', 'muéstrame lo de arriba'],
 'mover_abajo': ['baja {m}', 'muévete al sur', 'más abajo', 'mueve {m} hacia abajo', 've hacia el sur', 'desplázate al sur', 'abajo',
                 'corre {m} para abajo', 'bájalo', 'llévame más al sur', 'mueve hacia abajo', 'un poco más abajo', 'hacia el sur',
                 'desliza {m} hacia abajo', 'muéstrame lo de abajo'],
 'mover_izquierda': ['muévete a la izquierda', 'a la izquierda', 'mueve {m} a la izquierda', 'corre {m} a la izquierda', 've al oeste',
                     'desplázate al oeste', 'más a la izquierda', 'hacia el oeste', 'llévame al oeste', 'córrelo a la izquierda',
                     'desliza {m} a la izquierda', 'un poco a la izquierda', 'muestra lo que hay a la izquierda', 'izquierda', 've para la izquierda'],
 'mover_derecha': ['muévete a la derecha', 'a la derecha', 'mueve {m} a la derecha', 'corre {m} a la derecha', 've al este',
                   'desplázate al este', 'más a la derecha', 'hacia el este', 'llévame al este', 'córrelo a la derecha',
                   'desliza {m} a la derecha', 'un poco a la derecha', 'muestra lo que hay a la derecha', 'derecha', 've para la derecha'],
 'rotar_izquierda': ['gira a la izquierda', 'rota a la izquierda', 'gíralo a la izquierda', 'rota {m} a la izquierda', 'gira {m} hacia la izquierda',
                     'da vuelta a la izquierda', 'rotación a la izquierda', 'gira en contra del reloj', 'voltea {m} a la izquierda',
                     'gira un poco a la izquierda', 'rota al otro lado', 'gira al revés', 'dale vuelta para la izquierda', 'rota antihorario', 'girar izquierda'],
 'rotar_derecha': ['gira a la derecha', 'rota a la derecha', 'gíralo a la derecha', 'rota {m} a la derecha', 'gira {m} hacia la derecha',
                   'da vuelta a la derecha', 'rotación a la derecha', 'gira como el reloj', 'voltea {m} a la derecha', 'gira un poco a la derecha',
                   'rota {m}', 'gira {m}', 'dale vuelta para la derecha', 'rota en sentido horario', 'girar derecha'],
 'norte_arriba': ['pon el norte arriba', 'endereza {m}', 'quita el giro', 'norte arriba', 'orienta al norte', 'endereza la vista', 'deja {m} derecho',
                  'resetea la rotación', 'vuelve al norte', 'que el norte quede arriba', 'enderézalo', 'orienta {m} normal', 'quita la rotación',
                  'pon {m} derecho', 'alinea al norte'],
 'inclinar': ['inclina {m}', 'inclínalo', 'ponlo de lado', 'vista en perspectiva', 'más inclinado', 'ladea {m}', 'dale ángulo', 'ponlo en perspectiva',
              'inclina la cámara', 'quiero verlo de lado', 'baja la cámara para ver de lado', 'más perspectiva', 'inclina más', 'vista oblicua',
              'mira de lado'],
 'vista_cenital': ['vista de arriba', 'ponlo plano', 'míralo desde arriba', 'vista cenital', 'quita la inclinación', 'endereza la cámara hacia abajo',
                   'vista aérea desde arriba', 'plano por favor', 'sin perspectiva', 'ver desde arriba', 'pon la cámara vertical', 'ponlo en planta',
                   'vista en planta', 'aplánalo', 'de arriba nada más'],
 'orbitar': ['dale la vuelta completa', 'orbita', 'gira alrededor', 'da una vuelta de 360', 'sobrevuela en círculo', 'haz una órbita',
             'dale la vuelta a la concesión', 'gira 360 grados', 'rodéalo', 'dame una vuelta alrededor', 'vuela alrededor', 'orbita alrededor',
             'vuelta completa', 'hazme la toma de dron alrededor', 'gira todo alrededor'],
 'relieve_3d': ['pon el 3d', 'activa el 3d', 'muéstrame el relieve', 'ponlo en tres d', 'activa el relieve', 'quiero ver en 3d', 'relieve 3d',
                'enciende el tres d', 'con relieve', 'terreno en 3d', 'muéstramelo en 3d', 'activa las montañas en 3d', 'modo 3d', 'ver el terreno real',
                'pon la vista tres dimensiones'],
 'quitar_3d': ['quita el 3d', 'apaga el 3d', 'sin relieve', 'quita el relieve', 'desactiva el tres d', 'apaga el relieve', 'sin 3d', 'ya no en 3d',
               'quita el tres d', 'modo 2d', 'vuelve a 2d', 'desactiva el relieve', 'apaga las montañas', 'fuera el 3d', 'no quiero el 3d'],
 'mas_mapa': ['más mapa', 'agranda el mapa', 'dame más mapa', 'abre más el mapa', 'mapa más grande', 'solo el mapa', 'que el mapa ocupe más',
              'hazle espacio al mapa', 'el mapa en grande', 'quiero ver más el mapa', 'expande el mapa', 'mapa completo', 'sube el mapa de tamaño',
              'achica el chat', 'más espacio para el mapa'],
 'mas_chat': ['más chat', 'agranda el chat', 'dame más chat', 'más conversación', 'chat más grande', 'solo el chat', 'que el chat ocupe más',
              'agranda la conversación', 'quiero leer más', 'expande el chat', 'achica el mapa', 'más espacio para la conversación', 'el chat en grande',
              'sube el chat', 'hazle espacio al chat'],
 'mitad': ['mitad y mitad', 'divide la pantalla', 'mitad mitad', 'pantalla dividida', 'parte la pantalla', 'la mitad para cada uno', 'mitad mapa mitad chat',
           'reparte la pantalla', 'pantalla a la mitad', 'divídelo en dos', 'mitad', 'igual de grandes', 'cincuenta y cincuenta', 'split', 'mitad de pantalla'],
 'pantalla_completa': ['pantalla completa', 'pon pantalla completa', 'ponlo en pantalla completa', 'todo en grande', 'full screen', 'modo pantalla completa',
                       'expande a toda la pantalla', 'que ocupe toda la pantalla', 'activa pantalla completa', 'maximiza', 'a pantalla completa',
                       'pantalla entera', 'ponlo full', 'agranda todo a la pantalla', 'modo cine'],
 'salir_pantalla': ['sal de pantalla completa', 'quita la pantalla completa', 'salir de pantalla completa', 'ya no pantalla completa', 'minimiza',
                    'vuelve a la ventana', 'desactiva pantalla completa', 'sal del modo pantalla completa', 'quita el full screen', 'regresa a normal',
                    'saca la pantalla completa', 'modo ventana', 'achica la pantalla', 'sal de full', 'termina la pantalla completa'],
 'abrir_tablero': ['abre el tablero', 'muéstrame el tablero', 'el tablero', 'abre el resumen del país', 'ver el tablero', 'abre las cifras',
                   've al tablero', 'tablero nacional', 'enséñame el tablero', 'abre el panel de cifras', 'quiero ver el tablero', 'pon el tablero',
                   'abre el dashboard', 'muestra las estadísticas', 'abre el resumen'],
 'abrir_capas': ['abre las capas', 'muéstrame las capas', 'capas', 'ver las capas', 'abre el menú de capas', 'enséñame las capas', 'qué capas hay, ábrelas',
                 'abre la lista de capas', 'despliega las capas', 've a capas', 'quiero ver las capas', 'pon las capas', 'abre capas del mapa',
                 'muestra el panel de capas', 'capas del mapa'],
 'abrir_expedientes': ['abre los expedientes', 've a expedientes', 'muéstrame los expedientes', 'expedientes', 'abre los archivos', 'ver los documentos',
                       'abre la carpeta de expedientes', 'pestaña de expedientes', 'quiero ver los expedientes', 'enséñame los archivos',
                       'abre la biblioteca', 've a los documentos', 'abre documentos', 'muestra los archivos', 'expedientes por favor'],
 'abrir_infra': ['abre infraestructura', 've a infraestructura', 'muéstrame la infraestructura', 'infraestructura', 'abre la pestaña de infraestructura',
                 'ver infraestructura', 'enséñame la infraestructura del conocimiento', 'quiero ver la infraestructura', 'pestaña infraestructura',
                 'abre el panel de infraestructura', 've a la infra', 'abre infra', 'infraestructura por favor', 'muestra la infraestructura', 'la infraestructura'],
 'abrir_consulta': ['ve al chat', 'abre la consulta', 'vuelve a la consulta', 'abre el chat', 'la consulta', 'pestaña de consulta', 'regresa al chat',
                    'quiero escribirte, abre el chat', 've a la conversación', 'abre la conversación', 'volvamos al chat', 'muestra el chat',
                    'consulta por favor', 'pestaña chat', 'regresa a la consulta'],
 'abrir_recorrido': ['empieza el recorrido', 'hazme el recorrido', 'inicia el tour', 'quiero el tutorial', 'arranca el recorrido', 'muéstrame el recorrido',
                     'dame un tour', 'empieza la presentación', 'recorrido completo', 'haz el tour guiado', 'enséñame la plataforma',
                     'inicia la presentación', 'quiero ver el recorrido', 'pon el recorrido', 'tutorial por favor'],
 'fondo_satelite': ['pon el satélite', 'vista satelital', 'cambia a satélite', 'fondo satelital', 'modo satélite', 'imagen de satélite',
                    'pon la foto satelital', 'cambia el fondo a satélite', 'satélite', 'muestra el satélite de fondo', 'quiero ver satélite',
                    'fondo de satélite', 'pon satelital', 'vista de satélite', 'activa el satélite'],
 'fondo_calles': ['pon calles', 'mapa de calles', 'cambia a calles', 'fondo de calles', 'modo calles', 'vista de calles', 'pon el mapa normal',
                  'cambia el fondo a calles', 'calles', 'quita el satélite y pon calles', 'quiero ver calles', 'mapa de carreteras de fondo',
                  'pon el mapa de calles', 'vista normal', 'fondo normal'],
 'mi_ubicacion': ['dónde estoy', 'llévame a mi ubicación', 'mi ubicación', 'muéstrame dónde estoy', 've a donde estoy', 'ubícame', 'dónde estoy yo',
                  'centra en mí', 'llévame donde estoy parado', 'enséñame mi posición', 'mi posición', 've a mi ubicación', 'estoy aquí, muéstrame',
                  'localízame', 'centra en mi ubicación'],
 'ver_pais': ['muéstrame todo el país', 'vista general', 'honduras entera', 'todo honduras', 've a todo el país', 'vuelve a la vista general',
              'enséñame el país completo', 'vista de todo el país', 'muestra toda honduras', 'regresa a la vista inicial', 'ver el país entero',
              'aléjate hasta ver todo el país', 'mapa de todo honduras', 'vista nacional', 'todo el mapa'],
 'ficha_pdf': ['bájame el pdf de {e}', 'hazme la ficha en pdf', 'ficha pdf', 'saca el pdf de {e}', 'genera la ficha de {e}', 'pdf de {e}',
               'imprime la ficha', 'quiero el pdf', 'dame la ficha en pdf', 'descarga la ficha', 'arma el pdf de {e}', 'la ficha en pdf por favor',
               'haz el informe pdf de {e}', 'exporta a pdf {e}', 'ficha para imprimir'],
 'mapa_geologico': ['hazme el mapa geológico de {e}', 'mapa geológico', 'dibuja la geología de {e}', 'mapa geológico de {e}', 'muéstrame la geología en mapa',
                    'saca el mapa geológico', 'genera el mapa litológico', 'dibújame el mapa de rocas', 'mapa de geología de {e}', 'quiero el mapa geológico',
                    'haz los mapas geológicos', 'mapa estructural de {e}', 'dibuja el mapa geológico', 'arma el mapa de geología', 'pon el mapa geológico'],
 'timelapse': ['ponme el timelapse', 'timelapse', 'muéstrame el timelapse de {e}', 'abre el timelapse', 'cómo cambió con los años, muéstramelo',
               'timelapse satelital', 'quiero ver el antes y después', 'pon las imágenes por año', 'muéstrame la evolución satelital', 'time lapse',
               'abre el timelapse satelital de {e}', 'enséñame cómo ha cambiado {e}', 'reproduce el timelapse', 'dale play al timelapse', 'año por año'],
 'analizar': ['analiza {e}', 'dame el análisis de {e}', 'analízala', 'haz el análisis', 'analiza la concesión', 'quiero el análisis de {e}',
              'evalúa {e}', 'haz un análisis completo de {e}', 'analizar', 'qué opinas de {e}, analízala', 'análisis de {e}', 'revisa {e} a fondo',
              'dame tu evaluación de {e}', 'estudia {e}', 'analiza esto'],
 'manos_on': ['activa las manos', 'prende el air touch', 'activa air touch', 'enciende las manos', 'quiero usar las manos', 'activa los gestos',
              'control con las manos', 'enciende la cámara para las manos', 'air touch', 'activa el control por gestos', 'usa las manos',
              'prende los gestos', 'modo manos', 'enciende air touch', 'activa el air touch'],
 'manos_off': ['apaga las manos', 'quita el air touch', 'desactiva air touch', 'apaga los gestos', 'ya no uses las manos', 'apaga la cámara',
               'desactiva las manos', 'quita los gestos', 'apaga el air touch', 'sin manos', 'desactiva el control por gestos', 'quita las manos',
               'apaga modo manos', 'fuera el air touch', 'deja de usar la cámara'],
}

# Lo que NO es una orden de pantalla: va al cerebro. Muchas se parecen a órdenes a propósito.
NINGUNA = [
 '¿cuántas concesiones hay en olancho?', '¿qué concesiones vencen este año?', 'muéstrame la concesión los almendros', 'llévame a juticalpa',
 'busca la concesión san andrés', '¿quién es el titular de la mina de clavo rico?', '¿cuánto oro hay en esa zona?', 'gracias', 'ok perfecto',
 'hola doctor', 'buenas tardes', '¿qué hay al norte de la concesión?', '¿la concesión está al sur del río?', '¿por qué gira la tierra?',
 '¿cuánto cuesta abrir una mina?', '¿qué significa cerrar una mina?', 'la siguiente concesión que vence, ¿cuál es?', '¿qué capas geológicas hay en la zona?',
 '¿cómo se ve el relieve de la zona?', '¿el mapa está en nad27?', 'convierte estas coordenadas a wgs84', '¿cuántas hectáreas tiene?',
 '¿qué tan lejos está el caserío?', '¿hay traslapes en esta concesión?', 'explícame la geología', '¿qué es un timelapse?', '¿para qué sirve el tablero?',
 'dime el precio del oro', 'arma el informe de la cartera', '¿qué expediente tiene esa concesión?', '¿cuál es el estado de la solicitud?',
 'busca en internet noticias de minería', 'eso está muy bien', 'no entiendo', 'repite por favor', '¿puedes explicarlo otra vez?', 'y en dólares?',
 'la segunda', 'la de santa rosa', 'sí, esa', 'no, la otra', '¿qué recomiendas?', '¿es rentable?', 'hazme un resumen', '¿quién la otorgó?',
 'calcula cuántas onzas son 250 mil toneladas a 3 gramos', '¿dónde queda el municipio de gualaco?', '¿dónde está la mina san martín?',
 'estoy en la oficina', 'ahorita vengo', 'espérame un momento', 'ya volví', 'mi jefe quiere saber cuántas hay', 'eso me gusta',
 '¿la ficha incluye el plano?', '¿el pdf lleva firma?', '¿qué es el air touch?', '¿cómo uso las manos?', 'a la derecha del río hay un caserío, ¿cierto?',
 '¿hacia dónde corre la falla?', '¿el rumbo de la veta es norte sur?', 'sube el precio del oro este año?', '¿baja la ley en profundidad?',
 '¿qué significa s-explorar?', '¿cuántas están en exploración?', 'dame las concesiones de exploración en choluteca', '¿cuándo vence la licencia ambiental?',
 'necesito presentar esto al inhgeomin', 'hazme el plano para inhgeomin de la concesión el tule', 'muéstrame los traslapes de la concesión la esperanza',
 'vuela a la concesión el porvenir', 'enséñame dónde queda tegucigalpa', 'acércate a la concesión los pinares', 'hola, ¿cómo estás?', 'jaja',
 'qué bonito se ve', 'wow', 'impresionante', 'excelente trabajo', 'no gracias', 'sí', 'ok', 'ajá', 'mmm', 'claro', 'eh', 'bueno',
 '¿qué hora es?', '¿cómo está el clima en olancho?', 'estaba hablando con otra persona', 'no te hablaba a ti', 'pásame el café',
 '¿qué opinas del proyecto?', '¿cuántos caseríos tiene dentro?', '¿pisa un área protegida?', '¿qué dice el expediente?', 'lee el contrato',
 '¿cuál es la más grande?', 'ordénalas por área', 'compáralas', '¿y la otra?', 'dime más', 'sigue explicando lo de la geología',
]
# La prueba: formas que NO están arriba (otras palabras, otro orden).
T_PRUEBA = {
 'siguiente': ['vamos al próximo', 'pasemos', 'dale para adelante', 'lo que sigue'],
 'detener': ['ya terminemos el recorrido', 'no quiero más tour'],
 'callar': ['ya no me hables', 'guarda silencio doctor'],
 'cerrar': ['quita ese recuadro', 'cierra esa ventanita'],
 'zoom_mas': ['acércamelo más', 'quiero verlo bien de cerca'],
 'zoom_menos': ['aléjalo más', 'quiero ver todo alrededor más lejos'],
 'mover_arriba': ['súbeme el mapa', 've para el norte'],
 'mover_abajo': ['bájame el mapa', 've para el sur'],
 'mover_izquierda': ['corre la vista al oeste', 'llévalo para la izquierda'],
 'mover_derecha': ['corre la vista al este', 'llévalo para la derecha'],
 'rotar_izquierda': ['gíralo al revés del reloj', 'rótalo para la izquierda'],
 'rotar_derecha': ['gíralo como las agujas del reloj', 'rótalo para la derecha'],
 'norte_arriba': ['deja el norte hacia arriba', 'orienta el mapa como siempre'],
 'inclinar': ['quiero la vista inclinada', 'ponle perspectiva'],
 'vista_cenital': ['vista desde el cielo derecha hacia abajo', 'ponlo planito'],
 'orbitar': ['dale una vuelta entera', 'da la vuelta de dron'],
 'relieve_3d': ['quiero ver las montañas', 'activa la vista tridimensional'],
 'quitar_3d': ['ya no quiero relieve', 'apaga lo tridimensional'],
 'mas_mapa': ['que se vea más el mapa', 'agrándame el mapa'],
 'mas_chat': ['que se vea más la conversación', 'agrándame el chat'],
 'mitad': ['partido en dos', 'mitad y mitad la pantalla'],
 'pantalla_completa': ['ponlo a todo lo que da la pantalla', 'toda la pantalla'],
 'salir_pantalla': ['sácame de la pantalla completa', 'vuelve a la ventana normal'],
 'abrir_tablero': ['enséñame las cifras nacionales', 'abre el resumen de cifras'],
 'abrir_capas': ['despliégame las capas', 'el menú de las capas'],
 'abrir_expedientes': ['llévame a los archivos', 'la pestaña de archivos'],
 'abrir_infra': ['llévame a infraestructura', 'la pestaña de infraestructura'],
 'abrir_consulta': ['llévame al chat', 'la pestaña de chat'],
 'abrir_recorrido': ['quiero que me guíes por la plataforma', 'arranca el tutorial'],
 'fondo_satelite': ['ponle el fondo de satélite', 'quiero la foto de satélite'],
 'fondo_calles': ['ponle el fondo de calles', 'quiero el mapa de calles'],
 'mi_ubicacion': ['enséñame dónde ando', 'dónde ando yo'],
 'ver_pais': ['quiero ver honduras completa', 'la vista de todo el país'],
 'ficha_pdf': ['sácame el pdf de esta', 'quiero la ficha impresa de esta'],
 'mapa_geologico': ['dibújame la geología de esta', 'el mapa de geología de esta'],
 'timelapse': ['enséñame el cambio año por año de esta', 'pon el antes y después satelital'],
 'analizar': ['hazle un análisis a esta', 'evalúame esta concesión'],
 'manos_on': ['quiero manejarte con las manos', 'enciende el control de manos'],
 'manos_off': ['ya no quiero las manos', 'apágame el air touch'],
}
NINGUNA_PRUEBA = ['¿cuál concesión es la siguiente en vencer?', '¿qué hay al este de juticalpa?', '¿el 3d es exacto?', 'gira la economía alrededor del oro',
                  '¿cuántas solicitudes de exploración hay?', 'muéstrame la concesión el tule', 'llévame a la mina de san juan', 'perfecto, gracias',
                  '¿qué es la vista cenital?', '¿dónde queda catacamas?', 'arma la ficha de la concesión los pinares', 'sí, la primera']


NOMBRES = ['los almendros', 'el tule', 'san andrés', 'clavo rico', 'la esperanza', 'los pinares', 'el porvenir', 'concordia vi', 'nayla i',
           'cerro partido', 'san martín', 'la escalera', 'el naranjo', 'monserrat', 'el volcán', 'las joyas']
LUGARES = ['juticalpa', 'olancho', 'choluteca', 'santa bárbara', 'catacamas', 'gualaco', 'danlí', 'tegucigalpa', 'la unión', 'cortés', 'el paraíso']
TEMAS = ['la ley de oro', 'el titular', 'el expediente', 'el área', 'la fecha de vencimiento', 'los traslapes', 'la geología', 'el estado',
         'los caseríos cercanos', 'el área protegida', 'la prospectividad', 'la licencia ambiental', 'el canon', 'las muestras de jica']
PREGUNTAS = ['¿cuál es {t} de {n}?', '¿qué sabes de {t} de {n}?', 'dime {t} de {n}', '¿cuántas concesiones hay en {l}?', '¿qué concesiones hay en {l}?',
             'muéstrame {n}', 'llévame a {n}', 'acércate a {n}', 've a {l}', 'vuela a {n}', 'busca {n}', 'ábreme la ficha de {n}',
             'hazme la ficha en pdf de {n}', 'mapa geológico de {n}', 'analiza {n}', '¿dónde queda {l}?', '¿qué hay al norte de {l}?',
             '¿hay oro en {l}?', 'enséñame las concesiones de {l}', '¿{n} está vigente?', '¿quién tiene {n}?', 'compara {n} con {n2}',
             '¿{n} traslapa con {n2}?', 'timelapse de {n}', '¿cuándo vence {n}?', 'explícame {t}', '¿qué significa {t}?']


def ninguna_generada(r, n):
    out = set()
    while len(out) < n:
        a, b = r.sample(NOMBRES, 2)
        out.add(r.choice(PREGUNTAS).format(t=r.choice(TEMAS), n=a, n2=b, l=r.choice(LUGARES)))
    return sorted(out)


def sin_tildes(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def ruido(s, r):
    """Lo que deja el dictado o un usuario apurado: a veces sin tildes, sin signos, en mayúscula inicial."""
    if r.random() < 0.35:
        s = sin_tildes(s)
    if r.random() < 0.4:
        s = s.replace('¿', '').replace('?', '').replace(',', '').replace('...', '')
    if r.random() < 0.3:
        s = s[:1].upper() + s[1:]
    if r.random() < 0.15 and not s.endswith(('?', '.')):
        s += '.'
    return ' '.join(s.split())


def app_de(frase, accion):
    """La etiqueta del grupo `app` (AU-RA) de una frase de Electrum. No usa el azar: las frases no cambian."""
    if accion in ('pantalla_completa', 'salir_pantalla', 'mitad'):
        return 'app_presencia'
    if 'internet' in sin_tildes(frase.lower()) or 'en la web' in frase.lower():
        return 'app_buscar_internet'
    return 'app_ninguna'


def rellenar(p, r):
    return p.replace('{m}', r.choice(MAPA)).replace('{e}', r.choice(ESTA))


def generar(plantillas, ninguna, n_por, r):
    filas = []
    for accion, pl in plantillas.items():
        vistos = set()
        intentos = 0
        while len(vistos) < n_por and intentos < n_por * 20:
            intentos += 1
            base = rellenar(r.choice(pl), r)
            # Las órdenes cortas se dicen con y sin adornos; con dos adornos a la vez solo a veces.
            s = r.choice(PRE) + base + (r.choice(POST) if r.random() < 0.5 else '')
            s = ruido(s, r)
            if s.lower() in vistos:
                continue
            vistos.add(s.lower())
            filas.append({'q': s, 'e': [accion, app_de(s, accion)]})
    vistos = set()
    for base in ninguna:
        for _ in range(3):
            s = ruido(r.choice(['', '', '', 'doctor, ', 'oye, ', 'a ver, ', 'eh, ']) + base, r)
            if s.lower() not in vistos:
                vistos.add(s.lower())
                filas.append({'q': s, 'e': ['ninguna', app_de(s, 'ninguna')]})
    r.shuffle(filas)
    return filas


def escribir(nombre, filas):
    os.makedirs(DATOS, exist_ok=True)
    with open(os.path.join(DATOS, nombre), 'w', encoding='utf-8') as f:
        for x in filas:
            f.write(json.dumps(x, ensure_ascii=False) + '\n')
    print(nombre, len(filas))


if __name__ == '__main__':
    r = random.Random(20260929)
    escribir('train_a.jsonl', generar(T, NINGUNA + ninguna_generada(r, 520), 60, r))
    escribir('test.jsonl', generar(T_PRUEBA, NINGUNA_PRUEBA, 3, random.Random(7)))
