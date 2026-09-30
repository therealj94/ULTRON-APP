/**
 * LAS MANOS DE AURA EN EL CHAT: lo que pide por el bus del contrato y se hace aquí, en el teléfono.
 *
 *   «llama a mi mamá» → (AURA pregunta; con el «sí», el servidor manda) `llamar` → el motor de llamadas
 *                       de siempre marca. AURA se apaga sola al empezar la llamada (compa/llamada.ts)
 *                       y el motor espera a que suelte el audio (`esperarVozLibre`).
 *   «¿qué me dijo Beto?» → `leer`: se abre el hilo AQUÍ (los mensajes van cifrados de punta a punta y
 *                       el servidor no los tiene) y se arma lo que AURA dice: quién, hace cuánto y qué.
 *   «busca en mis chats la dirección» → `buscar`: se busca en los chats recientes y se dice SOLO en qué
 *                       chat está (nunca el contenido) y se abre ese hilo.
 *
 * Lo que AURA dice de leer y buscar sale del teléfono por el bus (`lectura`, con el boleto que puso el
 * servidor) y la voz lo pone (VozProvider): en la conversación fluida va como `[[lectura:<boleto>]]`
 * y el servidor lo dice tal cual, SIN pasar por el cerebro ni guardarlo; sin conversación, con la voz
 * de la mesa en modo `privado` (sin caché). Es lo mínimo: los últimos mensajes de esa persona (hasta
 * tres) o el último de cada chat con mensajes nuevos (hasta tres chats), recortados. El precio de oírlo
 * con la voz de AURA es que ese texto pasa por ElevenLabs y por el servidor de paso, como cualquier
 * frase que ella dice; por eso solo cuando la persona lo pide.
 *
 * Los manejadores se registran UNA vez al importar este archivo (lo importa PulseProvider).
 */
import { emitir, escuchar, type AccionApp } from '../nucleo/contrato';
import { tr } from '../i18n';
import * as RELEVO from './relevo';
import * as CHATS from './chats';
import * as LLAMADA from './llamada';
import { quienEs } from './borradores';

type De<T extends AccionApp['tipo']> = Extract<AccionApp, { tipo: T }>;

/** Lo más que se lee de una persona, y de cuántos chats a la vez. */
export const MAX_MENSAJES_LEIDOS = 3;
export const MAX_CHATS_LEIDOS = 3;
/** En cuántos chats (los más recientes) se busca. */
export const MAX_CHATS_BUSQUEDA = 8;
const MAX_POR_MENSAJE = 220;
export const MAX_LECTURA = 900;
/** Una misma `llamar` que vuelve (por el SSE y en el turno) dentro de este rato es la misma. */
export const VENTANA_LLAMADA_MS = 10_000;

const recortar = (s: string, n: number) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** «hace un momento», «hace 5 minutos», «hace una hora», «ayer», «el 3 de octubre». */
export function haceCuanto(cuando: number, ahora: number = Date.now()): string {
  const s = Math.max(0, Math.round((ahora - cuando) / 1000));
  if (s < 60) return tr('hace un momento', 'just now');
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? tr('hace un minuto', 'a minute ago') : tr(`hace ${m} minutos`, `${m} minutes ago`);
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? tr('hace una hora', 'an hour ago') : tr(`hace ${h} horas`, `${h} hours ago`);
  if (h < 48) return tr('ayer', 'yesterday');
  const d = new Date(cuando);
  return tr(`el ${d.getDate()} de ${MESES[d.getMonth()]}`, `on ${MONTHS[d.getMonth()]} ${d.getDate()}`);
}

/** Un mensaje dicho en voz: el texto (recortado), o qué era si no hay texto que leer. */
export function dichoDeMensaje(m: RELEVO.Mensaje | null | undefined): string {
  if (!m) return '';
  if (m.borrado) return tr('un mensaje que se borró', 'a deleted message');
  if (m.cerrado) return tr('un mensaje que no puedo abrir en este teléfono', "a message I can't open on this phone");
  if (m.tipo === 'imagen') return m.texto ? tr(`una foto que dice «${recortar(m.texto, MAX_POR_MENSAJE)}»`, `a photo that says “${recortar(m.texto, MAX_POR_MENSAJE)}”`) : tr('una foto', 'a photo');
  const t = recortar(m.texto, MAX_POR_MENSAJE);
  return t ? tr(`«${t}»`, `“${t}”`) : tr('un mensaje vacío', 'an empty message');
}

/**
 * Lo último que te escribió una persona: sus mensajes (no los tuyos), los no leídos si hay (hasta
 * tres) y si no, el último. «Beto te escribió hace 5 minutos: «Ya voy».».
 */
