/**
 * WHATSAPP EN LA APP (la lógica, sin React Native): qué se ve de su WhatsApp personal (server/whatsapp.ts).
 * José (2-oct): «WhatsApp personal… en la app debo poder verlo y contestar y todo, una opción aparte de
 * PULSE2CHAT, slide y cambia».
 *
 * La pantalla (whatsapp/PantallaWhatsapp.tsx) solo dibuja: qué pantalla toca (vincular, lista, chat), cómo
 * se dice cada mensaje y cómo se agrupan las burbujas sale de aquí. Lo prueba whatsapp/pruebas.
 */

export type EstadoWA = {
  disponible: boolean;
  permitido: boolean;
  vinculado: boolean;
  conectado?: boolean;
  numero?: string;
  nombre?: string;
  qr?: string;
  codigo?: string;
  vinculando?: boolean;
  error?: string;
};

/**
 * Un chat de la lista. Todo lo que no sea `jid` puede faltar o venir vacío (el puente lo arma con lo que
 * WhatsApp le dio): la pantalla nunca descarta un chat por eso. `numero` («+504…») solo en chats de dos.
 */
export type ChatWA = {
  jid: string;
  nombre: string;
  grupo: boolean;
  noLeidos: number;
  hora: number;
  ultimo: string;
  ultimoMio: boolean;
  ultimoDe?: string;
  numero?: string;
  /** ¿Tiene foto de perfil? true/false si el puente lo sabe; null o ausente: no se sabe, hay que pedirla. */
  foto?: boolean | null;
};

/** Un contacto guardado en su teléfono (GET /api/whatsapp/contactos): para empezar un chat nuevo. */
export type ContactoWA = { jid: string; nombre: string; numero: string };
export type MensajeWA = {
  id: string;
  chat: string;
  de: string;
  nombreDe: string;
  mio: boolean;
  hora: number;
  tipo: string;
  texto: string;
  miniatura?: string;
  duracion?: number;
  archivo?: string;
  conMedia?: boolean;
  eliminado?: boolean;
  editado?: boolean;
  /** Solo en la app: va saliendo (todavía no lo confirmó el puente) o no salió. */
  enviando?: boolean;
  fallo?: string;
};

/** Qué pantalla toca. «oculto»: esta cuenta no tiene WhatsApp (no se ve ni la pestaña). */
export type VistaWA = 'oculto' | 'revisando' | 'sin_puente' | 'vincular' | 'listo';

export function vistaDe(e: EstadoWA | null): VistaWA {
  if (!e) return 'revisando';
  if (!e.permitido) return 'oculto';
  if (!e.disponible) return 'sin_puente';
  if (!e.vinculado) return 'vincular';
  return 'listo';
}

