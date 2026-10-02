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
  idiomaDePagina();
  return actual;
}
export const estado = () => actual!;
export function alCambiar(f: (e: Estado) => void) { oyentes.add(f); return () => oyentes.delete(f); }
al<Estado>('estado', (e) => { actual = e; aplicarAcento(e.avatar); idiomaDePagina(); oyentes.forEach((f) => f(e)); });
function idiomaDePagina() { document.documentElement.lang = actual?.idioma === 'en' ? 'en' : 'es'; }

/** El color propio de cada avatar: lo usan sus escenas (el recorrido); la interfaz del Centro ya no cambia de color. */
export const ACENTOS: Record<string, string> = { aura: '#B8913F', claudio: '#f4ad72', antonio: '#45c9de', ojos: '#5E9C8C' };
export const NOMBRES: Record<string, string> = { aura: 'AU-RA', claudio: 'Claudio', antonio: 'ANT-ONIO', ojos: 'Guardián' };
/**
 * «Contraste»: la marca es el punzón de oro, no el avatar. El acento del Centro es siempre el oro de la
 * paleta (estilos.css); el avatar elegido solo queda anotado en la página (`data-avatar`) para quien lo necesite.
 */
export function aplicarAcento(avatar: string) {
  document.documentElement.dataset.avatar = ACENTOS[avatar] ? avatar : 'aura';
  document.documentElement.style.removeProperty('--acento');
  document.documentElement.style.removeProperty('--acento-suave');
}
export const T = (es: string, en: string) => (actual?.idioma === 'en' ? en : es);
