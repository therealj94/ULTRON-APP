/**
 * EL TEMA DE LA 5.0: oscuro, claro o el del sistema, elegido en la primera vez y en Ajustes.
 *
 * Las pantallas nuevas (entrada, primera vez, chats, ajustes, llamadas) toman los colores con
 * `useTema()` al dibujar —no en un StyleSheet de módulo— para cambiar de tema en el acto. La mesa
 * de los avatares es un escenario y sigue oscura en los dos temas, a propósito.
 *
 * Grafito y dorado (la paleta de AU-RA desde el 25-sep) de noche; marfil y el mismo dorado, más
 * hondo para que se lea, de día. Un solo acento; salvia para lo que está bien, terracota para avisar.
 */
import { useSyncExternalStore } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import type { Tema } from './contrato';

export type Paleta = {
  oscuro: boolean;
  fondo: string;
  fondo2: string;
  superficie: string;
  superficie2: string;
  borde: string;
  texto: string;
  texto2: string;
  texto3: string;
  acento: string;
  acentoTexto: string;
  acentoFondo: string;
  sobreAcento: string;
  exito: string;
  exitoFondo: string;
  /** La marca encima de la salvia (la palomita ✔ del BotonCheck): ≥ 3:1 sobre `exito` (UX-02, 11-oct). */
  sobreExito: string;
  aviso: string;
  avisoFondo: string;
  burbujaMia: string;
  textoMia: string;
  burbujaOtro: string;
  textoOtro: string;
  velo: string;
};

export const OSCURO: Paleta = {
  oscuro: true,
  fondo: '#1C1D20',
  fondo2: '#232528',
  superficie: '#2C2E32',
  superficie2: '#34363A',
  borde: '#46484D',
  texto: '#ECE8E2',
  texto2: '#B9B2A8',
  // ≥ 4,5:1 sobre los cuatro fondos (A17; antes #8A847C: 3,27:1 sobre superficie2). Prueba: nucleo/pruebas.
  texto3: '#A8A197',
  acento: '#D6B56C',
  acentoTexto: '#E0C27F',
  acentoFondo: '#3D3829',
  sobreAcento: '#1C1D20',
  exito: '#8FA58A',
  exitoFondo: '#2F3A30',
  // La palomita sobre la salvia clara de noche: la tinta del tema (6,35:1). Blanco daba 2,65:1 (UX-02, 11-oct).
  sobreExito: '#1C1D20',
  // Letra chica de aviso: ≥ 4,5:1 sobre los cuatro fondos y avisoFondo (UX-02; antes #D9825F: 4,48:1 sobre avisoFondo).
  aviso: '#DB8A69',
  avisoFondo: '#3F2E28',
  burbujaMia: '#D6B56C',
  textoMia: '#1C1D20',
  burbujaOtro: '#34363A',
  textoOtro: '#ECE8E2',
  velo: 'rgba(0,0,0,0.55)',
};

export const CLARO: Paleta = {
  oscuro: false,
  fondo: '#F7F3EC',
  fondo2: '#EFE9DF',
  superficie: '#FFFFFF',
  superficie2: '#F2ECE2',
  borde: '#DED6C9',
  texto: '#23211E',
  texto2: '#5E5850',
  // ≥ 4,5:1 sobre los cuatro fondos (A17; antes #8C857B: 3,30:1 sobre fondo y 3,02:1 sobre fondo2).
  texto3: '#6B655C',
  acento: '#B8913F',
  acentoTexto: '#8E6C24',
  acentoFondo: '#F3E7C9',
  // La letra sobre el oro: la tinta del tema (5,47:1 sobre el acento). Blanco daba 2,93:1 (UI01, 3-oct).
  sobreAcento: '#23211E',
  exito: '#5E7D58',
  exitoFondo: '#E3EEDF',
  // De día la salvia es honda: blanco encima se lee (4,62:1).
  sobreExito: '#FFFFFF',
  // La terracota también es letra chica («No se envió», los errores de Correo y de la cuenta): ≥ 4,5:1 sobre
  // superficie, los fondos y avisoFondo (UX-02, 11-oct; antes #B95E3C: 4,44:1 sobre blanco y 3,53:1 sobre avisoFondo).
  aviso: '#9F5134',
  avisoFondo: '#F6E1D8',
  burbujaMia: '#B8913F',
  textoMia: '#23211E',
  burbujaOtro: '#FFFFFF',
  textoOtro: '#23211E',
  velo: 'rgba(35,33,30,0.35)',
};

