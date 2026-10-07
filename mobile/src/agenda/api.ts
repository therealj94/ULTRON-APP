/**
 * LO QUE EL TELÉFONO LE PIDE AL SERVIDOR DEL CALENDARIO (server/calendario.ts). Solo JS: el inicio de sesión de Google
 * se abre en el navegador (expo-web-browser, ya instalado) y el de Microsoft con su código en microsoft.com/devicelogin.
 * Nada nativo nuevo: llega por OTA.
 */
import * as WebBrowser from 'expo-web-browser';
import { api } from '../lib/api';
import type { AgendaApp, EstadoCalendario, ProveedorCal } from './logica';

export const estadoCalendario = () => api<EstadoCalendario>('/api/calendario/estado', { method: 'GET' }, 10_000);

export const iniciarMicrosoft = () => api<{ codigo: string; url: string; intervalo: number; venceEn: number }>('/api/calendario/microsoft/iniciar', { method: 'POST', body: '{}' }, 20_000);

export const consultarMicrosoft = () => api<{ estado: 'pendiente' | 'listo' | 'error'; error?: string }>('/api/calendario/microsoft/consultar', { method: 'POST', body: '{}' }, 30_000);

/**
 * Google: el servidor da la dirección (con su estado de un solo uso y PKCE); se abre en el navegador y Google vuelve
 * al servidor, que guarda el permiso y manda de vuelta a `ultronfp://calendario`. Al cerrarse el navegador (volviera o
 * no), quien llama vuelve a preguntar el estado: lo que diga el servidor es la verdad.
 */
export async function conectarGoogle(): Promise<void> {
  const r = await api<{ url: string }>('/api/calendario/google/iniciar', { method: 'POST', body: '{}' }, 15_000);
  await WebBrowser.openAuthSessionAsync(r.url, 'ultronfp://calendario').catch(() => undefined);
}

export const desconectarCalendario = (p: ProveedorCal) => api<{ ok: boolean }>(`/api/calendario/${p}`, { method: 'DELETE' }, 10_000);

/** El servidor entiende «hoy», «manana» y «semana» (esta semana, hasta el domingo), en días de Honduras. */
export const agendaDe = (cuando: 'hoy' | 'manana' | 'semana') => api<AgendaApp>(`/api/calendario/eventos?cuando=${encodeURIComponent(cuando)}`, { method: 'GET' }, 20_000);
