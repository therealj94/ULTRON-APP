/**
 * LA TAREA EN CURSO. José (2-oct): «Le pedí que me viera mis correos y lo hizo a medias… Hay que saberlo
 * organizar hasta terminar algo, no empezar a hacer otra cosa sin terminar una, o que pregunte si ya no
 * quiere hacerlo o para después».
 *
 * Una tarea de varios pasos que AU-RA está haciendo AHORA con la persona («revisar los 12 correos sin leer,
 * voy en el 4»). Es una por persona y conversación (ámbito: el teléfono, la web, la voz), igual que la
 * lista numerada del correo y sus borradores. No es una misión (lib/misiones.ts: metas de días o semanas)
 * ni lo que quedó a medias de otras conversaciones (lib/abiertos.ts): es el «en qué vamos» de esta.
 *
 *  · La crean las manos que listan varias cosas (correo revisar, whatsapp revisar) o el modelo
 *    (PEDIR_HERRAMIENTA: tarea empezar …), y la avanzan al leer, contestar o saltar cada paso.
 *  · `bloqueTarea` va en los HECHOS de cada turno: qué tarea, en qué paso va, cuál sigue. AU-RA la
 *    continúa hasta terminarla y, al terminar, la cierra y lo dice.
 *  · Si la persona pide otra cosa a mitad (`resolverTareaEnCurso`, al empezar el turno, sin modelo), AU-RA
 *    pregunta en una frase «¿Dejamos los correos para después, los termino primero, o los descarto?» y el
 *    turno siguiente el servidor actúa: pausar (queda en «lo que quedó a medias»), seguir o descartar.
 *
 * Vive en memoria (el turno la lee sin esperar a nada) y se copia en segundo plano a disco y S3
 * (`ultron/tarea-en-curso/<huella>.json`) para que un redespliegue no la borre.
 */
import { agregarAbierto, cerrar as cerrarAbierto } from './abiertos';
import { clavePersona, crearCajones, linea, nuevoId, palabras, plegar } from './cerebro-comun';
import { exito, fallo, type ResultadoHerramienta } from './recibo-herramienta';

export type TipoTarea = 'correo' | 'whatsapp' | 'otra';
export type EstadoPaso = 'pendiente' | 'hecho' | 'saltado';
export type Paso = { etiqueta: string; estado: EstadoPaso; nota?: string };
/** activa: en eso; preguntando: pidió otra cosa y AU-RA le preguntó qué hacer; pausada: para después. */
export type EstadoTarea = 'activa' | 'preguntando' | 'pausada';

export type Tarea = {
  id: string;
  ambito: string;
  tipo: TipoTarea;
  /** «revisar los 12 correos sin leer» */
  titulo: string;
  pasos: Paso[];
  /** El paso en que va (índice), -1 si todavía no empezó. */
  actual: number;
  estado: EstadoTarea;
  creado: number;
  actualizado: number;
  /** Lo que pidió a mitad de la tarea (lo que AU-RA tiene que atender después de que decida). */
  pedidoNuevo?: string;
  /** Lo que pidió y quedó para cuando termine la tarea («los termino primero»). */
  despues?: string;
  /** El pendiente que se anotó al pausarla (lib/abiertos.ts): se cierra al retomarla o terminarla. */
  abiertoId?: string;
};

/** Una tarea activa que nadie tocó en este rato se pausa sola (queda en «lo que quedó a medias»). */
export const TAREA_VIVE_MS = 3 * 3600_000;
/** Una en pausa que nadie retomó en estos días se olvida (lo que quedó a medias sigue por su lado). */
export const PAUSADA_VIVE_MS = 3 * 86_400_000;
export const MAX_PASOS = 40;
const MAX_TAREAS = 8;

type CajonTareas = { version: 1; tareas: Tarea[] };

function sanearTarea(x: any): Tarea | null {
  const titulo = linea(x?.titulo, 160);
  const pasos: Paso[] = (Array.isArray(x?.pasos) ? x.pasos : [])
    .slice(0, MAX_PASOS)
    .map((p: any) => ({
      etiqueta: linea(p?.etiqueta, 200),
      estado: p?.estado === 'hecho' || p?.estado === 'saltado' ? p.estado : 'pendiente',
      ...(p?.nota ? { nota: linea(p.nota, 80) } : {}),
    }))
    .filter((p: Paso) => p.etiqueta);
  if (!titulo || !pasos.length) return null;
  const tipo: TipoTarea = x?.tipo === 'correo' || x?.tipo === 'whatsapp' ? x.tipo : 'otra';
  const estado: EstadoTarea = x?.estado === 'preguntando' || x?.estado === 'pausada' ? x.estado : 'activa';
  const actual = Number.isInteger(x?.actual) && x.actual >= -1 && x.actual < pasos.length ? x.actual : -1;
  return {
    id: String(x?.id || nuevoId('tc')).slice(0, 40),
    ambito: String(x?.ambito || 'general').slice(0, 80),
    tipo,
    titulo,
    pasos,
    actual,
    estado,
    creado: Number(x?.creado) || Date.now(),
    actualizado: Number(x?.actualizado) || Number(x?.creado) || Date.now(),
    ...(x?.pedidoNuevo ? { pedidoNuevo: linea(x.pedidoNuevo, 300) } : {}),
    ...(x?.despues ? { despues: linea(x.despues, 300) } : {}),
    ...(x?.abiertoId ? { abiertoId: String(x.abiertoId).slice(0, 40) } : {}),
  };
}

