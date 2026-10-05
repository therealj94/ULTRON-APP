/**
 * WHATSAPP EN EL CENTRO: lo que se calcula sin pantalla (puro y probado en test/whatsapp.test.mjs).
 *
 *   · la hora de Honduras (UTC−6 todo el año, sin horario de verano): «hoy 14:05», «ayer», «28 sep»;
 *   · qué se dice de cada mensaje que no es texto: «🎤 Nota de voz (0:12)», «🚫 Mensaje eliminado»…;
 *   · el renglón de cada chat en la lista («Tú: …», «Mario: …» en los grupos), el orden y los sin leer;
 *   · en qué paso está (vincular, listo…) y cada cuánto se pregunta;
 *   · el envío optimista: lo que escribiste aparece ya, y se junta con lo que devuelve el servidor sin duplicarse.
 *
 * Los datos son los de server/whatsapp.ts (GET /api/whatsapp/estado, /chats, /mensajes). Nada de aquí sale a
 * la red: eso lo hace AURA (C#) por el puente (`whatsapp.*`, ver PUENTE.md).
 */

export type EstadoWA = {
  disponible?: boolean;
  permitido?: boolean;
  vinculado?: boolean;
  conectado?: boolean;
  numero?: string;
  nombre?: string;
  /** El QR para escanear con el teléfono (data:image/png;base64,…) mientras vincula. */
  qr?: string;
  /** El código de 8 letras para «Vincular con número de teléfono». */
  codigo?: string;
  vinculando?: boolean;
  error?: string;
};

export type ChatWA = { jid: string; nombre: string; grupo: boolean; noLeidos: number; hora: number; ultimo: string; ultimoMio: boolean; ultimoDe?: string };

export type TipoWA = 'texto' | 'imagen' | 'video' | 'audio' | 'documento' | 'sticker' | 'ubicacion' | 'contacto' | 'encuesta' | string;

export type MensajeWA = {
  id: string;
  chat: string;
  de: string;
  nombreDe: string;
  mio: boolean;
  hora: number;
  tipo: TipoWA;
  texto: string;
  /** JPEG pequeño en base64 (sin «data:»). */
  miniatura?: string;
  /** Segundos (audio y video). */
  duracion?: number;
  /** Nombre del documento. */
  archivo?: string;
  conMedia?: boolean;
  eliminado?: boolean;
  editado?: boolean;
  /** Solo aquí (envío optimista): todavía no contestó el servidor. */
  pendiente?: boolean;
  /** Solo aquí: el servidor dijo que no; `motivo` es su texto. */
  fallido?: boolean;
  motivo?: string;
};

/** Cada cuánto se pregunta, y solo con el panel a la vista. */
export const SONDEO = { estadoVinculando: 3_000, estadoListo: 30_000, chats: 5_000, hilo: 3_000 } as const;
/** Lo mismo que acepta el servidor y el puente (C#: PuenteWhatsApp.TextoMax). */
export const TEXTO_MAX = 4000;
/** Los ids que pone el envío optimista (nunca vienen del servidor). */
export const PREFIJO_LOCAL = 'local-';

const DIA = 86_400_000;
/** Honduras: UTC−6 todo el año. */
const HN = -6 * 3_600_000;
const PEGADAS_MS = 5 * 60_000;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** La fecha y hora en Honduras, sin depender de la zona del equipo. */
export function enHonduras(ms: number) {
  const d = new Date(ms + HN);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth(), dia: d.getUTCDate(), semana: d.getUTCDay(), h: d.getUTCHours(), m: d.getUTCMinutes() };
}

/** El número de día (en Honduras) de un instante: dos instantes del mismo día dan lo mismo. */
const diaHN = (ms: number) => Math.floor((ms + HN) / DIA);

/** Cuántos días atrás (en el calendario de Honduras): 0 hoy, 1 ayer… */
export function diasAtras(ms: number, ahora = Date.now()): number {
  return diaHN(ahora) - diaHN(ms);
}

const dos = (n: number) => String(n).padStart(2, '0');

/** «14:05» (24 horas, hora de Honduras). */
export function horaHN(ms: number): string {
  if (!ms) return '';
  const f = enHonduras(ms);
  return `${dos(f.h)}:${dos(f.m)}`;
}

