/**
 * La paleta de AU-RA en el teléfono: la misma de la web (src/11-sala/tema.css), cálida y clara.
 * Crema de fondo, miel para lo principal, salvia para lo que está activo y terracota para avisar.
 * Solo la usan las pantallas de AU-RA; Dr Electrum sigue con la suya.
 */
export const T = {
  crema: '#FEF9F3',
  arena: '#F3E7D8',
  panel: '#FFFFFF',
  borde: '#EDE0CC',
  miel: '#E2A83E',
  mielOsc: '#A8701A',
  mielClaro: '#FBF0DB',
  salvia: '#8FAF93',
  salviaOsc: '#4E6E54',
  salviaClaro: '#E7F0E6',
  barro: '#D9825F',
  barroOsc: '#B45E3C',
  tinta: '#3A322C',
  tinta2: '#6B6056',
  tinta3: '#8B7E72',
  sombra: 'rgba(90,60,25,0.16)',
} as const;

/** Sombra suave para tarjetas y botones flotantes (Android usa elevation). */
export const SOMBRA = { shadowColor: '#5A3C19', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 } as const;
