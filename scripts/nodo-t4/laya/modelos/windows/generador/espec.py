"""Escribe ../modelo.json y ../preguntas.json a partir de las etiquetas de generar.py (una pregunta noul por mano)."""
import json
import os
import generar as g

AQUI = os.path.dirname(os.path.abspath(__file__))
DESC = {
 'win_ninguna': ('sí: no es una orden para la computadora; es conversación, una pregunta, algo que se cuenta o una negación («¿qué es un notch?», «ayer abrí word y se trabó», «no abras nada»)', 'no: es una orden para que AURA haga algo en Windows'),
 'win_abrir_app': ('sí: abrir o iniciar una aplicación instalada («abre excel», «launch spotify»)', 'no: abrir una carpeta, un archivo o una página web, o una pregunta sobre una app'),
 'win_abrir_carpeta': ('sí: abrir una carpeta del equipo («abre descargas», «show me documents»)', 'no: abrir una aplicación, un archivo o una página web'),
 'win_buscar_web': ('sí: buscar algo en internet («busca el precio del café», «google flights to roatan»)', 'no: abrir un sitio concreto, o preguntar algo que el cerebro contesta'),
 'win_abrir_web': ('sí: abrir un sitio o página web concreta («abre youtube», «go to gmail»)', 'no: buscar un tema en internet o abrir una app instalada'),
 'win_escribir': ('sí: escribir o pegar texto en la ventana activa, Word o el Bloc de notas («escribe hola en el bloc de notas»)', 'no: redactar un documento nuevo en el borrador o contar que se escribió algo'),
 'win_redactar': ('sí: componer un documento o texto nuevo («redáctame una carta de renuncia», «draft an email to the bank»)', 'no: escribir un texto literal en otra ventana, o preguntar cómo se redacta'),
 'win_ver_pantalla': ('sí: mirar, leer o explicar lo que hay en la pantalla («qué ves en mi pantalla»)', 'no: guardar una captura, o preguntar qué es una captura'),
 'win_captura': ('sí: tomar y guardar una captura de pantalla («toma un screenshot»)', 'no: pedir que mire o explique la pantalla'),
 'win_volumen_subir': ('sí: subir el volumen del equipo («súbele», «louder»)', 'no: bajar o silenciar, o hablar de volumen de ventas'),
 'win_volumen_bajar': ('sí: bajar el volumen del equipo («bájale», «turn it down»)', 'no: subir o silenciar'),
 'win_silenciar': ('sí: silenciar o volver a activar el sonido del equipo («mute», «quita el mute»)', 'no: callar a AURA o bajar el volumen un poco'),
 'win_multimedia_pausa': ('sí: pausar o reanudar la música o el video («pausa la canción», «play»)', 'no: pausar las acciones de AURA o callarla'),
 'win_multimedia_siguiente': ('sí: pasar a la canción siguiente o anterior («next song»)', 'no: pausar o preguntar qué canción es'),
 'win_recordar': ('sí: un recordatorio o temporizador en el tiempo («recuérdame en 10 minutos tomar agua»)', 'no: preguntar si AURA recuerda un dato («¿te acuerdas de…?»)'),
 'win_callar': ('sí: que AURA deje de hablar ya («cállate», «stop talking»)', 'no: pausar la música o pausar todas las acciones'),
 'win_pausa': ('sí: detener todas las acciones de AURA en la computadora («pausa todo»)', 'no: callar la voz o pausar la música'),
 'win_abrir_chat': ('sí: abrir el panel de chat de AURA («abre el chat», «expand»)', 'no: abrir un chat de otra app o esconder el panel'),
 'win_ocultar': ('sí: esconder o recoger el panel de AURA al notch («escóndete», «hide»)', 'no: abrir el chat o minimizar todas las ventanas'),
 'win_avatar': ('sí: cambiar de avatar (AU-RA, Claudio, ANT-ONIO, Guardián) («cambia a claudio»)', 'no: preguntar por un avatar o hablar de él'),
 'win_escritorio': ('sí: mostrar el escritorio minimizando todo («minimiza todo»)', 'no: abrir la carpeta Escritorio, o minimizar solo una ventana'),
 'win_bloquear': ('sí: bloquear el equipo («bloquea la compu», «lock the pc»)', 'no: preguntar cómo se bloquea un teléfono'),
 'win_pulsar': ('sí: pulsar un botón, pestaña, menú u opción de la ventana activa por su nombre («dale a guardar», «open the insert tab»)', 'no: abrir una aplicación, o preguntar para qué sirve un botón'),
 'win_que_hay': ('sí: que AURA diga qué botones u opciones tiene la ventana activa («qué botones hay»)', 'no: pedir que explique lo que se ve en pantalla'),
 'win_ventana': ('sí: cambiar a otra ventana abierta, o minimizar, maximizar o cerrar una ventana («cambia a chrome», «cierra esta ventana»)', 'no: abrir una app nueva, mostrar el escritorio o esconder a AURA'),
 'win_info': ('sí: preguntar al equipo la hora, la fecha, la batería, el espacio en disco o si hay internet («qué hora es», «cuánta batería me queda»)', 'no: la hora de otro lugar, o la batería de otra cosa'),
 'win_portapapeles': ('sí: hacer algo con el texto copiado («resume lo que copié», «read my clipboard»)', 'no: contar que se copió algo'),
 'win_musica': ('sí: saber qué suena o poner música en Spotify o YouTube Music («qué canción es esta», «pon salsa en spotify»)', 'no: hablar de música o pausar/pasar la canción'),
 'win_correo': ('sí: leer, contar o resumir los correos de la persona («léeme mis correos»)', 'no: hablar de un correo o redactar uno nuevo'),
 'win_agenda': ('sí: lo que tiene en el calendario («qué tengo hoy», «mi próxima reunión»)', 'no: contar que tiene una reunión o crear un recordatorio'),
 'win_abrir_archivo': ('sí: abrir o buscar un archivo del equipo por su nombre, o la última descarga («abre el archivo del contrato»)', 'no: abrir una carpeta o una aplicación'),
}
faltan = [i for i in g.ETIQUETAS if i not in DESC]
assert not faltan, faltan
pre = {i: {'type': 'noul', 'instructions': '¿Esto NO es una orden para la computadora?' if i == 'win_ninguna' else '¿Esto es lo que la persona le pide a AURA en su computadora con Windows?',
           'criteria': {'true': DESC[i][0], 'false': DESC[i][1]}} for i in g.ETIQUETAS}
json.dump(pre, open(os.path.join(AQUI, '..', 'preguntas.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
m = {'nombre': 'windows', 'descripcion': 'Qué MANO de AURA para Windows pidió la persona (grupo win, exclusivo), en español e inglés. Lo lee el servidor AU-RA en /api/windows/intencion para el .exe. ESPEC.md.',
     'ids': g.ETIQUETAS, 'grupos': {'win': g.ETIQUETAS}, 'recorte': {'cabeza': 120, 'cola': 120},
     'datos': {'train': ['datos/train_*.jsonl'], 'test': ['datos/test.jsonl'], 'bordes': ['datos/bordes.jsonl']},
     # La receta de entrenar.py para este modelo: 31 manos en un grupo exclusivo → por texto, la positiva y
     # 8 negativas al azar por época (con su peso), en fp16 y lotes grandes por largo: ~8× menos cómputo.
     'entrenamiento': {'epocas': 5, 'lote': 64, 'micro': 64, 'negativos': 8, 'lr': 4e-5, 'lr_cabeza': 3e-4}}
json.dump(m, open(os.path.join(AQUI, '..', 'modelo.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(g.ETIQUETAS), 'etiquetas')