const cajones = crearCajones<CajonTareas>({
  nombre: 'tarea-en-curso',
  prefijoS3: 'tarea-en-curso',
  dirEnv: 'ULTRON_TAREA_CURSO_DIR',
  dirPorOmision: 'tarea-en-curso',
  vacio: () => ({ version: 1, tareas: [] }),
  sanear: (raw: any) => ({
    version: 1,
    tareas: (Array.isArray(raw?.tareas) ? raw.tareas : []).map(sanearTarea).filter(Boolean).slice(0, MAX_TAREAS) as Tarea[],
  }),
});

/** Lo de cada persona, en memoria: la verdad del turno. */
const MEM = new Map<string, Tarea[]>();

const ambitoDe = (ambito: string) => String(ambito || 'general').slice(0, 80);

/** Se copia a disco/S3 sin hacer esperar a nadie (en orden: cajones.modificar va en cola). */
function persistir(clave: string) {
  const copia = JSON.parse(JSON.stringify(MEM.get(clave) || [])) as Tarea[];
  void cajones
    .modificar(clave, (c) => {
      c.tareas = copia;
    })
    .catch((e) => console.warn('[tarea-en-curso] no la guardé', String(e?.message || e).slice(0, 120)));
}

/** Carga lo guardado (al empezar la conversación o tras un redespliegue). No lanza. */
export async function precargarTareas(persona: string): Promise<void> {
  const clave = clavePersona(persona);
  if (!clave || MEM.has(clave)) return;
  const l = await cajones.leer(clave).catch(() => ({ ok: false }) as const);
  if (l.ok && !MEM.has(clave)) MEM.set(clave, l.valor.tareas);
}

function tareasDe(clave: string): Tarea[] {
  let xs = MEM.get(clave);
  if (!xs) {
    xs = [];
    MEM.set(clave, xs);
  }
  return xs;
}

/** La tarea (activa, preguntando o en pausa) de esta conversación, tal cual. Null si no hay. */
export function tareaDe(persona: string, ambito = '', ahora = Date.now()): Tarea | null {
  const clave = clavePersona(persona);
  if (!clave) return null;
  const xs = MEM.get(clave);
  if (!xs) {
    // El turno no espera: se carga para el siguiente.
    void precargarTareas(persona);
    return null;
  }
  const t = xs.find((x) => x.ambito === ambitoDe(ambito));
  if (!t) return null;
  if (t.estado === 'pausada' && ahora - t.actualizado > PAUSADA_VIVE_MS) {
    quitar(clave, t);
    return null;
  }
  if (t.estado !== 'pausada' && ahora - t.actualizado > TAREA_VIVE_MS) {
    // Se quedó sin tocar: se pausa sola (y queda anotada en lo que quedó a medias).
    pausar(persona, t);
  }
  return t;
}

function quitar(clave: string, t: Tarea) {
  const xs = tareasDe(clave);
  const i = xs.indexOf(t);
  if (i >= 0) xs.splice(i, 1);
  persistir(clave);
}

/* ------------------------------------------------------------------ progreso */

export const pasosHechos = (t: Tarea) => t.pasos.filter((p) => p.estado !== 'pendiente').length;

/** El siguiente paso pendiente después del actual (y si no hay, el primero que quedó atrás). -1 si ya no queda. */
export function siguiente(t: Tarea): number {
  const n = t.pasos.length;
  for (let k = 1; k <= n; k++) {
    const i = (t.actual + k + n) % n;
    if (t.pasos[i].estado === 'pendiente') return i;
  }
  return -1;
}

/** «vas en el 4 de 12 (3 hechos)». */
export function progreso(t: Tarea): string {
  const h = pasosHechos(t);
  return t.actual >= 0 ? `vas en el ${t.actual + 1} de ${t.pasos.length} (${h} ${h === 1 ? 'hecho' : 'hechos'})` : `no has empezado (${t.pasos.length} en total)`;
}

/** Cómo se nombran las cosas de la tarea en la pregunta: «los correos», «los chats». */
function queEs(t: Tarea): { cosa: string; lo: 'los' | 'lo' } {
  if (t.tipo === 'correo') return { cosa: 'los correos', lo: 'los' };
  if (t.tipo === 'whatsapp') return { cosa: 'los mensajes de WhatsApp', lo: 'los' };
  return { cosa: `lo de «${linea(t.titulo, 60)}»`, lo: 'lo' };
}

/**
 * Empieza una tarea en esta conversación. Si había otra de otro tipo sin terminar, esa queda en pausa
 * (en lo que quedó a medias): nada se pierde. Una del mismo tipo se reemplaza (volvió a revisar).
 */
