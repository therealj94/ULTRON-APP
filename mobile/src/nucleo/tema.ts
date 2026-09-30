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
  texto3: '#8A847C',
  acento: '#D6B56C',
  acentoTexto: '#E0C27F',
  acentoFondo: '#3D3829',
  sobreAcento: '#1C1D20',
  exito: '#8FA58A',
  exitoFondo: '#2F3A30',
  aviso: '#D9825F',
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
  texto3: '#8C857B',
  acento: '#B8913F',
  acentoTexto: '#8E6C24',
  acentoFondo: '#F3E7C9',
  sobreAcento: '#FFFFFF',
  exito: '#5E7D58',
  exitoFondo: '#E3EEDF',
  aviso: '#B95E3C',
  avisoFondo: '#F6E1D8',
  burbujaMia: '#B8913F',
  textoMia: '#FFFFFF',
  burbujaOtro: '#FFFFFF',
  textoOtro: '#23211E',
  velo: 'rgba(35,33,30,0.35)',
};

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
