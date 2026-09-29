/**
 * Quién habla ahora en la mesa. Un dato de módulo (sin React) porque lo leen la voz (tts.ts: qué
 * voz pedir, si se usan los clips de Dora) y el turno (api.ts: que el cerebro conteste como Claudio),
 * y esos dos módulos no pueden importarse entre sí.
 */
import type { AvatarId } from './catalogo';

let actual: AvatarId = 'aura';

export function fijarAvatar(id: AvatarId) {
  actual = id;
}

export function avatarActual(): AvatarId {
  return actual;
}