export function iniciarTarea(
  persona: string,
  ambito: string,
  o: { tipo: TipoTarea; titulo: string; pasos: string[]; ahora?: number }
): Tarea | null {
  const clave = clavePersona(persona);
  if (!clave) return null;
  const ahora = o.ahora ?? Date.now();
  const nueva = sanearTarea({
    id: nuevoId('tc'),
    ambito: ambitoDe(ambito),
    tipo: o.tipo,
    titulo: o.titulo,
    pasos: o.pasos.map((etiqueta) => ({ etiqueta, estado: 'pendiente' })),
    actual: -1,
    estado: 'activa',
    creado: ahora,
    actualizado: ahora,
  });
  if (!nueva) return null;
  const xs = tareasDe(clave);
  const vieja = xs.find((x) => x.ambito === nueva.ambito);
  if (vieja) {
    xs.splice(xs.indexOf(vieja), 1);
    const sinTerminar = vieja.pasos.some((p) => p.estado === 'pendiente');
    if (vieja.tipo !== nueva.tipo && sinTerminar && vieja.estado !== 'pausada') void anotarPausa(persona, vieja);
    else if (vieja.abiertoId) void cerrarAbierto(persona, vieja.abiertoId, vieja.tipo === nueva.tipo ? 'hecho' : 'descartado').catch(() => undefined);
    // Lo que había quedado para después de la vieja no se pierde.
    if (vieja.despues && !nueva.despues) nueva.despues = vieja.despues;
  }
  xs.unshift(nueva);
  while (xs.length > MAX_TAREAS) xs.pop();
  persistir(clave);
  return nueva;
}

export type Avance = { tarea: Tarea | null; terminada: boolean; texto: string };

/**
 * Marca un paso (índice desde 0) de la tarea de este tipo: hecho (leído, contestado) o saltado. Si era el
 * último pendiente, la tarea se cierra. `texto` es lo que va al final de lo que devuelve la herramienta
 * para que el modelo siga (o diga que terminó). Vacío si no hay tarea de ese tipo.
 */
export function marcarPaso(persona: string, ambito: string, tipo: TipoTarea, i: number, estado: Exclude<EstadoPaso, 'pendiente'> = 'hecho', nota?: string): Avance {
  const clave = clavePersona(persona);
  const t = clave ? MEM.get(clave)?.find((x) => x.ambito === ambitoDe(ambito)) : undefined;
  if (!t || t.tipo !== tipo || !t.pasos[i]) return { tarea: null, terminada: false, texto: '' };
  const p = t.pasos[i];
  // «Contestado» no vuelve a «leído».
  if (!(p.estado === 'hecho' && estado === 'saltado')) p.estado = estado;
  if (nota) p.nota = linea(nota, 80);
  t.actual = i;
  t.actualizado = Date.now();
  // Volvió a la tarea: lo que había preguntado, o la pausa, quedan atrás.
  if (t.estado !== 'activa') {
    t.estado = 'activa';
    delete t.pedidoNuevo;
    if (t.abiertoId) void cerrarAbierto(persona, t.abiertoId, 'hecho').catch(() => undefined);
    delete t.abiertoId;
  }
  const sig = siguiente(t);
  if (sig < 0) {
    const fin = cerrarTarea(clave!, t, 'hecho');
    return { tarea: t, terminada: true, texto: fin };
  }
  persistir(clave!);
  return {
    tarea: t,
    terminada: false,
    texto: `TAREA EN CURSO: «${t.titulo}» — ${progreso(t)}. Al terminar con este, ofrece el siguiente: ${sig + 1}. ${linea(t.pasos[sig].etiqueta, 120)}.`,
  };
}

/**
 * Lo que sale de la tarea hacia otro lado (anotar o cerrar en lo que quedó a medias). En la voz, un turno
 * especulativo puede descartarse: entonces espera a que se confirme (server/voz-agente.ts).
 */
type Efecto = (f: () => void) => void;
const alMomento: Efecto = (f) => f();

/** Cierra la tarea (terminada o descartada) y devuelve el HECHO para el modelo. */
function cerrarTarea(clave: string, t: Tarea, como: 'hecho' | 'descartado', efecto: Efecto = alMomento): string {
  const id = t.abiertoId;
  if (id) efecto(() => void cerrarAbierto(clave, id, como).catch(() => undefined));
  quitar(clave, t);
  const despues = t.despues ? ` Ahora atiende lo que pidió antes y quedó para después: «${t.despues}».` : '';
  if (como === 'descartado') return `TAREA DESCARTADA: «${t.titulo}» (se quedó en ${pasosHechos(t)} de ${t.pasos.length}). No la retomes.${despues}`;
  const saltados = t.pasos.filter((p) => p.estado === 'saltado').length;
  const faltan = t.pasos.filter((p) => p.estado === 'pendiente').length;
  const cuenta = `${t.pasos.length - saltados - faltan} de ${t.pasos.length} hechos${saltados ? `, ${saltados} saltados` : ''}${faltan ? `, ${faltan} sin ver porque la dio por terminada` : ''}`;
  return `TAREA TERMINADA: «${t.titulo}» (${cuenta}). Díselo en una frase («Listo, ya vimos todos»).${despues}`;
}

