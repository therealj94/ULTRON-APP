export const GESTOS = [
  'blink', 'blinkDouble', 'lookLeft', 'lookRight', 'lookUp',
  'nod', 'flinch', 'sleepBreathe', 'wink', 'sip',
  'startle', 'idleSaccade', 'listenTilt', 'thinkHold', 'speakPulse',
] as const;
export type Gesto = (typeof GESTOS)[number];
