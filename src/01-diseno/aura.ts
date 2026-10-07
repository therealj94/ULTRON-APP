/**
 * Los tokens de AU-RA: una sola fuente para color, tipografía, espaciado, radios y estados.
 *
 * El tema Grafito (carbón y nogal, el dorado del anillo como único acento) sigue siendo el de la
 * casa; aquí además vive su versión clara (lino y latón), para quien usa el sistema en claro.
 *
 * Los colores NO se repiten en el CSS: `useTema` los pone como variables `--aura-*` en la raíz de la
 * app y `tema.css` solo las usa. Así la prueba de contraste (tests/aura-web-tokens.test.ts) mide
 * exactamente lo que se pinta, y nadie puede cambiar un gris en un sitio y olvidarlo en otro.
 *
 * Regla de la casa: todo texto normal ≥ 4,5:1 contra el fondo donde se pinta (WCAG 1.4.3) y los
 * bordes que dicen «aquí hay un campo» ≥ 3:1 (WCAG 1.4.11). La lista `PARES` es el contrato.
 */

export type NombreTema = 'oscuro' | 'claro';
export type PreferenciaTema = NombreTema | 'sistema';

export type Paleta = {
  /** Fondo de la app y de las hojas (Ajustes, Escribir). */
  fondo: string;
  /** Superficie elevada: tarjetas, campos, botones redondos. */
  panel: string;
  /** Superficie un paso más: botones sobre un panel, pestaña activa. */
  'panel-2': string;
  /** Superficie hundida: tarjetas dentro de una hoja. */
  'panel-hondo': string;
  /** Selección y hover cálidos (el dorado muy bajito). */
  'oro-suave': string;
  borde: string;
  /** Borde de campos y controles: tiene que verse (≥ 3:1). */
  'borde-campo': string;
  /** Texto principal. */
  tinta: string;
  /** Texto secundario (descripciones, estados). */
  'tinta-2': string;
  /** Texto terciario y placeholder: el que antes no llegaba (3,27:1). */
  'tinta-3': string;
  /** El dorado del anillo como relleno de la acción principal. */
  oro: string;
  'oro-hover': string;
  /** El dorado cuando es texto o icono sobre el fondo. */
  'oro-texto': string;
  /** Texto sobre el relleno dorado. */
  'sobre-oro': string;
  /** Anillo de foco del teclado y borde del campo enfocado (≥ 3:1 contra toda superficie). */
  foco: string;
  salvia: string;
  'salvia-texto': string;
  'salvia-fondo': string;
  'salvia-borde': string;
  barro: string;
  'barro-texto': string;
  'barro-fondo': string;
  'barro-borde': string;
  'error-texto': string;
  'ok-texto': string;
  /** Velo detrás de un diálogo. */
  velo: string;
  sombra: string;
};

export const TEMAS: Record<NombreTema, Paleta> = {
  oscuro: {
    fondo: '#232528',
    panel: '#34363A',
    'panel-2': '#3A3C41',
    'panel-hondo': '#2B2D31',
    'oro-suave': '#3D3829',
    borde: '#46484D',
    'borde-campo': '#908A81',
    tinta: '#ECE8E2',
    'tinta-2': '#B9B2A8',
    'tinta-3': '#B0A99E',
    oro: '#D6B56C',
    'oro-hover': '#C9A55A',
    'oro-texto': '#E0C27F',
    'sobre-oro': '#232528',
    foco: '#D6B56C',
    salvia: '#8FA58A',
    'salvia-texto': '#A9C3A4',
    'salvia-fondo': '#2F3A30',
    'salvia-borde': '#3F4D3F',
    barro: '#D9825F',
    'barro-texto': '#E39A7A',
    'barro-fondo': '#3F2E28',
    'barro-borde': '#6B4A3E',
    'error-texto': '#F29488',
    'ok-texto': '#A9C3A4',
    velo: 'rgba(0, 0, 0, 0.55)',
    sombra: 'rgba(0, 0, 0, 0.35)',
  },
  claro: {
    fondo: '#F4F0E9',
    panel: '#FFFFFF',
    'panel-2': '#EFEAE2',
    'panel-hondo': '#F9F6F1',
    'oro-suave': '#F4E8CC',
    borde: '#DDD5C8',
    'borde-campo': '#8A8277',
    tinta: '#26241F',
    'tinta-2': '#5A5349',
    'tinta-3': '#6A6358',
    oro: '#D6B56C',
    'oro-hover': '#C9A55A',
    'oro-texto': '#85601A',
    'sobre-oro': '#232528',
    // En claro el dorado del anillo no se ve alrededor de un botón (1,7:1): el foco va en latón oscuro.
    foco: '#8A6519',
    salvia: '#6F8F69',
    'salvia-texto': '#3B6636',
    'salvia-fondo': '#E5EEE2',
    'salvia-borde': '#B9CDB4',
    barro: '#D9825F',
    'barro-texto': '#A2452A',
    'barro-fondo': '#FBE9E1',
    'barro-borde': '#E7B7A4',
    'error-texto': '#A8261D',
    'ok-texto': '#2F6A36',
    velo: 'rgba(38, 36, 31, 0.40)',
    sombra: 'rgba(38, 36, 31, 0.16)',
  },
};

/**
 * Qué texto se pinta sobre qué fondo, con el mínimo que le toca. Si un componente nuevo pinta un
 * token sobre otro que no está aquí, se agrega aquí: la prueba lo mide en claro y en oscuro.
 */
