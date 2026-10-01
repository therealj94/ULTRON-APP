/**
 * Harness agentic: Qwen puede pedir UNA herramienta más, ver el hecho, y entonces hablar.
 * Sin teatro: si no hay resultado, se dice. Máximo 2 vueltas.
 */

import type { NivelAura } from './perfiles/tipos';
import { clave } from './boveda';

export type HerramientaHarness = 'web' | 'sistema' | 'ejecutor' | 'leer' | 'computadora';

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

/**
 * El harness para un miembro de la comunidad: solo web y leer. `sistema` (estado de los nodos) y
 * `ejecutor` son del taller de la junta; si el modelo los pidiera igual, el servidor no los corre
 * (pedidoPermitido).
 */
export const INSTRUCCION_HARNESS_MIEMBRO = INSTRUCCION_HARNESS.split('\n')
  .filter((l) => !/^PEDIR_HERRAMIENTA: (sistema|ejecutor)\b/.test(l))
  .join('\n');

/**
 * Su propia computadora en la nube (server/computadora.ts): solo se ofrece si el servidor la tiene.
 * Va para todos (junta y miembros): es de cada avatar, no del taller.
 */
export const INSTRUCCION_COMPUTADORA = `
PEDIR_HERRAMIENTA: computadora <la tarea entera en una frase, con todos los datos que hagan falta>
Tienes tu propia computadora en la nube (Ubuntu con Firefox y LibreOffice). Úsala cuando haya que HACER algo en páginas: entrar a un sitio y buscar dentro, comparar varias páginas, llenar un formulario, sacar datos de una tabla, o cuando te digan «usa tu computadora». Para una pregunta que una búsqueda contesta, usa web. Nunca la uses para pagar, comprar ni poner contraseñas.`.trim();

export function computadoraDisponible(): boolean {
  return !!clave('computadora_url') && !!clave('computadora_clave');
}

export function instruccionHarness(nivel: NivelAura = 'junta', conComputadora = computadoraDisponible()): string {
  const base = nivel === 'miembro' ? INSTRUCCION_HARNESS_MIEMBRO : INSTRUCCION_HARNESS;
  return conComputadora ? `${base}\n${INSTRUCCION_COMPUTADORA}` : base;
}

/**
 * ¿Se corre este pedido para quien habla? null = sí; si no, el HECHO que vuelve al modelo. Con un
 * miembro, `sistema` y `ejecutor` no se corren nunca: son del taller de la junta.
 */
export function pedidoPermitido(ped: PedidoHerramienta, nivel: NivelAura): string | null {
  if (nivel === 'miembro' && (ped.herramienta === 'sistema' || ped.herramienta === 'ejecutor')) {
    return `HARNESS ${ped.herramienta}: no disponible con miembros de la comunidad (es del taller de la junta). No lo corrí. Si te lo pidieron, dilo con naturalidad.`;
  }
  return null;
}

const RE = /^\s*PEDIR_HERRAMIENTA:\s*(web|sistema|ejecutor|leer|computadora)\s*(.*)$/im;

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
    /** La computadora del agente (server/computadora.ts). Sin ella, el pedido se contesta como no disponible. */
    computadora?: (tarea: string) => Promise<string>;
  },
  codigoDelTurno = '',
  /** Con quién habla: con un miembro, `sistema` y `ejecutor` no llegan a sus runners. */
  nivel: NivelAura = 'junta'
): Promise<string> {
  const no = pedidoPermitido(ped, nivel);
  if (no) return no;
  if (ped.herramienta === 'web') {
    const q = ped.arg.trim();
    if (!q) return 'HARNESS web: consulta vacía. No busqué.';
    return runners.web(q);
  }
  if (ped.herramienta === 'sistema') return runners.sistema();
  if (ped.herramienta === 'computadora') {
    const tarea = ped.arg.trim();
    if (!tarea) return 'HARNESS computadora: no vino la tarea. No encargué nada.';
    if (!runners.computadora) return 'HARNESS computadora: no está disponible aquí. No la usé.';
    return runners.computadora(tarea);
  }
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