export function lecturaDePersona(nombre: string, mensajes: RELEVO.Mensaje[], yo: string, sinLeer: number, ahora: number = Date.now()): string {
  const suyos = mensajes.filter((m) => m.de && m.de.toLowerCase() !== yo.toLowerCase());
  if (!suyos.length) return tr(`${nombre} no te ha escrito nada todavía.`, `${nombre} hasn't written to you yet.`);
  const k = Math.max(1, Math.min(MAX_MENSAJES_LEIDOS, sinLeer || 1));
  const ultimos = suyos.slice(-k);
  const ultimo = ultimos[ultimos.length - 1];
  const hace = haceCuanto(ultimo.cuando, ahora);
  const dichos = ultimos.map(dichoDeMensaje).join(tr(', y luego ', ', then '));
  const texto =
    ultimos.length === 1
      ? tr(`${nombre} te escribió ${hace}: ${dichos}.`, `${nombre} wrote to you ${hace}: ${dichos}.`)
      : tr(`${nombre} te mandó ${ultimos.length} mensajes, el último ${hace}: ${dichos}.`, `${nombre} sent you ${ultimos.length} messages, the last one ${hace}: ${dichos}.`);
  return recortar(texto, MAX_LECTURA);
}

/** Lo nuevo de todos: quién te escribió y lo último de cada uno (hasta tres chats). */
export function lecturaDeTodos(conversaciones: RELEVO.Conversacion[], yo: string, ahora: number = Date.now()): string {
  const nuevas = conversaciones.filter((c) => !c.esGrupo && c.sinLeer > 0 && c.ultimo && c.ultimo.de?.toLowerCase() !== yo.toLowerCase());
  if (!nuevas.length) return tr('No tienes mensajes nuevos.', 'You have no new messages.');
  const leidas = nuevas.slice(0, MAX_CHATS_LEIDOS);
  const partes = leidas.map((c) => tr(`${c.nombre}, ${haceCuanto(c.ultimo!.cuando, ahora)}: ${dichoDeMensaje(c.ultimo)}`, `${c.nombre}, ${haceCuanto(c.ultimo!.cuando, ahora)}: ${dichoDeMensaje(c.ultimo)}`));
  const mas = nuevas.length - leidas.length;
  const cabeza =
    nuevas.length === 1
      ? tr('Tienes mensajes nuevos de una persona.', 'You have new messages from one person.')
      : tr(`Tienes mensajes nuevos de ${nuevas.length} personas.`, `You have new messages from ${nuevas.length} people.`);
  const cola = mas > 0 ? tr(` Y ${mas} más en tus chats.`, ` And ${mas} more in your chats.`) : '';
  return recortar(`${cabeza} ${partes.join('. ')}.${cola}`, MAX_LECTURA);
}

const plegar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export type Encontrado = { correo: string; nombre: string; veces: number; ultimo: number };

/** En qué chats aparece lo buscado (sin acentos ni mayúsculas), los de más coincidencias primero. */
export function buscarEnHilos(q: string, hilos: { correo: string; nombre: string; mensajes: RELEVO.Mensaje[] }[]): Encontrado[] {
  const aguja = plegar(q);
  if (aguja.length < 2) return [];
  const out: Encontrado[] = [];
  for (const h of hilos) {
    let veces = 0;
    let ultimo = 0;
    for (const m of h.mensajes) {
      if (m.borrado || m.cerrado || !m.texto) continue;
      if (plegar(m.texto).includes(aguja)) {
        veces++;
        ultimo = Math.max(ultimo, m.cuando || 0);
      }
    }
    if (veces) out.push({ correo: h.correo, nombre: h.nombre, veces, ultimo });
  }
  return out.sort((a, b) => b.veces - a.veces || b.ultimo - a.ultimo);
}

/** Lo que AURA dice de una búsqueda: en qué chats, nunca qué decía. */
export function dichoDeBusqueda(q: string, r: Encontrado[]): string {
  const que = recortar(q, 60);
  if (!r.length) return tr(`No encontré «${que}» en tus chats recientes.`, `I couldn't find “${que}” in your recent chats.`);
  if (r.length === 1) return tr(`Lo encontré en el chat con ${r[0].nombre}. Te lo abro.`, `I found it in your chat with ${r[0].nombre}. Opening it.`);
  const nombres = r.slice(0, 3).map((x) => x.nombre);
  const lista = nombres.length === 2 ? nombres.join(tr(' y ', ' and ')) : `${nombres.slice(0, -1).join(', ')}${tr(' y ', ' and ')}${nombres.at(-1)}`;
  const mas = r.length > 3 ? tr(` (y ${r.length - 3} más)`, ` (and ${r.length - 3} more)`) : '';
  return tr(`Lo encontré en ${r.length} chats: ${lista}${mas}. Te abro el de ${r[0].nombre}.`, `I found it in ${r.length} chats: ${lista}${mas}. Opening ${r[0].nombre}'s.`);
}

/* ── los manejadores ──────────────────────────────────────────────────────────────────────── */

function fallo(a: AccionApp, detalle: string) {
  // Leer y buscar dicen su fallo por el mismo camino que su resultado (con su boleto).
  if ((a.tipo === 'leer' || a.tipo === 'buscar') && a.boleto) emitir('lectura', { texto: detalle, boleto: a.boleto });
  emitir('hecho', { accion: a, ok: false, detalle });
}

