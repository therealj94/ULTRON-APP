/**
 * Las llamadas de la app a su WhatsApp (server/whatsapp.ts → el puente privado). Todas con la sesión.
 */
import { api } from '../lib/api';
import { loadMesaToken } from '../lib/storage';
import { API_BASE } from '../config';
import type { ChatWA, EstadoWA, MensajeWA } from './logica';

export const estadoWA = () => api<EstadoWA>('/api/whatsapp/estado', { method: 'GET' }, 12_000);

export const vincularWA = (telefono?: string) =>
  api<{ codigo?: string; qr?: string }>('/api/whatsapp/vincular', { method: 'POST', body: JSON.stringify(telefono ? { telefono } : {}) }, 35_000);

export const desvincularWA = () => api('/api/whatsapp/desvincular', { method: 'POST', body: '{}' }, 20_000);

export const chatsWA = (buscar = '') =>
  api<{ chats: ChatWA[] }>(`/api/whatsapp/chats${buscar ? `?buscar=${encodeURIComponent(buscar)}` : ''}`, { method: 'GET' }, 15_000).then((r) => r.chats);

export const mensajesWA = (chat: string) =>
  api<{ chat: ChatWA; mensajes: MensajeWA[] }>(`/api/whatsapp/mensajes?chat=${encodeURIComponent(chat)}`, { method: 'GET' }, 15_000);

export const enviarWA = (chat: string, texto: string) =>
  api<{ mensaje: MensajeWA }>('/api/whatsapp/enviar', { method: 'POST', body: JSON.stringify({ chat, texto }) }, 40_000).then((r) => r.mensaje);

export const leidoWA = (chat: string) => api('/api/whatsapp/leido', { method: 'POST', body: JSON.stringify({ chat }) }, 15_000);

/** La foto entera (o el archivo) de un mensaje: la dirección y la cabecera de la sesión para <Image>. */
export async function fuenteMedia(chat: string, id: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const token = await loadMesaToken();
  return {
    uri: `${API_BASE}/api/whatsapp/media?chat=${encodeURIComponent(chat)}&id=${encodeURIComponent(id)}`,
    headers: token ? { 'x-ultron-sesion': token } : {},
  };
}
