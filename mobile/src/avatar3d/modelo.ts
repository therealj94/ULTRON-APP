/**
 * GENERADO por `npx tsx scripts/avatar3d-modelo.ts registrar` — no editar a mano.
 *
 * Los modelos 3D que trae la APK, por avatar. Vacío: ningún avatar tiene modelo y todos se dibujan
 * con la figurita 2D de siempre. Para conectar el que entregue Codex: copiarlo a
 * `mobile/assets/avatar3d/<avatar>.glb` (con su `<avatar>.mapeo.json` si hace falta) y correr el
 * registro, que lo revisa contra docs/avatar-3d-especificacion.md y reescribe este archivo.
 */
import type { AvatarId } from '../avatares/catalogo';
import type { MapeoParcial } from './mapeo';

export type ModeloAvatar3D = {
  /** El .glb empaquetado por Metro (`require`). */
  fuente: number;
  /** sha256 del archivo (16 letras): si cambia el modelo, el teléfono vuelve a probar el 3D. */
  huella: string;
  bytes: number;
  /** Los nombres propios de este modelo, si no son los de la especificación. */
  mapeo: MapeoParcial | null;
};

export const MODELOS_3D: Partial<Record<AvatarId, ModeloAvatar3D>> = {};