/**
 * LA MESA: el escenario de los avatares, siempre de noche. Es la MISMA paleta Grafito (auditoría M5: había dos
 * paletas sueltas, `tema.ts` y esta), con los nombres que usa la mesa y su fondo un paso más claro (el
 * `fondo2` de la noche). Antes vivía aparte en src/tema.ts; ahora tema.ts la reexporta desde aquí.
 */
export const MESA = {
  fondo: OSCURO.fondo2,
  fondo2: OSCURO.superficie,
  panel: OSCURO.superficie2,
  panel2: '#3A3C41',
  borde: OSCURO.borde,
  principal: OSCURO.acento,
  /** Texto dorado sobre fondo oscuro (más claro que el botón, para que se lea). */
  principalTexto: OSCURO.acentoTexto,
  principalFondo: OSCURO.acentoFondo,
  /** Lo que va escrito encima de un botón dorado. */
  sobrePrincipal: OSCURO.fondo2,
  activo: OSCURO.exito,
  activoTexto: '#A9C3A4',
  activoFondo: OSCURO.exitoFondo,
  aviso: OSCURO.aviso,
  avisoTexto: '#E39A7A',
  avisoFondo: OSCURO.avisoFondo,
  texto: OSCURO.texto,
  texto2: OSCURO.texto2,
  // ≥ 4,5:1 sobre fondo, fondo2, panel y panel2 (A17; antes #8A847C: 3,27:1 sobre panel).
  texto3: '#B0A99F',
} as const;

/** Sombra para tarjetas y botones flotantes (Android usa elevation). */
export const SOMBRA = { shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 } as const;

/** Medidas comunes: radios, espacios, tamaños de letra y movimiento. */
export const MEDIDA = {
  radio: { s: 10, m: 16, l: 24, xl: 32, redondo: 999 },
  espacio: { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 },
  letra: { chica: 12, cuerpo: 15, grande: 17, titulo: 24, enorme: 34 },
  /** Resortes para Reanimated (withSpring). */
  resorte: { suave: { damping: 18, stiffness: 160, mass: 1 }, vivo: { damping: 12, stiffness: 220, mass: 0.8 } },
  duracion: { rapida: 160, normal: 260, lenta: 480 },
} as const;

let elegido: Tema = 'oscuro';
const oyentes = new Set<() => void>();

export function temaElegido(): Tema {
  return elegido;
}

export function fijarTema(t: Tema) {
  if (t === elegido) return;
  elegido = t;
  for (const f of oyentes) f();
}

function suscribir(f: () => void) {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** La paleta para dibujar fuera de React (p. ej. el color de la barra del sistema). */
export function paletaActual(): Paleta {
  const sistema = Appearance.getColorScheme() === 'light' ? 'claro' : 'oscuro';
  const t = elegido === 'sistema' ? sistema : elegido;
  return t === 'claro' ? CLARO : OSCURO;
}

/** La paleta vigente; redibuja al cambiar el tema elegido o el del sistema. */
export function useTema(): Paleta {
  const t = useSyncExternalStore(suscribir, temaElegido, temaElegido);
  const sistema = useColorScheme() === 'light' ? 'claro' : 'oscuro';
  return (t === 'sistema' ? sistema : t) === 'claro' ? CLARO : OSCURO;
}
