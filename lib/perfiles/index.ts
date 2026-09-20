/**
 * Selector de perfil. Un solo binario, varias plataformas.
 *
 * ULTRON_PERFIL decide qué cerebro se carga. Sin variable, Genesis Core: la plataforma de la junta
 * no cambia de comportamiento por existir otras. Si el valor no se reconoce, se avisa en el arranque
 * y se cae a Genesis, que es lo seguro.
 */
import { GENESIS } from './genesis';
import { MINAS } from './minas';
import type { Herramienta, PerfilCerebro } from './tipos';

export type { Herramienta, PerfilCerebro } from './tipos';
export { tiene } from './tipos';

export const PERFILES: Record<string, PerfilCerebro> = {
  [GENESIS.id]: GENESIS,
  [MINAS.id]: MINAS,
};

let elegido: PerfilCerebro | null = null;

export function perfilActivo(): PerfilCerebro {
  if (elegido) return elegido;
  const pedido = String(process.env.ULTRON_PERFIL || '').trim().toLowerCase();
  if (pedido && !PERFILES[pedido]) {
    console.warn(`[ULTRON] perfil «${pedido}» no existe. Perfiles: ${Object.keys(PERFILES).join(', ')}. Uso genesis.`);
  }
  elegido = PERFILES[pedido] || GENESIS;
  return elegido;
}

/** Solo para pruebas: fuerza un perfil sin tocar el entorno. */
export function fijarPerfil(id: string | null) {
  elegido = id ? PERFILES[id] || null : null;
}

export function herramientaActiva(h: Herramienta) {
  return perfilActivo().herramientas.includes(h);
}
