"""Genera los datos de AU-RA para Laya «comando»: las MANOS de AURA dichas en voz alta (grupo `app`).

    python generar_aura.py      # escribe ../datos/train_aura.jsonl y ../datos/test_aura.jsonl

El modelo «comando» es compartido: Dr Electrum lee el grupo `accion` (órdenes de su mapa) y AU-RA el
grupo `app` (sus manos: recordar, llamar, leer mensajes, buscar en los chats…). Cada frase lleva UNA
etiqueta de cada grupo; aquí casi todas llevan `accion: ninguna` (para Electrum no son órdenes de
pantalla), salvo «ponte a pantalla completa», que en los dos es poner la pantalla completa.

Qué trae cada frase, como se habla de verdad en Honduras: muletillas («eh», «a ver», «mire»), trato
(«AURA», «mi reina», «porfa»), habla catracha («dale pues», «vaya», «ahorita», «cipote»), inglés, y
lo que deja el dictado: sin tildes, sin signos, «b» por «v», el «a» que se come («llama mi mamá»),
palabras repetidas y «q» por «que». Los NEGATIVOS son frases parecidas que NO son orden («mi mamá me
llamó ayer», «recuérdame quién ganó el mundial», «ponte las pilas»): el modelo tiene que aprender la
diferencia, no la palabra.

La prueba (test_aura.jsonl) sale de OTRAS plantillas, otros nombres y otra semilla. bordes_aura.jsonl
lo escribe una persona (casos difíciles) y no se toca aquí.

Solo biblioteca estándar y determinista (misma semilla → mismos archivos).
"""
import json
import os
import random
import unicodedata

AQUI = os.path.dirname(os.path.abspath(__file__))
DATOS = os.path.join(AQUI, '..', 'datos')

PRE = ['', '', '', '', '', 'aura, ', 'oye aura, ', 'oye, ', 'a ver, ', 'eh, ', 'mire, ', 'porfa ', 'fíjate que ', 'bueno, ', 'mira, ',
       'aura por favor, ', 'hey aura, ', 'ey, ', 'ok aura, ', 'este... ', 'mi reina, ']
POST = ['', '', '', '', '', ' por favor', ' porfa', ' pues', ' ahorita', ' gracias', ' dale', ' ya', ' si puedes', ' porfis', ' please']

# Lo que cambia dentro de las plantillas (entrenamiento).
C = ['mi mamá', 'beto', 'la ana', 'mi esposa', 'mi hermano', 'don chepe', 'karla', 'el profe carlos', 'mi papá', 'la abuela', 'medardo',
     'mi jefe', 'la tía rosa', 'josé', 'mi hija', 'el licenciado', 'maría josé', 'mi compadre']
H = ['a las 5', 'a las cinco', 'a las 5 de la tarde', 'a las siete de la mañana', 'a las 3 y media', 'mañana a las 7', 'a las 9 de la noche',
     'en 20 minutos', 'en media hora', 'en una hora', 'a las 12', 'a la una', 'mañana temprano a las 6', 'a las 4:30', 'en diez minutos',
     'pasado mañana a las 8', 'a las 10 de la mañana']
X = ['tomar la pastilla', 'llamar a mi mamá', 'sacar la ropa', 'pagar la luz', 'la cita del doctor', 'ir al banco', 'recoger a los cipotes',
     'comprar tortillas', 'la reunión con el ingeniero', 'apagar la estufa', 'regar las matas', 'mandar el informe', 'darle de comer al perro',
     'el cumpleaños de karla', 'pagar el agua', 'la junta de las tres']
Q = ['la dirección', 'el número del doctor', 'la foto del recibo', 'lo de la reunión', 'el precio del terreno', 'la cuenta del banco',
     'donde dijeron lo del viaje', 'la receta', 'el código', 'la ubicación de la finca']
TEMAS_WEB = ['las noticias de honduras', 'el precio del café', 'el clima en san pedro sula', 'quién ganó el partido', 'las noticias de la selección',
             'cómo está el dólar', 'el horario del banco atlántida', 'qué pasó con el huracán', 'la receta de las baleadas']