/** La anota en lo que quedó a medias (para retomarla otro día). */
async function anotarPausa(persona: string, t: Tarea): Promise<void> {
  const texto = `${t.titulo[0].toUpperCase()}${t.titulo.slice(1)}: quedó en ${pasosHechos(t)} de ${t.pasos.length}`;
  try {
    const a = await agregarAbierto(persona, texto, { tipo: 'tarea' });
    t.abiertoId = a.id;
    const clave = clavePersona(persona);
    if (clave) persistir(clave);
  } catch (e: any) {
    console.warn('[tarea-en-curso] no la anoté en lo que quedó a medias', String(e?.message || e).slice(0, 120));
  }
}

/** La deja en pausa (al momento) y la anota en lo que quedó a medias (sin hacer esperar al turno). */
function pausar(persona: string, t: Tarea, efecto: Efecto = alMomento): void {
  if (t.estado === 'pausada') return;
  t.estado = 'pausada';
  t.actualizado = Date.now();
  delete t.pedidoNuevo;
  const clave = clavePersona(persona);
  if (clave) persistir(clave);
  efecto(() => void anotarPausa(persona, t));
}

/* ------------------------------------------------------------------ lo que dice la persona */

export type Decision = 'pausar' | 'seguir' | 'descartar' | 'cerrar';

