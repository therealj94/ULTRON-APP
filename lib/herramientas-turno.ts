/**
 * LAS HERRAMIENTAS DE UN TURNO HABLADO, SEGÚN LO QUE PIDE (José, 6-oct, APK 5.6.0: la mesa hablada pasó de 1,46 s a
 * 4,96 s de mediana en el servidor).
 *
 * Medido en producción: cada turno hablado, también «¿cómo te fue?», mandaba ~9,2 k fichas, y ~4,8 k de ellas eran las
 * 25 herramientas (`prompt 29034 car. ~9074 fichas (25 herr. 15428 car.)`). La primera ficha la manda el tiempo de
 * leer el pedido (prefill), y la cobertura en paralelo (lib/cerebro-rapido.ts) mandaba el mismo pedido entero otra vez
 * al segundo modelo. Aquí, sin red y sin modelo, se elige qué herramientas van en ESTE turno:
 *
 *  · la charla, un saludo o una pregunta simple: solo `buscar_web` (un dato de hoy se busca; ninguna mano privada);
 *  · lo que pide una acción: las herramientas de esa acción (un mensaje → WhatsApp, el chat de AU-RA, el correo y el
 *    círculo; «recuérdame» → recordatorio y la llamada de AU-RA; «llama a» → llamar; la computadora, los documentos,
 *    investigar, la app, la cartera…);
 *  · lo que contesta a algo que espera su «sí» o a una propuesta de AU-RA («¿Le escribo a Marisol?» → «sí, dale»): las
 *    herramientas de ESO (lo que dijo AU-RA cuenta solo entonces: José, 7-oct 00:30, un WhatsApp pendiente nombrado en la
 *    respuesta anterior empujaba la herramienta en turnos que hablaban de otra cosa);
 *  · ANTE LA DUDA, TODAS: un verbo de acción que no cae en ningún grupo, o un «sí» a algo que no se sabe qué es.
 *
 * Nunca se pierde una mano que hacía falta: si el modelo promete algo sin la herramienta (prometeSinHacer), server.ts le
 * vuelve a pedir que lo cumpla con TODAS las herramientas (cumplirLoDicho). Bedrock no reutiliza lo leído entre turnos
 * para GLM-5 ni Kimi (lib/prompt-voz.ts), así que cambiar las herramientas turno a turno no le cuesta nada al siguiente;
 * el system del Qwen del nodo (el que sí reutiliza) no cambia: las herramientas no van ahí.
 */
import type { Tool } from '@aws-sdk/client-bedrock-runtime';
import { analizarRespuesta } from './afirmacion';
import { anteriorOfreceAccion } from './cerebro-rapido';

/** Lo que se sabe del turno para elegir. */
export type ContextoHerramientas = {
  /** Lo que dijo la persona (tal cual). */
  mensaje: string;
  /** Lo último que dijo AU-RA en el hilo. */
  anterior?: string;
  /** Algo espera su «sí» (un borrador, un apartado, lo que la app tiene listo). */
  esperaSi?: boolean;
  /** Un borrador o un apartado de WhatsApp espera su decisión. */
  esperaWhatsapp?: boolean;
  /** Un borrador o un apartado de correo espera su decisión. */
  esperaCorreo?: boolean;
  /** Los contactos del teléfono (nombrar a uno es hablar de escribirle o llamarle). */
  contactos?: readonly string[];
  /** Hay una tarea de varios pasos en curso (lib/tarea-en-curso.ts). */
  conTarea?: boolean;
};

export type EleccionHerramientas = {
  herramientas: Tool[];
  /** Los grupos que pidió la frase (para el log y las pruebas). */
  grupos: string[];
  /** Van todas (ante la duda). */
  todas: boolean;
};

