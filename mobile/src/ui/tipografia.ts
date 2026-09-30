/**
 * La letra de la 5.0: Manrope para todo (geométrica, cálida, muy legible en pantallas chicas) y
 * Cormorant Garamond solo para los títulos grandes y la marca, que le da el aire editorial de una
 * app hecha con cuidado y no de un formulario. Las dos son de Google Fonts con licencia OFL (el texto
 * de la licencia va junto a los archivos, en assets/fuentes).
 *
 * En Android cada peso es su propia familia («Manrope-Bold»), y ponerle además `fontWeight` hace que
 * el sistema la engorde a mano; por eso nadie escribe `fontFamily` suelto: se pide `fuente('negrita')`
 * y esto devuelve lo correcto. Si las fuentes no llegan a cargar (archivo roto, módulo ausente), se
 * devuelve el peso del sistema: la app se ve con Roboto bien jerarquizada, nunca en blanco.
 */
import { useSyncExternalStore } from 'react';
import { Platform, type TextStyle } from 'react-native';
import * as Font from 'expo-font';

export const ARCHIVOS_FUENTES = {
  'Manrope-Regular': require('../../assets/fuentes/Manrope-Regular.ttf'),
  'Manrope-Medium': require('../../assets/fuentes/Manrope-Medium.ttf'),
  'Manrope-SemiBold': require('../../assets/fuentes/Manrope-SemiBold.ttf'),
  'Manrope-Bold': require('../../assets/fuentes/Manrope-Bold.ttf'),
  'Manrope-ExtraBold': require('../../assets/fuentes/Manrope-ExtraBold.ttf'),
  'Cormorant-SemiBold': require('../../assets/fuentes/CormorantGaramond-SemiBold.ttf'),
};

export type Peso = 'regular' | 'medio' | 'semi' | 'negrita' | 'extra';

const FAMILIA: Record<Peso, string> = {
  regular: 'Manrope-Regular',
  medio: 'Manrope-Medium',
  semi: 'Manrope-SemiBold',
  negrita: 'Manrope-Bold',
  extra: 'Manrope-ExtraBold',
};
const PESO_SISTEMA: Record<Peso, TextStyle['fontWeight']> = { regular: '400', medio: '500', semi: '600', negrita: '700', extra: '800' };

let listas = false;
const oyentes = new Set<() => void>();

/** Se llama en el primer paso del arranque (son archivos del paquete: tarda décimas). */
export async function cargarFuentes(): Promise<boolean> {
  if (listas) return true;
  try {
    await Font.loadAsync(ARCHIVOS_FUENTES);
    listas = true;
  } catch {
    listas = false;
  }
  for (const f of oyentes) f();
  return listas;
}

export function fuentesListas(): boolean {
  return listas;
}

/** Redibuja cuando las fuentes terminan de cargar. */
export function useFuentes(): boolean {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => listas,
    () => listas
  );
}

/** La familia de Manrope en ese peso (o el peso del sistema si no cargó). */
export function fuente(peso: Peso): TextStyle {
  return listas ? { fontFamily: FAMILIA[peso] } : { fontWeight: PESO_SISTEMA[peso] };
}

/** La serif de los títulos grandes. Sin ella, la serif del sistema en negrita. */
export function fuenteDisplay(): TextStyle {
  return listas ? { fontFamily: 'Cormorant-SemiBold' } : { fontFamily: Platform.OS === 'android' ? 'serif' : undefined, fontWeight: '700' };
}

export type Variante =
  | 'marca'
  | 'heroe'
  | 'titulo'
  | 'subtitulo'
  | 'grande'
  | 'cuerpo'
  | 'cuerpoFuerte'
  | 'chica'
  | 'chicaFuerte'
  | 'mini'
  | 'etiqueta'
  | 'boton';

type Escala = { tam: number; alto: number; peso: Peso; display?: boolean; espaciado?: number; mayus?: boolean };

/**
 * La escala: pocos tamaños y bien separados. La serif va grande (a 20 px se ve frágil), las
 * etiquetas en mayúsculas con aire, el cuerpo a 15 con interlínea de 22.
 */
export const ESCALA: Record<Variante, Escala> = {
  marca: { tam: 52, alto: 56, peso: 'semi', display: true, espaciado: 6 },
  heroe: { tam: 36, alto: 40, peso: 'semi', display: true, espaciado: -0.2 },
  titulo: { tam: 24, alto: 30, peso: 'extra', espaciado: -0.4 },
  subtitulo: { tam: 18, alto: 24, peso: 'negrita', espaciado: -0.2 },
  grande: { tam: 17, alto: 25, peso: 'medio' },
  cuerpo: { tam: 15, alto: 22, peso: 'regular' },
  cuerpoFuerte: { tam: 15, alto: 22, peso: 'semi' },
  chica: { tam: 13, alto: 18, peso: 'medio' },
  chicaFuerte: { tam: 13, alto: 18, peso: 'negrita' },
  mini: { tam: 11, alto: 14, peso: 'semi', espaciado: 0.2 },
  etiqueta: { tam: 11, alto: 14, peso: 'extra', espaciado: 1.8, mayus: true },
  boton: { tam: 16, alto: 20, peso: 'negrita', espaciado: 0.1 },
};

/** El estilo completo de una variante (sin color: lo pone quien la usa, con el tema). */
export function estiloLetra(v: Variante): TextStyle {
  const e = ESCALA[v];
  return {
    ...(e.display ? fuenteDisplay() : fuente(e.peso)),
    fontSize: e.tam,
    lineHeight: e.alto,
    letterSpacing: e.espaciado ?? 0,
    ...(e.mayus ? { textTransform: 'uppercase' as const } : null),
    // Android agrega aire arriba de cada línea para acentos que casi nunca hay: sin él los bloques
    // de texto se alinean con los íconos como en el diseño.
    includeFontPadding: false,
  };
}
