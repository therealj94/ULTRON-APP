/**
 * Un ícono de línea (Lucide, en src/ui/iconos.ts) del color del tema.
 *
 * Se pinta como imagen nativa teñida (`tintColor`) a partir de los PNG que genera
 * assets/iconos/generar.mjs: una vista normal de Android, que la intro deja decodificada, así que
 * los íconos de una lista entran con la pantalla y no un cuadro después (lo que pasaba con un
 * Canvas de Skia por ícono, que en Android es una TextureView cada uno).
 */
import { memo } from 'react';
import { Image } from 'react-native';
import { useTema } from '../nucleo/tema';
import type { NombreIcono } from './iconos';
import { IMAGENES_ICONOS } from './iconosPng';

export type { NombreIcono };

/** Todas las imágenes, para precargarlas en la intro. */
export const FUENTES_ICONOS: number[] = Object.values(IMAGENES_ICONOS);

type Props = {
  nombre: NombreIcono;
  tam?: number;
  color?: string;
};

export const Icono = memo(function Icono({ nombre, tam = 22, color }: Props) {
  const tema = useTema();
  return (
    <Image
      source={IMAGENES_ICONOS[nombre]}
      style={{ width: tam, height: tam, tintColor: color || tema.texto }}
      resizeMode="contain"
      fadeDuration={0}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
});