const limpiar = (m: string) => plegar(m).replace(/[¡!¿?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();

const D_SEGUIR = /\b(terminalos|terminalas|terminalo|terminala|terminemos|acabalos|acabalas|acabalo|sigamos con (eso|los|las|el|la|ellos)|sigue con (los|las|el|la|eso|ellos)|termina(los|las|lo|la)? primero|primero (termina|acaba|terminalos|los|las|eso|lo de)|mejor terminalos|continua con (los|las|eso))\b/;
const D_DESCARTAR = /\b(descarta(los|las|lo|la)?|olvida(los|las|lo|la|te)?|cancela(los|las|lo|la)?|ya no (quiero|importan?|hace falta|los quiero)|bota(los|lo)|no importan)\b/;
/** «después», «luego», «mañana» sueltos solo cuentan cuando AU-RA acaba de preguntar. */
const D_PAUSAR_SUELTO = /\b(despues|luego|mas tarde|manana|otro dia|otro rato)\b/;
const D_PAUSAR = /\b(para (despues|luego|mas tarde|manana|otro dia|otro rato|la tarde|la noche)|en pausa|pausa(los|las|lo|la)?|pospon\w*|aplaza\w*|ahorita no|ahora no|deja(los|las|lo|la)? (para|pendientes?))\b/;
const D_CERRAR = /\b(ya esta|eso es todo|suficiente|ya terminamos|los demas no|las demas no|el resto no|ya no mas|con eso basta|ya basta|deja(los|lo)? ahi)\b/;
const SI_SOLO = /^(si+|dale|ok(ay)?|okey|va|vale|claro|listo|bueno|de acuerdo|si por favor)$/;

/**
 * ¿Decidió algo sobre la tarea? (se compara plegado, sin tildes). `recienPreguntado`: AU-RA acaba de
 * preguntar «¿la dejamos para después, la termino o la descarto?»: un «luego» o un «sí» ya contestan.
 */
export function decisionDe(mensaje: string, recienPreguntado = false): Decision | null {
  const t = limpiar(mensaje);
  if (!t) return null;
  if (D_SEGUIR.test(t)) return 'seguir';
  if (D_DESCARTAR.test(t)) return 'descartar';
  if (D_PAUSAR.test(t) || (recienPreguntado && D_PAUSAR_SUELTO.test(t))) return 'pausar';
  if (D_CERRAR.test(t)) return 'cerrar';
  if (recienPreguntado) {
    // «¿Dejamos los correos para después…?» — «sí» es la primera opción; «no», no dejarlos (seguir).
    if (SI_SOLO.test(t)) return 'pausar';
    if (/^no( gracias)?$/.test(t) || /^no,? (sigue|termina)/.test(t)) return 'seguir';
  }
  return null;
}

const SIGUE_COMUN =
  /\b(sigue|seguimos|siguiente|continua|continuemos|proximo|el otro|la otra|salta(lo|la)?|ese no|esa no|cual sigue|quien (lo|la|me|los|las|te) (mando|mandaron|manda|escribio|envio)|de quien (es|son|era)|que dice|que mas dice|de que (trata|se trata|es)|repite|repitelo|repitemelo|otra vez|vuelve|el de|la de|lo de|los de|(el|la) (ultimo|ultima|primero|primera|segundo|segunda|tercero|tercera|cuarto|cuarta|quinto|quinta))\b|^otro$/;
const VERBOS_CORREO = /\b(lee(me|lo|la|los)?|leelo|leela|abre(lo|la)?|contesta(le|les)?|responde(le|les)?|escribe(le)?|reenvia(lo)?|borra(lo)?|archiva(lo)?|marca(lo)?|mandalo|envialo)\b/;
const COSAS_CORREO = /\b(correos?|mails?|emails?|bandeja|asunto|remitente|adjuntos?|archivo|pdf|factura|hilo|respuesta|borrador)\b/;
const VERBOS_WHATSAPP = /\b(lee(me|lo|la)?|abre(lo|la)?|contesta(le|les)?|responde(le|les)?|dile|escribe(le)?|mandale|mandalo|envialo)\b/;
const COSAS_WHATSAPP = /\b(mensajes?|chats?|whatsapp|grupo|audio|nota de voz|foto|borrador)\b/;
const NEUTRAL = /^(si+|no|ok(ay)?|vale|va|dale|listo|gracias|muchas gracias|perfecto|bien|bueno|aja|mmm+|hola|claro|exacto|correcto|entendido|de acuerdo|ah ok|oh|ya|okey)( (gracias|aura|ok|si|no|bien|perfecto))*$/;

/** ¿Habla de seguir con la tarea (otro paso, leer, contestar…)? `conNombres`: también si nombra algo de sus pasos. */
function hablaDeLaTarea(t: Tarea, q: string, conNombres = true): boolean {
  if (SIGUE_COMUN.test(q)) return true;
  if (t.tipo === 'correo' && (VERBOS_CORREO.test(q) || COSAS_CORREO.test(q))) return true;
  if (t.tipo === 'whatsapp' && (VERBOS_WHATSAPP.test(q) || COSAS_WHATSAPP.test(q))) return true;
  if (t.tipo === 'otra' && /\b(paso|tarea|lista)\b/.test(q)) return true;
  if (/^(el |la |#)?\d{1,2}$/.test(q) || /\b(el|la|del|numero) \d{1,2}\b/.test(q)) return true;
  if (!conNombres) return false;
  // Nombra algo de la tarea (un remitente, un asunto, un paso).
  const deLaTarea = new Set(t.pasos.flatMap((p) => palabras(p.etiqueta)).concat(palabras(t.titulo)));
  return palabras(q).some((w) => deLaTarea.has(w));
}

/**
 * ¿Lo que dijo sigue la tarea, es neutro (un «gracias», un «ok») o es OTRA cosa? Sin modelo, a propósito:
 * barato y predecible. En la duda se inclina por «sigue» (preguntar de más cansa).
 */
export function clasificarMensaje(t: Tarea, mensaje: string): 'sigue' | 'neutral' | 'otra' {
  const q = limpiar(mensaje);
  if (!q || NEUTRAL.test(q)) return 'neutral';
  if (hablaDeLaTarea(t, q)) return 'sigue';
  if (q.split(' ').length <= 2) return 'neutral';
  return 'otra';
}

/** Lo que un turno de voz especulativo cambió se deshace si la voz lo descarta (RetencionAcciones). */
type Retener = { hacer: (f: () => void) => void; alDescartar: (f: () => void) => void };

function restaurar(clave: string, copia: Tarea) {
  const xs = tareasDe(clave);
  const i = xs.findIndex((x) => x.id === copia.id || x.ambito === copia.ambito);
  if (i >= 0) xs.splice(i, 1, copia);
  else xs.unshift(copia);
  persistir(clave);
}

/**
 * Al empezar el turno (server.ts prepararTurno): si hay una tarea en esta conversación, mira qué dijo la
 * persona y actúa. Devuelve el HECHO para el modelo (o null si no hay nada que decir más allá del bloque).
 *  · activa + otra cosa → queda «preguntando» y el modelo pregunta en una frase qué hacer con la tarea.
 *  · preguntando + decisión → pausa (lo que quedó a medias), sigue o descarta; y le recuerda lo que pidió.
 *  · preguntando + sin decisión → si volvió a la tarea, sigue; si no, la pausa (nada se pierde).
 *  · `borradorResuelto`: el mensaje fue el «sí»/«no» a un borrador (es parte de la tarea).
 *  · `retener` (la voz): si el turno se descarta, la tarea vuelve a como estaba.
 * No espera a nada de afuera: lo de «lo que quedó a medias» se anota en segundo plano.
 */
export async function resolverTareaEnCurso(persona: string, ambito: string, mensaje: string, o: { borradorResuelto?: boolean; retener?: Retener } = {}): Promise<string | null> {
  const t = tareaDe(persona, ambito);
  if (!t) return null;
  const clave = clavePersona(persona);
  const copia = JSON.parse(JSON.stringify(t)) as Tarea;
  const efecto: Efecto = o.retener ? (f) => o.retener!.hacer(f) : alMomento;
  const r = decidirTarea(persona, clave, t, mensaje, !!o.borradorResuelto, efecto);
  if (r.cambio && o.retener) o.retener.alDescartar(() => restaurar(clave, copia));
  return r.hecho;
}

function decidirTarea(persona: string, clave: string, t: Tarea, mensaje: string, borradorResuelto: boolean, efecto: Efecto): { hecho: string | null; cambio: boolean } {
  const dijo = linea(mensaje, 200);
  const q = limpiar(mensaje);
  const { cosa, lo } = queEs(t);
  const nada = { hecho: null, cambio: false };
  const con = (hecho: string | null) => ({ hecho, cambio: true });
  if (t.estado === 'pausada') {
    if (/\b(retoma\w*|sigamos|seguimos|continuemos|continua\w*|en que (ibamos|quedamos))\b/.test(q) && hablaDeLaTarea(t, q)) {
      retomar(persona, t, efecto);
      const sig = siguiente(t);
      return con(`TAREA RETOMADA: «${t.titulo}» — ${progreso(t)}.${sig >= 0 ? ` Sigue con el ${sig + 1}: ${linea(t.pasos[sig].etiqueta, 120)}.` : ''}`);
    }
    return nada;
  }
  if (borradorResuelto) return nada;
  if (t.estado === 'preguntando') {
    const pedido = t.pedidoNuevo;
    const atender = pedido ? ` Ahora atiende lo que había pedido: «${pedido}».` : '';
    const decision = decisionDe(mensaje, true);
    if (decision === 'pausar') {
      pausar(persona, t, efecto);
      return con(`TAREA EN PAUSA: decidió dejar «${t.titulo}» para después (se quedó en ${pasosHechos(t)} de ${t.pasos.length}; queda anotada en lo que quedó a medias para retomarla).${atender} Confírmalo en media frase.`);
    }
    if (decision === 'descartar') return con(`${cerrarTarea(clave, t, 'descartado', efecto)}${atender} Confírmalo en media frase.`);
    if (decision === 'cerrar') return con(`${cerrarTarea(clave, t, 'hecho', efecto)}${atender}`);
    if (decision === 'seguir') {
      t.estado = 'activa';
      if (pedido) t.despues = pedido;
      delete t.pedidoNuevo;
      t.actualizado = Date.now();
      persistir(clave);
      const sig = siguiente(t);
      return con(`TAREA: decidió terminar primero «${t.titulo}». Sigue ya con el ${sig + 1}: ${linea(t.pasos[sig]?.etiqueta, 120)}.${pedido ? ` Lo que pidió («${pedido}») queda para cuando terminen; no lo olvides.` : ''}`);
    }
    if (clasificarMensaje(t, mensaje) === 'sigue') {
      t.estado = 'activa';
      delete t.pedidoNuevo;
      t.actualizado = Date.now();
      persistir(clave);
      return con(null);
    }
    pausar(persona, t, efecto);
    return con(
      `TAREA EN PAUSA: no dijo qué hacer con «${t.titulo}» y siguió con otra cosa: ${lo === 'los' ? 'los dejé' : 'lo dejé'} para después (queda en lo que quedó a medias). Atiende lo que pide ahora y menciónalo en media frase («${cosa} ${lo === 'los' ? 'quedan' : 'queda'} para después»).`
    );
  }
  // Activa: una decisión clara y corta que no hable de otro paso («ya está, el siguiente» no la cierra).
  const decision = decisionDe(mensaje);
  if (decision && decision !== 'seguir' && q.split(' ').length <= 8 && !hablaDeLaTarea(t, q, false)) {
    if (decision === 'pausar') {
      pausar(persona, t, efecto);
      return con(`TAREA EN PAUSA: dejó «${t.titulo}» para después (se quedó en ${pasosHechos(t)} de ${t.pasos.length}; queda en lo que quedó a medias). Confírmalo en media frase.`);
    }
    if (decision === 'descartar') return con(`${cerrarTarea(clave, t, 'descartado', efecto)} Confírmalo en media frase.`);
    return con(cerrarTarea(clave, t, 'hecho', efecto));
  }
  if (clasificarMensaje(t, mensaje) !== 'otra') return nada;
  t.estado = 'preguntando';
  t.pedidoNuevo = dijo;
  t.actualizado = Date.now();
  persistir(clave);
  return con(
    `TAREA A MEDIAS: estás en «${t.titulo}» (${progreso(t)}) y ahora pidió otra cosa: «${dijo}». ` +
      `Si de verdad es otra cosa, NO la empieces todavía ni pidas herramientas: pregúntale SOLO esto, en una frase: «¿Dejamos ${cosa} para después, ${lo} termino primero, o ${lo} descarto?». ` +
      'Si en realidad es parte de la tarea, síguela.'
  );
}

function retomar(persona: string, t: Tarea, efecto: Efecto = alMomento) {
  t.estado = 'activa';
  t.actualizado = Date.now();
  const id = t.abiertoId;
  if (id) efecto(() => void cerrarAbierto(persona, id, 'hecho').catch(() => undefined));
  delete t.abiertoId;
  const clave = clavePersona(persona);
  if (clave) persistir(clave);
}

/* ------------------------------------------------------------------ el panel de tareas (AUR08) */

/**
 * Las tareas de la persona en TODAS sus conversaciones (una por ámbito), para el panel de tareas
 * (server/trabajos.ts las adapta a TaskSnapshot con su mismo id). Aplica las mismas reglas que `tareaDe`
 * (la que nadie tocó se pausa sola; la pausada vieja se olvida). Copias: el panel no cambia nada por leer.
 */
export function tareasDePersona(persona: string, ahora = Date.now()): Tarea[] {
  const clave = clavePersona(persona);
  if (!clave) return [];
  const xs = MEM.get(clave);
  if (!xs) {
    void precargarTareas(persona);
    return [];
  }
  return [...new Set(xs.map((t) => t.ambito))].flatMap((amb) => {
    const t = tareaDe(persona, amb, ahora);
    return t ? [JSON.parse(JSON.stringify(t)) as Tarea] : [];
  });
}

export type AccionPanel = 'pausar' | 'seguir' | 'descartar' | 'retomar';

/**
 * Lo que la persona decide desde el panel sobre una tarea, por su id. Con `version` (su `actualizado`, la
 * versión que vio), si la tarea cambió desde entonces NO se aplica (una decisión vieja no decide nada).
 * Devuelve la tarea como quedó (null si se cerró).
 */
export function accionTareaPorId(persona: string, id: string, accion: AccionPanel, version?: number): { ok: true; tarea: Tarea | null } | { ok: false; motivo: 'no-existe' | 'version'; tarea?: Tarea } {
  const clave = clavePersona(persona);
  const t = clave ? MEM.get(clave)?.find((x) => x.id === id) : undefined;
  if (!clave || !t) return { ok: false, motivo: 'no-existe' };
  const copia = () => JSON.parse(JSON.stringify(t)) as Tarea;
  if (version !== undefined && version !== t.actualizado) return { ok: false, motivo: 'version', tarea: copia() };
  const antes = t.actualizado;
  if (accion === 'descartar') {
    cerrarTarea(clave, t, 'descartado');
    return { ok: true, tarea: null };
  }
  if (accion === 'pausar') pausar(persona, t);
  else if (accion === 'retomar' || t.estado === 'pausada') retomar(persona, t);
  else {
    // «Terminarla primero»: lo que pidió a mitad queda para cuando termine (como en el chat).
    t.estado = 'activa';
    if (t.pedidoNuevo) t.despues = t.pedidoNuevo;
    delete t.pedidoNuevo;
  }
  // La versión siempre se mueve (dos cambios en el mismo milisegundo no pueden parecer el mismo).
  t.actualizado = Math.max(Date.now(), antes + 1);
  persistir(clave);
  return { ok: true, tarea: copia() };
}

/* ------------------------------------------------------------------ el bloque del turno */

export const TOPE_TAREA = { compacto: 260, normal: 900 };

/**
 * TAREA EN CURSO, para los HECHOS del turno: qué es, en qué paso va y cuál sigue; o la que está en pausa.
 * La voz (`compacto`) lleva una línea. Vacío si no hay.
 */
export function bloqueTarea(persona: string, ambito = '', compacto = false): string {
  const t = tareaDe(persona, ambito);
  if (!t) return '';
  const max = compacto ? TOPE_TAREA.compacto : TOPE_TAREA.normal;
  const sig = siguiente(t);
  if (t.estado === 'pausada') {
    const s = compacto
      ? `TAREA EN PAUSA: «${linea(t.titulo, 70)}» (${pasosHechos(t)} de ${t.pasos.length}). Si quiere seguir: PEDIR_HERRAMIENTA: tarea retomar.`
      : `TAREA EN PAUSA (la dejó para después): «${t.titulo}», quedó en ${pasosHechos(t)} de ${t.pasos.length}. No la retomes sola en medio de otra cosa; si quiere seguir, PEDIR_HERRAMIENTA: tarea retomar.`;
    return linea(s, max);
  }
  const sigTxt = sig >= 0 ? `${sig + 1}. ${t.pasos[sig].etiqueta}` : '';
  if (compacto) {
    return linea(`TAREA EN CURSO: «${linea(t.titulo, 60)}», ${progreso(t)}.${sigTxt ? ` Sigue: ${linea(sigTxt, 70)}.` : ''} Termínala antes de empezar otra cosa.`, max);
  }
  const pendientes = t.pasos
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.estado === 'pendiente')
    .map(({ i }) => i + 1);
  const lineas = [
    `TAREA EN CURSO (no la dejes a medias): «${t.titulo}» — ${progreso(t)}.`,
    sigTxt ? `Siguiente: ${linea(sigTxt, 160)}.` : '',
    pendientes.length > 1 ? `Faltan: ${pendientes.slice(0, 15).join(', ')}${pendientes.length > 15 ? '…' : ''}.` : '',
    t.despues ? `Al terminarla, atiende lo que pidió y quedó para después: «${t.despues}».` : '',
    'Llévala paso a paso hasta el final: al acabar uno, ofrece el siguiente («¿Sigo con el de …?»). No empieces otra cosa sin cerrarla; si pide otra cosa, primero pregunta si la dejan para después, la terminas o la descartas. Si la da por terminada: PEDIR_HERRAMIENTA: tarea terminar.',
  ].filter(Boolean);
  let out = '';
  for (const l of lineas) {
    const sig2 = out ? `${out}\n${l}` : l;
    if (sig2.length > max) break;
    out = sig2;
  }
  return out;
}

/* ------------------------------------------------------------------ la herramienta del modelo */

/** Su instrucción para el harness (va con sesión): vive en lib/harness.ts, como la del círculo. */
export { INSTRUCCION_TAREA } from './harness';

/** El runner del harness: «empezar t | p1 | p2», «hecho 3», «saltar 3», «pausar», «terminar», «descartar», «retomar», «ver». Solo el texto. */
export async function correrTarea(persona: string, ambito: string, arg: string): Promise<string> {
  return (await correrTareaConEstado(persona, ambito, arg)).texto;
}

/** Lo que cambia la tarea queda en AURA (no sale a nadie). */
const CAMBIO = { efecto: 'guardado' as const, proveedor: 'tarea' };

/** El runner con su estado y su recibo (AUR07): lo que no se pudo es `failed` con su código; un cambio, `guardado`. */
export async function correrTareaConEstado(persona: string, ambito: string, arg: string): Promise<ResultadoHerramienta> {
  const clave = clavePersona(persona);
  if (!clave) return fallo('TAREA: solo con sesión. Pídele que entre con su cuenta.', 'sin-sesion');
  await precargarTareas(persona);
  const [cabeza, ...partes] = String(arg || '').split('|').map((x) => x.trim());
  const m = cabeza.match(/^(\S+)\s*(.*)$/s);
  const verbo = plegar(m?.[1] || 'ver');
  const resto = (m?.[2] || '').trim();
  const t = tareaDe(persona, ambito);
  if (/^(empezar|empieza|crear|crea|nueva|iniciar)$/.test(verbo)) {
    const pasos = partes.flatMap((p) => p.split(/\s*;\s*/)).filter(Boolean);
    if (!resto || pasos.length < 2) return fallo('TAREA: para empezarla hacen falta qué es y al menos dos pasos («tarea empezar <qué> | <paso 1> | <paso 2>»).', 'falta-dato');
    const n = iniciarTarea(persona, ambito, { tipo: 'otra', titulo: resto, pasos });
    if (!n) return fallo('TAREA: no la pude crear.', 'rechazado');
    return exito(`TAREA EMPEZADA: «${n.titulo}», ${n.pasos.length} pasos: ${n.pasos.map((p, i) => `${i + 1}. ${p.etiqueta}`).join(' · ')}. Empieza por el 1.`, { ...CAMBIO, referencia: n.id });
  }
  if (!t) return fallo('TAREA: no hay ninguna tarea en curso en esta conversación.', 'no-encontrado');
  if (/^(ver|estado|listar)$/.test(verbo)) {
    const b = bloqueTarea(persona, ambito);
    return b ? exito(b, { efecto: 'ninguno', proveedor: 'tarea' }) : fallo('TAREA: no hay ninguna tarea en curso.', 'no-encontrado');
  }
  if (/^(hecho|hecha|listo|avanzar|avanza|saltar|salta)$/.test(verbo)) {
    const n = parseInt(resto, 10);
    const i = Number.isInteger(n) && n > 0 ? n - 1 : t.actual >= 0 && t.pasos[t.actual]?.estado === 'pendiente' ? t.actual : siguiente(t);
    if (i < 0 || !t.pasos[i]) return fallo(`TAREA: no hay un paso ${resto || ''} en «${t.titulo}».`, 'no-encontrado');
    const av = marcarPaso(persona, ambito, t.tipo, i, /^salta/.test(verbo) ? 'saltado' : 'hecho');
    return av.texto ? exito(av.texto, { ...CAMBIO, referencia: t.id }) : fallo('TAREA: no la encontré.', 'no-encontrado');
  }
  if (/^(pausar|pausa|despues|luego)$/.test(verbo)) {
    pausar(persona, t);
    return exito(`TAREA EN PAUSA: «${t.titulo}» (${pasosHechos(t)} de ${t.pasos.length}); quedó en lo que quedó a medias para retomarla.`, { ...CAMBIO, referencia: t.id });
  }
  if (/^(terminar|termina|cerrar|cierra|terminada)$/.test(verbo)) return exito(cerrarTarea(clave, t, 'hecho'), { ...CAMBIO, referencia: t.id });
  if (/^(descartar|descarta|cancelar|cancela)$/.test(verbo)) return exito(cerrarTarea(clave, t, 'descartado'), { ...CAMBIO, referencia: t.id });
  if (/^(retomar|retoma|seguir|sigue|continuar)$/.test(verbo)) {
    retomar(persona, t);
    const sig = siguiente(t);
    return exito(`TAREA RETOMADA: «${t.titulo}» — ${progreso(t)}.${sig >= 0 ? ` Sigue con el ${sig + 1}: ${linea(t.pasos[sig].etiqueta, 120)}.` : ''}`, { ...CAMBIO, referencia: t.id });
  }
  return fallo(`TAREA: no entiendo «${verbo}». Usa empezar, hecho, saltar, pausar, terminar, descartar o retomar.`, 'no-entiendo');
}

/** Solo pruebas. */
export function _olvidarTareas(tambienDisco = false) {
  MEM.clear();
  if (tambienDisco) cajones._olvidarCache();
}
