/**
 * GENERADO por `npm run avatar3d` (scripts/avatar3d-assets.mjs, que usa el registro de
 * mobile/scripts/avatar3d-modelo.mjs) — no editar a mano.
 *
 * Los modelos 3D que trae la APK, por avatar: los de Codex (AU-RA, Claudio y ANT-ONIO, perfil
 * «nodos»), revisados y optimizados desde vendor/aura-avatar-suite. El que no está aquí (el Guardián)
 * se dibuja con su figurita 2D de siempre, igual que cualquiera si el teléfono no aguanta el 3D.
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

export const MODELOS_3D: Partial<Record<AvatarId, ModeloAvatar3D>> = {
  aura: {
    fuente: require('../../assets/avatar3d/aura.glb'),
    huella: 'beca685af4b701e1',
    bytes: 394444,
    mapeo: {"perfil":"nodos"},
  },
  claudio: {
    fuente: require('../../assets/avatar3d/claudio.glb'),
    huella: 'b89067afc912a1b4',
    bytes: 2086684,
    mapeo: {"perfil":"nodos"},
  },
  antonio: {
    fuente: require('../../assets/avatar3d/antonio.glb'),
    huella: 'd8947ff81ea0e394',
    bytes: 1869468,
    mapeo: {"perfil":"nodos"},
  },
};
