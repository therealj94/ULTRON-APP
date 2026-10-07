"""Genera los datos de AU-RA para Laya «comando» (grupo `app`): TODAS las manos de AURA en la app, en
español catracho/latino E INGLÉS, con entrenamiento, validación y prueba SIN FUGAS.

    python generar_app.py      # escribe ../datos/train_app.jsonl, val_app.jsonl, test_app.jsonl

Reemplaza a generar_aura.py (sus plantillas están aquí dentro, repartidas). Cada frase lleva UNA
etiqueta de cada grupo del modelo compartido: `accion` (Dr Electrum; aquí casi siempre `ninguna`) y
`app` (AU-RA). Además `l` (idioma: es/en) y `t` (la plantilla de donde salió), que evaluar.py ignora
y que sirven para medir por idioma y para comprobar que no hay fugas.

La lista de manos sale del código, no de la imaginación:
  · lib/acciones-app.ts (`AccionApp`): atrás, abrir pantalla (mesa/chats/ajustes/perfil), tema,
    avatar (AU-RA/Claudio/ANT-ONIO/Guardián), abrir un chat, redactar, enviar, descartar, silencio
    (callar y volver a hablar), presencia (completa/lado/paseo);
  · lib/manos-app.ts (`AccionMano`): llamar, videollamar, leer, buscar en los chats, idioma, perfil,
    recordatorio, recordatorio con llamada, listar y cancelar recordatorios;
  · el cerebro con su herramienta web: buscar en internet;
  · la mesa (mobile/src/lib/intenciones.ts): la cámara (visión) y la ayuda/tutorial;
  · las que ya tenía el grupo: colgar, responder, silenciar un chat.
NO existen en el código (y por eso no hay etiqueta): abrir otra app del teléfono, mover/rotar/acercar
el avatar con la voz.

SIN FUGAS, por construcción:
  · cada plantilla va a UN solo conjunto (unas a entrenamiento, otras a validación, otras a prueba),
    por su posición en la lista de su etiqueta e idioma;
  · lo que se rellena ({c} contactos, {h} horas, {x} tareas, {q} búsquedas, {w} temas web, {n}
    apodos, {l} lugares) también se reparte: la prueba usa nombres y horas que el entrenamiento no vio;
  · los negativos (frases que NO son orden) se reparten igual, frase por frase;
  · al final se quitan del entrenamiento las frases casi idénticas a una de validación o prueba
    (4-gramas de letras, Jaccard ≥ 0,8), por si dos plantillas distintas dan lo mismo.

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

# ── adornos: cómo se empieza y se termina una orden de verdad ─────────────────────────────────
PRE = {
    'es': ['', '', '', '', '', '', 'aura, ', 'oye aura, ', 'oye, ', 'a ver, ', 'eh, ', 'mire, ', 'porfa ', 'fíjate que ', 'bueno, ', 'mira, ',
           'aura por favor, ', 'hey aura, ', 'ey, ', 'ok aura, ', 'este... ', 'mi reina, ', 'vaya, ', 'claudio, ', 'antonio, ', 'mirá, ', 'ya, '],
    'en': ['', '', '', '', '', '', 'aura, ', 'hey aura, ', 'hey, ', 'ok, ', 'um, ', 'so, ', 'please ', 'can you ', 'could you ', 'aura please, ',
           'yo, ', 'alright, ', 'hey claudio, ', 'antonio, ', 'uh, ', 'okay aura, '],
}
POST = {
    'es': ['', '', '', '', '', ' por favor', ' porfa', ' pues', ' ahorita', ' gracias', ' dale', ' ya', ' si puedes', ' porfis', ' please', ' mi reina'],
    'en': ['', '', '', '', '', ' please', ' pls', ' thanks', ' now', ' right now', ' real quick', ' for me', ' thank you', ' ok'],
}

# ── lo que se rellena (se reparte entre entrenamiento, validación y prueba) ────────────────────
RELLENO = {
    'es': {
        'c': ['mi mamá', 'beto', 'la ana', 'mi esposa', 'mi hermano', 'don chepe', 'karla', 'el profe carlos', 'mi papá', 'la abuela', 'ramiro',
              'mi jefe', 'la tía rosa', 'josé', 'mi hija', 'el licenciado', 'maría josé', 'mi compadre', 'mi prima', 'el doctor ramírez', 'la vecina',
              'mi suegra', 'el pastor', 'lupita', 'mi cuñado', 'don ramón', 'mi hijo', 'la seño marta', 'kevin', 'la doña chayo'],
        'h': ['a las 5', 'a las cinco', 'a las 5 de la tarde', 'a las siete de la mañana', 'a las 3 y media', 'mañana a las 7', 'a las 9 de la noche',
              'en 20 minutos', 'en media hora', 'en una hora', 'a las 12', 'a la una', 'mañana temprano a las 6', 'a las 4:30', 'en diez minutos',
              'pasado mañana a las 8', 'a las 10 de la mañana', 'a las seis', 'a las 8 de la noche', 'mañana a las 9', 'en 15 minutos', 'en dos horas',
              'a las 2 y cuarto', 'el viernes a las 3', 'a las 11 de la noche', 'en 5 minutos'],
        'x': ['tomar la pastilla', 'llamar a mi mamá', 'sacar la ropa', 'pagar la luz', 'la cita del doctor', 'ir al banco', 'recoger a los cipotes',
              'comprar tortillas', 'la reunión con el ingeniero', 'apagar la estufa', 'regar las matas', 'mandar el informe', 'darle de comer al perro',
              'el cumpleaños de karla', 'pagar el agua', 'la junta de las tres', 'llevar el carro al taller', 'tomar la medicina', 'la misa',
              'pagar la tarjeta', 'hacer la tarea con la niña', 'llamar al banco', 'sacar la basura', 'la vacuna del niño', 'pasar por el pan'],
        'q': ['la dirección', 'el número del doctor', 'la foto del recibo', 'lo de la reunión', 'el precio del terreno', 'la cuenta del banco',
              'donde dijeron lo del viaje', 'la receta', 'el código', 'la ubicación de la finca', 'el contrato', 'la foto del carro',
              'el correo del ingeniero', 'lo de la fiesta', 'la clave del wifi'],
        'w': ['las noticias de honduras', 'el precio del café', 'el clima en san pedro sula', 'quién ganó el partido', 'las noticias de la selección',
              'cómo está el dólar', 'el horario del banco atlántida', 'qué pasó con el huracán', 'la receta de las baleadas', 'el precio del oro',
              'las noticias de olancho', 'el partido del olimpia', 'el tipo de cambio de hoy', 'cuándo juega el motagua', 'el pronóstico para la ceiba'],
        'n': ['chepe', 'jefe', 'majo', 'chema', 'nacho', 'la jefa', 'toño', 'capitán', 'pelón', 'licen', 'mi rey', 'profe'],
        'l': ['san pedro sula', 'tegucigalpa', 'la ceiba', 'choluteca', 'comayagua', 'danlí', 'juticalpa', 'santa rosa de copán', 'puerto cortés',
              'siguatepeque', 'roatán', 'el progreso'],
    },
    'en': {
        'c': ['my mom', 'beto', 'ana', 'my wife', 'my brother', 'karla', 'carlos', 'my dad', 'grandma', 'my boss', 'maria', 'my sister', 'jose',
              'my son', 'the doctor', 'uncle tony', 'lupita', 'my husband', 'my daughter', 'rosa', 'kevin', 'my cousin', 'pastor mike', 'the landlord'],
        'h': ['at 5', 'at five', 'at 5 pm', 'at 7 in the morning', 'at 3:30', 'tomorrow at 7', 'at 9 tonight', 'in 20 minutes', 'in half an hour',
              'in an hour', 'at noon', 'at 1', 'tomorrow morning at 6', 'at 4:30', 'in ten minutes', 'on friday at 3', 'at 10 am', 'at six',
              'at 8 pm', 'tomorrow at 9', 'in 15 minutes', 'in two hours', 'at 11 pm', 'in 5 minutes'],
        'x': ['take my pills', 'call my mom', 'take out the trash', 'pay the power bill', 'the doctor appointment', 'go to the bank',
              'pick up the kids', 'buy tortillas', 'the meeting with the engineer', 'turn off the stove', 'water the plants', 'send the report',
              'feed the dog', "karla's birthday", 'pay the water bill', 'the 3 o clock meeting', 'take the car to the shop', 'take my medicine',
              'go to church', 'pay the credit card', 'do homework with my daughter', 'call the bank', 'buy bread'],
        'q': ['the address', "the doctor's number", 'the receipt photo', 'the meeting stuff', 'the land price', 'the bank account', 'the recipe',
              'the code', 'the farm location', 'the contract', 'the car photo', "the engineer's email", 'the party details', 'the wifi password'],
        'w': ['news from honduras', 'the price of coffee', 'the weather in san pedro sula', 'who won the game', 'the national team news',
              'the dollar exchange rate', 'bank hours today', 'what happened with the hurricane', 'a recipe for baleadas', 'the gold price',
              'the latest tech news', 'when olimpia plays', 'the forecast for la ceiba', 'flights to miami'],
        'n': ['joe', 'boss', 'mj', 'captain', 'chief', 'doc', 'tony', 'buddy', 'champ', 'teach', 'big guy', 'sunshine'],
        'l': ['san pedro sula', 'tegucigalpa', 'houston', 'miami', 'la ceiba', 'new jersey', 'roatan', 'los angeles', 'choluteca', 'new york',
              'dallas', 'comayagua'],
    },
}

# ── las plantillas, por etiqueta e idioma ────────────────────────────────────────────────────
# Van a entrenamiento, validación o prueba según su posición (ver reparto()). Cada lista es de
# FORMAS distintas de pedir lo mismo, no de la misma frase con otra palabra.
T = {
 'app_atras': {
  'es': ['vete atrás', 'regresa', 'vuelve atrás', 'atrás', 'regrésate', 've para atrás', 'vamos atrás', 'regresa a la pantalla anterior',
         'cierra esto', 'sal de aquí', 'vuelve a donde estaba', 'cierra esta pantalla', 'regresa pa atrás', 'anda atrás', 'devuélvete',
         'llévame atrás', 'quita esta pantalla', 'volvé atrás', 'regresá', 'dale para atrás', 've a la anterior'],
  'en': ['go back', 'back', 'take me back', 'go back one screen', 'previous screen', 'close this', 'get out of here', 'back out',
         'return to the last screen', 'go to the previous page', 'close this screen', 'undo that screen', 'back up', 'return'],
 },
 'app_abrir': {
  'es': ['abre ajustes', 'abre los chats', 've a la mesa', 'abre mi perfil', 'llévame a los ajustes', 'muéstrame mis chats', 'abre la configuración',
         'quiero ver mis mensajes', 'entra a ajustes', 'enséñame lo que sabes de mí', 'ponme la pantalla principal', 'abre las conversaciones',
         've al inicio', 'llévame a mi perfil', 'abrime los chats', 'vamos a la mesa', 'métete a configuración', 'abre la pantalla de chats',
         've a preferencias', 'ábreme el perfil'],
  'en': ['open settings', 'open my chats', 'go to the desk', 'open my profile', 'take me to settings', 'show me my messages', 'go home',
         'open the conversations', 'show me what you know about me', 'go to the main screen', 'bring up settings', 'open the chat list',
         'take me to my profile', 'switch to the chats screen', 'open preferences'],
 },
 'app_tema': {
  'es': ['ponlo oscuro', 'modo oscuro', 'cambia a modo claro', 'pon el tema claro', 'ponlo en modo noche', 'activa el modo oscuro',
         'quiero la pantalla oscura', 'ponlo blanco', 'cambia el tema a oscuro', 'usa el tema del sistema', 'ponle el modo de día',
         'pon la app en negro', 'que se ponga oscura la app', 'ponlo automático como el teléfono', 'modo claro porfa'],
  'en': ['dark mode', 'turn on dark mode', 'switch to light mode', 'make it dark', 'light theme please', 'use the system theme',
         'set the theme to dark', 'make the app white', 'night mode on', 'go back to light mode', 'change the theme to light', 'match my phone theme'],
 },
 'app_avatar': {
  'es': ['cambia a claudio', 'pásame con aura', 'quiero hablar con antonio', 'pon al guardián', 'cambia a los ojos', 'ponme a claudio',
         'que salga ant-onio', 'pásame a au-ra', 'cambia de avatar a claudio', 'quiero a aura otra vez', 'háblame como claudio',
         'cambia el avatar', 'pon a antonio en la pantalla', 'regresa aura', 'que venga el guardián'],
  'en': ['switch to claudio', 'change to aura', 'let me talk to antonio', 'put the guardian on', 'switch avatar to claudio',
         'bring aura back', 'change the avatar', 'i want antonio', 'switch to the eyes', 'give me claudio', 'swap to aura', 'change avatar to antonio'],
 },
 'app_abrir_chat': {
  'es': ['abre el chat de {c}', 'ábreme la conversación con {c}', 'entra al chat de {c}', 'muéstrame el chat con {c}', 'llévame al chat de {c}',
         'abre lo de {c}', 'quiero ver el chat de {c}', 'abrí la conversación de {c}', 've al chat con {c}', 'pon el chat de {c}'],
  'en': ['open the chat with {c}', "open {c}'s chat", 'take me to my chat with {c}', 'show me the conversation with {c}', 'go to the {c} chat',
         'pull up my messages with {c}', 'open my conversation with {c}', 'bring up the chat with {c}'],
 },
 'app_redactar': {
  'es': ['escríbele a {c} que llego tarde', 'dile a {c} que ya voy', 'mándale un mensaje a {c} que {x}', 'avísale a {c} que no puedo ir',
         'escríbele a {c} que me llame', 'mandale a {c} que ya salí', 'redacta un mensaje para {c} diciendo que gracias', 'escríbele a {c}',
         'dile a {c} que {x}', 'envíale un mensaje a {c} que estoy en camino', 'ponle a {c} que llego en diez', 'textea a {c} que ya casi'],
  'en': ['text {c} that i am running late', 'tell {c} i am on my way', 'send {c} a message saying thanks', 'write to {c} that i cannot make it',
         'message {c} to call me back', 'let {c} know i left already', 'draft a message to {c}', 'send a text to {c} that i am outside',
         'write {c} a quick note that i will be late'],
 },
 'app_enviar': {
  'es': ['sí, envíalo', 'mándalo', 'envíalo ya', 'dale, mándalo', 'sí mándalo', 'envía el mensaje', 'manda el borrador', 'sí, envíaselo',
         'mandalo pues', 'envíalo así', 'ya, mándaselo', 'sí, envíalo por favor'],
  'en': ['yes send it', 'send it', 'send the message', 'go ahead and send it', 'yep send that', 'send the draft', 'yes, send it now',
         'ok send it', 'send that message'],
 },
 'app_descartar': {
  'es': ['bórralo', 'no lo mandes', 'descártalo', 'mejor no lo envíes', 'borra el borrador', 'olvídalo, no lo mandes', 'no, bórralo',
         'cancela el mensaje', 'no lo envíes', 'quita ese borrador', 'deséchalo'],
  'en': ["don't send it", 'delete it', 'discard the draft', 'scrap that message', 'no, delete it', 'cancel the message', 'never mind, dont send it',
         'throw that draft away', 'delete the draft'],
 },
 'app_callar': {
  'es': ['cállate', 'silencio', 'deja de hablar', 'ya no hables', 'shh', 'calla un rato', 'para de hablar', 'no hables más', 'guarda silencio',
         'ya cállate', 'chito', 'cállate un momento', 'deja de escuchar', 'para, para, para', 'espérate, no hables', 'silencio un ratito',
         'ya estuvo, cállate', 'no me interrumpas y cállate'],
  'en': ['shut up', 'be quiet', 'stop talking', 'quiet please', 'hush', 'silence', 'mute yourself', 'stop, stop', 'enough talking',
         'quiet for a minute', 'zip it', 'stop listening', 'hold on, stop talking', 'pause, be quiet'],
 },
 'app_hablar': {
  'es': ['ya puedes hablar', 'vuelve a hablar', 'despierta', 'vuelve a escucharme', 'ya habla', 'despiértate aura', 'ya te puedes quitar el silencio',
         'regresa, ya puedes hablar', 'quítate el silencio', 'actívate', 'ya, habla otra vez', 'escúchame de nuevo'],
  'en': ['you can talk now', 'unmute', 'wake up', 'start listening again', 'talk again', 'wake up aura', 'you can speak now', 'unmute yourself',
         'listen to me again'],
 },
 'app_presencia': {
  'es': ['ponte a pantalla completa', 'ponte al lado', 'hazte chiquita', 'ponte en grande', 'vuelve a caminar', 'ponte al lado del chat',
         'hazte a un lado', 'ponte pequeña', 'sal de pantalla completa', 'ponte grandota', 've a la esquina', 'achícate', 'ponte de frente en grande',
         'ocupa toda la pantalla', 'quédate a mi lado', 'vuelve a ser chiquita', 'ponte chiquito', 'minimízate', 'acóplate al lado'],
  'en': ['go fullscreen', 'go full screen', 'stay by my side', 'make yourself small', 'get bigger', 'walk around again', 'move to the side',
         'dock to the side of the chat', 'exit full screen', 'take the whole screen', 'shrink yourself', 'be small again', 'minimize yourself'],
 },
 'app_idioma': {
  'es': ['háblame en inglés', 'cambia a español', 'ponte en inglés', 'contéstame en español', 'cambia el idioma a inglés', 'habla en inglés',
         'volvamos al español', 'pasate al inglés', 'de ahora en adelante en español', 'respóndeme en inglés', 'ya en español porfa',
         'quiero practicar inglés, háblame en inglés'],
  'en': ['speak english', 'switch to spanish', 'talk to me in english', 'english please', 'change the language to spanish', 'reply in english',
         'speak spanish to me', 'go back to spanish', 'from now on english', 'can we switch to english'],
 },
 'app_perfil': {
  'es': ['dime {n}', 'llámame {n}', 'de ahora en adelante dime {n}', 'vivo en {l}', 'me mudé a {l}', 'trabajo de maestra', 'mi cumpleaños es el 14 de marzo',
         'me gusta el fútbol', 'mi comida favorita son las baleadas', 'soy ingeniero', 'tengo dos hijas', 'escucho música cristiana', 'decime {n}',
         'ahora vivo en {l}', 'mejor dime {n}', 'ahora trabajo en una ferretería', 'me encanta la música ranchera', 'cumplo años el 3 de julio'],
  'en': ['call me {n}', 'i live in {l}', 'i moved to {l}', 'my birthday is march 14', 'i work as a teacher', 'i like soccer',
         'my favorite food is baleadas', 'i am an engineer', 'from now on call me {n}', 'i have two daughters', 'i listen to gospel music',
         'my name is joe but call me {n}', 'i just moved to {l}'],
 },
 'app_recordar': {
  'es': ['recuérdame {h} {x}', 'recuérdame {x} {h}', 'avísame {h} que tengo que {x}', 'ponme un recordatorio para {x} {h}',
         'pon un recordatorio {h} de {x}', 'que no se me olvide {x}, recuérdamelo {h}', 'recuérdame {h} lo de {x}', 'avísame {h} para {x}',
         'hazme acordar {h} de {x}', 'recordame {h} {x}', 'no me dejes olvidar {x} {h}', 'acuérdame {h} de {x}', 'mándame un recordatorio {h} para {x}',
         'recuérdamelo {h}: {x}', 'programa un aviso {h} para {x}'],
  'en': ['remind me {h} to {x}', 'set a reminder {h} to {x}', "don't let me forget to {x} {h}", 'remind me to {x} {h}',
         'can you remind me {h} about {x}', 'put a reminder for {x} {h}', 'ping me {h} to {x}', 'set an alert {h} for {x}',
         'make sure i remember to {x} {h}', 'reminder {h}: {x}'],
 },
 'app_llamar_recordar': {
  'es': ['llámame {h} para recordarme {x}', 'márcame {h} y recuérdame {x}', 'llámame {h} para que no se me olvide {x}',
         'hazme una llamada {h} para acordarme de {x}', 'timbrame {h} para recordarme {x}', 'llamame {h} que tengo que {x}',
         'llámame {h} y me dices lo de {x}', 'dame una llamada {h} para {x}', 'me llamas {h} para recordarme {x}', 'llámame {h}, es para {x}',
         'quiero que me llames {h} para acordarme de {x}', 'márcame {h} para recordarme {x} que se me olvida'],
  'en': ['call me {h} to remind me to {x}', 'give me a call {h} so i remember to {x}', 'ring me {h} about {x}', 'call me {h} for {x}',
         'phone me {h} to remind me about {x}', 'can you call me {h} to remind me to {x}', 'wake me up with a call {h} to {x}',
         'call me {h} so i do not forget to {x}'],
 },
 'app_listar_recordatorios': {
  'es': ['¿qué recordatorios tengo?', 'mis recordatorios', '¿tengo recordatorios pendientes?', 'dime mis recordatorios', 'léeme los recordatorios',
         '¿qué me tienes que recordar?', '¿para cuándo tengo recordatorios?', 'muéstrame los recordatorios', '¿cuántos recordatorios tengo?',
         '¿qué avisos me pusiste?', '¿tengo algo pendiente que me recuerdes?', '¿qué tengo agendado contigo?', 'repásame los recordatorios'],
  'en': ['what reminders do i have', 'list my reminders', 'read me my reminders', 'do i have any reminders', 'show my reminders',
         'how many reminders do i have', 'what did you set for me', 'any reminders coming up', 'what are my alerts'],
 },
 'app_cancelar_recordatorio': {
  'es': ['cancela el recordatorio {h}', 'quita el recordatorio de {x}', 'borra el recordatorio {h}', 'ya no me recuerdes {x}',
         'cancela el aviso de {x}', 'elimina el recordatorio de {x}', 'quita la llamada {h}', 'no me llames {h}, cancélalo', 'borra el de {x}',
         'cancela todos mis recordatorios', 'ya no necesito el recordatorio de {x}', 'olvida el recordatorio de {x}', 'suprime el aviso {h}',
         'ya no hace falta que me recuerdes {x}'],
  'en': ['cancel the reminder {h}', 'delete the reminder about {x}', 'remove my reminder to {x}', 'no need to remind me to {x} anymore',
         'cancel all my reminders', 'drop the {h} reminder', 'forget the reminder about {x}', 'turn off the reminder {h}', 'cancel the call {h}'],
 },
 'app_llamar': {
  'es': ['llama a {c}', 'márcale a {c}', 'llámale a {c}', 'hazle una llamada a {c}', 'comunícame con {c}', 'quiero hablar con {c}, llámale',
         'dale una llamada a {c}', 'márcale al celular a {c}', 'échale una llamada a {c}', 'llámame a {c}', 'ponme en llamada con {c}',
         'timbra a {c}', 'echa una llamada a {c}', 'ponme con {c} por teléfono', 'marca a {c}', 'llama {c}', 'llamale a {c} porfa'],
  'en': ['call {c}', 'give {c} a call', 'phone {c}', 'dial {c}', 'ring {c}', 'get {c} on the phone', 'can you call {c}', 'make a call to {c}',
         'call {c} for me', 'place a call to {c}', 'i need to talk to {c}, call them'],
 },
 'app_videollamar': {
  'es': ['hazle videollamada a {c}', 'videollamada con {c}', 'llama a {c} por video', 'quiero ver a {c}, hazle videollamada',
         'márcale por video a {c}', 'videollama a {c}', 'ponme en video con {c}', 'bideollamada a {c}', 'hacé una videollamada a {c}',
         'llamada con video a {c}', 'vídeo llamada con {c}', 'quiero videollamada con {c}', 'conéctame por video con {c}', 'llámale con cámara a {c}'],
  'en': ['video call {c}', 'facetime {c}', 'start a video call with {c}', 'call {c} on video', 'i want to see {c}, video call them',
         'make a video call to {c}', 'video chat with {c}', 'set up a video call with {c}', 'call {c} with video'],
 },
 'app_colgar': {
  'es': ['cuelga', 'cuelga la llamada', 'corta la llamada', 'termina la llamada', 'ya cuelga', 'colgá', 'cuélgale', 'corta', 'terminá la llamada',
         'cierra la llamada', 'ya, cuelga eso', 'ya corta eso', 'finaliza la llamada', 'cuelga ya'],
  'en': ['hang up', 'end the call', 'hang up the call', 'end it', 'drop the call', 'disconnect the call', 'cut the call', 'stop the call'],
 },
 'app_leer': {
  'es': ['¿qué me dijo {c}?', 'léeme los mensajes de {c}', '¿tengo mensajes?', 'léeme mis mensajes', '¿qué me escribió {c}?', '¿me escribió {c}?',
         'lee lo último de {c}', '¿hay mensajes nuevos?', 'léeme lo que me mandó {c}', '¿qué dice el mensaje de {c}?', '¿alguien me escribió?',
         'lee el chat de {c}', '¿qué me contestó {c}?', 'dime qué me mandó {c}', 'léeme lo nuevo'],
  'en': ['what did {c} say', 'read my messages', 'read me the messages from {c}', 'do i have new messages', 'any new texts',
         'what did {c} text me', 'read the last message from {c}', 'did {c} write back', 'read me what {c} sent', 'check my messages'],
 },
 'app_responder': {
  'es': ['respóndele que ya voy', 'contéstale a {c} que sí', 'respóndele a {c} que llego tarde', 'dile que ahorita le llamo', 'contéstale que gracias',
         'respóndele que no puedo', 'respóndele a {c} que mañana', 'contéstale que ya salí', 'mándale de respuesta que sí', 'respóndele con un ok',
         'contéstale que ahí voy', 'respóndele a {c} que perfecto', 'ponle de respuesta que gracias'],
  'en': ['reply that i am on my way', 'answer {c} yes', 'reply to {c} that i will be late', 'write back that i will call later',
         'reply thanks', 'respond that i cannot', 'answer back ok', 'reply to {c} saying perfect'],
 },
 'app_buscar_chats': {
  'es': ['busca en mis chats {q}', 'búscame el mensaje de {q}', 'busca en los mensajes {q}', '¿dónde me mandaron {q}?', 'encuentra en mis chats {q}',
         'busca en las conversaciones {q}', 'buscá en mis mensajes {q}', 'búscame en el chat {q}', '¿en qué chat está {q}?',
         'revisa mis chats a ver si está {q}', '¿quién me mandó {q}?', 'búscame en las conversaciones {q}'],
  'en': ['search my chats for {q}', 'find {q} in my messages', 'look through my chats for {q}', 'where did someone send me {q}',
         'search my messages for {q}', 'which chat has {q}', 'find the message with {q}', 'who sent me {q}'],
 },
 'app_silenciar_chat': {
  'es': ['silencia el chat de {c}', 'ya no me avises de {c}', 'mutea a {c}', 'pon en silencio el chat de {c}', 'que no suenen los mensajes de {c}',
         'activa los avisos de {c}', 'desilencia el chat de {c}', 'quítale el silencio a {c}', 'no me notifiques los mensajes de {c}',
         'calla las notificaciones de {c}', 'que no me moleste el chat de {c}', 'vuelve a activar los avisos de {c}'],
  'en': ['mute {c}', 'mute the chat with {c}', 'turn off notifications for {c}', 'unmute {c}', 'silence messages from {c}',
         'stop notifying me about {c}', 'turn notifications back on for {c}', 'mute {c} for now'],
 },
 'app_buscar_internet': {
  'es': ['busca en internet {w}', 'búscame en google {w}', '¿qué dicen las noticias de {w}?', 'investiga {w}', 'averíguame {w}', 'buscá en internet {w}',
         'googlea {w}', '¿qué dice internet sobre {w}?', 'dame las noticias de {w}', 'busca en la web {w}', 'búscame info de {w}',
         'qué dicen en internet de {w}', 'averigua en la web {w}'],
  'en': ['search the web for {w}', 'google {w}', 'look up {w}', 'search online for {w}', 'find {w} on the internet', 'what does the internet say about {w}',
         'look up online {w}', 'search {w}', 'check the web for {w}', 'browse for {w}'],
 },
 'app_camara': {
  'es': ['activa la cámara', 'prende la cámara', 'enciende la visión', 'mírame', 'abre la cámara', 'activa la visión', 'apaga la cámara',
         'quita la cámara', 'desactiva la visión', 'ya no me mires, apaga la cámara', 'prende la visión', 'enciende la cámara para que me veas'],
  'en': ['turn on the camera', 'look at me', 'camera on', 'turn on vision', 'turn off the camera', 'camera off', 'disable the camera',
         'start the camera so you can see me', 'stop looking, camera off', 'enable vision'],
 },
 'app_ayuda': {
  'es': ['ayuda', 'tutorial', '¿qué puedes hacer?', 'comandos', '¿cómo te uso?', 'instrucciones', '¿cómo funcionas?', 'muéstrame lo que sabes hacer',
         'dame el tutorial', '¿qué cosas puedes hacer?', 'enséñame a usarte', '¿cómo funciona esto?', 'necesito ayuda con la app'],
  'en': ['help', 'what can you do', 'show me the tutorial', 'how do i use you', 'commands', 'instructions', 'how does this work',
         'what are you able to do', 'teach me how to use the app', 'i need help with the app'],
 },
}

# Más formas por etiqueta (van AL FINAL de cada lista: no cambian a qué conjunto va lo de arriba).
# Sobre todo las que más cuesta reconocer: otros verbos, otro orden, peticiones indirectas («¿me
# puedes…?», «quiero que…», «could you…», «i need you to…»).
MAS = {
 'app_atras': {
  'es': ['¿me regresas?', 'quiero volver atrás', 'ya salte de esa pantalla', 'regresame a lo de antes', 'vámonos para atrás', 'atrás porfa',
         'cierra eso que abriste', 'sácame de aquí', 'no, regresa', 'vuelve a la de antes'],
  'en': ['can you go back', 'i want to go back', 'get me out of this screen', 'back to where i was', 'go back please', 'close that',
         'take me back to the last one', 'exit this screen', 'no, go back', 'previous one'],
 },
 'app_abrir': {
  'es': ['¿me abres los ajustes?', 'quiero entrar a la configuración', 'pásame a los chats', 'llévame a la pantalla de inicio', 'abre lo de mis mensajes',
         'muéstrame la pantalla de perfil', 've a los ajustes', 'quiero ver la mesa', 'abre la configuración de la app', 'entra a mis chats',
         'regresa a la mesa', 'abre el inicio', '¿dónde están mis chats? ábrelos', 'ponme los ajustes', 'enséñame mi perfil'],
  'en': ['can you open settings', 'i want to see my chats', 'bring me to the home screen', 'open the app settings', 'show my profile',
         'go to my messages', 'take me to the desk', 'open the main screen', 'pull up my profile', 'get me to the settings',
         'go to the chats', 'open home'],
 },
 'app_tema': {
  'es': ['¿me pones el modo oscuro?', 'quiero la app en claro', 'ponle tema oscuro', 'que se vea blanco', 'modo noche porfa', 'cambia a oscuro',
         'pon el modo del sistema', 'quita el modo oscuro', 'ponlo en claro'],
  'en': ['can you switch to dark mode', 'i want light mode', 'turn off dark mode', 'dark theme', 'put it in dark mode', 'make it light',
         'use my phone setting for the theme', 'light mode'],
 },
 'app_avatar': {
  'es': ['déjame hablar con claudio', 'quiero platicar con antonio', 'pásame a hablar con aura', 'que me atienda claudio', 'cámbiame a antonio',
         'pon a aura', 'ahora quiero a claudio', 'que salga el guardián', 'cambia al avatar de antonio', 'quiero que me hable claudio'],
  'en': ['let me talk to claudio', 'i want to chat with antonio', 'put aura back on', 'switch me to claudio', 'can i talk to aura instead',
         'bring out the guardian', 'change to the antonio avatar', 'i want claudio now', 'use the guardian', 'talk to me as claudio'],
 },
 'app_abrir_chat': {
  'es': ['¿me abres el chat de {c}?', 'quiero ver lo que hablé con {c}', 'enséñame la conversación de {c}', 'entra a la conversación con {c}',
         'abre mis mensajes con {c}', 'pon la conversación con {c}'],
  'en': ["can you open {c}'s chat", 'i want to see my chat with {c}', 'open my messages with {c}', 'show me the chat with {c}',
         'go to my conversation with {c}'],
 },
 'app_redactar': {
  'es': ['¿le escribes a {c} que ya voy?', 'quiero mandarle un mensaje a {c}', 'mándale a {c} un mensaje que diga que {x}', 'avísale por mensaje a {c}',
         'escríbele a {c} diciendo que llego en diez', 'ponle un mensaje a {c} que ya salí', 'dile por el chat a {c} que me llame',
         'mándale un texto a {c}', 'redáctale a {c} que no puedo'],
  'en': ['can you text {c} that i am coming', 'i want to send {c} a message', 'send {c} a text saying i am outside', 'message {c} that i will call later',
         'shoot {c} a message that i am late', 'write a message to {c}', 'text {c} for me', 'drop {c} a line that i am here'],
 },
 'app_enviar': {
  'es': ['sí, mándaselo', 'envíaselo ya', 'ok, envíalo', 'así está bien, mándalo', 'perfecto, envíalo', 'dale, envíaselo'],
  'en': ['looks good, send it', 'perfect, send it', 'send it now', 'yes, send that', 'ok, send'],
 },
 'app_descartar': {
  'es': ['no, mejor bórralo', 'ya no lo mandes', 'descarta el mensaje', 'no lo envíes todavía, bórralo', 'bórralo mejor', 'quita ese mensaje'],
  'en': ['no, scrap it', 'forget that message, delete it', 'do not send that', 'get rid of the draft', 'delete that message'],
 },
 'app_callar': {
  'es': ['ya no hables', 'basta, cállate', 'cállate tantito', 'no hables ahorita', 'silencio porfa', 'ya estuvo de hablar', 'deja de hablar un rato',
         'shhh', 'ya no digas nada', 'espera, cállate'],
  'en': ['please be quiet', 'stop talking for a second', 'quiet down', 'shh', 'no more talking', 'stop, be quiet', 'hush now', 'enough, shut up'],
 },
 'app_hablar': {
  'es': ['quita el silencio', 'ya no estés callada', 'ya puedes hablar otra vez', 'desmutéate', 'sal del silencio', 'vuelve a hablarme',
         'ya, háblame', 'puedes volver a hablar', 'ya despertate', 'ya escúchame'],
  'en': ['you can talk again', 'unmute please', 'stop being quiet', 'you may speak', 'wake up please', 'talk to me again', 'start talking again'],
 },
 'app_presencia': {
  'es': ['ponte grande', 'ponte a mi lado', 'hazte pequeñita', 'quédate al ladito', 'ponte en toda la pantalla', 'quiero verte grande',
         'hazte chiquita otra vez', 'vete a la orillita', 'ponte al costado'],
  'en': ['make yourself big', 'stay next to me', 'go small', 'get on the side', 'fill the screen', 'i want to see you big', 'shrink down',
         'go to the corner'],
 },
 'app_idioma': {
  'es': ['en inglés porfa', 'habla español', 'quiero que me hables en inglés', 'cámbiate al español', 'ya no en inglés, en español'],
  'en': ['in spanish please', 'please speak english', 'i want you to talk in spanish', 'switch the language to english', 'no more spanish, english'],
 },
 'app_perfil': {
  'es': ['quiero que me digas {n}', 'a mí dime {n}', 'mi apodo es {n}', 'yo vivo en {l}', 'soy de {l}', 'mi cumple es el 2 de mayo',
         'trabajo en un banco', 'me encanta el café', 'mi equipo es el olimpia', 'soy enfermera', 'me dicen {n}'],
  'en': ['i want you to call me {n}', 'my nickname is {n}', 'i am from {l}', 'my birthday is may 2', 'i work at a bank', 'i love coffee',
         'my team is olimpia', 'i am a nurse', 'people call me {n}', 'i live near {l}'],
 },
 'app_recordar': {
  'es': ['¿me recuerdas {h} {x}?', 'quiero que me recuerdes {x} {h}', 'necesito que me avises {h} para {x}', 'agéndame {x} {h}',
         'pon una alarma {h} para {x}', 'recuérdame lo de {x} {h}', 'avísame {h}, es para {x}', 'no quiero olvidar {x}, avísame {h}'],
  'en': ['could you remind me to {x} {h}', 'i need a reminder {h} to {x}', 'set an alarm {h} to {x}', 'remind me about {x} {h}',
         'schedule a reminder to {x} {h}', 'i want you to remind me {h} to {x}', 'alert me {h} to {x}'],
 },
 'app_llamar_recordar': {
  'es': ['¿me llamas {h} para {x}?', 'necesito que me llames {h} para acordarme de {x}', 'llámame {h} por lo de {x}', 'dame un timbrazo {h} para {x}'],
  'en': ['could you call me {h} to remind me to {x}', 'i need a call {h} about {x}', 'call me {h} about {x}', 'give me a ring {h} to {x}'],
 },
 'app_listar_recordatorios': {
  'es': ['¿qué me toca hoy?', 'dime qué recordatorios hay', '¿qué tengo pendiente?', 'léeme mis avisos', '¿qué alarmas me pusiste?'],
  'en': ['what do i have pending', 'tell me my reminders', 'what alarms did you set', 'read my reminders', 'check my reminders'],
 },
 'app_cancelar_recordatorio': {
  'es': ['cancela lo de {x}', 'ya no me avises de {x}', 'quita el aviso {h}', 'borra el recordatorio de {x}', 'cancela la alarma {h}'],
  'en': ['cancel the {x} reminder', 'delete the alarm {h}', 'remove the reminder {h}', 'stop the reminder about {x}', 'kill the reminder {h}'],
 },
 'app_llamar': {
  'es': ['¿le marcas a {c}?', 'necesito hablar con {c}, márcale', 'llámame a {c} porfa', 'hazme el favor de llamar a {c}', 'comunícate con {c}',
         'ponte en contacto con {c} por teléfono', 'llama a {c} al celular', 'márcale a {c} de una vez'],
  'en': ['could you call {c}', 'please call {c}', 'i need you to call {c}', 'get me {c} on the line', 'call {c} right now', 'phone {c} for me'],
 },
 'app_videollamar': {
  'es': ['¿me haces videollamada con {c}?', 'quiero ver a {c} por video', 'llama a {c} con video', 'videollamada a {c} porfa'],
  'en': ['could you video call {c}', 'i want to facetime {c}', 'video call {c} please', 'call {c} over video'],
 },
 'app_colgar': {
  'es': ['ya cuelga porfa', 'corta ya', 'termina la llamada ya', 'cuelga esa llamada'],
  'en': ['hang up now', 'end this call', 'please hang up', 'hang up please'],
 },
 'app_leer': {
  'es': ['¿qué me mandaron?', '¿tengo algo nuevo?', 'lee lo que me escribieron', '¿qué dice {c}?', 'léeme el último mensaje', '¿hay algo de {c}?'],
  'en': ['what did they send me', 'anything new', 'read the new messages', 'what does {c} say', 'read me the last message', 'anything from {c}'],
 },
 'app_responder': {
  'es': ['contéstale que sí', 'dile que ya voy', 'respóndele que gracias', 'contéstale a {c} que ahorita', 'respóndele que está bien'],
  'en': ['reply yes', 'answer that i am coming', 'reply thank you', 'respond to {c} that it is fine', 'write back yes'],
 },
 'app_buscar_chats': {
  'es': ['busca {q} en mis chats', '¿quién me mandó {q}? búscalo', 'encuéntrame {q} en los mensajes', 'busca en el chat {q}', '¿dónde está {q} en mis mensajes?'],
  'en': ['find {q} in my chats', 'search my conversations for {q}', 'look for {q} in my messages', 'where is {q} in my chats'],
 },
 'app_silenciar_chat': {
  'es': ['silencia a {c}', 'que no me suene {c}', 'mutea el chat de {c}', 'quita las notificaciones de {c}'],
  'en': ['silence {c}', 'mute notifications from {c}', 'no more alerts from {c}', 'unmute the chat with {c}'],
 },
 'app_buscar_internet': {
  'es': ['búscame {w}', 'busca {w} en internet', '¿qué hay en internet de {w}?', 'investígame {w}', 'buscá {w} en google', 'averigua {w}',
         'quiero saber {w}, búscalo', 'mira en internet {w}'],
  'en': ['search for {w}', 'look {w} up online', 'find out {w}', 'google {w} for me', 'check online {w}', 'i want to know {w}, look it up'],
 },
 'app_camara': {
  'es': ['prende la cámara porfa', 'apaga la visión', 'que me veas, activa la cámara', 'quita la visión', 'ya no me veas'],
  'en': ['camera on please', 'turn the camera off', 'you can look at me', 'stop the camera', 'switch on the camera'],
 },
 'app_ayuda': {
  'es': ['¿qué sabes hacer?', 'dame ayuda', '¿cómo se usa esto?', 'explícame cómo usarte', 'muéstrame los comandos'],
  'en': ['what are your features', 'give me some help', 'how does the app work', 'show me the commands', 'what can i ask you'],
 },
}
# La LLAMADA DEL AVATAR (mobile/src/compa/llamadaCiclo.ts, lib/manos-app.ts `llamame`): «llámame» sin hora
# ni nombre es que el avatar llame a la persona AHORA (antes era la llamada de Twilio del taller y llevaba
# app_ninguna). Y los timers y despertadores son recordatorios con llamada (el avatar llama a esa hora).
T['app_llamame'] = {
 'es': ['llámame', 'hazme una llamada', 'márcame', 'llámame ahorita', 'dame una llamada', 'échame una llamada', 'tímbrame', '¿me llamas?',
        'quiero que me llames', 'llámame que quiero platicar', 'márcame un ratito', 'háblame por teléfono', '¿me puedes llamar?', 'llámame tú',
        'necesito que me llames ya', 'ponte en llamada conmigo', 'hablemos por llamada', 'llámame al celular', 'dame un timbrazo', 'márcame vos',
        'llámame porfa que me aburro', 'quiero hablar contigo por llamada', 'hazme una llamadita', 'llámame un rato'],
 'en': ['call me', 'give me a call', 'call me now', 'ring me', 'phone me', 'can you call me', 'call me right now', 'give me a ring',
        "let's talk on a call", 'start a call with me', 'call me up', 'i want you to call me', 'call me please i am bored', 'hop on a call with me',
        'could you give me a call', 'call my phone', 'i need you to call me now', 'call me real quick'],
}
MAS['app_llamar_recordar']['es'] = MAS['app_llamar_recordar']['es'] + [
 'ponme un timer de 10 minutos', 'pon un temporizador de cinco minutos', 'despiértame {h}', 'timer de media hora', 'activa un temporizador de 20 minutos para {x}',
 'hazme un timer de una hora', 'cuenta regresiva de 15 minutos', 'despiértame mañana a las 6', 'programa un timer de 3 minutos para los huevos', 'levántame {h}',
 'pon el temporizador de 40 minutos', 'despiértame {h} que tengo que {x}']
MAS['app_llamar_recordar']['en'] = MAS['app_llamar_recordar']['en'] + [
 'set a timer for 10 minutes', 'start a 5 minute timer', 'timer for half an hour', 'wake me up {h}', 'set a timer for 20 minutes to {x}',
 'countdown 15 minutes', 'wake me up tomorrow at 6', 'set a 3 minute timer for the eggs', 'wake me {h} so i can {x}']

for _e, _d in MAS.items():
    for _l, _ps in _d.items():
        T[_e][_l] = T[_e][_l] + _ps

# Frases que NO son una mano (app_ninguna): charla, preguntas, cosas que se cuentan, modismos, y las
# que se PARECEN a una orden (misma palabra, otro sentido). Se reparten frase por frase.
NINGUNA = {
 'es': [
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
  '¿quién es beto?', 'la ana se casó', 'escríbeme un poema', '¿cómo se dice hola en inglés?', 'traduce esto al inglés',
  '¿cuántos idiomas hablas?', 'mi mamá cumple años mañana', 'llama la atención que llueva tanto', 'hay que llamar a las cosas por su nombre',
  'me acordé de ti hoy', '¿cómo se llama el pastor?', 'la llamada se cortó sola ayer', 'no leo mensajes cuando manejo', 'ponte serio',
  'recuérdame el nombre de esa canción', '¿en qué idioma rezas?', 'el chat está bien aburrido', 'qué buena la película', '¿cuánto dura una llamada?',
  'mi suegra vive en choluteca', 'lupita cumple quince años', 'regresé ayer de viaje', 'atrás de la casa hay un palo de mango', 'vete a saber',
  'no hay vuelta atrás', 'abre tu corazón', 'el tema de hoy en la iglesia fue bonito', 'el modo de hacer las cosas importa', 'cambia el mundo, empieza por ti',
  'la cámara de mi cel es mala', 'tomé una foto con la cámara nueva', 'necesito ayuda con la tarea de matemáticas', 'ayúdame a pensar un nombre para mi negocio',
  '¿qué significa claudio?', 'mi sobrino se llama antonio', 'el guardián de la escuela es buena gente', 'la película avatar me gustó',
  'estoy callado porque estoy triste', 'mi hijo no se calla nunca', 'el silencio de la noche', 'la pantalla del cel se me quebró',
  'me gusta el modo en que hablas', 'oscuro está afuera, va a llover', 'la mesa de la cocina está sucia', 'mis ajustes de la moto están mal',
  'mi perfil profesional', 'se me borró el mensaje sin querer', 'mandé el paquete ayer', 'no envíes nada todavía, primero pensemos',
  '¿cómo se envía un mensaje?', '¿qué es mejor, llamar o escribir?', 'el internet está lento hoy', '¿tienes internet?', 'busqué y no encontré nada',
  'mis chats están llenos de memes', 'la seño marta es mi vecina', 'kevin está en la universidad', 'la doña chayo vende baleadas',
  'eso me recuerda a mi abuelo', 'cancela', 'no, espera', 'todavía no', 'luego lo vemos', 'olvídalo, no era nada', 'ya se me olvidó qué te iba a decir',
  'regrésame la plata que te presté jaja', '¿regresaste a la casa?', 'me mudé hace dos años', 'la ropa está oscura', 'qué claro se ve el cielo',
  'mi cámara de seguridad no graba', 'dile a tu jefe que eres buena', 'el mensaje de la película era bonito', 'la tele está en silencio',
  '¿y tú qué haces en tu tiempo libre?', '¿me quieres?', 'qué calor hace', 'tengo hambre', 'buenas noches aura', 'hasta mañana', 'te quiero mucho',
 ],
 'en': [
  'my mom called me yesterday', "what's your mom's name", 'my name is joe', 'who called me', 'the call went great', 'do you remember what i told you',
  'i remember when we went to the beach', 'remind me who won the world cup in 86', 'hang the clothes outside', 'i am going to hang the picture',
  'beto told me he was coming', 'did you read the book i told you about', 'do you speak english', 'english is hard', 'my facebook profile looks bad',
  'i am watching a movie in full screen', 'how do i search something online', 'my daughters are at school', 'what time is it', 'good morning aura',
  'thanks', 'how are you', 'tell me a joke', 'what do you think about the weather', 'haha that is funny', 'ok', 'yes', 'no', 'sure', 'uh huh',
  'hmm', 'sounds good', 'i will tell you later', 'be right back', 'the doctor gave me a pill', 'i have an appointment tomorrow',
  'my wife works at the bank', 'how much is an international call', 'can you video call from a computer', 'who invented the telephone',
  'my brother never answers', 'karla is my best friend', 'i have no minutes left to call', 'we video called grandma yesterday',
  'voice messages are easier', 'i hate late calls', 'i forgot my umbrella', 'i never remember birthdays', 'what a nice day', 'i am tired',
  'what should i have for dinner', 'explain what a reminder is', 'what is full screen for', 'answer the question i asked', 'say something nice',
  'tell me what you think', 'tell me about god', 'tell me about the history of honduras', 'change the subject', 'i am in san pedro sula',
  'i work a lot', 'my boss is a nice guy', 'who is beto', 'ana got married', 'write me a poem', 'how do you say hello in spanish',
  'translate this to spanish', 'how many languages do you speak', 'it is my mom birthday tomorrow', 'i thought of you today', 'the call dropped yesterday',
  'i do not read texts while driving', 'get serious', 'that chat is boring', 'what a good movie', 'how long does a call last', 'i came back from a trip yesterday',
  'there is a mango tree behind the house', 'there is no going back', 'open your heart', 'the topic at church was nice', 'change the world, start with you',
  'my phone camera is bad', 'i took a photo with the new camera', 'i need help with my math homework', 'help me think of a name for my business',
  'what does claudio mean', 'my nephew is named antonio', 'the school guard is a nice guy', 'i liked the movie avatar', 'my son never stops talking',
  'the silence of the night', 'my phone screen cracked', 'i like the way you talk', 'it is dark outside, it is going to rain', 'the kitchen table is dirty',
  'i deleted the message by accident', 'i sent the package yesterday', 'do not send anything yet, lets think first', 'how do you send a message',
  'is it better to call or text', 'the internet is slow today', 'do you have internet', 'i searched and found nothing', 'my chats are full of memes',
  'that reminds me of my grandpa', 'cancel', 'no, wait', 'not yet', 'we will see later', 'never mind, it was nothing', 'did you get home ok',
  'i moved two years ago', 'the sky looks so clear', 'my security camera is not recording', 'the message of the movie was beautiful', 'the tv is muted',
  'what do you do in your free time', 'do you love me', 'it is so hot', 'i am hungry', 'good night aura', 'see you tomorrow', 'i love you',
  'call it a day', 'let me call you back later, i am busy', 'back in my day things were different', 'my settings at work are a mess',
 ],
}

# Más negativos: peticiones indirectas que NO son manos («¿me puedes explicar…?», «could you tell me…»)
# y frases con las palabras de las manos en otro sentido.
NINGUNA['es'] += [
 '¿me puedes explicar cómo funciona la bolsa?', 'quiero que me cuentes un cuento', 'necesito que me aconsejes', '¿me ayudas a pensar?',
 '¿me dices qué opinas?', 'quiero saber más de ti', 'déjame pensarlo', 'mi mamá quiere hablar contigo', 'ya volví del trabajo',
 'estoy en la mesa comiendo', 'los ajustes de precio subieron', 'me cambié de ropa', 'la llamada de dios', 'me gustan los días claros',
 'el oscuro de la noche me da miedo', 'hablé con beto ayer', '¿sabes quién es claudio?', 'antonio es mi compadre', 'le escribí a mi hija ayer',
 'el mensaje llegó tarde', 'ya lo envié yo', 'me borraron del grupo', 'busqué trabajo toda la semana', 'mi hija me enseñó a usar el celular',
 'la cámara lenta se ve bonita', 'no quiero hablar de eso', 'cállate vos jaja no te creo', 'qué silencio tan raro', 'estoy callada hoy',
 'mi perfil de whatsapp', 'el tema de la reunión fue el presupuesto', 'me mudé a otra casa y estoy feliz', 'la pantalla está sucia',
 '¿cuántos chats puedo tener?', 'la ayuda del gobierno no llegó', 'regresa pronto el verano', 'recuérdalo tú, yo no', 'avísame si sabes algo de política',
]
NINGUNA['en'] += [
 'can you explain how the stock market works', 'i want you to tell me a story', 'i need some advice', 'can you help me think',
 'what do you think about that', 'i want to know more about you', 'let me think about it', 'my mom wants to talk to you', 'i just got back from work',
 'i am at the table eating', 'the price settings went up', 'i changed my clothes', 'i like clear days', 'the dark scares me',
 'i talked to beto yesterday', 'do you know who claudio is', 'antonio is my friend', 'i texted my daughter yesterday', 'the message arrived late',
 'i already sent it myself', 'they removed me from the group', 'i looked for a job all week', 'my daughter taught me to use the phone',
 'slow motion looks nice', 'i do not want to talk about that', 'what a weird silence', 'i am quiet today', 'my whatsapp profile',
 'the meeting topic was the budget', 'i moved to a new house and i am happy', 'the screen is dirty', 'how many chats can i have',
 'the government help never came', 'summer is coming back soon', 'you remember it, not me', 'tell me if you hear anything about politics',
]

NINGUNA['es'] += ['¿me llamaste?', 'nadie me llama ya', 'no me llames tan tarde', 'el timer del horno se arruinó', 'me despertó el ruido',
                  'llámalo como quieras', 'mi mamá quiere que la llames', 'ayer me llamaron del banco']
NINGUNA['en'] += ['did you call me', 'nobody calls me anymore', 'the oven timer broke', 'the noise woke me up', 'call me crazy but i like it',
                  'they called me from the bank yesterday']

# Proporción de cada conjunto (por plantilla o por frase): 70 % entrenamiento, 15 % validación, 15 % prueba.
CICLO = ['train', 'train', 'test', 'train', 'train', 'val', 'train', 'train', 'test', 'train', 'train', 'val', 'train', 'train', 'train',
         'test', 'train', 'val', 'train', 'train']
MUESTRAS = {'train': 7, 'val': 6, 'test': 8}   # frases por plantilla
MUESTRAS_NEG = {'train': 3, 'val': 2, 'test': 3}


def reparto(i):
    return CICLO[i % len(CICLO)]


def partir(lista):
    """Una lista de relleno → {conjunto: sus elementos}. Cada conjunto recibe al menos uno."""
    out = {'train': [], 'val': [], 'test': []}
    for i, x in enumerate(lista):
        out[reparto(i)].append(x)
    for k in out:
        if not out[k]:
            out[k] = [lista[-1]]
    return out


def sin_tildes(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def dictado(s, r, idioma):
    """Los errores del dictado. Español: b por v, el «a» que se come, «q» por «que», una palabra repetida.
    Inglés: contracciones y formas habladas («gonna», «wanna», «u», «pls»), una palabra repetida."""
    if idioma == 'es':
        if r.random() < 0.12:
            s = s.replace('video', 'bideo').replace('vive', 'bibe').replace('vuelve', 'buelve').replace('llave', 'llabe')
        if r.random() < 0.15:
            s = s.replace('llama a ', 'llama ').replace('márcale a ', 'márcale ').replace('dile a ', 'dile ').replace('ve a ', 'va ')
        if r.random() < 0.12:
            s = s.replace(' que ', ' q ').replace('¿qué ', '¿q ')
        if r.random() < 0.06:
            s = s.replace('ll', 'y')
    else:
        if r.random() < 0.15:
            s = s.replace('you ', 'u ').replace('please', 'pls')
        if r.random() < 0.12:
            s = s.replace('going to', 'gonna').replace('want to', 'wanna').replace('i am ', "i'm ").replace('do not', "don't")
        if r.random() < 0.08:
            s = s.replace(' to ', ' 2 ')
    if r.random() < 0.07:
        w = s.split(' ')
        i = r.randrange(len(w))
        w.insert(i, w[i])
        s = ' '.join(w)
    return s


def ruido(s, r, idioma):
    s = dictado(s, r, idioma)
    if r.random() < 0.35:
        s = sin_tildes(s)
    if r.random() < 0.4:
        s = s.replace('¿', '').replace('?', '').replace(',', '').replace('...', '').replace(':', '').replace('¡', '').replace('!', '')
    if r.random() < 0.3:
        s = s[:1].upper() + s[1:]
    if r.random() < 0.15 and not s.endswith(('?', '.')):
        s += '.'
    return ' '.join(s.split())


def accion_de(etiqueta, frase):
    """El grupo `accion` (Dr Electrum): casi nada de AU-RA es una orden de su mapa. Lo que coincide de
    verdad: callar es callar, «cierra esto» es cerrar, y la pantalla completa es la pantalla completa."""
    f = sin_tildes(frase.lower())
    if etiqueta == 'app_callar':
        return 'callar'
    if etiqueta == 'app_atras' and re.search(r'\b(cierra|close)\b', f):
        return 'cerrar'
    if etiqueta == 'app_presencia' and re.search(r'pantalla completa|full ?screen|toda la pantalla|whole screen|en grande', f):
        return 'salir_pantalla' if re.search(r'\b(sal|exit)\b', f) else 'pantalla_completa'
    return 'ninguna'


def rellenar(p, r, rel):
    for k, v in rel.items():
        while '{' + k + '}' in p:
            p = p.replace('{' + k + '}', r.choice(v), 1)
    # «a el pastor» se dice «al pastor»; «de el licenciado», «del licenciado».
    return re.sub(r'\b(a|de) el\b', lambda m: 'al' if m.group(1) == 'a' else 'del', p)


def generar():
    r = random.Random(SEMILLA)
    conjuntos = {'train': [], 'val': [], 'test': []}
    rel = {idioma: {k: partir(v) for k, v in d.items()} for idioma, d in RELLENO.items()}
    for etiqueta, por_idioma in T.items():
        for idioma, plantillas in por_idioma.items():
            for i, p in enumerate(plantillas):
                cj = reparto(i)
                vistos = set()
                relleno = {k: v[cj] for k, v in rel[idioma].items()}
                n = MUESTRAS[cj] if '{' in p else max(2, MUESTRAS[cj] - 2)
                for _ in range(n * 6):
                    if len(vistos) >= n:
                        break
                    base = rellenar(p, r, relleno)
                    s = r.choice(PRE[idioma]) + base + (r.choice(POST[idioma]) if r.random() < 0.5 else '')
                    s = ruido(s, r, idioma)
                    k = s.lower()
                    if k in vistos:
                        continue
                    vistos.add(k)
                    conjuntos[cj].append({'q': s, 'e': [accion_de(etiqueta, s), etiqueta], 'l': idioma, 't': f'{etiqueta}/{idioma}/{i}'})
    for idioma, frases in NINGUNA.items():
        pre = {'es': ['', '', '', 'aura, ', 'oye, ', 'a ver, ', 'eh, ', 'fíjate que ', 'mira, '], 'en': ['', '', '', 'aura, ', 'hey, ', 'so, ', 'um, ']}[idioma]
        for i, base in enumerate(frases):
            cj = reparto(i)
            vistos = set()
            for _ in range(MUESTRAS_NEG[cj] * 4):
                if len(vistos) >= MUESTRAS_NEG[cj]:
                    break
                s = ruido(r.choice(pre) + base, r, idioma)
                if s.lower() not in vistos:
                    vistos.add(s.lower())
                    conjuntos[cj].append({'q': s, 'e': ['ninguna', 'app_ninguna'], 'l': idioma, 't': f'app_ninguna/{idioma}/{i}'})
    return conjuntos


def normal(s):
    return re.sub(r'[^a-z0-9ñ ]+', ' ', sin_tildes(s.lower())).split()


def gramas(s, n=4):
    t = ' ' + ' '.join(normal(s)) + ' '
    return {t[i:i + n] for i in range(max(1, len(t) - n + 1))}


def sin_fugas(conj):
    """Quita del entrenamiento lo que es (casi) igual a algo de validación o de prueba, y de
    validación lo que es casi igual a algo de prueba. Devuelve cuántas quitó."""
    quitadas = {'train': 0, 'val': 0}
    apartadas = [(f, gramas(f['q'])) for f in conj['test']]
    for nombre, contra in (('val', apartadas), ('train', apartadas + [(f, gramas(f['q'])) for f in conj['val']])):
        exactas = {' '.join(normal(f['q'])) for f, _ in contra}
        por_grama = {}
        for j, (_, g) in enumerate(contra):
            for x in g:
                por_grama.setdefault(x, []).append(j)
        quedan = []
        for f in conj[nombre]:
            if ' '.join(normal(f['q'])) in exactas:
                quitadas[nombre] += 1
                continue
            g = gramas(f['q'])
            candidatos = {}
            for x in g:
                for j in por_grama.get(x, ()):
                    candidatos[j] = candidatos.get(j, 0) + 1
            casi = any(c / (len(g) + len(contra[j][1]) - c) >= 0.8 for j, c in candidatos.items())
            if casi:
                quitadas[nombre] += 1
                continue
            quedan.append(f)
        conj[nombre] = quedan
    return quitadas


def escribir(nombre, filas):
    os.makedirs(DATOS, exist_ok=True)
    with open(os.path.join(DATOS, nombre), 'w', encoding='utf-8') as f:
        for x in filas:
            f.write(json.dumps(x, ensure_ascii=False) + '\n')


def resumen(conj):
    etiquetas = sorted({f['e'][1] for c in conj.values() for f in c})
    print(f'{"etiqueta":28}' + ''.join(f'{c + "·" + l:>11}' for c in ('train', 'val', 'test') for l in ('es', 'en')))
    for e in etiquetas:
        print(f'{e:28}' + ''.join(f'{sum(1 for f in conj[c] if f["e"][1] == e and f["l"] == l):11d}' for c in ('train', 'val', 'test') for l in ('es', 'en')))
    print(f'{"total":28}' + ''.join(f'{sum(1 for f in conj[c] if f["l"] == l):11d}' for c in ('train', 'val', 'test') for l in ('es', 'en')))


if __name__ == '__main__':
    conj = generar()
    q = sin_fugas(conj)
    r = random.Random(SEMILLA + 1)
    for c in conj.values():
        r.shuffle(c)
    # Comprobación: ninguna plantilla en dos conjuntos.
    plantillas = {c: {f['t'] for f in conj[c]} for c in conj}
    assert not (plantillas['train'] & plantillas['val']) and not (plantillas['train'] & plantillas['test']) and not (plantillas['val'] & plantillas['test'])
    escribir('train_app.jsonl', conj['train'])
    escribir('val_app.jsonl', conj['val'])
    escribir('test_app.jsonl', conj['test'])
    resumen(conj)
    print(f'casi iguales quitadas: {q["train"]} de entrenamiento, {q["val"]} de validación')
