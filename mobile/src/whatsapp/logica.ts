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

export type ChatWA = { jid: string; nombre: string; grupo: boolean; noLeidos: number; hora: number; ultimo: string; ultimoMio: boolean; ultimoDe?: string };
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
export function previa(c: ChatWA, idioma: 'es' | 'en' = 'es'): string {
  const quien = c.ultimoMio ? (idioma === 'en' ? 'You: ' : 'Tú: ') : c.grupo && c.ultimoDe ? `${c.ultimoDe}: ` : '';
  return `${quien}${c.ultimo || ''}`;
}

/** El nombre que se ve: el de la agenda, o el número bonito. */
export function nombreChat(c: Pick<ChatWA, 'nombre' | 'jid'>): string {
  if (c.nombre) return c.nombre;
  const n = c.jid.split('@')[0].split(':')[0];
  return /^\d{8,15}$/.test(n) ? `+${n}` : n;
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
