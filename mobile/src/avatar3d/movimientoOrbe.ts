/**
 * LOS BUCLES DE LA AU-RA CHIQUITA (avatar3d/OrbeMini.tsx) y «reducir movimiento» (Fase 0, APK 5.7.1).
 *
 * Mientras no se sabe si el sistema pide reducir el movimiento (`quieto` null: la respuesta de AccessibilityInfo es
 * asíncrona), no arranca ningún bucle: antes la respiración arrancaba primero y, al llegar el «sí», ya nadie la paraba.
 * Con «reducir movimiento» no respira ni gira (solo el brillo de la voz, que sigue a lo que dice); si la persona lo cambia
 * con la app abierta, los bucles se paran o vuelven en el acto.
 *
 * Puro (sin React Native): tests/pulido-571-movil.test.ts.
 */

/** Dónde se queda la respiración sin bucle (la escala de en medio: ni chica ni grande). */
export const RESPIRO_QUIETO = 0.5;

export function buclesOrbeMini(o: { activo: boolean; quieto: boolean | null; pensando: boolean }): { respira: boolean; gira: boolean } {
  const anima = o.activo && o.quieto === false;
  return { respira: anima, gira: anima && o.pensando };
}
