"""Genera los datos de Laya «windows»: qué MANO de AURA para Windows pidió la persona, en español
catracho/latino E INGLÉS, con entrenamiento, validación y prueba SIN FUGAS.

    python generar.py      # escribe ../datos/train_a.jsonl, val.jsonl, test.jsonl, bordes.jsonl

Cada frase lleva UNA etiqueta del grupo `win` (exclusivo). Además `l` (idioma: es/en) y `t` (la
plantilla de donde salió), que el entrenamiento ignora y que sirven para medir por idioma y para
comprobar que no hay fugas.

La lista de manos sale del código del .exe (windows/src/Aura.Windows/Manos.cs), no de la imaginación:
abrir una aplicación o una carpeta, buscar en internet, abrir una página, escribir en la ventana
activa, redactar un documento, mirar la pantalla (y guardar una captura), volumen y multimedia,
recordatorios en el notch, callar, pausar todo, abrir o esconder el chat, cambiar de avatar,
mostrar el escritorio y bloquear el equipo. Todo lo demás es `win_ninguna` y va al cerebro (Qwen).

Laya decide QUÉ mano; qué aplicación, qué búsqueda, qué texto o a qué hora lo sacan las reglas del
.exe (Aura.Windows.Core/Parametros.cs) o el cerebro. Las manos con efecto (escribir en otra ventana,
bloquear) siempre esperan el «sí».

SIN FUGAS, por construcción:
  · cada plantilla va a UN solo conjunto por su posición en la lista de su etiqueta e idioma;
  · lo que se rellena ({a} apps, {w} búsquedas, {s} sitios, {x} textos, {r} documentos, {h} horas,
    {t} tareas) también se reparte: la prueba usa valores que el entrenamiento no vio. Los
    vocabularios cerrados ({v} avatares, {d} carpetas de Windows) no se esconden: son todos conocidos;
  · los negativos se reparten igual, frase por frase;
  · al final se quitan del entrenamiento las frases casi idénticas a una de validación o prueba.

Solo biblioteca estándar y determinista (misma semilla → mismos archivos).
"""
import json
import os
import random
import re
import unicodedata

AQUI = os.path.dirname(os.path.abspath(__file__))
DATOS = os.path.join(AQUI, '..', 'datos')
SEMILLA = 20260930

PRE = {
    'es': ['', '', '', '', '', '', '', 'aura, ', 'oye aura, ', 'oye, ', 'a ver, ', 'eh, ', 'mire, ', 'porfa ', 'bueno, ', 'mira, ',
           'aura por favor, ', 'hey aura, ', 'ey, ', 'ok aura, ', 'este... ', 'vaya, ', 'claudio, ', 'antonio, ', 'mirá, ', 'ya, ', 'fijate, '],
    'en': ['', '', '', '', '', '', '', 'aura, ', 'hey aura, ', 'hey, ', 'ok, ', 'um, ', 'so, ', 'please ', 'can you ', 'could you ',
           'aura please, ', 'yo, ', 'alright, ', 'hey claudio, ', 'antonio, ', 'uh, ', 'okay aura, '],
}
POST = {
    'es': ['', '', '', '', '', '', ' por favor', ' porfa', ' pues', ' ahorita', ' gracias', ' dale', ' ya', ' si puedes', ' porfis', ' rapidito'],
    'en': ['', '', '', '', '', '', ' please', ' pls', ' thanks', ' now', ' right now', ' real quick', ' for me', ' thank you', ' ok'],
}

