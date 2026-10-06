/**
 * Lo que el cerebro recibe de las caras en la escena del turno, honesto con lo que no se sabe (CAM-F, master §25.5).
 *
 * `frasePresentes` (caras.ts) dice los nombres confirmados y las caras «que no conozco» (ya miradas). Faltaba lo del
 * medio: alguien a la vista que todavía se está reconociendo, o cuyo nombre se venció sin un voto fresco. Antes eso no
 * aparecía (como si no hubiera nadie); ahora va como «sin identificar todavía», para que el cerebro no le dé trato de
 * conocido ni lo dé por ausente.
 */
import { frasePresentes, type Reconocida } from './caras';

type Quien = Pick<Reconocida, 'nombre' | 'relacion' | 'parentesco'>;

export function fraseEscenaCaras(p: { r: Quien[]; desconocidas: number; pendientes?: number }, en = false, trasera = false): string {
  const base = frasePresentes(p.r, p.desconocidas, en, trasera);
  const n = Math.max(0, p.pendientes || 0);
  if (!n) return base;
  const pend = en ? `${n} person(s) not identified yet (treat as unknown)` : `${n} persona(s) sin identificar todavía (trátala como desconocida)`;
  if (base) return `${base}; ${pend}`;
  if (trasera) return en ? `With the back camera: ${pend}` : `Con la cámara trasera: ${pend}`;
  return pend.charAt(0).toUpperCase() + pend.slice(1);
}
