/** Lo que el Centro sabe de AURA (lo pide al abrir y lo actualiza con el evento «estado»). */
import { al, pedir } from './puente';

export type Sesion = { nombre: string; correo: string; rol: string; nivel: 'junta' | 'miembro' | string; gid?: string };
export type Estado = {
  version: string;
  sesion: Sesion | null;
  avatar: string; idioma: 'es' | 'en' | string;
  primeraVez: boolean;
  conexiones: Record<'spotify' | 'google' | 'microsoft', string | null>;
  cartera: { direccion: string };
  pulse?: { conectado: boolean; correo?: string };
};

let actual: Estado | null = null;
const oyentes = new Set<(e: Estado) => void>();

export async function cargar(): Promise<Estado> {
  actual = await pedir<Estado>('estado');
  aplicarAcento(actual.avatar);
  return actual;
}
export const estado = () => actual!;
export function alCambiar(f: (e: Estado) => void) { oyentes.add(f); return () => oyentes.delete(f); }
al<Estado>('estado', (e) => { actual = e; aplicarAcento(e.avatar); oyentes.forEach((f) => f(e)); });

export const ACENTOS: Record<string, string> = { aura: '#d6b56c', claudio: '#f4ad72', antonio: '#45c9de', ojos: '#5ce1ff' };
export const NOMBRES: Record<string, string> = { aura: 'AU-RA', claudio: 'Claudio', antonio: 'ANT-ONIO', ojos: 'Guardián' };
export function aplicarAcento(avatar: string) {
  const c = ACENTOS[avatar] ?? ACENTOS.aura;
  document.documentElement.style.setProperty('--acento', c);
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  document.documentElement.style.setProperty('--acento-suave', `rgba(${r},${g},${b},.16)`);
}
export const T = (es: string, en: string) => (actual?.idioma === 'en' ? en : es);