RELLENO = {
    'es': {
        'a': ['el bloc de notas', 'la calculadora', 'word', 'excel', 'powerpoint', 'chrome', 'edge', 'spotify', 'whatsapp', 'outlook', 'teams',
              'zoom', 'paint', 'el explorador de archivos', 'la configuración', 'visual studio code', 'photoshop', 'discord', 'telegram',
              'la cámara', 'el reloj', 'fotos', 'la tienda de microsoft', 'vlc', 'acrobat', 'notion', 'steam', 'el correo', 'el calendario',
              'firefox', 'obs', 'el administrador de tareas', 'la terminal', 'canva', 'capcut', 'onenote', 'el reproductor multimedia', 'autocad',
              'google earth', 'el panel de control'],
        'd': ['documentos', 'descargas', 'el escritorio', 'imágenes', 'la música', 'los videos', 'mis documentos', 'la carpeta de descargas',
              'mis fotos', 'la carpeta de imágenes', 'la carpeta del trabajo', 'onedrive', 'la carpeta de música', 'la papelera'],
        'w': ['las noticias de honduras', 'el precio del café', 'el clima en san pedro sula', 'quién ganó el partido', 'cómo está el dólar',
              'el horario del banco atlántida', 'la receta de las baleadas', 'el precio del oro', 'vuelos a roatán', 'hoteles en la ceiba',
              'el partido del olimpia', 'el tipo de cambio de hoy', 'cómo hacer una tabla dinámica', 'tutoriales de excel', 'restaurantes en tegucigalpa',
              'el pronóstico para choluteca', 'cómo sacar el rtn', 'requisitos para la visa', 'precio de laptops', 'las noticias de la selección',
              'cursos de inglés gratis', 'cómo instalar python', 'la tasa del banco central', 'farmacias de turno'],
        's': ['youtube', 'gmail', 'facebook', 'google drive', 'netflix', 'amazon', 'wikipedia', 'la página del banco', 'instagram', 'linkedin',
              'youtube.com', 'el correo de gmail', 'chatgpt', 'la página de la sar', 'mercado libre', 'el portal del hondutel', 'tiktok',
              'la página de la universidad', 'twitter', 'google maps', 'el drive', 'outlook.com'],
        'x': ['hola equipo, la reunión es a las tres', 'buenos días a todos', 'estimado licenciado', 'querida mamá', 'gracias por su tiempo',
              'nos vemos mañana', 'lista de compras: arroz, frijoles y tortillas', 'saludos cordiales', 'el informe está listo',
              'pendientes de hoy', 'feliz cumpleaños', 'atentamente josé', 'la junta se movió al jueves', 'hola, ya voy en camino',
              'por favor confirmar asistencia', 'el pago se hizo ayer', 'querido josé', 'reunión con el ingeniero a las diez'],
        'r': ['un correo para el banco pidiendo el estado de cuenta', 'una carta de renuncia', 'un resumen de la reunión', 'una propuesta para el cliente',
              'un mensaje de cumpleaños para mi mamá', 'un informe de ventas', 'una carta de recomendación', 'el acta de la junta',
              'un contrato de alquiler', 'un correo para el profe', 'una publicación para facebook', 'una cotización', 'un plan de trabajo',
              'una invitación para la fiesta', 'un memorando para el personal', 'una solicitud de permiso', 'un discurso corto',
              'una lista de pendientes para mañana', 'un reclamo para la empresa de luz', 'la descripción del producto'],
        'h': ['en 10 minutos', 'en media hora', 'en una hora', 'a las 5', 'a las cinco', 'a las 3 y media', 'en 20 minutos', 'a las 7 de la noche',
              'en 5 minutos', 'a las 12', 'en dos horas', 'a las 4:30', 'en quince minutos', 'a las 9', 'en 45 minutos', 'a las 8 de la mañana',
              'en un ratito', 'a las 2', 'en 3 minutos', 'a las 6 de la tarde'],
        't': ['tomar la pastilla', 'llamar a mi mamá', 'pagar la luz', 'la reunión con el ingeniero', 'apagar la estufa', 'mandar el informe',
              'la junta de las tres', 'sacar la basura', 'estirar las piernas', 'revisar el correo', 'tomar agua', 'la llamada con el cliente',
              'guardar el documento', 'recoger a los cipotes', 'pagar la tarjeta', 'la clase de inglés', 'descansar la vista', 'imprimir el contrato'],
        'v': ['claudio', 'aura', 'antonio', 'ant-onio', 'el guardián', 'los ojos', 'la hormiga', 'el zorro', 'la dorada'],
        'b': ['guardar', 'aceptar', 'cancelar', 'insertar', 'archivo', 'inicio', 'diseño', 'siguiente', 'enviar', 'imprimir', 'buscar', 'nuevo',
              'abrir', 'cerrar sesión', 'compartir', 'responder', 'descargar', 'continuar', 'revisar', 'vista', 'formato', 'ayuda', 'opciones',
              'agregar', 'editar', 'copiar', 'pegar', 'deshacer', 'reproducir', 'suscribirse'],
        'm': ['bad bunny', 'marc anthony', 'música para concentrarme', 'salsa', 'reguetón viejito', 'la de despacito', 'karol g', 'jazz tranquilo',
              'música cristiana', 'los tigres del norte', 'shakira', 'rock en español', 'música para dormir', 'juan luis guerra', 'bachata', 'la playlist de ejercicio'],
        'n': ['el informe de ventas', 'la factura de octubre', 'el contrato', 'mi currículum', 'las fotos del viaje', 'el presupuesto',
              'la cotización', 'el acta de la junta', 'la tarea de inglés', 'el plan de trabajo', 'el recibo de la luz', 'la presentación'],
    },
    'en': {
        'a': ['notepad', 'the calculator', 'word', 'excel', 'powerpoint', 'chrome', 'edge', 'spotify', 'whatsapp', 'outlook', 'teams', 'zoom',
              'paint', 'file explorer', 'settings', 'vs code', 'photoshop', 'discord', 'telegram', 'the camera app', 'the clock', 'photos',
              'the microsoft store', 'vlc', 'acrobat', 'notion', 'steam', 'mail', 'the calendar', 'firefox', 'obs', 'task manager', 'the terminal',
              'canva', 'onenote', 'media player', 'autocad', 'google earth', 'control panel'],
        'd': ['documents', 'downloads', 'the desktop', 'pictures', 'my music', 'videos', 'my documents', 'the downloads folder', 'my photos',
              'the pictures folder', 'the work folder', 'onedrive', 'the music folder', 'the recycle bin'],
        'w': ['the news', 'the weather in miami', 'who won the game', 'the dollar exchange rate', 'flights to roatan', 'hotels in la ceiba',
              'how to make a pivot table', 'excel tutorials', 'restaurants near me', 'the gold price', 'coffee prices', 'python install guide',
              'cheap laptops', 'free english courses', 'visa requirements', 'the forecast for tomorrow', 'best budget phones', 'nba scores',
              'how to fix a slow pc', 'baleada recipe', 'bitcoin price', 'local pharmacies open now'],
        's': ['youtube', 'gmail', 'facebook', 'google drive', 'netflix', 'amazon', 'wikipedia', 'my bank website', 'instagram', 'linkedin',
              'youtube.com', 'chatgpt', 'reddit', 'tiktok', 'twitter', 'google maps', 'the drive', 'outlook.com', 'github', 'the university site'],
        'x': ['hello team, the meeting is at three', 'good morning everyone', 'dear mr smith', 'thank you for your time', 'see you tomorrow',
              'shopping list: rice, beans and tortillas', 'best regards', 'the report is ready', 'to do today', 'happy birthday',
              'the board meeting moved to thursday', 'on my way', 'please confirm attendance', 'payment was sent yesterday', 'dear jose',
              'meeting with the engineer at ten'],
        'r': ['an email to the bank asking for my statement', 'a resignation letter', 'a summary of the meeting', 'a proposal for the client',
              'a birthday message for my mom', 'a sales report', 'a recommendation letter', 'the board minutes', 'a rental agreement',
              'an email to my teacher', 'a facebook post', 'a quote for the customer', 'a work plan', 'a party invitation', 'a memo for the staff',
              'a leave request', 'a short speech', 'a to do list for tomorrow', 'a complaint to the power company', 'the product description'],
        'h': ['in 10 minutes', 'in half an hour', 'in an hour', 'at 5', 'at five', 'at 3:30', 'in 20 minutes', 'at 7 pm', 'in 5 minutes', 'at noon',
              'in two hours', 'at 4:30', 'in fifteen minutes', 'at 9', 'in 45 minutes', 'at 8 am', 'in a bit', 'at 2', 'in 3 minutes', 'at 6 pm'],
        't': ['take my pill', 'call my mom', 'pay the power bill', 'the meeting with the engineer', 'turn off the stove', 'send the report',
              'the three o clock meeting', 'take out the trash', 'stretch my legs', 'check my email', 'drink water', 'the client call',
              'save the document', 'pick up the kids', 'pay the card', 'english class', 'rest my eyes', 'print the contract'],
        'v': ['claudio', 'aura', 'antonio', 'ant-onio', 'the guardian', 'the eyes', 'the ant', 'the fox', 'the golden one'],
        'b': ['save', 'ok', 'cancel', 'insert', 'file', 'home', 'design', 'next', 'send', 'print', 'search', 'new', 'open', 'sign out',
              'share', 'reply', 'download', 'continue', 'review', 'view', 'format', 'help', 'options', 'add', 'edit', 'copy', 'paste', 'undo', 'play', 'subscribe'],
        'm': ['bad bunny', 'taylor swift', 'focus music', 'salsa', 'old school reggaeton', 'despacito', 'karol g', 'chill jazz', 'worship music',
              'the beatles', 'shakira', 'lofi', 'sleep music', 'coldplay', 'bachata', 'my workout playlist'],
        'n': ['the sales report', 'the october invoice', 'the contract', 'my resume', 'the trip photos', 'the budget', 'the quote',
              'the board minutes', 'the english homework', 'the work plan', 'the power bill', 'the presentation'],
    },
}