function decir(a: De<'leer'> | De<'buscar'>, texto: string) {
  emitir('lectura', { texto, ...(a.boleto ? { boleto: a.boleto } : {}) });
  emitir('hecho', { accion: a, ok: true });
}

let ultimaLlamada: { correo: string; en: number } | null = null;

export async function llamar(a: De<'llamar'>, ahora: number = Date.now()) {
  if (!RELEVO.quien()) return fallo(a, tr('El chat no está conectado: sin él no puedo llamar.', "The chat isn't connected, so I can't call."));
  const c = await quienEs(a.con);
  if (!c) return fallo(a, tr(`No encuentro a «${a.con}» entre tus contactos.`, `I can't find “${a.con}” in your contacts.`));
  // La misma orden que volvió (por el SSE y en la respuesta del turno): ya se está marcando.
  if (ultimaLlamada && ultimaLlamada.correo === c.correo && ahora - ultimaLlamada.en < VENTANA_LLAMADA_MS) return;
  if (LLAMADA.enLlamada()) return fallo(a, tr('Ya estás en una llamada.', "You're already on a call."));
  ultimaLlamada = { correo: c.correo, en: ahora };
  try {
    // El motor espera a que AURA suelte el audio antes de abrir el suyo; ella se apaga al empezar.
    await LLAMADA.llamar(c.correo, !!a.video);
    emitir('hecho', { accion: a, ok: true, detalle: a.video ? tr(`Videollamada con ${c.nombre}.`, `Video call with ${c.nombre}.`) : tr(`Llamando a ${c.nombre}.`, `Calling ${c.nombre}.`) });
  } catch (e: any) {
    fallo(
      a,
      e?.motivo === 'sin-permiso'
        ? tr('Necesito permiso del micrófono (y de la cámara para video) para llamar.', 'I need microphone (and camera for video) permission to call.')
        : tr('No pude hacer la llamada ahora.', "I couldn't place the call right now.")
    );
  }
}

export async function leer(a: De<'leer'>, ahora: number = Date.now()) {
  const yo = RELEVO.quien()?.correo;
  if (!yo) return fallo(a, tr('El chat no está conectado.', "The chat isn't connected."));
  if (a.de) {
    const c = await quienEs(a.de);
    if (!c) return fallo(a, tr(`No encuentro a «${a.de}» entre tus contactos.`, `I can't find “${a.de}” in your contacts.`));
    await Promise.all([CHATS.refrescarLista().catch(() => undefined), CHATS.refrescarHilo(c.correo).catch(() => false)]);
    const h = CHATS.estadoHilo(c.correo);
    if (!h.mensajes?.length && h.error) return fallo(a, tr('No pude abrir ese chat ahora. Revisa la conexión.', "I couldn't open that chat right now. Check the connection."));
    const sinLeer = CHATS.estadoLista().conversaciones?.find((x) => x.correo === c.correo)?.sinLeer || 0;
    return decir(a, lecturaDePersona(c.nombre, h.mensajes || [], yo, sinLeer, ahora));
  }
  await CHATS.refrescarLista().catch(() => undefined);
  const l = CHATS.estadoLista();
  if (!l.conversaciones?.length && l.error) return fallo(a, tr('No pude ver tus chats ahora. Revisa la conexión.', "I couldn't check your chats right now. Check the connection."));
  return decir(a, lecturaDeTodos(l.conversaciones || [], yo, ahora));
}

export async function buscar(a: De<'buscar'>) {
  if (!RELEVO.quien()) return fallo(a, tr('El chat no está conectado.', "The chat isn't connected."));
  await CHATS.refrescarLista().catch(() => undefined);
  const recientes = (CHATS.estadoLista().conversaciones || []).filter((c) => !c.esGrupo).slice(0, MAX_CHATS_BUSQUEDA);
  // Uno por uno: el relevo y el descifrado no se atoran con ocho hilos a la vez.
  for (const c of recientes) await CHATS.refrescarHilo(c.correo).catch(() => false);
  const hilos = recientes.map((c) => ({ correo: c.correo, nombre: c.nombre, mensajes: CHATS.estadoHilo(c.correo).mensajes || (c.ultimo ? [c.ultimo] : []) }));
  const r = buscarEnHilos(a.q, hilos);
  if (r.length) emitir('accion', { tipo: 'abrir_chat', con: r[0].correo });
  return decir(a, dichoDeBusqueda(a.q, r));
}

/* ── lo que llega por el bus ──────────────────────────────────────────────────────────────── */

// Una sola vez aunque el módulo se evalúe de nuevo (recarga en caliente): la marca vive en el global.
const g = globalThis as { __auraManosChat?: () => void };
g.__auraManosChat?.();
g.__auraManosChat = escuchar('accion', (a) => {
  if (a.tipo === 'llamar') void llamar(a);
  else if (a.tipo === 'leer') void leer(a);
  else if (a.tipo === 'buscar') void buscar(a);
});

/** Al salir de la cuenta se olvida la última llamada pedida. */
RELEVO.alSalir(() => {
  ultimaLlamada = null;
});