/** Los grupos de manos y sus herramientas (las que no tiene el turno simplemente no están). */
const GRUPOS: Record<string, readonly string[]> = {
  base: ['buscar_web'],
  pagina: ['leer_pagina'],
  app: ['abrir_pantalla', 'ajustar_app'],
  idioma: ['cambiar_idioma'],
  chats: ['chat_aura', 'leer_mensajes', 'buscar_en_chats'],
  whatsapp: ['whatsapp', 'ordenar_mensajes'],
  correo: ['correo', 'ordenar_mensajes'],
  mensajes: ['chat_aura', 'leer_mensajes', 'buscar_en_chats', 'whatsapp', 'correo', 'circulo', 'ordenar_mensajes'],
  pendientes: ['ordenar_mensajes', 'tarea', 'mision'],
  llamada: ['llamar_contacto', 'llamarme', 'circulo'],
  recordatorio: ['recordatorio', 'llamarme'],
  computadora: ['computadora', 'leer_pagina'],
  documentos: ['crear_documento'],
  investigar: ['investigar'],
  perfil: ['recordar_de_mi'],
  dinero: ['cartera_saldo', 'abrir_cartera', 'preparar_pago'],
  tarea: ['tarea'],
  mision: ['mision'],
  circulo: ['circulo'],
  sistema: ['estado_sistema'],
};