# ── plantillas por etiqueta e idioma. El orden importa: la posición decide el conjunto. ─────────
P = {
 'win_abrir_app': {
  'es': ['abre {a}', 'ábreme {a}', 'abrime {a}', 'abrí {a}', 'pon {a}', 'ponme {a}', 'inicia {a}', 'arranca {a}', 'ejecuta {a}',
         'quiero usar {a}', 'necesito {a}', 'lánzame {a}', 'abre el programa {a}', 'entra a {a}', 'dale a {a}', 'prende {a}',
         'abre la aplicación de {a}', 'métete a {a}', 'sácame {a}', 'mostrame {a}', 'puedes abrir {a}', 'me abres {a}', 'abre {a} ahí',
         'échame {a}', 'búscame {a} y ábrelo'],
  'en': ['open {a}', 'launch {a}', 'start {a}', 'run {a}', 'fire up {a}', 'bring up {a}', 'pull up {a}', 'i need {a}', 'open up {a}',
         'get {a} open', 'load {a}', 'can you open {a}', 'i want to use {a}', 'boot up {a}', 'start the {a} app', 'show me {a}',
         'go to {a}', 'open the {a} program', 'get me {a}', 'kick off {a}', 'find {a} and open it', 'let me use {a}'],
 },
 'win_abrir_carpeta': {
  'es': ['abre {d}', 'ábreme {d}', 'muéstrame {d}', 'llévame a {d}', 've a {d}', 'enséñame {d}', 'quiero ver {d}', 'abre la carpeta {d}',
         'entra a {d}', 'mostrame {d}', 'ponme {d} en pantalla', 'dónde está {d}, ábrela', 'abrime {d}', 'vamos a {d}', 'abre {d} en el explorador',
         'mete {d}', 'llévame a la carpeta {d}', 'sácame {d}', 'necesito ver {d}', 'abre rápido {d}'],
  'en': ['open {d}', 'show me {d}', 'take me to {d}', 'go to {d}', 'open the folder {d}', 'pull up {d}', 'i want to see {d}', 'browse {d}',
         'open {d} in explorer', 'bring up {d}', 'navigate to {d}', 'let me see {d}', 'get me into {d}', 'open my {d}', 'jump to {d}',
         'show {d} folder', 'head to {d}', 'display {d}'],
 },
 'win_buscar_web': {
  'es': ['busca {w}', 'búscame {w}', 'busca en internet {w}', 'googlea {w}', 'investiga {w}', 'averigua {w}', 'busca en google {w}',
         'búscame en la web {w}', 'buscá {w}', 'qué dice internet de {w}, búscalo', 'haz una búsqueda de {w}', 'pon en google {w}',
         'busca en el navegador {w}', 'averíguame {w}', 'échale un ojo en internet a {w}', 'buscá en línea {w}', 'métete a google y busca {w}',
         'busca rápido {w}', 'encuéntrame en internet {w}', 'abre google con {w}'],
  'en': ['search {w}', 'search for {w}', 'google {w}', 'look up {w}', 'search the web for {w}', 'find online {w}', 'do a search for {w}',
         'look up online {w}', 'search google for {w}', 'browse for {w}', 'find me {w} on the internet', 'research {w}', 'check online {w}',
         'web search {w}', 'hit google for {w}', 'search the internet for {w}', 'look online for {w}', 'run a search on {w}'],
 },
 'win_abrir_web': {
  'es': ['abre {s}', 'entra a {s}', 'métete a {s}', 've a {s}', 'abre la página de {s}', 'llévame a {s}', 'ponme {s} en el navegador',
         'abre el sitio de {s}', 'quiero entrar a {s}', 'abrime {s} en chrome', 'abre {s} en el navegador', 'navega a {s}', 'cárgame {s}',
         'abre la web de {s}', 'vamos a {s}', 'pon la página {s}', 'ingresa a {s}', 'abre {s} en internet'],
  'en': ['open {s}', 'go to {s}', 'take me to {s}', 'open the {s} website', 'pull up {s}', 'load {s}', 'navigate to {s}', 'open {s} in the browser',
         'visit {s}', 'bring up {s} site', 'head over to {s}', 'open {s} in chrome', 'get me to {s}', 'browse to {s}', 'open up {s} online',
         'launch {s} in the browser'],
 },
 'win_escribir': {
  'es': ['pásalo al bloc de notas', 'escríbelo tú en word', 'ponlo en la ventana', 'pégalo en el documento', 'escribe esto: {x}', 'mete esto en el word: {x}', 'escribe {x}', 'escríbeme {x}', 'escribí {x}', 'escribe en el bloc de notas {x}', 'escribe en word {x}', 'teclea {x}', 'pon en el documento {x}',
         'escríbelo en la ventana', 'escribe eso en word', 'pásalo al bloc de notas', 'escribe esto donde está el cursor', 'dicta {x}',
         'anota en el documento {x}', 'escribe aquí {x}', 'ponlo en el word', 'pega eso en el documento', 'escribilo en el bloc', 'mete ese texto en word',
         'escribe lo que te digo: {x}', 'transcribe {x} en el documento', 'escribe en la ventana activa {x}', 'teclea eso en el documento'],
  'en': ['type {x}', 'write {x}', 'type this: {x}', 'write in notepad {x}', 'write in word {x}', 'put in the document {x}', 'type it into the window',
         'write that in word', 'paste it into notepad', 'type this where the cursor is', 'dictate {x}', 'enter {x} in the document',
         'type here {x}', 'put it in word', 'paste that in the document', 'insert that text into word', 'write what i say: {x}',
         'type into the active window {x}', 'type that into the doc', 'key in {x}'],
 },
 'win_redactar': {
  'es': ['créame {r}', 'haz {r}', 'escribime {r}', 'necesito que redactes {r}', 'échame una mano con {r}', 'preparame {r}', 'redáctame {r}', 'redacta {r}', 'hazme {r}', 'escríbeme {r}', 'prepárame {r}', 'ayúdame a redactar {r}', 'necesito {r}, redáctalo',
         'armame {r}', 'haz un borrador de {r}', 'crea {r}', 'escribe {r}', 'quiero que me hagas {r}', 'prepara un borrador de {r}',
         'hazme el documento de {r}', 'elabora {r}', 'arma {r}', 'me redactás {r}', 'podés escribirme {r}', 'genera {r}', 'componme {r}',
         'haceme {r}', 'saca un borrador de {r}'],
  'en': ['draft {r}', 'write me {r}', 'write up {r}', 'make me {r}', 'prepare {r}', 'help me write {r}', 'put together {r}', 'create {r}',
         'compose {r}', 'draw up {r}', 'can you write {r}', 'i need {r}, draft it', 'make a draft of {r}', 'generate {r}', 'whip up {r}',
         'build {r}', 'come up with {r}', 'prepare a draft of {r}', 'write a draft for {r}', 'type up {r}'],
 },
 'win_ver_pantalla': {
  'es': ['qué ves', 'mira lo que tengo abierto', 've la pantalla', 'dime qué está pasando en mi pantalla', 'lee lo que estoy viendo', 'mírala y explícame', 'qué dice este mensaje de la pantalla', 'revisa esta ventana', 'qué ves en mi pantalla', 'mira mi pantalla', 'lee mi pantalla', 'qué hay en la pantalla', 'fíjate en lo que tengo abierto', 'revisa mi pantalla',
         'mírame la pantalla y dime qué es', 'qué dice aquí en la pantalla', 'ayúdame con lo que estoy viendo', 'explícame lo que tengo en pantalla',
         'lee lo que dice la ventana', 'mira este error en la pantalla', 'dime qué ves en el monitor', 'analiza mi pantalla', 'échale un ojo a mi pantalla',
         'qué opinas de lo que tengo abierto', 'revisa lo que hay en el monitor', 'lee este documento que tengo abierto', 'mira esto',
         'checa la pantalla'],
  'en': ['what do you see', 'see my screen', 'look at what i have open', 'tell me what is happening on my screen', 'read what i am looking at', 'check this window', 'what do you see on my screen', 'look at my screen', 'read my screen', 'what is on the screen', 'check what i have open', 'check my screen',
         'look at the screen and tell me what it is', 'what does it say on the screen', 'help me with what i am looking at', 'explain what is on my screen',
         'read the window', 'look at this error on screen', 'analyze my screen', 'take a look at my screen', 'what do you think of what i have open',
         'read this document i have open', 'look at this', 'scan my screen'],
 },
 'win_captura': {
  'es': ['toma una captura de pantalla', 'haz una captura', 'sácale foto a la pantalla', 'captura la pantalla', 'guarda una captura', 'tómale screenshot',
         'hazme un pantallazo', 'screenshot', 'toma un pantallazo', 'captura lo que se ve', 'guarda la pantalla en imagen', 'saca una captura y guárdala',
         'toma foto de la pantalla', 'hazme screenshot de esto', 'capturá la pantalla', 'saca un screenshot'],
  'en': ['take a screenshot', 'screenshot', 'capture the screen', 'grab a screenshot', 'save a screenshot', 'snap the screen', 'take a screen capture',
         'screenshot this', 'capture what is on screen', 'save the screen as an image', 'take a picture of the screen', 'grab the screen',
         'get a screenshot', 'make a screenshot'],
 },
 'win_volumen_subir': {
  'es': ['sube el volumen', 'súbele', 'súbele al volumen', 'más volumen', 'más alto', 'no se oye, súbele', 'subí el volumen', 'ponle más volumen',
         'volumen más alto', 'aumenta el volumen', 'súbele un poco', 'dale más volumen', 'ponlo más fuerte', 'súbele a la música', 'sube el sonido',
         'que suene más fuerte', 'subile', 'más fuerte'],
  'en': ['turn it up', 'volume up', 'louder', 'turn up the volume', 'raise the volume', 'increase volume', 'crank it up', 'make it louder',
         'pump up the volume', 'a bit louder', 'turn the music up', 'more volume', 'boost the volume', 'up the volume'],
 },
 'win_volumen_bajar': {
  'es': ['bájale tantito', 'no tan alto', 'más bajito', 'muy fuerte, bájale', 'baja el volumen', 'bájale', 'bájale al volumen', 'menos volumen', 'más bajo', 'está muy alto, bájale', 'bajá el volumen',
         'ponle menos volumen', 'volumen más bajo', 'disminuye el volumen', 'bájale un poco', 'bájale a la música', 'baja el sonido',
         'que suene más suave', 'bajale', 'más quedito'],
  'en': ['not so loud', 'less loud', 'lower it', 'way too loud', 'turn it down', 'volume down', 'quieter', 'turn down the volume', 'lower the volume', 'decrease volume', 'make it quieter', 'a bit quieter',
         'turn the music down', 'less volume', 'reduce the volume', 'down the volume', 'too loud, turn it down'],
 },
 'win_silenciar': {
  'es': ['silencia la computadora', 'quita el sonido', 'pon en mute', 'mutea', 'mute', 'silencio total en la compu', 'apaga el sonido', 'sin sonido',
         'quítale el audio', 'silencia el volumen', 'ponle mute a la compu', 'desactiva el sonido', 'volumen en cero', 'apaga el audio',
         'vuelve a poner el sonido', 'quita el mute'],
  'en': ['mute the computer', 'mute', 'mute the sound', 'turn off the sound', 'kill the audio', 'no sound', 'silence the pc', 'volume to zero',
         'mute the volume', 'unmute', 'turn the sound back on', 'mute everything', 'cut the audio', 'mute audio'],
 },
 'win_multimedia_pausa': {
  'es': ['pausa la música', 'pon pausa a la canción', 'para la música', 'detén el video', 'dale play', 'reanuda la música', 'ponle play',
         'pausa el video', 'continúa la canción', 'pará la música', 'pon la música otra vez', 'play', 'pausa la canción', 'sigue con la música',
         'deten la reproducción', 'quita la pausa a la música'],
  'en': ['pause the music', 'pause the song', 'stop the music', 'pause the video', 'hit play', 'resume the music', 'play', 'resume playback',
         'continue the song', 'unpause the music', 'play the music again', 'pause playback', 'stop the video', 'pause spotify'],
 },
 'win_multimedia_siguiente': {
  'es': ['siguiente canción', 'pasa la canción', 'cambia de canción', 'la que sigue', 'salta esta canción', 'otra canción', 'pon la siguiente',
         'siguiente tema', 'adelanta la canción', 'la canción anterior', 'regresa a la canción anterior', 'quita esta canción', 'pásale',
         'cambia la rola'],
  'en': ['next song', 'skip this song', 'skip', 'next track', 'play the next one', 'change the song', 'skip track', 'previous song',
         'go back a song', 'another song', 'play the previous track', 'skip ahead'],
 },
 'win_recordar': {
  'es': ['recuérdame {t} {h}', 'recordame {t} {h}', 'avísame {h} de {t}', 'pon un recordatorio {h} para {t}', 'acuérdame de {t} {h}',
         '{h} recuérdame {t}', 'no me dejes olvidar {t} {h}', 'ponme una alarma {h} para {t}', 'hazme acordar de {t} {h}', 'avisame {h} que tengo {t}',
         'recordatorio {h}: {t}', 'pon una alerta {h} para {t}', 'que me avises {h} de {t}', 'agéndame {t} {h}', 'recuérdame {h} {t}',
         'avísame {h}', 'ponme un timer {h}', 'pon un temporizador {h}'],
  'en': ['remind me to {t} {h}', 'remind me {h} to {t}', 'set a reminder {h} to {t}', 'alert me {h} about {t}', 'don t let me forget to {t} {h}',
         'set an alarm {h} for {t}', 'ping me {h} about {t}', '{h} remind me to {t}', 'reminder {h}: {t}', 'nudge me {h} to {t}',
         'let me know {h} to {t}', 'give me a heads up {h} to {t}', 'set a timer {h}', 'remind me {h}', 'set a reminder for {t} {h}'],
 },
 'win_callar': {
  'es': ['ya párale', 'no sigas hablando', 'para, para', 'déjalo ahí', 'ya no hables', 'un momento, calla', 'corta ahí', 'ya entendí, para de hablar', 'cállate', 'calla', 'ya cállate', 'silencio', 'shh', 'basta', 'ya', 'para de hablar', 'deja de hablar', 'no hables más', 'ya estuvo',
         'suficiente', 'chito', 'detente', 'para', 'ya no digas nada', 'cállese', 'callate un rato', 'espera, no hables', 'para ya'],
  'en': ['ok stop', 'cut it', 'got it, stop talking', 'hold it', 'stop right there', 'no more', 'shut up', 'be quiet', 'quiet', 'stop talking', 'silence', 'shh', 'enough', 'that is enough', 'hush', 'stop', 'hold on stop talking',
         'zip it', 'no more talking', 'please stop', 'stop speaking', 'wait stop'],
 },
 'win_pausa': {
  'es': ['pausa general', 'no toques nada más', 'frena todo', 'quieta, no hagas nada', 'detente con todo', 'cancela todas las acciones', 'pausa todo', 'detén todo', 'para todas las acciones', 'modo pausa', 'no hagas nada más', 'congela todo', 'detén las acciones', 'ponte en pausa',
         'deja de hacer todo', 'cancela todo lo que estás haciendo', 'para todo ya', 'alto total', 'suspende todo', 'emergencia, para todo'],
  'en': ['pause all', 'freeze', 'do not touch anything else', 'hold everything', 'cancel all actions', 'pause everything', 'stop everything', 'stop all actions', 'pause mode', 'do not do anything else', 'freeze everything', 'halt all actions',
         'cancel everything you are doing', 'stop it all now', 'full stop', 'suspend everything', 'emergency stop'],
 },
 'win_abrir_chat': {
  'es': ['abre tu chat', 'déjame escribirte', 'muéstrame el chat', 'abre la ventana del chat', 'enséñame lo que me respondiste', 'despliega el chat', 'abre el chat', 'ábrete', 'muéstrate', 'abre la conversación', 'despliégate', 'quiero escribirte', 'abre el panel', 'enséñame el chat',
         'expándete', 'ábreme la ventana de aura', 'sal del notch', 'abre tu ventana', 'muéstrame lo que dijiste', 'abre el historial',
         'quiero ver la conversación', 'hazte grande'],
  'en': ['open your chat', 'let me type', 'open the chat window', 'show me your answer', 'expand the chat', 'open the chat', 'open up', 'show yourself', 'open the conversation', 'expand', 'i want to type to you', 'open the panel', 'show me the chat',
         'open your window', 'show me what you said', 'open the history', 'i want to see the conversation', 'get bigger', 'pop open'],
 },
 'win_ocultar': {
  'es': ['escóndete', 'ciérrate', 'cierra el chat', 'minimízate', 'recógete', 'vuelve al notch', 'cierra el panel', 'hazte chiquita',
         'quítate de la pantalla', 'cierra tu ventana', 'ocúltate', 'achícate', 'vete arriba', 'guarda el chat'],
  'en': ['hide', 'close the chat', 'minimize yourself', 'collapse', 'go back to the notch', 'close the panel', 'get small', 'get out of the way',
         'close your window', 'shrink', 'tuck yourself away', 'hide the chat'],
 },
 'win_avatar': {
  'es': ['ahora con {v}', 'que venga {v}', 'cámbiame a {v}', 'dame a {v}', 'prefiero a {v}', 'pon el avatar de {v}', 'llama a {v} al notch', 'cambia a {v}', 'ponme a {v}', 'quiero hablar con {v}', 'pásame a {v}', 'que salga {v}', 'cambia el avatar a {v}', 'usa a {v}',
         'ponte {v}', 'quiero a {v}', 'trae a {v}', 'que me atienda {v}', 'cámbiate por {v}', 'avatar {v}', 'mejor {v}'],
  'en': ['now {v}', 'bring in {v}', 'set the avatar to {v}', 'use the {v} avatar', 'i want {v}', 'switch to {v}', 'change to {v}', 'i want to talk to {v}', 'put {v} on', 'bring {v}', 'change the avatar to {v}', 'use {v}',
         'let me talk with {v}', 'swap to {v}', 'give me {v}', 'avatar {v}', 'i prefer {v}'],
 },
 'win_escritorio': {
  'es': ['muéstrame el escritorio', 'minimiza todo', 've al escritorio', 'esconde todas las ventanas', 'limpia la pantalla', 'baja todas las ventanas',
         'quiero ver el escritorio', 'minimiza todas las ventanas', 'despeja la pantalla', 'llévame al escritorio', 'quita todas las ventanas',
         'enséñame el escritorio'],
  'en': ['show the desktop', 'minimize everything', 'go to the desktop', 'hide all windows', 'clear the screen', 'minimize all windows',
         'i want to see the desktop', 'take me to the desktop', 'get rid of all the windows', 'show me my desktop'],
 },
 'win_bloquear': {
  'es': ['bloquea la computadora', 'bloquea la compu', 'bloquea la pantalla', 'bloquea el equipo', 'pon la pantalla de bloqueo', 'ya me voy, bloquea',
         'cierra la sesión con bloqueo', 'bloqueá la pc', 'asegura la compu', 'bloquea todo que me voy', 'pon el candado', 'bloquea windows'],
  'en': ['lock the computer', 'lock the pc', 'lock the screen', 'lock my computer', 'lock it up', 'i am leaving, lock the pc', 'lock windows',
         'secure the computer', 'lock the workstation', 'put the lock screen on'],
 },
 'win_pulsar': {
  'es': ['dale a {b}', 'dale clic a {b}', 'haz clic en {b}', 'pulsa {b}', 'presiona {b}', 'aprieta {b}', 'dale en {b}', 'pulsa el botón {b}',
         'haz clic en el botón {b}', 'abre la pestaña {b}', 'abre el menú {b}', 'selecciona {b}', 'dale al botón de {b}', 'presiona la opción {b}',
         'clic en {b}', 'haz click en {b}', 'apriétale a {b}', 'dale doble clic a {b}', 've a la pestaña {b}', 'toca el botón {b}'],
  'en': ['click {b}', 'click on {b}', 'press {b}', 'hit {b}', 'tap {b}', 'press the {b} button', 'click the {b} button', 'open the {b} tab',
         'open the {b} menu', 'select {b}', 'choose {b}', 'go to the {b} tab', 'hit the {b} button', 'click on the {b} option', 'double click {b}'],
 },
 'win_que_hay': {
  'es': ['qué botones hay', 'qué opciones hay aquí', 'qué puedo pulsar aquí', 'léeme los botones', 'dime los botones de esta ventana',
         'qué pestañas tiene', 'qué menús hay', 'qué puedo tocar aquí', 'qué controles tiene esta ventana', 'qué opciones me da esta pantalla',
         'dime qué puedo hacer en esta ventana', 'qué hay para pulsar'],
  'en': ['what buttons are there', 'what options are there', 'what can i click', 'read me the buttons', 'what tabs are there',
         'what menus are there', 'what controls does this window have', 'what can i do in this window', 'list the buttons', 'which buttons can i press'],
 },
 'win_ventana': {
  'es': ['cambia a {a}', 'pásame a {a}', 'vuelve a {a}', 'tráeme {a}', 'muéstrame la ventana de {a}', 'minimiza esta ventana', 'maximiza esta ventana',
         'cierra esta ventana', 'cierra {a}', 'minimiza {a}', 'maximiza la ventana', 'restaura la ventana', 'regresa a {a}', 'pon {a} al frente',
         'agranda esta ventana', 'achica esta ventana', 'cierra la ventana de {a}', 'quita esta ventana'],
  'en': ['switch to {a}', 'go back to {a}', 'bring up {a}', 'minimize this window', 'maximize this window', 'close this window', 'close {a}',
         'minimize {a}', 'restore the window', 'bring {a} to the front', 'make this window bigger', 'close the {a} window', 'show me the {a} window'],
 },
 'win_info': {
  'es': ['qué hora es', 'qué horas son', 'qué día es hoy', 'a cuánto estamos', 'cuánta batería me queda', 'cómo está la batería',
         'estoy conectado al cargador', 'cuánto espacio me queda en el disco', 'hay espacio en el disco', 'tengo internet', 'cómo está el wifi',
         'cómo está la compu', 'dime la hora', 'qué fecha es', 'cuánto espacio libre tengo', 'estoy conectada a internet'],
  'en': ['what time is it', 'what day is it', 'what is the date today', 'how much battery do i have', 'is it plugged in', 'how much disk space is left',
         'am i connected to the internet', 'is the wifi working', 'how is my pc', 'tell me the time', 'how much free space do i have', 'battery level'],
 },
 'win_portapapeles': {
  'es': ['lee lo que copié', 'qué copié', 'resume lo que copié', 'traduce lo que copié', 'explícame lo que tengo copiado', 'léeme el portapapeles',
         'revisa lo que copié', 'corrige lo que copié', 'qué dice lo que copié', 'mejora el texto que copié', 'lo que copié, resúmelo', 'pásame en limpio lo que copié'],
  'en': ['read what i copied', 'what did i copy', 'summarize what i copied', 'translate what i copied', 'read my clipboard', 'explain the clipboard',
         'fix what i copied', 'improve the text i copied', 'check my clipboard', 'what is in my clipboard'],
 },
 'win_abrir_archivo': {
  'es': ['abre el último archivo que descargué', 'abre la última descarga', 'ábreme lo último que bajé', 'abre el archivo {n}', 'busca el archivo {n}',
         'abre el documento {n}', 'encuéntrame el archivo {n}', 'abre mi archivo de {n}', 'ábreme el pdf de {n}', 'abre el excel de {n}',
         'busca el documento que se llama {n}', 'abre lo último que descargué'],
  'en': ['open my last download', 'open the last file i downloaded', 'open the file {n}', 'find the file {n}', 'open the document {n}',
         'open the pdf called {n}', 'find my file named {n}', 'open my latest download', 'open the excel file {n}', 'find the document {n}'],
 },
 'win_musica': {
  'es': ['qué está sonando', 'qué canción es esta', 'quién canta esta canción', 'cómo se llama esta canción', 'pon {m} en spotify', 'ponme {m} en youtube music',
         'reproduce {m} en spotify', 'pon música de {m}', 'busca {m} en spotify', 'ponme la canción de {m}', 'quiero escuchar {m} en spotify',
         'pon {m} en youtube', 'tócame {m} en spotify', 'qué estoy escuchando', 'reproduce la canción {m}', 'pon una playlist de {m} en spotify'],
  'en': ['what is playing', 'what song is this', 'who sings this', 'play {m} on spotify', 'put on {m} on youtube music', 'play some {m} on spotify',
         'search {m} on spotify', 'play the song {m}', 'i want to hear {m} on spotify', 'what am i listening to', 'play {m} on youtube', 'put on some {m}'],
 },
 'win_correo': {
  'es': ['léeme mis correos', 'tengo correos nuevos', 'revisa mi correo', 'cuántos correos tengo', 'resume mis correos', 'lee el último correo',
         'me llegó algún correo', 'qué correos tengo', 'revísame la bandeja de entrada', 'hay correos nuevos', 'resúmeme el correo', 'checa mi email'],
  'en': ['read my emails', 'do i have new email', 'check my email', 'how many emails do i have', 'summarize my inbox', 'read me the last email',
         'any new emails', 'what emails do i have', 'check my inbox', 'summarize my email'],
 },
 'win_agenda': {
  'es': ['qué tengo hoy', 'qué tengo mañana', 'cómo está mi agenda', 'cuál es mi próxima reunión', 'tengo reuniones hoy', 'qué hay en mi calendario',
         'léeme la agenda de hoy', 'qué tengo esta semana', 'cuándo es mi siguiente cita', 'dime mi agenda', 'tengo citas mañana', 'revisa mi agenda'],
  'en': ['what do i have today', 'what do i have tomorrow', 'what is on my calendar', 'when is my next meeting', 'do i have meetings today',
         'read my schedule', 'what do i have this week', 'my agenda today', 'next meeting', 'check my calendar'],
 },
}

