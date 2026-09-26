/**
 * Los estilos de la sala: la paleta (colores de la habitación y de ella) y la forma del cuerpo.
 *
 * Existen para elegir con imágenes reales y no con descripciones: la misma sala, el mismo motor,
 * solo cambian estos datos. `miel` + `frijol` es el aspecto con el que salió AU-RA; José eligió
 * `grafito` + `orbe` (25-sep) por neutral y adulto, y ese es el de siempre desde entonces.
 */
export type Paleta = 'miel' | 'piedra' | 'arena' | 'grafito';
export type Forma = 'frijol' | 'serena' | 'orbe';
export type Estilo = { paleta: Paleta; forma: Forma };

export const PALETAS: readonly Paleta[] = ['miel', 'piedra', 'arena', 'grafito'];
export const FORMAS: readonly Forma[] = ['frijol', 'serena', 'orbe'];
export const ESTILO_BASE: Estilo = { paleta: 'grafito', forma: 'orbe' };

export type Colores = {
  nombre: string;
  /** Fondo CSS detrás del lienzo (se ve un instante al cargar). */
  fondoCss: string;
  cieloLuz: string; sueloLuz: string; luzHemi: number; sol: string; luzSol: number;
  piso: string; pared: string; zocalo: string;
  ventanaCielo: [string, string, string]; ventanaSol: string; ventanaColinas: string; ventanaMarco: string;
  luzPiso: string;
  alfombra: string; cuadro: string; jarron: string;
  maceta: string; hojas: [string, string, string];
  sillon: string; sillonClaro: string; sillonBase: string;
  puf: string; pufTapa: string; mesa: string; mesaPata: string;
  piel: string; ojos: string; mejilla: string; boca: string;
  bufanda: string; bufanda2: string;
  anillo: string; halo: string; haloOp: number; anilloPuntos: string;
  /** Color de las «z», notas y puntos que suelta. */
  texto: string;
};

export const COLORES: Record<Paleta, Colores> = {
  miel: {
    nombre: 'Miel',
    fondoCss: 'linear-gradient(180deg,#F6ECDF 0%,#EFE1CE 100%)',
    cieloLuz: '#FFFFFF', sueloLuz: '#CDB89C', luzHemi: 2.5, sol: '#FFF0DC', luzSol: 3.0,
    piso: '#E2CFB6', pared: '#F4E9DC', zocalo: '#EBDCC8',
    ventanaCielo: ['#FFE1B0', '#FFF1DA', '#FBE7CC'], ventanaSol: '255,208,130', ventanaColinas: '#B9C79C', ventanaMarco: '#FFFDF8',
    luzPiso: '255,240,214',
    alfombra: '#E9DFD0', cuadro: '#EADCC9', jarron: '#E8D8C2',
    maceta: '#D9825F', hojas: ['#7FA384', '#8FAF93', '#6C9272'],
    sillon: '#D6A04A', sillonClaro: '#E4B866', sillonBase: '#C8A15C',
    puf: '#9DB89F', pufTapa: '#A9C2AB', mesa: '#D8B48A', mesaPata: '#B98E62',
    piel: '#F3E6CD', ojos: '#2F2924', mejilla: '#F2A48B', boca: '#4A2A26',
    bufanda: '#9DBC9A', bufanda2: '#8AAE89',
    anillo: '#F2BE4E', halo: '#FFD27A', haloOp: 0.22, anilloPuntos: '#FFF0C2',
    texto: '#8B7E72',
  },
  // Gris cálido de piedra y lino: sin amarillos, maderas oscuras, latón apagado.
  piedra: {
    nombre: 'Piedra',
    fondoCss: 'linear-gradient(180deg,#ECE9E4 0%,#E2DED7 100%)',
    cieloLuz: '#FFFFFF', sueloLuz: '#B9B3AA', luzHemi: 2.4, sol: '#FFF7EE', luzSol: 2.7,
    piso: '#CFC8BE', pared: '#ECE9E4', zocalo: '#DEDAD3',
    ventanaCielo: ['#E4E6E6', '#F1F1EE', '#EAE8E3'], ventanaSol: '255,244,226', ventanaColinas: '#AEB5A6', ventanaMarco: '#F8F7F4',
    luzPiso: '255,250,242',
    alfombra: '#DCD6CD', cuadro: '#E0DBD3', jarron: '#CFC7BB',
    maceta: '#8E857A', hojas: ['#7A8672', '#8A9582', '#6B7764'],
    sillon: '#6E6862', sillonClaro: '#8A847D', sillonBase: '#A8906A',
    puf: '#B8B0A5', pufTapa: '#C6BFB5', mesa: '#7B5E47', mesaPata: '#5E4636',
    piel: '#F1EEE9', ojos: '#2A2927', mejilla: '#E3C8BE', boca: '#3A3432',
    bufanda: '#9A948C', bufanda2: '#8A847C',
    anillo: '#C7A767', halo: '#E8D3A2', haloOp: 0.1, anilloPuntos: '#F2E6CC',
    texto: '#7D776F',
  },
  // Arena y camel: cálida pero adulta, sin mostaza ni verdes pastel.
  arena: {
    nombre: 'Arena',
    fondoCss: 'linear-gradient(180deg,#F1EBE3 0%,#E7DED2 100%)',
    cieloLuz: '#FFFFFF', sueloLuz: '#C4B39D', luzHemi: 2.45, sol: '#FFF3E4', luzSol: 2.8,
    piso: '#D6C8B5', pared: '#F0E9E0', zocalo: '#E3D9CC',
    ventanaCielo: ['#F2E4CF', '#F8F1E6', '#F1E7DA'], ventanaSol: '252,226,188', ventanaColinas: '#B7B39A', ventanaMarco: '#FBF8F3',
    luzPiso: '255,246,232',
    alfombra: '#E4DBCF', cuadro: '#E6DDD1', jarron: '#D9CBB8',
    maceta: '#A48F79', hojas: ['#7E8A6C', '#8E9A7C', '#6F7B5E'],
    sillon: '#AE8762', sillonClaro: '#C09B77', sillonBase: '#8E7050',
    puf: '#CFC2B0', pufTapa: '#DACEBE', mesa: '#A47B55', mesaPata: '#7F5E42',
    piel: '#F4EFE7', ojos: '#2D2824', mejilla: '#E8C7B6', boca: '#43332D',
    bufanda: '#B9A58E', bufanda2: '#A8937C',
    anillo: '#CDB080', halo: '#EBD9B6', haloOp: 0.12, anilloPuntos: '#F6ECD8',
    texto: '#857A6E',
  },
  // De noche: grafito y nogal, ella en blanco suave y el anillo como la única luz dorada.
  grafito: {
    nombre: 'Grafito',
    fondoCss: 'linear-gradient(180deg,#2C2E32 0%,#232528 100%)',
    cieloLuz: '#C9CDD6', sueloLuz: '#2A2724', luzHemi: 1.5, sol: '#FFE6C4', luzSol: 2.4,
    piso: '#3A3835', pared: '#34363A', zocalo: '#2E3033',
    ventanaCielo: ['#1F2A3D', '#2B3950', '#3B4659'], ventanaSol: '255,226,170', ventanaColinas: '#2B3530', ventanaMarco: '#4A4C50',
    luzPiso: '255,222,170',
    alfombra: '#44423F', cuadro: '#3C3E42', jarron: '#8A7E6E',
    maceta: '#5C5650', hojas: ['#56664F', '#627359', '#4A5944'],
    sillon: '#7A5238', sillonClaro: '#8E6344', sillonBase: '#B89A62',
    puf: '#55524E', pufTapa: '#605C57', mesa: '#5A4535', mesaPata: '#3E3027',
    piel: '#ECE8E2', ojos: '#1E1D1C', mejilla: '#D9BDB1', boca: '#2E2826',
    bufanda: '#6E6A65', bufanda2: '#625E59',
    anillo: '#D6B56C', halo: '#F0CF8A', haloOp: 0.18, anilloPuntos: '#FBEBC4',
    texto: '#B9B2A8',
  },
};

