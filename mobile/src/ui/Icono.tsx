/**
 * Un ícono de línea dibujado con Skia: nítido a cualquier tamaño, del color del tema y sin fuentes de
 * íconos que cargar. El trazo se interpreta una sola vez por nombre y se reutiliza en toda la app.
 */
import { memo } from 'react';
import { Canvas, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { useTema } from '../nucleo/tema';
import { TRAZOS, type NombreIcono } from './iconos';

export type { NombreIcono };

const cache = new Map<NombreIcono, SkPath | null>();

function trazo(n: NombreIcono): SkPath | null {
  if (!cache.has(n)) cache.set(n, Skia.Path.MakeFromSVGString(TRAZOS[n]));
  return cache.get(n) ?? null;
}

type Props = {
  nombre: NombreIcono;
  tam?: number;
  color?: string;
  /** Grosor en la cuadrícula de 24 (2 = el de Lucide). */
  grosor?: number;
};

export const Icono = memo(function Icono({ nombre, tam = 22, color, grosor = 2 }: Props) {
  const tema = useTema();
  const p = trazo(nombre);
  if (!p) return null;
  const e = tam / 24;
  return (
    <Canvas style={{ width: tam, height: tam }} pointerEvents="none">
      <Group transform={[{ scale: e }]}>
        <Path path={p} style="stroke" strokeWidth={grosor} strokeCap="round" strokeJoin="round" color={color || tema.texto} />
      </Group>
    </Canvas>
  );
});