/** La hora de la lista de chats: «hoy 14:05», «ayer», «28 sep» o «28/09/25» (otro año). */
export function cuandoChat(ms: number, ahora = Date.now(), en = false): string {
  if (!ms) return '';
  const n = diasAtras(ms, ahora);
  if (n <= 0) return `${en ? 'today' : 'hoy'} ${horaHN(ms)}`;
  if (n === 1) return en ? 'yesterday' : 'ayer';
  const f = enHonduras(ms);
  if (f.ano === enHonduras(ahora).ano) return en ? `${MONTHS[f.mes]} ${f.dia}` : `${f.dia} ${MESES[f.mes]}`;
  return en ? `${dos(f.mes + 1)}/${dos(f.dia)}/${String(f.ano).slice(2)}` : `${dos(f.dia)}/${dos(f.mes + 1)}/${String(f.ano).slice(2)}`;
}

/** El separador de días en la conversación: «Hoy», «Ayer», «lunes 28 de septiembre», «28 de septiembre de 2025». */
export function etiquetaDia(ms: number, ahora = Date.now(), en = false): string {
  const n = diasAtras(ms, ahora);
  if (n <= 0) return en ? 'Today' : 'Hoy';
  if (n === 1) return en ? 'Yesterday' : 'Ayer';
  const f = enHonduras(ms);
  const mismoAno = f.ano === enHonduras(ahora).ano;
  if (en) return mismoAno ? `${DAYS[f.semana]}, ${MONTHS[f.mes]} ${f.dia}` : `${MONTHS[f.mes]} ${f.dia}, ${f.ano}`;
  return mismoAno ? `${DIAS[f.semana]} ${f.dia} de ${MESES_LARGOS[f.mes]}` : `${f.dia} de ${MESES_LARGOS[f.mes]} de ${f.ano}`;
}