const plano = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ@.:/\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Qué pide cada grupo (se compara sin tildes, en minúsculas). */
const PIDE: Array<[string, RegExp]> = [
  ['pagina', /https?:\/\/|\b(esta|esa|la) (pagina|liga|enlace|link)\b|\b(lee|abre|abreme|leeme) (el|ese|este) (link|enlace)\b/],
  ['whatsapp', /\b(whats ?app\w*|whats\w*|wats\w*|guats\w*|wasap\w*|guasap\w*|wsp)\b/],
  ['correo', /\b(correo\w*|e ?mail\w*|mail\w*|gmail|outlook|hotmail|bandeja|inbox|buzon)\b/],
  [
    'mensajes',
    /\b(mensaje\w*|chat\w*|escrib\w*|mand(a|e|o|ar|ale|ales|alo|ala|amelo|aselo|aselos|enle)\b|envi(a|e|o|ar|ale|ales|alo|amelo|aselo)\b|respond\w*|contest\w*|reenvi\w*|redact\w*|borrador\w*|dile|diles|decile|digale|dig(a|o)le|avisa(le|les)|preguntale|recado|textea\w*|novedad\w*|(me|te|le) (escribio|mando|contesto|respondio|dijo)|que (me|te) (dijo|dice|escribio|mando)|leeme|lee(r)? (mis|el|los|lo)|revisa(r)? (mis|el|los|lo)|send|reply|text me|message)\b/,
  ],
  ['pendientes', /\b(pendiente\w*|que tengo (hoy|para hoy|manana)|que me falta)\b/],
  ['llamada', /\b(llam(a|ame|ale|alo|ala|ar|arle|arme|e|en|ada|adas|amos)|marc(a|ame|ale|ar|arle)|marques|telefone\w*|timbr\w*|videollamad\w*|call me|call)\b/],
  [
    'recordatorio',
    /\b(recuerd(a|ame|ale|en|eme)|recordar(me|le)?|recordatorio\w*|alarma\w*|despert(ar|ador)\w*|despiert(a|ame)\w*|timer|temporizador|cronometr\w*|agend\w*|program(a|ame|ar|alo)\b|avisame|avisarme|no se me (olvide|pase|vaya)|que no se me|cita\w*|reunion\w*|remind\w*|alarm)\b|\ben (\d+|un|una|media|dos|tres|cinco|diez|quince|veinte|treinta) (minutos?|horas?|rato)\b|\ba las (\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/,
  ],
  ['computadora', /\b(computadora|compu|pc|navega\w*|navegador|firefox|libreoffice|formulario\w*|sitio web|pagina web|entra(r)? (a|en) (la |el )?(pagina|sitio|web)|descarga(me|r)?)\b/],
  [
    'documentos',
    /\b(word|excel|pdf|power ?point|pptx?|docx?|xlsx?|diapositiva\w*|hoja de calculo)\b|\b(haz|hazme|hagas|crea|creame|arma|armame|prepara|preparame|genera|generame|redacta|redactame|elabora|elaborame|saca|sacame|pasame|dame|escribe|escribeme)\b.{0,40}\b(documento\w*|informe\w*|reporte\w*|presupuesto\w*|cotizacion\w*|carta\w*|presentacion\w*|planilla\w*|archivo\w*|contrato\w*|tabla\w*)\b/,
  ],
  ['investigar', /\b(investig\w*|averigu\w*|indag\w*|a fondo|research|con fuentes)\b/],
  [
    'perfil',
    /\b(dime [a-z]+$|llamame [a-z]+$|mi apodo|vivo en|naci (en|el)|mi cumple\w*|cumpleanos|me gusta\w*|me encanta\w*|favorit\w*|trabajo (en|de|como)|mi (esposa|esposo|hij[oa]|mama|papa|herman[oa]|novi[oa]|perro|gata?) se llama|recuerda que|acuerdate (de )?que|no olvides que|guarda que|anota que|apunta que|que sepas que)\b/,
  ],
  ['dinero', /\b(saldo\w*|wallet|cartera|billetera|veta|origen|usdt|cripto\w*|pag(a|ar|ale|ame|o|ue|uele)\b|transfer\w*|cuanto tengo|dinero|plata para)\b/],
  ['tarea', /\b(tarea\w*|paso (\d+|uno|dos|tres|cuatro|cinco)|siguiente|uno por uno|una por una|retom\w*|pausa(r|la)?|terminamos|ya (lo |la )?hice|hecho|descarta(r|la)?)\b/],
  ['mision', /\b(mision\w*|meta\w*|objetivo\w*|proposito\w*)\b/],
  ['circulo', /\b(circulo|mi (esposa|esposo|mujer|marido|hij[oa]s?|mama|papa|madre|padre|herman[oa]s?|socio\w*|familia|suegr[oa]|abuel[oa]|novi[oa]|compadre|comadre))\b/],
  ['sistema', /\b(sistema|nodos?|servidor\w*|servicios|redespl\w*|despliegue|render)\b/],
  [
    'app',
    /\b(abre|abrir|abreme|abrime|cierra|cerrar|pantalla\w*|ajustes?|configuracion|tema|oscuro|modo (oscuro|claro|noche)|atras|regresa|callate|calla|silencio|shh|ponte|grande|chiquit\w*|al lado|avatar|claudio|guardian|antonio|ant onio|te ves|vieras|verte|aspecto|apariencia|mis chats|mis misiones|mi perfil|mi circulo)\b|\b(cambi\w*|pasa(me)?|pon(me|te)?)\b.{0,20}\b(aura|au ra)\b/,
  ],
  ['idioma', /\b(ingles|espanol|english|spanish|idioma|habla(me)? en)\b/],
];

/**
 * Verbos que piden hacer ALGO (lib/cerebro-rapido.ts PIDE_ACCION, sin lo que ya tiene grupo aquí ni lo que hace solo el
 * teléfono: la cámara, la música). Si la frase tiene uno y ningún grupo la reconoció, van todas: ante la duda, todas.
 */
const ACCION_SIN_GRUPO = /\b(cierr\w*|cerr\w*|pon(me|lo|la|le|elo|ga|gas)?|poner\w*|pongas?|cambi\w*|apag\w*|encend\w*|enciend\w*|prend\w*|activ\w*|desactiv\w*|borr\w*|descart\w*|compart\w*|guard\w*|anot\w*|apunt\w*|olvid\w*|cancel\w*|hazlo|hagale|haz|hazme|hagas|haga|encarga\w*|gestion\w*|consigue\w*|reserv\w*|compr\w*|pide(me|le)?|pidas)\b/;

/** Lo que solo hace el teléfono o ninguna mano del cerebro (la cámara, la música, cantar): no pide herramientas. */
const DEL_TELEFONO = /\b(camara\w*|foto\w*|lo que ves|lo que veo|musica|cancion\w*|canta\w*|cantes|reproduc\w*|spotify|youtube|playlist|radio|volumen|sube(le)?|baja(le)?)\b/;

/** Los grupos que pide un texto. */
function gruposDe(texto: string, contactos: readonly string[] = []): Set<string> {
  const p = plano(texto);
  const out = new Set<string>();
  for (const [g, re] of PIDE) if (re.test(p)) out.add(g);
  // Nombrar a un contacto del teléfono para comunicarse con él («¿y Beto?», «necesito hablar con Ana»): escribirle o
  // llamarle. Solo nombrarlo en una charla larga («Ana me contó lo de la mina») no es pedir un mensaje (José, 7-oct).
  const nombres = contactos
    .map((c) => plano(c))
    .flatMap((c) => c.split(' '))
    .filter((w) => w.length >= 3 && !/^(mi|mis|el|la|los|las|del|con|para|tio|tia|don|dona|doctor|banco)$/.test(w));
  const paraComunicarse = p.split(' ').length <= 4 || /\b(habl(a|ar|e|o)\w*|comunic\w*|contact\w*|localiz\w*|ubic(a|ar|ame)\w*|necesito a|quiero a)\b/.test(p);
  if (paraComunicarse && nombres.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(p))) {
    out.add('mensajes');
    out.add('llamada');
  }
  return out;
}

