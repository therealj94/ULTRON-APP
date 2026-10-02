/**
 * Las llamadas de la app a su WhatsApp (server/whatsapp.ts → el puente privado). Todas con la sesión.
 */
import { api } from '../lib/api';
import { normalizarChats, normalizarContactos, type ChatWA, type ContactoWA, type EstadoWA, type MensajeWA } from './logica';

export const estadoWA = () => api<EstadoWA>('/api/whatsapp/estado', { method: 'GET' }, 12_000);

export const vincularWA = (telefono?: string) =>
  api<{ codigo?: string; qr?: string }>('/api/whatsapp/vincular', { method: 'POST', body: JSON.stringify(telefono ? { telefono } : {}) }, 35_000);

export const desvincularWA = () => api('/api/whatsapp/desvincular', { method: 'POST', body: '{}' }, 20_000);

/** Los chats, el más reciente primero (hasta 200; buscar también encuentra los más viejos y por número). */
export const chatsWA = (buscar = '', limite = 200) =>
  api<{ chats: ChatWA[] }>(`/api/whatsapp/chats?limite=${limite}${buscar ? `&buscar=${encodeURIComponent(buscar)}` : ''}`, { method: 'GET' }, 15_000).then((r) => normalizarChats(r?.chats));

/** Los contactos guardados en su teléfono (para «Nuevo chat»), por nombre. */
export const contactosWA = (buscar = '', limite = 300) =>
  api<{ contactos: ContactoWA[] }>(`/api/whatsapp/contactos?limite=${limite}${buscar ? `&buscar=${encodeURIComponent(buscar)}` : ''}`, { method: 'GET' }, 15_000).then((r) => normalizarContactos(r?.contactos));

/** Los últimos 60 de un chat; con `antes` (una hora en ms), los 60 anteriores a esa (para subir en la conversación). */
export const mensajesWA = (chat: string, antes = 0) =>
  api<{ chat: ChatWA; mensajes: MensajeWA[] }>(`/api/whatsapp/mensajes?chat=${encodeURIComponent(chat)}${antes > 0 ? `&antes=${Math.floor(antes)}` : ''}`, { method: 'GET' }, 15_000).then((r) => ({
    ...r,
    mensajes: (Array.isArray(r?.mensajes) ? r.mensajes : []).filter((m) => m && m.id).map((m) => ({ ...m, texto: typeof m.texto === 'string' ? m.texto : '' })),
  }));

export const enviarWA = (chat: string, texto: string) =>
  api<{ mensaje: MensajeWA }>('/api/whatsapp/enviar', { method: 'POST', body: JSON.stringify({ chat, texto }) }, 40_000).then((r) => r.mensaje);

export const leidoWA = (chat: string) => api('/api/whatsapp/leido', { method: 'POST', body: JSON.stringify({ chat }) }, 15_000);

/** La foto entera, el audio o el archivo de un mensaje (lo baja whatsapp/medios.ts con la sesión). */
export const rutaMedia = (chat: string, id: string) => `/api/whatsapp/media?chat=${encodeURIComponent(chat)}&id=${encodeURIComponent(id)}`;

/** La foto de perfil de un chat (image/jpeg; 404 si no tiene). */
export const rutaFoto = (chat: string) => `/api/whatsapp/foto?chat=${encodeURIComponent(chat)}`;
