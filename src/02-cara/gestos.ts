/**
 * Gestos que la cara puede ejecutar o reportar por `onGesto`.
 * Los primeros son los internos (parpadeo, sacadas…); los siguientes son los
 * del mapa táctil humano y los de la capa de expresión por emoción.
 */
export const GESTOS = [
  // Internos / autónomos
  'blink', 'blinkDouble', 'lookLeft', 'lookRight', 'lookUp',
  'nod', 'flinch', 'sleepBreathe', 'wink', 'sip',
  'startle', 'idleSaccade', 'listenTilt', 'thinkHold', 'speakPulse',
  'hmm', 'bostezo', 'despertar',
  // Mapa táctil humano
  'tapOjo', 'tapFrente', 'tapBarbilla', 'tapMejilla', 'frotarMejilla',
  'molestoJuego', 'longPress', 'dormir', 'arrastre',
  'swipeArriba', 'swipeAbajo', 'swipeLado',
  // Capa de expresión (una por emoción del contrato lib/emocion.ts)
  'risa', 'sorpresa', 'curioso', 'pensar', 'preocupado', 'tristeza',
  'molesto', 'cansado', 'carino', 'orgullo', 'travieso', 'canto', 'feliz', 'orar',
] as const;
export type Gesto = (typeof GESTOS)[number];