T = {
 'app_recordar': ['recuérdame {h} {x}', 'recuérdame {x} {h}', 'avísame {h} que tengo que {x}', 'ponme un recordatorio para {x} {h}',
                  'pon un recordatorio {h} de {x}', 'que no se me olvide {x}, recuérdamelo {h}', 'recuérdame {h} lo de {x}',
                  'avísame {h} para {x}', 'remind me to {x} {h}', 'hazme acordar {h} de {x}', 'recordame {h} {x}', 'no me dejes olvidar {x} {h}'],
 'app_llamar_recordar': ['llámame {h} para recordarme {x}', 'márcame {h} y recuérdame {x}', 'llámame {h} para que no se me olvide {x}',
                         'hazme una llamada {h} para acordarme de {x}', 'timbrame {h} para recordarme {x}', 'llamame {h} que tengo que {x}',
                         'llámame {h} y me dices lo de {x}', 'call me {h} to remind me to {x}', 'dame una llamada {h} para {x}',
                         'márcame {h} para recordarme {x} que se me olvida'],
 'app_listar_recordatorios': ['¿qué recordatorios tengo?', 'mis recordatorios', '¿tengo recordatorios pendientes?', 'dime mis recordatorios',
                              'léeme los recordatorios', '¿qué me tienes que recordar?', '¿para cuándo tengo recordatorios?', 'muéstrame los recordatorios',
                              'what reminders do i have', '¿cuántos recordatorios tengo?', '¿qué avisos me pusiste?', '¿tengo algo pendiente que me recuerdes?'],
 'app_cancelar_recordatorio': ['cancela el recordatorio {h}', 'quita el recordatorio de {x}', 'borra el recordatorio {h}', 'ya no me recuerdes {x}',
                               'cancela el aviso de {x}', 'elimina el recordatorio de {x}', 'quita la llamada {h}', 'no me llames {h}, cancélalo',
                               'cancel the reminder {h}', 'borra el de {x}', 'cancela todos mis recordatorios', 'ya no necesito el recordatorio de {x}'],
 'app_llamar': ['llama a {c}', 'márcale a {c}', 'llámale a {c}', 'hazle una llamada a {c}', 'comunícame con {c}', 'quiero hablar con {c}, llámale',
                'dale una llamada a {c}', 'call {c}', 'llama {c}', 'márcale al celular a {c}', 'échale una llamada a {c}', 'llámame a {c}',
                'ponme en llamada con {c}', 'timbra a {c}'],
 'app_videollamar': ['hazle videollamada a {c}', 'videollamada con {c}', 'llama a {c} por video', 'quiero ver a {c}, hazle videollamada',
                     'márcale por video a {c}', 'video call {c}', 'videollama a {c}', 'ponme en video con {c}', 'bideollamada a {c}',
                     'hacé una videollamada a {c}', 'llamada con video a {c}', 'vídeo llamada con {c}'],
 'app_colgar': ['cuelga', 'cuelga la llamada', 'corta la llamada', 'termina la llamada', 'ya cuelga', 'colgá', 'hang up', 'cuélgale',
                'corta', 'terminá la llamada', 'cierra la llamada', 'ya, cuelga eso'],
 'app_leer': ['¿qué me dijo {c}?', 'léeme los mensajes de {c}', '¿tengo mensajes?', 'léeme mis mensajes', '¿qué me escribió {c}?',
              '¿me escribió {c}?', 'lee lo último de {c}', '¿hay mensajes nuevos?', 'léeme lo que me mandó {c}', 'what did {c} say',
              'read my messages', '¿qué dice el mensaje de {c}?', '¿alguien me escribió?', 'lee el chat de {c}'],
 'app_responder': ['respóndele que ya voy', 'contéstale a {c} que sí', 'respóndele a {c} que llego tarde', 'dile que ahorita le llamo',
                   'contéstale que gracias', 'respóndele que no puedo', 'reply that i am on my way', 'respóndele a {c} que mañana',
                   'contéstale que ya salí', 'dile a {c} que estoy manejando', 'mándale de respuesta que sí', 'respóndele con un ok'],
 'app_buscar_chats': ['busca en mis chats {q}', 'búscame el mensaje de {q}', 'busca en los mensajes {q}', '¿dónde me mandaron {q}?',
                      'encuentra en mis chats {q}', 'busca en las conversaciones {q}', 'search my chats for {q}', 'buscá en mis mensajes {q}',
                      'búscame en el chat {q}', '¿en qué chat está {q}?'],
 'app_silenciar_chat': ['silencia el chat de {c}', 'ya no me avises de {c}', 'mutea a {c}', 'pon en silencio el chat de {c}',
                        'que no suenen los mensajes de {c}', 'activa los avisos de {c}', 'desilencia el chat de {c}', 'mute {c}',
                        'quítale el silencio a {c}', 'no me notifiques los mensajes de {c}'],
 'app_idioma': ['háblame en inglés', 'cambia a español', 'speak english', 'switch to spanish', 'ponte en inglés', 'contéstame en español',
                'cambia el idioma a inglés', 'habla en inglés', 'volvamos al español', 'talk to me in english', 'pasate al inglés',
                'de ahora en adelante en español'],
 'app_perfil': ['dime chepe', 'llámame jefe', 'de ahora en adelante dime majo', 'vivo en san pedro sula', 'me mudé a tegucigalpa',
                'trabajo de maestra', 'mi cumpleaños es el 14 de marzo', 'me gusta el fútbol', 'mi comida favorita son las baleadas',
                'call me joe', 'soy ingeniero', 'tengo dos hijas', 'escucho música cristiana', 'decime chema', 'ahora vivo en la ceiba'],
 'app_presencia': ['ponte a pantalla completa', 'ponte al lado', 'hazte chiquita', 'ponte en grande', 'vuelve a caminar', 'ponte al lado del chat',
                   'hazte a un lado', 'go fullscreen', 'ponte pequeña', 'sal de pantalla completa', 'ponte grandota', 've a la esquina',
                   'achícate', 'ponte de frente en grande'],
 'app_buscar_internet': ['busca en internet {w}', 'búscame en google {w}', '¿qué dicen las noticias de {w}?', 'investiga {w}',
                         'averíguame {w}', 'search the web for {w}', 'buscá en internet {w}', 'googlea {w}', '¿qué dice internet sobre {w}?',
                         'dame las noticias de {w}', 'busca en la web {w}'],
}

