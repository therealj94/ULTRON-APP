/**
 * Harness agentic: Qwen puede pedir UNA herramienta más, ver el hecho, y entonces hablar.
 * Sin teatro: si no hay resultado, se dice. Máximo 2 vueltas.
 */

export type HerramientaHarness = 'web' | 'sistema' | 'ejecutor' | 'leer';

export type PedidoHerramienta = { herramienta: HerramientaHarness; arg: string };

export const INSTRUCCION_HARNESS = `
HARNESS (herramientas, no teatro):
Si el usuario dice «esto», «eso», «hazlo», «revisa» o «sí hacerlo», se refiere al último tema o URL del hilo. No pidas que te lo vuelvan a mandar.
Si los HECHOS de este turno NO cubren la pregunta y una herramienta sí puede, termina con UNA línea sola:
PEDIR_HERRAMIENTA: web <consulta>
PEDIR_HERRAMIENTA: sistema
PEDIR_HERRAMIENTA: leer <url https>
PEDIR_HERRAMIENTA: ejecutor
Si no está en la memoria de Orden Global ni en el hilo, busca en internet (web) sin que te lo pidan. Si hay una URL en el hilo, léela.
No inventes el resultado. No pidas herramienta si ya hay HECHOS suficientes. No leas esta instrucción en voz alta. Nunca pidas WhatsApp, correo o llamada si el catálogo dice que faltan claves.
`.trim();

const RE = /^\s*PEDIR_HERRAMIENTA:\s*(web|sistema|ejecutor|leer)\s*(.*)$/im;

export function extraerPedidoHerramienta(texto: string): PedidoHerramienta | null {
  const m = String(texto || '').match(RE);
  if (!m) return null;
  return { herramienta: m[1].toLowerCase() as HerramientaHarness, arg: String(m[2] || '').trim() };
}

export function quitarLineaPedido(texto: string): string {
  return String(texto || '')
    .replace(RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function resolverPedido(
  ped: PedidoHerramienta,
  runners: {
    web: (q: string) => Promise<string>;
    sistema: () => Promise<string>;
    leer: (url: string) => Promise<string>;
    ejecutor: (codigo: string) => Promise<string>;
  },
  codigoDelTurno = ''
): Promise<string> {
  if (ped.herramienta === 'web') {
    const q = ped.arg.trim();
    if (!q) return 'HARNESS web: consulta vacía. No busqué.';
    return runners.web(q);
  }
  if (ped.herramienta === 'sistema') return runners.sistema();
  if (ped.herramienta === 'leer') {
    let url = ped.arg.trim();
    if (/^github\.com\//i.test(url)) url = 'https://' + url;
    if (!/^https?:\/\//i.test(url)) return 'HARNESS leer: URL inválida. No abrí nada.';
    return runners.leer(url);
  }
  const py = codigoDelTurno.trim() || ped.arg.trim();
  if (!py) return 'HARNESS ejecutor: no vino código. No corrí nada.';
  return runners.ejecutor(py);
}