# ── negativos: lo que NO es una mano (va al cerebro). Muchos se parecen a propósito. ──────────
NEG = {
 'es': [
  'hola aura', 'cómo estás', 'buenos días', 'gracias', 'qué hora es', 'cuéntame un chiste', 'qué es la fotosíntesis', 'quién fue francisco morazán',
  'cómo abro excel si no lo tengo instalado', 'ayer abrí word y se trabó', 'para qué sirve la calculadora científica', 'qué es mejor, word o google docs',
  'me gusta mucho spotify', 'mi jefe me pidió una carta de renuncia, qué hago', 'cómo se escribe una carta formal', 'qué debe llevar un informe de ventas',
  'escribí un correo ayer y no me contestaron', 'la música de ayer estuvo buena', 'el volumen de ventas subió este mes', 'qué opinas del clima',
  'recuerdas cómo se llama mi jefe', 'te acuerdas de lo que hablamos', 'quién ganó el mundial', 'cuánto es 25 por 4', 'dame ideas para el fin de semana',
  'explícame cómo funciona internet', 'qué significa rtn', 'mi computadora está lenta, por qué será', 'qué es una captura de pantalla', 'cómo bloqueo mi celular',
  'la pantalla de mi celular se quebró', 'estoy cansado', 'qué me recomiendas comer', 'cuál es la capital de francia', 'háblame de ti', 'cómo te llamas',
  'tengo una reunión mañana', 'mañana es el cumpleaños de mi mamá', 'mi correo es jose arroba gmail', 'la agenda de mi jefe está llena', 'ayer leí un correo raro', 'la carpeta azul está en la mesa', 'el escritorio de mi oficina es pequeño',
  'busqué eso ayer y no encontré nada', 'me cae bien claudio', 'quién es antonio', 'qué es un notch', 'dime algo bonito', 'estoy triste hoy',
  'qué tal te fue', 'cuánto cuesta word', 'resúmeme la historia de honduras', 'traduce hola al inglés', 'qué diferencia hay entre un pdf y un word',
  'no quiero abrir nada', 'no busques nada todavía', 'no escribas nada aún', 'no me recuerdes nada', 'no cambies de avatar', 'no subas el volumen',
  'cómo subo el volumen de mi celular', 'por qué no se oye el video', 'recomiéndame música', 'me encanta bad bunny', 'la música de ayer en la fiesta',
  'cuál es tu canción favorita', 'mañana hay que pagar la luz', 'olvidé pagar la tarjeta', 'mi mamá me llamó ayer', 'la página del banco no carga',
  'youtube está lento hoy', 'facebook me cerró la cuenta', 'gmail me pide contraseña', 'qué es chatgpt', 'sabes usar excel', 'puedes ver la pantalla de verdad',
  'qué puedes hacer', 'cómo funcionas', 'eres muy lista', 'te quiero aura', 'buenas noches', 'hasta luego', 'nos vemos', 'ok', 'sí', 'no', 'dale gracias',
  'y el clima para mañana', 'cuántos días tiene febrero', 'qué es un contrato de alquiler', 'mi hija tiene tarea de inglés', 'me duele la cabeza',
  'mi carro hace un ruido raro', 'cuál es el precio del oro hoy', 'qué noticias hay', 'cómo está el dólar hoy', 'qué opinas de mi idea', 'ayúdame a pensar',
  'tengo una duda', 'explícame esto', 'cómo le digo a mi jefe que me voy', 'qué le regalo a mi esposa', 'y tú qué harías', 'eso no era lo que pedí',
  'perfecto', 'excelente trabajo', 'está bien así', 'mejor no', 'espera que lo pienso', 'déjame ver', 'lo del bloc de notas era broma', 'no me gustó ese avatar',
  'el guardián da miedo', 'la hormiga es simpática', 'el zorro es chistoso', 'qué hiciste hoy', 'de qué hablamos ayer', 'resume lo que dije',
  'el botón de guardar no me funciona', 'ayer cerré word sin guardar', 'para qué sirve la pestaña insertar', 'a qué hora es la reunión',
  'mi batería del carro está mala', 'el disco de música de ayer', 'copié la tarea de mi compañero', 'descargué una película', 'qué hora es en madrid',
  'cómo se cierra una ventana en windows', 'la ventana de la cocina está rota', 'no cierres nada', 'no pulses nada todavía',
 ],
 'en': [
  'hello aura', 'how are you', 'good morning', 'thanks', 'what time is it', 'tell me a joke', 'what is photosynthesis', 'who was george washington',
  'how do i open excel if it is not installed', 'yesterday i opened word and it froze', 'what is a scientific calculator for', 'which is better, word or google docs',
  'i really like spotify', 'my boss asked for a resignation letter, what should i do', 'how do you write a formal letter', 'what goes in a sales report',
  'i wrote an email yesterday and nobody answered', 'the music yesterday was great', 'sales volume went up this month', 'what do you think about the weather',
  'do you remember my boss name', 'do you remember what we talked about', 'who won the world cup', 'what is 25 times 4', 'give me ideas for the weekend',
  'explain how the internet works', 'my computer is slow, why', 'what is a screenshot', 'how do i lock my phone', 'my phone screen cracked', 'i am tired',
  'what should i eat', 'what is the capital of france', 'tell me about yourself', 'what is your name', 'i have a meeting tomorrow', 'tomorrow is my mom birthday',
  'the blue folder is on the table', 'my office desk is small', 'i searched that yesterday and found nothing', 'i like claudio', 'who is antonio',
  'what is a notch', 'say something nice', 'i am sad today', 'how much does word cost', 'summarize the history of honduras', 'translate hello to spanish',
  'what is the difference between a pdf and a word file', 'do not open anything', 'do not search anything yet', 'do not type anything yet',
  'do not remind me of anything', 'do not change the avatar', 'do not turn the volume up', 'how do i turn up my phone volume', 'why is the video silent',
  'recommend me some music', 'i love taylor swift', 'what is your favorite song', 'the power bill is due tomorrow', 'i forgot to pay the card',
  'my mom called me yesterday', 'the bank website is not loading', 'youtube is slow today', 'facebook locked my account', 'what is chatgpt', 'can you use excel',
  'can you really see the screen', 'what can you do', 'how do you work', 'you are smart', 'i love you aura', 'good night', 'see you later', 'ok', 'yes', 'no',
  'and the weather tomorrow', 'how many days are in february', 'what is a rental agreement', 'my daughter has english homework', 'i have a headache',
  'what is the gold price today', 'any news', 'what do you think of my idea', 'help me think', 'i have a question', 'explain this', 'how do i tell my boss i quit',
  'what should i get my wife', 'what would you do', 'that is not what i asked', 'perfect', 'great job', 'that is fine', 'never mind', 'let me think',
  'the notepad thing was a joke', 'i did not like that avatar', 'the guardian is scary', 'what did you do today', 'what did we talk about yesterday',
  'the save button does not work', 'i closed word without saving yesterday', 'what is the insert tab for', 'what time is the meeting',
  'my car battery is dead', 'i copied my friend s homework', 'i downloaded a movie', 'what time is it in madrid', 'how do you close a window',
  'the kitchen window is broken', 'do not close anything', 'do not click anything yet',
 ],
}