# Frases parecidas que NO son una mano (app_ninguna). Muchas usan las mismas palabras.
NINGUNA = [
 'mi mamá me llamó ayer', '¿cómo se llama tu mamá?', 'me llamo josé', '¿quién me llamó?', 'la llamada estuvo buena', '¿te acuerdas de lo que te conté?',
 'recuerdo cuando fuimos a la playa', 'recuérdame quién ganó el mundial del 86', '¿me recuerdas cómo se hace el pan?', 'ponte las pilas',
 'ponte vivo', 'cuelga la ropa en el patio', 'voy a colgar el cuadro', 'beto me dijo que venía', '¿leíste el libro que te dije?',
 'busca la paz interior', '¿hablas inglés?', 'el inglés es difícil', 'mi perfil de facebook está feo', 'estoy viendo una película en pantalla completa',
 '¿cómo busco algo en internet?', 'mis hijas están en la escuela', 'el chat de la iglesia está bien activo', 'silencio en la sala',
 '¿qué hora es?', 'buenos días aura', 'gracias mi reina', '¿cómo estás?', 'cuéntame un chiste', '¿qué opinas del clima?', 'jaja qué risa',
 'ok', 'sí', 'no', 'dale', 'va pues', 'ajá', 'mmm', 'está bien', 'después te digo', 'ahorita vengo', 'espérame tantito',
 'el doctor me recetó una pastilla', 'mañana tengo cita', 'a las cinco sale mi hija', 'mi esposa trabaja en el banco',
 '¿cuánto cuesta una llamada internacional?', '¿se puede hacer videollamada desde la computadora?', '¿quién inventó el teléfono?',
 'mi hermano no contesta nunca', 'karla es mi mejor amiga', 'el profe carlos es bien estricto', 'no tengo saldo para llamar',
 'ayer hicimos videollamada con la abuela', 'los mensajes de voz son más fáciles', 'no me gusta que me llamen tarde',
 'recuerdos a tu mamá', 'se me olvidó el paraguas', 'nunca me acuerdo de los cumpleaños', 'qué bonito día', 'estoy cansado',
 '¿qué me recomiendas para cenar?', 'explícame qué es un recordatorio', '¿para qué sirve la pantalla completa?', 'responde la pregunta que te hice',
 'contéstame bien', 'dime algo bonito', 'dime la hora', 'dime qué piensas', 'háblame de dios', 'háblame de la historia de honduras',
 'cambia de tema', 'estoy en san pedro sula', 'vivo feliz', 'trabajo mucho', 'mi jefe es buena gente', 'me llamó la atención eso',
 '¿quién es beto?', 'la ana se casó', 'mándale saludos', 'escríbeme un poema', '¿cómo se dice hola en inglés?', 'traduce esto al inglés',
 '¿cuántos idiomas hablas?', 'mi mamá cumple años mañana', 'llama la atención que llueva tanto', 'hay que llamar a las cosas por su nombre',
 'what time is it', 'how are you', 'tell me a joke', 'i called my mom yesterday', 'my phone is dead', 'nice',
]

