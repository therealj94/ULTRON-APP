/**
 * Solo lectura de env. Nunca hardcodear keys.
 * Cliente: VITE_* / vacíos. Servidor: process.env (server.ts).
 */
export const SECRETOS_PUBLICOS = {
  mesa: import.meta.env?.VITE_MESA_URL || 'https://ultron-looi-desk.onrender.com',
  qwenUrl: import.meta.env?.VITE_QWEN_URL || 'https://34.207.148.69:8443',
} as const;

export function envServidor(nombre: string, fallback = ''): string {
  if (typeof process === 'undefined') return fallback;
  return String(process.env[nombre] ?? fallback);
}