export type Cuerpo = {
  nombre: string;
  /** Radio y alto del cuerpo (antes de ESC). */
  R: number; ALTO: number;
  /** Cuánto se afina hacia arriba (0 = cilíndrica, 0.1 = frijol). */
  afina: number;
  /** Tamaño de ojo y cuánto más alto que ancho. */
  ojo: number; ojoAlto: number; ojoSep: number;
  /** Brillo blanco en el ojo: lo que más «dibujo animado» da. */
  brillo: boolean;
  /** Ojos de luz (emisivos) en vez de pintados. */
  ojosLuz: boolean;
  mejillas: boolean; bufanda: boolean;
  /** Escala de pies (0 = no tiene: flota). */
  pies: number;
  brazos: number;
  /** Cuánto flota sobre el suelo. */
  flota: number;
  anilloGrosor: number;
  boca: number;
};

export const CUERPOS: Record<Forma, Cuerpo> = {
  frijol: {
    nombre: 'Frijol', R: 0.56, ALTO: 1.25, afina: 0.1,
    ojo: 0.072, ojoAlto: 1, ojoSep: 0.17, brillo: true, ojosLuz: false,
    mejillas: true, bufanda: true, pies: 1, brazos: 1, flota: 0, anilloGrosor: 0.013, boca: 1,
  },
  // Más alta y esbelta, ojos pequeños y ovalados, sin rubor ni bufanda: calma, no ternura.
  serena: {
    nombre: 'Serena', R: 0.46, ALTO: 1.45, afina: 0.16,
    ojo: 0.05, ojoAlto: 1.3, ojoSep: 0.14, brillo: false, ojosLuz: false,
    mejillas: false, bufanda: false, pies: 0.72, brazos: 0.8, flota: 0, anilloGrosor: 0.008, boca: 0.8,
  },
  // Un canto rodado que flota: sin pies, ojos de luz. Lo más abstracto y lo menos infantil.
  orbe: {
    nombre: 'Orbe', R: 0.5, ALTO: 1.3, afina: 0.2,
    ojo: 0.045, ojoAlto: 1.7, ojoSep: 0.13, brillo: false, ojosLuz: true,
    mejillas: false, bufanda: false, pies: 0, brazos: 0.7, flota: 0.14, anilloGrosor: 0.007, boca: 0.75,
  },
};

export function estiloDe(p?: Partial<Estilo> | null): Estilo {
  const paleta = p?.paleta && (PALETAS as string[]).includes(p.paleta) ? p.paleta : ESTILO_BASE.paleta;
  const forma = p?.forma && (FORMAS as string[]).includes(p.forma) ? p.forma : ESTILO_BASE.forma;
  return { paleta, forma };
}