# Bordes: difíciles a propósito, escritos a mano, solo para medir (nunca se entrenan).
BORDES = [
 ('abre la calculadora y después busca el precio del dólar', 'win_abrir_app', 'es'),
 ('no abras word, mejor busca cómo hacer una tabla', 'win_buscar_web', 'es'),
 ('qué es mejor para redactar, word o notion', 'win_ninguna', 'es'),
 ('recuérdame cómo se llamaba el ingeniero', 'win_ninguna', 'es'),
 ('escribe una carta de renuncia', 'win_redactar', 'es'),
 ('escribe hola mundo en el bloc de notas', 'win_escribir', 'es'),
 ('cállate y abre spotify', 'win_callar', 'es'),
 ('ayer me dijiste que bloqueara la compu', 'win_ninguna', 'es'),
 ('open youtube and play something', 'win_abrir_web', 'en'),
 ('remind me what the engineer is called', 'win_ninguna', 'en'),
 ('write a resignation letter', 'win_redactar', 'en'),
 ('type hello world in notepad', 'win_escribir', 'en'),
 ('what do you see', 'win_ver_pantalla', 'en'),
 ('qué ves', 'win_ver_pantalla', 'es'),
 ('bideo siguiente', 'win_multimedia_siguiente', 'es'),
 ('súbele tantito', 'win_volumen_subir', 'es'),
 ('abre la carpeta de descargas y la calculadora', 'win_abrir_carpeta', 'es'),
 ('cómo se hace una captura de pantalla en windows', 'win_ninguna', 'es'),
 ('lock screen please', 'win_bloquear', 'en'),
 ('mute that song', 'win_silenciar', 'en'),
 ('pausa', 'win_multimedia_pausa', 'es'),
 ('pon a claudio', 'win_avatar', 'es'),
 ('quién es mejor, claudio o antonio', 'win_ninguna', 'es'),
 ('buscame un buen restaurante', 'win_buscar_web', 'es'),
]