# ── la PRUEBA: otras plantillas, otros nombres ──────────────────────────────────────────────
C2 = ['mi prima', 'el doctor ramírez', 'la vecina', 'mi suegra', 'el pastor', 'lupita', 'mi cuñado', 'don ramón']
H2 = ['a las seis', 'a las 8 de la noche', 'mañana a las 9', 'en 15 minutos', 'en dos horas', 'a las 2 y cuarto']
X2 = ['llevar el carro al taller', 'tomar la medicina', 'la misa', 'pagar la tarjeta', 'hacer la tarea con la niña', 'llamar al banco']
Q2 = ['el contrato', 'la foto del carro', 'el correo del ingeniero', 'lo de la fiesta']
W2 = ['el precio del oro', 'las noticias de olancho', 'el partido del olimpia']
T_PRUEBA = {
 'app_recordar': ['acuérdame {h} de {x}', 'recuérdamelo {h}: {x}', 'mándame un recordatorio {h} para {x}'],
 'app_llamar_recordar': ['me llamas {h} para recordarme {x}', 'llámame {h}, es para {x}', 'quiero que me llames {h} para acordarme de {x}'],
 'app_listar_recordatorios': ['¿qué tengo agendado contigo?', 'repásame los recordatorios', 'list my reminders'],
 'app_cancelar_recordatorio': ['olvida el recordatorio de {x}', 'suprime el aviso {h}', 'ya no hace falta que me recuerdes {x}'],
 'app_llamar': ['echa una llamada a {c}', 'ponme con {c} por teléfono', 'marca a {c}'],
 'app_videollamar': ['quiero videollamada con {c}', 'conéctame por video con {c}', 'llámale con cámara a {c}'],
 'app_colgar': ['ya corta eso', 'finaliza la llamada', 'cuelga ya'],
 'app_leer': ['¿qué me contestó {c}?', 'dime qué me mandó {c}', 'léeme lo nuevo'],
 'app_responder': ['contéstale que ahí voy', 'respóndele a {c} que perfecto', 'ponle de respuesta que gracias'],
 'app_buscar_chats': ['revisa mis chats a ver si está {q}', '¿quién me mandó {q}?', 'búscame en las conversaciones {q}'],
 'app_silenciar_chat': ['calla las notificaciones de {c}', 'que no me moleste el chat de {c}', 'vuelve a activar los avisos de {c}'],
 'app_idioma': ['respóndeme en inglés', 'ya en español porfa', 'english please'],
 'app_perfil': ['mejor dime nacho', 'ahora trabajo en una ferretería', 'me encanta la música ranchera'],
 'app_presencia': ['ocupa toda la pantalla', 'quédate a mi lado', 'vuelve a ser chiquita'],
 'app_buscar_internet': ['búscame info de {w}', 'qué dicen en internet de {w}', 'averigua en la web {w}'],
}
NINGUNA_PRUEBA = ['me acordé de ti hoy', '¿cómo se llama el pastor?', 'la llamada se cortó sola ayer', 'no leo mensajes cuando manejo',
                  'ponte serio', 'recuérdame el nombre de esa canción', '¿en qué idioma rezas?', 'el chat está bien aburrido', 'qué buena la película',
                  '¿cuánto dura una llamada?', 'mi suegra vive en choluteca', 'lupita cumple quince años']