/** ¿Es solo un «sí» / «dale» / «va» (o un «no»), algo que contesta a lo anterior? */
function contestaALoAnterior(mensaje: string): boolean {
  const a = analizarRespuesta(mensaje);
  if (a.pregunta) return false;
  // Un «sí» con poco más («sí, dale», «sí, a Marisol»); un «sí, y cuéntame de la mina» ya dice lo suyo.
  if (a.pura || a.envio || a.niega || (a.afirma && a.contenido.length <= 3)) return true;
  return /^\s*(no|nel|mejor no|otra vez|de nuevo|igual|eso|ese|esa|ok(ay)?|listo|claro|perfecto|hazlo|hagale)\b/.test(plano(mensaje));
}

/**
 * Las herramientas de este turno hablado, de entre `todas` (las que el teléfono y la cuenta pueden: herramientasDelTurno),
 * en el mismo orden. Ver arriba.
 */
export function herramientasSegunFrase(todas: readonly Tool[], ctx: ContextoHerramientas): EleccionHerramientas {
  const mensaje = String(ctx.mensaje || '');
  const grupos = gruposDe(mensaje, ctx.contactos);
  const pidio = grupos.size > 0;
  const responde = contestaALoAnterior(mensaje);
  const ofrecio = anteriorOfreceAccion(ctx.anterior);
  // Lo que dijo AU-RA cuenta solo si la persona le contesta («sí», «no, a Beto») o si AU-RA propuso una acción y la frase
  // no pide otra cosa («a Marisol» a «¿A quién le escribo?»). «Usa tu computadora…» tras «¿Llamo a Beto?» es otra cosa.
  // Una pregunta suya de varias palabras («¿Y tú cómo pasaste la semana?») cambia de tema; «¿a cuál?» no.
  const palabras = plano(mensaje).split(' ').filter(Boolean).length;
  const contestaOferta = ofrecio && !pidio && (palabras <= 2 || (palabras <= 5 && !/[¿?]/.test(mensaje)));
  if (ctx.anterior && (responde || contestaOferta)) for (const g of gruposDe(ctx.anterior, ctx.contactos)) grupos.add(g);
  // Lo que espera su decisión: sus herramientas (cambiarlo, releerlo, mandarlo).
  if (ctx.esperaWhatsapp) grupos.add('whatsapp');
  if (ctx.esperaCorreo) grupos.add('correo');
  if (ctx.esperaSi && !ctx.esperaWhatsapp && !ctx.esperaCorreo) {
    grupos.add('mensajes');
    grupos.add('llamada');
    grupos.add('recordatorio');
  }
  if (ctx.conTarea) grupos.add('tarea');
  // Ante la duda, todas: un verbo de acción que ningún grupo reconoce, o un «sí» a algo que no se sabe qué es.
  const p = plano(mensaje);
  const dudaAccion = !pidio && ACCION_SIN_GRUPO.test(p) && !DEL_TELEFONO.test(p);
  const dudaSi = responde && grupos.size === 0 && (ofrecio || !!ctx.esperaSi);
  if (dudaAccion || dudaSi) return { herramientas: [...todas], grupos: [...grupos, 'todas'], todas: true };
  const nombres = new Set<string>(GRUPOS.base);
  for (const g of grupos) for (const n of GRUPOS[g] || []) nombres.add(n);
  const herramientas = todas.filter((t) => nombres.has(String(t.toolSpec?.name || '')));
  return { herramientas, grupos: [...grupos], todas: herramientas.length === todas.length };
}
