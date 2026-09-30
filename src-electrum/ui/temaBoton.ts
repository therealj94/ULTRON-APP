/**
 * TEMA DE LOS BOTONES DE DR ELECTRUM — la misma fuente para la web y para la app.
 *
 * La web lo convierte en variables CSS de react-awesome-button (BotonAnimado.tsx) y la app en el
 * `buttonStyle` de @rcaferati/react-native-awesome-button (mobile/src/electrum/BotonAnimado.tsx).
 * La app no puede importar fuera de `mobile/`, así que tiene una copia exacta en
 * `mobile/src/electrum/temaBoton.ts`; `tests/tema-boton.test.ts` falla si las dos se separan.
 *
 * Contraste (WCAG) medido contra el color de la cara del botón:
 *   primary  #0B0D0F sobre #FFAE3B → 10,5:1
 *   secondary #FFC46B sobre #161B1F → 11,0:1
 *   danger   #FFFFFF sobre #B8322E → 5,9:1
 *   link     #FFC46B sobre el fondo #07090B → 12,7:1
 *   deshabilitado #8A9DA7 sobre #232B31 → 5,0:1 (WCAG no lo exige; igual se lee)
 */

export type TipoBoton = 'primary' | 'secondary' | 'danger' | 'link';
export type TamanoBoton = 'sm' | 'md' | 'lg';

export type ColoresBoton = {
  /** Cara del botón. */
  fondo: string;
  /** Cara al pasar el cursor (solo web). */
  fondoHover: string;
  /** Cara mientras se aprieta. */
  fondoActivo: string;
  /** El canto de abajo que da el efecto 3D. */
  profundidad: string;
  texto: string;
  /** Borde de la cara; 'none' sin borde. */
  borde: string;
};

export const TEMA_BOTON = {
  /** Radio de las esquinas en px. */
  radio: 10,
  /** Altura del canto 3D en px; el tipo link no tiene canto. */
  relieve: 4,
  /** Duración de hundirse y volver, en ms. */
  duracionMs: 150,
  fuente: "'IBM Plex Mono', ui-monospace, monospace",
  pesoLetra: 600,
  espaciadoLetra: 0.4,
  /** Alto de la cara; en pantallas táctiles la web sube sm a 44 px (objetivo mínimo para el dedo). */
  alto: { sm: 36, md: 44, lg: 52 },
  letra: { sm: 13, md: 14, lg: 16 },
  relleno: { sm: 14, md: 18, lg: 24 },
  /** Anillo de foco de teclado. */
  foco: '#FFAE3B',
  sombra: 'rgba(0, 0, 0, 0.35)',
  tipos: {
    primary: { fondo: '#FFAE3B', fondoHover: '#FFB955', fondoActivo: '#F29F2A', profundidad: '#A8680F', texto: '#0B0D0F', borde: 'none' },
    secondary: { fondo: '#161B1F', fondoHover: '#1C2328', fondoActivo: '#12171A', profundidad: '#06080A', texto: '#FFC46B', borde: '1px solid rgba(255, 174, 59, 0.45)' },
    danger: { fondo: '#B8322E', fondoHover: '#C23A36', fondoActivo: '#A62C28', profundidad: '#6B1B19', texto: '#FFFFFF', borde: 'none' },
    link: { fondo: 'transparent', fondoHover: 'rgba(255, 174, 59, 0.08)', fondoActivo: 'rgba(255, 174, 59, 0.14)', profundidad: 'transparent', texto: '#FFC46B', borde: 'none' },
  } satisfies Record<TipoBoton, ColoresBoton>,
  deshabilitado: { fondo: '#232B31', fondoHover: '#232B31', fondoActivo: '#232B31', profundidad: '#12171A', texto: '#8A9DA7', borde: 'none' } satisfies ColoresBoton,
} as const;
