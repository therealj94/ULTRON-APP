/**
 * EL ÁREA DE TOQUE DE LOS BOTONES (Fase 0, APK 5.7.1, revisión del diseño: «toques de al menos 48 dp»).
 *
 * Material y las pautas de accesibilidad de Android piden 48 × 48 dp de área de toque. El botón chico se ve de 42 dp y el
 * fantasma de 44: antes se compensaba con `hitSlop`, pero en Android el hitSlop NUNCA pasa de los bordes del padre (y el
 * botón va dentro de su propia vista animada del mismo tamaño), así que no sumaba nada. Ahora el área de toque mide de
 * verdad lo que diga `toque` (el Pressable crece; lo que se ve queda del tamaño de siempre, centrado), sin invadir a los
 * vecinos: ocupa su sitio en el diseño en vez de salirse de él.
 *
 * Puro (sin React Native): tests/pulido-571-movil.test.ts.
 */

/** Lo mínimo para un toque cómodo (Material: 48 dp). */
export const TOQUE_MIN = 48;

export type VarianteToque = 'principal' | 'secundario' | 'fantasma' | 'peligro' | 'texto' | 'contorno';

/** El alto que se ve del botón y el de su área de toque (nunca menos de TOQUE_MIN). */
export function medidasBoton(variante: VarianteToque, tam: 'normal' | 'chico' = 'normal'): { alto: number; toque: number } {
  const v = variante === 'texto' ? 'fantasma' : variante;
  const alto = tam === 'chico' ? 42 : v === 'fantasma' ? 44 : 54;
  return { alto, toque: Math.max(TOQUE_MIN, alto) };
}