export const PARES: ReadonlyArray<{ texto: keyof Paleta; fondo: keyof Paleta; minimo: number; uso: string }> = [
  { texto: 'tinta', fondo: 'fondo', minimo: 4.5, uso: 'texto principal sobre el fondo' },
  { texto: 'tinta', fondo: 'panel', minimo: 4.5, uso: 'texto principal en tarjetas y campos' },
  { texto: 'tinta', fondo: 'panel-2', minimo: 4.5, uso: 'pestaña activa, botón sobre panel' },
  { texto: 'tinta', fondo: 'oro-suave', minimo: 4.5, uso: 'opción seleccionada' },
  { texto: 'tinta-2', fondo: 'fondo', minimo: 4.5, uso: 'texto secundario sobre el fondo' },
  { texto: 'tinta-2', fondo: 'panel', minimo: 4.5, uso: 'descripciones en tarjetas' },
  { texto: 'tinta-2', fondo: 'panel-2', minimo: 4.5, uso: 'iconos y etiquetas en botones' },
  { texto: 'tinta-2', fondo: 'panel-hondo', minimo: 4.5, uso: 'texto secundario en tarjetas hundidas' },
  { texto: 'tinta-3', fondo: 'panel', minimo: 4.5, uso: 'placeholder del campo Escribir' },
  { texto: 'tinta-3', fondo: 'fondo', minimo: 4.5, uso: 'texto terciario (hora, «activo: …»)' },
  { texto: 'tinta-3', fondo: 'panel-2', minimo: 4.5, uso: 'texto terciario sobre botones' },
  { texto: 'oro-texto', fondo: 'fondo', minimo: 4.5, uso: 'enlaces y acentos dorados' },
  { texto: 'oro-texto', fondo: 'panel', minimo: 4.5, uso: 'ejemplos dorados en tarjetas' },
  { texto: 'oro-texto', fondo: 'oro-suave', minimo: 4.5, uso: 'aviso dorado sobre su fondo' },
  { texto: 'sobre-oro', fondo: 'oro', minimo: 4.5, uso: 'acción principal (Escribir, Enviar, Confirmar)' },
  { texto: 'sobre-oro', fondo: 'oro-hover', minimo: 4.5, uso: 'acción principal al pasar el puntero' },
  { texto: 'salvia-texto', fondo: 'salvia-fondo', minimo: 4.5, uso: 'sesión activa, resultado correcto' },
  { texto: 'salvia-texto', fondo: 'panel', minimo: 4.5, uso: 'estado «lista» en tarjetas' },
  { texto: 'barro-texto', fondo: 'panel', minimo: 4.5, uso: 'estado «falta», acción de borrar' },
  { texto: 'barro-texto', fondo: 'fondo', minimo: 4.5, uso: 'acción de borrar en la hoja' },
  { texto: 'barro-texto', fondo: 'barro-fondo', minimo: 4.5, uso: 'botón secundario de peligro' },
  { texto: 'error-texto', fondo: 'barro-fondo', minimo: 4.5, uso: 'mensaje de error' },
  { texto: 'error-texto', fondo: 'panel', minimo: 4.5, uso: 'resultado fallido en la tarjeta de acción' },
  { texto: 'ok-texto', fondo: 'panel', minimo: 4.5, uso: 'resultado confirmado en la tarjeta de acción' },
  { texto: 'borde-campo', fondo: 'panel', minimo: 3, uso: 'borde de campo sobre su relleno (1.4.11)' },
  { texto: 'borde-campo', fondo: 'fondo', minimo: 3, uso: 'borde de campo sobre la hoja (1.4.11)' },
  { texto: 'foco', fondo: 'fondo', minimo: 3, uso: 'anillo de foco sobre el fondo (1.4.11)' },
  { texto: 'foco', fondo: 'panel', minimo: 3, uso: 'anillo de foco sobre tarjetas y campos (1.4.11)' },
  { texto: 'foco', fondo: 'panel-2', minimo: 3, uso: 'anillo de foco sobre botones (1.4.11)' },
  { texto: 'foco', fondo: 'panel-hondo', minimo: 3, uso: 'anillo de foco en el panel de trabajo (1.4.11)' },
  { texto: 'oro-texto', fondo: 'panel-2', minimo: 3, uso: 'icono dorado de un control encendido (1.4.11)' },
];

/** Luminancia relativa WCAG de un color #RRGGBB. */
export function luminancia(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const canal = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

/** Relación de contraste WCAG entre dos colores #RRGGBB (1 a 21). */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Las variables CSS de un tema (color, tipografía, espacio, radios), listas para `style` en la raíz. */
export function variablesDe(tema: NombreTema): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(TEMAS[tema])) out[`--aura-${k}`] = v;
  for (const [k, v] of Object.entries(TIPO)) out[`--aura-tipo-${k}`] = v;
  for (const [k, v] of Object.entries(ESPACIO)) out[`--aura-espacio-${k}`] = v;
  for (const [k, v] of Object.entries(RADIO)) out[`--aura-radio-${k}`] = v;
  return out;
}

/**
 * Tipografía: cuerpo de 16 px; lo secundario no baja de 13 px. La MISMA letra que la app del teléfono
 * (mobile/src/ui/tipografia.ts; auditoría M5: la web tenía una tercera, Figtree y Fredoka): Manrope para todo,
 * los títulos en Manrope gruesa y la serif Cormorant Garamond solo para los títulos grandes de bienvenida.
 */
export const TIPO = {
  cuerpo: '16px',
  secundario: '14px',
  pie: '13px',
  titulo: '20px',
  familia: "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
} as const;

/** Espaciado en pasos de 4 px y el tamaño cómodo de un objetivo táctil. */
export const ESPACIO = { s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '24px', s6: '32px', tactil: '44px', tactilGrande: '48px' } as const;

export const RADIO = { campo: '999px', tarjeta: '20px', hoja: '28px' } as const;