def sin_tildes(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def dictado(s, r):
    """Los errores del dictado: b por v, el «a» que se come, «q» por «que», una palabra repetida."""
    if r.random() < 0.12:
        s = s.replace('video', 'bideo').replace('vive', 'bibe').replace('llave', 'llabe')
    if r.random() < 0.15:
        s = s.replace('llama a ', 'llama ').replace('márcale a ', 'márcale ').replace('dile a ', 'dile ')
    if r.random() < 0.12:
        s = s.replace(' que ', ' q ').replace('¿qué ', '¿q ')
    if r.random() < 0.08:
        w = s.split(' ')
        i = r.randrange(len(w))
        w.insert(i, w[i])
        s = ' '.join(w)
    return s


def ruido(s, r):
    """Lo que deja el dictado o un usuario apurado: a veces sin tildes, sin signos, en mayúscula inicial."""
    s = dictado(s, r)
    if r.random() < 0.35:
        s = sin_tildes(s)
    if r.random() < 0.4:
        s = s.replace('¿', '').replace('?', '').replace(',', '').replace('...', '').replace(':', '')
    if r.random() < 0.3:
        s = s[:1].upper() + s[1:]
    if r.random() < 0.15 and not s.endswith(('?', '.')):
        s += '.'
    return ' '.join(s.split())


def rellenar(p, r, c, h, x, q, w):
    return p.replace('{c}', r.choice(c)).replace('{h}', r.choice(h)).replace('{x}', r.choice(x)).replace('{q}', r.choice(q)).replace('{w}', r.choice(w))


def accion_de_frase(etiqueta, frase):
    """Para Dr Electrum casi nada de esto es una orden de su mapa; «pantalla completa» sí lo es en los dos."""
    if etiqueta == 'app_presencia' and any(k in sin_tildes(frase.lower()) for k in ('pantalla completa', 'grande', 'fullscreen', 'toda la pantalla')):
        return 'pantalla_completa' if 'sal de' not in frase.lower() else 'salir_pantalla'
    return 'ninguna'


def generar(plantillas, ninguna, n_por, r, c, h, x, q, w):
    filas = []
    for etiqueta, pl in plantillas.items():
        vistos = set()
        intentos = 0
        while len(vistos) < n_por and intentos < n_por * 30:
            intentos += 1
            base = rellenar(r.choice(pl), r, c, h, x, q, w)
            s = r.choice(PRE) + base + (r.choice(POST) if r.random() < 0.5 else '')
            s = ruido(s, r)
            if s.lower() in vistos:
                continue
            vistos.add(s.lower())
            filas.append({'q': s, 'e': [accion_de_frase(etiqueta, s), etiqueta]})
    vistos = set()
    for base in ninguna:
        for _ in range(2):
            s = ruido(r.choice(['', '', '', 'aura, ', 'oye, ', 'a ver, ', 'eh, ', 'fíjate que ']) + base, r)
            if s.lower() not in vistos:
                vistos.add(s.lower())
                filas.append({'q': s, 'e': ['ninguna', 'app_ninguna']})
    r.shuffle(filas)
    return filas


def escribir(nombre, filas):
    os.makedirs(DATOS, exist_ok=True)
    with open(os.path.join(DATOS, nombre), 'w', encoding='utf-8') as f:
        for x in filas:
            f.write(json.dumps(x, ensure_ascii=False) + '\n')
    print(nombre, len(filas))


if __name__ == '__main__':
    escribir('train_aura.jsonl', generar(T, NINGUNA, 60, random.Random(20260930), C, H, X, Q, TEMAS_WEB))
    escribir('test_aura.jsonl', generar(T_PRUEBA, NINGUNA_PRUEBA, 4, random.Random(11), C2, H2, X2, Q2, W2))
