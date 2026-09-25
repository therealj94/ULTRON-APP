/**
 * La paleta de AU-RA en el teléfono: Grafito (elegida el 25-sep), la misma de la web
 * (src/11-sala/tema.css) y de la sala. Grafito y nogal, texto claro y el dorado del anillo como
 * único acento; salvia apagada para lo que está activo y terracota para avisar.
 * Solo la usan las pantallas de AU-RA; Dr Electrum sigue con la suya.
 */
export const T = {
  fondo: '#232528',
  fondo2: '#2C2E32',
  panel: '#34363A',
  panel2: '#3A3C41',
  borde: '#46484D',
  principal: '#D6B56C',
  /** Texto dorado sobre fondo oscuro (más claro que el botón, para que se lea). */
  principalTexto: '#E0C27F',
  principalFondo: '#3D3829',
  /** Lo que va escrito encima de un botón dorado. */
  sobrePrincipal: '#232528',
  activo: '#8FA58A',
  activoTexto: '#A9C3A4',
  activoFondo: '#2F3A30',
  aviso: '#D9825F',
  avisoTexto: '#E39A7A',
  avisoFondo: '#3F2E28',
  texto: '#ECE8E2',
  texto2: '#B9B2A8',
  texto3: '#8A847C',
} as const;

/** Sombra para tarjetas y botones flotantes (Android usa elevation). */
export const SOMBRA = { shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 } as const;