/** «0:12», «12:05», «1:02:03». */
export function duracion(segundos?: number): string {
  const s = Math.max(0, Math.round(Number(segundos) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${dos(m)}:${dos(r)}` : `${m}:${dos(r)}`;
}

/** Un renglón: sin saltos ni espacios de más, recortado sin partir un emoji. */
export function recortar(texto: string, max = 80): string {
  const plano = String(texto || '').replace(/\s+/g, ' ').trim();
  const letras = Array.from(plano);
  return letras.length > max ? letras.slice(0, max - 1).join('').trimEnd() + '…' : plano;
}

/**
 * Lo que se dice de un mensaje que no es (solo) texto: «📷 Foto», «🎤 Nota de voz (0:12)», «📄 contrato.pdf»,
 * «🚫 Mensaje eliminado». Vacío para el texto normal.
 */
export function etiquetaTipo(m: Pick<MensajeWA, 'tipo' | 'duracion' | 'archivo' | 'eliminado'>, en = false): string {
  if (m.eliminado) return en ? '🚫 Message deleted' : '🚫 Mensaje eliminado';
  const d = m.duracion ? ` (${duracion(m.duracion)})` : '';
  switch (m.tipo) {
    case 'texto':
    case '':
    case undefined:
      return '';
    case 'imagen': return en ? '📷 Photo' : '📷 Foto';
    case 'video': return '🎥 Video' + d;
    case 'audio': return (en ? '🎤 Voice note' : '🎤 Nota de voz') + d;
    case 'documento': return '📄 ' + (recortar(m.archivo || '', 60) || (en ? 'Document' : 'Documento'));
    case 'sticker': return '💟 Sticker';
    case 'ubicacion': return en ? '📍 Location' : '📍 Ubicación';
    case 'contacto': return en ? '👤 Contact' : '👤 Contacto';
    case 'encuesta': return en ? '📊 Poll' : '📊 Encuesta';
    default: return en ? '📎 Message' : '📎 Mensaje';
  }
}

/** El primer nombre (para «Mario: …» en los grupos). Un número se deja entero. */
export function primerNombre(nombre?: string): string {
  const n = String(nombre || '').trim();
  if (!n || /^[+\d]/.test(n)) return n;
  return n.split(/\s+/)[0];
}

/** El renglón gris de un chat en la lista: «Tú: …», «Mario: …» (grupos) o el mensaje solo. */
export function vistaPrevia(c: Pick<ChatWA, 'ultimo' | 'ultimoMio' | 'ultimoDe' | 'grupo'>, en = false): string {
  const texto = recortar(c.ultimo || '', 90);
  if (!texto) return '';
  if (c.ultimoMio) return (en ? 'You: ' : 'Tú: ') + texto;
  if (c.grupo && c.ultimoDe) return `${primerNombre(c.ultimoDe)}: ${texto}`;
  return texto;
}

/** La lista, del más reciente al más viejo (el mismo orden de WhatsApp); a igual hora, por nombre. */
export function ordenarChats(chats: ChatWA[]): ChatWA[] {
  return [...chats].sort((a, b) => (b.hora || 0) - (a.hora || 0) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

/** Cuántos mensajes sin leer en total (para la pestaña). */
export function totalNoLeidos(chats: ChatWA[] | null | undefined): number {
  return (chats || []).reduce((s, c) => s + Math.max(0, Math.floor(Number(c.noLeidos) || 0)), 0);
}

/** El número de la insignia: «» (nada), «3», «99+». */
export function insignia(n: number): string {
  if (!(n > 0)) return '';
  return n > 99 ? '99+' : String(Math.floor(n));
}

/** Para buscar sin tildes ni mayúsculas. */
export function normalizar(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Filtra la lista mientras llega la búsqueda del servidor (por nombre o número). */
export function filtrarChats(chats: ChatWA[], buscar: string): ChatWA[] {
  const q = normalizar(buscar);
  if (!q) return chats;
  const cifras = q.replace(/\D/g, '');
  return chats.filter((c) => normalizar(c.nombre).includes(q) || (cifras.length >= 3 && c.jid.split('@')[0].includes(cifras)));
}

/** Las iniciales de la cara: «KM» de «Karla Martínez»; un número o nada, «#». */
export function iniciales(nombre: string): string {
  const limpio = String(nombre || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!limpio || /^[\d\s]+$/.test(limpio)) return '#';
  const p = limpio.split(/\s+/);
  return (Array.from(p[0])[0] + (p.length > 1 ? Array.from(p[p.length - 1])[0] : '')).toUpperCase();
}

/** «50499887766@s.whatsapp.net» → «+504 9988-7766» (Honduras); otros países, «+1 5551234567». Grupos: «». */
export function numeroDeJid(jid: string): string {
  const [u, dom] = String(jid || '').split('@');
  if (!u || dom === 'g.us' || !/^\d{6,15}$/.test(u.split(':')[0])) return '';
  const n = u.split(':')[0];
  if (n.startsWith('504') && n.length === 11) return `+504 ${n.slice(3, 7)}-${n.slice(7)}`;
  return '+' + n;
}

/* ── el paso en que está ───────────────────────────────────────────────────────────────────── */

export type Fase = 'cargando' | 'oculto' | 'sin-puente' | 'vincular' | 'listo';

/**
 * `undefined`: todavía no se sabe. `null` (no contestó, sin sesión) o permitido=false: no se muestra NADA
 * (ni la pestaña). Sin el puente configurado en el servidor: se dice. Si no, vincular o listo.
 */
export function fase(e: EstadoWA | null | undefined): Fase {
  if (e === undefined) return 'cargando';
  if (!e || !e.permitido) return 'oculto';
  if (!e.disponible) return 'sin-puente';
  return e.vinculado ? 'listo' : 'vincular';
}

/** Cada cuánto se vuelve a preguntar el estado (0 = no): rápido mientras se vincula (el QR cambia), lento ya vinculado. */
export function sondeoEstado(e: EstadoWA | null | undefined): number {
  const f = fase(e);
  if (f === 'vincular') return SONDEO.estadoVinculando;
  if (f === 'listo') return SONDEO.estadoListo;
  return 0;
}

/**
 * ¿Hay que pedir un QR nuevo? Al llegar a «vincular» sin QR ni código ni vinculación en curso (una vez: si el
 * QR vence, la persona toca «Otro QR»; el servidor limita /vincular a 10 por minuto). Y solo si ya aceptó lo que
 * implica (`consentido`): ahora cualquier cuenta de AU-RA puede agregar su WhatsApp (José, 5-oct), y pedir un QR
 * le abre una cuenta en el puente; abrir el panel no lo hace solo.
 */
export function pedirQr(e: EstadoWA | null | undefined, yaPedido: boolean, consentido: boolean): boolean {
  return consentido && fase(e) === 'vincular' && !yaPedido && !e!.qr && !e!.codigo && !e!.vinculando;
}

/** Lo que acepta antes de vincular (lo mismo que en la app: mobile/src/whatsapp/logica.ts textoConsentimientoWA). */
export function textoConsentimiento(en = false): string {
  return en
    ? 'Your WhatsApp messages are stored on the AU-RA server so you can see and answer them here. You can unlink it whenever you want (everything is erased). This connection isn’t official for WhatsApp and it could limit your account.'
    : 'Tus mensajes de WhatsApp se guardan en el servidor de AU-RA para que puedas verlos y contestarlos aquí. Puedes desvincularlo cuando quieras (se borra todo). WhatsApp no es oficial con esta conexión y podría limitar tu cuenta.';
}

/** El código de vincular, legible: «ABCDEFGH» → «ABCD-EFGH». */
export function codigoBonito(codigo?: string): string {
  const c = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** El número para vincular: solo cifras; 8 cifras son de Honduras (se le pone el 504). Válido con 10–15 cifras. */
export function telefonoParaVincular(t: string): { numero: string; valido: boolean } {
  let n = String(t || '').replace(/\D/g, '');
  if (n.length === 8) n = '504' + n;
  return { numero: n, valido: n.length >= 10 && n.length <= 15 };
}

/** ¿Se puede enviar? Algo escrito y no más de 4000 letras. */
export function textoEnviable(t: string): boolean {
  return !!String(t || '').trim() && String(t).length <= TEXTO_MAX;
}

/* ── la conversación ───────────────────────────────────────────────────────────────────────── */

/** El mensaje optimista: aparece ya, con su reloj, mientras AURA lo manda. */
export function mensajeLocal(chat: string, texto: string, n: number, ahora = Date.now()): MensajeWA {
  return { id: `${PREFIJO_LOCAL}${n}`, chat, de: '', nombreDe: '', mio: true, hora: ahora, tipo: 'texto', texto, pendiente: true };
}

/**
 * Junta lo que dice el servidor con lo optimista que todavía no aparece allá. Un pendiente se quita cuando el
 * servidor ya trae un mensaje MÍO con el mismo texto y de cerca de esa hora (aunque no haya contestado el
 * envío todavía: el sondeo puede llegar antes); los fallidos se quedan hasta que la persona los quite.
 */
export function fusionarMensajes(servidor: MensajeWA[], locales: MensajeWA[]): MensajeWA[] {
  const usados = new Set<string>();
  const quedan: MensajeWA[] = [];
  for (const l of locales) {
    if (l.fallido) {
      quedan.push(l);
      continue;
    }
    const igual = servidor.find((s) => s.mio && !usados.has(s.id) && s.texto === l.texto && s.hora >= l.hora - 120_000);
    if (igual) usados.add(igual.id);
    else quedan.push(l);
  }
  const vistos = new Set<string>();
  const todos: MensajeWA[] = [];
  for (const m of [...servidor, ...quedan]) {
    if (vistos.has(m.id)) continue;
    vistos.add(m.id);
    todos.push(m);
  }
  // Del más viejo al más nuevo; a igual hora, el orden en que llegaron (sort es estable).
  return todos.sort((a, b) => (a.hora || 0) - (b.hora || 0));
}

/** Lo de antes (al subir) junto con lo que ya está, sin repetir. */
export function juntarAnteriores(anteriores: MensajeWA[], actuales: MensajeWA[]): MensajeWA[] {
  return fusionarMensajes([...anteriores, ...actuales.filter((m) => !m.id.startsWith(PREFIJO_LOCAL))], actuales.filter((m) => m.id.startsWith(PREFIJO_LOCAL)));
}

/** ¿Llegó algo nuevo de la otra persona desde `desde` (ms)? Entonces se marca leído otra vez (lo estás viendo). */
export function hayNuevoSuyo(mensajes: MensajeWA[], desde: number): boolean {
  return mensajes.some((m) => !m.mio && m.hora > desde);
}

export type FilaWA =
  | { tipo: 'dia'; clave: string; texto: string }
  | { tipo: 'msg'; clave: string; m: MensajeWA; primera: boolean; ultima: boolean; autor: boolean };

/**
 * Las filas de la conversación: un separador por día (de Honduras) y las burbujas del mismo remitente, el
 * mismo día y con menos de cinco minutos entre sí, pegadas. En un grupo, el nombre de quien escribe va en la
 * primera de cada tanda (`autor`).
 */
export function filasConversacion(mensajes: MensajeWA[], grupo: boolean, ahora = Date.now(), en = false): FilaWA[] {
  const filas: FilaWA[] = [];
  const quien = (m: MensajeWA) => (m.mio ? '·yo' : m.de || m.nombreDe);
  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i];
    const antes = mensajes[i - 1];
    const despues = mensajes[i + 1];
    const nuevoDia = !antes || diaHN(antes.hora) !== diaHN(m.hora);
    if (nuevoDia) filas.push({ tipo: 'dia', clave: 'dia-' + diaHN(m.hora), texto: etiquetaDia(m.hora, ahora, en) });
    const pegadaAntes = !nuevoDia && !!antes && quien(antes) === quien(m) && m.hora - antes.hora < PEGADAS_MS;
    const pegadaDespues = !!despues && diaHN(despues.hora) === diaHN(m.hora) && quien(despues) === quien(m) && despues.hora - m.hora < PEGADAS_MS;
    filas.push({ tipo: 'msg', clave: m.id, m, primera: !pegadaAntes, ultima: !pegadaDespues, autor: grupo && !m.mio && !pegadaAntes });
  }
  return filas;
}
