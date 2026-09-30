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
  /**
   * La variante ligera (más simplificada; la cara, la del original): la que se prueba si este
   * teléfono no aguantó la alta (capacidad.ts, modeloQueToca). No está si la alta ya es liviana.
   */
  ligero?: { fuente: number; huella: string; bytes: number };
};

export const MODELOS_3D: Partial<Record<AvatarId, ModeloAvatar3D>> = {
  aura: {
    fuente: require('../../assets/avatar3d/aura.glb'),
    huella: '578f1af9412dcc5d',
    bytes: 444900,
    mapeo: {"perfil":"nodos"},
  },
  claudio: {
    fuente: require('../../assets/avatar3d/claudio.glb'),
    huella: 'f1427617376c1a52',
    bytes: 4142924,
    mapeo: {"perfil":"nodos"},
    ligero: {
      fuente: require('../../assets/avatar3d/claudio-ligero.glb'),
      huella: 'f53afed0f584eeca',
      bytes: 2652288,
    },
  },
  antonio: {
    fuente: require('../../assets/avatar3d/antonio.glb'),
    huella: 'c83a34df35c0cfce',
    bytes: 3081128,
    mapeo: {"perfil":"nodos"},
    ligero: {
      fuente: require('../../assets/avatar3d/antonio-ligero.glb'),
      huella: '4255108449f3a379',
      bytes: 2210356,
    },
  },
};