ETIQUETAS = ['win_ninguna'] + list(P.keys())


def sin_tildes(t):
    return ''.join(c for c in unicodedata.normalize('NFKD', t) if not (0x300 <= ord(c) <= 0x36f))


# Errores de dictado y de tecleo, como llegan de un micrófono de escritorio.
DICTADO_ES = [('v', 'b'), ('ll', 'y'), ('z', 's'), ('ce', 'se'), ('ci', 'si'), ('qu', 'k'), ('h', '')]
DICTADO_EN = [('ou', 'o'), ('ph', 'f'), ('ck', 'k'), ('the ', 'da '), ('you', 'u'), ('please', 'pls')]


def ruido(texto, l, rng):
    r = rng.random()
    if r < 0.30:
        texto = sin_tildes(texto)
    elif r < 0.40:
        a, b = rng.choice(DICTADO_ES if l == 'es' else DICTADO_EN)
        if a in texto:
            texto = texto.replace(a, b, 1)
    if rng.random() < 0.15:
        texto = texto.capitalize()
    if rng.random() < 0.12:
        texto = texto + rng.choice(['.', '?', '!', '...'])
    if rng.random() < 0.05:
        texto = texto.upper()
    return re.sub(r'\s+', ' ', texto).strip()


def conjunto(i):
    """0-6 → entrenamiento, 7 → validación, 8-9 → prueba (por posición)."""
    k = i % 10
    return 'train' if k < 7 else 'val' if k == 7 else 'test'


