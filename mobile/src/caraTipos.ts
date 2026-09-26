/**
 * Las caras del cuerpo de AU-RA (lo que el cerebro y la voz piden que muestre).
 *
 * Vive aparte de config.ts porque config importa expo-constants: así la cara Skia (src/cara/estados.ts)
 * y sus pruebas en Node usan el tipo sin arrastrar React Native. config.ts lo reexporta, de modo que
 * `import type { FaceState } from '../config'` sigue igual en todo el resto.
 */
export type FaceState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'HAPPY'
  | 'CONCERNED'
  | 'ANGRY'
  | 'SLEEPING'
  | 'STARTLE'
  | 'WINK'
  | 'CONFUSED'
  | 'MUSIC'
  | 'SCAN'
  | 'YAWNING'
  | 'LAUGH'
  | 'SURPRISED'
  | 'SAD'
  | 'TIRED'
  | 'SING'
  | 'CURIOUS'
  | 'PROUD'
  | 'PRAY';
