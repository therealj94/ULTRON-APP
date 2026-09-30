/**
 * Selector de perfil. Un solo binario, varias plataformas.
 *
 * ULTRON_PERFIL decide qué cerebro se carga. Sin variable, Genesis Core: la plataforma de la junta
 * no cambia de comportamiento por existir otras. Si el valor no se reconoce, se avisa en el arranque
 * y se cae a Genesis, que es lo seguro.
 */
import { GENESIS } from './genesis';
import { GENESIS_MIEMBRO } from './genesis-miembro';
import { MINAS } from './minas';
import { SOLO_JUNTA, type Herramienta, type NivelAura, type PerfilCerebro } from './tipos';

export type { Herramienta, NivelAura, PerfilCerebro } from './tipos';
export { tiene, herramientaPermitida, SOLO_JUNTA } from './tipos';
export { GENESIS_MIEMBRO } from './genesis-miembro';

export const PERFILES: Record<string, PerfilCerebro> = {
  [GENESIS.id]: GENESIS,
  [MINAS.id]: MINAS,
};

let elegido: PerfilCerebro | null = null;

export function perfilActivo(): PerfilCerebro {
  if (elegido) return elegido;
  const pedido = String(process.env.ULTRON_PERFIL || '').trim().toLowerCase();
  if (pedido && !PERFILES[pedido]) {
    console.warn(`[AU-RA] perfil «${pedido}» no existe. Perfiles: ${Object.keys(PERFILES).join(', ')}. Uso genesis.`);
  }
  elegido = PERFILES[pedido] || GENESIS;
  return elegido;
}

/** Solo para pruebas: fuerza un perfil sin tocar el entorno. */
export function fijarPerfil(id: string | null) {
  elegido = id ? PERFILES[id] || null : null;
}

export function herramientaActiva(h: Herramienta, nivel: NivelAura = 'junta') {
  return perfilPara(nivel).herramientas.includes(h);
}

const recortados = new Map<string, PerfilCerebro>();

/**
 * El cerebro con que se habla según QUIÉN habla (el nivel lo decide el servidor, server/nivel.ts).
 * La junta: el perfil activo, como siempre. Un miembro: en Genesis Core, GENESIS_MIEMBRO (lo público,
 * sin taller ni Telegram); en otro perfil, ese mismo sin las herramientas que son solo de la junta.
 */
export function perfilPara(nivel: NivelAura): PerfilCerebro {
  const base = perfilActivo();
  if (nivel !== 'miembro') return base;
  if (base.id === GENESIS.id) return GENESIS_MIEMBRO;
  let r = recortados.get(base.id);
  if (!r) {
    r = { ...base, herramientas: base.herramientas.filter((h) => !SOLO_JUNTA.includes(h)) };
    recortados.set(base.id, r);
  }
  return r;
}