/** «0:12», «3:05», «1:02:03». */
export function duracionTexto(s?: number): string {
  const n = Math.max(0, Math.round(s || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const ss = String(n % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Lo que dice una burbuja que no es solo texto (el pie de foto va aparte, debajo). */
export function etiquetaMedia(m: Pick<MensajeWA, 'tipo' | 'duracion' | 'archivo' | 'texto'>, idioma: 'es' | 'en' = 'es'): string | null {
  const en = idioma === 'en';
  switch (m.tipo) {
    case 'imagen':
      return en ? '📷 Photo' : '📷 Foto';
    case 'video':
      return `🎥 Video${m.duracion ? ` (${duracionTexto(m.duracion)})` : ''}`;
    case 'audio':
      return `${en ? '🎤 Voice note' : '🎤 Nota de voz'}${m.duracion ? ` (${duracionTexto(m.duracion)})` : ''}`;
    case 'documento':
      return `📄 ${m.archivo || (en ? 'Document' : 'Documento')}`;
    case 'sticker':
      return 'Sticker';
    case 'ubicacion':
      return `📍 ${m.texto || (en ? 'Location' : 'Ubicación')}`;
    case 'contacto':
      return `👤 ${m.texto || (en ? 'Contact' : 'Contacto')}`;
    case 'encuesta':
      return `📊 ${m.texto || (en ? 'Poll' : 'Encuesta')}`;
    default:
      return null;
  }
}

/** El texto que va en la burbuja (además de la etiqueta): el mensaje o el pie de foto. */
export function textoBurbuja(m: MensajeWA): string {
  if (m.eliminado) return '';
  if (m.tipo === 'ubicacion' || m.tipo === 'contacto' || m.tipo === 'encuesta') return '';
  return m.texto || '';
}

export function totalNoLeidos(chats: ChatWA[] | null): number {
  return (chats || []).reduce((n, c) => n + (c.noLeidos > 0 ? 1 : 0), 0);
}

/** La vista previa de un chat en la lista: «Tú: …» o, en un grupo, «Mamá: …». */
export function previa(c: Pick<ChatWA, 'ultimoMio' | 'grupo' | 'ultimoDe' | 'ultimo'>, idioma: 'es' | 'en' = 'es'): string {
  const quien = c.ultimoMio ? (idioma === 'en' ? 'You: ' : 'Tú: ') : c.grupo && c.ultimoDe ? `${nombrePersona(c.ultimoDe, idioma)}: ` : '';
  return `${quien}${c.ultimo || ''}`;
}

/* ── números y nombres ────────────────────────────────────────────────────────────────────── */

/** Los dominios de un jid que SÍ llevan el número de teléfono (un «@lid» es un id interno, no un número). */
const DOMINIOS_TELEFONO = new Set(['s.whatsapp.net', 'c.us']);

/** El número (solo dígitos) que lleva un jid de persona; «» para grupos, «@lid», difusiones o lo que no sea número. */
export function digitosDeJid(jid: string): string {
  const [usuario = '', dominio = ''] = String(jid || '').split('@');
  if (!DOMINIOS_TELEFONO.has(dominio.toLowerCase())) return '';
  const d = usuario.split(':')[0].split('.')[0];
  return /^\d{7,15}$/.test(d) ? d : '';
}

/** Solo los dígitos de un número escrito de cualquier forma («+504 9999-8888» → «50499998888»); «» si no parece número. */
export function soloDigitos(t?: string | null): string {
  const s = String(t || '').trim();
  if (!s || /[a-z]/i.test(s)) return '';
  const d = s.replace(/\D/g, '');
  return d.length >= 7 && d.length <= 15 ? d : '';
}

/** El número del chat (dígitos): el que manda el servidor o el del jid. «» en grupos y en «@lid» sin número. */
export function numeroChat(c: Pick<ChatWA, 'jid' | 'grupo'> & { numero?: string }): string {
  if (c.grupo || /@g\.us$/i.test(c.jid || '')) return '';
  return soloDigitos(c.numero) || digitosDeJid(c.jid);
}

/** Códigos de país, de los más largos a los más cortos (los que más se ven en sus chats primero). */
const PAISES: Array<[string, (resto: string) => string]> = [
  // Centroamérica: ocho dígitos, «9999-8888».
  ...['502', '503', '504', '505', '506', '507'].map((cc) => [cc, (r: string) => (r.length === 8 ? `${r.slice(0, 4)}-${r.slice(4)}` : grupos(r))] as [string, (r: string) => string]),
  ['1', (r) => (r.length === 10 ? `${r.slice(0, 3)}-${r.slice(3, 6)}-${r.slice(6)}` : grupos(r))],
  ['52', (r) => (r.length === 10 ? `${r.slice(0, 2)} ${r.slice(2, 6)} ${r.slice(6)}` : r.length === 11 && r[0] === '1' ? `1 ${r.slice(1, 3)} ${r.slice(3, 7)} ${r.slice(7)}` : grupos(r))],
  ['34', (r) => (r.length === 9 ? `${r.slice(0, 3)} ${r.slice(3, 5)} ${r.slice(5, 7)} ${r.slice(7)}` : grupos(r))],
  ['57', (r) => (r.length === 10 ? `${r.slice(0, 3)} ${r.slice(3, 6)} ${r.slice(6)}` : grupos(r))],
];

function grupos(r: string): string {
  // De tres en tres, y los cuatro últimos juntos: «9999 8888», «123 4567 8901».
  if (r.length <= 4) return r;
  const fin = r.slice(-4);
  const cabeza = r.slice(0, -4);
  const partes: string[] = [];
  for (let i = cabeza.length; i > 0; i -= 3) partes.unshift(cabeza.slice(Math.max(0, i - 3), i));
  return `${partes.join(' ')} ${fin}`;
}

/** El número como lo escribe una persona: «+504 9999-8888», «+1 305-555-1234». «» si no es un número. */
export function telefonoBonito(t?: string | null): string {
  const d = soloDigitos(t);
  if (!d) return '';
  for (const [cc, f] of PAISES) if (d.startsWith(cc) && d.length > cc.length + 6) return `+${cc} ${f(d.slice(cc.length))}`;
  // Otro país: el código (dos dígitos, lo más común) y el resto en grupos.
  return `+${d.slice(0, 2)} ${grupos(d.slice(2))}`;
}

/** ¿Es un nombre que en realidad es un número («50499998888», «+504 9999-8888»)? */
const pareceNumero = (s: string) => /^\+?[\d\s().-]{7,}$/.test(s.trim());

/** El nombre de quien escribe en un grupo: el que tiene, el número bonito, o «Alguien» (nunca vacío ni un id raro). */
export function nombrePersona(n?: string | null, idioma: 'es' | 'en' = 'es'): string {
  const s = String(n || '').trim();
  if (!s) return idioma === 'en' ? 'Someone' : 'Alguien';
  if (pareceNumero(s)) return telefonoBonito(s) || s;
  return s;
}

/**
 * El nombre que se ve: el de su agenda (o el que la persona se puso), si no el número bonito, y si no
 * «Grupo» o «Contacto». Nunca vacío, nunca un «@lid» disfrazado de número.
 */
export function nombreChat(c: Pick<ChatWA, 'nombre' | 'jid'> & { grupo?: boolean; numero?: string }, idioma: 'es' | 'en' = 'es'): string {
  const n = String(c.nombre || '').trim();
  const grupo = !!c.grupo || /@g\.us$/i.test(c.jid || '');
  if (n && !(pareceNumero(n) && !grupo)) return n;
  const num = grupo ? '' : numeroChat({ jid: c.jid, grupo, numero: c.numero }) || soloDigitos(n);
  if (num) return telefonoBonito(num);
  if (grupo) return idioma === 'en' ? 'Group' : 'Grupo';
  return idioma === 'en' ? 'Contact' : 'Contacto';
}

/** Lo que va debajo del nombre en la cabecera del chat: el número (si el nombre no lo es ya), «grupo» o nada. */
export function subtituloChat(c: Pick<ChatWA, 'nombre' | 'jid' | 'grupo'> & { numero?: string }, idioma: 'es' | 'en' = 'es'): string {
  if (c.grupo || /@g\.us$/i.test(c.jid || '')) return idioma === 'en' ? 'group' : 'grupo';
  const num = telefonoBonito(numeroChat(c));
  return num && num !== nombreChat(c, idioma) ? num : '';
}

/** Los dígitos para abrir el chat en la app de WhatsApp (wa.me); null en grupos o sin número. */
export function digitosLlamada(c: Pick<ChatWA, 'jid' | 'grupo'> & { numero?: string }): string | null {
  const d = numeroChat(c);
  return d && d.length >= 8 ? d : null;
}

/** Las dos formas de abrir su WhatsApp en ese contacto: la app y, si no abre, wa.me. */
export function enlacesWhatsapp(digitos: string): { app: string; web: string } {
  const d = String(digitos || '').replace(/\D/g, '');
  return { app: `whatsapp://send?phone=${d}`, web: `https://wa.me/${d}` };
}

/** Las iniciales del círculo sin foto («María José López» → «ML»); «» si el nombre es un número (va la silueta). */
export function inicialesWA(nombre: string): string {
  const s = String(nombre || '').trim();
  if (!s || pareceNumero(s)) return '';
  const palabras = s.split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w));
  const primera = (w: string) => (Array.from(w).find((ch) => /\p{L}|\p{N}/u.test(ch)) || '').toUpperCase();
  if (!palabras.length) return '';
  return palabras.length > 1 ? primera(palabras[0]) + primera(palabras[palabras.length - 1]) : primera(palabras[0]);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Colores del círculo sin foto: siempre el mismo para el mismo chat. */
const COLORES_AVATAR = ['#00A884', '#53BDEB', '#7F66FF', '#FA6533', '#FF2E74', '#1FA855', '#E6A117', '#06CF9C', '#A5B337', '#5E47DE'];
export function colorAvatar(clave: string): string {
  return COLORES_AVATAR[hash(String(clave || '')) % COLORES_AVATAR.length];
}

/** Los colores de los nombres en un grupo (los de WhatsApp), uno fijo por persona; el oscuro va más claro. */
const NOMBRES_CLARO = ['#1F7AEC', '#D62F6E', '#0E8F6F', '#C2570C', '#7B3FE4', '#B4296B', '#00866E', '#9A6A00', '#2E7D32', '#C0392B'];
const NOMBRES_OSCURO = ['#53BDEB', '#FF72A1', '#25D366', '#FFA36B', '#A791FF', '#FF8FB8', '#06CF9C', '#FFD279', '#7FD17F', '#FF8A80'];
export function colorNombre(clave: string, oscuro: boolean): string {
  const l = oscuro ? NOMBRES_OSCURO : NOMBRES_CLARO;
  return l[hash(String(clave || '')) % l.length];
}

/* ── horas y días ─────────────────────────────────────────────────────────────────────────── */

const DIA_MS = 86_400_000;
const diasEntre = (ms: number, ahora: number) => Math.round((inicioDia(ahora) - inicioDia(ms)) / DIA_MS);
const dos = (n: number) => String(n).padStart(2, '0');

/** «14:05». */
export function horaWA(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** La hora de la lista: hoy «14:05», «Ayer», y antes la fecha «28/09/26». */
export function horaLista(ms: number, ahora = Date.now(), idioma: 'es' | 'en' = 'es'): string {
  if (!ms) return '';
  const n = diasEntre(ms, ahora);
  if (n <= 0) return horaWA(ms);
  if (n === 1) return idioma === 'en' ? 'Yesterday' : 'Ayer';
  const d = new Date(ms);
  const aa = dos(d.getFullYear() % 100);
  return idioma === 'en' ? `${dos(d.getMonth() + 1)}/${dos(d.getDate())}/${aa}` : `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${aa}`;
}

const MESES = { es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'], en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };
const SEMANA = { es: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };

/** El separador de días del chat: «Hoy», «Ayer», el día de la semana (esta semana) o «28 de septiembre». */
export function etiquetaDiaWA(ms: number, ahora = Date.now(), idioma: 'es' | 'en' = 'es'): string {
  const n = diasEntre(ms, ahora);
  if (n <= 0) return idioma === 'en' ? 'Today' : 'Hoy';
  if (n === 1) return idioma === 'en' ? 'Yesterday' : 'Ayer';
  const d = new Date(ms);
  if (n < 7) return SEMANA[idioma][d.getDay()];
  const otroAno = d.getFullYear() !== new Date(ahora).getFullYear();
  if (idioma === 'en') return `${MESES.en[d.getMonth()]} ${d.getDate()}${otroAno ? `, ${d.getFullYear()}` : ''}`;
  return `${d.getDate()} de ${MESES.es[d.getMonth()]}${otroAno ? ` de ${d.getFullYear()}` : ''}`;
}

/* ── la vista previa con su icono ─────────────────────────────────────────────────────────── */

export type IconoPrevia = 'foto' | 'video' | 'audio' | 'documento' | 'sticker' | 'ubicacion' | 'contacto' | 'encuesta' | 'eliminado';

/** Las etiquetas con que el puente empieza la vista previa de lo que no es texto (servicios/whatsapp-puente, vistaPrevia). */
const ETIQUETAS: Array<[string, IconoPrevia, string, string]> = [
  ['📷 Foto', 'foto', 'Foto', 'Photo'],
  ['🎥 Video', 'video', 'Video', 'Video'],
  ['🎤 Nota de voz', 'audio', 'Nota de voz', 'Voice note'],
  ['📄 Documento', 'documento', 'Documento', 'Document'],
  ['Sticker', 'sticker', 'Sticker', 'Sticker'],
  ['📍 Ubicación', 'ubicacion', 'Ubicación', 'Location'],
  ['👤 Contacto', 'contacto', 'Contacto', 'Contact'],
  ['📊 Encuesta', 'encuesta', 'Encuesta', 'Poll'],
  ['🚫 Mensaje eliminado', 'eliminado', 'Se eliminó este mensaje', 'This message was deleted'],
];

/**
 * La vista previa de la lista en partes, para dibujarla como WhatsApp: quién («Tú», «Mamá»), el icono del
 * tipo (cámara, micrófono, documento…) y el texto (el pie de foto, o «Foto» si no trae).
 */
export function previaWA(c: Pick<ChatWA, 'ultimoMio' | 'grupo' | 'ultimoDe' | 'ultimo'>, idioma: 'es' | 'en' = 'es'): { quien: string; icono: IconoPrevia | null; texto: string } {
  const en = idioma === 'en';
  const quien = c.ultimoMio ? (en ? 'You' : 'Tú') : c.grupo && c.ultimoDe ? nombrePersona(c.ultimoDe, idioma) : '';
  const u = String(c.ultimo || '').replace(/\s+/g, ' ').trim();
  for (const [pref, icono, es, ing] of ETIQUETAS) {
    if (u === pref || u.startsWith(`${pref} · `)) {
      const resto = u.slice(pref.length).replace(/^ · /, '').trim();
      return { quien: icono === 'eliminado' ? '' : quien, icono, texto: resto || (en ? ing : es) };
    }
  }
  return { quien, icono: null, texto: u };
}

/** La previa como un solo texto (para leerla en voz alta: accesibilidad). */
export function previaTexto(c: Pick<ChatWA, 'ultimoMio' | 'grupo' | 'ultimoDe' | 'ultimo'>, idioma: 'es' | 'en' = 'es'): string {
  const v = previaWA(c, idioma);
  return `${v.quien ? `${v.quien}: ` : ''}${v.texto}`;
}

/** La previa de una nota de voz o un video con su duración («Nota de voz 0:12»). */
export function etiquetaConDuracion(tipo: string, duracion: number | undefined, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  const base = tipo === 'audio' ? (en ? 'Voice note' : 'Nota de voz') : tipo === 'video' ? 'Video' : tipo === 'imagen' ? (en ? 'Photo' : 'Foto') : tipo === 'documento' ? (en ? 'Document' : 'Documento') : tipo === 'sticker' ? 'Sticker' : '';
  return duracion && (tipo === 'audio' || tipo === 'video') ? `${base} ${duracionTexto(duracion)}` : base;
}

/** Cómo se dibuja un mensaje: foto y sticker se bajan solos; video, audio y documento tienen su tarjeta. */
export type FormaWA = 'texto' | 'imagen' | 'sticker' | 'video' | 'audio' | 'documento' | 'otro' | 'eliminado';
export function formaDe(m: Pick<MensajeWA, 'tipo' | 'eliminado'>): FormaWA {
  if (m.eliminado) return 'eliminado';
  switch (m.tipo) {
    case 'texto':
    case 'imagen':
    case 'sticker':
    case 'video':
    case 'audio':
    case 'documento':
      return m.tipo;
    default:
      return m.tipo ? 'otro' : 'texto';
  }
}

/** El nombre del archivo en el caché del teléfono para la foto o el archivo de un mensaje (sin «/», «@» ni «:»). */
export function archivoCache(chat: string, id: string, tipo: string, archivo?: string): string {
  const limpio = (s: string) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const ext =
    tipo === 'imagen' ? 'jpg' : tipo === 'sticker' ? 'webp' : tipo === 'audio' ? 'ogg' : tipo === 'video' ? 'mp4' : (/\.([a-z0-9]{1,5})$/i.exec(archivo || '')?.[1] || 'bin').toLowerCase();
  return `m-${limpio(chat)}-${limpio(id)}.${ext}`;
}

/** El de la foto de perfil de un chat. */
export function archivoFoto(chat: string): string {
  return `foto-${String(chat || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)}.jpg`;
}

/**
 * Una fila de espera: a lo más `max` tareas a la vez (las fotos de perfil de la lista no salen todas
 * juntas). Lo que entra último sale primero: lo que se acaba de mostrar en pantalla va antes.
 */
export function colaLimitada(max: number) {
  let activas = 0;
  const espera: Array<() => void> = [];
  const siguiente = () => {
    if (activas >= max) return;
    const f = espera.pop();
    if (f) f();
  };
  return function <T>(tarea: () => Promise<T>): Promise<T> {
    return new Promise<T>((listo, falla) => {
      espera.push(() => {
        activas++;
        let p: Promise<T>;
        try {
          p = tarea();
        } catch (e) {
          p = Promise.reject(e);
        }
        p.then(listo, falla).finally(() => {
          activas--;
          siguiente();
        });
      });
      siguiente();
    });
  };
}

/** Una huella barata de los mensajes: si no cambió, la pantalla no se vuelve a dibujar en cada vuelta. */
export function huellaMensajes(ms: MensajeWA[]): string {
  return ms.map((m) => `${m.id}${m.eliminado ? 'x' : ''}${m.editado ? 'e' : ''}${(m.texto || '').length}${m.conMedia ? 'm' : ''}`).join('|');
}

/** La de la lista de chats. */
export function huellaChats(cs: ChatWA[]): string {
  return cs.map((c) => `${c.jid}${c.hora}${c.noLeidos}${c.nombre || ''}${c.numero || ''}${String(c.foto)}${(c.ultimo || '').length}`).join('|');
}

/** Junta la lista con lo que el servidor encontró al buscar (chats viejos que no vienen en los 100 recientes), sin repetir. */
export function juntarChats(lista: ChatWA[], encontrados: ChatWA[]): ChatWA[] {
  const vistos = new Set(lista.map((c) => c.jid));
  return [...lista, ...encontrados.filter((c) => c && c.jid && !vistos.has(c.jid))];
}

/** ¿El chat coincide con lo que busca? Por nombre, número (con o sin espacios) o el último mensaje. */
export function coincide(c: ChatWA, q: string): boolean {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return true;
  if (nombreChat(c).toLowerCase().includes(t) || String(c.nombre || '').toLowerCase().includes(t)) return true;
  if (String(c.ultimo || '').toLowerCase().includes(t)) return true;
  const dq = t.replace(/\D/g, '');
  return dq.length >= 3 && numeroChat(c).includes(dq);
}

/** Lo que llega del servidor, con lo mínimo para dibujarlo: nunca se cae un chat por un campo que falte. */
export function normalizarChats(cs: unknown): ChatWA[] {
  if (!Array.isArray(cs)) return [];
  return cs
    .filter((c: any) => c && typeof c.jid === 'string' && c.jid)
    .map((c: any) => ({
      ...c,
      jid: c.jid,
      nombre: typeof c.nombre === 'string' ? c.nombre : '',
      grupo: !!c.grupo || /@g\.us$/i.test(c.jid),
      noLeidos: Number(c.noLeidos) > 0 ? Number(c.noLeidos) : 0,
      hora: Number(c.hora) || 0,
      ultimo: typeof c.ultimo === 'string' ? c.ultimo : '',
      ultimoMio: !!c.ultimoMio,
      ...(typeof c.numero === 'string' ? { numero: c.numero } : {}),
      ...(typeof c.foto === 'boolean' ? { foto: c.foto } : {}),
    }));
}

/** Los contactos del teléfono, con lo mínimo para dibujarlos (los que no tienen jid no sirven para escribir). */
export function normalizarContactos(cs: unknown): ContactoWA[] {
  if (!Array.isArray(cs)) return [];
  return cs
    .filter((c: any) => c && typeof c.jid === 'string' && c.jid)
    .map((c: any) => ({ jid: c.jid, nombre: typeof c.nombre === 'string' ? c.nombre : '', numero: typeof c.numero === 'string' ? c.numero : '' }));
}

/** Un contacto como chat para abrir la conversación (si ya hay chat con él, el de la lista, que trae más). */
export function chatDeContacto(k: ContactoWA, chats: ChatWA[] = []): ChatWA {
  const ya = chats.find((c) => c.jid === k.jid) || (soloDigitos(k.numero) ? chats.find((c) => !c.grupo && numeroChat(c) === soloDigitos(k.numero)) : undefined);
  if (ya) return ya;
  return { jid: k.jid, nombre: k.nombre, numero: k.numero, grupo: false, noLeidos: 0, hora: 0, ultimo: '', ultimoMio: false, foto: null };
}

export type FilaWA = { tipo: 'dia'; clave: string; ms: number } | { tipo: 'msg'; clave: string; m: MensajeWA; pegadaArriba: boolean; conNombre: boolean };

const PEGADAS_MS = 5 * 60_000;
const inicioDia = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Las filas del chat: un separador por día y las burbujas seguidas del mismo remitente (menos de cinco
 * minutos) pegadas; en un grupo, el nombre de quien escribe va en la primera de cada racha.
 */
export function filasWA(mensajes: MensajeWA[], grupo: boolean): FilaWA[] {
  const out: FilaWA[] = [];
  let anterior: MensajeWA | null = null;
  for (const m of mensajes) {
    if (!anterior || inicioDia(anterior.hora) !== inicioDia(m.hora)) {
      out.push({ tipo: 'dia', clave: `d-${inicioDia(m.hora)}`, ms: m.hora });
      anterior = null;
    }
    const mismo = !!anterior && anterior.mio === m.mio && anterior.de === m.de && m.hora - anterior.hora < PEGADAS_MS;
    out.push({ tipo: 'msg', clave: `m-${m.id}`, m, pegadaArriba: mismo, conNombre: grupo && !m.mio && !mismo });
    anterior = m;
  }
  return out;
}

/**
 * Junta lo que llegó del puente con lo que la app tiene saliendo: lo confirmado reemplaza al pendiente
 * (mismo texto, del mismo chat, en el último minuto) y lo que no salió se queda a la vista con su error.
 */
export function juntar(delPuente: MensajeWA[], locales: MensajeWA[]): MensajeWA[] {
  const pendientes = locales.filter((l) => {
    if (l.fallo) return true;
    return !delPuente.some((m) => m.mio && m.texto === l.texto && Math.abs(m.hora - l.hora) < 60_000);
  });
  return [...delPuente, ...pendientes].sort((a, b) => a.hora - b.hora);
}

/** Cada cuánto se pregunta: rápido con un chat abierto, menos en la lista, y mientras vincula. */
export function sondeoWA(vista: VistaWA, chatAbierto: boolean): number {
  if (vista === 'vincular') return 3000;
  if (vista !== 'listo') return 15000;
  return chatAbierto ? 3000 : 5000;
}

/** Un número que WhatsApp acepta para el código: con código de país, sin el «0» del principio. */
export function telefonoValido(t: string): string | null {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length < 8 || d.length > 15 || d.startsWith('0')) return null;
  return d;
}

/* ── los colores de WhatsApp ──────────────────────────────────────────────────────────────── */

export type PaletaWA = {
  cabecera: string;
  sobreCabecera: string;
  sobreCabecera2: string;
  fondo: string;
  separador: string;
  nombre: string;
  previa: string;
  hora: string;
  horaSinLeer: string;
  globo: string;
  sobreGlobo: string;
  buscador: string;
  pista: string;
  chat: string;
  mia: string;
  otra: string;
  texto: string;
  metaMia: string;
  metaOtra: string;
  chip: string;
  chipTexto: string;
  caja: string;
  enviar: string;
  sobreEnviar: string;
  aviso: string;
  avisoFondo: string;
  tarjeta: string;
  sinFoto: string;
  enlace: string;
};

/** Los de WhatsApp en claro y en oscuro (sigue el tema de la app). */
export function paletaWA(oscuro: boolean): PaletaWA {
  return oscuro
    ? {
        cabecera: '#1F2C34',
        sobreCabecera: '#E9EDEF',
        sobreCabecera2: '#8696A0',
        fondo: '#111B21',
        separador: '#222D34',
        nombre: '#E9EDEF',
        previa: '#8696A0',
        hora: '#8696A0',
        horaSinLeer: '#25D366',
        globo: '#25D366',
        sobreGlobo: '#111B21',
        buscador: '#202C33',
        pista: '#8696A0',
        chat: '#0B141A',
        mia: '#005C4B',
        otra: '#202C33',
        texto: '#E9EDEF',
        metaMia: 'rgba(233,237,239,0.68)',
        metaOtra: '#8696A0',
        chip: '#182229',
        chipTexto: '#8696A0',
        caja: '#2A3942',
        enviar: '#00A884',
        sobreEnviar: '#111B21',
        aviso: '#F15C6D',
        avisoFondo: '#3B2329',
        tarjeta: 'rgba(0,0,0,0.22)',
        sinFoto: '#6A7175',
        enlace: '#53BDEB',
      }
    : {
        cabecera: '#008069',
        sobreCabecera: '#FFFFFF',
        sobreCabecera2: 'rgba(255,255,255,0.85)',
        fondo: '#FFFFFF',
        separador: '#E9EDEF',
        nombre: '#111B21',
        previa: '#667781',
        hora: '#667781',
        horaSinLeer: '#1FA855',
        globo: '#25D366',
        sobreGlobo: '#FFFFFF',
        buscador: '#F0F2F5',
        pista: '#667781',
        chat: '#EFEAE2',
        mia: '#D9FDD3',
        otra: '#FFFFFF',
        texto: '#111B21',
        metaMia: '#667781',
        metaOtra: '#667781',
        chip: '#FFFFFF',
        chipTexto: '#54656F',
        caja: '#FFFFFF',
        enviar: '#00A884',
        sobreEnviar: '#FFFFFF',
        aviso: '#EA0038',
        avisoFondo: '#FDE8EB',
        tarjeta: 'rgba(11,20,26,0.06)',
        sinFoto: '#DFE5E7',
        enlace: '#027EB5',
      };
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** ¿Vale la pena reintentar? No cuando ya no existe (410), pesa demasiado (413) o no está vinculado (412). */
export function mediaReintentable(status: number): boolean {
  return status !== 410 && status !== 413 && status !== 412;
}

/**
 * Lo que se dice cuando una foto o un archivo no baja: claro y corto, con lo que puede hacer. El
 * servidor manda su razón («WhatsApp no lo dio (puede haber vencido): …»): se queda la parte humana.
 */
export function mensajeErrorMedia(status: number, error: string | undefined, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  if (status === 413) return en ? 'Bigger than 16 MB: open it on your phone.' : 'Pesa más de 16 MB: ábrelo en tu teléfono.';
  if (status === 410) return en ? 'It’s no longer on WhatsApp: open it on your phone.' : String(error || '').trim() ? capital(String(error).trim()) : 'Esa foto ya no está en WhatsApp: ábrela en tu teléfono.';
  if (status === 412) return en ? 'Your WhatsApp isn’t linked.' : 'Tu WhatsApp no está vinculado.';
  if (status === 401) return en ? 'Your session expired. Sign in again.' : 'Tu sesión venció. Vuelve a entrar.';
  if (status === 0) return en ? 'No connection. Tap to retry.' : 'Sin conexión. Toca para reintentar.';
  const e = String(error || '').trim();
  if (/vencido|expired|no lo dio/i.test(e)) return en ? 'WhatsApp no longer has it (it may have expired).' : 'WhatsApp ya no lo tiene (puede haber vencido).';
  if (/no tiene archivo/i.test(e)) return en ? 'This message has no file.' : 'Este mensaje no trae archivo.';
  if (e && !/^HTTP \d+$/.test(e)) return e.split(/: /)[0].slice(0, 120);
  return en ? 'Couldn’t load it. Tap to retry.' : 'No se pudo cargar. Toca para reintentar.';
}