def repartir(valores):
    out = {'train': [], 'val': [], 'test': []}
    for i, v in enumerate(valores):
        k = i % 5
        out['train' if k < 3 else 'val' if k == 3 else 'test'].append(v)
    return out


# Vocabulario CERRADO: los avatares y las carpetas de Windows son los que son; el .exe los conoce todos.
# No tiene sentido esconderlos de entrenamiento (la prueba mediría nombres que nunca existirán).
CERRADOS = {'v', 'd', 'b'}


def rellenar(plantilla, l, destino, rng):
    def uno(m):
        clave = m.group(1)
        valores = RELLENO[l][clave] if clave in CERRADOS else (repartir(RELLENO[l][clave])[destino] or RELLENO[l][clave])
        return rng.choice(valores)
    return re.sub(r'\{(\w)\}', uno, plantilla)


def ngramas(t):
    t = '<' + re.sub(r'[^a-z0-9]+', ' ', sin_tildes(t.lower())).strip() + '>'
    return {t[i:i + 4] for i in range(len(t) - 3)}


def main():
    rng = random.Random(SEMILLA)
    filas = {'train': [], 'val': [], 'test': []}
    # Cuántas frases por plantilla: las que tienen hueco dan más variedad.
    for et, por_l in P.items():
        for l, plantillas in por_l.items():
            for i, pl in enumerate(plantillas):
                destino = conjunto(i)
                n = 34 if '{' in pl else 12
                if destino != 'train':
                    n = max(6, n // 3)
                vistas = set()
                for _ in range(n * 3):
                    if len(vistas) >= n:
                        break
                    q = rng.choice(PRE[l]) + rellenar(pl, l, destino, rng) + rng.choice(POST[l])
                    q = ruido(q, l, rng)
                    if q.lower() in vistas:
                        continue
                    vistas.add(q.lower())
                    filas[destino].append({'q': q, 'e': [et], 'l': l, 't': f'{et}/{l}/{i}'})
    for l, frases in NEG.items():
        for i, f in enumerate(frases):
            destino = conjunto(i)
            reps = 8 if destino == 'train' else 3
            vistas = set()
            for _ in range(reps * 3):
                if len(vistas) >= reps:
                    break
                q = ruido(rng.choice(PRE[l][:10]) + f, l, rng)
                if q.lower() in vistas:
                    continue
                vistas.add(q.lower())
                filas[destino].append({'q': q, 'e': ['win_ninguna'], 'l': l, 't': f'win_ninguna/{l}/{i}'})
    # Fuera del entrenamiento lo casi idéntico a validación/prueba/bordes.
    apartados = [ngramas(f['q']) for d in ('val', 'test') for f in filas[d]] + [ngramas(q) for q, _, _ in BORDES]
    limpio = []
    for f in filas['train']:
        g = ngramas(f['q'])
        if any(len(g & a) / max(1, len(g | a)) >= 0.8 for a in apartados if abs(len(a) - len(g)) <= len(g) * 0.4):
            continue
        limpio.append(f)
    quitadas = len(filas['train']) - len(limpio)
    filas['train'] = limpio
    for d in filas:
        rng.shuffle(filas[d])
    os.makedirs(DATOS, exist_ok=True)
    nombres = {'train': 'train_a.jsonl', 'val': 'val.jsonl', 'test': 'test.jsonl'}
    for d, nombre in nombres.items():
        with open(os.path.join(DATOS, nombre), 'w', encoding='utf-8') as fh:
            for f in filas[d]:
                fh.write(json.dumps(f, ensure_ascii=False) + '\n')
    with open(os.path.join(DATOS, 'bordes.jsonl'), 'w', encoding='utf-8') as fh:
        for q, et, l in BORDES:
            fh.write(json.dumps({'q': q, 'e': [et], 'l': l, 't': 'borde'}, ensure_ascii=False) + '\n')
    cuenta = {d: len(v) for d, v in filas.items()}
    print(f'etiquetas {len(ETIQUETAS)} · {cuenta} · bordes {len(BORDES)} · quitadas por parecidas {quitadas}')


if __name__ == '__main__':
    main()
